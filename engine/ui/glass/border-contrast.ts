/**
 * A button's border read from the stylesheet, for the tests that hold it to 3:1 on the brightest
 * smoke (engine/ui/glass/parts.test.tsx with the tokens' plain defaults, web/src/contrast.test.ts
 * with each instance's keys). Pure: the callers read the files.
 */
import { contrastRatio, parseColor } from '../../../tools/check-glass-contrast.mjs';

export type Vars = Readonly<Record<string, string>>;

/** The `--kb-glass-*` defaults a tokens.css text declares. */
export function tokenDefaults(tokensCss: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tokensCss.matchAll(/(--kb-glass-[\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

/** A color value with its var()s and color-mix(in srgb, X N%, transparent) resolved to rgb and alpha. */
export function resolveColor(value: string, vars: Vars): { r: number; g: number; b: number; a: number } {
  const v = value.replace(/var\((--[\w-]+)\)/g, (_, n: string) => vars[n] ?? 'NOPE').trim();
  const mix = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(v);
  if (mix) { const c = resolveColor(mix[1]!, vars); return { ...c, a: c.a * Number(mix[2]) / 100 }; }
  const c = parseColor(v);
  if (!c) throw new Error(`cannot resolve ${v}`);
  return c;
}

/** The contrast of the border a rule (found by its selector text) draws, over smoke of the given luminance. */
export function borderContrast(partsCss: string, selector: RegExp, vars: Vars, smoke: number): number {
  const rule = new RegExp(`(?:^|\\n|,)\\s*${selector.source}\\s*\\{([^}]*)\\}`).exec(partsCss);
  if (!rule) throw new Error(`no rule for ${selector}`);
  const decl = /border(?:-color)?:\s*(?:\d+px\s+\w+\s+)?([^;]+);/.exec(rule[1]!);
  if (!decl) throw new Error(`no border in ${selector}`);
  const c = resolveColor(decl[1]!, vars);
  /* The gray of that luminance (sRGB's inverse). */
  const lin = smoke <= 0.0031308 ? smoke * 12.92 : 1.055 * smoke ** (1 / 2.4) - 0.055;
  const g = 255 * lin;
  const mixed = [c.r, c.g, c.b].map((x) => x * c.a + g * (1 - c.a));
  return contrastRatio(mixed as never, [g, g, g] as never);
}

/** The two rules held to 3:1: the secondary kind's outline and the disabled edge. */
export const BORDER_RULES = [
  ['secondary', /\.kb-glass-button\[data-kb-kind='secondary'\]/],
  ['disabled', /\.kb-glass-button:disabled,\s*\.kb-glass-button\[aria-disabled='true'\]/],
] as const;
