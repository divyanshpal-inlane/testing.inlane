import type { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";

import type { CourseType } from "./CreateLearnerDialog";

export interface PaymentLinkLearner {
  id: string | null;
  name: string;
  email: string;
  phone: string;
}

export interface PaymentLinkCourse {
  name: string;
  duration: number;
}

type Toast = ReturnType<typeof useToast>["toast"];

/**
 * Sends a learner their payment link by e-mail (`send-payment-link-email`) and
 * WhatsApp (`send-message`, PAYMENT_LINK). Moved out of Learner Management so
 * the Sales Dashboard sends it through exactly the same calls.
 */
export async function sendPaymentLink(
  learner: PaymentLinkLearner,
  course: PaymentLinkCourse,
  amount: number,
  enrollmentId: string,
  toast: Toast,
  linkCourseType?: CourseType,
): Promise<void> {
  try {
    const typeParam = linkCourseType === "demo" ? "&type=demo" : "";
    const paymentLink = `https://inlane-web-app.vercel.app/payment?phone=${learner.phone}${typeParam}`;

    // Define the request body for email trigger.
    const bodyData = {
      learnerEmail: learner?.email,
      learnerName: learner?.name,
      course: course?.name,
      amount: amount,
      paymentLink: paymentLink,
    };

    const { error: invokeError } = await supabase.functions.invoke(
      "send-payment-link-email",
      {
        body: bodyData,
      },
    );
    if (invokeError) {
      console.error(invokeError);
      toast({
        title: "Failed to send email",
        description: `Failed to send link sent to ${learner?.email}`,
      });
    } else {
      toast({
        title: "Success",
        description: `Payment link sent to ${learner?.email} successfully!`,
      });
    }

    const { error } = await supabase.functions.invoke("send-message", {
      body: {
        message_type: "PAYMENT_LINK",
        learner_id: learner.id,
        enrollment_id: enrollmentId, // Include enrollment ID for tracking
        course_name: course.name,
        payment_amount: amount,
        duration: course.duration,
        payment_link: paymentLink,
      },
    });

    if (error) throw error;

    toast({
      title: "Success",
      description: `Payment link sent to ${learner.name} successfully!`,
    });
  } catch (err) {
    toast({
      title: "Error",
      description:
        err instanceof Error ? err.message : "Failed to send payment link",
      variant: "destructive",
    });
  }
}
