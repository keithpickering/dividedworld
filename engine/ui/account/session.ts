/** The session as this screen needs it: null until it is known, then whether signed in and whether an account is open. */
import { useEffect, useSyncExternalStore } from 'react';
import type { Session } from '../data/api.ts';
import { usePlayer } from '../player.tsx';

/*
 * Why the account did not open (the server's words after a code), kept where it outlives the
 * sign-in screen: the session changing mounts the gate's open-account form and unmounts that screen.
 */
let why: string | null = null;
const listeners = new Set<() => void>();
export function setWhy(next: string | null): void {
  why = next;
  for (const l of [...listeners]) l();
}
export const clearWhy = (): void => setWhy(null);
export function useWhy(): string | null {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => why);
}

/**
 * The session as the player's provider holds it (engine/ui/player.tsx), which the first load read: null until it is known, so the screens that
 * ask are drawn from it on their first frame and read nothing of their own. A reason is cleared as it always was: when the session has no
 * sign-in, or has an account (it belongs to a sign-in with no account to open).
 */
export function useSession(): Session | null {
  const { session, sessionKnown } = usePlayer();
  useEffect(() => {
    if (sessionKnown && (!session.signedIn || session.account)) clearWhy();
  }, [sessionKnown, session.signedIn, session.account]);
  return sessionKnown ? session : null;
}
