import { useMutation } from "@tanstack/react-query";
import { ArrowBigLeft, Delete, Pencil, RefreshCcw, Send } from "lucide-react";
import React, { useEffect, useState } from "react";

import { AdditionalServiceDialog } from "@/components/admin/learner/AdditionalServiceDialog";
import { EditPlanDialog } from "@/components/admin/learner/EditPlanDialog";
import {
  deleteLearnerCascade,
  getCourseName,
  getPayableAmount,
  sendEnrollmentPaymentLink,
} from "@/components/admin/learner/enrollmentActions";
import {
  CopyableId,
  displayPaymentId,
} from "@/components/admin/learner/paymentTrace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useCanSeeCustomerPhone } from "@/hooks/useCanSeeCustomerPhone";
import { supabase } from "@/lib/supabaseClient";
import { maskPhoneNumber } from "@/utils/phoneMasking";

export function IncompletePaymentsCard() {
  // Admins and super admins see the number; "user" accounts see it masked.
  const canSeeFullPhone = useCanSeeCustomerPhone();
  const showPhone = (phone: string | null | undefined) =>
    canSeeFullPhone ? (phone ?? "") : maskPhoneNumber(phone);
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
  // Dialogs shared with the Sales Dashboard (see components/admin/learner).
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

  // --- Edit plan + regenerate link (dialog shared with the Sales Dashboard) ---

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editDialogData, setEditDialogData] = useState<any>(null);

  // --- Additional service / top-up for the row's customer ---
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [serviceDialogLearner, setServiceDialogLearner] = useState<any>(null);

  const { toast } = useToast();

  const fetchIncompletePayments = async () => {
    setLoading(true);
    try {
      // Build the base query with a database-level filter for incomplete payments
      // (no payment yet, or a pending one).
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
        // No payment record yet, OR a payment that is still pending. Creating a
        // learner (create-learner-and-enrollment) attaches a pending payment, so
        // filtering on payment_id alone hid every newly created learner.
        .or("payment_id.is.null,payment_status.eq.pending");

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

  // Function to send payment link (shared with the Sales Dashboard)
  const sendPaymentLink = async (enrollment) => {
    setSendingPaymentLink((prev) => ({ ...prev, [enrollment.id]: true }));

    try {
      await sendEnrollmentPaymentLink(enrollment, toast);

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
      // enrollments, payments, the Learner row and the Admin row (shared with
      // the Sales Dashboard)
      await deleteLearnerCascade(learner_id, phone);
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
                                {showPhone(enrollment.Learner?.phone)}
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
                              {enrollment.payment?.id && (
                                <div className="mt-1">
                                  <CopyableId
                                    value={displayPaymentId(enrollment.payment)}
                                  />
                                </div>
                              )}
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
                                onClick={() => {
                                  setEditDialogData(enrollment);
                                  setEditDialogOpen(true);
                                }}
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
                                  setServiceDialogLearner(enrollment.Learner);
                                  setServiceDialogOpen(true);
                                }}
                                className="whitespace-nowrap"
                              >
                                <Send size={14} className="mr-1" />
                                Additional service
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
        <AdditionalServiceDialog
          open={serviceDialogOpen}
          onOpenChange={setServiceDialogOpen}
          learner={serviceDialogLearner}
          onDone={fetchIncompletePayments}
        />

        {/* Edit plan + regenerate link */}
        <EditPlanDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          enrollment={editDialogData}
          onSaved={fetchIncompletePayments}
        />
      </CardContent>
    </Card>
  );
}
