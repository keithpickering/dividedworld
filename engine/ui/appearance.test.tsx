import { describe, expect, test } from 'vitest';
import { applyAppearance, motionReduced, resolveAppearance, smokeLevel, textSize } from './appearance.ts';
import type { GlassTheme, ThemeOption } from './types.ts';

const themes: ThemeOption[] = [
  { key: 'house', name: 'House', href: '/house.css', modes: 'both' },
  { key: 'midnight', name: 'Midnight', href: '/midnight.css', modes: 'dark' },
];

describe('the theme a preference resolves to', () => {
  test('"system" is the house theme, following the device', () => {
    expect(resolveAppearance({ theme: 'system', motion: 'system' }, themes)).toEqual({ href: '/house.css', mode: null, motion: null });
  });
  test('light and dark are the house theme, overriding the device', () => {
    expect(resolveAppearance({ theme: 'light', motion: 'system' }, themes).mode).toBe('light');
    expect(resolveAppearance({ theme: 'dark', motion: 'system' }, themes)).toMatchObject({ href: '/house.css', mode: 'dark' });
  });
  test('an instance theme with one mode is that mode', () => {
    expect(resolveAppearance({ theme: 'midnight', motion: 'system' }, themes)).toEqual({ href: '/midnight.css', mode: 'dark', motion: null });
  });
  test('a theme the instance no longer offers falls back to the house theme on the device', () => {
    expect(resolveAppearance({ theme: 'gone', motion: 'system' }, themes)).toEqual({ href: '/house.css', mode: null, motion: null });
  });
  test('a motion the engine does not know follows the device', () => {
    expect(resolveAppearance({ theme: 'system', motion: 'Reduce' as 'reduce' }, themes).motion).toBe(null);
    expect(resolveAppearance({ theme: 'system', motion: null as unknown as 'system' }, themes).motion).toBe(null);
  });
  test('motion: the device unless overridden', () => {
    expect(resolveAppearance({ theme: 'system', motion: 'reduce' }, themes).motion).toBe('reduce');
    expect(resolveAppearance({ theme: 'system', motion: 'full' }, themes).motion).toBe('full');
  });
});

describe('applying it to the page', () => {
  test('the device\'s own choice sets no attribute, so the theme\'s media query decides', () => {
    applyAppearance(document, { theme: 'system', motion: 'system' }, themes);
    expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false);
    expect(document.documentElement.hasAttribute('data-kb-motion')).toBe(false);
    expect(document.querySelector<HTMLLinkElement>('link#kb-theme')?.getAttribute('href')).toBe('/house.css');
  });
  test('an override sets the attributes, and the theme link is swapped, never doubled', () => {
    applyAppearance(document, { theme: 'midnight', motion: 'reduce' }, themes);
    expect(document.documentElement.getAttribute('data-kb-mode')).toBe('dark');
    expect(document.documentElement.getAttribute('data-kb-motion')).toBe('reduce');
    expect(document.querySelectorAll('link#kb-theme')).toHaveLength(1);
    expect(document.querySelector<HTMLLinkElement>('link#kb-theme')?.getAttribute('href')).toBe('/midnight.css');
    applyAppearance(document, { theme: 'system', motion: 'system' }, themes);
    expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false);
    expect(document.documentElement.hasAttribute('data-kb-motion')).toBe(false);
  });
});

describe('whether motion is reduced', () => {
  const device = (reduce: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q })) as unknown as typeof window.matchMedia;
  };
  test('the device decides when the player has not overridden it', () => {
    applyAppearance(document, { theme: 'system', motion: 'system' }, themes);
    device(true);
    expect(motionReduced()).toBe(true);
    device(false);
    expect(motionReduced()).toBe(false);
  });
  test('the player\'s override wins over the device either way', () => {
    device(false);
    applyAppearance(document, { theme: 'system', motion: 'reduce' }, themes);
    expect(motionReduced()).toBe(true);
    device(true);
    applyAppearance(document, { theme: 'system', motion: 'full' }, themes);
    expect(motionReduced()).toBe(false);
  });
});

describe('the glass\'s three preferences on the page', () => {
  const root = document.documentElement;
  const glass = {
    keys: {
      standard: { '--kb-glass-text': { value: '#f1ecff', tags: ['body'] } },
      high: { '--kb-glass-text': { value: '#ffffff', tags: ['body'] } },
    },
    smoke: { recipes: {}, surfaces: {} }, calm: { opacity: 0.85, feather: 32 }, sizes: {}, fonts: [], classes: {}, orbs: { gradients: [], body: {} },
  } as unknown as GlassTheme;
  const marks = () => ['data-kb-smoke', 'data-kb-contrast', 'data-kb-text-size', 'data-kb-glass-key'].map((a) => root.getAttribute(a));

  test('their defaults set no mark, and the glass keeps its standard key', () => {
    applyAppearance(document, { theme: 'system', motion: 'system', smoke: 'full', contrast: 'standard', textSize: 100 }, themes, glass);
    expect(marks()).toEqual([null, null, null, 'standard']);
    expect(root.style.getPropertyValue('--kb-glass-text')).toBe('#f1ecff');
  });

  test('each choice away from its default marks the root, and high contrast puts the high key\'s values on it', () => {
    applyAppearance(document, { theme: 'system', motion: 'system', smoke: 'off', contrast: 'high', textSize: 200 }, themes, glass);
    expect(marks()).toEqual(['off', 'high', '200', 'high']);
    expect(root.style.getPropertyValue('--kb-glass-text')).toBe('#ffffff');
    expect(smokeLevel()).toBe('off');
    expect(textSize()).toBe(200);
    applyAppearance(document, { theme: 'system', motion: 'system', smoke: 'low', textSize: 125 }, themes, glass);
    expect(marks()).toEqual(['low', null, '125', 'standard']);
    expect(root.style.getPropertyValue('--kb-glass-text')).toBe('#f1ecff');
  });

  test('a preference left out or one the engine does not know is its default, so signing out takes every mark off', () => {
    applyAppearance(document, { theme: 'system', motion: 'system', smoke: 'off', contrast: 'high', textSize: 150 }, themes, glass);
    applyAppearance(document, { theme: 'system', motion: 'system', smoke: 'thick' as 'off', textSize: 175 as 150 }, themes, glass);
    expect(marks()).toEqual([null, null, null, 'standard']);
    applyAppearance(document, { theme: 'system', motion: 'system', smoke: 'off', contrast: 'high', textSize: 150 }, themes, glass);
    applyAppearance(document, { theme: 'system', motion: 'system' }, themes, glass);
    expect(marks()).toEqual([null, null, null, 'standard']);
    expect(smokeLevel()).toBe('full');
    expect(textSize()).toBe(100);
  });
});
