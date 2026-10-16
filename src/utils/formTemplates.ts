const cache = new Map<string, ArrayBuffer>();

/** Load a public PDF template once and reuse it across bulk generation. */
export async function loadPdfTemplate(
  url: string,
  label: string,
): Promise<ArrayBuffer> {
  const hit = cache.get(url);
  if (hit) return hit.slice(0);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${label}`);
  const bytes = await res.arrayBuffer();
  cache.set(url, bytes);
  return bytes.slice(0);
}
