/**
 * `bringClear`: a card's own screen furniture (a dock at the window's foot) and the sticky bar are held out of the window by the root's
 * `scroll-padding-top` and `scroll-padding-bottom`, so the clear area is what lies between them. An element not wholly in it is scrolled so its top
 * is at the clear area's top; one already there is left, so a second call does not jiggle the page.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bringClear } from './clear.ts';

const root = document.documentElement;
const at = (top: number, height = 200): Element & { scrollIntoView: ReturnType<typeof vi.fn> } => {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 300, width: 300, height, x: 0, y: top, toJSON: () => ({}) });
  const scroll = vi.fn();
  el.scrollIntoView = scroll;
  return Object.assign(el, { scrollIntoView: scroll });
};

beforeEach(() => {
  vi.stubGlobal('innerHeight', 800);
  root.style.scrollPaddingTop = '60px';
  root.style.scrollPaddingBottom = '400px';
});
afterEach(() => {
  vi.unstubAllGlobals();
  root.style.removeProperty('scroll-padding-top');
  root.style.removeProperty('scroll-padding-bottom');
  root.removeAttribute('data-kb-motion');
});

describe('bringClear', () => {
  test('the clear area is read from the root: 60px to 400px here', () => {
    expect(getComputedStyle(root).scrollPaddingTop).toBe('60px');
    expect(getComputedStyle(root).scrollPaddingBottom).toBe('400px');
  });

  test('an element wholly inside the clear area is not scrolled', () => {
    const el = at(100, 200);
    bringClear(el);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  test('an element whose bottom is behind the bottom padding is scrolled to the top of the clear area, at once', () => {
    const el = at(300, 200);
    bringClear(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
  });

  test('an element above the clear area, or below the window, is scrolled', () => {
    const above = at(10, 100);
    const below = at(900, 100);
    bringClear(above);
    bringClear(below);
    expect(above.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(below.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  test('under reduced motion the scroll is instant too', () => {
    root.setAttribute('data-kb-motion', 'reduce');
    const el = at(300, 200);
    bringClear(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
  });

  test('an element taller than the clear area is scrolled to its top, and not again once its top is there', () => {
    const tall = at(200, 900);
    bringClear(tall);
    expect(tall.scrollIntoView).toHaveBeenCalledTimes(1);
    const there = at(61, 900);
    bringClear(there);
    expect(there.scrollIntoView).not.toHaveBeenCalled();
  });

  test('padding that is auto or unparseable counts as none', () => {
    root.style.scrollPaddingTop = 'auto';
    root.style.scrollPaddingBottom = 'auto';
    const el = at(500, 250);
    bringClear(el);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
    const low = at(700, 250);
    bringClear(low);
    expect(low.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
