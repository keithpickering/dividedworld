/**
 * A post's body as a reader of the board sees it where a play covers some of its words with others (a card whose `covers` says so): the covered
 * stretches of the visible text are written over the words under them, in the body's own BBCode, so a model that reads the post reads what the
 * board shows and not what lies beneath. The post's own words stay the post's; this string is only for reading, never stored.
 *
 * Plays come oldest first, the board's stacking order, so where two covers overlap the later play's is on top and the earlier one is dropped whole
 * (half a strip would read as words nobody saw), even if the later cover is then skipped. A cover that is out of bounds is dropped. A cover is written only where every visible character of
 * its stretch belongs to a text node whose place in the body is known (`parse`'s `texts`); one that meets anything else (a link's address, the separator the walk puts for a quote, code, a list or a rule, a node the parser built rather than copied; a `\n` typed inside a text node is covered like any word) is skipped whole, since writing it would change markup, not words.
 * The words are written as text (`literal`), never as markup. Tags between the text nodes a cover meets stay as written. With no cover kept the body comes back as the same string.
 */
import { parse, type BbNode } from '../bbcode/parse.ts';
import { visibleWalk } from '../bbcode/visible.ts';
import type { Cover, CoverPlay } from '../rules/cards.ts';
import type { ReadPlay } from './extras.ts';

interface Piece { readonly node: BbNode; readonly at: number; readonly length: number; readonly from: number; readonly to: number }

/** Where a cut would split a surrogate pair (between a high and a low half). */
const splits = (text: string, i: number): boolean => {
  const hi = text.charCodeAt(i - 1);
  const lo = text.charCodeAt(i);
  return i > 0 && i < text.length && hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
};

const valid = (c: Cover, text: string): boolean =>
  typeof c.words === 'string' && Number.isInteger(c.from) && Number.isInteger(c.to) && c.from >= 0 && c.to <= text.length && c.from < c.to && !splits(text, c.from) && !splits(text, c.to);

/**
 * `words` as the text they are, in one noparse: nothing in them is read as a tag, and the visible text of the result is the words. The parser ends a noparse at the first `[/noparse]` (any case), so each
 * of those inside the words is split where it stands: the wrap is closed at its `[`, that `[` is written in a noparse of its own, and a third carries on from the `/` (`[/noparse]` becomes
 * `[/noparse][noparse][[/noparse][noparse]/noparse]`). The cost is the wrap's 19 characters, plus 30 for each closer in the words, never a tag per character: a typed replacement is at most 100
 * characters, so it can only grow so far, and the words' own length is what the read bound (`coveredBody`'s `most`) is spent on.
 */
const literal = (words: string): string =>
  `[noparse]${words.replace(/\[\/noparse\]/gi, (m) => `[/noparse][noparse][[/noparse][noparse]${m.slice(1)}`)}[/noparse]`;

/** Index of the first item in `list` (sorted, disjoint) whose end is past `x`: binary search. */
function firstEndingAfter(list: readonly { readonly end: number }[], x: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid]!.end > x) hi = mid; else lo = mid + 1; }
  return lo;
}

/**
 * `most` is the longest a covered body may be: the instance's post length limit. Replacement words longer than their phrase are the game, but a covered read can never be longer than an uncovered
 * one could be, so the result never exceeds `Math.max(body.length, most)`: the covers are applied in visible order, and the first that would take the result past that and every one after it read as written.
 */
export function coveredBody(body: string, plays: readonly ReadPlay[], covers: (card: string | null, p: CoverPlay) => readonly Cover[] | null, most: number): string {
  if (plays.length === 0) return body;
  // Parsed and walked once, on the first read of a play's `text`: a card with no `covers` never reads it, so a body nobody covers is never parsed.
  const texts = new Map<BbNode, { from: number; to: number }>();
  let walked: ReturnType<typeof visibleWalk> | null = null;
  const walk = () => (walked ??= visibleWalk(parse(body, undefined, undefined, texts)));

  // Each play's covers, later plays winning: a play's own covers are sorted by position and the first of any overlap is kept (first by position, not by the order given);
  // an earlier play's cover that a later play's overlaps is dropped whole, even if the later one is then skipped below. Both lists stay sorted and disjoint, so a merge sweep does it.
  let kept: Cover[] = [];
  for (const p of plays) {
    const raw = covers(p.card, { config: p.config, state: p.state, get text() { return walk().text; } }) ?? [];
    const sorted = raw.filter((c) => valid(c, walk().text)).sort((x, y) => x.from - y.from);
    const mine: Cover[] = [];
    let last = 0;
    for (const c of sorted) if (c.from >= last) { mine.push(c); last = c.to; }
    if (mine.length === 0) continue;
    const rest: Cover[] = [];
    let j = 0;
    for (const k of kept) {
      while (j < mine.length && mine[j]!.to <= k.from) j++;
      if (!(j < mine.length && mine[j]!.from < k.to)) rest.push(k);
    }
    const merged: Cover[] = [];
    let a = 0;
    let b = 0;
    while (a < rest.length || b < mine.length) merged.push(b >= mine.length || (a < rest.length && rest[a]!.from < mine[b]!.from) ? rest[a++]! : mine[b++]!);
    kept = merged;
  }
  if (kept.length === 0) return body;
  const { offsets } = walk();

  // The recorded text nodes, in visible order, with where each lies in the visible text and in the body.
  const pieces: Piece[] = [];
  const unrecorded: { at: number; end: number }[] = [];
  for (const [node, at] of offsets) {
    if (node.type !== 'text') { if ('text' in node && node.text.length > 0) unrecorded.push({ at, end: at + node.text.length }); continue; }
    const span = texts.get(node);
    if (!span) { if (node.text.length > 0) unrecorded.push({ at, end: at + node.text.length }); continue; }
    pieces.push({ node, at, length: node.text.length, from: span.from, to: span.to });
  }
  pieces.sort((a, b) => a.at - b.at);
  unrecorded.sort((a, b) => a.at - b.at);
  const pieceEnds = pieces.map((q) => ({ end: q.at + q.length }));

  const bound = Math.max(body.length, most);
  let length = body.length;
  const edits: { from: number; to: number; words: string }[] = [];
  for (const c of kept) {
    const u = unrecorded[firstEndingAfter(unrecorded, c.from)];
    if (u && u.at < c.to) continue;
    const met: Piece[] = [];
    for (let i = firstEndingAfter(pieceEnds, c.from); i < pieces.length && pieces[i]!.at < c.to; i++) met.push(pieces[i]!);
    let reach = c.from; // every visible character of the stretch must lie in a recorded text node
    for (const p of met) { if (p.at > reach) break; reach = Math.max(reach, p.at + p.length); }
    if (reach < c.to) continue;
    const mine: { from: number; to: number; words: string }[] = [];
    let grows = 0;
    met.forEach((p, i) => {
      const a = Math.max(c.from, p.at) - p.at;
      const b = Math.min(c.to, p.at + p.length) - p.at;
      // Next to a bracket the body's own text holds, or with a bracket in the words, plain words could join into a tag: write them in a noparse, empty where there are none, which is also the barrier.
      const near = /[[\]]/.test(body.slice(p.from, p.to)) || (i === 0 && (c.words.includes(']') || c.words.includes('[')));
      const words = i === 0 ? c.words : '';
      const written = near ? literal(words) : words;
      mine.push({ from: p.from + a, to: p.from + b, words: written });
      grows += written.length - (b - a);
    });
    if (length + grows > bound) break; // the bound is reached: this cover and every later one read as written
    length += grows;
    edits.push(...mine);
  }
  if (edits.length === 0) return body;
  // The edits are disjoint: one pass over them in order, one join.
  edits.sort((a, b) => a.from - b.from);
  const chunks: string[] = [];
  let at = 0;
  for (const e of edits) { chunks.push(body.slice(at, e.from), e.words); at = e.to; }
  chunks.push(body.slice(at));
  return chunks.join('');
}
