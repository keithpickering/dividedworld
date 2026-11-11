/**
 * Sign in and Register: one passwordless flow. An address is asked for a code (and a link) by
 * email; the code is then entered. The account function creates the login when a valid invite is
 * given and opens nothing otherwise, so the two screens differ only in what they ask for (an
 * invite while the instance is invite-only, and the 18+ acknowledgement on registration).
 *
 * On the glass, in the Settings board's parts (the glass plan, section 8): its heading, its fields and its
 * buttons; signed out the menu bar holds Back to the board alone. The form stands in a 680px column and the
 * other ways in in an aside to its right (the backfill design, section 2; boards 14 and 15): on Sign in "New
 * here?" with Register, on Register "Already playing?" with Sign in, and on both "Stuck?" with Reach a person.
 * On the phone the aside stacks under the form.
 *
 * Every word about the address is the server's and is the same for every address: this screen
 * never says whether an address has an account, shows no different step, and adds no delay of
 * its own ("A response never proves a private fact").
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { ReachAPerson } from '../contact/Contact.tsx';
import { useLocation, useNavigate } from '../router.tsx';
import { safeNext } from './next.ts';
import { OpenAccount } from './OpenAccount.tsx';
import { setWhy, useSession } from './session.ts';
import './account.css';
import { CalmRegion } from '../glass/Calm.tsx';

type Sent = { readonly message: string; readonly invite?: string };
type Field = 'email' | 'invite' | 'ack' | 'code';
type Refusal = { readonly text: string; readonly field: Field | null };

const NO_ANSWER = 'No answer came back; ask again in a moment.';

export function SignInScreen({ mode }: { readonly mode: 'sign-in' | 'register' }) {
  const { api, settings } = useKayfa();
  const session = useSession();
  const { query } = useLocation();
  const navigate = useNavigate();
  const registering = mode === 'register';
  const asksInvite = registering && settings.registrationMode === 'invite';
  const closed = settings.registrationMode === 'closed';
  /* The "New here?" words say how registration works in this instance's mode. */
  const howToRegister = settings.registrationMode === 'open'
    ? 'Anyone can register. The same email code signs you in after.'
    : closed
      ? 'Registration is closed right now. You can still leave your email; when an admin opens registration, your next sign-in opens your account.'
      : 'Registering takes an invite from someone who plays. The same email code signs you in after.';
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

  const title = <PageHead title={registering ? 'Register' : 'Sign in'} />;
  if (session === null) return <div className="kb-acct" aria-busy="true" />;
  if (session.signedIn && !session.account) return <div className="kb-acct">{title}<CalmRegion className="kb-acct-panel"><OpenAccount /></CalmRegion></div>;

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
  const alert = refusal && <p role="alert" id={errId} className="kb-acct-refusal">{refusal.text}</p>;
  /* The other ways in: the other screen with why, and a person for the player who cannot get a code. */
  const aside = (
    <CalmRegion as="aside" aria-label="Other ways in" className="kb-door-aside">
      <section aria-labelledby="kb-door-other">
        <h2 id="kb-door-other" className="kb-door-heading">{registering ? 'Already playing?' : 'New here?'}</h2>
        <p className="kb-door-text">{registering ? 'Sign in with the email you registered.' : howToRegister}</p>
        <GlassButton to={toOther(registering ? '/sign-in' : '/register')}>{registering ? 'Sign in' : 'Register'}</GlassButton>
      </section>
      <section aria-labelledby="kb-door-stuck">
        <h2 id="kb-door-stuck" className="kb-door-heading">Stuck?</h2>
        <p className="kb-door-text">No code arrived, or the link has expired. The admins can help.</p>
        <ReachAPerson />
      </section>
    </CalmRegion>
  );

  return (
    <div className="kb-acct kb-sign-in">
      {title}
      <div className="kb-door">
        <CalmRegion className="kb-door-form">
        {registering && closed && (
          <p className="kb-acct-notice">Registration is closed. When an admin opens it, your next sign-in opens your account.</p>
        )}
        {step === 'email' ? (
          <form aria-label={registering ? 'Register' : 'Sign in'} aria-busy={busy === 'sending'} onSubmit={(e) => void ask(e)} noValidate>
            <p className="kb-acct-lead">{registering
              ? (closed ? 'No password. We email you a code and a link. Registration is closed, so your account opens once an admin opens it.' : 'No password. We email you a code and a link; either one makes your account.')
              : 'No password. We email you a code and a link; either one signs you in.'}</p>
            <label className="kb-acct-row kb-acct-field">
              <span className="kb-acct-row-label">Email address</span>
              <input className="kb-acct-input" type="email" name="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} {...tie('email')} />
            </label>
            {asksInvite && (
              <label className="kb-acct-row kb-acct-field">
                <span className="kb-acct-row-label">Invite</span>
                <input className="kb-acct-input kb-door-invite" name="invite" autoComplete="off" spellCheck={false} value={invite} onChange={(e) => setInvite(e.target.value)} {...tie('invite', 'kb-invite-help')} />
              </label>
            )}
            {asksInvite && (
              <p id="kb-invite-help" className="kb-acct-row-sentence">
                {query.get('invite') ? 'Registration is by invite for now. Your invite link filled this in.' : 'Registration is by invite for now. A player gives you a link; its code is filled in for you.'}
              </p>
            )}
            {registering && (
              <>
                <label className="kb-acct-ack">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} {...tie('ack', 'kb-ack-note')} /> I am 18 or older.
                </label>
                <p id="kb-ack-note" className="kb-acct-row-sentence kb-door-ack-note">An acknowledgement, nothing legally binding.</p>
              </>
            )}
            {alert}
            <ButtonRow><GlassButton type="submit" kind="primary" busy={busy !== null}>Send a code</GlassButton></ButtonRow>
          </form>
        ) : (
          <form aria-label="Enter the code" aria-busy={busy !== null} onSubmit={(e) => void verify(e)} noValidate>
            <p className="kb-acct-notice">{sent?.message}</p>
            {sent?.invite && <p className="kb-acct-notice">{sent.invite}</p>}
            <label className="kb-acct-row kb-acct-field">
              <span className="kb-acct-row-label">Code from the email</span>
              <input ref={codeField} className="kb-acct-input kb-acct-code" name="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} {...tie('code')} />
            </label>
            {alert}
            <ButtonRow>
              <GlassButton type="submit" kind="primary" busy={busy !== null}>Sign in</GlassButton>
              <GlassButton busy={busy !== null} onClick={() => void ask(undefined, true)}>Send a new code</GlassButton>
              <GlassButton onClick={() => { setStep('email'); setRefusal(null); }}>Use another address</GlassButton>
            </ButtonRow>
            <p role="status" className="kb-acct-note">
              {asked > 0 ? <span key={asked}>Another code was asked for.</span> : ''}
            </p>
          </form>
        )}
        </CalmRegion>
        {aside}
      </div>
    </div>
  );
}
