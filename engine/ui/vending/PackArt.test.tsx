import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { PackArt } from './PackArt.tsx';

vi.mock('./packLight.ts', () => ({ PackLight: ({ picture, relief, part }: { picture: string; relief: string; part: string }) => <canvas className="kb-pack-light" data-picture={picture} data-relief={relief} data-part={part} /> }));

afterEach(cleanup);
const base = { color: '#ffd93d', ink: '#1a1403' };
const drawn = (art: Parameters<typeof PackArt>[0]['art'], part?: 'whole' | 'opened' | 'top') => {
  const { container } = render(<PackArt name="Booster" count={5} art={art} {...(part ? { part } : {})} />);
  return container.firstElementChild as HTMLElement;
};

describe('a pack with a picture', () => {
  const art = { ...base, picture: '/pack.webp', mark: '/mark.svg', canvas: '/foil.webp' };

  test('is the picture and the count and nothing the crimped pack prints', () => {
    const root = drawn(art);
    const imgs = root.querySelectorAll('img.kb-pack-picture');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', '/pack.webp');
    expect(imgs[0]).toHaveAttribute('alt', '');
    expect(imgs[0]).toHaveAttribute('decoding', 'async');
    expect(root.querySelector('.kb-pack-count')).toHaveAttribute('data-kb-text', '5 cards');
    for (const gone of ['.kb-pack-seal', '.kb-pack-sheen', '.kb-pack-mark', '.kb-pack-name']) expect(root.querySelector(gone)).toBeNull();
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveAttribute('data-kb-art');
    expect(root).toHaveAttribute('data-kb-pictured');
  });

  test('has a light canvas with a relief, and none without one', () => {
    expect(drawn({ ...art, relief: '/relief.webp' }).querySelectorAll('canvas.kb-pack-light')).toHaveLength(1);
    cleanup();
    expect(drawn(art).querySelectorAll('canvas.kb-pack-light')).toHaveLength(0);
  });
});

describe('a pack with no picture', () => {
  test('is the crimped pack as it was: seals, sheen, name, count, and the mark when given', () => {
    const root = drawn({ ...base, mark: '/mark.svg' });
    expect(root.querySelectorAll('.kb-pack-seal')).toHaveLength(2);
    expect(root.querySelector('.kb-pack-sheen')).not.toBeNull();
    expect(root.querySelector('.kb-pack-mark')).toHaveAttribute('src', '/mark.svg');
    expect(root.querySelector('.kb-pack-name')).toHaveAttribute('data-kb-text', 'Booster');
    expect(root.querySelector('.kb-pack-count')).toHaveAttribute('data-kb-text', '5 cards');
    expect(root).not.toHaveAttribute('data-kb-pictured');
    expect(root.querySelector('img.kb-pack-picture, canvas')).toBeNull();
    cleanup();
    expect(drawn(base).querySelector('.kb-pack-mark')).toBeNull();
  });
});

test('each part sets data-part, pictured or not', () => {
  for (const art of [base, { ...base, picture: '/pack.webp' }]) {
    for (const part of ['whole', 'opened', 'top'] as const) {
      expect(drawn(art, part)).toHaveAttribute('data-part', part);
      cleanup();
    }
  }
});

describe('the stylesheet', () => {
  const css = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'pack.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  const block = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };
  /* The tear is written once, as the custom property `--kb-tear` (a point list, x in percent and y in units of `--kb-u`), and each of the four polygons spells it `var(--kb-tear)`. */
  const tearDef = (): { x: number; y: number }[] => {
    const at = css.indexOf('--kb-tear:');
    expect(at, 'the tear is defined').toBeGreaterThanOrEqual(0);
    return [...css.slice(at, css.indexOf(';', at)).matchAll(/([\d.]+)% calc\(var\(--kb-u\) \* ([\d.]+)\)/gu)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  };

  test('a pictured whole pack has no clip and no background', () => {
    const b = block(".kb-pack[data-kb-pictured]");
    expect(b).toMatch(/clip-path:\s*none/u);
    expect(b).toMatch(/background:\s*none/u);
  });

  test('the tear is one line in all four polygons: each torn part, drawn and pictured, takes it from the one definition', () => {
    for (const part of ['opened', 'top']) {
      for (const sel of [`.kb-pack[data-part='${part}']`, `.kb-pack[data-kb-pictured][data-part='${part}']`]) {
        const b = block(sel);
        expect(b, sel).toContain('var(--kb-tear)');
        expect(b, `${sel} writes no tear points of its own`).not.toMatch(/calc\(var\(--kb-u\) \* [\d.]+\)/u);
      }
    }
    expect(css).not.toMatch(/--kb-tear-(?:hi|lo)/u);
  });

  test('the tear is an irregular line of 22 vertices from edge to edge, within 7.5 to 14.5 units', () => {
    const t = tearDef();
    expect(t).toHaveLength(22);
    expect(t[0]!.x).toBe(0);
    expect(t.at(-1)!.x).toBe(100);
    for (let i = 1; i < t.length; i++) expect(t[i]!.x, `x at vertex ${i}`).toBeGreaterThan(t[i - 1]!.x);
    const steps = new Set(t.slice(1).map((p, i) => Math.round((p.x - t[i]!.x) * 100)));
    expect(steps.size, 'the x steps are not all equal').toBeGreaterThan(1);
    expect(new Set(t.map((p) => p.y)).size, 'the y values take more than two values').toBeGreaterThan(2);
    for (const p of t) {
      expect(p.y).toBeGreaterThanOrEqual(7.5);
      expect(p.y).toBeLessThanOrEqual(14.5);
    }
  });

  test('the top part traces the same tear as the opened part, so they meet at rest with no gap or overlap', () => {
    /* Opened walks the tear left to right and drops to the foot; the top walks it left to right and closes through the crimp back to the start: the same
       points in the same place, so the two parts share every vertex. A polygon's winding does not change what it fills. */
    const opened = block(".kb-pack[data-part='opened']");
    const top = block(".kb-pack[data-part='top']");
    expect(opened.match(/var\(--kb-tear\)/gu)).toHaveLength(1);
    expect(top.match(/var\(--kb-tear\)/gu)).toHaveLength(1);
    expect(opened.indexOf('var(--kb-tear)')).toBeLessThan(opened.indexOf('100% calc(100% - var(--kb-crimp))'));
    expect(top.indexOf('var(--kb-tear)')).toBeLessThan(top.indexOf('100% var(--kb-crimp)'));
  });

  test('the pictured rules come after the drawn pack\'s rules they override', () => {
    for (const part of ['opened', 'top']) {
      expect(css.indexOf(`.kb-pack[data-kb-pictured][data-part='${part}'] {`), part).toBeGreaterThan(css.indexOf(`.kb-pack[data-part='${part}'] {`));
    }
    expect(css.indexOf('.kb-pack[data-kb-pictured] {')).toBeGreaterThan(css.indexOf('.kb-pack {'));
  });
});
