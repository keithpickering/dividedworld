/** The fabric a play of It's Curtains hangs, as the screens read it: one of the listed fabrics, red where the play's configuration names none the screens know. */
import type { CardPlay } from '../../../../engine/ui/cards/types.ts';
import { FABRICS, type Fabric } from '../../cards/its-curtains.ts';

export const isFabric = (fabric: unknown): fabric is Fabric => typeof fabric === 'string' && Object.prototype.hasOwnProperty.call(FABRICS, fabric);

export const fabricOf = (play: Pick<CardPlay, 'config'>): Fabric => {
  const fabric = (play.config as { fabric?: unknown }).fabric;
  return isFabric(fabric) ? fabric : 'red';
};
