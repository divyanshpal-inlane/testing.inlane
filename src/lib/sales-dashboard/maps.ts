export const mapsApiKey: string = (
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ""
).trim();

let mapsPromise: Promise<typeof google.maps | null> | null = null;

export function loadMapsApi(): Promise<typeof google.maps | null> {
  if (mapsPromise) return mapsPromise;
  if (!mapsApiKey) {
    mapsPromise = Promise.resolve(null);
    return mapsPromise;
  }
  if (window.google?.maps) {
    mapsPromise = Promise.resolve(window.google.maps);
    return mapsPromise;
  }
  mapsPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    let settled = false;
    const finish = (gm: typeof google.maps | null) => {
      if (settled) return;
      settled = true;
      resolve(gm);
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(mapsApiKey)}&libraries=places&v=weekly`;
    script.async = true;
    script.onload = () => finish(window.google?.maps ?? null);
    script.onerror = () => finish(null);
    document.head.appendChild(script);
  });
  return mapsPromise;
}

// Types that indicate a specific named place (a landmark/building/complex)
// rather than a generic road or administrative area.
const SPECIFIC_PLACE_TYPES = new Set([
  "establishment",
  "point_of_interest",
  "premise",
  "subpremise",
]);

export async function geocodeText(
  gm: typeof google.maps,
  text: string,
): Promise<{ lat: number; lng: number } | null> {
  // The base Maps script's onload firing does NOT guarantee every class is
  // ready yet — Google lazy-loads sub-libraries (geocoding included) after
  // the initial script executes. Constructing `new gm.Geocoder()` right
  // after the script loads can throw ("Cannot read properties of undefined
  // (reading 'maps')") or silently fail depending on timing — reproduced
  // directly: calling this right when loadMapsApi()'s promise first
  // resolves fails every time. `importLibrary()` is Google's documented way
  // to actually wait for a specific library to be ready, and is safe/cheap
  // to call even if the library is already loaded.
  const { Geocoder } = (await gm.importLibrary(
    "geocoding",
  )) as google.maps.GeocodingLibrary;
  const geocoder = new Geocoder();
  return new Promise((resolve) => {
    geocoder.geocode({ address: text }, (results, status) => {
      if (status !== "OK" || !results || results.length === 0) {
        resolve(null);
        return;
      }
      // Google can rank a bare road/locality match ahead of the specific
      // named place the query actually describes — e.g. "<Landmark Name>,
      // <Road>, <Area>" sometimes geocodes results[0] to just the road
      // (type "route"), kilometers from the real landmark, while a later
      // result is the actual establishment. Since a query naming a specific
      // place implies the user wants that place, prefer any result typed as
      // a specific place over the first result when one exists.
      const specific = results.find((r) =>
        r.types?.some((t) => SPECIFIC_PLACE_TYPES.has(t)),
      );
      const loc = (specific ?? results[0]).geometry?.location;
      resolve(loc ? { lat: loc.lat(), lng: loc.lng() } : null);
    });
  });
}

const BENGALURU = { lat: 12.9716, lng: 77.5946 };

export function centerFor(pt: {
  lat: number;
  lng: number;
}): google.maps.LatLngLiteral {
  return isFinite(pt.lat) && isFinite(pt.lng)
    ? { lat: pt.lat, lng: pt.lng }
    : { lat: BENGALURU.lat, lng: BENGALURU.lng };
}
