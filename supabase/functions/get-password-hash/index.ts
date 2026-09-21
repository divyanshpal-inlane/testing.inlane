import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PasswordHashRequest {
  phone: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Only POST requests are allowed" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    // Parse request body
    const { phone } = (await req.json()) as PasswordHashRequest;

    // Validate phone parameter
    if (!phone) {
      return new Response(
        JSON.stringify({ error: "Phone number is required" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    // Create Supabase client with Service Role Key
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Query auth.users table to get encrypted password
    const { data: authUser, error: userError } = await supabaseClient
      .from("auth.users")
      .select("encrypted_password")
      .eq("phone", phone)
      .single();

    // Handle not found
    if (userError || !authUser) {
      return new Response(
        JSON.stringify({ error: "User not found with this phone number" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        },
      );
    }

    // Get encrypted password
    const passwordHash = authUser.encrypted_password;

    if (!passwordHash) {
      return new Response(
        JSON.stringify({ error: "No password hash found for this user" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        },
      );
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        password_hash: passwordHash,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error processing request:", error);

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
