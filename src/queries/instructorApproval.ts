/**
 * Instructor Approval - Types and Mock Data
 * Handles document review and instructor approval workflow
 */

export type DocumentType = "pan_card" | "aadhar" | "vehicle_rc" | "insurance" | "puc_certificate";
export type DocumentSide = "front" | "back";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ReviewStage = "stage1_documents" | "stage2_pedal_video";
export type VideoViewMode = "front" | "close" | "wide";

export interface DocumentFile {
  id: string;
  type: DocumentType;
  side: DocumentSide;
  url: string;
  uploadedAt: string;
}

export interface DocumentReview {
  id: string;
  type: DocumentType;
  number: string;
  pages: number;
  status: ApprovalStatus;
  sides: {
    front?: DocumentFile;
    back?: DocumentFile;
  };
  rejectionReason?: string;
  rejectionMessage?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface VerificationItem {
  id: string;
  text: string;
  verified: boolean;
}

export interface PedalVideo {
  id: string;
  title: string;
  duration: string;
  uploadedAt: string;
  angles: number;
  url: string;
  status: ApprovalStatus;
  rejectionReason?: string;
  rejectionMessage?: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface InstructorApprovalDetail {
  id: string;
  instructor_id: string;
  name: string;
  phone: string;
  initials: string;
  avatar_bg_color: string;
  applied_at: string;
  stage: ReviewStage;
  documents: DocumentReview[];
  videos?: PedalVideo[];
  verificationChecklist?: VerificationItem[];
  approvedCount: number;
  totalCount: number;
  rejectionNote?: string;
  lastVideoUploadedAt?: string;
}

export interface DocumentViewerState {
  selectedDocumentType: DocumentType | null;
  selectedSide: DocumentSide;
  zoomLevel: number;
}

/**
 * Rejection Reasons - Predefined reasons for document rejection
 */
export interface RejectionReason {
  id: string;
  label: string;
  backendTag: string;
}

export const REJECTION_REASONS: RejectionReason[] = [
  {
    id: "legibility",
    label: "Document not eligible",
    backendTag: "eligible",
  },
  {
    id: "expired",
    label: "Document expired",
    backendTag: "expired",
  },
  {
    id: "mismatch",
    label: "Details do not match",
    backendTag: "details_mismatch",
  },
  {
    id: "wrong_document",
    label: "Wrong document uploaded",
    backendTag: "wrong_document",
  },
  {
    id: "missing",
    label: "Front / back missing",
    backendTag: "missing_side",
  },
  {
    id: "other",
    label: "Other (add note)",
    backendTag: "other",
  },
];

/**
 * Rejection Reasons for Pedal Video - Predefined reasons for video rejection
 */
export const PEDAL_VIDEO_REJECTION_REASONS: RejectionReason[] = [
  {
    id: "footage_too_dark",
    label: "Footage too dark",
    backendTag: "too_dark",
  },
  {
    id: "pedal_not_visible",
    label: "Pedal/linkage not visible",
    backendTag: "pedal_not_visible",
  },
  {
    id: "vehicle_mismatch",
    label: "Vehicle does not match RC",
    backendTag: "vehicle_mismatch",
  },
  {
    id: "angle_missing",
    label: "Required angle missing",
    backendTag: "angle_missing",
  },
  {
    id: "other_video",
    label: "Other (add note)",
    backendTag: "other",
  },
];

/**
 * Mock data generator - Replace with Go API call later
 */
export const generateMockApprovalData = (): InstructorApprovalDetail[] => {
  return [
    {
      id: "approval_1",
      instructor_id: "instr_001",
      name: "Rajesh Kumar",
      phone: "+91 98765 43210",
      initials: "RK",
      avatar_bg_color: "#a855f7",
      applied_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      stage: "stage1_documents",
      approvedCount: 4,
      totalCount: 5,
      rejectionNote: "1 rejected - instructor notified to re-upload",
      documents: [
        {
          id: "doc_1",
          type: "pan_card",
          number: "ABCD1234F",
          pages: 1,
          status: "approved",
          sides: {
            front: {
              id: "file_1_front",
              type: "pan_card",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=PAN+Card+Front",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
            back: {
              id: "file_1_back",
              type: "pan_card",
              side: "back",
              url: "https://via.placeholder.com/500x300?text=PAN+Card+Back",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "doc_2",
          type: "aadhar",
          number: "XXXX XXXX 8542",
          pages: 2,
          status: "approved",
          sides: {
            front: {
              id: "file_2_front",
              type: "aadhar",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=Aadhar+Front",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
            back: {
              id: "file_2_back",
              type: "aadhar",
              side: "back",
              url: "https://via.placeholder.com/500x300?text=Aadhar+Back",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },

        {
          id: "doc_4",
          type: "vehicle_rc",
          number: "MH02 CD 4471",
          pages: 1,
          status: "approved",
          sides: {
            front: {
              id: "file_4_front",
              type: "vehicle_rc",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=RC+Front",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
            back: {
              id: "file_4_back",
              type: "vehicle_rc",
              side: "back",
              url: "https://via.placeholder.com/500x300?text=RC+Back",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "doc_5",
          type: "insurance",
          number: "exp 03 Mar 2027",
          pages: 1,
          status: "rejected",
          sides: {
            front: {
              id: "file_5_front",
              type: "insurance",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=Insurance",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          rejectionReason: "Document expired",
          rejectedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "doc_6",
          type: "puc_certificate",
          number: "exp 11 Jan 2027",
          pages: 1,
          status: "approved",
          sides: {
            front: {
              id: "file_6_front",
              type: "puc_certificate",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=PUC+Certificate",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    },
    {
      id: "approval_2",
      instructor_id: "instr_002",
      name: "Priya Singh",
      phone: "+91 90001 23456",
      initials: "PS",
      avatar_bg_color: "#06b6d4",
      applied_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      stage: "stage1_documents",
      approvedCount: 6,
      totalCount: 5,
      documents: [
        {
          id: "doc_7",
          type: "pan_card",
          number: "ABCD1234F",
          pages: 1,
          status: "approved",
          sides: {
            front: {
              id: "file_7_front",
              type: "pan_card",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=PAN+Card+Front",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "doc_8",
          type: "aadhar",
          number: "XXXX XXXX 8542",
          pages: 2,
          status: "approved",
          sides: {
            front: {
              id: "file_8_front",
              type: "aadhar",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=Aadhar+Front",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
            back: {
              id: "file_8_back",
              type: "aadhar",
              side: "back",
              url: "https://via.placeholder.com/500x300?text=Aadhar+Back",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },

        {
          id: "doc_10",
          type: "vehicle_rc",
          number: "GJ05AB1234",
          pages: 2,
          status: "approved",
          sides: {
            front: {
              id: "file_10_front",
              type: "vehicle_rc",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=RC+Front",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
            back: {
              id: "file_10_back",
              type: "vehicle_rc",
              side: "back",
              url: "https://via.placeholder.com/500x300?text=RC+Back",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "doc_11",
          type: "insurance",
          number: "exp 03 Mar 2027",
          pages: 1,
          status: "approved",
          sides: {
            front: {
              id: "file_11_front",
              type: "insurance",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=Insurance",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "doc_12",
          type: "puc_certificate",
          number: "exp 11 Jan 2027",
          pages: 1,
          status: "approved",
          sides: {
            front: {
              id: "file_12_front",
              type: "puc_certificate",
              side: "front",
              url: "https://via.placeholder.com/500x300?text=PUC+Certificate",
              uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
      ],
    },
    {
      id: "approval_3",
      instructor_id: "instr_003",
      name: "Amit Patel",
      phone: "+91 88765 54321",
      initials: "AP",
      avatar_bg_color: "#ec4899",
      applied_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      stage: "stage2_pedal_video",
      lastVideoUploadedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      approvedCount: 1,
      totalCount: 1,
      documents: [],
      videos: [
        {
          id: "video_1",
          title: "Dual-control pedal — install clip",
          duration: "0:38",
          uploadedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
          angles: 3,
          url: "https://via.placeholder.com/800x600?text=Pedal+Video",
          status: "pending",
        },
      ],
      verificationChecklist: [
        { id: "check_1", text: "Clutch & brake pedals installed on the passenger side", verified: true },
        { id: "check_2", text: "Mounting firm – no play in the linkage", verified: true },
        { id: "check_3", text: "Vehicle number matches the approved RC", verified: true },
        { id: "check_4", text: "Footage clear & well lit across all angles", verified: true },
      ],
    },
    {
      id: "approval_4",
      instructor_id: "instr_004",
      name: "Neha Gupta",
      phone: "+91 99887 66543",
      initials: "NG",
      avatar_bg_color: "#f59e0b",
      applied_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      stage: "stage2_pedal_video",
      lastVideoUploadedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      approvedCount: 1,
      totalCount: 1,
      documents: [],
      videos: [
        {
          id: "video_2",
          title: "Dual-control pedal — install clip",
          duration: "0:42",
          uploadedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          angles: 3,
          url: "https://via.placeholder.com/800x600?text=Pedal+Video",
          status: "pending",
        },
      ],
      verificationChecklist: [
        { id: "check_5", text: "Clutch & brake pedals installed on the passenger side", verified: true },
        { id: "check_6", text: "Mounting firm – no play in the linkage", verified: true },
        { id: "check_7", text: "Vehicle number matches the approved RC", verified: true },
        { id: "check_8", text: "Footage clear & well lit across all angles", verified: true },
      ],
    },
    {
      id: "approval_5",
      instructor_id: "instr_005",
      name: "Vikram Sharma",
      phone: "+91 87654 32109",
      initials: "VS",
      avatar_bg_color: "#8b5cf6",
      applied_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      stage: "stage1_documents",
      approvedCount: 2,
      totalCount: 5,
      rejectionNote: "Multiple documents need resubmission",
      documents: [
        {
          id: "doc_25",
          type: "pan_card",
          number: "ABCD1234F",
          pages: 1,
          status: "approved",
          sides: {
            front: { id: "file_25_front", type: "pan_card", side: "front", url: "https://via.placeholder.com/500x300?text=PAN+Card", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
            back: { id: "file_25_back", type: "pan_card", side: "back", url: "https://via.placeholder.com/500x300?text=PAN+Card", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
          },
          approvedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
          id: "doc_26",
          type: "aadhar",
          number: "XXXX XXXX 8542",
          pages: 2,
          status: "rejected",
          sides: {
            front: { id: "file_26_front", type: "aadhar", side: "front", url: "https://via.placeholder.com/500x300?text=Aadhar", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
            back: { id: "file_26_back", type: "aadhar", side: "back", url: "https://via.placeholder.com/500x300?text=Aadhar", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
          },
          rejectionReason: "Image quality poor",
          rejectedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        },

        {
          id: "doc_28",
          type: "vehicle_rc",
          number: "MH02 CD 4471",
          pages: 1,
          status: "pending",
          sides: {
            front: { id: "file_28_front", type: "vehicle_rc", side: "front", url: "https://via.placeholder.com/500x300?text=RC", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
            back: { id: "file_28_back", type: "vehicle_rc", side: "back", url: "https://via.placeholder.com/500x300?text=RC", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
          },
        },
        {
          id: "doc_29",
          type: "insurance",
          number: "exp 03 Mar 2027",
          pages: 1,
          status: "pending",
          sides: {
            front: { id: "file_29_front", type: "insurance", side: "front", url: "https://via.placeholder.com/500x300?text=Insurance", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
          },
        },
        {
          id: "doc_30",
          type: "puc_certificate",
          number: "exp 11 Jan 2027",
          pages: 1,
          status: "pending",
          sides: {
            front: { id: "file_30_front", type: "puc_certificate", side: "front", url: "https://via.placeholder.com/500x300?text=PUC", uploadedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
          },
        },
      ],
    },
  ];
};

/**
 * Get display name for document type
 */
export const getDocumentDisplayName = (type: DocumentType): string => {
  const names: Record<DocumentType, string> = {
    pan_card: "PAN Card",
    aadhar: "Aadhar",
    vehicle_rc: "Vehicle RC",
    insurance: "Insurance",
    puc_certificate: "PUC Certificate",
  };
  return names[type];
};

/**
 * Get color for document type
 */
export const getDocumentColor = (type: DocumentType): string => {
  const colors: Record<DocumentType, string> = {
    pan_card: "bg-emerald-100 text-emerald-700",
    aadhar: "bg-blue-100 text-blue-700",
    vehicle_rc: "bg-red-100 text-red-700",
    insurance: "bg-yellow-100 text-yellow-700",
    puc_certificate: "bg-purple-100 text-purple-700",
  };
  return colors[type];
};

/**
 * Get badge color for approval status
 */
export const getStatusColor = (status: ApprovalStatus): string => {
  switch (status) {
    case "approved":
      return "bg-emerald-100 text-emerald-700";
    case "rejected":
      return "bg-red-100 text-red-700";
    case "pending":
      return "bg-gray-100 text-gray-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
};

/**
 * Get status display text
 */
export const getStatusText = (status: ApprovalStatus): string => {
  switch (status) {
    case "approved":
      return "● Approved";
    case "rejected":
      return "● Rejected";
    case "pending":
      return "Pending";
    default:
      return "Pending";
  }
};
