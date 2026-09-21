/**
 * Feature Flag Service
 * Manages fetching and caching of feature flags from the backend
 */

interface FeatureFlags {
  shadow_auth_enabled?: boolean;
  /** When true, login goes through the Go backend instead of Supabase directly. */
  use_go_auth?: boolean;
  [key: string]: any;
}

interface CachedFlags {
  flags: FeatureFlags;
  timestamp: number;
}

// Cache store
let flagCache: CachedFlags | null = null;

// Default TTL: 2 minutes (120000 ms) — short for easy flag testing
const DEFAULT_TTL = 120000;

// Feature Flag API endpoint
// In dev the Vite proxy rewrites /go-api/* → http://localhost:8080/v1/*
// In production set VITE_BACKEND_API to the real Go service base URL (e.g. https://api.inlane.in/v1)
const BACKEND_API = import.meta.env.VITE_BACKEND_API || "/go-api";

const FEATURE_FLAG_API = `${BACKEND_API}/internal/feature-flags`;

// Internal API key for feature flags endpoint.
// In local dev the Go service expects 'local-internal-secret-key'.
// In production set VITE_INTERNAL_API_KEY in your environment.
const INTERNAL_API_KEY =
  import.meta.env.VITE_INTERNAL_API_KEY || "local-internal-secret-key";

// Default flags when Go service is unavailable — falls back to Supabase
const DEFAULT_FLAGS: FeatureFlags = {
  shadow_auth_enabled: false,
  use_go_auth: false,
};

// Timeout for feature flag fetch (in ms) — fail fast in local dev when Go service isn't running
const FETCH_TIMEOUT_MS = 3000;

/**
 * Fetch feature flags from the backend with timeout
 * This function handles the actual API call with a quick timeout
 * so local dev falls back to Supabase fast when Go service isn't running
 */
async function fetchFlagsFromBackend(): Promise<FeatureFlags> {
  // Create an AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    console.log("[Feature Flags] Fetching feature flags from backend...");

    const response = await fetch(FEATURE_FLAG_API, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-internal-key": INTERNAL_API_KEY,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error("[Feature Flags] API returned status:", response.status);
      // Return safe defaults if API fails — use_go_auth=false means Supabase fallback
      return DEFAULT_FLAGS;
    }

    const data = await response.json();
    console.log("[Feature Flags] ✅ Feature flags fetched successfully");

    return data || DEFAULT_FLAGS;
  } catch (error: any) {
    clearTimeout(timeoutId);

    // Check if it's a timeout/abort error
    if (error.name === "AbortError") {
      console.warn(
        "[Feature Flags] ⏱️ Request timed out after",
        FETCH_TIMEOUT_MS,
        "ms — Go service may not be running. Falling back to Supabase.",
      );
    } else {
      console.warn(
        "[Feature Flags] ⚠️ Error fetching feature flags:",
        error.message || error,
        "— Falling back to Supabase.",
      );
    }

    // Return safe defaults if network error — use_go_auth=false means Supabase fallback
    return DEFAULT_FLAGS;
  }
}

/**
 * Check if cache is still valid
 */
function isCacheValid(ttl: number = DEFAULT_TTL): boolean {
  if (!flagCache) {
    return false;
  }

  const age = Date.now() - flagCache.timestamp;
  const isValid = age < ttl;

  if (!isValid) {
    console.log("[Feature Flags] Cache expired, will refresh on next fetch");
  }

  return isValid;
}

/**
 * Get feature flags with caching
 * - Returns cached flags if available and not expired
 * - Otherwise fetches fresh flags from backend
 * - Cache TTL: 1 hour (configurable)
 */
export async function getFeatureFlags(ttl?: number): Promise<FeatureFlags> {
  // Return cached flags if available and valid
  if (isCacheValid(ttl)) {
    console.log("[Feature Flags] Using cached flags");
    return flagCache!.flags;
  }

  // Fetch fresh flags from backend
  const flags = await fetchFlagsFromBackend();

  // Cache the flags
  flagCache = {
    flags,
    timestamp: Date.now(),
  };

  return flags;
}

/**
 * Check if a specific feature flag is enabled
 * Returns true by default if flag is not found (fail-safe)
 */
export async function isFeatureEnabled(
  featureName: keyof FeatureFlags,
  ttl?: number,
): Promise<boolean> {
  const flags = await getFeatureFlags(ttl);
  const isEnabled = flags[featureName] ?? false; // Default to DISABLED if flag not found

  console.log(
    `[Feature Flags] "${featureName}" is ${isEnabled ? "ENABLED" : "DISABLED"}`,
  );
  return isEnabled;
}

/**
 * Clear the feature flag cache
 * Useful for testing or manual cache invalidation
 */
export function clearFlagCache(): void {
  flagCache = null;
  console.log("[Feature Flags] Cache cleared");
}

/**
 * Get cache status (for debugging)
 */
export function getCacheStatus(): {
  isCached: boolean;
  age: number | null;
  flags: FeatureFlags | null;
} {
  return {
    isCached: flagCache !== null,
    age: flagCache ? Date.now() - flagCache.timestamp : null,
    flags: flagCache?.flags || null,
  };
}
