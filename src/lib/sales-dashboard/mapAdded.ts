/**
 * The instructors the user added from a polygon popup on the Sales Dashboard
 * map ("Add to dashboard"). They are PINNED: their polygon stays drawn on the
 * map even when "Show all polygons" is off, and during a location search they
 * are listed next to the matches.
 *
 * Pure, so the rules can be unit-tested (tests/map-added.test.mjs).
 *
 *  - An instructor that is already a search MATCH is skipped: the match logic
 *    draws and lists them, so nothing appears twice.
 *  - Polygons come from the zones, not from loaded instructor data, so a freshly
 *    added instructor is drawn immediately; only `instrs` (the list / count)
 *    needs the loaded row and fills in once their schedule has loaded.
 *  - Colours continue after the matches' colours so a pinned area never shares a
 *    colour with a match.
 */
/** Sorts after every Area (-1) and Nearby (km) instructor. */
export const FROM_MAP_RANK = 1e9;

/**
 * Position of an instructor in the "distance" order of a location search:
 * Area instructors first (-1), then Nearby instructors by distance (km), then
 * instructors that were only added from the map (FROM_MAP_RANK) -- they are not
 * near the searched address, so they must never be mixed in with the matches.
 * With no search active every instructor ranks the same (-1), so the order falls
 * through to the usual status / free-slots / name tie-breakers.
 */
export function locationRank(args: {
  searching: boolean;
  isMatch: boolean;
  nearbyKm: number | undefined;
}): number {
  if (!args.searching) return -1;
  if (!args.isMatch) return FROM_MAP_RANK;
  return args.nearbyKm ?? -1;
}

export interface PinnedZone {
  name: string;
  color: string;
}

export interface MapAdded<I> {
  /** One entry per drawn polygon (name = the zone's name). */
  zones: PinnedZone[];
  /** Loaded instructor rows, in the order their polygons were found. */
  instrs: I[];
  /** instructorId -> colour. */
  colorById: Map<string, string>;
}

export function deriveMapAdded<I extends { id: string }>(args: {
  zones: { name: string; kind: string; instructorId: string }[] | null;
  mapAddedIds: ReadonlySet<string>;
  matchedIds: ReadonlySet<string>;
  matchedCount: number;
  instructorsById: ReadonlyMap<string, I>;
  palette: readonly string[];
}): MapAdded<I> {
  const {
    zones,
    mapAddedIds,
    matchedIds,
    matchedCount,
    instructorsById,
    palette,
  } = args;
  const out: MapAdded<I> = { zones: [], instrs: [], colorById: new Map() };
  if (!zones || mapAddedIds.size === 0 || palette.length === 0) return out;

  for (const z of zones) {
    if (z.kind !== "polygon" || !mapAddedIds.has(z.instructorId)) continue;
    if (matchedIds.has(z.instructorId)) continue;
    let color = out.colorById.get(z.instructorId);
    if (!color) {
      color = palette[(matchedCount + out.colorById.size) % palette.length];
      out.colorById.set(z.instructorId, color);
      const instr = instructorsById.get(z.instructorId);
      if (instr) out.instrs.push(instr);
    }
    out.zones.push({ name: z.name, color });
  }
  return out;
}
