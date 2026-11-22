/**
 * Pop Steal's catch, end to end on the fake with the real instance: the setter's face-down back catches the first Sweet common cast on the post and nothing else,
 * and its set form says so in the prep plan's words. The tests name no owner of the caster: a catch is the same whoever cast.
 */
import { describe, expect, test } from 'vitest';
import type { Refusal } from '../../../../../engine/ui/data/api.ts';
import { createFake } from '../../../../../engine/ui/data/fake.ts';
import { springWords } from '../../../../../engine/ui/cards/land.ts';
import { instance } from '../../../index.ts';
import { popSteal } from '../../../cards/pop-steal.ts';

const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`refused: ${a.error}`);
  return a.value;
};

/** Jimmy Wails: Sweet, uncommon, cast on a post. */
const jimmy = instance.cards.find((c) => c.key === 'jimmy-wails');

function setup() {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', instance.classes[0]!.key);
  const boFace = fake.seed.character(bo, 'Bo Face', instance.classes[0]!.key);
  const { act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'Point at these words here');
  fake.seed.cards(ana, { 'pop-steal': 3 });
  fake.seed.cards(bo, { 'hype-up': 3, whoops: 3, this: 3, 'jimmy-wails': 3 });
  fake.signInAs(ana);
  return { fake, ana, bo, anaFace, boFace, opener };
}

const held = async (fake: ReturnType<typeof setup>['fake'], card: string) => (await fake.myCards()).find((c) => c.card === card)?.held ?? 0;
/** The post's live layers of a card: its plays that landed. A caught play stays on the post as the record of the catch and bears no layer. */
const layersOf = async (fake: ReturnType<typeof setup>['fake'], post: string, card: string) => (await fake.postPlays([post])).plays.filter((a) => a.kind === 'card' && a.payload.card === card && a.payload.caught === undefined);

describe('Pop Steal catches a Sweet common cast on its post', () => {
  test('Hype-Up cast on the post is caught: the setter holds it, the caster does not, and the post bears no layer of it', async () => {
    const { fake, ana, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('pop-steal', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('hype-up', boFace, opener, {}, ''));
    expect(caught.payload.caught).toBe(set.id);
    expect((await fake.postPlays([opener])).plays.find((a) => a.kind === 'spring')?.payload).toMatchObject({ set: set.id, caught: caught.id });
    fake.signInAs(ana);
    expect(await held(fake, 'hype-up')).toBe(1);
    fake.signInAs(bo);
    expect(await held(fake, 'hype-up')).toBe(2);
    expect(await layersOf(fake, opener, 'hype-up')).toEqual([]);
  });

  test('the back is spent: a second Hype-Up on the same post lands', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    must(await fake.setCard('pop-steal', anaFace, opener, {}));
    fake.signInAs(bo);
    expect(must(await fake.playCard('hype-up', boFace, opener, {}, '')).payload.caught).toBeDefined();
    const second = must(await fake.playCard('hype-up', boFace, opener, {}, ''));
    expect(second.payload.caught).toBeUndefined();
    expect(await layersOf(fake, opener, 'hype-up')).toHaveLength(1);
  });

  test('Whoops!, a Salty common, lands on the post and the back stays', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('pop-steal', anaFace, opener, {}));
    fake.signInAs(bo);
    const landed = must(await fake.playCard('whoops', boFace, opener, { color: 'red' }, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(await layersOf(fake, opener, 'whoops')).toHaveLength(1);
    expect((await fake.postPlays([opener])).plays.some((a) => a.id === set.id)).toBe(true);
    expect((await fake.postPlays([opener])).plays.some((a) => a.kind === 'spring')).toBe(false);
  });

  test('a Sweet card above common lands on the post and the back stays', async () => {
    expect([jimmy?.alignment, jimmy?.rarity]).toEqual(['sweet', 'uncommon']);
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('pop-steal', anaFace, opener, {}));
    fake.signInAs(bo);
    const landed = must(await fake.playCard('jimmy-wails', boFace, opener, {}, 'Please, a friend needs a hand'));
    expect(landed.payload.caught).toBeUndefined();
    expect(await layersOf(fake, opener, 'jimmy-wails')).toHaveLength(1);
    expect((await fake.postPlays([opener])).plays.some((a) => a.id === set.id)).toBe(true);
    expect((await fake.postPlays([opener])).plays.some((a) => a.kind === 'spring')).toBe(false);
  });

  test('its set form says what it waits for, in the prep plan\'s words', () => {
    expect(springWords(popSteal)).toBe('Waits for a Sweet card, up to common, to be cast on this post, and takes it.');
  });
});
