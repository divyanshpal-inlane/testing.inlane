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
  const isStage1 =
    instructor.stage === "documents" || instructor.stage === "stage1_documents";
  const isStage2 =
    instructor.stage === "pedal_videos" ||
    instructor.stage === "stage2_pedal_video";

  // Format the applied date using waiting_days from backend
  // If waiting_days is available, use it; otherwise fallback to date calculation
  let appliedDate = "";
  if (instructor.waiting_days !== undefined) {
    appliedDate =
      instructor.waiting_days === 0
        ? "Today"
        : `${instructor.waiting_days}d ago`;
  } else {
    try {
      const parsedDate = parseISO(instructor.applied_at);
      appliedDate = formatDistanceToNow(parsedDate, {
        addSuffix: true,
      }).replace("about ", "");
    } catch (e) {
      appliedDate = "Recently";
    }
  }

  // Calculate progress percentage from real API data
  const getProgressData = () => {
    // Handle backend stage names (documents, pedal_videos) and frontend names (stage1_documents, stage2_pedal_video)
    const isDocumentsStage =
      instructor.stage === "documents" ||
      instructor.stage === "stage1_documents";
    const isPedalVideoStage =
      instructor.stage === "pedal_videos" ||
      instructor.stage === "stage2_pedal_video";

    if (isDocumentsStage) {
      // Backend rule: Instructor must upload ALL 5 documents at once
      // So progress is either 0/5 (nothing uploaded) or 5/5 (all uploaded)

      const total = instructor.documents?.total || 5;
      const approved = instructor.documents?.approved || 0;
      const rejected = instructor.documents?.rejected || 0;
      const pending = instructor.documents?.pending || 0;

      // If ANY documents exist, it means all 5 have been uploaded
      const hasUploadedDocs = approved + rejected + pending > 0;
      const uploaded = hasUploadedDocs ? total : 0;

      // Percentage: Either 0% (nothing) or 100% (all uploaded)
      const percentage = hasUploadedDocs ? 100 : 0;

      return { current: uploaded, total, percentage, label: "docs" };
    } else if (isPedalVideoStage) {
      // For pedal video stage, show 0/1 if pending, 1/1 if uploaded
      const isUploaded = instructor.pedal_video?.status === "uploaded";
      const current = isUploaded ? 1 : 0;
      const total = 1;
      const percentage = (current / total) * 100;

      return { current, total, percentage, label: "video" };
    }
    return { current: 0, total: 0, percentage: 0, label: "" };
  };

  const getProgressBarColor = (percentage: number) => {
    // Since instructors upload all 5 docs at once, progress is either 0% or 100%
    if (percentage === 0) return "#EF4444"; // Red - No documents uploaded yet
    if (percentage === 100) return "#10B981"; // Green - All documents uploaded
    return "#EF4444"; // Default to red
  };

  const progressData = getProgressData();
  const barColor = getProgressBarColor(progressData.percentage);

  // Use actual status from API instead of deriving from percentage
  // API returns: "pending", "active", or "rejected"
  // These are mapped by getReviewStatusMeta to display labels
  const displayStatus = instructor.status;

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

        {/* Status Text - Centered - Using actual API status */}
        <div className="flex justify-center pt-3">
          <span
            className={cn(
              "text-xs font-medium",
              getReviewStatusMeta(displayStatus).badge_class,
            )}
          >
            {getReviewStatusMeta(displayStatus).label}
          </span>
        </div>

        {/* Action Button - With more spacing and rounded corners */}
        <div className="flex flex-1 items-end pt-3">
          <Button
            onClick={() => {
              // Route based on stage - both lead to instructor-approval but page detects stage
              navigate(
                `/admin/instructor-approval/${instructor.id || instructor.instructor_id}?stage=${isStage1 ? "stage1_documents" : "stage2_pedal_video"}`,
              );
            }}
            className="w-full rounded-full bg-primary py-2 font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Review application
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
