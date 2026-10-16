import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  CreditCard,
  IndianRupee,
  Loader2,
  RefreshCcw,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";

interface EnrollmentRow {
  id: string;
  completed_count: number;
  amount: number;
  installment1_amount: number;
  installment2_amount: number;
  payment_status: string;
  unlocked_lessons: number[] | null;
  created_at: string;
  learner_id: string;
  status: string;
  progress: {
    type?: string;
    total_hours?: number;
    completed_lessons?: number[];
    [key: string]: unknown;
  } | null;
  Learner: {
    id: string;
    name: string;
    phone: string;
  } | null;
  Courses: {
    id: string;
    name: string;
    duration: number;
    total_lessons: number;
  } | null;
  payment: {
    id: string;
    amount: number;
    status: string;
    created_at: string;
    updated_at: string;
    installment_type: string;
    payment_type: string;
  } | null;
}

interface TopupRow {
  learner_id: string;
  learner_name: string;
  learner_phone: string;
  totalSlots: number;
  dates: string[];
  isPaid: boolean;
  paymentDate: string | null;
}

type PaymentTab = "half_paid" | "full_paid" | "pending" | "topup";

interface PaymentTrackerData {
  tab: PaymentTab;
  enrollments: EnrollmentRow[];
  topups: TopupRow[];
  courseNames: string[];
  counts: Record<PaymentTab, number>;
  totalOutstanding: number;
  totalRevenue: number;
  pendingAmount: number;
  urgentCount: number;
  topupPaidCount: number;
  topupUnpaidCount: number;
}

const PAGE_SIZE = 10;

export default function PaymentTracker() {
  const [activeTab, setActiveTab] = useState<PaymentTab>("half_paid");
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");
  const { toast } = useToast();
  const navigate = useNavigate();

  const {
    data,
    isLoading,
    isFetching: loading,
    isPlaceholderData,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "payment-tracker",
      activeTab,
      page,
      searchTerm,
      courseFilter,
      urgencyFilter,
    ],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase
        .rpc("get_payment_tracker_page", {
          p_tab: activeTab,
          p_page: page,
          p_search: searchTerm,
          p_course: courseFilter,
          p_urgency: urgencyFilter,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as unknown as PaymentTrackerData;
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
  });

  const counts = data?.counts ?? {
    half_paid: 0,
    full_paid: 0,
    pending: 0,
    topup: 0,
  };
  const totalCount = counts[activeTab];
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const enrollments = data?.tab === activeTab ? data.enrollments : [];
  const sortedHalfPaid = activeTab === "half_paid" ? enrollments : [];
  const fullPaid = activeTab === "full_paid" ? enrollments : [];
  const pending = activeTab === "pending" ? enrollments : [];
  const filteredTopups = data?.tab === activeTab ? data.topups : [];
  const courseNames = data?.courseNames ?? [];
  const totalOutstanding = data?.totalOutstanding ?? 0;
  const totalRevenue = data?.totalRevenue ?? 0;
  const pendingAmount = data?.pendingAmount ?? 0;
  const urgentCount = data?.urgentCount ?? 0;
  const displayedTotal = counts.half_paid + counts.full_paid + counts.pending;

  useEffect(() => {
    if (data && !isPlaceholderData && page > totalPages) setPage(totalPages);
  }, [data, isPlaceholderData, page, totalPages]);

  useEffect(() => {
    if (!error) return;
    console.error("Error fetching payment data:", error);
    toast({
      title: "Error",
      description: "Failed to fetch payment data",
      variant: "destructive",
    });
  }, [error, toast]);

  // Helpers
  const getTotalLessons = (e: EnrollmentRow): number => {
    return (
      e.Courses?.total_lessons ||
      e.Courses?.duration ||
      e.progress?.total_hours ||
      10
    );
  };

  const getUnlockedCount = (e: EnrollmentRow): number => {
    if (e.unlocked_lessons && e.unlocked_lessons.length > 0) {
      return e.unlocked_lessons.length;
    }
    // Fallback: if unlocked_lessons is null, estimate from payment status
    const total = getTotalLessons(e);
    if (e.payment_status === "full_paid" || e.payment_status === "completed") {
      return total;
    }
    if (e.payment_status === "half_paid") {
      // Match the half-payment unlock formula: total-2 for 4+, 1 for 2hr
      if (total <= 2) return 1;
      return total - 2;
    }
    return total; // pending/other — assume all unlocked
  };

  const getCompletedCount = (e: EnrollmentRow): number => {
    return e.completed_count || 0;
  };

  const getRemaining = (e: EnrollmentRow): number => {
    return Math.max(0, getUnlockedCount(e) - getCompletedCount(e));
  };

  const getCourseName = (e: EnrollmentRow): string => {
    if (e.Courses?.name) return e.Courses.name;
    const type = e.progress?.type;
    if (type === "demo") return "Demo";
    if (type === "custom")
      return `Custom (${e.progress?.total_hours || "?"}hr)`;
    return "Unknown";
  };

  const getPaymentDate = (e: EnrollmentRow): string | null => {
    if (e.payment?.status === "completed" && e.payment?.updated_at) {
      return e.payment.updated_at;
    }
    return e.payment?.created_at || e.created_at;
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const getAmountPaid = (e: EnrollmentRow): number => {
    if (e.payment_status === "full_paid") {
      return e.amount || e.payment?.amount || 0;
    }
    return e.installment1_amount || e.payment?.amount || 0;
  };

  const getBalanceDue = (e: EnrollmentRow): number => {
    if (e.installment2_amount) return e.installment2_amount;
    const paid = e.installment1_amount || e.payment?.amount || 0;
    return Math.max(0, (e.amount || 0) - paid);
  };

  const getUrgency = (
    remaining: number,
  ): { label: string; variant: "destructive" | "secondary" | "outline" } => {
    if (remaining <= 1) return { label: "Urgent", variant: "destructive" };
    if (remaining === 2) return { label: "Soon", variant: "secondary" };
    return { label: "OK", variant: "outline" };
  };

  const paginationControls = (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p
        className="text-sm text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        Page {page} of {totalPages} ({totalCount} records)
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={loading || page <= 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || page >= totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Payment Tracker</h1>
            <p className="text-sm text-muted-foreground">
              Track payments, lesson progress, and follow-up urgency
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={loading}
          >
            <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>

        {/* Search & Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search by name or phone..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select
            value={courseFilter}
            onValueChange={(value) => {
              setCourseFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All Courses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Courses</SelectItem>
              {courseNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={urgencyFilter}
            onValueChange={(value) => {
              setUrgencyFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Urgency" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Urgency</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="soon">Soon</SelectItem>
              <SelectItem value="ok">OK</SelectItem>
            </SelectContent>
          </Select>
          {(searchTerm ||
            courseFilter !== "all" ||
            urgencyFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchTerm("");
                setCourseFilter("all");
                setUrgencyFilter("all");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {/* Summary Cards */}
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-blue-100 p-2">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Enrolled</p>
                <p className="text-xl font-bold">{displayedTotal}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-green-100 p-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Full Paid</p>
                <p className="text-xl font-bold">{counts.full_paid}</p>
                <p className="text-xs text-green-600">
                  {totalRevenue > 0 && `₹${totalRevenue.toLocaleString()}`}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-orange-100 p-2">
                <IndianRupee className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Half Paid</p>
                <p className="text-xl font-bold">{counts.half_paid}</p>
                <p className="text-xs text-red-600">
                  {totalOutstanding > 0 &&
                    `₹${totalOutstanding.toLocaleString()} due`}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-yellow-100 p-2">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-xl font-bold">{counts.pending}</p>
                <p className="text-xs text-yellow-600">
                  {pendingAmount > 0 && `₹${pendingAmount.toLocaleString()}`}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-lg bg-red-100 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">
                  Urgent Follow-up
                </p>
                <p className="text-xl font-bold">{urgentCount}</p>
                <p className="text-xs text-muted-foreground">
                  {urgentCount > 0 ? "sessions almost exhausted" : "all good"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabbed Tables */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as PaymentTab);
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="half_paid">
              Half Paid ({counts.half_paid})
            </TabsTrigger>
            <TabsTrigger value="full_paid">
              Full Paid ({counts.full_paid})
            </TabsTrigger>
            <TabsTrigger value="pending">
              Pending ({counts.pending})
            </TabsTrigger>
            <TabsTrigger value="topup">Topup ({counts.topup})</TabsTrigger>
          </TabsList>

          {/* Half Paid Tab */}
          <TabsContent value="half_paid">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CreditCard className="h-5 w-5" />
                  50% Payment - Pending Second Installment
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sortedHalfPaid.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">
                    No half-paid learners
                  </p>
                ) : (
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
                            Balance
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Unlocked
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Done
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Left
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                            Paid On
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Urgency
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedHalfPaid.map((enrollment) => {
                          const total = getTotalLessons(enrollment);
                          const unlocked = getUnlockedCount(enrollment);
                          const completed = getCompletedCount(enrollment);
                          const remaining = getRemaining(enrollment);
                          const urgency = getUrgency(remaining);
                          const paymentDate = getPaymentDate(enrollment);

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
                                {getCourseName(enrollment)}
                                <div className="text-xs text-gray-400">
                                  {total}hr total
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right text-sm font-medium text-green-600">
                                ₹{getAmountPaid(enrollment).toLocaleString()}
                              </td>
                              <td className="px-2 py-2 text-right text-sm font-medium text-red-600">
                                ₹{getBalanceDue(enrollment).toLocaleString()}
                              </td>
                              <td className="px-2 py-2 text-center text-sm">
                                {unlocked}/{total}
                              </td>
                              <td className="px-2 py-2 text-center text-sm font-medium">
                                {completed}
                              </td>
                              <td className="px-2 py-2 text-center text-sm font-bold">
                                {remaining}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2 text-sm">
                                <div>{formatDate(paymentDate)}</div>
                                <div className="text-xs text-gray-400">
                                  {paymentDate &&
                                    formatDistanceToNow(new Date(paymentDate), {
                                      addSuffix: true,
                                    })}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <Badge variant={urgency.variant}>
                                  {urgency.label}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {paginationControls}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Full Paid Tab */}
          <TabsContent value="full_paid">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CheckCircle2 className="h-5 w-5" />
                  Fully Paid Learners
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fullPaid.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">
                    No fully paid learners
                  </p>
                ) : (
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
                            Amount
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Completed
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Total
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                            Paid On
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {fullPaid.map((enrollment) => {
                          const total = getTotalLessons(enrollment);
                          const completed = getCompletedCount(enrollment);
                          const paymentDate = getPaymentDate(enrollment);
                          const isComplete = completed >= total;

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
                                {getCourseName(enrollment)}
                              </td>
                              <td className="px-2 py-2 text-right text-sm font-medium text-green-600">
                                ₹{getAmountPaid(enrollment).toLocaleString()}
                              </td>
                              <td className="px-2 py-2 text-center text-sm font-medium">
                                {completed}
                              </td>
                              <td className="px-2 py-2 text-center text-sm">
                                {total}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2 text-sm">
                                <div>{formatDate(paymentDate)}</div>
                                <div className="text-xs text-gray-400">
                                  {paymentDate &&
                                    formatDistanceToNow(new Date(paymentDate), {
                                      addSuffix: true,
                                    })}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-center">
                                <Badge
                                  variant={isComplete ? "secondary" : "outline"}
                                >
                                  {isComplete
                                    ? "Completed"
                                    : `${completed}/${total} done`}
                                </Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {paginationControls}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Pending Tab */}
          <TabsContent value="pending">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CreditCard className="h-5 w-5" />
                  Pending / No Payment Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pending.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">
                    No pending enrollments
                  </p>
                ) : (
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
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Payment Status
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Completed
                          </th>
                          <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                            Total
                          </th>
                          <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                            Created
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((enrollment) => {
                          const total = getTotalLessons(enrollment);
                          const completed = getCompletedCount(enrollment);

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
                                {getCourseName(enrollment)}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <Badge variant="outline">
                                  {enrollment.payment_status || "none"}
                                </Badge>
                              </td>
                              <td className="px-2 py-2 text-center text-sm font-medium">
                                {completed}
                              </td>
                              <td className="px-2 py-2 text-center text-sm">
                                {total}
                              </td>
                              <td className="whitespace-nowrap px-2 py-2 text-sm">
                                {formatDate(enrollment.created_at)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {paginationControls}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Topup Tab */}
          <TabsContent value="topup">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CreditCard className="h-5 w-5" />
                  Topup Payments (₹1)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {filteredTopups.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">
                    No topup schedules found
                  </p>
                ) : (
                  <>
                    <div className="mb-4 flex gap-4 text-sm">
                      <span className="font-medium text-green-600">
                        Paid: {data?.topupPaidCount ?? 0}
                      </span>
                      <span className="font-medium text-red-600">
                        Unpaid: {data?.topupUnpaidCount ?? 0}
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                              Learner
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                              Slots
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                              Scheduled Dates
                            </th>
                            <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                              Payment
                            </th>
                            <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                              Paid On
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredTopups.map((row) => (
                            <tr
                              key={row.learner_id}
                              className="border-b hover:bg-muted/50"
                            >
                              <td className="px-2 py-2">
                                <div className="font-medium">
                                  {row.learner_name}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {row.learner_phone}
                                </div>
                              </td>
                              <td className="px-2 py-2 text-center text-sm">
                                {row.totalSlots}
                              </td>
                              <td className="px-2 py-2 text-sm">
                                {row.dates
                                  .map((d) =>
                                    new Date(d).toLocaleDateString("en-IN", {
                                      day: "2-digit",
                                      month: "short",
                                    }),
                                  )
                                  .join(", ")}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <Badge
                                  variant={
                                    row.isPaid ? "secondary" : "destructive"
                                  }
                                >
                                  {row.isPaid ? "Paid" : "Unpaid"}
                                </Badge>
                              </td>
                              <td className="whitespace-nowrap px-2 py-2 text-sm">
                                {row.paymentDate ? (
                                  <>
                                    <div>{formatDate(row.paymentDate)}</div>
                                    <div className="text-xs text-gray-400">
                                      {formatDistanceToNow(
                                        new Date(row.paymentDate),
                                        { addSuffix: true },
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-gray-400">-</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {paginationControls}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
