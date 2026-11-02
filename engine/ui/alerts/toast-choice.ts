/**
 * The player's choice of which alert kinds toast, announced to the HUD (the alerts plan, Task 11). Settings saves the choice to the account; the
 * HUD read it when it mounted, so a change shows in the HUD with no reload by this one window event, sent once the account has answered.
 * `null` is the choice put back to the instance's defaults.
 */
import type { AlertKind } from '../../rules/alerts.ts';

const EVENT = 'kb-toast-choice';

export type ToastChoice = readonly AlertKind[] | null;

export function announceToastChoice(kinds: ToastChoice): void {
  window.dispatchEvent(new CustomEvent<ToastChoice>(EVENT, { detail: kinds }));
}

/** Hears every announcement until the returned function is called. */
export function onToastChoice(listener: (kinds: ToastChoice) => void): () => void {
  const hear = (e: Event) => listener((e as CustomEvent<ToastChoice>).detail);
  window.addEventListener(EVENT, hear);
  return () => window.removeEventListener(EVENT, hear);
}
