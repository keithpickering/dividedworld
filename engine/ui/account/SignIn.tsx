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
import { LOST_ANSWER } from '../data/api.ts';
import { Link, useLocation, useNavigate } from '../router.tsx';
import { safeNext } from './next.ts';
import { OpenAccount } from './OpenAccount.tsx';
import { setWhy, useSession } from './session.ts';
import './account.css';

type Sent = { readonly message: string; readonly invite?: string };
type Field = 'email' | 'invite' | 'ack' | 'code';
type Refusal = { readonly text: string; readonly field: Field | null };

const NO_ANSWER = 'No answer came back; ask again in a moment.';

export function SignInScreen({ mode }: { readonly mode: 'sign-in' | 'register' }) {
  const { api, settings } = useKayfa();
  const session = useSession(api);
  const { query } = useLocation();
  const navigate = useNavigate();
  const registering = mode === 'register';
  const asksInvite = registering && settings.registrationMode === 'invite';
  const closed = settings.registrationMode === 'closed';
  const next = safeNext(query.get('next'));
  const toOther = (path: string) => (query.get('next') ? `${path}?next=${encodeURIComponent(next)}` : path);
  const errId = 'kb-sign-in-error';

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [invite, setInvite] = useState(query.get('invite') ?? '');
  const [ack, setAck] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'sending' | 'checking' | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [asked, setAsked] = useState(0);
  const codeField = useRef<HTMLInputElement>(null);

  useEffect(() => { if (session?.account) navigate(next, { replace: true }); }, [session?.account, navigate, next]);
  useEffect(() => { if (step === 'code') codeField.current?.focus(); }, [step]);

  if (session === null) return <div className="kb-account" aria-busy="true" />;
  if (session.signedIn && !session.account) return <div className="kb-account"><h1 className="kb-heading">{registering ? 'Register' : 'Sign in'}</h1><OpenAccount /></div>;

  const ask = async (e?: FormEvent, again = false) => {
    e?.preventDefault();
    if (busy) return;
    if (registering && !ack) { setRefusal({ text: 'Check the box to say you are 18 or older; then ask for a code.', field: 'ack' }); return; }
    setBusy('sending');
    setRefusal(null);
    try {
      const r = await api.requestCode(email.trim(), registering && invite.trim() !== '' ? invite.trim() : null);
      if (!r.ok) { setRefusal({ text: `${r.field === 'email' ? 'The address ' : ''}${r.error}`, field: r.field === 'email' || r.field === 'invite' ? r.field : null }); return; }
      setSent(r.value);
      setCode('');
      if (again) setAsked((n) => n + 1);
      setStep('code');
    } catch {
      setRefusal({ text: NO_ANSWER, field: null });
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy('checking');
    setRefusal(null);
    try {
      const r = await api.verifyCode(email.trim(), code);
      if (!r.ok) {
        setRefusal({ text: r.error, field: 'code' });
        /* The wrong digits are selected, so the next try replaces them. */
        codeField.current?.focus();
        codeField.current?.select();
        return;
      }
      /* An open account moves this screen on through the session; one that is not open shows the way on, with its reason. */
      if (!r.value.account) setWhy(r.value.why ?? null);
    } catch {
      setRefusal({ text: LOST_ANSWER, field: null });
    } finally {
      setBusy(null);
    }
  };

  const tie = (field: Field, extra?: string) => {
    const ids = [extra, refusal?.field === field ? errId : undefined].filter(Boolean).join(' ');
    return { 'aria-invalid': refusal?.field === field ? true : undefined, 'aria-describedby': ids || undefined };
  };
  const alert = refusal && <p role="alert" id={errId} className="kb-notice" data-kb-tone="refusal">{refusal.text}</p>;

  return (
    <div className="kb-account kb-sign-in">
      <h1 className="kb-heading">{registering ? 'Register' : 'Sign in'}</h1>
      {registering && closed && (
        <p className="kb-notice">Registration is closed. When an admin opens it, your next sign-in opens your account. If you already have an account, <Link to={toOther('/sign-in')}>sign in</Link>.</p>
      )}
      {step === 'email' ? (
        <form aria-label={registering ? 'Register' : 'Sign in'} aria-busy={busy === 'sending'} onSubmit={(e) => void ask(e)} noValidate>
          <p className="kb-muted">There is no password. An email brings a code and a link to sign in; {registering ? 'registering and signing in are the same steps' : <>a new player registers first (<Link to={toOther('/register')}>Register</Link>), or gives an invite after the code</>}.</p>
          <label className="kb-field">
            <span>Email address</span>
            <input className="kb-input" type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} {...tie('email')} />
          </label>
          {asksInvite && (
            <label className="kb-field">
              <span>Invite</span>
              <input className="kb-input" name="invite" autoComplete="off" spellCheck={false} value={invite} onChange={(e) => setInvite(e.target.value)} {...tie('invite', 'kb-invite-help')} />
            </label>
          )}
          {asksInvite && <p id="kb-invite-help" className="kb-muted kb-small">This instance is invite-only for now. A player gives you a link; its code is filled in for you.</p>}
          {registering && (
            <label className="kb-field kb-ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} {...tie('ack')} /> I am 18 or older. This is an acknowledgement, nothing legally binding.
            </label>
          )}
          {alert}
          <p><button type="submit" className="kb-button" data-kb-primary disabled={busy !== null}>Send a code</button></p>
          <p role="status" className="kb-small kb-muted">{busy === 'sending' ? 'Sending…' : ''}</p>
          <p className="kb-small">{registering ? <>Already playing? <Link to={toOther('/sign-in')}>Sign in</Link>.</> : <>New here? <Link to={toOther('/register')}>Register</Link>.</>}</p>
        </form>
      ) : (
        <form aria-label="Enter the code" aria-busy={busy !== null} onSubmit={(e) => void verify(e)} noValidate>
          <p className="kb-notice">{sent?.message}</p>
          {sent?.invite && <p className="kb-notice">{sent.invite}</p>}
          <label className="kb-field">
            <span>Code from the email</span>
            <input ref={codeField} className="kb-input kb-mono" name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} {...tie('code')} />
          </label>
          {alert}
          <p>
            <button type="submit" className="kb-button" data-kb-primary disabled={busy !== null}>Sign in</button>{' '}
            <button type="button" className="kb-button" disabled={busy !== null} onClick={() => void ask(undefined, true)}>Send a new code</button>{' '}
            <button type="button" className="kb-button" onClick={() => { setStep('email'); setRefusal(null); }}>Use another address</button>
          </p>
          <p role="status" className="kb-small kb-muted">
            {busy === 'sending' ? 'Sending…' : busy === 'checking' ? 'Checking the code…' : asked > 0 ? <span key={asked}>Another code was asked for.</span> : ''}
          </p>
        </form>
      )}
    </div>
  );
}
