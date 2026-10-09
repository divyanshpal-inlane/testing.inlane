/**
 * Instructor Approval - Types and Mock Data
 * Handles document review and instructor approval workflow
 */

import { useQuery } from "@tanstack/react-query";

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
  suggestedMessage: string;
}

export const REJECTION_REASONS: RejectionReason[] = [
  {
    id: "illegible",
    label: "Illegible",
    backendTag: "illegible",
    suggestedMessage: "The document is not clear enough. Please re-upload a clear photo showing all four corners.",
  },
  {
    id: "expired",
    label: "Expired",
    backendTag: "expired",
    suggestedMessage: "This document has expired. Please provide a valid document with future expiry date.",
  },
  {
    id: "mismatch",
    label: "Mismatch",
    backendTag: "mismatch",
    suggestedMessage: "Details on the document do not match the information provided. Please verify and re-upload.",
  },
  {
    id: "wrong_doc",
    label: "Wrong_doc",
    backendTag: "wrong_doc",
    suggestedMessage: "The uploaded document does not match the required document type. Please upload the correct document.",
  },
  {
    id: "side_missing",
    label: "Side_missing",
    backendTag: "side_missing",
    suggestedMessage: "The front or back side of the document is missing. Please upload both sides.",
  },
  {
    id: "other",
    label: "Other",
    backendTag: "other",
    suggestedMessage: "Please add a note below explaining the rejection reason.",
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
    suggestedMessage: "The footage is too dark to see the pedal mechanism clearly. Please re-record in better lighting conditions.",
  },
  {
    id: "pedal_not_visible",
    label: "Pedal/linkage not visible",
    backendTag: "pedal_not_visible",
    suggestedMessage: "The pedal and linkage mechanism are not clearly visible in the video. Please adjust the camera angle and re-record.",
  },
  {
    id: "vehicle_mismatch",
    label: "Vehicle does not match RC",
    backendTag: "vehicle_mismatch",
    suggestedMessage: "The vehicle in the video does not match the registration certificate provided. Please re-record with the correct vehicle.",
  },
  {
    id: "angle_missing",
    label: "Required angle missing",
    backendTag: "angle_missing",
    suggestedMessage: "One or more required camera angles are missing. Please re-record showing all required views.",
  },
  {
    id: "other_video",
    label: "Other",
    backendTag: "other",
    suggestedMessage: "Please add a note below explaining the rejection reason.",
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

// ============= API INTEGRATION =============

const BACKEND_API = import.meta.env.VITE_BACKEND_API || "/go-api";

interface ApiDocumentSide {
  side: "front" | "back";
  file_url: string;
  uploaded_at: string;
}

interface ApiDocumentDetail {
  id: string;
  type: string;
  label: string;
  document_number?: string;
  sides: ApiDocumentSide[];
  verification_status: "pending" | "verified" | "rejected";
  reason_code?: string;
  reason_message?: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

interface ApiVideoDetail {
  id: string;
  title: string;
  duration?: string;
  uploaded_at: string;
  angles?: number;
  file_url: string;
  verification_status: "pending" | "verified" | "rejected";
  reason_code?: string;
  reason_message?: string;
  reviewed_by?: string;
  reviewed_at?: string;
}

interface ApiFetchDocumentsResponse {
  success: boolean;
  instructor: {
    id: string;
    name: string;
    phone: string;
    email: string;
    role: string;
    status: string;
    stage: string;
    applied_at: string;
  };
  documents?: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
    all_mandatory_approved: boolean;
    can_mark_active: boolean;
  };
  document_details?: ApiDocumentDetail[];
  videos?: {
    total: number;
    approved: number;
    rejected: number;
    pending: number;
  };
  video_details?: ApiVideoDetail[];
  verification_checklist?: Array<{
    id: string;
    text: string;
    verified: boolean;
  }>;
  metadata: {
    request_id: string;
    timestamp: string;
  };
}

const mapDocumentType = (apiType: string): DocumentType => {
  const typeMap: Record<string, DocumentType> = {
    pan: "pan_card",
    aadhaar: "aadhar",
    rc: "vehicle_rc",
    vehicle_insurance: "insurance",
    puc: "puc_certificate",
  };
  return typeMap[apiType] || "pan_card";
};

const mapVerificationStatus = (apiStatus: string): ApprovalStatus => {
  switch (apiStatus) {
    case "verified":
      return "approved";
    case "rejected":
      return "rejected";
    case "pending":
    default:
      return "pending";
  }
};

const getInitialsHelper = (name: string): string => {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const getAvatarColorHelper = (name: string): string => {
  const colors = [
    "#3b82f6",
    "#ec4899",
    "#f59e0b",
    "#10b981",
    "#8b5cf6",
    "#06b6d4",
  ];
  const hash = name.split("").reduce((acc, char) => {
    return acc + char.charCodeAt(0);
  }, 0);
  return colors[hash % colors.length];
};

const transformApiDocumentToUI = (apiDoc: ApiDocumentDetail): DocumentReview => {
  const sides: Record<string, DocumentFile | undefined> = {};

  // Log raw API document for debugging
  console.log(`[TRANSFORM] Processing document: ${apiDoc.id} (${apiDoc.type})`, {
    sidesCount: apiDoc.sides?.length || 0,
    sidesData: apiDoc.sides,
    label: apiDoc.label,
  });

  // Track if we detect duplicate URLs (backend bug)
  const urlMap: Record<string, string> = {};

  apiDoc.sides?.forEach((side) => {
    const sideKey = side.side as DocumentSide;
    if (sideKey === "front" || sideKey === "back") {
      const fileUrl = side.file_url;
      
      // Check if this URL was already assigned to a different side
      if (urlMap.front === fileUrl && sideKey === "back") {
        console.warn(
          `[TRANSFORM] ⚠️ DUPLICATE URL DETECTED for ${apiDoc.label} (${apiDoc.id}):\n` +
          `Front URL: ${urlMap.front}\n` +
          `Back URL: ${fileUrl}\n` +
          `Both sides have the SAME URL - This is a backend issue!`
        );
      }
      
      urlMap[sideKey] = fileUrl;
      
      sides[sideKey] = {
        id: `${apiDoc.id}-${sideKey}`,
        type: mapDocumentType(apiDoc.type),
        side: sideKey,
        url: fileUrl,
        uploadedAt: side.uploaded_at,
      };
      console.log(`[TRANSFORM] ✅ Added ${sideKey} side with URL: ${fileUrl}`);
    }
  });

  console.log(`[TRANSFORM] Final sides for ${apiDoc.id}:`, { 
    sidesCount: Object.keys(sides).length, 
    sides: Object.keys(sides),
    hasFront: !!sides.front,
    hasBack: !!sides.back,
    frontUrl: sides.front?.url?.substring(0, 80) + "...",
    backUrl: sides.back?.url?.substring(0, 80) + "...",
  });

  return {
    id: apiDoc.id,
    type: mapDocumentType(apiDoc.type),
    number: apiDoc.document_number || "",
    pages: apiDoc.sides?.length || 0,
    status: mapVerificationStatus(apiDoc.verification_status),
    sides,
    rejectionReason: apiDoc.reason_code,
    rejectionMessage: apiDoc.reason_message,
    rejectedAt: apiDoc.reason_code ? apiDoc.reviewed_at : undefined,
  };
};

/**
 * ============= VERIFY/APPROVE DOCUMENT API =============
 * Approve/verify a single document for an instructor
 */
export async function verifyDocument(instructorId: string, documentId: string): Promise<any> {
  const goAccessToken = localStorage.getItem("go_access_token");
  if (!goAccessToken) {
    throw new Error("No authentication token. Please login again.");
  }

  console.log(`[VERIFY_DOC_API] Verifying document ${documentId} for instructor ${instructorId}`);

  const url = `${BACKEND_API}/admin/instructors/${instructorId}/documents/${documentId}/verify`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${goAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const apiData = await response.json();

  if (!apiData.success) {
    throw new Error(apiData.message || "Failed to verify document");
  }

  console.log(`[VERIFY_DOC_API] ✅ Document ${documentId} verified successfully`);
  console.log("[VERIFY_DOC_API] Response:", apiData);

  return apiData;
}

/**
 * ============= VERIFY/APPROVE VIDEO API =============
 * Approve/verify a single video for an instructor
 */
export async function verifyVideo(instructorId: string, documentId: string): Promise<any> {
  const goAccessToken = localStorage.getItem("go_access_token");
  if (!goAccessToken) {
    throw new Error("No authentication token. Please login again.");
  }

  console.log(`[VERIFY_VIDEO_API] Verifying video ${documentId} for instructor ${instructorId}`);

  const url = `${BACKEND_API}/admin/instructors/${instructorId}/documents/${documentId}/verify`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${goAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const apiData = await response.json();

  if (!apiData.success) {
    throw new Error(apiData.message || "Failed to verify video");
  }

  console.log(`[VERIFY_VIDEO_API] ✅ Video ${documentId} verified successfully`);
  console.log("[VERIFY_VIDEO_API] Response:", apiData);

  return apiData;
}

/**
 * ============= REJECT DOCUMENT API =============
 * Reject a single document and ask instructor to re-upload
 */
export async function rejectDocument(instructorId: string, documentId: string, reason: string, message: string): Promise<any> {
  const goAccessToken = localStorage.getItem("go_access_token");
  if (!goAccessToken) {
    throw new Error("No authentication token. Please login again.");
  }

  console.log(`[REJECT_DOC_API] Rejecting document ${documentId} for instructor ${instructorId}`);
  console.log(`[REJECT_DOC_API] Reason: ${reason}, Message: ${message}`);

  const url = `${BACKEND_API}/admin/instructors/${instructorId}/documents/${documentId}/reject`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${goAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason_code: reason,
      message: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const apiData = await response.json();

  if (!apiData.success) {
    throw new Error(apiData.message || "Failed to reject document");
  }

  console.log(`[REJECT_DOC_API] ✅ Document ${documentId} rejected successfully`);
  console.log("[REJECT_DOC_API] Response:", apiData);

  return apiData;
}

/**
 * ============= REJECT VIDEO API =============
 * Reject a single video and ask instructor to re-upload
 */
export async function rejectVideo(instructorId: string, videoId: string, reason: string, message: string): Promise<any> {
  const goAccessToken = localStorage.getItem("go_access_token");
  if (!goAccessToken) {
    throw new Error("No authentication token. Please login again.");
  }

  console.log(`[REJECT_VIDEO_API] Rejecting video ${videoId} for instructor ${instructorId}`);
  console.log(`[REJECT_VIDEO_API] Reason: ${reason}, Message: ${message}`);

  const url = `${BACKEND_API}/admin/instructors/${instructorId}/documents/${videoId}/reject`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${goAccessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reason_code: reason,
      message: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const apiData = await response.json();

  if (!apiData.success) {
    throw new Error(apiData.message || "Failed to reject video");
  }

  console.log(`[REJECT_VIDEO_API] ✅ Video ${videoId} rejected successfully`);
  console.log("[REJECT_VIDEO_API] Response:", apiData);

  return apiData;
}

/**
 * ============= APPROVE STAGE 1 DOCUMENTS API =============
 * Approve all documents in Stage 1 and mark instructor as active
 * This is called when admin clicks "Approve Stage 1 - Mark Active" button
 * After all documents are approved, this enables the instructor for Stage 2
 * POST /v1/admin/instructors/{id}/documents/approve
 */
export async function approveStage1Documents(instructorId: string): Promise<any> {
  const goAccessToken = localStorage.getItem("go_access_token");
  if (!goAccessToken) {
    throw new Error("No authentication token. Please login again.");
  }

  console.log(`[APPROVE_STAGE1_API] Approving all Stage 1 documents for instructor ${instructorId}`);

  const url = `${BACKEND_API}/admin/instructors/${instructorId}/documents/approve`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${goAccessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const apiData = await response.json();

  if (!apiData.success) {
    throw new Error(apiData.message || "Failed to approve Stage 1 documents");
  }

  console.log(`[APPROVE_STAGE1_API] ✅ Stage 1 documents approved successfully for instructor ${instructorId}`);
  console.log("[APPROVE_STAGE1_API] Response:", apiData);

  return apiData;
}

export async function reuploadDocument(
  instructorId: string,
  documentId: string,
  frontFile: File,
  backFile: File
): Promise<any> {
  const goAccessToken = localStorage.getItem('go_access_token');
  if (!goAccessToken) {
    throw new Error('No authentication token. Please login again.');
  }

  const formData = new FormData();
  formData.append('front', frontFile);
  formData.append('back', backFile);

  const url = `${BACKEND_API}/api/v1/instructor/${instructorId}/documents/${documentId}/reupload`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${goAccessToken}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }

  const apiData = await response.json();

  if (!apiData.success) {
    throw new Error(apiData.message || 'Failed to reupload document');
  }

  return apiData;
}

const transformApiVideoToUI = (apiVideo: ApiVideoDetail): PedalVideo => {
  return {
    id: apiVideo.id,
    title: apiVideo.title,
    duration: apiVideo.duration || "0:00",
    uploadedAt: apiVideo.uploaded_at,
    angles: apiVideo.angles || 0,
    url: apiVideo.file_url,
    status: mapVerificationStatus(apiVideo.verification_status),
    rejectionReason: apiVideo.reason_code,
    rejectionMessage: apiVideo.reason_message,
    rejectedAt: apiVideo.reason_code ? apiVideo.reviewed_at : undefined,
  };
};

/**
 * Fetch instructor documents/videos from real backend API
 * Calls: GET /admin/instructors/{id}/documents?stage={stage}
 */
export const useFetchInstructorDocuments = (
  instructorId: string | undefined,
  stage: string = "documents"
) => {
  return useQuery({
    queryKey: ["instructor-documents", instructorId, stage],
    queryFn: async () => {
      if (!instructorId) {
        throw new Error("Instructor ID is required");
      }

      const goAccessToken = localStorage.getItem("go_access_token");
      if (!goAccessToken) {
        throw new Error("No authentication token. Please login again.");
      }

      console.log(
        `[APPROVAL API] Fetching documents for instructor ${instructorId} with stage=${stage}`
      );

      const url = `${BACKEND_API}/admin/instructors/${instructorId}/documents?stage=${stage}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${goAccessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const apiData: ApiFetchDocumentsResponse = await response.json();

      if (!apiData.success) {
        throw new Error("API returned success: false");
      }

      const isVideosStage = stage === "pedal_videos";

      // For videos stage, the API returns them as document_details with type: "pedal_videos"
      let videosData: PedalVideo[] = [];
      if (isVideosStage && apiData.document_details) {
        videosData = apiData.document_details.map(apiDoc => {
          const videoUrl = apiDoc.sides?.[0]?.file_url || "";
          console.log(
            `[VIDEO-TRANSFORM] Processing video: ${apiDoc.id} (${apiDoc.label})\n` +
            `URL: ${videoUrl}`
          );
          return {
            id: apiDoc.id,
            title: apiDoc.label || "Pedal Video",
            duration: "0:00",
            uploadedAt: apiDoc.sides?.[0]?.uploaded_at || apiDoc.reviewed_at || apiData.instructor.applied_at,
            angles: 1,
            url: videoUrl,
            status: mapVerificationStatus(apiDoc.verification_status),
            rejectionReason: apiDoc.reason_code,
            rejectionMessage: apiDoc.reason_message,
            rejectedAt: apiDoc.reason_code ? apiDoc.reviewed_at : undefined,
          };
        });
      }

      console.log(
        `[APPROVAL API] ✅ Fetched ${isVideosStage ? videosData.length : apiData.document_details?.length || 0} items`
      );
      console.log("[APPROVAL API] Response:", apiData);
      if (isVideosStage) {
        console.log("[APPROVAL API] Videos transformed:", videosData);
      }

      // Default verification checklist for Stage 2 (backend doesn't provide this)
      const defaultVerificationChecklist: VerificationItem[] = [
        { id: "check_1", text: "Clutch & brake pedals installed on the passenger side", verified: true },
        { id: "check_2", text: "Mounting firm – no play in the linkage", verified: true },
        { id: "check_3", text: "Video shows all pedal angles (top, side, bottom)", verified: true },
      ];

      const transformed: InstructorApprovalDetail = {
        id: apiData.instructor.id,
        instructor_id: apiData.instructor.id,
        name: apiData.instructor.name,
        phone: apiData.instructor.phone,
        initials: getInitialsHelper(apiData.instructor.name),
        avatar_bg_color: getAvatarColorHelper(apiData.instructor.name),
        applied_at: apiData.instructor.applied_at,
        stage: isVideosStage ? "stage2_pedal_video" : "stage1_documents",
        documents: isVideosStage ? [] : (apiData.document_details || []).map(transformApiDocumentToUI),
        videos: isVideosStage ? videosData : undefined,
        verificationChecklist: isVideosStage ? defaultVerificationChecklist : undefined,
        lastVideoUploadedAt: isVideosStage ? (videosData?.[0]?.uploadedAt || apiData.instructor.applied_at) : undefined,
        approvedCount: isVideosStage ? (apiData.documents?.approved || 0) : (apiData.documents?.approved || 0),
        totalCount: isVideosStage ? (apiData.documents?.total || 0) : (apiData.documents?.total || 0),
      };

      return transformed;
    },
    enabled: !!instructorId,
    staleTime: 5 * 60 * 1000,
  });
};


