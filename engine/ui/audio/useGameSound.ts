/**
 * The account's game-sound choice and the way to change it, saved as Settings saves it (`usePreferenceSaves`), for a card's Lens
 * toggle. It lives apart from `sound.ts` because `preferences.ts` imports `sound.ts`, and this imports `preferences.ts`.
 * `set` keeps its identity while the saver's `change` does (it depends on the api, the ui and the account alone).
 *
 * Engine code: it names no card and no instance.
 */
import { useCallback } from 'react';
import { usePreferenceSaves } from '../account/preferences.ts';
import { usePlayer } from '../player.tsx';

export function useGameSound(): { readonly on: boolean; set(on: boolean): void } {
  const { session } = usePlayer();
  const { prefs, change } = usePreferenceSaves(session.account);
  const on = prefs?.gameSound === 'on';
  const set = useCallback((next: boolean) => change({ gameSound: next ? 'on' : 'off' }), [change]);
  return { on, set };
}
