import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Send,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import {
  MAX_DESCRIPTION_LENGTH,
  validateDescription,
  validatePhone,
} from "@/lib/sales-issue-tickets/validation";
import {
  type SalesIssueTicket,
  useCreateSalesIssueTicket,
  useRetryTicketNotification,
} from "@/queries/salesIssueTickets";

export default function ReportSalesIssue() {
  const { toast } = useToast();
  const create = useCreateSalesIssueTicket();
  const retry = useRetryTicketNotification();

  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [descError, setDescError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<SalesIssueTicket | null>(null);

  // One id per distinct submission: a double click or a network retry of the
  // SAME content reuses it (the server then returns the existing ticket); a
  // changed form gets a fresh one.
  const requestId = useRef(crypto.randomUUID());
  const newRequestId = () => {
    requestId.current = crypto.randomUUID();
  };

  const busy = create.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const pErr = validatePhone(phone);
    const dErr = validateDescription(description);
    setPhoneError(pErr);
    setDescError(dErr);
    setFormError(null);
    if (pErr || dErr) return;

    try {
      const res = await create.mutateAsync({
        phone,
        description,
        requestId: requestId.current,
      });
      setTicket(res.ticket);
      toast({
        title: "Ticket created",
        description: `Ticket ${res.ticket.ticket_number} was saved.`,
      });
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not submit the ticket.",
      );
    }
  };

  const retryEmail = async () => {
    if (!ticket || retry.isPending) return;
    try {
      const res = await retry.mutateAsync(ticket.id);
      setTicket(res.ticket);
      toast(
        res.ticket.notification_status === "sent"
          ? { title: "Support has been notified" }
          : {
              title: "E-mail still failing",
              description: "The ticket is saved. Please try again later.",
              variant: "destructive",
            },
      );
    } catch (err) {
      toast({
        title: "Retry failed",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    }
  };

  const reset = () => {
    setTicket(null);
    setPhone("");
    setDescription("");
    setPhoneError(null);
    setDescError(null);
    setFormError(null);
    newRequestId();
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-xl space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/admin" aria-label="Back to dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Escalate an Issue
            </h1>
            <p className="text-sm text-muted-foreground">
              Support is e-mailed as soon as you submit.
            </p>
          </div>
        </div>

        {ticket ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" /> Issue escalated
              </CardTitle>
              <CardDescription>
                Your ticket ID is{" "}
                <span
                  className="font-mono font-semibold text-foreground"
                  data-testid="ticket-number"
                >
                  {ticket.ticket_number}
                </span>
                . Keep it for follow-ups.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticket.notification_status === "sent" ? (
                <p className="text-sm text-muted-foreground">
                  The Support team has been notified.
                </p>
              ) : (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>
                    {ticket.notification_status === "pending"
                      ? "Notification in progress"
                      : "Support wasn't e-mailed"}
                  </AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>
                      Your ticket is saved, but the e-mail to Support
                      {ticket.notification_status === "pending"
                        ? " hasn't gone out yet."
                        : " failed."}{" "}
                      You can retry without creating a duplicate ticket.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={retryEmail}
                      disabled={retry.isPending}
                    >
                      {retry.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Retry notification
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <Button onClick={reset} className="w-full">
                Escalate another issue
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-5">
              <form onSubmit={submit} noValidate className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="issue-phone">
                    Phone number <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="issue-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    placeholder="e.g. 9876543210"
                    value={phone}
                    disabled={busy}
                    aria-invalid={!!phoneError}
                    aria-describedby={
                      phoneError ? "issue-phone-err" : undefined
                    }
                    onChange={(e) => {
                      setPhone(e.target.value);
                      if (phoneError) setPhoneError(null);
                      newRequestId();
                    }}
                  />
                  {phoneError && (
                    <p
                      id="issue-phone-err"
                      role="alert"
                      className="text-sm text-red-600"
                    >
                      {phoneError}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="issue-desc">
                    Issue description{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="issue-desc"
                    rows={5}
                    placeholder="What went wrong?"
                    value={description}
                    disabled={busy}
                    aria-invalid={!!descError}
                    aria-describedby={descError ? "issue-desc-err" : undefined}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      if (descError) setDescError(null);
                      newRequestId();
                    }}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span
                      id="issue-desc-err"
                      role="alert"
                      className="text-red-600"
                    >
                      {descError}
                    </span>
                    <span>
                      {description.length}/{MAX_DESCRIPTION_LENGTH}
                    </span>
                  </div>
                </div>

                {formError && (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                )}

                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Submit issue
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
