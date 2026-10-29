import { describe, expect, test } from 'vitest';
import { applyAppearance, motionReduced, resolveAppearance } from './appearance.ts';
import type { ThemeOption } from './types.ts';

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
