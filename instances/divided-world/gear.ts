/**
 * Divided World's starting gear (`Instance.gear`): five pieces a character can wear over its portrait. The names and lines are
 * placeholders the owner replaces with the Minus World gear; each piece's art is `ui/gear/` (`InstanceUi.gear`), also a placeholder.
 */
import type { GearRules } from '../../engine/rules/cosmetics.ts';
import { deepFreeze } from '../../engine/rules/instance.ts';

export const gear: readonly GearRules[] = deepFreeze<readonly GearRules[]>([
  { key: 'baseball-cap', name: 'Baseball Cap', line: 'Worn backwards, as the ancients intended.', rarity: 'common' },
  { key: 'mustache', name: 'Mustache', line: 'Not a disguise. Do not ask.', rarity: 'uncommon' },
  { key: 'shades', name: 'Shades', line: 'Indoors, at night, for no reason.', rarity: 'common' },
  { key: 'button', name: '"I Really Wish I Weren\'t Here" Button', line: 'A pin for a long meeting.', rarity: 'rare' },
  { key: 'nostalgic-hat', name: 'Nostalgic Hat', line: 'It smells like a summer that never ended.', rarity: 'rare' },
]);
