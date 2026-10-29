/**
 * The Supabase adapter, driven with a fake `fetch` that records every request and answers in the
 * shapes PostgREST and the edge functions answer in. Every assertion is on the request the adapter
 * sends and the answer it returns. Realtime is checked through an injected client stub: the socket
 * itself is not driven (the channel the adapter opens, how it authorizes it and what it does with
 * a broadcast are).
 */
import { describe, expect, it, vi } from 'vitest';
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
const THREAD_ROW = { id: T, board: C, title: 'A title', origin_act_id: null, created_at: '2026-10-01T09:00:00+00:00', last_at: '2026-10-01T10:00:00+00:00', last_seq: 2, first_act: A, first_character: B, last_act: A, last_character: B, replies_this_week: 4 };

/** Everything a read can name, answered with an empty list or a plain value. */
const ALLOWED_TABLES = new Set(['boards', 'threads', 'thread_list', 'acts_public', 'characters_public', 'character_profiles', 'class_kinds', 'reaction_kinds', 'card_kinds', 'reaction_tallies', 'effect_state', 'pip_styles', 'thread_view_counts', 'seasons', 'settlements', 'standings', 'season_standings', 'class_reveals', 'turns_announced', 'screen_settings', 'my_characters', 'my_wallet', 'my_ledger', 'my_wallet_events', 'my_cards', 'my_reactions', 'my_invites', 'reading', 'account_preferences', 'effect_releases']);
const ALLOWED_RPCS = new Set(['whoami', 'is_admin', 'next_settlement_at', 'mark_read', 'set_preferences', 'set_profile', 'release_effect', 'card_target']);

import { beforeEach } from 'vitest';

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
      api.settings(), api.boards(), api.threads(C, { offset: 0, limit: 5 }), api.thread(T), api.acts(T, 1, 5), api.act(A), api.history(A), api.spunFrom(A),
      api.characters([B]), api.characterCounts(B), api.characterActs(B, ['post'], { offset: 0, limit: 5 }), api.tallies([A]), api.viewCounts([T]), api.season(),
      api.standings(), api.lastSettledAt(), api.classReveals([B]), api.turnsAnnounced([B]), api.nextSettlementAt(), api.myCharacters(), api.wallet(),
      api.myReactions([A]), api.myCards(), api.reading([T]), api.preferences(), api.invites(), api.isAdmin(), api.session(), api.estimate(),
    ]);
    const tables = new Set(h.rest().filter((r) => !r.url.pathname.includes('/rpc/')).map((r) => r.url.pathname.replace(`${REST}/`, '')));
    expect(tables.size).toBeGreaterThan(15);
    for (const t of tables) expect(ALLOWED_TABLES.has(t), `read of ${t}`).toBe(true);
    const rpcs = h.rest().filter((r) => r.url.pathname.includes('/rpc/')).map((r) => r.url.pathname.replace(`${REST}/rpc/`, ''));
    expect(rpcs.length).toBeGreaterThan(0);
    for (const f of rpcs) expect(ALLOWED_RPCS.has(f), `rpc ${f}`).toBe(true);
    expect(h.log.filter((r) => r.url.pathname.startsWith('/auth/v1/otp') || r.url.pathname.startsWith('/auth/v1/verify'))).toEqual([]);
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
  it('maps a thread page from thread_list, newest first, with the total', async () => {
    const h = harness(() => rows([THREAD_ROW], 37));
    const page = await h.api.threads(C, { offset: 10, limit: 10 });
    const [req] = h.to('thread_list');
    expect(req?.url.searchParams.get('board')).toBe(`eq.${C}`);
    expect(req?.url.searchParams.get('order')).toBe('last_at.desc');
    expect(req?.url.searchParams.get('offset')).toBe('10');
    expect(req?.url.searchParams.get('limit')).toBe('10');
    expect(page.total).toBe(37);
    expect(page.threads).toEqual([{ id: T, board: C, title: 'A title', originActId: null, createdAt: '2026-10-01T09:00:00+00:00', lastAt: '2026-10-01T10:00:00+00:00', lastSeq: 2, firstAct: A, firstCharacter: B, lastAct: A, lastCharacter: B, repliesThisWeek: 4 }]);
  });

  it('reads a thread range from acts_public by seq, leaving edits out', async () => {
    const h = harness(() => rows([ACT_ROW]));
    const acts = await h.api.acts(T, 3, 9);
    const [req] = h.to('acts_public');
    const p = req?.url.searchParams;
    expect(p?.get('thread')).toBe(`eq.${T}`);
    expect(p?.getAll('seq')).toEqual(['gte.3', 'lte.9']);
    expect(p?.get('kind')).toBe('neq.edit');
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

  it('refuses to put a non-id into a filter', async () => {
    const h = harness(() => rows([ACT_ROW]));
    expect(await h.api.history('x),id.neq.(y')).toEqual([]);
    expect(h.rest()).toEqual([]);
  });

  it('joins characters_public with character_profiles in two reads and defaults an absent profile', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/characters_public')) return rows([{ id: B, name: 'Bea' }, { id: A, name: 'Al' }]);
      return rows([{ character: B, title: 'Champ', signature: '[b]hi[/b]', avatar_square: 'sq.webp', avatar_portrait: 'po.webp', square_frame: { x: 0, y: 0, w: 0.5, h: 0.5 }, portrait_frame: null, pip_style: 'fancy' }]);
    });
    const list = await h.api.characters([B, A]);
    expect(h.to('characters_public')[0]?.url.searchParams.get('id')).toBe(`in.(${B},${A})`);
    expect(h.to('character_profiles')[0]?.url.searchParams.get('character')).toBe(`in.(${B},${A})`);
    expect(list).toEqual([
      { id: B, name: 'Bea', title: 'Champ', signature: '[b]hi[/b]', avatarSquare: `${URL_}/storage/v1/object/public/avatars/sq.webp`, avatarPortrait: `${URL_}/storage/v1/object/public/avatars/po.webp`, squareFrame: { x: 0, y: 0, w: 0.5, h: 0.5 }, portraitFrame: null, pipStyle: 'fancy' },
      { id: A, name: 'Al', title: '', signature: '', avatarSquare: null, avatarPortrait: null, squareFrame: null, portraitFrame: null, pipStyle: 'default' },
    ]);
  });

  it('builds the board index from boards and thread_list', async () => {
    const h = harness((r) => {
      if (r.url.pathname.endsWith('/boards')) return rows([{ id: C, slug: 'general', name: 'General', description: 'All', is_system: false, created_at: 'x' }]);
      if (r.headers.get('prefer')?.includes('count=exact') && r.method === 'HEAD') return rows([], 12);
      return rows([THREAD_ROW]);
    });
    const [board] = await h.api.boards();
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
    expect(await h.api.preferences()).toEqual({ theme: 'system', postbit: 'side', motion: 'system' });
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

  it('does not retry a read the server refused', async () => {
    const h = harness(() => json({ code: '42501', message: 'permission denied for table x', hint: null }, 403));
    await expect(h.api.act(A)).rejects.toThrow();
    expect(h.to('acts_public')).toHaveLength(1);
  });

  it('never resends a write: a 503 passes its words through, a thrown fetch says it may have gone through', async () => {
    const words = 'no answer came back, so this may have gone through: look before you try again';
    const lost = harness(() => json({ error: words }, 503));
    expect(await lost.api.post(T, B, 'hi', null)).toEqual({ ok: false, error: words });
    expect(lost.log.filter((r) => r.url.pathname === '/functions/v1/act')).toHaveLength(1);

    const thrown = harness(() => new TypeError('network'));
    const r = await thrown.api.react(A, B, 'fire');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('may have gone through');
    expect(thrown.log.filter((x) => x.url.pathname === '/functions/v1/act')).toHaveLength(1);

    const rpcDown = harness(() => json({ message: 'down' }, 503));
    expect((await rpcDown.api.setPreferences({ theme: 'dark' })).ok).toBe(false);
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
    expect(started).toEqual({ ok: true, value: { thread: { id: T, board: C, title: 'A title', originActId: null, createdAt: '2026-10-01T09:00:00+00:00', lastAt: ACT.createdAt, lastSeq: 2, firstAct: A, firstCharacter: B, lastAct: A, lastCharacter: B, repliesThisWeek: 0 }, act: ACT } });
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
