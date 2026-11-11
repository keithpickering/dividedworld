/**
 * Report to admins (the conduct plan, Task 6; the confirmed brief and the boards in docs/research/2026-11-02-conduct/): the way a player tells a person, not the game, that a post
 * breaks the code of conduct. It is a plain text link, a `<button>` drawn as a link, never a tab, mark or chip: at the very foot of a post's Lens (the board's own Report, which a Mod
 * Bot hears, is unchanged) and on each version in the post's History. Both open one dialog naming the version, in the account screens' plain look, a sheet on a phone.
 *
 * The dialog is the glass speaking plainly and out of character. It lists the code's sections as radios, each with a link to /conduct#key, and takes a note up to 1000 characters with a
 * live count. Its states stand in the dialog, each with focus on its heading: sent; the open-report limit, which replaces the form and gives the account's own count; and an error,
 * said above the form, which keeps what was typed. No state leans on a color, and nothing animates.
 *
 * "A response never proves a private fact": nothing here reads who owns the reported post. The report is the account's own (`report_post`), refused only by the account's own limit,
 * and the count it names is the account's own.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import { REPORT_LIMIT, type Id } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { FieldCount } from '../glass/FieldCount.tsx';
import { Layers } from '../glass/layer.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { Link } from '../router.tsx';
import './report.css';
import '../cards/forms.css';

/** The most a note holds, as `report_post` checks it. */
export const NOTE_MAX = 1000;

const LEAD = 'This reaches a person, not the game. An admin reads every report, and the player is never told who sent it.';
const SENT = 'Sent. An admin will read it, and we\'ll email you when they have. Nothing changes on the board.';
const OFFLINE = 'That did not send. Check your connection and press Send to admins again; what you typed is still here.';
const CHOOSE = 'Choose the part of the code this breaks.';

/** The limit's words with the account's own count; with no count read, the same without a number. */
const limitWords = (n: number | null): string =>
  `You have ${n === null ? 'the most reports' : `${n} ${n === 1 ? 'report' : 'reports'}`} waiting for an admin. You can send another once one of them is read.`;

/** What a post's Lens needs to offer Report to admins: the post, its current version when that is not the post itself (null: read when the dialog opens), and how the dialog names it. */
export interface ReportTo { readonly post: Id; readonly version: Id | null; readonly kicker: string }

type Said = { readonly kind: 'form' } | { readonly kind: 'sent' } | { readonly kind: 'limit'; readonly n: number | null };

/**
 * The plain link, and the dialog it opens. `post` is the post the version belongs to; `version` is the version's Act, or null for the post's current version, which is read when
 * the dialog opens (a post that has been edited has a newer one than the post's own id). `kicker` names it for the reader ("Post #2 by Gravy Knight, current version").
 */
export function ReportLink({ post, version, kicker, className, ariaLabel }: {
  readonly post: Id; readonly version: Id | null; readonly kicker: string; readonly className: string; readonly ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={opener} type="button" className={`kb-linklike ${className}`} aria-haspopup="dialog" aria-label={ariaLabel} onClick={() => setOpen(true)}>Report to admins</button>
      <Layers>
        {open && <ReportDialog post={post} version={version} kicker={kicker} onClose={() => setOpen(false)} returnFocusTo={() => opener.current} />}
      </Layers>
    </>
  );
}

function ReportDialog({ post, version, kicker, onClose, returnFocusTo }: {
  readonly post: Id; readonly version: Id | null; readonly kicker: string; readonly onClose: () => void; readonly returnFocusTo: () => HTMLElement | null;
}) {
  const lead = useId();
  return (
    <Overlay title="Report to admins" kicker={kicker} surface="account" describedBy={lead} onClose={onClose} returnFocusTo={returnFocusTo}>
      <ReportBody post={post} version={version} lead={lead} onClose={onClose} />
    </Overlay>
  );
}

function ReportBody({ post, version, lead, onClose }: { readonly post: Id; readonly version: Id | null; readonly lead: string; readonly onClose: () => void }) {
  const { api, ui } = useKayfa();
  const ids = useId();
  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>({ kind: 'form' });
  const [problem, setProblem] = useState<string | null>(null);
  const over = [...note].length > NOTE_MAX;
  /* The post's current version, read as the dialog opens when the entry is the Lens's; a version named by its row is used as it is. */
  const current = useRef<Promise<Id | null> | null>(null);
  if (current.current === null) current.current = version !== null ? Promise.resolve(version) : Promise.resolve(api.history(post)).then((v) => v.at(-1)?.id ?? post, () => null);

  /* The account's own count is read as the dialog opens: at the limit the limit is said in place of the form at once. A count that cannot be read leaves the form, which the server still refuses at send time. */
  useEffect(() => {
    let live = true;
    Promise.resolve(api.myOpenReports()).then((held) => { if (live && held !== null && held.open >= held.most) setSaid({ kind: 'limit', n: held.open }); }, () => undefined);
    return () => { live = false; };
  }, [api]);

  /* A state is said with focus on the dialog's heading, which the dialog frame draws and names the dialog by. */
  const toHeading = () => {
    const head = root.current?.closest<HTMLElement>('[role="dialog"]')?.querySelector<HTMLElement>('.kb-glass-dialog-head');
    if (!head) return;
    head.setAttribute('tabindex', '-1');
    head.focus();
  };
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) { moved.current = true; return; }
    if (said.kind !== 'form' || (problem !== null && problem !== CHOOSE)) toHeading();
  }, [said, problem]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (section === null) { setProblem(CHOOSE); first.current?.focus(); return; }
    if (over) { setProblem(`A note is at most ${NOTE_MAX} characters.`); return; }
    setBusy(true);
    setProblem(null);
    try {
      const id = await current.current;
      if (id === null) { setProblem(OFFLINE); return; }
      const a = await api.reportPost(id, section, note);
      if (a.ok) { setSaid({ kind: 'sent' }); return; }
      if (a.field === REPORT_LIMIT) {
        const held = await Promise.resolve(api.myOpenReports()).catch(() => null);
        setSaid({ kind: 'limit', n: held === null ? null : held.open });
        return;
      }
      setProblem(a.uncertain === true ? OFFLINE : `That did not send: ${a.error}. What you typed is still here.`);
    } catch {
      setProblem(OFFLINE);
    } finally {
      setBusy(false);
    }
  };

  if (said.kind !== 'form') {
    return (
      <div ref={root} className="kb-report-body">
        <p id={lead} className="kb-report-said">{said.kind === 'sent' ? SENT : limitWords(said.n)}</p>
        <div className="kb-glass-form-foot"><ButtonRow align="end"><GlassButton kind="secondary" onClick={onClose}>Close</GlassButton></ButtonRow></div>
      </div>
    );
  }
  return (
    <div ref={root} className="kb-report-body">
      <p id={lead} className="kb-acct-text">{LEAD}</p>
      {problem !== null && <p role="alert" className="kb-report-said">{problem}</p>}
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset className="kb-report-sections">
          <legend className="kb-visually-hidden">Which part of the code of conduct</legend>
          {ui.conduct.sections.map((s, i) => (
            <div key={s.key} className="kb-report-section">
              <label>
                <input ref={i === 0 ? first : undefined} type="radio" name={`${ids}-section`} value={s.key} checked={section === s.key} onChange={() => { setSection(s.key); if (problem === CHOOSE) setProblem(null); }} />
                <span>{s.title}</span>
              </label>
              <Link to={`/conduct#${s.key}`} target="_blank" rel="noopener" aria-label={`Read: ${s.title} (opens in a new tab)`}>Read</Link>
            </div>
          ))}
        </fieldset>
        <div className="kb-report-note">
          <label className="kb-report-label" htmlFor={`${ids}-note`}>Anything an admin should know (optional)</label>
          <textarea id={`${ids}-note`} className="kb-mod-textarea" rows={4} value={note} aria-describedby={`${ids}-count`} aria-invalid={over ? 'true' : undefined} onChange={(e) => setNote(e.target.value)} />
          <FieldCount id={`${ids}-count`} text={note} max={NOTE_MAX} />
        </div>
        <div className="kb-glass-form-foot">
          <ButtonRow align="end">
            <GlassButton kind="quiet" onClick={onClose}>Cancel</GlassButton>
            <GlassButton type="submit" kind="secondary" busy={busy}>Send to admins</GlassButton>
          </ButtonRow>
        </div>
      </form>
    </div>
  );
}
