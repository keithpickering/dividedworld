/**
 * The bar a folded post's row hides behind (`CardUi.foldsRow`), in the theme's header look (`--kb-head-*`): the author's square, name and number, the post's
 * marks, and the one press that shows or hides the row. The marks are drawn here for as long as the post wears a fold, open or folded, so a press never moves
 * them between parents. The press is a real button, `aria-expanded`, whose `::after` covers the bar; the marks sit over it.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { SquareAvatar, type PostbitPerson } from '../postbit/Postbit.tsx';
import './fold.css';

export function FoldBar({ person, name, spoken, seq, open, toggle, marks, controls }: {
  /** Who the postbit shows; undefined for a post with no character (the staff's), whose word stands as the name. */
  readonly person: PostbitPerson | undefined;
  readonly name: string;
  readonly spoken: string;
  readonly seq: number;
  readonly open: boolean;
  readonly toggle: () => void;
  readonly marks: ReactNode;
  /** The id of the row this bar shows and hides. */
  readonly controls: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const was = useRef(open);
  /* The row folding while focus is inside it (an effect's control, the Lens): the cells leave the tab order, so focus goes to the press that brought it back. */
  useEffect(() => {
    if (was.current && !open && document.getElementById(controls)?.contains(document.activeElement)) button.current?.focus();
    was.current = open;
  }, [open, controls]);
  return (
    <div className="kb-fold-bar" data-kb-over-ink="">
      {person ? <SquareAvatar character={person.character} /> : null}
      <span className="kb-fold-name">{name}</span>
      <span className="kb-fold-seq">#{seq}</span>
      <span className="kb-fold-gap" />
      {marks && <span className="kb-fold-marks">{marks}</span>}
      <button ref={button} type="button" className="kb-fold-toggle" aria-expanded={open} aria-controls={controls} aria-label={`${open ? 'Hide' : 'Show'} post #${seq} by ${spoken}`} onClick={toggle}>
        <span className="kb-fold-words">{open ? 'Hide post' : 'Show post'}</span>
        <svg className="kb-fold-chevron" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false" data-kb-open={open ? '' : undefined}>
          <path d="M2 4.25 6 8.25 10 4.25" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
