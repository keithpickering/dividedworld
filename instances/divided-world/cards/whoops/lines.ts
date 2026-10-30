/**
 * The lines of a splatted post's text, as the fixed layout breaks them: where each lies down the layout
 * (in widths) and its words, read from the page's own layout with ranges, a word at a time. Whoops!
 * (Effect.tsx) uses them to hide a line from a screen reader while ink covers it and read it out once it
 * does not, as the eye does. The layout is one width whatever the screen, so the lines are the same on
 * every screen and are read once for the post's words, not once per size.
 *
 * A browser that cannot measure a range (it has no `getClientRects` on one) gives no lines, and the
 * Effect then treats the post as one block: covered while any layer holds ink, read once none does.
 */
import { REF_WIDTH, ROW, type TextLine } from './scrub.ts';

/** Words closer than this many widths down are one line (bold or a link in mid-line sits a pixel off its neighbors): under half a line. */
const SAME_LINE = ROW / 4;

export function readLines(layout: HTMLElement, scale: number): TextLine[] {
  const probe = document.createRange();
  if (typeof probe.getClientRects !== 'function') return [];
  const origin = layout.getBoundingClientRect();
  const unit = REF_WIDTH * scale;
  const words: { top: number; bottom: number; at: number; text: string }[] = [];
  const walk = document.createTreeWalker(layout, NodeFilter.SHOW_TEXT);
  let order = 0;
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const data = node.nodeValue ?? '';
    for (const m of data.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, m.index!);
      range.setEnd(node, m.index! + m[0].length);
      const box = range.getClientRects()[0];
      if (!box) continue;
      words.push({ top: (box.top - origin.top) / unit, bottom: (box.bottom - origin.top) / unit, at: order++, text: m[0] });
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
    .map((l) => ({ top: l.top, bottom: l.bottom, text: l.words.sort((a, b) => a.at - b.at).map((w) => w.text).join(' ') }));
}
