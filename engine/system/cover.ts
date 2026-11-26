/**
 * A post's body as a reader of the board sees it where a play covers some of its words with others (a card whose `covers` says so): the covered
 * stretches of the visible text are written over the words under them, in the body's own BBCode, so a model that reads the post reads what the
 * board shows and not what lies beneath. The post's own words stay the post's; this string is only for reading, never stored.
 *
 * Plays come oldest first, the board's stacking order, so where two covers overlap the later play's is on top and the earlier one is dropped whole
 * (half a strip would read as words nobody saw). A cover that is out of bounds is dropped. A cover is written only where every visible character of
 * its stretch belongs to a text node whose place in the body is known (`parse`'s `texts`); one that meets anything else (a link's address, a line
 * break the renderer draws, code, a node the parser built rather than copied) is skipped whole, since writing it would change markup, not words.
 * Tags between the text nodes a cover meets stay as written. With no cover kept the body comes back as the same string.
 */
import { parse, type BbNode } from '../bbcode/parse.ts';
import { visibleWalk } from '../bbcode/visible.ts';
import type { Cover, CoverPlay } from '../rules/cards.ts';
import type { ReadPlay } from './extras.ts';

interface Piece { readonly node: BbNode; readonly at: number; readonly length: number; readonly from: number; readonly to: number }

const valid = (c: Cover, length: number): boolean =>
  typeof c.words === 'string' && Number.isInteger(c.from) && Number.isInteger(c.to) && c.from >= 0 && c.to <= length && c.from < c.to;

export function coveredBody(body: string, plays: readonly ReadPlay[], covers: (card: string | null, p: CoverPlay) => readonly Cover[] | null): string {
  if (plays.length === 0) return body;
  const texts = new Map<BbNode, { from: number; to: number }>();
  const nodes = parse(body, undefined, undefined, texts);
  const { text, offsets } = visibleWalk(nodes);

  // Each play's covers, later plays winning: a kept cover removes every earlier kept one it overlaps, whole.
  let kept: Cover[] = [];
  for (const p of plays) {
    const given = (covers(p.card, { config: p.config, state: p.state, text }) ?? []).filter((c) => valid(c, text.length));
    const mine: Cover[] = [];
    for (const c of given) if (!mine.some((m) => c.from < m.to && m.from < c.to)) mine.push(c);
    if (mine.length === 0) continue;
    kept = kept.filter((k) => !mine.some((m) => k.from < m.to && m.from < k.to));
    kept.push(...mine);
  }
  if (kept.length === 0) return body;

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

  const edits: { from: number; to: number; words: string }[] = [];
  for (const c of kept) {
    if (unrecorded.some((u) => c.from < u.end && u.at < c.to)) continue;
    const met = pieces.filter((p) => p.at < c.to && c.from < p.at + p.length);
    let reach = c.from; // every visible character of the stretch must lie in a recorded text node
    for (const p of met) { if (p.at > reach) break; reach = Math.max(reach, p.at + p.length); }
    if (reach < c.to) continue;
    met.forEach((p, i) => {
      const a = Math.max(c.from, p.at) - p.at;
      const b = Math.min(c.to, p.at + p.length) - p.at;
      edits.push({ from: p.from + a, to: p.from + b, words: i === 0 ? c.words : '' });
    });
  }
  if (edits.length === 0) return body;
  edits.sort((a, b) => b.from - a.from);
  let out = body;
  for (const e of edits) out = out.slice(0, e.from) + e.words + out.slice(e.to);
  return out;
}
