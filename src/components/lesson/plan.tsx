import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Home,
  Lock,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import invariant from "tiny-invariant";

import TrackedVideo from "@/components/lesson/tracked-video";
import TriviaCard from "@/components/lesson/trivia";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { COURSES_DATA } from "@/constants/courses";
import { usePhoneVisibility } from "@/context/phone-visibility-context";
import { quizId, videoId } from "@/lib/learning-analytics/model";
import { numberToText } from "@/lib/utils";
import {
  useLearner,
  useLearnerEnrollment,
  useLesson,
  useSchedule,
} from "@/queries/learner";
import { Database } from "@/types/database.types";
import { maskCarNumber, maskPhoneNumber } from "@/utils/phoneMasking";

import Signature from "./signature";

export default function Plan() {
  const { lessonId } = useParams();
  invariant(typeof lessonId === "string", "lessonId is required");
  const { data: lesson, isLoading: isLessonLoading } = useLesson({
    id: lessonId,
  });
  const { data: learner, isLoading: isLearnerLoading } = useLearner();
  const { data: enrollment, isLoading: isEnrollmentLoading } =
    useLearnerEnrollment({ learnerId: learner?.id });
  const navigate = useNavigate();

  if (isLessonLoading || isLearnerLoading || isEnrollmentLoading)
    return <div>Loading...</div>;
  if (!lesson || !learner || !enrollment) return null;

  // Check if lesson is locked (for installment payments)
  const isLessonLocked =
    enrollment.payment_status === "half_paid" &&
    lesson.number &&
    (!enrollment.unlocked_lessons ||
      !enrollment.unlocked_lessons.includes(lesson.number));

  // If lesson is locked, show a message and redirect
  if (isLessonLocked) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md text-center">
          <Lock className="mx-auto mb-4 h-16 w-16 text-gray-400" />
          <h2 className="mb-2 text-2xl font-bold text-gray-800">
            Lesson Locked
          </h2>
          <p className="mb-6 text-gray-600">
            This lesson is locked because you've only completed the first
            installment payment. Complete your payment to unlock all lessons.
          </p>
          <div className="space-y-3">
            <Button
              onClick={() => navigate(`/payment?phone=${learner.phone}`)}
              className="w-full"
            >
              Complete Payment
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/schedule")}
              className="w-full"
            >
              View Available Lessons
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const enrolledCourse = enrollment.Courses;
  const enrolledLessons = enrollment.Courses?.Lesson ?? [];
  const nextLessonId =
    enrolledCourse &&
    lesson.number &&
    lesson.number < enrolledCourse.total_lessons
      ? enrolledLessons[
          enrolledLessons.findIndex((l) => l.number === lesson.number + 1)
        ].id
      : null;
  const prevLessonId =
    enrolledCourse && lesson.number && lesson.number > 1
      ? enrolledLessons[
          enrolledLessons.findIndex((l) => l.number === lesson.number - 1)
        ].id
      : null;

  return (
    <LessonPlan
      key={lessonId}
      learner={learner}
      lesson={lesson}
      nextLessonId={nextLessonId}
      prevLessonId={prevLessonId}
    />
  );
}

export function LessonPlan({
  lesson,
  learner,
  nextLessonId,
  prevLessonId,
}: {
  lesson: Database["public"]["Tables"]["Lesson"]["Row"];
  learner: Database["public"]["Tables"]["Learner"]["Row"];
  nextLessonId: string | null;
  prevLessonId: string | null;
}) {
  const { data: schedule } = useSchedule({
    lessonId: lesson.id,
    learnerId: learner.id,
  });
  const { canViewUnmaskedPhoneNumbers, canViewUnmaskedCarNumbers } =
    usePhoneVisibility();

  const {
    menu,
    content: { game, remember, title, points },
  } = COURSES_DATA[lesson.course_id!].lessonsData[lesson.number?.toString()];
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [isInfoCardOpen, setIsInfoCardOpen] = useState(true);
  const [isSessionDetailsMinimized, setIsSessionDetailsMinimized] =
    useState(true);

  const finishGame = useCallback(() => {
    setSelectedCard(null);
  }, []);

  const { trivia, video: videos, signature } = menu ?? {};
  const {
    title: triviaTitle,
    icon: triviaIcon,
    color: triviaColor,
  } = trivia ?? {};
  const {
    title: signatureTitle,
    icon: signatureIcon,
    color: signatureColor,
  } = signature ?? {};

  const menuItems = useMemo(
    () => [
      ...(videos && videos.length > 0
        ? videos.map((video) => ({
            title: video.title ?? "",
            icon: video.icon ?? "",
            color: video.color ?? "",
            content: (
              <TrackedVideo
                key={video.video_path}
                src={video.video_path}
                title={video.title}
                context={{
                  courseId: lesson.course_id!,
                  lessonNumber: lesson.number!,
                  contentId: videoId(video.video_path),
                }}
              />
            ),
          }))
        : []),
      ...(trivia && game
        ? [
            {
              title: triviaTitle ?? "",
              icon: triviaIcon ?? "",
              color: triviaColor ?? "",
              content: (
                <TriviaCard
                  finishGame={finishGame}
                  game={game}
                  context={{
                    courseId: lesson.course_id!,
                    lessonNumber: lesson.number!,
                    contentId: quizId(game),
                  }}
                />
              ),
            },
          ]
        : []),
      ...(signature
        ? [
            {
              title: signatureTitle ?? "",
              icon: signatureIcon ?? "",
              color: signatureColor ?? "",
              content: <Signature />,
            },
          ]
        : []),
    ],
    [
      lesson.course_id,
      lesson.number,
      videos,
      trivia,
      game,
      finishGame,
      triviaTitle,
      triviaIcon,
      triviaColor,
      signature,
      signatureTitle,
      signatureIcon,
      signatureColor,
    ],
  );

  const handleCardClick = (index: number) => {
    setSelectedCard(index);
    setIsInfoCardOpen(false);
  };

  const handleBackClick = () => {
    if (selectedCard !== null) {
      setSelectedCard(null);
    } else {
      setIsMenuOpen(false);
      setIsInfoCardOpen(true);
    }
  };

  const timeString = schedule
    ? `${format(new Date(`2000-01-01T${schedule.start_time}`), "h:mm a")} - ${format(new Date(`2000-01-01T${schedule.start_time}`).setHours(new Date(`2000-01-01T${schedule.start_time}`).getHours() + 1), "h:mm a")}`
    : "Not available";

  return (
    <div
      key={lesson.number}
      className="relative h-full w-full overflow-hidden text-foreground"
    >
      <img
        className="absolute inset-0 h-full w-full object-cover"
        src="/assets/lesson1-hero.png"
        alt="Parallel Parking"
      />

      <div className="absolute inset-0 bg-black bg-opacity-50" />

      <div className="relative z-10 flex h-full w-full flex-col">
        <div className="flex items-center justify-between p-4">
          <div className="flex w-full flex-row items-center justify-between gap-2 text-4xl font-bold">
            <Button
              size={"icon"}
              variant={"ghost"}
              className="text-white"
              onClick={() => navigate("/home")}
            >
              <Home />
            </Button>

            <div className="flex flex-row items-center justify-center gap-1">
              {prevLessonId ? (
                <Button
                  size={"icon"}
                  variant={"ghost"}
                  className="text-white"
                  onClick={() => navigate(`/lesson/${prevLessonId}`)}
                >
                  <ArrowLeft />
                </Button>
              ) : (
                <div></div>
              )}
              <p className="text-2xl leading-none text-white">
                Lesson {numberToText(lesson.number)}
              </p>
              {nextLessonId && (
                <Button
                  variant={"link"}
                  size={"icon"}
                  className="text-white"
                  onClick={() => navigate(`/lesson/${nextLessonId}`)}
                >
                  <ArrowRight />
                </Button>
              )}
            </div>
            <p></p>
          </div>
        </div>

        {!isMenuOpen && (
          <AnimatePresence>
            <motion.div
              key="session-details"
              initial={false}
              animate={{
                height: isSessionDetailsMinimized ? "auto" : "auto",
                opacity: 1,
              }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="mx-4 mb-4 rounded-3xl bg-[#FFFFF0] p-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-lg font-semibold">Session Details</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setIsSessionDetailsMinimized(!isSessionDetailsMinimized)
                  }
                >
                  {isSessionDetailsMinimized ? <ChevronDown /> : <ChevronUp />}
                </Button>
              </div>
              <motion.div
                initial={false}
                animate={{
                  height: isSessionDetailsMinimized ? 0 : "auto",
                  opacity: isSessionDetailsMinimized ? 0 : 1,
                }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-4">
                  {/* Row 1 */}
                  <div className="flex flex-col gap-0">
                    <p className="text-sm font-light">Date</p>
                    <p className="text-base">
                      {schedule
                        ? format(new Date(schedule.date), "EEE, do MMM")
                        : "Not available"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0">
                    <p className="text-sm font-light">Time</p>
                    <p className="text-base">{timeString}</p>
                  </div>

                  {/* Row 2 */}
                  <div className="flex flex-col gap-0">
                    <p className="text-sm font-light">Instructor Name</p>
                    <p className="text-base">
                      {schedule?.Instructor?.name
                        ? schedule?.Instructor?.name
                        : "Not available"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0">
                    <p className="text-sm font-light">Mobile number</p>
                    <p className="text-base">
                      {schedule?.Instructor?.phone
                        ? canViewUnmaskedPhoneNumbers
                          ? schedule?.Instructor?.phone
                          : maskPhoneNumber(schedule?.Instructor?.phone)
                        : "Not available"}
                    </p>
                  </div>

                  {/* Row 3 */}
                  <div className="flex flex-col gap-0">
                    <p className="text-sm font-light">Car Model</p>
                    <p className="text-base">
                      {schedule?.Instructor?.car_make
                        ? schedule?.Instructor?.car_make
                        : "Not available"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0">
                    <p className="text-sm font-light">Car Number</p>
                    <p className="text-base">
                      {schedule?.Instructor?.car_number
                        ? canViewUnmaskedCarNumbers
                          ? schedule?.Instructor?.car_number
                          : maskCarNumber(schedule?.Instructor?.car_number)
                        : "Not available"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-0">
                    <p className="text-sm font-light">Pick Up location</p>

                    <Popover>
                      <PopoverTrigger>
                        <p className="truncate text-base">
                          {learner?.pick_up_location
                            ? learner?.pick_up_location
                            : "Not available"}
                        </p>
                      </PopoverTrigger>
                      <PopoverContent>
                        {learner?.pick_up_location}
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </motion.div>
              {isSessionDetailsMinimized && (
                <div className="flex flex-col gap-1">
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-base font-light"
                  >
                    <span className="font-medium">Date:</span>{" "}
                    {schedule
                      ? format(new Date(schedule.date), "EEE, do MMM")
                      : "Not available"}
                  </motion.p>
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-base font-light"
                  >
                    <span className="font-medium">Time: </span>
                    {timeString}
                  </motion.p>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {selectedCard === null ? (
          <div className="absolute bottom-6 left-4 right-4 z-20 flex justify-center gap-6">
            {/* <Button
              onClick={handleReschedule}
              size={"lg"}
              className="w-32 text-lg"
            >
              Reschedule
            </Button> */}
            <Button
              onClick={() => {
                if (isMenuOpen) setIsInfoCardOpen(true);
                setIsMenuOpen(!isMenuOpen);
              }}
              size={"lg"}
              className="mb-8 w-32 text-lg"
            >
              {isMenuOpen ? "Info" : "Prep time"}
            </Button>
          </div>
        ) : null}

        <AnimatePresence mode="popLayout">
          {isInfoCardOpen && !isMenuOpen ? (
            <motion.div
              key="info-card"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="flex w-full grow overflow-y-auto"
            >
              <ScrollArea className="mx-4 mb-4 flex grow overflow-y-auto rounded-b-3xl rounded-t-3xl bg-[#FFFFF0]">
                <div className="flex flex-col gap-4 p-6 pb-24">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-semibold">Lesson Plan</h2>
                  </div>
                  <div className="mt-4">
                    <h3 className="mb-4 text-lg font-semibold">{title}</h3>
                    <div className="space-y-4">
                      {points.map(({ desc, header, icon }) => (
                        <div key={header} className="flex items-center gap-2">
                          <img
                            src={`/assets/icons/${icon}`}
                            className="h-6 w-6"
                            alt={icon}
                          />
                          <div>
                            <p className="font-medium text-primary">{header}</p>
                            <p className="text-sm text-muted-foreground">
                              {desc}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg bg-black bg-opacity-10 p-4 backdrop-blur-sm">
                    <h4 className="mb-4 text-lg text-accent-purple">
                      Things to remember
                    </h4>
                    <div className="flex flex-col gap-3">
                      {remember.map(({ icon, text }) => (
                        <p
                          key={text}
                          className="flex flex-row items-center gap-2"
                        >
                          <span className="text-2xl">{icon}</span>
                          <span className="text-sm">{text}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </motion.div>
          ) : isMenuOpen ? (
            <motion.div
              key="card-card"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="grow"
            ></motion.div>
          ) : null}

          {isMenuOpen && selectedCard === null && (
            <motion.div
              key="menu"
              initial={{ y: "100%" }}
              animate={{ y: (menuItems.length - 1) * 20 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="w-full"
            >
              {menuItems.map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: -index * 20 }}
                  transition={{ delay: index * 0.1 }}
                  className={`${item.color} flex cursor-pointer items-center justify-between rounded-lg p-4 py-8 ${index === menuItems.length - 1 ? "mb-8" : ""}`}
                  onClick={() => handleCardClick(index)}
                >
                  <span className="text-3xl font-medium">{item.title}</span>
                  <span className="text-5xl">{item.icon}</span>
                </motion.div>
              ))}
              <div className="h-20"></div>
            </motion.div>
          )}

          {selectedCard !== null && (
            <motion.div
              key="selected-card"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className={`${menuItems[selectedCard].color} absolute flex h-full w-full flex-col overflow-y-auto rounded-t-3xl`}
            >
              <div className="flex h-screen flex-col">
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-4 mt-4 h-6 w-6 text-foreground"
                  onClick={handleBackClick}
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="flex-grow overflow-y-hidden">
                  <div className="mt-1 flex h-full flex-col items-center justify-between gap-2">
                    {menuItems[selectedCard].content}
                  </div>
                </div>
              </div>
              {/* Adding title makes the user scroll for video
               <div className="sticky top-0 flex flex-row items-center justify-between gap-2 px-6 pt-4">
                <h2 className="text-xl font-medium">
                  {menuItems[selectedCard].title}
                </h2>
                <div className="flex items-center gap-4">
                  <p className="text-[78px]">{menuItems[selectedCard].icon}</p>
                </div>
              </div>

              <ScrollArea className="flex-grow px-6 pb-6">
                <div className="mt-10 flex h-full flex-col items-center justify-between gap-2">
                  {menuItems[selectedCard].content}
                </div>
                <ScrollBar className="bg-accent-purple/60" />
              </ScrollArea> */}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
