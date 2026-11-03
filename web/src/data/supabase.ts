/**
 * The Supabase adapter: `KayfaApi` (engine/ui/data/api.ts) on `@supabase/supabase-js`.
 *
 * This is the one place a Supabase client lives ("Portable by construction"), and it reads only
 * what tools/check-web-reads.mjs allows: public projections and the signed-in player's own rows.
 * Every write goes through the `act` function (it validates and sends the broadcasts) except the
 * fourteen rpcs that have no `act` equivalent (mark_read, set_preferences, meet_card, see_alerts, see_settlement, see_welcome, see_tip, resume_tips,
 * skip_tips, restore_tips, replay_tour, set_profile, release_effect, post_update, which is an admin's alone) and the
 * avatar, which is a multipart form to the `avatar` function. Sign-in goes through the `account`
 * function only; Auth's own code endpoints are never called, and the session the `account` function
 * answers with is installed with `auth.setSession`.
 *
 * Failures, in three kinds:
 * - A refusal: an edge function's 4xx `{error, field?}`, or a direct rpc's PostgREST error that
 *   carries the hint `kayfabb.refusal`, is the server's own words for the player, and is passed
 *   through as `{ok: false, error, field?}`.
 * - Anything else is a plain refusal in words written here that quote nothing from inside: no
 *   PostgREST detail, no table or constraint name.
 * - A read that fails in transport (the fetch threw, or a 5xx) is retried once on the request
 *   itself; a second failure throws. A write is never resent: the `act` function says a lost
 *   answer "may have gone through: look before you try again", and a repeat is the player's
 *   decision after looking. ("Three unrelated timeouts are not a poison pill".)
 *
 * No read counts rows. A count over a table that grows with the game (a board's threads, a character's
 * Acts, the season's characters) is work per view that grows with the instance, so every total a screen
 * shows is a counter a trigger keeps (board_counts, character_post_counts, season_size) or comes
 * from an index range on the server (standing_place, standings_page); tools/check-web-reads.mjs refuses a `count` option.
 *
 * Nothing sent here carries the HUD's character beyond the request body the action needs: it is
 * never in a URL, a header or a channel name.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_PREFERENCES, LOST_ANSWER, SPUN_FROM_MAX } from '../../../engine/ui/data/api.ts';
import { readLogPage, type LedgerRow, type ShareRow } from '../../../engine/ui/data/log-page.ts';
import { buildMoveNotice, toDemand, toProgress } from '../../../engine/ui/data/moves.ts';
import { ALERTS_PAGE, ALERTS_UNREAD_BOUND, MOVES_LOG_PAGE, SEASON_NEWS_PAGE, UPDATES_PAGE } from '../../../engine/ui/data/api.ts';
import { ALERT_KINDS, type AlertKind } from '../../../engine/rules/alerts.ts';
import type {
  AdminQueue, BoardName, MoveEnded, MoveInForce, MoveLogRow, MovesLog, QueuedMove, StaffProfile,
  Act, ActKind, Answer, AvatarUpload, Board, Bought, BoardSummary, CardEvent, CaughtPlay, Character, CharacterCounts, ClassReveal, CreatedCharacter, Estimate, EstimateLine, FaceDownEnd, FaceDownPass,
  Alert, EffectState, SeasonNewsItem, SeasonResult, SeasonShown, TallyName, Update, FollowedThread, Frame, HeldCard, Id, KayfaApi, MyCharacter, MyInvite, MyReaction, PendingTurn, PinnedThread, PlayAbove, Preferences, Refusal, ScreenSettings, Season, Session, Standing,
  Tally, StandingPlace, ThreadSummary, TurnAnnounced, TurnAsked, Wallet, WalletEvent,
} from '../../../engine/ui/data/api.ts';

export interface SupabaseApiOptions {
  readonly url: string;
  readonly publishableKey: string;
  /** The instance's compiled defaults: used for a key screen_settings does not hold. */
  readonly settingsFallback: ScreenSettings;
  /** For tests; the platform's `fetch` otherwise. */
  readonly fetch?: typeof fetch;
  /** For tests of the live channels: a client made elsewhere. */
  readonly client?: SupabaseClient;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const REFUSAL_HINT = 'kayfabb.refusal';
const LOST = LOST_ANSWER;
const NOT_DONE = 'that could not be done right now; try again';
const NOT_READ = 'that could not be read right now; try again';
/** The Acts that are layers on a post, read through it: a card play, a card set face down, and the spring that reveals one (0054). */
const LAYER_KINDS = ['card', 'set', 'spring'];
/** PostgREST answers at most this many rows to one request unless told fewer; every list read here asks for fewer, ordered. */
const ROW_CAP = 1000;
const rowLimit = (n: number) => Math.max(1, Math.min(Math.floor(n), ROW_CAP));
/** The most ids one read by id names, so its address stays short whoever asks (a page of the log can name a thousand Acts). */
const ID_CHUNK = 100;
const chunks = <T,>(xs: readonly T[]): T[][] => Array.from({ length: Math.ceil(xs.length / ID_CHUNK) }, (_, i) => xs.slice(i * ID_CHUNK, (i + 1) * ID_CHUNK));
/**
 * A read by many ids, one request per chunk of them, run together. Every list a read by id takes can grow on a busy
 * instance (a page's plays, a gap of missed posts), so none goes into one address (#104; tools/check-id-reads.mjs holds
 * it). One chunk's failure fails the whole read: a missing chunk would read as no reactions, or a reader held again.
 */
const byChunks = async <I, T>(ids: readonly I[], read: (part: I[]) => Promise<T[]>): Promise<T[]> => (await Promise.all(chunks([...new Set(ids)]).map(read))).flat();
/** Code-point order, never a locale's: a timestamp PostgREST writes (one offset, trailing zeros trimmed) and a lowercase uuid sort as the server sorts them. */
const byCodePoint = (a: unknown, b: unknown): number => {
  const x = String(a ?? '');
  const y = String(b ?? '');
  return x < y ? -1 : x > y ? 1 : 0;
};
/**
 * The rows of an ordered read asked of each chunk, as one query would answer them: sorted by `column` ascending, then
 * by `key` (the row's id), so ties fall the same way on every screen, and cut to `limit`. Each chunk was asked for the
 * whole limit, since one chunk can hold every one of the top rows.
 */
const merged = <R extends Record<string, unknown>>(rows: readonly R[], column: keyof R, key: keyof R, limit?: number): R[] => {
  const out = [...rows].sort((a, b) => byCodePoint(a[column], b[column]) || byCodePoint(a[key], b[key]));
  return limit === undefined ? out : out.slice(0, limit);
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ------------------------------------------------------------------- row mappers ---- */

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** A jsonb object of numbers by key (a ledger row's `params`, 0073), or null where it is none or holds anything else. */
const numbers = (v: unknown): Readonly<Record<string, number>> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'number' && Number.isFinite(x)) ? v as Record<string, number> : null;

/** A row of account_preferences, or set_preferences' answer, in the screens' words; a column it lacks is its default. */
function toPreferences(r: Row): Preferences {
  const d = DEFAULT_PREFERENCES;
  return {
    theme: r['theme'] ?? d.theme, postbit: r['postbit'] ?? d.postbit, motion: r['motion'] ?? d.motion,
    smoke: r['smoke'] ?? d.smoke, contrast: r['contrast'] ?? d.contrast, textSize: num(r['text_size'], d.textSize) as Preferences['textSize'],
    cardsMet: Array.isArray(r['cards_met']) ? r['cards_met'].filter((k): k is string => typeof k === 'string') : d.cardsMet,
    alertsSeenAt: str(r['alerts_seen_at']), settlementSeen: str(r['settlement_seen']),
    /* A kind this build does not know (a newer server's) is no kind here; a choice never made stays null, which is not an empty one. */
    toasts: Array.isArray(r['toasts']) ? r['toasts'].filter((k): k is AlertKind => (ALERT_KINDS as readonly unknown[]).includes(k)) : null,
    welcomedAt: str(r['welcomed_at']), tips: r['tips'] === 'off' ? 'off' : d.tips,
    tipsSeen: Array.isArray(r['tips_seen']) ? r['tips_seen'].filter((k): k is string => typeof k === 'string') : d.tipsSeen,
  };
}

/** Where a play beyond a post goes, as the act function reads it (engine/rules/actions.ts): nothing for a post's. */
const beyond = (reach: string | undefined, fromPost: string | undefined): Record<string, unknown> =>
  (reach && reach !== 'post' ? { reach, ...(fromPost ? { post: fromPost } : {}) } : {});

function toAct(r: Row): Act {
  return {
    id: r['id'],
    character: r['character'] ?? null,
    kind: r['kind'] as ActKind,
    thread: r['thread'],
    targetActId: r['target_act_id'] ?? null,
    seq: r['seq'] ?? null,
    createdAt: r['created_at'],
    payload: r['payload'] ?? {},
    currentPayload: r['current_payload'] ?? r['payload'] ?? {},
    editedAt: r['edited_at'] ?? null,
    shownEditedAt: r['shown_edited_at'] ?? null,
  };
}

/** One row of `updates`, or post_update's answer, which is the same row. A change that is not a { label, text } of words is no line. */
function toUpdate(r: Row): Update {
  const changes = Array.isArray(r['changes']) ? (r['changes'] as Row[]) : [];
  return {
    act: r['act'], thread: r['thread'], character: r['character'], name: String(r['name'] ?? ''), tagline: String(r['tagline'] ?? ''), avatar: str(r['avatar']),
    title: String(r['title'] ?? ''), body: String(r['body'] ?? ''),
    changes: changes.filter((c) => typeof c?.['text'] === 'string').map((c) => ({ label: typeof c['label'] === 'string' ? c['label'] : '', text: String(c['text']) })),
    at: String(r['at']), seq: num(r['seq']),
  };
}

/** The names a tally Act holds under `key`; an entry with no id or name is no line. A class is kept only where the entry says it. */
function toTallyNames(v: unknown): TallyName[] {
  return (Array.isArray(v) ? (v as Row[]) : []).flatMap((e) => (typeof e?.['character'] === 'string' && typeof e['name'] === 'string'
    ? [{ character: e['character'], name: e['name'], class: str(e['class']), was: str(e['was']) }] : []));
}
/** One row of `season_news` (0063). Its public detail is read as the Acts wrote it; what is not in the shape is left out. */
function toSeasonNews(r: Row): SeasonNewsItem {
  const detail = (r['detail'] ?? {}) as Row;
  const top = (Array.isArray(detail['top']) ? (detail['top'] as Row[]) : []).flatMap((t): SeasonResult[] => (typeof t?.['character'] === 'string'
    ? [{
      character: t['character'], name: String(t['name'] ?? ''), place: num(t['place']), standing: num(t['standing']),
      shown: (Array.isArray(t['shown']) ? (t['shown'] as Row[]) : []).flatMap((x): SeasonShown[] => (x?.['kind'] === 'reveal' || x?.['kind'] === 'turn'
        ? [{ kind: x['kind'], act: String(x['act']), at: String(x['at']), class: str(x['class']), was: str(x['was']) }] : [])),
    }] : []));
  return {
    kind: r['kind'], act: r['act'] ?? null, thread: r['thread'] ?? null, seq: r['seq'] === null || r['seq'] === undefined ? null : num(r['seq']), at: String(r['at']),
    season: num(r['season']), name: str(r['name']), quote: str(r['quote']), count: r['count'] === null || r['count'] === undefined ? null : num(r['count']),
    top, debuts: toTallyNames(detail['debuts']), turns: toTallyNames(detail['turns']),
  };
}

function toThread(r: Row): ThreadSummary {
  return {
    id: r['id'],
    board: r['board'],
    title: r['title'],
    originActId: r['origin_act_id'] ?? null,
    createdAt: r['created_at'],
    lastAt: r['last_at'],
    lastSeq: num(r['last_seq']),
    replies: num(r['replies']),
    firstAct: r['first_act'] ?? null,
    firstCharacter: r['first_character'] ?? null,
    lastAct: r['last_act'] ?? null,
    lastCharacter: r['last_character'] ?? null,
    repliesThisWeek: num(r['replies_this_week']),
    originThread: r['origin_thread'] ?? null,
    originTitle: r['origin_title'] ?? null,
    originSeq: r['origin_seq'] === null || r['origin_seq'] === undefined ? null : num(r['origin_seq']),
  };
}

/**
 * The thread an `act` answer carries (it holds no list columns), with its first Act filled in. It
 * does not know a spun thread's origin (the answer names the Act, not its thread's title), so those
 * three are null here; the list reads them with the row.
 */
function toNewThread(t: Row, first: Act): ThreadSummary {
  return {
    id: t['id'],
    board: t['board'],
    title: t['title'],
    originActId: t['origin_act_id'] ?? null,
    createdAt: t['created_at'],
    lastAt: first.createdAt,
    lastSeq: first.seq ?? 1,
    replies: 0,
    firstAct: first.id,
    firstCharacter: first.character,
    lastAct: first.id,
    lastCharacter: first.character,
    repliesThisWeek: 0,
    originThread: null,
    originTitle: null,
    originSeq: null,
  };
}

function toBoard(r: Row): Board {
  return { id: r['id'], slug: r['slug'], name: r['name'], description: r['description'] ?? '', isSystem: r['is_system'] === true, moveAct: r['move_act'] ?? null };
}

function toFrame(v: unknown): Frame | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Row;
  return [f['x'], f['y'], f['w'], f['h']].every((n) => typeof n === 'number' && Number.isFinite(n)) ? { x: f['x'], y: f['y'], w: f['w'], h: f['h'] } : null;
}

const orNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const params = (v: unknown): Readonly<Record<string, unknown>> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function toQueued(r: Row): QueuedMove {
  return {
    id: num(r['id']), staff: String(r['staff'] ?? ''), boss: orNull(r['boss']), kind: String(r['kind'] ?? ''), params: params(r['params']), demand: toDemand(r['demand']),
    why: String(r['why'] ?? ''), goLiveAt: String(r['goLiveAt'] ?? ''), expiresAt: orNull(r['expiresAt']), structural: r['structural'] === true, boardName: orNull(r['boardName']),
    failedAt: orNull(r['failedAt']), failure: orNull(r['failure']), replacedAt: orNull(r['replacedAt']),
  };
}

function toInForce(r: Row): MoveInForce {
  return {
    act: r['act'], id: typeof r['id'] === 'number' ? r['id'] : null, staff: orNull(r['staff']), boss: orNull(r['boss']), kind: String(r['kind'] ?? ''), params: params(r['params']),
    demand: toDemand(r['demand']), why: orNull(r['why']), landedAt: String(r['landedAt'] ?? ''), expiresAt: orNull(r['expiresAt']), progress: toProgress(r['progress']),
  };
}

function toEnded(r: Row): MoveEnded {
  const how = r['how'];
  return {
    how: how === 'met' || how === 'expired' || how === 'reversed' || how === 'superseded' || how === 'spent' ? how : 'held', by: orNull(r['by']), at: String(r['at'] ?? ''), act: orNull(r['act']),
    id: typeof r['id'] === 'number' ? r['id'] : null, staff: orNull(r['staff']), boss: orNull(r['boss']), kind: String(r['kind'] ?? ''), params: params(r['params']),
    demand: toDemand(r['demand']), why: orNull(r['why']), landedAt: orNull(r['landedAt']),
  };
}

function toMyCharacter(r: Row): MyCharacter {
  const pending: PendingTurn | null = r['pending_class']
    ? {
        class: r['pending_class'],
        loudness: r['pending_loudness'] === 'silent' ? 'silent' : 'announced',
        showFrom: r['pending_show_from'] === true,
        showTo: r['pending_show_to'] === true,
        takesEffectAt: r['takes_effect_at'] ?? null,
      }
    : null;
  return {
    id: r['id'],
    name: r['name'],
    class: r['class'],
    classSince: r['class_since'],
    classDueAt: r['class_due_at'] ?? null,
    turnOpensAt: r['turn_opens_at'] ?? null,
    debutedAt: r['debuted_at'] ?? null,
    debutLoudness: r['debut_loudness'] ?? null,
    retiredAt: r['retired_at'] ?? null,
    pendingTurn: pending,
    presenceHidden: r['presence_hidden'] === true,
  };
}

function toEstimate(r: Row): Estimate {
  const lines = (Array.isArray(r['lines']) ? r['lines'] : []).map((l: Row): EstimateLine => ({
    character: l['character'],
    reason: l['reason'],
    amount: l['amount'],
    ...(l['act'] !== undefined && l['act'] !== null ? { act: l['act'] } : {}),
    ...(l['quadrant'] !== undefined && l['quadrant'] !== null ? { quadrant: l['quadrant'] } : {}),
    ...(typeof l['at'] === 'number' ? { at: l['at'] } : {}),
  }));
  const entries = (Array.isArray(r['entries']) ? r['entries'] : []).map((e: Row) => ({ character: e['character'], reason: e['reason'], amount: e['amount'] }));
  return { entries, lines, asOf: r['asOf'] ?? null, freshAfter: r['freshAfter'] ?? null };
}

/* ---------------------------------------------------------------------- the adapter ---- */

type Res = { data: unknown; error: { message: string; hint?: string | null } | null; status: number };

export function createSupabaseApi(options: SupabaseApiOptions): KayfaApi {
  const { url, publishableKey, settingsFallback } = options;
  const doFetch: typeof fetch = options.fetch ?? ((...a) => globalThis.fetch(...a));
  // supabase-js sends its key as the bearer where there is no session; a publishable key goes in apikey alone (Supabase's
  // migration guide, docs/plans/2026-11-02-api-keys-design.md), so a bearer that is the key itself is taken off. A session's
  // token is passed on as it is.
  const clientFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (headers.get('authorization') !== `Bearer ${publishableKey}`) return doFetch(input, init);
    headers.delete('authorization');
    return doFetch(input, { ...init, headers });
  };
  const client: SupabaseClient =
    options.client ??
    createClient(url, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: clientFetch },
    });
  const avatarUrl = (key: string | null): string | null => (key ? `${url}/storage/v1/object/public/avatars/${key}` : null);

  /* ------------------------------------------------------------- the request layer ---- */

  const transport = (r: Res) => r.error !== null && (r.status === 0 || r.status >= 500);

  /** A read, retried once on the request itself when it failed in transport; a second failure throws plain words. */
  async function read(run: () => PromiseLike<unknown>, pastEnd = false): Promise<Res> {
    const once = async (): Promise<Res> => {
      try {
        return (await run()) as Res;
      } catch {
        return { data: null, error: { message: 'transport' }, status: 0 };
      }
    };
    let r = await once();
    if (transport(r)) r = await once();
    /* A range that starts past the end is PostgREST's 416: for a page, that is an empty page. */
    if (r.error && !(pastEnd && r.status === 416)) throw new Error(NOT_READ);
    return r;
  }
  const list = async (run: () => PromiseLike<unknown>): Promise<Row[]> => {
    const r = await read(run);
    return Array.isArray(r.data) ? (r.data as Row[]) : [];
  };
  /** Every row a read names, a page of rows at a time (the server returns at most `ROW_CAP` at once); `run` reads the rows from `start` to `end`. */
  const every = async (run: (start: number, end: number) => PromiseLike<unknown>): Promise<Row[]> => {
    const out: Row[] = [];
    for (let start = 0; ; start += ROW_CAP) {
      const r = await read(() => run(start, start + ROW_CAP - 1), true);
      const page = Array.isArray(r.data) ? (r.data as Row[]) : [];
      out.push(...page);
      if (page.length < ROW_CAP) return out;
    }
  };

  /** The bearer: the session's access token, or null signed out, when the publishable key in apikey is the whole of the call's credentials. */
  async function bearer(): Promise<string | null> {
    try {
      return (await client.auth.getSession()).data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  const refusal = (error: string, field?: string): Refusal => (field ? { ok: false, error, field } : { ok: false, error });
  /** No answer came back from a write: it may have gone through, and the caller looks before it tries again. */
  const uncertain = (): Refusal => ({ ok: false, error: LOST, uncertain: true });

  /** One POST to an edge function. `resend` is true only for a read (the estimate), never for a write. */
  async function edge(fn: string, body: unknown, lost: string, resend = false): Promise<Answer<Row>> {
    const token = await bearer();
    const send = async (): Promise<{ status: number; text: string } | null> => {
      try {
        const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
        const res = await doFetch(`${url}/functions/v1/${fn}`, {
          method: 'POST',
          headers: { apikey: publishableKey, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(isForm ? {} : { 'content-type': 'application/json' }) },
          body: isForm ? (body as FormData) : JSON.stringify(body),
        });
        return { status: res.status, text: await res.text() };
      } catch {
        return null;
      }
    };
    let got = await send();
    if (resend && (got === null || got.status >= 500)) got = await send();
    if (got === null) return resend || lost !== LOST ? refusal(lost) : uncertain();
    let parsed: Row | null = null;
    try {
      const p: unknown = JSON.parse(got.text);
      parsed = p && typeof p === 'object' && !Array.isArray(p) ? (p as Row) : null;
    } catch {
      parsed = null;
    }
    if (got.status >= 200 && got.status < 300 && parsed) return { ok: true, value: parsed };
    const words = parsed ? str(parsed['error']) : null;
    /* A 5xx from a write is an answer that may not say whether it was done: its words are shown, and the caller looks before it resends. */
    if (got.status >= 500 && !resend && lost === LOST) return { ok: false, error: words ?? LOST, uncertain: true };
    if (words) return refusal(words, str(parsed?.['field']) ?? undefined);
    return refusal(got.status >= 500 ? lost : NOT_DONE);
  }

  /** A direct rpc that writes: its refusals are the server's words, a lost answer is never resent. */
  async function rpcWrite(run: () => PromiseLike<unknown>): Promise<Answer<Row>> {
    let r: Res;
    try {
      r = (await run()) as Res;
    } catch {
      return uncertain();
    }
    if (!r.error) return { ok: true, value: (r.data && typeof r.data === 'object' ? r.data : {}) as Row };
    if (r.error.hint === REFUSAL_HINT && r.error.message) return refusal(r.error.message);
    return r.status === 0 || r.status >= 500 ? uncertain() : refusal(NOT_DONE);
  }

  /* ----------------------------------------------------------------- session ---- */

  async function currentSession(): Promise<Session> {
    const { data } = await client.auth.getSession();
    if (!data.session) return { signedIn: false, account: null };
    const r = await read(() => client.rpc('whoami'));
    return { signedIn: true, account: typeof r.data === 'string' ? r.data : null };
  }

  /* ---------------------------------------------------------------- settings ---- */

  let settingsOnce: Promise<ScreenSettings> | null = null;
  function settings(): Promise<ScreenSettings> {
    settingsOnce ??= list(() => client.from('screen_settings').select('settings').limit(1))
      .then((rows) => {
        const held: Row = rows[0]?.['settings'] ?? {};
        const out: Row = { ...settingsFallback };
        for (const key of Object.keys(settingsFallback)) {
          const v = held[key];
          const d = (settingsFallback as unknown as Row)[key];
          if (v !== null && v !== undefined && typeof v === typeof d) out[key] = v;
        }
        return out as unknown as ScreenSettings;
      })
      .catch((e: unknown) => {
        settingsOnce = null;
        throw e;
      });
    return settingsOnce;
  }

  /* ---------------------------------------------------------------- characters ---- */

  const toCharacter = (c: Row, p: Row | undefined): Character => ({
    id: c['id'],
    name: c['name'],
    title: p?.['title'] ?? '',
    signature: p?.['signature'] ?? '',
    avatarSquare: avatarUrl(p?.['avatar_square'] ?? null),
    avatarPortrait: avatarUrl(p?.['avatar_portrait'] ?? null),
    squareFrame: toFrame(p?.['square_frame']),
    portraitFrame: toFrame(p?.['portrait_frame']),
    pipStyle: p?.['pip_style'] ?? 'default',
    joined: c['joined'] ?? '',
    ...(typeof c['staff'] === 'string' ? { staff: c['staff'], staffKind: c['staff_kind'] === 'bot' ? ('bot' as const) : c['staff_kind'] === 'developer' ? ('developer' as const) : ('boss' as const) } : {}),
  });

  async function characters(ids: readonly Id[]): Promise<readonly Character[]> {
    if (ids.length === 0) return [];
    const [cs, ps] = await Promise.all([
      byChunks(ids, (part) => list(() => client.from('characters_public').select('id,name,joined,staff,staff_kind').in('id', part))),
      byChunks(ids, (part) => list(() => client.from('character_profiles').select('character,title,signature,avatar_square,avatar_portrait,square_frame,portrait_frame,pip_style').in('character', part))),
    ]);
    const profile = new Map(ps.map((p) => [p['character'] as string, p]));
    const byId = new Map(cs.map((c) => [c['id'] as string, c]));
    return ids.flatMap((id) => {
      const c = byId.get(id);
      return c ? [toCharacter(c, profile.get(id))] : [];
    });
  }

  /** A profile an answer carries, with the name looked up (the answer holds none). */
  async function profileCharacter(p: Row): Promise<Character> {
    let found: Row | undefined;
    try {
      found = (await list(() => client.from('characters_public').select('id,name,joined,staff,staff_kind').eq('id', p['character']).limit(1)))[0];
    } catch {
      found = undefined;
    }
    return toCharacter({ id: p['character'], name: found?.['name'] ?? '', joined: found?.['joined'] ?? '', staff: found?.['staff'], staff_kind: found?.['staff_kind'] }, p);
  }

  /* -------------------------------------------------------------------- live ---- */

  interface Topic {
    readonly channel: ReturnType<SupabaseClient['channel']>;
    readonly listeners: Set<(event: string, payload: Row) => void>;
    closed: boolean;
  }
  const topics = new Map<string, Topic>();

  function join(name: string, events: readonly string[], listener: (event: string, payload: Row) => void): () => void {
    let topic = topics.get(name);
    if (!topic) {
      const channel = client.channel(name, { config: { private: true } });
      const made: Topic = { channel, listeners: new Set(), closed: false };
      for (const event of events) {
        channel.on('broadcast', { event }, (m: { payload?: unknown }) => {
          const payload = (m.payload ?? {}) as Row;
          for (const l of [...made.listeners]) l(event, payload);
        });
      }
      topics.set(name, made);
      topic = made;
      void (async () => {
        let token: string | undefined;
        try {
          token = (await client.auth.getSession()).data.session?.access_token;
          await client.realtime.setAuth(token);
        } catch {
          /* subscribed anyway: the server refuses a channel it does not authorize */
        }
        if (!made.closed) channel.subscribe();
      })();
    }
    const mine = topic;
    mine.listeners.add(listener);
    return () => {
      if (!mine.listeners.delete(listener) || mine.listeners.size > 0) return;
      mine.closed = true;
      topics.delete(name);
      void client.removeChannel(mine.channel);
    };
  }

  /* --------------------------------------------------------------- estimate ---- */

  /* The estimate is the signed-in player's own, so its cache belongs to one user: when the session's user
     changes the answer and any ask in flight are dropped, and an answer that lands after a change is
     returned to the one who asked and never kept. */
  let lastEstimate: { answer: Estimate; until: number } | null = null;
  let estimateInFlight: Promise<Estimate> | null = null;
  let estimateOwner: string | null | undefined;
  /** Notes the session's user; true when it is not the one the estimate cache belongs to. */
  function ownerChanged(id: string | null): boolean {
    if (id === estimateOwner) return false;
    estimateOwner = id;
    lastEstimate = null;
    estimateInFlight = null;
    return true;
  }

  /* -------------------------------------------------------------------- the api ---- */

  const idOk = (id: string) => UUID.test(id);
  const act = async <T,>(body: Row, map: (r: Row) => T | Promise<T>): Promise<Answer<T>> => {
    const a = await edge('act', body, LOST);
    return a.ok ? { ok: true, value: await map(a.value) } : a;
  };
  const withThread = (r: Row) => {
    const a = toAct(r['act']);
    return { thread: toNewThread(r['thread'], a), act: a };
  };

  const api: KayfaApi = {
    session: currentSession,
    onSession(listener) {
      let heardFor: string | null | undefined;
      const { data } = client.auth.onAuthStateChange((_event, s) => {
        const id = s?.user?.id ?? null;
        ownerChanged(id);
        // A token refresh or a repeat sign-in of the same user changes nothing a screen shows.
        if (id === heardFor) return;
        heardFor = id;
        // Not awaited inside the callback: Auth holds its lock while it runs.
        setTimeout(() => {
          void (s ? currentSession() : Promise.resolve<Session>({ signedIn: false, account: null }))
            .catch((): Session => ({ signedIn: !!s, account: null }))
            .then(listener);
        }, 0);
      });
      return () => data.subscription.unsubscribe();
    },
    async requestCode(email, invite) {
      const a = await edge('account', { action: 'requestCode', email, invite }, NOT_DONE);
      return a.ok ? { ok: true, value: { message: String(a.value['message'] ?? ''), ...(str(a.value['invite']) ? { invite: a.value['invite'] } : {}) } } : a;
    },
    async verifyCode(email, code) {
      const a = await edge('account', { action: 'verifyCode', email, code }, NOT_DONE);
      if (!a.ok) return a;
      const s = a.value['session'] as Row | undefined;
      if (!s || !str(s['access_token']) || !str(s['refresh_token'])) return refusal(NOT_DONE);
      const set = await client.auth.setSession({ access_token: s['access_token'], refresh_token: s['refresh_token'] }).catch(() => null);
      if (!set || set.error) return refusal(NOT_DONE);
      const why = str(a.value['why']);
      return { ok: true, value: { account: a.value['account'] === true, ...(why ? { why } : {}) } };
    },
    openAccount: (invite) => act({ action: 'openAccount', invite }, (r) => ({ opened: r['opened'] === true })),
    async signOut() {
      lastEstimate = null;
      await client.auth.signOut();
    },
    /* Reads the client's own session for its address, which is not signing in, up or a reset, so it is outside Task 11's rule that those go through the account function; no table is read. */
    async signInAddress() {
      return (await client.auth.getSession()).data.session?.user.email ?? null;
    },
    async isAdmin() {
      try {
        return (await read(() => client.rpc('is_admin'))).data === true;
      } catch {
        return false;
      }
    },

    settings,

    async boards() {
      const [bs, counted] = await Promise.all([
        list(() => client.from('boards_now').select('id,slug,name,description,is_system,move_act').order('created_at', { ascending: true })),
        list(() => client.from('board_counts').select('board,threads')),
      ]);
      const threadCounts = new Map(counted.map((c) => [c['board'] as string, num(c['threads'])]));
      /* One read of each board's newest thread, by the (board, last_at) index: a handful of boards, a row each. */
      return Promise.all(
        bs.map(async (b): Promise<BoardSummary> => {
          const l = (await list(() => client.from('thread_list').select('*').eq('board', b['id']).order('last_at', { ascending: false }).limit(1)))[0];
          return { ...toBoard(b), threadCount: threadCounts.get(b['id']) ?? 0, lastAt: l?.['last_at'] ?? null, lastCharacter: l?.['last_character'] ?? null, lastThread: l?.['id'] ?? null };
        }),
      );
    },
    async board(slugOrId) {
      const rows = await list(() => client.from('boards_now').select('id,slug,name,description,is_system,move_act').eq(idOk(slugOrId) ? 'id' : 'slug', slugOrId).limit(1));
      return rows[0] ? toBoard(rows[0]) : null;
    },
    async boardNames() {
      const [now, own] = await Promise.all([list(() => client.from('boards_now').select('id,slug,name')), list(() => client.from('boards').select('id,name'))]);
      const was = new Map(own.map((b) => [b['id'] as string, String(b['name'])]));
      return now.map((b): BoardName => ({ id: b['id'], slug: b['slug'], name: b['name'], was: was.get(b['id']) ?? b['name'] }));
    },
    async moveNotice(id) {
      if (!idOk(id)) return null;
      const a = (await list(() => client.from('acts_public').select('*').eq('id', id).eq('kind', 'move').limit(1)))[0];
      if (!a) return null;
      const [counts, progress] = await Promise.all([
        list(() => client.from('reaction_tallies').select('kind,count').eq('act', id)),
        read(() => client.rpc('move_progress', { move_act: id })).then((r) => r.data, () => null),
      ]);
      const tally: Record<string, number> = {};
      for (const r of counts) tally[r['kind']] = num(r['count']);
      return buildMoveNotice(toAct(a), tally, progress);
    },
    async movesLog(staff, before): Promise<MovesLog> {
      /* Newest first by (at, id), a page and one more row to know whether older ones remain; the keyset is the last row's, so a page turn reads a page. */
      let q = client.from('moves_log').select('id,kind,params,demand,expires_at,thread,at,ended_why,ended_by,ended_at,kept_by').eq('staff', staff);
      if (before && idOk(before.act)) q = q.or(`at.lt.${before.at},and(at.eq.${before.at},id.lt.${before.act})`);
      const rows = await list(() => q.order('at', { ascending: false }).order('id', { ascending: false }).limit(MOVES_LOG_PAGE + 1));
      const page = rows.slice(0, MOVES_LOG_PAGE);
      const last = page.at(-1);
      return {
        rows: page.map((r): MoveLogRow => ({
          act: r['id'], kind: String(r['kind'] ?? ''), params: params(r['params']), demand: toDemand(r['demand']), expiresAt: orNull(r['expires_at']), at: r['at'], thread: r['thread'],
          end: r['ended_why'] === 'met' || r['ended_why'] === 'expired' || r['ended_why'] === 'reversed' || r['ended_why'] === 'superseded' || r['ended_why'] === 'spent'
            ? { why: r['ended_why'], by: String(r['ended_by'] ?? ''), at: String(r['ended_at'] ?? '') }
            : null,
          keptBy: typeof r['kept_by'] === 'string' ? r['kept_by'] : null,
        })),
        older: rows.length > MOVES_LOG_PAGE && last ? { at: last['at'], act: last['id'] } : null,
      };
    },
    async staffProfile(staff): Promise<StaffProfile | null> {
      const r = (await list(() => client.from('staff_profile_now').select('staff,at,interests,favorites,mood,signature').eq('staff', staff).limit(1)))[0];
      if (!r) return null;
      const texts = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
      return { staff: r['staff'], at: r['at'], interests: texts(r['interests']), favorites: texts(r['favorites']), mood: String(r['mood'] ?? ''), signature: String(r['signature'] ?? '') };
    },
    async adminQueue(): Promise<AdminQueue> {
      const v = (await read(() => client.rpc('admin_queue'))).data;
      const q = v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
      const rows = (x: unknown): Row[] => (Array.isArray(x) ? (x as Row[]) : []);
      const more = (q['more'] && typeof q['more'] === 'object' ? q['more'] : {}) as Row;
      return {
        cap: num(q['cap']), waiting: rows(q['waiting']).map(toQueued), inForce: rows(q['inForce']).map(toInForce), ended: rows(q['ended']).map(toEnded),
        more: { waiting: more['waiting'] === true, inForce: more['inForce'] === true, ended: more['ended'] === true },
        roster: rows(q['roster']).flatMap((r) => (typeof r['staff'] === 'string' ? [{ staff: r['staff'], name: String(r['name'] ?? r['staff']) }] : [])),
      };
    },
    /* A page of the Updates (`updates`, 0062): public, the same for every reader, newest first. */
    async updates(before) {
      const r = await read(() => client.rpc('updates', { before: before ?? null, most: UPDATES_PAGE }));
      return (Array.isArray(r.data) ? (r.data as Row[]) : []).map(toUpdate);
    },
    /* A page of the season's news (`season_news`, 0063): public, the same for every reader, newest first. */
    async seasonNews(before) {
      const r = await read(() => client.rpc('season_news', { before: before ?? null, most: SEASON_NEWS_PAGE }));
      return (Array.isArray(r.data) ? (r.data as Row[]) : []).map(toSeasonNews);
    },
    /* An admin's update, written as the developer persona; the answer is the update as `updates` reads it. */
    async postUpdate(title, body, changes) {
      const a = await rpcWrite(() => client.rpc('post_update', { title, body, changes: changes.map((c) => ({ label: c.label, text: c.text })) }));
      return a.ok ? { ok: true, value: toUpdate(a.value) } : a;
    },
    async holdMove(id) {
      const a = await rpcWrite(() => client.rpc('hold_move', { id }));
      return a.ok ? { ok: true, value: { id: num(a.value['id']), heldAt: String(a.value['heldAt'] ?? '') } } : a;
    },
    async replaceSuccessor(id, boss) {
      const a = await rpcWrite(() => client.rpc('replace_successor', { id, boss }));
      return a.ok ? { ok: true, value: { id: num(a.value['id']), boss: String(a.value['boss'] ?? '') } } : a;
    },
    async bosses() {
      const rows = await list(() => client.from('characters_public').select('id,name,staff').eq('staff_kind', 'boss').order('name', { ascending: true }).limit(100));
      return rows.flatMap((r) => (typeof r['staff'] === 'string' ? [{ staff: r['staff'], name: String(r['name'] ?? r['staff']) }] : []));
    },
    async reverseMove(act) {
      const a = await rpcWrite(() => client.rpc('reverse_move', { move_act: act }));
      return a.ok ? { ok: true, value: { act: a.value['act'], endedBy: a.value['endedBy'] } } : a;
    },
    async threads(board, page) {
      /* The page is the list's rows; the total is the board's counter (a trigger keeps it), so a page turn counts nothing. */
      const total = async () => num((await list(() => client.from('board_counts').select('threads').eq('board', board).limit(1)))[0]?.['threads']);
      if (page.limit <= 0) return { threads: [], total: await total() };
      const [rows, all] = await Promise.all([
        list(() => client.from('thread_list').select('*').eq('board', board).order('last_at', { ascending: false }).range(page.offset, page.offset + page.limit - 1)),
        total(),
      ]);
      return { threads: rows.map(toThread), total: all };
    },
    async thread(id) {
      /* thread_open: every thread by its id, the reveal and Turns threads (which thread_list leaves out of a board's list) included. */
      const r = await list(() => client.from('thread_open').select('*').eq('id', id).limit(1));
      return r[0] ? toThread(r[0]) : null;
    },
    async acts(thread, fromSeq, toSeq) {
      const rows = await list(() => client.from('acts_public').select('*').eq('thread', thread).gte('seq', fromSeq).lte('seq', toSeq).not('kind', 'in', '(edit,card)').order('seq', { ascending: true }));
      return rows.map(toAct);
    },
    async act(id) {
      const r = await list(() => client.from('acts_public').select('*').eq('id', id).limit(1));
      return r[0] ? toAct(r[0]) : null;
    },
    async actsById(ids) {
      const wanted = [...new Set(ids)].filter(idOk);
      if (wanted.length === 0) return [];
      return (await byChunks(wanted, (part) => list(() => client.from('acts_public').select('*').in('id', part)))).map(toAct);
    },
    async openingActs(threads) {
      const wanted = [...new Set(threads)].filter(idOk);
      if (wanted.length === 0) return [];
      return (await byChunks(wanted, (part) => list(() => client.from('acts_public').select('*').in('thread', part).eq('seq', 1)))).map(toAct);
    },
    async history(post) {
      if (!idOk(post)) return [];
      const rows = await list(() => client.from('acts_public').select('*').or(`id.eq.${post},and(kind.eq.edit,target_act_id.eq.${post})`).order('created_at', { ascending: true }));
      return rows.map(toAct);
    },
    async spunFrom(actId, limit = SPUN_FROM_MAX) {
      if (!idOk(actId)) return [];
      const rows = await list(() => client.from('thread_list').select('*').eq('origin_act_id', actId).order('created_at', { ascending: true }).limit(rowLimit(limit)));
      return rows.map(toThread);
    },
    async spunFromMany(actIds, limit) {
      const wanted = [...new Set(actIds)].filter(idOk);
      if (wanted.length === 0) return [];
      const rows = await byChunks(wanted, (part) => list(() => client.from('thread_list').select('*').in('origin_act_id', part).order('created_at', { ascending: true }).limit(rowLimit(limit))));
      return merged(rows, 'created_at', 'id', rowLimit(limit)).map(toThread);
    },
    async cardsOn(actId, limit) {
      if (!idOk(actId)) return [];
      /* A post's plays, its card backs and their springs (0054): each is a layer on the post, read through it. */
      const rows = await list(() => client.from('acts_public').select('*').in('kind', LAYER_KINDS).eq('target_act_id', actId).order('created_at', { ascending: true }).limit(rowLimit(limit)));
      return rows.map(toAct);
    },
    async cardsOnMany(actIds, limit) {
      const wanted = [...new Set(actIds)].filter(idOk);
      if (wanted.length === 0) return [];
      const rows = await byChunks(wanted, (part) => list(() => client.from('acts_public').select('*').in('kind', LAYER_KINDS).in('target_act_id', part).order('created_at', { ascending: true }).limit(rowLimit(limit))));
      return merged(rows, 'created_at', 'id', rowLimit(limit)).map(toAct);
    },
    async effectsAbove(characters, thread, board) {
      /* One request per chunk of characters, run together (effects_above holds at most 200 a call); the thread and the board are
         asked once, in the first. The answers are joined oldest first, as one query would order them. */
      const wanted = [...new Set(characters)].filter(idOk);
      const at = { thread: thread && idOk(thread) ? thread : null, board: board && idOk(board) ? board : null };
      if (wanted.length === 0 && !at.thread && !at.board) return [];
      const parts = wanted.length ? chunks(wanted) : [[]];
      const answers = await Promise.all(parts.map(async (part, n) => {
        const r = await read(() => client.rpc('effects_above', { characters: part, thread: n === 0 ? at.thread : null, board: n === 0 ? at.board : null }));
        return Array.isArray(r.data) ? (r.data as Row[]) : [];
      }));
      return answers.flat()
        .map((x): PlayAbove => ({ play: x['play'], reach: x['reach'], target: x['target'], endsAt: x['ends_at'], act: toAct(x['act']) }))
        .sort((a, b) => (a.act.createdAt < b.act.createdAt ? -1 : a.act.createdAt > b.act.createdAt ? 1 : a.play < b.play ? -1 : a.play > b.play ? 1 : 0));
    },
    async pinnedThreads(board) {
      /* One read of the board's live pins (pinned_threads, 0055), newest first, as the server orders them. */
      if (!idOk(board)) return [];
      const r = await read(() => client.rpc('pinned_threads', { board }));
      const rows = Array.isArray(r.data) ? (r.data as Row[]) : [];
      return rows.map((x): PinnedThread => ({ thread: toThread(x['thread']), play: x['play'], endsAt: x['ends_at'], act: toAct(x['act']) }));
    },
    async effectStates(plays) {
      const wanted = [...new Set(plays)].filter(idOk);
      const out: Record<Id, EffectState> = {};
      if (wanted.length === 0) return out;
      const rows = await byChunks(wanted, (part) => list(() => client.from('effect_state').select('play,state,saved_at').in('play', part)));
      for (const r of rows) out[r['play']] = { state: r['state'], savedAt: r['saved_at'] };
      return out;
    },
    async playMoment(play) {
      /* One read of the moment (play_moment, 0072); an id that is no play on a post is refused in words, which is null here. */
      if (!idOk(play)) return null;
      const r = await read(async () => {
        const x = (await client.rpc('play_moment', { play })) as Res;
        return x.error?.hint === 'kayfabb.refusal' ? { data: null, error: null, status: 200 } : x;
      });
      const m = r.data as Row | null;
      if (!m) return null;
      return {
        version: toAct(m['version']),
        layers: (m['layers'] as Row[]).map((l) => ({ act: toAct(l['act']), state: l['savedAt'] == null ? null : { state: l['state'], savedAt: l['savedAt'] } })),
        above: (m['above'] as Row[]).map((x): PlayAbove => ({ play: x['play'], reach: x['reach'], target: x['target'], endsAt: x['ends_at'], act: toAct(x['act']) })),
        recorded: m['recorded'] === true,
      };
    },
    async myReleases(plays) {
      const wanted = [...new Set(plays)].filter(idOk);
      if (wanted.length === 0) return [];
      return (await byChunks(wanted, (part) => list(() => client.from('effect_releases').select('play').in('play', part)))).map((r): Id => r['play']);
    },
    async releaseEffect(play) {
      const a = await rpcWrite(() => client.rpc('release_effect', { play }));
      return a.ok ? { ok: true, value: { play: a.value['play'], releasedAt: a.value['released_at'] } } : a;
    },
    /* The price is the card's rules' and the Edge Function's (it reads the settings rows as they stand), so a purchase sends the card alone. */
    buyCard: (card) => act({ action: 'buyCard', card }, (r): Bought => ({ card: r['card'], balance: num(r['balance']), held: num(r['held']) })),
    playCard: (card, character, target, config, message, reach, fromPost) => act({ action: 'playCard', card, character, target, config, message, ...beyond(reach, fromPost) }, toAct),
    setCard: (card, character, target, config) => act({ action: 'setCard', card, character, target, config }, toAct),
    useCard: (card, character, target, config, message, reach, fromPost) => act({ action: 'useCard', card, character, target, config, message, ...beyond(reach, fromPost) }, toAct),
    async myFaceDown(sets) {
      if (sets.length === 0) return {};
      const rows = await byChunks([...new Set(sets)], (part) => list(() => client.from('my_face_down').select('play,card').in('play', part)));
      return Object.fromEntries(rows.map((r) => [r['play'], r['card']]));
    },
    saveEffect: (play, character, state) => act({ action: 'saveEffect', character, play, state }, (r) => ({ play: r['play'], savedAt: r['saved_at'] })),
    characters,
    async characterCounts(id): Promise<CharacterCounts> {
      // One row of counters kept by a trigger (0030), never a count of the character's Acts; none for a character that has done nothing.
      if (!idOk(id)) return { posts: 0, spins: 0, cards: 0 };
      const r = (await list(() => client.from('character_post_counts').select('character,posts,spins,cards').eq('character', id)))[0];
      return { posts: num(r?.['posts']), spins: num(r?.['spins']), cards: num(r?.['cards']) };
    },
    async characterStats(ids) {
      const out: Record<Id, { posts: number }> = Object.fromEntries(ids.map((id) => [id, { posts: 0 }]));
      if (ids.length === 0) return out;
      for (const r of await byChunks(ids, (part) => list(() => client.from('character_post_counts').select('character,posts').in('character', part)))) out[r['character']] = { posts: num(r['posts']) };
      return out;
    },
    async characterActs(id, kinds, page) {
      /* A page and no count (a count reads the character's whole history); a range past the end is PostgREST's 416, an empty page. */
      if (kinds.length === 0 || page.limit <= 0 || !idOk(id)) return [];
      const r = await read(() =>
        client.from('acts_public').select('*').eq('character', id).in('kind', [...kinds]).order('created_at', { ascending: false }).range(page.offset, page.offset + page.limit - 1),
      true);
      return (Array.isArray(r.data) ? (r.data as Row[]) : []).map(toAct);
    },
    async characterReveals(id, limit = 50) {
      if (!idOk(id)) return [];
      const rows = await list(() => client.from('acts_public').select('*').eq('kind', 'reveal').eq('payload->>character', id).order('created_at', { ascending: false }).limit(rowLimit(limit)));
      return rows.map(toAct);
    },
    async tallies(acts) {
      const out: Record<Id, Record<string, number>> = Object.fromEntries(acts.map((a) => [a, {}]));
      if (acts.length === 0) return out;
      for (const r of await byChunks(acts, (part) => list(() => client.from('reaction_tallies').select('act,kind,count').in('act', part)))) {
        (out[r['act']] ??= {})[r['kind']] = num(r['count']);
      }
      return out as Readonly<Record<Id, Tally>>;
    },
    async viewCounts(threads) {
      const out: Record<Id, number> = Object.fromEntries(threads.map((t) => [t, 0]));
      if (threads.length === 0) return out;
      for (const r of await byChunks(threads, (part) => list(() => client.from('thread_view_counts').select('thread,views').in('thread', part)))) out[r['thread']] = num(r['views']);
      return out;
    },
    async season() {
      /* The season the standings read, named on the server (standings_season()), so a screen never names one season over another's ranking. */
      const r = (await list(() => client.from('current_season').select('*').limit(1)))[0];
      return r
        ? ({ id: r['id'], number: r['number'], startsAt: r['starts_at'], endsAt: r['ends_at'] ?? null, turnsThread: r['turns_thread'] ?? null, revealAct: r['reveal_act'] ?? null } satisfies Season)
        : null;
    },
    /* A page of the ranking from the server, which reads one range of the standings' index for it and never ranks the
       season (standings_page, supabase/migrations/0030_screens_reads.sql); at most a row cap's worth, as it answers. */
    async standingsPage(offset, limit) {
      if (limit <= 0) return [];
      const r = await read(() => client.rpc('standings_page', { page_offset: Math.max(0, Math.floor(offset)), page_limit: rowLimit(limit) }));
      const rows = Array.isArray(r.data) ? (r.data as Row[]) : [];
      return rows.map((x): Standing => ({ character: x['character'], name: x['name'], standing: num(x['standing']), place: num(x['place']) }));
    },
    async standingAmounts(ids) {
      const out: Record<Id, number> = Object.fromEntries(ids.map((id) => [id, 0]));
      const wanted = ids.filter(idOk);
      if (wanted.length === 0) return out;
      /* Through current_standings, which reads the season standings_season() names on the server (the rule the
         profile's place and the standings page read too, written once in 0030_screens_reads.sql): a probe of the
         standings' primary key per character. A character with no row there stands at 0. */
      for (const r of await byChunks(wanted, (part) => list(() => client.from('current_standings').select('character,standing').in('character', part)))) out[r['character']] = num(r['standing']);
      return out;
    },
    async standingPlace(id): Promise<StandingPlace | null> {
      if (!idOk(id)) return null;
      const v = (await read(() => client.rpc('standing_place', { of_character: id }))).data;
      return v && typeof v === 'object' && !Array.isArray(v) ? { standing: num((v as Row)['standing']), place: num((v as Row)['place']), of: num((v as Row)['of']) } : null;
    },
    async standingsCount() {
      return num((await list(() => client.from('season_size').select('characters').limit(1)))[0]?.['characters']);
    },
    async lastSettledAt() {
      const r = await list(() => client.from('settlements').select('ends_at').order('ends_at', { ascending: false }).limit(1));
      return r[0]?.['ends_at'] ?? null;
    },
    async classReveals(chars) {
      if (chars.length === 0) return [];
      const rows = await byChunks(chars, (part) => list(() => client.from('class_reveals').select('act,character,class,at,via,thread').in('character', part).order('at', { ascending: true })));
      return merged(rows, 'at', 'act').map((r): ClassReveal => ({ act: r['act'], character: r['character'], class: r['class'], at: r['at'], via: r['via'], thread: r['thread'] }));
    },
    async turnsAnnounced(chars) {
      if (chars.length === 0) return [];
      const rows = await byChunks(chars, (part) => list(() => client.from('turns_announced').select('act,character,at,was').in('character', part).order('at', { ascending: true })));
      return merged(rows, 'at', 'act').map((r): TurnAnnounced => ({ act: r['act'], character: r['character'], at: r['at'], was: r['was'] ?? null }));
    },
    async nextSettlementAt() {
      return str((await read(() => client.rpc('next_settlement_at'))).data);
    },

    async myCharacters() {
      return (await list(() => client.from('my_characters').select('*').order('name', { ascending: true }))).map(toMyCharacter);
    },
    async wallet(): Promise<Wallet> {
      const r = (await list(() => client.from('my_wallet').select('balance,cap').limit(1)))[0];
      return { balance: num(r?.['balance']), cap: typeof r?.['cap'] === 'number' ? r['cap'] : (await settings()).walletCap };
    },
    async myReactions(acts) {
      if (acts.length === 0) return [];
      const rows = await byChunks(acts, (part) => list(() => client.from('my_reactions').select('act,kind,character').in('act', part)));
      return rows.map((r): MyReaction => ({ act: r['act'], kind: r['kind'], character: r['character'] }));
    },
    async myCards() {
      return (await list(() => client.from('my_cards').select('card,held'))).map((r): HeldCard => ({ card: r['card'], held: num(r['held']) }));
    },
    async reading(threads) {
      const out: Record<Id, number> = {};
      if (threads.length === 0) return out;
      for (const r of await byChunks(threads, (part) => list(() => client.from('reading').select('thread,furthest_seq').in('thread', part)))) out[r['thread']] = num(r['furthest_seq']);
      return out;
    },
    async markRead(thread, seq, through) {
      return (await rpcWrite(() => client.rpc('mark_read', { in_thread: thread, seq, through }))).ok;
    },
    async here(place, through) {
      const at = place.kind === 'thread' ? place.thread : place.kind === 'board' ? place.board : null;
      const a = await rpcWrite(() => client.rpc('here', { in_kind: place.kind, in_place: at, through }));
      // A refusal or a lost answer throws, so the poll counts it as a failure and keeps its last answer.
      if (!a.ok) throw new Error(a.error);
      const names = (Array.isArray(a.value['names']) ? a.value['names'] : []).flatMap((n: Row) =>
        typeof n?.['id'] === 'string' && typeof n?.['name'] === 'string' ? [{ id: n['id'], name: n['name'] }] : []);
      return { names, others: num(a.value['others']) };
    },
    async setPresenceHidden(character, hidden) {
      const a = await rpcWrite(() => client.rpc('set_presence_hidden', { in_character: character, hidden }));
      return a.ok ? { ok: true, value: a.value['hidden'] === true } : a;
    },
    async preferences(): Promise<Preferences> {
      const r = (await list(() => client.from('account_preferences').select('theme,postbit,motion,smoke,contrast,text_size,cards_met,alerts_seen_at,settlement_seen,toasts,welcomed_at,tips,tips_seen').limit(1)))[0];
      return r ? toPreferences(r) : DEFAULT_PREFERENCES;
    },
    async setPreferences(p) {
      const a = await rpcWrite(() => client.rpc('set_preferences', {
        theme: p.theme ?? null, postbit: p.postbit ?? null, motion: p.motion ?? null,
        smoke: p.smoke ?? null, contrast: p.contrast ?? null, text_size: p.textSize ?? null,
        toasts: p.toasts ?? null, toasts_default: p.toasts === null,
      }));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async meetCard(card) {
      const a = await rpcWrite(() => client.rpc('meet_card', { card }));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async seeWelcome() {
      const a = await rpcWrite(() => client.rpc('see_welcome'));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async seeTip(key) {
      const a = await rpcWrite(() => client.rpc('see_tip', { key }));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async skipTips() {
      const a = await rpcWrite(() => client.rpc('skip_tips'));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async resumeTips() {
      const a = await rpcWrite(() => client.rpc('resume_tips'));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async restoreTips() {
      const a = await rpcWrite(() => client.rpc('restore_tips'));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async replayTour() {
      const a = await rpcWrite(() => client.rpc('replay_tour'));
      return a.ok ? { ok: true, value: toPreferences(a.value) } : a;
    },
    async seeAlerts(at) {
      const a = await rpcWrite(() => client.rpc('see_alerts', { at }));
      return a.ok ? { ok: true, value: str(a.value['seen']) ?? at } : a;
    },
    async following(thread) {
      return (await read(() => client.rpc('following_thread', { in_thread: thread }))).data === true;
    },
    async follow(thread, on) {
      const a = await rpcWrite(() => client.rpc('follow_thread', { in_thread: thread, on_: on }));
      return a.ok ? { ok: true, value: a.value['following'] === true } : a;
    },
    async followed() {
      return (await list(() => client.from('my_followed_threads').select('thread,board,title,new_posts,newest_at').order('newest_at', { ascending: false }).limit(50)))
        .map((r): FollowedThread => ({ thread: r['thread'], board: r['board'], title: String(r['title'] ?? ''), newPosts: num(r['new_posts']), newestAt: String(r['newest_at']) }));
    },
    async alerts(before) {
      const r = await read(() => client.rpc('my_alerts', { before: before ?? null, most: ALERTS_PAGE }));
      return (Array.isArray(r.data) ? (r.data as Row[]) : [])
        /* A kind this build does not know (a newer server's) is no line, rather than a line a screen cannot word. */
        .filter((a) => (ALERT_KINDS as readonly string[]).includes(String(a['kind'])))
        .map((a): Alert => ({
          kind: a['kind'] as AlertKind, sub: str(a['sub']), act: str(a['act']), character: str(a['character']), at: String(a['at']),
          thread: str(a['thread']), name: str(a['name']), title: str(a['title']), count: typeof a['count'] === 'number' ? a['count'] : null,
        }));
    },
    async accountOpenedAt() {
      /* The caller's own, through a function and not the accounts table, which a screen never reads (0066). */
      const r = await read(() => client.rpc('my_account_opened'));
      const at = str(r.data);
      if (at === null) throw new Error('no account is open');
      return at;
    },
    async alertsUnread() {
      const r = await read(() => client.rpc('my_alerts_unread'));
      return Math.min(ALERTS_UNREAD_BOUND, Math.max(0, Math.floor(num(r.data))));
    },
    async settlementMoved(id) {
      /* The caller's own ledger lines in one settlement, through a function (0076); no row is "moved none", for any id alike. */
      const r = await read(() => client.rpc('my_settlement_moved', { settlement: id }));
      const row = Array.isArray(r.data) ? (r.data[0] as Record<string, unknown> | undefined) : undefined;
      const at = row === undefined ? null : str(row['applied_at']);
      return row === undefined || at === null ? null : { count: Math.max(0, Math.floor(num(row['count']))), at };
    },
    async seeSettlement(endsAt) {
      const a = await rpcWrite(() => client.rpc('see_settlement', { ends_at: endsAt }));
      return a.ok ? { ok: true, value: str(a.value['seen']) ?? endsAt } : a;
    },
    /*
     * A page of the player's own log: each of its own views read newest first, at or before the cursor and a page long, then the
     * shares of the settlements read, whole (a page of rows at a time), and the page cut where the first full source ends
     * (engine/ui/data/log-page.ts). A page that would not move the cursor is read again at its one instant, every row there, a
     * page of rows at a time in an order that holds still. Every view answers from the caller's own rows alone.
     */
    log(before) {
      return readLogPage(async (range) => {
        /*
         * One view's rows: a page long at or before the cursor, newest first by `column` then `page`'s order; or every row at one
         * instant, a page of rows at a time, in `whole`'s order, which holds still from one page of rows to the next. Typed
         * loosely, since supabase-js's builder types are too deep to pass through a generic.
         */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type Q = any;
        /* Each view is named where it is read, so the reads guard (tools/check-web-reads.mjs) reads which view each is. */
        const rows = (from: () => Q, column: string, page: (q: Q) => Q, whole: readonly string[]): Promise<Row[]> => {
          if (!('at' in range)) return list(() => page((range.before ? from().lte(column, range.before) : from()).order(column, { ascending: false })).limit(range.limit));
          return every((start, end) => whole.reduce((q: Q, c) => q.order(c, { ascending: true }), from().eq(column, range.at)).range(start, end));
        };
        const [ledgerRows, walletRows, cardRows, playRows, saveRows, endRows, passRows, caughtRows] = await Promise.all([
          rows(() => client.from('my_ledger').select('settlement,starts_at,ends_at,character,reason,amount,shares_kept,params'), 'ends_at',
            (q) => q.order('character', { ascending: true }).order('reason', { ascending: true }), ['settlement', 'character', 'reason']),
          rows(() => client.from('my_wallet_events').select('settlement,kind,change,overflow,floored,balance_after,ref,at'), 'at', (q) => q, ['settlement', 'kind', 'ref', 'change', 'overflow', 'floored', 'balance_after']),
          rows(() => client.from('my_card_ledger').select('card,kind,act,price,at,springs'), 'at', (q) => q, ['card', 'kind', 'act', 'price']),
          rows(() => client.from('my_posts_played_on').select('play,post,at,reach,target_name,target_character'), 'at', (q) => q, ['play']),
          rows(() => client.from('my_posts_played_on').select('play,post,saved_at').not('saved_at', 'is', null), 'saved_at', (q) => q, ['play']),
          /* The player's own cards set face down, by when each sprang or ended (0054); one still live has no end yet. */
          rows(() => client.from('my_face_down').select('play,card,post,spring,ended_at').not('ended_at', 'is', null), 'ended_at', (q) => q, ['play']),
          /* The player's own cards a reply passed by without springing, by when it did (0078); the log names the reply traps among them. */
          rows(() => client.from('my_face_down').select('play,card,post,ends_at,passed_at').not('passed_at', 'is', null).is('spring', null), 'passed_at', (q) => q, ['play']),
          rows(() => client.from('my_caught').select('play,card,post,trap,spring,price,bought_price,at'), 'at', (q) => q, ['play']),
        ]);
        const ledger = ledgerRows.map((r): LedgerRow => ({
          settlement: num(r['settlement']), startsAt: r['starts_at'], endsAt: r['ends_at'], sharesKept: r['shares_kept'] !== false,
          character: r['character'], reason: r['reason'], amount: num(r['amount']), ...((p) => (p ? { params: p } : {}))(numbers(r['params'])),
        }));
        const ids = [...new Set(ledger.map((l) => l.settlement))];
        /* Paged within each chunk of settlements, then merged in the read's own order. A settlement's rows all come from
           one chunk, already in the server's order (its collation for the text keys), so the merge is a stable sort
           by settlement alone, newest first, which keeps that order inside each settlement. The log files each share
           under its line (engine/ui/data/log-page.ts), so no screen sees the order across settlements; the sort keeps
           the read's promise of each source newest first, as one query answered it. */
        const shareRows = ids.length === 0 ? [] : await byChunks(ids, (part) => every((start, end) => client.from('my_ledger_shares').select('settlement,character,reason,act,quadrant,amount').in('settlement', part)
          .order('settlement', { ascending: false }).order('character', { ascending: true }).order('reason', { ascending: true }).order('act', { ascending: true }).order('quadrant', { ascending: true })
          .range(start, end)));
        const shares: ShareRow[] = [...shareRows].sort((a, b) => num(b['settlement']) - num(a['settlement']))
          .map((r) => ({ settlement: num(r['settlement']), character: r['character'], reason: r['reason'], act: r['act'], quadrant: r['quadrant'] ?? null, amount: num(r['amount']) }));
        return {
          ledger,
          shares,
          wallet: walletRows.map((r): WalletEvent => ({
            settlement: typeof r['settlement'] === 'number' ? r['settlement'] : null, kind: r['kind'], change: num(r['change']), overflow: num(r['overflow']),
            floored: num(r['floored']), balanceAfter: num(r['balance_after']), ref: r['ref'] ?? null, at: r['at'],
          })),
          cards: cardRows.map((r): CardEvent => ({
            card: r['card'], kind: r['kind'], act: r['act'] ?? null, price: num(r['price']), at: r['at'],
            ...(typeof r['springs'] === 'boolean' ? { springs: r['springs'] } : {}),
          })),
          playsOnMine: playRows.map((r) => ({ play: r['play'], post: r['post'], at: r['at'], reach: r['reach'], targetName: r['target_name'] ?? null, targetCharacter: r['target_character'] ?? null })),
          saves: saveRows.map((r) => ({ play: r['play'], post: r['post'], savedAt: r['saved_at'] })),
          setEnds: endRows.map((r): FaceDownEnd => ({ play: r['play'], card: r['card'], post: r['post'], spring: r['spring'] ?? null, endedAt: r['ended_at'] })),
          setPasses: passRows.map((r): FaceDownPass => ({ play: r['play'], card: r['card'], post: r['post'], passedAt: r['passed_at'], endsAt: r['ends_at'] })),
          caught: caughtRows.map((r): CaughtPlay => ({
            play: r['play'], card: r['card'], post: r['post'], trap: r['trap'], spring: r['spring'], price: num(r['price']),
            boughtPrice: r['bought_price'] === null || r['bought_price'] === undefined ? null : num(r['bought_price']), at: r['at'],
          })),
        };
      }, before ?? null);
    },
    estimate() {
      if (lastEstimate && Date.now() < lastEstimate.until) return Promise.resolve(lastEstimate.answer);
      if (estimateInFlight) return estimateInFlight;
      let mine!: Promise<Estimate>;
      mine = (async () => {
        try {
          const a = await edge('estimate', {}, NOT_READ, true);
          if (!a.ok) throw new Error(a.error);
          const answer = toEstimate(a.value);
          const until = answer.freshAfter ? Date.parse(answer.freshAfter) : Number.NaN;
          // Still the ask in flight: the user has not changed since it was sent.
          if (estimateInFlight === mine) lastEstimate = Number.isNaN(until) ? null : { answer, until };
          return answer;
        } finally {
          if (estimateInFlight === mine) estimateInFlight = null;
        }
      })();
      estimateInFlight = mine;
      return mine;
    },
    async invites() {
      const rows = await list(() => client.from('my_invites').select('id,created_at,used,expires_at,expired').order('created_at', { ascending: false }));
      return rows.map((r): MyInvite => ({ id: r['id'], createdAt: r['created_at'], used: r['used'] === true, expiresAt: r['expires_at'] ?? null, expired: r['expired'] === true }));
    },
    createInvite: () => act({ action: 'createInvite' }, (r) => ({ invite: r['invite'], code: r['code'] })),
    reissueInvite: (invite) => act({ action: 'reissueInvite', invite }, (r) => ({ invite: r['invite'], code: r['code'] })),

    startThread: (board, character, title, body) => act({ action: 'startThread', board, character, title, body }, (r) => ({ thread: toNewThread(r['thread'], toAct(r['act'])), act: toAct(r['act']) })),
    post: (thread, character, body, quote) => act({ action: 'post', thread, character, body, ...(quote ? { quote } : {}) }, toAct),
    edit: (post, character, body) => act({ action: 'edit', post, character, body }, toAct),
    spin: (origin, character, title, body) => act({ action: 'spin', origin, character, title, body }, withThread),
    react: (target, character, kind) => act({ action: 'react', act: target, character, kind }, (r) => ({ act: r['act'], tally: (r['tally'] ?? {}) as Tally })),
    turn: (character, to, loudness, showFrom, showTo) =>
      act({ action: 'turn', character, class: to, loudness, showFrom, showTo }, (r): TurnAsked => ({ class: r['class'], loudness: r['loudness'], showFrom: r['show_from'] === true, showTo: r['show_to'] === true, takesEffectAt: r['takes_effect_at'] ?? null })),
    withdrawTurn: (character) => act({ action: 'withdrawTurn', character }, () => ({ withdrawn: true as const })),
    unmask: (character, thread, message) => act({ action: 'unmask', character, thread, message }, toAct),
    createCharacter: (name, cls, timing, loudness) =>
      act({ action: 'createCharacter', name, class: cls, timing, loudness }, (r): CreatedCharacter => ({ id: r['id'], name: r['name'], class: r['class'], waiting: r['waiting'] === true, loudness: r['loudness'] })),
    setDebut: (character, timing, loudness) => act({ action: 'setDebut', character, timing, loudness }, (r) => ({ id: r['id'], waiting: r['waiting'] === true, loudness: r['loudness'] })),
    async setProfile(character, title, signature, pipStyle) {
      const a = await rpcWrite(() => client.rpc('set_profile', { through: character, title, signature, pip_style: pipStyle }));
      return a.ok ? { ok: true, value: await profileCharacter(a.value) } : a;
    },
    async setAvatar(upload: AvatarUpload) {
      const form = new FormData();
      form.append('character', upload.character);
      form.append('frames', JSON.stringify({ square: upload.squareFrame, portrait: upload.portraitFrame }));
      form.append('square', upload.square, 'square.webp');
      if (upload.portrait) form.append('portrait', upload.portrait, 'portrait.webp');
      const a = await edge('avatar', form, LOST);
      return a.ok ? { ok: true, value: await profileCharacter(a.value) } : a;
    },

    subscribeThread(thread, l) {
      return join(`thread:${thread}`, ['act', 'tally', 'effect'], (event, p) => {
        if (event === 'act') l.onAct?.(toAct(p));
        else if (event === 'tally') l.onTally?.(p['act'], (p['tally'] ?? {}) as Tally);
        else if (event === 'effect') l.onEffect?.(p['play'], p['saved_at']);
      });
    },
    subscribeBoard(board, l) {
      return join(`board:${board}`, ['thread'], (_event, p) => {
        l.onThread?.({ id: p['id'], board: p['board'], title: p['title'], originActId: p['origin_act_id'] ?? null, createdAt: p['created_at'] });
      });
    },
    /* The player's own channel, `account:<their id>` (supabase/migrations/0061_account_channel.sql lets only that account hear it). It is
       opened for the account signed in when this is called; a caller that follows sign-in changes subscribes again after one. */
    subscribeAccount(l) {
      let off: (() => void) | null = null;
      let closed = false;
      void (async () => {
        let id: string | undefined;
        try { id = (await client.auth.getSession()).data.session?.user.id; } catch { /* no session: nothing to hear */ }
        if (!id || closed) return;
        off = join(`account:${id}`, ['alert'], (_event, p) => {
          l.onAlert?.({ id: p['id'], kind: p['kind'], sub: p['sub'] ?? null, act: p['act'] ?? null, character: p['character'] ?? null, at: p['at'] });
        });
      })();
      return () => { closed = true; off?.(); };
    },
    /* Plays beyond a post, and news, on `reach`: every signed-in player hears every one. A play's Act is the public one its thread carries; news is an update or an item of season news, as 0063 announces it. */
    subscribeReach(l) {
      return join('reach', ['effect', 'news', 'settled'], (event, p) => {
        if (event === 'news') l.onNews?.({ kind: p['kind'], sub: p['sub'] ?? null, act: p['act'] ?? null, at: p['at'] });
        else if (event === 'settled') l.onSettled?.({ id: String(p['id']), at: p['at'] });
        else l.onPlay?.(toAct(p));
      });
    },
  };
  return api;
}
