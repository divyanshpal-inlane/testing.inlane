import {
  type PermissionKey,
  useCurrentAdmin,
} from "@/queries/adminPermissions";
import { useCurrentUser } from "@/queries/userManagement";

const CUSTOMER_PHONE_PERMISSION: PermissionKey =
  "view_unmasked_customer_phone_numbers";

// Customer / lead phone numbers (Learner Management, Instructor Management's
// tentative bookings, the Sales Dashboard) are shown masked unless the account
// is a super admin or was granted "View Unmasked Customer Phone Numbers" in
// Admin / User Management. This is a separate permission from "View Unmasked
// Phone Numbers" (ops team), which is left untouched. Masked while loading.
export function useCanSeeCustomerPhone(): boolean {
  const { data: currentAdmin } = useCurrentAdmin();
  const { data: currentUser } = useCurrentUser();
  return Boolean(
    currentAdmin?.is_super_admin ||
      currentAdmin?.permissions?.includes(CUSTOMER_PHONE_PERMISSION) ||
      currentUser?.permissions?.includes(CUSTOMER_PHONE_PERMISSION),
  );
}
