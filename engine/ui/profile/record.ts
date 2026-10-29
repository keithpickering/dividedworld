/**
 * A character's public record as rows: its Acts (posts, spins, card plays), the classes its player
 * made public (reveals) and its announced Turns. Everything here is what anyone could have watched;
 * a Turn names its old class only if it was announced with it ("A response never proves a private fact").
 */
import type { Act, ClassReveal, TurnAnnounced } from '../data/api.ts';
import { shortDate } from '../postbit/dates.ts';
import { pageOf, threadHref } from '../thread/pages.ts';

export type RecordKind = 'all' | 'post' | 'spin' | 'card' | 'class';
export const RECORD_KINDS: readonly RecordKind[] = ['all', 'post', 'spin', 'card', 'class'];
export const RECORD_LABELS: Readonly<Record<RecordKind, string>> = { all: 'All', post: 'Posts', spin: 'Spins', card: 'Cards', class: 'Class statements' };
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

export function turnRow(t: TurnAnnounced, w: Words): RecordRow {
  const was = t.was ? ` from ${w.className(t.was)}${t.since ? ` (since ${shortDate(t.since)})` : ''}` : '';
  return { key: `${t.act}-turn`, at: t.at, text: `Announced a Turn${was}`, href: null };
}

/** Newest first. */
export const newest = (rows: readonly RecordRow[]): RecordRow[] => [...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
