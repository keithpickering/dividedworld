/**
 * The small form under an Act that starts a thread from it: a title and an optional opening post,
 * sent as the HUD's character. Like the reply box it names that character, and a swap of the HUD's
 * character while something is written needs the button pressed again. On success the player goes
 * to the new thread, which opens on its ORIGIN box, with focus on it. A refusal is shown in the
 * server's words and the form keeps what was written. Esc closes it. An answer that never came back
 * is looked for among the threads spun from this Act (this title, by this character) before the
 * spin is offered again ("Spin again anyway"): a spin is an Act, and a blind resend is a second one.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useWhoPosts } from '../composer/draft.ts';
import { useKayfa } from '../context.tsx';
import type { Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Link, useNavigate } from '../router.tsx';
import { expectOrigin, spunLoader } from './spun.ts';
import './spin.css';

export function SpinForm({ origin, seq, onClose }: { readonly origin: Id; readonly seq: number | null; readonly onClose: () => void }) {
  const { api, settings } = useKayfa();
  const { hudCharacter, characters, refresh } = usePlayer();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const hud = hudCharacter?.id ?? null;
  const who = useWhoPosts(hud, title.trim() !== '' || body.trim() !== '');

  useEffect(() => { first.current?.focus(); }, []);

  const label = seq === null ? 'Spin a thread' : `Spin a thread from post ${seq}`;
  if (!hudCharacter) {
    return (
      <div className="kb-spin-form kb-box" role="group" aria-label={label}>
        <p>None of your characters can post yet. <Link to="/characters/new">Make a character</Link>; one waiting to debut can post once it has.</p>
      </div>
    );
  }
  /* The thread is made: the player goes to it, and focus is on its ORIGIN when it opens. */
  const went = (thread: Id) => {
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
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
  const was = characters.find((c) => c.id === who.as)?.name ?? 'another character';

  return (
    <form className="kb-spin-form kb-box" aria-label={label} onSubmit={(e) => void submit(e)} onKeyDown={key} noValidate>
      <p className="kb-small">Spinning a thread from {seq === null ? 'this Act' : <b>post {seq}</b>} as <strong>{hudCharacter.name}</strong></p>
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
        <button type="button" className="kb-button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
