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
    const { from, to } = await req.json();

    if (!from || !to) {
      throw new Error("'from' and 'to' phone numbers are required");
    }

    // --- Exotel credentials ---
    const EXOTEL_ACCOUNT_SID = Deno.env.get("EXOTEL_ACCOUNT_SID");
    const EXOTEL_API_KEY = Deno.env.get("EXOTEL_API_KEY");
    const EXOTEL_API_TOKEN = Deno.env.get("EXOTEL_API_TOKEN");
    const EXOTEL_CALLER_ID = Deno.env.get("EXOTEL_CALLER_ID");
    const EXOTEL_SUBDOMAIN =
      Deno.env.get("EXOTEL_SUBDOMAIN") || "api.in.exotel.com";

    if (
      !EXOTEL_ACCOUNT_SID ||
      !EXOTEL_API_KEY ||
      !EXOTEL_API_TOKEN ||
      !EXOTEL_CALLER_ID
    ) {
      throw new Error("Exotel credentials are not configured");
    }

    // Normalize to 10-digit Indian number (Exotel accepts both formats)
    const normalizePhone = (phone: string): string => {
      const digits = phone.replace(/\D/g, "");
      if (digits.startsWith("91") && digits.length === 12) {
        return digits.slice(2); // Strip country code → 10 digits
      }
      if (digits.length === 10) return digits;
      return digits;
    };

    const fromPhone = normalizePhone(from);
    const toPhone = normalizePhone(to);

    // Exotel C2C endpoint
    const url = `https://${EXOTEL_SUBDOMAIN}/v1/Accounts/${EXOTEL_ACCOUNT_SID}/Calls/connect`;

    // Build form-encoded payload (Exotel requires application/x-www-form-urlencoded)
    const body = new URLSearchParams({
      From: fromPhone,
      To: toPhone,
      CallerId: EXOTEL_CALLER_ID,
      TimeLimit: "600", // 10 minutes max — adjust as needed
      TimeOut: "30", // Ring for 30 seconds before giving up
      Record: "true", // Record the call
    });

    console.log(`[masked-call] Calling Exotel C2C: ${url}`);
    console.log(
      `[masked-call] From: ${fromPhone}, To: ${toPhone}, CallerId: ${EXOTEL_CALLER_ID}`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + btoa(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`),
      },
      body: body.toString(),
    });

    const responseText = await response.text();
    console.log(`[masked-call] Exotel status: ${response.status}`);
    console.log(`[masked-call] Exotel response: ${responseText}`);

    if (!response.ok) {
      throw new Error(`Exotel API error: ${response.status} - ${responseText}`);
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    const callData = (data?.Call ?? {}) as Record<string, unknown>;

    return new Response(
      JSON.stringify({
        success: true,
        callSid: callData?.Sid ?? null,
        status: callData?.Status ?? null,
        raw: data,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("[masked-call] Error:", (error as Error).message);
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
