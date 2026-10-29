/** The session as this screen needs it: null until it is known, then whether signed in and whether an account is open. */
import { useEffect, useState } from 'react';
import type { KayfaApi, Session } from '../data/api.ts';

export function useSession(api: KayfaApi): Session | null {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    let live = true;
    void api.session().then((s) => { if (live) setSession(s); }, () => { if (live) setSession({ signedIn: false, account: null }); });
    const off = api.onSession((s) => setSession(s));
    return () => { live = false; off(); };
  }, [api]);
  return session;
}
export function clearWhy(): void { /* stub */ }
