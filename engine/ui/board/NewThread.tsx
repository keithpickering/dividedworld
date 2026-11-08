/**
 * The new-thread form above a board's list, behind a "Start a thread" button that opens it in place
 * (a disclosure: closed it takes one line, and the draft survives closing): the title and the first
 * post, sent as the HUD's character. The character is never in the address; on success the player goes to the new thread.
 * A refusal is shown in the server's own words and the draft is kept.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { framingArgs } from '../composer/text.ts';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { BannedNote } from '../composer/BannedNote.tsx';
import { BarredNote, useBar } from '../composer/BarredNote.tsx';
import { useBannedUntil } from '../composer/ban.ts';
import { Editor } from '../composer/Editor.tsx';
import { Icon } from './Icons.tsx';
import { Link, useNavigate } from '../router.tsx';

export function NewThread({ board, boardId }: { readonly board: string; /** The board's id, which a bar names. */ readonly boardId: string }) {
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
  /* The same two notes the reply box says, so the two composers agree: a ban first, then a bar; either stands where the fields would be. */
  const bannedUntil = useBannedUntil(hudCharacter);
  const bar = useBar(hudCharacter, boardId);

  /* Opening puts the cursor in the title (or, with no character to post as, on the way to making one). */
  useEffect(() => {
    if (open) (titleBox.current ?? form.current?.querySelector<HTMLElement>('a'))?.focus();
  }, [open]);

  if (!loaded) return null;

  const over = [...body].length > settings.postMaxLength;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!hudCharacter || busy || over) return;
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.startThread(board, hudCharacter.id, title, body, ...framingArgs(body));
      if (!answer.ok) { setRefusal(answer.error); return; }
      void refresh();
      navigate(`/t/${answer.value.thread.id}`);
    } catch {
      setRefusal('The thread could not be started. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (
    <button type="button" className="kb-button kb-new-thread-toggle" aria-expanded={open} aria-controls={`${id}-form`} onClick={() => setOpen(!open)}>
      <Icon name="start" />Start a thread
    </button>
  );
  /* A ban or a bar stands where the fields would be. It is not a form: the barred box holds a form of its own, the apology, and a form may not hold one. */
  if (hudCharacter && (bannedUntil !== null || bar !== null)) {
    return (
      <div className="kb-new-thread-wrap">
        {toggle}
        <section id={`${id}-form`} hidden={!open} className="kb-box kb-form kb-new-thread" aria-labelledby={`${id}-head`}>
          <h2 className="kb-box-head" id={`${id}-head`}>Start a thread</h2>
          {bannedUntil !== null ? <BannedNote character={hudCharacter} until={bannedUntil} /> : <BarredNote key={bar!.move} character={hudCharacter} bar={bar!} />}
        </section>
      </div>
    );
  }
  return (
    <div className="kb-new-thread-wrap">
      {toggle}
      <form id={`${id}-form`} ref={form} hidden={!open} className="kb-box kb-form kb-new-thread" aria-labelledby={`${id}-head`} onSubmit={(e) => void submit(e)} noValidate>
        <h2 className="kb-box-head" id={`${id}-head`}>Start a thread</h2>
        {!hudCharacter ? (
          <p className="kb-new-thread-none">
            None of your characters can post yet. <Link to="/characters/new">Make a character</Link>; a character waiting to debut can post after the debut.
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
              <Editor id={`${id}-body`} label="First post" value={body} onChange={setBody} max={settings.postMaxLength} onSubmit={() => void submit()} submitVerb="starts it">
                <button type="submit" className="kb-button" data-kb-primary="" disabled={busy || over}>Start thread</button>
              </Editor>
            </div>
            {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
          </>
        )}
      </form>
    </div>
  );
}
