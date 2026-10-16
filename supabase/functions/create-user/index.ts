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
    let { phone, password, name, permissions, adminId } = await req.json();

    console.log("[create-user] ========== STARTING USER CREATION ==========");
    console.log("[create-user] Received payload:", {
      phone,
      password: "***",
      name,
      adminId,
      permissions,
    });
    console.log("[create-user] Permissions array:", permissions);
    console.log(
      "[create-user] Permissions is array?",
      Array.isArray(permissions),
    );
    console.log("[create-user] Permissions length:", permissions?.length || 0);

    // Validate required fields
    if (!phone || !password || !name || !adminId) {
      console.log("[create-user] ✗ Missing required fields");
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Normalize phone number to consistent format: +919876543210
    let phoneDigits = phone.replace(/\D/g, "");
    console.log(
      "[create-user] Extracted digits from phone:",
      phoneDigits,
      "Length:",
      phoneDigits.length,
    );

    // Handle different input formats:
    // Input: "9876543210" or "919876543210" or "+919876543210"
    // After replace(/\D/g): "9876543210" or "919876543210" or "919876543210"

    // Remove leading 91 if present AND we have more than 10 digits
    if (phoneDigits.startsWith("91") && phoneDigits.length === 12) {
      phoneDigits = phoneDigits.substring(2); // Remove "91", leaving "9876543210"
      console.log("[create-user] Removed leading 91, now:", phoneDigits);
    }

    // Now phoneDigits should be exactly 10 digits, add +91 prefix
    if (phoneDigits.length !== 10) {
      console.error(
        "[create-user] Invalid phone format. Expected 10 digits, got:",
        phoneDigits.length,
      );
      return new Response(
        JSON.stringify({ success: false, error: "Invalid phone format" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const normalizedPhone = `+91${phoneDigits}`;
    phone = normalizedPhone;
    console.log("[create-user] Normalized phone to:", normalizedPhone);

    // Validate permissions - admin can only assign permissions they have
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!supabaseUrl || !supabaseServiceRoleKey) {
        console.error("Missing Supabase environment variables");
        return new Response(
          JSON.stringify({
            success: false,
            error: "Server configuration error",
          }),
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

      // Get the admin's permissions
      const { data: admin, error: adminCheckError } = await supabase
        .from("Admin")
        .select("is_super_admin")
        .eq("id", adminId)
        .single();

      if (adminCheckError || !admin) {
        return new Response(
          JSON.stringify({ success: false, error: "Admin not found" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      // If not super admin, check if they have all the permissions they're trying to assign
      if (!admin.is_super_admin) {
        const { data: adminPermissions, error: permError } = await supabase
          .from("admin_permissions" as any)
          .select("permission" as any)
          .eq("admin_id" as any, adminId as any);

        if (permError) {
          console.error("Error fetching admin permissions:", permError);
          return new Response(
            JSON.stringify({
              success: false,
              error: "Failed to verify admin permissions",
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }

        const adminPermissionsList = (adminPermissions || []).map(
          (p: any) => p.permission,
        );

        // Check if all requested permissions are in admin's permissions
        const hasAllPermissions = permissions.every((perm: string) =>
          adminPermissionsList.includes(perm),
        );

        if (!hasAllPermissions) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Admin cannot assign permissions they do not have",
            }),
            {
              status: 403,
              headers: { "Content-Type": "application/json", ...corsHeaders },
            },
          );
        }
      }
    }

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

    // Create auth user with "user" role (created by admin for team members)
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        phone,
        password,
        phone_confirm: true, // Mark phone as confirmed so user can login immediately
        user_metadata: {
          user_role: "user", // Users created by admin are team members with user role
        },
      });

    if (authError) {
      console.error("Error creating auth user:", authError);
      return new Response(
        JSON.stringify({ success: false, error: authError.message }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const userId = authData.user.id;

    console.log("[create-user] ✓ User created for:", phone);

    // Create User record (don't set id, let it auto-generate)
    const { data: userData, error: userError } = await supabase
      .from("User")
      .insert({
        phone,
        name,
        admin_id: adminId,
        created_by_admin_id: adminId,
      })
      .select()
      .single();

    if (userError) {
      console.error("Error creating user record:", userError);
      console.error("Full error details:", JSON.stringify(userError, null, 2));
      // Clean up auth user if User creation fails
      try {
        await supabase.auth.admin.deleteUser(userId);
      } catch (e) {
        console.error("Error cleaning up auth user:", e);
      }
      return new Response(
        JSON.stringify({
          success: false,
          error: userError.message || "Failed to create user record",
          details: userError,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    // Create permissions if provided
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      console.log("[create-user] userData:", userData);
      console.log(
        "[create-user] Creating permissions for user_id:",
        userData.id,
      );
      console.log("[create-user] Permissions to create:", permissions);

      const permissionRecords = permissions.map((permission: string) => ({
        user_id: userData.id,
        permission,
      }));

      console.log("[create-user] Permission records:", permissionRecords);

      const { error: permError } = await supabase
        .from("user_permissions")
        .insert(permissionRecords);

      if (permError) {
        console.error("[create-user] Error creating permissions:", permError);
        console.error(
          "[create-user] Full error details:",
          JSON.stringify(permError, null, 2),
        );
        // Clean up if permissions creation fails
        try {
          await supabase.from("User").delete().eq("id", userData.id);
          await supabase.auth.admin.deleteUser(userId);
        } catch (e) {
          console.error("Error during cleanup:", e);
        }
        return new Response(
          JSON.stringify({
            success: false,
            error: "Failed to create permissions",
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          },
        );
      }

      console.log("[create-user] ✓ Permissions created successfully");
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId,
        phone,
        name,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (error) {
    console.error("Unexpected error:", error);
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
