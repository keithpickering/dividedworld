/**
 * The digest a meeting reads (system design, sections 5 and 13): what `system_digest` (supabase/migrations/0045_digest.sql)
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
import { pronounsOr, taggedName, type PronounSet } from '../rules/pronouns.ts';
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
  /** Its pronouns, resolved by the caller (a character with no profile row reads the persona's, else the instance's, else the it-set); the renderer writes it `Name (she/her)`. */
  readonly pronouns: PronounSet;
}

/**
 * A move in force, or one that ended in the window, as `system_digest` lists it (supabase/migrations/0046_moves.sql):
 * `{act, kind, params, demand, expiresAt, landedAt, progress: {done, of, met}, ended, state}`, where `ended` is null while the move is in
 * force and `{why: met | expired | reversed, by, at}` after. A move an admin held before it landed has `state: 'held'`, no act, no
 * progress, and `heldAt` and `why` (the Boss's own words for it). A move that ended `met` also has `metBy`, the ids of the public
 * characters whose Acts counted toward its demand (supabase/migrations/0052_digest_meeters.sql), at most `DIGEST_MOST.metBy`. Held generically: the renderer reads the fields it knows, defensively,
 * and falls back to the row's JSON for one it does not, so a digest from a newer database still renders.
 */
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

/** The digest as `system_digest` returns it: a character with no profile row reads `pronouns: null`. */
export type RawDigest = Omit<Digest, 'characters'> & { readonly characters: readonly (Omit<DigestCharacter, 'pronouns'> & { readonly pronouns: PronounSet | null })[] };

/** The digest with each character's pronouns settled: its own, else `fallback` (the instance's default, else the engine's it-set). */
export function withPronouns(raw: RawDigest, fallback: PronounSet): Digest {
  return { ...raw, characters: raw.characters.map((c) => ({ ...c, pronouns: pronounsOr(c.pronouns, fallback) })) };
}

/**
 * The ceilings on what a digest holds, for every instance: the settings digestThreads, digestExcerpts and
 * digestExcerptChars may not exceed the first three (engine/rules/instance.ts), and the renderer slices to them
 * whatever it is handed. `feed` is the outside feed's items, which the caller caps but the renderer does not trust.
 * `metBy` is the most characters a met move credits (SQL caps its `metBy` list at the same number).
 */
export const DIGEST_MOST = { threads: 25, excerpts: 20, excerptChars: 1000, feed: 30, metBy: 8 } as const;

/** The clips on strings the digest and the feed carry. Thread titles are at most 120 in SQL. */
export const CLIPS = {
  title: 120,
  board: 60,
  name: 64,
  kind: 32,
  /** Reaction kinds shown on one of the Boss's posts, most reacted first. */
  tallyKinds: 32,
  move: 400,
  feedItem: 200,
  memoryNote: 300,
  memoryItem: 120,
} as const;

const clip = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
const line = (s: string): string => s.replace(/\s+/g, ' ').trim();

const record = (v: unknown): Readonly<Record<string, unknown>> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A move as one line: its state and how far its demand has come first, so the clip never cuts them, then what it did. */
function moveLine(m: DigestMove): string {
  if (typeof m['kind'] !== 'string') return line(JSON.stringify(m));
  const ended = record(m['ended']);
  const progress = record(m['progress']);
  const demand = record(m['demand']);
  const state = m['state'] === 'held' ? 'held by an admin before it landed' : typeof ended['why'] === 'string' ? `ended ${clip(String(ended['why']), CLIPS.kind)} by ${clip(String(ended['by']), CLIPS.kind)}` : 'in force';
  const way =
    typeof demand['kind'] === 'string' && m['state'] === 'held'
      ? `demand ${clip(String(demand['kind']), CLIPS.kind)}, never asked`
      : typeof demand['kind'] === 'string' && typeof progress['of'] === 'number'
      ? `demand ${clip(String(demand['kind']), CLIPS.kind)} ${progress['done']} of ${progress['of']}${progress['met'] === true ? ', met' : ''}`
      : 'no demand';
  const name = record(m['params'])['name'];
  const did = typeof name === 'string' ? ` renamed a board to "${clip(line(name), 80)}"` : '';
  return `${clip(m['kind'], CLIPS.kind)}: ${state}; ${way};${did}`;
}

/** The characters who met a move, as ` met by A, B and C`, or nothing: the ids the SQL gave, named from the digest's characters, at most DIGEST_MOST.metBy. */
function metByText(m: DigestMove, name: (id: string) => string): string {
  const ids = m['metBy'];
  if (!Array.isArray(ids)) return '';
  const names = ids.filter((id): id is string => typeof id === 'string').slice(0, DIGEST_MOST.metBy).map(name);
  if (names.length === 0) return '';
  return ` met by ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}.`;
}

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
  const known = new Map(digest.characters.slice(0, (4 + DIGEST_MOST.metBy) * E).map((c) => [c.id, taggedName(clip(line(c.name), CLIPS.name), c.pronouns)]));
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
  section('Moves', digest.moves.slice(0, E).map((m) => clip(moveLine(m), CLIPS.move) + metByText(m, name)), 'No move is in force and none ended in the window.');
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
    digest.excerpts.slice(0, E).map((e) => `${name(e.character)}, ${e.reactions} reactions: ${clip(line(e.text), C)}`),
    'No post drew attention.',
  );
  section('Outside', feed.slice(0, F).map((f) => `- ${clip(line(f), CLIPS.feedItem)}`), 'Nothing from outside.');
  return out.join('\n');
}
