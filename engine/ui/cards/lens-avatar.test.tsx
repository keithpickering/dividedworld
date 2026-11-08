/**
 * The Lens's avatars grow with the text, so their placeholder letters stay inside their borders (the same reason hud-avatar.test.tsx
 * checks the HUD's): both are sized in rem, never px.
 */
import fs from 'node:fs';
import { describe, expect, test } from 'vitest';

const css = fs.readFileSync('engine/ui/cards/lens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const decls = (selector: string): string => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(',').map((s) => s.replace(/\s+/g, ' ').trim()).includes(selector)).map((m) => m[2]).join(';');

describe('the Lens\'s avatars', () => {
  test.each([['.kb-lens-row-avatar', '2.75rem'], ['.kb-lens-face', '1.5rem']])('%s is sized in rem', (selector, size) => {
    const d = decls(selector);
    expect(d).toMatch(new RegExp(`width:\\s*${size.replace('.', '\\.')}`));
    expect(d).toMatch(new RegExp(`height:\\s*${size.replace('.', '\\.')}`));
    expect(d).not.toMatch(/(?:width|height):\s*[\d.]+px/);
  });
});
