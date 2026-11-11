/**
 * A reveal of a character's own class: the rules of one dialog, RevealOverlay.tsx, which has two
 * openers: the HUD's "Only you see this" (on a thread, so it opens ready) and My characters (a
 * thread the player chooses). The board's reply box has no Reveal of its own. The server checks
 * the class and writes it; the dialog only asks.
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import { LOST_ANSWER, type Id, type MyCharacter } from '../data/api.ts';
import { words } from '../../rules/pronouns.ts';
import { usePlayer } from '../player.tsx';
import { withArticle } from './format.ts';

/** The most characters of the character's own words, as the server holds them (0027_unmask.sql). */
export const MAX = 200;

/** Added to a done line when the write landed and the player's rows could not be read again. */
export const STALE_PAGE = ' This page may be out of date until you reload it.';

/** The dialog's own words, which both shells show. */
export function revealWords(character: MyCharacter, className: string, gameWord: string) {
  const w = words(character.pronouns);
  return {
    sentence: `${character.name} is ${withArticle(className)}. This shows everyone that, as checked by ${gameWord}, as ${character.name}'s own post. Anyone can react to it or spin a thread from it, and this can't be taken back.`,
    pendingTurn: character.pendingTurn ? `${character.name} has a Turn waiting. This reveals the class ${w.they} hold${w.s} now, ${className}, as of today. If the settlement is due, a reveal waits until it has run.` : null,
    button: `Reveal ${character.name} as ${withArticle(className)}`,
  };
}

export type RevealOutcome = { readonly ok: true; readonly done: string } | { readonly ok: false };

export function useReveal(character: MyCharacter) {
  const { api, instance } = useKayfa();
  const { refresh } = usePlayer();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const className = instance.classes.find((c) => c.key === character.class)?.name ?? character.class;
  const count = [...message].length;
  const over = count > MAX;

  /* Called once a thread is known and the message fits; a press while one is sent does nothing. */
  const submit = async (thread: Id, threadTitle: string): Promise<RevealOutcome> => {
    if (over || busy) return { ok: false };
    setBusy(true);
    setRefusal(null);
    let answer;
    try {
      answer = await api.unmask(character.id, thread, message);
    } catch {
      /* The adapter does not throw; if the call did, nothing says it did not go through. */
      setRefusal(LOST_ANSWER);
      setBusy(false);
      return { ok: false };
    }
    if (!answer.ok) { setRefusal(answer.error); setBusy(false); return { ok: false }; }
    /* Written: the dialog ends, so the button stays busy and a second press cannot send a second reveal. */
    const fresh = await refresh();
    return { ok: true, done: `${character.name} revealed as ${className} in ${threadTitle}.${fresh ? '' : STALE_PAGE}` };
  };

  return { className, message, setMessage, count, over, busy, refusal, setRefusal, submit };
}
