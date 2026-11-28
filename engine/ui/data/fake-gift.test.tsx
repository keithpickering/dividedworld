/**
 * A card wrapped in another, as the fake holds it (docs/plans/2026-11-27-season-two-cards-design.md, section 1.4). Its own file, beside fake.test.tsx's play tests,
 * so the screens' imports (Effects.tsx) are not loaded to ask the fake a question about a present.
 */
import { describe, expect, test } from 'vitest';
import type { Instance, Settings } from '../../rules/types.ts';
import { landsOn, type CardEffect, type CardTarget } from '../../rules/cards.ts';
import type { Refusal } from './api.ts';
import { createFake } from './fake.ts';
import { systemSettings, testCosmeticsContent, testSystem, testGroups } from '../../rules/test-system.ts';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, revealPerk: 0.2, debateDays: 3, reactionCap: 3, postEffects: 8, crowdPayEach: 2, crowdFloor: 2, crowdPayMost: 10, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } }, jobGraceMinutes: {},
  hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
  postMaxLength: 50, pollOptionsMax: 10, pollQuestionMax: 200, pollOptionMax: 100, pollLastsMin: { unit: 'hour', count: 1 }, pollLastsMax: { unit: 'day', count: 14 }, titleMaxLength: 20, postsPerPage: 2, hotReplies: 10, searchLanguage: 'english', searchRankPool: 5000, cardSettings: {}, economy: {}, ...systemSettings,
};

const earn = () => [];
const instance: Instance = {
  key: 'test', name: 'Test', withdrawn: [],
  copy: { rosterThreadTitle: 'Season {season}: Roster Report' },
  packs: [], machine: [], ...testCosmeticsContent,
  classes: [{ key: 'face', name: 'Face', earn }, { key: 'heel', name: 'Heel', earn }, { key: 'lurker', name: 'Lurker', earn }],
  cards: [],
  reactions: [
    { key: 'fire', emoji: 'F', quadrant: 'excitedPositive' }, { key: 'tomato', emoji: 'T', quadrant: 'excitedNegative' },
    { key: 'tea', emoji: 'E', quadrant: 'calmPositive' }, { key: 'zzz', emoji: 'Z', quadrant: 'boredNegative' },
  ],
  settings,
  system: testSystem,
  boards: [
    { slug: 'general', name: 'General', description: 'Anything.' },
    { slug: 'announcements', name: 'The System', description: 'Its words.', system: true },
  ],
  ranks: [{ name: 'Jobber', from: 0 }],
  pipStyles: [{ key: 'default', name: 'Default', full: 'f.svg', empty: 'e.svg' }],
  groups: testGroups,
};

const refused = (error: string, field?: string): Refusal => (field === undefined ? { ok: false, error } : { ok: false, error, field });
const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`expected an answer, got a refusal: ${a.error}`);
  return a.value;
};

describe('a card wrapped in another, as the server holds it (season two design, section 1.4)', () => {
  const okv = <T,>(value: T) => ({ ok: true as const, value });
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => okv(c ?? {}) };
  /* A Move that costs 0.50 more on a long post, a Use that wards, and the present (1.50, one to a post). */
  const blot = { ...base, key: 'blot', name: 'Blot', alignment: 'salty' as const, rarity: 'common' as const, stack: 2, playPrice: (_s: Settings, t: CardTarget) => (t.reach === 'post' && t.length > 20 ? 50 : 0), canApply: () => okv(undefined) };
  const shield = { ...base, key: 'shield', name: 'Shield', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'ward' as const, upTo: 'uncommon' as const }, lasts: { unit: 'day' as const, count: 7 }, canApply: () => okv(undefined) };
  const box = { ...base, key: 'present', name: 'Present For You', alignment: 'sweet' as const, rarity: 'uncommon' as const, wraps: true as const, stack: 1, playPrice: () => 150, canApply: (t: CardTarget, e: readonly CardEffect[], _c: unknown, now?: Date) => landsOn({ key: 'present', stack: 1 }, t, e, now) };
  const world: Instance = { ...instance, cards: [blot, shield, box], settings: { ...settings, economy: {} } };
  function setup(wallet = 600, hand: Record<string, number> = { present: 2, blot: 2 }) {
    const fake = createFake({ instance: world });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'x'.repeat(30));
    fake.seed.cards(ana, hand);
    fake.seed.cards(bo, { shield: 1 });
    fake.seed.wallet(ana, wallet);
    fake.signInAs(ana);
    return { fake, ana, bo, anaFace, boFace, thread, opener };
  }
  const gift = { card: 'blot', config: {} };
  const held = async (fake: { myCards(): Promise<readonly { card: string; held: number }[]> }) => Object.fromEntries((await fake.myCards()).map((c) => [c.card, c.held]));

  test('a box takes two cards and charges its price plus the gift\'s, and its Act and payload hold no gift', async () => {
    const { fake, anaFace, opener } = setup();
    expect(await fake.playCard('present', anaFace, opener, {}, '')).toEqual(refused('Present For You holds a card: choose the card to wrap in it', 'gift'));
    expect(await fake.playCard('blot', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift)).toEqual(refused('only a present holds a card, and Blot is not one', 'gift'));
    expect(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, { card: 'present', config: {} })).toEqual(refused("a present can't hold another present", 'gift'));
    expect(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, { card: 'shield', config: {} })).toEqual(refused('a present holds a Move that is cast on a post', 'gift'));
    expect(await held(fake)).toEqual({ present: 2, blot: 2 });
    const wrapped = must(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift));
    /* The post is 30 characters: the gift's own 0.50 and the box's 1.50. */
    expect((await fake.wallet()).balance).toBe(400);
    expect(await held(fake)).toEqual({ present: 1, blot: 1 });
    expect(JSON.stringify(wrapped)).not.toMatch(/blot|gift/);
    expect(wrapped.payload).toMatchObject({ card: 'present', config: {} });
    for (const a of (await fake.postPlays([opener])).plays) expect(JSON.stringify(a)).not.toMatch(/blot|gift/);
  });

  test('only the post\'s author opens a box; the author\'s open lands the gift as the giver\'s play and frees the box\'s slot', async () => {
    const { fake, ana, bo, anaFace, opener } = setup();
    const wrapped = must(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift));
    expect(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift)).toEqual(refused('this post already carries that card', 'config'));
    expect(await fake.openGift(wrapped.id)).toEqual(refused("only this post's author can open it"));
    fake.signInAs(bo);
    const opened = must(await fake.openGift(wrapped.id));
    expect(opened).toMatchObject({ box: wrapped.id, did: 'landed', why: null });
    expect(opened.gift).toMatchObject({ kind: 'card', character: anaFace, targetActId: opener, payload: { card: 'blot' } });
    expect(await fake.openGift(wrapped.id)).toEqual(refused('this present was already opened or ended'));
    /* Nothing more was charged for the open, and the box's slot is free again for another present. */
    fake.signInAs(ana);
    expect((await fake.wallet()).balance).toBe(400);
    must(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift));
  });

  test('a gift a ward turns away comes back to the giver\'s hand with the ward\'s words', async () => {
    const { fake, ana, bo, boFace, anaFace, opener } = setup();
    const wrapped = must(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift));
    fake.signInAs(bo);
    must(await fake.useCard('shield', boFace, opener, {}, ''));
    const opened = must(await fake.openGift(wrapped.id));
    expect(opened).toMatchObject({ did: 'returned', gift: null, why: 'this post\'s Shield turns away cards up to uncommon' });
    fake.signInAs(ana);
    expect(await held(fake)).toEqual({ present: 1, blot: 2 });
  });

  test('an admin\'s end of an unopened box returns the gift to the giver, and the box can then never be opened', async () => {
    const { fake, ana, bo, anaFace, opener } = setup();
    const wrapped = must(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift));
    const boss = fake.seed.account('boss', { admin: true });
    fake.signInAs(boss);
    must(await fake.reverseCard(wrapped.id));
    fake.signInAs(ana);
    expect(await held(fake)).toEqual({ present: 1, blot: 2 });
    fake.signInAs(bo);
    expect(await fake.openGift(wrapped.id)).toEqual(refused('this present was already opened or ended'));
  });
  test('an open is its own Act, and no feed of an admin\'s ended cards reads it as one', async () => {
    const { fake, ana, bo, boFace, anaFace, opener } = setup();
    const wrapped = must(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift));
    fake.signInAs(bo);
    const opened = must(await fake.openGift(wrapped.id));
    const act = (await fake.characterActs(boFace, ['open_gift'], { offset: 0, limit: 5 }))[0];
    expect(act).toMatchObject({ kind: 'open_gift', targetActId: wrapped.id, payload: { box: wrapped.id, did: 'landed', gift: opened.gift!.id, why: null } });
    /* The box's end rides the reads a page draws plays from, as a card_end does, though it is no admin's. */
    expect((await fake.cardEnds([wrapped.id])).map((a) => [a.kind, a.id])).toEqual([['open_gift', act!.id]]);
    expect((await fake.postPlays([opener])).plays.filter((a) => a.kind === 'open_gift').map((a) => a.id)).toEqual([act!.id]);
    const boss = fake.seed.account('boss', { admin: true });
    fake.signInAs(boss);
    expect((await fake.adminQueue()).ended).toEqual([]);
    for (const who of [ana, bo]) {
      fake.signInAs(who);
      expect((await fake.log(null)).ended).toEqual([]);
    }
  });

  test('a returned open says why in its Act, and an ended box cannot be ended again by an admin: it was opened', async () => {
    const { fake, bo, boFace, anaFace, opener } = setup();
    const wrapped = must(await fake.playCard('present', anaFace, opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift));
    fake.signInAs(bo);
    must(await fake.useCard('shield', boFace, opener, {}, ''));
    const returned = must(await fake.openGift(wrapped.id));
    const act = (await fake.characterActs(boFace, ['open_gift'], { offset: 0, limit: 5 }))[0];
    expect(act?.payload).toMatchObject({ box: wrapped.id, did: 'returned', gift: null, why: returned.why });
    const boss = fake.seed.account('boss', { admin: true });
    fake.signInAs(boss);
    expect(await fake.reverseCard(wrapped.id)).toEqual(refused('that present was already opened'));
  });
  test('a wrap is refused when the giver holds no copy of the gift, or the wallet is short of the box and the gift together, and nothing changes hands', async () => {
    const none = setup(600, { present: 1 });
    expect(await none.fake.playCard('present', none.anaFace, none.opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift)).toEqual(refused('you hold no "blot" card to wrap; the Vending Machine sells them', 'gift'));
    expect(await held(none.fake)).toEqual({ present: 1 });
    expect((await none.fake.wallet()).balance).toBe(600);
    /* The box is 1.50 and the gift 0.50 more on this post: 1.99 pays the box and not both. */
    const poor = setup(199);
    expect(await poor.fake.playCard('present', poor.anaFace, poor.opener, {}, '', 'post', undefined, undefined, undefined, undefined, gift)).toEqual(refused('that costs 2.00, and your wallet holds 1.99'));
    expect(await held(poor.fake)).toEqual({ present: 2, blot: 2 });
    expect((await poor.fake.wallet()).balance).toBe(199);
    expect((await poor.fake.postPlays([poor.opener])).plays).toEqual([]);
  });
});
