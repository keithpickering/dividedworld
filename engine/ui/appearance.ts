/**
 * The theme and motion a player's preferences resolve to, and applying them to the page.
 *
 * The device decides by default: its light or dark (the theme's prefers-color-scheme), its
 * reduced motion. A player overrides either, saved to the account (account_preferences, read
 * through the data layer) so it follows them across devices. The engine marks only an override on
 * <html>, `data-kb-mode` and `data-kb-motion` (Smooth and Snappy are both full motion, and also
 * mark `data-kb-motion-feel`), so a theme's own media query holds otherwise (engine/ui/tokens.css
 * says the shape every theme follows).
 *
 * The glass's three preferences (the web plan's glass amendment to Task 11) are marked the same
 * way, only when they leave their default: `data-kb-smoke-level` (low or off; Smoke.tsx reads it),
 * `data-kb-contrast` (high; contrast.css puts solid ground under the glass's text) and
 * `data-kb-text-size` (125, 150 or 200; base.css sets the root's font size from it, every size on
 * the board and the glass is in rem or a glass size token, which is rem, so all of it follows; and
 * from 150 up useBoard folds the glass to the Phone board's one column). Given the instance's glass,
 * high contrast also puts its `high` key on the root, and anything else its standard key.
 *
 * Brighter effects is not a glass preference but the board's: `data-kb-effects` (bright) tells the
 * shine (engine/ui/shine/band.ts) to leave the readable band, so a card's effects use their full
 * colors (docs/plans/2026-11-08-brighter-effects-design.md).
 */
import { useSyncExternalStore } from 'react';
import { applyGlass } from './glass/apply.ts';
import type { BannerArt, GlassTheme, ThemeOption } from './types.ts';

/** The account's preferences, as account_preferences holds them: "system" follows the device. */
export interface AppearancePreference {
  /** Which theme: "default" (the instance's first theme) or a theme's key. */
  readonly theme: string;
  /** Light, dark or the device's; a theme with one mode fixes it whatever this says. Left out, the device's. */
  readonly mode?: 'system' | 'light' | 'dark';
  readonly motion: 'system' | 'reduce' | 'full' | 'snappy';
  readonly smoke?: 'full' | 'low' | 'off';
  readonly contrast?: 'standard' | 'high';
  readonly textSize?: 100 | 125 | 150 | 200;
  readonly effects?: 'standard' | 'bright';
}

export interface Appearance {
  /** The theme shown: its key, its stylesheet, and the art it tiles across the banner, if any. */
  readonly key: string;
  readonly href: string;
  readonly banner: BannerArt | null;
  /** Light or dark when the player or the theme fixes it; null follows the device. */
  readonly mode: 'light' | 'dark' | null;
  /** Reduced or full when the player overrides the device; null follows it. */
  readonly motion: 'reduce' | 'full' | null;
  /** How fast the animations run: snappy only when the player chose Snappy, smooth otherwise. */
  readonly feel: 'smooth' | 'snappy';
}

/** What a preference resolves to among the instance's themes; the first theme is the house one. */
export function resolveAppearance(pref: AppearancePreference, themes: readonly ThemeOption[]): Appearance {
  const house = themes[0];
  if (!house) throw new Error('an instance offers at least one theme, its house theme');
  /* A preference is a row the server holds; anything but an override it knows follows the device. */
  const motion = pref.motion === 'reduce' ? 'reduce' : pref.motion === 'full' || pref.motion === 'snappy' ? 'full' : null;
  const feel = pref.motion === 'snappy' ? 'snappy' : 'smooth';
  /* The theme is which theme: "default" is the instance's first, and a key it does not offer falls back to it. */
  const chosen = themes.find((t) => t.key === pref.theme && pref.theme !== 'default') ?? house;
  /* A theme with one mode fixes it; otherwise the player's own mode, which stays stored for a theme that holds both. */
  const own = pref.mode === 'light' || pref.mode === 'dark' ? pref.mode : null;
  return { key: chosen.key, href: chosen.href, banner: chosen.banner ?? null, mode: chosen.modes === 'both' ? own : chosen.modes, motion, feel };
}

/** Puts an appearance on the page: one theme link, swapped in place, and the override attributes. */
export function applyAppearance(doc: Document, pref: AppearancePreference, themes: readonly ThemeOption[], glass?: GlassTheme): Appearance {
  const a = resolveAppearance(pref, themes);
  let link = doc.querySelector<HTMLLinkElement>('link#kb-theme');
  if (!link) {
    link = doc.createElement('link');
    link.id = 'kb-theme';
    link.rel = 'stylesheet';
    doc.head.append(link);
  }
  if (link.getAttribute('href') !== a.href) link.setAttribute('href', a.href);
  const root = doc.documentElement;
  /* Which theme is on, for what reads it from the root (the footer's credit for its art, useThemeKey). */
  root.setAttribute('data-kb-theme', a.key);
  applyBannerArt(root, a.banner);
  if (a.mode) root.setAttribute('data-kb-mode', a.mode);
  else root.removeAttribute('data-kb-mode');
  if (a.motion) root.setAttribute('data-kb-motion', a.motion);
  else root.removeAttribute('data-kb-motion');
  /* The feel is marked with the player's Smooth or Snappy; the device's own choice, and Off, leave
     it unmarked. */
  mark(root, 'data-kb-motion-feel', a.motion === 'full' ? a.feel : null);
  /* A preference the engine does not know is its default, as a theme it does not know is the device's. */
  const smoke = pref.smoke === 'low' || pref.smoke === 'off' ? pref.smoke : null;
  const high = pref.contrast === 'high';
  const size = pref.textSize === 125 || pref.textSize === 150 || pref.textSize === 200 ? pref.textSize : null;
  mark(root, 'data-kb-smoke-level', smoke);
  mark(root, 'data-kb-contrast', high ? 'high' : null);
  effectsPref.set(root, pref.effects === 'bright' ? 'bright' : null);
  markEffects(root);
  mark(root, 'data-kb-text-size', size === null ? null : String(size));
  if (glass) applyGlass(root, glass, high ? 'high' : 'standard');
  return a;
}

/**
 * The theme's banner art, as custom properties on the root that frame.css paints (`.kb-banner`): set through the CSSOM, which the
 * page's style-src allows, and taken off when the theme has none. The addresses are the instance's own files (BannerArt).
 */
const BANNER_PROPS = ['--kb-banner-art-moving', '--kb-banner-art-still', '--kb-banner-art-height', '--kb-banner-art-clear'] as const;
function applyBannerArt(root: HTMLElement, art: BannerArt | null): void {
  if (!art) { for (const p of BANNER_PROPS) root.style.removeProperty(p); return; }
  root.style.setProperty('--kb-banner-art-moving', `url(${JSON.stringify(art.moving)})`);
  root.style.setProperty('--kb-banner-art-still', `url(${JSON.stringify(art.still)})`);
  root.style.setProperty('--kb-banner-art-height', `${art.height}px`);
  root.style.setProperty('--kb-banner-art-clear', `${art.clear}px`);
}

/** The key of the theme on the page, as the root is marked now, or null before one is applied. */
export function themeKey(doc: Document = document): string | null {
  return doc.documentElement.getAttribute('data-kb-theme');
}

/*
 * The effects mark has two sources: what the last `applyAppearance` asked for (the account's), and the stages held over it. Each is
 * kept per root, so a second document has its own.
 */
const effectsPref = new WeakMap<HTMLElement, 'bright' | null>();
const effectsStages = new WeakMap<HTMLElement, { readonly value: 'bright' | null }[]>();
function markEffects(root: HTMLElement): void {
  const top = effectsStages.get(root)?.at(-1);
  mark(root, 'data-kb-effects', top ? top.value : (effectsPref.get(root) ?? null));
}

/**
 * The front door's effects, held over the account's: it stages `bright` (the first page's effects use their full colors) and calls the
 * release it gets when it unmounts. It is a layer, not a write, because a sign-in applies the account's preference while the door is
 * still mounted, and the door's unmount must not undo it: the release only takes the stage away, and the root goes to what the last
 * `applyAppearance` asked for, bright or none. The newest stage held wins, a release removes only its own, and a second call of it does
 * nothing, so a StrictMode double effect leaks and over-releases nothing.
 */
export function stageEffects(value: 'standard' | 'bright', doc: Document = document): () => void {
  const root = doc.documentElement;
  const mine = { value: value === 'bright' ? 'bright' as const : null };
  const stack = effectsStages.get(root) ?? [];
  effectsStages.set(root, stack);
  stack.push(mine);
  markEffects(root);
  return () => {
    const i = stack.indexOf(mine);
    if (i < 0) return;
    stack.splice(i, 1);
    markEffects(root);
  };
}

function mark(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

/** The smoke the player chose, as the root is marked now. */
export function smokeLevel(doc: Document = document): 'full' | 'low' | 'off' {
  const v = doc.documentElement.getAttribute('data-kb-smoke-level');
  return v === 'low' || v === 'off' ? v : 'full';
}

/** The text size the player chose, in percent, as the root is marked now. */
export function textSize(doc: Document = document): 100 | 125 | 150 | 200 {
  const v = Number(doc.documentElement.getAttribute('data-kb-text-size'));
  return v === 125 || v === 150 || v === 200 ? v : 100;
}

/*
 * A mark on the root as a component reads it, again whenever it changes: the root is where the
 * preferences are applied (by the app once they are read, by Settings the moment one is chosen), so
 * a component reads them there rather than being handed them.
 */
function subscribeRoot(onChange: () => void): () => void {
  if (typeof MutationObserver !== 'function') return () => {};
  const watch = new MutationObserver(onChange);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-smoke-level', 'data-kb-text-size', 'data-kb-motion', 'data-kb-motion-feel', 'data-kb-theme'] });
  return () => watch.disconnect();
}

/** The smoke level on the root, kept current. */
export function useSmokeLevel(): 'full' | 'low' | 'off' {
  return useSyncExternalStore(subscribeRoot, () => smokeLevel(), () => 'full');
}

/** The key of the theme on the root, kept current. */
export function useThemeKey(): string | null {
  return useSyncExternalStore(subscribeRoot, () => themeKey(), () => null);
}

/** The text size on the root, kept current. */
export function useTextSize(): 100 | 125 | 150 | 200 {
  return useSyncExternalStore(subscribeRoot, () => textSize(), () => 100);
}

/** Whether motion is reduced, kept current: the player's override on the root as it changes, and the device's setting as it does. */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribeMotion, () => motionReduced(), () => false);
}
export function subscribeMotion(onChange: () => void): () => void {
  const off = subscribeRoot(onChange);
  const query = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined;
  query?.addEventListener?.('change', onChange);
  return () => { off(); query?.removeEventListener?.('change', onChange); };
}

/** Whether motion is reduced now: the player's override, else the device's setting. */
export function motionReduced(doc: Document = document): boolean {
  const o = doc.documentElement.getAttribute('data-kb-motion');
  if (o === 'reduce') return true;
  if (o === 'full') return false;
  return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
