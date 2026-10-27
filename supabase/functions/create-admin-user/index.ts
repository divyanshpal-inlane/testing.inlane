import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("MY_SUPABASE_URL") ?? "",
      Deno.env.get("MY_SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Verify the requesting user is a super admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: requestingUser },
      error: authError,
    } = await supabaseClient.auth.getUser(token);

    if (authError || !requestingUser) {
      throw new Error("Unauthorized");
    }

    // Check if requesting user is super admin. Match the requester by id OR by
    // their phone in every stored format: an exact-text match on the login phone
    // rejected real super admins whose login is "91..." / "+91..." while the Admin
    // row stores the bare 10 digits (a 400 the app showed as "non-2xx").
    const requesterDigits = (requestingUser.phone ?? "").replace(/D/g, "");
    const requesterLast10 = requesterDigits.slice(-10);
    const requesterVariants = [
      ...new Set([
        requestingUser.phone ?? "",
        requesterDigits,
        requesterLast10,
        `91${requesterLast10}`,
        `+91${requesterLast10}`,
      ]),
    ].filter(Boolean);
    const [{ data: byId }, { data: byPhone }] = await Promise.all([
      supabaseClient
        .from("Admin")
        .select("is_super_admin")
        .eq("id", requestingUser.id),
      supabaseClient
        .from("Admin")
        .select("is_super_admin")
        .in("phone", requesterVariants),
    ]);
    const isSuperAdmin = [...(byId ?? []), ...(byPhone ?? [])].some(
      (a) => a.is_super_admin === true,
    );
    if (!isSuperAdmin) {
      throw new Error("Only super admin can create admin users");
    }

    const { phone, password, name, permissions } = await req.json();

    if (!phone || !password || !name) {
      throw new Error("Phone, password, and name are required");
    }

    console.log("Creating admin user:", { phone, name });

    // Check if phone already exists in the Admin table (any stored format)
    const newDigits = String(phone).replace(/D/g, "");
    const newLast10 = newDigits.slice(-10);
    const { data: existingAdmins } = await supabaseClient
      .from("Admin")
      .select("id")
      .in("phone", [
        ...new Set([
          String(phone),
          newDigits,
          newLast10,
          `91${newLast10}`,
          `+91${newLast10}`,
        ]),
      ])
      .limit(1);

    if (existingAdmins && existingAdmins.length > 0) {
      throw new Error("This phone number already exists in the system");
    }

    // An existing auth account is detected by createUser below. (The old
    // listUsers() pre-check only ever saw the first page of 50 of ~4,000 accounts,
    // so it could not detect anything.)

    // Step 1: Create Admin record FIRST
    const { data: newAdmin, error: createAdminError } = await supabaseClient
      .from("Admin")
      .insert({
        phone,
        name,
        is_super_admin: false,
        is_admin: true,
      })
      .select()
      .single();

    if (createAdminError) {
      console.error("Error creating Admin record:", createAdminError);
      throw new Error(createAdminError.message);
    }

    console.log("Admin record created:", newAdmin.id);

    // Step 2: Create auth user using Supabase Admin API
    const { data: authUser, error: authCreateError } =
      await supabaseClient.auth.admin.createUser({
        phone,
        password,
        phone_confirm: true,
        user_metadata: {
          user_role: "admin",
          name,
        },
        app_metadata: {
          user_role: "admin",
        },
      });

    if (authCreateError) {
      console.error("Error creating auth user:", authCreateError);
      // Rollback Admin record
      await supabaseClient.from("Admin").delete().eq("id", newAdmin.id);
      throw new Error(
        /already|registered|exists/i.test(authCreateError.message)
          ? "This phone number already has a login account"
          : authCreateError.message,
      );
    }

    console.log("Auth user created:", authUser.user.id);

    // Step 3: Create permissions if provided
    if (permissions && permissions.length > 0) {
      const permissionRecords = permissions.map((permission: string) => ({
        admin_id: newAdmin.id,
        permission,
      }));

      const { error: permError } = await supabaseClient
        .from("admin_permissions")
        .insert(permissionRecords);

      if (permError) {
        console.error("Error creating permissions:", permError);
      }
    }

    console.log("Admin user fully created:", {
      phone,
      name,
      adminId: newAdmin.id,
    });

    return new Response(
      JSON.stringify({
        success: true,
        adminId: newAdmin.id,
        userId: authUser.user.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error creating admin user:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
