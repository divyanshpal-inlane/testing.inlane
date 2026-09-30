import { createClient } from "@supabase/supabase-js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { supabaseAdmin } from "@/context/auth-context";
import {
  insertZone,
  invalidateDbZoneCache,
} from "@/lib/sales-dashboard/zones-db";
import { supabase } from "@/lib/supabaseClient";

import { StepIndicator } from "./StepIndicator";
// Import step components
import { BasicInfoStep } from "./steps/BasicInfoStep";
import { CalendarImportStep } from "./steps/CalendarImportStep";
import { ContractStep } from "./steps/ContractStep";
import { DocumentsStep } from "./steps/DocumentsStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ServiceAreaStep } from "./steps/ServiceAreaStep";
import { UnavailabilityStep } from "./steps/UnavailabilityStep";
import { VehicleDetailsStep } from "./steps/VehicleDetailsStep";
import { initialOnboardingData, InstructorOnboardingData } from "./types";

const TOTAL_STEPS = 8;

// Email validation helper
const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const AUTH_LIST_PAGE_SIZE = 1000;
const AUTH_LIST_MAX_PAGES = 20;

/**
 * Find an existing auth user by phone or email.
 *
 * `auth.admin.listUsers()` is paginated and defaults to a single page, so
 * scanning only the first response silently misses most accounts. The admin
 * account list is well past one page in production, which is how duplicate
 * onboardings got past this check. Walk every page before concluding "free".
 */
const findExistingAuthUser = async (
  phoneNumber: string,
  email: string,
): Promise<{ id: string; phone?: string; email?: string } | null> => {
  const phoneDigits = phoneNumber.replace(/\D/g, "").slice(-10);
  const normalizedEmail = email.trim().toLowerCase();

  const matches = (u: { id: string; phone?: string; email?: string }) => {
    const candidateDigits = (u.phone || "").replace(/\D/g, "").slice(-10);
    if (phoneDigits.length === 10 && candidateDigits === phoneDigits) {
      return true;
    }
    if (u.email && u.email.trim().toLowerCase() === normalizedEmail) {
      return true;
    }
    return false;
  };

  for (let page = 1; page <= AUTH_LIST_MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: AUTH_LIST_PAGE_SIZE,
    });

    if (error) {
      // Fail closed: if the listing itself breaks we must not report "no
      // duplicate" and then hit an opaque createUser conflict below.
      throw new Error(
        `Could not verify whether this phone/email is already registered: ${error.message}`,
      );
    }

    const found = data?.users?.find(matches);
    if (found) {
      return {
        id: found.id,
        phone: found.phone ?? undefined,
        email: found.email ?? undefined,
      };
    }

    if (!data || data.users.length < AUTH_LIST_PAGE_SIZE) {
      return null;
    }
  }

  throw new Error(
    "Could not verify whether this phone/email is already registered: too many auth users to scan.",
  );
};

/**
 * Sign-up fallback client, deliberately isolated from the shared `supabase`
 * instance in `@/lib/supabaseClient`.
 *
 * The admin creating an instructor is signed in on the same browser tab. If
 * sign-up runs on the shared client and returns a session, Supabase overwrites
 * the admin's stored session with the new instructor's, `onAuthStateChange`
 * fires SIGNED_IN, and the app navigates the admin into the instructor app as
 * the freshly created user. That produced "Instructor not found" followed by a
 * blank page requiring a fresh login. `persistSession: false` keeps the
 * admin's session untouched.
 */
const createIsolatedSignUpClient = () =>
  createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

export function OnboardingWizard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Cleared on unmount. Submitting walks three tables in sequence, and a
   * reload or navigation part-way through would otherwise leave the auth user
   * behind with no Instructor row — the orphan that then blocked the next
   * attempt with "an auth account already exists for this email".
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<InstructorOnboardingData>(
    initialOnboardingData,
  );

  // Update form data helper
  const updateFormData = useCallback(
    (updates: Partial<InstructorOnboardingData>) => {
      setFormData((prev) => ({ ...prev, ...updates }));
    },
    [],
  );

  // Validate current step
  const validateStep = (step: number): ValidationResult => {
    const errors: string[] = [];

    switch (step) {
      case 1: // Basic Info
        if (!formData.name.trim()) {
          errors.push("Name is required");
        } else if (formData.name.trim().length < 2) {
          errors.push("Name must be at least 2 characters");
        }
        if (!formData.phone.trim()) {
          errors.push("Phone number is required");
        } else if (formData.phone.length !== 10) {
          errors.push("Phone number must be exactly 10 digits");
        }
        if (formData.email && !isValidEmail(formData.email)) {
          errors.push("Invalid email format");
        }
        break;

      case 2: // Documents
        if (formData.id_proof_type && !formData.id_proof_number) {
          errors.push("ID proof number is required when type is selected");
        }
        break;

      case 3: // Vehicle Details
        if (!formData.car_fuel_type) {
          errors.push("Fuel type is required");
        }
        if (!formData.car_make) {
          errors.push("Transmission type is required");
        }
        if (!formData.car_mode.trim()) {
          errors.push("Car model is required");
        }
        if (!formData.car_number.trim()) {
          errors.push("Vehicle registration number is required");
        }
        break;

      case 4: // Service Area
        // The drawn polygon is the service area. Optional, so an instructor can
        // still be onboarded before their coverage is mapped.
        break;

      case 5: // Unavailability
        // Optional step, no required validation
        break;

      case 6: // Calendar Import
        // Optional step, no required validation
        break;

      case 7: // Contract
        if (!formData.contractAccepted) {
          errors.push("You must accept the terms and conditions");
        }
        break;

      case 8: // Review
        if (!formData.initialPassword.trim()) {
          errors.push("Initial password is required");
        } else if (formData.initialPassword.length < 6) {
          errors.push("Password must be at least 6 characters");
        }
        break;
    }

    return { valid: errors.length === 0, errors };
  };

  // Handle next step
  const handleNext = () => {
    const validation = validateStep(currentStep);
    if (!validation.valid) {
      toast({
        title: "Validation Error",
        description: validation.errors.join(", "),
        variant: "destructive",
      });
      return;
    }

    setCurrentStep((prev) => Math.min(prev + 1, TOTAL_STEPS));
  };

  // Handle back step
  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // Handle step click from review page
  const handleStepClick = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
    }
  };

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: InstructorOnboardingData) => {
      // 1. Check if phone already exists in Instructor table
      const { data: existingInstructor } = await supabase
        .from("Instructor")
        .select("id_instructor")
        .eq("phone", data.phone)
        .maybeSingle();

      if (existingInstructor) {
        throw new Error("An instructor with this phone number already exists");
      }

      // 2. Check if auth user already exists
      // Note: We can't directly check auth users, but the createUser will fail if exists

      // 3. Create Supabase Auth account
      const phoneNumber = `+91${data.phone}`;
      const userEmail = data.email || `${data.phone}@instructor.inlane.app`;
      console.log("Creating auth user for phone:", phoneNumber);

      // Check if auth user already exists. listUsers() is paginated, so page 1
      // alone silently misses anyone past the first page — that false negative
      // is what let a duplicate create through before.
      const existingUser = await findExistingAuthUser(phoneNumber, userEmail);
      if (existingUser) {
        const matchedPhone = existingUser.phone
          ? `phone ${existingUser.phone}`
          : `email ${existingUser.email}`;
        throw new Error(
          `An auth account already exists for this ${matchedPhone} (User ID: ${existingUser.id}). ` +
            `Delete that auth user (Auth → Users, or Admin → User Management) before onboarding this instructor again.`,
        );
      }

      // Try creating with phone using admin API
      let authData: any = null;
      let authError: any = null;
      let createdWithPhone = false;

      // Method 1: Try admin API with phone (preferred for phone-based login)
      try {
        const result = await supabaseAdmin.auth.admin.createUser({
          phone: phoneNumber,
          password: data.initialPassword,
          email: userEmail,
          email_confirm: true,
          phone_confirm: true,
          user_metadata: {
            user_role: "instructor",
            name: data.name,
          },
        });

        if (!result.error) {
          authData = result.data;
          createdWithPhone = true;
          console.log("Created user with admin API (phone)");
        } else {
          console.warn("Admin API failed:", result.error.message);
          authError = result.error;
        }
      } catch (err) {
        console.warn("Admin API exception:", err);
      }

      // Method 2: Fallback to signUp with phone if admin fails.
      // Uses the isolated client so the admin's own session is never replaced.
      if (!authData?.user) {
        console.log("Trying signUp with phone...");
        const signUpResult = await createIsolatedSignUpClient().auth.signUp({
          phone: phoneNumber,
          password: data.initialPassword,
          options: {
            data: {
              user_role: "instructor",
              name: data.name,
              email: userEmail,
            },
          },
        });

        if (!signUpResult.error && signUpResult.data?.user) {
          authData = signUpResult.data;
          createdWithPhone = true;
          console.log("Created user with signUp (phone)");
        } else if (signUpResult.error) {
          console.warn("Phone signUp failed:", signUpResult.error.message);
        }
      }

      // Method 3: Last resort - create with email only (isolated client)
      if (!authData?.user) {
        console.log("Trying signUp with email only...");
        const emailResult = await createIsolatedSignUpClient().auth.signUp({
          email: userEmail,
          password: data.initialPassword,
          options: {
            data: {
              user_role: "instructor",
              name: data.name,
              phone: data.phone,
            },
          },
        });

        authData = emailResult.data;
        authError = emailResult.error;

        if (authData?.user) {
          console.log(
            "Created user with email (phone login won't work - instructor must use email)",
          );
        }
      }

      // Everything created in this run, so any later failure can unwind all of
      // it. `auth.users` is Supabase's own identity store and cannot join a
      // database transaction, and there is no FK from it to `Instructor` — the
      // app joins the two on phone number. So atomicity has to be built by hand:
      // either all three tables have a row for this instructor, or none do.
      let authUserId: string | null = null;
      let createdInstructorId: string | null = null;

      if (!authData?.user) {
        // Previously this logged a warning and carried on, which produced the
        // inverse orphan: an Instructor row that can never receive an OTP login
        // because no auth identity exists for it. Fail loudly instead.
        throw new Error(
          `Could not create the login account for ${userEmail}` +
            (authError?.message ? `: ${authError.message}` : ".") +
            " Nothing was saved — fix the details above and try again.",
        );
      }

      // Use a local const for the value we know is non-null here, so TS narrows.
      // The `let` is kept for the unwind closure (it can be null if auth creation
      // fails before this point, but that path throws above).
      const newAuthUserId = authData.user.id;
      authUserId = newAuthUserId;
      console.log(
        "Auth user created:",
        newAuthUserId,
        "Phone login:",
        createdWithPhone,
      );

      /**
       * Undoes everything this run created, newest first. The zone row goes
       * with the instructor (`instructor_service_zones.instructor_id` is
       * `ON DELETE CASCADE`), so it is not deleted separately.
       */
      const unwind = async () => {
        if (createdInstructorId) {
          const { error } = await supabase
            .from("Instructor")
            .delete()
            .eq("id_instructor", createdInstructorId);
          if (error) {
            console.error("Unwind: instructor delete failed:", error.message);
          } else {
            console.log("Unwound instructor row:", createdInstructorId);
          }
        }
        if (authUserId) {
          const { error } =
            await supabaseAdmin.auth.admin.deleteUser(authUserId);
          if (error) {
            console.error("Unwind: auth delete failed:", error.message);
          } else {
            console.log("Unwound auth user:", authUserId);
          }
        }
      };

      // The email-only fallback (:341) leaves the `phone` column empty and only
      // records the number in `user_metadata`, so that instructor could never
      // sign in by phone — which is how the app resolves them. Pin the phone on
      // the identity explicitly so all three creation paths agree.
      if (authData.user.phone !== phoneNumber) {
        const { error: phoneErr } =
          await supabaseAdmin.auth.admin.updateUserById(newAuthUserId, {
            phone: phoneNumber,
            phone_confirm: true,
          });
        if (phoneErr) {
          // Fatal, not a warning: the app resolves an instructor by phone, so
          // an identity without one can never sign in. Better to leave nothing
          // behind than a login that cannot work.
          console.error("Could not set phone on auth user:", phoneErr.message);
          await unwind();
          throw new Error(
            `That phone number could not be attached to the login account` +
              (phoneErr.message ? `: ${phoneErr.message}` : ".") +
              " Nothing was saved.",
          );
        }
        createdWithPhone = true;
      }

      // 4. Create Instructor record (only include columns that exist in the table)
      const instructorRecord: Record<string, any> = {
        name: data.name,
        phone: data.phone,
        email: data.email || null,
        DL_number: data.DL_number || null,
        car_make: data.car_make,
        car_mode: data.car_mode,
        car_number: data.car_number,
        car_fuel_type: data.car_fuel_type,
        experience: data.experience || null,
        unavailability: data.unavailability,
        enabled: true,
        signed_up: new Date().toISOString(),
        // Calendar import (optional)
        imported_calendar_events:
          data.importedCalendarEvents.length > 0
            ? data.importedCalendarEvents
            : null,
        imported_calendar_updated_at:
          data.importedCalendarEvents.length > 0
            ? new Date().toISOString()
            : null,
      };

      // Only add optional columns if they exist (these were added via migration)
      // These will be ignored if column doesn't exist due to error handling
      console.log("Creating instructor record:", instructorRecord);

      const { data: newInstructor, error: instructorError } = await supabase
        .from("Instructor")
        .insert(instructorRecord)
        .select()
        .single();

      if (instructorError) {
        console.error("Instructor insert error:", instructorError);
        // Unwind the auth user, or it is stranded with no Instructor row — the
        // exact orphan that blocked the next onboarding attempt.
        await unwind();
        throw new Error(
          `Failed to create instructor: ${instructorError.message}` +
            " Nothing was saved.",
        );
      }

      createdInstructorId = newInstructor.id_instructor;

      // The admin navigated away or reloaded while this was in flight. Unwind
      // rather than leave a half-written set that nothing can complete later.
      if (!mountedRef.current) {
        await unwind();
        throw new Error(
          "Onboarding was cancelled before it finished, so nothing was saved. Please start again.",
        );
      }

      // The service area polygon references instructor_id, so it can only be
      // written after the Instructor row exists.
      if (data.serviceZone && data.serviceZone.length >= 3) {
        // insertZone, not upsert-on-instructor_id: the Instructor row was just
        // created, so this is unambiguously their first and only polygon, and
        // there is no existing row for a conflict target to resolve. Editing it
        // later happens in the Zone Map or the Edit Details dialog.
        try {
          await insertZone({
            instructorId: newInstructor.id_instructor,
            coordinates: data.serviceZone,
          });
          // The sales dashboard caches instructor_service_zones at module
          // scope, so drop it or the new zone goes unseen for the rest of
          // this SPA session.
          invalidateDbZoneCache();
        } catch (zoneErr) {
          // The polygon is optional, so an admin can always add the area later
          // from the Zone Map — but leaving a half-written set behind is what
          // this whole flow is meant to prevent, so unwind completely instead
          // of reporting a partial success.
          console.error("Service zone insert error:", zoneErr);
          await unwind();
          throw new Error(
            "Failed to save the service area, so nothing was saved: " +
              (zoneErr instanceof Error ? zoneErr.message : String(zoneErr)) +
              ". Draw the area first, or leave it blank and add it later from the Zone Map.",
          );
        }
      }

      return {
        instructor: newInstructor,
        credentials: {
          phone: data.phone,
          email: userEmail,
          password: data.initialPassword,
          usePhoneLogin: createdWithPhone,
        },
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["instructors"] });
      queryClient.invalidateQueries({ queryKey: ["serviceable-areas"] });

      const loginMethod = result.credentials.usePhoneLogin
        ? `Phone: +91${result.credentials.phone}`
        : `Email: ${result.credentials.email}`;

      toast({
        title: "Instructor Created Successfully!",
        description: loginMethod,
      });

      // Copy credentials to clipboard
      const credentials = result.credentials.usePhoneLogin
        ? `Phone: +91${result.credentials.phone}\nPassword: ${result.credentials.password}`
        : `Email: ${result.credentials.email}\nPhone: +91${result.credentials.phone}\nPassword: ${result.credentials.password}`;
      navigator.clipboard.writeText(credentials);

      toast({
        title: "Credentials Copied",
        description: "Login credentials have been copied to clipboard",
      });

      navigate("/admin/instructors");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Handle form submission
  const handleSubmit = () => {
    const validation = validateStep(currentStep);
    if (!validation.valid) {
      toast({
        title: "Validation Error",
        description: validation.errors.join(", "),
        variant: "destructive",
      });
      return;
    }

    submitMutation.mutate(formData);
  };

  // Render current step
  const renderStep = () => {
    const stepProps = { data: formData, updateData: updateFormData };

    switch (currentStep) {
      case 1:
        return <BasicInfoStep {...stepProps} />;
      case 2:
        return <DocumentsStep {...stepProps} />;
      case 3:
        return <VehicleDetailsStep {...stepProps} />;
      case 4:
        return <ServiceAreaStep {...stepProps} />;
      case 5:
        return <UnavailabilityStep {...stepProps} />;
      case 6:
        return <CalendarImportStep {...stepProps} />;
      case 7:
        return <ContractStep {...stepProps} />;
      case 8:
        return <ReviewStep {...stepProps} onStepClick={handleStepClick} />;
      default:
        return null;
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/admin/instructors")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Instructors
        </Button>
        <h1 className="text-2xl font-bold">Onboard New Instructor</h1>
        <p className="text-muted-foreground">
          Complete all steps to create a new instructor account
        </p>
      </div>

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} onStepClick={handleStepClick} />

      {/* Step Content */}
      <Card className="mt-6">
        <CardContent className="pt-6">{renderStep()}</CardContent>
      </Card>

      {/* Navigation Buttons */}
      <div className="mt-6 flex justify-between">
        <Button
          variant="outline"
          onClick={handleBack}
          disabled={currentStep === 1 || submitMutation.isPending}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        {currentStep < TOTAL_STEPS ? (
          <Button onClick={handleNext}>
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="bg-green-600 hover:bg-green-700"
          >
            {submitMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Create Instructor
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
