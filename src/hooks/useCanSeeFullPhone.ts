import { useAuth } from "@/context/auth-context";
import { useCurrentAdmin } from "@/queries/adminPermissions";

// Learner phone numbers are shown in full only to admins and super admins, and
// masked for "user" (team member) accounts. Two independent checks must BOTH
// pass, because the login metadata alone can say "admin" for an account that is
// not an admin: the session's user_role is admin / super_admin AND the account
// has a real row in the Admin table flagged is_admin or is_super_admin.
// Anything else - including while either lookup is still loading - is masked, so
// a number is never shown by mistake.
export function useCanSeeFullPhone(): boolean {
  const { user } = useAuth();
  const { data: admin } = useCurrentAdmin();
  const role = user?.user_metadata?.user_role;
  const roleIsAdmin = role === "admin" || role === "super_admin";
  return roleIsAdmin && Boolean(admin?.is_super_admin || admin?.is_admin);
}
