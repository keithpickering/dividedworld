/**
 * The theme and motion a player's preferences resolve to, and applying them to the page.
 *
 * The device decides by default: its light or dark (the theme's prefers-color-scheme), its
 * reduced motion. A player overrides either, saved to the account (account_preferences, read
 * through the data layer) so it follows them across devices. The engine marks only an override on
 * <html>, `data-kb-mode` and `data-kb-motion`, so a theme's own media query holds otherwise
 * (engine/ui/tokens.css says the shape every theme follows).
 */
import type { ThemeOption } from './types.ts';

/** The account's preferences, as account_preferences holds them: "system" follows the device. */
export interface AppearancePreference {
  /** "system", "light", "dark", or an instance theme's key. */
  readonly theme: string;
  readonly motion: 'system' | 'reduce' | 'full';
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
  const motion = pref.motion === 'system' ? null : pref.motion;
  if (pref.theme === 'light' || pref.theme === 'dark') return { href: house.href, mode: pref.theme, motion };
  const chosen = themes.find((t) => t.key === pref.theme && pref.theme !== 'system') ?? house;
  return { href: chosen.href, mode: chosen.modes === 'both' ? null : chosen.modes, motion };
}

/** Puts an appearance on the page: one theme link, swapped in place, and the override attributes. */
export function applyAppearance(doc: Document, pref: AppearancePreference, themes: readonly ThemeOption[]): Appearance {
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
  return a;
}

/** Whether motion is reduced now: the player's override, else the device's setting. */
export function motionReduced(doc: Document = document): boolean {
  const o = doc.documentElement.getAttribute('data-kb-motion');
  if (o === 'reduce') return true;
  if (o === 'full') return false;
  return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
