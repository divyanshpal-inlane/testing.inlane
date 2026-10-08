"use client";
"use client";
import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, ZoomIn, ZoomOut, Expand, Check, X, Play, Pause, ChevronDown, Upload, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useFetchInstructorDocuments,
  getDocumentDisplayName,
  REJECTION_REASONS,
  PEDAL_VIDEO_REJECTION_REASONS,
  verifyDocument,
  verifyVideo,
  rejectDocument,
  rejectVideo,
  approveStage1Documents,
  type DocumentType,
  type DocumentSide,
  type ApprovalStatus,
  type VideoViewMode,
} from "@/queries/instructorApproval";
import { formatDistanceToNow, parseISO } from "date-fns";

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

export default function InstructorApprovalPage(): JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  
  // Determine stage from URL query parameter (passed from Review card)
  const stageParam = searchParams.get("stage");
  const isStage2Param = stageParam === "stage2_pedal_video";
  const stage = isStage2Param ? "pedal_videos" : "documents";
  
  // Fetch real instructor data from backend API
  const { data: instructor, isLoading, error } = useFetchInstructorDocuments(id, stage);
  
  // ✅ ALL HOOKS MUST BE DEFINED BEFORE ANY CONDITIONAL RETURNS
  // Document states
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("");
  const [selectedSide, setSelectedSide] = useState<DocumentSide>("front");
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [documentStatuses, setDocumentStatuses] = useState<Record<string, ApprovalStatus>>({});
  
  // Video states
  const [videoViewMode, setVideoViewMode] = useState<VideoViewMode>("front");
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoStatuses, setVideoStatuses] = useState<Record<string, ApprovalStatus>>({});
  const [actualVideoDuration, setActualVideoDuration] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);

  // Document Rejection modal states
  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState(false);
  const [rejectionDocumentId, setRejectionDocumentId] = useState<string>("");
  const [selectedRejectionReason, setSelectedRejectionReason] = useState<string>(
    REJECTION_REASONS[0].id
  );
  const [rejectionMessage, setRejectionMessage] = useState<string>("");
  const [isReasonDropdownOpen, setIsReasonDropdownOpen] = useState(false);

  // Video Rejection modal states
  const [isVideoRejectionModalOpen, setIsVideoRejectionModalOpen] = useState(false);
  const [rejectionVideoId, setRejectionVideoId] = useState<string>("");
  const [selectedVideoRejectionReason, setSelectedVideoRejectionReason] = useState<string>(
    PEDAL_VIDEO_REJECTION_REASONS[0].id
  );
  const [videoRejectionMessage, setVideoRejectionMessage] = useState<string>("");
  const [isVideoReasonDropdownOpen, setIsVideoReasonDropdownOpen] = useState(false);
  
  // Document Reupload modal states - MUST BE BEFORE EARLY RETURNS!
  const [isReuploadModalOpen, setIsReuploadModalOpen] = useState(false);
  const [reuploadDocumentId, setReuploadDocumentId] = useState<string>("");
  const [reuploadFrontFile, setReuploadFrontFile] = useState<File | null>(null);
  const [reuploadBackFile, setReuploadBackFile] = useState<File | null>(null);
  const [reuploadFrontPreview, setReuploadFrontPreview] = useState<string>("");
  const [reuploadBackPreview, setReuploadBackPreview] = useState<string>("");
  const [reuploadDragActiveFront, setReuploadDragActiveFront] = useState(false);
  const [reuploadDragActiveBack, setReuploadDragActiveBack] = useState(false);
  const [isReuploadLoading, setIsReuploadLoading] = useState(false);
  // Track reuploaded documents so they show both front and back buttons
  const [reuploadedDocsWithBothSides, setReuploadedDocsWithBothSides] = useState<Set<string>>(new Set());

  
  // All Refs - MUST BE BEFORE EARLY RETURNS!
  const reuploadFrontFileInputRef = useRef<HTMLInputElement>(null);
  const reuploadBackFileInputRef = useRef<HTMLInputElement>(null);
  
  // All useEffect hooks - MUST BE BEFORE EARLY RETURNS!
  // Initialize states when instructor data loads
  useEffect(() => {
    if (instructor) {
      setSelectedDocumentId(instructor.documents[0]?.id || "");
      setDocumentStatuses(
        Object.fromEntries(instructor.documents.map((doc) => [doc.id, doc.status]))
      );
      setVideoStatuses(
        Object.fromEntries((instructor.videos || []).map((video) => [video.id, video.status]))
      );
    }
  }, [instructor]);

  // Update video duration when metadata loads
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      const duration = video.duration;
      const minutes = Math.floor(duration / 60);
      const seconds = Math.floor(duration % 60);
      const formattedDuration = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      setActualVideoDuration(formattedDuration);
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, []);
  
  // ✅ NOW we can have conditional returns AFTER all hooks
  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="h-8 w-8 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading instructor data...</p>
        </div>
      </div>
    );
  }
  
  // Show error state
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 font-semibold mb-4">Error loading instructor data</p>
          <p className="text-gray-600 mb-6">{error instanceof Error ? error.message : 'Unknown error occurred'}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }
  
  // Show no data state
  if (!instructor) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600 mb-6">No instructor data found</p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }
  
  const isStage2 = isStage2Param || instructor.stage === "stage2_pedal_video";



  const currentDocument = instructor.documents.find(
    (doc) => doc.id === selectedDocumentId
  );

  // Get the current side image from the document
  const currentDocumentSide = currentDocument ? currentDocument.sides[selectedSide] : undefined;

  const approvedCount = Object.values(documentStatuses).filter(
    (s) => s === "approved"
  ).length;

  let appliedDate = "Recently";
  try {
    appliedDate = formatDistanceToNow(parseISO(instructor.applied_at), {
      addSuffix: true,
    });
  } catch (e) {}

  const handleApproveDocument = async (docId: string) => {
    if (!id) return;
    
    try {
      console.log(`[UI] Admin approving document ${docId}`);
      const response = await verifyDocument(id, docId);
      console.log("[UI] Document verified successfully:", response);
      
      setDocumentStatuses((prev) => ({ ...prev, [docId]: "approved" }));
      alert(`✅ Document approved and verified!`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to approve document";
      console.error("[UI] Error approving document:", errorMsg);
      alert(`❌ Error: ${errorMsg}`);
    }
  };

  // Reupload handlers
  const handleOpenReuploadModal = (docId: string) => {
    setReuploadDocumentId(docId);
    setIsReuploadModalOpen(true);
    setReuploadFrontFile(null);
    setReuploadBackFile(null);
    setReuploadFrontPreview("");
    setReuploadBackPreview("");
  };

  const handleReuploadFileSelect = (file: File, side: "front" | "back") => {
    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "application/pdf"];
    if (!validTypes.includes(file.type)) {
      alert("Invalid file type. Please upload JPG, PNG, or PDF.");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("File size exceeds 5MB. Please select a smaller file.");
      return;
    }

    if (side === "front") {
      setReuploadFrontFile(file);
      // Create preview for images
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setReuploadFrontPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setReuploadFrontPreview("");
      }
    } else {
      setReuploadBackFile(file);
      // Create preview for images
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setReuploadBackPreview(reader.result as string);
        };
        reader.readAsDataURL(file);
      } else {
        setReuploadBackPreview("");
      }
    }
  };

  const handleReuploadDrag = (e: React.DragEvent, side: "front" | "back") => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      if (side === "front") {
        setReuploadDragActiveFront(true);
      } else {
        setReuploadDragActiveBack(true);
      }
    } else if (e.type === "dragleave") {
      if (side === "front") {
        setReuploadDragActiveFront(false);
      } else {
        setReuploadDragActiveBack(false);
      }
    }
  };

  const handleReuploadDrop = (e: React.DragEvent, side: "front" | "back") => {
    e.preventDefault();
    e.stopPropagation();
    if (side === "front") {
      setReuploadDragActiveFront(false);
    } else {
      setReuploadDragActiveBack(false);
    }

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleReuploadFileSelect(e.dataTransfer.files[0], side);
    }
  };

  const handleReuploadInputChange = (e: React.ChangeEvent<HTMLInputElement>, side: "front" | "back") => {
    if (e.target.files && e.target.files[0]) {
      handleReuploadFileSelect(e.target.files[0], side);
    }
  };

  const handleConfirmReupload = async () => {
    if (!reuploadFrontFile || !reuploadBackFile) return;

    setIsReuploadLoading(true);

    // TODO: Replace with actual API call
    // const formData = new FormData();
    // formData.append("frontFile", reuploadFrontFile);
    // formData.append("backFile", reuploadBackFile);
    // const response = await fetch(
    //   `/api/instructor-approval/${instructor.instructor_id}/document/${reuploadDocumentId}/reupload`,
    //   {
    //     method: "POST",
    //     body: formData,
    //   }
    // );

    // Simulate API call
    setTimeout(() => {
      // Update document status to pending for re-review
      setDocumentStatuses((prev) => ({
        ...prev,
        [reuploadDocumentId]: "pending",
      }));

      // IMPORTANT: Mark this document as having both front and back sides after reupload
      // This allows the document viewer to show Front/Back buttons
      setReuploadedDocsWithBothSides(prev => new Set([...prev, reuploadDocumentId]));

      console.log("Document Reupload:", {
        documentId: reuploadDocumentId,
        frontFileName: reuploadFrontFile.name,
        frontFileSize: reuploadFrontFile.size,
        backFileName: reuploadBackFile.name,
        backFileSize: reuploadBackFile.size,
        timestamp: new Date().toISOString(),
      });

      // Close modal and reset states
      setIsReuploadModalOpen(false);
      setReuploadDocumentId("");
      setReuploadFrontFile(null);
      setReuploadBackFile(null);
      setReuploadFrontPreview("");
      setReuploadBackPreview("");
      if (reuploadFrontFileInputRef.current) {
        reuploadFrontFileInputRef.current.value = "";
      }
      if (reuploadBackFileInputRef.current) {
        reuploadBackFileInputRef.current.value = "";
      }

      setIsReuploadLoading(false);
    }, 1000);
  };

  const handleReuploadModalClose = () => {
    setIsReuploadModalOpen(false);
    setReuploadDocumentId("");
    setReuploadFrontFile(null);
    setReuploadBackFile(null);
    setReuploadFrontPreview("");
    setReuploadBackPreview("");
    if (reuploadFrontFileInputRef.current) {
      reuploadFrontFileInputRef.current.value = "";
    }
    if (reuploadBackFileInputRef.current) {
      reuploadBackFileInputRef.current.value = "";
    }
  };

  const handleRejectDocument = (docId: string) => {
    setRejectionDocumentId(docId);
    setIsRejectionModalOpen(true);
  };

  const handleConfirmRejectDocument = async (
    docId: string,
    reason: string,
    message: string,
    backendTag: string
  ) => {
    if (!id) return;

    try {
      console.log("[UI] Admin rejecting document:", { docId, reason, message });
      const response = await rejectDocument(id, docId, reason, message);
      console.log("[UI] Document rejected successfully:", response);

      // Update document status to rejected
      setDocumentStatuses((prev) => ({ ...prev, [docId]: "rejected" }));
      alert(`✅ Document rejected! Instructor will be notified to re-upload.`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to reject document";
      console.error("[UI] Error rejecting document:", errorMsg);
      alert(`❌ Error: ${errorMsg}`);
    } finally {
      // Close modal and reset states
      setIsRejectionModalOpen(false);
      setRejectionDocumentId("");
      setSelectedRejectionReason(REJECTION_REASONS[0].id);
      setRejectionMessage("");
      setIsReasonDropdownOpen(false);
    }
  };

  const handleRejectVideo = (videoId: string) => {
    setRejectionVideoId(videoId);
    setIsVideoRejectionModalOpen(true);
  };

  const handleConfirmRejectVideo = async (
    videoId: string,
    reason: string,
    message: string,
    backendTag: string
  ) => {
    if (!id) return;

    try {
      console.log("[UI] Admin rejecting video:", { videoId, reason, message });
      const response = await rejectVideo(id, videoId, reason, message);
      console.log("[UI] Video rejected successfully:", response);

      // Update video status to rejected
      setVideoStatuses((prev) => ({ ...prev, [videoId]: "rejected" }));
      alert(`✅ Video rejected! Instructor will be notified to re-upload.`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to reject video";
      console.error("[UI] Error rejecting video:", errorMsg);
      alert(`❌ Error: ${errorMsg}`);
    } finally {
      // Close modal and reset states
      setIsVideoRejectionModalOpen(false);
      setRejectionVideoId("");
      setSelectedVideoRejectionReason(PEDAL_VIDEO_REJECTION_REASONS[0].id);
      setVideoRejectionMessage("");
      setIsVideoReasonDropdownOpen(false);
    }
  };

  const handleApproveVideo = async (videoId: string) => {
    if (!id) return;

    try {
      console.log(`[UI] Admin approving video ${videoId}`);
      const response = await verifyVideo(id, videoId);
      console.log("[UI] Video verified successfully:", response);

      setVideoStatuses((prev) => ({ ...prev, [videoId]: "approved" }));
      alert(`✅ Video approved and verified!`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to approve video";
      console.error("[UI] Error approving video:", errorMsg);
      alert(`❌ Error: ${errorMsg}`);
    }
  };

  const handleApproveStage1 = async () => {
    if (!id) return;

    try {
      console.log(`[UI] Admin approving all Stage 1 documents for instructor ${id}`);
      const response = await approveStage1Documents(id);
      console.log("[UI] Stage 1 documents approved successfully:", response);

      // Update all document statuses to approved
      const updatedStatuses: Record<string, ApprovalStatus> = {};
      instructor.documents.forEach((doc) => {
        updatedStatuses[doc.id] = "approved";
      });
      setDocumentStatuses(updatedStatuses);

      alert(`✅ All Stage 1 documents approved! Instructor marked as active for Stage 2.`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to approve Stage 1 documents";
      console.error("[UI] Error approving Stage 1 documents:", errorMsg);
      alert(`❌ Error: ${errorMsg}`);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-green-500" />
          <p className="text-gray-600 font-medium">Loading instructor details...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !instructor) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <AlertCircle className="h-8 w-8 text-red-500" />
          <p className="text-gray-900 font-semibold">Failed to load instructor data</p>
          <p className="text-sm text-gray-600">{error?.message || "Please try again later"}</p>
          <button
            onClick={() => navigate("/admin/instructors?tab=review")}
            className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Back to Instructors
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-gray-50">
        <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate("/admin/instructors?tab=review")}
            className="flex items-center gap-2 text-gray-700 hover:text-gray-900 font-medium"
          >
            <ChevronLeft className="h-5 w-5" />
            <span>Instructors</span>
          </button>
          {isStage2 ? (
            <span className="font-bold text-sm px-4 py-2 rounded-full" style={{ color: "#6B21A8", backgroundColor: "#F3E8FF" }}>
              Stage 2 - Pedal video
            </span>
          ) : (
            <span className="text-red-600 font-bold text-sm px-4 py-2 rounded-full" style={{ backgroundColor: "#FDECEC" }}>
              Stage 1 - Documents
            </span>
          )}
        </div>
      </div>

      <div className="px-8 py-6">
        {!isStage2 && (
        <>
        {/* Instructor Header with Progress Stepper */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full font-bold text-base flex-shrink-0"
              style={{ backgroundColor: "#DDF8EF", color: "#00CE84" }}
            >
              {instructor.initials || getInitials(instructor.name)}
            </div>
            {/* Instructor Info */}
            <div>
              <h1 className="text-lg font-bold text-gray-900">
                {instructor.name}
              </h1>
              <p className="text-xs text-gray-500">
                {instructor.phone} • applied {appliedDate}
              </p>
            </div>
          </div>

          {/* Progress Stepper */}
          <div className="flex items-center gap-2">
            {/* Step 1 - Documents (Active) */}
            <div className="flex items-center gap-2">
              <div 
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 font-bold text-xs"
                style={{ borderColor: "#00CE84", backgroundColor: "#DDF8EF", color: "#00CE84" }}
              >
                1
              </div>
              <span className="text-xs font-bold" style={{ color: "#1F2937" }}>
                Documents
              </span>
            </div>

            {/* Arrow */}
            <div className="h-0.5 w-6 bg-gray-300"></div>

            {/* Step 2 - Pedal video (Inactive) */}
            <div className="flex items-center gap-2">
              <div 
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold"
                style={{ 
                  borderColor: "#D1D5DB",
                  backgroundColor: "#FFFFFF",
                  color: "#9CA3AF"
                }}
              >
                2
              </div>
              <span className="text-xs font-medium text-gray-400">Pedal video</span>
            </div>

            {/* Arrow */}
            <div className="h-0.5 w-6 bg-gray-300"></div>

            {/* Step 3 - Matchable (Inactive) */}
            <div className="flex items-center gap-2">
              <div 
                className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-gray-300 bg-white text-xs font-bold"
                style={{ color: "#9CA3AF" }}
              >
                ?
              </div>
              <span className="text-xs font-medium text-gray-400">Matchable</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-5">
          <div className="col-span-7">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden h-full flex flex-col">
              {currentDocument ? (
                <>
                  <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                  <h3 className="font-bold text-base text-gray-900">
                      {getDocumentDisplayName(currentDocument.type)}
                    </h3>

                    <div className="flex bg-gray-100 rounded-lg p-0.5 gap-1">
                      <button
                        onClick={() => setSelectedSide("front")}
                        className={cn(
                          "px-4 py-1.5 text-xs font-medium rounded-md transition-all",
                          selectedSide === "front"
                            ? "bg-white text-gray-900 border border-gray-200 shadow-sm"
                            : "text-gray-600 bg-transparent"
                        )}
                      >
                        Front
                      </button>
                      <button
                        onClick={() => setSelectedSide("back")}
                        className={cn(
                          "px-4 py-1.5 text-xs font-medium rounded-md transition-all",
                          selectedSide === "back"
                            ? "bg-white text-gray-900 border border-gray-200 shadow-sm"
                            : "text-gray-600 bg-transparent"
                        )}
                      >
                        Back
                      </button>
                    </div>
                  </div>

                  <div 
                    className="flex-1 p-6 flex items-center justify-center relative overflow-hidden" 
                    style={{
                      backgroundColor: '#FAFAFB',
                      backgroundImage: 'radial-gradient(circle, #d1d5db 0.5px, transparent 0.5px)',
                      backgroundSize: '12px 12px',
                      backgroundPosition: '0 0'
                    }}
                  >
                    <div 
                      className="bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col transition-transform"
                      style={{
                        width: '430px',
                        height: '375px',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                        transform: `scale(${zoomLevel / 100})`
                      }}
                    >
                      <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between">
                        <h4 className="text-xs font-bold tracking-widest uppercase" style={{ color: '#00CE84' }}>
                          {getDocumentDisplayName(currentDocument.type)}
                        </h4>
                        <span className="text-xs font-bold text-gray-400 uppercase">
                          {selectedSide}
                        </span>
                      </div>

                      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden bg-gray-100">
                        {currentDocumentSide && currentDocumentSide.url ? (
                          <img
                            src={currentDocumentSide.url}
                            alt={`${getDocumentDisplayName(currentDocument.type)} - ${selectedSide}`}
                            className="max-w-full max-h-full object-contain drop-shadow-lg"
                            onLoad={() => {
                              console.log(
                                `[IMAGE] ? Successfully loaded ${selectedSide} for ${getDocumentDisplayName(currentDocument.type)}\n` +
                                `URL: ${currentDocumentSide.url}`
                              );
                            }}
                            onError={(e) => {
                              console.error(
                                `[IMAGE] ? Failed to load ${selectedSide} for ${getDocumentDisplayName(currentDocument.type)}\n` +
                                `URL: ${currentDocumentSide.url}`,
                                e
                              );
                            }}
                          />
                        ) : (
                          <div className="text-center text-gray-500 space-y-2">
                            <p className="text-sm font-medium">No document image available</p>
                            {currentDocument && (
                              <p className="text-xs text-gray-400">
                                Available sides: {Object.keys(currentDocument.sides || {}).join(", ") || "None"}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="absolute bottom-6 right-6 flex gap-2">
                      <button
                        onClick={() => setZoomLevel(Math.max(50, zoomLevel - 10))}
                        className="h-9 w-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-100 hover:border-gray-300 transition-all shadow-sm"
                      >
                        <ZoomOut className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setZoomLevel(Math.min(200, zoomLevel + 10))}
                        className="h-9 w-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-100 hover:border-gray-300 transition-all shadow-sm"
                      >
                        <ZoomIn className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setIsFullscreen(true)}
                        className="h-9 w-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-700 hover:bg-gray-100 hover:border-gray-300 transition-all shadow-sm"
                      >
                        <Expand className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                   {/* Fullscreen Modal */}
                   {isFullscreen && (
                     <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
                       <div className="relative w-full h-full flex items-center justify-center p-4">
                         <button
                           onClick={() => setIsFullscreen(false)}
                           className="absolute top-4 right-4 p-2 bg-white rounded-lg hover:bg-gray-100 transition-all"
                         >
                           <X className="h-6 w-6 text-gray-700" />
                         </button>
                         <div 
                           className="bg-white rounded-lg border border-gray-200 overflow-auto flex flex-col"
                           style={{
                             maxWidth: '90vw',
                             maxHeight: '90vh',
                             transform: `scale(${zoomLevel / 100})`
                           }}
                         >
                           <div className="px-5 py-4 border-b border-gray-200 flex items-start justify-between">
                             <h4 className="text-xs font-bold tracking-widest uppercase" style={{ color: '#00CE84' }}>
                               {getDocumentDisplayName(currentDocument?.type || 'pan_card')}
                             </h4>
                             <span className="text-xs font-bold text-gray-400 uppercase">
                               {selectedSide}
                             </span>
                           </div>

                           <div className="flex-1 flex items-center justify-center p-4 overflow-hidden bg-gray-100">
                              {currentDocumentSide && currentDocumentSide.url ? (<img src={currentDocumentSide.url} alt={`${getDocumentDisplayName(currentDocument?.type || "pan_card")} - ${selectedSide}`} className="max-w-full max-h-full object-contain drop-shadow-lg" onLoad={() => {console.log(`[IMAGE] ? Successfully loaded fullscreen ${selectedSide} for ${getDocumentDisplayName(currentDocument?.type || "pan_card")}`);}} onError={(e) => {console.error(`[IMAGE] ? Failed to load fullscreen ${selectedSide}`, e);}} />) : (<div className="text-center text-gray-500 space-y-2"><p className="text-sm font-medium">No document image available</p></div>)}
                           </div>
                         </div>
                       </div>
                     </div>
                   )}


                  <div className="border-t border-gray-200 px-4 py-3 flex gap-2 overflow-x-auto bg-white">
                    {instructor.documents.map((doc) => {
                      const docStatus = documentStatuses[doc.id];
                      const isDocSelected = selectedDocumentId === doc.id;
                      const statusDotColor = docStatus === "approved" ? "#00CE84" : "#EF4444";

                      return (
                        <button
                          key={doc.id}
                          onClick={() => {
                            setSelectedDocumentId(doc.id);
                            setSelectedSide("front");
                          }}
                          className={cn(
                            "relative px-3 py-2 rounded-lg text-xs font-medium transition-all flex-shrink-0 border",
                            isDocSelected
                              ? "bg-white text-teal-600 border-teal-400"
                              : "bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200"
                          )}
                        >
                          {getDocumentDisplayName(doc.type).split(" ")[0]}
                          <div
                            className="absolute -top-1 -right-1 h-2 w-2 rounded-full border-2 border-white shadow-sm"
                            style={{ backgroundColor: statusDotColor }}
                          ></div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-96 text-gray-500">
                  <p>No document selected</p>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-5">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-gray-900">Documents</h3>
                <span className="text-xs text-gray-600">
                  {approvedCount} / {instructor.totalCount} approved
                </span>
              </div>

              <div className="space-y-2">
                {instructor.documents.map((doc) => {
                  const isSelected = selectedDocumentId === doc.id;
                  const status = documentStatuses[doc.id] || doc.status;

                  return (
                    <div
                      key={doc.id}
                      onClick={() => setSelectedDocumentId(doc.id)}
                      className={cn(
                        "p-4 rounded-lg border transition-all cursor-pointer",
                        isSelected
                          ? "bg-white border-gray-200 shadow-sm"
                          : "border-gray-100 hover:bg-gray-50"
                      )}
                      style={isSelected ? { borderLeftWidth: "4px", borderLeftColor: "#00CE84", backgroundColor: "#E1F8F1" } : {}}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 mb-1">
                            {getDocumentDisplayName(doc.type)}
                          </p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {doc.number}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          {status === "pending" && isSelected ? (
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleApproveDocument(doc.id);
                                }}
                                className="h-9 w-9 rounded-lg bg-white border border-gray-300 flex items-center justify-center text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRejectDocument(doc.id);
                                }}
                                className="h-9 w-9 rounded-lg bg-white border border-gray-300 flex items-center justify-center text-gray-700 hover:border-red-300 hover:bg-red-50 transition-all"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : status === "approved" ? (
                            <div className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-2" style={{backgroundColor: '#DDF8EF', color: '#00CE84'}}>
                              <span>?</span>
                              <span>Approved</span>
                            </div>
                          ) : status === "rejected" ? (
                            <div className="flex items-center gap-2">
                              {/* Reupload button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenReuploadModal(doc.id);
                                }}
                                className="p-1.5 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100 hover:border-blue-300 transition-all"
                                title="Reupload rejected document"
                              >
                                <Upload className="h-4 w-4" />
                              </button>
                              {/* Rejected badge */}
                              <div className="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex items-center gap-2" style={{backgroundColor: '#FDECEC', color: '#EF4444'}}>
                                <span>?</span>
                                <span>Rejected</span>
                              </div>
                            </div>
                          ) : (
                            <div className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap bg-gray-100 text-gray-700">
                              Pending
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {instructor.rejectionNote && (
                <div className="border-t border-gray-200 px-4 py-4" style={{ backgroundColor: '#F9FAFB' }}>
                  <p className="text-xs text-gray-600 mb-3">
                    {instructor.rejectionNote}
                  </p>
                </div>
              )}

              <button
                onClick={handleApproveStage1}
                disabled={approvedCount !== instructor.totalCount}
                className="w-full font-semibold py-2.5 px-4 rounded-lg transition-all text-sm text-white"
                style={{
                  backgroundColor: approvedCount === instructor.totalCount ? "#00CE84" : "#DDF8EF",
                  color: approvedCount === instructor.totalCount ? "white" : "#00CE84",
                  cursor: approvedCount === instructor.totalCount ? "pointer" : "not-allowed"
                }}
              >
                Approve Stage 1 - Mark Active
              </button>
            </div>
          </div>
        </div>
        </>
        )}

        {isStage2 && instructor.videos && (
        <>
        {/* Stage 2 - Pedal Video Review */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full font-bold text-base flex-shrink-0"
              style={{ backgroundColor: "#DDF8EF", color: "#00CE84" }}
            >
              {instructor.initials || getInitials(instructor.name)}
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{instructor.name}</h2>
              <p className="text-sm text-gray-600">
                {instructor.phone} • video uploaded {formatDistanceToNow(parseISO(instructor.lastVideoUploadedAt || instructor.applied_at), { addSuffix: true })}
              </p>
            </div>
          </div>

          {/* Stepper Progress */}
          <div className="flex items-center gap-3">
            {/* Stage 1 - Completed */}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 text-white font-bold">
                <Check className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium text-gray-600">Documents</span>
            </div>

            {/* Separator */}
            <span className="text-gray-400">�</span>

            {/* Stage 2 - Active */}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-900 font-bold text-gray-900" style={{ backgroundColor: "#DDF8EF" }}>
                2
              </div>
              <span className="text-sm font-bold text-gray-900">Pedal video</span>
            </div>

            {/* Separator */}
            <span className="text-gray-400">�</span>

            {/* Stage 3 - Future */}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-gray-300 font-bold text-gray-400">
                <Check className="h-4 w-4" />
              </div>
              <span className="text-sm font-medium text-gray-400">Matchable</span>
            </div>
          </div>
        </div>

        {/* Video and Verification Content */}
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          {/* Left - Video Player */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              {/* Video Title */}
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{instructor.videos[0].title}</h3>
                  {actualVideoDuration && (
                    <span className="inline-block mt-1 px-3 py-1 rounded-full bg-purple-600 text-white text-xs font-semibold">
                      {actualVideoDuration}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-3 w-3 rounded-full ${isVideoPlaying ? "bg-red-500 animate-pulse" : "bg-gray-400"}`}></span>
                  <span className="text-xs font-medium text-gray-600">{isVideoPlaying ? "Playing" : "Paused"}</span>
                </div>
              </div>

              {/* Video Player */}
              <div className="bg-black relative overflow-hidden" style={{ aspectRatio: "16/9" }}>
                <video
                  ref={videoRef}
                  width="100%"
                  height="100%"
                  controls
                  className="w-full h-full object-cover"
                  style={{
                    transform: videoViewMode === "close" ? "scale(1.5)" : videoViewMode === "wide" ? "scale(0.9)" : "scale(1)",
                    transformOrigin: "center center",
                    transition: "transform 0.3s ease-in-out"
                  }}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onEnded={() => setIsVideoPlaying(false)}
                >
                  <source
                    src={instructor.videos?.[0]?.url || ""}
                    type="video/mp4"
                  />
                  Your browser does not support the video tag.
                </video>
              </div>

              {/* Video Controls */}
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-2">
                <button
                  onClick={() => setVideoViewMode("front")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded border transition-all",
                    videoViewMode === "front"
                      ? "border-cyan-500 text-cyan-600 bg-cyan-50"
                      : "border-gray-300 text-gray-700 bg-white hover:border-gray-400"
                  )}
                >
                  Front
                </button>
                <button
                  onClick={() => setVideoViewMode("close")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded border transition-all",
                    videoViewMode === "close"
                      ? "border-cyan-500 text-cyan-600 bg-cyan-50"
                      : "border-gray-300 text-gray-700 bg-white hover:border-gray-400"
                  )}
                >
                  Close
                </button>
                <button
                  onClick={() => setVideoViewMode("wide")}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded border transition-all",
                    videoViewMode === "wide"
                      ? "border-cyan-500 text-cyan-600 bg-cyan-50"
                      : "border-gray-300 text-gray-700 bg-white hover:border-gray-400"
                  )}
                >
                  Wide
                </button>
              </div>
            </div>
          </div>

          {/* Right - Verification Checklist */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden sticky top-6">
              {/* Card Title */}
              <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900">Pedal video</h3>
              </div>

              {/* Verification Section */}
              <div className="px-4 py-4">
                <p className="text-xs font-semibold text-gray-500 mb-3">VERIFY BEFORE APPROVING</p>
                <ul className="space-y-2">
                  {instructor.verificationChecklist.map((item) => (
                    <li key={item.id} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-green-500 font-bold flex-shrink-0">?</span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Video Info */}
              <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
                <p className="font-semibold text-gray-900 text-sm mb-1">Pedal installation video</p>
                <p className="text-xs text-gray-500">
                  uploaded {formatDistanceToNow(parseISO(instructor.videos[0].uploadedAt), { addSuffix: true })} � {instructor.videos[0].angles} angles
                </p>
              </div>

              {/* Approve/Reject Buttons */}
              <div className="px-4 py-3 border-t border-gray-200 flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleApproveVideo(instructor.videos[0].id);
                  }}
                  className="h-9 w-9 rounded-lg bg-white border border-gray-300 flex items-center justify-center text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all"
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRejectVideo(instructor.videos[0].id);
                  }}
                  className="h-9 w-9 rounded-lg bg-white border border-gray-300 flex items-center justify-center text-gray-700 hover:border-red-300 hover:bg-red-50 transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* CTA Button */}
              <button
                 onClick={() => console.log("Stage 2 approved")}
                 className="w-full font-semibold py-2.5 px-4 rounded-lg transition-all text-sm text-white"
                 style={{ backgroundColor: "#00CE84" }}
              >
                Approve Stage 2 - Enable Matching
              </button>
            </div>
          </div>
        </div>
        </>
        )}

      {/* Rejection Modal */}
      {isRejectionModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={() => setIsRejectionModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">
                Reject � {currentDocument ? getDocumentDisplayName(currentDocument.type) : "Document"}
              </h2>
              <button
                onClick={() => setIsRejectionModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Instruction */}
            <p className="text-sm text-gray-600 mb-4">
              Pick a reason from the template. The instructor is asked to re-upload with your note.
            </p>

            {/* Reason Dropdown */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                Reason Template
              </label>
              <div className="relative">
                <button
                  onClick={() => setIsReasonDropdownOpen(!isReasonDropdownOpen)}
                  className="w-full px-4 py-2.5 border-2 border-emerald-400 rounded-lg text-left font-medium text-gray-900 bg-white hover:bg-gray-50 flex items-center justify-between transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400"
                >
                  <span>
                    {REJECTION_REASONS.find((r) => r.id === selectedRejectionReason)?.label}
                  </span>
                  <ChevronDown
                    size={20}
                    className={cn(
                      "text-gray-400 transition-transform",
                      isReasonDropdownOpen && "rotate-180"
                    )}
                  />
                </button>

                {isReasonDropdownOpen && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10">
                    {REJECTION_REASONS.map((reason) => (
                      <button
                        key={reason.id}
                        onClick={() => {
                          setSelectedRejectionReason(reason.id);
                          setIsReasonDropdownOpen(false);
                        }}
                        className={cn(
                          "w-full px-4 py-2.5 text-left text-sm font-medium transition-colors first:rounded-t-lg last:rounded-b-lg",
                          selectedRejectionReason === reason.id
                            ? "bg-blue-500 text-white"
                            : "text-gray-900 hover:bg-gray-50"
                        )}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Backend Tag Info */}
              {REJECTION_REASONS.find((r) => r.id === selectedRejectionReason) && (
                <p className="text-xs text-gray-500 mt-1">
                  sent to backend as{" "}
                  <span className="font-mono text-purple-600 font-semibold">
                    {REJECTION_REASONS.find((r) => r.id === selectedRejectionReason)?.backendTag}
                  </span>
                </p>
              )}
            </div>

            {/* Message Textarea */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                Message to Instructor
              </label>
              <textarea
                value={rejectionMessage}
                onChange={(e) => setRejectionMessage(e.target.value)}
                placeholder="Enter a message for the instructor..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none"
                rows={4}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setIsRejectionModalOpen(false)}
                className="px-6 py-2 border border-gray-300 rounded-lg font-medium text-gray-900 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const reason = REJECTION_REASONS.find(
                    (r) => r.id === selectedRejectionReason
                  );
                  if (reason && rejectionDocumentId) {
                    handleConfirmRejectDocument(
                      rejectionDocumentId,
                      reason.label,
                      rejectionMessage,
                      reason.backendTag
                    );
                  }
                }}
                className="px-6 py-2 bg-white text-red-500 font-semibold rounded-lg border-2 border-red-500 hover:bg-red-50 transition-colors"
              >
                Reject & notify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Video Rejection Modal */}
      {isVideoRejectionModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setIsVideoRejectionModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Request re-upload � Pedal video</h2>
              <button
                onClick={() => setIsVideoRejectionModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="px-6 py-6">
              {/* Instructions */}
              <p className="text-sm text-gray-600 mb-6">
                Pick a reason from the template. The instructor is asked to record and upload again.
              </p>

              {/* Reason Dropdown Section */}
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                  Reason Template
                </label>
                <div className="relative">
                  <button
                    onClick={() => setIsVideoReasonDropdownOpen(!isVideoReasonDropdownOpen)}
                    className="w-full px-4 py-2.5 border-2 border-emerald-400 rounded-lg text-left font-medium text-gray-900 bg-white hover:bg-gray-50 flex items-center justify-between transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  >
                    <span>
                      {PEDAL_VIDEO_REJECTION_REASONS.find((r) => r.id === selectedVideoRejectionReason)?.label}
                    </span>
                    <ChevronDown
                      size={20}
                      className={cn(
                        "text-gray-400 transition-transform",
                        isVideoReasonDropdownOpen && "rotate-180"
                      )}
                    />
                  </button>

                  {isVideoReasonDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-10">
                      {PEDAL_VIDEO_REJECTION_REASONS.map((reason) => (
                        <button
                          key={reason.id}
                          onClick={() => {
                            setSelectedVideoRejectionReason(reason.id);
                            setIsVideoReasonDropdownOpen(false);
                          }}
                          className={cn(
                            "w-full px-4 py-2.5 text-left text-sm font-medium transition-colors first:rounded-t-lg last:rounded-b-lg",
                            selectedVideoRejectionReason === reason.id
                              ? "bg-blue-500 text-white"
                              : "text-gray-900 hover:bg-gray-50"
                          )}
                        >
                          {reason.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Backend Tag Info */}
                {PEDAL_VIDEO_REJECTION_REASONS.find((r) => r.id === selectedVideoRejectionReason) && (
                  <p className="text-xs text-gray-500 mt-1">
                    sent to backend as{" "}
                    <span className="font-mono text-purple-600 font-semibold">
                      {PEDAL_VIDEO_REJECTION_REASONS.find((r) => r.id === selectedVideoRejectionReason)?.backendTag}
                    </span>
                  </p>
                )}
              </div>

              {/* Message Textarea */}
              <div className="mb-6">
                <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">
                  Message to Instructor
                </label>
                <textarea
                  value={videoRejectionMessage}
                  onChange={(e) => setVideoRejectionMessage(e.target.value)}
                  placeholder="Enter a message for the instructor..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent resize-none"
                  rows={4}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setIsVideoRejectionModalOpen(false)}
                  className="px-6 py-2 border border-gray-300 rounded-lg font-medium text-gray-900 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const reason = PEDAL_VIDEO_REJECTION_REASONS.find(
                      (r) => r.id === selectedVideoRejectionReason
                    );
                    if (reason && rejectionVideoId) {
                      handleConfirmRejectVideo(
                        rejectionVideoId,
                        reason.label,
                        videoRejectionMessage,
                        reason.backendTag
                      );
                    }
                  }}
                  className="px-6 py-2 bg-white text-red-500 font-semibold rounded-lg border-2 border-red-500 hover:bg-red-50 transition-colors"
                >
                  Send request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      </div>
      
      {/* Reupload Document Modal */}
      {isReuploadModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">Reupload Document</h2>
              <button
                onClick={handleReuploadModalClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            {(() => {
              const reuploadingDoc = instructor.documents.find(doc => doc.id === reuploadDocumentId);
              return (
                <>
            <div className="p-6 space-y-4">
              {/* Document Info */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm text-gray-600">Document</p>
                    <p className="text-base font-semibold text-gray-900">
                      {reuploadingDoc && getDocumentDisplayName(reuploadingDoc.type)}
                    </p>
                  </div>
                </div>
                {reuploadingDoc?.number && (
                  <div>
                    <p className="text-xs text-gray-600">Number</p>
                    <p className="text-sm font-medium text-gray-700">
                      {reuploadingDoc.number}
                    </p>
                  </div>
                )}
              </div>

              {/* Side-by-side File Upload Areas */}
              <div className="grid grid-cols-2 gap-4">
                {/* Front Side Upload */}
                <div
                  onDragEnter={(e) => handleReuploadDrag(e, "front")}
                  onDragLeave={(e) => handleReuploadDrag(e, "front")}
                  onDragOver={(e) => handleReuploadDrag(e, "front")}
                  onDrop={(e) => handleReuploadDrop(e, "front")}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    reuploadDragActiveFront
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-300 bg-gray-50 hover:border-gray-400"
                  }`}
                  onClick={() => reuploadFrontFileInputRef.current?.click()}
                >
                  <input
                    ref={reuploadFrontFileInputRef}
                    type="file"
                    onChange={(e) => handleReuploadInputChange(e, "front")}
                    accept="image/jpeg,image/png,application/pdf"
                    className="hidden"
                  />

                  <div className="text-center">
                    <Upload className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-gray-900 mb-1">
                      FRONT
                    </p>
                    <p className="text-xs text-gray-600 mb-2">
                      Click or drag
                    </p>
                  </div>
                </div>

                {/* Back Side Upload */}
                <div
                  onDragEnter={(e) => handleReuploadDrag(e, "back")}
                  onDragLeave={(e) => handleReuploadDrag(e, "back")}
                  onDragOver={(e) => handleReuploadDrag(e, "back")}
                  onDrop={(e) => handleReuploadDrop(e, "back")}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                    reuploadDragActiveBack
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-300 bg-gray-50 hover:border-gray-400"
                  }`}
                  onClick={() => reuploadBackFileInputRef.current?.click()}
                >
                  <input
                    ref={reuploadBackFileInputRef}
                    type="file"
                    onChange={(e) => handleReuploadInputChange(e, "back")}
                    accept="image/jpeg,image/png,application/pdf"
                    className="hidden"
                  />

                  <div className="text-center">
                    <Upload className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-gray-900 mb-1">
                      BACK
                    </p>
                    <p className="text-xs text-gray-600 mb-2">
                      Click or drag
                    </p>
                  </div>
                </div>
              </div>

              {/* File Previews - Side by side */}
              {(reuploadFrontFile || reuploadBackFile) && (
                <div className="pt-4 border-t border-gray-200">
                  <p className="text-sm font-medium text-gray-900 mb-3">Selected Files</p>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Front Preview */}
                    {reuploadFrontFile && (
                      <div className="space-y-2">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                          <p className="text-xs font-semibold text-blue-900 mb-2">FRONT</p>
                          <div className="bg-white border border-gray-200 rounded p-2">
                            <p className="text-xs text-gray-700 break-words">
                              {reuploadFrontFile.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {(reuploadFrontFile.size / 1024).toFixed(2)} KB
                            </p>
                          </div>

                          {/* Front Image Preview */}
                          {reuploadFrontPreview && (
                            <div className="mt-2">
                              <div className="border border-gray-200 rounded overflow-hidden">
                                <img
                                  src={reuploadFrontPreview}
                                  alt="Front Preview"
                                  className="w-full h-auto max-h-32 object-contain"
                                />
                              </div>
                            </div>
                          )}

                          {/* Clear Front */}
                          <button
                            onClick={() => {
                              setReuploadFrontFile(null);
                              setReuploadFrontPreview("");
                              if (reuploadFrontFileInputRef.current) {
                                reuploadFrontFileInputRef.current.value = "";
                              }
                            }}
                            className="text-xs text-red-600 hover:text-red-700 transition-colors mt-2"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Back Preview */}
                    {reuploadBackFile && (
                      <div className="space-y-2">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                          <p className="text-xs font-semibold text-green-900 mb-2">BACK</p>
                          <div className="bg-white border border-gray-200 rounded p-2">
                            <p className="text-xs text-gray-700 break-words">
                              {reuploadBackFile.name}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              {(reuploadBackFile.size / 1024).toFixed(2)} KB
                            </p>
                          </div>

                          {/* Back Image Preview */}
                          {reuploadBackPreview && (
                            <div className="mt-2">
                              <div className="border border-gray-200 rounded overflow-hidden">
                                <img
                                  src={reuploadBackPreview}
                                  alt="Back Preview"
                                  className="w-full h-auto max-h-32 object-contain"
                                />
                              </div>
                            </div>
                          )}

                          {/* Clear Back */}
                          <button
                            onClick={() => {
                              setReuploadBackFile(null);
                              setReuploadBackPreview("");
                              if (reuploadBackFileInputRef.current) {
                                reuploadBackFileInputRef.current.value = "";
                              }
                            }}
                            className="text-xs text-red-600 hover:text-red-700 transition-colors mt-2"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex gap-3 p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={handleReuploadModalClose}
                disabled={isReuploadLoading}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReupload}
                disabled={!reuploadFrontFile || !reuploadBackFile || isReuploadLoading}
                className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isReuploadLoading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Uploading...
                  </>
                ) : !reuploadFrontFile || !reuploadBackFile ? (
                  "Upload both Front & Back"
                ) : (
                  "Reupload"
                )}
              </button>
            </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
      </div>
    </>
  );
}






