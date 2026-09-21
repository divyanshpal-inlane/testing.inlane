import { getCalApi } from "@calcom/embed-react";
import { differenceInCalendarDays, format } from "date-fns";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Clock,
  Download,
  ExternalLink,
  FileWarning,
  Home,
  Hourglass,
  PartyPopper,
  PlayCircle,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DL_PHASE_CUSTOMER_STATUSES,
  LL_DOC_TYPE_MAP,
  LL_LEARNING_MODULE_URL,
  LL_REAPPLY_FEE_DEFAULT,
  LL_TEST_VIDEO_URL,
  llDocSlotLabel,
  PARIVAHAN_LL_TEST_URL,
} from "@/constants/llPipeline";
import { whatsappHref } from "@/constants/support";
import { useLearner, useLearnerUpdate } from "@/queries/learner";
import {
  LLApplication,
  LLDocument,
  llDocumentUrl,
} from "@/queries/llApplications";
import {
  useCustomerLLStatusUpdate,
  useFirstCoursePaymentDate,
  useMyLLApplication,
  useRequestLLHelp,
} from "@/queries/llCustomer";

import { DLPhaseCard } from "./DLJourney";
import {
  daysSince,
  hoursSince,
  JourneyCard,
  SupportCallButton,
} from "./journeyShared";
import LLApplicationForm from "./LLApplicationForm";
import LLFillForm from "./LLFillForm";

/**
 * Sets up the cal.com embed and reports successful bookings. The embed is
 * initialised once, so the callback is kept in a ref — otherwise it would
 * close over the application/learner state of the very first render.
 */
function useCalBooking(onBooked: () => void) {
  const onBookedRef = useRef(onBooked);
  onBookedRef.current = onBooked;

  useEffect(() => {
    let cancelled = false;
    (async function () {
      const cal = await getCalApi({ namespace: "30min" });
      cal("ui", {
        theme: "light",
        styles: { branding: { brandColor: "#00CE84" } },
        hideEventTypeDetails: true,
        layout: "month_view",
      });
      cal("on", {
        action: "bookingSuccessful",
        callback: () => {
          if (!cancelled) onBookedRef.current();
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}

function BookAppointmentButton({ label }: { label: string }) {
  return (
    <Button
      className="w-full py-3 text-lg"
      data-cal-namespace="30min"
      data-cal-link="inlane.in/30min"
      data-cal-config='{"layout":"month_view","theme":"light"}'
    >
      <CalendarDays className="mr-2 h-5 w-5" />
      {label}
    </Button>
  );
}

/**
 * The customer's LL journey homepage — one screen per ll_applications.status,
 * transcribed from the RTO-flow spec sheet (homepage text + CTA per state).
 */
export default function LLJourney() {
  const { data: learner } = useLearner();
  const { mutate: updateLearner } = useLearnerUpdate();
  const { data: mine } = useMyLLApplication(learner?.id);
  const { data: paymentDate } = useFirstCoursePaymentDate(learner?.id);
  const statusUpdate = useCustomerLLStatusUpdate();
  const requestHelp = useRequestLLHelp();

  const [showForm, setShowForm] = useState<"checklist" | "form" | null>(null);
  const [helpRequested, setHelpRequested] = useState<string | null>(null);

  const application = mine?.application ?? null;
  const documents = mine?.documents ?? [];
  const status = application?.status ?? "payment_received";

  useCalBooking(() => {
    if (application && learner) {
      statusUpdate.mutate({
        applicationId: application.id,
        learnerId: learner.id,
        fromStatus: application.status,
        toStatus: "appointment_booked",
        note: "Customer booked the application call",
        actorName: learner.name,
      });
    }
    // Legacy gate kept in sync for older flows/reports.
    updateLearner({ LL_team_appointment_booked: true });
  });

  if (!learner) return null;

  if (showForm === "checklist")
    return <LLFillForm onExit={() => setShowForm(null)} />;
  if (showForm === "form")
    return <LLApplicationForm onDone={() => setShowForm(null)} />;

  const requestOnce = (reason: string) => {
    if (!application) return;
    requestHelp.mutate(
      {
        applicationId: application.id,
        learnerId: learner.id,
        reason,
        actorName: learner.name,
      },
      { onSuccess: () => setHelpRequested(reason) },
    );
  };

  // ── 1. Payment done, form not filled ───────────────────────────────────
  if (status === "payment_received" || status === "docs_link_sent") {
    const sinceIso = paymentDate ?? application?.created_at ?? null;
    const day = daysSince(sinceIso);
    return (
      <div className="flex w-full grow flex-col">
        <JourneyCard title="Start Your LL Application">
          {day >= 1 && (
            <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-medium text-amber-800">
                Your application is on hold until we receive your documents. It
                takes less than 5 minutes.
              </p>
              <Badge
                variant="outline"
                className="ml-2 shrink-0 border-amber-400 bg-white text-amber-700"
              >
                <Clock className="mr-1 h-3 w-3" />
                Day {day} since payment
              </Badge>
            </div>
          )}
          <p className="text-base">
            Please fill the following form and our RTO Team will review the
            documents.
          </p>
          <Button
            className="w-full py-3 text-lg"
            onClick={() => setShowForm("checklist")}
          >
            Fill the LL Form
          </Button>
          {day > 2 && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Need help filling the form?</p>
              <SupportCallButton label="Talk to Lane Team" />
            </div>
          )}
        </JourneyCard>
        <AlreadyHaveLL updateLearner={updateLearner} />
      </div>
    );
  }

  // ── 2. Form submitted, under review ────────────────────────────────────
  if (status === "docs_submitted" || status === "docs_under_review") {
    return (
      <JourneyCard title="Documents Under Review">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 shrink-0 text-primary" />
          <p className="text-base">
            Our team is currently reviewing your documents to ensure everything
            is in order. We will reach out to you shortly with the next steps to
            keep your application moving forward.
          </p>
        </div>
      </JourneyCard>
    );
  }

  // ── 3. Documents rejected — targeted re-upload ─────────────────────────
  if (status === "docs_rejected") {
    const rejected = documents.filter((d) => d.status === "rejected");
    return (
      <JourneyCard title="Documents Need Attention">
        <div className="flex items-center gap-3">
          <FileWarning className="h-8 w-8 shrink-0 text-red-500" />
          <p className="text-base font-medium">
            Please reupload the documents listed below.
          </p>
        </div>
        {rejected.length > 0 ? (
          <ul className="space-y-2">
            {rejected.map((d: LLDocument) => (
              <li
                key={d.id}
                className="rounded-md border border-red-200 bg-red-50 p-3"
              >
                <p className="text-sm font-semibold text-red-800">
                  {(() => {
                    const def = LL_DOC_TYPE_MAP[d.doc_type];
                    const slot = llDocSlotLabel(
                      def,
                      d.doc_slot || "primary",
                      d.doc_subtype,
                    );
                    const base = def?.label ?? d.doc_type;
                    return slot ? `${base} — ${slot}` : base;
                  })()}
                </p>
                {d.rejection_reason && (
                  <p className="text-sm text-red-700">
                    Reason: {d.rejection_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          application?.rejection_reason && (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {application.rejection_reason}
            </p>
          )
        )}
        <Button
          className="w-full py-3 text-lg"
          onClick={() => setShowForm("form")}
        >
          Reupload Documents
        </Button>
      </JourneyCard>
    );
  }

  // ── 4. Docs approved / customer missed once — book the call ────────────
  if (
    status === "meet_booking_enabled" ||
    (status === "call_missed" && (application?.call_missed_count ?? 0) < 2)
  ) {
    const stale = hoursSince(application?.status_changed_at) >= 24;
    return (
      <JourneyCard title="Book Your LL Application Appointment">
        {status === "call_missed" && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            We missed you on the last call — no worries, just pick a new slot.
          </p>
        )}
        <p className="text-base">
          Book your preferred time slot for processing the LL application.
        </p>
        {stale && status === "meet_booking_enabled" && (
          <p className="text-sm font-medium text-amber-700">
            Your slot is still open — pick a time that suits you.
          </p>
        )}
        <BookAppointmentButton label="Book your LL Application Appointment" />
      </JourneyCard>
    );
  }

  // ── 5. Customer missed twice — Ops takes over ──────────────────────────
  if (status === "call_missed") {
    return (
      <JourneyCard title="Let's Finish Your Application">
        <p className="text-base">
          Our team will call you shortly to help complete your application over
          the phone.
        </p>
        <BookAppointmentButton label="Book your LL Application Appointment" />
      </JourneyCard>
    );
  }

  // ── 6. Missed by Lane — apology + free reschedule ──────────────────────
  if (status === "call_missed_by_lane") {
    return (
      <JourneyCard title="Sorry We Missed You">
        <p className="text-base">
          Sorry, we could not connect for your appointment. Please pick a fresh
          slot — there is no extra charge.
        </p>
        <BookAppointmentButton label="Reschedule Appointment" />
      </JourneyCard>
    );
  }

  // ── 7. Appointment booked ──────────────────────────────────────────────
  if (status === "appointment_booked") {
    return (
      <JourneyCard title="Your LL Appointment Has Been Booked">
        <p className="text-base">
          We will apply for your Learner&apos;s License in this appointment. To
          make the process smooth and fast, please keep your ID proof documents
          ready on your phone so our team can complete your confirmation quickly
          📄📱
        </p>
        <p className="text-base font-medium">
          Please ensure you&apos;re in a quiet spot and ready to take the call!
        </p>
      </JourneyCard>
    );
  }

  // ── 8. Application at the RTO (generated → scrutiny) ───────────────────
  if (
    [
      "rto_application_generated",
      "govt_payment_pending",
      "govt_payment_failed",
      "application_ready",
      "in_scrutiny_queue",
      "assigned_to_runner",
      "submitted_at_rto",
      "waiting_rto_verification",
    ].includes(status)
  ) {
    return (
      <JourneyCard title="Application Sent to the RTO">
        <div className="flex items-center gap-3">
          <Hourglass className="h-8 w-8 shrink-0 text-primary" />
          <p className="text-base">
            Your LL application is sent for scrutiny at the RTO. You will be
            able to take the LL test after the scrutiny is done by the RTO.
          </p>
        </div>
        {application?.application_number && (
          <p className="text-sm text-gray-600">
            Application number:{" "}
            <span className="font-semibold">
              {application.application_number}
            </span>
          </p>
        )}
      </JourneyCard>
    );
  }

  // ── 9. Scrutiny failed — we reapply ────────────────────────────────────
  if (status === "scrutiny_rejected") {
    return (
      <JourneyCard title="Scrutiny Update">
        <p className="text-base">
          Uh-oh, the scrutiny at the RTO has failed. We will reapply for the LL
          application.
        </p>
        <p className="text-base">
          Book your preferred time slot for processing the LL application.
        </p>
        <BookAppointmentButton label="Book your LL Application Appointment" />
      </JourneyCard>
    );
  }

  // ── 10. Scrutiny passed — take the LL test ─────────────────────────────
  if (status === "ll_test_enabled") {
    const sinceScrutiny = daysSince(
      application?.scrutiny_approved_date ?? application?.status_changed_at,
    );
    const officeReason =
      "Customer requested a Lane office slot for the LL test";
    const homeReason = "Customer requested a home visit for the LL test";
    const isFastTrack = application?.batch_code === "B";
    return (
      <JourneyCard title="Take Your LL Test">
        <p className="text-base">
          {isFastTrack
            ? "Your application is ready on the Aadhaar fast-track. Kindly complete the LL test."
            : "Your scrutiny has been completed at the RTO. Kindly complete the LL test."}
        </p>
        <Button asChild className="w-full py-3 text-lg">
          <a href={PARIVAHAN_LL_TEST_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-2 h-5 w-5" />
            Take the LL Test on Parivahan
          </a>
        </Button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button asChild variant="outline" className="w-full py-3">
            <a href={LL_TEST_VIDEO_URL} target="_blank" rel="noreferrer">
              <PlayCircle className="mr-2 h-5 w-5" />
              LL test video
            </a>
          </Button>
          <Button asChild variant="outline" className="w-full py-3">
            <a href={LL_LEARNING_MODULE_URL} target="_blank" rel="noreferrer">
              <BookOpen className="mr-2 h-5 w-5" />
              Learning Module
            </a>
          </Button>
        </div>
        <SupportCallButton label="Need Help with Test" />
        {sinceScrutiny >= 3 && (
          <HelpOfferCard
            icon={<CalendarClock className="h-6 w-6 text-primary" />}
            text="Facing trouble with the LL test? Book a slot at the Lane office and our team will help you complete it."
            buttonLabel="Book Lane Office Slot"
            requested={
              helpRequested === officeReason ||
              application?.escalation_reason === officeReason
            }
            pending={requestHelp.isPending}
            onClick={() => requestOnce(officeReason)}
          />
        )}
        {sinceScrutiny >= 5 && (
          <HelpOfferCard
            icon={<Home className="h-6 w-6 text-primary" />}
            text="Our team can come to you. Book a home visit and we will help you finish the LL test."
            buttonLabel="Book Home Visit"
            requested={
              helpRequested === homeReason ||
              application?.escalation_reason === homeReason
            }
            pending={requestHelp.isPending}
            onClick={() => requestOnce(homeReason)}
          />
        )}
        {application?.scrutiny_expiry_date && (
          <p className="text-center text-xs text-gray-500">
            Complete the test before{" "}
            {format(new Date(application.scrutiny_expiry_date), "dd MMM yyyy")}{" "}
            — the RTO scrutiny expires after 7 days.
          </p>
        )}
      </JourneyCard>
    );
  }

  // ── 11. Scrutiny expired — pay fresh govt fee & reapply ────────────────
  if (status === "scrutiny_expired") {
    const fee = application?.reapply_fee ?? LL_REAPPLY_FEE_DEFAULT;
    const reason = `Customer wants to pay the fresh govt fee (Rs. ${fee}) and reapply after scrutiny expiry`;
    return (
      <JourneyCard title="Scrutiny Expired">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-8 w-8 shrink-0 text-red-500" />
          <p className="text-base">
            Your RTO scrutiny has expired because the LL test was not completed
            within 7 days. We will need to reapply — a fresh government fee of
            Rs. {fee} applies.
          </p>
        </div>
        <Button
          className="w-full py-3 text-lg"
          disabled={requestHelp.isPending}
          onClick={() => {
            requestOnce(reason);
            window.open(
              whatsappHref(
                `Hi Lane team, my RTO scrutiny expired. I'd like to pay the Rs. ${fee} government fee and reapply for my LL.`,
              ),
              "_blank",
            );
          }}
        >
          Pay and Reapply
        </Button>
        {(helpRequested === reason ||
          application?.escalation_reason === reason) && (
          <p className="text-center text-sm text-green-700">
            Got it — our team will share the payment link and restart your
            application.
          </p>
        )}
      </JourneyCard>
    );
  }

  // ── 12. LL test failed — retry after 24h ───────────────────────────────
  if (status === "ll_test_failed") {
    return (
      <JourneyCard title="LL Test Update">
        <p className="text-base">
          You can take the test again after 24 hours. Keep practicing — you will
          ace it this time!
        </p>
        <Button asChild className="w-full py-3 text-lg">
          <a href={PARIVAHAN_LL_TEST_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-2 h-5 w-5" />
            Retake the Test on Parivahan
          </a>
        </Button>
      </JourneyCard>
    );
  }

  // ── 13. Waiting for RTO approval (after LL test, or add-on routes C/D) ─
  if (status === "ll_test_passed") {
    return (
      <JourneyCard title="Congratulations! 🎉">
        <div className="flex items-center gap-3">
          <PartyPopper className="h-8 w-8 shrink-0 text-primary" />
          <p className="text-base">
            Congratulations on passing your LL test! It will be approved by the
            RTO in a few working days.
          </p>
        </div>
      </JourneyCard>
    );
  }

  if (status === "ll_approval_pending") {
    const isAddOn =
      application?.batch_code === "C" || application?.batch_code === "D";
    return (
      <JourneyCard
        title={isAddOn ? "Application Under Approval" : "Congratulations! 🎉"}
      >
        <div className="flex items-center gap-3">
          {isAddOn ? (
            <Hourglass className="h-8 w-8 shrink-0 text-primary" />
          ) : (
            <PartyPopper className="h-8 w-8 shrink-0 text-primary" />
          )}
          <p className="text-base">
            {isAddOn
              ? "Your add-on application is with the RTO for approval. We will update you once it is approved."
              : "Congratulations on passing your LL test! It will be approved by the RTO in a few working days."}
          </p>
        </div>
      </JourneyCard>
    );
  }

  // ── 14. LL approval rejected by the RTO ────────────────────────────────
  if (status === "ll_approval_rejected") {
    return (
      <JourneyCard title="Application Returned by the RTO">
        <p className="text-base">
          The RTO has returned your LL application.
          {application?.rejection_reason && (
            <>
              {" "}
              Reason:{" "}
              <span className="font-semibold">
                {application.rejection_reason}
              </span>
              .
            </>
          )}{" "}
          Please book a fresh appointment so our team can correct and resubmit
          it.
        </p>
        <BookAppointmentButton label="Book Appointment" />
      </JourneyCard>
    );
  }

  // ── 15. DL-test phase (LL matured / classes done → card delivery) ──────
  if (application && DL_PHASE_CUSTOMER_STATUSES.includes(status)) {
    return (
      <DLPhaseCard
        application={application}
        documents={documents}
        learnerId={learner.id}
        learnerName={learner.name}
      />
    );
  }

  // ── 16. LL approved / issued ───────────────────────────────────────────
  const setPreferences = () =>
    updateLearner({
      LL_received: true,
      LL_result: true,
      LL_application_approved: true,
      LL_team_appointment_booked: true,
    });

  const llCardDoc = documents.find((d) => d.doc_type === "ll_card") ?? null;
  const expiryDays = application?.ll_expiry_date
    ? differenceInCalendarDays(new Date(application.ll_expiry_date), new Date())
    : null;

  return (
    <JourneyCard
      title={
        application?.ll_number
          ? "Your Learner's Licence is Live 🎉"
          : "Your LL Has Been Approved 🎉"
      }
    >
      {application?.ll_number ? (
        <div className="rounded-lg border bg-gradient-to-br from-primary/10 to-white p-4">
          <div className="flex items-center gap-2">
            <BadgeCheck className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">{application.ll_number}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-gray-500">Issue Date</p>
              <p className="font-medium">
                {application.ll_issue_date
                  ? format(new Date(application.ll_issue_date), "dd MMM yyyy")
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Valid Till</p>
              <p className="font-medium">
                {application.ll_expiry_date
                  ? format(new Date(application.ll_expiry_date), "dd MMM yyyy")
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-base">
          Congratulations, your LL has been approved! Kindly set your
          preferences for classes — our team will review availability and
          schedule the classes.
        </p>
      )}

      {llCardDoc && (
        <Button asChild variant="outline" className="w-full py-3 text-lg">
          <a href={llDocumentUrl(llCardDoc)} target="_blank" rel="noreferrer">
            <Download className="mr-2 h-5 w-5" />
            Download LL
          </a>
        </Button>
      )}

      {expiryDays !== null && expiryDays >= 0 && expiryDays <= 30 && (
        <LLExpiryWarning
          application={application!}
          expiryDays={expiryDays}
          helpRequested={helpRequested}
          pending={requestHelp.isPending}
          onRequest={requestOnce}
        />
      )}

      <Button className="w-full py-3 text-lg" onClick={setPreferences}>
        Set Your Preferences
      </Button>
    </JourneyCard>
  );
}

function HelpOfferCard({
  icon,
  text,
  buttonLabel,
  requested,
  pending,
  onClick,
}: {
  icon: React.ReactNode;
  text: string;
  buttonLabel: string;
  requested: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm">{text}</p>
      </div>
      {requested ? (
        <p className="text-sm font-medium text-green-700">
          Request received — our team will call you to confirm the slot.
        </p>
      ) : (
        <Button
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={onClick}
        >
          {buttonLabel}
        </Button>
      )}
    </div>
  );
}

const DL_DATE_REASON = "Customer wants to pick a DL test date before LL expiry";

function LLExpiryWarning({
  application,
  expiryDays,
  helpRequested,
  pending,
  onRequest,
}: {
  application: LLApplication;
  expiryDays: number;
  helpRequested: string | null;
  pending: boolean;
  onRequest: (reason: string) => void;
}) {
  const requested =
    helpRequested === DL_DATE_REASON ||
    application.escalation_reason === DL_DATE_REASON;
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
      <p className="text-sm font-medium text-amber-800">
        Your Learner&apos;s Licence expires on{" "}
        {application.ll_expiry_date
          ? format(new Date(application.ll_expiry_date), "dd MMM yyyy")
          : "soon"}{" "}
        ({expiryDays} days left). Book your DL test before then so you do not
        have to reapply.
      </p>
      {requested ? (
        <p className="text-sm font-medium text-green-700">
          Request received — our team will call you with the available DL test
          dates.
        </p>
      ) : (
        <Button
          variant="outline"
          className="w-full border-amber-400"
          disabled={pending}
          onClick={() => onRequest(DL_DATE_REASON)}
        >
          Select DL Test Date
        </Button>
      )}
    </div>
  );
}

/** "Already have an LL?" escape hatch kept from the old flow. */
function AlreadyHaveLL({
  updateLearner,
}: {
  updateLearner: (fields: {
    LL_received: boolean;
    LL_result: boolean;
    LL_team_appointment_booked: boolean;
    LL_application_approved: boolean;
  }) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <p className="mt-auto pb-2 text-center text-base">
      {confirming ? (
        <>
          <span>Skip the LL process and schedule lessons?</span>
          <Button
            variant="link"
            onClick={() =>
              updateLearner({
                LL_received: true,
                LL_result: true,
                LL_team_appointment_booked: true,
                LL_application_approved: true,
              })
            }
          >
            Yes, I have an LL
          </Button>
          <Button variant="link" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <span>Already have an LL?</span>
          <Button variant="link" onClick={() => setConfirming(true)}>
            Schedule lessons
          </Button>
        </>
      )}
    </p>
  );
}
