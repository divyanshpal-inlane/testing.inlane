import { format, subDays } from "date-fns";
import { ArrowLeft, Loader2, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInstructorPerformance } from "@/queries/instructorPerformance";

// Green ≥90, amber ≥75, red below — shared scale for the rate columns.
const rateClass = (v: number | null) => {
  if (v == null) return "text-muted-foreground";
  if (v >= 90) return "text-emerald-600 font-medium";
  if (v >= 75) return "text-amber-600 font-medium";
  return "text-red-600 font-medium";
};

const ratingClass = (v: number | null) => {
  if (v == null) return "text-muted-foreground";
  if (v >= 4.5) return "text-emerald-600 font-medium";
  if (v >= 3.5) return "text-amber-600 font-medium";
  return "text-red-600 font-medium";
};

const fmtRate = (v: number | null) => (v == null ? "—" : `${v}%`);

export default function InstructorPerformance() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(
    format(subDays(new Date(), 30), "yyyy-MM-dd"),
  );
  const [toDate, setToDate] = useState(today);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useInstructorPerformance(fromDate, toDate);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let all = data ?? [];
    if (q)
      all = all.filter(
        (r) =>
          (r.name ?? "").toLowerCase().includes(q) ||
          (r.phone ?? "").includes(q),
      );
    return all;
  }, [data, search]);

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Instructor Performance
            </h1>
            <p className="text-sm text-muted-foreground">
              Attendance, punctuality, ratings, complaints and completion — per
              instructor.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              max={toDate}
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              min={fromDate}
              max={today}
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div className="relative flex-1 basis-56">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No instructors found.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Instructor</th>
                    <th className="p-3 text-right font-medium">Sessions</th>
                    <th className="p-3 text-right font-medium">Attendance</th>
                    <th className="p-3 text-right font-medium">Punctuality</th>
                    <th className="p-3 text-right font-medium">Rating</th>
                    <th className="p-3 text-right font-medium">Complaints</th>
                    <th className="p-3 text-right font-medium">Completion</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.instructorId}
                      className="border-b last:border-0 hover:bg-muted/20"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {r.name ?? "Instructor"}
                          </span>
                          {r.enabled === false && (
                            <Badge
                              variant="outline"
                              className="bg-gray-100 text-[10px] text-gray-500"
                            >
                              inactive
                            </Badge>
                          )}
                        </div>
                        {r.phone && (
                          <div className="text-xs text-muted-foreground">
                            {r.phone}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {r.sessions}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${rateClass(r.attendanceRate)}`}
                      >
                        {fmtRate(r.attendanceRate)}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${rateClass(r.punctualityRate)}`}
                      >
                        {fmtRate(r.punctualityRate)}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${ratingClass(r.avgRating)}`}
                      >
                        {r.avgRating == null ? (
                          "—"
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3 fill-current" />
                            {r.avgRating}
                            <span className="text-xs font-normal text-muted-foreground">
                              ({r.ratingCount})
                            </span>
                          </span>
                        )}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${
                          r.complaints > 0 ? "font-medium text-red-600" : ""
                        }`}
                      >
                        {r.complaints}
                        {r.complaintRate != null && r.complaints > 0 && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            ({r.complaintRate}%)
                          </span>
                        )}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums ${rateClass(r.completionRate)}`}
                      >
                        {fmtRate(r.completionRate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Attendance = sessions that actually started (OTP) out of past booked
          sessions. Punctuality = started within 10 min of the slot. Ratings
          come from learner course feedback attributed to the learner's main
          instructor. Complaints = confirmed instructor no-show cases.
        </p>
      </div>
    </div>
  );
}
