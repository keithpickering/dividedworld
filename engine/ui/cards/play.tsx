/**
 * What playing a card is, on a screen (the cards plan's Task 3; the screens' design, section 9):
 * which card is armed, whether the hand is open, and which play form is open.
 * The Frame holds it once, so the HUD's hand, a post's ghost mark ("Play Whoops! on post 41") and the form all read
 * the same state, and none of them owns another's.
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
import { useBoard } from '../glass/useBoard.ts';
import type { Act, Id } from '../data/api.ts';
import { PlayForm } from './PlayForm.tsx';
import type { Plays } from './plays.ts';

/** A post a card may be played on, with what the form says about it. */
export interface PlayTarget {
  readonly post: Act;
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
  /** Open the play form for a card on a post; the hand is put away. */
  readonly openForm: (card: string, target: PlayTarget) => void;
}

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
  const [armedHeld, setArmedHeld] = useState<{ readonly card: string; readonly for: Id | null } | null>(null);
  const [formHeld, setFormHeld] = useState<{ readonly card: string; readonly target: PlayTarget; readonly for: Id | null } | null>(null);
  const [saidHeld, setSaidHeld] = useState<{ readonly words: string; readonly for: Id | null }>({ words: '', for: null });
  const [handOpen, setHandOpenState] = useState(false);
  const armed = armedHeld?.for === account ? armedHeld.card : null;
  const form = formHeld?.for === account ? formHeld : null;
  const said = saidHeld.for === account ? saidHeld.words : '';
  const setArmed = useCallback((card: string | null) => setArmedHeld(card === null ? null : { card, for: accountNow.current }), []);
  const setSaid = useCallback((words: string) => setSaidHeld({ words, for: accountNow.current }), []);
  /* Read against the account in the commit it changes; dropped just after, so signing back in finds none of it. */
  useEffect(() => () => {
    setArmedHeld(null);
    setFormHeld(null);
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
  const arm = useCallback((card: string | null) => {
    const was = armedNow.current;
    setArmed(card);
    if (card !== null) setSaid(`${nameOf(card)} is armed. Press Play ${nameOf(card)} on a post, the dashed + mark beside its date, to play it there, or ${phone.current ? 'press Armed' : 'Esc'} to put it back.`);
    else if (was !== null) setSaid(`${nameOf(was)} is put back.`);
  }, [nameOf, setArmed, setSaid]);
  const openForm = useCallback((card: string, target: PlayTarget) => {
    setHandOpen(false);
    setFormHeld({ card, target, for: accountNow.current });
  }, [setHandOpen]);

  const controls = useMemo<PlayControls>(
    () => ({ armed, handOpen, setHandOpen, arm, openForm }),
    [armed, handOpen, setHandOpen, arm, openForm],
  );

  return (
    <Ctx.Provider value={controls}>
      {children}
      <p className="kb-visually-hidden" role="status" aria-label="Playing a card">{said}</p>
      {form && (
        <PlayForm
          card={form.card}
          target={form.target}
          onClose={() => setFormHeld(null)}
          onPlayed={() => {
            if (accountNow.current !== form.for) return;
            const target = form.target;
            setFormHeld(null);
            setArmed(null);
            setSaid(`Played ${nameOf(form.card)} on ${target.author}'s post #${target.post.seq}.`);
          }}
        />
      )}
    </Ctx.Provider>
  );
}
