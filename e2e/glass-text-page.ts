/**
 * The rendered glass measurement's gatherer: what e2e/glass-text.spec.ts reads in the page, one
 * line of one text node at a time, for the judgment in e2e/glass-text.ts. The spec bundles this
 * file for the browser (esbuild, as an IIFE named `kbGlassText`) and calls it through
 * `page.evaluate`; nothing here runs in Node.
 *
 * Which text is glass text: a text node is read where it stands on a surface's smoke, that is
 * where an ancestor of it, inside its glass root (`.kb-glass`), holds a `.kb-smoke` (Smoke.tsx
 * marks each with its `data-kb-surface`) that does not hold the text itself. That ancestor is the surface's element: a page's
 * `.kb-glass-page`, an overlay's dialog, the HUD. Text with no smoke under it is the board's, and
 * is not read. Under an open overlay only the overlay's text is read: the page behind it is dimmed
 * and inert (Overlay.tsx), the menu bar with it, and is not what the player is reading.
 *
 * Not read: the board's own post a preview shows (BOARD below); text that is not drawn (hidden,
 * fully transparent by an opacity, or clipped to under 2px either way, as a visually hidden label
 * is); a node of emoji alone (PICTURE); and an `<option>`, which the closed select draws as its own value.
 *
 * Each line is read as the browser lays it out (a Range's client rects), narrowed to the band its
 * glyphs ink (inkBand) and clipped by any ancestor that clips, with: its color as drawn (`-webkit-text-fill-color`, which is the color unless a
 * rule sets it) times every opacity above it; its face's ink at its size, measured by the canvas
 * over INK_SAMPLE in the loaded face; its nearest calm, the calm's `::before` backing as laid out
 * (its insets and its translation) and its feather as its mask draws it; and the panels between it
 * and its surface's element. A panel under the smoke (the dialog's own ground, under its smoke) is
 * not under the text, so the walk stops at the surface's element.
 */
import { parseColor, pixelStats, type Backing, type Box, type Calm, type Rgba, type TextFact } from './glass-text.ts';

/**
 * What a face inks is read over a string with an ascender and a descender: the design's "ascender
 * to descender" (docs/plans/2026-10-29-two-worlds-design.md, section 4), the share of the em the
 * guard's ink ratios name (glass.json's `fonts`). Read in the browser, "Hg" inks 0.91 of the em in
 * Barlow Condensed and 0.99 in Anton, the ratios the guard holds the size tokens to; a string with
 * more letters in it reaches past them (an accented capital, a taller ascender) and would pass a
 * size the guard refuses.
 */
export const INK_SAMPLE = 'Hg';

/**
 * The board drawn inside the glass: the post a Turn or a debut previews as the thread will show it
 * (characters/PreviewBox.tsx), in the board's own ground and type, opaque, which the board's rules
 * and axe hold, not the glass's.
 */
const BOARD = '.kb-preview-post';
const SKIP = `.kb-smoke, script, style, noscript, template, option, ${BOARD}`;

/** A line as gathered, before its pixels are read: the judgment's fact less `brightest` and `smoke`. */
export interface Gathered extends Omit<TextFact, 'brightest' | 'smoke'> {
  /** The node and line, the same from one read of the page to the next. */
  readonly key: string;
  /** The line lies wholly in the window, so a screenshot of the window holds all of it. */
  readonly inView: boolean;
}

/**
 * A node of emoji alone is a picture, drawn in its own colors at the size its button gives it (the
 * React picker's kinds), not words: the design's rules for text on smoke exempt decoration
 * (docs/plans/2026-10-29-two-worlds-design.md, section 4, item 6). Each such picture is named in
 * words for a screen reader by an aria-label on its control (the picker's kind buttons).
 */
const PICTURE = /^[\s\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f]+$/u;

const ids = new WeakMap<Node, number>();
let nextId = 0;
const idOf = (n: Node) => { let id = ids.get(n); if (id === undefined) ids.set(n, (id = nextId++)); return id; };

const zoomOf = (el: Element) => (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
const toBox = (r: { left: number; top: number; right: number; bottom: number }): Box => ({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });

function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return r > x && btm > y ? { x, y, width: r - x, height: btm - y } : null;
}

/** The product of every opacity from `el` up. */
function opacityOf(el: Element | null): number {
  let o = 1;
  for (let a = el; a; a = a.parentElement) o *= parseFloat(getComputedStyle(a).opacity);
  return o;
}

/**
 * The surface whose smoke `el` stands on, and the element that holds that smoke; null for the
 * board's text. The walk goes no higher than the glass's own root (`.kb-glass`: a page, an
 * overlay, the HUD, the hand), so the board's text beside the HUD is not read as the HUD's.
 */
function smokeUnder(el: Element): { holder: Element; surface: string } | null {
  const root = el.closest('.kb-glass');
  if (!root) return null;
  const mid = el.getBoundingClientRect();
  const cx = mid.left + mid.width / 2;
  const cy = mid.top + mid.height / 2;
  for (let a: Element | null = el; a && root.contains(a); a = a.parentElement) {
    const smokes = [...a.querySelectorAll<HTMLElement>('.kb-smoke')].filter((s) => !s.contains(el) && s.getClientRects().length > 0);
    if (smokes.length === 0) continue;
    const under = smokes.filter((s) => { const r = s.getBoundingClientRect(); return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom; });
    const smoke = (under.length ? under : smokes).at(-1)!;
    return { holder: a, surface: smoke.dataset.kbSurface ?? '' };
  }
  return null;
}

/** The line's part that is drawn: clipped by every ancestor that clips. */
function visiblePart(line: Box, el: Element): Box | null {
  let box: Box | null = line;
  for (let a: Element | null = el; a && box; a = a.parentElement) {
    if (a === document.body || a === document.documentElement) break;
    const s = getComputedStyle(a);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') box = intersect(box, toBox(a.getBoundingClientRect()));
  }
  return box;
}

/**
 * How much the transforms on `el` and every element above it scale it, on each axis: the product
 * of their matrices, read as the lengths its x and y axes are drawn at. A skew leaves both near 1;
 * a `scale()` anywhere above shrinks the text and its calm alike.
 */
function scaleOf(el: Element): { x: number; y: number } {
  let m = new DOMMatrix();
  for (let a: Element | null = el; a; a = a.parentElement) {
    const t = getComputedStyle(a).transform;
    if (t && t !== 'none') m = new DOMMatrix(t).multiply(m);
  }
  return { x: Math.hypot(m.a, m.b), y: Math.hypot(m.c, m.d) };
}

/** A pseudo-element's own transform, about its origin: its `translate`, `rotate` and `scale` properties, then `transform`. */
function ownMatrix(ps: CSSStyleDeclaration, w: number, h: number): DOMMatrix {
  const origin = ps.transformOrigin.split(' ').map((v, i) => (v.endsWith('%') ? (parseFloat(v) / 100) * (i === 0 ? w : h) : parseFloat(v)));
  const [ox = w / 2, oy = h / 2] = origin;
  let m = new DOMMatrix().translate(ox, oy);
  const t = /^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?/.exec(ps.translate);
  if (t) m = m.translate(+t[1]!, +(t[2] ?? 0));
  const r = /^(-?[\d.]+)deg$/.exec(ps.rotate);
  if (r) m = m.rotate(+r[1]!);
  const sc = ps.scale && ps.scale !== 'none' ? ps.scale.split(' ').map(Number) : null;
  if (sc) m = m.scale(sc[0]!, sc[1] ?? sc[0]!);
  if (ps.transform && ps.transform !== 'none') m = m.multiply(new DOMMatrix(ps.transform));
  return m.translate(-ox, -oy);
}

/**
 * Where a positioned `::before` or `::after` of `el` is drawn: its insets from `el`'s padding box,
 * then its own transform (all of it, about its origin, so a scaled calm is measured at its drawn
 * size), the whole at the scale `el` is drawn at. `scale` is the pseudo's own: how much its
 * transform shrinks what it draws, its mask's feather with it.
 */
function pseudoBox(el: Element, ps: CSSStyleDeclaration): Box & { readonly scale: number } {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  const z = zoomOf(el);
  const k = scaleOf(el);
  const kx = z * k.x;
  const ky = z * k.y;
  const n = (v: string) => parseFloat(v);
  /* The padding box, in the element's own px, from the drawn box's top-left. */
  const bl = n(s.borderLeftWidth);
  const bt = n(s.borderTopWidth);
  const pw = r.width / kx - bl - n(s.borderRightWidth);
  const ph = r.height / ky - bt - n(s.borderBottomWidth);
  let left = ps.left === 'auto' ? NaN : n(ps.left);
  let right = ps.right === 'auto' ? NaN : pw - n(ps.right);
  let top = ps.top === 'auto' ? NaN : n(ps.top);
  let bottom = ps.bottom === 'auto' ? NaN : ph - n(ps.bottom);
  const w = n(ps.width);
  const h = n(ps.height);
  if (Number.isNaN(left)) left = Number.isNaN(right) ? 0 : right - w;
  if (Number.isNaN(right)) right = left + w;
  if (Number.isNaN(top)) top = Number.isNaN(bottom) ? 0 : bottom - h;
  if (Number.isNaN(bottom)) bottom = top + h;
  const m = ownMatrix(ps, right - left, bottom - top);
  const corners = [[0, 0], [right - left, 0], [right - left, bottom - top], [0, bottom - top]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
  const xs = corners.map((c) => c.x + left);
  const ys = corners.map((c) => c.y + top);
  const x0 = r.left + (bl + Math.min(...xs)) * kx;
  const y0 = r.top + (bt + Math.min(...ys)) * ky;
  return {
    x: x0, y: y0, width: (Math.max(...xs) - Math.min(...xs)) * kx, height: (Math.max(...ys) - Math.min(...ys)) * ky,
    scale: Math.min(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)),
  };
}

/** A mask's feather: the longest length its gradients ramp over (calm.css: `currentColor var(--kb-glass-calm-feather)`). */
function featherOf(mask: string): number {
  if (!mask || mask === 'none') return 0;
  return Math.max(0, ...[...mask.matchAll(/(-?[\d.]+)px/g)].map((m) => Math.abs(+m[1]!)));
}

const drawn = (ps: CSSStyleDeclaration) => ps.content !== 'none' && ps.content !== 'normal' && ps.display !== 'none';

/** The nearest calm drawn on `el` or above it, inside the surface's element; a calm whose backing is not drawn is passed over. */
function calmOf(el: Element, holder: Element): Calm | null {
  let c = el.closest('.kb-calm');
  let ps: CSSStyleDeclaration | null = null;
  for (; c && c !== holder && holder.contains(c); c = c.parentElement?.closest('.kb-calm') ?? null) {
    ps = getComputedStyle(c, '::before');
    if (drawn(ps)) break;
  }
  if (!c || c === holder || !holder.contains(c) || !ps) return null;
  const { scale, ...backing } = pseudoBox(c, ps);
  const k = scaleOf(c);
  /* The feather is drawn by the backing's mask, so it shrinks with the backing and with the element. */
  const feather = featherOf(ps.maskImage || ps.getPropertyValue('-webkit-mask-image')) * zoomOf(c) * scale * Math.min(k.x, k.y);
  const bg = parseColor(ps.backgroundColor);
  const opacity = (bg ? bg[3] : parseFloat(getComputedStyle(c).getPropertyValue('--kb-glass-calm-opacity'))) * opacityOf(c);
  const box = { x: backing.x + feather, y: backing.y + feather, width: backing.width - 2 * feather, height: backing.height - 2 * feather };
  return { backing, feather, box, opacity };
}

/**
 * The panels between `el` and the surface's element. On each element the topmost drawn background
 * is the one the text stands on: a positioned `::after` or `::before` with a background (a cut
 * panel's, base.css) is drawn over the element's own (the cut panel's border color), so it is read
 * in its place. A calm's `::before` is the calm's, not a panel.
 */
function panelsOf(el: Element, holder: Element): Backing[] {
  const out: Backing[] = [];
  for (let a: Element | null = el; a && a !== holder; a = a.parentElement) {
    const o = opacityOf(a);
    const pseudo = (['::after', '::before'] as const)
      .filter((p) => !(p === '::before' && a!.classList.contains('kb-calm')))
      .map((p) => getComputedStyle(a!, p))
      .filter((ps) => drawn(ps) && (ps.position === 'absolute' || ps.position === 'fixed'))
      .map((ps) => ({ ps, bg: parseColor(ps.backgroundColor) }))
      .find(({ bg }) => bg && bg[3] > 0);
    if (pseudo) { const { scale: _scale, ...box } = pseudoBox(a, pseudo.ps); out.push({ box, opacity: pseudo.bg![3] * o }); continue; }
    const bg = parseColor(getComputedStyle(a).backgroundColor);
    if (bg && bg[3] > 0) out.push({ box: toBox(a.getBoundingClientRect()), opacity: bg[3] * o });
  }
  return out;
}

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;

/** A face's metrics at a size: what INK_SAMPLE inks above and below the baseline, and the face's own ascent and descent. */
interface Metrics { readonly inkUp: number; readonly inkDown: number; readonly fontUp: number; readonly fontDown: number }
const metrics = new Map<string, Metrics>();

/**
 * The em the canvas measures at: the canvas reports a glyph's bounds to whole pixels, which at a
 * label's size is a twentieth of the ink, so a face is measured large and its metrics scaled to the
 * size, as a face's outlines scale.
 */
const MEASURED_AT = 1000;

/**
 * The line's own face is loaded: a face in the document's font set for its first family, weight
 * and style, its status `loaded`. Otherwise the canvas would measure the fallback the browser
 * draws in its place, and a size could pass or fail on a face the player never sees, so it throws,
 * naming the face.
 */
function assertLoaded(style: string, weight: string, family: string, name: string): void {
  const first = family.split(',')[0]!.replace(/["']/g, '').trim();
  const italic = style !== 'normal';
  const faces = [...document.fonts].filter((f) => f.family.replace(/["']/g, '').trim() === first);
  const face = faces.find((f) => Number(f.weight) === Number(weight) && (f.style !== 'normal') === italic);
  if (!face || face.status !== 'loaded') {
    throw new Error(`The face ${first} ${weight}${italic ? ' italic' : ''} is not loaded (${face ? face.status : faces.length ? 'no face at that weight and style' : 'no such face in the document'}), so ${name} would be measured in a fallback`);
  }
}

/** A face's metrics at a size, in the loaded face. */
async function metricsOf(style: string, weight: string, family: string, size: number, name: string): Promise<Metrics> {
  const key = `${style} ${weight} ${family}`;
  let m = metrics.get(key);
  if (!m) {
    const font = `${style} ${weight} ${MEASURED_AT}px ${family}`;
    await document.fonts.load(font, INK_SAMPLE);
    assertLoaded(style, weight, family, name);
    ctx.font = font;
    const t = ctx.measureText(INK_SAMPLE);
    metrics.set(key, (m = { inkUp: t.actualBoundingBoxAscent, inkDown: t.actualBoundingBoxDescent, fontUp: t.fontBoundingBoxAscent, fontDown: t.fontBoundingBoxDescent }));
  }
  const k = size / MEASURED_AT;
  return { inkUp: m.inkUp * k, inkDown: m.inkDown * k, fontUp: m.fontUp * k, fontDown: m.fontDown * k };
}

/**
 * The band of a line its glyphs can ink: from INK_SAMPLE's ascender to its descender about the
 * line's baseline. A line's client rect is its face's content area, which runs past the glyphs and,
 * where the line height is under it, past the element's own box into its border (Menu's key cap);
 * what stands under the text is what stands under its ink.
 */
function inkBand(line: Box, m: Metrics): Box {
  const k = line.height / (m.fontUp + m.fontDown || line.height);
  const baseline = line.y + m.fontUp * k;
  const top = Math.max(line.y, baseline - m.inkUp);
  const bottom = Math.min(line.y + line.height, baseline + m.inkDown);
  return { x: line.x, y: top, width: line.width, height: Math.max(0, bottom - top) };
}

function nameOf(text: string, el: Element): string {
  const words = text.replace(/\s+/g, ' ').trim();
  const cls = [...el.classList].filter((c) => c !== 'kb-calm').slice(0, 2).map((c) => `.${c}`).join('');
  const parent = el.parentElement;
  const up = parent ? `${parent.tagName.toLowerCase()}${[...parent.classList].slice(0, 1).map((c) => `.${c}`).join('')} > ` : '';
  return `"${words.length > 40 ? `${words.slice(0, 39)}…` : words}" in ${up}${el.tagName.toLowerCase()}${cls}`;
}

/** Every line of glass text in the page now, with where each stands. */
export async function gather(): Promise<Gathered[]> {
  await document.fonts.ready;
  const overlays = [...document.querySelectorAll('.kb-glass-overlay')];
  const overlay = overlays.at(-1) ?? null;
  const view: Box = { x: 0, y: 0, width: innerWidth, height: innerHeight };
  const out: Gathered[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!/\S/.test(n.data) || PICTURE.test(n.data)) continue;
    const el = n.parentElement;
    if (!el || el.closest(SKIP)) continue;
    if (overlay && !overlay.contains(el)) continue;
    const s = getComputedStyle(el);
    if (s.visibility !== 'visible') continue;
    const opacity = opacityOf(el);
    if (opacity === 0) continue;
    const ground = smokeUnder(el);
    if (!ground) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const lines = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (lines.length === 0) continue;
    const fill = parseColor(s.getPropertyValue('-webkit-text-fill-color')) ?? parseColor(s.color);
    if (!fill) throw new Error(`The color of ${nameOf(n.data, el)} cannot be read: ${s.color}`);
    const color: Rgba = [fill[0], fill[1], fill[2], fill[3] * opacity];
    /* The size the line is drawn at: its computed size, its zoom, and any transform above it that scales it. */
    const size = parseFloat(s.fontSize) * zoomOf(el) * scaleOf(el).y;
    const m = await metricsOf(s.fontStyle, s.fontWeight, s.fontFamily, size, nameOf(n.data, el));
    const ink = m.inkUp + m.inkDown;
    const calm = calmOf(el, ground.holder);
    const panels = panelsOf(el, ground.holder);
    const calmOpacity = parseFloat(s.getPropertyValue('--kb-glass-calm-opacity')) || 1;
    lines.forEach((line, i) => {
      const box = visiblePart(inkBand(toBox(line), m), el);
      if (!box || box.width < 2 || box.height < 2) return;
      const inView = intersect(box, view)?.width === box.width && intersect(box, view)?.height === box.height;
      out.push({
        key: `${idOf(n)}:${i}`, inView, name: nameOf(n.data, el), surface: ground.surface, box, color,
        family: s.fontFamily.split(',')[0]!.replace(/["']/g, '').trim(), size, weight: parseFloat(s.fontWeight), ink, calm, calmOpacity, panels,
      });
    });
  }
  return out;
}

const HIDE_ID = 'kb-glass-text-hidden';

/**
 * Makes all text transparent, or shows it again. The fill is cleared rather than the color,
 * because a calm's mask is drawn in `currentColor` (calm.css), and a transparent color would take
 * the calm with it. Shadows, strokes, decorations and focus rings go with the text, since none is
 * the ground the text stands on. With `smoke` false the smoke's layers go too, leaving its ground:
 * the window without the smoke, which high contrast's solid ground must not differ from.
 */
export function hideText(hidden: boolean, smoke = true): void {
  document.getElementById(HIDE_ID)?.remove();
  if (!hidden) return;
  const style = document.createElement('style');
  style.id = HIDE_ID;
  style.textContent = `*, *::before, *::after { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important;
    text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; outline-color: transparent !important; }
    ${smoke ? '' : '.kb-smoke-layers { display: none !important; }'}`;
  document.head.append(style);
}

/** A PNG's pixels, decoded in the page. */
async function decode(png: string): Promise<ImageData> {
  const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
  const g = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  return g.getImageData(0, 0, bitmap.width, bitmap.height);
}

/** The brightest pixel under each box in a PNG screenshot of the window, and what the smoke changes there against `bare`, the window with no smoke. */
export async function pixels(png: string, boxes: readonly Box[], bare?: string): Promise<{ brightest: number; smoke: number }[]> {
  const shot = await decode(png);
  const without = bare ? (await decode(bare)).data : undefined;
  return boxes.map((b) => pixelStats(shot.data, shot.width, shot.height, b, without));
}
