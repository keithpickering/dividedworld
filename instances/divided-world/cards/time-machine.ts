/**
 * Time Machine (Pepperoni, rare, a Move on a post): for 3 days the post shows as it was at an earlier point the player picks from its
 * History, and no card up to rare can be played on it (docs/plans/2026-11-21-time-machine-design.md, section 1). The rules are the
 * engine's rewind (engine/rules/rewind.ts: `rewindConfig` takes `{ to }`, the version it names; SQL checks that it is a point of the post);
 * what is here is the card's facts. It is played face up only (`faceUpOnly`: its point is picked when it is played) and never staffed, and
 * it draws an effect on the post (ui/cards/time-machine/Effect.tsx), so each play counts toward the post's limit of drawn effects.
 */
import { landsOn, type CardRules } from '../../../engine/rules/cards.ts';
import { rewindConfig } from '../../../engine/rules/rewind.ts';
import type { Hundredths, Span } from '../../../engine/rules/types.ts';

export const TIME_MACHINE_LASTS: Span = { unit: 'day', count: 3 };

export const timeMachine: CardRules<{ to: string }> = {
  key: 'time-machine',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Time Machine',
  alignment: 'pepperoni',
  rarity: 'rare',
  play: 'cast',
  reaches: ['post'],
  lasts: TIME_MACHINE_LASTS,
  rewind: { upTo: 'rare' },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(timeMachine, target, effects, now),
  validateConfig: rewindConfig,
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 300;
