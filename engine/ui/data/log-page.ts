/**
 * One page of the player's log, cut from what a backend read: `KayfaApi.log`'s paging, shared by the
 * Supabase adapter (web/src/data/supabase.ts) and the in-memory backend (fake.ts), so both cut a page
 * the same way.
 *
 * A backend reads each source of the log newest first, at or before the cursor, at most `LOG_ROWS`
 * rows: the ledger's lines by their settlement's end, the wallet's events, the card ledger and the
 * plays on the player's posts by when each happened, and the effects' saves by when each was saved.
 * The shares are read whole for the settlements read. A source that came back full may hold more at
 * its oldest row's time and before, so the page ends there: it keeps what is newer than the newest of
 * those times (`after`), and the next page reads from that time on, at or before it. A source that
 * came back short has nothing older, and limits nothing.
 *
 * So a page holds whole settlements: a settlement whose lines ran past a full read is left for the
 * next page, whole. A settlement has at most a line per character and reason (the ledger's unique
 * index, 0034), a few dozen for a player, far under `LOG_ROWS`.
 *
 * A source that does hold `LOG_ROWS` rows at one instant would cut the page exactly where it was read from
 * and hand back the same cursor, and Show older lines would read that page forever (#89 F4). Of the two
 * ways the glass cleanup's plan gave, the page reads that instant again, every row there with no limit,
 * and moves the cursor to the microsecond before it (`readLogPage`); it does not fail, since a failure
 * would leave the older lines out of reach, a dead end of its own. Weighed at a busy instance: the views
 * are the caller's own, so the second read holds one player's rows at one instant. A settlement writes
 * at most a line per character and reason (with 6 characters and a class's handful of reasons, some 30)
 * and one wallet event; an action writes a row or two. So it is tens of rows, read only on a page that
 * would not move. It reaches `LOG_ROWS` only where rows were written in bulk at one time (a backfill),
 * and even then it is that player's own rows at that instant, never more than their whole history.
 */
import type { CardEvent, EffectSaved, Log, LogLine, LogSettlement, LogShare, PlayOnMine, WalletEvent } from './api.ts';

/** The most rows a page reads from each source. */
export const LOG_ROWS = 200;

/** A ledger line as `my_ledger` reads it: its settlement's window, and whether the settlement kept its shares. */
export interface LedgerRow {
  readonly settlement: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly sharesKept: boolean;
  readonly character: string;
  readonly reason: string;
  readonly amount: number;
}

/** A share as `my_ledger_shares` reads it, named by its line's settlement, character and reason. */
export interface ShareRow extends LogShare {
  readonly settlement: number;
  readonly character: string;
  readonly reason: string;
}

/** What one page's reads returned, each source newest first and at most `limit` rows; the shares whole for the settlements read. */
export interface LogRead {
  readonly ledger: readonly LedgerRow[];
  readonly shares: readonly ShareRow[];
  readonly wallet: readonly WalletEvent[];
  readonly cards: readonly CardEvent[];
  readonly playsOnMine: readonly PlayOnMine[];
  readonly saves: readonly EffectSaved[];
}

/**
 * A time as microseconds since the epoch: Postgres keeps microseconds, and a cursor cut to
 * milliseconds would skip a row that fell between two of them. Fits a double exactly (2^53 µs is
 * some 285 years).
 */
export function micros(iso: string): number {
  const fraction = /T\d\d:\d\d:\d\d\.(\d+)/.exec(iso)?.[1] ?? '';
  return Math.floor(Date.parse(iso) / 1000) * 1_000_000 + Number(fraction.slice(0, 6).padEnd(6, '0'));
}

/** The page: whatever is newer than the oldest time a full source reached, and that time as the next cursor. */
export function cutLog(read: LogRead, limit: number = LOG_ROWS): Log {
  const reached = (rows: readonly unknown[], oldest: () => string) => (rows.length >= limit ? [oldest()] : []);
  const edges = [
    ...reached(read.ledger, () => read.ledger[read.ledger.length - 1]!.endsAt),
    ...reached(read.wallet, () => read.wallet[read.wallet.length - 1]!.at),
    ...reached(read.cards, () => read.cards[read.cards.length - 1]!.at),
    ...reached(read.playsOnMine, () => read.playsOnMine[read.playsOnMine.length - 1]!.at),
    ...reached(read.saves, () => read.saves[read.saves.length - 1]!.savedAt),
  ];
  /* The newest of the times a full source reached, as that source wrote it, so the next read starts exactly there. */
  const after = edges.length === 0 ? null : edges.reduce((a, b) => (micros(b) > micros(a) ? b : a));
  const cut = after === null ? null : micros(after);
  const keep = (iso: string) => cut === null || micros(iso) > cut;

  const settlements = new Map<number, { readonly row: LedgerRow; readonly lines: Map<string, LogShare[]>; readonly order: LedgerRow[] }>();
  for (const row of read.ledger) {
    if (!keep(row.endsAt)) continue;
    const s = settlements.get(row.settlement) ?? { row, lines: new Map<string, LogShare[]>(), order: [] };
    settlements.set(row.settlement, s);
    s.lines.set(`${row.character}\u0000${row.reason}`, []);
    s.order.push(row);
  }
  for (const share of read.shares) {
    const line = settlements.get(share.settlement)?.lines.get(`${share.character}\u0000${share.reason}`);
    line?.push({ act: share.act, quadrant: share.quadrant, amount: share.amount });
  }
  const byShare = (a: LogShare, b: LogShare) => Math.abs(b.amount) - Math.abs(a.amount) || (a.act < b.act ? -1 : a.act > b.act ? 1 : 0) || String(a.quadrant).localeCompare(String(b.quadrant));
  const out: LogSettlement[] = [...settlements.values()]
    .sort((a, b) => micros(b.row.endsAt) - micros(a.row.endsAt))
    .map(({ row, lines, order }) => ({
      id: row.settlement, startsAt: row.startsAt, endsAt: row.endsAt, sharesKept: row.sharesKept,
      /* By character, then reason, as the adapter's read orders them, so both backends hand the screens one order. */
      lines: [...order].sort((a, b) => (a.character < b.character ? -1 : a.character > b.character ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0)).map((l): LogLine => ({ character: l.character, reason: l.reason, amount: l.amount, shares: [...lines.get(`${l.character}\u0000${l.reason}`)!].sort(byShare) })),
    }));
  return {
    settlements: out,
    wallet: read.wallet.filter((e) => keep(e.at)),
    cards: read.cards.filter((e) => keep(e.at)),
    playsOnMine: read.playsOnMine.filter((e) => keep(e.at)),
    saves: read.saves.filter((e) => keep(e.savedAt)),
    before: after,
  };
}

/** What a page reads from each source: newest first at or before `before`, at most `limit` rows; or every row at exactly `at`. */
export type LogRange = { readonly before: string | null; readonly limit: number } | { readonly at: string };

/** The microsecond just before `iso`, written to the microsecond in UTC: a cursor at or before it reads nothing at `iso`. */
export function justBefore(iso: string): string {
  const m = micros(iso) - 1;
  const seconds = Math.floor(m / 1_000_000);
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}.${String(m - seconds * 1_000_000).padStart(6, '0')}+00:00`;
}

/** Whether a page moves the cursor back from the one it was read with (a first page always does). */
function moves(page: Log, before: string | null): boolean {
  return before === null || page.before === null || micros(page.before) < micros(before);
}

/** The page of every row at one instant, and the microsecond before it as the next cursor. */
function atInstant(read: LogRead, at: string): Log {
  return { ...cutLog(read, Infinity), before: justBefore(at) };
}

/**
 * One page of the log from a backend's reads (both backends page through here). A page cut where it was read from is read
 * again at that one instant, whole, and the next cursor is the microsecond before it, so a cursor only ever moves back and
 * every row is read once (the header says why, and what the second read can cost).
 */
export async function readLogPage(read: (range: LogRange) => LogRead | Promise<LogRead>, before: string | null, limit: number = LOG_ROWS): Promise<Log> {
  const page = cutLog(await read({ before, limit }), limit);
  return moves(page, before) ? page : atInstant(await read({ at: before! }), before!);
}

/** `readLogPage` over reads that answer at once, as the in-memory backend's do (fake.ts). */
export function readLogPageNow(read: (range: LogRange) => LogRead, before: string | null, limit: number = LOG_ROWS): Log {
  const page = cutLog(read({ before, limit }), limit);
  return moves(page, before) ? page : atInstant(read({ at: before! }), before!);
}

