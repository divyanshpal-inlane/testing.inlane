import {
  AlertTriangle,
  Check,
  Loader2,
  MapPin,
  Pentagon,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { googleMapsLoader } from "@/utils/googleMaps";

import type { ZoneCoordinate } from "./types";
import {
  closeRing,
  formatCoord,
  isClosedRing,
  isSamePoint,
  MAX_VERTICES,
  useZoneHistory,
} from "./useZoneHistory";

const FALLBACK_CENTER = { lat: 12.9716, lng: 77.5946 };
const ZONE_STROKE = "#2563eb";
const ZONE_FILL = "#2563eb";
const VERTEX_DOT_METERS = 90;
const SNAP_GRID_DEGREES = 0.0001;
// Vertex drags emit a path event per animation frame. Coalesce them so one
// drag becomes one undo step instead of ~60.
const DRAG_COALESCE_KEY = "vertex-drag";

function readPath(
  path: google.maps.MVCArray<google.maps.LatLng>,
): ZoneCoordinate[] {
  return path.getArray().map((p) => ({ lat: p.lat(), lng: p.lng() }));
}

function sameAsPath(
  coordinates: ZoneCoordinate[],
  path: google.maps.MVCArray<google.maps.LatLng>,
): boolean {
  if (coordinates.length !== path.getLength()) return false;
  for (let i = 0; i < coordinates.length; i++) {
    const p = path.getAt(i);
    if (!isSamePoint(coordinates[i], { lat: p.lat(), lng: p.lng() })) {
      return false;
    }
  }
  return true;
}

function snapCoordinate(coord: ZoneCoordinate): ZoneCoordinate {
  return {
    lat: Math.round(coord.lat / SNAP_GRID_DEGREES) * SNAP_GRID_DEGREES,
    lng: Math.round(coord.lng / SNAP_GRID_DEGREES) * SNAP_GRID_DEGREES,
  };
}

function parseCoordinateText(text: string): {
  points: ZoneCoordinate[];
  badLines: number[];
} {
  const points: ZoneCoordinate[] = [];
  const badLines: number[] = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/[,\s]+/).filter(Boolean);
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (parts.length !== 2 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      badLines.push(i + 1);
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      badLines.push(i + 1);
      return;
    }
    points.push({ lat, lng });
  });

  return { points, badLines };
}

/** Rounds to the same 0.0001 degree grid the Snap toggle uses. */
function roundCoord(value: number): number {
  return Math.round(value / SNAP_GRID_DEGREES) * SNAP_GRID_DEGREES;
}

interface VertexRowProps {
  index: number;
  point: ZoneCoordinate;
  canRemove: boolean;
  canInsert: boolean;
  /** Bumped by the parent to force a revert after a rejected edit. */
  resetKey: number;
  onCommit: (index: number, next: ZoneCoordinate) => void;
  onInsertAfter: (index: number) => void;
  onRemove: (index: number) => void;
}

/**
 * One editable vertex: exact lat/lng boxes, an "insert after" action that
 * drops a new point on the edge midpoint (My Maps behaviour), and delete.
 * Typing is local state so a partially typed value never round-trips through
 * the polygon; the value is committed on blur or Enter.
 */
function VertexRow({
  index,
  point,
  canRemove,
  canInsert,
  resetKey,
  onCommit,
  onInsertAfter,
  onRemove,
}: VertexRowProps) {
  const [lat, setLat] = useState(point.lat.toFixed(6));
  const [lng, setLng] = useState(point.lng.toFixed(6));

  useEffect(() => {
    setLat(point.lat.toFixed(6));
    setLng(point.lng.toFixed(6));
  }, [point.lat, point.lng, resetKey]);

  const commit = () => {
    const nextLat = Number.parseFloat(lat);
    const nextLng = Number.parseFloat(lng);
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
      // Revert to the authoritative value rather than pushing NaN.
      setLat(point.lat.toFixed(6));
      setLng(point.lng.toFixed(6));
      return;
    }
    if (nextLat === point.lat && nextLng === point.lng) return;
    onCommit(index, { lat: nextLat, lng: nextLng });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      // Same reason as the address search box: this editor renders inside the
      // instructor <form>, so a bare Enter would save and close the dialog.
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  return (
    <li
      className="flex items-center gap-1.5 font-mono"
      data-testid={`zone-vertex-row-${index}`}
    >
      <span className="w-6 shrink-0 text-right text-muted-foreground">
        {index + 1}.
      </span>
      <Input
        value={lat}
        onChange={(e) => setLat(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        spellCheck={false}
        aria-label={`Vertex ${index + 1} latitude`}
        data-testid={`zone-vertex-lat-${index}`}
        className="h-6 min-w-0 flex-1 px-1 text-[11px]"
      />
      <Input
        value={lng}
        onChange={(e) => setLng(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        spellCheck={false}
        aria-label={`Vertex ${index + 1} longitude`}
        data-testid={`zone-vertex-lng-${index}`}
        className="h-6 min-w-0 flex-1 px-1 text-[11px]"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1"
        aria-label={`Insert a point after vertex ${index + 1}`}
        title="Insert a point on the next edge"
        disabled={!canInsert}
        onClick={() => onInsertAfter(index)}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-6 shrink-0 px-1.5"
        aria-label={`Remove vertex ${index + 1}`}
        onClick={() => onRemove(index)}
        disabled={!canRemove}
      >
        <X className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </li>
  );
}

interface ZoneDrawingEditorProps {
  coordinates: ZoneCoordinate[] | null;
  onChange: (coordinates: ZoneCoordinate[] | null) => void;
  center?: { lat: number; lng: number } | null;
  disabled?: boolean;
  height?: string;
  emptyHint?: string;
  /**
   * Changes to this value re-seed the undo history from `coordinates`. Pass the
   * identity of the subject being edited (e.g. the instructor id) so switching
   * between zones does not leave the previous zone's history reachable.
   */
  historyKey?: string | null;
}

export default function ZoneDrawingEditor({
  coordinates,
  onChange,
  center,
  disabled = false,
  height = "360px",
  emptyHint = "No service area drawn yet.",
  historyKey = null,
}: ZoneDrawingEditorProps) {
  const { toast } = useToast();

  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [mapsLib, setMapsLib] = useState<typeof google.maps | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualText, setManualText] = useState("");
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchAddress, setSearchAddress] = useState("");
  const [vertexResetKey, setVertexResetKey] = useState(0);
  /** True once the `places` sub-library is ready for the address autocomplete. */
  const [placesReady, setPlacesReady] = useState(false);

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Refs mirror the latest props/handlers so the imperative map effects never
  // need to re-register their Google Maps listeners.
  const centerRef = useRef(center);
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    let active = true;
    googleMapsLoader
      .loadMaps(["Polygon", "Circle"])
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

  const ready = !!mapsLib?.Polygon && !!mapInstance;

  // --- undo / redo ------------------------------------------------------------
  //
  // The hook owns the ring, so every action below is a single `apply` call and
  // therefore always lands in the history. In-progress draw clicks go through
  // it too (`pending` used to be separate state, which meant a half-drawn
  // boundary had no undo at all), and `clear` pushes an empty ring so removing
  // an area is reversible rather than a one-way door.
  const history = useZoneHistory(coordinates, onChange, [historyKey]);

  const toastNotEnoughPoints = useCallback(() => {
    toastRef.current({
      title: "Not enough points",
      description: "A service area needs at least 3 distinct points.",
      variant: "destructive",
    });
  }, []);

  const toastTooManyVertices = useCallback((count: number) => {
    toastRef.current({
      title: "Too many vertices",
      description: `${count} points entered, but the limit is ${MAX_VERTICES}.`,
      variant: "destructive",
    });
  }, []);

  const apply = useCallback(
    (next: ZoneCoordinate[], options?: { coalesce?: string }) => {
      if (next.length < 3) {
        toastNotEnoughPoints();
        return false;
      }
      if (next.length > MAX_VERTICES) {
        toastTooManyVertices(next.length);
        return false;
      }
      return history.apply(next, options);
    },
    [history, toastNotEnoughPoints, toastTooManyVertices],
  );

  // --- map bootstrap ---------------------------------------------------------

  useEffect(() => {
    const el = mapDivRef.current;
    if (!el || !mapsLib || mapInstance) return;
    const initial = centerRef.current;
    setMapInstance(
      new mapsLib.Map(el, {
        center: initial ?? FALLBACK_CENTER,
        zoom: initial ? 12 : 10,
        gestureHandling: "greedy",
        disableDefaultUI: true,
        zoomControl: true,
      }),
    );
  }, [mapsLib, mapInstance]);

  useEffect(() => {
    if (!mapInstance || !center) return;
    // `historyKey` is in the dependency list on purpose: switching subjects
    // re-seeds the ring, and the map must follow it to the new centre. Without
    // it the map kept showing the previous zone's neighbourhood.
    mapInstance.panTo(center);
  }, [mapInstance, center, historyKey]);

  // --- saved (editable) polygon ---------------------------------------------

  const polygonRef = useRef<{
    polygon: google.maps.Polygon;
    listeners: google.maps.MapsEventListener[];
  } | null>(null);

  const destroyPolygon = useCallback(() => {
    const entry = polygonRef.current;
    if (!entry) return;
    entry.listeners.forEach((l) => l.remove());
    entry.polygon.setMap(null);
    polygonRef.current = null;
  }, []);

  useEffect(() => destroyPolygon, [destroyPolygon]);

  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  }, [apply]);

  useEffect(() => {
    const map = mapInstance;
    const PolygonCtor = mapsLib?.Polygon;
    if (!map || !PolygonCtor) return;

    const ring = history.ring.length >= 3 ? history.ring : null;

    // Fewer than 3 points cannot enclose an area, so there is nothing to draw.
    if (!ring) {
      destroyPolygon();
      return;
    }

    if (polygonRef.current) {
      const path = polygonRef.current.polygon.getPath();
      if (!sameAsPath(ring, path)) polygonRef.current.polygon.setPath(ring);
      polygonRef.current.polygon.setOptions({
        visible: true,
        editable: true,
        // Dragging the whole shape would fight with dragging a single vertex,
        // and during a fresh draw it would move points away from where they
        // were clicked. Editing is per-vertex only.
        draggable: false,
      });
      return;
    }

    // `editable: true` is what makes Google draw the red vertex handles and the
    // midpoint "bulge" handles, so the same polygon serves both the fresh draw
    // and an in-place reshape.
    const polygon = new PolygonCtor({
      paths: ring,
      map,
      editable: true,
      draggable: false,
      visible: true,
      strokeColor: ZONE_STROKE,
      strokeWeight: 2,
      fillColor: ZONE_FILL,
      fillOpacity: 0.2,
      geodesic: true,
    });

    const path = polygon.getPath();
    const onVertexEdit = () => {
      const next = readPath(path);
      // Google allows trimming below 3 points and inserting past the cap; the
      // DB CHECK rejects both, so let `apply` refuse rather than persisting a
      // degenerate polygon. The ring is left on screen exactly as the admin
      // dragged it so the drag does not appear to snap back.
      if (next.length < 3 || next.length > MAX_VERTICES) return;
      // One coalesce key for the whole drag, so the per-frame events collapse
      // into a single undo step instead of ~60.
      applyRef.current(next, { coalesce: DRAG_COALESCE_KEY });
    };

    polygonRef.current = {
      polygon,
      listeners: [
        path.addListener("set_at", onVertexEdit),
        path.addListener("insert_at", onVertexEdit),
        path.addListener("remove_at", onVertexEdit),
      ],
    };
  }, [mapInstance, mapsLib, history.ring, isDrawing, destroyPolygon]);

  // --- draft dots ------------------------------------------------------------

  const draftRef = useRef<google.maps.Circle[]>([]);

  const destroyDraft = useCallback(() => {
    draftRef.current.forEach((d) => d.setMap(null));
    draftRef.current = [];
  }, []);

  useEffect(() => destroyDraft, [destroyDraft]);

  // Google's polygon cannot render below 3 points, so while a fresh boundary is
  // still under construction the clicked points are shown as dots instead. From
  // the third point on, the editable polygon takes over and its own red handles
  // mark the vertices, so drawing dots as well would just double them up.
  useEffect(() => {
    const map = mapInstance;
    const ML = mapsLib;
    if (!map || !ML?.Circle || !isDrawing || history.ring.length >= 3) {
      destroyDraft();
      return;
    }

    const points = history.ring;
    while (draftRef.current.length > points.length) {
      draftRef.current.pop()?.setMap(null);
    }
    points.forEach((point, i) => {
      const existing = draftRef.current[i];
      if (existing) {
        existing.setCenter(point);
        return;
      }
      draftRef.current[i] = new ML.Circle({
        map,
        center: point,
        radius: VERTEX_DOT_METERS,
        fillColor: ZONE_FILL,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        clickable: false,
        zIndex: 2,
      });
    });
  }, [mapInstance, mapsLib, isDrawing, history.ring, destroyDraft]);

  // --- actions ---------------------------------------------------------------

  const startDrawing = useCallback(() => {
    // An empty ring is a real, undoable state: if the admin abandons the new
    // boundary, Undo/Redo still reflect exactly what happened.
    history.reset([]);
    setIsDrawing(true);
    setShowManual(false);
    setShowSearch(false);
  }, [history]);

  const cancelDrawing = useCallback(() => {
    setIsDrawing(false);
    setShowManual(false);
  }, []);

  const undoLast = useCallback(() => {
    // Undo the last dropped point. `history.undo` is the same code path as the
    // toolbar Undo, so drawing and editing share one history.
    history.undo();
  }, [history]);

  const handleMapClick = useCallback(
    (latLng: google.maps.LatLng | null) => {
      if (!latLng) return;
      const raw = { lat: latLng.lat(), lng: latLng.lng() };
      const next = snapEnabled ? snapCoordinate(raw) : raw;
      const last = history.ring[history.ring.length - 1];
      if (last && isSamePoint(last, next)) return;
      if (history.ring.length >= MAX_VERTICES) {
        toastRef.current({
          title: "Vertex limit reached",
          description: `A service area can have at most ${MAX_VERTICES} vertices.`,
          variant: "destructive",
        });
        return;
      }
      // Points go in via `apply` so each one is its own undo step, but they
      // must bypass the 3-point minimum until Finish.
      history.apply(history.ring.concat([next]));
    },
    [history, snapEnabled],
  );

  useEffect(() => {
    if (!mapInstance || !isDrawing) return;
    const listener = mapInstance.addListener(
      "click",
      (e: google.maps.MapMouseEvent) => handleMapClick(e.latLng),
    );
    return () => listener.remove();
  }, [mapInstance, isDrawing, handleMapClick]);

  const finishDrawing = useCallback(() => {
    if (history.ring.length < 3) {
      toastNotEnoughPoints();
      return;
    }
    if (history.ring.length > MAX_VERTICES) {
      toastTooManyVertices(history.ring.length);
      return;
    }
    setIsDrawing(false);
  }, [history.ring, toastNotEnoughPoints, toastTooManyVertices]);

  const applyManual = useCallback(() => {
    const { points, badLines } = parseCoordinateText(manualText);
    if (badLines.length > 0) {
      toastRef.current({
        title: "Invalid coordinates",
        description: `Could not parse line(s): ${badLines
          .slice(0, 8)
          .join(
            ", ",
          )}${badLines.length > 8 ? "\u2026" : ""}. Use "lat, lng" with lat in [-90, 90] and lng in [-180, 180].`,
        variant: "destructive",
      });
      return;
    }
    if (!apply(points)) return;
    setManualText("");
    setShowManual(false);
  }, [manualText, apply]);

  const loadCurrentIntoManual = useCallback(() => {
    const ring = history.ring;
    if (ring.length === 0) return;
    const text = ring.map(formatCoord).join("\n");
    setManualText(text);
    setShowManual(true);
  }, [history.ring]);

  const removeVertex = useCallback(
    (index: number) => {
      if (history.ring.length <= 3) {
        toastRef.current({
          title: "Cannot remove vertex",
          description:
            "A polygon needs at least 3 points. Remove the whole area instead.",
          variant: "destructive",
        });
        return;
      }
      apply(history.ring.filter((_, i) => i !== index));
    },
    [history.ring, apply],
  );

  const clearZone = useCallback(() => {
    destroyPolygon();
    destroyDraft();
    setIsDrawing(false);
    // An empty ring, not a null hole in the history: Undo brings the whole
    // boundary back and Redo removes it again.
    history.apply([]);
  }, [destroyPolygon, destroyDraft, history]);

  /**
   * Nudges a single vertex to an exact coordinate, pushing one undo step.
   * Range is validated here because the inputs bypass `parseCoordinateText`.
   */
  const updateVertex = useCallback(
    (index: number, next: ZoneCoordinate) => {
      const current = history.ring[index];
      if (!current || isSamePoint(current, next)) return;
      if (
        next.lat < -90 ||
        next.lat > 90 ||
        next.lng < -180 ||
        next.lng > 180
      ) {
        setVertexResetKey((k) => k + 1);
        toastRef.current({
          title: "Invalid coordinates",
          description: `Vertex ${index + 1} must be within lat [-90, 90] and lng [-180, 180].`,
          variant: "destructive",
        });
        return;
      }
      const target = history.ring.slice();
      target[index] = next;
      apply(target);
    },
    [history.ring, apply],
  );

  /**
   * Inserts a new vertex on the edge that follows `index`, pre-placed at that
   * edge's midpoint. Wraps for the last vertex so the closing edge (last ->
   * first) is reachable too. This is the explicit equivalent of dragging one of
   * Google's own midpoint handles, which is otherwise undiscoverable.
   */
  const insertVertexAfter = useCallback(
    (index: number) => {
      const base = history.ring;
      if (base.length === 0) return;
      if (base.length >= MAX_VERTICES) {
        toastRef.current({
          title: "Vertex limit reached",
          description: `A service area can have at most ${MAX_VERTICES} vertices.`,
          variant: "destructive",
        });
        return;
      }
      const nextIndex = (index + 1) % base.length;
      const a = base[index];
      const b = base[nextIndex];
      const midpoint = roundCoord((a.lat + b.lat) / 2);
      const midLng = roundCoord((a.lng + b.lng) / 2);
      const target = base.slice();
      target.splice(nextIndex, 0, { lat: midpoint, lng: midLng });
      if (apply(target)) {
        toastRef.current({
          title: `Point inserted after ${index + 1}`,
          description: `New vertex ${nextIndex + 1} added at the edge midpoint.`,
        });
      }
    },
    [history.ring, apply],
  );

  const handleSearch = useCallback(async () => {
    if (!searchAddress.trim() || !mapsLib) return;
    try {
      const result = await new mapsLib.Geocoder().geocode({
        address: searchAddress,
      });
      if (result.results.length > 0) {
        mapInstance?.setCenter(result.results[0].geometry.location);
        mapInstance?.setZoom(14);
      } else {
        toastRef.current({
          title: "Not found",
          description: "Could not find that address.",
          variant: "destructive",
        });
      }
    } catch {
      toastRef.current({
        title: "Error",
        description: "Geocoding failed. Try again.",
        variant: "destructive",
      });
    }
  }, [searchAddress, mapsLib, mapInstance]);

  // --- address autocomplete --------------------------------------------------

  // Load `places` once. Without it the search box can only geocode on Enter,
  // so the admin had to guess at spellings instead of picking a suggestion.
  useEffect(() => {
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
  }, []);

  // Attach the widget only while the search box is open, so it cannot keep
  // intercepting keystrokes once the admin closes it.
  useEffect(() => {
    if (!showSearch || !placesReady) return;
    const input = searchInputRef.current;
    if (!input || !window.google?.maps?.places) return;

    // The dropdown is appended to <body>, so it needs an explicit z-index to
    // clear the Radix dialog / instructor form this editor sits inside.
    const style = document.createElement("style");
    style.dataset.zonePac = "1";
    style.textContent =
      ".pac-container{z-index:10000 !important;pointer-events:auto !important}" +
      ".pac-item{cursor:pointer !important}";
    document.head.appendChild(style);

    const ac = new window.google.maps.places.Autocomplete(input, {
      // Service areas are all in Bengaluru; restricting the country stops
      // "Koramangala" resolving to a same-named street in another country.
      componentRestrictions: { country: "IN" },
      fields: ["formatted_address", "geometry"],
    });
    autocompleteRef.current = ac;

    const listener = ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc = place?.geometry?.location;
      if (!loc) return;
      setSearchAddress(place?.formatted_address ?? "");
      mapInstance?.setCenter(loc);
      mapInstance?.setZoom(14);
    });

    return () => {
      document.head.removeChild(style);
      if (listener) google.maps.event.removeListener(listener);
      autocompleteRef.current = null;
    };
  }, [showSearch, placesReady, mapInstance]);

  // --- derived ---------------------------------------------------------------

  const liveVertices = history.ring;
  const atLimit = liveVertices.length >= MAX_VERTICES;
  const { canUndo, canRedo } = history;
  // A stored area is reshaped in place: the native Google handles, the vertex
  // list, and the coordinate box are the editing surface. "Redraw" used to sit
  // next to them and throw the boundary away in favour of a fresh click-out,
  // which is the one thing an admin never wants after a small correction.
  const hasZone = liveVertices.length >= 3;

  return (
    <div className="space-y-3" data-testid="zone-editor">
      <div className="flex flex-wrap items-center gap-2">
        {isDrawing ? (
          <>
            <Button
              type="button"
              size="sm"
              onClick={finishDrawing}
              disabled={liveVertices.length < 3}
              data-testid="zone-draw-finish"
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Finish ({liveVertices.length})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={undoLast}
              disabled={liveVertices.length === 0}
              data-testid="zone-draw-undo-point"
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Undo point
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancelDrawing}
              data-testid="zone-draw-cancel"
            >
              Cancel
            </Button>
          </>
        ) : (
          // No Redraw: an existing boundary is edited where it lies. Drawing is
          // only offered when there is nothing to edit.
          !hasZone && (
            <Button
              type="button"
              size="sm"
              onClick={startDrawing}
              disabled={disabled || !ready}
              data-testid="zone-draw-toggle"
            >
              {!ready ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              Draw service area
            </Button>
          )
        )}

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowManual((s) => !s)}
          disabled={isDrawing}
          data-testid="zone-coords-toggle"
        >
          Enter coordinates
        </Button>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setShowSearch((s) => !s)}
          disabled={isDrawing || !ready}
          data-testid="zone-search-toggle"
        >
          <Search className="mr-1.5 h-3.5 w-3.5" />
          Search address
        </Button>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setSnapEnabled((s) => !s)}
          disabled={isDrawing}
          title="Round new points to a 0.0001° grid"
          data-testid="zone-snap"
        >
          {snapEnabled ? (
            <>
              <RotateCw className="mr-1.5 h-3.5 w-3.5 text-green-600" />
              Snap ON
            </>
          ) : (
            <>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Snap
            </>
          )}
        </Button>

        {liveVertices.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearZone}
            disabled={disabled}
            data-testid="zone-clear"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5 text-destructive" />
            Remove
          </Button>
        )}
      </div>

      {(canUndo || canRedo) && (
        <div
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
          data-testid="zone-history"
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={history.undo}
            disabled={!canUndo}
            data-testid="zone-undo"
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Undo
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={history.redo}
            disabled={!canRedo}
            data-testid="zone-redo"
          >
            <RotateCw className="mr-1 h-3.5 w-3.5" />
            Redo
          </Button>
        </div>
      )}

      {!ready && !mapError && (
        <p className="text-xs text-muted-foreground">Loading map…</p>
      )}

      {!ready && mapError && (
        <p className="text-xs text-destructive">{mapError}</p>
      )}

      {isDrawing && (
        <p className="text-xs text-muted-foreground">
          Click the map to drop a point. Each point shows as a dot and the area
          fills in live from the third point. Minimum 3, maximum {MAX_VERTICES}.
        </p>
      )}

      {showSearch && (
        <div className="flex gap-2">
          <Input
            ref={searchInputRef}
            placeholder="Search address (e.g., 'Koramangala, Bangalore')"
            value={searchAddress}
            onChange={(e) => setSearchAddress(e.target.value)}
            data-testid="zone-search-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // Without preventDefault, Enter also submits the surrounding
                // instructor form -- an unintended save (and dialog close) when
                // the admin just wanted to pan the map.
                e.preventDefault();
                void handleSearch();
              }
            }}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={() => void handleSearch()}
            disabled={!mapsLib}
            data-testid="zone-search-go"
          >
            <MapPin className="mr-1.5 h-3.5 w-3.5" />
            Go
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSearch(false)}
            data-testid="zone-search-cancel"
          >
            Cancel
          </Button>
        </div>
      )}

      <div
        className="overflow-hidden rounded-md border"
        style={{ height }}
        ref={mapDivRef}
        data-testid="zone-map"
      />

      {showManual && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Coordinates (one per line)</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={loadCurrentIntoManual}
              disabled={liveVertices.length === 0}
              data-testid="zone-coords-load"
            >
              Load current
            </Button>
          </div>
          <Textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            rows={7}
            spellCheck={false}
            data-testid="zone-coords-input"
            placeholder={
              "12.971600, 77.594600\n12.980000, 77.610000\n12.960000, 77.620000"
            }
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={applyManual}
              data-testid="zone-coords-apply"
            >
              Apply coordinates
            </Button>
            <span className="text-xs text-muted-foreground">
              Lat [-90, 90], lng [-180, 180]. Ring auto-closed.
            </span>
          </div>
        </div>
      )}

      {liveVertices.length > 0 ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Pentagon className="h-3.5 w-3.5 text-blue-600" />
            <span data-testid="zone-vertex-count">
              {liveVertices.length} / {MAX_VERTICES} vertices
            </span>
            {isClosedRing(closeRing(liveVertices)) && !isDrawing ? (
              <span className="text-green-600">ring closed</span>
            ) : null}
            {atLimit ? (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                vertex limit reached
              </span>
            ) : null}
            {snapEnabled ? (
              <span className="text-green-600">snap on</span>
            ) : null}
          </div>

          {isDrawing ? (
            <p className="max-h-20 overflow-y-auto font-mono text-[11px] text-muted-foreground">
              {liveVertices
                .map((p, i) => `${i + 1}. ${formatCoord(p)}`)
                .join("   ")}
            </p>
          ) : (
            <details
              className="text-xs text-muted-foreground"
              data-testid="zone-vertex-list"
            >
              <summary>
                Edit vertices ({liveVertices.length}) &mdash; type exact
                lat/lng, drag a handle on the map, or use + / &times; per point
              </summary>
              <ul
                className="mt-1 max-h-56 space-y-1 overflow-y-auto"
                data-testid="zone-vertex-items"
              >
                {liveVertices.map((p, i) => (
                  <VertexRow
                    key={`${i}-${p.lat}-${p.lng}`}
                    index={i}
                    point={p}
                    canRemove={!disabled && liveVertices.length > 3}
                    canInsert={!disabled && !atLimit}
                    resetKey={vertexResetKey}
                    onCommit={updateVertex}
                    onInsertAfter={insertVertexAfter}
                    onRemove={removeVertex}
                  />
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      )}
    </div>
  );
}
