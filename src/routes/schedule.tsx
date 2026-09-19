/* eslint-disable prettier/prettier */
import { format, isSameDay, startOfDay, subDays } from "date-fns";
import { BookOpen, ChevronRight, Lock, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COURSES_DATA } from "@/constants/courses";
import {
  useLearner,
  useLearnerEnrollment,
  useLearnerSchedule,
} from "@/queries/learner";
import {
  useCompletedRescheduleRequests,
  useRescheduleLearnerLessonRequests,
} from "@/queries/schedule-requests";

type CustomDayProps = {
  date: Date;
  displayMonth?: Date;
};

export default function Schedule() {
  const navigate = useNavigate();

  function formatTimeTo12Hour(time: string): string {
    // Validate input time format
    const regex = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
    if (!regex.test(time)) {
      throw new Error("Invalid time format. Expected format is HH:MM:SS.");
    }

    // Split the time into hours, minutes, and seconds
    const [hours, minutes] = time.split(":").map(Number);

    // Determine AM or PM
    const period = hours < 12 ? "AM" : "PM";

    // Convert hours to 12-hour format
    const hours12 = hours % 12 || 12;

    // Format the time string
    return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
  }

  const { data: learner, isLoading, error } = useLearner();
  const [selectedDates, setSelectedDates] = useState<Date[]>([]);
  const learnerId = learner?.id;
  const { data: enrollment } = useLearnerEnrollment({ learnerId });
  const isDemoEnrollment = enrollment?.progress?.type === "demo";
  const { data: scheduledLessons } = useLearnerSchedule({
    learnerId,
    courseId: enrollment?.course_id,
    isDemo: isDemoEnrollment,
  });
  const { data: scheduleRequests, isLoading: scheduleRequestsLoading } =
    useRescheduleLearnerLessonRequests(learner?.id);
  const { data: completedReschedules } = useCompletedRescheduleRequests(
    learner?.id,
  );

  useEffect(() => {
    if (scheduledLessons) {
      setSelectedDates(scheduledLessons.map((lesson) => new Date(lesson.date)));
    }
  }, [scheduledLessons]);

  const CustomDay = ({ date }: CustomDayProps) => {
    if (!scheduledLessons) return null;

    const lessonsForDay = scheduledLessons.filter((lesson) =>
      isSameDay(new Date(lesson.date), date),
    );

    if (lessonsForDay.length === 0) {
      return <div className="h-8 w-8 p-0">{date.getDate()}</div>;
    }

    // Determine if the day contains a lesson that can be rescheduled
    // Collect all lesson_ids from scheduleRequests into a Set for fast lookup
    const requestLessonIds = new Set(
      (scheduleRequests ?? []).flatMap((req) => req.lesson_ids || []),
    );

    // Store the boolean directly
    const isRescheduleDay: boolean = (lessonsForDay ?? []).some((lesson) =>
      requestLessonIds.has(lesson.lessonId),
    );

    // console.log("lessonsForDay", lessonsForDay);
    // console.log("Schedule requests", scheduleRequests);
    const isPast = date < startOfDay(subDays(new Date(), 30));
    console.log("date < ", isPast, date, startOfDay(subDays(new Date(), 30)));
    let dayColorClasses = "";

    const hasPendingPayment = lessonsForDay.some(
      (l) => l.status === "pending_payment",
    );
    const hasPaidTopup = lessonsForDay.some((l) => l.status === "topup");
    const hasPaused = lessonsForDay.some((l) => l.status === "paused");

    if (isPast) {
      dayColorClasses = "bg-gray-300 text-gray-600";
    } else if (hasPaused) {
      dayColorClasses =
        "bg-rose-400 hover:bg-rose-500 focus:bg-rose-400 text-white";
    } else if (hasPendingPayment) {
      dayColorClasses =
        "bg-amber-400 hover:bg-amber-500 focus:bg-amber-400 text-amber-900";
    } else if (hasPaidTopup) {
      dayColorClasses =
        "bg-green-500 hover:bg-green-600 focus:bg-green-500 text-white";
    } else if (isRescheduleDay) {
      dayColorClasses =
        "bg-yellow-500 hover:bg-yellow-500 focus:bg-yellow-500 text-gray-800";
    } else {
      dayColorClasses = "bg-primary text-primary-foreground";
    }

    if (scheduleRequestsLoading) {
      console.log("Loading reschedule requests");
      return <div>Loading ... </div>;
    }
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            // Modified class strings for other types of day, eg reschedule
            className={`h-8 w-8 p-0 font-normal ${dayColorClasses}`}
          >
            {date.getDate()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-fit">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-gray-700">
              Scheduled Lessons
            </h3>
            {lessonsForDay.map((lesson) => {
              const now = new Date();
              const isLessonPast =
                new Date(`${lesson.date}T${lesson.startTime}`) < now;
              if (lesson.status === "paused") {
                return (
                  <p key={lesson.id} className="flex flex-col gap-1 text-xs">
                    <span className="text-gray-500">
                      {format(
                        new Date(`2000-01-01T${lesson.startTime}`),
                        "h:mm a",
                      )}{" "}
                      -
                      {format(
                        new Date(`2000-01-01T${lesson.endTime}`),
                        "h:mm a",
                      )}
                    </span>
                    <span className="font-semibold text-rose-600">
                      Your session has been paused. Contact admin for
                      clarification.
                    </span>
                  </p>
                );
              }
              return (
                <p
                  key={lesson.id}
                  className={`flex flex-col gap-1 text-xs ${isLessonPast ? "text-gray-400 line-through" : ""}`}
                >
                  <span
                    className={`${isLessonPast ? "text-gray-400" : "text-gray-600"}`}
                  >
                    {format(
                      new Date(`2000-01-01T${lesson.startTime}`),
                      "h:mm a",
                    )}{" "}
                    -
                    {format(new Date(`2000-01-01T${lesson.endTime}`), "h:mm a")}
                  </span>
                  <span
                    className={`${
                      lesson.status === "pending_payment"
                        ? "font-semibold text-amber-700"
                        : lesson.status === "topup"
                          ? "font-semibold text-green-700"
                          : isLessonPast
                            ? "text-gray-400"
                            : "text-accent-purple"
                    }`}
                  >
                    {lesson.status === "pending_payment"
                      ? `${isDemoEnrollment ? "Demo Lesson" : "Topup Class"} — Pay ₹1 to activate`
                      : lesson.status === "topup"
                        ? "Topup Class (Paid)"
                        : `Lesson ${lesson.lesson?.number}${lesson.lesson?.endNumber ? ` & ${lesson.lesson.endNumber}` : ""}`}
                    {lesson.status === "pending_payment" ? (
                      <Button
                        variant="link"
                        className="text-amber-700"
                        onClick={() => {
                          if (isDemoEnrollment) {
                            navigate(
                              `/payment?phone=${learner?.phone}&type=demo`,
                            );
                          } else {
                            const topupHours = Math.max(
                              1,
                              (
                                (scheduledLessons ?? []) as Array<{
                                  status?: string;
                                }>
                              ).filter((l) => l.status === "pending_payment")
                                .length,
                            );
                            navigate(
                              `/payment?phone=${learner?.phone}&type=topup&hours=${topupHours}`,
                            );
                          }
                        }}
                      >
                        Pay Now
                      </Button>
                    ) : lesson.status === "topup" ? null : (
                      <Button
                        variant="link"
                        onClick={() => {
                          if (lesson.status && lesson.status != "completed") {
                            navigate(`/reschedule/${lesson?.lesson?.id}`);
                          } else {
                            alert("Lesson already completed");
                          }
                        }}
                        disabled={
                          !lesson ||
                          !lesson.lesson ||
                          lesson.status === "completed"
                        }
                      >
                        Reschedule
                      </Button>
                    )}
                  </span>
                </p>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  // TODO: fix the time thingy
  const nextLesson = scheduledLessons?.find((lesson) => {
    const now = new Date();
    const currentDateTime = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );

    const [year, month, day] = lesson.date.split("-").map(Number);
    const [hours, minutes] = lesson.startTime.split(":").map(Number);
    const lessonDateTime = new Date(year, month - 1, day, hours, minutes);

    return lessonDateTime > currentDateTime;
  });

  if (isLoading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  const lessonData = enrollment?.course_id
    ? COURSES_DATA[enrollment.course_id].lessonsData
    : undefined;
  const courseLessons = enrollment?.Courses?.Lesson || [];

  // Helper: count lesson-hours for a set of schedules (2hr class = 2 lessons)
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
  const totalCourseLessons = enrollment?.Courses?.total_lessons || 10;
  const completedLessonsCount = countLessonHours(
    scheduledLessons,
    (l) => l.status?.toUpperCase() === "COMPLETED",
  );
  const scheduledLessonsCount = countLessonHours(
    scheduledLessons,
    (l) => l.status !== "paused",
  );

  // Check if lesson 10 is ready to be scheduled (9 lessons done, 10-lesson course, no DL)
  const isLesson10ReadyToSchedule =
    totalCourseLessons === 10 &&
    learner?.has_a_DL === false &&
    scheduledLessonsCount === 9;

  // Progress percentage
  const progressPercentage =
    totalCourseLessons > 0
      ? Math.round((completedLessonsCount / totalCourseLessons) * 100)
      : 0;

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6 pb-20">
      {/* Course Progress Card */}
      {scheduledLessons &&
        scheduledLessons.length > 0 &&
        enrollment?.course_id && (
          <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
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
                  {countLessonHours(
                    scheduledLessons,
                    (l) =>
                      l.status?.toUpperCase() === "COMPLETED" &&
                      !!l.startedAt &&
                      !!l.endedAt,
                  )}{" "}
                  OTP Verified
                </span>
                {countLessonHours(
                  scheduledLessons,
                  (l) =>
                    l.status?.toUpperCase() === "COMPLETED" &&
                    (!l.startedAt || !l.endedAt),
                ) > 0 && (
                  <span className="rounded-full bg-orange-100 px-2 py-1 text-orange-700">
                    {countLessonHours(
                      scheduledLessons,
                      (l) =>
                        l.status?.toUpperCase() === "COMPLETED" &&
                        (!l.startedAt || !l.endedAt),
                    )}{" "}
                    Manually Done
                  </span>
                )}
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
                {enrollment?.payment_status === "half_paid" && (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-amber-700">
                    <Lock className="h-3 w-3" />
                    Payment Pending
                  </span>
                )}

                {/* Lesson 10 ready indicator */}
                {isLesson10ReadyToSchedule && (
                  <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-green-700">
                    <Calendar className="h-3 w-3" />
                    Lesson 10 Ready
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

      <Tabs defaultValue="calendar" className="flex h-full w-full flex-col">
        <TabsList className="w-full">
          <TabsTrigger value="calendar" className="w-full">
            Calendar
          </TabsTrigger>
          <TabsTrigger value="lesson" className="w-full">
            Lesson
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="calendar"
          className="scrollbar-none flex h-full flex-col overflow-y-auto"
          style={{ scrollbarWidth: "none" }}
        >
          <div className="flex min-h-full flex-col">
            <Card className="flex-none">
              <CardHeader>Upcoming schedule</CardHeader>
              <CardContent>
                {enrollment?.payment_status === "half_paid" && (
                  <Alert className="mb-4 border-primary bg-white">
                    <AlertDescription>
                      You have paid the first installment. Some lessons are
                      locked until you complete the payment.
                      <Button
                        variant="link"
                        className="h-auto p-0 text-primary"
                        onClick={() =>
                          navigate(`/payment?phone=${learner?.phone}`)
                        }
                      >
                        Pay remaining amount
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <Calendar
                  mode="multiple"
                  selected={selectedDates}
                  className="w-full rounded-md"
                  components={{
                    Day: CustomDay,
                  }}
                />

                <div className="flex flex-wrap gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded bg-primary" />
                    <span>Scheduled</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded bg-amber-400" />
                    <span>Payment Pending</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded bg-green-500" />
                    <span>Topup (Paid)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-3 rounded bg-yellow-500" />
                    <span>Reschedule</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <h2 className="mt-6 text-lg font-medium">Upcoming Lesson</h2>

            {nextLesson && nextLesson.lesson ? (
              <Card className="mb-6 mt-6 bg-gray-50">
                <CardContent className="flex h-full flex-col items-start gap-4 py-4">
                  <p className="flex h-full w-full gap-2 text-sm">
                    <span className="text-accent-purple">
                      Lesson {nextLesson.lesson.number}
                    </span>
                    <span>
                      {new Date(nextLesson.date).toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      | {formatTimeTo12Hour(nextLesson.startTime)} -{" "}
                      {formatTimeTo12Hour(nextLesson.endTime)}
                    </span>
                  </p>
                  <div className="flex w-full flex-col gap-2 rounded-md shadow-sm">
                    <Link
                      to={`/lesson/${nextLesson.lesson.id}`}
                      className="text-md flex flex-col justify-between"
                    >
                      <p>
                        {nextLesson.lesson.number && lessonData
                          ? lessonData[nextLesson.lesson.number.toString()]
                              ?.description
                          : ""}
                      </p>
                    </Link>
                    <div className="relative">
                      <img
                        className="h-full w-full object-cover"
                        src={`/assets/lesson-pic-${nextLesson.lesson.number}.png`}
                        alt="Lesson-pic"
                      />
                      <div className="absolute bottom-0 flex w-full flex-row items-center justify-center gap-1 rounded-sm bg-white px-1.5 py-1 shadow-md">
                        <Link
                          to={`/lesson/${nextLesson.lesson.id}`}
                          className="flex items-center space-x-1 font-medium text-primary"
                        >
                          More details
                          <ChevronRight
                            color="white"
                            className="rounded-full bg-primary"
                            size={20}
                          />
                        </Link>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="mt-24 text-center text-lg">
                No Upcoming Lesson. 😓
              </div>
            )}
          </div>
        </TabsContent>
        <ScrollArea className="relative">
          <TabsContent value="lesson" className="h-full overflow-y-auto">
            {enrollment?.payment_status === "half_paid" && (
              <Alert className="mb-4 border-primary bg-white">
                <AlertDescription>
                  You have paid the first installment. Some lessons are locked
                  until you complete the payment.
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
            <div className="grid grid-cols-2 gap-4 pb-32">
              {enrollment?.course_id &&
                Object.values(
                  COURSES_DATA[enrollment.course_id].lessonsData,
                ).map((lesson) => {
                  const lessonNumber = parseInt(lesson.id);
                  const isLocked =
                    enrollment.payment_status === "half_paid" &&
                    (!enrollment.unlocked_lessons ||
                      !enrollment.unlocked_lessons.includes(lessonNumber));

                  return (
                    <div
                      key={lesson.id}
                      className={`flex flex-col gap-1 rounded-md ${
                        isLocked ? "bg-gray-100" : "bg-gray-50"
                      } relative p-3 shadow-md`}
                    >
                      {isLocked && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-gray-200/70 backdrop-blur-[1px]">
                          <div className="p-3 text-center">
                            <Lock className="mx-auto mb-2 h-8 w-8 text-gray-500" />
                            <p className="text-sm font-medium text-gray-700">
                              Complete payment to unlock
                            </p>
                          </div>
                        </div>
                      )}
                      <p className="text-accent-purple">Lesson {lesson.id}</p>
                      <div className="relative">
                        <img src={lesson.image_path} alt="Lesson-pic" />
                        <div className="absolute -bottom-1.5 right-1 flex w-[75%] flex-row items-center justify-center gap-1 rounded-sm bg-white px-1.5 py-1 shadow-md">
                          <Link
                            to={`/lesson/${
                              courseLessons.find(
                                (l) => l.number === parseInt(lesson.id),
                              )?.id
                            }`}
                            className={`text-xs ${isLocked ? "text-gray-400" : "text-primary"} flex items-center space-x-1`}
                            onClick={(e) => isLocked && e.preventDefault()}
                          >
                            More details
                            <ChevronRight
                              color={isLocked ? "gray" : "white"}
                              className={`rounded-full ${isLocked ? "bg-gray-400" : "bg-primary"}`}
                              size={16}
                            />
                          </Link>
                        </div>
                      </div>
                      <Link
                        to={`/lesson/${
                          courseLessons.find(
                            (l) => l.number === parseInt(lesson.id),
                          )?.id
                        }`}
                        className={`text-md mt-1.5 ${isLocked ? "pointer-events-none text-gray-400" : ""}`}
                        onClick={(e) => isLocked && e.preventDefault()}
                      >
                        {lesson.description}
                      </Link>
                    </div>
                  );
                })}
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
