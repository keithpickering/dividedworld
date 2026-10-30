/** The session as this screen needs it: null until it is known, then whether signed in and whether an account is open. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { KayfaApi, Session } from '../data/api.ts';

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

export function useSession(api: KayfaApi): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let live = true;
    /* A reason belongs to a session with no account; any other session has none to give. */
    const take = (s: Session) => { if (!s.signedIn || s.account) clearWhy(); if (live) setSession(s); };
    void api.session().then(take, () => take({ signedIn: false, account: null }));
    const off = api.onSession(take);
    return () => { live = false; off(); };
  }, [api]);
  return session;
}
