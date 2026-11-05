/**
 * The Supabase adapter, driven with a fake `fetch` that records every request and answers in the
 * shapes PostgREST and the edge functions answer in. Every assertion is on the request the adapter
 * sends and the answer it returns. Realtime is checked through an injected client stub: the socket
 * itself is not driven (the channel the adapter opens, how it authorizes it and what it does with
 * a broadcast are).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_READS, ALLOWED_RPCS as GUARD_RPCS } from '../../../tools/check-web-reads.mjs';
import type { Act, KayfaApi, ScreenSettings, ThreadSummary } from '../../../engine/ui/data/api.ts';
import { createSupabaseApi } from './supabase.ts';

/* Built in pieces on purpose: the web-reads guard refuses a path it cannot read to its end. */
const REST = ['', 'rest', 'v1'].join('/');
const URL_ = 'https://proj.supabase.co';
const PUBLISHABLE = 'sb_publishable_test0123456789';
const FALLBACK: ScreenSettings = {
  postsPerPage: 20,
  hotReplies: 5,
  editGrace: { unit: 'minute', count: 2 },
  reactionCap: 3,
  charactersPerPlayer: 6,
  invitesPerPlayer: 3,
  inviteLifetime: { unit: 'day', count: 7 },
  turnCooldown: { unit: 'day', count: 30 },
  walletCap: 600,
  postMaxLength: 20000,
  titleMaxLength: 120,
  registrationMode: 'invite',
  settlementLength: { unit: 'day', count: 1 },
  cardSettings: { 'whoops.clean': 95 },
  presencePollSeconds: 30,
  presenceWindow: { unit: 'minute', count: 5 },
  cardEconomy: {},
  economy: {},
  toastDefaults: ['quote', 'update'],
  staffGroup: { name: 'Test Cores' },
};

const B64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${B64({ alg: 'HS256', typ: 'JWT' })}.${B64({ sub: 'u-1', aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.sig`;
const SESSION = { access_token: JWT, refresh_token: 'refresh-1', expires_in: 3600, token_type: 'bearer', user: { id: 'u-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const SET = '55555555-5555-4555-8555-555555555555';
const SPRING = '66666666-6666-4666-8666-666666666666';
const T = '44444444-4444-4444-8444-444444444444';

interface Rec {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  readonly body: unknown;
}
type Reply = Response | Error;
type Router = (req: Rec, nth: number) => Reply | undefined;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}
/** A PostgREST select answer: rows, with a content-range when a count was asked for. */
function rows(list: unknown[], total?: number): Response {
  return json(list, 200, total === undefined ? {} : { 'content-range': list.length ? `0-${list.length - 1}/${total}` : `*/${total}` });
}

function harness(router: Router) {
  const log: Rec[] = [];
  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init);
    const raw = init?.body;
    const body = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : (raw ?? null);
    const rec: Rec = { url: new URL(req.url), method: req.method, headers: req.headers, body };
    log.push(rec);
    const nth = log.filter((r) => r.url.pathname === rec.url.pathname && r.method === rec.method).length;
    const reply = router(rec, nth) ?? json({ message: 'unrouted' }, 404);
    if (reply instanceof Error) throw reply;
    return reply;
  }) as typeof fetch;
  const api = createSupabaseApi({ url: URL_, publishableKey: PUBLISHABLE, settingsFallback: FALLBACK, fetch: fetchFake });
  const rest = () => log.filter((r) => r.url.pathname.startsWith(`${REST}/`));
  const to = (name: string) => log.filter((r) => r.url.pathname === `${REST}/${name}`);
  return { api, log, rest, to };
}

const ACT_ROW = { id: A, character: B, kind: 'post', thread: T, target_act_id: null, seq: 2, created_at: '2026-10-01T10:00:00+00:00', payload: { body: 'hi' }, current_payload: { body: 'hello' }, edited_at: '2026-10-01T10:05:00+00:00', shown_edited_at: null };
const ACT: Act = { id: A, character: B, kind: 'post', thread: T, targetActId: null, seq: 2, createdAt: '2026-10-01T10:00:00+00:00', payload: { body: 'hi' }, currentPayload: { body: 'hello' }, editedAt: '2026-10-01T10:05:00+00:00', shownEditedAt: null };
const THREAD_ROW = { id: T, board: C, title: 'A title', origin_act_id: null, created_at: '2026-10-01T09:00:00+00:00', last_at: '2026-10-01T10:00:00+00:00', last_seq: 2, first_act: A, first_character: B, last_act: A, last_character: B, replies: 3, replies_this_week: 4, origin_thread: null, origin_place: null };

/** Everything a read can name: the web-reads guard's own lists, so the adapter is held to the allowlist the build checks its source against. */
const ALLOWED_TABLES = new Set(ALLOWED_READS);
const ALLOWED_RPCS = new Set(GUARD_RPCS);

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* none */
  }
});

describe('what the adapter may request', () => {
  it('names only the allowed tables and functions, whatever the screens ask for', async () => {
    const h = harness((r) => {
      if (r.url.pathname.startsWith(`${REST}/rpc/`)) return json(null);
      if (r.url.pathname.startsWith('/functions/v1/estimate')) return json({ entries: [], lines: [], asOf: null, freshAfter: null });
      return rows([], 0);
    });
    const api = h.api;
    await Promise.allSettled([
      api.settings(), api.boards(), api.board('general'), api.board(C), api.threads(C, { offset: 0, limit: 5 }), api.thread(T), api.acts(T, 1, 5), api.act(A), api.actsById([A]), api.history(A), api.spunFrom(A), api.spunFromMany([A], 10), api.cardsOn(A, 10), api.cardsOnMany([A], 10), api.effectStates([A]), api.playMoment(A), api.myReleases([A]), api.releaseEffect(A),
      api.characters([B]), api.characterCounts(B), api.characterStats([B]), api.standingAmounts([B]), api.standingPlace(B), api.characterActs(B, ['post'], { offset: 0, limit: 5 }), api.characterReveals(B), api.standingsCount(), api.standingsPage(0, 5), api.tallies([A]), api.viewCounts([T]), api.season(),
      api.boardNames(), api.moveNotice(A), api.movesLog('director'), api.movesLog('director', { at: '2026-10-01T10:00:00+00:00', act: A }), api.staffProfile('director'), api.adminQueue(), api.holdMove(1), api.reverseMove(A), api.updates(), api.updates('2026-10-01T10:00:00+00:00'), api.postUpdate('T', 'B', []),
      api.lastSettledAt(), api.classReveals([B]), api.turnsAnnounced([B]), api.nextSettlementAt(), api.myCharacters(), api.wallet(),
      api.myReactions([A]), api.myCards(), api.reading([T]), api.preferences(), api.invites(), api.isAdmin(), api.session(), api.estimate(),
    ]);
    const tables = new Set(h.rest().filter((r) => !r.url.pathname.includes('/rpc/')).map((r) => r.url.pathname.replace(`${REST}/`, '')));
    expect(tables.size).toBeGreaterThan(15);
    for (const t of tables) expect(ALLOWED_TABLES.has(t), `read of ${t}`).toBe(true);
    const rpcs = h.rest().filter((r) => r.url.pathname.includes('/rpc/')).map((r) => r.url.pathname.replace(`${REST}/rpc/`, ''));
    expect(rpcs.length).toBeGreaterThan(0);
    for (const f of rpcs) expect(ALLOWED_RPCS.has(f), `rpc ${f}`).toBe(true);
    /* Nothing is counted per view: no read asks PostgREST for a count of rows (a head request, or a count preference). */
    expect(h.rest().filter((r) => r.method === 'HEAD' || /count=/.test(r.headers.get('prefer') ?? '')).map((r) => r.url.pathname), 'a read that counts rows').toEqual([]);
    expect(h.log.filter((r) => r.url.pathname.startsWith('/auth/v1/otp') || r.url.pathname.startsWith('/auth/v1/verify'))).toEqual([]);
  });

  it('says whether a read mark was recorded: true when it was, false when the server refused it', async () => {
    const ok = harness((r) => (r.url.pathname.endsWith('/rpc/mark_read') ? json({ thread: T, furthest_seq: 3 }) : json({}, 404)));
    expect(await ok.api.markRead(T, 3, B)).toBe(true);
    const refused = harness((r) => (r.url.pathname.endsWith('/rpc/mark_read') ? json({ code: '28000', message: 'sign in with an account first', hint: 'kayfabb.refusal' }, 401) : json({}, 404)));
    expect(await refused.api.markRead(T, 3, B)).toBe(false);
  });

  it('sends the HUD character only in a body the action needs, never in a URL or a header', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/mark_read') ? json({ thread: T, furthest_seq: 3 }) : json({}, 404)));
    await h.api.markRead(T, 3, B);
    const [req] = h.to('rpc/mark_read');
    expect(req?.body).toEqual({ in_thread: T, seq: 3, through: B });
    expect(req?.url.toString()).not.toContain(B);
    expect([...(req?.headers.values() ?? [])].join(' ')).not.toContain(B);
  });

  it('polls presence with the place and the HUD mask in the body, answers names and a count, and throws on a refusal', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/here') ? json({ names: [{ id: A, name: 'Ann', staff: false }, { id: B, name: 'Bossy', staff: true }, { id: T, name: 'Old answer' }], others: 2 }) : json({}, 404)));
    expect(await h.api.here({ kind: 'thread', thread: T }, B)).toEqual({ names: [{ id: A, name: 'Ann', staff: false }, { id: B, name: 'Bossy', staff: true }, { id: T, name: 'Old answer', staff: false }], others: 2 });
    await h.api.here({ kind: 'index' }, null);
    const [first, second] = h.to('rpc/here');
    expect(first?.body).toEqual({ in_kind: 'thread', in_place: T, through: B });
    expect(second?.body).toEqual({ in_kind: 'index', in_place: null, through: null });
    expect(first?.url.toString()).not.toContain(B);
    const refused = harness((r) => (r.url.pathname.endsWith('/rpc/here') ? json({ code: '42501', message: 'you do not play that character', hint: 'kayfabb.refusal' }, 403) : json({}, 404)));
    await expect(refused.api.here({ kind: 'index' }, B)).rejects.toThrow('you do not play that character');
  });

  it('hides a mask from presence through set_presence_hidden, and answers whether it is hidden', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/set_presence_hidden') ? json({ character: B, hidden: true }) : json({}, 404)));
    expect(await h.api.setPresenceHidden(B, true)).toEqual({ ok: true, value: true });
    expect(h.to('rpc/set_presence_hidden')[0]?.body).toEqual({ in_character: B, hidden: true });
  });
});

describe('reads and their rows', () => {
  it('maps a thread page from thread_list, newest first, with the board\'s counter as the total and no count of the list', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/board_counts') ? rows([{ threads: 37 }]) : rows([THREAD_ROW])));
    const page = await h.api.threads(C, { offset: 10, limit: 10 });
    const [req] = h.to('thread_list');
    expect(req?.method).toBe('GET');
    expect(req?.headers.get('prefer') ?? '').not.toContain('count');
    const [counter] = h.to('board_counts');
    expect(counter?.url.searchParams.get('select')).toBe('threads');
    expect(counter?.url.searchParams.get('board')).toBe(`eq.${C}`);
    expect(req?.url.searchParams.get('board')).toBe(`eq.${C}`);
    expect(req?.url.searchParams.get('order')).toBe('last_at.desc');
    expect(req?.url.searchParams.get('offset')).toBe('10');
    expect(req?.url.searchParams.get('limit')).toBe('10');
    expect(page.total).toBe(37);
    expect(page.threads).toEqual([{ id: T, board: C, title: 'A title', originActId: null, createdAt: '2026-10-01T09:00:00+00:00', lastAt: '2026-10-01T10:00:00+00:00', lastSeq: 2, firstAct: A, firstCharacter: B, lastAct: A, lastCharacter: B, replies: 3, repliesThisWeek: 4, originThread: null, origin: null }]);
  });

  it('reads only the counter for a page of no rows, and none of the list', async () => {
    const h = harness(() => rows([{ threads: 37 }]));
    expect(await h.api.threads(C, { offset: 0, limit: 0 })).toEqual({ threads: [], total: 37 });
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['board_counts']);
    expect(await harness(() => rows([])).api.threads(C, { offset: 0, limit: 5 })).toEqual({ threads: [], total: 0 });
  });

  it('reads one board by its slug, or by its id, as one row of boards_now, the name it is called now', async () => {
    const row = { id: C, slug: 'general', name: 'General', description: 'All', is_system: true };
    const h = harness(() => rows([row]));
    expect(await h.api.board('general')).toEqual({ id: C, slug: 'general', name: 'General', description: 'All', isSystem: true, moveAct: null });
    expect(await h.api.board(C)).toEqual({ id: C, slug: 'general', name: 'General', description: 'All', isSystem: true, moveAct: null });
    const [bySlug, byId] = h.to('boards_now');
    expect(bySlug?.url.searchParams.get('slug')).toBe('eq.general');
    expect(bySlug?.url.searchParams.get('id')).toBeNull();
    expect(byId?.url.searchParams.get('id')).toBe(`eq.${C}`);
    expect(byId?.url.searchParams.get('limit')).toBe('1');
    expect(h.rest().every((r) => r.url.pathname.endsWith('/boards_now'))).toBe(true);
    expect(await harness(() => rows([])).api.board('nowhere')).toBeNull();
  });

  it('reads a spun thread\'s origin with its row, not in reads of its own', async () => {
    const origin = { ...THREAD_ROW, origin_act_id: A, origin_thread: C, origin_place: { kind: 'post', thread: C, title: 'Where it came from', seq: 7 } };
    const h = harness(() => rows([origin]));
    const row = await h.api.thread(T);
    expect([row?.originActId, row?.originThread, row?.origin]).toEqual([A, C, { kind: 'post', thread: C, title: 'Where it came from', seq: 7 }]);
    /* By its id, from thread_open: thread_list leaves the season's reveal and Turns threads out of a board's list, and a link to one still opens it. */
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['thread_open']);
  });

  it('reads each kind of origin place from a row', async () => {
    const places: [unknown, ThreadSummary['origin']][] = [
      [{ kind: 'post', thread: C, title: 'T', seq: 3 }, { kind: 'post', thread: C, title: 'T', seq: 3 }],
      [{ kind: 'update', act: A, title: 'Traps bite' }, { kind: 'update', act: A, title: 'Traps bite' }],
      [{ kind: 'play', card: 'whoops', on: { kind: 'post', thread: C, title: 'T', seq: 3 } }, { kind: 'play', card: 'whoops', on: { kind: 'post', thread: C, title: 'T', seq: 3 } }],
      [{ kind: 'play', card: null, on: { kind: 'update', act: A, title: 'U' } }, { kind: 'play', card: null, on: { kind: 'update', act: A, title: 'U' } }],
      [{ kind: 'play', card: 'glint', on: { kind: 'character', id: B, name: 'Ana Face' } }, { kind: 'play', card: 'glint', on: { kind: 'character', id: B, name: 'Ana Face' } }],
      [{ kind: 'play', card: 'glint', on: { kind: 'character', id: B, name: null } }, { kind: 'play', card: 'glint', on: { kind: 'character', id: B, name: null } }],
      [{ kind: 'play', card: 'glint', on: { kind: 'thread', id: T, title: 'T' } }, { kind: 'play', card: 'glint', on: { kind: 'thread', id: T, title: 'T' } }],
      [{ kind: 'play', card: 'glint', on: { kind: 'board', slug: 'general', name: 'General' } }, { kind: 'play', card: 'glint', on: { kind: 'board', slug: 'general', name: 'General' } }],
      [{ kind: 'play', card: 'glint', on: null }, { kind: 'play', card: 'glint', on: null }],
      [null, null],
    ];
    for (const [raw, want] of places) {
      const row = await harness(() => rows([{ ...THREAD_ROW, origin_place: raw }])).api.thread(T);
      expect(row?.origin, JSON.stringify(raw)).toEqual(want);
    }
  });

  it('reads a malformed origin place as null, and a play whose target is malformed as a play on nothing', async () => {
    const read = async (raw: unknown) => (await harness(() => rows([{ ...THREAD_ROW, origin_place: raw }])).api.thread(T))?.origin;
    for (const bad of [
      { kind: 'mystery', thread: C }, { kind: 'post', thread: C, title: 'T', seq: '7' }, { kind: 'post', thread: C, title: 'T' },
      { kind: 'update', act: A }, { kind: 'play', card: 5, on: null }, { kind: 'play', on: null },
      { kind: 'character', id: B, name: null }, 'post', 7, [],
      // Each key alone missing or mistyped, with every other key right.
      { kind: 'post', title: 'T', seq: 3 }, { kind: 'post', thread: 5, title: 'T', seq: 3 }, { kind: 'post', thread: C, title: 5, seq: 3 }, { kind: 'post', thread: C, title: 'T', seq: NaN },
      { kind: 'update', title: 'U' }, { kind: 'update', act: 5, title: 'U' }, { kind: 'update', act: A }, { kind: 'update', act: A, title: 5 },
    ]) expect(await read(bad), JSON.stringify(bad)).toBeNull();
    for (const on of [
      { kind: 'mystery' }, { kind: 'post', thread: C, title: 'T', seq: '7' }, { kind: 'character', id: B }, { kind: 'board', slug: 'g' }, 'post', 3, undefined,
      { kind: 'post', title: 'T', seq: 3 }, { kind: 'post', thread: 5, title: 'T', seq: 3 }, { kind: 'post', thread: C, seq: 3 }, { kind: 'post', thread: C, title: 5, seq: 3 }, { kind: 'post', thread: C, title: 'T', seq: NaN },
      { kind: 'update', title: 'U' }, { kind: 'update', act: 5, title: 'U' }, { kind: 'update', act: A }, { kind: 'update', act: A, title: 5 },
      { kind: 'character', name: 'N' }, { kind: 'character', id: 5, name: 'N' }, { kind: 'character', id: B, name: 5 },
      { kind: 'thread', title: 'T' }, { kind: 'thread', id: 5, title: 'T' }, { kind: 'thread', id: T }, { kind: 'thread', id: T, title: 5 },
      { kind: 'board', name: 'N' }, { kind: 'board', slug: 5, name: 'N' }, { kind: 'board', slug: 'g', name: 5 },
    ]) expect(await read({ kind: 'play', card: 'whoops', on }), JSON.stringify(on)).toEqual({ kind: 'play', card: 'whoops', on: null });
  });

  it('reads a page of the season\'s news, newest first, and keeps only what the shape holds', async () => {
    const top = [{ character: A, name: 'Spritey', place: 1, standing: 985, shown: [{ kind: 'reveal', act: B, at: '2026-10-03T13:00:00Z', class: 'face' }, { kind: 'odd', act: B, at: 'x' }] }, { name: 'no id' }];
    const h = harness(() => rows([
      { kind: 'results', act: B, thread: C, seq: 1, at: '2026-10-28T12:00:00Z', season: 1, name: null, quote: null, count: 4, detail: { top } },
      { kind: 'tally', act: A, thread: C, seq: 2, at: '2026-10-26T08:00:00Z', season: 1, name: null, quote: null, count: 2,
        detail: { debuts: [{ character: A, name: 'Thwompson' }, { name: 'no id' }], turns: [{ character: B, name: 'Pipewrench', was: 'heel' }] } },
      { kind: 'bossArrived', act: null, thread: null, seq: null, at: '2026-10-28T12:00:00Z', season: 2, name: 'Mister Spreadsheet', quote: null, count: null, detail: null },
    ]));
    const news = await h.api.seasonNews('2026-11-01T00:00:00Z');
    const [req] = h.to('rpc/season_news');
    expect(req?.method).toBe('POST');
    expect(req?.body).toEqual({ before: '2026-11-01T00:00:00Z', most: 20 });
    expect(news.map((n) => n.kind)).toEqual(['results', 'tally', 'bossArrived']);
    expect(news[0]?.top).toEqual([{ character: A, name: 'Spritey', place: 1, standing: 985, shown: [{ kind: 'reveal', act: B, at: '2026-10-03T13:00:00Z', class: 'face', was: null }] }]);
    expect(news[1]?.debuts).toEqual([{ character: A, name: 'Thwompson', class: null, was: null }]);
    expect(news[1]?.turns).toEqual([{ character: B, name: 'Pipewrench', class: null, was: 'heel' }]);
    expect(news[2]).toMatchObject({ act: null, thread: null, seq: null, quote: null, name: 'Mister Spreadsheet', top: [], debuts: [], turns: [] });
  });

  it('counts a character\'s posts, spins and cards from its one counter row, never from its Acts', async () => {
    const h = harness(() => rows([{ character: B, posts: 12, spins: 3, cards: 5 }]));
    expect(await h.api.characterCounts(B)).toEqual({ posts: 12, spins: 3, cards: 5 });
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['character_post_counts']);
    const [req] = h.to('character_post_counts');
    expect(req?.url.searchParams.get('select')).toBe('character,posts,spins,cards');
    expect(req?.url.searchParams.get('character')).toBe(`eq.${B}`);
    // No row: a character that has done nothing, or has not debuted.
    expect(await harness(() => rows([])).api.characterCounts(B)).toEqual({ posts: 0, spins: 0, cards: 0 });
  });

  it('counts a page of characters\' posts in one read of the counters, 0 for each without one', async () => {
    const h = harness(() => rows([{ character: B, posts: 12 }]));
    const stats = await h.api.characterStats([B, A]);
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['character_post_counts']);
    const [req] = h.to('character_post_counts');
    expect(req?.url.searchParams.get('select')).toBe('character,posts');
    expect(req?.url.searchParams.get('character')).toBe(`in.(${B},${A})`);
    expect(stats).toEqual({ [B]: { posts: 12 }, [A]: { posts: 0 } });
    expect(await harness(() => rows([])).api.characterStats([])).toEqual({});
  });

  it('reads the season a screen names through current_season, the season the standings read, never by its number', async () => {
    const h = harness(() => rows([{ id: 4, number: 2, starts_at: '2026-10-01T00:00:00+00:00', ends_at: null, turns_thread: T, reveal_act: null }]));
    expect(await h.api.season()).toEqual({ id: 4, number: 2, startsAt: '2026-10-01T00:00:00+00:00', endsAt: null, turnsThread: T, revealAct: null });
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['current_season']);
    expect(h.to('current_season')[0]?.url.searchParams.has('order')).toBe(false);
    expect(h.to('seasons')).toEqual([]);
    expect(await harness(() => rows([])).api.season()).toBeNull();
  });

  it('reads a page of postbits\' standings through current_standings, which picks the season on the server, 0 for a character with no row, never through the ranking', async () => {
    const h = harness(() => rows([{ character: B, standing: 300 }]));
    expect(await h.api.standingAmounts([B, A])).toEqual({ [B]: 300, [A]: 0 });
    /* One request: the season is standings_season()'s on the server, so the adapter neither reads seasons nor filters by one. */
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['current_standings']);
    const [req] = h.to('current_standings');
    expect(req?.url.searchParams.get('select')).toBe('character,standing');
    expect(req?.url.searchParams.get('character')).toBe(`in.(${B},${A})`);
    expect(req?.url.searchParams.has('season')).toBe(false);
    expect(h.to('standings')).toEqual([]);
    expect(h.to('season_standings')).toEqual([]);
    const none = harness(() => rows([]));
    expect(await none.api.standingAmounts([])).toEqual({});
    expect(none.rest()).toEqual([]);
    /* No season yet: the view has no rows, so every standing is 0. */
    const unseasoned = harness(() => rows([]));
    expect(await unseasoned.api.standingAmounts([B])).toEqual({ [B]: 0 });
  });

  it('reads a profile\'s place with one function call, which counts index ranges and not the season', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/standing_place') ? json({ standing: 300, place: 2, of: 40 }) : json({}, 404)));
    expect(await h.api.standingPlace(B)).toEqual({ standing: 300, place: 2, of: 40 });
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['rpc/standing_place']);
    expect(h.to('rpc/standing_place')[0]?.body).toEqual({ of_character: B });
    expect(await harness(() => json(null)).api.standingPlace(B)).toBeNull();
    const refused = harness(() => json({ message: 'no' }, 400));
    await expect(refused.api.standingPlace(B)).rejects.toThrow();
    expect(await harness(() => json({})).api.standingPlace('not-an-id')).toBeNull();
  });

  it('reads a character\'s reveal posts from acts_public: kind reveal, naming the character, newest first, limited', async () => {
    const h = harness(() => rows([{ ...ACT_ROW, character: null, kind: 'reveal', payload: { character: B } }]));
    const acts = await h.api.characterReveals(B, 7);
    const [req] = h.to('acts_public');
    const p = req?.url.searchParams;
    expect(p?.get('kind')).toBe('eq.reveal');
    expect(p?.get('payload->>character')).toBe(`eq.${B}`);
    expect(p?.get('order')).toBe('created_at.desc');
    expect(p?.get('limit')).toBe('7');
    expect(acts).toHaveLength(1);
    expect(acts[0]?.kind).toBe('reveal');
    expect(await harness(() => rows([])).api.characterReveals('not-an-id')).toEqual([]);
  });

  it('says the season\'s size from the counter of debuted characters, one row, never a count of the standings', async () => {
    const h = harness(() => rows([{ characters: 22 }]));
    expect(await h.api.standingsCount()).toBe(22);
    const [req] = h.to('season_size');
    expect(req?.method).toBe('GET');
    expect(req?.url.searchParams.get('select')).toBe('characters');
    expect(h.rest()).toHaveLength(1);
    expect(await harness(() => rows([])).api.standingsCount()).toBe(0);
  });

  it('reads a page of the standings with one function call that reads the page, never the ranking of the season', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/standings_page') ? json([{ character: B, name: 'Bea', standing: 300, place: 1201 }]) : json({}, 404)));
    expect(await h.api.standingsPage(1200, 50)).toEqual([{ character: B, name: 'Bea', standing: 300, place: 1201 }]);
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['rpc/standings_page']);
    expect(h.to('rpc/standings_page')[0]?.body).toEqual({ page_offset: 1200, page_limit: 50 });
    expect(h.to('season_standings')).toEqual([]);
    /* At most a row cap's worth, whatever is asked; no page asked of no rows; a page past the end is no rows. */
    const capped = harness(() => json([]));
    expect(await capped.api.standingsPage(0, 5000)).toEqual([]);
    expect(capped.to('rpc/standings_page')[0]?.body).toEqual({ page_offset: 0, page_limit: 1000 });
    const none = harness(() => json([]));
    expect(await none.api.standingsPage(0, 0)).toEqual([]);
    expect(none.rest()).toEqual([]);
    const refused = harness(() => json({ message: 'no' }, 400));
    await expect(refused.api.standingsPage(0, 5)).rejects.toThrow();
  });

  it('answers a range past the end with no rows, not an error (PostgREST says 416)', async () => {
    const past = { code: 'PGRST103', message: 'Requested range not satisfiable', details: 'An offset of 99 was requested, but there are only 3 rows.' };
    const h = harness(() => json(past, 416, { 'content-range': '*/3' }));
    expect(await h.api.characterActs(B, ['post'], { offset: 1980, limit: 20 })).toEqual([]);
  });

  it('reads a character\'s Acts as a page with no count: the totals are the counters\' (a profile\'s latest rows and a record\'s pager)', async () => {
    const h = harness(() => rows([ACT_ROW]));
    expect(await h.api.characterActs(B, ['post', 'spin'], { offset: 20, limit: 20 })).toEqual([ACT]);
    const [req] = h.to('acts_public');
    const p = req?.url.searchParams;
    expect(req?.method).toBe('GET');
    expect(req?.headers.get('prefer') ?? '').not.toContain('count');
    expect(p?.get('character')).toBe(`eq.${B}`);
    expect(p?.get('kind')).toBe('in.(post,spin)');
    expect(p?.get('order')).toBe('created_at.desc');
    expect(p?.get('offset')).toBe('20');
    expect(p?.get('limit')).toBe('20');
    expect(await harness(() => rows([])).api.characterActs(B, [], { offset: 0, limit: 5 })).toEqual([]);
  });

  it('reads a thread range from acts_public by seq, leaving edits out and any card a number was given before cards took none', async () => {
    const h = harness(() => rows([ACT_ROW]));
    const acts = await h.api.acts(T, 3, 9);
    const [req] = h.to('acts_public');
    const p = req?.url.searchParams;
    expect(p?.get('thread')).toBe(`eq.${T}`);
    expect(p?.getAll('seq')).toEqual(['gte.3', 'lte.9']);
    expect(p?.get('kind')).toBe('not.in.(edit,card)');
    expect(p?.get('order')).toBe('seq.asc');
    expect(acts).toEqual([ACT]);
  });

  it('reads a post history as the original and its edits, oldest first', async () => {
    const h = harness(() => rows([ACT_ROW]));
    await h.api.history(A);
    const [req] = h.to('acts_public');
    expect(req?.url.searchParams.get('or')).toBe(`(id.eq.${A},and(kind.eq.edit,target_act_id.eq.${A}))`);
    expect(req?.url.searchParams.get('order')).toBe('created_at.asc');
  });

  it('reads the threads spun from several Acts in one request, and the card plays on one Act', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/thread_list') ? rows([{ ...THREAD_ROW, origin_act_id: A }]) : r.url.searchParams.get('kind') === 'eq.card_end' ? rows([]) : rows([{ ...ACT_ROW, kind: 'card', target_act_id: A }])));
    const spun = await h.api.spunFromMany([A, B, A], 50);
    expect(h.to('thread_list')).toHaveLength(1);
    expect(h.to('thread_list')[0]?.url.searchParams.get('origin_act_id')).toBe(`in.(${A},${B})`);
    expect(spun.map((t) => t.originActId)).toEqual([A]);
    const cards = await h.api.cardsOn(A, 21);
    const p = h.to('acts_public')[0]?.url.searchParams;
    expect([p?.get('kind'), p?.get('target_act_id'), p?.get('order')]).toEqual(['in.(card,set,spring)', `eq.${A}`, 'created_at.asc']);
    expect(cards.map((c) => c.kind)).toEqual(['card']);
    /* The plays' ends (an admin's reversal, 0092) are read by the plays' ids, in a request of their own. */
    expect(h.to('acts_public')).toHaveLength(2);
    expect([h.to('acts_public')[1]?.url.searchParams.get('kind'), h.to('acts_public')[1]?.url.searchParams.get('target_act_id')]).toEqual(['eq.card_end', `in.(${A})`]);
    expect(await h.api.spunFromMany(['x),y'], 5)).toEqual([]);
    expect(await h.api.cardsOn('x),y', 5)).toEqual([]);
    expect(h.to('acts_public')).toHaveLength(2);
    expect(h.to('thread_list')).toHaveLength(1);
  });

  it('reads the card plays on a page of posts in one request, oldest first, bounded, and never filters on a non-id', async () => {
    const END = { ...ACT_ROW, id: C, character: null, kind: 'card_end', seq: null, target_act_id: A, payload: { why: 'reversed', by: 'admin' } };
    const h = harness((r) => (r.url.searchParams.get('kind') === 'eq.card_end' ? rows([END]) : rows([{ ...ACT_ROW, kind: 'card', seq: null, target_act_id: A }, { ...ACT_ROW, id: B, kind: 'card', seq: null, target_act_id: C }])));
    const plays = await h.api.cardsOnMany([A, C, A, 'x),y'], 60);
    /* The plays, then the ends of those plays in a request of their own, by the plays' ids. */
    expect(h.to('acts_public')).toHaveLength(2);
    expect(h.to('acts_public')[1]?.url.searchParams.get('kind')).toBe('eq.card_end');
    const p = h.to('acts_public')[0]?.url.searchParams;
    expect([p?.get('kind'), p?.get('target_act_id'), p?.get('order'), p?.get('limit')]).toEqual(['in.(card,set,spring)', `in.(${A},${C})`, 'created_at.asc', '60']);
    /* A reversed play is marked by its end riding in the same list (kind card_end, naming the play). */
    expect(plays.map((c) => [c.kind, c.seq, c.targetActId])).toEqual([['card', null, A], ['card', null, C], ['card_end', null, A]]);
    expect(await h.api.cardsOnMany([], 5)).toEqual([]);
    expect(await h.api.cardsOnMany(['x),y'], 5)).toEqual([]);
    expect(h.to('acts_public')).toHaveLength(2);
    await h.api.cardsOnMany([A], 5000);
    expect(h.to('acts_public')[2]?.url.searchParams.get('limit')).toBe('1000');
  });

  it('reads the saved effect states of plays in one request, and the reader\'s own releases from their own rows', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/effect_state')
      ? rows([{ play: A, state: { strokes: [1] }, saved_at: '2026-10-29T00:00:00+00:00' }])
      : rows([{ play: B }])));
    expect(await h.api.effectStates([A, B, 'x),y'])).toEqual({ [A]: { state: { strokes: [1] }, savedAt: '2026-10-29T00:00:00+00:00' } });
    const state = h.to('effect_state')[0]?.url.searchParams;
    expect([state?.get('select'), state?.get('play')]).toEqual(['play,state,saved_at', `in.(${A},${B})`]);
    expect(await h.api.myReleases([B, 'x),y'])).toEqual([B]);
    const released = h.to('effect_releases')[0]?.url.searchParams;
    expect([released?.get('select'), released?.get('play')]).toEqual(['play', `in.(${B})`]);
    expect(await h.api.effectStates([])).toEqual({});
    expect(await h.api.myReleases(['x),y'])).toEqual([]);
    expect(h.to('effect_state')).toHaveLength(1);
    expect(h.to('effect_releases')).toHaveLength(1);
  });

  it('limits every list read of spins and card plays: ordered, and never more than the row cap', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/thread_list') ? rows([{ ...THREAD_ROW, origin_act_id: A }]) : r.url.searchParams.get('kind') === 'eq.card_end' ? rows([]) : rows([{ ...ACT_ROW, kind: 'card', target_act_id: A }])));
    await h.api.spunFromMany([A, B], 120);
    await h.api.spunFrom(A);
    await h.api.spunFromMany([A], 5000);
    await h.api.cardsOn(A, 21);
    const spun = h.to('thread_list').map((r) => [r.url.searchParams.get('order'), r.url.searchParams.get('limit')]);
    expect(spun).toEqual([['created_at.asc', '120'], ['created_at.asc', '200'], ['created_at.asc', '1000']]);
    expect([h.to('acts_public')[0]?.url.searchParams.get('order'), h.to('acts_public')[0]?.url.searchParams.get('limit')]).toEqual(['created_at.asc', '21']);
  });

  it('refuses to put a non-id into a filter', async () => {
    const h = harness(() => rows([ACT_ROW]));
    expect(await h.api.history('x),id.neq.(y')).toEqual([]);
    expect(h.rest()).toEqual([]);
  });

  it('joins characters_public with character_profiles in two reads and defaults an absent profile', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/characters_public')) return rows([{ id: B, name: 'Bea', joined: '2026-10-01' }, { id: A, name: 'Al', joined: '2026-09-01' }]);
      return rows([{ character: B, title: 'Champ', signature: '[b]hi[/b]', avatar_square: 'sq.webp', avatar_portrait: 'po.webp', square_frame: { x: 0, y: 0, w: 0.5, h: 0.5 }, portrait_frame: null, pip_style: 'fancy' }]);
    });
    const list = await h.api.characters([B, A]);
    expect(h.to('characters_public')[0]?.url.searchParams.get('id')).toBe(`in.(${B},${A})`);
    expect(h.to('character_profiles')[0]?.url.searchParams.get('character')).toBe(`in.(${B},${A})`);
    expect(list).toEqual([
      { id: B, name: 'Bea', title: 'Champ', signature: '[b]hi[/b]', avatarSquare: `${URL_}/storage/v1/object/public/avatars/sq.webp`, avatarPortrait: `${URL_}/storage/v1/object/public/avatars/po.webp`, squareFrame: { x: 0, y: 0, w: 0.5, h: 0.5 }, portraitFrame: null, pipStyle: 'fancy', joined: '2026-10-01' },
      { id: A, name: 'Al', title: '', signature: '', avatarSquare: null, avatarPortrait: null, squareFrame: null, portraitFrame: null, pipStyle: 'default', joined: '2026-09-01' },
    ]);
  });

  it('builds the board index from boards_now (the names as Acts say them now) and thread_list', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/boards_now')) return rows([{ id: C, slug: 'general', name: 'General', description: 'All', is_system: false, created_at: 'x' }]);
      if (r.url.pathname.endsWith('/board_counts')) return rows([{ board: C, threads: 12 }]);
      return rows([THREAD_ROW]);
    });
    const [board] = await h.api.boards();
    expect(h.to('boards_now')[0]?.url.searchParams.get('select')).toBe('id,slug,name,description,is_system,move_act');
    expect(h.to('board_counts')[0]?.url.searchParams.get('select')).toBe('board,threads');
    expect(h.to('thread_list').every((r) => r.method === 'GET' && !(r.headers.get('prefer') ?? '').includes('count'))).toBe(true);
    expect(board).toEqual({ id: C, slug: 'general', name: 'General', description: 'All', isSystem: false, moveAct: null, threadCount: 12, lastAt: '2026-10-01T10:00:00+00:00', lastCharacter: B, lastThread: T });
    const latest = h.to('thread_list').find((r) => r.method === 'GET');
    expect(latest?.url.searchParams.get('order')).toBe('last_at.desc');
    expect(latest?.url.searchParams.get('limit')).toBe('1');
  });

  it('maps my_characters, with a pending Turn only when one is waiting', async () => {
    const base = { name: 'Bea', class: 'face', class_since: '2026-09-01T00:00:00+00:00', turn_opens_at: null, debuted_at: '2026-09-02T00:00:00+00:00', debut_loudness: 'silent', retired_at: null, pending_class: null, pending_loudness: null, pending_show_from: null, pending_show_to: null, takes_effect_at: null, presence_hidden: false, class_due_at: null };
    const h = harness(() => rows([{ id: B, ...base }, { id: A, ...base, name: 'Al', presence_hidden: true, class_due_at: '2026-10-31T00:00:00+00:00', pending_class: 'heel', pending_loudness: 'announced', pending_show_from: true, pending_show_to: false, takes_effect_at: '2026-11-01T00:00:00+00:00' }]));
    const mine = await h.api.myCharacters();
    expect(h.rest().map((r) => r.url.pathname)).toEqual(['/rest/v1/my_characters']);
    expect(mine[0]).toEqual({ id: B, name: 'Bea', class: 'face', classSince: '2026-09-01T00:00:00+00:00', classDueAt: null, turnOpensAt: null, debutedAt: '2026-09-02T00:00:00+00:00', debutLoudness: 'silent', retiredAt: null, pendingTurn: null, presenceHidden: false });
    expect(mine[1]?.presenceHidden).toBe(true);
    // When a Turn that waited past a reveal was due (0074): a wiring no other test holds (#179).
    expect(mine[1]?.classDueAt).toBe('2026-10-31T00:00:00+00:00');
    expect(mine[1]?.pendingTurn).toEqual({ class: 'heel', loudness: 'announced', showFrom: true, showTo: false, takesEffectAt: '2026-11-01T00:00:00+00:00' });
  });

  it('reads the wallet from my_wallet and the cap from settings when there is no row', async () => {
    expect(await harness(() => rows([{ balance: 250, cap: 500 }])).api.wallet()).toEqual({ balance: 250, cap: 500 });
    const h = harness((r) => (r.url.pathname.endsWith('/screen_settings') ? rows([{ settings: { walletCap: 700 } }]) : rows([])));
    expect(await h.api.wallet()).toEqual({ balance: 0, cap: 700 });
  });

  it('answers preferences with the defaults when no row exists', async () => {
    const h = harness(() => rows([]));
    expect(await h.api.preferences()).toEqual({ theme: 'system', postbit: 'side', motion: 'system', smoke: 'full', contrast: 'standard', textSize: 100, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] });
  });

  it('reads the glass\'s three preferences from their columns and sends them to set_preferences by its parameter names', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/set_preferences')) return json({ theme: 'dark', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'high', text_size: 200, cards_met: ['whoops'] });
      return rows([{ theme: 'dark', postbit: 'side', motion: 'system', smoke: 'low', contrast: 'high', text_size: 150 }]);
    });
    expect(await h.api.preferences()).toEqual({ theme: 'dark', postbit: 'side', motion: 'system', smoke: 'low', contrast: 'high', textSize: 150, cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] });
    expect(h.to('account_preferences')[0]?.url.searchParams.get('select')).toBe('theme,postbit,motion,smoke,contrast,text_size,cards_met,alerts_seen_at,settlement_seen,toasts,welcomed_at,tips,tips_seen');
    expect(await h.api.setPreferences({ smoke: 'off', contrast: 'high', textSize: 200 })).toEqual({ ok: true, value: { theme: 'dark', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'high', textSize: 200, cardsMet: ['whoops'], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } });
    expect(h.to('rpc/set_preferences')[0]?.body).toEqual({ theme: null, postbit: null, motion: null, smoke: 'off', contrast: 'high', text_size: 200, toasts: null, toasts_default: false });
  });

  it('reads the kinds that toast (null where never chosen, an empty list where chosen so), drops a kind it does not know, and sends a choice or a reset by set_preferences\' parameter names', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/set_preferences')) return json({ theme: 'system', postbit: 'side', motion: 'system', smoke: 'full', contrast: 'standard', text_size: 100, cards_met: [], toasts: ['quote', 'someday'] });
      return rows([{ theme: 'system', toasts: [] }]);
    });
    expect((await h.api.preferences()).toasts).toEqual([]);
    expect(await h.api.setPreferences({ toasts: ['quote', 'someday' as never] })).toMatchObject({ ok: true, value: { toasts: ['quote'] } });
    expect(h.to('rpc/set_preferences')[0]?.body).toMatchObject({ toasts: ['quote', 'someday'], toasts_default: false });
    await h.api.setPreferences({ toasts: null });
    expect(h.to('rpc/set_preferences')[1]?.body).toMatchObject({ toasts: null, toasts_default: true });
    await h.api.setPreferences({ smoke: 'low' });
    expect(h.to('rpc/set_preferences')[2]?.body).toMatchObject({ toasts: null, toasts_default: false });
  });

  it('reads the account\'s two marks and moves them by see_alerts and see_settlement, answering the mark as it stands', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/see_alerts')) return json({ seen: '2026-10-29T08:17:00+00:00' });
      if (r.url.pathname.endsWith('/rpc/see_settlement')) return json({ seen: '2026-10-30T08:17:00+00:00' });
      return rows([{ alerts_seen_at: '2026-10-29T08:17:00+00:00', settlement_seen: '2026-10-30T08:17:00+00:00' }]);
    });
    expect(await h.api.preferences()).toMatchObject({ alertsSeenAt: '2026-10-29T08:17:00+00:00', settlementSeen: '2026-10-30T08:17:00+00:00' });
    expect(await h.api.seeAlerts('2026-10-01T00:00:00Z')).toEqual({ ok: true, value: '2026-10-29T08:17:00+00:00' });
    expect(await h.api.seeSettlement('2026-10-30T08:17:00Z')).toEqual({ ok: true, value: '2026-10-30T08:17:00+00:00' });
    expect(h.to('rpc/see_alerts')[0]?.body).toEqual({ at: '2026-10-01T00:00:00Z' });
    expect(h.to('rpc/see_settlement')[0]?.body).toEqual({ ends_at: '2026-10-30T08:17:00Z' });
  });

  it('reads when the account was opened through my_account_opened, and rejects when it answers none', async () => {
    let answer: unknown = '2026-10-29T08:17:00+00:00';
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/my_account_opened') ? json(answer) : undefined));
    expect(await h.api.accountOpenedAt()).toBe('2026-10-29T08:17:00+00:00');
    expect(h.to('rpc/my_account_opened')).toHaveLength(1);
    answer = null;
    await expect(h.api.accountOpenedAt()).rejects.toThrow();
  });

  it('reads the Alerts through my_alerts, a page at a time from a cursor, and the count through my_alerts_unread, bounded', async () => {
    const written = { kind: 'quote', sub: null, act: A, character: B, at: '2026-10-29T08:17:00+00:00', thread: T, name: 'Ana Face', title: 'A title', count: null };
    const followed = { kind: 'followed', sub: null, act: null, character: null, at: '2026-10-29T09:00:00+00:00', thread: T, name: null, title: 'A title', count: 4 };
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/my_alerts')) return json([followed, written, { ...written, kind: 'someFutureKind' }]);
      if (r.url.pathname.endsWith('/rpc/my_alerts_unread')) return json(r.method === 'POST' ? 27 : 0);
      return undefined;
    });
    expect(await h.api.alerts()).toEqual([
      { kind: 'followed', sub: null, act: null, character: null, at: '2026-10-29T09:00:00+00:00', thread: T, name: null, title: 'A title', count: 4 },
      { kind: 'quote', sub: null, act: A, character: B, at: '2026-10-29T08:17:00+00:00', thread: T, name: 'Ana Face', title: 'A title', count: null },
    ]);
    await h.api.alerts('2026-10-29T08:17:00+00:00');
    expect(h.to('rpc/my_alerts').map((r) => r.body)).toEqual([{ before: null, most: 30 }, { before: '2026-10-29T08:17:00+00:00', most: 30 }]);
    /* A server that answered more than the bound is still read at it. */
    expect(await h.api.alertsUnread()).toBe(10);
  });

  it('reads whether a settlement moved the caller through my_settlement_moved: its count and time, and null for no row', async () => {
    const h = harness((r) => {
      if (!r.url.pathname.endsWith('/rpc/my_settlement_moved')) return undefined;
      const id = (r.body as { settlement: string }).settlement;
      return json(id === '7' ? [{ count: 2, applied_at: '2026-11-02T08:00:01+00:00' }] : []);
    });
    expect(await h.api.settlementMoved('7')).toEqual({ count: 2, at: '2026-11-02T08:00:01+00:00' });
    expect(await h.api.settlementMoved('8')).toBeNull();
    expect(await h.api.settlementMoved('x')).toBeNull();
    expect(h.to('rpc/my_settlement_moved').map((r) => r.body)).toEqual([{ settlement: '7' }, { settlement: '8' }, { settlement: 'x' }]);
  });

  it('rejects settlementMoved when the read fails', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/my_settlement_moved') ? json({ message: 'down' }, 500) : undefined));
    await expect(h.api.settlementMoved('7')).rejects.toThrow();
  });

  it('maps the marks an answer carries (set_preferences, meet_card) into the preferences', async () => {
    const marks = { alerts_seen_at: '2026-10-29T08:17:00+00:00', settlement_seen: '2026-10-30T08:17:00+00:00' };
    const h = harness((r) => json({ theme: 'dark', postbit: 'side', motion: 'system', smoke: 'low', contrast: 'high', text_size: 150, cards_met: ['whoops'], ...marks }));
    const want = { ok: true, value: { theme: 'dark', postbit: 'side', motion: 'system', smoke: 'low', contrast: 'high', textSize: 150, cardsMet: ['whoops'], alertsSeenAt: marks.alerts_seen_at, settlementSeen: marks.settlement_seen, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] } };
    expect(await h.api.setPreferences({ smoke: 'low' })).toEqual(want);
    expect(await h.api.meetCard('whoops')).toEqual(want);
  });

  it('reads the tips from their columns and calls the six tip functions by their names', async () => {
    const mine = { theme: 'system', postbit: 'side', motion: 'system', smoke: 'full', contrast: 'standard', text_size: 100, cards_met: [] };
    const answer = { ...mine, welcomed_at: '2026-11-02T10:00:00+00:00', tips: 'off', tips_seen: ['grid'] };
    const h = harness((r) => (r.url.pathname.includes('/rpc/') ? json(answer) : rows([answer])));
    const want = { welcomedAt: '2026-11-02T10:00:00+00:00', tips: 'off', tipsSeen: ['grid'] };
    expect(await h.api.preferences()).toMatchObject(want);
    expect(await h.api.seeWelcome()).toMatchObject({ ok: true, value: want });
    expect(await h.api.seeTip('grid')).toMatchObject({ ok: true, value: want });
    expect(h.to('rpc/see_tip')[0]?.body).toEqual({ key: 'grid' });
    expect(await h.api.skipTips()).toMatchObject({ ok: true, value: want });
    expect(await h.api.resumeTips()).toMatchObject({ ok: true, value: want });
    expect(await h.api.restoreTips()).toMatchObject({ ok: true, value: want });
    expect(await h.api.replayTour()).toMatchObject({ ok: true, value: want });
    for (const f of ['see_welcome', 'skip_tips', 'resume_tips', 'restore_tips', 'replay_tour']) expect(h.to(`rpc/${f}`)).toHaveLength(1);
    /* A row without the columns (an older server) is the defaults. */
    const old = harness(() => rows([mine]));
    expect(await old.api.preferences()).toMatchObject({ welcomedAt: null, tips: 'on', tipsSeen: [] });
  });

  it('reads the cards met from their column and calls meet_card by its parameter name', async () => {
    const mine = { theme: 'system', postbit: 'side', motion: 'system', smoke: 'full', contrast: 'standard', text_size: 100 };
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/meet_card')) return json({ ...mine, cards_met: ['whoops', 'stick-around'] });
      return rows([{ ...mine, cards_met: ['whoops'] }]);
    });
    expect((await h.api.preferences()).cardsMet).toEqual(['whoops']);
    expect(await h.api.meetCard('stick-around')).toMatchObject({ ok: true, value: { cardsMet: ['whoops', 'stick-around'] } });
    expect(h.to('rpc/meet_card')[0]?.body).toEqual({ card: 'stick-around' });
  });

  it('returns a meet_card refusal as the server\'s own words', async () => {
    const h = harness(() => json({ code: '22023', message: 'at most 64 cards are kept as met', hint: 'kayfabb.refusal' }, 400));
    expect(await h.api.meetCard('one-too-many')).toEqual({ ok: false, error: 'at most 64 cards are kept as met' });
  });

  it('keys tallies, view counts and reading by id', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/reaction_tallies')) return rows([{ act: A, kind: 'fire', count: 3 }, { act: A, kind: 'facepalm', count: 1 }]);
      if (r.url.pathname.endsWith('/thread_view_counts')) return rows([{ thread: T, views: 9 }]);
      return rows([{ thread: T, furthest_seq: 4 }]);
    });
    expect(await h.api.tallies([A, B])).toEqual({ [A]: { fire: 3, facepalm: 1 }, [B]: {} });
    expect(await h.api.viewCounts([T])).toEqual({ [T]: 9 });
    expect(await h.api.reading([T])).toEqual({ [T]: 4 });
  });

  /* #86: the prices the server charges now reach the screens, which lay them over the compiled economy (engine/ui/cards/faces.ts). */
  it('reads the cards\' economy the server prices with, and holds none where the view has none', async () => {
    const h = harness(() => rows([{ settings: { cardEconomy: { 'whoops.price': 250, 'whoops.perLength': 40 } } }]));
    expect((await h.api.settings()).cardEconomy).toEqual({ 'whoops.price': 250, 'whoops.perLength': 40 });
    expect((await harness(() => rows([{ settings: { walletCap: 900 } }])).api.settings()).cardEconomy).toEqual({});
  });

  it('fills a missing settings key from the instance fallback and uses what the view holds', async () => {
    const h = harness(() => rows([{ settings: { walletCap: 900, registrationMode: 'open', editGrace: { unit: 'minute', count: 5 }, reactionCap: null } }]));
    expect(await h.api.settings()).toEqual({ ...FALLBACK, walletCap: 900, registrationMode: 'open', editGrace: { unit: 'minute', count: 5 } });
    expect(await harness(() => rows([])).api.settings()).toEqual(FALLBACK);
  });
});

describe('a visitor\'s calls', () => {
  it('carry the publishable key in apikey and no Authorization: the settings read, a board read and the account function', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/screen_settings')) return rows([{ settings: {} }]);
      if (r.url.pathname === '/functions/v1/account') return json({ ok: true });
      return rows([]);
    });
    await h.api.settings();
    await h.api.boards();
    await h.api.requestCode('a@b.c', null).catch(() => undefined);
    expect(h.log.length).toBeGreaterThanOrEqual(3);
    expect(h.log.some((r) => r.url.pathname === '/functions/v1/account')).toBe(true);
    for (const r of h.log) {
      expect(r.headers.get('apikey'), r.url.pathname).toBe(PUBLISHABLE);
      expect(r.headers.get('authorization'), r.url.pathname).toBeNull();
    }
  });
});

describe('failures', () => {
  it('passes an act refusal through with its field', async () => {
    const h = harness(() => json({ field: 'body', error: 'body is empty' }, 400));
    expect(await h.api.post(T, B, ' ', null)).toEqual({ ok: false, error: 'body is empty', field: 'body' });
  });

  it('passes an rpc refusal through by its hint, and quotes nothing else', async () => {
    const refused = harness(() => json({ code: '22023', message: 'a title is at most 40 characters', details: null, hint: 'kayfabb.refusal' }, 400));
    expect(await refused.api.setProfile(B, 'x'.repeat(41), '', 'default')).toEqual({ ok: false, error: 'a title is at most 40 characters' });
    const broken = harness(() => json({ code: '23503', message: 'insert on table "characters" violates foreign key constraint "characters_owner_fkey"', details: 'Key (owner)=(1) is not present', hint: null }, 409));
    const r = await broken.api.setProfile(B, 't', 's', 'default');
    expect(r.ok).toBe(false);
    const words = JSON.stringify(r);
    for (const leak of ['characters', 'constraint', 'owner', 'Key', '23503', 'violates']) expect(words).not.toContain(leak);
  });

  it('retries a read once on a 5xx and once on a thrown fetch, then gives up', async () => {
    const flaky = harness((_r, n) => (n === 1 ? json({ message: 'down' }, 503) : rows([ACT_ROW])));
    expect(await flaky.api.act(A)).toEqual(ACT);
    expect(flaky.to('acts_public')).toHaveLength(2);

    const thrown = harness((_r, n) => (n === 1 ? new TypeError('network') : rows([ACT_ROW])));
    expect(await thrown.api.act(A)).toEqual(ACT);
    expect(thrown.to('acts_public')).toHaveLength(2);

    const dead = harness(() => json({ message: 'down' }, 502));
    await expect(dead.api.act(A)).rejects.toThrow();
    expect(dead.to('acts_public')).toHaveLength(2);
    const err = await dead.api.act(A).catch((e: Error) => e.message);
    expect(err).not.toContain('down');
  });

  it('reads Acts by id in one acts_public read', async () => {
    const h = harness(() => rows([ACT_ROW]));
    expect(await h.api.actsById([A, B])).toEqual([ACT]);
    expect(h.to('acts_public')).toHaveLength(1);
    expect(h.to('acts_public')[0]?.url.searchParams.get('id')).toBe(`in.(${A},${B})`);
    expect(await h.api.actsById(['not an id', "1),(2"])).toEqual([]);
    expect(await h.api.actsById([])).toEqual([]);
    expect(h.to('acts_public')).toHaveLength(1);
  });

  it('does not retry a read the server refused', async () => {
    const h = harness(() => json({ code: '42501', message: 'permission denied for table x', hint: null }, 403));
    await expect(h.api.act(A)).rejects.toThrow();
    expect(h.to('acts_public')).toHaveLength(1);
  });

  it('never resends a write: a 503 passes its words through, a thrown fetch says it may have gone through', async () => {
    const words = 'no answer came back, so this may have gone through: look before you try again';
    const lost = harness(() => json({ error: words }, 503));
    expect(await lost.api.post(T, B, 'hi', null)).toEqual({ ok: false, error: words, uncertain: true });
    expect(lost.log.filter((r) => r.url.pathname === '/functions/v1/act')).toHaveLength(1);

    const thrown = harness(() => new TypeError('network'));
    const r = await thrown.api.react(A, B, 'fire');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('may have gone through');
    expect(r.ok === false && r.uncertain).toBe(true);
    expect(thrown.log.filter((x) => x.url.pathname === '/functions/v1/act')).toHaveLength(1);

    const rpcDown = harness(() => json({ message: 'down' }, 503));
    const down = await rpcDown.api.setPreferences({ theme: 'dark' });
    expect(down.ok === false && down.uncertain).toBe(true);
    /* A refusal in the server's words is no lost answer. */
    const refused = harness(() => json({ error: 'you cannot do that' }, 409));
    expect(await refused.api.post(T, B, 'hi', null)).toEqual({ ok: false, error: 'you cannot do that' });
    expect(rpcDown.to('rpc/set_preferences')).toHaveLength(1);
  });
});

describe('writes through the act function', () => {
  const act = (h: ReturnType<typeof harness>) => h.log.filter((r) => r.url.pathname === '/functions/v1/act');

  it('sends each action as its own JSON body with the publishable key in apikey, and no Authorization signed out', async () => {
    const h = harness((r) => {
      if (r.url.pathname === '/functions/v1/act') {
        const a = (r.body as { action: string }).action;
        if (a === 'react') return json({ act: A, thread: T, tally: { fire: 1 } });
        if (a === 'startThread') return json({ thread: { id: T, board: C, title: 'A title', origin_act_id: null, created_at: '2026-10-01T09:00:00+00:00' }, act: ACT_ROW });
        return json(ACT_ROW);
      }
      return undefined;
    });
    expect(await h.api.post(T, B, 'hi', A)).toEqual({ ok: true, value: ACT });
    expect(await h.api.post(T, B, 'hi', null)).toEqual({ ok: true, value: ACT });
    expect(await h.api.edit(A, B, 'new')).toEqual({ ok: true, value: ACT });
    expect(await h.api.react(A, B, 'fire')).toEqual({ ok: true, value: { act: A, tally: { fire: 1 } } });
    const started = await h.api.startThread('general', B, 'A title', 'body');
    expect(started).toEqual({ ok: true, value: { thread: { id: T, board: C, title: 'A title', originActId: null, createdAt: '2026-10-01T09:00:00+00:00', lastAt: ACT.createdAt, lastSeq: 2, firstAct: A, firstCharacter: B, lastAct: A, lastCharacter: B, replies: 0, repliesThisWeek: 0, originThread: null, origin: null }, act: ACT } });
    expect(act(h).map((r) => r.body)).toEqual([
      { action: 'post', thread: T, character: B, body: 'hi', quote: A },
      { action: 'post', thread: T, character: B, body: 'hi' },
      { action: 'edit', post: A, character: B, body: 'new' },
      { action: 'react', act: A, character: B, kind: 'fire' },
      { action: 'startThread', board: 'general', character: B, title: 'A title', body: 'body' },
    ]);
    for (const r of act(h)) {
      expect(r.method).toBe('POST');
      expect(r.headers.get('apikey')).toBe(PUBLISHABLE);
      expect(r.headers.get('authorization')).toBeNull();
      expect(r.url.search).toBe('');
    }
  });

  it('maps the Turn, character and invite answers', async () => {
    const h = harness((r) => {
      const a = (r.body as { action: string }).action;
      if (a === 'turn') return json({ pending: true, class: 'heel', loudness: 'announced', show_from: true, show_to: false, takes_effect_at: null });
      if (a === 'createCharacter') return json({ id: B, name: 'Bea', class: 'face', waiting: true, loudness: 'announced', announcement: null });
      if (a === 'setDebut') return json({ id: B, waiting: false, loudness: 'silent', announcement: null });
      if (a === 'withdrawTurn') return json({ withdrawn: true });
      if (a === 'createInvite' || a === 'reissueInvite') return json({ invite: 7, code: 'abc' });
      if (a === 'openAccount') return json({ account: A, opened: true });
      return json(ACT_ROW);
    });
    expect(await h.api.turn(B, 'heel', 'announced', true, false)).toEqual({ ok: true, value: { class: 'heel', loudness: 'announced', showFrom: true, showTo: false, takesEffectAt: null } });
    expect(await h.api.createCharacter('Bea', 'face', 'tally', 'announced')).toEqual({ ok: true, value: { id: B, name: 'Bea', class: 'face', waiting: true, loudness: 'announced' } });
    expect(await h.api.setDebut(B, 'now', 'silent')).toEqual({ ok: true, value: { id: B, waiting: false, loudness: 'silent' } });
    expect(await h.api.withdrawTurn(B)).toEqual({ ok: true, value: { withdrawn: true } });
    expect(await h.api.createInvite()).toEqual({ ok: true, value: { invite: 7, code: 'abc' } });
    expect(await h.api.reissueInvite(7)).toEqual({ ok: true, value: { invite: 7, code: 'abc' } });
    expect(await h.api.openAccount('code')).toEqual({ ok: true, value: { opened: true } });
    expect(act(h).map((r) => r.body)).toEqual([
      { action: 'turn', character: B, class: 'heel', loudness: 'announced', showFrom: true, showTo: false },
      { action: 'createCharacter', name: 'Bea', class: 'face', timing: 'tally', loudness: 'announced' },
      { action: 'setDebut', character: B, timing: 'now', loudness: 'silent' },
      { action: 'withdrawTurn', character: B },
      { action: 'createInvite' },
      { action: 'reissueInvite', invite: 7 },
      { action: 'openAccount', invite: 'code' },
    ]);
  });
});

describe('a card\'s effect', () => {
  it('releases through the release_effect function and says when', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/release_effect') ? json({ play: A, released_at: '2026-10-30T10:00:00+00:00' }) : json({}, 404)));
    expect(await h.api.releaseEffect(A)).toEqual({ ok: true, value: { play: A, releasedAt: '2026-10-30T10:00:00+00:00' } });
    expect(h.to('rpc/release_effect')[0]?.body).toEqual({ play: A });
    const refused = harness((r) => (r.url.pathname.endsWith('/rpc/release_effect') ? json({ code: 'P0002', message: 'there is no such card on a post', hint: 'kayfabb.refusal' }, 404) : json({}, 404)));
    expect(await refused.api.releaseEffect(A)).toEqual({ ok: false, error: 'there is no such card on a post' });
    /* Never resent: a lost answer is the player's to look at. */
    const lost = harness(() => new Error('network'));
    expect((await lost.api.releaseEffect(A)).ok).toBe(false);
    expect(lost.to('rpc/release_effect')).toHaveLength(1);
  });

  it('saves the state through the act function as the post\'s author, and says when', async () => {
    const h = harness((r) => (r.url.pathname === '/functions/v1/act' ? json({ play: A, thread: T, state: { strokes: [] }, saved_at: '2026-10-30T10:00:00+00:00' }) : undefined));
    expect(await h.api.saveEffect(A, B, { strokes: [] })).toEqual({ ok: true, value: { play: A, savedAt: '2026-10-30T10:00:00+00:00' } });
    expect(h.log.filter((r) => r.url.pathname === '/functions/v1/act').map((r) => r.body)).toEqual([{ action: 'saveEffect', character: B, play: A, state: { strokes: [] } }]);
    const refused = harness((r) => (r.url.pathname === '/functions/v1/act' ? json({ error: 'only the post\'s author saves what is on it' }, 403) : undefined));
    expect(await refused.api.saveEffect(A, B, {})).toEqual({ ok: false, error: 'only the post\'s author saves what is on it' });
  });
});

describe('buying and playing a card', () => {
  it('buys through the act function, naming the card and no price, and reads the wallet and count the function answers', async () => {
    const h = harness((r) => (r.url.pathname === '/functions/v1/act' ? json({ card: 'whoops', balance: 462, held: 3 }) : undefined));
    expect(await h.api.buyCard('whoops')).toEqual({ ok: true, value: { card: 'whoops', balance: 462, held: 3 } });
    expect(h.log.filter((r) => r.url.pathname === '/functions/v1/act').map((r) => r.body)).toEqual([{ action: 'buyCard', card: 'whoops' }]);
    const refused = harness((r) => (r.url.pathname === '/functions/v1/act' ? json({ error: 'that costs 100, and your wallet holds 62' }, 400) : undefined));
    expect(await refused.api.buyCard('whoops')).toEqual({ ok: false, error: 'that costs 100, and your wallet holds 62' });
    /* Never resent: a lost answer may have spent the Aura, and the player looks before they buy again. */
    const lost = harness(() => new Error('network'));
    const gone = await lost.api.buyCard('whoops');
    expect(gone.ok === false && gone.uncertain).toBe(true);
    expect(lost.log.filter((r) => r.url.pathname === '/functions/v1/act')).toHaveLength(1);
  });

  it('plays through the act function with the card, the character, the post, the settings and the message, and reads the card\'s Act', async () => {
    const h = harness((r) => (r.url.pathname === '/functions/v1/act' ? json(ACT_ROW) : undefined));
    expect(await h.api.playCard('whoops', B, A, { color: 'magenta' }, 'you dropped your ink')).toEqual({ ok: true, value: ACT });
    expect(h.log.filter((r) => r.url.pathname === '/functions/v1/act').map((r) => r.body)).toEqual([
      { action: 'playCard', card: 'whoops', character: B, target: A, config: { color: 'magenta' }, message: 'you dropped your ink' },
    ]);
    const refused = harness((r) => (r.url.pathname === '/functions/v1/act' ? json({ error: 'you hold no "whoops" card; the Vending Machine sells them' }, 400) : undefined));
    expect(await refused.api.playCard('whoops', B, A, {}, '')).toEqual({ ok: false, error: 'you hold no "whoops" card; the Vending Machine sells them' });
  });
});

describe('signing in goes through the account function', () => {
  it('requests a code and verifies it there, installs the session it carries, and never calls Auth for a code', async () => {
    const h = harness((r) => {
      if (r.url.pathname === '/functions/v1/account') {
        return (r.body as { action: string }).action === 'requestCode' ? json({ message: 'If this address can sign in...', invite: 'that invite opens nothing, so no new login is made with it' }, 202) : json({ session: SESSION, account: true });
      }
      if (r.url.pathname === '/auth/v1/user') return json(SESSION.user);
      if (r.url.pathname === '/rest/v1/rpc/whoami') return json(A);
      return undefined;
    });
    expect(await h.api.requestCode(' a@b.c ', 'inv')).toEqual({ ok: true, value: { message: 'If this address can sign in...', invite: 'that invite opens nothing, so no new login is made with it' } });
    expect(await h.api.verifyCode('a@b.c', '123456')).toEqual({ ok: true, value: { account: true } });
    expect(h.log.filter((r) => r.url.pathname === '/functions/v1/account').map((r) => r.body)).toEqual([
      { action: 'requestCode', email: ' a@b.c ', invite: 'inv' },
      { action: 'verifyCode', email: 'a@b.c', code: '123456' },
    ]);
    expect(await h.api.session()).toEqual({ signedIn: true, account: A });
    expect(h.to('rpc/whoami')[0]?.headers.get('authorization')).toBe(`Bearer ${JWT}`);
    expect(h.log.some((r) => /\/auth\/v1\/(otp|verify|recover|signup|magiclink)/.test(r.url.pathname))).toBe(false);
  });

  it('passes a wrong code through with its field and says why an account stayed closed', async () => {
    const wrong = harness(() => json({ field: 'code', error: 'that code does not match, or it has expired: ask for a new one' }, 400));
    expect(await wrong.api.verifyCode('a@b.c', '000000')).toEqual({ ok: false, error: 'that code does not match, or it has expired: ask for a new one', field: 'code' });
    const closed = harness((r) => (r.url.pathname === '/auth/v1/user' ? json(SESSION.user) : json({ session: SESSION, account: false, why: 'registration is closed; when an admin opens it again, your next sign-in opens your account' })));
    expect(await closed.api.verifyCode('a@b.c', '123456')).toEqual({ ok: true, value: { account: false, why: 'registration is closed; when an admin opens it again, your next sign-in opens your account' } });
  });

  it('is signed out with no account call when there is no session', async () => {
    const h = harness(() => undefined);
    expect(await h.api.session()).toEqual({ signedIn: false, account: null });
    expect(h.log).toEqual([]);
  });

  it('names the address the session signed in with from the session itself, reading no table, and none signed out', async () => {
    const user = { ...SESSION.user, email: 'pip@example.test' };
    const h = harness((r) => {
      if (r.url.pathname === '/functions/v1/account') return json({ session: { ...SESSION, user }, account: true });
      if (r.url.pathname === '/auth/v1/user') return json(user);
      return undefined;
    });
    expect(await h.api.signInAddress()).toBeNull();
    await h.api.verifyCode('pip@example.test', '123456');
    expect(await h.api.signInAddress()).toBe('pip@example.test');
    expect(h.rest()).toEqual([]);
  });
});

describe('the estimate', () => {
  it('asks with the bearer, and answers an ask before freshAfter from the last answer without a request', async () => {
    let now = Date.parse('2026-10-29T12:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const answer = { entries: [{ character: B, reason: 'face.cheered', amount: 30 }], lines: [{ character: B, reason: 'face.cheered', amount: 30, act: A, quadrant: 'excitedPositive', at: 1788000000000 }], asOf: '2026-10-29T12:00:00Z', freshAfter: '2026-10-29T12:00:30Z' };
    const h = harness((r) => (r.url.pathname === '/functions/v1/estimate' ? json(answer) : undefined));
    try {
      expect(await h.api.estimate()).toEqual(answer);
      now += 10_000;
      expect(await h.api.estimate()).toEqual(answer);
      expect(h.log).toHaveLength(1);
      expect(h.log[0]?.method).toBe('POST');
      now += 25_000;
      await h.api.estimate();
      expect(h.log).toHaveLength(2);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('the estimate across sessions', () => {
  const FRESH = '2099-01-01T00:00:00Z';
  const answerFor = (who: string) => ({ entries: [{ character: B, reason: `for.${who}`, amount: 1 }], lines: [], asOf: '2026-10-29T12:00:00Z', freshAfter: FRESH });

  /** A client stub whose session the test switches, and a fetch whose answers the test releases. */
  function world() {
    let user: string | null = 'A';
    let notify: (event: string, session: unknown) => void = () => {};
    const whoami = vi.fn(async () => ({ data: 'acct', error: null, status: 200 }));
    const client = {
      auth: {
        getSession: async () => ({ data: { session: user ? { access_token: `token-${user}`, user: { id: user } } : null } }),
        onAuthStateChange: (f: typeof notify) => {
          notify = f;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
      rpc: whoami,
    };
    const asked: { who: string; release: (r: Response) => void }[] = [];
    const fetchFake = (async (_input: unknown, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      return new Promise<Response>((resolve) => asked.push({ who: auth.replace('Bearer token-', ''), release: resolve }));
    }) as typeof fetch;
    const api = createSupabaseApi({ url: URL_, publishableKey: PUBLISHABLE, settingsFallback: FALLBACK, client: client as never, fetch: fetchFake });
    const become = (id: string | null, event = 'SIGNED_IN') => {
      user = id;
      notify(event, id ? { access_token: `token-${id}`, user: { id } } : null);
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    return { api, asked, become, whoami, tick };
  }

  it('asks again when the session becomes another user, and never serves one user the other\'s answer', async () => {
    const w = world();
    w.api.onSession(() => {});
    const first = w.api.estimate();
    await w.tick();
    w.asked[0]?.release(json(answerFor('A')));
    expect((await first).entries[0]?.reason).toBe('for.A');
    await w.api.estimate();
    expect(w.asked).toHaveLength(1);
    w.become('B');
    const second = w.api.estimate();
    await w.tick();
    expect(w.asked).toHaveLength(2);
    expect(w.asked[1]?.who).toBe('B');
    w.asked[1]?.release(json(answerFor('B')));
    expect((await second).entries[0]?.reason).toBe('for.B');
  });

  it('drops an answer that lands after the session changed, and a later ask is not joined to it', async () => {
    const w = world();
    w.api.onSession(() => {});
    const forA = w.api.estimate();
    await w.tick();
    w.become('B');
    const forB = w.api.estimate();
    await w.tick();
    expect(w.asked.map((r) => r.who)).toEqual(['A', 'B']);
    w.asked[0]?.release(json(answerFor('A')));
    await forA;
    // A's late answer is not cached for B: B's next ask is still B's own request in flight.
    w.asked[1]?.release(json(answerFor('B')));
    expect((await forB).entries[0]?.reason).toBe('for.B');
    expect((await w.api.estimate()).entries[0]?.reason).toBe('for.B');
    expect(w.asked).toHaveLength(2);
  });

  it('does not cache an answer that lands after the session changed', async () => {
    const w = world();
    w.api.onSession(() => {});
    const forA = w.api.estimate();
    await w.tick();
    w.become(null, 'SIGNED_OUT');
    w.asked[0]?.release(json(answerFor('A')));
    await forA;
    w.become('B');
    const forB = w.api.estimate();
    await w.tick();
    expect(w.asked).toHaveLength(2);
    w.asked[1]?.release(json(answerFor('B')));
    expect((await forB).entries[0]?.reason).toBe('for.B');
  });

  it('reads whoami once for a user, not again on a token refresh or a repeat sign-in, and again for another user', async () => {
    const w = world();
    const heard = vi.fn();
    w.api.onSession(heard);
    w.become('A', 'INITIAL_SESSION');
    await w.tick();
    w.become('A', 'TOKEN_REFRESHED');
    w.become('A', 'SIGNED_IN');
    await w.tick();
    expect(w.whoami).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    w.become('B');
    await w.tick();
    expect(w.whoami).toHaveBeenCalledTimes(2);
    w.become(null, 'SIGNED_OUT');
    await w.tick();
    expect(heard).toHaveBeenLastCalledWith({ signedIn: false, account: null });
  });
});

describe('the avatar', () => {
  it('is sent as multipart with the character, both frames as one JSON string and both files, and no source', async () => {
    const h = harness((r) => (r.url.pathname === '/functions/v1/avatar' ? json({ character: B, title: 'T', signature: 'S', avatar_square: 'sq.webp', avatar_portrait: 'po.webp', square_frame: { x: 0, y: 0, w: 1, h: 1 }, portrait_frame: { x: 0, y: 0, w: 1, h: 1 }, pip_style: 'default' }) : rows([{ id: B, name: 'Bea' }])));
    const square = new Blob(['sq'], { type: 'image/webp' });
    const portrait = new Blob(['po'], { type: 'image/webp' });
    const r = await h.api.setAvatar({ character: B, square, portrait, squareFrame: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, portraitFrame: { x: 0, y: 0, w: 1, h: 1 } });
    const [req] = h.log.filter((x) => x.url.pathname === '/functions/v1/avatar');
    const form = req?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()].sort()).toEqual(['character', 'frames', 'portrait', 'square']);
    expect(form.get('character')).toBe(B);
    expect(JSON.parse(form.get('frames') as string)).toEqual({ square: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, portrait: { x: 0, y: 0, w: 1, h: 1 } });
    expect((form.get('square') as File).size).toBe(2);
    expect(req?.headers.get('content-type') ?? '').not.toContain('application/json');
    expect(req?.headers.get('apikey')).toBe(PUBLISHABLE);
    expect(req?.headers.get('authorization')).toBeNull();
    expect(r.ok && r.value.avatarSquare).toBe(`${URL_}/storage/v1/object/public/avatars/sq.webp`);
  });

  it('sends a recrop with the portrait frame null and no portrait file', async () => {
    const h = harness((r) => (r.url.pathname === '/functions/v1/avatar' ? json({ error: 'the square is 256 by 256', field: 'square' }, 400) : rows([])));
    const r = await h.api.setAvatar({ character: B, square: new Blob(['sq']), portrait: null, squareFrame: { x: 0, y: 0, w: 1, h: 1 }, portraitFrame: null });
    const form = h.log.find((x) => x.url.pathname === '/functions/v1/avatar')?.body as FormData;
    expect([...form.keys()].sort()).toEqual(['character', 'frames', 'square']);
    expect(JSON.parse(form.get('frames') as string).portrait).toBeNull();
    expect(r).toEqual({ ok: false, error: 'the square is 256 by 256', field: 'square' });
  });
});

describe('live', () => {
  function stub() {
    const channels: { topic: string; opts: unknown; handlers: Map<string, (m: { payload: unknown }) => void>; subscribed: boolean }[] = [];
    const removed: string[] = [];
    const order: string[] = [];
    const client = {
      auth: { getSession: async () => ({ data: { session: { access_token: JWT, user: { id: A } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      realtime: { setAuth: vi.fn(async (t: string) => { order.push(`auth:${t === JWT}`); }) },
      channel(topic: string, opts: unknown) {
        const ch = { topic, opts, handlers: new Map<string, (m: { payload: unknown }) => void>(), subscribed: false };
        channels.push(ch);
        order.push(`channel:${topic}`);
        const self = {
          on(_type: string, filter: { event: string }, cb: (m: { payload: unknown }) => void) { ch.handlers.set(filter.event, cb); return self; },
          subscribe() { ch.subscribed = true; order.push(`subscribe:${topic}`); return self; },
        };
        return self;
      },
      removeChannel: vi.fn(async (c: unknown) => { removed.push(String((c as { topic?: string }).topic ?? 'x')); return 'ok'; }),
    };
    const api = createSupabaseApi({ url: URL_, publishableKey: PUBLISHABLE, settingsFallback: FALLBACK, client: client as never });
    return { api, channels, client, order, removed };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('opens one private channel per topic, authorizes it first, and maps broadcasts', async () => {
    const s = stub();
    const onAct = vi.fn();
    const onTally = vi.fn();
    const onEffect = vi.fn();
    s.api.subscribeThread(T, { onAct, onTally, onEffect });
    await settle();
    expect(s.channels).toHaveLength(1);
    expect(s.channels[0]?.topic).toBe(`thread:${T}`);
    expect(s.channels[0]?.opts).toEqual({ config: { private: true } });
    expect(s.order).toEqual([`channel:thread:${T}`, 'auth:true', `subscribe:thread:${T}`]);
    s.channels[0]?.handlers.get('act')?.({ payload: ACT_ROW });
    s.channels[0]?.handlers.get('tally')?.({ payload: { act: A, tally: { fire: 2 } } });
    s.channels[0]?.handlers.get('effect')?.({ payload: { play: A, saved_at: '2026-10-29T00:00:00Z' } });
    expect(onAct).toHaveBeenCalledWith(ACT);
    expect(onTally).toHaveBeenCalledWith(A, { fire: 2 });
    expect(onEffect).toHaveBeenCalledWith(A, '2026-10-29T00:00:00Z');
  });

  it('shares a channel between listeners on one topic and removes it with the last', async () => {
    const s = stub();
    const a = vi.fn();
    const b = vi.fn();
    const offA = s.api.subscribeThread(T, { onAct: a });
    const offB = s.api.subscribeThread(T, { onAct: b });
    await settle();
    expect(s.channels).toHaveLength(1);
    s.channels[0]?.handlers.get('act')?.({ payload: ACT_ROW });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    expect(s.client.removeChannel).not.toHaveBeenCalled();
    s.channels[0]?.handlers.get('act')?.({ payload: ACT_ROW });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    offB();
    expect(s.client.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('maps a board broadcast to a thread and leaves a channel unopened when unsubscribed first', async () => {
    const s = stub();
    const onThread = vi.fn();
    s.api.subscribeBoard(C, { onThread });
    await settle();
    expect(s.channels[0]?.topic).toBe(`board:${C}`);
    s.channels[0]?.handlers.get('thread')?.({ payload: { id: T, board: C, title: 'A title', origin_act_id: null, created_at: '2026-10-01T09:00:00+00:00' } });
    expect(onThread).toHaveBeenCalledWith({ id: T, board: C, title: 'A title', originActId: null, createdAt: '2026-10-01T09:00:00+00:00' });
    const early = stub();
    early.api.subscribeBoard(C, { onThread })();
    await settle();
    expect(early.channels.filter((c) => c.subscribed)).toEqual([]);
  });

  it('opens the signed-in account\'s own channel for alerts, and maps an alert broadcast', async () => {
    const s = stub();
    const onAlert = vi.fn();
    const off = s.api.subscribeAccount({ onAlert });
    await settle();
    expect(s.channels.map((c) => c.topic)).toEqual([`account:${A}`]);
    expect(s.channels[0]?.opts).toEqual({ config: { private: true } });
    expect(s.order).toEqual([`channel:account:${A}`, 'auth:true', `subscribe:account:${A}`]);
    s.channels[0]?.handlers.get('alert')?.({ payload: { id: '7b1d6c1e-0000-4000-8000-000000000007', kind: 'quote', sub: null, act: B, character: C, at: '2026-11-02T10:00:00Z' } });
    expect(onAlert).toHaveBeenCalledWith({ id: '7b1d6c1e-0000-4000-8000-000000000007', kind: 'quote', sub: null, act: B, character: C, at: '2026-11-02T10:00:00Z' });
    off();
    expect(s.client.removeChannel).toHaveBeenCalledTimes(1);
  });

  it('opens nothing for an account when unsubscribed before the session was read', async () => {
    const s = stub();
    s.api.subscribeAccount({ onAlert: vi.fn() })();
    await settle();
    expect(s.channels).toEqual([]);
  });

  it('hears plays beyond a post on reach, as the public Act', async () => {
    const s = stub();
    const onPlay = vi.fn();
    s.api.subscribeReach({ onPlay });
    await settle();
    expect(s.channels.map((c) => c.topic)).toEqual(['reach']);
    s.channels[0]?.handlers.get('effect')?.({ payload: ACT_ROW });
    expect(onPlay).toHaveBeenCalledWith(ACT);
  });

  it('hears a settlement applied on reach as its id and time', async () => {
    const s = stub();
    const onSettled = vi.fn();
    s.api.subscribeReach({ onSettled });
    await settle();
    s.channels[0]?.handlers.get('settled')?.({ payload: { id: 41, at: '2026-11-02T08:00:01Z' } });
    expect(onSettled).toHaveBeenCalledWith({ id: '41', at: '2026-11-02T08:00:01Z' });
  });

  it('hears news on reach as its public projection, and not as a play', async () => {
    const s = stub();
    const onPlay = vi.fn();
    const onNews = vi.fn();
    s.api.subscribeReach({ onPlay, onNews });
    await settle();
    s.channels[0]?.handlers.get('news')?.({ payload: { kind: 'seasonNews', sub: 'tally', act: B, at: '2026-11-02T10:00:00Z' } });
    s.channels[0]?.handlers.get('news')?.({ payload: { kind: 'update', sub: null, act: C, at: '2026-11-02T11:00:00Z' } });
    expect(onNews.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'seasonNews', sub: 'tally', act: B, at: '2026-11-02T10:00:00Z' },
      { kind: 'update', sub: null, act: C, at: '2026-11-02T11:00:00Z' },
    ]);
    expect(onPlay).not.toHaveBeenCalled();
  });
});

export type { KayfaApi };

describe('the log', () => {
  const S1 = '2026-10-30T08:17:00+00:00';
  const LEDGER = [
    { settlement: 9, starts_at: '2026-10-29T08:17:00+00:00', ends_at: S1, character: B, reason: 'heel.drewHeat', amount: 20, shares_kept: true },
    { settlement: 9, starts_at: '2026-10-29T08:17:00+00:00', ends_at: S1, character: B, reason: 'heel.shrugged', amount: -5, shares_kept: true },
  ];
  const SHARES = [
    { settlement: 9, character: B, reason: 'heel.drewHeat', act: A, quadrant: 'excitedNegative', amount: 20 },
  ];
  function logHarness(shares: unknown[] = SHARES) {
    return harness((r) => {
      const name = r.url.pathname.replace(`${REST}/`, '');
      if (name === 'my_ledger') return rows(LEDGER);
      if (name === 'my_ledger_shares') {
        const offset = Number(r.url.searchParams.get('offset') ?? 0);
        return rows(shares.slice(offset, offset + Number(r.url.searchParams.get('limit'))));
      }
      if (name === 'my_wallet_events') return rows([{ settlement: 9, kind: 'settlement', change: 15, overflow: 0, floored: 0, balance_after: 472, ref: null, at: '2026-10-30T08:17:02.123456+00:00' }]);
      if (name === 'my_card_ledger') {
        return rows([
          { card: 'whoops', kind: 'played', act: C, price: 25, at: '2026-10-29T21:52:00+00:00', springs: null },
          { card: 'bluffy', kind: 'played', act: SET, price: 0, at: '2026-10-29T18:00:00+00:00', springs: false },
        ]);
      }
      if (name === 'my_posts_played_on') {
        return r.url.searchParams.get('select') === 'play,post,saved_at'
          ? rows([{ play: C, post: A, saved_at: '2026-10-29T23:00:00+00:00' }])
          : rows([{ play: C, post: A, at: '2026-10-29T21:16:00+00:00', reach: 'post', target_name: null, target_character: B }]);
      }
      if (name === 'my_face_down') {
        return r.url.searchParams.get('select')?.includes('passed_at')
          ? rows([{ play: SET, card: 'hook', post: A, ends_at: '2026-11-05T20:00:00+00:00', passed_at: '2026-10-29T18:00:00+00:00' }])
          : rows([{ play: SET, card: 'bluffy', post: A, spring: null, ended_at: '2026-10-29T20:00:00+00:00' }]);
      }
      if (name === 'my_caught') return rows([{ play: C, card: 'whoops', post: A, trap: 'snare', spring: SPRING, price: 25, bought_price: 100, at: '2026-10-29T19:00:00+00:00' }]);
      if (name === 'my_cards_ended') return rows([{ card_end: 'e1', play: C, card: 'whoops', at: '2026-10-29T22:00:00+00:00', side: 'onMine', reach: 'post', target_name: null, post_author_name: 'Pipewrench', caster_name: 'Spritey' }]);
      return undefined;
    });
  }

  it('reads the player\'s own views, each newest first and a page long, and the shares of the settlements it read', async () => {
    const h = logHarness();
    const log = await h.api.log();
    expect(log).toEqual({
      settlements: [{
        id: 9, startsAt: '2026-10-29T08:17:00+00:00', endsAt: S1, sharesKept: true,
        lines: [
          { character: B, reason: 'heel.drewHeat', amount: 20, shares: [{ act: A, quadrant: 'excitedNegative', amount: 20 }] },
          { character: B, reason: 'heel.shrugged', amount: -5, shares: [] },
        ],
      }],
      wallet: [{ settlement: 9, kind: 'settlement', change: 15, overflow: 0, floored: 0, balanceAfter: 472, ref: null, at: '2026-10-30T08:17:02.123456+00:00' }],
      /* A Bluff's row keeps its `springs` (0075); a row that is not a card set face down carries none. */
      cards: [{ card: 'whoops', kind: 'played', act: C, price: 25, at: '2026-10-29T21:52:00+00:00' }, { card: 'bluffy', kind: 'played', act: SET, price: 0, at: '2026-10-29T18:00:00+00:00', springs: false }],
      playsOnMine: [{ play: C, post: A, at: '2026-10-29T21:16:00+00:00', reach: 'post', targetName: null, targetCharacter: B }],
      saves: [{ play: C, post: A, savedAt: '2026-10-29T23:00:00+00:00' }],
      setEnds: [{ play: SET, card: 'bluffy', post: A, spring: null, endedAt: '2026-10-29T20:00:00+00:00' }],
      setPasses: [{ play: SET, card: 'hook', post: A, passedAt: '2026-10-29T18:00:00+00:00', endsAt: '2026-11-05T20:00:00+00:00' }],
      caught: [{ play: C, card: 'whoops', post: A, trap: 'snare', spring: SPRING, price: 25, boughtPrice: 100, at: '2026-10-29T19:00:00+00:00' }],
      ended: [{ cardEnd: 'e1', play: C, card: 'whoops', at: '2026-10-29T22:00:00+00:00', side: 'onMine', reach: 'post', targetName: null, postAuthorName: 'Pipewrench', casterName: 'Spritey' }],
      before: null,
    });
    const [ledger] = h.to('my_ledger');
    expect(ledger?.url.searchParams.get('order')).toBe('ends_at.desc,character.asc,reason.asc');
    expect(ledger?.url.searchParams.get('limit')).toBe('200');
    expect(ledger?.url.searchParams.get('ends_at')).toBeNull();
    const [shares] = h.to('my_ledger_shares');
    expect(shares?.url.searchParams.get('settlement')).toBe('in.(9)');
    for (const [name, column] of [['my_wallet_events', 'at'], ['my_card_ledger', 'at']] as const) {
      const [req] = h.to(name);
      expect(req?.url.searchParams.get('order')).toBe(`${column}.desc`);
      expect(req?.url.searchParams.get('limit')).toBe('200');
    }
    const [plays, saves] = h.to('my_posts_played_on');
    expect(plays?.url.searchParams.get('order')).toBe('at.desc');
    expect(saves?.url.searchParams.get('order')).toBe('saved_at.desc');
    expect(saves?.url.searchParams.get('saved_at')).toBe('not.is.null');
    const [ends, passes] = h.to('my_face_down');
    expect([ends?.url.searchParams.get('order'), ends?.url.searchParams.get('ended_at'), ends?.url.searchParams.get('limit')]).toEqual(['ended_at.desc', 'not.is.null', '200']);
    expect([passes?.url.searchParams.get('order'), passes?.url.searchParams.get('passed_at'), passes?.url.searchParams.get('spring'), passes?.url.searchParams.get('limit')]).toEqual(['passed_at.desc', 'not.is.null', 'is.null', '200']);
    const [caught] = h.to('my_caught');
    expect([caught?.url.searchParams.get('order'), caught?.url.searchParams.get('limit')]).toEqual(['at.desc', '200']);
    const [ended] = h.to('my_cards_ended');
    expect([ended?.url.searchParams.get('order'), ended?.url.searchParams.get('limit')]).toEqual(['at.desc', '200']);
    expect(h.rest().every((r) => r.method === 'GET' && (r.headers.get('prefer') ?? '').indexOf('count') === -1)).toBe(true);
  });

  it('reads an older page at or before its cursor, in every view', async () => {
    const h = logHarness();
    const before = '2026-10-29T08:17:00.000400+00:00';
    await h.api.log(before);
    expect(h.to('my_ledger')[0]?.url.searchParams.get('ends_at')).toBe(`lte.${before}`);
    expect(h.to('my_wallet_events')[0]?.url.searchParams.get('at')).toBe(`lte.${before}`);
    expect(h.to('my_card_ledger')[0]?.url.searchParams.get('at')).toBe(`lte.${before}`);
    const [plays, saves] = h.to('my_posts_played_on');
    expect(plays?.url.searchParams.get('at')).toBe(`lte.${before}`);
    expect(saves?.url.searchParams.getAll('saved_at')).toEqual(['not.is.null', `lte.${before}`]);
    expect(h.to('my_face_down')[0]?.url.searchParams.getAll('ended_at')).toEqual(['not.is.null', `lte.${before}`]);
    expect(h.to('my_face_down')[1]?.url.searchParams.getAll('passed_at')).toEqual(['not.is.null', `lte.${before}`]);
    expect(h.to('my_caught')[0]?.url.searchParams.get('at')).toBe(`lte.${before}`);
    expect(h.to('my_cards_ended')[0]?.url.searchParams.get('at')).toBe(`lte.${before}`);
  });

  /* #89 F2: a settlement made before its shares were kept says so, and the log says it plainly rather than "no post". */
  it('maps a ledger row\'s shares_kept: false to a settlement whose shares were not kept', async () => {
    const h = harness((r) => {
      const name = r.url.pathname.replace(`${REST}/`, '');
      if (name === 'my_ledger') return rows([{ ...LEDGER[0], shares_kept: false }]);
      if (name === 'my_ledger_shares') return rows([]);
      if (name.startsWith('my_')) return rows([]);
      return undefined;
    });
    const log = await h.api.log();
    expect(log.settlements.map((x) => x.sharesKept)).toEqual([false]);
  });

  /* #89 F4: a view that fills a page at the cursor's own instant is read again there, whole, and the cursor moves past it. */
  it('reads a page that would not move again at its one instant, every row, and moves the cursor to the microsecond before', async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ ...LEDGER[0], character: `${B.slice(0, -4)}${String(i).padStart(4, '0')}` }));
    const h = harness((r) => {
      const name = r.url.pathname.replace(`${REST}/`, '');
      if (name === 'my_ledger') return rows(r.url.searchParams.get('ends_at') === `eq.${S1}` ? [...full, LEDGER[1]] : full);
      if (name.startsWith('my_')) return rows([]);
      return undefined;
    });
    const log = await h.api.log(S1);
    expect(log.before).toBe('2026-10-30T08:16:59.999999+00:00');
    expect(log.settlements.map((x) => [x.id, x.lines.length])).toEqual([[9, 201]]);
    const [page, whole] = h.to('my_ledger');
    expect(page?.url.searchParams.get('ends_at')).toBe(`lte.${S1}`);
    expect(whole?.url.searchParams.get('ends_at')).toBe(`eq.${S1}`);
    expect(whole?.url.searchParams.get('order')).toBe('settlement.asc,character.asc,reason.asc');
    for (const name of ['my_wallet_events', 'my_card_ledger', 'my_posts_played_on']) {
      expect(h.to(name).some((q) => [...q.url.searchParams.values()].includes(`eq.${S1}`))).toBe(true);
    }
  });

  it('reads an instant whole however many rows it holds, a page of rows at a time, to an end past the last row', async () => {
    const at = Array.from({ length: 1000 }, (_, i) => ({ settlement: null, kind: 'purchase', change: -100, overflow: 0, floored: 0, balance_after: i, ref: null, at: S1 }));
    const h = harness((r) => {
      const name = r.url.pathname.replace(`${REST}/`, '');
      if (name === 'my_wallet_events') {
        if (r.url.searchParams.get('at') !== `eq.${S1}`) return rows(at.slice(0, 200));
        const offset = Number(r.url.searchParams.get('offset') ?? 0);
        /* Past the last row, PostgREST answers 416, which a page of rows reads as empty. */
        return offset >= at.length ? new Response('{}', { status: 416 }) : rows(at.slice(offset, offset + Number(r.url.searchParams.get('limit'))));
      }
      if (name.startsWith('my_')) return rows([]);
      return undefined;
    });
    const log = await h.api.log(S1);
    expect(log.wallet).toHaveLength(1000);
    expect(log.before).toBe('2026-10-30T08:16:59.999999+00:00');
    const whole = h.to('my_wallet_events').filter((q) => q.url.searchParams.get('at') === `eq.${S1}`);
    expect(whole.map((q) => q.url.searchParams.get('offset') ?? '0')).toEqual(['0', '1000']);
    expect(whole[0]?.url.searchParams.get('order')).toBe('settlement.asc,kind.asc,ref.asc,change.asc,overflow.asc,floored.asc,balance_after.asc');
  });

  it('reads the shares whole, a page of rows at a time, however many a settlement has', async () => {
    /* 1,020 shares: a full page of a thousand, then the twenty past it, each on its line. */
    const act = (prefix: string, i: number) => `${prefix.slice(0, -4)}${String(i).padStart(4, '0')}`;
    const heat = Array.from({ length: 1019 }, (_, i) => ({ settlement: 9, character: B, reason: 'heel.drewHeat', act: act(A, i), quadrant: null, amount: 1 }));
    const shrug = [{ settlement: 9, character: B, reason: 'heel.shrugged', act: act(C, 0), quadrant: null, amount: -5 }];
    const h = logHarness([...heat, ...shrug]);
    const log = await h.api.log();
    expect(h.to('my_ledger_shares').map((r) => r.url.searchParams.get('offset') ?? '0')).toEqual(['0', '1000']);
    expect(log.settlements[0]?.lines.map((l) => l.shares.length)).toEqual([1019, 1]);
  });
});

describe('reads by many ids', () => {
  const id = (n: number) => `${A.slice(0, -4)}${String(n).padStart(4, '0')}`;
  const ids = Array.from({ length: 450 }, (_, n) => id(n));
  /** The ids a request names in its one `in.(…)` filter (an Act kind list is a bounded filter, never the read's ids). */
  const askedIn = (r: Rec): string[] => {
    for (const [key, value] of r.url.searchParams) {
      if (key !== 'kind' && value.startsWith('in.(')) return value.replace(/^in\.\(|\)$/gu, '').split(',').filter(Boolean);
    }
    return [];
  };
  /** A row per id asked, carrying the id under every column a by-id read filters on. */
  const rowFor = (a: string, n: number) => ({
    ...ACT_ROW, ...THREAD_ROW, id: a, act: a, character: a, thread: a, play: a, origin_act_id: a, target_act_id: a, kind: 'card',
    name: 'Mask', joined: '2026-10-01', count: 1, views: 2, posts: 3, standing: 4, furthest_seq: 5, state: {}, saved_at: 'x',
    class: 'heel', at: `2026-10-01T10:00:${String(n % 60).padStart(2, '0')}+00:00`, via: 'reveal', was: null, since: null,
  });
  const byIdHarness = () => harness((r) => rows(askedIn(r).map((a, n) => rowFor(a, n))));

  const reads: readonly (readonly [string, readonly string[], (api: KayfaApi) => Promise<unknown>])[] = [
    ['actsById', ['acts_public'], (api) => api.actsById(ids)],
    ['effectStates', ['effect_state'], (api) => api.effectStates(ids)],
    ['characters', ['characters_public', 'character_profiles'], (api) => api.characters(ids)],
    ['spunFromMany', ['thread_list'], (api) => api.spunFromMany(ids, 20)],
    ['cardsOnMany', ['acts_public'], (api) => api.cardsOnMany(ids, 20)],
    ['myReleases', ['effect_releases'], (api) => api.myReleases(ids)],
    ['characterStats', ['character_post_counts'], (api) => api.characterStats(ids)],
    ['tallies', ['reaction_tallies'], (api) => api.tallies(ids)],
    ['viewCounts', ['thread_view_counts'], (api) => api.viewCounts(ids)],
    ['standingAmounts', ['current_standings'], (api) => api.standingAmounts(ids)],
    ['classReveals', ['class_reveals'], (api) => api.classReveals(ids)],
    ['turnsAnnounced', ['turns_announced'], (api) => api.turnsAnnounced(ids)],
    ['myReactions', ['my_reactions'], (api) => api.myReactions(ids)],
    ['reading', ['reading'], (api) => api.reading(ids)],
  ];

  it('effectsAbove asks effects_above in chunks of characters, the thread and the board once, and joins the answer in order', async () => {
    const asked: Record<string, unknown>[] = [];
    const h = harness((r) => {
      if (r.url.pathname !== `${REST}/rpc/effects_above`) return undefined;
      const body = r.body as { characters: string[]; thread: string | null; board: string | null };
      asked.push(body);
      return json(body.characters.map((c, n) => ({ play: c, reach: 'character', target: c, ends_at: '2099-01-01T00:00:00+00:00',
        act: { ...ACT_ROW, id: c, kind: 'card', created_at: `2026-10-01T10:${String(n % 60).padStart(2, '0')}:00+00:00` } }))
        .concat(body.thread ? [{ play: 'th', reach: 'thread', target: body.thread, ends_at: '2099-01-01T00:00:00+00:00', act: { ...ACT_ROW, id: 'th', kind: 'card', created_at: '2026-10-01T09:59:00+00:00' } }] : []));
    });
    const above = await h.api.effectsAbove([...ids, ids[0]!], T, C);
    expect(asked.length).toBe(5);
    expect(asked.flatMap((a) => a['characters'] as string[]).sort()).toEqual([...ids].sort());
    expect(asked.filter((a) => a['thread'] !== null)).toHaveLength(1);
    expect(above).toHaveLength(451);
    expect(above[0]).toMatchObject({ play: 'th', reach: 'thread', target: T, endsAt: '2099-01-01T00:00:00+00:00', act: { id: 'th', kind: 'card' } });
    const times = above.map((p) => p.act.createdAt);
    expect(times).toEqual([...times].sort());
    expect(await h.api.effectsAbove([], null, null)).toEqual([]);
  });

  it('playMoment asks play_moment once, reads its version, layers and plays above, and reads a refusal as null', async () => {
    const h = harness((r) => {
      if (r.url.pathname !== `${REST}/rpc/play_moment`) return undefined;
      if ((r.body as { play: string }).play === B) return json({ code: 'P0002', message: 'that is no play on a post', hint: 'kayfabb.refusal' }, 400);
      return json({
        version: { ...ACT_ROW, current_payload: { body: 'then' } },
        layers: [{ act: { ...ACT_ROW, id: A, kind: 'card' }, state: null, savedAt: null }, { act: { ...ACT_ROW, id: C, kind: 'card' }, state: { washed: 0.4 }, savedAt: '2026-10-01T10:00:00+00:00' }],
        above: [{ play: T, reach: 'thread', target: T, ends_at: '2099-01-01T00:00:00+00:00', act: { ...ACT_ROW, id: T, kind: 'card' } }],
        recorded: true,
      });
    });
    const m = await h.api.playMoment(A);
    expect(h.to('rpc/play_moment')).toHaveLength(1);
    expect(h.to('rpc/play_moment')[0]!.body).toEqual({ play: A });
    expect(m?.version.currentPayload).toEqual({ body: 'then' });
    expect(m?.layers.map((l) => [l.act.id, l.state])).toEqual([[A, null], [C, { state: { washed: 0.4 }, savedAt: '2026-10-01T10:00:00+00:00' }]]);
    expect(m?.above).toMatchObject([{ play: T, reach: 'thread', target: T, endsAt: '2099-01-01T00:00:00+00:00', act: { id: T } }]);
    expect(m?.recorded).toBe(true);
    expect(await h.api.playMoment(B)).toBeNull();
    expect(await h.api.playMoment('not an id')).toBeNull();
    expect(h.to('rpc/play_moment')).toHaveLength(2);
  });

  it('pinnedThreads asks pinned_threads once for the board, and reads each row\'s thread, play and end', async () => {
    const h = harness((r) => (r.url.pathname === `${REST}/rpc/pinned_threads` ? json([{ thread: THREAD_ROW, play: A, ends_at: '2099-01-01T00:00:00+00:00', act: { ...ACT_ROW, kind: 'card' } }]) : undefined));
    const pins = await h.api.pinnedThreads(C);
    expect(h.to('rpc/pinned_threads')).toHaveLength(1);
    expect(h.to('rpc/pinned_threads')[0]!.body).toEqual({ board: C });
    expect(pins).toEqual([{ thread: expect.objectContaining({ id: T, title: 'A title', board: C }), play: A, endsAt: '2099-01-01T00:00:00+00:00', act: expect.objectContaining({ id: A, kind: 'card' }) }]);
  });

  it.each(reads)('%s reads by id in chunks, so no request carries an address too long for a proxy, and every id is read once', async (_name, tables, call) => {
    const h = byIdHarness();
    await call(h.api);
    for (const name of tables) {
      /* The ends of the plays read are asked in requests of their own (cardsOnMany); the chunks of ids are the rest. */
      const reqs = h.to(name).filter((r) => r.url.searchParams.get('kind') !== 'eq.card_end');
      expect(reqs.length, name).toBe(5);
      for (const r of reqs) expect(r.url.toString().length, name).toBeLessThan(8000);
      const asked = reqs.flatMap(askedIn);
      expect(asked.length, name).toBe(450);
      expect(new Set(asked), name).toEqual(new Set(ids));
    }
  });

  it('reads the log\'s shares by settlement in chunks, and every settlement once', async () => {
    const settlements = Array.from({ length: 450 }, (_, n) => n + 1);
    const h = harness((r) => {
      const name = r.url.pathname.replace(`${REST}/`, '');
      if (name === 'my_ledger') return rows(settlements.map((s) => ({ settlement: s, starts_at: 'a', ends_at: `2026-10-01T00:00:00Z`, character: B, reason: 'heel.drewHeat', amount: 1, shares_kept: true })));
      if (name === 'my_ledger_shares') return rows(askedIn(r).map((s) => ({ settlement: Number(s), character: B, reason: 'heel.drewHeat', act: A, quadrant: null, amount: 1 })));
      return rows([]);
    });
    const log = await h.api.log();
    const reqs = h.to('my_ledger_shares');
    expect(reqs.length).toBe(5);
    for (const r of reqs) expect(r.url.toString().length).toBeLessThan(8000);
    expect(reqs.flatMap(askedIn).map(Number).sort((a, b) => a - b)).toEqual(settlements);
    expect(log.settlements.every((s) => s.lines[0]?.shares.length === 1)).toBe(true);
  });

  /** A table of rows the harness answers as one PostgREST query would: filtered by the request's `in.(…)`, ordered by `order`, cut at `limit`. */
  const asOneQuery = (table: readonly Row[], column: string, order: (a: Row, b: Row) => number) => (r: Rec) => {
    const asked = new Set(askedIn(r));
    const limit = Number(r.url.searchParams.get('limit') ?? Infinity);
    return rows(table.filter((x) => asked.has(x[column])).sort(order).slice(0, limit));
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>;
  const byTimeThenId = (a: Row, b: Row) => String(a['created_at']).localeCompare(String(b['created_at'])) || String(a['id']).localeCompare(String(b['id']));
  /** 250 posts' worth of rows, each post's created at a time that does not follow its id, so the earliest are spread across every chunk. */
  const scattered = (n: number) => `2026-10-01T${String(10 + ((n * 37) % 250) / 25 | 0).padStart(2, '0')}:${String((n * 37) % 25).padStart(2, '0')}:00+00:00`;
  const posts = Array.from({ length: 250 }, (_, n) => id(n));
  const cardRows = posts.map((p, n) => ({ ...ACT_ROW, id: id(1000 + n), kind: 'card', target_act_id: p, created_at: scattered(n) }));
  const threadRows = posts.map((p, n) => ({ ...THREAD_ROW, id: id(2000 + n), origin_act_id: p, created_at: scattered(n) }));

  it.each([0, 1, 7])('cardsOnMany over 250 posts with limit %i answers the earliest rows across every chunk, in order, as one query would', async (limit) => {
    const h = harness(asOneQuery(cardRows, 'target_act_id', byTimeThenId));
    const got = await h.api.cardsOnMany(posts, limit);
    const want = [...cardRows].sort(byTimeThenId).slice(0, Math.max(1, limit)).map((r) => r.id);
    expect(got.map((a) => a.id)).toEqual(want);
    expect(h.to('acts_public').filter((r) => r.url.searchParams.get('kind') !== 'eq.card_end').length).toBe(3);
  });

  it.each([0, 1, 7])('spunFromMany over 250 posts with limit %i answers the earliest threads across every chunk, in order, as one query would', async (limit) => {
    const h = harness(asOneQuery(threadRows, 'origin_act_id', byTimeThenId));
    const got = await h.api.spunFromMany(posts, limit);
    expect(got.map((t) => t.id)).toEqual([...threadRows].sort(byTimeThenId).slice(0, Math.max(1, limit)).map((r) => r.id));
  });

  it('classReveals orders rows with equal times across two chunks by their Act', async () => {
    const at = '2026-10-01T10:00:00+00:00';
    /* The character in the first chunk carries the later Act id, so only a merge by Act puts the second chunk's row first. */
    const table = [
      { act: id(901), character: ids[5], class: 'heel', at, via: 'reveal', thread: T },
      { act: id(900), character: ids[300], class: 'face', at, via: 'reveal', thread: T },
      { act: id(899), character: ids[6], class: 'heel', at: '2026-10-01T09:00:00+00:00', via: 'reveal', thread: T },
    ];
    const h = harness(asOneQuery(table, 'character', (a, b) => String(a['at']).localeCompare(String(b['at']))));
    expect((await h.api.classReveals(ids)).map((r) => r.act)).toEqual([id(899), id(900), id(901)]);
  });

  it('classReveals orders times written with and without fractions of a second as the server does, never as a locale would', async () => {
    /* PostgREST trims a timestamp's trailing zeros, so a whole second has no fraction; a locale's collation can sort "00.5+" before "00+". */
    const table = [
      { act: id(901), character: ids[5], class: 'heel', at: '2026-10-01T10:00:00.5+00:00', via: 'reveal', thread: T },
      { act: id(902), character: ids[300], class: 'face', at: '2026-10-01T10:00:00+00:00', via: 'reveal', thread: T },
      { act: id(900), character: ids[6], class: 'heel', at: '2026-10-01T10:00:00.25+00:00', via: 'reveal', thread: T },
    ];
    const h = harness(asOneQuery(table, 'character', (a, b) => Date.parse(String(a['at'])) - Date.parse(String(b['at']))));
    expect((await h.api.classReveals(ids)).map((r) => r.act)).toEqual([id(902), id(900), id(901)]);
  });

  it('reads each id once when the list names it twice, and characters still answers in the order asked', async () => {
    const h = byIdHarness();
    await h.api.tallies([...ids, ...ids]);
    expect(h.to('reaction_tallies').length).toBe(5);
    expect(h.to('reaction_tallies').flatMap(askedIn).length).toBe(450);
    const asked = [ids[7] as string, ids[3] as string, ids[7] as string];
    expect((await h.api.characters(asked)).map((c) => c.id)).toEqual(asked);
  });

  it('reads 150 settlements\' shares, one holding more than a page of rows, whole and in the log\'s order', async () => {
    const settlements = Array.from({ length: 150 }, (_, n) => n + 1);
    const share = (s: number, k: number) => ({ settlement: s, character: B, reason: 'heel.drewHeat', act: id(k), quadrant: null, amount: 1 });
    const table = settlements.flatMap((s) => (s === 120 ? Array.from({ length: 1003 }, (_, k) => share(s, k)) : [share(s, 0), share(s, 1)]));
    const h = harness((r) => {
      const name = r.url.pathname.replace(`${REST}/`, '');
      if (name === 'my_ledger') return rows(settlements.map((s) => ({ settlement: s, starts_at: 'a', ends_at: `2026-10-01T00:00:00Z`, character: B, reason: 'heel.drewHeat', amount: 1, shares_kept: true })));
      if (name === 'my_ledger_shares') {
        const asked = new Set(askedIn(r).map(Number));
        const offset = Number(r.url.searchParams.get('offset') ?? 0);
        const mine = table.filter((x) => asked.has(x.settlement)).sort((a, b) => b.settlement - a.settlement || a.act.localeCompare(b.act));
        return rows(mine.slice(offset, offset + Number(r.url.searchParams.get('limit'))));
      }
      return rows([]);
    });
    const log = await h.api.log();
    const counts = Object.fromEntries(log.settlements.map((s) => [s.id, s.lines[0]?.shares.length]));
    expect(counts[120]).toBe(1003);
    expect(Object.values(counts).reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(1003 + 149 * 2);
    expect(log.settlements[0]?.lines[0]?.shares.map((x) => x.act)).toEqual([id(0), id(1)]);
  });

  it.each([
    ['tallies', 'reaction_tallies', (api: KayfaApi) => api.tallies(ids)],
    ['myReleases', 'effect_releases', (api: KayfaApi) => api.myReleases(ids)],
    ['cardsOnMany', 'acts_public', (api: KayfaApi) => api.cardsOnMany(ids, 20)],
  ] as const)('%s fails whole when one chunk fails, never answering the other chunks\' rows', async (_name, table, call) => {
    let n = 0;
    const h = harness((r) => {
      if (r.url.pathname === `${REST}/${table}` && askedIn(r).includes(ids[250] as string)) return json({ message: 'bad' }, 400);
      n += 1;
      return rows(askedIn(r).map((a, k) => rowFor(a, k)));
    });
    await expect(call(h.api)).rejects.toThrow();
    expect(n).toBeGreaterThan(0);
  });
});


describe('the moves a board shows, a staff profile and the admin queue', () => {
  const MOVE_ROW = {
    ...ACT_ROW, kind: 'move', seq: 1, character: B,
    payload: { kind: 'renameBoard', body: 'Toast now.', params: { board: C, name: 'Toast Palace', premise: 'Toast.', description: 'About toast.' }, demand: { kind: 'distinctCharactersOnBoard', params: { board: C, count: 12 } }, expires_at: '2026-11-13T12:00:00+00:00' },
  };

  it('puts the board a move renamed with its move Act, from boards_now', async () => {
    const h = harness(() => rows([{ id: C, slug: 'general', name: 'Toast Palace', description: 'About toast.', is_system: false, move_act: A }]));
    expect((await h.api.board('general'))?.moveAct).toBe(A);
  });

  it('reads every board\'s name now and its own name before any move: two small reads, boards_now and boards', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/boards_now') ? rows([{ id: C, slug: 'general', name: 'Toast Palace' }]) : rows([{ id: C, name: 'General' }])));
    expect(await h.api.boardNames()).toEqual([{ id: C, slug: 'general', name: 'Toast Palace', was: 'General' }]);
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, '')).sort()).toEqual(['boards', 'boards_now']);
  });

  it('builds a move\'s notice from its Act, its tally (the top three) and move_progress, a public read', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/acts_public')) return rows([MOVE_ROW]);
      if (r.url.pathname.endsWith('/reaction_tallies')) return rows([{ kind: 'fire', count: 9 }, { kind: 'facepalm', count: 1 }, { kind: 'folded-hands', count: 3 }, { kind: 'tomato', count: 6 }]);
      if (r.url.pathname.endsWith('/rpc/move_progress')) return json({ done: 7, of: 12, met: false, checkedAt: '2026-11-01T14:05:00+00:00' });
      return json({}, 404);
    });
    const notice = await h.api.moveNotice(A);
    expect(notice).toMatchObject({ act: A, kind: 'renameBoard', body: 'Toast now.', demand: { kind: 'distinctCharactersOnBoard' }, progress: { done: 7, of: 12, met: false, checkedAt: '2026-11-01T14:05:00+00:00' }, expiresAt: '2026-11-13T12:00:00+00:00' });
    expect(notice?.reactions).toEqual([{ kind: 'fire', count: 9 }, { kind: 'tomato', count: 6 }, { kind: 'folded-hands', count: 3 }]);
    expect(h.to('rpc/move_progress')[0]?.body).toEqual({ move_act: A });
    expect(await harness(() => rows([])).api.moveNotice(A)).toBeNull();
  });

  it('shows a move without a count when its progress could not be read, and still shows the move', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/acts_public')) return rows([MOVE_ROW]);
      if (r.url.pathname.endsWith('/rpc/move_progress')) return json({ message: 'down' }, 400);
      return rows([]);
    });
    expect((await h.api.moveNotice(A))?.progress).toEqual({ done: 0, of: 0, met: false, checkedAt: null });
  });

  it('shows a move the tick has not counted yet with no count and no time, as the server answers it', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/move_progress')) return json({ checkedAt: null });
      if (r.url.pathname.endsWith('/acts_public')) return rows([MOVE_ROW]);
      return rows([]);
    });
    expect((await h.api.moveNotice(A))?.progress).toEqual({ done: 0, of: 0, met: false, checkedAt: null });
  });

  it('pages a staff member\'s moves by keyset: newest first by time then Act, one row more than a page to know there is an older one', async () => {
    const mk = (i: number) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, kind: 'renameBoard', params: { board: C, name: `N${i}` }, demand: null, expires_at: null, thread: T, at: `2026-10-${String(30 - (i % 28)).padStart(2, '0')}T12:00:00.123456+00:00`, ended_why: i === 1 ? 'met' : null, ended_by: i === 1 ? 'tick' : null, ended_at: i === 1 ? '2026-10-31T00:00:00+00:00' : null });
    const h = harness(() => rows(Array.from({ length: 21 }, (_, i) => mk(i + 1))));
    const page = await h.api.movesLog('director');
    expect(page.rows).toHaveLength(20);
    expect(page.older).toEqual({ at: page.rows[19]!.at, act: page.rows[19]!.act });
    expect(page.rows[0]?.end).toEqual({ why: 'met', by: 'tick', at: '2026-10-31T00:00:00+00:00' });
    expect(page.rows[1]?.end).toBeNull();
    const first = h.to('moves_log')[0]!.url.searchParams;
    expect([first.get('staff'), first.get('order'), first.get('limit'), first.get('or')]).toEqual(['eq.director', 'at.desc,id.desc', '21', null]);
    await h.api.movesLog('director', page.older);
    const next = h.to('moves_log')[1]!.url.searchParams;
    expect(next.get('or')).toBe(`(at.lt.${page.older!.at},and(at.eq.${page.older!.at},id.lt.${page.older!.act}))`);
    expect((await harness(() => rows([mk(1)])).api.movesLog('director')).older).toBeNull();
  });

  it('reads a staff member\'s latest profile from staff_profile_now, and none before it has one', async () => {
    const h = harness(() => rows([{ staff: 'director', at: '2026-10-30T12:00:00+00:00', interests: ['toast'], favorites: [B], mood: 'Hopeful', signature: 'Slice.' }]));
    expect(await h.api.staffProfile('director')).toEqual({ staff: 'director', at: '2026-10-30T12:00:00+00:00', interests: ['toast'], favorites: [B], mood: 'Hopeful', signature: 'Slice.' });
    expect(h.to('staff_profile_now')[0]?.url.searchParams.get('staff')).toBe('eq.director');
    expect(await harness(() => rows([])).api.staffProfile('bot')).toBeNull();
  });

  it('marks a character as staff from characters_public, and not otherwise', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/characters_public') ? rows([{ id: B, name: 'The Director', joined: '2026-10-01', staff: 'director', office: 'boss' }, { id: C, name: 'Al', joined: '2026-10-01', staff: null, office: null }]) : rows([])));
    const [boss, al] = await h.api.characters([B, C]);
    expect([boss?.staff, boss?.office, al?.staff, al?.office]).toEqual(['director', 'boss', undefined, undefined]);
    expect(h.to('characters_public')[0]?.url.searchParams.get('select')).toBe('id,name,joined,staff,office');
  });

  it('reads the admin queue in its three groups, and holds and reverses through the admin functions', async () => {
    const queue = {
      cap: 100,
      waiting: [{ id: 4, staff: 'director', boss: 'The Director', kind: 'renameBoard', params: { board: C, name: 'Toast' }, demand: { kind: 'postsOnBoard', params: { board: C, count: 5 } }, why: 'Toast.', goLiveAt: '2026-10-31T14:10:00+00:00', expiresAt: '2026-11-14T00:00:00+00:00', structural: true, boardName: 'General', failedAt: '2026-10-31T14:11:00+00:00', failure: 'it did not land' }],
      inForce: [{ act: A, id: 3, staff: 'director', boss: 'The Director', kind: 'renameBoard', params: {}, demand: { kind: 'postsOnBoard', params: { board: C, count: 5 } }, why: 'Why.', landedAt: '2026-10-30T12:00:00+00:00', expiresAt: '2026-11-13T12:00:00+00:00', progress: { done: 2, of: 5, met: false, checkedAt: '2026-11-01T14:05:00+00:00' } }],
      ended: [{ how: 'held', by: 'admin', at: '2026-10-30T10:00:00+00:00', act: null, id: 2, staff: 'director', boss: 'The Director', kind: 'renameBoard', params: {}, demand: null, why: 'x', landedAt: null }, { how: 'met', by: 'tick', at: '2026-10-29T10:00:00+00:00', act: B, id: 1, staff: 'director', boss: 'The Director', kind: 'renameBoard', params: {}, demand: null, why: null, landedAt: '2026-10-28T10:00:00+00:00' }],
      more: { waiting: false, inForce: false, ended: true },
      roster: [{ staff: 'the-clerk', name: 'The Clerk' }, { staff: 7, name: 'bad' }],
    };
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/admin_queue')) return json(queue);
      if (r.url.pathname.endsWith('/rpc/hold_move')) return json({ id: 4, heldAt: '2026-10-31T15:00:00+00:00' });
      if (r.url.pathname.endsWith('/rpc/reverse_move')) return json({ act: A, endedBy: B });
      return json({}, 404);
    });
    const q = await h.api.adminQueue();
    expect(q.waiting[0]).toMatchObject({ id: 4, boss: 'The Director', boardName: 'General', failure: 'it did not land', failedAt: '2026-10-31T14:11:00+00:00', demand: { kind: 'postsOnBoard' } });
    expect(q.inForce[0]?.progress).toEqual({ done: 2, of: 5, met: false, checkedAt: '2026-11-01T14:05:00+00:00' });
    expect(q.ended.map((e) => e.how)).toEqual(['held', 'met']);
    expect(q.more).toEqual({ waiting: false, inForce: false, ended: true });
    expect(q.roster).toEqual([{ staff: 'the-clerk', name: 'The Clerk' }]);
    expect(q.waiting[0]?.replacedAt).toBeNull();
    expect(await h.api.holdMove(4)).toEqual({ ok: true, value: { id: 4, heldAt: '2026-10-31T15:00:00+00:00' } });
    expect(h.to('rpc/hold_move')[0]?.body).toEqual({ id: 4 });
    expect(await h.api.reverseMove(A)).toEqual({ ok: true, value: { act: A, endedBy: B } });
    expect(h.to('rpc/reverse_move')[0]?.body).toEqual({ move_act: A });
  });

  it('reads the handover: a move set aside or used up at it, who keeps a move, the roster of Bosses, and replaces a nominated Boss through the admin function', async () => {
    const mk = (i: number, why: string | null, kept: string | null) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, kind: 'renameBoard', params: {}, demand: null, expires_at: null, thread: T, at: '2026-10-30T12:00:00+00:00', ended_why: why, ended_by: why ? 'boss' : null, ended_at: why ? '2026-10-31T00:00:00+00:00' : null, kept_by: kept });
    const log = await harness(() => rows([mk(1, 'superseded', null), mk(2, 'spent', null), mk(3, null, 'the-clerk'), mk(4, 'nonsense', null)])).api.movesLog('director');
    expect(log.rows.map((r) => [r.end?.why ?? null, r.keptBy])).toEqual([['superseded', null], ['spent', null], [null, 'the-clerk'], [null, null]]);
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/replace_successor')) return json({ id: 4, boss: 'hype-man' });
      if (r.url.pathname.endsWith('/rpc/boss_roster_names')) return json([{ staff: 'hype-man', name: 'Hype Man', office: 'member' }, { staff: 'the-clerk', name: 'The Clerk', office: 'waiting' }, { staff: 7, name: 'no key' }]);
      return json({}, 404);
    });
    expect(h.to('moves_log')).toHaveLength(0);
    /* The Boss list is the database's own roster (waiting personas included, whose names characters_public does not hold), read through the admin function. */
    expect(await h.api.bosses()).toEqual([{ staff: 'hype-man', name: 'Hype Man' }, { staff: 'the-clerk', name: 'The Clerk' }]);
    expect(h.to('characters_public')).toHaveLength(0);
    expect(h.to('rpc/boss_roster_names')).toHaveLength(1);
    /* The public names come from characters_public alone: debuted staff, by key. */
    const pub = harness((r) => (r.url.pathname.endsWith('/characters_public') ? rows([{ staff: 'the-clerk', name: 'The Clerk' }, { staff: null, name: 'Al' }]) : rows([])));
    expect(await pub.api.staffNames()).toEqual([{ staff: 'the-clerk', name: 'The Clerk' }]);
    expect(pub.to('characters_public')[0]?.url.searchParams.get('select')).toBe('staff,name');
    expect(pub.to('rpc/boss_roster_names')).toHaveLength(0);
    expect(await h.api.replaceSuccessor(4, 'hype-man')).toEqual({ ok: true, value: { id: 4, boss: 'hype-man' } });
    expect(h.to('rpc/replace_successor')[0]?.body).toEqual({ id: 4, boss: 'hype-man' });
    const refused = harness(() => json({ code: '55000', message: 'that nomination has already landed; reverse it instead', hint: 'kayfabb.refusal' }, 400));
    expect(await refused.api.replaceSuccessor(4, 'hype-man')).toEqual({ ok: false, error: 'that nomination has already landed; reverse it instead' });
  });

  it('passes an admin function\'s refusal through in the server\'s words, and throws a plain error when the queue cannot be read', async () => {
    const refused = harness(() => json({ code: '42501', message: 'only an admin holds a move', hint: 'kayfabb.refusal' }, 403));
    expect(await refused.api.holdMove(4)).toEqual({ ok: false, error: 'only an admin holds a move' });
    await expect(refused.api.adminQueue()).rejects.toThrow('that could not be read right now; try again');
  });
});

describe('Contact', () => {
  const LINKS = [{ label: 'Discord', href: 'https://discord.gg/x' }, { label: 'Email', href: 'mailto:a@b.c' }];

  it('reads admin_contact and leaves out a row that is not a link', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/admin_contact') ? json([...LINKS, { label: 'No href' }, { href: 'x' }, null, { label: 5, href: 'y' }]) : undefined));
    expect(await h.api.adminContact()).toEqual(LINKS);
    expect(h.to('rpc/admin_contact')).toHaveLength(1);
    const none = harness((r) => (r.url.pathname.endsWith('/rpc/admin_contact') ? json(null) : undefined));
    expect(await none.api.adminContact()).toEqual([]);
  });

  it('writes through set_admin_contact by its parameter name, and answers the links as they read', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/set_admin_contact') ? json(LINKS) : undefined));
    expect(await h.api.setAdminContact([{ label: 'Discord', href: 'https://discord.gg/x', extra: 1 } as never, LINKS[1]!])).toEqual({ ok: true, value: LINKS });
    expect(h.to('rpc/set_admin_contact')[0]?.body).toEqual({ links: LINKS });
    const refused = harness(() => json({ code: '42501', message: 'only an admin sets how to reach one', hint: 'kayfabb.refusal' }, 403));
    expect(await refused.api.setAdminContact([])).toEqual({ ok: false, error: 'only an admin sets how to reach one' });
    const lost = harness(() => new Error('network'));
    expect(await lost.api.setAdminContact([])).toMatchObject({ ok: false, uncertain: true });
  });
});

describe('Updates', () => {
  const ROW = {
    act: A, thread: T, character: B, name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe', title: 'Traps bite', body: 'The trap was offended.',
    changes: [{ label: 'Trap Card', text: 'catches more.' }], at: '2026-11-02T08:00:00+00:00', seq: 2,
  };
  const UPDATE = { act: A, thread: T, character: B, name: 'Gabe', tagline: 'Made this. Sorry.', avatar: 'gabe', title: 'Traps bite', body: 'The trap was offended.', changes: [{ label: 'Trap Card', text: 'catches more.' }], at: '2026-11-02T08:00:00+00:00', seq: 2 };

  it('reads a page through updates, from a cursor, and takes what a row holds as it is', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/updates') ? json([ROW, { ...ROW, act: C, avatar: null, changes: null, tagline: null, seq: 1 }]) : undefined));
    expect(await h.api.updates()).toEqual([UPDATE, { ...UPDATE, act: C, avatar: null, changes: [], tagline: '', seq: 1 }]);
    await h.api.updates('2026-11-02T08:00:00+00:00');
    expect(h.to('rpc/updates').map((r) => r.body)).toEqual([{ before: null, most: 20 }, { before: '2026-11-02T08:00:00+00:00', most: 20 }]);
  });

  it('writes through post_update by its parameter names, and answers the update as it reads it', async () => {
    const h = harness((r) => (r.url.pathname.endsWith('/rpc/post_update') ? json(ROW) : undefined));
    expect(await h.api.postUpdate('Traps bite', 'The trap was offended.', [{ label: 'Trap Card', text: 'catches more.' }])).toEqual({ ok: true, value: UPDATE });
    expect(h.to('rpc/post_update')[0]?.body).toEqual({ title: 'Traps bite', body: 'The trap was offended.', changes: [{ label: 'Trap Card', text: 'catches more.' }] });
    const refused = harness(() => json({ code: '22023', message: 'change 2 has a label and no text; give it a text, or leave the row out', hint: 'kayfabb.refusal' }, 400));
    expect(await refused.api.postUpdate('T', 'B', [])).toEqual({ ok: false, error: 'change 2 has a label and no text; give it a text, or leave the row out' });
    const lost = harness(() => new Error('network'));
    expect(await lost.api.postUpdate('T', 'B', [])).toMatchObject({ ok: false, uncertain: true });
  });

  it('knows the developer as an office of its own', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/characters_public')) return rows([{ id: B, name: 'Gabe', joined: '2026-10-01', staff: 'developer', office: 'developer' }], 1);
      return rows([], 0);
    });
    expect((await h.api.characters([B]))[0]).toMatchObject({ name: 'Gabe', staff: 'developer', office: 'developer' });
  });
});

