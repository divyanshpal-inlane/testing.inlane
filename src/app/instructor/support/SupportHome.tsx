import { format } from "date-fns";
import {
  ArrowLeft,
  LifeBuoy,
  Loader2,
  MessageCircle,
  Phone,
  Plus,
  Siren,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  SUPPORT_PHONE_DISPLAY,
  telHref,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABEL,
  TicketCategory,
  whatsappHref,
} from "@/constants/support";
import { useUser } from "@/context/auth-context";
import { useInstructor } from "@/queries/instructor";
import {
  SupportTicket,
  useCreateSupportTicket,
  useMySupportTickets,
} from "@/queries/support";

const STATUS_STYLE: Record<string, string> = {
  open: "border-amber-200 bg-amber-100 text-amber-800",
  in_progress: "border-blue-200 bg-blue-100 text-blue-800",
  resolved: "border-emerald-200 bg-emerald-100 text-emerald-800",
  closed: "border-gray-200 bg-gray-100 text-gray-600",
};
const statusLabel = (s: string) => s.replace("_", " ");

export default function SupportHome() {
  const navigate = useNavigate();
  const { phone } = useUser();
  const { data: instructor } = useInstructor(phone ?? "");
  const instructorId = instructor?.instructorInfo?.id_instructor as
    | string
    | undefined;

  const { data: tickets, isLoading } = useMySupportTickets(instructorId);
  const createTicket = useCreateSupportTicket();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<TicketCategory>("app");
  const [urgent, setUrgent] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");

  const openForm = (preUrgent = false) => {
    setCategory("app");
    setUrgent(preUrgent);
    setSubject("");
    setDescription("");
    setOpen(true);
  };

  const submit = async () => {
    if (!subject.trim()) {
      toast({ title: "Please add a short subject", variant: "destructive" });
      return;
    }
    if (!instructorId) {
      toast({
        title: "Couldn't identify your account",
        variant: "destructive",
      });
      return;
    }
    try {
      await createTicket.mutateAsync({
        instructorId,
        category,
        priority: urgent ? "urgent" : "normal",
        subject: subject.trim(),
        description: description.trim() || null,
      });
      toast({
        title: "Ticket raised",
        description: "Support will get back to you.",
      });
      setOpen(false);
    } catch (e) {
      toast({
        title: "Couldn't raise ticket",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex h-full flex-col bg-gray-50">
      <div className="relative bg-[#00CE84] px-5 pb-6 pt-5 text-white">
        <button
          type="button"
          onClick={() => navigate("/instructor")}
          aria-label="Back to dashboard"
          className="absolute left-4 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/20"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="pl-10 text-xl font-bold">Support</h1>
        <p className="pl-10 text-sm text-white/90">We&apos;re here to help.</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 pb-24">
        {/* Quick contact */}
        <div className="grid grid-cols-2 gap-3">
          <a
            href={telHref()}
            className="flex flex-col items-start gap-1 rounded-lg bg-primary p-4 text-white"
          >
            <Phone className="h-5 w-5" />
            <span className="text-sm font-semibold">Call support</span>
            <span className="text-[11px] opacity-90">
              {SUPPORT_PHONE_DISPLAY}
            </span>
          </a>
          <a
            href={whatsappHref()}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col items-start gap-1 rounded-lg border-2 border-green-500 p-4 text-green-600"
          >
            <MessageCircle className="h-5 w-5" />
            <span className="text-sm font-semibold">WhatsApp</span>
            <span className="text-[11px] opacity-70">
              {SUPPORT_PHONE_DISPLAY}
            </span>
          </a>
        </div>

        {/* Emergency support */}
        <a
          href={telHref()}
          className="flex items-center gap-3 rounded-lg border-2 border-red-300 bg-red-50 p-4 text-red-700"
        >
          <Siren className="h-6 w-6" />
          <div>
            <div className="text-sm font-semibold">Emergency support</div>
            <div className="text-[11px] opacity-80">
              Call us right now for urgent on-road issues
            </div>
          </div>
        </a>

        {/* Raise ticket */}
        <Button className="w-full" onClick={() => openForm(false)}>
          <Plus className="mr-1 h-4 w-4" /> Raise a ticket
        </Button>

        {/* My tickets */}
        <div>
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            My tickets
          </h2>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : !tickets || tickets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-white py-8 text-center text-sm text-gray-500">
              <LifeBuoy className="h-6 w-6 text-gray-300" />
              No tickets yet.
            </div>
          ) : (
            <div className="space-y-2">
              {tickets.map((t: SupportTicket) => (
                <div
                  key={t.id}
                  className="rounded-lg border bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {t.subject}
                        </span>
                        {t.priority === "urgent" && (
                          <Badge
                            variant="outline"
                            className="border-red-200 bg-red-50 text-[10px] text-red-700"
                          >
                            Urgent
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {TICKET_CATEGORY_LABEL[t.category]} ·{" "}
                        {t.created_at
                          ? format(new Date(t.created_at), "d MMM")
                          : ""}
                      </div>
                      {t.admin_response && (
                        <p className="mt-1 text-xs text-gray-600">
                          <span className="font-medium">Support:</span>{" "}
                          {t.admin_response}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${STATUS_STYLE[t.status]}`}
                    >
                      {statusLabel(t.status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Raise ticket dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Raise a ticket</DialogTitle>
            <DialogDescription>
              Tell us what&apos;s going on and we&apos;ll help.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as TicketCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subject</Label>
              <Input
                placeholder="Short summary"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Details (optional)</Label>
              <Textarea
                rows={3}
                placeholder="Describe the issue…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={urgent}
                onChange={(e) => setUrgent(e.target.checked)}
              />
              Mark as urgent
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={createTicket.isPending}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={createTicket.isPending}>
              {createTicket.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Submit ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
