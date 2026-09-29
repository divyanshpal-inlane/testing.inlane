import { UserPlus } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { useCourses } from "@/queries/payment";

import { HalfPaidTracker } from "./HalfPaidTracker";
import { IncompletePaymentsCard } from "./IncompletePaymentsCard";

// Course type options
type CourseType = "predefined" | "custom" | "demo";

type CaseType = "classes_only" | "rto_only" | "lessons_with_rto";
type VehicleType = "two_wheeler" | "four_wheeler";
type LicenceRequirement = "ll" | "dl" | "ll_and_dl" | "not_required";

interface RtoPrototypeData {
  twoWheelerRequirement: LicenceRequirement;
  fourWheelerRequirement: LicenceRequirement;
  addressChangeRequired: boolean;
}

const DEFAULT_RTO_PROTOTYPE_DATA: RtoPrototypeData = {
  twoWheelerRequirement: "not_required",
  fourWheelerRequirement: "not_required",
  addressChangeRequired: false,
};

interface CreateLearnerBasePayload {
  name: string;
  email: string;
  phone: string;
  vehicleType: VehicleType;
  amount: number;
  installmentType: "full" | "installment";
  installment1Amount: number;
  installment2Amount: number;
}

interface CreateLearnerCoursePayload {
  courseId: string | null;
  unlockedLessons: number[];
  courseTypeSelection: CourseType;
  totalLessons: number;
  selectedModules: string[];
  modulePrices: Record<string, number>;
}

interface CreateLearnerLegacyLicencePayload {
  has_a_DL: boolean;
  has_two_wheeler_license: boolean;
  LL_received: boolean;
}

interface CreateLearnerRtoPayload {
  twoWheelerRequirement: LicenceRequirement;
  fourWheelerRequirement: LicenceRequirement;
  rtoAddressChangeRequired: boolean;
}

type CreateLearnerPayload = CreateLearnerBasePayload &
  (
    | ({ caseType: "classes_only" } & CreateLearnerCoursePayload &
        CreateLearnerLegacyLicencePayload)
    | ({ caseType: "rto_only" } & CreateLearnerRtoPayload)
    | ({ caseType: "lessons_with_rto" } & CreateLearnerCoursePayload &
        CreateLearnerRtoPayload)
  );

interface CreateLearnerResponse {
  learner: { id: string };
  enrollment?: { id: string } | null;
}

interface PaymentLinkLearner {
  id: string | null;
  name: string;
  email: string;
  phone: string;
}

interface PaymentLinkCourse {
  name: string;
  duration: number;
}

// Predefined courses with their IDs and durations
const PREDEFINED_COURSES = [
  {
    id: "e129f667-0510-4f07-9847-edb58356dc74",
    name: "Beginner Course",
    duration: 10,
  },
  { id: "f60e5fdb-787a-4b40-844d-4e66416a6c8f", name: "Flyover", duration: 2 },
  { id: "0ce6680f-6e12-49d7-8cf9-4388e81d2e27", name: "Parking", duration: 2 },
  { id: "cc5fb06a-419f-4766-a79b-221c81bf9826", name: "Slopes", duration: 2 },
  { id: "7ff8818e-5b52-4030-bc2d-f54071e8ed7f", name: "Traffic", duration: 4 },
  {
    id: "05a5f57f-c3e2-48ac-b29f-4299e30442eb",
    name: "Parking + Flyover",
    duration: 4,
  },
  {
    id: "abddddb8-3f54-41ea-a64b-5ba55988b12a",
    name: "Slopes + Parking",
    duration: 4,
  },
  {
    id: "ddbbfbbf-2222-4742-947b-ccd4e25e7936",
    name: "Traffic + Parking",
    duration: 6,
  },
  {
    id: "14552c29-e7e5-4e76-a350-1ae7d8ffc7f3",
    name: "Traffic + Flyover",
    duration: 6,
  },
  {
    id: "b991363c-6791-411e-9cb8-6723e40d0a0a",
    name: "Traffic + Parking + Flyover",
    duration: 8,
  },
];

// Skill modules for custom course. `courseId` maps each module to its standalone
// course so its list price can be looked up (and used as the default, editable
// per-module price when building a discounted custom course).
const SKILL_MODULES = [
  {
    id: "flyover",
    name: "Flyover",
    hours: 2,
    courseId: "f60e5fdb-787a-4b40-844d-4e66416a6c8f",
  },
  {
    id: "parking",
    name: "Parking",
    hours: 2,
    courseId: "0ce6680f-6e12-49d7-8cf9-4388e81d2e27",
  },
  {
    id: "slopes",
    name: "Slopes",
    hours: 2,
    courseId: "cc5fb06a-419f-4766-a79b-221c81bf9826",
  },
  {
    id: "traffic",
    name: "Traffic",
    hours: 4,
    courseId: "7ff8818e-5b52-4030-bc2d-f54071e8ed7f",
  },
];

// Demo course config
const DEMO_CONFIG = { hours: 1, price: 1 };

export default function LearnerManagement() {
  // Service-specific state stays separate from learner identity and the
  // existing course form so switching cases can clear only incompatible data.
  const [caseType, setCaseType] = useState<CaseType>("classes_only");
  const [vehicleType, setVehicleType] = useState<VehicleType>("four_wheeler");
  const [rtoPrototypeData, setRtoPrototypeData] = useState<RtoPrototypeData>(
    DEFAULT_RTO_PROTOTYPE_DATA,
  );

  // Course selection state
  const [courseType, setCourseType] = useState<CourseType>("predefined");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  // Per-module price for a custom course (keyed by module id). Defaults to the
  // module's list price; editable so sales can discount individual modules.
  const [modulePrices, setModulePrices] = useState<Record<string, number>>({});
  const { data: coursesData } = useCourses();

  const [learnerData, setLearnerData] = useState({
    name: "",
    email: "",
    phone: "",
    courseId: "",
    courseName: "",
    amount: 0,
    installmentType: "installment",
    installment1Amount: 0,
    installment2Amount: 0,
    unlockedLessons: [] as number[],
    has_a_DL: false,
    has_two_wheeler_license: false,
    // New fields for course type tracking
    courseTypeSelection: "predefined" as CourseType,
    selectedModules: [] as string[],
    totalLessons: 0,
    enrollmentId: null as string | null,
  });

  const [createdLearnerId, setCreatedLearnerId] = useState<string | null>(null);
  const [isCreateLearnerDialogOpen, setIsCreateLearnerDialogOpen] =
    useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Calculate total lessons based on course type
  const totalLessons = useMemo(() => {
    if (courseType === "demo") return 1;
    if (courseType === "predefined") {
      const course = PREDEFINED_COURSES.find((c) => c.id === selectedCourseId);
      return course?.duration || 0;
    }
    if (courseType === "custom") {
      return selectedModules.reduce((total, moduleId) => {
        const module = SKILL_MODULES.find((m) => m.id === moduleId);
        return total + (module?.hours || 0);
      }, 0);
    }
    return 0;
  }, [courseType, selectedCourseId, selectedModules]);

  // Get course name for display
  const courseName = useMemo(() => {
    if (courseType === "demo") return "Demo Lesson";
    if (courseType === "predefined") {
      const course = PREDEFINED_COURSES.find((c) => c.id === selectedCourseId);
      return course?.name || "";
    }
    if (courseType === "custom") {
      const moduleNames = selectedModules.map((id) => {
        const module = SKILL_MODULES.find((m) => m.id === id);
        return module?.name || "";
      });
      return moduleNames.length > 0
        ? `Custom: ${moduleNames.join(" + ")}`
        : "Custom Course";
    }
    return "";
  }, [courseType, selectedCourseId, selectedModules]);

  // A module's list price from the Courses table (default before any discount).
  const standardModulePrice = (courseId: string): number => {
    const c = coursesData?.find((x) => x.id === courseId);
    return typeof c?.price === "number" ? c.price : 2000;
  };

  // Recompute the custom-course amount (sum of per-module prices) and keep the
  // installment split + display name in sync.
  const syncCustomAmount = (sel: string[], prices: Record<string, number>) => {
    const total = sel.reduce((sum, id) => sum + (Number(prices[id]) || 0), 0);
    const moduleNames = sel.map(
      (id) => SKILL_MODULES.find((m) => m.id === id)?.name || "",
    );
    setLearnerData((prev) => {
      const inst1 =
        prev.installmentType === "installment" ? Math.round(total / 2) : total;
      const inst2 = prev.installmentType === "installment" ? total - inst1 : 0;
      return {
        ...prev,
        courseId: "",
        courseName:
          moduleNames.length > 0
            ? `Custom: ${moduleNames.join(" + ")}`
            : "Custom Course",
        amount: total,
        installment1Amount: inst1,
        installment2Amount: inst2,
      };
    });
  };

  // Toggle a custom module and default/clear its price, then re-sum.
  const toggleCustomModule = (module: (typeof SKILL_MODULES)[number]) => {
    const isSelected = selectedModules.includes(module.id);
    const newSel = isSelected
      ? selectedModules.filter((id) => id !== module.id)
      : [...selectedModules, module.id];
    const newPrices = { ...modulePrices };
    if (isSelected) delete newPrices[module.id];
    else newPrices[module.id] = standardModulePrice(module.courseId);
    setSelectedModules(newSel);
    setModulePrices(newPrices);
    syncCustomAmount(newSel, newPrices);
  };

  // Edit one module's price (for a discount) and re-sum.
  const setCustomModulePrice = (moduleId: string, price: number) => {
    const newPrices = { ...modulePrices, [moduleId]: price };
    setModulePrices(newPrices);
    syncCustomAmount(selectedModules, newPrices);
  };

  // Reset form when dialog opens
  const openCreateDialog = () => {
    setCaseType("classes_only");
    setVehicleType("four_wheeler");
    setRtoPrototypeData(DEFAULT_RTO_PROTOTYPE_DATA);
    setCourseType("predefined");
    setSelectedCourseId("");
    setSelectedModules([]);
    setModulePrices({});
    setLearnerData({
      name: "",
      email: "",
      phone: "",
      courseId: "",
      courseName: "",
      amount: 0,
      installmentType: "installment",
      installment1Amount: 0,
      installment2Amount: 0,
      unlockedLessons: [],
      has_a_DL: false,
      has_two_wheeler_license: false,
      courseTypeSelection: "predefined",
      selectedModules: [],
      totalLessons: 0,
      enrollmentId: null,
    });
    setIsCreateLearnerDialogOpen(true);
  };

  const clearCoursePrototypeFields = () => {
    setCourseType("predefined");
    setSelectedCourseId("");
    setSelectedModules([]);
    setModulePrices({});
    setLearnerData((prev) => ({
      ...prev,
      courseId: "",
      courseName: "",
      amount: 0,
      installmentType: "installment",
      installment1Amount: 0,
      installment2Amount: 0,
      unlockedLessons: [],
      courseTypeSelection: "predefined",
      selectedModules: [],
      totalLessons: 0,
    }));
  };

  const handleCaseTypeChange = (value: CaseType) => {
    if (value === "rto_only") {
      clearCoursePrototypeFields();
    }
    if (value === "classes_only") {
      setRtoPrototypeData(DEFAULT_RTO_PROTOTYPE_DATA);
      setVehicleType("four_wheeler");
    }
    setCaseType(value);
  };

  const handleLicenceRequirementChange = (
    field: "twoWheelerRequirement" | "fourWheelerRequirement",
    value: LicenceRequirement,
  ) => {
    setRtoPrototypeData((prev) => ({ ...prev, [field]: value }));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Destructure properties from the event target
    const { name, value, type, checked } = e.target;

    // If the changed field is one of the license checkboxes, handle mutual exclusion
    if (name === "has_a_DL") {
      setLearnerData((prevData) => ({
        ...prevData,
        [name]: checked,
        has_two_wheeler_license: checked
          ? false
          : prevData.has_two_wheeler_license,
      }));
    } else if (name === "has_two_wheeler_license") {
      setLearnerData((prevData) => ({
        ...prevData,
        [name]: checked,
        has_a_DL: checked ? false : prevData.has_a_DL,
      }));
    } else {
      setLearnerData((prev) => {
        const updatedData = {
          ...prev,
          [name]: type === "checkbox" ? checked : value,
        };

        if (name === "amount" || name === "installment1Amount") {
          const amount =
            name === "amount" ? Number(value) : Number(prev.amount);

          const installment1Amount =
            name === "installment1Amount"
              ? Number(value)
              : Number(prev.installment1Amount);

          if (updatedData.installmentType === "installment") {
            updatedData.installment2Amount = amount - installment1Amount;
          }
        }

        return updatedData;
      });
    }
  };

  const handleUnlockedLessonsChange = (value: string) => {
    // If value is empty, don't update the state yet
    if (value === "") return;

    const lessonCount = parseInt(value, 10);
    setLearnerData((prev) => ({
      ...prev,
      unlockedLessons: Array.from({ length: lessonCount }, (_, i) => i + 1),
    }));
  };

  const handleInstallmentTypeChange = (value: string) => {
    if (value !== "full" && value !== "installment") return;
    setLearnerData((prev) => {
      const updatedData = {
        ...prev,
        installmentType: value,
      };

      // Recalculate installment2Amount when switching to installment mode
      if (value === "installment") {
        updatedData.installment2Amount =
          Number(prev.amount) - Number(prev.installment1Amount);
      } else {
        updatedData.installment2Amount = 0;
      }

      return updatedData;
    });
  };

  const createLearnerAndEnrollment = async () => {
    try {
      const hasCourse = caseType !== "rto_only";
      const hasRto = caseType !== "classes_only";
      const totalAmount = Number(learnerData.amount);
      const firstPaymentAmount = Number(learnerData.installment1Amount);
      const secondPaymentAmount = Number(learnerData.installment2Amount);

      if (!learnerData.name || !learnerData.phone) {
        toast({
          title: "Error",
          description: "Please fill in name and phone.",
          variant: "destructive",
        });
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(learnerData.email)) {
        toast({
          title: "Error",
          description: "Invalid email address.",
          variant: "destructive",
        });
        return;
      }
      if (!/^\d{10}$/.test(learnerData.phone)) {
        toast({
          title: "Error",
          description: "Phone must contain exactly 10 digits.",
          variant: "destructive",
        });
        return;
      }

      if (hasCourse && courseType === "predefined" && !selectedCourseId) {
        toast({
          title: "Error",
          description: "Please select a course.",
          variant: "destructive",
        });
        return;
      }

      if (
        hasCourse &&
        courseType === "custom" &&
        selectedModules.length === 0
      ) {
        toast({
          title: "Error",
          description: "Please select at least one module for custom course.",
          variant: "destructive",
        });
        return;
      }

      if (!Number.isFinite(totalAmount) || totalAmount < 0) {
        toast({
          title: "Error",
          description: "Amount must be at least 0.",
          variant: "destructive",
        });
        return;
      }

      if (
        learnerData.installmentType === "installment" &&
        (!Number.isFinite(firstPaymentAmount) ||
          !Number.isFinite(secondPaymentAmount) ||
          firstPaymentAmount < 0 ||
          secondPaymentAmount < 0 ||
          Math.abs(firstPaymentAmount + secondPaymentAmount - totalAmount) >
            0.01)
      ) {
        toast({
          title: "Error",
          description: "Installment amounts must equal the total amount.",
          variant: "destructive",
        });
        return;
      }

      if (hasRto) {
        if (
          rtoPrototypeData.twoWheelerRequirement === "not_required" &&
          rtoPrototypeData.fourWheelerRequirement === "not_required"
        ) {
          toast({
            title: "Error",
            description:
              "Select at least one 2-wheeler or 4-wheeler RTO service.",
            variant: "destructive",
          });
          return;
        }
      }

      // Keep the existing duplicate check for a fast, familiar admin error;
      // the Edge Function repeats it because the client cannot be trusted.
      const { data: existingLearners, error: checkError } = await supabase
        .from("Learner")
        .select("id")
        .eq("phone", learnerData.phone);

      if (checkError) {
        toast({
          title: "Error",
          description: "Failed to check learner existence",
          variant: "destructive",
        });
        return;
      }

      if (existingLearners && existingLearners.length > 0) {
        toast({
          title: "Error",
          description: "Learner already registered",
          variant: "destructive",
        });
        return;
      }

      const selectedCourse = PREDEFINED_COURSES.find(
        (course) => course.id === selectedCourseId,
      );
      const submissionCourseName = hasCourse
        ? courseType === "predefined"
          ? selectedCourse?.name || ""
          : courseType === "custom"
            ? courseName
            : "Demo Lesson"
        : "";

      const normalizedCourseId =
        courseType === "predefined" ? selectedCourseId : null;
      const normalizedUnlockedLessons =
        learnerData.unlockedLessons.length > 0
          ? [...learnerData.unlockedLessons]
          : [1];
      const normalizedSelectedModules =
        courseType === "custom" ? [...selectedModules] : [];
      const normalizedModulePrices =
        courseType === "custom" ? { ...modulePrices } : {};

      let payload: CreateLearnerPayload;
      if (caseType === "classes_only") {
        payload = {
          name: learnerData.name.trim(),
          email: learnerData.email.trim(),
          phone: learnerData.phone,
          caseType: "classes_only",
          vehicleType,
          courseId: normalizedCourseId,
          amount: totalAmount,
          installmentType: learnerData.installmentType as
            | "full"
            | "installment",
          installment1Amount: firstPaymentAmount,
          installment2Amount: secondPaymentAmount,
          unlockedLessons: normalizedUnlockedLessons,
          courseTypeSelection: courseType,
          totalLessons,
          selectedModules: normalizedSelectedModules,
          modulePrices: normalizedModulePrices,
          has_a_DL: learnerData.has_a_DL,
          has_two_wheeler_license: learnerData.has_two_wheeler_license,
          LL_received: learnerData.has_a_DL,
        };
      } else if (caseType === "rto_only") {
        payload = {
          name: learnerData.name.trim(),
          email: learnerData.email.trim(),
          phone: learnerData.phone,
          caseType: "rto_only",
          vehicleType,
          amount: totalAmount,
          installmentType: learnerData.installmentType as
            | "full"
            | "installment",
          installment1Amount: firstPaymentAmount,
          installment2Amount: secondPaymentAmount,
          twoWheelerRequirement: rtoPrototypeData.twoWheelerRequirement,
          fourWheelerRequirement: rtoPrototypeData.fourWheelerRequirement,
          rtoAddressChangeRequired: rtoPrototypeData.addressChangeRequired,
        };
      } else {
        payload = {
          name: learnerData.name.trim(),
          email: learnerData.email.trim(),
          phone: learnerData.phone,
          caseType: "lessons_with_rto",
          vehicleType,
          courseId: normalizedCourseId,
          amount: totalAmount,
          installmentType: learnerData.installmentType as
            | "full"
            | "installment",
          installment1Amount: firstPaymentAmount,
          installment2Amount: secondPaymentAmount,
          unlockedLessons: normalizedUnlockedLessons,
          courseTypeSelection: courseType,
          totalLessons,
          selectedModules: normalizedSelectedModules,
          modulePrices: normalizedModulePrices,
          twoWheelerRequirement: rtoPrototypeData.twoWheelerRequirement,
          fourWheelerRequirement: rtoPrototypeData.fourWheelerRequirement,
          rtoAddressChangeRequired: rtoPrototypeData.addressChangeRequired,
        };
      }

      // Close the dialog before sending to backend to disable multiple clicks
      setIsCreateLearnerDialogOpen(false); // Close the create learner dialog

      // send to backend
      let responseData: CreateLearnerResponse | null = null;

      try {
        const response = await supabase.functions.invoke(
          "create-learner-and-enrollment",
          {
            body: payload,
          },
        );

        // Check if there was an error in the response
        if (response.error) {
          // Re-throw the Supabase FunctionsHttpError to be caught below
          throw response.error;
        }

        const { data } = response;
        // If data is null, something went wrong
        if (!data) {
          throw new Error("No data received from server");
        }

        // Check if data has learner (success case)
        if (!data.learner) {
          throw new Error("Learner data missing from response");
        }

        responseData = data as CreateLearnerResponse;
      } catch (error: unknown) {
        // Try to extract error message from the edge function error
        let errorMessage = "Failed to create learner";
        const functionError = error as {
          context?: { response?: unknown };
          message?: unknown;
        };

        // Check if context.response exists (Supabase FunctionsHttpError format)
        if (functionError.context?.response) {
          try {
            let errorData = functionError.context.response;

            if (typeof errorData === "string") {
              errorData = JSON.parse(errorData);
            }

            if (
              typeof errorData === "object" &&
              errorData !== null &&
              "error" in errorData &&
              typeof errorData.error === "string"
            ) {
              errorMessage = errorData.error;
            }
          } catch {
            errorMessage = "Failed to read the server error response";
          }
        } else if (typeof functionError.message === "string") {
          // Fallback: Use the error message directly
          errorMessage = functionError.message;
        }

        throw new Error(errorMessage);
      }

      // Ensure we set the created learner ID and enrollment ID
      if (responseData && responseData.learner && responseData.learner.id) {
        const data = responseData;
        setCreatedLearnerId(data.learner.id);

        // Store enrollment ID for payment link
        const enrollmentId = data.enrollment ? data.enrollment.id : null;

        toast({
          title: "Success",
          description:
            caseType === "classes_only"
              ? "Learner and enrollment created successfully!"
              : "Learner and RTO details saved. No payment link was sent.",
        });

        // The existing payment page understands course/demo/custom enrollments
        // only. Never send a partial course-only payment for an RTO case.
        if (enrollmentId && caseType === "classes_only") {
          // Store enrollment ID in state for use when sending payment link
          setLearnerData((prev) => ({
            ...prev,
            enrollmentId,
          }));
          setIsPaymentDialogOpen(true);

          // Auto-dispatch the payment link immediately so the learner doesn't wait
          // on the admin to click a button. Dialog still opens as an acknowledgement
          // + gives admin a "resend" path if needed.
          const paymentAmount =
            learnerData.installmentType === "installment"
              ? learnerData.installment1Amount
              : learnerData.amount || totalAmount;
          sendPaymentLink(
            {
              id: data.learner.id,
              name: learnerData.name,
              email: learnerData.email,
              phone: learnerData.phone,
            },
            {
              name: submissionCourseName,
              duration: totalLessons,
            },
            paymentAmount,
            learnerData.installmentType,
            enrollmentId,
            courseType,
          ).catch((err) => {
            console.error("Auto payment link dispatch failed:", err);
          });
        }
      } else {
        throw new Error("No learner ID returned");
      }
    } catch (err) {
      // Reopen the dialog so user can try again
      setIsCreateLearnerDialogOpen(true);

      // Get the error message
      let errorDescription = "An error occurred";
      if (err instanceof Error) {
        errorDescription = err.message;
      }

      toast({
        title: "Error",
        description: errorDescription,
        variant: "destructive",
      });
      setCreatedLearnerId(null); // Reset createdLearnerId in case of error
    }
  };

  const sendPaymentLink = async (
    learner: PaymentLinkLearner,
    course: PaymentLinkCourse,
    amount: number,
    installmentMode: string,
    enrollmentId: string,
    linkCourseType?: CourseType,
  ) => {
    // Close the payment dialog if it's open (for newly created learners)
    if (isPaymentDialogOpen) {
      setIsPaymentDialogOpen(false);
    }
    try {
      const typeParam = linkCourseType === "demo" ? "&type=demo" : "";
      const paymentLink = `https://inlane-web-app.vercel.app/payment?phone=${learner.phone}${typeParam}`;
      console.log(
        "Use edge function for email ",
        learner.email,
        learner.name,
        course.name,
        amount,
      );

      // Define the request body for email trigger.
      const bodyData = {
        learnerEmail: learner?.email,
        learnerName: learner?.name,
        course: course?.name,
        amount: amount,
        paymentLink: paymentLink,
      };

      const { error: invokeError } = await supabase.functions.invoke(
        "send-payment-link-email",
        {
          body: bodyData,
        },
      );
      if (invokeError) {
        console.error(invokeError);
        toast({
          title: "Failed to send email",
          description: `Failed to send link sent to ${learner?.email}`,
        });
      } else {
        toast({
          title: "Success",
          description: `Payment link sent to ${learner?.email} successfully!`,
        });
      }

      const { error } = await supabase.functions.invoke("send-message", {
        body: {
          message_type: "PAYMENT_LINK",
          learner_id: learner.id,
          enrollment_id: enrollmentId, // Include enrollment ID for tracking
          course_name: course.name,
          payment_amount: amount,
          duration: course.duration,
          payment_link: paymentLink,
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Payment link sent to ${learner.name} successfully!`,
      });
    } catch (err) {
      toast({
        title: "Error",
        description:
          err instanceof Error ? err.message : "Failed to send payment link",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className="min-h-screen bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
        backgroundAttachment: "fixed", // This prevents the background from getting cut off
      }}
    >
      <div className="container mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="h-10 w-10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-4xl font-bold tracking-tight">
            Learner Management
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Create learners and manage enrollments
          </p>
        </div>

        <div className="grid gap-6">
          {/* Card for Creating Learner */}
          <Card className="transition-all hover:shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-gray-100 p-2 text-green-500">
                  <UserPlus size={24} />
                </div>
                <div>
                  <CardTitle className="text-xl">Create Learner</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="ghost"
                onClick={openCreateDialog}
              >
                Create New Learner
              </Button>
            </CardContent>
          </Card>

          {/* Incomplete Payments Card */}
          <IncompletePaymentsCard />

          {/* 50% Payment Tracker */}
          <HalfPaidTracker />

          {/* Dialog for Creating Learner */}
          <Dialog
            open={isCreateLearnerDialogOpen}
            onOpenChange={setIsCreateLearnerDialogOpen}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Learner</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">
                    Name
                  </Label>
                  <Input
                    id="name"
                    name="name"
                    value={learnerData.name}
                    onChange={handleInputChange}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="email" className="text-right">
                    Email
                  </Label>
                  <Input
                    id="email"
                    name="email"
                    value={learnerData.email}
                    onChange={handleInputChange}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="phone" className="text-right">
                    Phone
                  </Label>
                  <Input
                    id="phone"
                    name="phone"
                    value={learnerData.phone}
                    onChange={handleInputChange}
                    className="col-span-3"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="caseType" className="text-right">
                    Case Type
                  </Label>
                  <Select
                    onValueChange={(value: CaseType) =>
                      handleCaseTypeChange(value)
                    }
                    value={caseType}
                  >
                    <SelectTrigger id="caseType" className="col-span-3">
                      <SelectValue placeholder="Select case type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="classes_only">Classes Only</SelectItem>
                      <SelectItem value="rto_only">RTO Only</SelectItem>
                      <SelectItem value="lessons_with_rto">
                        RTO + Classes
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div
                  className={`grid grid-cols-4 items-center gap-4 ${
                    caseType === "rto_only" ? "hidden" : ""
                  }`}
                >
                  <Label htmlFor="vehicleType" className="text-right">
                    Vehicle Type
                  </Label>
                  <Select
                    onValueChange={(value: VehicleType) =>
                      setVehicleType(value)
                    }
                    value={vehicleType}
                  >
                    <SelectTrigger id="vehicleType" className="col-span-3">
                      <SelectValue placeholder="Select vehicle" />
                    </SelectTrigger>
                    <SelectContent>
                      {caseType !== "classes_only" && (
                        <SelectItem value="two_wheeler">2-Wheeler</SelectItem>
                      )}
                      <SelectItem value="four_wheeler">4-Wheeler</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Course Type Selection */}
                <div
                  className={`grid grid-cols-4 items-center gap-4 ${
                    caseType === "rto_only" ? "hidden" : ""
                  }`}
                >
                  <Label htmlFor="courseType" className="text-right">
                    Course Type
                  </Label>
                  <Select
                    onValueChange={(value: CourseType) => {
                      setCourseType(value);
                      // Reset selections when type changes
                      setSelectedCourseId("");
                      setSelectedModules([]);
                      setModulePrices({});
                      // Update learnerData based on type
                      if (value === "demo") {
                        setLearnerData((prev) => ({
                          ...prev,
                          courseId: "",
                          courseName: "Demo Lesson",
                          amount: DEMO_CONFIG.price,
                          installmentType: "full",
                          installment1Amount: DEMO_CONFIG.price,
                          installment2Amount: 0,
                        }));
                      } else {
                        setLearnerData((prev) => ({
                          ...prev,
                          courseId: "",
                          courseName: "",
                        }));
                      }
                    }}
                    value={courseType}
                  >
                    <SelectTrigger id="courseType" className="col-span-3">
                      <SelectValue placeholder="Select course type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="predefined">
                        Predefined Course
                      </SelectItem>
                      <SelectItem value="custom">Custom Course</SelectItem>
                      <SelectItem value="demo">Demo Lesson</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Predefined Course Selection */}
                {caseType !== "rto_only" && courseType === "predefined" && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label htmlFor="courseId" className="text-right">
                      Select Course
                    </Label>
                    <Select
                      onValueChange={(courseId) => {
                        setSelectedCourseId(courseId);
                        const selectedCourse = PREDEFINED_COURSES.find(
                          (c) => c.id === courseId,
                        );
                        setLearnerData((prev) => ({
                          ...prev,
                          courseId,
                          courseName: selectedCourse?.name || "",
                        }));
                      }}
                      value={selectedCourseId}
                    >
                      <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select a course" />
                      </SelectTrigger>
                      <SelectContent>
                        {PREDEFINED_COURSES.map((course) => (
                          <SelectItem key={course.id} value={course.id}>
                            {course.name} ({course.duration} hrs)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Custom Course - Module Selection */}
                {caseType !== "rto_only" && courseType === "custom" && (
                  <div className="grid grid-cols-4 items-start gap-4">
                    <Label className="pt-2 text-right">Select Modules</Label>
                    <div className="col-span-3 space-y-2">
                      {SKILL_MODULES.map((module) => {
                        const checked = selectedModules.includes(module.id);
                        return (
                          <div
                            key={module.id}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id={module.id}
                              checked={checked}
                              onCheckedChange={() => toggleCustomModule(module)}
                            />
                            <Label
                              htmlFor={module.id}
                              className="flex-1 cursor-pointer font-normal"
                            >
                              {module.name} ({module.hours} hrs)
                            </Label>
                            {checked && (
                              <div className="flex items-center gap-1">
                                <span className="text-sm text-muted-foreground">
                                  ₹
                                </span>
                                <Input
                                  type="number"
                                  min={0}
                                  value={modulePrices[module.id] ?? ""}
                                  onChange={(e) =>
                                    setCustomModulePrice(
                                      module.id,
                                      Number(e.target.value),
                                    )
                                  }
                                  onWheel={(e) => e.currentTarget.blur()}
                                  className="h-8 w-24"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {selectedModules.length > 0 && (
                        <p className="pt-1 text-sm font-medium">
                          Total: ₹
                          {selectedModules.reduce(
                            (sum, id) => sum + (Number(modulePrices[id]) || 0),
                            0,
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Demo Course Info */}
                {caseType !== "rto_only" && courseType === "demo" && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Course Info</Label>
                    <div className="col-span-3">
                      <Badge variant="secondary" className="text-sm">
                        Demo Lesson - 1 hour - ₹{learnerData.amount}
                      </Badge>
                    </div>
                  </div>
                )}

                {/* Total Lessons Display */}
                {caseType !== "rto_only" && totalLessons > 0 && (
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Total Lessons</Label>
                    <div className="col-span-3">
                      <Badge variant="outline" className="text-sm font-medium">
                        {totalLessons}{" "}
                        {totalLessons === 1 ? "lesson" : "lessons"} (
                        {totalLessons} hours)
                      </Badge>
                    </div>
                  </div>
                )}
                {caseType !== "classes_only" && (
                  <>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label
                        htmlFor="twoWheelerRequirement"
                        className="text-right"
                      >
                        2-Wheeler Licence
                      </Label>
                      <Select
                        onValueChange={(value: LicenceRequirement) =>
                          handleLicenceRequirementChange(
                            "twoWheelerRequirement",
                            value,
                          )
                        }
                        value={rtoPrototypeData.twoWheelerRequirement}
                      >
                        <SelectTrigger
                          id="twoWheelerRequirement"
                          className="col-span-3"
                        >
                          <SelectValue placeholder="Select requirement" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ll">LL</SelectItem>
                          <SelectItem value="dl">DL</SelectItem>
                          <SelectItem value="ll_and_dl">LL and DL</SelectItem>
                          <SelectItem value="not_required">
                            Not Required
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label
                        htmlFor="fourWheelerRequirement"
                        className="text-right"
                      >
                        4-Wheeler Licence
                      </Label>
                      <Select
                        onValueChange={(value: LicenceRequirement) =>
                          handleLicenceRequirementChange(
                            "fourWheelerRequirement",
                            value,
                          )
                        }
                        value={rtoPrototypeData.fourWheelerRequirement}
                      >
                        <SelectTrigger
                          id="fourWheelerRequirement"
                          className="col-span-3"
                        >
                          <SelectValue placeholder="Select requirement" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ll">LL</SelectItem>
                          <SelectItem value="dl">DL</SelectItem>
                          <SelectItem value="ll_and_dl">LL and DL</SelectItem>
                          <SelectItem value="not_required">
                            Not Required
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label
                        htmlFor="prototypeAddressChange"
                        className="text-right"
                      >
                        Address Change
                      </Label>
                      <Select
                        value={
                          rtoPrototypeData.addressChangeRequired
                            ? "required"
                            : "not_required"
                        }
                        onValueChange={(value) =>
                          setRtoPrototypeData((prev) => ({
                            ...prev,
                            addressChangeRequired: value === "required",
                          }))
                        }
                      >
                        <SelectTrigger
                          id="prototypeAddressChange"
                          className="col-span-3"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="required">Required</SelectItem>
                          <SelectItem value="not_required">
                            Not Required
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="amount" className="text-right">
                    Amount (₹)
                  </Label>
                  <Input
                    id="amount"
                    name="amount"
                    type="number"
                    value={learnerData.amount}
                    onChange={handleInputChange}
                    min={0}
                    className="col-span-3"
                    onWheel={(event) => event.currentTarget.blur()}
                    disabled={
                      caseType === "classes_only" && courseType === "custom"
                    }
                  />
                </div>

                {/* Hide installment options for demo courses */}
                {courseType !== "demo" && (
                  <>
                    <div className="grid grid-cols-4 items-center gap-4">
                      <Label htmlFor="installmentType" className="text-right">
                        Payment Type
                      </Label>
                      <Select
                        onValueChange={handleInstallmentTypeChange}
                        value={learnerData.installmentType}
                      >
                        <SelectTrigger
                          id="installmentType"
                          className="col-span-3"
                        >
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="full">Full Payment</SelectItem>
                          <SelectItem value="installment">
                            Installment (Half now)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {learnerData.installmentType === "installment" && (
                      <>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label
                            htmlFor="installment1Amount"
                            className="text-right"
                          >
                            1st Payment (₹)
                          </Label>
                          <Input
                            id="installment1Amount"
                            name="installment1Amount"
                            type="number"
                            value={learnerData.installment1Amount}
                            onChange={handleInputChange}
                            min={0}
                            className="col-span-3"
                            onWheel={(e) => e.currentTarget.blur()}
                          />
                        </div>
                        <div className="grid grid-cols-4 items-center gap-4">
                          <Label
                            htmlFor="installment2Amount"
                            className="text-right"
                          >
                            2nd Payment (₹)
                          </Label>
                          <Input
                            id="installment2Amount"
                            name="installment2Amount"
                            type="number"
                            value={learnerData.installment2Amount}
                            className="col-span-3"
                            disabled
                          />
                        </div>
                      </>
                    )}
                  </>
                )}
                <div className="grid hidden grid-cols-4 items-center gap-4">
                  <Label htmlFor="unlockedLessons" className="text-right">
                    Unlocked Lessons
                  </Label>
                  <Input
                    id="unlockedLessons"
                    name="unlockedLessons"
                    type="number"
                    value="2"
                    onChange={(e) =>
                      handleUnlockedLessonsChange(e.target.value)
                    }
                    className="col-span-3"
                    placeholder={`Leave empty to unlock half the course`}
                  />
                </div>
                {caseType === "classes_only" && (
                  <>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="has_a_DL"
                        name="has_a_DL"
                        checked={learnerData.has_a_DL}
                        onChange={handleInputChange}
                      />
                      <Label htmlFor="has_a_DL">Has a 4-wheeler license</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id="has_two_wheeler_license"
                        name="has_two_wheeler_license"
                        checked={learnerData.has_two_wheeler_license}
                        onChange={handleInputChange}
                      />
                      <Label htmlFor="has_two_wheeler_license">
                        Has a 2-wheeler license, not 4-wheeler
                      </Label>
                    </div>
                  </>
                )}
                {caseType !== "classes_only" && (
                  <p className="text-center text-sm text-muted-foreground">
                    RTO payment processing is not supported yet. This saves the
                    learner and enrollment details, but no payment link will be
                    created or sent.
                  </p>
                )}
                <Button onClick={createLearnerAndEnrollment}>
                  Create Learner
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Dialog for Sending Payment Link */}
          <Dialog
            open={isPaymentDialogOpen}
            onOpenChange={setIsPaymentDialogOpen}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Payment Link</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <p>
                  Learner <strong>{learnerData.name}</strong> has been created
                  successfully. Would you like to send the payment link now?
                </p>
                <Button
                  onClick={() => {
                    if (!learnerData.enrollmentId) return;
                    const paymentAmount =
                      learnerData.installmentType === "installment"
                        ? learnerData.installment1Amount
                        : learnerData.amount;

                    sendPaymentLink(
                      {
                        id: createdLearnerId,
                        name: learnerData.name,
                        email: learnerData.email,
                        phone: learnerData.phone,
                      },
                      {
                        name: learnerData.courseName,
                        duration: totalLessons,
                      },
                      paymentAmount,
                      learnerData.installmentType,
                      learnerData.enrollmentId,
                      courseType,
                    );
                  }}
                  disabled={!learnerData.enrollmentId}
                >
                  Send Payment Link
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
