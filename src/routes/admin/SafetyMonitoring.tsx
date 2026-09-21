import { format } from "date-fns";
import {
  ArrowLeft,
  Car,
  Loader2,
  MapPin,
  Phone,
  Siren,
  UserX,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import {
  INCIDENT_TYPE_LABEL,
  IncidentStatus,
  IncidentType,
  SafetyIncidentWithInstructor,
  useAllSafetyIncidents,
  useUpdateSafetyIncident,
} from "@/queries/safety";

const STATUS_STYLE: Record<IncidentStatus, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200",
  acknowledged: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  dismissed: "bg-gray-100 text-gray-600 border-gray-200",
};

const TYPE_ICON: Record<IncidentType, typeof Car> = {
  accident: Car,
  breakdown: Wrench,
  misconduct: UserX,
  sos: Siren,
};

// SOS first, then open before closed, then newest.
const sortIncidents = (rows: SafetyIncidentWithInstructor[]) =>
  [...rows].sort((a, b) => {
    const aOpen = a.status === "open" || a.status === "acknowledged";
    const bOpen = b.status === "open" || b.status === "acknowledged";
    if (
      (a.incident_type === "sos" && aOpen) !==
      (b.incident_type === "sos" && bOpen)
    )
      return a.incident_type === "sos" && aOpen ? -1 : 1;
    if (aOpen !== bOpen) return aOpen ? -1 : 1;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

function ReviewDialog({
  incident,
  onClose,
}: {
  incident: SafetyIncidentWithInstructor;
  onClose: () => void;
}) {
  const { data: admin } = useCurrentAdmin();
  const update = useUpdateSafetyIncident();
  const { toast } = useToast();
  const [response, setResponse] = useState(incident.admin_response ?? "");

  const act = async (status: IncidentStatus) => {
    try {
      await update.mutateAsync({
        id: incident.id,
        status,
        adminResponse: response.trim() || undefined,
        resolverName: admin?.name ?? "Admin",
      });
      toast({ title: `Marked as ${status}` });
      onClose();
    } catch (e) {
      toast({
        title: "Action failed",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {INCIDENT_TYPE_LABEL[incident.incident_type]}
            <Badge
              variant="outline"
              className={`capitalize ${STATUS_STYLE[incident.status]}`}
            >
              {incident.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {incident.instructorName ?? "Instructor"}
            {incident.instructorPhone ? ` · ${incident.instructorPhone}` : ""}
            {incident.created_at
              ? ` · ${format(new Date(incident.created_at), "EEE d MMM, HH:mm")}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {incident.description && (
            <p className="rounded bg-gray-50 p-2 text-sm text-gray-700">
              {incident.description}
            </p>
          )}
          {incident.location && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" /> {incident.location}
            </p>
          )}

          {incident.status === "open" || incident.status === "acknowledged" ? (
            <div className="space-y-2">
              <Textarea
                rows={2}
                placeholder="Response / resolution note (optional)…"
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
              <div className="flex gap-2">
                {incident.status === "open" && (
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={update.isPending}
                    onClick={() => act("acknowledged")}
                  >
                    Acknowledge
                  </Button>
                )}
                <Button
                  className="flex-1"
                  disabled={update.isPending}
                  onClick={() => act("resolved")}
                >
                  {update.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Resolve
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-gray-500"
                  disabled={update.isPending}
                  onClick={() => act("dismissed")}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ) : (
            incident.admin_response && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">Response:</span>{" "}
                {incident.admin_response}
                {incident.resolved_by ? ` — ${incident.resolved_by}` : ""}
              </p>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SafetyMonitoring() {
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "all">(
    "all",
  );
  const [typeFilter, setTypeFilter] = useState<IncidentType | "all">("all");
  const { data, isLoading } = useAllSafetyIncidents();
  const [selected, setSelected] = useState<SafetyIncidentWithInstructor | null>(
    null,
  );

  const rows = useMemo(() => {
    let all = sortIncidents(data ?? []);
    if (statusFilter !== "all")
      all = all.filter((r) => r.status === statusFilter);
    if (typeFilter !== "all")
      all = all.filter((r) => r.incident_type === typeFilter);
    return all;
  }, [data, statusFilter, typeFilter]);

  const activeSos = (data ?? []).filter(
    (r) =>
      r.incident_type === "sos" &&
      (r.status === "open" || r.status === "acknowledged"),
  );

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Safety Monitoring
            </h1>
            <p className="text-sm text-muted-foreground">
              Accidents, breakdowns, misconduct reports and SOS alerts.
            </p>
          </div>
        </div>

        {activeSos.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">
            <Siren className="h-4 w-4 shrink-0 animate-pulse" />
            {activeSos.length} active SOS alert{activeSos.length > 1 ? "s" : ""}{" "}
            — respond immediately.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as IncidentType | "all")}
          >
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="sos">Emergency SOS</SelectItem>
              <SelectItem value="accident">Accident</SelectItem>
              <SelectItem value="breakdown">Vehicle breakdown</SelectItem>
              <SelectItem value="misconduct">Learner misconduct</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as IncidentStatus | "all")}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No safety incidents.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => {
              const Icon = TYPE_ICON[r.incident_type];
              const isSosActive =
                r.incident_type === "sos" &&
                (r.status === "open" || r.status === "acknowledged");
              return (
                <Card
                  key={r.id}
                  className={`transition-colors hover:bg-muted/30 ${
                    isSosActive ? "border-red-300 bg-red-50/50" : ""
                  }`}
                >
                  <CardContent className="flex items-center justify-between gap-3 p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                          isSosActive
                            ? "bg-red-100 text-red-600"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {r.instructorName ?? "Instructor"}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${STATUS_STYLE[r.status]}`}
                          >
                            {r.status}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {INCIDENT_TYPE_LABEL[r.incident_type]}
                          {r.created_at
                            ? ` · ${format(new Date(r.created_at), "d MMM, HH:mm")}`
                            : ""}
                        </div>
                        {r.instructorPhone && (
                          <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Phone className="h-3 w-3" /> {r.instructorPhone}
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={
                        isSosActive || r.status === "open"
                          ? "default"
                          : "outline"
                      }
                      onClick={() => setSelected(r)}
                    >
                      {r.status === "open" || r.status === "acknowledged"
                        ? "Respond"
                        : "View"}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <ReviewDialog
          incident={(data ?? []).find((r) => r.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
