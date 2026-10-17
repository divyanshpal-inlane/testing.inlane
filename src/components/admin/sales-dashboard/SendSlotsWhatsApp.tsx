import { Check, MessageCircle } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useCanSeeCustomerPhone } from "@/hooks/useCanSeeCustomerPhone";
import { normalizePhone } from "@/lib/sales-dashboard/validation";
import {
  buildSlotLines,
  sendTentativeSlotsWhatsApp,
  type WhatsAppSlot,
} from "@/lib/sales-dashboard/whatsappSlots";
import { maskPhoneNumber } from "@/utils/phoneMasking";

/**
 * "Send Tentative Slots on WhatsApp". Sends the given slots to the customer
 * through the integrated WhatsApp system (no personal/business account). The
 * saved number is used as-is (masked on screen for viewers without the
 * customer-phone permission); a booking with no phone asks for one.
 */
export function SendSlotsWhatsApp({
  customerName,
  phone,
  slots,
  variant = "panel",
}: {
  /**
   * "panel" uses the Sales Dashboard slot-panel styles. "card" is self-contained
   * Tailwind, for pages (Instructor Management) that do not load that CSS.
   */
  variant?: "panel" | "card";
  customerName: string;
  /** Real number saved on the booking; may be empty. */
  phone: string;
  slots: WhatsAppSlot[];
}) {
  const canSeePhone = useCanSeeCustomerPhone();
  const { toast } = useToast();
  const savedPhone = normalizePhone(phone);
  const [typedPhone, setTypedPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const target = savedPhone ?? normalizePhone(typedPhone);
  const lines = buildSlotLines(slots);
  const label = (n: string) => (canSeePhone ? n : maskPhoneNumber(n));

  const send = async () => {
    if (!target || sending) return;
    setSending(true);
    try {
      await sendTentativeSlotsWhatsApp({ customerName, phone: target, slots });
      setSentTo(target);
      toast({
        title: "Sent on WhatsApp",
        description: `${lines.length} slot${lines.length === 1 ? "" : "s"} sent to ${label(target)}.`,
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
      {!savedPhone && (
        <Input
          value={typedPhone}
          onChange={(e) => setTypedPhone(e.target.value)}
          placeholder="Customer's 10-digit phone"
          inputMode="tel"
          aria-label="Customer phone for WhatsApp"
          className={card ? "h-8 text-xs" : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void send()}
        disabled={!target || sending || lines.length === 0}
        className="whitespace-nowrap"
      >
        {sentTo ? (
          <Check size={14} className="mr-1" />
        ) : (
          <MessageCircle size={14} className="mr-1" />
        )}
        {sending
          ? "Sending…"
          : sentTo
            ? "Sent — send again"
            : "Send Tentative Slots on WhatsApp"}
      </Button>
      {target && (
        <span
          className={
            card ? "text-[11px] text-slate-500" : "slot-panel-learner-note"
          }
        >
          To {customerName || "customer"} · {label(target)}
        </span>
      )}
    </div>
  );
}
