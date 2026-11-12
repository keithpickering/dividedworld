/**
 * The emailed link's panel, where Sign in and Register hold the form while a link is in hand. Opening a page never spends the
 * link (a mail scanner opens links, too): only the press does. Each state is one sentence in a status region that takes focus when
 * it stands, so a screen reader hears what changed; the way out of each is a button on the panel (the design, section 3).
 *
 * The panel does not leave the screen: it asks the screen to set the link aside (`onAside`, which shows the form, or lets the
 * screen's own move on to `next` run) or to show the form with the server's refusal (`onRefused`).
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { setWhy, useSession } from './session.ts';

type Props = {
  readonly tokenHash: string;
  readonly registering: boolean;
  readonly onAside: () => void;
  readonly onRefused: (sentence: string) => void;
};
type Phase = 'ready' | 'done';

export function LinkPanel({ tokenHash, registering, onAside, onRefused }: Props) {
  const { api } = useKayfa();
  const session = useSession();
  /* Whether a session was here before the press: it says who the link would sign out. Read once, as the panel stands. */
  const [wasSignedIn] = useState(() => session?.signedIn === true);
  const [phase, setPhase] = useState<Phase>('ready');
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lost, setLost] = useState(false);
  const lead = useRef<HTMLParagraphElement>(null);

  /* The address a session is signed in as is read from the backend, for the one who holds it. */
  useEffect(() => {
    let live = true;
    if (wasSignedIn || phase === 'done') void api.signInAddress().then((a) => { if (live) setAddress(a); }, () => {});
    return () => { live = false; };
  }, [api, wasSignedIn, phase]);

  /* Focus follows each state: the first sentence, once there are words in it. */
  const stateKey = phase === 'done' ? (address === null ? 'pending' : 'done') : wasSignedIn ? (address === null ? 'pending' : 'already') : 'ready';
  useEffect(() => { if (stateKey !== 'pending') lead.current?.focus(); }, [stateKey]);

  const press = async () => {
    if (busy) return;
    setBusy(true);
    setLost(false);
    try {
      const r = await api.verifyLink(tokenHash);
      if (!r.ok) { onRefused(r.error); return; }
      if (!r.value.account) { setWhy(r.value.why ?? null); onAside(); return; }
      setAddress(null);
      setPhase('done');
    } catch {
      setLost(true);
    } finally {
      setBusy(false);
    }
  };
  const signOut = async () => {
    try { await api.signOut(); } catch { /* The form is where the player goes either way; the session says whether they are out. */ }
    onAside();
  };

  const names = phase === 'done'
    ? (address === null ? '' : `You are signed in as ${address}.`)
    : wasSignedIn
      ? (address === null ? '' : `This browser is signed in as ${address}. Using the link signs that account out.`)
      : registering ? 'This link finishes signing you up. It works once.' : 'This link signs you in. It works once.';

  return (
    <div className="kb-link-panel" aria-busy={busy}>
      <p role="status" ref={lead} tabIndex={-1} className="kb-acct-lead">{names}</p>
      {lost && <p role="alert" className="kb-acct-refusal">{LOST_ANSWER}</p>}
      {phase === 'done' ? (
        <ButtonRow>
          <GlassButton kind="primary" onClick={onAside}>Continue</GlassButton>
          <GlassButton onClick={() => void signOut()}>Not you? Sign out</GlassButton>
        </ButtonRow>
      ) : wasSignedIn ? (
        <ButtonRow>
          <GlassButton kind="primary" busy={busy} onClick={() => void press()}>{lost ? 'Try again' : 'Sign in with the link'}</GlassButton>
          <GlassButton onClick={onAside}>Stay signed in</GlassButton>
        </ButtonRow>
      ) : (
        <ButtonRow>
          <GlassButton kind="primary" busy={busy} onClick={() => void press()}>{lost ? 'Try again' : registering ? 'Finish signing up' : 'Sign in'}</GlassButton>
          <GlassButton onClick={onAside}>Use a code instead</GlassButton>
        </ButtonRow>
      )}
    </div>
  );
}
