/**
 * Color contrast, held on the tokens. jsdom paints nothing, so axe's color-contrast rule cannot
 * run in the story test (a11y.ts); the colors the screens read are all tokens, so the pairs are
 * checked here directly with the WCAG 2.x relative-luminance ratio, for the engine's defaults
 * (tokens.css) and for each theme, light and dark, each read as the browser reads it: every block, a
 * later one over an earlier. e2e/a11y.spec.ts runs axe's own rule in a real
 * browser over the built app as the second check.
 *
 * Text pairs need 4.5:1; the pairs that are not text (a rule, a focus ring, the chip's own-reaction
 * outline, a full pip) need 3:1. The game's colors (orbs, the four reaction colors, an empty pip)
 * carry no text and say what they mean in words beside them, so they are not held to a ratio.
 */

/** Light as the device shows it, light as a player who chose it, and dark both ways. */
export type Mode = 'light' | 'light (chosen)' | 'dark' | 'dark (device)';
/** Every mode a board can resolve to, in the order `tokensOf` builds them. */
export const MODES: readonly Mode[] = ['light', 'light (chosen)', 'dark', 'dark (device)'];
export type Tokens = Readonly<Record<string, string>>;

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  /* The last declaration of a block may omit its semicolon. */
  for (const m of body.matchAll(/(--kb-[a-z0-9-]+)\s*:\s*([^;]+)(?:;|$)/gu)) out[m[1]!] = m[2]!.replace(/\s*!\s*important\s*$/iu, '').trim();
  return out;
}

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, '');

/** Where a block applies: the four places the theme contract allows (tools/check-theme.mjs). */
type Place = 'light' | 'chosen light' | 'chosen dark' | 'device dark';

const squash = (s: string) => s.replace(/'/gu, '"').replace(/\s+/gu, '');
const TOP: Readonly<Record<string, Place>> = {
  ':root': 'light',
  ':root[data-kb-mode="light"]': 'chosen light',
  ':root[data-kb-mode="dark"]': 'chosen dark',
};
const DEVICE_QUERY = '@media(prefers-color-scheme:dark)';
const DEVICE_SELECTOR = ':root:not([data-kb-mode="light"])';

/**
 * Every block of one stylesheet (comments removed), in source order, with where it applies. Every block is
 * read, not only the first for each selector, because the browser lays a later block over an earlier one of
 * the same specificity; reading only the first would check colors the page does not show. A rule in any
 * other place is not one the contract allows and is left to check-theme to refuse.
 */
function blocks(css: string): { place: Place; tokens: Record<string, string> }[] {
  const out: { place: Place; tokens: Record<string, string> }[] = [];
  const walk = (from: number, to: number, inDeviceDark: boolean) => {
    let i = from;
    while (i < to) {
      const open = css.indexOf('{', i);
      if (open < 0 || open >= to) return;
      let depth = 0;
      let close = open;
      for (; close < to; close++) {
        if (css[close] === '{') depth++;
        else if (css[close] === '}' && --depth === 0) break;
      }
      const prelude = squash(css.slice(i, open).replace(/^[\s;}]+/u, ''));
      if (!inDeviceDark && prelude.toLowerCase() === DEVICE_QUERY) walk(open + 1, close, true);
      else {
        const place = inDeviceDark ? (prelude === DEVICE_SELECTOR ? 'device dark' : undefined) : TOP[prelude];
        if (place) out.push({ place, tokens: declarations(css.slice(open + 1, close)) });
      }
      i = close + 1;
    }
  };
  walk(0, css.length, false);
  return out;
}

/** The tokens of every block in `place`, across the sheets in load order, later over earlier. */
const merged = (sheets: ReturnType<typeof blocks>[], place: Place): Record<string, string> =>
  Object.assign({}, ...sheets.flatMap((b) => b.filter((x) => x.place === place).map((x) => x.tokens)));

/**
 * The tokens a page sees, from stylesheets in the order they load (the engine's, then a theme's).
 * Light is every file's `:root` blocks; light as a player who chose it adds every `:root[data-kb-mode="light"]`
 * block over them. Dark, as a player who chose it gets it, is the light values with every file's explicit-dark
 * blocks over them; dark as the device gets it is the same through the prefers-color-scheme blocks. The
 * attribute and dark blocks outrank any `:root`, so the engine's dark block beats a theme's light value and
 * only the theme's own dark block beats it back. Within a place, a later block wins, as in the browser.
 */
export function tokensOf(...sheets: string[]): Record<Mode, Tokens> {
  const all = sheets.map((s) => blocks(strip(s)));
  const light = merged(all, 'light');
  return {
    light,
    'light (chosen)': { ...light, ...merged(all, 'chosen light') },
    dark: { ...light, ...merged(all, 'chosen dark') },
    'dark (device)': { ...light, ...merged(all, 'device dark') },
  };
}

/** A file whose device-dark blocks and chosen-dark blocks set different tokens would show two dark modes. */
export function darkBlocksDisagree(sheet: string): string[] {
  const all = [blocks(strip(sheet))];
  const device = merged(all, 'device dark');
  const chosen = merged(all, 'chosen dark');
  const lines: string[] = [];
  for (const k of new Set([...Object.keys(device), ...Object.keys(chosen)])) {
    if (device[k] !== chosen[k]) lines.push(`dark: ${k} is ${device[k] ?? 'unset'} for the device and ${chosen[k] ?? 'unset'} when chosen`);
  }
  return lines;
}

export function parseColor(value: string): [number, number, number] {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(v);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  /* An opaque rgb(): three channels, commas or spaces. An alpha is not read, since what lies under it is not known. */
  const rgb = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/iu.exec(v);
  if (rgb && [rgb[1]!, rgb[2]!, rgb[3]!].every((n) => Number(n) <= 255)) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  throw new Error(`not a color this check can read: ${value}`);
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a: string, b: string): number {
  const [x, y] = [luminance(parseColor(a)), luminance(parseColor(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `s` split at the commas outside parentheses. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
  }
  out.push(s.slice(from));
  return out.map((x) => x.trim());
}

/**
 * A token's value with each var() followed to the token it names (or its fallback when that is unset), as the browser
 * computes it. A loop, or a var() with nothing to follow, throws.
 */
export function resolveToken(tokens: Tokens, name: string, seen: readonly string[] = []): string {
  if (seen.includes(name)) throw new Error(`${name} refers to itself`);
  const raw = tokens[name];
  if (raw === undefined) throw new Error(`${name} is not set`);
  return substitute(tokens, raw, [...seen, name]);
}

function substitute(tokens: Tokens, value: string, seen: readonly string[]): string {
  for (;;) {
    const at = value.search(/var\(/u);
    if (at < 0) return value;
    let depth = 0;
    let close = -1;
    for (let i = at + 3; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')' && --depth === 0) { close = i; break; }
    }
    if (close < 0) throw new Error(`unclosed var() in ${value}`);
    const [ref, ...fallback] = splitTop(value.slice(at + 4, close));
    let got: string;
    if (ref !== undefined && /^--[a-z0-9-]+$/iu.test(ref) && tokens[ref] !== undefined) got = resolveToken(tokens, ref, seen);
    else if (fallback.length) got = substitute(tokens, fallback.join(','), seen);
    else throw new Error(`${ref ?? ''} is not set`);
    value = value.slice(0, at) + got + value.slice(close + 1);
  }
}

const GRADIENT = /^(?:repeating-)?(?:linear|radial|conic)-gradient\((.*)\)$/isu;
/** What a gradient's argument may be when it holds no color: a direction, a shape or position, an interpolation, a hint. */
const WORD = '(?:to|in|from|at|circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner|left|right|top|bottom|center'
  + '|srgb|srgb-linear|lab|oklab|lch|oklch|hsl|hwb|xyz|xyz-d50|xyz-d65|shorter|longer|increasing|decreasing|hue)';
const NUM = '[-+]?\\d*\\.?\\d+(?:deg|grad|rad|turn|%|px|em|rem)?';
/* A whole argument made only of these words and numbers holds no color, so `circle banana` is not skipped but fails. */
const NO_COLOR = new RegExp(`^(?:${WORD}|${NUM})(?:\\s+(?:${WORD}|${NUM}))*$`, 'iu');
const COLOR = /^(#[0-9a-f]{3,6}|rgba?\([^)]*\)|transparent)(?:\s+[-+]?\d*\.?\d+(?:%|px|em|rem|deg|turn)?){0,2}$/iu;

/**
 * Every color a background value paints, stop by stop: a plain color, a gradient (linear, radial, conic, repeating) or
 * layers of them separated by commas; a `transparent` stop is skipped, and is refused in the last layer, which has nothing
 * under it to read. A value that holds anything else (a url(), a named color, a color with alpha, a
 * gradient it cannot take apart) throws, so the check fails on it rather than passing over it.
 */
export function backgroundStops(value: string): string[] {
  const stops: string[] = [];
  const layers = splitTop(value);
  layers.forEach((layer, i) => {
    if (layer === '') throw new Error(`an empty layer in ${value}`);
    const g = GRADIENT.exec(layer);
    if (!g) { parseColor(layer); stops.push(layer); return; }
    const before = stops.length;
    let clear = false;
    for (const arg of splitTop(g[1]!)) {
      const c = COLOR.exec(arg);
      /* `transparent` paints nothing: the layers under it show, and they are read as stops of their own. */
      if (c && c[1]!.toLowerCase() === 'transparent') clear = true;
      else if (c) { parseColor(c[1]!); stops.push(c[1]!); }
      else if (!NO_COLOR.test(arg)) throw new Error(`not a color stop this check can read: ${arg}`);
    }
    if (stops.length - before < 1) throw new Error(`a gradient with no color stop: ${layer}`);
    /* Nothing is under the last layer but the page, whose color is not known here, so it may not be see-through. */
    if (clear && i === layers.length - 1) throw new Error(`the last layer lets the page show through (transparent), so the lettering on it cannot be held: ${layer}`);
  });
  return stops;
}

/** [foreground token, background token, least ratio, what it is] */
export const PAIRS: readonly (readonly [string, string, number, string])[] = [
  ['--kb-fg', '--kb-bg', 4.5, 'body text'],
  ['--kb-muted', '--kb-bg', 4.5, 'muted text'],
  ['--kb-link', '--kb-bg', 4.5, 'links'],
  ['--kb-link-visited', '--kb-bg', 4.5, 'visited links'],
  /* The page's ground may be a tiled background (--kb-page-bg); --kb-bg stays one plain color, which the shine and the text read as one. */
  ['--kb-fg', '--kb-page-bg', 4.5, 'body text on the page ground'],
  ['--kb-muted', '--kb-page-bg', 4.5, 'muted text on the page ground'],
  ['--kb-link', '--kb-page-bg', 4.5, 'links on the page ground'],
  ['--kb-fg', '--kb-hud-bg', 4.5, 'text on the HUD'],
  ['--kb-muted', '--kb-hud-bg', 4.5, 'muted text on the HUD'],
  ['--kb-link', '--kb-hud-bg', 4.5, 'links on the HUD'],
  ['--kb-link-hover', '--kb-bg', 4.5, 'hovered links'],
  ['--kb-link-hover', '--kb-hud-bg', 4.5, 'hovered links on the HUD'],
  ['--kb-selection-fg', '--kb-selection-bg', 4.5, 'selected text'],
  ['--kb-meter-fill', '--kb-meter-face', 3, 'the loading meter\'s fill in its well'],
  ['--kb-fg', '--kb-chip-bg', 4.5, 'text on a reaction chip'],
  ['--kb-muted', '--kb-chip-bg', 4.5, 'muted text on a reaction chip'],
  ['--kb-rule', '--kb-bg', 3, 'rules and control borders'],
  ['--kb-rule', '--kb-hud-bg', 3, 'rules on the HUD'],
  ['--kb-rule', '--kb-chip-bg', 3, 'a chip\'s border'],
  ['--kb-focus', '--kb-bg', 3, 'the focus ring'],
  ['--kb-focus', '--kb-hud-bg', 3, 'the focus ring on the HUD'],
  ['--kb-chip-own', '--kb-chip-bg', 3, 'the outline of your own reaction'],
  ['--kb-pip', '--kb-bg', 3, 'a full pip'],
  /* The period skin. A background here may be a gradient: the text is held on every stop of it. */
  ...(['--kb-row-1', '--kb-row-2', '--kb-row-3'] as const).flatMap((row, i): [string, string, number, string][] => [
    ['--kb-fg', row, 4.5, `text on table row ${i + 1}`],
    ['--kb-muted', row, 4.5, `muted text on table row ${i + 1}`],
    ['--kb-link', row, 4.5, `links on table row ${i + 1}`],
    ['--kb-link-hover', row, 4.5, `hovered links on table row ${i + 1}`],
  ]),
  ['--kb-head-fg', '--kb-head-bg', 4.5, 'column head text on the head band'],
  ['--kb-bar-fg', '--kb-bar-bg', 4.5, 'section heading on the light band'],
  ['--kb-nav-fg', '--kb-nav-bg', 4.5, 'links on the boards\' bar'],
  ['--kb-nav-hover', '--kb-nav-bg', 4.5, 'hovered links on the boards\' bar'],
  /* The ring is not text but must be seen (3:1) on each ground a focusable thing can stand on. The bar's ring is its own ink, held above. */
  ...(['--kb-row-1', '--kb-row-2', '--kb-row-3'] as const).map((row, i): [string, string, number, string] => ['--kb-focus', row, 3, `the focus ring on table row ${i + 1}`]),
  ['--kb-head-focus', '--kb-head-bg', 3, 'the focus ring on the column-title band'],
  ['--kb-focus', '--kb-bar-bg', 3, 'the focus ring on the light band'],
  ['--kb-focus', '--kb-banner-bg', 3, 'the focus ring on the banner'],
  ['--kb-logo-fg', '--kb-banner-bg', 3, 'the logo on the banner (large text)'],
  ['--kb-button-fg', '--kb-button-bg', 4.5, 'a Chrome button\'s label'],
  ['--kb-button-primary-fg', '--kb-button-primary-bg', 4.5, 'a primary Chrome button\'s label'],
  ['--kb-button-hover-fg', '--kb-button-hover-bg', 4.5, 'a Chrome button\'s label under the pointer'],
  ['--kb-button-primary-hover-fg', '--kb-button-primary-hover-bg', 4.5, 'a primary Chrome button\'s label under the pointer'],
  ['--kb-fg', '--kb-input-bg', 4.5, 'text in a text box'],
  ['--kb-badge-a-fg', '--kb-badge-a', 3, 'the first footer badge (decorative)'],
  ['--kb-badge-b-fg', '--kb-badge-b', 3, 'the second footer badge (decorative)'],
];

/**
 * A pressed button (aria-expanded, aria-pressed, aria-current) is drawn under `filter: brightness(--kb-button-pressed-brightness)`
 * (base.css), which scales the face and the label alike. Its pairs are the button pairs at rest and under the pointer, read through
 * that factor, so a re-skin that passes the pair at rest and fails dimmed is caught.
 */
const PRESSED_PAIRS: readonly (readonly [string, string, string])[] = [
  ['--kb-button-fg', '--kb-button-bg', 'a pressed Chrome button\'s label'],
  ['--kb-button-primary-fg', '--kb-button-primary-bg', 'a pressed primary Chrome button\'s label'],
  ['--kb-button-hover-fg', '--kb-button-hover-bg', 'a pressed Chrome button\'s label under the pointer'],
  ['--kb-button-primary-hover-fg', '--kb-button-primary-hover-bg', 'a pressed primary Chrome button\'s label under the pointer'],
];

const dim = (color: string, factor: number): string => `#${parseColor(color).map((c) => Math.round(Math.min(255, c * factor)).toString(16).padStart(2, '0')).join('')}`;

/** The worst ratio of `fg` over every stop of `bg`; throws on a value that cannot be read. */
export function worstRatio(tokens: Tokens, fg: string, bg: string): number {
  const text = resolveToken(tokens, fg);
  parseColor(text);
  return Math.min(...backgroundStops(resolveToken(tokens, bg)).map((stop) => ratio(text, stop)));
}

/** The pairs below their least ratio, or naming a token that is not set; empty when the tokens are sound. */
export function contrastFailures(...sheets: string[]): string[] {
  const failures: string[] = [];
  for (const [mode, tokens] of Object.entries(tokensOf(...sheets)) as [Mode, Tokens][]) {
    for (const [fg, bg, least, what] of PAIRS) {
      if (!tokens[fg] || !tokens[bg]) { failures.push(`${mode}: ${what} needs ${!tokens[fg] ? fg : bg}, which no stylesheet sets`); continue; }
      let got: number;
      try { got = worstRatio(tokens, fg, bg); }
      catch (e) { failures.push(`${mode}: ${what} (${fg} on ${bg}) cannot be read: ${(e as Error).message}`); continue; }
      if (got < least) failures.push(`${mode}: ${what} (${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}) is ${got.toFixed(2)}:1 at its worst stop, needs ${least}:1`);
    }
    const factorName = '--kb-button-pressed-brightness';
    let factor: number;
    try { factor = Number(resolveToken(tokens, factorName)); } catch { factor = Number.NaN; }
    if (!Number.isFinite(factor) || factor < 0) { failures.push(`${mode}: ${factorName} must be a number, which no stylesheet sets`); continue; }
    for (const [fg, bg, what] of PRESSED_PAIRS) {
      if (!tokens[fg] || !tokens[bg]) continue; /* named above, with the pair at rest */
      try {
        const text = dim(resolveToken(tokens, fg), factor);
        const got = Math.min(...backgroundStops(resolveToken(tokens, bg)).map((stop) => ratio(text, dim(stop, factor))));
        if (got < 4.5) failures.push(`${mode}: ${what} (${fg} on ${bg}, dimmed by ${factorName} ${factor}) is ${got.toFixed(2)}:1 at its worst stop, needs 4.5:1`);
      } catch (e) { failures.push(`${mode}: ${what} (${fg} on ${bg}) cannot be read when pressed: ${(e as Error).message}`); }
    }
  }
  return failures;
}
