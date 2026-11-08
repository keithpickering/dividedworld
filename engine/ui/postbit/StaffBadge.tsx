/**
 * A staff character's office title: ADMINISTRATOR for the Boss and MODERATOR for a Mod Bot, in capitals on reversed ink, drawn beside the
 * staff rung's group bar (Postbit.tsx; the staff roster design, section 10, and the member groups design). The group itself is the bar's:
 * every persona is in the staff rung at every office, and a member or a benched one has no office title, so this draws nothing for it. The
 * persona's own profile title is the postbit's, not this. A staff member is known to be staff, signed in or not (characters_public carries
 * its key and office), so this says nothing private.
 *
 * The title is forum chrome, so it is plain text at the board's full contrast.
 */
import type { Character } from '../data/api.ts';
import './postbit.css';

export const OFFICE_TITLE = { boss: 'ADMINISTRATOR', mod: 'MODERATOR' } as const;

/** The group's chip: a small orb and the group's name. Used by the presence boxes, whose line has no room for a bar. */
export function StaffGroup({ name }: { readonly name: string }) {
  return <span className="kb-staff-group"><span className="kb-staff-orb" aria-hidden="true" />{name}</span>;
}

/** Whether the title draws anything: the profile's Staff row is left out when it would be empty. Only a Boss and a Mod have one; the developer persona has none, since its posts are on the Updates page and in no thread. */
export function showsStaffBadge(character: Character): boolean {
  return Boolean(character.staff) && (character.office === 'boss' || character.office === 'mod');
}

/** Nothing for a character who is not staff, and none for a persona without an office title. */
export function StaffBadge({ character }: { readonly character: Character }) {
  if (!showsStaffBadge(character)) return null;
  const office = character.office as 'boss' | 'mod';
  return (
    <span className="kb-staff-badge" data-kb-staff={office}>
      <span className="kb-staff-office">{OFFICE_TITLE[office]}</span>
    </span>
  );
}
