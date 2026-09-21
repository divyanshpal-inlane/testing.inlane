import { ExternalLinkIcon } from "lucide-react";

import { MaskedCallButton } from "@/components/MaskedCallButton";
import { useUser } from "@/context/auth-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface LessonListProps {
  instructorData: any;
  LESSON_CONTENT: any;
}

const LessonList = ({ instructorData, LESSON_CONTENT }: LessonListProps) => {
  const { phone: instructorPhone } = useUser();

  function formatTimeRange(start_time: string, end_time: string): string {
    const formatTime = (time: string): string => {
      const [hours, minutes] = time.split(":");
      let period = "AM";
      let hourNum = parseInt(hours, 10);

      if (hourNum >= 12) {
        period = "PM";
        if (hourNum > 12) {
          hourNum -= 12;
        }
      }

      if (hourNum === 0) {
        hourNum = 12;
      }

      return `${hourNum}:${minutes} ${period}`;
    };

    const formattedStartTime = formatTime(start_time);
    const formattedEndTime = formatTime(end_time);

    return `${formattedStartTime} to ${formattedEndTime}`;
  }

  return (
    <div className="flex flex-col gap-2 pb-4">
      {instructorData?.learnerLesson
        .sort((a, b) => {
          const lessonNumberA = a.lesson?.number || 0;
          const lessonNumberB = b.lesson?.number || 0;

          if (lessonNumberA !== lessonNumberB) {
            return lessonNumberA - lessonNumberB;
          }

          const dateA = new Date(
            instructorData.instructorSchedule.find(
              (s) => s.lesson_id === a.lesson?.id,
            )?.date || 0,
          );
          const dateB = new Date(
            instructorData.instructorSchedule.find(
              (s) => s.lesson_id === b.lesson?.id,
            )?.date || 0,
          );

          return dateA.getTime() - dateB.getTime();
        })
        .map(({ learner, lesson }, index) => {
          // For demo/topup, lesson is a virtual placeholder (id starts with
          // `virtual-`). Match against learner_id instead of lesson_id.
          const isVirtual =
            typeof lesson?.id === "string" && lesson.id.startsWith("virtual-");
          const lessonSchedule = isVirtual
            ? instructorData.instructorSchedule.find(
                (s) => `virtual-${s.id}` === lesson?.id,
              )
            : instructorData.instructorSchedule.find(
                (s) => s.lesson_id === lesson?.id,
              );
          const enrollmentType = (lessonSchedule as any)?.enrollmentType;
          const typeTheme =
            enrollmentType === "demo"
              ? {
                  border: "border-blue-300",
                  chip: "bg-blue-100 text-blue-800",
                  label: "Demo",
                }
              : enrollmentType === "topup"
                ? {
                    border: "border-purple-300",
                    chip: "bg-purple-100 text-purple-800",
                    label: "Topup",
                  }
                : null;
          const displayLabel = lesson?.number
            ? `Lesson ${lesson.number}`
            : enrollmentType === "demo"
              ? "Demo Lesson"
              : enrollmentType === "topup"
                ? "Topup Class"
                : "Class";

          return (
            <Card key={index} className={typeTheme?.border}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span>{displayLabel}</span>
                    {typeTheme && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeTheme.chip}`}
                      >
                        {typeTheme.label}
                      </span>
                    )}
                  </div>
                  <div className="text-xs">
                    <div className="text-right text-base">
                      {lessonSchedule
                        ? new Date(lessonSchedule.date).toLocaleDateString()
                        : "No date"}
                    </div>
                    {lessonSchedule
                      ? formatTimeRange(
                          lessonSchedule.start_time,
                          lessonSchedule.end_time,
                        )
                      : "No time scheduled"}
                  </div>
                </CardTitle>
                <CardDescription>
                  {lesson?.number &&
                    LESSON_CONTENT[lesson.number]?.content.title}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex flex-row items-center gap-1">
                    <p className="text-nowrap text-muted-foreground">
                      Pick-up Location :
                    </p>
                    <a
                      href={`https://www.google.com/maps?q=${learner.address_lat},${learner.address_lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate text-xs underline hover:text-blue-800"
                    >
                      <span className="truncate">
                        {learner.pick_up_location}
                      </span>
                      <ExternalLinkIcon className="h-4 w-4 shrink-0" />
                    </a>
                  </div>
                  <div className="flex flex-row gap-1">
                    <p className="text-muted-foreground">Learner name :</p>
                    <p>{learner.name}</p>
                  </div>
                  <div className="flex flex-row items-center gap-2">
                    <p className="text-muted-foreground">Contact Learner :</p>
                    <MaskedCallButton
                      callerPhone={instructorPhone}
                      calleePhone={learner.phone}
                      label="Call Learner"
                      className="flex h-8 items-center gap-1.5 text-xs"
                    />
                  </div>

                  {lessonSchedule && lessonSchedule.status && (
                    <div className="mt-2 flex items-center gap-2">
                      <p className="text-muted-foreground">Status:</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          lessonSchedule.status === "completed"
                            ? "bg-green-100 text-green-800"
                            : lessonSchedule.status === "ongoing"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {lessonSchedule.status.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
    </div>
  );
};

export default LessonList;
