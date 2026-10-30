/**
 * The in-memory backend holds what the server holds, in the server's words: every refusal below is
 * the sentence supabase/migrations and engine/rules/actions.ts raise, so a screen tested against
 * the fake meets the refusals it will meet live. A `.test.tsx` file though it holds no JSX, because
 * `test:engine` runs `engine/**\/*.test.ts` under plain node and this runs under jsdom with the screens'.
 */
import { describe, expect, test } from 'vitest';
import type { Instance, Settings } from '../../rules/types.ts';
import type { Act, Refusal, Tally } from './api.ts';
import { createFake, FAKE_BACKEND_MARKER, TEST_CODE } from './fake.ts';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 },
  postMaxLength: 50, titleMaxLength: 20, postsPerPage: 2, hotReplies: 10, economy: {},
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
      { act: tally, character: anaFace, at: (await fake.act(tally))!.createdAt, was: 'face', since: '2026-09-01T00:00:00.000Z' },
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
    const glass = { smoke: 'full', contrast: 'standard', textSize: 100 } as const;
    expect(await fake.preferences()).toEqual({ theme: 'system', postbit: 'side', motion: 'system', ...glass });
    expect(await fake.setPreferences({ motion: 'reduce' })).toEqual({ ok: true, value: { theme: 'system', postbit: 'side', motion: 'reduce', ...glass } });
    expect(await fake.setPreferences({ theme: 'Loud!' })).toEqual(refused('a theme is named in lowercase words joined by hyphens'));
  });
  test('the glass\'s three preferences are set and kept as the server keeps them, and refused in its words', async () => {
    const { fake } = world();
    expect(await fake.setPreferences({ smoke: 'off' })).toEqual({ ok: true, value: { theme: 'system', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'standard', textSize: 100 } });
    expect(await fake.setPreferences({ contrast: 'high', textSize: 200 })).toEqual({ ok: true, value: { theme: 'system', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'high', textSize: 200 } });
    /* A fresh read is what the next load sees. */
    expect(await fake.preferences()).toMatchObject({ smoke: 'off', contrast: 'high', textSize: 200 });
    expect(await fake.setPreferences({ smoke: 'thick' as never })).toEqual(refused('the smoke is full, low or off'));
    expect(await fake.setPreferences({ contrast: 'max' as never })).toEqual(refused('contrast is standard or high'));
    expect(await fake.setPreferences({ textSize: 175 as never })).toEqual(refused('text size is 100, 125, 150 or 200 percent'));
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
    key: 'splat', name: 'Splat', alignment: 'salty' as const, priceKey: 'splat.price', stack: 2,
    playPrice: (_s: Settings, t: { length: number }) => (t.length > 20 ? 50 : 0),
    canApply: (t: { kind: string }, on: readonly { card: string }[]) => (t.kind !== 'post' ? refused2('a card lands on a post') : on.length >= 2 ? refused2('this post already carries 2 of that card, the most it takes') : { ok: true as const, value: undefined }),
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
