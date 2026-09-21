import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format, formatDate, parse } from "date-fns";
import { Delete, Mail, RefreshCcw, Search, Send, UserPlus } from "lucide-react";
import { ArrowLeft, Loader2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { usePhoneVisibility } from "@/context/phone-visibility-context";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import { useCurrentUser } from "@/queries/userManagement";
import { maskPhoneNumber } from "@/utils/phoneMasking";

export default function NotificationManagement() {
  const navigate = useNavigate();

  // There are 3 types of notifications
  // Next day lesson reminder
  // Reschedule closing window time reminder
  // Reminder message to be sent to instructor after reschedule
  return (
    <div
      className="min-h-screen bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
        backgroundAttachment: "fixed", // This prevents the background from getting cut off
      }}
    >
      <div className="container mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="h-10 w-10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-4xl font-bold tracking-tight">
            Daily Notification Management
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Set reminders and send daily notifications to learners
          </p>
        </div>

        <div className="grid gap-6">
          {/* Individual Notification */}
          <IndividualNotificationCard />
          {/* Class Schedule */}
          <LearnerNotificationCard />
        </div>
      </div>
    </div>
  );
}

// Templates that make sense for individual sending (no extra variables needed beyond learner name)
const LEARNER_TEMPLATES = [
  { key: "SIGN_UP_ON_APP", label: "Sign Up on App Reminder" },
  {
    key: "LL_DETAILS_BOOK_APPOINTMENT",
    label: "LL Details - Book Appointment",
  },
  { key: "LL_APPLICATION_UPDATE", label: "LL Application Update" },
  { key: "LL_RECEIVED", label: "LL Received - Share Availability" },
  { key: "SIGN_UP_DONE_NEED_SCHEDULE", label: "Sign Up Done - Need Schedule" },
  { key: "THANKS_FOR_AVAILABILITY", label: "Thanks for Availability" },
  { key: "WEBAPP_RESCHEDULE_REQUEST", label: "Reschedule Request Received" },
  {
    key: "WEBAPP_RESCHEDULE_DONE_CHECK_NEW_SCHEDULE",
    label: "Reschedule Done - Check New Schedule",
  },
  { key: "WEBAPP_SCHEDULE_LESSON_10", label: "Schedule Lesson 10" },
  { key: "WEBAPP_LESSON_10_SCHEDULED", label: "Lesson 10 Scheduled" },
  {
    key: "WEBAPP_DL_TEST_NOT_PASSED_IT_IS_ALRIGHT",
    label: "DL Test Not Passed - Encouragement",
  },
  {
    key: "WEBAPP_CONGRATULATIONS_ON_PASSING_THE_DL_TEST",
    label: "Congratulations on DL Test",
  },
  {
    key: "WEBAPP_LESSONS_DONE_REVIEW_PLEASE",
    label: "Lessons Done - Review Request",
  },
  {
    key: "WEBAPP_THANK_YOU_FOR_SIGNING_UP_LL_FIRST",
    label: "Thank You for Signing Up (LL First)",
  },
  {
    key: "WEBAPP_THANK_YOU_SIGNUP_AVAILABILTY_FOR_LESSONS",
    label: "Thank You - Availability for Lessons",
  },
  { key: "WEBAPP_RESTEST_LL", label: "LL Retest Encouragement" },
  {
    key: "WEBAPP_LL_DOCS_APPROVED_TEST_DONE_AND_RESULT",
    label: "LL Docs Approved - Test Done",
  },
  {
    key: "WEBAPP_PLEASE_FILL_LL_FORM_AND_BOOK_APPOINTMENT",
    label: "Please Fill LL Form & Book Appointment",
  },
];

function IndividualNotificationCard() {
  const { toast } = useToast();
  const [recipientType, setRecipientType] = useState<"learner" | "instructor">(
    "learner",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedPeople, setSelectedPeople] = useState<any[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendProgress, setSendProgress] = useState({
    sent: 0,
    failed: 0,
    total: 0,
  });

  // Search learners
  const { data: learnerResults, isLoading: searchingLearners } = useQuery({
    queryKey: ["search-learners", searchQuery],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Learner")
        .select("id, name, phone")
        .or(`name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`)
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: recipientType === "learner" && searchQuery.length >= 2,
  });

  // Search instructors
  const { data: instructorResults, isLoading: searchingInstructors } = useQuery(
    {
      queryKey: ["search-instructors", searchQuery],
      queryFn: async () => {
        const { data, error } = await supabase
          .from("Instructor")
          .select("id_instructor, name, phone")
          .or(`name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`)
          .limit(10);
        if (error) throw error;
        return data;
      },
      enabled: recipientType === "instructor" && searchQuery.length >= 2,
    },
  );

  const searchResults =
    recipientType === "learner" ? learnerResults : instructorResults;
  const isSearching =
    recipientType === "learner" ? searchingLearners : searchingInstructors;

  const getPersonId = (person: any) =>
    recipientType === "learner" ? person.id : person.id_instructor;

  const isAlreadySelected = (person: any) =>
    selectedPeople.some((p) => getPersonId(p) === getPersonId(person));

  const addPerson = (person: any) => {
    if (!isAlreadySelected(person)) {
      setSelectedPeople((prev) => [...prev, person]);
    }
    setSearchQuery("");
  };

  const removePerson = (person: any) => {
    setSelectedPeople((prev) =>
      prev.filter((p) => getPersonId(p) !== getPersonId(person)),
    );
  };

  const handleSendNotification = async () => {
    if (selectedPeople.length === 0 || !selectedTemplate) {
      toast({
        title: "Missing info",
        description: "Please select at least one person and a template",
        variant: "destructive",
      });
      return;
    }

    setIsSending(true);
    const progress = { sent: 0, failed: 0, total: selectedPeople.length };
    setSendProgress(progress);

    for (const person of selectedPeople) {
      try {
        const learnerId = getPersonId(person);
        const { error } = await supabase.functions.invoke("send-message", {
          body: {
            message_type: selectedTemplate,
            learner_id: learnerId,
          },
        });
        if (error) throw error;
        progress.sent++;
      } catch (err) {
        console.error(`Error sending to ${person.name}:`, err);
        progress.failed++;
      }
      setSendProgress({ ...progress });
    }

    setIsSending(false);
    toast({
      title: "Done",
      description: `Sent: ${progress.sent}, Failed: ${progress.failed} out of ${progress.total}`,
      variant: progress.failed > 0 ? "destructive" : undefined,
    });
    setSelectedTemplate("");
  };

  return (
    <Card className="transition-all hover:shadow-lg">
      <CardHeader>
        <CardTitle className="text-xl">Send Notification</CardTitle>
        <p className="text-sm text-muted-foreground">
          Send a WhatsApp notification to one or more learners / instructors
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recipient type toggle */}
        <div className="flex gap-2">
          <Button
            variant={recipientType === "learner" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setRecipientType("learner");
              setSelectedPeople([]);
              setSearchQuery("");
            }}
          >
            Learner
          </Button>
          <Button
            variant={recipientType === "instructor" ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setRecipientType("instructor");
              setSelectedPeople([]);
              setSearchQuery("");
            }}
          >
            Instructor
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${recipientType} by name or phone...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Search results dropdown */}
        {searchQuery.length >= 2 && (
          <div className="max-h-48 overflow-y-auto rounded-md border">
            {isSearching ? (
              <div className="flex items-center justify-center p-3">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : searchResults && searchResults.length > 0 ? (
              searchResults.map((person: any) => {
                const alreadySelected = isAlreadySelected(person);
                return (
                  <button
                    key={person.id || person.id_instructor}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                      alreadySelected
                        ? "bg-green-50 text-green-700"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => !alreadySelected && addPerson(person)}
                    disabled={alreadySelected}
                  >
                    <span className="font-medium">{person.name}</span>
                    <span className="text-muted-foreground">
                      {alreadySelected ? "Added" : person.phone}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="p-3 text-center text-sm text-muted-foreground">
                No results found
              </p>
            )}
          </div>
        )}

        {/* Selected people chips */}
        {selectedPeople.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Selected ({selectedPeople.length})
              </span>
              <button
                className="text-xs text-red-500 hover:text-red-700"
                onClick={() => setSelectedPeople([])}
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedPeople.map((person) => (
                <span
                  key={getPersonId(person)}
                  className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700"
                >
                  {person.name}
                  <button
                    className="ml-1 text-green-500 hover:text-green-800"
                    onClick={() => removePerson(person)}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Template selection */}
        <div>
          <Label className="mb-2 block text-sm font-medium">
            Notification Template
          </Label>
          <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
            <SelectTrigger>
              <SelectValue placeholder="Select a template..." />
            </SelectTrigger>
            <SelectContent>
              {LEARNER_TEMPLATES.map((t) => (
                <SelectItem key={t.key} value={t.key}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Progress bar while sending */}
        {isSending && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${((sendProgress.sent + sendProgress.failed) / sendProgress.total) * 100}%`,
                }}
              />
            </div>
            <p className="text-center text-xs text-muted-foreground">
              {sendProgress.sent + sendProgress.failed} / {sendProgress.total}{" "}
              sent
            </p>
          </div>
        )}

        {/* Send button */}
        <Button
          onClick={handleSendNotification}
          disabled={
            selectedPeople.length === 0 || !selectedTemplate || isSending
          }
          className="w-full"
        >
          {isSending ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Sending {sendProgress.sent + sendProgress.failed}/
              {sendProgress.total}...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Send className="h-4 w-4" />
              Send to {selectedPeople.length || ""} {recipientType}
              {selectedPeople.length !== 1 ? "s" : ""}
            </span>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function LearnerNotificationCard() {
  const [loading, setLoading] = useState(true);
  const [schedulesList, setSchedulesList] = useState<any[]>([]);
  const { toast } = useToast();

  const maxDaysWindowToFetch = 1;

  const fetchSchedulesForReminder = async () => {
    const startDate = new Date();
    const endDate = addDays(startDate, maxDaysWindowToFetch);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("Schedule")
        .select(
          `
          *,
          Learner(name, phone, email, pick_up_location, address_lat, address_lng),
          Instructor(name, phone, email),
          Courses(name, duration),
          Lesson(id, description, number)`,
        )
        .gte("date", endDate.toISOString().split("T")[0])
        .lte("date", endDate.toISOString().split("T")[0])
        .or("isTentative.eq.false,isTentative.is.null")
        .neq("status", "paused")
        .order("date", { ascending: true })
        .order("start_time", { ascending: true });

      if (error) throw error;

      // Fix lesson numbers: calculate chronological position per learner+course
      if (data && data.length > 0) {
        // Get unique learner+course combos
        const combos = new Set(
          data.map((s: any) => `${s.learner_id}__${s.course_id}`),
        );

        // Fetch all schedules for these learner+course combos to determine correct order
        const learnerIds = [
          ...new Set(data.map((s: any) => s.learner_id).filter(Boolean)),
        ];
        const { data: allSchedules } = await supabase
          .from("Schedule")
          .select(
            "id, date, start_time, learner_id, course_id, lesson_id, Lesson(id, number)",
          )
          .in("learner_id", learnerIds)
          .neq("status", "paused")
          .or("isTentative.eq.false,isTentative.is.null")
          .order("date", { ascending: true })
          .order("start_time", { ascending: true });

        if (allSchedules) {
          // Group by learner+course and assign chronological numbers
          const lessonNumberMap = new Map<number, number>(); // schedule.id -> correct lesson number
          const grouped: Record<string, any[]> = {};
          for (const s of allSchedules) {
            const key = `${s.learner_id}__${s.course_id}`;
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(s);
          }
          for (const schedules of Object.values(grouped)) {
            schedules
              .sort(
                (a: any, b: any) =>
                  new Date(`${a.date}T${a.start_time}`).getTime() -
                  new Date(`${b.date}T${b.start_time}`).getTime(),
              )
              .forEach((s: any, i: number) => {
                lessonNumberMap.set(s.id, i + 1);
              });
          }

          // Apply correct lesson numbers to tomorrow's schedules
          for (const schedule of data as any[]) {
            const correctNumber = lessonNumberMap.get(schedule.id);
            if (correctNumber && schedule.Lesson) {
              schedule.Lesson.number = correctNumber;
            }
          }
        }
      }

      setSchedulesList(data || []);
      return data;
    } catch (err) {
      console.error("Error fetching schedules:", err);
      toast({
        title: "Error",
        description: "Failed to fetch schedules",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedulesForReminder();
  }, []);

  return (
    <Card className="transition-all hover:shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-xl">Schedules for tomorrow</CardTitle>
        <Button
          variant="outline"
          size="icon"
          onClick={fetchSchedulesForReminder}
          disabled={loading}
        >
          <RefreshCcw size={16} className={loading ? "animate-spin" : ""} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-4 text-center text-muted-foreground">
            Loading schedules...
          </p>
        ) : schedulesList.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground">
            No schedules found for tomorrow
          </p>
        ) : (
          <Tabs defaultValue="learners">
            <TabsList>
              <TabsTrigger value="learners">
                Learners ({schedulesList.length})
              </TabsTrigger>
              <TabsTrigger value="instructors">
                Instructors (
                {new Set(schedulesList.map((s) => s.instructor_id)).size})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="learners">
              <LearnerTab schedulesList={schedulesList} toast={toast} />
            </TabsContent>

            <TabsContent value="instructors">
              <InstructorTab schedulesList={schedulesList} toast={toast} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Learner Tab ─────────────────────────────────────────────────────────────

function LearnerTab({
  schedulesList,
  toast,
}: {
  schedulesList: any[];
  toast: any;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [sendingStatuses, setSendingStatuses] = useState<
    Record<number, boolean>
  >({});
  const [sendingEmailId, setSendingEmailId] = useState<number | null>(null);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [rescheduleFinalTime, setRescheduleFinalTime] = useState("");

  const allSelected =
    schedulesList.length > 0 && selected.size === schedulesList.length;
  const someSelected = selected.size > 0;
  const isSending = Object.values(sendingStatuses).some(Boolean);

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(schedulesList.map((s: any) => s.id as number)));
    }
  };

  const selectedSchedules = schedulesList.filter((s: any) =>
    selected.has(s.id),
  );

  // ── Send lesson reminder to selected learners ──
  const sendLessonReminders = async () => {
    for (const schedule of selectedSchedules) {
      setSendingStatuses((prev) => ({ ...prev, [schedule.id]: true }));

      const displayStartTime = schedule.start_time
        ? format(
            parse(schedule.start_time.slice(0, 5), "HH:mm", new Date()),
            "h:mm a",
          )
        : "NA";

      const displayDate = schedule.date
        ? format(new Date(schedule.date), "dd MMM yyyy")
        : "tomorrow";

      try {
        const { error } = await supabase.functions.invoke("send-message", {
          body: {
            message_type: "REMINDER_CUSTOMER_FOR_CLASS_FINAL",
            learner_name: schedule.Learner.name,
            learner_phone: schedule.Learner.phone,
            start_time: displayStartTime,
            date: displayDate,
            pickup_location: schedule.Learner.pick_up_location,
            instructor_name: schedule.Instructor.name,
            // instructor_phone: schedule.Instructor.phone,
            course_name: schedule.Courses?.name || "Demo Class",
          },
        });
        if (error) throw error;
        toast({
          title: "Sent",
          description: `Lesson reminder sent to ${schedule.Learner.name}`,
        });
      } catch (err) {
        console.error("Error sending lesson reminder:", err);
        toast({
          title: "Error",
          description: `Failed to send reminder to ${schedule.Learner.name}`,
          variant: "destructive",
        });
      } finally {
        setSendingStatuses((prev) => ({ ...prev, [schedule.id]: false }));
      }
    }
  };

  // ── Send reschedule window reminder to selected learners ──
  const sendRescheduleReminders = async () => {
    if (!rescheduleFinalTime) {
      toast({
        title: "Error",
        description: "Please enter a reschedule final time",
        variant: "destructive",
      });
      return;
    }
    setRescheduleDialogOpen(false);

    for (const schedule of selectedSchedules) {
      setSendingStatuses((prev) => ({ ...prev, [schedule.id]: true }));

      const displayDate = schedule.date
        ? format(new Date(schedule.date), "dd MMM yyyy")
        : "tomorrow";

      try {
        const { error } = await supabase.functions.invoke("send-message", {
          body: {
            message_type: "REMINDER_LESSON_RESCHEDULE_WINDOW_TIME",
            learner_name: schedule.Learner.name,
            learner_phone: schedule.Learner.phone,
            final_time: rescheduleFinalTime,
            date: displayDate,
          },
        });
        if (error) throw error;
        toast({
          title: "Sent",
          description: `Reschedule reminder sent to ${schedule.Learner.name}`,
        });
      } catch (err) {
        console.error("Error sending reschedule reminder:", err);
        toast({
          title: "Error",
          description: `Failed to send reschedule reminder to ${schedule.Learner.name}`,
          variant: "destructive",
        });
      } finally {
        setSendingStatuses((prev) => ({ ...prev, [schedule.id]: false }));
      }
    }
    setRescheduleFinalTime("");
  };

  // ── Send schedule email ──
  const handleSendScheduleEmail = async (scheduleData: any) => {
    setSendingEmailId(scheduleData.id);

    const instructorEmail = scheduleData.Instructor?.email || "";
    const learnerEmail = scheduleData.Learner?.email || "";
    const lessonId =
      scheduleData.Lesson?.number || scheduleData.Lesson?.description || "N/A";
    const learnerName = scheduleData.Learner?.name || "Unknown Learner";
    if (!instructorEmail || !learnerEmail) {
      toast({
        title: "Email Failed",
        description: `Missing email for ${!instructorEmail ? "Instructor" : "Learner"}.`,
        variant: "destructive",
      });
      setSendingEmailId(null);
      return;
    }

    try {
      const { error } = await supabase.functions.invoke(
        "send-schedule-emails",
        {
          body: {
            learnerEmail,
            instructorEmail,
            instructorName: scheduleData.Instructor?.name || "Instructor",
            learnerName,
            learnerPhone: scheduleData.Learner?.phone || "",
            emailType: "schedule",
            batchInfo: ` (Lesson ${lessonId})`,
            learnerId: scheduleData.learner_id,
            isMultiEvent: false,
            events: [
              {
                lessonNumber: scheduleData.Lesson?.number || 1,
                startTime: new Date(
                  `${scheduleData.date}T${scheduleData.start_time}`,
                ).toISOString(),
                endTime: new Date(
                  `${scheduleData.date}T${scheduleData.end_time}`,
                ).toISOString(),
                pickupLocation:
                  scheduleData.Learner?.pick_up_location || "Standard Location",
                uid: `lesson-${scheduleData.id}`,
                isCancellation: false,
                sequence: 0,
              },
            ],
            allEvents: [],
            learnerICSArray: [],
            instructorICSArray: [],
          },
        },
      );

      if (error) throw error;

      toast({
        title: "Email Sent",
        description: `Schedule for Lesson ${lessonId} sent to ${learnerName}`,
      });
    } catch (error) {
      console.error("[EMAIL_ERROR]", error);
      toast({
        title: "Email Failed",
        description: "Server error while processing email.",
        variant: "destructive",
      });
    } finally {
      setSendingEmailId(null);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {/* Bulk action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={sendLessonReminders}
          disabled={!someSelected || isSending}
        >
          {isSending ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <Send size={14} className="mr-1" />
          )}
          Send Lesson Reminder
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setRescheduleDialogOpen(true)}
          disabled={!someSelected || isSending}
        >
          <Send size={14} className="mr-1" />
          Send Reschedule Reminder
        </Button>

        {someSelected && (
          <Badge variant="secondary">{selected.size} selected</Badge>
        )}
      </div>

      {/* Schedule table with checkboxes */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-2 text-left">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              </th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                Learner
              </th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                Course / Lesson
              </th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                Instructor
              </th>
              <th className="px-2 py-2 text-right text-xs font-semibold uppercase">
                Date
              </th>
              <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                Time
              </th>
              <th className="px-2 py-2 text-right text-xs font-semibold uppercase">
                Email
              </th>
            </tr>
          </thead>
          <tbody>
            {schedulesList.map((schedule) => (
              <tr
                key={schedule.id}
                className={`border-b hover:bg-muted/50 ${
                  selected.has(schedule.id) ? "bg-muted/30" : ""
                }`}
              >
                <td className="px-2 py-2">
                  <Checkbox
                    checked={selected.has(schedule.id)}
                    onCheckedChange={() => toggleOne(schedule.id)}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="font-medium">
                    {schedule.Learner?.name || "Unknown"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {schedule.Learner?.phone || ""}
                  </div>
                </td>
                <td className="px-2 py-2 text-sm">
                  <div>
                    {schedule.Lesson?.number
                      ? `Lesson ${schedule.Lesson.number}`
                      : "Unknown Lesson"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {schedule.Courses?.name || "Demo Class"}
                  </div>
                </td>
                <td className="px-2 py-2 text-sm">
                  {schedule.Instructor?.name || "Unknown"}
                </td>
                <td className="px-2 py-2 text-right text-sm">
                  {schedule.date || "Unknown"}
                </td>
                <td className="px-2 py-2 text-center text-sm">
                  {schedule.start_time
                    ? schedule.start_time.split(":").slice(0, 2).join(":")
                    : "N/A"}
                </td>
                <td className="px-2 py-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleSendScheduleEmail(schedule)}
                    disabled={sendingEmailId === schedule.id}
                    className="h-8 px-2 text-xs"
                  >
                    {sendingEmailId === schedule.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Mail size={12} />
                    )}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reschedule final time dialog */}
      <Dialog
        open={rescheduleDialogOpen}
        onOpenChange={setRescheduleDialogOpen}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              Send Reschedule Reminder to {selected.size} learner
              {selected.size !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="final-time" className="text-right">
                Final time
              </Label>
              <Input
                id="final-time"
                value={rescheduleFinalTime}
                onChange={(e) => setRescheduleFinalTime(e.target.value)}
                placeholder="e.g. 6:00 PM"
                maxLength={32}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setRescheduleDialogOpen(false)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button onClick={sendRescheduleReminders}>
              Send to {selected.size} learner{selected.size !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Instructor Tab ──────────────────────────────────────────────────────────

function InstructorTab({
  schedulesList,
  toast,
}: {
  schedulesList: any[];
  toast: any;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingStatuses, setSendingStatuses] = useState<
    Record<string, boolean>
  >({});
  const { data: currentAdmin } = useCurrentAdmin();
  const { data: currentUser } = useCurrentUser();

  const canViewUnmaskedPhoneNumbers =
    currentAdmin?.is_super_admin ||
    currentAdmin?.permissions?.includes("view_unmasked_phone_numbers") ||
    currentUser?.permissions?.includes("view_unmasked_phone_numbers") ||
    false;

  const maxFields = 5;

  // Group schedules by instructor
  const groupedInstructors = useMemo(() => {
    const groups: Record<
      string,
      { id: string; name: string; phone: string; schedules: any[] }
    > = {};

    for (const sch of schedulesList) {
      const instId = sch.instructor_id || "unknown";
      if (!groups[instId]) {
        groups[instId] = {
          id: instId,
          name: sch.Instructor?.name || "Unknown Instructor",
          phone: sch.Instructor?.phone || "",
          schedules: [],
        };
      }
      groups[instId].schedules.push(sch);
    }

    return Object.values(groups);
  }, [schedulesList]);

  const allSelected =
    groupedInstructors.length > 0 &&
    selected.size === groupedInstructors.length;
  const someSelected = selected.size > 0;
  const isSending = Object.values(sendingStatuses).some(Boolean);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(groupedInstructors.map((g) => g.id)));
    }
  };

  const sendInstructorReminders = async () => {
    const selectedInstructors = groupedInstructors.filter((g) =>
      selected.has(g.id),
    );

    for (const instructor of selectedInstructors) {
      setSendingStatuses((prev) => ({ ...prev, [instructor.id]: true }));

      const totalBatches = Math.ceil(instructor.schedules.length / maxFields);

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchSchedules = instructor.schedules.slice(
          batchIdx * maxFields,
          (batchIdx + 1) * maxFields,
        );

        const schedulePacket: Record<string, string> = {};
        for (let i = 0; i < maxFields; i++) {
          const sch = batchSchedules[i];
          if (sch) {
            const formatTime = (timeStr: string) => {
              if (!timeStr) return "??";
              return format(
                parse(timeStr.slice(0, 5), "HH:mm", new Date()),
                "h:mm a",
              );
            };
            const startTime = formatTime(sch.start_time);
            const endTime = formatTime(sch.end_time);
            const date = sch.date ? format(new Date(sch.date), "dd MMM") : "NA";
            const learnerName = sch.Learner?.name ?? "Learner";
            const learnerPhone = sch.Learner?.phone ?? "N/A";
            const lessonDesc = sch.Lesson?.number
              ? `Lesson ${sch.Lesson.number}`
              : (sch.Lesson?.description ?? "Lesson");
            const lat = sch.Learner?.address_lat;
            const lng = sch.Learner?.address_lng;
            const mapLink =
              lat && lng ? `http://maps.google.com/maps?q=${lat},${lng}` : "NA";

            schedulePacket[`field${i + 1}`] =
              `${date} | ${startTime}-${endTime} | ${learnerName} (${lessonDesc}) | ${mapLink}`;
          } else {
            schedulePacket[`field${i + 1}`] = " ";
          }
        }

        try {
          const { error } = await supabase.functions.invoke("send-message", {
            body: {
              message_type: "REMINDER_INSTRUCTOR_FOR_CLASS_FINAL",
              instructor_name: instructor.name,
              instructor_phone: instructor.phone,
              arg1: schedulePacket.field1,
              arg2: schedulePacket.field2,
              arg3: schedulePacket.field3,
              arg4: schedulePacket.field4,
              arg5: schedulePacket.field5,
            },
          });
          if (error) throw error;
        } catch (err) {
          console.error(`Error sending reminder to ${instructor.name}:`, err);
          toast({
            title: "Error",
            description: `Failed to send reminder to ${instructor.name}`,
            variant: "destructive",
          });
        }
      }

      setSendingStatuses((prev) => ({ ...prev, [instructor.id]: false }));
      toast({
        title: "Sent",
        description: `Reminder sent to ${instructor.name}`,
      });
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {/* Bulk action */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={sendInstructorReminders}
          disabled={!someSelected || isSending}
        >
          {isSending ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <Send size={14} className="mr-1" />
          )}
          Send Lesson Reminder
        </Button>

        {someSelected && (
          <Badge variant="secondary">{selected.size} selected</Badge>
        )}
      </div>

      {/* Instructor table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="px-2 py-2 text-left">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              </th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                Instructor
              </th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                Phone
              </th>
              <th className="px-2 py-2 text-center text-xs font-semibold uppercase">
                Lessons
              </th>
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase">
                Learners
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedInstructors.map((instructor) => (
              <tr
                key={instructor.id}
                className={`border-b hover:bg-muted/50 ${
                  selected.has(instructor.id) ? "bg-muted/30" : ""
                }`}
              >
                <td className="px-2 py-2">
                  <Checkbox
                    checked={selected.has(instructor.id)}
                    onCheckedChange={() => toggleOne(instructor.id)}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="font-medium">{instructor.name}</div>
                </td>
                <td className="px-2 py-2 text-sm text-gray-600">
                  {canViewUnmaskedPhoneNumbers
                    ? instructor.phone
                    : maskPhoneNumber(instructor.phone)}
                </td>
                <td className="px-2 py-2 text-center">
                  <Badge variant="secondary">
                    {instructor.schedules.length} lesson
                    {instructor.schedules.length !== 1 ? "s" : ""}
                  </Badge>
                </td>
                <td className="px-2 py-2 text-sm">
                  {instructor.schedules
                    .map((s: any) => s.Learner?.name || "Unknown")
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
