/**
 * The ORIGIN box's band (docs/plans/2026-11-11-origin-band-design.md, section 2): the box is a 1px frame on the second row's ground, and its
 * head is the column head's band, edge to edge inside that frame, in the theme's own --kb-head-* tokens. The bright ink never reaches the
 * band, and its link keeps the band's ink with the column head's ring.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//gu, '');
const spin = strip(fs.readFileSync(path.resolve(here, 'spin.css'), 'utf8'));
const thread = strip(fs.readFileSync(path.resolve(here, '../thread/thread.css'), 'utf8'));
/* The declaration blocks of every rule whose comma-separated selector list includes `selector` exactly, trimmed. */
const rules = (text: string, selector: string): string[] => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
  .filter((m) => m[1]!.split(',').map((s) => s.replace(/\s+/gu, ' ').trim()).includes(selector))
  .map((m) => m[2]!.trim());

describe('the ORIGIN box', () => {
  test('the box is a 1px frame on the second row\'s ground, with no double rule and no percentage padding', () => {
    const own = rules(spin, '.kb-origin').join(';');
    expect(own).toMatch(/border:\s*1px solid var\(--kb-frame\)/u);
    expect(own).toMatch(/background:\s*var\(--kb-row-2\)/u);
    expect(own).toMatch(/--kb-post-bg:\s*var\(--kb-row-2\)/u);
    expect(own).not.toMatch(/double/u);
    expect(rules(spin, '.kb-origin').join(';')).not.toMatch(/padding:[^;]*%/u);
  });

  test('the band is the column head\'s: its ground, ink, shadow, weight and rule come from the head tokens, and it keeps the date row\'s min-height', () => {
    const band = rules(spin, '.kb-origin-head').join(';');
    expect(band).toMatch(/background:\s*var\(--kb-head-bg\)/u);
    expect(band).toMatch(/color:\s*var\(--kb-head-fg\)/u);
    expect(band).toMatch(/text-shadow:\s*var\(--kb-head-shadow\)/u);
    expect(band).toMatch(/font-weight:\s*bold/u);
    expect(band).toMatch(/border-bottom:\s*1px solid var\(--kb-grid\)/u);
    expect(band).toMatch(/min-height:\s*calc\(var\(--kb-meta-tile\) - 0\.4rem\)/u);
  });

  test('the band takes back the box\'s inset: the box sets it, the band\'s margin is its negation and its padding is it', () => {
    expect(rules(spin, '.kb-origin').join(';')).toMatch(/--kb-origin-inset:/u);
    const band = rules(spin, '.kb-origin-head').join(';');
    expect(band).toMatch(/margin:[^;]*calc\(-1 \* var\(--kb-origin-inset\)\)/u);
    expect(band).toMatch(/padding:[^;]*var\(--kb-origin-inset\)/u);
  });

  test('the link on the band keeps the band\'s ink, grows its underline on hover, and rings in the column head\'s focus color; no rule reaches the mark tiles', () => {
    for (const sel of ['.kb-origin-head a', '.kb-origin-head a:visited', '.kb-origin-head a:hover']) {
      expect(rules(spin, sel).join(';'), sel).toMatch(/color:\s*var\(--kb-head-fg\)/u);
    }
    expect(rules(spin, '.kb-origin-head a:hover').join(';')).toMatch(/text-decoration-thickness:/u);
    expect(rules(spin, '.kb-origin-head a:focus-visible').join(';')).toMatch(/outline-color:\s*var\(--kb-head-focus\)/u);
    expect(spin).not.toMatch(/\.kb-origin-head \*?:focus-visible/u);
  });

  test('bright ink: no thread rule whose selector names data-kb-bright-ink names .kb-origin-head, so the bright ink never reaches the band', () => {
    for (const m of thread.matchAll(/([^{}]+)\{[^{}]*\}/gu)) {
      const selector = m[1]!;
      if (selector.includes('data-kb-bright-ink')) expect(selector, selector).not.toMatch(/kb-origin-head/u);
    }
    const band = rules(spin, '.kb-origin-head').join(';');
    expect(band).toMatch(/(?<![-\w])color:\s*var\(--kb-head-fg\)/u);
    expect(band).toMatch(/text-shadow:\s*var\(--kb-head-shadow\)/u);
  });
});
