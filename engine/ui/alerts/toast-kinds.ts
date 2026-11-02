/**
 * Which alert kinds toast (the alerts plan, Task 10; the alerts design, section 8). The engine's defaults, which an instance may override and the
 * player's own choice (Settings › Notifications, Task 11) overrides in turn: on for quotes, cards on yours, traps, rulings, settlements and updates;
 * off for followed threads, hints and season news. A kind that does not toast still counts and still has its row in Alerts.
 *
 * One place decides it: the HUD asks `toastsOn`, and Task 11 changes where `prefs` and `defaults` come from, not who asks.
 */
import type { AlertKind } from '../../rules/alerts.ts';

export type ToastDefaults = Readonly<Record<AlertKind, boolean>>;

export const TOAST_DEFAULTS: ToastDefaults = {
  quote: true, cardOnYours: true, trapStruck: true, trapSprang: true, ruling: true, settlement: true, update: true,
  followed: false, hint: false, seasonNews: false,
};

/** What the player chose to keep on toast: the kinds, or null where they never chose (the instance's defaults then hold). */
export interface ToastPrefs { readonly toasts: readonly AlertKind[] | null }

/** Whether `kind` toasts: the player's choice where they made one, else the instance's defaults. */
export function toastsOn(prefs: ToastPrefs | null, kind: AlertKind, defaults: ToastDefaults = TOAST_DEFAULTS): boolean {
  return prefs?.toasts != null ? prefs.toasts.includes(kind) : defaults[kind];
}

/**
 * The HUD's question "does this kind toast?", as one function. Today it asks the engine's defaults; Task 11 reads the instance's defaults and the
 * account's stored choice here and nowhere else.
 */
export function useToastKinds(): (kind: AlertKind) => boolean {
  return (kind) => toastsOn(null, kind);
}
