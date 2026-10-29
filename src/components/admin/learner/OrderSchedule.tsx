import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";

import {
  localDateOf,
  type OrderSlot,
  slotStatus,
  type SlotTone,
} from "@/lib/sales-dashboard/orderSlots";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<SlotTone, string> = {
  tentative: "bg-amber-100 text-amber-800",
  booked: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  paused: "bg-slate-200 text-slate-700",
  other: "bg-muted text-muted-foreground",
};

/** 1050 -> "5:30 PM". */
function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "2026-10-26" -> "Mon, 26 Oct" (the calendar date as written, in local time). */
function dayLabel(isoDate: string): string {
  const d = localDateOf(isoDate);
  if (!d) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(d);
}

/**
 * A dropdown with one course's schedule only: every class booked against that
 * order, in date order, with the time, instructor, class number and whether it
 * is tentative, booked, completed or paused. Earlier dates are dimmed and
 * today is marked. Closed by default; the header says how many classes it has.
 */
export function OrderSchedule({
  slots,
  instructorNames,
  today,
}: {
  slots: readonly OrderSlot[];
  /** instructor id -> name; a missing name just leaves the instructor out. */
  instructorNames: ReadonlyMap<string, string> | undefined;
  /** Local YYYY-MM-DD. */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 border-t pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded py-1 text-left font-medium hover:bg-muted/50"
      >
        <span className="flex items-center gap-1.5">
          <CalendarDays size={13} />
          Schedule · {slots.length} class{slots.length === 1 ? "" : "es"}
        </span>
        <ChevronDown
          size={14}
          className={cn("transition-transform", open && "rotate-180")}
        />
      </button>
      {open &&
        (slots.length === 0 ? (
          <p className="py-1 text-muted-foreground">
            No classes are booked for this course yet.
          </p>
        ) : (
          <ul
            className="mt-1 max-h-64 space-y-1 overflow-y-auto pr-0.5"
            aria-label="Classes for this course"
          >
            {slots.map((s) => {
              const st = slotStatus(s);
              const past = s.date < today;
              const instructor = instructorNames?.get(s.instructorId);
              return (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md border px-2 py-1.5",
                    past && "opacity-60",
                    s.date === today && "border-primary/40 bg-primary/5",
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-medium">
                      {dayLabel(s.date)}
                      {s.date === today && (
                        <span className="ml-1 text-[10px] font-semibold uppercase text-primary">
                          today
                        </span>
                      )}{" "}
                      · {clock(s.startMinute)} – {clock(s.endMinute)}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {[
                        s.lessonNumber ? `Class ${s.lessonNumber}` : null,
                        instructor ?? null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Instructor not shown"}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      TONE_CLASS[st.tone],
                    )}
                  >
                    {st.label}
                  </span>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
