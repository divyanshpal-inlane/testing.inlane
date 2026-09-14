import { useNavigate } from "react-router-dom";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type InstructorInReview,
  getReviewStageMeta,
  getReviewStatusMeta,
} from "@/queries/instructorReview";

interface ReviewInstructorCardProps {
  instructor: InstructorInReview;
}

export function ReviewInstructorCard({
  instructor,
}: ReviewInstructorCardProps) {
  const navigate = useNavigate();
  const stageMeta = getReviewStageMeta(instructor.stage);
  const statusMeta = getReviewStatusMeta(instructor.status);

  // Format the applied date to show relative time like "2d ago", "6h ago"
  let appliedDate = "";
  try {
    const parsedDate = parseISO(instructor.applied_at);
    appliedDate = formatDistanceToNow(parsedDate, { addSuffix: true }).replace(
      "about ",
      "",
    );
  } catch (e) {
    appliedDate = "Recently";
  }

  // Calculate progress percentage and color dynamically
  const getProgressData = () => {
    if (instructor.stage === "stage1_documents") {
      const MAX_DOCUMENTS = 5;
      // Cap the reviewed count at MAX_DOCUMENTS (in case backend has more)
      const current = Math.min(instructor.progress.documents_reviewed || 0, MAX_DOCUMENTS);
      const total = MAX_DOCUMENTS;
      const percentage = (current / total) * 100;

      return { current, total, percentage, label: "docs" };
    } else if (instructor.stage === "stage2_pedal_video") {
      const current = instructor.progress.video_status === "pending" ? 0 : 1;
      const total = 1;
      const percentage = (current / total) * 100;

      return { current, total, percentage, label: "video" };
    }
    return { current: 0, total: 0, percentage: 0, label: "" };
  };

  const getProgressBarColor = (percentage: number) => {
    if (percentage <= 25) return "#EF4444"; // Red - Not started/Very low (0-25%)
    if (percentage > 25 && percentage <= 75) return "#F97316"; // Orange - In progress (26-75%)
    if (percentage > 75 && percentage < 100) return "#86EFAC"; // Light Green - Almost done (76-99%)
    if (percentage === 100) return "#10B981"; // Green - Complete (100%)
    return "#EF4444";
  };

  // Dynamically determine status based on progress percentage
  const getDynamicStatus = (percentage: number) => {
    if (percentage === 100) return "approved"; // 100% completion = Approved
    if (percentage <= 25) return "rejected"; // ≤25% = Rejected (not enough progress)
    return "awaiting_review"; // 26-99% = Awaiting review
  };

  const progressData = getProgressData();
  const barColor = getProgressBarColor(progressData.percentage);
  const dynamicStatus = getDynamicStatus(progressData.percentage);

  return (
    <Card className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {/* Card Content */}
      <CardContent className="flex flex-1 flex-col space-y-3 p-4">
        {/* Header: Avatar + Name + Badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {/* Light Green Avatar */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700">
              {instructor.initials}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-gray-900">
                {instructor.name}
              </h3>
              <p className="text-xs text-gray-500">{instructor.phone}</p>
            </div>
          </div>
          {/* Review Stage Badge - Right aligned */}
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
              stageMeta.badgeClass,
            )}
          >
            {stageMeta.label}
          </span>
        </div>

        {/* Applied Date & Progress */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-500">APPLIED</span>
            <span className="font-medium text-gray-700">{appliedDate}</span>
          </div>

          {/* Progress Information - Unified for both stages */}
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-gray-500">PROGRESS</span>
            <div className="flex flex-1 items-center gap-2">
              {/* Dynamic Progress Bar - Width matches percentage */}
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div
                  style={{
                    width: `${progressData.percentage}%`,
                    backgroundColor: barColor,
                    transition: "all 0.3s ease", // Smooth animation
                  }}
                  className="h-full rounded-full"
                />
              </div>
              <span className="text-right font-medium text-gray-600">
                {progressData.current}/{progressData.total} {progressData.label}
              </span>
            </div>
          </div>
        </div>

        {/* Status Text - Centered */}
        <div className="flex justify-center pt-3">
          <span className={cn("text-xs font-medium", getReviewStatusMeta(dynamicStatus).badge_class)}>
            {getReviewStatusMeta(dynamicStatus).label}
          </span>
        </div>

        {/* Action Button - With more spacing and rounded corners */}
        <div className="flex flex-1 items-end pt-3">
          <Button 
            onClick={() => navigate(`/admin/instructor-approval/${instructor.instructor_id}`)}
            className="w-full rounded-full bg-primary text-primary-foreground py-2 font-semibold transition-colors hover:bg-primary/90"
          >
            Review application
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
