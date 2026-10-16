import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, FileText, Loader2 } from "lucide-react";
import React, { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchTrainingPeriods,
  fetchTrainingSessions,
  loadLearnerSignature,
  SCHOOL_NAME,
  toForm15Sessions,
} from "@/utils/formsBulk";
import { Form5CertificateData, generateForm5PDF } from "@/utils/generateForm5";
import {
  downloadPDF,
  Form14Data,
  generateForm14PDF,
} from "@/utils/generateForm14";
import { Form15Data, generateForm15PDF } from "@/utils/generateForm15";

interface LearnerForForm14 {
  id: string;
  name: string | null;
  phone: string;
  email?: string | null;
  dob?: string | null;
  aadhar_state?: string | null;
  pick_up_location?: string | null;
  area?: string | null;
  city?: string | null;
  pincode?: string | null;
  created_at?: string;
  LL_application_id?: string | null;
  LL_received_date?: string | null;
  DL_id?: string | null;
  DL_received_date?: string | null;
  has_a_DL?: boolean | null;
  signature_storage_path?: string | null;
  signature_submitted_at?: string | null;
  signature_consent_at?: string | null;
  signature_terms_version?: string | null;
  signature_privacy_version?: string | null;
  signature_mime_type?: string | null;
  signature_method?: string | null;
}

interface Form14GeneratorProps {
  learner: LearnerForForm14;
  open: boolean;
  onClose: () => void;
}

export default function Form14Generator({
  learner,
  open,
  onClose,
}: Form14GeneratorProps) {
  const { toast } = useToast();
  const [generating, setGenerating] = useState<
    null | "14" | "15" | "5" | "all"
  >(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const isGenerating = generating !== null;

  useEffect(() => {
    let active = true;
    setSignatureUrl(null);
    if (!open || !learner.signature_storage_path) return;

    supabase.storage
      .from("learner-signatures")
      .createSignedUrl(learner.signature_storage_path, 10 * 60)
      .then(({ data, error }) => {
        if (!active || error) return;
        setSignatureUrl(data.signedUrl);
      });

    return () => {
      active = false;
    };
  }, [learner.signature_storage_path, open]);

  const safeName = () =>
    (learner.name || "learner").replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

  // Build address from available fields
  const buildAddress = () => {
    const parts = [
      learner.pick_up_location,
      learner.area,
      learner.city,
      learner.pincode,
      learner.aadhar_state,
    ].filter(Boolean);
    return parts.join(", ");
  };

  // Editable form state — pre-filled from DB, admin can override
  const [formData, setFormData] = useState({
    enrollmentNumber: learner.id?.substring(0, 8).toUpperCase() || "",
    name: learner.name || "",
    guardianRelation: "Son" as "Son" | "Wife" | "Daughter",
    guardianName: "",
    permanentAddress: buildAddress(),
    temporaryAddress: "",
    dob: learner.dob ? format(new Date(learner.dob), "dd/MM/yyyy") : "",
    vehicleClass: "LMV (Light Motor Vehicle)",
    enrollmentDate: learner.created_at
      ? format(new Date(learner.created_at), "dd/MM/yyyy")
      : format(new Date(), "dd/MM/yyyy"),
    llNumber: learner.LL_application_id || "",
    llExpiry: "",
    completionDate: "",
    competenceTestDate: "",
    dlNumber: learner.DL_id || "",
    dlIssueDate: learner.DL_received_date
      ? format(new Date(learner.DL_received_date), "dd/MM/yyyy")
      : "",
    dlAuthority: "",
    remarks: "",
    trainingFrom: "",
    trainingTo: "",
  });

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // First/last class from the Schedule table — the Form-5 training period.
  const { data: trainingPeriod } = useQuery({
    queryKey: ["trainingPeriod", learner.id],
    enabled: open && !!learner.id,
    queryFn: async () => {
      const periods = await fetchTrainingPeriods([learner.id]);
      return periods.get(learner.id) ?? null;
    },
  });

  // Every non-cancelled past class — the Form-15 driving-hours rows.
  const { data: trainingSessions } = useQuery({
    queryKey: ["trainingSessions", learner.id],
    enabled: open && !!learner.id,
    queryFn: async () => {
      const sessions = await fetchTrainingSessions([learner.id]);
      return sessions.get(learner.id) ?? [];
    },
  });

  useEffect(() => {
    if (!trainingPeriod) return;
    setFormData((prev) => ({
      ...prev,
      trainingFrom:
        prev.trainingFrom ||
        (trainingPeriod.first
          ? format(new Date(trainingPeriod.first), "dd/MM/yyyy")
          : ""),
      trainingTo:
        prev.trainingTo ||
        (trainingPeriod.last
          ? format(new Date(trainingPeriod.last), "dd/MM/yyyy")
          : ""),
    }));
  }, [trainingPeriod]);

  const buildForm14Data = (): Form14Data => ({
    enrollmentNumber: formData.enrollmentNumber,
    name: formData.name,
    guardianName: formData.guardianName
      ? `${formData.guardianRelation} of ${formData.guardianName}`
      : "",
    permanentAddress: formData.permanentAddress,
    temporaryAddress: formData.temporaryAddress || undefined,
    dob: formData.dob,
    vehicleClass: formData.vehicleClass,
    enrollmentDate: formData.enrollmentDate,
    llNumber: formData.llNumber,
    llExpiry: formData.llExpiry || undefined,
    completionDate: formData.completionDate || undefined,
    competenceTestDate: formData.competenceTestDate || undefined,
    dlNumber: formData.dlNumber || undefined,
    dlIssueDate: formData.dlIssueDate || undefined,
    dlAuthority: formData.dlAuthority || undefined,
    remarks: formData.remarks || undefined,
    phone: learner.phone,
    email: learner.email || undefined,
  });

  const buildForm15Data = async (): Promise<Form15Data> => {
    const learnerSignature = await loadLearnerSignature(
      learner.signature_storage_path,
      learner.signature_mime_type,
    );
    return {
      schoolName: SCHOOL_NAME.toUpperCase(),
      traineeName: formData.name,
      enrollmentNumber: formData.enrollmentNumber,
      enrollmentDate: formData.enrollmentDate,
      sessions: toForm15Sessions(trainingSessions ?? []),
      ...learnerSignature,
    };
  };

  const buildForm5Data = (): Form5CertificateData => ({
    certificateNo: formData.enrollmentNumber || undefined,
    date:
      formData.trainingTo ||
      formData.completionDate ||
      format(new Date(), "dd/MM/yyyy"),
    name: formData.name,
    // The certificate preprints "Son / Wife / Daughter of", so fill only the name.
    guardian: formData.guardianName || undefined,
    address: formData.permanentAddress || undefined,
    enrolledOn: formData.enrollmentDate,
    serialNumber: formData.enrollmentNumber || undefined,
    vehicleClass: formData.vehicleClass,
    periodFrom: formData.trainingFrom || formData.enrollmentDate,
    periodTo: formData.trainingTo || formData.completionDate || undefined,
  });

  const requireName = () => {
    if (formData.name) return true;
    toast({
      title: "Error",
      description: "Learner name is required",
      variant: "destructive",
    });
    return false;
  };

  const handleGenerate = async () => {
    if (!requireName()) return;

    setGenerating("14");
    try {
      const pdfBytes = await generateForm14PDF(buildForm14Data());
      downloadPDF(pdfBytes, `Form14_${safeName()}.pdf`);

      toast({
        title: "Success",
        description: "Form-14 PDF downloaded successfully!",
      });
      onClose();
    } catch (error) {
      console.error("Error generating Form-14:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to generate Form-14 PDF",
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateForm15 = async () => {
    if (!requireName()) return;
    setGenerating("15");
    try {
      const pdfBytes = await generateForm15PDF(await buildForm15Data());
      downloadPDF(pdfBytes, `Form15_${safeName()}.pdf`);
      toast({
        title: "Success",
        description: "Form-15 PDF downloaded successfully!",
      });
      onClose();
    } catch (error) {
      console.error("Error generating Form-15:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to generate Form-15 PDF",
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateForm5 = async () => {
    if (!requireName()) return;
    setGenerating("5");
    try {
      const pdfBytes = await generateForm5PDF(buildForm5Data());
      downloadPDF(pdfBytes, `Certificate_Form5_${safeName()}.pdf`);
      toast({
        title: "Success",
        description: "Certificate (Form-5) downloaded successfully!",
      });
      onClose();
    } catch (error) {
      console.error("Error generating Form-5 certificate:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to generate certificate",
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
  };

  const handleGenerateAll = async () => {
    if (!requireName()) return;
    setGenerating("all");
    try {
      const form15Data = await buildForm15Data();
      const [f14, f15, f5] = await Promise.all([
        generateForm14PDF(buildForm14Data()),
        generateForm15PDF(form15Data),
        generateForm5PDF(buildForm5Data()),
      ]);
      downloadPDF(f14, `Form14_${safeName()}.pdf`);
      downloadPDF(f15, `Form15_${safeName()}.pdf`);
      downloadPDF(f5, `Certificate_Form5_${safeName()}.pdf`);
      toast({
        title: "Success",
        description: "Form-14, Form-15 & Certificate downloaded!",
      });
      onClose();
    } catch (error) {
      console.error("Error generating all forms:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to generate forms",
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Generate Forms
          </DialogTitle>
          <DialogDescription>
            Form 14, Form 15 &amp; Certificate (Form 5) for{" "}
            {learner.name || "Learner"} — fields below are shared across all
            three.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Pre-filled info banner */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            Fields are pre-filled from learner data. Edit any field before
            generating the PDF.
          </div>

          <div
            className={`rounded-lg border p-3 text-sm ${
              learner.signature_storage_path
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">
                  {learner.signature_storage_path
                    ? learner.signature_consent_at
                      ? "Learner signature and consent received"
                      : "Learner signature uploaded by admin"
                    : "Learner signature pending"}
                </p>
                {learner.signature_submitted_at && (
                  <p className="mt-1 text-xs">
                    Submitted{" "}
                    {format(
                      new Date(learner.signature_submitted_at),
                      "dd MMM yyyy, h:mm a",
                    )}
                  </p>
                )}
              </div>
              {signatureUrl && (
                <Button type="button" size="sm" variant="outline" asChild>
                  <a href={signatureUrl} target="_blank" rel="noreferrer">
                    View signature
                  </a>
                </Button>
              )}
            </div>
          </div>

          {/* 1. Enrolment Number */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Enrolment No.
            </Label>
            <Input
              value={formData.enrollmentNumber}
              onChange={(e) => updateField("enrollmentNumber", e.target.value)}
              className="col-span-3"
              placeholder="Enrolment number"
            />
          </div>

          {/* 2. Name */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">Name</Label>
            <Input
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="col-span-3"
              placeholder="Full name of trainee"
            />
          </div>

          {/* 3. Son/Wife/Daughter of */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">Guardian</Label>
            <div className="col-span-3 flex gap-2">
              <Select
                value={formData.guardianRelation}
                onValueChange={(val) =>
                  updateField(
                    "guardianRelation",
                    val as "Son" | "Wife" | "Daughter",
                  )
                }
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Son">Son of</SelectItem>
                  <SelectItem value="Wife">Wife of</SelectItem>
                  <SelectItem value="Daughter">Daughter of</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={formData.guardianName}
                onChange={(e) => updateField("guardianName", e.target.value)}
                className="flex-1"
                placeholder="Father's / Spouse's name"
              />
            </div>
          </div>

          {/* 4a. Permanent Address */}
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="pt-2 text-right text-sm font-medium">
              Permanent Address
            </Label>
            <Input
              value={formData.permanentAddress}
              onChange={(e) => updateField("permanentAddress", e.target.value)}
              className="col-span-3"
              placeholder="Full permanent address"
            />
          </div>

          {/* 4b. Temporary Address */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Temp Address
            </Label>
            <Input
              value={formData.temporaryAddress}
              onChange={(e) => updateField("temporaryAddress", e.target.value)}
              className="col-span-3"
              placeholder="Temporary/official address (optional)"
            />
          </div>

          {/* 5. DOB */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Date of Birth
            </Label>
            <Input
              value={formData.dob}
              onChange={(e) => updateField("dob", e.target.value)}
              className="col-span-3"
              placeholder="DD/MM/YYYY"
            />
          </div>

          {/* 6. Class of Vehicle */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Vehicle Class
            </Label>
            <Input
              value={formData.vehicleClass}
              onChange={(e) => updateField("vehicleClass", e.target.value)}
              className="col-span-3"
            />
          </div>

          {/* 7. Date of Enrolment */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Enrolment Date
            </Label>
            <Input
              value={formData.enrollmentDate}
              onChange={(e) => updateField("enrollmentDate", e.target.value)}
              className="col-span-3"
              placeholder="DD/MM/YYYY"
            />
          </div>

          {/* 8. LL Number & Expiry */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">LL Number</Label>
            <div className="col-span-3 flex gap-2">
              <Input
                value={formData.llNumber}
                onChange={(e) => updateField("llNumber", e.target.value)}
                className="flex-1"
                placeholder="Learner's licence number"
              />
              <Input
                value={formData.llExpiry}
                onChange={(e) => updateField("llExpiry", e.target.value)}
                className="w-[140px]"
                placeholder="Expiry date"
              />
            </div>
          </div>

          {/* 9. Completion Date */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Course Completion
            </Label>
            <Input
              value={formData.completionDate}
              onChange={(e) => updateField("completionDate", e.target.value)}
              className="col-span-3"
              placeholder="DD/MM/YYYY (if completed)"
            />
          </div>

          {/* 9b. Training Period (first/last class — used on the Form-5 certificate) */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Training Period
            </Label>
            <div className="col-span-3 flex gap-2">
              <Input
                value={formData.trainingFrom}
                onChange={(e) => updateField("trainingFrom", e.target.value)}
                className="flex-1"
                placeholder="From (first class)"
              />
              <Input
                value={formData.trainingTo}
                onChange={(e) => updateField("trainingTo", e.target.value)}
                className="flex-1"
                placeholder="To (last class)"
              />
            </div>
          </div>

          {/* 10. Competence Test Date */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">
              Test Passed Date
            </Label>
            <Input
              value={formData.competenceTestDate}
              onChange={(e) =>
                updateField("competenceTestDate", e.target.value)
              }
              className="col-span-3"
              placeholder="DD/MM/YYYY (if passed)"
            />
          </div>

          {/* 11. DL Details */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">DL Number</Label>
            <div className="col-span-3 flex gap-2">
              <Input
                value={formData.dlNumber}
                onChange={(e) => updateField("dlNumber", e.target.value)}
                className="flex-1"
                placeholder="DL number"
              />
              <Input
                value={formData.dlAuthority}
                onChange={(e) => updateField("dlAuthority", e.target.value)}
                className="w-[140px]"
                placeholder="RTO authority"
              />
            </div>
          </div>

          {/* 12. Remarks */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right text-sm font-medium">Remarks</Label>
            <Input
              value={formData.remarks}
              onChange={(e) => updateField("remarks", e.target.value)}
              className="col-span-3"
              placeholder="Any additional remarks"
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <div className="flex w-full flex-wrap gap-2">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
            >
              {generating === "14" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Form 14
            </Button>
            <Button
              onClick={handleGenerateForm15}
              disabled={isGenerating}
              className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
            >
              {generating === "15" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Form 15
            </Button>
            <Button
              onClick={handleGenerateForm5}
              disabled={isGenerating}
              className="flex-1 bg-green-600 text-white hover:bg-green-700"
            >
              {generating === "5" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Certificate
            </Button>
          </div>
          <Button
            onClick={handleGenerateAll}
            disabled={isGenerating}
            className="w-full bg-indigo-600 text-white hover:bg-indigo-700"
          >
            {generating === "all" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download All 3
          </Button>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isGenerating}
            className="w-full"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
