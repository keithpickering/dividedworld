/**
 * The new-thread form above a board's list: the title and the first post, sent as the HUD's
 * character. The character is never in the address; on success the player goes to the new thread.
 * A refusal is shown in the server's own words and the draft is kept.
 */
import { useId, useState, type FormEvent } from 'react';
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
    <form className="kb-box kb-new-thread" aria-labelledby={`${id}-head`} onSubmit={(e) => void submit(e)} noValidate>
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
            <input id={`${id}-title`} className="kb-input kb-new-thread-title" value={title} maxLength={settings.titleMaxLength} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
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
  );
}
