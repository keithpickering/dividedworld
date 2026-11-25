/**
 * What a Steel Chair play throws: nine plays in ten a chair, the rest a can, a ladder or a fire extinguisher.
 *
 * The object is rolled from the play's id, not stored and not rolled per load. A play is the same object for every reader, on every load and
 * replay, in its thread, in a spun thread's ORIGIN box and in moments, while where it lands stays each run's own. A play's id is made by the
 * server, so nobody can fish for the rare ones by choosing it. Rolled-and-stored would need a config field and only pays if the object changed
 * the card's rules; rolled per load would flip what a reader had already seen. The salt `object` keeps this draw apart from the dent's
 * (`dent`, dent.ts) and from the settle sounds' seed, so a play's object says nothing about its dent.
 */
import { rng } from './body.ts';
import { seedOfIds } from './seed.ts';

export type ThrownObject = 'chair' | 'can' | 'ladder' | 'extinguisher';

/** The table, in the order its weights are walked, out of 1000. */
export const OBJECTS: readonly { readonly object: ThrownObject; readonly weight: number }[] = Object.freeze([
  Object.freeze({ object: 'chair' as const, weight: 900 }),
  Object.freeze({ object: 'can' as const, weight: 40 }),
  Object.freeze({ object: 'ladder' as const, weight: 40 }),
  Object.freeze({ object: 'extinguisher' as const, weight: 20 }),
]);

const TOTAL = OBJECTS.reduce((sum, o) => sum + o.weight, 0);

/** The objects already rolled: a render asks once per play, so this only saves the recomputation (as Effect.tsx's `shapeOf` does). */
const rolled = new Map<string, ThrownObject>();

export function objectOf(playId: string): ThrownObject {
  let object = rolled.get(playId);
  if (!object) {
    if (rolled.size > 300) rolled.clear();
    const draw = rng(seedOfIds(['object', playId]))() * TOTAL;
    let upTo = 0;
    object = OBJECTS[OBJECTS.length - 1]!.object;
    for (const o of OBJECTS) {
      upTo += o.weight;
      if (draw < upTo) { object = o.object; break; }
    }
    rolled.set(playId, object);
  }
  return object;
}
