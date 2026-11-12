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
  /* The tear's points: the ones written with the tear's two heights. */
  const tear = (b: string) => [...b.matchAll(/([\d.]+%) var\(--kb-tear-(?:hi|lo)\)/gu)].map((m) => m[0]);

  test('a pictured whole pack has no clip and no background', () => {
    const b = block(".kb-pack[data-kb-pictured]");
    expect(b).toMatch(/clip-path:\s*none/u);
    expect(b).toMatch(/background:\s*none/u);
  });

  test('the pictured torn parts\' tear points are the drawn pack\'s', () => {
    for (const part of ['opened', 'top']) {
      const drawnTear = tear(block(`.kb-pack[data-part='${part}']`));
      const picturedTear = tear(block(`.kb-pack[data-kb-pictured][data-part='${part}']`));
      expect(drawnTear).toHaveLength(13);
      expect(picturedTear).toEqual(drawnTear);
    }
  });
});
