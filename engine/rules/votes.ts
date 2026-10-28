/**
 * The vote math: how a player's reactions become weight.
 *
 * Counted per player, recorded per character (design, section 5). Switching characters to
 * react is a choice of voice, never a way to multiply points, so everything here is keyed by
 * the reacting player and never by the character they reacted through.
 *
 * - The shared vote: a player's reactions on one Act share one vote. One reaction carries the
 *   whole vote; three carry a third each.
 * - Halving across Acts: within a settlement window, a player's vote on a character's first
 *   Act counts in full, and each further Act by that character counts half the one before.
 *   "First" is the order the Acts were made, so the weight never depends on the order a
 *   player happened to react in; Acts made at the same instant are ordered by id.
 */

/** Each reaction with its share of its player's one vote on its Act. */
export function shareVotes<R extends { readonly act: string; readonly player: string }>(reactions: readonly R[]): (R & { share: number })[] {
  const counts = new Map<string, number>();
  const key = (r: R) => `${r.player}\u0000${r.act}`;
  for (const r of reactions) counts.set(key(r), (counts.get(key(r)) ?? 0) + 1);
  return reactions.map((r) => ({ ...r, share: 1 / (counts.get(key(r)) ?? 1) }));
}

/**
 * Each share times its halving: per player and per target character, the Acts the player
 * voted on, in the order they were made, weigh 1, `halving`, `halving`², and so on.
 */
export function halveAcrossActs<R extends { readonly act: string; readonly player: string; readonly share: number }>(
  votes: readonly R[],
  actOf: (id: string) => { readonly character: string; readonly at: number },
  halving: number,
): (R & { votes: number })[] {
  const actsBy = new Map<string, Set<string>>();
  const pair = (player: string, character: string) => `${player}\u0000${character}`;
  for (const v of votes) {
    const k = pair(v.player, actOf(v.act).character);
    const set = actsBy.get(k) ?? new Set<string>();
    set.add(v.act);
    actsBy.set(k, set);
  }
  const rank = new Map<string, number>();
  for (const [k, set] of actsBy) {
    const ordered = [...set].sort((a, b) => actOf(a).at - actOf(b).at || (a < b ? -1 : a > b ? 1 : 0));
    ordered.forEach((act, i) => rank.set(`${k}\u0000${act}`, i));
  }
  return votes.map((v) => {
    const i = rank.get(`${pair(v.player, actOf(v.act).character)}\u0000${v.act}`) ?? 0;
    return { ...v, votes: v.share * halving ** i };
  });
}
