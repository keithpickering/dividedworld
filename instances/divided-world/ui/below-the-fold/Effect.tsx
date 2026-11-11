/**
 * Below the Fold's effect on a post (docs/plans/2026-11-11-below-the-fold-plan.md, Task 3; the card notes design, section 2): the
 * post is drawn as one bar and nothing else until a reader presses it, which opens the post for that reader on this page, and a
 * second press folds it again. It is a 2003 `[spoiler]` bar over the whole post, a real button, the same for every reader alike.
 *
 * The one piece of state is `open`, the reader's own and in the page's memory: nothing is saved, sent or counted, so it lasts until
 * the page is left, and the effect reads neither who wrote the post nor who played the card. The post's words are `children`, drawn
 * once and never unmounted by a fold (the `hidden` attribute hides them), so an effect inside this one keeps its state through a
 * press. There is no animation, so reduced motion has nothing to change.
 *
 * In a play's moment (`still`) the post is drawn folded, with the bar disabled and no handler bound, and the Lens is given the
 * folded view with no controls. The Lens says how the fold ends (`show`): the reader's press on Show post.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { CardView, EffectProps } from '../../../../engine/ui/cards/types.ts';
import './fold.css';

/** The Lens's way out of the fold, for either state (the bar is its own way out and its own way back). */
export const LENS_ENDS = 'Ends when you press Show post.';

export function BelowTheFoldEffect({ show, met, still, children }: EffectProps) {
  const [open, setOpen] = useState(false);
  const region = useId();
  const shown = open && !still;

  /* The Lens's tab: what the fold is doing to this reader now, its one control (the bar's own press), and no edge. */
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const label = shown ? 'Hide post' : 'Show post';
    const view: CardView = {
      progress: null,
      state: shown ? 'Open for you' : 'Folded for you',
      ends: LENS_ENDS,
      yours: !shown,
      controls: still ? [] : [{ kind: 'press', label, run: toggle }],
      notes: {},
    };
    show(view);
  }, [show, shown, still]);
  useEffect(() => () => show(null), [show]);

  /* The reader has met the card when the bar is first drawn; a moment meets nothing. */
  const met1 = useRef(false);
  useEffect(() => {
    if (still || met1.current) return;
    met1.current = true;
    met();
  }, [met, still]);

  return (
    <div className="dw-fold" data-kb-fold>
      <button type="button" className="dw-fold-bar" aria-expanded={shown} aria-controls={region} disabled={still} onClick={still ? undefined : () => setOpen((o) => !o)}>
        <span className="dw-fold-arrow" aria-hidden="true">{shown ? '▾' : '▸'}</span>
        {shown ? 'Hide post' : 'Show post'}
      </button>
      <div className="dw-fold-body" id={region} hidden={!shown}>{children}</div>
    </div>
  );
}
