/**
 * A session with no account yet: the emailed link landed (Auth itself signed the player in) or a
 * code was entered without a valid invite. It says why, in the server's words, and offers the way
 * on: an invite while the instance asks for one, or the wait while registration is closed. It
 * always offers the way out too: sign out, or use another address ("No player is ever stuck").
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER } from '../data/api.ts';
import { useLocation, useNavigate } from '../router.tsx';
import { useSession, useWhy } from './session.ts';

export function OpenAccount() {
  const { api, settings } = useKayfa();
  const navigate = useNavigate();
  const why = useWhy();
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const closed = settings.registrationMode === 'closed';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const r = await api.openAccount(invite.trim() === '' ? null : invite.trim());
      if (!r.ok) setRefusal(`${r.error}${closed ? '' : '; open the account with another invite'}`);
      /* Opened: the session listener moves every screen on; there is nothing more to do here. */
    } catch {
      setRefusal(LOST_ANSWER);
    } finally {
      setBusy(false);
    }
  };

  const leave = async (then?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.signOut();
      if (then) navigate(then);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="kb-open-account" aria-labelledby="kb-open-account-title" onSubmit={(e) => void submit(e)}>
      <h2 id="kb-open-account-title" className="kb-heading">You are signed in, with no account yet</h2>
      {why && <p className="kb-notice">{why}</p>}
      {closed ? (
        <p>Registration is closed. When an admin opens it, your next sign-in opens your account.</p>
      ) : (
        <>
          <label className="kb-field">
            <span>Invite</span>
            <input className="kb-input" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <p><button type="submit" className="kb-button" data-kb-primary disabled={busy}>Open the account</button></p>
        </>
      )}
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
      <p>
        <button type="button" className="kb-button" disabled={busy} onClick={() => void leave()}>Sign out</button>{' '}
        <button type="button" className="kb-button" disabled={busy} onClick={() => void leave('/sign-in')}>Use another address</button>
      </p>
    </form>
  );
}

/** Shows the open-account path in place of a page while the player is signed in with no account; the sign-in pages are let through. */
export function AccountGate({ children }: { readonly children: ReactNode }) {
  const { api } = useKayfa();
  const session = useSession(api);
  const { path } = useLocation();
  if (session?.signedIn && !session.account && path !== '/sign-in' && path !== '/register') {
    return <div className="kb-account"><OpenAccount /></div>;
  }
  return <>{children}</>;
}
