import { format, formatDuration, intervalToDuration } from "date-fns";
import {
  BookOpen,
  Calendar,
  Car,
  Clock,
  Edit2,
  Info,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { fetchAdminSchedules } from "@/lib/admin-schedules";
import { supabase } from "@/lib/supabaseClient";
import { Schedule } from "@/queries/learner";
import { TIME_SLOT_LABELS } from "@/types/schedule";

import { LearnerEditData, LearnerEditDialog } from "./LearnerEditDialog";
import { LearnerLLDisplay } from "./LLDisplay";

export interface LearnerInfo {
  id: string;
  name: string;
  phone: string;
  email: string;
  area: string;
  pincode?: string;
  city?: string;
  signed_up?: string;
  created_at?: string;
  address_lat?: number;
  address_lng?: number;
  preferred_start_date?: string;
  preferred_completion_days?: number;
  prefers_two_hour_classes?: boolean;
  preferred_two_hour_days?: string;
  two_hour_days?: string;
  pick_up_location?: string;
  DL_test_date: string | null;
  DL_result?: boolean | null;
  comments?: string;
  dob?: string | null;
  aadhar_state?: string | null;
  has_a_DL?: boolean | null;
  has_two_wheeler_license?: boolean | null;
  address_change_required?: boolean | null;
  LL_application_id?: string | null;
  LL_test_date?: string | null;
  LL_received?: boolean | null;
  LL_received_date?: string | null;
  is_LL_form_filled?: boolean | null;
}

interface SchedulePreference {
  day_of_week: number;
  time_slot: string;
}

interface LearnerSchedule {
  id: number;
  date: string;
  start_time: string | null;
  end_time: string | null;
  instructor_id: string | null;
  lesson_id: string | null;
  course_id: string | null;
  status: string | null;
  instructor_name?: string;
  lesson_number?: number;
  lesson_end_number?: number;
  course_name?: string;
  started_at?: string | null;
  ended_at?: string | null;
}

interface CourseInfo {
  id: string;
  name: string;
  total_lessons: number;
}

interface LearnerInfoDialogProps {
  learner: LearnerInfo;
  open: boolean;
  onClose: () => void;
}

export const LearnerInfoDialog = ({
  learner,
  open,
  onClose,
}: LearnerInfoDialogProps) => {
  const [schedulePreferences, setSchedulePreferences] = useState<
    SchedulePreference[]
  >([]);
  const [currentSchedules, setCurrentSchedules] = useState<LearnerSchedule[]>(
    [],
  );
  const [courseInfo, setCourseInfo] = useState<CourseInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingSchedules, setIsLoadingSchedules] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleReload, setScheduleReload] = useState(0);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [fullLearnerData, setFullLearnerData] =
    useState<LearnerEditData | null>(null);
  const [comments, setComments] = useState("");
  const [isSavingComments, setIsSavingComments] = useState(false);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const fetchLatestComments = async () => {
      if (!learner.id || !open) return;

      setComments("");
      setIsLoadingComments(true);
      try {
        const { data, error } = await supabase
          .from("Learner")
          .select("comments")
          .eq("id", learner.id)
          .abortSignal(signal)
          .single();

        if (error) throw error;

        // Update comments with the latest from the database
        if (!signal.aborted) setComments(data?.comments || "");
      } catch (error) {
        if (!signal.aborted) console.error("Error fetching comments:", error);
      } finally {
        if (!signal.aborted) setIsLoadingComments(false);
      }
    };

    if (open) {
      fetchLatestComments();
    }
    return () => controller.abort();
  }, [learner.id, open]);

  // Fetch full learner data for editing
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const fetchFullLearnerData = async () => {
      if (!learner.id || !open) return;

      setFullLearnerData(null);
      try {
        const { data, error } = await supabase
          .from("Learner")
          .select("*")
          .eq("id", learner.id)
          .abortSignal(signal)
          .single();

        if (error) throw error;

        if (!signal.aborted) setFullLearnerData(data as LearnerEditData);
      } catch (error) {
        if (!signal.aborted)
          console.error("Error fetching full learner data:", error);
      }
    };

    if (open) {
      fetchFullLearnerData();
    }
    return () => controller.abort();
  }, [learner.id, open]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const fetchSchedulePreferences = async () => {
      if (!learner.id || !open) return;

      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from("schedule_preferences")
          .select("day_of_week, time_slot")
          .eq("learner_id", learner.id)
          .abortSignal(signal);

        if (error) throw error;
        if (!signal.aborted) setSchedulePreferences(data || []);
      } catch (error) {
        if (!signal.aborted)
          console.error("Error fetching schedule preferences:", error);
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
    };

    const fetchCurrentSchedules = async () => {
      if (!learner.id || !open) return;

      setIsLoadingSchedules(true);
      setScheduleError("");
      setCurrentSchedules([]);
      try {
        const schedules = await fetchAdminSchedules(
          "learner_id",
          learner.id,
          signal,
        );
        if (signal.aborted) return;
        // Same duration-aware chronological numbering as the schedule manager.
        let lessonNumber = 1;
        setCurrentSchedules(
          schedules.map((schedule) => {
            const minutes = (time: string | null | undefined) => {
              const [hours, mins] = (time ?? "00:00").split(":").map(Number);
              return (
                (Number.isFinite(hours) ? hours : 0) * 60 +
                (Number.isFinite(mins) ? mins : 0)
              );
            };
            const hours = Math.max(
              1,
              Math.round(
                (minutes(schedule.end_time) - minutes(schedule.start_time)) /
                  60,
              ),
            );
            const number = lessonNumber;
            lessonNumber += hours;
            return {
              ...schedule,
              instructor_name: schedule.Instructor?.name || "Unassigned",
              course_name: schedule.Courses?.name || "Standalone class",
              lesson_number: number,
              lesson_end_number: hours > 1 ? number + hours - 1 : undefined,
            };
          }),
        );
      } catch (error) {
        if (!signal.aborted) {
          console.error("Error fetching current schedules:", error);
          setScheduleError("Schedules could not be loaded. Please retry.");
        }
      } finally {
        if (!signal.aborted) setIsLoadingSchedules(false);
      }
    };
    // Course progress is optional metadata, never a prerequisite for showing
    // existing classes (completed enrollments and course-less classes are valid).
    const fetchCourseInfo = async () => {
      setCourseInfo(null);
      if (!learner.id || !open) return;
      try {
        const { data, error } = await supabase
          .from("enrollment")
          .select("Courses(id, name, total_lessons)")
          .eq("learner_id", learner.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .abortSignal(signal)
          .maybeSingle();
        if (error) throw error;
        if (!signal.aborted && data?.Courses)
          setCourseInfo(data.Courses as CourseInfo);
      } catch (error) {
        if (!signal.aborted)
          console.error("Error fetching course progress:", error);
      }
    };
    if (open) {
      fetchSchedulePreferences();
      fetchCurrentSchedules();
      fetchCourseInfo();
    }
    return () => controller.abort();
  }, [learner.id, open, scheduleReload]);

  const saveComments = async () => {
    if (!learner.id) return;

    setIsSavingComments(true);
    try {
      const { error } = await supabase
        .from("Learner") // Assuming "Learner" is the table name for learners
        .update({ comments })
        .eq("id", learner.id);

      if (error) throw error;

      // Update the learner object with the new comments
      learner.comments = comments;

      toast({
        title: "Comments saved",
        description: "Your comments have been saved successfully.",
        duration: 3000,
      });
    } catch (error) {
      console.error("Error saving comments:", error);
      toast({
        title: "Error saving comments",
        description:
          "There was an error saving your comments. Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsSavingComments(false);
    }
  };
  const saveCommentsToDb = async (newComments: string) => {
    if (!learner.id) return;

    const { error } = await supabase
      .from("Learner")
      .update({ comments: newComments })
      .eq("id", learner.id);

    if (error) throw error;

    // Update the learner object with the new comments
    learner.comments = newComments;
  };
  // Add this component outside the main LearnerInfoDialog component
  const CommentsEditor = ({
    initialValue,
    onSave,
  }: {
    initialValue: string;
    onSave: (value: string) => Promise<void>;
  }) => {
    const [localComments, setLocalComments] = useState(initialValue);
    const [isSaving, setIsSaving] = useState(false);
    const { toast } = useToast();

    // Update local state when initialValue changes (e.g., when dialog opens with new learner)
    useEffect(() => {
      setLocalComments(initialValue);
    }, [initialValue]);

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setLocalComments(e.target.value);
      },
      [],
    );

    const handleSave = async () => {
      setIsSaving(true);
      try {
        await onSave(localComments);
        toast({
          title: "Comments saved",
          description: "Your comments have been saved successfully.",
          duration: 3000,
        });
      } catch (error) {
        console.error("Error saving comments:", error);
        toast({
          title: "Error saving comments",
          description:
            "There was an error saving your comments. Please try again.",
          variant: "destructive",
          duration: 3000,
        });
      } finally {
        setIsSaving(false);
      }
    };

    return (
      <div className="rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="mb-4 flex items-center justify-between border-b pb-2">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-primary">
            <MessageSquare className="h-5 w-5" />
            Admin Comments
          </h3>
          <Button
            onClick={handleSave}
            size="sm"
            className="flex items-center gap-1"
            disabled={isSaving}
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>

        <textarea
          placeholder="Add notes or comments about this learner..."
          className="min-h-[150px] w-full resize-y rounded-md border border-gray-300 p-3 text-gray-900 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={localComments}
          onChange={handleChange}
        />
        <p className="mt-2 text-xs text-gray-500">
          Add notes about the learner's preferences, special requirements, or
          any other important information.
        </p>
      </div>
    );
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  };

  const getDayName = (dayNumber: number) => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[dayNumber];
  };

  const getTimeSlotLabel = (timeSlot: string) => {
    return TIME_SLOT_LABELS[timeSlot] || timeSlot;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "Not specified";
    return format(new Date(dateString), "PPP");
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500 text-white">Completed</Badge>;
      case "booked":
        return <Badge className="bg-blue-500 text-white">Booked</Badge>;
      case "cancelled":
        return <Badge className="bg-red-500 text-white">Cancelled</Badge>;
      default:
        return <Badge className="bg-gray-500 text-white">{status}</Badge>;
    }
  };

  // Group schedule preferences by day
  const groupedPreferences = schedulePreferences.reduce(
    (acc, pref) => {
      if (!acc[pref.day_of_week]) {
        acc[pref.day_of_week] = [];
      }
      acc[pref.day_of_week].push(pref.time_slot);
      return acc;
    },
    {} as Record<number, string[]>,
  );

  const getScheduleDuration = (schedule: LearnerSchedule) => {
    if (!schedule || !schedule.started_at || !schedule.ended_at) {
      console.error(schedule, schedule?.started_at, schedule?.ended_at);
      return "Duration N/A";
    }

    // 1. Parse the timestamp strings into Date objects
    const startTime = new Date(schedule.started_at);
    const endTime = new Date(schedule.ended_at);

    // 2. Calculate the duration between the two Date objects
    const duration = intervalToDuration({
      start: startTime,
      end: endTime,
    });

    // Handle cases where the duration is 0 or contains only seconds (less than a minute)
    const isLessThanOneMinute =
      !duration.hours && !duration.minutes && duration.seconds > 0;

    // Check for true zero duration (no time elapsed)
    const isZeroDuration =
      !duration.hours && !duration.minutes && !duration.seconds;

    if (isZeroDuration) {
      return "0 min";
    }

    if (isLessThanOneMinute) {
      return "< 1 min";
    }

    // 3. Format the duration to display only hours and minutes
    // We use a custom format to ensure only hours and minutes are displayed.
    return formatDuration(duration, {
      format: ["hours", "minutes"],
    });
  };
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl">
        <DialogHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-xl font-bold text-primary">
              Customer Details
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowEditDialog(true)}
              disabled={!fullLearnerData}
            >
              <Edit2 className="mr-1 h-4 w-4" />
              Edit
            </Button>
          </div>
          <DialogClose />
        </DialogHeader>

        <div
          className="mt-4 overflow-y-auto pr-2"
          style={{ maxHeight: "calc(80vh - 80px)" }}
        >
          <div className="mb-6 flex items-start gap-6">
            <Avatar className="h-20 w-20 border-2 border-primary/20">
              <AvatarFallback className="bg-primary/10 text-2xl font-bold text-primary">
                {getInitials(learner.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="text-2xl font-bold">{learner.name}</h2>
              <p className="mt-1 text-gray-500">
                Customer since{" "}
                {formatDate(learner.created_at || learner.signed_up)}
              </p>

              {courseInfo && (
                <div className="mt-3 flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  <div className="rounded-md bg-primary/10 px-3 py-1">
                    <span className="font-medium text-primary">
                      {courseInfo.name}
                    </span>
                    <span className="ml-2 text-sm text-gray-600">
                      ({courseInfo.total_lessons} lessons total)
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-6">
              <div className="rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
                <h3 className="mb-4 border-b pb-2 text-lg font-semibold text-primary">
                  Contact Information
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Phone className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Phone</p>
                      <p className="text-gray-700">{learner.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Email</p>
                      <p className="text-gray-700">
                        {learner.email || "Not provided"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Address Area</p>
                      <p className="text-gray-700">
                        {learner.area}
                        {learner.pincode ? `, ${learner.pincode}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="ml-8 flex items-start gap-3">
                    <div>
                      <p className="font-medium">Pickup Address</p>
                      <p className="text-gray-700">
                        {learner.pick_up_location || "Same as address area"}
                      </p>
                      {learner.address_lat && learner.address_lng && (
                        <a
                          href={`https://maps.google.com/?q=${learner.address_lat},${learner.address_lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-sm text-primary hover:underline"
                        >
                          View on map
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
                <h3 className="mb-4 border-b pb-2 text-lg font-semibold text-primary">
                  Class Preferences
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Preferred Start Date</p>
                      <p className="text-gray-700">
                        {formatDate(learner.preferred_start_date)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Preferred Duration</p>
                      <p className="text-gray-700">
                        {learner.preferred_completion_days || "Not specified"}{" "}
                        days
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Info className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <p className="font-medium">2-hour Classes</p>
                      <div className="space-y-2">
                        <p className="text-gray-700">
                          {learner.prefers_two_hour_classes ? "Yes" : "No"}
                        </p>
                        {learner.prefers_two_hour_classes && (
                          <div className="mt-2">
                            <label className="mb-1 block text-sm font-medium text-gray-700">
                              Preferred Days
                            </label>
                            {learner.preferred_two_hour_days}
                            {/* <select
                              className="w-full rounded-md border border-gray-300 px-3 py-2 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
                              value={learner.preferred_two_hour_day || ""}
                              onChange={(e) => {
                                // Just update local state - no backend call
                                setLearner((prev) => ({
                                  ...prev,
                                  preferred_two_hour_day: e.target.value,
                                }));
                              }}
                            >
                              <option value="">Select a day</option>
                              <option value="Monday">Monday</option>
                              <option value="Tuesday">Tuesday</option>
                              <option value="Wednesday">Wednesday</option>
                              <option value="Thursday">Thursday</option>
                              <option value="Friday">Friday</option>
                              <option value="Saturday">Saturday</option>
                              <option value="Sunday">Sunday</option>
                            </select> */}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
                <h3 className="mb-4 border-b pb-2 text-lg font-semibold text-primary">
                  Current Schedule
                </h3>
                {isLoadingSchedules ? (
                  <div className="flex items-center justify-center p-6">
                    <div className="border-3 h-6 w-6 animate-spin rounded-full border-primary border-t-transparent"></div>
                  </div>
                ) : scheduleError ? (
                  <div
                    role="alert"
                    className="rounded-md bg-red-50 p-4 text-red-700"
                  >
                    <p>{scheduleError}</p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2"
                      onClick={() => setScheduleReload((n) => n + 1)}
                    >
                      Retry schedules
                    </Button>
                  </div>
                ) : currentSchedules.length === 0 ? (
                  <div className="rounded-md bg-gray-100 p-4 text-gray-500">
                    No schedules found for this learner
                  </div>
                ) : (
                  <div className="space-y-3">
                    {currentSchedules.map((schedule) => (
                      <div
                        key={schedule.id}
                        className="rounded-md bg-white p-3 shadow-sm transition-shadow hover:shadow"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">
                                Lesson {schedule.lesson_number}
                                {schedule.lesson_end_number
                                  ? ` & ${schedule.lesson_end_number}`
                                  : ""}{" "}
                                -{" "}
                              </h4>
                              {getStatusBadge(schedule.status || "booked")}
                              {schedule.status === "completed" && (
                                <span className="ml-2 text-sm text-gray-600">
                                  [
                                  {schedule?.started_at
                                    ? format(
                                        new Date(schedule.started_at),
                                        "hh:mm",
                                      )
                                    : "N/A"}
                                  &nbsp; - &nbsp;
                                  {schedule?.ended_at
                                    ? format(
                                        new Date(schedule.ended_at),
                                        "hh:mm",
                                      )
                                    : "N/A"}
                                  ] &nbsp; - &nbsp; [
                                  {getScheduleDuration(schedule)}] &nbsp;
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-sm">
                              <span className="font-medium">
                                {formatDate(schedule.date)}
                              </span>{" "}
                              •{" "}
                              <span className="text-primary">
                                {schedule.start_time?.substring(0, 5)} to{" "}
                                {schedule.end_time?.substring(0, 5)}
                              </span>
                            </p>
                            <p className="mt-1 text-sm text-gray-600">
                              <span className="font-medium">Instructor:</span>{" "}
                              {schedule.instructor_name}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-6">
              {courseInfo && (
                <div className="rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
                  <h3 className="mb-4 border-b pb-2 text-lg font-semibold text-primary">
                    Course Progress
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <BookOpen className="h-5 w-5 text-primary" />
                      <div className="flex-1">
                        <p className="font-medium">{courseInfo.name}</p>
                        <p className="text-sm text-gray-600">
                          {courseInfo.total_lessons} lessons total
                        </p>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>Progress</span>
                        <span className="font-medium">
                          {
                            currentSchedules.filter(
                              (s) => s.status === "completed",
                            ).length
                          }{" "}
                          / {courseInfo.total_lessons} lessons
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: `${(currentSchedules.filter((s) => s.status === "completed").length / courseInfo.total_lessons) * 100}%`,
                          }}
                        ></div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-md bg-primary/5 p-3">
                      <div>
                        <p className="text-sm font-medium">Next Lesson</p>
                        {currentSchedules.find(
                          (s) => s.status !== "completed",
                        ) ? (
                          <p className="text-sm text-gray-600">
                            Lesson{" "}
                            {
                              currentSchedules.find(
                                (s) => s.status !== "completed",
                              )?.lesson_number
                            }{" "}
                            on{" "}
                            {formatDate(
                              currentSchedules.find(
                                (s) => s.status !== "completed",
                              )?.date,
                            )}
                          </p>
                        ) : (
                          <p className="text-sm text-gray-600">
                            No upcoming lessons
                          </p>
                        )}
                      </div>
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
                <h3 className="mb-4 border-b pb-2 text-lg font-semibold text-primary">
                  Schedule Preferences
                </h3>
                {isLoading ? (
                  <div className="flex items-center justify-center p-6">
                    <div className="border-3 h-6 w-6 animate-spin rounded-full border-primary border-t-transparent"></div>
                  </div>
                ) : Object.keys(groupedPreferences).length === 0 ? (
                  <div className="rounded-md bg-gray-100 p-4 text-gray-500">
                    No schedule preferences found
                  </div>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(groupedPreferences).map(
                      ([dayNum, timeSlots]) => (
                        <div
                          key={dayNum}
                          className="rounded-md bg-white p-3 shadow-sm transition-shadow hover:shadow"
                        >
                          <h4 className="font-medium text-primary">
                            {getDayName(parseInt(dayNum))}
                          </h4>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {timeSlots.map((slot, idx) => (
                              <span
                                key={idx}
                                className="inline-block rounded-full bg-primary/10 px-3 py-1 text-sm text-primary"
                              >
                                {getTimeSlotLabel(slot)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
              {learner.phone && (
                <LearnerLLDisplay learnerPhone={learner.phone} />
              )}
              {/* Test date Section */}
              <div className="rounded-lg bg-gray-50 p-5 shadow-sm transition-shadow hover:shadow-md">
                <h3 className="mb-4 border-b pb-2 text-lg font-semibold text-primary">
                  Final Test Date
                </h3>
                {learner.DL_test_date || "N/A"}
              </div>
              {/* Comments Section */}
              <CommentsEditor
                initialValue={comments}
                onSave={saveCommentsToDb}
              />
            </div>
          </div>
        </div>
      </DialogContent>

      {/* Edit Dialog */}
      {fullLearnerData && (
        <LearnerEditDialog
          learner={fullLearnerData}
          open={showEditDialog}
          onClose={() => setShowEditDialog(false)}
          onSaved={() => {
            // Refresh the data
            setShowEditDialog(false);
            // Re-fetch full learner data after save
            supabase
              .from("Learner")
              .select("*")
              .eq("id", learner.id)
              .single()
              .then(({ data }) => {
                if (data) setFullLearnerData(data as LearnerEditData);
              });
          }}
        />
      )}
    </Dialog>
  );
};

// Simple card component for list views
export const LearnerInfoCard = ({
  learner,
  compact = false,
  onClick,
}: {
  learner: LearnerInfo;
  compact?: boolean;
  onClick?: (learner: LearnerInfo) => void;
}) => {
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  };

  const handleClick = () => {
    if (onClick) {
      onClick(learner);
    }
  };

  return (
    <div
      className={`cursor-pointer rounded-lg border p-3 transition-all hover:border-primary/30 hover:bg-gray-50 hover:shadow-sm ${compact ? "py-2" : "p-4"}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-3">
        <Avatar className={compact ? "h-8 w-8" : "h-10 w-10"}>
          <AvatarFallback className="bg-primary/10 text-primary">
            {getInitials(learner.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{learner.name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {learner.area}
          </div>
        </div>
      </div>
    </div>
  );
};
