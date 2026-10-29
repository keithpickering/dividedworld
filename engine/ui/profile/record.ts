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

export function actRow(a: Act, w: Words): RecordRow {
  const where = a.seq === null ? `/t/${a.thread}` : threadHref(a.thread, pageOf(a.seq, w.perPage), a.seq);
  switch (a.kind) {
    case 'spin': return { key: a.id, at: a.createdAt, text: `Spun a thread: ${str(a.currentPayload.title) || str(a.payload.title)}`, href: `/t/${a.thread}` };
    case 'card': {
      const message = str(a.payload.message);
      return { key: a.id, at: a.createdAt, text: `Played ${w.cardName(str(a.payload.card))}${message ? `: “${message}”` : ''}`, href: where };
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
