import { toast } from "sonner";

type ToastType = "success" | "error" | "info" | "warning";

/**
 * Centralized toast notification utility
 * Uses Sonner library for consistent toast notifications
 *
 * @param type - Type of toast: "success" (3sec), "error" (7sec), "info", "warning"
 * @param title - Main title/message
 * @param description - Optional detailed description
 */
export const showToast = (
  type: ToastType,
  title: string,
  description?: string
) => {
  // Duration: 3 seconds for success, 7 seconds for error, 5 seconds for others
  const duration =
    type === "success" ? 3000 : type === "error" ? 7000 : 5000;

  toast[type](title, {
    description,
    duration,
    closeButton: true, 
  });
};

/**
 * Show success toast (3 second auto-dismiss)
 */
export const showSuccessToast = (title: string, description?: string) => {
  showToast("success", title, description);
};

/**
 * Show error toast (7 second auto-dismiss)
 */
export const showErrorToast = (title: string, description?: string) => {
  showToast("error", title, description);
};

/**
 * Show info toast
 */
export const showInfoToast = (title: string, description?: string) => {
  showToast("info", title, description);
};

/**
 * Show warning toast
 */
export const showWarningToast = (title: string, description?: string) => {
  showToast("warning", title, description);
};
