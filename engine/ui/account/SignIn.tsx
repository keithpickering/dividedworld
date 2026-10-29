/**
 * Sign in and Register: one passwordless flow. An address is asked for a code (and a link) by
 * email; the code is then entered. The account function creates the login when a valid invite is
 * given and opens nothing otherwise, so the two screens differ only in what they ask for (an
 * invite while the instance is invite-only, and the 18+ acknowledgement on registration).
 *
 * Every word about the address is the server's and is the same for every address: this screen
 * never says whether an address has an account, shows no different step, and adds no delay of
 * its own ("A response never proves a private fact").
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { OpenAccount } from './OpenAccount.tsx';
import { useSession } from './session.ts';
import './account.css';

type Sent = { readonly message: string; readonly invite?: string };

export function SignInScreen({ mode }: { readonly mode: 'sign-in' | 'register' }) {
  const { api, settings } = useKayfa();
  const session = useSession(api);
  const { query } = useLocation();
  const navigate = useNavigate();
  const registering = mode === 'register';
  const asksInvite = registering && settings.registrationMode === 'invite';
  const closed = settings.registrationMode === 'closed';

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState(query.get('invite') ?? '');
  const [ack, setAck] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const codeField = useRef<HTMLInputElement>(null);

  useEffect(() => { if (session?.account) navigate('/', { replace: true }); }, [session?.account, navigate]);
  useEffect(() => { if (step === 'code') codeField.current?.focus(); }, [step]);

  if (session === null) return <div className="kb-account" aria-busy="true" />;
  if (session.signedIn && !session.account) return <div className="kb-account"><h1 className="kb-heading">{registering ? 'Register' : 'Sign in'}</h1><OpenAccount why={why ?? undefined} /></div>;

  const ask = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (registering && !ack) { setRefusal('Check the box to say you are 18 or older; then ask for a code.'); return; }
    setBusy(true);
    setRefusal(null);
    const r = await api.requestCode(email.trim(), registering && invite.trim() !== '' ? invite.trim() : null);
    setBusy(false);
    if (!r.ok) { setRefusal(`${r.field === 'email' ? 'The address ' : ''}${r.error}`); return; }
    setSent(r.value);
    setCode('');
    setStep('code');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    const r = await api.verifyCode(email.trim(), code);
    setBusy(false);
    if (!r.ok) { setRefusal(r.error); return; }
    if (!r.value.account) setWhy(r.value.why ?? null);
    /* An open account moves this screen on through the session; one that is not open shows the way on. */
  };

  return (
    <div className="kb-account kb-sign-in">
      <h1 className="kb-heading">{registering ? 'Register' : 'Sign in'}</h1>
      {registering && closed && (
        <p className="kb-notice">Registration is closed. When an admin opens it, your next sign-in opens your account. If you already have an account, <Link to="/sign-in">sign in</Link>.</p>
      )}
      {step === 'email' ? (
        <form aria-label={registering ? 'Register' : 'Sign in'} onSubmit={(e) => void ask(e)} noValidate>
          <p className="kb-muted">There is no password. An email brings a code and a link to sign in; {registering ? 'registering and signing in are the same steps' : <>a new player registers first (<Link to="/register">Register</Link>), or gives an invite after the code</>}.</p>
          <label className="kb-field">
            <span>Email address</span>
            <input className="kb-input" type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {asksInvite && (
            <label className="kb-field">
              <span>Invite</span>
              <input className="kb-input" name="invite" autoComplete="off" spellCheck={false} value={invite} onChange={(e) => setInvite(e.target.value)} aria-describedby="kb-invite-help" />
            </label>
          )}
          {asksInvite && <p id="kb-invite-help" className="kb-muted kb-small">This instance is invite-only for now. A player gives you a link; its code is filled in for you.</p>}
          {registering && (
            <label className="kb-field kb-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I am 18 or older. This is an acknowledgement, nothing legally binding.
            </label>
          )}
          {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
          <p><button type="submit" className="kb-button" data-kb-primary disabled={busy}>Send a code</button></p>
          <p className="kb-small">{registering ? <>Already playing? <Link to="/sign-in">Sign in</Link>.</> : <>New here? <Link to="/register">Register</Link>.</>}</p>
        </form>
      ) : (
        <form aria-label="Enter the code" onSubmit={(e) => void verify(e)} noValidate>
          <p role="status" className="kb-notice">{sent?.message}</p>
          {sent?.invite && <p className="kb-notice">{sent.invite}</p>}
          <label className="kb-field">
            <span>Code from the email</span>
            <input ref={codeField} className="kb-input kb-mono" name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
          <p>
            <button type="submit" className="kb-button" data-kb-primary disabled={busy}>Sign in</button>{' '}
            <button type="button" className="kb-button" disabled={busy} onClick={() => void ask()}>Send a new code</button>{' '}
            <button type="button" className="kb-button" onClick={() => { setStep('email'); setRefusal(null); }}>Use another address</button>
          </p>
        </form>
      )}
    </div>
  );
}
