/**
 * The quick reply at the foot of a thread: a toolbar, the box, a preview in place, and a Send that
 * posts as the HUD's character. It names that character in bold. If the HUD's character changes
 * while something is written it says "now posting as ..." and the next Send press only confirms
 * (its way out: press again, or swap back in the HUD), because posting as the wrong mask is the one
 * mistake that unmasks a player. The draft is kept on the device per account and thread (and
 * followed between tabs), and is cleared when the reply is posted, unless more was typed while the
 * send was on its way. A refusal is shown in the server's words and the draft stays.
 *
 * An answer that never came back may mean the reply went through, and Acts are append-only, so a
 * blind second press would post it twice. The box first looks at the thread's tail for this
 * character's reply with these words: if it is there the draft is cleared and the post shown; if
 * not, the draft stays and the next press says "Send again anyway".
 *
 * On The System's board there is no reply box; a plain note says replies there are spins.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from 'react';
import { parse } from '../../bbcode/parse.ts';
import { RevealDialog } from '../characters/RevealDialog.tsx';
import { useKayfa } from '../context.tsx';
import type { Act, Id } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { Link } from '../router.tsx';
import { text as textOf } from '../thread/lines.tsx';
import { draftKey, readDraft, useWhoPosts, writeDraft } from './draft.ts';
import { Editor, type EditorHandle } from './Editor.tsx';
import { quoteText } from './text.ts';

export interface ComposerHandle {
  /** Append a quote of an Act to the draft and move focus to the box. */
  quote(act: Id, body: string): void;
}

export interface ComposerProps {
  readonly thread: Id;
  /** The last post shown, for the toolbar's Quote. */
  readonly latest: { readonly id: Id; readonly body: string } | null;
  /** The thread's last known seq now: where to look for a reply whose answer was lost. */
  readonly since: () => number;
  readonly onPosted: (act: Act) => void;
  readonly ref?: Ref<ComposerHandle>;
}

/** How far past the last known seq a lost reply is looked for. */
const LOOK_AHEAD = 200;

/** The Act a draft quotes, if it quotes one: the first quote at the top of the draft. */
const firstQuote = (draft: string): Id | null => parse(draft).find((n) => n.type === 'quote')?.act ?? null;

/** The box, keyed to the account and the thread it writes under: a change of either starts a fresh one. */
export function Composer(props: ComposerProps) {
  const { session, loaded } = usePlayer();
  if (!loaded) return null;
  if (!session.account) {
    return <p className="kb-composer-note kb-notice">Your account is not open yet, so there is no one to reply as. Opening it takes an invite.</p>;
  }
  return <ComposerBody key={`${session.account}:${props.thread}`} {...props} account={session.account} />;
}

function ComposerBody({ thread, latest, since, onPosted, ref, account }: ComposerProps & { readonly account: Id }) {
  const { api, settings } = useKayfa();
  const { hudCharacter, characters, refresh } = usePlayer();
  const [text, setText] = useState('');
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  /* The last send got no answer and the thread does not hold it: the next press sends anyway. */
  const [again, setAgain] = useState(false);
  /* The last quote took the draft over the longest post. */
  const [quoted, setQuoted] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const [revealing, setRevealing] = useState(false);
  const hud = hudCharacter?.id ?? null;
  const who = useWhoPosts(hud, text.trim() !== '');
  const key = draftKey(account, thread);

  /* The kept draft comes back with the character it was being written as. */
  const { adopt } = who;
  useEffect(() => {
    const kept = readDraft(key);
    if (kept) { setText(kept.text); adopt(kept.as); }
    setRestored(true);
  }, [key, adopt]);
  const as = who.as;
  useEffect(() => {
    if (restored) writeDraft(key, { text, as });
  }, [key, restored, text, as]);

  /* The same draft in another tab: what it keeps or clears here is kept or cleared. */
  useEffect(() => {
    const heard = (e: StorageEvent) => {
      if (e.key !== key) return;
      const kept = readDraft(key);
      setText(kept?.text ?? '');
      if (kept) adopt(kept.as);
      setAgain(false);
    };
    window.addEventListener('storage', heard);
    return () => window.removeEventListener('storage', heard);
  }, [key, adopt]);

  const max = settings.postMaxLength;
  const textRef = useRef(text);
  textRef.current = text;
  const quote = useCallback((act: Id, body: string) => {
    const was = textRef.current;
    const next = quoteText(was, act, body);
    if ([...was].length <= max && [...next].length > max) setQuoted(true);
    editor.current?.set(next);
  }, [max]);
  useImperativeHandle(ref, () => ({ quote }), [quote]);

  const over = [...text].length > max;
  useEffect(() => { if (!over) setQuoted(false); }, [over]);

  if (!restored) return null;
  if (!hudCharacter) {
    return (
      <p className="kb-composer-note kb-notice">
        None of your characters can post yet. <Link to="/characters/new">Make a character</Link>; one waiting to debut can post once it has.
      </p>
    );
  }
  const nameOf = (id: Id | null) => characters.find((c) => c.id === id)?.name ?? 'another character';
  const blank = text.trim() === '';

  const change = (next: string) => {
    setText(next);
    if (again) { setAgain(false); setRefusal(null); }
  };
  /* The reply is in the thread: what was sent leaves the box, and what was typed since stays. */
  const landed = (act: Act, sent: string) => {
    setText((now) => (now === sent ? '' : now));
    setAgain(false);
    setRefusal(null);
    void refresh();
    onPosted(act);
  };
  /* No answer came back: look for the reply before offering to send it again. */
  const look = async (words: string | null, from: number, sent: string, character: Id) => {
    let found: Act | undefined;
    let looked = true;
    try {
      const acts = await api.acts(thread, from + 1, from + LOOK_AHEAD);
      found = acts.find((a) => a.kind === 'post' && a.character === character && textOf(a.payload.body) === sent);
    } catch { looked = false; }
    if (found) { landed(found, sent); return; }
    setAgain(true);
    setRefusal(`${words ?? 'No answer came back.'} ${looked ? 'Your reply is not in the thread yet.' : 'The thread could not be checked for it.'} Press “Send again anyway” to post it again.`);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || blank || over) return;
    if (who.changed) { who.confirm(); return; }
    const sent = text;
    const character = hudCharacter.id;
    const from = since();
    setBusy(true);
    setRefusal(null);
    try {
      let answer;
      try { answer = await api.post(thread, character, sent, firstQuote(sent)); } catch { await look(null, from, sent, character); return; }
      if (answer.ok) landed(answer.value, sent);
      else if (answer.uncertain) await look(answer.error, from, sent, character);
      else setRefusal(answer.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="kb-composer kb-box" aria-labelledby={`composer-head-${thread}`} onSubmit={(e) => void submit(e)} noValidate>
      <div className="kb-box-head" id={`composer-head-${thread}`}>Reply</div>
      <p className="kb-composer-as kb-small" id={`composer-as-${thread}`}>Posting as <strong>{hudCharacter.name}</strong></p>
      <div className="kb-composer-now-region" role="status">
        {who.changed && (
          <p className="kb-notice kb-composer-now">
            <span>now posting as <strong>{hudCharacter.name}</strong></span>. This draft was started as {nameOf(who.as)}. Press the button to confirm, then Send, or switch back in the HUD.
          </p>
        )}
      </div>
      <Editor
        ref={editor}
        label="Your reply"
        describedBy={`composer-as-${thread}`}
        value={text}
        onChange={change}
        max={max}
        note={quoted && over ? 'The quote made this reply too long to send. Trim it to fit.' : null}
        onQuote={latest ? () => quote(latest.id, latest.body) : undefined}
        onSubmit={() => void submit()}
      >
        <button type="submit" className="kb-button" data-kb-primary="" disabled={busy || blank || over}>
          {who.changed ? `Confirm posting as ${hudCharacter.name}` : again ? 'Send again anyway' : 'Send'}
        </button>
        <button type="button" className="kb-button kb-composer-reveal" onClick={() => setRevealing(true)}>Reveal…</button>
      </Editor>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
      {revealing && <RevealDialog character={hudCharacter} thread={thread} onClose={() => setRevealing(false)} />}
    </form>
  );
}

/** What stands where the reply box would be on The System's board. */
export function SystemBoardNote() {
  return <p className="kb-composer-note kb-notice">Replies here are spins. Use “Spin thread” on any post to start a thread of your own from it.</p>;
}
