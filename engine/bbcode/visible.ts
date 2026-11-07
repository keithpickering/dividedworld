/**
 * A post's visible text: the words a reader sees as the post's own, in the order the renderer
 * (engine/ui/bbcode/render.tsx) draws them, with an offset for every text node in it. A card that
 * works on a post's words (an instance's phrase matcher) reads this string on the server and on the
 * screens, and the renderer's text layers (engine/ui/bbcode/layers.tsx) take runs over the same
 * offsets, so both sides agree on where a word is because both read this one walk.
 *
 * What counts. The text inside bold, italic, underline, strike, color, size, list items and a
 * counterfeit quote, a spoiler and an inline spoiler (a name typed by hand or an id, not an Act) is the
 * post's own. A real quote holds another post's words, code holds text that is not prose, a link's words
 * are its target's name and an image has none: each leaves one `\n` in its place and none of its
 * words, so no word is joined across it. Each list item starts with a `\n`, and a list ends with one,
 * so its items are kept apart from each other and from the words around it.
 *
 * The walk keeps its own stack, never recursion; the parser's nesting cap (`MAX_DEPTH`) bounds it
 * anyway, and its work grows with the tree's nodes.
 */
import type { BbNode } from './parse.ts';

/** What stands in the visible text for anything that is not the post's own words. */
export const SEPARATOR = '\n';

type Step = { readonly node: BbNode } | { readonly sep: true };

/** The visible text, and each kept text node's offset into it (by node identity, as the tree holds it). */
export function visibleWalk(nodes: readonly BbNode[]): { text: string; offsets: Map<BbNode, number> } {
  let text = '';
  const offsets = new Map<BbNode, number>();
  const stack: Step[] = [];
  const pushAll = (list: readonly Step[]) => { for (let i = list.length - 1; i >= 0; i--) stack.push(list[i]!); };
  pushAll(nodes.map((node) => ({ node })));
  while (stack.length) {
    const step = stack.pop()!;
    if ('sep' in step) { text += SEPARATOR; continue; }
    const n = step.node;
    switch (n.type) {
      case 'text':
        offsets.set(n, text.length);
        text += n.text;
        break;
      case 'bold': case 'italic': case 'underline': case 'strike': case 'color': case 'size': case 'counterfeit': case 'spoiler': case 'ispoiler':
        pushAll(n.children.map((node) => ({ node })));
        break;
      case 'list': {
        const steps: Step[] = [];
        for (const item of n.items) { steps.push({ sep: true }); for (const node of item) steps.push({ node }); }
        steps.push({ sep: true });
        pushAll(steps);
        break;
      }
      case 'quote': case 'code': case 'url': case 'img':
        text += SEPARATOR;
        break;
    }
  }
  return { text, offsets };
}

/** The post's visible text alone. */
export const visibleText = (nodes: readonly BbNode[]): string => visibleWalk(nodes).text;
