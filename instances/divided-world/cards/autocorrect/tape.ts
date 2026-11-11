/**
 * The tape's model: what a strip is, where its words and room sit, how its words are dealt across lines, how a half-peeled
 * strip maps onto a screen's pieces and back, and the numbers a peel and a peek move by (the Autocorrect tape design,
 * sections 1, 2, 6, 7, 8 and 9). Plain functions, no DOM: the Effect measures and draws, and these decide.
 *
 * - **A strip** is one occurrence of one play's phrase (match.ts), with the play's order as its height, later on top. A
 *   **stack** is a run of strips whose words overlap.
 * - **Room** is what a strip lacks after its words to hold its replacement at full size, made of break-spaces and placed right
 *   after that strip's own words (the bench's `footprint`, with `measure` standing in for canvas calls).
 * - **Pieces** belong to a screen: one per line the footprint crosses. What is saved is in shares of the whole strip, and every
 *   screen cuts those at its own line breaks (`piecesOf`, `fromPieces`).
 * - **A stretch** is `[from, to, edges]`, as the card's saved state keeps it (autocorrect.ts). On a piece the same triple is in
 *   local pixels. A line break cuts a stretch with kind 0, a strip's own end, so a cut is never taken for a peel line or a tear,
 *   and `fromPieces` joins the two halves of a cut back into the stretch they came from.
 */
import { occurrences } from './match.ts';
import type { Stretch } from '../autocorrect.ts';

/** One play as the strips read it. */
export interface TapePlay {
  readonly id: string;
  readonly phrase: string;
  readonly replacement: string;
}

/** One strip: a play's occurrence at offsets into the visible text, its place in the play, and its height (the play's order). */
export interface TapeStrip {
  /** `${play}:${index}`, which a peel is kept by. */
  readonly key: string;
  readonly play: string;
  readonly index: number;
  readonly z: number;
  readonly from: number;
  readonly to: number;
  readonly replacement: string;
}

/** What a screen can measure, in pixels. */
export interface Measure {
  /** The author's words from offset `from` to `to`, at body size. */
  words(from: number, to: number): number;
  /** A replacement at the marker's full size, without padding. */
  replacement(text: string): number;
  /** One break-space. */
  space: number;
  /** The padding on each side of a piece's writing. */
  pad: number;
}

const overlaps = (a: { from: number; to: number }, b: { from: number; to: number }) => a.from < b.to && b.from < a.to;

/** Every strip of every play, in play order then the post's order, the stacks they fall into, and each play's count of places. */
export function stripsOf(text: string, plays: readonly TapePlay[]): { strips: TapeStrip[]; stacks: TapeStrip[][]; total: Record<string, number> } {
  const strips: TapeStrip[] = [];
  const total: Record<string, number> = {};
  plays.forEach((p, z) => {
    const found = occurrences(text, p.phrase);
    total[p.id] = found.length;
    found.forEach(({ from, to }, index) => strips.push({ key: `${p.id}:${index}`, play: p.id, index, z, from, to, replacement: p.replacement }));
  });
  const stacks: TapeStrip[][] = [];
  let stack: TapeStrip[] = [];
  let reach = -1;
  for (const s of [...strips].sort((a, b) => a.from - b.from || a.z - b.z)) {
    if (s.from >= reach && stack.length) {
      stacks.push(stack);
      stack = [];
    }
    stack.push(s);
    reach = Math.max(reach, s.to);
  }
  if (stack.length) stacks.push(stack);
  return { strips, stacks, total };
}

/**
 * The break-spaces to add at each distinct end offset of a stack's strips, in ascending order of end. A strip's room is what it
 * lacks after its words and any room already set strictly inside it; the larger of the strips ending together wins. A strip in
 * `saved` (the author peeled it before this load) takes its words' own width and is left out.
 */
export function roomOf(stack: readonly TapeStrip[], measure: Measure, saved: ReadonlySet<string> = new Set()): Map<number, number> {
  /* The kept strips by end, once; the rooms set so far, ascending by end, with running totals, so a strip's inner rooms are two searches. */
  const byEnd = new Map<number, TapeStrip[]>();
  for (const s of stack) if (!saved.has(s.key)) (byEnd.get(s.to) ?? byEnd.set(s.to, []).get(s.to)!).push(s);
  const fills = new Map<number, number>();
  const ats: number[] = [];
  const upTo: number[] = [0];
  /* The count of the first `i` rooms' break-spaces; `ats` is ascending, so the rooms strictly between two offsets are a run of it. */
  const after = (x: number) => { let lo = 0, hi = ats.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ats[mid]! <= x) lo = mid + 1; else hi = mid; } return lo; };
  const before = (x: number) => { let lo = 0, hi = ats.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (ats[mid]! < x) lo = mid + 1; else hi = mid; } return lo; };
  for (const end of [...byEnd.keys()].sort((a, b) => a - b)) {
    let need = 0;
    for (const s of byEnd.get(end)!) {
      let have = measure.words(s.from, end);
      const lo = after(s.from);
      const hi = before(end);
      if (hi > lo) have += (upTo[hi]! - upTo[lo]!) * measure.space;
      need = Math.max(need, measure.replacement(s.replacement) + 2 * measure.pad - have);
    }
    if (need > 0) {
      const n = Math.ceil(need / measure.space);
      fills.set(end, n);
      ats.push(end);
      upTo.push(upTo[upTo.length - 1]! + n);
    }
  }
  return fills;
}

/** Whether nothing live lies over the strip: only an exposed strip can be picked, peeled or peeked. */
export const exposed = (strip: TapeStrip, live: readonly TapeStrip[]): boolean => !live.some((q) => q.z > strip.z && overlaps(q, strip));

/**
 * Deals a replacement's words across a strip's pieces: each piece but the last takes the words that fit its capacity, a word
 * that does not fit goes to the next piece, and the last takes the rest. Only when the last would overflow does the marker
 * shrink, in 0.05 steps, down to 0.6. `measureAt(text, scale)` is the width of text at that scale of the marker.
 */
export function dealWords(replacement: string, capacities: readonly number[], measureAt: (text: string, scale: number) => number): { words: string[]; scale: number } {
  const all = replacement.split(' ');
  let out = { words: [replacement], scale: 1 };
  for (let step = 0; step <= 8; step++) {
    const scale = Math.round((1 - 0.05 * step) * 100) / 100;
    const words: string[] = [];
    let at = 0;
    capacities.forEach((cap, i) => {
      const line: string[] = [];
      if (i === capacities.length - 1) {
        line.push(...all.slice(at));
        at = all.length;
      } else while (at < all.length && measureAt([...line, all[at] ?? ''].join(' '), scale) <= cap) line.push(all[at++] ?? '');
      words.push(line.join(' '));
    });
    out = { words: words.length ? words : [replacement], scale };
    const lastCap = capacities[capacities.length - 1];
    if (lastCap === undefined || measureAt(words[words.length - 1] ?? '', scale) <= lastCap + 1e-9) return out;
  }
  return out;
}

/** What a saved state keeps for the strips of one play, as `stuckOf` reads it. */
export interface SavedTape {
  readonly peeled: readonly number[];
  readonly stuck?: Readonly<Record<string, readonly Stretch[]>>;
}

/** The stretches of a strip still stuck: its saved ones, none if the author peeled it whole, the whole strip if it was never touched. */
export function stuckOf(saved: SavedTape, place: number): Stretch[] {
  if (saved.peeled.includes(place)) return [];
  const own = saved.stuck?.[String(place)];
  return own ? own.map((s) => [s[0], s[1], s[2]] as const) : [[0, 1, 0]];
}

const EPS = 1e-7;
/*
 * Tape narrower than this on a piece is no tape there: a screen that breaks its line a hair from where another did would otherwise
 * keep a sliver no hand can grip on the next line, and the strip could never be peeled. The edge moves to the line's end instead.
 */
const SLIVER = 0.5;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const total = (widths: readonly number[]) => widths.reduce((a, b) => a + b, 0);

/**
 * Maps shares of a strip onto a screen's pieces, which are one per line. Each piece gets its stuck intervals in local pixels,
 * with edge kinds; a stretch crossing a piece boundary is cut there, and every such cut is kind 0 on that side.
 */
export function piecesOf(stretches: readonly Stretch[], widths: readonly number[]): Stretch[][] {
  const length = total(widths);
  let off = 0;
  return widths.map((w) => {
    const base = off;
    off += w;
    const out: Stretch[] = [];
    for (const [from, to, edges] of stretches) {
      const a = from * length;
      const b = to * length;
      if (Math.min(b, base + w) - Math.max(a, base) < SLIVER) continue;
      const startsHere = a > base - SLIVER;
      const endsHere = b < base + w + SLIVER;
      const lo = startsHere ? Math.max(0, a - base) : 0;
      const hi = endsHere ? Math.min(w, b - base) : w;
      out.push([lo, hi, (startsHere ? Math.floor(edges / 3) : 0) * 3 + (endsHere ? edges % 3 : 0)]);
    }
    return out;
  });
}

/** The inverse of `piecesOf`: a screen's pieces back into stretches, joining across a boundary where a stuck interval touches both sides. */
export function fromPieces(intervals: readonly (readonly Stretch[])[], widths: readonly number[]): Stretch[] {
  const length = total(widths);
  const out: { from: number; to: number; start: number; end: number }[] = [];
  let off = 0;
  intervals.forEach((list, i) => {
    list.forEach(([lo, hi, edges], j) => {
      const start = Math.floor(edges / 3);
      const end = edges % 3;
      const prev = out[out.length - 1];
      if (j === 0 && prev && prev.end === 0 && start === 0 && lo <= EPS && Math.abs(prev.to - off) <= EPS) {
        prev.to = off + hi;
        prev.end = end;
      } else out.push({ from: off + lo, to: off + hi, start, end });
    });
    off += widths[i] ?? 0;
  });
  return out.map((s) => [round4(s.from / length), round4(s.to / length), s.start * 3 + s.end] as const);
}

/**
 * One tick of an author's peel. `want` is how far the hand is ahead of the peel line; the line moves by at most `pace` px a
 * second of it, and what it moves is added to `rolled`. A hand still more than `give` ahead after the move builds strain at 1.2 + (lag - give) / 30 a
 * second; a hand within `give` drains it at 2.5 a second; at 1 the tape tears.
 */
export function peelStep(p: { readonly rolled: number; readonly strain: number }, want: number, dt: number, s: { readonly pace: number; readonly give: number }): { moved: number; rolled: number; strain: number; tore: boolean } {
  const moved = Math.min(Math.max(0, want), s.pace * dt);
  /* The lag is what the hand is still ahead once the line has moved, as on the bench: a key that asks for the pace leaves none. */
  const lag = Math.max(0, want - moved);
  const strain = Math.min(1, Math.max(0, lag > s.give ? p.strain + (1.2 + (lag - s.give) / 30) * dt : p.strain - 2.5 * dt));
  return { moved, rolled: p.rolled + moved, strain, tore: strain >= 1 };
}

/** The roll's diameter after `rolled` pixels of tape: √(9 + 0.55 · rolled). */
export const rollDiameter = (rolled: number): number => Math.sqrt(9 + 0.55 * Math.max(0, rolled));

/** One pull along a chain of pieces lifts them in turn: piece i gets the pull less the widths before it, clamped to its width. */
export function liftsOf(pull: number, widths: readonly number[]): number[] {
  let before = 0;
  return widths.map((w) => {
    const lift = Math.min(w, Math.max(0, pull - before));
    before += w;
    return lift;
  });
}

/** One tick of a peek after a let-go: `pull` holds until `since` (ms since the let-go) passes `stay`, then falls at `speed` px a second to 0. */
export function settle(pull: number, stay: number, since: number, dtMs: number, speed: number): { pull: number; since: number } {
  const fallMs = Math.max(0, since + dtMs - Math.max(stay, since));
  return { pull: Math.max(0, pull - (speed * fallMs) / 1000), since: since + dtMs };
}

/** The lifted part of a peek as a plane hinged at the fold: 150 degrees for a small lift to 92 for a full one, in perspective so its free end stands at most about half again as tall as the fold. */
export function flapOf(lift: number, width: number, height: number): { theta: number; perspective: number } {
  const share = Math.min(1, Math.max(0, lift / Math.max(1, width)));
  return { theta: 150 - 58 * share, perspective: Math.max(13 * height, 3 * lift) };
}
