/**
 * A character's public record as rows: its Acts (posts, spins, card plays), the classes its player
 * made public (reveals) and its announced Turns. Everything here is what anyone could have watched;
 * a Turn names its old class only if it was announced with it ("A response never proves a private fact").
 */
import type { Act, ClassReveal, Id, KayfaApi, TurnAnnounced } from '../data/api.ts';
import { shortDate } from '../postbit/dates.ts';
import { pageOf, threadHref } from '../thread/pages.ts';

export type RecordKind = 'all' | 'post' | 'spin' | 'card' | 'class' | 'seasons';
export const RECORD_KINDS: readonly RecordKind[] = ['all', 'post', 'spin', 'card', 'class', 'seasons'];
export const RECORD_LABELS: Readonly<Record<RecordKind, string>> = { all: 'All', post: 'Posts', spin: 'Spins', card: 'Cards', class: 'Class statements', seasons: 'Seasons' };
export const RECORD_PAGE = 20;
/** How many rows the profile shows before it links to the full record. */
export const PROFILE_ROWS = 5;
/** How many season reveal posts the Seasons view reads (the newest). */
export const SEASONS_SHOWN = 50;

export const recordKind = (v: string | null): RecordKind => (RECORD_KINDS as readonly string[]).includes(v ?? '') ? (v as RecordKind) : 'all';

export interface RecordRow {
  readonly key: string;
  readonly at: string;
  readonly text: string;
  readonly href: string | null;
}

export interface Words {
  readonly className: (key: string) => string;
  readonly cardName: (key: string) => string;
  readonly perPage: number;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** A post's words with the BBCode tags taken out, cut short. */
export function excerpt(body: string, max = 100): string {
  const plain = body.replace(/\[\/?[a-z*][^\]]*\]/giu, '').replace(/\s+/gu, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max).trimEnd()}…` : plain;
}

/**
 * Where each card play landed, from one batched read of the posts they target: a play has no seq
 * of its own (it shows as a tag on its post), so its row links to that post's permalink, the place
 * the thread's tag does. A page reads its targets once, never one read per row; a play whose target
 * cannot be read has no entry and its row falls back to the thread.
 */
export async function playLinks(api: KayfaApi, acts: readonly Act[], perPage: number): Promise<ReadonlyMap<Id, string>> {
  const out = new Map<Id, string>();
  const targets = [...new Set(acts.flatMap((a) => (a.kind === 'card' && a.targetActId !== null ? [a.targetActId] : [])))];
  if (targets.length === 0) return out;
  const by = new Map((await api.actsById(targets)).map((t) => [t.id, t]));
  for (const a of acts) {
    const t = a.kind === 'card' && a.targetActId !== null ? by.get(a.targetActId) : undefined;
    if (t && t.seq !== null) out.set(a.id, threadHref(t.thread, pageOf(t.seq, perPage), t.seq));
  }
  return out;
}

export function actRow(a: Act, w: Words, plays: ReadonlyMap<Id, string> = new Map()): RecordRow {
  const where = a.seq === null ? `/t/${a.thread}` : threadHref(a.thread, pageOf(a.seq, w.perPage), a.seq);
  switch (a.kind) {
    case 'spin': return { key: a.id, at: a.createdAt, text: `Spun a thread: ${str(a.currentPayload.title) || str(a.payload.title)}`, href: `/t/${a.thread}` };
    case 'card': {
      const message = str(a.payload.message);
      return { key: a.id, at: a.createdAt, text: `Played ${w.cardName(str(a.payload.card))}${message ? `: “${message}”` : ''}`, href: plays.get(a.id) ?? where };
    }
    default: return { key: a.id, at: a.createdAt, text: `Posted: ${excerpt(str(a.currentPayload.body))}`, href: where };
  }
}

export const revealRow = (r: ClassReveal, w: Words): RecordRow => ({ key: r.act, at: r.at, text: `Revealed: ${w.className(r.class)}`, href: `/t/${r.thread}` });

/** Where each announced Turn's tally is, from one batched read of those Acts (a Turn whose tally cannot be read has no link). */
export async function turnLinks(api: KayfaApi, turns: readonly TurnAnnounced[], perPage: number): Promise<ReadonlyMap<Id, string>> {
  const out = new Map<Id, string>();
  if (turns.length === 0) return out;
  for (const a of await api.actsById([...new Set(turns.map((t) => t.act))])) {
    if (a.seq !== null) out.set(a.id, threadHref(a.thread, pageOf(a.seq, perPage), a.seq));
  }
  return out;
}

/** A past season's reveal post for this character. */
export function seasonRow(a: Act, w: Words): RecordRow {
  const n = typeof a.payload.season === 'number' ? a.payload.season : null;
  const place = typeof a.payload.place === 'number' ? a.payload.place : null;
  const text = `Season ${n ?? ''}${n === null ? '' : ' '}reveal${place === null ? '' : `: finished #${place}`}`;
  return { key: a.id, at: a.createdAt, text, href: a.seq === null ? `/t/${a.thread}` : threadHref(a.thread, pageOf(a.seq, w.perPage), a.seq) };
}

export function turnRow(t: TurnAnnounced, w: Words, links: ReadonlyMap<Id, string> = new Map()): RecordRow {
  const was = t.was ? ` from ${w.className(t.was)}${t.since ? ` (since ${shortDate(t.since)})` : ''}` : '';
  return { key: `${t.act}-turn`, at: t.at, text: `Announced a Turn${was}`, href: links.get(t.act) ?? null };
}

/** Newest first. */
export const newest = (rows: readonly RecordRow[]): RecordRow[] => [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

const time = (r: RecordRow) => Date.parse(r.at);

/**
 * One window of the character's Acts merged with its extras (reveals, announced Turns, past
 * seasons: a short list, read whole, newest first). The Acts are read from `from`, which the
 * caller chooses as `max(0, offset - extras.length)`: the first `from` Acts are certainly among the
 * first `offset` rows, so a window never needs more than `limit + extras.length` Acts read, however
 * deep the page.
 */
export function mergeWindow(extras: readonly RecordRow[], acts: readonly RecordRow[], from: number, offset: number, limit: number): RecordRow[] {
  /* Extras newer than the first Act read are among the rows before the window, so they only move its start. */
  const edge = from > 0 && acts.length > 0 ? time(acts[0]!) : Infinity;
  const dropped = extras.filter((e) => time(e) > edge).length;
  const kept = extras.filter((e) => time(e) <= edge);
  const merged: RecordRow[] = [];
  let i = 0;
  let j = 0;
  while (i < acts.length || j < kept.length) {
    if (j >= kept.length || (i < acts.length && time(acts[i]!) >= time(kept[j]!))) merged.push(acts[i++]!);
    else merged.push(kept[j++]!);
  }
  const start = offset - from - dropped;
  return merged.slice(Math.max(0, start), Math.max(0, start) + limit);
}
