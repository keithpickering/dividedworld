/**
 * An admin's Write an update (the alerts plan, Task 7; the alerts design, section 6): the form on the Updates page that posts one update as the
 * instance's developer persona. A title, the words, and the plain "What changed" list as rows of a bold label (it may be empty) and a text.
 *
 * Plain, out-of-character text throughout: the persona's voice is the admin's to write in the words box, and the form around it is the
 * glass speaking plainly ("The fiction may lie; the log never does"). It says who it posts as, that every player is told, and that no model
 * writes it, which is what keeps the page true. Nothing is sent twice: a button held while the post is out, and a lost answer is shown in its
 * words ("look before you post it again") with what was written kept, never resent by itself.
 *
 * The server repairs what an admin typed where it can (the space around words, a row with neither label nor text) and refuses, naming the
 * change's number, where it cannot; its words are shown as they come. `postUpdate` holds the real rules; the bounds below only keep the form
 * from being sent when it is plainly empty or too long, and the rows to the 30 the page lists.
 *
 * Under the form, "What everyone will see" draws the update as the Updates page draws it (UpdateArticle, the page's own component) from what is typed. It
 * is never saved or sent: it reads nothing and calls no api, and it has no reactions to press.
 *
 * Opened from a handover's to-do (the staff roster design, section 11), the form carries `initial`: a title and the handover's plain facts as the
 * words. They are a draft the admin replaces, not an announcement: the form says so, and holds the post while the words are still exactly the
 * filled-in lines, so the facts alone are never posted as if they were written. Nothing here calls a model.
 */
import { useId, useState, type FormEvent } from 'react';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import { useKayfa } from '../context.tsx';
import type { Update, UpdateChange } from '../data/api.ts';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { CalmRegion } from '../glass/Calm.tsx';
import { FieldCount } from '../glass/FieldCount.tsx';
import { UpdateArticle } from '../updates/UpdateArticle.tsx';
import './write-update.css';

/** The most changes an update lists (supabase/migrations/0062_updates.sql, update_payload_problem). */
const MOST_CHANGES = 30;

interface Row { readonly key: number; readonly label: string; readonly text: string }

export interface WriteUpdateProps {
  readonly onWritten?: (update: Update) => void;
  /** A title and words to open with (a handover's facts): a draft for the admin to replace. */
  readonly initial?: { readonly title: string; readonly words: string };
}

export function WriteUpdate({ onWritten, initial }: WriteUpdateProps) {
  const { api, instance, settings } = useKayfa();
  const id = useId();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [words, setWords] = useState(initial?.words ?? '');
  const [rows, setRows] = useState<readonly Row[]>([{ key: 0, label: '', text: '' }]);
  const [next, setNext] = useState(1);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const persona = instance.developer?.name ?? DEFAULT_DEVELOPER.name;
  const developer = instance.developer ?? DEFAULT_DEVELOPER;

  const edit = () => { setRefusal(null); setPosted(false); };
  const setRow = (key: number, part: 'label' | 'text', value: string) => { edit(); setRows(rows.map((r) => (r.key === key ? { ...r, [part]: value } : r))); };
  const add = () => { edit(); setRows([...rows, { key: next, label: '', text: '' }]); setNext(next + 1); };
  /* The last row is cleared and not removed: a form with no row has nowhere to start a change. */
  const remove = (key: number) => {
    edit();
    if (rows.length === 1) { setRows([{ key: next, label: '', text: '' }]); setNext(next + 1); } else setRows(rows.filter((r) => r.key !== key));
  };

  const length = [...words].length;
  const blank = title.trim() === '' || words.trim() === '';
  /* The filled-in lines, untouched: a draft, not yet an announcement. */
  const drafting = initial !== undefined && words === initial.words;
  const tooLong = length > settings.postMaxLength || [...title].length > settings.titleMaxLength;

  /* Why the button is held, in words: the button is described by this, and a too-long form says by how much. */
  const over = length - settings.postMaxLength;
  const why = over > 0 ? `Too long by ${over} ${over === 1 ? 'character' : 'characters'}` : tooLong ? 'The title is too long.' : blank ? 'Give the update a title and some words to post it.' : drafting ? 'Change the words to post. The filled-in lines are facts, not yet the announcement.' : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || blank || tooLong || drafting) return;
    setBusy(true);
    setRefusal(null);
    setPosted(false);
    try {
      let answer;
      try {
        const changes: UpdateChange[] = rows.map((r) => ({ label: r.label, text: r.text }));
        answer = await api.postUpdate(title, words, changes);
      } catch {
        setRefusal('No answer came back. It may have gone through: look at Updates before you post it again.');
        return;
      }
      if (!answer.ok) { setRefusal(answer.error); return; }
      setTitle('');
      setWords('');
      setRows([{ key: next, label: '', text: '' }]);
      setNext(next + 1);
      setPosted(true);
      onWritten?.(answer.value);
    } finally {
      setBusy(false);
    }
  };

  /* The update as the page will draw it: the rows the server would keep (a row with neither label nor text is left out), their spaces trimmed as it trims them; the title and the words go as they are typed (post_update keeps them whole). */
  const shown = {
    name: developer.name, tagline: developer.tagline, avatar: developer.avatar ?? null, title, body: words, at: '',
    changes: rows.map((r) => ({ label: r.label.trim(), text: r.text.trim() })).filter((c) => c.label !== '' || c.text !== ''),
  };
  const previewing = title.trim() !== '' || words.trim() !== '';

  return (
    <>
      <form className="kb-write-update kb-glass-cut-dialog kb-write-update-piece" aria-labelledby={`${id}-head`} onSubmit={(e) => void submit(e)} noValidate>
        <div className="kb-write-update-intro">
          <h2 id={`${id}-head`} className="kb-write-update-head kb-glass-display">Write an update</h2>
          <p className="kb-write-update-note">
            This posts as {persona}. Every player gets it as an alert. No model writes it, and the page says it is always true, so check the facts.
          </p>
        </div>
        <div className="kb-write-update-field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} className="kb-write-update-input" value={title} maxLength={settings.titleMaxLength} autoComplete="off" onChange={(e) => { edit(); setTitle(e.target.value); }} />
        </div>
        {initial !== undefined && (
          <p className="kb-write-update-note" role="note">
            The title and words are filled in from the handover: these are facts, not the announcement. Add to them or rewrite them in your own words; no model does.
          </p>
        )}
        <div className="kb-write-update-field">
          <label htmlFor={`${id}-words`}>Words</label>
          <textarea id={`${id}-words`} className="kb-write-update-input" rows={3} value={words} aria-describedby={`${id}-count`} onChange={(e) => { edit(); setWords(e.target.value); }} />
          <FieldCount id={`${id}-count`} text={words} max={settings.postMaxLength} />
        </div>
        <fieldset className="kb-write-update-changes">
          <legend>What changed</legend>
          <p className="kb-write-update-hint">A bold label (it can be left empty) and the words after it, one change to a row. A row with nothing in it is left out.</p>
          {rows.map((r, i) => (
            <div key={r.key} className="kb-write-update-row">
              <input className="kb-write-update-input kb-write-update-label" aria-label={`Change ${i + 1} label`} placeholder="Label" value={r.label} autoComplete="off" onChange={(e) => setRow(r.key, 'label', e.target.value)} />
              <input className="kb-write-update-input kb-write-update-text" aria-label={`Change ${i + 1} text`} placeholder="What changed" value={r.text} autoComplete="off" onChange={(e) => setRow(r.key, 'text', e.target.value)} />
              <GlassButton size="s" onClick={() => remove(r.key)}>Remove{' '}<span className="kb-visually-hidden">change {i + 1}</span></GlassButton>
            </div>
          ))}
        </fieldset>
        <ButtonRow>
          <GlassButton disabled={rows.length >= MOST_CHANGES} onClick={add}>Add a change</GlassButton>
          <GlassButton type="submit" kind="primary" busy={busy} disabled={blank || tooLong || drafting} aria-describedby={why === '' ? undefined : `${id}-why`}>Post update</GlassButton>
        </ButtonRow>
        <div id={`${id}-why`} aria-live="polite" className="kb-write-update-why">{why}</div>
        <div role="status" className="kb-write-update-status">{posted ? 'Posted. Every player has it in their alerts.' : ''}</div>
        {refusal && <p role="alert" className="kb-write-update-refusal">{refusal}</p>}
      </form>
      <CalmRegion as="section" className="kb-write-update-preview" aria-labelledby={`${id}-preview`}>
        <h3 id={`${id}-preview`} className="kb-write-update-preview-head">What everyone will see</h3>
        {previewing ? <UpdateArticle update={shown} level={4} /> : <p className="kb-write-update-note">Nothing to show yet. Write a title and some words.</p>}
      </CalmRegion>
    </>
  );
}
