import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowBigLeft, Delete, Pencil, RefreshCcw, Send } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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

// Course catalogue offered when editing a plan — mirrors PREDEFINED_COURSES in
// LearnerManagement.tsx (the create-learner flow) so an edited plan offers the
// same packages a learner could have been created with. `duration` = lessons.
const PREDEFINED_COURSES: { id: string; name: string; duration: number }[] = [
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

type EditPlan = "full" | "half" | "custom";

export function IncompletePaymentsCard() {
  const [incompletePayments, setIncompletePayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingPaymentLink, setSendingPaymentLink] = useState<
    Record<string, boolean>
  >({});
  const [deleteLearnerRequests, setDeleteLearnerRequests] = useState<
    Record<string, boolean>
  >({});
  const [deleteLearnerConfirmedList, setDeleteLearnerConfirmedList] = useState<
    Record<string, boolean>
  >({});
  const [deleteLearnerProcessingList, setDeleteLearnerProcessingList] =
    useState<Record<string, boolean>>({});
  const [updatingPaidInfo, setUpdatingPaidInfo] = useState<
    Record<string, boolean>
  >({});
  const [addingPaidInfo, setAddingPaidInfo] = useState<Record<string, boolean>>(
    {},
  );
  const [paidInfoDialogOpen, setPaidInfoDialogOpen] = useState(false);
  const [paidInfoDialogData, setPaidInfoDialogData] = useState<any>(null);
  const [manualAmount, setManualAmount] = useState<number>(0);
  const [manualInstallment1, setManualInstallment1] = useState<number | null>(
    null,
  );
  const [manualInstallment2, setManualInstallment2] = useState<number | null>(
    null,
  );
  // const installmentType = manualInstallment1 && manualInstallment2 ? "full"

  // Search and pagination state
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const itemsPerPage = 20;

  const totalPages = Math.max(1, Math.ceil(totalCount / itemsPerPage));

  // Reset to page 1 when search query changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Fetch data when page or search changes
  React.useEffect(() => {
    fetchIncompletePayments();
  }, [currentPage, searchQuery]);

  // --- Edit plan + regenerate link (matches the "Plan & Link" editor, inline) ---

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDialogData, setEditDialogData] = useState<any>(null);
  const [editCourseId, setEditCourseId] = useState<string>("");
  const [editPlan, setEditPlan] = useState<EditPlan>("full");
  const [editTotalAmount, setEditTotalAmount] = useState<number>(0);
  const [editDueNow, setEditDueNow] = useState<number>(0);
  const [editSaving, setEditSaving] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const fetchIncompletePayments = async () => {
    setLoading(true);
    try {
      // Build the base query with database-level filter for NULL payment_id (most incomplete payments)
      // Note: This captures payments that haven't been created yet.
      // Failed payments (payment exists but status != completed) will need separate handling if needed.
      let query = supabase
        .from("enrollment")
        .select(
          `
          id,
          installment_mode,
          amount,
          installment1_amount,
          installment2_amount,
          payment_status,
          created_at,
          payment_id,
          learner_id,
          course_id,
          Learner!inner (
            id,
            name,
            phone,
            email
          ),
          Courses (
            id,
            name,
            duration
          ),
          payment (
            id,
            amount,
            installment_type,
            total_amount,
            status,
            updated_at,
            created_at,
            payment_type
          )
        `,
          { count: "exact" },
        )
        .is("payment_id", null); // Filter for enrollments without payment record

      // Apply search filter at database level if search query exists
      if (searchQuery.trim()) {
        // Search by Learner name only
        const searchPattern = `%${searchQuery}%`;
        query = query.ilike("Learner.name", searchPattern);
      }

      // Apply pagination at database level
      const from = (currentPage - 1) * itemsPerPage;
      const to = from + itemsPerPage - 1;

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) throw error;

      let incomplete = data || [];

      // For second_half installments, find the date of first_half payment completion
      const secondHalfEnrollments = incomplete.filter(
        (e) => e.installment_mode === "second_half",
      );

      // Get the first_half payment dates for learners with second_half installments
      if (secondHalfEnrollments.length > 0) {
        const learnerIds = secondHalfEnrollments.map((e) => e.learner_id);
        const courseIds = secondHalfEnrollments.map((e) => e.course_id);

        const { data: firstHalfPayments, error: firstHalfError } =
          await supabase
            .from("payment")
            .select(
              `
            id,
            learner_id,
            installment_type,
            status,
            created_at,
            updated_at
          `,
            )
            .in("learner_id", learnerIds)
            .eq("installment_type", "first_half")
            .eq("status", "completed");

        if (!firstHalfError && firstHalfPayments) {
          // Map the first_half payment dates to the corresponding second_half enrollments
          incomplete = incomplete.map((enrollment) => {
            if (enrollment.installment_mode === "second_half") {
              const firstHalfPayment = firstHalfPayments.find(
                (p) => p.learner_id === enrollment.learner_id,
              );

              if (firstHalfPayment) {
                return {
                  ...enrollment,
                  first_half_payment_date: firstHalfPayment.created_at,
                };
              }
            }
            return enrollment;
          });
        }
      }

      setIncompletePayments(incomplete);
      setTotalCount(count || 0);
    } catch (err) {
      console.error("Error fetching incomplete payments:", err);
      toast({
        title: "Error",
        description: "Failed to fetch incomplete payments",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Helper function to get course name - handles demo/custom enrollments
  const getCourseName = (enrollment) => {
    if (enrollment.Courses?.name) {
      return enrollment.Courses.name;
    }
    // Check payment_type for demo/custom enrollments
    const paymentType = enrollment.payment?.payment_type;
    if (paymentType === "demo") {
      return "Demo Class";
    }
    if (paymentType === "custom") {
      return "Custom Course";
    }
    return "Unknown";
  };

  // Helper function to determine payment status
  const getPaymentStatus = (enrollment) => {
    // console.log("Determining payment status for enrollment:", enrollment);
    if (
      enrollment.payment_id === null ||
      enrollment.payment === null ||
      enrollment.payment.status === null ||
      enrollment.payment.status.toLowerCase().includes("pending")
    ) {
      return "Payment pending";
    } else if (enrollment.payment_status === null) {
      return "Payment pending";
    } else if (
      enrollment.payment &&
      !["full_paid", "half_paid", "completed"].includes(
        enrollment.payment.status,
      )
    ) {
      return "Payment failed";
    }

    // the enrollment.payment_status contains full_paid, half_paid, etc.
    // payment.status = "completed" for successful payments
    return enrollment.payment_status;
  };

  // Helper function to determine payable amount
  const getPayableAmount = (enrollment) => {
    // console.log(
    //   "Calculating Payable amount for enrollment ",
    //   enrollment.installment_mode,
    //   enrollment.amount,
    //   enrollment.installment1_amount,
    //   enrollment.installment2_amount,
    // );

    // For demo/custom enrollments, amount may not be in enrollment record
    // Fall back to payment record amount
    const paymentAmount =
      enrollment.payment?.total_amount || enrollment.payment?.amount;

    if (enrollment.installment_mode === "full") {
      // when enrolment mode is full, installment1 and installment2 field might be 0
      // return amount directly, or fall back to payment amount
      return enrollment.amount || paymentAmount || 0;
    } else if (
      enrollment.installment_mode === "first_half" ||
      enrollment.installment_mode === "installment"
    ) {
      return enrollment.installment1_amount || paymentAmount || 0;
    } else if (enrollment.installment_mode === "second_half") {
      return enrollment.installment2_amount || paymentAmount || 0;
    } else {
      // For enrollments without installment_mode (e.g., demo), use payment amount
      return paymentAmount || enrollment.amount || 0;
    }
  };

  // Helper function to get the appropriate date based on installment type
  const getRelevantDate = (enrollment) => {
    if (
      enrollment.installment_mode === "second_half" &&
      enrollment.first_half_payment_date
    ) {
      return new Date(enrollment.first_half_payment_date);
    }
    return new Date(enrollment.created_at);
  };

  // Function to send payment link - based on LearnerManagement.tsx implementation
  const sendPaymentLink = async (enrollment) => {
    setSendingPaymentLink((prev) => ({ ...prev, [enrollment.id]: true }));
    console.log("Called send email");

    try {
      // Get the payment amount based on installment mode
      const paymentAmount = getPayableAmount(enrollment);

      // Get the installment mode (convert 'installment' to 'first_half' if needed)
      const installmentMode =
        enrollment.installment_mode === "installment"
          ? "first_half"
          : enrollment.installment_mode;

      // Create the payment link. For demo/topup enrollments (course_id null),
      // append the right type so PaymentPage prefills the demo/topup flow even
      // on deployments without the enrollment-based auto-detect fallback.
      const paymentType = enrollment.payment?.payment_type;
      let typeParam = "";
      if (paymentType === "demo") {
        typeParam = "&type=demo";
      } else if (paymentType === "topup") {
        const topupHours = Math.max(
          1,
          Math.round((enrollment.payment?.amount || 1) / 1),
        );
        typeParam = `&type=topup&hours=${topupHours}`;
      }
      const paymentLink = `https://inlane-web-app.vercel.app/payment?phone=${enrollment.Learner.phone}${typeParam}`;

      // Define the request body for email trigger.
      const courseName = getCourseName(enrollment);
      const bodyData = {
        learnerEmail: enrollment.Learner.email,
        learnerName: enrollment.Learner.name,
        course: courseName,
        amount: paymentAmount,
        paymentLink: paymentLink,
      };

      const { error: invokeError } = await supabase.functions.invoke(
        "send-payment-link-email",
        {
          body: bodyData,
        },
      );

      const { error: invokeError2 } = await supabase.functions.invoke(
        "send-message",
        {
          body: {
            message_type: "PAYMENT_LINK",
            learner_id: enrollment.Learner.id,
            enrollment_id: enrollment.id,
            course_name: courseName,
            payment_amount: paymentAmount,
            duration: enrollment.Courses?.duration || 1,
            payment_link: paymentLink,
          },
        },
      );

      if (invokeError) {
        console.error(invokeError);
        toast({
          title: "Failed to send email",
          description: `Failed to send link sent to ${enrollment.Learner.email}`,
        });
      } else {
        toast({
          title: "Success",
          description: `Payment link sent to ${enrollment.Learner.email} successfully!`,
        });
      }
      if (invokeError2) {
        console.error(invokeError2);
        toast({
          title: "Failed to send email",
          description: `Failed to send link sent to ${enrollment.Learner.phone}`,
        });
        throw invokeError2;
      } else {
        toast({
          title: "Success",
          description: `Payment link sent to ${enrollment.Learner.name} successfully!`,
        });
      }

      // Refresh the list after sending
      fetchIncompletePayments();
    } catch (err) {
      console.error("Error sending payment link:", err);
      toast({
        title: "Error",
        description: err.message || "Failed to send payment link",
        variant: "destructive",
      });
    } finally {
      setSendingPaymentLink((prev) => ({ ...prev, [enrollment.id]: false }));
    }
  };

  // const updatePaidInfo = async () => {
  //   if (!paidInfoDialogData) {
  //     console.log("No enrollment data available");
  //     return;
  //   }
  //   setUpdatingPaidInfo((prev) => ({ ...prev, [paidInfoDialogData.id]: true }));

  //   setManualAmount(0);
  //   setPaidInfoDialogOpen(true);
  // };

  const handleUpdatePaidInfoClose = () => {
    if (!paidInfoDialogData) {
      console.log("No enrollment data available");
      return;
    }
    console.log("Closing paid info dialog for enrollment:", paidInfoDialogData);
    setUpdatingPaidInfo((prev) => ({
      ...prev,
      [paidInfoDialogData?.id]: false,
    }));
    setPaidInfoDialogOpen(false);
    // setPaidInfoDialogData(null);
    // setManualAmount(0);
    console.log("updatingPaidInfo", updatingPaidInfo);
  };

  const useUpdateEnrollmentMutation = useMutation({
    mutationFn: async ({
      enrollmentId,
      updates,
    }: {
      enrollmentId: string;
      updates: Partial<any>;
    }) => {
      const { data, error } = await supabase
        .from("enrollment")
        .update(updates)
        .eq("id", enrollmentId);
      if (error) throw error;
      console.log("Updated installment info");
    },

    // Invalidate relevant queries upon successful completion
    onSuccess: (data, variables) => {
      // Invalidate the specific enrollment query to force a fresh fetch
      queryClient.invalidateQueries({
        queryKey: ["enrollment", variables.enrollmentId],
      });

      // Invalidate the generic list of enrollments if necessary
      queryClient.invalidateQueries({ queryKey: ["enrollments"] });

      // Note: The original send-message and toast logic is triggered
      // via the onSuccess callback passed when calling .mutate()
      // in the component's handleUpdatePaidInfoSave function.
    },

    onError: (error) => {
      // Optional: Log or handle global mutation errors here
      console.error("Mutation failed:", error);
    },
  });
  const handleUpdatePaidInfoSave = async () => {
    // The steps should be same as process-payment
    // learner and enrollment are added,
    // payment to be added and enrollment to be updated
    if (!paidInfoDialogData) {
      toast({
        title: "Error",
        description: "No enrollment data available",
        variant: "destructive",
      });
      return;
    }
    try {
      console.log(
        `Saving amount for learner: ${paidInfoDialogData?.Learner?.name}`,
      );

      // Determine payment status based on which installments are paid
      // If both installments paid OR if it's full payment mode -> full_paid
      // If only first installment paid -> half_paid
      const isFullPayment = paidInfoDialogData?.installment_mode === "full";
      const bothInstallmentsPaid = manualInstallment1 && manualInstallment2;
      const paymentStatus =
        isFullPayment || bothInstallmentsPaid ? "full_paid" : "half_paid";

      // Calculate the amount being paid
      const paidAmount = (manualInstallment1 || 0) + (manualInstallment2 || 0);

      // Determine installment_type for payment record
      let installmentType = "full";
      if (!isFullPayment) {
        if (manualInstallment1 && !manualInstallment2) {
          installmentType = "first_half";
        } else if (manualInstallment1 && manualInstallment2) {
          installmentType = "full";
        }
      }

      // 1. Make payment record with "completed" status to match automatic payment flow
      // The enrollment.payment_status tracks full_paid vs half_paid for installments
      const { data: paymentRecord, error: dbError } = await supabase
        .from("payment")
        .insert([
          {
            learner_id: paidInfoDialogData?.Learner?.id,
            amount: paidAmount,
            total_amount: paidInfoDialogData?.amount || paidAmount,
            email: paidInfoDialogData?.Learner?.email,
            phone: paidInfoDialogData?.Learner?.phone,
            payment_type: "course",
            status: "completed",
            name: paidInfoDialogData?.Learner?.name,
            installment_type: installmentType,
            installment1_amount: paidInfoDialogData?.installment1_amount,
            installment2_amount: paidInfoDialogData?.installment2_amount,
          },
        ])
        .select()
        .single();

      if (dbError) throw new Error("Failed to record payment.");

      // 2. Update Enrollment status - IMPORTANT: Also update payment_status
      await useUpdateEnrollmentMutation.mutateAsync({
        enrollmentId: paidInfoDialogData.id,
        updates: {
          amount: paidInfoDialogData?.amount || paidAmount,
          payment_id: paymentRecord.id,
          status: "active",
          payment_status: paymentStatus, // This was missing!
          installment_mode:
            paymentStatus === "full_paid" ? "full" : "first_half",
          installment1_amount: paidInfoDialogData?.installment1_amount,
          installment2_amount: paidInfoDialogData?.installment2_amount,
        },
      });

      // 3. Send message
      await supabase.functions.invoke("send-message", {
        body: {
          message_type: "LL_APPLICATION_UPDATE",
          learner_id: paidInfoDialogData?.Learner?.id,
        },
      });

      // Todo: send different email for LL received
      // await sendAdminEmail(...)

      // 4. Show success toast
      toast({
        title: "Success",
        description: `Payment marked as ${paymentStatus}. Enrollment updated.`,
      });

      // 5. Close dialog and refresh list
      handleUpdatePaidInfoClose();
      setManualInstallment1(null);
      setManualInstallment2(null);
      fetchIncompletePayments();
    } catch (error) {
      console.error("Payment and Enrollment Save Error:", error);
      toast({
        title: "Error Saving Data",
        description:
          error.message ||
          "An unexpected error occurred during the save process.",
        variant: "destructive",
      });
    }
  };

  // Prefill the edit dialog from the enrollment's current plan.
  const openEditDialog = (enrollment: any) => {
    const i1 = enrollment.installment1_amount ?? 0;
    const i2 = enrollment.installment2_amount ?? 0;

    let plan: EditPlan;
    if (enrollment.installment_mode === "full" || i2 === 0) {
      plan = "full";
    } else if (Math.abs(i1 - i2) <= 1) {
      plan = "half";
    } else {
      plan = "custom";
    }

    const total =
      enrollment.amount || i1 + i2 || getPayableAmount(enrollment) || 0;

    // Only preselect the course if it matches a known package; demo/custom
    // (course_id null) start blank so the admin can assign a real package.
    const knownCourseId = PREDEFINED_COURSES.some(
      (c) => c.id === enrollment.course_id,
    )
      ? enrollment.course_id
      : "";

    setEditDialogData(enrollment);
    setEditCourseId(knownCourseId);
    setEditPlan(plan);
    setEditTotalAmount(total);
    setEditDueNow(i1 || getPayableAmount(enrollment) || 0);
    setEditDialogOpen(true);
  };

  // Derive the installment split from the chosen plan (mirrors the create flow).
  const editAmounts = (() => {
    const total = Number(editTotalAmount) || 0;
    const dueNow =
      editPlan === "full"
        ? total
        : editPlan === "half"
          ? Math.round(total / 2)
          : Number(editDueNow) || 0;
    const second = Math.max(0, total - dueNow);
    return { total, dueNow, second };
  })();

  const handleEditSave = async () => {
    if (!editDialogData) return;
    const { total, dueNow, second } = editAmounts;

    if (total < 1 || dueNow < 1) {
      toast({
        title: "Invalid amount",
        description: "Total and amount due now must be at least ₹1.",
        variant: "destructive",
      });
      return;
    }

    setEditSaving(true);
    try {
      const selectedCourse = PREDEFINED_COURSES.find(
        (c) => c.id === editCourseId,
      );

      // Update the enrollment in place — no new learner/enrollment row is
      // created, so the same deterministic phone payment link keeps working and
      // now reflects the new amount.
      const updates: Partial<any> = {
        amount: total,
        installment_mode: editPlan === "full" ? "full" : "installment",
        installment1_amount: dueNow,
        installment2_amount: second,
      };
      if (editCourseId) {
        updates.course_id = editCourseId;
        if (selectedCourse) {
          updates.progress = {
            type: "course",
            total_hours: selectedCourse.duration,
          };
        }
      }

      await useUpdateEnrollmentMutation.mutateAsync({
        enrollmentId: editDialogData.id,
        updates,
      });

      // Re-send the payment link with the updated plan. sendPaymentLink reads
      // the (updated) enrollment for amount + course, so build a merged copy.
      const updatedEnrollment = {
        ...editDialogData,
        ...updates,
        Courses: selectedCourse
          ? {
              id: selectedCourse.id,
              name: selectedCourse.name,
              duration: selectedCourse.duration,
            }
          : editDialogData.Courses,
      };

      setEditDialogOpen(false);
      setEditDialogData(null);

      await sendPaymentLink(updatedEnrollment);
    } catch (error: any) {
      console.error("Edit plan save error:", error);
      toast({
        title: "Update failed",
        description:
          error?.message || "Could not update the plan. No changes saved.",
        variant: "destructive",
      });
    } finally {
      setEditSaving(false);
    }
  };

  // Delete button
  // Defined at top, here for ref
  // const [deleteLearnerRequests, setDeleteLearnerRequests] = useState({});
  // const [deleteLearnerConfirmedList, setDeleteLearnerConfirmedList] = useState({});
  // const [deleteLearnerProcessingList, setDeleteLearnerProcessingList] = useState({});

  // type DeleteRequestIdToFlagsMap = Record<string, boolean>;
  // const [isDeleteRequestedList, setIsDeleteRequestedList] = useState<DeleteRequestIdToFlagsMap>({});
  // const [isDeleteRequestedList, setIsDeleteRequestedList] = useState({});

  // UseMutation hook for the delete operation
  const deleteLearnerMutation = useMutation({
    mutationFn: async ({ learner_id, phone }) => {
      // remove from auth before regular tables
      // call edge function as auth cannot be accessed from frontend

      // auth requires phone , but only learner_id available

      // remove from dependent tables
      // remove from enrollment
      const { error: enrollmentDeleteerror } = await supabase
        .from("enrollment")
        .delete()
        .eq("learner_id", learner_id);

      if (enrollmentDeleteerror) {
        throw new Error("Failed to delete the enrollment record.");
      }
      console.log("Deleted enrollment records for learner ", learner_id);
      // remove from learner
      // remove from payment
      const { error: paymentDeleteerror } = await supabase
        .from("payment")
        .delete()
        .eq("learner_id", learner_id);

      if (paymentDeleteerror) {
        throw new Error("Failed to delete the payment record.");
      }
      console.log("Deleted payment records for learner ", learner_id);
      const { error: learnerDeleteError } = await supabase
        .from("Learner")
        .delete()
        .eq("id", learner_id);

      if (learnerDeleteError) {
        throw new Error("Failed to delete the learner record.");
      }
      console.log("Deleted learner records for learner ", learner_id);

      // Optional: remove from Admin, should not be required if learner does not get added
      // to Admin after signup
      if (phone) {
        const { error: adminDeleteerror } = await supabase
          .from("Admin")
          .delete()
          .eq("phone", phone);
        if (adminDeleteerror) {
          throw new Error("Failed to delete the Admin record.");
        }
        console.log("Deleted Admin records for learner ", phone);
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Deleted learner. Hit refresh ↻ to delete the learner",
      });
      // setItems(prevItems => prevItems.filter(item => item.id !== variables));
      // queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onSettled: () => {
      // Remove the ID from the set when the mutation is complete
      setDeleteLearnerProcessingList({
        ...deleteLearnerProcessingList,
        [learner_id]: false,
      });
      setDeleteLearnerRequests({
        ...deleteLearnerRequests,
        [learner_id]: false,
      });
    },
  });

  const handleDeleteLearnerRequest = (learner_id: string) => {
    setDeleteLearnerRequests({ ...deleteLearnerRequests, [learner_id]: true });
    console.log("Request", learner_id, deleteLearnerRequests[learner_id]);
  };

  const handleDeleteLearnerConfirm = async (
    learner_id: string,
    phone: string,
  ) => {
    console.log("Removing learner", learner_id, phone);

    if (!learner_id || !phone) {
      console.error("Learner ID cannot be empty.");
      return;
    }

    if (!deleteLearnerRequests[learner_id]) {
      console.error(learner_id + "not requested for delete but it's confirmed");
      return;
    }
    console.log("Confirm", learner_id, deleteLearnerRequests[learner_id]);
    setDeleteLearnerProcessingList({
      ...deleteLearnerProcessingList,
      [learner_id]: true,
    });

    await deleteLearnerMutation.mutate({ learner_id, phone }); // Note that mutationFn only accepts single arg

    setDeleteLearnerProcessingList({
      ...deleteLearnerProcessingList,
      [learner_id]: false,
    });
    setDeleteLearnerRequests({ ...deleteLearnerRequests, [learner_id]: false });
    return;
  };

  const handleDeleteLearnerCancel = (learner_id: string) => {
    setDeleteLearnerRequests({ ...deleteLearnerRequests, [learner_id]: false });
    console.log("Cancel", learner_id, deleteLearnerRequests[learner_id]);
  };

  return (
    <Card className="mt-6 transition-all hover:shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-1 items-center gap-4">
          <CardTitle className="text-xl">Incomplete Payments</CardTitle>
          <Input
            type="text"
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={fetchIncompletePayments}
          disabled={loading}
        >
          <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
        </Button>
      </CardHeader>
      <CardContent>
        {incompletePayments.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            {loading ? "Loading payments..." : "No incomplete payments found"}
          </p>
        ) : (
          <>
            {incompletePayments.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">
                No payments found matching your search.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="px-2 py-2 text-left">Learner</th>
                        <th className="px-2 py-2 text-left">Course</th>
                        <th className="px-2 py-2 text-left">Payment Type</th>
                        <th className="px-2 py-2 text-right">Payable Amount</th>
                        <th className="px-2 py-2 text-center">Status</th>
                        <th className="px-2 py-2 text-right">
                          {/* Column header that explains the date meaning */}
                          Created Date
                        </th>
                        <th className="px-2 py-2 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incompletePayments
                        .sort((a, b) => {
                          // Use the existing getRelevantDate function
                          const dateA = getRelevantDate(a);
                          const dateB = getRelevantDate(b);

                          // Sort in descending order (newest first)
                          return dateB - dateA;
                        })
                        .map((enrollment) => (
                          <tr
                            key={enrollment.id}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="px-2 py-2">
                              <div className="font-medium">
                                {enrollment.Learner?.name || "Unknown"}
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {enrollment.Learner?.phone}
                              </div>
                            </td>
                            <td className="px-2 py-2">
                              {getCourseName(enrollment)}
                            </td>
                            <td className="px-2 py-2">
                              {enrollment.installment_mode === "installment"
                                ? "first_half"
                                : enrollment.installment_mode}
                            </td>
                            <td className="px-2 py-2 text-right">
                              ₹{getPayableAmount(enrollment)?.toLocaleString()}
                            </td>
                            <td className="px-2 py-2 text-center">
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`}
                              >
                                {getPaymentStatus(enrollment)}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-2 text-right">
                              {/* Show date with tooltip explaining what it represents */}
                              <div className="group relative">
                                <span>
                                  {new Intl.DateTimeFormat("en-GB", {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                  }).format(getRelevantDate(enrollment))}
                                </span>
                                <span className="invisible absolute -top-8 left-0 z-10 w-48 whitespace-normal rounded bg-black p-1 text-xs text-white group-hover:visible">
                                  {enrollment.installment_mode === "second_half"
                                    ? "Date when first installment was completed"
                                    : "Enrollment creation date"}
                                </span>
                              </div>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => sendPaymentLink(enrollment)}
                                disabled={sendingPaymentLink[enrollment.id]}
                                className="whitespace-nowrap"
                              >
                                {sendingPaymentLink[enrollment.id] ? (
                                  <RefreshCcw
                                    size={14}
                                    className="mr-1 animate-spin"
                                  />
                                ) : (
                                  <Send size={14} className="mr-1" />
                                )}
                                Send Payment Link
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openEditDialog(enrollment)}
                                className="whitespace-nowrap"
                              >
                                <Pencil size={14} className="mr-1" />
                                Edit
                              </Button>
                              {deleteLearnerRequests[enrollment.learner_id] ? (
                                <>
                                  {/* Request phase confirmation pending */}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    // onClick={() => setShowDeleteDialog(true); enrollment.learner_id)}
                                    onClick={() =>
                                      handleDeleteLearnerConfirm(
                                        enrollment.learner_id,
                                        enrollment.Learner.phone,
                                      )
                                    }
                                    disabled={
                                      deleteLearnerProcessingList[
                                        enrollment.learner_id
                                      ]
                                    }
                                    className="whitespace-nowrap"
                                  >
                                    {deleteLearnerProcessingList[
                                      enrollment.learner_id
                                    ] ? (
                                      <RefreshCcw
                                        size={14}
                                        className="mr-1 animate-spin"
                                      />
                                    ) : (
                                      <Delete size={14} className="mr-1" />
                                    )}
                                    Confirm
                                  </Button>

                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleDeleteLearnerCancel(
                                        enrollment.learner_id,
                                      )
                                    }
                                    disabled={
                                      deleteLearnerProcessingList[
                                        enrollment.learner_id
                                      ]
                                    }
                                    className="whitespace-nowrap"
                                  >
                                    {deleteLearnerProcessingList[
                                      enrollment.learner_id
                                    ] ? (
                                      <RefreshCcw
                                        size={14}
                                        className="mr-1 animate-spin"
                                      />
                                    ) : (
                                      <ArrowBigLeft
                                        size={14}
                                        className="mr-1"
                                      />
                                    )}
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    handleDeleteLearnerRequest(
                                      enrollment.learner_id,
                                    )
                                  }
                                  disabled={
                                    deleteLearnerProcessingList[
                                      enrollment.learner_id
                                    ]
                                  }
                                  className="whitespace-nowrap"
                                >
                                  {deleteLearnerProcessingList[
                                    enrollment.learner_id
                                  ] ? (
                                    <RefreshCcw
                                      size={14}
                                      className="mr-1 animate-spin"
                                    />
                                  ) : (
                                    <Delete size={14} className="mr-1" />
                                  )}
                                  Delete
                                </Button>
                              )}

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setPaidInfoDialogData(enrollment);
                                  setPaidInfoDialogOpen(true);
                                }}
                                disabled={updatingPaidInfo[enrollment?.id]}
                                className="whitespace-nowrap"
                              >
                                {updatingPaidInfo[enrollment?.id] ? (
                                  <RefreshCcw
                                    size={14}
                                    className="mr-1 animate-spin"
                                  />
                                ) : (
                                  <Send size={14} className="mr-1" />
                                )}
                                Add paid info
                              </Button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing{" "}
                    {Math.min((currentPage - 1) * itemsPerPage + 1, totalCount)}{" "}
                    to {Math.min(currentPage * itemsPerPage, totalCount)} of{" "}
                    {totalCount} results
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                      }
                      disabled={currentPage === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
        <Dialog open={paidInfoDialogOpen} onOpenChange={setPaidInfoDialogOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Enter Paid Installments</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="installment1-paid"
                  // The checkbox is checked if manualInstallment1 is truthy (contains the amount)
                  checked={!!manualInstallment1}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    // If checked is true, set the amount; otherwise set to null.
                    setManualInstallment1(
                      checked ? paidInfoDialogData?.installment1_amount : null,
                    );
                  }}
                />
                {/* Using the provided 'Label' component */}
                <Label htmlFor="installment1-paid">
                  Installment 1 (Amount:{" "}
                  {paidInfoDialogData?.installment1_amount ?? 0})
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="installment2-paid"
                  // FIX: Disable this checkbox if manualInstallment1 is not yet set (null/0/false)
                  disabled={!manualInstallment1}
                  // The checkbox is checked if manualInstallment2 is truthy (contains the amount)
                  checked={!!manualInstallment2}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    // If checked is true, set the amount; otherwise set to null.
                    setManualInstallment2(
                      checked ? paidInfoDialogData?.installment2_amount : null,
                    );
                  }}
                />
                {/* Using the provided 'Label' component */}
                <Label
                  htmlFor="installment2-paid"
                  // Optional: Add a class to visually indicate disabled state on the label (e.g., lower opacity)
                  className={!manualInstallment1 ? "opacity-50" : ""}
                >
                  Installment 2 (Amount:{" "}
                  {paidInfoDialogData?.installment2_amount ?? 0})
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleUpdatePaidInfoClose} variant="secondary">
                Cancel
              </Button>
              <Button onClick={handleUpdatePaidInfoSave}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit plan + regenerate link */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>
                Edit plan — {editDialogData?.Learner?.name || "Learner"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="rounded-lg border bg-gray-50 p-3 text-sm">
                <span className="text-muted-foreground">
                  Phone (login ID, cannot be changed):{" "}
                </span>
                <span className="font-medium">
                  {editDialogData?.Learner?.phone || "N/A"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Course / Package
                  </Label>
                  <Select value={editCourseId} onValueChange={setEditCourseId}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREDEFINED_COURSES.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.duration} lessons)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Payment Plan</Label>
                  <Select
                    value={editPlan}
                    onValueChange={(v) => setEditPlan(v as EditPlan)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full payment</SelectItem>
                      <SelectItem value="half">Half (50:50)</SelectItem>
                      <SelectItem value="custom">Custom amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Total Amount (₹)
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    value={editTotalAmount || ""}
                    onChange={(e) => setEditTotalAmount(Number(e.target.value))}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">
                    Amount Due Now (₹)
                  </Label>
                  {editPlan === "custom" ? (
                    <Input
                      type="number"
                      min={1}
                      value={editDueNow || ""}
                      onChange={(e) => setEditDueNow(Number(e.target.value))}
                      className="h-9 text-sm"
                    />
                  ) : (
                    <div className="flex h-9 items-center rounded-md border bg-gray-50 px-3 text-sm text-muted-foreground">
                      ₹{editAmounts.dueNow}
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Second installment: ₹{editAmounts.second}
                  </p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Saving updates this learner's enrollment (no duplicate is
                created) and re-sends the payment link by email + WhatsApp/SMS.
              </p>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setEditDialogOpen(false)}
                variant="secondary"
                disabled={editSaving}
              >
                Cancel
              </Button>
              <Button onClick={handleEditSave} disabled={editSaving}>
                {editSaving ? (
                  <RefreshCcw size={14} className="mr-1 animate-spin" />
                ) : (
                  <Send size={14} className="mr-1" />
                )}
                {editSaving ? "Saving..." : "Save & Resend Link"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
