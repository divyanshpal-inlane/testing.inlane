import { ScrollArea } from "@radix-ui/react-scroll-area";
import { useQueryClient } from "@tanstack/react-query";
import {
  addDays,
  formatDuration,
  intervalToDuration,
  isAfter,
  isBefore,
  max,
  set,
  subDays,
} from "date-fns";
import { format } from "date-fns";
import {
  ArrowRight,
  BookOpen,
  CheckCircle,
  Clock,
  Lock,
  Phone,
  RefreshCw,
  Scroll,
  Star,
  ThumbsUp,
  User,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import LLFlow from "@/components/ll_flow";
import { PostLLHomeCard } from "@/components/ll_flow/DLJourney";
import PaymentStatusCard from "@/components/payment/PaymentStatusCard";
import { SessionDetails } from "@/components/SessionDetails";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { LESSON_CONTENT } from "@/constants/Lesson";
import { SALES_PHONE_TEL, telHref } from "@/constants/support";
import { supabase } from "@/lib/supabaseClient";
// useUpdateScheduleStatus removed — lesson status changes are handled by instructor OTP flow only
import {
  useLearner,
  useLearnerEnrollment,
  useLearnerSchedule,
  useLearnerUpdate,
  useLessonSchedule,
  useUpcomingLesson,
} from "@/queries/learner";
import { usePaymentsByLearner } from "@/queries/payment";
import { useLearnerRescheduleRequests } from "@/queries/preferences";
import { useCompletedRescheduleRequests } from "@/queries/schedule-requests";

const isWithin30MinutesOfLesson = (
  scheduleDate: string,
  scheduleTime: string,
) => {
  if (!scheduleDate || !scheduleTime) return false;
  const lessonTime = new Date(`${scheduleDate}T${scheduleTime}`);
  const now = new Date();
  const diffInMinutes = (lessonTime.getTime() - now.getTime()) / (1000 * 60);
  return diffInMinutes <= 30;
};

const isLessonCompleted = (lesson) => {
  return lesson?.status?.toUpperCase() === "COMPLETED";
};

export default function Home() {
  const navigate = useNavigate();

  const { data: learner, isLoading, error } = useLearner();
  const { data: enrolledCourse, isLoading: isEnrolledCourseLoading } =
    useLearnerEnrollment({ learnerId: learner?.id });

  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const { data: scheduleRequests, isLoading: scheduleRequestsLoading } =
    useLearnerRescheduleRequests(learner?.id);
  const {
    data: LessonData,
    isLoading: LessonIsLoading,
    error: LessonError,
  } = useUpcomingLesson();
  const [showLessonDialog, setShowLessonDialog] = useState(false);
  const [showEndLessonDialog, setShowEndLessonDialog] = useState(false);
  const [showNoLLConfirmDialog, setShowNoLLConfirmDialog] = useState(false);
  const { data: lessonSchedule } = useLessonSchedule({
    lessonId: LessonData?.upcomingLesson?.id,
  });

  const isDemo = enrolledCourse?.progress?.type === "demo";
  const isCustom = enrolledCourse?.progress?.type === "custom";
  // A custom-course payment pre-creates the pending "new" scheduling request
  // (with no course_id, lesson_ids is the only way admin learns how many hours
  // to book — see complete-payment's custom branch). A predefined course has no
  // such request until the learner finishes onboarding, so the presence of one
  // must NOT be read as "already onboarded" here: otherwise the LL flow, pickup
  // location, start-date questions and availability screens below are all
  // skipped and admin gets a learner it can't actually schedule.
  const needsScheduleOnboarding =
    isCustom &&
    (!learner?.LL_received ||
      !learner?.address_lat ||
      !learner?.address_lng ||
      !learner?.preferred_start_date);
  const { data: scheduledLessons } = useLearnerSchedule({
    learnerId: learner?.id,
    courseId: enrolledCourse?.course_id,
    isDemo,
  });
  const { data: completedReschedules } = useCompletedRescheduleRequests(
    learner?.id,
  );
  // Lesson status updates are handled exclusively by instructor OTP verification
  const { mutate: updateLearner } = useLearnerUpdate();
  const queryClient = useQueryClient();
  const maxNumLessonsOnHalfInstallment = 1;
  const numWaiveredLessonUnlocked = 1;
  const { data: payments, isLoading: paymentLoading } = usePaymentsByLearner(
    learner?.id,
  );

  // Find the latest completed payment (course, custom, or demo)
  const completedPayment = Array.isArray(payments)
    ? payments
        .filter(
          (payment: { payment_type: string; status: string }) =>
            ["course", "custom", "demo"].includes(payment.payment_type) &&
            payment.status === "completed",
        )
        .sort(
          (a: { created_at: string }, b: { created_at: string }) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]
    : null;

  const isCompleted =
    completedPayment && completedPayment?.status === "completed";

  // Check if user has half or full payment via enrollment
  const hasHalfOrFullPayment =
    enrolledCourse?.payment_status === "half_paid" ||
    enrolledCourse?.payment_status === "full_paid";

  if (paymentLoading || isLoading) {
    return <div>Loading...</div>;
  }

  // FIRST: Check if onboarding is complete (before checking payment)
  if (!learner?.onboarding_completed) {
    if (!learner?.dob) return <Navigate to="/onboard/birthday" />;
    if (!learner?.driving_motivation) {
      return <Navigate to="/onboard/aadhar" />;
    }
    return <Navigate to="/onboard/signature" />;
  }

  // THEN: Check if payment is complete or half/full paid via enrollment
  if (!isCompleted && !hasHalfOrFullPayment) {
    return (
      <div className="container mx-auto max-w-md py-8">
        <PaymentStatusCard />
      </div>
    );
  }

  // Demo learners need pickup coords before admin can match an instructor.
  // Redirect to the address capture page immediately so this check can't be
  // bypassed by a later short-circuit (e.g. the scheduleRequests-based
  // "Schedule is Being Created" branch below).
  if (isDemo && (!learner?.address_lat || !learner?.address_lng)) {
    return <Navigate to="/createSchedule/details?type=demo" />;
  }

  // After payment is complete, check if DL question has been answered
  const handleDLResponse = (hasDL: boolean) => {
    if (hasDL) {
      // User has a DL - they already have LL
      updateLearner({
        LL_result: true,
        has_a_DL: true,
        LL_received: true,
      });
    } else {
      // User does not have a DL - needs to go through LL flow
      updateLearner({
        LL_result: null,
        has_a_DL: false,
      });
    }
  };

  // Show DL question if not answered yet (has_a_DL is null/undefined)
  // Skip for demo learners — they don't need LL for a demo lesson
  if (
    !isDemo &&
    (learner?.has_a_DL === null || learner?.has_a_DL === undefined)
  ) {
    return (
      <div className="flex h-full w-full flex-col">
        <header className="relative h-[300px]">
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            <img
              src="/assets/lesson1.png"
              alt="Four-wheeler with driver"
              className="h-full w-full object-fill"
            />
          </div>
        </header>
        <div className="flex h-full flex-col gap-6 p-6">
          <div className="flex flex-col items-center">
            <h2 className="text-center text-2xl font-semibold">
              Do you have a Driving License for a Four Wheeler?
            </h2>
            <p className="mt-2 text-center text-muted-foreground">
              Let us know to proceed with scheduling your lessons
            </p>
          </div>
          <div className="flex flex-col gap-4">
            <Button className="w-full" onClick={() => handleDLResponse(true)}>
              Yes, I have a DL
            </Button>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => handleDLResponse(false)}
            >
              No, I need to get LL first
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const localStorageInitOnce = (local_var_name: string) => {
    if (localStorage.getItem(local_var_name)) {
      return;
    }
    if (!learner) return;
    switch (local_var_name) {
      case "onboardingDone":
        localStorage.setItem(
          local_var_name,
          learner.onboarding_completed ? "true" : "false",
        );
        break;
      case "schedulePreferencesUpdated":
        localStorage.setItem(
          local_var_name,
          learner.preferred_start_date ? "true" : "false",
        );
        break;
      default:
        break;
    }
  };
  localStorageInitOnce("onboardingDone");
  localStorageInitOnce("schedulePreferencesUpdated");

  // Note: Onboarding check is now done earlier in the component (before payment check)

  if (
    isLoading ||
    LessonIsLoading ||
    scheduleRequestsLoading ||
    isEnrolledCourseLoading
  ) {
    return <div>Loading...</div>;
  }

  if (error || LessonError) {
    return <p>Error: {error?.message || LessonError?.message}</p>;
  }

  // Show payment completion prompt for half-paid enrollments
  const showPaymentCompletion =
    enrolledCourse?.payment_status === "half_paid" &&
    scheduledLessons &&
    scheduledLessons.some(
      (scheduleItem) =>
        // find the highest unlocked lesson number and check its status
        scheduleItem.lesson?.number === maxNumLessonsOnHalfInstallment &&
        scheduleItem.status?.toUpperCase() === "COMPLETED",
    );
  // if (showPaymentCompletion) {
  //   return (
  //     <div className="mb-6">
  //       <ReminderFullPayment learner />
  //     </div>
  //   );
  // }
  // For half installment,  locked lesson can be started
  const enabledLessonForInstallmentStatus = (
    lessonNumber: number | null,
  ): boolean => {
    if (!lessonNumber) return false;
    if (
      enrolledCourse?.payment_status === "completed" ||
      enrolledCourse?.payment_status === "full_paid"
    )
      return true;
    // Check that the lesson number is within unlocked + waivered range
    return (
      lessonNumber <= maxNumLessonsOnHalfInstallment + numWaiveredLessonUnlocked
    );
  };
  const isWaiveredLesson = (lessonNumber: number | null | undefined) => {
    if (!lessonNumber) return false;
    // Only show waivered message if payment is half_paid (not full_paid or completed)
    const isHalfPaid = enrolledCourse?.payment_status === "half_paid";
    return (
      isHalfPaid &&
      lessonNumber > maxNumLessonsOnHalfInstallment &&
      enabledLessonForInstallmentStatus(lessonNumber)
    );
  };

  const isRescheduleForUpcomingLesson =
    scheduleRequests &&
    scheduleRequests.length > 0 &&
    LessonData?.upcomingLesson &&
    scheduleRequests.some(
      (request) => request.lesson_id === LessonData.upcomingLesson.id,
    );

  // Helper: count lesson-hours (2hr class = 2 lessons)
  const countLessonHours = (
    lessons: typeof scheduledLessons,
    filter?: (l: NonNullable<typeof scheduledLessons>[number]) => boolean,
  ) => {
    if (!lessons) return 0;
    const filtered = filter ? lessons.filter(filter) : lessons;
    return filtered.reduce((sum, l) => {
      const sMin =
        parseInt(l.startTime?.split(":")[0] || "0") * 60 +
        parseInt(l.startTime?.split(":")[1] || "0");
      const eMin =
        parseInt(l.endTime?.split(":")[0] || "0") * 60 +
        parseInt(l.endTime?.split(":")[1] || "0");
      return sum + Math.max(1, Math.round((eMin - sMin) / 60));
    }, 0);
  };

  // Course progress calculations
  const totalCourseLessons = enrolledCourse?.Courses?.total_lessons || 10;
  const completedLessonsCount = countLessonHours(
    scheduledLessons,
    (l) => l.status?.toUpperCase() === "COMPLETED",
  );
  const scheduledLessonsCount = countLessonHours(scheduledLessons);

  // For half payment, calculate accessible lessons
  const accessibleLessonsCount =
    enrolledCourse?.payment_status === "half_paid"
      ? maxNumLessonsOnHalfInstallment + numWaiveredLessonUnlocked
      : totalCourseLessons;

  // Render course progress card
  const renderCourseProgressCard = () => {
    // Don't show for demo/custom courses without proper course data
    if (
      enrolledCourse?.progress?.type === "demo" ||
      enrolledCourse?.progress?.type === "custom" ||
      !enrolledCourse?.course_id
    ) {
      return null;
    }

    // Don't show if no scheduled lessons yet
    if (!scheduledLessons || scheduledLessons.length === 0) {
      return null;
    }

    const progressPercentage = Math.min(
      100,
      Math.round((completedLessonsCount / totalCourseLessons) * 100),
    );

    return (
      <Card className="mb-4 border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-primary" />
              <span className="font-medium">Course Progress</span>
            </div>
            <span className="text-sm text-muted-foreground">
              {completedLessonsCount} of {totalCourseLessons} lessons
            </span>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>

          {/* Status indicators */}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-green-100 px-2 py-1 text-green-700">
              {completedLessonsCount} Completed
            </span>
            <span className="rounded-full bg-blue-100 px-2 py-1 text-blue-700">
              {scheduledLessonsCount - completedLessonsCount} Scheduled
            </span>

            {/* Rescheduled indicator with popover */}
            {completedReschedules && completedReschedules.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button className="flex cursor-pointer items-center gap-1 rounded-full bg-purple-100 px-2 py-1 text-purple-700 transition-colors hover:bg-purple-200">
                    <RefreshCw className="h-3 w-3" />
                    {completedReschedules.length} Rescheduled
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3">
                  <h4 className="mb-2 font-semibold text-gray-700">
                    Reschedule History
                  </h4>
                  <div className="max-h-48 space-y-2 overflow-y-auto">
                    {completedReschedules.map((reschedule) => {
                      const lessonNumbers = reschedule.lesson_ids
                        .map((id) => {
                          const lesson = scheduledLessons?.find(
                            (l) => l.lessonId === id,
                          );
                          return lesson?.lesson?.number;
                        })
                        .filter(Boolean);

                      return (
                        <div
                          key={reschedule.id}
                          className="rounded-md border border-gray-100 bg-gray-50 p-2 text-sm"
                        >
                          <div className="font-medium text-purple-700">
                            Lesson{lessonNumbers.length > 1 ? "s" : ""}{" "}
                            {lessonNumbers.join(", ") || "N/A"}
                          </div>
                          <div className="text-xs text-gray-500">
                            {reschedule.updated_at
                              ? format(
                                  new Date(reschedule.updated_at),
                                  "MMM d, yyyy",
                                )
                              : "Date unknown"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Half payment indicator */}
            {enrolledCourse?.payment_status === "half_paid" && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                <Lock className="h-3 w-3" />
                {totalCourseLessons - accessibleLessonsCount} Locked (Payment)
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderLesson1ScheduleState = () => (
    <div className="flex flex-col items-center gap-6 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-6">
          <div className="relative">
            <Clock size={48} className="animate-pulse" />
            <div className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full" />
          </div>
          <h2 className="text-center text-2xl font-semibold">
            Your Schedule is Being Created
          </h2>
          <p className="text-center text-muted-foreground">
            Our team is working on crafting your perfect learning schedule.
            While you wait, play some learning games!
          </p>
        </CardContent>
      </Card>

      <Button
        className="flex w-full max-w-md items-center justify-between gap-2 p-6"
        onClick={() => navigate("/prep")}
      >
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5" />
          <span>Start Your Prep Work</span>
        </div>
        <ArrowRight className="h-5 w-5" />
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        We'll notify you once your schedule is ready.
      </p>
    </div>
  );

  const renderScheduleCreationState = () => (
    <div className="flex flex-col items-center gap-6 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 p-6">
          <div className="relative">
            <Clock size={48} className="animate-pulse" />
            <div className="absolute -right-1 -top-1 h-3 w-3 animate-ping rounded-full" />
          </div>
          <h2 className="text-center text-2xl font-semibold">
            Your Schedule is Being Created
          </h2>
          <p className="text-center text-muted-foreground">
            Our team is working on crafting your perfect learning schedule.
            While you wait, play some learning games!
          </p>
        </CardContent>
      </Card>

      <Button
        className="flex w-full max-w-md items-center justify-between gap-2 p-6"
        onClick={() => navigate("/prep")}
      >
        <div className="flex items-center gap-3">
          <BookOpen className="h-5 w-5" />
          <span>Start Your Prep Work</span>
        </div>
        <ArrowRight className="h-5 w-5" />
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        We'll notify you once your schedule is ready.
      </p>

      <h3
        className="**px-4** cursor-pointer rounded bg-primary py-2 text-center text-sm text-white"
        onClick={() => setShowPolicyModal(true)}
      >
        Rescheduling Policy
      </h3>
      {showPolicyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-11/12 max-w-md rounded-lg bg-white p-6 shadow-lg">
            <h2 className="mb-2 text-lg font-bold">Rescheduling Policy</h2>
            <ul className="mb-4 list-disc pl-5 text-sm text-gray-800">
              <li>
                Rescheduling within 10 hours of lesson start time will incur a
                charge of ₹300.
              </li>
              <li>Rescheduling more than 10 hours in advance is free.</li>
            </ul>
            <button
              className="mt-2 rounded bg-black px-4 py-2 text-white hover:bg-gray-900"
              onClick={() => setShowPolicyModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
  const renderUpcomingLessonReschedulePending = () => {
    return (
      <div className="flex flex-col gap-2 p-4 text-center text-xl">
        <p>
          Here is your upcoming lesson!
          <br />
          <small>(Reschedule requested)</small>
        </p>
        <h2 className="text-lg font-semibold">
          {isDemo
            ? "Demo Lesson"
            : (LESSON_CONTENT[
                LessonData?.upcomingLesson
                  ?.number as keyof typeof LESSON_CONTENT
              ]?.content?.title ??
              `Lesson ${LessonData?.upcomingLesson?.number}`)}
        </h2>
        <Button
          onClick={() => navigate(`/lesson/${LessonData?.upcomingLesson?.id}`)}
          variant="outline"
          className="grow"
        >
          Lesson Details
        </Button>
      </div>
    );
  };

  const renderPausedLesson = () => {
    return (
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <div className="rounded-full bg-amber-100 p-4">
          <Clock className="h-10 w-10 text-amber-600" />
        </div>
        <h2 className="text-xl font-semibold text-amber-800">
          Your Class Has Been Paused
        </h2>
        <p className="text-sm text-muted-foreground">
          Your upcoming lessons have been paused. Please contact the team to
          resume your classes.
        </p>
        <Card className="w-full max-w-sm border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-amber-900">
              Contact us at{" "}
              <a
                href="mailto:team@inlane.in"
                className="text-primary underline"
              >
                team@inlane.in
              </a>
            </p>
            <p className="mt-1 text-sm text-amber-700">
              or call{" "}
              <a href="tel:+919876543210" className="text-primary underline">
                +91 98765 43210
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderUpcomingLesson = () => {
    return (
      <div className="flex flex-col gap-2 p-4 text-center text-xl">
        <p>Here is your upcoming lesson!</p>
        {enrolledCourse?.payment_status === "half_paid" && (
          <Alert className="mb-4 border-primary bg-white">
            <AlertDescription>
              You have paid the first installment. Some lessons are locked until
              you complete the payment.
              <Button
                variant="link"
                className="h-auto p-0 text-primary"
                onClick={() => navigate(`/payment?phone=${learner?.phone}`)}
              >
                Pay remaining amount
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {isWaiveredLesson(LessonData?.upcomingLesson?.number) && (
          <Alert className="mb-4 border-primary bg-white">
            <AlertDescription>
              We're unlocking the current lesson, but make payment before next
              lesson
            </AlertDescription>
          </Alert>
        )}
        {LessonData?.upcomingSchedule &&
          LessonData?.instructor &&
          LessonData?.upcomingLesson && (
            <SessionDetails
              schedule={LessonData.upcomingSchedule}
              instructor={LessonData.instructor}
              lessonNumber={LessonData.upcomingLesson.number ?? 0}
              lessonEndNumber={LessonData.upcomingLesson.endNumber}
              lessonLabel={
                isDemo
                  ? "Demo Lesson"
                  : enrolledCourse?.progress?.type === "topup"
                    ? `Topup Lesson ${LessonData.upcomingLesson.number ?? ""}`
                    : undefined
              }
              scheduleType={
                isDemo
                  ? "demo"
                  : enrolledCourse?.progress?.type === "topup"
                    ? "topup"
                    : "course"
              }
            />
          )}
        <h2 className="text-lg font-semibold">
          {isDemo
            ? "Demo Lesson"
            : (LESSON_CONTENT[
                LessonData?.upcomingLesson
                  ?.number as keyof typeof LESSON_CONTENT
              ]?.content?.title ??
              `Lesson ${LessonData?.upcomingLesson?.number}`)}
        </h2>

        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-row flex-wrap gap-4">
            <Button
              onClick={() => {
                navigate(`/lesson/${LessonData?.upcomingLesson?.id}`);
              }}
              variant="outline"
              className="grow"
            >
              Lesson Details
            </Button>
          </div>

          <Button
            onClick={() =>
              navigate(`/reschedule/${LessonData?.upcomingSchedule?.lesson_id}`)
            }
            variant="secondary"
            className="w-full"
          >
            Reschedule Lesson
          </Button>
          <h3
            className="cursor-pointer text-center text-sm text-black"
            onClick={() => setShowPolicyModal(true)}
          >
            Rescheduling Policy
          </h3>
          {showPolicyModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
              <div className="w-11/12 max-w-md rounded-lg bg-white p-6 shadow-lg">
                <h2 className="mb-2 text-lg font-bold">Rescheduling Policy</h2>
                <ul className="mb-4 list-disc pl-5 text-sm text-gray-800">
                  <li>
                    Rescheduling within 10 hours of lesson start time will incur
                    a charge of ₹300.
                  </li>
                  <li>Rescheduling more than 10 hours in advance is free.</li>
                </ul>
                <button
                  className="mt-2 rounded bg-black px-4 py-2 text-white hover:bg-gray-900"
                  onClick={() => setShowPolicyModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* OTP is now sent directly to learner's WhatsApp by the instructor */}
        </div>
      </div>
    );
  };

  const renderCourseCompletionPage = () => (
    <div className="flex flex-col items-center gap-6 p-4 text-center">
      <div className="relative w-full max-w-md overflow-hidden rounded-lg bg-primary p-6 text-white">
        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="flex items-center justify-center rounded-full bg-white/20 p-4">
            <ThumbsUp size={48} className="text-white" />
          </div>

          <h1 className="text-3xl font-bold">Congratulations!</h1>
          <p className="text-xl">
            You've successfully completed all your driving lessons!
          </p>

          <div className="mt-2 flex">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                size={24}
                className="fill-yellow-300 text-yellow-300"
              />
            ))}
          </div>
        </div>
      </div>

      <Card className="w-full max-w-md border-primary">
        <CardHeader className="pb-2">
          <CardTitle className="text-center text-primary">
            Share Your Experience
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground">
            Your feedback helps us improve and helps other learners find us!
          </p>

          <Button
            className="hover:bg-primary-dark w-full bg-primary"
            onClick={() =>
              window.open(
                "https://www.google.com/search?sca_esv=71235db9e3242676&si=APYL9bs7Hg2KMLB-4tSoTdxuOx8BdRvHbByC_AuVpNyh0x2KzQJRCGdyjVAeNpxL_v1ZJZEWLK7nyCxTAIrR2ZeCA8k7wV6unj_LsaY0pK3KhDrig-Qd3VV0QeYWcHIDk8lUXQkgAYTsMeCD1sZwXyhyJceUV-g5VQ%3D%3D&q=Lane+Driving+School+Platform+Reviews&sa=X&ved=2ahUKEwj6q7mT2OGMAxUkcGwGHcpIMqkQ0bkNegQIHxAD&biw=1920&bih=968&dpr=2#lrd=0x4cdc767dad33a5fd:0xda0c670666b6e2c2,3,,,,",
                "_blank",
              )
            }
          >
            Leave a Google Review
          </Button>
        </CardContent>
      </Card>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        Need help? Contact our support team at{" "}
        <a href="mailto:team@inlane.in" className="text-primary underline">
          team@inlane.in
        </a>
      </p>
    </div>
  );

  const lesson9 = scheduledLessons?.find(
    (lesson) => lesson.lesson?.number === 9,
  );
  const lesson10 = scheduledLessons?.find(
    (lesson) => lesson.lesson?.number === 10,
  );

  const isLesson9Completed = lesson9 && isLessonCompleted(lesson9);
  const isLesson10Completed = lesson10 && isLessonCompleted(lesson10);

  // Check if all lessons are completed
  const allLessonsCompleted =
    scheduledLessons &&
    scheduledLessons.length === 10 &&
    scheduledLessons.every((lesson) => isLessonCompleted(lesson));

  if (
    scheduleRequests?.length > 0 &&
    !LessonData?.upcomingLesson &&
    !needsScheduleOnboarding
  ) {
    // lesson 1 getting scheduled
    return (
      <div className="flex min-h-screen flex-col">
        {/* Static header */}
        <header className="sticky top-0 z-10 flex items-center justify-between p-4">
          <h1 className="text-2xl font-medium">
            Hi {learner?.name || "Learner"}!
          </h1>
          <Link to="/profile" className="rounded-full bg-white p-1">
            <User size={24} className="hover:text-primary-dark text-primary" />
          </Link>
        </header>

        {renderLesson1ScheduleState()}
      </div>
    );
  }

  // Start lesson details
  const handleStartLessonDetailsClose = () => {
    setShowLessonDialog(false);
  };
  const renderStartLessonDialog = () => {
    return (
      <Dialog open={showLessonDialog} onOpenChange={setShowLessonDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Start Lesson</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {isDemo
                  ? "Demo Lesson"
                  : enrolledCourse?.progress?.type === "topup"
                    ? `Topup Lesson ${LessonData?.upcomingLesson?.number ?? ""}`
                    : `Lesson ${LessonData?.upcomingLesson?.number}${LessonData?.upcomingLesson?.endNumber ? ` & ${LessonData.upcomingLesson.endNumber}` : ""} - ${LessonData?.course?.name}`}
              </p>
              <p className="text-sm text-muted-foreground">
                Share this OTP with your instructor to start the lesson
              </p>
              {(() => {
                const otpTheme = isDemo
                  ? { bg: "bg-blue-50", text: "text-blue-600" }
                  : enrolledCourse?.progress?.type === "topup"
                    ? { bg: "bg-purple-50", text: "text-purple-600" }
                    : { bg: "bg-green-50", text: "text-green-600" };
                return (
                  <div className={`rounded-lg ${otpTheme.bg} px-6 py-4`}>
                    <p
                      className={`text-center text-3xl font-bold tracking-widest ${otpTheme.text}`}
                    >
                      {LessonData?.upcomingSchedule?.otp}
                    </p>
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleStartLessonDetailsClose} variant="secondary">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  // End lesson is handled by instructor via OTP verification only
  const handleEndLessonDetailsClose = () => {
    console.log("schedule details ", LessonData?.upcomingSchedule);
    setShowEndLessonDialog(false);
  };
  const renderEndLessonDialog = () => {
    const endOtp =
      LessonData?.upcomingSchedule?.otp_end ||
      LessonData?.upcomingSchedule?.otp;
    return (
      <Dialog open={showEndLessonDialog} onOpenChange={setShowEndLessonDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>End Lesson</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {isDemo
                  ? "Demo Lesson"
                  : `Lesson ${LessonData?.upcomingLesson?.number}${LessonData?.upcomingLesson?.endNumber ? ` & ${LessonData.upcomingLesson.endNumber}` : ""} - ${LessonData?.course?.name}`}
              </p>
              <p className="text-sm text-muted-foreground">
                Share this OTP with your instructor to end the lesson
              </p>
              <div className="rounded-lg bg-orange-50 px-6 py-4">
                <p className="text-center text-3xl font-bold tracking-widest text-orange-600">
                  {endOtp}
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleEndLessonDetailsClose} variant="secondary">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  // Lesson completion is handled exclusively by instructor via OTP verification

  return (
    <div className="flex min-h-screen flex-col">
      {/* Static header */}
      <header className="sticky top-0 z-10 flex items-center justify-between p-4">
        <h1 className="text-2xl font-medium">
          Hi {learner?.name || "Learner"}!
        </h1>
        <Link to="/profile" className="rounded-full bg-white p-1">
          <User size={24} className="hover:text-primary-dark text-primary" />
        </Link>
      </header>

      <main
        className="scrollbar-none flex h-[calc(100vh-50px)] flex-col overflow-y-auto p-4 pb-20"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Course Progress Card */}
        {/* Post-LL journey surface: DL-test states for learners who moved on
            to classes, or the 30-day LL-expiry warning. */}
        {learner?.LL_received && <PostLLHomeCard />}

        {renderCourseProgressCard()}

        {allLessonsCompleted ? (
          renderCourseCompletionPage()
        ) : (
          <>
            {LessonData?.upcomingSchedule?.status?.toUpperCase() ===
            "PAUSED" ? (
              <div className="mb-6">{renderPausedLesson()}</div>
            ) : LessonData?.upcomingSchedule?.status === "pending_payment" ? (
              <div className="mb-6">
                <Card className="border-amber-300 bg-amber-50">
                  <CardContent className="flex flex-col items-center gap-4 p-6">
                    <div className="rounded-full bg-amber-100 p-3">
                      <Clock size={32} className="text-amber-600" />
                    </div>
                    <h2 className="text-lg font-semibold text-amber-800">
                      {isDemo ? "Demo Lesson" : "Topup Class"} Scheduled
                    </h2>
                    <p className="text-center text-sm text-amber-700">
                      Pay ₹1 to activate your{" "}
                      {isDemo ? "demo lesson" : "topup class"} on{" "}
                      {LessonData?.upcomingSchedule?.date
                        ? format(
                            new Date(LessonData.upcomingSchedule.date),
                            "EEE, do MMM",
                          )
                        : ""}
                    </p>
                    <Button
                      className="w-full bg-amber-600 hover:bg-amber-700"
                      onClick={() =>
                        navigate(`/payment?phone=${learner?.phone}&type=demo`)
                      }
                    >
                      Pay ₹1 Now
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : LessonData?.upcomingLesson ? (
              <div className="mb-6">{renderUpcomingLesson()}</div>
            ) : (
              <p className="text-center">
                {" "}
                {learner?.LL_received && scheduleRequests?.length > 0
                  ? "No upcoming lesson"
                  : ""}
              </p>
            )}
            {!LessonData?.upcomingLesson &&
              (needsScheduleOnboarding ||
                !(scheduleRequests && scheduleRequests.length > 0)) && (
                <>
                  {learner && !learner.LL_received && !isDemo ? (
                    <LLFlow />
                  ) : learner ? (
                    // Demo course handling
                    isDemo ? (
                      (() => {
                        const completedDemoCount =
                          scheduledLessons?.filter(
                            (l) => l.status?.toUpperCase() === "COMPLETED",
                          ).length ?? 0;
                        const demoCompleted = completedDemoCount > 0;
                        // If demo learner hasn't captured pickup address yet,
                        // route them through the same /createSchedule/details
                        // flow as regular learners. Without this, admin can't
                        // assign an instructor (no coords for radius/distance).
                        const hasPickupCoords =
                          learner?.address_lat && learner?.address_lng;
                        if (!demoCompleted && !hasPickupCoords) {
                          return (
                            <div className="flex grow flex-col gap-4 p-4 pb-0 text-center text-xl">
                              <img
                                src="/assets/clocks.png"
                                alt="First Lesson"
                                className="w-full rounded-lg"
                              />
                              <p>
                                Ready for your demo lesson? We just need a few
                                more details.
                              </p>
                              <Button className="w-full" asChild>
                                <Link to="/createSchedule/details?type=demo">
                                  Set your pickup location
                                </Link>
                              </Button>
                              <p className="text-base">
                                Share where you&apos;d like to be picked up so
                                we can assign the closest instructor.
                              </p>
                            </div>
                          );
                        }
                        if (demoCompleted) {
                          return (
                            <div className="flex grow flex-col items-stretch gap-4 p-4 pb-0">
                              <div className="flex flex-col items-center gap-2 text-center">
                                <div className="rounded-full bg-green-100 p-4">
                                  <CheckCircle className="h-12 w-12 text-green-600" />
                                </div>
                                <h2 className="text-xl font-semibold">
                                  One class down. Ready for next step?
                                </h2>
                              </div>

                              <Button asChild className="w-full gap-2">
                                <a href={telHref(SALES_PHONE_TEL)}>
                                  <Phone className="h-5 w-5" />
                                  Chat with Sales
                                </a>
                              </Button>
                            </div>
                          );
                        }
                        // Demo not yet scheduled or scheduled but not completed
                        return (
                          <div className="flex grow flex-col items-center gap-4 p-4 pb-0 text-center">
                            <img
                              src="/assets/clocks.png"
                              alt="Schedule"
                              className="w-48 rounded-lg"
                            />
                            <h2 className="text-xl font-semibold">
                              {scheduledLessons && scheduledLessons.length > 0
                                ? "Your Demo Lesson is Scheduled"
                                : "Your Demo Lesson is Being Scheduled"}
                            </h2>
                            <p className="text-muted-foreground">
                              {scheduledLessons && scheduledLessons.length > 0
                                ? "Check your schedule for the upcoming demo lesson details."
                                : "Our team is scheduling your demo lesson. We'll notify you once it's ready."}
                            </p>
                          </div>
                        );
                      })()
                    ) : // Custom course or no course_id. Only a learner who has
                    // finished onboarding waits here — one still missing pickup
                    // coords or availability must fall through to the
                    // "Set your schedule" CTA below, or they'd be parked on a
                    // dead-end screen with nothing for admin to schedule.
                    !needsScheduleOnboarding &&
                      (enrolledCourse?.progress?.type === "custom" ||
                        !enrolledCourse?.course_id) &&
                      learner.preferred_start_date ? (
                      <div className="flex grow flex-col items-center gap-4 p-4 pb-0 text-center">
                        <img
                          src="/assets/clocks.png"
                          alt="Schedule"
                          className="w-48 rounded-lg"
                        />
                        <h2 className="text-xl font-semibold">
                          Your Schedule is Being Created
                        </h2>
                        <p className="text-muted-foreground">
                          Our team is working on crafting your perfect learning
                          schedule. We&apos;ll notify you once your schedule is
                          ready.
                        </p>
                      </div>
                    ) : scheduledLessons && scheduledLessons.length === 0 ? (
                      <div className="flex grow flex-col gap-4 p-4 pb-0 text-center text-xl">
                        <img
                          src="/assets/clocks.png"
                          alt="First Lesson"
                          className="w-full rounded-lg"
                        />
                        <p>
                          Ready for your first lesson? We just need a few more
                          details
                        </p>
                        <Button className="w-full" asChild>
                          <Link to="/createSchedule/details">
                            Set your schedule
                          </Link>
                        </Button>
                        <p className="text-base">
                          Share your availability, and we&apos;ll book your
                          lessons
                        </p>

                        <p className="mt-auto">
                          <span className="text-base">
                            Don&apos;t have an LL?
                          </span>
                          <Button
                            variant="link"
                            onClick={() => setShowNoLLConfirmDialog(true)}
                          >
                            Book appointment
                          </Button>
                        </p>

                        {/* Confirmation Dialog for "Don't have an LL" */}
                        <Dialog
                          open={showNoLLConfirmDialog}
                          onOpenChange={setShowNoLLConfirmDialog}
                        >
                          <DialogContent className="sm:max-w-[425px]">
                            <DialogHeader>
                              <DialogTitle>
                                Go Back to LL Application
                              </DialogTitle>
                              <DialogDescription>
                                Are you sure you don&apos;t have a
                                Learner&apos;s License (LL)? By confirming, you
                                will be redirected to the LL application
                                process.
                              </DialogDescription>
                            </DialogHeader>
                            <DialogFooter className="flex gap-2 sm:gap-0">
                              <Button
                                variant="outline"
                                onClick={() => setShowNoLLConfirmDialog(false)}
                              >
                                Cancel
                              </Button>
                              <Button
                                onClick={() => {
                                  // Reset LL fields to go back to LL application flow
                                  updateLearner({
                                    has_a_DL: false,
                                    LL_received: false,
                                    LL_result: null,
                                    LL_team_appointment_booked: null,
                                    LL_application_approved: null,
                                  });
                                  setShowNoLLConfirmDialog(false);
                                }}
                              >
                                Yes, I need an LL
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    ) : (
                      <div className="mt-24 text-center text-xl">
                        {learner?.LL_received_date
                          ? `Your LL was issued on ${learner.LL_received_date}.\n`
                          : ""}
                        You can apply for the Driver licence test after 30 days
                        of LL date.
                      </div>
                    )
                  ) : (
                    <div className="flex h-full flex-col overflow-x-auto pb-20">
                      <div className="mb-6 h-48 w-full rounded-3xl bg-white shadow-lg">
                        <img
                          src="/assets/laptop-typing.png"
                          alt="Person using laptop"
                          className="h-48 w-full object-fill"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
          </>
        )}
      </main>
    </div>
  );
}
