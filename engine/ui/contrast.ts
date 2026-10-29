/**
 * Color contrast, held on the tokens. jsdom paints nothing, so axe's color-contrast rule cannot
 * run in the story test (a11y.ts); the colors the screens read are all tokens, so the pairs are
 * checked here directly with the WCAG 2.x relative-luminance ratio, for the engine's defaults
 * (tokens.css) and for each theme, light and dark. e2e/a11y.spec.ts runs axe's own rule in a real
 * browser over the built app as the second check.
 *
 * Text pairs need 4.5:1; the pairs that are not text (a rule, a focus ring, the chip's own-reaction
 * outline, a full pip) need 3:1. The game's colors (orbs, the four reaction colors, an empty pip)
 * carry no text and say what they mean in words beside them, so they are not held to a ratio.
 */

export type Mode = 'light' | 'dark' | 'dark (device)';
export type Tokens = Readonly<Record<string, string>>;

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--kb-[a-z0-9-]+)\s*:\s*([^;]+);/gu)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** The declarations of the first block that opens after `selector`. */
function blockAfter(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  if (at < 0) return {};
  const open = css.indexOf('{', at + selector.length - 1);
  return declarations(css.slice(open + 1, css.indexOf('}', open)));
}

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const LIGHT = ':root {';
const DEVICE_DARK = ':root:not([data-kb-mode="light"])';
const CHOSEN_DARK = ':root[data-kb-mode="dark"]';

/**
 * The tokens a page sees, from stylesheets in the order they load (the engine's, then a theme's).
 * Light is each file's `:root`. Dark, as a player who chose it gets it, is the light values with
 * every file's explicit-dark block over them; dark as the device gets it is the same through the
 * prefers-color-scheme block. The dark blocks outrank any `:root`, so the engine's dark block
 * beats a theme's light value and only the theme's own dark block beats it back.
 */
export function tokensOf(...sheets: string[]): Record<Mode, Tokens> {
  const css = sheets.map(strip);
  const light = Object.assign({}, ...css.map((c) => blockAfter(c, LIGHT)));
  const withDark = (selector: string) => {
    const lights = css.map((c) => blockAfter(c, LIGHT));
    return Object.assign({}, ...lights, ...css.map((c) => blockAfter(c, selector)));
  };
  return { light, dark: withDark(CHOSEN_DARK), 'dark (device)': withDark(DEVICE_DARK) };
}

/** A file whose device-dark block and chosen-dark block set different tokens would show two dark modes. */
export function darkBlocksDisagree(sheet: string): string[] {
  const css = strip(sheet);
  const device = blockAfter(css, DEVICE_DARK);
  const chosen = blockAfter(css, CHOSEN_DARK);
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
