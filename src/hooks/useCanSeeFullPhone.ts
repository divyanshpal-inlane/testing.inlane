import { useAuth } from "@/context/auth-context";

// Learner phone numbers are shown in full to admins and super admins, and
// masked for "user" (team member) accounts. Anything else, or a role that has
// not loaded yet, is treated as "user" so a number is never shown by mistake.
export function useCanSeeFullPhone(): boolean {
  const { user } = useAuth();
  const role = user?.user_metadata?.user_role;
  return role === "admin" || role === "super_admin";
}
