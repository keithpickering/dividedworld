/**
 * 4D Chess (Salty, uncommon, a Reversal set face down on the player's own post): it names a Move, up to uncommon, and a quadrant. When
 * that Move is cast on the post, the spring pays the setter one whole vote for each vote that card draws in the quadrant, with no end
 * once sprung (docs/plans/2026-11-11-card-notes-design.md, section 2, "Toll and 4D Chess"). Nothing is caught or taken from the caster.
 *
 * - **Its configuration** is `{ card, quadrant }`: the key of the Move, 1 to 64 characters, and one of the four quadrants. Whether the
 *   card is one of the instance's, cast on a post and no rarer than 4D Chess is `decideSet`'s to check, so this file imports no other card.
 * - **The settlement's** is the pay, and the own-player rule. **The engine's** is the spring and the face-down back.
 * - **Its staff options** give a persona the Move as an enum of the instance's cards, which `cards/index.ts` builds once the list exists.
 */
import { ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { QUADRANTS, type Quadrant } from '../../../engine/rules/types.ts';

export type FourDChessConfig = { readonly card: string; readonly quadrant: Quadrant };

export const CARD_KEY = { least: 1, most: 64 } as const;

export const fourDChess: CardRules<FourDChessConfig> = {
  key: '4d-chess',
  name: '4D Chess',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'set',
  trap: { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } },
  catches: (config) => config.card,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: (config) => {
    const c = typeof config === 'object' && config !== null ? (config as { card?: unknown; quadrant?: unknown }) : {};
    if (typeof c.card !== 'string' || c.card.length < CARD_KEY.least || c.card.length > CARD_KEY.most) return refuse('the card is the key of the Move to wait for');
    if (!QUADRANTS.includes(c.quadrant as Quadrant)) return refuse('choose the reactions it pays on');
    return ok({ card: c.card, quadrant: c.quadrant as Quadrant });
  },
};
