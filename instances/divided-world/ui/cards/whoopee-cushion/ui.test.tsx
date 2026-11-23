/**
 * Whoopee Cushion's ride, end to end on the fake with the real instance: the setter's face-down back springs on the first common card cast on the post,
 * of any flavor, lets it land and rides it; a card above common passes over it. The tests name no owner of the caster: a spring is the same whoever cast.
 */
import { describe, expect, test } from 'vitest';
import type { Refusal } from '../../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../../engine/ui/data/fake.ts';
import { springWords } from '../../../../../engine/ui/cards/land.ts';
import { instance } from '../../../index.ts';
import { whoopeeCushion } from '../../../cards/whoopee-cushion.ts';

const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`refused: ${a.error}`);
  return a.value;
};

const cushion = instance.cards.find((c) => c.key === 'whoopee-cushion');
/** Mooch: Salty, uncommon, cast on a post; it takes the quadrant it mooches as its configuration. Found from the instance, as the plan asks. */
const mooch = instance.cards.find((c) => c.key === 'mooch');

function setup() {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', instance.classes[0]!.key);
  const boFace = fake.seed.character(bo, 'Bo Face', instance.classes[0]!.key);
  const { act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'Point at these words here');
  fake.seed.cards(ana, { 'whoopee-cushion': 3 });
  fake.seed.cards(bo, { whoops: 3, this: 3, mooch: 3 });
  fake.signInAs(ana);
  return { fake, ana, bo, anaFace, boFace, opener };
}

const held = async (fake: ReturnType<typeof setup>['fake'], card: string) => (await fake.myCards()).find((c) => c.card === card)?.held ?? 0;
/** The post's live layers of a card: its plays that landed. A ridden play lands and bears its layer. */
const layersOf = async (fake: ReturnType<typeof setup>['fake'], post: string, card: string) => (await fake.postPlays([post])).plays.filter((a) => a.kind === 'card' && a.payload.card === card);
const springsOn = async (fake: ReturnType<typeof setup>['fake'], post: string) => (await fake.postPlays([post])).plays.filter((a) => a.kind === 'spring');

describe('Whoopee Cushion rides the first common card cast on its post', () => {
  test('the instance has the card, and mooch is a Salty card above common', () => {
    expect(cushion).toBeDefined();
    expect([mooch?.alignment, mooch?.rarity]).toEqual(['salty', 'uncommon']);
  });

  test('Whoops! cast on the post springs it: the play carries rode and a layer, the setter holds no Whoops!, and the spring has no quadrant', async () => {
    const { fake, ana, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('whoopee-cushion', anaFace, opener, {}));
    fake.signInAs(bo);
    const rode = must(await fake.playCard('whoops', boFace, opener, { color: 'red' }, ''));
    expect(rode.payload.rode).toBe(set.id);
    expect(rode.payload.caught).toBeUndefined();
    expect(await layersOf(fake, opener, 'whoops')).toHaveLength(1);
    const springs = await springsOn(fake, opener);
    expect(springs).toHaveLength(1);
    expect(springs[0]!.payload).toMatchObject({ set: set.id, did: 'rode' });
    expect('quadrant' in springs[0]!.payload).toBe(false);
    fake.signInAs(ana);
    expect(await held(fake, 'whoops')).toBe(0);
    fake.signInAs(bo);
    expect(await held(fake, 'whoops')).toBe(2); // the cast spent one; a ride moves none to the setter
  });

  test('the back is spent: a second Whoops! by the same caster lands with no rode', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    must(await fake.setCard('whoopee-cushion', anaFace, opener, {}));
    fake.signInAs(bo);
    expect(must(await fake.playCard('whoops', boFace, opener, { color: 'red' }, '')).payload.rode).toBeDefined();
    const second = must(await fake.playCard('whoops', boFace, opener, { color: 'red' }, ''));
    expect(second.payload.rode).toBeUndefined();
    expect(await layersOf(fake, opener, 'whoops')).toHaveLength(2);
    expect(await springsOn(fake, opener)).toHaveLength(1);
  });

  test('THIS, a Pepperoni common, springs it the same way: any flavor', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('whoopee-cushion', anaFace, opener, {}));
    fake.signInAs(bo);
    const rode = must(await fake.playCard('this', boFace, opener, { phrase: 'these words', words: 'yes' }, ''));
    expect(rode.payload.rode).toBe(set.id);
    expect(await layersOf(fake, opener, 'this')).toHaveLength(1);
    const springs = await springsOn(fake, opener);
    expect(springs[0]?.payload).toMatchObject({ set: set.id, did: 'rode' });
    expect('quadrant' in (springs[0]?.payload ?? {})).toBe(false);
  });

  test('a Salty card above common lands on the post and the back stays', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('whoopee-cushion', anaFace, opener, {}));
    fake.signInAs(bo);
    const landed = must(await fake.playCard('mooch', boFace, opener, { quadrant: 'excitedPositive' }, ''));
    expect(landed.payload.rode).toBeUndefined();
    expect(await layersOf(fake, opener, 'mooch')).toHaveLength(1);
    expect((await fake.postPlays([opener])).plays.some((a) => a.id === set.id)).toBe(true);
    expect(await springsOn(fake, opener)).toEqual([]);
  });

  test('its set form says what it waits for and pays, in the plan\'s words', () => {
    expect(springWords(whoopeeCushion)).toBe('Waits for a card up to common to be cast on this post, lets it land, and pays you a quarter of a vote for each vote it draws.');
  });
});
