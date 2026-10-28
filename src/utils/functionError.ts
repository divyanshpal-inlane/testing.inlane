/**
 * supabase-js reports a failed edge function as a generic "non-2xx" error; the
 * function's real reason (e.g. a Heltar rejection) is in the response body.
 */
export async function functionErrorReason(err: unknown): Promise<string> {
  try {
    const ctx = (err as { context?: Response }).context;
    if (!ctx) return "";
    const body = (await ctx.clone().json()) as { error?: string };
    return typeof body.error === "string" ? body.error : "";
  } catch {
    return "";
  }
}
