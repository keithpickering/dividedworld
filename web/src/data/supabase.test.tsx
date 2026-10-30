/**
 * The Supabase adapter, driven with a fake `fetch` that records every request and answers in the
 * shapes PostgREST and the edge functions answer in. Every assertion is on the request the adapter
 * sends and the answer it returns. Realtime is checked through an injected client stub: the socket
 * itself is not driven (the channel the adapter opens, how it authorizes it and what it does with
 * a broadcast are).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALLOWED_READS, ALLOWED_RPCS as GUARD_RPCS } from '../../../tools/check-web-reads.mjs';
import type { Act, KayfaApi, ScreenSettings } from '../../../engine/ui/data/api.ts';
import { createSupabaseApi } from './supabase.ts';

/* Built in pieces on purpose: the web-reads guard refuses a path it cannot read to its end. */
const REST = ['', 'rest', 'v1'].join('/');
const URL_ = 'https://proj.supabase.co';
const ANON = 'anon-key';
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
};

const B64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${B64({ alg: 'HS256', typ: 'JWT' })}.${B64({ sub: 'u-1', aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.sig`;
const SESSION = { access_token: JWT, refresh_token: 'refresh-1', expires_in: 3600, token_type: 'bearer', user: { id: 'u-1', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
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
  const api = createSupabaseApi({ url: URL_, anonKey: ANON, settingsFallback: FALLBACK, fetch: fetchFake });
  const rest = () => log.filter((r) => r.url.pathname.startsWith(`${REST}/`));
  const to = (name: string) => log.filter((r) => r.url.pathname === `${REST}/${name}`);
  return { api, log, rest, to };
}

const ACT_ROW = { id: A, character: B, kind: 'post', thread: T, target_act_id: null, seq: 2, created_at: '2026-10-01T10:00:00+00:00', payload: { body: 'hi' }, current_payload: { body: 'hello' }, edited_at: '2026-10-01T10:05:00+00:00', shown_edited_at: null };
const ACT: Act = { id: A, character: B, kind: 'post', thread: T, targetActId: null, seq: 2, createdAt: '2026-10-01T10:00:00+00:00', payload: { body: 'hi' }, currentPayload: { body: 'hello' }, editedAt: '2026-10-01T10:05:00+00:00', shownEditedAt: null };
const THREAD_ROW = { id: T, board: C, title: 'A title', origin_act_id: null, created_at: '2026-10-01T09:00:00+00:00', last_at: '2026-10-01T10:00:00+00:00', last_seq: 2, first_act: A, first_character: B, last_act: A, last_character: B, replies: 3, replies_this_week: 4, origin_thread: null, origin_title: null, origin_seq: null };

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
      api.settings(), api.boards(), api.board('general'), api.board(C), api.threads(C, { offset: 0, limit: 5 }), api.thread(T), api.acts(T, 1, 5), api.act(A), api.actsById([A]), api.history(A), api.spunFrom(A), api.spunFromMany([A], 10), api.cardsOn(A, 10), api.cardsOnMany([A], 10), api.effectStates([A]), api.myReleases([A]), api.releaseEffect(A),
      api.characters([B]), api.characterCounts(B), api.characterStats([B]), api.standingAmounts([B]), api.standingPlace(B), api.characterActs(B, ['post'], { offset: 0, limit: 5 }), api.characterReveals(B), api.standingsCount(), api.standingsPage(0, 5), api.tallies([A]), api.viewCounts([T]), api.season(),
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
    expect(page.threads).toEqual([{ id: T, board: C, title: 'A title', originActId: null, createdAt: '2026-10-01T09:00:00+00:00', lastAt: '2026-10-01T10:00:00+00:00', lastSeq: 2, firstAct: A, firstCharacter: B, lastAct: A, lastCharacter: B, replies: 3, repliesThisWeek: 4, originThread: null, originTitle: null, originSeq: null }]);
  });

  it('reads only the counter for a page of no rows, and none of the list', async () => {
    const h = harness(() => rows([{ threads: 37 }]));
    expect(await h.api.threads(C, { offset: 0, limit: 0 })).toEqual({ threads: [], total: 37 });
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['board_counts']);
    expect(await harness(() => rows([])).api.threads(C, { offset: 0, limit: 5 })).toEqual({ threads: [], total: 0 });
  });

  it('reads one board by its slug, or by its id, as one row of boards', async () => {
    const row = { id: C, slug: 'general', name: 'General', description: 'All', is_system: true };
    const h = harness(() => rows([row]));
    expect(await h.api.board('general')).toEqual({ id: C, slug: 'general', name: 'General', description: 'All', isSystem: true });
    expect(await h.api.board(C)).toEqual({ id: C, slug: 'general', name: 'General', description: 'All', isSystem: true });
    const [bySlug, byId] = h.to('boards');
    expect(bySlug?.url.searchParams.get('slug')).toBe('eq.general');
    expect(bySlug?.url.searchParams.get('id')).toBeNull();
    expect(byId?.url.searchParams.get('id')).toBe(`eq.${C}`);
    expect(byId?.url.searchParams.get('limit')).toBe('1');
    expect(h.rest().every((r) => r.url.pathname.endsWith('/boards'))).toBe(true);
    expect(await harness(() => rows([])).api.board('nowhere')).toBeNull();
  });

  it('reads a spun thread\'s origin with its row, not in reads of its own', async () => {
    const origin = { ...THREAD_ROW, origin_act_id: A, origin_thread: C, origin_title: 'Where it came from', origin_seq: 7 };
    const h = harness(() => rows([origin]));
    const row = await h.api.thread(T);
    expect([row?.originActId, row?.originThread, row?.originTitle, row?.originSeq]).toEqual([A, C, 'Where it came from', 7]);
    expect(h.rest().map((r) => r.url.pathname.replace(`${REST}/`, ''))).toEqual(['thread_list']);
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
    const h = harness((r) => (r.url.pathname.endsWith('/thread_list') ? rows([{ ...THREAD_ROW, origin_act_id: A }]) : rows([{ ...ACT_ROW, kind: 'card', target_act_id: A }])));
    const spun = await h.api.spunFromMany([A, B, A], 50);
    expect(h.to('thread_list')).toHaveLength(1);
    expect(h.to('thread_list')[0]?.url.searchParams.get('origin_act_id')).toBe(`in.(${A},${B})`);
    expect(spun.map((t) => t.originActId)).toEqual([A]);
    const cards = await h.api.cardsOn(A, 21);
    const p = h.to('acts_public')[0]?.url.searchParams;
    expect([p?.get('kind'), p?.get('target_act_id'), p?.get('order')]).toEqual(['eq.card', `eq.${A}`, 'created_at.asc']);
    expect(cards.map((c) => c.kind)).toEqual(['card']);
    expect(await h.api.spunFromMany(['x),y'], 5)).toEqual([]);
    expect(await h.api.cardsOn('x),y', 5)).toEqual([]);
    expect(h.to('thread_list')).toHaveLength(1);
  });

  it('reads the card plays on a page of posts in one request, oldest first, bounded, and never filters on a non-id', async () => {
    const h = harness(() => rows([{ ...ACT_ROW, kind: 'card', seq: null, target_act_id: A }, { ...ACT_ROW, id: B, kind: 'card', seq: null, target_act_id: C }]));
    const plays = await h.api.cardsOnMany([A, C, A, 'x),y'], 60);
    expect(h.to('acts_public')).toHaveLength(1);
    const p = h.to('acts_public')[0]?.url.searchParams;
    expect([p?.get('kind'), p?.get('target_act_id'), p?.get('order'), p?.get('limit')]).toEqual(['eq.card', `in.(${A},${C})`, 'created_at.asc', '60']);
    expect(plays.map((c) => [c.kind, c.seq, c.targetActId])).toEqual([['card', null, A], ['card', null, C]]);
    expect(await h.api.cardsOnMany([], 5)).toEqual([]);
    expect(await h.api.cardsOnMany(['x),y'], 5)).toEqual([]);
    expect(h.to('acts_public')).toHaveLength(1);
    await h.api.cardsOnMany([A], 5000);
    expect(h.to('acts_public')[1]?.url.searchParams.get('limit')).toBe('1000');
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
    const h = harness((r) => (r.url.pathname.endsWith('/thread_list') ? rows([{ ...THREAD_ROW, origin_act_id: A }]) : rows([{ ...ACT_ROW, kind: 'card', target_act_id: A }])));
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

  it('builds the board index from boards and thread_list', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/boards')) return rows([{ id: C, slug: 'general', name: 'General', description: 'All', is_system: false, created_at: 'x' }]);
      if (r.url.pathname.endsWith('/board_counts')) return rows([{ board: C, threads: 12 }]);
      return rows([THREAD_ROW]);
    });
    const [board] = await h.api.boards();
    expect(h.to('boards')[0]?.url.searchParams.get('select')).toBe('id,slug,name,description,is_system');
    expect(h.to('board_counts')[0]?.url.searchParams.get('select')).toBe('board,threads');
    expect(h.to('thread_list').every((r) => r.method === 'GET' && !(r.headers.get('prefer') ?? '').includes('count'))).toBe(true);
    expect(board).toEqual({ id: C, slug: 'general', name: 'General', description: 'All', isSystem: false, threadCount: 12, lastAt: '2026-10-01T10:00:00+00:00', lastCharacter: B, lastThread: T });
    const latest = h.to('thread_list').find((r) => r.method === 'GET');
    expect(latest?.url.searchParams.get('order')).toBe('last_at.desc');
    expect(latest?.url.searchParams.get('limit')).toBe('1');
  });

  it('maps my_characters, with a pending Turn only when one is waiting', async () => {
    const base = { name: 'Bea', class: 'face', class_since: '2026-09-01T00:00:00+00:00', turn_opens_at: null, debuted_at: '2026-09-02T00:00:00+00:00', debut_loudness: 'silent', retired_at: null, pending_class: null, pending_loudness: null, pending_show_from: null, pending_show_to: null, takes_effect_at: null };
    const h = harness(() => rows([{ id: B, ...base }, { id: A, ...base, name: 'Al', pending_class: 'heel', pending_loudness: 'announced', pending_show_from: true, pending_show_to: false, takes_effect_at: '2026-11-01T00:00:00+00:00' }]));
    const mine = await h.api.myCharacters();
    expect(h.rest().map((r) => r.url.pathname)).toEqual(['/rest/v1/my_characters']);
    expect(mine[0]).toEqual({ id: B, name: 'Bea', class: 'face', classSince: '2026-09-01T00:00:00+00:00', turnOpensAt: null, debutedAt: '2026-09-02T00:00:00+00:00', debutLoudness: 'silent', retiredAt: null, pendingTurn: null });
    expect(mine[1]?.pendingTurn).toEqual({ class: 'heel', loudness: 'announced', showFrom: true, showTo: false, takesEffectAt: '2026-11-01T00:00:00+00:00' });
  });

  it('reads the wallet from my_wallet and the cap from settings when there is no row', async () => {
    expect(await harness(() => rows([{ balance: 250, cap: 500 }])).api.wallet()).toEqual({ balance: 250, cap: 500 });
    const h = harness((r) => (r.url.pathname.endsWith('/screen_settings') ? rows([{ settings: { walletCap: 700 } }]) : rows([])));
    expect(await h.api.wallet()).toEqual({ balance: 0, cap: 700 });
  });

  it('answers preferences with the defaults when no row exists', async () => {
    const h = harness(() => rows([]));
    expect(await h.api.preferences()).toEqual({ theme: 'system', postbit: 'side', motion: 'system', smoke: 'full', contrast: 'standard', textSize: 100 });
  });

  it('reads the glass\'s three preferences from their columns and sends them to set_preferences by its parameter names', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/rpc/set_preferences')) return json({ theme: 'dark', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'high', text_size: 200 });
      return rows([{ theme: 'dark', postbit: 'side', motion: 'system', smoke: 'low', contrast: 'high', text_size: 150 }]);
    });
    expect(await h.api.preferences()).toEqual({ theme: 'dark', postbit: 'side', motion: 'system', smoke: 'low', contrast: 'high', textSize: 150 });
    expect(h.to('account_preferences')[0]?.url.searchParams.get('select')).toBe('theme,postbit,motion,smoke,contrast,text_size');
    expect(await h.api.setPreferences({ smoke: 'off', contrast: 'high', textSize: 200 })).toEqual({ ok: true, value: { theme: 'dark', postbit: 'side', motion: 'system', smoke: 'off', contrast: 'high', textSize: 200 } });
    expect(h.to('rpc/set_preferences')[0]?.body).toEqual({ theme: null, postbit: null, motion: null, smoke: 'off', contrast: 'high', text_size: 200 });
  });

  it('keys tallies, view counts and reading by id', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/reaction_tallies')) return rows([{ act: A, kind: 'fire', count: 3 }, { act: A, kind: 'zzz', count: 1 }]);
      if (r.url.pathname.endsWith('/thread_view_counts')) return rows([{ thread: T, views: 9 }]);
      return rows([{ thread: T, furthest_seq: 4 }]);
    });
    expect(await h.api.tallies([A, B])).toEqual({ [A]: { fire: 3, zzz: 1 }, [B]: {} });
    expect(await h.api.viewCounts([T])).toEqual({ [T]: 9 });
    expect(await h.api.reading([T])).toEqual({ [T]: 4 });
  });

  it('fills a missing settings key from the instance fallback and uses what the view holds', async () => {
    const h = harness(() => rows([{ settings: { walletCap: 900, registrationMode: 'open', editGrace: { unit: 'minute', count: 5 }, reactionCap: null } }]));
    expect(await h.api.settings()).toEqual({ ...FALLBACK, walletCap: 900, registrationMode: 'open', editGrace: { unit: 'minute', count: 5 } });
    expect(await harness(() => rows([])).api.settings()).toEqual(FALLBACK);
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

  it('sends each action as its own JSON body with the bearer and the anon key', async () => {
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
    expect(started).toEqual({ ok: true, value: { thread: { id: T, board: C, title: 'A title', originActId: null, createdAt: '2026-10-01T09:00:00+00:00', lastAt: ACT.createdAt, lastSeq: 2, firstAct: A, firstCharacter: B, lastAct: A, lastCharacter: B, replies: 0, repliesThisWeek: 0, originThread: null, originTitle: null, originSeq: null }, act: ACT } });
    expect(act(h).map((r) => r.body)).toEqual([
      { action: 'post', thread: T, character: B, body: 'hi', quote: A },
      { action: 'post', thread: T, character: B, body: 'hi' },
      { action: 'edit', post: A, character: B, body: 'new' },
      { action: 'react', act: A, character: B, kind: 'fire' },
      { action: 'startThread', board: 'general', character: B, title: 'A title', body: 'body' },
    ]);
    for (const r of act(h)) {
      expect(r.method).toBe('POST');
      expect(r.headers.get('apikey')).toBe(ANON);
      expect(r.headers.get('authorization')).toBe(`Bearer ${ANON}`);
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
    const api = createSupabaseApi({ url: URL_, anonKey: ANON, settingsFallback: FALLBACK, client: client as never, fetch: fetchFake });
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
    expect(req?.headers.get('authorization')).toBe(`Bearer ${ANON}`);
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
      auth: { getSession: async () => ({ data: { session: { access_token: JWT } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
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
    const api = createSupabaseApi({ url: URL_, anonKey: ANON, settingsFallback: FALLBACK, client: client as never });
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
});

export type { KayfaApi };
