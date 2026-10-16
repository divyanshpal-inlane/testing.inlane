import { CircleCheckBig, ExternalLinkIcon } from "lucide-react";

import { MaskedCallButton } from "@/components/MaskedCallButton";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LESSON_CONTENT } from "@/constants/Lesson";
import { useUser } from "@/context/auth-context";

interface ScheduleListProps {
  instructorData: any;
  onOpenLessonPlan: (lesson: any, learner: any) => void;
  onFinishLesson: (scheduleId: string, learnerId: string) => void;
  navigate: (path: string) => void;
}

const ScheduleList = ({
  instructorData,
  onOpenLessonPlan,
  onFinishLesson,
  navigate,
}: ScheduleListProps) => {
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
      {instructorData?.instructorScheduleDay.map((schedule, index) => {
        const learnerLessonPair = instructorData?.learnerLessonDay.find(
          (ll) => ll.lesson.id === schedule.lesson_id,
        );

        // Demo/topup schedules have lesson_id=NULL and won't have a lesson
        // pair. Fall back to the schedule's Learner and a virtual lesson so
        // those classes still show up in the instructor's daily list.
        const enrollmentType = (schedule as any).enrollmentType;
        const isVirtual = !learnerLessonPair && !!(schedule as any).Learner;
        if (!learnerLessonPair && !isVirtual) {
          return null;
        }

        const learner = learnerLessonPair?.learner ?? (schedule as any).Learner;
        const lesson = learnerLessonPair?.lesson ?? null;
        const isOngoing = schedule.status === "ongoing";

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

        const displayLessonLabel = lesson?.number
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
                  <span>{displayLessonLabel}</span>
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
                    {new Date(schedule.date).toLocaleDateString()}
                  </div>
                  {formatTimeRange(schedule.start_time, schedule.end_time)}
                </div>
              </CardTitle>
              <CardDescription>
                {lesson?.number && LESSON_CONTENT[lesson.number]?.content.title}
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
                    <span className="truncate">{learner.pick_up_location}</span>
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

                <Button
                  onClick={() => onOpenLessonPlan(lesson, learner)}
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full text-xs"
                >
                  View Lesson Plan
                </Button>
              </div>
              <Card className="rounded-smb flex flex-row items-center justify-between gap-4 p-2 shadow-md">
                <div className="flex w-full flex-wrap items-center justify-between gap-2 p-1 text-xs">
                  <p>Lesson status : {schedule.status?.toUpperCase()}</p>
                  <div className="flex flex-row items-center gap-24">
                    {isOngoing ? (
                      <div className="relative flex items-center justify-center">
                        <div className="h-3 w-3 rounded-full bg-green-500"></div>
                        <div className="absolute h-3 w-3 animate-ping rounded-full bg-green-500"></div>
                      </div>
                    ) : null}
                    {schedule.status === "completed" ? (
                      <div className="flex items-center justify-center">
                        <CircleCheckBig
                          className="rounded-full bg-green-500 text-white"
                          size={18}
                        />
                      </div>
                    ) : null}
                  </div>
                  {isOngoing && (
                    <Button
                      onClick={() =>
                        onFinishLesson(schedule.id.toString(), learner.id)
                      }
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                    >
                      Finish Lesson
                    </Button>
                  )}
                  {schedule.status !== "ongoing" &&
                    schedule.status !== "completed" && (
                      <Button
                        onClick={() => {
                          navigate(`/otp/start/${learner.id}/${schedule.id}`);
                        }}
                        size="sm"
                        className="text-xs"
                      >
                        Start
                      </Button>
                    )}
                </div>
              </Card>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default ScheduleList;
