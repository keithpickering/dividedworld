/**
 * Buzzkill (Salty, rare, a Move on a post or a character; instant): ends one Gimmick up on its target, up to rare, which the player picks
 * from those showing there (docs/plans/2026-11-21-buzzkill-design.md). The Gimmick is not refunded; what it did before stands. Wards are
 * asked as for any Salty Move, so a Sugar Coat turns it away and a Force Field does not. Played face up, never set face down.
 */
import { landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

/** An id, as the engine's own checks read one (engine/rules/actions.ts holds the same pattern, unexported). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const buzzkill: CardRules<{ readonly play: string }> = {
  key: 'buzzkill',
  name: 'Buzzkill',
  alignment: 'salty',
  rarity: 'rare',
  reaches: ['post', 'character'],
  cuts: { upTo: 'rare' },
  seen: (p) => `${who(p)} played Buzzkill here, ${p.ago}, and tore down a Gimmick that was up.`,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(buzzkill, target, effects, now),
  validateConfig: (config) => {
    const play = (config as { play?: unknown } | null)?.play;
    return typeof play === 'string' && UUID.test(play) ? ok({ play }) : refuse('Buzzkill names the Gimmick it ends');
  },
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 300;
