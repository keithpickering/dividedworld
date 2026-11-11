/**
 * The filler's generator (docs/plans/2026-11-11-system-rehearsal-design.md, section 3). Pure and seeded: the same scenario, day
 * and world make the same actions. It reads the public world the rehearsal reads back each day and never The System's moves, so a
 * demand is met only by chance. It avoids every refusal the SQL would give (a reaction to one's own post, or to a post by another
 * of one's own player's characters, or twice by one player), so the report is not full of them.
 *
 * `postsPerDay` on a Scenario is the instance's default filler volume for a cast; the generator draws each character's posts from
 * its own sketch's bounds, which are the finer grain.
 */
import type { ReactionKind } from '../rules/types.ts';
import type { RehearsalCorpus, Scenario, Sketch } from './types.ts';

export const MINUTE = 60_000;
export const DAY_MS = 86_400_000;

export interface CastCharacter { readonly sketch: string; readonly name: string; readonly pronouns?: string; readonly classKey: string }
export interface CastPlayer { readonly player: string; readonly characters: readonly CastCharacter[] }

/** The public state of the board as the rehearsal reads it back at a day's first minute. Times are epoch milliseconds. */
export interface World {
  /** The day's first minute. */
  readonly dayStart: number;
  readonly reactions: readonly ReactionKind[];
  readonly characters: readonly { readonly id: string; readonly name: string; readonly player: string; readonly sketch: string }[];
  readonly threads: readonly { readonly id: string; readonly board: string; readonly title: string }[];
  readonly posts: readonly { readonly act: string; readonly thread: string; readonly character: string; readonly at: number }[];
}

/** A runAction body (`startThread`, `post` or `react`) due at a moment, for a player. */
export interface TimedAction { readonly at: number; readonly player: string; readonly request: Record<string, unknown> }

type Rng = () => number;

/** mulberry32. */
const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rngFor = (seed: number, day: number): Rng => mulberry32((seed + Math.imul(day + 1, 0x9e3779b1)) >>> 0);

const int = (r: Rng, least: number, most: number): number => least + Math.floor(r() * (most - least + 1));
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
const weighted = <T>(r: Rng, xs: readonly T[], weight: (x: T) => number): T => {
  const total = xs.reduce((s, x) => s + weight(x), 0);
  let at = r() * total;
  for (const x of xs) { at -= weight(x); if (at < 0) return x; }
  return xs[xs.length - 1] as T;
};

/** The players and their characters: sketches handed out in order, each used once, each character's class its sketch's. */
export function castFor(scenario: Scenario, corpus: RehearsalCorpus): CastPlayer[] {
  const r = rngFor(scenario.seed, -1);
  let next = 0;
  const out: CastPlayer[] = [];
  for (let p = 0; p < scenario.players; p++) {
    const n = int(r, scenario.charactersPerPlayer.least, scenario.charactersPerPlayer.most);
    const characters: CastCharacter[] = [];
    for (let i = 0; i < n; i++) {
      const s = corpus.sketches[next++];
      if (!s) throw new Error(`castFor: scenario ${scenario.key} needs more than the corpus's ${corpus.sketches.length} sketches`);
      characters.push({ sketch: s.key, name: s.name, ...(s.pronouns ? { pronouns: s.pronouns } : {}), classKey: s.classKey });
    }
    out.push({ player: `player-${p + 1}`, characters });
  }
  return out;
}

/** Relative weight of each hour of the day (UTC): quiet small hours, an evening peak. */
const DAY_CURVE = [2, 1, 1, 1, 1, 1, 2, 3, 4, 4, 5, 5, 6, 6, 6, 7, 8, 9, 11, 13, 14, 13, 9, 5];
const momentIn = (r: Rng, dayStart: number): number => {
  const hour = weighted(r, DAY_CURVE.map((w, h) => ({ w, h })), (x) => x.w).h;
  return dayStart + hour * 60 * MINUTE + Math.floor(r() * 60) * MINUTE;
};

const fill = (line: string, slots: Record<string, string>): string => line.replace(/\{(name|interest|board)\}/g, (_, k: string) => slots[k] ?? '');

const isNegative = (k: ReactionKind): boolean => k.quadrant === 'excitedNegative' || k.quadrant === 'boredNegative';

/** One day's filler. `day` is the run's day number (1 is the first); it seeds the draw with the scenario's seed. */
export function dayActions(world: World, corpus: RehearsalCorpus, scenario: Scenario, day: number): TimedAction[] {
  const r = rngFor(scenario.seed, day);
  const sketchOf = new Map<string, Sketch>(corpus.sketches.map((s) => [s.key, s]));
  const charOf = new Map(world.characters.map((c) => [c.id, c]));
  const boards = Object.keys(corpus.openers).filter((b) => (corpus.openers[b]?.length ?? 0) > 0).sort();
  const out: TimedAction[] = [];

  const feuding = (a: string, b: string): boolean => (sketchOf.get(a)?.feuds.includes(b) ?? false) || (sketchOf.get(b)?.feuds.includes(a) ?? false);
  const postersIn = new Map<string, string[]>();
  for (const p of world.posts) postersIn.set(p.thread, [...(postersIn.get(p.thread) ?? []), p.character]);
  const boardOf = new Map(world.threads.map((t) => [t.id, t.board]));

  for (const c of world.characters) {
    const sk = sketchOf.get(c.sketch);
    if (!sk) continue;
    const n = int(r, sk.postsPerDay.least, sk.postsPerDay.most);
    for (let i = 0; i < n; i++) {
      const at = momentIn(r, world.dayStart);
      const interest = sk.interests.length ? pick(r, sk.interests) : '';
      if (boards.length && (world.threads.length === 0 || r() < 0.12)) {
        const board = pick(r, boards);
        const o = pick(r, corpus.openers[board]!);
        out.push({ at, player: c.player, request: { action: 'startThread', board, character: c.id, title: o.title, body: o.body } });
        continue;
      }
      if (!world.threads.length) continue;
      const others = (t: { id: string }) => (postersIn.get(t.id) ?? []).map((id) => charOf.get(id)).filter((x) => x && x.id !== c.id);
      const thread = weighted(r, world.threads, (t) => {
        const people = others(t);
        const hasFeud = people.some((x) => x && feuding(sk.key, x.sketch));
        const likes = interest !== '' && sk.interests.some((w) => t.title.toLowerCase().includes(w.toLowerCase()));
        return 1 + (hasFeud ? 3 : 0) + (likes ? 3 : 0);
      });
      const people = others(thread);
      const foes = people.filter((x) => x && feuding(sk.key, x.sketch));
      const target = foes.length ? pick(r, foes) : people.length ? pick(r, people) : pick(r, world.characters.filter((x) => x.id !== c.id));
      const lines = foes.length ? corpus.disagreeing : r() < 0.4 ? corpus.agreeing : corpus.replies;
      if (!target || !lines.length) continue;
      const body = fill(pick(r, lines), { name: target.name, interest, board: boardOf.get(thread.id) ?? '' });
      out.push({ at, player: c.player, request: { action: 'post', thread: thread.id, character: c.id, body } });
    }
  }

  // Reactions lean by feud, to the posts of the day before, from other players' characters, once per player per post.
  const recent = world.posts.filter((p) => p.at >= world.dayStart - DAY_MS && p.at < world.dayStart);
  const positive = world.reactions.filter((k) => !isNegative(k));
  const negative = world.reactions.filter(isNegative);
  for (const post of recent) {
    const author = charOf.get(post.character);
    if (!author) continue;
    const pool = world.characters.filter((c) => c.player !== author.player);
    const want = Math.min(int(r, scenario.reactionsPerPost.least, scenario.reactionsPerPost.most), new Set(pool.map((c) => c.player)).size);
    const byPlayer = new Map<string, typeof pool>();
    for (const c of pool) byPlayer.set(c.player, [...(byPlayer.get(c.player) ?? []), c]);
    const players = [...byPlayer.keys()].sort();
    for (let i = 0; i < want; i++) {
      const p = players.splice(Math.floor(r() * players.length), 1)[0]!;
      const mine = byPlayer.get(p)!;
      const reactor = weighted(r, mine, (c) => (feuding(c.sketch, author.sketch) ? 4 : 1));
      const kinds = feuding(reactor.sketch, author.sketch) ? negative : positive;
      if (!kinds.length) continue;
      out.push({ at: momentIn(r, world.dayStart), player: p, request: { action: 'react', act: post.act, character: reactor.id, kind: pick(r, kinds).key } });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}
