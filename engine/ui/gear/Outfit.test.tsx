import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { Piece } from '../../rules/cosmetics.ts';
import { renderInWorld } from '../test-world.tsx';
import { Outfit, slotShape } from './Outfit.tsx';

const piece = (over: Partial<Piece> = {}): Piece => ({ gear: 'band', x: 0.5, y: 0.5, w: 0.5, turn: 0, layer: 0, ...over });
const show = (el: React.ReactElement) => renderInWorld(el).container.querySelector<HTMLElement>('.kb-outfit');
const pieces = (box: HTMLElement | null) => [...(box?.querySelectorAll<HTMLImageElement>('img') ?? [])];

describe('the outfit on a portrait', () => {
  test('a piece at x 0.5, y 0 is centered on the slot\'s top edge', () => {
    const [img] = pieces(show(<Outfit pieces={[piece({ y: 0 })]} on="portrait" />));
    expect(img!.style.left).toBe('50%');
    expect(img!.style.top).toBe('0%');
    expect(img!.style.transform).toContain('translate(-50%, -50%)');
  });

  test('a piece is as wide as its fraction of the portrait, as tall as its art, turned and stacked by layer', () => {
    const box = show(<Outfit pieces={[piece({ gear: 'tall', layer: 2, turn: 30, w: 0.4 }), piece({ layer: 1 })]} on="portrait" />);
    const [low, high] = pieces(box);
    expect(low!.getAttribute('src')).toBe('band.svg');
    expect(high!.getAttribute('src')).toBe('tall.svg');
    expect(high!.style.width).toBe('40%');
    expect(high!.style.aspectRatio).toBe('1 / 2');
    expect(high!.style.transform).toContain('rotate(30deg)');
    expect(Number(high!.style.zIndex)).toBeGreaterThan(Number(low!.style.zIndex));
  });

  test('the whole layer is hidden from assistive tech, a piece\'s art is a plain file, and an unknown gear draws nothing', () => {
    const box = show(<Outfit pieces={[piece(), piece({ gear: 'no-such-gear' })]} on="portrait" />)!;
    expect(box).toHaveAttribute('aria-hidden', 'true');
    expect(pieces(box)).toHaveLength(1);
    for (const img of pieces(box)) expect(img.getAttribute('src')).not.toMatch(/^data:/u);
  });

  test('the slot takes the portrait\'s tallness as its aspect ratio, and none where it is unknown', () => {
    expect(slotShape(1.4)).toEqual({ aspectRatio: '1 / 1.4' });
    expect(slotShape(null)).toBeUndefined();
  });
});

describe('the outfit on the square', () => {
  /* The square is the portrait's top half: full width, half the height. */
  const frame = { x: 0, y: 0, w: 1, h: 0.5 };

  test('a piece is mapped into the square\'s own coordinates', () => {
    const [img] = pieces(show(<Outfit pieces={[piece({ y: 0.25, w: 0.5 })]} on="square" frame={frame} />));
    expect(img!.style.top).toBe('50%');
    expect(img!.style.width).toBe('50%');
  });

  test('a piece wholly below the square draws nothing, and one wholly beside it too', () => {
    expect(pieces(show(<Outfit pieces={[piece({ y: 0.9 })]} on="square" frame={frame} />))).toHaveLength(0);
    expect(pieces(show(<Outfit pieces={[piece({ x: 2 })]} on="square" frame={frame} />))).toHaveLength(0);
  });

  test('a piece reaching into the square from below is kept', () => {
    expect(pieces(show(<Outfit pieces={[piece({ gear: 'tall', y: 0.7, w: 0.5 })]} on="square" frame={frame} />))).toHaveLength(1);
  });

  test('with no square frame there is nothing to map, so nothing is drawn', () => {
    expect(pieces(show(<Outfit pieces={[piece()]} on="square" frame={null} />))).toHaveLength(0);
  });
});

describe('the outfit in the stylesheet', () => {
  const css = readFileSync('engine/ui/gear/outfit.css', 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
  test('the portrait\'s layer is cut at the reach past each edge and the square\'s at its own edge', () => {
    expect(css).toMatch(/\.kb-outfit\[data-kb-on="portrait"\][^{]*\{[^}]*clip-path:\s*inset\(/u);
    expect(css).toMatch(/\.kb-outfit\[data-kb-on="square"\][^{]*\{[^}]*overflow:\s*hidden/u);
  });

  test('a browser without container query units still cuts the reach, by a fallback declared before the cqw one', () => {
    const d = /\.kb-outfit\[data-kb-on="portrait"\]\s*\{([^}]*)\}/u.exec(css)![1]!;
    const clips = [...d.matchAll(/clip-path:\s*([^;]+);/gu)].map((m) => m[1]!);
    expect(clips).toHaveLength(2);
    expect(clips[0]).not.toMatch(/cqw/u);
    expect(clips[1]).toMatch(/cqw/u);
  });
});
