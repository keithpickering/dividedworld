import type { Box } from './glass-text.ts';

/**
 * The layout check's judgment: what e2e/glass-layout.spec.ts makes of the facts
 * e2e/glass-layout-page.ts gathers from a screen at one viewport and one text size. Pure, as
 * `judge` in e2e/glass-text.ts is, so e2e/glass-layout.test.ts drives each refusal red on plain
 * data. It refuses five things, each named with the element's selector path and the screen:
 *
 *   1. a squeezed block: an element holding text that wraps, narrower than 10 * its font size
 *      when its column (its parent's content width) could have given it more room, as a sibling
 *      that took the room did (a block that fills its column passes, however narrow the column),
 *      or any element narrower than its longest word, or one whose widest line of text is wider
 *      than its own box (clipped or ellipsized). Card-face art (aria-hidden or `data-kb-art` text
 *      on a postcard) is exempt. A control alone on its line may wrap its label inside itself; a
 *      label that wraps on a line another control of its row shares is a split label, refused as
 *      part of this one;
 *   2. an overflow: anything outside the viewport's width (or a page that scrolls sideways), except
 *      inside an element that scrolls on purpose;
 *   3. a mismatched row: two GlassButtons in one ButtonRow, or two adjacent controls in one flex
 *      line, whose heights (to within 1px, on one line: a control alone on its line may be taller for a wrapped label) or computed type sizes differ;
 *   4. a cut control: a control whose box crosses into the cut corner of the clip-path polygon of
 *      the panel it sits in;
 *   5. text outside the calm: a text block on the glass of a surface that is `calmAll` (the
 *      engine's ceilings say which, e2e/glass-ceilings.json) whose box does not lie inside the
 *      border box of any calm region (`CalmRegion`, engine/ui/glass/Calm.tsx). On such a surface the
 *      promise the contrast model rests on is that every text node stands in a calm, large or not,
 *      so a paragraph placed beside its page's column region, not inside it, is refused. The
 *      menu bar's words stand on its own panel and are not on the glass in this sense.
 *
 *   The two refusals the calm needed while it was drawn on the text's own element (a calm cut by
 *   a column's clip, a calm painted over content it was not meant to dim) are retired: a calm is
 *   a rect in the smoke (Calm.tsx), behind the page and clipped by nothing but the smoke's own
 *   frame, so it can do neither.
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
 *   - A CALM REGION is an element marked `data-kb-calm-region` (CalmRegion); its box is its border box.
 *   - A BLOCK IS ON THE GLASS when an ancestor of it, inside a glass root (`.kb-glass`), holds the
 *     surface's smoke (`.kb-smoke`, which names the surface) that does not hold the block, and the
 *     block is not in the menu bar; the facts name that surface.
 */

/** A visible element's rect, with a path that is unique in the page (`tag.class:nth-child(n)` joined by ` > `). */
export interface Located { readonly path: string; readonly rect: Box }

/** A block of text: `rect` is its content box; `longestWord` is the width of its longest word in its own font; `textWidth`, its widest line as laid out. */
export interface BlockFact extends Located {
  /** The part of `rect` that nothing else is drawn over (the HUD over the board's page, a dialog over what is under it); null when none is. Absent: all of it. */
  readonly seen?: Box | null;
  readonly fontSize: number;
  readonly longestWord: number;
  readonly wraps: boolean;
  readonly textWidth: number;
  /** The content width of the block's parent: the room its column had to give it. */
  readonly column: number;
  /** Card-face art (aria-hidden or `data-kb-art` text on a postcard face): exempt from refusal 1. */
  readonly art?: boolean;
  /** The surface whose smoke the block stands on, when it is glass text; absent for the board's own. */
  readonly surface?: string;
}

export interface ControlInRow extends Located { readonly fontSize: number; readonly glass: boolean }

/** A `ButtonRow` (its GlassButtons are compared with each other) or one line of a flex container (adjacent controls are). */
export interface RowFact { readonly path: string; readonly kind: 'button-row' | 'flex-line'; readonly controls: readonly ControlInRow[] }

/** A clipped panel: its rect and its clip-path polygon, resolved to the page's px. */
export interface PanelFact extends Located { readonly polygon: readonly (readonly [number, number])[] }

/** A control's box, as the bounding rect and, where it is skewed, the four corners it is drawn at; and the nearest panel that clips what is in it. */
export interface ControlFact extends Located { readonly seen?: Box | null; readonly quad?: readonly (readonly [number, number])[]; readonly panel: PanelFact | null }

/** An ancestor that clips overflow: its box, and the axes it clips on. */
export interface ClipFact extends Located { readonly x: boolean; readonly y: boolean }


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
  /** Each calm region's border box. */
  readonly regions: readonly Located[];
  /** The surfaces whose every text node stands in a calm (e2e/glass-ceilings.json's `calmAll`). */
  readonly calmAll: readonly string[];
}

/** Heights are compared to within this, in px. */
export const HEIGHT_TOLERANCE = 1;
/** Other lengths (a rect's edge past a bound, a corner in a cut) are compared to within this. */
const EDGE = 1;
const SIZE_TOLERANCE = 0.05;
/** A block fills its column to within this many ems: the marker, border or gap its own control draws beside it (a radio's, a skewed edge's) is not a sibling's squeeze. */
const FILL = 1.5;


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
    if (b.art) continue;
    if (b.wraps && w < 10 * b.fontSize - EDGE && w < b.column - FILL * b.fontSize) at('squeezed block', b.path, `${px(w)} wide by ${px(b.rect.height)} tall at ${px(b.fontSize)} type, narrower than 10 times its type size, in a column ${px(b.column)} wide that could have given it more`);
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
      /* Heights are compared on one line only: the row stretches the controls of a line to match, and a control alone on its line may be taller for a wrapped label. */
      const sameLine = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y) > Math.min(a.rect.height, b.rect.height) / 2;
      if (sameLine && Math.abs(a.rect.height - b.rect.height) > HEIGHT_TOLERANCE) at('mismatched row', b.path, `height ${px(b.rect.height)} beside ${px(a.rect.height)} (${shortPath(a.path)}) in ${shortPath(row.path)}`);
      if (Math.abs(a.fontSize - b.fontSize) > SIZE_TOLERANCE) at('mismatched row', b.path, `type size ${px(b.fontSize)} beside ${px(a.fontSize)} (${shortPath(a.path)}) in ${shortPath(row.path)}`);
    }
  }

  /* 1b. a split label: a control's label that wraps while another control of its row shares its line (a lone control may wrap its label inside itself). */
  for (const row of facts.rows) {
    for (const c of row.controls) {
      const wrapped = facts.blocks.some((b) => b.wraps && b.path.startsWith(`${c.path} > `));
      if (!wrapped) continue;
      const sharing = row.controls.find((o) => o !== c && Math.min(o.rect.y + o.rect.height, c.rect.y + c.rect.height) - Math.max(o.rect.y, c.rect.y) > Math.min(o.rect.height, c.rect.height) / 2);
      if (sharing) at('split label', c.path, `its label wraps on a line it shares with ${shortPath(sharing.path)}, so one control's words split across controls`);
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

  /* 5. text outside the calm */
  for (const b of facts.blocks) {
    if (b.surface === undefined || !facts.calmAll.includes(b.surface)) continue;
    if (b.seen === null) continue;
    const r = b.rect;
    const inside = facts.regions.some((g) => r.x >= g.rect.x - EDGE && r.y >= g.rect.y - EDGE && r.x + r.width <= g.rect.x + g.rect.width + EDGE && r.y + r.height <= g.rect.y + g.rect.height + EDGE);
    if (!inside) at('text outside the calm', b.path, `${px(r.width)} by ${px(r.height)} on surface ${b.surface}, which is calmAll, lies inside no calm region's box`);
  }

  return out;
}
