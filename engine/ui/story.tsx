/**
 * What a story gives the composition root that renders it (.storybook/preview.tsx): a seed for an
 * in-memory world, written against the instance it is handed. A story imports no instance; where it must
 * draw one particular card it names the card's key, and fails if the instance it is handed has none.
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
  /**
   * A board story's moment (`Boards/03 React`): the name of a moment of the composition root's
   * boards fixture, which the preview seeds in place of `world`, with the fake's clock at that
   * moment and its account signed in, and opens at the moment's route, so the story shows the
   * season the board match holds the app to. The engine names the moment and never the fixture's data.
   */
  readonly moment?: string;
}

/** The entry of this key in a list; `what` is the noun the error names it by. */
function keyed<T extends { readonly key: string }>(list: readonly T[], key: string, what: string): T {
  const found = list.find((entry) => entry.key === key);
  if (!found) throw new Error(`the instance has no ${what} "${key}", which this story names`);
  return found;
}

/** The instance's card of this key; the story fails, naming it, when the instance has none. */
export function cardOf<T extends { readonly key: string }>(cards: readonly T[], key: string): T { return keyed(cards, key, 'card'); }

/** The instance's class of this key, the same way. */
export function classOf<T extends { readonly key: string }>(classes: readonly T[], key: string): T { return keyed(classes, key, 'class'); }

/** The card the ordinary player holds: any card would do for the HUD, and naming one keeps the hand still when a card is added. */
const HELD = '4d-chess';

/** A player with two characters that can act, a wallet, cards and an estimate: the ordinary signed-in HUD. */
export const playerWorld: World = (fake, instance) => {
  const [a, b] = instance.classes;
  const me = fake.seed.account('story-player');
  fake.seed.character(me, 'Pipewrench', a!.key);
  fake.seed.character(me, 'Mrs. Hooligan', (b ?? a)!.key);
  fake.seed.settle({ wallet: { [me]: 240 } });
  fake.seed.cards(me, { [cardOf(instance.cards, HELD).key]: 2 });
  fake.seed.estimate(me, { entries: [{ character: 'x', reason: `${a!.key}.story`, amount: 85 }] });
  fake.signInAs(me);
};
