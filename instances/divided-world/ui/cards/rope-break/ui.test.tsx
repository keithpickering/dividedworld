/**
 * Rope Break's catch, end to end on the fake with the real instance: the setter's face-down back catches the first Salty common cast on the post and nothing else,
 * and its set form says so in the prep plan's words. The tests name no owner of the caster: a catch is the same whoever cast.
 */
import { describe, expect, test } from 'vitest';
import type { Refusal } from '../../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../../engine/ui/data/fake.ts';
import { springWords } from '../../../../../engine/ui/cards/land.ts';
import { instance } from '../../../index.ts';
import { ropeBreak } from '../../../cards/rope-break.ts';

const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`refused: ${a.error}`);
  return a.value;
};

/** Mooch: Salty, uncommon, cast on a post; it takes the quadrant it mooches as its configuration. */
const mooch = instance.cards.find((c) => c.key === 'mooch');

function setup() {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', instance.classes[0]!.key);
  const boFace = fake.seed.character(bo, 'Bo Face', instance.classes[0]!.key);
  const { act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'Point at these words here');
  fake.seed.cards(ana, { 'rope-break': 3 });
  fake.seed.cards(bo, { whoops: 3, this: 3, mooch: 3 });
  fake.signInAs(ana);
  return { fake, ana, bo, anaFace, boFace, opener };
}

const held = async (fake: ReturnType<typeof setup>['fake'], card: string) => (await fake.myCards()).find((c) => c.card === card)?.held ?? 0;
/** The post's live layers of a card: its plays that landed. A caught play stays on the post as the record of the catch and bears no layer. */
const layersOf = async (fake: ReturnType<typeof setup>['fake'], post: string, card: string) => (await fake.postPlays([post])).plays.filter((a) => a.kind === 'card' && a.payload.card === card && a.payload.caught === undefined);

describe('Rope Break catches a Salty common cast on its post', () => {
  test('Whoops! cast on the post is caught: the setter holds it, the caster does not, and the post bears no layer of it', async () => {
    const { fake, ana, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('rope-break', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('whoops', boFace, opener, { color: 'red' }, ''));
    expect(caught.payload.caught).toBe(set.id);
    expect((await fake.postPlays([opener])).plays.find((a) => a.kind === 'spring')?.payload).toMatchObject({ set: set.id, caught: caught.id });
    fake.signInAs(ana);
    expect(await held(fake, 'whoops')).toBe(1);
    fake.signInAs(bo);
    expect(await held(fake, 'whoops')).toBe(2);
    expect(await layersOf(fake, opener, 'whoops')).toEqual([]);
  });

  test('the back is spent: a second Whoops! on the same post lands', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    must(await fake.setCard('rope-break', anaFace, opener, {}));
    fake.signInAs(bo);
    expect(must(await fake.playCard('whoops', boFace, opener, { color: 'red' }, '')).payload.caught).toBeDefined();
    const second = must(await fake.playCard('whoops', boFace, opener, { color: 'red' }, ''));
    expect(second.payload.caught).toBeUndefined();
    expect(await layersOf(fake, opener, 'whoops')).toHaveLength(1);
  });

  test('THIS, a Pepperoni common, lands on the post and the back stays', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('rope-break', anaFace, opener, {}));
    fake.signInAs(bo);
    const landed = must(await fake.playCard('this', boFace, opener, { phrase: 'these words', words: 'yes' }, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(await layersOf(fake, opener, 'this')).toHaveLength(1);
    expect((await fake.postPlays([opener])).plays.some((a) => a.id === set.id)).toBe(true);
    expect((await fake.postPlays([opener])).plays.some((a) => a.kind === 'spring')).toBe(false);
  });

  test('a Salty card above common lands on the post and the back stays', async () => {
    expect([mooch?.alignment, mooch?.rarity]).toEqual(['salty', 'uncommon']);
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('rope-break', anaFace, opener, {}));
    fake.signInAs(bo);
    const landed = must(await fake.playCard('mooch', boFace, opener, { quadrant: 'excitedPositive' }, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(await layersOf(fake, opener, 'mooch')).toHaveLength(1);
    expect((await fake.postPlays([opener])).plays.some((a) => a.id === set.id)).toBe(true);
    expect((await fake.postPlays([opener])).plays.some((a) => a.kind === 'spring')).toBe(false);
  });

  test('its set form says what it waits for, in the prep plan\'s words', () => {
    expect(springWords(ropeBreak)).toBe('Waits for a Salty card, up to common, to be cast on this post, and takes it.');
  });
});
