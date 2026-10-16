import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, content-type, apikey",
};

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const { phone } = await req.json();

    if (!phone) {
      console.error("[get-current-user] Missing phone");
      return new Response(
        JSON.stringify({ success: false, error: "Phone is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error(
        "[get-current-user] Missing Supabase environment variables",
      );
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.39.0"
    );
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Normalize phone to last 10 digits for reliable matching
    const inputDigits = phone.replace(/\D/g, "");
    const last10 = inputDigits.slice(-10);

    console.log(
      "[get-current-user] Input phone:",
      phone,
      "Digits:",
      inputDigits,
      "Last 10:",
      last10,
    );

    // First, try to find user by matching last 10 digits of stored phone
    console.log(
      "[get-current-user] Fetching all users to match by last 10 digits...",
    );
    const { data: allUsers, error: allError } = await supabase
      .from("User")
      .select("*");

    if (allError) {
      console.error("[get-current-user] Error fetching users:", allError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to fetch users",
          details: allError,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    console.log(
      "[get-current-user] Total users in table:",
      allUsers?.length || 0,
    );
    if (allUsers && allUsers.length > 0) {
      console.log(
        "[get-current-user] Users found:",
        allUsers.map((u) => ({
          id: u.id,
          phone: u.phone,
          last10: u.phone?.replace(/\D/g, "").slice(-10),
        })),
      );
    }

    // Match by last 10 digits - most reliable method
    let userData = null;

    if (allUsers && allUsers.length > 0) {
      userData =
        allUsers.find((u: any) => {
          if (!u.phone) return false;
          const userDigits = u.phone.replace(/\D/g, "");
          const userLast10 = userDigits.slice(-10);
          const isMatch = last10 === userLast10;

          if (isMatch) {
            console.log(
              "[get-current-user] ✓ MATCH FOUND! Input last 10:",
              last10,
              "User last 10:",
              userLast10,
              "User phone:",
              u.phone,
            );
          }

          return isMatch;
        }) || null;
    }

    if (!userData) {
      console.warn(
        "[get-current-user] No user found matching last 10 digits:",
        last10,
      );
    }

    if (!userData) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "User not found",
          input_phone: phone,
          last_10: last10,
          total_users_in_db: allUsers?.length || 0,
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Get user's permissions
    const { data: permissions, error: permError } = await supabase
      .from("user_permissions")
      .select("permission")
      .eq("user_id", userData.id);

    if (permError) {
      console.error(
        "[get-current-user] Error fetching permissions:",
        permError,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          ...userData,
          permissions: (permissions || []).map((p: any) => p.permission),
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error) {
    console.error("[get-current-user] Unexpected error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "An error occurred",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }
});
