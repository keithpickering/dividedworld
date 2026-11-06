/**
 * A small seeded generator for the shine's engine layers: the same string always gives the same sequence, and nothing
 * here reads `Math.random`, so a post's foil and flakes look the same on every device and every visit.
 * The string is hashed (FNV-1a), then mixed per call; the shape is the approved bench's `rng`
 * (docs/research/2026-11-06-shine-bench).
 *
 * Engine code: it names no card and no instance.
 */
export function seededRng(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
