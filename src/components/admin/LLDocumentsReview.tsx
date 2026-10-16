import { format } from "date-fns";
import {
  CheckCircle2,
  ExternalLink,
  FileText,
  Upload,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  LL_DOC_TYPE_MAP,
  LL_FORM_FIELDS,
  llDocSlotLabel,
} from "@/constants/llPipeline";
import {
  LLApplication,
  LLDocument,
  llDocumentUrl,
  useAdminReplaceLLDocument,
  useLLDocuments,
  useReviewLLDocument,
} from "@/queries/llApplications";

const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * RTO-team review of the customer's in-app LL form submission: the answers
 * they filled and every uploaded document, each individually approvable or
 * rejectable. Overall approve/reject stays in "Move this application"
 * (→ Meet Booking Enabled, or Docs Rejected / Incomplete).
 */
export default function LLDocumentsReview({
  application,
  actorName,
}: {
  application: LLApplication;
  actorName: string | null;
}) {
  const { toast } = useToast();
  const { data: documents, isLoading } = useLLDocuments(application.id);
  const review = useReviewLLDocument();
  const replace = useAdminReplaceLLDocument();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const formData = application.form_data;

  if (!formData && !isLoading && (documents ?? []).length === 0) {
    return (
      <div className="rounded-md border p-3">
        <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          Submitted Form &amp; Documents
        </div>
        <p className="text-sm text-gray-400">
          The customer hasn&apos;t submitted the LL application form yet.
        </p>
      </div>
    );
  }

  const docLabel = (d: LLDocument) => {
    const def = LL_DOC_TYPE_MAP[d.doc_type];
    const subtype = def?.subtypes.find((s) => s.key === d.doc_subtype)?.label;
    const slot = llDocSlotLabel(def, d.doc_slot || "primary", d.doc_subtype);
    const parts = [def?.label ?? d.doc_type];
    if (subtype) parts.push(subtype);
    if (slot) parts.push(slot);
    return parts.join(" · ");
  };

  const verdict = (
    doc: LLDocument,
    status: "approved" | "rejected",
    rejectionReason?: string,
  ) =>
    review.mutate(
      { doc, status, rejectionReason, actorName, docLabel: docLabel(doc) },
      {
        onSuccess: () => {
          setRejectingId(null);
          setReason("");
        },
        onError: (e: Error) =>
          toast({
            title: "Error",
            description: e.message,
            variant: "destructive",
          }),
      },
    );

  const knownKeys = new Set(LL_FORM_FIELDS.map((f) => f.key));

  const replaceRejectedDocument = (doc: LLDocument, file?: File) => {
    if (!file) return;
    if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
      toast({
        title: "File is too large",
        description: "Please choose an image or PDF under 10 MB.",
        variant: "destructive",
      });
      return;
    }

    replace.mutate(
      { application, doc, file, actorName, docLabel: docLabel(doc) },
      {
        onSuccess: ({ returnedToReview }) =>
          toast({
            title: "Document replaced",
            description: returnedToReview
              ? "All rejected documents have been replaced. The application is back under review."
              : "The replacement is pending review.",
          }),
        onError: (e: Error) =>
          toast({
            title: "Upload failed",
            description: e.message,
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        Submitted Form &amp; Documents
        {application.form_submitted_at && (
          <span className="ml-2 font-normal normal-case text-gray-400">
            submitted{" "}
            {format(
              new Date(application.form_submitted_at),
              "dd MMM yyyy, HH:mm",
            )}
          </span>
        )}
      </div>

      {formData && (
        <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
          {LL_FORM_FIELDS.filter((f) => formData[f.key]).map((f) => (
            <div key={f.key}>
              <div className="text-[11px] text-gray-500">{f.label}</div>
              <div className="text-sm">{formData[f.key]}</div>
            </div>
          ))}
          {Object.entries(formData)
            .filter(([k, v]) => !knownKeys.has(k) && v)
            .map(([k, v]) => (
              <div key={k}>
                <div className="text-[11px] text-gray-500">{k}</div>
                <div className="text-sm">{v}</div>
              </div>
            ))}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">Loading documents…</p>
      ) : (documents ?? []).length === 0 ? (
        <p className="text-sm text-gray-400">No documents uploaded.</p>
      ) : (
        <ul className="space-y-2">
          {(documents ?? []).map((d) => (
            <li key={d.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <a
                  href={llDocumentUrl(d)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  {docLabel(d)}
                  <ExternalLink className="h-3 w-3" />
                </a>
                <div className="flex items-center gap-2">
                  <DocStatusBadge doc={d} />
                  {d.status !== "approved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-green-400 text-green-700 hover:bg-green-50"
                      disabled={review.isPending}
                      onClick={() => verdict(d, "approved")}
                    >
                      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                  )}
                  {d.status !== "rejected" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-red-300 text-red-600 hover:bg-red-50"
                      disabled={review.isPending}
                      onClick={() =>
                        setRejectingId(rejectingId === d.id ? null : d.id)
                      }
                    >
                      <XCircle className="mr-1 h-3.5 w-3.5" /> Reject
                    </Button>
                  )}
                  {d.status === "rejected" && (
                    <>
                      <input
                        id={`replace-ll-document-${d.id}`}
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        disabled={replace.isPending}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          replaceRejectedDocument(d, file);
                        }}
                      />
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-7 border-blue-300 text-blue-700 hover:bg-blue-50"
                        disabled={replace.isPending}
                      >
                        <label htmlFor={`replace-ll-document-${d.id}`}>
                          <Upload className="mr-1 h-3.5 w-3.5" />
                          {replace.isPending &&
                          replace.variables?.doc.id === d.id
                            ? "Uploading…"
                            : "Replace document"}
                        </label>
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {d.mime_type?.startsWith("image/") && (
                <a
                  href={llDocumentUrl(d)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={llDocumentUrl(d)}
                    alt={docLabel(d)}
                    className="mt-2 max-h-32 rounded border object-contain"
                  />
                </a>
              )}
              {d.status === "rejected" && d.rejection_reason && (
                <p className="mt-1 text-xs text-red-600">
                  Reason: {d.rejection_reason}
                </p>
              )}
              {rejectingId === d.id && (
                <div className="mt-2 flex gap-2">
                  <Input
                    className="h-8 text-sm"
                    placeholder="Rejection reason (shown to the customer)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-8"
                    disabled={review.isPending || !reason.trim()}
                    onClick={() => verdict(d, "rejected", reason.trim())}
                  >
                    Confirm
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocStatusBadge({ doc }: { doc: LLDocument }) {
  const styles =
    doc.status === "approved"
      ? "border-green-300 bg-green-50 text-green-700"
      : doc.status === "rejected"
        ? "border-red-300 bg-red-50 text-red-700"
        : "border-blue-200 bg-blue-50 text-blue-700";
  return (
    <Badge variant="outline" className={`text-[10px] ${styles}`}>
      {doc.status}
      {doc.reviewed_by && doc.status !== "pending"
        ? ` · ${doc.reviewed_by}`
        : ""}
    </Badge>
  );
}
