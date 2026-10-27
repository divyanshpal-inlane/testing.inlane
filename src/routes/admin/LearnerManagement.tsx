import { UserPlus } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  CreatedLearnerInfo,
  CreateLearnerDialog,
} from "@/components/admin/learner/CreateLearnerDialog";
import { ExistingCustomerCard } from "@/components/admin/learner/ExistingCustomerCard";
import { sendPaymentLink } from "@/components/admin/learner/sendPaymentLink";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

import { HalfPaidTracker } from "./HalfPaidTracker";
import { IncompletePaymentsCard } from "./IncompletePaymentsCard";

export default function LearnerManagement() {
  const [isCreateLearnerDialogOpen, setIsCreateLearnerDialogOpen] =
    useState(false);
  // The learner that was just created, kept for the payment-link dialog.
  const [createdLearner, setCreatedLearner] =
    useState<CreatedLearnerInfo | null>(null);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const dispatchPaymentLink = async (info: CreatedLearnerInfo) => {
    if (!info.enrollmentId) return;
    // Close the payment dialog if it's open (for newly created learners)
    setIsPaymentDialogOpen(false);
    await sendPaymentLink(
      {
        id: info.learnerId,
        name: info.name,
        email: info.email,
        phone: info.phone,
      },
      { name: info.courseName, duration: info.totalLessons },
      info.paymentAmount,
      info.enrollmentId,
      toast,
      info.courseType,
    );
  };

  const handleLearnerCreated = (info: CreatedLearnerInfo) => {
    setCreatedLearner(info);

    // The existing payment page understands course/demo/custom enrollments
    // only. Never send a partial course-only payment for an RTO case.
    if (info.enrollmentId && info.caseType === "classes_only") {
      setIsPaymentDialogOpen(true);

      // Auto-dispatch the payment link immediately so the learner doesn't wait
      // on the admin to click a button. Dialog still opens as an acknowledgement
      // + gives admin a "resend" path if needed.
      dispatchPaymentLink(info).catch((err) => {
        console.error("Auto payment link dispatch failed:", err);
      });
    }
  };

  return (
    <div
      className="min-h-screen bg-white p-8"
      style={{
        backgroundImage: 'url("/assets/bg_pattern.svg")',
        backgroundRepeat: "repeat",
        backgroundSize: "cover",
        backgroundAttachment: "fixed", // This prevents the background from getting cut off
      }}
    >
      <div className="container mx-auto">
        <div className="mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
            className="h-10 w-10"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-4xl font-bold tracking-tight">
            Learner Management
          </h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Create learners and manage enrollments
          </p>
        </div>

        <div className="grid gap-6">
          {/* Card for Creating Learner */}
          <Card className="transition-all hover:shadow-lg">
            <CardHeader>
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-gray-100 p-2 text-green-500">
                  <UserPlus size={24} />
                </div>
                <div>
                  <CardTitle className="text-xl">Create Learner</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => setIsCreateLearnerDialogOpen(true)}
              >
                Create New Learner
              </Button>
            </CardContent>
          </Card>

          {/* Existing customers: another course / top-up / Payment IDs */}
          <ExistingCustomerCard />

          {/* Incomplete Payments Card */}
          <IncompletePaymentsCard />

          {/* 50% Payment Tracker */}
          <HalfPaidTracker />

          {/* Dialog for Creating Learner (shared with the Sales Dashboard) */}
          <CreateLearnerDialog
            open={isCreateLearnerDialogOpen}
            onOpenChange={setIsCreateLearnerDialogOpen}
            onCreated={handleLearnerCreated}
          />

          {/* Dialog for Sending Payment Link */}
          <Dialog
            open={isPaymentDialogOpen}
            onOpenChange={setIsPaymentDialogOpen}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Payment Link</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <p>
                  Learner <strong>{createdLearner?.name}</strong> has been
                  created successfully. Would you like to send the payment link
                  now?
                </p>
                <Button
                  onClick={() => {
                    if (createdLearner)
                      void dispatchPaymentLink(createdLearner);
                  }}
                  disabled={!createdLearner?.enrollmentId}
                >
                  Send Payment Link
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
