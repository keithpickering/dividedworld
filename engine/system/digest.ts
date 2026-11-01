/**
 * The digest a meeting reads (system design, sections 5 and 13): what `system_digest` (supabase/migrations/0044_digest.sql)
 * returned, laid out as plain text with the Boss's own memory and the outside feed beside it. The SQL digest is built by
 * a role that can read public relations only, so nothing here can name who owns a mask, a class, or who reacted.
 *
 * The text's length is bounded here, not by trust in the caller: the settings that cut the lists in SQL (digestThreads,
 * digestExcerpts, digestExcerptChars) have ceilings (DIGEST_MOST) that their validators enforce, and the renderer
 * slices every list to those ceilings and clips every free string a player or a feed wrote (CLIPS). It does not grow
 * with the instance or with a setting. The test renders over-long input at the ceilings and asserts a bound computed
 * from these constants.
 *
 * Pure: it reads its arguments and nothing else.
 */
import type { Memory } from './memory.ts';

export interface DigestThread {
  readonly thread: string;
  readonly title: string;
  readonly board: string;
  readonly posts: number;
  /** Posts an hour over the window. */
  readonly heat: number;
  /** 0 to 0.75: 1 minus the largest quadrant's share of the thread's reactions; 0 with none. */
  readonly controversy: number;
  /** The thread's posts so far. */
  readonly length: number;
}

export interface DigestStanding {
  readonly rank: number;
  readonly character: string;
  readonly amount: number;
}

export interface DigestQuote {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

export interface DigestBossReaction {
  readonly act: string;
  readonly thread: string;
  readonly total: number;
  /** Reaction kind to the public count of it. */
  readonly tally: Readonly<Record<string, number>>;
}

export interface DigestExcerpt {
  readonly act: string;
  readonly thread: string;
  readonly character: string;
  readonly reactions: number;
  readonly text: string;
}

export interface DigestCharacter {
  readonly id: string;
  readonly name: string;
  readonly staff: boolean;
}

/** A landed move and its demand's progress; Task 8 of the system plan gives it a shape. */
export type DigestMove = Readonly<Record<string, unknown>>;

export interface Digest {
  readonly since: string;
  readonly until: string;
  readonly threads: readonly DigestThread[];
  /** Filled only when a settlement ended in the window. */
  readonly standings: readonly DigestStanding[];
  readonly moves: readonly DigestMove[];
  readonly quotes: readonly DigestQuote[];
  readonly bossReactions: readonly DigestBossReaction[];
  readonly excerpts: readonly DigestExcerpt[];
  /**
   * The debuted, public characters the lists name: the set the meeting passes to `repairMemory` as the public
   * characters (dropping `staff` ones if the Boss should hold no opinion of staff).
   */
  readonly characters: readonly DigestCharacter[];
}

/**
 * The ceilings on what a digest holds, for every instance: the settings digestThreads, digestExcerpts and
 * digestExcerptChars may not exceed the first three (engine/rules/instance.ts), and the renderer slices to them
 * whatever it is handed. `feed` is the outside feed's items, which the caller caps but the renderer does not trust.
 */
export const DIGEST_MOST = { threads: 25, excerpts: 20, excerptChars: 1000, feed: 30 } as const;

/** The clips on strings the digest and the feed carry. Thread titles are at most 120 in SQL. */
export const CLIPS = {
  title: 120,
  board: 60,
  name: 64,
  kind: 24,
  /** Reaction kinds shown on one of the Boss's posts, most reacted first. */
  tallyKinds: 32,
  move: 400,
  feedItem: 200,
  memoryNote: 300,
  memoryItem: 120,
} as const;

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
const line = (s: string): string => s.replace(/\s+/g, ' ').trim();

function memoryText(memory: Memory | null, names: (id: string) => string): string[] {
  if (memory === null) return ['You are new to this board. You have no memory yet; form one from what follows.'];
  const out = [`Your hobby: ${clip(line(memory.hobby.name), 80)} (since ${clip(memory.hobby.since, 40)}, from ${clip(line(memory.hobby.from), 120)}).`];
  for (const o of memory.opinions) out.push(`Opinion of ${names(o.character)}: ${o.score}. ${clip(line(o.note), CLIPS.memoryNote)}`);
  for (const g of memory.grudges) out.push(`Grudge against ${names(g.character)}. ${clip(line(g.note), CLIPS.memoryNote)}`);
  if (memory.wheelhouse.length) out.push(`The wheelhouse you have learned: ${memory.wheelhouse.map((w) => clip(line(w), CLIPS.memoryItem)).join('; ')}.`);
  if (memory.realWorld.length) out.push(`Real-world subjects you leave alone: ${memory.realWorld.map((w) => clip(line(w), CLIPS.memoryItem)).join('; ')}.`);
  return out;
}

/**
 * The text the meeting reads. `memory` is the Boss's latest memory, or null for a Boss that has none (a new one);
 * `feed` is the outside feed's item titles, already capped by the caller.
 */
export function renderDigest(digest: Digest, memory: Memory | null, feed: readonly string[]): string {
  const { threads: T, excerpts: E, excerptChars: C, feed: F } = DIGEST_MOST;
  const known = new Map(digest.characters.slice(0, 4 * E).map((c) => [c.id, clip(line(c.name), CLIPS.name)]));
  const name = (id: string): string => known.get(id) ?? 'someone';
  const out: string[] = [];
  const section = (title: string, rows: readonly string[], none: string): void => {
    out.push('', `## ${title}`);
    if (rows.length === 0) out.push(none);
    else out.push(...rows);
  };

  out.push(`# The board from ${digest.since} to ${digest.until}`);
  section('What you remember', memoryText(memory, name), '');
  section(
    'Hot threads',
    digest.threads.slice(0, T).map(
      (t, i) =>
        `${i + 1}. "${clip(line(t.title), CLIPS.title)}" on ${clip(line(t.board), CLIPS.board)}: ${t.posts} posts in the window (${t.heat} an hour), ${t.length} in all, controversy ${t.controversy}.`,
    ),
    'No thread was posted in.',
  );
  section(
    'Standings',
    digest.standings.slice(0, E).map((s) => `${s.rank}. ${name(s.character)}: ${s.amount}`),
    'No settlement landed in the window.',
  );
  section('Moves', digest.moves.slice(0, E).map((m) => clip(line(JSON.stringify(m)), CLIPS.move)), 'No move landed in the window.');
  section(
    'Quotes between characters',
    digest.quotes.slice(0, E).map((q) => `${name(q.from)} quoted ${name(q.to)} ${q.count} time${q.count === 1 ? '' : 's'}.`),
    'Nobody quoted anybody.',
  );
  section(
    'Reactions to your own posts',
    digest.bossReactions.slice(0, E).map(
      (r) =>
        `${r.total} in all: ${Object.entries(r.tally)
          .sort(([ka, a], [kb, b]) => b - a || (ka < kb ? -1 : ka > kb ? 1 : 0))
          .slice(0, CLIPS.tallyKinds)
          .map(([kind, n]) => `${clip(kind, CLIPS.kind)} ${n}`)
          .join(', ')}.`,
    ),
    'Your posts drew nothing.',
  );
  section(
    'Top posts',
    digest.excerpts.slice(0, E).map((e) => `${name(e.character)} (${e.reactions} reactions): ${clip(line(e.text), C)}`),
    'No post drew attention.',
  );
  section('Outside', feed.slice(0, F).map((f) => `- ${clip(line(f), CLIPS.feedItem)}`), 'Nothing from outside.');
  return out.join('\n');
}
