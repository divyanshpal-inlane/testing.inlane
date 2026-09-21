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
    let { phone } = await req.json();

    if (!phone) {
      return new Response(
        JSON.stringify({ success: false, error: "Phone number is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Normalize phone number to consistent format: +919876543210
    const phoneDigits = phone.replace(/\D/g, "");
    const normalizedPhone =
      phoneDigits.startsWith("91") && phoneDigits.length > 10
        ? `+${phoneDigits}`
        : `+91${phoneDigits}`;
    phone = normalizedPhone;
    console.log("[delete-user] Normalized phone:", phone);

    // Get environment variables
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error("Missing Supabase environment variables");
      return new Response(
        JSON.stringify({ success: false, error: "Server configuration error" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Import Supabase client inside try-catch
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.39.0"
    );
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    console.log("[delete-user] Starting user deletion for phone:", phone);

    // Fetch all users for flexible phone matching
    const { data: allUsers, error: usersFetchError } = await supabase
      .from("User")
      .select("id, phone");

    if (usersFetchError) {
      console.error("[delete-user] Error fetching users:", usersFetchError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch users" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Flexible phone matching - match by comparing digits
    const user = allUsers?.find((u) => {
      if (!u.phone) return false;
      const userDigits = u.phone.replace(/\D/g, "");
      const phoneVariants = [
        phone,
        phone.replace(/^\+91/, "").replace(/^91/, ""),
        `+91${phone.replace(/^\+91/, "").replace(/^91/, "")}`,
        `91${phone.replace(/^\+91/, "").replace(/^91/, "")}`,
      ];

      return phoneVariants.some(
        (v) =>
          v === u.phone ||
          v.replace(/\D/g, "") === userDigits ||
          userDigits.endsWith(v.replace(/\D/g, "")) ||
          v.replace(/\D/g, "").endsWith(userDigits),
      );
    });

    if (!user) {
      console.error("[delete-user] Error finding user with phone:", phone);
      console.log(
        "[delete-user] Available phone numbers:",
        allUsers?.map((u) => u.phone),
      );
      return new Response(
        JSON.stringify({ success: false, error: "User not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const userId = user.id;
    console.log("[delete-user] Found user with ID:", userId);

    // Step 1: Find the actual auth user by phone (user ID != auth user ID)
    // Build phone search variants
    const basePhone = phone.replace(/^\+91/, "").replace(/^91/, ""); // 10-digit number
    const phoneSearchVariants = [
      phone, // +919876543210
      basePhone, // 9876543210
      `91${basePhone}`, // 919876543210
    ];
    console.log(
      "[delete-user] Searching for auth user with variants:",
      phoneSearchVariants,
    );

    // Fetch ALL auth users with pagination to avoid missing users
    let authUser = null;
    let page = 1;
    const perPage = 1000;

    while (!authUser) {
      const { data: usersData, error: listError } =
        await supabase.auth.admin.listUsers({
          page,
          perPage,
        });

      if (listError) {
        console.error("[delete-user] Error listing auth users:", listError);
        break;
      }

      const users = usersData?.users ?? [];
      console.log(
        `[delete-user] Page ${page}: fetched ${users.length} auth users`,
      );

      authUser =
        users.find((u) =>
          phoneSearchVariants.some((variant) => u.phone === variant),
        ) ?? null;

      // If we got fewer users than perPage, we've reached the last page
      if (users.length < perPage) break;
      page++;
    }

    if (!authUser) {
      console.error(
        "[delete-user] Auth user not found for phone variants:",
        phoneSearchVariants,
      );
      // Still delete the User DB record even if auth user not found
      // (auth user may have already been deleted or may not exist)
      console.warn(
        "[delete-user] Proceeding to delete User record only (no auth user found)",
      );

      const { error: deleteError } = await supabase
        .from("User")
        .delete()
        .eq("id", userId);

      if (deleteError) {
        console.error("[delete-user] Error deleting user record:", deleteError);
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to delete user record from database",
            details: deleteError.message,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: "User database record deleted (no matching auth user found)",
          userId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const authUserId = authUser.id;
    console.log(
      "[delete-user] Found auth user with ID:",
      authUserId,
      "phone:",
      authUser.phone,
    );

    // Step 2: Delete auth user FIRST (before deleting database record)
    console.log("[delete-user] Attempting to delete auth user:", authUserId);
    const { error: authDeleteError } =
      await supabase.auth.admin.deleteUser(authUserId);

    if (authDeleteError) {
      console.error("[delete-user] Error deleting auth user:", authDeleteError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to delete user from authentication system",
          details: authDeleteError.message,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    console.log("[delete-user] ✓ Auth user deleted successfully");

    // Step 3: Delete from User table (permissions will cascade due to ON DELETE CASCADE)
    console.log("[delete-user] Attempting to delete User record:", userId);
    const { error: deleteError } = await supabase
      .from("User")
      .delete()
      .eq("id", userId);

    if (deleteError) {
      console.error("[delete-user] Error deleting user record:", deleteError);
      // Auth user is already deleted, so we log a warning but continue
      console.warn(
        "[delete-user] User record deletion failed, but auth user was already deleted",
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to delete user record from database",
          details: deleteError.message,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    console.log("[delete-user] ✓ User record deleted successfully");

    return new Response(
      JSON.stringify({
        success: true,
        message:
          "User deleted successfully from both authentication and database",
        userId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error) {
    console.error("[delete-user] Unexpected error:", error);
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
