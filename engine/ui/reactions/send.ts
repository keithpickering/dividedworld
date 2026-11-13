/**
 * The one way a reaction is sent: the picker's path, which the reaction tiles take too, so the cap,
 * the refusal, the re-read of the player's own reactions and the estimate request are the same
 * wherever a reaction is pressed. `send` answers 'sent', the refusal to show, or 'busy' when one is
 * already in flight (the second press is dropped, never a second request); it also answers 'busy' with
 * no character to react as, where there is nothing to send.
 *
 * Call it once per Act: its lock is one per call, so a row of tiles and its picker share one hook.
 * `send` is a new function each render; do not hold it in a dependency list.
 */
import { useEffect, useRef, useState } from 'react';
import { useKayfa } from '../context.tsx';
import type { Id, MyCharacter } from '../data/api.ts';
import { usePlayer } from '../player.tsx';
import type { Tallies } from '../thread/tallies.ts';
import type { Mine } from './mine.ts';

export type SendAnswer = 'sent' | { readonly refusal: string } | 'busy';

interface Args {
  readonly act: Id;
  readonly as: MyCharacter | null;
  readonly tallies: Tallies;
  readonly mine: Mine;
}

export function useReactionSend({ act, as, tallies, mine }: Args): { send(kind: string): Promise<SendAnswer>; busy: boolean } {
  const { api } = useKayfa();
  const player = usePlayer();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const send = async (kind: string): Promise<SendAnswer> => {
    if (!as || sending.current) return 'busy';
    sending.current = true;
    setBusy(true);
    try {
      const answer = await api.react(act, as.id, kind);
      if (!answer.ok) {
        /* A refusal may mean what this screen holds is stale (another tab left that kind): read the player's own again. */
        try { mine.merge(act, await api.myReactions([act])); } catch { /* the server's words are the answer, whatever the re-read did */ }
        return { refusal: answer.error };
      }
      mine.add({ act, kind, character: as.id });
      /* A blind post answers no tally to anyone: the screen holds none of its totals. */
      if (answer.value.tally !== null) tallies.merge(act, answer.value.tally);
      player.reactionLanded();
      return 'sent';
    } catch {
      return { refusal: 'The reaction could not be sent. Try again.' };
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { send, busy };
}
