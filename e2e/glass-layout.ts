import type { Box } from './glass-text.ts';

/**
 * The layout check's judgment: what e2e/glass-layout.spec.ts makes of the facts
 * e2e/glass-layout-page.ts gathers from a screen at one viewport and one text size. Pure, as
 * `judge` in e2e/glass-text.ts is, so e2e/glass-layout.test.ts drives each refusal red on plain
 * data. It refuses six things, each named with the element's selector path and the screen:
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
 *   5. a calm cut: a `.kb-calm` backing whose drawn rect (its feather included) crosses the box
 *      of an ancestor that clips overflow, on an axis it clips, where the calm's own element lies
 *      inside that box: the feather is cut on a straight line (the phone Settings, on main);
 *   6. a calm over other content: a `.kb-calm` backing whose drawn rect overlaps the box of a text
 *      block or a control (the backing as the clipping ancestors leave it) that is neither inside this calm nor inside another calm, taking
 *      of that block or control only the part nothing else is drawn over. Two calms' feathers
 *      meeting is a staggered backing and is not refused.
 *
 *   A calm inside a FRAMED PANEL (the HUD's glass, a dialog, the hand's drawer, the class rail) is
 *   judged by neither 5 nor 6. The panel is a layer of its own: it clips what lies past its edge
 *   and is drawn over whatever lies under it, so a calm in it is a quiet patch of the panel's
 *   ground, soft at its edge as the board has it, and its feather cannot lie on page content that
 *   the panel already covers. Drawing no backing there fails the glass-text ceilings (53 screens
 *   went red when it was tried), and a hard-edged box shows as a rectangle on the HUD, so the
 *   feather stays and the judgment steps aside. The exemption is the panel's own: a calm outside
 *   any panel is judged as ever, and a clipper outside the panel still counts for 5, except the
 *   overlay a dialog scrolls in (a dialog taller than the window is cut at its edge, as its calm is).
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

/** A calm: its drawn backing (feather included), its element's border box, and the ancestors that clip it. */
export interface CalmFact { readonly path: string; readonly backing: Box; readonly element: Box; readonly clips: readonly ClipFact[]; /** The part of `backing` nothing else is drawn over, as for a block's `seen`. Absent: all of it. */ readonly seen?: Box | null }

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

  /* The framed panel a path lies in: the path up to its first element whose classes name one (a class that only starts with the name is not one). */
  const panelOf = (path: string): string | null => {
    const segs = path.split(' > ');
    const i = segs.findIndex((g) => /\.(?:kb-hud|kb-hand-drawer|kb-glass-dialog|kb-class-rail)(?![\w-])/.test(g));
    return i < 0 ? null : segs.slice(0, i + 1).join(' > ');
  };
  const inPanel = (path: string, panel: string | null) => panel !== null && (path === panel || path.startsWith(`${panel} > `));

  /* 5. a calm cut */
  for (const m of facts.calms) {
    const b = m.backing;
    const e = m.element;
    const panel5 = panelOf(m.path);
    for (const c of m.clips) {
      if (inPanel(c.path, panel5)) continue;
      /* The overlay a dialog scrolls in: a dialog taller than the window is cut at its edge, and so is the calm at the dialog's own edge. */
      if (panel5 !== null && /\.kb-glass-overlay(?![\w-])[^>]*$/.test(c.path) && panel5.startsWith(`${c.path} > `)) continue;
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
    /* What is drawn: the backing less what an ancestor that clips hides of it (that is refusal 5's to name). */
    let drawn: Box = m.backing;
    for (const c of m.clips) {
      const x0 = c.x ? Math.max(drawn.x, c.rect.x) : drawn.x;
      const x1 = c.x ? Math.min(drawn.x + drawn.width, c.rect.x + c.rect.width) : drawn.x + drawn.width;
      const y0 = c.y ? Math.max(drawn.y, c.rect.y) : drawn.y;
      const y1 = c.y ? Math.min(drawn.y + drawn.height, c.rect.y + c.rect.height) : drawn.y + drawn.height;
      drawn = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
    }
    /* And what of it the page's other layers leave in view (a dialog drawn over the HUD's calm covers it: the calm is under, not over). */
    if (m.seen !== undefined) {
      drawn = m.seen === null ? { ...drawn, width: 0, height: 0 } : { x: Math.max(drawn.x, m.seen.x), y: Math.max(drawn.y, m.seen.y), width: Math.max(0, Math.min(drawn.x + drawn.width, m.seen.x + m.seen.width) - Math.max(drawn.x, m.seen.x)), height: Math.max(0, Math.min(drawn.y + drawn.height, m.seen.y + m.seen.height) - Math.max(drawn.y, m.seen.y)) };
    }
    if (panelOf(m.path) !== null) continue;
    for (const o of others) {
      /* Inside this calm, inside another, or holding this calm: the calm is under it or it is under the calm. */
      if (within(o.path, m.path) || within(m.path, o.path) || facts.calms.some((c) => within(o.path, c.path))) continue;
      /* What the player sees of it: the part nothing else is drawn over. */
      const seen = (o as { seen?: Box | null }).seen;
      if (seen === null) continue;
      if (overlaps(drawn, seen ?? o.rect)) at('calm over other content', m.path, `its backing, ${px(drawn.width)} by ${px(drawn.height)} with its feather and as its ancestors leave it, lies on ${shortPath(o.path)}, which is in no calm`);
    }
  }

  return out;
}
