/**
 * The theme and motion a player's preferences resolve to, and applying them to the page.
 *
 * The device decides by default: its light or dark (the theme's prefers-color-scheme), its
 * reduced motion. A player overrides either, saved to the account (account_preferences, read
 * through the data layer) so it follows them across devices. The engine marks only an override on
 * <html>, `data-kb-mode` and `data-kb-motion`, so a theme's own media query holds otherwise
 * (engine/ui/tokens.css says the shape every theme follows).
 *
 * The glass's three preferences (the web plan's glass amendment to Task 11) are marked the same
 * way, only when they leave their default: `data-kb-smoke` (low or off; Smoke.tsx reads it),
 * `data-kb-contrast` (high; contrast.css puts solid ground under the glass's text) and
 * `data-kb-text-size` (125, 150 or 200; base.css sets the root's font size from it, every size on
 * the board and the glass is in rem or a glass size token, which is rem, so all of it follows; and
 * past 150 useBoard folds the glass to the Phone board's one column). Given the instance's glass,
 * high contrast also puts its `high` key on the root, and anything else its standard key.
 */
import { useSyncExternalStore } from 'react';
import { applyGlass } from './glass/apply.ts';
import type { GlassTheme, ThemeOption } from './types.ts';

/** The account's preferences, as account_preferences holds them: "system" follows the device. */
export interface AppearancePreference {
  /** "system", "light", "dark", or an instance theme's key. */
  readonly theme: string;
  readonly motion: 'system' | 'reduce' | 'full';
  readonly smoke?: 'full' | 'low' | 'off';
  readonly contrast?: 'standard' | 'high';
  readonly textSize?: 100 | 125 | 150 | 200;
}

export interface Appearance {
  readonly href: string;
  /** Light or dark when the player or the theme fixes it; null follows the device. */
  readonly mode: 'light' | 'dark' | null;
  /** Reduced or full when the player overrides the device; null follows it. */
  readonly motion: 'reduce' | 'full' | null;
}

/** What a preference resolves to among the instance's themes; the first theme is the house one. */
export function resolveAppearance(pref: AppearancePreference, themes: readonly ThemeOption[]): Appearance {
  const house = themes[0];
  if (!house) throw new Error('an instance offers at least one theme, its house theme');
  /* A preference is a row the server holds; anything but an override it knows follows the device. */
  const motion = pref.motion === 'reduce' || pref.motion === 'full' ? pref.motion : null;
  /* "light" and "dark" are the house theme in that mode; a house theme holds both (InstanceUi.themes). */
  if (pref.theme === 'light' || pref.theme === 'dark') return { href: house.href, mode: pref.theme, motion };
  const chosen = themes.find((t) => t.key === pref.theme && pref.theme !== 'system') ?? house;
  return { href: chosen.href, mode: chosen.modes === 'both' ? null : chosen.modes, motion };
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
  if (a.mode) root.setAttribute('data-kb-mode', a.mode);
  else root.removeAttribute('data-kb-mode');
  if (a.motion) root.setAttribute('data-kb-motion', a.motion);
  else root.removeAttribute('data-kb-motion');
  /* A preference the engine does not know is its default, as a theme it does not know is the device's. */
  const smoke = pref.smoke === 'low' || pref.smoke === 'off' ? pref.smoke : null;
  const high = pref.contrast === 'high';
  const size = pref.textSize === 125 || pref.textSize === 150 || pref.textSize === 200 ? pref.textSize : null;
  mark(root, 'data-kb-smoke', smoke);
  mark(root, 'data-kb-contrast', high ? 'high' : null);
  mark(root, 'data-kb-text-size', size === null ? null : String(size));
  if (glass) applyGlass(root, glass, high ? 'high' : 'standard');
  return a;
}

function mark(root: HTMLElement, name: string, value: string | null): void {
  if (value === null) root.removeAttribute(name);
  else root.setAttribute(name, value);
}

/** The smoke the player chose, as the root is marked now. */
export function smokeLevel(doc: Document = document): 'full' | 'low' | 'off' {
  const v = doc.documentElement.getAttribute('data-kb-smoke');
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
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kb-smoke', 'data-kb-text-size'] });
  return () => watch.disconnect();
}

/** The smoke level on the root, kept current. */
export function useSmokeLevel(): 'full' | 'low' | 'off' {
  return useSyncExternalStore(subscribeRoot, () => smokeLevel(), () => 'full');
}

/** The text size on the root, kept current. */
export function useTextSize(): 100 | 125 | 150 | 200 {
  return useSyncExternalStore(subscribeRoot, () => textSize(), () => 100);
}

/** Whether motion is reduced now: the player's override, else the device's setting. */
export function motionReduced(doc: Document = document): boolean {
  const o = doc.documentElement.getAttribute('data-kb-motion');
  if (o === 'reduce') return true;
  if (o === 'full') return false;
  return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
