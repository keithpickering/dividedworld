/**
 * What a story gives the composition root that renders it (.storybook/preview.tsx): a seed for an
 * in-memory world, written against the instance it is handed, so a story never names an instance.
 * The preview makes a fake backend from the instance, runs the seed, and renders the story inside
 * the router, the context and the player, as the app does.
 */
import type { Instance } from '../rules/types.ts';
import type { Fake } from './data/fake.ts';

export type World = (fake: Fake, instance: Instance) => void;

/** A story's parameters: `world` seeds its backend; `path` is the address it opens at. */
export interface WorldParameters {
  readonly world?: World;
  readonly path?: string;
}

/** A player with two characters that can act, a wallet, cards and an estimate: the ordinary signed-in HUD. */
export const playerWorld: World = (fake, instance) => {
  const [a, b] = instance.classes;
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', a!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key);
  fake.seed.settle({ wallet: { [me]: 240 } });
  fake.seed.cards(me, { [instance.cards[0]?.key ?? 'card']: 2 });
  fake.seed.estimate(me, { entries: [{ character: 'x', reason: `${a!.key}.story`, amount: 85 }] });
  fake.signInAs(me);
};
