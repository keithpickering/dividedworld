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
import { landsOn, ok, quadrantFree, refuse, type CardEffect, type CardRules, type CardTarget } from '../../rules/cards.ts';
import { cellsOf, count } from '../../rules/surface.ts';
import { momentParts } from '../cards/Effects.tsx';
import type { CardUi } from '../cards/types.ts';
import { failureKind, NOT_SENT, ReadFailure } from './api.ts';
import type { Act, Refusal, Slot, Tally } from './api.ts';
import { TIP_KEYS } from '../tips/keys.ts';
import { createFake, FAKE_BACKEND_MARKER, START, TEST_CODE, TEST_LINK } from './fake.ts';
import { cutLog, LOG_ROWS, micros } from './log-page.ts';
import { actsFollowed, actsNamed } from '../log/lines.ts';
import { systemSettings, testCosmeticsContent, testSystem, testGroups } from '../../rules/test-system.ts';
import { ENGINE_DEFAULT_PRONOUNS, PRONOUN_PRESETS } from '../../rules/pronouns.ts';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } },
  hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
  postMaxLength: 50, titleMaxLength: 20, postsPerPage: 2, hotReplies: 10, searchLanguage: 'english', searchRankPool: 5000, cardSettings: {}, economy: {}, ...systemSettings,
};

const earn = () => [];
const instance: Instance = {
  key: 'test', name: 'Test',
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
    const second = must(await fake.post(thread, anaFace, 'second', null));
    const spun = must(await fake.spin(second.id, anaFace, 'Spun out', 'body'));
    const row = await fake.thread(spun.thread.id);
    expect([row?.originThread, row?.origin]).toEqual([thread, { kind: 'post', thread, title: 'Hello', seq: 2 }]);
    expect((await fake.spunFrom(second.id)).map((t) => [t.originThread, t.origin])).toEqual([[thread, { kind: 'post', thread, title: 'Hello', seq: 2 }]]);
    const plain = await fake.thread(thread);
    expect([plain?.originThread, plain?.origin]).toEqual([null, null]);
  });

  test('a thread spun from a play has the place the SQL gives it: a play, with its card and where it landed (0079)', async () => {
    const { fake, anaFace, boFace, opener, thread } = world();
    const place = async (origin: string) => (await fake.thread(must(await fake.spin(origin, anaFace, 'Spun', 'b')).thread.id))?.origin;
    const post = { kind: 'post', thread, title: 'Hello', seq: 1 };
    // A face-up card on a post.
    expect(await place(fake.seed.card(anaFace, opener, 'whoops'))).toEqual({ kind: 'play', card: 'whoops', on: post });
    // A face-down set names no card; its spring, its own Act, names it.
    const set = fake.seed.set(boFace, fake.seed.post(thread, boFace, 'Bo here.'), 'snare');
    expect(await place(set)).toEqual({ kind: 'play', card: null, on: { kind: 'post', thread, title: 'Hello', seq: 2 } });
    expect(JSON.stringify(await place(set))).not.toContain('snare');
    expect(await place(fake.seed.spring(set))).toEqual({ kind: 'play', card: 'snare', on: { kind: 'post', thread, title: 'Hello', seq: 2 } });
    // Beyond a post: a character (its name, null before its debut), a thread and a board.
    const mine = fake.seed.post(thread, anaFace, 'Mine.');
    expect(await place(fake.seed.reach(boFace, 'character', anaFace, 'glint', { post: mine }))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'character', id: anaFace, name: 'Ana Face' } });
    const unborn = fake.seed.staff('ghost', 'Not Yet', 'mod', { debuted: false });
    const sys = fake.seed.thread('announcements', null, 'Notice').thread;
    const theirs = fake.seed.staffPost(unborn, sys, 'Hidden.');
    expect(await place(fake.seed.reach(boFace, 'character', unborn, 'glint', { post: theirs }))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'character', id: unborn, name: null } });
    expect(await place(fake.seed.reach(boFace, 'thread', thread, 'glint'))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'thread', id: thread, title: 'Hello' } });
    const general = (await fake.boards()).find((b) => b.slug === 'general')!;
    expect(await place(fake.seed.reach(boFace, 'board', general.id, 'glint'))).toEqual({ kind: 'play', card: 'glint', on: { kind: 'board', slug: 'general', name: 'General' } });
    // A card that kept an old place number (staged last, since it takes one): still a play, never a post.
    const old = fake.seed.card(anaFace, opener, 'whoops');
    fake.seed.legacyNumber(old);
    expect(await place(old)).toEqual({ kind: 'play', card: 'whoops', on: post });
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
    const on = (name: string) => [{ kind: 'play', card: 'glint', on: { kind: 'board', slug: 'general', name } }, name];
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
    expect(fromPlay.thread.origin).toEqual({ kind: 'play', card: 'whoops', on: { kind: 'update', act: update, title: 'Traps bite' } });
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
    expect(log.packs).toEqual([{ pack: opened.pack, kind: 'booster', price: 300, repriced: false, contents: opened.contents, at: expect.any(String) }]);
    expect(log.cards.filter((c) => c.kind === 'pulled').map((c) => [c.card, c.pack, c.price])).toEqual(opened.contents.map((c) => [c, opened.pack, 0]));
    fake.seed.slot({ card: 'splat' }, { price: 150, move: { kind: 'repriceSlot', act: 'a1', ends: '2026-11-09T12:00:00Z', demand: null, progress: null, was: 100, percent: 150, hours: null } });
    must(await fake.buyCard((await fake.machine()).find((m) => 'card' in m.item)!));
    expect((await fake.log(null)).cards.find((c) => c.kind === 'bought')).toMatchObject({ price: 150, repriced: true });
  });

  test('a card that writes is not sold where the instance runs no old voice, and is where it does', async () => {
    const typewriter = { ...splat, key: 'typewriter', name: 'Typewriter', writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
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
    const typewriter = { ...splat, key: 'typewriter', name: 'Typewriter', writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) } };
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
  const empty = { infractions: [], bans: [], groupMoves: [], reports: [], appeals: [], settlements: [], wallet: [], cards: [], packs: [], playsOnMine: [], writes: [], draws: [], wallsDrawn: [], saves: [], setEnds: [], caught: [], ended: [], cosmetics: [], before: null };

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
    expect((await fake.cardsOn(opener, 8)).map((a) => [a.kind, a.payload])).toEqual([['set', {}]]);
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
    const on = await fake.cardsOn(opener, 8);
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
    const spring = (await fake.cardsOn(opener, 8)).find((a) => a.kind === 'spring')!;
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

  /* Task 3 and 4 of the card types plan, as the fake mirrors them. */
  const sugar = { ...base, key: 'sugar', name: 'Sugar', alignment: 'sweet' as const, rarity: 'common' as const, canApply: () => ok(undefined) };
  const warding = { ...base, key: 'saltward', name: 'Salt Ward', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'ward' as const, flavors: ['salty' as const] }, lasts: { unit: 'day' as const, count: 7 }, canApply: () => ok(undefined) };
  const named = { ...warding, key: 'namedward', name: 'Name Ward', gimmick: { kind: 'ward' as const, cards: ['sugar'] } };
  const vibes = { ...base, key: 'vibes', name: 'Vibes', alignment: 'sweet' as const, rarity: 'uncommon' as const, play: 'use' as const, reaches: ['thread' as const, 'board' as const], gimmick: { kind: 'price' as const, flavors: ['salty' as const], add: 25 }, lasts: { unit: 'day' as const, count: 3 }, canApply: () => ok(undefined) };
  const net = { ...base, key: 'net', name: 'Net', alignment: 'salty' as const, rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'cast' as const }, match: { flavors: ['salty' as const] } }, canApply: () => ok(undefined) };
  function setup2() {
    const fake = createFake({ instance: { ...world, cards: [...world.cards, sugar, warding, named, vibes, net] } });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    fake.seed.cards(ana, { snare: 2, saltward: 1, namedward: 1, vibes: 1, net: 1 });
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
    expect((await fake.cardsOn(opener, 8)).some((a) => a.kind === 'spring')).toBe(false);
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
    /* The layer counts every play, a reversed one too (acts_card_layers refuses a reused layer). */
    expect((await fake.cardsOn(opener, 10)).filter((a) => a.kind === 'card').map((a) => a.payload.layer)).toEqual([1, 2]);
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
    expect((await fake.alerts()).filter((a) => a.kind === 'cardEnded')).toEqual([]);
    for (const other of [boss, cara]) {
      fake.signInAs(other);
      expect((await fake.log()).ended).toEqual([]);
      expect((await fake.alerts()).filter((a) => a.kind === 'cardEnded')).toEqual([]);
    }
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

  test('cardsOn and cardsOnMany carry the end beside the plays, for the screen to mark a play reversed', async () => {
    const { fake, boss, anaFace, opener } = setup();
    const play = must(await fake.playCard('blot', anaFace, opener, {}, ''));
    fake.signInAs(boss);
    const ended = must(await fake.reverseCard(play.id));
    expect((await fake.cardsOn(opener, 10)).map((a) => [a.kind, a.id, a.targetActId])).toEqual([['card', play.id, opener], ['card_end', ended.act, play.id]]);
    expect((await fake.cardsOnMany([opener], 10)).map((a) => a.kind)).toEqual(['card', 'card_end']);
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
    writes: { tokens: () => 40, frame: () => ({ prompt: '', stop: [] as string[] }) },
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
    const acts = await fake.cardsOnMany([post], 10);
    expect(acts.filter((a) => a.kind === 'card').map((a) => [a.id, a.untaken])).toEqual([[kept, undefined], [lost, true]]);
    fake.clock.advance(60_000);
    expect((await fake.edit(post, face, 'Edited post')).ok).toBe(true);
    const edit = (await fake.history(post)).map((v) => v.id)[1]!;
    expect((await fake.tails([post])).map((r) => [r.play, r.version, r.failed, r.waiting])).toEqual([[kept, post, false, false], [lost, post, true, false], [kept, edit, false, true]]);
    /* A regeneration that fails, for a play that made a text, is not a refund. */
    fake.seed.text(kept, edit, { failed: true }, { quiet: true });
    expect((await fake.cardsOn(post, 10)).find((a) => a.id === kept)?.untaken).toBeUndefined();
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
      const spring = (await fake.cardsOn(opener, 8)).find((a) => a.kind === 'spring')!;
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
      expect((await fake.cardsOn(opener, 8)).some((a) => a.kind === 'spring')).toBe(false);
      const cast = must(await fake.playCard('blot', anaHeel, opener, {}, ''));
      expect(cast.payload).toMatchObject({ rode: back.id });
      expect((await fake.cardsOn(opener, 8)).find((a) => a.kind === 'spring')?.payload).toMatchObject({ did: 'rode', set: back.id, by: cast.id });
    });

    test('a ride set with no quadrant is refused in the card\'s words', async () => {
      const { fake, anaFace, opener } = setup();
      expect(await fake.setCard('rider', anaFace, opener, { card: 'blot' })).toEqual(refused('this card names a reaction quadrant', 'config'));
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
      expect((await s.fake.cardsOn(s.boPost, 20)).map((a) => a.kind)).toEqual(['card']);
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
      expect(await fake.cardsOn(post, 10)).toHaveLength(0);
    });
    test('setCard on one\'s own post takes the draft with it: a back, and no wall until it springs (the fake lays no card from a spring, so the draft is checked and not kept)', async () => {
      const { fake, ana, anaFace, thread } = wall();
      const post = fake.seed.post(thread, anaFace, 'a clean post');
      fake.seed.cards(ana, { slab: 2 });
      expect(await fake.setCard('slab', anaFace, post, {})).toMatchObject({ ok: false, field: 'first' });
      expect(await fake.setCard('slab', anaFace, post, {}, undefined, { strokes: 'no' })).toMatchObject({ ok: false });
      expect(await fake.setCard('slab', anaFace, post, {}, undefined, tag)).toMatchObject({ ok: true, value: { kind: 'set' } });
    });
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
  const items = [hush, move, glow].map((c) => ({ item: { card: c.key }, availability: 'onSale' as const, price: 100 }));
  /* On the wall clock: a card's own rules (quoteStop, landsOn) read the time as the server does. */
  function setup() {
    const fake = createFake({ instance: { ...instance, cards: [hush, move, glow], machine: items, settings: { ...settings, economy: {}, postMaxLength: 2000 } }, now: () => Date.now() });
    const ana = fake.seed.account('ana');
    const bo = fake.seed.account('bo');
    const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
    const boFace = fake.seed.character(bo, 'Bo Face', 'face');
    const { thread, act: opener } = fake.seed.thread('general', anaFace, 'Hello', 'First post');
    fake.seed.wallet(ana, 500);
    fake.seed.cards(ana, { hush: 2, move: 2, glow: 2 });
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
    const inBody = await fake.post(thread, boFace, `[quote=${opener}]yes[/quote] no`, null);
    expect((inBody as Refusal).error).toContain(words(1));
    expect(must(await fake.post(thread, boFace, `Replying.`, null)).kind).toBe('post');
    /* A thread started or spun with the quote in its words is refused too, and a spin from the stopped post is not. */
    expect((await fake.startThread('general', boFace, 'New', `[quote=${opener}]x[/quote]`) as Refusal).error).toContain('a post in another thread');
    expect((await fake.spin(opener, boFace, 'Spun', `[quote=${opener}]x[/quote]`) as Refusal).error).toContain('a post in another thread');
    expect(must(await fake.spin(opener, boFace, 'Spun', `Plain.`)).act.kind).toBe('spin');
  });

  test('the post\'s own author is refused the same way, a quote inside code is no quote, and an ended play stops nothing', async () => {
    const { fake, thread, opener, anaFace } = setup();
    must(await fake.useCard('hush', anaFace, opener, {}, ''));
    expect(((await fake.post(thread, anaFace, `Me.`, opener)) as Refusal).error).toContain(words(1));
    expect(must(await fake.post(thread, anaFace, `[code][quote=${opener}]x[/quote][/code]`, null)).kind).toBe('post');
    fake.clock.advance(2 * 86_400_000);
    expect(must(await fake.post(thread, anaFace, `Me again.`, opener)).kind).toBe('post');
  });

  test('an edit that adds the quote is refused; one that keeps a quote the post already held is written', async () => {
    const { fake, thread, opener, anaFace } = setup();
    const held = must(await fake.post(thread, anaFace, `[quote=${opener}]x[/quote] first`, null));
    must(await fake.useCard('hush', anaFace, opener, {}, ''));
    expect(must(await fake.edit(held.id, anaFace, `[quote=${opener}]x[/quote] changed words`)).kind).toBe('post');
    const plain = must(await fake.post(thread, anaFace, `No quote yet.`, null));
    const refusedEdit = await fake.edit(plain.id, anaFace, `[quote=${opener}]x[/quote] now`);
    expect((refusedEdit as Refusal).error).toContain(words(1));
    /* An edit compares against the post's current body: once an edit drops the quote, one that puts it back adds it. */
    expect(must(await fake.edit(held.id, anaFace, `Dropped the quote.`)).kind).toBe('post');
    const readded = await fake.edit(held.id, anaFace, `[quote=${opener}]x[/quote] back again`);
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
});
