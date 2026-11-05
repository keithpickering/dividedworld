/**
 * The posting pool's daily pick (the staff roster design, sections 4 to 6; its plan, Task 9), in plain code. Three steps, none of
 * them a model's:
 *
 *   candidates(signals, roster, memories, phase, ctx)   who has a reason to post today, and about what
 *   priority(tally)                                      how loudly the crowd answers a persona's posts
 *   pick(candidates, priorities, allowance, ...)         who posts, at most once each, up to the day's allowance
 *
 * Every input is public play. The signals are `pool_signals` (supabase/migrations/0086_pool_signals.sql), which the digest role
 * computes without who owns a character, a class or who reacted; a persona's memory and office are facts about a staff character,
 * who has no owner. Nothing here reads a private fact ("A response never proves a private fact"). A seeded random number breaks
 * ties, seeded from the day, so a run repeated on the same day picks the same.
 *
 * Portable by construction: no vendor client is imported, and the engine knows no instance.
 */
import type { PoolSettings, Persona, Settings } from '../rules/types.ts';
import type { Memory } from './memory.ts';
import { phaseAt, type SeasonSpan } from './phases.ts';

/** The design's eight triggers (section 6), a fixed list: adding one is engine work in a plan. */
export const TRIGGERS = ['named', 'quoted', 'legacy', 'successorStumbles', 'oldFlame', 'homeTurf', 'seasonTurn', 'hotOnBeat'] as const;
export type PoolTrigger = (typeof TRIGGERS)[number];

/** The engine's default strengths: the first five outrank the last three. An instance's settings may carry any whole number from 1. */
export const DEFAULT_STRENGTHS: Readonly<Record<PoolTrigger, number>> = Object.freeze({
  named: 5, quoted: 5, legacy: 5, successorStumbles: 5, oldFlame: 5, homeTurf: 2, seasonTurn: 2, hotOnBeat: 2,
});

/* ----------------------------------------------------------------------------------------------------- the signals ---- */

/** A post in the window that names, or replies to a post of, a persona (`named`, `quoted`); `n` is the persona's total before the cap of five newest. */
export interface PostSignal { readonly staff: string; readonly act: string; readonly thread: string; readonly n: number }

/** A move ended or kept that is not the current Boss's own making (`legacy`): `staff` its owner at the Act, `maker` the writer. */
export interface LegacySignal {
  readonly staff: string;
  readonly maker: string;
  readonly move: string;
  readonly act: string;
  /** The end's reason (met, expired, reversed, superseded, spent) or `kept`. */
  readonly how: string;
  readonly n: number;
}

/** An admin's reversal of one of the current Boss's moves. */
export interface ReversalSignal { readonly staff: string; readonly move: string; readonly act: string }

/** A season handover that landed in the window. */
export interface HandoverSignal {
  readonly season: number;
  readonly outgoing: string | null;
  readonly boss: string | null;
  readonly how: string;
  readonly at: string;
}

/** One of the window's hottest threads. `boardMaker` is null until an Act records a board's creation. */
export interface HotSignal {
  readonly thread: string;
  readonly board: string;
  readonly heat: number;
  readonly starter: string | null;
  readonly starterStaff: string | null;
  readonly staffStarted: boolean;
  readonly authors: readonly { readonly character: string; readonly posts: number }[];
  readonly boardMaker: string | null;
}

/** A persona's posts in the last `priorityDays` and the public tallies on them. */
export interface TallySignal { readonly staff: string; readonly posts: number; readonly reactions: number }

/** What `pool_signals(since, until)` returns, as its migration documents it. */
export interface PoolSignals {
  readonly named: readonly PostSignal[];
  readonly quoted: readonly PostSignal[];
  readonly legacy: readonly LegacySignal[];
  readonly reversals: readonly ReversalSignal[];
  readonly handovers: readonly HandoverSignal[];
  readonly hot: readonly HotSignal[];
  readonly tallies: readonly TallySignal[];
}

/* ---------------------------------------------------------------------------------------------------- candidates ---- */

/** A reason for a persona to post: where, about which post (if any), and the Act that set it off (if any). */
export interface Candidate {
  readonly staff: string;
  readonly trigger: PoolTrigger;
  /** The thread the reply goes in; null where the trigger has no thread (a move ended, a handover, a stumble). */
  readonly thread: string | null;
  /** The post the reply quotes; null where the trigger is not a post. */
  readonly quoting: string | null;
  /** The Act that set it off, a post or a move's end, a keep, a reversal; null where none did. */
  readonly act: string | null;
}

/** The season and the window `successorStumbles` reads, with the two staff it turns on. */
export interface PoolPhase {
  readonly season: SeasonSpan;
  /** The window, in epoch milliseconds: [since, until). */
  readonly since: number;
  readonly until: number;
  readonly settings: Pick<Settings, 'phases'>;
  /** The staff key of the current Boss, and of the Boss before it (whom the Boss's stumble touches); either may be null. */
  readonly boss: string | null;
  readonly predecessor: string | null;
}

/** What the pick knows about the board that the signals do not carry. */
export interface PoolContext {
  /** Each persona's office now (`staff_office_now`): boss, mod, member, benched or waiting. */
  readonly offices: Readonly<Record<string, string>>;
  /** A board's id, as `hot` names it, to its slug, as `persona.beats` names it. */
  readonly boards: Readonly<Record<string, string>>;
  /** A persona's staff key to its character's id, as `hot.authors` and memory opinions name characters. */
  readonly characters: Readonly<Record<string, string>>;
}

/** The offices whose posts the pool pays for: every one that writes. A waiting persona is not debuted, a benched one is silent. */
export const POSTING_OFFICES: readonly string[] = ['boss', 'mod', 'member'];

/** An opinion at or above this is a favorite for `oldFlame`; a grudge is any grudge the memory holds. */
export const FAVORITE_SCORE = 3;

export function candidates(
  signals: PoolSignals,
  roster: readonly Persona[],
  memories: Readonly<Record<string, Memory | undefined>>,
  phase: PoolPhase,
  ctx: PoolContext,
): Candidate[] {
  const byKey = new Map(roster.map((p) => [p.key, p]));
  const writes = (key: string | null | undefined): key is string => key != null && byKey.has(key) && POSTING_OFFICES.includes(ctx.offices[key] ?? '');
  const out: Candidate[] = [];
  const add = (staff: string | null | undefined, trigger: PoolTrigger, thread: string | null, quoting: string | null, act: string | null) => {
    if (writes(staff)) out.push({ staff, trigger, thread, quoting, act });
  };

  for (const s of signals.named) add(s.staff, 'named', s.thread, s.act, s.act);
  for (const s of signals.quoted) add(s.staff, 'quoted', s.thread, s.act, s.act);
  // Legacy is the maker's: the persona that wrote the move in an earlier reign, whoever owns it now.
  for (const s of signals.legacy) add(s.maker, 'legacy', null, null, s.act);

  // Successor stumbles is the Boss before the current one watching it fall: the current Boss entering its meltdown inside the window,
  // or an admin reversing one of its moves.
  if (phase.predecessor !== null && phase.predecessor !== phase.boss) {
    const bossPersona = phase.boss === null ? undefined : byKey.get(phase.boss);
    const at = (t: number) => phaseAt(phase.season, t, phase.settings, bossPersona).phase;
    if (phase.until > phase.since && at(phase.since) !== 'meltdown' && at(phase.until - 1) === 'meltdown') {
      add(phase.predecessor, 'successorStumbles', null, null, null);
    }
    for (const r of signals.reversals) add(phase.predecessor, 'successorStumbles', null, null, r.act);
  }

  // Season turn: a handover. The outgoing Boss, now a member, has a say; the arriving Boss's announcement is a duty and not the pool's.
  for (const h of signals.handovers) add(h.outgoing, 'seasonTurn', null, null, null);

  for (const hot of signals.hot) {
    const authors = new Set(hot.authors.map((a) => a.character));
    // Home turf: a thread a persona started, or a board it made, is hot.
    if (hot.staffStarted) add(hot.starterStaff, 'homeTurf', hot.thread, null, null);
    add(hot.boardMaker, 'homeTurf', hot.thread, null, null);
    // Old flame: a character its memory names as a favorite or a grudge wrote one of the day's hottest posts (and it is not its own).
    for (const p of roster) {
      const m = memories[p.key];
      if (!m) continue;
      const own = ctx.characters[p.key];
      const flames = new Set([...m.opinions.filter((o) => o.score >= FAVORITE_SCORE).map((o) => o.character), ...m.grudges.map((g) => g.character)]);
      if ([...flames].some((c) => c !== own && authors.has(c))) add(p.key, 'oldFlame', hot.thread, null, null);
    }
    // Hot on its beat: a thread on a board of its beats is among the day's hottest.
    const slug = ctx.boards[hot.board];
    if (slug !== undefined) for (const p of roster) if (p.beats.includes(slug)) add(p.key, 'hotOnBeat', hot.thread, null, null);
  }

  const seen = new Set<string>();
  return out.filter((c) => {
    const k = JSON.stringify([c.staff, c.trigger, c.thread, c.quoting, c.act]);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------------------------------------------ priority ---- */

/** A persona with fewer posts than this in the window has too little history to rank: it counts as new. */
export const NEW_POSTS_BELOW = 3;

/**
 * The least a priority scores as, so a trigger's strength still counts for a persona the crowd ignores (or one with no history), whose
 * reactions per post would otherwise make every score zero and every strength moot: one reaction a post, a modest crowd.
 */
export const PRIORITY_FLOOR = 1;

export interface Priority {
  /** Reactions per post, every kind of reaction counted alike; 0 for a persona with no posts. */
  readonly value: number;
  /** Fewer than `NEW_POSTS_BELOW` posts in the window. */
  readonly isNew: boolean;
}

export function priority(tally: { readonly posts: number; readonly reactions: number }): Priority {
  const posts = Math.max(tally.posts, 0);
  return { value: posts > 0 ? Math.max(tally.reactions, 0) / posts : 0, isNew: posts < NEW_POSTS_BELOW };
}

/** Each persona's priority, by staff key, from `pool_signals`'s tallies. */
export function priorities(tallies: readonly TallySignal[]): Record<string, Priority> {
  return Object.fromEntries(tallies.map((t) => [t.staff, priority(t)]));
}

/* ----------------------------------------------------------------------------------------------------- allowance ---- */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Today's posts: what is left of the week's pool over the days left in the week (Monday to Sunday, UTC, today counted), rounded down,
 * and never below 0. A spent week gives 0; the remainder a floor leaves rolls into the days after.
 */
export function allowance(spentThisWeek: number, weekly: number, today: number): number {
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const daysLeft = 7 - sinceMonday;
  return Math.max(Math.floor((weekly - spentThisWeek) / daysLeft), 0);
}

/** The UTC day of an instant, `YYYY-MM-DD`: what `pool_spends` keys a day by and `dayRng` seeds from. */
export function dayOf(now: number): string {
  return new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------------------------------------------- rng ---- */

/** A random number generator in [0, 1): mulberry32 over a string's hash (xmur3), so the same seed gives the same sequence anywhere. */
export function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The generator for a day, so a rerun on the same day picks the same. */
export const dayRng = (day: string): (() => number) => seededRng(`kayfabb-pool:${day}`);

/* ------------------------------------------------------------------------------------------------------------- pick ---- */

export interface PoolPick {
  readonly staff: string;
  readonly trigger: PoolTrigger;
  readonly thread: string | null;
  readonly quoting: string | null;
  readonly act: string | null;
  /** This post starts a thread (the day's highest scorer, while the week has a thread left). `thread` and `quoting` are its reply, should no board serve. */
  readonly startThread: boolean;
  /** The post may carry a card play, which costs one more slot of the pool: set on the top scorers, as many as slots remain. */
  readonly cardSlot: boolean;
}

/** What the pick reads of the pool's settings. */
export type PoolPickSettings = Pick<PoolSettings, 'strengths' | 'holdback'>;

export interface Picked {
  readonly picks: readonly PoolPick[];
  /** What remains of the day's allowance after the posts: the slots cards may take. */
  readonly cardSlots: number;
}

const key = (s: string | null) => s ?? '';

export function pick(
  cands: readonly Candidate[],
  priorityOf: Readonly<Record<string, Priority | undefined>>,
  allowanceToday: number,
  threadsLeft: number,
  rng: () => number,
  pool: PoolPickSettings,
): Picked {
  const slots = Math.max(Math.floor(allowanceToday), 0);
  // The candidates in a fixed order, each given its tie-breaker from the one generator, so the same day and the same candidates pick
  // the same whatever order they arrive in.
  const ordered = [...cands].sort((a, b) => key(a.staff).localeCompare(key(b.staff)) || a.trigger.localeCompare(b.trigger)
    || key(a.thread).localeCompare(key(b.thread)) || key(a.quoting).localeCompare(key(b.quoting)) || key(a.act).localeCompare(key(b.act)));
  const scored = ordered.map((c) => {
    const p = priorityOf[c.staff];
    return { c, tie: rng(), isNew: p === undefined ? true : p.isNew, score: (pool.strengths[c.trigger] ?? 0) * Math.max(p?.value ?? 0, PRIORITY_FLOOR) };
  });
  const better = (a: (typeof scored)[number], b: (typeof scored)[number]) => b.score - a.score || b.tie - a.tie;
  // One per persona: its best candidate.
  const best = new Map<string, (typeof scored)[number]>();
  for (const s of scored) {
    const held = best.get(s.c.staff);
    if (!held || better(s, held) < 0) best.set(s.c.staff, s);
  }
  const ranked = [...best.values()].sort(better);
  // The holdback: a share of the day's posts goes to personas with little history first; what none of them fills goes back to the rest.
  const reserve = Math.min(Math.ceil(slots * pool.holdback), slots);
  const fromNew = ranked.filter((s) => s.isNew).slice(0, reserve);
  const taken = new Set(fromNew);
  const chosen = [...fromNew, ...ranked.filter((s) => !taken.has(s)).slice(0, slots - fromNew.length)].sort(better);
  const cardSlots = slots - chosen.length;
  const picks = chosen.map((s, i): PoolPick => ({
    staff: s.c.staff, trigger: s.c.trigger, thread: s.c.thread, quoting: s.c.quoting, act: s.c.act,
    startThread: i === 0 && threadsLeft > 0,
    cardSlot: i < cardSlots,
  }));
  return { picks, cardSlots };
}
