// src/utils/googleMaps.ts

/**
 * Single Google Maps JS API loader for the whole app.
 *
 * We deliberately do NOT use `@googlemaps/js-api-loader`'s `Loader` here: it
 * is the deprecated v1 loader and waits on Google's legacy `__onCallback`
 * global. With `version: "weekly"` Google now serves a bootstrap-only build
 * that never fires that callback, so `Loader.load()` re-injects the script
 * forever — we measured 18 <script> tags and "Google Maps JavaScript API has
 * been loaded multiple times" on a single route, plus
 * "Loader.provide not called by module 'onion'" rejections.
 *
 * Instead we inject the script exactly once ourselves and resolve by polling
 * for the real constructors. `window.google.maps` exists as an empty namespace
 * *before* Google attaches its classes, so a truthy check is not sufficient —
 * `new maps.Map()` throws "maps.Map is not a constructor" on that stub.
 */

type MapsNs = typeof google.maps & Record<string, unknown>;

const API_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim();
// `places` is deliberately NOT requested here. Measured against the live API,
// adding it takes the bootstrap from 308 KB to 1339 KB (4.3x) on every map page
// load, and nothing needs it at boot: all three autocomplete call sites already
// `importLibrary("places")` on demand and gate on their own `placesReady` flag.
// `geometry` costs only ~7 KB and keeps distance/haversine helpers available.
const LIBRARIES = "geometry";
const SCRIPT_ATTR = "data-inlane-google-maps";
const READY_TIMEOUT_MS = 20000;
const POLL_MS = 100;

let injectPromise: Promise<void> | null = null;

/**
 * The API is ready when `google.maps.Map` is an actual constructor, plus any
 * extra symbols the caller needs (e.g. `["Polygon", "Circle"]`).
 */
function mapsReady(need: string[] = []): MapsNs | null {
  const gm = (
    typeof window !== "undefined" ? window.google?.maps : undefined
  ) as MapsNs | undefined;
  if (!gm || typeof gm.Map !== "function") return null;
  if (need.some((k) => typeof gm[k] !== "function")) return null;
  return gm;
}

function injectScript(): Promise<void> {
  if (injectPromise) return injectPromise;
  injectPromise = new Promise<void>((resolve, reject) => {
    // Another loader (or a previous HMR pass) may have added it already.
    if (document.querySelector(`script[${SCRIPT_ATTR}]`)) return resolve();

    const s = document.createElement("script");
    s.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(API_KEY)}` +
      `&libraries=${LIBRARIES}&v=weekly`;
    s.async = true;
    s.defer = true;
    s.setAttribute(SCRIPT_ATTR, "1");
    s.addEventListener("error", () => {
      // Allow a later caller to retry rather than memoise the failure.
      injectPromise = null;
      reject(new Error("Google Maps script failed to load"));
    });
    document.head.appendChild(s);
    resolve();
  });
  return injectPromise;
}

async function waitForMaps(need: string[]): Promise<MapsNs | null> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    const gm = mapsReady(need);
    if (gm) return gm;
    if (Date.now() > deadline) return null;
    await new Promise((r) => window.setTimeout(r, POLL_MS));
  }
}

export const googleMapsLoader = {
  /**
   * Resolves `google.maps`, NOT `google`. Using this and treating the result as
   * `google.maps` silently yields undefined for everything (`maps.places`,
   * `maps.Map`, ...) because those live one level down.
   *
   * @param need extra symbols that must be ready (e.g. `["Polygon", "Circle"]`).
   */
  async loadMaps(need: string[] = []): Promise<MapsNs> {
    const already = mapsReady(need);
    if (already) return already;

    await injectScript();
    const gm = await waitForMaps(need);
    if (gm) return gm;
    throw new Error(
      need.length
        ? `Google Maps failed to load (missing: ${need.join(", ")})`
        : "Google Maps failed to load",
    );
  },
  /**
   * Resolves the `google` namespace. Kept for existing callers that do
   * `const google = await load()` and then use `google.maps.*`.
   */
  async load(): Promise<typeof google> {
    await this.loadMaps();
    return window.google as typeof google;
  },
  /**
   * Resolves a single named sub-library. `places` is fetched here on demand
   * because the bootstrap script above no longer requests it (see LIBRARIES).
   *
   * The sub-library must NOT be passed to `loadMaps`'s `need` list: that list
   * asserts `typeof ns[name] === "function"` because it is meant for
   * *constructors* such as `Polygon`. `google.maps.places` is a namespace
   * object, so it fails that check forever, `waitForMaps` polls out after 20s
   * and `loadMaps` rejects — which silently left every Places autocomplete in
   * the app unattached (geocoding kept working, so the search "looked" fine
   * while no suggestion dropdown ever appeared).
   */
  async importLibrary<T = unknown>(lib: "places" | "geometry"): Promise<T> {
    const gm = await this.loadMaps();
    const ns = gm as Record<string, unknown>;

    // Prefer Google's own resolution, then fall back to polling the namespace,
    // which is sometimes attached a tick after the script reports ready.
    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      if (typeof gm.importLibrary === "function") {
        const libNs = (await gm.importLibrary(lib as never)) as T | undefined;
        if (libNs) return libNs;
      } else if (ns[lib]) {
        return ns[lib] as T;
      }
      if (Date.now() > deadline) break;
      await new Promise((r) => window.setTimeout(r, POLL_MS));
    }
    throw new Error(`Google Maps library "${lib}" failed to load`);
  },
};
