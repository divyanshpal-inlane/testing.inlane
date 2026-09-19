// Builds a styled, multi-sheet .xlsx export for the Instructor Availability
// Matrix. Three tabs:
//   1. Matrix   — the on-screen grid, one row per instructor × 7 day columns,
//                 each cell colour-coded by utilisation (matching the UI).
//   2. Bookings — one row per scheduled lesson with every field, as a filterable
//                 table (built from the raw week payload so it also captures
//                 bookings outside the 06:00–20:00 display window).
//   3. Summary  — per-instructor numeric summary with a fleet TOTAL row.
//
// All three respect the selected week and the "count tentative" toggle, and
// cover every enabled instructor (on-screen search / hide-off-duty are ignored).
//
// exceljs is dynamically imported so it stays out of the main bundle and only
// loads when an admin actually exports.
import { format, parseISO } from "date-fns";
import { saveAs } from "file-saver";

import {
  InstructorMatrixData,
  MATRIX_DAY_END_HOUR,
  MATRIX_DAY_START_HOUR,
  MatrixRawData,
  MatrixRawSchedule,
} from "@/queries/instructorMatrix";
import { UtilizationBucket, utilizationStyle } from "@/utils/utilizationColor";

// --- colour palette (ARGB, mirrors the Tailwind classes used on screen) ----
const HEADER_FILL = "1F2937"; // slate-800
const HEADER_FONT = "FFFFFF";
const TOTAL_FILL = "111827"; // slate-900
const TITLE_FONT = "111827";
const SUBTITLE_FONT = "6B7280"; // gray-500

const BUCKET_STYLE: Record<UtilizationBucket, { fill: string; font: string }> =
  {
    off: { fill: "E5E7EB", font: "4B5563" }, // gray
    low: { fill: "FEE2E2", font: "991B1B" }, // red-100
    medium: { fill: "FECACA", font: "7F1D1D" }, // red-200
    high: { fill: "F87171", font: "450A0A" }, // red-400
    full: { fill: "DC2626", font: "FFFFFF" }, // red-600
    overbooked: { fill: "FDE047", font: "713F12" }, // yellow-300 (conflict)
  };

// Enrollment-type tints for the Bookings sheet (mirror the drawer badges).
const ENROLLMENT_FILL: Record<string, string> = {
  course: "D1FAE5",
  demo: "DBEAFE",
  topup: "CCFBF1",
  tentative: "F3E8FF",
};

const CONFLICT_ROW_FILL = "FEF3C7"; // amber-100
const TENTATIVE_ROW_FILL = "FAF5FF"; // purple-50

const solidFill = (hex: string) =>
  ({
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${hex}` },
  }) as const;

const thinBorder = {
  top: { style: "thin", color: { argb: "FFE5E7EB" } },
  left: { style: "thin", color: { argb: "FFE5E7EB" } },
  bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
  right: { style: "thin", color: { argb: "FFE5E7EB" } },
} as const;

// Trim a trailing ".0" so capacities read as "14" not "14.0", but keep "13.5".
const trimNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : n.toFixed(1);
const round1 = (n: number): number => Number(n.toFixed(1));

const intervalsOverlap = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean => aStart < bEnd && bStart < aEnd;

const durationHours = (
  start: string | null | undefined,
  end: string | null | undefined,
): number => {
  if (!start || !end) return 0;
  const [sh, sm = "0"] = start.split(":");
  const [eh, em = "0"] = end.split(":");
  return Math.max(
    0,
    (Number(eh) * 60 + Number(em) - (Number(sh) * 60 + Number(sm))) / 60,
  );
};

type WS = import("exceljs").Worksheet;

function styleHeaderRow(ws: WS, rowNumber: number) {
  const row = ws.getRow(rowNumber);
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = solidFill(HEADER_FILL);
    cell.font = { bold: true, color: { argb: `FF${HEADER_FONT}` }, size: 11 };
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = thinBorder;
  });
}

// --- Sheet 1: Matrix --------------------------------------------------------
function buildMatrixSheet(
  ws: WS,
  data: InstructorMatrixData,
  includeTentative: boolean,
) {
  const dayCount = data.dayHeaders.length; // 7
  // Columns: Instructor | Phone | 7 days | Week | Util% | Conflicts
  const lastCol = 2 + dayCount + 3;

  const weekRange = `${format(parseISO(data.from), "EEE d MMM")} – ${format(
    parseISO(data.to),
    "EEE d MMM yyyy",
  )}`;

  // Title + subtitle rows.
  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = "Instructor Availability Matrix";
  titleCell.font = { bold: true, size: 16, color: { argb: `FF${TITLE_FONT}` } };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, lastCol);
  const subCell = ws.getCell(2, 1);
  subCell.value = `${weekRange}   ·   Capacity = ${
    MATRIX_DAY_END_HOUR - MATRIX_DAY_START_HOUR
  }h window (0${MATRIX_DAY_START_HOUR}:00–${MATRIX_DAY_END_HOUR}:00) minus unavailability   ·   ${
    includeTentative
      ? "Tentative holds counted as busy"
      : "Tentative holds EXCLUDED"
  }`;
  subCell.font = { size: 10, color: { argb: `FF${SUBTITLE_FONT}` } };

  // Header row (row 4).
  const headerRowIdx = 4;
  const header = [
    "Instructor",
    "Phone",
    ...data.dayHeaders.map((h) => `${h.weekday} ${h.dayOfMonth}`),
    "Week (Bkd/Cap)",
    "Util %",
    "Conflicts",
  ];
  ws.getRow(headerRowIdx).values = header;
  styleHeaderRow(ws, headerRowIdx);

  // Data rows.
  data.rows.forEach((r, i) => {
    const rowIdx = headerRowIdx + 1 + i;
    const row = ws.getRow(rowIdx);

    const nameCell = row.getCell(1);
    nameCell.value = r.instructor.name;
    nameCell.font = {
      bold: true,
      color: { argb: r.weekConflictCount > 0 ? "FFB45309" : "FF111827" },
    };
    nameCell.alignment = { vertical: "middle" };
    nameCell.border = thinBorder;

    const phoneCell = row.getCell(2);
    phoneCell.value = r.instructor.phone ?? "";
    phoneCell.font = { color: { argb: "FF6B7280" }, size: 10 };
    phoneCell.alignment = { vertical: "middle" };
    phoneCell.border = thinBorder;

    r.days.forEach((d, di) => {
      const cell = row.getCell(3 + di);
      const style = utilizationStyle(
        d.bookedHours,
        d.capacityHours,
        d.conflictCount,
      );
      const offDuty = d.capacityHours <= 0;
      const base = offDuty
        ? "Off"
        : `${Math.round(d.bookedHours)}/${trimNum(d.capacityHours)}`;
      cell.value =
        d.conflictCount > 0 ? `⚠ ${base} (${d.conflictCount})` : base;
      cell.fill = solidFill(BUCKET_STYLE[style.bucket].fill);
      cell.font = {
        color: { argb: `FF${BUCKET_STYLE[style.bucket].font}` },
        size: 10,
        bold: d.conflictCount > 0,
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = thinBorder;
      const util =
        d.capacityHours > 0
          ? Math.round((d.bookedHours / d.capacityHours) * 100)
          : 0;
      cell.note = `${d.weekday} ${d.dayOfMonth}\nBooked ${round1(
        d.bookedHours,
      )}h / Capacity ${round1(d.capacityHours)}h · ${util}% used${
        d.conflictCount > 0 ? `\n${d.conflictCount} conflict(s)` : ""
      }${
        !includeTentative && d.tentativeHours > 0
          ? `\n${round1(d.tentativeHours)}h tentative (not counted)`
          : ""
      }`;
    });

    // Week total cell.
    const weekStyle = utilizationStyle(
      r.weekBookedHours,
      r.weekCapacityHours,
      r.weekConflictCount,
    );
    const weekCell = row.getCell(3 + dayCount);
    weekCell.value = `${Math.round(r.weekBookedHours)}/${trimNum(
      r.weekCapacityHours,
    )}`;
    weekCell.fill = solidFill(BUCKET_STYLE[weekStyle.bucket].fill);
    weekCell.font = {
      bold: true,
      color: { argb: `FF${BUCKET_STYLE[weekStyle.bucket].font}` },
    };
    weekCell.alignment = { vertical: "middle", horizontal: "center" };
    weekCell.border = thinBorder;

    const utilCell = row.getCell(4 + dayCount);
    utilCell.value =
      r.weekCapacityHours > 0
        ? Math.round((r.weekBookedHours / r.weekCapacityHours) * 100) / 100
        : 0;
    utilCell.numFmt = "0%";
    utilCell.alignment = { vertical: "middle", horizontal: "center" };
    utilCell.border = thinBorder;

    const conflictCell = row.getCell(5 + dayCount);
    conflictCell.value = r.weekConflictCount;
    conflictCell.font = {
      bold: r.weekConflictCount > 0,
      color: { argb: r.weekConflictCount > 0 ? "FFB45309" : "FF111827" },
    };
    conflictCell.alignment = { vertical: "middle", horizontal: "center" };
    conflictCell.border = thinBorder;
  });

  // Legend, a couple of rows below the table.
  const legendRowIdx = headerRowIdx + data.rows.length + 2;
  ws.getCell(legendRowIdx, 1).value = "Legend:";
  ws.getCell(legendRowIdx, 1).font = { bold: true, size: 10 };
  const legendBuckets: UtilizationBucket[] = [
    "low",
    "medium",
    "high",
    "full",
    "off",
    "overbooked",
  ];
  const legendLabels: Record<UtilizationBucket, string> = {
    low: "< 25% booked",
    medium: "25–50%",
    high: "50–75%",
    full: "75–100%",
    off: "Off-duty",
    overbooked: "Conflict",
  };
  legendBuckets.forEach((b, i) => {
    const cell = ws.getCell(legendRowIdx, 2 + i);
    cell.value = legendLabels[b];
    cell.fill = solidFill(BUCKET_STYLE[b].fill);
    cell.font = { color: { argb: `FF${BUCKET_STYLE[b].font}` }, size: 9 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder;
  });

  // Column widths.
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 15;
  for (let c = 3; c < 3 + dayCount; c++) ws.getColumn(c).width = 12;
  ws.getColumn(3 + dayCount).width = 13;
  ws.getColumn(4 + dayCount).width = 8;
  ws.getColumn(5 + dayCount).width = 10;

  // Freeze the instructor/phone columns and the header rows.
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: headerRowIdx }];
}

// --- Sheet 2: Bookings ------------------------------------------------------
function buildBookingsSheet(
  ws: WS,
  raw: MatrixRawData,
  includeTentative: boolean,
) {
  const weekdayByDate = new Map(raw.dayHeaders.map((h) => [h.date, h.weekday]));

  const header = [
    "Instructor",
    "Instructor Phone",
    "Date",
    "Weekday",
    "Start",
    "End",
    "Duration (h)",
    "Status",
    "Tentative",
    "Counted as busy",
    "Conflict",
    "Learner",
    "Learner Phone",
    "Lesson #",
    "Enrollment Type",
  ];
  ws.getRow(1).values = header;
  styleHeaderRow(ws, 1);

  // instructorId -> date -> schedules
  const byInstrDate = new Map<string, Map<string, MatrixRawSchedule[]>>();
  for (const s of raw.schedules) {
    if (!byInstrDate.has(s.instructorId))
      byInstrDate.set(s.instructorId, new Map());
    const dateMap = byInstrDate.get(s.instructorId)!;
    if (!dateMap.has(s.date)) dateMap.set(s.date, []);
    dateMap.get(s.date)!.push(s);
  }

  let rowIdx = 1;
  for (const instr of raw.instructors) {
    const dateMap = byInstrDate.get(instr.id);
    if (!dateMap) continue;
    for (const date of Array.from(dateMap.keys()).sort()) {
      const daySchedules = dateMap.get(date)!;
      const counting = includeTentative
        ? daySchedules
        : daySchedules.filter((s) => !s.isTentative);
      const countedIds = new Set(counting.map((s) => s.id));

      // Same overlap-based conflict detection as the matrix.
      const conflictIds = new Set<number>();
      for (let i = 0; i < counting.length; i++) {
        const a = counting[i];
        if (a.startMin == null || a.endMin == null) continue;
        for (let j = i + 1; j < counting.length; j++) {
          const b = counting[j];
          if (b.startMin == null || b.endMin == null) continue;
          if (intervalsOverlap(a.startMin, a.endMin, b.startMin, b.endMin)) {
            conflictIds.add(a.id);
            conflictIds.add(b.id);
          }
        }
      }

      const sorted = [...daySchedules].sort(
        (a, b) => (a.startMin ?? 0) - (b.startMin ?? 0),
      );
      for (const s of sorted) {
        rowIdx += 1;
        const isConflict = conflictIds.has(s.id);
        const notCounted = !countedIds.has(s.id);
        const row = ws.getRow(rowIdx);
        row.values = [
          instr.name,
          instr.phone ?? "",
          date,
          weekdayByDate.get(date) ?? format(parseISO(date), "EEE"),
          s.start_time?.slice(0, 5) ?? "",
          s.end_time?.slice(0, 5) ?? "",
          round1(durationHours(s.start_time, s.end_time)),
          s.status ?? "",
          s.isTentative ? "Yes" : "No",
          countedIds.has(s.id) ? "Yes" : "No",
          isConflict ? "Yes" : "No",
          s.learnerName ?? "",
          s.learnerPhone ?? "",
          s.lessonNumber ?? "",
          s.enrollmentType ?? "",
        ];
        row.eachCell((cell) => {
          cell.border = thinBorder;
          cell.alignment = { vertical: "middle" };
        });
        // Row tint: conflicts (amber) take priority, then not-counted tentative.
        const rowFill = isConflict
          ? CONFLICT_ROW_FILL
          : notCounted
            ? TENTATIVE_ROW_FILL
            : null;
        if (rowFill) {
          row.eachCell((cell) => {
            cell.fill = solidFill(rowFill);
          });
        }
        // Enrollment-type badge colour on its own cell.
        if (s.enrollmentType && ENROLLMENT_FILL[s.enrollmentType]) {
          const c = row.getCell(15);
          c.fill = solidFill(ENROLLMENT_FILL[s.enrollmentType]);
          c.alignment = { vertical: "middle", horizontal: "center" };
        }
      }
    }
  }

  const widths = [22, 16, 12, 9, 8, 8, 11, 14, 10, 14, 9, 22, 16, 9, 15];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: header.length },
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// --- Sheet 3: Summary -------------------------------------------------------
function buildSummarySheet(ws: WS, data: InstructorMatrixData) {
  const header = ["Instructor", "Phone"];
  for (const h of data.dayHeaders) {
    header.push(
      `${h.weekday} ${h.dayOfMonth} Bkd`,
      `${h.weekday} ${h.dayOfMonth} Cap`,
      `${h.weekday} ${h.dayOfMonth} Cfl`,
    );
  }
  header.push(
    "Week Booked",
    "Week Capacity",
    "Week Free",
    "Util %",
    "Week Conflicts",
  );
  ws.getRow(1).values = header;
  styleHeaderRow(ws, 1);

  const utilColIdx = header.length - 1; // "Util %"
  data.rows.forEach((r, i) => {
    const rowIdx = 2 + i;
    const row = ws.getRow(rowIdx);
    const cells: (string | number)[] = [
      r.instructor.name,
      r.instructor.phone ?? "",
    ];
    for (const d of r.days) {
      cells.push(
        round1(d.bookedHours),
        round1(d.capacityHours),
        d.conflictCount,
      );
    }
    const free = Math.max(0, r.weekCapacityHours - r.weekBookedHours);
    const util =
      r.weekCapacityHours > 0 ? r.weekBookedHours / r.weekCapacityHours : 0;
    cells.push(
      round1(r.weekBookedHours),
      round1(r.weekCapacityHours),
      round1(free),
      util,
      r.weekConflictCount,
    );
    row.values = cells;
    row.eachCell((cell) => {
      cell.border = thinBorder;
      cell.alignment = { vertical: "middle" };
    });
    row.getCell(utilColIdx).numFmt = "0%";
  });

  // Fleet TOTAL row.
  const totalRowIdx = 2 + data.rows.length;
  const totalRow = ws.getRow(totalRowIdx);
  const totalCells: (string | number)[] = ["TOTAL", ""];
  for (let i = 0; i < data.dayHeaders.length; i++) {
    let booked = 0;
    let capacity = 0;
    let conflicts = 0;
    for (const r of data.rows) {
      booked += r.days[i]?.bookedHours ?? 0;
      capacity += r.days[i]?.capacityHours ?? 0;
      conflicts += r.days[i]?.conflictCount ?? 0;
    }
    totalCells.push(round1(booked), round1(capacity), conflicts);
  }
  const { bookedHours, capacityHours, conflictCount } = data.totals;
  const totalFree = Math.max(0, capacityHours - bookedHours);
  const totalUtil = capacityHours > 0 ? bookedHours / capacityHours : 0;
  totalCells.push(
    round1(bookedHours),
    round1(capacityHours),
    round1(totalFree),
    totalUtil,
    conflictCount,
  );
  totalRow.values = totalCells;
  totalRow.eachCell((cell) => {
    cell.fill = solidFill(TOTAL_FILL);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.border = thinBorder;
    cell.alignment = { vertical: "middle" };
  });
  totalRow.getCell(utilColIdx).numFmt = "0%";

  ws.getColumn(1).width = 22;
  ws.getColumn(2).width = 16;
  for (let c = 3; c <= utilColIdx + 1; c++) ws.getColumn(c).width = 10;
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: header.length },
  };
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
}

// --- public entry point -----------------------------------------------------
export async function exportInstructorMatrixWorkbook(
  raw: MatrixRawData,
  data: InstructorMatrixData,
  includeTentative: boolean,
): Promise<void> {
  const mod = await import("exceljs");
  const ExcelJS: typeof import("exceljs") =
    (mod as { default?: typeof import("exceljs") }).default ?? mod;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Lane Admin";
  wb.created = new Date();

  buildMatrixSheet(wb.addWorksheet("Matrix"), data, includeTentative);
  buildBookingsSheet(wb.addWorksheet("Bookings"), raw, includeTentative);
  buildSummarySheet(wb.addWorksheet("Summary"), data);

  const buffer = await wb.xlsx.writeBuffer();
  const range = `${data.from.replace(/\D/g, "")}_${data.to.replace(/\D/g, "")}`;
  saveAs(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `instructor_matrix_${range}.xlsx`,
  );
}
