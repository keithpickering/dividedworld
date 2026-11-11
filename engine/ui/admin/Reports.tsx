/**
 * The reports screen, a glass page at /admin/reports (the conduct plan, Task 7; the design's "The admin screen"). It is plain and functional: it
 * is seen by admins only, and it is out of character throughout ("The fiction may lie; the log never does"). Four groups, in the order an admin
 * works through them:
 *
 *   Open reports               newest first: the reported version's words, the section of the code and the note the reporter gave, the author's account
 *                              (never the reporter) and what was decided about that account before; and the outcome form, any of none, nudge, hide, hide
 *                              until edited, suspend (with its end date), ban and close, with a note that goes into the author's mail.
 *   Edits to look at again     a post hidden until its author edited it, edited since, and not decided again: approve it, or hide it again.
 *   Mail that failed           mail whose latest attempt failed (it will be tried again) or was refused (it never will be).
 *   (a notice, above them)     when no admin reply-to address is set (Settings.conduct.adminAddress) mail waits, and the notice says so: it is that
 *                              state's way out, since nothing else says why the mail is not going.
 *
 * A staff character's post has no account behind it: the screen says so, and the outcomes that write to an account (nudge, suspend, ban) are
 * refused by the server in its words, which the form shows. Every decision reads the page again, so a stale row never stays.
 */
import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { REPORT_OUTCOMES, type AdminReport, type AdminReview, type FailedMail, type ReportOutcome, type ReportOutcomeKey, type ReportsPage } from '../data/api.ts';
import { useKayfa } from '../context.tsx';
import { isNotAdminDoc, type NotAdminDoc } from '../glass-docs.ts';
import { isSignedOutDoc, type ScreenDoc } from '../screen-docs.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { Link } from '../router.tsx';
import { AdminPages } from './AdminPages.tsx';
import './queue.css';
import './write-update.css';
import './reports.css';

const LABELS: Readonly<Record<ReportOutcomeKey, string>> = {
  none: 'No action',
  nudge: 'Nudge',
  hide: 'Hide',
  hideUntilEdited: 'Hide until edited',
  suspend: 'Suspend',
  ban: 'Ban',
  close: 'Close with no word to the author',
};

/** A time as an admin reads it: the date and the minute, in UTC, as the mail says it. */
const when = (iso: string): string => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The reports screen at /admin/reports, drawn from the route's document. A caller who is not an admin (or not signed in) has no page: the line says so. */
export function ReportsScreen({ doc }: { readonly doc: ScreenDoc<ReportsPage> | NotAdminDoc }) {
  if (isSignedOutDoc(doc) || isNotAdminDoc(doc)) {
    return (
      <div className="kb-queue">
        <PageHead title="Reports to admins" />
        <CalmRegion as="p" className="kb-queue-lead">The reports screen is for admins.</CalmRegion>
      </div>
    );
  }
  return <Reports page={doc} />;
}

function Reports({ page }: { readonly page: ReportsPage }) {
  const { api, ui } = useKayfa();
  const [read, setRead] = useState<{ readonly of: ReportsPage; readonly page: ReportsPage } | null>(null);
  const shown = read !== null && read.of === page ? read.page : page;
  const [failedRead, setFailedRead] = useState(false);
  const [said, setSaid] = useState('');
  const openHead = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await api.reportsPage();
      if (next !== null) setRead({ of: page, page: next });
      setFailedRead(false);
    } catch {
      setFailedRead(true);
    }
  }, [api, page]);

  const titleOf = (key: string): string => ui.conduct.sections.find((s) => s.key === key)?.title ?? key;
  const decided = async (words: string, focus: boolean) => {
    setSaid(words);
    await load();
    if (focus) openHead.current?.focus();
  };

  return (
    <div className="kb-queue">
      <PageHead title="Reports to admins" />
      <CalmRegion as="p" className="kb-queue-lead">
        Reports from players about a post. Decide each one: the reporter is told it was read, the same whatever you decide, and the author is told what happened to their words.
      </CalmRegion>
      <AdminPages current="reports" />
      {failedRead && <CalmRegion as="p" className="kb-queue-note" role="alert">The page could not be read again. Reload it to see where things stand.</CalmRegion>}
      <div role="status" className="kb-write-update-status">{said}</div>
      {!shown.addressSet && (
        <CalmRegion as="section" role="status" aria-label="Mail waiting" className="kb-reports-notice">
          {shown.waiting > 0
            ? `Mail is waiting: no admin reply-to address is set (Settings.conduct.adminAddress). ${shown.waiting} ${shown.waiting === 1 ? 'mail goes' : 'mails go'} out once it is set.`
            : 'No admin reply-to address is set (Settings.conduct.adminAddress). Mail will wait until it is.'}
        </CalmRegion>
      )}
      <CalmRegion as="section" className="kb-queue-group" aria-labelledby="reports-open">
        <h2 id="reports-open" ref={openHead} tabIndex={-1} className="kb-queue-group-head kb-glass-display">Open reports <span className="kb-queue-count">{shown.reports.length}</span></h2>
        {shown.reports.length === 0 && <p className="kb-queue-note">No open reports.</p>}
        {shown.reports.map((r) => <ReportItem key={r.id} report={r} section={titleOf(r.section)} onDecided={() => decided(`Decided report ${r.id}.`, true)} />)}
      </CalmRegion>
      <CalmRegion as="section" className="kb-queue-group" aria-labelledby="reports-review">
        <h2 id="reports-review" tabIndex={-1} className="kb-queue-group-head kb-glass-display">Edits to look at again <span className="kb-queue-count">{shown.reviews.length}</span></h2>
        {shown.reviews.length === 0 && <p className="kb-queue-note">Nothing waits for a second look.</p>}
        {shown.reviews.map((v) => <ReviewItem key={v.decision} review={v} onDecided={(words) => decided(words, false)} />)}
      </CalmRegion>
      <CalmRegion as="section" className="kb-queue-group" aria-labelledby="reports-mail">
        <h2 id="reports-mail" tabIndex={-1} className="kb-queue-group-head kb-glass-display">Mail that failed <span className="kb-queue-count">{shown.failed.length}</span></h2>
        {shown.failed.length === 0 && <p className="kb-queue-note">No mail has failed.</p>}
        {shown.failed.map((m) => <FailedItem key={m.id} mail={m} />)}
      </CalmRegion>
    </div>
  );
}

function Author({ account }: { readonly account: string | null }) {
  return <p>{account === null ? 'A staff character, with no account.' : <>Author&apos;s account: <code>{account}</code></>}</p>;
}

function ThreadLink({ thread, post }: { readonly thread: string | null; readonly post: string }) {
  if (thread === null) return null;
  return <p><Link to={`/t/${thread}`}>Open the thread</Link><span className="kb-visually-hidden"> (post {post})</span></p>;
}

function ReportItem({ report, section, onDecided }: { readonly report: AdminReport; readonly section: string; readonly onDecided: () => Promise<void> }) {
  const { api } = useKayfa();
  const id = useId();
  const [picked, setPicked] = useState<ReadonlySet<ReportOutcomeKey>>(new Set());
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const toggle = (k: ReportOutcomeKey) => {
    setRefusal(null);
    const next = new Set(picked);
    if (next.has(k)) next.delete(k); else next.add(k);
    setPicked(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (picked.size === 0) { setRefusal('Pick at least one outcome.'); return; }
    const ends = until === '' ? NaN : new Date(until).getTime();
    if (picked.has('suspend') && !Number.isFinite(ends)) { setRefusal('A suspension needs an end date.'); return; }
    const words = note.trim();
    const outcomes: ReportOutcome[] = REPORT_OUTCOMES.filter((k) => picked.has(k)).map((k) => ({
      outcome: k,
      ...(k === 'suspend' ? { until: new Date(ends).toISOString() } : {}),
      ...(words !== '' && k !== 'none' && k !== 'close' ? { note: words } : {}),
    }));
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.decideReport(report.id, outcomes);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await onDecided();
    } catch {
      setRefusal('No answer came back. It may have gone through: reload the page and look before you decide again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="kb-reports-item" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Report {report.id}: {section}</h3>
      <p>Reported {when(report.at)}.{report.note !== null && <> The reporter wrote: “{report.note}”</>}</p>
      <blockquote className="kb-reports-words" aria-label="The reported words">{report.words}</blockquote>
      <ThreadLink thread={report.thread} post={report.post} />
      <Author account={report.author} />
      {report.past.length === 0
        ? <p>No past decisions about this account.</p>
        : (
          <ul className="kb-reports-past" aria-label="Past decisions">
            {report.past.map((d, i) => (
              <li key={i}>{when(d.at)}: {d.outcome}{d.until !== null ? ` until ${when(d.until)}` : ''}{d.note !== '' ? `. ${d.note}` : ''}</li>
            ))}
          </ul>
        )}
      <form className="kb-reports-form" aria-label={`Decide report ${report.id}`} onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="kb-reports-outcomes">
          <legend>Outcomes</legend>
          {REPORT_OUTCOMES.map((k) => (
            <label key={k} className="kb-reports-outcome">
              <input type="checkbox" checked={picked.has(k)} onChange={() => toggle(k)} />
              {LABELS[k]}
            </label>
          ))}
        </fieldset>
        {picked.has('suspend') && (
          <div className="kb-reports-field">
            <label htmlFor={`${id}-until`}>Suspended until</label>
            <input id={`${id}-until`} className="kb-write-update-input" type="datetime-local" value={until} onChange={(e) => { setRefusal(null); setUntil(e.target.value); }} />
          </div>
        )}
        <div className="kb-reports-field">
          <label htmlFor={`${id}-note`}>A note for the author</label>
          <textarea id={`${id}-note`} className="kb-write-update-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
        </div>
        <p>A hidden post&apos;s words stay with its author and with admins. A suspension ends on its date by itself; a ban and a hide end when an admin lifts them. The note goes into the author&apos;s mail.</p>
        <ButtonRow><GlassButton type="submit" kind="primary" busy={busy}>Decide</GlassButton></ButtonRow>
        {refusal !== null && <p role="alert" className="kb-write-update-refusal">{refusal}</p>}
      </form>
    </article>
  );
}

function ReviewItem({ review, onDecided }: { readonly review: AdminReview; readonly onDecided: (said: string) => Promise<void> }) {
  const { api } = useKayfa();
  const id = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const decide = async (outcome: 'approve' | 'hideUntilEdited') => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const words = note.trim();
      const answer = await api.decide({ version: review.versionAct }, outcome, undefined, outcome === 'approve' || words === '' ? undefined : words);
      if (!answer.ok) { setRefusal(answer.error); return; }
      await onDecided(outcome === 'approve' ? 'Approved the edit.' : 'Hid the edit again.');
    } catch {
      setRefusal('No answer came back. It may have gone through: reload the page and look before you decide again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="kb-reports-item" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`}>Edited {when(review.editedAt)}</h3>
      <blockquote className="kb-reports-words" aria-label="The edit">{review.words}</blockquote>
      <ThreadLink thread={review.thread} post={review.post} />
      <Author account={review.author} />
      <div className="kb-reports-field">
        <label htmlFor={`${id}-note`}>A note for the author, if you hide it again</label>
        <textarea id={`${id}-note`} className="kb-write-update-input" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
      </div>
      <ButtonRow>
        <GlassButton kind="primary" busy={busy} onClick={() => void decide('approve')}>Approve the edit</GlassButton>
        <GlassButton busy={busy} onClick={() => void decide('hideUntilEdited')}>Hide again until edited</GlassButton>
      </ButtonRow>
      {refusal !== null && <p role="alert" className="kb-write-update-refusal">{refusal}</p>}
    </article>
  );
}

function FailedItem({ mail }: { readonly mail: FailedMail }) {
  return (
    <article className="kb-reports-item">
      <p>{when(mail.at)}: the {mail.template} mail to account <code>{mail.account}</code> {mail.kind === 'failed' ? 'failed and will be tried again' : 'was refused and will not be tried again'}.</p>
      <p>{mail.error}</p>
    </article>
  );
}
