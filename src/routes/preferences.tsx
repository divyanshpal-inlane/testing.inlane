import { ArrowLeft } from "lucide-react";
import React, { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import PreferenceSelector from "@/components/lesson/PreferenceSelector";
import { Button } from "@/components/ui/button";
import { demoLessonOffsetFor } from "@/constants/courses";
import { nextLearnerScheduleSetupRoute } from "@/lib/learner-schedule-onboarding";
import {
  useLearner,
  useLearnerEnrollment,
  useLearnerEnrollmentCourse,
  useLessons,
} from "@/queries/learner";
import { useCompletedDemoCount } from "@/queries/payment";

function Preferences() {
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") as "new" | "reschedule" | "lesson10";
  const [isFlexible, setIsFlexible] = useState(false);
  const { data: learner, isLoading: learnerLoading } = useLearner();
  const { data: enrolledCourse, isLoading: enrolledCourseLoading } =
    useLearnerEnrollmentCourse({
      learnerId: learner?.id ?? "",
    });

  // Also fetch enrollment details for demo/custom courses
  const { data: enrollment, isLoading: enrollmentLoading } =
    useLearnerEnrollment({
      learnerId: learner?.id,
    });

  const courseId = enrolledCourse?.[0]?.course_id;
  const courseTotalLessons = enrolledCourse?.[0]?.Courses?.total_lessons;
  const isDemo = enrollment?.progress?.type === "demo";
  const isCustom = enrollment?.progress?.type === "custom";

  const { data: lessons, isLoading: lessonsLoading } = useLessons({
    courseId: courseId,
  });
  const { data: completedDemoCount = 0, isLoading: demoCountLoading } =
    useCompletedDemoCount(learner?.id);

  // Determine lessons to schedule
  // For demo/custom courses without course_id, create virtual lesson IDs
  let lessonsToSchedule: string[] | undefined;

  if (isDemo || isCustom || !courseId) {
    // Demo/custom: use unlocked_lessons from enrollment or calculate from total_hours
    const unlockedLessons = enrollment?.unlocked_lessons || [];
    const totalHours = enrollment?.progress?.total_hours || 1;

    if (isCustom) {
      // Custom courses are always scheduled in full, so derive the count from
      // total_hours rather than unlocked_lessons. On a half-paid custom
      // enrollment unlocked_lessons only holds the first installment's half,
      // which would send the admin a half-length request — and lesson_ids is
      // the ONLY thing telling the admin scheduler how many hours a custom
      // course needs (there is no course_id to look lessons up by).
      //
      // Minus any demo hours already driven: the demo's price was credited
      // against this course, so its hour comes off the schedule too (same rule
      // as complete-payment.ts and the admin CreateSchedule offset).
      const customHours =
        totalHours - demoLessonOffsetFor(totalHours, completedDemoCount);
      lessonsToSchedule = Array.from(
        { length: customHours },
        (_, i) => `virtual-lesson-${i + 1}`,
      );
    } else if (unlockedLessons.length > 0) {
      // Use unlocked_lessons array - create virtual lesson IDs
      lessonsToSchedule = unlockedLessons.map(
        (num: number) => `virtual-lesson-${num}`,
      );
    } else {
      // Fallback: create virtual lessons based on total_hours
      lessonsToSchedule = Array.from(
        { length: totalHours },
        (_, i) => `virtual-lesson-${i + 1}`,
      );
    }
  } else if (lessons) {
    // Regular course with lessons
    // Limit lessons to match course's total_lessons (handles cases where DB has extra lesson records)
    const limitedLessons = courseTotalLessons
      ? lessons.slice(0, courseTotalLessons)
      : lessons;

    // Always pass ALL lesson IDs for new schedules - lesson 10 locking is handled in admin CreateSchedule
    lessonsToSchedule =
      type === "new"
        ? limitedLessons.map((l) => l.id) // Always include all lessons (including lesson 10)
        : type === "lesson10"
          ? limitedLessons.slice(9, 10).map((l) => l.id)
          : limitedLessons.map((l) => l.id);
  }

  if (
    learnerLoading ||
    enrolledCourseLoading ||
    lessonsLoading ||
    enrollmentLoading ||
    demoCountLoading
  ) {
    return <div>Loading...</div>;
  }

  if (!enrollment && enrolledCourse && enrolledCourse.length === 0) {
    return <div>No enrolled course</div>;
  }

  // Also guard direct links from the licence journey: slot preferences alone
  // are not enough for Operations to assign an instructor.
  if (type === "new" && learner) {
    const setupRoute = nextLearnerScheduleSetupRoute(learner, {
      isDemo,
      hasPreferences: true,
    });
    if (setupRoute) return <Navigate to={setupRoute} replace />;
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto">
      <div className="flex flex-col rounded-b-[40px] bg-primary">
        <div className="flex items-center justify-between p-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground"
            asChild
          >
            <Link
              to="/home"
              replace
              aria-label="Back to learner home"
              state={
                type === "new"
                  ? { scheduleSetupReturnFor: learner?.id }
                  : undefined
              }
            >
              <ArrowLeft className="h-6 w-6" />
            </Link>
          </Button>
          <span className="text-lg font-semibold text-primary-foreground">
            {type === "new"
              ? "Schedule Preferences"
              : type === "lesson10"
                ? "Schedule Lesson 10"
                : "Reschedule Preferences"}
          </span>
        </div>
        <div className="relative z-10 rounded-b-[40px] bg-primary p-6 text-primary-foreground">
          <h1 className="mb-1 text-xl font-semibold">
            When are you available for lessons?
          </h1>
          <p>Set your preferences for each time slot</p>
          <div className="mt-4 flex items-center px-2">
            <input
              type="checkbox"
              id="flexible"
              checked={isFlexible}
              onChange={() => setIsFlexible((prev) => !prev)}
              className="mr-2"
            />
            <label htmlFor="flexible" className="text-sm text-gray-700">
              I am flexible with my time slot selection
            </label>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-2 py-4">
          {learner && lessonsToSchedule && lessonsToSchedule.length > 0 ? (
            <PreferenceSelector
              isFlexible={isFlexible}
              type={type}
              lessons={lessonsToSchedule}
              learnerId={learner.id}
            />
          ) : (
            <div className="text-center text-muted-foreground">
              No lessons available to schedule
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Preferences;
