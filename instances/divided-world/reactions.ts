/**
 * Divided World's reactions: the spec's four sets of four, one set per quadrant. The key is
 * what the database stores and the URL carries; the emoji is what a player sees.
 */
import type { ReactionKind } from '../../engine/rules/types.ts';

export const reactions: readonly ReactionKind[] = Object.freeze([
  { key: 'fire', emoji: '🔥', quadrant: 'excitedPositive' },
  { key: 'heart', emoji: '❤️', quadrant: 'excitedPositive' },
  { key: 'raised-hands', emoji: '🙌', quadrant: 'excitedPositive' },
  { key: 'star-struck', emoji: '🤩', quadrant: 'excitedPositive' },
  { key: 'tomato', emoji: '🍅', quadrant: 'excitedNegative' },
  { key: 'angry', emoji: '😡', quadrant: 'excitedNegative' },
  { key: 'cursing', emoji: '🤬', quadrant: 'excitedNegative' },
  { key: 'thumbs-down', emoji: '👎', quadrant: 'excitedNegative' },
  { key: 'relieved', emoji: '😌', quadrant: 'calmPositive' },
  { key: 'tea', emoji: '☕', quadrant: 'calmPositive' },
  { key: 'handshake', emoji: '🤝', quadrant: 'calmPositive' },
  { key: 'meditating', emoji: '🧘', quadrant: 'calmPositive' },
  { key: 'zzz', emoji: '💤', quadrant: 'boredNegative' },
  { key: 'eye-roll', emoji: '🙄', quadrant: 'boredNegative' },
  { key: 'trash', emoji: '🗑️', quadrant: 'boredNegative' },
  { key: 'yawn', emoji: '🥱', quadrant: 'boredNegative' },
]);
