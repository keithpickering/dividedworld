/**
 * Divided World's reactions: four per quadrant. The set and why each was chosen are
 * docs/plans/2026-11-05-reaction-set-design.md. The key is what the database stores and the URL
 * carries, and it names what the emoji pictures, since the screens read it aloud ("eye-roll" is
 * "Eye roll"); the emoji is what a player sees. The order within a quadrant is the picker's.
 */
import type { ReactionKind } from '../../engine/rules/types.ts';

export const reactions: readonly ReactionKind[] = Object.freeze([
  { key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' },
  { key: 'heart', emoji: '❤️', quadrant: 'excitedPositive' },
  { key: 'laughing', emoji: '😂', quadrant: 'excitedPositive' },
  { key: 'hundred-points', emoji: '💯', quadrant: 'excitedPositive' },
  { key: 'tomato', emoji: '🍅', quadrant: 'excitedNegative' },
  { key: 'vomiting', emoji: '🤮', quadrant: 'excitedNegative' },
  { key: 'cursing', emoji: '🤬', quadrant: 'excitedNegative' },
  { key: 'thumbs-down', emoji: '👎', quadrant: 'excitedNegative' },
  { key: 'thumbs-up', emoji: '👍', quadrant: 'calmPositive' },
  { key: 'folded-hands', emoji: '🙏', quadrant: 'calmPositive' },
  { key: 'salute', emoji: '🫡', quadrant: 'calmPositive' },
  { key: 'light-bulb', emoji: '💡', quadrant: 'calmPositive' },
  { key: 'facepalm', emoji: '🤦', quadrant: 'boredNegative' },
  { key: 'eye-roll', emoji: '🙄', quadrant: 'boredNegative' },
  { key: 'crickets', emoji: '🦗', quadrant: 'boredNegative' },
  { key: 'yawn', emoji: '🥱', quadrant: 'boredNegative' },
]);
