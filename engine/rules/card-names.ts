/**
 * What a card key was called, for a screen or a log line that names a card the instance may no longer have: the card's own name, then the
 * name a card's `formerly` gives the key it renamed away from, then the name a `withdrawn` entry kept. Undefined for a key no list holds.
 */
import type { Instance } from './types.ts';

export function cardNameOf(instance: Pick<Instance, 'cards' | 'withdrawn'>, key: string): string | undefined {
  const card = instance.cards.find((c) => c.key === key);
  if (card) return card.name;
  for (const c of instance.cards) {
    const was = c.formerly?.find((f) => f.key === key);
    if (was) return was.name;
  }
  return instance.withdrawn.find((w) => w.key === key)?.name;
}
