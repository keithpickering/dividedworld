/**
 * A drawing in progress, the pure half of draw mode (docs/plans/2026-11-27-graffiti-everywhere-design.md, sections 1 to 4 and 7; plan Task 8): what the
 * drawing would add to the wall, what is sent, and the bounds a draw keeps to. Nothing here touches the page, so the browser, the toolbar's meter and the
 * tests count the same cells the server does (`coatsOf`, engine/rules/surface.ts, over the same widths the rules map the caps to).
 *
 * A **drawing** is freehand strokes (`Stroke`: the can, the cap and the points in px of the post body's box, at this screen's text size, so a stroke is
 * `CAPS_EM[cap]` ems wide) or a stencil at a spot, which the rules expand (`graffiti.surface.validateDraw`), so the preview, the count and the server
 * place it alike. A stroke longer than 300 points goes on in another stroke that starts on the point the last ended on (`part`); Undo takes both, and
 * what is sent leaves the mark out.
 *
 * **What is sent** (`inputOf`) is the draw `{ box, groups }`. The drawer's screen does the tagging: `groupsOf` (engine/rules/anchor.ts) cuts the strokes
 * into groups, and each group is attached to what is under its center, as `Tagging` (what this screen's layout says: where each word's mark is, where each
 * image is, and the post's current version) lets it be: an image whose rect holds the center (the group's points in image widths), else the word whose box
 * holds it or, in blank space, the nearest word by its mark's point (in ems, with the offset kept: a tag beside the last line stays beside it), else the
 * box. The server checks only the shape and the bounds.
 *
 * **The meter** is the wall's `covered` plus this drawing's own painted cells, counted in full: a tag's paint is its own coats, so ink over ink already
 * there is no longer free (design section 7), and the server's check is the one that decides.
 */
import { paintedCount, coatsOf, type SurfaceStroke } from '../../../../engine/rules/surface.ts';
import { groupsOf, type Attachment, type Img } from '../../../../engine/rules/anchor.ts';
import { BOUNDS, CANS, CAPS_EM, COATS, REACH, graffiti, type Can, type Cap } from '../graffiti.ts';
import type { StencilKey } from './stencils.ts';

/**
 * The least a wall needs of an Act: its kind and its payload. The same shape as spray.ts's `WallAct`, written out here because that module draws
 * on canvases and this one must run, and be type-checked, where there is no DOM (draft.test.ts runs under plain node).
 */
export interface WallAct { readonly kind: string; readonly payload: unknown }
export type Pt = [number, number];
export interface Stroke { can: Can; cap: Cap; points: Pt[]; /** Goes on from the stroke before it, which hit the 300-point bound. */ part?: true }
export type Draft =
  | { readonly kind: 'freehand'; readonly strokes: readonly Stroke[] }
  | { readonly kind: 'stencil'; readonly stencil: StencilKey; readonly can: Can; readonly spot: number };

/** What the meter says: the wall's cells now, with the drawing, and the limit, all of the grid's 10,000. */
export interface Meter { readonly wall: number; readonly after: number; readonly most: number; readonly over: boolean }

/* ------------------------------------------------------------------- what this screen says ---- */

/** A word's mark on this screen: its offset and length in the post's visible text, its left, and the top and height of its line, px from the box's top left. */
export interface Word { readonly start: number; readonly len: number; readonly x: number; readonly y: number; readonly h: number }
/** An image on this screen: its number among the post's drawn images (`data-kb-img`) and its rect, px from the box's top left. */
export interface Picture { readonly n: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** What a drawing is tagged against: the box (px) and the text size, the post's current version (null where the page does not know it), the post's visible text and images (`contentOf`), and where this screen put them. */
export interface Tagging {
  readonly box: { readonly w: number; readonly h: number };
  readonly emPx: number;
  readonly version: string | null;
  readonly text: string;
  readonly images: readonly Img[];
  readonly words: readonly Word[];
  readonly pictures: readonly Picture[];
}
/** A tagging with nothing measured: every group is attached to the box, at its spot. What the meter and the preview use, since neither depends on the attachment. */
export const bare = (box: { readonly w: number; readonly h: number }, emPx: number): Tagging => ({ box, emPx, version: null, text: '', images: [], words: [], pictures: [] });

/** The words of the visible text, split on whitespace: each one's first character and its length. */
export function wordsOf(text: string): { start: number; len: number }[] {
  return [...text.matchAll(/\S+/gu)].map((m) => ({ start: m.index, len: m[0].length }));
}

/* ---------------------------------------------------------------------- the can ---- */

/** The can a reader who has picked none is drawn with. */
export const DEFAULT_CAN: Can = 'cyan';
const canKey = (account: string) => `kb-graffiti-can:${account}`;

/** The can a reader picked last on this device, kept per account. Storage may be off or blocked: then the default can. */
export function lastCan(account: string | null): Can {
  try {
    const v = account ? localStorage.getItem(canKey(account)) : null;
    if (v && Object.hasOwn(CANS, v)) return v as Can;
  } catch { /* blocked or private: the default */ }
  return DEFAULT_CAN;
}

/** Keeps the can for the account, so the Draw tile and the next drawing start with it. */
export function rememberCan(account: string | null, can: Can): void {
  try { if (account) localStorage.setItem(canKey(account), can); } catch { /* blocked or private: the next drawing starts with the default */ }
}

/* ---------------------------------------------------------------------- the cells ---- */

const round = (digits: number) => (n: number) => Math.round(n * 10 ** digits) / 10 ** digits;
const [hundredth, tenThousandth] = [round(2), round(4)];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** How wide a word's box is taken to be, in ems per character, where only its mark (its left) is measured. */
const WORD_EM = 0.55;
/** The drawer's box bounds, in ems (graffiti.ts). */
const BOX_EM = { w: [5, 200], h: [1, 4000] } as const;

/** One group of the drawing, before it is attached: its strokes' indices, its center in px of the box. */
function groupsIn(strokes: readonly Stroke[], t: Tagging): { readonly strokes: readonly Stroke[]; readonly center: Pt }[] {
  const shapes = strokes.map((s) => ({ points: s.points, r: (CAPS_EM[s.cap] * t.emPx) / 2 }));
  return groupsOf(shapes).map((idx) => {
    const own = idx.map((i) => strokes[i]!);
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of own) for (const [x, y] of s.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { strokes: own, center: [(x0 + x1) / 2, (y0 + y1) / 2] };
  });
}

/** The distance from the point to the word's mark. */
const farFrom = (w: Word, [x, y]: Pt): number => Math.hypot(x - w.x, y - w.y);

/** What is under a group's center, by the design's section 3: an image that holds it; else the word whose box holds it, or the nearest word by its mark's point; else nothing. */
function underneath(center: Pt, t: Tagging): { readonly pic: Picture; readonly img: Img } | { readonly word: Word } | null {
  if (t.version === null) return null;
  const [cx, cy] = center;
  for (const pic of t.pictures) {
    const img = t.images[pic.n];
    if (img && pic.w > 0 && pic.h > 0 && cx >= pic.x && cx <= pic.x + pic.w && cy >= pic.y && cy <= pic.y + pic.h) return { pic, img };
  }
  const holds = t.words.find((w) => cx >= w.x && cx < w.x + w.len * WORD_EM * t.emPx && cy >= w.y && cy < w.y + w.h);
  if (holds) return { word: holds };
  // Blank space: the line the center is level with comes first (a tag beside a line stays beside it, on its last word if it is past the end); a center above or below every line takes the nearest mark.
  const level = t.words.filter((w) => cy >= w.y && cy < w.y + w.h);
  let nearest: Word | null = null;
  for (const w of level.length > 0 ? level : t.words) if (nearest === null || farFrom(w, center) < farFrom(nearest, center)) nearest = w;
  return nearest ? { word: nearest } : null;
}

/** The draw a drawing is sent as: its groups, each attached to what is under it on this screen. */
function drawOf(strokes: readonly Stroke[], t: Tagging): { box: { w: number; h: number }; groups: unknown[] } {
  const { box, emPx } = t;
  const groups = groupsIn(strokes, t).map((g) => {
    const [cx, cy] = g.center;
    const at: Pt = [tenThousandth(clamp(cx / box.w, 0, 1)), tenThousandth(clamp(cy / box.h, 0, 1))];
    /* The rules take a point only so far from its group's center, in the group's own unit (REACH): a group whose strokes reach past it in the unit of what it would be attached to (a small image under long strokes) is attached to the box. */
    const reaches = (unit: number, most: number) => g.strokes.every((s) => s.points.every(([x, y]) => Math.abs(x - cx) / unit <= most && Math.abs(y - cy) / unit <= most));
    const found = underneath(g.center, t);
    const under = found && ('pic' in found ? (reaches(found.pic.w, REACH.image) ? found : null) : (reaches(emPx, REACH.em) ? found : null));
    const strokesIn = (unit: number, keep: (n: number) => number) =>
      g.strokes.map((s) => ({ can: s.can, cap: s.cap, points: s.points.map(([x, y]): Pt => [keep((x - cx) / unit), keep((y - cy) / unit)]) }));
    if (under && 'pic' in under) {
      const { pic, img } = under;
      const anchor: Attachment = { kind: 'image', version: t.version!, n: pic.n, src: img.src, nth: img.nth, x: tenThousandth((cx - pic.x) / pic.w), y: tenThousandth((cy - pic.y) / pic.h) };
      return { at, anchor, unit: 'image' as const, em: hundredth(clamp(pic.w / emPx, 0.5, 400)), strokes: strokesIn(pic.w, tenThousandth) };
    }
    const anchor: Attachment = under
      ? { kind: 'text', version: t.version!, at: under.word.start, len: under.word.len, dx: hundredth((cx - under.word.x) / emPx), dy: hundredth((cy - under.word.y) / emPx) }
      : { kind: 'box' };
    return { at, anchor, unit: 'em' as const, strokes: strokesIn(emPx, hundredth) };
  });
  return { box: { w: hundredth(clamp(box.w / emPx, ...BOX_EM.w)), h: hundredth(clamp(box.h / emPx, ...BOX_EM.h)) }, groups };
}

/** The drawing as the engine counts it: what the rules frame a draw (or a stencil, which they expand) as. */
export function engineStrokes(draft: Draft, t: Tagging): readonly SurfaceStroke[] {
  const v = graffiti.surface!.validateDraw(inputOf(draft, t));
  return v.ok ? (v.value as { strokes: readonly SurfaceStroke[] }).strokes : [];
}

/**
 * The meter's figures: the wall's cells now (`covered`, the server's) and with the drawing's own painted cells added in full, however much of them lie over
 * ink already there. The attachment changes nothing it counts, so a `Tagging` with nothing measured (`bare`) gives the same figure.
 */
export function meterOf(covered: number, draft: Draft | null, most: number, t: Tagging): Meter {
  const after = draft ? covered + paintedCount(coatsOf(engineStrokes(draft, t), COATS)) : covered;
  return { wall: covered, after, most, over: after > most };
}

/** A whole percent of the grid, rounded down as the wall's view says it. */
export const percent = (cells: number): number => Math.floor(cells / 100);

/** Why Tag it waits when the drawing is over the limit: the figure the wall would stand at, rounded up so it is never the limit itself. */
export const overWords = (m: Meter): string => `This tag would take the wall to ${Math.ceil(m.after / 100)}%; its limit is ${percent(m.most)}%`;

/* ------------------------------------------------------------------ what is sent ---- */

/** What the card's draw takes: the box and the groups of the freehand strokes, attached on this screen, or a stencil's three names. */
export function inputOf(draft: Draft, t: Tagging): unknown {
  if (draft.kind === 'stencil') return { stencil: draft.stencil, can: draft.can, spot: draft.spot };
  return drawOf(draft.strokes, t);
}

/** The drawing as the painter takes a draw (spray.ts), to be drawn into the wall's layer: where it was drawn, whatever it is attached to; null for no drawing. */
export function paintAct(draft: Draft | null, t: Tagging): WallAct | null {
  if (!draft) return null;
  if (draft.kind === 'freehand') return { kind: 'draw', payload: drawOf(draft.strokes, bare(t.box, t.emPx)) };
  const v = graffiti.surface!.validateDraw({ stencil: draft.stencil, can: draft.can, spot: draft.spot });
  return v.ok ? { kind: 'draw', payload: (v.value as { payload: unknown }).payload } : null;
}

/* ------------------------------------------------------------------ the bounds ---- */

/**
 * Adds a point to the last stroke, within the bounds a draw keeps to (`BOUNDS`): at most 300 points in a stroke (a longer one goes on in another
 * that starts where it ended), 120 strokes and 3,000 points in all. At a bound nothing is added and the answer says which.
 */
export function addPoint(strokes: Stroke[], p: Pt): 'ok' | 'strokes' | 'points' {
  const last = strokes.at(-1);
  if (!last) return 'ok';
  const total = strokes.reduce((n, s) => n + s.points.length, 0);
  if (last.points.length < BOUNDS.points) {
    if (total + 1 > BOUNDS.totalPoints) return 'points';
    last.points.push(p);
    return 'ok';
  }
  if (strokes.length >= BOUNDS.strokes) return 'strokes';
  if (total + 2 > BOUNDS.totalPoints) return 'points';
  strokes.push({ can: last.can, cap: last.cap, points: [last.points.at(-1)!, p], part: true });
  return 'ok';
}

/** Takes back the last stroke, and the parts that go on from it. */
export function undo(strokes: Stroke[]): void {
  while (strokes.at(-1)?.part) strokes.pop();
  strokes.pop();
}
