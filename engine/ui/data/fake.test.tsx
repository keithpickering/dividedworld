/**
 * The in-memory backend holds what the server holds, in the server's words: every refusal below is
 * the sentence supabase/migrations and engine/rules/actions.ts raise, so a screen tested against
 * the fake meets the refusals it will meet live. A `.test.tsx` file though it holds no JSX, because
 * `test:engine` runs `engine/**\/*.test.ts` under plain node and this runs under jsdom with the screens'.
 */
import { describe, expect, test, vi } from 'vitest';
import type { Instance, Settings } from '../../rules/types.ts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { landsOn, ok, quadrantFree, refuse, refusalTime, type CardEffect, type CardRules, type CardTarget } from '../../rules/cards.ts';
import { cellsOf, count } from '../../rules/surface.ts';
import { momentParts } from '../cards/Effects.tsx';
import type { CardUi } from '../cards/types.ts';
import { failureKind, NOT_SENT, ReadFailure } from './api.ts';
import type { Act, Refusal, Slot, Tally } from './api.ts';
import { TIP_KEYS } from '../tips/keys.ts';
import { createFake, FAKE_BACKEND_MARKER, START, TEST_CODE, TEST_LINK } from './fake.ts';
import { cutLog, LOG_ROWS, micros } from './log-page.ts';
import { targetOf as targetOf2 } from '../cards/land.ts';
import { actsFollowed, actsNamed } from '../log/lines.ts';
import { systemSettings, testCosmeticsContent, testSystem, testGroups } from '../../rules/test-system.ts';
import { ENGINE_DEFAULT_PRONOUNS, PRONOUN_PRESETS } from '../../rules/pronouns.ts';
import { localReaction } from '../../rules/emoji.ts';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, revealPerk: 0.2, debateDays: 3, reactionCap: 3, postEffects: 8, crowdPayEach: 2, crowdFloor: 2, crowdPayMost: 10, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } },
  hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
  postMaxLength: 50, pollOptionsMax: 10, pollQuestionMax: 200, pollOptionMax: 100, pollLastsMin: { unit: 'hour', count: 1 }, pollLastsMax: { unit: 'day', count: 14 }, titleMaxLength: 20, postsPerPage: 2, hotReplies: 10, searchLanguage: 'english', searchRankPool: 5000, cardSettings: {}, economy: {}, ...systemSettings,
};

const earn = () => [];
const instance: Instance = {
  key: 'test', name: 'Test', withdrawn: [],
  copy: { announcementsThreadTitle: 'Promos {season}' },
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

const DAY = 86_400_000;
const MINUTE = 60_000;
const refused = (error: string, field?: string): Refusal => (field === undefined ? { ok: false, error } : { ok: false, error, field });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** The on-sale slot that sells a card, as the machine shows it now. */
const slotOf = async (fake: { machine(): Promise<readonly Slot[]> }, card: string): Promise<Slot> => (await fake.machine()).find((m) => 'card' in m.item && m.item.card === card)!;
const must = <T,>(a: { ok: true; value: T } | Refusal): T => {
  if (!a.ok) throw new Error(`expected an answer, got a refusal: ${a.error}`);
  return a.value;
};

/** Ana and Bo, two players; Ana plays Ana Face and Ana Heel, Bo plays Bo Face; a thread on General, signed in as Ana. */
function world(overrides: Partial<Settings> = {}) {
  const fake = createFake({ instance, settings: overrides });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
  const anaHeel = fake.seed.character(ana, 'Ana Heel', 'heel');
  const boFace = fake.seed.character(bo, 'Bo Face', 'face');
  const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
  fake.signInAs(ana);
  return { fake, ana, bo, anaFace, anaHeel, boFace, thread, opener };
}

describe('the fake carries a marker the production bundle is checked for', () => {
  test('the object createFake returns holds KAYFA_FAKE_BACKEND as a value, which a bundler cannot drop with an unused export', () => {
    expect(FAKE_BACKEND_MARKER).toBe('KAYFA_FAKE_BACKEND');
    expect(createFake({ instance }).marker).toBe('KAYFA_FAKE_BACKEND');
  });
});

describe('a thread\'s replies this week are counted only up to hotReplies, as thread_list counts them', () => {
  test('a thread with more recent replies than the threshold reads the threshold, and replies stays the whole count', async () => {
    const { fake, anaFace, thread } = world();
    for (let i = 0; i < 12; i++) fake.seed.post(thread, anaFace, `reply ${i}`);
    const row = await fake.thread(thread);
    expect(row?.replies).toBe(12);
    expect(row?.repliesThisWeek).toBe(10);
    const few = world();
    for (let i = 0; i < 4; i++) few.fake.seed.post(few.thread, few.anaFace, `reply ${i}`);
    expect((await few.fake.thread(few.thread))?.repliesThisWeek).toBe(4);
  });
});

describe('refusing a post in the server\'s words', () => {
  test('an empty body, a long one, and a title', async () => {
    const { fake, anaFace, thread } = world();
    expect(await fake.post(thread, anaFace, '  ​ ', null)).toEqual(refused('is empty', 'body'));
    expect(await fake.post(thread, anaFace, 'x'.repeat(51), null)).toEqual(refused('is longer than 50 characters', 'body'));
    expect(await fake.startThread('general', anaFace, '', 'hi')).toEqual(refused('is empty', 'title'));
    expect(await fake.startThread('general', anaFace, 'y'.repeat(21), 'hi')).toEqual(refused('is longer than 20 characters', 'title'));
  });
  test('The System\'s board takes no post and no new thread', async () => {
    const { fake, anaFace } = world();
    const { thread } = fake.seed.thread('announcements', null, 'Tally', 'Settled.');
    const words = 'only the staff post here; spin a thread from what they said';
    expect(await fake.post(thread, anaFace, 'hello', null)).toEqual(refused(words));
    expect(await fake.startThread('announcements', anaFace, 'Mine', 'hello')).toEqual(refused(words));
  });
  test('a waiting character, a retired one, and one that is not yours', async () => {
    const { fake, ana, thread, boFace, anaFace } = world();
    const waiting = fake.seed.character(ana, 'Waiting One', 'lurker', { debuted: false });
    const gone = fake.seed.character(ana, 'Gone One', 'lurker', { retired: true });
    expect(await fake.post(thread, waiting, 'hi', null)).toEqual(refused('that character debuts at the next settlement'));
    expect(await fake.post(thread, gone, 'hi', null)).toEqual(refused('that character is retired; an admin can restore it'));
    // The same words for another player's character and for one that does not exist: a refusal proves no owner.
    expect(await fake.post(thread, boFace, 'hi', null)).toEqual(refused('you do not play that character'));
    expect(await fake.post(thread, '00000000-0000-4000-8000-00000000ffff', 'hi', null)).toEqual(refused('you do not play that character'));
    expect(await fake.post(thread, anaFace, 'hi', null)).toMatchObject({ ok: true });
  });
  test('signed out, nothing is done', async () => {
    const { fake, anaFace, thread } = world();
    fake.signInAs(null);
    expect(await fake.post(thread, anaFace, 'hi', null)).toEqual(refused('sign in to act'));
  });
  test('a missing thread, board and quote', async () => {
    const { fake, anaFace, thread } = world();
    const nowhere = '00000000-0000-4000-8000-00000000fffe';
    expect(await fake.post(nowhere, anaFace, 'hi', null)).toEqual(refused('there is no such thread'));
    expect(await fake.startThread('nowhere', anaFace, 'T', 'hi')).toEqual(refused('there is no such board'));
    expect(await fake.post(thread, anaFace, 'hi', nowhere)).toEqual(refused('there is no such Act to quote'));
    expect(await fake.spin(nowhere, anaFace, 'T', '')).toEqual(refused('there is no such Act to spin from'));
  });
});

describe('editing', () => {
  test('only your character\'s own post', async () => {
    const { fake, anaFace, anaHeel, opener, thread } = world();
    expect(await fake.edit(opener, anaFace, 'mine now')).toEqual(refused('that is not a post of this character\'s'));
    const mine = must(await fake.post(thread, anaFace, 'mine', null));
    expect(await fake.edit(mine.id, anaHeel, 'as the other mask')).toEqual(refused('that is not a post of this character\'s'));
    expect(await fake.edit(mine.id, anaFace, 'fixed')).toMatchObject({ ok: true });
  });
  test('inside the grace period it shows no "Last edited", after it, it does', async () => {
    const { fake, anaFace, thread } = world();
    const post = must(await fake.post(thread, anaFace, 'teh post', null));
    const first = must(await fake.edit(post.id, anaFace, 'the post'));
    expect(first.id).toBe(post.id);
    expect(first.payload).toEqual({ body: 'teh post' });
    expect(first.currentPayload).toEqual({ body: 'the post' });
    expect(first.editedAt).toBe(new Date(fake.clock.now()).toISOString());
    expect(first.shownEditedAt).toBeNull();
    fake.clock.advance(3 * MINUTE);
    const second = must(await fake.edit(post.id, anaFace, 'the post, again'));
    expect(second.currentPayload).toEqual({ body: 'the post, again' });
    expect(second.shownEditedAt).toBe(new Date(fake.clock.now()).toISOString());
    expect((await fake.act(post.id))!.shownEditedAt).toBe(second.shownEditedAt);
  });
  test('actsById reads the Acts asked for in one call and leaves out those that are not there', async () => {
    const { fake, anaFace, thread } = world();
    const one = must(await fake.post(thread, anaFace, 'one', null));
    const two = must(await fake.post(thread, anaFace, 'two', null));
    const got = await fake.actsById([two.id, '00000000-0000-4000-8000-00000000ffff', one.id]);
    expect(got.map((a) => a.id).sort()).toEqual([one.id, two.id].sort());
    expect(await fake.actsById([])).toEqual([]);
  });
  test('an edit is a version beside its post and no place in the thread', async () => {
    const { fake, anaFace, thread, opener } = world();
    const post = must(await fake.post(thread, anaFace, 'one', null));
    fake.clock.advance(MINUTE);
    await fake.edit(post.id, anaFace, 'two');
    fake.clock.advance(MINUTE);
    await fake.edit(post.id, anaFace, 'three');
    const read = await fake.acts(thread, 1, 99);
    expect(read.map((a) => [a.id, a.seq])).toEqual([[opener, 1], [post.id, 2]]);
    expect(read[1]?.currentPayload).toEqual({ body: 'three' });
    const versions = await fake.history(post.id);
    expect(versions.map((v) => [v.kind, v.payload.body])).toEqual([['post', 'one'], ['edit', 'two'], ['edit', 'three']]);
    expect(versions.map((v) => v.seq)).toEqual([2, null, null]);
    expect((await fake.thread(thread))!.lastSeq).toBe(2);
  });
});

describe('reading a thread by seq', () => {
  test('from one seq to another, both included', async () => {
    const { fake, anaFace, thread } = world();
    for (const body of ['two', 'three', 'four']) await fake.post(thread, anaFace, body, null);
    expect((await fake.acts(thread, 2, 3)).map((a) => a.payload.body)).toEqual(['two', 'three']);
    expect(await fake.acts(thread, 9, 12)).toEqual([]);
  });
  test('a thread lists newest Act first, and an edit does not bump it', async () => {
    const { fake, anaFace, thread } = world();
    fake.clock.advance(DAY);
    const other = fake.seed.thread('general', anaFace, 'Second', 'Newer').thread;
    fake.clock.advance(DAY);
    const mine = must(await fake.post(thread, anaFace, 'bump', null));
    expect((await fake.threads(await boardId(fake, 'general'), { offset: 0, limit: 10 })).threads.map((t) => t.id)).toEqual([thread, other]);
    fake.clock.advance(DAY);
    await fake.edit(mine.id, anaFace, 'edited, not bumped');
    const list = await fake.threads(await boardId(fake, 'general'), { offset: 0, limit: 1 });
    expect(list.total).toBe(2);
    expect(list.threads.map((t) => t.id)).toEqual([thread]);
    expect(list.threads[0]?.lastAct).toBe(mine.id);
  });
  test('a thread\'s last time is its greatest non-edit Act\'s, so a back-dated Act does not move it back', async () => {
    const { fake } = world();
    fake.clock.advance(DAY);
    const opened = fake.clock.now();
    const said = fake.seed.thread('announcements', null, 'Tally', 'Settled.');
    fake.seed.post(said.thread, null, 'seeded long ago', { at: opened - 10 * DAY });
    const system = (await fake.boards()).find((b) => b.slug === 'announcements')!;
    const listed = (await fake.threads(system.id, { offset: 0, limit: 10 })).threads.find((t) => t.id === said.thread)!;
    expect(listed.lastSeq).toBe(2);
    expect(Date.parse(listed.lastAt)).toBe(opened);
  });
  test('a spin from The System\'s board opens on the players\' board', async () => {
    const { fake, anaFace } = world();
    const said = fake.seed.thread('announcements', null, 'Tally', 'Settled.');
    const spun = must(await fake.spin(said.act, anaFace, 'About that', ''));
    expect(spun.thread.board).toBe(await boardId(fake, 'general'));
    expect(spun.thread.originActId).toBe(said.act);
    expect(spun.act.kind).toBe('spin');
    expect(spun.act.seq).toBe(1);
    expect((await fake.spunFrom(said.act)).map((t) => t.id)).toEqual([spun.thread.id]);
  });
});

describe('a spin picks its board (0428_spin_board.sql)', () => {
  /* The shared world with a second player board, "side", and a third, "attic", made in that order. */
  function pickWorld() {
    const wide = { ...instance, boards: [...instance.boards, { slug: 'side', name: 'Side', description: 'Elsewhere.' }, { slug: 'attic', name: 'Attic', description: 'Up.' }] };
    const fake = createFake({ instance: wide });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    fake.signInAs(ana);
    const bar = (board: string, expiresAt: number | null) => {
      const at = Date.now() - 3_600_000;
      return fake.seed.groupMove('boss', { character: anaFace, group: 'trialMembers', board, at, expiresAt });
    };
    fake.seed.staff('boss', 'The Boss', 'boss');
    const counts = async () => ({ threads: (await fake.threads(await boardId(fake, 'general'), { offset: 0, limit: 50 })).total + (await fake.threads(await boardId(fake, 'side'), { offset: 0, limit: 50 })).total, thread: (await fake.thread(thread))?.replies });
    return { fake, ana, anaFace, boFace, thread, opener, bar, counts };
  }
  test('with no board it opens on today\'s board; naming another open board opens it there', async () => {
    const { fake, anaFace, opener, thread } = pickWorld();
    const plain = must(await fake.spin(opener, anaFace, 'Here', 'b'));
    expect(plain.thread.board).toBe(await boardId(fake, 'general'));
    const named = must(await fake.spin(opener, anaFace, 'There', 'b', undefined, undefined, 'side'));
    expect(named.thread.board).toBe(await boardId(fake, 'side'));
    expect(named.thread.originActId).toBe(opener);
    expect(named.act.kind).toBe('spin');
    expect(named.act.seq).toBe(1);
    expect((await fake.thread(named.thread.id))?.originThread).toBe(thread);
  });
  test('a named board that is missing, The System\'s, or closed is refused in the server\'s words and writes nothing', async () => {
    const { fake, anaFace, opener, counts } = pickWorld();
    fake.seed.closeBoard('attic', { fallback: 'general' });
    const before = await counts();
    expect(await fake.spin(opener, anaFace, 'T', 'b', undefined, undefined, 'nowhere')).toEqual(refused('there is no such board'));
    expect(await fake.spin(opener, anaFace, 'T', 'b', undefined, undefined, 'announcements')).toEqual(refused('a thread cannot be spun onto The System\'s board; pick another board'));
    expect(await fake.spin(opener, anaFace, 'T', 'b', undefined, undefined, 'attic')).toEqual(refused('this board was closed, and its threads are in General; start your thread there instead'));
    expect(await counts()).toEqual(before);
  });
  test('a bad origin is told of before a bad board', async () => {
    const { fake, anaFace } = pickWorld();
    expect(await fake.spin('99999999-9999-4999-8999-999999999999', anaFace, 'T', 'b', undefined, undefined, 'nowhere')).toEqual(refused('there is no such Act to spin from'));
  });
  test('a spin is refused a barred board, named or not, and lands on another open board; an apology lands on the board it is barred from', async () => {
    const { fake, anaFace, opener, bar, counts } = pickWorld();
    const move = bar('general', Date.now() + 86_400_000);
    const before = await counts();
    const words = (await fake.spin(opener, anaFace, 'T', 'b')) as { ok: false; error: string };
    expect(words.ok).toBe(false);
    expect(words.error).toMatch(/^Ana Face is barred from posting on General until /);
    expect(await fake.spin(opener, anaFace, 'T', 'b', undefined, undefined, 'general')).toEqual(words);
    expect(await counts()).toEqual(before);
    expect(must(await fake.spin(opener, anaFace, 'Away', 'b', undefined, undefined, 'side')).thread.board).toBe(await boardId(fake, 'side'));
    const sorry = must(await fake.apologize(move, anaFace, 'Sorry', 'I was wrong.', undefined, 'general'));
    expect(sorry.thread.board).toBe(await boardId(fake, 'general'));
    expect((await fake.myApologies(anaFace)).map((a) => a.move)).toEqual([move]);
  });
  test('an apology names a board by the same rules (not The System\'s, not missing), and with none lands where it did', async () => {
    const { fake, anaFace, bar } = pickWorld();
    const move = bar('general', Date.now() + 86_400_000);
    expect(await fake.apologize(move, anaFace, 'Sorry', 'x', undefined, 'announcements')).toEqual(refused('a thread cannot be spun onto The System\'s board; pick another board'));
    expect(await fake.apologize(move, anaFace, 'Sorry', 'x', undefined, 'nowhere')).toEqual(refused('there is no such board'));
    expect(must(await fake.apologize(move, anaFace, 'Sorry', 'x')).thread.board).toBe(await boardId(fake, 'general'));
  });
  test('spinPlaces: today\'s board and the open player boards in order, with the character\'s bars', async () => {
    const { fake, anaFace, opener, bar } = pickWorld();
    expect(await fake.spinPlaces(opener, anaFace)).toEqual({ default: 'general', boards: [
      { slug: 'general', name: 'General', barred: false, until: null }, { slug: 'side', name: 'Side', barred: false, until: null }, { slug: 'attic', name: 'Attic', barred: false, until: null }] });
    const end = Date.now() + 86_400_000;
    bar('side', end);
    bar('attic', null);
    const places = await fake.spinPlaces(opener, anaFace);
    expect(places.boards.map((b) => [b.slug, b.barred, b.until])).toEqual([['general', false, null], ['side', true, new Date(end).toISOString()], ['attic', true, null]]);
    fake.seed.closeBoard('attic', { fallback: 'general' });
    expect((await fake.spinPlaces(opener, anaFace)).boards.map((b) => b.slug)).toEqual(['general', 'side']);
  });
  test('two bars on one board, one that ends and one with no end: the refusal and spinPlaces read the latest end, as max(expires_at) does, and null only when every bar is open', async () => {
    const { fake, anaFace, opener, bar } = pickWorld();
    const end = Math.ceil((Date.now() + 86_400_000) / 60_000) * 60_000;
    bar('general', end);
    bar('general', null);
    const said = (await fake.spin(opener, anaFace, 'T', 'b')) as { ok: false; error: string };
    expect(said.error).toBe(`Ana Face is barred from posting on General until ${new Date(end).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    expect((await fake.spinPlaces(opener, anaFace)).boards[0]).toEqual({ slug: 'general', name: 'General', barred: true, until: new Date(end).toISOString() });
    bar('side', null);
    expect((await fake.spinPlaces(opener, anaFace)).boards[1]).toEqual({ slug: 'side', name: 'Side', barred: true, until: null });
    expect(((await fake.spin(opener, anaFace, 'T', 'b', undefined, undefined, 'side')) as { error: string }).error).toBe('Ana Face is barred from posting on Side until a time not yet set');
  });
  test('a spin with no board whose today\'s board is closed is refused in the closed words, and an apology naming a closed board is too', async () => {
    const { fake, anaFace, opener, thread, bar } = pickWorld();
    const move = bar('general', Date.now() + 86_400_000);
    fake.seed.closeBoard('attic', { fallback: 'side' });
    /* A thread left on a board that has since closed (the seed puts it there, as a race with the close would): today's board is the closed one. */
    fake.seed.moveThread(thread, 'attic');
    const words = 'this board was closed, and its threads are in Side; start your thread there instead';
    expect(await fake.spin(opener, anaFace, 'T', 'b')).toEqual(refused(words));
    expect(await fake.apologize(move, anaFace, 'Sorry', 'x', undefined, 'attic')).toEqual(refused(words));
    expect(await fake.spunFrom(opener)).toEqual([]);
    expect(await fake.myApologies(anaFace)).toEqual([]);
  });
  test('spinPlaces from The System\'s board defaults to the players\' board; a missing Act answers a null default and the list', async () => {
    const { fake, anaFace } = pickWorld();
    const said = fake.seed.thread('announcements', null, 'Tally', 'Settled.');
    expect((await fake.spinPlaces(said.act, anaFace)).default).toBe('general');
    const none = await fake.spinPlaces('99999999-9999-4999-8999-999999999999', anaFace);
    expect(none.default).toBeNull();
    expect(none.boards).toHaveLength(3);
  });
  test('an origin place carries the origin thread\'s board, except an update\'s', async () => {
    const { fake, anaFace, opener, thread } = pickWorld();
    const general = await boardId(fake, 'general');
    const origin = async (o: string) => (await fake.thread(must(await fake.spin(o, anaFace, 'Spun', 'b', undefined, undefined, 'side')).thread.id))?.origin;
    expect(await origin(opener)).toEqual({ kind: 'post', thread, title: 'Hello', seq: 1, board: general });
    expect(await origin(fake.seed.card(anaFace, opener, 'whoops'))).toEqual({ kind: 'play', card: 'whoops', on: { kind: 'post', thread, title: 'Hello', seq: 1 }, from: null, at: null, board: general });
    const update = fake.seed.update({ title: 'Traps bite', body: 'Hi.' });
    expect(await origin(update)).toEqual({ kind: 'update', act: update, title: 'Traps bite' });
    const said = fake.seed.thread('announcements', null, 'Tally', 'Settled.');
    expect(await origin(said.act)).toEqual({ kind: 'post', thread: said.thread, title: 'Tally', seq: 1, board: await boardId(fake, 'announcements') });
  });
});

async function boardId(fake: ReturnType<typeof createFake>, slug: string): Promise<string> {
  const boards = await fake.boards();
  return boards.find((b) => b.slug === slug)!.id;
}

describe('reacting', () => {
  test('an unknown kind', async () => {
    const { fake, anaFace, opener } = world();
    expect(await fake.react(opener, anaFace, 'rocket')).toEqual(refused('there is no reaction "rocket"', 'kind'));
  });
  test('your characters cannot react to each other', async () => {
    const { fake, anaFace, anaHeel, thread } = world();
    const mine = must(await fake.post(thread, anaFace, 'mine', null));
    const words = 'your characters cannot react to each other';
    expect(await fake.react(mine.id, anaHeel, 'fire')).toEqual(refused(words));
    expect(await fake.react(mine.id, anaFace, 'fire')).toEqual(refused(words));
  });
  test('the same reaction twice, across the account\'s characters', async () => {
    const { fake, anaFace, anaHeel, opener } = world();
    must(await fake.react(opener, anaFace, 'fire'));
    expect(await fake.react(opener, anaHeel, 'fire')).toEqual(refused('you have already left that reaction here'));
  });
  test('the most there are, across all the account\'s characters', async () => {
    const { fake, anaFace, anaHeel, opener } = world();
    must(await fake.react(opener, anaFace, 'fire'));
    must(await fake.react(opener, anaHeel, 'tomato'));
    must(await fake.react(opener, anaFace, 'tea'));
    expect(await fake.react(opener, anaHeel, 'zzz')).toEqual(refused('you have left 3 reactions here, the most there are'));
  });
  test('an edit is not reacted to', async () => {
    const { fake, bo, anaFace, boFace, thread } = world();
    const post = must(await fake.post(thread, anaFace, 'one', null));
    must(await fake.edit(post.id, anaFace, 'two'));
    const edit = (await fake.history(post.id))[1]!;
    fake.signInAs(bo);
    expect(await fake.react(edit.id, boFace, 'fire')).toEqual(refused('an edit is not reacted to; react to the post'));
  });
  test('The System\'s own Acts can be reacted to', async () => {
    const { fake, anaFace } = world();
    const said = fake.seed.thread('announcements', null, 'Tally', 'Settled.');
    expect(await fake.react(said.act, anaFace, 'fire')).toMatchObject({ ok: true });
  });
  test('tallies are counts of kinds, and converge whatever order the live events come in', async () => {
    const { fake, anaFace, boFace, ana, bo } = world();
    const { thread, act: opener } = fake.seed.thread('announcements', null, 'Tally', 'Settled.');
    const seen: Record<string, number> = {};
    const stop = fake.subscribeThread(thread, {
      onTally: (act, tally: Tally) => {
        if (act !== opener) return;
        for (const [kind, count] of Object.entries(tally)) seen[kind] = Math.max(seen[kind] ?? 0, count);
      },
    });
    fake.broadcast.hold();
    must(await fake.react(opener, anaFace, 'fire'));
    fake.signInAs(bo);
    const last = must(await fake.react(opener, boFace, 'fire'));
    expect(last.tally).toEqual({ fire: 2 });
    expect((await fake.tallies([opener]))[opener]).toEqual({ fire: 2 });
    fake.broadcast.flush({ reverse: true, twice: true });
    await flush();
    expect(seen).toEqual({ fire: 2 });
    stop();
    expect(ana).not.toBe(bo);
  });
  test('your own reactions are yours alone', async () => {
    const { fake, anaFace, bo, opener } = world();
    must(await fake.react(opener, anaFace, 'fire'));
    expect(await fake.myReactions([opener])).toEqual([{ act: opener, kind: 'fire', character: anaFace }]);
    fake.signInAs(bo);
    expect(await fake.myReactions([opener])).toEqual([]);
  });
});

describe('Turns', () => {
  test('to the class it already is', async () => {
    const { fake, anaFace } = world();
    expect(await fake.turn(anaFace, 'face', 'silent', false, false)).toEqual(refused('this character already is one'));
  });
  test('words of the request', async () => {
    const { fake, anaFace } = world();
    expect(await fake.turn(anaFace, 'wrestler', 'silent', false, false)).toEqual(refused('there is no class "wrestler"', 'class'));
    expect(await fake.turn(anaFace, 'heel', 'silent', true, false)).toEqual(refused('a silent Turn names no class', 'showFrom'));
  });
  test('a second ask replaces the waiting Turn; to the class it is, it says to withdraw', async () => {
    const { fake, anaFace } = world();
    const first = must(await fake.turn(anaFace, 'heel', 'silent', false, false));
    expect(first).toEqual({ class: 'heel', loudness: 'silent', showFrom: false, showTo: false, takesEffectAt: null });
    must(await fake.turn(anaFace, 'lurker', 'announced', true, true));
    const mine = (await fake.myCharacters()).find((c) => c.id === anaFace)!;
    expect(mine.class).toBe('face');
    expect(mine.pendingTurn).toEqual({ class: 'lurker', loudness: 'announced', showFrom: true, showTo: true, takesEffectAt: null });
    expect(await fake.turn(anaFace, 'face', 'silent', false, false)).toEqual(refused('this character already is one: withdraw its waiting Turn to keep it'));
  });
  test('withdrawing with none waiting, and with one', async () => {
    const { fake, anaFace } = world();
    expect(await fake.withdrawTurn(anaFace)).toEqual(refused('no Turn of that character is waiting'));
    must(await fake.turn(anaFace, 'heel', 'silent', false, false));
    expect(await fake.withdrawTurn(anaFace)).toEqual({ ok: true, value: { withdrawn: true } });
    expect((await fake.myCharacters()).find((c) => c.id === anaFace)!.pendingTurn).toBeNull();
  });
  test('retiring a character clears its waiting Turn, as the server does', async () => {
    const { fake, anaFace } = world();
    must(await fake.turn(anaFace, 'heel', 'silent', false, false));
    fake.seed.retire(anaFace);
    const gone = (await fake.myCharacters()).find((c) => c.id === anaFace)!;
    expect(gone.retiredAt).not.toBeNull();
    expect(gone.pendingTurn).toBeNull();
  });
  test('the cooldown runs from the settlement that made the Turn, and says when it ends', async () => {
    const { fake, anaFace } = world();
    fake.seed.nextSettlementAt(fake.clock.now() + 8 * 3_600_000);
    expect(must(await fake.turn(anaFace, 'heel', 'silent', false, false)).takesEffectAt).toBe(new Date(fake.clock.now() + 8 * 3_600_000).toISOString());
    fake.clock.advance(8 * 3_600_000);
    fake.seed.settle({});
    const turnedAt = fake.clock.now();
    const now = (await fake.myCharacters()).find((c) => c.id === anaFace)!;
    expect(now.class).toBe('heel');
    expect(now.classSince).toBe(new Date(turnedAt).toISOString());
    expect(now.turnOpensAt).toBe(new Date(turnedAt + 30 * DAY).toISOString());
    const at = new Date(turnedAt + 30 * DAY).toISOString().replace(/\.\d+Z$/, 'Z');
    expect(await fake.turn(anaFace, 'lurker', 'silent', false, false)).toEqual(refused(`this character can Turn again at ${at}`));
    fake.clock.advance(30 * DAY);
    expect(await fake.turn(anaFace, 'lurker', 'silent', false, false)).toMatchObject({ ok: true });
    expect((await fake.myCharacters()).find((c) => c.id === anaFace)!.turnOpensAt).toBeNull();
  });
  test('a Turn never takes effect behind a reveal dated after the settlement\'s end: it lands at the next, saying when it was due (0074)', async () => {
    const { fake, anaFace, thread } = world();
    must(await fake.turn(anaFace, 'heel', 'silent', false, false));
    const due = fake.clock.now();
    fake.seed.reveal(anaFace, thread, { at: due + 60_000 });
    fake.seed.settle({ at: due });
    const waiting = (await fake.myCharacters()).find((c) => c.id === anaFace)!;
    expect(waiting.class).toBe('face');
    expect(waiting.pendingTurn?.class).toBe('heel');
    fake.clock.advance(DAY);
    fake.seed.settle({});
    const landed = (await fake.myCharacters()).find((c) => c.id === anaFace)!;
    expect(landed.class).toBe('heel');
    expect(landed.classSince).toBe(new Date(fake.clock.now()).toISOString());
    expect(landed.classDueAt).toBe(new Date(due).toISOString());
    expect(landed.pendingTurn).toBeNull();
  });
});

describe('pronouns', () => {
  const REFUSAL = 'pronouns are five words of 1 to 12 letters';
  test('a character made with she/her reads it back on Character and MyCharacter; one made with none takes the instance\'s', async () => {
    const { fake } = world({ charactersPerPlayer: 6 });
    const hers = must(await fake.createCharacter('Hers', 'face', 'now', 'silent', PRONOUN_PRESETS.she));
    const plain = must(await fake.createCharacter('Plain', 'face', 'now', 'silent'));
    expect((await fake.characters([hers.id]))[0]?.pronouns).toEqual(PRONOUN_PRESETS.she);
    expect((await fake.myCharacters()).find((c) => c.id === hers.id)?.pronouns).toEqual(PRONOUN_PRESETS.she);
    expect((await fake.characters([plain.id]))[0]?.pronouns).toEqual(settings.pronouns);
    expect((await fake.myCharacters()).find((c) => c.id === plain.id)?.pronouns).toEqual(settings.pronouns);
  });
  test('a set is stored lowercased; a bad one is refused in the server\'s words and makes nothing', async () => {
    const { fake } = world({ charactersPerPlayer: 6 });
    const loud = must(await fake.createCharacter('Loud', 'face', 'now', 'silent', { ...PRONOUN_PRESETS.she, subject: 'SHE' }));
    expect((await fake.characters([loud.id]))[0]?.pronouns.subject).toBe('she');
    const before = (await fake.myCharacters()).length;
    expect(await fake.createCharacter('Bad', 'face', 'now', 'silent', { ...PRONOUN_PRESETS.she, subject: 'abcdefghijklm' })).toEqual(refused(REFUSAL));
    expect((await fake.myCharacters()).length).toBe(before);
  });
  test('set_profile stores a set, keeps the stored one when given none, and refuses a bad one with nothing changed', async () => {
    const { fake, anaFace } = world();
    const set = must(await fake.setProfile(anaFace, 'T', 's', 'default', PRONOUN_PRESETS.they));
    expect(set.pronouns).toEqual(PRONOUN_PRESETS.they);
    expect(must(await fake.setProfile(anaFace, 'T2', 's', 'default')).pronouns).toEqual(PRONOUN_PRESETS.they);
    expect(await fake.setProfile(anaFace, 'T3', 's', 'default', { ...PRONOUN_PRESETS.they, object: '' })).toEqual(refused(REFUSAL));
    const now = (await fake.characters([anaFace]))[0]!;
    expect(now).toMatchObject({ title: 'T2', pronouns: PRONOUN_PRESETS.they });
    expect((await fake.myCharacters()).find((c) => c.id === anaFace)?.pronouns).toEqual(PRONOUN_PRESETS.they);
  });
  test('a staff character takes the set its persona names, else the instance\'s; the developer persona too', async () => {
    const { fake } = world();
    const boss = fake.seed.staff('s-boss', 'Boss Staff', 'boss', { pronouns: PRONOUN_PRESETS.she });
    const mod = fake.seed.staff('s-mod', 'Mod Staff', 'mod');
    const got = await fake.characters([boss, mod]);
    expect(got.find((c) => c.id === boss)?.pronouns).toEqual(PRONOUN_PRESETS.she);
    expect(got.find((c) => c.id === mod)?.pronouns).toEqual(ENGINE_DEFAULT_PRONOUNS);
  });
});

describe('making a character', () => {
  test('the name\'s rules', async () => {
    const { fake } = world();
    expect(await fake.createCharacter('   ', 'face', 'tally', 'announced')).toEqual(refused('is empty', 'name'));
    expect(await fake.createCharacter('n'.repeat(41), 'face', 'tally', 'announced')).toEqual(refused('is longer than 40 characters', 'name'));
    expect(await fake.createCharacter('Two  Spaces', 'face', 'tally', 'announced')).toEqual(
      refused('can hold letters, marks, digits, symbols and single spaces, nothing hidden', 'name'));
    expect(await fake.createCharacter('Fine', 'wrestler', 'tally', 'announced')).toEqual(refused('there is no class "wrestler"', 'class'));
    expect(await fake.createCharacter('Fine', 'face', 'later' as 'now', 'announced')).toEqual(refused('a character drops now or debuts at the tally', 'timing'));
  });
  test('a name is taken whatever its case, even by a waiting or a retired character', async () => {
    const { fake, ana } = world({ charactersPerPlayer: 6 });
    fake.seed.character(ana, 'Quiet One', 'face', { debuted: false });
    expect(await fake.createCharacter('quiet one', 'face', 'tally', 'announced')).toEqual(refused('that name is taken'));
    expect(await fake.createCharacter('ANA FACE', 'face', 'tally', 'announced')).toEqual(refused('that name is taken'));
  });
  test('a player runs at most so many, retired ones not counted', async () => {
    const { fake, anaHeel } = world();
    must(await fake.createCharacter('Third', 'face', 'tally', 'announced'));
    expect(await fake.createCharacter('Fourth', 'face', 'tally', 'announced')).toEqual(refused('a player runs at most 3 characters'));
    fake.seed.retire(anaHeel);
    expect(await fake.createCharacter('Fourth', 'face', 'tally', 'announced')).toMatchObject({ ok: true });
  });
  test('a new character waits, and is absent from every public read until it debuts', async () => {
    const { fake } = world();
    const made = must(await fake.createCharacter('Newcomer', 'lurker', 'tally', 'with_class'));
    expect(made).toMatchObject({ name: 'Newcomer', class: 'lurker', waiting: true, loudness: 'with_class' });
    expect(await fake.characters([made.id])).toEqual([]);
    expect((await fake.standingsPage(0, 1000)).map((s) => s.character)).not.toContain(made.id);
    expect(await fake.characterCounts(made.id)).toEqual({ posts: 0, spins: 0, cards: 0 });
    expect((await fake.myCharacters()).find((c) => c.id === made.id)).toMatchObject({ debutedAt: null, class: 'lurker', debutLoudness: 'with_class' });
    fake.seed.settle({});
    expect((await fake.characters([made.id])).map((c) => c.name)).toEqual(['Newcomer']);
    expect((await fake.standingsPage(0, 1000)).map((s) => s.character)).toContain(made.id);
  });
  test('dropped now it is debuted; a debuted character cannot be re-timed', async () => {
    const { fake } = world();
    const made = must(await fake.createCharacter('Dropped', 'face', 'now', 'silent'));
    expect(made.waiting).toBe(false);
    expect(await fake.setDebut(made.id, 'tally', 'announced')).toEqual(refused('it has debuted'));
  });
});

describe('standings', () => {
  test('ranked with ties sharing a place, waiting characters left out', async () => {
    const { fake, ana, anaFace, anaHeel, boFace } = world();
    fake.seed.character(ana, 'Not Yet', 'face', { debuted: false });
    fake.seed.settle({ standings: { [anaFace]: 300, [anaHeel]: 300, [boFace]: 500 }, debut: false });
    expect((await fake.standingsPage(0, 1000)).map((s) => [s.name, s.standing, s.place])).toEqual([
      ['Bo Face', 500, 1], ['Ana Face', 300, 2], ['Ana Heel', 300, 2],
    ]);
    /* Dense (#453): the standing after a tie takes the next place. */
    fake.seed.settle({ standings: { [anaFace]: 500, [anaHeel]: 300, [boFace]: 500 }, debut: false });
    expect((await fake.standingsPage(0, 1000)).map((s) => [s.name, s.place])).toEqual([['Ana Face', 1], ['Bo Face', 1], ['Ana Heel', 2]]);
    expect(await fake.lastSettledAt()).toBe(new Date(fake.clock.now()).toISOString());
  });
});

describe('what the public reads never prove', () => {
  test('no read of the public holds an owner, an account or an address', async () => {
    const { fake, ana, bo, anaFace, boFace, thread, opener } = world();
    must(await fake.react(opener, anaFace, 'fire'));
    must(await fake.post(thread, anaFace, 'hi', opener));
    const ids = [anaFace, boFace];
    const everything = JSON.stringify([
      await fake.boards(), await fake.threads(await boardId(fake, 'general'), { offset: 0, limit: 9 }), await fake.acts(thread, 1, 9),
      await fake.characters(ids), await fake.standingsPage(0, 1000), await fake.tallies([opener]), await fake.classReveals(ids), await fake.turnsAnnounced(ids),
      await fake.characterActs(anaFace, ['post'], { offset: 0, limit: 9 }), await fake.viewCounts([thread]),
    ]);
    for (const secret of [ana, bo, fake.emailOf(ana), fake.emailOf(bo)]) expect(everything).not.toContain(secret);
  });
  test('a class is public only through a reveal or an announced Turn', async () => {
    const { fake, anaFace, thread } = world();
    expect(await fake.classReveals([anaFace])).toEqual([]);
    const unmasked = must(await fake.unmask(anaFace, thread, 'It was me'));
    expect(unmasked).toMatchObject({ kind: 'unmask', character: anaFace, payload: { class: 'face', message: 'It was me', via: 'act' } });
    expect(await fake.classReveals([anaFace])).toEqual([
      { act: unmasked.id, character: anaFace, class: 'face', at: unmasked.createdAt, via: 'act', thread },
    ]);
    const said = fake.seed.thread('announcements', null, 'Turns', '').thread;
    const tally = fake.seed.announceTurn(anaFace, said, { was: 'face', since: '2026-09-01T00:00:00.000Z' });
    const announced = fake.seed.announceTurn(anaFace, said, { was: 'heel' });
    expect(await fake.turnsAnnounced([anaFace])).toEqual([
      { act: tally, character: anaFace, at: (await fake.act(tally))!.createdAt, was: 'face' },
      { act: announced, character: anaFace, at: (await fake.act(announced))!.createdAt, was: 'heel' },
    ]);
  });
  test('classShownAt is null until a reveal, set by it, null after a Turn, and a repeat reveal is refused', async () => {
    const { fake, anaFace, thread } = world();
    const shown = async () => (await fake.myCharacters()).find((c) => c.id === anaFace)!.classShownAt;
    expect(await shown()).toBeNull();
    const first = must(await fake.unmask(anaFace, thread, 'It was me'));
    expect(await shown()).toBe(first.createdAt);
    expect(await fake.unmask(anaFace, thread, 'again')).toEqual(refused('that character\'s class is already public; after a Turn, the new class can be revealed'));
    must(await fake.turn(anaFace, 'heel', 'silent', false, false));
    fake.clock.advance(DAY);
    fake.seed.settle({});
    expect((await fake.myCharacters()).find((c) => c.id === anaFace)!.class).toBe('heel');
    expect(await shown()).toBeNull();
    must(await fake.unmask(anaFace, thread, 'now a heel'));
    expect(await shown()).not.toBeNull();
  });
  test('classShownAt is set by a debut with its class and by a Turn announced with its class', async () => {
    const { fake, anaFace, anaHeel } = world();
    const shown = async (id: string) => (await fake.myCharacters()).find((c) => c.id === id)!.classShownAt;
    expect(await shown(anaFace)).toBeNull();
    const debut = fake.seed.announce(anaFace, 'debut', { class: 'face' });
    expect(await shown(anaFace)).toBe((await fake.act(debut))!.createdAt);
    expect(await shown(anaHeel)).toBeNull();
    const turned = fake.seed.announce(anaHeel, 'turn', { class: 'heel', was: 'face' });
    expect(await shown(anaHeel)).toBe((await fake.act(turned))!.createdAt);
    expect(await fake.unmask(anaHeel, (await fake.act(turned))!.thread, 'again')).toEqual(refused('that character\'s class is already public; after a Turn, the new class can be revealed'));
  });
  test('classShownAt is null after a Turn back to a class that was revealed before', async () => {
    const { fake, anaFace, thread } = world();
    const shown = async () => (await fake.myCharacters()).find((c) => c.id === anaFace)!.classShownAt;
    must(await fake.unmask(anaFace, thread, 'face'));
    expect(await shown()).not.toBeNull();
    for (const to of ['heel', 'face']) {
      fake.clock.advance(31 * DAY);
      must(await fake.turn(anaFace, to, 'silent', false, false));
      fake.clock.advance(DAY);
      fake.seed.settle({});
    }
    expect((await fake.myCharacters()).find((c) => c.id === anaFace)!.class).toBe('face');
    expect(await shown()).toBeNull();
  });
  test('an unmask is refused on The System\'s board, and past 200 characters', async () => {
    const { fake, anaFace, thread } = world();
    const sys = fake.seed.thread('announcements', null, 'Tally', '').thread;
    expect(await fake.unmask(anaFace, sys, '')).toEqual(refused('only the staff post here; spin a thread from what they said'));
    expect(await fake.unmask(anaFace, thread, 'x'.repeat(201))).toEqual(refused('the message is at most 200 characters', 'message'));
  });
  test('avatars are URLs, a seeded one may be a data: URL', async () => {
    const { fake, anaFace } = world();
    fake.seed.avatar(anaFace, { square: 'data:image/webp;base64,AAAA' });
    const [shown] = await fake.characters([anaFace]);
    expect(shown?.avatarSquare).toBe('data:image/webp;base64,AAAA');
    expect(shown?.avatarPortrait).toBeNull();
  });
});

describe('live events', () => {
  test('a post is broadcast on its thread, once, asynchronously', async () => {
    const { fake, anaFace, thread } = world();
    const got: Act[] = [];
    fake.subscribeThread(thread, { onAct: (a) => got.push(a) });
    const sent = fake.post(thread, anaFace, 'live', null);
    expect(got).toEqual([]);
    const posted = must(await sent);
    await flush();
    expect(got).toEqual([posted]);
    expect(fake.broadcast.log).toEqual([{ topic: `thread:${thread}`, event: 'act' }]);
  });
  test('a thread started or spun is announced on its board, and its first Act on its own thread', async () => {
    const { fake, anaFace } = world();
    const board = await boardId(fake, 'general');
    const threads: string[] = [];
    fake.subscribeBoard(board, { onThread: (t) => threads.push(t.title) });
    const started = must(await fake.startThread('general', anaFace, 'Fresh', 'body'));
    await flush();
    expect(threads).toEqual(['Fresh']);
    expect(fake.broadcast.log.map((e) => e.topic + ' ' + e.event)).toEqual([`board:${board} thread`, `thread:${started.thread.id} act`]);
  });
  test('an edit is the post again under its own id; a reaction is a tally', async () => {
    const { fake, anaFace, boFace, thread, opener } = world();
    const post = must(await fake.post(thread, anaFace, 'one', null));
    await fake.edit(post.id, anaFace, 'two');
    await fake.react(opener, anaFace, 'fire');
    expect(fake.broadcast.log.map((e) => e.event)).toEqual(['act', 'act', 'tally']);
  });
  test('a Turn, a new character, an invite and a mark are not broadcast', async () => {
    const { fake, anaFace, thread } = world();
    await fake.turn(anaFace, 'heel', 'silent', false, false);
    await fake.withdrawTurn(anaFace);
    await fake.createCharacter('Quietly', 'face', 'tally', 'announced');
    await fake.createInvite();
    await fake.markRead(thread, 1, null);
    expect(fake.broadcast.log).toEqual([]);
  });
  test('a held event can be delivered twice and out of order', async () => {
    const { fake, anaFace, thread } = world();
    const got: number[] = [];
    fake.subscribeThread(thread, { onAct: (a) => got.push(a.seq!) });
    fake.broadcast.hold();
    await fake.post(thread, anaFace, 'two', null);
    await fake.post(thread, anaFace, 'three', null);
    await flush();
    expect(got).toEqual([]);
    expect(fake.broadcast.flush({ reverse: true, twice: true })).toBe(2);
    await flush();
    expect(got).toEqual([3, 3, 2, 2]);
  });
  test('an unsubscribed listener hears nothing', async () => {
    const { fake, anaFace, thread } = world();
    const got: Act[] = [];
    fake.subscribeThread(thread, { onAct: (a) => got.push(a) })();
    await fake.post(thread, anaFace, 'unheard', null);
    await flush();
    expect(got).toEqual([]);
  });
  test('a listener is told when it is joined, a microtask after it subscribes, and an event sent in the same tick is still heard', async () => {
    const { fake, anaFace, thread } = world();
    const told: string[] = [];
    fake.subscribeThread(thread, { onJoined: () => told.push('thread'), onAct: (a) => told.push(`act ${a.seq}`) });
    fake.subscribeReach({ onJoined: () => told.push('reach') });
    expect(told).toEqual([]);
    await fake.post(thread, anaFace, 'two', null);
    await flush();
    expect(told).toEqual(['thread', 'reach', 'act 2']);
  });
  test('with joins held an event reaches no listener, and after join() the listener has been told and hears the next one', async () => {
    const { fake, anaFace, thread } = world();
    const told: string[] = [];
    const got: number[] = [];
    fake.broadcast.holdJoins();
    fake.subscribeThread(thread, { onJoined: () => told.push('thread'), onAct: (a) => got.push(a.seq!) });
    fake.subscribeReach({ onJoined: () => told.push('reach') });
    await flush();
    expect(told).toEqual([]);
    await fake.post(thread, anaFace, 'two', null);
    await flush();
    expect(got).toEqual([]);
    expect(fake.broadcast.join()).toBe(2);
    expect(told).toEqual(['thread', 'reach']);
    await fake.post(thread, anaFace, 'three', null);
    await flush();
    expect(got).toEqual([3]);
    // The hold ended with the join: the next listener joins on its own.
    fake.subscribeReach({ onJoined: () => told.push('later') });
    await flush();
    expect(told).toEqual(['thread', 'reach', 'later']);
  });
  test('rejoin() tells every joined thread and reach listener again, and one that left or never joined is not told', async () => {
    const { fake, thread } = world();
    const told: string[] = [];
    fake.subscribeThread(thread, { onJoined: () => told.push('thread') });
    fake.subscribeReach({ onJoined: () => told.push('reach') });
    fake.subscribeThread(thread, { onJoined: () => told.push('left') })();
    await flush();
    expect(told).toEqual(['thread', 'reach']);
    fake.broadcast.rejoin();
    expect(told).toEqual(['thread', 'reach', 'thread', 'reach']);
    fake.broadcast.holdJoins();
    fake.subscribeThread(thread, { onJoined: () => told.push('waiting') });
    fake.broadcast.rejoin();
    expect(told.filter((t) => t === 'waiting')).toEqual([]);
  });
  test('a listener that left while joins were held is never told', async () => {
    const { fake, thread } = world();
    const told = vi.fn();
    fake.broadcast.holdJoins();
    fake.subscribeThread(thread, { onJoined: told })();
    expect(fake.broadcast.join()).toBe(0);
    await flush();
    expect(told).not.toHaveBeenCalled();
  });
});

describe('reading', () => {
  test('mark_read clamps to 0..the last seq and never lowers', async () => {
    const { fake, anaFace, thread } = world();
    await fake.post(thread, anaFace, 'two', null);
    expect(await fake.reading([thread])).toEqual({});
    await fake.markRead(thread, 99, null);
    expect(await fake.reading([thread])).toEqual({ [thread]: 2 });
    await fake.markRead(thread, 1, null);
    expect(await fake.reading([thread])).toEqual({ [thread]: 2 });
    await fake.markRead(thread, -5, null);
    expect(await fake.reading([thread])).toEqual({ [thread]: 2 });
  });
  test('a refusal is dropped: a thread that does not exist changes nothing, and the mark says only that it was not recorded', async () => {
    const { fake, thread } = world();
    const nowhere = '00000000-0000-4000-8000-00000000fffd';
    await expect(fake.markRead(nowhere, 1, null)).resolves.toBe(false);
    expect(await fake.reading([nowhere, thread])).toEqual({});
  });
  test('a tally and a view count answer for every id asked', async () => {
    const { fake, thread, opener } = world();
    expect(await fake.tallies([opener, 'x'])).toEqual({ [opener]: {}, x: {} });
    expect(await fake.viewCounts([thread, 'x'])).toEqual({ [thread]: 0, x: 0 });
  });
  test('what a player has read is theirs', async () => {
    const { fake, bo, thread } = world();
    await fake.markRead(thread, 1, null);
    fake.signInAs(bo);
    expect(await fake.reading([thread])).toEqual({});
  });
});

describe('the account', () => {
  test('the sign-in address is the signed-in login\'s own, and none signed out', async () => {
    const { fake, ana } = world();
    expect(await fake.signInAddress()).toBe(fake.emailOf(ana));
    fake.signInAs(null);
    expect(await fake.signInAddress()).toBeNull();
  });
  test('a code request says the same words for an address with an account and one without', async () => {
    const { fake, ana } = world();
    fake.signInAs(null);
    const known = await fake.requestCode(fake.emailOf(ana), null, null);
    const unknown = await fake.requestCode('nobody@example.test', null, null);
    expect(known).toEqual(unknown);
    expect(known).toMatchObject({ ok: true, value: { message: expect.stringContaining('If this address can sign in here') } });
    expect(await fake.requestCode('not an address', null, null)).toEqual(refused('is not an email address', 'email'));
  });
  test('the fake keeps the last next a code was asked with, and says the same whatever it was', async () => {
    const { fake, ana } = world();
    fake.signInAs(null);
    expect(fake.lastNext()).toBeNull();
    const kept = await fake.requestCode(fake.emailOf(ana), null, '/board/general?page=2');
    expect(fake.lastNext()).toBe('/board/general?page=2');
    expect(await fake.requestCode('nobody@example.test', null, null)).toEqual(kept);
    expect(fake.lastNext()).toBeNull();
  });
  test('an invite that opens nothing is said so for every address alike', async () => {
    const { fake, ana } = world();
    fake.signInAs(null);
    const known = await fake.requestCode(fake.emailOf(ana), 'wrong', null);
    const unknown = await fake.requestCode('nobody@example.test', 'wrong', null);
    expect(known).toEqual(unknown);
    expect(must(known).invite).toBe('that invite opens nothing, so no new login is made with it');
  });
  test('the test code signs in; another does not', async () => {
    const { fake, ana } = world();
    fake.signInAs(null);
    const seen: boolean[] = [];
    fake.onSession((s) => seen.push(s.signedIn));
    expect(await fake.verifyCode(fake.emailOf(ana), '654321')).toEqual(refused('that code does not match, or it has expired: ask for a new one', 'code'));
    expect(await fake.verifyCode(fake.emailOf(ana), 'abc')).toEqual(refused('is the digits from the email', 'code'));
    expect(await fake.session()).toEqual({ signedIn: false, account: null, bar: null, conductAccepted: true });
    expect(await fake.verifyCode(fake.emailOf(ana), ` ${TEST_CODE} `)).toEqual({ ok: true, value: { account: true } });
    expect(await fake.session()).toEqual({ signedIn: true, account: ana, bar: null, conductAccepted: true });
    await fake.signOut();
    await flush();
    expect(seen).toEqual([true, false]);
  });
  test('the test link signs in the address of the last code asked for; any other hash, or none asked for, is refused', async () => {
    const { fake, ana } = world();
    fake.signInAs(null);
    const gone = refused('that link does not work, or it has expired: ask for a new code', 'link');
    expect(await fake.verifyLink(TEST_LINK)).toEqual(gone);
    await fake.requestCode(fake.emailOf(ana), null, null);
    expect(await fake.verifyLink('not-the-test-link-at-all')).toEqual(gone);
    expect(await fake.session()).toMatchObject({ signedIn: false, account: null });
    expect(await fake.verifyLink(TEST_LINK)).toEqual({ ok: true, value: { account: true } });
    expect(await fake.session()).toMatchObject({ signedIn: true, account: ana });
  });
  test('the test link opens an account from the invite the code was asked with, or signs in with none and says why', async () => {
    const { fake } = world();
    const { code } = must(await fake.createInvite());
    fake.signInAs(null);
    await fake.requestCode('new@example.test', code, null);
    expect(await fake.verifyLink(TEST_LINK)).toEqual({ ok: true, value: { account: true } });
    fake.signInAs(null);
    await fake.requestCode('other@example.test', null, null);
    expect(await fake.verifyLink(TEST_LINK)).toEqual({ ok: true, value: { account: false, why: 'that invite opens nothing; open the account with another invite' } });
    expect(await fake.session()).toMatchObject({ signedIn: true, account: null });
  });
  test('an address with no account and no invite signs in with no account, and says why', async () => {
    const { fake } = world();
    fake.signInAs(null);
    await fake.requestCode('new@example.test', null, null);
    const answer = await fake.verifyCode('new@example.test', TEST_CODE);
    expect(answer).toEqual({ ok: true, value: { account: false, why: 'that invite opens nothing; open the account with another invite' } });
    expect(await fake.session()).toEqual({ signedIn: true, account: null, bar: null, conductAccepted: true });
    expect(await fake.myCharacters()).toEqual([]);
  });
  test('an invite from a player opens an account, once', async () => {
    const { fake } = world();
    const { code } = must(await fake.createInvite());
    fake.signInAs(null);
    await fake.requestCode('new@example.test', code, null);
    expect(await fake.verifyCode('new@example.test', TEST_CODE)).toEqual({ ok: true, value: { account: true } });
    fake.signInAs(null);
    await fake.requestCode('other@example.test', code, null);
    expect(await fake.verifyCode('other@example.test', TEST_CODE)).toMatchObject({ ok: true, value: { account: false } });
    expect(await fake.openAccount(code)).toEqual(refused('that invite opens nothing'));
  });
  test('closed registration says so', async () => {
    const fake = createFake({ instance, settings: { registrationMode: 'closed' } });
    expect(must(await fake.requestCode('new@example.test', 'x', null)).invite).toBe('registration is closed, so no new login is made');
    expect(await fake.verifyCode('new@example.test', TEST_CODE)).toEqual({
      ok: true, value: { account: false, why: 'registration is closed; when an admin opens it again, your next sign-in opens your account' },
    });
  });
  test('invites: so many open at once, reissued only while unused, expiring', async () => {
    const { fake } = world();
    const a = must(await fake.createInvite());
    must(await fake.createInvite());
    expect(await fake.createInvite()).toEqual(refused('you hold 2 open invites, the most there are: one used or expired frees one'));
    expect(await fake.reissueInvite(999)).toEqual(refused('you have no unused invite 999'));
    fake.clock.advance(8 * DAY);
    expect((await fake.invites()).map((i) => [i.used, i.expired, i.expiresAt !== null])).toEqual([[false, true, true], [false, true, true]]);
    must(await fake.createInvite());
    const again = must(await fake.reissueInvite(a.invite));
    expect(again.code).not.toBe(a.code);
    expect((await fake.invites()).find((i) => i.id === a.invite)).toMatchObject({ expired: false });
  });
  test('preferences have defaults and are set whole or in part', async () => {
    const { fake } = world();
    const glass = { smoke: 'full', contrast: 'standard', textSize: 100, tilt: 'off', effects: 'standard', gameSound: 'off', gameVolume: 80, interfaceSound: 'off', interfaceVolume: 80, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } as const;
    expect(await fake.preferences()).toEqual({ theme: 'default', mode: 'system', postbit: 'side', motion: 'system', ...glass });
    expect(await fake.setPreferences({ motion: 'reduce' })).toEqual({ ok: true, value: { theme: 'default', mode: 'system', postbit: 'side', motion: 'reduce', ...glass } });
    expect(await fake.setPreferences({ theme: 'Loud!' })).toEqual(refused('a theme is named in lowercase words joined by hyphens'));
  });
  test('the glass\'s three preferences are set and kept as the server keeps them, and refused in its words', async () => {
    const { fake } = world();
    expect(await fake.setPreferences({ smoke: 'off' })).toEqual({ ok: true, value: { theme: 'default', mode: 'system', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'standard', textSize: 100, tilt: 'off', effects: 'standard', gameSound: 'off', gameVolume: 80, interfaceSound: 'off', interfaceVolume: 80, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } });
    expect(await fake.setPreferences({ contrast: 'high', textSize: 200 })).toEqual({ ok: true, value: { theme: 'default', mode: 'system', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'high', textSize: 200, tilt: 'off', effects: 'standard', gameSound: 'off', gameVolume: 80, interfaceSound: 'off', interfaceVolume: 80, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } });
    /* A fresh read is what the next load sees. */
    expect(await fake.preferences()).toMatchObject({ smoke: 'off', contrast: 'high', textSize: 200 });
    expect(await fake.setPreferences({ smoke: 'thick' as never })).toEqual(refused('the smoke is full, low or off'));
    expect(await fake.setPreferences({ contrast: 'max' as never })).toEqual(refused('contrast is standard or high'));
    expect(await fake.setPreferences({ textSize: 175 as never })).toEqual(refused('text size is 100, 125, 150 or 200 percent'));
    expect(must(await fake.setPreferences({ tilt: 'on' })).tilt).toBe('on');
    expect(await fake.setPreferences({ tilt: 'sideways' as never })).toEqual(refused('tilt is off or on'));
    expect(must(await fake.setPreferences({ smoke: 'off' })).tilt).toBe('on');
    expect(must(await fake.setPreferences({ effects: 'bright' })).effects).toBe('bright');
    expect(await fake.setPreferences({ effects: 'loud' as never })).toEqual(refused('effects are standard or bright'));
    expect(must(await fake.setPreferences({ smoke: 'low' })).effects).toBe('bright');
    expect(must(await fake.setPreferences({ gameSound: 'on', interfaceVolume: 35 }))).toMatchObject({ gameSound: 'on', gameVolume: 80, interfaceSound: 'off', interfaceVolume: 35 });
    expect(await fake.setPreferences({ gameSound: 'loud' as never })).toEqual(refused('game sounds are off or on'));
    expect(await fake.setPreferences({ interfaceSound: 'loud' as never })).toEqual(refused('interface sounds are off or on'));
    expect(await fake.setPreferences({ gameVolume: 7 })).toEqual(refused('a volume is 0 to 100, in steps of 5'));
    expect(await fake.setPreferences({ interfaceVolume: 105 })).toEqual(refused('a volume is 0 to 100, in steps of 5'));
  });
  test('the kinds that toast are chosen whole, kept once each, refused naming an unknown kind, left alone by other settings and put back by null', async () => {
    const { fake } = world();
    expect((await fake.preferences()).toasts).toBeNull();
    expect(must(await fake.setPreferences({ toasts: ['update', 'quote', 'update'] })).toasts).toEqual(['update', 'quote']);
    expect(await fake.setPreferences({ toasts: ['quote', 'confetti' as never] })).toEqual(refused('not a kind of alert: confetti'));
    expect(must(await fake.setPreferences({ smoke: 'low' })).toasts).toEqual(['update', 'quote']);
    expect(must(await fake.setPreferences({ toasts: [] })).toasts).toEqual([]);
    expect(must(await fake.setPreferences({ toasts: null })).toasts).toBeNull();
  });
  test('a card key may open with a digit, as the catalog and meet_card allow, but not with a hyphen', async () => {
    const { fake } = world();
    expect(must(await fake.meetCard('4d-chess')).cardsMet).toContain('4d-chess');
    expect(await fake.meetCard('-chess')).toEqual(refused('a card is named in lowercase words joined by hyphens'));
  });
  test('cards met are added once, refused past 64 or when malformed, and forgotten whole, setPreferences leaving them alone', async () => {
    const { fake } = world();
    expect(must(await fake.meetCard('whoops')).cardsMet).toEqual(['whoops']);
    expect(must(await fake.meetCard('whoops')).cardsMet).toEqual(['whoops']);
    expect(must(await fake.meetCard('stick-around')).cardsMet).toEqual(['whoops', 'stick-around']);
    expect(must(await fake.setPreferences({ smoke: 'low' })).cardsMet).toEqual(['whoops', 'stick-around']);
    /* A stray cardsMet in a patch is ignored, as the server's set_preferences has no such parameter. */
    expect(must(await fake.setPreferences({ cardsMet: ['sneaky'] } as never)).cardsMet).toEqual(['whoops', 'stick-around']);
    expect(await fake.meetCard('Whoops')).toEqual(refused('a card is named in lowercase words joined by hyphens'));
    for (let i = 2; i < 64; i++) must(await fake.meetCard(`card-${i}`));
    expect(await fake.meetCard('one-too-many')).toEqual(refused('at most 64 cards are kept as met'));
    expect(must(await fake.meetCard('whoops')).cardsMet).toHaveLength(64);
    must(await fake.seeTip('grid'));
    must(await fake.skipTips());
    /* restore_tips forgets every card and tip and turns tips on. */
    expect(must(await fake.restoreTips())).toMatchObject({ cardsMet: [], tips: 'on', tipsSeen: [] });
    expect((await fake.preferences()).cardsMet).toEqual([]);
  });
  test('the tips: the welcome is seen once, a tip once, 64 at most, skipping and restoring and replaying undo each other', async () => {
    const { fake } = world();
    expect(await fake.preferences()).toMatchObject({ welcomedAt: null, tips: 'on', tipsSeen: [] });
    const first = must(await fake.seeWelcome()).welcomedAt;
    expect(first).not.toBeNull();
    fake.clock.advance(60_000);
    expect(must(await fake.seeWelcome()).welcomedAt).toBe(first);
    expect(must(await fake.seeTip('grid')).tipsSeen).toEqual(['grid']);
    expect(must(await fake.seeTip('grid')).tipsSeen).toEqual(['grid']);
    for (const k of ['tour-plate', 'tour-orbs', 'tour-hand']) must(await fake.seeTip(k));
    must(await fake.meetCard('whoops'));
    expect(must(await fake.setPreferences({ smoke: 'low' })).tipsSeen).toEqual(['grid', 'tour-plate', 'tour-orbs', 'tour-hand']);
    expect(must(await fake.skipTips())).toMatchObject({ tips: 'off', tipsSeen: ['grid', 'tour-plate', 'tour-orbs', 'tour-hand'] });
    expect(must(await fake.replayTour())).toMatchObject({ tips: 'on', tipsSeen: ['grid'], cardsMet: ['whoops'] });
    must(await fake.skipTips());
    /* resume_tips turns tips on and forgets nothing. */
    must(await fake.seeTip('ghost'));
    expect(must(await fake.resumeTips())).toMatchObject({ tips: 'on', tipsSeen: ['grid', 'ghost'], cardsMet: ['whoops'] });
    must(await fake.skipTips());
    expect(must(await fake.restoreTips())).toMatchObject({ welcomedAt: first, tips: 'on', tipsSeen: [], cardsMet: [] });
    for (const bad of ['Grid', '', '1up', 'a'.repeat(41), 'bad key']) expect(await fake.seeTip(bad)).toEqual(refused('a tip is named in lowercase words joined by hyphens'));
    for (let i = 0; i < 64; i++) must(await fake.seeTip(`tip-${i}`));
    expect(await fake.seeTip('one-too-many')).toEqual(refused('at most 64 tips are kept as seen'));
    expect(must(await fake.seeTip('tip-0')).tipsSeen).toHaveLength(64);
  });
  test('a seasoned account has seen the welcome and every tip, keeps tips on, and an unseasoned one has seen none', async () => {
    const { fake } = world();
    const vet = fake.seed.account('vet', { seasoned: true });
    fake.signInAs(vet);
    expect(await fake.preferences()).toMatchObject({ welcomedAt: '2026-10-01T00:00:00.000Z', tips: 'on', tipsSeen: [...TIP_KEYS] });
    fake.clock.advance(60_000);
    expect((await fake.preferences()).welcomedAt).toBe('2026-10-01T00:00:00.000Z');
    fake.signInAs(fake.seed.account('newcomer'));
    expect(await fake.preferences()).toMatchObject({ welcomedAt: null, tips: 'on', tipsSeen: [] });
  });
  test('replaying the tour marks the welcome seen when it never was, and keeps a first time', async () => {
    const { fake } = world();
    expect((await fake.preferences()).welcomedAt).toBeNull();
    const at = must(await fake.replayTour()).welcomedAt;
    expect(at).not.toBeNull();
    fake.clock.advance(60_000);
    expect(must(await fake.replayTour()).welcomedAt).toBe(at);
  });
  test('the two marks move only forward, refuse what is not a time, and are the account\'s', async () => {
    const { fake } = world();
    for (const [see, key] of [[fake.seeAlerts, 'alertsSeenAt'], [fake.seeSettlement, 'settlementSeen']] as const) {
      expect(await see('2026-10-30T08:00:00.000Z')).toEqual({ ok: true, value: '2026-10-30T08:00:00.000Z' });
      expect(await see('2026-10-29T08:00:00.000Z')).toEqual({ ok: true, value: '2026-10-30T08:00:00.000Z' });
      expect(await see('2026-10-31T08:00:00.000Z')).toEqual({ ok: true, value: '2026-10-31T08:00:00.000Z' });
      expect(await see('yesterday')).toEqual(refused('a mark is a time'));
      expect((await fake.preferences())[key]).toBe('2026-10-31T08:00:00.000Z');
    }
  });
  test('the wallet is the settled balance under its cap', async () => {
    const { fake, ana } = world();
    expect(await fake.wallet()).toEqual({ balance: 0, cap: 600 });
    fake.seed.settle({ wallet: { [ana]: 250 } });
    expect(await fake.wallet()).toEqual({ balance: 250, cap: 600 });
  });
  test('seed.wallet sets the settled balance between settlements, under the cap, and dates no settlement', async () => {
    const { fake, ana } = world();
    fake.seed.settle({ at: Date.UTC(2026, 9, 29, 8, 17), wallet: { [ana]: 562 } });
    const settledAt = await fake.lastSettledAt();
    fake.seed.wallet(ana, 462);
    expect(await fake.wallet()).toEqual({ balance: 462, cap: 600 });
    fake.seed.wallet(ana, 9_000);
    expect((await fake.wallet()).balance).toBe(600);
    expect(await fake.lastSettledAt()).toBe(settledAt);
  });
  test('a seeded wallet is a whole number of hundredths, not under nothing, of an account there is; settle\'s wallets and seed.cards hold to it too', async () => {
    const { fake, ana } = world();
    fake.seed.wallet(ana, 300);
    for (const bad of [-1, Number.NaN, 2.5, Infinity]) {
      expect(() => fake.seed.wallet(ana, bad)).toThrow(/the seed was refused/);
      expect(() => fake.seed.settle({ wallet: { [ana]: bad } })).toThrow(/the seed was refused/);
    }
    expect(() => fake.seed.wallet('nobody', 1)).toThrow(/the seed was refused/);
    expect(() => fake.seed.settle({ wallet: { nobody: 1 } })).toThrow(/the seed was refused/);
    expect(() => fake.seed.cards('nobody', { whoops: 1 })).toThrow(/the seed was refused/);
    expect(await fake.wallet()).toEqual({ balance: 300, cap: 600 });
  });
  test('seed.turn asks a Turn as its player, waiting for the settlement, and is refused in the server\'s words', async () => {
    const { fake, bo, anaFace, boFace } = world();
    fake.seed.nextSettlementAt(fake.clock.now() + 8 * 3_600_000);
    fake.seed.turn(anaFace, 'heel', { loudness: 'announced', showFrom: true, showTo: false });
    const waiting = (await fake.myCharacters()).find((c) => c.id === anaFace)!;
    expect(waiting.class).toBe('face');
    expect(waiting.pendingTurn).toEqual({ class: 'heel', loudness: 'announced', showFrom: true, showTo: false, takesEffectAt: new Date(fake.clock.now() + 8 * 3_600_000).toISOString() });
    expect(() => fake.seed.turn(anaFace, 'face')).toThrow(/the seed was refused/);
    /* A character of another account is asked as its own player, whoever is signed in. */
    fake.seed.turn(boFace, 'lurker');
    fake.signInAs(bo);
    expect((await fake.myCharacters())[0]!.pendingTurn).toMatchObject({ class: 'lurker', loudness: 'silent', showFrom: false, showTo: false });
  });
  test('the estimate: empty by default, the same answer until it is fresh again, then new', async () => {
    const { fake, ana, anaFace } = world();
    const first = await fake.estimate();
    expect(first).toMatchObject({ entries: [], lines: [] });
    expect(first.asOf).toBe(new Date(fake.clock.now()).toISOString());
    expect(first.freshAfter).toBe(new Date(fake.clock.now() + 30_000).toISOString());
    fake.seed.estimate(ana, { entries: [{ character: anaFace, reason: 'face.cheered', amount: 20 }], lines: [{ character: anaFace, reason: 'face.cheered', amount: 20 }] });
    expect(await fake.estimate()).toBe(first);
    fake.clock.advance(31_000);
    const later = await fake.estimate();
    expect(later.entries).toHaveLength(1);
    expect(later.lines).toHaveLength(1);
  });
  test('settings are the instance\'s, with any override', async () => {
    const fake = createFake({ instance, settings: { postsPerPage: 5 } });
    expect(await fake.settings()).toMatchObject({ postsPerPage: 5, reactionCap: 3, editGrace: { unit: 'minute', count: 2 } });
  });
});

describe('profiles', () => {
  test('a title, a signature and a pip style, refused in the server\'s words', async () => {
    const { fake, anaFace } = world();
    expect(await fake.setProfile(anaFace, 't'.repeat(41), '', 'default')).toEqual(refused('a title is at most 40 characters'));
    expect(await fake.setProfile(anaFace, '', 's'.repeat(501), 'default')).toEqual(refused('a signature is at most 500 characters'));
    expect(await fake.setProfile(anaFace, '', '', 'gold')).toEqual(refused('there is no pip style "gold"'));
    const set = must(await fake.setProfile(anaFace, 'The Face', '[b]hi[/b]', 'default'));
    expect(set).toMatchObject({ id: anaFace, title: 'The Face', signature: '[b]hi[/b]', pipStyle: 'default' });
  });
  test('a recrop needs a portrait already stored', async () => {
    const { fake, anaFace } = world();
    const frame = { x: 0, y: 0, w: 0.5, h: 0.5 };
    const blob = new Blob(['x']);
    expect(await fake.setAvatar({ character: anaFace, square: blob, portrait: null, squareFrame: frame, portraitFrame: null })).toEqual(
      refused('an avatar is cut from a portrait; send it'));
    const done = must(await fake.setAvatar({ character: anaFace, square: blob, portrait: blob, squareFrame: frame, portraitFrame: frame }));
    expect(done.avatarSquare).toMatch(/^https?:\/\//);
    expect(done.avatarPortrait).toMatch(/^https?:\/\//);
    const again = must(await fake.setAvatar({ character: anaFace, square: blob, portrait: null, squareFrame: frame, portraitFrame: null }));
    expect(again.avatarPortrait).toBe(done.avatarPortrait);
    expect(again.avatarSquare).not.toBe(done.avatarSquare);
  });
});

describe('counts', () => {
  test('a character\'s public record is counted by kind, edits not counted', async () => {
    const { fake, anaFace, thread, opener } = world();
    const post = must(await fake.post(thread, anaFace, 'one', null));
    await fake.edit(post.id, anaFace, 'two');
    must(await fake.spin(opener, anaFace, 'Spun', ''));
    expect(await fake.characterCounts(anaFace)).toEqual({ posts: 1, spins: 1, cards: 0 });
    /* A page of Acts, with no total: the totals are the counts above, which a record's pager takes. */
    const record = await fake.characterActs(anaFace, ['post', 'spin'], { offset: 0, limit: 1 });
    expect(record.map((a) => a.kind)).toEqual(['spin']);
    expect((await fake.characterActs(anaFace, ['post', 'spin'], { offset: 1, limit: 5 })).map((a) => a.kind)).toEqual(['post']);
  });
});

describe('what a list row shows', () => {
  test('replies are the posts after the first: a reveal, an edit and a spun thread count for nothing', async () => {
    const { fake, anaFace, thread, opener } = world();
    expect((await fake.thread(thread))?.replies).toBe(0);
    const reply = must(await fake.post(thread, anaFace, 'a reply', null));
    fake.seed.reveal(anaFace, thread);
    await fake.edit(reply.id, anaFace, 'a reply, edited');
    must(await fake.spin(opener, anaFace, 'Spun out', ''));
    const row = await fake.thread(thread);
    expect(row?.replies).toBe(1);
    expect(row?.lastSeq).toBe(3);
  });

  test('a spun thread names its origin in the row: the thread, and the place with its title and the Act\'s seq', async () => {
    const { fake, anaFace, thread } = world();
    const board = await boardId(fake, 'general');
    const second = must(await fake.post(thread, anaFace, 'second', null));
    const spun = must(await fake.spin(second.id, anaFace, 'Spun out', 'body'));
    const row = await fake.thread(spun.thread.id);
    expect([row?.originThread, row?.origin]).toEqual([thread, { kind: 'post', thread, title: 'Hello', seq: 2, board }]);
    expect((await fake.spunFrom(second.id)).map((t) => [t.originThread, t.origin])).toEqual([[thread, { kind: 'post', thread, title: 'Hello', seq: 2, board }]]);
    const plain = await fake.thread(thread);
    expect([plain?.originThread, plain?.origin]).toEqual([null, null]);
  });

  test('a thread spun from a play has the place the SQL gives it: a play, with its card and where it landed (0079)', async () => {
    const { fake, anaFace, boFace, opener, thread } = world();
    const place = async (origin: string) => (await fake.thread(must(await fake.spin(origin, anaFace, 'Spun', 'b')).thread.id))?.origin;
    const post = { kind: 'post', thread, title: 'Hello', seq: 1 };
    const board = await boardId(fake, 'general');
    // A face-up card on a post.
    expect(await place(fake.seed.card(anaFace, opener, 'whoops'))).toEqual({ kind: 'play', card: 'whoops', on: post, from: null, at: null, board });
    // A face-down set names no card; its spring, its own Act, names it.
    const set = fake.seed.set(boFace, fake.seed.post(thread, boFace, 'Bo here.'), 'snare');
    expect(await place(set)).toEqual({ kind: 'play', card: null, on: { kind: 'post', thread, title: 'Hello', seq: 2 }, from: null, at: null, board });
    expect(JSON.stringify(await place(set))).not.toContain('snare');
    expect(await place(fake.seed.spring(set))).toEqual({ kind: 'play', card: 'snare', on: { kind: 'post', thread, title: 'Hello', seq: 2 }, from: null, at: null, board });
    // Beyond a post: a character (its name, null before its debut), a thread and a board.
    const mine = fake.seed.post(thread, anaFace, 'Mine.');
    expect(await place(fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine }))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'character', id: anaFace, name: 'Ana Face' }, from: { kind: 'post', thread, title: 'Hello', seq: 3 }, at: null, board });
    const unborn = fake.seed.staff('ghost', 'Not Yet', 'mod', { debuted: false });
    const sys = fake.seed.thread('announcements', null, 'Notice').thread;
    const theirs = fake.seed.staffPost(unborn, sys, 'Hidden.');
    expect(await place(fake.seed.reach(boFace, 'character', unborn, 'glint', { post: theirs }))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'character', id: unborn, name: null }, from: { kind: 'post', thread: sys, title: 'Notice', seq: 2 }, at: null, board: await boardId(fake, 'announcements') });
    expect(await place(fake.seed.reach(boFace, 'thread', thread, 'glint'))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'thread', id: thread, title: 'Hello' }, from: null, at: null, board });
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    expect(await place(fake.seed.reach(boFace, 'board', general.id, 'glint'))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'board', slug: 'general', name: 'General' }, from: null, at: null, board: await boardId(fake, 'announcements') });
    // A card that kept an old place number (staged last, since it takes one): still a play, never a post.
    const old = fake.seed.card(anaFace, opener, 'whoops');
    fake.seed.legacyNumber(old);
    expect(await place(old)).toEqual({ kind: 'play', card: 'whoops', on: post, from: null, at: null, board });
  });

  test('a play on a board names the board as it is called now: a rename in force shows, and its end gives the old name back (0152)', async () => {
    const { fake, anaFace, boFace } = world();
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    const spun = must(await fake.spin(fake.seed.reach(boFace, 'board', general.id, 'glint'), anaFace, 'Spun', 'b')).thread.id;
    // The place from the thread's own read and from its board's row, which must agree, beside the name the board list gives.
    const names = async () => {
      const one = (await fake.thread(spun))?.origin;
      const row = (await fake.threads(general.id, { offset: 0, limit: 50 })).threads.find((t) => t.id === spun)?.origin;
      expect(row).toEqual(one);
      return [one, (await fake.boards()).find((b) => b.id === general.id)?.name];
    };
    const system = await boardId(fake, 'announcements');
    const on = (name: string) => [{ kind: 'play', card: 'glint', on: { kind: 'board', slug: 'general', name }, from: null, at: null, board: system }, name];
    expect(await names()).toEqual(on('General'));
    fake.seed.staff('boss', 'The Boss', 'boss');
    const first = fake.seed.move('boss', { board: 'general', name: 'Toast Palace' });
    expect(await names()).toEqual(on('Toast Palace'));
    fake.seed.endMove(first, { why: 'reversed' });
    expect(await names()).toEqual(on('General'));
    // A second rename, after the first has ended: the place follows it too.
    fake.seed.move('boss', { board: 'general', name: 'Crumb Hall' });
    expect(await names()).toEqual(on('Crumb Hall'));
  });

  test('a thread spun from an update has the update\'s place, and a play on an update lands on the update', async () => {
    const { fake, anaFace } = world();
    const update = fake.seed.update({ title: 'Traps bite', body: 'Hi.' });
    const spun = must(await fake.spin(update, anaFace, 'About it', 'b'));
    expect(spun.thread.origin).toEqual({ kind: 'update', act: update, title: 'Traps bite' });
    const played = fake.seed.card(anaFace, update, 'whoops');
    const fromPlay = must(await fake.spin(played, anaFace, 'About the play', 'b'));
    expect(fromPlay.thread.origin).toEqual({ kind: 'play', card: 'whoops', on: { kind: 'update', act: update, title: 'Traps bite' }, from: null, at: null, board: await boardId(fake, 'announcements') });
  });

  test('spunFromMany reads the threads spun from any of several Acts at once, and postPlays the card plays on one', async () => {
    const { fake, anaFace, boFace, thread, opener } = world();
    const second = must(await fake.post(thread, anaFace, 'second', null));
    const a = must(await fake.spin(opener, anaFace, 'From the first', ''));
    const b = must(await fake.spin(second.id, anaFace, 'From the second', ''));
    must(await fake.spin(a.act.id, anaFace, 'From a spin', ''));
    const many = await fake.spunFromMany([opener, second.id], 50);
    expect(many.map((t) => [t.id, t.originActId])).toEqual([[a.thread.id, opener], [b.thread.id, second.id]]);
    expect(await fake.spunFromMany([], 50)).toEqual([]);
    fake.seed.card(boFace, second.id, 'whoops', { message: 'oops' });
    fake.seed.card(boFace, opener, 'whoops');
    const on = (await fake.postPlays([second.id])).plays;
    expect(on.map((c) => [c.kind, c.targetActId, c.payload])).toEqual([['card', second.id, { card: 'whoops', message: 'oops' }]]);
    expect((await fake.postPlays([a.act.id])).plays).toEqual([]);
    /* The reads of spun threads stop at their limit, oldest first. */
    expect((await fake.spunFromMany([opener, second.id], 1)).map((t) => t.id)).toEqual([a.thread.id]);
    expect(await fake.spunFrom(opener, 0)).toEqual([]);
    fake.seed.card(boFace, second.id, 'whoops', { message: 'again' });
    expect((await fake.postPlays([second.id])).plays).toHaveLength(2);
    /* A card's own settings ride in the payload as the server keeps them (Stick Around's sentence). */
    fake.seed.card(boFace, opener, 'stick-around', { message: 'read it', config: { sentence: 'I read it.' } });
    expect((await fake.postPlays([opener])).plays.map((c) => c.payload).filter((p) => p.card === 'stick-around')).toEqual([{ card: 'stick-around', message: 'read it', config: { sentence: 'I read it.' } }]);
  });

  test('a card play takes no thread number, as an edit takes none: the posts keep theirs, and the play is found through its post', async () => {
    const { fake, anaFace, boFace, thread } = world();
    const second = must(await fake.post(thread, anaFace, 'second', null));
    const play = fake.seed.card(boFace, second.id, 'whoops', { message: 'oops' });
    const third = must(await fake.post(thread, anaFace, 'third', null));
    expect(second.seq).toBe(2);
    expect(third.seq).toBe(3);
    const played = await fake.act(play);
    expect([played?.kind, played?.seq, played?.targetActId]).toEqual(['card', null, second.id]);
    expect((await fake.acts(thread, 1, 10)).map((a) => [a.kind, a.seq])).toEqual([['post', 1], ['post', 2], ['post', 3]]);
    const row = await fake.thread(thread);
    expect([row?.lastSeq, row?.lastAct, row?.replies]).toEqual([3, third.id, 2]);
    expect((await fake.postPlays([second.id])).plays.map((c) => c.seq)).toEqual([null]);
  });

  test('a card seeded with a layer and the server\'s config carries them in its payload, as a seeded card\'s play does', async () => {
    const { fake, boFace, opener } = world();
    const play = fake.seed.card(boFace, opener, 'whoops', { message: 'inked', layer: 2, config: { color: '#ff2bd6', seed: 41 } });
    expect((await fake.act(play))?.payload).toEqual({ card: 'whoops', message: 'inked', layer: 2, config: { color: '#ff2bd6', seed: 41 } });
  });

  test('a card seeded live is heard by the thread\'s subscribers, with no number', async () => {
    const { fake, boFace, thread, opener } = world();
    const heard: Act[] = [];
    fake.subscribeThread(thread, { onAct: (a) => heard.push(a) });
    fake.seed.card(boFace, opener, 'whoops', { live: true });
    fake.seed.card(boFace, opener, 'stick-around');
    await flush();
    expect(heard.map((a) => [a.kind, a.seq, a.payload.card])).toEqual([['card', null, 'whoops']]);
  });

  test('effect state: the post\'s author saves it, every reader reads it, and the subscribers hear of it', async () => {
    const { fake, anaFace, anaHeel, boFace, thread } = world();
    const mine = must(await fake.post(thread, anaFace, 'a post to ruin', null));
    const play = fake.seed.card(boFace, mine.id, 'whoops');
    expect(await fake.effectStates([play])).toEqual({});
    const heard: [string, string][] = [];
    fake.subscribeThread(thread, { onEffect: (p, at) => heard.push([p, at]) });
    const saved = must(await fake.saveEffect(play, anaFace, { strokes: [1, 2] }));
    expect(saved.play).toBe(play);
    expect(await fake.effectStates([play, 'nothing'])).toEqual({ [play]: { state: { strokes: [1, 2] }, savedAt: saved.savedAt } });
    await flush();
    expect(heard).toEqual([[play, saved.savedAt]]);
    /* Saved again, the newest is what is kept. */
    fake.clock.advance(1000);
    const again = must(await fake.saveEffect(play, anaFace, { strokes: [] }));
    expect((await fake.effectStates([play]))[play]).toEqual({ state: { strokes: [] }, savedAt: again.savedAt });
    expect(again.savedAt > saved.savedAt).toBe(true);
    /* Refused in the server's words: not the post's author (another of the player's own characters included), not a play, not signed in, not an object. */
    expect(await fake.saveEffect(play, anaHeel, { strokes: [] })).toEqual(refused('only the post\'s author saves what is on it'));
    expect(await fake.saveEffect(mine.id, anaFace, { strokes: [] })).toEqual(refused('there is no such card on a post'));
    expect(await fake.saveEffect(play, boFace, { strokes: [] })).toEqual(refused('you do not play that character'));
    expect(await fake.saveEffect(play, anaFace, null as never)).toEqual(refused('is the effect\'s state, an object', 'state'));
    fake.signInAs(null);
    expect(await fake.saveEffect(play, anaFace, { strokes: [] })).toEqual(refused('sign in to act'));
  });

  test('a play\'s moment: the post as it read when the play landed, each layer as it was saved then, and the plays above live then', async () => {
    const { fake, anaFace, boFace, thread } = world();
    const mine = must(await fake.post(thread, anaFace, 'a post to ruin', null));
    const first = fake.seed.card(boFace, mine.id, 'whoops', { layer: 1 });
    expect(await fake.playMoment(first)).toEqual({ version: await fake.act(mine.id), layers: [{ act: await fake.act(first), state: null }], above: [], recorded: true, at: (await fake.act(first))!.createdAt });
    const saved = must(await fake.saveEffect(first, anaFace, { washed: 0.4 }));
    fake.clock.advance(1000);
    must(await fake.edit(mine.id, anaFace, 'ruined, then edited'));
    fake.clock.advance(1000);
    const onAna = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
    fake.clock.advance(1000);
    const second = fake.seed.card(boFace, mine.id, 'whoops', { layer: 2 });
    /* What comes after the landing changes nothing in the moment: a later save, a later edit, a play beyond a post begun after. */
    fake.clock.advance(1000);
    must(await fake.saveEffect(first, anaFace, { washed: 1 }));
    must(await fake.edit(mine.id, anaFace, 'edited again'));
    fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
    const moment = (await fake.playMoment(second))!;
    expect(moment.recorded).toBe(true);
    expect(moment.version.id).toBe(mine.id);
    expect(moment.version.currentPayload).toEqual({ body: 'ruined, then edited' });
    expect(moment.version.payload).toEqual({ body: 'a post to ruin' });
    expect(moment.layers.map((l) => [l.act.id, l.state])).toEqual([[second, null], [first, { state: { washed: 0.4 }, savedAt: saved.savedAt }]]);
    expect(moment.above.map((a) => a.play)).toEqual([onAna]);
    /* The first play's own moment is unchanged by what landed over it. */
    expect((await fake.playMoment(first))!.layers.map((l) => l.act.id)).toEqual([first]);
    expect((await fake.playMoment(first))!.version.currentPayload).toEqual({ body: 'a post to ruin' });
  });

  test('a moment carries the end of a play an admin had ended by then, and lists no such play above; one ended after it is live in it', async () => {
    const { fake, anaFace, boFace, thread } = world();
    const boss = fake.seed.account('boss', { admin: true });
    const mine = must(await fake.post(thread, anaFace, 'a post to ruin', null));
    const first = fake.seed.card(boFace, mine.id, 'whoops', { layer: 1 });
    fake.clock.advance(1000);
    const onAna = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
    fake.clock.advance(1000);
    const early = fake.seed.card(boFace, mine.id, 'whoops', { layer: 2 });
    fake.clock.advance(1000);
    fake.signInAs(boss);
    const endFirst = must(await fake.reverseCard(first));
    must(await fake.reverseCard(onAna));
    fake.clock.advance(1000);
    const later = fake.seed.card(boFace, mine.id, 'whoops', { layer: 3 });
    const before = (await fake.playMoment(early))!;
    expect(before.layers.map((l) => l.act.id)).toEqual([early, first]);
    expect(before.above.map((a) => a.play)).toEqual([onAna]);
    const after = (await fake.playMoment(later))!;
    expect(after.layers.map((l) => l.act.id)).toEqual([later, first, early, endFirst.act]);
    expect(after.layers.at(-1)).toEqual({ act: await fake.act(endFirst.act), state: null });
    expect(after.above).toEqual([]);
    /* The boundary is momentParts' own: an end at or before the moment names the play, and the layer is not drawn. */
    const rule = { key: 'whoops', name: 'Whoops!', stack: 3, validateState: (s: unknown) => ({ ok: true as const, value: s }) } as unknown as CardRules;
    const ui = [{ key: 'whoops', Effect: () => null }] as unknown as CardUi[];
    expect(momentParts(before, [rule], ui, () => '').drawn.map((p) => p.id).sort()).toEqual([early, first].sort());
    expect(momentParts(after, [rule], ui, () => '').drawn.map((p) => p.id).sort()).toEqual([early, later].sort());
    expect(momentParts(after, [rule], ui, () => '').named).toEqual(['Whoops!, ended by an admin']);
  });

  test('a moment is a play on a post\'s alone, and a play the fake was given no snapshot for answers from its time, by itself', async () => {
    const { fake, anaFace, boFace, thread, opener } = world();
    const mine = must(await fake.post(thread, anaFace, 'old words', null));
    const onThread = fake.seed.reach(anaFace, 'thread', thread, 'glint');
    expect(await fake.playMoment(mine.id)).toBeNull();
    expect(await fake.playMoment(onThread)).toBeNull();
    expect(await fake.playMoment('nothing')).toBeNull();
    const under = fake.seed.card(boFace, mine.id, 'whoops', { layer: 1 });
    const old = fake.seed.card(boFace, mine.id, 'whoops', { layer: 2, unrecorded: true });
    fake.clock.advance(1000);
    must(await fake.edit(mine.id, anaFace, 'edited after'));
    const moment = (await fake.playMoment(old))!;
    expect(moment.recorded).toBe(false);
    expect(moment.version.currentPayload).toEqual({ body: 'old words' });
    expect(moment.layers.map((l) => l.act.id)).toEqual([old]);
    expect((await fake.playMoment(under))!.recorded).toBe(true);
  });

  describe('a spin from a card on a character names the post it was pressed on (0351_spin_at_post.sql)', () => {
    const NOT_THERE = 'that card is not on that post';
    test('a spin at the cast-from post writes `at` on its Act and one moment; the version is the edit as of the spin, and stays so after a later edit', async () => {
      const { fake, anaFace, boFace, thread } = world();
      const mine = must(await fake.post(thread, anaFace, 'The post pressed.', null));
      fake.clock.advance(1000);
      must(await fake.edit(mine.id, anaFace, 'Edited before the spin.'));
      fake.clock.advance(1000);
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      const spun = must(await fake.spin(play, anaFace, 'Spun at', 'body', undefined, mine.id));
      expect(spun.act.payload).toEqual({ title: 'Spun at', body: 'body', at: mine.id });
      expect(spun.act.targetActId).toBe(play);
      const spunAt = spun.act.createdAt;
      fake.clock.advance(1000);
      must(await fake.edit(mine.id, anaFace, 'Edited after the spin.'));
      const moment = (await fake.spinMoment(spun.act.id))!;
      expect(moment.version.id).toBe(mine.id);
      expect(moment.version.currentPayload).toEqual({ body: 'Edited before the spin.' });
      expect(moment.version.payload).toEqual({ body: 'The post pressed.' });
      expect(moment.at).toBe(spunAt);
      expect(moment.recorded).toBe(true);
    });

    test('its layers: the origin play first with no state, then each layer on the post with the state it had saved; a later layer is not in it', async () => {
      const { fake, anaFace, boFace, thread } = world();
      const mine = must(await fake.post(thread, anaFace, 'The post pressed.', null));
      const layer = fake.seed.card(boFace, mine.id, 'whoops', { layer: 1 });
      const saved = must(await fake.saveEffect(layer, anaFace, { washed: 0.4 }));
      fake.clock.advance(1000);
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      const spun = must(await fake.spin(play, anaFace, 'Spun at', 'body', undefined, mine.id));
      fake.clock.advance(1000);
      const later = fake.seed.card(boFace, mine.id, 'whoops', { layer: 2 });
      const moment = (await fake.spinMoment(spun.act.id))!;
      expect(moment.layers.map((l) => [l.act.id, l.state])).toEqual([[play, null], [layer, { state: { washed: 0.4 }, savedAt: saved.savedAt }]]);
      expect(moment.layers.map((l) => l.act.id)).not.toContain(later);
    });

    test('above holds each play live on the post\'s author, thread or board then, and never the origin play', async () => {
      const { fake, anaFace, boFace, thread } = world();
      const mine = must(await fake.post(thread, anaFace, 'The post pressed.', null));
      const other = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      const spun = must(await fake.spin(play, anaFace, 'Spun at', 'body', undefined, mine.id));
      fake.clock.advance(1000);
      fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      const moment = (await fake.spinMoment(spun.act.id))!;
      expect(moment.above.map((a) => a.play)).toEqual([other]);
      expect(moment.layers[0]!.act.id).toBe(play);
    });

    test('a spin is refused in the words `that card is not on that post` for each way its card is not on that post, and writes nothing', async () => {
      const { fake, anaFace, boFace, thread, opener } = world();
      const mine = must(await fake.post(thread, anaFace, 'The post pressed.', null));
      const theirs = opener;
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      const refusedAt = async (origin: string, at: string, through = anaFace) => fake.spin(origin, through, 'Refused', 'b', undefined, at);
      /* A post by another character; an Act that is no post; a play on a post; a thread's play; a board's play; an Act that is nothing. */
      expect(await refusedAt(play, theirs)).toEqual(refused(NOT_THERE));
      expect(await refusedAt(play, play)).toEqual(refused(NOT_THERE));
      expect(await refusedAt(fake.seed.card(boFace, mine.id, 'whoops'), mine.id)).toEqual(refused(NOT_THERE));
      expect(await refusedAt(fake.seed.reach(boFace, 'thread', thread, 'glint'), mine.id)).toEqual(refused(NOT_THERE));
      const general = (await fake.boards()).find((b) => b.slug === 'general')!;
      expect(await refusedAt(fake.seed.reach(boFace, 'board', general.id, 'glint'), mine.id)).toEqual(refused(NOT_THERE));
      expect(await refusedAt(mine.id, mine.id)).toEqual(refused(NOT_THERE));
      expect(await refusedAt(play, '00000000-0000-4000-8000-000000000000')).toEqual(refused(NOT_THERE));
      /* A play whose time has run out. */
      const lapsed = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id, ends: fake.clock.now() + 60_000 });
      expect(must(await fake.spin(lapsed, anaFace, 'Still live', 'b', undefined, mine.id)).act.payload.at).toBe(mine.id);
      fake.clock.advance(120_000);
      expect(await fake.spin(lapsed, anaFace, 'Over', 'b', undefined, mine.id)).toEqual(refused(NOT_THERE));
      expect(await fake.spunFrom(play)).toEqual([]);
    });

    test('a play an admin ended is refused', async () => {
      const { fake, ana, anaFace, boFace, thread } = world();
      const boss = fake.seed.account('boss', { admin: true });
      const mine = must(await fake.post(thread, anaFace, 'The post pressed.', null));
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      expect(must(await fake.spin(play, anaFace, 'Live', 'b', undefined, mine.id)).act.payload.at).toBe(mine.id);
      fake.signInAs(boss);
      must(await fake.reverseCard(play));
      fake.signInAs(ana);
      expect(await fake.spin(play, anaFace, 'Ended', 'b', undefined, mine.id)).toEqual(refused(NOT_THERE));
    });

    test('a spin with no `at` writes no `at` and no moment, for a character play and for a post; the moment of such a spin is null', async () => {
      const { fake, anaFace, boFace, thread, opener } = world();
      const mine = must(await fake.post(thread, anaFace, 'Mine.', null));
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      const fromPlay = must(await fake.spin(play, anaFace, 'No post', 'b'));
      const fromPost = must(await fake.spin(mine.id, anaFace, 'From a post', 'b'));
      expect(fromPlay.act.payload).toEqual({ title: 'No post', body: 'b' });
      expect(fromPost.act.payload).toEqual({ title: 'From a post', body: 'b' });
      expect(await fake.spinMoment(fromPlay.act.id)).toBeNull();
      expect(await fake.spinMoment(fromPost.act.id)).toBeNull();
      expect(await fake.spinMoment(opener)).toBeNull();
      expect(await fake.spinMoment('nothing')).toBeNull();
    });

    test('the place of its thread names the cast-from post and the pressed post; a spin with no post names the first alone', async () => {
      const { fake, anaFace, boFace, thread } = world();
      const mine = fake.seed.post(thread, anaFace, 'Mine.');
      const pressedAt = fake.seed.post(thread, anaFace, 'Pressed.');
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine });
      const from = { kind: 'post', thread, title: 'Hello', seq: 2 };
      const at = { kind: 'post', thread, title: 'Hello', seq: 3 };
      const place = async (args: Parameters<typeof fake.spin>) => (await fake.thread(must(await fake.spin(...args)).thread.id))?.origin;
      // The spin may name any post of the character the play is on, not only the one it was cast from.
      expect(await place([play, anaFace, 'At', 'b', undefined, pressedAt])).toEqual({ kind: 'play', card: 'glint', on: { kind: 'character', id: anaFace, name: 'Ana Face' }, from, at, board: await boardId(fake, 'general') });
      expect(await place([play, anaFace, 'None', 'b'])).toEqual({ kind: 'play', card: 'glint', on: { kind: 'character', id: anaFace, name: 'Ana Face' }, from, at: null, board: await boardId(fake, 'general') });
    });
  });

  describe('a moment shows a version hidden after it as the public projection shows it, and the plays ended by then', () => {
    /** A post by Ana (an original and an edit to hide), a play on her from it, then the spin at each. */
    async function hidden() {
      const { fake, anaFace, boFace, thread } = world();
      const original = must(await fake.post(thread, anaFace, 'Words to be hidden.', null));
      const edited = must(await fake.post(thread, anaFace, 'Fine words.', null));
      fake.clock.advance(1000);
      must(await fake.edit(edited.id, anaFace, 'Edited words to be hidden.'));
      const edit = (await fake.history(edited.id)).at(-1)!;
      fake.clock.advance(1000);
      const k1 = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: original.id });
      const k2 = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: edited.id });
      fake.clock.advance(1000);
      const s1 = must(await fake.spin(k1, anaFace, 'One', 'b', undefined, original.id)).act.id;
      const s2 = must(await fake.spin(k2, anaFace, 'Two', 'b', undefined, edited.id)).act.id;
      return { fake, original, edit, k1, k2, s1, s2 };
    }
    test('a spin\'s moment: a hidden original and a hidden edit leave the moment, as the public projection shows them', async () => {
      const { fake, original, edit, s1, s2 } = await hidden();
      expect((await fake.spinMoment(s1))!.version.currentPayload).toEqual({ body: 'Words to be hidden.' });
      fake.seed.hide(original.id, 'hide');
      fake.seed.hide(edit.id, 'hide');
      const a = (await fake.spinMoment(s1))!.version.currentPayload;
      expect(a).toEqual((await fake.act(original.id))!.payload);
      expect(a.body).not.toBe('Words to be hidden.');
      const b = (await fake.spinMoment(s2))!.version.currentPayload;
      expect(b.body).not.toBe('Edited words to be hidden.');
      expect(b).toEqual((await fake.history(edit.targetActId ?? edit.id)).at(-1)!.payload);
    });
    test('a character play\'s moment: the same', async () => {
      const { fake, original, edit, k1, k2 } = await hidden();
      expect((await fake.playMoment(k1))!.version.currentPayload).toEqual({ body: 'Words to be hidden.' });
      fake.seed.hide(original.id, 'hide');
      fake.seed.hide(edit.id, 'hide');
      const a = (await fake.playMoment(k1))!.version.currentPayload;
      expect(a).toEqual((await fake.act(original.id))!.payload);
      expect(a.body).not.toBe('Words to be hidden.');
      expect((await fake.playMoment(k2))!.version.currentPayload.body).not.toBe('Edited words to be hidden.');
    });
    test('a spin\'s moment holds the end of a layer at or before the spin and not a later one, and lists no play above that ended before it', async () => {
      const { fake, ana, anaFace, boFace, thread } = world();
      const boss = fake.seed.account('boss', { admin: true });
      const mine = must(await fake.post(thread, anaFace, 'The post pressed.', null));
      const early = fake.seed.card(boFace, mine.id, 'whoops', { layer: 1 });
      const late = fake.seed.card(boFace, mine.id, 'whoops', { layer: 2 });
      const endedAbove = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      const liveAbove = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      const origin = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      fake.signInAs(boss);
      const endEarly = must(await fake.reverseCard(early));
      must(await fake.reverseCard(endedAbove));
      fake.clock.advance(1000);
      fake.signInAs(ana);
      const s = must(await fake.spin(origin, anaFace, 'Spun', 'b', undefined, mine.id)).act.id;
      fake.clock.advance(1000);
      fake.signInAs(boss);
      const endLate = must(await fake.reverseCard(late));
      must(await fake.reverseCard(liveAbove));
      const moment = (await fake.spinMoment(s))!;
      const ids = moment.layers.map((l) => l.act.id);
      expect(ids[0]).toBe(origin);
      expect(ids).toContain(endEarly.act);
      expect(ids).not.toContain(endLate.act);
      expect(moment.above.map((a) => a.play)).toEqual([liveAbove]);
    });
  });

  describe('a play on a character has a moment (0352_character_play_moment.sql)', () => {
    test('it is the cast-from post as it read then, the play itself first and not above, recorded, at the play\'s time; a play on a post answers `at` too', async () => {
      const { fake, anaFace, boFace, thread } = world();
      const mine = must(await fake.post(thread, anaFace, 'Words then.', null));
      const layer = fake.seed.card(boFace, mine.id, 'whoops', { layer: 1 });
      fake.clock.advance(1000);
      const other = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      const play = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
      fake.clock.advance(1000);
      must(await fake.edit(mine.id, anaFace, 'Words after.'));
      const moment = (await fake.playMoment(play))!;
      expect(moment.version.id).toBe(mine.id);
      expect(moment.version.currentPayload).toEqual({ body: 'Words then.' });
      expect(moment.layers.map((l) => l.act.id)).toEqual([play, layer]);
      expect(moment.above.map((a) => a.play)).toEqual([other]);
      expect(moment.recorded).toBe(true);
      expect(moment.at).toBe((await fake.act(play))!.createdAt);
      expect((await fake.playMoment(layer))!.at).toBe((await fake.act(layer))!.createdAt);
    });

    test('a character play with no snapshot answers the version current at its time, itself alone, not recorded; a thread\'s play is still refused', async () => {
      const { fake, anaFace, boFace, thread } = world();
      const mine = must(await fake.post(thread, anaFace, 'Old words.', null));
      const old = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id, unrecorded: true });
      fake.clock.advance(1000);
      must(await fake.edit(mine.id, anaFace, 'Edited after.'));
      const moment = (await fake.playMoment(old))!;
      expect(moment.recorded).toBe(false);
      expect(moment.version.currentPayload).toEqual({ body: 'Old words.' });
      expect(moment.layers.map((l) => l.act.id)).toEqual([old]);
      expect(await fake.playMoment(fake.seed.reach(boFace, 'thread', thread, 'glint'))).toBeNull();
    });
  });

  test('releasing from an effect is the player\'s own, kept from the first, and read back only for the plays asked about', async () => {
    const { fake, bo, anaFace, boFace, thread, opener } = world();
    const mine = must(await fake.post(thread, anaFace, 'held', null));
    const play = fake.seed.card(boFace, mine.id, 'stick-around');
    const other = fake.seed.card(boFace, opener, 'stick-around');
    expect(await fake.myReleases([play, other])).toEqual([]);
    const first = must(await fake.releaseEffect(play));
    expect(first.play).toBe(play);
    fake.clock.advance(1000);
    expect(must(await fake.releaseEffect(play)).releasedAt).toBe(first.releasedAt);
    expect(await fake.myReleases([play, other])).toEqual([play]);
    expect(await fake.myReleases([other])).toEqual([]);
    expect(await fake.releaseEffect(mine.id)).toEqual(refused('there is no such card on a post'));
    /* Another player's release is not this one's. */
    fake.signInAs(bo);
    expect(await fake.myReleases([play])).toEqual([]);
    fake.signInAs(null);
    expect(await fake.releaseEffect(play)).toEqual(refused('sign in to act'));
    expect(await fake.myReleases([play])).toEqual([]);
  });

  test('loseNextAnswer: the next post answers with an uncertain refusal, done or not as asked, once', async () => {
    const { fake, anaFace, thread } = world();
    fake.seed.loseNextAnswer(true);
    const lost = await fake.post(thread, anaFace, 'did go', null);
    expect(lost).toEqual({ ok: false, error: expect.stringContaining('may have gone through'), uncertain: true });
    fake.seed.loseNextAnswer(false);
    expect((await fake.post(thread, anaFace, 'did not go', null)).ok).toBe(false);
    expect((await fake.post(thread, anaFace, 'plain', null)).ok).toBe(true);
    const bodies = (await fake.acts(thread, 1, 99)).map((a) => a.payload.body);
    expect(bodies).toContain('did go');
    expect(bodies).not.toContain('did not go');
    expect(bodies).toContain('plain');
  });

  test('failNextRead: the next read rejects with that kind, once', async () => {
    const { fake, thread } = world();
    fake.seed.failNextRead('server');
    const failed = await fake.acts(thread, 1, 99).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(ReadFailure);
    expect(failureKind(failed)).toBe('server');
    expect((failed as Error).message).toBe('that could not be read right now; try again');
    expect(await fake.acts(thread, 1, 99)).toBeInstanceOf(Array);
  });

  test('failNextRead does not fail a write that comes first: the write goes through and the next read fails', async () => {
    const { fake } = world();
    fake.seed.failNextRead('server');
    const wrote = await fake.setPreferences({ motion: 'reduce' });
    expect(wrote.ok).toBe(true);
    const failed = await fake.acts('none', 1, 9).catch((e: unknown) => e);
    expect(failureKind(failed)).toBe('server');
  });

  test('offline: a write answers the not-sent refusal and changes nothing; a read rejects as offline', async () => {
    const { fake, thread } = world();
    fake.seed.offline(true);
    expect(await fake.setPreferences({ motion: 'reduce' })).toEqual({ ok: false, error: NOT_SENT, notSent: true });
    const failed = await fake.acts(thread, 1, 99).catch((e: unknown) => e);
    expect(failureKind(failed)).toBe('offline');
    expect(await fake.markRead(thread, 1, null)).toBe(false);
    fake.seed.offline(false);
    const prefs = await fake.preferences();
    expect(prefs.motion).toBe('system');
    expect(await fake.acts(thread, 1, 99)).toBeInstanceOf(Array);
    /* Signing out needs no server, so it goes through offline. */
    fake.seed.offline(true);
    await fake.signOut();
    fake.seed.offline(false);
    expect((await fake.session()).signedIn).toBe(false);
  });

  test('a player\'s seeded Act takes the time it is given, as The System\'s does', async () => {
    const { fake, anaFace, thread } = world();
    const old = fake.clock.now() - 20 * DAY;
    const id = fake.seed.post(thread, anaFace, 'long ago', { at: old });
    expect((await fake.act(id))?.createdAt).toBe(new Date(old).toISOString());
    const made = fake.seed.thread('general', anaFace, 'Old thread', 'x', { at: old });
    const row = await fake.thread(made.thread);
    expect([row?.createdAt, row?.lastAt]).toEqual([new Date(old).toISOString(), new Date(old).toISOString()]);
    // A back-dated reply is not this week's.
    expect((await fake.thread(thread))?.repliesThisWeek).toBe(0);
    expect((await fake.thread(thread))?.replies).toBe(1);
    // And a later one with no time is made now again.
    const now = fake.seed.post(thread, anaFace, 'now');
    expect((await fake.act(now))?.createdAt).toBe(new Date(fake.clock.now()).toISOString());
  });
});

describe('the Vending Machine and a card play, refused as the server refuses them', () => {
  /* One salty card at 1.00, and a long post costs 0.50 more: the rules the server prices a play by (engine/rules/cards.ts). */
  const splat = {
    key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, stack: 2,
    playPrice: (_s: Settings, t: CardTarget) => (t.reach === 'post' && t.length > 20 ? 50 : 0),
    canApply: (t: CardTarget, on: readonly { card: string | null }[]) => (t.reach !== 'post' || t.kind !== 'post' ? refused2('a card lands on a post') : on.length >= 2 ? refused2('this post already carries 2 of that card, the most it takes') : { ok: true as const, value: undefined }),
    validateConfig: (c: unknown) => ([undefined, 'red'].includes((c as { color?: unknown } | undefined)?.color as string | undefined) ? { ok: true as const, value: c ?? {} } : refused2('the ink is red')),
  };
  const refused2 = (why: string) => ({ ok: false as const, why });
  const shop: Instance = {
    ...instance, cards: [splat], settings: { ...settings, economy: {} },
    packs: [{ key: 'booster', pulls: [1, 2, 3, 4, 5].map(() => ({ weights: { common: 1 } })) }],
    machine: [
      { item: { card: splat.key }, availability: 'onSale' as const, price: 100 }, { item: { pack: 'booster' }, availability: 'onSale' as const, price: 300 },
      { item: { card: 'secret' }, availability: 'hidden' as const, price: 100 },
    ],
  };
  function shopWorld(wallet: number, held = 0) {
    const fake = createFake({ instance: shop });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    fake.seed.wallet(ana, wallet);
    if (held > 0) fake.seed.cards(ana, { splat: held });
    fake.signInAs(ana);
    return { fake, ana, anaFace, boFace, thread, opener };
  }

  test('buying takes the card\'s price from the settled wallet, and the count rises by one', async () => {
    const { fake } = shopWorld(562, 1);
    expect(must(await fake.buyCard(await slotOf(fake, 'splat')))).toEqual({ card: 'splat', balance: 462, held: 2 });
    expect(await fake.wallet()).toEqual({ balance: 462, cap: 600 });
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 2 }]);
  });

  test('a wallet that holds less than the price is refused in the server\'s words, and nothing is spent or given', async () => {
    const { fake } = shopWorld(99);
    expect(await fake.buyCard(await slotOf(fake, 'splat'))).toEqual(refused('that costs 1.00, and your wallet holds 0.99'));
    expect((await fake.wallet()).balance).toBe(99);
    expect(await fake.myCards()).toEqual([]);
  });

  test('the ghost estimate is not the wallet: a purchase reads the settled balance only', async () => {
    const { fake, ana } = shopWorld(50);
    fake.seed.estimate(ana, { entries: [{ character: fake.seed.character(ana, 'Ghosty', 'face'), reason: 'face.cheered', amount: 500 }] });
    expect((await fake.buyCard(await slotOf(fake, 'splat'))).ok).toBe(false);
  });

  test('the machine lists the slots on sale or sold out in grid order, and no hidden slot', async () => {
    const { fake } = shopWorld(0);
    expect((await fake.machine()).map((m) => [m.position, m.item, m.rarity, m.availability, m.price, m.move])).toEqual([
      [1, { card: 'splat' }, 'common', 'onSale', 100, null], [2, { pack: 'booster' }, null, 'onSale', 300, null],
    ]);
    fake.seed.slot({ card: 'splat' }, { availability: 'soldOut', price: 175 });
    expect((await fake.machine()).map((m) => [m.availability, m.price])).toEqual([['soldOut', 175], ['onSale', 300]]);
  });

  test('a move seeded on a slot is shown as seeded and changes nothing else: the fake applies no move, so a test seeds the availability and price a move would have made', async () => {
    const { fake } = shopWorld(0);
    const pulled = { kind: 'pullSlot' as const, act: 'act-1', ends: '2026-11-09T12:00:00Z', demand: null, progress: null, was: 100, percent: null, hours: null };
    fake.seed.slot({ card: 'splat' }, { move: pulled });
    expect((await fake.machine()).map((m) => [m.availability, m.price, m.move])).toEqual([['onSale', 100, pulled], ['onSale', 300, null]]);
    fake.seed.slot({ card: 'splat' }, { move: null });
    expect((await fake.machine())[0]!.move).toBeNull();
  });

  test('a pack adds its five cards to the hand, takes its price, and says what it gave in pull order', async () => {
    const { fake } = shopWorld(500);
    const slot = (await fake.machine()).find((m) => 'pack' in m.item)!;
    const opened = must(await fake.buyPack(slot));
    expect(opened.contents).toEqual(['splat', 'splat', 'splat', 'splat', 'splat']);
    expect(opened.balance).toBe(200);
    expect(await fake.wallet()).toEqual({ balance: 200, cap: 600 });
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 5 }]);
  });

  test('a pack is in the player\'s log as its row and a pulled row per card, and a purchase at a moved price says so', async () => {
    const { fake } = shopWorld(1000);
    const slot = (await fake.machine()).find((m) => 'pack' in m.item)!;
    const opened = must(await fake.buyPack(slot));
    const log = await fake.log(null);
    expect(log.packs).toEqual([{ pack: opened.pack, kind: 'booster', price: 300, repriced: false, contents: opened.contents, at: expect.any(String), source: 'bought', openedAt: expect.any(String) }]);
    expect(log.cards.filter((c) => c.kind === 'pulled').map((c) => [c.card, c.pack, c.price])).toEqual(opened.contents.map((c) => [c, opened.pack, 0]));
    fake.seed.slot({ card: 'splat' }, { price: 150, move: { kind: 'repriceSlot', act: 'a1', ends: '2026-11-09T12:00:00Z', demand: null, progress: null, was: 100, percent: 150, hours: null } });
    must(await fake.buyCard((await fake.machine()).find((m) => 'card' in m.item)!));
    expect((await fake.log(null)).cards.find((c) => c.kind === 'bought')).toMatchObject({ price: 150, repriced: true });
  });

  test('a card that writes is not sold where the instance runs no old voice, and is where it does', async () => {
    const typewriter = { ...splat, key: 'typewriter', name: 'Typewriter', writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
    const sells = (oldVoice: boolean) => {
      const own: Instance = { ...shop, cards: [splat, typewriter], settings: { ...shop.settings, oldVoice }, machine: [...shop.machine, { item: { card: 'typewriter' }, availability: 'onSale' as const, price: 100 }] };
      const fake = createFake({ instance: own });
      const ana = fake.seed.account('ana');
      fake.seed.wallet(ana, 500);
      fake.signInAs(ana);
      return fake;
    };
    const on = sells(true);
    expect((await on.buyCard(await slotOf(on, 'typewriter'))).ok).toBe(true);
    const off = sells(false);
    expect(await off.buyCard(await slotOf(off, 'typewriter'))).toEqual(refused("The old voice isn't running on this forum, so this card can't be played."));
  });

  test('a card the instance withholds is in no open pack, as roll_pack leaves it out: a Pull of it ends when another pack goes off sale, where it would stay with the old voice', async () => {
    const typewriter = { ...splat, key: 'typewriter', name: 'Typewriter', writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
    const pull = { kind: 'pullSlot' as const, act: 'no-such-act', ends: '2026-11-09T12:00:00Z', demand: null, progress: null, was: 100, percent: null, hours: null };
    const ended = async (oldVoice: boolean) => {
      const own: Instance = {
        ...shop, cards: [splat, typewriter], settings: { ...shop.settings, oldVoice },
        packs: [{ key: 'booster', pulls: [{ weights: { common: 1 } }] }, { key: 'second', pulls: [{ weights: { common: 1 } }] }],
        machine: [{ item: { card: 'typewriter' }, availability: 'onSale' as const, price: 100 }, { item: { pack: 'booster' }, availability: 'onSale' as const, price: 300 }, { item: { pack: 'second' }, availability: 'onSale' as const, price: 300 }],
      };
      const fake = createFake({ instance: own });
      fake.signInAs(fake.seed.account('boss', { admin: true }));
      fake.seed.slot({ card: 'typewriter' }, { move: pull });
      const booster = (await fake.adminMachine()).find((m) => 'pack' in m.item && m.item.pack === 'booster')!;
      const answer = await fake.setSlot(booster.id, 'soldOut', booster.price);
      return answer.ok ? answer.value.ended : -1;
    };
    expect(await ended(true)).toBe(0);
    expect(await ended(false)).toBe(1);
  });

  test('a card a fixed pack on sale holds is in an open pack, so its Pull stays when another pack goes off sale', async () => {
    const pull = { kind: 'pullSlot' as const, act: 'no-such-act', ends: '2026-11-09T12:00:00Z', demand: null, progress: null, was: 100, percent: null, hours: null };
    const own: Instance = {
      ...shop, cards: [splat],
      packs: [{ key: 'booster', pulls: [{ weights: { common: 1 } }] }, { key: 'starter', contents: ['splat'] }],
      machine: [{ item: { card: 'splat' }, availability: 'onSale' as const, price: 100 }, { item: { pack: 'booster' }, availability: 'onSale' as const, price: 300 }, { item: { pack: 'starter' }, availability: 'onSale' as const, price: 300 }],
    };
    const fake = createFake({ instance: own });
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    fake.seed.slot({ card: 'splat' }, { move: pull });
    const booster = (await fake.adminMachine()).find((m) => 'pack' in m.item && m.item.pack === 'booster')!;
    const answer = await fake.setSlot(booster.id, 'soldOut', booster.price);
    expect(answer.ok ? answer.value.ended : -1).toBe(0);
  });

  test('a purchase is refused in the server\'s words: a sold out slot, a stale price, the wrong kind of slot, and a wallet that falls short', async () => {
    const { fake } = shopWorld(500);
    const card = await slotOf(fake, 'splat');
    const pack = (await fake.machine()).find((m) => 'pack' in m.item)!;
    expect(await fake.buyPack(card)).toEqual(refused('this slot sells a card, not a pack'));
    expect(await fake.buyCard(pack)).toEqual(refused('this slot sells a pack, not a card'));
    fake.seed.slot({ card: 'splat' }, { price: 250 });
    expect(await fake.buyCard(card)).toEqual(refused('the price is now 2.50, not 1.00'));
    fake.seed.slot({ card: 'splat' }, { availability: 'soldOut' });
    expect(await fake.buyCard(await slotOf(fake, 'splat'))).toEqual(refused('this slot is sold out'));
    fake.seed.slot({ card: 'splat' }, { availability: 'hidden' });
    expect(await fake.buyCard(card)).toEqual(refused('the machine has no such slot'));
    expect(await fake.myCards()).toEqual([]);
    expect((await fake.wallet()).balance).toBe(500);
    const poor = shopWorld(299).fake;
    expect(await poor.buyPack((await poor.machine()).find((m) => 'pack' in m.item)!)).toEqual(refused('that costs 3.00, and your wallet holds 2.99'));
    expect(await poor.myCards()).toEqual([]);
  });

  test('a card the machine does not sell, and signed out, are refused as the decision refuses them', async () => {
    const { fake } = shopWorld(500);
    expect(await fake.buyCard({ id: '00000000-0000-4000-9000-0000000000ff', position: 9, item: { card: 'nothing' }, rarity: null, availability: 'onSale', price: 100, move: null })).toEqual(refused('the machine has no such slot'));
    expect(await fake.buyCard({ ...(await slotOf(fake, 'splat')), id: 'nothing' })).toMatchObject({ ok: false, field: 'slot' });
    fake.signInAs(null);
    expect(await fake.buyCard(await slotOf(fake, 'splat'))).toEqual(refused('sign in to act'));
  });

  test('a play needs a card in hand, in the server\'s words, and spends the card and the price of the post', async () => {
    const { fake, anaFace, opener } = shopWorld(500);
    expect(await fake.playCard('splat', anaFace, opener, {}, '')).toEqual(refused('you hold no "splat" card; the Vending Machine sells them'));
    must(await fake.buyCard(await slotOf(fake, 'splat')));
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 1 }]);
    const played = must(await fake.playCard('splat', anaFace, opener, { color: 'red' }, ' Take that. '));
    expect(played).toMatchObject({ kind: 'card', character: anaFace, targetActId: opener, seq: null, payload: { card: 'splat', layer: 1, message: 'Take that.', config: { color: 'red' } } });
    /* The post is 10 characters, so the play costs nothing more than the card already bought. */
    expect((await fake.wallet()).balance).toBe(400);
    expect(await fake.myCards()).toEqual([]);
  });

  test('a play is priced from the post as it stands, refused where the wallet cannot pay it, and keeps the layer count of a stack', async () => {
    const { fake, ana, anaFace, boFace, thread } = shopWorld(0, 3);
    const long = fake.seed.post(thread, boFace, 'x'.repeat(30));
    fake.seed.wallet(ana, 49);
    expect(await fake.playCard('splat', anaFace, long, {}, '')).toEqual(refused('that costs 0.50, and your wallet holds 0.49'));
    fake.seed.wallet(ana, 100);
    expect(must(await fake.playCard('splat', anaFace, long, {}, '')).payload).toMatchObject({ layer: 1 });
    expect(must(await fake.playCard('splat', anaFace, long, {}, '')).payload).toMatchObject({ layer: 2 });
    expect(await fake.playCard('splat', anaFace, long, {}, '')).toEqual(refused('this post already carries 2 of that card, the most it takes', 'config'));
    expect((await fake.wallet()).balance).toBe(0);
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 1 }]);
  });

  test('a play is refused for a character the player does not play, a target that is no post, a bad setting and a message past 200', async () => {
    const { fake, anaFace, boFace, thread, opener } = shopWorld(500, 1);
    expect(await fake.playCard('splat', boFace, opener, {}, '')).toEqual(refused('you do not play that character'));
    expect(await fake.playCard('splat', anaFace, thread, {}, '')).toMatchObject({ ok: false });
    expect(await fake.playCard('splat', anaFace, opener, { color: 'blue' }, '')).toEqual(refused('the ink is red', 'config'));
    expect(await fake.playCard('splat', anaFace, opener, {}, 'x'.repeat(201))).toMatchObject({ ok: false, field: 'message' });
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 1 }]);
  });
});

describe('a character\'s public month', () => {
  test('joined is the first day of the month it debuted, never a time', async () => {
    const { fake, ana } = world();
    const early = fake.seed.character(ana, 'Early', 'face', { at: Date.UTC(2026, 9, 3, 4, 5, 6) });
    const late = fake.seed.character(ana, 'Late', 'face', { at: Date.UTC(2026, 9, 31, 23, 59, 59) });
    const next = fake.seed.character(ana, 'Next', 'face', { at: Date.UTC(2026, 10, 1, 0, 0, 1) });
    const shown = await fake.characters([early, late, next]);
    expect(shown.map((c) => c.joined)).toEqual(['2026-10-01', '2026-10-01', '2026-11-01']);
  });
});

describe('counts for a page of postbits', () => {
  test('characterStats counts each debuted character\'s posts only, 0 where none, for every id asked', async () => {
    const { fake, ana, anaFace, anaHeel, boFace, thread, opener } = world();
    const waiting = fake.seed.character(ana, 'Waiting', 'face', { debuted: false });
    const mine = must(await fake.post(thread, anaFace, 'one', null));
    await fake.post(thread, anaFace, 'two', null);
    await fake.edit(mine.id, anaFace, 'one, edited');
    must(await fake.spin(opener, anaFace, 'Spun', ''));
    expect(await fake.characterStats([anaFace, anaHeel, boFace, waiting, 'nobody'])).toEqual({
      [anaFace]: { posts: 2 }, [anaHeel]: { posts: 0 }, [boFace]: { posts: 1 }, [waiting]: { posts: 0 }, nobody: { posts: 0 },
    });
    expect(await fake.characterStats([])).toEqual({});
  });
});


describe('a place and a standing, read for one character or a page of them', () => {
  test('standingAmounts is each asked character\'s standing: 0 for one with nothing settled, and for one that is not a character', async () => {
    const { fake, ana, anaFace, anaHeel, boFace } = world();
    const waiting = fake.seed.character(ana, 'Not Yet', 'face', { debuted: false });
    fake.seed.settle({ standings: { [anaFace]: 300, [boFace]: -40 }, debut: false });
    expect(await fake.standingAmounts([anaFace, boFace, anaHeel, waiting, 'nobody'])).toEqual({ [anaFace]: 300, [boFace]: -40, [anaHeel]: 0, [waiting]: 0, nobody: 0 });
    expect(await fake.standingAmounts([])).toEqual({});
  });

  test('standingPlace is the standing, the place and the number of debuted characters, as the ranking says them, and null for one that has not debuted', async () => {
    const { fake, ana, anaFace, anaHeel, boFace } = world();
    const waiting = fake.seed.character(ana, 'Not Yet', 'face', { debuted: false });
    fake.seed.settle({ standings: { [anaFace]: 300, [anaHeel]: 300, [boFace]: -40 }, debut: false });
    const all = await fake.standingsPage(0, 1000);
    for (const s of all) expect(await fake.standingPlace(s.character)).toEqual({ standing: s.standing, place: s.place, of: all.length });
    /* A debt holds no place (#492): only a standing above zero is placed. The tie at 300 shares place 1. */
    expect(await fake.standingPlace(boFace)).toEqual({ standing: -40, place: null, of: all.length });
    expect((await fake.standingPlace(anaHeel))?.place).toBe(1);
    expect(await fake.standingPlace(waiting)).toBeNull();
    expect(await fake.standingPlace('nobody')).toBeNull();
  });
});

describe('one board', () => {
  test('board is one board by its slug or its id, and null for neither', async () => {
    const { fake } = world();
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    const { threadCount: _c, lastAt: _a, lastCharacter: _l, lastThread: _t, lastTitle: _n, ...row } = general;
    expect(await fake.board('general')).toEqual(row);
    expect(await fake.board(general.id)).toEqual(row);
    expect((await fake.board('announcements'))?.isSystem).toBe(true);
    expect(await fake.board('nowhere')).toBeNull();
  });
});

describe('a finished season\'s results and its announcements', () => {
  const at = (day: number, hour = 0) => Date.UTC(2026, 9, day, hour);
  /** Season 1 ended and its results landed; Ana Face 2nd, Bo Face 1st, Ana Heel 3rd (tied standings, so place 3 and 3 by name). */
  function ended() {
    const w = world();
    w.fake.seed.season({ number: 1, startsAt: new Date(at(1)).toISOString(), endsAt: new Date(at(28)).toISOString() });
    w.fake.seed.season({ number: 2, startsAt: new Date(at(28)).toISOString() });
    w.fake.seed.seasonResults(1, [
      { character: w.anaFace, place: 2, standing: 400, shown: [{ kind: 'reveal', act: w.opener, at: new Date(at(3)).toISOString(), class: 'face', was: null }] },
      { character: w.boFace, place: 1, standing: 900 },
      { character: w.anaHeel, name: 'Ana Heel (then)', place: 3, standing: 100 },
    ], { at: at(28, 12) });
    return w;
  }

  test('finishedSeasons lists the seasons whose results landed, newest first, with the character count', async () => {
    const { fake } = ended();
    expect(await fake.finishedSeasons()).toEqual([
      { number: 1, startsAt: new Date(at(1)).toISOString(), endsAt: new Date(at(28)).toISOString(), resultsAt: new Date(at(28, 12)).toISOString(), characters: 3 },
    ]);
    fake.seed.seasonResults(2, [{ character: fake.seed.character(fake.seed.account('cy'), 'Cy', 'face'), place: 1, standing: 5 }], { at: at(29) });
    expect((await fake.finishedSeasons()).map((x) => x.number)).toEqual([2, 1]);
    expect((await createFake({ instance }).finishedSeasons())).toEqual([]);
  });

  test('resultsPage is the final table by place, then name, 50 to a page, with the name as it was then; a page past the end is empty', async () => {
    const { fake, boFace, anaFace, anaHeel, opener } = ended();
    expect(await fake.resultsPage(1, 1)).toEqual([
      { character: boFace, name: 'Bo Face', place: 1, standing: 900, shown: [] },
      { character: anaFace, name: 'Ana Face', place: 2, standing: 400, shown: [{ kind: 'reveal', act: opener, at: new Date(at(3)).toISOString(), class: 'face', was: null }] },
      { character: anaHeel, name: 'Ana Heel (then)', place: 3, standing: 100, shown: [] },
    ]);
    expect(await fake.resultsPage(1, 0)).toHaveLength(3);
    expect(await fake.resultsPage(1, 2)).toEqual([]);
    expect(await fake.resultsPage(7, 1)).toEqual([]);
    const many = world();
    many.fake.seed.season({ number: 1, endsAt: new Date(at(28)).toISOString() });
    const who = many.fake.seed.account('crowd');
    many.fake.seed.seasonResults(1, Array.from({ length: 120 }, (_, i) => ({ character: many.fake.seed.character(who, `C${String(i).padStart(3, '0')}`, 'face'), place: i + 1, standing: 1000 - i })));
    expect((await many.fake.resultsPage(1, 1))).toHaveLength(50);
    expect((await many.fake.resultsPage(1, 3)).map((r) => r.place)).toEqual(Array.from({ length: 20 }, (_, i) => 101 + i));
  });

  test('resultPlace is the character\'s 0-based index in that order, so its page is floor(index / 50) + 1; null where the season has no row for it', async () => {
    const { fake, boFace, anaFace, anaHeel } = ended();
    expect([await fake.resultPlace(1, boFace), await fake.resultPlace(1, anaFace), await fake.resultPlace(1, anaHeel)]).toEqual([0, 1, 2]);
    expect(await fake.resultPlace(1, 'nobody')).toBeNull();
    expect(await fake.resultPlace(2, boFace)).toBeNull();
    const many = world();
    many.fake.seed.season({ number: 1, endsAt: new Date(at(28)).toISOString() });
    const who = many.fake.seed.account('crowd');
    const ids = Array.from({ length: 60 }, (_, i) => many.fake.seed.character(who, `C${String(i).padStart(2, '0')}`, 'face'));
    many.fake.seed.seasonResults(1, ids.map((character, i) => ({ character, place: i + 1, standing: 100 - i })));
    const idx = (await many.fake.resultPlace(1, ids[55]!))!;
    expect(idx).toBe(55);
    expect((await many.fake.resultsPage(1, Math.floor(idx / 50) + 1)).some((r) => r.character === ids[55])).toBe(true);
  });

  test('a character\'s profile and record carry its seasons from the results, newest first, as { season, place, standing, at }', async () => {
    const { fake, anaFace, boFace } = ended();
    fake.seed.seasonResults(2, [{ character: anaFace, place: 5, standing: 20 }], { at: at(29) });
    const seasons = [
      { season: 2, place: 5, standing: 20, at: new Date(at(29)).toISOString() },
      { season: 1, place: 2, standing: 400, at: new Date(at(28, 12)).toISOString() },
    ];
    expect((await fake.profilePage(anaFace))?.seasons).toEqual(seasons);
    expect((await fake.recordPage(anaFace, 'seasons', 1))?.seasons).toEqual(seasons);
    expect((await fake.recordPage(anaFace, 'post', 1))?.seasons).toEqual([]);
    expect((await fake.profilePage(boFace))?.seasons).toEqual([{ season: 1, place: 1, standing: 900, at: new Date(at(28, 12)).toISOString() }]);
  });

  test('season news has a results item with no Act, thread or sequence number, from the rows, with the top three', async () => {
    const { fake, boFace, anaFace, anaHeel } = ended();
    const [item] = await fake.seasonNews();
    expect(item).toMatchObject({ kind: 'results', act: null, thread: null, seq: null, season: 1, count: 3, at: new Date(at(28, 12)).toISOString() });
    expect(item!.top.map((t) => [t.character, t.place])).toEqual([[boFace, 1], [anaFace, 2], [anaHeel, 3]]);
  });

  test('an unplaced row (a standing of 0 or below, #492) follows the placed ones by standing, and the news podium is the placed alone', async () => {
    const w = world();
    w.fake.seed.season({ number: 1, startsAt: new Date(at(1)).toISOString(), endsAt: new Date(at(28)).toISOString() });
    w.fake.seed.season({ number: 2, startsAt: new Date(at(28)).toISOString() });
    const boHeel = w.fake.seed.character(w.bo, 'Bo Heel', 'heel');
    w.fake.seed.seasonResults(1, [
      { character: w.anaHeel, place: null, standing: -30 },
      { character: boHeel, place: null, standing: 0 },
      { character: w.anaFace, place: null, standing: 0 },
      { character: w.boFace, place: 1, standing: 500 },
    ], { at: at(28, 12) });
    expect((await w.fake.resultsPage(1, 1)).map((r) => [r.name, r.place, r.standing])).toEqual([
      ['Bo Face', 1, 500], ['Ana Face', null, 0], ['Bo Heel', null, 0], ['Ana Heel', null, -30],
    ]);
    expect([await w.fake.resultPlace(1, w.boFace), await w.fake.resultPlace(1, w.anaFace), await w.fake.resultPlace(1, boHeel), await w.fake.resultPlace(1, w.anaHeel)]).toEqual([0, 1, 2, 3]);
    const [item] = await w.fake.seasonNews();
    expect(item!.top.map((t) => [t.character, t.place])).toEqual([[w.boFace, 1]]);
    expect(item!.count).toBe(4);
    expect((await w.fake.profilePage(w.anaHeel))?.seasons).toEqual([{ season: 1, place: null, standing: -30, at: new Date(at(28, 12)).toISOString() }]);
  });

  test('seed.announce writes the character\'s own announce Act in the season\'s Promos thread, which a board lists', async () => {
    const { fake, anaFace, boFace } = world();
    const first = fake.seed.announce(anaFace, 'debut', { class: 'face', at: at(5, 8) });
    const second = fake.seed.announce(boFace, 'turn', { was: 'heel', class: 'face', at: at(5, 8) });
    const a = (await fake.act(first))!;
    expect(a).toMatchObject({ kind: 'announce', character: anaFace, payload: { what: 'debut', class: 'face' } });
    expect((await fake.act(second))!.thread).toBe(a.thread);
    expect((await fake.act(second))!.payload).toEqual({ what: 'turn', was: 'heel', class: 'face' });
    expect((await fake.thread(a.thread))?.title).toBe('Promos 1');
    expect((await fake.season())?.turnsThread).toBe(a.thread);
    const board = (await fake.boards()).find((b) => b.slug === 'announcements')!;
    expect((await fake.threads(board.id, { offset: 0, limit: 20 })).threads.map((t) => t.id)).toContain(a.thread);
    expect(() => fake.seed.announce(anaFace, 'debut', { was: 'face' })).toThrow('a debut has no class it was');
  });

  test('an announcements item is one landing: the announce Acts of a thread at one instant, debuts then Turns, at most 20 names, count of them all', async () => {
    const { fake, anaFace, anaHeel, boFace } = world();
    fake.seed.announce(boFace, 'turn', { was: 'heel', class: 'face', at: at(5, 8) });
    fake.seed.announce(anaFace, 'debut', { class: 'face', at: at(5, 8) });
    fake.seed.announce(anaHeel, 'debut', { at: at(5, 8) });
    fake.seed.announce(anaHeel, 'turn', { at: at(6, 8) });
    const items = (await fake.seasonNews()).filter((n) => n.kind === 'tally');
    expect(items).toHaveLength(2);
    const [later, landing] = items;
    expect(later).toMatchObject({ count: 1, season: 1, debuts: [], turns: [{ character: anaHeel, name: 'Ana Heel', class: null, was: null }] });
    expect(landing).toMatchObject({ count: 3, season: 1, thread: expect.any(String), seq: 1, at: new Date(at(5, 8)).toISOString() });
    expect(landing!.debuts).toEqual([{ character: anaFace, name: 'Ana Face', class: 'face', was: null }, { character: anaHeel, name: 'Ana Heel', class: null, was: null }]);
    expect(landing!.turns).toEqual([{ character: boFace, name: 'Bo Face', class: 'face', was: 'heel' }]);
    const crowd = world();
    const who = crowd.fake.seed.account('crowd');
    for (let i = 0; i < 25; i++) crowd.fake.seed.announce(crowd.fake.seed.character(who, `D${String(i).padStart(2, '0')}`, 'face'), 'debut', { at: at(7, 8) });
    const [big] = (await crowd.fake.seasonNews()).filter((n) => n.kind === 'tally');
    expect(big).toMatchObject({ count: 25 });
    expect(big!.debuts).toHaveLength(20);
  });

  test('classReveals and turnsAnnounced read announce Acts beside the old: a class named is a reveal, a Turn is announced, with its old class where it said it', async () => {
    const { fake, anaFace, anaHeel, boFace } = world();
    const debut = fake.seed.announce(anaFace, 'debut', { class: 'face', at: at(5, 8) });
    const bare = fake.seed.announce(anaHeel, 'debut', { at: at(5, 8) });
    const turn = fake.seed.announce(boFace, 'turn', { was: 'heel', class: 'face', at: at(6, 8) });
    const quiet = fake.seed.announceTurn(boFace, (await fake.act(debut))!.thread, { at: at(7, 8) });
    const thread = (await fake.act(debut))!.thread;
    expect(await fake.classReveals([anaFace, anaHeel, boFace])).toEqual([
      { act: debut, character: anaFace, class: 'face', at: new Date(at(5, 8)).toISOString(), via: 'debut', thread },
      { act: turn, character: boFace, class: 'face', at: new Date(at(6, 8)).toISOString(), via: 'turn', thread },
    ]);
    // A debut naming no class is its character's announce in the same thread, and no reveal (absent above).
    expect(await fake.act(bare)).toMatchObject({ kind: 'announce', character: anaHeel, thread });
    expect(await fake.turnsAnnounced([anaFace, anaHeel, boFace])).toEqual([
      { act: turn, character: boFace, at: new Date(at(6, 8)).toISOString(), was: 'heel' },
      { act: quiet, character: boFace, at: new Date(at(7, 8)).toISOString(), was: null },
    ]);
  });

  test('standingsCount is the number of debuted characters, as the standings list them', async () => {
    const { fake, ana } = world();
    const before = (await fake.standingsPage(0, 1000)).length;
    fake.seed.character(ana, 'Not Yet', 'face', { debuted: false });
    expect(await fake.standingsCount()).toBe(before);
  });
});

describe('a page of the standings', () => {
  test('standingsPage pages the ranking as standings_page does: ties share a place across a page boundary, nothing settled stands at 0 unplaced, debts last and unplaced, empty past the end', async () => {
    const { fake, bo, anaFace, anaHeel, boFace } = world();
    const boHeel = fake.seed.character(bo, 'Bo Heel', 'heel');
    const boLurk = fake.seed.character(bo, 'Bo Lurk', 'lurker');
    fake.seed.settle({ standings: { [anaFace]: 300, [anaHeel]: 300, [boFace]: 500, [boHeel]: -40 }, debut: false });
    const row = (s: { name: string; standing: number; place: number | null }) => [s.name, s.standing, s.place];
    expect((await fake.standingsPage(0, 2)).map(row)).toEqual([['Bo Face', 500, 1], ['Ana Face', 300, 2]]);
    /* Places are dense (#453): the tie at 300 is place 2. A standing of 0 or below holds no place (#492): the masks below are listed by standing, unplaced. */
    expect((await fake.standingsPage(2, 2)).map(row)).toEqual([['Ana Heel', 300, 2], ['Bo Lurk', 0, null]]);
    expect((await fake.standingsPage(4, 2)).map(row)).toEqual([['Bo Heel', -40, null]]);
    expect(await fake.standingPlace(boLurk)).toMatchObject({ standing: 0, place: null });
    expect(await fake.standingPlace(boHeel)).toMatchObject({ standing: -40, place: null });
    expect(await fake.standingPlace(anaHeel)).toMatchObject({ standing: 300, place: 2 });
    expect((await fake.standingsPage(4, 2))[0]?.character).toBe(boHeel);
    expect((await fake.standingsPage(3, 1))[0]?.character).toBe(boLurk);
    expect(await fake.standingsPage(5, 2)).toEqual([]);
    expect(await fake.standingsPage(50, 2)).toEqual([]);
    expect(await fake.standingsPage(0, 0)).toEqual([]);
  });
});

describe('the season a screen names', () => {
  test('is the open season, else the one that started last, as the standings read it: never the highest number', async () => {
    const { fake } = world();
    const open = await fake.season();
    fake.seed.season({ number: 9, startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2020-02-01T00:00:00.000Z' });
    expect((await fake.season())?.number).toBe(open?.number);
    fake.seed.season({ number: open!.number, endsAt: new Date(Date.parse(open!.startsAt) + 86_400_000).toISOString() });
    expect((await fake.season())?.number).toBe(open?.number);
  });
});

describe('the player\'s own log: the ledger with its shares, the wallet\'s events and the cards', () => {
  /* One salty card at 1.00 that costs 0.50 more on a long post, as the Vending Machine's tests above price it. */
  const splat = {
    key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, stack: 2,
    playPrice: (_s: Settings, t: CardTarget) => (t.reach === 'post' && t.length > 20 ? 50 : 0),
    canApply: () => ({ ok: true as const, value: undefined }),
    validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
  };
  const shop: Instance = { ...instance, cards: [splat], machine: [{ item: { card: splat.key }, availability: 'onSale' as const, price: 100 }], settings: { ...settings, economy: {} } };
  const empty = { infractions: [], bans: [], falls: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet: [], cards: [], packs: [], playsOnMine: [], writes: [], draws: [], wallsDrawn: [], ballots: [], pollCloses: [], saves: [], setEnds: [], caught: [], ended: [], cosmetics: [], before: null };

  function logWorld() {
    const fake = createFake({ instance: shop });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const anaHeel = fake.seed.character(ana, 'Ana Heel', 'heel');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    const mine = fake.seed.post(thread, anaFace, 'Mine, and long enough to cost more.');
    fake.signInAs(ana);
    return { fake, ana, bo, anaFace, anaHeel, boFace, thread, opener, mine };
  }

  test('an account that has done nothing has an empty log, with nothing older', async () => {
    const { fake } = logWorld();
    expect(await fake.log()).toEqual(empty);
    fake.signInAs(null);
    expect(await fake.log()).toEqual(empty);
  });

  test('the staff moves of the account\'s own characters into groups are its log\'s group rows, with their end and the appeal\'s ruling, and no one else\'s', async () => {
    const { fake, anaFace, boFace } = logWorld();
    fake.seed.staff('boss', 'The Boss', 'boss');
    const m = fake.seed.groupMove('boss', { character: anaFace, group: 'trialMembers', board: 'general', expiresAt: fake.clock.now() + 3 * 86_400_000 });
    fake.seed.groupMove('boss', { character: boFace, group: 'trialMembers' });
    expect((await fake.log()).groupMoves).toMatchObject([{ move: m, character: anaFace, group: 'trialMembers', boardName: 'General', office: 'boss', endedWhy: null, ruling: null }]);
    const appeal = fake.seed.appeal(anaFace, m, 'I did nothing wrong.');
    const until = fake.clock.now() + 86_400_000;
    fake.seed.ruling(appeal, fake.seed.staff('boss2', 'The Second', 'boss'), 'reduced', { until });
    fake.seed.endMove(m, { why: 'expired' });
    const [row] = (await fake.log()).groupMoves;
    expect(row).toMatchObject({ ruling: 'reduced', endedWhy: 'expired', ruledUntil: new Date(until).toISOString(), expiresAt: new Date(until).toISOString() });
  });

  test('a settlement\'s lines read with their shares, its window, and the wallet\'s credit with what the cap held back', async () => {
    const { fake, ana, anaFace, anaHeel, mine, opener } = logWorld();
    fake.seed.wallet(ana, 580);
    const at = fake.clock.now();
    fake.seed.settle({
      at,
      ledger: [
        { character: anaFace, reason: 'face.cheered', amount: 30, shares: [{ act: mine, quadrant: 'excitedPositive', amount: 10 }, { act: opener, quadrant: 'excitedPositive', amount: 20 }] },
        { character: anaHeel, reason: 'heel.shrugged', amount: -5 },
      ],
    });
    const log = await fake.log();
    expect(log.settlements).toEqual([{
      id: 1, startsAt: new Date(at - DAY).toISOString(), endsAt: new Date(at).toISOString(), sharesKept: true,
      lines: [
        { character: anaFace, reason: 'face.cheered', amount: 30, shares: [{ act: opener, quadrant: 'excitedPositive', amount: 20 }, { act: mine, quadrant: 'excitedPositive', amount: 10 }] },
        { character: anaHeel, reason: 'heel.shrugged', amount: -5, shares: [] },
      ],
    }]);
    /* 580 + 25 is past the cap of 600: the wallet holds 600, and the event says 5 was held back. */
    /* Dated as the job applies it, a moment after the window it settles ends (wallet_move's now()). */
    expect(log.wallet).toEqual([{ settlement: 1, kind: 'settlement', change: 20, overflow: 5, floored: 0, balanceAfter: 600, ref: null, at: new Date(at + 1000).toISOString() }]);
    expect((await fake.wallet()).balance).toBe(600);
    expect(await fake.standingAmounts([anaFace, anaHeel])).toEqual({ [anaFace]: 30, [anaHeel]: -5 });
  });

  test('a debit the floor holds back says so, and a second settlement\'s window starts where the first ended', async () => {
    const { fake, ana, anaHeel } = logWorld();
    fake.seed.wallet(ana, 3);
    const first = fake.clock.now();
    fake.seed.settle({ at: first, ledger: [{ character: anaHeel, reason: 'heel.shrugged', amount: -5 }] });
    fake.clock.advance(DAY);
    fake.seed.settle({ at: first + DAY, ledger: [{ character: anaHeel, reason: 'heel.drewHeat', amount: 4 }] });
    const log = await fake.log();
    expect(log.settlements.map((s) => [s.id, s.startsAt, s.endsAt])).toEqual([[2, new Date(first).toISOString(), new Date(first + DAY).toISOString()], [1, new Date(first - DAY).toISOString(), new Date(first).toISOString()]]);
    expect(log.wallet.map((e) => [e.settlement, e.change, e.floored, e.balanceAfter])).toEqual([[2, 4, 0, 4], [1, -3, 2, 0]]);
  });

  test('two card lines of one character and reason each read their own shares', async () => {
    const { fake, anaFace, mine, opener } = logWorld();
    fake.seed.settle({
      at: fake.clock.now(),
      ledger: [
        { character: anaFace, reason: 'card.ride', amount: 10, params: { card: 'y' }, shares: [{ act: mine, quadrant: 'excitedPositive', amount: 10 }] },
        { character: anaFace, reason: 'card.ride', amount: 4, params: { card: 'x' }, shares: [{ act: mine, quadrant: 'excitedPositive', amount: 4 }] },
        { character: anaFace, reason: 'face.cheered', amount: 2, shares: [{ act: opener, quadrant: 'excitedPositive', amount: 2 }] },
      ],
    });
    const lines = (await fake.log()).settlements[0]!.lines;
    expect(lines.map((l) => [l.reason, l.params?.['card'] ?? null, l.shares.map((s) => s.amount)])).toEqual([['card.ride', 'x', [4]], ['card.ride', 'y', [10]], ['face.cheered', null, [2]]]);
  });

  test('a settlement made before the shares were kept says so and carries none; seeding it shares is a mistake', async () => {
    const { fake, anaFace, mine } = logWorld();
    fake.seed.settle({ sharesKept: false, ledger: [{ character: anaFace, reason: 'face.cheered', amount: 10 }] });
    expect((await fake.log()).settlements.map((s) => [s.sharesKept, s.lines[0]!.shares])).toEqual([[false, []]]);
    expect(() => fake.seed.settle({ at: fake.clock.now() + DAY, sharesKept: false, ledger: [{ character: anaFace, reason: 'face.cheered', amount: 10, shares: [{ act: mine, amount: 10 }] }] })).toThrow(/before its shares were kept/);
  });

  test('a line\'s shares add up to it, as apply_settlement refuses them otherwise', () => {
    const { fake, anaFace, mine } = logWorld();
    expect(() => fake.seed.settle({ ledger: [{ character: anaFace, reason: 'face.cheered', amount: 10, shares: [{ act: mine, amount: 7 }] }] })).toThrow('an entry\'s shares add up to it');
  });

  test('a purchase and a play read in the card ledger, and each spend in the wallet\'s events; a play that costs nothing has no wallet event', async () => {
    const { fake, ana, anaFace, opener, mine } = logWorld();
    fake.seed.wallet(ana, 500);
    const bought = fake.clock.now();
    must(await fake.buyCard(await slotOf(fake, 'splat')));
    fake.clock.advance(MINUTE);
    const long = must(await fake.playCard('splat', anaFace, mine, {}, 'Long one.'));
    fake.clock.advance(MINUTE);
    must(await fake.buyCard(await slotOf(fake, 'splat')));
    fake.clock.advance(MINUTE);
    const short = must(await fake.playCard('splat', anaFace, opener, {}, ''));
    const log = await fake.log();
    const t = (n: number) => new Date(bought + n * MINUTE).toISOString();
    expect(log.cards).toEqual([
      { card: 'splat', kind: 'played', act: short.id, price: 0, at: t(3) },
      { card: 'splat', kind: 'bought', act: null, price: 100, at: t(2) },
      { card: 'splat', kind: 'played', act: long.id, price: 50, at: t(1) },
      { card: 'splat', kind: 'bought', act: null, price: 100, at: t(0) },
    ]);
    expect(log.wallet).toEqual([
      { settlement: null, kind: 'purchase', change: -100, overflow: 0, floored: 0, balanceAfter: 250, ref: null, at: t(2) },
      { settlement: null, kind: 'play', change: -50, overflow: 0, floored: 0, balanceAfter: 350, ref: long.id, at: t(1) },
      { settlement: null, kind: 'purchase', change: -100, overflow: 0, floored: 0, balanceAfter: 400, ref: null, at: t(0) },
    ]);
  });

  test('the seed buys and pays for a play as the server would, dated when it says', async () => {
    const { fake, ana, anaFace, mine } = logWorld();
    fake.seed.wallet(ana, 500);
    const at = fake.clock.now() - 10 * MINUTE;
    fake.seed.buy(ana, 'splat', { at });
    const play = fake.seed.card(anaFace, mine, 'splat', { at: at + MINUTE, paid: 50 });
    const log = await fake.log();
    expect(log.cards.map((c) => [c.kind, c.act, c.price, c.at])).toEqual([['played', play, 50, new Date(at + MINUTE).toISOString()], ['bought', null, 100, new Date(at).toISOString()]]);
    expect(log.wallet.map((e) => [e.kind, e.change, e.balanceAfter, e.ref])).toEqual([['play', -50, 350, play], ['purchase', -100, 400, null]]);
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 1 }]);
  });

  test('another player\'s play on the player\'s post reads, with the author\'s saves of its effect; a play through the player\'s own character does not', async () => {
    const { fake, ana, bo, anaFace, anaHeel, boFace, mine } = logWorld();
    const theirs = fake.seed.card(boFace, mine, 'splat', { message: 'Hi.' });
    const at = new Date(fake.clock.now()).toISOString();
    fake.seed.card(anaHeel, mine, 'splat');
    fake.signInAs(bo);
    expect((await fake.log()).playsOnMine).toEqual([]);
    fake.signInAs(ana);
    expect((await fake.log()).playsOnMine).toEqual([{ play: theirs, post: mine, at, reach: 'post', targetName: null, targetCharacter: expect.any(String) }]);
    expect((await fake.log()).saves).toEqual([]);
    fake.clock.advance(MINUTE);
    must(await fake.saveEffect(theirs, anaFace, { clean: true }));
    expect((await fake.log()).saves).toEqual([{ play: theirs, post: mine, savedAt: new Date(fake.clock.now()).toISOString() }]);
  });

  test('pages a log longer than a page from each cursor, with every row once and nothing lost, to its start', async () => {
    const { fake, ana } = logWorld();
    fake.seed.wallet(ana, 600);
    const start = fake.clock.now() - 500 * MINUTE;
    /* Two purchases at each of 250 minutes, the last pair at one instant with the page's edge between them. */
    for (let i = 0; i < 250; i++) {
      fake.seed.wallet(ana, 600);
      fake.seed.buy(ana, 'splat', { at: start + i * MINUTE });
      fake.seed.buy(ana, 'splat', { at: start + i * MINUTE });
    }
    const seen: string[] = [];
    let before: string | null = null;
    let pages = 0;
    do {
      const page = await fake.log(before);
      seen.push(...page.cards.map((c) => c.at));
      before = page.before;
      pages++;
    } while (before !== null && pages < 10);
    expect(pages).toBeGreaterThan(2);
    expect(before).toBeNull();
    expect(seen.length).toBe(500);
    expect(seen).toEqual([...seen].sort().reverse());
    expect(new Set(seen).size).toBe(250);
  });

  /* #89 F4, in the fake's own reads: more than a page of rows at one instant is read whole there, and the cursor moves past it. */
  test('pages past an instant that holds more than a page, every row once, the cursors only moving back', async () => {
    const { fake, ana } = logWorld();
    const at = fake.clock.now() - 10 * MINUTE;
    for (let i = 0; i < 3; i++) {
      fake.seed.wallet(ana, 600);
      fake.seed.buy(ana, 'splat', { at: at - (i + 1) * MINUTE });
    }
    for (let i = 0; i < LOG_ROWS + 1; i++) {
      fake.seed.wallet(ana, 600);
      fake.seed.buy(ana, 'splat', { at });
    }
    const seen: string[] = [];
    const cursors: string[] = [];
    let before: string | null = null;
    let pages = 0;
    do {
      const page = await fake.log(before);
      seen.push(...page.cards.map((c) => c.at));
      if (page.before !== null && before !== null) expect(micros(page.before)).toBeLessThan(micros(before));
      before = page.before;
      if (before !== null) cursors.push(before);
      pages++;
    } while (before !== null && pages < 10);
    expect(before).toBeNull();
    expect(seen.length).toBe(LOG_ROWS + 4);
    expect(seen.filter((t) => t === new Date(at).toISOString())).toHaveLength(LOG_ROWS + 1);
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  test('one player\'s log holds nothing of another\'s', async () => {
    const { fake, ana, bo, anaFace, boFace } = logWorld();
    fake.seed.wallet(bo, 500);
    fake.seed.settle({ ledger: [{ character: boFace, reason: 'face.cheered', amount: 10 }, { character: anaFace, reason: 'face.cheered', amount: 20 }] });
    fake.signInAs(bo);
    must(await fake.buyCard(await slotOf(fake, 'splat')));
    const bos = await fake.log();
    expect(bos.settlements.flatMap((s) => s.lines.map((l) => l.character))).toEqual([boFace]);
    fake.signInAs(ana);
    const anas = await fake.log();
    expect(anas.settlements.flatMap((s) => s.lines.map((l) => l.character))).toEqual([anaFace]);
    expect(anas.cards).toEqual([]);
    expect(anas.wallet.map((e) => e.kind)).toEqual(['settlement']);
    void ana;
  });
});

describe('moves, a staff member and the admin queue', () => {
  const world = () => {
    const fake = createFake({ instance });
    const player = fake.seed.account('player');
    const admin = fake.seed.account('boss', { admin: true });
    fake.seed.character(player, 'Pat', 'face');
    const director = fake.seed.staff('director', 'The Director', 'boss', { title: 'Head' });
    const general = 'general';
    const move = fake.seed.move('director', { board: general, name: 'Toast Palace', demand: { kind: 'distinctCharactersOnBoard', params: { board: general, count: 2 } } });
    fake.seed.tally(move, { fire: 4, tea: 1, zzz: 2, tomato: 3 });
    const queued = fake.seed.queueMove('director', { board: general, name: 'Cheese Hall', goLiveAt: Date.UTC(2026, 9, 30) });
    return { fake, player, admin, director, move, queued };
  };

  test('a board is called what the move in force calls it, and is called its own name again the moment the move ends', async () => {
    const { fake, move } = world();
    expect((await fake.board('general'))?.name).toBe('Toast Palace');
    expect((await fake.board('general'))?.moveAct).toBe(move);
    expect((await fake.boardNames()).find((b) => b.slug === 'general')).toMatchObject({ name: 'Toast Palace', was: 'General' });
    fake.seed.endMove(move, { why: 'expired' });
    expect((await fake.board('general'))).toMatchObject({ name: 'General', moveAct: null });
  });

  test('a move\'s notice has its top three reactions and the demand\'s progress, counting characters and never a staff member', async () => {
    const { fake, move } = world();
    const notice = await fake.moveNotice(move);
    expect(notice?.reactions).toEqual([{ kind: 'fire', count: 4 }, { kind: 'tomato', count: 3 }, { kind: 'zzz', count: 2 }]);
    expect(notice?.progress).toEqual({ done: 0, of: 2, met: false, checkedAt: new Date(fake.clock.now()).toISOString() });
    expect(await fake.moveNotice('no-such-act')).toBeNull();
  });

  test('a move the tick has not counted has no count and no time, in its notice and in the queue', async () => {
    const { fake, admin } = world();
    const general = 'general';
    const fresh = fake.seed.move('director', { board: general, name: 'Uncounted Hall', demand: { kind: 'postsOnBoard', params: { board: general, count: 3 } }, uncounted: true });
    expect((await fake.moveNotice(fresh))?.progress).toEqual({ done: 0, of: 0, met: false, checkedAt: null });
    fake.signInAs(admin);
    expect((await fake.adminQueue()).inForce.find((m) => m.act === fresh)?.progress).toEqual({ done: 0, of: 0, met: false, checkedAt: null });
  });

  test('the Director is a staff character in the public projection, and a player\'s character is not', async () => {
    const { fake, director } = world();
    const [boss] = await fake.characters([director]);
    expect([boss?.staff, boss?.office]).toEqual(['director', 'boss']);
    fake.signInAs(null);
    expect((await fake.characters([director]))[0]?.staff).toBe('director');
  });

  test('only an admin reads the queue, holds a move or reverses one, in the server\'s words; a hold is once', async () => {
    const { fake, player, admin, move, queued } = world();
    fake.signInAs(player);
    await expect(fake.adminQueue()).rejects.toThrow('only an admin reads the queue');
    expect(await fake.holdMove(queued)).toEqual({ ok: false, error: 'only an admin holds a move' });
    expect(await fake.reverseMove(move)).toEqual({ ok: false, error: 'only an admin reverses a move' });
    fake.signInAs(admin);
    expect((await fake.adminQueue()).waiting.map((q) => q.id)).toEqual([queued]);
    expect(await fake.holdMove(queued)).toMatchObject({ ok: true });
    expect(await fake.holdMove(queued)).toEqual({ ok: false, error: 'that move is already held' });
    expect((await fake.adminQueue()).waiting).toEqual([]);
    expect((await fake.adminQueue()).ended.map((e) => e.how)).toEqual(['held']);
    expect(await fake.reverseMove(move)).toMatchObject({ ok: true });
    expect(await fake.reverseMove(move)).toEqual({ ok: false, error: 'that move has already ended' });
    expect((await fake.board('general'))?.name).toBe('General');
  });

  test('a waiting request in a staff member\'s log lapses staffRequests.daysMost days after it was conferred, not a fixed three', async () => {
    const at = Date.UTC(2026, 8, 1);
    for (const daysMost of [3, 5]) {
      const fake = createFake({ instance: { ...instance, settings: { ...instance.settings, staffRequests: { daysMost, meetingMost: 10 } } } });
      const asker = fake.seed.character(fake.seed.account('asker'), 'Asker', 'face');
      const { act: post } = fake.seed.thread('general', asker, 'Hello', 'Please');
      fake.seed.staff('hall-monitor', 'Hall Monitor', 'mod');
      fake.seed.staffRequest('hall-monitor', post, { ruling: 'confer', at });
      const row = (await fake.movesLog('hall-monitor')).rows.find((r) => r.kind === 'request');
      expect(row?.params['lapses_at']).toBe(new Date(at + daysMost * 86_400_000).toISOString());
    }
  });

  test('a staff member\'s moves are paged newest first by the keyset of the last row', async () => {
    const { fake } = world();
    for (let i = 0; i < 24; i++) fake.seed.move('director', { board: 'general', name: `N${i}`, at: Date.UTC(2026, 8, 1) + i * 60_000 });
    const first = await fake.movesLog('director');
    expect(first.rows).toHaveLength(20);
    expect(first.older).not.toBeNull();
    const second = await fake.movesLog('director', first.older);
    expect(second.rows).toHaveLength(5);
    expect(second.older).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map((r) => r.act)).size).toBe(25);
  });
});

describe('presence', () => {
  const ids = (p: { names: readonly { id: string }[] }) => p.names.map((n) => n.id);
  test('a swap of masks leaves the old one listed until the window passes', async () => {
    const { fake, bo, anaFace, anaHeel, boFace, thread } = world();
    expect(ids(await fake.here({ kind: 'thread', thread }, anaFace))).toEqual([anaFace]);
    fake.clock.advance(MINUTE);
    await fake.here({ kind: 'thread', thread }, anaHeel);
    fake.signInAs(bo);
    expect(ids(await fake.here({ kind: 'thread', thread }, boFace))).toEqual([anaFace, anaHeel, boFace]);
    fake.clock.advance(4 * MINUTE + 1);
    expect(ids(await fake.here({ kind: 'thread', thread }, boFace))).toEqual([anaHeel, boFace]);
  });
  test('a board counts its threads, the index counts everyone, and the answer is names and a count only', async () => {
    const { fake, anaFace, thread } = world();
    await fake.here({ kind: 'thread', thread }, anaFace);
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    const system = (await fake.boards()).find((b) => b.slug === 'announcements')!;
    expect(ids(await fake.here({ kind: 'board', board: general.id }, null))).toEqual([anaFace]);
    expect(ids(await fake.here({ kind: 'board', board: system.id }, null))).toEqual([]);
    const online = await fake.here({ kind: 'index' }, null);
    expect(online).toEqual({ names: [{ id: anaFace, name: 'Ana Face', staff: false, group: 'members' }], others: 0 });
  });
  test('a hidden mask is written nowhere and omitted for another account; my characters say it is hidden', async () => {
    const { fake, bo, anaFace, boFace, thread } = world();
    await fake.here({ kind: 'thread', thread }, anaFace);
    expect(await fake.setPresenceHidden(anaFace, true)).toEqual({ ok: true, value: true });
    expect((await fake.myCharacters()).find((c) => c.id === anaFace)?.presenceHidden).toBe(true);
    await fake.here({ kind: 'thread', thread }, anaFace);
    fake.signInAs(bo);
    expect(ids(await fake.here({ kind: 'thread', thread }, boFace))).toEqual([boFace]);
    expect(await fake.setPresenceHidden(anaFace, false)).toEqual(refused('you do not play that character'));
  });
  test('past the cap, the rest are counted', async () => {
    const { fake, bo, anaFace, anaHeel, boFace, thread } = world({ presenceNames: 2 });
    await fake.here({ kind: 'thread', thread }, anaFace);
    fake.clock.advance(1000);
    await fake.here({ kind: 'thread', thread }, anaHeel);
    fake.clock.advance(1000);
    fake.signInAs(bo);
    const box = await fake.here({ kind: 'thread', thread }, boFace);
    expect(ids(box)).toEqual([anaFace, anaHeel]);
    expect(box.others).toBe(1);
  });
  test('the index is longest online first; a thread, longest there first', async () => {
    const { fake, ana, bo, anaFace, boFace, thread } = world();
    const other = fake.seed.thread('general', boFace, 'Other', 'x').thread;
    await fake.here({ kind: 'thread', thread: other }, anaFace);
    fake.clock.advance(1000);
    fake.signInAs(bo);
    await fake.here({ kind: 'thread', thread }, boFace);
    fake.clock.advance(1000);
    fake.signInAs(ana);
    expect(ids(await fake.here({ kind: 'thread', thread }, anaFace))).toEqual([boFace, anaFace]);
    expect(ids(await fake.here({ kind: 'index' }, null))).toEqual([anaFace, boFace]);
  });
  test('a mask polled exactly the window ago is still listed, and gone a moment later', async () => {
    const { fake, anaFace, thread } = world();
    await fake.here({ kind: 'thread', thread }, anaFace);
    fake.clock.advance(5 * MINUTE);
    expect(ids(await fake.here({ kind: 'thread', thread }, null))).toEqual([anaFace]);
    fake.clock.advance(1);
    expect(ids(await fake.here({ kind: 'thread', thread }, null))).toEqual([]);
  });
  test('a retired mask\'s poll writes nothing and answers; a waiting mask\'s is refused; a mask shown again is listed from its next poll', async () => {
    const { fake, ana, anaFace, anaHeel, thread } = world();
    const waiting = fake.seed.character(ana, 'Ana Later', 'face', { debuted: false });
    const retired = fake.seed.character(ana, 'Ana Gone', 'face', { retired: true });
    expect(await fake.here({ kind: 'thread', thread }, retired)).toEqual({ names: [], others: 0 });
    await expect(fake.here({ kind: 'thread', thread }, waiting)).rejects.toThrow('that character debuts at the next settlement');
    await fake.here({ kind: 'thread', thread }, anaHeel);
    await fake.setPresenceHidden(anaFace, true);
    await fake.setPresenceHidden(anaFace, false);
    expect(ids(await fake.here({ kind: 'thread', thread }, null))).toEqual([anaHeel]);
    fake.clock.advance(1000);
    expect(ids(await fake.here({ kind: 'thread', thread }, anaFace))).toEqual([anaHeel, anaFace]);
  });
  test('a poll through a mask not yours, or of no thread, is refused', async () => {
    const { fake, boFace, thread } = world();
    await expect(fake.here({ kind: 'thread', thread }, boFace)).rejects.toThrow('you do not play that character');
    await expect(fake.here({ kind: 'thread', thread: 'nowhere' }, null)).rejects.toThrow('there is no such thread');
  });
});

describe('a card set face down, a ward and a trap, as the server holds them', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
  const cast = { ...base, key: 'blot', name: 'Blot', alignment: 'salty' as const, rarity: 'common' as const, canApply: () => ok(undefined) };
  const snare = { ...base, key: 'snare', name: 'Snare', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'blot', canApply: () => ok(undefined) };
  const shield = { ...base, key: 'shield', name: 'Shield', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'ward' as const, upTo: 'uncommon' as const }, lasts: { unit: 'day' as const, count: 7 }, canApply: () => ok(undefined) };
  const world: Instance = { ...instance, cards: [cast, snare, shield], machine: [{ item: { card: cast.key }, availability: 'onSale' as const, price: 100 }, { item: { card: snare.key }, availability: 'onSale' as const, price: 100 }, { item: { card: shield.key }, availability: 'onSale' as const, price: 100 }], settings: { ...settings, economy: {} } };
  function setup() {
    const fake = createFake({ instance: world });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    const bos = fake.seed.post(thread, boFace, 'Bo here.');
    fake.seed.cards(ana, { snare: 1, shield: 1 });
    fake.seed.cards(bo, { blot: 2, snare: 1 });
    fake.signInAs(ana);
    return { fake, ana, bo, anaFace, boFace, opener, bos };
  }

  test('a Set goes on the setter\'s own post, as a back that names no card, read by the setter alone', async () => {
    const { fake, ana, bo, anaFace, opener, bos } = setup();
    expect((await fake.setCard('snare', anaFace, bos, {})).ok).toBe(false);
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    expect([set.kind, set.payload]).toEqual(['set', {}]);
    expect((await fake.postPlays([opener])).plays.map((a) => [a.kind, a.payload])).toEqual([['set', {}]]);
    expect(await fake.myFaceDown([set.id])).toEqual({ [set.id]: 'snare' });
    fake.signInAs(bo);
    expect(await fake.myFaceDown([set.id])).toEqual({});
    void ana;
  });

  test('a Move is set face down like a set card, and a Use is refused, in the card\'s words', async () => {
    const { fake, ana, anaFace, opener } = setup();
    fake.seed.cards(ana, { blot: 1 });
    const set = must(await fake.setCard('blot', anaFace, opener, {}));
    expect([set.kind, set.payload]).toEqual(['set', {}]);
    expect(await fake.myFaceDown([set.id])).toEqual({ [set.id]: 'blot' });
    const refused = await fake.setCard('shield', anaFace, opener, {});
    expect(refused).toMatchObject({ ok: false, error: 'Shield is used on your own post' });
  });

  test('a catching set card naming a card that is not cast on a post is refused in decideSet\'s words', async () => {
    const trapper = { ...base, key: 'trapper', name: 'Trapper', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'shield', canApply: () => ok(undefined) };
    const fake = createFake({ instance: { ...world, cards: [...world.cards, trapper] } });
    const ana = fake.seed.account('ana');
    const face = fake.seed.character(ana, 'Ana Face', 'face');
    const { act } = fake.seed.thread('general', face, 'Hello', 'First post');
    fake.seed.cards(ana, { trapper: 1 });
    fake.signInAs(ana);
    expect(await fake.setCard('trapper', face, act, {})).toMatchObject({ ok: false, error: 'Trapper names a card that is cast on a post' });
  });

  test('a trap catches the next cast, which is spent, and the spring reveals it', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('blot', boFace, opener, {}, ''));
    expect(caught.payload.caught).toBe(set.id);
    const on = (await fake.postPlays([opener])).plays;
    expect(on.find((a) => a.kind === 'spring')?.payload).toMatchObject({ card: 'snare', trigger: 'cast', did: 'caught', set: set.id, caught: caught.id });
    expect(on.find((a) => a.kind === 'spring')?.payload).not.toHaveProperty('outcome');
    expect((await fake.myCards()).find((c) => c.card === 'blot')?.held).toBe(1);
    expect(must(await fake.playCard('blot', boFace, opener, {}, '')).payload.caught).toBeUndefined();
  });

  test('a catching set card\'s catch is the setter\'s: a card in the hand, a ledger row and no payout', async () => {
    const { fake, ana, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('blot', boFace, opener, {}, ''));
    const spring = (await fake.postPlays([opener])).plays.find((a) => a.kind === 'spring')!;
    fake.signInAs(ana);
    expect((await fake.myCards()).find((c) => c.card === 'blot')?.held).toBe(1);
    expect((await fake.log()).cards.find((e) => e.kind === 'caught')).toMatchObject({ card: 'blot', kind: 'caught', act: spring.id, price: 0 });
    expect(caught.payload.caught).toBe(set.id);
  });

  test('a caught play\'s moment holds the back and the spring, written before it as the server writes them; the spring\'s holds the back', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('blot', boFace, opener, {}, ''));
    const spring = (await fake.postPlays([opener])).plays.find((a) => a.kind === 'spring')!;
    expect((await fake.playMoment(caught.id))!.layers.map((l) => l.act.id).sort()).toEqual([caught.id, set.id, spring.id].sort());
    expect((await fake.playMoment(spring.id))!.layers.map((l) => l.act.id).sort()).toEqual([spring.id, set.id].sort());
  });

  test('a ward on the user\'s own post turns a cast away in its words', async () => {
    const { fake, bo, anaFace, boFace, opener, bos } = setup();
    expect((await fake.useCard('shield', anaFace, bos, {}, '')).ok).toBe(false);
    const used = must(await fake.useCard('shield', anaFace, opener, {}, ''));
    expect(typeof used.payload.ends).toBe('string');
    fake.signInAs(bo);
    expect(await fake.playCard('blot', boFace, opener, {}, '')).toEqual(refused('this post\'s Shield turns away cards up to uncommon', 'config'));
  });

  /* Task 3 and 4 of the card types plan, as the fake mirrors them. */
  const sugar = { ...base, key: 'sugar', name: 'Sugar', alignment: 'sweet' as const, rarity: 'common' as const, canApply: () => ok(undefined) };
  const warding = { ...base, key: 'saltward', name: 'Salt Ward', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'ward' as const, flavors: ['salty' as const] }, lasts: { unit: 'day' as const, count: 7 }, canApply: () => ok(undefined) };
  const named = { ...warding, key: 'namedward', name: 'Name Ward', gimmick: { kind: 'ward' as const, cards: ['sugar'] } };
  const vibes = { ...base, key: 'vibes', name: 'Vibes', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, reaches: ['thread' as const, 'board' as const], gimmick: { kind: 'price' as const, flavors: ['salty' as const], add: 25 }, lasts: { unit: 'day' as const, count: 3 }, canApply: () => ok(undefined) };
  const net = { ...base, key: 'net', name: 'Net', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const] } }, canApply: () => ok(undefined) };
  const cushion = { ...base, key: 'cushion', name: 'Cushion', alignment: 'pepperoni' as const, rarity: 'common' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { upTo: 'common' as const }, outcome: { kind: 'ride' as const, share: 0.25, every: true as const } }, canApply: () => ok(undefined) };
  function setup2() {
    const fake = createFake({ instance: { ...world, cards: [...world.cards, sugar, warding, named, vibes, net, cushion] } });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    fake.seed.cards(ana, { snare: 2, saltward: 1, namedward: 1, vibes: 1, net: 1, cushion: 1 });
    fake.seed.cards(bo, { blot: 3, sugar: 3, vibes: 1 });
    fake.signInAs(ana);
    return { fake, ana, bo, anaFace, boFace, thread, opener };
  }

  test('a ward by flavor or by name turns away what it names, in its words, and passes the rest', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup2();
    must(await fake.useCard('saltward', anaFace, opener, {}, ''));
    fake.signInAs(bo);
    expect(await fake.playCard('blot', boFace, opener, {}, '')).toEqual(refused('this post\'s Salt Ward turns away Salty cards', 'config'));
    expect(must(await fake.playCard('sugar', boFace, opener, {}, '')).kind).toBe('card');
    const second = setup2();
    must(await second.fake.useCard('namedward', second.anaFace, second.opener, {}, ''));
    second.fake.signInAs(second.bo);
    expect(await second.fake.playCard('sugar', second.boFace, second.opener, {}, '')).toEqual(refused('this post\'s Name Ward turns away Sugar', 'config'));
    expect(must(await second.fake.playCard('blot', second.boFace, second.opener, {}, '')).kind).toBe('card');
  });

  test('a use card is used on a thread the acting character started, and on no board', async () => {
    const { fake, bo, anaFace, boFace, thread } = setup2();
    const used = must(await fake.useCard('vibes', anaFace, thread, {}, '', 'thread'));
    expect(used.payload.reach).toBe('thread');
    fake.signInAs(bo);
    expect(await fake.useCard('vibes', boFace, thread, {}, '', 'thread')).toEqual(refused('Vibes is used on a thread your own character started'));
    const board = (await fake.boards())[0]!.id;
    expect(await fake.useCard('vibes', boFace, board, {}, '', 'board')).toMatchObject({ ok: false, error: 'Vibes is never used on a board' });
  });

  test('a take-back returns the card and ends the back; a second one, and another account\'s, are refused in one set of words', async () => {
    const { fake, ana, bo, anaFace, boFace, opener } = setup2();
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    expect((await fake.myCards()).find((c) => c.card === 'snare')?.held).toBe(1);
    const nothing = refused('there is no face-down card to take back there');
    fake.signInAs(bo);
    expect(await fake.takeBack(boFace, set.id)).toEqual(nothing);
    expect(await fake.takeBack(boFace, '00000000-0000-4000-8000-00000000ffff')).toEqual(nothing);
    fake.signInAs(ana);
    const mask = fake.seed.character(ana, 'Ana Heel', 'heel');
    expect(await fake.takeBack(mask, set.id)).toEqual(nothing);
    const back = must(await fake.takeBack(anaFace, set.id));
    expect([back.kind, back.targetActId, back.payload]).toEqual(['take_back', opener, { set: set.id }]);
    expect((await fake.myCards()).find((c) => c.card === 'snare')?.held).toBe(2);
    expect((await fake.log()).cards.find((e) => e.kind === 'returned')).toMatchObject({ card: 'snare', kind: 'returned', act: back.id, price: 0 });
    expect(await fake.takeBack(anaFace, set.id)).toEqual(nothing);
    fake.signInAs(bo);
    expect(must(await fake.playCard('blot', boFace, opener, {}, '')).payload.caught).toBeUndefined();
    expect((await fake.postPlays([opener])).plays.some((a) => a.kind === 'spring')).toBe(false);
  });

  /* Cheap Shot (the pierce plan's Task 3): the fake mirrors place_cast's read of the caster's pierce. */
  const lift = { ...base, key: 'lift', name: 'Lift', alignment: 'salty' as const, rarity: 'rare' as const, play: 'use' as const, reaches: ['character' as const], gimmick: { kind: 'pierce' as const, upTo: 'uncommon' as const }, lasts: { unit: 'day' as const, count: 7 }, canApply: () => ok(undefined) };
  const rareShield = { ...shield, key: 'rareshield', name: 'Rare Shield', rarity: 'rare' as const };
  const csnare = { ...snare, key: 'csnare', name: 'Common Snare', rarity: 'common' as const };
  const rsnare = { ...snare, key: 'rsnare', name: 'Rare Snare', rarity: 'rare' as const };
  const spark = { ...base, key: 'spark', name: 'Spark', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'cast' as const, reaches: ['character' as const, 'thread' as const, 'board' as const], lasts: { unit: 'day' as const, count: 1 }, canApply: () => ok(undefined) };
  const reachWard = (key: string, reach: 'character' | 'thread') => ({ ...shield, key, name: key, reaches: [reach] });
  const lift2 = { ...lift, key: 'lift2', name: 'Lift Two' };
  /* One whose own rules refuse a second while one is up (landsOn), so what reachEffects hands them is seen. */
  const lift3 = { ...lift, key: 'lift3', name: 'Lift Three', canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'lift3', reaches: ['character'] }, t, e, now) };
  function pierceSetup() {
    const fake = createFake({ instance: { ...world, cards: [...world.cards, sugar, lift, lift2, lift3, spark, reachWard('cward', 'character'), reachWard('tward', 'thread'), reachWard('bward', 'thread'), rareShield, csnare, rsnare, cushion] } });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: mine } = fake.seed.thread('general', anaFace, 'Mine', 'Ana here.');
    const bos = fake.seed.post(thread, boFace, 'Bo here.');
    fake.seed.cards(ana, { lift: 3, lift2: 2, lift3: 2, blot: 3, shield: 1, spark: 4 });
    fake.seed.cards(bo, { cward: 1, tward: 1, shield: 1, rareshield: 1, csnare: 1, rsnare: 1, cushion: 1, blot: 1 });
    fake.signInAs(ana);
    const lifted = async () => must(await fake.useCard('lift', anaFace, anaFace, {}, '', 'character', mine));
    return { fake, ana, bo, anaFace, boFace, thread, mine, bos, lifted };
  }
  const trapStruck = async (fake: ReturnType<typeof createFake>) => (await fake.alerts()).filter((a) => a.kind === 'trapStruck');

  test('a pierce gets the next cast past a ward no rarer than it, names the play, the card and the ward, and is spent', async () => {
    const { fake, ana, bo, anaFace, boFace, bos, lifted } = pierceSetup();
    const pierce = await lifted();
    fake.signInAs(bo);
    must(await fake.useCard('shield', boFace, bos, {}, ''));
    fake.signInAs(ana);
    const landed = must(await fake.playCard('blot', anaFace, bos, {}, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(landed.payload.pierce).toEqual({ by: pierce.id, card: 'lift', ward: 'shield' });
    // Spent: a second cast carries no pierce, and the ward turns it away.
    expect(await fake.playCard('blot', anaFace, bos, {}, '')).toEqual(refused('this post\'s Shield turns away cards up to uncommon', 'config'));
  });

  test('a rare ward turns a pierced cast away in its words and spends nothing', async () => {
    const { fake, ana, bo, anaFace, boFace, bos, lifted } = pierceSetup();
    await lifted();
    fake.signInAs(bo);
    must(await fake.useCard('rareshield', boFace, bos, {}, ''));
    fake.signInAs(ana);
    expect(await fake.playCard('blot', anaFace, bos, {}, '')).toEqual(refused('this post\'s Rare Shield turns away cards up to uncommon', 'config'));
    // Still live: it is up when the ward is gone, so a cast with no ward on a post carries it.
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toMatchObject({ card: 'lift' });
  });

  test('a pierce passes a common catching back: it lands, nothing springs, the back stays set and the caster alone is told', async () => {
    const { fake, ana, bo, anaFace, boFace, bos, lifted } = pierceSetup();
    const pierce = await lifted();
    fake.signInAs(bo);
    const set = must(await fake.setCard('csnare', boFace, bos, {}));
    fake.signInAs(ana);
    const landed = must(await fake.playCard('blot', anaFace, bos, {}, ''));
    expect(landed.payload.caught).toBeUndefined();
    expect(landed.payload.pierce).toEqual({ by: pierce.id, card: 'lift' });
    expect((await fake.postPlays([bos])).plays.some((a) => a.kind === 'spring')).toBe(false);
    expect(await trapStruck(fake)).toMatchObject([{ kind: 'trapStruck', sub: 'passed', act: landed.id }]);
    fake.signInAs(bo);
    expect(await fake.myFaceDown([set.id])).toEqual({ [set.id]: 'csnare' });
    expect(await trapStruck(fake)).toEqual([]);
  });

  test('a rare catching back still catches a pierced cast, and the pierce is spent', async () => {
    const { fake, ana, bo, anaFace, boFace, bos, lifted } = pierceSetup();
    const pierce = await lifted();
    fake.signInAs(bo);
    must(await fake.setCard('rsnare', boFace, bos, {}));
    fake.signInAs(ana);
    const caught = must(await fake.playCard('blot', anaFace, bos, {}, ''));
    expect(caught.payload.caught).toBeDefined();
    expect(caught.payload.pierce).toEqual({ by: pierce.id, card: 'lift' });
    expect(await trapStruck(fake)).toEqual([]);
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toBeUndefined();
  });

  test('a ride back springs as it does without a pierce', async () => {
    const { fake, ana, bo, anaFace, boFace, bos, lifted } = pierceSetup();
    await lifted();
    fake.signInAs(bo);
    must(await fake.setCard('cushion', boFace, bos, {}));
    fake.signInAs(ana);
    must(await fake.playCard('blot', anaFace, bos, {}, ''));
    expect((await fake.postPlays([bos])).plays.find((a) => a.kind === 'spring')?.payload).toMatchObject({ card: 'cushion', did: 'rode' });
    expect(await trapStruck(fake)).toEqual([]);
  });

  test('a Use reads no pierce, and the pierce survives it', async () => {
    const { fake, anaFace, mine, lifted } = pierceSetup();
    await lifted();
    const used = must(await fake.useCard('shield', anaFace, mine, {}, ''));
    expect(used.payload.pierce).toBeUndefined();
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toMatchObject({ card: 'lift' });
  });

  test.each(['character', 'thread', 'board'] as const)('a pierce gets a cast at %s reach past a ward of that reach, names it, and is spent', async (reach) => {
    const { fake, ana, bo, anaFace, boFace, bos, thread, lifted } = pierceSetup();
    const pierce = await lifted();
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    fake.signInAs(bo);
    const bothread = fake.seed.thread('general', boFace, 'Bo thread', 'Bo opens.');
    const target = { character: boFace, thread: bothread.thread, board: general.id }[reach];
    const key = { character: 'cward', thread: 'tward', board: 'bward' }[reach];
    if (reach === 'board') fake.seed.reach(boFace, 'board', general.id, key);
    else must(await fake.useCard(key, boFace, reach === 'character' ? boFace : bothread.thread, {}, '', reach, reach === 'character' ? bos : undefined));
    fake.signInAs(ana);
    const cast = () => fake.playCard('spark', anaFace, target, {}, '', reach, reach === 'character' ? bos : undefined);
    const landed = must(await cast());
    expect(landed.payload.pierce).toEqual({ by: pierce.id, card: 'lift', ward: key });
    expect((await fake.effectsAbove([anaFace], null, null)).some((e) => e.play === pierce.id)).toBe(false);
    // Spent: the next cast meets the ward.
    expect(await cast()).toMatchObject({ ok: false });
  });

  test('a Use at a reach reads no pierce, and the pierce stays live', async () => {
    const { fake, anaFace, mine, thread, lifted } = pierceSetup();
    const pierce = await lifted();
    const used = must(await fake.useCard('lift2', anaFace, anaFace, {}, '', 'character', mine));
    expect(used.payload.pierce).toBeUndefined();
    expect((await fake.effectsAbove([anaFace], thread, null)).some((e) => e.play === pierce.id)).toBe(true);
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toMatchObject({ by: pierce.id });
  });

  test('with two live pierces the oldest is spent first', async () => {
    const { fake, anaFace, mine, lifted } = pierceSetup();
    const first = await lifted();
    fake.clock.advance(1000);
    const second = must(await fake.useCard('lift2', anaFace, anaFace, {}, '', 'character', mine));
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toMatchObject({ by: first.id });
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toMatchObject({ by: second.id });
  });

  test('an expired pierce is not used', async () => {
    const { fake, anaFace, lifted } = pierceSetup();
    await lifted();
    fake.clock.advance(8 * 24 * 3_600_000);
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toBeUndefined();
  });

  test('a cast as another account\'s character is refused as before and spends no pierce', async () => {
    const { fake, boFace, anaFace, lifted } = pierceSetup();
    const pierce = await lifted();
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(await fake.playCard('blot', boFace, act, {}, '')).toMatchObject({ ok: false });
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toMatchObject({ by: pierce.id });
  });

  test('reachEffects leaves a spent pierce out: its own card can be used again only once it is spent', async () => {
    const { fake, anaFace, mine } = pierceSetup();
    const use = async () => fake.useCard('lift3', anaFace, anaFace, {}, '', 'character', mine);
    const first = must(await use());
    expect(await use()).toMatchObject({ ok: false, error: 'this character already carries that card' });
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    expect(must(await fake.playCard('blot', anaFace, act, {}, '')).payload.pierce).toMatchObject({ by: first.id });
    expect(must(await use()).kind).toBe('card');
  });

  test('a pierce is left out of the effects once spent, and a second can be used at once', async () => {
    const { fake, anaFace, mine, lifted } = pierceSetup();
    const first = await lifted();
    expect((await fake.effectsAbove([anaFace], null, null)).some((e) => e.play === first.id)).toBe(true);
    const { act } = fake.seed.thread('general', anaFace, 'Other', 'Open post.');
    must(await fake.playCard('blot', anaFace, act, {}, ''));
    expect((await fake.effectsAbove([anaFace], null, null)).some((e) => e.play === first.id)).toBe(false);
    expect(must(await fake.useCard('lift', anaFace, anaFace, {}, '', 'character', mine)).kind).toBe('card');
  });

  /* A card that cuts (the Buzzkill plan's Task 3): the fake mirrors place_cast's cut_refusal, the cut fact card_ended reads, and reverse_card's split. */
  const cutter = {
    ...base, key: 'ctest', name: 'Cut Test', alignment: 'salty' as const, rarity: 'rare' as const, reaches: ['post' as const, 'character' as const], cuts: { upTo: 'rare' as const },
    validateConfig: (c: unknown) => (typeof (c as { play?: unknown } | null)?.play === 'string' ? ok({ play: (c as { play: string }).play }) : { ok: false as const, why: 'Cut Test names the Gimmick it ends' }),
    canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'ctest', reaches: ['post', 'character'], cuts: { upTo: 'rare' } }, t, e, now),
  };
  const kick = { ...base, key: 'kick', name: 'Kick Me', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'use' as const, refunds: { flavors: ['salty' as const], count: 3 }, lasts: { unit: 'day' as const, count: 7 }, canApply: () => ok(undefined) };
  const legend = { ...kick, key: 'legend', name: 'Legend', rarity: 'legendary' as const, refunds: undefined };
  const coat = { ...shield, key: 'coat', name: 'Sugar Coat', rarity: 'rare' as const, gimmick: { kind: 'ward' as const, upTo: 'rare' as const } };
  const ccoat = { ...coat, key: 'ccoat', name: 'Sugar Coat', reaches: ['character' as const] };
  const fieldr = { ...shield, key: 'fieldr', name: 'Force Field R', gimmick: { kind: 'ward' as const, upTo: 'rare' as const } };
  const heart = { ...base, key: 'cheart', name: 'Cut Heart', alignment: 'sweet' as const, rarity: 'uncommon' as const, reaches: ['character' as const], discipline: { kind: 'relief' as const, points: 'all' as const }, canApply: () => ok(undefined) };
  const csnare2 = { ...snare, key: 'csnare2', name: 'Cut Snare', rarity: 'rare' as const, catches: () => 'ctest' };
  function cutSetup() {
    const fake = createFake({ instance: { ...world, cards: [...world.cards, lift, reachWard('twall', 'thread'), cutter, kick, legend, coat, ccoat, csnare2, fieldr, heart, spark, reachWard('cward', 'character')] } });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const boss = fake.seed.account('boss', { admin: true });
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: mine } = fake.seed.thread('general', anaFace, 'Mine', 'Ana here.');
    const bare = fake.seed.post(thread, anaFace, 'Nothing is up here.');
    fake.seed.cards(ana, { kick: 3, lift: 2, shield: 1, legend: 1, coat: 1, ccoat: 1, twall: 1, csnare2: 1, blot: 3, fieldr: 1, cward: 1 });
    fake.seed.cards(bo, { ctest: 6, blot: 4, lift: 2, cheart: 1, spark: 2 });
    fake.signInAs(ana);
    const kicked = async () => must(await fake.useCard('kick', anaFace, mine, {}, ''));
    const lifted = async () => must(await fake.useCard('lift', anaFace, anaFace, {}, '', 'character', mine));
    const castCut = async (config: Record<string, unknown>, target = mine) => { fake.signInAs(bo); const r = await fake.playCard('ctest', boFace, target, config, ''); fake.signInAs(ana); return r; };
    const cutAt = (play: string, target = mine) => castCut({ play }, target);
    /* A cut played at a character, from the post it is on. */
    const cutOn = async (play: string, character: string, from = mine) => { fake.signInAs(bo); const r = await fake.playCard('ctest', boFace, character, { play }, '', 'character', from); fake.signInAs(ana); return r; };
    const blotted = async (target = mine) => { fake.signInAs(bo); const r = must(await fake.playCard('blot', boFace, target, {}, '')); fake.signInAs(ana); return r; };
    return { fake, ana, bo, boss, anaFace, boFace, thread, mine, bare, kicked, lifted, castCut, cutAt, cutOn, blotted };
  }

  test('a card that cuts ends a live Gimmick on a post: it is instant, names the play and its card, and the Gimmick hands nothing back after it', async () => {
    const { kicked, cutAt, blotted } = cutSetup();
    const kickMe = await kicked();
    expect((await blotted()).payload.handedBack).toMatchObject({ by: kickMe.id });
    const cut = must(await cutAt(kickMe.id));
    expect(cut.payload).toMatchObject({ card: 'ctest', instant: true, cut: { play: kickMe.id, card: 'kick' } });
    expect(cut.payload.layer).toBeUndefined();
    expect(cut.payload.ends).toBeUndefined();
    expect((await blotted()).payload.handedBack).toBeUndefined();
  });

  test('an older log page holds the cutting Act of a Gimmick it shows, though the row that names the cut is on a newer page', async () => {
    const { fake, kicked, cutAt } = cutSetup();
    const kickMe = await kicked();
    fake.clock.advance(3_600_000);
    const cut = must(await cutAt(kickMe.id));
    expect(cut.createdAt > kickMe.createdAt).toBe(true);
    const page = await fake.logPage(new Date(Date.parse(kickMe.createdAt) + 60_000).toISOString());
    expect(page.log.cards.some((c) => c.act === kickMe.id)).toBe(true);
    expect(page.log.playsOnMine.some((p) => p.play === cut.id)).toBe(false);
    expect(page.acts.map((a) => a.id)).toContain(cut.id);
    expect(await fake.actsCutting([kickMe.id])).toEqual([expect.objectContaining({ id: cut.id })]);
    expect(await fake.actsCutting(['not-a-play'])).toEqual([]);
  });

  test('a Kick Me never hands back the card that cuts it, and still hands back a cut of another Gimmick', async () => {
    const { fake, anaFace, mine, kicked, cutAt } = cutSetup();
    const kickMe = await kicked();
    const cutKick = must(await cutAt(kickMe.id));
    expect(cutKick.payload.cut).toMatchObject({ play: kickMe.id });
    expect(cutKick.payload.handedBack).toBeUndefined();
    const second = await kicked();
    const wall = must(await fake.useCard('shield', anaFace, mine, {}, ''));
    const cutWall = must(await cutAt(wall.id));
    expect(cutWall.payload.cut).toMatchObject({ play: wall.id });
    expect(cutWall.payload.handedBack).toMatchObject({ by: second.id });
  });

  test('a second card that cuts lands on the same post for another Gimmick, and the cut one is no longer up', async () => {
    const { fake, anaFace, mine, kicked, cutAt } = cutSetup();
    const kickMe = await kicked();
    const wall = must(await fake.useCard('shield', anaFace, mine, {}, ''));
    const third = await kicked();
    must(await cutAt(kickMe.id));
    expect(must(await cutAt(wall.id)).payload.cut).toEqual({ play: wall.id, card: 'shield' });
    // A third Gimmick is still up, so the cut one is named and is not among them.
    expect(await cutAt(kickMe.id)).toEqual(refused('that Gimmick isn\'t up on this post', 'config'));
    expect(must(await cutAt(third.id)).payload.cut).toEqual({ play: third.id, card: 'kick' });
    expect(await cutAt(third.id)).toEqual(refused('there\'s no Gimmick up on this post for Cut Test to end', 'config'));
  });

  test('each refusal of a card that cuts is said in its words', async () => {
    const { fake, anaFace, mine, bare, thread, kicked, castCut, cutAt, blotted } = cutSetup();
    const none = refused('there\'s no Gimmick up on this post for Cut Test to end', 'config');
    expect(await cutAt('x', bare)).toEqual(none);
    // A Move's earn is no Gimmick.
    await blotted(bare);
    expect(await cutAt('x', bare)).toEqual(none);
    const kickMe = await kicked();
    expect(await castCut({})).toEqual(refused('Cut Test names the Gimmick it ends', 'config'));
    // A Gimmick on another post, one on the thread, and one rarer than the card's reach.
    must(await fake.useCard('shield', anaFace, bare, {}, ''));
    expect(await cutAt(kickMe.id, bare)).toEqual(refused('that Gimmick isn\'t up on this post', 'config'));
    const wall = must(await fake.useCard('twall', anaFace, thread, {}, '', 'thread'));
    expect(await cutAt(wall.id)).toEqual(refused('that Gimmick isn\'t up on this post', 'config'));
    const big = must(await fake.useCard('legend', anaFace, mine, {}, ''));
    expect(await cutAt(big.id)).toEqual(refused('Cut Test ends a Gimmick up to rare, and Legend is legendary', 'config'));
  });

  test('a rare ward turns a card that cuts away in the ward\'s words; an uncommon one does not, and the cut ends it', async () => {
    const { fake, anaFace, mine, kicked, cutAt } = cutSetup();
    const kickMe = await kicked();
    const field = must(await fake.useCard('shield', anaFace, mine, {}, ''));
    expect(must(await cutAt(field.id)).payload.cut).toMatchObject({ card: 'shield' });
    must(await fake.useCard('coat', anaFace, mine, {}, ''));
    expect(await cutAt(kickMe.id)).toEqual(refused('this post\'s Sugar Coat turns away cards up to rare', 'config'));
  });

  test('a rare catching back catches a card that cuts: it carries no cut, and the Gimmick stays up', async () => {
    const { fake, anaFace, mine, kicked, cutAt, blotted } = cutSetup();
    const kickMe = await kicked();
    must(await fake.setCard('csnare2', anaFace, mine, {}));
    const caught = must(await cutAt(kickMe.id));
    expect(caught.payload.caught).toBeDefined();
    expect(caught.payload.cut).toBeUndefined();
    expect(caught.payload.instant).toBeUndefined();
    expect((await blotted()).payload.handedBack).toMatchObject({ by: kickMe.id });
  });

  test('a card that cuts ends a Cheap Shot on a character, and the next Move carries no pierce', async () => {
    const { fake, anaFace, bare, lifted, cutOn } = cutSetup();
    const shot = await lifted();
    expect((await fake.effectsAbove([anaFace], null, null)).some((e) => e.play === shot.id)).toBe(true);
    const cut = must(await cutOn(shot.id, anaFace));
    expect(cut.payload).toMatchObject({ card: 'ctest', instant: true, reach: 'character', cut: { play: shot.id, card: 'lift' } });
    expect(cut.payload.layer).toBeUndefined();
    expect(cut.payload.ends).toBeUndefined();
    expect((await fake.effectsAbove([anaFace], null, null)).some((e) => e.play === shot.id)).toBe(false);
    expect(must(await fake.playCard('blot', anaFace, bare, {}, '')).payload.pierce).toBeUndefined();
  });

  test('a ward on a character turns a card that cuts away in the ward\'s words', async () => {
    const { fake, anaFace, mine, lifted, cutOn } = cutSetup();
    const shot = await lifted();
    must(await fake.useCard('ccoat', anaFace, anaFace, {}, '', 'character', mine));
    expect(await cutOn(shot.id, anaFace)).toEqual(refused('this character\'s Sugar Coat turns away cards up to rare', 'config'));
  });

  test('a card that cuts on a character is a cast like any: it carries the caster\'s pierce and spends it', async () => {
    const { fake, bo, boFace, anaFace, thread, mine, lifted } = cutSetup();
    const shot = await lifted();
    const bos = fake.seed.post(thread, boFace, 'Bo here.');
    fake.signInAs(bo);
    const pierce = must(await fake.useCard('lift', boFace, boFace, {}, '', 'character', bos));
    expect((await fake.effectsAbove([boFace], null, null)).some((e) => e.play === pierce.id)).toBe(true);
    const cut = must(await fake.playCard('ctest', boFace, anaFace, { play: shot.id }, '', 'character', mine));
    expect(cut.payload).toMatchObject({ instant: true, cut: { play: shot.id, card: 'lift' }, pierce: { by: pierce.id, card: 'lift' } });
    expect((await fake.effectsAbove([boFace], null, null)).some((e) => e.play === pierce.id)).toBe(false);
  });

  test('a post-reach cut under a pierce carries the pierce and the ward it passed, and spends it', async () => {
    const { fake, bo, ana, anaFace, boFace, thread, mine, kicked } = cutSetup();
    const kickMe = await kicked();
    must(await fake.useCard('fieldr', anaFace, mine, {}, ''));
    const bos = fake.seed.post(thread, boFace, 'Bo here.');
    fake.signInAs(bo);
    const pierce = must(await fake.useCard('lift', boFace, boFace, {}, '', 'character', bos));
    const cut = must(await fake.playCard('ctest', boFace, mine, { play: kickMe.id }, ''));
    expect(cut.payload).toMatchObject({ instant: true, cut: { play: kickMe.id }, pierce: { by: pierce.id, card: 'lift', ward: 'fieldr' } });
    fake.signInAs(ana);
    expect((await fake.effectsAbove([boFace], null, null)).some((e) => e.play === pierce.id)).toBe(false);
  });

  test('a heart cast under a pierce carries the pierce and spends it', async () => {
    const { fake, bo, anaFace, boFace, thread, mine } = cutSetup();
    const mod = fake.seed.staff('mod', 'Mod Bot', 'mod');
    const now = fake.clock.now();
    fake.seed.infraction(fake.seed.visit(mod, mine, { at: now - 1000 }), { points: 2, at: now - 1000 });
    const bos = fake.seed.post(thread, boFace, 'Bo here.');
    fake.signInAs(bo);
    const pierce = must(await fake.useCard('lift', boFace, boFace, {}, '', 'character', bos));
    const healed = must(await fake.playCard('cheart', boFace, anaFace, {}, '', 'character', mine));
    expect(healed.payload).toMatchObject({ instant: true, pierce: { by: pierce.id, card: 'lift' } });
    expect((await fake.effectsAbove([boFace], null, null)).some((e) => e.play === pierce.id)).toBe(false);
  });

  test('a cut Ward on a character no longer turns a cast away', async () => {
    const { fake, bo, ana, anaFace, boFace, mine, cutOn } = cutSetup();
    const wall = must(await fake.useCard('cward', anaFace, anaFace, {}, '', 'character', mine));
    fake.signInAs(bo);
    expect(await fake.playCard('spark', boFace, anaFace, {}, '', 'character', mine)).toMatchObject({ ok: false, error: expect.stringContaining('turns away') });
    fake.signInAs(ana);
    expect(must(await cutOn(wall.id, anaFace)).payload).toMatchObject({ cut: { play: wall.id, card: 'cward' } });
    fake.signInAs(bo);
    expect(await fake.playCard('spark', boFace, anaFace, {}, '', 'character', mine)).toMatchObject({ ok: true });
  });

  test('a caster who cuts their own live pierce does not spend it on that cut, and it pierces again once an admin ends the cut', async () => {
    const { fake, ana, bo, boss, anaFace, boFace, thread, mine, lifted } = cutSetup();
    fake.seed.cards(ana, { ctest: 2, lift: 2, blot: 3 });
    fake.seed.cards(bo, { shield: 1 });
    const bos = fake.seed.post(thread, boFace, 'Bo here.');
    fake.signInAs(bo);
    must(await fake.useCard('shield', boFace, bos, {}, ''));
    fake.signInAs(ana);
    const shot = await lifted();
    const cut = must(await fake.playCard('ctest', anaFace, anaFace, { play: shot.id }, '', 'character', mine));
    expect(cut.payload.cut).toEqual({ play: shot.id, card: 'lift' });
    expect(cut.payload.pierce).toBeUndefined();
    expect((await fake.effectsAbove([anaFace], null, null)).some((e) => e.play === shot.id)).toBe(false);
    fake.signInAs(boss);
    must(await fake.reverseCard(cut.id));
    fake.signInAs(ana);
    expect(must(await fake.playCard('blot', anaFace, bos, {}, '')).payload.pierce).toMatchObject({ by: shot.id, card: 'lift', ward: 'shield' });
  });

  test('an admin who ends the card that cuts brings the Gimmick back, and reverse_card tells a cut, a spent and an ended play apart', async () => {
    const { fake, ana, boss, anaFace, bare, kicked, lifted, cutAt, cutOn, blotted } = cutSetup();
    const kickMe = await kicked();
    const cut = must(await cutAt(kickMe.id));
    fake.signInAs(boss);
    expect(await fake.reverseCard(kickMe.id)).toEqual(refused('a Cut Test already ended that card; end that card to bring this one back'));
    must(await fake.reverseCard(cut.id));
    fake.signInAs(ana);
    expect((await blotted()).payload.handedBack).toMatchObject({ by: kickMe.id });
    // A Cheap Shot, cut and then brought back, is a live pierce again.
    const shot = await lifted();
    const cutShot = must(await cutOn(shot.id, anaFace));
    fake.signInAs(boss);
    must(await fake.reverseCard(cutShot.id));
    fake.signInAs(ana);
    expect((await fake.effectsAbove([anaFace], null, null)).some((e) => e.play === shot.id)).toBe(true);
    // Spent by a cast, it is over and no admin ended it; a play an admin ended says so.
    must(await fake.playCard('blot', anaFace, bare, {}, ''));
    fake.signInAs(boss);
    expect(await fake.reverseCard(shot.id)).toEqual(refused('that card is already over'));
    must(await fake.reverseCard(kickMe.id));
    expect(await fake.reverseCard(kickMe.id)).toEqual(refused('an admin has already ended that card'));
  });

  test('a banned character cannot take a back, in the ban\'s words', async () => {
    const { fake, anaFace, opener } = setup2();
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    const until = fake.clock.now() + 24 * 3_600_000;
    const visit = fake.seed.visit(fake.seed.staff('mod', 'Mod Bot', 'mod'), opener);
    fake.seed.ban(anaFace, until, { infraction: fake.seed.infraction(visit) });
    expect(await fake.takeBack(anaFace, set.id)).toMatchObject({ ok: false, error: `this character is banned until ${new Date(until).toISOString()}; the ban ends by itself then` });
  });

  test('a back whose time passes unsprung is back in the hand, and one that sprang is not', async () => {
    const { fake, ana, bo, anaFace, boFace, opener } = setup2();
    const held = async () => (await fake.myCards()).find((c) => c.card === 'snare')?.held ?? 0;
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    expect(await held()).toBe(1);
    fake.clock.advance(31 * 24 * 3_600_000);
    expect(await held()).toBe(2);
    expect((await fake.log()).cards.find((e) => e.kind === 'returned')).toMatchObject({ card: 'snare', kind: 'returned', act: null, price: 0 });
    expect(await fake.takeBack(anaFace, set.id)).toEqual(refused('there is no face-down card to take back there'));
    expect(must(await fake.setCard('snare', anaFace, opener, {})).kind).toBe('set');
    expect(await held()).toBe(1);
    fake.signInAs(bo);
    must(await fake.playCard('blot', boFace, opener, {}, ''));
    fake.signInAs(ana);
    fake.clock.advance(31 * 24 * 3_600_000);
    expect(await held()).toBe(1);
  });

  test('a set card with a match springs on a card whose flavor it holds and lets another by', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup2();
    const set = must(await fake.setCard('net', anaFace, opener, {}));
    fake.signInAs(bo);
    expect(must(await fake.playCard('sugar', boFace, opener, {}, '')).payload.caught).toBeUndefined();
    expect(must(await fake.playCard('blot', boFace, opener, {}, '')).payload.caught).toBe(set.id);
  });

  test('a match ride back springs on a common card with no quadrant on the spring, and the setter takes nothing', async () => {
    const { fake, ana, bo, anaFace, boFace, opener } = setup2();
    const back = must(await fake.setCard('cushion', anaFace, opener, {}));
    const before = (await fake.myCards()).find((c) => c.card === 'sugar')?.held;
    fake.signInAs(bo);
    const cast = must(await fake.playCard('sugar', boFace, opener, {}, ''));
    expect(cast.payload).toMatchObject({ rode: back.id });
    expect(cast.payload).not.toHaveProperty('caught');
    const spring = (await fake.postPlays([opener])).plays.find((a) => a.kind === 'spring')!;
    expect(spring.payload).toMatchObject({ did: 'rode', set: back.id, by: cast.id });
    expect(spring.payload).not.toHaveProperty('quadrant');
    fake.signInAs(ana);
    expect((await fake.myCards()).find((c) => c.card === 'sugar')?.held).toBe(before);
  });
});

/* Cards beyond a post (docs/plans/2026-11-01-card-reach-plan.md, Task 3): a play on a character, a thread or a board, and the live
   plays above a page's posts read in one batch. */
describe('a card beyond a post, and the effects above a page', () => {
  const sparkle = {
    key: 'sparkle', name: 'Sparkle', alignment: 'pepperoni' as const, rarity: 'uncommon' as const, reaches: ['character' as const],
    playPrice: () => 0, validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
    canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key: 'sparkle', reaches: ['character'] }, t, e, now),
  };
  const shop: Instance = { ...instance, cards: [sparkle], machine: [{ item: { card: sparkle.key }, availability: 'onSale' as const, price: 100 }], settings: { ...settings, economy: {} } };
  function world() {
    const fake = createFake({ instance: shop });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const boOther = fake.seed.character(bo, 'Bo Other', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    fake.seed.wallet(ana, 500);
    fake.seed.cards(ana, { sparkle: 2 });
    fake.signInAs(ana);
    return { fake, anaFace, boFace, boOther, thread, opener };
  }

  test('a character play lands in its post\'s thread, on that post, naming its reach, its target and its end', async () => {
    const { fake, anaFace, boFace, thread, opener } = world();
    expect(await fake.playCard('sparkle', anaFace, opener, {}, '')).toMatchObject({ ok: false, field: 'reach', error: 'this card lands on a character' });
    const played = must(await fake.playCard('sparkle', anaFace, boFace, {}, 'Shine.', 'character', opener));
    expect(played).toMatchObject({ kind: 'card', thread, targetActId: opener, payload: { card: 'sparkle', reach: 'character', character: boFace, message: 'Shine.' } });
    expect(Date.parse(String(played.payload.ends)) - Date.parse(played.createdAt)).toBe(7 * 86_400_000);
    expect(await fake.playCard('sparkle', anaFace, boFace, {}, '', 'character', opener)).toEqual(refused('this character already carries that card', 'config'));
  });

  test('a character play is played from that character\'s own post, and is no play on the post it sits on', async () => {
    const { fake, anaFace, boFace, boOther, opener } = world();
    expect(await fake.playCard('sparkle', anaFace, boOther, {}, '', 'character', opener)).toEqual(refused('a card on a character is played from one of its posts'));
    must(await fake.playCard('sparkle', anaFace, boFace, {}, '', 'character', opener));
    expect(await fake.playCard('sparkle', anaFace, opener, {}, '')).toMatchObject({ field: 'reach' });
    /* The post's own plays are unchanged: the character play takes no layer there. */
    const shopBoth: Instance = { ...shop, cards: [{ ...sparkle, reaches: ['character', 'post'], canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key: 'sparkle', reaches: ['character', 'post'] }, t, e, now) }] };
    const both = createFake({ instance: shopBoth });
    const a = both.seed.account('a'); const b = both.seed.account('b');
    const af = both.seed.character(a, 'A Face', 'face'); const bf = both.seed.character(b, 'B Face', 'face');
    const { act } = both.seed.thread('general', bf, 'Hi', 'Opener');
    both.seed.wallet(a, 500); both.seed.cards(a, { sparkle: 2 }); both.signInAs(a);
    must(await both.playCard('sparkle', af, bf, {}, '', 'character', act));
    expect(must(await both.playCard('sparkle', af, act, {}, ''))).toMatchObject({ payload: { layer: 1 } });
  });

  test('a Use beyond a post goes on the caller\'s own character, and a board play in The System\'s announcements thread, on no post', async () => {
    const selfie = { ...sparkle, key: 'selfie', name: 'Selfie', play: 'use' as const, canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key: 'selfie', reaches: ['character'] }, t, e, now) };
    const quake = { ...sparkle, key: 'quake', name: 'Quake', rarity: 'legendary' as const, reaches: ['board' as const], lasts: { unit: 'day' as const, count: 3 }, canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key: 'quake', reaches: ['board'] }, t, e, now) };
    /* On the wall clock: a card's own rules (landsOn) read the time as the server does, so a live board card is live to them. */
    const fake = createFake({ instance: { ...shop, cards: [selfie, quake], machine: [{ item: { card: selfie.key }, availability: 'onSale' as const, price: 100 }, { item: { card: quake.key }, availability: 'onSale' as const, price: 100 }], settings: { ...shop.settings, economy: {} } }, now: () => Date.now() });
    const ana = fake.seed.account('ana'); const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face'); const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    const { act: mine } = fake.seed.thread('general', anaFace, 'Mine', 'My post');
    fake.seed.wallet(ana, 500); fake.seed.cards(ana, { selfie: 2, quake: 2 }); fake.signInAs(ana);
    expect(await fake.useCard('selfie', anaFace, boFace, {}, '', 'character', opener)).toEqual(refused('Selfie is used on your own character'));
    must(await fake.useCard('selfie', anaFace, anaFace, {}, '', 'character', mine));
    const board = (await fake.thread(thread))!.board;
    const shook = must(await fake.playCard('quake', anaFace, board, {}, '', 'board'));
    expect(shook.targetActId).toBeNull();
    expect((await fake.thread(shook.thread))!.board).not.toBe(board);
    /* Three days, cut to the board's day. */
    expect(Date.parse(String(shook.payload.ends)) - Date.parse(shook.createdAt)).toBe(86_400_000);
    expect((await fake.playCard('quake', anaFace, board, {}, '', 'board')).ok).toBe(false);
  });

  test('effectsAbove answers the live plays on the characters, the thread and the board asked, and nothing on another mask', async () => {
    const { fake, anaFace, boFace, boOther, thread, opener } = world();
    const live = must(await fake.playCard('sparkle', anaFace, boFace, {}, '', 'character', opener));
    const board = (await fake.thread(thread))!.board;
    const above = await fake.effectsAbove([boFace, boOther], thread, board);
    expect(above).toEqual([{ play: live.id, reach: 'character', target: boFace, endsAt: live.payload.ends, act: live }]);
    expect(await fake.effectsAbove([boOther], thread, board)).toEqual([]);
    /* An ended play is gone without a reread of anything but the time. */
    fake.clock.advance(7 * 86_400_000 + 1);
    expect(await fake.effectsAbove([boFace], thread, board)).toEqual([]);
  });
});

/* An admin ends a card (supabase/migrations/0092_card_end.sql, Tasks 1 and 2): the fake refuses in the server's words and counts as it does. */
describe('an admin ends a card play (reverse_card)', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
  const blot = { ...base, key: 'blot', name: 'Blot', alignment: 'salty' as const, rarity: 'common' as const, canApply: () => ok(undefined) };
  const snare = { ...base, key: 'snare', name: 'Snare', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'blot', canApply: () => ok(undefined) };
  const shield = { ...base, key: 'shield', name: 'Shield', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'ward' as const, upTo: 'uncommon' as const }, lasts: { unit: 'day' as const, count: 2 }, canApply: () => ok(undefined) };
  const sparkle = {
    ...base, key: 'sparkle', name: 'Sparkle', alignment: 'pepperoni' as const, rarity: 'uncommon' as const, reaches: ['character' as const, 'thread' as const],
    canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'sparkle', reaches: ['character', 'thread'] }, t, e, now),
  };
  const world: Instance = { ...instance, cards: [blot, snare, shield, sparkle], machine: [{ item: { card: blot.key }, availability: 'onSale' as const, price: 100 }, { item: { card: snare.key }, availability: 'onSale' as const, price: 100 }, { item: { card: shield.key }, availability: 'onSale' as const, price: 100 }, { item: { card: sparkle.key }, availability: 'onSale' as const, price: 100 }], settings: { ...settings, economy: {} } };
  function setup() {
    const fake = createFake({ instance: world });
    const ana = fake.seed.account('ana');
    const boss = fake.seed.account('boss', { admin: true });
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    fake.seed.wallet(ana, 900);
    fake.seed.cards(ana, { blot: 4, shield: 1, sparkle: 2, snare: 1 });
    fake.signInAs(ana);
    return { fake, ana, boss, anaFace, thread, opener };
  }

  test('only an admin ends a card, and only a card play; each refusal is the server\'s words, and a second end is refused', async () => {
    const { fake, boss, anaFace, opener } = setup();
    const play = must(await fake.playCard('blot', anaFace, opener, {}, ''));
    expect(await fake.reverseCard(play.id)).toEqual(refused('only an admin ends a card'));
    fake.signInAs(boss);
    expect(await fake.reverseCard(opener)).toEqual(refused('that is not a card play'));
    expect(await fake.reverseCard('00000000-0000-4000-8000-000000000000')).toEqual(refused('that is not a card play'));
    expect(await fake.reverseCard(fake.seed.set(anaFace, opener, 'snare'))).toEqual(refused('that is not a card play'));
    const ended = must(await fake.reverseCard(play.id));
    expect(ended.play).toBe(play.id);
    expect(await fake.reverseCard(play.id)).toEqual(refused('an admin has already ended that card'));
  });

  test('a caught play never landed, and a worn-off one has worn off', async () => {
    const { fake, boss, anaFace, opener } = setup();
    const set = fake.seed.set(anaFace, opener, 'snare');
    const caught = fake.seed.card(anaFace, opener, 'blot', { caught: set });
    const used = must(await fake.useCard('shield', anaFace, opener, {}, ''));
    fake.signInAs(boss);
    expect(await fake.reverseCard(caught)).toEqual(refused('that card was caught by a trap, so it never landed'));
    fake.clock.advance(2 * 86_400_000 + 1);
    expect(await fake.reverseCard(used.id)).toEqual(refused('that card has already worn off'));
  });

  test('the end is an Act of no character in the play\'s thread, taking no number, heard on the thread; the play\'s layer stays counted', async () => {
    const { fake, boss, anaFace, thread, opener } = setup();
    const heard: Act[] = [];
    fake.subscribeThread(thread, { onAct: (a) => heard.push(a) });
    const first = must(await fake.playCard('blot', anaFace, opener, {}, ''));
    must(await fake.playCard('blot', anaFace, opener, {}, ''));
    fake.signInAs(boss);
    const ended = must(await fake.reverseCard(first.id));
    const end = await fake.act(ended.act);
    expect([end?.kind, end?.character, end?.seq, end?.thread, end?.targetActId, end?.payload]).toEqual(['card_end', null, null, thread, first.id, { why: 'reversed', by: 'admin' }]);
    expect(heard.at(-1)?.id).toBe(ended.act);
    expect((await fake.acts(thread, 1, 10)).map((a) => a.kind)).toEqual(['post']);
    /* The layer counts every play, a reversed one too (acts_card_layers refuses a reused layer): the page holds the newest of the kind, which is layer 2, and the reversed first play is neither in force nor a stand-in. */
    expect((await fake.postPlays([opener])).plays.filter((a) => a.kind === 'card').map((a) => a.payload.layer)).toEqual([2]);
  });

  test('the log and the alerts say it, as my_cards_ended and write_alert do: to the caster\'s player and the one it landed on, never to a third', async () => {
    const { fake, boss, ana, anaFace, opener, thread } = setup();
    const ben = fake.seed.account('ben');
    const benMask = fake.seed.character(ben, 'Ben Heel', 'heel');
    const cara = fake.seed.account('cara');
    fake.seed.character(cara, 'Cara Face', 'face');
    fake.seed.wallet(ben, 900);
    fake.seed.cards(ben, { blot: 2 });
    fake.signInAs(ben);
    const play = must(await fake.playCard('blot', benMask, opener, {}, ''));
    fake.signInAs(boss);
    const ended = must(await fake.reverseCard(play.id));
    const row = { cardEnd: ended.act, play: play.id, card: 'blot', reach: 'post', targetName: null, postAuthorName: 'Ana Face', casterName: 'Ben Heel' };
    /* my_cards_ended.character: the caster's mask on the caster's row, the post's author on the other. */
    fake.signInAs(ben);
    expect((await fake.log()).ended).toMatchObject([{ ...row, side: 'cast', character: benMask }]);
    expect((await fake.alerts()).filter((a) => a.kind === 'cardEnded')).toMatchObject([{ act: ended.act, character: benMask, name: 'Ben Heel', thread }]);
    fake.signInAs(ana);
    expect((await fake.log()).ended).toMatchObject([{ ...row, side: 'onMine', character: anaFace }]);
    /* The one it landed on is told as well (reverse_card's write_alert, sub onYours). */
    expect((await fake.alerts()).filter((a) => a.kind === 'cardEnded')).toMatchObject([{ act: ended.act, sub: 'onYours', character: anaFace, name: 'Ana Face' }]);
    for (const other of [boss, cara]) {
      fake.signInAs(other);
      expect((await fake.log()).ended).toEqual([]);
      expect((await fake.alerts()).filter((a) => a.kind === 'cardEnded')).toEqual([]);
    }
  });

  test('an admin\'s end of a card on yours is heard live on account:<id> by the one it landed on (onYours) and by the caster, and no onYours for the caster\'s own other mask', async () => {
    const { fake, boss, ana, anaFace, opener, thread } = setup();
    const ben = fake.seed.account('ben');
    const benMask = fake.seed.character(ben, 'Ben Heel', 'heel');
    const benFace = fake.seed.character(ben, 'Ben Face', 'face');
    const benPost = fake.seed.post(thread, benFace, 'a post of Ben\'s');
    fake.seed.wallet(ben, 900);
    fake.seed.cards(ben, { blot: 4 });
    const heard = { ana: [] as { kind: string; sub: string | null; character: string | null }[], ben: [] as { kind: string; sub: string | null; character: string | null }[] };
    fake.signInAs(ana);
    fake.subscribeAccount({ onAlert: (a) => heard.ana.push(a) });
    fake.signInAs(ben);
    fake.subscribeAccount({ onAlert: (a) => heard.ben.push(a) });
    const onAna = must(await fake.playCard('blot', benMask, opener, {}, ''));
    const onOwn = must(await fake.playCard('blot', benMask, benPost, {}, ''));
    fake.signInAs(boss);
    must(await fake.reverseCard(onAna.id));
    must(await fake.reverseCard(onOwn.id));
    await flush();
    expect(heard.ana.filter((a) => a.kind === 'cardEnded')).toEqual([expect.objectContaining({ kind: 'cardEnded', sub: 'onYours', character: anaFace })]);
    expect(heard.ben).toEqual([expect.objectContaining({ kind: 'cardEnded', sub: null, character: benMask }), expect.objectContaining({ kind: 'cardEnded', sub: null, character: benMask })]);
  });

  test('my_cards_ended.character files a character and a thread play under the mask it landed on, and the caster\'s own row under the caster', async () => {
    const { fake, boss, ana, anaFace, opener, thread } = setup();
    const ben = fake.seed.account('ben');
    const benMask = fake.seed.character(ben, 'Ben Heel', 'heel');
    const ana2 = fake.seed.character(ana, 'Ana Other', 'face');
    const { act: second } = fake.seed.thread('general', ana2, 'Second', 'Another');
    fake.seed.wallet(ben, 900);
    fake.seed.cards(ben, { sparkle: 4 });
    fake.signInAs(ben);
    const onChar = must(await fake.playCard('sparkle', benMask, ana2, {}, '', 'character', second));
    const onThread = must(await fake.playCard('sparkle', benMask, thread, {}, '', 'thread', opener));
    fake.signInAs(boss);
    must(await fake.reverseCard(onChar.id));
    must(await fake.reverseCard(onThread.id));
    fake.signInAs(ana);
    const mineRows = (await fake.log()).ended.map((e) => [e.play, e.side, e.reach, e.character]);
    expect(mineRows).toEqual(expect.arrayContaining([[onChar.id, 'onMine', 'character', ana2], [onThread.id, 'onMine', 'thread', anaFace]]));
    expect(mineRows).toHaveLength(2);
    fake.signInAs(ben);
    expect((await fake.log()).ended.map((e) => [e.play, e.side, e.character])).toEqual(expect.arrayContaining([[onChar.id, 'cast', benMask], [onThread.id, 'cast', benMask]]));
  });

  test('postPlays carries the end beside the plays, for the screen to mark a play reversed', async () => {
    const { fake, boss, anaFace, opener } = setup();
    const play = must(await fake.playCard('blot', anaFace, opener, {}, ''));
    fake.signInAs(boss);
    const ended = must(await fake.reverseCard(play.id));
    expect((await fake.postPlays([opener])).plays.map((a) => [a.kind, a.id, a.targetActId])).toEqual([['card', play.id, opener], ['card_end', ended.act, play.id]]);
    expect((await fake.postPlays([opener])).plays.map((a) => a.kind)).toEqual(['card', 'card_end']);
    expect((await fake.cardEnds([play.id, 'nope'])).map((a) => [a.kind, a.id, a.targetActId])).toEqual([['card_end', ended.act, play.id]]);
    expect(await fake.cardEnds([opener])).toEqual([]);
    expect(await fake.cardEnds([])).toEqual([]);
  });

  test('an ended play keeps no state and is not released from: both are refused in the server\'s words, after the checks that come first', async () => {
    const { fake, ana, boss, anaFace, opener } = setup();
    const play = must(await fake.playCard('blot', anaFace, opener, {}, ''));
    fake.signInAs(boss);
    must(await fake.reverseCard(play.id));
    fake.signInAs(ana);
    expect(await fake.saveEffect(play.id, anaFace, { strokes: [] })).toEqual(refused('an admin ended that card'));
    expect(await fake.releaseEffect(play.id)).toEqual(refused('an admin ended that card'));
    /* Not the post's author: that refusal comes first, as the SQL checks it before the end. */
    const other = fake.seed.account('other');
    const otherFace = fake.seed.character(other, 'Other Face', 'face');
    fake.signInAs(other);
    expect(await fake.saveEffect(play.id, otherFace, { strokes: [] })).toEqual(refused('only the post\'s author saves what is on it'));
  });

  test('a reversed ward turns away nothing, and a reversed play stops counting where a card\'s rules look at the post', async () => {
    const { fake, ana, boss, anaFace, opener } = setup();
    const ward = must(await fake.useCard('shield', anaFace, opener, {}, ''));
    expect((await fake.playCard('blot', anaFace, opener, {}, '')).ok).toBe(false);
    fake.signInAs(boss);
    must(await fake.reverseCard(ward.id));
    fake.signInAs(ana);
    expect((await fake.playCard('blot', anaFace, opener, {}, '')).ok).toBe(true);
  });

  test('a play beyond a post that is ended leaves the effects above and can be played again; the end is heard on reach', async () => {
    const { fake, ana, boss, anaFace, thread, opener } = setup();
    const heard: Act[] = [];
    fake.subscribeReach({ onPlay: (a) => heard.push(a) });
    const live = must(await fake.playCard('sparkle', anaFace, anaFace, {}, '', 'character', opener));
    const board = (await fake.thread(thread))!.board;
    expect(await fake.effectsAbove([anaFace], thread, board)).toHaveLength(1);
    expect((await fake.playCard('sparkle', anaFace, anaFace, {}, '', 'character', opener)).ok).toBe(false);
    fake.signInAs(boss);
    const ended = must(await fake.reverseCard(live.id));
    expect(await fake.effectsAbove([anaFace], thread, board)).toEqual([]);
    expect(heard.map((a) => a.id)).toEqual([live.id, ended.act]);
    fake.signInAs(ana);
    expect((await fake.playCard('sparkle', anaFace, anaFace, {}, '', 'character', opener)).ok).toBe(true);
  });
});

describe('followed threads (my_followed_threads, 0059)', () => {
  test('a count stops at the cap, counts others\' posts alone, and a thread read to its end leaves', async () => {
    const fake = createFake({ instance });
    const me = fake.seed.account('me');
    const other = fake.seed.account('other');
    const mine = fake.seed.character(me, 'Mine', 'face');
    const theirs = fake.seed.character(other, 'Theirs', 'heel');
    const { thread } = fake.seed.thread('general', mine, 'Capped', 'opening');
    for (let i = 0; i < 101; i++) fake.seed.post(thread, theirs, `reply ${i}`);
    fake.seed.post(thread, mine, 'my own');
    fake.signInAs(me);
    const rows = await fake.followed();
    expect(rows.map((r) => [r.thread, r.newPosts])).toEqual([[thread, 100]]);
    await fake.markRead(thread, 200, null);
    expect(await fake.followed()).toEqual([]);
  });
});

describe('the Alerts read and the count (my_alerts, my_alerts_unread, 0060)', () => {
  const T0 = Date.parse('2026-11-01T00:00:00Z');
  const H = 3_600_000;

  /** Ana plays Ana Face (who started "Mine") and Ana Heel; Bo plays Bo Face; Cy plays Cy Face. Each source holds one line for Ana. */
  function alertsWorld() {
    const fake = createFake({ instance });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const cy = fake.seed.account('cy');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const anaHeel = fake.seed.character(ana, 'Ana Heel', 'heel');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const cyFace = fake.seed.character(cy, 'Cy Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Mine', 'opening', { at: T0 });
    const quote = fake.seed.post(thread, boFace, 'quoting', { quote: opener, at: T0 + H });
    const card = fake.seed.card(boFace, opener, 'whoops', { at: T0 + 2 * H });
    fake.seed.alert(ana, { kind: 'trapSprang', act: quote, character: anaFace, at: T0 + 3 * H });
    fake.seed.alert(ana, { kind: 'hint', act: opener, character: anaFace, at: T0 + 4 * H });
    fake.seed.alert(ana, { kind: 'ruling', act: opener, character: anaFace, sub: 'x', at: T0 + 5 * H });
    fake.seed.settle({ at: T0 + 6 * H - 1000, ledger: [{ character: anaFace, reason: 'face.shone', amount: 5 }, { character: anaHeel, reason: 'heel.drewHeat', amount: 4 }, { character: boFace, reason: 'face.shone', amount: 3 }] });
    fake.seed.post(thread, cyFace, 'another', { at: T0 + 7 * H });
    return { fake, ana, bo, cy, anaFace, anaHeel, boFace, thread, opener, quote, card };
  }

  test('each source is one line with its kind, newest first, and carries the words\' inputs', async () => {
    const { fake, ana, thread, opener, quote, card, anaFace } = alertsWorld();
    fake.signInAs(ana);
    const rows = await fake.alerts();
    expect(rows.map((r) => r.kind)).toEqual(['followed', 'settlement', 'ruling', 'hint', 'trapSprang', 'cardOnYours', 'quote']);
    expect(rows[0]).toEqual({ kind: 'followed', sub: null, act: null, character: null, at: new Date(T0 + 7 * H).toISOString(), thread, name: null, title: 'Mine', count: 2 });
    expect(rows[1]).toMatchObject({ kind: 'settlement', act: null, count: 2 });
    expect(rows[1]!.sub).toBe('1');
    expect(rows[2]).toMatchObject({ kind: 'ruling', sub: 'x', act: opener, character: anaFace, name: 'Ana Face', thread, title: 'Mine' });
    expect(rows[5]).toMatchObject({ kind: 'cardOnYours', act: card, character: anaFace, name: 'Ana Face' });
    expect(rows[6]).toMatchObject({ kind: 'quote', act: quote, character: anaFace, name: 'Ana Face', title: 'Mine', count: null });
  });

  test('the count moves with the mark and stops at its bound; a followed thread read to its end leaves', async () => {
    const { fake, ana, thread } = alertsWorld();
    fake.signInAs(ana);
    expect(await fake.alertsUnread()).toBe(7);
    must(await fake.seeAlerts(new Date(T0 + 4.5 * H).toISOString()));
    expect(await fake.alertsUnread()).toBe(3);
    must(await fake.seeAlerts(new Date(T0 + 8 * H).toISOString()));
    expect(await fake.alertsUnread()).toBe(0);
    expect((await fake.alerts()).length).toBe(7);
    await fake.markRead(thread, 100, null);
    expect((await fake.alerts()).map((r) => r.kind)).not.toContain('followed');
    // Many alerts: the count stops at 10.
    const { fake: busy, ana: busyAna, anaFace, opener } = alertsWorld();
    for (let i = 0; i < 20; i++) busy.seed.alert(busyAna, { kind: 'hint', act: opener, character: anaFace, at: T0 + 10 * H + i * MINUTE });
    busy.signInAs(busyAna);
    expect(await busy.alertsUnread()).toBe(10);
  });

  test('an account that never looked counts from when it was opened, and still lists what came before (issue #148)', async () => {
    const { fake, opener } = alertsWorld();
    const dee = fake.seed.account('dee', { joinedAt: T0 + 4.5 * H });
    const deeFace = fake.seed.character(dee, 'Dee Face', 'face');
    fake.seed.alert(dee, { kind: 'ruling', act: opener, character: deeFace, sub: 'before', at: T0 + 3 * H });
    fake.seed.alert(dee, { kind: 'ruling', act: opener, character: deeFace, sub: 'after', at: T0 + 5 * H });
    fake.signInAs(dee);
    expect(await fake.alertsUnread()).toBe(1);
    expect((await fake.alerts()).length).toBe(2);
  });

  test('settlementMoved answers the caller\'s count and when it was applied, and null for a stranger\'s settlement or an unknown id', async () => {
    const { fake, ana, bo, cy } = alertsWorld();
    fake.signInAs(ana);
    const mine = (await fake.alerts()).find((r) => r.kind === 'settlement')!;
    expect(await fake.settlementMoved(mine.sub!)).toEqual({ count: 2, at: mine.at });
    expect(await fake.settlementMoved('999')).toBeNull();
    await expect(fake.settlementMoved('not-an-id')).rejects.toThrow();
    fake.signInAs(bo);
    expect(await fake.settlementMoved(mine.sub!)).toMatchObject({ count: 1 });
    fake.signInAs(cy);
    expect(await fake.settlementMoved(mine.sub!)).toBeNull();
    fake.signOut();
    await expect(fake.settlementMoved(mine.sub!)).rejects.toThrow();
  });

  test('another account sees none of the caller\'s, and a visitor reads nothing', async () => {
    const { fake, cy, bo, anaHeel } = alertsWorld();
    fake.signInAs(cy);
    // Cy posted in Ana's thread; nothing in it is Cy's: Cy started nothing, follows nothing, has no settlement line.
    expect(await fake.alerts()).toEqual([]);
    expect(await fake.alertsUnread()).toBe(0);
    fake.signInAs(bo);
    // Bo has his own settlement line and nothing of Ana's.
    expect((await fake.alerts()).map((r) => r.kind)).toEqual(['settlement']);
    expect((await fake.alerts())[0]!.count).toBe(1);
    expect(anaHeel).toBeTruthy();
    fake.signOut();
    await expect(fake.alerts()).rejects.toThrow();
    await expect(fake.alertsUnread()).rejects.toThrow();
  });

  test('paging with before returns the next page without repeats, and keeps a tie whole', async () => {
    const { fake, ana, anaFace, opener } = alertsWorld();
    // 40 more: the 29th, 30th and 31st newest share an instant, across the edge of the first page of 30.
    for (let i = 0; i < 40; i++) fake.seed.alert(ana, { kind: 'hint', act: opener, character: anaFace, sub: `h${i}`, at: T0 + 100 * H + (i === 9 || i === 10 || i === 11 ? 11 : i) * MINUTE });
    fake.signInAs(ana);
    const first = await fake.alerts();
    expect(first.length).toBe(31);
    const second = await fake.alerts(first.at(-1)!.at);
    const key = (r: { kind: string; sub: string | null; act: string | null; at: string }) => `${r.kind} ${r.sub} ${r.act} ${r.at}`;
    expect(second.map(key).filter((k) => first.map(key).includes(k))).toEqual([]);
    expect(first.length + second.length + (await fake.alerts(second.at(-1)!.at)).length).toBe(47);
  });
});

describe('handover to-dos, by the handover (0403)', () => {
  test('each handover has its own id and cause, and a to-do is dismissed by its id: a departure in the season a roll-over opened leaves the roll-over\'s to-do', async () => {
    const { fake } = world();
    fake.seed.staff('first', 'First Boss', 'boss');
    fake.seed.staff('second', 'Second Boss', 'mod');
    fake.seed.staff('third', 'Third Boss', 'mod');
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    fake.seed.handover({ outgoing: 'first', boss: 'second', at: Date.UTC(2026, 10, 2) });
    fake.seed.handover({ outgoing: 'second', boss: 'third', at: Date.UTC(2026, 10, 3), cause: 'departure', outgoingOffice: 'benched' });
    const todos = (await fake.adminQueue()).todos;
    expect(todos.map((t) => [t.handover, t.cause, t.season])).toEqual([[2, 'departure', 2], [1, 'rollover', 2]]);
    expect(await fake.dismissHandoverTodo(2)).toEqual({ ok: true, value: { handover: 2, season: 2 } });
    expect((await fake.adminQueue()).todos.map((t) => t.handover)).toEqual([1]);
    expect(await fake.dismissHandoverTodo(99)).toMatchObject({ ok: false });
  });
});

describe('live news on reach', () => {
  test('a change of Boss is heard as the Boss who left and the Boss who arrived, in the words the page reads', async () => {
    const { fake } = world();
    fake.seed.staff('first', 'First Boss', 'boss');
    fake.seed.staff('second', 'Second Boss', 'boss');
    const heard: unknown[] = [];
    fake.subscribeReach({ onNews: (n) => heard.push(n) });
    fake.seed.handover({ outgoing: 'first', boss: 'second', at: Date.UTC(2026, 10, 2) });
    await flush();
    expect(heard).toEqual([
      { kind: 'seasonNews', sub: 'bossLeft', act: null, at: '2026-11-02T00:00:00.000Z' },
      { kind: 'seasonNews', sub: 'bossArrived', act: null, at: '2026-11-02T00:00:00.000Z' },
    ]);
  });
  test('a settlement applied is heard once by every listener on reach, with its id and time and nothing of any player\'s', async () => {
    const { fake } = world();
    const me = fake.seed.account('settler');
    const ch = fake.seed.character(me, 'Settled', 'face');
    const heard: unknown[] = [];
    fake.subscribeReach({ onSettled: (s) => heard.push(s) });
    fake.seed.settle({ at: Date.UTC(2026, 10, 2, 8), ledger: [{ character: ch, reason: 'face.story', amount: 10 }] });
    await flush();
    expect(heard).toEqual([{ id: '1', at: '2026-11-02T08:00:01.000Z' }]);
  });
  test('an update posted by an admin is heard by every listener on reach, once, with its Act and time', async () => {
    const { fake } = world();
    const admin = fake.seed.account('boss', { admin: true });
    const heard: unknown[] = [];
    fake.subscribeReach({ onNews: (n) => heard.push(n) });
    fake.signInAs(admin);
    const update = must(await fake.postUpdate('Traps bite', 'Two fixes.', []));
    await flush();
    expect(heard).toEqual([{ kind: 'update', sub: null, act: update.act, at: expect.any(String) }]);
    expect(fake.broadcast.log.filter((e) => e.topic === 'reach' && e.event === 'news')).toHaveLength(1);
  });
});

/* The alerts the server announces live (write_alert, 0058: on `account:<owner>`), for the ones the fake derives from Acts: only the target's
   own account hears, never the caster's, and none for a staff target or one of the caster's own masks. */
describe('live alerts derived from Acts', () => {
  function listening() {
    const w = world();
    const heard = { ana: [] as unknown[], bo: [] as unknown[] };
    w.fake.signInAs(w.bo);
    w.fake.subscribeAccount({ onAlert: (a) => heard.bo.push(a) });
    w.fake.signInAs(w.ana);
    w.fake.subscribeAccount({ onAlert: (a) => heard.ana.push(a) });
    return { ...w, heard };
  }
  test('a quote of a post is heard by its author\'s account, and not by the quoter\'s', async () => {
    const w = listening();
    must(await w.fake.post(w.thread, w.anaFace, 'agreed', w.opener));
    await flush();
    expect(w.heard.bo).toEqual([expect.objectContaining({ kind: 'quote', character: w.boFace, sub: null })]);
    expect(w.heard.ana).toEqual([]);
  });
  test('a quote of one\'s own other mask, or of a staff post, is heard by no one', async () => {
    const w = listening();
    const mine = must(await w.fake.post(w.thread, w.anaFace, 'mine', null));
    must(await w.fake.post(w.thread, w.anaHeel, 'me again', mine.id));
    await flush();
    expect(w.heard).toEqual({ ana: [], bo: [] });
  });
  test('a card on a post is heard by the post\'s author\'s account only', async () => {
    const w = listening();
    w.fake.seed.card(w.anaFace, w.opener, 'dab', { live: true });
    await flush();
    expect(w.heard.bo).toEqual([expect.objectContaining({ kind: 'cardOnYours', character: w.boFace })]);
    expect(w.heard.ana).toEqual([]);
  });
});

/* The framed alert (0118, write_framed; the BBCode plan, Tasks 8 and 9): a counterfeit quote's `user=<id>` names a character, and its owner is told. */
describe('framed alerts', () => {
  function framedWorld() {
    const w = world({ postMaxLength: 2000 });
    const cy = w.fake.seed.account('cy');
    const cyFace = w.fake.seed.character(cy, 'Cy Face', 'face');
    const waiting = w.fake.seed.character(cy, 'Waiting', 'heel', { debuted: false });
    const boss = w.fake.seed.staff('boss', 'The Boss', 'boss');
    const heard = [] as { kind: string; character: unknown }[];
    w.fake.signInAs(w.bo);
    w.fake.subscribeAccount({ onAlert: (a) => heard.push(a) });
    w.fake.signInAs(w.ana);
    const named = (...ids: string[]) => ids.map((i) => `[quote=Someone user=${i}]words[/quote]`).join(' ');
    const framedFor = async (account: string) => { w.fake.signInAs(account); const rows = (await w.fake.alerts()).filter((a) => a.kind === 'framed'); w.fake.signInAs(w.ana); return rows; };
    return { ...w, cy, cyFace, waiting, boss, heard, named, framedFor };
  }
  test('a post that names another player\'s debuted character writes one alert for its owner, about the post, and the owner hears it live', async () => {
    const w = framedWorld();
    const body = w.named(w.boFace);
    const made = must(await w.fake.post(w.thread, w.anaFace, body, null, [w.boFace]));
    await flush();
    expect(await w.framedFor(w.bo)).toMatchObject([{ kind: 'framed', act: made.id, character: w.boFace, name: 'Bo Face', sub: null }]);
    expect(w.heard).toEqual([expect.objectContaining({ kind: 'framed', character: w.boFace })]);
    expect(await w.framedFor(w.ana)).toEqual([]);
  });
  test('a thread start and a spin write them as a post does', async () => {
    const w = framedWorld();
    must(await w.fake.startThread('general', w.anaFace, 'Fresh', w.named(w.boFace), [w.boFace]));
    must(await w.fake.spin(w.opener, w.anaFace, 'Spun', w.named(w.boFace), [w.boFace]));
    expect(await w.framedFor(w.bo)).toHaveLength(2);
  });
  test('an apology writes them as the spin it is', async () => {
    const w = framedWorld();
    const at = Date.now() - 3_600_000;
    const move = w.fake.seed.groupMove('boss', { character: w.anaFace, group: 'trialMembers', board: 'general', at, expiresAt: at + 86_400_000 });
    must(await w.fake.apologize(move, w.anaFace, 'Sorry', w.named(w.boFace), [w.boFace]));
    expect(await w.framedFor(w.bo)).toHaveLength(1);
  });
  describe('an apology is read as the action rule reads it, before anything else', () => {
    function apologyWorld() {
      const w = framedWorld();
      const at = Date.now() - 3_600_000;
      const move = w.fake.seed.groupMove('boss', { character: w.anaFace, group: 'trialMembers', board: 'general', at, expiresAt: at + 86_400_000 });
      const wrote = async () => ({ threads: (await w.fake.threads('general', { offset: 0, limit: 50 })).total, apologies: await w.fake.myApologies(w.anaFace) });
      return { ...w, move, wrote };
    }
    test.each([['empty', ''], ['whitespace', '  \n ']])('a %s body is refused by body, and writes no thread, Act or apology', async (_name, body) => {
      const w = apologyWorld();
      const before = await w.wrote();
      const acts = await w.fake.thread(w.thread);
      const answer = await w.fake.apologize(w.move, w.anaFace, 'Sorry', body);
      expect(answer).toMatchObject({ ok: false, field: 'body', error: 'is empty' });
      expect(await w.wrote()).toEqual(before);
      expect(await w.fake.thread(w.thread)).toEqual(acts);
    });
    test('a title over the limit is refused by title', async () => {
      const w = apologyWorld();
      const before = await w.wrote();
      expect(await w.fake.apologize(w.move, w.anaFace, 'x'.repeat(21), 'I was wrong.')).toMatchObject({ ok: false, field: 'title', error: 'is longer than 20 characters' });
      expect(await w.wrote()).toEqual(before);
    });
    test('signed out, it is refused with "sign in to act"', async () => {
      const w = apologyWorld();
      w.fake.signOut();
      expect(await w.fake.apologize(w.move, w.anaFace, 'Sorry', 'I was wrong.')).toMatchObject({ ok: false, error: 'sign in to act' });
    });
    test('with a body it is sent', async () => {
      const w = apologyWorld();
      expect((await w.fake.apologize(w.move, w.anaFace, 'Sorry', 'I was wrong.')).ok).toBe(true);
    });
  });
  test('none for an undebuted, unknown, unnamed-in-the-body, staff or own-mask target, and the answer is the same ok', async () => {
    const w = framedWorld();
    const nowhere = '99999999-9999-4999-8999-999999999999';
    for (const [framing, body] of [
      [[w.waiting], w.named(w.waiting)], [[nowhere], w.named(nowhere)], [[w.boFace], 'no quote here'],
      [[w.boss], w.named(w.boss)], [[w.anaHeel], w.named(w.anaHeel)],
    ] as const) expect((await w.fake.post(w.thread, w.anaFace, body, null, [...framing])).ok).toBe(true);
    for (const account of [w.bo, w.cy, w.ana]) expect(await w.framedFor(account)).toEqual([]);
  });
  test('the id is found in the body without regard to case', async () => {
    const w = framedWorld();
    must(await w.fake.post(w.thread, w.anaFace, `[quote user=${w.boFace.toUpperCase()}]x[/quote]`, null, [w.boFace]));
    expect(await w.framedFor(w.bo)).toHaveLength(1);
  });
  test('only the first five ids count, and a repeat is one alert', async () => {
    const w = framedWorld();
    const six = Array.from({ length: 6 }, (_, i) => w.fake.seed.character(w.bo, `Bo ${i}`, 'face'));
    must(await w.fake.post(w.thread, w.anaFace, w.named(...six), null, six));
    expect(await w.framedFor(w.bo)).toHaveLength(5);
    must(await w.fake.post(w.thread, w.anaFace, w.named(w.cyFace), null, [w.cyFace, w.cyFace, w.cyFace]));
    expect(await w.framedFor(w.cy)).toHaveLength(1);
  });
  test('an edit writes none', async () => {
    const w = framedWorld();
    const made = must(await w.fake.post(w.thread, w.anaFace, 'plain', null));
    must(await w.fake.edit(made.id, w.anaFace, w.named(w.boFace)));
    expect(await w.framedFor(w.bo)).toEqual([]);
  });
});

/* Forged quotes (docs/plans/2026-11-20-forged-quotes-design.md, sections 1, 3, 5 and 7): the fake works out the verdict as the database does, with Task 1's TypeScript, when a post, spin or edit is written. */
describe('forged quotes', () => {
  function forgedWorld() {
    const w = world({ postMaxLength: 2000 });
    return { ...w, quoted: w.fake.seed.post(w.thread, w.boFace, 'I like Mario a lot') };
  }
  const forgedOf = async (w: { fake: ReturnType<typeof createFake> }, id: string) => ((await w.fake.actsById([id]))[0]!.payload as { forged?: unknown }).forged;
  const targetOf = async (w: { fake: ReturnType<typeof createFake> }, id: string) => (await w.fake.actsById([id]))[0]!.targetActId;
  const alertsFor = async (w: { fake: ReturnType<typeof createFake>; ana: string; bo: string }, account: string, kind: string) => { w.fake.signInAs(account); const rows = (await w.fake.alerts()).filter((a) => a.kind === kind); w.fake.signInAs(w.ana); return rows; };

  test('an honest quote leaves the Act with no verdict, keeps its target, and writes a quote alert and no framed one', async () => {
    const w = forgedWorld();
    const made = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]Mario a lot[/quote]agreed`, w.quoted));
    expect(await forgedOf(w, made.id)).toBeUndefined();
    expect(await targetOf(w, made.id)).toBe(w.quoted);
    expect(await alertsFor(w, w.bo, 'quote')).toHaveLength(1);
    expect(await alertsFor(w, w.bo, 'framed')).toEqual([]);
  });

  test('a doctored quote carries the verdict, drops the target, writes no quote alert, and writes a framed one to the quoted post\'s author', async () => {
    const w = forgedWorld();
    const made = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]I hate Mario a lot[/quote]so there`, w.quoted));
    expect(await forgedOf(w, made.id)).toEqual([w.quoted]);
    expect(await targetOf(w, made.id)).toBeNull();
    expect(await alertsFor(w, w.bo, 'quote')).toEqual([]);
    expect(await alertsFor(w, w.bo, 'framed')).toMatchObject([{ kind: 'framed', act: made.id, character: w.boFace }]);
  });

  test('the verdict is one per quoted post (a forged quote taints the others of it), lowercase and sorted, and a client\'s own is dropped', async () => {
    const w = forgedWorld();
    const other = w.fake.seed.post(w.thread, w.boFace, 'second words');
    const body = `[quote=${w.quoted}]Mario a lot[/quote][quote=${w.quoted}]never said[/quote][quote=${other}]second words[/quote]`;
    const made = must(await w.fake.post(w.thread, w.anaFace, body, null));
    expect(await forgedOf(w, made.id)).toEqual([w.quoted]);
  });

  test('a quote that stands only in an edit written before the save is authentic; one that stands only in an edit written after is forged', async () => {
    const w = forgedWorld();
    w.fake.clock.advance(60_000);
    w.fake.seed.edit(w.quoted, w.boFace, 'I like Luigi now');
    w.fake.clock.advance(60_000);
    const before = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]Luigi now[/quote]`, null));
    const original = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]Mario a lot[/quote]`, null));
    expect(await forgedOf(w, before.id)).toBeUndefined();
    expect(await forgedOf(w, original.id)).toBeUndefined();
    const fresh = w.fake.seed.post(w.thread, w.boFace, 'brand new words');
    const made = must(await w.fake.post(w.thread, w.anaFace, `[quote=${fresh}]Waluigi[/quote]`, null));
    w.fake.clock.advance(60_000);
    w.fake.seed.edit(fresh, w.boFace, 'Waluigi is here');
    expect(await forgedOf(w, made.id)).toEqual([fresh]);
  });

  test('a quote that matches only a hidden version is forged, and a hidden version\'s words are not read', async () => {
    const w = forgedWorld();
    const secret = w.fake.seed.post(w.thread, w.boFace, 'a secret sentence');
    w.fake.seed.hide(secret, 'hide');
    const made = must(await w.fake.post(w.thread, w.anaFace, `[quote=${secret}]secret sentence[/quote]`, null));
    expect(await forgedOf(w, made.id)).toEqual([secret]);
  });

  test('an id that is no Act, a card\'s id and an empty quote of a real post', async () => {
    const w = forgedWorld();
    const nowhere = '99999999-9999-4999-8999-999999999999';
    const card = w.fake.seed.card(w.anaFace, w.quoted, 'dab', { live: true });
    const made = must(await w.fake.post(w.thread, w.anaFace, `[quote=${nowhere}]x[/quote][quote=${w.quoted}][/quote][quote=${card}]x[/quote]`, null));
    expect(await forgedOf(w, made.id)).toEqual([nowhere, card].sort());
  });

  test('a spin and an edit carry their own verdicts, and an edit writes no framed alert', async () => {
    const w = forgedWorld();
    const spun = must(await w.fake.spin(w.opener, w.anaFace, 'Spun', `[quote=${w.quoted}]never said[/quote]`, []));
    expect(((spun.act.payload) as { forged?: unknown }).forged).toEqual([w.quoted]);
    expect(await alertsFor(w, w.bo, 'framed')).toHaveLength(1);
    const mine = must(await w.fake.post(w.thread, w.anaFace, 'plain', null));
    must(await w.fake.edit(mine.id, w.anaFace, `[quote=${w.quoted}]never said it either[/quote]`));
    expect(await alertsFor(w, w.bo, 'framed')).toHaveLength(1);
    const versions = await w.fake.history(mine.id);
    expect(versions.map((v) => (v.payload as { forged?: unknown }).forged)).toEqual([undefined, [w.quoted]]);
  });

  test('a forged quote of a post hidden later keeps its words, since no layer is asked for it, and an honest quote of the same post is emptied', async () => {
    const w = forgedWorld();
    const doctored = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]Words never said[/quote]tail`, null));
    const honest = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]Mario a lot[/quote]tail`, null));
    w.fake.seed.hide(w.quoted, 'hide');
    const [d, h] = await w.fake.actsById([doctored.id, honest.id]);
    expect(d!.payload.body).toBe(`[quote=${w.quoted}]Words never said[/quote]tail`);
    expect(h!.payload.body).toBe(`[quote=${w.quoted}][/quote]tail`);
  });

  test('a character named by `framing` is never told a second time through a forged quote, whether or not the framing alert was skipped', async () => {
    const w = forgedWorld();
    /* Told once by framing (named in the body), and its post is also forged: one alert. */
    must(await w.fake.post(w.thread, w.anaFace, `[quote=Someone user=${w.boFace}]x[/quote][quote=${w.quoted}]never said[/quote]`, null, [w.boFace]));
    expect(await alertsFor(w, w.bo, 'framed')).toHaveLength(1);
    /* Named in `framing` but not in the body, so the framing alert is skipped: the forged quote does not tell it either. */
    must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]never said it again[/quote]`, null, [w.boFace]));
    expect(await alertsFor(w, w.bo, 'framed')).toHaveLength(1);
  });

  test('a play on a phrase inside a doctored quote lands on the post as the poster\'s own words, and inside an honest quote it does not', async () => {
    const w = forgedWorld();
    const hits = (target: unknown) => (target as { text: string }).text;
    const doctored = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]Luigi never said this[/quote]tail`, null));
    const honest = must(await w.fake.post(w.thread, w.anaFace, `[quote=${w.quoted}]Mario a lot[/quote]tail`, null));
    const [d, h] = await w.fake.actsById([doctored.id, honest.id]);
    expect(hits(targetOf2(d!))).toContain('Luigi never said this');
    expect(hits(targetOf2(h!))).not.toContain('Mario a lot');
  });

  test('a thread start frames the author of each forged post, and with `framing` ids no more than five alerts are written, each character once', async () => {
    const w = forgedWorld();
    const faces = Array.from({ length: 6 }, (_, i) => w.fake.seed.character(w.bo, `Bo ${i}`, 'face'));
    const posts = faces.map((c, i) => w.fake.seed.post(w.thread, c, `words ${i}`));
    const named = faces.slice(0, 3).map((c) => `[quote=Someone user=${c}]x[/quote]`).join('');
    const forged = posts.map((p) => `[quote=${p}]never said[/quote]`).join('');
    must(await w.fake.startThread('general', w.anaFace, 'Fresh', `${named}${forged}`, faces.slice(0, 3)));
    const rows = await alertsFor(w, w.bo, 'framed');
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.character)).size).toBe(5);
  });
});

describe('a play on a post is not announced on reach', () => {
  test('only a character, a thread or a board play is', async () => {
    const w = world();
    w.fake.seed.card(w.anaFace, w.opener, 'dab', { live: true });
    await flush();
    expect(w.fake.broadcast.log.filter((e) => e.topic === 'reach')).toEqual([]);
  });
});

describe('Updates: the developer persona\'s posts (updates, post_update, 0062)', () => {
  const T0 = Date.parse('2026-11-01T00:00:00Z');
  const H = 3_600_000;
  const gabe = { name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe' };

  function updatesWorld(persona?: typeof gabe) {
    /* The clock is after every update the world seeds, so one posted now is the newest. */
    const fake = createFake({ instance: persona ? { ...instance, developer: persona } : instance, now: () => T0 + 100 * H });
    const admin = fake.seed.account('admin', {});
    fake.seed.admin(admin);
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const cy = fake.seed.account('cy');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const first = fake.seed.update({ title: 'Playtest begins', body: 'Hello.', at: T0 });
    const second = fake.seed.update({ title: 'Traps bite', body: 'The trap was offended.', changes: [{ label: 'Card Collector', text: 'catches more.' }], at: T0 + 2 * H });
    return { fake, admin, ana, bo, cy, anaFace, boFace, first, second };
  }

  test('a page is the updates newest first, each with the persona: the instance\'s, or the engine\'s plain one', async () => {
    const w = updatesWorld(gabe);
    w.fake.signInAs(w.ana);
    const rows = await w.fake.updates();
    expect(rows.map((r) => [r.act, r.title, r.seq])).toEqual([[w.second, 'Traps bite', 2], [w.first, 'Playtest begins', 1]]);
    expect(rows[0]).toMatchObject({ name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe', body: 'The trap was offended.', changes: [{ label: 'Card Collector', text: 'catches more.' }], at: new Date(T0 + 2 * H).toISOString() });
    expect(rows[1]!.changes).toEqual([]);
    const plain = updatesWorld();
    plain.fake.signInAs(plain.ana);
    expect((await plain.fake.updates())[0]).toMatchObject({ name: 'The developers', tagline: '', avatar: null });
    // The persona is a staff character of its own kind, known to be staff, and no player's.
    const [character] = await w.fake.characters([rows[0]!.character]);
    expect(character).toMatchObject({ name: 'Gabe', title: 'Made this. Sorry.', staff: 'developer', office: 'developer' });
  });

  test('a page is bounded and pages back by `before`, exclusive', async () => {
    const w = updatesWorld(gabe);
    for (let i = 0; i < 25; i++) w.fake.seed.update({ title: `Update ${i}`, body: 'x', at: T0 + 10 * H + i * H });
    w.fake.signInAs(w.ana);
    const page = await w.fake.updates();
    expect(page).toHaveLength(20);
    const next = await w.fake.updates(page.at(-1)!.at);
    expect(next).toHaveLength(7);
    expect(next.map((r) => r.act)).not.toContain(page.at(-1)!.act);
    expect((await w.fake.updates(new Date(T0 + 1).toISOString())).map((r) => r.act)).toEqual([w.first]);
  });

  test('the board never lists the updates thread, and counts it nowhere', async () => {
    const w = updatesWorld(gabe);
    w.fake.signInAs(w.ana);
    const system = (await w.fake.boards()).find((b) => b.isSystem)!;
    const before = system.threadCount;
    const rows = await w.fake.updates();
    expect((await w.fake.threads(system.id, { offset: 0, limit: 50 })).threads.map((t) => t.id)).not.toContain(rows[0]!.thread);
    expect(await w.fake.thread(rows[0]!.thread)).toBeNull();
    expect(before).toBe(0);
    // The announcements thread (a Boss's moves) is still the first thread of that board, however the updates came first.
    w.fake.seed.staff('boss', 'The Boss', 'boss');
    w.fake.seed.move('boss', { board: 'general', name: 'Renamed' });
    const after = (await w.fake.boards()).find((b) => b.isSystem)!;
    expect(after.threadCount).toBe(1);
    expect((await w.fake.threads(system.id, { offset: 0, limit: 50 })).total).toBe(1);
  });

  test('only an admin posts one, as the developer; a refusal is in the server\'s words and leaves nothing', async () => {
    const w = updatesWorld(gabe);
    w.fake.signInAs(w.ana);
    expect(await w.fake.postUpdate('Mine', 'A player\'s.', [])).toEqual(refused('only an admin writes an update'));
    w.fake.signOut();
    expect(await w.fake.postUpdate('Visitor', 'x', [])).toEqual(refused('only an admin writes an update'));
    w.fake.signInAs(w.admin);
    const wrote = must(await w.fake.postUpdate('Third', 'Body three.', [{ label: '  Fixed:  ', text: '  the log.  ' }, { label: '', text: ' ' }, { label: '', text: 'no label' }]));
    expect(wrote).toMatchObject({ title: 'Third', body: 'Body three.', name: 'Gabe', seq: 3, changes: [{ label: 'Fixed:', text: 'the log.' }, { label: '', text: 'no label' }] });
    expect((await w.fake.updates())[0]!.act).toBe(wrote.act);
    const act = (await w.fake.act(wrote.act))!;
    expect(act).toMatchObject({ kind: 'update', character: wrote.character, thread: wrote.thread });
    const refusals: [string, string, readonly { label: string; text: string }[], string][] = [
      ['', 'x', [], 'title is empty'],
      ['T', ' ', [], 'body is empty'],
      ['T', 'B', [{ label: 'Orphan', text: ' ' }], 'change 1 has a label and no text; give it a text, or leave the row out'],
      ['T', 'B', [{ label: 'x'.repeat(81), text: 'fine' }], 'change 1 has a label of at most 80 characters'],
      ['T', 'B', [{ label: 'L', text: 'x'.repeat(601) }], 'change 1 has a text of 1 to 600 characters'],
      ['T', 'B', Array.from({ length: 31 }, (_, i) => ({ label: 'L', text: `row ${i}` })), 'an update lists at most 30 changes'],
    ];
    for (const [title, body, changes, error] of refusals) expect(await w.fake.postUpdate(title, body, changes), error).toEqual(refused(error));
    expect(await w.fake.postUpdate('x'.repeat(21), 'B', [])).toEqual(refused('title is longer than 20 characters'));
    expect(await w.fake.postUpdate('T', 'x'.repeat(51), [])).toEqual(refused('body is longer than 50 characters'));
    expect(await w.fake.updates()).toHaveLength(3);
  });

  test('a player reacts to one (the developer has no owner to hold them apart from) and spins a thread from it onto the players\' board', async () => {
    const w = updatesWorld(gabe);
    w.fake.signInAs(w.ana);
    expect(must(await w.fake.react(w.second, w.anaFace, 'fire')).tally).toEqual({ fire: 1 });
    w.fake.signInAs(w.bo);
    expect(must(await w.fake.react(w.second, w.boFace, 'fire')).tally).toEqual({ fire: 2 });
    const spun = must(await w.fake.spin(w.second, w.boFace, 'About the trap', 'Discuss.'));
    expect(spun.thread).toMatchObject({ originActId: w.second, origin: { kind: 'update', act: w.second, title: 'Traps bite' } });
    const board = (await w.fake.boards()).find((b) => b.id === spun.thread.board)!;
    expect(board.isSystem).toBe(false);
    expect((await w.fake.spunFrom(w.second)).map((t) => t.id)).toEqual([spun.thread.id]);
  });

  test('no player acts as the developer', async () => {
    const w = updatesWorld(gabe);
    w.fake.signInAs(w.ana);
    const dev = (await w.fake.updates())[0]!.character;
    const { thread } = w.fake.seed.thread('general', w.anaFace, 'Mine', 'x');
    expect(await w.fake.post(thread, dev, 'As the developer', null)).toEqual(refused('you do not play that character'));
    expect(await w.fake.react(w.second, dev, 'fire')).toEqual(refused('you do not play that character'));
  });

  test('every player has one `update` alert per update, the same for each, whatever else they have', async () => {
    const w = updatesWorld(gabe);
    const read = async (account: string) => { w.fake.signInAs(account); return { rows: await w.fake.alerts(), unread: await w.fake.alertsUnread() }; };
    const ana = await read(w.ana);
    const cy = await read(w.cy); // no character at all
    const bo = await read(w.bo);
    for (const r of [ana, cy, bo]) {
      expect(r.rows.filter((a) => a.kind === 'update')).toHaveLength(2);
      expect(r.unread).toBe(2);
    }
    expect(cy.rows).toEqual(ana.rows);
    expect(bo.rows).toEqual(ana.rows);
    const newest = ana.rows[0]!;
    expect(newest).toEqual({ kind: 'update', sub: null, act: w.second, character: null, at: new Date(T0 + 2 * H).toISOString(), thread: (await w.fake.updates())[0]!.thread, name: 'Gabe', title: 'Traps bite', count: null });
    // The mark moves the count.
    w.fake.signInAs(w.ana);
    must(await w.fake.seeAlerts(new Date(T0 + H).toISOString()));
    expect(await w.fake.alertsUnread()).toBe(1);
    // A new update is an alert for all at once.
    w.fake.signInAs(w.admin);
    must(await w.fake.postUpdate('Fourth', 'Body.', []));
    for (const account of [w.ana, w.cy, w.bo]) { w.fake.signInAs(account); expect((await w.fake.alerts()).filter((a) => a.kind === 'update')).toHaveLength(3); }
  });
});

describe('the staff names', () => {
  test('are public: every debuted staff character by key, a waiting persona left out', async () => {
    const { fake } = world();
    fake.seed.staff('boss', 'The Boss', 'boss');
    fake.seed.staff('later', 'Waiting Persona', 'member', { debuted: false });
    expect((await fake.staffNames()).map((b) => [b.staff, b.name])).toEqual([['boss', 'The Boss']]);
  });
});

describe('the Boss list', () => {
  test('is the database\'s roster: every persona not benched, a waiting one included, the developer and a benched one left out; the queue\'s replace choices are the same list', async () => {
    const { fake } = world();
    fake.seed.staff('boss', 'The Boss', 'boss');
    fake.seed.staff('mod', 'A Mod', 'mod');
    fake.seed.staff('member', 'A Member', 'member');
    fake.seed.staff('later', 'Waiting Persona', 'member', { debuted: false });
    fake.seed.staff('quiet', 'Benched Persona', 'benched');
    await expect(Promise.resolve().then(() => fake.bosses())).rejects.toThrow('only an admin');
    fake.signInAs(fake.seed.account('queue-admin', { admin: true }));
    expect((await fake.bosses()).map((b) => b.staff).sort()).toEqual(['boss', 'later', 'member', 'mod']);
    expect((await fake.bosses()).find((b) => b.staff === 'later')?.name).toBe('Waiting Persona');
    expect((await fake.adminQueue()).roster.map((b) => b.staff).sort()).toEqual(['boss', 'later', 'member', 'mod']);
  });
});

describe('the contact is written as set_admin_contact writes it (0081), with the SQL\'s one whitespace set', () => {
  const adminFake = () => { const w = world(); const root = w.fake.seed.account('root', { admin: true }); w.fake.signInAs(root); return w.fake; };
  const one = (label: string, href: string) => [{ label, href }];
  test('U+00A0, U+0085 and U+FEFF are trimmed at the edges of a label and an address', async () => {
    const fake = adminFake();
    expect(await fake.setAdminContact(one(' \u0085Nb﻿', ' \u0085https://nb.example '))).toEqual({ ok: true, value: [{ label: 'Nb', href: 'https://nb.example' }] });
  });
  test('U+00A0 and U+0085 inside an address are refused as a space or control character, naming the row', async () => {
    const fake = adminFake();
    const words = 'row 1 has an address with no spaces or control characters in it';
    expect(await fake.setAdminContact(one('Nb', 'https://a.example/ b'))).toEqual(refused(words));
    expect(await fake.setAdminContact(one('Nel', 'https://a.example/\u0085b'))).toEqual(refused(words));
  });
  test('a label of only zero-width characters is refused, naming the predicate and the row, and leaves the stored contact alone', async () => {
    const fake = adminFake();
    must(await fake.setAdminContact(one('Keep', 'https://keep.example')));
    const words = 'has a label with something visible in it, not only zero-width characters';
    expect(await fake.setAdminContact(one('​‌‍⁠', 'https://a.example'))).toEqual(refused(`row 1 ${words}`));
    expect(await fake.setAdminContact([...one('Ok', 'https://ok.example'), ...one(' ​﻿', 'https://a.example')])).toEqual(refused(`row 2 ${words}`));
    expect(await fake.adminContact()).toEqual(one('Keep', 'https://keep.example'));
  });
});

describe('a screen in one call is what the separate calls answer', () => {
  /** A long thread (postsPerPage is 2, so many pages), reacted to, spun from, with a reveal and a card on a post. */
  function longWorld() {
    const w = world();
    for (let i = 0; i < 9; i++) w.fake.seed.post(w.thread, i % 2 ? w.anaFace : w.boFace, `reply ${i}`);
    return w;
  }

  test('threadPage of the long thread, by page and by seq, equals the existing calls for the same page', async () => {
    const { fake, thread, anaFace, boFace } = longWorld();
    const page = await fake.threadPage(thread, { page: 2 }, 3, []);
    const summary = await fake.thread(thread);
    const acts = await fake.acts(thread, 4, 6);
    const ids = acts.map((a) => a.id);
    expect(page?.thread).toEqual(summary);
    expect(page?.page).toBe(2);
    expect(page?.acts).toEqual(acts);
    expect(page?.tallies).toEqual(await fake.tallies(ids));
    expect(page?.mine).toEqual(await fake.myReactions(ids));
    expect(page?.reading).toEqual(await fake.reading([thread]));
    expect(page?.board).toEqual(await fake.board(summary!.board));
    expect(page?.following).toBe(await fake.following(thread));
    expect(page?.presence).toEqual(await fake.presenceBox({ kind: 'thread', thread }));
    expect(page?.unread).toBe(await fake.alertsUnread());
    expect(page?.people.map((p) => p.character)).toEqual(await fake.characters([anaFace, boFace].sort()));
    expect(page?.people.map((p) => p.posts)).toEqual(Object.values(await fake.characterStats([anaFace, boFace].sort())).map((x) => x.posts));
    expect(await fake.threadPage(thread, { seq: 4 }, 3, [])).toEqual(page);
    expect(await fake.threadPage(thread, { page: 99 }, 3, [])).toMatchObject({ page: 4 });
    expect(await fake.threadPage('00000000-0000-4000-8000-000000000000', { page: 1 }, 3, [])).toBeNull();
  });

  test('threadPage of a spun thread carries the origin the box used to read in pieces: page 1 only, and null for another page and for a thread that was not spun', async () => {
    const { fake, ana, anaFace, boFace, thread, opener } = world();
    for (let i = 0; i < 3; i++) fake.seed.post(thread, boFace, `reply ${i}`);
    /* A post with 22 plays, the first of them ended by an admin: the box holds the 21 in force (no cap, no more flag), the ended one is only counted, as the database's origin reads it (postPlays). */
    const plays: string[] = [];
    for (let i = 1; i <= 22; i++) { fake.clock.advance(1000); plays.push(fake.seed.card(boFace, opener, 'whoops', { layer: i })); }
    const boss = fake.seed.account('boss', { admin: true });
    fake.signInAs(boss);
    must(await fake.reverseCard(plays[0]!));
    fake.signInAs(ana);
    const spun = must(await fake.spin(opener, anaFace, 'About it', 'b')).thread.id;
    fake.seed.post(spun, anaFace, 'a second post');
    fake.seed.post(spun, anaFace, 'a third post');
    const first = (await fake.threadPage(spun, { page: 1 }, 2, []))!;
    const read = await fake.postPlays([opener]);
    const shown = read.plays.filter((a) => a.kind !== 'card_end');
    expect(first.origin).toEqual({
      act: await fake.act(opener),
      plays: read.plays,
      counts: [{ post: opener, card: 'whoops', all: 22, took: 22 }],
      moment: null,
      at: null,
      cast: await fake.characters([boFace]),
      polls: [], voters: [], votersMore: [], myBallots: [],
    });
    expect(first.origin!.plays.filter((a) => a.kind === 'card')).toHaveLength(21);
    expect(first.origin!.plays.filter((a) => a.kind === 'card_end')).toHaveLength(0);
    expect(first.origin).not.toHaveProperty('more');
    /* Its Act and the plays' arrive in the tallies, as the page's own. */
    expect(first.tallies).toEqual(await fake.tallies([...first.acts.map((a) => a.id), opener, ...shown.map((a) => a.id)]));
    /* Another page of the same thread, and a thread nobody spun, carry none. */
    expect((await fake.threadPage(spun, { page: 2 }, 2, []))!.origin).toBeNull();
    expect((await fake.threadPage(thread, { page: 1 }, 2, []))!.origin).toBeNull();
  });

  test('threadPage\'s origin of a play on a post carries the play\'s moment and the post\'s place; a play on a character spun at a post carries the spin\'s moment and the pressed post\'s place', async () => {
    const { fake, anaFace, boFace, thread } = world();
    const mine = must(await fake.post(thread, anaFace, 'The post pressed.', null));
    fake.clock.advance(1000);
    const onPost = fake.seed.card(boFace, mine.id, 'whoops', { layer: 1 });
    fake.clock.advance(1000);
    const fromPost = (await fake.threadPage(must(await fake.spin(onPost, anaFace, 'About the play', 'b')).thread.id, { page: 1 }, 20, []))!;
    expect(fromPost.origin?.moment).toEqual(await fake.playMoment(onPost));
    expect(fromPost.origin?.moment).not.toBeNull();
    expect(fromPost.origin?.at).toEqual({ thread, seq: mine.seq });
    expect(fromPost.origin?.plays).toEqual([]);
    expect(fromPost.origin?.cast).toEqual(await fake.characters([boFace]));
    fake.clock.advance(1000);
    const onAna = fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine.id });
    fake.clock.advance(1000);
    const spunAt = must(await fake.spin(onAna, anaFace, 'Spun at', 'body', undefined, mine.id));
    const pressed = (await fake.threadPage(spunAt.thread.id, { page: 1 }, 20, []))!;
    expect(pressed.origin?.moment).toEqual(await fake.spinMoment(spunAt.act.id));
    expect(pressed.origin?.moment).not.toBeNull();
    expect(pressed.origin?.at).toEqual({ thread, seq: mine.seq });
    expect(pressed.origin?.cast).toEqual(await fake.characters([anaFace, boFace].sort()));
    /* Spun with no post: the play's own moment, at the cast-from post. */
    const noAt = must(await fake.spin(onAna, anaFace, 'Spun plain', 'body'));
    const plain = (await fake.threadPage(noAt.thread.id, { page: 1 }, 20, []))!;
    expect(plain.origin?.moment).toEqual(await fake.playMoment(onAna));
    expect(plain.origin?.at).toEqual({ thread, seq: mine.seq });
    /* A play on a board has neither. */
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    const onBoard = must(await fake.spin(fake.seed.reach(boFace, 'board', general.id, 'glint'), anaFace, 'Board', 'b'));
    expect((await fake.threadPage(onBoard.thread.id, { page: 1 }, 20, []))!.origin).toMatchObject({ moment: null, at: null });
  });

  test('threadPage with no per_page is the instance\'s own postsPerPage, as the server reads it', async () => {
    const { fake, thread } = longWorld();
    const size = (await fake.settings()).postsPerPage;
    expect(size).toBe(2);
    expect(await fake.threadPage(thread, { page: 2 }, null, [])).toEqual(await fake.threadPage(thread, { page: 2 }, size, []));
  });

  test('presenceBox marks no one present, as here does', async () => {
    const { fake, thread, anaFace } = world();
    expect((await fake.presenceBox({ kind: 'thread', thread })).names).toEqual([]);
    expect((await fake.here({ kind: 'thread', thread }, anaFace)).names.map((n) => n.name)).toEqual(['Ana Face']);
    expect((await fake.presenceBox({ kind: 'thread', thread })).names.map((n) => n.name)).toEqual(['Ana Face']);
  });

  test('boardPage, indexPage, profilePage, recordPage and boot are built of the existing calls\' answers', async () => {
    const { fake, thread, anaFace } = longWorld();
    const boards = await fake.boards();
    const general = boards.find((b) => b.slug === 'general')!;
    const board = await fake.boardPage('general', 1, []);
    expect(board).toMatchObject({ board: await fake.board('general'), total: general.threadCount, page: 1, pins: [], banner: [] });
    expect(board?.threads).toEqual((await fake.threads(general.id, { offset: 0, limit: 20 })).threads);
    expect(board?.views).toEqual(await fake.viewCounts([thread]));
    expect(await fake.boardPage('nowhere', 1, [])).toBeNull();
    const index = await fake.indexPage();
    expect(index.boards).toEqual(boards);
    expect(index.characters).toEqual(await fake.characters(boards.flatMap((b) => (b.lastCharacter ? [b.lastCharacter] : [])).filter((id, i, all) => all.indexOf(id) === i)));
    const profile = await fake.profilePage(anaFace);
    expect(profile).toMatchObject({ counts: await fake.characterCounts(anaFace), standing: await fake.standingPlace(anaFace), settledAt: await fake.lastSettledAt(), season: await fake.season() });
    expect(profile?.character).toEqual((await fake.characters([anaFace]))[0]);
    expect(profile?.acts).toEqual(await fake.characterActs(anaFace, ['post', 'spin', 'card'], { offset: 0, limit: 5 }));
    expect(await fake.profilePage('00000000-0000-4000-8000-000000000000')).toBeNull();
    const record = await fake.recordPage(anaFace, 'post', 2);
    expect(record).toMatchObject({ kind: 'post', page: 2, windowFrom: 20, acts: await fake.characterActs(anaFace, ['post'], { offset: 20, limit: 20 }), counts: await fake.characterCounts(anaFace) });
    expect((await fake.recordPage(anaFace, 'nonsense' as never, 0))).toMatchObject({ kind: 'all', page: 1, windowFrom: 0 });
    const boot = await fake.boot();
    expect(boot).toMatchObject({ settings: await fake.settings(), preferences: await fake.preferences(), characters: await fake.myCharacters(), wallet: await fake.wallet(), boards, unread: await fake.alertsUnread() });
    expect(boot.faces.map((f) => f.name)).toEqual(['Ana Face', 'Ana Heel']);
  });

  test('logPage of the demo player is the log and what useLog reads around it', async () => {
    const { fake, anaFace, anaHeel, boFace, opener } = world();
    fake.seed.settle({ ledger: [{ character: anaFace, reason: 'face.cheered', amount: 30, shares: [{ act: opener, quadrant: 'excitedPositive', amount: 30 }] }, { character: anaHeel, reason: 'heel.shrugged', amount: -5 }], standings: { [anaFace]: 300 } });
    const page = await fake.logPage(null);
    const log = await fake.log();
    expect(page.log).toEqual(log);
    expect(page.log.settlements).toHaveLength(1);
    /* What useLog's `around` computes from the same log: the own state, then the Acts the lines name and the ones those lead to. */
    const characters = await fake.myCharacters();
    const ids = characters.map((c) => c.id);
    expect(page.standings).toEqual(await fake.standingAmounts(ids));
    expect(page.season).toEqual(await fake.season());
    const turns = (await fake.turnsAnnounced(ids)).filter((t) => characters.some((c) => c.id === t.character && Date.parse(c.classSince) === Date.parse(t.at)));
    expect(page.turns).toEqual(await fake.turnsAnnounced(ids));
    const acts = new Map((await fake.actsById(actsNamed(log, null, turns))).map((a) => [a.id, a]));
    for (let round = 0; round < 2; round++) for (const a of await fake.actsById(actsFollowed(acts))) acts.set(a.id, a);
    expect(page.acts).toEqual([...acts.values()]);
    expect(page.acts.map((a) => a.id)).toContain(opener);
    expect(page.people).toEqual(await fake.characters([boFace]));
    expect(page.states).toEqual(await fake.effectStates([...new Set(log.saves.map((x) => x.play))]));
    expect(page.threads).toEqual([]);
    expect(page.boards).toEqual([]);
    /* An older cursor is the log from there. */
    expect((await fake.logPage(log.before ?? '2000-01-01T00:00:00.000Z')).log).toEqual(await fake.log(log.before ?? '2000-01-01T00:00:00.000Z'));
  });

  test('the glass pages are built of the existing calls\' answers', async () => {
    const { fake, anaFace, anaHeel, boFace } = world();
    fake.seed.settle({ standings: { [anaFace]: 300, [boFace]: 500 } });
    const mine = await fake.myCharacters();
    const characters = await fake.myCharactersPage();
    expect(characters.characters).toEqual(mine);
    expect(characters.faces).toEqual(await fake.characters([anaFace, anaHeel].sort((a, b) => mine.findIndex((c) => c.id === a) - mine.findIndex((c) => c.id === b))));
    expect(characters.counts[anaFace]).toEqual(await fake.characterCounts(anaFace));
    expect(characters.standings).toEqual(await fake.standingAmounts(mine.map((c) => c.id)));
    expect(characters.nextSettlementAt).toEqual(await fake.nextSettlementAt());

    const news = await fake.seasonPage('news', null, null, null);
    expect(news).toEqual({ tab: 'news', season: await fake.season(), news: await fake.seasonNews(null) });
    const standings = await fake.seasonPage(null, null, null, null);
    expect(standings).toMatchObject({ tab: 'standings', page: 1, standings: await fake.standingsPage(0, 50), size: await fake.standingsCount(), finished: await fake.finishedSeasons() });
    expect(await fake.seasonPage(null, 99, null, null)).toBeNull();

    const alerts = await fake.alertsPage(null);
    expect(alerts).toMatchObject({ alerts: await fake.alerts(null), seenAt: (await fake.preferences()).alertsSeenAt, openedAt: await fake.accountOpenedAt() });
    const updates = await fake.updatesPage(null, null, null);
    expect(updates).toMatchObject({ updates: await fake.updates(null), tallies: {}, mine: [] });
    expect('queue' in updates).toBe(false);
    expect(await fake.queuePage()).toBeNull();
  });

  test('alertsPage carries the Acts, people, openings and reading its rows name', async () => {
    const { fake, ana, bo, anaFace, boFace, thread, opener } = world();
    fake.signInAs(bo);
    await fake.follow(thread, true);
    fake.signInAs(ana);
    const reply = must(await fake.post(thread, anaFace, 'a reply', opener));
    fake.signInAs(bo);
    const page = await fake.alertsPage(null);
    expect(page.alerts).toEqual(await fake.alerts(null));
    expect(page.alerts.length).toBeGreaterThan(0);
    const named = page.alerts.flatMap((a) => (a.act === null ? [] : [a.act]));
    expect(named).toContain(reply.id);
    expect(page.acts.map((a) => a.id)).toEqual(expect.arrayContaining(named));
    expect(page.people).toEqual(await fake.characters([...new Set(page.acts.flatMap((a) => (a.character === null ? [] : [a.character])))]));
    expect(page.people.map((c) => c.id)).toContain(anaFace);
    const followed = [...new Set(page.alerts.flatMap((a) => (a.thread === null ? [] : [a.thread])))];
    expect(page.openings).toEqual(await fake.openingActs(followed));
    expect(page.reading).toEqual(await fake.reading(followed));
    expect(boFace).toBeTruthy();
  });

  test('updatesPage opens the newest update when the one asked for is not on the page, as the server does', async () => {
    const { fake, ana, anaFace } = world();
    fake.seed.admin(ana);
    fake.signInAs(ana);
    const update = must(await fake.postUpdate('Traps bite', 'Two fixes.', []));
    must(await fake.react(update.act, anaFace, 'fire'));
    const newest = await fake.updatesPage(null, null, null);
    expect(Object.keys(newest.tallies)).toEqual([update.act]);
    expect(await fake.updatesPage('00000000-0000-4000-8000-000000000000', null, null)).toEqual(newest);
  });

  test('queuePage and updatesPage carry an admin\'s queue, and only an admin\'s', async () => {
    const { fake, ana } = world();
    fake.seed.admin(ana);
    const queue = await fake.queuePage();
    expect(queue).toEqual({ queue: await fake.adminQueue(), boardNames: await fake.boardNames(), bosses: await fake.bosses(), contact: await fake.adminContact() });
    expect(await fake.updatesPage(null, null, 3)).toMatchObject({ queue: await fake.adminQueue() });
    expect('queue' in (await fake.updatesPage(null, null, null))).toBe(false);
    const other = world();
    expect('queue' in (await other.fake.updatesPage(null, null, 3))).toBe(false);
  });
});


describe('a card that writes: its tails, as post_tails and the worker leave them (0149)', () => {
  const typewriter = {
    key: 'typewriter', name: 'Typewriter', alignment: 'salty' as const, rarity: 'common' as const, stack: 3, playPrice: () => 0,
    canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
    writes: { sampling: { temperature: 0.9, topP: 0.95 }, tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) },
  };
  const plain = { ...typewriter, key: 'plain', name: 'Plain', writes: undefined };
  const own: Instance = { ...instance, cards: [typewriter, plain] };
  function world() {
    const fake = createFake({ instance: own });
    const ana = fake.seed.account('ana');
    const face = fake.seed.character(ana, 'Ana Face', 'face');
    const { thread, act: post } = fake.seed.thread('general', face, 'Hello', 'First post');
    fake.signInAs(ana);
    return { fake, face, thread, post };
  }

  test('a play of a writing card waits at the post\'s version, a play of any other card has no row, and the text ends the wait in a row of its own', async () => {
    const { fake, face, post } = world();
    const first = fake.seed.card(face, post, 'typewriter');
    fake.seed.card(face, post, 'plain');
    expect(await fake.tails([post])).toEqual([{ post, play: first, version: post, text: null, failed: false, waiting: true, createdAt: null }]);
    fake.seed.text(first, post, { text: ' and on' }, { quiet: true });
    expect(await fake.tails([post])).toEqual([{ post, play: first, version: post, text: ' and on', failed: false, waiting: false, createdAt: expect.any(String) }]);
  });

  test('an edit queues each live writing play again at the edit, and the rows come oldest version first, then by play', async () => {
    const { fake, face, post } = world();
    const first = fake.seed.card(face, post, 'typewriter');
    const second = fake.seed.card(face, post, 'typewriter');
    fake.seed.text(first, post, { text: 'a' }, { quiet: true });
    fake.seed.text(second, post, { failed: true }, { quiet: true });
    fake.clock.advance(60_000);
    expect((await fake.edit(post, face, 'Edited post')).ok).toBe(true);
    const [, edit] = (await fake.history(post)).map((v) => v.id);
    const rows = await fake.tails([post]);
    /* The second play's first generation failed, so it was refunded and is over: the edit queues nothing for it. */
    expect(rows.map((r) => [r.play, r.version, r.failed, r.waiting])).toEqual([[first, post, false, false], [second, post, true, false], [first, edit, false, true]]);
  });

  test('a first generation that fails refunds the play: its Act reads untaken, nothing waits for it, and an edit queues nothing; a failed regeneration of a play that made a text does not', async () => {
    const { fake, face, post } = world();
    const kept = fake.seed.card(face, post, 'typewriter');
    const lost = fake.seed.card(face, post, 'typewriter');
    fake.seed.text(kept, post, { text: 'a' }, { quiet: true });
    fake.seed.text(lost, post, { failed: true }, { quiet: true });
    const acts = (await fake.postPlays([post])).plays;
    expect(acts.filter((a) => a.kind === 'card').map((a) => [a.id, a.untaken])).toEqual([[kept, undefined], [lost, true]]);
    /* A play that did not take counts as a play and not as one that took. */
    expect((await fake.postPlays([post])).counts).toEqual([{ post, card: 'typewriter', all: 2, took: 1 }]);
    fake.clock.advance(60_000);
    expect((await fake.edit(post, face, 'Edited post')).ok).toBe(true);
    const edit = (await fake.history(post)).map((v) => v.id)[1]!;
    expect((await fake.tails([post])).map((r) => [r.play, r.version, r.failed, r.waiting])).toEqual([[kept, post, false, false], [lost, post, true, false], [kept, edit, false, true]]);
    /* A regeneration that fails, for a play that made a text, is not a refund. */
    fake.seed.text(kept, edit, { failed: true }, { quiet: true });
    expect((await fake.postPlays([post])).plays.find((a) => a.id === kept)?.untaken).toBeUndefined();
    /* A late text for a play that is over writes nothing. */
    fake.seed.text(lost, post, { text: 'too late' }, { quiet: true });
    expect((await fake.tails([post])).some((r) => r.play === lost && r.text !== null)).toBe(false);
  });

  test('a play that did not take is refused in plain words, not as an admin\'s end', async () => {
    const { fake, face, post } = world();
    const lost = fake.seed.card(face, post, 'typewriter');
    fake.seed.text(lost, post, { failed: true }, { quiet: true });
    fake.seed.admin(fake.seed.account('boss'));
    const plain = 'That card didn\'t take, so there is nothing of it on this post.';
    expect(await fake.releaseEffect(lost)).toEqual({ ok: false, error: plain });
    expect(await fake.saveEffect(lost, face, {})).toEqual({ ok: false, error: plain });
  });

  test('card_text carries the play and the version and nothing else, to the thread that holds the play', async () => {
    const { fake, face, thread, post } = world();
    const play = fake.seed.card(face, post, 'typewriter');
    const heard = vi.fn();
    fake.subscribeThread(thread, { onText: heard });
    fake.seed.text(play, post, { text: 'x' });
    await Promise.resolve();
    expect(heard).toHaveBeenCalledWith(play, post);
    expect(fake.broadcast.log.at(-1)).toEqual({ topic: `thread:${thread}`, event: 'card_text' });
  });

  test('the author\'s log holds each text and failure on a post of theirs, first rows told from later ones, and no one else\'s', async () => {
    const { fake, face, post } = world();
    const bo = fake.seed.account('bo');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { act: boPost } = fake.seed.thread('general', boFace, 'Bo opens', 'Bo\'s post');
    const first = fake.seed.card(boFace, post, 'typewriter');
    const second = fake.seed.card(boFace, post, 'typewriter');
    const ofBo = fake.seed.card(face, boPost, 'typewriter');
    fake.seed.text(first, post, { text: 'a' }, { quiet: true });
    fake.seed.text(second, post, { failed: true }, { quiet: true });
    fake.seed.text(ofBo, boPost, { text: 'b' }, { quiet: true });
    fake.clock.advance(60_000);
    expect((await fake.edit(post, face, 'Edited post')).ok).toBe(true);
    const [, edit] = (await fake.history(post)).map((v) => v.id);
    fake.seed.text(first, edit!, { text: 'c' }, { quiet: true });
    const mine = (await fake.log()).writes;
    /* Newest first; the author's own rows alone, whoever played the card; the first row of a play is its opening. */
    expect(mine.map((w) => [w.play, w.post, w.version, w.failed, w.opening])).toEqual([[first, post, edit, false, false], [second, post, post, true, true], [first, post, post, false, true]]);
    fake.signInAs(bo);
    expect((await fake.log()).writes.map((w) => [w.play, w.post, w.opening])).toEqual([[ofBo, boPost, true]]);
    fake.signInAs(null);
    expect((await fake.log()).writes).toEqual([]);
  });

  test('more than 200 posts are refused as the server refuses them', async () => {
    const { fake } = world();
    await expect(Promise.resolve().then(() => fake.tails(Array.from({ length: 201 }, (_, i) => `p${i}`)))).rejects.toThrow('at most 200');
  });
});

describe('the fake gives every character it shows the instance\'s face for it', () => {
  test('a staff character is shown through `face`, and a player is shown as it is', async () => {
    const fake = createFake({ instance, face: (c) => (c.staff === 'pictured' ? { ...c, avatarSquare: '/pictured.webp' } : c) });
    const staffId = fake.seed.staff('pictured', 'Pictured', 'boss');
    const plain = fake.seed.staff('plain', 'Plain', 'mod');
    expect((await fake.characters([staffId]))[0]?.avatarSquare).toBe('/pictured.webp');
    expect((await fake.characters([plain]))[0]?.avatarSquare).toBeNull();
  });
});

/* ---- gear, trophies and Random Events (cosmetics Task 6): the fake holds what set_outfit, show_trophies, trophies_of and random_event hold, in their words ---- */
describe('gear, trophies and Random Events', () => {
  const dressed: Instance = {
    ...instance,
    gear: [
      { key: 'hat', name: 'Hat', line: 'A hat.', rarity: 'common' }, { key: 'mustache', name: 'Mustache', line: 'A mustache.', rarity: 'rare' },
      { key: 'monocle', name: 'Monocle', line: 'A monocle.', rarity: 'common' },
    ],
    trophies: { kinds: [{ key: 'p1', name: 'First' }, { key: 'belt', name: 'The Belt', belt: true }, { key: 'pet', name: 'Pet' }, { key: 'p2', name: 'P2' }, { key: 'p3', name: 'P3' }, { key: 'met', name: 'Met' }], seasonPlaces: ['p1', 'p2', 'p3'], boss: ['belt', 'pet'], demandMet: 'met' },
    events: { lines: [{ key: 'nothing', outcome: 'line', text: 'Nothing happens.' }, { key: 'found', outcome: 'gear', text: 'You find {item}.' }] },
    settings: { ...settings, cosmetics: { ...settings.cosmetics, gear: { wornMost: 2, reach: 0.4 }, trophies: { shownMost: 2 }, events: { ...settings.cosmetics.events, windowMinutes: 15, dayMost: 2 } } },
  };
  const piece = (gear: string, layer: number) => ({ gear, x: 0.5, y: 0.5, w: 0.4, turn: 0, layer });
  function dressing() {
    const fake = createFake({ instance: dressed });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const a1 = fake.seed.character(ana, 'Ana One', 'face');
    const a2 = fake.seed.character(ana, 'Ana Two', 'heel');
    const b1 = fake.seed.character(bo, 'Bo One', 'face');
    fake.seed.gear(ana, { hat: 1, mustache: 2, monocle: 1 });
    fake.signInAs(ana);
    return { fake, ana, bo, a1, a2, b1 };
  }

  test('an outfit worn shows on the public character, in layer order, and the wardrobe says where each copy is', async () => {
    const { fake, a1, a2 } = dressing();
    expect(must(await fake.setOutfit(a1, [piece('mustache', 1), piece('hat', 0)]))).toEqual({ worn: 2 });
    expect((await fake.characters([a1]))[0]!.outfit.map((p) => p.gear)).toEqual(['hat', 'mustache']);
    expect(must(await fake.wardrobe())).toEqual([
      { gear: 'hat', rarity: 'common', held: 1, wornBy: [a1] }, { gear: 'monocle', rarity: 'common', held: 1, wornBy: [] }, { gear: 'mustache', rarity: 'rare', held: 2, wornBy: [a1] },
    ]);
    // The whole outfit replaces the one before; the other mask, with none of the hat free, is refused in the engine's words.
    expect((await fake.setOutfit(a2, [piece('hat', 0)]))).toEqual(refused('"hat" is worn 1 time here, and 0 copies are free'));
    expect(must(await fake.setOutfit(a1, [piece('monocle', 0)]))).toEqual({ worn: 1 });
    expect(must(await fake.setOutfit(a2, [piece('hat', 0)]))).toEqual({ worn: 1 });
  });

  test('a piece over the worn limit, a shared layer, a bad bound and an unknown gear are refused in the server\'s words', async () => {
    const { fake, a1 } = dressing();
    expect(await fake.setOutfit(a1, [piece('hat', 0), piece('mustache', 1), piece('monocle', 2)])).toEqual(refused('3 pieces are worn; at most 2'));
    expect(await fake.setOutfit(a1, [piece('hat', 0), piece('mustache', 0)])).toEqual(refused('"mustache" shares layer 0 with "hat"'));
    expect(await fake.setOutfit(a1, [{ ...piece('hat', 0), w: 2 }])).toEqual(refused('a piece\'s width is from 0.05 to 1.5 of the portrait\'s width'));
    expect(await fake.setOutfit(a1, [piece('hat', 2)])).toEqual(refused('a piece\'s layer is a whole number below 2'));
    expect(await fake.setOutfit(a1, [piece('fez', 0)])).toEqual(refused('there is no gear "fez"'));
    expect(await fake.setOutfit(a1, [piece('mustache', 0), piece('mustache', 1)])).toEqual({ ok: true, value: { worn: 2 } });
    expect((await fake.characters([a1]))[0]!.outfit).toHaveLength(2);
  });

  test('a character the player does not play is refused, and a new portrait takes the outfit off', async () => {
    const { fake, a1, b1 } = dressing();
    expect(await fake.setOutfit(b1, [])).toEqual(refused('you do not play that character'));
    expect(await fake.showTrophies(b1, [])).toEqual(refused('you do not play that character'));
    expect(await fake.randomEvent(b1)).toEqual(refused('you do not play that character'));
    fake.signInAs(null);
    expect(await fake.wardrobe()).toEqual(refused('sign in to dress a character'));
    fake.signInAs(fake.seed.account('cy'));
    expect(must(await fake.wardrobe())).toEqual([]);
  });

  test('trophies show in the order the player chose, then the belts held; a reversal takes one off at once; a belt passes to the latest award', async () => {
    const { fake, ana, a1, b1 } = dressing();
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    const first = fake.seed.award(a1, 'p1', { at: t0 });
    const pet = fake.seed.award(a1, 'pet', { at: t0 + 1000, by: 'boss' });
    fake.seed.award(a1, 'belt', { at: t0 + 2000, by: 'boss' });
    expect((await fake.characters([a1]))[0]!.trophies.map((t) => [t.name, t.held])).toEqual([['The Belt', true]]);
    expect(must(await fake.showTrophies(a1, [pet, first]))).toEqual({ shown: 2 });
    expect((await fake.characters([a1]))[0]!.trophies.map((t) => t.name)).toEqual(['Pet', 'First', 'The Belt']);
    expect(await fake.showTrophies(a1, [pet, first, pet])).toEqual(refused('3 trophies are shown; at most 2'));
    expect(await fake.showTrophies(a1, [pet, pet])).toEqual(refused('a trophy is shown once'));
    expect(await fake.showTrophies(a1, [fake.seed.award(b1, 'p2')])).toEqual(refused('that trophy is not this character\'s'));
    // The belt goes to Bo One with a later award; it leaves Ana One's shelf, and the lineage names both reigns.
    fake.seed.award(b1, 'belt', { at: t0 + 3000 });
    expect((await fake.characters([a1]))[0]!.trophies.map((t) => t.name)).toEqual(['Pet', 'First']);
    expect(must(await fake.beltLineage('belt')).reigns.map((r) => [r.name, r.ended !== null, r.by])).toEqual([['Bo One', false, 'the season'], ['Ana One', true, 'the Boss']]);
    expect(await fake.beltLineage('pet')).toEqual(refused('"pet" is not a belt'));
    expect(await fake.beltLineage('nope')).toEqual(refused('there is no trophy "nope"'));
    // A page is newest first; an admin's reversal takes an award off the page and out of the shown set.
    fake.seed.admin(ana);
    expect((await fake.trophies(a1)).awards.map((t) => t.name)).toEqual(['The Belt', 'Pet', 'First']);
    expect(must(await fake.reverseAward(pet))).toEqual({ reversed: pet });
    expect(await fake.reverseAward(pet)).toEqual(refused('that trophy was already taken back'));
    expect((await fake.characters([a1]))[0]!.trophies.map((t) => t.name)).toEqual(['First']);
    expect(await fake.showTrophies(a1, [pet])).toEqual(refused('that trophy has been taken back'));
    expect((await fake.trophies(a1)).awards.map((t) => t.name)).toEqual(['The Belt', 'First']);
  });

  test('an award names its move and says whether it is shown; a belt\'s reigns page newest first from a cursor', async () => {
    const { fake, a1, b1 } = dressing();
    fake.seed.staff('s-boss', 'Boss Staff', 'boss');
    const move = fake.seed.trophyMove('s-boss', { character: a1, trophy: 'pet' });
    const t0 = Date.parse('2026-10-01T00:00:00Z');
    const pet = fake.seed.award(a1, 'pet', { at: t0, by: 'boss', move });
    fake.seed.award(a1, 'p1', { at: t0 + 1000, by: 'season' });
    fake.seed.award(a1, 'p2', { at: t0 + 2000, by: 'admin' });
    must(await fake.showTrophies(a1, [pet]));
    const items = (await fake.trophies(a1)).awards;
    expect(items.map((t) => [t.name, t.move !== null, t.season, t.shown])).toEqual([['P2', false, null, false], ['First', false, 1, false], ['Pet', true, null, true]]);
    expect(items[2]!.move).toMatchObject({ act: move });
    expect(items[2]!.move!.seq).toBeGreaterThan(0);
    expect(items[2]!.by).toBe('Boss Staff, the Boss');
    for (let i = 0; i < 25; i++) fake.seed.award(i % 2 ? a1 : b1, 'belt', { at: t0 + 10_000 + i * 1000, by: 'admin' });
    const first = must(await fake.beltLineage('belt'));
    expect(first.reigns).toHaveLength(20);
    expect(first.more).toBe(true);
    expect(first.reigns[0]).toMatchObject({ ended: null, by: 'an admin' });
    const last = first.reigns[19]!;
    const rest = must(await fake.beltLineage('belt', { before: last.began, beforeId: last.award }));
    expect(rest.reigns).toHaveLength(5);
    expect(rest.more).toBe(false);
    expect(rest.reigns[0]!.ended).toBe(last.began);
  });

  test('reigns that began at the same moment are neither skipped nor repeated across a page edge', async () => {
    const { fake, a1, b1 } = dressing();
    const at = Date.parse('2026-10-01T00:00:00Z');
    const ids = Array.from({ length: 22 }, (_, i) => fake.seed.award(i % 2 ? a1 : b1, 'belt', { at, by: 'admin' }));
    const first = must(await fake.beltLineage('belt'));
    const last = first.reigns[first.reigns.length - 1]!;
    expect(first.reigns).toHaveLength(20);
    expect(first.more).toBe(true);
    const rest = must(await fake.beltLineage('belt', { before: last.began, beforeId: last.award }));
    expect(rest.more).toBe(false);
    expect([...first.reigns, ...rest.reigns].map((r) => r.award).sort()).toEqual([...ids].sort());
  });

  test('an admin\'s hand is an admin\'s alone; a player is refused in only_admins\'s words', async () => {
    const { fake, ana, a1 } = dressing();
    expect(await fake.grantGear(a1, 'hat', 1)).toEqual(refused('only an admin grants gear'));
    expect(await fake.awardTrophy('pet', a1)).toEqual(refused('only an admin gives a trophy'));
    expect(await fake.reverseAward('x')).toEqual(refused('only an admin takes a trophy back'));
    expect(await fake.makeTrophy('Mine', null, null, false)).toEqual(refused('only an admin makes a trophy'));
    fake.seed.admin(ana);
    expect(must(await fake.grantGear(a1, 'hat', 2))).toEqual({ granted: 2 });
    expect(await fake.grantGear(a1, 'hat', 0)).toEqual(refused('a grant is 1 to 100 copies'));
    expect(must(await fake.wardrobe()).find((w) => w.gear === 'hat')?.held).toBe(3);
    const made = must(await fake.makeTrophy('  Mine ', 'Made by hand.', null, true)).trophy;
    expect(made).toMatch(/^made-/);
    const award = must(await fake.awardTrophy(made, a1, '  Well done '));
    expect((await fake.trophies(a1)).awards).toMatchObject([{ award: award.award, name: 'Mine', belt: true, held: true, line: 'Well done', by: 'an admin' }]);
    expect(await fake.awardTrophy('pet', a1, 'x'.repeat(201))).toEqual(refused('a trophy\'s words are at most 200 characters'));
  });

  test('failed awards: unresolved first and paged, a hand give is recorded once, and what the failure was not for is refused, as give_failed_award does', async () => {
    const { fake, ana, a1, a2, b1 } = dressing();
    expect(await fake.trophyAwardFailures()).toEqual(refused('only an admin reads the trophies that could not be given'));
    expect(await fake.giveFailedAward('x', a1)).toEqual(refused('only an admin gives an award that could not be written'));
    fake.seed.admin(ana);
    const move = fake.seed.awardFailure({ move: 'm1', season: null, at: '2026-10-01T00:00:00.000Z', error: 'm', trophy: 'met', characters: [{ id: a1, name: 'Ana One' }, { id: b1, name: 'Bo One' }] });
    const season = fake.seed.awardFailure({ move: null, season: 1, at: '2026-10-02T00:00:00.000Z', error: 's', trophy: null, characters: [{ id: a2, name: 'Ana Two', place: 2 }] });
    const unread = fake.seed.awardFailure({ move: 'm2', season: null, at: '2026-10-03T00:00:00.000Z', error: 'u', trophy: 'met', characters: null });
    expect(must(await fake.trophyAwardFailures()).failures.map((f) => [f.id, f.open])).toEqual([[unread, true], [season, true], [move, true]]);
    expect(must(await fake.trophyAwardFailures()).failures[2]!.characters!.map((c) => c.given)).toEqual([false, false]);
    const award = must(await fake.giveFailedAward(move, a1));
    expect((await fake.trophies(a1)).awards).toMatchObject([{ award: award.award, trophy: 'met', by: 'an admin' }]);
    expect(await fake.giveFailedAward(move, a1)).toEqual(refused('that award was already given to that character'));
    expect((await fake.trophies(a1)).awards).toHaveLength(1);
    expect(must(await fake.trophyAwardFailures()).failures.find((f) => f.id === move)).toMatchObject({ open: true, characters: [{ id: a1, given: true }, { id: b1, given: false }] });
    expect(await fake.giveFailedAward(move, a2)).toEqual(refused('that character was not one the failed award was for'));
    expect(await fake.giveFailedAward(unread, a1)).toEqual(refused('the characters that award was for cannot be read now; give it from Award a trophy'));
    expect(await fake.giveFailedAward('nope', a1)).toEqual(refused('there is no such failed award'));
    // A season's failure gives the place's own kind; once every character has had theirs the failure is closed and goes behind the open ones.
    must(await fake.giveFailedAward(season, a2));
    expect((await fake.trophies(a2)).awards).toMatchObject([{ trophy: 'p2' }]);
    must(await fake.giveFailedAward(move, b1));
    expect(must(await fake.trophyAwardFailures()).failures.map((f) => [f.id, f.open])).toEqual([[unread, true], [season, false], [move, false]].sort((x, y) => Number(y[1]) - Number(x[1])));
    // Paged: the cursor is the last row's instant, id and open.
    for (let i = 0; i < 52; i += 1) fake.seed.awardFailure({ move: null, season: 2 + i, at: new Date(Date.parse('2026-09-01T00:00:00Z') + i * 60_000).toISOString(), error: `e${i}`, trophy: null, characters: [{ id: a1, name: 'Ana One', place: 1 }] });
    const first = must(await fake.trophyAwardFailures());
    expect(first.failures).toHaveLength(50);
    expect(first.more).toBe(true);
    const last = first.failures.at(-1)!;
    const rest = must(await fake.trophyAwardFailures({ before: last.at, beforeId: last.id, beforeOpen: last.open }));
    expect(rest.failures).toHaveLength(5);
    expect(rest.more).toBe(false);
    expect(new Set([...first.failures, ...rest.failures].map((f) => f.id)).size).toBe(55);
    expect(rest.failures.slice(-2).map((f) => f.open)).toEqual([false, false]);
  });

  test('the wardrobe lists a character once for each piece of a gear it wears, as my_wardrobe does', async () => {
    const { fake, a1 } = dressing();
    must(await fake.setOutfit(a1, [piece('mustache', 0), piece('mustache', 1)]));
    expect(must(await fake.wardrobe()).find((w) => w.gear === 'mustache')?.wornBy).toEqual([a1, a1]);
  });

  test('the Boss who gave a trophy is named as the SQL names it, by the Boss character, and plainly where none stands', async () => {
    const { fake, a1 } = dressing();
    fake.seed.award(a1, 'pet', { by: 'boss' });
    expect((await fake.trophies(a1)).awards[0]!.by).toBe('the Boss');
    fake.seed.staff('boss1', 'Sighbot', 'boss', { debuted: true });
    expect((await fake.trophies(a1)).awards[0]!.by).toBe('Sighbot, the Boss');
  });

  test('a Random Event comes once a window and at most dayMost a day, from the scripted outcome, and a found gear is held at once', async () => {
    const { fake, a1 } = dressing();
    fake.seed.nextEvent({ outcome: 'gear', item: 'mustache', line: 'found' });
    expect(must(await fake.randomEvent(a1))).toMatchObject({ outcome: 'gear', item: 'mustache', rarity: 'rare', line: 'You find {item}.', lineKey: 'found', character: a1 });
    expect(must(await fake.wardrobe()).find((w) => w.gear === 'mustache')?.held).toBe(3);
    // Inside the window: nothing, and nothing is used up.
    fake.seed.nextEvent({ outcome: 'line', line: 'nothing' });
    expect(must(await fake.randomEvent(a1))).toBeNull();
    fake.clock.advance(16 * MINUTE);
    expect(must(await fake.randomEvent(a1))).toMatchObject({ outcome: 'line', line: 'Nothing happens.', lineKey: 'nothing', item: null });
    // The day's most is 2.
    fake.clock.advance(16 * MINUTE);
    fake.seed.nextEvent({ outcome: 'line', line: 'nothing' });
    expect(must(await fake.randomEvent(a1))).toBeNull();
    fake.clock.advance(DAY);
    expect(must(await fake.randomEvent(a1))).toMatchObject({ outcome: 'line' });
  });

  test('a scripted roll that finds nothing answers null, an unscripted one finds nothing until a world turns the odds on, and then draws from the settings\' own odds', async () => {
    const { fake, a1 } = dressing();
    fake.seed.nextEvent(null);
    expect(must(await fake.randomEvent(a1))).toBeNull();
    fake.clock.advance(16 * MINUTE);
    for (let i = 0; i < 20; i++) { expect(must(await fake.randomEvent(a1))).toBeNull(); fake.clock.advance(16 * MINUTE); }
    fake.seed.eventsOn();
    const drawn = must(await fake.randomEvent(a1));
    expect(drawn === null || ['line', 'gear', 'card'].includes(drawn.outcome)).toBe(true);
  });
});

describe('a drive and its gifts, refused and split as the database does', () => {
  /* A drive card: gifts of 0.10 and 0.25, of which The System keeps 20 percent, rounded up; a drive lasts 7 days from its latest play. */
  const appeal = {
    key: 'appeal', name: 'Appeal', alignment: 'sweet' as const, rarity: 'uncommon' as const, stack: 3,
    drive: { lasts: { unit: 'day' as const, count: 7 }, gifts: ['driveGift1', 'driveGift2'], overhead: 'driveOverhead' },
    playPrice: () => 0, validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
    canApply: () => ({ ok: true as const, value: undefined }),
  };
  const drives: Instance = { ...instance, cards: [appeal], settings: { ...settings, economy: { driveGift1: 10, driveGift2: 25, driveOverhead: 20 } } };
  function driveWorld(wallet = 100) {
    const fake = createFake({ instance: drives });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    const drive = fake.seed.card(boFace, opener, 'appeal');
    fake.seed.wallet(ana, wallet);
    fake.seed.wallet(bo, 0);
    fake.signInAs(ana);
    return { fake, ana, bo, anaFace, boFace, thread, opener, drive };
  }
  const walletOf = async (fake: ReturnType<typeof driveWorld>['fake'], who: string) => { fake.signInAs(who); return (await fake.wallet()).balance; };

  test('a gift takes the amount from the giver, sends the rest to the post\'s author, and answers with the Act and the giver\'s balance', async () => {
    const { fake, ana, bo, anaFace, thread, drive } = driveWorld();
    const given = must(await fake.donate(anaFace, drive, 25));
    expect(given.balance).toBe(75);
    expect(given.act).toMatchObject({ kind: 'donation', character: anaFace, thread, targetActId: drive, seq: null, payload: { amount: 25, overhead: 5, arrives: 20 } });
    expect(await walletOf(fake, ana)).toBe(75);
    expect(await walletOf(fake, bo)).toBe(20);
    expect((await fake.log()).wallet[0]).toMatchObject({ kind: 'gift_in', change: 20, ref: given.act.id });
    fake.signInAs(ana);
    expect((await fake.log()).wallet[0]).toMatchObject({ kind: 'gift_out', change: -25, balanceAfter: 75, ref: given.act.id });
    expect(must(await fake.donate(anaFace, drive, 10)).act.payload).toMatchObject({ amount: 10, overhead: 2, arrives: 8 });
  });

  test('a gift is heard live as a gift by the drive post\'s author, and not by the giver, whose own other mask\'s drive tells no one', async () => {
    const { fake, ana, bo, anaFace, boFace, thread, drive } = driveWorld();
    const heard = { bo: [] as { kind: string; sub: string | null; character: string | null }[], ana: [] as { kind: string; sub: string | null; character: string | null }[] };
    fake.signInAs(bo);
    fake.subscribeAccount({ onAlert: (a) => heard.bo.push(a) });
    fake.signInAs(ana);
    fake.subscribeAccount({ onAlert: (a) => heard.ana.push(a) });
    const given = must(await fake.donate(anaFace, drive, 10));
    await flush();
    expect(heard.bo).toEqual([expect.objectContaining({ kind: 'gift', sub: null, act: given.act.id, character: boFace })]);
    expect(heard.ana).toEqual([]);
    fake.signInAs(bo);
    expect((await fake.alerts()).filter((a) => a.kind === 'gift')).toMatchObject([{ act: given.act.id, character: boFace }]);
    const anaHeel = fake.seed.character(ana, 'Ana Heel', 'heel');
    const own = fake.seed.post(thread, anaHeel, 'Ana\'s own post');
    const ownDrive = fake.seed.card(anaHeel, own, 'appeal');
    fake.signInAs(ana);
    must(await fake.donate(anaFace, ownDrive, 10));
    await flush();
    expect(heard.ana).toEqual([]);
    expect((await fake.alerts()).filter((a) => a.kind === 'gift')).toEqual([]);
  });

  test('a gift is refused in the database\'s words: a closed drive, an amount not offered, a short wallet, no drive, a ban', async () => {
    const { fake, anaFace, opener, drive } = driveWorld(20);
    expect(await fake.donate(anaFace, drive, 12)).toEqual(refused('a gift here is one of 0.10, 0.25'));
    expect(await fake.donate(anaFace, drive, 25)).toEqual(refused('your wallet holds less than that'));
    expect(await fake.donate(anaFace, opener, 10)).toEqual(refused('that is not a drive'));
    expect(await fake.donate(anaFace, '99999999-9999-4999-8999-999999999999', 10)).toEqual(refused('that is not a drive'));
    expect(await fake.donate(anaFace, drive, 0)).toMatchObject({ ok: false, field: 'amount' });
    const until = fake.clock.now() + 24 * 3_600_000;
    fake.seed.ban(anaFace, until, { infraction: fake.seed.infraction(fake.seed.visit(fake.seed.staff('mod', 'Mod Bot', 'mod'), opener)) });
    expect(await fake.donate(anaFace, drive, 10)).toMatchObject({ ok: false, error: `this character is banned until ${new Date(until).toISOString()}; the ban ends by itself then` });
    fake.clock.advance(8 * DAY);
    expect(await fake.donate(anaFace, drive, 10)).toMatchObject({ ok: false });
  });

  test('a closed drive says so, and a later play keeps it open', async () => {
    const { fake, anaFace, boFace, opener, drive } = driveWorld();
    fake.clock.advance(6 * DAY);
    fake.seed.card(boFace, opener, 'appeal');
    fake.clock.advance(6 * DAY);
    expect(must(await fake.donate(anaFace, drive, 10)).balance).toBe(90);
    fake.clock.advance(2 * DAY);
    expect(await fake.donate(anaFace, drive, 10)).toEqual(refused('this drive has ended'));
  });

  test('a staff post\'s gift is all overhead, and the giver is told no differently', async () => {
    const { fake, ana, anaFace, thread } = driveWorld();
    const staff = fake.seed.staff('boss', 'The Boss', 'boss');
    const post = fake.seed.staffPost(staff, thread, 'Hello from the glass.');
    const drive = fake.seed.card(staff, post, 'appeal');
    const given = must(await fake.donate(anaFace, drive, 25));
    expect(given.act.payload).toMatchObject({ amount: 25, overhead: 25, arrives: 0 });
    expect(await walletOf(fake, ana)).toBe(75);
  });

  test('a gift to a drive on a staff post tells nobody', async () => {
    const { fake, ana, bo, anaFace, thread } = driveWorld();
    const staff = fake.seed.staff('boss', 'The Boss', 'boss');
    const drive = fake.seed.card(staff, fake.seed.staffPost(staff, thread, 'Hello from the glass.'), 'appeal');
    const heard: { kind: string }[] = [];
    fake.subscribeAccount({ onAlert: (a) => heard.push(a) });
    fake.signInAs(bo);
    fake.subscribeAccount({ onAlert: (a) => heard.push(a) });
    fake.signInAs(ana);
    must(await fake.donate(anaFace, drive, 10));
    await flush();
    expect(heard).toEqual([]);
    expect((await fake.alerts()).filter((a) => a.kind === 'gift')).toEqual([]);
    fake.signInAs(bo);
    expect((await fake.alerts()).filter((a) => a.kind === 'gift')).toEqual([]);
  });

  test('the answer is the same whether or not the author\'s wallet is full, and the overflow is lost without a word', async () => {
    const a = driveWorld();
    const b = driveWorld();
    b.fake.seed.wallet(b.bo, 600);
    const [x, y] = [must(await a.fake.donate(a.anaFace, a.drive, 25)), must(await b.fake.donate(b.anaFace, b.drive, 25))];
    expect({ ...x.act.payload, balance: x.balance }).toEqual({ ...y.act.payload, balance: y.balance });
    expect(await walletOf(b.fake, b.bo)).toBe(600);
    expect((await b.fake.log()).wallet[0]).toMatchObject({ kind: 'gift_in', change: 0, overflow: 20 });
  });

  test('a gift to a drive on one\'s own post costs the overhead and is not refused', async () => {
    const { fake, ana, bo, boFace, drive } = driveWorld();
    fake.signInAs(bo);
    fake.seed.wallet(bo, 100);
    expect(must(await fake.donate(boFace, drive, 25)).balance).toBe(95);
    expect(await walletOf(fake, bo)).toBe(95);
    void ana;
  });

  test('the wall holds the totals, the count and the latest gifts, newest first, and pages by a keyset cursor', async () => {
    const { fake, anaFace, drive } = driveWorld(10_000);
    fake.seed.wallet(fake.seed.account('rich'), 0);
    const ids: string[] = [];
    for (let i = 0; i < 23; i += 1) { ids.push(must(await fake.donate(anaFace, drive, 10)).act.id); fake.clock.advance(MINUTE); }
    const [wall, none] = await fake.driveGifts([drive, '99999999-9999-4999-8999-999999999999']);
    expect(wall).toMatchObject({ id: drive, total: 230, count: 23 });
    expect(wall!.gifts.map((g) => g.id)).toEqual(ids.slice(3).reverse());
    expect(wall!.gifts[0]).toEqual({ id: ids[22], character: anaFace, name: 'Ana Face', amount: 10, at: expect.any(String) });
    expect(none).toEqual({ id: '99999999-9999-4999-8999-999999999999', total: 0, count: 0, gifts: [] });
    const last = wall!.gifts.at(-1)!;
    const page = await fake.driveGiftsPage(drive, { at: last.at, id: last.id });
    expect(page.gifts.map((g) => g.id)).toEqual(ids.slice(0, 3).reverse());
    expect(page.more).toBe(false);
    expect(page.gifts.every((g) => g.name === 'Ana Face')).toBe(true);
    expect(JSON.stringify(wall)).not.toMatch(/overhead|arrives/);
  });

  test('a thread holding gifts lists the same posts, counts and unread marks as one without them', async () => {
    const plain = driveWorld(1_000);
    const gifted = driveWorld(1_000);
    for (const w of [plain, gifted]) w.fake.seed.post(w.thread, w.boFace, 'A reply.');
    for (let i = 0; i < 3; i += 1) must(await gifted.fake.donate(gifted.anaFace, gifted.drive, 10));
    const read = async (w: typeof plain) => {
      w.fake.signInAs(w.ana);
      await w.fake.follow(w.thread, true);
      const summary = (await w.fake.thread(w.thread))!;
      const unread = (await w.fake.followed()).map((f) => ({ ...f, thread: 0, board: 0, newestAt: 0 }));
      return {
        summary: { ...summary, id: 0, board: 0, firstAct: 0, lastAct: 0, originActId: 0, lastAt: 0, createdAt: 0 },
        posts: (await w.fake.acts(w.thread, 1, 50)).map((a) => [a.kind, a.seq]), unread,
        counts: [await w.fake.characterCounts(w.boFace), await w.fake.characterStats([w.boFace])],
        alerts: await w.fake.alertsUnread(),
      };
    };
    expect(await read(gifted)).toEqual(await read(plain));
  });
});

/* Card notes, Part 6 (docs/plans/2026-11-11-card-notes-part-6-plan.md, Task 6): the plays Task 4 makes in SQL (a skim, a ride back, a scored-as play),
   decided by the cards' own rules and written in the server's words. The cards here are stubs that carry only the rules the fake reads. */
describe('a skim, a ride back and a scored-as play, as the server holds them', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const WEEK = 7 * DAY;
  const QUADS = ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'];
  const named = (c: unknown, key: string, why: string) => { const v = (c as Record<string, unknown> | null)?.[key]; return typeof v === 'string' && v !== '' ? ok(c as Record<string, unknown>) : { ok: false as const, why }; };
  const base = { playPrice: () => 0 };
  const skimmer = {
    ...base, key: 'skimmer', name: 'Skimmer', alignment: 'salty' as const, rarity: 'uncommon' as const, skim: { share: 0.1 }, lasts: { unit: 'week' as const, count: 1 }, stack: 4,
    validateConfig: (c: unknown) => (QUADS.includes((c as { quadrant?: string } | null)?.quadrant ?? '') ? ok({ quadrant: (c as { quadrant: string }).quadrant }) : { ok: false as const, why: 'this card names a reaction quadrant' }),
    canApply: (t: CardTarget, e: readonly CardEffect[], c?: { quadrant: never }, now?: Date) => { const l = landsOn({ key: 'skimmer', stack: 4 }, t, e, now); return l.ok && c ? quadrantFree({ key: 'skimmer' }, t, e, c.quadrant, now) : l; },
  };
  const blot = { ...base, key: 'blot', name: 'Blot', alignment: 'salty' as const, rarity: 'common' as const, validateConfig: (c: unknown) => ok(c ?? {}), canApply: () => ok(undefined) };
  const other = { ...blot, key: 'other', name: 'Other' };
  const rider = {
    ...base, key: 'rider', name: 'Rider', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, outcome: { kind: 'ride' as const, share: 1 } },
    catches: (c: { card: string }) => c.card, canApply: () => ok(undefined),
    validateConfig: (c: unknown) => (QUADS.includes((c as { quadrant?: string } | null)?.quadrant ?? '') ? ok(c as { card: string; quadrant: string }) : { ok: false as const, why: 'this card names a reaction quadrant' }),
  };
  const dayoff = {
    ...base, key: 'dayoff', name: 'Day Off', alignment: 'salty' as const, rarity: 'legendary' as const, reaches: ['character' as const], scoresAs: true as const, lasts: { unit: 'day' as const, count: 2 }, stack: 2,
    validateConfig: (c: unknown) => named(c, 'class', 'choose the class to name'),
    canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'dayoff', reaches: ['character'], stack: 2 }, t, e, now),
  };
  const cards = [skimmer, blot, other, rider, dayoff] as unknown as CardRules[];
  const world: Instance = { ...instance, cards, machine: cards.map((c) => ({ item: { card: c.key }, availability: 'onSale' as const, price: 100 })), settings: { ...settings, economy: {} } };
  function setup() {
    const fake = createFake({ instance: world });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const boss = fake.seed.account('boss', { admin: true });
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const anaHeel = fake.seed.character(ana, 'Ana Heel', 'heel');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    const { act: boPost } = fake.seed.thread('general', boFace, 'Bo', 'Bo post');
    fake.seed.wallet(ana, 900); fake.seed.wallet(bo, 900);
    fake.seed.cards(ana, { skimmer: 8, blot: 4, other: 2, rider: 2, dayoff: 4 });
    fake.seed.cards(bo, { skimmer: 8, blot: 4, other: 2, rider: 2, dayoff: 4 });
    fake.signInAs(ana);
    return { fake, ana, bo, boss, anaFace, anaHeel, boFace, opener, boPost };
  }

  describe('a skim', () => {
    test('lands with its end a week out and its quadrant in its configuration; one on another quadrant lands beside it', async () => {
      const { fake, boFace, boPost, anaFace } = setup();
      const first = must(await fake.playCard('skimmer', anaFace, boPost, { quadrant: 'excitedPositive' }, ''));
      expect(first.payload.config).toEqual({ quadrant: 'excitedPositive' });
      expect(Date.parse(String(first.payload.ends)) - Date.parse(first.createdAt)).toBe(WEEK);
      const second = must(await fake.playCard('skimmer', anaFace, boPost, { quadrant: 'calmPositive' }, ''));
      expect(second.payload).toMatchObject({ layer: 2, config: { quadrant: 'calmPositive' } });
      void boFace;
    });

    test('a second on the same quadrant is refused in the server\'s words, and lands once the first has ended by time', async () => {
      const { fake, anaFace, boPost } = setup();
      must(await fake.playCard('skimmer', anaFace, boPost, { quadrant: 'excitedPositive' }, ''));
      expect(await fake.playCard('skimmer', anaFace, boPost, { quadrant: 'excitedPositive' }, '')).toEqual(refused('this post already carries that card for that quadrant', 'config'));
      fake.clock.advance(WEEK + 1);
      expect(must(await fake.playCard('skimmer', anaFace, boPost, { quadrant: 'excitedPositive' }, '')).kind).toBe('card');
    });

    test('a play that names no quadrant is refused in the card\'s words', async () => {
      const { fake, anaFace, boPost } = setup();
      expect(await fake.playCard('skimmer', anaFace, boPost, {}, '')).toEqual(refused('this card names a reaction quadrant', 'config'));
      expect(await fake.playCard('skimmer', anaFace, boPost, { quadrant: 'sideways' }, '')).toEqual(refused('this card names a reaction quadrant', 'config'));
    });

    test('a play on a post of the caster\'s own other mask lands exactly as on a stranger\'s', async () => {
      const { fake, anaHeel, opener, boPost } = setup();
      const mine = must(await fake.playCard('skimmer', anaHeel, opener, { quadrant: 'excitedPositive' }, ''));
      const theirs = must(await fake.playCard('skimmer', anaHeel, boPost, { quadrant: 'excitedPositive' }, ''));
      expect(Object.keys(mine.payload).sort()).toEqual(Object.keys(theirs.payload).sort());
      expect(await fake.playCard('skimmer', anaHeel, opener, { quadrant: 'excitedPositive' }, '')).toEqual(refused('this post already carries that card for that quadrant', 'config'));
    });
  });

  describe('a ride back', () => {
    const set = async (fake: ReturnType<typeof setup>['fake'], face: string, post: string, quadrant = 'calmPositive') => must(await fake.setCard('rider', face, post, { card: 'blot', quadrant }));

    test('springs on a cast of the card it names: the cast lands with its layer and `rode`, the spring says it rode and names the quadrant', async () => {
      const { fake, bo, anaFace, boFace, opener } = setup();
      const back = await set(fake, anaFace, opener);
      fake.signInAs(bo);
      const cast = must(await fake.playCard('blot', boFace, opener, {}, ''));
      expect(cast.payload).toMatchObject({ card: 'blot', layer: 1, rode: back.id });
      expect(cast.payload).not.toHaveProperty('caught');
      const spring = (await fake.postPlays([opener])).plays.find((a) => a.kind === 'spring')!;
      expect(spring.payload).toEqual({ card: 'rider', trigger: 'cast', did: 'rode', quadrant: 'calmPositive', set: back.id, by: cast.id });
      expect(spring.payload).not.toHaveProperty('caught');
      /* The back has sprung: the next cast rides nothing. */
      expect(must(await fake.playCard('blot', boFace, opener, {}, '')).payload).toMatchObject({ layer: 2 });
      expect(must(await fake.playCard('blot', boFace, opener, {}, '')).payload).not.toHaveProperty('rode');
    });

    test('the setter takes no card and has no `caught` row', async () => {
      const { fake, ana, bo, anaFace, boFace, opener } = setup();
      await set(fake, anaFace, opener);
      const before = (await fake.myCards()).find((c) => c.card === 'blot')?.held;
      fake.signInAs(bo);
      must(await fake.playCard('blot', boFace, opener, {}, ''));
      fake.signInAs(ana);
      expect((await fake.myCards()).find((c) => c.card === 'blot')?.held).toBe(before);
      expect((await fake.log()).cards.some((e) => e.kind === 'caught')).toBe(false);
    });

    test('a cast of another card passes over it, and a cast by the setter\'s own other mask springs it the same', async () => {
      const { fake, anaFace, anaHeel, opener } = setup();
      const back = await set(fake, anaFace, opener);
      must(await fake.playCard('other', anaHeel, opener, {}, ''));
      expect((await fake.postPlays([opener])).plays.some((a) => a.kind === 'spring')).toBe(false);
      const cast = must(await fake.playCard('blot', anaHeel, opener, {}, ''));
      expect(cast.payload).toMatchObject({ rode: back.id });
      expect((await fake.postPlays([opener])).plays.find((a) => a.kind === 'spring')?.payload).toMatchObject({ did: 'rode', set: back.id, by: cast.id });
    });

    test('a ride set with no quadrant is refused in the card\'s words', async () => {
      const { fake, anaFace, opener } = setup();
      expect(await fake.setCard('rider', anaFace, opener, { card: 'blot' })).toEqual(refused('this card names a reaction quadrant', 'config'));
    });
  });

  /* A refund outcome (docs/plans/2026-11-20-refund-outcome-plan.md, Task 3): the back and the sign hand a landed cast back to the caster's hand, once, as place_cast does. */
  describe('a refund back and a refunds use play', () => {
    const rfBase = { ...base, validateConfig: (c: unknown) => ok(c ?? {}) };
    const rfgift = { ...rfBase, key: 'rfgift', name: 'Rf Gift', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['sweet' as const], upTo: 'uncommon' as const }, outcome: { kind: 'refund' as const } }, canApply: () => ok(undefined) };
    const rfsign = { ...rfBase, key: 'rfsign', name: 'Rf Sign', alignment: 'pepperoni' as const, rarity: 'common' as const, play: 'use' as const, reaches: ['post' as const], lasts: { unit: 'day' as const, count: 3 }, refunds: { flavors: ['salty' as const], count: 3 }, canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'rfsign', reaches: ['post'], stack: 1 }, t, e, now) };
    const rfsweet = { ...rfBase, key: 'rfsweet', name: 'Rf Sweet', alignment: 'sweet' as const, rarity: 'common' as const, stack: 6, canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'rfsweet', stack: 6 }, t, e, now) };
    const rfrare = { ...rfsweet, key: 'rfrare', name: 'Rf Rare', rarity: 'rare' as const, canApply: () => ok(undefined) };
    const rfsalty = { ...rfsweet, key: 'rfsalty', name: 'Rf Salty', alignment: 'salty' as const, canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'rfsalty', stack: 6 }, t, e, now) };
    const rfcatch = { ...rfBase, key: 'rfcatch', name: 'Rf Catch', alignment: 'salty' as const, rarity: 'common' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'rfsalty', canApply: () => ok(undefined) };
    /* A newer sign that refunds sweet casts alone, and a back that rides a common salty cast. */
    const rfsign2 = { ...rfsign, key: 'rfsign2', name: 'Rf Sign Two', refunds: { flavors: ['sweet' as const], count: 3 }, canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'rfsign2', reaches: ['post'], stack: 1 }, t, e, now) };
    const rfride = { ...rfBase, key: 'rfride', name: 'Rf Ride', alignment: 'salty' as const, rarity: 'common' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const], upTo: 'common' as const }, outcome: { kind: 'ride' as const, share: 1 } }, canApply: () => ok(undefined) };
    const rfCards = [rfgift, rfsign, rfsign2, rfride, rfsweet, rfrare, rfsalty, rfcatch] as unknown as CardRules[];
    const rfWorld: Instance = { ...instance, cards: rfCards, machine: [], settings: { ...settings, economy: {} } };
    function rf() {
      const fake = createFake({ instance: rfWorld });
      const ana = fake.seed.account('ana');
      const bo = fake.seed.account('bo');
      const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
      const anaHeel = fake.seed.character(ana, 'Ana Heel', 'heel');
      const boFace = fake.seed.character(bo, 'Bo Face', 'face');
      const posts = [1, 2, 3, 4].map((i) => fake.seed.thread('general', anaFace, `T${i}`, `Post ${i}`).act);
      fake.seed.wallet(ana, 900); fake.seed.wallet(bo, 900);
      fake.seed.cards(ana, { rfgift: 4, rfsign: 4, rfcatch: 2, rfsalty: 4, rfsign2: 2, rfride: 2 });
      fake.seed.cards(bo, { rfsweet: 6, rfrare: 2, rfsalty: 12 });
      fake.signInAs(ana);
      return { fake, ana, bo, anaFace, anaHeel, boFace, posts };
    }
    const held = async (fake: ReturnType<typeof rf>['fake'], card: string) => (await fake.myCards()).find((c) => c.card === card)?.held ?? 0;
    const returned = async (fake: ReturnType<typeof rf>['fake']) => (await fake.log()).cards.filter((e) => e.kind === 'returned' && e.act !== null);

    test('a refund back hands the landed cast it matches back: a returned spring with no quadrant, the cast names the back, the hand is whole, and the back is spent', async () => {
      const { fake, ana, bo, anaFace, boFace, posts } = rf();
      const post = posts[0]!;
      const back = must(await fake.setCard('rfgift', anaFace, post, { quadrant: 'calmPositive' })); /* a refund set card never stores a quadrant, even one in its config */
      fake.signInAs(bo);
      must(await fake.playCard('rfrare', boFace, post, {}, ''));
      expect((await fake.postPlays([post])).plays.some((a) => a.kind === 'spring')).toBe(false);
      const before = await held(fake, 'rfsweet');
      const cast = must(await fake.playCard('rfsweet', boFace, post, {}, ''));
      const spring = (await fake.postPlays([post])).plays.find((a) => a.kind === 'spring')!;
      expect(spring.payload).toEqual({ card: 'rfgift', trigger: 'cast', did: 'returned', set: back.id, by: cast.id });
      expect(cast.payload).toMatchObject({ card: 'rfsweet', layer: 1, handedBack: { by: back.id, card: 'rfgift' } });
      expect(cast.payload).not.toHaveProperty('caught');
      expect(await held(fake, 'rfsweet')).toBe(before);
      expect(await returned(fake)).toEqual([expect.objectContaining({ card: 'rfsweet', act: cast.id, price: 0 })]);
      const second = must(await fake.playCard('rfsweet', boFace, post, {}, ''));
      expect(second.payload).not.toHaveProperty('handedBack');
      expect(await held(fake, 'rfsweet')).toBe(before - 1);
      fake.signInAs(ana);
      expect((await fake.log()).cards.filter((e) => e.kind === 'returned' || e.kind === 'caught')).toEqual([]);
    });

    test('a sign hands back three casts of its flavor and not the fourth; a cast of another flavor is not handed back', async () => {
      const { fake, ana, bo, anaFace, boFace, posts } = rf();
      const post = posts[0]!;
      const sign = must(await fake.useCard('rfsign', anaFace, post, {}, ''));
      fake.signInAs(bo);
      must(await fake.playCard('rfsweet', boFace, post, {}, ''));
      const before = await held(fake, 'rfsalty');
      const casts: Act[] = [];
      for (let i = 0; i < 4; i++) casts.push(must(await fake.playCard('rfsalty', boFace, post, {}, '')));
      expect(casts.slice(0, 3).map((c) => c.payload.handedBack)).toEqual([0, 1, 2].map(() => ({ by: sign.id, card: 'rfsign' })));
      expect(casts[3]!.payload).not.toHaveProperty('handedBack');
      expect(await held(fake, 'rfsalty')).toBe(before - 1);
      expect((await returned(fake)).map((e) => e.act).sort()).toEqual(casts.slice(0, 3).map((c) => c.id).sort());
      expect((await returned(fake)).map((e) => e.price)).toEqual([0, 0, 0]);
      expect((await fake.postPlays([post])).plays.find((a) => a.id === (casts[0]!.id))?.payload).not.toHaveProperty('caught');
      void ana;
    });

    test('the own other mask of the sign\'s player is handed back exactly as a stranger is', async () => {
      const { fake, anaFace, anaHeel, posts } = rf();
      const post = posts[1]!;
      const sign = must(await fake.useCard('rfsign', anaFace, post, {}, ''));
      const before = await held(fake, 'rfsalty');
      const cast = must(await fake.playCard('rfsalty', anaHeel, post, {}, ''));
      expect(cast.payload).toMatchObject({ handedBack: { by: sign.id, card: 'rfsign' } });
      expect(await held(fake, 'rfsalty')).toBe(before);
    });

    test('the sign is the latest one that qualifies: an older salty sign hands a salty cast back when the newer sign is for another flavor', async () => {
      const { fake, bo, anaFace, boFace, posts } = rf();
      const post = posts[3]!;
      const older = must(await fake.useCard('rfsign', anaFace, post, {}, ''));
      fake.clock.advance(1000);
      must(await fake.useCard('rfsign2', anaFace, post, {}, ''));
      fake.signInAs(bo);
      const cast = must(await fake.playCard('rfsalty', boFace, post, {}, ''));
      expect(cast.payload).toMatchObject({ handedBack: { by: older.id, card: 'rfsign' } });
    });

    test('a ride back and a refunds sign on one post: the landed cast rides and is handed back by the sign', async () => {
      const { fake, bo, anaFace, boFace, posts } = rf();
      const post = posts[2]!;
      const sign = must(await fake.useCard('rfsign', anaFace, post, {}, ''));
      const back = must(await fake.setCard('rfride', anaFace, post, { quadrant: 'calmPositive' }));
      fake.signInAs(bo);
      const cast = must(await fake.playCard('rfsalty', boFace, post, {}, ''));
      expect(cast.payload).toMatchObject({ rode: back.id, handedBack: { by: sign.id, card: 'rfsign' } });
      expect((await fake.postPlays([post])).plays.find((a) => a.kind === 'spring')?.payload).toMatchObject({ did: 'rode', set: back.id, by: cast.id });
    });

    test('a back that catches the cast takes it: nothing is handed back and no kick is used', async () => {
      const { fake, bo, anaFace, boFace, posts } = rf();
      const post = posts[2]!;
      const sign = must(await fake.useCard('rfsign', anaFace, post, {}, ''));
      must(await fake.setCard('rfcatch', anaFace, post, {}));
      fake.signInAs(bo);
      const caught = must(await fake.playCard('rfsalty', boFace, post, {}, ''));
      expect(caught.payload).toHaveProperty('caught');
      expect(caught.payload).not.toHaveProperty('handedBack');
      expect(await returned(fake)).toEqual([]);
      /* Its kick is unspent: the next three casts are all handed back by the sign. */
      const next = [];
      for (let i = 0; i < 3; i++) next.push(must(await fake.playCard('rfsalty', boFace, post, {}, '')));
      expect(next.map((c) => (c.payload.handedBack as { by: string } | undefined)?.by)).toEqual([sign.id, sign.id, sign.id]);
    });
  });

  /* A lockout outcome (docs/plans/2026-11-21-so-very-happy-plan.md, Task 4): the Move that springs the back lands, and its character is locked out of the thread, as place_cast and not_locked_out say. */
  describe('a lockout back', () => {
    const lkBase = { ...base, validateConfig: (c: unknown) => ok(c ?? {}) };
    const lkback = { ...lkBase, key: 'lkback', name: 'Lk Back', alignment: 'sweet' as const, rarity: 'rare' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const, 'pepperoni' as const], upTo: 'rare' as const }, outcome: { kind: 'lockout' as const, hours: 24 } }, canApply: () => ok(undefined) };
    const lksalty = { ...lkBase, key: 'lksalty', name: 'Lk Salty', alignment: 'salty' as const, rarity: 'common' as const, stack: 6, canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'lksalty', stack: 6 }, t, e, now) };
    const lkcutter = { ...lkBase, key: 'lkcutter', name: 'Lk Cutter', alignment: 'pepperoni' as const, rarity: 'rare' as const, replies: true as const, canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'lkcutter', reaches: ['post'] }, t, e, now) };
    const lkwide = { ...lkBase, key: 'lkwide', name: 'Lk Wide', alignment: 'sweet' as const, rarity: 'common' as const, reaches: ['post' as const, 'thread' as const, 'character' as const, 'board' as const], lasts: { unit: 'day' as const, count: 1 }, canApply: () => ok(undefined) };
    const lkWorld: Instance = { ...instance, cards: [lkback, lksalty, lkcutter, lkwide] as unknown as CardRules[], machine: [], settings: { ...settings, postMaxLength: 500, economy: {} } };
    function lk() {
      const fake = createFake({ instance: lkWorld });
      const ana = fake.seed.account('ana');
      const bo = fake.seed.account('bo');
      const root = fake.seed.account('root');
      fake.seed.admin(root);
      const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
      const boFace = fake.seed.character(bo, 'Bo Face', 'face');
      const boHeel = fake.seed.character(bo, 'Bo Heel', 'heel');
      const { thread, act: post } = fake.seed.thread('general', anaFace, 'T1', 'Post 1');
      const other = fake.seed.thread('general', anaFace, 'T2', 'Post 2');
      fake.seed.wallet(ana, 900); fake.seed.wallet(bo, 900);
      fake.seed.cards(ana, { lkback: 3 });
      fake.seed.cards(bo, { lksalty: 6, lkcutter: 2, lkback: 1, lkwide: 6 });
      fake.signInAs(ana);
      return { fake, ana, bo, root, anaFace, boFace, boHeel, thread, post, otherThread: other.thread, otherPost: other.act };
    }
    const lockedWords = (until: string) => `Bo Face is locked out of this thread until ${refusalTime(new Date(Math.ceil(Date.parse(until) / MINUTE) * MINUTE).toISOString())}; the lockout ends by itself then, and it holds only this character, not your other characters`;
    const springOf = async (fake: ReturnType<typeof lk>['fake'], post: string) => (await fake.postPlays([post])).plays.find((a) => a.kind === 'spring')!;

    test('the Move that springs it lands, and the spring says lockedOut with who it locks and until when, with no card handed anywhere', async () => {
      const { fake, bo, anaFace, boFace, post } = lk();
      const back = must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      const before = (await fake.myCards()).find((c) => c.card === 'lksalty')!.held;
      const move = must(await fake.playCard('lksalty', boFace, post, {}, ''));
      expect(move.payload).not.toHaveProperty('caught');
      expect(move.payload).not.toHaveProperty('rode');
      const spring = await springOf(fake, post);
      expect(spring.payload).toEqual({ card: 'lkback', trigger: 'cast', did: 'lockedOut', set: back.id, by: move.id, locks: boFace, until: new Date(Date.parse(spring.createdAt) + 24 * 3_600_000).toISOString() });
      expect((await fake.myCards()).find((c) => c.card === 'lksalty')!.held).toBe(before - 1);
      expect((await fake.log()).cards.filter((e) => e.kind === 'returned' || e.kind === 'caught')).toEqual([]);
    });

    test('the locked character is refused a post, a Move and a back in that thread in the SQL\'s words, until an admin ends it; its other mask and other threads are not held', async () => {
      const { fake, bo, root, anaFace, boFace, boHeel, thread, post, otherPost, otherThread } = lk();
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      const spring = await springOf(fake, post);
      const until = String(spring.payload.until);
      expect(await fake.post(thread, boFace, 'Hello', null)).toEqual(refused(lockedWords(until)));
      expect(await fake.playCard('lksalty', boFace, post, {}, '')).toMatchObject({ ok: false, error: lockedWords(until) });
      /* Not held: another mask of the same account, another thread. */
      must(await fake.post(thread, boHeel, 'Hello', null));
      must(await fake.post(otherThread, boFace, 'Hello elsewhere', null));
      must(await fake.playCard('lksalty', boFace, otherPost, {}, ''));
      fake.signInAs(root);
      must(await fake.reverseCard(spring.id));
      fake.signInAs(bo);
      must(await fake.post(thread, boFace, 'Hello again', null));
    });

    test('a back is not set by the locked character in that thread', async () => {
      const { fake, bo, anaFace, boFace, thread, post } = lk();
      const mine = fake.seed.post(thread, boFace, 'Mine');
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      const until = String((await springOf(fake, post)).payload.until);
      expect(await fake.setCard('lkback', boFace, mine, {})).toMatchObject({ ok: false, error: lockedWords(until) });
    });

    test('a thread or character play in the locked thread is refused; a board play, an edit, a reaction and a quote from another thread are not', async () => {
      const { fake, bo, anaFace, boFace, thread, post, otherThread } = lk();
      const mine = fake.seed.post(thread, boFace, 'Mine');
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      const until = String((await springOf(fake, post)).payload.until);
      expect(await fake.playCard('lkwide', boFace, thread, {}, '', 'thread')).toMatchObject({ ok: false, error: lockedWords(until) });
      expect(await fake.playCard('lkwide', boFace, anaFace, {}, '', 'character', post)).toMatchObject({ ok: false, error: lockedWords(until) });
      const general = (await fake.boards()).find((b) => b.slug === 'general')!;
      must(await fake.playCard('lkwide', boFace, general.id, {}, '', 'board'));
      must(await fake.edit(mine, boFace, 'Mine, edited'));
      must(await fake.react(post, boFace, 'fire'));
      must(await fake.post(otherThread, boFace, `[quote=${post}]Post 1[/quote]over here`, post));
    });

    test('an admin ends a live lockout once; a second end is refused; the page and my characters carry it only while it holds', async () => {
      const { fake, bo, root, anaFace, boFace, boHeel, thread, post } = lk();
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      const spring = await springOf(fake, post);
      const until = String(spring.payload.until);
      const lockedOf = async (id: string) => (await fake.threadPage(thread, { page: 1 }, null, []))!.people.find((p) => p.character.id === id)?.character.lockedUntil;
      expect(await lockedOf(boFace)).toBe(until);
      expect(await lockedOf(boHeel)).toBeUndefined();
      expect((await fake.myCharacters()).find((c) => c.id === boFace)!.lockouts).toEqual([{ thread, until }]);
      expect((await fake.myCharacters()).find((c) => c.id === boHeel)!.lockouts).toBeUndefined();
      expect(await fake.reverseCard(spring.id)).toEqual(refused('only an admin ends a card'));
      fake.signInAs(root);
      must(await fake.reverseCard(spring.id));
      expect(await fake.reverseCard(spring.id)).toEqual(refused('an admin has already ended that card'));
      fake.signInAs(bo);
      expect(await lockedOf(boFace)).toBeUndefined();
      expect((await fake.myCharacters()).find((c) => c.id === boFace)!.lockouts).toBeUndefined();
    });

    test('an admin\'s end of a lockout is in the log of the setter\'s player and of the locked character\'s player, and of no one else', async () => {
      const { fake, ana, bo, root, anaFace, boFace, post } = lk();
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      const spring = await springOf(fake, post);
      fake.signInAs(root);
      const end = must(await fake.reverseCard(spring.id));
      const ended = async (who: string) => { fake.signInAs(who); return (await fake.log()).ended.filter((e) => e.play === spring.id); };
      expect(await ended(ana)).toMatchObject([{ cardEnd: end.act, play: spring.id, card: 'lkback', side: 'cast', character: anaFace }]);
      expect(await ended(bo)).toMatchObject([{ cardEnd: end.act, play: spring.id, card: 'lkback', side: 'onMine', character: boFace }]);
      expect(await ended(root)).toEqual([]);
    });

    test('the refusal names the character and the time and nothing of the player, the same words the SQL says', async () => {
      const { fake, bo, anaFace, boFace, post } = lk();
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      const spring = await springOf(fake, post);
      const refusal = await fake.playCard('lksalty', boFace, post, {}, '');
      expect(refusal).toEqual(refused(lockedWords(String(spring.payload.until))));
      expect(JSON.stringify(refusal)).not.toMatch(/Bo Heel|"bo"/);
    });

    test('a lockout that has run its time is over by itself, and cannot be ended', async () => {
      const { fake, bo, root, anaFace, boFace, thread, post } = lk();
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      const spring = await springOf(fake, post);
      fake.clock.advance(25 * 60 * MINUTE);
      must(await fake.post(thread, boFace, 'Back', null));
      fake.signInAs(root);
      expect(await fake.reverseCard(spring.id)).toEqual(refused('that card has already worn off'));
    });

    test('postPlays keeps a back that sprang into a lockout while the lockout is ahead (#993), and only the newest sprung back once it has passed', async () => {
      const { fake, ana, bo, anaFace, boFace, boHeel, post } = lk();
      const first = must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      fake.clock.advance(MINUTE);
      fake.signInAs(ana);
      const second = must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boHeel, post, {}, ''));
      const springs = (await fake.postPlays([post])).plays.filter((a) => a.kind === 'spring');
      expect(springs.map((a) => a.payload.did)).toEqual(['lockedOut', 'lockedOut']);
      const backs = async () => (await fake.postPlays([post])).plays.filter((a) => a.kind === 'set').map((a) => a.id);
      /* Both lockouts are ahead: both sprung backs are carried, though only one is the newest of its kind and neither draws more than the other. */
      expect((await backs()).sort()).toEqual([first.id, second.id].sort());
      /* The first one's lockout ends before the second's (a minute earlier), and then only the newest sprung back is left, as a stand-in. */
      fake.clock.advance(24 * 60 * MINUTE);
      expect(await backs()).toEqual([second.id]);
      fake.clock.advance(MINUTE);
      expect(await backs()).toEqual([second.id]);
    });

    test('postPlays drops a sprung back whose lockout an admin ended, and keeps the one whose lockout holds', async () => {
      const { fake, ana, bo, root, anaFace, boFace, boHeel, post } = lk();
      const first = must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boFace, post, {}, ''));
      fake.clock.advance(MINUTE);
      fake.signInAs(ana);
      const second = must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      must(await fake.playCard('lksalty', boHeel, post, {}, ''));
      const backs = async () => (await fake.postPlays([post])).plays.filter((a) => a.kind === 'set').map((a) => a.id).sort();
      expect(await backs()).toEqual([first.id, second.id].sort());
      const firstSpring = (await fake.postPlays([post])).plays.find((a) => a.kind === 'spring' && a.payload.set === first.id)!;
      fake.signInAs(root);
      must(await fake.reverseCard(firstSpring.id));
      expect(await backs()).toEqual([second.id]);
    });

    test('the Move that springs it still writes the reply it carries', async () => {
      const { fake, bo, anaFace, boFace, thread, post } = lk();
      must(await fake.setCard('lkback', anaFace, post, {}));
      fake.signInAs(bo);
      const move = must(await fake.playCard('lkcutter', boFace, post, {}, '', undefined, undefined, undefined, { body: 'Excuse me.' }));
      expect(move.payload).toHaveProperty('reply');
      expect((await springOf(fake, post)).payload).toMatchObject({ did: 'lockedOut', locks: boFace });
      const page = (await fake.threadPage(thread, { page: 1 }, null, []))!;
      expect(page.under.map((u) => u.act.currentPayload)).toEqual([{ body: 'Excuse me.' }]);
    });
  });

  describe('a scored-as play', () => {
    const NEXT = START + DAY / 2;
    /* The last settlement ended now; the next is half a day on, the window after it a settlement's length (one day) long. */
    function open() {
      const s = setup();
      s.fake.seed.settle({});
      s.fake.seed.nextSettlementAt(NEXT);
      return s;
    }
    const play = (s: ReturnType<typeof setup>, cls = 'heel', on = s.boFace) => s.fake.playCard('dayoff', s.anaFace, on, { class: cls }, '', 'character', on === s.boFace ? s.boPost : s.opener);

    test('its `starts` is the next settlement and its `ends` the close of the window after it', async () => {
      const s = open();
      const played = must(await play(s));
      expect(played.payload).toMatchObject({ card: 'dayoff', reach: 'character', character: s.boFace, config: { class: 'heel' } });
      expect(played.payload.starts).toBe(new Date(NEXT).toISOString());
      expect(played.payload.ends).toBe(new Date(NEXT + DAY).toISOString());
    });

    test('an unknown class is refused', async () => {
      const s = open();
      expect(await play(s, 'nothing')).toEqual(refused('there is no such class'));
    });

    test('where the next settlement\'s time is not known, no window can be named', async () => {
      const s = setup();
      s.fake.seed.settle({});
      expect(await play(s)).toEqual(refused('the next settlement\'s time is not known yet, so no window can be named; play it after that settlement'));
    });

    test('where a next settlement time is seeded but none has been applied, no window can be named, as next_settlement_at is null with no settlement', async () => {
      const s = setup();
      s.fake.seed.nextSettlementAt(NEXT);
      expect(await play(s)).toEqual(refused('the next settlement\'s time is not known yet, so no window can be named; play it after that settlement'));
    });

    test('where the season ends at the next settlement, there is no window after it', async () => {
      const s = open();
      s.fake.seed.season({ number: 1, endsAt: new Date(NEXT).toISOString() });
      expect(await play(s)).toEqual(refused('this season ends at the next settlement, so there is no window after it to name'));
    });

    test('a window the season cuts short closes with the season', async () => {
      const s = open();
      s.fake.seed.season({ number: 1, endsAt: new Date(NEXT + DAY / 4).toISOString() });
      expect(must(await play(s)).payload.ends).toBe(new Date(NEXT + DAY / 4).toISOString());
    });

    test('a second play of any scored-as card on the character in the same open window is refused, and one after the next settlement lands', async () => {
      const s = open();
      must(await play(s));
      const words = 'this character already has a class named for the window after the next settlement';
      expect(await play(s, 'face')).toEqual(refused(words));
      /* Another character is its own. */
      expect(must(await play(s, 'face', s.anaFace)).kind).toBe('card');
      s.fake.clock.advance(DAY);
      s.fake.seed.settle({});
      s.fake.seed.nextSettlementAt(START + 2 * DAY);
      expect(must(await play(s, 'face')).payload.starts).toBe(new Date(START + 2 * DAY).toISOString());
    });

    test('an admin-ended play frees the window', async () => {
      const s = open();
      const first = must(await play(s));
      s.fake.signInAs(s.boss);
      must(await s.fake.reverseCard(first.id));
      s.fake.signInAs(s.ana);
      expect(must(await play(s, 'face')).kind).toBe('card');
    });

    test('the target\'s class, its Turns and its history are untouched, and no Act but the play is written', async () => {
      const s = open();
      s.fake.signInAs(s.bo);
      const before = await s.fake.myCharacters();
      s.fake.signInAs(s.ana);
      const played = must(await play(s));
      s.fake.signInAs(s.bo);
      expect(await s.fake.myCharacters()).toEqual(before);
      expect((await s.fake.postPlays([s.boPost])).plays.map((a) => a.kind)).toEqual(['card']);
      expect(played.payload).not.toHaveProperty('layer');
    });
  });
});

describe('the log\'s scored-as rows (card notes, Part 6, Task 6)', () => {
  const rows = [
    { settlement: 3, character: 'c1', classKey: 'heel', play: 'p3', card: 'dayoff', startsAt: '2026-10-31T00:00:00.000Z', endsAt: '2026-11-01T00:00:00.000Z' },
    { settlement: 2, character: 'c1', classKey: 'face', play: 'p2', card: 'dayoff', startsAt: '2026-10-30T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z' },
  ];
  const empty = { ledger: [], shares: [], wallet: [], cards: [], packs: [], playsOnMine: [], writes: [], saves: [], setEnds: [], caught: [], ended: [], infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], cosmetics: [] };

  test('a page from an older payload, with no scoredAs key, has none, and the fake sends none', async () => {
    expect(cutLog(empty)).not.toHaveProperty('scoredAs');
    const fake = createFake({ instance });
    fake.seed.account('ana');
    expect(await fake.log()).not.toHaveProperty('scoredAs');
  });

  test('the rows come newest settlement first and are cut at the page like the settlements', () => {
    expect(cutLog({ ...empty, scoredAs: rows }).scoredAs).toEqual(rows);
    /* A source that came back full leaves out what is not newer than its oldest row. */
    const full = { ...empty, scoredAs: rows };
    expect(cutLog(full, 3).scoredAs).toEqual(rows);
    expect(cutLog({ ...full, ledger: [{ settlement: 2, startsAt: rows[1]!.startsAt, endsAt: rows[1]!.endsAt, sharesKept: true, character: 'c1', reason: 'r', amount: 1 }, { settlement: 2, startsAt: rows[1]!.startsAt, endsAt: rows[1]!.endsAt, sharesKept: true, character: 'c2', reason: 'r', amount: 1 }] }, 2).scoredAs).toEqual([rows[0]]);
  });
});

/* ---------------------------------------------------------------------------------- a surface ---- */
describe('a surface, as the server keeps it', () => {
  const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0317_surfaces.sql'), 'utf8');
  /** The sentence the SQL raises, found in its text: `format('...')` or the literal, with each `%` and `%s` in place. */
  const sayings = {
    limit: /format\('(this wall is [^']*)'/.exec(sql)![1]!,
    live: /exception '(this wall holds [^']*)'/.exec(sql)![1]!,
    author: /exception '(only the post''s author washes what is on it)'/.exec(sql)![1]!.replace(/''/g, '\''),
  };
  const said = (template: string, ...values: (number | string)[]) => { const v = [...values]; return template.replace(/%%/g, '\u0000').replace(/%s?/g, () => String(v.shift())).replace(/\u0000/g, '%'); };

  const stroke = (y: number, width: number, aspect = 1) => ({ width, aspect, points: [[0, y], [1, y]] as [number, number][] });
  const dab = (x: number, y = 0.5, width = 0.04) => ({ width, aspect: 1, points: [[x, y]] as [number, number][] });
  const slab: CardRules<unknown> = {
    key: 'slab', name: 'Slab', alignment: 'salty', rarity: 'common', stack: 1, reaches: ['post'], playPrice: () => 0,
    canApply: (target, effects, _config, now) => landsOn({ key: 'slab', reaches: ['post'] }, target, effects, now),
    validateConfig: (c) => ok(c),
    surface: {
      limitKey: 'slab.limit', mostLive: 2,
      validateDraw: (input) => (typeof input === 'object' && input !== null && Array.isArray((input as { strokes?: unknown }).strokes) ? ok({ strokes: (input as { strokes: never[] }).strokes, payload: { strokes: (input as { strokes: unknown[] }).strokes } }) : refuse('a drawing holds its strokes as a list')),
      validateWash: (input) => (typeof input === 'object' && input !== null && Array.isArray((input as { strokes?: unknown }).strokes) ? ok({ strokes: (input as { strokes: never[] }).strokes, payload: { strokes: (input as { strokes: unknown[] }).strokes } }) : refuse('a drawing holds its strokes as a list')),
    },
  };
  const surfaced: Instance = { ...instance, cards: [slab as unknown as CardRules], settings: { ...settings, cardSettings: { 'slab.limit': 40 } } };
  function wall() {
    const fake = createFake({ instance: surfaced });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const anaHeel = fake.seed.character(ana, 'Ana Heel', 'heel');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    const post = fake.seed.post(thread, anaFace, 'a post of Ana\'s');
    const play = fake.seed.card(boFace, post, 'slab');
    fake.signInAs(ana);
    return { fake, ana, bo, anaFace, anaHeel, boFace, thread, post, play };
  }

  describe('a surface card played with its first draw (play_surface_card)', () => {
    const tag = { strokes: [stroke(0.5, 0.1)] };
    test('playCard opens the wall with that draw, by the caster, and the wall reads it back', async () => {
      const { fake, ana, anaFace, thread } = wall();
      const post = fake.seed.post(thread, anaFace, 'a clean post');
      fake.seed.cards(ana, { slab: 2 });
      const played = await fake.playCard('slab', anaFace, post, {}, '', undefined, undefined, tag);
      expect(played).toMatchObject({ ok: true });
      const play = (played as { value: { id: string } }).value.id;
      const held = (await fake.surfaceActs(play))!;
      expect(held.acts).toHaveLength(1);
      expect(held.acts[0]).toMatchObject({ kind: 'draw', character: anaFace });
      expect(held.covered).toBe(count(cellsOf(tag.strokes)));
    });
    test('without a first draw it is refused on `first`, and a first draw past the limit refuses the whole play (the card stays in the hand)', async () => {
      const { fake, ana, anaFace, thread } = wall();
      const post = fake.seed.post(thread, anaFace, 'a clean post');
      fake.seed.cards(ana, { slab: 2 });
      expect(await fake.playCard('slab', anaFace, post, {}, '')).toMatchObject({ ok: false, error: 'draw your tag first', field: 'first' });
      const huge = { strokes: [stroke(0.5, 0.9), stroke(0.1, 0.9)] };
      expect(await fake.playCard('slab', anaFace, post, {}, '', undefined, undefined, huge)).toMatchObject({ ok: false, field: 'first' });
      expect(await fake.myCards()).toEqual(expect.arrayContaining([{ card: 'slab', held: 2 }]));
      expect((await fake.postPlays([post])).plays).toHaveLength(0);
    });
    test('setCard on a surface card is refused: it is cast face up and never set', async () => {
      const { fake, ana, anaFace, thread } = wall();
      const post = fake.seed.post(thread, anaFace, 'a clean post');
      fake.seed.cards(ana, { slab: 2 });
      expect(await fake.setCard('slab', anaFace, post, {})).toMatchObject({ ok: false, error: expect.stringContaining('never set face down') });
    });
  });

  test('a draw on a wall is heard live as cardOnYours/drew by the wall post\'s author, and not by the drawer\'s own other mask', async () => {
    const { fake, ana, bo, anaFace, anaHeel, boFace, play } = wall();
    const heard = { ana: [] as { kind: string; sub: string | null; character: string | null }[], bo: [] as { kind: string; sub: string | null; character: string | null }[] };
    fake.signInAs(ana);
    fake.subscribeAccount({ onAlert: (a) => heard.ana.push(a) });
    fake.signInAs(bo);
    fake.subscribeAccount({ onAlert: (a) => heard.bo.push(a) });
    const drawn = must(await fake.draw(play, boFace, { strokes: [stroke(0.5, 0.25)] }));
    await flush();
    expect(heard.ana).toEqual([expect.objectContaining({ kind: 'cardOnYours', sub: 'drew', act: drawn.id, character: anaFace })]);
    expect(heard.bo).toEqual([]);
    fake.signInAs(ana);
    expect((await fake.alerts()).filter((a) => a.sub === 'drew')).toMatchObject([{ sub: 'drew', act: drawn.id, character: anaFace }]);
    must(await fake.draw(play, anaHeel, { strokes: [stroke(0.1, 0.1)] }));
    await flush();
    expect(heard.ana).toHaveLength(1);
  });

  test('a staff draw on a wall tells the wall post\'s author cardOnYours/drew', async () => {
    const { fake, ana, anaFace, play } = wall();
    const drawn = fake.seed.draw(null as unknown as string, play);
    fake.signInAs(ana);
    expect((await fake.alerts()).filter((a) => a.sub === 'drew')).toMatchObject([{ kind: 'cardOnYours', sub: 'drew', act: drawn, character: anaFace }]);
  });

  test('a wash tells nobody, the author\'s own and the caster\'s alike', async () => {
    const { fake, ana, bo, anaFace, play } = wall();
    const heard: { kind: string; sub: string | null }[] = [];
    fake.subscribeAccount({ onAlert: (a) => heard.push(a) });
    fake.signInAs(bo);
    fake.subscribeAccount({ onAlert: (a) => heard.push(a) });
    fake.signInAs(ana);
    const washed = must(await fake.wash(play, anaFace, { strokes: [dab(0.5, 0.5, 0.02)] }));
    await flush();
    expect(heard).toEqual([]);
    expect((await fake.alerts()).filter((a) => a.act === washed.id)).toEqual([]);
    fake.signInAs(bo);
    expect((await fake.alerts()).filter((a) => a.act === washed.id)).toEqual([]);
  });

  test('the limit\'s refusal says what the database says, with the same numbers', async () => {
    const { fake, anaHeel, play } = wall();
    const first = [stroke(0.5, 0.25)];
    const before = count(cellsOf(first));
    expect(await fake.draw(play, anaHeel, { strokes: first })).toMatchObject({ ok: true });
    const second = [stroke(0.1, 0.25)];
    const together = count(cellsOf([...first, ...second]));
    expect(together).toBeGreaterThan(4000);
    const refusal = await fake.draw(play, anaHeel, { strokes: second });
    expect(refusal).toEqual(refused(said(sayings.limit, Math.floor(before / 100), 40, Math.ceil(together / 100))));
    expect(sayings.limit).toBe('this wall is %s%% covered, and its limit is %s%%; this tag would take it to %s%%');
  });

  test('a limit that is not a whole percent is shown rounded down, as the database shows it (4060 cells say 40%), and the figure after the tag is rounded up', async () => {
    const fake = createFake({ instance: { ...surfaced, settings: { ...settings, cardSettings: { 'slab.limit': 40.6 } } } });
    const ana = fake.seed.account('ana');
    const face = fake.seed.character(ana, 'Ana Face', 'face');
    const { thread } = fake.seed.thread('general', face, 'Hello', 'First post');
    const play = fake.seed.card(face, fake.seed.post(thread, face, 'a post'), 'slab');
    fake.signInAs(ana);
    const first = [stroke(0.5, 0.25)];
    const before = count(cellsOf(first));
    expect(await fake.draw(play, face, { strokes: first })).toMatchObject({ ok: true });
    const second = [stroke(0.1, 0.25)];
    const together = count(cellsOf([...first, ...second]));
    expect(together).toBeGreaterThan(4060);
    expect(await fake.draw(play, face, { strokes: second })).toEqual(refused(said(sayings.limit, Math.floor(before / 100), Math.floor(4060 / 100.0), Math.ceil(together / 100))));
  });

  test('the live count\'s refusal says what the database says, and painting over a tag is the way out', async () => {
    const { fake, anaFace, anaHeel, play } = wall();
    expect(await fake.draw(play, anaHeel, { strokes: [dab(0.1)] })).toMatchObject({ ok: true });
    expect(await fake.draw(play, anaFace, { strokes: [dab(0.5)] })).toMatchObject({ ok: true });
    expect(await fake.draw(play, anaFace, { strokes: [dab(0.9)] })).toEqual(refused(said(sayings.live, 2)));
    /* A draw over the first tag leaves two tags live. */
    expect(await fake.draw(play, anaFace, { strokes: [dab(0.1, 0.5, 0.2)] })).toMatchObject({ ok: true });
    const held = (await fake.surfaceActs(play))!;
    expect(held.acts).toHaveLength(2);
    expect(held.older).toBe(1);
  });

  test('a draw answers with the cells covered and the live list, and the surface reads them back, oldest first, with each draw\'s share', async () => {
    const { fake, anaHeel, play, thread } = wall();
    const written = must(await fake.draw(play, anaHeel, { strokes: [dab(0.5)] }));
    const cells = count(cellsOf([dab(0.5)]));
    expect(cells).toBeGreaterThan(0);
    expect(written).toMatchObject({ kind: 'draw', character: anaHeel, targetActId: play, covered: cells, live: [written.id] });
    expect(written.seq).toBeNull();
    const held = (await fake.surfaceActs(play))!;
    expect(held.covered).toBe(cells);
    expect(held.acts.map((a) => [a.id, a.kind, a.share])).toEqual([[written.id, 'draw', cells]]);
    const page = (await fake.threadPage(thread, {}, null, []))!;
    expect(page.surfaces).toEqual({ [play]: { covered: cells, live: [written.id] } });
  });

  test('a draw nobody draws over keeps its share, and one painted over wholly is no longer live', async () => {
    const { fake, anaHeel, play } = wall();
    const a = must(await fake.draw(play, anaHeel, { strokes: [dab(0.5)] }));
    const b = must(await fake.draw(play, anaHeel, { strokes: [dab(0.5, 0.5, 0.1)] }));
    expect(b.live).toEqual([b.id]);
    expect((await fake.surfaceActs(play))!.older).toBe(1);
    expect(a.id).not.toBe(b.id);
  });

  test('the log reads a surface as the views do: the drawer\'s draw and the wash that cut it, the author\'s walls and washes, and nothing for a third player', async () => {
    const { fake, ana, bo, anaFace, anaHeel, boFace, play, post } = wall();
    const cy = fake.seed.account('cy');
    fake.seed.character(cy, 'Cy Face', 'face');
    fake.signInAs(bo);
    must(await fake.draw(play, boFace, { strokes: [dab(0.5)] }));
    fake.signInAs(ana);
    must(await fake.draw(play, anaHeel, { strokes: [dab(0.2)] }));
    const washed = must(await fake.wash(play, anaFace, { strokes: [dab(0.5, 0.5, 0.02)] }));
    must(await fake.wash(play, anaFace, { strokes: [dab(0.5, 0.5, 0.02)] }));
    const whole = count(cellsOf([dab(0.5)]));
    const took = count(cellsOf([dab(0.5, 0.5, 0.02)]));
    const row = (act: string, kind: string, character: string, mine: string, cells: number) => expect.objectContaining({ act, kind, play, post, character, mine, cells });
    /* The author: the other player's draw on their post, then their own two washes (the second over bare cells took none); their own other mask's draw is the drawer's line. */
    const own = await fake.log();
    expect(own.wallsDrawn!.map((r) => [r.kind, r.character, r.cells])).toEqual([['wash', anaFace, 0], ['wash', anaFace, took], ['draw', boFace, whole]]);
    expect(own.wallsDrawn!.every((r) => r.mine === anaFace && r.post === post && r.play === play)).toBe(true);
    expect(own.wallsDrawn![1]).toEqual(row(washed.id, 'wash', anaFace, anaFace, took));
    expect(own.draws!.map((r) => [r.kind, r.mine, r.cells])).toEqual([['draw', anaHeel, count(cellsOf([dab(0.2)]))]]);
    /* The drawer: the draw, and the wash that cut it (the author's own cut nothing of the draw's twice: the second wash took none). */
    fake.signInAs(bo);
    const drawer = await fake.log();
    expect(drawer.draws!.map((r) => [r.kind, r.character, r.mine, r.cells])).toEqual([['cut', anaFace, boFace, took], ['draw', boFace, boFace, whole]]);
    expect(drawer.wallsDrawn).toEqual([]);
    fake.signInAs(cy);
    const third = await fake.log();
    expect([third.draws, third.wallsDrawn]).toEqual([[], []]);
  });

  test('only the post\'s own character washes, in the database\'s words; a wash takes cells off, and a full wash leaves nothing live', async () => {
    const { fake, anaFace, anaHeel, boFace, play } = wall();
    const ink = { strokes: [dab(0.5)] };
    must(await fake.draw(play, anaHeel, ink));
    expect(await fake.wash(play, anaHeel, ink)).toEqual(refused(sayings.author));
    expect(await fake.wash(play, boFace, ink)).toEqual(refused('you do not play that character'));
    expect(sayings.author).toBe('only the post\'s author washes what is on it');
    const half = must(await fake.wash(play, anaFace, { strokes: [dab(0.5, 0.5, 0.02)] }));
    expect(half).toMatchObject({ kind: 'wash', character: anaFace });
    expect(half.covered).toBe(count(cellsOf([dab(0.5)])) - count(cellsOf([dab(0.5, 0.5, 0.02)])));
    expect(half.live).toHaveLength(2);
    const all = must(await fake.wash(play, anaFace, { strokes: [dab(0.5, 0.5, 0.1)] }));
    expect(all.covered).toBe(0);
    expect(all.live).toEqual([]);
  });

  /* Whodunnit? on a post with a wall (0357's acts_public, fifth select; my_draws' cut rows): a wash is the post's own character's alone, so it would name the author wherever it is read. */
  test('a wash on a post under an author veil is the stand-in\'s, in the wall\'s Acts and in the drawer\'s log; the author\'s own line keeps the name', async () => {
    const who = {
      key: 'whodunnit', name: 'Whodunnit?', alignment: 'pepperoni' as const, rarity: 'rare' as const, reaches: ['post' as const], lasts: { unit: 'day' as const, count: 3 }, veil: 'author' as const,
      playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}), canApply: (t: CardTarget, e: readonly CardEffect[], _c?: unknown, now?: Date) => landsOn({ key: 'whodunnit', reaches: ['post'] }, t, e, now),
    };
    const walled: Instance = { ...surfaced, cards: [slab as unknown as CardRules, who as unknown as CardRules], anonymous: { name: 'Nobody', tagline: '' } };
    const fake = createFake({ instance: walled });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    const post = fake.seed.post(thread, anaFace, 'a post of Ana\'s');
    const play = fake.seed.card(boFace, post, 'slab');
    fake.signInAs(bo);
    must(await fake.draw(play, boFace, { strokes: [dab(0.5)] }));
    fake.signInAs(ana);
    const washed = must(await fake.wash(play, anaFace, { strokes: [dab(0.5, 0.5, 0.02)] }));
    expect((await fake.surfaceActs(play))!.acts.find((a) => a.id === washed.id)).toMatchObject({ character: anaFace });
    fake.seed.cards(bo, { whodunnit: 1 });
    fake.signInAs(bo);
    must(await fake.playCard('whodunnit', boFace, post, {}, ''));
    const stand = (await fake.act(post))!.character!;
    expect(stand).not.toBe(anaFace);
    const held = (await fake.surfaceActs(play))!;
    expect(held.acts.find((a) => a.id === washed.id)).toMatchObject({ kind: 'wash', character: stand });
    expect(held.acts.find((a) => a.kind === 'draw')).toMatchObject({ character: boFace });
    expect((await fake.log()).draws!.filter((r) => r.kind === 'cut').map((r) => r.character)).toEqual([stand]);
    fake.signInAs(ana);
    expect((await fake.log()).wallsDrawn!.filter((r) => r.kind === 'wash').map((r) => r.character)).toEqual([anaFace]);
  });

  test('a draw or a wash on a play that is no surface, or that an admin ended, is refused', async () => {
    const { fake, anaHeel, post, thread } = wall();
    expect(await fake.draw(post, anaHeel, { strokes: [dab(0.5)] })).toEqual(refused('there is no wall on that post'));
    expect(await fake.surfaceActs(post)).toBeNull();
    expect(thread).toBeTruthy();
    const { play: other, fake: f2, anaHeel: h2, ana } = wall();
    const admin = f2.seed.account('boss', { admin: true });
    f2.signInAs(admin);
    must(await f2.reverseCard(other));
    f2.signInAs(ana);
    expect(await f2.draw(other, h2, { strokes: [dab(0.5)] })).toEqual(refused('an admin ended that card'));
  });

  test('a surface\'s change is told on the thread\'s channel as the play and the cells it covers', async () => {
    const { fake, anaHeel, play, thread } = wall();
    const heard: [string, number][] = [];
    fake.subscribeThread(thread, { onSurface: (p, covered) => heard.push([p, covered]) });
    const written = must(await fake.draw(play, anaHeel, { strokes: [dab(0.5)] }));
    await flush();
    expect(heard).toEqual([[play, written.covered]]);
  });
});

/* No quote and a cast earn (card notes part 4, Tasks 3 and 4), as the fake mirrors them; the cards are this test's own. */
describe('a no-quote on a post, and a cast card that carries an earn', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}), canApply: () => ok(undefined) };
  const hush = { ...base, key: 'hush', name: 'Hush', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'noQuote' as const }, reaches: ['post' as const], lasts: { unit: 'day' as const, count: 1 } };
  const move = { ...base, key: 'move', name: 'Move', alignment: 'salty' as const, rarity: 'common' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } } };
  const glow = {
    ...base, key: 'glow', name: 'Glow', alignment: 'sweet' as const, rarity: 'uncommon' as const, reaches: ['character' as const], gimmick: { kind: 'earn' as const, by: 0.1 }, lasts: { unit: 'day' as const, count: 3 },
    canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key: 'glow', reaches: ['character'] }, t, e, now),
  };
  const hype = {
    ...base, key: 'hype', name: 'Hype', alignment: 'sweet' as const, rarity: 'uncommon' as const, reaches: ['post' as const], gimmick: { kind: 'earn' as const, by: 0.1 }, lasts: { unit: 'day' as const, count: 3 },
    canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key: 'hype', reaches: ['post'] }, t, e, now),
  };
  const items = [hush, move, glow, hype].map((c) => ({ item: { card: c.key }, availability: 'onSale' as const, price: 100 }));
  /* On the wall clock: a card's own rules (quoteStop, landsOn) read the time as the server does. */
  function setup() {
    const fake = createFake({ instance: { ...instance, cards: [hush, move, glow, hype], machine: items, settings: { ...settings, economy: {}, postMaxLength: 2000 } }, now: () => Date.now() });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    fake.seed.wallet(ana, 500);
    fake.seed.cards(ana, { hush: 2, move: 2, glow: 2, hype: 2 });
    fake.signInAs(ana);
    return { fake, ana, bo, anaFace, boFace, thread, opener };
  }
  const words = (seq: number | null) => `${seq === null ? 'a post in another thread' : `post ${seq}`} carries Hush, so it cannot be quoted until`;

  test('a quote of a stopped post is refused in the words of noQuoteWords, and the plain reply is written', async () => {
    const { fake, bo, boFace, thread, opener, anaFace } = setup();
    must(await fake.useCard('hush', anaFace, opener, {}, ''));
    fake.signInAs(bo);
    const via = await fake.post(thread, boFace, `Replying.`, opener);
    expect(via).toMatchObject({ ok: false });
    expect((via as Refusal).error).toContain(words(1));
    expect((via as Refusal).error).toMatch(/; take that quote out and send again$/);
    const inBody = await fake.post(thread, boFace, `[quote=${opener}]First post[/quote] no`, null);
    expect((inBody as Refusal).error).toContain(words(1));
    expect(must(await fake.post(thread, boFace, `Replying.`, null)).kind).toBe('post');
    /* A thread started or spun with the quote in its words is refused too, and a spin from the stopped post is not. */
    expect((await fake.startThread('general', boFace, 'New', `[quote=${opener}]First post[/quote]`) as Refusal).error).toContain('a post in another thread');
    expect((await fake.spin(opener, boFace, 'Spun', `[quote=${opener}]First post[/quote]`) as Refusal).error).toContain('a post in another thread');
    expect(must(await fake.spin(opener, boFace, 'Spun', `Plain.`)).act.kind).toBe('spin');
  });

  test('a doctored quote of a stopped post is written (it is a counterfeit, which No-quote never refused), an honest one is refused', async () => {
    const { fake, bo, boFace, thread, opener, anaFace } = setup();
    must(await fake.useCard('hush', anaFace, opener, {}, ''));
    fake.signInAs(bo);
    const doctored = must(await fake.post(thread, boFace, `[quote=${opener}]Words the post never held[/quote] no`, null));
    expect((await fake.actsById([doctored.id]))[0]!.payload).toMatchObject({ forged: [opener] });
    expect(((await fake.post(thread, boFace, `[quote=${opener}]First post[/quote]`, null)) as Refusal).error).toContain(words(1));
    /* A reply whose target is forged drops the target, so the stopped post is not quoted at all. */
    expect((await fake.actsById([must(await fake.post(thread, boFace, `[quote=${opener}]Never held[/quote]`, opener)).id]))[0]!.targetActId).toBeNull();
  });

  test('the post\'s own author is refused the same way, a quote inside code is no quote, and an ended play stops nothing', async () => {
    const { fake, thread, opener, anaFace } = setup();
    must(await fake.useCard('hush', anaFace, opener, {}, ''));
    expect(((await fake.post(thread, anaFace, `Me.`, opener)) as Refusal).error).toContain(words(1));
    expect(must(await fake.post(thread, anaFace, `[code][quote=${opener}]First post[/quote][/code]`, null)).kind).toBe('post');
    fake.clock.advance(2 * 86_400_000);
    expect(must(await fake.post(thread, anaFace, `Me again.`, opener)).kind).toBe('post');
  });

  test('an edit that adds the quote is refused; one that keeps a quote the post already held is written', async () => {
    const { fake, thread, opener, anaFace } = setup();
    const held = must(await fake.post(thread, anaFace, `[quote=${opener}]First post[/quote] first`, null));
    must(await fake.useCard('hush', anaFace, opener, {}, ''));
    expect(must(await fake.edit(held.id, anaFace, `[quote=${opener}]First post[/quote] changed words`)).kind).toBe('post');
    const plain = must(await fake.post(thread, anaFace, `No quote yet.`, null));
    const refusedEdit = await fake.edit(plain.id, anaFace, `[quote=${opener}]First post[/quote] now`);
    expect((refusedEdit as Refusal).error).toContain(words(1));
    /* An edit compares against the post's current body: once an edit drops the quote, one that puts it back adds it. */
    expect(must(await fake.edit(held.id, anaFace, `Dropped the quote.`)).kind).toBe('post');
    const readded = await fake.edit(held.id, anaFace, `[quote=${opener}]First post[/quote] back again`);
    expect((readded as Refusal).error).toContain(words(1));
  });

  test('a no-quote card is refused on a post with a live back, and a set is refused on a stopped post', async () => {
    const { fake, anaFace, thread, opener } = setup();
    const back = must(await fake.setCard('move', anaFace, opener, {}));
    expect(await fake.useCard('hush', anaFace, opener, {}, '')).toEqual(refused('Hush stops quotes, and this post holds a card face down; take that card back first', 'config'));
    must(await fake.takeBack(anaFace, back.id));
    must(await fake.useCard('hush', anaFace, opener, {}, ''));
    const second = must(await fake.post(thread, anaFace, `Another.`, null));
    must(await fake.useCard('hush', anaFace, second.id, {}, ''));
    const set = await fake.setCard('move', anaFace, opener, {});
    expect(set).toMatchObject({ ok: false });
    expect((set as Refusal).error).toMatch(/^this post's Hush stops quotes until .+, so no card is set face down here until then$/);
  });

  test('a cast card that carries an earn lands on another account\'s character and shows among that character\'s effects', async () => {
    const { fake, boFace, thread, anaFace } = setup();
    const theirs = fake.seed.post(thread, boFace, 'Bo here.');
    const board = (await fake.thread(thread))!.board;
    const played = must(await fake.playCard('glow', anaFace, boFace, {}, '', 'character', theirs));
    expect(played).toMatchObject({ kind: 'card', payload: { card: 'glow', reach: 'character', character: boFace } });
    expect(typeof played.payload.ends).toBe('string');
    expect((await fake.effectsAbove([boFace], thread, board)).map((e) => [e.play, e.target])).toEqual([[played.id, boFace]]);
    expect(await fake.playCard('glow', anaFace, boFace, {}, '', 'character', theirs)).toEqual(refused('this character already carries that card', 'config'));
  });

  test('a cast of a post earn card has ends a lasts out, and a second cast on that post is refused until it passes', async () => {
    const { fake, boFace, thread, anaFace } = setup();
    const theirs = fake.seed.post(thread, boFace, 'Bo here.');
    const at = Date.now();
    const played = must(await fake.playCard('hype', anaFace, theirs, {}, ''));
    expect(played).toMatchObject({ kind: 'card', payload: { card: 'hype' } });
    expect(Date.parse(played.payload.ends as string) - at).toBeGreaterThanOrEqual(3 * 86_400_000 - 1000);
    expect(Date.parse(played.payload.ends as string) - at).toBeLessThanOrEqual(3 * 86_400_000 + 1000);
    expect(await fake.playCard('hype', anaFace, theirs, {}, '')).toMatchObject({ ok: false });
    fake.clock.advance(4 * 86_400_000);
    expect(must(await fake.playCard('hype', anaFace, theirs, {}, '')).kind).toBe('card');
  });

  test('a caught cast of a post earn card holds no end, as place_cast writes it (0370)', async () => {
    const collector = { ...base, key: 'collector', name: 'Collector', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'hype' };
    const fake = createFake({ instance: { ...instance, cards: [hype, collector], settings: { ...settings, economy: {} } }, now: () => Date.now() });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    fake.seed.cards(ana, { collector: 1 });
    fake.seed.cards(bo, { hype: 1 });
    fake.signInAs(ana);
    const set = must(await fake.setCard('collector', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('hype', boFace, opener, {}, ''));
    expect(caught.payload.caught).toBe(set.id);
    expect(caught.payload).not.toHaveProperty('ends');
  });
});

describe('post veils, blind totals and a post-local reaction (card notes, Part 3, Task 7)', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
  const lands = (rules: Pick<CardRules, 'key' | 'stack' | 'reaches'>) => (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn(rules, t, e, now);
  const hearts: Instance['reactions'] = [...instance.reactions, { key: 'heart', emoji: '\u2764\uFE0F', quadrant: 'calmPositive' }];
  const three = { unit: 'day' as const, count: 3 };
  const whodunnit = { ...base, key: 'whodunnit', name: 'Whodunnit?', alignment: 'pepperoni' as const, rarity: 'rare' as const, reaches: ['post' as const], lasts: three, veil: 'author' as const, canApply: lands({ key: 'whodunnit', reaches: ['post'] }) };
  const blind = { ...base, key: 'blind-study', name: 'Blind Study', alignment: 'pepperoni' as const, rarity: 'uncommon' as const, reaches: ['post' as const], lasts: three, veil: 'totals' as const, canApply: lands({ key: 'blind-study', reaches: ['post'] }) };
  const overreaction = {
    ...base, key: 'overreaction', name: 'Overreaction', alignment: 'pepperoni' as const, rarity: 'common' as const, reaches: ['post' as const], stack: 3, reaction: true as const,
    validateConfig: (c: unknown) => localReaction(c, hearts), canApply: lands({ key: 'overreaction', stack: 3, reaches: ['post'] }),
  };
  const glow = { ...base, key: 'glow', name: 'Glow', alignment: 'sweet' as const, rarity: 'uncommon' as const, reaches: ['character' as const], lasts: three, canApply: lands({ key: 'glow', reaches: ['character'] }) };
  const cards = [whodunnit, blind, overreaction, glow];
  const veils: Instance = { ...instance, cards, reactions: hearts, anonymous: { name: 'Nobody', tagline: '' }, machine: cards.map((c) => ({ item: { card: c.key }, availability: 'onSale' as const, price: 100 })), settings: { ...settings, economy: {}, postMaxLength: 2000 } };
  const skull = { emoji: '\u{1F480}', quadrant: 'excitedPositive' };
  /** Ana plays the cards; Bo wrote the post that opens the thread, and Cy is a third player. Signed in as Ana. */
  function veilWorld(on: Instance = veils) {
    const fake = createFake({ instance: on });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const cy = fake.seed.account('cy');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const cyFace = fake.seed.character(cy, 'Cy Face', 'face');
    const { thread, act: post } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    fake.seed.cards(ana, { whodunnit: 3, 'blind-study': 3, overreaction: 5, glow: 2 });
    fake.signInAs(ana);
    return { fake, ana, bo, cy, anaFace, boFace, cyFace, thread, post };
  }
  type VeilWorld = ReturnType<typeof veilWorld>;
  /** Ana's Whodunnit? on the post; the stand-in's id, as every reader finds it: the veiled post's character. */
  const veil = async (w: VeilWorld) => { must(await w.fake.playCard('whodunnit', w.anaFace, w.post, {}, '')); return (await w.fake.act(w.post))!.character!; };
  const pageActs = async (w: VeilWorld, as: string) => { w.fake.signInAs(as); return (await w.fake.threadPage(w.thread, { page: 1 }, 5, []))!; };

  test('a report under a veil names the stand-in as its asker, as acts_public shows it', async () => {
    const w = veilWorld();
    const stand = await veil(w);
    const report = w.fake.seed.report(w.boFace, w.post, 'my own');
    w.fake.signInAs(w.ana);
    const place = must(await w.fake.spin(report, w.anaFace, 'About it', 'b')).thread.origin;
    expect(place).toMatchObject({ kind: 'answer', spun: 'ask', asker: { id: stand } });
    expect(JSON.stringify(place)).not.toContain(w.boFace);
  });

  test('the stand-in is a character of its own, named by the instance (else the engine\'s plain one), holding the anonymous office, and no player\'s', async () => {
    const w = veilWorld();
    const stand = await veil(w);
    expect(stand).not.toBe(w.boFace);
    expect((await w.fake.characters([stand]))[0]).toMatchObject({ id: stand, name: 'Nobody', staff: 'anonymous', office: 'anonymous' });
    expect((await w.fake.myCharacters()).map((c) => c.id)).not.toContain(stand);
    const plain = veilWorld({ ...veils, anonymous: undefined });
    expect((await plain.fake.characters([await veil(plain)]))[0]).toMatchObject({ name: 'Anonymous' });
  });

  test('a veiled post shows the stand-in in the page with its edit, for every reader; the author\'s reply elsewhere and another\'s card on it keep their names; it ends by itself, and by an admin', async () => {
    const w = veilWorld();
    const reply = w.fake.seed.thread('general', w.boFace, 'Elsewhere', 'a reply elsewhere').act;
    w.fake.signInAs(w.ana);
    w.fake.signInAs(w.bo);
    must(await w.fake.edit(w.post, w.boFace, 'First post, edited'));
    w.fake.signInAs(w.ana);
    const stand = await veil(w);
    const card = must(await w.fake.playCard('overreaction', w.anaFace, w.post, skull, ''));
    for (const reader of [w.ana, w.bo, w.cy]) {
      const page = await pageActs(w, reader);
      expect(page.acts.filter((a) => a.id === w.post).map((a) => a.character)).toEqual([stand]);
      expect((await w.fake.history(w.post)).map((a) => [a.kind, a.character])).toEqual([['post', stand], ['edit', stand]]);
      expect(page.plays.find((a) => a.id === card.id)!.character).toBe(w.anaFace);
      expect(page.people.map((p) => p.character.id)).toContain(stand);
      expect(page.people.map((p) => p.character.id)).not.toContain(w.boFace);
    }
    expect((await w.fake.act(reply))!.character).toBe(w.boFace);
    /* Only the author's player is told that the post is theirs, and until when. */
    const mine = (await pageActs(w, w.bo)).veiled;
    expect(mine).toEqual([{ post: w.post, character: w.boFace, play: expect.any(String), endsAt: new Date(w.fake.clock.now() + 3 * DAY).toISOString() }]);
    expect((await pageActs(w, w.cy)).veiled).toEqual([]);
    expect((await pageActs(w, w.ana)).veiled).toEqual([]);
    /* A second is refused while it is up. At its end the author shows again, and the same card lands again. */
    w.fake.signInAs(w.ana);
    expect(await w.fake.playCard('whodunnit', w.anaFace, w.post, {}, '')).toMatchObject({ ok: false, error: 'this post already carries that card' });
    w.fake.clock.advance(3 * DAY + MINUTE);
    expect((await w.fake.history(w.post)).map((a) => a.character)).toEqual([w.boFace, w.boFace]);
    expect((await pageActs(w, w.bo)).veiled).toEqual([]);
    w.fake.signInAs(w.ana);
    const again = must(await w.fake.playCard('whodunnit', w.anaFace, w.post, {}, ''));
    expect((await w.fake.act(w.post))!.character).toBe(stand);
    w.fake.signInAs(w.fake.seed.account('boss', { admin: true }));
    must(await w.fake.reverseCard(again.id));
    expect((await w.fake.act(w.post))!.character).toBe(w.boFace);
  });

  /* A Move landing from a quote is not modeled by the fake (a quote springs nothing); the card a back laid, which names its spring, is seeded as the server writes it (0357's lay_sprung). */
  test('the card a back of the author\'s laid on a quote is the stand-in\'s while the veil is up, and returns with it; a veil is refused on a post one of whose backs has sprung', async () => {
    const w = veilWorld();
    const back = w.fake.seed.set(w.boFace, w.post, 'glow');
    const stand = await veil(w);
    const quote = w.fake.seed.post(w.thread, w.cyFace, 'Quoting the veiled post.');
    const spring = w.fake.seed.spring(back, { by: quote, trigger: 'quote' });
    const laid = w.fake.seed.card(w.boFace, quote, 'overreaction', { spring });
    for (const reader of [w.ana, w.bo, w.cy]) {
      w.fake.signInAs(reader);
      expect((await w.fake.act(laid))!.character).toBe(stand);
      expect((await w.fake.act(spring))!.character).toBe(stand);
    }
    w.fake.clock.advance(3 * DAY + MINUTE);
    expect((await w.fake.act(laid))!.character).toBe(w.boFace);
    /* The other order: the back sprang first, and the veil is refused for any caster. */
    const other = w.fake.seed.thread('general', w.boFace, 'Another', 'Another post.');
    const back2 = w.fake.seed.set(w.boFace, other.act, 'glow');
    w.fake.seed.spring(back2, { by: quote, trigger: 'quote' });
    w.fake.signInAs(w.ana);
    expect(await w.fake.playCard('whodunnit', w.anaFace, other.act, {}, '')).toEqual(refused('a card set on this post has sprung, so its author is on the record'));
    /* A back still face down leaves the post free. */
    const third = w.fake.seed.thread('general', w.boFace, 'Third', 'Third post.');
    w.fake.seed.set(w.boFace, third.act, 'glow');
    must(await w.fake.playCard('whodunnit', w.anaFace, third.act, {}, ''));
    expect((await w.fake.act(third.act))!.character).toBe(stand);
  });

  /* my_cards_ended (0357): the caster of a card that landed on the caller's post is named as acts_public shows the play. The fake lays no Move from a quote, so the card is seeded (`seed.card` with `spring`, after `seed.spring`), the nearest case. */
  test('an admin\'s end of the card a veiled post\'s back laid on a quote names the stand-in as the caster to the quote\'s owner, and the true name returns with the veil', async () => {
    const w = veilWorld();
    const back = w.fake.seed.set(w.boFace, w.post, 'glow');
    const stand = await veil(w);
    const quote = w.fake.seed.post(w.thread, w.cyFace, 'Quoting the veiled post.');
    const spring = w.fake.seed.spring(back, { by: quote, trigger: 'quote' });
    const laid = w.fake.seed.card(w.boFace, quote, 'overreaction', { spring });
    w.fake.signInAs(w.fake.seed.account('boss', { admin: true }));
    must(await w.fake.reverseCard(laid));
    w.fake.signInAs(w.cy);
    const rows = async () => (await w.fake.log()).ended.filter((e) => e.play === laid);
    expect(await rows()).toMatchObject([{ side: 'onMine', character: w.cyFace, casterName: 'Nobody' }]);
    expect(JSON.stringify(await w.fake.log())).not.toContain('Bo Face');
    w.fake.clock.advance(3 * DAY + MINUTE);
    expect(await rows()).toMatchObject([{ side: 'onMine', casterName: 'Bo Face' }]);
  });

  test('a profile\'s list leaves a veiled post out of its author\'s and puts it in the stand-in\'s, and the counts follow', async () => {
    const w = veilWorld();
    const before = await w.fake.profilePage(w.boFace);
    expect(before!.acts.map((a) => a.id)).toEqual([w.post]);
    expect(before!.counts.posts).toBe(1);
    const stand = await veil(w);
    const author = await w.fake.profilePage(w.boFace);
    expect(author!.acts).toEqual([]);
    expect(author!.counts.posts).toBe(0);
    const shown = await w.fake.profilePage(stand);
    expect(shown!.acts.map((a) => [a.id, a.character])).toEqual([[w.post, stand]]);
    expect(shown!.counts.posts).toBe(1);
  });

  test('the author\'s own quote of a veiled post and a spin from it stay theirs in every read, with the counts agreeing with the lists; a veil on the quote itself hides it', async () => {
    const w = veilWorld();
    const quote = w.fake.seed.post(w.thread, w.boFace, 'Quoting my own post', { quote: w.post });
    w.fake.signInAs(w.bo);
    const spun = must(await w.fake.spin(w.post, w.boFace, 'Spun', 'From my own post'));
    w.fake.signInAs(w.ana);
    const stand = await veil(w);
    /* Only the post is veiled (and what its author did to it that is no post or spin of its own): the quote and the spin are Bo's, in the page, by id and in Bo's list. */
    expect((await w.fake.act(w.post))!.character).toBe(stand);
    expect((await w.fake.act(quote))!.character).toBe(w.boFace);
    expect((await w.fake.act(spun.act.id))!.character).toBe(w.boFace);
    expect((await pageActs(w, w.cy)).acts.find((a) => a.id === quote)!.character).toBe(w.boFace);
    const mine = await w.fake.profilePage(w.boFace);
    expect(mine!.acts.map((a) => a.id).sort()).toEqual([quote, spun.act.id].sort());
    expect(mine!.counts).toEqual({ posts: 1, spins: 1, cards: 0 });
    /* A veil cast on the quote itself hides it, once, and the counts move with the list. */
    w.fake.signInAs(w.ana);
    must(await w.fake.playCard('whodunnit', w.anaFace, quote, {}, ''));
    expect((await w.fake.act(quote))!.character).toBe(stand);
    expect((await w.fake.history(quote)).map((a) => a.character)).toEqual([stand]);
    const hidden = await w.fake.profilePage(w.boFace);
    expect(hidden!.acts.map((a) => a.id)).toEqual([spun.act.id]);
    expect(hidden!.counts).toEqual({ posts: 0, spins: 1, cards: 0 });
  });

  test('a character at a rung\'s threshold shows the rung below while one of its posts is veiled, as its count does, and both return at the end', async () => {
    const ladder = [
      { key: 'low', name: 'Low', color: '#101010', when: { kind: 'default' as const } },
      { key: 'high', name: 'High', color: '#202020', when: { kind: 'posts' as const, atLeast: 2 } },
      { key: 'staff', name: 'Staff', color: '#303030', when: { kind: 'staff' as const } },
    ];
    const w = veilWorld({ ...veils, groups: { ladder, conferred: [] } });
    w.fake.seed.post(w.thread, w.boFace, 'A second post of Bo\'s');
    const group = async () => (await w.fake.characters([w.boFace]))[0]!.group;
    expect(await group()).toBe('high');
    expect((await w.fake.characterCounts(w.boFace)).posts).toBe(2);
    await veil(w);
    expect((await w.fake.characterCounts(w.boFace)).posts).toBe(1);
    expect(await group()).toBe('low');
    w.fake.clock.advance(3 * DAY + MINUTE);
    expect((await w.fake.characterCounts(w.boFace)).posts).toBe(2);
    expect(await group()).toBe('high');
  });

  test('a search by the author does not find a veiled post, a search by the stand-in does, and a hit names the stand-in', async () => {
    const w = veilWorld();
    const query = (author: string | null) => ({ q: 'First', author, board: null, fromAt: null, toAt: null, titlesOnly: false, sort: null, perPage: null });
    expect((await w.fake.searchPosts(query(w.boFace))).results.map((r) => r.act)).toEqual([w.post]);
    const stand = await veil(w);
    expect((await w.fake.searchPosts(query(w.boFace))).results).toEqual([]);
    expect((await w.fake.searchPosts(query(stand))).results.map((r) => [r.act, r.character, r.name])).toEqual([[w.post, stand, 'Nobody']]);
    expect((await w.fake.searchPosts(query(null))).results.map((r) => [r.character, r.name])).toEqual([[stand, 'Nobody']]);
    expect((await w.fake.searchThreads(query(null))).results.map((r) => [r.character, r.name])).toEqual([[stand, 'Nobody']]);
  });

  test('an alert about a quote of a veiled post carries the post under the stand-in, and its people', async () => {
    const w = veilWorld();
    const stand = await veil(w);
    const quote = must(await w.fake.post(w.thread, w.anaFace, 'I quote that', w.post));
    w.fake.signInAs(w.bo);
    const page = await w.fake.alertsPage(null);
    expect(page.alerts.map((a) => a.act)).toContain(quote.id);
    expect(page.acts.find((a) => a.id === w.post)!.character).toBe(stand);
    expect(page.people.map((p) => p.id)).toContain(stand);
    expect(page.people.map((p) => p.id)).not.toContain(w.boFace);
  });

  test('the thread list names the stand-in as the first and last poster of a thread whose opening or newest post is veiled', async () => {
    const w = veilWorld();
    const stand = await veil(w);
    expect(await w.fake.thread(w.thread)).toMatchObject({ firstCharacter: stand, lastCharacter: stand });
    expect((await w.fake.threads((await w.fake.board('general'))!.id, { offset: 0, limit: 20 })).threads[0]).toMatchObject({ firstCharacter: stand, lastCharacter: stand });
    w.fake.seed.post(w.thread, w.cyFace, 'later');
    expect(await w.fake.thread(w.thread)).toMatchObject({ firstCharacter: stand, lastCharacter: w.cyFace });
  });

  test('the log\'s ended row for a card an admin ended on a veiled post names the stand-in as the post\'s author while the veil is live', async () => {
    const w = veilWorld();
    const stand = await veil(w);
    const play = must(await w.fake.playCard('overreaction', w.anaFace, w.post, skull, ''));
    w.fake.signInAs(w.fake.seed.account('boss', { admin: true }));
    must(await w.fake.reverseCard(play.id));
    w.fake.signInAs(w.ana);
    expect((await w.fake.log()).ended).toMatchObject([{ play: play.id, postAuthorName: 'Nobody' }]);
    expect(stand).not.toBe(w.boFace);
  });

  test('a veiled post\'s moment lists no play on the real author\'s character', async () => {
    const w = veilWorld();
    /* A card played from this post would name its author, and a veil is refused on such a post (land_refusal); so the glow is played from another of Bo's. */
    const elsewhere = w.fake.seed.thread('general', w.boFace, 'Elsewhere', 'Another post of Bo\'s.').act;
    must(await w.fake.playCard('glow', w.anaFace, w.boFace, {}, '', 'character', elsewhere));
    w.fake.clock.advance(MINUTE);
    const play = must(await w.fake.playCard('whodunnit', w.anaFace, w.post, {}, ''));
    expect((await w.fake.playMoment(play.id))!.above).toEqual([]);
  });

  test('a character\'s card count leaves out its own use card on its own veiled post, as its list does', async () => {
    const w = veilWorld();
    const mine = w.fake.seed.post(w.thread, w.anaFace, 'Ana\'s post');
    must(await w.fake.playCard('overreaction', w.anaFace, mine, skull, ''));
    w.fake.seed.cards(w.cy, { whodunnit: 1 });
    w.fake.signInAs(w.cy);
    must(await w.fake.playCard('whodunnit', w.cyFace, mine, {}, ''));
    const listed = (await w.fake.characterActs(w.anaFace, ['card'], { offset: 0, limit: 50 })).length;
    expect((await w.fake.characterCounts(w.anaFace)).cards).toBe(listed);
  });

  test('a veil is refused on a post by the staff and on a post a Mod Bot has been to, in the same words, and a character card on the stand-in is refused', async () => {
    const w = veilWorld();
    const mod = w.fake.seed.staff('s-mod', 'Mod Staff', 'mod');
    const staffPost = w.fake.seed.staffPost(mod, w.thread, 'From the staff');
    expect(await w.fake.playCard('whodunnit', w.anaFace, staffPost, {}, '')).toEqual(refused('a post by the staff keeps its name'));
    const visited = w.fake.seed.post(w.thread, w.cyFace, 'Visited');
    w.fake.seed.visit(mod, visited);
    expect(await w.fake.playCard('whodunnit', w.anaFace, visited, {}, '')).toEqual(refused('a Mod Bot has been to this post, so its author is on the record'));
    expect(await w.fake.myCards().then((h) => h.find((c) => c.card === 'whodunnit')?.held)).toBe(3);
    const stand = await veil(w);
    expect(await w.fake.playCard('glow', w.anaFace, stand, {}, '', 'character', w.post)).toEqual(refused('no card is played on a stand-in'));
    expect(await w.fake.myCards().then((h) => h.find((c) => c.card === 'glow')?.held)).toBe(2);
  });

  test('a card played from a post names its author: no veil on that post (land_refusal), and no card on the author\'s character is played from a veiled one, which the stand-in is shown for (place_cast, 0359)', async () => {
    const w = veilWorld();
    const played = w.fake.seed.thread('general', w.boFace, 'Played from', 'A post a card is played from.').act;
    must(await w.fake.playCard('glow', w.anaFace, w.boFace, {}, '', 'character', played));
    const held = (await w.fake.myCards()).find((c) => c.card === 'whodunnit')?.held;
    expect(await w.fake.playCard('whodunnit', w.anaFace, played, {}, '')).toEqual(refused('a card played from this post names its author, so the author is on the record'));
    expect((await w.fake.myCards()).find((c) => c.card === 'whodunnit')?.held).toBe(held);
    /* The other order: the post is veiled first, so it is shown under the stand-in, and a card on its real author is a card on the stand-in however it is named. */
    await veil(w);
    const glows = (await w.fake.myCards()).find((c) => c.card === 'glow')?.held;
    expect(await w.fake.playCard('glow', w.anaFace, w.boFace, {}, '', 'character', w.post)).toEqual(refused('no card is played on a stand-in'));
    expect((await w.fake.myCards()).find((c) => c.card === 'glow')?.held).toBe(glows);
  });

  test('a board\'s demand counts a veiled post under the stand-in, a staff character, so it drops out while the veil is up and counts again at its end (demand_progress, 0359)', async () => {
    const w = veilWorld();
    w.fake.seed.staff('director', 'The Director', 'boss');
    const move = w.fake.seed.move('director', { board: 'general', name: 'Counted Hall', demand: { kind: 'postsOnBoard', params: { board: 'general', count: 5 } } });
    w.fake.clock.advance(MINUTE);
    const mine = w.fake.seed.post(w.thread, w.boFace, 'Bo\'s post after the move');
    w.fake.seed.post(w.thread, w.cyFace, 'Cy\'s post after the move');
    const done = async () => (await w.fake.moveNotice(move))?.progress?.done;
    expect(await done()).toBe(2);
    must(await w.fake.playCard('whodunnit', w.anaFace, mine, {}, ''));
    expect(await done()).toBe(1);
    w.fake.clock.advance(3 * DAY + MINUTE);
    expect(await done()).toBe(2);
  });

  test('a spin pressed at a post names its author: no veil on that post, and no spin pressed at a veiled one, in the words any other post gets (0357, land_refusal and spin_written)', async () => {
    const w = veilWorld();
    const glint = w.fake.seed.reach(w.cyFace, 'character', w.boFace, 'glint', { post: w.post });
    const pressed = w.fake.seed.post(w.thread, w.boFace, 'A spin is pressed at this');
    const hidden = w.fake.seed.post(w.thread, w.boFace, 'Veiled before any spin');
    const other = w.fake.seed.post(w.thread, w.cyFace, 'Not Bo\'s');
    w.fake.signInAs(w.cy);
    must(await w.fake.spin(glint, w.cyFace, 'Spun at', 'b', undefined, pressed));
    w.fake.signInAs(w.ana);
    expect(await w.fake.playCard('whodunnit', w.anaFace, pressed, {}, '')).toEqual(refused('a spin was pressed at this post, so its author is on the record'));
    expect(await w.fake.myCards().then((h) => h.find((c) => c.card === 'whodunnit')?.held)).toBe(3);
    must(await w.fake.playCard('whodunnit', w.anaFace, hidden, {}, ''));
    w.fake.signInAs(w.cy);
    expect(await w.fake.spin(glint, w.cyFace, 'Spun at', 'b', undefined, hidden)).toEqual(refused('that card is not on that post'));
    expect(await w.fake.spin(glint, w.cyFace, 'Spun at', 'b', undefined, other)).toEqual(refused('that card is not on that post'));
  });

  test('a reply cut in by a card that replies names its author and its post: no veil on the reply, none on a post its own author cut in under, and no Line Cutter on a veiled post (0357, land_refusal)', async () => {
    const cutter = { ...base, key: 'line-cutter', name: 'Line Cutter', alignment: 'pepperoni' as const, rarity: 'rare' as const, replies: true as const, canApply: lands({ key: 'line-cutter', reaches: ['post'] }) };
    const w = veilWorld({ ...veils, cards: [...cards, cutter] });
    w.fake.seed.cards(w.bo, { 'line-cutter': 2 });
    w.fake.seed.cards(w.cy, { 'line-cutter': 2 });
    const cut = async (as: string, face: string, under: string) => { w.fake.signInAs(as); return w.fake.playCard('line-cutter', face, under, {}, '', undefined, undefined, undefined, { body: 'Excuse me.' }); };
    /* Cy cuts in under Bo's post. A veil on that reply is refused (the card Act names the reply and its caster), and one on the post is not (nothing of the reply names Bo). */
    const cy = must(await cut(w.cy, w.cyFace, w.post));
    w.fake.signInAs(w.ana);
    expect(await w.fake.playCard('whodunnit', w.anaFace, cy.payload.reply as string, {}, '')).toEqual(refused('a card cut this post in under another, so its author is on the record'));
    /* Bo cuts in under his own second post: a veil on that post is refused, the card is kept. */
    const mine = w.fake.seed.post(w.thread, w.boFace, 'Bo writes under himself');
    must(await cut(w.bo, w.boFace, mine));
    w.fake.signInAs(w.ana);
    expect(await w.fake.playCard('whodunnit', w.anaFace, mine, {}, '')).toEqual(refused('its author cut a reply in under this post, so the author is on the record'));
    expect(await w.fake.myCards().then((h) => h.find((c) => c.card === 'whodunnit')?.held)).toBe(3);
    /* A veiled post takes no Line Cutter, from its author or from anyone, in words that tell them apart from nobody. */
    const fresh = w.fake.seed.post(w.thread, w.boFace, 'Bo, veiled before anyone cuts in');
    must(await w.fake.playCard('whodunnit', w.anaFace, fresh, {}, ''));
    const until = new Date(w.fake.clock.now() + 3 * DAY).toISOString().slice(0, 16).replace('T', ' ');
    const words = refused(`this post's author is hidden until ${until} UTC; no reply is cut in under it before then`);
    expect(await cut(w.bo, w.boFace, fresh)).toEqual(words);
    expect(await cut(w.cy, w.cyFace, fresh)).toEqual(words);
    /* A veil on a post another character cut in under is allowed, and the reply names that character and not the author. */
    w.fake.signInAs(w.ana);
    must(await w.fake.playCard('whodunnit', w.anaFace, w.post, {}, ''));
    const page = await pageActs(w, w.cy);
    const mineUnder = page.under.filter((u) => u.parent === w.post);
    expect(mineUnder.map((u) => u.act.character)).toEqual([w.cyFace]);
    expect(JSON.stringify(mineUnder)).not.toContain(w.boFace);
    expect(await w.fake.myCards().then((h) => h.find((c) => c.card === 'line-cutter')?.held)).toBe(1);
  });

  test('a report of a veiled post is refused before anything is paid, saying when its author shows again', async () => {
    const w = veilWorld();
    w.fake.seed.staff('s-mod', 'Mod Staff', 'mod');
    w.fake.seed.wallet(w.ana, 500);
    await veil(w);
    const until = new Date(w.fake.clock.now() + 3 * DAY).toISOString().slice(0, 16).replace('T', ' ');
    expect(await w.fake.fileReport(w.anaFace, w.post, 'rude')).toEqual(refused(`this post's author is hidden until ${until} UTC; report it after`));
    expect(await w.fake.wallet()).toEqual({ balance: 500, cap: 600 });
    expect(await w.fake.reportsLeft(w.anaFace)).toBe(3);
  });

  /** A report judged a visit that opens none gets its price back (report-no-visit plan, Task 3). */
  describe('a visit verdict that opens no visit', () => {
    const noVisitWorld = () => {
      const w = veilWorld();
      const mod = w.fake.seed.staff('s-mod', 'Mod Staff', 'mod');
      w.fake.seed.wallet(w.ana, 500);
      w.fake.seed.judging({ report: 'visit' });
      const visitActs = async () => (await w.fake.threadPage(w.thread, { page: 1 }, 5, []))!.visits;
      return { ...w, mod, visitActs };
    };
    test('a veil that lands while the Mod judges: no visit, refund veiled, the wallet back, the quota spent, the log and no visit Act', async () => {
      const w = noVisitWorld();
      let played: ReturnType<typeof w.fake.playCard> | undefined;
      w.fake.seed.judging({ meanwhile: () => { played = w.fake.playCard('whodunnit', w.anaFace, w.post, {}, ''); } });
      const a = await w.fake.fileReport(w.anaFace, w.post, 'rude');
      must(await played!);
      expect(a).toMatchObject({ ok: true, value: { verdict: 'visit', visit: null, refund: { why: 'veiled', amount: 25 } } });
      expect(await w.fake.wallet()).toEqual({ balance: 500, cap: 600 });
      expect(await w.fake.reportsLeft(w.anaFace)).toBe(2);
      expect((await w.fake.log()).reports[0]).toMatchObject({ verdict: 'visit', refund: 'veiled' });
      expect(await w.visitActs()).toEqual([]);
    });
    test('a post whose earlier report visit has ended: refund visited, the same; a reversed one does not count', async () => {
      const w = noVisitWorld();
      const earlier = w.fake.seed.visit(w.mod, w.post, { charges: [{ cause: 'report' }] });
      w.fake.seed.visitEnd(earlier, { outcome: 'filed' });
      const a = await w.fake.fileReport(w.anaFace, w.post, 'rude');
      expect(a).toMatchObject({ ok: true, value: { verdict: 'visit', visit: null, refund: { why: 'visited', amount: 25 } } });
      expect(await w.fake.wallet()).toEqual({ balance: 500, cap: 600 });
      expect(await w.fake.reportsLeft(w.anaFace)).toBe(2);
      expect((await w.fake.log()).reports[0]).toMatchObject({ refund: 'visited' });
      expect(await w.visitActs()).toHaveLength(1);
      const other = w.fake.seed.post(w.thread, w.cyFace, 'Another');
      const gone = w.fake.seed.visit(w.mod, other, { charges: [{ cause: 'report' }] });
      w.fake.seed.visitEnd(gone, { outcome: 'reversed' });
      const b = await w.fake.fileReport(w.anaFace, other, 'rude');
      expect(b).toMatchObject({ ok: true, value: { verdict: 'visit', refund: null } });
      expect(b.ok && b.value.visit).not.toBeNull();
      expect(b.ok && b.value.visit).not.toBe(gone);
    });
    test('a failed judgment clears the meanwhile hook: the next report does not run it', async () => {
      const w = noVisitWorld();
      let ran = 0;
      w.fake.seed.judging({ report: 'failed', meanwhile: () => { ran += 1; } });
      expect(await w.fake.fileReport(w.anaFace, w.post, 'rude')).toMatchObject({ ok: false });
      w.fake.seed.judging({ report: 'visit' });
      expect(await w.fake.fileReport(w.anaFace, w.post, 'rude')).toMatchObject({ ok: true, value: { verdict: 'visit' } });
      expect(ran).toBe(0);
    });
    test('a repeat while an older visit is still open answers it, though a newer one ended: no refund', async () => {
      const w = noVisitWorld();
      const older = w.fake.seed.visit(w.mod, w.post, { charges: [{ cause: 'report' }] });
      w.fake.clock.advance(1000);
      const newer = w.fake.seed.visit(w.mod, w.post, { charges: [{ cause: 'report' }] });
      w.fake.seed.visitEnd(newer, { outcome: 'filed' });
      const a = await w.fake.fileReport(w.anaFace, w.post, 'rude');
      expect(a).toMatchObject({ ok: true, value: { verdict: 'visit', visit: older, refund: null } });
      expect(await w.fake.wallet()).toEqual({ balance: 475, cap: 600 });
    });
    test('with that visit still open: the report joins it, no new visit Act, no refund', async () => {
      const w = noVisitWorld();
      const open = w.fake.seed.visit(w.mod, w.post, { charges: [{ cause: 'report' }] });
      const a = await w.fake.fileReport(w.anaFace, w.post, 'rude');
      expect(a).toMatchObject({ ok: true, value: { verdict: 'visit', visit: open, refund: null } });
      expect(await w.fake.wallet()).toEqual({ balance: 475, cap: 600 });
      expect(await w.visitActs()).toHaveLength(1);
      expect((await w.fake.log()).reports[0]!.refund).toBeNull();
    });
    test('the Mod\'s moves log says on each report row whether its verdict carried a visit', async () => {
      const w = noVisitWorld();
      const earlier = w.fake.seed.visit(w.mod, w.post, { charges: [{ cause: 'report' }] });
      w.fake.seed.visitEnd(earlier, { outcome: 'filed' });
      await w.fake.fileReport(w.anaFace, w.post, 'rude');
      const fresh = w.fake.seed.post(w.thread, w.cyFace, 'Fresh');
      await w.fake.fileReport(w.anaFace, fresh, 'rude');
      w.fake.seed.judging({ report: 'dismissed' });
      const other = w.fake.seed.post(w.thread, w.cyFace, 'Another');
      await w.fake.fileReport(w.anaFace, other, 'rude');
      const rows = (await w.fake.movesLog('s-mod')).rows.filter((r) => r.kind === 'report');
      expect(rows.map((r) => [r.params['verdict'], r.params['visited']]).sort()).toEqual([['dismissed', false], ['visit', false], ['visit', true]]);
    });
  });

  test('a blind post gives its tallies to its author\'s player and the caster alone, and a reaction to it answers no tally and sends none', async () => {
    const w = veilWorld();
    must(await w.fake.playCard('blind-study', w.anaFace, w.post, {}, ''));
    w.fake.seed.tally(w.post, { fire: 2 });
    w.fake.signInAs(w.cy);
    const heard: Tally[] = [];
    w.fake.subscribeThread(w.thread, { onTally: (_act, tally: Tally) => heard.push(tally) });
    expect(must(await w.fake.react(w.post, w.cyFace, 'tea'))).toEqual({ act: w.post, tally: null });
    await flush();
    expect(heard).toEqual([]);
    expect((await pageActs(w, w.cy)).tallies[w.post]).toEqual({});
    expect(await w.fake.tallies([w.post])).toEqual({ [w.post]: {} });
    expect((await pageActs(w, w.bo)).tallies[w.post]).toEqual({ fire: 2, tea: 1 });
    expect((await pageActs(w, w.ana)).tallies[w.post]).toEqual({ fire: 2, tea: 1 });
    expect(must(await w.fake.react(w.post, w.anaFace, 'zzz'))).toEqual({ act: w.post, tally: null });
    w.fake.clock.advance(3 * DAY + MINUTE);
    expect((await pageActs(w, w.cy)).tallies[w.post]).toEqual({ fire: 2, tea: 1, zzz: 1 });
    expect(must(await w.fake.react(w.post, w.cyFace, 'fire')).tally).toEqual({ fire: 3, tea: 1, zzz: 1 });
  });

  test('a blind post comes back to everyone at an admin\'s end', async () => {
    const w = veilWorld();
    const play = must(await w.fake.playCard('blind-study', w.anaFace, w.post, {}, ''));
    w.fake.seed.tally(w.post, { fire: 2 });
    expect((await pageActs(w, w.cy)).tallies[w.post]).toEqual({});
    w.fake.signInAs(w.fake.seed.account('boss', { admin: true }));
    must(await w.fake.reverseCard(play.id));
    expect((await pageActs(w, w.cy)).tallies[w.post]).toEqual({ fire: 2 });
  });

  test('a post-local kind is taken by react on its post alone, refused on another post, repeated, and once its play is ended', async () => {
    const w = veilWorld();
    const elsewhere = w.fake.seed.post(w.thread, w.boFace, 'Another post');
    const play = must(await w.fake.playCard('overreaction', w.anaFace, w.post, skull, ''));
    w.fake.signInAs(w.cy);
    expect(must(await w.fake.react(w.post, w.cyFace, 'x-1f480'))).toEqual({ act: w.post, tally: { 'x-1f480': 1 } });
    expect(await w.fake.react(elsewhere, w.cyFace, 'x-1f480')).toEqual(refused('there is no reaction "x-1f480"', 'kind'));
    expect(await w.fake.react(w.post, w.cyFace, 'x-1f4a9')).toEqual(refused('there is no reaction "x-1f4a9"', 'kind'));
    w.fake.signInAs(w.ana);
    expect(await w.fake.playCard('overreaction', w.anaFace, w.post, skull, '')).toEqual(refused('this post already has that reaction', 'config'));
    expect(await w.fake.playCard('overreaction', w.anaFace, w.post, { emoji: '\u2764\uFE0F', quadrant: 'calmPositive' }, '')).toEqual(refused('this forum already has that reaction', 'config'));
    must(await w.fake.playCard('overreaction', w.anaFace, w.post, { emoji: '\u{1F44D}\u{1F3FD}', quadrant: 'calmPositive' }, ''));
    w.fake.signInAs(w.cy);
    w.fake.signInAs(w.cy);
    expect(must(await w.fake.react(w.post, w.cyFace, 'x-1f44d-1f3fd')).tally).toEqual({ 'x-1f480': 1, 'x-1f44d-1f3fd': 1 });
    w.fake.signInAs(w.fake.seed.account('boss', { admin: true }));
    must(await w.fake.reverseCard(play.id));
    const second = w.fake.seed.account('dee');
    const deeFace = w.fake.seed.character(second, 'Dee Face', 'face');
    w.fake.signInAs(second);
    expect(await w.fake.react(w.post, deeFace, 'x-1f480')).toEqual(refused('that reaction is no longer offered on this post'));
    expect((await pageActs(w, second)).tallies[w.post]).toEqual({ 'x-1f480': 1, 'x-1f44d-1f3fd': 1 });
    /* The ended emoji is still held by the post. */
    w.fake.signInAs(w.ana);
    expect(await w.fake.playCard('overreaction', w.anaFace, w.post, skull, '')).toEqual(refused('this post already has that reaction', 'config'));
  });
});

describe('a card that replies, and a play that keeps (0348_post_under.sql and the thread page after it)', () => {
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
  const cutter: CardRules = { ...base, key: 'line-cutter', name: 'Line Cutter', alignment: 'pepperoni', rarity: 'rare', replies: true, canApply: (t, e, _c, now) => landsOn(cutter, t, e, now) };
  const glam: CardRules = { ...base, key: 'feelin-glam', name: "Feelin' Glam", alignment: 'sweet', rarity: 'rare', reaches: ['thread'], lasts: { unit: 'day', count: 7 }, keeps: true, canApply: (t, e, _c, now) => landsOn(glam, t, e, now) };
  /** A thread card that does not keep: once it has worn off it is not asked of any post. */
  const glint: CardRules = { ...base, key: 'glint', name: 'Glint', alignment: 'sweet', rarity: 'rare', reaches: ['thread'], lasts: { unit: 'day', count: 7 }, canApply: (t, e, _c, now) => landsOn(glint, t, e, now) };
  const plain: CardRules = { ...base, key: 'plain', name: 'Plain', alignment: 'salty', rarity: 'common', canApply: (t, e, _c, now) => landsOn(plain, t, e, now) };
  const snare: CardRules = { ...base, key: 'snare', name: 'Snare', alignment: 'salty', rarity: 'rare', play: 'set', trap: { trigger: { on: 'cast' } }, catches: () => 'line-cutter', canApply: () => ok(undefined) };
  /** A back with an outcome rides: the cast it names lands as usual, and the spring says it rode (spring_traps, 0151). */
  const rider: CardRules = { ...base, key: 'rider', name: 'Rider', alignment: 'salty', rarity: 'rare', play: 'set', trap: { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } }, catches: () => 'line-cutter', validateConfig: (c: unknown) => ok(c ?? {}), canApply: () => ok(undefined) };
  const replying: Instance = { ...instance, cards: [cutter, glam, glint, plain, snare, rider], settings: { ...settings, postMaxLength: 50, economy: {} } };

  /** A thread of `count` posts by Bo and Ana in turn (the first is Bo's), Ana signed in with three Line Cutters, a Plain and a Glam; Bo holds a Snare; `root` is an admin. */
  function replyWorld(count = 45) {
    const fake = createFake({ instance: replying });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const root = fake.seed.account('root');
    fake.seed.admin(root);
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Long', 'p1');
    const ids = [opener];
    for (let i = 2; i <= count; i++) ids.push(fake.seed.post(thread, i % 2 ? boFace : anaFace, `p${i}`));
    fake.seed.cards(ana, { 'line-cutter': 3, plain: 2, 'feelin-glam': 1 });
    fake.seed.cards(bo, { snare: 1, rider: 1 });
    fake.signInAs(ana);
    const reply = (parent: Id, body = 'Excuse me.', framing?: readonly Id[]) => fake.playCard('line-cutter', anaFace, parent, {}, '', undefined, undefined, undefined, { body, ...(framing ? { framing } : {}) });
    return { fake, ana, bo, root, anaFace, boFace, thread, ids, reply };
  }
  type Id = string;
  const seqs = (page: { acts: readonly Act[] } | null) => page!.acts.map((a) => a.seq);
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  test('a play writes its reply with a number of its own, draws it under its parent on the parent\'s page, and leaves its number empty on its own', async () => {
    const w = replyWorld();
    const played = must(await w.reply(w.ids[2]!));
    expect(played).toMatchObject({ kind: 'card', character: w.anaFace, targetActId: w.ids[2], seq: null, payload: { card: 'line-cutter', layer: 1, reply: expect.any(String) } });
    const reply = (await w.fake.act(played.payload.reply as string))!;
    expect(reply).toMatchObject({ kind: 'post', seq: 46, character: w.anaFace, targetActId: null, payload: { body: 'Excuse me.' } });
    expect(await w.fake.thread(w.thread)).toMatchObject({ lastSeq: 46, replies: 45 });
    expect(await w.fake.myCards()).toContainEqual({ card: 'line-cutter', held: 2 });
    const first = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(seqs(first)).toEqual(range(1, 20));
    expect(first.under).toEqual([{ parent: w.ids[2], play: played.id, act: reply }]);
    expect(first.cut).toEqual([]);
    /* The reply's own marks come with the page: its tally and its author. */
    expect(Object.keys(first.tallies)).toContain(reply.id);
    const last = (await w.fake.threadPage(w.thread, { page: 3 }, 20, []))!;
    expect(seqs(last)).toEqual(range(41, 45));
    expect(last.under).toEqual([]);
    expect(last.cut).toEqual([{ seq: 46, parentSeq: 3 }]);
    expect(last.page).toBe(3);
    /* A number inside the gap reads the page its number falls on, as the database's does. */
    const addressed = (await w.fake.threadPage(w.thread, { seq: 46 }, 20, []))!;
    expect(addressed.page).toBe(3);
    expect(addressed).toEqual(last);
    /* The reply was not heard as an Act of the thread's tail: it is still read by its number (acts and act are not the page). */
    expect((await w.fake.acts(w.thread, 46, 46)).map((a) => a.id)).toEqual([reply.id]);
  });

  test('a card of its own on a nested reply is among the page\'s plays', async () => {
    const w = replyWorld();
    const played = must(await w.reply(w.ids[2]!));
    const reply = played.payload.reply as string;
    const onReply = must(await w.fake.playCard('plain', w.anaFace, reply, {}, ''));
    expect((await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!.plays.map((p) => p.id)).toContain(onReply.id);
  });

  test('an admin\'s end of the play un-nests the reply: it is on its number again', async () => {
    const w = replyWorld();
    const played = must(await w.reply(w.ids[2]!));
    w.fake.signInAs(w.root);
    must(await w.fake.reverseCard(played.id));
    const first = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(first.under).toEqual([]);
    const last = (await w.fake.threadPage(w.thread, { page: 3 }, 20, []))!;
    expect(seqs(last)).toEqual(range(41, 46));
    expect(last.cut).toEqual([]);
    /* The parent and the old reply take a play again: one fits under a post only while it is in force. */
    w.fake.signInAs(w.ana);
    const again = must(await w.reply(w.ids[2]!, 'Again.'));
    expect(again.payload.layer).toBe(2);
    const reply = again.payload.reply as string;
    expect(await w.fake.playCard('line-cutter', w.anaFace, played.payload.reply as string, {}, '', undefined, undefined, undefined, { body: 'Under the old one.' })).toMatchObject({ ok: true });
    expect(reply).not.toBe(played.payload.reply);
  });

  test('a refused play writes nothing and spends nothing, in the words of the database and the act function', async () => {
    const w = replyWorld();
    const held = async () => (await w.fake.myCards()).find((c) => c.card === 'line-cutter')?.held;
    const before = { last: (await w.fake.thread(w.thread))!.lastSeq, held: await held(), wallet: await w.fake.wallet() };
    const play = (body: string | undefined, card = 'line-cutter', target = w.ids[2]!) => w.fake.playCard(card, w.anaFace, target, {}, '', undefined, undefined, undefined, body === undefined ? undefined : { body });
    /* A play with no reply is refused in the card's own words (e8cb9431). */
    expect(await w.fake.playCard('line-cutter', w.anaFace, w.ids[2]!, {}, '')).toEqual(refused('write the reply this card carries', 'body'));
    expect(await play('   ')).toEqual(refused('write the reply this card carries', 'body'));
    expect(await play('!!!')).toEqual(refused('write the reply this card carries', 'body'));
    expect(await play('x'.repeat(51))).toEqual(refused('is longer than 50 characters', 'body'));
    expect(await play('Hi.', 'plain')).toEqual(refused('only a card that carries a reply takes one', 'body'));
    expect(await w.fake.playCard('line-cutter', w.anaFace, w.ids[2]!, {}, '', 'thread', undefined, undefined, { body: 'Hi.' })).toEqual(refused('this card lands on a post', 'reach'));
    expect(await w.fake.playCard('line-cutter', w.boFace, w.ids[2]!, {}, '', undefined, undefined, undefined, { body: 'Hi.' })).toEqual(refused('you do not play that character'));
    const until = w.fake.clock.now() + 24 * 3_600_000;
    w.fake.seed.ban(w.anaFace, until, { infraction: w.fake.seed.infraction(w.fake.seed.visit(w.fake.seed.staff('mod', 'Mod Bot', 'mod'), w.ids[0]!)) });
    expect(await play('Hi.')).toEqual(refused(`this character is banned until ${new Date(until).toISOString()}; the ban ends by itself then`));
    w.fake.clock.advance(2 * DAY);
    const system = fake0System(w);
    expect(await play('Hi.', 'line-cutter', system)).toEqual(refused('only the staff post here; spin a thread from what they said'));
    expect({ last: (await w.fake.thread(w.thread))!.lastSeq, held: await held(), wallet: await w.fake.wallet() }).toEqual(before);
    expect((await w.fake.act(w.ids[2]!))).not.toBeNull();
    /* One fits under a post, and a reply in force takes none under it. */
    const landed = must(await play('Hi.'));
    expect(await play('Again.')).toEqual(refused('this post already carries that card', 'config'));
    expect(await play('Under it.', 'line-cutter', (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!.under[0]!.act.id)).toEqual(refused('a reply drawn under a post takes no reply under it', 'config'));
    expect(landed.payload.layer).toBe(1);
    expect((await w.fake.thread(w.thread))!.lastSeq).toBe(before.last + 1);
    expect(await held()).toBe(before.held! - 1);
  });

  test('a banned caster with a bad body is refused in the stack\'s order: the body\'s shape (act function), then the ban (play_card\'s not_banned), then the letter-or-digit refusal', async () => {
    const w = replyWorld();
    const until = w.fake.clock.now() + 24 * 3_600_000;
    w.fake.seed.ban(w.anaFace, until, { infraction: w.fake.seed.infraction(w.fake.seed.visit(w.fake.seed.staff('mod', 'Mod Bot', 'mod'), w.ids[0]!)) });
    const banned = refused(`this character is banned until ${new Date(until).toISOString()}; the ban ends by itself then`);
    const play = (body: string) => w.fake.playCard('line-cutter', w.anaFace, w.ids[2]!, {}, '', undefined, undefined, undefined, { body });
    /* A body that is not text, empty or too long is the act function's, before any database check. */
    /* A play with no reply is refused in the card's own words (e8cb9431). */
    expect(await w.fake.playCard('line-cutter', w.anaFace, w.ids[2]!, {}, '')).toEqual(refused('write the reply this card carries', 'body'));
    expect(await play('   ')).toEqual(refused('write the reply this card carries', 'body'));
    expect(await play('x'.repeat(51))).toEqual(refused('is longer than 50 characters', 'body'));
    /* A body with no letter or digit is the database's, after the ban: the ban wins. */
    expect(await play('!!!')).toEqual(banned);
    expect(await play('Hi.')).toEqual(banned);
  });

  test('a cast that a ride back lets land writes its reply, nested, and hears it as `under`', async () => {
    const w = replyWorld();
    w.fake.signInAs(w.bo);
    must(await w.fake.setCard('rider', w.boFace, w.ids[0]!, { quadrant: 'excitedPositive' }));
    w.fake.signInAs(w.ana);
    const heard: string[] = [];
    /* The broadcast's own delivery is what is counted here; the answer's echo has its own test. */
    w.fake.broadcast.echoAnswers(false);
    w.fake.subscribeThread(w.thread, { onUnder: (parent, play) => heard.push(`under ${parent === w.ids[0]} ${play}`) });
    const played = must(await w.reply(w.ids[0]!));
    await flush();
    expect(played.payload).toMatchObject({ rode: expect.any(String), reply: expect.any(String) });
    expect(played.payload.caught).toBeUndefined();
    const reply = (await w.fake.act(played.payload.reply as string))!;
    expect(reply).toMatchObject({ kind: 'post', seq: 46, payload: { body: 'Excuse me.' } });
    expect(heard).toEqual([`under true ${played.id}`]);
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.under).toEqual([{ parent: w.ids[0], play: played.id, act: reply }]);
    expect((await w.fake.threadPage(w.thread, { page: 3 }, 20, []))!.cut).toEqual([{ seq: 46, parentSeq: 1 }]);
    /* A reply carried by a card that cannot write has no end of its own to fail: only an admin's end (above) or the play's reversal un-nests it, as an untaken play is a writing card's alone. */
  });

  /** A post of The System's own board: the announcements thread's, where no card's reply may be written. */
  function fake0System(w: ReturnType<typeof replyWorld>): Id {
    const made = w.fake.seed.thread('announcements', null, 'Promos', 'The System speaks.', { kind: 'post' });
    return made.act;
  }

  test('a cast that is caught writes the caught card Act and no reply, and its payload still names the id no post has', async () => {
    const w = replyWorld();
    w.fake.signInAs(w.bo);
    must(await w.fake.setCard('snare', w.boFace, w.ids[0]!, {}));
    w.fake.signInAs(w.ana);
    const played = must(await w.reply(w.ids[0]!));
    expect(played.payload).toMatchObject({ caught: expect.any(String), reply: expect.any(String) });
    expect(await w.fake.act(played.payload.reply as string)).toBeNull();
    expect(await w.fake.thread(w.thread)).toMatchObject({ lastSeq: 45 });
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.under).toEqual([]);
    expect((await w.fake.threadPage(w.thread, { page: 3 }, 20, []))!.cut).toEqual([]);
  });

  test('the reply is heard as `under` on the thread, after its card and never as an act', async () => {
    const w = replyWorld();
    const heard: string[] = [];
    let under: [string, string, Act] | null = null;
    w.fake.broadcast.echoAnswers(false);
    w.fake.subscribeThread(w.thread, {
      onAct: (a) => heard.push(`act ${a.kind} ${a.seq}`),
      onUnder: (parent, play, act) => { heard.push('under'); under = [parent, play, act]; },
    });
    const played = must(await w.reply(w.ids[2]!, 'Excuse me.', []));
    await flush();
    const reply = (await w.fake.act(played.payload.reply as string))!;
    expect(heard).toEqual(['act card null', 'under']);
    expect(under).toEqual([w.ids[2], played.id, reply]);
    /* The card's alert goes to its owner on their own channel; the thread hears the card, then the reply as `under`, and no act of the reply. */
    expect(w.fake.broadcast.log.filter((e) => e.topic.startsWith('thread:'))).toEqual([{ topic: `thread:${w.thread}`, event: 'act' }, { topic: `thread:${w.thread}`, event: 'under' }]);
  });

  test('the answer of a play that replied hands the reply to the thread\'s listeners itself: with the broadcast held it is still heard, once, and a lost answer hands nothing', async () => {
    const w = replyWorld();
    const heard: string[] = [];
    w.fake.subscribeThread(w.thread, { onUnder: (parent, play) => heard.push(`${parent === w.ids[2]} ${play}`) });
    w.fake.broadcast.hold();
    const played = must(await w.reply(w.ids[2]!, 'Excuse me.', []));
    await flush();
    expect(heard).toEqual([`true ${played.id}`]);
    /* The held broadcast then comes: the same reply again, which a screen ignores. */
    w.fake.broadcast.flush();
    await flush();
    expect(heard).toEqual([`true ${played.id}`, `true ${played.id}`]);
    heard.length = 0;
    w.fake.broadcast.hold();
    w.fake.seed.loseNextAnswer(true);
    const lost = await w.reply(w.ids[3]!, 'Excuse me again.', []);
    expect(lost.ok).toBe(false);
    await flush();
    expect(heard).toEqual([]);
  });

  describe('a play that keeps its level', () => {
    const day = DAY;
    /** A thread whose posts are dated by `days` ago, a Glam played from `from` to `to` days ago. */
    function keptWorld(dates: readonly number[], window: readonly [number, number], card = 'feelin-glam') {
      const fake = createFake({ instance: replying });
      const ana = fake.seed.account('ana');
      const root = fake.seed.account('root');
      fake.seed.admin(root);
      const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
      const now = fake.clock.now();
      const opened = fake.seed.thread('general', anaFace, 'Dated', 'first', { at: now - dates[0]! * day });
      const posts = [opened.act, ...dates.slice(1).map((d, i) => fake.seed.post(opened.thread, anaFace, `p${i + 2}`, { at: now - d * day }))];
      const play = fake.seed.reach(anaFace, 'thread', opened.thread, card, { at: now - window[0] * day, ends: now - window[1] * day });
      fake.signInAs(ana);
      return { fake, ana, root, anaFace, thread: opened.thread, posts, play, now };
    }
    const pageOf = async (w: ReturnType<typeof keptWorld>, page: number) => (await w.fake.threadPage(w.thread, { page }, 1, []))!;

    test('is listed on a page that holds a post written inside its window, and on none whose posts are all outside it', async () => {
      /* Posts 20, 5 and 1 days old; the play ran from 10 to 3 days ago. */
      const w = keptWorld([20, 5, 1], [10, 3]);
      expect((await pageOf(w, 1)).kept).toEqual([]);
      const inside = await pageOf(w, 2);
      expect(inside.kept).toEqual([{ play: w.play, reach: 'thread', target: w.thread, endsAt: new Date(w.now - 3 * day).toISOString(), act: (await w.fake.act(w.play))! }]);
      expect((await pageOf(w, 3)).kept).toEqual([]);
      /* The play's own tally and caster come with the page. */
      expect(Object.keys(inside.tallies)).toContain(w.play);
      expect(inside.people.map((p) => p.character.id)).toContain(w.anaFace);
      /* A page of all three holds one inside, and the date is the window's: its first moment is in, its end is out. */
      expect((await w.fake.threadPage(w.thread, { page: 1 }, 3, []))!.kept.map((k) => k.play)).toEqual([w.play]);
    });

    test('a post dated exactly at the play\'s start is kept, and one dated exactly at its end is not', async () => {
      const at = keptWorld([10], [10, 3]);
      expect((await pageOf(at, 1)).kept.map((k) => k.play)).toEqual([at.play]);
      const end = keptWorld([3], [10, 3]);
      expect((await pageOf(end, 1)).kept).toEqual([]);
    });

    test('counts a nested reply\'s date, not only the numbered posts\'', async () => {
      const fake = createFake({ instance: replying });
      const ana = fake.seed.account('ana');
      const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
      const now = fake.clock.now();
      const opened = fake.seed.thread('general', anaFace, 'Nested', 'first', { at: now - 20 * day });
      fake.seed.cards(ana, { 'line-cutter': 1 });
      fake.signInAs(ana);
      const played = must(await fake.playCard('line-cutter', anaFace, opened.act, {}, '', undefined, undefined, undefined, { body: 'In the window.' }));
      expect(played.payload.reply).toEqual(expect.any(String));
      const play = fake.seed.reach(anaFace, 'thread', opened.thread, 'feelin-glam', { at: now - day, ends: now + day });
      fake.clock.advance(2 * day);
      /* One post on the page (the opener, dated outside), and the reply nested under it dated inside the window. */
      const page = (await fake.threadPage(opened.thread, { page: 1 }, 1, []))!;
      expect(seqs(page)).toEqual([1]);
      expect(page.under).toHaveLength(1);
      expect(page.kept.map((k) => k.play)).toEqual([play]);
    });

    test('a live play is above the page and not kept; an admin-ended one is in neither', async () => {
      const live = keptWorld([20, 5], [1, -1]);
      const page = await pageOf(live, 2);
      expect(page.above.map((a) => a.play)).toEqual([live.play]);
      expect(page.kept).toEqual([]);
      const ended = keptWorld([20, 5], [10, 3]);
      ended.fake.signInAs(ended.root);
      must(await ended.fake.reverseCard(ended.play));
      const after = await pageOf(ended, 2);
      expect(after.above).toEqual([]);
      expect(after.kept).toEqual([]);
    });

    test('a worn-off play of a card that keeps can still be ended by an admin, and one of any other card is refused as it was', async () => {
      const kept = keptWorld([5], [10, 3]);
      expect(await kept.fake.reverseCard(kept.play)).toEqual(refused('only an admin ends a card'));
      kept.fake.signInAs(kept.root);
      expect(await kept.fake.reverseCard(kept.play)).toMatchObject({ ok: true });
      expect(await kept.fake.reverseCard(kept.play)).toEqual(refused('an admin has already ended that card'));
      const other = keptWorld([5], [10, 3], 'glint');
      other.fake.signInAs(other.root);
      expect(await other.fake.reverseCard(other.play)).toEqual(refused('that card has already worn off'));
      expect((await pageOf(other, 1)).kept).toEqual([]);
    });

    test('lists at most 100 plays, oldest first', async () => {
      const w = keptWorld([5], [10, 3]);
      for (let i = 0; i < 100; i++) w.fake.seed.reach(w.anaFace, 'thread', w.thread, 'feelin-glam', { at: w.now - (9 - i / 100) * day, ends: w.now - 3 * day });
      const kept = (await pageOf(w, 1)).kept;
      expect(kept).toHaveLength(100);
      expect(kept[0]!.play).toBe(w.play);
    });

    describe('at character reach', () => {
      /** Ana's and Bo's posts dated by `ana` and `bo` days ago, a play cast on Ana's character from `window[0]` to `window[1]` days ago. */
      function charWorld(ana: readonly number[], bo: readonly number[], window: readonly [number, number], card = 'feelin-glam') {
        const fake = createFake({ instance: replying });
        const anaAcc = fake.seed.account('ana');
        const boAcc = fake.seed.account('bo');
        const root = fake.seed.account('root');
        fake.seed.admin(root);
        const anaFace = fake.seed.character(anaAcc, 'Ana Face', 'face');
        const boFace = fake.seed.character(boAcc, 'Bo Face', 'face');
        const now = fake.clock.now();
        const opened = fake.seed.thread('general', anaFace, 'Dated', 'first', { at: now - 30 * day });
        ana.forEach((d, i) => fake.seed.post(opened.thread, anaFace, `a${i}`, { at: now - d * day }));
        bo.forEach((d, i) => fake.seed.post(opened.thread, boFace, `b${i}`, { at: now - d * day }));
        const play = fake.seed.reach(boFace, 'character', anaFace, card, { at: now - window[0] * day, ends: now - window[1] * day, post: opened.act });
        fake.signInAs(anaAcc);
        return { fake, root, anaFace, boFace, thread: opened.thread, play, now };
      }
      const wholePage = async (w: ReturnType<typeof charWorld>) => (await w.fake.threadPage(w.thread, { page: 1 }, 100, []))!;

      test('is listed when the page holds a post by that character written inside the window, and not for posts before it or after its end', async () => {
        const w = charWorld([5], [], [10, 3]);
        const page = await wholePage(w);
        expect(page.kept).toEqual([{ play: w.play, reach: 'character', target: w.anaFace, endsAt: new Date(w.now - 3 * day).toISOString(), act: (await w.fake.act(w.play))! }]);
        expect(Object.keys(page.tallies)).toContain(w.play);
        expect(page.people.map((p) => p.character.id)).toContain(w.boFace);
        expect((await wholePage(charWorld([12], [], [10, 3]))).kept).toEqual([]);
        expect((await wholePage(charWorld([1], [], [10, 3]))).kept).toEqual([]);
      });

      test('another character\'s post inside the window does not bring it in', async () => {
        const w = charWorld([12], [5], [10, 3]);
        expect((await wholePage(w)).kept).toEqual([]);
      });

      test('a live play is above and not kept; one an admin ended, during its time or after it, is in neither; a card that does not keep is in neither', async () => {
        const up = charWorld([5], [], [1, -1]);
        const live = await wholePage(up);
        expect(live.above.map((a) => [a.play, a.reach])).toEqual([[up.play, 'character']]);
        expect(live.kept).toEqual([]);
        // Ended by an admin during its time, then after it: neither leaves anything.
        up.fake.signInAs(up.root);
        must(await up.fake.reverseCard(up.play));
        const cut = await wholePage(up);
        expect(cut.above).toEqual([]);
        expect(cut.kept).toEqual([]);
        const ended = charWorld([5], [], [10, 3]);
        ended.fake.signInAs(ended.root);
        must(await ended.fake.reverseCard(ended.play));
        const after = await wholePage(ended);
        expect(after.above).toEqual([]);
        expect(after.kept).toEqual([]);
        expect((await wholePage(charWorld([5], [], [10, 3], 'glint'))).kept).toEqual([]);
      });

      test('a thread row and a character row come back together, oldest first', async () => {
        const w = charWorld([5], [], [8, 3]);
        const thread = w.fake.seed.reach(w.boFace, 'thread', w.thread, 'feelin-glam', { at: w.now - 9 * day, ends: w.now - 3 * day });
        const later = w.fake.seed.reach(w.boFace, 'thread', w.thread, 'feelin-glam', { at: w.now - 7 * day, ends: w.now - 3 * day });
        const page = await wholePage(w);
        expect(page.kept.map((k) => [k.play, k.reach])).toEqual([[thread, 'thread'], [w.play, 'character'], [later, 'thread']]);
      });
    });
  });
});

/* The discipline cards (card notes, part 5): the three refusals, the relief, the lift and the fall, as the SQL does them (migration 0361). */
describe('discipline cards: hearts, the Unban and Take the Fall', () => {
  const mk = (key: string, name: string, reaches: ('post' | 'character')[], discipline: NonNullable<CardRules['discipline']>): CardRules => ({
    key, name, alignment: 'sweet', rarity: 'uncommon', reaches, discipline,
    playPrice: () => 0, validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
    canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key, reaches, discipline }, t, e, now),
  });
  const heart = mk('t-heart', 'T Heart', ['character'], { kind: 'relief', points: 'lightestBand' });
  const super_ = mk('t-super', 'T Super', ['character'], { kind: 'relief', points: 'all' });
  const ultra = mk('t-ultra', 'T Ultra', ['character'], { kind: 'unban' });
  const fall = mk('t-fall', 'T Fall', ['post'], { kind: 'fall' });
  /* An author veil (Whodunnit?, card notes Part 3), to play a fall beside. */
  const veil: CardRules = {
    key: 't-veil', name: 'T Veil', alignment: 'pepperoni', rarity: 'rare', reaches: ['post'], lasts: { unit: 'day', count: 3 }, veil: 'author',
    playPrice: () => 0, validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }), canApply: (t: CardTarget, e: readonly CardEffect[], _config?: unknown, now?: Date) => landsOn({ key: 't-veil', reaches: ['post'] }, t, e, now),
  };
  const shop: Instance = { ...instance, cards: [heart, super_, ultra, fall, veil], machine: [], settings: { ...settings, economy: {} } };
  function world() {
    const fake = createFake({ instance: shop });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const anaOther = fake.seed.character(ana, 'Ana Other', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const mod = fake.seed.staff('mod', 'Mod Bot', 'mod');
    const { thread, act: opener } = fake.seed.thread('general', boFace, 'Hello', 'First post');
    const { act: hers } = fake.seed.thread('general', anaFace, 'Hers', 'Her post');
    fake.seed.wallet(ana, 500);
    fake.seed.cards(ana, { 't-heart': 4, 't-super': 4, 't-ultra': 4, 't-fall': 4 });
    fake.signInAs(ana);
    const now = fake.clock.now();
    /* A filing on bo's post `ago` ago, `points` strong. */
    const file = (points: number, ago: number, post = opener) => fake.seed.infraction(fake.seed.visit(mod, post, { at: now - ago }), { points, at: now - ago });
    const warn = async (id: string) => (await fake.characters([id]))[0]!.warnPoints ?? 0;
    const bannedUntil = async (id: string) => (await fake.characters([id]))[0]!.bannedUntil ?? null;
    return { fake, ana, bo, anaFace, anaOther, boFace, mod, thread, opener, hers, file, warn, bannedUntil, now };
  }

  test('a heart on an empty bar, an Ultra on a character that is not banned and a fall on one\'s own post are refused in the engine\'s words, and nothing is spent', async () => {
    const { fake, anaFace, boFace, opener, hers } = world();
    const held = async () => (await fake.myCards()).map((c) => c.held).reduce((a, b) => a + b, 0);
    const before = await held();
    expect(await fake.playCard('t-heart', anaFace, boFace, {}, '', 'character', opener)).toEqual(refused("this character's warn bar is empty", 'config'));
    expect(await fake.playCard('t-super', anaFace, boFace, {}, '', 'character', opener)).toEqual(refused("this character's warn bar is empty", 'config'));
    expect(await fake.playCard('t-ultra', anaFace, boFace, {}, '', 'character', opener)).toEqual(refused('this character is not banned', 'config'));
    expect(await fake.playCard('t-fall', anaFace, hers, {}, '')).toEqual(refused("T Fall is played on another character's post", 'config'));
    expect(await held()).toBe(before);
  });

  test('a staff character\'s post takes no fall, and a staff character no heart', async () => {
    const { fake, anaFace, mod, thread } = world();
    const theirs = fake.seed.staffPost(mod, thread, 'The rules.');
    expect(await fake.playCard('t-fall', anaFace, theirs, {}, '')).toEqual(refused("T Fall is played on a player's post"));
    /* A staff character has no bar and no ban, so the engine's words refuse a heart there before the server's own staff refusal could. */
    expect(await fake.playCard('t-heart', anaFace, mod, {}, '', 'character', theirs)).toEqual(refused("this character's warn bar is empty", 'config'));
  });

  test('a fall on a post whose author is hidden is refused in one sentence for every caster, the author\'s own masks included, and nothing is spent; it lands once the veil is over', async () => {
    const { fake, ana, bo, anaFace, anaOther, boFace, opener, hers } = world();
    fake.seed.cards(ana, { 't-fall': 4, 't-veil': 2 });
    fake.seed.cards(bo, { 't-fall': 2 });
    must(await fake.playCard('t-veil', anaFace, opener, {}, ''));
    must(await fake.playCard('t-veil', anaFace, hers, {}, ''));
    const words = refused(`this post's author is hidden until ${refusalTime(new Date(fake.clock.now() + 3 * DAY).toISOString())}; nobody takes the fall for it before then`);
    const held = async () => (await fake.myCards()).find((c) => c.card === 't-fall')?.held ?? 0;
    const before = await held();
    /* A third player on Bo's veiled post; Ana's own character and her second mask on her own veiled post (where the own-post words would tell her masks from the rest); Bo on his own. */
    expect(await fake.playCard('t-fall', anaFace, opener, {}, '')).toEqual(words);
    expect(await fake.playCard('t-fall', anaFace, hers, {}, '')).toEqual(words);
    expect(await fake.playCard('t-fall', anaOther, hers, {}, '')).toEqual(words);
    expect(await held()).toBe(before);
    fake.signInAs(bo);
    expect(await fake.playCard('t-fall', boFace, opener, {}, '')).toEqual(words);
    fake.signInAs(ana);
    /* Once the veil's time is up the posts are their authors' again: Ana's fall lands on Bo's, and her own post meets the own-post words. */
    fake.clock.advance(3 * DAY + 1);
    must(await fake.playCard('t-fall', anaFace, opener, {}, ''));
    expect(await fake.playCard('t-fall', anaFace, hers, {}, '')).toEqual(refused("T Fall is played on another character's post", 'config'));
  });

  test('a heart takes the oldest live points first, least(what is left, what is wanted), and its play is over at once', async () => {
    const { fake, ana, bo, anaFace, boFace, opener, file, warn } = world();
    const four = file(4, 2 * DAY);
    const newer = file(2, DAY);
    expect(await warn(boFace)).toBe(6);
    const played = must(await fake.playCard('t-heart', anaFace, boFace, {}, '', 'character', opener));
    expect(played.payload).toMatchObject({ reach: 'character', character: boFace, instant: true, took: 2 });
    expect(played.payload.ends).toBeUndefined();
    expect(await warn(boFace)).toBe(4);
    /* Oldest first: the first heart took its 2 from the older filing and none from the newer. */
    fake.signInAs(bo);
    const reliefs = async () => Object.fromEntries((await fake.log()).infractions.map((i) => [i.infraction, i.cardRelief]));
    expect(await reliefs()).toEqual({ [four]: 2, [newer]: 0 });
    fake.signInAs(ana);
    must(await fake.playCard('t-heart', anaFace, boFace, {}, '', 'character', opener));
    expect(await warn(boFace)).toBe(2);
    must(await fake.playCard('t-heart', anaFace, boFace, {}, '', 'character', opener));
    expect(await warn(boFace)).toBe(0);
    expect(await fake.playCard('t-heart', anaFace, boFace, {}, '', 'character', opener)).toEqual(refused("this character's warn bar is empty", 'config'));
    fake.signInAs(bo);
    expect((await fake.log()).infractions.find((i) => i.infraction === four)).toMatchObject({ points: 4, cardRelief: 4, fallPlay: null });
  });

  test('a Super Happy Heart empties the bar, and an admin ending the play puts the points back', async () => {
    const { fake, anaFace, boFace, opener, file, warn } = world();
    file(4, 2 * DAY);
    file(2, DAY);
    file(3, DAY / 2);
    const played = must(await fake.playCard('t-super', anaFace, boFace, {}, '', 'character', opener));
    expect(played.payload.took).toBe(9);
    expect(await warn(boFace)).toBe(0);
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    must(await fake.reverseCard(played.id));
    expect(await warn(boFace)).toBe(9);
  });

  test('an Ultra Happy Heart lifts every running ban at once; the log says when and by which card', async () => {
    const { fake, bo, anaFace, boFace, opener, file, bannedUntil, now } = world();
    const inf = file(7, DAY);
    fake.seed.ban(boFace, now + 3 * DAY, { infraction: inf, days: 3 });
    expect(await bannedUntil(boFace)).toBe(new Date(now + 3 * DAY).toISOString());
    const played = must(await fake.playCard('t-ultra', anaFace, boFace, {}, '', 'character', opener));
    expect(played.payload).toMatchObject({ instant: true, lifted: [{ until: new Date(now + 3 * DAY).toISOString() }] });
    expect(played.payload.ends).toBeUndefined();
    expect(await bannedUntil(boFace)).toBeNull();
    expect(await fake.playCard('t-ultra', anaFace, boFace, {}, '', 'character', opener)).toEqual(refused('this character is not banned', 'config'));
    fake.signInAs(bo);
    expect((await fake.log()).bans[0]).toMatchObject({ liftedCard: 't-ultra', liftedAt: played.createdAt, until: played.createdAt });
  });

  test('a banned caster plays no discipline card', async () => {
    const { fake, anaFace, boFace, opener, file, now } = world();
    const inf = file(7, DAY);
    fake.seed.ban(boFace, now + DAY, { infraction: inf });
    fake.seed.ban(anaFace, now + DAY, { infraction: inf });
    expect(await fake.playCard('t-ultra', anaFace, boFace, {}, '', 'character', opener)).toMatchObject({ ok: false, error: expect.stringMatching(/is banned until/) });
  });

  test('a fall an admin ended or a trap caught takes no filing: it lands on the author', async () => {
    const { fake, anaFace, boFace, opener, file, warn, now } = world();
    const ended = must(await fake.playCard('t-fall', anaFace, opener, {}, ''));
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    must(await fake.reverseCard(ended.id));
    file(2, 1000);
    expect(await warn(boFace)).toBe(2);
    expect(await warn(anaFace)).toBe(0);
    const caught = world();
    caught.fake.seed.card(caught.anaFace, caught.opener, 't-fall', { caught: caught.opener, at: now });
    caught.file(3, 1000);
    expect(await caught.warn(caught.boFace)).toBe(3);
    expect(await caught.warn(caught.anaFace)).toBe(0);
  });

  test('an Unban an admin ended lifts nothing: the ban runs to its own end again', async () => {
    const { fake, anaFace, boFace, opener, file, bannedUntil, now } = world();
    fake.seed.ban(boFace, now + 3 * DAY, { infraction: file(7, DAY), days: 3 });
    const played = must(await fake.playCard('t-ultra', anaFace, boFace, {}, '', 'character', opener));
    expect(await bannedUntil(boFace)).toBeNull();
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    must(await fake.reverseCard(played.id));
    expect(await bannedUntil(boFace)).toBe(new Date(now + 3 * DAY).toISOString());
  });

  test('a post whose fall a filing spent takes no second fall, for good: it carries that card', async () => {
    const { fake, anaFace, anaOther, opener, mod, now } = world();
    must(await fake.playCard('t-fall', anaFace, opener, {}, ''));
    fake.seed.infraction(fake.seed.visit(mod, opener, { at: now - 1000 }), { points: 2, at: now - 1000 });
    expect(await fake.playCard('t-fall', anaOther, opener, {}, '')).toEqual(refused('this post already carries that card', 'config'));
  });

  test('a filing on a post with a live fall lands on the fall\'s caster and spends it; the next lands on the author', async () => {
    const { fake, ana, bo, thread, anaFace, boFace, opener, mod, file, warn, now } = world();
    const played = must(await fake.playCard('t-fall', anaFace, opener, {}, ''));
    expect(await fake.playCard('t-fall', anaFace, opener, {}, '')).toMatchObject({ ok: false });
    const page = async () => (await fake.threadPage(thread, { page: 1 }, 20, []))!;
    expect((await page()).spent ?? []).toEqual([]);
    const first = fake.seed.infraction(fake.seed.visit(mod, opener, { at: now - 1000 }), { points: 2, at: now - 1000 });
    expect(await warn(anaFace)).toBe(2);
    expect(await warn(boFace)).toBe(0);
    expect((await page()).spent).toEqual([played.id]);
    expect(await fake.log()).toMatchObject({ infractions: [{ infraction: first, character: anaFace, fallPlay: played.id }] });
    fake.signInAs(bo);
    expect((await fake.log()).falls).toMatchObject([{ infraction: first, character: boFace, post: opener, points: 2, takerName: 'Ana Face' }]);
    expect((await fake.log()).infractions).toEqual([]);
    file(4, 500);
    expect(await warn(boFace)).toBe(4);
    expect(ana).not.toBe(bo);
  });
});

/**
 * Cards on a spun thread (docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md, Task 4): a spun thread's opening Act is a `spin`, and it is a
 * post for every card (`isPost`). The cases C1 to C16 of the plan's table are the server's (supabase/tests/0374-cards-on-a-spun-thread.sql), in its words.
 * Not modeled by the fake, so not run here: a quote springing a Move (C5's spring, C13's spring); `seed.spring` lays one by hand.
 *
 * The same cases as the other side's file; a case added to one is added to both.
 * S is a spun thread whose opening post Ann's character wrote, with one reply by Bob's character. <card> is the card's name.
 *
 * | #   | Play                                                                        | Expected                                                             |
 * |-----|-----------------------------------------------------------------------------|----------------------------------------------------------------------|
 * | C1  | a post card cast on the opening post by Bob's character                     | lands                                                                |
 * | C2  | the same card cast there by Ann's character                                 | lands                                                                |
 * | C3  | a post Gimmick used on the opening post by Ann's character                  | lands                                                                |
 * | C4  | the same Gimmick used there by Bob's character                              | "<card> is used on your own post"                                    |
 * | C5  | a card set face down on the opening post by Ann's character                 | lands; a quote of the opening post springs it; a take-back lands     |
 * | C6  | a set by Bob's character on Ann's opening post                              | "a card is set face down on a post of your own character's"          |
 * | C7  | a reply-carrying card cast on the opening post                              | lands; the reply is drawn under the opening post                     |
 * | C8  | a character card cast on Ann's character from the opening post              | lands                                                                |
 * | C9  | a character card on Bob's character from Ann's opening post                 | "a card on a character is played from one of its posts"              |
 * | C10 | a thread Gimmick used on S by Ann's character                               | lands                                                                |
 * | C11 | a thread Gimmick used on S by Bob's character                               | "<card> is used on a thread your own character started"              |
 * | C12 | a thread Move cast on S by Bob's character                                  | lands                                                                |
 * | C13 | a thread Move set face down by Bob's character on his reply, then sprung    | lands on S                                                           |
 * | C14 | a spin from a character card on Ann's character, pressed at the opening post| lands, with its moment                                               |
 * | C15 | any card on an `edit` Act, and on a `card` Act                              | "a card lands on a post"; a set, "a card is set face down on a post" |
 * | C16 | a second play of a stack-1 card on the opening post                         | "this post already carries that card"                                |
 */
describe('cards on a spun thread', () => {
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
  const blot: CardRules = { ...base, key: 'blot', name: 'Blot', alignment: 'salty', rarity: 'common', stack: 3, canApply: (t, e, _c, now) => landsOn(blot, t, e, now) };
  const solo: CardRules = { ...base, key: 'solo', name: 'Solo', alignment: 'salty', rarity: 'common', canApply: (t, e, _c, now) => landsOn(solo, t, e, now) };
  const shield: CardRules = { ...base, key: 'shield', name: 'Shield', alignment: 'sweet', rarity: 'uncommon', play: 'use', gimmick: { kind: 'ward', upTo: 'uncommon' }, lasts: { unit: 'day', count: 7 }, canApply: (t, e, _c, now) => landsOn(shield, t, e, now) };
  const sentry: CardRules = { ...base, key: 'sentry', name: 'Sentry', alignment: 'sweet', rarity: 'rare', play: 'use', gimmick: { kind: 'ward', upTo: 'common' }, reaches: ['thread'], lasts: { unit: 'day', count: 1 }, canApply: (t, e, _c, now) => landsOn(sentry, t, e, now) };
  const glint: CardRules = { ...base, key: 'glint', name: 'Glint', alignment: 'sweet', rarity: 'rare', reaches: ['thread'], lasts: { unit: 'day', count: 1 }, keeps: true, canApply: (t, e, _c, now) => landsOn(glint, t, e, now) };
  const mover: CardRules = { ...base, key: 'mover', name: 'Mover', alignment: 'salty', rarity: 'rare', reaches: ['thread'], lasts: { unit: 'day', count: 1 }, canApply: (t, e, _c, now) => landsOn(mover, t, e, now) };
  const aura: CardRules = { ...base, key: 'aura', name: 'Aura', alignment: 'sweet', rarity: 'uncommon', reaches: ['character'], lasts: { unit: 'day', count: 1 }, canApply: (t, e, _c, now) => landsOn(aura, t, e, now) };
  const cutter: CardRules = { ...base, key: 'cutter', name: 'Cutter', alignment: 'pepperoni', rarity: 'rare', replies: true, canApply: (t, e, _c, now) => landsOn(cutter, t, e, now) };
  const snare: CardRules = { ...base, key: 'snare', name: 'Snare', alignment: 'salty', rarity: 'rare', play: 'set', trap: { trigger: { on: 'cast' } }, catches: () => 'blot', canApply: () => ok(undefined) };
  const hood: CardRules = { ...base, key: 'hood', name: 'Hood', alignment: 'pepperoni', rarity: 'rare', reaches: ['post'], lasts: { unit: 'day', count: 3 }, veil: 'author', canApply: (t, e, _c, now) => landsOn(hood, t, e, now) };
  const spun: Instance = { ...instance, cards: [blot, solo, shield, sentry, glint, mover, aura, cutter, snare, hood], anonymous: { name: 'Nobody', tagline: '' }, settings: { ...settings, postMaxLength: 50, economy: {} } };

  /** S: a thread Ana's character spun, so Ana's character wrote its opening post (a `spin` Act), with one reply by Bob's character. Ana is signed in; each holds three of every card. */
  async function spunWorld() {
    const fake = createFake({ instance: spun });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { act: origin } = fake.seed.thread('general', boFace, 'Origin', 'Where it came from');
    fake.signInAs(ana);
    const made = must(await fake.spin(origin, anaFace, 'Spun', 'The opening post.'));
    const reply = fake.seed.post(made.thread.id, boFace, 'Bob replies.');
    const hand = { blot: 3, solo: 3, shield: 3, sentry: 3, glint: 3, mover: 3, aura: 3, cutter: 3, snare: 3 };
    fake.seed.cards(ana, hand);
    fake.seed.cards(bo, hand);
    return { fake, ana, bo, anaFace, boFace, thread: made.thread.id, opening: made.act.id, reply };
  }
  type SpunWorld = Awaited<ReturnType<typeof spunWorld>>;
  const asBo = (w: SpunWorld) => w.fake.signInAs(w.bo);
  const asAna = (w: SpunWorld) => w.fake.signInAs(w.ana);

  test('C1: a post card cast on the opening post by Bob\'s character lands; its moment answers; the page delivers it in `plays`', async () => {
    const w = await spunWorld();
    asBo(w);
    const played = must(await w.fake.playCard('blot', w.boFace, w.opening, {}, ''));
    expect(played).toMatchObject({ kind: 'card', targetActId: w.opening, thread: w.thread, payload: { card: 'blot', layer: 1 } });
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.plays.map((p) => p.id)).toEqual([played.id]);
    expect((await w.fake.playMoment(played.id))!.version.id).toBe(w.opening);
  });
  test('C2: the same card cast there by Ana\'s character lands, its stack allowing', async () => {
    const w = await spunWorld();
    must(await w.fake.playCard('blot', w.anaFace, w.opening, {}, ''));
    expect(must(await w.fake.playCard('blot', w.anaFace, w.opening, {}, '')).payload.layer).toBe(2);
  });
  test('C3 and C4: a post Gimmick is used on the opening post by Ana\'s character, and refused to Bob\'s in "is used on your own post"', async () => {
    const w = await spunWorld();
    asBo(w);
    expect(await w.fake.useCard('shield', w.boFace, w.opening, {}, '')).toEqual(refused('Shield is used on your own post'));
    asAna(w);
    const used = must(await w.fake.useCard('shield', w.anaFace, w.opening, {}, ''));
    expect(used).toMatchObject({ kind: 'card', targetActId: w.opening });
  });
  test('C5 and C6: a card is set face down on the opening post by Ana\'s character and taken back; Bob\'s is refused as on any post that is not the setter\'s', async () => {
    const w = await spunWorld();
    asBo(w);
    expect(await w.fake.setCard('snare', w.boFace, w.opening, {})).toEqual(refused('a card is set face down on a post of your own character\'s'));
    asAna(w);
    const set = must(await w.fake.setCard('snare', w.anaFace, w.opening, {}));
    expect([set.kind, set.targetActId]).toEqual(['set', w.opening]);
    expect(await w.fake.myFaceDown([set.id])).toEqual({ [set.id]: 'snare' });
    expect(must(await w.fake.takeBack(w.anaFace, set.id)).kind).toBe('take_back');
  });
  test('C7: a reply-carrying card cast on the opening post draws its reply under the opening post while the play is in force', async () => {
    const w = await spunWorld();
    asBo(w);
    const played = must(await w.fake.playCard('cutter', w.boFace, w.opening, {}, '', undefined, undefined, undefined, { body: 'Excuse me.' }));
    const reply = (await w.fake.act(played.payload.reply as string))!;
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.under).toEqual([{ parent: w.opening, play: played.id, act: reply }]);
  });
  test('C8 and C9: a character card is cast on Ana\'s character from the opening post, and refused on Bob\'s character from it', async () => {
    const w = await spunWorld();
    asBo(w);
    const landed = must(await w.fake.playCard('aura', w.boFace, w.anaFace, {}, '', 'character', w.opening));
    expect(landed).toMatchObject({ kind: 'card', targetActId: w.opening, payload: { reach: 'character', character: w.anaFace } });
    expect(await w.fake.playCard('aura', w.boFace, w.boFace, {}, '', 'character', w.opening)).toEqual(refused('a card on a character is played from one of its posts'));
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.above.map((p) => [p.play, p.reach, p.target])).toEqual([[landed.id, 'character', w.anaFace]]);
  });
  test('C10 and C11: a thread Gimmick is used on S by Ana\'s character and refused to Bob\'s in "is used on a thread your own character started"', async () => {
    const w = await spunWorld();
    asBo(w);
    expect(await w.fake.useCard('sentry', w.boFace, w.thread, {}, '', 'thread')).toEqual(refused('Sentry is used on a thread your own character started'));
    asAna(w);
    const used = must(await w.fake.useCard('sentry', w.anaFace, w.thread, {}, '', 'thread'));
    expect(used).toMatchObject({ kind: 'card', targetActId: w.opening, thread: w.thread, payload: { reach: 'thread', thread: w.thread } });
  });
  test('C12 and C13: a thread Move is cast on S by Bob\'s character, and set face down by him on his reply in S; the page delivers the thread play in `above`', async () => {
    const w = await spunWorld();
    asBo(w);
    const cast = must(await w.fake.playCard('mover', w.boFace, w.thread, {}, '', 'thread'));
    expect(cast).toMatchObject({ kind: 'card', targetActId: w.opening, payload: { reach: 'thread' } });
    const set = must(await w.fake.setCard('mover', w.boFace, w.reply, {}));
    expect([set.kind, set.targetActId, set.thread]).toEqual(['set', w.reply, w.thread]);
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.above.map((p) => [p.play, p.reach, p.target])).toContainEqual([cast.id, 'thread', w.thread]);
  });
  test('C14: a spin from a character card on Ana\'s character, pressed at the opening post, lands with its moment', async () => {
    const w = await spunWorld();
    const play = w.fake.seed.reach(w.boFace, 'character', w.anaFace, 'aura', { post: w.opening });
    const again = must(await w.fake.spin(play, w.anaFace, 'Spun at', 'body', undefined, w.opening));
    expect(again.act.payload).toEqual({ title: 'Spun at', body: 'body', at: w.opening });
    const moment = (await w.fake.spinMoment(again.act.id))!;
    expect(moment.version.id).toBe(w.opening);
    expect(moment.recorded).toBe(true);
  });
  test('C15: any card on an edit Act or a card Act is refused in "a card lands on a post", and a set in "a card is set face down on a post"', async () => {
    const w = await spunWorld();
    const mine = must(await w.fake.post(w.thread, w.anaFace, 'Ana replies.', null));
    must(await w.fake.edit(mine.id, w.anaFace, 'Ana replies, again.'));
    const edited = (await w.fake.history(mine.id))[1]!;
    expect(edited.kind).toBe('edit');
    const card = must(await w.fake.playCard('blot', w.anaFace, w.opening, {}, ''));
    for (const target of [edited.id, card.id]) {
      expect(await w.fake.playCard('blot', w.anaFace, target, {}, '')).toEqual(refused('a card lands on a post', 'config'));
      expect(await w.fake.setCard('snare', w.anaFace, target, {})).toEqual(refused('a card is set face down on a post', 'config'));
    }
  });
  test('C16: a second play of a stack-1 card on the opening post is refused in "this post already carries that card"', async () => {
    const w = await spunWorld();
    asBo(w);
    must(await w.fake.playCard('solo', w.boFace, w.opening, {}, ''));
    expect(await w.fake.playCard('solo', w.boFace, w.opening, {}, '')).toEqual(refused('this post already carries that card', 'config'));
  });
  test('a thread play that wore off and keeps is `kept` on S\'s page', async () => {
    const w = await spunWorld();
    asBo(w);
    const cast = must(await w.fake.playCard('glint', w.boFace, w.thread, {}, '', 'thread'));
    w.fake.clock.advance(1000);
    const late = w.fake.seed.post(w.thread, w.boFace, 'While it was up.');
    w.fake.clock.advance(2 * DAY);
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, 20, []))!;
    expect(page.kept.map((k) => [k.play, k.reach, k.target])).toEqual([[cast.id, 'thread', w.thread]]);
    expect(page.acts.map((a) => a.id)).toContain(late);
  });
  test('a spin Act and a post are counted apart: a character\'s spin count holds the opening post, its post count the replies', async () => {
    const w = await spunWorld();
    expect(await w.fake.characterCounts(w.anaFace)).toEqual({ posts: 0, spins: 1, cards: 0 });
    expect(await w.fake.characterCounts(w.boFace)).toEqual({ posts: 2, spins: 0, cards: 0 });
  });
  test('an author veil on the opening post moves one spin, and no post, from its author\'s character to the stand-in, and back when the veil ends', async () => {
    const w = await spunWorld();
    w.fake.seed.cards(w.bo, { hood: 1 });
    asBo(w);
    must(await w.fake.playCard('hood', w.boFace, w.opening, {}, ''));
    const stand = (await w.fake.act(w.opening))!.character!;
    expect(stand).not.toBe(w.anaFace);
    expect(await w.fake.characterCounts(w.anaFace)).toEqual({ posts: 0, spins: 0, cards: 0 });
    expect(await w.fake.characterCounts(stand)).toEqual({ posts: 0, spins: 1, cards: 0 });
    w.fake.clock.advance(3 * DAY + MINUTE);
    expect(await w.fake.characterCounts(w.anaFace)).toEqual({ posts: 0, spins: 1, cards: 0 });
    expect(await w.fake.characterCounts(stand)).toEqual({ posts: 0, spins: 0, cards: 0 });
  });
});

describe('the welcome pack: one sealed gift per account, opened by the player', () => {
  const splat = { key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, stack: 9, playPrice: () => 0, canApply: () => ({ ok: true as const, value: undefined }), validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }) };
  const dud = { ...splat, key: 'dud', name: 'Dud' };
  const gifted = (startingPack: string | null): Instance => ({
    ...instance, cards: [splat, dud], settings: { ...settings, startingPack },
    packs: [{ key: 'starter', contents: ['splat', 'dud', 'splat'] }, { key: 'booster', pulls: [{ weights: { common: 1 } }] }],
  });
  const world = (startingPack: string | null = 'starter') => {
    const fake = createFake({ instance: gifted(startingPack) });
    const ana = fake.seed.account('ana');
    fake.signInAs(ana);
    return { fake, ana };
  };
  const make = async (fake: ReturnType<typeof createFake>, name: string) => { const a = await fake.createCharacter(name, 'face', 'now', 'silent'); expect(a.ok).toBe(true); };

  test('a first character grants one sealed pack, whose cards reach no hand until it is opened', async () => {
    const { fake } = world();
    expect(await fake.sealedPacks()).toEqual([]);
    await make(fake, 'Ana Face');
    expect(await fake.sealedPacks()).toEqual([{ pack: expect.any(String), kind: 'starter', at: expect.any(String) }]);
    expect(await fake.myCards()).toEqual([]);
    const log = await fake.log(null);
    expect(log.packs).toEqual([{ pack: expect.any(String), kind: 'starter', price: 0, repriced: false, contents: [], at: expect.any(String), source: 'welcome', openedAt: null }]);
    expect(log.cards).toEqual([]);
  });

  test('a second character grants nothing more, and no gift is granted where the instance names none', async () => {
    const { fake } = world();
    await make(fake, 'Ana Face');
    await make(fake, 'Ana Heel');
    expect(await fake.sealedPacks()).toHaveLength(1);
    const none = world(null);
    await make(none.fake, 'Ana Face');
    expect(await none.fake.sealedPacks()).toEqual([]);
  });

  test('opening gives the cards in the pack\'s order, once, with no Aura moved, and leaves the pack in the log opened', async () => {
    const { fake } = world();
    await make(fake, 'Ana Face');
    const [sealed] = await fake.sealedPacks();
    const before = await fake.wallet();
    const opened = await fake.openPack(sealed!.pack);
    expect(opened).toEqual({ ok: true, value: { pack: sealed!.pack, kind: 'starter', contents: ['splat', 'dud', 'splat'], refunds: [] } });
    expect(await fake.wallet()).toEqual(before);
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 2 }, { card: 'dud', held: 1 }]);
    expect(await fake.sealedPacks()).toEqual([]);
    const log = await fake.log(null);
    expect(log.packs).toEqual([{ pack: sealed!.pack, kind: 'starter', price: 0, repriced: false, contents: ['splat', 'dud', 'splat'], at: expect.any(String), source: 'welcome', openedAt: expect.any(String) }]);
    expect(log.cards.filter((c) => c.kind === 'pulled').map((c) => [c.card, c.pack, c.price])).toEqual([['splat', sealed!.pack, 0], ['dud', sealed!.pack, 0], ['splat', sealed!.pack, 0]]);
    expect(await fake.openPack(sealed!.pack)).toEqual(refused('this pack is already open'));
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 2 }, { card: 'dud', held: 1 }]);
  });

  test('a pack that does not exist and a pack that is another account\'s are refused in the same words', async () => {
    const { fake } = world();
    await make(fake, 'Ana Face');
    const [sealed] = await fake.sealedPacks();
    const bo = fake.seed.account('bo');
    fake.signInAs(bo);
    expect(await fake.openPack(sealed!.pack)).toEqual(refused('there is no such pack'));
    expect(await fake.openPack('00000000-0000-4000-8000-000000000000')).toEqual(refused('there is no such pack'));
    expect(await fake.sealedPacks()).toEqual([]);
    fake.signInAs(null);
    expect(await fake.sealedPacks()).toEqual([]);
  });

  test('a startingPack that names a pull pack, or no pack at all, grants nothing', async () => {
    for (const named of ['booster', 'ghost']) {
      const { fake } = world(named);
      await make(fake, 'Ana Face');
      expect(await fake.sealedPacks()).toEqual([]);
    }
  });

  test('a bought pack is opened at once and is never sealed', async () => {
    const own: Instance = { ...gifted(null), machine: [{ item: { pack: 'starter' }, availability: 'onSale' as const, price: 300 }] };
    const fake = createFake({ instance: own });
    const ana = fake.seed.account('ana');
    fake.seed.wallet(ana, 500);
    fake.signInAs(ana);
    const bought = await fake.buyPack((await fake.machine())[0]!);
    expect(bought.ok).toBe(true);
    expect(await fake.sealedPacks()).toEqual([]);
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 2 }, { card: 'dud', held: 1 }]);
    expect((await fake.log(null)).packs[0]).toMatchObject({ source: 'bought', openedAt: expect.any(String) });
  });
});

describe('polls (0395, 0396)', () => {
  const draft = { question: 'Which?', options: ['A', 'B', 'C'], pick: 2, secret: false, lasts: { unit: 'day' as const, count: 1 } };
  const poll = async (secret = false) => {
    const w = world();
    const post = must(await w.fake.post(w.thread, w.anaFace, 'Vote.', null, undefined, { ...draft, secret }));
    const page = (await w.fake.threadPage(w.thread, { page: 1 }, null, []))!;
    return { ...w, post, id: page.polls[0]!.act.id, page };
  };

  test('a poll rides on its post, with its counts, and a draft the settings refuse is refused in the words poll_written uses', async () => {
    const { page, post, anaFace, fake, thread } = await poll();
    expect(page.polls).toHaveLength(1);
    expect(page.polls[0]).toMatchObject({ post: post.id, counts: [0, 0, 0], voters: 0, closed: false, close: null });
    expect(page.polls[0]!.act.kind).toBe('poll');
    expect(page.polls[0]!.act.seq).toBeNull();
    expect(await fake.post(thread, anaFace, 'No.', null, undefined, { ...draft, options: ['A', 'A'] })).toEqual(refused('no two options are the same', 'poll'));
    expect(await fake.post(thread, anaFace, 'No.', null, undefined, { ...draft, lasts: { unit: 'minute', count: 5 } })).toEqual(refused('a poll lasts from 1 hour to 14 days', 'poll'));
    expect(await fake.startThread('general', anaFace, 'T', 'b', undefined, { ...draft, pick: 9 })).toEqual(refused('a poll lets 1 to 3 options be picked', 'poll'));
  });

  test('an admin\'s close of a poll is a ruling/pollClosed alert, heard live and listed for the poll\'s account, about the close Act', async () => {
    const { fake, ana, anaFace, id } = await poll();
    const heard: { kind: string; sub: string | null; character: string | null; act: string | null }[] = [];
    fake.subscribeAccount({ onAlert: (a) => heard.push(a) });
    const boss = fake.seed.account('boss', { admin: true });
    fake.signInAs(boss);
    const close = must(await fake.closePollAsAdmin(id)).act;
    await flush();
    expect(heard).toEqual([expect.objectContaining({ kind: 'ruling', sub: 'pollClosed', act: close.id, character: anaFace })]);
    fake.signInAs(ana);
    expect((await fake.alerts()).filter((a) => a.kind === 'ruling')).toMatchObject([{ sub: 'pollClosed', act: close.id, character: anaFace }]);
    fake.signInAs(boss);
    expect((await fake.alerts()).filter((a) => a.kind === 'ruling')).toEqual([]);
  });

  test('an admin who closes a poll their own account owns is told too: close_poll_as_admin passes no acting account', async () => {
    const { fake } = await poll();
    const boss = fake.seed.account('boss', { admin: true });
    const bossFace = fake.seed.character(boss, 'Boss Face', 'face');
    fake.signInAs(boss);
    const started = must(await fake.startThread('general', bossFace, 'Mine', 'Vote.', undefined, draft));
    const mine = (await fake.threadPage(started.thread.id, { page: 1 }, null, []))!.polls[0]!.act.id;
    const close = must(await fake.closePollAsAdmin(mine)).act;
    expect((await fake.alerts()).filter((a) => a.kind === 'ruling')).toMatchObject([{ sub: 'pollClosed', act: close.id, character: bossFace }]);
  });

  test('a poll and a public ballot can be spun: the place names them, the page\'s origin carries the poll, and the refusals are the server\'s', async () => {
    const { fake, id, anaFace, thread, post, ana } = await poll();
    const ballot = must(await fake.castBallot(id, anaFace, [1])).act;
    const on = { kind: 'post', thread, title: 'Hello', seq: post.seq };
    const board = await boardId(fake, 'general');
    const polled = must(await fake.spin(id, anaFace, 'About the poll', 'b'));
    expect(polled.thread.origin).toEqual({ kind: 'poll', question: 'Which?', on, board });
    const origin = (await fake.threadPage(polled.thread.id, { page: 1 }, null, []))!.origin!;
    expect([origin.polls.map((x) => x.act.id), origin.at]).toEqual([[id], { thread, seq: post.seq }]);
    expect(origin.polls[0]!.counts).toEqual([0, 1, 0]);
    const balloted = must(await fake.spin(ballot.id, anaFace, 'About the ballot', 'b'));
    expect(balloted.thread.origin).toMatchObject({ kind: 'ballot', character: { id: anaFace, name: expect.any(String) }, question: 'Which?', on });
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    const close = must(await fake.closePollAsAdmin(id)).act;
    fake.signInAs(ana);
    expect(await fake.spin(close.id, anaFace, 'About the close', 'b')).toEqual(refused('spin the poll'));
  });

  test('a secret ballot cannot be spun, and a replaced or removed poll cannot be spun', async () => {
    const secret = await poll(true);
    const ballot = must(await secret.fake.castBallot(secret.id, secret.anaFace, [0])).act;
    expect(await secret.fake.spin(ballot.id, secret.anaFace, 'No', 'b')).toEqual(refused('a secret ballot cannot be spun'));
    const w = await poll();
    must(await w.fake.edit(w.post.id, w.anaFace, 'Vote again.', { ...draft, question: 'Which now?' }));
    expect(await w.fake.spin(w.id, w.anaFace, 'No', 'b')).toEqual(refused('that poll was replaced'));
  });

  test('a ballot counts its characters; the latest ballot counts, a withdrawal takes it back, and a refusal names the rule', async () => {
    const { fake, id, anaFace, anaHeel } = await poll();
    expect(must(await fake.castBallot(id, anaFace, [2, 0])).counts).toMatchObject({ counts: [1, 0, 1], voters: 1 });
    fake.clock.advance(1_000);
    expect(must(await fake.castBallot(id, anaFace, [1])).counts).toMatchObject({ counts: [0, 1, 0], voters: 1 });
    // Two masks of one player each count.
    expect(must(await fake.castBallot(id, anaHeel, [1])).counts).toMatchObject({ counts: [0, 2, 0], voters: 2 });
    fake.clock.advance(1_000);
    expect(must(await fake.castBallot(id, anaFace, [])).counts).toMatchObject({ counts: [0, 1, 0], voters: 1 });
    expect(await fake.castBallot(id, anaFace, [0, 1, 2])).toEqual(refused('pick up to 2 options'));
    expect(await fake.castBallot(id, anaFace, [3])).toEqual(refused('pick up to 2 options'));
    expect(await fake.castBallot(id, anaFace, [1, 1])).toEqual(refused('pick up to 2 options'));
    expect(await fake.castBallot(id, anaFace, [0.5])).toMatchObject({ ok: false, field: 'picks' });
    expect(await fake.castBallot('00000000-0000-4000-8000-00000000ffff', anaFace, [0])).toEqual(refused('there is no such poll'));
  });

  test('the log holds the caller\'s own ballots (cast, changed, withdrawn, secret) with the poll\'s words and place, and an admin\'s close of their poll; no one else\'s', async () => {
    const { fake, id, anaFace, anaHeel, post, thread, ana } = await poll();
    const secret = await (async () => {
      must(await fake.post(thread, anaHeel, 'Secretly.', null, undefined, { ...draft, question: 'Hush?', secret: true }));
      const polls = [...(await fake.threadPage(thread, { page: 1 }, null, []))!.polls, ...((await fake.threadPage(thread, { page: 2 }, null, []))?.polls ?? [])];
      return polls.find((x) => x.act.id !== id)!.act.id;
    })();
    const first = must(await fake.castBallot(id, anaFace, [1])).act.id;
    fake.clock.advance(1_000);
    const second = must(await fake.castBallot(id, anaFace, [2])).act.id;
    fake.clock.advance(1_000);
    const withdrawn = must(await fake.castBallot(id, anaFace, [])).act.id;
    fake.clock.advance(1_000);
    /* A cast after a withdrawal is a cast, not a change: the character's previous ballot picked nothing. */
    const recast = must(await fake.castBallot(id, anaFace, [0])).act.id;
    const hushed = must(await fake.castBallot(secret, anaFace, [2])).act.id;
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    const close = must(await fake.closePollAsAdmin(id)).act.id;
    fake.signInAs(ana);
    const log = (await fake.log(null));
    const place = { thread, title: 'Hello', seq: post.seq };
    const byAct = new Map((log.ballots ?? []).map((b) => [b.act, b]));
    expect([first, second, withdrawn, recast].map((a) => [byAct.get(a)!.picks, byAct.get(a)!.changed])).toEqual([[[1], false], [[2], true], [[], true], [[0], false]]);
    expect(byAct.get(first)).toMatchObject({ poll: id, character: anaFace, question: 'Which?', secret: false, options: ['A', 'B', 'C'], place });
    expect(byAct.get(hushed)).toMatchObject({ character: anaFace, picks: [2], secret: true, question: 'Hush?', changed: false });
    expect(log.pollCloses).toEqual([{ act: close, poll: id, character: anaFace, at: expect.any(String), question: 'Which?', place }]);
    fake.signInAs(fake.seed.account('someone-else'));
    const other = await fake.log(null);
    expect([other.ballots, other.pollCloses]).toEqual([[], []]);
  });

  test('a poll closes by itself at its end, by its author, and by an admin; a closed poll takes no ballot and a second close is refused', async () => {
    const { fake, id, anaFace } = await poll();
    must(await fake.castBallot(id, anaFace, [0]));
    fake.clock.advance(DAY);
    expect(await fake.castBallot(id, anaFace, [1])).toEqual(refused('that poll has closed'));

    const early = await poll();
    expect(await early.fake.closePoll(early.id, early.boFace)).toEqual(refused('you do not play that character'));
    must(await early.fake.castBallot(early.id, early.anaFace, [1]));
    early.fake.clock.advance(1_000);
    expect(must(await early.fake.closePoll(early.id, early.anaFace)).counts).toMatchObject({ counts: [0, 1, 0], voters: 1, closed: true });
    expect(await early.fake.castBallot(early.id, early.anaFace, [0])).toEqual(refused('that poll has closed'));
    expect(await early.fake.closePoll(early.id, early.anaFace)).toEqual(refused('that poll has closed'));
    const shown = (await early.fake.threadPage(early.thread, { page: 1 }, null, []))!.polls[0]!;
    expect(shown.closed).toBe(true);
    expect(shown.close).toMatchObject({ kind: 'poll_close', payload: { by: 'author' } });

    const adminned = await poll();
    expect(await adminned.fake.closePollAsAdmin(adminned.id)).toEqual(refused('only an admin closes a poll'));
    adminned.fake.signInAs(adminned.fake.seed.account('boss', { admin: true }));
    expect(must(await adminned.fake.closePollAsAdmin(adminned.id)).act).toMatchObject({ kind: 'poll_close', character: null, payload: { by: 'admin' } });
  });

  test('a late older poll event does not overwrite a newer one, and a closed one is final', async () => {
    const { fake, id, anaFace, thread } = await poll();
    const heard: { counts: readonly number[]; closed: boolean; at: string }[] = [];
    fake.subscribeThread(thread, { onPoll: (e) => heard.push(e) });
    await flush();
    fake.broadcast.hold();
    must(await fake.castBallot(id, anaFace, [0]));
    fake.clock.advance(1_000);
    must(await fake.closePoll(id, anaFace));
    fake.broadcast.flush({ reverse: true, twice: true });
    await flush();
    expect(heard.map((e) => e.closed)).toEqual([true]);
    expect(heard[0]!.at > new Date(START).toISOString()).toBe(true);
  });
  test('an author closes only its own poll', async () => {
    const { fake, id, bo, boFace } = await poll();
    fake.signInAs(bo);
    expect(await fake.closePoll(id, boFace)).toEqual(refused('only a poll\'s author can close it'));
  });

  test('a public poll lists its voters, newest first, with their faces; the caller\'s own ballots come back as myBallots', async () => {
    const { fake, id, anaFace, anaHeel, boFace, bo, thread } = await poll();
    must(await fake.castBallot(id, anaFace, [0]));
    fake.clock.advance(1_000);
    fake.signInAs(bo);
    must(await fake.castBallot(id, boFace, [2]));
    const page = (await fake.threadPage(thread, { page: 1 }, null, []))!;
    expect(page.voters.map((v) => [v.character, v.picks])).toEqual([[boFace, [2]], [anaFace, [0]]]);
    expect(page.voterCast.map((c) => c.id).sort()).toEqual([anaFace, boFace].sort());
    expect(page.myBallots.map((b) => b.character)).toEqual([boFace]);
    expect(page.votersMore).toEqual([]);
    const ballots = must(await fake.pollBallots(id));
    expect(ballots.ballots.map((b) => [b.character.name, b.picks])).toEqual([['Bo Face', [2]], ['Ana Face', [0]]]);
    expect(ballots.more).toBe(false);
    expect(anaHeel).toBeDefined();
  });

  test('a secret poll names no one to anyone: the ballot Act, the event, the page and the record are the same for every caller, and the owner reads their own through myBallots', async () => {
    const { fake, id, anaFace, bo, ana, thread } = await poll(true);
    const heard: Act[] = [];
    const counts: unknown[] = [];
    fake.subscribeThread(thread, { onAct: (a) => heard.push(a), onPoll: (c) => counts.push(c) });
    await flush();
    const cast = must(await fake.castBallot(id, anaFace, [1]));
    await flush();
    expect(cast.act).toMatchObject({ kind: 'ballot', character: null, payload: { secret: true }, currentPayload: { secret: true } });
    expect(JSON.stringify(heard)).not.toContain(anaFace);
    expect(heard[0]).toEqual(cast.act);
    expect(counts).toEqual([{ poll: id, counts: [0, 1, 0], voters: 1, endsAt: expect.any(String), closed: false, at: cast.act.createdAt }]);
    expect(fake.broadcast.log.map((e) => e.event)).toContain('poll');
    const mine = (await fake.threadPage(thread, { page: 1 }, null, []))!;
    expect(mine.myBallots).toEqual([{ act: cast.act.id, poll: id, character: anaFace, picks: [1], at: expect.any(String) }]);
    expect(mine.voters).toEqual([]);
    fake.signInAs(bo);
    const theirs = (await fake.threadPage(thread, { page: 1 }, null, []))!;
    expect(theirs.myBallots).toEqual([]);
    expect({ ...theirs.polls[0], act: null }).toEqual({ ...mine.polls[0], act: null });
    expect(theirs.voters).toEqual([]);
    expect(await fake.pollBallots(id)).toEqual(refused('that poll\'s ballots are secret'));
    expect((await fake.actsById([cast.act.id]))[0]).toMatchObject({ character: null, payload: { secret: true } });
    expect(ana).toBeDefined();
  });

  test('an edit may replace or remove a poll with no ballot; one with a ballot, or a closed one, cannot change, and the words still edit', async () => {
    const { fake, anaFace, post, id, thread } = await poll();
    must(await fake.edit(post.id, anaFace, 'Vote again.', { ...draft, question: 'Which one?' }));
    const replaced = (await fake.threadPage(thread, { page: 1 }, null, []))!.polls[0]!;
    expect(replaced.act.payload.question).toBe('Which one?');
    expect(await fake.castBallot(id, anaFace, [0])).toEqual(refused('that poll was replaced'));
    must(await fake.castBallot(replaced.act.id, anaFace, [0]));
    expect(await fake.edit(post.id, anaFace, 'Vote once more.', { removed: true })).toEqual(refused('a poll cannot change once a ballot is cast; you can still close it'));
    must(await fake.edit(post.id, anaFace, 'Words only.'));
    expect((await fake.threadPage(thread, { page: 1 }, null, []))!.polls).toHaveLength(1);
    // Closed with a ballot it is still the ballot that says so first; closed with none, it is final all the same.
    must(await fake.closePoll(replaced.act.id, anaFace));
    expect(await fake.edit(post.id, anaFace, 'Words only.', draft)).toEqual(refused('a poll cannot change once a ballot is cast; you can still close it'));
    const bare = await poll();
    must(await bare.fake.closePoll(bare.id, bare.anaFace));
    expect(await bare.fake.edit(bare.post.id, bare.anaFace, 'Words only.', draft)).toEqual(refused('a closed poll cannot change'));
    must(await bare.fake.edit(bare.post.id, bare.anaFace, 'Words only.'));
  });

  test('a removal takes a post\'s poll away; on a post with none it writes no poll', async () => {
    const { fake, anaFace, post, thread } = await poll();
    must(await fake.edit(post.id, anaFace, 'Never mind.', { removed: true }));
    expect((await fake.threadPage(thread, { page: 1 }, null, []))!.polls).toEqual([]);
    must(await fake.edit(post.id, anaFace, 'Never mind.', { removed: true }));
    expect(await fake.edit(post.id, anaFace, 'x'.repeat(51), draft)).toEqual(refused('is longer than 50 characters', 'body'));
  });

  test('a poll is a place in no thread, and the settlement\'s Acts do not see it', async () => {
    const { fake, id, anaFace, thread } = await poll();
    must(await fake.castBallot(id, anaFace, [0]));
    expect((await fake.thread(thread))?.lastSeq).toBe(2);
  });

  test('the seed writes a poll and a ballot as their characters do', async () => {
    const { fake, anaFace, ana, thread } = world();
    const post = fake.seed.post(thread, anaFace, 'Vote.');
    const id = fake.seed.poll(post, draft, { at: START });
    fake.seed.ballot(anaFace, id, [1], { at: START + MINUTE });
    expect(() => fake.seed.poll(post, { ...draft, options: ['one'] })).toThrow(/a poll has 2 to 10 options/);
    const page = (await fake.threadPage(thread, { page: 1 }, null, []))!;
    expect(page.polls[0]).toMatchObject({ counts: [0, 1, 0], endsAt: new Date(START + DAY).toISOString() });
    expect(ana).toBeDefined();
  });
});

/**
 * The card retirement seed (the card retirement design, sections 3 and 4), as the fake writes it: a renamed copy is a `renamedOut` and a `renamedIn` row, a withdrawn one a `withdrawn`
 * row with its refund and one `withdrawal` wallet event; the hand counts `renamedIn` +1 and the others -1 only without an Act; and a sealed pack's withdrawn card is refunded at opening.
 */
describe('the card retirement seed', () => {
  const base = instance.cards[0]!;
  const collector = { ...base, key: 'collector', name: 'Card Collector', formerly: [{ key: 'trap-card', name: 'Trap Card' }] };
  const kept = { ...base, key: 'kept', name: 'Kept' };
  const retiring: Instance = {
    ...instance, cards: [kept, collector], withdrawn: [{ key: 'bluff', name: 'Bluff', refund: 100 }],
    settings: { ...settings, startingPack: 'starter' },
    packs: [{ key: 'starter', contents: ['kept', 'bluff', 'trap-card'] }],
  };
  const world = () => {
    const fake = createFake({ instance: retiring });
    const ana = fake.seed.account('ana');
    fake.seed.wallet(ana, 0);
    fake.signInAs(ana);
    return { fake, ana };
  };

  test('a held copy is moved once: renamed ones to the new key, withdrawn ones refunded, with the hand folded as the rows say', async () => {
    const { fake, ana } = world();
    fake.seed.cards(ana, { 'trap-card': 2, bluff: 2, kept: 1 });
    fake.seed.retireCards();
    const log = await fake.log(null);
    const kinds = (k: string) => log.cards.filter((c) => c.kind === k);
    expect(kinds('renamedOut')).toMatchObject([{ card: 'trap-card', act: null }, { card: 'trap-card', act: null }]);
    expect(kinds('renamedIn')).toMatchObject([{ card: 'collector', act: null }, { card: 'collector', act: null }]);
    expect(kinds('withdrawn')).toMatchObject([{ card: 'bluff', act: null, price: 100 }, { card: 'bluff', act: null, price: 100 }]);
    expect([...(await fake.myCards())].sort((a, b) => a.card.localeCompare(b.card))).toEqual([{ card: 'collector', held: 2 }, { card: 'kept', held: 1 }]);
    expect(await fake.wallet()).toEqual({ balance: 200, cap: 600 });
    expect(log.wallet.filter((w) => w.kind === 'withdrawal')).toMatchObject([{ change: 200, balanceAfter: 200, ref: null }]);
    fake.seed.retireCards();
    expect((await fake.log(null)).cards).toHaveLength(log.cards.length);
  });

  test('a live face-down back is moved with its set play as the out row\'s act, and shows no returned row when it ends', async () => {
    const { fake, ana } = world();
    const ranked = fake.seed.character(ana, 'Ana Face', 'face');
    const { act: post } = fake.seed.thread('general', ranked, 'Hello', 'First post');
    const set = fake.seed.set(ranked, post, 'trap-card', {});
    fake.seed.retireCards();
    const log = await fake.log(null);
    expect(log.cards.filter((c) => c.kind === 'renamedOut')).toMatchObject([{ card: 'trap-card', act: set }]);
    expect(log.cards.filter((c) => c.kind === 'renamedIn')).toMatchObject([{ card: 'collector', act: null }]);
    expect(await fake.myCards()).toEqual([{ card: 'collector', held: 1 }]);
    fake.clock.advance(400 * DAY);
    expect((await fake.log(null)).cards.filter((c) => c.kind === 'returned')).toEqual([]);
    expect(await fake.myCards()).toEqual([{ card: 'collector', held: 1 }]);
  });

  test('a back whose time passed unsprung is a held copy: retiring moves it, and the hand never holds the gone key', async () => {
    const { fake, ana } = world();
    const face = fake.seed.character(ana, 'Ana Face', 'face');
    const { act: post } = fake.seed.thread('general', face, 'Hello', 'First post');
    fake.seed.set(face, post, 'trap-card', {});
    fake.clock.advance(400 * DAY);
    fake.seed.retireCards();
    expect(await fake.myCards()).toEqual([{ card: 'collector', held: 1 }]);
    expect((await fake.log(null)).cards.filter((c) => c.kind === 'renamedOut')).toHaveLength(1);
    fake.clock.advance(DAY);
    expect(await fake.myCards()).toEqual([{ card: 'collector', held: 1 }]);
  });

  test('opening a sealed pack refunds a withdrawn card with a withdrawn row and no copy, and pulls a renamed one under its new key', async () => {
    const { fake } = world();
    expect((await fake.createCharacter('Ana Face', 'face', 'now', 'silent')).ok).toBe(true);
    const [sealedPack] = await fake.sealedPacks();
    const opened = must(await fake.openPack(sealedPack!.pack));
    expect(opened.contents).toEqual(['kept', 'bluff', 'collector']);
    expect(opened.refunds).toEqual([{ index: 1, refund: 100 }]);
    const log = await fake.log(null);
    expect(log.cards.filter((c) => c.pack === sealedPack!.pack).map((c) => [c.kind, c.card, c.price]).sort()).toEqual([['pulled', 'collector', 0], ['pulled', 'kept', 0], ['withdrawn', 'bluff', 100]]);
    expect(log.wallet.filter((w) => w.kind === 'withdrawal')).toMatchObject([{ change: 100 }]);
    expect([...(await fake.myCards())].sort((a, b) => a.card.localeCompare(b.card))).toEqual([{ card: 'collector', held: 1 }, { card: 'kept', held: 1 }]);
  });

  test('the admin machine marks a slot for a retired card, the card it became, and a withdrawn one', async () => {
    const own: Instance = { ...retiring, machine: [
      { item: { card: 'kept' }, availability: 'onSale', price: 100 }, { item: { card: 'trap-card' }, availability: 'onSale', price: 100 },
      { item: { card: 'bluff' }, availability: 'onSale', price: 100 }, { item: { pack: 'gone' }, availability: 'onSale', price: 100 },
    ] };
    const fake = createFake({ instance: own });
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    const slots = await fake.adminMachine();
    expect(slots.map((s) => [s.retired, s.became, s.withdrawn])).toEqual([[false, null, false], [true, 'collector', false], [true, null, true], [true, null, false]]);
  });
});

/* postPlays and kindPlays (docs/plans/2026-11-21-post-plays-design.md, sections 1 and 3): the fake's answers, case for case with the database's post_plays and kind_plays (supabase/tests/0410-post-plays.sql). */
describe('postPlays reads what a page holds for a post: the plays in force, each kind\'s two stand-ins, and the counts', () => {
  const cards = (plays: readonly Act[]) => plays.filter((a) => a.kind === 'card').map((a) => a.id);
  const iso = (fake: { clock: { now(): number } }, ms: number) => new Date(fake.clock.now() + ms).toISOString();
  /** Players who react: each reacts once to an Act, so an Act's draw is the number of reactors given. */
  const draw = (fake: ReturnType<typeof world>['fake'], play: string, n: number) => {
    for (let i = 0; i < n; i++) {
      const account = fake.seed.account(`reactor-${play}-${i}`);
      fake.seed.react(account, fake.seed.character(account, `Reactor ${i} of ${play.slice(0, 8)}`, 'face'), play, 'fire');
    }
  };

  test('a post with three kinds: 12 plays over time with two up, a kind wholly over: the in-force set, each kind\'s two stand-ins, the counts', async () => {
    const { fake, boFace, opener } = world();
    const whoops: string[] = [];
    for (let i = 0; i < 12; i++) {
      fake.clock.advance(60 * MINUTE);
      whoops.push(fake.seed.card(boFace, opener, 'whoops', i < 10 ? { ends: iso(fake, 10 * MINUTE) } : {}));
    }
    fake.clock.advance(60 * MINUTE);
    /* The third-oldest play drew the most, so it is the kind's second stand-in. */
    draw(fake, whoops[2]!, 3);
    draw(fake, whoops[5]!, 1);
    /* A kind wholly over: three plays, the first two drawing alike; the newer of the two wins the draw, and the newest is the other stand-in. */
    const blot: string[] = [];
    for (let i = 0; i < 3; i++) { fake.clock.advance(MINUTE); blot.push(fake.seed.card(boFace, opener, 'blot', { ends: iso(fake, MINUTE / 2) })); }
    fake.clock.advance(60 * MINUTE);
    draw(fake, blot[0]!, 1);
    draw(fake, blot[1]!, 1);
    const read = await fake.postPlays([opener]);
    expect(cards(read.plays)).toEqual([whoops[2]!, whoops[10]!, whoops[11]!, blot[1]!, blot[2]!]);
    expect(read.counts).toEqual(expect.arrayContaining([{ post: opener, card: 'whoops', all: 12, took: 12 }, { post: opener, card: 'blot', all: 3, took: 3 }]));
    expect(read.counts).toHaveLength(2);
  });

  test('a cast with no end, played before 30 ended Uses, is on the page: the page carries the plays in force however many ended after', async () => {
    const { fake, boFace, opener } = world();
    const cast = fake.seed.card(boFace, opener, 'cast');
    for (let i = 0; i < 30; i++) { fake.clock.advance(MINUTE); fake.seed.card(boFace, opener, 'use', { ends: iso(fake, MINUTE / 2) }); }
    fake.clock.advance(MINUTE);
    const read = await fake.postPlays([opener]);
    expect(cards(read.plays)).toContain(cast);
    expect(read.counts.find((c) => c.card === 'use')).toEqual({ post: opener, card: 'use', all: 30, took: 30 });
    /* The cast and the newest Use (the Uses' two stand-ins are one play, as none drew more). */
    expect(cards(read.plays)).toHaveLength(2);
  });

  test('a heart and a character card played from the post are in its plays; an ended one is there only as a stand-in', async () => {
    const { fake, boFace, opener } = world();
    const heart = fake.seed.card(boFace, opener, 'heart', { instant: true });
    fake.clock.advance(MINUTE);
    const gone = fake.seed.reach(boFace, 'character', boFace, 'cuffs', { post: opener, ends: fake.clock.now() + MINUTE });
    fake.clock.advance(2 * MINUTE);
    const live = fake.seed.reach(boFace, 'character', boFace, 'cuffs', { post: opener, ends: fake.clock.now() + 60 * MINUTE });
    const read = await fake.postPlays([opener]);
    expect(cards(read.plays)).toEqual([heart, live]);
    expect(cards(read.plays)).not.toContain(gone);
    expect(read.counts).toEqual(expect.arrayContaining([{ post: opener, card: 'heart', all: 1, took: 1 }, { post: opener, card: 'cuffs', all: 2, took: 2 }]));
  });

  test('an admin-ended play is not in force, is the stand-in when newest, and its end rides', async () => {
    const { fake, boFace, opener } = world();
    const first = fake.seed.card(boFace, opener, 'whoops');
    fake.clock.advance(MINUTE);
    const second = fake.seed.card(boFace, opener, 'whoops');
    fake.signInAs(fake.seed.account('boss', { admin: true }));
    const ended = must(await fake.reverseCard(second));
    const read = await fake.postPlays([opener]);
    expect(read.plays.map((a) => [a.kind, a.id])).toEqual([['card', first], ['card', second], ['card_end', ended.act]]);
    /* An older play that is ended and is not a stand-in is absent, and so is its end. */
    fake.clock.advance(MINUTE);
    const third = fake.seed.card(boFace, opener, 'whoops');
    must(await fake.reverseCard(first));
    const later = await fake.postPlays([opener]);
    expect(cards(later.plays)).toEqual([third]);
    expect(later.plays.filter((a) => a.kind === 'card_end')).toEqual([]);
    expect(later.counts).toEqual([{ post: opener, card: 'whoops', all: 3, took: 3 }]);
  });

  test('backs: a live back is in force; of four sprung backs the newest and the most drawn come with their springs; a back taken back or run out is absent; no row or count names a back\'s card', async () => {
    const { fake, bo, boFace, opener } = world();
    const sprung: { set: string; spring: string }[] = [];
    for (let i = 0; i < 4; i++) {
      fake.clock.advance(MINUTE);
      const set = fake.seed.set(boFace, opener, 'snare');
      fake.clock.advance(MINUTE);
      sprung.push({ set, spring: fake.seed.spring(set) });
    }
    draw(fake, sprung[1]!.set, 2);
    fake.clock.advance(MINUTE);
    const taken = fake.seed.set(boFace, opener, 'snare');
    fake.signInAs(bo);
    must(await fake.takeBack(boFace, taken));
    fake.clock.advance(MINUTE);
    fake.seed.set(boFace, opener, 'snare', { endsAt: fake.clock.now() + 1 });
    fake.clock.advance(MINUTE);
    const live = fake.seed.set(boFace, opener, 'snare');
    const read = await fake.postPlays([opener]);
    expect(read.plays.filter((a) => a.kind === 'set').map((a) => a.id)).toEqual([sprung[1]!.set, sprung[3]!.set, live]);
    expect(read.plays.filter((a) => a.kind === 'spring').map((a) => a.id)).toEqual([sprung[1]!.spring, sprung[3]!.spring]);
    expect(read.counts).toEqual([{ post: opener, card: null, all: 4, took: 4 }]);
    expect(JSON.stringify([read.counts, read.plays.filter((a) => a.kind === 'set')])).not.toContain('snare');
  });

  test('two posts in one call: each post\'s plays and counts, no cross-talk; none read for none; 201 posts are refused', async () => {
    const { fake, anaFace, boFace, thread, opener } = world();
    const second = must(await fake.post(thread, anaFace, 'second', null));
    const a = fake.seed.card(boFace, opener, 'whoops');
    const b = fake.seed.card(boFace, second.id, 'blot');
    const both = await fake.postPlays([opener, second.id]);
    expect(cards(both.plays)).toEqual([a, b]);
    expect(both.counts).toEqual(expect.arrayContaining([{ post: opener, card: 'whoops', all: 1, took: 1 }, { post: second.id, card: 'blot', all: 1, took: 1 }]));
    expect(both.counts).toHaveLength(2);
    expect(cards((await fake.postPlays([second.id])).plays)).toEqual([b]);
    expect(await fake.postPlays([])).toEqual({ plays: [], counts: [] });
    await expect(fake.postPlays(Array.from({ length: 201 }, (_, i) => `post-${i}`))).rejects.toThrow('at most 200');
  });

});

describe('kindPlays pages a kind\'s older plays, newest first, from a cursor', () => {
  const cards = (plays: readonly Act[]) => plays.filter((a) => a.kind === 'card').map((a) => a.id);
  const ended = (fake: ReturnType<typeof world>['fake'], boFace: string, post: string, n: number) => Array.from({ length: n }, () => {
    fake.clock.advance(MINUTE);
    return fake.seed.card(boFace, post, 'whoops', { ends: new Date(fake.clock.now() + 1).toISOString() });
  });

  test('three pages of 20 over 45 ended plays, newest first and disjoint, then next is null; plays in force never appear', async () => {
    const { fake, boFace, opener } = world();
    const old = ended(fake, boFace, opener, 45);
    fake.clock.advance(MINUTE);
    const up = [fake.seed.card(boFace, opener, 'whoops'), fake.seed.card(boFace, opener, 'whoops')];
    const first = await fake.kindPlays(opener, 'whoops', null, 20);
    expect(cards(first.plays)).toEqual(old.slice(25).reverse());
    expect(first.next).toEqual({ at: expect.any(String), id: old[25]! });
    const second = await fake.kindPlays(opener, 'whoops', first.next, 20);
    expect(cards(second.plays)).toEqual(old.slice(5, 25).reverse());
    const third = await fake.kindPlays(opener, 'whoops', second.next, 20);
    expect(cards(third.plays)).toEqual(old.slice(0, 5).reverse());
    expect(third.next).toBeNull();
    const all = [...cards(first.plays), ...cards(second.plays), ...cards(third.plays)];
    expect(new Set(all).size).toBe(45);
    expect(all.some((id) => up.includes(id))).toBe(false);
  });

  test('size 0 and 500 are clamped to 1 and 50', async () => {
    const { fake, boFace, opener } = world();
    const old = ended(fake, boFace, opener, 55);
    fake.clock.advance(MINUTE);
    const one = await fake.kindPlays(opener, 'whoops', null, 0);
    expect(cards(one.plays)).toEqual([old[54]!]);
    expect(one.next).not.toBeNull();
    const most = await fake.kindPlays(opener, 'whoops', null, 500);
    expect(cards(most.plays)).toHaveLength(50);
    expect(most.next).not.toBeNull();
  });

  test('the page carries the tallies, the threads spun from the plays, their casters, and a second caller\'s own reactions only', async () => {
    const { fake, ana, anaFace, boFace, opener } = world();
    const [a] = ended(fake, boFace, opener, 2) as [string, string];
    fake.clock.advance(MINUTE);
    const cy = fake.seed.account('cy');
    fake.seed.react(ana, anaFace, a, 'fire');
    fake.seed.react(cy, fake.seed.character(cy, 'Cy Face', 'face'), a, 'tea');
    must(await fake.spin(a, anaFace, 'From the play', ''));
    const asAna = await fake.kindPlays(opener, 'whoops', null, 20);
    expect(asAna.tallies[a]).toEqual({ fire: 1, tea: 1 });
    expect(asAna.mine.map((m) => [m.act, m.kind])).toEqual([[a, 'fire']]);
    expect(asAna.spun.map((t) => t.originActId)).toEqual([a]);
    expect(asAna.cast.map((c) => c.id)).toEqual([boFace]);
    fake.signInAs(cy);
    const asCy = await fake.kindPlays(opener, 'whoops', null, 20);
    expect(cards(asCy.plays)).toEqual(cards(asAna.plays));
    expect(asCy.mine.map((m) => [m.act, m.kind])).toEqual([[a, 'tea']]);
  });

  test('backs page with card null, as ended rows, their springs beside them', async () => {
    const { fake, boFace, opener } = world();
    const sprung: string[] = [];
    for (let i = 0; i < 5; i++) {
      fake.clock.advance(MINUTE);
      const set = fake.seed.set(boFace, opener, 'snare');
      fake.clock.advance(MINUTE);
      fake.seed.spring(set);
      sprung.push(set);
    }
    const page = await fake.kindPlays(opener, null, null, 3);
    expect(page.plays.filter((a) => a.kind === 'set').map((a) => a.id)).toEqual([sprung[4]!, sprung[3]!, sprung[2]!]);
    expect(page.plays.filter((a) => a.kind === 'spring')).toHaveLength(3);
    expect(page.next).not.toBeNull();
    const rest = await fake.kindPlays(opener, null, page.next, 3);
    expect(rest.plays.filter((a) => a.kind === 'set').map((a) => a.id)).toEqual([sprung[1]!, sprung[0]!]);
    expect(rest.next).toBeNull();
  });
});

describe('a thread page and its origin read their plays and counts as postPlays does', () => {
  test('the page\'s plays and counts for its posts equal postPlays\'s, and the origin\'s plays and counts too, with no more flag', async () => {
    const { fake, ana, anaFace, boFace, thread, opener } = world();
    const second = must(await fake.post(thread, anaFace, 'second', null));
    for (let i = 0; i < 12; i++) { fake.clock.advance(MINUTE); fake.seed.card(boFace, opener, 'whoops', i < 10 ? { ends: new Date(fake.clock.now() + 1).toISOString() } : {}); }
    fake.seed.card(boFace, second.id, 'blot');
    fake.signInAs(ana);
    const page = (await fake.threadPage(thread, { page: 1 }, 10, []))!;
    const read = await fake.postPlays([opener, second.id]);
    expect(page.plays).toEqual(read.plays);
    expect(page.counts).toEqual(read.counts);
    const spun = must(await fake.spin(opener, anaFace, 'About it', 'b')).thread.id;
    const first = (await fake.threadPage(spun, { page: 1 }, 10, []))!;
    const origin = await fake.postPlays([opener]);
    expect(first.origin!.plays).toEqual(origin.plays);
    expect(first.origin!.counts).toEqual(origin.counts);
    expect(first.origin).not.toHaveProperty('more');
  });
});

describe('a rewind: a card that shows a post as it was and freezes it (0413_rewind.sql)', () => {
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const base = { playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
  const blot = { ...base, key: 'blot', name: 'Blot', alignment: 'salty' as const, rarity: 'common' as const, canApply: () => ok(undefined) };
  const big = { ...base, key: 'big', name: 'Big', alignment: 'salty' as const, rarity: 'legendary' as const, canApply: () => ok(undefined) };
  const tonic = { ...base, key: 'tonic', name: 'Tonic', alignment: 'sweet' as const, rarity: 'common' as const, play: 'use' as const, lasts: { unit: 'day' as const, count: 1 }, canApply: () => ok(undefined) };
  const snare = { ...base, key: 'snare', name: 'Snare', alignment: 'salty' as const, rarity: 'legendary' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'big', canApply: () => ok(undefined) };
  const timeTrap = { ...snare, key: 'timetrap', name: 'Time Trap', catches: () => 'clock' };
  const lure = { ...base, key: 'lure', name: 'Lure', alignment: 'salty' as const, rarity: 'rare' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const } }, catches: () => 'blot', canApply: () => ok(undefined) };
  const lesser = { ...base, key: 'lesser', name: 'Lesser', alignment: 'sweet' as const, rarity: 'rare' as const, reaches: ['post' as const], lasts: { unit: 'day' as const, count: 2 }, rewind: { upTo: 'common' as const }, drawsEffect: {}, canApply: () => ok(undefined) };
  const lkback = { ...base, key: 'lkback', name: 'Lk Back', alignment: 'sweet' as const, rarity: 'rare' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const], upTo: 'rare' as const }, outcome: { kind: 'lockout' as const, hours: 24 } }, canApply: () => ok(undefined) };
  const clock = { ...base, key: 'clock', name: 'Clock', alignment: 'sweet' as const, rarity: 'rare' as const, reaches: ['post' as const], lasts: { unit: 'day' as const, count: 1 }, rewind: { upTo: 'rare' as const }, drawsEffect: {}, canApply: () => ok(undefined) };
  const world: Instance = { ...instance, cards: [blot, big, tonic, snare, timeTrap, lure, clock, lesser, lkback], machine: [] };
  const frozen = (ends: string) => `this post's Clock turns away cards up to rare until ${refusalTime(ends)}`;
  const PICK = 'pick a point from this post\'s History';
  /** Ana's post, edited past the grace so its first version is a point; Bo plays the cards. */
  async function setup() {
    const fake = createFake({ instance: world });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const boss = fake.seed.account('boss', { admin: true });
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'The first words.');
    fake.seed.cards(ana, { snare: 2, timetrap: 1, lure: 1, lkback: 1, tonic: 2 });
    fake.seed.cards(bo, { blot: 3, big: 2, clock: 3, lesser: 2 });
    const posted = Date.parse((await fake.act(opener))!.createdAt);
    fake.clock.advance(3 * MINUTE);
    fake.signInAs(ana);
    must(await fake.edit(opener, anaFace, 'The second words.'));
    fake.signInAs(bo);
    return { fake, ana, bo, boss, anaFace, boFace, thread, opener, posted };
  }
  type Setup = Awaited<ReturnType<typeof setup>>;
  const played = async (s: Setup) => {
    const rw = must(await s.fake.playCard('clock', s.boFace, s.opener, { to: s.opener }, ''));
    return rw;
  };

  test('a rewind with no point, a point that is no version of the post or a version in the grace, or one that shows the same, is refused in the point\'s words', async () => {
    const s = await setup();
    const { fake, boFace, anaFace, opener, thread } = s;
    expect(await fake.playCard('clock', boFace, opener, {}, '')).toEqual(refused(PICK, 'config'));
    expect(await fake.playCard('clock', boFace, opener, { to: 7 }, '')).toEqual(refused(PICK, 'config'));
    const other = fake.seed.post(thread, anaFace, 'Another post.');
    expect(await fake.playCard('clock', boFace, opener, { to: other }, '')).toEqual(refused(PICK, 'config'));
    expect(await fake.playCard('clock', boFace, opener, { to: 'not an id' }, '')).toEqual(refused(PICK, 'config'));
    expect(await fake.playCard('clock', boFace, other, { to: other }, '')).toEqual(refused('this post shows the same at that point as it does now', 'config'));
    /* An edit saved inside the grace is part of the post as first posted. */
    const inside = fake.seed.post(thread, anaFace, 'Fresh.');
    fake.signInAs(s.ana);
    must(await fake.edit(inside, anaFace, 'Fresh, fixed.'));
    fake.signInAs(s.bo);
    expect(await fake.playCard('clock', boFace, inside, { to: inside }, '')).toEqual(refused('this post shows the same at that point as it does now', 'config'));
    expect((await fake.myCards()).find((c) => c.card === 'clock')?.held).toBe(3);
  });

  test('it lands with rewind_at, the time its version names, and draws an effect on the post', async () => {
    const s = await setup();
    const rw = await played(s);
    expect(rw.payload.card).toBe('clock');
    expect(rw.payload.rewind_at).toBe(new Date(s.posted + 2 * MINUTE).toISOString());
    expect(typeof rw.payload.ends).toBe('string');
    expect((await s.fake.postPlays([s.opener])).plays.map((a) => a.id)).toContain(rw.id);
  });

  test('a second rewind is refused with the freeze\'s words, and so is a common Move, a Use and a Set, while it is up', async () => {
    const s = await setup();
    const rw = await played(s);
    const words = frozen(String(rw.payload.ends));
    expect(await s.fake.playCard('clock', s.boFace, s.opener, { to: s.opener }, '')).toEqual(refused(words, 'config'));
    expect(await s.fake.playCard('blot', s.boFace, s.opener, {}, '')).toEqual(refused(words, 'config'));
    s.fake.signInAs(s.ana);
    expect(await s.fake.useCard('tonic', s.anaFace, s.opener, {}, '')).toEqual(refused(words, 'config'));
    expect(await s.fake.setCard('lure', s.anaFace, s.opener, {})).toEqual(refused(words, 'config'));
    expect((await s.fake.myCards()).find((c) => c.card === 'tonic')?.held).toBe(2);
  });

  test('a rewind is never set face down, with or without a rewind on the post', async () => {
    const s = await setup();
    s.fake.seed.cards(s.ana, { clock: 1 });
    s.fake.signInAs(s.ana);
    expect(await s.fake.setCard('clock', s.anaFace, s.opener, {})).toEqual(refused('Clock is played face up and never set face down', 'config'));
  });

  test('a legendary Move lands under a rare rewind and springs no back; the back stays set, the rewind\'s own play met none, and it springs once the rewind ends', async () => {
    const s = await setup();
    s.fake.signInAs(s.ana);
    const set = must(await s.fake.setCard('snare', s.anaFace, s.opener, {}));
    s.fake.signInAs(s.bo);
    const rw = await played(s);
    expect(rw.payload.caught).toBeUndefined();

    const lands = must(await s.fake.playCard('big', s.boFace, s.opener, {}, ''));
    expect(lands.payload.caught).toBeUndefined();
    expect((await s.fake.postPlays([s.opener])).plays.filter((a) => a.kind === 'spring')).toEqual([]);
    expect((await s.fake.myFaceDown([set.id]))).toEqual({});
    s.fake.signInAs(s.ana);
    expect(await s.fake.myFaceDown([set.id])).toEqual({ [set.id]: 'snare' });
    s.fake.clock.advance(DAY + MINUTE);
    s.fake.signInAs(s.bo);
    const later = must(await s.fake.playCard('big', s.boFace, s.opener, {}, ''));
    expect(later.payload.caught).toBe(set.id);
  });

  test('a back that names the rewind card does not catch the rewind\'s own play, and stays set', async () => {
    const s = await setup();
    s.fake.signInAs(s.ana);
    const set = must(await s.fake.setCard('timetrap', s.anaFace, s.opener, {}));
    s.fake.signInAs(s.bo);
    const rw = await played(s);
    expect(rw.payload.caught).toBeUndefined();
    expect((await s.fake.postPlays([s.opener])).plays.filter((a) => a.kind === 'spring')).toEqual([]);
    s.fake.signInAs(s.ana);
    expect(await s.fake.myFaceDown([set.id])).toEqual({ [set.id]: 'timetrap' });
  });

  test('after an admin ends the rewind a common Move lands', async () => {
    const s = await setup();
    const rw = await played(s);
    expect((await s.fake.playCard('blot', s.boFace, s.opener, {}, '')).ok).toBe(false);
    s.fake.signInAs(s.boss);
    must(await s.fake.reverseCard(rw.id));
    s.fake.signInAs(s.bo);
    expect((await s.fake.playCard('blot', s.boFace, s.opener, {}, '')).ok).toBe(true);
  });

  test('after its time ends a common Move lands', async () => {
    const s = await setup();
    await played(s);
    s.fake.clock.advance(DAY + MINUTE);
    expect((await s.fake.playCard('blot', s.boFace, s.opener, {}, '')).ok).toBe(true);
  });

  test('an edit during the rewind lands, and rewindView still gives the version at the point', async () => {
    const s = await setup();
    const rw = await played(s);
    s.fake.clock.advance(MINUTE);
    s.fake.signInAs(s.ana);
    must(await s.fake.edit(s.opener, s.anaFace, 'The third words.'));
    expect((await s.fake.act(s.opener))?.currentPayload).toEqual({ body: 'The third words.' });
    const view = await s.fake.rewindView(rw.id);
    expect(view).toMatchObject({ play: rw.id, post: s.opener, at: rw.payload.rewind_at, version: { id: s.opener, currentPayload: { body: 'The first words.' }, editedAt: null, shownEditedAt: null } });
    expect(await s.fake.rewindView(s.opener)).toBeNull();
    expect(await s.fake.rewindView('00000000-0000-4000-8000-00000000ffff')).toBeNull();
  });

  test('a rewind to an edit gives that edit\'s words, as the moment gives them', async () => {
    const s = await setup();
    s.fake.clock.advance(3 * MINUTE);
    s.fake.signInAs(s.ana);
    must(await s.fake.edit(s.opener, s.anaFace, 'The third words.'));
    s.fake.clock.advance(MINUTE);
    must(await s.fake.edit(s.opener, s.anaFace, 'The fourth words.'));
    s.fake.signInAs(s.bo);
    const third = (await s.fake.history(s.opener)).find((v) => (v.payload as { body?: string }).body === 'The third words.')!;
    const rw = must(await s.fake.playCard('clock', s.boFace, s.opener, { to: third.id }, ''));
    expect(rw.payload.rewind_at).toBe(new Date(Date.parse(third.createdAt)).toISOString());
    expect((await s.fake.rewindView(rw.id))?.version.currentPayload).toEqual({ body: 'The third words.' });
  });

  test('the thread page carries rewinds, with the post\'s old words, and none once the rewind has ended', async () => {
    const s = await setup();
    const rw = await played(s);
    const page = (await s.fake.threadPage(s.thread, { page: 1 }, 10, []))!;
    expect(page.rewinds).toEqual([await s.fake.rewindView(rw.id)]);
    expect(page.rewinds[0]!.version.currentPayload).toEqual({ body: 'The first words.' });
    s.fake.signInAs(s.boss);
    must(await s.fake.reverseCard(rw.id));
    expect((await s.fake.threadPage(s.thread, { page: 1 }, 10, []))!.rewinds).toEqual([]);
  });

  test('a spun thread\'s page carries the rewind of its ORIGIN post', async () => {
    const s = await setup();
    const rw = await played(s);
    s.fake.signInAs(s.ana);
    const spun = must(await s.fake.spin(s.opener, s.anaFace, 'About it', 'b')).thread.id;
    expect((await s.fake.threadPage(spun, { page: 1 }, 10, []))!.rewinds.map((r) => r.play)).toEqual([rw.id]);
  });

  test('two live rewinds on a post (a rarer over a lesser): the page lists the latest played first, and a refusal names the latest played', async () => {
    const s = await setup();
    const first = must(await s.fake.playCard('lesser', s.boFace, s.opener, { to: s.opener }, ''));
    s.fake.clock.advance(MINUTE);
    const second = must(await s.fake.playCard('clock', s.boFace, s.opener, { to: s.opener }, ''));
    const page = (await s.fake.threadPage(s.thread, { page: 1 }, 10, []))!;
    expect(page.rewinds.map((r) => r.play)).toEqual([second.id, first.id]);
    expect(await s.fake.playCard('blot', s.boFace, s.opener, {}, '')).toEqual(refused(frozen(String(second.payload.ends)), 'config'));
    /* The rarer one ended by an admin, the lesser alone is named. */
    s.fake.signInAs(s.boss);
    must(await s.fake.reverseCard(second.id));
    s.fake.signInAs(s.bo);
    expect(await s.fake.playCard('blot', s.boFace, s.opener, {}, '')).toEqual(refused(`this post's Lesser turns away cards up to common until ${refusalTime(String(first.payload.ends))}`, 'config'));
  });

  test('a back sprung into a live lockout after the point shows, so it makes the point offered (play_post: sprung and in force)', async () => {
    const s = await setup();
    const { fake, ana, bo, boss, anaFace, boFace, thread } = s;
    const boHeel = fake.seed.character(bo, 'Bo Heel', 'heel');
    fake.signInAs(ana);
    const plain = must(await fake.post(thread, anaFace, 'Plain.', null)).id;
    fake.clock.advance(3 * MINUTE);
    fake.signInAs(bo);
    expect(await fake.playCard('clock', boFace, plain, { to: plain }, '')).toEqual(refused('this post shows the same at that point as it does now', 'config'));
    fake.signInAs(ana);
    const back = must(await fake.setCard('lkback', anaFace, plain, {}));
    fake.signInAs(bo);
    const move = must(await fake.playCard('blot', boFace, plain, {}, ''));
    fake.signInAs(boss);
    must(await fake.reverseCard(move.id));
    fake.signInAs(bo);
    expect(back.id).toBeDefined();
    must(await fake.playCard('clock', boHeel, plain, { to: plain }, ''));
  });
});


/* A report, its verdict, an appeal and its ruling are origins with a place, and an exchange reads them (spin-mod-answers plan, Tasks 1 and 2; 0422). */
describe('an ask or an answer as an origin', () => {
  async function desk() {
    const w = world();
    const board = await boardId(w.fake, 'general');
    const mod = w.fake.seed.staff('s-mod', 'Mod Staff', 'mod');
    const on = { kind: 'post' as const, thread: w.thread, title: 'Hello', seq: 1 };
    const asker = { id: w.anaFace, name: 'Ana Face' };
    const staff = { id: mod, name: 'Mod Staff' };
    /** The place of a thread spun from `act`, by Ana's own mask. */
    const placeOf = async (act: string) => must(await w.fake.spin(act, w.anaFace, 'About it', 'b')).thread.origin;
    return { ...w, mod, on, asker, staff, placeOf, board };
  }

  test('a dismissed report: from its ask and from its answer, the asker, the staff and the reported post', async () => {
    const d = await desk();
    const report = d.fake.seed.report(d.anaFace, d.opener, 'rude');
    const open = { kind: 'answer', spun: 'ask', ask: 'report', asker: d.asker, staff: null, punishment: null, group: null, on: d.on, board: d.board };
    expect(await d.placeOf(report)).toEqual(open);
    const verdict = d.fake.seed.verdict(report, d.mod, 'dismissed');
    expect(await d.placeOf(report)).toEqual({ ...open, staff: d.staff });
    expect(await d.placeOf(verdict)).toEqual({ ...open, spun: 'answer', staff: d.staff });
  });

  test('a report heard as a visit and one that backfired read the same as a dismissed one', async () => {
    const d = await desk();
    const report = d.fake.seed.report(d.anaFace, d.opener, 'rude');
    const visit = d.fake.seed.visit(d.mod, d.opener, {});
    const verdict = d.fake.seed.verdict(report, d.mod, 'visit', { visit });
    expect(await d.placeOf(verdict)).toMatchObject({ kind: 'answer', spun: 'answer', ask: 'report', staff: d.staff, on: d.on });
    const second = d.fake.seed.report(d.anaFace, d.opener, 'again');
    const backfire = d.fake.seed.verdict(second, d.mod, 'backfire');
    expect(await d.placeOf(backfire)).toMatchObject({ spun: 'answer', ask: 'report', asker: d.asker, punishment: null, group: null, on: d.on });
  });

  test('an appeal of an infraction names the infraction\'s post, from its ask and from its ruling', async () => {
    const d = await desk();
    const inf = d.fake.seed.infraction(d.fake.seed.visit(d.mod, d.opener, {}));
    const appeal = d.fake.seed.appeal(d.boFace, inf, 'please');
    const asker = { id: d.boFace, name: 'Bo Face' };
    const want = { kind: 'answer', spun: 'ask', ask: 'appeal', asker, staff: null, punishment: 'infraction', group: null, on: d.on, board: d.board };
    expect(await d.placeOf(appeal)).toEqual(want);
    const ruling = d.fake.seed.ruling(appeal, d.mod, 'reduced');
    expect(await d.placeOf(ruling)).toEqual({ ...want, spun: 'answer', staff: d.staff });
    expect(await d.placeOf(appeal)).toEqual({ ...want, staff: d.staff });
  });

  test('an appeal of a ban names the post of the infraction the ban followed', async () => {
    const d = await desk();
    const inf = d.fake.seed.infraction(d.fake.seed.visit(d.mod, d.opener, {}));
    const ban = d.fake.seed.ban(d.boFace, d.fake.clock.now() + DAY, { infraction: inf });
    const appeal = d.fake.seed.appeal(d.boFace, ban, 'please');
    expect(await d.placeOf(appeal)).toEqual({ kind: 'answer', spun: 'ask', ask: 'appeal', asker: { id: d.boFace, name: 'Bo Face' }, staff: null, punishment: 'ban', group: null, on: d.on, board: d.board });
  });

  test('an appeal of a move names its group and the move\'s own line, from its ask and from its ruling', async () => {
    const d = await desk();
    const move = d.fake.seed.groupMove('s-mod', { character: d.boFace, group: 'trialMembers' });
    const appeal = d.fake.seed.appeal(d.boFace, move, 'please');
    const line = (await d.fake.act(move))!;
    expect(line.seq).not.toBeNull();
    const on = { kind: 'post', thread: line.thread, title: (await d.fake.thread(line.thread))!.title, seq: line.seq };
    const want = { kind: 'answer', spun: 'ask', ask: 'appeal', asker: { id: d.boFace, name: 'Bo Face' }, staff: null, punishment: 'move', group: 'trialMembers', on, board: await boardId(d.fake, 'announcements') };
    expect(await d.placeOf(appeal)).toEqual(want);
    const ruling = d.fake.seed.ruling(appeal, d.mod, 'upheld');
    expect(await d.placeOf(ruling)).toEqual({ ...want, spun: 'answer', staff: d.staff });
  });

  test('a ruling on a ban names the ban\'s infraction post', async () => {
    const d = await desk();
    const inf = d.fake.seed.infraction(d.fake.seed.visit(d.mod, d.opener, {}));
    const ban = d.fake.seed.ban(d.boFace, d.fake.clock.now() + DAY, { infraction: inf });
    const ruling = d.fake.seed.ruling(d.fake.seed.appeal(d.boFace, ban, 'please'), d.mod, 'reduced');
    expect(await d.placeOf(ruling)).toEqual({ kind: 'answer', spun: 'answer', ask: 'appeal', asker: { id: d.boFace, name: 'Bo Face' }, staff: d.staff, punishment: 'ban', group: null, on: d.on, board: d.board });
  });

  test('a report of an Act with no place number has no post in its place', async () => {
    const d = await desk();
    const inf = d.fake.seed.infraction(d.fake.seed.visit(d.mod, d.opener, {}));
    expect((await d.fake.act(inf))!.seq).toBeNull();
    const report = d.fake.seed.report(d.anaFace, inf, 'odd');
    expect(await d.placeOf(report)).toMatchObject({ kind: 'answer', spun: 'ask', ask: 'report', on: null });
  });

  test('an asker that has not debuted has no answer place, and an answerer that has not debuted and is no staff is null', async () => {
    const d = await desk();
    const ghost = d.fake.seed.character(d.ana, 'Ghost', 'face', { debuted: false });
    const report = d.fake.seed.report(ghost, d.opener, 'rude');
    /* Spun by a character of the player's that may: the origin falls through to its own seq (none), as SQL does. */
    expect(await d.placeOf(report)).toBeNull();
    const heard = d.fake.seed.report(d.anaFace, d.opener, 'rude');
    const lurker = d.fake.seed.character(d.bo, 'Lurker', 'face', { debuted: false });
    const verdict = d.fake.seed.verdict(heard, lurker, 'dismissed');
    expect(await d.placeOf(verdict)).toMatchObject({ kind: 'answer', spun: 'answer', asker: d.asker, staff: null });
    expect(await d.placeOf(heard)).toMatchObject({ spun: 'ask', staff: null });
  });

  test('a post as an origin keeps its own place', async () => {
    const d = await desk();
    expect(await d.placeOf(d.opener)).toEqual({ kind: 'post', thread: d.thread, title: 'Hello', seq: 1, board: d.board });
  });

  test('filing a report or an appeal answers with the answer\'s Act, and the log rows carry it', async () => {
    const d = await desk();
    d.fake.seed.wallet(d.ana, 500);
    const filed = must(await d.fake.fileReport(d.anaFace, d.opener, 'rude'));
    expect(filed.answer).toEqual(expect.any(String));
    const verdictAct = await d.fake.act(filed.answer!);
    expect([verdictAct?.kind, verdictAct?.targetActId]).toEqual(['report_verdict', filed.report]);
    expect((await d.fake.log()).reports[0]).toMatchObject({ report: filed.report, answer: filed.answer });
    const inf = d.fake.seed.infraction(d.fake.seed.visit(d.mod, d.opener, {}));
    d.fake.signInAs(d.bo);
    d.fake.seed.wallet(d.bo, 500);
    const appealed = must(await d.fake.fileAppeal(d.boFace, inf, 'please'));
    expect(appealed.answer).toEqual(expect.any(String));
    expect((await d.fake.act(appealed.answer!))?.kind).toBe('appeal_ruling');
    expect((await d.fake.log()).appeals[0]).toMatchObject({ appeal: appealed.appeal, answer: appealed.answer });
  });

  test('an unanswered report\'s log row has no answer', async () => {
    const d = await desk();
    d.fake.seed.report(d.anaFace, d.opener, 'rude');
    expect((await d.fake.log()).reports[0]?.answer).toBeNull();
  });

  test('an exchange reads from an ask, from an answer and from an unanswered ask, and refuses a post', async () => {
    const d = await desk();
    const report = d.fake.seed.report(d.anaFace, d.opener, 'rude');
    const unanswered = d.fake.seed.report(d.anaFace, d.opener, 'again');
    const verdict = d.fake.seed.verdict(report, d.mod, 'dismissed');
    for (const origin of [report, verdict]) {
      const x = await d.fake.exchange(origin);
      expect([x.ask.id, x.answer?.id, x.punishment], origin).toEqual([report, verdict, null]);
    }
    expect(await d.fake.exchange(unanswered)).toMatchObject({ ask: { id: unanswered }, answer: null, punishment: null });
    const inf = d.fake.seed.infraction(d.fake.seed.visit(d.mod, d.opener, {}));
    const appeal = d.fake.seed.appeal(d.boFace, inf, 'please');
    const ruling = d.fake.seed.ruling(appeal, d.mod, 'upheld');
    for (const origin of [appeal, ruling]) {
      const x = await d.fake.exchange(origin);
      expect([x.ask.id, x.answer?.id, x.punishment?.id], origin).toEqual([appeal, ruling, inf]);
    }
    await expect(d.fake.exchange(d.opener)).rejects.toThrow();
    await expect(d.fake.exchange('nothing')).rejects.toThrow();
  });
});
