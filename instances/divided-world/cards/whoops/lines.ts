/**
 * The lines of a splatted post's text as this screen lays them out: where each lies down the body's box (in
 * shares of its height) and its words, read from the page's own layout with ranges, a word at a time. Whoops!
 * (Effect.tsx) uses them to hide a line from a screen reader while ink covers it and read it out once it does
 * not, as the eye does. The box is the screen's own, so the lines are read again when it is resized.
 *
 * A browser that cannot measure a range (it has no `getClientRects` on one) gives no lines, and the
 * Effect then treats the post as one block: covered while any layer holds ink, read once none does.
 */
import { ROW_PX, type TextLine } from './scrub.ts';
import type { Box } from './splat.ts';

/** Words closer than this many px down are one line (bold or a link in mid-line sits a pixel off its neighbors): under half a line. */
const SAME_LINE = ROW_PX / 4;

/** `root` is the element whose top is the box's; `box` is its size on this screen, px. Tops and bottoms come back as shares of `box.h`. */
export function readLines(root: HTMLElement, box: Box): TextLine[] {
  const probe = document.createRange();
  if (typeof probe.getClientRects !== 'function') return [];
  const origin = root.getBoundingClientRect();
  const words: { top: number; bottom: number; at: number; text: string }[] = [];
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let order = 0;
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const data = node.nodeValue ?? '';
    for (const m of data.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, m.index!);
      range.setEnd(node, m.index! + m[0].length);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      words.push({ top: rect.top - origin.top, bottom: rect.bottom - origin.top, at: order++, text: m[0] });
    }
  }
  const lines: { top: number; bottom: number; words: typeof words }[] = [];
  for (const w of words) {
    const line = lines.find((l) => Math.abs((l.top + l.bottom) / 2 - (w.top + w.bottom) / 2) < SAME_LINE);
    if (line) {
      line.words.push(w);
      line.top = Math.min(line.top, w.top);
      line.bottom = Math.max(line.bottom, w.bottom);
    } else {
      lines.push({ top: w.top, bottom: w.bottom, words: [w] });
    }
  }
  return lines
    .sort((a, b) => a.top - b.top)
    .map((l) => ({ top: l.top / box.h, bottom: l.bottom / box.h, text: l.words.sort((a, b) => a.at - b.at).map((w) => w.text).join(' ') }));
}
