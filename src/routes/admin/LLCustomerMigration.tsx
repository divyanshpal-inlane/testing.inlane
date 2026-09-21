import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Upload,
  UserPlus,
} from "lucide-react";
import { ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { COURSES_DATA } from "@/constants/courses";
import { downloadCSV } from "@/queries/lessonsDashboard";
import {
  existingPhones,
  importLLCustomer,
  phoneExists,
} from "@/queries/llMigration";
import {
  analyzeLLRows,
  buildTemplateCsv,
  LL_MIGRATION_COLUMNS,
  LLStage,
  parseCsv,
  ParsedLLRow,
} from "@/utils/llMigrationCsv";

type RowStatus = "valid" | "imported" | "duplicate" | "invalid";

const STAGE_LABELS: Record<LLStage, string> = {
  has_ll: "Already has LL (ready to schedule)",
  passed_waiting: "Passed test — awaiting physical LL",
  appointment_booked: "Appointment booked — application pending",
  not_started: "Not started (enters LL flow)",
};
const STAGE_ORDER: LLStage[] = [
  "has_ll",
  "passed_waiting",
  "appointment_booked",
  "not_started",
];
const NO_COURSE = "__none__";
const COURSE_OPTIONS = Object.values(COURSES_DATA);

const STATUS_BADGE: Record<RowStatus, string> = {
  valid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  imported: "border-emerald-300 bg-emerald-100 text-emerald-800",
  duplicate: "border-emerald-300 bg-emerald-100 text-emerald-800",
  invalid: "border-red-200 bg-red-50 text-red-700",
};

// User-facing labels — keep logic keys (valid/duplicate) but show create/successful.
const STATUS_LABEL: Record<RowStatus, string> = {
  valid: "create",
  imported: "successful",
  duplicate: "successful",
  invalid: "invalid",
};

// ---------------------------------------------------------------------------
// Single-customer form — builds one CSV-equivalent row and runs it through the
// exact same validation + insert path as the bulk import.
// ---------------------------------------------------------------------------
function SingleCustomerForm() {
  const { toast } = useToast();
  const blank = (): Record<string, string> => ({
    ll_stage: "has_ll",
    has_a_dl: "no",
    has_two_wheeler_license: "no",
    course: "",
  });
  const [form, setForm] = useState<Record<string, string>>(blank);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const values = LL_MIGRATION_COLUMNS.map((c) => form[c] ?? "");
    const { rows } = analyzeLLRows([[...LL_MIGRATION_COLUMNS], values]);
    const row = rows[0];
    if (!row) return;
    if (row.errors.length) {
      setErrors(row.errors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      if (await phoneExists(row.phone)) {
        setErrors(["A learner with this phone number already exists."]);
        return;
      }
      const err = await importLLCustomer(row);
      if (err) {
        toast({
          title: "Couldn't add customer",
          description: err,
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Customer added",
        description: `${row.name} migrated (${row.stage}).`,
      });
      setForm(blank());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name *">
            <Input
              value={form.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
          <Field label="Phone *">
            <Input
              value={form.phone ?? ""}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="10-digit"
            />
          </Field>
          <Field label="Email">
            <Input
              value={form.email ?? ""}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Date of birth">
            <Input
              type="date"
              value={form.dob ?? ""}
              onChange={(e) => set("dob", e.target.value)}
            />
          </Field>
          <Field label="Area / locality">
            <Input
              value={form.area ?? ""}
              onChange={(e) => set("area", e.target.value)}
            />
          </Field>
          <Field label="Pincode">
            <Input
              value={form.pincode ?? ""}
              onChange={(e) => set("pincode", e.target.value)}
            />
          </Field>
          <Field label="Pick-up location" className="sm:col-span-2">
            <Input
              value={form.pick_up_location ?? ""}
              onChange={(e) => set("pick_up_location", e.target.value)}
            />
          </Field>

          <Field label="LL stage">
            <Select
              value={form.ll_stage ?? "has_ll"}
              onValueChange={(v) => set("ll_stage", v)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAGE_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="LL application / number">
            <Input
              value={form.ll_application_id ?? ""}
              onChange={(e) => set("ll_application_id", e.target.value)}
            />
          </Field>
          <Field label="LL received date">
            <Input
              type="date"
              value={form.ll_received_date ?? ""}
              onChange={(e) => set("ll_received_date", e.target.value)}
            />
          </Field>
          <Field label="LL test date">
            <Input
              type="date"
              value={form.ll_test_date ?? ""}
              onChange={(e) => set("ll_test_date", e.target.value)}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.has_a_dl === "yes"}
              onChange={(e) => set("has_a_dl", e.target.checked ? "yes" : "no")}
            />
            Has 4-wheeler DL (treated as already-has-LL)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.has_two_wheeler_license === "yes"}
              onChange={(e) =>
                set("has_two_wheeler_license", e.target.checked ? "yes" : "no")
              }
            />
            Has 2-wheeler licence
          </label>

          <Field label="Course (optional)">
            <Select
              value={form.course ? form.course : NO_COURSE}
              onValueChange={(v) => set("course", v === NO_COURSE ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No course (LL only)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COURSE}>No course (LL only)</SelectItem>
                {COURSE_OPTIONS.map((c) => (
                  <SelectItem key={c.id} value={c.label}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Total amount (₹)">
            <Input
              type="number"
              value={form.total_amount ?? ""}
              onChange={(e) => set("total_amount", e.target.value)}
              disabled={!form.course}
            />
          </Field>
          <Field label="Amount paid (₹)">
            <Input
              type="number"
              value={form.amount_paid ?? ""}
              onChange={(e) => set("amount_paid", e.target.value)}
              disabled={!form.course}
            />
          </Field>
          <Field label="Lessons completed">
            <Input
              type="number"
              value={form.completed_lessons ?? ""}
              onChange={(e) => set("completed_lessons", e.target.value)}
              disabled={!form.course}
            />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea
              rows={2}
              value={form.comments ?? ""}
              onChange={(e) => set("comments", e.target.value)}
            />
          </Field>
        </div>

        {errors.length > 0 && (
          <ul className="list-inside list-disc rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="mr-1 h-4 w-4" />
            )}
            Add customer
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk CSV import tab.
// ---------------------------------------------------------------------------
interface ImportResult {
  created: number;
  failed: number;
  errors: string[];
}

function BulkImport() {
  const { toast } = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedLLRow[]>([]);
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const statusOf = (r: ParsedLLRow): RowStatus => {
    if (r.errors.length > 0) return "invalid";
    if (imported.has(r.phone)) return "imported";
    if (duplicates.has(r.phone)) return "duplicate";
    return "valid";
  };

  const counts = useMemo(() => {
    const c = { valid: 0, imported: 0, duplicate: 0, invalid: 0 };
    for (const r of rows) c[statusOf(r)]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, duplicates, imported]);

  const handleTemplate = () =>
    downloadCSV("ll_customer_migration_template.csv", buildTemplateCsv());

  const handleFile = async (file: File) => {
    setResult(null);
    setImported(new Set());
    setAnalyzing(true);
    try {
      const text = await file.text();
      const { rows: parsed } = analyzeLLRows(parseCsv(text));
      const phones = Array.from(
        new Set(parsed.map((r) => r.phone).filter(Boolean)),
      );
      setFileName(file.name);
      setRows(parsed);
      setDuplicates(await existingPhones(phones));
    } catch (e) {
      toast({
        title: "Couldn't read the file",
        description: e instanceof Error ? e.message : "Please check the CSV.",
        variant: "destructive",
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const handleImport = async () => {
    const validRows = rows.filter((r) => statusOf(r) === "valid");
    if (validRows.length === 0) return;
    setImporting(true);
    const res: ImportResult = { created: 0, failed: 0, errors: [] };
    const newlyImported = new Set(imported);
    for (const r of validRows) {
      const err = await importLLCustomer(r);
      if (err) {
        res.failed++;
        res.errors.push(`Row ${r.rowNumber} (${r.name || r.phone}): ${err}`);
      } else {
        res.created++;
        newlyImported.add(r.phone);
      }
    }
    setImported(newlyImported);
    setResult(res);
    setImporting(false);
    toast({
      title: `Imported ${res.created} customer${res.created === 1 ? "" : "s"}`,
      description: res.failed
        ? `${res.failed} failed — see details.`
        : undefined,
      variant: res.failed ? "destructive" : undefined,
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Button variant="outline" size="sm" onClick={handleTemplate}>
            <Download className="mr-1 h-4 w-4" />
            Download template
          </Button>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm hover:bg-muted/40">
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {fileName ?? "Choose CSV file"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Columns: name, phone (required), email, area, ll_stage,
            ll_application_id, has_a_dl, course, total_amount…
            <br />
            <span className="font-medium text-foreground">
              Dates (dob, ll_received_date, ll_test_date): use YYYY-MM-DD
            </span>{" "}
            e.g. <code className="rounded bg-muted px-1">2026-02-28</code>.
            DD-MM-YYYY also works, but the day must be real —{" "}
            <code className="rounded bg-muted px-1">29-02-2026</code> fails
            (2026 is not a leap year).
          </p>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className={STATUS_BADGE.valid}>
            {counts.valid} create
          </Badge>
          {counts.imported + counts.duplicate > 0 && (
            <Badge variant="outline" className={STATUS_BADGE.imported}>
              {counts.imported + counts.duplicate} successful
            </Badge>
          )}
          <Badge variant="outline" className={STATUS_BADGE.invalid}>
            {counts.invalid} invalid
          </Badge>
          <Button
            size="sm"
            className="ml-auto"
            disabled={importing || counts.valid === 0}
            onClick={handleImport}
          >
            {importing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="mr-1 h-4 w-4" />
            )}
            Import {counts.valid} customer{counts.valid === 1 ? "" : "s"}
          </Button>
        </div>
      )}

      {result && (
        <Card
          className={result.failed ? "border-amber-300" : "border-emerald-300"}
        >
          <CardContent className="space-y-1 p-4 text-sm">
            <div className="font-medium">
              ✅ Created {result.created} · ⚠ {result.failed} failed
            </div>
            {result.errors.length > 0 && (
              <ul className="list-inside list-disc text-xs text-red-600">
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ScrollArea>
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr className="[&>th]:p-2 [&>th]:text-left">
                    <th>#</th>
                    <th>Status</th>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>LL stage</th>
                    <th>Course</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const s = statusOf(r);
                    return (
                      <tr key={r.rowNumber} className="border-b [&>td]:p-2">
                        <td className="text-muted-foreground">{r.rowNumber}</td>
                        <td>
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${STATUS_BADGE[s]}`}
                          >
                            {STATUS_LABEL[s]}
                          </Badge>
                        </td>
                        <td className="font-medium">{r.name || "—"}</td>
                        <td className="tabular-nums">{r.phone || "—"}</td>
                        <td>{r.stage}</td>
                        <td>{r.courseLabel ?? "—"}</td>
                        <td className="text-xs text-muted-foreground">
                          {s === "invalid" ? (
                            <span className="flex items-center gap-1 text-red-600">
                              <AlertTriangle className="h-3 w-3" />
                              {r.errors.join("; ")}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function LLCustomerMigration() {
  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              LL Customer Migration
            </h1>
            <p className="text-sm text-muted-foreground">
              Add existing Learner&apos;s License customers — one at a time or
              in bulk from a CSV.
            </p>
          </div>
        </div>

        <Tabs defaultValue="single">
          <TabsList>
            <TabsTrigger value="single">Single customer</TabsTrigger>
            <TabsTrigger value="bulk">Bulk CSV import</TabsTrigger>
          </TabsList>
          <TabsContent value="single" className="mt-4">
            <SingleCustomerForm />
          </TabsContent>
          <TabsContent value="bulk" className="mt-4">
            <BulkImport />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
