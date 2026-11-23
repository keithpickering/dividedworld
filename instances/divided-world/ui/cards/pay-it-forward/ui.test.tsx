/**
 * Pay It Forward's spring, end to end on the fake with the real instance (docs/plans/2026-11-20-refund-outcome-plan.md, task 9): the setter's face-down back springs on the
 * first Sweet card up to uncommon cast on the post, the cast lands as usual, and its card goes back to its caster's hand. A rarer Sweet card passes over it.
 */
import { describe, expect, test } from 'vitest';
import type { Refusal } from '../../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../../engine/ui/data/fake.ts';
import { instance } from '../../../index.ts';

const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`refused: ${a.error}`);
  return a.value;
};

/**
 * No Sweet card above uncommon reaches a post alone (the rarer ones reach a thread or a character, and a cast on one of those has another target than the post), so the
 * rarer card is the instance's Hype-Up made rare in a copy of the instance: the rarity bound is the trap's, not the card's.
 */
const rarerInstance = { ...instance, cards: instance.cards.map((c) => (c.key === 'hype-up' ? { ...c, rarity: 'rare' as const } : c)) };

function setup(inst = instance) {
  const fake = createFake({ instance: inst });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', instance.classes[0]!.key);
  const boFace = fake.seed.character(bo, 'Bo Face', instance.classes[0]!.key);
  const { act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'Words of Ana\'s post');
  fake.seed.cards(ana, { 'pay-it-forward': 3 });
  fake.seed.cards(bo, { 'hype-up': 3, 'feelin-fab': 3 });
  fake.signInAs(ana);
  return { fake, ana, bo, anaFace, boFace, opener };
}

const held = async (fake: ReturnType<typeof setup>['fake'], card: string) => (await fake.myCards()).find((c) => c.card === card)?.held ?? 0;

describe('Pay It Forward hands a Sweet common back to its caster', () => {
  test('Hype-Up cast on the post lands, carries handedBack, and the hand regains it; the back shows face up', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('pay-it-forward', anaFace, opener, {}));
    fake.signInAs(bo);
    expect(await held(fake, 'hype-up')).toBe(3);
    const landed = must(await fake.playCard('hype-up', boFace, opener, {}, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(landed.payload.handedBack).toEqual({ by: set.id, card: 'pay-it-forward' });
    expect(await held(fake, 'hype-up')).toBe(3);
    const onPost = (await fake.postPlays([opener])).plays;
    expect(onPost.find((a) => a.kind === 'spring')?.payload).toMatchObject({ card: 'pay-it-forward', did: 'returned', set: set.id, by: landed.id });
    expect(onPost.some((a) => a.id === landed.id)).toBe(true);
  });

  test('the back is spent: the next Sweet common on the post lands with no handedBack, and the hand is a card short', async () => {
    /* Hype-Up does not stack on a post (a second is refused as already there), so the next Sweet common is Feelin\' Fab, which stacks. */
    const { fake, bo, anaFace, boFace, opener } = setup();
    must(await fake.setCard('pay-it-forward', anaFace, opener, {}));
    fake.signInAs(bo);
    must(await fake.playCard('hype-up', boFace, opener, {}, ''));
    expect((await fake.playCard('hype-up', boFace, opener, {}, '')).ok).toBe(false);
    const second = must(await fake.playCard('feelin-fab', boFace, opener, {}, ''));
    expect(second.payload.handedBack).toBeUndefined();
    expect(second.payload.caught).toBeUndefined();
    expect(await held(fake, 'feelin-fab')).toBe(2);
  });

  test('a Sweet card above uncommon passes over it: no spring, no handedBack', async () => {
    expect(rarerInstance.cards.find((c) => c.key === 'hype-up')).toMatchObject({ alignment: 'sweet', rarity: 'rare' });
    const { fake, bo, anaFace, boFace, opener } = setup(rarerInstance);
    const set = must(await fake.setCard('pay-it-forward', anaFace, opener, {}));
    fake.signInAs(bo);
    const landed = must(await fake.playCard('hype-up', boFace, opener, {}, ''));
    expect(landed.payload.handedBack).toBeUndefined();
    expect(landed.payload.caught).toBeUndefined();
    expect(await held(fake, 'hype-up')).toBe(2);
    const onPost = (await fake.postPlays([opener])).plays;
    expect(onPost.some((a) => a.kind === 'spring')).toBe(false);
    expect(onPost.some((a) => a.id === set.id)).toBe(true);
  });
});
