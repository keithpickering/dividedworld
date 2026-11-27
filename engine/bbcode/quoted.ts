/**
 * The text of a quote and the source of a version, for the forged-quote verdict (docs/plans/2026-11-20-forged-quotes-design.md, sections 1 and 2). A real quote is forged when
 * its words do not stand in the post it names; this file reads the two sides of that question from a parsed body, and the database's `bbcode_walk` (supabase/migrations/
 * 0393_forged_quotes.sql, its `held` and `source` columns) reads them from the same text in one pass, held to the same fixtures (plain.fixtures.ts).
 *
 * What a reader sees. `quoteWords` is the walk of a body's words, in the order the renderer draws them: text, `noparse`, a bare address, a link's words, code's text, list items, a
 * spoiler's title and its words, and the children of every quote, real or counterfeit. A block edge (a quote, code, a list item, a spoiler, an alignment, a marquee, a rule) and an
 * image or a video stand as one separator, and a `cut` (real quotes past the parser's cap, not shown) stands as the cut mark between two separators, so the words on either side of
 * it are never read as one. Written as `visibleWalk` is (visible.ts), with its own stack and never recursion; its work grows with the tree's nodes.
 *
 * The cut mark is U+FDD0, a noncharacter no text holds: a Postgres text cannot hold U+0000, and the walk strips the cut mark from every word it reads so nothing but a cut can put one in.
 */
import type { BbNode } from './parse.ts';

/** What stands for a block edge, an image and a video. */
export const SEPARATOR = '\n';

/** What stands for a cut in the words (never emitted from text), and what `quotePieces` splits on. */
export const CUT = '\ufdd0';

type Step = { readonly node: BbNode } | { readonly word: string } | { readonly exit: number };

/** Every kind of whitespace one space stands for: `\s` of the engine's regular expressions, written out so the database's character class is the same list. */
const WHITESPACE = /[\t-\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;

/**
 * The words normalized for comparing: Unicode NFC; each run of whitespace one space; a run of more than eight of one code point eight; trimmed; one leading `...` (three or more full
 * stops) or `…` and one trailing one removed with the space beside each, and trimmed again. The cut mark is untouched. `quote_norm` in the database is this, in plain SQL.
 */
export function quoteNorm(s: string): string {
  let t = s.normalize('NFC').replace(WHITESPACE, ' ');
  t = t.replace(/(.)\1{8,}/gsu, (_m, c: string) => c.repeat(8));
  t = t.replace(/^ +| +$/g, '');
  t = t.replace(/^(?:\.{3,}|…) ?/, '').replace(/ ?(?:\.{3,}|…)$/, '');
  return t.replace(/^ +| +$/g, '');
}

/** A normalized text split at each cut mark, each piece trimmed: no text is no pieces, a text with no cut is one. */
export function quotePieces(norm: string): string[] {
  return norm === '' ? [] : norm.split(CUT).map((p) => p.replace(/^ +| +$/g, ''));
}

/** Every piece stands in `source`, in order, each at or after the end of the one before; empty pieces (and none at all) hold. */
export function holds(source: string, pieces: readonly string[]): boolean {
  let at = 0;
  for (const p of pieces) {
    if (p === '') continue;
    const i = source.indexOf(p, at);
    if (i < 0) return false;
    at = i + p.length;
  }
  return true;
}

interface Walked { readonly text: string; readonly quotes: readonly { readonly act: string; readonly text: string }[] }

/**
 * The words of the body and the words of each real quote in it, in the order the openers stand (a nested quote's words are in its outer's too). A real quote at any depth is in the
 * list; a cut's Acts are not, since a cut is not shown.
 */
function walk(nodes: readonly BbNode[]): Walked {
  const words: string[] = [];
  const quotes: { act: string; text: string }[] = [];
  const starts: { slot: number; from: number }[] = [];
  const stack: Step[] = [];
  const pushAll = (list: readonly Step[]) => { for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]!); };
  const nodesAll = (list: readonly BbNode[]): Step[] => list.map((node) => ({ node }));
  const sep: Step = { word: SEPARATOR };
  const strip = (s: string) => s.replaceAll(CUT, '');
  pushAll(nodesAll(nodes));
  while (stack.length) {
    const step = stack.pop()!;
    if ('word' in step) { words.push(step.word); continue; }
    if ('exit' in step) {
      const open = starts.pop()!;
      quotes[open.slot]!.text = words.slice(open.from).join('');
      words.push(SEPARATOR);
      continue;
    }
    const n = step.node;
    switch (n.type) {
      case 'text': case 'noparse': case 'autolink':
        words.push(strip(n.text));
        break;
      case 'code':
        words.push(SEPARATOR, strip(n.text), SEPARATOR);
        break;
      case 'bold': case 'italic': case 'underline': case 'strike': case 'color': case 'size': case 'url': case 'ispoiler':
      case 'sub': case 'sup': case 'font': case 'glow': case 'shadow': case 'rainbow': case 'highlight':
        pushAll(nodesAll(n.children));
        break;
      case 'align': case 'marquee': case 'counterfeit':
        pushAll([sep, ...nodesAll(n.children), sep]);
        break;
      case 'spoiler':
        pushAll([sep, { word: strip(n.title) }, sep, ...nodesAll(n.children), sep]);
        break;
      case 'quote': {
        words.push(SEPARATOR);
        quotes.push({ act: n.act, text: '' });
        starts.push({ slot: quotes.length - 1, from: words.length });
        pushAll([...nodesAll(n.children), { exit: 0 }]);
        break;
      }
      case 'list': {
        const steps: Step[] = [];
        for (const item of n.items) { steps.push(sep, ...nodesAll(item)); }
        steps.push(sep);
        pushAll(steps);
        break;
      }
      case 'cut':
        words.push(SEPARATOR, CUT, SEPARATOR);
        break;
      case 'hr': case 'img': case 'video':
        words.push(SEPARATOR);
        break;
    }
  }
  return { text: words.join(''), quotes };
}

/** The words of a body, as they stand before normalizing (the cut marks in them). */
export const quoteWords = (nodes: readonly BbNode[]): string => walk(nodes).text;

/**
 * For each Act a real quote in the body names, the pieces of each of its quotes, in the order their openers stand (a cut's Acts, which are not shown, are not in it). The pieces of
 * a quote are its words, normalized and split at each cut mark.
 */
export function quoteHeld(nodes: readonly BbNode[]): Map<string, string[][]> {
  const held = new Map<string, string[][]>();
  for (const q of walk(nodes).quotes) {
    const list = held.get(q.act);
    const pieces = quotePieces(quoteNorm(q.text));
    if (list) list.push(pieces); else held.set(q.act, [pieces]);
  }
  return held;
}

/** The source of a version: the words of its whole body, normalized, the cut marks kept as separators. */
export const quoteSource = (nodes: readonly BbNode[]): string => quoteNorm(walk(nodes).text);

/**
 * The verdict an Act's payload carries (`forged`, the quoted posts whose quotes in the Act's words are doctored; the database writes it when the Act is written): the list, or undefined where the payload has none.
 * Every reader of an Act's words hands it to `parse` (as a set) so a forged quote is a counterfeit in the screen, the cards and the search alike. The list is the payload's own, so it is the same array each time the
 * Act is read and a component that holds it as a prop is not drawn again for it.
 */
export function forgedList(payload: Readonly<Record<string, unknown>> | null | undefined): readonly string[] | undefined {
  const list = payload?.['forged'];
  return Array.isArray(list) && list.length > 0 && list.every((x) => typeof x === 'string') ? (list as readonly string[]) : undefined;
}

/** A verdict as `parse` takes it, or undefined for none. */
export const forgedSet = (list: readonly string[] | undefined): ReadonlySet<string> | undefined => (list && list.length > 0 ? new Set(list) : undefined);

/**
 * A selection's words as a quote keeps them: as typed. Words that would read as a tag (`[b]`, `[/quote]`, `[url=...]`; the parser's tag names are letters or `*`) go in `[noparse]`, so the quote holds
 * no markup the post did not show. The cover ends at the first `[/noparse]`, so one inside the words is cut in two there (its `]` goes to a cover of its own),
 * which reads back as the same characters and can never end the cover early.
 */
export function asTyped(words: string): string {
  if (!/\[\/?[a-z*]/iu.test(words)) return words;
  return `[noparse]${words.replace(/\[\/noparse\]/giu, (closer) => `${closer.slice(0, -1)}[/noparse][noparse]]`)}[/noparse]`;
}
