/**
 * The in-memory backend holds what the server holds, in the server's words: every refusal below is
 * the sentence supabase/migrations and engine/rules/actions.ts raise, so a screen tested against
 * the fake meets the refusals it will meet live. A `.test.tsx` file though it holds no JSX, because
 * `test:engine` runs `engine/**\/*.test.ts` under plain node and this runs under jsdom with the screens'.
 */
import { describe, expect, test } from 'vitest';
import type { Instance, Settings } from '../../rules/types.ts';
import { landsOn, type CardEffect, type CardTarget } from '../../rules/cards.ts';
import type { Act, Refusal, Tally } from './api.ts';
import { TIP_KEYS } from '../tips/keys.ts';
import { createFake, FAKE_BACKEND_MARKER, TEST_CODE } from './fake.ts';
import { LOG_ROWS, micros } from './log-page.ts';
import { systemSettings, testSystem } from '../../rules/test-system.ts';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } },
  hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
  postMaxLength: 50, titleMaxLength: 20, postsPerPage: 2, hotReplies: 10, cardSettings: {}, economy: {}, ...systemSettings,
};

const earn = () => [];
const instance: Instance = {
  key: 'test', name: 'Test',
  copy: { turnsThreadTitle: 'Turns {season}', revealTitle: 'Reveal {season}', revealBody: 'All.' },
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
    { slug: 'the-system', name: 'The System', description: 'Its words.', system: true },
  ],
  ranks: [{ name: 'Jobber', from: 0 }],
  pipStyles: [{ key: 'default', name: 'Default', full: 'f.svg', empty: 'e.svg' }],
};

const DAY = 86_400_000;
const MINUTE = 60_000;
const refused = (error: string, field?: string): Refusal => (field === undefined ? { ok: false, error } : { ok: false, error, field });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
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
    const { thread } = fake.seed.thread('the-system', null, 'Tally', 'Settled.');
    const words = 'only The System posts here; spin a thread from what it said';
    expect(await fake.post(thread, anaFace, 'hello', null)).toEqual(refused(words));
    expect(await fake.startThread('the-system', anaFace, 'Mine', 'hello')).toEqual(refused(words));
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
    const said = fake.seed.thread('the-system', null, 'Tally', 'Settled.');
    fake.seed.post(said.thread, null, 'seeded long ago', { at: opened - 10 * DAY });
    const system = (await fake.boards()).find((b) => b.slug === 'the-system')!;
    const listed = (await fake.threads(system.id, { offset: 0, limit: 10 })).threads.find((t) => t.id === said.thread)!;
    expect(listed.lastSeq).toBe(2);
    expect(Date.parse(listed.lastAt)).toBe(opened);
  });
  test('a spin from The System\'s board opens on the players\' board', async () => {
    const { fake, anaFace } = world();
    const said = fake.seed.thread('the-system', null, 'Tally', 'Settled.');
    const spun = must(await fake.spin(said.act, anaFace, 'About that', ''));
    expect(spun.thread.board).toBe(await boardId(fake, 'general'));
    expect(spun.thread.originActId).toBe(said.act);
    expect(spun.act.kind).toBe('spin');
    expect(spun.act.seq).toBe(1);
    expect((await fake.spunFrom(said.act)).map((t) => t.id)).toEqual([spun.thread.id]);
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
    const said = fake.seed.thread('the-system', null, 'Tally', 'Settled.');
    expect(await fake.react(said.act, anaFace, 'fire')).toMatchObject({ ok: true });
  });
  test('tallies are counts of kinds, and converge whatever order the live events come in', async () => {
    const { fake, anaFace, boFace, ana, bo } = world();
    const { thread, act: opener } = fake.seed.thread('the-system', null, 'Tally', 'Settled.');
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
    const said = fake.seed.thread('the-system', null, 'Turns', '').thread;
    const tally = fake.seed.announceTurn(anaFace, said, { was: 'face', since: '2026-09-01T00:00:00.000Z' });
    expect(await fake.turnsAnnounced([anaFace])).toEqual([
      { act: tally, character: anaFace, at: (await fake.act(tally))!.createdAt, was: 'face' },
    ]);
  });
  test('an unmask is refused on The System\'s board, and past 200 characters', async () => {
    const { fake, anaFace, thread } = world();
    const sys = fake.seed.thread('the-system', null, 'Tally', '').thread;
    expect(await fake.unmask(anaFace, sys, '')).toEqual(refused('only The System posts here; spin a thread from what it said'));
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
    expect(boFace).toBeDefined();
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
    const known = await fake.requestCode(fake.emailOf(ana), null);
    const unknown = await fake.requestCode('nobody@example.test', null);
    expect(known).toEqual(unknown);
    expect(known).toMatchObject({ ok: true, value: { message: expect.stringContaining('If this address can sign in here') } });
    expect(await fake.requestCode('not an address', null)).toEqual(refused('is not an email address', 'email'));
  });
  test('an invite that opens nothing is said so for every address alike', async () => {
    const { fake, ana } = world();
    fake.signInAs(null);
    const known = await fake.requestCode(fake.emailOf(ana), 'wrong');
    const unknown = await fake.requestCode('nobody@example.test', 'wrong');
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
    expect(await fake.session()).toEqual({ signedIn: false, account: null });
    expect(await fake.verifyCode(fake.emailOf(ana), ` ${TEST_CODE} `)).toEqual({ ok: true, value: { account: true } });
    expect(await fake.session()).toEqual({ signedIn: true, account: ana });
    await fake.signOut();
    await flush();
    expect(seen).toEqual([true, false]);
  });
  test('an address with no account and no invite signs in with no account, and says why', async () => {
    const { fake } = world();
    fake.signInAs(null);
    await fake.requestCode('new@example.test', null);
    const answer = await fake.verifyCode('new@example.test', TEST_CODE);
    expect(answer).toEqual({ ok: true, value: { account: false, why: 'that invite opens nothing; open the account with another invite' } });
    expect(await fake.session()).toEqual({ signedIn: true, account: null });
    expect(await fake.myCharacters()).toEqual([]);
  });
  test('an invite from a player opens an account, once', async () => {
    const { fake } = world();
    const { code } = must(await fake.createInvite());
    fake.signInAs(null);
    await fake.requestCode('new@example.test', code);
    expect(await fake.verifyCode('new@example.test', TEST_CODE)).toEqual({ ok: true, value: { account: true } });
    fake.signInAs(null);
    await fake.requestCode('other@example.test', code);
    expect(await fake.verifyCode('other@example.test', TEST_CODE)).toMatchObject({ ok: true, value: { account: false } });
    expect(await fake.openAccount(code)).toEqual(refused('that invite opens nothing'));
  });
  test('closed registration says so', async () => {
    const fake = createFake({ instance, settings: { registrationMode: 'closed' } });
    expect(must(await fake.requestCode('new@example.test', 'x')).invite).toBe('registration is closed, so no new login is made');
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
    const glass = { smoke: 'full', contrast: 'standard', textSize: 100, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } as const;
    expect(await fake.preferences()).toEqual({ theme: 'system', postbit: 'side', motion: 'system', ...glass });
    expect(await fake.setPreferences({ motion: 'reduce' })).toEqual({ ok: true, value: { theme: 'system', postbit: 'side', motion: 'reduce', ...glass } });
    expect(await fake.setPreferences({ theme: 'Loud!' })).toEqual(refused('a theme is named in lowercase words joined by hyphens'));
  });
  test('the glass\'s three preferences are set and kept as the server keeps them, and refused in its words', async () => {
    const { fake } = world();
    expect(await fake.setPreferences({ smoke: 'off' })).toEqual({ ok: true, value: { theme: 'system', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'standard', textSize: 100, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } });
    expect(await fake.setPreferences({ contrast: 'high', textSize: 200 })).toEqual({ ok: true, value: { theme: 'system', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'high', textSize: 200, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } });
    /* A fresh read is what the next load sees. */
    expect(await fake.preferences()).toMatchObject({ smoke: 'off', contrast: 'high', textSize: 200 });
    expect(await fake.setPreferences({ smoke: 'thick' as never })).toEqual(refused('the smoke is full, low or off'));
    expect(await fake.setPreferences({ contrast: 'max' as never })).toEqual(refused('contrast is standard or high'));
    expect(await fake.setPreferences({ textSize: 175 as never })).toEqual(refused('text size is 100, 125, 150 or 200 percent'));
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

  test('a spun thread names its origin in the row: the thread, its title and the Act\'s seq', async () => {
    const { fake, anaFace, thread } = world();
    const second = must(await fake.post(thread, anaFace, 'second', null));
    const spun = must(await fake.spin(second.id, anaFace, 'Spun out', 'body'));
    const row = await fake.thread(spun.thread.id);
    expect([row?.originThread, row?.originTitle, row?.originSeq]).toEqual([thread, 'Hello', 2]);
    expect((await fake.spunFrom(second.id)).map((t) => [t.originThread, t.originSeq])).toEqual([[thread, 2]]);
    const plain = await fake.thread(thread);
    expect([plain?.originThread, plain?.originTitle, plain?.originSeq]).toEqual([null, null, null]);
  });

  test('spunFromMany reads the threads spun from any of several Acts at once, and cardsOn the card plays on one', async () => {
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
    const on = await fake.cardsOn(second.id, 50);
    expect(on.map((c) => [c.kind, c.targetActId, c.payload])).toEqual([['card', second.id, { card: 'whoops', message: 'oops' }]]);
    expect(await fake.cardsOn(a.act.id, 50)).toEqual([]);
    /* Each read stops at its limit, oldest first. */
    expect((await fake.spunFromMany([opener, second.id], 1)).map((t) => t.id)).toEqual([a.thread.id]);
    expect(await fake.spunFrom(opener, 0)).toEqual([]);
    fake.seed.card(boFace, second.id, 'whoops', { message: 'again' });
    expect(await fake.cardsOn(second.id, 1)).toHaveLength(1);
    /* A card's own settings ride in the payload as the server keeps them (Stick Around's sentence). */
    fake.seed.card(boFace, opener, 'stick-around', { message: 'read it', config: { sentence: 'I read it.' } });
    expect((await fake.cardsOn(opener, 50)).map((c) => c.payload).filter((p) => p.card === 'stick-around')).toEqual([{ card: 'stick-around', message: 'read it', config: { sentence: 'I read it.' } }]);
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
    expect((await fake.cardsOn(second.id, 5)).map((c) => c.seq)).toEqual([null]);
  });

  test('a card seeded with a layer and the server\'s config carries them in its payload, as a seeded card\'s play does', async () => {
    const { fake, boFace, opener } = world();
    const play = fake.seed.card(boFace, opener, 'whoops', { message: 'inked', layer: 2, config: { color: '#ff2bd6', seed: 41 } });
    expect((await fake.act(play))?.payload).toEqual({ card: 'whoops', message: 'inked', layer: 2, config: { color: '#ff2bd6', seed: 41 } });
  });

  test('cardsOnMany reads the card plays on any of several posts in one read, oldest first, at most the limit', async () => {
    const { fake, anaFace, boFace, thread, opener } = world();
    const second = must(await fake.post(thread, anaFace, 'second', null));
    const third = must(await fake.post(thread, anaFace, 'third', null));
    const a = fake.seed.card(boFace, second.id, 'whoops', { message: 'one' });
    const b = fake.seed.card(boFace, opener, 'whoops');
    fake.seed.card(boFace, third.id, 'whoops');
    const many = await fake.cardsOnMany([second.id, opener], 50);
    expect(many.map((c) => [c.id, c.targetActId])).toEqual([[a, second.id], [b, opener]]);
    expect(await fake.cardsOnMany([], 50)).toEqual([]);
    expect((await fake.cardsOnMany([second.id, opener, third.id], 2)).map((c) => c.id)).toEqual([a, b]);
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
    expect(await fake.playMoment(first)).toEqual({ version: await fake.act(mine.id), layers: [{ act: await fake.act(first), state: null }], above: [], recorded: true });
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

  test('a moment is a play on a post\'s alone, and a play the fake was given no snapshot for answers from its time, by itself', async () => {
    const { fake, anaFace, boFace, thread, opener } = world();
    const mine = must(await fake.post(thread, anaFace, 'old words', null));
    const onBo = fake.seed.reach(anaFace, 'character', boFace, 'glint', { post: opener });
    expect(await fake.playMoment(mine.id)).toBeNull();
    expect(await fake.playMoment(onBo)).toBeNull();
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
    key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'splat.price', stack: 2,
    playPrice: (_s: Settings, t: CardTarget) => (t.reach === 'post' && t.length > 20 ? 50 : 0),
    canApply: (t: CardTarget, on: readonly { card: string | null }[]) => (t.reach !== 'post' || t.kind !== 'post' ? refused2('a card lands on a post') : on.length >= 2 ? refused2('this post already carries 2 of that card, the most it takes') : { ok: true as const, value: undefined }),
    validateConfig: (c: unknown) => ([undefined, 'red'].includes((c as { color?: unknown } | undefined)?.color as string | undefined) ? { ok: true as const, value: c ?? {} } : refused2('the ink is red')),
  };
  const refused2 = (why: string) => ({ ok: false as const, why });
  const shop: Instance = { ...instance, cards: [splat], settings: { ...settings, economy: { 'splat.price': 100 } } };
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
    expect(must(await fake.buyCard('splat'))).toEqual({ card: 'splat', balance: 462, held: 2 });
    expect(await fake.wallet()).toEqual({ balance: 462, cap: 600 });
    expect(await fake.myCards()).toEqual([{ card: 'splat', held: 2 }]);
  });

  test('a wallet that holds less than the price is refused in the server\'s words, and nothing is spent or given', async () => {
    const { fake } = shopWorld(99);
    expect(await fake.buyCard('splat')).toEqual(refused('that costs 100, and your wallet holds 99'));
    expect((await fake.wallet()).balance).toBe(99);
    expect(await fake.myCards()).toEqual([]);
  });

  test('the ghost estimate is not the wallet: a purchase reads the settled balance only', async () => {
    const { fake, ana } = shopWorld(50);
    fake.seed.estimate(ana, { entries: [{ character: fake.seed.character(ana, 'Ghosty', 'face'), reason: 'face.cheered', amount: 500 }] });
    expect((await fake.buyCard('splat')).ok).toBe(false);
  });

  test('a card the machine does not sell, and signed out, are refused as the decision refuses them', async () => {
    const { fake } = shopWorld(500);
    expect((await fake.buyCard('nothing'))).toMatchObject({ ok: false, field: 'card' });
    fake.signInAs(null);
    expect(await fake.buyCard('splat')).toEqual(refused('sign in to act'));
  });

  test('a play needs a card in hand, in the server\'s words, and spends the card and the price of the post', async () => {
    const { fake, anaFace, opener } = shopWorld(500);
    expect(await fake.playCard('splat', anaFace, opener, {}, '')).toEqual(refused('you hold no "splat" card; the Vending Machine sells them'));
    must(await fake.buyCard('splat'));
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
    expect(await fake.playCard('splat', anaFace, long, {}, '')).toEqual(refused('that costs 50, and your wallet holds 49'));
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
    expect((await fake.standingPlace(boFace))?.place).toBe(all.length);
    expect(await fake.standingPlace(waiting)).toBeNull();
    expect(await fake.standingPlace('nobody')).toBeNull();
  });
});

describe('one board', () => {
  test('board is one board by its slug or its id, and null for neither', async () => {
    const { fake } = world();
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    const { threadCount: _c, lastAt: _a, lastCharacter: _l, lastThread: _t, ...row } = general;
    expect(await fake.board('general')).toEqual(row);
    expect(await fake.board(general.id)).toEqual(row);
    expect((await fake.board('the-system'))?.isSystem).toBe(true);
    expect(await fake.board('nowhere')).toBeNull();
  });
});

describe('a character\'s season reveal posts and the season\'s size', () => {
  test('characterReveals returns the reveal Acts that name the character, newest first, bounded', async () => {
    const { fake, anaFace, boFace } = world();
    const sys = fake.seed.thread('the-system', null, 'Reveal', '', { kind: 'reveal', payload: { season: 1, from: 'a', to: 'b', body: 'Over.', characters: 2 } });
    const one = fake.seed.post(sys.thread, null, '', { kind: 'reveal', at: Date.UTC(2026, 9, 1), payload: { season: 1, character: anaFace, name: 'Ana', place: 1, standing: 1, shown: [] } });
    fake.seed.post(sys.thread, null, '', { kind: 'reveal', at: Date.UTC(2026, 9, 2), payload: { season: 1, character: boFace, name: 'Bo', place: 2, standing: 0, shown: [] } });
    const two = fake.seed.post(sys.thread, null, '', { kind: 'reveal', at: Date.UTC(2026, 11, 1), payload: { season: 2, character: anaFace, name: 'Ana', place: 1, standing: 1, shown: [] } });
    expect((await fake.characterReveals(anaFace)).map((a) => a.id)).toEqual([two, one]);
    expect((await fake.characterReveals(anaFace, 1)).map((a) => a.id)).toEqual([two]);
    expect(await fake.characterReveals('nobody')).toEqual([]);
  });

  test('standingsCount is the number of debuted characters, as the standings list them', async () => {
    const { fake, ana } = world();
    const before = (await fake.standingsPage(0, 1000)).length;
    fake.seed.character(ana, 'Not Yet', 'face', { debuted: false });
    expect(await fake.standingsCount()).toBe(before);
  });
});

describe('a page of the standings', () => {
  test('standingsPage pages the ranking as standings_page does: ties share a place across a page boundary, nothing settled stands at 0, debts last, empty past the end', async () => {
    const { fake, bo, anaFace, anaHeel, boFace } = world();
    const boHeel = fake.seed.character(bo, 'Bo Heel', 'heel');
    const boLurk = fake.seed.character(bo, 'Bo Lurk', 'lurker');
    fake.seed.settle({ standings: { [anaFace]: 300, [anaHeel]: 300, [boFace]: 500, [boHeel]: -40 }, debut: false });
    const row = (s: { name: string; standing: number; place: number }) => [s.name, s.standing, s.place];
    expect((await fake.standingsPage(0, 2)).map(row)).toEqual([['Bo Face', 500, 1], ['Ana Face', 300, 2]]);
    expect((await fake.standingsPage(2, 2)).map(row)).toEqual([['Ana Heel', 300, 2], ['Bo Lurk', 0, 4]]);
    expect((await fake.standingsPage(4, 2)).map(row)).toEqual([['Bo Heel', -40, 5]]);
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
    key: 'splat', name: 'Splat', alignment: 'salty' as const, rarity: 'common' as const, priceKey: 'splat.price', stack: 2,
    playPrice: (_s: Settings, t: CardTarget) => (t.reach === 'post' && t.length > 20 ? 50 : 0),
    canApply: () => ({ ok: true as const, value: undefined }),
    validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
  };
  const shop: Instance = { ...instance, cards: [splat], settings: { ...settings, economy: { 'splat.price': 100 } } };
  const empty = { settlements: [], wallet: [], cards: [], playsOnMine: [], saves: [], setEnds: [], setPasses: [], caught: [], before: null };

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
    must(await fake.buyCard('splat'));
    fake.clock.advance(MINUTE);
    const long = must(await fake.playCard('splat', anaFace, mine, {}, 'Long one.'));
    fake.clock.advance(MINUTE);
    must(await fake.buyCard('splat'));
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
    must(await fake.buyCard('splat'));
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
    expect([boss?.staff, boss?.staffKind]).toEqual(['director', 'boss']);
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
    const system = (await fake.boards()).find((b) => b.slug === 'the-system')!;
    expect(ids(await fake.here({ kind: 'board', board: general.id }, null))).toEqual([anaFace]);
    expect(ids(await fake.here({ kind: 'board', board: system.id }, null))).toEqual([]);
    const online = await fake.here({ kind: 'index' }, null);
    expect(online).toEqual({ names: [{ id: anaFace, name: 'Ana Face' }], others: 0 });
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
  const base = { priceKey: 'x.price', playPrice: () => 0, validateConfig: (c: unknown) => ok(c ?? {}) };
  const cast = { ...base, key: 'blot', name: 'Blot', alignment: 'salty' as const, rarity: 'common' as const, canApply: () => ok(undefined) };
  const snare = { ...base, key: 'snare', name: 'Snare', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, outcome: { do: 'payout' as const } }, canApply: () => ok(undefined) };
  const shield = { ...base, key: 'shield', name: 'Shield', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, ward: true as const, lasts: { unit: 'day' as const, count: 7 }, canApply: () => ok(undefined) };
  const world: Instance = { ...instance, cards: [cast, snare, shield], settings: { ...settings, economy: { 'x.price': 100 } } };
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
    expect((await fake.cardsOn(opener, 8)).map((a) => [a.kind, a.payload])).toEqual([['set', {}]]);
    expect(await fake.myFaceDown([set.id])).toEqual({ [set.id]: 'snare' });
    fake.signInAs(bo);
    expect(await fake.myFaceDown([set.id])).toEqual({});
    void ana;
  });

  test('a trap catches the next cast, which is spent, and the spring reveals it', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('blot', boFace, opener, {}, ''));
    expect(caught.payload.caught).toBe(set.id);
    const on = await fake.cardsOn(opener, 8);
    expect(on.find((a) => a.kind === 'spring')?.payload).toMatchObject({ card: 'snare', set: set.id, caught: caught.id });
    expect((await fake.myCards()).find((c) => c.card === 'blot')?.held).toBe(1);
    expect(must(await fake.playCard('blot', boFace, opener, {}, '')).payload.caught).toBeUndefined();
  });

  test('a caught play\'s moment holds the back and the spring, written before it as the server writes them; the spring\'s holds the back', async () => {
    const { fake, bo, anaFace, boFace, opener } = setup();
    const set = must(await fake.setCard('snare', anaFace, opener, {}));
    fake.signInAs(bo);
    const caught = must(await fake.playCard('blot', boFace, opener, {}, ''));
    const spring = (await fake.cardsOn(opener, 8)).find((a) => a.kind === 'spring')!;
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
});

/* Cards beyond a post (docs/plans/2026-11-01-card-reach-plan.md, Task 3): a play on a character, a thread or a board, and the live
   plays above a page's posts read in one batch. */
describe('a card beyond a post, and the effects above a page', () => {
  const sparkle = {
    key: 'sparkle', name: 'Sparkle', alignment: 'pepperoni' as const, rarity: 'uncommon' as const, priceKey: 'sparkle.price', reaches: ['character' as const], lasts: { unit: 'day' as const, count: 7 },
    playPrice: () => 0, validateConfig: (c: unknown) => ({ ok: true as const, value: c ?? {} }),
    canApply: (t: CardTarget, e: readonly CardEffect[]) => landsOn({ key: 'sparkle', reaches: ['character'] }, t, e),
  };
  const shop: Instance = { ...instance, cards: [sparkle], settings: { ...settings, economy: { 'sparkle.price': 100 } } };
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
    const shopBoth: Instance = { ...shop, cards: [{ ...sparkle, reaches: ['character', 'post'], canApply: (t: CardTarget, e: readonly CardEffect[]) => landsOn({ key: 'sparkle', reaches: ['character', 'post'] }, t, e) }] };
    const both = createFake({ instance: shopBoth });
    const a = both.seed.account('a'); const b = both.seed.account('b');
    const af = both.seed.character(a, 'A Face', 'face'); const bf = both.seed.character(b, 'B Face', 'face');
    const { act } = both.seed.thread('general', bf, 'Hi', 'Opener');
    both.seed.wallet(a, 500); both.seed.cards(a, { sparkle: 2 }); both.signInAs(a);
    must(await both.playCard('sparkle', af, bf, {}, '', 'character', act));
    expect(must(await both.playCard('sparkle', af, act, {}, ''))).toMatchObject({ payload: { layer: 1 } });
  });

  test('a Use beyond a post goes on the caller\'s own character, and a board play in The System\'s announcements thread, on no post', async () => {
    const selfie = { ...sparkle, key: 'selfie', name: 'Selfie', play: 'use' as const, canApply: (t: CardTarget, e: readonly CardEffect[]) => landsOn({ key: 'selfie', reaches: ['character'] }, t, e) };
    const quake = { ...sparkle, key: 'quake', name: 'Quake', rarity: 'legendary' as const, reaches: ['board' as const], lasts: { unit: 'day' as const, count: 3 }, canApply: (t: CardTarget, e: readonly CardEffect[]) => landsOn({ key: 'quake', reaches: ['board'] }, t, e) };
    /* On the wall clock: a card's own rules (landsOn) read the time as the server does, so a live board card is live to them. */
    const fake = createFake({ instance: { ...shop, cards: [selfie, quake], settings: { ...shop.settings, economy: { 'sparkle.price': 100 } } }, now: () => Date.now() });
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
    const second = fake.seed.update({ title: 'Traps bite', body: 'The trap was offended.', changes: [{ label: 'Trap Card', text: 'catches more.' }], at: T0 + 2 * H });
    return { fake, admin, ana, bo, cy, anaFace, boFace, first, second };
  }

  test('a page is the updates newest first, each with the persona: the instance\'s, or the engine\'s plain one', async () => {
    const w = updatesWorld(gabe);
    w.fake.signInAs(w.ana);
    const rows = await w.fake.updates();
    expect(rows.map((r) => [r.act, r.title, r.seq])).toEqual([[w.second, 'Traps bite', 2], [w.first, 'Playtest begins', 1]]);
    expect(rows[0]).toMatchObject({ name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe', body: 'The trap was offended.', changes: [{ label: 'Trap Card', text: 'catches more.' }], at: new Date(T0 + 2 * H).toISOString() });
    expect(rows[1]!.changes).toEqual([]);
    const plain = updatesWorld();
    plain.fake.signInAs(plain.ana);
    expect((await plain.fake.updates())[0]).toMatchObject({ name: 'The developers', tagline: '', avatar: null });
    // The persona is a staff character of its own kind, known to be staff, and no player's.
    const [character] = await w.fake.characters([rows[0]!.character]);
    expect(character).toMatchObject({ name: 'Gabe', title: 'Made this. Sorry.', staff: 'developer', staffKind: 'developer' });
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
    expect(spun.thread).toMatchObject({ originActId: w.second, originTitle: 'Updates', originSeq: 2 });
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
