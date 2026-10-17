import { Check, MessageCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  buildSlotLines,
  sendTentativeSlotsWhatsApp,
  type WhatsAppSlot,
  type WhatsAppTarget,
} from "@/lib/sales-dashboard/whatsappSlots";

/**
 * "Send Tentative Slots on WhatsApp". Sends the customer their saved tentative
 * slots through the integrated WhatsApp system (no personal/business account).
 *
 * The phone is never asked for and never shown: the server reads the real
 * number from the booking (agents only see masked numbers). `slots` is just the
 * preview of what the customer will receive; `target` says which saved rows to
 * send.
 */
export function SendSlotsWhatsApp({
  customerName,
  slots,
  target,
  hasPhone = true,
  variant = "panel",
}: {
  /**
   * "panel" uses the Sales Dashboard slot-panel styles. "card" is self-contained
   * Tailwind, for pages (Instructor Management) that do not load that CSS.
   */
  variant?: "panel" | "card";
  customerName: string;
  slots: WhatsAppSlot[];
  target: WhatsAppTarget;
  /** False when the booking has no phone saved (nothing to send to). */
  hasPhone?: boolean;
}) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const lines = buildSlotLines(slots);
  const canSend = hasPhone && lines.length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const result = await sendTentativeSlotsWhatsApp(target);
      const count = result.classes || slots.length;
      setSent(true);
      toast({
        title: "Sent on WhatsApp",
        description: `${customerName || "The customer"} will receive ${count} class${
          count === 1 ? "" : "es"
        }${result.sentTo ? ` on ${result.sentTo}` : ""}.`,
      });
    } catch (err) {
      toast({
        title: "Could not send on WhatsApp",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  const card = variant === "card";
  return (
    <div
      className={
        card
          ? "mt-1 flex flex-col items-start gap-2 border-t border-slate-100 pt-3"
          : "slot-panel-learner"
      }
      data-testid="send-slots-whatsapp"
    >
      <h3
        className={
          card
            ? "text-[10px] font-bold uppercase tracking-widest text-slate-400"
            : "slot-panel-learner-title"
        }
      >
        WhatsApp
      </h3>
      <ul
        className={
          card ? "text-[11px] text-slate-600" : "slot-panel-learner-note"
        }
        style={{ margin: 0, padding: 0 }}
      >
        {lines.map((line) => (
          <li key={line} style={{ listStyle: "none" }}>
            {line}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void send()}
        disabled={!canSend}
        className="whitespace-nowrap"
      >
        {sent ? (
          <Check size={14} className="mr-1" />
        ) : (
          <MessageCircle size={14} className="mr-1" />
        )}
        {sending
          ? "Sending…"
          : sent
            ? "Sent — send again"
            : "Send Tentative Slots on WhatsApp"}
      </Button>
      {!hasPhone && (
        <span
          className={
            card ? "text-[11px] text-slate-500" : "slot-panel-learner-note"
          }
        >
          No phone number is saved on this booking, so it can&apos;t be sent.
        </span>
      )}
    </div>
  );
}
