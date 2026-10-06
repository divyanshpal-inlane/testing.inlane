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

/**
 * Generate a consistent avatar background color based on instructor name
 * Uses the avatar_bg_color from API if available, otherwise generates from initials
 */
const getAvatarColor = (instructor: InstructorInReview): string => {
  // If backend provides avatar_bg_color, use it
  if (instructor.avatar_bg_color) {
    return instructor.avatar_bg_color;
  }

  // Always use light emerald green for all avatars
  return "#10b981"; // Light emerald green
};

/**
 * Generate initials from instructor name
 * e.g., "Demo Lane" -> "DL", "John Doe Smith" -> "JD"
 */
const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

export function ReviewInstructorCard({
  instructor,
}: ReviewInstructorCardProps) {
  const navigate = useNavigate();
  const stageMeta = getReviewStageMeta(instructor.stage);
  const statusMeta = getReviewStatusMeta(instructor.status);
  
  // Determine if this is a stage 1 or stage 2 instructor
  const isStage1 = instructor.stage === "documents" || instructor.stage === "stage1_documents";
  const isStage2 = instructor.stage === "pedal_videos" || instructor.stage === "stage2_pedal_video";

  // Format the applied date using waiting_days from backend
  // If waiting_days is available, use it; otherwise fallback to date calculation
  let appliedDate = "";
  if (instructor.waiting_days !== undefined) {
    appliedDate = instructor.waiting_days === 0 
      ? "Today" 
      : `${instructor.waiting_days}d ago`;
  } else {
    try {
      const parsedDate = parseISO(instructor.applied_at);
      appliedDate = formatDistanceToNow(parsedDate, { addSuffix: true }).replace(
        "about ",
        "",
      );
    } catch (e) {
      appliedDate = "Recently";
    }
  }

  // Calculate progress percentage and color dynamically
  const getProgressData = () => {
    // Handle backend stage names (documents, pedal_videos) and frontend names (stage1_documents, stage2_pedal_video)
    const isDocumentsStage = instructor.stage === "documents" || instructor.stage === "stage1_documents";
    const isPedalVideoStage = instructor.stage === "pedal_videos" || instructor.stage === "stage2_pedal_video";

    if (isDocumentsStage) {
      // Use documents data from backend if available, otherwise fallback to progress
      const total = instructor.documents?.total || instructor.progress?.documents_total || 5;
      const current = instructor.documents?.approved || instructor.progress?.documents_reviewed || 0;
      const percentage = total > 0 ? (current / total) * 100 : 0;

      return { current, total, percentage, label: "docs" };
    } else if (isPedalVideoStage) {
      // Use pedal_video data from backend if available, otherwise fallback to progress
      const isUploaded = instructor.pedal_video?.status === "uploaded" || instructor.progress?.video_status === "uploaded";
      const current = isUploaded ? 1 : 0;
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
            {/* Avatar with light green background and dark green initials */}
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{
                backgroundColor: "#DDF8EF", // Light green/teal background
                color: "#00CE84", // Dark green text
              }}
            >
              {instructor.initials || getInitials(instructor.name)}
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
            onClick={() => {
              // Route based on stage - both lead to instructor-approval but page detects stage
              navigate(`/admin/instructor-approval/${instructor.instructor_id}?stage=${isStage1 ? "stage1_documents" : "stage2_pedal_video"}`);
            }}
            className="w-full rounded-full bg-primary text-primary-foreground py-2 font-semibold transition-colors hover:bg-primary/90"
          >
            Review application
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
