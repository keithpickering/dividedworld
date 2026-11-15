/** Force Field's entry in the screens' card list (`InstanceUi.cards`): its face and its rules in words. */
import type { CardUi } from '../../../../../engine/ui/cards/types.ts';
import { forceField } from '../../../cards/force-field.ts';
import type { Settings } from '../../../../../engine/rules/types.ts';
import forceFieldCanvas from './art.webp?url';
import forceFieldMark from './mark.svg?url';
import forceFieldArt from './art.json';
import { spanWords } from '../words.ts';

export const ui: CardUi = {
  key: 'force-field',
  art: { color: '#2ee6ff', ink: '#03141a', canvas: forceFieldCanvas, mark: forceFieldMark, credit: forceFieldArt.credit, tagline: 'Turn away cards from your post.' },
  summary: `Used on your post. Turns away cards up to ${forceField.rarity} for ${spanWords(forceField.lasts!)}.`,
  status: `Turning away cards up to ${forceField.rarity}`,
  describe: (settings: Settings) =>
    `A Sweet card, ${forceField.rarity}, used on one of your own posts. For ${spanWords(forceField.lasts!)}, every card cast there that is ${forceField.rarity} or commoner is turned away before it lands, and its caster is told so; a rarer card lands as usual. It never stops a card set face down. It costs nothing more to use.`,
};
