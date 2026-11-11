/**
 * The filler's generator (docs/plans/2026-11-11-system-rehearsal-design.md, section 3). Pure and seeded: the same scenario, day
 * and world make the same actions. It reads the public world the rehearsal reads back each day and never The System's moves, so a
 * demand is met only by chance. It avoids every refusal the SQL would give (a reaction to one's own post, or to a post by another
 * of one's own player's characters, or twice by one player), so the report is not full of them.
 *
 * Cost of a day: about O(actions + posts in the reaction window + threads x sketches). The thread to poster and player to characters
 * maps are built once, a thread's weight is computed once per (sketch, thread), and no step filters the whole cast per post.
 *
 * `postsPerDay` on a Scenario is the instance's default filler volume for a cast; the generator draws each character's posts from
 * its own sketch's bounds, which are the finer grain.
 */
import type { ReactionKind } from '../rules/types.ts';
import { seededRng } from '../system/pool.ts';
import type { RehearsalCorpus, Scenario, Sketch } from './types.ts';

export const MINUTE = 60_000;
export const DAY_MS = 86_400_000;

export interface CastCharacter { readonly sketch: string; readonly name: string; readonly pronouns?: string; readonly classKey: string }
export interface CastPlayer { readonly player: string; readonly characters: readonly CastCharacter[] }

/**
 * The public state of the board as the rehearsal reads it back at a day's first minute. Times are epoch milliseconds. The reader leaves
 * out The System's own posts and staff characters (the SQL refuses reactions to them, supabase/migrations/0002_reactions.sql), and marks
 * a locked or restricted thread, or a thread on a System board, not `open`.
 */
export interface World {
  /** The day's first minute. */
  readonly dayStart: number;
  readonly reactions: readonly ReactionKind[];
  readonly characters: readonly { readonly id: string; readonly name: string; readonly player: string; readonly sketch: string }[];
  readonly threads: readonly { readonly id: string; readonly board: string; readonly title: string; readonly open: boolean }[];
  readonly posts: readonly { readonly act: string; readonly thread: string; readonly character: string; readonly at: number }[];
}

/** A runAction body (`startThread`, `post` or `react`) due at a moment, for a player. */
export interface TimedAction { readonly at: number; readonly player: string; readonly request: Record<string, unknown> }

type Rng = () => number;

const rngFor = (seed: number, day: number): Rng => seededRng(`rehearsal/${seed}/${day}`);

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

/** The most characters (code points) a text may hold: the server counts them so. */
const trim = (text: string, most: number): string => {
  const chars = Array.from(text);
  return chars.length <= most ? text : chars.slice(0, most).join('').trimEnd();
};

/**
 * One day's filler. `day` is the run's day number (1 is the first); it seeds the draw with the scenario's seed. `limits` are the
 * instance's titleMaxLength and postMaxLength: a filled line is trimmed to them so no action is one the server refuses.
 */
export function dayActions(world: World, corpus: RehearsalCorpus, scenario: Scenario, day: number, limits: { title: number; post: number }): TimedAction[] {
  const r = rngFor(scenario.seed, day);
  const sketchOf = new Map<string, Sketch>(corpus.sketches.map((s) => [s.key, s]));
  const charOf = new Map(world.characters.map((c) => [c.id, c]));
  const boards = Object.keys(corpus.openers).filter((b) => (corpus.openers[b]?.length ?? 0) > 0).sort();
  const out: TimedAction[] = [];

  const feuding = (a: string, b: string): boolean => (sketchOf.get(a)?.feuds.includes(b) ?? false) || (sketchOf.get(b)?.feuds.includes(a) ?? false);
  const openThreads = world.threads.filter((t) => t.open);
  const isOpen = new Set(openThreads.map((t) => t.id));
  const boardOf = new Map(world.threads.map((t) => [t.id, t.board]));
  const postersIn = new Map<string, Set<string>>();
  for (const p of world.posts) {
    if (!isOpen.has(p.thread)) continue;
    const set = postersIn.get(p.thread) ?? new Set<string>();
    set.add(p.character);
    postersIn.set(p.thread, set);
  }
  const byPlayer = new Map<string, World['characters'][number][]>();
  for (const c of world.characters) byPlayer.set(c.player, [...(byPlayer.get(c.player) ?? []), c]);

  // A thread's weight for a sketch: its interest in the title and whether a feud has posted there. Cached per (sketch, thread).
  const weights = new Map<string, number[]>();
  const weightsFor = (sk: Sketch): number[] => {
    let w = weights.get(sk.key);
    if (!w) {
      w = openThreads.map((t) => {
        const feud = [...(postersIn.get(t.id) ?? [])].some((id) => { const x = charOf.get(id); return !!x && feuding(sk.key, x.sketch); });
        const title = t.title.toLowerCase();
        return 1 + (feud ? 3 : 0) + (sk.interests.some((i) => title.includes(i.toLowerCase())) ? 3 : 0);
      });
      weights.set(sk.key, w);
    }
    return w;
  };

  for (const c of world.characters) {
    const sk = sketchOf.get(c.sketch);
    if (!sk) continue;
    const n = int(r, sk.postsPerDay.least, sk.postsPerDay.most);
    for (let i = 0; i < n; i++) {
      const at = momentIn(r, world.dayStart);
      const interest = sk.interests.length ? pick(r, sk.interests) : '';
      if (boards.length && (openThreads.length === 0 || r() < 0.12)) {
        const board = pick(r, boards);
        const o = pick(r, corpus.openers[board]!);
        out.push({ at, player: c.player, request: { action: 'startThread', board, character: c.id, title: trim(o.title, limits.title), body: trim(o.body, limits.post) } });
        continue;
      }
      if (!openThreads.length) continue;
      const w = weightsFor(sk);
      const idx = weighted(r, openThreads.map((_, k) => k), (k) => w[k]!);
      const thread = openThreads[idx]!;
      const people = [...(postersIn.get(thread.id) ?? [])].filter((id) => id !== c.id).map((id) => charOf.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
      const foes = people.filter((x) => feuding(sk.key, x.sketch));
      // Without anyone to answer in the thread, a reply names any other character: it may be one who has not posted there yet.
      const target = foes.length ? pick(r, foes) : people.length ? pick(r, people) : pick(r, world.characters.filter((x) => x.id !== c.id));
      const lines = foes.length ? corpus.disagreeing : r() < 0.4 ? corpus.agreeing : corpus.replies;
      if (!target || !lines.length) continue;
      const body = trim(fill(pick(r, lines), { name: target.name, interest, board: boardOf.get(thread.id) ?? '' }), limits.post);
      out.push({ at, player: c.player, request: { action: 'post', thread: thread.id, character: c.id, body } });
    }
  }

  // Reactions lean by feud, to the posts of the day before in open threads, from other players' characters, once per player per post.
  const recent = world.posts.filter((p) => p.at >= world.dayStart - DAY_MS && p.at < world.dayStart && isOpen.has(p.thread));
  const positive = world.reactions.filter((k) => !isNegative(k));
  const negative = world.reactions.filter(isNegative);
  const allPlayers = [...byPlayer.keys()].sort();
  for (const post of recent) {
    const author = charOf.get(post.character);
    if (!author) continue;
    const players = allPlayers.filter((p) => p !== author.player);
    const want = Math.min(int(r, scenario.reactionsPerPost.least, scenario.reactionsPerPost.most), players.length);
    for (let i = 0; i < want; i++) {
      const p = players.splice(Math.floor(r() * players.length), 1)[0]!;
      const mine = byPlayer.get(p)!;
      const reactor = weighted(r, mine, (c) => (feuding(c.sketch, author.sketch) ? 4 : 1));
      const kinds = feuding(reactor.sketch, author.sketch) ? negative : positive;
      if (!kinds.length) continue;
      out.push({ at: momentIn(r, world.dayStart), player: p, request: { action: 'react', act: post.act, character: reactor.id, kind: pick(r, kinds).key } });
    }
  }
  // By time, then player, then the order drawn, so equal times sort the same everywhere.
  return out.map((x, i) => ({ x, i })).sort((a, b) => a.x.at - b.x.at || (a.x.player < b.x.player ? -1 : a.x.player > b.x.player ? 1 : 0) || a.i - b.i).map(({ x }) => x);
}
