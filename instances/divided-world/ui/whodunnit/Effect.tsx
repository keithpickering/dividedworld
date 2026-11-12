/**
 * Whodunnit?'s effect on a post (card notes Part 3, Task 11). The veil itself is the engine's: while it is up every read gives the post's
 * author as the instance's stand-in, so this draws nothing over the words. It tells the Lens the three views (hidden for everyone, the
 * author told it is their post, and the name back), and once the play's `ends` has passed it draws one line under the words, in the board's
 * small text, saying the card wore off and whose post it was all along: the page's post carries its true character again by then, so the
 * name is `nameOf(post.character)`. An admin's end reverses the play and the effect is gone, so it draws no line.
 *
 * It never reads who played the card. The time is read against the clock (`useAt` redraws it when the end passes, and the engine re-reads
 * the page about a second after it); a moment (`still`) reads the same, binds nothing and meets nothing.
 */
import { useEffect, useRef } from 'react';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import { useAt } from '../../../../engine/ui/cards/plays.ts';
import { endsWords } from '../../../../engine/ui/cards/marks.ts';
import { dayAndTime } from '../../../../engine/ui/characters/format.ts';
import './whodunnit.css';

export function WhodunnitEffect({ post, plays, reader, show, met, still, nameOf, children }: EffectProps) {
  /* The veil's play: one fits on a post, and a play an admin ended, or that did not take, is no veil. */
  const play = plays.find((p) => !p.reversed && !p.untaken && !p.caught && !p.faceDown);
  const ends = play?.ends;
  const endsAt = ends === undefined ? Number.NaN : Date.parse(ends);
  const now = useAt(Number.isNaN(endsAt) ? [] : [endsAt]);
  const over = !Number.isNaN(endsAt) && endsAt <= now;
  const there = play !== undefined;
  const author = reader.author;

  /* The Lens's tab: what the card is doing to this reader now. The author is told, plainly, what the stand-in is. */
  useEffect(() => {
    if (!there) { show(null); return; }
    const view: CardView = over
      ? { progress: null, state: 'The name is back', yours: false, controls: [], notes: {} }
      : {
        progress: null,
        state: 'Author hidden from everyone',
        ...(ends !== undefined ? { ends: `${endsWords(ends)} The author's name comes back then.` } : {}),
        yours: false,
        controls: [],
        notes: {},
        ...(author ? { report: 'This is your post. Everyone else sees the stand-in in your place, and so does this page.' } : {}),
      };
    show(view);
  }, [show, there, over, ends, author]);
  useEffect(() => () => show(null), [show]);

  /* The reader has met the card when its post is first drawn; a moment meets nothing. */
  const met1 = useRef(false);
  useEffect(() => {
    if (still || !there || met1.current) return;
    met1.current = true;
    met();
  }, [met, still, there]);

  return (
    <>
      {children}
      {there && over && ends !== undefined && (
        <p className="dw-whodunnit-wore">Whodunnit? wore off on {dayAndTime(ends)}. This post was {nameOf(post.character)}'s all along.</p>
      )}
    </>
  );
}
