/**
 * The small form under an Act that starts a thread from it: a title and an optional opening post,
 * sent as the HUD's character. Like the reply box it names that character, and a swap of the HUD's
 * character while something is written needs the button pressed again. On success the player goes
 * to the new thread, which opens on its ORIGIN box, with focus on it. A refusal is shown in the
 * server's words and the form keeps what was written. Esc closes it. An answer that never came back
 * is looked for among the threads spun from this Act (this title, by this character) before the
 * spin is offered again ("Spin again anyway"): a spin is an Act, and a blind resend is a second one.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useWhoPosts } from '../composer/draft.ts';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Link, useNavigate } from '../router.tsx';
import { expectOrigin, spunLoader } from './spun.ts';
import './spin.css';

/** What was typed in a spin form: the title and the opening post. */
export interface SpinDraft { readonly title: string; readonly body: string }

/**
 * A post's spin drafts, one per origin (the post itself, or a play on it): the form is keyed by its origin and remounts
 * when it moves from the post to a play, so what was typed is kept here and not in the form (#100). A post that is gone
 * takes them with it; closing the form with Cancel or Esc throws that origin's away.
 */
export function useSpinDrafts(): { readonly get: (origin: Id) => SpinDraft | undefined; readonly set: (origin: Id, draft: SpinDraft | null) => void } {
  const drafts = useRef(new Map<Id, SpinDraft>());
  const get = useCallback((origin: Id) => drafts.current.get(origin), []);
  const set = useCallback((origin: Id, draft: SpinDraft | null) => { if (draft === null || (draft.title === '' && draft.body === '')) drafts.current.delete(origin); else drafts.current.set(origin, draft); }, []);
  return { get, set };
}

/**
 * `label` names the origin as the form says it: "post 41" for a post, "Mrs. Hooligan's Whoops!" for a card play
 * (the plays-on-a-post design, section 3); null for an Act with no such name ("this Act").
 */
export function SpinForm({ origin, label: named, onClose, draft, onDraft }: {
  readonly origin: Id; readonly label: string | null; readonly onClose: () => void;
  /** What was typed here before, and where to put each change (`useSpinDrafts`); a form with neither starts empty and keeps nothing. */
  readonly draft?: SpinDraft; readonly onDraft?: (draft: SpinDraft | null) => void;
}) {
  const { api, settings } = useKayfa();
  const { hudCharacter, characters, refresh } = usePlayer();
  const navigate = useNavigate();
  const [title, setTitleNow] = useState(draft?.title ?? '');
  const [body, setBodyNow] = useState(draft?.body ?? '');
  const setTitle = (t: string) => { setTitleNow(t); onDraft?.({ title: t, body }); };
  const setBody = (b: string) => { setBodyNow(b); onDraft?.({ title, body: b }); };
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const hud = hudCharacter?.id ?? null;
  const who = useWhoPosts(hud, title.trim() !== '' || body.trim() !== '');

  useEffect(() => { first.current?.focus(); }, []);

  const label = named === null ? 'Spin a thread' : `Spin a thread from ${named}`;
  if (!hudCharacter) {
    return (
      <div className="kb-spin-form kb-box" role="group" aria-label={label}>
        <p>None of your characters can post yet. <Link to="/characters/new">Make a character</Link>; one waiting to debut can post once it has.</p>
      </div>
    );
  }
  /* The thread is made: the player goes to it, and focus is on its ORIGIN when it opens. */
  const went = (thread: Id) => {
    onDraft?.(null);
    spunLoader(api).forget(origin);
    void refresh();
    expectOrigin(thread);
    navigate(`/t/${thread}`);
  };
  /* No answer came back: look for the thread before offering to spin it again. */
  const look = async (words: string | null, character: Id) => {
    let found: Id | undefined;
    let looked = true;
    try {
      found = (await api.spunFrom(origin)).find((t) => t.title.trim() === title.trim() && t.firstCharacter === character)?.id;
    } catch { looked = false; }
    if (found) { went(found); return; }
    setAgain(true);
    setRefusal(`${words ?? 'No answer came back.'} ${looked ? 'The thread is not there yet.' : 'The threads spun from this Act could not be checked.'} Press “Spin again anyway” to spin it again.`);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || title.trim() === '') return;
    if (who.changed) { who.confirm(); return; }
    const character = hudCharacter.id;
    setBusy(true);
    setRefusal(null);
    try {
      let answer;
      try { answer = await api.spin(origin, character, title, body); } catch { await look(null, character); return; }
      if (answer.ok) went(answer.value.thread.id);
      else if (answer.uncertain) await look(answer.error, character);
      else setRefusal(answer.error);
    } finally {
      setBusy(false);
    }
  };
  const edited = () => { if (again) { setAgain(false); setRefusal(null); } };
  /* Closing the form is throwing it away; moving to another origin's form is not a close (Post.tsx). */
  const dismiss = () => { onDraft?.(null); onClose(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } };
  const was = characters.find((c) => c.id === who.as)?.name ?? 'another character';

  return (
    <form className="kb-spin-form kb-box" aria-label={label} onSubmit={(e) => void submit(e)} onKeyDown={key} noValidate>
      <p className="kb-small">Spinning a thread from {named === null ? 'this Act' : <b>{named}</b>} as <strong>{hudCharacter.name}</strong></p>
      <div className="kb-spin-now-region" role="status">
        {who.changed && (
          <p className="kb-notice">
            <span>now posting as <strong>{hudCharacter.name}</strong></span>. This was started as {was}. Press the button to confirm, then spin, or switch back in the HUD.
          </p>
        )}
      </div>
      <div className="kb-field">
        <label htmlFor={`spin-title-${origin}`}>Thread title</label>
        <input ref={first} id={`spin-title-${origin}`} className="kb-input kb-spin-title" value={title} maxLength={settings.titleMaxLength} autoComplete="off" onChange={(e) => { setTitle(e.target.value); edited(); }} />
      </div>
      <div className="kb-field">
        <label htmlFor={`spin-body-${origin}`}>Your opening post (optional)</label>
        <textarea id={`spin-body-${origin}`} className="kb-textarea" rows={3} value={body} onChange={(e) => { setBody(e.target.value); edited(); }} />
        <span className="kb-small kb-muted kb-num">{[...body].length} of {settings.postMaxLength}</span>
      </div>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
      <div className="kb-spin-actions">
        <button type="submit" className="kb-button" data-kb-primary="" disabled={busy || title.trim() === '' || [...body].length > settings.postMaxLength}>
          {who.changed ? `Confirm posting as ${hudCharacter.name}` : again ? 'Spin again anyway' : 'Spin thread'}
        </button>
        <button type="button" className="kb-button" onClick={dismiss}>Cancel</button>
      </div>
    </form>
  );
}
