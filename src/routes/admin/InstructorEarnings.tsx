import { ArrowLeft, Download, Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import InstructorEarningsDrawer from "@/components/admin/InstructorEarningsDrawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ADMIN_EARNINGS_PAGE_SIZE,
  AdminEarningsRow,
  EarningProgram,
  fetchAdminEarningsPage,
  ProgramStatusPill,
  useAdminEarningsOverview,
  useEarningConfig,
  useEarningPrograms,
  useUpdateEarningConfig,
  useUpsertEarningProgram,
} from "@/queries/instructorEarnings";
import { formatINR } from "@/utils/earnings";
import {
  buildEarningsCsv,
  downloadCsv,
  earningsCsvFilename,
} from "@/utils/earningsCsv";

type Tab = "instructors" | "config";

export default function InstructorEarnings() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("instructors");

  return (
    <div className="container mx-auto min-h-screen bg-white p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/admin")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Instructor Earnings</h1>
        </div>
      </div>

      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {(["instructors", "config"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "instructors" ? "Per instructor" : "Config"}
          </button>
        ))}
      </div>

      {tab === "instructors" ? <InstructorsTab /> : <ConfigTab />}
    </div>
  );
}

function InstructorsTab() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching, isError } = useAdminEarningsOverview(
    page,
    search,
  );
  const rows = data?.rows ?? [];
  const totalPages = Math.max(
    1,
    Math.ceil((data?.totalCount ?? 0) / ADMIN_EARNINGS_PAGE_SIZE),
  );
  const [isExporting, setIsExporting] = useState(false);
  const [selected, setSelected] = useState<AdminEarningsRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (data && page > totalPages) setPage(totalPages);
  }, [data, page, totalPages]);

  const exportCsv = async () => {
    setIsExporting(true);
    try {
      // Preserve export of all search matches, not just the visible page.
      // Fetch the remaining pages only after an explicit Export click.
      const firstPage = await fetchAdminEarningsPage(1, search);
      const exportRows = [...firstPage.rows];
      const exportPages = Math.ceil(
        firstPage.totalCount / ADMIN_EARNINGS_PAGE_SIZE,
      );
      for (let exportPage = 2; exportPage <= exportPages; exportPage++) {
        const result = await fetchAdminEarningsPage(exportPage, search);
        exportRows.push(...result.rows);
      }
      const today = new Date().toISOString().split("T")[0];
      downloadCsv(earningsCsvFilename(today), buildEarningsCsv(exportRows));
      toast.success("Exported earnings CSV");
    } catch {
      toast.error("Failed to export earnings CSV");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by instructor, phone, or KAM…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-10"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={rows.length === 0 || isFetching || isExporting}
        >
          {isExporting ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-1 h-4 w-4" />
          )}
          Export
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="p-3">Instructor</th>
              <th className="p-3">Phone</th>
              <th className="p-3">KAM</th>
              <th className="p-3 text-right">Classes (mo)</th>
              <th className="p-3 text-right">Earnings (mo)</th>
              <th className="p-3 text-right">Pending</th>
              <th className="p-3 text-right">Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr
                key={r.instructorId}
                onClick={() => {
                  setSelected(r);
                  setDrawerOpen(true);
                }}
                className="cursor-pointer hover:bg-gray-50"
              >
                <td className="p-3 font-medium">{r.name ?? "—"}</td>
                <td className="p-3 text-gray-500">{r.phone ?? "—"}</td>
                <td className="p-3 text-gray-500">{r.kamName ?? "—"}</td>
                <td className="p-3 text-right">{r.classesThisMonth}</td>
                <td className="p-3 text-right font-medium">
                  {formatINR(r.earningsThisMonth)}
                </td>
                <td className="p-3 text-right">{formatINR(r.pendingPayout)}</td>
                <td className="p-3 text-right text-gray-500">
                  {formatINR(r.perClassRate)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-gray-400">
                  {isLoading ? (
                    <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                  ) : isError ? (
                    "Failed to load instructors."
                  ) : (
                    "No instructors found."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1 || isFetching}
        >
          Previous
        </Button>
        <span className="text-sm text-gray-500">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setPage((current) => Math.min(totalPages, current + 1))
          }
          disabled={page >= totalPages || isFetching || isError}
        >
          Next
        </Button>
      </div>

      <InstructorEarningsDrawer
        instructorId={selected?.instructorId ?? null}
        name={selected?.name ?? null}
        phone={selected?.phone ?? null}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function ConfigTab() {
  const { data: config, isLoading } = useEarningConfig();
  const update = useUpdateEarningConfig();

  const [form, setForm] = useState({
    default_per_class_rate: "",
    default_monthly_target: "",
    payout_day: "Monday",
    leaderboard_top_n: "",
    leaderboard_bonus_amount: "",
    tip_copy: "",
    availability_message_template: "",
  });

  useEffect(() => {
    if (!config) return;
    setForm({
      default_per_class_rate: String(config.default_per_class_rate),
      default_monthly_target: String(config.default_monthly_target),
      payout_day: config.payout_day,
      leaderboard_top_n: String(config.leaderboard_top_n),
      leaderboard_bonus_amount: String(config.leaderboard_bonus_amount),
      tip_copy: config.tip_copy ?? "",
      availability_message_template: config.availability_message_template ?? "",
    });
  }, [config]);

  const save = async () => {
    try {
      await update.mutateAsync({
        default_per_class_rate: Number(form.default_per_class_rate),
        default_monthly_target: Number(form.default_monthly_target),
        payout_day: form.payout_day,
        leaderboard_top_n: Number(form.leaderboard_top_n),
        leaderboard_bonus_amount: Number(form.leaderboard_bonus_amount),
        tip_copy: form.tip_copy,
        availability_message_template: form.availability_message_template,
      });
      toast.success("Config saved");
    } catch {
      toast.error("Failed to save config");
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Global earnings settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Default per-class rate (₹)">
              <Input
                type="number"
                value={form.default_per_class_rate}
                onChange={(e) =>
                  setForm({ ...form, default_per_class_rate: e.target.value })
                }
              />
            </Field>
            <Field label="Default monthly target">
              <Input
                type="number"
                value={form.default_monthly_target}
                onChange={(e) =>
                  setForm({ ...form, default_monthly_target: e.target.value })
                }
              />
            </Field>
            <Field label="Payout day">
              <select
                value={form.payout_day}
                onChange={(e) =>
                  setForm({ ...form, payout_day: e.target.value })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Leaderboard top N">
              <Input
                type="number"
                value={form.leaderboard_top_n}
                onChange={(e) =>
                  setForm({ ...form, leaderboard_top_n: e.target.value })
                }
              />
            </Field>
            <Field label="Leaderboard bonus (₹)">
              <Input
                type="number"
                value={form.leaderboard_bonus_amount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    leaderboard_bonus_amount: e.target.value,
                  })
                }
              />
            </Field>
          </div>
          <Field label="Tip strip copy (Screen 2)">
            <Textarea
              value={form.tip_copy}
              onChange={(e) => setForm({ ...form, tip_copy: e.target.value })}
              rows={3}
            />
          </Field>
          <Field label="Availability message template ({name} is replaced)">
            <Textarea
              value={form.availability_message_template}
              onChange={(e) =>
                setForm({
                  ...form,
                  availability_message_template: e.target.value,
                })
              }
              rows={3}
            />
          </Field>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending && (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            )}
            Save config
          </Button>
        </CardContent>
      </Card>

      <ProgramsEditor />
    </div>
  );
}

function ProgramsEditor() {
  const { data: programs, isLoading } = useEarningPrograms({
    includeInactive: true,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Earning opportunity cards (Screen 2)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        ) : (
          (programs ?? []).map((p) => <ProgramRow key={p.id} program={p} />)
        )}
      </CardContent>
    </Card>
  );
}

const PILL_OPTIONS: ProgramStatusPill[] = ["active", "new", "coming_soon"];

function ProgramRow({ program }: { program: EarningProgram }) {
  const upsert = useUpsertEarningProgram();
  const [amount, setAmount] = useState(program.amount_label ?? "");
  const [ctaUrl, setCtaUrl] = useState(program.cta_url ?? "");
  const [pill, setPill] = useState<ProgramStatusPill>(program.status_pill);
  const [active, setActive] = useState(program.is_active);

  const save = async () => {
    try {
      await upsert.mutateAsync({
        id: program.id,
        amount_label: amount,
        cta_url: ctaUrl,
        status_pill: pill,
        is_active: active,
      });
      toast.success(`Saved "${program.title}"`);
    } catch {
      toast.error("Failed to save program");
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-medium">{program.title}</p>
          <p className="text-xs text-gray-400">{program.key}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Active</span>
          <Switch checked={active} onCheckedChange={setActive} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Amount label">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="CTA URL (Google Form)">
          <Input value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
        </Field>
        <Field label="Status pill">
          <select
            value={pill}
            onChange={(e) => setPill(e.target.value as ProgramStatusPill)}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {PILL_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button
        size="sm"
        className="mt-3"
        onClick={save}
        disabled={upsert.isPending}
      >
        {upsert.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        Save
      </Button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
