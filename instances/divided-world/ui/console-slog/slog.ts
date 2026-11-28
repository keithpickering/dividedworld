/**
 * Console Slog's mash, with no DOM (docs/plans/2026-11-27-season-two-cards-design.md, section 3): what a press reveals, and how a streak of presses makes
 * each worth more.
 *
 * The units. A post's parsed BBCode (engine/bbcode/parse.ts) becomes one list of units, each a thing a press may reveal: a character, or one band of an
 * image. The reader's progress is a count of them, so the same post is the same list for every reader, and an edit that changes the words changes the list
 * (the count is trimmed to its length, Effect.tsx). What prints: words as they are; a quote's every line behind `> `; a link's text, then its address in
 * brackets (every unit of one link carries its index, its address, and which part it is, so the effect draws one link that works once all of them are
 * out); code as it is; an image's `[IMG] name` line, then its bands; a rule as a line of dashes; a list's items behind `* ` or their number. The
 * formatting (bold, color, size and the rest) prints as the words alone: a terminal has one face. Nothing here reads a pixel of an image.
 *
 * The momentum. A press is a fresh key press or a tap. One within `rhythmMs` of the last builds a streak by one; each `perStep` presses of streak make a press
 * worth one more unit, to `mostPerPress`. A pause lets the streak drain by `drain` a second once the rhythm has lapsed, and a press after one starts
 * from what drained, less a step: breaking the rhythm costs. All four are the settings' (`consoleSlog.*`), so the mash is tuned, not rewritten.
 */
import type { BbNode } from '../../../../engine/bbcode/parse.ts';

/** What one press may reveal. A band is a slice of an image, from the top: `band` of `bands`, 0 first. */
export type Unit =
  | { readonly kind: 'char'; readonly ch: string; readonly link?: number; readonly href?: string; readonly part?: 'text' | 'address' }
  | { readonly kind: 'band'; readonly src: string; readonly band: number; readonly bands: number };

/** The settings' numbers the mash reads (`consoleSlog.*`, instances/divided-world/cards/console-slog.ts). */
export interface SlogSettings {
  readonly rhythmMs: number;
  readonly perStep: number;
  readonly mostPerPress: number;
  readonly drain: number;
  readonly bands: number;
}

/** An image's name: the last part of its address's path, decoded, or the address when there is none. */
export function imageName(src: string): string {
  try {
    const last = new URL(src).pathname.split('/').filter((p) => p !== '').pop();
    return last === undefined ? src : decodeURIComponent(last);
  } catch {
    return src;
  }
}

/** The units of a post's parsed words, `bands` bands to an image. */
export function unitsOf(nodes: readonly BbNode[], bands = 16): Unit[] {
  const out: Unit[] = [];
  let links = 0;
  const chars = (text: string, into: Unit[] = out, more: { link?: number; href?: string; part?: 'text' | 'address' } = {}): void => {
    for (const ch of text) into.push({ kind: 'char', ch, ...more });
  };
  /* A line of its own: a newline first when the print is not at the start of a line. */
  const startLine = (into: Unit[]): void => {
    const last = into.at(-1);
    if (last !== undefined && !(last.kind === 'char' && last.ch === '\n')) chars('\n', into);
  };
  const link = (text: string, href: string, into: Unit[]): void => {
    const own = { link: links++, href };
    chars(text, into, { ...own, part: 'text' });
    chars(` [${href}]`, into, { ...own, part: 'address' });
  };
  const walk = (list: readonly BbNode[], into: Unit[]): void => {
    for (const n of list) {
      switch (n.type) {
        case 'text': case 'noparse': chars(n.text, into); break;
        case 'autolink': link(n.text, n.href, into); break;
        case 'url': {
          const inner: Unit[] = [];
          walk(n.children, inner);
          link(inner.map((u) => (u.kind === 'char' ? u.ch : '')).join(''), n.href, into);
          break;
        }
        case 'code': startLine(into); chars(n.text, into); chars('\n', into); break;
        case 'img': {
          startLine(into);
          chars(`[IMG] ${imageName(n.src)}\n`, into);
          for (let band = 0; band < bands; band++) into.push({ kind: 'band', src: n.src, band, bands });
          break;
        }
        case 'video': startLine(into); chars('[VIDEO]\n', into); break;
        case 'hr': startLine(into); chars('--------\n', into); break;
        case 'quote': case 'counterfeit': {
          const inner: Unit[] = [];
          walk(n.children, inner);
          startLine(into);
          chars('> ', into);
          for (const [i, u] of inner.entries()) {
            into.push(u);
            if (u.kind === 'char' && u.ch === '\n' && i < inner.length - 1) chars('> ', into);
          }
          startLine(into);
          break;
        }
        case 'list':
          for (const [i, item] of n.items.entries()) {
            startLine(into);
            chars(n.ordered ? `${i + 1}. ` : '* ', into);
            walk(item, into);
          }
          startLine(into);
          break;
        case 'cut': break;
        default: walk(n.children, into);
      }
    }
  };
  walk(nodes, out);
  return out;
}

/** What a streak drains to after `idleMs` since the last press: nothing drains while the rhythm holds, then `drain` presses a second. */
export function drained(streak: number, idleMs: number, s: SlogSettings): number {
  return Math.max(0, streak - (s.drain * Math.max(0, idleMs - s.rhythmMs)) / 1000);
}

/** The streak after a press `sinceLastMs` after the last: one more in rhythm; out of it, what drained over the pause, less a step. */
export function nextStreak(streak: number, sinceLastMs: number, s: SlogSettings): number {
  return sinceLastMs <= s.rhythmMs ? streak + 1 : Math.max(0, drained(streak, sinceLastMs, s) - s.perStep);
}

/** How many units a press reveals at this streak: one, and one more for each `perStep` of streak, to `mostPerPress`. */
export function pressWorth(streak: number, s: SlogSettings): number {
  return Math.min(s.mostPerPress, 1 + Math.floor(streak / s.perStep));
}
