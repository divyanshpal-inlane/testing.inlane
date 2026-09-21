import { formatDistanceToNow } from "date-fns";
import { RefreshCcw } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";

interface HalfPaidEnrollment {
  id: string;
  amount: number;
  installment1_amount: number;
  installment2_amount: number;
  payment_status: string;
  created_at: string;
  learner_id: string;
  Learner: {
    id: string;
    name: string;
    phone: string;
    email: string;
  } | null;
  Courses: {
    id: string;
    name: string;
    duration: number;
  } | null;
  payment: {
    id: string;
    amount: number;
    status: string;
    created_at: string;
    updated_at: string;
    installment_type: string;
  } | null;
}

export function HalfPaidTracker() {
  const [enrollments, setEnrollments] = useState<HalfPaidEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

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
    fetchHalfPaidEnrollments();
  }, [currentPage, searchQuery]);

  const fetchHalfPaidEnrollments = async () => {
    setLoading(true);
    try {
      // Build the base query
      let query = supabase
        .from("enrollment")
        .select(
          `
          id,
          amount,
          installment1_amount,
          installment2_amount,
          payment_status,
          created_at,
          learner_id,
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
            status,
            created_at,
            updated_at,
            installment_type
          )
        `,
          { count: "exact" },
        )
        .eq("payment_status", "half_paid");

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
      setEnrollments((data as unknown as HalfPaidEnrollment[]) || []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error("Error fetching half-paid enrollments:", err);
      toast({
        title: "Error",
        description: "Failed to fetch half-paid enrollments",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getFirstPaymentDate = (
    enrollment: HalfPaidEnrollment,
  ): string | null => {
    if (
      enrollment.payment?.status === "completed" &&
      enrollment.payment?.updated_at
    ) {
      return enrollment.payment.updated_at;
    }
    if (enrollment.payment?.created_at) {
      return enrollment.payment.created_at;
    }
    return enrollment.created_at;
  };

  const getDaysSince = (dateStr: string | null): string => {
    if (!dateStr) return "Unknown";
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
  };

  const getBalanceDue = (enrollment: HalfPaidEnrollment): number => {
    if (enrollment.installment2_amount) {
      return enrollment.installment2_amount;
    }
    // Fallback: total minus what was paid
    const paid =
      enrollment.installment1_amount || enrollment.payment?.amount || 0;
    return (enrollment.amount || 0) - paid;
  };

  const getAmountPaid = (enrollment: HalfPaidEnrollment): number => {
    return enrollment.installment1_amount || enrollment.payment?.amount || 0;
  };

  const totalOutstanding = enrollments.reduce(
    (sum, e) => sum + getBalanceDue(e),
    0,
  );

  return (
    <Card className="mt-6 transition-all hover:shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center gap-4">
            <CardTitle className="text-xl">50% Payment Tracker</CardTitle>
            <Input
              type="text"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-md"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Learners who paid first installment — pending second half
          </p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={fetchHalfPaidEnrollments}
          disabled={loading}
        >
          <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-4 text-center text-muted-foreground">Loading...</p>
        ) : enrollments.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            No learners with pending second installment
          </p>
        ) : enrollments.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            No enrollments found matching your search.
          </p>
        ) : (
          <>
            {/* Summary stats */}
            <div className="mb-4 flex flex-wrap gap-3">
              <Badge variant="secondary" className="text-sm">
                {totalCount} learner
                {totalCount !== 1 ? "s" : ""}
              </Badge>
              <Badge variant="outline" className="text-sm">
                Total outstanding: ₹{totalOutstanding.toLocaleString()}
              </Badge>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                      Learner
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                      Course
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase">
                      Paid
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase">
                      Balance Due
                    </th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase">
                      Total
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                      Paid On
                    </th>
                    <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                      Time Since
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((enrollment) => {
                    const paymentDate = getFirstPaymentDate(enrollment);
                    const daysSince = getDaysSince(paymentDate);
                    const balanceDue = getBalanceDue(enrollment);
                    const amountPaid = getAmountPaid(enrollment);

                    return (
                      <tr
                        key={enrollment.id}
                        className="border-b hover:bg-muted/50"
                      >
                        <td className="px-2 py-2">
                          <div className="font-medium">
                            {enrollment.Learner?.name || "Unknown"}
                          </div>
                          <div className="text-xs text-gray-500">
                            {enrollment.Learner?.phone || ""}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-sm">
                          {enrollment.Courses?.name || "Unknown"}
                        </td>
                        <td className="px-2 py-2 text-right text-sm font-medium text-green-600">
                          ₹{amountPaid.toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right text-sm font-medium text-red-600">
                          ₹{balanceDue.toLocaleString()}
                        </td>
                        <td className="px-2 py-2 text-right text-sm">
                          ₹{(enrollment.amount || 0).toLocaleString()}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-sm">
                          {paymentDate
                            ? new Date(paymentDate).toLocaleDateString(
                                "en-IN",
                                {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                },
                              )
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-sm">
                          <Badge
                            variant={
                              paymentDate &&
                              Date.now() - new Date(paymentDate).getTime() >
                                14 * 24 * 60 * 60 * 1000
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {daysSince}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {enrollments.length > 0 && (
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
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
