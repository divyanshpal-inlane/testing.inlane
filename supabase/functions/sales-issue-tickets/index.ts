import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildTicketEmail,
  cleanDescription,
  isTicketStatus,
  normalizeTicketPhone,
  sanitizeError,
  SUPPORT_EMAIL_DEFAULT,
  UUID_RE,
} from "../_shared/sales-issue-tickets.ts";

// Sales issue tickets. ALL writes happen here with the service role:
//   create   { phone, description?, requestId }  -> save ticket, then e-mail Support
//   retry    { ticketId }                        -> re-send a failed notification
//   status   { ticketId, status }                -> move a ticket between statuses
// The creator is taken from the verified JWT, never from the request body.
// Env: MY_SUPABASE_URL, MY_SUPABASE_SERVICE_ROLE_KEY, SMTP_USERNAME,
//      SMTP_PASSWORD, SMTP_FROM, optional SUPPORT_EMAIL (default support@inlane.in).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const supabase = createClient(
  Deno.env.get("MY_SUPABASE_URL") ?? "",
  Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// A 'pending' notification older than this is assumed to have died mid-send.
const STALE_PENDING_MS = 2 * 60 * 1000;

interface Caller {
  userId: string;
  email: string | null;
  name: string | null;
  permissions: Set<string>;
  isSuperAdmin: boolean;
}

// Staff = an "Admin" row or a "User" (team member) row, matched by phone in
// every stored format (same approach as instructor-slot-booking).
async function getCaller(authHeader: string | null): Promise<Caller | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user?.phone) return null;

  const digits = user.phone.replace(/\D/g, "");
  const last10 = digits.slice(-10);
  const variants = [
    ...new Set([user.phone, digits, last10, `91${last10}`, `+91${last10}`]),
  ];

  const permissions = new Set<string>();
  let isSuperAdmin = false;
  let name: string | null = null;
  let found = false;

  const { data: admins } = await supabase
    .from("Admin")
    .select("id, name, is_super_admin")
    .in("phone", variants)
    .limit(1);
  const admin = admins?.[0];
  if (admin) {
    found = true;
    name = admin.name ?? null;
    isSuperAdmin = Boolean(admin.is_super_admin);
    const { data: perms } = await supabase
      .from("admin_permissions")
      .select("permission")
      .eq("admin_id", admin.id);
    (perms ?? []).forEach((p) => permissions.add(p.permission));
  }

  const { data: users } = await supabase
    .from("User")
    .select("id, name")
    .in("phone", variants)
    .limit(1);
  const staff = users?.[0];
  if (staff) {
    found = true;
    name = name ?? staff.name ?? null;
    const { data: perms } = await supabase
      .from("user_permissions")
      .select("permission")
      .eq("user_id", staff.id);
    (perms ?? []).forEach((p) => permissions.add(p.permission));
  }

  if (!found) return null;
  return {
    userId: user.id,
    email: user.email ?? null,
    name,
    permissions,
    isSuperAdmin,
  };
}

const can = (c: Caller, permission: string) =>
  c.isSuperAdmin || c.permissions.has(permission);

// Same permission as Learner Management / Instructor Management / Sales
// Dashboard: without it, responses carry the masked number only.
// Ticket list / status changes / retrying others' tickets: granted per user in
// Admin Management / User Management ("Escalate Issue Tracker"). Super admins hold all.
const MANAGE_PERMISSION = "sales_issue_tickets";
const PHONE_PERMISSION = "view_unmasked_customer_phone_numbers";
const maskPhone = (v: unknown) =>
  `XXXXXXXXX${String(v ?? "")
    .replace(/D/g, "")
    .slice(-2)}`;
function shape(c: Caller, ticket: Record<string, any>) {
  return can(c, PHONE_PERMISSION)
    ? ticket
    : { ...ticket, phone_number: maskPhone(ticket.phone_number) };
}

// --- e-mail -----------------------------------------------------------------

async function sendTicketEmail(ticket: Record<string, any>) {
  const username = Deno.env.get("SMTP_USERNAME");
  const password = Deno.env.get("SMTP_PASSWORD");
  const from = Deno.env.get("SMTP_FROM") || username;
  if (!username || !password || !from) {
    throw new Error("E-mail is not configured (SMTP_USERNAME/PASSWORD/FROM).");
  }
  const to = Deno.env.get("SUPPORT_EMAIL") || SUPPORT_EMAIL_DEFAULT;

  const raisedBy =
    [ticket.raised_by_name, ticket.raised_by_email]
      .filter(Boolean)
      .join(" · ") || "Unknown";
  const { subject, text, html } = buildTicketEmail({
    ticketNumber: ticket.ticket_number,
    phoneNumber: ticket.phone_number,
    description: ticket.description,
    createdAt: ticket.created_at,
    raisedBy,
    status: ticket.status,
  });

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: { username, password },
    },
  });
  try {
    // Sent FROM the configured, verified sender (never spoofed). The raiser's
    // e-mail, when we have one, is only the Reply-To.
    await client.send({
      from,
      to,
      subject,
      content: text,
      html,
      ...(ticket.raised_by_email ? { replyTo: ticket.raised_by_email } : {}),
    });
  } finally {
    try {
      await client.close();
    } catch (_) {
      /* ignore */
    }
  }
}

// Send for a ticket this call has already claimed ('pending'); record outcome.
async function deliver(ticket: Record<string, any>) {
  try {
    await sendTicketEmail(ticket);
    const { data } = await supabase
      .from("sales_issue_tickets")
      .update({
        notification_status: "sent",
        notification_error: null,
        notification_sent_at: new Date().toISOString(),
      })
      .eq("id", ticket.id)
      .select("*")
      .single();
    return data ?? ticket;
  } catch (e) {
    const message = sanitizeError(e, [
      Deno.env.get("SMTP_PASSWORD") ?? "",
      Deno.env.get("SMTP_USERNAME") ?? "",
    ]);
    console.error("sales-issue-tickets: e-mail failed:", message);
    const { data } = await supabase
      .from("sales_issue_tickets")
      .update({ notification_status: "failed", notification_error: message })
      .eq("id", ticket.id)
      .select("*")
      .single();
    return data ?? ticket;
  }
}

// --- handlers ---------------------------------------------------------------

async function handleCreate(caller: Caller, body: Record<string, any>) {
  // Any logged-in staff account (Admin or team member) may report an issue.
  const phone = normalizeTicketPhone(body.phone);
  if (!phone) {
    return json(400, {
      error: "Enter a valid 10-digit mobile number (starting 6-9).",
      field: "phone",
    });
  }
  const desc = cleanDescription(body.description);
  if (!desc.ok) return json(400, { error: desc.error, field: "description" });
  const requestId = String(body.requestId ?? "");
  if (!UUID_RE.test(requestId)) {
    return json(400, { error: "Missing request id." });
  }

  // Save FIRST. client_request_id is UNIQUE, so a double submit / network retry
  // of the same request returns the existing ticket and never e-mails twice.
  const { data: created, error } = await supabase
    .from("sales_issue_tickets")
    .insert({
      phone_number: phone,
      description: desc.value,
      raised_by: caller.userId,
      raised_by_email: caller.email,
      raised_by_name: caller.name,
      client_request_id: requestId,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("sales_issue_tickets")
        .select("*")
        .eq("client_request_id", requestId)
        .eq("raised_by", caller.userId)
        .maybeSingle();
      if (existing)
        return json(200, { ticket: shape(caller, existing), duplicate: true });
    }
    console.error("sales-issue-tickets: insert failed:", error);
    return json(500, { error: "Could not save the ticket. Please try again." });
  }

  const ticket = await deliver(created);
  return json(200, { ticket: shape(caller, ticket) });
}

async function handleRetry(caller: Caller, body: Record<string, any>) {
  // Anyone may retry their OWN ticket; tracker users may retry any (checked below).
  const id = String(body.ticketId ?? "");
  if (!UUID_RE.test(id)) return json(400, { error: "Invalid ticket id." });

  const { data: existing } = await supabase
    .from("sales_issue_tickets")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return json(404, { error: "Ticket not found." });
  // Report-only users may only retry their own tickets.
  if (!can(caller, MANAGE_PERMISSION) && existing.raised_by !== caller.userId) {
    return json(403, { error: "Not allowed." });
  }
  if (existing.notification_status === "sent") {
    return json(200, { ticket: shape(caller, existing), alreadySent: true });
  }

  // Atomic claim: only one concurrent retry flips failed/stale-pending -> pending.
  const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const { data: claimed } = await supabase
    .from("sales_issue_tickets")
    .update({ notification_status: "pending", notification_error: null })
    .eq("id", id)
    .or(
      `notification_status.eq.failed,and(notification_status.eq.pending,updated_at.lt.${staleBefore})`,
    )
    .select("*")
    .maybeSingle();
  if (!claimed) {
    return json(200, { ticket: shape(caller, existing), inProgress: true });
  }
  const ticket = await deliver(claimed);
  return json(200, { ticket: shape(caller, ticket) });
}

async function handleStatus(caller: Caller, body: Record<string, any>) {
  if (!can(caller, MANAGE_PERMISSION)) {
    return json(403, { error: "You are not allowed to update tickets." });
  }
  const id = String(body.ticketId ?? "");
  if (!UUID_RE.test(id)) return json(400, { error: "Invalid ticket id." });
  if (!isTicketStatus(body.status)) {
    return json(400, {
      error: "Status must be To Do, In Progress or Resolved.",
    });
  }
  // updated_at is maintained by the handle_updated_at() trigger.
  const { data, error } = await supabase
    .from("sales_issue_tickets")
    .update({ status: body.status })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("sales-issue-tickets: status update failed:", error);
    return json(500, { error: "Could not update the ticket." });
  }
  if (!data) return json(404, { error: "Ticket not found." });
  return json(200, { ticket: shape(caller, data) });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });
  try {
    const caller = await getCaller(req.headers.get("Authorization"));
    if (!caller) return json(401, { error: "Unauthorized" });

    let body: Record<string, any>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }

    switch (body.action) {
      case "create":
        return await handleCreate(caller, body);
      case "retry":
        return await handleRetry(caller, body);
      case "status":
        return await handleStatus(caller, body);
      default:
        return json(400, { error: "Unknown action." });
    }
  } catch (e) {
    console.error("sales-issue-tickets: unexpected error:", e);
    return json(500, { error: "Unexpected error. Please try again." });
  }
});
