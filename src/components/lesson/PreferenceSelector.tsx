import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { supabase } from "@/lib/supabaseClient";
import { useMutationRescheduleRequest } from "@/queries/learner";
import {
  useSchedulePreferences,
  useUpdatePreference,
} from "@/queries/preferences";
import {
  DAYS_OF_WEEK,
  TIME_SLOT_LABELS,
  TIME_SLOTS,
  TimeSlot,
} from "@/types/schedule";

interface PreferenceSelectorProps {
  learnerId: string;
  lessons: string[];
  type: string;
  isFlexible?: boolean;
}

function PreferenceSelector({
  learnerId,
  lessons,
  type,
  isFlexible = false,
}: PreferenceSelectorProps) {
  const [selectedSlots, setSelectedSlots] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);

  // Fetch existing preferences
  const { data: existingPreferences, isLoading } =
    useSchedulePreferences(learnerId);

  // Update preferences mutation
  const { mutateAsync: updatePreference, isPending } = useUpdatePreference();
  const {
    mutateAsync: rescheduleRequest,
    isPending: isRescheduleRequestPending,
  } = useMutationRescheduleRequest();
  const navigate = useNavigate();

  // Initialize selected slots from existing preferences
  useEffect(() => {
    if (existingPreferences) {
      const slots = new Set<string>();
      existingPreferences.forEach((pref) => {
        slots.add(`${pref.day_of_week}-${pref.time_slot}`);
      });
      setSelectedSlots(slots);
    }
  }, [existingPreferences]);

  const handleSlotToggle = (dayOfWeek: number, timeSlot: TimeSlot) => {
    const key = `${dayOfWeek}-${timeSlot}`;
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const sendAdminEmail = async (subject: string, message: string) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-admin-email",
        {
          body: { subject, message },
        },
      );

      if (error) throw error;
      return data;
    } catch (error) {
      console.error("Error sending admin email:", error);
      throw error;
    }
  };

  // Add this at the component level
  const [learnerName, setLearnerName] = useState<string>("");

  // Add this useEffect to fetch the learner name when the component mounts
  useEffect(() => {
    const fetchLearnerName = async () => {
      try {
        const { data, error } = await supabase
          .from("Learner")
          .select("name")
          .eq("id", learnerId)
          .single();

        if (error) throw error;
        if (data) setLearnerName(data.name ?? "");
      } catch (error) {
        console.error("Error fetching learner name:", error);
      }
    };

    fetchLearnerName();
  }, [learnerId]);

  const handleSubmit = async () => {
    if (savingRef.current) return;
    if (!isFlexible && selectedSlots.size === 0) {
      setSaveError("Select at least one timing slot before saving.");
      return;
    }

    savingRef.current = true;
    setIsSaving(true);
    setSaveError("");
    try {
      // Convert selected slots to preferences format
      // Flexible availability means all slots, not an empty preference list.
      const slotsToSave = isFlexible
        ? DAYS_OF_WEEK.flatMap((_, day) =>
            TIME_SLOTS.map((slot) => `${day}-${slot}`),
          )
        : Array.from(selectedSlots);
      const preferences = slotsToSave.map((key) => {
        const slot = key.split("-");
        const dayOfWeek = slot[0];
        const timeSlot = `${slot[1]}-${slot[2]}`;
        return {
          day: parseInt(dayOfWeek),
          timeSlot: timeSlot as TimeSlot,
        };
      });

      await updatePreference({ learnerId, preferences });

      // New/lesson10 requests are created here. Reschedule requests are
      // already created by the confirmation/payment flow; do not duplicate them.
      // Keep virtual lesson IDs intact so custom courses retain their hour count.
      if (type === "new" || type === "lesson10") {
        await rescheduleRequest({
          learnerId,
          lessonIds: lessons,
          type,
        });
      }

      // Notifications are best-effort, but only AFTER the queue entry exists.
      supabase.functions
        .invoke("send-message", {
          body: {
            message_type:
              type === "reschedule"
                ? "WEBAPP_RESCHEDULE_REQUEST"
                : "THANKS_FOR_AVAILABILITY",
            learner_id: learnerId,
          },
        })
        .catch((err) => console.error("Error sending message:", err));

      const subject =
        type === "lesson10"
          ? "New 10th Lesson Scheduling Request"
          : type === "new"
            ? "New Lesson Scheduling Request"
            : "New Reschedule Request";
      sendAdminEmail(
        subject,
        `${learnerName} has submitted availability for ${type === "lesson10" ? "their 10th lesson" : "lesson scheduling"}.`,
      ).catch((err) => console.error("Error sending admin email:", err));

      // Do not unmount until BOTH preferences and the admin request are saved.
      navigate("/loading", { state: { next: "/home" } });
    } catch (error) {
      console.error("Error saving preferences:", error);
      setSaveError(
        "We couldn't submit your scheduling request. Please try Save again. Your selected timings have been kept.",
      );
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div>Loading preferences...</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <Card className="flex-1 border-none shadow-none">
        <CardContent className="relative h-full px-0 pt-4">
          {type !== "new" ? (
            <>
              You have the following preferences set for scheduling time.
              <br />
              You can modify the slot preferences if required and they will be
              used for scheduling.
            </>
          ) : (
            ""
          )}
          <div className="grid grid-cols-[120px,1fr]">
            {/* Fixed time slots column */}
            <div className="relative z-10 bg-white">
              <div className="h-8" /> {/* Space for day headers */}
              <div className="mt-4 space-y-3">
                {TIME_SLOTS.map((slot) => (
                  <div
                    key={slot}
                    className="flex h-12 items-center justify-end pr-4 text-right font-medium"
                  >
                    {TIME_SLOT_LABELS[slot]}
                  </div>
                ))}
              </div>
            </div>

            {/* Scrollable days */}
            <div className="relative overflow-hidden pr-8">
              <ScrollArea className="h-full w-full">
                <div className="min-w-[700px]">
                  {/* Day headers — fixed height to match the left label column's spacer */}
                  <div className="grid h-8 grid-cols-7 items-center gap-6">
                    {DAYS_OF_WEEK.map((day) => (
                      <div key={day} className="text-sm font-medium">
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Time slot buttons */}
                  <div className="mt-4 space-y-3">
                    {TIME_SLOTS.map((slot) => (
                      <div key={slot} className="grid grid-cols-7 gap-6">
                        {DAYS_OF_WEEK.map((_, index) => {
                          const isSelected =
                            isFlexible || selectedSlots.has(`${index}-${slot}`);
                          return (
                            <Button
                              type="button"
                              key={`${index}-${slot}`}
                              variant={isSelected ? "default" : "outline"}
                              className={`h-12 rounded-lg border-2 ${
                                isSelected
                                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                                  : "border-gray-200 hover:bg-gray-50"
                              }`}
                              onClick={() => handleSlotToggle(index, slot)}
                              disabled={isSaving || isFlexible}
                            >
                              {isSelected ? "✓" : ""}
                            </Button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
              {/* Fade effect */}
              <div className="pointer-events-none absolute right-0 top-0 h-full w-16 bg-gradient-to-l from-white to-transparent" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 mt-4 border-t bg-white p-4">
        {saveError && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {saveError}
          </p>
        )}
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={isPending || isRescheduleRequestPending || isSaving} // Disable during any async operation
          className="w-full"
        >
          {isPending || isRescheduleRequestPending || isSaving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </div>
  );
}

export default PreferenceSelector;
