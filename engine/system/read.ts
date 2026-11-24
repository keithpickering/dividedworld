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

/** The newest posts a read considers (the SQL read takes this many). */
export const READ_WINDOW = 60;

/** Said to the model once per prompt that shows a read (design section 4). */
export const READ_WORDS = 'Every post you are shown is whole. Where the game left posts out for space, a line says how many; it is not part of anyone\'s post, and your post never mentions it.';

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

/**
 * Chooses what a call reads. `readMost` is the ceiling, in characters of marked post text; it bounds every tier but the must tier, whose newest post is read whatever its size
 * and whose older posts are added, newest first, only while the total stays within it.
 */
export function readThread(all: readonly ReadCandidate[], focus: ReadFocus, readMost: number): ThreadReadResult {
  const byAct = new Map<string, ReadCandidate>();
  for (const c of all) if (!byAct.has(c.act)) byAct.set(c.act, c); // the first of an act wins
  const cands = [...byAct.values()];
  const lower = lowerActs(byAct);
  const bodies = new Map<string, string>(cands.map((c) => [c.act, markWith(c.body, lower, focus.self)]));
  const size = (c: ReadCandidate): number => bodies.get(c.act)!.length;
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
  const opener = cands.reduce<ReadCandidate | undefined>((m, c) => (m === undefined || c.seq < m.seq ? c : m), undefined);
  const own = (c: ReadCandidate): number => (mine(c) || repliesToYou(c) || quotesYou(c) ? 2 : c === opener ? 3 : talked.has(c.author) ? 4 : 5);
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
    marks: { you: mine(c), answering: answeredActs.has(c.act), repliesToYou: repliesToYou(c), quotesYou: quotesYou(c) },
  }));
  const through = cands.reduce((m, c) => Math.max(m, c.seq), 0);
  return { posts, omitted: Math.max(through - posts.length, 0), answered: answered.map((c) => c.act), through };
}

/**
 * The posts as prompt lines: `Name (she/her) [post #3] (you)` then the body, and in place of each run of left-out posts one line, `(N earlier posts not shown)` before the first shown post,
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
    out.push(`${p.pronouns === null ? name : taggedName(name, p.pronouns)} [post #${p.seq}]${marks}`, p.body);
    prev = p.seq;
  }
  gap(read.through - prev, false);
  return out;
}
