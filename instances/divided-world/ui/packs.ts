/**
 * How Divided World's packs draw themselves (`InstanceUi.packs`, one entry per `PackRules.key`): a name and face art, placed as a
 * card's is. The Booster's art is a placeholder (a foil wrapper, with the coin as its mark); the art is the owner's to give.
 */
import type { InstanceUi } from '../../../engine/ui/types.ts';
import boosterCanvas from './packs/booster/art.svg?url';
import boosterMark from './packs/booster/mark.svg?url';
import boosterArt from './packs/booster/art.json';

export const packsUi: InstanceUi['packs'] = Object.freeze({
  booster: Object.freeze({
    name: 'Booster',
    art: Object.freeze({ color: '#ffd93d', ink: '#1a1403', canvas: boosterCanvas, mark: boosterMark, credit: boosterArt.credit, tagline: 'Five cards, sight unseen.' }),
  }),
});
