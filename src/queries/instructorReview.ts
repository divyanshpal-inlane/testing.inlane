import { useQuery } from "@tanstack/react-query";

// Backend API configuration
// In dev: Vite proxy rewrites /go-api/* → http://localhost:8080/v1/*
// In prod: Set VITE_BACKEND_API to the real Go service URL (e.g. https://api.inlane.in/v1)
const BACKEND_API =
  import.meta.env.VITE_BACKEND_API || "/go-api";

/**
 * Review stage for instructor onboarding
 * stage1_documents: Instructor is in document review stage
 * stage2_pedal_video: Instructor is in pedal video review stage
 */
export type ReviewStage = "stage1_documents" | "stage2_pedal_video";

/**
 * Review status for an instructor
 */
export type ReviewStatus = "awaiting_review" | "approved" | "rejected";

/**
 * Progress tracking for review stages
 */
export interface ReviewProgress {
  documents_reviewed?: number;
  documents_total?: number;
  video_status?: "pending" | "uploaded" | "reviewed";
}

/**
 * Instructor in review stage
 * Data comes from Go backend API
 */
export interface InstructorInReview {
  id: string;
  instructor_id?: string;
  name: string;
  phone: string;
  email?: string;
  initials?: string;
  avatar_bg_color?: string;
  stage: "documents" | "pedal_videos" | ReviewStage;
  applied_at: string;
  waiting_days?: number;
  progress?: ReviewProgress;
  documents?: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  };
  pedal_video?: {
    status: "uploaded" | null;
    uploaded_at: string | null;
  } | null;
  status: ReviewStatus | "pending" | "active";
}




/**
 * Hook to fetch instructors in review stage from backend API with authentication
 * Returns instructors awaiting document or video review with counts
 * 
 * Usage:
 * const { data: reviewResponse, isLoading } = useReviewInstructors("all");
 * const instructors = reviewResponse?.instructors || [];
 * const counts = reviewResponse?.counts || { all: 0, documents: 0, pedal_videos: 0 };
 */
export const useReviewInstructors = (stage: "all" | "documents" | "pedal_videos" = "all") => {
  return useQuery({
    queryKey: ["review-instructors", stage],
    queryFn: async () => {
      try {
        // Get Go access token from localStorage
        const goAccessToken = localStorage.getItem("go_access_token");
        
        if (!goAccessToken) {
          throw new Error("No Go access token found. Please login again.");
        }

        // Call Go backend API with the correct stage parameter
        console.log(`[REVIEW API] Fetching instructors for stage: ${stage}`);
        
        const response = await fetch(
          `${BACKEND_API}/admin/instructors/review?stage=${stage}`,
          {
            method: "GET",
            headers: {
              "Authorization": `Bearer ${goAccessToken}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log(`[REVIEW API] ✅ Successfully fetched ${data.instructors?.length || 0} instructors for stage: ${stage}`);
        console.log("[REVIEW API] Response data:", data);
        
        return {
          counts: data.counts || {
            all: data.instructors?.length || 0,
            documents: data.instructors?.filter((i: InstructorInReview) => i.stage === "stage1_documents" || i.stage === "documents").length || 0,
            pedal_videos: data.instructors?.filter((i: InstructorInReview) => i.stage === "stage2_pedal_video" || i.stage === "pedal_videos").length || 0,
          },
          instructors: data.instructors || [],
        };
      } catch (error) {
        console.error("[REVIEW API] ❌ Error fetching from Go backend:", error);
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
};


/**
 * Get metadata for review stage (for UI labels, colors, etc.)
 * Handles both backend names (documents, pedal_videos) and frontend names (stage1_documents, stage2_pedal_video)
 */
export const getReviewStageMeta = (stage: ReviewStage | "documents" | "pedal_videos") => {
  const stageMap: Record<
    string,
    {
      label: string;
      badgeClass: string;
      dotClass: string;
    }
  > = {
    stage1_documents: {
      label: "Stage 1: Documents",
      badgeClass: "bg-red-100 text-red-700",
      dotClass: "bg-red-500",
    },
    stage2_pedal_video: {
      label: "Stage 2: Pedal video",
      badgeClass: "bg-purple-100 text-purple-700",
      dotClass: "bg-purple-500",
    },
    // Backend stage names
    documents: {
      label: "Stage 1: Documents",
      badgeClass: "bg-red-100 text-red-700",
      dotClass: "bg-red-500",
    },
    pedal_videos: {
      label: "Stage 2: Pedal video",
      badgeClass: "bg-purple-100 text-purple-700",
      dotClass: "bg-purple-500",
    },
  };
  return stageMap[stage] || stageMap.stage1_documents;
};

/**
 * Get metadata for review status
 * Handles both backend names (pending, active, rejected) and frontend names (awaiting_review, approved, rejected)
 */
export const getReviewStatusMeta = (status: ReviewStatus | "pending" | "active") => {
  const statusMap: Record<
    string,
    {
      label: string;
      badge_class: string;
    }
  > = {
    awaiting_review: {
      label: "Awaiting review",
      badge_class: "text-gray-500",
    },
    approved: {
      label: "Approved",
      badge_class: "text-green-600 font-semibold",
    },
    rejected: {
      label: "Rejected",
      badge_class: "text-red-600 font-semibold",
    },
    // Backend status names
    pending: {
      label: "Awaiting review",
      badge_class: "text-gray-500",
    },
    active: {
      label: "Approved",
      badge_class: "text-green-600 font-semibold",
    },
  };
  return statusMap[status] || statusMap.awaiting_review;
};
