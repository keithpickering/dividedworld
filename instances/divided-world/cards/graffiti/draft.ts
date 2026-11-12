/**
 * A drawing in progress, the pure half of draw mode (plan Task 10; design sections 2, 6, 8 and 9): what the wall holds now, what the drawing
 * would add to it, what is sent, and the bounds a draw keeps to. Nothing here touches the page, so the browser, the toolbar's meter and the
 * tests count the same cells the server does (`cellsOf`, engine/rules/surface.ts, over the same widths the rules map the caps to).
 *
 * A **drawing** is freehand strokes (`Stroke`: the can, the cap, the drawer's aspect and the points in shares of the post body's box) or a
 * stencil at a spot, which the rules expand (`graffiti.surface.validateDraw`), so the preview, the count and the server place it alike. A
 * stroke longer than 300 points goes on in another stroke that starts on the point the last ended on (`part`); Undo takes both, and what is
 * sent leaves the mark out.
 *
 * **The meter.** The wall's cells are its live draws less the washes after them, in order; the drawing's cells are unioned in, so ink over
 * ink already there counts nothing more. A wall whose strokes have not been read yet is known only by the cells the server says it covers
 * (`covered`), and the drawing is counted on top of them: more than the truth where the two overlap, never less, and the server's check
 * is the one that decides.
 */
import { cellsOf, count, minus, union, type Cells, type SurfaceStroke } from '../../../../engine/rules/surface.ts';
import { BOUNDS, CANS, CAPS, SPONGE, graffiti, type Can, type Cap } from '../graffiti.ts';
import type { StencilKey } from './stencils.ts';

/**
 * The least a wall needs of an Act: its kind and its payload. The same shape as spray.ts's `WallAct`, written out here because that module draws
 * on canvases and this one must run, and be type-checked, where there is no DOM (draft.test.ts runs under plain node).
 */
export interface WallAct { readonly kind: string; readonly payload: unknown }
export type Pt = [number, number];
export interface Stroke { can: Can; cap: Cap; aspect: number; points: Pt[]; /** Goes on from the stroke before it, which hit the 300-point bound. */ part?: true }
export type Draft =
  | { readonly kind: 'freehand'; readonly strokes: readonly Stroke[] }
  | { readonly kind: 'stencil'; readonly stencil: StencilKey; readonly can: Can; readonly spot: number };

/** What the meter says: the wall's cells now, with the drawing, and the limit, all of the grid's 10,000. */
export interface Meter { readonly wall: number; readonly after: number; readonly most: number; readonly over: boolean }

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

const widthOf = (cap: unknown): number => (typeof cap === 'string' && Object.hasOwn(CAPS, cap) ? CAPS[cap as Cap] : Number.NaN);

/** A payload's strokes as the engine counts them: a draw's at its cap's width and a wash's at the sponge's; one that is not well formed covers nothing. */
function countable(act: WallAct): SurfaceStroke[] {
  const list = (act.payload as { strokes?: unknown } | null)?.strokes;
  if (!Array.isArray(list)) return [];
  return (list as { cap?: unknown; aspect: number; points: [number, number][] }[]).map((s) => ({ width: act.kind === 'wash' ? SPONGE : widthOf(s?.cap), aspect: s?.aspect, points: s?.points ?? [] }));
}

/** The cells a wall's live draws and washes leave covered, in order: a draw adds its cells, a wash takes its cells off, and a draw after a wash is not cut. */
export function wallCells(acts: readonly WallAct[]): Cells {
  let cells = cellsOf([]);
  for (const act of acts) {
    if (act.kind === 'draw') cells = union(cells, cellsOf(countable(act)));
    else if (act.kind === 'wash') cells = minus(cells, cellsOf(countable(act)));
  }
  return cells;
}

/** The drawing as the engine counts it. A stencil is expanded by the rules, as the server expands it. */
export function engineStrokes(draft: Draft): readonly SurfaceStroke[] {
  if (draft.kind === 'freehand') return draft.strokes.map((s) => ({ width: CAPS[s.cap], aspect: s.aspect, points: s.points }));
  const v = graffiti.surface!.validateDraw({ stencil: draft.stencil, can: draft.can, spot: draft.spot });
  return v.ok ? (v.value as { strokes: readonly SurfaceStroke[] }).strokes : [];
}

/** The meter's figures. `wall` is null where the wall's strokes are not read yet; `covered` is then what the server says it covers. */
export function meterOf(wall: Cells | null, covered: number, draft: Draft | null, most: number): Meter {
  const now = wall ? count(wall) : covered;
  const added = draft ? cellsOf(engineStrokes(draft)) : null;
  const after = !added ? now : wall ? count(union(wall, added)) : covered + count(added);
  return { wall: now, after, most, over: after > most };
}

/** A whole percent of the grid, rounded down as the wall's view says it. */
export const percent = (cells: number): number => Math.floor(cells / 100);

/** Why Tag it waits when the drawing is over the limit: the figure the wall would stand at, rounded up so it is never the limit itself. */
export const overWords = (m: Meter): string => `This tag would take the wall to ${Math.ceil(m.after / 100)}%; its limit is ${percent(m.most)}%`;

/* ------------------------------------------------------------------ what is sent ---- */

/** What the card's draw takes: the strokes without the mark that joins them, or a stencil's three names. */
export function inputOf(draft: Draft): unknown {
  if (draft.kind === 'stencil') return { stencil: draft.stencil, can: draft.can, spot: draft.spot };
  return { strokes: draft.strokes.map(({ can, cap, aspect, points }) => ({ can, cap, aspect, points: points.map(([x, y]): Pt => [x, y]) })) };
}

/** The drawing as the painter takes a draw (spray.ts), to be drawn into the wall's layer; null for no drawing. */
export function paintAct(draft: Draft | null): WallAct | null {
  if (!draft) return null;
  if (draft.kind === 'freehand') return { kind: 'draw', payload: { strokes: draft.strokes } };
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
  strokes.push({ can: last.can, cap: last.cap, aspect: last.aspect, points: [last.points.at(-1)!, p], part: true });
  return 'ok';
}

/** Takes back the last stroke, and the parts that go on from it. */
export function undo(strokes: Stroke[]): void {
  while (strokes.at(-1)?.part) strokes.pop();
  strokes.pop();
}
