/** `instanceUiProblems`, driven red on a poisoned instance: a missing tip key, an extra one, a blank title or line, and no letter. */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { instanceUiProblems } from './problems.ts';
import { ACTION_TIPS, TIP_KEYS } from './keys.ts';
import type { CardUi } from '../cards/types.ts';
import type { FrontDoorUi, InstanceUi, OnboardingUi } from '../types.ts';

const tips = () => Object.fromEntries(TIP_KEYS.map((k) => [k, { title: `T ${k}`, line: `L ${k}`, ...((ACTION_TIPS as readonly string[]).includes(k) ? { action: `A ${k}` } : {}) }])) as unknown as Record<string, { title: string; line: string }>;
/** The rules the front door is held to: two reactions, three ranks and two classes. */
const rules = { reactions: [{ key: 'fire' }, { key: 'tea' }], ranks: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], classes: [{ key: 'face' }, { key: 'heel' }], cards: [{ key: 'feelin-fab', stack: 3 }] } as never;
const goodDoor = (): FrontDoorUi => ({
  title: 'T', label: 'Made up', note: 'N', prompt: { title: 'P', line: 'L' },
  cast: [{ key: 'a', name: 'Ann', rank: 0, posts: 1, revealed: { class: 'heel', at: '2026-10-03T12:00:00Z' } }, { key: 'b', name: 'Bo', rank: 2, posts: 9 }],
  posts: [
    { by: 'a', body: 'Hi', reactions: { fire: 1 } },
    { by: 'b', body: 'Yo', reactions: { tea: 2 }, plays: [{ card: 'whoops', by: 'a', config: { seed: 1 } }] },
  ],
});
const cards = [{ key: 'whoops', status: 'Ink on this post' }] as unknown as readonly CardUi[];
/** Each class's look as the cards need it: how it earns in `description`, what hurts it in `hurtsBy`. */
const looks = (): Record<string, unknown> => ({
  face: { description: () => 'The crowd favorite. Earns from cheers.', hurtsBy: () => 'Hurt by boos.' },
  heel: { description: () => 'Earns heat.', hurtsBy: () => 'Hurt by the polite shrug.' },
});
const copy = { siteName: 'S', siteTagline: 't', roleWord: 'The Boss', staffWord: 'The staff', gameWord: 'the game', staffBoardTag: 'Staff post here; you react and spin', shopName: 'Shop', reducedMotionCard: 'x' };
const ui = (onboarding: unknown, frontDoor: unknown = goodDoor(), marquees?: unknown, badges?: unknown) => ({
  onboarding: onboarding as OnboardingUi, frontDoor: frontDoor as FrontDoorUi, cards, classLooks: looks() as unknown as InstanceUi['classLooks'],
  copy: { ...copy, ...(marquees === undefined ? {} : { marquees: marquees as readonly string[] }), ...(badges === undefined ? {} : { badges: badges as InstanceUi['copy']['badges'] }) },
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
  test("refuses a class with no hurtsBy, naming it: its card could not set the hurt apart", () => {
    const withLooks = (l: Record<string, unknown>) => ({ ...ui(good), classLooks: l as unknown as InstanceUi['classLooks'] });
    const { heel: _heel, ...face } = looks();
    assert.deepEqual(instanceUiProblems(withLooks({ ...face, heel: { description: () => 'Earns heat.' } }), rules), ['the class "heel" has no hurtsBy, so its card cannot set what hurts it apart']);
    assert.deepEqual(instanceUiProblems(withLooks(face), rules), ['the class "heel" has no look, so its card has no earns and no hurtsBy']);
    assert.deepEqual(instanceUiProblems(withLooks({ ...face, heel: { description: () => 'Earns heat.', hurtsBy: () => '  ' } }), rules), ['the class "heel" has a hurtsBy with no words in it']);
  });
  test("refuses a class whose description still says \"Hurt by\": the split was not made, and the hurt would be said twice", () => {
    const withLooks = (l: Record<string, unknown>) => ({ ...ui(good), classLooks: l as unknown as InstanceUi['classLooks'] });
    const problems = instanceUiProblems(withLooks({ ...looks(), face: { description: () => 'The crowd favorite. Earns from cheers. Hurt by boos.', hurtsBy: () => 'Hurt by boos.' } }), rules);
    assert.deepEqual(problems, ['the class "face" has a description that still says "Hurt by"; what hurts it belongs in hurtsBy']);
  });
  test("refuses a card's status that is a sentence or runs past six words, naming the card (the Lens's roles)", () => {
    const withCards = (list: unknown[]) => ({ ...ui(good), cards: [{ key: 'whoops', status: 'Ink on this post' }, ...list] as unknown as readonly CardUi[] });
    const eight = 'Turning away every card up to the rarity';
    assert.deepEqual(instanceUiProblems(withCards([{ key: 'whoops2', status: eight }]), rules), [`the card "whoops2": the status "${eight}" is 8 words, over the 6 a status may run`]);
    const sentence = 'It never holds you: you wrote this post';
    assert.match(instanceUiProblems(withCards([{ key: 'stick-around', status: sentence }]), rules).join('\n'), /the card "stick-around": the status ".*" is a sentence/u);
    assert.deepEqual(instanceUiProblems(withCards([{ key: 'whoops', status: 'Holding you on this post' }, { key: 'bluff', status: 'Set, face down to everyone else' }]), rules), []);
  });
  test("refuses a card with no status, naming it: its Lens heading would be its summary, a sentence", () => {
    const withCards = (list: unknown[]) => ({ ...ui(good), cards: [{ key: 'whoops', status: 'Ink on this post' }, ...list] as unknown as readonly CardUi[] });
    assert.deepEqual(instanceUiProblems(withCards([{ key: 'feelin-fab', summary: 'Gives a post a rainbow. Up to three.' }]), rules), ['the card "feelin-fab" has no status, so its Lens heading would be a sentence']);
  });
  test('refuses a function status that answers with a sentence, naming the card', () => {
    const withCards = (list: unknown[]) => ({ ...ui(good), cards: [{ key: 'whoops', status: 'Ink on this post' }, ...list] as unknown as readonly CardUi[] });
    const problems = instanceUiProblems(withCards([{ key: 'feelin-fab', status: (p: readonly unknown[]) => `Stacked ${p.length}. Grander now.` }]), rules);
    assert.equal(problems.length, 3, 'one for each count it is tried at');
    assert.match(problems[0]!, /^the card "feelin-fab": the status "Stacked 1\. Grander now\." is a sentence/u);
  });
  test("tries a function status at each count up to the card's own stack, not a fixed three", () => {
    const status = (p: readonly unknown[]) => (p.length === 4 ? 'All four. Wow' : `${p.length} of 4 stacked`);
    const withStack = (stack: number) => instanceUiProblems({ ...ui(good), cards: [{ key: 'whoops', status: 'Ink on this post' }, { key: 'feelin-fab', status }] as never }, { ...(rules as object), cards: [{ key: 'feelin-fab', stack }] } as never);
    assert.deepEqual(withStack(3), []);
    assert.match(withStack(4).join('\n'), /the card "feelin-fab": the status "All four\. Wow" is a sentence/u);
  });
  test('holds a status that is a function of the card\'s plays to the same words at each count up to the card\'s stack', () => {
    const withCards = (list: unknown[]) => ({ ...ui(good), cards: [{ key: 'whoops', status: 'Ink on this post' }, ...list] as unknown as readonly CardUi[] });
    const fab = (status: (plays: readonly unknown[]) => string) => withCards([{ key: 'feelin-fab', status }]);
    assert.deepEqual(instanceUiProblems(fab((p) => `${p.length} of 3 stacked`), rules), []);
    assert.match(instanceUiProblems(fab((p) => (p.length === 3 ? 'All three are stacked. Wow' : `${p.length} of 3 stacked`)), rules).join('\n'), /the card "feelin-fab": the status "All three are stacked. Wow" is a sentence/u);
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
  test('passes badges of two short words each, and none at all', () => {
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, [['Game', 'On'], ['Kilter', 'Off']]), rules), []);
  });
  test('refuses an empty badge list, a badge that is not a pair of words, and one too wide for 80 pixels', () => {
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, []), rules), ['the copy has a badges list with nothing in it']);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, [['Game']]), rules), ['the badge 1 is not a pair of words']);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, [['Game', ' ']]), rules), ['the badge 1 is not a pair of words']);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, [['Masks', 'On'], ['Kilterrr', 'Offffff']]), rules), ['the badge "Kilterrr Offffff" is 16 characters, over the 12 an 80 by 15 badge holds']);
  });
  test('refuses more than 6 badges, and a pair listed twice', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((w) => [w, 'On']);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, six), rules), []);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, [...six, ['G', 'On']]), rules), ['the copy has 7 badges, over the 6 a footer row holds']);
    assert.deepEqual(instanceUiProblems(ui(good, goodDoor(), undefined, [['Game', 'On'], ['Kilter', 'Off'], ['Game', 'On']]), rules), ['the badge 3 repeats the badge 1 ("Game On")']);
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
  test('refuses a copy that names no one who speaks for the board', () => {
    for (const key of ['roleWord', 'staffWord', 'gameWord', 'staffBoardTag']) {
      const poisoned = ui(good);
      (poisoned.copy as Record<string, unknown>)[key] = ' ';
      assert.deepEqual(instanceUiProblems(poisoned, rules), [`the copy has no ${key}`]);
    }
  });
  test('refuses a copy key that is missing, and one that is not a string', () => {
    for (const key of ['roleWord', 'staffWord', 'gameWord', 'staffBoardTag']) {
      const missing = ui(good);
      delete (missing.copy as Record<string, unknown>)[key];
      assert.deepEqual(instanceUiProblems(missing, rules), [`the copy has no ${key}`]);
      for (const value of [7, null, ['The staff'], {}]) {
        const odd = ui(good);
        (odd.copy as Record<string, unknown>)[key] = value;
        assert.deepEqual(instanceUiProblems(odd, rules), [`the copy has no ${key}`]);
      }
    }
  });
});
