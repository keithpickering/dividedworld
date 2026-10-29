/**
 * The vote math: how a player's reactions become weight.
 *
 * Counted per player, recorded per character (design, section 5). Switching characters to
 * react is a choice of voice, never a way to multiply points, so everything here is keyed by
 * the reacting player and never by the character they reacted through.
 *
 * - The shared vote: a player's reactions on one Act share one vote. One reaction carries the
 *   whole vote; three carry a third each.
 * - Halving across Acts: within a settlement window (the caller passes only the window's
 *   votes), a player's vote on a character's first
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
  /* Keys join ids with NUL, which a Postgres text id cannot hold. */
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
    const i = rank.get(`${pair(v.player, actOf(v.act).character)}\u0000${v.act}`)!;
    return { ...v, votes: v.share * halving ** i };
  });
}

/** What one player has been paid for their vote on one Act: its weight, and each quadrant's share at it. */
export interface PaidVote {
  readonly player: string;
  readonly act: string;
  readonly weight: number;
  readonly shares: Readonly<Record<'excitedPositive' | 'excitedNegative' | 'calmPositive' | 'boredNegative', number>>;
}

const QUADRANT_KEYS = ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'] as const;
type Q = (typeof QUADRANT_KEYS)[number];
/** A difference smaller than any share a reaction count can make is no difference. */
const nothing = (x: number) => Math.abs(x) < 1e-12;

/**
 * One player, one vote per Act, whenever the reactions come (the owner's answer 2, on #4).
 *
 * A player's vote on an Act has one weight, set by the halving in the window of their first
 * reaction there, and is split across quadrants by their reactions' shares. A window pays, for
 * each player and Act its reactions touched, the difference between the shares now and the
 * shares already paid, at that weight: a second reaction in the same quadrant a day later pays
 * nothing more, one in another quadrant moves half the vote from the first to it, and the halving
 * is never earned again by coming back. What is paid is returned, to be stored beside the
 * settlement in the same transaction, so a retried window never pays a difference twice.
 *
 * `reactions` are every reaction on each touched Act up to the window's end, earlier ones
 * included. A vote with nothing recorded as paid is new, however early its first reaction: one
 * made where no window settled it (between seasons) is paid in full now, at this window's
 * halving, rather than stalling every settlement after it. A share added is said by the
 * player's latest reaction in its quadrant in the window; a share taken back, by the mask that
 * held it before the window, so spreading reactions over days never keeps a mask's pay for a vote it moved.
 */
export function payVotes<R extends { readonly act: string; readonly player: string; readonly character: string; readonly quadrant: Q; readonly at: number }>(
  reactions: readonly R[],
  window: { readonly from: number; readonly to: number },
  paid: readonly PaidVote[],
  actOf: (id: string) => { readonly character: string; readonly at: number },
  halving: number,
): { votes: (R & { share: number; votes: number })[]; paid: PaidVote[] } {
  const pairKey = (player: string, act: string) => `${player}\u0000${act}`;
  const before = new Map(paid.map((p) => [pairKey(p.player, p.act), p]));
  const byPair = new Map<string, R[]>();
  for (const r of reactions) {
    if (r.at >= window.to) continue;
    const k = pairKey(r.player, r.act);
    const list = byPair.get(k);
    if (list) list.push(r); else byPair.set(k, [r]);
  }
  const inWindow = (r: R) => r.at >= window.from && r.at < window.to;
  const touched = [...byPair.entries()].filter(([, rs]) => rs.some(inWindow));
  // A vote new in this window takes its weight from this window's halving, among the player's
  // other new votes on the same character's Acts; one paid before keeps the weight it was given.
  const fresh = touched.filter(([k]) => !before.has(k)).map(([, rs]) => ({ act: rs[0]!.act, player: rs[0]!.player, share: 1 }));
  const weightOf = new Map(halveAcrossActs(fresh, actOf, halving).map((v) => [pairKey(v.player, v.act), v.votes]));
  const votes: (R & { share: number; votes: number })[] = [];
  const out: PaidVote[] = [];
  for (const [k, rs] of touched) {
    const prior = before.get(k);
    const weight = prior?.weight ?? weightOf.get(k)!;
    // Shares as plain fractions of the player's reactions there (1, ½, ⅓, ⅔), which sum to one vote exactly.
    const shares = Object.fromEntries(QUADRANT_KEYS.map((q) => [q, rs.filter((r) => r.quadrant === q).length / rs.length])) as Record<Q, number>;
    const byTime = [...rs].sort((a, b) => a.at - b.at);
    const last = byTime.filter(inWindow).at(-1)!;
    const moved = QUADRANT_KEYS.map((q) => ({ q, share: shares[q] - (prior?.shares[q] ?? 0) })).filter((d) => !nothing(d.share));
    // A vote already whole moves, never grows: its differences sum to exactly nothing, so no
    // float dust tips a comparison of what a card or a post drew.
    if (prior && moved.length) moved.at(-1)!.share = -moved.slice(0, -1).reduce((t, d) => t + d.share, 0);
    for (const { q, share } of moved) {
      if (nothing(share)) continue;
      // A share added is said by the latest reaction in its quadrant this window; one taken back,
      // by the mask that held it there before the window (its latest reaction there then), at the
      // moment it was taken back, though another mask has reacted in the quadrant since.
      const held = byTime.filter((r) => r.quadrant === q && r.at < window.from).at(-1) ?? byTime.filter((r) => r.quadrant === q).at(-1);
      const voice = share > 0 ? byTime.filter((r) => inWindow(r) && r.quadrant === q).at(-1) ?? last : { ...(held ?? last), at: last.at };
      votes.push({ ...voice, quadrant: q, share, votes: weight * share });
    }
    out.push({ player: rs[0]!.player, act: rs[0]!.act, weight, shares });
  }
  out.sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : a.act < b.act ? -1 : a.act > b.act ? 1 : 0));
  return { votes, paid: out };
}
