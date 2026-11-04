import type { Box } from './glass-text.ts';

/**
 * The layout check's judgment: what e2e/glass-layout.spec.ts makes of the facts
 * e2e/glass-layout-page.ts gathers from a screen at one viewport and one text size. Pure, as
 * `judge` in e2e/glass-text.ts is, so e2e/glass-layout.test.ts drives each refusal red on plain
 * data. It refuses six things, each named with the element's selector path and the screen:
 *
 *   1. a squeezed block: an element holding text that wraps, narrower than 10 * its font size, or
 *      any element narrower than its longest word, or one whose widest line of text is wider than
 *      its own box (clipped or ellipsized);
 *   2. an overflow: anything outside the viewport's width (or a page that scrolls sideways), except
 *      inside an element that scrolls on purpose;
 *   3. a mismatched row: two GlassButtons in one ButtonRow, or two adjacent controls in one flex
 *      line, whose heights (to within 1px) or computed type sizes differ;
 *   4. a cut control: a control whose box crosses into the cut corner of the clip-path polygon of
 *      the panel it sits in;
 *   5. a calm cut: a `.kb-calm` backing whose drawn rect (its feather included) crosses the box
 *      of an ancestor that clips overflow, on an axis it clips, where the calm's own element lies
 *      inside that box: the feather is cut on a straight line (the phone Settings, on main);
 *   6. a calm over other content: a `.kb-calm` backing whose drawn rect overlaps the box of a text
 *      block or a control that is neither inside this calm nor inside another calm. Two calms'
 *      feathers meeting is a staggered backing and is not refused.
 *
 * The decisions the gatherer makes, so a reader of a refusal knows what was and was not looked at
 * (they are made in the page, where the styles are; they are written here because they are the
 * check's definition):
 *
 *   - A TEXT BLOCK is a visible element with a direct, non-blank text node of its own, whose
 *     `display` is not `inline` or `contents` (an inline run is laid out by its block, which holds
 *     the words it is part of). `rect` is its content box. `wraps` is true when its words take
 *     more than one line (a single word wider than its box is the longest-word refusal's);
 *     a one-line label is as narrow as its words and is not squeezed by being short ("OK" is not
 *     narrower than 10em in any sense that matters). Decorative art is exempt from refusal 1 only
 *     when it truly is art: inside `aria-hidden="true"` and holding no letter or digit.
 *   - A CONTROL is a `button`, `a[href]`, `input`, `select`, `textarea`, or `[role=button|tab|
 *     radio]`. In a flex line only buttons, links and role controls are compared (an input beside
 *     a button is deliberately not the same height).
 *   - SCROLLS ON PURPOSE: an element whose own stylesheet rule or inline style declares
 *     `overflow-x: auto|scroll` (the menu bar's tab list, a carousel's track, or anything marked
 *     `data-kb-scroll`) and whose content is wider than it. A page or an overlay that scrolls
 *     because a child pushed it wide does not declare it, so the child is still refused. The
 *     scrolling element's own box must still lie in the viewport; what is inside it is excused.
 *   - Anything inside `aria-hidden="true"` is not refused for overflow (it is not what a player reads).
 *   - HIDDEN is not looked at: `display: none`, `visibility: hidden`, a box with no size, a
 *     visually hidden clip (up to 2px, `clip`, `clip-path: inset(50%)`), and anything inside
 *     `[hidden]` or `[inert]`. An ancestor that clips (`overflow-x: clip`, as the glass content
 *     does) excuses nothing: what it hides, the player loses, so a block squeezed or pushed past
 *     the edge inside it is still refused.
 *   - A CALM'S DRAWN BACKING includes any transform on it (e2e/glass-text-page.ts's pseudoBox).
 */

/** A visible element's rect, with a path that is unique in the page (`tag.class:nth-child(n)` joined by ` > `). */
export interface Located { readonly path: string; readonly rect: Box }

/** A block of text: `rect` is its content box; `longestWord` is the width of its longest word in its own font; `textWidth`, its widest line as laid out. */
export interface BlockFact extends Located {
  readonly fontSize: number;
  readonly longestWord: number;
  readonly wraps: boolean;
  readonly textWidth: number;
}

export interface ControlInRow extends Located { readonly fontSize: number; readonly glass: boolean }

/** A `ButtonRow` (its GlassButtons are compared with each other) or one line of a flex container (adjacent controls are). */
export interface RowFact { readonly path: string; readonly kind: 'button-row' | 'flex-line'; readonly controls: readonly ControlInRow[] }

/** A clipped panel: its rect and its clip-path polygon, resolved to the page's px. */
export interface PanelFact extends Located { readonly polygon: readonly (readonly [number, number])[] }

/** A control's box, as the bounding rect and, where it is skewed, the four corners it is drawn at; and the nearest panel that clips what is in it. */
export interface ControlFact extends Located { readonly quad?: readonly (readonly [number, number])[]; readonly panel: PanelFact | null }

/** An ancestor that clips overflow: its box, and the axes it clips on. */
export interface ClipFact extends Located { readonly x: boolean; readonly y: boolean }

/** A calm: its drawn backing (feather included), its element's border box, and the ancestors that clip it. */
export interface CalmFact { readonly path: string; readonly backing: Box; readonly element: Box; readonly clips: readonly ClipFact[] }

export interface LayoutFacts {
  readonly screen: string;
  /** `scrollWidth` is the document's: wider than `width` and the page scrolls sideways. */
  readonly viewport: { readonly width: number; readonly height: number; readonly scrollWidth: number };
  readonly blocks: readonly BlockFact[];
  readonly scrollers: readonly Located[];
  /** The elements whose box reaches outside the viewport's width. */
  readonly extents: readonly Located[];
  readonly rows: readonly RowFact[];
  readonly controls: readonly ControlFact[];
  readonly calms: readonly CalmFact[];
}

/** Heights are compared to within this, in px. */
export const HEIGHT_TOLERANCE = 1;
/** Other lengths (a rect's edge past a bound, a corner in a cut) are compared to within this. */
const EDGE = 1;
const SIZE_TOLERANCE = 0.05;


/** A path as a reader wants it: its last four steps, without the child counts. */
export const shortPath = (path: string): string => path.split(' > ').slice(-4).map((s) => s.replace(/:nth-child\(\d+\)/g, '')).join(' > ');

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/** Where a point outside the clip lies against the panel's box: past an edge, or in a corner's cut. */
function where(r: Box, x: number, y: number): string {
  const h = x < r.x ? 'left' : x > r.x + r.width ? 'right' : '';
  const v = y < r.y ? 'top' : y > r.y + r.height ? 'bottom' : '';
  if (h || v) return `past the ${[v, h].filter(Boolean).join(' ')} edge`;
  return `in the ${y < r.y + r.height / 2 ? 'top' : 'bottom'} ${x < r.x + r.width / 2 ? 'left' : 'right'} cut`;
}

function insidePolygon(p: readonly [number, number], poly: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Points to test a control's box at: its corners and the middles of its edges, pulled in by a pixel's worth so a box that only touches the cut is not refused. */
function samples(c: ControlFact): [number, number][] {
  if (c.quad) {
    const q = c.quad;
    return q.flatMap((p, i) => [[p[0], p[1]] as [number, number], [(p[0] + q[(i + 1) % q.length]![0]) / 2, (p[1] + q[(i + 1) % q.length]![1]) / 2] as [number, number]]);
  }
  const { x, y, width: w, height: h } = c.rect;
  return [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
}

export function judgeLayout(facts: LayoutFacts): string[] {
  const out: string[] = [];
  const at = (kind: string, path: string, what: string) => out.push(`${kind}: ${shortPath(path)}, ${what}, on ${facts.screen}`);

  /* 1. a squeezed block */
  for (const b of facts.blocks) {
    const w = b.rect.width;
    if (b.wraps && w < 10 * b.fontSize - EDGE) at('squeezed block', b.path, `${px(w)} wide by ${px(b.rect.height)} tall at ${px(b.fontSize)} type, narrower than 10 times its type size`);
    else if (b.textWidth > w + EDGE) at('squeezed block', b.path, `${px(w)} wide, its text is ${px(b.textWidth)} wide on one line`);
    else if (w < b.longestWord - EDGE) at('squeezed block', b.path, `${px(w)} wide, narrower than its longest word (${px(b.longestWord)})`);
  }

  /* 2. an overflow */
  const vw = facts.viewport.width;
  if (facts.viewport.scrollWidth > vw + EDGE) at('overflow', 'document', `the page is ${px(facts.viewport.scrollWidth)} wide in a ${px(vw)} viewport and scrolls sideways`);
  const inScroller = (p: string) => facts.scrollers.some((s) => p.startsWith(`${s.path} > `));
  for (const e of facts.extents) {
    if (inScroller(e.path)) continue;
    const r = e.rect;
    if (r.x < -EDGE || r.x + r.width > vw + EDGE) at('overflow', e.path, `spans ${px(r.x)} to ${px(r.x + r.width)} in a ${px(vw)} viewport`);
  }

  /* 3. a mismatched row */
  for (const row of facts.rows) {
    const cs = row.kind === 'button-row' ? row.controls.filter((c) => c.glass) : row.controls;
    for (let i = 1; i < cs.length; i++) {
      const a = cs[i - 1]!;
      const b = cs[i]!;
      if (Math.abs(a.rect.height - b.rect.height) > HEIGHT_TOLERANCE) at('mismatched row', b.path, `height ${px(b.rect.height)} beside ${px(a.rect.height)} (${shortPath(a.path)}) in ${shortPath(row.path)}`);
      if (Math.abs(a.fontSize - b.fontSize) > SIZE_TOLERANCE) at('mismatched row', b.path, `type size ${px(b.fontSize)} beside ${px(a.fontSize)} (${shortPath(a.path)}) in ${shortPath(row.path)}`);
    }
  }

  /* 4. a cut control */
  for (const c of facts.controls) {
    const p = c.panel;
    if (!p) continue;
    const r = p.rect;
    /* Every sampled point outside the polygon is cut by the clip, whether it hangs past a straight edge or sits in a chamfer. */
    const cut = samples(c).filter((q) => !insidePolygon(q, p.polygon));
    /* A point exactly on the polygon's edge reads either way: it is cut only when it is more than a pixel inside the cut. */
    const deep = cut.filter(([x, y]) => ![[EDGE, 0], [-EDGE, 0], [0, EDGE], [0, -EDGE]].some(([dx, dy]) => insidePolygon([x + dx!, y + dy!], p.polygon)));
    if (deep.length > 0) at('cut control', c.path, `its box at ${deep.map(([x, y]) => `${px(x)},${px(y)} (${where(r, x, y)})`).join(' ')} is cut off by ${shortPath(p.path)}`);
  }

  /* 5. a calm cut */
  for (const m of facts.calms) {
    const b = m.backing;
    const e = m.element;
    for (const c of m.clips) {
      const r = c.rect;
      const sides: string[] = [];
      /* Only where the element itself is in the clipper's box on that axis: a calm scrolled out of a track is not drawn there, a cut feather is. */
      if (c.x && e.x >= r.x - EDGE && e.x + e.width <= r.x + r.width + EDGE) {
        if (r.x - b.x > EDGE) sides.push(`left ${px(r.x - b.x)}`);
        if (b.x + b.width - (r.x + r.width) > EDGE) sides.push(`right ${px(b.x + b.width - (r.x + r.width))}`);
      }
      if (c.y && e.y >= r.y - EDGE && e.y + e.height <= r.y + r.height + EDGE) {
        if (r.y - b.y > EDGE) sides.push(`top ${px(r.y - b.y)}`);
        if (b.y + b.height - (r.y + r.height) > EDGE) sides.push(`bottom ${px(b.y + b.height - (r.y + r.height))}`);
      }
      if (sides.length > 0) at('calm cut', m.path, `its backing reaches past the box of ${shortPath(c.path)}, which clips it, by ${sides.join(', ')}`);
    }
  }

  /* 6. a calm over other content */
  const within = (path: string, of: string) => path === of || path.startsWith(`${of} > `);
  const overlaps = (a: Box, b: Box) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EDGE && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EDGE;
  const others: readonly Located[] = [...facts.blocks, ...facts.controls];
  for (const m of facts.calms) {
    for (const o of others) {
      /* Inside this calm, inside another, or holding this calm: the calm is under it or it is under the calm. */
      if (within(o.path, m.path) || within(m.path, o.path) || facts.calms.some((c) => within(o.path, c.path))) continue;
      if (overlaps(m.backing, o.rect)) at('calm over other content', m.path, `its backing, ${px(m.backing.width)} by ${px(m.backing.height)} with its feather, lies on ${shortPath(o.path)}, which is in no calm`);
    }
  }

  return out;
}
