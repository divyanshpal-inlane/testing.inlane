import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";

// All available admin permissions
export const ADMIN_PERMISSIONS = {
  game_analytics: {
    key: "game_analytics",
    label: "Game Analytics",
    description: "View learner game launches and activity history",
    route: "/admin/game-analytics",
  },
  learner_management: {
    key: "learner_management",
    label: "Learner Management",
    description: "Create and manage learner enrollments",
    route: "/admin/learner-management",
  },
  customer_migration: {
    key: "customer_migration",
    label: "Customer Migration",
    description: "Migrate existing customers from paper records",
    route: "/admin/learner-migration",
  },
  schedule_management: {
    key: "schedule_management",
    label: "Schedule Management",
    description: "Manage and organize training schedules for learners",
    route: "/admin/schedules",
  },
  ll_applications: {
    key: "ll_applications",
    label: "LL Applications",
    description: "Process and update learner's license applications",
    route: "/admin/learner-ll-details",
  },
  ll_pipeline: {
    key: "ll_pipeline",
    label: "LL → DL Pipeline",
    description:
      "End-to-end RTO application tracking: docs, call, scrutiny, LL/DL tests, delivery",
    route: "/admin/ll-pipeline",
  },
  post_ll_applications: {
    key: "post_ll_applications",
    label: "Post-LL Applications",
    description: "Process and update driver's license applications",
    route: "/admin/learner-details",
  },
  instructor_management: {
    key: "instructor_management",
    label: "Instructor Management",
    description: "Add, edit, and manage driving instructors",
    route: "/admin/instructors",
  },
  instructor_matrix: {
    key: "instructor_matrix",
    label: "Instructor Availability Matrix",
    description:
      "Color-coded weekly view of instructor capacity, bookings, and conflicts",
    route: "/admin/instructor-matrix",
  },
  kam_management: {
    key: "kam_management",
    label: "KAM Management",
    description:
      "Create and delete Key Account Managers; assign instructors to them",
    route: "/admin/kam-management",
  },
  instructor_earnings: {
    key: "instructor_earnings",
    label: "Instructor Earnings",
    description:
      "Per-class rates, targets, payouts, adjustments, and earning programs",
    route: "/admin/instructor-earnings",
  },
  lessons_dashboard: {
    key: "lessons_dashboard",
    label: "Lessons Dashboard",
    description:
      "Consolidated ops view of all scheduled lessons with filters and export",
    route: "/admin/lessons-dashboard",
  },
  notification_management: {
    key: "notification_management",
    label: "Daily Notification Management",
    description: "Set reminders and send daily notifications to learners",
    route: "/admin/notification-management",
  },
  tentative_schedules: {
    key: "tentative_schedules",
    label: "Tentative Schedules Info",
    description: "Search tentative schedules",
    route: "/admin/tentative-schedules-info",
  },
  learner_issue_fixer: {
    key: "learner_issue_fixer",
    label: "Learner Issue Fixer",
    description: "Diagnose and fix learner app, payment, and scheduling issues",
    route: "/admin/learner-issue-fixer",
  },
  settings: {
    key: "settings",
    label: "Settings",
    description: "Configure payment gateways and app settings",
    route: "/admin/settings",
  },
  team_feedback: {
    key: "team_feedback",
    label: "Team Feedback",
    description:
      "View and manage bug reports, feature requests, and suggestions",
    route: "/admin/bug-reports",
  },
  instructor_lesson_log: {
    key: "instructor_lesson_log",
    label: "Instructor Lesson Log",
    description:
      "View instructor lesson completions with OTP verification and timing details",
    route: "/admin/instructor-lesson-log",
  },
  payment_tracker: {
    key: "payment_tracker",
    label: "Payment Tracker",
    description:
      "Track full and half payments, lesson progress, and follow-up urgency",
    route: "/admin/payment-tracker",
  },
  course_feedback: {
    key: "course_feedback",
    label: "Course Feedback",
    description:
      "View learner feedback submitted at midway and course completion checkpoints",
    route: "/admin/feedback",
  },
  view_unmasked_phone_numbers: {
    key: "view_unmasked_phone_numbers",
    label: "View Unmasked Phone Numbers",
    description:
      "View and edit unmasked phone numbers for instructors and learners",
    route: null,
  },
  view_unmasked_car_numbers: {
    key: "view_unmasked_car_numbers",
    label: "View Unmasked Car Numbers",
    description: "View unmasked vehicle registration numbers for instructors",
    route: null,
  },
  admin_management: {
    key: "admin_management",
    label: "User Management",
    description: "Create and manage admin team members and their permissions",
    route: "/admin/user-management",
  },
  leave_management: {
    key: "leave_management",
    label: "Leave Management",
    description: "Approve instructor leave and arrange replacement instructors",
    route: "/admin/leave-management",
  },
  no_show_management: {
    key: "no_show_management",
    label: "No-show Management",
    description: "Manage learner and instructor no-show cases",
    route: "/admin/no-shows",
  },
  support_tickets: {
    key: "support_tickets",
    label: "Support Tickets",
    description: "View and resolve instructor support tickets",
    route: "/admin/support-tickets",
  },
  car_commerce_leads: {
    key: "car_commerce_leads",
    label: "Car Commerce Leads",
    description: "Learners who want to buy a car — with CSV export",
    route: "/admin/car-commerce-leads",
  },
  ll_customer_migration: {
    key: "ll_customer_migration",
    label: "LL Customer Migration",
    description: "Bulk-import existing Learner's License customers from CSV",
    route: "/admin/ll-customer-migration",
  },
  compliance_forms: {
    key: "compliance_forms",
    label: "Compliance Forms",
    description: "Generate RTO Form 14, Form 15 & Certificate for any customer",
    route: "/admin/compliance-forms",
  },
  safety_monitoring: {
    key: "safety_monitoring",
    label: "Safety Monitoring",
    description: "Accidents, breakdowns, misconduct reports and SOS alerts",
    route: "/admin/safety-monitoring",
  },
  instructor_performance: {
    key: "instructor_performance",
    label: "Instructor Performance",
    description:
      "Attendance, punctuality, ratings, complaints and completion rates",
    route: "/admin/instructor-performance",
  },
  ops_control_tower: {
    key: "ops_control_tower",
    label: "Operations Control Tower",
    description:
      "Live KPIs, today's operations and exception dashboard in one place",
    route: "/admin/control-tower",
  },
  sales_dashboard: {
    key: "sales_dashboard",
    label: "Sales Availability Dashboard",
    description:
      "Search instructors by name or location and see live 30-min free-slot availability",
    route: "/admin/sales-dashboard",
  },
} as const;

export type PermissionKey = keyof typeof ADMIN_PERMISSIONS;

export interface Admin {
  id: string;
  phone: string;
  name: string;
  is_super_admin: boolean;
  is_admin: boolean;
  created_at: string;
  signed_up: string | null;
}

export interface AdminWithPermissions extends Admin {
  permissions: PermissionKey[];
}

// Get current admin's info and permissions
export function useCurrentAdmin() {
  return useQuery({
    queryKey: ["currentAdmin"],
    queryFn: async () => {
      // Use getSession() (local localStorage read) instead of getUser() (server
      // validation call).  getUser() fails for Go-authenticated users because the
      // JWT sub claim is the Go service's internal UUID which does not exist in
      // Supabase's auth.users table.  getSession() returns the injected session
      // that contains the correct phone without making a network request.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user?.phone) {
        console.log("[useCurrentAdmin] No phone on auth user");
        return null;
      }

      console.log("[useCurrentAdmin] Auth user phone:", user.phone);

      // Normalize phone - try multiple formats to match Admin table
      const digits = user.phone.replace(/\D/g, "");
      const phoneVariants = [
        user.phone,
        digits,
        digits.replace(/^91/, ""),
        `+91${digits.replace(/^91/, "")}`,
      ];

      console.log("[useCurrentAdmin] Trying phone variants:", phoneVariants);

      // Get admin record - fetch ALL admins and match client-side
      // to avoid phone format issues with Supabase .in() filter
      const { data: allAdmins, error: adminError } = await supabase
        .from("Admin")
        .select("*");

      if (adminError) {
        console.error("[useCurrentAdmin] Error fetching admins:", adminError);
        return null;
      }

      console.log(
        "[useCurrentAdmin] All admin phones:",
        allAdmins?.map((a) => a.phone),
      );

      // Match by comparing digits
      const admin =
        allAdmins?.find((a) => {
          if (!a.phone) return false;
          const adminDigits = a.phone.replace(/\D/g, "");
          return phoneVariants.some(
            (v) =>
              v === a.phone ||
              v.replace(/\D/g, "") === adminDigits ||
              adminDigits.endsWith(digits.replace(/^91/, "")) ||
              digits.replace(/^91/, "").endsWith(adminDigits),
          );
        }) ?? null;

      console.log("[useCurrentAdmin] Matched admin:", admin);

      if (!admin) {
        return null;
      }

      // If super admin, return all permissions
      if (admin.is_super_admin) {
        return {
          ...admin,
          permissions: Object.keys(ADMIN_PERMISSIONS) as PermissionKey[],
        } as AdminWithPermissions;
      }

      // Get admin's permissions
      const { data: permissions, error: permError } = await supabase
        .from("admin_permissions")
        .select("permission")
        .eq("admin_id", admin.id);

      if (permError) {
        console.error("Error fetching permissions:", permError);
        return {
          ...admin,
          permissions: [] as PermissionKey[],
        } as AdminWithPermissions;
      }

      return {
        ...admin,
        permissions: permissions.map((p) => p.permission as PermissionKey),
      } as AdminWithPermissions;
    },
  });
}

// Check if current admin has a specific permission
export function useHasPermission(permission: PermissionKey) {
  const { data: admin, isLoading } = useCurrentAdmin();

  return {
    hasPermission:
      admin?.is_super_admin ||
      admin?.permissions?.includes(permission) ||
      false,
    isLoading,
    isSuperAdmin: admin?.is_super_admin || false,
  };
}

// Get all admins (super admin only)
// Only shows users who have is_admin = true (actual admins created via Admin Management)
export function useAllAdmins() {
  return useQuery({
    queryKey: ["allAdmins"],
    queryFn: async () => {
      // Get only actual admins (is_admin = true)
      const { data: admins, error } = await supabase
        .from("Admin")
        .select("*")
        .eq("is_admin", true)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get permissions for each admin
      const adminsWithPermissions: AdminWithPermissions[] = await Promise.all(
        admins.map(async (admin) => {
          if (admin.is_super_admin) {
            return {
              ...admin,
              permissions: Object.keys(ADMIN_PERMISSIONS) as PermissionKey[],
            };
          }

          const { data: permissions } = await supabase
            .from("admin_permissions")
            .select("permission")
            .eq("admin_id", admin.id);

          return {
            ...admin,
            permissions: (permissions || []).map(
              (p) => p.permission as PermissionKey,
            ),
          };
        }),
      );

      return adminsWithPermissions;
    },
  });
}

// Create new admin (super admin only)
export function useCreateAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      phone,
      name,
      password,
      permissions,
    }: {
      phone: string;
      name: string;
      password: string;
      permissions: PermissionKey[];
    }) => {
      // Edge function handles everything: Admin table, auth user, and permissions
      const { data: authData, error: authError } =
        await supabase.functions.invoke("create-admin-user", {
          body: { phone, password, name, permissions },
        });

      if (authError) {
        throw new Error(authError.message || "Failed to create admin");
      }

      // Check if the function returned an error in the response
      if (authData && !authData.success) {
        throw new Error(authData.error || "Failed to create admin");
      }

      return { id: authData.adminId, phone, name };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allAdmins"] });
    },
  });
}

// Update admin permissions (super admin only)
export function useUpdateAdminPermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      adminId,
      permissions,
    }: {
      adminId: string;
      permissions: PermissionKey[];
    }) => {
      // Delete existing permissions
      const { error: deleteError } = await supabase
        .from("admin_permissions")
        .delete()
        .eq("admin_id", adminId);

      if (deleteError) throw deleteError;

      // Insert new permissions
      if (permissions.length > 0) {
        const permissionRecords = permissions.map((permission) => ({
          admin_id: adminId,
          permission,
        }));

        const { error: insertError } = await supabase
          .from("admin_permissions")
          .insert(permissionRecords);

        if (insertError) throw insertError;
      }

      return { adminId, permissions };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allAdmins"] });
      queryClient.invalidateQueries({ queryKey: ["currentAdmin"] });
    },
  });
}

// Delete admin (super admin only)
export function useDeleteAdmin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (adminId: string) => {
      // Get admin phone for edge function deletion
      const { data: admin, error: fetchError } = await supabase
        .from("Admin")
        .select("phone")
        .eq("id", adminId)
        .single();

      if (fetchError || !admin?.phone) {
        throw new Error("Admin not found");
      }

      console.log(
        "[useDeleteAdmin] Starting deletion for admin:",
        adminId,
        "phone:",
        admin.phone,
      );

      // Call edge function which handles BOTH auth deletion AND database deletion
      // The edge function:
      // 1. Deletes auth user FIRST (most important step)
      // 2. Then deletes from Admin table (cascade deletes permissions)
      const { data: edgeFunctionResult, error: edgeFunctionError } =
        await supabase.functions.invoke("delete-admin-user", {
          body: { phone: admin.phone },
        });

      if (edgeFunctionError) {
        console.error(
          "[useDeleteAdmin] Edge function error:",
          edgeFunctionError,
        );
        throw new Error(
          edgeFunctionError.message ||
            "Failed to delete admin from authentication system",
        );
      }

      // Check if the edge function returned an error in the response
      if (edgeFunctionResult && !edgeFunctionResult.success) {
        console.error(
          "[useDeleteAdmin] Edge function returned error:",
          edgeFunctionResult.error,
        );
        throw new Error(edgeFunctionResult.error || "Failed to delete admin");
      }

      console.log(
        "[useDeleteAdmin] ✓ Admin deleted successfully:",
        edgeFunctionResult,
      );
      return adminId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allAdmins"] });
      queryClient.invalidateQueries({ queryKey: ["currentAdmin"] });
    },
  });
}
