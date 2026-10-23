import { useCallback, useState } from "react";

import { supabase } from "@/lib/supabaseClient";
import { functionErrorReason } from "@/utils/functionError";

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: {
    name: string;
    email: string;
    contact: string;
  };
  theme: {
    color: string;
  };
  handler: (response: RazorpayResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

interface RazorpayInstance {
  open: () => void;
  close: () => void;
}

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface CreateOrderParams {
  amount: number;
  email: string;
  phone: string;
  name: string;
  paymentType: string;
  courseId?: string;
  learnerId?: string;
  installmentType?: string;
  installment1Amount?: number;
  installment2Amount?: number;
  selectedModules?: string[];
  totalHours?: number;
  isDemoUpgrade?: boolean;
  demoPaymentId?: string | null;
  courseSelectionType?: string;
  enrollmentId?: string;
  totalAmount?: number;
  requestId?: string;
  parentPaymentId?: string;
}

interface CreateOrderResponse {
  success: boolean;
  orderId: string;
  paymentId: string;
  amount: number;
  currency: string;
  keyId: string;
}

interface VerifyPaymentParams {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
  paymentId: string;
}

export function useRazorpay() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRazorpayScript = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }

      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }, []);

  const createOrder = useCallback(
    async (params: CreateOrderParams): Promise<CreateOrderResponse | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: invokeError } = await supabase.functions.invoke(
          "create-razorpay-order",
          {
            body: params,
          },
        );

        if (invokeError) {
          // supabase-js only says "non-2xx"; the real reason is in the body.
          throw new Error(
            (await functionErrorReason(invokeError)) || invokeError.message,
          );
        }

        if (!data.success) {
          throw new Error(data.error || "Failed to create order");
        }

        return data as CreateOrderResponse;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to create order";
        setError(errorMessage);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const verifyPayment = useCallback(
    async (params: VerifyPaymentParams): Promise<boolean> => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: invokeError } = await supabase.functions.invoke(
          "verify-razorpay-payment",
          {
            body: params,
          },
        );

        if (invokeError) {
          // supabase-js only says "non-2xx"; the real reason is in the body.
          throw new Error(
            (await functionErrorReason(invokeError)) || invokeError.message,
          );
        }

        if (!data.success) {
          throw new Error(data.error || "Payment verification failed");
        }

        return true;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Payment verification failed";
        setError(errorMessage);
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const openCheckout = useCallback(
    async (
      orderData: CreateOrderResponse,
      prefillData: { name: string; email: string; phone: string },
      onSuccess: (response: RazorpayResponse) => void,
      onDismiss?: () => void,
    ): Promise<void> => {
      const scriptLoaded = await loadRazorpayScript();

      if (!scriptLoaded) {
        setError("Failed to load Razorpay SDK");
        return;
      }

      const options: RazorpayOptions = {
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Inlane",
        description: "Course Payment",
        order_id: orderData.orderId,
        prefill: {
          name: prefillData.name,
          email: prefillData.email,
          contact: prefillData.phone,
        },
        theme: {
          color: "#3B82F6",
        },
        handler: onSuccess,
        modal: {
          ondismiss: onDismiss,
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    },
    [loadRazorpayScript],
  );

  return {
    isLoading,
    error,
    createOrder,
    verifyPayment,
    openCheckout,
    setError,
  };
}
