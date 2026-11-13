/**
 * How Divided World's packs draw themselves (`InstanceUi.packs`, one entry per `PackRules.key`): a name and its art. The
 * Booster's is a picture of the whole pack and the relief the page's light reads (specs/card-art.md, "A pack"); the coin is its mark.
 */
import type { InstanceUi } from '../../../engine/ui/types.ts';
import boosterPicture from './packs/booster/art.webp?url';
import boosterRelief from './packs/booster/relief.webp?url';
import boosterMark from './packs/booster/mark.svg?url';
import boosterArt from './packs/booster/art.json';

export const packsUi: InstanceUi['packs'] = Object.freeze({
  booster: Object.freeze({
    name: 'Booster',
    art: Object.freeze({ color: '#ffd93d', ink: '#1a1403', picture: boosterPicture, relief: boosterRelief, mark: boosterMark, credit: boosterArt.credit, tagline: 'Five cards, sight unseen.' }),
  }),
});
