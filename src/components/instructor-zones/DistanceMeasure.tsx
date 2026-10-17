import { Car, Home, Loader2, MapPin, Ruler, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  fetchRoadRoute,
  formatDuration,
  formatKm,
  haversineKm,
  type LatLng,
  parseCoordinates,
  type RoadRoute,
} from "@/lib/map-distance";

export interface MeasureFrom {
  id: string;
  name: string;
  /** The instructor's registered home (Instructor.latitude / longitude). */
  at: LatLng;
}

export interface MeasureTo {
  at: LatLng;
  label: string;
}

interface DistanceMeasureProps {
  map: google.maps.Map | null;
  mapsLib: typeof google.maps | null;
  from: MeasureFrom | null;
  to: MeasureTo | null;
  /** The other end: a map click, pasted coordinates (search/drag live upstream). */
  onSetTo: (to: MeasureTo) => void;
  /** Forget both ends. */
  onClear: () => void;
  onClose: () => void;
}

const ACCENT = "#ea580c";
const ROAD_DEBOUNCE_MS = 450;

type RoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; route: RoadRoute }
  | { status: "unavailable" };

/**
 * "Measure distance": from an instructor's HOME to any other place.
 *
 * Rendered only while the tool is on. The two ends are owned by the page
 * (`from` = the instructor whose home dot was clicked, `to` = the page's
 * search/drop pin, so the existing address search and a draggable pin both work
 * as ways to set it). This component adds the map click and coordinate input,
 * draws the line + ring + distance label, and shows two figures:
 *   - straight-line: instant, always available (the same kind of distance the
 *     "Nearby instructor" radius uses);
 *   - by road: driving distance and time from Google, shown a moment later and
 *     replaced by a note if it cannot be had. No live traffic.
 */
export function DistanceMeasure({
  map,
  mapsLib,
  from,
  to,
  onSetTo,
  onClear,
  onClose,
}: DistanceMeasureProps) {
  const [coordText, setCoordText] = useState("");
  const [coordNote, setCoordNote] = useState<{
    kind: "error" | "info";
    text: string;
  } | null>(null);
  const [road, setRoad] = useState<RoadState>({ status: "idle" });

  const straightKm = from && to ? haversineKm(from.at, to.at) : null;

  // ---- map click drops the other end -----------------------------------------
  const onSetToRef = useRef(onSetTo);
  onSetToRef.current = onSetTo;
  useEffect(() => {
    if (!map) return;
    const prevCursor = map.get("draggableCursor") as string | undefined;
    map.setOptions({ draggableCursor: "crosshair" });
    const listener = map.addListener(
      "click",
      (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        onSetToRef.current({
          at: { lat: e.latLng.lat(), lng: e.latLng.lng() },
          label: "Dropped pin",
        });
      },
    );
    return () => {
      listener.remove();
      map.setOptions({ draggableCursor: prevCursor });
    };
  }, [map]);

  // ---- road distance (debounced; stale answers are ignored) -------------------
  useEffect(() => {
    if (!mapsLib || !from || !to) {
      setRoad({ status: "idle" });
      return;
    }
    let live = true;
    setRoad({ status: "loading" });
    const t = setTimeout(() => {
      void fetchRoadRoute(mapsLib, from.at, to.at).then((route) => {
        if (!live) return;
        setRoad(route ? { status: "ok", route } : { status: "unavailable" });
      });
    }, ROAD_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [mapsLib, from, to]);

  // ---- ring on the home, line + label between the two ends --------------------
  const fromKey = from ? `${from.at.lat},${from.at.lng}` : "";
  const toKey = to ? `${to.at.lat},${to.at.lng}` : "";
  const labelRef = useRef<{ straight: string; road: string }>({
    straight: "",
    road: "",
  });
  labelRef.current = {
    straight: straightKm === null ? "" : formatKm(straightKm),
    road: road.status === "ok" ? formatKm(road.route.meters / 1000) : "",
  };

  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const overlaysRef = useRef<{
    ring: google.maps.Marker | null;
    line: google.maps.Polyline | null;
  }>({ ring: null, line: null });

  // Geometry: re-drawn only when an end moves.
  useEffect(() => {
    const o = overlaysRef.current;
    o.ring?.setMap(null);
    o.line?.setMap(null);
    o.ring = null;
    o.line = null;
    if (!map || !mapsLib?.Marker || !mapsLib.Polyline) return;

    if (from) {
      // A fixed-SIZE marker, not a metre-radius circle: a circle shrinks to
      // nothing once the map is zoomed out to frame a long distance, which made
      // the start of the line invisible.
      o.ring = new mapsLib.Marker({
        map,
        position: from.at,
        title: `${from.name} — home`,
        clickable: false,
        zIndex: 7,
        icon: {
          path: mapsLib.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#ffffff",
          fillOpacity: 1,
          strokeColor: ACCENT,
          strokeWeight: 4,
        },
      });
    }
    if (from && to) {
      o.line = new mapsLib.Polyline({
        map,
        path: [from.at, to.at],
        strokeColor: ACCENT,
        strokeOpacity: 0,
        clickable: false,
        zIndex: 6,
        // Dashes: a Polyline has no dash style, only repeated icons.
        icons: [
          {
            icon: {
              path: "M 0,-1 0,1",
              strokeOpacity: 1,
              strokeColor: ACCENT,
              scale: 3,
            },
            offset: "0",
            repeat: "14px",
          },
        ],
      });
      const b = new mapsLib.LatLngBounds();
      b.extend(from.at);
      b.extend(to.at);
      // Margins keep both ends clear of the two cards over the map: this one
      // (top, centre) and the instructor info card (bottom-left).
      map.fitBounds(b, { top: 230, right: 100, bottom: 250, left: 340 });
    }
    return () => {
      o.ring?.setMap(null);
      o.line?.setMap(null);
      o.ring = null;
      o.line = null;
    };
    // `from` / `to` identity is covered by their coordinates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mapsLib, fromKey, toKey]);

  // A location set before any instructor is picked (pasted coordinates, a
  // search result) has no line to frame, so bring the map to it: otherwise the
  // pin can land off-screen and nothing visibly happens. With an instructor
  // picked, the fitBounds above already frames both ends.
  useEffect(() => {
    if (!map || from || !to) return;
    map.panTo(to.at);
    if ((map.getZoom() ?? 0) < 12) map.setZoom(13);
    // only when the destination itself moves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, toKey, from === null]);

  // Label: its text changes when the road figure arrives, without redrawing the
  // line (which would also re-fit the map and fight the user's panning).
  useEffect(() => {
    infoRef.current?.close();
    if (!map || !mapsLib?.InfoWindow || !from || !to) return;
    const el = document.createElement("div");
    el.style.cssText =
      "font:600 12px system-ui,sans-serif;color:#111827;white-space:nowrap;padding:1px 2px";
    const { straight, road: roadText } = labelRef.current;
    el.textContent = roadText
      ? `${straight}  ·  ${roadText} by road`
      : straight;
    const info =
      infoRef.current ??
      new mapsLib.InfoWindow({
        disableAutoPan: true,
        headerDisabled: true,
        pixelOffset: new mapsLib.Size(0, -4),
      } as google.maps.InfoWindowOptions);
    info.setContent(el);
    info.setPosition({
      lat: (from.at.lat + to.at.lat) / 2,
      lng: (from.at.lng + to.at.lng) / 2,
    });
    info.open(map);
    infoRef.current = info;
  }, [map, mapsLib, fromKey, toKey, road, from, to]);

  useEffect(
    () => () => {
      infoRef.current?.close();
      infoRef.current = null;
    },
    [],
  );

  // ---- coordinate input ---------------------------------------------------------
  const applyCoordinates = () => {
    const parsed = parseCoordinates(coordText);
    if (!parsed.ok) {
      setCoordNote({ kind: "error", text: parsed.error });
      return;
    }
    onSetTo({
      at: parsed.at,
      label: `${parsed.at.lat.toFixed(5)}, ${parsed.at.lng.toFixed(5)}`,
    });
    setCoordNote(
      parsed.swapped
        ? {
            kind: "info",
            text: "That looked like longitude, latitude — it was flipped for you.",
          }
        : null,
    );
    setCoordText("");
  };

  return (
    <div
      className="absolute left-1/2 top-3 z-20 w-[min(27rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-md border bg-background p-3 shadow-md"
      data-testid="measure-card"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Ruler className="h-4 w-4" />
          Measure distance
        </p>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0"
          aria-label="Close measure distance"
          data-testid="measure-close"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <dl className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-start gap-2" data-testid="measure-from">
          <Home
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            style={{ color: ACCENT }}
          />
          <div className="min-w-0">
            <dt className="text-muted-foreground">From (instructor home)</dt>
            <dd className="font-medium">
              {from ? (
                `${from.name} · ${from.at.lat.toFixed(4)}, ${from.at.lng.toFixed(4)}`
              ) : (
                <span className="font-normal text-muted-foreground">
                  Click an instructor&apos;s home dot on the map, or use
                  &quot;Measure from home&quot; on an instructor&apos;s card.
                </span>
              )}
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2" data-testid="measure-to">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
          <div className="min-w-0">
            <dt className="text-muted-foreground">To</dt>
            <dd className="font-medium">
              {to ? (
                <span title={to.label}>{to.label}</span>
              ) : (
                <span className="font-normal text-muted-foreground">
                  Search an address in the top bar, click the map, or paste
                  coordinates below.
                </span>
              )}
            </dd>
          </div>
        </div>
      </dl>

      <div className="mt-2 flex gap-2">
        <Input
          value={coordText}
          onChange={(e) => {
            setCoordText(e.target.value);
            setCoordNote(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              applyCoordinates();
            }
          }}
          placeholder="Paste coordinates: 12.9716, 77.5946"
          aria-label="Paste coordinates"
          data-testid="measure-coords-input"
          className="h-8 text-xs"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={applyCoordinates}
          disabled={!coordText.trim()}
          data-testid="measure-coords-set"
        >
          Set
        </Button>
      </div>
      {coordNote ? (
        <p
          role={coordNote.kind === "error" ? "alert" : "status"}
          className={
            coordNote.kind === "error"
              ? "mt-1 text-[11px] font-medium text-destructive"
              : "mt-1 text-[11px] text-muted-foreground"
          }
          data-testid="measure-coords-note"
        >
          {coordNote.text}
        </p>
      ) : null}

      {straightKm !== null ? (
        <div
          className="mt-3 rounded-md border bg-muted/40 p-2.5"
          data-testid="measure-result"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="text-2xl font-semibold tabular-nums"
              data-testid="measure-straight"
            >
              {formatKm(straightKm)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              straight line
            </span>
          </div>
          <div
            className="mt-1.5 flex items-center gap-1.5 text-xs"
            data-testid="measure-road"
          >
            <Car className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {road.status === "loading" ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking by road…
              </span>
            ) : road.status === "ok" ? (
              <span>
                <strong className="tabular-nums">
                  {formatKm(road.route.meters / 1000)}
                </strong>{" "}
                by road ·{" "}
                <strong className="tabular-nums">
                  {formatDuration(road.route.seconds)}
                </strong>{" "}
                <span className="text-muted-foreground">(no live traffic)</span>
              </span>
            ) : road.status === "unavailable" ? (
              <span className="text-muted-foreground">
                Road distance isn&apos;t available right now — straight line
                shown.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setCoordText("");
            setCoordNote(null);
            onClear();
          }}
          disabled={!from && !to}
          data-testid="measure-clear"
        >
          Clear
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
