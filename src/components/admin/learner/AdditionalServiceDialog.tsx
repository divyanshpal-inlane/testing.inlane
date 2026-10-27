import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Copy, RefreshCcw, Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import {
  type BookingIntent,
  paymentStatusOf,
} from "@/lib/sales-dashboard/serviceBooking";
import { useCourses } from "@/queries/payment";

import {
  buildEnrollmentLink,
  buildServiceLink,
  copyServiceLink,
  createCourseAddOn,
  createLicenceService,
  DEFAULT_TOPUP_PRICE_PER_CLASS,
  LICENCE_NEED_LABEL,
  LicenceNeed,
  listLearnerServices,
  removeUnpaidService,
  sendServiceLink,
  serviceLabel,
  ServiceLearner,
  ServicePlan,
  splitAmount,
  upsertTopupEnrollment,
  Vehicle,
} from "./additionalServices";
import { PREDEFINED_COURSES } from "./CreateLearnerDialog";
import { EnrollmentRecord } from "./enrollmentActions";
import {
  linksKey,
  PaymentItem,
  paymentsKey,
  useLearnerLinks,
  useLearnerPayments,
} from "./LearnerPaymentsPanel";
import { CopyableId, timeAgo } from "./paymentTrace";

type Mode = "course" | "topup" | "licence";
type Tab = "sell" | "services";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  learner: ServiceLearner | null;
  /** Called after anything changed (service created, payment recorded...). */
  onDone?: () => void;
  /** Which tab to show first. */
  initialTab?: Tab;
  /**
   * Start booking classes for a service (Sales Dashboard only). When omitted
   * the "Book classes" buttons are hidden, since only the dashboard has a
   * calendar to book on.
   */
  onBookClasses?: (intent: BookingIntent) => void;
  /**
   * Called with a course / top-up service right after it was created here, so a
   * caller that has a slot open can link that slot to it by default.
   */
  onServiceCreated?: (service: EnrollmentRecord) => void;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function statusBadge(status: string | null) {
  if (status === "full_paid")
    return { text: "Paid", cls: "bg-green-100 text-green-800" };
  if (status === "half_paid")
    return { text: "Half paid", cls: "bg-amber-100 text-amber-800" };
  return { text: "Unpaid", cls: "bg-red-50 text-red-700" };
}

/**
 * The customer's "Services & payments" hub.
 *  - Sell: another course, top-up classes, or a licence service, to an
 *    EXISTING customer (no duplicate customer or lead). Each service is its own
 *    enrollment with its own payment records; the link names that enrollment.
 *  - Services & payments: every service with its link history, copy / resend /
 *    record payment / remove-if-unpaid, and each payment with its Payment ID,
 *    UTR, proof and verification state.
 */
export function AdditionalServiceDialog({
  open,
  onOpenChange,
  learner,
  onDone,
  initialTab = "sell",
  onBookClasses,
  onServiceCreated,
}: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: coursesData } = useCourses();

  const [tab, setTab] = useState<Tab>(initialTab);
  const [mode, setMode] = useState<Mode>("course");
  const [courseId, setCourseId] = useState("");
  const [plan, setPlan] = useState<ServicePlan>("full");
  const [total, setTotal] = useState(0);
  const [dueNow, setDueNow] = useState(0);
  const [hours, setHours] = useState(1);
  const [perClass, setPerClass] = useState(DEFAULT_TOPUP_PRICE_PER_CLASS);
  const [topupTotal, setTopupTotal] = useState(DEFAULT_TOPUP_PRICE_PER_CLASS);
  const [vehicle, setVehicle] = useState<Vehicle>("two_wheeler");
  const [need, setNeed] = useState<LicenceNeed>("ll_and_dl");
  const [licenceFee, setLicenceFee] = useState(0);
  const [busy, setBusy] = useState<null | "send" | "copy">(null);
  const [error, setError] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // The service just created in this dialog, so we can offer to book its
  // classes straight away.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setMode("course");
    setCourseId("");
    setPlan("full");
    setTotal(0);
    setDueNow(0);
    setHours(1);
    setPerClass(DEFAULT_TOPUP_PRICE_PER_CLASS);
    setTopupTotal(DEFAULT_TOPUP_PRICE_PER_CLASS);
    setVehicle("two_wheeler");
    setNeed("ll_and_dl");
    setLicenceFee(0);
    setError(null);
    setConfirmRemove(null);
    setJustCreatedId(null);
    // Reset once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const servicesKey = ["learner-services", learner?.id] as const;
  const services = useQuery({
    queryKey: servicesKey,
    enabled: open && !!learner?.id,
    staleTime: 0,
    queryFn: () => listLearnerServices(learner!.id),
  });
  const payments = useLearnerPayments(open ? learner?.id : undefined);
  const links = useLearnerLinks(open ? learner?.id : undefined);

  const refresh = async () => {
    if (!learner) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: servicesKey }),
      queryClient.invalidateQueries({ queryKey: paymentsKey(learner.id) }),
      queryClient.invalidateQueries({ queryKey: linksKey(learner.id) }),
    ]);
    onDone?.();
  };

  const pickCourse = (id: string) => {
    setCourseId(id);
    // Prefill with the list price; the team can still change it.
    const price = (
      coursesData as { id: string; price?: number }[] | undefined
    )?.find((c) => c.id === id)?.price;
    if (typeof price === "number") setTotal(price);
  };

  const amounts = splitAmount(plan, total, dueNow);

  /** What the dashboard needs to start booking classes for one service. */
  const intentFor = (e: EnrollmentRecord): BookingIntent | null => {
    if (!learner) return null;
    return {
      learnerId: learner.id,
      name: learner.name ?? "",
      phone: learner.phone ?? "",
      email: learner.email ?? undefined,
      enrollmentId: e.id,
      serviceLabel: serviceLabel(e),
      classes: e.progress?.total_hours ?? e.Courses?.duration ?? null,
      paymentStatus: paymentStatusOf(e.payment_status),
    };
  };
  const bookClasses = (e: EnrollmentRecord) => {
    const intent = intentFor(e);
    if (intent && onBookClasses) onBookClasses(intent);
  };

  const fail = (err: unknown, fallback: string) =>
    setError((err as { message?: string } | null)?.message || fallback);

  /** Create the course / top-up service, then send or copy its link. */
  const handleCreate = async (action: "send" | "copy") => {
    if (!learner) return;
    if (!learner.phone) {
      setError("This customer has no phone number, so no link can be built.");
      return;
    }
    setError(null);
    setBusy(action);
    try {
      const existing = services.data ?? (await listLearnerServices(learner.id));
      let enrollmentId: string;
      let label: string;
      let amount: number;
      let url: string;
      let duration: number;
      let serviceType: "course" | "topup";

      if (mode === "course") {
        if (!courseId) throw new Error("Pick a course package.");
        const created = await createCourseAddOn({
          learner,
          courseId,
          plan,
          total,
          customDueNow: dueNow,
          existing,
        });
        enrollmentId = created.enrollmentId;
        label = created.courseName;
        amount = created.dueNow;
        duration = PREDEFINED_COURSES.find((c) => c.id === courseId)!.duration;
        serviceType = "course";
        url = buildServiceLink({ phone: learner.phone, enrollmentId });
      } else {
        const result = await upsertTopupEnrollment({
          learner,
          hours,
          total: topupTotal,
          existing,
        });
        enrollmentId = result.enrollmentId;
        label = `Top-up classes (${hours})`;
        amount = topupTotal;
        duration = hours;
        serviceType = "topup";
        url = buildServiceLink({
          phone: learner.phone,
          enrollmentId,
          topup: { hours, total: topupTotal },
        });
        if (result.reused) {
          toast({
            title: "Updated the unpaid top-up",
            description:
              "This customer already had an unpaid top-up, so it was updated instead of adding a second one.",
          });
        }
      }

      if (action === "copy") {
        await copyServiceLink({
          learner,
          enrollmentId,
          serviceType,
          serviceLabel: label,
          amount,
          url,
        });
        toast({
          title: "Link copied",
          description: `${label} · ${rupees(amount)}. Paste it into WhatsApp or email.`,
        });
      } else {
        await sendServiceLink({
          learner,
          enrollmentId,
          serviceType,
          serviceLabel: label,
          amount,
          duration,
          url,
          toast,
        });
      }
      await refresh();
      setJustCreatedId(enrollmentId);
      setTab("services");
      if (onServiceCreated) {
        const fresh = await listLearnerServices(learner.id);
        const created = fresh.find((x) => x.id === enrollmentId);
        if (created) onServiceCreated(created);
      }
    } catch (err) {
      fail(err, "Could not create the service.");
    } finally {
      setBusy(null);
    }
  };

  /** Create the licence service, then send or copy its payment link. */
  const handleCreateLicenceWithLink = async (action: "send" | "copy") => {
    if (!learner) return;
    if (!learner.phone) {
      setError("This customer has no phone number, so no link can be built.");
      return;
    }
    setError(null);
    setBusy(action);
    try {
      const created = await createLicenceService({
        learner,
        vehicle,
        need,
        amount: licenceFee,
      });
      const amount = Math.round(licenceFee);
      const url = buildServiceLink({
        phone: learner.phone,
        enrollmentId: created.enrollmentId,
      });
      if (action === "copy") {
        await copyServiceLink({
          learner,
          enrollmentId: created.enrollmentId,
          serviceType: "other",
          serviceLabel: created.label,
          amount,
          url,
        });
        toast({
          title: "Link copied",
          description: `${created.label} · ${rupees(amount)}. Paste it into WhatsApp or email.`,
        });
      } else {
        await sendServiceLink({
          learner,
          enrollmentId: created.enrollmentId,
          serviceType: "other",
          serviceLabel: created.label,
          amount,
          duration: 1,
          url,
          toast,
        });
      }
      await refresh();
      setTab("services");
    } catch (err) {
      fail(err, "Could not create the licence service.");
    } finally {
      setBusy(null);
    }
  };

  /** Copy / resend the link of an existing service. */
  const handleLink = async (e: EnrollmentRecord, action: "send" | "copy") => {
    if (!learner?.phone) return;
    const built = buildEnrollmentLink(e, learner.phone);
    if (!built) return;
    setRowBusy(`${action}:${e.id}`);
    try {
      const label = serviceLabel(e);
      const serviceType =
        e.case_type === "rto_only"
          ? "other"
          : e.progress?.type === "topup"
            ? "topup"
            : "course";
      if (action === "copy") {
        await copyServiceLink({
          learner,
          enrollmentId: e.id,
          serviceType,
          serviceLabel: label,
          amount: built.amount,
          url: built.url,
        });
        toast({ title: "Link copied", description: label });
      } else {
        await sendServiceLink({
          learner,
          enrollmentId: e.id,
          serviceType,
          serviceLabel: label,
          amount: built.amount,
          duration: built.hours,
          url: built.url,
          toast,
        });
      }
      await queryClient.invalidateQueries({ queryKey: linksKey(learner.id) });
    } catch (err) {
      toast({
        title: "Could not send the link",
        description:
          (err as { message?: string } | null)?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setRowBusy(null);
    }
  };

  const handleRemove = async (e: EnrollmentRecord) => {
    setRowBusy(`remove:${e.id}`);
    try {
      await removeUnpaidService(e);
      toast({ title: "Service removed", description: serviceLabel(e) });
      setConfirmRemove(null);
      await refresh();
    } catch (err) {
      toast({
        title: "Could not remove",
        description:
          (err as { message?: string } | null)?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setRowBusy(null);
    }
  };

  const serviceList = services.data ?? [];
  const paymentList = payments.data ?? [];
  const linkList = links.data ?? [];
  const claimed = new Set<string>();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            Services &amp; payments — {learner?.name || "Customer"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Sell more to this existing customer without creating a new profile
            or lead. Earlier enrollments and payments are never changed.
          </p>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="sell">Sell something</TabsTrigger>
            <TabsTrigger value="services">
              Services &amp; payments ({serviceList.length})
            </TabsTrigger>
          </TabsList>

          {/* ------------------------------ SELL ------------------------------ */}
          <TabsContent value="sell" className="space-y-4 pt-3">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["course", "Another course", "Driving package"],
                  ["topup", "Top-up classes", "Extra classes"],
                  ["licence", "Licence service", "2W / 4W LL, DL"],
                ] as const
              ).map(([m, title, sub]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={`rounded-lg border p-2 text-left transition ${
                    mode === m
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-[11px] text-muted-foreground">{sub}</div>
                </button>
              ))}
            </div>

            {mode === "course" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs font-medium">
                    Course / Package
                  </Label>
                  <Select value={courseId} onValueChange={pickCourse}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREDEFINED_COURSES.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name} ({c.duration} lessons)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Payment plan</Label>
                  <Select
                    value={plan}
                    onValueChange={(v) => setPlan(v as ServicePlan)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full payment</SelectItem>
                      <SelectItem value="half">Half (50:50)</SelectItem>
                      <SelectItem value="custom">Custom amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Total (₹)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={total || ""}
                    onChange={(e) => setTotal(Number(e.target.value))}
                    className="h-9 text-sm"
                  />
                </div>
                {plan === "custom" && (
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs font-medium">Due now (₹)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={dueNow || ""}
                      onChange={(e) => setDueNow(Number(e.target.value))}
                      className="h-9 text-sm"
                    />
                  </div>
                )}
                <p className="col-span-2 rounded bg-muted/50 p-2 text-xs">
                  The link will charge <b>{rupees(amounts.dueNow)}</b> now
                  {amounts.second > 0
                    ? `, then ${rupees(amounts.second)} later.`
                    : "."}
                </p>
              </div>
            )}

            {mode === "topup" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Classes</Label>
                  <Input
                    type="number"
                    min={1}
                    value={hours || ""}
                    onChange={(e) => {
                      const h = Math.max(1, Number(e.target.value) || 1);
                      setHours(h);
                      setTopupTotal(h * perClass);
                    }}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Per class (₹)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={perClass || ""}
                    onChange={(e) => {
                      const p = Number(e.target.value) || 0;
                      setPerClass(p);
                      setTopupTotal(hours * p);
                    }}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Total (₹)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={topupTotal || ""}
                    onChange={(e) => setTopupTotal(Number(e.target.value))}
                    className="h-9 text-sm"
                  />
                </div>
                <p className="col-span-3 rounded bg-muted/50 p-2 text-xs">
                  The link will charge <b>{rupees(topupTotal)}</b> for {hours}{" "}
                  class{hours === 1 ? "" : "es"}. A customer has one unpaid
                  top-up at a time; asking again before it is paid updates it.
                </p>
              </div>
            )}

            {mode === "licence" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Vehicle</Label>
                  <Select
                    value={vehicle}
                    onValueChange={(v) => setVehicle(v as Vehicle)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="two_wheeler">2-Wheeler</SelectItem>
                      <SelectItem value="four_wheeler">4-Wheeler</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Needs</Label>
                  <Select
                    value={need}
                    onValueChange={(v) => setNeed(v as LicenceNeed)}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LICENCE_NEED_LABEL) as LicenceNeed[]).map(
                        (k) => (
                          <SelectItem key={k} value={k}>
                            {LICENCE_NEED_LABEL[k]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium">Fee (₹)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={licenceFee || ""}
                    onChange={(e) => setLicenceFee(Number(e.target.value))}
                    className="h-9 text-sm"
                  />
                </div>
                <p className="col-span-3 rounded bg-muted/50 p-2 text-xs">
                  The link will charge <b>{rupees(licenceFee || 0)}</b> as one
                  payment for this licence service. The service shows as Paid
                  once the customer has paid through the link.
                </p>
              </div>
            )}

            {error && (
              <p className="text-xs font-medium text-red-600">{error}</p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void (mode === "licence"
                    ? handleCreateLicenceWithLink("copy")
                    : handleCreate("copy"))
                }
                disabled={busy !== null}
              >
                {busy === "copy" ? (
                  <RefreshCcw size={14} className="mr-1 animate-spin" />
                ) : (
                  <Copy size={14} className="mr-1" />
                )}
                Create &amp; copy link
              </Button>
              <Button
                onClick={() =>
                  void (mode === "licence"
                    ? handleCreateLicenceWithLink("send")
                    : handleCreate("send"))
                }
                disabled={busy !== null}
              >
                {busy === "send" ? (
                  <RefreshCcw size={14} className="mr-1 animate-spin" />
                ) : (
                  <Send size={14} className="mr-1" />
                )}
                Create &amp; send link
              </Button>
            </div>
          </TabsContent>

          {/* ------------------------- SERVICES & PAYMENTS ------------------------- */}
          <TabsContent value="services" className="space-y-3 pt-3">
            {onBookClasses &&
              justCreatedId &&
              serviceList.find((e) => e.id === justCreatedId) && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                  <span className="text-green-900">
                    <b>
                      {serviceLabel(
                        serviceList.find((e) => e.id === justCreatedId)!,
                      )}
                    </b>{" "}
                    added. Book its classes now?
                  </span>
                  <Button
                    size="sm"
                    onClick={() =>
                      bookClasses(
                        serviceList.find((e) => e.id === justCreatedId)!,
                      )
                    }
                  >
                    <CalendarPlus size={14} className="mr-1" />
                    Book classes
                  </Button>
                </div>
              )}
            {services.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : serviceList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No services yet. Use &ldquo;Sell something&rdquo; to add one.
              </p>
            ) : (
              serviceList.map((e) => {
                const badge = statusBadge(e.payment_status);
                const paid = e.payment_status === "full_paid" ? true : false;
                const myLinks = linkList.filter(
                  (l) => l.enrollment_id === e.id,
                );
                const lastLink = myLinks[0];
                const myPayments = paymentList.filter(
                  (p) => p.enrollment_id === e.id || p.id === e.payment_id,
                );
                myPayments.forEach((p) => claimed.add(p.id));
                const hasLink = !!(
                  learner?.phone && buildEnrollmentLink(e, learner.phone)
                );
                const canRemove =
                  e.payment_status !== "full_paid" &&
                  e.payment_status !== "half_paid";
                return (
                  <div key={e.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">
                          {serviceLabel(e)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.amount ? `${rupees(e.amount)} total` : "No amount"}
                          {lastLink
                            ? ` · link ${lastLink.channel === "copy" ? "copied" : "sent"} ${timeAgo(lastLink.created_at)}${lastLink.sent_by ? ` by ${lastLink.sent_by}` : ""}`
                            : hasLink
                              ? " · no link sent yet"
                              : ""}
                        </div>
                        {lastLink?.link_code && (
                          <div className="mt-1">
                            <CopyableId value={lastLink.link_code} />
                          </div>
                        )}
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                      >
                        {badge.text}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {hasLink && !paid && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rowBusy !== null}
                            onClick={() => void handleLink(e, "copy")}
                          >
                            <Copy size={13} className="mr-1" />
                            Copy link
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={rowBusy !== null}
                            onClick={() => void handleLink(e, "send")}
                          >
                            {rowBusy === `send:${e.id}` ? (
                              <RefreshCcw
                                size={13}
                                className="mr-1 animate-spin"
                              />
                            ) : (
                              <Send size={13} className="mr-1" />
                            )}
                            Resend
                          </Button>
                        </>
                      )}
                      {onBookClasses && e.case_type !== "rto_only" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => bookClasses(e)}
                        >
                          <CalendarPlus size={13} className="mr-1" />
                          Book classes
                        </Button>
                      )}
                      {canRemove &&
                        (confirmRemove === e.id ? (
                          <>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={rowBusy !== null}
                              onClick={() => void handleRemove(e)}
                            >
                              Yes, remove
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmRemove(null)}
                            >
                              Keep
                            </Button>
                          </>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            onClick={() => setConfirmRemove(e.id)}
                          >
                            <Trash2 size={13} className="mr-1" />
                            Remove
                          </Button>
                        ))}
                    </div>

                    {myPayments.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {myPayments.map((p) => (
                          <PaymentItem key={p.id} payment={p} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}

            {paymentList.filter((p) => !claimed.has(p.id)).length > 0 && (
              <div className="rounded-lg border p-3">
                <h4 className="mb-1.5 text-xs font-semibold">Other payments</h4>
                <ul className="space-y-1.5">
                  {paymentList
                    .filter((p) => !claimed.has(p.id))
                    .map((p) => (
                      <PaymentItem key={p.id} payment={p} />
                    ))}
                </ul>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
