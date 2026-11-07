/**
 * Divided World's email theme: its name, address, images, fonts and colors, for the engine's mail
 * shell. The colors are read from the glass tokens in ../ui/glass.json by name, so there is no
 * second list of them to drift; a token that is missing or not a six-digit hex throws.
 */
import type { MailTheme } from '../../../engine/mail/types.ts';
import glass from '../ui/glass.json' with { type: 'json' };

/** One token's color from a `keys.standard` table, or a throw naming the token. */
export function readColor(standard: Record<string, { value?: unknown } | undefined>, token: string): string {
  const v = standard[token]?.value;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`glass.json ${token}: missing or not a 6-digit hex color`);
  return v;
}

const std = glass.keys.standard as Record<string, { value?: unknown } | undefined>;
const color = (token: string) => readColor(std, token);

const site = 'https://dw.gripe';
const font = (family: string, file: string, weight: number) => ({ family, url: `${site}/mail/fonts/${file}`, weight, style: 'normal' as const });

export const mailTheme: MailTheme = {
  name: 'Divided World',
  site,
  assets: {
    smoke: `${site}/mail/smoke.jpg`,
    cutPanel: `${site}/mail/cut-panel.png`,
    cutButton: `${site}/mail/cut-button.png`,
    coin: `${site}/mail/coin.png`,
  },
  fonts: [
    font('Anton', 'Anton-Regular.woff2', 400),
    font('Barlow Condensed', 'BarlowCondensed-Medium.woff2', 500),
    font('Barlow Condensed', 'BarlowCondensed-SemiBold.woff2', 600),
    font('Barlow Condensed', 'BarlowCondensed-Bold.woff2', 700),
  ],
  // Single quotes: the shell writes a stack inside a double-quoted style attribute.
  stacks: {
    display: "'Anton', Impact, 'Arial Narrow', sans-serif",
    body: "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif",
  },
  colors: {
    ground: color('--kb-glass-ground'),
    field: color('--kb-glass-field'),
    text: color('--kb-glass-text'),
    text2: color('--kb-glass-text-2'),
    hi: color('--kb-glass-text-hi'),
    pale: color('--kb-glass-pale'),
    neon: color('--kb-glass-neon'),
    violet: color('--kb-glass-violet'),
    neonText: color('--kb-glass-neon-text'),
    ink: color('--kb-glass-ink-neon'),
  },
};
