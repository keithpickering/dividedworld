/**
 * What a character's player made public about its class, read from a season-reveal post's `shown`
 * list ("A response never proves a private fact": a player may make one of their own private facts
 * public, as of its date, and nothing else about it is). A statement is a reveal ("Heel, as of
 * Oct 3") or a Turn announced with its old class ("Face, until its Turn on Oct 20"); a Turn that
 * named no class is still listed, and names none here. A Turn says the class it left as of the
 * Turn, never since when (#23): since when could date a silent Turn before it, so a `since` a
 * reveal written before 0073 still carries is not read.
 */
import type { SeasonShown } from '../data/api.ts';
import { shortDate } from '../postbit/dates.ts';

export interface Statement {
  readonly kind: 'reveal' | 'turn';
  /** The class key stated, or null for a Turn that named none. */
  readonly class: string | null;
  /** When the statement was made; a Turn's `until` is this. */
  readonly at: string;
  /** For a reveal that a later Turn announced it had left: the Turn's date (the two are one statement of one stretch). */
  readonly until?: string;
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
      if (cls !== null) out.push({ kind: 'reveal', class: cls, at });
    } else if (row.kind === 'turn') {
      out.push({ kind: 'turn', class: text(row.was), at });
    }
  }
  /* A reveal made during the stretch a Turn then says it ended is the same statement of the same class: one entry, not two. The
     stretch is what is public of it: from the character's announced Turn before this one, or from the start, to this Turn. */
  const merged: Statement[] = [];
  const used = new Set<Statement>();
  for (const t of out) {
    if (t.kind !== 'turn' || t.class === null) continue;
    const from = Math.max(-Infinity, ...out.filter((x) => x.kind === 'turn' && Date.parse(x.at) < Date.parse(t.at)).map((x) => Date.parse(x.at)));
    const r = out.find((x) => x.kind === 'reveal' && !used.has(x) && x.class === t.class && Date.parse(x.at) >= from && Date.parse(x.at) <= Date.parse(t.at));
    if (r) { used.add(r); used.add(t); merged.push({ ...r, until: t.at }); }
  }
  const rest = [...out.filter((x) => !used.has(x)), ...merged];
  return rest.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** One statement in words: "Heel, revealed Oct 3", "Face, until its Turn on Oct 20", "a Turn on Oct 20". */
export function wording(s: Statement, className: (key: string) => string): string {
  if (s.kind === 'reveal') return `${className(s.class!)}, revealed ${shortDate(s.at)}${s.until ? `, until its Turn on ${shortDate(s.until)}` : ''}`;
  if (s.class === null) return `a Turn on ${shortDate(s.at)}`;
  return `${className(s.class)}, until its Turn on ${shortDate(s.at)}`;
}

/**
 * What a finished season's row says of its character's class: the last class its player revealed that season, when, and the date of the
 * first Turn announced after it (null where none was). The row's `shown` list is the season's own, so a reveal and a Turn are read in the
 * order they were made. Null where no class was revealed.
 */
export function finalClass(shown: readonly SeasonShown[]): { readonly cls: string; readonly at: string; readonly turnedAt: string | null } | null {
  let at = -1;
  shown.forEach((x, i) => { if (x.kind === 'reveal' && x.class !== null) at = i; });
  if (at < 0) return null;
  const turn = shown.slice(at + 1).find((x) => x.kind === 'turn');
  return { cls: shown[at]!.class!, at: shown[at]!.at, turnedAt: turn?.at ?? null };
}
