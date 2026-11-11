/**
 * What playing a card is, on a screen (the cards plan's Task 3; the screens' design, section 9):
 * which card is armed, whether the hand is open, and which play form is open.
 * The Frame holds it once, so the HUD's hand, a post's ghost mark ("Play Whoops! on post 41") and the form all read
 * the same state, and none of them owns another's.
 *
 * A card whose play is made on the post itself (`CardUi.Compose`) opens no form: its ghost mark mounts the card's own `Compose` in the post's effect
 * slot (Effects.tsx reads `compose` here), and the play lands through `submitCompose`, which shows its answer in the same status. One compose is open at
 * a time. Its ways out are Esc, its own Cancel, the armed card pressed again and arming another; each first asks, in the card's words, when the card
 * says it holds work (`hold`), and the browser asks the same before the page is left. Nothing of what is held is the engine's to know.
 *
 * One way leads to the form (the owner: a game act is glass, so no post's row offers "Play card"):
 * from the hand, picking a card arms it, every post it can land on shows a dashed + mark, "Play Whoops! on post N", and
 * pressing one opens the form on that post. An armed card is a state like any other and names its
 * way out: Esc, the armed card pressed again, or playing it.
 *
 * What the screen says it says twice, once for the eye and once to a screen reader in a status of
 * its own ("Playing a card"): that a card is armed, that it was put back, that it was played. The
 * form itself is `PlayForm`, opened here so it stands over whichever page the player is on, and so a
 * post that is no longer on screen when the play lands does not take the form down with it.
 *
 * All of it is the signed-in account's: the armed card, the open form and what was
 * said are kept with the account they were made for and read against the account signed in now, so
 * a switch (or a sign-out) takes them away in the very commit it happens, and an answer that comes
 * back for the other account changes nothing here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useKayfa } from '../context.tsx';
import { usePlayer } from '../player.tsx';
import { useNavigationGuard } from '../router.tsx';
import { useBoard } from '../glass/useBoard.ts';
import type { Act, Answer, Id } from '../data/api.ts';
import { PlayForm } from './PlayForm.tsx';
import { Overlay } from '../glass/Overlay.tsx';
import { ButtonRow, GlassButton } from '../glass/Button.tsx';
import { plainRefusal } from './faces.ts';
import type { Plays } from './plays.ts';
import type { PronounSet } from '../../rules/pronouns.ts';
import type { BeyondPost, EffectsAbove } from '../../rules/cards.ts';
import { Layers } from '../glass/layer.tsx';
import { PREPARED_FAILED, usePrepared } from '../glass/prepared.ts';

/** A post a card may be played on, with what the form says about it. */
export interface PlayTarget {
  /** The post the card goes on, or for a play beyond a post the post whose postbit took it (a character's); none for a thread's head or a board's banner. */
  readonly post: Act | null;
  /**
   * A play beyond a post (the card mechanic's design, section 7): the reach, its target, the target's name as the form says it ("Spritey",
   * "“Glitter everywhere”", "General"), and the live plays above it, which the card's rules see.
   */
  readonly reach?: { readonly reach: BeyondPost; readonly target: Id; readonly name: string; readonly pronouns?: PronounSet; readonly above?: EffectsAbove };
  /** Where focus goes when the form closes, for a target the form cannot find by its post's number (a thread's head, a board's banner). */
  readonly focusBack?: () => HTMLElement | null;
  /** The board the post's thread is on, whose plays above the post the form prices a cast against. */
  readonly board?: Id | null;
  /** The thread's title. */
  readonly title: string;
  /** The post's author's name, as the thread knows it. */
  readonly author: string;
  /** The post's own address, which the form links to. */
  readonly to: string;
  /** The plays on the posts on screen, for what the post already carries and for finding a play after a lost answer. */
  readonly plays: Plays;
  /** Have the thread read these characters, so a tag naming one is drawn with the name. */
  readonly know: (characters: readonly (Id | null)[]) => Promise<void>;
}

export interface PlayControls {
  /** The key of the armed card, if any. */
  readonly armed: string | null;
  readonly handOpen: boolean;
  /** The HUD's hand button, and every other way the hand opens or closes. */
  readonly setHandOpen: (open: boolean) => void;
  /** Arm a card, or put the armed one back (null). */
  readonly arm: (card: string | null) => void;
  /** The armed Move is set face down rather than cast (the choice at the top of its form on one's own post); a post's ghost is named by it. Always false for a card that is not a Move, and when nothing is armed. */
  readonly faceDown: boolean;
  /** Choose between playing the armed card now and setting it face down. */
  readonly choose: (faceDown: boolean) => void;
  /**
   * Open the play form for a card on a post; the hand is put away. The post is read first and the form opens once it has landed
   * (`opening` says which trigger waits); Escape cancels the wait.
   */
  readonly openForm: (card: string, target: PlayTarget) => void;
  /** The pointer's rest or focus on a trigger: read the post early, so the press that follows opens the form at once. */
  readonly readyForm: (card: string, target: PlayTarget) => void;
  /** Whether the form this trigger would open is being read for now. */
  readonly opening: (card: string, target: PlayTarget) => boolean;
  /** The play being made on a post itself, or null; the post's effect slot mounts the card's `Compose` for it. */
  readonly compose: Composing | null;
  /** Open a compose on a post (replacing one already open, after its ask). */
  readonly openCompose: (card: string, target: PlayTarget, mode: 'cast' | 'set') => void;
  /** Land the compose's play, as PlayForm does: the answer, or the refusal, which leaves the compose open. */
  readonly submitCompose: (config: unknown, first: unknown) => Promise<Answer<unknown>>;
  /** A way out of the compose, asking first when the card holds work. */
  readonly cancelCompose: () => void;
  /** The card says whether it holds work leaving would lose: its question, or null. */
  readonly holdCompose: (ask: string | null) => void;
  /** The compose's slot is gone (its post left the screen): the compose ends with it, with no ask the page could not wait for. */
  readonly dropCompose: (composing: Composing) => void;
}

/** The one play being made on a post itself (`CardUi.Compose`). */
export interface Composing {
  readonly card: string;
  readonly mode: 'cast' | 'set';
  readonly target: PlayTarget;
}

/** What a trigger reads for: the card and the target's own id. */
const askOf = (card: string, target: PlayTarget): string => `${card}:${target.reach ? target.reach.target : target.post?.id ?? ''}`;
interface Ask { readonly card: string; readonly target: PlayTarget }

const Ctx = createContext<PlayControls | null>(null);

/** The play controls, or null outside the Frame (a thread drawn on its own offers no card to play). */
export function usePlay(): PlayControls | null {
  return useContext(Ctx);
}

export function PlayProvider({ children }: { readonly children: ReactNode }) {
  const { instance } = useKayfa();
  const account = usePlayer().session.account;
  /* The account the screen is on now, for the callbacks that outlive a render. */
  const accountNow = useRef(account);
  accountNow.current = account;
  /* Each is kept with the account it was made for, and reads as nothing under another: in the commit the account changes, not after it (the clearing effect below runs after that commit, and a render between would show the other account's card; play.test.tsx pins it). */
  const [armedHeld, setArmedHeld] = useState<{ readonly card: string; readonly for: Id | null; readonly faceDown: boolean } | null>(null);
  const [formHeld, setFormHeld] = useState<{ readonly card: string; readonly target: PlayTarget; readonly for: Id | null; readonly read: readonly Act[] } | null>(null);
  const [saidHeld, setSaidHeld] = useState<{ readonly words: string; readonly for: Id | null }>({ words: '', for: null });
  const [handOpen, setHandOpenState] = useState(false);
  const { api } = useKayfa();
  const player = usePlayer();
  /* The compose is the account's like the form: kept with it, and read as nothing under another. `ask` is the card's question while it holds work. */
  const [composeHeld, setComposeHeld] = useState<(Composing & { readonly for: Id | null }) | null>(null);
  const [askHeld, setAskHeld] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<{ readonly ask: string; readonly then: () => void } | null>(null);
  const compose = composeHeld?.for === account ? composeHeld : null;
  const composeNow = useRef(compose);
  composeNow.current = compose;
  const askNow = useRef(askHeld);
  askNow.current = askHeld;
  const playerNow = useRef(player);
  playerNow.current = player;
  const sending = useRef<Promise<Answer<unknown>> | null>(null);
  /* The post is read before the form opens, so the form's first render holds the post as it stands. A target without a post (a thread's head, a board's banner) reads nothing. */
  const prepared = usePrepared<readonly Act[], Ask>(
    (_signal, ask) => (ask.target.post ? Promise.resolve(api.actsById([ask.target.post.id])) : Promise.resolve([])),
    (ask) => askOf(ask.card, ask.target),
  );
  const [reading, setReading] = useState<string | null>(null);
  const armed = armedHeld?.for === account ? armedHeld.card : null;
  const form = formHeld?.for === account ? formHeld : null;
  const said = saidHeld.for === account ? saidHeld.words : '';
  const setArmed = useCallback((card: string | null) => setArmedHeld(card === null ? null : { card, for: accountNow.current, faceDown: false }), []);
  const faceDown = armedHeld?.for === account && armedHeld.faceDown;
  const choose = useCallback((down: boolean) => setArmedHeld((held) => (held ? { ...held, faceDown: down } : held)), []);
  const setSaid = useCallback((words: string) => setSaidHeld({ words, for: accountNow.current }), []);
  /* Read against the account in the commit it changes; dropped just after, so signing back in finds none of it. */
  useEffect(() => () => {
    setArmedHeld(null);
    setFormHeld(null);
    setComposeHeld(null);
    setAskHeld(null);
    setLeaving(null);
    setSaidHeld({ words: '', for: null });
    setHandOpenState(false);
  }, [account]);
  /* Which way out the status line names: on the Phone board's layout the hand button turns into Armed and puts the card back (#80), where a wide screen has Esc. */
  const { board } = useBoard();
  const phone = useRef(board === 'phone');
  phone.current = board === 'phone';
  const nameOf = useCallback((card: string) => instance.cards.find((c) => c.key === card)?.name ?? card, [instance]);
  /* Read by the callbacks below without making each of them a new function when the state moves. */
  const armedNow = useRef(armed);
  armedNow.current = armed;

  const setHandOpen = setHandOpenState;
  /** Run `then` now, or after the player answers the card's question when it holds work: Leave runs it, Stay drops it. */
  const leave = useCallback((then: () => void) => {
    const ask = askNow.current;
    if (composeNow.current === null || ask === null) { then(); return; }
    setLeaving({ ask, then });
  }, []);
  const endCompose = useCallback((refocus: boolean) => {
    const was = composeNow.current;
    setComposeHeld(null);
    setAskHeld(null);
    askNow.current = null;
    composeNow.current = null;
    if (refocus && was?.target.post) {
      const seq = was.target.post.seq;
      setTimeout(() => document.querySelector<HTMLElement>(`#post-${seq} .kb-ghost-mark`)?.focus(), 0);
    }
  }, []);
  const arm = useCallback((card: string | null) => {
    if (composeNow.current !== null && card !== composeNow.current.card) {
      leave(() => { endCompose(false); arm(card); });
      return;
    }
    const was = armedNow.current;
    setArmed(card);
    if (card !== null) setSaid(`${nameOf(card)} is armed. Press Play ${nameOf(card)} on a post, the dashed + mark beside its date, to play it there, or ${phone.current ? 'press Armed' : 'Esc'} to put it back.`);
    else if (was !== null) setSaid(`${nameOf(was)} is put back.`);
  }, [nameOf, setArmed, setSaid, leave, endCompose]);
  const { open: readOpen, early: readEarly, busy: readBusy, failed: readFailed } = prepared;
  const openForm = useCallback((card: string, target: PlayTarget) => {
    const key = askOf(card, target);
    if (readBusy && reading === key) return;
    setHandOpen(false);
    setReading(key);
    const owner = accountNow.current;
    void readOpen({ card, target }).then((acts) => {
      if (acts === null || accountNow.current !== owner) return;
      setFormHeld({ card, target, for: owner, read: acts });
    });
  }, [setHandOpen, readOpen, readBusy, reading]);
  const readyForm = useCallback((card: string, target: PlayTarget) => readEarly({ card, target }), [readEarly]);
  const opening = useCallback((card: string, target: PlayTarget) => readBusy && reading === askOf(card, target), [readBusy, reading]);
  /* A read that failed is said to a screen reader in the status the form's states use, until the next press. */
  useEffect(() => { if (readFailed) setSaid(PREPARED_FAILED); }, [readFailed, setSaid]);

  const openCompose = useCallback((card: string, target: PlayTarget, mode: 'cast' | 'set') => {
    const same = composeNow.current;
    if (same && same.card === card && same.target.post?.id === target.post?.id && same.mode === mode) return;
    setHandOpen(false);
    const open = () => {
      endCompose(false);
      setComposeHeld({ card, target, mode, for: accountNow.current });
      setSaid(`${nameOf(card)} is open on ${target.author}'s post #${target.post?.seq ?? ''}. Esc leaves it.`);
    };
    if (same) leave(open); else open();
  }, [setHandOpen, endCompose, leave, nameOf, setSaid]);
  const cancelCompose = useCallback(() => leave(() => endCompose(true)), [leave, endCompose]);
  const holdCompose = useCallback((ask: string | null) => { askNow.current = ask; setAskHeld(ask); }, []);
  const dropCompose = useCallback((gone: Composing) => {
    const now = composeNow.current;
    if (now && now.card === gone.card && now.mode === gone.mode && now.target.post?.id === gone.target.post?.id) endCompose(false);
  }, [endCompose]);
  const submitCompose = useCallback((config: unknown, first: unknown): Promise<Answer<unknown>> => {
    /* One play at a time: a press while one is out is the same press. */
    if (sending.current) return sending.current;
    const c = composeNow.current;
    const p = playerNow.current;
    if (!c || !c.target.post) return Promise.resolve({ ok: false, error: 'there is nothing open to play' });
    const post = c.target.post;
    const who = c.mode === 'set' ? p.actingCharacters.find((a) => a.id === post.character) ?? p.hudCharacter : p.hudCharacter;
    if (!who) return Promise.resolve({ ok: false, error: 'choose a character to play as' });
    const owner = accountNow.current;
    const what = (config ?? {}) as Readonly<Record<string, unknown>>;
    const run = (async (): Promise<Answer<unknown>> => {
      let answer: Answer<Act>;
      try {
        answer = c.mode === 'set' ? await api.setCard(c.card, who.id, post.id, what, undefined, first) : await api.playCard(c.card, who.id, post.id, what, '', undefined, undefined, first);
      } catch {
        return { ok: false, error: 'no answer came back, so the play may or may not have gone through', uncertain: true };
      }
      if (accountNow.current !== owner) return answer;
      if (!answer.ok) { setSaid(plainRefusal(answer.error)); return answer; }
      const act = answer.value;
      try {
        await c.target.know([act.character]);
        c.target.plays.add([act]);
        if (act.kind === 'set') c.target.plays.setFaces(await api.myFaceDown([act.id]).catch(() => ({})));
        await playerNow.current.refresh();
      } catch { /* the play has landed; the page catches up from its channel */ }
      if (accountNow.current !== owner) return answer;
      endCompose(true);
      setArmed(null);
      setSaid(`${c.mode === 'set' ? 'Set' : 'Played'} ${nameOf(c.card)} ${c.mode === 'set' ? 'face down ' : ''}on ${c.target.author}'s post #${post.seq ?? ''}.`);
      return answer;
    })();
    sending.current = run;
    const done = () => { sending.current = null; };
    void run.then(done, done);
    return run;
  }, [api, endCompose, nameOf, setArmed, setSaid]);
  /* Esc leaves a compose before anything else answers it (the armed card's own Esc, a Lens): captured at the window so it comes first. */
  const open = compose !== null;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat || e.isComposing || e.defaultPrevented) return;
      /* A dialog above it (the leave question itself, a Lens) answers its own Esc. */
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelCompose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, cancelCompose]);
  /* A link or Back while work is held asks the same question, and Leave goes on. */
  const guard = useCallback((proceed: () => void): boolean => {
    const ask = askNow.current;
    if (composeNow.current === null || ask === null) return false;
    setLeaving({ ask, then: () => { endCompose(false); proceed(); } });
    return true;
  }, [endCompose]);
  useNavigationGuard(guard);
  /* Leaving the page with work held is the browser's question. */
  const holding = compose !== null && askHeld !== null;
  useEffect(() => {
    if (!holding) return undefined;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [holding]);

  const controls = useMemo<PlayControls>(
    () => ({ armed, handOpen, setHandOpen, arm, faceDown, choose, openForm, readyForm, opening, compose, openCompose, submitCompose, cancelCompose, holdCompose, dropCompose }),
    [armed, handOpen, setHandOpen, arm, faceDown, choose, openForm, readyForm, opening, compose, openCompose, submitCompose, cancelCompose, holdCompose, dropCompose],
  );

  return (
    <Ctx.Provider value={controls}>
      {children}
      <p className="kb-visually-hidden" role="status" aria-label="Playing a card">{said}</p>
      <Layers>
      {leaving && (
        <Overlay title="Leave?" surface="play" className="kb-play-dialog" onClose={() => setLeaving(null)}>
          <div className="kb-play">
            <div className="kb-play-fields"><p>{leaving.ask}</p></div>
            <ButtonRow>
              <GlassButton kind="primary" onClick={() => { const then = leaving.then; setLeaving(null); then(); }}>Leave</GlassButton>
              <GlassButton onClick={() => setLeaving(null)}>Stay</GlassButton>
            </ButtonRow>
          </div>
        </Overlay>
      )}
      {form && (
        <PlayForm
          card={form.card}
          target={form.target}
          seen={form.read}
          faceDown={faceDown && armed === form.card}
          onChoose={choose}
          onClose={() => { setFormHeld(null); prepared.cancel(); }}
          onPlayed={() => {
            if (accountNow.current !== form.for) return;
            const target = form.target;
            setFormHeld(null);
            prepared.cancel();
            setArmed(null);
            setSaid(`Played ${nameOf(form.card)} on ${target.reach ? target.reach.name : `${target.author}'s post #${target.post?.seq ?? ''}`}.`);
          }}
        />
      )}
      </Layers>
    </Ctx.Provider>
  );
}
