import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronRight,
  Copy,
  History,
  Link2,
  Lock,
  FileSignature,
  Loader2,
  MessageCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

import { Badge } from "@/components/ui/badge";
import Form14Generator from "@/components/admin/Form14Generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  EnrollmentPlanAuditChange,
  LEARNER_ISSUE_PAGE_SIZE,
  LearnerIssueFilter,
  useCreateEnrollmentAdmin,
  useCreateEnrollmentPlanAudit,
  useCreatePaymentAdmin,
  useDeleteLearnerAllData,
  useEnrollmentPlanAudit,
  useLearnerSchedulesAdmin,
  useLearnersWithIssues,
  useLearnerWithIssuesAdmin,
  useUpdateEnrollmentAdmin,
  useUpdateLearnerAdmin,
  useUpdatePaymentAdmin,
} from "@/queries/learner";
import { useCurrentUser } from "@/queries/userManagement";
import { Database } from "@/types/database.types";
import { googleMapsLoader } from "@/utils/googleMaps";

type Learner = Database["public"]["Tables"]["Learner"]["Row"];
type Enrollment = Database["public"]["Tables"]["enrollment"]["Row"];
type Payment = Database["public"]["Tables"]["payment"]["Row"];

// Course catalogue offered when (re)assigning a plan — mirrors the list used by
// the create-learner flow in LearnerManagement.tsx so an edited plan offers the
// same packages a learner could have been created with. `duration` = lessons.
const PREDEFINED_COURSES: { id: string; name: string; duration: number }[] = [
  { id: "e129f667-0510-4f07-9847-edb58356dc74", name: "Beginner Course", duration: 10 },
  { id: "f60e5fdb-787a-4b40-844d-4e66416a6c8f", name: "Flyover", duration: 2 },
  { id: "0ce6680f-6e12-49d7-8cf9-4388e81d2e27", name: "Parking", duration: 2 },
  { id: "cc5fb06a-419f-4766-a79b-221c81bf9826", name: "Slopes", duration: 2 },
  { id: "7ff8818e-5b52-4030-bc2d-f54071e8ed7f", name: "Traffic", duration: 4 },
  { id: "05a5f57f-c3e2-48ac-b29f-4299e30442eb", name: "Parking + Flyover", duration: 4 },
  { id: "abddddb8-3f54-41ea-a64b-5ba55988b12a", name: "Slopes + Parking", duration: 4 },
  { id: "ddbbfbbf-2222-4742-947b-ccd4e25e7936", name: "Traffic + Parking", duration: 6 },
  { id: "14552c29-e7e5-4e76-a350-1ae7d8ffc7f3", name: "Traffic + Flyover", duration: 6 },
  { id: "b991363c-6791-411e-9cb8-6723e40d0a0a", name: "Traffic + Parking + Flyover", duration: 8 },
];

const PAYMENT_LINK_BASE = "https://inlane-web-app.vercel.app/payment";

type PaymentPlan = "full" | "half" | "custom";

interface Issue {
  type: "enrollment" | "payment" | "schedule" | "learner";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  fix: string;
}

// Issue detection logic
// includeScheduleCheck should only be true when we have actual schedule data
function detectIssues(
  learner: Learner,
  enrollments: Enrollment[],
  payments: Payment[],
  scheduleCount: number,
  includeScheduleCheck: boolean = false,
): Issue[] {
  const issues: Issue[] = [];

  // Ensure enrollments and payments are arrays
  const enrollmentArray = Array.isArray(enrollments)
    ? enrollments
    : enrollments
      ? [enrollments]
      : [];
  const paymentArray = Array.isArray(payments)
    ? payments
    : payments
      ? [payments]
      : [];

  const enrollment = enrollmentArray[0];
  const payment = paymentArray[0];

  // Check for missing enrollment
  if (!enrollment && paymentArray.length > 0) {
    issues.push({
      type: "enrollment",
      severity: "critical",
      title: "Missing Enrollment",
      description: "Learner has payment but no enrollment record",
      fix: "Create enrollment with status 'active'",
    });
  }

  // Check enrollment status mismatch with payment
  // payment.status = "completed" means payment was successful
  // enrollment.payment_status = "full_paid" or "half_paid" tracks installment status
  if (
    enrollment?.status === "pending" &&
    (payment?.status === "completed" || payment?.status === "full_paid") &&
    enrollment?.payment_status === "full_paid"
  ) {
    issues.push({
      type: "enrollment",
      severity: "warning",
      title: "Enrollment Status Mismatch",
      description: "Payment is complete but enrollment still pending",
      fix: "Update enrollment status to 'active'",
    });
  }

  // Check for legacy half_paid stuck (for backward compatibility with old data)
  if (
    payment?.status === "half_paid" &&
    enrollment?.payment_status === "full_paid"
  ) {
    issues.push({
      type: "payment",
      severity: "warning",
      title: "Payment Status Mismatch (Legacy)",
      description:
        "Enrollment shows full_paid but payment record shows half_paid",
      fix: "Update payment status to 'completed'",
    });
  }

  // Check for missing schedules with active enrollment (only when we have schedule data)
  if (
    includeScheduleCheck &&
    enrollment?.status === "active" &&
    scheduleCount === 0
  ) {
    issues.push({
      type: "schedule",
      severity: "warning",
      title: "No Schedules Created",
      description: "Learner has active enrollment but no schedules",
      fix: "Check schedule_preferences and create schedules",
    });
  }

  if (!learner.signature_storage_path) {
    issues.push({
      type: "learner",
      severity: "info",
      title: "Missing Learner Signature",
      description: "This learner does not have a signature available for Form 15",
      fix: "Upload the learner's signature in the Learner tab",
    });
  }

  // Check LL flow issues
  if (learner.LL_result === true && !learner.LL_received) {
    issues.push({
      type: "learner",
      severity: "info",
      title: "LL Not Marked Received",
      description: "LL test passed but not marked as received",
      fix: "Update LL_received to true if learner has received LL",
    });
  }

  // Check demo/custom course issues
  const progress = enrollment?.progress as {
    type?: string;
    total_hours?: number;
  } | null;
  if (
    (progress?.type === "demo" || progress?.type === "custom") &&
    !enrollment?.unlocked_lessons?.length
  ) {
    issues.push({
      type: "enrollment",
      severity: "warning",
      title: "Demo/Custom Missing Lessons",
      description: "Demo or custom course without unlocked_lessons array",
      fix: "Set unlocked_lessons array based on total_hours",
    });
  }

  // Check DL status issues
  if (learner.DL_result === true && !learner.DL_received) {
    issues.push({
      type: "learner",
      severity: "info",
      title: "DL Not Marked Received",
      description: "DL test passed but not marked as received",
      fix: "Update DL_received to true if learner has received DL",
    });
  }

  return issues;
}

function getSeverityColor(severity: Issue["severity"]) {
  switch (severity) {
    case "critical":
      return "bg-red-500";
    case "warning":
      return "bg-yellow-500";
    case "info":
      return "bg-blue-500";
    default:
      return "bg-gray-500";
  }
}

function getStatusDot(issues: Issue[]) {
  if (issues.some((i) => i.severity === "critical")) return "bg-red-500";
  if (issues.some((i) => i.severity === "warning")) return "bg-yellow-500";
  if (issues.some((i) => i.severity === "info")) return "bg-blue-500";
  return "bg-green-500";
}

export default function LearnerIssueFixer() {
  const [searchQuery, setSearchQuery] = useState("");
  const [issueFilter, setIssueFilter] = useState<LearnerIssueFilter>("all");
  const [page, setPage] = useState(1);
  const [selectedLearnerId, setSelectedLearnerId] = useState<string | null>(
    null,
  );

  const {
    data: learnersData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useLearnersWithIssues({ page, searchQuery, issueFilter });
  const { data: selectedLearner, refetch: refetchSelectedLearner } =
    useLearnerWithIssuesAdmin(selectedLearnerId);
  const totalCount = learnersData?.totalCount ?? 0;
  const totalPages = Math.max(
    1,
    Math.ceil(totalCount / LEARNER_ISSUE_PAGE_SIZE),
  );
  const { data: schedules } = useLearnerSchedulesAdmin({
    learnerId: selectedLearnerId ?? undefined,
  });

  // A fix or deletion can remove the last result from the current page.
  useEffect(() => {
    if (learnersData && page > totalPages) setPage(totalPages);
  }, [learnersData, page, totalPages]);

  // Real-time subscription: Auto-refresh when payments complete
  useEffect(() => {
    const channel = supabase
      .channel('learners-payment-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'payment',
          filter: 'status=eq.completed'
        },
        () => {
          console.log('[LearnerIssueFixer] Payment completed, refreshing data...');
          refetch();
          if (selectedLearnerId) refetchSelectedLearner();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refetch, refetchSelectedLearner, selectedLearnerId]);

  // Calculate issues for each learner
  const learnersWithIssues = useMemo(() => {
    if (!learnersData) return [];
    return learnersData.learners.map((learner) => {
      const enrollments = learner.enrollment || [];
      const payments = learner.payment || [];
      // Don't include schedule check here since we don't have schedule data for all learners
      const issues = detectIssues(learner, enrollments, payments, 0, false);
      return { ...learner, enrollments, payments, issues };
    });
  }, [learnersData]);

  // Current learner's issues (with schedule count - include schedule check)
  const currentIssues = useMemo(() => {
    if (!selectedLearner) return [];
    return detectIssues(
      selectedLearner,
      selectedLearner.enrollment || [],
      selectedLearner.payment || [],
      schedules?.length || 0,
      true, // Include schedule check since we have actual schedule data
    );
  }, [selectedLearner, schedules]);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header */}
      <div className="border-b bg-white px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/admin">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Wrench className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Learner Issue Fixer</h1>
          </div>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                refetch();
                if (selectedLearnerId) refetchSelectedLearner();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="border-b bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, phone, or area..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="pl-9"
            />
          </div>
          <Select
            value={issueFilter}
            onValueChange={(value) => {
              setIssueFilter(value as LearnerIssueFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by issue" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Learners</SelectItem>
              <SelectItem value="has-issues">Has Issues</SelectItem>
              <SelectItem value="no-issues">No Issues</SelectItem>
              <SelectItem value="enrollment">Enrollment Issues</SelectItem>
              <SelectItem value="payment">Payment Issues</SelectItem>
              <SelectItem value="schedule">Schedule Issues</SelectItem>
              <SelectItem value="learner">Learner Data Issues</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid flex-1 grid-cols-12 gap-3 overflow-hidden p-3">
        {/* Learner List */}
        <Card className="col-span-4 flex min-h-0 flex-col">
          <CardHeader className="p-3">
            <CardTitle className="text-sm">Learners ({totalCount})</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full">
              <div className="space-y-1 p-3 pt-0">
                {isLoading ? (
                  <div className="py-8 text-center text-muted-foreground">
                    Loading...
                  </div>
                ) : isError ? (
                  <div className="py-8 text-center text-destructive">
                    {error?.message ||
                      "Unable to load learners. Please try Refresh."}
                  </div>
                ) : learnersWithIssues.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground">
                    No learners found
                  </div>
                ) : (
                  learnersWithIssues.map((learner) => (
                    <div
                      key={learner.id}
                      onClick={() => setSelectedLearnerId(learner.id)}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-all hover:bg-gray-50 ${
                        selectedLearnerId === learner.id
                          ? "border-primary bg-primary/5"
                          : ""
                      }`}
                    >
                      <div
                        className={`h-2.5 w-2.5 rounded-full ${getStatusDot(learner.issues)}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {learner.name || "No name"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {learner.phone} {learner.area && `• ${learner.area}`}
                        </p>
                      </div>
                      {learner.issues.length > 0 && (
                        <Badge variant="secondary" className="text-xs">
                          {learner.issues.length}
                        </Badge>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1 || isFetching}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              Page {page}
              {learnersData && ` of ${totalPages}`}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !learnersData || page >= totalPages || isFetching || isError
              }
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </Card>

        {/* Issue Panel */}
        <div className="col-span-8 flex flex-col gap-3 overflow-hidden">
          {!selectedLearner ? (
            <Card className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Wrench className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                <h3 className="font-medium">No learner selected</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select a learner to view and fix issues
                </p>
              </div>
            </Card>
          ) : (
            <>
              {/* Issues Panel */}
              <Card>
                <CardHeader className="p-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4" />
                    Detected Issues ({currentIssues.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  {currentIssues.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-lg bg-green-50 p-3 text-green-700">
                      <CheckCircle className="h-4 w-4" />
                      <span className="text-sm">No issues detected</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {currentIssues.map((issue, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 rounded-lg border p-3"
                        >
                          <div
                            className={`mt-0.5 h-2 w-2 rounded-full ${getSeverityColor(issue.severity)}`}
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{issue.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {issue.description}
                            </p>
                            <p className="mt-1 text-xs text-primary">
                              Recommended: {issue.fix}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {issue.type}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Data Editor */}
              <Card className="flex-1 overflow-hidden">
                <DataEditor
                  key={selectedLearner.id}
                  learner={selectedLearner}
                  enrollments={selectedLearner.enrollment || []}
                  payments={selectedLearner.payment || []}
                  schedules={schedules || []}
                  onDeleteSuccess={() => setSelectedLearnerId(null)}
                />
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Data Editor Component
function DataEditor({
  learner,
  enrollments,
  payments,
  schedules,
  onDeleteSuccess,
}: {
  learner: Learner;
  enrollments: Enrollment[];
  payments: Payment[];
  schedules: any[];
  onDeleteSuccess?: () => void;
}) {
  return (
    <Tabs defaultValue="learner" className="flex h-full flex-col">
      <div className="border-b px-3">
        <TabsList className="h-9">
          <TabsTrigger value="learner" className="text-xs">
            Learner
          </TabsTrigger>
          <TabsTrigger value="enrollment" className="text-xs">
            Enrollment
          </TabsTrigger>
          <TabsTrigger value="plan" className="text-xs">
            Plan &amp; Link
          </TabsTrigger>
          <TabsTrigger value="payment" className="text-xs">
            Payment
          </TabsTrigger>
          <TabsTrigger value="schedules" className="text-xs">
            Schedules ({schedules.length})
          </TabsTrigger>
          <TabsTrigger value="danger" className="text-xs text-red-600">
            Danger Zone
          </TabsTrigger>
        </TabsList>
      </div>

      <ScrollArea className="flex-1">
        <TabsContent value="learner" className="m-0 p-3">
          <LearnerEditor learner={learner} />
        </TabsContent>

        <TabsContent value="enrollment" className="m-0 p-3">
          <EnrollmentEditor enrollments={enrollments} learnerId={learner.id} />
        </TabsContent>

        <TabsContent value="plan" className="m-0 p-3">
          <PaymentPlanEditor
            learner={learner}
            enrollments={enrollments}
            payments={payments}
          />
        </TabsContent>

        <TabsContent value="payment" className="m-0 p-3">
          <PaymentEditor
            payments={payments}
            enrollments={enrollments}
            learnerId={learner.id}
          />
        </TabsContent>

        <TabsContent value="schedules" className="m-0 p-3">
          <SchedulesViewer schedules={schedules} />
        </TabsContent>

        <TabsContent value="danger" className="m-0 p-3">
          <DangerZone
            learner={learner}
            enrollmentsCount={enrollments.length}
            paymentsCount={payments.length}
            schedulesCount={schedules.length}
            onDeleteSuccess={onDeleteSuccess}
          />
        </TabsContent>
      </ScrollArea>
    </Tabs>
  );
}

// ============================================================================
// Learner Editor — full, config-driven editor for every column on Learner.
// Add a new column to LEARNER_FIELD_GROUPS and it becomes editable + persisted.
// ============================================================================

type LearnerFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "triBoolean"
  | "json"
  | "address"
  | "readonly";

interface LearnerFieldDef {
  key: keyof Learner;
  label: string;
  type: LearnerFieldType;
  help?: string;
  full?: boolean; // span both grid columns
  multiline?: boolean; // text fields rendered as a textarea
}

interface LearnerFieldGroup {
  title: string;
  fields: LearnerFieldDef[];
}

const LEARNER_FIELD_GROUPS: LearnerFieldGroup[] = [
  {
    title: "Personal",
    fields: [
      { key: "name", label: "Name", type: "text" },
      {
        key: "phone",
        label: "Phone",
        type: "text",
        help: "Login identifier — change with care",
      },
      { key: "email", label: "Email", type: "text" },
      { key: "dob", label: "Date of Birth", type: "date" },
      {
        key: "driving_motivation",
        label: "Driving Motivation",
        type: "text",
        full: true,
      },
    ],
  },
  {
    title: "Address & Location",
    fields: [
      {
        key: "pick_up_location",
        label: "Pickup Address",
        type: "address",
        full: true,
        help: "Google Places — auto-fills area, city, pincode, lat/lng",
      },
      { key: "area", label: "Area", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "pincode", label: "Pincode", type: "text" },
      { key: "address_lat", label: "Latitude", type: "number" },
      { key: "address_lng", label: "Longitude", type: "number" },
      { key: "aadhar_state", label: "Aadhaar State", type: "text" },
      {
        key: "address_change_required",
        label: "Address Change Required",
        type: "boolean",
      },
    ],
  },
  {
    title: "Learner's License (LL)",
    fields: [
      { key: "LL_result", label: "LL Result", type: "triBoolean" },
      { key: "LL_received", label: "LL Received", type: "boolean" },
      { key: "LL_received_date", label: "LL Received Date", type: "date" },
      { key: "LL_test_date", label: "LL Test Date", type: "date" },
      { key: "LL_application_id", label: "LL Application ID", type: "text" },
      {
        key: "LL_application_approved",
        label: "LL Application Approved",
        type: "boolean",
      },
      { key: "LL_approved_date", label: "LL Approved Date", type: "date" },
      {
        key: "LL_team_appointment_booked",
        label: "LL Appointment Booked",
        type: "boolean",
      },
      { key: "is_LL_form_filled", label: "LL Form Filled", type: "boolean" },
      { key: "has_postLL_done", label: "Post-LL Done", type: "boolean" },
    ],
  },
  {
    title: "Driving License (DL)",
    fields: [
      { key: "has_a_DL", label: "Has DL", type: "boolean" },
      { key: "DL_result", label: "DL Result", type: "triBoolean" },
      { key: "DL_received", label: "DL Received", type: "boolean" },
      { key: "DL_test_date", label: "DL Test Date", type: "date" },
      { key: "DL_received_date", label: "DL Received Date", type: "date" },
      { key: "DL_id", label: "DL ID", type: "text" },
      {
        key: "has_two_wheeler_license",
        label: "Has Two-Wheeler License",
        type: "boolean",
      },
    ],
  },
  {
    title: "Scheduling & Preferences",
    fields: [
      { key: "needs_scheduling", label: "Needs Scheduling", type: "boolean" },
      {
        key: "onboarding_completed",
        label: "Onboarding Completed",
        type: "boolean",
      },
      { key: "enabled", label: "Enabled", type: "boolean" },
      { key: "has_lesson10_booked", label: "Lesson 10 Booked", type: "boolean" },
      { key: "start_date", label: "Start Date", type: "date" },
      {
        key: "preferred_start_date",
        label: "Preferred Start Date",
        type: "date",
      },
      {
        key: "preferred_completion_days",
        label: "Preferred Completion Days",
        type: "number",
      },
      {
        key: "prefers_two_hour_classes",
        label: "Prefers 2-Hour Classes",
        type: "boolean",
      },
      {
        key: "two_hour_days",
        label: "Two-Hour Days",
        type: "text",
        help: "e.g. comma-separated days",
      },
      {
        key: "unavailability",
        label: "Unavailability (JSON)",
        type: "json",
        full: true,
      },
    ],
  },
  {
    title: "Car Commerce / Intent",
    fields: [
      { key: "car_intent_type", label: "Car Intent Type", type: "text" },
      { key: "car_intent_planning", label: "Car Intent Planning", type: "text" },
      {
        key: "car_intent_condition",
        label: "Car Intent Condition",
        type: "text",
      },
      {
        key: "car_intent_timeframe",
        label: "Car Intent Timeframe",
        type: "text",
      },
      { key: "car_intent_source", label: "Car Intent Source", type: "text" },
      {
        key: "car_purchase_timeline",
        label: "Car Purchase Timeline",
        type: "text",
      },
      {
        key: "car_intent_updated_at",
        label: "Car Intent Updated",
        type: "readonly",
      },
      {
        key: "car_onboarding_intent_at",
        label: "Car Onboarding Intent At",
        type: "readonly",
      },
    ],
  },
  {
    title: "Account & Notes",
    fields: [
      {
        key: "password",
        label: "Password",
        type: "text",
        help: "Login password — change with care",
      },
      {
        key: "comments",
        label: "Comments",
        type: "text",
        full: true,
        multiline: true,
      },
      { key: "signed_up", label: "Signed Up", type: "readonly" },
      { key: "created_at", label: "Created At", type: "readonly" },
      { key: "id", label: "Learner ID", type: "readonly" },
    ],
  },
];

const EDITABLE_LEARNER_FIELDS = LEARNER_FIELD_GROUPS.flatMap(
  (g) => g.fields,
).filter((f) => f.type !== "readonly");

// Normalize any stored date/timestamp string to YYYY-MM-DD for <input type="date">.
function normalizeDateForInput(val: unknown): string {
  if (!val || typeof val !== "string") return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const d = new Date(val);
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Build a form-friendly (mostly string) representation of a learner row.
function buildLearnerFormState(learner: Learner): Record<string, any> {
  const state: Record<string, any> = {};
  for (const field of EDITABLE_LEARNER_FIELDS) {
    const raw = (learner as any)[field.key];
    switch (field.type) {
      case "boolean":
        state[field.key] = Boolean(raw);
        break;
      case "triBoolean":
        state[field.key] =
          raw === true ? "true" : raw === false ? "false" : "null";
        break;
      case "number":
        state[field.key] = raw == null ? "" : String(raw);
        break;
      case "date":
        state[field.key] = normalizeDateForInput(raw);
        break;
      case "json":
        state[field.key] = raw == null ? "" : JSON.stringify(raw, null, 2);
        break;
      default: // text, address
        state[field.key] = raw == null ? "" : String(raw);
    }
  }
  return state;
}

// Convert a form value back to the value that should be written to the DB.
// Throws on invalid JSON (caught by the save handler).
function learnerFormValueToDb(field: LearnerFieldDef, value: any): any {
  switch (field.type) {
    case "boolean":
      return Boolean(value);
    case "triBoolean":
      return value === "true" ? true : value === "false" ? false : null;
    case "number": {
      if (value === "" || value == null) return null;
      const n = Number(value);
      return isNaN(n) ? null : n;
    }
    case "date":
      return value ? value : null;
    case "json":
      if (typeof value !== "string" || value.trim() === "") return null;
      return JSON.parse(value);
    default: {
      const s = typeof value === "string" ? value.trim() : value;
      return s === "" ? null : s;
    }
  }
}

function LearnerEditor({ learner }: { learner: Learner }) {
  const updateMutation = useUpdateLearnerAdmin();
  const { toast } = useToast();
  const [formData, setFormData] = useState<Record<string, any>>(() =>
    buildLearnerFormState(learner),
  );
  // Baseline used to detect changes; reset after a successful save.
  const [initialData, setInitialData] = useState<Record<string, any>>(() =>
    buildLearnerFormState(learner),
  );
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [isUploadingSignature, setIsUploadingSignature] = useState(false);
  const [storedSignaturePath, setStoredSignaturePath] = useState(
    learner.signature_storage_path,
  );
  const [storedSignatureMimeType, setStoredSignatureMimeType] = useState(
    learner.signature_mime_type,
  );
  const [formsDialogOpen, setFormsDialogOpen] = useState(false);
  const signatureInputRef = useRef<HTMLInputElement>(null);

  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  const setField = (key: string, value: any) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  // Initialize Google Places autocomplete on the address field
  useEffect(() => {
    let listener: google.maps.MapsEventListener | null = null;

    googleMapsLoader.load().then(() => {
      if (!addressInputRef.current || autocompleteRef.current) return;

      autocompleteRef.current = new google.maps.places.Autocomplete(
        addressInputRef.current,
        {
          componentRestrictions: { country: "IN" },
          fields: ["address_components", "formatted_address", "geometry"],
        },
      );

      listener = autocompleteRef.current.addListener("place_changed", () => {
        const place = autocompleteRef.current?.getPlace();
        if (!place?.formatted_address || !place.geometry?.location) return;

        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        const components = place.address_components || [];
        const cityComp = components.find(
          (c) =>
            c.types.includes("locality") ||
            c.types.includes("administrative_area_level_2"),
        );
        const pincodeComp = components.find((c) =>
          c.types.includes("postal_code"),
        );
        const sublocalityComp = components.find(
          (c) =>
            c.types.includes("sublocality_level_1") ||
            c.types.includes("sublocality"),
        );

        setFormData((prev) => ({
          ...prev,
          pick_up_location: place.formatted_address!,
          address_lat: String(lat),
          address_lng: String(lng),
          city: cityComp?.long_name || prev.city,
          pincode: pincodeComp?.long_name || prev.pincode,
          area: sublocalityComp?.long_name || prev.area,
        }));
      });
    });

    return () => {
      if (listener) google.maps.event.removeListener(listener);
      if (autocompleteRef.current) {
        google.maps.event.clearInstanceListeners(autocompleteRef.current);
        autocompleteRef.current = null;
      }
    };
  }, []);

  // Which fields differ from the saved baseline
  const changedKeys = useMemo(() => {
    return EDITABLE_LEARNER_FIELDS.filter(
      (field) =>
        JSON.stringify(initialData[field.key] ?? null) !==
        JSON.stringify(formData[field.key] ?? null),
    ).map((f) => f.key);
  }, [formData, initialData]);

  const handleSave = async () => {
    if (!formData.phone || String(formData.phone).trim() === "") {
      toast({
        title: "Phone required",
        description: "Phone cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    if (changedKeys.length === 0) {
      toast({ title: "No changes", description: "Nothing to save." });
      return;
    }

    const updates: Record<string, unknown> = {};
    try {
      for (const field of EDITABLE_LEARNER_FIELDS) {
        if (changedKeys.includes(field.key)) {
          updates[field.key] = learnerFormValueToDb(
            field,
            formData[field.key],
          );
        }
      }
    } catch {
      toast({
        title: "Invalid JSON",
        description: "Fix the Unavailability JSON before saving.",
        variant: "destructive",
      });
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: learner.id,
        updates: updates as Partial<
          Database["public"]["Tables"]["Learner"]["Update"]
        >,
      });
      setInitialData({ ...formData });
      toast({
        title: "Saved",
        description: `Updated ${changedKeys.length} field(s) in the database.`,
      });
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error?.message || "Could not update learner.",
        variant: "destructive",
      });
    }
  };

  const handleReset = () => {
    setFormData({ ...initialData });
    if (addressInputRef.current) {
      addressInputRef.current.value = initialData.pick_up_location || "";
    }
  };

  const handleSignatureUpload = async () => {
    if (!signatureFile) {
      toast({
        title: "Choose a signature",
        description: "Select a PNG or JPG signature image first.",
        variant: "destructive",
      });
      return;
    }

    if (!["image/png", "image/jpeg"].includes(signatureFile.type)) {
      toast({
        title: "Unsupported file",
        description: "The signature must be a PNG or JPG image.",
        variant: "destructive",
      });
      return;
    }

    if (signatureFile.size > 5 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "The signature image must be 5 MB or smaller.",
        variant: "destructive",
      });
      return;
    }

    setIsUploadingSignature(true);
    let newStoragePath: string | null = null;
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        throw authError || new Error("You must be signed in to upload a signature.");
      }

      const extension = signatureFile.type === "image/png" ? "png" : "jpg";
      newStoragePath = `${authData.user.id}/${learner.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("learner-signatures")
        .upload(newStoragePath, signatureFile, {
          contentType: signatureFile.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      await updateMutation.mutateAsync({
        id: learner.id,
        updates: {
          signature_storage_path: newStoragePath,
          signature_submitted_at: new Date().toISOString(),
          signature_method: "admin_upload",
          signature_mime_type: signatureFile.type,
        },
      });

      setStoredSignaturePath(newStoragePath);
      setStoredSignatureMimeType(signatureFile.type);
      setSignatureFile(null);
      if (signatureInputRef.current) signatureInputRef.current.value = "";
      toast({
        title: "Signature uploaded",
        description: "Future Form 15 downloads will include this learner signature.",
      });
    } catch (error: any) {
      if (newStoragePath) {
        await supabase.storage.from("learner-signatures").remove([newStoragePath]);
      }
      toast({
        title: "Signature upload failed",
        description: error?.message || "Could not save the learner signature.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingSignature(false);
    }
  };

  const renderField = (field: LearnerFieldDef) => {
    const value = formData[field.key];
    const labelEl = <Label className="text-xs">{field.label}</Label>;
    const helpEl = field.help ? (
      <p className="text-[10px] text-muted-foreground">{field.help}</p>
    ) : null;

    switch (field.type) {
      case "boolean":
        return (
          <div className="flex h-full items-center justify-between rounded-lg border p-2">
            <Label className="text-xs">{field.label}</Label>
            <Checkbox
              checked={Boolean(value)}
              onCheckedChange={(checked: boolean) =>
                setField(field.key, checked)
              }
            />
          </div>
        );
      case "triBoolean":
        return (
          <>
            {labelEl}
            <Select
              value={value ?? "null"}
              onValueChange={(v) => setField(field.key, v)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="null">Not set</SelectItem>
                <SelectItem value="true">Pass</SelectItem>
                <SelectItem value="false">Fail</SelectItem>
              </SelectContent>
            </Select>
          </>
        );
      case "number":
        return (
          <>
            {labelEl}
            <Input
              type="number"
              value={value ?? ""}
              onChange={(e) => setField(field.key, e.target.value)}
              className="h-8 text-sm"
            />
            {helpEl}
          </>
        );
      case "date":
        return (
          <>
            {labelEl}
            <Input
              type="date"
              value={value ?? ""}
              onChange={(e) => setField(field.key, e.target.value)}
              className="h-8 text-sm"
            />
            {helpEl}
          </>
        );
      case "json":
        return (
          <>
            {labelEl}
            <Textarea
              value={value ?? ""}
              onChange={(e) => setField(field.key, e.target.value)}
              className="font-mono text-xs"
              rows={4}
              placeholder="null"
            />
            {helpEl}
          </>
        );
      case "address":
        return (
          <>
            {labelEl}
            <Input
              ref={addressInputRef}
              defaultValue={value}
              onChange={(e) => setField(field.key, e.target.value)}
              className="h-8 text-sm"
              placeholder="Type to search address..."
            />
            {helpEl}
          </>
        );
      case "readonly": {
        const raw = (learner as any)[field.key];
        let display = raw == null ? "—" : String(raw);
        if (raw && field.key !== "id") {
          const d = new Date(raw);
          if (!isNaN(d.getTime())) display = d.toLocaleString();
        }
        return (
          <>
            {labelEl}
            <div className="flex h-8 items-center overflow-hidden text-ellipsis rounded-md border bg-gray-50 px-3 text-xs text-muted-foreground">
              {display}
            </div>
          </>
        );
      }
      default: // text
        return field.multiline ? (
          <>
            {labelEl}
            <Textarea
              value={value ?? ""}
              onChange={(e) => setField(field.key, e.target.value)}
              className="text-sm"
              rows={2}
            />
            {helpEl}
          </>
        ) : (
          <>
            {labelEl}
            <Input
              value={value ?? ""}
              onChange={(e) => setField(field.key, e.target.value)}
              className="h-8 text-sm"
            />
            {helpEl}
          </>
        );
    }
  };

  const lat = Number(formData.address_lat);
  const lng = Number(formData.address_lng);
  const hasCoords = !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);

  return (
    <div className="space-y-5 pb-2">
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-700">
              <FileSignature className="h-4 w-4" />
              Form 15 learner signature
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {storedSignaturePath
                ? "A signature is stored. Upload another image to replace it on future Form 15 downloads."
                : "No signature is stored. Upload one so it appears on future Form 15 downloads."}
            </p>
          </div>
          <Badge variant={storedSignaturePath ? "secondary" : "outline"}>
            {storedSignaturePath ? "Signature available" : "Missing"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Input
            ref={signatureInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="h-9 max-w-md text-xs"
            onChange={(event) => setSignatureFile(event.target.files?.[0] || null)}
            disabled={isUploadingSignature}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleSignatureUpload}
            disabled={!signatureFile || isUploadingSignature}
          >
            {isUploadingSignature ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {storedSignaturePath ? "Replace signature" : "Upload signature"}
          </Button>
          {storedSignaturePath && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setFormsDialogOpen(true)}
            >
              Download Form 15
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          PNG or JPG, maximum 5 MB. Admin uploads do not record learner terms consent.
        </p>
      </div>

      <Form14Generator
        learner={{
          ...learner,
          signature_storage_path: storedSignaturePath,
          signature_mime_type: storedSignatureMimeType,
          signature_method:
            storedSignaturePath === learner.signature_storage_path
              ? learner.signature_method
              : "admin_upload",
        }}
        open={formsDialogOpen}
        onClose={() => setFormsDialogOpen(false)}
      />

      {LEARNER_FIELD_GROUPS.map((group) => (
        <div key={group.title} className="space-y-3">
          <p className="border-b pb-1 text-xs font-semibold uppercase tracking-wide text-gray-700">
            {group.title}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {group.fields.map((field) => (
              <div
                key={String(field.key)}
                className={
                  field.full ? "col-span-2 space-y-1" : "space-y-1"
                }
              >
                {renderField(field)}
              </div>
            ))}
          </div>
          {group.title === "Address & Location" && hasCoords && (
            <a
              href={`https://maps.google.com/?q=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              View on Google Maps ({lat.toFixed(4)}, {lng.toFixed(4)})
            </a>
          )}
        </div>
      ))}

      <div className="sticky bottom-0 -mx-3 flex items-center gap-3 border-t bg-white px-3 py-3">
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending || changedKeys.length === 0}
          size="sm"
        >
          <Save className="mr-2 h-4 w-4" />
          {updateMutation.isPending
            ? "Saving..."
            : changedKeys.length > 0
              ? `Save ${changedKeys.length} Change${changedKeys.length > 1 ? "s" : ""}`
              : "Save Changes"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          disabled={updateMutation.isPending || changedKeys.length === 0}
        >
          Reset
        </Button>
        {changedKeys.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {changedKeys.length} unsaved change
            {changedKeys.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// Enrollment Editor
function EnrollmentEditor({
  enrollments,
  learnerId,
}: {
  enrollments: (Enrollment & {
    Courses?: {
      id: string;
      name: string | null;
      duration: number | null;
      total_lessons: number | null;
    } | null;
  })[];
  learnerId: string;
}) {
  const updateMutation = useUpdateEnrollmentAdmin();
  const createMutation = useCreateEnrollmentAdmin();
  const enrollment = enrollments[0];

  // Get course info from the linked Courses table (primary source)
  const linkedCourse = (enrollment as any)?.Courses;
  // Parse progress as fallback
  const existingProgress = enrollment?.progress as {
    type?: string;
    total_hours?: number;
  } | null;
  const existingUnlockedLessons = enrollment?.unlocked_lessons || [];

  // Determine course type from course name (demo, custom, or regular)
  const getCourseType = (): string => {
    const courseName = linkedCourse?.name?.toLowerCase() || "";
    if (courseName.includes("demo")) return "demo";
    if (courseName.includes("custom")) return "custom";
    return existingProgress?.type || "regular";
  };

  // Calculate actual total lessons - prioritize Courses table data
  const actualTotalLessons =
    linkedCourse?.total_lessons ||
    linkedCourse?.duration ||
    existingProgress?.total_hours ||
    10;
  const courseType = getCourseType();
  // Calculate half payment lessons: 10→8, 8→6, 6→4, 4→2, 2→1
  const halfPaymentLessons =
    actualTotalLessons <= 1
      ? 1
      : actualTotalLessons === 2
        ? 1
        : actualTotalLessons - 2;
  // Full payment lessons (total minus 1 for regular 10-lesson course, or all for others)
  const fullPaymentLessons =
    courseType === "regular" && actualTotalLessons === 10
      ? actualTotalLessons - 1
      : actualTotalLessons;

  const [formData, setFormData] = useState({
    status:
      enrollment?.status ||
      ("pending" as Database["public"]["Enums"]["enrollment_status"]),
    payment_status: enrollment?.payment_status || "",
    // Progress fields - use actual course data
    courseType: courseType,
    totalHours: actualTotalLessons,
    // Unlocked lessons - simple number for how many lessons to unlock
    lessonsToUnlock: existingUnlockedLessons.length || 0,
  });

  // Generate unlocked lessons array based on number
  const generateUnlockedLessons = (count: number): number[] => {
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  const handleSave = () => {
    const progress = {
      type: formData.courseType,
      total_hours: formData.totalHours,
    };
    const unlockedLessons = generateUnlockedLessons(formData.lessonsToUnlock);

    if (!enrollment) {
      createMutation.mutate({
        learner_id: learnerId,
        course_id: "default-course-id",
        status:
          formData.status as Database["public"]["Enums"]["enrollment_status"],
        payment_status: formData.payment_status,
        unlocked_lessons: unlockedLessons,
        progress: progress,
      });
    } else {
      updateMutation.mutate({
        id: enrollment.id,
        updates: {
          status:
            formData.status as Database["public"]["Enums"]["enrollment_status"],
          payment_status: formData.payment_status,
          unlocked_lessons: unlockedLessons,
          progress: progress,
        },
      });
    }
  };

  // Quick action: Unlock all lessons based on actual course configuration
  const handleUnlockAllLessons = () => {
    setFormData({
      ...formData,
      status: "active",
      payment_status: "full_paid",
      lessonsToUnlock: fullPaymentLessons,
    });
  };

  if (!enrollment) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border-2 border-dashed border-orange-300 bg-orange-50 p-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-600" />
            <p className="text-sm font-medium text-orange-800">
              No enrollment found
            </p>
          </div>
          <p className="mb-3 text-xs text-orange-600">
            This learner doesn't have an enrollment record. Enrollments must be
            created through the normal payment flow to ensure proper course
            linking.
          </p>
          <p className="text-xs text-muted-foreground">
            To create an enrollment, the learner should complete the payment
            process in the app, which will automatically create the enrollment
            with the correct course.
          </p>
        </div>
      </div>
    );
  }

  // Check current status
  const isActive = enrollment.status === "active";
  const isFullyPaid = enrollment.payment_status === "full_paid";

  return (
    <div className="space-y-4">
      {/* Current Status Banner */}
      <div
        className={`rounded-lg border p-3 ${
          isActive && isFullyPaid
            ? "border-green-300 bg-green-50"
            : isActive
              ? "border-yellow-300 bg-yellow-50"
              : "border-red-300 bg-red-50"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p
              className={`text-sm font-medium ${
                isActive && isFullyPaid
                  ? "text-green-800"
                  : isActive
                    ? "text-yellow-800"
                    : "text-red-800"
              }`}
            >
              Status: {enrollment.status?.toUpperCase()} | Payment:{" "}
              {enrollment.payment_status?.toUpperCase() || "NOT SET"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Lessons Unlocked:{" "}
              {existingUnlockedLessons.length > 0
                ? existingUnlockedLessons.join(", ")
                : "None"}{" "}
              | Course: {linkedCourse?.name || courseType} ({actualTotalLessons}{" "}
              lessons)
            </p>
          </div>
          {isActive && isFullyPaid && (
            <CheckCircle className="h-6 w-6 text-green-600" />
          )}
        </div>
      </div>

      {/* Quick Fix Actions */}
      {(!isActive ||
        !isFullyPaid ||
        existingUnlockedLessons.length < fullPaymentLessons) && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="mb-2 text-xs font-medium text-blue-800">Quick Fix</p>
          <div className="flex flex-wrap gap-2">
            {!isActive && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 bg-white text-xs"
                onClick={() => {
                  setFormData({ ...formData, status: "active" });
                }}
              >
                Set Status to Active
              </Button>
            )}
            {existingUnlockedLessons.length < fullPaymentLessons && (
              <Button
                size="sm"
                className="h-7 bg-blue-600 text-xs hover:bg-blue-700"
                onClick={handleUnlockAllLessons}
              >
                Unlock All {fullPaymentLessons} Lessons + Set Active + Full Paid
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Enrollment Settings */}
      <div className="space-y-3">
        <p className="border-b pb-1 text-xs font-medium text-gray-700">
          Enrollment Settings
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Enrollment Status</Label>
            <p className="text-[10px] text-muted-foreground">
              Controls if learner can use the app
            </p>
            <Select
              value={formData.status}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  status:
                    value as Database["public"]["Enums"]["enrollment_status"],
                })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">
                  Pending (Cannot schedule)
                </SelectItem>
                <SelectItem value="active">Active (Can schedule)</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">
              Payment Status in Enrollment
            </Label>
            <p className="text-[10px] text-muted-foreground">
              Sync with Payment tab
            </p>
            <Select
              value={formData.payment_status}
              onValueChange={(value) =>
                setFormData({ ...formData, payment_status: value })
              }
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="half_paid">
                  Half Paid ({halfPaymentLessons} lessons)
                </SelectItem>
                <SelectItem value="full_paid">
                  Full Paid ({fullPaymentLessons} lessons)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Lessons Configuration */}
      <div className="space-y-3">
        <p className="border-b pb-1 text-xs font-medium text-gray-700">
          Lessons Available for Scheduling
        </p>

        <div className="space-y-1">
          <Label className="text-xs font-medium">
            Number of Lessons to Unlock
          </Label>
          <p className="text-[10px] text-muted-foreground">
            How many lessons can the learner schedule? ({halfPaymentLessons} for
            half payment, {fullPaymentLessons} for full payment)
          </p>
          <div className="flex items-center gap-3">
            <Input
              type="number"
              min={0}
              max={actualTotalLessons}
              value={formData.lessonsToUnlock}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  lessonsToUnlock: Number(e.target.value),
                })
              }
              className="h-8 w-24 text-sm"
            />
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setFormData({
                    ...formData,
                    lessonsToUnlock: halfPaymentLessons,
                  })
                }
                title="Half payment"
              >
                {halfPaymentLessons}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setFormData({
                    ...formData,
                    lessonsToUnlock: fullPaymentLessons,
                  })
                }
                title="Full payment"
              >
                {fullPaymentLessons}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setFormData({
                    ...formData,
                    lessonsToUnlock: actualTotalLessons,
                  })
                }
                title="All lessons"
              >
                {actualTotalLessons}
              </Button>
            </div>
          </div>
          <p className="mt-1 text-xs text-blue-600">
            Will unlock:{" "}
            {formData.lessonsToUnlock > 0
              ? `Lessons 1 to ${formData.lessonsToUnlock}`
              : "None"}
          </p>
        </div>
      </div>

      {/* Course Information */}
      <div className="space-y-3">
        <p className="border-b pb-1 text-xs font-medium text-gray-700">
          Course Information
        </p>

        {linkedCourse ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-sm font-medium text-blue-800">
              {linkedCourse.name || "Unnamed Course"}
            </p>
            <p className="mt-1 text-xs text-blue-600">
              Duration:{" "}
              {linkedCourse.duration || linkedCourse.total_lessons || "N/A"}{" "}
              hours/lessons
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              Course data comes from the linked Courses table. To change course
              type, you need to update the enrollment's course_id.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">
                Course Type (Manual Override)
              </Label>
              <p className="text-[10px] text-muted-foreground">
                No linked course - set manually
              </p>
              <Select
                value={formData.courseType}
                onValueChange={(value) =>
                  setFormData({ ...formData, courseType: value })
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">
                    Regular (Standard 10 lessons)
                  </SelectItem>
                  <SelectItem value="demo">Demo (Trial lesson)</SelectItem>
                  <SelectItem value="custom">
                    Custom (Flexible hours)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Total Hours/Lessons</Label>
              <p className="text-[10px] text-muted-foreground">
                Manual override value
              </p>
              <Input
                type="number"
                min={1}
                max={20}
                value={formData.totalHours}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    totalHours: Number(e.target.value),
                  })
                }
                className="h-8 text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Current State Info */}
      <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-xs">
        <p>
          <strong>Enrollment ID:</strong> {enrollment.id}
        </p>
        <p>
          <strong>Course ID:</strong>{" "}
          {enrollment.course_id || "Not linked to course"}
        </p>
        <p>
          <strong>Linked Course:</strong> {linkedCourse?.name || "None"}{" "}
          {linkedCourse &&
            `(${linkedCourse.total_lessons || linkedCourse.duration} lessons)`}
        </p>
        <p>
          <strong>Created:</strong>{" "}
          {new Date(enrollment.created_at).toLocaleString()}
        </p>
      </div>

      <Button
        onClick={handleSave}
        disabled={updateMutation.isPending}
        size="sm"
        className="w-full"
      >
        <Save className="mr-2 h-4 w-4" />
        {updateMutation.isPending ? "Saving..." : "Save All Changes"}
      </Button>
    </div>
  );
}

// Payment Editor
function PaymentEditor({
  payments,
  enrollments,
  learnerId,
}: {
  payments: Payment[];
  enrollments: (Enrollment & {
    Courses?: {
      id: string;
      name: string | null;
      duration: number | null;
      total_lessons: number | null;
    } | null;
  })[];
  learnerId: string;
}) {
  const updatePaymentMutation = useUpdatePaymentAdmin();
  const updateEnrollmentMutation = useUpdateEnrollmentAdmin();
  const createPaymentMutation = useCreatePaymentAdmin();
  const { toast } = useToast();
  const payment = payments[0];
  const enrollment = enrollments[0];

  // Get course info from the linked Courses table (primary source)
  const linkedCourse = (enrollment as any)?.Courses;
  // Parse progress as fallback
  const existingProgress = enrollment?.progress as {
    type?: string;
    total_hours?: number;
  } | null;

  // Determine course type from course name
  const getCourseType = (): string => {
    const courseName = linkedCourse?.name?.toLowerCase() || "";
    if (courseName.includes("demo")) return "demo";
    if (courseName.includes("custom")) return "custom";
    return existingProgress?.type || "regular";
  };

  // Calculate actual total lessons - prioritize Courses table data
  const actualTotalLessons =
    linkedCourse?.total_lessons ||
    linkedCourse?.duration ||
    existingProgress?.total_hours ||
    10;
  const courseType = getCourseType();
  const halfPaymentLessons = Math.floor(actualTotalLessons / 2);
  const fullPaymentLessons =
    courseType === "regular" && actualTotalLessons === 10
      ? actualTotalLessons - 1
      : actualTotalLessons;

  const [cashPaymentAmount, setCashPaymentAmount] = useState(0);
  const [isRecoveringRazorpay, setIsRecoveringRazorpay] = useState(false);

  // Check payment status from enrollment (source of truth for full/half paid)
  // payment.status is "completed" for successful payments, enrollment.payment_status tracks full/half
  const isFullyPaid = enrollment?.payment_status === "full_paid";
  const isHalfPaid = enrollment?.payment_status === "half_paid";
  const hasNoPayment = !payment || payment?.status === "pending";

  const isStuckRazorpay =
    payment?.status === "pending" &&
    payment?.gateway_reference?.startsWith("order_");

  const handleRecoverRazorpay = async () => {
    if (!payment) return;
    setIsRecoveringRazorpay(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "recover-razorpay-payment",
        { body: { paymentId: payment.id } },
      );
      if (error) throw error;
      if (data?.success && data.captured) {
        toast({
          title: data.alreadyCompleted ? "Already completed" : "Payment recovered",
          description: data.alreadyCompleted
            ? "This payment was already marked completed."
            : `Marked completed via Razorpay payment ${data.razorpayPaymentId}.`,
        });
      } else if (data?.success === false && data.captured === false) {
        toast({
          title: "No captured payment found",
          description: data.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Recovery failed",
          description: data?.error || "Unknown error",
          variant: "destructive",
        });
      }
    } catch (err) {
      toast({
        title: "Recovery error",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setIsRecoveringRazorpay(false);
    }
  };

  // Handle cash payment - updates both payment and enrollment
  const handleCashPayment = async (
    paymentType: "half" | "full" | "remaining",
  ) => {
    try {
      const isFullPayment =
        paymentType === "full" || paymentType === "remaining";
      const lessonsToUnlock = isFullPayment
        ? fullPaymentLessons
        : halfPaymentLessons;

      if (payment) {
        // Update existing payment
        // Use "completed" status to match automatic payment flow (Razorpay/ICICI)
        // The enrollment.payment_status tracks full_paid vs half_paid for installments
        await updatePaymentMutation.mutateAsync({
          id: payment.id,
          updates: {
            status: "completed",
            amount:
              paymentType === "remaining"
                ? payment.amount + cashPaymentAmount
                : cashPaymentAmount || payment.amount,
            gateway_reference: payment.gateway_reference
              ? `${payment.gateway_reference}, CASH-${Date.now()}`
              : `CASH-${Date.now()}`,
          },
        });
      } else {
        // Create new payment record
        // Use "completed" status to match automatic payment flow (Razorpay/ICICI)
        await createPaymentMutation.mutateAsync({
          learner_id: learnerId,
          amount: cashPaymentAmount,
          status: "completed",
          payment_type: "course",
          gateway_reference: `CASH-${Date.now()}`,
        });
      }

      // Update enrollment if exists
      if (enrollment) {
        await updateEnrollmentMutation.mutateAsync({
          id: enrollment.id,
          updates: {
            status: "active",
            payment_status: isFullPayment ? "full_paid" : "half_paid",
            unlocked_lessons: Array.from(
              { length: lessonsToUnlock },
              (_, i) => i + 1,
            ),
          },
        });
      }

      toast({
        title: "Payment Updated",
        description: `Payment marked as ${isFullPayment ? "fully paid" : "half paid"} successfully.`,
      });
    } catch (error: any) {
      console.error("Payment update error:", error);
      toast({
        title: "Payment Update Failed",
        description:
          error.message || "Failed to update payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Current Payment Status */}
      <div
        className={`rounded-lg border p-3 ${
          isFullyPaid
            ? "border-green-300 bg-green-50"
            : isHalfPaid
              ? "border-yellow-300 bg-yellow-50"
              : "border-red-300 bg-red-50"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p
              className={`text-sm font-medium ${
                isFullyPaid
                  ? "text-green-800"
                  : isHalfPaid
                    ? "text-yellow-800"
                    : "text-red-800"
              }`}
            >
              Payment Status:{" "}
              {isFullyPaid
                ? "FULLY PAID"
                : isHalfPaid
                  ? "HALF PAID"
                  : "NO PAYMENT"}
            </p>
            {payment && (
              <p className="mt-1 text-xs text-muted-foreground">
                Amount: ₹{payment.amount} | Ref:{" "}
                {payment.gateway_reference || "N/A"}
              </p>
            )}
          </div>
          {isFullyPaid && <CheckCircle className="h-6 w-6 text-green-600" />}
        </div>
      </div>

      {isStuckRazorpay && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-medium text-amber-800">
            Stuck Razorpay Payment
          </p>
          <p className="mb-3 text-xs text-amber-700">
            This payment has a Razorpay order ID ({payment?.gateway_reference})
            but never received the verification callback. Click below to check
            Razorpay and recover if the learner actually paid.
          </p>
          <Button
            size="sm"
            className="h-7 bg-amber-600 text-xs hover:bg-amber-700"
            onClick={handleRecoverRazorpay}
            disabled={isRecoveringRazorpay}
          >
            {isRecoveringRazorpay
              ? "Checking Razorpay…"
              : "Verify & Recover Razorpay Payment"}
          </Button>
        </div>
      )}

      {/* Show Cash Payment Options ONLY if not fully paid */}
      {!isFullyPaid && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <p className="mb-2 text-xs font-medium text-blue-800">
            {hasNoPayment ? "Record Cash Payment" : "Record Remaining Payment"}
          </p>
          <p className="mb-3 text-xs text-blue-600">
            {hasNoPayment
              ? "Customer paid in cash? Use these buttons to update payment and unlock lessons."
              : "Customer paid remaining amount? Update to full payment."}
          </p>

          <div className="mb-3 flex items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Amount Received (₹)</Label>
              <Input
                type="number"
                placeholder="Enter amount"
                value={cashPaymentAmount || ""}
                onChange={(e) => setCashPaymentAmount(Number(e.target.value))}
                className="h-8 w-32 bg-white text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {hasNoPayment && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 bg-white text-xs"
                  onClick={() => handleCashPayment("half")}
                  disabled={
                    updatePaymentMutation.isPending ||
                    createPaymentMutation.isPending
                  }
                >
                  Half Payment (Unlock {halfPaymentLessons} Lessons)
                </Button>
                <Button
                  size="sm"
                  className="h-7 bg-blue-600 text-xs hover:bg-blue-700"
                  onClick={() => handleCashPayment("full")}
                  disabled={
                    updatePaymentMutation.isPending ||
                    createPaymentMutation.isPending
                  }
                >
                  Full Payment (Unlock {fullPaymentLessons} Lessons)
                </Button>
              </>
            )}
            {isHalfPaid && (
              <Button
                size="sm"
                className="h-7 bg-green-600 text-xs hover:bg-green-700"
                onClick={() => handleCashPayment("remaining")}
                disabled={updatePaymentMutation.isPending}
              >
                Mark Remaining Paid (Unlock All {fullPaymentLessons} Lessons)
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Payment Details (read-only info) */}
      {payment && (
        <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-xs">
          <p>
            <strong>Payment ID:</strong> {payment.id}
          </p>
          <p>
            <strong>Created:</strong>{" "}
            {new Date(payment.created_at).toLocaleString()}
          </p>
          <p>
            <strong>Amount Paid:</strong> ₹{payment.amount}
          </p>
          <p>
            <strong>Total Amount:</strong> ₹
            {payment.total_amount || payment.amount}
          </p>
          <p>
            <strong>Type:</strong> {payment.payment_type}
          </p>
          <p>
            <strong>Reference:</strong> {payment.gateway_reference || "N/A"}
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Payment Plan Editor (PRD-ADMIN-004)
// Edit course / plan / amount on an EXISTING learner and re-send the payment
// link — without creating a duplicate learner. Phone (the login id) is never
// editable here. Blocks once any payment is received, requires a confirmation
// diff, and logs every change to the append-only enrollment_plan_audit table.
// ============================================================================
function PaymentPlanEditor({
  learner,
  enrollments,
  payments,
}: {
  learner: Learner;
  enrollments: (Enrollment & {
    Courses?: {
      id: string;
      name: string | null;
      duration: number | null;
      total_lessons: number | null;
    } | null;
  })[];
  payments: Payment[];
}) {
  const { toast } = useToast();
  const updateEnrollment = useUpdateEnrollmentAdmin();
  const createAudit = useCreateEnrollmentPlanAudit();
  const { data: currentUser } = useCurrentUser();
  const editor = currentUser as
    | { id?: string; name?: string; phone?: string }
    | null
    | undefined;

  const enrollment = enrollments[0];
  const linkedCourse = (enrollment as any)?.Courses;
  const existingProgress = enrollment?.progress as {
    type?: string;
    total_hours?: number;
  } | null;

  // Any money received (half or full) blocks plan edits — changing the plan
  // afterwards is refund territory, explicitly out of scope (PRD §3, §5.2).
  const hasReceivedPayment =
    enrollment?.payment_status === "full_paid" ||
    enrollment?.payment_status === "half_paid" ||
    payments.some(
      (p) =>
        p.status === "completed" ||
        p.status === "full_paid" ||
        p.status === "half_paid",
    );

  // Course catalogue + the currently-linked course (if it isn't predefined),
  // so the dropdown always shows the current value.
  const courseOptions = [...PREDEFINED_COURSES];
  if (
    enrollment?.course_id &&
    !courseOptions.some((c) => c.id === enrollment.course_id)
  ) {
    courseOptions.unshift({
      id: enrollment.course_id,
      name: linkedCourse?.name || "Current course",
      duration:
        linkedCourse?.total_lessons ||
        linkedCourse?.duration ||
        existingProgress?.total_hours ||
        0,
    });
  }
  const courseName = (id: string) =>
    courseOptions.find((c) => c.id === id)?.name || "Unknown course";

  // Baseline = current DB values.
  const initCourseId = enrollment?.course_id || "";
  const initAmount = enrollment?.amount ?? 0;
  const initI1 = enrollment?.installment1_amount ?? 0;
  const initI2 = enrollment?.installment2_amount ?? 0;
  const initialPlan: PaymentPlan =
    initI2 === 0 ? "full" : Math.abs(initI1 - initI2) <= 1 ? "half" : "custom";

  const [courseId, setCourseId] = useState(initCourseId);
  const [plan, setPlan] = useState<PaymentPlan>(initialPlan);
  const [totalAmount, setTotalAmount] = useState<number>(initAmount);
  const [customDueNow, setCustomDueNow] = useState<number>(initI1 || initAmount);
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const selectedCourse = courseOptions.find((c) => c.id === courseId);
  const totalLessons =
    selectedCourse?.duration || existingProgress?.total_hours || 0;

  // Derived installment amounts from the chosen plan.
  const dueNow =
    plan === "full"
      ? totalAmount
      : plan === "half"
        ? Math.round(totalAmount / 2)
        : Number(customDueNow) || 0;
  const secondInstallment = Math.max(0, totalAmount - dueNow);

  const planLabel = (p: PaymentPlan) =>
    p === "full" ? "Full payment" : p === "half" ? "Half (50:50)" : "Custom";

  // Changes vs the DB baseline — drives the confirm modal and the audit row.
  const changes: EnrollmentPlanAuditChange[] = [];
  if (courseId !== initCourseId)
    changes.push({
      field: "course_id",
      label: "Course",
      old: courseName(initCourseId),
      new: courseName(courseId),
    });
  if (initialPlan !== plan)
    changes.push({
      field: "plan",
      label: "Payment Plan",
      old: planLabel(initialPlan),
      new: planLabel(plan),
    });
  if (totalAmount !== initAmount)
    changes.push({
      field: "amount",
      label: "Total Amount (₹)",
      old: initAmount,
      new: totalAmount,
    });
  if (dueNow !== initI1)
    changes.push({
      field: "installment1_amount",
      label: "Amount Due Now (₹)",
      old: initI1,
      new: dueNow,
    });
  if (secondInstallment !== initI2)
    changes.push({
      field: "installment2_amount",
      label: "Second Installment (₹)",
      old: initI2,
      new: secondInstallment,
    });
  const hasChanges = changes.length > 0;

  const buildPaymentLink = () =>
    `${PAYMENT_LINK_BASE}?phone=${encodeURIComponent(learner.phone || "")}`;

  const waHref = (link: string) => {
    const digits = (learner.phone || "").replace(/\D/g, "");
    const waPhone = digits.length === 10 ? `91${digits}` : digits;
    const msg =
      `Hi ${learner.name || "there"}, here is your updated Lane payment link ` +
      `for ${courseName(courseId)} — ₹${dueNow} due now: ${link}`;
    return `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({
        title: "Copied",
        description: "Payment link copied to clipboard.",
      });
    } catch {
      toast({ title: "Copy failed", description: link, variant: "destructive" });
    }
  };

  const handleSaveClick = () => {
    if (!enrollment) return;
    if (totalAmount < 1 || dueNow < 1) {
      toast({
        title: "Invalid amount",
        description: "Total and amount due now must be at least ₹1.",
        variant: "destructive",
      });
      return;
    }
    if (!hasChanges) {
      toast({ title: "No changes detected", description: "Nothing to update." });
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!enrollment) return;
    setIsSaving(true);
    try {
      // 1. Update the enrollment in place — no new learner row is created.
      await updateEnrollment.mutateAsync({
        id: enrollment.id,
        updates: {
          course_id: courseId,
          amount: totalAmount,
          installment_mode: plan === "full" ? "full" : "installment",
          installment1_amount: dueNow,
          installment2_amount: secondInstallment,
          progress: {
            type: existingProgress?.type || "course",
            total_hours: totalLessons,
          },
        },
      });

      // 2. Append the audit row (best-effort: a logging failure must not lose
      //    the edit that already succeeded).
      try {
        await createAudit.mutateAsync({
          enrollment_id: enrollment.id,
          learner_id: learner.id,
          editor_id: editor?.id ?? null,
          editor_name: editor?.name || editor?.phone || "Unknown",
          reason: reason.trim() || null,
          changes,
        });
      } catch (e) {
        console.error("Failed to write plan-edit audit log", e);
      }

      // 3. Re-send the payment link. It's the same deterministic phone link,
      //    which now reflects the new amount because the payment page reads
      //    live enrollment data. Best-effort — the link is valid regardless,
      //    and copy / WhatsApp fallbacks are always shown below.
      const link = buildPaymentLink();
      try {
        await supabase.functions.invoke("send-payment-link-email", {
          body: {
            learnerEmail: learner.email,
            learnerName: learner.name,
            course: courseName(courseId),
            amount: dueNow,
            paymentLink: link,
          },
        });
        await supabase.functions.invoke("send-message", {
          body: {
            message_type: "PAYMENT_LINK",
            learner_id: learner.id,
            enrollment_id: enrollment.id,
            course_name: courseName(courseId),
            payment_amount: dueNow,
            duration: totalLessons,
            payment_link: link,
          },
        });
        toast({
          title: "Plan updated & link sent",
          description: `New link sent to ${learner.name || learner.phone}.`,
        });
      } catch (e) {
        console.error("Payment link dispatch failed", e);
        toast({
          title: "Plan updated — link not auto-sent",
          description:
            "Saved the new plan, but sending the link failed. Use Copy / WhatsApp below to share it.",
          variant: "destructive",
        });
      }

      setGeneratedLink(link);
      setReason("");
      setConfirmOpen(false);
    } catch (err: any) {
      toast({
        title: "Update failed",
        description:
          err?.message || "Could not update the plan. No changes saved.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!enrollment) {
    return (
      <div className="rounded-lg border-2 border-dashed border-orange-300 bg-orange-50 p-4">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-orange-600" />
          <p className="text-sm font-medium text-orange-800">No enrollment</p>
        </div>
        <p className="text-xs text-orange-600">
          This learner has no enrollment to edit. Create one through the normal
          payment flow first.
        </p>
      </div>
    );
  }

  if (hasReceivedPayment) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-red-300 bg-red-50 p-4">
          <div className="mb-1 flex items-center gap-2">
            <Lock className="h-4 w-4 text-red-600" />
            <p className="text-sm font-semibold text-red-800">
              Payment already received. Edits not permitted.
            </p>
          </div>
          <p className="text-xs text-red-600">
            Payment received on this record — contact support to make changes.
            Refunds and reversals are out of scope for this tool.
          </p>
        </div>
        <EditHistory enrollmentId={enrollment.id} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Phone is permanent */}
      <div className="rounded-lg border bg-gray-50 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5" />
          Phone (login ID) — permanent, cannot be changed
        </div>
        <p className="mt-1 text-sm font-medium">{learner.phone || "N/A"}</p>
      </div>

      {/* Plan fields */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Course / Package</Label>
          <Select value={courseId} onValueChange={setCourseId}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue placeholder="Select course" />
            </SelectTrigger>
            <SelectContent>
              {courseOptions.map((c) => (
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
            value={plan}
            onValueChange={(v) => setPlan(v as PaymentPlan)}
          >
            <SelectTrigger className="h-8 text-sm">
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
          <Label className="text-xs font-medium">Total Amount (₹)</Label>
          <Input
            type="number"
            min={1}
            value={totalAmount || ""}
            onChange={(e) => setTotalAmount(Number(e.target.value))}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">Amount Due Now (₹)</Label>
          {plan === "custom" ? (
            <Input
              type="number"
              min={1}
              value={customDueNow || ""}
              onChange={(e) => setCustomDueNow(Number(e.target.value))}
              className="h-8 text-sm"
            />
          ) : (
            <div className="flex h-8 items-center rounded-md border bg-gray-50 px-3 text-sm text-muted-foreground">
              ₹{dueNow}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            Second installment: ₹{secondInstallment}
          </p>
        </div>
      </div>

      {/* Internal note */}
      <div className="space-y-1">
        <Label className="text-xs font-medium">
          Reason / internal note (optional)
        </Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="text-sm"
          placeholder="e.g. customer switched from full to 50:50 split"
        />
        <p className="text-[10px] text-muted-foreground">
          Recorded in Edit History. Not sent to the customer.
        </p>
      </div>

      <Button
        onClick={handleSaveClick}
        disabled={isSaving || !hasChanges}
        size="sm"
        className="w-full"
      >
        <Send className="mr-2 h-4 w-4" />
        {hasChanges
          ? `Review ${changes.length} Change${changes.length > 1 ? "s" : ""} & Regenerate Link`
          : "No changes"}
      </Button>

      {/* Newly generated link */}
      {generatedLink && (
        <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-green-800">
            <Link2 className="h-4 w-4" /> New payment link
          </div>
          <p className="break-all rounded border bg-white p-2 text-xs">
            {generatedLink}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 bg-white text-xs"
              onClick={() => copyLink(generatedLink)}
            >
              <Copy className="mr-1 h-3.5 w-3.5" /> Copy
            </Button>
            <a
              href={waHref(generatedLink)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button
                size="sm"
                className="h-7 bg-green-600 text-xs hover:bg-green-700"
              >
                <MessageCircle className="mr-1 h-3.5 w-3.5" /> Share on WhatsApp
              </Button>
            </a>
          </div>
        </div>
      )}

      <EditHistory enrollmentId={enrollment.id} />

      {/* Confirmation modal (PRD §5.3) */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm plan change</DialogTitle>
            <DialogDescription>
              Review the changes before regenerating the payment link.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {changes.map((c) => (
              <div
                key={c.field}
                className="flex items-center justify-between rounded border p-2 text-sm"
              >
                <span className="text-muted-foreground">{c.label}</span>
                <span>
                  <span className="text-red-600 line-through">
                    {String(c.old)}
                  </span>{" "}
                  → <span className="font-medium text-green-700">{String(c.new)}</span>
                </span>
              </div>
            ))}
            {reason.trim() && (
              <p className="text-xs text-muted-foreground">
                Note: {reason.trim()}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              The link URL stays the same but now reflects the new amount, and a
              fresh link will be emailed + messaged to the customer.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={isSaving}>
              {isSaving ? "Saving..." : "Confirm & Regenerate Link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Collapsible append-only edit history for a learner's plan (PRD §5.4).
function EditHistory({ enrollmentId }: { enrollmentId: string }) {
  const { data: entries, isLoading } = useEnrollmentPlanAudit(enrollmentId);
  const [open, setOpen] = useState(false);
  const count = entries?.length || 0;

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between p-3 text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <History className="h-4 w-4" /> Edit History ({count})
        </span>
        <ChevronRight
          className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t p-3">
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : count === 0 ? (
            <p className="text-xs text-muted-foreground">
              No edits recorded yet.
            </p>
          ) : (
            entries!.map((e) => (
              <div key={e.id} className="rounded border p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {e.editor_name || "Unknown"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                {e.reason && (
                  <p className="mt-1 italic text-muted-foreground">
                    "{e.reason}"
                  </p>
                )}
                <ul className="mt-1 space-y-0.5">
                  {(e.changes || []).map((c, i) => (
                    <li key={i}>
                      <span className="text-muted-foreground">{c.label}: </span>
                      <span className="text-red-600 line-through">
                        {String(c.old)}
                      </span>
                      {" → "}
                      <span className="text-green-700">{String(c.new)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Schedules Viewer
function SchedulesViewer({ schedules }: { schedules: any[] }) {
  if (schedules.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">No schedules found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {schedules.map((schedule) => (
        <div
          key={schedule.id}
          className="flex items-center justify-between rounded-lg border p-3"
        >
          <div>
            <p className="text-sm font-medium">
              Lesson {schedule.Lesson?.number || "?"} - {schedule.date}
            </p>
            <p className="text-xs text-muted-foreground">
              {schedule.start_time} - {schedule.end_time}
              {schedule.Instructor?.name && ` • ${schedule.Instructor.name}`}
            </p>
          </div>
          <Badge
            variant={schedule.status === "completed" ? "default" : "secondary"}
          >
            {schedule.status}
          </Badge>
        </div>
      ))}
    </div>
  );
}

// Danger Zone - Bulk Delete Component
function DangerZone({
  learner,
  enrollmentsCount,
  paymentsCount,
  schedulesCount,
  onDeleteSuccess,
}: {
  learner: Learner;
  enrollmentsCount: number;
  paymentsCount: number;
  schedulesCount: number;
  onDeleteSuccess?: () => void;
}) {
  const deleteMutation = useDeleteLearnerAllData();
  const [confirmText, setConfirmText] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  const handleDelete = async () => {
    try {
      const result = await deleteMutation.mutateAsync({
        learnerId: learner.id,
        counts: {
          schedules: schedulesCount,
          enrollments: enrollmentsCount,
          payments: paymentsCount,
        },
      });
      alert(
        `Successfully deleted:\n` +
          `- ${result.schedules} schedule(s)\n` +
          `- ${result.enrollments} enrollment(s)\n` +
          `- ${result.payments} payment(s)\n` +
          `- Learner record`,
      );
      setIsOpen(false);
      setConfirmText("");
      onDeleteSuccess?.();
    } catch (error) {
      alert(
        `Failed to delete: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  };

  const totalRecords = 1 + enrollmentsCount + paymentsCount + schedulesCount;
  const expectedConfirmText = "DELETE";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <h3 className="font-semibold text-red-800">Danger Zone</h3>
        </div>
        <p className="mb-4 text-sm text-red-700">
          Actions in this section are <strong>irreversible</strong>. Please
          proceed with caution.
        </p>

        {/* Data Summary */}
        <div className="mb-4 rounded-lg border border-red-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium text-gray-700">
            Data that will be deleted:
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Learner:</span>
              <span className="font-medium">{learner.name || "No name"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phone:</span>
              <span className="font-medium">{learner.phone || "N/A"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Schedules:</span>
              <span className="font-medium">{schedulesCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Enrollments:</span>
              <span className="font-medium">{enrollmentsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payments:</span>
              <span className="font-medium">{paymentsCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Records:</span>
              <span className="font-bold text-red-600">{totalRecords}</span>
            </div>
          </div>
        </div>

        {/* Delete Button with Confirmation Dialog */}
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" className="w-full">
              <Trash2 className="mr-2 h-4 w-4" />
              Delete All Learner Data
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-5 w-5" />
                Confirm Permanent Deletion
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3">
                  <p>
                    You are about to permanently delete{" "}
                    <strong>all data</strong> for:
                  </p>
                  <div className="rounded-lg bg-gray-100 p-3 text-sm">
                    <p className="font-medium">
                      {learner.name || "Unnamed Learner"}
                    </p>
                    <p className="text-muted-foreground">{learner.phone}</p>
                  </div>
                  <p className="text-sm">This will delete:</p>
                  <ul className="list-inside list-disc space-y-1 text-sm">
                    <li>{schedulesCount} schedule(s)</li>
                    <li>{paymentsCount} payment(s)</li>
                    <li>{enrollmentsCount} enrollment(s)</li>
                    <li>1 learner record</li>
                  </ul>
                  <div className="pt-2">
                    <Label className="text-xs font-medium">
                      Type{" "}
                      <span className="font-bold text-red-600">DELETE</span> to
                      confirm:
                    </Label>
                    <Input
                      value={confirmText}
                      onChange={(e) => setConfirmText(e.target.value)}
                      placeholder="Type DELETE"
                      className="mt-1"
                    />
                  </div>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setConfirmText("");
                  setIsOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={
                  confirmText !== expectedConfirmText ||
                  deleteMutation.isPending
                }
              >
                {deleteMutation.isPending
                  ? "Deleting..."
                  : "Delete Permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Learner ID for reference */}
      <div className="rounded-lg bg-gray-50 p-3 text-xs">
        <p>
          <strong>Learner ID:</strong> {learner.id}
        </p>
        <p>
          <strong>Created:</strong>{" "}
          {new Date(learner.created_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
