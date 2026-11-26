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
import { framingArgs } from '../composer/text.ts';
import { useKayfa } from '../context.tsx';
import type { Id, SpinPlaces } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { CharactersFailed } from '../characters/CharactersFailed.tsx';
import { Link, useNavigate } from '../router.tsx';
import { expectOrigin, spunLoader } from './spun.ts';
import './spin.css';

/**
 * The server's refusal of a spin whose pressed post is not under the card (spin_written, 0351_spin_at_post.sql; the fake words it the same). The same words
 * whichever check failed, so a refusal in them with `at` sent means the card is no longer on that post.
 */
export const CARD_NOT_ON_POST = 'that card is not on that post';
/** What a spin form says in its place: out of character, and what to press. */
const NO_LONGER_ON_POST = 'That card is no longer on that post. Spin thread again to spin from the card without the post.';

/** What was typed in a spin form: the title and the opening post, and the slug of the board the player picked (none until one is picked). */
export interface SpinDraft { readonly title: string; readonly body: string; readonly board?: string }

/**
 * A post's spin drafts, one per origin (the post itself, or a play on it): the form is keyed by its origin and remounts
 * when it moves from the post to a play, so what was typed is kept here and not in the form (#100). A post that is gone
 * takes them with it; closing the form with Cancel or Esc throws that origin's away.
 */
export function useSpinDrafts(): { readonly get: (origin: Id) => SpinDraft | undefined; readonly set: (origin: Id, draft: SpinDraft | null) => void } {
  const drafts = useRef(new Map<Id, SpinDraft>());
  const get = useCallback((origin: Id) => drafts.current.get(origin), []);
  const set = useCallback((origin: Id, draft: SpinDraft | null) => { if (draft === null || (draft.title === '' && draft.body === '' && draft.board === undefined)) drafts.current.delete(origin); else drafts.current.set(origin, draft); }, []);
  return { get, set };
}

/**
 * `label` names the origin as the form says it: "post 41" for a post, "Mrs. Hooligan's Whoops!" for a card play
 * (the plays-on-a-post design, section 3); null for an Act with no such name ("this Act").
 */
export function SpinForm({ origin, label: named, at, onClose, draft, onDraft, apology }: {
  readonly origin: Id; readonly label: string | null; readonly onClose: () => void;
  /** The post this was pressed on (a card on a character's mark on its postbit): sent with the spin, which records it. Absent, the spin names no post. */
  readonly at?: Id;
  /**
   * Set, the form writes an apology: the origin is the move that bars the character, and sending goes through `apologize` (the spin of that move, with the bar the one
   * thing skipped) instead of `spin`. `to` names whom it is written to as the form says it ("the Boss", "a Mod").
   */
  readonly apology?: { readonly to: string };
  /** What was typed here before, and where to put each change (`useSpinDrafts`); a form with neither starts empty and keeps nothing. */
  readonly draft?: SpinDraft; readonly onDraft?: (draft: SpinDraft | null) => void;
}) {
  const { api, settings } = useKayfa();
  const { hudCharacter, characters, refresh, charactersFailed } = usePlayer();
  const navigate = useNavigate();
  const [title, setTitleNow] = useState(draft?.title ?? '');
  const [body, setBodyNow] = useState(draft?.body ?? '');
  const [picked, setPickedNow] = useState<string | undefined>(draft?.board);
  const keep = (next: { title: string; body: string; board: string | undefined }) => onDraft?.(next.board === undefined ? { title: next.title, body: next.body } : { title: next.title, body: next.body, board: next.board });
  const setTitle = (t: string) => { setTitleNow(t); keep({ title: t, body, board: picked }); };
  const setBody = (b: string) => { setBodyNow(b); keep({ title, body: b, board: picked }); };
  const setPicked = (slug: string) => { setPickedNow(slug); keep({ title, body, board: slug }); };
  /* The boards the form offers for this character: read on mount and when the HUD's character changes (the bars are the character's). A read that lands after either changed is dropped. */
  const [places, setPlaces] = useState<{ readonly for: string; readonly state: 'loading' | 'failed' | 'ready'; readonly value?: SpinPlaces }>({ for: '', state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [again, setAgain] = useState(false);
  /* The server refused the pressed post: the next spin is sent without it (the design's section 6), with what was typed kept. */
  const [noPost, setNoPost] = useState(false);
  useEffect(() => { setNoPost(false); }, [at]);
  const sentAt = noPost ? undefined : at;
  const first = useRef<HTMLInputElement>(null);
  const hud = hudCharacter?.id ?? null;
  const who = useWhoPosts(hud, title.trim() !== '' || body.trim() !== '');

  useEffect(() => { first.current?.focus(); }, []);
  useEffect(() => {
    if (hud === null) return undefined;
    setPlaces({ for: hud, state: 'loading' });
    /* A read lands only if the form is still on the character it was made for; the render treats any other character's answer as not read. */
    const land = (next: { readonly state: 'failed' } | { readonly state: 'ready'; readonly value: SpinPlaces }) => setPlaces((prev) => (prev.for === hud ? { for: hud, ...next } : prev));
    api.spinPlaces(origin, hud).then((value) => land({ state: 'ready', value }), () => land({ state: 'failed' }));
    return undefined;
  }, [api, origin, hud]);

  const label = apology ? 'Write an apology' : named === null ? 'Spin a thread' : `Spin a thread from ${named}`;
  const verb = apology ? 'Send apology' : 'Spin thread';
  if (!hudCharacter && charactersFailed) return <div className="kb-spin-form kb-box" role="group" aria-label={label}><CharactersFailed /></div>;
  if (!hudCharacter) {
    return (
      <div className="kb-spin-form kb-box" role="group" aria-label={label}>
        <p>None of your characters can post yet. <Link to="/characters/new">Make a character</Link>; a character waiting to debut can post after the debut.</p>
      </div>
    );
  }
  const reading = places.for !== hudCharacter.id || places.state === 'loading';
  const unread = !reading && places.state === 'failed';
  const list = !reading && places.state === 'ready' ? places.value ?? null : null;
  const choosable = (b: SpinPlaces['boards'][number]) => apology !== undefined || !b.barred;
  const entry = (slug: string | null | undefined) => (list === null || !slug ? undefined : list.boards.find((b) => b.slug === slug));
  const kept = entry(picked);
  const standing = entry(list?.default);
  /* The board the form would send: the player's pick if it can still be used, else today's board if it can, else none (the first, empty option). */
  const board = kept && choosable(kept) ? kept.slug : standing && choosable(standing) ? standing.slug : '';
  const anyOpen = list !== null && list.boards.some(choosable);
  const untilWords = (until: string | null) => (until === null ? 'a time not yet set' : `${new Date(Math.ceil(Date.parse(until) / 60_000) * 60_000).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  const note = list === null || board !== '' ? null
    : !anyOpen ? `${hudCharacter.name} is barred from posting on every board right now.`
      : standing && standing.barred ? `${hudCharacter.name} is barred from posting on ${standing.name} until ${untilWords(standing.until)}. Pick another board.` : null;
  const noteId = `spin-board-note-${origin}`;
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
    setRefusal(`${words ?? 'No answer came back.'} ${looked ? 'The thread is not there yet.' : 'The threads spun from this Act could not be checked.'} Press “${apology ? 'Send again anyway' : 'Spin again anyway'}” to ${apology ? 'send it' : 'spin it'} again.`);
  };
  /* A refusal that names a field is worded with that field's label, as the form shows it; any other reads as the server said it. */
  const fieldWords = (field: string | undefined) => (field === 'title' ? 'The thread title ' : field === 'body' ? (apology ? 'Your apology ' : 'Your opening post ') : '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || reading || (list !== null && board === '') || title.trim() === '') return;
    if (who.changed) { who.confirm(); return; }
    const character = hudCharacter.id;
    setBusy(true);
    setRefusal(null);
    try {
      let answer;
      try {
        /* A failed read sends no board: the server opens the thread where spins open by default. */
        const sendBoard = list !== null ? board : undefined;
        answer = await (apology ? (sendBoard === undefined ? api.apologize(origin, character, title, body, ...framingArgs(body)) : api.apologize(origin, character, title, body, framingArgs(body)[0], sendBoard))
          : sendBoard !== undefined ? api.spin(origin, character, title, body, framingArgs(body)[0], sentAt, sendBoard)
            : sentAt === undefined ? api.spin(origin, character, title, body, ...framingArgs(body)) : api.spin(origin, character, title, body, framingArgs(body)[0], sentAt));
      } catch { await look(null, character); return; }
      if (answer.ok) went(answer.value.thread.id);
      else if (answer.uncertain) await look(answer.error, character);
      else if (!apology && sentAt !== undefined && answer.error === CARD_NOT_ON_POST) { setNoPost(true); setRefusal(NO_LONGER_ON_POST); }
      else setRefusal(`${fieldWords(answer.field)}${answer.error}`);
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
      {apology
        ? <p className="kb-small">Writing an apology to {apology.to} as <strong>{hudCharacter.name}</strong>. It is a public thread, and {apology.to} reads it.</p>
        : <p className="kb-small">Spinning a thread from {named === null ? 'this Act' : <b>{named}</b>} as <strong>{hudCharacter.name}</strong></p>}
      <div className="kb-spin-now-region" role="status">
        {who.changed && (
          <p className="kb-notice">
            <span>now posting as <strong>{hudCharacter.name}</strong></span>. This was started as {was}. Press the button to confirm, then {apology ? 'send' : 'spin'}, or switch back in the HUD.
          </p>
        )}
      </div>
      {unread
        ? <p className="kb-small">The boards could not be read. The thread will open where spins open by default.</p>
        : (
          <div className="kb-field">
            <label htmlFor={`spin-board-${origin}`}>Board</label>
            <select id={`spin-board-${origin}`} className="kb-input" value={list === null ? '' : board} disabled={list === null} aria-describedby={note ? noteId : undefined} onChange={(e) => setPicked(e.target.value)}>
              {list === null ? <option value="">Loading boards…</option> : (
                <>
                  {board === '' && <option value="">Pick a board</option>}
                  {list.boards.map((b) => (
                    <option key={b.slug} value={b.slug} disabled={!choosable(b)}>
                      {b.barred && apology === undefined ? `${b.name} (barred until ${untilWords(b.until)})` : b.name}
                    </option>
                  ))}
                </>
              )}
            </select>
            {note && <p id={noteId} className="kb-small kb-muted">{note}</p>}
          </div>
        )}
      <div className="kb-field">
        <label htmlFor={`spin-title-${origin}`}>Thread title</label>
        <input ref={first} id={`spin-title-${origin}`} className="kb-input kb-spin-title" value={title} maxLength={settings.titleMaxLength} autoComplete="off" onChange={(e) => { setTitle(e.target.value); edited(); }} />
      </div>
      <div className="kb-field">
        <label htmlFor={`spin-body-${origin}`}>{apology ? 'Your apology' : 'Your opening post (optional)'}</label>
        <textarea id={`spin-body-${origin}`} className="kb-textarea" rows={3} value={body} onChange={(e) => { setBody(e.target.value); edited(); }} />
        <span className="kb-small kb-muted kb-num">{[...body].length} of {settings.postMaxLength}</span>
      </div>
      {refusal && <p role="alert" className="kb-notice" data-kb-tone="refusal">{refusal}</p>}
      <div className="kb-spin-actions">
        <button type="submit" className="kb-button" data-kb-primary="" disabled={busy || reading || (list !== null && board === '') || title.trim() === '' || (apology !== undefined && body.trim() === '') || [...body].length > settings.postMaxLength}>
          {who.changed ? `Confirm posting as ${hudCharacter.name}` : again ? (apology ? 'Send again anyway' : 'Spin again anyway') : verb}
        </button>
        <button type="button" className="kb-button" onClick={dismiss}>Cancel</button>
      </div>
    </form>
  );
}
