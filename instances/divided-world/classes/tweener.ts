/**
 * The Tweener: splits the room. It earns when a post or card of its own draws hype (excited-positive) and heat
 * (excited-negative) in equal measure, paid on the smaller side, and when its card on another's post sets that post
 * arguing among players who arrived after the card. Each other player is counted once, by their net lean between hype
 * and heat, so one player hedging both ways never pays it. Its weakness is the shrug: calm-positive and bored-negative
 * reactions on its Acts. Design, sections 1 to 4.
 *
 * It also earns when its post sets others debating and it stays out (the Tweener catalyst design). A post's debate is every post that
 * quotes it, transitively, and the spin and posts of each thread another player spun from it. A spark pays `tweener.catalyst` once, under
 * `tweener.litTheFuse`, in the window in which its debate first holds `tweener.catalystVoices` other players of whom
 * `tweener.catalystReturned` posted twice or more, if that moment is within `debateDays` of the spark, the author's player has no post in
 * the debate up to that moment, and the spark is in no debate of an earlier post by the same player. A character's further paying sparks
 * in a window each pay `settings.halving` of the one before, in the order they crossed.
 *
 * And the debate outvotes the nods. For a spark that has paid, while it is handed to the class, the refund standing is `(1 - cushioned)`
 * times the smaller of what the votes standing on the spark cost in shrugs (half a vote's worth for each calm or bored vote, at its
 * weight) and half a vote's worth for each other player with a post in the debate within `debateDays` of the spark. A window pays, under
 * `tweener.outvoted`, the refund standing at its end less the one at its start, which is nothing before the spark has paid. It carries no
 * `votes`, so no cushion reads it: the cut by `cushioned` is what keeps a cushion and the refund from summing past the loss.
 */
import type { ClassInput, ClassRules, EconomyRead, Earning, Quadrant, Settings, SparkedDebate, Standing } from '../../../engine/rules/types.ts';
import { economyOf } from '../../../engine/rules/cards.ts';

/** The Tweener's catalyst numbers, in the order its rule reads them: one list, which its `reads` is too. The floor of 3 on the voices is the design's section 7: no result names a pair of characters. */
const READS: readonly EconomyRead[] = ['tweener.catalyst', { key: 'tweener.catalystVoices', whole: true, min: 3 }, { key: 'tweener.catalystReturned', whole: true, min: 1 }];
const DAY = 86_400_000;
/** What a calm-positive or bored-negative vote costs the Tweener, as a share of a vote: `tweener.shrugged` charges it and the refund counts the allowance in it. */
const HALF = 0.5;

/** The smaller of the hype and heat sides: each vote counted once, by its net lean between the two. */
export function smallerSide(votes: readonly Standing[]): number {
  let hype = 0;
  let heat = 0;
  for (const v of votes) {
    const lean = v.excitedPositive - v.excitedNegative;
    if (lean > 0) hype += lean; else heat -= lean;
  }
  return Math.min(hype, heat);
}
const nothing = (x: number) => Math.abs(x) < 1e-12;
const SHRUG: readonly Quadrant[] = ['calmPositive', 'boredNegative'];

/** The earliest time at which the members so far hold `voices` voices above 0, `returned` of them with two or more posts; null if never. */
export function crossedAt(debate: SparkedDebate, voices: number, returned: number): number | null {
  const posts = new Map<number, number>();
  let back = 0;
  for (const p of debate.posts) {
    if (p.voice === 0) continue;
    const n = (posts.get(p.voice) ?? 0) + 1;
    posts.set(p.voice, n);
    if (n === 2) back += 1;
    if (posts.size >= voices && back >= returned) return p.at;
  }
  return null;
}

/** The time a spark pays at, by its debate alone, or null where it never does: crossed in time, kept out of by the author's player, and in no earlier debate of theirs. */
function paysAt(debate: SparkedDebate, settings: Settings): number | null {
  if (debate.inOwnDebate) return null;
  const [, voices, returned] = READS.map((r) => economyOf(settings, typeof r === 'string' ? r : r.key)) as [number, number, number];
  const at = crossedAt(debate, voices, returned);
  if (at === null || at - debate.at >= settings.debateDays * DAY) return null;
  return debate.posts.some((p) => p.voice === 0 && p.at <= at) ? null : at;
}

/** What a vote standing costs in shrugs: half a vote's worth for each calm or bored vote, at its weight. */
const shrugLoss = (standing: readonly Standing[], settings: Settings) =>
  standing.reduce((t, v) => t + HALF * settings.vote * (v.calmPositive + v.boredNegative), 0);

/** The refund standing at `upTo` (a stretch is open at its start, so a spark crossing at `upTo` has not yet paid): nothing before the spark has paid. */
export function refundAt(debate: SparkedDebate, upTo: number, standing: readonly Standing[], settings: Settings): number {
  const paid = paysAt(debate, settings);
  if (paid === null || paid >= upTo) return 0;
  const voices = new Set(debate.posts.filter((p) => p.voice !== 0 && p.at <= upTo && p.at - debate.at < settings.debateDays * DAY).map((p) => p.voice)).size;
  /* Floored to a whole ledger unit (`settle` rounds each line to a whole unit): a cushion's line rounds up by at most a half, and the floor here
     gives that back, so a window's cushion, refund and shrugs never sum past the loss. Tidied first, so 10.499999 of float noise is not 10. */
  const standingNow = (1 - debate.cushioned) * Math.min(shrugLoss(standing, settings), voices * HALF * settings.vote);
  return Math.floor(Math.round(standingNow * 1e6) / 1e6);
}

export const tweener: ClassRules = {
  key: 'tweener',
  name: 'Tweener',
  reads: READS,
  earn: (input, settings) => [
    ...input.standings
      .map((s): Earning => ({ reason: 'tweener.splitTheRoom', amount: settings.vote * 2 * (smallerSide(s.now) - smallerSide(s.before)), act: s.act, at: s.at }))
      .filter((e) => !nothing(e.amount)),
    ...input.cardsPlayed
      .flatMap((c) => (c.onOthers && c.drawnAfter ? [{ card: c, drawn: c.drawnAfter }] : []))
      .map(({ card, drawn }): Earning => ({ reason: 'tweener.stirredThePot', amount: settings.vote * 2 * smallerSide(drawn.now), act: card.act, at: drawn.at }))
      .filter((e) => !nothing(e.amount)),
    ...input.received
      .filter((r) => SHRUG.includes(r.quadrant))
      .map((r): Earning => ({ reason: 'tweener.shrugged', amount: -HALF * settings.vote * r.votes, act: r.act, quadrant: r.quadrant, at: r.at, kind: r.kind, votes: r.votes })),
    ...fuse(input, settings),
  ],
};

function fuse(input: ClassInput, settings: Settings): Earning[] {
  const [catalyst, voices, returned] = READS.map((r) => economyOf(settings, typeof r === 'string' ? r : r.key)) as [number, number, number];
  const lit = input.debates
    .map((debate) => ({ debate, at: paysAt(debate, settings) }))
    .filter((x): x is { debate: SparkedDebate; at: number } => x.at !== null && x.at >= input.from && x.at < input.to)
    .sort((x, y) => x.at - y.at || (x.debate.act < y.debate.act ? -1 : x.debate.act > y.debate.act ? 1 : 0));
  const outvoted = input.debates
    .map((d): Earning => {
      const inside = d.posts.filter((p) => p.at <= input.to);
      const latest = inside[inside.length - 1]?.at ?? input.to;
      return { reason: 'tweener.outvoted', amount: refundAt(d, input.to, d.standing.now, settings) - refundAt(d, input.from, d.standing.before, settings), act: d.act, at: latest >= input.from ? latest : input.to };
    })
    .filter((e) => !nothing(e.amount));
  return [
    ...lit.map(({ debate, at }, i): Earning => ({ reason: 'tweener.litTheFuse', amount: catalyst * settings.halving ** i, act: debate.act, at, params: { 'tweener.catalystVoices': voices, 'tweener.catalystReturned': returned, debateDays: settings.debateDays } })),
    ...outvoted,
  ];
}
