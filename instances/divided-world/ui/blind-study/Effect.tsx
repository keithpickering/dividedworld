/**
 * Blind Study's effect on a post (card notes Part 3, Task 11). The veil is the engine's: while it is up every read withholds the post's
 * reaction totals from all but its author and whoever played the card, and the reaction row says so itself (Task 8). So this draws its
 * children and nothing else, and tells the Lens which of the four states this reader is in: hidden from you, shown to you (the author, or
 * the caster). It gives a view only while the play is live: once its `ends` has passed it gives none and the engine's own heading for a spent kind
 * stands (spent-marks design, section 3). The time is read against the clock (`useAt` redraws it when the end passes).
 */
import { useEffect, useRef } from 'react';
import type { EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useAt } from '../../../../engine/ui/cards/plays.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';

export function BlindStudyEffect({ plays, reader, show, met, moment, children }: EffectProps) {
  const play = plays.find((p) => !p.reversed && !p.untaken && !p.caught && !p.faceDown);
  const ends = play?.ends;
  const endsAt = ends === undefined ? Number.NaN : Date.parse(ends);
  /*
   * The hook is always called. In a play's moment the time is the moment's, which does not advance (the engine drops a play whose end is not after
   * it before drawing), so the play is up whatever today's clock says (`docs/plans/2026-11-16-playable-moments-design.md`, section 3).
   */
  const clock = useAt(Number.isNaN(endsAt) || moment !== null ? [] : [endsAt]);
  const now = moment?.at ?? clock;
  const over = !Number.isNaN(endsAt) && endsAt <= now;
  const there = play !== undefined;
  const sees = reader.author || reader.caster;

  useEffect(() => {
    if (!there || over) { show(null); return; }
    show({
      progress: null,
      state: sees ? 'Totals shown to you' : 'Totals hidden from you',
      ...(ends !== undefined ? { ends: `${endsWords(ends, now)} The totals show then.` } : {}),
      yours: false,
      controls: [],
      notes: {},
    });
  }, [show, there, over, sees, ends]);
  useEffect(() => () => show(null), [show]);

  /* The reader has met the card when its post is first drawn with the veil up; a play already over, and a moment, meet nothing. */
  const met1 = useRef(false);
  useEffect(() => {
    if (moment !== null || !there || over || met1.current) return;
    met1.current = true;
    met();
  }, [met, moment, there, over]);

  return <>{children}</>;
}
