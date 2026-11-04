/**
 * The layout check's gatherer: what e2e/glass-layout.spec.ts reads in the page, for the judgment
 * in e2e/glass-layout.ts (which says, in its header, what counts as a text block, a control, a
 * scroll on purpose and a hidden element). The spec bundles this file for the browser (esbuild,
 * an IIFE named `kbGlassLayout`) and calls `gather` through one `page.evaluate`; nothing here runs
 * in Node. Its calm backing is read with e2e/glass-text-page.ts's `pseudoBox`, the same
 * arithmetic the contrast measurement uses.
 */
import { drawn, pseudoBox } from './glass-text-page.ts';
import type {
  BlockFact, CalmFact, ClipFact, ControlFact, ControlInRow, LayoutFacts, Located, PanelFact, RowFact,
} from './glass-layout.ts';
import type { Box } from './glass-text.ts';

const toBox = (r: DOMRect): Box => ({ x: r.left, y: r.top, width: r.width, height: r.height });
const zoomOf = (el: Element) => (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;

const paths = new WeakMap<Element, string>();
function pathOf(el: Element): string {
  const known = paths.get(el);
  if (known !== undefined) return known;
  const parent = el.parentElement;
  const index = parent ? [...parent.children].indexOf(el) + 1 : 1;
  const classes = [...el.classList].slice(0, 2).map((c) => `.${c}`).join('');
  const seg = `${el.tagName.toLowerCase()}${classes}:nth-child(${index})`;
  const path = parent && parent !== document.documentElement ? `${pathOf(parent)} > ${seg}` : seg;
  paths.set(el, path);
  return path;
}

/** Drawn at all: it has a box, is not `visibility: hidden`, is not in a `[hidden]` or `[inert]` subtree, and is not a visually hidden clip (up to 2px, `clip`, or `clip-path: inset(50%)`). */
function visible(el: Element): boolean {
  if (el.closest('[hidden], [inert]')) return false;
  if (!el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const s = getComputedStyle(el);
  if (r.width <= 2 && r.height <= 2) return false;
  if (s.position === 'absolute' && /^inset\(50%\)/.test(s.clipPath)) return false;
  if (s.position === 'absolute' && s.clip !== 'auto' && s.clip !== '') return false;
  return true;
}

/**
 * The part of a box a clipping or scrolling ancestor leaves in view, or null when none: a control scrolled out of its row
 * (the class cards past the visible ones) is not drawn there, so no panel's cut can hide it, and one half in view (a Lens's
 * tab at the end of its list) is judged by the half that is.
 */
function inView(el: Element): { readonly rect: DOMRect; readonly clipped: boolean } | null {
  let r = el.getBoundingClientRect();
  let clipped = false;
  for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const b = a.getBoundingClientRect();
    const left = Math.max(r.left, b.left);
    const right = Math.min(r.right, b.right);
    const top = Math.max(r.top, b.top);
    const bottom = Math.min(r.bottom, b.bottom);
    if (right <= left || bottom <= top) return null;
    if (left !== r.left || right !== r.right || top !== r.top || bottom !== r.bottom) { r = new DOMRect(left, top, right - left, bottom - top); clipped = true; }
  }
  return { rect: r, clipped };
}

/** Whether a stylesheet rule or the inline style of `el` itself declares `overflow-x: auto|scroll`: a scroll on purpose, as a computed value cannot say (a page that scrolls because a child pushed it wide computes the same). */
function declaresScroll(el: Element): boolean {
  if (el.hasAttribute('data-kb-scroll')) return true;
  const on = (v: string) => v === 'auto' || v === 'scroll';
  if (on((el as HTMLElement).style?.overflowX ?? '')) return true;
  const walk = (rules: CSSRuleList): boolean => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        if (on(rule.style.overflowX) && el.matches(rule.selectorText)) return true;
      } else if ('cssRules' in rule && walk((rule as CSSGroupingRule).cssRules)) return true;
    }
    return false;
  };
  for (const sheet of document.styleSheets) {
    try { if (walk(sheet.cssRules)) return true; } catch { /* a sheet from another origin cannot be read */ }
  }
  return false;
}

const scrollerCache = new WeakMap<Element, boolean>();
/** An element that scrolls on purpose and has more than it shows. */
function scrollsOnPurpose(el: Element): boolean {
  let known = scrollerCache.get(el);
  if (known === undefined) {
    known = el.scrollWidth > el.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && declaresScroll(el);
    scrollerCache.set(el, known);
  }
  return known;
}

interface Container { readonly scroller: Element | null }
const containers = new WeakMap<Element, Container>();
/** The element that scrolls on purpose that `el` lies inside, if any. A clipping ancestor excuses nothing: what it hides, the player loses. */
function containerOf(el: Element): Container {
  const known = containers.get(el);
  if (known) return known;
  const parent = el.parentElement;
  let c: Container = { scroller: null };
  if (parent && parent !== document.body && parent !== document.documentElement) {
    const above = containerOf(parent);
    c = { scroller: above.scroller ?? (scrollsOnPurpose(parent) ? parent : null) };
  }
  containers.set(el, c);
  return c;
}

/* ---- blocks ---- */

const CONTROL = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="radio"]';
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

let measuring: CanvasRenderingContext2D | null = null;
function widthOf(text: string, s: CSSStyleDeclaration, zoom: number): number {
  measuring ??= document.createElement('canvas').getContext('2d')!;
  const size = parseFloat(s.fontSize) * zoom;
  measuring.font = `${s.fontStyle} ${s.fontWeight} ${size}px ${s.fontFamily}`;
  (measuring as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = s.letterSpacing === 'normal' ? '0px' : `${parseFloat(s.letterSpacing) * zoom}px`;
  const shown = s.textTransform === 'uppercase' ? text.toUpperCase() : s.textTransform === 'lowercase' ? text.toLowerCase() : text;
  return measuring.measureText(shown).width;
}

/**
 * The part of `r` (an element's box) that nothing else is drawn over: the page's own layers (the HUD over the board, a dialog
 * over its page) cover the rest. Read by sampling a grid of points in the part of the box inside the window, and taking
 * the bounds of those where the element, something inside it or something holding it is on top. Null when none is; the
 * whole box when none of it is in the window (the page scrolls to it).
 */
function seenOf(el: Element, r: Box): Box | null {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(innerWidth - 1, r.x + r.width);
  const y1 = Math.min(innerHeight - 1, r.y + r.height);
  if (x1 <= x0 || y1 <= y0) return r;
  const N = 8;
  let box: Box | null = null;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = x0 + ((x1 - x0) * i) / N;
      const y = y0 + ((y1 - y0) * j) / N;
      const hit = document.elementFromPoint(x, y);
      if (hit === null || el.contains(hit) || hit.contains(el)) {
        const sx = (x1 - x0) / N;
        const sy = (y1 - y0) / N;
        /* A cell about the point, kept inside the element's box. */
        const cx0 = Math.max(r.x, x - sx / 2);
        const cy0 = Math.max(r.y, y - sy / 2);
        const b: Box = { x: cx0, y: cy0, width: Math.min(r.x + r.width, x + sx / 2) - cx0, height: Math.min(r.y + r.height, y + sy / 2) - cy0 };
        box = box === null ? b : { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), width: Math.max(box.x + box.width, b.x + b.width) - Math.min(box.x, b.x), height: Math.max(box.y + box.height, b.y + b.height) - Math.min(box.y, b.y) };
      }
    }
  }
  return box;
}

function blockOf(el: Element): BlockFact | null {
  const own = [...el.childNodes].filter((n): n is Text => n.nodeType === Node.TEXT_NODE && /\S/.test((n as Text).data));
  if (own.length === 0) return null;
  const s = getComputedStyle(el);
  if (s.display === 'inline' || s.display === 'contents') return null;
  if (!visible(el)) return null;
  const text = own.map((n) => n.data).join(' ').trim();
  /* Decorative art is exempt only when it truly is art: aria-hidden and holding no letter or digit. */
  if (el.closest('[aria-hidden="true"]') && !LETTER_OR_DIGIT.test(text)) return null;
  const z = zoomOf(el);
  const r = el.getBoundingClientRect();
  const n = (v: string) => parseFloat(v) || 0;
  const content: Box = {
    x: r.left + (n(s.borderLeftWidth) + n(s.paddingLeft)) * z,
    y: r.top + (n(s.borderTopWidth) + n(s.paddingTop)) * z,
    width: Math.max(0, r.width - (n(s.borderLeftWidth) + n(s.paddingLeft) + n(s.borderRightWidth) + n(s.paddingRight)) * z),
    height: Math.max(0, r.height - (n(s.borderTopWidth) + n(s.paddingTop) + n(s.borderBottomWidth) + n(s.paddingBottom)) * z),
  };
  const fontSize = parseFloat(s.fontSize) * z;
  const range = document.createRange();
  const lines = new Set<number>();
  let widest = 0;
  for (const t of own) {
    range.selectNodeContents(t);
    for (const q of range.getClientRects()) {
      if (q.width === 0) continue;
      widest = Math.max(widest, q.width);
      lines.add(Math.round(q.top / Math.max(1, fontSize / 2)));
    }
  }
  /* One word cannot wrap: a word wider than its block is the longest-word refusal's, not the squeeze's. */
  const wraps = lines.size > 1;
  /* A word the element may break anywhere is not wider than the element. */
  const breaks = s.overflowWrap === 'anywhere' || s.overflowWrap === 'break-word' || s.wordBreak === 'break-all' || s.wordBreak === 'break-word';
  const words = text.split(/[\s­‐-―/-]+/).filter(Boolean).sort((a, b) => b.length - a.length).slice(0, 3);
  const longestWord = breaks ? 0 : Math.max(0, ...words.map((w) => widthOf(w, s, z)));
  return { path: pathOf(el), rect: content, fontSize, longestWord, wraps, textWidth: widest, seen: seenOf(el, content) };
}

/* ---- controls, rows and panels ---- */

const isControl = (el: Element) => el.matches(CONTROL);

/** A small arithmetic evaluator for a resolved clip-path length: numbers, `+ - * /`, parentheses. */
function arithmetic(src: string): number {
  let i = 0;
  const ws = () => { while (src[i] === ' ') i++; };
  const num = (): number => {
    ws();
    if (src[i] === '(') { i++; const v = sum(); ws(); i++; return v; }
    const m = /^-?[\d.]+(?:e-?\d+)?/.exec(src.slice(i));
    if (!m) throw new Error(`cannot read ${src}`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const prod = (): number => {
    let v = num();
    for (ws(); src[i] === '*' || src[i] === '/'; ws()) { const op = src[i++]; const w = num(); v = op === '*' ? v * w : v / w; }
    return v;
  };
  const sum = (): number => {
    let v = prod();
    for (ws(); src[i] === '+' || src[i] === '-'; ws()) { const op = src[i++]; const w = prod(); v = op === '+' ? v + w : v - w; }
    return v;
  };
  return sum();
}

/** One clip-path coordinate (`calc(100% - 24px)`, `0px`, `50%`) in px against `base`, lengths times `zoom`. */
function lengthOf(token: string, base: number, zoom: number): number {
  const src = token.trim().replace(/calc\(/g, '(').replace(/(-?[\d.]+)%/g, (_m, v: string) => `(${v}/100*${base})`).replace(/(-?[\d.]+)px/g, (_m, v: string) => `(${v}*${zoom})`);
  return arithmetic(src);
}

/** The element's own transform about the center of its drawn box, applied to points given relative to that center. */
function linearOf(el: Element): DOMMatrix | null {
  const t = getComputedStyle(el).transform;
  return t && t !== 'none' ? new DOMMatrix(t) : null;
}

function panelOf(control: Element): PanelFact | null {
  for (let a = control.parentElement; a && a !== document.body; a = a.parentElement) {
    const cp = getComputedStyle(a).clipPath;
    if (!cp || cp === 'none') continue;
    const m = /^polygon\((?:[a-z-]+,\s*)?(.*)\)$/.exec(cp);
    if (!m) return null;
    const r = a.getBoundingClientRect();
    const z = zoomOf(a);
    const mx = linearOf(a);
    const w = mx ? (a as HTMLElement).offsetWidth * z : r.width;
    const h = mx ? (a as HTMLElement).offsetHeight * z : r.height;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    try {
      const polygon = m[1]!.split(/,(?![^(]*\))/).map((pair): [number, number] => {
        const parts = pair.trim().split(/\s+(?![^(]*\))/);
        const lx = lengthOf(parts[0]!, w / z, z) - w / 2;
        const ly = lengthOf(parts[1]!, h / z, z) - h / 2;
        const p = mx ? new DOMPoint(lx, ly).matrixTransform(new DOMMatrix([mx.a, mx.b, mx.c, mx.d, 0, 0])) : { x: lx, y: ly };
        return [cx + p.x, cy + p.y];
      });
      return { path: pathOf(a), rect: toBox(r), polygon };
    } catch {
      return null;
    }
  }
  return null;
}

function quadOf(el: Element): [number, number][] | undefined {
  const mx = linearOf(el);
  if (!mx) return undefined;
  const r = el.getBoundingClientRect();
  const z = zoomOf(el);
  const hw = ((el as HTMLElement).offsetWidth * z) / 2;
  const hh = ((el as HTMLElement).offsetHeight * z) / 2;
  const lin = new DOMMatrix([mx.a, mx.b, mx.c, mx.d, 0, 0]);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
    const p = new DOMPoint(x, y).matrixTransform(lin);
    return [r.left + r.width / 2 + p.x, r.top + r.height / 2 + p.y];
  });
}

const inRow = (el: Element): ControlInRow => ({
  path: pathOf(el), rect: toBox(el.getBoundingClientRect()), fontSize: parseFloat(getComputedStyle(el).fontSize) * zoomOf(el), glass: el.classList.contains('kb-glass-button'),
});

function rowsOf(all: readonly Element[]): RowFact[] {
  const rows: RowFact[] = [];
  for (const el of all) {
    if (el.classList.contains('kb-button-row')) {
      const controls = [...el.children].filter((c) => isControl(c) && visible(c)).map(inRow);
      if (controls.length > 1) rows.push({ path: pathOf(el), kind: 'button-row', controls });
      continue;
    }
    const s = getComputedStyle(el);
    if (!/flex$/.test(s.display) || !s.flexDirection.startsWith('row')) continue;
    /* A run of consecutive controls on one line of the flex container. */
    let run: Element[] = [];
    const flush = () => {
      if (run.length > 1) rows.push({ path: pathOf(el), kind: 'flex-line', controls: run.map(inRow) });
      run = [];
    };
    for (const c of el.children) {
      if (!visible(c) || !c.matches('button, a[href], [role="button"], [role="tab"]')) { flush(); continue; }
      const prev = run.at(-1);
      if (prev && Math.abs(prev.getBoundingClientRect().top - c.getBoundingClientRect().top) > prev.getBoundingClientRect().height / 2) flush();
      run.push(c);
    }
    flush();
  }
  return rows;
}

/** The ancestors of `el` that clip overflow (hidden, clip, scroll or auto on an axis), each as its padding box, which is where the clip lies. */
function clipsOf(el: Element): ClipFact[] {
  const out: ClipFact[] = [];
  for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    const x = s.overflowX !== 'visible';
    const y = s.overflowY !== 'visible';
    if (!x && !y) continue;
    const r = a.getBoundingClientRect();
    const z = zoomOf(a);
    const n = (v: string) => (parseFloat(v) || 0) * z;
    out.push({
      path: pathOf(a), x, y,
      rect: { x: r.left + n(s.borderLeftWidth), y: r.top + n(s.borderTopWidth), width: r.width - n(s.borderLeftWidth) - n(s.borderRightWidth), height: r.height - n(s.borderTopWidth) - n(s.borderBottomWidth) },
    });
  }
  return out;
}

function calmOf(el: Element): CalmFact | null {
  const ps = getComputedStyle(el, '::before');
  if (!drawn(ps)) return null;
  const { scale: _scale, ...backing } = pseudoBox(el, ps);
  return { path: pathOf(el), backing, element: toBox(el.getBoundingClientRect()), clips: clipsOf(el), seen: seenOf(el, backing) };
}

/** Everything the judgment reads, from the page as it stands. */
export function gather(): Omit<LayoutFacts, 'screen'> {
  const vw = document.documentElement.clientWidth;
  const all = [...document.body.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE'].includes(e.tagName) && !(e instanceof SVGElement && e.tagName !== 'svg'));
  const blocks: BlockFact[] = [];
  const extents: Located[] = [];
  const scrollers = new Map<string, Located>();
  const reached = new Set<Element>();
  const controls: ControlFact[] = [];
  const calms: CalmFact[] = [];
  const shown = all.filter(visible);
  for (const el of shown) {
    const { scroller } = containerOf(el);
    if (scrollsOnPurpose(el)) scrollers.set(pathOf(el), { path: pathOf(el), rect: toBox(el.getBoundingClientRect()) });
    const b = blockOf(el);
    if (b) blocks.push(b);
    const r = el.getBoundingClientRect();
    const out = r.left < -1 || r.right > vw + 1;
    if (out && !scroller && !el.closest('[aria-hidden="true"]') && !(el.parentElement && reached.has(el.parentElement))) {
      extents.push({ path: pathOf(el), rect: toBox(r) });
    }
    if (out) reached.add(el);
    if (isControl(el)) {
      const seen = inView(el);
      if (seen) controls.push({ path: pathOf(el), rect: toBox(seen.rect), seen: seenOf(el, toBox(seen.rect)), quad: seen.clipped ? undefined : quadOf(el), panel: panelOf(el) });
    }
    if (el.classList.contains('kb-calm')) { const c = calmOf(el); if (c) calms.push(c); }
  }
  return {
    viewport: { width: vw, height: innerHeight, scrollWidth: document.documentElement.scrollWidth },
    blocks, scrollers: [...scrollers.values()], extents, rows: rowsOf(shown), controls, calms,
  };
}
