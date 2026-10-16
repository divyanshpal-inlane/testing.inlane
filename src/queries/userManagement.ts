import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabaseClient";

import { ADMIN_PERMISSIONS, PermissionKey } from "./adminPermissions";

// All available user permissions (same as admin permissions for now)
export const USER_PERMISSIONS = ADMIN_PERMISSIONS;

export interface User {
  id: string;
  phone: string;
  name: string;
  admin_id: string;
  created_by_admin_id: string;
  created_at: string;
  signed_up: string | null;
}

export interface UserWithPermissions extends User {
  permissions: PermissionKey[];
}

// Users shown per page in Super Admin → User Management
export const USERS_PAGE_SIZE = 10;

export interface PaginatedUsersResult {
  users: UserWithPermissions[];
  totalCount: number;
}

// Get a single page of users from the "User" table with database-level
// filtering and pagination (used by Super Admin → User Management).
// - adminId: restrict to users created by this admin via User.created_by_admin_id
//            (null = every user visible to the caller under RLS)
// - searchTerm: case-insensitive partial match on User.name OR User.phone
export function usePaginatedUsers({
  page,
  pageSize = USERS_PAGE_SIZE,
  searchTerm,
  adminId,
  enabled = true,
}: {
  page: number;
  pageSize?: number;
  searchTerm: string;
  adminId: string | null;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ["paginatedUsers", page, pageSize, searchTerm, adminId],
    enabled,
    queryFn: async (): Promise<PaginatedUsersResult> => {
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      const trimmedSearch = searchTerm.trim();

      const buildQuery = (head: boolean) => {
        let query = supabase
          .from("User" as any)
          .select("*", { count: "exact", head }) as any;

        if (adminId) {
          query = query.eq("created_by_admin_id", adminId);
        }
        if (trimmedSearch) {
          // Escape PostgREST filter delimiters so user input can't break the
          // .or() expression, then match against name OR phone.
          const safe = trimmedSearch.replace(/[,()]/g, " ");
          query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%`);
        }
        return query;
      };

      const {
        data: users,
        error,
        count,
      } = await buildQuery(false)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        // PGRST103 = requested range not satisfiable (page is past the end,
        // e.g. the last user on the current page was just deleted). Return the
        // real total so the UI can clamp back to a valid page.
        if ((error as any).code === "PGRST103") {
          const { count: actualCount, error: countError } =
            await buildQuery(true);
          if (countError) throw countError;
          return { users: [], totalCount: actualCount ?? 0 };
        }
        throw error;
      }

      const userList = (users || []) as User[];
      const userIds = userList.map((u) => u.id);

      // Fetch permissions for the whole page in a single query
      const permissionsByUser = new Map<string, PermissionKey[]>();
      if (userIds.length > 0) {
        const { data: permissionRows, error: permError } = await (
          supabase
            .from("user_permissions" as any)
            .select("user_id, permission") as any
        ).in("user_id", userIds);

        if (permError) throw permError;

        for (const row of (permissionRows || []) as {
          user_id: string;
          permission: string;
        }[]) {
          const list = permissionsByUser.get(row.user_id);
          if (list) {
            list.push(row.permission as PermissionKey);
          } else {
            permissionsByUser.set(row.user_id, [
              row.permission as PermissionKey,
            ]);
          }
        }
      }

      const usersWithPermissions: UserWithPermissions[] = userList.map(
        (user) => ({
          ...user,
          permissions: permissionsByUser.get(user.id) ?? [],
        }),
      );

      return { users: usersWithPermissions, totalCount: count ?? 0 };
    },
  });
}

// Get current user's info and permissions
export function useCurrentUser() {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.phone) {
        console.log("[useCurrentUser] No phone on auth user");
        return null;
      }

      console.log("[useCurrentUser] Auth user phone:", user.phone);

      // Use edge function to fetch current user (bypasses RLS)
      console.log("[useCurrentUser] Calling edge function to get current user");
      const { data: edgeResult, error: edgeError } =
        await supabase.functions.invoke("get-current-user", {
          body: { phone: user.phone },
        });

      if (edgeError) {
        console.error("[useCurrentUser] Edge function error:", edgeError);
        return null;
      }

      if (!edgeResult?.success) {
        console.warn(
          "[useCurrentUser] Edge function returned error:",
          edgeResult?.error,
        );
        return null;
      }

      const foundUser = edgeResult.user as User;
      const permissions = edgeResult.user?.permissions || [];

      console.log(
        "[useCurrentUser] ✓ USER FOUND via edge function:",
        foundUser,
      );
      console.log(
        "[useCurrentUser] Permissions from edge function:",
        permissions,
      );

      return {
        ...foundUser,
        permissions: permissions as PermissionKey[],
      } as UserWithPermissions;
    },
  });
}

// Check if current user has a specific permission
export function useHasUserPermission(permission: PermissionKey) {
  const { data: user, isLoading } = useCurrentUser();

  return {
    hasPermission: user?.permissions?.includes(permission) || false,
    isLoading,
  };
}

// Get all users created by current admin
export function useAdminUsers() {
  return useQuery({
    queryKey: ["adminUsers"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.phone) {
        console.error("[useAdminUsers] No phone on auth user");
        return [];
      }

      // Get current admin's ID
      const { data: admin, error: adminError } = await supabase
        .from("Admin")
        .select("id")
        .eq("phone", user.phone)
        .single();

      if (adminError || !admin) {
        console.error("[useAdminUsers] Error fetching admin:", adminError);
        return [];
      }

      // Get all users created by this admin
      const { data: users, error } = await (
        supabase.from("User" as any).select("*") as any
      )
        .eq("created_by_admin_id", admin.id as any)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Get permissions for each user
      const usersWithPermissions: UserWithPermissions[] = await Promise.all(
        (users || []).map(async (user: User) => {
          const { data: permissions } = await (supabase
            .from("user_permissions" as any)
            .select("permission")
            .eq("user_id", user.id) as any);

          return {
            ...user,
            permissions: (permissions || []).map(
              (p: any) => p.permission as PermissionKey,
            ),
          } as UserWithPermissions;
        }),
      );

      return usersWithPermissions;
    },
  });
}

// Get all users created by ANY admin (for super admin only)
export function useAllUsers() {
  return useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      // Get all users from User table
      const { data: users, error } = await (
        supabase.from("User" as any).select("*") as any
      ).order("created_at", { ascending: false });

      if (error) throw error;

      // Get permissions for each user
      const usersWithPermissions: UserWithPermissions[] = await Promise.all(
        (users || []).map(async (user: User) => {
          const { data: permissions } = await (supabase
            .from("user_permissions" as any)
            .select("permission")
            .eq("user_id", user.id) as any);

          return {
            ...user,
            permissions: (permissions || []).map(
              (p: any) => p.permission as PermissionKey,
            ),
          } as UserWithPermissions;
        }),
      );

      return usersWithPermissions;
    },
  });
}

// Create new user (admin only)
export function useCreateUser() {
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
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.phone) {
        throw new Error("Admin not authenticated");
      }

      // Get current admin's ID
      const { data: admin, error: adminError } = await supabase
        .from("Admin")
        .select("id")
        .eq("phone", user.phone)
        .single();

      if (adminError || !admin) {
        throw new Error("Admin not found");
      }

      // Edge function handles everything: User table, auth user, and permissions
      const { data: authData, error: authError } =
        await supabase.functions.invoke("create-user", {
          body: {
            phone,
            password,
            name,
            permissions,
            adminId: admin.id,
          },
        });

      console.log("[useCreateUser] Response:", { authData, authError });

      if (authError) {
        console.error("[useCreateUser] Auth error:", authError);
        throw new Error(authError.message || "Failed to create user");
      }

      // Check if the function returned an error in the response
      if (authData && !authData.success) {
        console.error("[useCreateUser] Function error:", authData.error);
        throw new Error(authData.error || "Failed to create user");
      }

      if (!authData || !authData.userId) {
        console.error("[useCreateUser] Invalid response:", authData);
        throw new Error("Invalid response from server");
      }

      console.log("[useCreateUser] Success! Created user:", authData.userId);
      return { id: authData.userId, phone, name };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
      queryClient.invalidateQueries({ queryKey: ["paginatedUsers"] });
    },
  });
}

// Update user permissions (admin only for their users)
export function useUpdateUserPermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      permissions,
    }: {
      userId: string;
      permissions: PermissionKey[];
    }) => {
      // Get current admin to validate permissions
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.phone) {
        throw new Error("Admin not authenticated");
      }

      // Get current admin's permissions
      const { data: admin, error: adminError } = await (
        supabase.from("Admin" as any).select("id, is_super_admin") as any
      )
        .eq("phone", user.phone)
        .single();

      if (adminError || !admin) {
        throw new Error("Admin not found");
      }

      // Validate that admin can only assign permissions they have
      if (!(admin as any).is_super_admin && permissions.length > 0) {
        const { data: adminPermissions, error: permError } = await (supabase
          .from("admin_permissions" as any)
          .select("permission")
          .eq("admin_id" as any, (admin as any).id as any) as any);

        if (permError) {
          throw new Error("Failed to verify admin permissions");
        }

        const adminPermissionsList = (adminPermissions || []).map(
          (p: any) => p.permission as PermissionKey,
        );

        // Check if all requested permissions are in admin's permissions
        const hasAllPermissions = permissions.every((perm) =>
          adminPermissionsList.includes(perm),
        );

        if (!hasAllPermissions) {
          throw new Error("You cannot assign permissions that you do not have");
        }
      }

      // Delete existing permissions
      const { error: deleteError } = await (supabase
        .from("user_permissions" as any)
        .delete()
        .eq("user_id", userId) as any);

      if (deleteError) throw deleteError;

      // Insert new permissions
      if (permissions.length > 0) {
        const permissionRecords = permissions.map((permission) => ({
          user_id: userId,
          permission,
        }));

        const { error: insertError } = await supabase
          .from("user_permissions" as any)
          .insert(permissionRecords as any);

        if (insertError) throw insertError;
      }

      return { userId, permissions };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
      queryClient.invalidateQueries({ queryKey: ["paginatedUsers"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });
}

// Delete user (admin only for their users)
export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      // Get user phone for edge function deletion
      const { data: user, error: fetchError } = await (
        supabase.from("User" as any).select("phone") as any
      )
        .eq("id", userId)
        .single();

      if (fetchError || !user?.phone) {
        throw new Error("User not found");
      }

      console.log(
        "[useDeleteUser] Starting deletion for user:",
        userId,
        "phone:",
        user.phone,
      );

      // Call edge function which handles BOTH auth deletion AND database deletion
      // The edge function:
      // 1. Deletes auth user FIRST (most important step)
      // 2. Then deletes from User table (cascade deletes permissions)
      const { data: edgeFunctionResult, error: edgeFunctionError } =
        await supabase.functions.invoke("delete-user", {
          body: { phone: user.phone },
        });

      if (edgeFunctionError) {
        console.error(
          "[useDeleteUser] Edge function error:",
          edgeFunctionError,
        );
        throw new Error(
          edgeFunctionError.message ||
            "Failed to delete user from authentication system",
        );
      }

      // Check if the edge function returned an error in the response
      if (edgeFunctionResult && !edgeFunctionResult.success) {
        console.error(
          "[useDeleteUser] Edge function returned error:",
          edgeFunctionResult.error,
        );
        throw new Error(edgeFunctionResult.error || "Failed to delete user");
      }

      console.log(
        "[useDeleteUser] ✓ User deleted successfully:",
        edgeFunctionResult,
      );
      return userId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminUsers"] });
      queryClient.invalidateQueries({ queryKey: ["paginatedUsers"] });
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });
}
