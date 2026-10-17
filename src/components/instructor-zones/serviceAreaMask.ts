import type { ServiceAreaLayer } from "@/lib/sales-dashboard/zones-db";

import { signedArea } from "./serviceAreaGeometry";

/**
 * The grey "we do not serve here" shading, shared by the Zone Map and the Sales
 * Dashboard map so both draw it identically and both read it from
 * `service_area_zones` (never from a file).
 *
 * Grey = a big rectangle with every serviceable ring cut out as a hole, plus the
 * excluded pockets (which sit inside those holes) filled grey again.
 *
 * Why a rectangle around India and not the world: Google Maps draws nothing for
 * a polygon this large once it nears world size. Tested: a world-wide outer ring
 * (lat ±85, lng ±180) renders BLANK and only the holes show, so the layer comes
 * out inverted; ~130° wide fails too; ~32° across renders correctly. Holes must
 * also wind opposite to the outer ring, which is enforced below.
 */
const OUTER_RING = [
  { lat: 37, lng: 66 },
  { lat: 37, lng: 98 },
  { lat: 5, lng: 98 },
  { lat: 5, lng: 66 },
];

const MASK_STYLE = {
  fillColor: "#111827",
  fillOpacity: 0.4,
  strokeColor: "#374151",
  strokeOpacity: 0.7,
  strokeWeight: 1,
  // Never swallow clicks meant for the layers underneath.
  clickable: false,
  zIndex: 0,
} as const;

/** Draws the layer on `map` and returns a function that removes it. */
export function drawServiceAreaMask(
  maps: typeof google.maps,
  map: google.maps.Map,
  layer: ServiceAreaLayer,
): () => void {
  if (!maps.Polygon || layer.serviceable.length === 0) return () => {};

  const outerSign = Math.sign(signedArea(OUTER_RING));
  const holes = layer.serviceable.map((z) =>
    Math.sign(signedArea(z.ring)) === outerSign
      ? [...z.ring].reverse()
      : z.ring,
  );

  const created: google.maps.Polygon[] = [
    new maps.Polygon({ ...MASK_STYLE, paths: [OUTER_RING, ...holes], map }),
    ...layer.excluded.map(
      (z) =>
        new maps.Polygon({
          ...MASK_STYLE,
          strokeWeight: 0,
          paths: z.ring,
          map,
        }),
    ),
  ];
  return () => {
    for (const p of created) p.setMap(null);
  };
}
