/**
 * Below the Fold's effect on a post (docs/plans/2026-11-11-below-the-fold-plan.md, Task 3; the card notes design, section 2; the row's fold is
 * docs/plans/2026-11-13-fold-the-row-design.md): the post is drawn as one bar and nothing else until a reader presses it, which opens the post for
 * that reader on this page, and a second press folds it again. It is a 2003 `[spoiler]` bar, a real button, the same for every reader alike.
 *
 * It works in one of two places. Where a post has a row (a thread's post), the card sets `foldsRow` and the engine draws the bar over the whole row
 * (thread/FoldBar.tsx) and gives this effect `fold`; the effect then draws `children` and nothing else, and only tells the Lens the row's state, with the
 * row's own press as its one control. Where there is no row (the ORIGIN box, the front door, a moment, History) there is no `fold`, and the effect draws
 * its own bar inside the words, as below.
 *
 * Without `fold` the one piece of state is `open`, the reader's own and in the page's memory: nothing is saved, sent or counted, so it lasts until
 * the page is left, and the effect reads neither who wrote the post nor who played the card. The post's words are `children`, drawn
 * once and never unmounted by a fold (the `hidden` attribute hides them), so an effect inside this one keeps its state through a
 * press. There is no animation here (the row's unfold is the engine's), so reduced motion has nothing to change.
 *
 * The in-words bar is the fold's own and not the post's words, and it is the way out, so it carries the engine's `data-kb-over-ink`, as the
 * reactions row does (engine/ui/thread/thread.css): it is drawn over another card's ink and stays usable there, and Whoops! starts no
 * scrub from a press on it (it would otherwise take the pointer and swallow the click once the post is open). Nothing is stopped: a
 * press on the bar reaches every listener above it, Stick Around's hold among them.
 *
 * In a play's moment (`still`) the post is drawn folded, with the bar disabled and no handler bound, and the Lens is given the
 * folded view with no controls. The Lens says how the fold ends (`show`): the reader's press on Show post.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import './fold.css';

/** The Lens's way out of the fold, for either state (the bar is its own way out and its own way back). */
export const LENS_ENDS = 'Ends when you press Show post.';

export function BelowTheFoldEffect({ show, met, still, fold, children }: EffectProps) {
  const [ownOpen, setOwnOpen] = useState(false);
  const region = useId();
  const shown = fold ? fold.open : ownOpen && !still;
  const toggle = fold ? fold.toggle : () => setOwnOpen((o) => !o);
  const press = fold?.toggle;

  /* The Lens's tab: what the fold is doing to this reader now, its one control (the bar's own press), and no edge. */
  useEffect(() => {
    const run = press ?? (() => setOwnOpen((o) => !o));
    const label = shown ? 'Hide post' : 'Show post';
    const view: CardView = {
      progress: null,
      state: shown ? 'Open for you' : 'Folded for you',
      ends: LENS_ENDS,
      yours: !shown,
      controls: still ? [] : [{ kind: 'press', label, run }],
      notes: {},
    };
    show(view);
  }, [show, shown, still, press]);
  useEffect(() => () => show(null), [show]);

  /* The reader has met the card when the bar is first drawn; a moment meets nothing. */
  const met1 = useRef(false);
  useEffect(() => {
    if (still || met1.current) return;
    met1.current = true;
    met();
  }, [met, still]);

  /* In the post's row the engine draws the bar; this draws the words alone. */
  if (fold) return <>{children}</>;

  return (
    <div className="dw-fold" data-kb-fold>
      <button type="button" className="dw-fold-bar" data-kb-over-ink="" aria-expanded={shown} aria-controls={region} disabled={still} onClick={still ? undefined : toggle}>
        <span className="dw-fold-words">{shown ? 'Hide post' : 'Show post'}</span>
        <svg className="dw-fold-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" data-dw-open={shown ? '' : undefined}>
          <path d="M2 4.25 6 8.25 10 4.25" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className="dw-fold-body" id={region} hidden={!shown}>{children}</div>
    </div>
  );
}
