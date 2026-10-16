import { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/context/auth-context";
import { isFeatureEnabled } from "@/services/featureFlagService";

/**
 * Deduplication tracking for Shadow Auth calls
 * Prevents triggering Shadow Auth multiple times for the same session
 * Key format: "userId:sessionId" to handle concurrent sessions
 */
const processedSessions = new Set<string>();

/**
 * Generate a unique key for deduplication
 * Uses userId + hash of first 20 chars of access token
 */
function getSessionKey(supabaseUser: User, session: Session): string {
  const tokenPrefix = session.access_token.substring(0, 20);
  return `${supabaseUser.id}:${tokenPrefix}`;
}

/**
 * Check if Shadow Auth has already been triggered for this session
 */
function isSessionProcessed(supabaseUser: User, session: Session): boolean {
  const key = getSessionKey(supabaseUser, session);
  return processedSessions.has(key);
}

/**
 * Mark session as processed to prevent duplicate triggers
 */
function markSessionProcessed(supabaseUser: User, session: Session): void {
  const key = getSessionKey(supabaseUser, session);
  processedSessions.add(key);
}

/**
 * Cleanup old sessions from tracking (prevent memory leak)
 * Keep only the most recent 100 sessions
 */
function cleanupOldSessions(): void {
  if (processedSessions.size > 100) {
    // Convert to array, keep last 100 entries
    const entries = Array.from(processedSessions);
    const entriesToKeep = entries.slice(-100);

    processedSessions.clear();
    entriesToKeep.forEach((entry) => processedSessions.add(entry));

    console.log(
      "[Shadow Auth] Cleanup: Kept last 100 sessions, cleared",
      entries.length - 100,
    );
  }
}

// Shadow Auth API endpoint
const SHADOW_AUTH_API =
  import.meta.env.VITE_SHADOW_AUTH_API ||
  "https://54yexougxi.execute-api.ap-south-1.amazonaws.com/prod/internal/auth/shadow";

/**
 * Trigger shadow auth migration for Supabase user
 * This sends the user's Supabase ID and access token to the backend
 * for user synchronization. The backend (Go) now handles:
 * - Password hash retrieval from Supabase
 * - Role determination (admin vs super_admin)
 *
 * This is a fire-and-forget operation - errors are logged but don't block the app.
 *
 * Deduplication:
 * - Tracks processed sessions to prevent duplicate API calls
 * - Multiple triggers from getSession/onAuthStateChange/login all handled automatically
 * - Only sends one Shadow Auth request per unique session
 *
 * Feature Flag Check:
 * - Fetches the `shadow_auth_enabled` feature flag from the backend
 * - If disabled, skips the Shadow Auth API call entirely
 * - Uses in-memory caching with 1-hour TTL to minimize API calls
 */
export async function triggerShadowAuth(
  supabaseUser: User | null,
  session: Session | null,
): Promise<void> {
  if (!supabaseUser || !session?.access_token) {
    return;
  }

  // DEDUPLICATION CHECK: Skip if this session was already processed
  if (isSessionProcessed(supabaseUser, session)) {
    console.log(
      "[Shadow Auth] ℹ️ Session already processed for user:",
      supabaseUser.id,
      "- Skipping duplicate trigger",
    );
    return;
  }

  // Mark this session as processed EARLY to prevent duplicate feature flag checks
  // This happens BEFORE the feature flag check to avoid repeated API calls
  markSessionProcessed(supabaseUser, session);

  try {
    // Check feature flag: shadow_auth_enabled
    const shadowAuthEnabled = await isFeatureEnabled("shadow_auth_enabled");

    if (!shadowAuthEnabled) {
      console.log(
        "[Shadow Auth] ⏭️ Shadow auth is DISABLED - skipping API call for user:",
        supabaseUser.id,
      );
      return;
    }

    console.log(
      "[Shadow Auth] Triggering migration for user:",
      supabaseUser.id,
    );
    cleanupOldSessions(); // Cleanup tracking to prevent memory leaks

    // Fire-and-forget - don't await the response
    // Backend handles the full migration (password hash, role determination, etc.)
    fetch(SHADOW_AUTH_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supabaseUserId: supabaseUser.id,
        supabaseAccessToken: session.access_token,
      }),
    })
      .then((response: Response) => {
        if (response.ok) {
          console.log(
            "[Shadow Auth] ✅ Migration initiated for user:",
            supabaseUser.id,
          );
        } else {
          console.warn("[Shadow Auth] Unexpected status:", response.status);
        }
      })
      .catch((error: any) => {
        // Silently fail - user can still use the app
        console.error("[Shadow Auth] Network error (silent):", error.message);
      });
  } catch (error) {
    console.error("[Shadow Auth] Error:", error);
    // Silently fail - user can still use the app
  }
}
