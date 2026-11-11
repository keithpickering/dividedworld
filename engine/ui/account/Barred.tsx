/**
 * What a barred account sees in place of every page (the conduct design, section 4; the conduct plan, Task 4): one plain screen and a way to
 * sign out. Plain and never in character: it speaks as the glass, truthfully ("The fiction may lie; the log never does"). A suspension says
 * the day it ends, which is its way out; a ban says the same without a date, and its way out, like a suspension's early end, is an admin,
 * reached by replying to the email.
 */
import { useEffect, useRef, useState } from 'react';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { useKayfa } from '../context.tsx';
import './account.css';

/** The moment as the email names it ("November 12, 2026 at 14:00 UTC", 0154_conduct_mail.sql), and as the server's refusal does: UTC, so the screen and the email name the same moment. */
const dateOf = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(d);
  return `${day} at ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};

/** Whether a bar still holds: a ban always, a suspension until its date. The server ends a suspension by itself, so a stale bar is never trusted. */
export const barHolds = (bar: { readonly until: string | null } | null, now: number = Date.now()): bar is { readonly until: string | null } =>
  bar !== null && (bar.until === null || Date.parse(bar.until) > now);

export function Barred({ until }: { readonly until: string | null }) {
  const { api } = useKayfa();
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const leave = async () => {
    if (busy) return;
    setBusy(true);
    try { await api.signOut(); } finally { setBusy(false); }
  };
  const lead = until === null ? 'This account is banned.' : `This account is suspended until ${dateOf(until)}.`;
  return (
    <div className="kb-acct">
      <CalmRegion className="kb-acct-panel">
        <section aria-labelledby="kb-barred-title">
          <h1 id="kb-barred-title" ref={heading} tabIndex={-1} className="kb-acct-section-title kb-glass-display">{until === null ? 'This account is banned' : 'This account is suspended'}</h1>
          <p className="kb-acct-text">{lead} We emailed you the details; reply to that email to appeal.</p>
          <ButtonRow><GlassButton busy={busy} onClick={() => void leave()}>Sign out</GlassButton></ButtonRow>
        </section>
      </CalmRegion>
    </div>
  );
}
