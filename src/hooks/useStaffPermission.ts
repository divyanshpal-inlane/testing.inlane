import {
  type PermissionKey,
  useCurrentAdmin,
} from "@/queries/adminPermissions";
import { useCurrentUser } from "@/queries/userManagement";

// Does the signed-in staff member hold `permission`? Admins (super admins hold
// everything) and team members ("User" rows) are both covered. This only drives
// the UI; the database (RLS) and the edge function enforce it for real.
export function useStaffPermission(permission: PermissionKey): {
  allowed: boolean;
  isLoading: boolean;
} {
  const { data: admin, isLoading: adminLoading } = useCurrentAdmin();
  const { data: user, isLoading: userLoading } = useCurrentUser();
  return {
    allowed: Boolean(
      admin?.is_super_admin ||
        admin?.permissions?.includes(permission) ||
        user?.permissions?.includes(permission),
    ),
    isLoading: adminLoading || userLoading,
  };
}
