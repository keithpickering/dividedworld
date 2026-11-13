/**
 * The post's own words, read-only, in the glass's cut panel, to select from (docs/plans/2026-11-12-laugh-track-band-design.md, section 5): lifted
 * from the face-down conditions (SetConditions.tsx) so they and a card's settings draw one block. It is in the tab order so its scroll can be
 * reached, and a selection in it, by pointer or by a phone's handles (a focused, non-editable block takes no keyboard selection, so typing is
 * always the keyboard's way), is reported on `selectionchange`:
 *   - wholly inside the words: `onSelect(text, gesture)`, the raw text and the gesture it belongs to;
 *   - running past the block's edge: `onSpill(true)`, and nothing is taken;
 *   - anywhere else, or collapsed: nothing.
 * Some browsers leave the document's selection on the words while the player types in a field, picks a radio or presses a button of the form; a
 * selection left standing like that must not refill anything, so while focus is in a field, a radio or a button of `within` (a ref to the form)
 * nothing is reported. The words themselves having focus is the player selecting, and is read.
 *
 * One selection gesture reports many selections, each growing or shrinking the last ("Luigi", then "Luigi waved"), and only this component can
 * see where a gesture begins, so `gesture` is a number that is the same for every report of one gesture and different for the next. A new
 * gesture begins when (i) a `pointerdown` lands inside the words without Shift held (a mouse press or a touch that starts a selection; a
 * Shift+click extends the standing one), or (ii) the selection is reported collapsed or gone (it advances the gesture and still calls neither
 * `onSelect` nor `onSpill`). Dragging a mouse, dragging a touch selection handle (the browser's own UI, so no pointerdown on the page) and
 * Shift+arrow all stay one gesture. Each PostWords counts its own, and the numbers are only meant to be compared with each other.
 */
import { useEffect, useRef, type RefObject } from 'react';

export interface PostWordsProps {
  readonly words: string;
  readonly onSelect: (text: string, gesture: number) => void;
  readonly onSpill?: (spilled: boolean) => void;
  /** The form that holds the words, for the stale-selection guard. */
  readonly within?: RefObject<HTMLElement | null>;
}

export function PostWords({ words, onSelect, onSpill, within }: PostWordsProps) {
  const view = useRef<HTMLDivElement>(null);
  const latest = useRef({ onSelect, onSpill, within });
  latest.current = { onSelect, onSpill, within };
  const gesture = useRef(0);

  useEffect(() => {
    const read = () => {
      const el = view.current;
      const selection = document.getSelection();
      if (!el) return;
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        gesture.current += 1;
        return;
      }
      const active = document.activeElement;
      if (active && active !== el && latest.current.within?.current?.contains(active) && active.matches('input, select, textarea, button')) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        if (range.intersectsNode(el)) latest.current.onSpill?.(true);
        return;
      }
      latest.current.onSelect(range.toString(), gesture.current);
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  return (
    <div className="kb-play-post-frame kb-glass-cut-panel">
      <div ref={view} className="kb-play-post" data-kb-post-words role="group" aria-label="The post's words" tabIndex={0} onPointerDown={(e) => { if (!e.shiftKey) gesture.current += 1; }}>{words}</div>
    </div>
  );
}
