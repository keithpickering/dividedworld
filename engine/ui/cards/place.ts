/**
 * Where a drawing's groups go on this screen (docs/plans/2026-11-27-graffiti-everywhere-design.md, section 4), pure over rectangles the screen measured. A group is
 * a rigid picture in its own units (the size of the post's text, an em, or the width of the image it is attached to), and its strokes are points from its
 * origin; this says where its origin goes in the post's content box, in px, and how much to shrink it. The steps:
 *
 * 1. The attachment's point plus its offset: a text mark's left and line top (a `point`) plus `dx` and `dy` ems, or a point in the image's rect (`rect`), in the
 *    image's shares. A group whose attachment is not on this screen (the measure is null: the words are gone, the image has not loaded) is at its spot in the box
 *    (`at`, a share of the box), the fallback of section 6.
 * 2. Its unit in px: an em on this screen, or the image's width (a fallen image group keeps the ems an image width was when it was drawn, `em`).
 * 3. Shrunk evenly about its origin to fit the box's width if it is wider (`min(1, box.w / width)`), never enlarged, and never shrunk for height.
 * 4. Pulled into the box: back from the right and the bottom, then from the left and the top, so a group taller than the box has its top in view.
 * 5. Nudged, within one drawing (the groups with the same `drawing`, earlier ones first): a group that overlaps an earlier group of its drawing, when the
 *    drawer's own screen (`frame`, the drawing's box in ems, placing each group at its `at`) showed the two clear, moves down in steps of one em until it is clear,
 *    or up where down would leave the box, and where neither clears it, to the place of least overlap (down before up on a tie). Groups of different drawings
 *    overlap freely: layering is what a wall is.
 *
 * A group's bounds are its strokes' bounds plus its widest brush's radius. The engine knows nothing of cans or caps: a stroke's `r` is its brush's radius in
 * the group's units, which the instance's own drawing gives. Everything here is in px of the content box, from its top left.
 */
import type { Attachment } from '../../rules/anchor.ts';

/** Where an attachment is on this screen: a text mark's left and line top (`point`), or an image's rect, both in px from the content box's top left. */
export type Measured = { readonly kind: 'point'; readonly x: number; readonly y: number } | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number };

export interface PlaceGroup {
  /** Which drawing the group is of: only groups of one drawing are nudged apart. Their order is the drawing's. */
  readonly drawing: string;
  /** The group's spot as a share of the drawer's box, across and down. */
  readonly at: readonly [number, number];
  readonly anchor: Attachment;
  /** What a point's unit is: an em of the post's text, or the width of the image it is attached to. */
  readonly unit: 'em' | 'image';
  /** For an image group: how many ems one image width was when it was drawn. */
  readonly em?: number;
  /** The strokes, as points from the group's origin and each one's brush radius, in the group's units. */
  readonly strokes: readonly { readonly points: readonly (readonly [number, number])[]; readonly r: number }[];
  /** The drawer's box in ems (the drawing's `box`): what its screen showed the groups in. */
  readonly frame: { readonly w: number; readonly h: number };
}

/** Where a group's origin goes, in px, and how much it is shrunk about it. */
export interface Placed { readonly x: number; readonly y: number; readonly scale: number }

interface Rect { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** The group's bounds from its origin, in its own units: the strokes' bounds plus the widest brush's radius. */
function reach(g: PlaceGroup): Rect {
  let [x0, y0, x1, y1, r] = [Infinity, Infinity, -Infinity, -Infinity, 0];
  for (const s of g.strokes) {
    r = Math.max(r, s.r);
    for (const [x, y] of s.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0: x0 - r, y0: y0 - r, x1: x1 + r, y1: y1 + r };
}

/** The overlap of two rectangles, in px squared (touching is none). */
const overlapOf = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

export function placeGroups(groups: readonly PlaceGroup[], measured: readonly (Measured | null)[], box: { readonly w: number; readonly h: number }, emPx: number): Placed[] {
  const out: Placed[] = [];
  const rects: Rect[] = [];
  const frames: Rect[] = groups.map((g) => {
    const b = reach(g), u = g.unit === 'em' ? 1 : g.em ?? 1;
    const [cx, cy] = [g.at[0] * g.frame.w, g.at[1] * g.frame.h];
    return { x0: cx + b.x0 * u, y0: cy + b.y0 * u, x1: cx + b.x1 * u, y1: cy + b.y1 * u };
  });
  groups.forEach((g, k) => {
    const m = measured[k] ?? null;
    const a = g.anchor;
    // Step 1, and the unit of step 2.
    let [x, y, unit] = [g.at[0] * box.w, g.at[1] * box.h, g.unit === 'em' ? emPx : (g.em ?? 1) * emPx];
    if (m !== null && a.kind === 'text' && m.kind === 'point') [x, y] = [m.x + a.dx * emPx, m.y + a.dy * emPx];
    else if (m !== null && a.kind === 'image' && m.kind === 'rect') [x, y, unit] = [m.x + a.x * m.w, m.y + a.y * m.h, m.w];
    const b = reach(g);
    // Step 3.
    const wide = (b.x1 - b.x0) * unit;
    const scale = wide > box.w ? box.w / wide : 1;
    const px = unit * scale;
    // Step 4.
    const rect = (ox: number, oy: number): Rect => ({ x0: ox + b.x0 * px, y0: oy + b.y0 * px, x1: ox + b.x1 * px, y1: oy + b.y1 * px });
    let r = rect(x, y);
    if (r.x1 > box.w) x -= r.x1 - box.w;
    r = rect(x, y);
    if (r.x0 < 0) x -= r.x0;
    r = rect(x, y);
    if (r.y1 > box.h) y -= r.y1 - box.h;
    r = rect(x, y);
    if (r.y0 < 0) y -= r.y0;
    // Step 5.
    const clear = groups.flatMap((o, j) => (j < k && o.drawing === g.drawing && overlapOf(frames[j]!, frames[k]!) === 0 ? [rects[j]!] : []));
    const cost = (oy: number): number => clear.reduce((n, e) => n + overlapOf(rect(x, oy), e), 0);
    if (cost(y) > 0) {
      const fits = (oy: number): boolean => { const c = rect(x, oy); return c.y0 >= -1e-9 && c.y1 <= box.h + 1e-9; };
      const down: number[] = [], up: number[] = [];
      for (let d = 1; emPx > 0 && fits(y + d * emPx); d++) down.push(y + d * emPx);
      for (let d = 1; emPx > 0 && fits(y - d * emPx); d++) up.push(y - d * emPx);
      const free = down.find((oy) => cost(oy) === 0) ?? up.find((oy) => cost(oy) === 0);
      if (free !== undefined) y = free;
      else {
        let best = y, least = cost(y);
        for (const oy of [...down, ...up]) { const c = cost(oy); if (c < least) { best = oy; least = c; } }
        y = best;
      }
    }
    out.push({ x, y, scale });
    rects.push(rect(x, y));
  });
  return out;
}
