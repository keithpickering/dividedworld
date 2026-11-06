/** `instanceUiProblems`, driven red on a poisoned instance: a missing tip key, an extra one, a blank title or line, and no letter. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceUiProblems } from './problems.ts';
import { ACTION_TIPS, TIP_KEYS } from './keys.ts';
import type { CardUi } from '../cards/types.ts';
import type { FrontDoorUi, OnboardingUi } from '../types.ts';

const tips = () => Object.fromEntries(TIP_KEYS.map((k) => [k, { title: `T ${k}`, line: `L ${k}`, ...((ACTION_TIPS as readonly string[]).includes(k) ? { action: `A ${k}` } : {}) }])) as unknown as Record<string, { title: string; line: string }>;
/** The rules the front door is held to: two reactions, three ranks and two classes. */
const rules = { reactions: [{ key: 'fire' }, { key: 'tea' }], ranks: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], classes: [{ key: 'face' }, { key: 'heel' }] } as never;
const goodDoor = (): FrontDoorUi => ({
  title: 'T', label: 'Made up', note: 'N', prompt: { title: 'P', line: 'L' },
  cast: [{ key: 'a', name: 'Ann', rank: 0, posts: 1, revealed: { class: 'heel', at: '2026-10-03T12:00:00Z' } }, { key: 'b', name: 'Bo', rank: 2, posts: 9 }],
  posts: [
    { by: 'a', body: 'Hi', reactions: { fire: 1 } },
    { by: 'b', body: 'Yo', reactions: { tea: 2 }, plays: [{ card: 'whoops', by: 'a', config: { seed: 1 } }] },
  ],
});
const cards = [{ key: 'whoops' }] as unknown as readonly CardUi[];
const copy = { siteName: 'S', siteTagline: 't', shopName: 'Shop', reducedMotionCard: 'x' };
const ui = (onboarding: unknown, frontDoor: unknown = goodDoor(), marquees?: unknown) => ({
  onboarding: onboarding as OnboardingUi, frontDoor: frontDoor as FrontDoorUi, cards,
  copy: { ...copy, ...(marquees === undefined ? {} : { marquees: marquees as readonly string[] }) },
});
const good = { tips: tips(), letter: 'Hi.' };
const door = (change: (d: { -readonly [K in keyof FrontDoorUi]: FrontDoorUi[K] }) => void) => {
  const d = goodDoor() as { -readonly [K in keyof FrontDoorUi]: FrontDoorUi[K] };
  change(d);
  return instanceUiProblems(ui({ tips: tips(), letter: 'Hi.' }, d), rules);
};

describe('instanceUiProblems', () => {
  test('refuses a shine tip with no action label, or a blank one', () => {
    for (const action of [undefined, '  ']) {
      const t = tips();
      t['shine'] = { title: 'T', line: 'L', ...(action === undefined ? {} : { action }) } as never;
      assert.deepEqual(instanceUiProblems(ui({ tips: t, letter: 'Hi.' }), rules), ['the tip "shine" has an action button and no action label']);
    }
  });
  test('passes an instance that fills every tip exactly', () => {
    assert.deepEqual(instanceUiProblems(ui({ tips: tips(), letter: 'Hi.' }), rules), []);
  });
  test('refuses a tip key that is missing, naming it', () => {
    const t = tips();
    delete t['grid'];
    assert.deepEqual(instanceUiProblems(ui({ tips: t, letter: 'Hi.' }), rules), ['the onboarding has no tip "grid"']);
  });
  test('refuses a tip key the engine does not have, naming it', () => {
    const problems = instanceUiProblems(ui({ tips: { ...tips(), 'made-up': { title: 'x', line: 'y' } }, letter: 'Hi.' }), rules);
    assert.deepEqual(problems, ['the onboarding has a tip "made-up", which is not one of the engine\'s tips']);
  });
  test('refuses a tip with a blank title or line', () => {
    const problems = instanceUiProblems(ui({ tips: { ...tips(), ghost: { title: ' ', line: '' } }, letter: 'Hi.' }), rules);
    assert.deepEqual(problems, ['the tip "ghost" has no title', 'the tip "ghost" has no line']);
  });
  test('refuses an instance with no letter, and one with no onboarding at all', () => {
    assert.deepEqual(instanceUiProblems(ui({ tips: tips(), letter: '' }), rules), ['the onboarding has no letter']);
    assert.deepEqual(instanceUiProblems(ui(undefined), rules), ['the instance UI has no onboarding']);
  });

  test('passes a front door whose every name is the instance\'s', () => {
    assert.deepEqual(door(() => {}), []);
  });
  test('refuses a post by a key the cast does not have, naming the post', () => {
    assert.deepEqual(door((d) => { d.posts = [d.posts[0]!, { ...d.posts[1]!, by: 'ghost' }]; }), ['front door post 1 is by "ghost", who is not in the cast']);
  });
  test('refuses a play by a key the cast does not have, naming the post', () => {
    const problems = door((d) => { d.posts = [{ ...d.posts[0]!, plays: [{ card: 'whoops', by: 'ghost', config: {} }] }, d.posts[1]!]; });
    assert.deepEqual(problems, ['front door post 0 has a play by "ghost", who is not in the cast']);
  });
  test('refuses a reaction key the instance does not have, naming the post', () => {
    assert.deepEqual(door((d) => { d.posts = [{ ...d.posts[0]!, reactions: { nope: 1 } }, d.posts[1]!]; }), ['front door post 0 has a reaction "nope", which the instance does not have']);
  });
  test('refuses a play of a card with no CardUi, naming the post', () => {
    const problems = door((d) => { d.posts = [d.posts[0]!, { ...d.posts[1]!, plays: [{ card: 'mystery', by: 'a', config: {} }] }]; });
    assert.deepEqual(problems, ['front door post 1 plays "mystery", which has no CardUi']);
  });
  test('refuses a rank outside the instance\'s ranks, and a duplicate cast key', () => {
    assert.deepEqual(door((d) => { d.cast = [{ ...d.cast[0]!, rank: 3 }, d.cast[1]!]; }), ['front door character "a" has rank 3, which is not one of the instance\'s 3 ranks']);
    assert.deepEqual(door((d) => { d.cast = [d.cast[0]!, { ...d.cast[1]!, key: 'a' }]; }).filter((p) => /twice/u.test(p)), ['front door cast key "a" is used twice']);
  });
  test('refuses a revealed class the instance does not have, and a reveal with no date', () => {
    assert.deepEqual(door((d) => { d.cast = [{ ...d.cast[0]!, revealed: { class: 'wizard', at: '2026-10-03T12:00:00Z' } }, d.cast[1]!]; }), ['front door character "a" is revealed as "wizard", which is not one of the instance\'s classes']);
    assert.deepEqual(door((d) => { d.cast = [{ ...d.cast[0]!, revealed: { class: 'heel', at: 'soon' } }, d.cast[1]!]; }), ['front door character "a" is revealed on "soon", which is not a date']);
  });
  test('refuses a front door with no posts, and an instance with no front door', () => {
    assert.deepEqual(door((d) => { d.posts = []; }), ['the front door has no posts']);
    assert.deepEqual(instanceUiProblems(ui({ tips: tips(), letter: 'Hi.' }, null), rules), ['the instance UI has no front door']);
  });
  test('passes a marquee list of names within 20 characters, and no list at all', () => {
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), ['AURA-MATIC 3000', 'NO FOOD, ONLY CARDS']), rules), []);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), ['X'.repeat(20)]), rules), []);
  });
  test('refuses an empty marquee list', () => {
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), []), rules), ['the copy has a marquees list with nothing in it']);
  });
  test('refuses a marquee that is empty after trimming, naming its place', () => {
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), ['OK', '  ']), rules), ['the marquee 2 is empty']);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), ['']), rules), ['the marquee 1 is empty']);
  });
  test('refuses a marquee over 20 characters, naming it', () => {
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), ['X'.repeat(21)]), rules), [`the marquee "${'X'.repeat(21)}" is 21 characters, over the 20 the sign holds`]);
  });
});
