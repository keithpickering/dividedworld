/**
 * What an account that has not accepted the current code of conduct sees in place of every page (the conduct plan, Task 4): the code, and
 * "I agree". Agreeing records the version (accept_conduct), the session is read again, and the gate lets the player through. A refusal is
 * said in the server's words and the button stays, so the player is never stuck; Sign out is always on the screen too. Plain, never in
 * character.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import '../account/account.css';
import './conduct.css';
import { ConductSections } from './Conduct.tsx';

export function Accept() {
  const { api, ui } = useKayfa();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  const agree = async () => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const r = await api.acceptConduct(ui.conduct.version);
      if (!r.ok) setRefusal(r.error);
      /* Accepted: the session is read again and the gate moves on; there is nothing more to do here. */
    } catch {
      setRefusal(LOST_ANSWER);
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    if (busy) return;
    setBusy(true);
    try { await api.signOut(); } finally { setBusy(false); }
  };

  return (
    <div className="kb-acct kb-conduct">
      <CalmRegion className="kb-acct-panel">
        <section aria-labelledby="kb-accept-title">
          <h1 id="kb-accept-title" ref={heading} tabIndex={-1} className="kb-acct-section-title kb-glass-display">Code of conduct</h1>
          <p className="kb-acct-lead">Before you play on, read the code everyone here plays by and agree to it.</p>
          <ConductSections />
          {refusal && <p role="alert" className="kb-acct-refusal">{refusal}</p>}
          <ButtonRow>
            <GlassButton type="button" kind="primary" busy={busy} onClick={() => void agree()}>I agree</GlassButton>
            <GlassButton busy={busy} onClick={() => void leave()}>Sign out</GlassButton>
          </ButtonRow>
        </section>
      </CalmRegion>
    </div>
  );
}
