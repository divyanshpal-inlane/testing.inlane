import { format } from "date-fns";
import {
  ArrowLeft,
  Car,
  Loader2,
  PhoneCall,
  ShieldAlert,
  Siren,
  UserX,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { SUPPORT_PHONE_DISPLAY, telHref } from "@/constants/support";
import { useUser } from "@/context/auth-context";
import { useInstructor } from "@/queries/instructor";
import {
  INCIDENT_TYPE_LABEL,
  IncidentStatus,
  IncidentType,
  SafetyIncident,
  useMySafetyIncidents,
  useReportSafetyIncident,
} from "@/queries/safety";

const STATUS_STYLE: Record<IncidentStatus, string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200",
  acknowledged: "bg-blue-100 text-blue-800 border-blue-200",
  resolved: "bg-emerald-100 text-emerald-800 border-emerald-200",
  dismissed: "bg-gray-100 text-gray-600 border-gray-200",
};

const REPORT_TYPES: {
  type: Exclude<IncidentType, "sos">;
  icon: typeof Car;
  label: string;
  hint: string;
}[] = [
  {
    type: "accident",
    icon: Car,
    label: "Accident",
    hint: "Collision or injury during a lesson",
  },
  {
    type: "breakdown",
    icon: Wrench,
    label: "Vehicle breakdown",
    hint: "Car trouble on the road",
  },
  {
    type: "misconduct",
    icon: UserX,
    label: "Learner misconduct",
    hint: "Unsafe or abusive behaviour",
  },
];

export default function SafetyHome() {
  const navigate = useNavigate();
  const { phone } = useUser();
  const { data: instructor } = useInstructor(phone ?? "");
  const instructorId = instructor?.instructorInfo?.id_instructor as
    string | undefined;

  const { data: incidents, isLoading } = useMySafetyIncidents(instructorId);
  const report = useReportSafetyIncident();
  const { toast } = useToast();

  const [openType, setOpenType] = useState<Exclude<IncidentType, "sos"> | null>(
    null,
  );
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");

  const openForm = (type: Exclude<IncidentType, "sos">) => {
    setDescription("");
    setLocation("");
    setOpenType(type);
  };

  const submit = async () => {
    if (!instructorId) {
      toast({
        title: "Couldn't identify your instructor account",
        variant: "destructive",
      });
      return;
    }
    if (!description.trim()) {
      toast({ title: "Please describe what happened", variant: "destructive" });
      return;
    }
    try {
      await report.mutateAsync({
        instructorId,
        incidentType: openType!,
        description: description.trim(),
        location: location.trim() || null,
      });
      toast({
        title: "Report submitted",
        description: "Our team has been notified.",
      });
      setOpenType(null);
    } catch (e) {
      toast({
        title: "Couldn't submit report",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  // SOS: log the alert first (fire-and-forget if it fails) and immediately
  // place the call — the phone call must never wait on the network.
  const triggerSos = () => {
    if (instructorId) {
      report.mutate(
        {
          instructorId,
          incidentType: "sos",
          description: "SOS triggered from app",
        },
        {
          onSuccess: () =>
            toast({
              title: "SOS alert sent",
              description: "Admin team notified.",
            }),
        },
      );
    }
    window.location.href = telHref();
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="relative bg-[#00CE84] px-5 pb-6 pt-5 text-white">
        <button
          type="button"
          onClick={() => navigate("/instructor")}
          aria-label="Back to dashboard"
          className="absolute left-4 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="pl-10 text-xl font-bold">Safety</h1>
        <p className="pl-10 text-sm text-white/90">
          Report incidents and reach us instantly in an emergency.
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
        {/* SOS */}
        <button
          type="button"
          onClick={triggerSos}
          className="flex w-full items-center gap-3 rounded-xl bg-red-600 p-4 text-left text-white shadow-md active:bg-red-700"
        >
          <Siren className="h-8 w-8 shrink-0" />
          <span>
            <span className="block text-base font-bold">Emergency SOS</span>
            <span className="block text-xs opacity-90">
              Calls {SUPPORT_PHONE_DISPLAY} and alerts the admin team
              immediately
            </span>
          </span>
          <PhoneCall className="ml-auto h-5 w-5 shrink-0" />
        </button>

        {/* Report actions */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            Report an incident
          </h2>
          <div className="space-y-2">
            {REPORT_TYPES.map(({ type, icon: Icon, label, hint }) => (
              <button
                key={type}
                type="button"
                onClick={() => openForm(type)}
                className="flex w-full items-center gap-3 rounded-lg border bg-white p-3 text-left shadow-sm active:bg-gray-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-gray-500">{hint}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* My reports */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            My reports
          </h2>
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : !incidents || incidents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-white py-10 text-center text-sm text-gray-500">
              <ShieldAlert className="h-6 w-6 text-gray-300" />
              No incidents reported.
            </div>
          ) : (
            <div className="space-y-2">
              {incidents.map((r: SafetyIncident) => (
                <div
                  key={r.id}
                  className="rounded-lg border bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">
                        {INCIDENT_TYPE_LABEL[r.incident_type]}
                        {r.created_at && (
                          <span className="ml-2 text-xs font-normal text-gray-400">
                            {format(new Date(r.created_at), "d MMM, HH:mm")}
                          </span>
                        )}
                      </div>
                      {r.description && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {r.description}
                        </p>
                      )}
                      {r.admin_response && (
                        <p className="mt-1 text-xs text-gray-600">
                          <span className="font-medium">Admin:</span>{" "}
                          {r.admin_response}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${STATUS_STYLE[r.status]}`}
                    >
                      {r.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Report dialog */}
      <Dialog open={!!openType} onOpenChange={(o) => !o && setOpenType(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Report{" "}
              {openType ? INCIDENT_TYPE_LABEL[openType].toLowerCase() : ""}
            </DialogTitle>
            <DialogDescription>
              Our team reviews every report. For anything life-threatening, use
              the SOS button.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">What happened?</Label>
              <Textarea
                rows={3}
                placeholder="Describe the incident…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Location (optional)</Label>
              <Input
                placeholder="e.g. Vijay Nagar square"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpenType(null)}
              disabled={report.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={report.isPending}>
              {report.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Submit report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
