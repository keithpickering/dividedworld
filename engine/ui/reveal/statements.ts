/**
 * What a character's player made public about its class, read from a season-reveal post's `shown`
 * list ("A response never proves a private fact": a player may make one of their own private facts
 * public, as of its date, and nothing else about it is). A statement is a reveal ("Heel, as of
 * Oct 3") or a Turn announced with its old class ("Face, until its Turn on Oct 20"); a Turn that
 * named no class is still listed, and names none here.
 */
import { shortDate } from '../postbit/dates.ts';

export interface Statement {
  readonly kind: 'reveal' | 'turn';
  /** The class key stated, or null for a Turn that named none. */
  readonly class: string | null;
  /** When the statement was made; a Turn's `until` is this. */
  readonly at: string;
  /** For a Turn that named its old class: since when the character had been it, when that was said. */
  readonly since: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** The statements in a `shown` list, oldest first by the date they speak of. Entries it cannot read are left out. */
export function statements(shown: unknown): readonly Statement[] {
  if (!Array.isArray(shown)) return [];
  const out: Statement[] = [];
  for (const e of shown) {
    if (typeof e !== 'object' || e === null) continue;
    const row = e as Record<string, unknown>;
    const at = text(row.at);
    if (at === null || Number.isNaN(Date.parse(at))) continue;
    if (row.kind === 'reveal') {
      const cls = text(row.class);
      if (cls !== null) out.push({ kind: 'reveal', class: cls, at, since: null });
    } else if (row.kind === 'turn') {
      out.push({ kind: 'turn', class: text(row.was), at, since: text(row.since) });
    }
  }
  const speaks = (s: Statement) => Date.parse(s.kind === 'turn' && s.since !== null ? s.since : s.at);
  return out.sort((a, b) => speaks(a) - speaks(b) || Date.parse(a.at) - Date.parse(b.at));
}

/** One statement in words: "Heel, revealed Oct 3", "Face, from Oct 1 until its Turn on Oct 20", "a Turn on Oct 20". */
export function wording(s: Statement, className: (key: string) => string): string {
  if (s.kind === 'reveal') return `${className(s.class!)}, revealed ${shortDate(s.at)}`;
  if (s.class === null) return `a Turn on ${shortDate(s.at)}`;
  return `${className(s.class)}, ${s.since ? `from ${shortDate(s.since)} ` : ''}until its Turn on ${shortDate(s.at)}`;
}
