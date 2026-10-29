/**
 * The quick reply at the foot of a thread: a toolbar, the box, a preview in place, and a Send that
 * posts as the HUD's character. It names that character in bold. If the HUD's character changes
 * while something is written it says "now posting as ..." and the next Send press only confirms
 * (its way out: press again, or swap back in the HUD), because posting as the wrong mask is the one
 * mistake that unmasks a player. The draft is kept on the device per account and thread, and is
 * cleared when the reply is posted. A refusal is shown in the server's words and the draft stays.
 * On The System's board there is no reply box; a plain note says replies there are spins.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { parse } from '../../bbcode/parse.ts';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { draftKey, readDraft, useWhoPosts, writeDraft } from './draft.ts';
import { Editor, type EditorHandle } from './Editor.tsx';
import { quoteText } from './text.ts';

export interface ComposerHandle {
  /** Append a quote of an Act to the draft and move focus to the box. */
  quote(act: Id, body: string): void;
}

export interface ComposerProps {
  readonly thread: Id;
  /** The latest post of the thread, for the toolbar's Quote. */
  readonly latest: { readonly id: Id; readonly body: string } | null;
  readonly onPosted: (act: Act) => void;
  readonly ref?: Ref<ComposerHandle>;
}

/** The Act a draft quotes, if it quotes one: the first quote at the top of the draft. */
const firstQuote = (draft: string): Id | null => parse(draft).find((n) => n.type === 'quote')?.act ?? null;

export function Composer({ thread, latest, onPosted, ref }: ComposerProps) {
  const { api, settings } = useKayfa();
  const { hudCharacter, characters, session, loaded, refresh } = usePlayer();
  const account = session.account;
  const [text, setText] = useState('');
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const editor = useRef<EditorHandle>(null);
  const hud = hudCharacter?.id ?? null;
  const who = useWhoPosts(hud, text.trim() !== '');
  const key = account ? draftKey(account, thread) : null;

  /* The kept draft comes back once the account is known, with the character it was being written as. */
  const { adopt } = who;
  useEffect(() => {
    if (!key) return;
    const kept = readDraft(key);
    if (kept) { setText(kept.text); adopt(kept.as); }
    setRestored(true);
  }, [key, adopt]);
  const as = who.as;
  useEffect(() => {
    if (key && restored) writeDraft(key, { text, as });
  }, [key, restored, text, as]);

  const quote = useCallback((act: Id, body: string) => {
    const next = quoteText(textRef.current, act, body);
    setText(next);
    editor.current?.focus(next.length);
  }, []);
  const textRef = useRef(text);
  textRef.current = text;
  useImperativeHandle(ref, () => ({ quote }), [quote]);

  if (!loaded || !restored) return null;
  if (!hudCharacter) {
    return (
      <p className="kb-composer-note kb-notice">
        None of your characters can post yet. <Link to="/characters/new">Make a character</Link>; one waiting to debut can post once it has.
      </p>
    );
  }
  const nameOf = (id: Id | null) => characters.find((c) => c.id === id)?.name ?? 'another character';
  const over = [...text].length > settings.postMaxLength;
  const blank = text.trim() === '';

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || blank || over) return;
    if (who.changed) { who.confirm(); return; }
    setBusy(true);
    setRefusal(null);
    try {
      const answer = await api.post(thread, hudCharacter.id, text, firstQuote(text));
      if (!answer.ok) { setRefusal(answer.error); return; }
      setText('');
      void refresh();
      onPosted(answer.value);
    } catch {
      setRefusal('Your reply could not be sent. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="kb-composer kb-box" aria-labelledby={`composer-head-${thread}`} onSubmit={(e) => void submit(e)} noValidate>
      <div className="kb-box-head" id={`composer-head-${thread}`}>Reply</div>
      <p className="kb-composer-as kb-small" id={`composer-as-${thread}`}>Posting as <strong>{hudCharacter.name}</strong></p>
      {who.changed && (
        <p className="kb-notice kb-composer-now" role="status">
          <span>now posting as <strong>{hudCharacter.name}</strong></span>. This draft was started as {nameOf(who.as)}. Press the button to confirm, then Send, or switch back in the HUD.
        </p>
      )}
      <Editor
        ref={editor}
        label="Your reply"
        describedBy={`composer-as-${thread}`}
        value={text}
        onChange={setText}
        max={settings.postMaxLength}
        onQuote={latest ? () => quote(latest.id, latest.body) : undefined}
        onSubmit={() => void submit()}
      >
        <button type="submit" className="kb-button" data-kb-primary="" disabled={busy || blank || over}>
          {who.changed ? `Confirm posting as ${hudCharacter.name}` : 'Send'}
        </button>
      </Editor>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
    </form>
  );
}

/** What stands where the reply box would be on The System's board. */
export function SystemBoardNote() {
  return <p className="kb-composer-note kb-notice">Replies here are spins. Use “Spin thread” on any post to start a thread of your own from it.</p>;
}
