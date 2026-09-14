import { useQuery } from "@tanstack/react-query";

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
 * This data will come from Go backend API later
 */
export interface InstructorInReview {
  id: string;
  instructor_id: string;
  name: string;
  phone: string;
  initials: string;
  avatar_bg_color: string;
  stage: ReviewStage;
  applied_at: string;
  progress: ReviewProgress;
  status: ReviewStatus;
}

/**
 * Mock data generator - Replace with Go API call later
 * When integrating Go API, replace the queryFn with actual API endpoint
 */
const generateMockReviewData = (): InstructorInReview[] => {
  // Mock data for testing - Replace with actual Go API call later
  // const response = await fetch(`${BACKEND_API}/v1/instructors/review`, {
  //   headers: { "Authorization": `Bearer ${token}` }
  // });
  // return response.json();
  
  return [
    {
      id: "1",
      instructor_id: "instr_001",
      name: "Rajesh Kumar",
      phone: "+91 98765 43210",
      initials: "RK",
      avatar_bg_color: "#a855f7",
      stage: "stage1_documents",
      applied_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      progress: {
        documents_reviewed: 1,
        documents_total: 5,
        video_status: undefined,
      },
      status: "awaiting_review",
    },
    {
      id: "2",
      instructor_id: "instr_002",
      name: "Priya Singh",
      phone: "+91 90001 23456",
      initials: "PS",
      avatar_bg_color: "#06b6d4",
      stage: "stage1_documents",
      applied_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      progress: {
        documents_reviewed: 4,
        documents_total: 5,
        video_status: undefined,
      },
      status: "approved",
    },
    {
      id: "3",
      instructor_id: "instr_003",
      name: "Amit Patel",
      phone: "+91 88765 54321",
      initials: "AP",
      avatar_bg_color: "#ec4899",
      stage: "stage2_pedal_video",
      applied_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      progress: {
        documents_reviewed: undefined,
        documents_total: undefined,
        video_status: "uploaded",
      },
      status: "awaiting_review",
    },
    {
      id: "4",
      instructor_id: "instr_004",
      name: "Neha Gupta",
      phone: "+91 99887 66543",
      initials: "NG",
      avatar_bg_color: "#f59e0b",
      stage: "stage2_pedal_video",
      applied_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      progress: {
        documents_reviewed: undefined,
        documents_total: undefined,
        video_status: "reviewed",
      },
      status: "approved",
    },
    {
      id: "5",
      instructor_id: "instr_005",
      name: "Vikram Sharma",
      phone: "+91 87654 32109",
      initials: "VS",
      avatar_bg_color: "#8b5cf6",
      stage: "stage1_documents",
      applied_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      progress: {
        documents_reviewed: 5,
        documents_total: 5,
        video_status: undefined,
      },
      status: "rejected",
    },
  ];
};

/**
 * Hook to fetch instructors in review stage
 * Returns instructors awaiting document or video review
 * 
 * Usage:
 * const { data: reviewInstructors, isLoading } = useReviewInstructors();
 * 
 * Future API Integration:
 * - Replace generateMockReviewData() with actual Go API endpoint
 * - Add filters like: useReviewInstructors(stage?: ReviewStage)
 */
export const useReviewInstructors = () => {
  return useQuery({
    queryKey: ["review-instructors"],
    queryFn: async () => {
      // PLACEHOLDER: This will be replaced with Go API call
      // const token = localStorage.getItem("go_access_token");
      // const response = await fetch(`${BACKEND_API}/v1/instructors/review`, {
      //   headers: { "Authorization": `Bearer ${token}` }
      // });
      // if (!response.ok) throw new Error("Failed to fetch review instructors");
      // return response.json();

      return generateMockReviewData();
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

/**
 * Get metadata for review stage (for UI labels, colors, etc.)
 */
export const getReviewStageMeta = (stage: ReviewStage) => {
  const stageMap: Record<
    ReviewStage,
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
  };
  return stageMap[stage];
};

/**
 * Get metadata for review status
 */
export const getReviewStatusMeta = (status: ReviewStatus) => {
  const statusMap: Record<
    ReviewStatus,
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
  };
  return statusMap[status];
};
