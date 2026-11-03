/**
 * A reveal of a character's own class, written once for the two dialogs that ask for it: the
 * board's (RevealModal.tsx, the composer's, in its own thread) and the glass's (RevealOverlay.tsx,
 * My characters', in a thread the player chooses). Each shell draws its world's controls around
 * this core, so neither world can say a reveal differently (the glass reveal design, §3). The
 * server checks the class and writes it; the dialogs only ask.
 */
import { useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, MyCharacter } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import { withArticle } from './format.ts';

/** The most characters of the character's own words, as the server holds them (0027_unmask.sql). */
export const MAX = 200;

/** The dialog's own words, which both shells show. */
export function revealWords(character: MyCharacter, className: string) {
  return {
    sentence: `${character.name} is ${withArticle(className)}. This shows everyone that, as checked by The System, as ${character.name}'s own post. Anyone can react to it or spin a thread from it, and this can't be taken back.`,
    pendingTurn: character.pendingTurn ? `${character.name} has a Turn waiting. This reveals the class it holds now, ${className}, as of today. If its settlement is due, a reveal waits until it has run.` : null,
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
    try {
      const answer = await api.unmask(character.id, thread, message);
      if (!answer.ok) { setRefusal(answer.error); return { ok: false }; }
      await refresh();
      return { ok: true, done: `${character.name} revealed as ${className} in ${threadTitle}.` };
    } catch {
      setRefusal('The reveal could not be sent. Check your connection and try again.');
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };

  return { className, message, setMessage, count, over, busy, refusal, setRefusal, submit };
}
