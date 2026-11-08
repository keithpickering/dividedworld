import { describe, expect, test } from 'vitest';
import { applyAppearance, motionReduced, resolveAppearance, smokeLevel, textSize } from './appearance.ts';
import type { GlassTheme, ThemeOption } from './types.ts';

const themes: ThemeOption[] = [
  { key: 'house', name: 'House', href: '/house.css', modes: 'both', preview: {} },
  { key: 'midnight', name: 'Midnight', href: '/midnight.css', modes: 'dark', preview: {} },
];

describe('the theme a preference resolves to', () => {
  test('"system" is the house theme, following the device', () => {
    expect(resolveAppearance({ theme: 'default', motion: 'system' }, themes)).toEqual({ href: '/house.css', mode: null, motion: null, feel: 'smooth' });
  });
  test('the default theme in a mode the player chose', () => {
    expect(resolveAppearance({ theme: 'default', mode: 'light', motion: 'system' }, themes)).toMatchObject({ href: '/house.css', mode: 'light' });
    expect(resolveAppearance({ theme: 'default', mode: 'dark', motion: 'system' }, themes)).toMatchObject({ href: '/house.css', mode: 'dark' });
    expect(resolveAppearance({ theme: 'default', mode: 'system', motion: 'system' }, themes).mode).toBe(null);
  });
  test('a stored dark theme, once the migration has rewritten it, reads back as the default theme in dark', () => {
    expect(resolveAppearance({ theme: 'default', mode: 'dark', motion: 'system' }, themes)).toEqual({ href: '/house.css', mode: 'dark', motion: null, feel: 'smooth' });
  });
  test('the first theme resolves whatever its key is: the engine names no theme', () => {
    const odd: ThemeOption[] = [{ key: 'ink', name: 'Ink', href: '/ink.css', modes: 'both', preview: {} }];
    expect(resolveAppearance({ theme: 'default', mode: 'dark', motion: 'system' }, odd)).toMatchObject({ href: '/ink.css', mode: 'dark' });
    expect(resolveAppearance({ theme: 'ink', mode: 'light', motion: 'system' }, odd)).toMatchObject({ href: '/ink.css', mode: 'light' });
  });
  test('a one-mode theme fixes the mode whatever mode says, and the stored mode is left alone', () => {
    const pref = { theme: 'midnight', mode: 'light' as const, motion: 'system' as const };
    expect(resolveAppearance(pref, themes)).toEqual({ href: '/midnight.css', mode: 'dark', motion: null, feel: 'smooth' });
    expect(pref.mode).toBe('light');
    /* choosing the house theme again returns the player's own mode */
    expect(resolveAppearance({ ...pref, theme: 'default' }, themes)).toMatchObject({ href: '/house.css', mode: 'light' });
  });
  test('an instance theme with one mode is that mode', () => {
    expect(resolveAppearance({ theme: 'midnight', motion: 'system' }, themes)).toEqual({ href: '/midnight.css', mode: 'dark', motion: null, feel: 'smooth' });
  });
  test('a theme the instance no longer offers falls back to the house theme on the device', () => {
    expect(resolveAppearance({ theme: 'gone', motion: 'system' }, themes)).toEqual({ href: '/house.css', mode: null, motion: null, feel: 'smooth' });
  });
  test('a motion the engine does not know follows the device', () => {
    expect(resolveAppearance({ theme: 'default', motion: 'Reduce' as 'reduce' }, themes).motion).toBe(null);
    expect(resolveAppearance({ theme: 'default', motion: null as unknown as 'system' }, themes).motion).toBe(null);
  });
  test('motion: the device unless overridden', () => {
    expect(resolveAppearance({ theme: 'default', motion: 'reduce' }, themes).motion).toBe('reduce');
    expect(resolveAppearance({ theme: 'default', motion: 'full' }, themes).motion).toBe('full');
  });
  test('snappy is full motion at the snappy feel; full is the smooth feel; reduce and system keep the smooth feel', () => {
    expect(resolveAppearance({ theme: 'default', motion: 'snappy' }, themes)).toMatchObject({ motion: 'full', feel: 'snappy' });
    expect(resolveAppearance({ theme: 'default', motion: 'full' }, themes)).toMatchObject({ motion: 'full', feel: 'smooth' });
    expect(resolveAppearance({ theme: 'default', motion: 'reduce' }, themes)).toMatchObject({ motion: 'reduce', feel: 'smooth' });
    expect(resolveAppearance({ theme: 'default', motion: 'system' }, themes)).toMatchObject({ motion: null, feel: 'smooth' });
  });
  test('a stored Snappy survives a theme and a mode chosen beside it', () => {
    expect(resolveAppearance({ theme: 'default', mode: 'dark', motion: 'snappy' }, themes)).toEqual({ href: '/house.css', mode: 'dark', motion: 'full', feel: 'snappy' });
    expect(resolveAppearance({ theme: 'midnight', mode: 'light', motion: 'snappy' }, themes)).toEqual({ href: '/midnight.css', mode: 'dark', motion: 'full', feel: 'snappy' });
  });
});

describe('applying it to the page', () => {
  test('the device\'s own choice sets no attribute, so the theme\'s media query decides', () => {
    applyAppearance(document, { theme: 'default', motion: 'system' }, themes);
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
    applyAppearance(document, { theme: 'default', motion: 'system' }, themes);
    expect(document.documentElement.hasAttribute('data-kb-mode')).toBe(false);
    expect(document.documentElement.hasAttribute('data-kb-motion')).toBe(false);
  });
});

describe('the motion feel on the page', () => {
  test('snappy marks full motion and the snappy feel; full the smooth feel; reduce reduce; system neither', () => {
    const root = document.documentElement;
    applyAppearance(document, { theme: 'default', motion: 'snappy' }, themes);
    expect(root.getAttribute('data-kb-motion')).toBe('full');
    expect(root.getAttribute('data-kb-motion-feel')).toBe('snappy');
    applyAppearance(document, { theme: 'default', motion: 'full' }, themes);
    expect(root.getAttribute('data-kb-motion')).toBe('full');
    expect(root.getAttribute('data-kb-motion-feel')).toBe('smooth');
    applyAppearance(document, { theme: 'default', motion: 'reduce' }, themes);
    expect(root.getAttribute('data-kb-motion')).toBe('reduce');
    applyAppearance(document, { theme: 'default', motion: 'system' }, themes);
    expect(root.hasAttribute('data-kb-motion')).toBe(false);
    expect(root.hasAttribute('data-kb-motion-feel')).toBe(false);
  });
});

describe('whether motion is reduced', () => {
  const device = (reduce: boolean) => {
    window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q })) as unknown as typeof window.matchMedia;
  };
  test('the device decides when the player has not overridden it', () => {
    applyAppearance(document, { theme: 'default', motion: 'system' }, themes);
    device(true);
    expect(motionReduced()).toBe(true);
    device(false);
    expect(motionReduced()).toBe(false);
  });
  test('the player\'s override wins over the device either way', () => {
    device(false);
    applyAppearance(document, { theme: 'default', motion: 'reduce' }, themes);
    expect(motionReduced()).toBe(true);
    device(true);
    applyAppearance(document, { theme: 'default', motion: 'full' }, themes);
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
  const marks = () => ['data-kb-smoke-level', 'data-kb-contrast', 'data-kb-text-size', 'data-kb-glass-key'].map((a) => root.getAttribute(a));

  test('the effects mark is on the root only while the choice is bright, and goes with the account', () => {
    const effects = () => root.getAttribute('data-kb-effects');
    applyAppearance(document, { theme: 'default', motion: 'system', effects: 'standard' }, themes, glass);
    expect(effects()).toBeNull();
    applyAppearance(document, { theme: 'default', motion: 'system', effects: 'bright' }, themes, glass);
    expect(effects()).toBe('bright');
    applyAppearance(document, { theme: 'default', motion: 'system' }, themes, glass);
    expect(effects()).toBeNull();
  });

  test('their defaults set no mark, and the glass keeps its standard key', () => {
    applyAppearance(document, { theme: 'default', motion: 'system', smoke: 'full', contrast: 'standard', textSize: 100 }, themes, glass);
    expect(marks()).toEqual([null, null, null, 'standard']);
    expect(root.style.getPropertyValue('--kb-glass-text')).toBe('#f1ecff');
  });

  test('each choice away from its default marks the root, and high contrast puts the high key\'s values on it', () => {
    applyAppearance(document, { theme: 'default', motion: 'system', smoke: 'off', contrast: 'high', textSize: 200 }, themes, glass);
    expect(marks()).toEqual(['off', 'high', '200', 'high']);
    expect(root.style.getPropertyValue('--kb-glass-text')).toBe('#ffffff');
    expect(smokeLevel()).toBe('off');
    expect(textSize()).toBe(200);
    applyAppearance(document, { theme: 'default', motion: 'system', smoke: 'low', textSize: 125 }, themes, glass);
    expect(marks()).toEqual(['low', null, '125', 'standard']);
    expect(root.style.getPropertyValue('--kb-glass-text')).toBe('#f1ecff');
  });

  test('a preference left out or one the engine does not know is its default, so signing out takes every mark off', () => {
    applyAppearance(document, { theme: 'default', motion: 'system', smoke: 'off', contrast: 'high', textSize: 150 }, themes, glass);
    applyAppearance(document, { theme: 'default', motion: 'system', smoke: 'thick' as 'off', textSize: 175 as 150 }, themes, glass);
    expect(marks()).toEqual([null, null, null, 'standard']);
    applyAppearance(document, { theme: 'default', motion: 'system', smoke: 'off', contrast: 'high', textSize: 150 }, themes, glass);
    applyAppearance(document, { theme: 'default', motion: 'system' }, themes, glass);
    expect(marks()).toEqual([null, null, null, 'standard']);
    expect(smokeLevel()).toBe('full');
    expect(textSize()).toBe(100);
  });
});
