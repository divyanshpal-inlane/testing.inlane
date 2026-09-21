import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  Loader2,
  MapPin,
  Search,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabaseClient";
import { useCurrentUser } from "@/queries/userManagement";
import { maskPhoneNumber } from "@/utils/phoneMasking";

// ─── helpers ────────────────────────────────────────────────────
function fmtTimestamp(ts: string | null): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return format(d, "dd MMM yyyy, hh:mm a");
  } catch {
    return ts;
  }
}

function fmtTime(time: string | null): string {
  if (!time) return "—";
  try {
    const [h, m] = time.split(":");
    const hour = parseInt(h, 10);
    return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
  } catch {
    return time;
  }
}

function getDuration(a: string | null, b: string | null): string {
  if (!a || !b) return "—";
  try {
    const ms = new Date(b).getTime() - new Date(a).getTime();
    if (ms < 0) return "—";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  } catch {
    return "—";
  }
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-green-100 text-green-800",
  ongoing: "bg-blue-100 text-blue-800",
  booked: "bg-yellow-100 text-yellow-800",
  penalty: "bg-red-100 text-red-800",
};

// A lesson is "properly completed" only if it has both started_at AND ended_at
// (meaning both start and end OTP were verified).
// A lesson is a "penalty" if its scheduled time has passed but it's missing
// either the start or end OTP verification.
function isProperlyCompleted(s: {
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
}): boolean {
  return s.status === "completed" && !!s.started_at && !!s.ended_at;
}

function isPenalty(s: {
  date: string;
  end_time: string;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
}): boolean {
  // Check if the lesson time has passed
  const now = new Date();
  const lessonEnd = new Date(`${s.date}T${s.end_time}`);
  const timePassed = lessonEnd < now;

  if (!timePassed) return false;

  // Penalty if: completed without both OTPs, or still booked/ongoing after time passed
  if (s.status === "completed" && (!s.started_at || !s.ended_at)) return true;
  if (s.status === "booked" || s.status === "ongoing") return true;

  return false;
}

// ─── component ──────────────────────────────────────────────────
export default function InstructorLessonLog() {
  const navigate = useNavigate();
  const { data: currentUser } = useCurrentUser();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Check if user has permission to view unmasked phone numbers
  const canViewUnmaskedPhoneNumbers =
    currentUser?.permissions?.includes("view_unmasked_phone_numbers") || false;

  // ── fetch all instructors ──
  const { data: instructors, isLoading } = useQuery({
    queryKey: ["admin-instructor-lesson-log"],
    queryFn: async () => {
      // Also fetch a count of their schedules so we can show it in the list
      const { data, error } = await supabase
        .from("Instructor")
        .select("id_instructor, name, phone, email")
        .order("name");

      if (error) throw error;
      return data ?? [];
    },
  });

  // ── fetch schedules for expanded instructor ──
  const { data: schedules, isLoading: schedulesLoading } = useQuery({
    queryKey: [
      "admin-instructor-schedules",
      expandedId,
      statusFilter,
      dateFilter,
    ],
    queryFn: async () => {
      if (!expandedId) return [];

      let query = supabase
        .from("Schedule")
        .select(
          `id, date, start_time, end_time, started_at, ended_at,
           status, otp, otp_end, isTentative,
           Learner(id, name, phone, pick_up_location, address_lat, address_lng),
           Lesson(id, number, description),
           Courses(name, total_lessons)`,
        )
        .eq("instructor_id", expandedId)
        .order("date", { ascending: false })
        .order("start_time", { ascending: false });

      // "penalty" and "completed" are computed client-side, so only filter
      // DB-native statuses at the query level
      if (
        statusFilter !== "all" &&
        statusFilter !== "penalty" &&
        statusFilter !== "completed"
      ) {
        query = query.eq("status", statusFilter);
      }
      if (dateFilter) {
        query = query.eq("date", dateFilter);
      }

      const { data, error } = await query;
      if (error) {
        console.error("Error fetching schedules:", error);
        throw error;
      }
      return data ?? [];
    },
    enabled: !!expandedId,
  });

  // ── client-side search filter ──
  const filtered = useMemo(() => {
    if (!instructors) return [];
    if (!searchTerm) return instructors;
    const q = searchTerm.toLowerCase();
    return instructors.filter(
      (i: any) =>
        i.name?.toLowerCase().includes(q) ||
        i.phone?.includes(q) ||
        i.email?.toLowerCase().includes(q),
    );
  }, [instructors, searchTerm]);

  // ── stats for expanded instructor ──
  const stats = useMemo(() => {
    if (!schedules) return null;
    const properlyCompleted = schedules.filter((s: any) =>
      isProperlyCompleted(s),
    ).length;
    const penalties = schedules.filter((s: any) => isPenalty(s)).length;
    const ongoing = schedules.filter((s: any) => s.status === "ongoing").length;
    const booked = schedules.filter((s: any) => s.status === "booked").length;
    return {
      total: schedules.length,
      properlyCompleted,
      penalties,
      ongoing,
      booked,
    };
  }, [schedules]);

  // ── client-side filter for penalty/completed ──
  const filteredSchedules = useMemo(() => {
    if (!schedules) return [];
    if (statusFilter === "completed") {
      return schedules.filter((s: any) => isProperlyCompleted(s));
    }
    if (statusFilter === "penalty") {
      return schedules.filter((s: any) => isPenalty(s));
    }
    return schedules;
  }, [schedules, statusFilter]);

  const toggle = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setStatusFilter("all");
    setDateFilter("");
  };

  // ─── render ───────────────────────────────────────────────────
  return (
    <div
      className="container mx-auto min-h-screen bg-white p-4 sm:p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
      }}
    >
      {/* Header */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/admin")}
          className="h-10 w-10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Instructor Lesson Log</h1>
          <p className="text-sm text-muted-foreground">
            View lesson completion details with OTP verification and timing
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search instructor by name, phone, or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {/* Instructor List */}
      {!isLoading && (
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="py-12 text-center text-muted-foreground">
              No instructors found
            </div>
          )}

          {filtered.map((inst) => {
            const isOpen = expandedId === inst.id_instructor;

            return (
              <Card key={inst.id_instructor}>
                {/* Row */}
                <CardHeader
                  className="cursor-pointer p-4 hover:bg-muted/50"
                  onClick={() => toggle(inst.id_instructor)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">
                          {inst.name || "Unnamed"}
                        </CardTitle>
                        <CardDescription>
                          {canViewUnmaskedPhoneNumbers
                            ? inst.phone
                            : maskPhoneNumber(inst.phone)}
                          {inst.email ? ` · ${inst.email}` : ""}
                        </CardDescription>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>

                {/* Expanded detail */}
                {isOpen && (
                  <CardContent className="border-t px-4 pb-4 pt-4">
                    {/* Filters row */}
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                      <Filter className="h-4 w-4 text-muted-foreground" />
                      <Select
                        value={statusFilter}
                        onValueChange={setStatusFilter}
                      >
                        <SelectTrigger className="w-[150px]">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Status</SelectItem>
                          <SelectItem value="completed">
                            Completed (Proper)
                          </SelectItem>
                          <SelectItem value="penalty">Penalty</SelectItem>
                          <SelectItem value="ongoing">Ongoing</SelectItem>
                          <SelectItem value="booked">Booked</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="date"
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="w-[180px]"
                      />
                      {(statusFilter !== "all" || dateFilter) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setStatusFilter("all");
                            setDateFilter("");
                          }}
                        >
                          Clear
                        </Button>
                      )}
                    </div>

                    {/* Stats */}
                    {stats && !schedulesLoading && (
                      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                        <div className="rounded-lg bg-muted/50 p-3 text-center">
                          <p className="text-2xl font-bold">{stats.total}</p>
                          <p className="text-xs text-muted-foreground">Total</p>
                        </div>
                        <div className="rounded-lg bg-green-50 p-3 text-center">
                          <p className="text-2xl font-bold text-green-700">
                            {stats.properlyCompleted}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Completed
                          </p>
                        </div>
                        <div className="rounded-lg bg-red-50 p-3 text-center">
                          <p className="text-2xl font-bold text-red-700">
                            {stats.penalties}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Penalty
                          </p>
                        </div>
                        <div className="rounded-lg bg-blue-50 p-3 text-center">
                          <p className="text-2xl font-bold text-blue-700">
                            {stats.ongoing}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Ongoing
                          </p>
                        </div>
                        <div className="rounded-lg bg-yellow-50 p-3 text-center">
                          <p className="text-2xl font-bold text-yellow-700">
                            {stats.booked}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Booked
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Schedule cards */}
                    {schedulesLoading ? (
                      <div className="flex h-32 items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : filteredSchedules.length === 0 ? (
                      <p className="py-8 text-center text-muted-foreground">
                        No lessons found
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {filteredSchedules.map((s: any) => (
                          <Card key={s.id} className="border shadow-sm">
                            <CardContent className="p-4">
                              <div className="flex flex-col gap-3">
                                {/* Lesson + status */}
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="font-semibold">
                                      Lesson {s.Lesson?.number ?? "—"}
                                      {s.Courses?.name &&
                                        ` · ${s.Courses.name}`}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {s.date
                                        ? format(
                                            new Date(s.date + "T00:00:00"),
                                            "dd MMM yyyy",
                                          )
                                        : "—"}{" "}
                                      · {fmtTime(s.start_time)} –{" "}
                                      {fmtTime(s.end_time)}
                                    </p>
                                  </div>
                                  {isPenalty(s) ? (
                                    <Badge className={STATUS_COLORS.penalty}>
                                      PENALTY
                                    </Badge>
                                  ) : isProperlyCompleted(s) ? (
                                    <Badge className={STATUS_COLORS.completed}>
                                      COMPLETED
                                    </Badge>
                                  ) : (
                                    <Badge
                                      className={
                                        STATUS_COLORS[s.status ?? ""] ??
                                        "bg-gray-100 text-gray-800"
                                      }
                                    >
                                      {s.status?.toUpperCase() ?? "UNKNOWN"}
                                    </Badge>
                                  )}
                                </div>

                                {/* Penalty reason */}
                                {isPenalty(s) && (
                                  <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
                                    <span className="font-medium">
                                      Penalty reason:{" "}
                                    </span>
                                    {!s.started_at && !s.ended_at
                                      ? "No start or end OTP verified"
                                      : !s.started_at
                                        ? "Start OTP not verified"
                                        : !s.ended_at
                                          ? "End OTP not verified"
                                          : `Lesson still ${s.status} after scheduled time`}
                                  </div>
                                )}

                                {/* Tentative tag */}
                                {s.isTentative && (
                                  <Badge variant="outline" className="w-fit">
                                    Tentative
                                  </Badge>
                                )}

                                {/* Learner */}
                                {s.Learner && (
                                  <div className="flex flex-col gap-1 rounded-lg bg-muted/30 p-3 text-sm">
                                    <div className="flex items-center gap-2">
                                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="font-medium">
                                        {s.Learner.name ?? "—"}
                                      </span>
                                      <span className="text-muted-foreground">
                                        {s.Learner.phone}
                                      </span>
                                    </div>
                                    {s.Learner.pick_up_location && (
                                      <div className="flex items-start gap-2">
                                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                        <span className="text-muted-foreground">
                                          {s.Learner.pick_up_location}
                                        </span>
                                        {s.Learner.address_lat &&
                                          s.Learner.address_lng && (
                                            <a
                                              href={`https://www.google.com/maps?q=${s.Learner.address_lat},${s.Learner.address_lng}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="shrink-0 text-xs text-blue-600 underline"
                                            >
                                              View Map
                                            </a>
                                          )}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* OTP boxes */}
                                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                  <div className="rounded-lg border p-3">
                                    <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                                      Start OTP
                                    </p>
                                    <p className="font-mono text-lg font-bold">
                                      {s.otp ?? "—"}
                                    </p>
                                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      Started: {fmtTimestamp(s.started_at)}
                                    </div>
                                  </div>
                                  <div className="rounded-lg border p-3">
                                    <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                                      End OTP
                                    </p>
                                    <p className="font-mono text-lg font-bold">
                                      {s.otp_end ?? "—"}
                                    </p>
                                    <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      Ended: {fmtTimestamp(s.ended_at)}
                                    </div>
                                  </div>
                                </div>

                                {/* Duration */}
                                {s.started_at && s.ended_at && (
                                  <div className="flex items-center gap-2 text-sm">
                                    <Clock className="h-4 w-4 text-green-600" />
                                    <span className="font-medium">
                                      Actual Duration:{" "}
                                      {getDuration(s.started_at, s.ended_at)}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
