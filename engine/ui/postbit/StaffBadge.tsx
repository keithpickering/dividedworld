/**
 * A staff character's badge, in capitals on the 2003 board's ink: ADMINISTRATOR for a Boss, MODERATOR for a Mod Bot. A staff member
 * is known to be staff, signed in or not (characters_public carries its key and kind), so this says nothing private.
 */
import type { Character } from '../data/api.ts';
import './postbit.css';

export const STAFF_BADGE = { boss: 'ADMINISTRATOR', bot: 'MODERATOR' } as const;

/** Nothing for a character who is not staff, and nothing for the developer persona, whose posts are on the Updates page and in no thread. */
export function StaffBadge({ character }: { readonly character: Character }) {
  if (!character.staff || !character.staffKind || character.staffKind === 'developer') return null;
  return <span className="kb-staff-badge" data-kb-staff={character.staffKind}>{STAFF_BADGE[character.staffKind]}</span>;
}
