import { heltarMessageService } from "../heltar-service.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message_type, ...data } = await req.json();

    if (!message_type) {
      throw new Error("message_type is required");
    }

    // Tentative-slot messages go through the authenticated
    // `instructor-slot-booking` function (action "sendTentativeSlots"), which
    // looks the phone up server-side. Refuse them here.
    if (message_type === "TENTATIVE_SLOTS") {
      return new Response(
        JSON.stringify({
          error: "TENTATIVE_SLOTS is not available on this endpoint",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403,
        },
      );
    }

    const result = await heltarMessageService.processMessageRequest(
      message_type,
      data,
    );

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("send-message error:", error);
    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
