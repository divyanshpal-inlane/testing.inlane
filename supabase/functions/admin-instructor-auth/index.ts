// TESTING ONLY / REMOVE BEFORE PRODUCTION PR - see AGENTS.md, "Two environments".
//
// Server-side home for the four Supabase *admin auth* calls the instructor
// onboarding wizard used to make straight from the browser with the
// service-role key. A browser build cannot hold that key without publishing it
// (every `VITE_*` value is baked into public JS), so the testing site - which
// is a public GitHub Pages bundle talking to the live project - has to call
// this function instead. The key stays in the function's own environment
// (`SUPABASE_SERVICE_ROLE_KEY`, injected by Supabase); it is never read from the
// request, never logged, and never returned.
//
// Authorisation: the caller must present a real user session
// (`Authorization: Bearer <access token>`) that passes the same
// `is_admin_or_team_member()` check the instructor_service_zones RLS uses. The
// anon key alone is rejected.
//
// Deliberately NOT a generic proxy. Each action does the one thing the wizard
// needs, with the minimum it needs:
//   find_user    - match by phone/email server-side. The full auth user list is
//                  never sent to the browser (it would bypass phone masking).
//   create_user  - always an instructor identity; no role or admin fields.
//   delete_user  - only a recently created instructor identity (rollback).
//   update_user  - only the phone fields, on a recently created instructor.
//
// Deploy (manual, no CI): supabase functions deploy admin-instructor-auth
// Keep JWT verification ON (do not pass --no-verify-jwt).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const ALLOWED_ORIGINS = [
  /^https:\/\/divyanshpal-inlane\.github\.io$/,
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
];

/** Rollback/phone-pin may only touch an identity created this recently. */
const RECENT_WINDOW_MS = 30 * 60 * 1000;
const LIST_PAGE_SIZE = 1000;
const LIST_MAX_PAGES = 20;

// Origin handling is hygiene, not security: authorisation is the JWT + role
// check below. Unknown origins simply get no CORS grant.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    base["Access-Control-Allow-Origin"] = origin;
  }
  return base;
}

function reply(
  req: Request,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

const last10 = (v: unknown) =>
  String(v ?? "")
    .replace(/\D/g, "")
    .slice(-10);

/** Only these fields ever leave the function about an auth user. */
function slim(u: { id: string; phone?: string | null; email?: string | null }) {
  return { id: u.id, phone: u.phone ?? null, email: u.email ?? null };
}

const isUuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const isStr = (v: unknown, max = 320): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return reply(req, 405, { error: "Method not allowed" });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    console.error("[admin-instructor-auth] missing Supabase env");
    return reply(req, 500, { error: "Server configuration error" });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return reply(req, 401, { error: "Missing session" });
  }

  try {
    // 1. Who is calling? Evaluate the role check AS THE CALLER (their JWT, anon
    //    key), so `auth.uid()` / `auth.jwt()` inside the SQL helper are theirs.
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: allowed, error: roleErr } = await caller.rpc(
      "is_admin_or_team_member",
    );
    if (roleErr || allowed !== true) {
      return reply(req, 403, { error: "Not allowed" });
    }

    // 2. Only now is the service-role client created.
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return reply(req, 400, { error: "Invalid JSON body" });
    }
    const action = payload.action;

    /** Loads an identity and enforces the "recent instructor" guard. */
    const loadGuardedUser = async (id: unknown) => {
      if (!isUuid(id)) return { error: "Invalid user id" as const };
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error || !data?.user) return { error: "User not found" as const };
      const u = data.user;
      const age = Date.now() - new Date(u.created_at).getTime();
      const isInstructor = u.user_metadata?.user_role === "instructor";
      if (!isInstructor || !(age >= 0 && age <= RECENT_WINDOW_MS)) {
        return {
          error:
            "Only an instructor login created in the last 30 minutes can be changed here" as const,
        };
      }
      return { user: u };
    };

    // ---------------------------------------------------------- find_user
    if (action === "find_user") {
      const phoneDigits = last10(payload.phone);
      const email = String(payload.email ?? "")
        .trim()
        .toLowerCase();
      if (phoneDigits.length !== 10 && !email) {
        return reply(req, 400, { error: "Provide a phone or an email" });
      }
      for (let page = 1; page <= LIST_MAX_PAGES; page++) {
        const { data, error } = await admin.auth.admin.listUsers({
          page,
          perPage: LIST_PAGE_SIZE,
        });
        if (error) return reply(req, 500, { error: error.message });
        const found = data.users.find(
          (u) =>
            (phoneDigits.length === 10 && last10(u.phone) === phoneDigits) ||
            (email && (u.email ?? "").trim().toLowerCase() === email),
        );
        if (found) return reply(req, 200, { user: slim(found) });
        if (data.users.length < LIST_PAGE_SIZE) {
          return reply(req, 200, { user: null });
        }
      }
      // Fail closed, exactly like the browser version did.
      return reply(req, 500, { error: "Too many auth users to scan" });
    }

    // -------------------------------------------------------- create_user
    if (action === "create_user") {
      const { phone, email, password, name } = payload;
      if (!isStr(password, 200) || password.length < 6) {
        return reply(req, 400, { error: "Password must be at least 6 chars" });
      }
      if (!isStr(email) && !isStr(phone, 32)) {
        return reply(req, 400, { error: "Provide a phone or an email" });
      }
      // Whitelisted fields only. The role is fixed here, never taken from the
      // request, so this endpoint cannot mint an admin identity.
      const { data, error } = await admin.auth.admin.createUser({
        ...(isStr(phone, 32) ? { phone, phone_confirm: true } : {}),
        ...(isStr(email) ? { email, email_confirm: true } : {}),
        password,
        user_metadata: {
          user_role: "instructor",
          ...(isStr(name, 200) ? { name } : {}),
        },
      });
      if (error || !data?.user) {
        return reply(req, 400, { error: error?.message ?? "Create failed" });
      }
      console.log("[admin-instructor-auth] created", data.user.id);
      return reply(req, 200, { user: slim(data.user) });
    }

    // -------------------------------------------------------- delete_user
    if (action === "delete_user") {
      const g = await loadGuardedUser(payload.id);
      if ("error" in g) return reply(req, 403, { error: g.error });
      const { error } = await admin.auth.admin.deleteUser(g.user.id);
      if (error) return reply(req, 400, { error: error.message });
      console.log("[admin-instructor-auth] deleted", g.user.id);
      return reply(req, 200, { ok: true });
    }

    // -------------------------------------------------------- update_user
    if (action === "update_user") {
      const g = await loadGuardedUser(payload.id);
      if ("error" in g) return reply(req, 403, { error: g.error });
      if (!isStr(payload.phone, 32)) {
        return reply(req, 400, { error: "Provide a phone" });
      }
      const { data, error } = await admin.auth.admin.updateUserById(g.user.id, {
        phone: payload.phone,
        phone_confirm: true,
      });
      if (error || !data?.user) {
        return reply(req, 400, { error: error?.message ?? "Update failed" });
      }
      return reply(req, 200, { user: slim(data.user) });
    }

    return reply(req, 400, { error: "Unknown action" });
  } catch (err) {
    // Never echo internals (or anything that could carry a key) to the client.
    console.error(
      "[admin-instructor-auth] unhandled:",
      err instanceof Error ? err.message : "unknown",
    );
    return reply(req, 500, { error: "Internal error" });
  }
});
