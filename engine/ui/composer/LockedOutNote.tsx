/**
 * The note a locked-out mask's reply box and play form say (the so-very-happy design, section 2.3): until when, that the lockout ends by itself and holds only this character, and the way
 * out beside it, another mask in the HUD. Plain and true. The until is `useLockedOutUntil`'s (lockout.ts).
 */
import { dayAndTime } from '../characters/format.ts';

export function LockedOutNote({ character, until }: { readonly character: { readonly name: string }; readonly until: string }) {
  return (
    <p className="kb-notice kb-composer-lockout" role="status">
      <strong>{character.name}</strong> is locked out of this thread until {dayAndTime(until)}. The lockout ends by itself then, and it holds only this character, not your other characters. You can switch to another in the HUD.
    </p>
  );
}
