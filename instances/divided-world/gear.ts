/**
 * Divided World's starting gear (`Instance.gear`): fourteen pieces a character can wear over its portrait: the baseball cap and the plumber's cap, each in five colors, and four more. The names and lines are
 * placeholders the owner replaces with the Minus World gear. Each piece's art is `ui/gear/` (`InstanceUi.gear`): the caps are rendered, and the other four are placeholders.
 */
import type { GearRules } from '../../engine/rules/cosmetics.ts';
import { deepFreeze } from '../../engine/rules/instance.ts';

export const gear: readonly GearRules[] = deepFreeze<readonly GearRules[]>([
  { key: 'baseball-cap', name: 'Baseball Cap', line: 'Peanuts and Cracker Jack not included.', rarity: 'common' },
  { key: 'baseball-cap-green', name: 'Green Baseball Cap', line: 'Worn forwards, as the moderns insist.', rarity: 'common' },
  { key: 'baseball-cap-blue', name: 'Blue Baseball Cap', line: 'Matches nothing. Goes with everything.', rarity: 'uncommon' },
  { key: 'baseball-cap-yellow', name: 'Yellow Baseball Cap', line: 'Not a popular look, but maybe you can pull it off.', rarity: 'uncommon' },
  { key: 'baseball-cap-purple', name: 'Purple Baseball Cap', line: 'For a team that folded in 1997.', rarity: 'rare' },
  { key: 'plumbers-cap', name: "Plumber's Cap", line: 'Show off your love for fangames with this familiar and comfortable cap.', rarity: 'uncommon' },
  { key: 'plumbers-cap-green', name: "Green Plumber's Cap", line: 'Don\'t get caught dead in a haunted mansion without one of these.', rarity: 'rare' },
  { key: 'plumbers-cap-blue', name: "Blue Plumber's Cap", line: 'For those days when you feel like a brother who doesn\'t even exist.', rarity: 'uncommon' },
  { key: 'plumbers-cap-yellow', name: "Yellow Plumber's Cap", line: 'For a plumber who charges extra.', rarity: 'rare' },
  { key: 'plumbers-cap-purple', name: "Purple Plumber's Cap", line: 'Perfect for tennis.', rarity: 'rare' },
  { key: 'mustache', name: 'Mustache', line: 'Not a disguise. Do not ask.', rarity: 'uncommon' },
  { key: 'shades', name: 'Shades', line: 'Indoors, at night, for no reason.', rarity: 'common' },
  { key: 'button', name: '"I Really Wish I Weren\'t Here" Button', line: 'A pin for a long meeting.', rarity: 'rare' },
  { key: 'nostalgic-hat', name: 'Nostalgic Hat', line: 'It smells like a summer that never ended.', rarity: 'rare' },
]);
