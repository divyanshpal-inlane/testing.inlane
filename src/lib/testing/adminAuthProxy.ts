// TESTING ONLY / REMOVE BEFORE PRODUCTION PR - see AGENTS.md, "Two environments".
//
// Drop-in replacement for the four `supabaseAdmin.auth.admin.*` calls the
// instructor onboarding wizard makes. Instead of a browser-held service-role
// key (which a public bundle would publish to everyone), each call goes to the
// `admin-instructor-auth` edge function, which holds the key server-side and
// authorises the caller by their own session.
//
// This file must never contain, import or read a service-role key. The only
// credential it uses is the signed-in user's session token, which
// `supabase.functions.invoke` attaches automatically.

import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabaseClient";

const FUNCTION_NAME = "admin-instructor-auth";

export interface ProxyUser {
  id: string;
  phone: string | null;
  email: string | null;
}

interface ProxyError {
  message: string;
}

interface ProxyResult<T> {
  data: T | null;
  error: ProxyError | null;
}

async function call<T>(body: Record<string, unknown>): Promise<ProxyResult<T>> {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body,
  });
  if (error) {
    let message = error.message;
    // A non-2xx reply surfaces as a generic message; the useful text is in the
    // response body.
    if (error instanceof FunctionsHttpError) {
      try {
        const parsed = await error.context.json();
        if (parsed?.error) message = String(parsed.error);
      } catch {
        // keep the generic message
      }
    }
    return { data: null, error: { message } };
  }
  return { data: data as T, error: null };
}

/** Finds an existing auth user by phone or email, matched server-side. */
export async function findAuthUser(
  phone: string,
  email: string,
): Promise<ProxyResult<{ user: ProxyUser | null }>> {
  return call<{ user: ProxyUser | null }>({
    action: "find_user",
    phone,
    email,
  });
}

/**
 * Same shape the wizard already reads from `supabaseAdmin.auth.admin`:
 * `{ data, error }`, with `error.message`.
 */
export const supabaseAdmin = {
  auth: {
    admin: {
      createUser: (attrs: {
        phone?: string;
        email?: string;
        password: string;
        // Accepted so the wizard's existing call compiles unchanged, but the
        // server ignores them: it always confirms the identity and always
        // fixes the role to "instructor" itself.
        email_confirm?: boolean;
        phone_confirm?: boolean;
        user_metadata?: { name?: string; user_role?: string };
      }) =>
        call<{ user: ProxyUser }>({
          action: "create_user",
          phone: attrs.phone,
          email: attrs.email,
          password: attrs.password,
          name: attrs.user_metadata?.name,
        }),

      deleteUser: (id: string) =>
        call<{ ok: true }>({ action: "delete_user", id }),

      updateUserById: (
        id: string,
        attrs: { phone?: string; phone_confirm?: boolean },
      ) =>
        call<{ user: ProxyUser }>({
          action: "update_user",
          id,
          phone: attrs.phone,
        }),
    },
  },
};
