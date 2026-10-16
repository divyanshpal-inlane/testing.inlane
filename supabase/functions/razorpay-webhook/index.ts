import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.47.10";
import { completePayment } from "../_shared/complete-payment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, content-length, x-razorpay-signature",
  "Access-Control-Max-Age": "86400",
};

async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const msgData = encoder.encode(rawBody);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", cryptoKey, msgData);
  const hashArray = Array.from(new Uint8Array(sig));
  const calculated = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return calculated === signature;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ?? "";
    if (!webhookSecret) {
      console.error("RAZORPAY_WEBHOOK_SECRET not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Webhook secret not set" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature") ?? "";

    const isValid = await verifyWebhookSignature(
      rawBody,
      signature,
      webhookSecret,
    );
    if (!isValid) {
      console.error("Razorpay webhook signature mismatch");
      return new Response(
        JSON.stringify({ success: false, error: "Invalid signature" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const payload = JSON.parse(rawBody);
    const event = payload?.event as string | undefined;
    const paymentEntity = payload?.payload?.payment?.entity;

    console.log("Razorpay webhook event:", event, {
      payment_id: paymentEntity?.id,
      order_id: paymentEntity?.order_id,
      status: paymentEntity?.status,
    });

    if (!paymentEntity) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No payment entity; ignored",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("MY_SUPABASE_URL") ?? "",
      Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const razorpayOrderId = paymentEntity.order_id as string;
    const razorpayPaymentId = paymentEntity.id as string;

    const { data: paymentRow, error: lookupError } = await supabaseClient
      .from("payment")
      .select("id, status, gateway_reference")
      .or(
        `gateway_reference.eq.${razorpayOrderId},gateway_reference.eq.${razorpayPaymentId}`,
      )
      .maybeSingle();

    if (lookupError) {
      console.error("Lookup error:", lookupError);
      throw lookupError;
    }
    if (!paymentRow) {
      console.warn("No payment row found for order/payment:", {
        razorpayOrderId,
        razorpayPaymentId,
      });
      return new Response(
        JSON.stringify({ success: true, message: "No matching payment row" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (event === "payment.captured" || event === "order.paid") {
      const result = await completePayment(
        supabaseClient,
        paymentRow.id,
        razorpayPaymentId,
      );
      return new Response(
        JSON.stringify({
          success: true,
          alreadyCompleted: result.alreadyCompleted,
          paymentId: result.paymentId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (event === "payment.failed") {
      if (paymentRow.status !== "completed") {
        await supabaseClient
          .from("payment")
          .update({
            status: "failed",
            gateway_reference: razorpayPaymentId,
          })
          .eq("id", paymentRow.id);
      }
      return new Response(
        JSON.stringify({ success: true, message: "Marked as failed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: `Event ${event} acknowledged` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Razorpay webhook error:", error);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
