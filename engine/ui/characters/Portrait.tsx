/**
 * A character's portrait as the Roster and Turn boards draw it: its own portrait cut, else its
 * square, else the boards' hatched placeholder. It is decoration beside the name, which is read in
 * words beside it, so it is hidden from the accessibility tree.
 */
import type { Character } from '../data/api.ts';

export function Portrait({ face, className }: { readonly face: Character | undefined; readonly className: string }) {
  const src = face?.avatarPortrait ?? face?.avatarSquare ?? null;
  return (
    <span className={className} aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span className="kb-portrait-none" />}
    </span>
  );
}
