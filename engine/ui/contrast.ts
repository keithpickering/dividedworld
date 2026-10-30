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
export type Tokens = Readonly<Record<string, string>>;

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  /* The last declaration of a block may omit its semicolon. */
  for (const m of body.matchAll(/(--kb-[a-z0-9-]+)\s*:\s*([^;]+)(?:;|$)/gu)) out[m[1]!] = m[2]!.trim();
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
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/iu.exec(value.trim());
  if (!hex) throw new Error(`not a hex color: ${value}`);
  let h = hex[1]!;
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a: string, b: string): number {
  const [x, y] = [luminance(parseColor(a)), luminance(parseColor(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** [foreground token, background token, least ratio, what it is] */
export const PAIRS: readonly (readonly [string, string, number, string])[] = [
  ['--kb-fg', '--kb-bg', 4.5, 'body text'],
  ['--kb-muted', '--kb-bg', 4.5, 'muted text'],
  ['--kb-link', '--kb-bg', 4.5, 'links'],
  ['--kb-link-visited', '--kb-bg', 4.5, 'visited links'],
  ['--kb-fg', '--kb-hud-bg', 4.5, 'text on the HUD'],
  ['--kb-muted', '--kb-hud-bg', 4.5, 'muted text on the HUD'],
  ['--kb-link', '--kb-hud-bg', 4.5, 'links on the HUD'],
  ['--kb-selection-fg', '--kb-selection-bg', 4.5, 'selected text'],
  ['--kb-fg', '--kb-chip-bg', 4.5, 'text on a reaction chip'],
  ['--kb-muted', '--kb-chip-bg', 4.5, 'muted text on a reaction chip'],
  ['--kb-rule', '--kb-bg', 3, 'rules and control borders'],
  ['--kb-rule', '--kb-hud-bg', 3, 'rules on the HUD'],
  ['--kb-rule', '--kb-chip-bg', 3, 'a chip\'s border'],
  ['--kb-focus', '--kb-bg', 3, 'the focus ring'],
  ['--kb-focus', '--kb-hud-bg', 3, 'the focus ring on the HUD'],
  ['--kb-chip-own', '--kb-chip-bg', 3, 'the outline of your own reaction'],
  ['--kb-pip', '--kb-bg', 3, 'a full pip'],
];

/** The pairs below their least ratio, or naming a token that is not set; empty when the tokens are sound. */
export function contrastFailures(...sheets: string[]): string[] {
  const failures: string[] = [];
  for (const [mode, tokens] of Object.entries(tokensOf(...sheets)) as [Mode, Tokens][]) {
    for (const [fg, bg, least, what] of PAIRS) {
      if (!tokens[fg] || !tokens[bg]) { failures.push(`${mode}: ${what} needs ${!tokens[fg] ? fg : bg}, which no stylesheet sets`); continue; }
      const got = ratio(tokens[fg], tokens[bg]);
      if (got < least) failures.push(`${mode}: ${what} (${fg} ${tokens[fg]} on ${bg} ${tokens[bg]}) is ${got.toFixed(2)}:1, needs ${least}:1`);
    }
  }
  return failures;
}
