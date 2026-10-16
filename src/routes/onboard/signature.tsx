import {
  ArrowLeft,
  Eraser,
  FileText,
  Loader2,
  PenLine,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { useLearner, useLearnerUpdate } from "@/queries/learner";

const TERMS_VERSION = "rto-signature-2026-09-07";
const PRIVACY_VERSION = "privacy-2026-09-07";
const SIGNATURE_PURPOSE = "RTO documentation, including Form 14 and Form 15";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = ["image/png", "image/jpeg"];

type SignatureMode = "draw" | "upload";

const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare the signature image."));
    }, "image/png");
  });

export default function OnboardingSignature() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: learner, isLoading: learnerLoading } = useLearner();
  const updateLearner = useLearnerUpdate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });

  const [mode, setMode] = useState<SignatureMode>("draw");
  const [hasDrawing, setHasDrawing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const prepareCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rect.width, rect.height);
    context.strokeStyle = "#111827";
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.lineJoin = "round";
    setHasDrawing(false);
  }, []);

  useEffect(() => {
    prepareCanvas();
  }, [prepareCanvas]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
  };

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;

    const point = pointFromEvent(event);
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
    setHasDrawing(true);
  };

  const stopDrawing = () => {
    drawingRef.current = false;
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setError("");
    if (!file) return;
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setError("Upload a PNG or JPG image.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("The signature image must be smaller than 5 MB.");
      event.target.value = "";
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const submit = async () => {
    setError("");
    if (!accepted) {
      setError("Accept the terms and signature-use consent to continue.");
      return;
    }
    if (mode === "draw" && !hasDrawing) {
      setError("Please draw your signature before continuing.");
      return;
    }
    if (mode === "upload" && !uploadedFile) {
      setError("Please upload your signature before continuing.");
      return;
    }
    if (!user?.id || !learner?.id) {
      setError(
        "Your learner account could not be loaded. Please log in again.",
      );
      return;
    }

    setIsSubmitting(true);
    let storagePath: string | null = null;
    try {
      const signatureFile =
        mode === "draw" ? await canvasBlob(canvasRef.current!) : uploadedFile!;
      const mimeType = mode === "draw" ? "image/png" : signatureFile.type;
      const extension = mimeType === "image/jpeg" ? "jpg" : "png";
      storagePath = `${user.id}/${learner.id}/${crypto.randomUUID()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("learner-signatures")
        .upload(storagePath, signatureFile, {
          contentType: mimeType,
          cacheControl: "3600",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const acceptedAt = new Date().toISOString();
      await updateLearner.mutateAsync({
        signature_storage_path: storagePath,
        signature_submitted_at: acceptedAt,
        signature_consent_at: acceptedAt,
        signature_terms_version: TERMS_VERSION,
        signature_privacy_version: PRIVACY_VERSION,
        signature_purpose: SIGNATURE_PURPOSE,
        signature_method: mode,
        signature_mime_type: mimeType,
        onboarding_completed: true,
      });

      localStorage.setItem("onboardingDone", "true");
      navigate("/home", { replace: true });
    } catch (submissionError) {
      if (storagePath) {
        await supabase.storage.from("learner-signatures").remove([storagePath]);
      }
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Could not save your signature. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (learnerLoading) return <div className="p-6">Loading...</div>;
  if (!learner) return <Navigate to="/login" replace />;
  if (learner.onboarding_completed) return <Navigate to="/home" replace />;
  if (!learner.dob) return <Navigate to="/onboard/birthday" replace />;
  if (!learner.driving_motivation) {
    return <Navigate to="/onboard/aadhar" replace />;
  }

  return (
    <div className="flex min-h-full w-full flex-col bg-white">
      <div className="rounded-b-[40px] bg-primary text-primary-foreground">
        <div className="flex items-center justify-between p-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary-foreground"
            onClick={() => navigate("/onboard/aadhar")}
          >
            <ArrowLeft className="h-6 w-6" />
          </Button>
          <span className="text-lg font-semibold">3/3</span>
        </div>
        <div className="px-6 pb-7">
          <h1 className="mb-2 text-2xl font-semibold">RTO e-signature</h1>
          <p className="text-sm text-primary-foreground/90">
            Complete your onboarding by submitting your signature for required
            RTO documentation.
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-6 pb-32">
        <section className="space-y-3 rounded-xl border bg-gray-50 p-4 text-sm text-gray-700">
          <div className="flex gap-3">
            <FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h2 className="font-semibold text-gray-900">
                Why we need your signature
              </h2>
              <p className="mt-1">
                Your signature is required for RTO documentation, including Form
                14 and Form 15, and to comply with applicable RTO requirements.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h2 className="font-semibold text-gray-900">How we use it</h2>
              <p className="mt-1">
                We will use your signature only for the stated documentation
                purpose and will handle it as sensitive personal information.
              </p>
            </div>
          </div>
          <p>
            Read our{" "}
            <a
              href="https://inlane.in/terms-and-conditions"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline"
            >
              Terms and Conditions
            </a>{" "}
            and{" "}
            <a
              href="https://inlane.in/privacy-policy"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline"
            >
              Privacy Policy
            </a>
            .
          </p>
        </section>

        <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setMode("draw")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
              mode === "draw"
                ? "bg-white text-primary shadow"
                : "text-gray-600",
            )}
          >
            <PenLine className="h-4 w-4" /> Draw
          </button>
          <button
            type="button"
            onClick={() => setMode("upload")}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
              mode === "upload"
                ? "bg-white text-primary shadow"
                : "text-gray-600",
            )}
          >
            <Upload className="h-4 w-4" /> Upload
          </button>
        </div>

        {mode === "draw" ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-white">
              <canvas
                ref={canvasRef}
                className="h-48 w-full cursor-crosshair touch-none"
                aria-label="Draw your signature"
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={stopDrawing}
                onPointerCancel={stopDrawing}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Sign inside the box using your finger or pointer.</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={prepareCanvas}
              >
                <Eraser className="mr-1 h-4 w-4" /> Clear
              </Button>
            </div>
          </div>
        ) : (
          <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-4 text-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Signature preview"
                className="max-h-40 object-contain"
              />
            ) : (
              <>
                <Upload className="mb-2 h-8 w-8 text-primary" />
                <span className="font-medium">Choose signature image</span>
                <span className="mt-1 text-xs text-muted-foreground">
                  PNG or JPG · maximum 5 MB
                </span>
              </>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={handleFileChange}
            />
          </label>
        )}

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm">
          <Checkbox
            checked={accepted}
            onCheckedChange={(checked) => setAccepted(checked === true)}
            className="mt-0.5"
          />
          <span>
            I have read and accept the Terms and Conditions and Privacy Policy.
            I consent to InLane storing and using my signature only for RTO
            documentation, including Form 14 and Form 15.
          </span>
        </label>

        {error && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-md border-t bg-white p-4">
        <Button
          className="w-full"
          onClick={submit}
          disabled={
            isSubmitting ||
            !accepted ||
            (mode === "draw" ? !hasDrawing : !uploadedFile)
          }
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving
              signature...
            </>
          ) : (
            "Submit and complete onboarding"
          )}
        </Button>
      </div>
    </div>
  );
}
