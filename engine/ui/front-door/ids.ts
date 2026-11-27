/**
 * The ids the front door gives its staged Acts. A play's id is its post's index and its own (`front-door:<post>:<play>`) unless the
 * instance names one, which is kept under a prefix of its own (`front-door:play:<id>`) so it can never meet a post's, a draw's or a cast
 * member's. A card that rolls something from its play's id (a thrown object, say) then rolls what the instance chose, on every load.
 */
import type { Id } from '../data/api.ts';
import type { FrontDoorPost } from '../types.ts';

export const frontDoorId = (key: string): Id => `front-door:${key}`;

/** The id of post `i`'s play `j`: the one the instance named, else its place in the thread. */
export function frontDoorPlayId(i: number, j: number, play: Pick<NonNullable<FrontDoorPost['plays']>[number], 'id'>): Id {
  return frontDoorId(play.id !== undefined ? `play:${play.id}` : `${i}:${j}`);
}
