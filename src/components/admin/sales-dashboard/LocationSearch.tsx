import { useQuery } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { drawServiceAreaMask } from "@/components/instructor-zones/serviceAreaMask";
import type { GeoPoint, KmlZone } from "@/lib/sales-dashboard/kml";
import { geocodeText, loadMapsApi } from "@/lib/sales-dashboard/maps";
import { fetchServiceAreaLayer } from "@/lib/sales-dashboard/zones-db";
import { googleMapsLoader } from "@/utils/googleMaps";

export type LocateStatus = "idle" | "loading" | "found" | "none";

interface LocationSearchProps {
  // `instructorId` is present on DB zones; it powers the map's "Add" button.
  zones: (KmlZone & { instructorId?: string })[] | null;
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
  /** Re-run the zones/roster mount fetch after a failure (see notes below). */
  onRetryZones?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Adds this instructor's timetable to the dashboard (polygon popup). */
  onAddInstructor?: (instructorId: string) => void;
  /** Instructors already on the dashboard, so the popup can say so. */
  dashboardInstructorIds?: ReadonlySet<string>;
}

interface OverlaySet {
  marker: google.maps.Marker | null;
  ring: google.maps.Polyline | null;
  polygons: google.maps.Polygon[];
  points: google.maps.Marker[];
}

const EMPTY_OVERLAYS: OverlaySet = {
  marker: null,
  ring: null,
  polygons: [],
  points: [],
};
// "Show all instructor areas": every instructor gets their own vivid colour so
// the areas are easy to tell apart (the old neutral grey, 1px, 8 % fill was
// nearly invisible). Stable per instructor, so a colour never changes between
// redraws.
const AREA_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#c026d3",
];
function areaColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AREA_PALETTE[Math.abs(h) % AREA_PALETTE.length];
}
const DEFAULT_MAP_CENTER = { lat: 12.9716, lng: 77.5946 };
const DEFAULT_MAP_ZOOM = 11;

function LocationSearch({
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
  onRetryZones,
  collapsed = false,
  onToggleCollapsed,
  onAddInstructor,
  dashboardInstructorIds,
}: LocationSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const autoRef = useRef<google.maps.places.Autocomplete | null>(null);
  const mapObjRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<OverlaySet>(EMPTY_OVERLAYS);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  // Small name tag that follows the pointer over an area (the click popup still
  // carries the "Add to dashboard" button; this just answers "whose is this?").
  const tipRef = useRef<HTMLDivElement>(null);
  const mapWrapRef = useRef<HTMLDivElement>(null);
  // The polygon the user clicked (highlighted while its popup is open). Kept in
  // a ref, not state, so selecting never re-runs the overlay effect.
  const selectedRef = useRef<{
    polygon: google.maps.Polygon | null;
    key: string;
  } | null>(null);
  const baseStyleRef = useRef(
    new WeakMap<google.maps.Polygon, google.maps.PolygonOptions>(),
  );
  const onAddRef = useRef(onAddInstructor);
  const dashboardIdsRef = useRef(dashboardInstructorIds);
  useEffect(() => {
    onAddRef.current = onAddInstructor;
    dashboardIdsRef.current = dashboardInstructorIds;
  });
  // Off: the map shows only the matched (Area + Nearby) polygons. On: every
  // instructor polygon is drawn too, in neutral grey.
  const [showAllZones, setShowAllZones] = useState(false);
  // Grey = areas we do not serve. Read from `service_area_zones` (the same rows
  // the admin Zone Map edits), so a change there shows up here on its own.
  const [showNonService, setShowNonService] = useState(true);
  const { data: serviceLayer } = useQuery({
    queryKey: ["service-area-layer"],
    queryFn: fetchServiceAreaLayer,
    staleTime: 60 * 1000,
  });
  const hasServiceLayer = (serviceLayer?.serviceable.length ?? 0) > 0;
  const polygonCount = (zones ?? []).filter((z) => z.kind === "polygon").length;
  // Full-screen map, for focusing on the polygons alone.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);
  const selectedPlaceRef = useRef<{
    lat: number;
    lng: number;
    label: string;
    applied: boolean;
  } | null>(null);

  const [maps, setMaps] = useState<typeof google.maps | null | undefined>(
    undefined,
  );
  const [places, setPlaces] = useState<google.maps.PlacesLibrary | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);

  const applyResolvedLocation = useCallback(
    (selection: { lat: number; lng: number; label: string }) => {
      setGeoError(null);
      onLocate(selection.lat, selection.lng, selection.label);
    },
    [onLocate],
  );

  useEffect(() => {
    let active = true;
    void loadMapsApi().then((m) => {
      if (active) setMaps(m);
    });
    return () => {
      active = false;
    };
  }, []);

  // `places` is NOT part of the Maps bootstrap request any more (see LIBRARIES
  // in utils/googleMaps.ts), so `maps.places` is undefined here. The
  // constructor has to come from an explicit importLibrary("places") call --
  // without it this effect threw "Cannot read properties of undefined
  // (reading 'Autocomplete')", the catch below swallowed it, and the location
  // box silently offered no suggestions at all.
  useEffect(() => {
    let active = true;
    void googleMapsLoader
      .importLibrary<google.maps.PlacesLibrary>("places")
      .then((lib) => {
        if (active) setPlaces(lib);
      })
      .catch(() => {
        // Autocomplete is unavailable; the Search button (geocoding) still works.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!places || collapsed) return;
    if (!inputRef.current || autoRef.current) return;
    try {
      const ac = new places.Autocomplete(inputRef.current, {
        fields: ["name", "formatted_address", "geometry"],
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const loc = place?.geometry?.location;
        if (!loc) return;
        const selection = {
          lat: loc.lat(),
          lng: loc.lng(),
          label:
            place.formatted_address ||
            place.name ||
            inputRef.current?.value ||
            "",
          applied: true,
        };
        selectedPlaceRef.current = selection;
        applyResolvedLocation(selection);
      });
      autoRef.current = ac;
      return () => {
        ac.unbindAll();
        autoRef.current = null;
      };
    } catch (err) {
      console.error("Failed to initialize Google Maps Autocomplete:", err);
    }
  }, [places, collapsed, applyResolvedLocation]);

  // Parent-driven clear paths (the summary Clear button and dashboard Reset)
  // must clear the same local state as this component's own Clear button.
  useEffect(() => {
    if (point !== null) return;
    selectedPlaceRef.current = null;
    setGeoError(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [point]);

  const runSearch = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setGeoError(null);
    const sel = selectedPlaceRef.current;
    if (sel && sel.lat !== undefined && sel.lng !== undefined) {
      if (!sel.applied) applyResolvedLocation(sel);
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
          ? "Google Maps isn't configured, so location search is unavailable."
          : "Still loading the map — try again in a moment.",
      );
      return;
    }
    const pt = await geocodeText(maps, trimmed);
    if (pt) {
      applyResolvedLocation({ ...pt, label: trimmed });
    } else {
      setGeoError(
        `Couldn't find "${trimmed}". Try a different area or click a suggestion.`,
      );
    }
  };

  // The container changes size when expanded/collapsed; Google Maps must be
  // told. Only on that change, not on every overlay redraw.
  useEffect(() => {
    const map = mapObjRef.current;
    if (!map || !maps) return;
    // Full screen: plain scroll zooms and one finger pans, like Google Maps.
    // Inline in the page, keep Ctrl+scroll so the page can still scroll past.
    map.setOptions({ gestureHandling: expanded ? "greedy" : "auto" });
    maps.event.trigger(map, "resize");
  }, [maps, expanded]);

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
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        cameraControl: false,
      });
      mapObjRef.current.addListener("click", () => {
        const sel = selectedRef.current;
        if (sel?.polygon) {
          const base = baseStyleRef.current.get(sel.polygon);
          if (base) sel.polygon.setOptions(base);
        }
        selectedRef.current = null;
        infoWindowRef.current?.close();
      });
    }
    const map = mapObjRef.current;
    const overlays = overlaysRef.current;
    overlays.marker?.setMap(null);
    overlays.ring?.setMap(null);
    for (const p of overlays.polygons) p.setMap(null);
    for (const p of overlays.points) p.setMap(null);
    overlaysRef.current = {
      marker: null,
      ring: null,
      polygons: [],
      points: [],
    };

    const matchedSet = new Set(matchedNames);
    const bounds = new maps.LatLngBounds();
    let matchedDrawn = 0;

    const HIGHLIGHT: google.maps.PolygonOptions = {
      strokeColor: "#2563eb",
      strokeOpacity: 1,
      strokeWeight: 3,
      fillColor: "#2563eb",
      fillOpacity: 0.3,
      zIndex: 5,
    };
    const unhighlight = (): void => {
      const sel = selectedRef.current;
      if (!sel?.polygon) return;
      const base = baseStyleRef.current.get(sel.polygon);
      if (base) sel.polygon.setOptions(base);
    };
    // Makes a polygon clickable: highlights it and opens a popup with the
    // instructor's name and an "Add to dashboard" button.
    const makeClickable = (
      polygon: google.maps.Polygon,
      z: { name: string; instructorId?: string },
      base: google.maps.PolygonOptions,
    ): void => {
      baseStyleRef.current.set(polygon, base);
      // The overlays are rebuilt on redraws; keep the clicked one highlighted.
      if (selectedRef.current?.key === z.name) {
        polygon.setOptions(HIGHLIGHT);
        selectedRef.current.polygon = polygon;
      }
      polygon.addListener("click", (e: google.maps.PolyMouseEvent) => {
        if (!e.latLng) return;
        unhighlight();
        polygon.setOptions(HIGHLIGHT);
        selectedRef.current = { polygon, key: z.name };

        const el = document.createElement("div");
        el.className = "loc-info";
        const title = document.createElement("div");
        title.className = "loc-info-name";
        title.textContent = z.name;
        el.appendChild(title);
        const instructorId = z.instructorId;
        if (instructorId && onAddRef.current) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "loc-add-btn";
          if (dashboardIdsRef.current?.has(instructorId)) {
            btn.textContent = "✓ In dashboard";
            btn.disabled = true;
          } else {
            btn.textContent = "＋ Add to dashboard";
            btn.addEventListener("click", () => {
              onAddRef.current?.(instructorId);
              btn.textContent = "✓ Added";
              btn.disabled = true;
            });
          }
          el.appendChild(btn);
        }
        if (!infoWindowRef.current) {
          const created = new maps.InfoWindow();
          // Registered once: the popup is reused for every polygon.
          created.addListener("closeclick", () => {
            unhighlight();
            selectedRef.current = null;
          });
          infoWindowRef.current = created;
        }
        const info = infoWindowRef.current;
        info.setContent(el);
        info.setPosition(e.latLng);
        info.open(map);
      });
    };

    // Every other instructor polygon, grey and underneath the matched ones.
    // Not added to `bounds`, so the map still frames the matches.
    if (showAllZones) {
      for (const z of zones ?? []) {
        if (z.kind !== "polygon") continue;
        if (point && via === "polygon" && matchedSet.has(z.name)) continue;
        const color = areaColor(z.instructorId ?? z.name);
        const areaStyle: google.maps.PolygonOptions = {
          strokeColor: color,
          strokeWeight: 2,
          strokeOpacity: 0.95,
          fillColor: color,
          fillOpacity: 0.2,
          // above the grey service-area shading (zIndex 0)
          zIndex: 3,
        };
        const polygon = new maps.Polygon({
          map,
          paths: z.coords.map((c) => ({ lat: c.lat, lng: c.lng })),
          ...areaStyle,
        });
        makeClickable(polygon, z, areaStyle);
        // Hover: brighten the area and show whose it is next to the pointer.
        const showTip = (e: google.maps.PolyMouseEvent): void => {
          const tip = tipRef.current;
          const wrap = mapWrapRef.current;
          const dom = e.domEvent as MouseEvent | undefined;
          if (!tip || !wrap || !dom) return;
          const r = wrap.getBoundingClientRect();
          tip.textContent = z.name;
          tip.style.left = `${dom.clientX - r.left + 14}px`;
          tip.style.top = `${dom.clientY - r.top + 14}px`;
          tip.hidden = false;
        };
        polygon.addListener("mouseover", (e: google.maps.PolyMouseEvent) => {
          if (selectedRef.current?.polygon !== polygon) {
            polygon.setOptions({ fillOpacity: 0.38, strokeWeight: 3 });
          }
          showTip(e);
        });
        polygon.addListener("mousemove", showTip);
        polygon.addListener("mouseout", () => {
          if (selectedRef.current?.polygon !== polygon) {
            polygon.setOptions(areaStyle);
          }
          if (tipRef.current) tipRef.current.hidden = true;
        });
        overlaysRef.current.polygons.push(polygon);
      }
    }

    if (!point) {
      map.setCenter(DEFAULT_MAP_CENTER);
      map.setZoom(DEFAULT_MAP_ZOOM);
      return;
    }

    for (const z of zones ?? []) {
      const info = zoneInfo[z.name];
      if (
        via === "polygon" &&
        z.kind === "polygon" &&
        matchedSet.has(z.name) &&
        info
      ) {
        const path = z.coords.map((c) => ({ lat: c.lat, lng: c.lng }));
        const matchedStyle: google.maps.PolygonOptions = {
          strokeColor: info.color,
          strokeOpacity: 1,
          strokeWeight: 1.5,
          fillColor: info.color,
          fillOpacity: 0.12,
          zIndex: 2,
        };
        const polygon = new maps.Polygon({ map, paths: path, ...matchedStyle });
        makeClickable(polygon, z, matchedStyle);
        overlaysRef.current.polygons.push(polygon);
        matchedDrawn++;
        for (const c of path) bounds.extend(c);
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
        matchedDrawn++;
        bounds.extend(z.coords[0]);
      }
    }

    overlaysRef.current.marker = new maps.Marker({
      map,
      position: point,
      title: resultLabel ?? "Selected location",
    });
    bounds.extend(point);

    if (matchedDrawn > 0) {
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
    collapsed,
    showAllZones,
    expanded,
  ]);

  // Grey shading for areas we do not serve. Separate from the overlay effect
  // above so a search or a "show all polygons" toggle never redraws it. It runs
  // after that effect (which creates the map), and re-runs whenever the map is
  // rebuilt (collapse / expand) or the layer changes.
  useEffect(() => {
    const map = mapObjRef.current;
    if (!maps || collapsed || !map || !serviceLayer || !showNonService) return;
    return drawServiceAreaMask(maps, map, serviceLayer);
  }, [maps, collapsed, serviceLayer, showNonService, expanded]);

  const clearLocal = (): void => {
    selectedPlaceRef.current = null;
    setGeoError(null);
    if (inputRef.current) inputRef.current.value = "";
    onClear();
  };

  // Round expand/close button, styled like Google's own map controls and
  // floated over the map's top-right corner.
  const expandButton = (
    <button
      type="button"
      className="loc-expand-btn loc-expand-float"
      onClick={() => setExpanded((v) => !v)}
      aria-label={expanded ? "Exit full-screen map" : "Expand map"}
      title={expanded ? "Exit full screen (Esc)" : "Expand map"}
    >
      <span aria-hidden="true">{expanded ? "✕" : "⤢"}</span>
    </button>
  );

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
              onChange={() => {
                // Typing only invalidates an earlier suggestion; it never
                // applies location filtering until Search/Enter is used.
                selectedPlaceRef.current = null;
              }}
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
            {point && (
              <button type="button" className="loc-clear" onClick={clearLocal}>
                Clear location
              </button>
            )}
          </div>

          {zonesError && (
            <p className="loc-status error">
              Couldn&apos;t load instructor zones: {zonesError}.
              {onRetryZones && (
                <button
                  type="button"
                  className="loc-btn loc-retry"
                  onClick={onRetryZones}
                >
                  Retry
                </button>
              )}
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
              Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to enable it.
            </p>
          )}
          {maps && status === "none" && (
            <p className="loc-status">
              No instructor works near “{resultLabel}” yet.
            </p>
          )}
          {maps && (
            <div
              ref={mapWrapRef}
              className={expanded ? "loc-map-wrap expanded" : "loc-map-wrap"}
            >
              <div className="loc-map-tools">
                <label
                  className={showAllZones ? "loc-pill on" : "loc-pill"}
                  title="Draw every instructor's area on the map, each in its own colour"
                >
                  <input
                    type="checkbox"
                    checked={showAllZones}
                    onChange={(e) => setShowAllZones(e.target.checked)}
                  />
                  <span className="loc-pill-dots" aria-hidden="true">
                    <i style={{ background: AREA_PALETTE[0] }} />
                    <i style={{ background: AREA_PALETTE[1] }} />
                    <i style={{ background: AREA_PALETTE[2] }} />
                  </span>
                  Show all polygons
                  {polygonCount > 0 && (
                    <span className="loc-pill-count">{polygonCount}</span>
                  )}
                </label>
                {hasServiceLayer && (
                  <label
                    className={showNonService ? "loc-pill on" : "loc-pill"}
                    title="Grey = areas where we do not offer service"
                  >
                    <input
                      type="checkbox"
                      checked={showNonService}
                      onChange={(e) => setShowNonService(e.target.checked)}
                    />
                    <span className="loc-pill-swatch grey" aria-hidden="true" />
                    Grey out areas we don&apos;t serve
                  </label>
                )}
              </div>
              <div
                className="loc-map"
                ref={mapElRef}
                aria-label="Map of matched instructor areas"
              />
              {(hasServiceLayer && showNonService) || showAllZones ? (
                <div className="loc-legend" data-testid="loc-legend">
                  {hasServiceLayer && showNonService && (
                    <>
                      <span>
                        <i className="loc-pill-swatch white" /> We serve
                      </span>
                      <span>
                        <i className="loc-pill-swatch grey" /> We don&apos;t
                        serve
                      </span>
                    </>
                  )}
                  {showAllZones && (
                    <span>
                      <i className="loc-pill-swatch area" /> Instructor area
                    </span>
                  )}
                </div>
              ) : null}
              <div className="loc-map-tip" ref={tipRef} hidden />
              {expandButton}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// Memoized: the dashboard re-renders often (instructor loads, realtime), and the
// map must only redraw when its own inputs change.
export default memo(LocationSearch);
