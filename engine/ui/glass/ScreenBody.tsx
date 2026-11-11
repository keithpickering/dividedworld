/**
 * What a glass screen's changing part needs to know about the screen it sits in. A screen is a path
 * (Page.tsx): a change of the router's key within one path leaves the screen mounted, and the part
 * that changed is the screen's body, which swaps on its own. The body is keyed by the router's key
 * and moves by whether the player went back or forward, so Page, which resolves both, publishes
 * them here instead of each screen asking the router again and possibly disagreeing about which
 * key is the current one.
 */
import { createContext, useContext } from 'react';

export interface ScreenKey {
  /** The router's resolved key for the current screen: the key a body is keyed by. */
  readonly key: string;
  /** True when the move to this key was the browser's back or forward, which keep their own scroll. */
  readonly popped: boolean;
}

export const ScreenKeyContext = createContext<ScreenKey>({ key: '', popped: false });

/** The current screen's key and whether it was reached by back or forward. */
export function useScreenKey(): ScreenKey {
  return useContext(ScreenKeyContext);
}
