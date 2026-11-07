import { describe, expect, it } from 'vitest';
import { SIZES, TEMPLATE, templateSvg, templateVars, type PostcardSize } from './template.ts';

const sizes = Object.keys(SIZES) as PostcardSize[];

describe('the card template', () => {
  it('is 2:3 in whole pixels at every size', () => {
    expect(sizes.length).toBe(4);
    for (const s of sizes) expect(Number.isInteger(SIZES[s] * 1.5), s).toBe(true);
    expect(SIZES.slot).toBe(86);
  });

  it('keeps its measures consistent', () => {
    const { card, border, outerRadius, canvas, keepClear, focus, plateTop } = TEMPLATE;
    expect(outerRadius).toBe(border + canvas.r);
    expect(keepClear).toBeLessThan(border);
    expect(canvas.x).toBe(border);
    expect(canvas.y).toBe(border);
    expect(canvas.w).toBe(card.w - 2 * border);
    expect(canvas.h).toBe(card.h - 2 * border);
    expect(focus.x).toBeGreaterThanOrEqual(canvas.x);
    expect(focus.y).toBeGreaterThanOrEqual(canvas.y);
    expect(focus.x + focus.w).toBeLessThanOrEqual(canvas.x + canvas.w);
    expect(focus.y + focus.h).toBeLessThanOrEqual(canvas.y + canvas.h);
    expect(plateTop).toBeGreaterThan(canvas.y);
    expect(plateTop).toBeLessThan(canvas.y + canvas.h);
  });

  it('writes its custom properties without container units', () => {
    const vars = templateVars('slot');
    expect(vars['--kb-pc-w']).toBe('86px');
    for (const k of ['--kb-pc-border', '--kb-pc-radius', '--kb-pc-canvas-radius', '--kb-pc-keep']) {
      expect(vars[k], k).toMatch(/^calc\(var\(--kb-pc-w\) \* [\d.]+\)$/);
    }
    for (const v of Object.values(vars)) expect(v).not.toContain('cqw');
  });

  it("draws the artist's template", async () => {
    const svg = templateSvg();
    expect(svg).toContain('viewBox="0 0 600 900"');
    expect(svg).toMatch(/<g\b[^>]*id="guides"[^>]*sodipodi:insensitive="true"|<g\b[^>]*sodipodi:insensitive="true"[^>]*id="guides"/);
    expect(svg).toContain('inkscape:label="Guides, locked"');
    expect(svg).toMatch(/<g\b[^>]*id="art"/);
    await expect(svg).toMatchFileSnapshot('./card-template.svg');
  });
});
