/**
 * Buzzkill's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. It has no `logPlay`: the engine's log row for a
 * cutting play already says "It ended the {card} there." from the play's public `cut`, so a line here would say it twice.
 */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import { buzzkill } from '../../../cards/buzzkill.ts';
import { ConfigForm as BuzzkillConfigForm } from '../../../cards/buzzkill/ConfigForm.tsx';
import buzzkillCanvas from './art.webp?url';
import buzzkillMark from './mark.svg?url';
import buzzkillArt from './art.json';

/** The rarity the cut reaches, read from the card's rules. Every sentence below names it, so this throws rather than let a card that cuts nothing stand. */
const upTo = (() => {
  if (buzzkill.cuts === undefined) throw new Error('Buzzkill has no cut in its rules');
  return buzzkill.cuts.upTo;
})();

/* Salty's pink and ink, as Steel Chair wears them: the art holds none. */
export const ui: CardUi = {
  key: 'buzzkill',
  ConfigForm: BuzzkillConfigForm,
  art: { color: '#ff3d7f', ink: '#14030a', canvas: buzzkillCanvas, mark: buzzkillMark, credit: buzzkillArt.credit, tagline: 'End a Gimmick early.' },
  status: 'Ended a Gimmick early',
  summary: `Played on a post or a character. Ends one Gimmick there, up to ${upTo}. You choose which.`,
  describe: (_settings: Settings) =>
    `A Salty card, ${buzzkill.rarity}, played on a post or a character. It ends one Gimmick there, up to ${upTo}, which you pick. The Gimmick isn't refunded, and what it did before it ended stands. A card that would turn a Salty card away still does, and on a post a card set face down there can still catch it. It is played face up, never set face down.`,
};
