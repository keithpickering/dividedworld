/**
 * The new-thread form above a board's list, behind a "Start a thread" button that opens it in place
 * (a disclosure: closed it takes one line, and the draft survives closing): the title and the first
 * post, sent as the HUD's character. The character is never in the address; on success the player goes to the new thread.
 * A refusal is shown in the server's own words and the draft is kept.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { Link, useNavigate } from '../router.tsx';

export function NewThread({ board }: { readonly board: string }) {
  const { api, settings } = useKayfa();
  const { hudCharacter, loaded, refresh } = usePlayer();
  const navigate = useNavigate();
  const id = useId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const titleBox = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  /* Opening puts the cursor in the title (or, with no character to post as, on the way to making one). */
  useEffect(() => {
    if (open) (titleBox.current ?? form.current?.querySelector<HTMLElement>('a'))?.focus();
  }, [open]);

  if (!loaded) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hudCharacter || busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.startThread(board, hudCharacter.id, title, body);
      if (!answer.ok) { setRefusal(answer.error); return; }
      void refresh();
      navigate(`/t/${answer.value.thread.id}`);
    } catch {
      setRefusal('The thread could not be started. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kb-new-thread-wrap">
      <button type="button" className="kb-button kb-new-thread-toggle" aria-expanded={open} aria-controls={`${id}-form`} onClick={() => setOpen(!open)}>Start a thread</button>
      <form id={`${id}-form`} ref={form} hidden={!open} className="kb-box kb-new-thread" aria-labelledby={`${id}-head`} onSubmit={(e) => void submit(e)} noValidate>
        <h2 className="kb-box-head" id={`${id}-head`}>Start a thread</h2>
        {!hudCharacter ? (
          <p className="kb-new-thread-none">
            None of your characters can post yet. <Link to="/characters/new">Make a character</Link>; one waiting to debut can post once it has.
          </p>
        ) : (
          <>
            <p className="kb-new-thread-as kb-small">Posting as <strong>{hudCharacter.name}</strong></p>
            <div className="kb-field">
              <label htmlFor={`${id}-title`}>Title</label>
              <input ref={titleBox} id={`${id}-title`} className="kb-input kb-new-thread-title" value={title} maxLength={settings.titleMaxLength} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="kb-field">
              <label htmlFor={`${id}-body`}>First post</label>
              <textarea id={`${id}-body`} className="kb-textarea kb-new-thread-body" rows={4} value={body} maxLength={settings.postMaxLength} onChange={(e) => setBody(e.target.value)} />
              <span className="kb-small kb-muted kb-num">{body.length} of {settings.postMaxLength}</span>
            </div>
            {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
            <button type="submit" className="kb-button" data-kb-primary="" disabled={busy}>Start thread</button>
          </>
        )}
      </form>
    </div>
  );
}
