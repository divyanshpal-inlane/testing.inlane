import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  Download,
  Layers,
  Loader2,
  MapPin,
  Maximize,
  Maximize2,
  Menu,
  Minimize,
  MoreVertical,
  Pencil,
  Pentagon,
  Redo2,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ZoneCoordinate } from "@/components/instructor-zones/types";
import {
  arraysEqual,
  closeRing,
  isSamePoint,
  MAX_VERTICES,
  openRing,
  useZoneHistory,
} from "@/components/instructor-zones/useZoneHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import {
  INSTRUCTOR_STATUSES,
  type InstructorStatus,
  instructorStatusMeta,
  resolveInstructorStatus,
} from "@/constants/instructorStatus";
import { isCompanyInstructor } from "@/lib/sales-dashboard/company-instructors";
import { pointInPolygon } from "@/lib/sales-dashboard/kml";
import {
  deleteZoneById,
  fetchDbZones,
  insertZone,
  invalidateDbZoneCache,
  updateZoneById,
} from "@/lib/sales-dashboard/zones-db";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { googleMapsLoader } from "@/utils/googleMaps";

const FALLBACK_CENTER: ZoneCoordinate = { lat: 12.9716, lng: 77.5946 };
const DEFAULT_ZOOM = 11;
const SELECTED_STROKE = "#ea580c";
const SELECTED_FILL = "#f97316";
const MARKER_RADIUS_METERS = 130;
/** Stroke/fill for the polygon while it is being reshaped in place. */
const EDITING_STROKE = "#16a34a";
const EDITING_FILL = "#16a34a";
/**
 * Vertex drags fire a path event per animation frame; this key collapses a whole
 * drag into one undo step. See useZoneHistory.
 */
const DRAG_COALESCE_KEY = "vertex-drag";
/**
 * How close together two path events must be to count as one drag. The Polygon
 * raises no per-vertex `dragstart` (its own only covers a whole-shape drag,
 * which is disabled), so the burst is delimited by time instead. Comfortably
 * under one frame of jank but far below the gap between two deliberate drags.
 */
const DRAG_BURST_MS = 250;

interface ZoneView {
  rowId: string;
  instructorId: string;
  name: string;
  ring: ZoneCoordinate[];
  /** Provisional boundary awaiting Ops review; never a serviceability zone. */
  isRough: boolean;
}

/**
 * The Places dropdown is appended to `<body>`, so it needs an explicit z-index to
 * clear the header (`z-30`) and sidebar (`z-20`), plus pointer events restored
 * for its items.
 *
 * Reference-counted because two widgets can be live at once (the header search
 * and the sidebar location filter). A naive per-effect append/remove would let
 * whichever effect cleaned up first strip the override out from under the other,
 * leaving the open dropdown unclickable.
 */
let pacStyleEl: HTMLStyleElement | null = null;
let pacStyleUsers = 0;
const acquirePacStyles = (): (() => void) => {
  pacStyleUsers += 1;
  if (!pacStyleEl) {
    const el = document.createElement("style");
    el.dataset.mapPac = "1";
    el.textContent =
      ".pac-container{z-index:10000 !important;pointer-events:auto !important}" +
      ".pac-item{cursor:pointer !important}";
    document.head.appendChild(el);
    pacStyleEl = el;
  }
  return () => {
    pacStyleUsers -= 1;
    if (pacStyleUsers > 0 || !pacStyleEl) return;
    pacStyleEl.remove();
    pacStyleEl = null;
  };
};

/**
 * Attach a Google Places suggestion dropdown to one text input.
 *
 * `onPlace` fires only when the user picks a suggestion, which is the commit
 * point: half-typed text is not a location, so nothing is filtered on keystroke.
 * Free text is still handled separately by the Geocoder path, so both the header
 * search and the sidebar location filter get suggestions *and* accept an address
 * that has no matching suggestion.
 *
 * Country-restricted to IN: every service area is in Bengaluru, and without this
 * "Koramangala" resolves to a same-named street on another continent.
 */
const usePlacesAutocomplete = (
  inputRef: React.RefObject<HTMLInputElement | null>,
  enabled: boolean,
  onPlace: (place: { at: ZoneCoordinate; label: string }) => void,
) => {
  // Held in a ref so re-rendering with a new callback does not tear the widget
  // down and re-attach it mid-typing, which drops the open dropdown.
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  useEffect(() => {
    const input = inputRef.current;
    if (!enabled || !input) return;
    if (!window.google?.maps?.places) return;

    const releaseStyles = acquirePacStyles();
    const ac = new window.google.maps.places.Autocomplete(input, {
      componentRestrictions: { country: "IN" },
      fields: ["formatted_address", "geometry"],
    });
    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc = place?.geometry?.location;
      if (!loc) return;
      onPlaceRef.current({
        at: { lat: loc.lat(), lng: loc.lng() },
        label: place?.formatted_address ?? "Pinned location",
      });
    });
    return () => {
      if (listener) google.maps.event.removeListener(listener);
      releaseStyles();
    };
  }, [enabled, inputRef]);
};

/**
 * My Maps-style categorical palette. Distinct enough to tell 66 polygons apart
 * at a glance, all legible against the light road basemap.
 */
const PALETTE = [
  "#e53935",
  "#1e88e5",
  "#43a047",
  "#8e24aa",
  "#fb8c00",
  "#00acc1",
  "#d81b60",
  "#5e35b1",
  "#f4511e",
  "#00897b",
  "#3949ab",
  "#c0ca33",
] as const;

/**
 * Deterministic color per instructor.
 *
 * Hashing the uuid rather than using list position keeps a layer's color
 * stable when Ops adds, removes, or re-sorts instructors — otherwise redrawing
 * one area would recolour every zone after it and make the sidebar swatches
 * meaningless.
 */
function colorFor(instructorId: string): string {
  let h = 0;
  for (let i = 0; i < instructorId.length; i += 1) {
    h = (h * 31 + instructorId.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}

/**
 * Coerces a legacy `Instructor.latitude/longitude` pair into a coordinate.
 *
 * Returns null unless BOTH values are finite numbers inside valid lat/lng
 * ranges. These columns predate validation, so a single bad row would
 * otherwise throw inside the Maps API rather than being skipped.
 */
function toZoneCoordinate(lat: unknown, lng: unknown): ZoneCoordinate | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

interface RosterRow {
  id_instructor: string;
  name: string;
  latitude: unknown;
  longitude: unknown;
  status: unknown;
  enabled: unknown;
}

function ringsEqual(
  a: ZoneCoordinate[] | null,
  b: ZoneCoordinate[] | null,
): boolean {
  if (!a || !b) return a === b;
  const x = openRing(a);
  const y = openRing(b);
  if (x.length !== y.length) return false;
  return x.every((p, i) => isSamePoint(p, y[i]));
}

function centroidOf(ring: ZoneCoordinate[]): ZoneCoordinate {
  if (!ring.length) return FALLBACK_CENTER;
  const sum = ring.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/**
 * Sidebar status tag, matching the colours the Instructor Management module
 * already uses for the same three states.
 *
 * Renders NOTHING for `active`, and for an unknown status. That is deliberate:
 * this chip sits on every one of ~130 sidebar rows, so badging the default state
 * would fill the list with "Active" and bury the two tags that actually tell an
 * admin something — on-break and inactive both mean the boundary is NOT a live
 * service area, which is the whole reason the sidebar needs them.
 *
 * The title carries the consequence, not just the state, so an admin hovering a
 * chip learns what Ops should do about it without leaving the screen.
 */
function ZoneStatusTag({ status }: { status?: InstructorStatus }) {
  if (!status || status === "active") return null;
  const meta = instructorStatusMeta(status);
  return (
    <span
      data-zone-status={status}
      title={
        status === "inactive"
          ? "Inactive — off the road. This service area is hidden on the map and never used for matching."
          : "On break — temporarily off the road. This service area is shown as an outline only."
      }
      className={cn(
        "shrink-0 rounded px-1 text-[10px] font-medium",
        meta.badgeClass,
      )}
    >
      {meta.label}
    </span>
  );
}

export default function InstructorZoneMap() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------- data ----

  // Rough polygons are stored in the same table as real service areas but are
  // NOT serviceability zones, so they stay off this screen by default and are
  // only rendered when an admin explicitly asks for them. Refetching on toggle
  // is free: zones-db caches the superset and applies the filter in memory.
  const [showRoughPolygons, setShowRoughPolygons] = useState(false);

  /**
   * Which instructor statuses are SHOWN, as three independent toggles.
   *
   * All three start on, so the sidebar and map list every Instructor out of the
   * box. Turning one off removes that status from the sidebar lists AND from the
   * drawn overlays, so an admin can answer "show me only who is available right
   * now" without the on-break outlines getting in the way.
   *
   * A view filter only — it never writes to the Instructor table. Declared here,
   * next to the rough toggle, because the zone memos below read it and `useState`
   * results are in the temporal dead zone until their line executes.
   *
   * Inactive instructors are now a normal view filter: their polygons ARE drawn
   * (and their rows listed) unless "Inactive" is switched off. This is a
   * display concern only — inactive instructors are still excluded from sales
   * and customer booking by the availability engine, independent of anything
   * toggled here.
   */
  const [statusFilter, setStatusFilter] = useState<
    Record<InstructorStatus, boolean>
  >({ active: true, on_break: true, inactive: true });

  /** True when this instructor's status is currently visible to the admin. */
  const statusVisible = useCallback(
    (status: InstructorStatus | undefined) => statusFilter[status ?? "active"],
    [statusFilter],
  );

  const {
    data: dbZones = [],
    isLoading: zonesLoading,
    error: zonesError,
  } = useQuery({
    // One key for both toggle states: the query always fetches BOTH kinds and
    // the toggle filters in memory. Refetching on toggle looked free (zones-db
    // caches the superset) but it moved the rough/verified split into two
    // different query states, which is what made the toggle read as a no-op —
    // turning it on returned the same verified rows PLUS the rough ones. The
    // split now lives in exactly one place, the `zones` memo below.
    queryKey: ["instructor-zones"],
    queryFn: async (): Promise<ZoneView[]> => {
      const fetched = await fetchDbZones({ includeRough: true });
      return fetched
        .map((z) => ({
          rowId: z.id,
          instructorId: z.instructorId,
          name: z.name,
          ring: openRing(z.coords),
          isRough: z.isRough,
        }))
        .filter((z) => z.ring.length >= 3);
    },
  });

  const { data: instructors = [] } = useQuery({
    queryKey: ["instructor-zone-roster"],
    queryFn: async (): Promise<
      {
        id: string;
        name: string;
        company: boolean;
        status: InstructorStatus;
        lat: number | null;
        lng: number | null;
      }[]
    > => {
      // Deliberately not selecting `is_company_instructor`: until migration
      // 20260929_100000 is applied PostgREST rejects the whole select. The name
      // list in company-instructors.ts covers the pre-migration case.
      //
      // latitude/longitude are safe to select — they predate this feature and
      // are already read by the booking engine's haversine fallback. They are
      // the instructor's RESIDENCE, which is a real address and is frequently
      // outside the service polygon it sits beside; they are never used to
      // derive or centre that polygon. They are nullable, so an instructor
      // without them still loads; toZoneCoordinate just drops those from the
      // marker layer.
      //
      // status/enabled drive the active / on-break / inactive behaviour below.
      const { data, error } = await supabase
        .from("Instructor")
        .select("id_instructor, name, latitude, longitude, status, enabled");
      if (error) throw error;
      return (
        (data ?? [])
          .map((r) => r as unknown as RosterRow)
          .filter((r) => typeof r.id_instructor === "string")
          .map((r) => ({
            r,
            status: resolveInstructorStatus({
              status: typeof r.status === "string" ? r.status : null,
              enabled: typeof r.enabled === "boolean" ? r.enabled : null,
            }),
            point: toZoneCoordinate(r.latitude, r.longitude),
          }))
          // Every instructor is listed, whatever their status: Ops needs to see
          // that an inactive person still HAS a drawn area (so they can judge
          // what reactivating them would restore), and that an on-break person's
          // boundary is intact before it comes back into service. What their
          // status changes is the DRAWING, further down — an inactive polygon is
          // withheld from the map entirely and an on-break one is outline-only.
          // Nothing is deleted either way, so flipping the status back restores
          // the area exactly as it was. `enabled` is only consulted as a fallback
          // for rows written before the status column existed.
          .map(({ r, status, point }) => ({
            id: r.id_instructor,
            name: (r.name ?? "").trim() || "Unnamed",
            company: isCompanyInstructor(r.name),
            status,
            lat: point?.lat ?? null,
            lng: point?.lng ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    },
  });

  /** Instructor id -> resolved status, for polygon/marker styling. */
  const statusById = useMemo(() => {
    const m = new Map<string, InstructorStatus>();
    for (const i of instructors) m.set(i.id, i.status);
    return m;
  }, [instructors]);

  /**
   * Every polygon belonging to a roster member, INCLUDING inactive instructors.
   *
   * This is the "do they already have a boundary?" set, and it must stay
   * status-agnostic. Two things depend on it and both would break if an inactive
   * instructor read as unmapped:
   *
   *  - The sidebar's "Not mapped" list. Someone who has a drawn area does not
   *    belong there just because Ops marked them inactive.
   *  - `startDrawing` / `commit` / `discardEdit`, which seed from, write to, and
   *    rewind against the existing ring. Narrowing this by the rough toggle would
   *    make a verified instructor look unmapped while Ops is reviewing rough
   *    polygons, and clicking "Draw service area" would then hit
   *    UNIQUE(instructor_id) and surface DUPLICATE_ZONE_MESSAGE on an instructor
   *    who already has one.
   */
  const rosterZoneRows = useMemo(() => {
    const rosterIds = new Set(instructors.map((i) => i.id));
    if (rosterIds.size === 0) return [];
    return dbZones.filter((z) => rosterIds.has(z.instructorId));
  }, [dbZones, instructors]);

  /**
   * Every polygon belonging to a roster member, INCLUDING inactive instructors.
   *
   * This is now simply the full roster's zones — the status toggles below gate
   * visibility on the map and in the sidebar. The old "allRosterZones" that
   * dropped inactive is gone; the statusFilter now controls everything.
   */
  const allRosterZones = useMemo(() => rosterZoneRows, [rosterZoneRows]);

  /**
   * The polygons this view is allowed to draw, of one kind at a time.
   *
   * The rough toggle is a MODE, not an addition: ON shows the rough boundaries
   * and only those, OFF shows the verified ones and only those. Previously ON
   * returned everything, which is why the switch appeared to do nothing — every
   * verified polygon stayed on screen alongside the rough ones. Filtering to
   * exactly one kind is what makes it legible for the Ops review it exists for.
   *
   * The statusFilter (Active / On break / Inactive) now gates ALL visibility.
   * All three default ON, so inactive polygons are drawn by default. Toggling
   * "Inactive" off hides them — this is the explicit control the user requested.
   */
  const zones = useMemo(
    () =>
      (showRoughPolygons
        ? allRosterZones.filter((z) => z.isRough)
        : allRosterZones.filter((z) => !z.isRough)
      ).filter((z) => statusVisible(statusById.get(z.instructorId))),
    [allRosterZones, showRoughPolygons, statusById, statusVisible],
  );

  /**
   * Instructor id -> their one polygon, whichever kind it is, active or not.
   *
   * Built from `rosterZoneRows`, not `zones`: existence and editing must both
   * survive the rough toggle and the inactive filter, or a mapped instructor
   * would be offered a "Draw service area" that collides with their own row.
   */
  const zoneByInstructor = useMemo(() => {
    const m = new Map<string, ZoneView>();
    for (const z of rosterZoneRows) m.set(z.instructorId, z);
    return m;
  }, [rosterZoneRows]);

  /**
   * What the sidebar's "Mapped" list renders.
   *
   * Gated by the SAME statusFilter that gates the map, so an inactive instructor
   * with a polygon is listed when the Inactive toggle is ON and drops out of
   * both columns when it is OFF.
   *
   * Deliberately NOT gated by the rough toggle. The rough switch is a display
   * mode for the MAP (see `zones`), but the sidebar is an inventory of who is
   * mapped, and "N of M instructors mapped" is already counted mode-agnostically
   * from `zoneByInstructor`. Filtering this list by rough mode used to DROP any
   * instructor whose polygon the mode was hiding: they left Mapped here, and
   * also left Not mapped (which skips anyone already in `zoneByInstructor`), so
   * they disappeared from the sidebar entirely. With one rough row that cost
   * exactly one person - an on_break instructor, so the sidebar showed 10
   * on_break badges against 11 on_break instructors - and switching rough mode
   * ON emptied the sidebar of every verified owner it hid (~67 rows).
   */
  const listedZones = useMemo(
    () =>
      rosterZoneRows.filter((z) =>
        statusVisible(statusById.get(z.instructorId)),
      ),
    [rosterZoneRows, statusById, statusVisible],
  );

  /**
   * Instructor id -> RESIDENCE coordinate, for instructors that have one.
   *
   * This is the instructor's home address from `Instructor.latitude/longitude`,
   * and it is only ever a marker position. It is deliberately NOT assumed to sit
   * inside, at the centre of, or anywhere near the service polygon — an
   * instructor living outside the area they cover is ordinary. Nothing in the
   * matching path reads this map: serviceability is decided solely by
   * ray-casting the polygon (see pinMatches). Missing entries fall back to the
   * polygon's centroid so those instructors still get a visible dot.
   */
  const rosterPointById = useMemo(() => {
    const m = new Map<string, ZoneCoordinate>();
    for (const i of instructors) {
      if (i.lat == null || i.lng == null) continue;
      m.set(i.id, { lat: i.lat, lng: i.lng });
    }
    return m;
  }, [instructors]);

  /**
   * How many rough polygons exist, counted from the FULL set.
   *
   * Counted from `allRosterZones` rather than `zones`, because `zones` already
   * excludes rough rows while the toggle is off — which would make the label
   * read "0 rough polygons" and imply Ops has nothing to review. The count has
   * to answer "is there anything to switch to?" independently of what is
   * currently on screen.
   */
  const roughCount = useMemo(
    () => allRosterZones.filter((z) => z.isRough).length,
    [allRosterZones],
  );

  /** Instructors with no usable lat/lng — drives the marker-mode hint. */
  const missingPointCount = useMemo(() => {
    // Counted over instructors who HAVE a polygon, not the whole roster. The
    // sentence is about dots ("their dot stays on the polygon centre"), and an
    // instructor with no polygon gets no dot at all - neither the residence nor
    // the centroid - so counting them overstated the number. Live data showed 4
    // against only 3 visible fallback dots, which reads as a missing-dot bug.
    //
    // Deliberately independent of the rough toggle and the status filters: the
    // hint reports missing DATA, not what happens to be on screen right now, so
    // it must not flap as Ops flips view switches.
    let n = 0;
    for (const i of instructors) {
      if (!zoneByInstructor.has(i.id)) continue;
      if (i.lat == null || i.lng == null) n += 1;
    }
    return n;
  }, [instructors, zoneByInstructor]);

  const zonesQueryKey = ["instructor-zones"] as const;

  const saveZone = useMutation({
    mutationFn: async (payload: {
      zoneId: string | null;
      instructorId: string;
      name: string;
      ring: ZoneCoordinate[];
      isRough: boolean;
    }) => {
      if (payload.ring.length < 3) {
        throw new Error("A service area needs at least 3 points.");
      }
      if (payload.ring.length > MAX_VERTICES) {
        throw new Error(
          `A service area can have at most ${MAX_VERTICES} vertices.`,
        );
      }
      // Per-zone write, keyed on the primary key. An instructor has one polygon
      // (UNIQUE(instructor_id), migration 20260928), so this resolves to the
      // same row an upsert-on-instructor_id would have hit — but it cannot
      // silently overwrite a different row. `zoneId === null` means the admin
      // drew a first polygon for an instructor who had none.
      //
      // `isRough` is always sent on update, including `false`, so refining a
      // rough boundary here promotes it to a real service area.
      if (payload.zoneId) {
        return updateZoneById({
          zoneId: payload.zoneId,
          coordinates: closeRing(payload.ring),
          rawName: payload.name,
          isRough: payload.isRough,
        });
      }
      return insertZone({
        instructorId: payload.instructorId,
        coordinates: closeRing(payload.ring),
        rawName: payload.name,
        isRough: payload.isRough,
      });
    },
    onSuccess: (saved) => {
      invalidateDbZoneCache();
      // Seed the cache from the row the write actually returned, so the saved
      // shape is on screen the moment the edit bar closes. The refetch below
      // still runs and is what makes this durable rather than merely optimistic.
      queryClient.setQueryData<ZoneView[]>(zonesQueryKey, (prev) => {
        const view: ZoneView = {
          rowId: saved.id,
          instructorId: saved.instructorId,
          name: saved.name,
          ring: openRing(saved.coords),
          isRough: saved.isRough,
        };
        const list = prev ?? [];
        const at = list.findIndex((z) => z.instructorId === view.instructorId);
        // With rough polygons hidden, a just-saved rough row must not be
        // injected into the real-zone list — that would show exactly the thing
        // the toggle is meant to suppress. The refetch restores the truth.
        if (view.isRough && !showRoughPolygons) {
          return at === -1 ? list : list.filter((_, i) => i !== at);
        }
        if (at === -1) return [...list, view];
        const next = [...list];
        next[at] = view;
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["instructor-zones"] });
    },
  });

  const deleteZone = useMutation({
    mutationFn: async (zoneId: string) => {
      await deleteZoneById(zoneId);
    },
    onSuccess: () => {
      invalidateDbZoneCache();
      void queryClient.invalidateQueries({ queryKey: zonesQueryKey });
    },
  });

  /**
   * Promotes a rough boundary to a real service area: one UPDATE setting
   * `is_rough = false` on the existing row.
   *
   * Deliberately a flag flip and NOT a re-draw. `UNIQUE(instructor_id)` means
   * the instructor already owns this row, so "make it normal" is a promotion of
   * the geometry Ops (or the onboarding wizard) already stored — it must not
   * insert a second row, and it must not touch `coordinates`. Re-saving the ring
   * would work but would silently overwrite whatever the polygon looks like now,
   * which is not what "promote" means.
   *
   * `updateZoneById` sends `is_rough: false` explicitly rather than omitting
   * the column, and that is load-bearing: a pre-migration database (no
   * `is_rough` column) can degrade this write safely, whereas silently dropping
   * `is_rough: true` on a rough save would store an unverified boundary as a
   * real service area — the exact harm the flag exists to prevent. Going
   * rough -> verified is the safe direction to degrade.
   *
   * The row only becomes visible in the normal view after the refetch below, so
   * the "promoted" zone does not linger in the rough list.
   */
  const promoteZone = useMutation({
    mutationFn: async (params: { zoneId: string; instructorId: string }) => {
      const saved = await updateZoneById({
        zoneId: params.zoneId,
        isRough: false,
      });
      return saved;
    },
    onSuccess: (saved) => {
      invalidateDbZoneCache();
      queryClient.setQueryData<ZoneView[]>(zonesQueryKey, (prev) => {
        const list = prev ?? [];
        const at = list.findIndex((z) => z.instructorId === saved.instructorId);
        if (at === -1) return list;
        const next = [...list];
        next[at] = { ...next[at], isRough: false };
        // While the rough toggle is OFF this row was not on screen at all, so
        // adding it here would make a polygon appear without the admin asking
        // for the verified view. The refetch is what makes it show up.
        return next[at].isRough || showRoughPolygons ? next : list;
      });
      void queryClient.invalidateQueries({ queryKey: zonesQueryKey });
      toast({
        title: "Polygon promoted",
        description: `${saved.name} is now a verified service area.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Could not promote polygon",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  /**
   * Demotes a verified service area back to a rough/provisional boundary:
   * one UPDATE setting `is_rough = true` on the existing row.
   *
   * Symmetric with `promoteZone` — a flag flip only, no geometry change.
   * Useful when Ops realises a boundary was marked verified prematurely
   * and needs to send it back for review.
   */
  const demoteZone = useMutation({
    mutationFn: async (params: { zoneId: string; instructorId: string }) => {
      const saved = await updateZoneById({
        zoneId: params.zoneId,
        isRough: true,
      });
      return saved;
    },
    onSuccess: (saved) => {
      invalidateDbZoneCache();
      queryClient.setQueryData<ZoneView[]>(zonesQueryKey, (prev) => {
        const list = prev ?? [];
        const at = list.findIndex((z) => z.instructorId === saved.instructorId);
        if (at === -1) return list;
        const next = [...list];
        next[at] = { ...next[at], isRough: true };
        // While the rough toggle is ON this row was not on screen, so
        // adding it here would make a rough polygon appear without the
        // admin asking for the rough view. The refetch restores the truth.
        return next[at].isRough && showRoughPolygons ? next : list;
      });
      void queryClient.invalidateQueries({ queryKey: zonesQueryKey });
      toast({
        title: "Polygon demoted",
        description: `${saved.name} is now a rough boundary.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Could not demote polygon",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    },
  });

  // ---------------------------------------------------------------- state ----

  const [mapsLib, setMapsLib] = useState<typeof google.maps | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPolygons, setShowPolygons] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  /**
   * Whether "Instructor markers" draws the real `Instructor.latitude/longitude`
   * pin (the instructor's RESIDENCE) or the polygon's centroid dot.
   *
   * Both are drawn as a `Circle`, so switching re-runs the overlay effect and
   * swaps the position. The residence is now the default: it is the point the
   * marker is *meant* to show, it is a real address, and it is routinely
   * outside the service polygon drawn beside it — which is correct, not a data
   * error. The centroid remains available as a fallback for instructors with no
   * residence on file, and is used automatically for them regardless of this
   * setting.
   *
   * Neither position is ever used to decide serviceability. Matching is
   * polygon-only (see pinMatches), so no residence or centroid coordinate can
   * influence which instructor is considered to cover an address.
   */
  const [useInstructorCoords, setUseInstructorCoords] = useState(true);

  /** Set when the active basemap changes, so fitAll re-frames it. */
  const [mapTypeId, setMapTypeId] = useState<string>("roadmap");

  /** Whether the map is in fullscreen presentation mode. */
  const [isFullscreen, setIsFullscreen] = useState(false);

  /** True once the `places` sub-library is ready for the search autocomplete. */
  const [placesReady, setPlacesReady] = useState(false);
  /**
   * Set on first focus/typing of either search box, which then loads `places`.
   * Tracked per box rather than as one flag so the library still loads when only
   * the sidebar filter is used, without the header input eagerly requesting it.
   */
  const [searchEngaged, setSearchEngaged] = useState(false);
  const [locationFilterEngaged, setLocationFilterEngaged] = useState(false);

  /**
   * Per-instructor layer visibility, keyed by instructor id. My Maps hides a
   * layer by unchecking it; that is purely a rendering concern here, so this is
   * deliberately NOT persisted to the database.
   */
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const toggleLayer = useCallback((instructorId: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(instructorId)) next.delete(instructorId);
      else next.add(instructorId);
      return next;
    });
  }, []);

  const showAllLayers = useCallback(() => setHiddenIds(new Set<string>()), []);
  const hideAllLayers = useCallback(
    () => setHiddenIds(new Set(zones.map((z) => z.instructorId))),
    [zones],
  );

  /**
   * The zone being reshaped in place, or null when nothing is being edited.
   *
   * Editing happens on this same map rather than in a dialog: the admin moves a
   * real handle on the real map, with every other layer still around for
   * reference, and the viewport they had chosen is never taken away from them.
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  /**
   * Whether the boundary being edited is provisional. A rough polygon is
   * excluded from every sales/customer match, so this switch is the only thing
   * standing between a hand-click approximation and live auto-assignment — it
   * is stated explicitly in the editor rather than inferred.
   */
  const [editingIsRough, setEditingIsRough] = useState(false);
  /** The persisted ring this edit started from; the target for Cancel. */
  const [savedDraft, setSavedDraft] = useState<ZoneCoordinate[] | null>(null);
  /** Mirrors the live ring for `dirty`, without waiting for a React commit. */
  const [draft, setDraft] = useState<ZoneCoordinate[] | null>(null);

  // The undo stack lives in the shared hook so this editor and the onboarding
  // step behave identically, and so every change — a dragged vertex, a midpoint
  // bulge, a deletion — is undoable by construction.
  const zoneHistory = useZoneHistory(editingId ? savedDraft : null, setDraft, [
    editingId,
  ]);
  const draftRing = zoneHistory.ring;

  const [placeQuery, setPlaceQuery] = useState("");
  const [pin, setPin] = useState<{ at: ZoneCoordinate; label: string } | null>(
    null,
  );
  /**
   * Location filter, as a second axis alongside the text query.
   *
   * `active` is what the button below "Filter instructors" toggles. It only
   * narrows the list once a pin exists to narrow it *by* — opening the panel is
   * not the same as committing to a location, otherwise clicking the button
   * would silently filter by whatever pin the header search left lying around.
   * `locationQuery` is this panel's own text, kept separate from the header's
   * `placeQuery` so the two searches cannot clobber each other's input.
   */
  const [locationFilter, setLocationFilter] = useState({
    active: false,
    query: "",
  });

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const locationInputRef = useRef<HTMLInputElement | null>(null);
  const overlaysRef = useRef<
    Map<
      string,
      {
        polygon: google.maps.Polygon | null;
        marker: google.maps.Circle | null;
        /** Dashed ring drawn in place of a rough polygon's solid edge. */
        dash: google.maps.Polyline | null;
      }
    >
  >(new Map());
  const pinMarkerRef = useRef<google.maps.Marker | null>(null);

  /**
   * Which instructors serve the dropped pin.
   *
   * This is the sales question the page exists to answer ("who covers this
   * address?"), so it mirrors the dashboard's matching rule exactly: ray-cast
   * `pointInPolygon` against each instructor's own ring. Company backups are
   * excluded — Ops assigns those by hand and they must never be auto-matched.
   *
   * Declared up here rather than next to the render because the overlay effect
   * needs it: a committed location narrows the MAP to the covering polygons,
   * not just the sidebar, so the effect below has to read the match set. It used
   * to sit below the filters, where only the panel could reach it.
   */
  const pinMatches = useMemo(() => {
    if (!pin) return null;
    return zones.filter(
      (z) => !isCompanyInstructor(z.name) && pointInPolygon(pin.at, z.ring),
    );
  }, [pin, zones]);

  /**
   * The set of instructor ids the location filter admits, or null when the
   * filter is not narrowing anything.
   *
   * null and an empty set are deliberately different: null means "no location
   * constraint" (list and map are governed by the text query alone), while an
   * empty set means "this point is covered by nobody" and must empty the list.
   * Collapsing the two would show every instructor for a point no polygon
   * reaches.
   */
  const locationMatchedIds = useMemo(() => {
    if (!locationFilter.active || !pinMatches) return null;
    return new Set(pinMatches.map((z) => z.instructorId));
  }, [locationFilter.active, pinMatches]);

  /**
   * Auto-select the instructor whose polygon covers a freshly committed pin.
   *
   * "Search this address" is a question about ONE place, so the map should land
   * on an answer rather than waiting for a click: the covering layer is
   * selected and the camera frames it. Only the FIRST match is auto-selected
   * even when several cover the point — `selectedId` is single-select, and an
   * existing selection that is still one of the matches is deliberately kept so
   * a manual pick is not overridden by an unrelated re-render.
   *
   * A point covered by nobody clears the selection instead: leaving a stale
   * layer highlighted after the answer changed to "nobody" reads as a bug.
   */
  useEffect(() => {
    if (!locationFilter.active) return;
    if (!pinMatches || pinMatches.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && pinMatches.some((z) => z.instructorId === prev)
        ? prev
        : pinMatches[0].instructorId,
    );
  }, [locationFilter.active, pinMatches]);

  /**
   * Selection handler for map overlays. Held in a ref so the overlay effect
   * does not list it as a dependency: it is re-created on every render, and
   * depending on it would tear down and rebuild all 66 polygons each time.
   */
  const onSelectRef = useRef<(id: string) => void>(() => {});

  /**
   * Whether an inline edit is in progress, readable from callbacks that must not
   * re-subscribe. `fitTo` uses it to leave the camera alone mid-edit without
   * taking `editingId` as a dependency, which would re-create it — and re-run
   * every selection handler — on each edit state change.
   */
  const editingIdRef = useRef<string | null>(editingId);
  editingIdRef.current = editingId;

  const dirty = !ringsEqual(draft, savedDraft);
  // ----------------------------------------------------------------- map ----

  useEffect(() => {
    let active = true;
    googleMapsLoader
      .loadMaps(["Polygon", "Circle", "Marker"])
      .then((gm) => {
        if (active) {
          setMapsLib(gm);
          setMapError(null);
        }
      })
      .catch(() => {
        if (active) setMapError("Google Maps failed to load.");
      });
    return () => {
      active = false;
    };
  }, []);

  // Places autocomplete for the header search. Same pattern as the address field
  // in instructors.tsx: attach the legacy Autocomplete widget to the raw input,
  // and inject the .pac-container z-index override because the dropdown is
  // appended to <body> and would otherwise render under the header bar.
  //
  // Deliberately deferred until the user actually engages the field: the
  // `places` sub-library is ~486 KB on top of the 315 KB bootstrap, and most
  // visits to this page are "look at the map", not "type an address".
  useEffect(() => {
    if (!searchEngaged && !locationFilterEngaged) return;
    let active = true;
    googleMapsLoader
      .importLibrary("places")
      .then(() => {
        if (active) setPlacesReady(true);
      })
      .catch(() => {
        if (active) setPlacesReady(false);
      });
    return () => {
      active = false;
    };
  }, [searchEngaged, locationFilterEngaged]);

  usePlacesAutocomplete(
    locationInputRef,
    placesReady,
    useCallback(({ at, label }) => {
      setLocationFilter((f) => ({ ...f, query: label, active: true }));
      setPin({ at, label });
    }, []),
  );

  useEffect(() => {
    const el = mapDivRef.current;
    if (!el || !mapsLib || mapInstance) return;
    setMapInstance(
      new mapsLib.Map(el, {
        center: FALLBACK_CENTER,
        zoom: DEFAULT_ZOOM,
        gestureHandling: "greedy",
        disableDefaultUI: true,
        zoomControl: true,
      }),
    );
  }, [mapsLib, mapInstance]);

  // polygons + centroid markers
  //
  // Both members of an overlay entry are nullable: a layer toggle can turn one
  // off entirely, so an entry may hold only a polygon or only a marker. The
  // teardown MUST null-check -- an unconditional `polygon.setMap(null)` on a
  // null member throws, which React surfaces as an unhandled render/effect
  // error and unmounts the whole page (blank screen, every test selector gone).
  const clearOverlays = useCallback(() => {
    for (const { polygon, marker, dash } of overlaysRef.current.values()) {
      polygon?.setMap(null);
      marker?.setMap(null);
      dash?.setMap(null);
    }
    overlaysRef.current.clear();
  }, []);

  useEffect(() => {
    const map = mapInstance;
    const ML = mapsLib;
    if (!map || !ML?.Polygon || !ML?.Circle || !ML?.Polyline) return;

    clearOverlays();

    if (showPolygons || showMarkers) {
      for (const z of zones) {
        // The zone under edit is drawn by the editing effect below. Skipping it
        // here keeps a read-only copy from sitting under the vertex handles and
        // swallowing the clicks meant for them.
        if (z.instructorId === editingId) continue;

        // Per-layer visibility from the sidebar swatch checkbox. Toggling it
        // only affects rendering; it never touches stored geometry.
        if (hiddenIds.has(z.instructorId)) continue;

        // A committed location narrows the MAP, not just the sidebar list.
        // "Which instructors serve this address?" is answered by showing the
        // covering shapes at full size; leaving 70 unrelated polygons on screen
        // buries the answer and makes the fitBounds zoom meaningless. An EMPTY
        // match set is still a constraint and must blank the map — falling
        // through to "show everything" there would draw a blank result as if
        // every polygon covered the point.
        if (locationMatchedIds && !locationMatchedIds.has(z.instructorId)) {
          continue;
        }

        const selected = z.instructorId === selectedId;
        const color = colorFor(z.instructorId);
        const onBreak = statusById.get(z.instructorId) === "on_break";
        // Outline-only for both non-serviceable cases, and for different
        // reasons: a rough polygon has not been verified, and an on-break
        // instructor is temporarily off the road. Neither is a filled
        // serviceability area, so neither gets a filled area.
        const outlineOnly = onBreak || z.isRough;
        // A rough boundary is dashed as well as transparent, so it stays
        // distinguishable even for a colour-blind reader and in a screenshot.
        // Google Maps has no dash on Polygon, so the rough ring is stroked with
        // a Symbol; see the `if (z.isRough)` block below.
        let polygon: google.maps.Polygon | null = null;
        let dash: google.maps.Polyline | null = null;
        if (showPolygons) {
          polygon = new ML.Polygon({
            paths: z.ring,
            map,
            strokeColor: selected ? SELECTED_STROKE : color,
            strokeWeight: selected ? 3 : 2,
            fillColor: selected ? SELECTED_FILL : color,
            fillOpacity: outlineOnly ? 0 : selected ? 0.3 : 0.18,
            // Clickable so clicking a polygon in the map selects its sidebar
            // row, matching My Maps' two-way layer/map selection. `setMap(null)`
            // on the next render pass drops the listener with the overlay.
            clickable: true,
            zIndex: selected ? 3 : 1,
          });
          polygon.addListener("click", () =>
            onSelectRef.current(z.instructorId),
          );
          if (z.isRough) {
            // Suppress the solid edge, then redraw the ring dashed. Without this
            // a rough polygon would have BOTH fillOpacity and strokeOpacity at 0
            // and be completely invisible — showing the toggle would appear to do
            // nothing. Google Maps has no dash style on Polygon, so the dashed
            // edge is a separate Polyline stroked with a repeating tick icon.
            polygon.setOptions({ strokeOpacity: 0 });
            // Re-close the ring: `ring` is open, and a Polyline drawn from an
            // open path leaves a gap on one edge.
            dash = new ML.Polyline({
              path: [...z.ring, z.ring[0]],
              map,
              strokeColor: selected ? SELECTED_STROKE : color,
              strokeWeight: selected ? 3 : 2,
              strokeOpacity: 0.95,
              clickable: true,
              zIndex: selected ? 3 : 1,
              icons: [
                {
                  icon: {
                    path: "M 0,-1 0,1",
                    strokeOpacity: 1,
                    strokeWeight: 2,
                    scale: 3,
                  },
                  offset: "0",
                  repeat: "10px",
                },
              ],
            });

            dash.addListener("click", () =>
              onSelectRef.current(z.instructorId),
            );
          }
        }
        let marker: google.maps.Circle | null = null;
        if (showMarkers) {
          // The dot marks the instructor's RESIDENCE, which is a real address
          // and is routinely outside the service polygon drawn beside it. It is
          // never used as the polygon's centre, and no serviceability decision
          // reads it — matching is polygon-only (see pinMatches).
          const rosterPoint = useInstructorCoords
            ? (rosterPointById.get(z.instructorId) ?? null)
            : null;
          marker = new ML.Circle({
            map,
            center: rosterPoint ?? centroidOf(z.ring),
            radius: MARKER_RADIUS_METERS,
            fillColor: selected ? SELECTED_FILL : color,
            // Hollow for the same outline-vs-filled distinction the polygons
            // use, so an on-break instructor reads as offline at a glance.
            fillOpacity: outlineOnly ? 0.15 : 0.95,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            clickable: true,
            zIndex: selected ? 4 : 2,
          });
          marker.addListener("click", () =>
            onSelectRef.current(z.instructorId),
          );
        }
        if (polygon || marker || dash) {
          overlaysRef.current.set(z.instructorId, { polygon, marker, dash });
        }
      }
    }
  }, [
    mapInstance,
    mapsLib,
    zones,
    showPolygons,
    showMarkers,
    selectedId,
    editingId,
    hiddenIds,
    rosterPointById,
    useInstructorCoords,
    statusById,
    locationMatchedIds,
    clearOverlays,
  ]);

  useEffect(
    () => () => {
      clearOverlays();
      pinMarkerRef.current?.setMap(null);
      pinMarkerRef.current = null;
    },
    [clearOverlays],
  );

  // Keep the live map in step with the basemap/fullscreen state. Declared as a
  // pair of effects rather than inline in the control handlers so the map is
  // correct on first paint too, not only after a click.
  useEffect(() => {
    if (!mapInstance) return;
    mapInstance.setMapTypeId(mapTypeId as google.maps.MapTypeId);
  }, [mapInstance, mapTypeId]);

  // The Fullscreen API needs a stable element to promote, so the map container
  // is marked with the key and we listen for the browser's own change events
  // (Esc, F11-style exits) instead of trusting our click handler alone.
  useEffect(() => {
    const el = mapWrapRef.current;
    if (!el) return;
    const sync = () => setIsFullscreen(document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // ------------------------------------------------- inline zone editing ----

  /**
   * The polygon the admin is currently reshaping.
   *
   * It is a real, editable `Polygon` on the same map as every other layer, so
   * Google provides the red vertex handles and the midpoint bulges for free.
   * Listening to those is the whole input layer of the inline editor.
   */
  const editPolygonRef = useRef<google.maps.Polygon | null>(null);
  // The path is an `MVCArray`, not a Maps `MVCObject`: `clearInstanceListeners`
  // on the polygon does not reach the `set_at`/`insert_at`/`remove_at` handlers
  // registered on the path, so it is tracked separately to be detached on teardown.
  const editPathRef = useRef<google.maps.MVCArray<google.maps.LatLng> | null>(
    null,
  );
  const editDotsRef = useRef<google.maps.Circle[]>([]);
  /**
   * Live copy of the history's ring. The path listener is bound to the polygon
   * (not to an effect run), so it must read the current ring from here rather
   * than closing over one — otherwise its "is this just our own setPath echo?"
   * guard compares against a stale ring and records every reconciliation.
   */
  const draftRingRef = useRef(draftRing);
  draftRingRef.current = draftRing;
  const applyEditRef = useRef(zoneHistory.apply);
  applyEditRef.current = zoneHistory.apply;

  const destroyEditPolygon = useCallback(() => {
    const path = editPathRef.current;
    if (path) {
      google.maps.event.clearInstanceListeners(path);
      editPathRef.current = null;
    }
    const polygon = editPolygonRef.current;
    if (polygon) {
      google.maps.event.clearInstanceListeners(polygon);
      polygon.setMap(null);
    }
    editPolygonRef.current = null;
  }, []);

  useEffect(() => destroyEditPolygon, [destroyEditPolygon]);

  useEffect(() => {
    const map = mapInstance;
    const PolygonCtor = mapsLib?.Polygon;
    if (!map || !PolygonCtor) return;

    // Three points is the minimum for a closed ring, and `draftRing` is the
    // history's live ring, so undo/redo and vertex edits both flow through here.
    if (!editingId || draftRing.length < 3) {
      destroyEditPolygon();
      return;
    }

    // `set_at` / `insert_at` / `remove_at` are emitted by the path's
    // `MVCArray`, NOT by the Polygon. The Polygon is an `MVCObject` and only
    // raises Maps events (`click`, `dragstart`, ...), so listening on it for
    // those three never fires: the handles move on screen while our state keeps
    // the seeded ring, and Save then writes the original shape straight back.
    // That was the bug — this listener is the one thing that makes the save
    // actually stick.
    //
    // Declared above both branches because the reconciliation branch below also
    // needs them. The body reads `editPolygonRef.current` at call time so it
    // stays correct for the polygon's whole life, across effect re-runs.
    let lastAt = 0;
    const onPathChange = () => {
      const polygon = editPolygonRef.current;
      if (!polygon) return;
      const next = polygon
        .getPath()
        .getArray()
        .map((p) => ({ lat: p.lat(), lng: p.lng() }));
      // Drops the echo of our own setPath so it cannot be double-recorded.
      // `draftRingRef` rather than the captured `draftRing`, because this
      // handler outlives the effect run that created it.
      if (arraysEqual(next, draftRingRef.current)) return;

      // A vertex drag emits one event per animation frame, and the Polygon has
      // no per-vertex dragstart (its own only covers a whole-shape drag, which
      // is disabled). So a drag is delimited by time instead: events within
      // `DRAG_BURST_MS` of each other collapse into a single undo slot.
      const now = Date.now();
      const burst = now - lastAt < DRAG_BURST_MS;
      lastAt = now;
      applyEditRef.current(
        next,
        burst ? { coalesce: DRAG_COALESCE_KEY } : undefined,
      );
    };

    // Idempotent: re-points the listeners at whatever `getPath()` returns now,
    // detaching whatever they were on before. `setPath` swaps in a NEW
    // MVCArray, so without this a single reconciliation pass would silently kill
    // editing for the rest of the session.
    const attachPathListeners = (polygon: google.maps.Polygon) => {
      const path = polygon.getPath();
      if (editPathRef.current === path) return;
      if (editPathRef.current) {
        google.maps.event.clearInstanceListeners(editPathRef.current);
      }
      path.addListener("insert_at", onPathChange);
      path.addListener("set_at", onPathChange);
      path.addListener("remove_at", onPathChange);
      editPathRef.current = path;
    };

    if (editPolygonRef.current) {
      const polygon = editPolygonRef.current;
      // `MVCArray` has no `map`; `getArray()` is the real JS array.
      const current = polygon
        .getPath()
        .getArray()
        .map((p) => ({ lat: p.lat(), lng: p.lng() }));
      if (!arraysEqual(current, draftRing)) {
        // Reconciliation after a vertex edit, undo/redo, or a re-seed.
        polygon.setPath(draftRing);
      }
      attachPathListeners(polygon);
      return;
    }

    const polygon = new PolygonCtor({
      paths: draftRing,
      map,
      editable: true,
      // Dragging the whole shape would move every point away from the streets
      // Ops drew it along; per-vertex handles are the editing model.
      draggable: false,
      visible: true,
      strokeColor: EDITING_STROKE,
      strokeWeight: 2,
      fillColor: EDITING_FILL,
      fillOpacity: 0.2,
      geodesic: true,
      zIndex: 40,
    });

    // Test handle on the live editing polygon. The suite fires a real `set_at`
    // on `__zoneEditPolygon.getPath()` — the one event the editor must react to.
    // Without a handle on it, a listener registered on the wrong object is
    // completely invisible to tests, which is how "Save area" came to write the
    // original ring back while the handles looked like they were working.
    // Not DEV-gated: the suite runs a production build, where DEV is false.
    // Exposes only a map object that is already on screen.
    (
      window as unknown as { __zoneEditPolygon?: google.maps.Polygon }
    ).__zoneEditPolygon = polygon;

    editPolygonRef.current = polygon;
    attachPathListeners(polygon);
  }, [mapInstance, mapsLib, editingId, draftRing, destroyEditPolygon, toast]);

  // ------------------------------------------------------- map drawing ----

  /**
   * Sidebar row elements, so selecting a layer on the map can scroll the
   * matching row into view. Populated by each row via its ref callback.
   */
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const registerRow = useCallback(
    (id: string, el: HTMLButtonElement | null) => {
      if (el) rowRefs.current.set(id, el);
      else rowRefs.current.delete(id);
    },
    [],
  );

  /**
   * Begin reshaping an instructor's existing boundary directly on this map.
   *
   * No dialog, no second map: the point of "Edit points" is that the admin
   * nudges the shape that is already on screen, so the seeded ring is loaded
   * as both the live draft and the Cancel target.
   */
  const startInlineEdit = useCallback(
    (id: string, name: string) => {
      const existing = zoneByInstructor.get(id);
      const initial = existing ? closeRing(existing.ring) : null;
      setEditingId(id);
      setEditingName(name);
      // Seed from the stored flag so editing a rough boundary keeps it rough
      // unless the admin deliberately promotes it. A brand-new draw defaults to
      // a real service area — that is the common case on this screen.
      setEditingIsRough(existing ? existing.isRough : false);
      setSavedDraft(initial);
      setDraft(initial);
      setSelectedId(id);
    },
    [zoneByInstructor],
  );

  const startDrawing = useCallback(
    (id: string, name: string) => {
      if (zoneByInstructor.has(id)) {
        // An instructor who already has a boundary is reshaped in place. There
        // is deliberately no "redraw from scratch" path: it throws away a real
        // Ops-drawn area to replace it with a hand-click approximation.
        toast({
          title: "Editing in place",
          description: `Drag the points of ${name}'s area to reshape it. Drag a bulge on an edge to add a point.`,
        });
      }
      // Either way it is the same editor on the same map: an existing ring is
      // seeded, an absent one starts empty and grows from map clicks.
      startInlineEdit(id, name);
    },
    [zoneByInstructor, startInlineEdit, toast],
  );

  // ------------------------------------------------ first-draw point input ---

  /**
   * Click-to-add-vertex, for an instructor who has no boundary yet.
   *
   * Once a polygon exists the handles own the input and this listener is not
   * registered at all, so a click that lands just outside the shape cannot
   * silently add a stray vertex to a real Ops-drawn area.
   */
  const addEditPoint = useCallback(
    (at: ZoneCoordinate) => {
      // A jittery tap on the last point would add a zero-length edge, which
      // `pointInPolygon`'s even-odd parity turns into a genuine risk for
      // self-touching rings. Re-clicking the last point is also how an admin
      // naturally signals "I'm done", so it must not corrupt the ring.
      if (
        isSamePoint(zoneHistory.ring[zoneHistory.ring.length - 1] ?? at, at)
      ) {
        return;
      }
      zoneHistory.apply([...zoneHistory.ring, at]);
    },
    [zoneHistory],
  );

  // Held in a ref so entering/leaving edit mode does not tear down and rebuild
  // the map's own listeners.
  const addEditPointRef = useRef<(at: ZoneCoordinate) => void>(() => {});
  addEditPointRef.current = addEditPoint;

  const [atVertexLimit, setAtVertexLimit] = useState(false);
  const [needsMorePoints, setNeedsMorePoints] = useState(0);
  useEffect(() => {
    setAtVertexLimit(zoneHistory.ring.length >= MAX_VERTICES);
    setNeedsMorePoints(Math.max(0, 3 - zoneHistory.ring.length));
  }, [zoneHistory.ring]);

  useEffect(() => {
    const map = mapInstance;
    // Only for a first draw. A ring of 3+ points is already drawn as an
    // editable polygon, where Google handles the input.
    if (!map || !editingId || zoneHistory.ring.length >= 3) return;
    // The Maps API's own "click" is used rather than a DOM listener on the
    // container: only it knows how to convert a canvas position into a LatLng.
    // Its listener is removed individually on cleanup —
    // clearInstanceListeners() would also drop the map's internal handlers.
    const listener = google.maps.event.addListener(
      map,
      "click",
      (ev: google.maps.MapMouseEvent) => {
        if (!ev.latLng) return;
        addEditPointRef.current({
          lat: ev.latLng.lat(),
          lng: ev.latLng.lng(),
        });
      },
    );
    return () => google.maps.event.removeListener(listener);
  }, [mapInstance, editingId, zoneHistory.ring]);

  // Progress dots for a first draw. A polygon needs 3 points to enclose an
  // area, so below that the clicked points are marked individually.
  useEffect(() => {
    const map = mapInstance;
    const ML = mapsLib;
    if (!map || !ML?.Circle || !editingId || zoneHistory.ring.length >= 3) {
      editDotsRef.current.forEach((d) => d.setMap(null));
      editDotsRef.current = [];
      return;
    }
    const points = zoneHistory.ring;
    while (editDotsRef.current.length > points.length) {
      editDotsRef.current.pop()?.setMap(null);
    }
    points.forEach((point, i) => {
      const existing = editDotsRef.current[i];
      if (existing) {
        existing.setCenter(point);
        return;
      }
      editDotsRef.current[i] = new ML.Circle({
        map,
        center: point,
        radius: MARKER_RADIUS_METERS,
        fillColor: "#ffffff",
        fillOpacity: 1,
        strokeColor: EDITING_STROKE,
        strokeWeight: 2,
        clickable: false,
        zIndex: 41,
      });
    });
  }, [mapInstance, mapsLib, editingId, zoneHistory.ring]);

  useEffect(() => {
    return () => {
      editDotsRef.current.forEach((d) => d.setMap(null));
      editDotsRef.current = [];
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = mapWrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      // Browsers reject this outside a user gesture or in an iframe without
      // allow="fullscreen". Not worth a toast — the control just no-ops.
      setIsFullscreen(false);
    }
  }, []);

  const fitTo = useCallback(
    (points: ZoneCoordinate[]) => {
      if (!mapInstance || !points.length) return;
      // Refusing to move the camera mid-edit is the whole point of editing on
      // the main map: the admin panned and zoomed deliberately, and an
      // auto-fit triggered by a vertex or selection change would yank the area
      // out from under the drag they are in the middle of.
      if (editingIdRef.current) return;
      if (points.length === 1) {
        mapInstance.panTo(points[0]);
        mapInstance.setZoom(14);
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      for (const p of points) bounds.extend(p);
      mapInstance.fitBounds(bounds, 48);
    },
    [mapInstance],
  );

  const fitZone = useCallback(
    (id: string) => {
      const z = zoneByInstructor.get(id);
      if (z) fitTo(z.ring);
    },
    [fitTo, zoneByInstructor],
  );

  const fitAll = useCallback(() => {
    const all = zones.flatMap((z) => z.ring);
    if (all.length) fitTo(all);
  }, [fitTo, zones]);

  /**
   * Exports every visible layer as GeoJSON.
   *
   * GeoJSON rather than a KML round-trip: Ops' source of truth is now this
   * table, so a KML export would just reintroduce the hand-maintained alias
   * problem the migration removed. `properties.instructor_id` is included so a
   * re-import can be matched on the uuid instead of the display name.
   */
  const exportGeoJson = useCallback(() => {
    const features = zones
      .filter((z) => !hiddenIds.has(z.instructorId))
      .map((z) => ({
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          // GeoJSON wants an explicitly closed ring; stored rings already are.
          coordinates: [z.ring.map((p) => [p.lng, p.lat])],
        },
        properties: {
          instructor_id: z.instructorId,
          name: z.name,
          color: colorFor(z.instructorId),
        },
      }));
    const blob = new Blob(
      [JSON.stringify({ type: "FeatureCollection", features }, null, 2)],
      {
        type: "application/geo+json",
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "instructor-service-areas.geojson";
    a.click();
    // Revoking immediately can race the download in some browsers; deferring a
    // tick is the conventional fix.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast({ title: `Exported ${features.length} service areas` });
  }, [zones, hiddenIds, toast]);

  // ------------------------------------------------------------- pin/place ----

  /**
   * Test handles for the location filter.
   *
   * `__zoneSamplePin` returns a point that the app's own matcher confirms is
   * inside a real, currently-loaded polygon, so a test never has to hard-code a
   * coordinate. Coverage is live Ops data that gets redrawn, so a baked-in
   * fixture point silently drifts outside every ring and the test either flakes
   * or (worse) passes for the wrong reason. Sampling through the same
   * `pointInPolygon` used for matching means the fixture cannot disagree with
   * the feature it is testing.
   *
   * `__zoneSetPin` drops that pin. `apply` runs the same commit path the Search
   * button uses, so a passing test exercises production code rather than a
   * parallel test-only branch. Both are how the filter gets deterministic
   * coverage without the Maps script, a network round trip, or a Geocoder.
   *
   * Not DEV-gated: the suite runs a production build, where DEV is false.
   */
  useEffect(() => {
    const w = window as unknown as {
      __zoneSamplePin?: () => { at: ZoneCoordinate; label: string } | null;
      __zoneSetPin?: (
        at: ZoneCoordinate,
        label: string,
        apply: boolean,
      ) => void;
    };
    w.__zoneSamplePin = () => {
      // A vertex sits exactly on the boundary, where even-odd parity is
      // undefined, so step a fraction toward the ring's centroid. Re-checking
      // with `pointInPolygon` means a concave ring that the nudge pushed out of
      // is rejected rather than silently returned as an "interior" point.
      for (const z of zones) {
        if (isCompanyInstructor(z.name) || z.ring.length < 3) continue;
        const probe = z.ring[0];
        const centroid = z.ring.reduce(
          (acc, p) => ({
            lat: acc.lat + p.lat / z.ring.length,
            lng: acc.lng + p.lng / z.ring.length,
          }),
          { lat: 0, lng: 0 },
        );
        const at = {
          lat: probe.lat * 0.98 + centroid.lat * 0.02,
          lng: probe.lng * 0.98 + centroid.lng * 0.02,
        };
        if (pointInPolygon(at, z.ring)) {
          return { at, label: `${z.name} service area` };
        }
      }
      return null;
    };
    w.__zoneSetPin = (at, label, apply) => {
      setPin({ at, label });
      if (apply) setLocationFilter((f) => ({ ...f, active: true }));
    };
  }, [zones]);

  /**
   * Read-only view of the status / rough / residence decisions the overlay
   * effect makes, for tests.
   *
   * These three rules are the ones most likely to regress silently, and none of
   * them is observable from app chrome alone: a transparent polygon looks
   * identical to an unrendered one, and a residence dot in the wrong place needs
   * real geometry to judge. This snapshot is computed from the same
   * `statusById` / `rosterPointById` / `centroidOf` values the overlays use, and
   * re-uses the production `pointInPolygon` for the outside-polygon check, so a
   * test cannot pass for a reason the app would disagree with. It is a pure
   * read: it never writes and never mutates app state.
   *
   * Not DEV-gated: the suite runs a production build, where DEV is false.
   */
  useEffect(() => {
    const w = window as unknown as {
      __zoneState?: () => {
        zones: {
          instructorId: string;
          name: string;
          isRough: boolean;
          status: InstructorStatus;
          marker: {
            lat: number;
            lng: number;
            source: "residence" | "centroid";
          };
          fillOpacity: number;
          residenceOutsideZone: boolean;
        }[];
        /**
         * Zones that exist in the DB for an INACTIVE instructor, keyed by id.
         * Ids, not names: three live instructors share the name "Divyansh Pal",
         * so a name-keyed assertion can pass against the wrong person's row.
         */
        hiddenInactive: { instructorId: string; name: string }[];
        /** Instructors the sidebar lists, whatever their status. */
        roster: {
          instructorId: string;
          name: string;
          status: InstructorStatus;
          hasZone: boolean;
        }[];
        rosterSize: number;
        showRoughPolygons: boolean;
      };
    };
    w.__zoneState = () => {
      const visible = new Set(zones.map((z) => z.instructorId));
      // Zones read from the DB whose instructor is inactive: present, listed in
      // the sidebar, and deliberately NOT drawn. Computed by status rather than
      // as "everything not currently visible", because the rough toggle also
      // removes rows from `zones` and conflating the two would let a rough row
      // masquerade as an inactive one.
      const hidden = rosterZoneRows
        .filter((z) => !visible.has(z.instructorId))
        .filter((z) => statusById.get(z.instructorId) === "inactive")
        .map((z) => ({ instructorId: z.instructorId, name: z.name }));
      return {
        zones: zones.map((z) => {
          const status = statusById.get(z.instructorId) ?? "active";
          const onBreak = status === "on_break";
          const residence = rosterPointById.get(z.instructorId) ?? null;
          const at = residence ?? centroidOf(z.ring);
          return {
            instructorId: z.instructorId,
            name: z.name,
            isRough: z.isRough,
            status,
            marker: {
              lat: at.lat,
              lng: at.lng,
              source: residence
                ? ("residence" as const)
                : ("centroid" as const),
            },
            // Mirrors the overlay: outline-only for on-break and rough.
            fillOpacity: onBreak || z.isRough ? 0 : 0.18,
            residenceOutsideZone: residence
              ? !pointInPolygon(residence, z.ring)
              : false,
          };
        }),
        hiddenInactive: hidden,
        roster: instructors.map((i) => ({
          instructorId: i.id,
          name: i.name,
          status: i.status,
          hasZone: zoneByInstructor.has(i.id),
        })),
        rosterSize: instructors.length,
        showRoughPolygons,
      };
    };
  }, [
    zones,
    rosterZoneRows,
    zoneByInstructor,
    instructors,
    statusById,
    rosterPointById,
    showRoughPolygons,
  ]);

  useEffect(() => {
    const map = mapInstance;
    if (!map || !mapsLib?.Marker) return;
    pinMarkerRef.current?.setMap(null);
    pinMarkerRef.current = null;
    if (!pin) return;
    pinMarkerRef.current = new mapsLib.Marker({
      map,
      position: pin.at,
      title: pin.label,
      draggable: true,
    });
  }, [mapInstance, mapsLib, pin]);

  /**
   * Resolve free text to a single point.
   *
   * Shared by the header address search and the sidebar location filter so
   * both paths geocode identically and report the same two failures ("Not
   * found" vs "Geocoding failed") instead of drifting apart. Returns null when
   * there is nothing to search, Maps is not ready, or geocoding failed — the
   * caller has already been toasted and must not commit a filter.
   */
  const geocodeToPin = useCallback(
    async (
      text: string,
    ): Promise<{ at: ZoneCoordinate; label: string } | null> => {
      const trimmed = text.trim();
      if (!trimmed || !mapsLib) return null;
      try {
        const result = await new mapsLib.Geocoder().geocode({
          address: trimmed,
        });
        const hit = result.results[0];
        if (!hit) {
          toast({
            title: "Not found",
            description: `Could not find "${trimmed}".`,
            variant: "destructive",
          });
          return null;
        }
        return {
          at: {
            lat: hit.geometry.location.lat(),
            lng: hit.geometry.location.lng(),
          },
          label: hit.formatted_address ?? trimmed,
        };
      } catch {
        toast({
          title: "Geocoding failed",
          description: "Try a different address.",
          variant: "destructive",
        });
        return null;
      }
    },
    [mapsLib, toast],
  );

  const searchPlace = useCallback(async () => {
    const hit = await geocodeToPin(placeQuery);
    if (!hit) return;
    setPin(hit);
    fitTo([hit.at]);
  }, [geocodeToPin, placeQuery, fitTo]);

  /**
   * Commit a location to the list filter.
   *
   * `active` is set only on a successful geocode, so a typo leaves the previous
   * filter untouched instead of emptying the list against a location that was
   * never resolved.
   *
   * The camera frames the polygons that COVER the point, not the point itself.
   * Once the map is narrowed to the matches, zooming to a bare coordinate can
   * push the covering shapes off-screen, which would leave the narrowed map
   * looking empty. Falls back to the pin when nothing covers it, so an uncovered
   * address still shows where it is.
   */
  const applyLocationFilter = useCallback(async () => {
    const hit = await geocodeToPin(locationFilter.query);
    if (!hit) return;
    const covering = zones.filter(
      (z) => !isCompanyInstructor(z.name) && pointInPolygon(hit.at, z.ring),
    );
    setPin(hit);
    setLocationFilter((f) => ({ ...f, active: true }));
    fitTo(covering.length ? covering.flatMap((z) => z.ring) : [hit.at]);
  }, [geocodeToPin, locationFilter.query, fitTo, zones]);

  /**
   * Stop filtering by location, and take the pin with it.
   *
   * The pin has to go. It drives the "N instructors serve this location" panel
   * independently of `locationFilter.active` (see `pinMatches`), so clearing
   * only the flag emptied the sidebar list while leaving the address and its
   * match list on screen — which reads as a broken Clear button. Dropping the
   * pin makes one action clear everything location-related: the query text, the
   * committed point, the map pin, and the matches.
   */
  const clearLocationFilter = useCallback(() => {
    setLocationFilter((f) => ({ ...f, active: false, query: "" }));
    setPin(null);
  }, []);

  // -------------------------------------------------------------- editor ----

  /**
   * Leave edit mode without writing anything.
   *
   * A dirty edit is not silently dropped: the admin is told to save or discard,
   * exactly as the dialog used to. Discard is a separate, explicit action
   * (see `discardEdit`) so a stray click cannot destroy a reshape.
   */
  const closeEditor = useCallback(() => {
    if (dirty) {
      toast({
        title: "Unsaved changes",
        description: "Save or discard your edit before closing.",
        variant: "destructive",
      });
      return;
    }
    setEditingId(null);
    setEditingName("");
    setDraft(null);
    setSavedDraft(null);
  }, [dirty, toast]);

  /** Throw the in-progress reshape away and return to the persisted ring. */
  const discardEdit = useCallback(() => {
    if (!editingId) return;
    const persisted = zoneByInstructor.get(editingId);
    const initial = persisted ? closeRing(persisted.ring) : null;
    zoneHistory.reset(initial);
    setDraft(initial);
    setSavedDraft(initial);
  }, [editingId, zoneByInstructor, zoneHistory]);

  const commit = useCallback(() => {
    if (!editingId) return;
    const ring = openRing(zoneHistory.ring);
    if (ring.length < 3) {
      toast({
        title: "Not enough points",
        description: "A service area needs at least 3 distinct points.",
        variant: "destructive",
      });
      return;
    }
    if (ring.length > MAX_VERTICES) {
      toast({
        title: "Too many vertices",
        description: `${ring.length} points, but the limit is ${MAX_VERTICES}.`,
        variant: "destructive",
      });
      return;
    }
    // Resolve the zone row for this instructor. There is exactly one, so this
    // is the polygon the admin is editing; null means they have none yet.
    const existing = zoneByInstructor.get(editingId);

    saveZone.mutate(
      {
        zoneId: existing?.rowId ?? null,
        instructorId: editingId,
        name: editingName,
        ring,
        isRough: editingIsRough,
      },
      {
        onSuccess: () => {
          // Seed the history with what was just persisted, then leave edit
          // mode: the read-only overlay now owns the polygon, and leaving the
          // handles up would invite a second, untracked edit.
          zoneHistory.reset(ring);
          setSavedDraft(closeRing(ring));
          setSelectedId(editingId);
          setEditingId(null);
          setEditingName("");
          setEditingIsRough(false);
          setDraft(null);
          setSavedDraft(null);
          toast({
            title: editingIsRough
              ? "Rough polygon saved"
              : "Service area saved",
            description: editingIsRough
              ? "Hidden by default and never used for customer matching. Turn on “Show Rough Polygons” to see it."
              : undefined,
          });
        },
        onError: (err) => {
          toast({
            title: "Save failed",
            description:
              err instanceof Error ? err.message : "Could not save zone.",
            variant: "destructive",
          });
        },
      },
    );
  }, [
    zoneHistory,
    editingId,
    editingName,
    editingIsRough,
    zoneByInstructor,
    saveZone,
    toast,
  ]);

  const remove = useCallback(() => {
    if (!editingId) return;
    // Only a persisted polygon can be deleted. Deleting by zone row id (not by
    // instructor id) guarantees exactly one row is affected.
    const zoneId = zoneByInstructor.get(editingId)?.rowId;
    if (!zoneId) {
      setDraft(null);
      setSavedDraft(null);
      setSelectedId(null);
      setEditingId(null);
      setEditingIsRough(false);
      return;
    }
    deleteZone.mutate(zoneId, {
      onSuccess: () => {
        setDraft(null);
        setSavedDraft(null);
        setSelectedId(null);
        setEditingId(null);
        setEditingIsRough(false);
        toast({ title: "Service area removed" });
      },
      onError: (err) => {
        toast({
          title: "Delete failed",
          description:
            err instanceof Error ? err.message : "Could not delete zone.",
          variant: "destructive",
        });
      },
    });
  }, [editingId, zoneByInstructor, deleteZone, toast]);

  // --------------------------------------------------------------- render ----

  const q = query.trim().toLowerCase();
  /**
   * Text and location filters compose as AND, not OR: a row has to satisfy
   * both to appear. An unmapped instructor has no ring, so they can never be
   * in `locationMatchedIds` and correctly drop out while the filter is on.
   */
  const matchedZones = useMemo(
    () =>
      listedZones.filter(
        (z) =>
          (!q || z.name.toLowerCase().includes(q)) &&
          (!locationMatchedIds || locationMatchedIds.has(z.instructorId)),
      ),
    [listedZones, q, locationMatchedIds],
  );
  const matchedRoster = useMemo(
    () =>
      instructors.filter(
        (i) =>
          statusVisible(i.status) &&
          (!q || i.name.toLowerCase().includes(q)) &&
          (!locationMatchedIds || locationMatchedIds.has(i.id)),
      ),
    [instructors, q, locationMatchedIds, statusVisible],
  );

  /**
   * Roster members with no polygon who survive the current filters.
   *
   * The list below used to render `matchedRoster` but count `withoutZone`, so
   * typing in the filter box left the heading reading "Not mapped (87)" above a
   * single row. Counted from the same filtered array the rows come from, and
   * deliberately still status-agnostic: an instructor with no area is no area
   * whether they are on break, inactive or active.
   */
  const visibleWithoutZone = useMemo(
    () => matchedRoster.filter((i) => !zoneByInstructor.has(i.id)),
    [matchedRoster, zoneByInstructor],
  );

  const editingIsCompany = isCompanyInstructor(editingName);
  const editingZone = editingId ? zoneByInstructor.get(editingId) : undefined;

  /**
   * Detail card for the currently selected layer, whether it was picked from
   * the sidebar or by clicking the polygon/marker on the map.
   *
   * `description` comes from the KML placemark that seeded the backfill (timings,
   * vehicle, languages). `zones-db` does not select it today, so the card reads
   * it defensively rather than pretending it is always present.
   */
  const selectedCard = useMemo(() => {
    if (!selectedId) return null;
    const zone = zoneByInstructor.get(selectedId);
    const roster = instructors.find((i) => i.id === selectedId);
    return {
      instructorId: selectedId,
      name: zone?.name ?? roster?.name ?? "Unknown instructor",
      hasZone: Boolean(zone),
      vertexCount: zone?.ring.length ?? 0,
      isRough: zone?.isRough === true,
      /** Primary key of the stored row, needed to promote it. */
      zoneId: zone?.rowId ?? null,
      isCompany: isCompanyInstructor(zone?.name ?? roster?.name),
      status: statusById.get(selectedId),
      description: (zone as { description?: string } | undefined)?.description,
      rosterLabel:
        roster?.lat != null && roster?.lng != null
          ? `${roster.lat.toFixed(4)}, ${roster.lng.toFixed(4)}`
          : null,
    };
  }, [selectedId, zoneByInstructor, instructors, statusById]);

  const selectZone = (id: string, fit = true) => {
    setSelectedId(id);
    if (fit) fitZone(id);
  };

  // Kept in a ref so the overlay effect can select without rebuilding every
  // polygon on each render (see onSelectRef). Map clicks pass fit=false: the
  // admin is already looking at the shape they clicked, so re-framing the map
  // on them would be a jarring jump.
  onSelectRef.current = (id) => selectZone(id, false);

  // A map click selects a layer the sidebar may be scrolled far away from, so
  // bring that row into view. Scrolling runs for sidebar-originated selections
  // too, but they are already visible, making it a no-op.
  useEffect(() => {
    if (!selectedId) return;
    rowRefs.current.get(selectedId)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedId]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Header bar. Uses the app's own theme tokens rather than the Google
          red, so the module reads as part of this admin UI; the My Maps part is
          the layout (menu / title / search / overflow), not the colour. Search
          lives here rather than in the sidebar so it stays reachable while the
          layer list is collapsed. */}
      <header className="z-30 flex shrink-0 items-center gap-2 border-b bg-background px-3 py-2 shadow-sm">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => navigate("/admin/instructors")}
          title="Back to Instructor Management"
          aria-label="Back to Instructor Management"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          // Distinctly named from the sidebar's own "Collapse sidebar" /
          // "Instructors" toggles so neither name becomes ambiguous.
          onClick={() => setSidebarOpen((v) => !v)}
          title="Toggle layer list"
          aria-label="Toggle layer list"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="shrink-0 text-lg font-bold">Instructor Service Zones</h1>

        <div className="relative ml-1 flex min-w-0 max-w-xl flex-1 items-center">
          <Search className="pointer-events-none absolute left-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={placeQuery}
            onFocus={() => setSearchEngaged(true)}
            onChange={(e) => {
              setSearchEngaged(true);
              setPlaceQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              // Never let Enter bubble: this page is not inside a form, but
              // the same guard keeps the behaviour if that changes.
              if (e.key === "Enter") {
                e.preventDefault();
                void searchPlace();
              }
            }}
            placeholder="Search an address"
            aria-label="Search an address"
            className="pl-8 pr-16"
          />
          <Button
            size="sm"
            variant="secondary"
            className="absolute right-1"
            onClick={() => void searchPlace()}
            disabled={!placeQuery.trim() || !mapsLib}
            aria-label="Search this address"
          >
            Go
          </Button>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              title="More options"
              aria-label="More options"
            >
              <MoreVertical className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                void queryClient.invalidateQueries({ queryKey: zonesQueryKey })
              }
            >
              Refresh map data
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={fitAll}>
              Fit map to all zones
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={showAllLayers}>
              Show all layers
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={hideAllLayers}>
              Hide all layers
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={exportGeoJson}>
              Export visible areas as GeoJSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ---------------------------------------------------------- sidebar */}
        {/*
        Collapsed renders nothing at all rather than `w-0 overflow-hidden`.
        Clipping alone leaves the children laid out and still exposed to
        assistive tech (and to `toBeVisible()`), so a collapsed sidebar would
        keep a full tab order and duplicate landmark controls.
      */}
        {sidebarOpen ? (
          <aside
            aria-label="Instructor zone list"
            className={cn(
              // w-96 rather than w-80: a layer row carries a colour swatch, a
              // visibility checkbox, the name, a vertex count, a backup badge
              // and two action buttons. At 20rem the name truncated on most
              // real instructor names, which read as "missing content".
              "z-20 flex w-96 shrink-0 flex-col overflow-hidden border-r bg-background",
              "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-lg",
            )}
          >
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b p-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">
                    Instructor Zone Map
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {/* Counted from `zoneByInstructor`, not `zones`. `zones` is
                      the drawn set, so this number used to drop every time Ops
                      toggled rough polygons on, and again for each instructor
                      marked inactive — the same answer, two different numbers,
                      for a field that means "how many instructors have an area".
                      `zoneByInstructor` is status- and mode-agnostic, which is
                      what "mapped" should mean here. */}
                    {zoneByInstructor.size} of {instructors.length} instructors
                    mapped
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(false)}
                  title="Collapse sidebar"
                  aria-label="Collapse sidebar"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </div>

              <ScrollArea className="min-h-0 flex-1">
                <div className="min-h-0 space-y-4 p-3">
                  <div className="space-y-2 border-b p-3">
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Filter instructors"
                      aria-label="Filter instructors"
                    />
                    {/* Location filter, directly below the text filter so the two
                narrowing controls read as one unit. The button only opens the
                panel; the list is narrowed once a location is actually
                geocoded and applied (see applyLocationFilter). */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      data-testid="location-filter-toggle"
                      aria-expanded={locationFilter.active}
                      onClick={() => {
                        if (locationFilter.active) {
                          clearLocationFilter();
                        } else {
                          setLocationFilter((f) => ({ ...f, active: true }));
                        }
                      }}
                    >
                      <MapPin className="mr-1.5 h-3.5 w-3.5" />
                      {locationFilter.active
                        ? "Hide location filter"
                        : "Filter by location"}
                    </Button>
                    {locationFilter.active ? (
                      <div
                        data-testid="location-filter"
                        className="space-y-1.5 rounded-md border p-2"
                      >
                        <Input
                          ref={locationInputRef}
                          value={locationFilter.query}
                          onFocus={() => setLocationFilterEngaged(true)}
                          onChange={(e) => {
                            setLocationFilterEngaged(true);
                            setLocationFilter((f) => ({
                              ...f,
                              query: e.target.value,
                            }));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void applyLocationFilter();
                            }
                          }}
                          placeholder="Search a location"
                          aria-label="Search a location"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="flex-1"
                            onClick={() => void applyLocationFilter()}
                            disabled={!locationFilter.query.trim() || !mapsLib}
                          >
                            Search
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={clearLocationFilter}
                            aria-label="Clear location filter"
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    {/* Address search moved to the header bar. The pin-match panel
                stays here so it sits directly above the layer list it
                highlights. */}
                    {pin ? (
                      <div
                        className="space-y-1.5 rounded-md border p-2"
                        data-testid="pin-matches"
                      >
                        <p className="text-xs font-medium">{pin.label}</p>
                        {pinMatches && pinMatches.length > 0 ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {pinMatches.length} instructor
                              {pinMatches.length === 1 ? "" : "s"} serve this
                              location
                            </p>
                            <ul className="space-y-0.5">
                              {pinMatches.map((z) => (
                                <li key={z.instructorId}>
                                  <button
                                    type="button"
                                    onClick={() => selectZone(z.instructorId)}
                                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-accent"
                                  >
                                    <span
                                      aria-hidden
                                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                                      style={{
                                        background: colorFor(z.instructorId),
                                      }}
                                    />
                                    <span className="truncate">{z.name}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No polygon covers this point. Drag the pin to
                            re-check.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2 border-b p-3">
                    <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <Layers className="h-3.5 w-3.5" />
                      Layers
                    </p>
                    {/* `aria-label` rather than a <Label htmlFor>: the Switch renders a
              <button>, and a `<label for>` pointing at a button is not a
              reliable accessible-name association, so the control would be
              announced as an unlabelled switch. */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-normal">Service areas</span>
                      <Switch
                        aria-label="Service areas"
                        checked={showPolygons}
                        onCheckedChange={setShowPolygons}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-normal">
                        Instructor markers
                      </span>
                      <Switch
                        aria-label="Instructor markers"
                        checked={showMarkers}
                        onCheckedChange={setShowMarkers}
                      />
                    </div>
                    {/* Rough polygons are provisional onboarding boundaries, not
                serviceability zones, so they are opt-in. They are stored in the
                same table as real areas and are only ever excluded from sales
                matching, never deleted. */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-normal">
                        Rough polygons
                      </span>
                      <Switch
                        aria-label="Show Rough Polygons"
                        checked={showRoughPolygons}
                        onCheckedChange={setShowRoughPolygons}
                      />
                    </div>
                    {showRoughPolygons ? (
                      <p className="text-[11px] text-muted-foreground">
                        Showing {roughCount} rough polygon
                        {roughCount === 1 ? "" : "s"}. These are not
                        serviceability areas and are never used for customer
                        matching.
                      </p>
                    ) : null}
                    {/* Status filters. Three independent toggles rather than a
                single "hide inactive" switch, because Ops review questions are
                per-status: "who is on break", "who has left". Each shows its
                own live count, which also makes the control self-describing
                instead of a blank switch that changes an unrelated list.

                These only gate what is LISTED and DRAWN. They never write to
                Instructor, and switching "Inactive" on can never put an
                inactive polygon on the map — that exclusion is unconditional in
                `allRosterZones`. */}
                    <div className="mt-1 space-y-1 border-t pt-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Show instructors
                      </p>
                      {INSTRUCTOR_STATUSES.map(({ value: status }) => {
                        const count = instructors.filter(
                          (i) => i.status === status,
                        ).length;
                        const label = instructorStatusMeta(status).label;
                        return (
                          <div
                            key={status}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="flex min-w-0 items-center gap-1.5 text-xs font-normal">
                              <span
                                data-status-count={status}
                                className="shrink-0 tabular-nums text-muted-foreground"
                              >
                                {count}
                              </span>
                              <span className="truncate">{label}</span>
                            </span>
                            <Switch
                              aria-label={`Show ${label} instructors`}
                              checked={statusFilter[status]}
                              onCheckedChange={(on) =>
                                setStatusFilter((f) => ({ ...f, [status]: on }))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                    {showMarkers ? (
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="marker-position"
                          className="text-xs font-normal text-muted-foreground"
                        >
                          Marker position
                        </label>
                        <select
                          id="marker-position"
                          value={useInstructorCoords ? "roster" : "centroid"}
                          onChange={(e) =>
                            setUseInstructorCoords(e.target.value === "roster")
                          }
                          className="h-6 rounded border bg-background px-1 text-xs"
                        >
                          {/* The dot marks the instructor's residence, which is a
                        real address and is frequently outside the service
                        polygon drawn beside it — so "Registered address" is the
                        default, not a special mode. "Polygon centre" stays
                        available for instructors with no residence on file, and
                        is never used for matching. */}
                          <option value="roster">Registered address</option>
                          <option value="centroid">Polygon centre</option>
                        </select>
                      </div>
                    ) : null}
                    {showMarkers &&
                    useInstructorCoords &&
                    missingPointCount > 0 ? (
                      <p className="text-[11px] text-muted-foreground">
                        {missingPointCount} instructor
                        {missingPointCount === 1 ? " has" : "s have"} no
                        registered coordinates; their dot stays on the polygon
                        centre.
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={fitAll}
                      >
                        <Maximize className="mr-1.5 h-3.5 w-3.5" />
                        Fit all zones
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={hiddenIds.size ? showAllLayers : hideAllLayers}
                      >
                        {hiddenIds.size ? "Show all" : "Hide all"}
                      </Button>
                    </div>
                  </div>

                  <div className="min-h-0 space-y-4 p-3">
                    <section className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Mapped ({matchedZones.length})
                      </p>
                      {matchedZones.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No service area matches this filter.
                        </p>
                      ) : (
                        matchedZones.map((z) => {
                          const hidden = hiddenIds.has(z.instructorId);
                          const rowStatus = statusById.get(z.instructorId);
                          return (
                            <div
                              key={z.instructorId}
                              className={cn(
                                "flex w-full items-center gap-1 rounded-md border pr-1",
                                selectedId === z.instructorId
                                  ? "border-primary bg-accent"
                                  : "hover:bg-accent",
                                hidden && "opacity-50",
                              )}
                            >
                              {/* Layer color, matching the polygon fill on the map.
                            A <span> so it stays out of the row's button
                            sequence. Goes hollow (and the row dims) when the
                            layer is hidden. */}
                              <span
                                aria-hidden
                                title={hidden ? "Layer hidden" : "Layer color"}
                                className={cn(
                                  "ml-1.5 h-2.5 w-2.5 shrink-0 rounded-sm",
                                  hidden && "border border-muted-foreground",
                                )}
                                style={
                                  hidden
                                    ? undefined
                                    : { background: colorFor(z.instructorId) }
                                }
                              />
                              {/* Rough badge and status tag both sit directly AFTER the name,
                            inside the name button, so they read as
                            qualifications of that instructor rather than as
                            separate controls stacked to the left of them. Only
                            non-active statuses are badged: an "Active" chip on
                            ~120 rows would be pure noise and would drown out
                            the two tags that actually change how the area
                            behaves. Putting them after the name also keeps them
                            inside the row's button sequence, which is what the
                            sidebar's keyboard order already assumes. */}
                              {/* Per-layer visibility, My Maps style. A real
                            checkbox rather than a <button>: it is a genuine
                            on/off control, and keeping it out of the row's
                            `button` sequence preserves the "name then edit"
                            ordering the sidebar's keyboard order relies on. */}
                              <input
                                type="checkbox"
                                checked={!hidden}
                                aria-label={`Toggle ${z.name} layer`}
                                title={
                                  hidden ? `Show ${z.name}` : `Hide ${z.name}`
                                }
                                onChange={() => toggleLayer(z.instructorId)}
                                className="h-3.5 w-3.5 shrink-0 accent-primary"
                              />
                              <button
                                type="button"
                                ref={(el) => registerRow(z.instructorId, el)}
                                onClick={() => selectZone(z.instructorId)}
                                title={`Zoom to ${z.name}`}
                                className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1.5 pl-1 text-left text-xs"
                              >
                                {/* Wraps to two lines rather than truncating: a
                                clipped name reads as missing data, and the
                                row is the only place the full name appears. */}
                                <span className="min-w-0 break-words">
                                  {z.name}
                                </span>
                                {/* Both badges trail the name inside the button. */}
                                {z.isRough ? (
                                  <span
                                    title="Rough polygon — not a serviceability area, never used for customer matching"
                                    className="shrink-0 rounded border border-dashed border-amber-500 px-1 text-[10px] font-medium text-amber-600"
                                  >
                                    Rough
                                  </span>
                                ) : null}
                                <ZoneStatusTag status={rowStatus} />
                                <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
                                  <span>{z.ring.length}</span>
                                  {isCompanyInstructor(z.name) ? (
                                    <Badge
                                      variant="outline"
                                      className="h-4 px-1 text-[10px]"
                                    >
                                      backup
                                    </Badge>
                                  ) : null}
                                </span>
                              </button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                title={`Edit ${z.name} service area`}
                                aria-label={`Edit ${z.name} service area`}
                                data-testid={`zone-edit-${z.instructorId}`}
                                onClick={() =>
                                  startDrawing(z.instructorId, z.name)
                                }
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })
                      )}
                    </section>

                    <Separator />

                    <section className="space-y-1.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Not mapped ({visibleWithoutZone.length})
                      </p>
                      {matchedRoster.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Nothing matches this filter.
                        </p>
                      ) : (
                        matchedRoster.map((i) => {
                          if (zoneByInstructor.has(i.id)) return null;
                          return (
                            <div key={i.id} className="flex items-center gap-1">
                              <button
                                type="button"
                                title={`Draw ${i.name} service area`}
                                aria-label={`Draw ${i.name} service area`}
                                onClick={() => startDrawing(i.id, i.name)}
                                className="flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent"
                              >
                                {/* Same trailing-badge layout as the Mapped row, so
                                an instructor reads identically in both columns
                                whichever one they land in. */}
                                <span className="min-w-0 break-words">
                                  {i.name}
                                </span>
                                <ZoneStatusTag status={i.status} />
                                <span className="ml-auto flex shrink-0 items-center gap-1">
                                  <Pentagon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                </span>
                              </button>
                            </div>
                          );
                        })
                      )}
                    </section>
                  </div>
                </div>
              </ScrollArea>
            </div>
          </aside>
        ) : null}

        {/* ------------------------------------------------------------ map ------- */}
        <div ref={mapWrapRef} className="relative flex-1">
          {zonesError ? (
            <div className="absolute inset-x-3 top-3 z-10 flex items-start gap-2 rounded-md border border-destructive bg-background p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>
                Could not load service areas.{" "}
                {zonesError instanceof Error ? zonesError.message : ""}
              </span>
            </div>
          ) : null}

          {mapError ? (
            <div className="absolute inset-x-3 top-3 z-10 flex items-start gap-2 rounded-md border border-destructive bg-background p-3 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>{mapError}</span>
            </div>
          ) : null}

          {!mapsLib || zonesLoading ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading map…
              </span>
            </div>
          ) : null}

          <div ref={mapDivRef} className="absolute inset-0" />

          {editingId ? (
            <div
              className="absolute left-1/2 top-3 z-20 w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md border bg-background p-2 shadow-md"
              data-testid="zone-edit-bar"
            >
              <p className="text-xs font-medium" data-testid="zone-edit-title">
                Editing service area — {editingName}
              </p>
              {editingIsRough ? (
                <p
                  className="text-[11px] font-medium text-amber-600"
                  data-testid="zone-edit-rough-note"
                >
                  Rough polygon
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {needsMorePoints > 0 ? (
                  <>
                    Click the map to add points. {needsMorePoints} more needed
                    to save.
                  </>
                ) : (
                  <>
                    Drag a point to move it. Drag a bulge on an edge to add a
                    point, or drag one onto its neighbour to remove it.
                  </>
                )}
              </p>
              {/* The company-backup warning used to live in the dialog header.
                  It stays: a polygon drawn for an Ops backup must never be
                  mistaken for learner coverage. */}
              {editingIsCompany ? (
                <p
                  className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-700"
                  data-testid="zone-edit-company-warning"
                >
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    {editingName} is a company backup instructor. Backups are
                    never auto-matched to learners; a polygon here must not be
                    used as coverage.
                  </span>
                </p>
              ) : null}
              {/* The rough/verified decision is stated explicitly here rather
                  than inferred, because it is the only thing preventing a
                  hand-click approximation from going live as coverage. It sits
                  above the action buttons so the flag is read before saving,
                  not after. */}
              <div
                className="mt-2 flex items-start justify-between gap-2 rounded border border-dashed border-amber-500/60 bg-amber-500/5 px-2 py-1.5"
                data-testid="zone-rough-toggle"
              >
                <div className="min-w-0">
                  <label
                    htmlFor="zone-rough-switch"
                    className="text-xs font-medium"
                  >
                    Rough polygon
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    {editingIsRough
                      ? "Saved as provisional. Hidden by default and never used for customer or sales matching."
                      : "Saved as a verified service area and used for customer matching."}
                  </p>
                </div>
                <Switch
                  id="zone-rough-switch"
                  aria-label="Rough polygon"
                  checked={editingIsRough}
                  onCheckedChange={setEditingIsRough}
                  disabled={saveZone.isPending}
                  className="mt-0.5 shrink-0"
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={zoneHistory.undo}
                  disabled={!zoneHistory.canUndo || saveZone.isPending}
                  data-testid="zone-undo"
                >
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                  Undo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={zoneHistory.redo}
                  disabled={!zoneHistory.canRedo || saveZone.isPending}
                  data-testid="zone-redo"
                >
                  <Redo2 className="mr-1.5 h-3.5 w-3.5" />
                  Redo
                </Button>
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="zone-edit-vertex-count"
                >
                  {zoneHistory.ring.length} points
                  {atVertexLimit ? " — vertex limit reached" : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={closeEditor}
                  disabled={saveZone.isPending}
                  data-testid="zone-edit-cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={discardEdit}
                  disabled={saveZone.isPending || !dirty}
                  data-testid="zone-edit-discard"
                >
                  Discard changes
                </Button>
                {/* Delete moved here from the old dialog footer. It deletes the
                    persisted row, so it is only offered for a saved area — a
                    first draw that was never saved is cleared with Discard. */}
                {editingZone ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={remove}
                    disabled={
                      deleteZone.isPending || saveZone.isPending || dirty
                    }
                    data-testid="zone-edit-delete"
                  >
                    {deleteZone.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Delete
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={commit}
                  disabled={zoneHistory.ring.length < 3 || saveZone.isPending}
                  data-testid="zone-edit-save"
                >
                  {saveZone.isPending ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Save area
                </Button>
              </div>
            </div>
          ) : null}

          {selectedCard ? (
            <div
              className="absolute bottom-6 left-3 z-10 w-72 rounded-md border bg-background p-3 shadow-md"
              data-testid="info-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{
                        background: colorFor(selectedCard.instructorId),
                      }}
                    />
                    <span className="truncate">{selectedCard.name}</span>
                  </p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span>
                      {selectedCard.hasZone
                        ? `${selectedCard.vertexCount} vertices`
                        : "No service area yet"}
                    </span>
                    {selectedCard.isCompany ? <span>· Ops backup</span> : null}
                    {/* Status is on the card, not just the sidebar row: the card
                        is what an admin reads after selecting a layer, and an
                        inactive instructor's area is deliberately not on the map
                        to explain itself. */}
                    {selectedCard.status && selectedCard.status !== "active" ? (
                      <span
                        className={cn(
                          "rounded px-1 text-[10px] font-medium",
                          instructorStatusMeta(selectedCard.status).badgeClass,
                        )}
                      >
                        {instructorStatusMeta(selectedCard.status).label}
                      </span>
                    ) : null}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  aria-label="Close details"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <dl className="mt-2 space-y-0.5 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Registered address</dt>
                  <dd className="text-right">
                    {selectedCard.rosterLabel ?? "Not on file"}
                  </dd>
                </div>
                {selectedCard.description ? (
                  <div className="flex justify-between gap-2">
                    <dt className="shrink-0 text-muted-foreground">Notes</dt>
                    <dd
                      className="truncate text-right"
                      title={selectedCard.description}
                    >
                      {selectedCard.description}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="mt-2 flex gap-2">
                {/* One action, not two. There is no "Redraw" for an existing
                    area: an Ops-drawn boundary is reshaped in place, and offering
                    a from-scratch redraw invites replacing good geometry with a
                    hand-click approximation. */}
                <Button
                  size="sm"
                  className="flex-1"
                  data-testid="info-card-edit"
                  onClick={() =>
                    startDrawing(selectedCard.instructorId, selectedCard.name)
                  }
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  {selectedCard.hasZone ? "Edit points" : "Draw area"}
                </Button>
              </div>
              {/* Promote, only for a rough boundary. The one irreversible-feeling
                  action on the card, so it is not tucked into the edit flow: Ops
                  review a rough polygon, decide it is right, and promote it here
                  without re-entering the vertex editor. It writes `is_rough =
                  false` and changes nothing else — the stored ring becomes the
                  live service area.

                  Deliberately not offered for a verified polygon (nothing to
                  promote) nor for an instructor with no area at all, which has
                  no row to update. */}
              {selectedCard.isRough && selectedCard.zoneId ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full border-dashed"
                  data-testid="info-card-promote"
                  disabled={promoteZone.isPending}
                  onClick={() =>
                    promoteZone.mutate({
                      zoneId: selectedCard.zoneId!,
                      instructorId: selectedCard.instructorId,
                    })
                  }
                >
                  {promoteZone.isPending ? (
                    "Promoting…"
                  ) : (
                    <>
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                      Make normal polygon
                    </>
                  )}
                </Button>
              ) : null}
              {selectedCard.hasZone &&
              !selectedCard.isRough &&
              selectedCard.zoneId ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full border-dashed"
                  data-testid="info-card-demote"
                  disabled={demoteZone.isPending}
                  onClick={() =>
                    demoteZone.mutate({
                      zoneId: selectedCard.zoneId!,
                      instructorId: selectedCard.instructorId,
                    })
                  }
                >
                  {demoteZone.isPending ? (
                    "Demoting…"
                  ) : (
                    <>
                      <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                      Make rough polygon
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}

          {/* Top-left stack. The map-type control lives here (My Maps position),
            sharing one column with the sidebar-expand button so the two can
            never overlap when the sidebar is collapsed. */}
          <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
            {!sidebarOpen ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSidebarOpen(true)}
              >
                <Layers className="mr-1.5 h-3.5 w-3.5" />
                Instructors
              </Button>
            ) : null}

            {/* Map-type control. Google's own type control is disabled (see the
                map options) so this can sit in the My Maps position. It used to
                live bottom-left, where the info card also sits. */}
            <div className="overflow-hidden rounded-md border bg-background shadow-sm">
              <div className="flex">
                {(["roadmap", "satellite"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-label={`${t} map`}
                    aria-pressed={mapTypeId === t}
                    title={t === "roadmap" ? "Roadmap" : "Satellite"}
                    onClick={() => setMapTypeId(t)}
                    className={cn(
                      "px-2.5 py-1 text-xs capitalize transition-colors",
                      mapTypeId === t
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right-hand control stack, My Maps order: fit all, refresh, fullscreen. */}
          <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
            <Button
              variant="outline"
              size="icon"
              onClick={fitAll}
              // Distinctly named from the sidebar's "Fit all zones" so the two
              // are never an ambiguous accessible-name pair — driving either by
              // role+name would otherwise throw a strict-mode violation.
              title="Fit map to all zones"
              aria-label="Fit map to all zones"
            >
              <Maximize className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: zonesQueryKey })
              }
              // Must NOT contain the substring "service areas": the sidebar's
              // "Service areas" switch is located with getByLabel(), which does
              // case-insensitive SUBSTRING matching by default, so a longer name
              // here makes that locator ambiguous.
              title="Refresh map data"
              aria-label="Refresh map data"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void toggleFullscreen()}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? (
                <Minimize className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={exportGeoJson}
              title="Export visible areas as GeoJSON"
              aria-label="Export visible areas as GeoJSON"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
