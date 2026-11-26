/**
 * A hash (FNV-1a) of ids, so a play's id (public) gives the same number for every reader and on every replay. The effect seeds its settle sound's picks the same
 * way (Effect.tsx).
 */
export function seedOfIds(ids: readonly string[]): number {
  let h = 2166136261;
  for (const ch of ids.join('|')) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}
