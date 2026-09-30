import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  Download,
  Layers,
  Loader2,
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
}

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

export default function InstructorZoneMap() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------- data ----

  const {
    data: zones = [],
    isLoading: zonesLoading,
    error: zonesError,
  } = useQuery({
    queryKey: ["instructor-zones"],
    queryFn: async (): Promise<ZoneView[]> => {
      const dbZones = await fetchDbZones();
      return dbZones
        .map((z) => ({
          rowId: z.id,
          instructorId: z.instructorId,
          name: z.name,
          ring: openRing(z.coords),
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
      // nullable, so an instructor without them still loads; toZoneCoordinate
      // just drops those from the marker layer.
      const { data, error } = await supabase
        .from("Instructor")
        .select("id_instructor, name, latitude, longitude");
      if (error) throw error;
      return (data ?? [])
        .map((r) => r as unknown as RosterRow)
        .filter((r) => typeof r.id_instructor === "string")
        .map((r) => ({
          id: r.id_instructor,
          name: (r.name ?? "").trim() || "Unnamed",
          company: isCompanyInstructor(r.name),
          lat: toZoneCoordinate(r.latitude, r.longitude)?.lat ?? null,
          lng: toZoneCoordinate(r.latitude, r.longitude)?.lng ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const zoneByInstructor = useMemo(() => {
    const m = new Map<string, ZoneView>();
    for (const z of zones) m.set(z.instructorId, z);
    return m;
  }, [zones]);

  const withoutZone = useMemo(
    () => instructors.filter((i) => !zoneByInstructor.has(i.id)),
    [instructors, zoneByInstructor],
  );

  /**
   * Instructor id -> registered coordinate, for instructors that have one.
   * Used to place the marker dot at the real roster address instead of the
   * polygon centroid. Missing entries simply fall back to the centroid.
   */
  const rosterPointById = useMemo(() => {
    const m = new Map<string, ZoneCoordinate>();
    for (const i of instructors) {
      if (i.lat == null || i.lng == null) continue;
      m.set(i.id, { lat: i.lat, lng: i.lng });
    }
    return m;
  }, [instructors]);

  /** Instructors with no usable lat/lng — drives the marker-mode hint. */
  const missingPointCount = useMemo(
    () => instructors.filter((i) => i.lat == null || i.lng == null).length,
    [instructors],
  );

  const zonesQueryKey = ["instructor-zones"] as const;

  const saveZone = useMutation({
    mutationFn: async (payload: {
      zoneId: string | null;
      instructorId: string;
      name: string;
      ring: ZoneCoordinate[];
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
      if (payload.zoneId) {
        return updateZoneById({
          zoneId: payload.zoneId,
          coordinates: closeRing(payload.ring),
          rawName: payload.name,
        });
      }
      return insertZone({
        instructorId: payload.instructorId,
        coordinates: closeRing(payload.ring),
        rawName: payload.name,
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
        };
        const list = prev ?? [];
        const at = list.findIndex((z) => z.instructorId === view.instructorId);
        if (at === -1) return [...list, view];
        const next = [...list];
        next[at] = view;
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: zonesQueryKey });
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
   * pin or the polygon's centroid dot.
   *
   * Both are drawn as a `Circle`, so switching re-runs the overlay effect and
   * swaps the position. The centroid is the default because it is always
   * available — 3 of 131 instructors have no usable lat/lng — while the real
   * pin is what a sales rep expects when cross-referencing a roster address.
   */
  const [useInstructorCoords, setUseInstructorCoords] = useState(false);

  /** Set when the active basemap changes, so fitAll re-frames it. */
  const [mapTypeId, setMapTypeId] = useState<string>("roadmap");

  /** Whether the map is in fullscreen presentation mode. */
  const [isFullscreen, setIsFullscreen] = useState(false);

  /** True once the `places` sub-library is ready for the search autocomplete. */
  const [placesReady, setPlacesReady] = useState(false);
  /** Set on first focus/typing of the search box, which then loads `places`. */
  const [searchEngaged, setSearchEngaged] = useState(false);

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

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const overlaysRef = useRef<
    Map<
      string,
      { polygon: google.maps.Polygon | null; marker: google.maps.Circle | null }
    >
  >(new Map());
  const pinMarkerRef = useRef<google.maps.Marker | null>(null);

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
    if (!searchEngaged) return;
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
  }, [searchEngaged]);

  useEffect(() => {
    if (!placesReady || !searchInputRef.current) return;
    if (!window.google?.maps?.places) return;

    const style = document.createElement("style");
    style.dataset.mapPac = "1";
    style.textContent =
      ".pac-container{z-index:10000 !important;pointer-events:auto !important}" +
      ".pac-item{cursor:pointer !important}";
    document.head.appendChild(style);

    const ac = new window.google.maps.places.Autocomplete(
      searchInputRef.current,
      {
        // The service areas are all in Bengaluru; restricting the country keeps
        // "Koramangala" from resolving to a same-named street elsewhere.
        componentRestrictions: { country: "IN" },
        fields: ["formatted_address", "geometry"],
      },
    );
    autocompleteRef.current = ac;

    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc = place?.geometry?.location;
      if (!loc) return;
      setPlaceQuery(place?.formatted_address ?? "");
      setPin({
        at: { lat: loc.lat(), lng: loc.lng() },
        label: place?.formatted_address ?? "Pinned location",
      });
    });

    return () => {
      document.head.removeChild(style);
      if (listener) google.maps.event.removeListener(listener);
      autocompleteRef.current = null;
    };
  }, [placesReady]);

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
    for (const { polygon, marker } of overlaysRef.current.values()) {
      polygon?.setMap(null);
      marker?.setMap(null);
    }
    overlaysRef.current.clear();
  }, []);

  useEffect(() => {
    const map = mapInstance;
    const ML = mapsLib;
    if (!map || !ML?.Polygon || !ML?.Circle) return;

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

        const selected = z.instructorId === selectedId;
        const color = colorFor(z.instructorId);
        let polygon: google.maps.Polygon | null = null;
        if (showPolygons) {
          polygon = new ML.Polygon({
            paths: z.ring,
            map,
            strokeColor: selected ? SELECTED_STROKE : color,
            strokeWeight: selected ? 3 : 2,
            fillColor: selected ? SELECTED_FILL : color,
            fillOpacity: selected ? 0.3 : 0.18,
            // Clickable so clicking a polygon in the map selects its sidebar
            // row, matching My Maps' two-way layer/map selection. `setMap(null)`
            // on the next render pass drops the listener with the overlay.
            clickable: true,
            zIndex: selected ? 3 : 1,
          });
          polygon.addListener("click", () =>
            onSelectRef.current(z.instructorId),
          );
        }
        let marker: google.maps.Circle | null = null;
        if (showMarkers) {
          // Prefer the instructor's own registered coordinates; fall back to the
          // polygon centroid when they're missing or out of range. Rendering the
          // centroid is not the same as *matching* by proximity — matching is
          // polygon-only (see pinMatches), this is purely where the dot goes.
          const rosterPoint = useInstructorCoords
            ? (rosterPointById.get(z.instructorId) ?? null)
            : null;
          marker = new ML.Circle({
            map,
            center: rosterPoint ?? centroidOf(z.ring),
            radius: MARKER_RADIUS_METERS,
            fillColor: selected ? SELECTED_FILL : color,
            fillOpacity: 0.95,
            strokeColor: "#ffffff",
            strokeWeight: 2,
            clickable: true,
            zIndex: selected ? 4 : 2,
          });
          marker.addListener("click", () =>
            onSelectRef.current(z.instructorId),
          );
        }
        if (polygon || marker) {
          overlaysRef.current.set(z.instructorId, { polygon, marker });
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

  const searchPlace = useCallback(async () => {
    const text = placeQuery.trim();
    if (!text || !mapsLib) return;
    try {
      const result = await new mapsLib.Geocoder().geocode({ address: text });
      const hit = result.results[0];
      if (!hit) {
        toast({
          title: "Not found",
          description: `Could not find "${text}".`,
          variant: "destructive",
        });
        return;
      }
      const at = {
        lat: hit.geometry.location.lat(),
        lng: hit.geometry.location.lng(),
      };
      setPin({ at, label: hit.formatted_address ?? text });
      fitTo([at]);
    } catch {
      toast({
        title: "Geocoding failed",
        description: "Try a different address.",
        variant: "destructive",
      });
    }
  }, [mapsLib, placeQuery, fitTo, toast]);

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
          setDraft(null);
          setSavedDraft(null);
          toast({ title: "Service area saved" });
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
  }, [zoneHistory, editingId, editingName, zoneByInstructor, saveZone, toast]);

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
      return;
    }
    deleteZone.mutate(zoneId, {
      onSuccess: () => {
        setDraft(null);
        setSavedDraft(null);
        setSelectedId(null);
        setEditingId(null);
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
  const matchedZones = useMemo(
    () => zones.filter((z) => !q || z.name.toLowerCase().includes(q)),
    [zones, q],
  );
  const matchedRoster = useMemo(
    () => instructors.filter((i) => !q || i.name.toLowerCase().includes(q)),
    [instructors, q],
  );

  const editingIsCompany = isCompanyInstructor(editingName);
  const editingZone = editingId ? zoneByInstructor.get(editingId) : undefined;

  /**
   * Which instructors serve the dropped pin.
   *
   * This is the sales question the page exists to answer ("who covers this
   * address?"), so it mirrors the dashboard's matching rule exactly: ray-cast
   * `pointInPolygon` against each instructor's own ring. Company backups are
   * excluded — Ops assigns those by hand and they must never be auto-matched.
   */
  const pinMatches = useMemo(() => {
    if (!pin) return null;
    return zones.filter(
      (z) => !isCompanyInstructor(z.name) && pointInPolygon(pin.at, z.ring),
    );
  }, [pin, zones]);

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
      isCompany: isCompanyInstructor(zone?.name ?? roster?.name),
      description: (zone as { description?: string } | undefined)?.description,
      rosterLabel:
        roster?.lat != null && roster?.lng != null
          ? `${roster.lat.toFixed(4)}, ${roster.lng.toFixed(4)}`
          : null,
    };
  }, [selectedId, zoneByInstructor, instructors]);

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
            <div className="flex items-center justify-between gap-2 border-b p-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">
                  Instructor Zone Map
                </h2>
                <p className="text-xs text-muted-foreground">
                  {zones.length} of {instructors.length} instructors mapped
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

            <div className="space-y-2 border-b p-3">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter instructors"
                aria-label="Filter instructors"
              />
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
                        {pinMatches.length === 1 ? "" : "s"} serve this location
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
                                style={{ background: colorFor(z.instructorId) }}
                              />
                              <span className="truncate">{z.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No polygon covers this point. Drag the pin to re-check.
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
                <span className="text-xs font-normal">Instructor markers</span>
                <Switch
                  aria-label="Instructor markers"
                  checked={showMarkers}
                  onCheckedChange={setShowMarkers}
                />
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
                    <option value="centroid">Polygon centre</option>
                    <option value="roster">Registered address</option>
                  </select>
                </div>
              ) : null}
              {showMarkers && useInstructorCoords && missingPointCount > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {missingPointCount} instructor
                  {missingPointCount === 1 ? " has" : "s have"} no registered
                  coordinates; their dot stays on the polygon centre.
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

            <ScrollArea className="flex-1">
              <div className="space-y-4 p-3">
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
                          {/* Per-layer visibility, My Maps style. A real
                            checkbox rather than a <button>: it is a genuine
                            on/off control, and keeping it out of the row's
                            `button` sequence preserves the "name then edit"
                            ordering the sidebar's keyboard order relies on. */}
                          <input
                            type="checkbox"
                            checked={!hidden}
                            aria-label={`Toggle ${z.name} layer`}
                            title={hidden ? `Show ${z.name}` : `Hide ${z.name}`}
                            onChange={() => toggleLayer(z.instructorId)}
                            className="h-3.5 w-3.5 shrink-0 accent-primary"
                          />
                          <button
                            type="button"
                            ref={(el) => registerRow(z.instructorId, el)}
                            onClick={() => selectZone(z.instructorId)}
                            title={`Zoom to ${z.name}`}
                            className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pl-1 text-left text-xs"
                          >
                            {/* Wraps to two lines rather than truncating: a
                                clipped name reads as missing data, and the
                                row is the only place the full name appears. */}
                            <span className="min-w-0 break-words">
                              {z.name}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
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
                            onClick={() => startDrawing(z.instructorId, z.name)}
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
                    Not mapped ({withoutZone.length})
                  </p>
                  {matchedRoster.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Nothing matches this filter.
                    </p>
                  ) : (
                    matchedRoster.map((i) => {
                      const mapped = zoneByInstructor.has(i.id);
                      if (mapped) return null;
                      return (
                        <div key={i.id} className="flex items-center gap-1">
                          <button
                            type="button"
                            title={`Draw ${i.name} service area`}
                            aria-label={`Draw ${i.name} service area`}
                            onClick={() => startDrawing(i.id, i.name)}
                            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent"
                          >
                            <span className="truncate">{i.name}</span>
                            <Pentagon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </section>
              </div>
            </ScrollArea>
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
                  <p className="text-xs text-muted-foreground">
                    {selectedCard.hasZone
                      ? `${selectedCard.vertexCount} vertices`
                      : "No service area yet"}
                    {selectedCard.isCompany ? " · Ops backup" : ""}
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
