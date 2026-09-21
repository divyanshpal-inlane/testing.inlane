import { format } from "date-fns";
import { ArrowLeft, Loader2, Phone } from "lucide-react";
import { useState } from "react";
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
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABEL,
  TICKET_STATUSES,
  TicketCategory,
  TicketStatus,
} from "@/constants/support";
import { useCurrentAdmin } from "@/queries/adminPermissions";
import {
  SupportTicketWithInstructor,
  useAllSupportTickets,
  useUpdateSupportTicket,
} from "@/queries/support";

const STATUS_STYLE: Record<string, string> = {
  open: "border-amber-200 bg-amber-100 text-amber-800",
  in_progress: "border-blue-200 bg-blue-100 text-blue-800",
  resolved: "border-emerald-200 bg-emerald-100 text-emerald-800",
  closed: "border-gray-200 bg-gray-100 text-gray-600",
};
const statusLabel = (s: string) => s.replace("_", " ");

function RespondDialog({
  ticket,
  onClose,
}: {
  ticket: SupportTicketWithInstructor;
  onClose: () => void;
}) {
  const update = useUpdateSupportTicket();
  const { data: admin } = useCurrentAdmin();
  const { toast } = useToast();
  const [response, setResponse] = useState(ticket.admin_response ?? "");
  const [status, setStatus] = useState<TicketStatus>(ticket.status);

  const save = async () => {
    try {
      await update.mutateAsync({
        id: ticket.id,
        status,
        adminResponse: response.trim(),
        resolverName: admin?.name ?? "Admin",
      });
      toast({ title: "Ticket updated" });
      onClose();
    } catch (e) {
      toast({
        title: "Couldn't update",
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
            {ticket.subject}
            {ticket.priority === "urgent" && (
              <Badge
                variant="outline"
                className="border-red-200 bg-red-50 text-[10px] text-red-700"
              >
                Urgent
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {TICKET_CATEGORY_LABEL[ticket.category]} ·{" "}
            {ticket.instructorName ?? "Instructor"}
            {ticket.instructorPhone ? ` · ${ticket.instructorPhone}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {ticket.description && (
            <p className="rounded bg-gray-50 p-2 text-sm text-gray-700">
              {ticket.description}
            </p>
          )}
          <div className="space-y-1">
            <span className="text-xs font-medium">Status</span>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as TicketStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TICKET_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium">Response to instructor</span>
            <Textarea
              rows={3}
              placeholder="Write a response…"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={update.isPending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={update.isPending}>
              {update.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SupportTickets() {
  const [status, setStatus] = useState<TicketStatus | "all">("all");
  const [category, setCategory] = useState<TicketCategory | "all">("all");
  const { data, isLoading } = useAllSupportTickets({
    status: status === "all" ? undefined : status,
    category: category === "all" ? undefined : category,
  });
  const [selected, setSelected] = useState<SupportTicketWithInstructor | null>(
    null,
  );

  // urgent + open first
  const rows = (data ?? []).slice().sort((a, b) => {
    if ((a.status === "open") !== (b.status === "open"))
      return a.status === "open" ? -1 : 1;
    if ((a.priority === "urgent") !== (b.priority === "urgent"))
      return a.priority === "urgent" ? -1 : 1;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  const openCount = (data ?? []).filter((t) => t.status === "open").length;

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
              Support Tickets
            </h1>
            <p className="text-sm text-muted-foreground">
              Respond to instructor support requests.{" "}
              {openCount > 0 && (
                <span className="font-medium text-amber-600">
                  {openCount} open
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as TicketStatus | "all")}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {TICKET_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as TicketCategory | "all")}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {TICKET_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
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
              No tickets match these filters.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {rows.map((t) => (
              <Card
                key={t.id}
                className="cursor-pointer transition-colors hover:bg-muted/30"
                onClick={() => setSelected(t)}
              >
                <CardContent className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">
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
                      <Badge
                        variant="outline"
                        className={`text-[10px] capitalize ${STATUS_STYLE[t.status]}`}
                      >
                        {statusLabel(t.status)}
                      </Badge>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {TICKET_CATEGORY_LABEL[t.category]} ·{" "}
                      {t.instructorName ?? "Instructor"}
                      {t.created_at
                        ? ` · ${format(new Date(t.created_at), "d MMM")}`
                        : ""}
                    </div>
                    {t.instructorPhone && (
                      <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Phone className="h-3 w-3" /> {t.instructorPhone}
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="outline">
                    Respond
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <RespondDialog
          ticket={(data ?? []).find((t) => t.id === selected.id) ?? selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
