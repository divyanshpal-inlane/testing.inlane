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
    console.log("[delete-admin-user] Normalized phone:", phone);

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

    console.log(
      "[delete-admin-user] Starting admin deletion for phone:",
      phone,
    );

    // Fetch all admins for flexible phone matching
    const { data: allAdmins, error: adminsFetchError } = await supabase
      .from("Admin")
      .select("id, phone");

    if (adminsFetchError) {
      console.error(
        "[delete-admin-user] Error fetching admins:",
        adminsFetchError,
      );
      return new Response(
        JSON.stringify({ success: false, error: "Failed to fetch admins" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Flexible phone matching - match by comparing digits
    const admin = allAdmins?.find((a) => {
      if (!a.phone) return false;
      const adminDigits = a.phone.replace(/\D/g, "");
      const phoneVariants = [
        phone,
        phone.replace(/^\+91/, "").replace(/^91/, ""),
        `+91${phone.replace(/^\+91/, "").replace(/^91/, "")}`,
        `91${phone.replace(/^\+91/, "").replace(/^91/, "")}`,
      ];

      return phoneVariants.some(
        (v) =>
          v === a.phone ||
          v.replace(/\D/g, "") === adminDigits ||
          adminDigits.endsWith(v.replace(/\D/g, "")) ||
          v.replace(/\D/g, "").endsWith(adminDigits),
      );
    });

    if (!admin) {
      console.error(
        "[delete-admin-user] Error finding admin with phone:",
        phone,
      );
      console.log(
        "[delete-admin-user] Available phone numbers:",
        allAdmins?.map((a) => a.phone),
      );
      return new Response(
        JSON.stringify({ success: false, error: "Admin not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const adminId = admin.id;
    console.log("[delete-admin-user] Found admin with ID:", adminId);

    // Safety check: Block deletion if admin has associated users
    const { count: userCount, error: userCountError } = await supabase
      .from("User")
      .select("*", { count: "exact", head: true })
      .eq("admin_id", adminId);

    if (userCountError) {
      console.error(
        "[delete-admin-user] Error checking associated users:",
        userCountError,
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to check associated users",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    if (userCount && userCount > 0) {
      console.warn(
        `[delete-admin-user] Cannot delete admin ${adminId} — has ${userCount} associated user(s)`,
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: `This admin has ${userCount} associated user${userCount > 1 ? "s" : ""}. Please reassign or delete their users before removing this admin.`,
          userCount,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    console.log(
      "[delete-admin-user] ✓ No associated users found, proceeding with deletion",
    );

    // Step 1: Find the actual auth user by phone
    // Build phone search variants
    const basePhone = phone.replace(/^\+91/, "").replace(/^91/, ""); // 10-digit number
    const phoneSearchVariants = [
      phone, // +917006342430
      basePhone, // 7006342430
      `91${basePhone}`, // 917006342430
    ];
    console.log(
      "[delete-admin-user] Searching for auth user with variants:",
      phoneSearchVariants,
    );

    // Fetch ALL auth users in one call (perPage: 1000) to avoid pagination issues
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
        console.error("[delete-admin-user] Error listing users:", listError);
        break;
      }

      const users = usersData?.users ?? [];
      console.log(
        `[delete-admin-user] Page ${page}: fetched ${users.length} auth users`,
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
        "[delete-admin-user] Auth user not found for phone variants:",
        phoneSearchVariants,
      );
      // Still delete the Admin DB record even if auth user not found
      // (auth user may have already been deleted or may not exist)
      console.warn(
        "[delete-admin-user] Proceeding to delete Admin record only (no auth user found)",
      );

      const { error: deleteError } = await supabase
        .from("Admin")
        .delete()
        .eq("id", adminId);

      if (deleteError) {
        console.error(
          "[delete-admin-user] Error deleting admin record:",
          deleteError,
        );
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to delete admin record from database",
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
          message:
            "Admin database record deleted (no matching auth user found)",
          adminId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const authUserId = authUser.id;
    console.log(
      "[delete-admin-user] Found auth user with ID:",
      authUserId,
      "phone:",
      authUser.phone,
    );

    // Step 2: Delete auth user FIRST (before deleting database record)
    console.log(
      "[delete-admin-user] Attempting to delete auth user:",
      authUserId,
    );
    const { error: authDeleteError } =
      await supabase.auth.admin.deleteUser(authUserId);

    if (authDeleteError) {
      console.error(
        "[delete-admin-user] Error deleting auth user:",
        authDeleteError,
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to delete admin from authentication system",
          details: authDeleteError.message,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    console.log("[delete-admin-user] ✓ Auth user deleted successfully");

    // Step 3: Delete from Admin table (permissions will cascade due to ON DELETE CASCADE)
    console.log(
      "[delete-admin-user] Attempting to delete Admin record:",
      adminId,
    );
    const { error: deleteError } = await supabase
      .from("Admin")
      .delete()
      .eq("id", adminId);

    if (deleteError) {
      console.error(
        "[delete-admin-user] Error deleting admin record:",
        deleteError,
      );
      // Auth user is already deleted, so we log a warning but continue
      console.warn(
        "[delete-admin-user] Admin record deletion failed, but auth user was already deleted",
      );
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to delete admin record from database",
          details: deleteError.message,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    console.log("[delete-admin-user] ✓ Admin record deleted successfully");

    return new Response(
      JSON.stringify({
        success: true,
        message:
          "Admin deleted successfully from both authentication and database",
        adminId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error) {
    console.error("[delete-admin-user] Unexpected error:", error);
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
