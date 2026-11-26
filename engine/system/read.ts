/**
 * The reader (docs/plans/2026-11-23-whole-posts-design.md, sections 2 to 4): from the candidate posts of one thread it chooses what one call reads, every post whole,
 * and renders them for a prompt. Pure and deterministic: no randomness, no clock. It never cuts a post; a post is taken whole or left out, and the lines say how many were left out.
 *
 * Tiers, best first: must (the replies the call answers and the persona's own posts they answer; for a judge, the judged post), to it (other posts that reply to or quote the persona,
 * and the persona's other posts), the opener, its company (characters the persona has talked with in this thread), everyone else. Within a tier newest first; a post that does not fit what is
 * left of the ceiling is passed over and the next is tried. A quoted candidate ranks at the best tier of any post quoting it.
 *
 * Quotes (design section 3): a real quote of a candidate's whole words becomes a marker naming the post. The cut is at the parser's reported spans, as `concealQuotes` does, never a re-serialization.
 * An unclosed `[quote=<act>]` of a non-candidate with nothing after it has empty contents and reads as a hidden post.
 * What is left out is counted by the thread's own numbering: `seq` is a post's 1-based number in the thread, so every number from 1 to the newest candidate's that is not shown is a post not shown,
 * whether or not it was a candidate (the candidates are a sparse set: the opener, the newest window, the named and the persona's). `omitted` is that count.
 * A name in a marker is the candidate's own `name`, as the public views gave it, so a marker never names an author more plainly than the board does.
 */
import { parse, type QuoteSpan } from '../bbcode/parse.ts';
import { quoteNorm, quoteSource, quoteWords } from '../bbcode/quoted.ts';
import { taggedName, type PronounSet } from '../rules/pronouns.ts';
import type { Cover, CoverPlay, SeenPlay } from '../rules/cards.ts';
import { coveredBody } from './cover.ts';
import { originLine, playLine, pollLines, reactionLine, rewoundLine, type Extras, type ReadOrigin, type ReadOriginPost, type ReadPlay, type ReadPoll, type Reactions } from './extras.ts';
import { amountWords, ago } from './when.ts';

/** The newest posts a read considers (the SQL read takes this many). */
export const READ_WINDOW = 60;

/** Said to the model once per prompt that shows a read (design section 4). */
export const READ_WORDS = 'Every post you are shown is whole. Where the game left posts out for space, a line says how many; it is not part of anyone\'s post, and your post never mentions it. Lines in square brackets under a post, and the line saying where a thread was spun from, describe things that really happened on the board: polls, cards played on posts, and the post a thread was spun from. React to them in character if you like; never quote them as anyone\'s words.';

/** One post `pool_read` returns: whole public body, its number in the thread, the post it replies to and the posts it really quotes. */
export interface ReadCandidate {
  readonly act: string;
  readonly seq: number;
  readonly at: string;
  readonly author: string;
  readonly name: string;
  readonly pronouns: PronounSet | null;
  readonly body: string;
  readonly replyTo: string | null;
  readonly quotes: readonly string[];
  /** The post's live poll, the plays the board shows on it, its public reaction counts, and, for a rewound post, the moment it shows (`body` is then that version's). From `pool_read` (`post_extras`). */
  readonly poll: ReadPoll | null;
  readonly plays: readonly ReadPlay[];
  readonly reactions: Reactions;
  readonly rewoundTo: string | null;
}

/**
 * What one call is given besides the candidates. `readMost`: the ceiling. `now`: the call's time (ms), the only clock the reader has. `seen`: the instance's sentence for a play of a card (`CardRules.seen`;
 * null for a card with none, or a back with no card). `origin`: what the thread was spun from, null for a thread that was not. The names are the instance's: a card's by key (the fallback line of a play with
 * no sentence, a play origin's place), a group's by key, a reaction kind as the board shows it (the kind itself where omitted).
 */
export interface ReadOptions {
  readonly readMost: number;
  readonly now: number;
  readonly seen: (card: string | null, p: SeenPlay) => string | null;
  /** The stretches a play of a card covers in a post's visible text (`CardRules.covers`; null for a card with none, or a back with no card); absent means none. Read bodies are covered before they are marked or sized. */
  readonly covers?: (card: string | null, p: CoverPlay) => readonly Cover[] | null;
  readonly origin: ReadOrigin | null;
  readonly cardName?: (key: string) => string | undefined;
  readonly groupName?: (key: string) => string | undefined;
  readonly reactionName?: (kind: string) => string;
}

/** `self`: the persona's character id. `must`: the answered replies, or the judged post, oldest first. */
export interface ReadFocus {
  readonly self: string | null;
  readonly must: readonly string[];
}

export interface ReadMarks {
  readonly you: boolean;
  /** A post of the must tier (a reply this call answers, or the post a judge judges; `readLines`'s `mustLabel` says which word). */
  readonly answering: boolean;
  readonly repliesToYou: boolean;
  readonly quotesYou: boolean;
}

/** A candidate with its body as marked (quotes of whole posts replaced). */
export interface ReadPost extends ReadCandidate {
  readonly marks: ReadMarks;
  /** `body` marked as for a reader who is no one in the thread: the persona's own posts are named like anyone's (`[quoting Name, post #3]`, never `your post`). For a frame that has no "you" (the old voice). */
  readonly thirdPerson: string;
  /** The post's tier, 1 (must) to 5 (everyone else), as the module doc lists them; a fitter that must drop whole posts drops the highest number first. */
  readonly tier: 1 | 2 | 3 | 4 | 5;
  /** The rendered extras (`readLines` emits them): the rewound line before the body, the poll, plays and reactions lines after it. */
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  /** The origin's lines (its line, then its post's block) directly above the opener; empty for every other post, and for an opener of a thread that was not spun. */
  readonly originLines?: readonly string[];
}

export interface ThreadReadResult {
  /** In thread order. */
  readonly posts: readonly ReadPost[];
  /** The posts of the thread not shown: every number from 1 to `through` that no shown post has. */
  readonly omitted: number;
  /** The must posts taken, oldest first. */
  readonly answered: readonly string[];
  /** The highest seq among the candidates (the newest post is always one); the thread's length as far as the read knows it. */
  readonly through: number;
}

const sourceCache = new WeakMap<ReadCandidate, string>();
function sourceOf(c: ReadCandidate): string {
  let s = sourceCache.get(c);
  if (s === undefined) { s = quoteSource(parse(c.body)); sourceCache.set(c, s); }
  return s;
}

/** The body with each outermost real quote of a candidate's whole words (or of a hidden post) replaced by its marker; every other character, and every other quote, as written. */
export function markQuotes(body: string, byAct: Map<string, ReadCandidate>, self: string | null): string {
  return markWith(body, lowerActs(byAct), self);
}

function lowerActs(byAct: Map<string, ReadCandidate>): Map<string, ReadCandidate> {
  const lower = new Map<string, ReadCandidate>();
  for (const [k, v] of byAct) lower.set(k.toLowerCase(), v);
  return lower;
}

function markWith(body: string, lower: Map<string, ReadCandidate>, self: string | null): string {
  if (!/\[quote/i.test(body)) return body;
  const spans: QuoteSpan[] = [];
  parse(body, spans);
  const ordered = [...spans].sort((a, b) => a.from - b.from || b.to - a.to);
  let out = '';
  let at = 0;
  let covered = 0; // the end of the last outermost quote, replaced or kept: a quote inside one is never considered
  for (const s of ordered) {
    if (s.from < covered) continue;
    const open = body.lastIndexOf('[', s.from - 2);
    if (open < at || body.slice(open, open + 6).toLowerCase() !== '[quote') continue;
    const end = body.slice(s.to, s.to + 8).toLowerCase() === '[/quote]' ? s.to + 8 : s.to;
    covered = end;
    const c = lower.get(s.act.toLowerCase());
    let marker: string | null = null;
    if (c === undefined) {
      if (s.to === s.from) marker = '[quoting a hidden post]';
    } else if (quoteNorm(quoteWords(parse(body.slice(s.from, s.to)))) === sourceOf(c)) {
      marker = self !== null && c.author === self ? `[quoting your post #${c.seq}]` : `[quoting ${c.name}, post #${c.seq}]`;
    }
    if (marker === null) continue;
    out += body.slice(at, open) + marker;
    at = end;
  }
  return out + body.slice(at);
}

/** A post's extras as lines: the rewound line (before the body), and the poll, plays and reactions (after it). */
export function extraLines(c: Extras, o: ReadOptions): { before: string[]; after: string[] } {
  const rewound = rewoundLine(c.rewoundTo, o.now);
  const reactions = reactionLine(c.reactions, o.reactionName ?? ((k) => k));
  const cardName = o.cardName ?? (() => undefined);
  return {
    before: rewound === null ? [] : [rewound],
    after: [
      ...(c.poll === null ? [] : pollLines(c.poll, o.now)),
      ...c.plays.map((p) => playLine(p, { now: o.now, seen: o.seen(p.card, seenOf(p, o)), cardName })),
      ...(reactions === null ? [] : [reactions]),
    ],
  };
}

const seenOf = (p: ReadPlay, o: ReadOptions): SeenPlay => ({ config: p.config, state: p.state, text: p.text ?? null, covered: p.covered ?? null, by: p.by, ago: ago(p.at, o.now), amountWords });

/** The origin's lines: its one line, then its post, headed `<name> [origin, post #<seq> in "<title>"]` (`[origin, the Updates post "<title>"]` with no seq), with its words, poll, plays and reactions. */
export function originBlock(origin: ReadOrigin, o: ReadOptions): string[] {
  const out = [originLine(origin, o.now, o)];
  const post: ReadOriginPost | null = origin.post;
  if (post === null) return out;
  const name = post.name.length > 60 ? post.name.slice(0, 60) : post.name;
  const who = post.pronouns === null || post.pronouns === undefined ? name : taggedName(name, post.pronouns);
  const where = post.seq === null || post.seq === undefined ? `the Updates post "${post.title}"` : `post #${post.seq} in "${post.title}"`;
  const x = extraLines(post, o);
  return [...out, `${who} [origin, ${where}]`, ...x.before, coverRead(post.body, post.plays, o), ...x.after];
}

/** A body as the board shows it: covered by its plays (`o.covers`). Reading only: the quote comparison (`sourceOf`) and every rule check keep the post's own words. */
const coverRead = (body: string, plays: readonly ReadPlay[], o: Pick<ReadOptions, 'covers'>): string => (o.covers === undefined ? body : coveredBody(body, plays, o.covers));

const length = (lines: readonly string[]): number => lines.reduce((n, l) => n + l.length, 0);

/**
 * Chooses what a call reads. `o.readMost` is the ceiling, in characters of rendered post text (the words, and the poll, play and reaction lines under them; for the opener, the origin too); it bounds every tier
 * but the must tier, whose newest post is read whatever its size and whose older posts are added, newest first, only while the total stays within it. A spun thread's opener (`o.origin` given) ranks with the
 * persona's own, and the origin is shown exactly when the opener is.
 */
export function readThread(all: readonly ReadCandidate[], focus: ReadFocus, o: ReadOptions): ThreadReadResult {
  const readMost = o.readMost;
  const byAct = new Map<string, ReadCandidate>();
  for (const c of all) if (!byAct.has(c.act)) byAct.set(c.act, c); // the first of an act wins
  const cands = [...byAct.values()];
  const lower = lowerActs(byAct);
  // Each body is covered first (what the board shows), then its quotes are marked; a quote is still compared with the quoted post's own words (`sourceOf` reads `c.body`, never the covered one).
  const read = new Map<string, string>(cands.map((c) => [c.act, coverRead(c.body, c.plays, o)]));
  const bodies = new Map<string, string>(cands.map((c) => [c.act, markWith(read.get(c.act)!, lower, focus.self)]));
  const thirds = new Map<string, string>(cands.map((c) => [c.act, focus.self === null ? bodies.get(c.act)! : markWith(read.get(c.act)!, lower, null)]));
  const extras = new Map<string, { before: string[]; after: string[] }>(cands.map((c) => [c.act, extraLines(c, o)]));
  const opener = cands.reduce<ReadCandidate | undefined>((m, c) => (m === undefined || c.seq < m.seq ? c : m), undefined);
  const originLines = o.origin === null || opener === undefined ? [] : originBlock(o.origin, o);
  const size = (c: ReadCandidate): number => { const x = extras.get(c.act)!; return bodies.get(c.act)!.length + length(x.before) + length(x.after) + (c === opener ? length(originLines) : 0); };
  const self = focus.self;
  const mine = (c: ReadCandidate): boolean => self !== null && c.author === self;
  const taken = new Set<string>();
  let total = 0;
  const take = (c: ReadCandidate): void => { taken.add(c.act); total += size(c); };

  const repliesToYou = (c: ReadCandidate): boolean => { const t = c.replyTo === null ? undefined : byAct.get(c.replyTo); return t !== undefined && mine(t) && !mine(c); };
  const quotesYou = (c: ReadCandidate): boolean => !mine(c) && c.quotes.some((a) => { const t = byAct.get(a); return t !== undefined && mine(t); });

  // 1. The must tier.
  const mustPosts = [...new Set(focus.must)].map((a) => byAct.get(a)).filter((c): c is ReadCandidate => c !== undefined).sort((a, b) => a.seq - b.seq);
  const answered: ReadCandidate[] = [];
  for (let i = mustPosts.length - 1; i >= 0; i--) {
    const c = mustPosts[i]!;
    if (i === mustPosts.length - 1) { take(c); answered.unshift(c); }
    else if (total + size(c) <= readMost) { take(c); answered.unshift(c); }
    else break; // an older reply that does not fit stays waiting; no even older one is passed to
  }
  for (const r of [...answered].reverse()) {
    const t = r.replyTo === null ? undefined : byAct.get(r.replyTo);
    if (t !== undefined && mine(t) && !taken.has(t.act) && total + size(t) <= readMost) take(t);
  }
  // Then the posts of this thread those taken posts quote, same rule.
  for (const r of [...answered].reverse()) {
    for (const a of r.quotes) {
      const t = byAct.get(a);
      if (t !== undefined && !taken.has(t.act) && total + size(t) <= readMost) take(t);
    }
  }

  // 2. The other tiers.
  const talked = new Set<string>();
  for (const c of cands) {
    if (mine(c)) {
      for (const a of [c.replyTo, ...c.quotes]) { const t = a === null ? undefined : byAct.get(a); if (t !== undefined && !mine(t)) talked.add(t.author); }
    } else if (repliesToYou(c) || quotesYou(c)) talked.add(c.author);
  }
  const own = (c: ReadCandidate): number => (mine(c) || repliesToYou(c) || quotesYou(c) ? 2 : c === opener ? (o.origin === null ? 3 : 2) : talked.has(c.author) ? 4 : 5);
  const rank = new Map<string, number>(cands.map((c) => [c.act, own(c)]));
  for (const c of cands) {
    for (const a of c.quotes) {
      const t = byAct.get(a);
      if (t !== undefined) rank.set(t.act, Math.min(rank.get(t.act)!, own(c)));
    }
  }
  const rest = cands.filter((c) => !taken.has(c.act)).sort((a, b) => rank.get(a.act)! - rank.get(b.act)! || b.seq - a.seq);
  for (const c of rest) if (total + size(c) <= readMost) take(c);

  const answeredActs = new Set(answered.map((c) => c.act));
  const shown = cands.filter((c) => taken.has(c.act)).sort((a, b) => a.seq - b.seq);
  const posts: ReadPost[] = shown.map((c) => ({
    ...c,
    body: bodies.get(c.act)!,
    thirdPerson: thirds.get(c.act)!,
    marks: { you: mine(c), answering: answeredActs.has(c.act), repliesToYou: repliesToYou(c), quotesYou: quotesYou(c) },
    tier: (answeredActs.has(c.act) ? 1 : rank.get(c.act)!) as ReadPost['tier'],
    before: extras.get(c.act)!.before,
    after: extras.get(c.act)!.after,
    originLines: c === opener ? originLines : [],
  }));
  const through = cands.reduce((m, c) => Math.max(m, c.seq), 0);
  return { posts, omitted: Math.max(through - posts.length, 0), answered: answered.map((c) => c.act), through };
}

/**
 * The posts as prompt lines: `Name (she/her) [post #3] (you)` then the body (a rewound post's line first; its poll, plays and reactions after it; the origin of a spun thread above the opener), and in place of each run of left-out posts one line, `(N earlier posts not shown)` before the first shown post,
 * `(N posts not shown)` between and after. `mustLabel` is the word a must post carries: `answering` (the default) or `judged`. The name is as given, clipped to 60 characters as the prompt's other lines are.
 */
export function readLines(read: ThreadReadResult, o: { readonly mustLabel?: 'answering' | 'judged' } = {}): string[] {
  const label = o.mustLabel ?? 'answering';
  const out: string[] = [];
  const gap = (n: number, first: boolean): void => {
    if (n > 0) out.push(`(${n} ${first ? 'earlier ' : ''}${n === 1 ? 'post' : 'posts'} not shown)`);
  };
  let prev = 0;
  for (const p of read.posts) {
    gap(p.seq - prev - 1, prev === 0);
    const name = p.name.length > 60 ? p.name.slice(0, 60) : p.name;
    const marks = [p.marks.you ? 'you' : '', p.marks.answering ? label : '', p.marks.repliesToYou ? 'replies to you' : '', p.marks.quotesYou ? 'quotes you' : ''].filter(Boolean).map((m) => ` (${m})`).join('');
    out.push(...(p.originLines ?? []), `${p.pronouns === null ? name : taggedName(name, p.pronouns)} [post #${p.seq}]${marks}`, ...(p.before ?? []), p.body, ...(p.after ?? []));
    prev = p.seq;
  }
  gap(read.through - prev, false);
  return out;
}
