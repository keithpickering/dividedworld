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
import { addressOf, Link, useLocation, useNavigate } from '../router.tsx';
import { LinkPanel } from './LinkPanel.tsx';
import { useLinkHand } from './LinkHand.tsx';
import { tokenHashOf } from './link.ts';
import { safeNext } from './next.ts';
import { Barred } from './Barred.tsx';
import { OpenAccount } from './OpenAccount.tsx';
import { setWhy, useSession } from './session.ts';
import './account.css';
import { CalmRegion } from '../glass/Calm.tsx';

type Sent = { readonly message: string; readonly invite?: string };
type Field = 'email' | 'invite' | 'ack' | 'conduct' | 'code';
type Refusal = { readonly text: string; readonly field: Field | null };

const NO_ANSWER = 'No answer came back; ask again in a moment.';

export function SignInScreen({ mode }: { readonly mode: 'sign-in' | 'register' }) {
  const { api, settings, ui } = useKayfa();
  const session = useSession();
  const location = useLocation();
  const { query } = location;
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
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'sending' | 'checking' | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [asked, setAsked] = useState(0);
  /* Set when Auth refused the sign-in because the login is barred: shown plainly, the bar's own screen, while signed out. */
  const [barred, setBarred] = useState<{ readonly until: string | null | undefined } | null>(null);
  const codeField = useRef<HTMLInputElement>(null);
  /* The emailed link's token, held in memory only: the address loses its fragment as the screen stands (the query stays, `next` with it), so no history entry holds it. A provider above (link hand, LinkHand.tsx) keeps it, and whether this page's press signed in, across the screen starting afresh under the account the press signed in; with none the screen's own state holds it. */
  const hand = useLinkHand();
  const [start] = useState(() => hand ? hand.read(location.hash, location.path) : { tokenHash: tokenHashOf(location.hash), pressed: false });
  const [link, setLinkState] = useState<string | null>(start.tokenHash);
  const setLink = (value: string | null) => { hand?.hold(value, location.path); setLinkState(value); };
  useEffect(() => { hand?.hold(link, location.path); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once: the link this screen started with is held for this page
  useEffect(() => { if (link !== null && location.hash !== '') navigate(addressOf(location), { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, as the screen stands: the fragment is read at mount and later changes of the address must not run it again
  /* A refusal of the link while a session already holds an account: the screen stays on the form with the sentence, and Stay signed in is the way on. */
  const [held, setHeld] = useState(false);
  /* Leaving the page the link came to sets it aside, though the routes keep this same screen across Sign in and Register: the next page shows its ordinary form. The provider drops its hand on the same move. */
  const mountedAt = useRef(location.path);
  useEffect(() => {
    if (mountedAt.current === location.path) return;
    mountedAt.current = location.path;
    setLink(null);
    setHeld(false);
  }, [location.path]); // eslint-disable-line react-hooks/exhaustive-deps -- only a change of the page runs it

  /* While a link is held the screen stays: the link's panel says who is signed in, and its Continue is what moves on. */
  useEffect(() => { if (session?.account && link === null && !held) navigate(next, { replace: true }); }, [session?.account, link, held, navigate, next]);
  useEffect(() => { if (step === 'code') codeField.current?.focus(); }, [step]);

  const title = <PageHead title={registering ? 'Register' : 'Sign in'} />;
  if (session === null) return <div className="kb-acct" aria-busy="true" />;
  if (link === null && session.signedIn && !session.account) return <div className="kb-acct">{title}<CalmRegion className="kb-acct-panel"><OpenAccount /></CalmRegion></div>;

  const leaveBar = () => { setBarred(null); setStep('email'); setCode(''); setSent(null); };
  if (barred) return <Barred until={barred.until} signedIn={false} onLeave={leaveBar} />;

  const ask = async (e?: FormEvent, again = false) => {
    e?.preventDefault();
    if (busy) return;
    if (registering && !ack) { setRefusal({ text: 'Check the box to say you are 18 or older; then ask for a code.', field: 'ack' }); return; }
    if (registering && !agreed) { setRefusal({ text: 'Check the box to agree to the code of conduct; then ask for a code.', field: 'conduct' }); return; }
    setBusy('sending');
    setRefusal(null);
    try {
      const who = registering && invite.trim() !== '' ? invite.trim() : null;
      const kept = next === '/' ? null : next;
      const r = await (registering ? api.requestCode(email.trim(), who, kept, ui.conduct.version) : api.requestCode(email.trim(), who, kept));
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
      if (r.value.barred) { setBarred(r.value.barred); return; }
      /* An open account moves this screen on through the session; one that is not open shows the way on, with its reason. */
      if (!r.value.account) setWhy(r.value.why ?? null);
      setHeld(false);
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
  const stay = held && <GlassButton onClick={() => navigate(next, { replace: true })}>Stay signed in</GlassButton>;
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

  if (link !== null) {
    return (
      <div className="kb-acct kb-sign-in">
        {title}
        <div className="kb-door">
          <CalmRegion className="kb-door-form">
            <LinkPanel tokenHash={link} signedIn={start.pressed} registering={registering} onAside={() => setLink(null)} onRefused={(text) => { setHeld(session.account !== null); setLink(null); setRefusal({ text, field: null }); }} onBarred={(bar) => { setLink(null); setBarred(bar); }} />
          </CalmRegion>
          {aside}
        </div>
      </div>
    );
  }
  return (
    <div className="kb-acct kb-sign-in">
      {title}
      <div className="kb-door">
        <CalmRegion className="kb-door-form">
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
                <label className="kb-acct-ack">
                  {/* The checkbox is the acceptance: its version rides with the login and open_account records it with the account (0341), only here. */}
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} {...tie('conduct')} />
                  {/* One span, so the label's flex does not make the link a box of its own: it stays a link inside a sentence. */}
                  <span>I&apos;ve read and agree to the <Link to="/conduct" target="_blank" rel="noopener">code of conduct</Link>.</span>
                </label>
              </>
            )}
            {alert}
            <ButtonRow><GlassButton type="submit" kind="primary" busy={busy !== null}>Send a code</GlassButton>{stay}</ButtonRow>
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
              {stay}
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
