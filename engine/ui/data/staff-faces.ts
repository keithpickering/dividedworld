/**
 * A staff character's face. The database holds no avatar file for a persona or the developer: their pictures are the
 * instance's (`InstanceUi.staffAvatars`, by the persona's roster key; `InstanceUi.avatars`, by the developer persona's
 * avatar key), so a character is given its face once, where it enters the screens' data, and every renderer (postbit,
 * mini, HUD, presence, profile, Portrait) draws it as it draws any avatar. Pure: it reads the character and the map.
 */
import type { InstanceUi } from '../types.ts';
import type { Character } from './api.ts';
import { DEVELOPER_STAFF_KEY } from '../../rules/instance.ts';

/**
 * The character with the instance's picture for it, where it is staff and the instance has one; otherwise the very
 * character given. A player character (no `staff`) is never touched. `developerAvatar` is the developer persona's
 * avatar key (`DeveloperPersona.avatar`): its picture is the developer's square, and he has no portrait.
 */
export function withStaffFace(character: Character, ui: InstanceUi, developerAvatar?: string): Character {
  if (character.staff === undefined) return character;
  if (character.staff === DEVELOPER_STAFF_KEY) {
    const square = developerAvatar === undefined ? undefined : ui.avatars?.[developerAvatar];
    return square === undefined ? character : { ...character, avatarSquare: square };
  }
  const faces = ui.staffAvatars?.[character.staff];
  if (faces === undefined) return character;
  return { ...character, avatarSquare: faces.square, avatarPortrait: faces.portrait ?? character.avatarPortrait };
}
