/**
 * Blind Study's effect on a post (card notes Part 3, Task 11). The veil is the engine's: while it is up every read withholds the post's
 * reaction totals from all but its author and whoever played the card, and the reaction row says so itself (Task 8). So this draws its
 * children and nothing else, and tells the Lens which of the four states this reader is in: hidden from you, shown to you (the author, or
 * the caster), or showing once the play's `ends` has passed. The time is read against the clock (`useAt` redraws it when the end passes).
 */
import { useEffect, useRef } from 'react';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useAt } from '../../../../engine/ui/cards/plays.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';

export function BlindStudyEffect({ plays, reader, show, met, still, children }: EffectProps) {
  const play = plays.find((p) => !p.reversed && !p.untaken && !p.caught && !p.faceDown);
  const ends = play?.ends;
  const endsAt = ends === undefined ? Number.NaN : Date.parse(ends);
  const now = useAt(Number.isNaN(endsAt) ? [] : [endsAt]);
  const over = !Number.isNaN(endsAt) && endsAt <= now;
  const there = play !== undefined;
  const sees = reader.author || reader.caster;

  useEffect(() => {
    if (!there) { show(null); return; }
    show({
      progress: null,
      state: over ? 'Totals are showing' : sees ? 'Totals shown to you' : 'Totals hidden from you',
      ...(!over && ends !== undefined ? { ends: `${endsWords(ends)} The totals show then.` } : {}),
      yours: false,
      controls: [],
      notes: {},
    });
  }, [show, there, over, sees, ends]);
  useEffect(() => () => show(null), [show]);

  const met1 = useRef(false);
  useEffect(() => {
    if (still || !there || met1.current) return;
    met1.current = true;
    met();
  }, [met, still, there]);

  return <>{children}</>;
}
