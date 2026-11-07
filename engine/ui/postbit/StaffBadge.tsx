/**
 * A staff character's badge: the staff group's name drawn as a game piece (a chip with a small orb, in the board's ink, like the board's other
 * pieces), and beside it the office's title in capitals on reversed ink, ADMINISTRATOR for the Boss and MODERATOR for a Mod Bot (the staff
 * roster design, section 10). Every persona is in the group at every office, a member or a benched one with no office title; the persona's own
 * profile title is the postbit's, not this. The group's name is the instance's, read from the screen settings (`staffGroup`), never named here.
 * A staff member is known to be staff, signed in or not (characters_public carries its key and office), so this says nothing private.
 *
 * The badge is forum chrome, so it is plain text at the board's full contrast: the orb is decoration (hidden from a screen reader) and the
 * group and the title are words, each read once.
 */
import { useKayfa } from '../context.tsx';
import type { Character } from '../data/api.ts';
import './postbit.css';

export const OFFICE_TITLE = { boss: 'ADMINISTRATOR', mod: 'MODERATOR' } as const;

/** The group's chip: a small orb and the group's name. Used by the badge, the profile and the presence boxes. */
export function StaffGroup({ name }: { readonly name: string }) {
  return <span className="kb-staff-group"><span className="kb-staff-orb" aria-hidden="true" />{name}</span>;
}

/** Whether the badge draws anything: the profile's Staff row is left out when it would be empty. */
export function showsStaffBadge(character: Character, group: string | undefined): boolean {
  const office = character.office;
  if (!character.staff || office === 'developer') return false;
  return Boolean(group) || office === 'boss' || office === 'mod';
}

/** Nothing for a character who is not staff, and none for the developer persona, whose posts are on the Updates page and in no thread. */
export function StaffBadge({ character }: { readonly character: Character }) {
  const { settings } = useKayfa();
  const office = character.office;
  const group = settings.staffGroup?.name;
  if (!showsStaffBadge(character, group)) return null;
  const title = office === 'boss' || office === 'mod' ? OFFICE_TITLE[office] : null;
  return (
    <span className="kb-staff-badge" data-kb-staff={office ?? 'member'}>
      {group && <StaffGroup name={group} />}
      {title && <span className="kb-staff-office">{title}</span>}
    </span>
  );
}
