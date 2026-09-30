export type UtilizationBucket =
  "off" | "low" | "medium" | "high" | "full" | "overbooked";

export interface UtilizationStyle {
  bucket: UtilizationBucket;
  bg: string;
  text: string;
  border: string;
  label: string;
}

const STYLES: Record<UtilizationBucket, Omit<UtilizationStyle, "bucket">> = {
  off: {
    bg: "bg-gray-200",
    text: "text-gray-600",
    border: "border-gray-300",
    label: "Off-duty",
  },
  low: {
    bg: "bg-red-100",
    text: "text-red-800",
    border: "border-red-200",
    label: "< 25% booked",
  },
  medium: {
    bg: "bg-red-200",
    text: "text-red-900",
    border: "border-red-300",
    label: "25–50% booked",
  },
  high: {
    bg: "bg-red-400",
    text: "text-red-950",
    border: "border-red-500",
    label: "50–75% booked",
  },
  full: {
    bg: "bg-red-600",
    text: "text-white",
    border: "border-red-700",
    label: "75–100% booked",
  },
  overbooked: {
    bg: "bg-yellow-300",
    text: "text-yellow-900",
    border: "border-yellow-500",
    label: "Conflict",
  },
};

export function utilizationStyle(
  bookedHours: number,
  capacityHours: number,
  conflictCount = 0,
): UtilizationStyle {
  if (conflictCount > 0) {
    return { bucket: "overbooked", ...STYLES.overbooked };
  }
  if (capacityHours <= 0) {
    return { bucket: "off", ...STYLES.off };
  }
  const ratio = bookedHours / capacityHours;
  let bucket: UtilizationBucket;
  if (ratio >= 1) bucket = "full";
  else if (ratio >= 0.75) bucket = "full";
  else if (ratio >= 0.5) bucket = "high";
  else if (ratio >= 0.25) bucket = "medium";
  else bucket = "low";
  return { bucket, ...STYLES[bucket] };
}

export const UTILIZATION_LEGEND: UtilizationStyle[] = (
  ["low", "medium", "high", "full", "off", "overbooked"] as UtilizationBucket[]
).map((bucket) => ({ bucket, ...STYLES[bucket] }));
