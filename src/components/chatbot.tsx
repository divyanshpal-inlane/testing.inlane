import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, Send, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useUser } from "@/context/auth-context";
import { usePhoneVisibility } from "@/context/phone-visibility-context";
import { supabase } from "@/lib/supabaseClient";
import {
  useLearner,
  useLearnerEnrollment,
  useUpcomingLesson,
} from "@/queries/learner";
import { usePaymentsByLearner } from "@/queries/payment";
import { useRescheduleLearnerLessonRequests } from "@/queries/schedule-requests";
import { maskCarNumber } from "@/utils/phoneMasking";

interface Message {
  role: "user" | "assistant";
  content: string;
}

function useLearnerContext() {
  const { data: learner } = useLearner();
  const { data: enrollment } = useLearnerEnrollment({ learnerId: learner?.id });
  const { data: upcomingData } = useUpcomingLesson();
  const { canViewUnmaskedCarNumbers } = usePhoneVisibility();

  const { data: schedulesWithInstructor } = useQuery({
    queryKey: ["chatbot-schedules", learner?.id, enrollment?.course_id],
    queryFn: async () => {
      if (!learner?.id || !enrollment?.course_id) return [];
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, status, lesson_id, Lesson (id, number, description), Instructor (name, phone, car_make, car_number)",
        )
        .eq("learner_id", learner.id)
        .eq("course_id", enrollment.course_id)
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!learner?.id && !!enrollment?.course_id,
    staleTime: 1000 * 60 * 5,
  });

  const { data: payments } = usePaymentsByLearner(learner?.id);
  const { data: rescheduleRequests } = useRescheduleLearnerLessonRequests(
    learner?.id ?? "",
  );

  const context = useMemo(() => {
    if (!learner) return null;

    const allSchedules = schedulesWithInstructor ?? [];
    const completedCount = allSchedules.filter(
      (s) => s.status?.toLowerCase() === "completed",
    ).length;
    const totalLessons = enrollment?.Courses?.Lesson?.length ?? 0;

    const upcoming = upcomingData?.upcomingSchedule;
    const upcomingInstructor = upcomingData?.instructor;
    const course = upcomingData?.course ?? enrollment?.Courses;

    const ctx: Record<string, unknown> = {
      role: "learner",
      learnerName: learner.name,
      pickupLocation: learner.pick_up_location ?? null,
      area: learner.area ?? null,
      city: learner.city ?? null,
      courseName: course?.name ?? "N/A",
      totalLessonsInCourse: totalLessons,
      completedLessons: completedCount,
      remainingLessons: totalLessons - completedCount,
      todayDate: format(new Date(), "EEEE, MMM d, yyyy"),
    };

    if (upcoming) {
      ctx.nextLesson = {
        date: upcoming.date
          ? format(new Date(upcoming.date), "EEEE, MMM d, yyyy")
          : null,
        time: upcoming.start_time
          ? format(new Date(`2000-01-01T${upcoming.start_time}`), "h:mm a")
          : null,
        endTime: upcoming.end_time
          ? format(new Date(`2000-01-01T${upcoming.end_time}`), "h:mm a")
          : null,
        status: upcoming.status,
        instructorName: upcomingInstructor?.name ?? null,
        instructorCar: upcomingInstructor?.car_make
          ? `${upcomingInstructor.car_make} (${canViewUnmaskedCarNumbers ? upcomingInstructor.car_number : maskCarNumber(upcomingInstructor.car_number)})`
          : null,
      };
    }

    if (allSchedules.length > 0) {
      ctx.allLessons = allSchedules.map((s, index) => ({
        lessonNumber: index + 1,
        date: s.date ? format(new Date(s.date), "EEEE, MMM d, yyyy") : null,
        time: s.start_time
          ? format(new Date(`2000-01-01T${s.start_time}`), "h:mm a")
          : null,
        endTime: s.end_time
          ? format(new Date(`2000-01-01T${s.end_time}`), "h:mm a")
          : null,
        status: s.status,
        instructorName: s.Instructor?.name ?? null,
        instructorPhone: s.Instructor?.phone ?? null,
        instructorCar: s.Instructor?.car_make
          ? `${s.Instructor.car_make} (${canViewUnmaskedCarNumbers ? s.Instructor.car_number : maskCarNumber(s.Instructor.car_number)})`
          : null,
      }));
    }

    if (payments && payments.length > 0) {
      ctx.payments = payments.map((p) => ({
        amount: p.amount,
        status: p.status,
        type: p.payment_type,
        date: p.created_at
          ? format(new Date(p.created_at), "MMM d, yyyy")
          : null,
      }));
    }

    if (rescheduleRequests && rescheduleRequests.length > 0) {
      ctx.pendingRescheduleRequests = rescheduleRequests.length;
    }

    return ctx;
  }, [
    learner,
    enrollment,
    upcomingData,
    schedulesWithInstructor,
    payments,
    rescheduleRequests,
    canViewUnmaskedCarNumbers,
  ]);

  return { context, name: learner?.name };
}

function useInstructorContext() {
  const { phone } = useUser();

  const { data: instructorData } = useQuery({
    queryKey: ["chatbot-instructor", phone],
    queryFn: async () => {
      if (!phone) return null;

      const normalizedPhone = phone.replace(/\D/g, "");
      const phoneVariants = [
        phone,
        normalizedPhone,
        normalizedPhone.replace(/^91/, ""),
        `+91${normalizedPhone.replace(/^91/, "")}`,
      ];

      const { data: instructorResults, error: instrError } = await supabase
        .from("Instructor")
        .select("id_instructor, name, phone, email, car_make, car_number")
        .in("phone", phoneVariants);

      if (instrError || !instructorResults?.[0]) return null;
      const instructor = instructorResults[0];

      // Fetch today's and upcoming schedules with learner info
      const today = format(new Date(), "yyyy-MM-dd");
      const { data: schedules, error: schedError } = await supabase
        .from("Schedule")
        .select(
          "id, date, start_time, end_time, status, Learner (id, name, phone, pick_up_location, area, city), Lesson (id, number, description), Courses (name, total_lessons)",
        )
        .eq("instructor_id", instructor.id_instructor)
        .gte("date", today)
        .neq("status", "paused")
        .neq("status", "cancelled")
        .order("date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(30);

      if (schedError) return null;

      return { instructor, schedules: schedules ?? [] };
    },
    enabled: !!phone,
    staleTime: 1000 * 60 * 5,
  });

  const context = useMemo(() => {
    if (!instructorData?.instructor) return null;

    const { instructor, schedules } = instructorData;
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const todaySchedules = schedules.filter((s) => s.date === todayStr);

    const ctx: Record<string, unknown> = {
      role: "instructor",
      instructorName: instructor.name,
      car: instructor.car_make
        ? `${instructor.car_make} (${instructor.car_number})`
        : null,
      todayDate: format(new Date(), "EEEE, MMM d, yyyy"),
      todayLessonsCount: todaySchedules.length,
    };

    if (todaySchedules.length > 0) {
      ctx.todaySchedule = todaySchedules.map((s, i) => ({
        lessonNumber: i + 1,
        date: s.date ? format(new Date(s.date), "EEEE, MMM d, yyyy") : null,
        time: s.start_time
          ? format(new Date(`2000-01-01T${s.start_time}`), "h:mm a")
          : null,
        endTime: s.end_time
          ? format(new Date(`2000-01-01T${s.end_time}`), "h:mm a")
          : null,
        status: s.status,
        learnerName: s.Learner?.name ?? null,
        learnerPhone: s.Learner?.phone ?? null,
        pickupLocation: s.Learner?.pick_up_location ?? null,
        area: s.Learner?.area ?? null,
        courseName: s.Courses?.name ?? null,
        lessonDescription: s.Lesson?.description ?? null,
      }));
    }

    const upcomingSchedules = schedules.filter(
      (s) => s.date && s.date > todayStr,
    );
    if (upcomingSchedules.length > 0) {
      ctx.upcomingSchedule = upcomingSchedules.slice(0, 15).map((s, i) => ({
        lessonNumber: i + 1,
        date: s.date ? format(new Date(s.date), "EEEE, MMM d, yyyy") : null,
        time: s.start_time
          ? format(new Date(`2000-01-01T${s.start_time}`), "h:mm a")
          : null,
        endTime: s.end_time
          ? format(new Date(`2000-01-01T${s.end_time}`), "h:mm a")
          : null,
        status: s.status,
        learnerName: s.Learner?.name ?? null,
        learnerPhone: s.Learner?.phone ?? null,
        pickupLocation: s.Learner?.pick_up_location ?? null,
        area: s.Learner?.area ?? null,
        courseName: s.Courses?.name ?? null,
      }));
    }

    return ctx;
  }, [instructorData]);

  return { context, name: instructorData?.instructor?.name };
}

export default function Chatbot({
  variant = "learner",
}: {
  variant?: "learner" | "instructor";
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const learnerCtx = useLearnerContext();
  const instructorCtx = useInstructorContext();

  const { context: userContext, name: userName } =
    variant === "instructor" ? instructorCtx : learnerCtx;

  // Set initial greeting
  useEffect(() => {
    if (messages.length === 0) {
      const firstName = userName?.split(" ")[0];
      const greeting =
        variant === "instructor"
          ? firstName
            ? `Hi ${firstName}! I'm your InLane assistant. Ask me about today's schedule, learner details, pickup locations, or anything else!`
            : "Hi! I'm InLane's assistant for instructors. How can I help you today?"
          : firstName
            ? `Hi ${firstName}! I'm your InLane assistant. Ask me about your schedule, lessons, payments, or anything else!`
            : "Hi! I'm InLane's assistant. How can I help you today?";
      setMessages([{ role: "assistant", content: greeting }]);
    }
  }, [userName]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const apiMessages = newMessages
        .filter((_, i) => i > 0)
        .map((m) => ({ role: m.role, content: m.content }));

      const { data, error } = await supabase.functions.invoke("chat-bot", {
        body: { messages: apiMessages, learnerContext: userContext },
      });

      if (error) throw error;

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, I'm having trouble connecting. Please try again or contact support.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isInstructor = variant === "instructor";

  return (
    <>
      {/* Floating Bot Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onClick={() => setIsOpen(true)}
            className={`${isInstructor ? "fixed bottom-6" : "absolute bottom-16"} right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-primary shadow-lg transition-transform active:scale-95`}
          >
            <Bot size={24} className="text-white" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Window */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={`${isInstructor ? "fixed bottom-6" : "absolute bottom-14"} right-3 z-50 flex h-[80vh] max-h-[600px] w-[92%] max-w-[370px] flex-col rounded-2xl bg-white shadow-2xl`}
          >
            {/* Header */}
            <div className="flex items-center justify-between rounded-t-2xl bg-primary px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot size={22} className="text-white" />
                <div>
                  <h3 className="font-semibold text-white">InLane Assistant</h3>
                  <p className="text-xs text-white/80">Always here to help</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 transition-colors hover:bg-white/20"
              >
                <X size={20} className="text-white" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "rounded-br-md bg-primary text-white"
                        : "rounded-bl-md bg-gray-100 text-gray-800"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-gray-100 px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                        style={{ animationDelay: "0.15s" }}
                      />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
                        style={{ animationDelay: "0.3s" }}
                      />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 px-3 py-2">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  className="flex-1 rounded-full border border-gray-300 px-4 py-2 text-sm outline-none transition-colors focus:border-primary"
                  disabled={isLoading}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white transition-opacity disabled:opacity-40"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
