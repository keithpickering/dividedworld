/**
 * An admin's How players reach you (the onboarding follow-ups plan, Task 8; its design, section 2): the form on the admin screen that sets the
 * links the Reach a person page shows (engine/ui/contact/Contact.tsx), up to five rows of a label and an address. It stores the setting
 * `adminContact` through `setAdminContact`, which holds the real rules; the bounds here only keep the rows to five.
 *
 * Plain, out-of-character text, as the screen around it ("The fiction may lie; the log never does"). The server repairs what an admin typed
 * where it can (the space around words, an empty row, a bare email made `mailto:`) and refuses, naming the row, where it cannot; the form shows the
 * words as they come, beside the row they name, and keeps what was typed. After a save the rows are what the server stored, so a repair is seen.
 * Rows go to the server as typed, an empty row included, so a refusal's "row N" is this form's row N.
 *
 * While the contact is empty the page says plainly that the admins haven't added a way, so this form says the other half: players have no way to reach
 * an admin until it is filled in. Nothing is sent twice: the button is held while a save is out, and a lost answer is said in its words, with what
 * was typed kept, never resent by itself.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import { CONTACT_HREF_MAX, CONTACT_LABEL_MAX, CONTACT_MOST, type ContactLink } from '../data/api.ts';
import './write-update.css';
import './admin-contact.css';

interface Row { readonly key: number; readonly label: string; readonly href: string }

/** The row a refusal names ("row 2 has…"), or null when its words name none the form has. */
const rowNamed = (words: string, rows: number): number | null => {
  const n = Number(/\brow (\d+)\b/u.exec(words)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= rows ? n : null;
};

export function AdminContact() {
  const { api } = useKayfa();
  const id = useId();
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [next, setNext] = useState(1);
  const [stored, setStored] = useState<readonly ContactLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const show = (links: readonly ContactLink[], from: number) => {
    const made = links.length === 0 ? [{ key: from, label: '', href: '' }] : links.map((l, i) => ({ key: from + i, label: l.label, href: l.href }));
    setRows(made);
    setNext(from + made.length);
  };
  useEffect(() => {
    let live = true;
    void api.adminContact().then((links) => { if (live) { setStored(links); show(links, 0); } }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [api]); /* read once, when the screen opens */

  if (failed) return <section className="kb-admin-contact" aria-labelledby={`${id}-head`}><h2 id={`${id}-head`} className="kb-queue-group-head kb-glass-display">How players reach you</h2><p role="alert" className="kb-queue-note kb-calm">The contact could not be read. Reload the page to try again.</p></section>;
  if (rows === null) return <section className="kb-admin-contact" aria-busy="true" />;

  const edit = () => { setRefusal(null); setSaved(false); };
  const setRow = (key: number, part: 'label' | 'href', value: string) => { edit(); setRows(rows.map((r) => (r.key === key ? { ...r, [part]: value } : r))); };
  const add = () => { edit(); setRows([...rows, { key: next, label: '', href: '' }]); setNext(next + 1); };
  /* The last row is cleared and not removed: a form with no row has nowhere to start a link. */
  const remove = (key: number) => {
    edit();
    if (rows.length === 1) { setRows([{ key: next, label: '', href: '' }]); setNext(next + 1); } else setRows(rows.filter((r) => r.key !== key));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    setSaved(false);
    try {
      let answer;
      try {
        answer = await api.setAdminContact(rows.map((r) => ({ label: r.label, href: r.href })));
      } catch {
        setRefusal('No answer came back. It may have been saved: reload the page and look before you save it again.');
        return;
      }
      if (!answer.ok) { setRefusal(answer.error); return; }
      setStored(answer.value);
      show(answer.value, next);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  };

  const named = refusal === null ? null : rowNamed(refusal, rows.length);
  const empty = stored !== null && stored.length === 0;
  return (
    <section className="kb-admin-contact" aria-labelledby={`${id}-head`}>
      <h2 id={`${id}-head`} className="kb-queue-group-head kb-glass-display">How players reach you</h2>
      <form className="kb-write-update" aria-labelledby={`${id}-head`} onSubmit={(e) => void submit(e)} noValidate>
        <p className="kb-write-update-note">
          Players read these on the Reach a person page, which they can open signed out. Up to {CONTACT_MOST} links, each a label and an address: a web address that starts with https://, or an email address.
        </p>
        {empty && <p className="kb-write-update-note kb-admin-contact-empty">Players have no way to reach you until this is filled in. Their Reach a person page says so until then.</p>}
        {rows.map((r, i) => {
          const mine = named === i + 1;
          return (
            <div key={r.key} role="group" aria-label={`Link ${i + 1}`} className="kb-admin-contact-line">
              <div className="kb-write-update-row">
                <input className="kb-write-update-input kb-write-update-label" aria-label={`Link ${i + 1} label`} placeholder="Label" value={r.label} maxLength={CONTACT_LABEL_MAX * 2} autoComplete="off"
                  aria-invalid={mine || undefined} aria-describedby={mine ? `${id}-r${r.key}` : undefined} onChange={(e) => setRow(r.key, 'label', e.target.value)} />
                <input className="kb-write-update-input kb-write-update-text" aria-label={`Link ${i + 1} address`} placeholder="https://… or name@example.com" value={r.href} maxLength={CONTACT_HREF_MAX * 2} autoComplete="off" inputMode="url"
                  aria-invalid={mine || undefined} aria-describedby={mine ? `${id}-r${r.key}` : undefined} onChange={(e) => setRow(r.key, 'href', e.target.value)} />
                <button type="button" className="kb-write-update-button" onClick={() => remove(r.key)}>Remove link {i + 1}</button>
              </div>
              {mine && <p role="alert" id={`${id}-r${r.key}`} className="kb-write-update-refusal">{refusal}</p>}
            </div>
          );
        })}
        <div className="kb-write-update-actions">
          <button type="button" className="kb-write-update-button" disabled={rows.length >= CONTACT_MOST} onClick={add}>Add a link</button>
          <button type="submit" className="kb-write-update-button kb-write-update-post" disabled={busy}>Save how players reach you</button>
        </div>
        <div role="status" className="kb-write-update-status">{saved ? 'Saved. Players see it on the Reach a person page.' : ''}</div>
        {refusal !== null && named === null && <p role="alert" className="kb-write-update-refusal">{refusal}</p>}
      </form>
    </section>
  );
}
