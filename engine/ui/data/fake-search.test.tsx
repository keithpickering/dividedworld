/**
 * The fake's search: the same filters, sorts, cursor and caps as search_posts, search_threads and search_suggest (the SQL's own tests
 * are supabase/tests/0114-search.sql), on a small scale. A `.test.tsx` for the reason fake.test.tsx is: it runs under jsdom.
 */
import { describe, expect, test } from 'vitest';
import type { Instance, Settings } from '../../rules/types.ts';
import { systemSettings, testSystem } from '../../rules/test-system.ts';
import { SEARCH_COUNT_CAP, type SearchPage, type SearchQuery } from './api.ts';
import { createFake } from './fake.ts';

const settings: Settings = {
  walletCap: 600, vote: 10, halving: 0.5, reactionCap: 3, charactersPerPlayer: 3,
  settlementCron: '17 8 * * *', viewCountCron: '41 * * * *', settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 }, turnCooldown: { unit: 'day', count: 30 }, registrationMode: 'invite',
  invitesPerPlayer: 2, inviteLifetime: { unit: 'day', count: 7 }, editGrace: { unit: 'minute', count: 2 }, presenceWindow: { unit: 'minute', count: 5 }, presenceNames: 15, presencePollSeconds: 30, setLasts: { unit: 'day', count: 7 }, reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' }, reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } },
  hints: { least: 10, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } }, toastDefaults: ['quote'],
  postMaxLength: 50, titleMaxLength: 20, postsPerPage: 2, hotReplies: 10, searchLanguage: 'english', searchRankPool: 5, cardSettings: {}, economy: {}, ...systemSettings,
};
const earn = () => [];
const instance: Instance = {
  key: 'test', name: 'Test', copy: { announcementsThreadTitle: 'Promos {season}' },
  classes: [{ key: 'face', name: 'Face', earn }],
  cards: [],
  reactions: [{ key: 'fire', emoji: 'F', quadrant: 'excitedPositive' }],
  settings, system: testSystem,
  boards: [
    { slug: 'general', name: 'General', description: 'Anything.' },
    { slug: 'games', name: 'Games', description: 'Play.' },
    { slug: 'the-system', name: 'The System', description: 'Its words.', system: true },
  ],
  ranks: [{ name: 'Jobber', from: 0 }],
  pipStyles: [{ key: 'default', name: 'Default', full: 'f.svg', empty: 'e.svg' }],
};

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 30, 0);
const none: SearchQuery = { q: '', author: null, board: null, fromAt: null, toAt: null, titlesOnly: false, sort: null, perPage: null };
const ask = (o: Partial<SearchQuery>): SearchQuery => ({ ...none, ...o });
const ids = (p: SearchPage<{ readonly act: string }>) => p.results.map((r) => r.act);

/** Ana (Ana Face) and Bo (Bo Face, and Bo Waiting, not debuted); General holds "Mario Kart" and "Plain", Games holds "Zelda". */
function world() {
  const fake = createFake({ instance });
  const ana = fake.seed.account('ana');
  const bo = fake.seed.account('bo');
  const anaFace = fake.seed.character(ana, 'Ana Face', 'face');
  const boFace = fake.seed.character(bo, 'Bo Face', 'face');
  const waiting = fake.seed.character(bo, 'Bo Waiting', 'face', { debuted: false });
  const kart = fake.seed.thread('general', anaFace, 'Mario Kart', 'Banana peels everywhere', { at: T0 });
  const p2 = fake.seed.post(kart.thread, boFace, 'I love banana bread and [b]banana[/b] smoothies', { at: T0 + 1 * H });
  const p3 = fake.seed.post(kart.thread, anaFace, 'Shells are better', { at: T0 + 2 * H });
  const plain = fake.seed.thread('general', boFace, 'Plain', 'nothing to see', { at: T0 + 3 * H });
  const zelda = fake.seed.thread('games', boFace, 'Zelda', 'A banana in Hyrule', { at: T0 + 4 * H });
  fake.signInAs(ana);
  return { fake, ana, bo, anaFace, boFace, waiting, kart, p2, p3, plain, zelda };
}

describe('search_posts in the fake: the filters', () => {
  test('a word matches whole words in a post body, case apart and marks aside; a post with BBCode matches on what it shows', async () => {
    const w = world();
    const page = await w.fake.searchPosts(ask({ q: 'BANANA' }));
    expect(new Set(ids(page))).toEqual(new Set([w.kart.act, w.p2, w.zelda.act]));
    expect(page.count).toBe(3);
    expect(await w.fake.searchPosts(ask({ q: 'banan' }))).toMatchObject({ count: 0, results: [] });
  });
  test('every word must match, and a -word leaves out a post that has it', async () => {
    const w = world();
    expect(ids(await w.fake.searchPosts(ask({ q: 'banana bread' })))).toEqual([w.p2]);
    expect(new Set(ids(await w.fake.searchPosts(ask({ q: 'banana -bread' }))))).toEqual(new Set([w.kart.act, w.zelda.act]));
  });
  test('a result carries its thread, board, seq, page (postsPerPage 2), author name and a snippet that marks the matched words', async () => {
    const w = world();
    const hit = (await w.fake.searchPosts(ask({ q: 'bread' }))).results[0]!;
    expect(hit).toMatchObject({ act: w.p2, thread: w.kart.thread, title: 'Mario Kart', boardSlug: 'general', boardName: 'General', seq: 2, page: 1, character: w.boFace, name: 'Bo Face', cards: [] });
    expect(hit.snippet).toContain('<<bread>>');
    expect((await w.fake.searchPosts(ask({ board: (await w.fake.board('general'))!.id }))).results.every((r) => !r.snippet.includes('<<'))).toBe(true);
    const third = (await w.fake.searchPosts(ask({ q: 'shells' }))).results[0]!;
    expect(third).toMatchObject({ seq: 3, page: 2 });
  });
  test('a thread\'s title matches its first post, and titles only matches nothing else', async () => {
    const w = world();
    expect(ids(await w.fake.searchPosts(ask({ q: 'mario' })))).toEqual([w.kart.act]);
    expect(ids(await w.fake.searchPosts(ask({ q: 'mario', titlesOnly: true })))).toEqual([w.kart.act]);
    expect(new Set(ids(await w.fake.searchPosts(ask({ q: 'banana' }))))).toContain(w.p2);
    expect(new Set(ids(await w.fake.searchPosts(ask({ q: 'banana', titlesOnly: true }))))).toEqual(new Set());
    expect(ids(await w.fake.searchPosts(ask({ q: 'hyrule', titlesOnly: true })))).toEqual([]);
  });
  test('author, board and the dates each narrow, and together', async () => {
    const w = world();
    expect(new Set(ids(await w.fake.searchPosts(ask({ q: 'banana', author: w.boFace }))))).toEqual(new Set([w.p2, w.zelda.act]));
    expect(ids(await w.fake.searchPosts(ask({ q: 'banana', board: (await w.fake.board('games'))!.id })))).toEqual([w.zelda.act]);
    const fromAt = new Date(T0 + 1 * H).toISOString();
    const toAt = new Date(T0 + 3 * H).toISOString();
    expect(new Set(ids(await w.fake.searchPosts(ask({ fromAt, toAt }))))).toEqual(new Set([w.p2, w.p3, w.plain.act]));
    expect(ids(await w.fake.searchPosts(ask({ q: 'banana', fromAt, toAt, author: w.boFace })))).toEqual([w.p2]);
  });
  test('no keywords is every post the filters leave; a not-yet-debuted author finds nothing, as a random id does', async () => {
    const w = world();
    expect((await w.fake.searchPosts(ask({}))).count).toBe(5);
    const stranger = await w.fake.searchPosts(ask({ author: '00000000-0000-4000-8000-000000000000' }));
    expect(await w.fake.searchPosts(ask({ author: w.waiting }))).toEqual(stranger);
    expect(stranger.count).toBe(0);
  });
  test('the Updates thread is never found and a thread The System\'s board holds is; an edit changes what a post matches', async () => {
    const w = world();
    w.fake.seed.update({ title: 'Banana patch', body: 'banana notes' });
    expect(new Set(ids(await w.fake.searchPosts(ask({ q: 'banana' }))))).toEqual(new Set([w.kart.act, w.p2, w.zelda.act]));
    const mod = w.fake.seed.staff('mod', 'Mod Bot', 'mod');
    const ruling = w.fake.seed.thread('the-system', null, 'Ruling', 'The System spoke');
    const said = w.fake.seed.staffPost(mod, ruling.thread, 'a banana was weighed');
    expect(ids(await w.fake.searchPosts(ask({ q: 'weighed' })))).toEqual([said]);
    expect(ids(await w.fake.searchPosts(ask({ q: 'spoke' })))).toEqual([]);
  });
  test('a card live on the post is a mark on its result', async () => {
    const f = createFake({ instance: { ...instance, cards: [{ key: 'splat', name: 'Splat', price: 10 } as never] } });
    const a = f.seed.account('a');
    const c = f.seed.character(a, 'Cee', 'face');
    const t = f.seed.thread('general', c, 'Zed', 'banana');
    f.seed.card(c, t.act, 'splat');
    f.signInAs(a);
    expect((await f.searchPosts(ask({ q: 'banana' }))).results[0]!.cards).toEqual(['splat']);
  });
});

describe('search_posts in the fake: sort, pool and cursor', () => {
  test('newest is the default without keywords, oldest reverses it, relevance is the default with them', async () => {
    const w = world();
    expect(ids(await w.fake.searchPosts(ask({})))[0]).toBe(w.zelda.act);
    expect(ids(await w.fake.searchPosts(ask({ sort: 'oldest' })))[0]).toBe(w.kart.act);
    expect(ids(await w.fake.searchPosts(ask({ sort: 'newest' })))[0]).toBe(w.zelda.act);
    /* "banana" is said twice in p2 and once in each other: the relevant one comes first. */
    expect(ids(await w.fake.searchPosts(ask({ q: 'banana' })))[0]).toBe(w.p2);
    expect(ids(await w.fake.searchPosts(ask({ q: 'banana', sort: 'newest' })))).toEqual([w.zelda.act, w.p2, w.kart.act]);
    expect(ids(await w.fake.searchPosts(ask({ q: 'banana', sort: 'oldest' })))).toEqual([w.kart.act, w.p2, w.zelda.act]);
  });
  test('a relevance search ranks only the newest searchRankPool (5) matches and says so; newest has no pool', async () => {
    const f = createFake({ instance });
    const a = f.seed.account('a');
    const c = f.seed.character(a, 'Cee', 'face');
    const t = f.seed.thread('general', c, 'Pile', 'pear 0', { at: T0 });
    for (let i = 1; i < 9; i++) f.seed.post(t.thread, c, `pear ${i}`, { at: T0 + i * H });
    f.signInAs(a);
    const ranked = await f.searchPosts(ask({ q: 'pear', perPage: 50 }));
    expect(ranked).toMatchObject({ count: 9, pooled: true });
    expect(ranked.results).toHaveLength(5);
    const newest = await f.searchPosts(ask({ q: 'pear', sort: 'newest', perPage: 50 }));
    expect(newest).toMatchObject({ count: 9, pooled: false });
    expect(newest.results).toHaveLength(9);
    expect((await f.searchPosts(ask({ q: 'pear 1', perPage: 50 }))).pooled).toBe(false);
  });
  test.each(['relevance', 'newest', 'oldest'] as const)('the cursor walks a %s result set with no repeat and no gap', async (sort) => {
    const f = createFake({ instance: { ...instance, settings: { ...settings, searchRankPool: 100 } } });
    const a = f.seed.account('a');
    const c = f.seed.character(a, 'Cee', 'face');
    const t = f.seed.thread('general', c, 'Walk', 'fig', { at: T0 });
    for (let i = 1; i < 23; i++) f.seed.post(t.thread, c, i % 3 === 0 ? 'fig fig fig' : i % 2 === 0 ? 'fig fig' : 'fig', { at: i % 5 === 0 ? T0 + 5 * H : T0 + i * H });
    f.signInAs(a);
    const seen: string[] = [];
    let after = null as SearchPage<{ act: string }>['next'];
    let pages = 0;
    do {
      const page = await f.searchPosts(ask({ q: 'fig', sort, perPage: 5 }), after);
      expect(page.count).toBe(23);
      seen.push(...ids(page));
      after = page.next;
      pages++;
    } while (after && pages < 20);
    expect(pages).toBe(5);
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
    const whole = ids(await f.searchPosts(ask({ q: 'fig', sort, perPage: 50 })));
    expect(seen).toEqual(whole);
    expect((await f.searchPosts(ask({ q: 'fig', sort, perPage: 50 }))).next).toBeNull();
  });
  test('per_page is 20 unless asked and 1 to 50 or refused', async () => {
    const w = world();
    expect((await w.fake.searchPosts(ask({ perPage: 2 }))).results).toHaveLength(2);
    await expect(w.fake.searchPosts(ask({ perPage: 0 }))).rejects.toThrow(/1 to 50/);
    await expect(w.fake.searchPosts(ask({ perPage: 51 }))).rejects.toThrow(/1 to 50/);
  });
  test('the count stops at 1,001 and says there are more', async () => {
    const f = createFake({ instance });
    const a = f.seed.account('a');
    const c = f.seed.character(a, 'Cee', 'face');
    const t = f.seed.thread('general', c, 'Lots', 'kiwi', { at: T0 });
    for (let i = 1; i < SEARCH_COUNT_CAP + 50; i++) f.seed.post(t.thread, c, 'kiwi', { at: T0 + i * 1000 });
    f.signInAs(a);
    const page = await f.searchPosts(ask({ q: 'kiwi', sort: 'newest', perPage: 50 }));
    expect(page).toMatchObject({ count: SEARCH_COUNT_CAP + 1, more: true });
    const few = await f.searchPosts(ask({ q: 'kiwi', fromAt: new Date(T0 + 10_000).toISOString(), toAt: new Date(T0 + 20_000).toISOString(), sort: 'newest' }));
    expect(few).toMatchObject({ count: 11, more: false });
  });
});

describe('search_threads in the fake', () => {
  test('each thread once, with its best snippet and how many of its posts match', async () => {
    const w = world();
    const page = await w.fake.searchThreads(ask({ q: 'banana' }));
    expect(page.count).toBe(2);
    expect(page.results.map((r) => r.thread).sort()).toEqual([w.kart.thread, w.zelda.thread].sort());
    const kart = page.results.find((r) => r.thread === w.kart.thread)!;
    expect(kart).toMatchObject({ matches: 2, matchesMore: false, title: 'Mario Kart', act: w.p2 });
    expect(kart.snippet).toContain('<<banana>>');
  });
  test('filters and the cursor hold, and a thread\'s matches stop at 100', async () => {
    const f = createFake({ instance: { ...instance, settings: { ...settings, searchRankPool: 1000 } } });
    const a = f.seed.account('a');
    const c = f.seed.character(a, 'Cee', 'face');
    const first = f.seed.thread('general', c, 'Alpha', 'plum', { at: T0 });
    for (let i = 1; i < 120; i++) f.seed.post(first.thread, c, 'plum', { at: T0 + i * 1000 });
    for (let i = 0; i < 6; i++) f.seed.thread('games', c, `T${i}`, 'plum', { at: T0 + (200 + i) * 1000 });
    f.signInAs(a);
    const all = await f.searchThreads(ask({ q: 'plum', sort: 'newest', perPage: 4 }));
    expect(all.count).toBe(7);
    const rest = await f.searchThreads(ask({ q: 'plum', sort: 'newest', perPage: 4 }), all.next);
    expect([...all.results, ...rest.results].map((r) => r.thread)).toHaveLength(7);
    expect(new Set([...all.results, ...rest.results].map((r) => r.thread)).size).toBe(7);
    expect(rest.next).toBeNull();
    const alpha = [...all.results, ...rest.results].find((r) => r.thread === first.thread)!;
    expect(alpha).toMatchObject({ matches: 100, matchesMore: true });
    expect((await f.searchThreads(ask({ q: 'plum', board: (await f.board('games'))!.id }))).count).toBe(6);
  });
});

describe('search_threads in the fake: the pool', () => {
  test('threads are found among the newest searchRankPool (5) matches whatever the sort, and say so', async () => {
    const f = createFake({ instance });
    const a = f.seed.account('a');
    const c = f.seed.character(a, 'Cee', 'face');
    for (let i = 0; i < 8; i++) f.seed.thread('general', c, `Th${i}`, 'lime', { at: T0 + i * H });
    f.signInAs(a);
    for (const sort of ['relevance', 'newest', 'oldest'] as const) expect(await f.searchThreads(ask({ q: 'lime', sort, perPage: 50 }))).toMatchObject({ count: 5, pooled: true });
    expect((await f.searchThreads(ask({ q: 'lime', sort: 'newest', perPage: 50 }))).results.map((r) => r.title)).toEqual(['Th7', 'Th6', 'Th5', 'Th4', 'Th3']);
    expect((await f.searchThreads(ask({ q: 'lime', sort: 'oldest', perPage: 50 }))).results.map((r) => r.title)).toEqual(['Th0', 'Th1', 'Th2', 'Th3', 'Th4']);
  });
});

describe('search_suggest in the fake', () => {
  test('a prefix finds threads, characters and boards, a misspelling and a capital among them', async () => {
    const w = world();
    expect((await w.fake.suggest('mar')).threads).toEqual([expect.objectContaining({ id: w.kart.thread, title: 'Mario Kart', boardName: 'General' })]);
    expect((await w.fake.suggest('MAIRO')).threads.map((t) => t.title)).toEqual(['Mario Kart']);
    expect((await w.fake.suggest('ana')).characters).toEqual([{ id: w.anaFace, name: 'Ana Face' }]);
    expect((await w.fake.suggest('gam')).boards).toEqual([expect.objectContaining({ slug: 'games', name: 'Games' })]);
  });
  test('a character that has not debuted is never suggested', async () => {
    const w = world();
    expect((await w.fake.suggest('bo w')).characters).toEqual([]);
    expect((await w.fake.suggest('bo')).characters.map((c) => c.name)).toEqual(['Bo Face']);
  });
  test('kinds, board, excludeSystem and most narrow it; the Updates thread is never listed', async () => {
    const w = world();
    w.fake.seed.update({ title: 'Gamma patch', body: 'x' });
    const sys = w.fake.seed.thread('the-system', null, 'Gamma ruling', 'x');
    expect((await w.fake.suggest('gam', { kinds: ['threads'] })).boards).toEqual([]);
    expect((await w.fake.suggest('gamma', { kinds: ['threads'] })).threads.map((t) => t.id)).toEqual([sys.thread]);
    expect((await w.fake.suggest('gamma', { kinds: ['threads'], excludeSystem: true })).threads).toEqual([]);
    expect((await w.fake.suggest('the', { kinds: ['boards'], excludeSystem: true })).boards).toEqual([]);
    expect((await w.fake.suggest('pl', { kinds: ['threads'], board: (await w.fake.board('general'))!.id })).threads.map((t) => t.title)).toEqual(['Plain']);
    await expect(w.fake.suggest('a', { kinds: ['threads'] })).rejects.toThrow(/2 to 100/);
    expect((await w.fake.suggest('', { kinds: ['threads'], most: 2 })).threads).toHaveLength(2);
    await expect(w.fake.suggest('mar', { most: 11 })).rejects.toThrow(/1 to 10/);
    await expect(w.fake.suggest('x'.repeat(101))).rejects.toThrow(/2 to 100/);
  });
});
