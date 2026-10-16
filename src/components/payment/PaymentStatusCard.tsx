import { AlertCircle, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_COURSE } from "@/constants/courses";
import { useLearner } from "@/queries/learner";
import { usePaymentsByLearner } from "@/queries/payment";

function PaymentStatusCard() {
  const navigate = useNavigate();
  const { data: learner, isLoading: learnerLoading } = useLearner();

  // Fetch all payments for the learner
  const { data: payments, isLoading: paymentsLoading } = usePaymentsByLearner(
    learner?.id,
  );

  // Find the latest completed payment (course, custom, or demo)
  const completedPayment = Array.isArray(payments)
    ? payments
        .filter(
          (payment: { payment_type: string; status: string }) =>
            ["course", "custom", "demo"].includes(payment.payment_type) &&
            payment.status === "completed",
        )
        .sort(
          (a: { created_at: string }, b: { created_at: string }) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]
    : null;

  // NEW: Find any payment that is in "pending" status (verification in progress)
  const pendingVerificationPayment = Array.isArray(payments)
    ? payments
        .filter(
          (payment: { payment_type: string; status: string }) =>
            payment.status === "pending",
        )
        .sort(
          (a: { created_at: string }, b: { created_at: string }) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]
    : null;

  const pendingPayment = Array.isArray(payments)
    ? payments
        .filter(
          (payment: { payment_type: string; status: string }) =>
            ["demo", "topup"].includes(payment.payment_type) &&
            payment.status !== "completed",
        )
        .sort(
          (a: { created_at: string }, b: { created_at: string }) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0]
    : null;

  const buildPaymentUrl = () => {
    const base = `/payment?phone=${learner?.phone}`;
    if (!pendingPayment) return base;
    if (pendingPayment.payment_type === "demo") return `${base}&type=demo`;
    if (pendingPayment.payment_type === "topup") {
      const hours = Math.max(
        1,
        Math.round(
          (pendingPayment.amount || DEMO_COURSE.price) / DEMO_COURSE.price,
        ),
      );
      return `${base}&type=topup&hours=${hours}`;
    }
    return base;
  };

  if (learnerLoading || paymentsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Loading...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (!payments) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-yellow-500" />
            Payment Required
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-gray-500">
            Please complete the payment to access your account.
          </p>
          <Button
            onClick={() => navigate(buildPaymentUrl())}
            className="w-full"
            disabled={!learner?.phone}
          >
            Make Payment
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isCompleted =
    completedPayment && completedPayment?.status === "completed";

  // Priority 1: Show payment verification in progress message
  if (pendingVerificationPayment) {
    return (
      <Card className="border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-6 w-6 animate-pulse text-blue-500" />
            Payment Verification in Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              We have received your payment and it is currently being verified.
              This usually takes a few minutes.
            </p>
            <div className="space-y-2 rounded-md bg-white p-3">
              <div>
                <p className="text-xs text-gray-500">Amount</p>
                <p className="font-medium">
                  ₹{pendingVerificationPayment.amount}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Type</p>
                <p className="font-medium capitalize">
                  {pendingVerificationPayment.payment_type}
                </p>
              </div>
              {pendingVerificationPayment.gateway_reference && (
                <div>
                  <p className="text-xs text-gray-500">Reference Number</p>
                  <p className="font-medium">
                    {pendingVerificationPayment.gateway_reference}
                  </p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <RefreshCw className="h-4 w-4" />
              <span>
                Please refresh this page in a few minutes or contact support if
                verification takes longer than expected.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Priority 2: If no completed course payment, show "Choose a Course" prompt
  if (!isCompleted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-yellow-500" />
            Payment Pending
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-gray-500">
            Please choose a course and complete payment to get started.
          </p>
          <Button
            onClick={() => navigate(buildPaymentUrl())}
            className="w-full"
            disabled={!learner?.phone}
          >
            Choose a Course
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-6 w-6 text-green-500" />
          Payment Completed
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-500">Amount</p>
            <p className="font-medium">₹{completedPayment.amount}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Type</p>
            <p className="font-medium capitalize">
              {completedPayment.payment_type}
            </p>
          </div>
          {completedPayment.gateway_reference && (
            <div>
              <p className="text-sm text-gray-500">Reference Number</p>
              <p className="font-medium">
                {completedPayment.gateway_reference}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default PaymentStatusCard;
