/**
 * The in-page swap's screen body. `Page` provides the context below around its children: the router's
 * resolved key for the current screen, and whether the move to it was the browser's back or forward.
 * (The ScreenBody component itself arrives with the plan's Task 2.)
 */
import { createContext } from 'react';

export interface ScreenKeyValue {
  /** The resolved router key of the current screen (the route's own key, else the path). */
  readonly key: string;
  /** True when the move to this screen was a back or forward. */
  readonly popped: boolean;
}

export const ScreenKeyContext = createContext<ScreenKeyValue>({ key: '', popped: false });
