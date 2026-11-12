/**
 * The post's own words, read-only, in the glass's cut panel, to select from (docs/plans/2026-11-12-laugh-track-band-design.md, section 5): lifted
 * from the face-down conditions (SetConditions.tsx) so they and a card's settings draw one block. It is in the tab order so its scroll can be
 * reached, and a selection in it, by pointer or by a phone's handles (a focused, non-editable block takes no keyboard selection, so typing is
 * always the keyboard's way), is reported on `selectionchange`:
 *   - wholly inside the words: `onSelect(text)`, the raw text;
 *   - running past the block's edge: `onSpill(true)`, and nothing is taken;
 *   - anywhere else, or collapsed: nothing.
 * Some browsers leave the document's selection on the words while the player types in a field, picks a radio or presses a button of the form; a
 * selection left standing like that must not refill anything, so while focus is in a field, a radio or a button of `within` (a ref to the form)
 * nothing is reported. The words themselves having focus is the player selecting, and is read.
 */
import { useEffect, useRef, type RefObject } from 'react';

export interface PostWordsProps {
  readonly words: string;
  readonly onSelect: (text: string) => void;
  readonly onSpill?: (spilled: boolean) => void;
  /** The form that holds the words, for the stale-selection guard. */
  readonly within?: RefObject<HTMLElement | null>;
}

export function PostWords({ words, onSelect, onSpill, within }: PostWordsProps) {
  const view = useRef<HTMLDivElement>(null);
  const latest = useRef({ onSelect, onSpill, within });
  latest.current = { onSelect, onSpill, within };

  useEffect(() => {
    const read = () => {
      const el = view.current;
      const selection = document.getSelection();
      if (!el || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const active = document.activeElement;
      if (active && active !== el && latest.current.within?.current?.contains(active) && active.matches('input, select, textarea, button')) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) {
        if (range.intersectsNode(el)) latest.current.onSpill?.(true);
        return;
      }
      latest.current.onSelect(range.toString());
    };
    document.addEventListener('selectionchange', read);
    return () => document.removeEventListener('selectionchange', read);
  }, []);

  return (
    <div className="kb-play-post-frame kb-glass-cut-panel">
      <div ref={view} className="kb-play-post" data-kb-post-words role="group" aria-label="The post's words" tabIndex={0}>{words}</div>
    </div>
  );
}
