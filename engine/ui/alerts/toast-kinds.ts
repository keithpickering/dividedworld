/**
 * Which alert kinds toast (the alerts plan, Task 10; the alerts design, section 8). The engine's defaults, which an instance may override and the
 * player's own choice (Settings › Notifications, Task 11) overrides in turn: on for quotes, words put in a character's mouth, cards on yours, traps, rulings, settlements and updates;
 * off for followed threads, hints and season news. A kind that does not toast still counts and still has its row in Alerts.
 *
 * One place decides it: the HUD asks `toastsOn` through `useToastKinds`, which reads where `prefs` and `defaults` come from.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ALERT_KINDS, type AlertKind } from '../../rules/alerts.ts';
import { useBoot } from '../boot.tsx';
import { useKayfa } from '../context.tsx';
import { onToastChoice } from './toast-choice.ts';

export type ToastDefaults = Readonly<Record<AlertKind, boolean>>;

export const TOAST_DEFAULTS: ToastDefaults = {
  quote: true, framed: true, cardOnYours: true, cardEnded: true, trapStruck: true, trapSprang: true, ruling: true, settlement: true, update: true,
  followed: false, hint: false, seasonNews: false,
};

/** The kinds that toast until a player chooses: the instance's `toastDefaults` (screen settings) where it gives them, else the engine's. */
export function toastDefaultKinds(given: readonly AlertKind[] | undefined): readonly AlertKind[] {
  return Array.isArray(given) ? given : ALERT_KINDS.filter((k) => TOAST_DEFAULTS[k]);
}

/** What the player chose to keep on toast: the kinds, or null where they never chose (the instance's defaults then hold). */
export interface ToastPrefs { readonly toasts: readonly AlertKind[] | null }

/** Whether `kind` toasts: the player's choice where they made one, else the instance's defaults. */
export function toastsOn(prefs: ToastPrefs | null, kind: AlertKind, defaults: ToastDefaults = TOAST_DEFAULTS): boolean {
  return prefs?.toasts != null ? prefs.toasts.includes(kind) : defaults[kind];
}

/**
 * The HUD's question "does this kind toast?", as one function: the account's stored choice where there is one, else the instance's
 * `toastDefaults` (screen settings), else the engine's. The choice is read once when the HUD mounts, and a change made in Settings is heard
 * as it is saved (toast-choice.ts); until the read answers, or where it cannot, the defaults hold.
 */
export function useToastKinds(): (kind: AlertKind) => boolean {
  const { api, settings } = useKayfa();
  /* Boot's preferences are the account's for this page (the first load read them once); without boot the HUD reads them as before. */
  const boot = useBoot();
  const [chosen, setChosen] = useState<ToastPrefs['toasts']>(boot?.preferences.toasts ?? null);
  useEffect(() => {
    let live = true;
    let heard = false;
    const off = onToastChoice((kinds) => { heard = true; if (live) setChosen(kinds); });
    if (boot) setChosen((c) => (heard ? c : boot.preferences.toasts ?? null));
    else Promise.resolve().then(() => api.preferences()).then((p) => { if (live && !heard) setChosen(p.toasts ?? null); }, () => {});
    return () => { live = false; off(); };
  }, [api, boot]);
  const given = settings.toastDefaults;
  const defaults = useMemo<ToastDefaults>(() => {
    const kinds = toastDefaultKinds(given);
    return Object.fromEntries(ALERT_KINDS.map((k) => [k, kinds.includes(k)])) as ToastDefaults;
  }, [given]);
  return useCallback((kind) => toastsOn({ toasts: chosen }, kind, defaults), [chosen, defaults]);
}
