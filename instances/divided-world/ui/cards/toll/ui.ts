/** Toll's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { toll } from '../../../cards/toll.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import tollCanvas from './art.webp?url';
import tollMark from './mark.svg?url';
import tollArt from './art.json';
import { spanWords, tollShare } from '../words.ts';

export const ui: CardUi = {
  key: 'toll',
  art: { color: '#d24a2c', ink: '#0d0301', canvas: tollCanvas, mark: tollMark, credit: tollArt.credit, tagline: 'Get paid when a Move lands here.' },
  summary: `Used on your post. For ${spanWords(toll.lasts!)}, every reaction to a Move another player casts there pays you too.`,
  status: 'Charging a toll on Moves',
  hint: 'A Toll pays this post\'s author when a Move cast here draws reactions.',
  describe: (settings: Settings) =>
    `A Pepperoni card, ${toll.rarity}, used on one of your own posts. For ${spanWords(toll.lasts!)}, each vote on a Move another player casts on that post pays you ${tollShare()}, on top of everything its caster earns: the caster loses nothing. A Move cast by one of your own characters pays you nothing. It costs nothing more to use.`,
  logPlay: () => `Until it ends, each vote on a Move another player casts on that post pays you ${tollShare()}.`,
};
