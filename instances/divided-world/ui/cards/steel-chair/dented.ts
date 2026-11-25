/**
 * Steel Chair's status in words, "Dented by 2 chairs and a trash can": shared by the card's entry (ui.ts) and its Lens state
 * (ui/steel-chair/Effect.tsx), so the two never say different things about one post.
 */
import { listWords } from '../words.ts';
import { objectOf, type ThrownObject } from '../../steel-chair/objects.ts';

/* Each object's name in a status: singular, then plural. */
const NAMES: Record<ThrownObject, readonly [string, string]> = {
  chair: ['chair', 'chairs'],
  ladder: ['ladder', 'ladders'],
  can: ['trash can', 'trash cans'],
  extinguisher: ['fire extinguisher', 'fire extinguishers'],
};

/** "Dented by" and the objects that dented the post, counting repeats, each kind named once in the order its first play appears. */
export function dentedBy(plays: readonly { readonly id: string }[]): string {
  const counts = new Map<ThrownObject, number>();
  for (const play of plays) {
    const object = objectOf(play.id);
    counts.set(object, (counts.get(object) ?? 0) + 1);
  }
  if (counts.size === 0) return 'Dented by a chair';
  return `Dented by ${listWords([...counts].map(([object, n]) => (n === 1 ? `a ${NAMES[object][0]}` : `${n} ${NAMES[object][1]}`)))}`;
}
