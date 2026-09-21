import { useEffect, useRef, useState } from "react";

import type { GeoPoint, KmlZone } from "@/lib/sales-dashboard/kml";
import { PROXIMITY_RADIUS_KM } from "@/lib/sales-dashboard/kml";
import { geocodeText, loadMapsApi } from "@/lib/sales-dashboard/maps";

export type LocateStatus = "idle" | "loading" | "found" | "none";

interface LocationSearchProps {
  zones: KmlZone[] | null;
  zonesError: string | null;
  status: LocateStatus;
  resultLabel: string | null;
  point: GeoPoint | null;
  matchedNames: string[];
  via: "polygon" | "point" | "none";
  zoneInfo: Record<
    string,
    { color: string; instructorName: string; rawName: string }
  >;
  onLocate: (lat: number, lng: number, label: string) => void;
  onClear: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  theme?: "light" | "dark";
}

// Google Maps renders its own tiles/UI and ignores page CSS entirely, so the
// map stays a bright default even inside an otherwise dark-themed page
// unless a style array is applied explicitly. Standard "night mode" palette.
const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1d2129" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1d2129" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa0a6" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#3c4043" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#2a2f38" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#233326" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#38414e" }],
  },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#212a37" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#4b5566" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#2a2f38" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#17263c" }],
  },
];

interface OverlaySet {
  marker: google.maps.Marker | null;
  ring: google.maps.Polyline | null;
  polygons: google.maps.Polygon[];
  points: google.maps.Marker[];
  labels: google.maps.Marker[];
}

const EMPTY_OVERLAYS: OverlaySet = {
  marker: null,
  ring: null,
  polygons: [],
  points: [],
  labels: [],
};
const RING_COLOR = "#1a73e8";

export default function LocationSearch({
  zones,
  zonesError,
  status,
  resultLabel,
  point,
  matchedNames,
  via,
  zoneInfo,
  onLocate,
  onClear,
  collapsed = false,
  onToggleCollapsed,
  theme = "light",
}: LocationSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef<google.maps.places.Autocomplete | null>(null);
  const mapObjRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<OverlaySet>(EMPTY_OVERLAYS);
  const selectedPlaceRef = useRef<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);

  const [maps, setMaps] = useState<typeof google.maps | null | undefined>(
    undefined,
  );
  const [geoError, setGeoError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  const proximity =
    point !== null &&
    via === "point" &&
    matchedNames.some((n) => Boolean(zoneInfo[n]));

  useEffect(() => {
    let active = true;
    void loadMapsApi().then((m) => {
      if (active) setMaps(m);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!maps || collapsed) return;
    if (!inputRef.current || autoRef.current) return;
    try {
      const ac = new maps.places.Autocomplete(inputRef.current, {
        fields: ["name", "formatted_address", "geometry"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const loc = place?.geometry?.location;
        if (!loc) return;
        selectedPlaceRef.current = {
          lat: loc.lat(),
          lng: loc.lng(),
          label:
            place.formatted_address ||
            place.name ||
            inputRef.current?.value ||
            "",
        };
      });
      autoRef.current = ac;
      return () => {
        ac.unbindAll();
        autoRef.current = null;
      };
    } catch (err) {
      console.error("Failed to initialize Google Maps Autocomplete:", err);
    }
  }, [maps, collapsed]);

  const runSearch = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setGeoError(null);
    const sel = selectedPlaceRef.current;
    if (sel && sel.lat !== undefined && sel.lng !== undefined) {
      onLocate(sel.lat, sel.lng, sel.label);
      selectedPlaceRef.current = null;
      return;
    }
    if (!maps) {
      // maps is `undefined` while the script is still loading, and `null`
      // if it failed to load / no API key. Both cases previously fell
      // through this guard silently — the Search button's disabled state
      // only checked for `null`, so clicking (or pressing Enter, which
      // bypasses the button entirely) while maps was still `undefined`
      // produced no feedback at all.
      setGeoError(
        maps === null
          ? "Google Maps isn't configured — use the Coordinates button instead."
          : "Still loading the map — try again in a moment.",
      );
      return;
    }
    const pt = await geocodeText(maps, trimmed);
    if (pt) {
      onLocate(pt.lat, pt.lng, trimmed);
    } else {
      setGeoError(
        `Couldn't find "${trimmed}". Try a different area or click a suggestion.`,
      );
    }
  };

  const applyManual = (): void => {
    const lat = parseFloat(manualLat);
    const lng = parseFloat(manualLng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setGeoError(null);
      onLocate(lat, lng, `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } else {
      setGeoError("Enter valid latitude and longitude numbers.");
    }
  };

  // The map object above is created once and reused -- toggling the page
  // theme afterward doesn't recreate it, so its styles need updating live
  // via setOptions rather than only being set at construction time.
  useEffect(() => {
    mapObjRef.current?.setOptions({
      styles: theme === "dark" ? DARK_MAP_STYLE : [],
    });
  }, [theme]);

  useEffect(() => {
    if (!maps) return;
    if (collapsed) {
      mapObjRef.current = null;
      overlaysRef.current = EMPTY_OVERLAYS;
      return;
    }
    if (!mapElRef.current) return;
    if (!mapObjRef.current) {
      mapObjRef.current = new maps.Map(mapElRef.current, {
        center: { lat: 12.9716, lng: 77.5946 },
        zoom: 11,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: theme === "dark" ? DARK_MAP_STYLE : [],
      });
    }
    const map = mapObjRef.current;
    const overlays = overlaysRef.current;
    overlays.marker?.setMap(null);
    overlays.ring?.setMap(null);
    for (const p of overlays.polygons) p.setMap(null);
    for (const p of overlays.points) p.setMap(null);
    for (const l of overlays.labels) l.setMap(null);
    overlaysRef.current = {
      marker: null,
      ring: null,
      polygons: [],
      points: [],
      labels: [],
    };

    if (!point) return;
    const matchedSet = new Set(matchedNames);
    const bounds = new maps.LatLngBounds();

    for (const z of zones ?? []) {
      const info = zoneInfo[z.name];
      if (
        via === "polygon" &&
        z.kind === "polygon" &&
        matchedSet.has(z.name) &&
        info
      ) {
        const path = z.coords.map((c) => ({ lat: c.lat, lng: c.lng }));
        const polygon = new maps.Polygon({
          map,
          paths: path,
          strokeColor: info.color,
          strokeWeight: 1.5,
          fillColor: info.color,
          fillOpacity: 0.12,
        });
        overlaysRef.current.polygons.push(polygon);
        for (const c of path) bounds.extend(c);
        const cx = path.reduce((sum, p) => sum + p.lat, 0) / path.length;
        const cy = path.reduce((sum, p) => sum + p.lng, 0) / path.length;
        const label = new maps.Marker({
          map,
          position: { lat: cx, lng: cy },
          clickable: false,
          zIndex: 100,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 0,
            fillOpacity: 0,
            strokeOpacity: 0,
          },
          title: info.rawName,
          label: {
            text:
              info.instructorName.length > 20
                ? `${info.instructorName.slice(0, 20)}…`
                : info.instructorName,
            color: "#1e1e1e",
            fontSize: "11.5px",
            fontWeight: "600",
          },
        });
        overlaysRef.current.labels.push(label);
      } else if (
        via === "point" &&
        z.kind === "point" &&
        matchedSet.has(z.name) &&
        info
      ) {
        const marker = new maps.Marker({
          map,
          position: z.coords[0],
          title: info.rawName,
          icon: {
            path: maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: info.color,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 1.5,
          },
        });
        overlaysRef.current.points.push(marker);
        bounds.extend(z.coords[0]);
      }
    }

    overlaysRef.current.marker = new maps.Marker({
      map,
      position: point,
      title: resultLabel ?? "Selected location",
    });
    bounds.extend(point);

    if (proximity) {
      const km = PROXIMITY_RADIUS_KM * 1000;
      const cosLat = Math.cos((point.lat * Math.PI) / 180);
      const path: google.maps.LatLngLiteral[] = [];
      for (let i = 0; i < 72; i++) {
        const ang = (i / 72) * 2 * Math.PI;
        path.push({
          lat: point.lat + (km * Math.cos(ang)) / 111320,
          lng: point.lng + (km * Math.sin(ang)) / (111320 * cosLat),
        });
      }
      const ring = new maps.Polyline({
        map,
        path,
        geodesic: true,
        strokeColor: RING_COLOR,
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
        strokeDashArray: "6 6",
      } as google.maps.PolylineOptions);
      overlaysRef.current.ring = ring;
      for (const c of path) bounds.extend(c);
    }

    const hasZones =
      overlaysRef.current.polygons.length > 0 ||
      overlaysRef.current.points.length > 0;
    if (hasZones) {
      map.fitBounds(bounds, { top: 48, right: 48, bottom: 48, left: 48 });
    } else {
      map.setCenter(point);
      map.setZoom(13);
    }
  }, [
    maps,
    point,
    zones,
    matchedNames,
    resultLabel,
    via,
    zoneInfo,
    proximity,
    collapsed,
    theme,
  ]);

  const clearLocal = (): void => {
    selectedPlaceRef.current = null;
    setGeoError(null);
    if (inputRef.current) inputRef.current.value = "";
    onClear();
  };

  return (
    <section className="loc-search" aria-label="Search by location">
      <div className="loc-head">
        <label className="loc-title" htmlFor="loc-input">
          Search by location
        </label>
        {onToggleCollapsed && (
          <button
            type="button"
            className="loc-collapse-btn"
            onClick={onToggleCollapsed}
            aria-label={
              collapsed
                ? "Expand the search by location card"
                : "Collapse the search by location card"
            }
            aria-expanded={!collapsed}
          >
            {collapsed ? "▲" : "▼"}
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="loc-row">
            <input
              id="loc-input"
              ref={inputRef}
              type="text"
              className="loc-input"
              placeholder="Area, landmark or address — e.g. Koramangala, Bangalore"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch(e.currentTarget.value);
                }
              }}
            />
            <button
              type="button"
              className="loc-btn"
              // !maps covers both undefined (still loading) and null (no
              // API key / failed) — the previous `maps === null` check left
              // the button clickable during the loading window, silently
              // no-opping if clicked (or Enter-pressed) before maps finished
              // loading.
              disabled={!maps}
              onClick={() => void runSearch(inputRef.current?.value ?? "")}
            >
              Search
            </button>
            <button
              type="button"
              className="loc-manual-btn"
              onClick={() => setManualOpen((o) => !o)}
            >
              Coordinates
            </button>
            {point && (
              <button type="button" className="loc-clear" onClick={clearLocal}>
                Clear location
              </button>
            )}
          </div>

          {manualOpen && (
            <div
              className="loc-manual"
              role="group"
              aria-label="Enter coordinates manually"
            >
              <input
                className="loc-manual-input"
                inputMode="decimal"
                placeholder="Latitude (e.g. 12.9352)"
                value={manualLat}
                onChange={(e) => setManualLat(e.target.value)}
              />
              <input
                className="loc-manual-input"
                inputMode="decimal"
                placeholder="Longitude (e.g. 77.6245)"
                value={manualLng}
                onChange={(e) => setManualLng(e.target.value)}
              />
              <button type="button" className="loc-btn" onClick={applyManual}>
                Apply coordinates
              </button>
            </div>
          )}

          {zonesError && (
            <p className="loc-status error">
              Couldn&apos;t load instructor zones: {zonesError}
            </p>
          )}
          {!zonesError && status === "loading" && (
            <p className="loc-status">Loading instructor zones…</p>
          )}
          {geoError && <p className="loc-status error">{geoError}</p>}
          {maps === undefined && <p className="loc-status">Loading map…</p>}
          {maps === null && (
            <p className="loc-status">
              Google Maps isn&apos;t configured, so place search is disabled.
              Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to enable it — or use
              the Coordinates button instead.
            </p>
          )}
          {maps && status === "found" && (
            <p className="loc-status ok">
              Found instructors near “{resultLabel}”. The grid below now shows
              only them.
            </p>
          )}
          {maps && status === "none" && (
            <p className="loc-status">
              No instructor works near “{resultLabel}” yet.
            </p>
          )}
          {maps && (
            <div
              className="loc-map"
              ref={mapElRef}
              aria-label="Map of matched instructor areas"
            />
          )}
          {maps && proximity && (
            <p className="loc-legend">
              Dotted ring = {PROXIMITY_RADIUS_KM} km search radius. Instructors
              whose zones are marked as points in this radius were matched.
            </p>
          )}
        </>
      )}
    </section>
  );
}
