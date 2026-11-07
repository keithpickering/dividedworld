/**
 * How Divided World's packs draw themselves (`InstanceUi.packs`, one entry per `PackRules.key`): a name and face art, placed as a
 * card's is. The Booster's art is a placeholder; the art is the owner's to give.
 */
import type { InstanceUi } from '../../../engine/ui/types.ts';
import boosterCanvas from './packs/booster/art.svg?url';
import boosterMark from './packs/booster/mark.svg?url';
import boosterArt from './packs/booster/art.json';

export const packsUi: InstanceUi['packs'] = Object.freeze({
  booster: Object.freeze({
    name: 'Booster',
    art: Object.freeze({ color: '#f2c14e', ink: '#1b2a4a', canvas: boosterCanvas, mark: boosterMark, credit: boosterArt.credit, tagline: 'Five cards, sight unseen.' }),
  }),
});
