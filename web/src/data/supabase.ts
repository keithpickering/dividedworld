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
import { readLogPage, type LedgerRow, type LogRange, type LogRead, type ShareRow } from '../../../engine/ui/data/log-page.ts';
import { buildMoveNotice, toDemand, toProgress } from '../../../engine/ui/data/moves.ts';
import { ALERTS_PAGE, ALERTS_UNREAD_BOUND, MOVES_LOG_PAGE, REIGNS_PAGE, SEASON_NEWS_PAGE, TROPHIES_PAGE, UPDATES_PAGE } from '../../../engine/ui/data/api.ts';
import { RECORD_PAGE } from '../../../engine/ui/profile/record.ts';
import { ENGINE_DEFAULT_PRONOUNS, type PronounSet } from '../../../engine/rules/pronouns.ts';
import { ALERT_KINDS, type AlertKind } from '../../../engine/rules/alerts.ts';
import type { Piece } from '../../../engine/rules/cosmetics.ts';
import { RARITIES } from '../../../engine/rules/cards.ts';
import type { Career } from '../../../engine/system/career.ts';
import type {
  AdminQueue, Apology, Bar, BoardName, HandoverTodo, MoveEnded, MoveInForce, MoveLogRow, MovesLog, QueuedMove, StaffCardPlay, StaffProfile,
  Act, ActKind, Answer, AvatarUpload, BeltCursor, BeltPage, BeltReign, RandomEvent, ShownTrophy, TrophyAwardFailure, TrophyItem, WardrobeItem, Board, Bought, BoardSummary, CardEnded, CardEvent, PackEvent, WrittenOnMine, CaughtPlay, Character, CharacterCounts, Office, ClassReveal, CreatedCharacter, Estimate, EstimateLine, FaceDownEnd,
  Alert, ContactLink, EffectState, Tail, PostHit, SearchCursor, SearchPage, SearchQuery, Suggestions, ThreadHit, SeasonFinished, SeasonNewsItem, SeasonRecordRow, SeasonResultRow, SeasonShown, TallyName, Update, FollowedThread, Frame, HeldCard, Id, KayfaApi, MyCharacter, MyInvite, MyReaction, PendingTurn, PinnedThread, PlayAbove, Preferences, Refusal, ScreenSettings, Season, Session, Standing,
  Tally, StandingPlace, ThreadSummary, OriginPlace, PlaceOn, TurnAnnounced, TurnAsked, Wallet, WalletEvent,
  Boot, BoardPage, IndexPage, Opened, AdminSlot, Slot, SlotMove, Presence, ProfilePage, RecordPage, ThreadPage, ThreadPerson, MyCharactersPage, SeasonPage, AlertsPage, UpdatesPage, QueuePage, LogPage,
  AppealResult, AppealVerdict, InterceptResult, MyBan, LogAppeal, LogBan, LogGroupMove, GroupMoveEndWhy, LogInfraction, LogReport, ReportResult, ReportVerdict, Visit, VisitBand, VisitChallenge, VisitCharge, VisitEnd, VisitOutcome, VisitStory,
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
/** The most posts one `post_tails` call takes (0149). */
const TAILS_CALL = 200;
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
/** A jsonb object of numbers by key (a ledger row's `params`, 0073), and for a card's boost the card's key as a string; null where it is none or holds anything else. */
const numbers = (v: unknown): Readonly<Record<string, number | string>> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))) ? v as Record<string, number | string> : null;

/** A row of account_preferences, or set_preferences' answer, in the screens' words; a column it lacks is its default. */
function toPreferences(r: Row): Preferences {
  const d = DEFAULT_PREFERENCES;
  return {
    theme: r['theme'] ?? d.theme, mode: r['mode'] === 'light' || r['mode'] === 'dark' ? r['mode'] : d.mode, postbit: r['postbit'] ?? d.postbit, motion: r['motion'] ?? d.motion,
    smoke: r['smoke'] ?? d.smoke, contrast: r['contrast'] ?? d.contrast, textSize: num(r['text_size'], d.textSize) as Preferences['textSize'],
    tilt: r['tilt'] === 'on' ? 'on' : d.tilt,
    effects: r['effects'] === 'bright' ? 'bright' : d.effects,
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

/** The characters a body puts words in the mouth of, as the act function reads them (engine/rules/actions.ts): nothing when there are none. */
const framed = (framing: readonly string[] | undefined): Record<string, unknown> => (framing && framing.length > 0 ? { framing } : {});

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
    ...(r['untaken'] === true ? { untaken: true as const } : {}),
  };
}

/** A staff member's set where a read hands it beside a name: null (a persona with no profile row) is the engine's it/its. */
const pronounsOrDefault = (v: unknown): PronounSet => (isObject(v) ? (v as unknown as PronounSet) : ENGINE_DEFAULT_PRONOUNS);

/** One row of `updates`, or post_update's answer, which is the same row. A change that is not a { label, text } of words is no line. */

function toUpdate(r: Row): Update {
  const changes = Array.isArray(r['changes']) ? (r['changes'] as Row[]) : [];
  return {
    act: r['act'], thread: r['thread'], character: r['character'], name: String(r['name'] ?? ''), tagline: String(r['tagline'] ?? ''), pronouns: pronounsOrDefault(r['pronouns']), avatar: str(r['avatar']),
    title: String(r['title'] ?? ''), body: String(r['body'] ?? ''),
    changes: changes.filter((c) => typeof c?.['text'] === 'string').map((c) => ({ label: typeof c['label'] === 'string' ? c['label'] : '', text: String(c['text']) })),
    at: String(r['at']), seq: num(r['seq']),
  };
}

/** The contact `admin_contact` answers, or `set_admin_contact` stored: a row that is not a { label, href } of words is no link. */
function toContact(v: unknown): ContactLink[] {
  return (Array.isArray(v) ? (v as Row[]) : []).flatMap((e) => (typeof e?.['label'] === 'string' && typeof e['href'] === 'string' ? [{ label: e['label'], href: e['href'] }] : []));
}

/** The names a tally Act holds under `key`; an entry with no id or name is no line. A class is kept only where the entry says it. */
function toTallyNames(v: unknown): TallyName[] {
  return (Array.isArray(v) ? (v as Row[]) : []).flatMap((e) => (typeof e?.['character'] === 'string' && typeof e['name'] === 'string'
    ? [{ character: e['character'], name: e['name'], class: str(e['class']), was: str(e['was']) }] : []));
}
/** What a player made public in a season: an entry that is neither a reveal nor a Turn is no line. */
function toShown(v: unknown): SeasonShown[] {
  return rowsOf(v).flatMap((x): SeasonShown[] => (x?.['kind'] === 'reveal' || x?.['kind'] === 'turn'
    ? [{ kind: x['kind'], act: String(x['act']), at: String(x['at']), class: str(x['class']), was: str(x['was']) }] : []));
}
/** One row of a finished season's table (`results_page`), or one of the top three a results item carries. A row with no character is no row. */
function toResult(t: Row): SeasonResultRow[] {
  return typeof t?.['character'] === 'string'
    ? [{ character: t['character'], name: String(t['name'] ?? ''), place: num(t['place']), standing: num(t['standing']), shown: toShown(t['shown']) }] : [];
}
/** One row of `season_news` (0063, 0099, 0100). Its public detail is read as the server wrote it; what is not in the shape is left out. A results item has no Act, thread or sequence number. */
function toSeasonNews(r: Row): SeasonNewsItem {
  const detail = (r['detail'] ?? {}) as Row;
  const top = rowsOf(detail['top']).flatMap(toResult);
  return {
    kind: r['kind'], act: r['act'] ?? null, thread: r['thread'] ?? null, seq: r['seq'] === null || r['seq'] === undefined ? null : num(r['seq']), at: String(r['at']),
    season: num(r['season']), name: str(r['name']), quote: str(r['quote']), count: r['count'] === null || r['count'] === undefined ? null : num(r['count']),
    top, debuts: toTallyNames(detail['debuts']), turns: toTallyNames(detail['turns']),
  };
}
/** One of a character's past seasons, as profile_page and record_page answer it; a row with no season number is no row. */
function toSeasonRecord(r: Row): SeasonRecordRow[] {
  return typeof r?.['season'] === 'number' ? [{ season: r['season'], place: num(r['place']), standing: num(r['standing']), at: String(r['at']) }] : [];
}

/** A search cursor as the search reads return it; one with no time or Act is no cursor. */
function toSearchCursor(v: unknown): SearchCursor | null {
  return isObject(v) && typeof v['at'] === 'string' && typeof v['act'] === 'string'
    ? { rank: typeof v['rank'] === 'number' ? v['rank'] : null, at: v['at'], act: v['act'] }
    : null;
}
function toPostHit(r: Row): PostHit {
  return {
    act: r['act'], thread: r['thread'], title: str(r['title']) ?? '', board: r['board'], boardSlug: str(r['board_slug']) ?? '', boardName: str(r['board_name']) ?? '',
    seq: num(r['seq']), page: num(r['page'], 1), character: r['character'] ?? null, name: str(r['name']), createdAt: r['created_at'], snippet: str(r['snippet']) ?? '',
    cards: Array.isArray(r['cards']) ? r['cards'].filter((c): c is string => typeof c === 'string') : [],
  };
}
/** `matches` is a count to 100; `matches_more` (or the text "100+") says there were others. */
function toThreadHit(r: Row): ThreadHit {
  const m = r['matches'];
  return { ...toPostHit(r), matches: typeof m === 'number' ? m : parseInt(String(m), 10) || 0, matchesMore: r['matches_more'] === true || (typeof m === 'string' && m.endsWith('+')) };
}
function toSearchPage<T>(d: unknown, hit: (r: Row) => T): SearchPage<T> {
  if (!isObject(d)) throw new Error(NOT_READ);
  return { count: num(d['count']), more: d['more'] === true, pooled: d['pooled'] === true, results: rowsOf(d['results']).map(hit), next: toSearchCursor(d['next']) };
}
/* A cursor's rank is a number or absent (search_cursor_ok refuses a JSON null), so a page sorted by time sends none. */
const cursorArg = (after: SearchCursor | null | undefined) => (after ? (after.rank === null ? { at: after.at, act: after.act } : { ...after }) : null);
const searchArgs = (q: SearchQuery, after: SearchCursor | null | undefined) => ({
  q: q.q, author: q.author, board: q.board, from_at: q.fromAt, to_at: q.toAt, titles_only: q.titlesOnly, sort: q.sort, after: cursorArg(after), per_page: q.perPage,
});

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
    origin: toPlace(r['origin_place']),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string';

/** A play's target place (origin_place's `on`, 0079): every key's type is checked, and a shape this build does not know reads as null. */
function toPlaceOn(raw: unknown): PlaceOn | null {
  if (!isObject(raw)) return null;
  switch (raw['kind']) {
    case 'post':
      return isText(raw['thread']) && isText(raw['title']) && typeof raw['seq'] === 'number' && Number.isFinite(raw['seq'])
        ? { kind: 'post', thread: raw['thread'], title: raw['title'], seq: raw['seq'] } : null;
    case 'update':
      return isText(raw['act']) && isText(raw['title']) ? { kind: 'update', act: raw['act'], title: raw['title'] } : null;
    case 'character':
      return isText(raw['id']) && (raw['name'] === null || isText(raw['name'])) ? { kind: 'character', id: raw['id'], name: raw['name'] } : null;
    case 'thread':
      return isText(raw['id']) && isText(raw['title']) ? { kind: 'thread', id: raw['id'], title: raw['title'] } : null;
    case 'board':
      return isText(raw['slug']) && isText(raw['name']) ? { kind: 'board', slug: raw['slug'], name: raw['name'] } : null;
    default:
      return null;
  }
}

/** A spun thread's origin_place (thread_open and thread_list, 0079): null for no place, a malformed one or an unknown kind; a play whose `on` is malformed keeps `on: null`. */
function toPlace(raw: unknown): OriginPlace | null {
  if (!isObject(raw)) return null;
  if (raw['kind'] === 'play') {
    if (!(raw['card'] === null || isText(raw['card']))) return null;
    return { kind: 'play', card: raw['card'], on: toPlaceOn(raw['on']) };
  }
  const place = toPlaceOn(raw);
  return place !== null && (place.kind === 'post' || place.kind === 'update') ? place : null;
}

/**
 * The thread an `act` answer carries (it holds no list columns), with its first Act filled in. It
 * does not know a spun thread's origin (the answer names the Act, not its thread's title), so those
 * two are null here; the list reads them with the row.
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
    origin: null,
  };
}

function toBoard(r: Row): Board {
  return { id: r['id'], slug: r['slug'], name: r['name'], description: r['description'] ?? '', isSystem: r['is_system'] === true, moveAct: r['move_act'] ?? null };
}

/** One board of the index (index_page and boot, the same row), as boards() answers it. */
function toBoardSummary(r: Row): BoardSummary {
  return { ...toBoard(r), threadCount: num(r['thread_count']), lastAt: r['last_at'] ?? null, lastCharacter: r['last_character'] ?? null, lastThread: r['last_thread'] ?? null, lastTitle: r['last_title'] ?? null };
}

/** A presence box (here and presence_box answer the same): a name with no id or name is no line. */
function toPresence(v: Row): Presence {
  const names = (Array.isArray(v['names']) ? v['names'] : []).flatMap((n: Row) =>
    typeof n?.['id'] === 'string' && typeof n?.['name'] === 'string'
      ? [{ id: n['id'], name: n['name'], staff: n['staff'] === true, ...(typeof n['group'] === 'string' ? { group: n['group'] } : {}), ...(typeof n['visit_post'] === 'number' ? { visitPost: n['visit_post'] } : {}) }] : []);
  return { names, others: num(v['others']) };
}

/** A row of current_season, as season() answers it. */
const toSeason = (r: Row): Season => ({ id: r['id'], number: r['number'], startsAt: r['starts_at'], endsAt: r['ends_at'] ?? null, turnsThread: r['turns_thread'] ?? null, revealAct: r['reveal_act'] ?? null });
const toClassReveal = (r: Row): ClassReveal => ({ act: r['act'], character: r['character'], class: r['class'], at: r['at'], via: r['via'], thread: r['thread'] });
const toTurn = (r: Row): TurnAnnounced => ({ act: r['act'], character: r['character'], at: r['at'], was: r['was'] ?? null });
/** A slot of machine_now (0139_machine.sql): a card's or a pack's, never both; a hidden slot is not in the view. */
const SLOT_MOVES: readonly SlotMove['kind'][] = ['pullSlot', 'repriceSlot', 'flashSale'];
/** The move on a slot as machine_now's `move` carries it (0140), or none: a kind this client does not know is no move it can word. */
const toSlotMove = (v: unknown): SlotMove | null => {
  if (!isObject(v)) return null;
  const kind = SLOT_MOVES.find((k) => k === v['kind']);
  if (!kind || typeof v['act'] !== 'string') return null;
  const demand = toDemand(v['demand']);
  return {
    kind, act: v['act'], ends: orNull(v['ends']), demand, progress: demand ? toProgress(v['progress']) : null,
    was: num(v['was']), percent: v['percent'] == null ? null : num(v['percent']), hours: v['hours'] == null ? null : num(v['hours']),
  };
};
/** A slot as machine_now carries it, or none: a row whose availability is not one a screen can word (the view holds no hidden slot) is dropped, never shown on sale. */
const toSlot = (r: Row): Slot[] => {
  const availability = r['availability'] === 'onSale' ? 'onSale' : r['availability'] === 'soldOut' ? 'soldOut' : null;
  if (availability === null) return [];
  return [{
    id: r['slot'], position: num(r['position']),
    item: typeof r['card'] === 'string' ? { card: r['card'] } : { pack: String(r['pack'] ?? '') },
    rarity: str(r['rarity']) as Slot['rarity'],
    availability,
    price: num(r['price']), move: toSlotMove(r['move']),
  }];
};
/** A slot as admin_machine carries it (0141), or none: a row whose availability is not one of the three is dropped, never shown as something else. */
const toAdminSlot = (r: Row): AdminSlot[] => {
  const availability = (['onSale', 'soldOut', 'hidden'] as const).find((a) => a === r['availability']);
  if (!availability) return [];
  const m = isObject(r['move']) ? r['move'] : null;
  const kind = m ? SLOT_MOVES.find((k) => k === m['kind']) : undefined;
  return [{
    id: r['slot'], position: num(r['position']),
    item: typeof r['card'] === 'string' ? { card: r['card'] } : { pack: String(r['pack'] ?? '') },
    rarity: str(r['rarity']) as Slot['rarity'], availability, price: num(r['price']),
    move: m && kind && typeof m['act'] === 'string' ? { kind, act: m['act'], ends: orNull(m['ends']), percent: m['percent'] == null ? null : num(m['percent']), hours: m['hours'] == null ? null : num(m['hours']) } : null,
  }];
};
const toHeldCard = (r: Row): HeldCard => ({ card: r['card'], held: num(r['held']) });
const toMyReaction = (r: Row): MyReaction => ({ act: r['act'], kind: r['kind'], character: r['character'] });
const toPlayAbove = (x: Row): PlayAbove => ({ play: x['play'], reach: x['reach'], target: x['target'], endsAt: x['ends_at'], act: toAct(x['act']) });
const toPinned = (x: Row): PinnedThread => ({ thread: toThread(x['thread']), play: x['play'], endsAt: x['ends_at'], act: toAct(x['act']) });
/** standing_place's answer; null where it is none. */
const toStandingPlace = (v: unknown): StandingPlace | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? { standing: num((v as Row)['standing']), place: num((v as Row)['place']), of: num((v as Row)['of']) } : null;
/** The bell's count as alertsUnread() answers it: whole, at least 0, to the bound. */
const toUnread = (v: unknown): number => Math.min(ALERTS_UNREAD_BOUND, Math.max(0, Math.floor(num(v))));
/** character_post_counts' row, or none: a character that has done nothing counts zero. */
const toCounts = (v: unknown): CharacterCounts => ({ posts: num(isObject(v) ? v['posts'] : 0), spins: num(isObject(v) ? v['spins'] : 0), cards: num(isObject(v) ? v['cards'] : 0) });
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

const BANDS: readonly VisitBand[] = ['minor', 'moderate', 'severe'];
const CAUSES: readonly VisitCharge['cause'][] = ['rule', 'patrol', 'report', 'tail', 'backfire'];
const OUTCOMES: readonly VisitOutcome[] = ['filed', 'intercepted', 'trapped', 'reversed'];
const VERDICTS: readonly ReportVerdict[] = ['visit', 'dismissed', 'backfire'];
const RULINGS: readonly AppealVerdict[] = ['overturned', 'upheld', 'reduced', 'increased'];
const OFFICES: readonly Office[] = ['boss', 'mod', 'member', 'benched', 'waiting', 'developer'];
const MOVE_END_WHYS: readonly GroupMoveEndWhy[] = ['met', 'expired', 'reversed', 'unmet', 'overturned', 'superseded', 'spent'];

/** A charge as a visit's Act carries it: a band it does not name is the lightest, a cause it does not name the rule's. */
function toCharge(c: Row): VisitCharge {
  return {
    rule: str(c['rule']), ruleNumber: typeof c['rule_number'] === 'number' ? c['rule_number'] : null,
    band: BANDS.find((b) => b === c['band']) ?? 'minor', cause: CAUSES.find((k) => k === c['cause']) ?? 'rule',
  };
}

/** A visit's end, from thread_page's `end` or a `visit_end` Act's payload: null where the outcome is not one of the four. */
function toVisitEnd(e: Row, at: unknown, act: unknown): VisitEnd | null {
  const outcome = OUTCOMES.find((o) => o === e['outcome']);
  return outcome && typeof act === 'string' ? { act, at: str(at) ?? '', outcome, byAct: str(e['by_act']), line: str(e['line']) ?? '' } : null;
}

/** The challenge a visit carries: never an answer. A quiz whose question the page could not read is a distraction, which asks nothing it cannot say. */
function toChallenge(c: Row): VisitChallenge {
  if (c['kind'] === 'quiz' && typeof c['question'] === 'string' && Array.isArray(c['choices'])) return { kind: 'quiz', question: c['question'], choices: (c['choices'] as unknown[]).filter((x): x is string => typeof x === 'string') };
  if (c['kind'] === 'bribe') return { kind: 'bribe', price: num(c['price']) };
  return { kind: 'distraction' };
}

function toVisit(v: Row): Visit {
  const end = isObject(v['end']) ? toVisitEnd(v['end'], (v['end'] as Row)['at'], (v['end'] as Row)['act']) : null;
  return {
    id: v['visit'], post: v['post'], mod: v['mod'], at: str(v['at']) ?? '', endsAt: str(v['ends_at']) ?? '', line: str(v['line']) ?? '',
    charges: rowsOf(v['charges']).map(toCharge), challenge: toChallenge(isObject(v['challenge']) ? v['challenge'] : {}), end,
    ...(RULINGS.find((r) => r === v['ruling']) ? { ruling: RULINGS.find((r) => r === v['ruling'])! } : {}),
  };
}
/** effect_state rows, as effectStates() answers them. */
const toStates = (list: Row[]): Record<Id, EffectState> => Object.fromEntries(list.map((r) => [r['play'], { state: r['state'], savedAt: r['saved_at'] }]));
/** post_tails rows (0149), as tails() answers them: `failed` is the flag and never the predicate, and a waiting job has no text or time. */
const toTails = (list: Row[]): Tail[] => list.map((r) => ({
  post: r['post'], play: r['play'], version: r['version'], text: str(r['text']), failed: r['failed'] === true, waiting: r['waiting'] === true, createdAt: str(r['created_at']),
}));
/** An answer's tallies as tallies() answers them for the acts asked: an act with none is an empty tally. */
function toTallies(asked: readonly Id[], list: Row[]): Record<Id, Tally> {
  const out: Record<Id, Record<string, number>> = Object.fromEntries(asked.map((a) => [a, {}]));
  for (const r of list) (out[r['act']] ??= {})[r['kind']] = num(r['count']);
  return out;
}
/** Counts by thread as viewCounts() answers them for the threads asked: 0 for a thread with no row. */
function toViews(asked: readonly Id[], list: Row[]): Record<Id, number> {
  const out: Record<Id, number> = Object.fromEntries(asked.map((t) => [t, 0]));
  for (const r of list) out[r['thread']] = num(r['views']);
  return out;
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
    id: num(r['id']), staff: String(r['staff'] ?? ''), boss: orNull(r['boss']), bossPronouns: pronounsOrDefault(r['bossPronouns']), kind: String(r['kind'] ?? ''), params: params(r['params']), demand: toDemand(r['demand']),
    why: String(r['why'] ?? ''), goLiveAt: String(r['goLiveAt'] ?? ''), expiresAt: orNull(r['expiresAt']), structural: r['structural'] === true, boardName: orNull(r['boardName']),
    failedAt: orNull(r['failedAt']), failure: orNull(r['failure']), replacedAt: orNull(r['replacedAt']), adminDescription: orNull(r['adminDescription']),
  };
}

function toTodo(r: Row): HandoverTodo {
  return {
    season: num(r['season']), boss: String(r['boss'] ?? ''), bossName: String(r['bossName'] ?? r['boss'] ?? ''), bossPronouns: pronounsOrDefault(r['bossPronouns']), bossWas: orNull(r['bossWas']), outgoing: orNull(r['outgoing']),
    outgoingName: orNull(r['outgoingName']), outgoingPronouns: pronounsOrDefault(r['outgoingPronouns']), outgoingOffice: orNull(r['outgoingOffice']), how: String(r['how'] ?? ''), landedAt: String(r['landedAt'] ?? ''),
  };
}

function toInForce(r: Row): MoveInForce {
  return {
    act: r['act'], id: typeof r['id'] === 'number' ? r['id'] : null, staff: orNull(r['staff']), boss: orNull(r['boss']), bossPronouns: pronounsOrDefault(r['bossPronouns']), kind: String(r['kind'] ?? ''), params: params(r['params']),
    demand: toDemand(r['demand']), why: orNull(r['why']), landedAt: String(r['landedAt'] ?? ''), expiresAt: orNull(r['expiresAt']), progress: toProgress(r['progress']),
  };
}

function toEnded(r: Row): MoveEnded {
  const how = r['how'];
  return {
    how: how === 'met' || how === 'expired' || how === 'reversed' || how === 'superseded' || how === 'spent' || how === 'refused' ? how : 'held', by: orNull(r['by']), at: String(r['at'] ?? ''), act: orNull(r['act']),
    id: typeof r['id'] === 'number' ? r['id'] : null, staff: orNull(r['staff']), boss: orNull(r['boss']), bossPronouns: pronounsOrDefault(r['bossPronouns']), kind: String(r['kind'] ?? ''), params: params(r['params']),
    demand: toDemand(r['demand']), why: orNull(r['why']), landedAt: orNull(r['landedAt']), card: orNull(r['card']), reason: orNull(r['reason']),
  };
}

function toStaffCard(r: Row): StaffCardPlay {
  return {
    play: r['play'], card: String(r['card'] ?? ''), cardName: String(r['cardName'] ?? r['card'] ?? ''), staff: String(r['staff'] ?? ''), persona: String(r['persona'] ?? ''),
    targetName: orNull(r['targetName']), thread: r['thread'], threadTitle: orNull(r['threadTitle']), at: String(r['at'] ?? ''),
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
    pronouns: pronounsOrDefault(r['pronouns']),
    class: r['class'],
    classSince: r['class_since'],
    classShownAt: r['class_shown_at'] ?? null,
    classDueAt: r['class_due_at'] ?? null,
    turnOpensAt: r['turn_opens_at'] ?? null,
    debutedAt: r['debuted_at'] ?? null,
    debutLoudness: r['debut_loudness'] ?? null,
    retiredAt: r['retired_at'] ?? null,
    pendingTurn: pending,
    presenceHidden: r['presence_hidden'] === true,
    ...(typeof r['banned_until'] === 'string' && Date.parse(r['banned_until']) > Date.now() ? { bannedUntil: r['banned_until'] } : {}),
    ...(toBars(r['bars']).length > 0 ? { bars: toBars(r['bars']) } : {}),
  };
}

/** The bars `my_characters.bars` carries: each board, the move, the group and when it ends; a malformed entry is left out. */
function toBars(v: unknown): Bar[] {
  return (Array.isArray(v) ? v : []).filter((b): b is Row => isObject(b) && typeof b['board'] === 'string' && typeof b['move'] === 'string')
    .map((b): Bar => ({ board: b['board'], move: b['move'], group: typeof b['group'] === 'string' ? b['group'] : '', expiresAt: orNull(b['expires_at']) }));
}

/** One row of `finished_seasons`; a row with no number is no row. */
const toFinished = (x: Row): SeasonFinished[] => (typeof x?.['number'] === 'number'
  ? [{ number: x['number'], startsAt: String(x['starts_at']), endsAt: String(x['ends_at']), resultsAt: String(x['results_at']), characters: num(x['characters']) }] : []);

/** One row of `standings_page`, or of the season page's standings. */
const toStanding = (x: Row): Standing => ({ character: x['character'], name: x['name'], standing: num(x['standing']), place: num(x['place']) });

/** One row of `my_alerts`; a kind this build does not know (a newer server's) is no line, rather than a line a screen cannot word. */
function toAlert(a: Row): Alert[] {
  return (ALERT_KINDS as readonly string[]).includes(String(a['kind']))
    ? [{
      kind: a['kind'] as AlertKind, sub: str(a['sub']), act: str(a['act']), character: str(a['character']), at: String(a['at']),
      thread: str(a['thread']), name: str(a['name']), title: str(a['title']), count: typeof a['count'] === 'number' ? a['count'] : null,
    }]
    : [];
}

/** What `admin_queue` answers, as `adminQueue()` and the Updates and queue pages carry it. */
function toAdminQueue(v: unknown): AdminQueue {
  const q = isObject(v) ? v : {};
  const more = (isObject(q['more']) ? q['more'] : {}) as Row;
  return {
    cap: num(q['cap']), waiting: rowsOf(q['waiting']).map(toQueued), inForce: rowsOf(q['inForce']).map(toInForce), ended: rowsOf(q['ended']).map(toEnded),
    staffCards: rowsOf(q['staffCards']).map(toStaffCard),
    more: { waiting: more['waiting'] === true, inForce: more['inForce'] === true, staffCards: more['staffCards'] === true, ended: more['ended'] === true },
    roster: rowsOf(q['roster']).flatMap((r) => (typeof r['staff'] === 'string' ? [{ staff: r['staff'], name: String(r['name'] ?? r['staff']), pronouns: pronounsOrDefault(r['pronouns']) }] : [])),
    todos: rowsOf(q['todos']).flatMap((r) => (typeof r['boss'] === 'string' ? [toTodo(r)] : [])),
  };
}

/** One of the roster rows `boss_roster_names` answers. */
const toBosses = (v: unknown): { readonly staff: string; readonly name: string; readonly pronouns: PronounSet }[] => rowsOf(v).flatMap((x) => (typeof x['staff'] === 'string' ? [{ staff: x['staff'], name: String(x['name'] ?? x['staff']), pronouns: pronounsOrDefault(x['pronouns']) }] : []));

/** The log's rows as `readLogPage` reads them, from the rows of the player's views (`log`) or of `log_page`'s sources: both name their columns the same. */
function toLogRead(src: Readonly<Record<'ledger' | 'wallet' | 'cards' | 'packs' | 'playsOnMine' | 'writes' | 'saves' | 'setEnds' | 'caught' | 'ended' | 'infractions' | 'bans' | 'groupMoves' | 'reports' | 'appeals', Row[]>>, shareRows: Row[], backs: ReadonlyMap<string, Row> = new Map()): LogRead {
  const ledger = src['ledger'].map((r): LedgerRow => ({
    settlement: num(r['settlement']), startsAt: r['starts_at'], endsAt: r['ends_at'], sharesKept: r['shares_kept'] !== false,
    character: r['character'], reason: r['reason'], amount: num(r['amount']), ...((p) => (p ? { params: p } : {}))(numbers(r['params'])),
  }));
  const shares: ShareRow[] = [...shareRows].sort((a, b) => num(b['settlement']) - num(a['settlement']))
    .map((r) => ({ settlement: num(r['settlement']), character: r['character'], reason: r['reason'], act: r['act'], quadrant: r['quadrant'] ?? null, amount: num(r['amount']) }));
  return {
    ledger,
    shares,
    wallet: src['wallet'].map((r): WalletEvent => ({
      settlement: typeof r['settlement'] === 'number' ? r['settlement'] : null, kind: r['kind'], change: num(r['change']), overflow: num(r['overflow']),
      floored: num(r['floored']), balanceAfter: num(r['balance_after']), ref: r['ref'] ?? null, at: r['at'],
    })),
    cards: src['cards'].map((r): CardEvent => ({
      card: r['card'], kind: r['kind'], act: r['act'] ?? null, price: num(r['price']), at: r['at'],
      ...(typeof r['springs'] === 'boolean' ? { springs: r['springs'] } : {}),
      /* What a card set face down waits for: the setter's own back (`my_face_down`), read beside the ledger. */
      ...(typeof backs.get(r['act'])?.['catches'] === 'string' ? { catches: backs.get(r['act'])!['catches'] } : {}),
      ...(typeof backs.get(r['act'])?.['phrase'] === 'string' ? { phrase: backs.get(r['act'])!['phrase'] } : {}),
      ...(typeof backs.get(r['act'])?.['passage'] === 'string' ? { passage: backs.get(r['act'])!['passage'] } : {}),
      ...(Array.isArray(backs.get(r['act'])?.['who']) ? { who: backs.get(r['act'])!['who'], whoExcept: backs.get(r['act'])!['who_except'] === true } : {}),
      ...(typeof r['pack'] === 'string' ? { pack: r['pack'] } : {}),
      ...(r['kind'] === 'bought' && r['repriced'] === true ? { repriced: true } : {}),
    })),
    packs: src['packs'].map((r): PackEvent => ({
      pack: r['id'], kind: r['pack'], price: num(r['price']), repriced: r['repriced'] === true,
      contents: Array.isArray(r['contents']) ? r['contents'].filter((c): c is string => typeof c === 'string') : [], at: r['bought_at'],
    })),
    playsOnMine: src['playsOnMine'].map((r) => ({ play: r['play'], post: r['post'], at: r['at'], reach: r['reach'], targetName: r['target_name'] ?? null, targetCharacter: r['target_character'] ?? null })),
    writes: src['writes'].map((r): WrittenOnMine => ({ play: r['play'], post: r['post'], version: r['version'], failed: r['failed'] === true, opening: r['opening'] === true, over: r['over'] === true, at: r['at'] })),
    saves: src['saves'].map((r) => ({ play: r['play'], post: r['post'], savedAt: r['saved_at'] })),
    setEnds: src['setEnds'].map((r): FaceDownEnd => ({ play: r['play'], card: r['card'], post: r['post'], spring: r['spring'] ?? null, endedAt: r['ended_at'], endedBy: r['ended_by'] === 'taken back' || r['ended_by'] === 'sprung' || r['ended_by'] === 'time' ? r['ended_by'] : r['spring'] ? 'sprung' : 'time' })),
    caught: src['caught'].map((r): CaughtPlay => ({
      play: r['play'], card: r['card'], post: r['post'], trap: r['trap'], spring: r['spring'], price: num(r['price']),
      boughtPrice: r['bought_price'] === null || r['bought_price'] === undefined ? null : num(r['bought_price']), at: r['at'],
    })),
    ended: src['ended'].map((r): CardEnded => ({
      cardEnd: r['card_end'], play: r['play'], card: r['card'], at: r['at'], side: r['side'], reach: r['reach'],
      targetName: r['target_name'] ?? null, postAuthorName: r['post_author_name'] ?? null, casterName: r['caster_name'] ?? null, character: r['character'],
    })),
    infractions: src['infractions'].map((r): LogInfraction => ({
      infraction: r['infraction'], character: r['character'], at: r['at'], band: BANDS.find((b) => b === r['band']) ?? 'minor', points: num(r['points']),
      ruleNumber: typeof r['rule_number'] === 'number' ? r['rule_number'] : null, rule: str(r['rule']), mod: str(r['mod_name']), post: r['post'],
      postSeq: typeof r['post_seq'] === 'number' ? r['post_seq'] : null, thread: r['thread'], expiresAt: r['expires_at'], relief: num(r['relief']), emptiedAt: str(r['emptied_at']),
    })),
    bans: src['bans'].map((r): LogBan => ({ ban: r['ban'], character: r['character'], at: r['at'], days: num(r['days']), until: r['until'], infraction: r['infraction'], rule: str(r['rule']), thread: r['thread'] })),
    groupMoves: src['groupMoves'].map((r): LogGroupMove => ({
      move: r['move'], character: r['character'], at: r['at'], thread: r['thread'], seq: typeof r['seq'] === 'number' ? r['seq'] : null, group: String(r['group'] ?? ''),
      board: str(r['board']), boardName: str(r['board_name']), expiresAt: str(r['expires_at']), landedUntil: str(r['landed_until']), checkAt: str(r['check_at']), demand: str(r['demand']),
      office: OFFICES.find((o) => o === r['office']) ?? null,
      endedWhy: MOVE_END_WHYS.find((w) => w === r['ended_why']) ?? null, endedBy: str(r['ended_by']), endedAt: str(r['ended_at']),
      ruling: RULINGS.find((v) => v === r['ruling']) ?? null, ruledAt: str(r['ruled_at']), ruledUntil: str(r['ruled_until']),
    })),
    reports: src['reports'].map((r): LogReport => ({
      report: r['report'], character: r['character'], at: r['at'], post: r['post'], postSeq: typeof r['post_seq'] === 'number' ? r['post_seq'] : null, thread: r['thread'],
      verdict: VERDICTS.find((v) => v === r['verdict']) ?? null, verdictAt: str(r['verdict_at']), mod: str(r['mod_name']), refund: r['refund'] === 'failed' || r['refund'] === 'stale' ? r['refund'] : null,
    })),
    appeals: src['appeals'].map((r): LogAppeal => ({
      appeal: r['appeal'], character: r['character'], at: r['at'], punishment: r['punishment'], punishmentKind: r['punishment_kind'] === 'ban' ? 'ban' : r['punishment_kind'] === 'move' ? 'move' : 'infraction',
      postSeq: typeof r['post_seq'] === 'number' ? r['post_seq'] : null, thread: r['thread'], verdict: RULINGS.find((v) => v === r['verdict']) ?? null, ruledAt: str(r['ruled_at']),
      pointsDelta: typeof r['points_delta'] === 'number' ? r['points_delta'] : null, hearer: str(r['hearer_name']),
      refund: r['refund'] === 'failed' || r['refund'] === 'stale' || r['refund'] === 'expired' ? r['refund'] : null,
    })),
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
  /** An admin's trophy art, in the public `trophies` bucket (an instance's own kinds have none: their art is the instance UI's, by the kind's key). */
  const trophyArtUrl = (key: string | null): string | null => (key ? `${url}/storage/v1/object/public/trophies/${key}` : null);

  /* ------------------------------------------------------------- the request layer ---- */

  const transport = (r: Res) => r.error !== null && (r.status === 0 || r.status >= 500);

  /**
   * A read whose arguments the server may refuse (the search reads, through screen_refusal): a refusal carrying the hint is thrown in the
   * server's own words, so a screen can tell a refused search from one that never reached the server (NOT_READ); anything else is `read`'s.
   */
  async function refusableRead(run: () => PromiseLike<unknown>): Promise<Res> {
    let refused = null as string | null;
    const r = await read(async () => {
      const x = (await run()) as Res;
      if (x.error?.hint === REFUSAL_HINT && x.error.message) refused = x.error.message;
      return x;
    }).catch((e: unknown) => {
      if (refused !== null) throw new Error(refused);
      throw e;
    });
    return r;
  }
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

  /** What screen_settings holds laid over the instance's compiled defaults: a key it lacks, or holds as another type, is the default. */
  function mergeSettings(held: Row): ScreenSettings {
    const out: Row = { ...settingsFallback };
    for (const key of Object.keys(settingsFallback)) {
      const v = held[key];
      const d = (settingsFallback as unknown as Row)[key];
      if (v !== null && v !== undefined && typeof v === typeof d) out[key] = v;
    }
    return out as unknown as ScreenSettings;
  }
  let settingsOnce: Promise<ScreenSettings> | null = null;
  function settings(): Promise<ScreenSettings> {
    settingsOnce ??= list(() => client.from('screen_settings').select('settings').limit(1))
      .then((rows) => mergeSettings(rows[0]?.['settings'] ?? {}))
      .catch((e: unknown) => {
        settingsOnce = null;
        throw e;
      });
    return settingsOnce;
  }

  /* ---------------------------------------------------------------- characters ---- */

  /** The office characters_public shows a staff character; anything else it might say is no office. */
  const toOffice = (o: unknown): Office | undefined => (o === 'boss' || o === 'mod' || o === 'member' || o === 'benched' || o === 'waiting' || o === 'developer' ? o : undefined);

  /** A piece worn as gear_worn or a profile's `outfit` has it, in layer order. */
  const toPieces = (v: unknown): Piece[] => rowsOf(v).map((w): Piece => ({ gear: w['gear'], x: num(w['x']), y: num(w['y']), w: num(w['w']), turn: num(w['turn']), layer: num(w['layer']) })).sort((a, b) => a.layer - b.layer);
  /** An award as `trophy_item` has it; `held` is a belt's alone, null otherwise. */
  const toShownTrophy = (t: Row): ShownTrophy => ({ award: t['award'], trophy: t['trophy'], name: t['name'], art: trophyArtUrl(str(t['art'])), belt: t['belt'] === true, held: t['held'] === true });
  const toTrophyItem = (t: Row): TrophyItem => ({ ...toShownTrophy(t), line: str(t['line']), at: t['at'], by: t['by'], season: typeof t['season'] === 'number' ? t['season'] : null,
    move: ((m: Row | null) => (m ? { act: m['act'], thread: m['thread'], seq: m['seq'] } : null))(typeof t['move'] === 'object' ? (t['move'] as Row | null) : null), shown: t['shown'] === true });

  const toCharacter = (c: Row, p: Row | undefined): Character => ({
    id: c['id'],
    name: c['name'],
    title: p?.['title'] ?? '',
    signature: p?.['signature'] ?? '',
    avatarSquare: avatarUrl(p?.['avatar_square'] ?? null),
    avatarPortrait: avatarUrl(p?.['avatar_portrait'] ?? null),
    squareFrame: toFrame(p?.['square_frame']),
    portraitFrame: toFrame(p?.['portrait_frame']),
    portraitTallness: typeof p?.['portrait_tallness'] === 'number' ? p['portrait_tallness'] : null,
    outfit: toPieces(p?.['outfit']),
    trophies: rowsOf(p?.['trophies']).map(toShownTrophy),
    pipStyle: p?.['pip_style'] ?? 'default',
    /* The set is read from the profile row; the engine's it/its stands only for a character with no profile row at all. */
    pronouns: p ? pronounsOrDefault(p['pronouns']) : ENGINE_DEFAULT_PRONOUNS,
    joined: c['joined'] ?? '',
    ...(typeof c['warn_points'] === 'number' && c['warn_points'] > 0 ? { warnPoints: c['warn_points'] } : {}),
    ...(typeof c['banned_until'] === 'string' && Date.parse(c['banned_until']) > Date.now() ? { bannedUntil: c['banned_until'] } : {}),
    ...(typeof c['staff'] === 'string' ? { staff: c['staff'], ...(toOffice(c['office']) ? { office: toOffice(c['office'])! } : {}) } : {}),
    group: typeof c['group'] === 'string' ? c['group'] : '',
  });

  /** A character a document carries with its profile nested (`profile` null where it has none). */
  const faceOf = (c: Row): Character => toCharacter(c, isObject(c['profile']) ? c['profile'] : undefined);

  async function characters(ids: readonly Id[]): Promise<readonly Character[]> {
    if (ids.length === 0) return [];
    /* Three reads in parallel, each a lookup by character: its name, its profile and the pieces it wears (gear_worn, public by character). The shelf of trophies has no
       table to read (trophy_shelf is the server's): a face read here carries none, and a screen document carries it nested with the profile. */
    const [cs, ps, worn] = await Promise.all([
      byChunks(ids, (part) => list(() => client.from('characters_public').select('id,name,joined,staff,office,group').in('id', part))),
      byChunks(ids, (part) => list(() => client.from('character_profiles').select('character,title,signature,avatar_square,avatar_portrait,square_frame,portrait_frame,portrait_tallness,pip_style,pronouns').in('character', part))),
      /* Paged and ordered, since a chunk of masks can wear more than the row cap holds: a page cut short would drop pieces silently. */
      byChunks(ids, (part) => every((start, end) => client.from('gear_worn').select('character,layer,gear,x,y,w,turn').in('character', part).order('character', { ascending: true }).order('layer', { ascending: true }).range(start, end))),
    ]);
    const outfits = new Map<string, Row[]>();
    for (const w of worn) outfits.set(w['character'] as string, [...(outfits.get(w['character'] as string) ?? []), w]);
    const profile = new Map(ps.map((p) => [p['character'] as string, { ...p, outfit: outfits.get(p['character'] as string) ?? [] }]));
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
      found = (await list(() => client.from('characters_public').select('id,name,joined,staff,office,group').eq('id', p['character']).limit(1)))[0];
    } catch {
      found = undefined;
    }
    return toCharacter({ id: p['character'], name: found?.['name'] ?? '', joined: found?.['joined'] ?? '', staff: found?.['staff'], office: found?.['office'], group: found?.['group'] }, p);
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
  /**
   * The `card_end` Acts of these rows' card plays (an admin's reversal, 0092): each targets its play, so the plays-on-a-post read
   * cannot find them and they are asked for by the plays' ids, in chunks. At most one per play (a unique index), so a chunk of
   * plays needs no more rows than it has, and ID_CHUNK bounds each read. Returned beside the plays in the same list; the plays are unchanged.
   */
  const endsOf = async (plays: readonly Row[]): Promise<Row[]> => {
    const ids = plays.filter((r) => r['kind'] === 'card' && typeof r['id'] === 'string' && idOk(r['id'])).map((r) => r['id'] as string);
    if (ids.length === 0) return [];
    const rows = await byChunks(ids, (part) => list(() => client.from('acts_public').select('*').eq('kind', 'card_end').in('target_act_id', part).order('created_at', { ascending: true }).limit(ID_CHUNK)));
    return merged(rows, 'created_at', 'id');
  };
  const act = async <T,>(body: Row, map: (r: Row) => T | Promise<T>): Promise<Answer<T>> => {
    const a = await edge('act', body, LOST);
    return a.ok ? { ok: true, value: await map(a.value) } : a;
  };
  const withThread = (r: Row) => {
    const a = toAct(r['act']);
    return { thread: toNewThread(r['thread'], a), act: a };
  };

  /*
   * What each card set face down waits for (`my_face_down.catches`, `.phrase`, `.passage`, `.who` and `.who_except`, the setter's own row, 0142 and 0144), by set: the ledger row of a set carries `springs` and
   * names neither. Only the ledger rows of a set are asked for; a read that fails leaves the log's line to say "the card it names", never an unread page.
   */
  const readBacks = async (cards: readonly Row[]): Promise<ReadonlyMap<string, Row>> => {
    const sets = cards.filter((r) => typeof r['springs'] === 'boolean' && typeof r['act'] === 'string').map((r) => r['act'] as string);
    if (sets.length === 0) return new Map();
    try {
      return new Map((await byChunks(sets, (part) => list(() => client.from('my_face_down').select('play,catches,phrase,passage,who,who_except').in('play', part)))).map((r) => [r['play'] as string, r]));
    } catch { return new Map(); }
  };

  /* The views the log is read from, one range of them: what `log` reads, and what `logPage` reads again for a page that would not move. */
  const readLogViews = async (range: LogRange): Promise<LogRead> => {
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
    const [ledgerRows, walletRows, cardRows, packRows, playRows, writeRows, saveRows, endRows, caughtRows, endedRows, infractionRows, banRows, groupMoveRows, reportRows, appealRows] = await Promise.all([
      rows(() => client.from('my_ledger').select('settlement,starts_at,ends_at,character,reason,amount,shares_kept,params'), 'ends_at',
        (q) => q.order('character', { ascending: true }).order('reason', { ascending: true }), ['settlement', 'character', 'reason']),
      rows(() => client.from('my_wallet_events').select('settlement,kind,change,overflow,floored,balance_after,ref,at'), 'at', (q) => q, ['settlement', 'kind', 'ref', 'change', 'overflow', 'floored', 'balance_after']),
      rows(() => client.from('my_card_ledger').select('card,kind,act,price,at,springs,pack,repriced'), 'at', (q) => q, ['card', 'kind', 'act', 'price', 'pack']),
      /* The packs the player bought (0139): kind, price, the Boss's markup and the cards in pull order; the pulled rows above name each by `pack`. */
      rows(() => client.from('my_packs').select('id,pack,price,repriced,contents,bought_at'), 'bought_at', (q) => q, ['id']),
      rows(() => client.from('my_posts_played_on').select('play,post,at,reach,target_name,target_character'), 'at', (q) => q, ['play']),
      /* The texts and failures of cards that write on the posts the player's characters wrote (0149): the rows are the author's alone, and public facts. */
      rows(() => client.from('my_posts_written_on').select('play,post,version,failed,opening,over,at'), 'at', (q) => q.order('play', { ascending: true }).order('version', { ascending: true }), ['play', 'version']),
      rows(() => client.from('my_posts_played_on').select('play,post,saved_at').not('saved_at', 'is', null), 'saved_at', (q) => q, ['play']),
      /* The player's own cards set face down, by when each sprang or ended (0054); one still live has no end yet. */
      rows(() => client.from('my_face_down').select('play,card,post,spring,ended_at,ended_by').not('ended_at', 'is', null), 'ended_at', (q) => q, ['play']),
      rows(() => client.from('my_caught').select('play,card,post,trap,spring,price,bought_price,at'), 'at', (q) => q, ['play']),
      /* The card plays an admin ended that the player cast or that landed on theirs (0092); a third party's reversal is in no one's view but its own. */
      rows(() => client.from('my_cards_ended').select('card_end,play,card,at,side,reach,target_name,post_author_name,caster_name,character'), 'at', (q) => q, ['card_end']),
      /* The Mod Bots' lines (0111): the warn points, bans, reports and appeals of the player's own characters; each view answers from the caller's own rows alone. */
      rows(() => client.from('my_infractions').select('infraction,character,at,band,points,rule_number,rule,mod_name,post,post_seq,thread,expires_at,relief,emptied_at'), 'at', (q) => q, ['infraction']),
      rows(() => client.from('my_bans').select('ban,character,at,days,until,infraction,rule,thread'), 'at', (q) => q, ['ban']),
      /* The staff moves of the player's characters into groups (0134): each with how it ended and the appeal's ruling on it. */
      rows(() => client.from('my_group_moves').select('move,character,at,thread,seq,group,board,board_name,expires_at,landed_until,check_at,demand,office,ended_why,ended_by,ended_at,ruling,ruled_at,ruled_until'), 'at', (q) => q, ['move']),
      rows(() => client.from('my_reports').select('report,character,at,post,post_seq,thread,verdict,verdict_at,mod_name,refund'), 'at', (q) => q, ['report']),
      rows(() => client.from('my_appeals').select('appeal,character,at,punishment,punishment_kind,post_seq,thread,verdict,ruled_at,points_delta,hearer_name,refund'), 'at', (q) => q, ['appeal']),
    ]);
    const ids = [...new Set(ledgerRows.map((r) => num(r['settlement'])))];
    /* Paged within each chunk of settlements, then merged in the read's own order. A settlement's rows all come from
       one chunk, already in the server's order (its collation for the text keys), so the merge is a stable sort
       by settlement alone, newest first, which keeps that order inside each settlement. The log files each share
       under its line (engine/ui/data/log-page.ts), so no screen sees the order across settlements; the sort keeps
       the read's promise of each source newest first, as one query answered it. */
    const shareRows = ids.length === 0 ? [] : await byChunks(ids, (part) => every((start, end) => client.from('my_ledger_shares').select('settlement,character,reason,act,quadrant,amount').in('settlement', part)
      .order('settlement', { ascending: false }).order('character', { ascending: true }).order('reason', { ascending: true }).order('act', { ascending: true }).order('quadrant', { ascending: true })
      .range(start, end)));
    return toLogRead({ ledger: ledgerRows, wallet: walletRows, cards: cardRows, packs: packRows, playsOnMine: playRows, writes: writeRows, saves: saveRows, setEnds: endRows, caught: caughtRows, ended: endedRows, infractions: infractionRows, bans: banRows, groupMoves: groupMoveRows, reports: reportRows, appeals: appealRows }, shareRows, await readBacks(cardRows));
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
          return { ...toBoard(b), threadCount: threadCounts.get(b['id']) ?? 0, lastAt: l?.['last_at'] ?? null, lastCharacter: l?.['last_character'] ?? null, lastThread: l?.['id'] ?? null, lastTitle: l?.['title'] ?? null };
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
    async myApologies(character) {
      if (!idOk(character)) return [];
      const rows = await list(() => client.rpc('my_apologies', { in_character: character }));
      return rows.map((r): Apology => ({
        move: r['move_act'], state: r['state'] === 'accepted' || r['state'] === 'rejected' || r['state'] === 'returned' ? r['state'] : 'pending', at: String(r['created_at'] ?? ''), nextAt: orNull(r['next_at']),
      }));
    },
    async appealedMoves(character) {
      if (!idOk(character)) return [];
      /* my_appeals (0111) is the caller's own characters' appeals; one refunded for a failed or stale judgment leaves the move appealable again (appeal_blocks). */
      const rows = await list(() => client.from('my_appeals').select('punishment,refund').eq('character', character).eq('punishment_kind', 'move'));
      return rows.filter((r) => r['refund'] !== 'failed' && r['refund'] !== 'stale').map((r): Id => r['punishment']);
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
          ...(r['kind'] === 'visit' || r['kind'] === 'report' || r['kind'] === 'appeal' ? { outcome: typeof r['ended_why'] === 'string' ? r['ended_why'] : null } : {}),
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
    async staffCareer(staff): Promise<Career> {
      const v = (await read(() => client.rpc('staff_career', { of_staff: staff }))).data;
      const c = v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
      const rows = (x: unknown): Row[] => (Array.isArray(x) ? (x as Row[]) : []);
      const until = (x: unknown): string | null => (typeof x === 'string' ? x : null);
      return {
        led: rows(c['led']).map((r) => ({ season: num(r['season']), since: String(r['since'] ?? ''), until: until(r['until']), how: String(r['how'] ?? '') })),
        offices: rows(c['offices']).map((r) => ({ office: String(r['office'] ?? ''), since: String(r['since'] ?? ''), until: until(r['until']), cause: String(r['cause'] ?? '') })),
      };
    },
    async adminQueue(): Promise<AdminQueue> {
      return toAdminQueue((await read(() => client.rpc('admin_queue'))).data);
    },
    async dismissHandoverTodo(season) {
      const a = await rpcWrite(() => client.rpc('dismiss_handover_todo', { season_number: season }));
      return a.ok ? { ok: true, value: { season: num(a.value['season']) } } : a;
    },
    /* A page of the Updates (`updates`, 0062): public, the same for every reader, newest first. */
    async updates(before) {
      const r = await read(() => client.rpc('updates', { before: before ?? null, most: UPDATES_PAGE }));
      return (Array.isArray(r.data) ? (r.data as Row[]) : []).map(toUpdate);
    },
    /* The seasons whose results landed (`finished_seasons`, 0099): public, newest first. */
    async finishedSeasons() {
      const r = await read(() => client.rpc('finished_seasons'));
      return rowsOf(r.data).flatMap(toFinished);
    },
    /* A page of a finished season's final table (`results_page`, 0099): 50 rows. */
    async resultsPage(season, page) {
      const r = await read(() => client.rpc('results_page', { in_season: season, page }));
      return rowsOf(r.data).flatMap(toResult);
    },
    /* A character's 0-based index in that table (`result_place`, 0099), or null where the season has no row for it. */
    async resultPlace(season, character) {
      if (!idOk(character)) return null;
      const r = await read(() => client.rpc('result_place', { in_season: season, in_character: character }));
      return typeof r.data === 'number' ? r.data : null;
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
    /* How players reach the admins (`admin_contact`, 0081): public, one setting, the same for every caller. A row that is not a link is left out. */
    async adminContact() {
      const r = await read(() => client.rpc('admin_contact'));
      return toContact(r.data);
    },
    async setAdminContact(links) {
      const a = await rpcWrite(() => client.rpc('set_admin_contact', { links: links.map((l) => ({ label: l.label, href: l.href })) }));
      return a.ok ? { ok: true, value: toContact(a.value) } : a;
    },
    async holdMove(id) {
      const a = await rpcWrite(() => client.rpc('hold_move', { id }));
      return a.ok ? { ok: true, value: { id: num(a.value['id']), heldAt: String(a.value['heldAt'] ?? '') } } : a;
    },
    async replaceSuccessor(id, boss) {
      const a = await rpcWrite(() => client.rpc('replace_successor', { id, boss }));
      return a.ok ? { ok: true, value: { id: num(a.value['id']), boss: String(a.value['boss'] ?? '') } } : a;
    },
    async replaceQueuedDescription(id, description) {
      const a = await rpcWrite(() => client.rpc('replace_queued_description', { id, description }));
      return a.ok ? { ok: true, value: { id: num(a.value['id']), description: String(a.value['description'] ?? '') } } : a;
    },
    async describeBoard(board, description) {
      const a = await rpcWrite(() => client.rpc('describe_board', { board, description }));
      return a.ok ? { ok: true, value: { board: String(a.value['board'] ?? board), description: String(a.value['description'] ?? '') } } : a;
    },
    /* The Boss list is the database's roster (`boss_roster_names`, 0082, an admin's read): a waiting persona's name is in no public view. */
    async bosses() {
      return toBosses((await read(() => client.rpc('boss_roster_names'))).data);
    },
    /* The names anyone may read: staff in characters_public, which holds only the debuted. */
    async staffNames() {
      const rowsOf = await list(() => client.from('characters_public').select('id,staff,name').not('staff', 'is', null));
      /* Their pronouns are their profiles': one more read of the same characters, public like the names. */
      /* A failed read of the sets costs the sets, not the names: each then reads as the engine's it/its. */
      const sets = new Map((await byChunks(rowsOf.map((x) => x['id'] as string), (part) => list(() => client.from('character_profiles').select('character,pronouns').in('character', part))).catch(() => [] as Row[])).map((p) => [p['character'], p['pronouns']]));
      return rowsOf.flatMap((x) => (typeof x['staff'] === 'string' ? [{ staff: x['staff'], name: String(x['name'] ?? ''), pronouns: pronounsOrDefault(sets.get(x['id'])) }] : []));
    },
    async reverseMove(act) {
      const a = await rpcWrite(() => client.rpc('reverse_move', { move_act: act }));
      return a.ok ? { ok: true, value: { act: a.value['act'], endedBy: a.value['endedBy'] } } : a;
    },
    /* An admin's end of a card goes through the act function, which owns the broadcasts (a layer comes off for everyone reading). */
    reverseCard: (play) => act({ action: 'reverseCard', play }, (r) => ({ act: r['id'], play: r['play'] })),
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
      return [...rows, ...await endsOf(rows)].map(toAct);
    },
    async cardsOnMany(actIds, limit) {
      const wanted = [...new Set(actIds)].filter(idOk);
      if (wanted.length === 0) return [];
      const rows = await byChunks(wanted, (part) => list(() => client.from('acts_public').select('*').in('kind', LAYER_KINDS).in('target_act_id', part).order('created_at', { ascending: true }).limit(rowLimit(limit))));
      const plays = merged(rows, 'created_at', 'id', rowLimit(limit));
      return [...plays, ...await endsOf(plays)].map(toAct);
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
        .map(toPlayAbove)
        .sort((a, b) => (a.act.createdAt < b.act.createdAt ? -1 : a.act.createdAt > b.act.createdAt ? 1 : a.play < b.play ? -1 : a.play > b.play ? 1 : 0));
    },
    async pinnedThreads(board) {
      /* One read of the board's live pins (pinned_threads, 0055), newest first, as the server orders them. */
      if (!idOk(board)) return [];
      const r = await read(() => client.rpc('pinned_threads', { board }));
      const rows = Array.isArray(r.data) ? (r.data as Row[]) : [];
      return rows.map(toPinned);
    },
    async effectStates(plays) {
      const wanted = [...new Set(plays)].filter(idOk);
      const out: Record<Id, EffectState> = {};
      if (wanted.length === 0) return out;
      const rows = await byChunks(wanted, (part) => list(() => client.from('effect_state').select('play,state,saved_at').in('play', part)));
      for (const r of rows) out[r['play']] = { state: r['state'], savedAt: r['saved_at'] };
      return out;
    },
    async tails(posts) {
      /* post_tails (0149) holds a call to 200 posts, which is what the screens ask for at most: a page's posts are one call, and a longer list is cut at that, run together. The rows come as the server orders them (version, then play). */
      const wanted = [...new Set(posts)].filter(idOk);
      if (wanted.length === 0) return [];
      const parts = Array.from({ length: Math.ceil(wanted.length / TAILS_CALL) }, (_, i) => wanted.slice(i * TAILS_CALL, (i + 1) * TAILS_CALL));
      const answers = await Promise.all(parts.map((part) => every((start, end) => client.rpc('post_tails', { posts: part }).range(start, end))));
      return toTails(answers.flat());
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
        above: (m['above'] as Row[]).map(toPlayAbove),
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
    /* A purchase names its slot and the price the screen showed; the database holds the slot and refuses a price that has since changed. */
    buyCard: (slot) => act({ action: 'buyCard', slot: slot.id, price: slot.price }, (r): Bought => ({ card: r['card'], balance: num(r['balance']), held: num(r['held']) })),
    buyPack: (slot) => act({ action: 'buyPack', slot: slot.id, price: slot.price }, (r): Opened => ({ pack: r['pack'], contents: Array.isArray(r['contents']) ? r['contents'].filter((c): c is string => typeof c === 'string') : [], balance: num(r['balance']) })),
    playCard: (card, character, target, config, message, reach, fromPost) => act({ action: 'playCard', card, character, target, config, message, ...beyond(reach, fromPost) }, toAct),
    setCard: (card, character, target, config, when) => act({ action: 'setCard', card, character, target, config, ...(when ? { when } : {}) }, toAct),
    takeBack: (character, set) => act({ action: 'takeBack', character, set }, toAct),
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
        ? toSeason(r)
        : null;
    },
    /* A page of the ranking from the server, which reads one range of the standings' index for it and never ranks the
       season (standings_page, supabase/migrations/0030_screens_reads.sql); at most a row cap's worth, as it answers. */
    async standingsPage(offset, limit) {
      if (limit <= 0) return [];
      const r = await read(() => client.rpc('standings_page', { page_offset: Math.max(0, Math.floor(offset)), page_limit: rowLimit(limit) }));
      const rows = Array.isArray(r.data) ? (r.data as Row[]) : [];
      return rows.map(toStanding);
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
      return toStandingPlace((await read(() => client.rpc('standing_place', { of_character: id }))).data);
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
      return merged(rows, 'at', 'act').map(toClassReveal);
    },
    async turnsAnnounced(chars) {
      if (chars.length === 0) return [];
      const rows = await byChunks(chars, (part) => list(() => client.from('turns_announced').select('act,character,at,was').in('character', part).order('at', { ascending: true })));
      return merged(rows, 'at', 'act').map(toTurn);
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
      return rows.map(toMyReaction);
    },
    async myCards() {
      return (await list(() => client.from('my_cards').select('card,held'))).map(toHeldCard);
    },
    async machine() {
      return (await list(() => client.from('machine_now').select('slot,position,card,pack,rarity,availability,price,move').order('position', { ascending: true }))).flatMap(toSlot);
    },
    async adminMachine() {
      const v = (await read(() => client.rpc('admin_machine'))).data;
      return (Array.isArray(v) ? (v as Row[]) : []).flatMap(toAdminSlot);
    },
    async setSlot(slot, availability, price) {
      const a = await rpcWrite(() => client.rpc('set_slot', { slot, availability, price }));
      return a.ok ? { ok: true, value: { slot: a.value['slot'], ended: num(a.value['ended']) } } : a;
    },
    async moveSlot(slot, direction) {
      const a = await rpcWrite(() => client.rpc('move_slot', { slot, direction }));
      return a.ok ? { ok: true, value: { slot: a.value['slot'], moved: a.value['moved'] === true } } : a;
    },
    async saveMachine(changes) {
      let r: { readonly data: unknown; readonly error: { readonly message?: string; readonly details?: string; readonly hint?: string } | null; readonly status?: number };
      try {
        r = (await client.rpc('save_machine', { changes })) as typeof r;
      } catch {
        return uncertain();
      }
      if (!r.error) return { ok: true, value: { ended: num((r.data as Row | null)?.['ended']) } };
      if (r.error.hint === REFUSAL_HINT && r.error.message) {
        /* The refusal's detail is `slot=<id> field=<availability|price>`: the page marks that field. */
        const m = /^slot=([0-9a-f-]{36}) field=(availability|price)$/u.exec(r.error.details ?? '');
        return refusal(r.error.message, m ? `${m[1]}/${m[2]}` : undefined);
      }
      return (r.status ?? 0) === 0 || (r.status ?? 0) >= 500 ? uncertain() : refusal(NOT_DONE);
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
      return toPresence(a.value);
    },
    /* The screens' documents: one rpc each, whose rows are the views' own (snake_case) and are mapped with the converters above, so each
       field is what the method named in its type answers for the same data. A load writes nothing (the design's section 4). */
    async boot(): Promise<Boot> {
      const d = (await read(() => client.rpc('boot'))).data as Row | null;
      if (!isObject(d)) throw new Error(NOT_READ);
      const settings = mergeSettings(isObject(d['settings']) ? d['settings'] : {});
      const w: Row = isObject(d['wallet']) ? d['wallet'] : {};
      return {
        settings,
        account: str(d['account']),
        preferences: isObject(d['preferences']) ? toPreferences(d['preferences']) : DEFAULT_PREFERENCES,
        characters: rowsOf(d['characters']).map(toMyCharacter),
        faces: rowsOf(d['faces']).map((f) => toCharacter(f, isObject(f['profile']) ? f['profile'] : undefined)),
        wallet: { balance: num(w['balance']), cap: typeof w['cap'] === 'number' ? w['cap'] : settings.walletCap },
        cards: rowsOf(d['cards']).map(toHeldCard),
        boards: rowsOf(d['boards']).map(toBoardSummary),
        admin: d['admin'] === true,
        unread: toUnread(d['unread']),
        nextSettlementAt: str(d['nextSettlementAt']),
        lastSettledAt: str(d['lastSettledAt']),
        newestSettlement: str(d['newestSettlement']),
      };
    },
    async indexPage(): Promise<IndexPage> {
      const d = (await read(() => client.rpc('index_page'))).data as Row | null;
      if (!isObject(d)) throw new Error(NOT_READ);
      return { boards: rowsOf(d['boards']).map(toBoardSummary), characters: rowsOf(d['characters']).map(faceOf), presence: toPresence(d['presence'] ?? {}), unread: toUnread(d['unread']) };
    },
    async searchPosts(q, after): Promise<SearchPage<PostHit>> {
      return toSearchPage((await refusableRead(() => client.rpc('search_posts', searchArgs(q, after)))).data, toPostHit);
    },
    async searchThreads(q, after): Promise<SearchPage<ThreadHit>> {
      return toSearchPage((await refusableRead(() => client.rpc('search_threads', searchArgs(q, after)))).data, toThreadHit);
    },
    async suggest(prefix, options): Promise<Suggestions> {
      const d = (await refusableRead(() => client.rpc('search_suggest', {
        prefix, kinds: options?.kinds ? [...options.kinds] : null, board: options?.board ?? null, exclude_system: options?.excludeSystem ?? false, most: options?.most ?? null,
      }))).data as Row | null;
      if (!isObject(d)) throw new Error(NOT_READ);
      return {
        threads: rowsOf(d['threads']).map((t) => ({ id: t['id'], title: str(t['title']) ?? '', board: t['board'], boardName: str(t['board_name']) ?? '' })),
        characters: rowsOf(d['characters']).map((c) => ({ id: c['id'], name: str(c['name']) ?? '' })),
        boards: rowsOf(d['boards']).map((b) => ({ id: b['id'], slug: str(b['slug']) ?? '', name: str(b['name']) ?? '' })),
      };
    },
    async boardPage(slug, page, effectCards): Promise<BoardPage | null> {
      const d = (await read(() => client.rpc('board_page', { in_slug: slug, in_page: page, effect_cards: [...effectCards] }))).data as Row | null;
      if (!isObject(d)) return null;
      const pins = rowsOf(d['pins']).map(toPinned);
      const banner = rowsOf(d['banner']).map(toPlayAbove);
      const threads = rowsOf(d['threads']).map(toThread);
      const marked = [...pins.map((p) => p.act.id), ...banner.map((p) => p.act.id)];
      const reading: Record<Id, number> = {};
      for (const r of rowsOf(d['reading'])) reading[r['thread']] = num(r['furthest_seq']);
      return {
        board: toBoard(d['board'] as Row), total: num(d['total']), page: num(d['page'], 1), threads, pins, banner,
        states: toStates(rowsOf(d['states'])), releases: rowsOf(d['releases']).map((r): Id => r['play']),
        tallies: toTallies(marked, rowsOf(d['tallies'])), mine: rowsOf(d['mine']).map(toMyReaction), reading,
        views: toViews([...pins.map((p) => p.thread.id), ...threads.map((t) => t.id)], rowsOf(d['views'])),
        characters: rowsOf(d['characters']).map(faceOf), presence: toPresence(d['presence'] ?? {}), unread: toUnread(d['unread']),
      };
    },
    async threadPage(thread, at, perPage, effectCards): Promise<ThreadPage | null> {
      /* An address that is no id names no thread: it is not found, as `thread(id)` answers, rather than a read the server refuses. */
      if (!idOk(thread)) return null;
      const d = (await read(() => client.rpc('thread_page', { in_thread: thread, in_page: at.page ?? null, in_seq: at.seq ?? null, per_page: perPage, effect_cards: [...effectCards] }))).data as Row | null;
      if (!isObject(d)) return null;
      const acts = rowsOf(d['acts']).map(toAct);
      const plays = rowsOf(d['plays']).map(toAct);
      const above = rowsOf(d['above']).map(toPlayAbove);
      const summary = toThread(d['summary'] as Row);
      /* The ids the page's tallies were asked for: its Acts, then the plays on its posts and above them. */
      const asked = [...acts.map((a) => a.id), ...plays.map((a) => a.id), ...above.map((x) => x.act.id)];
      const reading: Record<Id, number> = typeof d['reading'] === 'number' ? { [thread]: d['reading'] } : {};
      return {
        thread: summary, page: num(d['page'], 1), acts,
        people: rowsOf(d['people']).map((p): ThreadPerson => ({
          character: toCharacter(p['character'], isObject(p['profile']) ? p['profile'] : undefined), posts: num(p['posts']), standing: num(p['standing']),
          reveals: rowsOf(p['reveals']).map(toClassReveal), turns: rowsOf(p['turns']).map(toTurn),
        })),
        visits: rowsOf(d['visits']).map(toVisit),
        plays, above, faces: Object.fromEntries(rowsOf(d['faces']).map((f) => [f['play'], f['card']])), states: toStates(rowsOf(d['states'])),
        releases: (Array.isArray(d['releases']) ? d['releases'] : []).filter((x): x is Id => typeof x === 'string'),
        tallies: toTallies(asked, rowsOf(d['tallies'])), mine: rowsOf(d['mine']).map(toMyReaction), spun: rowsOf(d['spun']).map(toThread), reading,
        board: isObject(d['board']) ? toBoard(d['board']) : null, following: d['following'] === true,
        presence: toPresence(d['presence'] ?? {}), unread: toUnread(d['unread']),
      };
    },
    async visitStory(thread, visit, _post): Promise<VisitStory> {
      const none: VisitStory = { report: null, verdict: null, attempts: [], end: null, infraction: null, appeal: null, ruling: null, warnPoints: null };
      if (!idOk(thread) || !idOk(visit)) return none;
      /* Each read is narrowed on the server to this visit (the Act's own payload names it) or to its one Act, so no bound on the thread's reports or attempts can leave the visit's out. */
      const mine = () => client.from('acts_public').select('*').eq('thread', thread);
      const [attempts, ended, infractions, verdicts] = await Promise.all([
        list(() => mine().eq('kind', 'intercept').eq('payload->>visit_act', visit).order('created_at', { ascending: true }).limit(200)),
        list(() => mine().eq('kind', 'visit_end').eq('target_act_id', visit).limit(1)),
        list(() => mine().eq('kind', 'infraction').eq('payload->>visit_act', visit).order('created_at', { ascending: true }).limit(1)),
        list(() => mine().eq('kind', 'report_verdict').eq('payload->>visit_act', visit).order('created_at', { ascending: true }).limit(1)),
      ]);
      const verdict = verdicts[0];
      const inf = infractions[0];
      const p = isObject(inf?.['payload']) ? (inf!['payload'] as Row) : null;
      const who = p && typeof p['character'] === 'string' ? p['character'] : null;
      const [reports, appeals, bar] = await Promise.all([
        verdict && idOk(String(verdict['target_act_id'])) ? list(() => mine().eq('kind', 'report').eq('id', verdict['target_act_id']).limit(1)) : Promise.resolve([] as Row[]),
        inf ? list(() => mine().eq('kind', 'appeal').eq('target_act_id', inf['id']).order('created_at', { ascending: true }).limit(1)) : Promise.resolve([] as Row[]),
        who && idOk(who) ? list(() => client.from('characters_public').select('warn_points').eq('id', who).limit(1)) : Promise.resolve([] as Row[]),
      ]);
      const appeal = appeals[0];
      const rulings = appeal ? await list(() => mine().eq('kind', 'appeal_ruling').eq('target_act_id', appeal['id']).limit(1)) : [];
      return {
        report: reports[0] ? toAct(reports[0]) : null, verdict: verdict ? toAct(verdict) : null, attempts: attempts.map(toAct),
        end: ended[0] && isObject(ended[0]['payload']) ? toVisitEnd(ended[0]['payload'], ended[0]['created_at'], ended[0]['id']) : null,
        infraction: inf && p && who
          ? { act: inf['id'], character: who, points: num(p['points']), band: BANDS.find((b) => b === p['band']) ?? 'minor', ruleNumber: typeof p['rule_number'] === 'number' ? p['rule_number'] : null, expiresAt: str(p['expires_at']) ?? '', at: str(inf['created_at']) ?? '' }
          : null,
        appeal: appeal ? toAct(appeal) : null, ruling: rulings[0] ? toAct(rulings[0]) : null,
        warnPoints: inf && typeof bar[0]?.['warn_points'] === 'number' ? bar[0]['warn_points'] : null,
      };
    },
    async intercept(through, visit, answer): Promise<Answer<InterceptResult>> {
      if (!idOk(through) || !idOk(visit)) return refusal('that visit could not be found');
      const a = await rpcWrite(() => client.rpc('intercept', { through, visit_act: visit, answer }));
      return a.ok ? { ok: true, value: { act: a.value['intercept'], succeeded: a.value['succeeded'] === true, tailUntil: str(a.value['tail_until']) } } : a;
    },
    async fileReport(through, post, reason): Promise<Answer<ReportResult>> {
      if (!idOk(through) || !idOk(post)) return refusal('that post could not be found');
      /* The staff function's player door (supabase/functions/staff/report.ts): the player's own session pays and opens it; a judgment that failed refunds it and says so. */
      const a = await edge('staff', { through, post, reason }, LOST);
      if (!a.ok) return a;
      const verdict = VERDICTS.find((v) => v === a.value['verdict']) ?? null;
      return { ok: true, value: { report: String(a.value['report'] ?? ''), verdict, line: str(a.value['line']) ?? '', visit: str(a.value['visit']) } };
    },
    async fileAppeal(through, punishment, plea): Promise<Answer<AppealResult>> {
      if (!idOk(through) || !idOk(punishment)) return refusal('that punishment could not be found');
      const a = await edge('staff/appeal', { through, punishment, plea }, LOST);
      if (!a.ok) return a;
      const verdict = RULINGS.find((v) => v === a.value['verdict']) ?? null;
      return { ok: true, value: { appeal: String(a.value['appeal'] ?? ''), verdict, line: str(a.value['line']) ?? '', pointsDelta: num(a.value['points_delta']), refunded: num(a.value['refunded']) } };
    },
    async reportsLeft(character): Promise<number | null> {
      if (!idOk(character)) return null;
      try {
        /* my_reports_left (0111): the caller's own characters' quotas, by open_report's own rule; a character that is not theirs has no row. */
        const r = (await list(() => client.from('my_reports_left').select('left').eq('character', character).limit(1)))[0];
        return typeof r?.['left'] === 'number' ? r['left'] : null;
      } catch {
        return null;
      }
    },
    async beatMod(board): Promise<{ readonly mod: string; readonly pronouns: PronounSet; readonly board: string } | null> {
      if (!idOk(board)) return null;
      try {
        const d = (await read(() => client.rpc('beat_mod_name', { in_board: board }))).data;
        return isObject(d) && typeof d['mod'] === 'string' && typeof d['board'] === 'string' ? { mod: d['mod'], pronouns: pronounsOrDefault(d['pronouns']), board: d['board'] } : null;
      } catch {
        return null;
      }
    },
    async myBan(character): Promise<MyBan | null> {
      if (!idOk(character)) return null;
      const r = (await list(() => client.from('my_bans').select('ban,character,until,days,rule').eq('character', character).gt('until', new Date().toISOString()).order('until', { ascending: false }).limit(1)))[0];
      return r ? { ban: r['ban'], character: r['character'], until: r['until'], days: num(r['days']), rule: str(r['rule']) } : null;
    },
    async profilePage(character): Promise<ProfilePage | null> {
      if (!idOk(character)) return null;
      const d = (await read(() => client.rpc('profile_page', { in_character: character }))).data as Row | null;
      if (!isObject(d)) return null;
      return {
        character: toCharacter(d['character'] as Row, isObject(d['profile']) ? d['profile'] : undefined), counts: toCounts(d['counts']),
        standing: toStandingPlace(d['standing']), settledAt: str(d['settled_at']), season: isObject(d['season']) ? toSeason(d['season']) : null,
        reveals: rowsOf(d['reveals']).map(toClassReveal), turns: rowsOf(d['turns']).map(toTurn), acts: rowsOf(d['acts']).map(toAct),
        targets: rowsOf(d['targets']).map(toAct), seasons: rowsOf(d['seasons']).flatMap(toSeasonRecord), unread: toUnread(d['unread']),
      };
    },
    async recordPage(character, kind, page): Promise<RecordPage | null> {
      if (!idOk(character)) return null;
      const d = (await read(() => client.rpc('record_page', { in_character: character, in_kind: kind, in_page: page }))).data as Row | null;
      if (!isObject(d)) return null;
      const reveals = rowsOf(d['reveals']).map(toClassReveal);
      const turns = rowsOf(d['turns']).map(toTurn);
      const seasons = rowsOf(d['seasons']).flatMap(toSeasonRecord);
      const shown = num(d['page'], 1);
      const kindShown = (['all', 'post', 'spin', 'card', 'class', 'seasons'] as const).find((k) => k === d['kind']) ?? 'all';
      /* The window's first row: for `all`, the extras merged in ahead of it push the read down by their number (the function's own rule). */
      const from = kindShown === 'all' ? Math.max(0, (shown - 1) * RECORD_PAGE - (reveals.length + turns.length + seasons.length)) : (shown - 1) * RECORD_PAGE;
      return {
        kind: kindShown, page: shown, character: toCharacter(d['character'] as Row, isObject(d['profile']) ? d['profile'] : undefined), counts: toCounts(d['counts']),
        reveals, turns, seasons, acts: rowsOf(d['acts']).map(toAct), windowFrom: from, targets: rowsOf(d['targets']).map(toAct), unread: toUnread(d['unread']),
      };
    },
    async myCharactersPage(): Promise<MyCharactersPage> {
      const d = (await read(() => client.rpc('my_characters_page'))).data as Row | null;
      if (!isObject(d)) throw new Error(NOT_READ);
      const mine = rowsOf(d['characters']);
      const debuted = mine.filter((c) => isObject(c['face']));
      return {
        characters: mine.map(toMyCharacter), faces: debuted.map((c) => faceOf(c['face'])),
        counts: Object.fromEntries(mine.map((c) => [c['id'], toCounts(c['counts'])])),
        standings: Object.fromEntries(debuted.map((c) => [c['id'], num(c['standing'])])),
        reveals: merged(mine.flatMap((c) => rowsOf(c['reveals'])), 'at', 'act').map(toClassReveal),
        turns: merged(mine.flatMap((c) => rowsOf(c['turns'])), 'at', 'act').map(toTurn),
        nextSettlementAt: str(d['nextSettlementAt']),
      };
    },
    async seasonPage(tab, season, character, page): Promise<SeasonPage | null> {
      const d = (await read(() => client.rpc('season_page', { in_tab: tab, in_season: season, in_character: character !== null && idOk(character) ? character : null, in_page: page }))).data as Row | null;
      if (!isObject(d)) return null;
      const now = isObject(d['season']) ? toSeason(d['season']) : null;
      if ('news' in d) return { tab: 'news', season: now, news: rowsOf(d['news']).map(toSeasonNews) };
      const finished = rowsOf(d['finished']).flatMap(toFinished);
      if ('results' in d) return { tab: 'results', season: now, finished, page: num(d['page'], 1), place: typeof d['place'] === 'number' ? d['place'] : null, results: rowsOf(d['results']).flatMap(toResult) };
      return {
        tab: 'standings', season: now, finished, page: num(d['page'], 1), standings: rowsOf(d['standings']).map(toStanding), size: num(d['size']),
        reveals: rowsOf(d['reveals']).map(toClassReveal), turns: rowsOf(d['turns']).map(toTurn),
      };
    },
    async alertsPage(before): Promise<AlertsPage> {
      const d = (await read(() => client.rpc('alerts_page', { in_before: before }))).data as Row | null;
      if (!isObject(d)) throw new Error(NOT_READ);
      const reading: Record<Id, number> = {};
      for (const r of rowsOf(d['reading'])) reading[r['thread']] = num(r['furthest_seq']);
      return {
        alerts: rowsOf(d['alerts']).flatMap(toAlert), seenAt: str(d['seenAt']), openedAt: str(d['openedAt']), acts: rowsOf(d['acts']).map(toAct),
        people: rowsOf(d['people']).map(faceOf), openings: rowsOf(d['openings']).map(toAct), reading,
      };
    },
    async updatesPage(update, before, handoverSeason): Promise<UpdatesPage> {
      const d = (await read(() => client.rpc('updates_page', { in_update: update !== null && idOk(update) ? update : null, in_before: before, in_handover_season: handoverSeason }))).data as Row | null;
      if (!isObject(d)) throw new Error(NOT_READ);
      const updates = rowsOf(d['updates']).map(toUpdate);
      /* The open Update is the one asked for when it is on the page, else the newest of the page (as Updates.tsx shows it): the tallies were read for it alone. */
      const open = update !== null && updates.some((u) => u.act === update) ? update : updates[0]?.act;
      return {
        updates, tallies: toTallies(open === undefined ? [] : [open], rowsOf(d['tallies'])), mine: rowsOf(d['mine']).map(toMyReaction),
        ...(isObject(d['queue']) ? { queue: toAdminQueue(d['queue']) } : {}),
      };
    },
    async queuePage(): Promise<QueuePage | null> {
      const d = (await read(() => client.rpc('queue_page'))).data as Row | null;
      if (!isObject(d)) return null;
      return {
        queue: toAdminQueue(d['queue']),
        boardNames: rowsOf(d['boardNames']).map((b): BoardName => ({ id: b['id'], slug: b['slug'], name: b['name'], was: b['was'] ?? b['name'] })),
        bosses: toBosses(d['bosses']), contact: toContact(d['contact']),
      };
    },
    async presenceBox(place): Promise<Presence> {
      const at = place.kind === 'thread' ? place.thread : place.kind === 'board' ? place.board : null;
      const d = (await read(() => client.rpc('presence_box', { in_kind: place.kind, in_place: at }))).data as Row | null;
      return toPresence(isObject(d) ? d : {});
    },
    async setPresenceHidden(character, hidden) {
      const a = await rpcWrite(() => client.rpc('set_presence_hidden', { in_character: character, hidden }));
      return a.ok ? { ok: true, value: a.value['hidden'] === true } : a;
    },
    async preferences(): Promise<Preferences> {
      const r = (await list(() => client.from('account_preferences').select('theme,mode,postbit,motion,smoke,contrast,text_size,tilt,effects,cards_met,alerts_seen_at,settlement_seen,toasts,welcomed_at,tips,tips_seen').limit(1)))[0];
      return r ? toPreferences(r) : DEFAULT_PREFERENCES;
    },
    async setPreferences(p) {
      const a = await rpcWrite(() => client.rpc('set_preferences', {
        theme: p.theme ?? null, mode: p.mode ?? null, postbit: p.postbit ?? null, motion: p.motion ?? null,
        smoke: p.smoke ?? null, contrast: p.contrast ?? null, text_size: p.textSize ?? null, tilt: p.tilt ?? null, effects: p.effects ?? null,
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
      return rowsOf(r.data).flatMap(toAlert);
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
      return toUnread(r.data);
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
      return readLogPage(readLogViews, before ?? null);
    },
    /* The log page in one read (`log_page`, 0123): the first range of the views comes from the document, and a page that would not move reads its one instant by the views as `log` does. */
    async logPage(before): Promise<LogPage> {
      const d = (await read(() => client.rpc('log_page', { in_before: before ?? null }))).data as Row | null;
      if (!isObject(d)) throw new Error(NOT_READ);
      const sources: Row = isObject(d['sources']) ? d['sources'] : {};
      const first = toLogRead({
        ledger: rowsOf(sources['ledger']), wallet: rowsOf(sources['wallet']), cards: rowsOf(sources['cards']), packs: rowsOf(sources['packs']), playsOnMine: rowsOf(sources['playsOnMine']), writes: rowsOf(sources['writes']), saves: rowsOf(sources['saves']),
        setEnds: rowsOf(sources['setEnds']), caught: rowsOf(sources['caught']), ended: rowsOf(sources['ended']),
        infractions: rowsOf(sources['infractions']), bans: rowsOf(sources['bans']), groupMoves: rowsOf(sources['groupMoves']), reports: rowsOf(sources['reports']), appeals: rowsOf(sources['appeals']),
      }, rowsOf(d['shares']), await readBacks(rowsOf(sources['cards'])));
      const log = await readLogPage((range) => ('at' in range ? readLogViews(range) : first), before ?? null);
      return {
        log, acts: rowsOf(d['acts']).map(toAct), states: toStates(rowsOf(d['states'])), people: rowsOf(d['people']).map(faceOf),
        threads: rowsOf(d['threads']).map(toThread), boards: rowsOf(d['boards']).map(toBoard), standings: Object.fromEntries(rowsOf(d['standings']).map((r) => [r['character'], num(r['standing'])])),
        turns: rowsOf(d['turns']).map(toTurn), season: isObject(d['season']) ? toSeason(d['season']) : null,
      };
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

    startThread: (board, character, title, body, framing) => act({ action: 'startThread', board, character, title, body, ...framed(framing) }, (r) => ({ thread: toNewThread(r['thread'], toAct(r['act'])), act: toAct(r['act']) })),
    post: (thread, character, body, quote, framing) => act({ action: 'post', thread, character, body, ...(quote ? { quote } : {}), ...framed(framing) }, toAct),
    edit: (post, character, body) => act({ action: 'edit', post, character, body }, toAct),
    spin: (origin, character, title, body, framing) => act({ action: 'spin', origin, character, title, body, ...framed(framing) }, withThread),
    async apologize(move, character, title, body, framing) {
      if (!idOk(move) || !idOk(character)) return refusal('that move could not be found');
      const a = await rpcWrite(() => client.rpc('apologize', { in_move: move, through: character, title, body, ...framed(framing) }));
      return a.ok ? { ok: true, value: withThread(a.value) } : a;
    },
    react: (target, character, kind) => act({ action: 'react', act: target, character, kind }, (r) => ({ act: r['act'], tally: (r['tally'] ?? {}) as Tally })),
    turn: (character, to, loudness, showFrom, showTo) =>
      act({ action: 'turn', character, class: to, loudness, showFrom, showTo }, (r): TurnAsked => ({ class: r['class'], loudness: r['loudness'], showFrom: r['show_from'] === true, showTo: r['show_to'] === true, takesEffectAt: r['takes_effect_at'] ?? null })),
    withdrawTurn: (character) => act({ action: 'withdrawTurn', character }, () => ({ withdrawn: true as const })),
    unmask: (character, thread, message) => act({ action: 'unmask', character, thread, message }, toAct),
    createCharacter: (name, cls, timing, loudness, pronouns) =>
      act({ action: 'createCharacter', name, class: cls, timing, loudness, ...(pronouns === undefined ? {} : { pronouns }) }, (r): CreatedCharacter => ({ id: r['id'], name: r['name'], class: r['class'], waiting: r['waiting'] === true, loudness: r['loudness'] })),
    setDebut: (character, timing, loudness) => act({ action: 'setDebut', character, timing, loudness }, (r) => ({ id: r['id'], waiting: r['waiting'] === true, loudness: r['loudness'] })),
    async setProfile(character, title, signature, pipStyle, pronouns) {
      /* A null set keeps the stored one (set_profile, 0124). */
      const a = await rpcWrite(() => client.rpc('set_profile', { through: character, title, signature, pip_style: pipStyle, pronouns: pronouns ?? null }));
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

    async wardrobe() {
      /* rpcWrite is the one rpc call that answers with the server's refusal words (a read() would throw them away); my_wardrobe writes nothing, so a lost answer costs only a look again. */
      const a = await rpcWrite(() => client.rpc('my_wardrobe'));
      return a.ok ? { ok: true, value: rowsOf(a.value).map((w): WardrobeItem => ({ gear: w['gear'], rarity: w['rarity'], held: num(w['held']), wornBy: Array.isArray(w['worn_by']) ? (w['worn_by'] as Id[]) : [] })) } : a;
    },
    async setOutfit(character, pieces) {
      const a = await edge('wardrobe', { action: 'setOutfit', character, pieces }, LOST);
      return a.ok ? { ok: true, value: { worn: num(a.value['worn']) } } : a;
    },
    async trophies(character, cursor) {
      /* A read of public facts about a character: the page is the same for everyone, and 50 awards to a page. */
      const d = (await read(() => client.rpc('trophies_of', { of_character: character, before: cursor?.before ?? null, before_id: cursor?.beforeId ?? null, most: TROPHIES_PAGE }))).data as Row | null;
      return { awards: rowsOf(d?.['awards']).map(toTrophyItem), more: d?.['more'] === true };
    },
    async beltLineage(trophy, cursor) {
      /* rpcWrite for its refusal words, as wardrobe does: "not a belt" is the server's answer to show. */
      const a = await rpcWrite(() => client.rpc('belt_lineage', { trophy_key: trophy, before: cursor?.before ?? null, before_id: cursor?.beforeId ?? null, most: REIGNS_PAGE }));
      return a.ok ? { ok: true, value: { reigns: rowsOf(a.value['reigns']).map((r): BeltReign => ({ award: r['award'], character: r['character'], name: r['name'], began: r['began'], ended: str(r['ended']), by: r['by'] })), more: a.value['more'] === true } } : a;
    },
    async showTrophies(character, awards) {
      const a = await edge('wardrobe', { action: 'showTrophies', character, awards }, LOST);
      return a.ok ? { ok: true, value: { shown: num(a.value['shown']) } } : a;
    },
    async randomEvent(character) {
      const a = await edge('wardrobe', { action: 'randomEvent', character }, LOST);
      if (!a.ok) return a;
      const e = isObject(a.value['event']) ? (a.value['event'] as Row) : null;
      if (e === null) return { ok: true, value: null };
      /* An outcome or rarity the client does not know, or an item that is not text, is no event it can show: a bad answer, never an event made up from it. */
      const outcome = e['outcome'];
      const rarity = str(e['rarity']);
      if ((outcome !== 'line' && outcome !== 'gear' && outcome !== 'card') || (rarity !== null && !(RARITIES as readonly string[]).includes(rarity)) || (e['item'] != null && typeof e['item'] !== 'string')) return refusal(NOT_READ);
      const lineKey = str(e['lineKey']);
      return { ok: true, value: { event: e['event'], outcome, item: str(e['item']), rarity: rarity as RandomEvent['rarity'], line: str(e['line']), ...(lineKey !== null ? { lineKey } : {}), character: e['character'] } };
    },
    async grantGear(character, gear, copies) {
      const a = await rpcWrite(() => client.rpc('grant_gear', { of_character: character, gear_key: gear, copies }));
      return a.ok ? { ok: true, value: { granted: num(a.value['granted']) } } : a;
    },
    async awardTrophy(trophy, character, line) {
      const a = await rpcWrite(() => client.rpc('award_trophy', { trophy_key: trophy, of_character: character, said: line ?? null }));
      return a.ok ? { ok: true, value: { award: a.value['award'] } } : a;
    },
    async reverseAward(award) {
      const a = await rpcWrite(() => client.rpc('reverse_award', { of_award: award }));
      return a.ok ? { ok: true, value: { reversed: a.value['reversed'] } } : a;
    },
    async makeTrophy(name, line, art, belt) {
      /* The picture is stored first, by the trophy-art function (an admin's alone), and make_trophy is given the key it answers; a kind that fails after leaves a file nobody names. */
      let key: string | null = null;
      if (art !== null) {
        const form = new FormData();
        form.append('file', art, 'art.webp');
        const stored = await edge('trophy-art', form, LOST);
        if (!stored.ok) return stored;
        key = str(stored.value['key']);
        /* A 200 with no key is no stored picture: a kind made without it would be pictureless, which is not what was asked. */
        if (key === null) return refusal(NOT_DONE);
      }
      const a = await rpcWrite(() => client.rpc('make_trophy', { trophy_name: name, said: line, art_key: key, is_belt: belt }));
      return a.ok ? { ok: true, value: { trophy: a.value['trophy'] } } : a;
    },
    async trophyAwardFailures() {
      const a = await rpcWrite(() => client.rpc('trophy_award_failures'));
      return a.ok ? { ok: true, value: rowsOf(a.value).map((f): TrophyAwardFailure => ({
        id: f['id'], move: str(f['move']), season: typeof f['season'] === 'number' ? f['season'] : null, at: f['at'], error: f['error'], trophy: str(f['trophy']),
        characters: Array.isArray(f['characters']) ? rowsOf(f['characters']).map((c) => ({ id: c['id'], name: c['name'], ...(typeof c['place'] === 'number' ? { place: c['place'] } : {}) })) : null,
      })) } : a;
    },

    subscribeThread(thread, l) {
      return join(`thread:${thread}`, ['act', 'tally', 'effect', 'card_text'], (event, p) => {
        if (event === 'act') l.onAct?.(toAct(p));
        else if (event === 'tally') l.onTally?.(p['act'], (p['tally'] ?? {}) as Tally);
        else if (event === 'effect') l.onEffect?.(p['play'], p['saved_at']);
        else if (event === 'card_text') l.onText?.(p['play'], p['version']);
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
