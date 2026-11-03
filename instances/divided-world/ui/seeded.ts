/**
 * The seeded sequence the card effects draw their decoration from: the same seed gives the same numbers on every screen, so every
 * reader sees the same glints or twinkles on the same post, and nobody can tell from them anything that is not public (a play's and a
 * post's ids). Shared by Glitter Bomb and Feelin' Fab so the two never drift into two generators.
 */

/** A small deterministic generator of numbers in [0, 1), seeded from a string. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
