/**
 * The note a banned mask's composer says, in the reply box and in New thread alike (the Mod Bots design, section 5): until when, that the ban ends by itself and holds only this
 * character, and the way out beside it, an appeal to the Boss. Plain and true. The until is `useBannedUntil`'s (ban.ts).
 */
import { BanAppeal } from '../cards/Forms.tsx';
import { dayAndTime } from '../characters/format.ts';
import type { Id } from '../data/api.ts';

export function BannedNote({ character, until }: { readonly character: { readonly id: Id; readonly name: string }; readonly until: string }) {
  return (
    <p className="kb-notice kb-composer-ban" role="status">
      <strong>{character.name}</strong> is banned until {dayAndTime(until)}. The ban ends by itself then, and it holds only this character: switch to another in the HUD to post as it.
      {' '}<BanAppeal character={character.id} />
    </p>
  );
}
