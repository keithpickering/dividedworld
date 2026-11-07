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
    const { card, border, outerRadius, canvas, keepClear } = TEMPLATE;
    const expected: Record<string, number> = {
      '--kb-pc-border': border,
      '--kb-pc-radius': outerRadius,
      '--kb-pc-canvas-radius': canvas.r,
      '--kb-pc-keep': keepClear,
    };
    for (const s of sizes) {
      const vars = templateVars(s);
      expect(vars['--kb-pc-w']).toBe(`${SIZES[s]}px`);
      for (const [k, units] of Object.entries(expected)) {
        const m = /^calc\(var\(--kb-pc-w\) \* ([\d.]+)\)$/.exec(vars[k] ?? '');
        expect(m, k).not.toBeNull();
        expect(Number(m![1]) * card.w, k).toBeCloseTo(units, 3);
      }
      for (const v of Object.values(vars)) expect(v).not.toContain('cqw');
    }
  });

  it("draws the artist's template", async () => {
    const { card, outerRadius, canvas, keepClear, focus, plateTop } = TEMPLATE;
    const svg = templateSvg();
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.getAttribute('viewBox')).toBe(`0 0 ${card.w} ${card.h}`);

    const art = doc.getElementById('art');
    expect(art).not.toBeNull();
    const guides = doc.getElementById('guides');
    expect(guides?.getAttribute('sodipodi:insensitive')).toBe('true');
    expect(guides?.getAttribute('inkscape:label')).toBe('Guides, locked');

    const rects = Array.from(guides!.querySelectorAll('rect'));
    const num = (el: Element, a: string) => Number(el.getAttribute(a));
    const at = (x: number, y: number, w: number, h: number) =>
      rects.find((r) => num(r, 'x') === x && num(r, 'y') === y && num(r, 'width') === w && num(r, 'height') === h);

    const frame = at(0, 0, card.w, card.h);
    expect(num(frame!, 'rx')).toBe(outerRadius);
    const canvasRect = at(canvas.x, canvas.y, canvas.w, canvas.h);
    expect(num(canvasRect!, 'rx')).toBe(canvas.r);
    const keepRect = at(keepClear, keepClear, card.w - 2 * keepClear, card.h - 2 * keepClear);
    expect(keepRect).toBeDefined();
    expect(Number(keepRect!.getAttribute('rx'))).toBe(outerRadius - keepClear);
    const focusRect = at(focus.x, focus.y, focus.w, focus.h);
    expect(focusRect?.getAttribute('stroke-dasharray')).toBeTruthy();
    const plateLine = Array.from(guides!.querySelectorAll('line')).find((l) => num(l, 'y1') === plateTop);
    expect(plateLine).toBeDefined();
    expect(num(plateLine!, 'y2')).toBe(plateTop);

    const artRect = art!.querySelector('rect');
    expect([num(artRect!, 'x'), num(artRect!, 'y'), num(artRect!, 'width'), num(artRect!, 'height')]).toEqual([canvas.x, canvas.y, canvas.w, canvas.h]);

    await expect(svg).toMatchFileSnapshot('./card-template.svg');
  });
});
