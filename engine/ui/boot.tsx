/**
 * What the first load read once for the frame and the HUD (the forum-load design, section 3): the app asks `boot()` and
 * hands the answer to `BootProvider`, and the banner's boards, the HUD's face and next settlement, the tips' preferences and the
 * settlement and welcome checks take theirs from `useBoot()` instead of reading each for themselves.
 *
 * Boot is one account's. The app hands `BootProvider` boot only while the player's session is the account it was read for, and null
 * otherwise (a visitor, a sign-in or a switch on this page that boot has not been read again for): a caller then makes the read it always
 * made, so the previous account's boards, face or preferences are never drawn for the next. With no provider (a story, a test of one
 * component) `useBoot()` is null and every caller reads for itself.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Boot } from './data/api.ts';

const BootContext = createContext<Boot | null>(null);

export function BootProvider({ boot, children }: { readonly boot: Boot | null; readonly children: ReactNode }) {
  return <BootContext.Provider value={boot}>{children}</BootContext.Provider>;
}

/** Boot, when it was read for the account signed in now; else null. */
export function useBoot(): Boot | null {
  return useContext(BootContext);
}
