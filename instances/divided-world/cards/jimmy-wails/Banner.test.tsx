/**
 * Jimmy Wails's banner (plan Task 7): the plate a play was drawn on, the size its words are set at, and the contrast they keep on each plate.
 * jsdom has no layout, so the fit is the pure `fitSize` given a fake measurer; the contrast is held against the darkest and lightest colors
 * recorded in plates.ts for each plate's box, since contrast.ts cannot sample a picture.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ratio } from '../../../../engine/ui/contrast.ts';
import type { CardPlay } from '../../../../engine/ui/cards/types.ts';
import { PLATES } from '../../ui/jimmy-wails/plates.ts';
import { Banner, fitSize, MAX_SIZE, MIN_SIZE, plateOf } from './Banner.tsx';

const play = (over: Partial<CardPlay> = {}): CardPlay => ({ id: 'p1', card: 'jimmy-wails', layer: 1, caster: 'c1', message: 'Please help me pay for my shirts.', config: {}, playedAt: '2026-11-03T10:00:00.000Z', post: 'post-1', drawn: 'close-up', ...over });

describe('the plate', () => {
  test('is the one the play was drawn on', () => {
    for (const p of PLATES) expect(plateOf(play({ drawn: p.key })).key).toBe(p.key);
    const { container } = render(<Banner play={play({ drawn: 'dark-logo' })} caster="Spritey" />);
    expect(container.querySelector('figure')!.getAttribute('data-plate')).toBe('dark-logo');
    expect(container.querySelector('img')!.getAttribute('src')).toBe(PLATES.find((p) => p.key === 'dark-logo')!.src);
  });

  test('falls back to the first plate for a key the pool no longer holds, or none', () => {
    expect(plateOf(play({ drawn: 'a-plate-we-removed' })).key).toBe(PLATES[0]!.key);
    expect(plateOf(play({ drawn: undefined })).key).toBe(PLATES[0]!.key);
    const { container } = render(<Banner play={play({ drawn: 'a-plate-we-removed' })} caster="Spritey" />);
    expect(container.querySelector('figure')!.getAttribute('data-plate')).toBe(PLATES[0]!.key);
  });

  test('is decoration, and the figure is named for the caster; the words are real text', () => {
    const { container } = render(<Banner play={play()} caster="Spritey" />);
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(screen.getByRole('figure', { name: 'Appeal from Spritey' })).toBeTruthy();
    expect(screen.getByText('Please read:')).toBeTruthy();
    expect(screen.getByText('Please help me pay for my shirts.')).toBeTruthy();
    expect(screen.getByText('A personal appeal from Spritey')).toBeTruthy();
  });

  test('is scaled to the post\'s width at its own aspect ratio, a panel making a plate wider on its right', () => {
    for (const p of PLATES) {
      const wide = p.width + (p.panel?.width ?? 0);
      const { container, unmount } = render(<Banner play={play({ drawn: p.key })} caster="Spritey" />);
      const figure = container.querySelector('figure')!;
      expect(figure.style.aspectRatio.replace(/\s/g, ''), p.key).toBe(`${wide}/${p.height}`);
      const panel = container.querySelector<HTMLElement>('.dw-jw-panel');
      expect(panel === null, p.key).toBe(p.panel === null);
      if (p.panel && panel) {
        expect(panel.style.left, p.key).toBe(`${p.width}px`);
        expect(panel.style.width, p.key).toBe(`${p.panel.width}px`);
      }
      unmount();
    }
  });
});

describe('the credit', () => {
  test('is under the banner, outside its picture: the photographer linked to the photograph, the license linked to its deed, and that it was edited', () => {
    for (const p of PLATES) {
      const { container, unmount } = render(<Banner play={play({ drawn: p.key })} caster="Spritey" />);
      const credit = container.querySelector('.dw-jw-credit')!;
      expect(credit.textContent, p.key).toBe(`Photo: ${p.credit.author}, ${p.credit.license}, edited`);
      expect(container.querySelector('figure')!.contains(credit), p.key).toBe(false);
      const [who, license] = [...credit.querySelectorAll('a')];
      expect(who!.textContent, p.key).toBe(p.credit.author);
      expect(who!.getAttribute('href'), p.key).toBe(p.credit.source);
      expect(license!.textContent, p.key).toBe(p.credit.license);
      expect(license!.getAttribute('href'), p.key).toBe(p.credit.licenseUrl);
      for (const a of [who!, license!]) expect(a.getAttribute('rel'), p.key).toBe('noopener noreferrer');
      unmount();
    }
  });
});

describe('the fit', () => {
  /** Words that take `perChar` pixels across and wrap into lines of the box's width, each `size * 1.2` high. */
  const measurer = (text: string, box: { w: number; h: number }) => (size: number) => {
    const across = text.length * size * 0.5;
    const lines = Math.max(1, Math.ceil(across / box.w));
    return { w: Math.min(across, box.w), h: lines * size * 1.2 + size };
  };

  test('steps down from 28 px until the words fit, and stays at 28 when they fit already', () => {
    const box = { w: 300, h: 100 };
    expect(fitSize(() => ({ w: 10, h: 10 }), box)).toBe(MAX_SIZE);
    const sizes: number[] = [];
    const size = fitSize((s) => { sizes.push(s); return s > 20 ? { w: 301, h: 10 } : { w: 300, h: 100 }; }, box);
    expect(size).toBe(20);
    expect(sizes[0]).toBe(MAX_SIZE);
    expect(sizes.at(-1)).toBe(20);
  });

  test('stops at 13 px when nothing fits', () => {
    expect(fitSize(() => ({ w: 9999, h: 9999 }), { w: 10, h: 10 })).toBe(MIN_SIZE);
  });

  test('sets a 200-character message to fit each plate\'s box, and it fits there', () => {
    const text = 'x'.repeat(200);
    for (const p of PLATES) {
      const measure = measurer(text, p.box);
      const size = fitSize(measure, p.box);
      expect(size, p.key).toBeGreaterThanOrEqual(MIN_SIZE);
      expect(size, p.key).toBeLessThanOrEqual(MAX_SIZE);
      const taken = measure(size);
      expect(taken.h, p.key).toBeLessThanOrEqual(p.box.h);
      expect(taken.w, p.key).toBeLessThanOrEqual(p.box.w);
      /* A size larger than the chosen one did not fit (the largest that fits was chosen), unless the choice was the largest. */
      if (size < MAX_SIZE) expect(measure(size + 1).h > p.box.h || measure(size + 1).w > p.box.w, p.key).toBe(true);
    }
  });

  test('a long message shrinks on a plate, and a short one keeps the large size', () => {
    const box = PLATES[1]!.box;
    expect(fitSize(measurer('x'.repeat(200), box), box)).toBeLessThan(fitSize(measurer('Hi', box), box));
    expect(fitSize(measurer('Hi', box), box)).toBe(MAX_SIZE);
  });
});

describe('the words\' contrast', () => {
  test('keeps at least 4.5 to 1 against the darkest and the lightest color under each plate\'s box', () => {
    for (const p of PLATES) {
      expect(ratio(p.ink, p.boxRange.darkest), `${p.key} on its darkest`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.ink, p.boxRange.lightest), `${p.key} on its lightest`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('a plate with a panel records the panel\'s color under a box that lies wholly in it', () => {
    for (const p of PLATES) {
      if (p.panel && p.box.x >= p.width) {
        expect(p.boxRange.darkest, p.key).toBe(p.boxRange.lightest);
        expect(ratio(p.panel.color, p.boxRange.darkest), p.key).toBeCloseTo(1, 5);
      }
    }
  });
});
