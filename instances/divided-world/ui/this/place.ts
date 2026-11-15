/**
 * Where each THIS note stands on a post (docs/plans/2026-11-13-this-design.md, sections 2 and 3; plan Task 7). Pure: the search over a post's
 * visible text, and the measuring's arithmetic over plain numbers, so the effect's tests need no layout.
 *
 * - **The search** is the card's own (`pointsAt`, over the engine's one matcher), and a phrase that is in the text more than once points at the first, so the
 *   one rule holds at a cast, at a spring and after any edit. A play whose phrase is not found is a receipt (`at: null`).
 * - **The measuring** (`layOut`) is given each note's line and boxes and answers each gap's height, each note's top and each arrow's path.
 *   A gap's height is made of the line's height, the notes' heights and two constants, never of where anything is, so it is the same whatever
 *   the gaps above it did: that is what lets the effect write every height once and place the notes in the same pass.
 */
import { pointsAt, type Stretch } from '../../cards/this.ts';

/** The most a note may stand over what it points at: the arrow's room, between the line's foot and the note's top (px). */
export const ROOM = 22;
/** What a note leaves under itself before the words go on (px). */
export const PAD = 8;
/** How far the arrow's tip stays from the wrapper's edges (px). */
const EDGE = 14;

/** What a place needs of a play: its id and its own configuration. */
export interface PlayLike {
  readonly id: string;
  readonly config: Readonly<Record<string, unknown>>;
}

/** A wedge (`at` the phrase's first place in the text) or a receipt (`at` null). */
export interface Place<P extends PlayLike = PlayLike> {
  readonly play: P;
  readonly at: Stretch | null;
}

/** The first place `phrase` is in `text`, or null. */
export function standsAt(text: string, phrase: string): Stretch | null {
  return pointsAt(text, phrase);
}

/**
 * Each play's place in `text`, in the order given. A play whose configuration holds no phrase (a configuration the rules would have refused) is no
 * place at all, so a sweep over arbitrary configurations draws nothing for it.
 */
export function placesOf<P extends PlayLike>(text: string, plays: readonly P[]): Place<P>[] {
  const out: Place<P>[] = [];
  for (const play of plays) {
    const phrase = play.config['phrase'];
    if (typeof phrase !== 'string') continue;
    out.push({ play, at: standsAt(text, phrase) });
  }
  return out;
}

/** One wedge's boxes, in px relative to the wrapper (`.dw-this`), as the effect read them. */
export interface Spot {
  readonly id: string;
  /** The top of the line the gap sits on (the gap's own top: it is top-aligned in its line). */
  readonly lineTop: number;
  /** The height of one line of the post's words there. */
  readonly lineHeight: number;
  /** The drawn note's height at the wrapper's width. */
  readonly noteHeight: number;
  /** Where the arrow starts: the middle of the note's THIS. */
  readonly wordX: number;
  /** The last line piece of the phrase, or, where no highlight is drawn, a piece ending where the phrase does. */
  readonly piece: { readonly left: number; readonly width: number };
}

export interface Laid {
  readonly id: string;
  /** The gap's height: its line, and every note stood on that line up to and including this one. */
  readonly gapHeight: number;
  /** The note's top, relative to the wrapper. */
  readonly noteTop: number;
  /** The arrow's path, in the note's own coordinates (its top-left is 0,0). */
  readonly arrow: string;
}

const two = (n: number): number => Math.round(n * 100) / 100;

/**
 * Lays the notes out, answering in the order given. Notes whose lines have the same top (within 1.5px) stand one under the other in the
 * order given, and each one's gap carries the sum of those above it and its own, so the line they share, which is as tall as its tallest gap,
 * is the whole stack. The arrow runs from the middle of THIS up to a tip 1px under the line, under the middle of the phrase's last piece and
 * held inside the wrapper's width.
 */
export function layOut(spots: readonly Spot[], width: number): Laid[] {
  const lines: { top: number; used: number }[] = [];
  return spots.map((s) => {
    let line = lines.find((l) => Math.abs(l.top - s.lineTop) <= 1.5);
    if (!line) { line = { top: s.lineTop, used: 0 }; lines.push(line); }
    const above = line.used;
    line.used += ROOM + s.noteHeight + PAD;
    const lineBottom = line.top + s.lineHeight;
    const noteTop = lineBottom + above + ROOM;
    const gapHeight = Math.ceil(s.lineHeight + line.used);
    const tipX = Math.min(Math.max(s.piece.left + s.piece.width / 2, EDGE), Math.max(EDGE, width - EDGE));
    const tipY = lineBottom - 1 - noteTop;
    const up = tipX >= s.wordX ? 1 : -1;
    const n = (v: number) => String(two(v));
    const arrow = `M${n(s.wordX)},0 Q${n(s.wordX + 4 * up)},${n(tipY + 9)} ${n(tipX)},${n(tipY + 2)} m${n(-10 * up)},-3 l${n(10 * up)},3 l${n(-7 * up)},9`;
    return { id: s.id, gapHeight, noteTop: two(noteTop), arrow };
  });
}
