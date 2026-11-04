/**
 * A staff character's badge, in capitals on the 2003 board's ink: ADMINISTRATOR for the Boss, MODERATOR for a Mod Bot. A staff member
 * is known to be staff, signed in or not (characters_public carries its key and office), so this says nothing private.
 */
import type { Character } from '../data/api.ts';
import './postbit.css';

export const STAFF_BADGE = { boss: 'ADMINISTRATOR', mod: 'MODERATOR' } as const;

/** Nothing for a character who is not staff, none for a member or a benched persona, and none for the developer persona, whose posts are on the Updates page and in no thread. */
export function StaffBadge({ character }: { readonly character: Character }) {
  const office = character.office;
  if (!character.staff || (office !== 'boss' && office !== 'mod')) return null;
  return <span className="kb-staff-badge" data-kb-staff={office}>{STAFF_BADGE[office]}</span>;
}
