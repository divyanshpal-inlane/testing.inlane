import { format } from "date-fns";
import { ArrowLeft, Car, Download, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CAR_LEADS_PAGE_SIZE,
  CarLeadPlanningFilter,
  carLeadsToCSV,
  fetchCarLeadsPage,
  useCarLeadAreas,
  useCarLeads,
} from "@/queries/carLeads";
import { downloadCSV } from "@/queries/lessonsDashboard";

export default function CarCommerceLeads() {
  const [search, setSearch] = useState("");
  const [area, setArea] = useState("all");
  const [planning, setPlanning] = useState<CarLeadPlanningFilter>("all");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const { data, isLoading, isFetching, error, refetch } = useCarLeads({
    page,
    search,
    area,
    planning,
  });
  const { data: areas = [], refetch: refetchAreas } = useCarLeadAreas();
  const rows = data?.leads ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / CAR_LEADS_PAGE_SIZE));

  useEffect(() => {
    if (data && !isFetching && !error && page > totalPages) setPage(totalPages);
  }, [data, error, isFetching, page, totalPages]);

  const handleExport = async () => {
    if (rows.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      // Preserve export of all filtered results, requesting only ten leads
      // at a time and retaining CSV text rather than the entire lead dataset.
      const csvParts: string[] = [];
      for (let exportPage = 1; ; exportPage++) {
        const result = await fetchCarLeadsPage({
          page: exportPage,
          search,
          area,
          planning,
        });
        if (exportPage > 1 && result.leads.length === 0) break;
        const csv = carLeadsToCSV(result.leads);
        csvParts.push(
          exportPage === 1 ? csv : csv.slice(csv.indexOf("\n") + 1),
        );
        if (exportPage * CAR_LEADS_PAGE_SIZE >= result.totalCount) break;
      }
      downloadCSV(
        `car_leads_${format(new Date(), "yyyy-MM-dd")}.csv`,
        csvParts.join("\n"),
      );
    } catch {
      toast.error("Failed to export car-commerce leads. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  const fmtDate = (d: string | null) =>
    d ? format(new Date(d), "d MMM yy") : "—";

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/admin">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <Car className="h-5 w-5 text-rose-500" />
                Car Commerce Leads
              </h1>
              <p className="text-sm text-muted-foreground">
                Learners who signalled intent to buy a car (onboarding or
                instructor feedback).
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={isFetching || isExporting || rows.length === 0}
          >
            <Download className="mr-1 h-4 w-4" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="relative w-full max-w-xs">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search name or phone"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="pl-8"
              />
            </div>
            <Select
              value={area}
              onValueChange={(value) => {
                setArea(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Area" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All areas</SelectItem>
                {areas.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={planning}
              onValueChange={(value) => {
                setPlanning(value as CarLeadPlanningFilter);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All leads</SelectItem>
                <SelectItem value="yes">Instructor: planning to buy</SelectItem>
                <SelectItem value="onboarding">Onboarding intent</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refetch();
                void refetchAreas();
              }}
              disabled={isFetching}
              className="ml-auto"
            >
              {isFetching ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              Refresh
            </Button>
            <span className="text-sm text-muted-foreground">
              {totalCount} lead{totalCount === 1 ? "" : "s"}
            </span>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div
                className="p-6 text-center text-sm text-destructive"
                role="alert"
              >
                Failed to load car-commerce leads. Please try refreshing.
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No car-commerce leads match the current filters.
              </div>
            ) : (
              <ScrollArea>
                <table className="w-full min-w-[1450px] text-sm">
                  <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                    <tr className="[&>th]:p-2 [&>th]:text-left">
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Area</th>
                      <th>Pickup</th>
                      <th>Motivation</th>
                      <th>Timeline</th>
                      <th>Planning</th>
                      <th>Car type</th>
                      <th>Condition</th>
                      <th>Buy timeframe</th>
                      <th>Updated</th>
                      <th>Onboarded</th>
                      <th>1st Class</th>
                      <th>50% Class</th>
                      <th>Last Class</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b hover:bg-muted/30 [&>td]:p-2"
                      >
                        <td className="font-medium">{r.name ?? "—"}</td>
                        <td className="tabular-nums">{r.phone ?? "—"}</td>
                        <td>{r.area ?? "—"}</td>
                        <td className="max-w-[180px] truncate">
                          {r.pickupLocation ?? "—"}
                        </td>
                        <td className="max-w-[160px] truncate">
                          {r.drivingMotivation ?? "—"}
                        </td>
                        <td>{r.carPurchaseTimeline || "—"}</td>
                        <td>
                          {r.carIntentPlanning === "Yes" ? (
                            <Badge
                              variant="outline"
                              className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                            >
                              Yes
                            </Badge>
                          ) : (
                            (r.carIntentPlanning ?? "—")
                          )}
                        </td>
                        <td>{r.carIntentType ?? "—"}</td>
                        <td>{r.carIntentCondition ?? "—"}</td>
                        <td>{r.carIntentTimeframe ?? "—"}</td>
                        <td className="whitespace-nowrap text-xs text-muted-foreground">
                          {r.carIntentUpdatedAt
                            ? format(
                                new Date(r.carIntentUpdatedAt),
                                "d MMM yy, h:mm a",
                              )
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap text-xs text-muted-foreground">
                          {r.carOnboardingIntentAt
                            ? format(
                                new Date(r.carOnboardingIntentAt),
                                "d MMM yy, h:mm a",
                              )
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {fmtDate(r.firstClassDate)}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {fmtDate(r.midClassDate)}
                        </td>
                        <td className="whitespace-nowrap text-xs">
                          {fmtDate(r.lastClassDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            )}
            <div className="flex items-center justify-end gap-3 border-t p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => current - 1)}
                disabled={page <= 1 || isFetching || !!error}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((current) => current + 1)}
                disabled={page >= totalPages || isFetching || !!error}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
