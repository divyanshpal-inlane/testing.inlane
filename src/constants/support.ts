// Shared support contact details + ticket option lists, reused by the learner
// Help page, the instructor Support screen, and the admin Support Tickets page.
// Numbers mirror src/routes/help.tsx.

export const SUPPORT_PHONE_DISPLAY = "08040266972"; // shown to the user (national 0 prefix)
export const SUPPORT_PHONE_TEL = "+918040266972"; // tel: link (E.164, no leading 0)
export const SUPPORT_PHONE_WHATSAPP = "916360739863"; // wa.me requires country code, no leading 0
export const SUPPORT_EMAIL = "support@inlane.in";

// Sales line — used by the learner "Chat with Sales" CTA after a demo/first class.
export const SALES_PHONE_DISPLAY = "7338098798";
export const SALES_PHONE_TEL = "+917338098798"; // tel: link (E.164)

export const telHref = (e164 = SUPPORT_PHONE_TEL) => `tel:${e164}`;
export const whatsappHref = (text?: string) =>
  `https://wa.me/${SUPPORT_PHONE_WHATSAPP}${
    text ? `?text=${encodeURIComponent(text)}` : ""
  }`;
export const mailtoHref = (subject?: string) =>
  `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;

// Ticket categories — must match the support_ticket.category CHECK constraint.
export type TicketCategory =
  | "learner"
  | "vehicle"
  | "payment"
  | "app"
  | "rto"
  | "other";

export const TICKET_CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "learner", label: "Learner issue" },
  { value: "vehicle", label: "Vehicle issue" },
  { value: "payment", label: "Payment issue" },
  { value: "app", label: "App issue" },
  { value: "rto", label: "RTO issue" },
  { value: "other", label: "Other" },
];

export const TICKET_CATEGORY_LABEL: Record<TicketCategory, string> =
  Object.fromEntries(
    TICKET_CATEGORIES.map((c) => [c.value, c.label]),
  ) as Record<TicketCategory, string>;

export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

export const TICKET_STATUSES: { value: TicketStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];
