// Display helpers for a licence / RTO service (enrollment.case_type =
// 'rto_only'). Kept dependency-free so the public payment page can use them
// without pulling in the admin screens.

export type LicenceNeed = "ll" | "dl" | "ll_and_dl";
export type Vehicle = "two_wheeler" | "four_wheeler";

export const LICENCE_NEED_LABEL: Record<LicenceNeed, string> = {
  ll: "Learner Licence (LL)",
  dl: "Driving Licence (DL)",
  ll_and_dl: "LL + DL",
};

/** e.g. "2W Licence: LL + DL". */
export function licenceLabel(e: {
  vehicle_type?: string | null;
  two_wheeler_requirement?: string | null;
  four_wheeler_requirement?: string | null;
}): string {
  const two = e.two_wheeler_requirement;
  const four = e.four_wheeler_requirement;
  const veh =
    e.vehicle_type === "two_wheeler" ||
    (two && two !== "not_required" && (!four || four === "not_required"))
      ? "2W"
      : "4W";
  const need = (veh === "2W" ? two : four) as LicenceNeed | undefined;
  return `${veh} Licence${need && LICENCE_NEED_LABEL[need] ? `: ${LICENCE_NEED_LABEL[need]}` : ""}`;
}
