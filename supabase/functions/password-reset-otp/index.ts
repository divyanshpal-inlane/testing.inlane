import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
const RESEND_DELAY_MS = 30 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

type ResetContext = "learner" | "instructor" | "admin";
type ResetAction = "send_otp" | "verify_otp" | "reset_password";

interface PasswordResetRequest {
  phone: string;
  action: ResetAction;
  context?: ResetContext;
  otp?: string;
  resetToken?: string;
  newPassword?: string;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function randomDigits(length: number): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => (value % 10).toString()).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hash(value: string): Promise<string> {
  const pepper =
    Deno.env.get("PASSWORD_RESET_OTP_SECRET") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    "";
  const bytes = new TextEncoder().encode(`${value}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function findAuthUserByPhone(
  supabaseClient: ReturnType<typeof createClient>,
  last10: string,
) {
  const { data, error } = await supabaseClient
    .rpc("get_auth_user_for_password_reset", { p_phone: last10 })
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.user_id as string,
    phone: data.user_phone as string | undefined,
    user_metadata: data.user_metadata as Record<string, unknown> | undefined,
  };
}

async function getRecipient(
  supabaseClient: ReturnType<typeof createClient>,
  authUser: { phone?: string; user_metadata?: Record<string, unknown> },
  last10: string,
  context?: ResetContext,
): Promise<{ name: string; phone: string }> {
  const phoneVariants = [last10, `91${last10}`, `+91${last10}`];
  const fallbackName =
    typeof authUser.user_metadata?.name === "string"
      ? authUser.user_metadata.name
      : "there";

  if (context === "learner") {
    const { data } = await supabaseClient
      .from("Learner")
      .select("name, phone")
      .in("phone", phoneVariants)
      .limit(1)
      .maybeSingle();

    return {
      name: data?.name || fallbackName,
      phone: data?.phone || authUser.phone || `+91${last10}`,
    };
  }

  if (context === "instructor") {
    const { data } = await supabaseClient
      .from("Instructor")
      .select("name, phone")
      .in("phone", phoneVariants)
      .limit(1)
      .maybeSingle();

    return {
      name: data?.name || fallbackName,
      phone: data?.phone || authUser.phone || `+91${last10}`,
    };
  }

  return {
    name: fallbackName,
    phone: authUser.phone || `+91${last10}`,
  };
}

async function sendWhatsappOtp(
  phone: string,
  name: string,
  otp: string,
): Promise<void> {
  const heltarApiKey = Deno.env.get("HELTAR_API_KEY");
  if (!heltarApiKey) throw new Error("HELTAR_API_KEY is not configured");

  const response = await fetch("https://api.heltar.com/v1/messages/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${heltarApiKey}`,
    },
    body: JSON.stringify({
      messages: [
        {
          clientWaNumber: phone,
          templateName: "webapp_forgot_pass_otp",
          templateContent:
            "Hey {{1}},\n\nWe received a request to reset your password for the *Lane App* 😊  \nYour one-time password (OTP) is: {{2}}  \n\nPlease use it to create a new password 🔢  \n\nIf you didn't request this password reset, please contact us  \n\nThank you, \nLane Team 🚗",
          templateHeader: "",
          languageCode: "en",
          variables: [
            {
              type: "body",
              parameters: [name, otp].map((text) => ({
                type: "text",
                text,
              })),
            },
          ],
          messageType: "template",
          refId: `password-reset-otp-${Date.now()}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Heltar rejected the OTP message: ${errorBody}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json()) as PasswordResetRequest;
    const phone = normalizePhone(body.phone || "");

    if (!phone) return json({ error: "Enter a valid phone number" }, 400);

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (body.action === "send_otp") {
      const { data: existingChallenge } = await supabaseClient
        .from("password_reset_challenges")
        .select("last_sent_at")
        .eq("phone", phone)
        .maybeSingle();

      if (
        existingChallenge?.last_sent_at &&
        Date.now() - new Date(existingChallenge.last_sent_at).getTime() <
          RESEND_DELAY_MS
      ) {
        return json(
          { error: "Please wait 30 seconds before requesting another OTP." },
          429,
        );
      }

      const authUser = await findAuthUserByPhone(supabaseClient, phone);
      if (!authUser) {
        return json({ error: "No account found with this phone number." }, 404);
      }

      const otp = randomDigits(6);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + OTP_TTL_MS);
      const { error: storeError } = await supabaseClient
        .from("password_reset_challenges")
        .upsert(
          {
            phone,
            user_id: authUser.id,
            otp_hash: await hash(otp),
            expires_at: expiresAt.toISOString(),
            attempts: 0,
            verified_at: null,
            reset_token_hash: null,
            reset_token_expires_at: null,
            last_sent_at: now.toISOString(),
          },
          { onConflict: "phone" },
        );

      if (storeError) throw storeError;

      try {
        const recipient = await getRecipient(
          supabaseClient,
          authUser,
          phone,
          body.context,
        );
        await sendWhatsappOtp(recipient.phone, recipient.name, otp);
      } catch (error) {
        await supabaseClient
          .from("password_reset_challenges")
          .delete()
          .eq("phone", phone);
        throw error;
      }

      return json({ success: true, message: "OTP sent successfully" });
    }

    if (body.action === "verify_otp") {
      if (!body.otp || !/^\d{6}$/.test(body.otp)) {
        return json({ error: "Enter the 6-digit OTP." }, 400);
      }

      const { data: challenge, error } = await supabaseClient
        .from("password_reset_challenges")
        .select("otp_hash, expires_at, attempts")
        .eq("phone", phone)
        .maybeSingle();

      if (error) throw error;
      if (!challenge || new Date(challenge.expires_at).getTime() < Date.now()) {
        return json({ error: "OTP expired. Please request a new OTP." }, 400);
      }
      if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
        return json(
          { error: "Too many incorrect attempts. Please request a new OTP." },
          429,
        );
      }

      if ((await hash(body.otp)) !== challenge.otp_hash) {
        await supabaseClient
          .from("password_reset_challenges")
          .update({ attempts: challenge.attempts + 1 })
          .eq("phone", phone);
        return json({ error: "Invalid OTP. Please try again." }, 400);
      }

      const resetToken = randomToken();
      const { error: updateError } = await supabaseClient
        .from("password_reset_challenges")
        .update({
          verified_at: new Date().toISOString(),
          reset_token_hash: await hash(resetToken),
          reset_token_expires_at: new Date(
            Date.now() + RESET_TOKEN_TTL_MS,
          ).toISOString(),
        })
        .eq("phone", phone);

      if (updateError) throw updateError;
      return json({ success: true, resetToken });
    }

    if (body.action === "reset_password") {
      if (!body.newPassword || body.newPassword.length < 6) {
        return json({ error: "Password must be at least 6 characters." }, 400);
      }
      if (!body.resetToken) {
        return json({ error: "Verify your OTP again." }, 400);
      }

      const { data: challenge, error } = await supabaseClient
        .from("password_reset_challenges")
        .select(
          "user_id, verified_at, reset_token_hash, reset_token_expires_at",
        )
        .eq("phone", phone)
        .maybeSingle();

      if (error) throw error;
      const tokenExpired =
        !challenge?.reset_token_expires_at ||
        new Date(challenge.reset_token_expires_at).getTime() < Date.now();
      const tokenInvalid =
        !challenge?.reset_token_hash ||
        (await hash(body.resetToken)) !== challenge.reset_token_hash;

      if (!challenge?.verified_at || tokenExpired || tokenInvalid) {
        return json(
          { error: "Reset session expired. Please request a new OTP." },
          401,
        );
      }

      const { error: updateError } =
        await supabaseClient.auth.admin.updateUserById(challenge.user_id, {
          password: body.newPassword,
        });
      if (updateError) throw updateError;

      await supabaseClient
        .from("password_reset_challenges")
        .delete()
        .eq("phone", phone);

      return json({ success: true, message: "Password updated successfully" });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("password-reset-otp error:", error);
    return json(
      { error: "Unable to process the password reset. Please try again." },
      500,
    );
  }
});
