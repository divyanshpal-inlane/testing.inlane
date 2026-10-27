import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banknote,
  CalendarPlus,
  Copy,
  Pencil,
  ReceiptText,
  RefreshCcw,
  Send,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  type OrderSlot,
  summarizeBooked,
} from "@/lib/sales-dashboard/orderSlots";
import {
  type BookingIntent,
  paymentStatusOf,
} from "@/lib/sales-dashboard/serviceBooking";

import {
  buildEnrollmentLink,
  copyServiceLink,
  listLearnerServices,
  sendServiceLink,
  serviceLabel,
  type ServiceLearner,
} from "./additionalServices";
import type { EnrollmentRecord } from "./enrollmentActions";
import {
  linksKey,
  PaymentItem,
  paymentsKey,
  useLearnerLinks,
  useLearnerPayments,
} from "./LearnerPaymentsPanel";
import { ManualPaymentDialog } from "./ManualPaymentDialog";
import { OrderSchedule } from "./OrderSchedule";
import { CopyableId, timeAgo } from "./paymentTrace";
import { useInstructorNames, useOrderSlots } from "./useOrderSlots";

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(iso))
    : "";

/** 1050 -> "5:30 PM". */
function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function chip(status: string | null | undefined) {
  if (status === "full_paid")
    return { text: "Paid", cls: "bg-green-100 text-green-800" };
  if (status === "half_paid")
    return { text: "Half paid", cls: "bg-amber-100 text-amber-800" };
  return { text: "Unpaid", cls: "bg-red-50 text-red-700" };
}

/** Money still to pay on an order, or 0 when it is fully paid. */
function dueOf(e: EnrollmentRecord): number {
  if (e.payment_status === "full_paid") return 0;
  return buildEnrollmentLink(e, "")?.amount ?? 0;
}

/**
 * "Send payment link" / "Copy link" for ONE order that still has money due. The
 * link names this order (`&enrollment=<id>`), so with several courses each
 * button collects for its own course and the payment is recorded against it
 * (the payment trigger links it to the enrollment, and the order flips to Half
 * paid / Paid when the gateway confirms). Nothing is typed or recorded by hand.
 */
function OrderPayLink({
  learner,
  order,
}: {
  learner: ServiceLearner;
  order: EnrollmentRecord;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"send" | "copy" | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const phone = (learner.phone ?? "").replace(/\D/g, "").slice(-10);
  const link = phone ? buildEnrollmentLink(order, phone) : null;
  if (!link || link.amount <= 0) return null;
  const label = serviceLabel(order);
  const kind =
    order.progress?.type === "topup"
      ? "topup"
      : order.case_type === "rto_only"
        ? "other"
        : "course";
  const second = order.payment_status === "half_paid";
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: linksKey(learner.id) });
    void queryClient.invalidateQueries({ queryKey: paymentsKey(learner.id) });
    void queryClient.invalidateQueries({
      queryKey: ["learner-services", learner.id],
    });
  };
  const send = async () => {
    setBusy("send");
    try {
      await sendServiceLink({
        learner: {
          id: learner.id,
          name: learner.name,
          phone: learner.phone,
          email: learner.email,
        },
        enrollmentId: order.id,
        serviceType: kind,
        serviceLabel: label,
        amount: link.amount,
        duration: link.hours,
        url: link.url,
        toast,
      });
    } catch (err) {
      toast({
        title: "Could not send the link",
        description: (err as { message?: string } | null)?.message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const copy = async () => {
    setBusy("copy");
    try {
      await copyServiceLink({
        learner: {
          id: learner.id,
          name: learner.name,
          phone: learner.phone,
          email: learner.email,
        },
        enrollmentId: order.id,
        serviceType: kind,
        serviceLabel: label,
        amount: link.amount,
        url: link.url,
      });
      toast({ title: "Link copied", description: label });
    } catch {
      toast({ title: "Could not copy the link", variant: "destructive" });
    } finally {
      setBusy(null);
      refresh();
    }
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <Button
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={busy !== null}
        onClick={() => void send()}
        data-testid={`order-send-link-${order.id}`}
      >
        {busy === "send" ? (
          <RefreshCcw size={12} className="mr-1 animate-spin" />
        ) : (
          <Send size={12} className="mr-1" />
        )}
        Send payment link · {rupees(link.amount)}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy !== null}
        onClick={() => void copy()}
        title="Copy the link to share it yourself"
      >
        <Copy size={12} className="mr-1" />
        Copy
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy !== null}
        onClick={() => setManualOpen(true)}
        title="The customer paid cash / UPI / bank transfer outside the link"
        data-testid={`order-manual-payment-${order.id}`}
      >
        <Banknote size={12} className="mr-1" />
        Record manual payment
      </Button>
      <span className="text-[10px] text-muted-foreground">
        {second ? "2nd instalment due" : "Due"}
      </span>
      <ManualPaymentDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        learnerId={learner.id}
        enrollmentId={order.id}
        orderLabel={label}
        amountDue={link.amount}
        onRecorded={refresh}
      />
    </div>
  );
}

/**
 * Order and payment history of one learner, for the Sales team's reference:
 * a summary, every order (course / top-up / licence service) newest first with
 * a class action, every payment with its Payment ID and the payment links that
 * were sent.
 *
 * Class action per order: an order with classes booked shows how many, and an
 * "Edit slots" button for the editable (tentative) ones; it does NOT offer "Book
 * classes" (adding more is done inside Edit slots). An order with no classes
 * booked shows "Book classes".
 */
export function LearnerHistory({
  learner,
  onBookClasses,
  onEditSlots,
}: {
  learner: ServiceLearner;
  /** When given, an order with no classes booked gets "Book classes". */
  onBookClasses?: (intent: BookingIntent) => void;
  /** When given, an order with editable booked classes gets "Edit slots". */
  onEditSlots?: (slots: OrderSlot[]) => void;
}) {
  const services = useQuery({
    queryKey: ["learner-services", learner.id],
    staleTime: 0,
    queryFn: () => listLearnerServices(learner.id),
  });
  const payments = useLearnerPayments(learner.id);
  const links = useLearnerLinks(learner.id);
  const orderSlots = useOrderSlots(
    learner.id,
    learner.phone,
    (services.data ?? []).map((e) => ({
      id: e.id,
      courseId: e.course_id ?? null,
    })),
  );
  // Names of the instructors teaching these classes (for each course's schedule).
  const allSlotInstructorIds = [...(orderSlots.data?.values() ?? [])].flatMap(
    (list) => list.map((s) => s.instructorId),
  );
  const instructorNames = useInstructorNames(allSlotInstructorIds);
  // Local calendar date (not UTC), to tell "next" from "earlier dates".
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const orders = services.data ?? [];
  const pays = payments.data ?? [];
  const linkList = links.data ?? [];

  const completed = pays.filter((p) => p.status === "completed");
  const paidTotal = completed.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const orderTotal = orders.reduce((s, e) => s + Number(e.amount ?? 0), 0);

  if (services.isLoading || payments.isLoading) {
    return <p className="text-xs text-muted-foreground">Loading history…</p>;
  }
  if (services.isError || payments.isError) {
    return (
      <p className="text-xs text-red-600">Couldn&apos;t load the history.</p>
    );
  }

  return (
    <div className="space-y-3 text-xs">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border bg-muted/40 p-2 text-center">
          <div className="text-base font-semibold">{orders.length}</div>
          <div className="text-[10px] text-muted-foreground">Orders</div>
        </div>
        <div className="rounded-md border bg-muted/40 p-2 text-center">
          <div className="text-base font-semibold">{rupees(paidTotal)}</div>
          <div className="text-[10px] text-muted-foreground">Paid</div>
        </div>
        <div className="rounded-md border bg-muted/40 p-2 text-center">
          <div className="text-base font-semibold">
            {rupees(Math.max(0, orderTotal - paidTotal))}
          </div>
          <div className="text-[10px] text-muted-foreground">Outstanding</div>
        </div>
      </div>

      {/* Orders */}
      <section>
        <h4 className="mb-1.5 flex items-center gap-1 font-semibold">
          <ReceiptText size={13} /> Orders
        </h4>
        {orders.length === 0 ? (
          <p className="text-muted-foreground">No orders yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {orders.map((e) => {
              const c = chip(e.payment_status);
              const bookable = e.case_type !== "rto_only";
              const hours = e.progress?.total_hours ?? e.Courses?.duration;
              return (
                <li key={e.id} className="rounded-md border p-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {serviceLabel(e)}
                      </div>
                      <div className="text-muted-foreground">
                        {fmtDate((e as { created_at?: string }).created_at)}
                        {e.amount ? ` · ${rupees(e.amount)}` : ""}
                        {hours ? ` · ${hours} classes` : ""}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${c.cls}`}
                    >
                      {c.text}
                    </span>
                  </div>
                  {dueOf(e as unknown as EnrollmentRecord) > 0 && (
                    <OrderPayLink
                      learner={learner}
                      order={e as unknown as EnrollmentRecord}
                    />
                  )}
                  {bookable &&
                    orderSlots.isSuccess &&
                    (() => {
                      const booked = summarizeBooked(
                        orderSlots.data.get(e.id) ?? [],
                        today,
                      );
                      if (booked.total === 0) {
                        return (
                          onBookClasses && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-1.5 h-7 px-2 text-xs"
                              onClick={() =>
                                onBookClasses({
                                  learnerId: learner.id,
                                  name: learner.name ?? "",
                                  phone: learner.phone ?? "",
                                  email: learner.email ?? undefined,
                                  enrollmentId: e.id,
                                  serviceLabel: serviceLabel(e),
                                  classes: hours ?? null,
                                  paymentStatus: paymentStatusOf(
                                    e.payment_status,
                                  ),
                                })
                              }
                            >
                              <CalendarPlus size={12} className="mr-1" />
                              Book classes
                            </Button>
                          )
                        );
                      }
                      return (
                        <>
                          <p className="mt-1.5 text-muted-foreground">
                            {booked.total} class
                            {booked.total === 1 ? "" : "es"} booked
                            {hours ? ` of ${hours}` : ""}
                            {booked.next
                              ? ` · next ${fmtDate(booked.next.date)} ${fmtClock(booked.next.startMinute)}`
                              : " (earlier dates)"}
                            {booked.confirmed === booked.total
                              ? " · confirmed"
                              : ""}
                          </p>
                          {booked.tentative.length > 0 && onEditSlots && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-1.5 h-7 px-2 text-xs"
                              onClick={() => onEditSlots(booked.tentative)}
                            >
                              <Pencil size={12} className="mr-1" />
                              Edit slot
                              {booked.tentative.length === 1 ? "" : "s"}
                            </Button>
                          )}
                        </>
                      );
                    })()}
                  {bookable && orderSlots.isSuccess && (
                    <OrderSchedule
                      slots={orderSlots.data.get(e.id) ?? []}
                      instructorNames={instructorNames.data}
                      today={today}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Payments */}
      <section>
        <h4 className="mb-1.5 font-semibold">Payments</h4>
        {pays.length === 0 ? (
          <p className="text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {pays.map((p) => (
              <PaymentItem key={p.id} payment={p} />
            ))}
          </ul>
        )}
      </section>

      {/* Links */}
      {linkList.length > 0 && (
        <section>
          <h4 className="mb-1.5 font-semibold">Payment links sent</h4>
          <ul className="space-y-1">
            {linkList.slice(0, 8).map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-1.5">
                {l.link_code && <CopyableId value={l.link_code} />}
                <span>{l.service_label}</span>
                <span className="font-medium">
                  {rupees(Number(l.amount ?? 0))}
                </span>
                <span className="text-muted-foreground">
                  {l.channel === "copy" ? "copied" : "sent"}{" "}
                  {timeAgo(l.created_at)}
                  {l.sent_by ? ` · ${l.sent_by}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
