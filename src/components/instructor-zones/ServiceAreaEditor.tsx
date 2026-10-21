import {
  Check,
  MapPin,
  Pencil,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import {
  deleteServiceAreaZone,
  DUPLICATE_SERVICE_AREA_MESSAGE,
  insertServiceAreaZone,
  isDuplicateServiceAreaError,
  MAX_SERVICE_AREA_VERTICES,
  type ServiceAreaKind,
  type ServiceAreaLayer,
  type ServiceAreaPiece,
  updateServiceAreaZone,
} from "@/lib/sales-dashboard/zones-db";

import {
  pointInRing,
  ringSelfIntersects,
  ringsOverlap,
  vertexCentroid,
} from "./serviceAreaGeometry";
import type { ZoneCoordinate } from "./types";
import { arraysEqual, useZoneHistory } from "./useZoneHistory";

const KIND_LABEL: Record<ServiceAreaKind, string> = {
  serviceable: "Serviceable area",
  excluded: "Excluded pocket",
};
const KIND_COLOR: Record<ServiceAreaKind, string> = {
  serviceable: "#16a34a",
  excluded: "#dc2626",
};
/** A drag emits one path event per frame; events this close share an undo slot. */
const DRAG_BURST_MS = 250;
const DRAG_COALESCE_KEY = "vertex-drag";
const VERTEX_DOT_METERS = 120;

interface Target {
  /** null = a brand-new area that has not been saved yet. */
  id: string | null;
  kind: ServiceAreaKind;
  /** Bumps for each "new" so the history re-seeds for every fresh draw. */
  nonce: number;
}

interface ServiceAreaEditorProps {
  map: google.maps.Map | null;
  mapsLib: typeof google.maps | null;
  layer: ServiceAreaLayer | undefined;
  open: boolean;
  onClose: () => void;
  /** Called after any successful write so the caller can refresh the layer. */
  onChanged: () => void;
}

/**
 * Edit the company service area (white = serviceable, grey = everything else).
 *
 * Deliberately separate from the instructor-polygon editor: that one is keyed
 * on an instructor id, while this works on `service_area_zones` rows. It reuses
 * the shared undo/redo hook and the same Google Maps editing model (an
 * `editable` polygon whose path is listened to on `getPath()`), but none of the
 * instructor editor's state, so the two cannot interfere.
 *
 * Two kinds of piece: a `serviceable` area (white) and an `excluded` pocket
 * (grey again, inside a white area). Expanding the white area = editing an
 * existing piece's boundary, or adding a new serviceable piece.
 */
export function ServiceAreaEditor({
  map,
  mapsLib,
  layer,
  open,
  onClose,
  onChanged,
}: ServiceAreaEditorProps) {
  const { toast } = useToast();

  const [target, setTarget] = useState<Target | null>(null);
  const [name, setName] = useState("");
  const [seed, setSeed] = useState<ZoneCoordinate[] | null>(null);
  const [seedName, setSeedName] = useState("");
  /** A new area is drawn by clicking points until "Finish drawing". */
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const nonceRef = useRef(0);

  const history = useZoneHistory(
    target ? seed : null,
    () => {},
    [target ? `${target.id ?? "new"}-${target.nonce}` : ""],
    MAX_SERVICE_AREA_VERTICES,
  );
  const ring = history.ring;
  const ringRef = useRef(ring);
  ringRef.current = ring;
  const applyRef = useRef(history.apply);
  applyRef.current = history.apply;

  const dirty =
    target !== null &&
    (!arraysEqual(ring, seed ?? []) || name.trim() !== seedName.trim());

  const pieces = useMemo(
    () => ({
      serviceable: layer?.serviceable ?? [],
      excluded: layer?.excluded ?? [],
    }),
    [layer],
  );

  // ---- starting / leaving an edit ------------------------------------------

  const uniqueName = useCallback(
    (kind: ServiceAreaKind) => {
      const taken = new Set(pieces[kind].map((p) => p.name.toLowerCase()));
      const base =
        kind === "serviceable" ? "Serviceable area" : "Excluded pocket";
      for (let n = pieces[kind].length + 1; n < 1000; n++) {
        if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
      }
      return `${base} ${Date.now()}`;
    },
    [pieces],
  );

  const stopEditing = useCallback(() => {
    setTarget(null);
    setSeed(null);
    setName("");
    setSeedName("");
    setDrawing(false);
    setError(null);
    setPendingDeleteId(null);
  }, []);

  const startNew = (kind: ServiceAreaKind) => {
    nonceRef.current += 1;
    const n = uniqueName(kind);
    setTarget({ id: null, kind, nonce: nonceRef.current });
    setSeed(null);
    setName(n);
    setSeedName(n);
    setDrawing(true);
    setError(null);
    setPendingDeleteId(null);
  };

  const startEdit = (kind: ServiceAreaKind, piece: ServiceAreaPiece) => {
    nonceRef.current += 1;
    setTarget({ id: piece.id, kind, nonce: nonceRef.current });
    setSeed(piece.ring);
    setName(piece.name);
    setSeedName(piece.name);
    setDrawing(false);
    setError(null);
    setPendingDeleteId(null);
    zoomTo(piece.ring);
  };

  const zoomTo = useCallback(
    (points: ZoneCoordinate[]) => {
      if (!map || !mapsLib || points.length === 0) return;
      const b = new mapsLib.LatLngBounds();
      for (const p of points) b.extend(p);
      map.fitBounds(b, 70);
    },
    [map, mapsLib],
  );

  // Closing the panel leaves any edit.
  useEffect(() => {
    if (!open) stopEditing();
  }, [open, stopEditing]);

  // ---- map: click-to-add while drawing -------------------------------------

  useEffect(() => {
    if (!map || !target || !drawing) return;
    // Quick successive clicks are read by Google Maps as a double-click: the
    // second point is dropped and the map zooms in. Turn that off while drawing.
    const prevDblZoom = map.get("disableDoubleClickZoom") as
      | boolean
      | undefined;
    map.setOptions({
      draggableCursor: "crosshair",
      disableDoubleClickZoom: true,
    });
    const listener = map.addListener(
      "click",
      (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        applyRef.current([
          ...ringRef.current,
          { lat: e.latLng.lat(), lng: e.latLng.lng() },
        ]);
      },
    );
    return () => {
      listener.remove();
      map.setOptions({
        draggableCursor: undefined,
        disableDoubleClickZoom: prevDblZoom ?? false,
      });
    };
  }, [map, target, drawing]);

  // ---- map: preview while drawing (polyline + a dot per point) -------------

  useEffect(() => {
    if (!map || !mapsLib?.Polyline || !mapsLib.Circle || !target || !drawing)
      return;
    const color = KIND_COLOR[target.kind];
    const line = new mapsLib.Polyline({
      map,
      path: ring.length >= 3 ? [...ring, ring[0]] : ring,
      strokeColor: color,
      strokeWeight: 2,
      clickable: false,
      zIndex: 40,
    });
    const dots = ring.map(
      (p) =>
        new mapsLib.Circle({
          map,
          center: p,
          radius: VERTEX_DOT_METERS,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: "#ffffff",
          strokeWeight: 1,
          clickable: false,
          zIndex: 41,
        }),
    );
    return () => {
      line.setMap(null);
      for (const d of dots) d.setMap(null);
    };
  }, [map, mapsLib, target, drawing, ring]);

  // ---- map: the editable polygon (existing area, or a finished drawing) ----

  const polygonRef = useRef<google.maps.Polygon | null>(null);
  const pathRef = useRef<google.maps.MVCArray<google.maps.LatLng> | null>(null);

  const destroyPolygon = useCallback(() => {
    if (pathRef.current) {
      google.maps.event.clearInstanceListeners(pathRef.current);
      pathRef.current = null;
    }
    if (polygonRef.current) {
      google.maps.event.clearInstanceListeners(polygonRef.current);
      polygonRef.current.setMap(null);
      polygonRef.current = null;
    }
  }, []);
  useEffect(() => destroyPolygon, [destroyPolygon]);

  useEffect(() => {
    if (!map || !mapsLib?.Polygon) return;
    if (!target || drawing || ring.length < 3) {
      destroyPolygon();
      return;
    }

    // `set_at` / `insert_at` / `remove_at` are raised by the path's MVCArray,
    // NOT by the Polygon (see InstructorZoneMap for the bug this avoids).
    let lastAt = 0;
    const onPathChange = () => {
      const polygon = polygonRef.current;
      if (!polygon) return;
      const next = polygon
        .getPath()
        .getArray()
        .map((p) => ({ lat: p.lat(), lng: p.lng() }));
      if (arraysEqual(next, ringRef.current)) return; // our own setPath echo
      const now = Date.now();
      const burst = now - lastAt < DRAG_BURST_MS;
      lastAt = now;
      applyRef.current(
        next,
        burst ? { coalesce: DRAG_COALESCE_KEY } : undefined,
      );
    };
    const attach = (polygon: google.maps.Polygon) => {
      const path = polygon.getPath();
      if (pathRef.current === path) return;
      if (pathRef.current)
        google.maps.event.clearInstanceListeners(pathRef.current);
      path.addListener("insert_at", onPathChange);
      path.addListener("set_at", onPathChange);
      path.addListener("remove_at", onPathChange);
      pathRef.current = path;
    };

    if (polygonRef.current) {
      const polygon = polygonRef.current;
      const current = polygon
        .getPath()
        .getArray()
        .map((p) => ({ lat: p.lat(), lng: p.lng() }));
      if (!arraysEqual(current, ring)) polygon.setPath(ring);
      attach(polygon);
      return;
    }

    const color = KIND_COLOR[target.kind];
    const polygon = new mapsLib.Polygon({
      paths: ring,
      map,
      editable: true,
      draggable: false,
      strokeColor: color,
      strokeWeight: 3,
      fillColor: color,
      fillOpacity: 0.12,
      zIndex: 40,
    });
    polygonRef.current = polygon;
    attach(polygon);
    // Test handle, same convention as the instructor editor.
    (
      window as unknown as { __serviceAreaEditPolygon?: google.maps.Polygon }
    ).__serviceAreaEditPolygon = polygon;
  }, [map, mapsLib, target, drawing, ring, destroyPolygon]);

  // ---- validation + writes -------------------------------------------------

  const validate = (): string | null => {
    if (!target) return "Nothing to save.";
    if (!name.trim()) return "Give this area a name.";
    if (name.trim().length > 120) return "The name is too long (max 120).";
    if (ring.length < 3) return "Draw at least 3 points.";
    if (ring.length > MAX_SERVICE_AREA_VERTICES)
      return `Too many points (max ${MAX_SERVICE_AREA_VERTICES}).`;
    if (ringSelfIntersects(ring))
      return "The boundary crosses itself. Move a point so the edges no longer cross.";
    if (target.kind === "serviceable") {
      const clash = pieces.serviceable.find(
        (p) => p.id !== target.id && ringsOverlap(ring, p.ring),
      );
      if (clash)
        return `This overlaps "${clash.name}". Serviceable areas can touch but must not overlap — adjust the boundary, or edit that area instead.`;
    } else {
      const c = vertexCentroid(ring);
      const inside = pieces.serviceable.some((p) => pointInRing(c, p.ring));
      if (!inside)
        return "An excluded pocket has to sit inside a serviceable area (outside them is already grey).";
    }
    return null;
  };

  const save = async () => {
    if (!target || saving) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      if (target.id) {
        await updateServiceAreaZone({ id: target.id, name, ring });
      } else {
        await insertServiceAreaZone({ kind: target.kind, name, ring });
      }
      toast({
        title: "Service area saved",
        description: `${name.trim()} (${KIND_LABEL[target.kind].toLowerCase()}) was saved.`,
      });
      onChanged();
      stopEditing();
    } catch (err) {
      setError(
        isDuplicateServiceAreaError(err)
          ? DUPLICATE_SERVICE_AREA_MESSAGE
          : err instanceof Error
            ? err.message
            : "Could not save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string, label: string) => {
    setSaving(true);
    try {
      await deleteServiceAreaZone(id);
      toast({ title: "Deleted", description: `${label} was removed.` });
      onChanged();
      setPendingDeleteId(null);
      if (target?.id === id) stopEditing();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const panelClass =
    "absolute left-1/2 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 overflow-y-auto rounded-md border bg-background p-3 shadow-md";

  // ---------------------------------------------------------------- editing
  if (target) {
    const needsMore = Math.max(0, 3 - ring.length);
    const isNew = target.id === null;
    return (
      <div className={panelClass} data-testid="service-area-editor">
        <p className="text-xs font-medium" data-testid="service-area-title">
          {isNew ? "New" : "Editing"} {KIND_LABEL[target.kind].toLowerCase()}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {drawing
            ? needsMore > 0
              ? `Click the map to place points (${needsMore} more needed). Click "Finish drawing" when the outline is complete.`
              : 'Keep clicking to add points, then click "Finish drawing".'
            : "Drag a point to move it. Drag a bulge on an edge to add a point, or drag a point onto its neighbour to remove it."}
        </p>
        {target.kind === "serviceable" ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            White = where we offer service. To expand it, reshape this area or
            add a new serviceable area next to it.
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">
            An excluded pocket is a part inside a serviceable area where we do
            not serve. It is shown grey.
          </p>
        )}

        <label
          htmlFor="service-area-name"
          className="mt-2 block text-xs font-medium"
        >
          Name
        </label>
        <Input
          id="service-area-name"
          data-testid="service-area-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          disabled={saving}
          className="mt-1 h-8 text-sm"
        />

        <p
          className="mt-1.5 text-[11px] text-muted-foreground"
          data-testid="service-area-vertex-count"
        >
          {ring.length} point{ring.length === 1 ? "" : "s"}
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-1.5 text-xs font-medium text-destructive"
            data-testid="service-area-error"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={history.undo}
            disabled={!history.canUndo || saving}
            data-testid="service-area-undo"
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={history.redo}
            disabled={!history.canRedo || saving}
            data-testid="service-area-redo"
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
          {drawing ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDrawing(false)}
              disabled={ring.length < 3 || saving}
              data-testid="service-area-finish"
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              Finish drawing
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={stopEditing}
            disabled={saving}
            data-testid="service-area-cancel"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || drawing || ring.length < 3 || !dirty}
            data-testid="service-area-save"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
        {!isNew ? (
          <div className="mt-2 border-t pt-2">
            {pendingDeleteId === target.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-destructive">
                  {target.kind === "serviceable"
                    ? "Delete this area? Everything inside it becomes non-serviceable (grey)."
                    : "Delete this pocket? It becomes serviceable again."}
                </span>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void remove(target.id as string, name)}
                  disabled={saving}
                  data-testid="service-area-delete-confirm"
                >
                  Delete
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={saving}
                >
                  Keep
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => setPendingDeleteId(target.id)}
                disabled={saving}
                data-testid="service-area-delete"
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Delete this {KIND_LABEL[target.kind].toLowerCase()}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ------------------------------------------------------------------- list
  const renderSection = (kind: ServiceAreaKind) => {
    const list = pieces[kind];
    return (
      <div className="mt-3" data-testid={`service-area-section-${kind}`}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">
            {kind === "serviceable"
              ? `Serviceable areas (${list.length})`
              : `Excluded pockets (${list.length})`}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => startNew(kind)}
            data-testid={`service-area-add-${kind}`}
          >
            <Plus className="mr-1 h-3 w-3" />
            {kind === "serviceable" ? "Add area" : "Add pocket"}
          </Button>
        </div>
        <p className="mb-1 text-[11px] text-muted-foreground">
          {kind === "serviceable"
            ? "White on the map: where we offer service."
            : "Grey spots inside the white areas where we do not serve."}
        </p>
        {list.length === 0 ? (
          <p className="rounded border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
            None yet.
          </p>
        ) : (
          <ul className="max-h-56 space-y-1 overflow-y-auto pr-0.5">
            {list.map((p) => (
              <li
                key={p.id}
                className="rounded border px-2 py-1"
                data-testid={`service-area-row-${p.id}`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: KIND_COLOR[kind] }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={p.name}
                  >
                    {p.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {p.ring.length} pts
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label={`Show ${p.name} on the map`}
                    onClick={() => zoomTo(p.ring)}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => startEdit(kind, p)}
                    data-testid={`service-area-edit-${p.id}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    aria-label={`Delete ${p.name}`}
                    onClick={() => setPendingDeleteId(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {pendingDeleteId === p.id ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-destructive">
                      {kind === "serviceable"
                        ? "Everything inside becomes grey."
                        : "It becomes serviceable again."}
                    </span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-6 px-2 text-xs"
                      onClick={() => void remove(p.id, p.name)}
                      disabled={saving}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setPendingDeleteId(null)}
                    >
                      Keep
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className={panelClass} data-testid="service-area-list">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Edit service area</p>
          <p className="text-xs text-muted-foreground">
            White is where we offer service; everything else is grey. Expand the
            white area by reshaping a serviceable area or adding a new one.
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          onClick={onClose}
          aria-label="Done editing service area"
          data-testid="service-area-close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {renderSection("serviceable")}
      {renderSection("excluded")}
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
