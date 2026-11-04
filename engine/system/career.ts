/**
 * A staff persona's career, as plain facts (the staff roster design, section 3). The database computes it (`staff_career`) from the
 * seasons a persona led, how each was handed over, and the office log; this turns it into sentences, for the Boss's meeting prompt and
 * the persona's own calls. It holds facts and no feelings: how a persona feels about its career is its memory's business.
 *
 * Newest first, at most `CAREER_MOST` entries, then "and N more." so a long career costs a bounded prompt.
 */

/** The most entries a career shows or a prompt carries. */
export const CAREER_MOST = 12;

export interface Career {
  /** The seasons it led, oldest first: the season's number, when it began and ended (null while open), and how the Boss was chosen. */
  readonly led: readonly { readonly season: number; readonly from: string; readonly until: string | null; readonly how: string }[];
  /** The offices it held off the Boss's seat, oldest first, each with the instant it ended (null while held) and what caused it. */
  readonly offices: readonly { readonly office: string; readonly from: string; readonly until: string | null; readonly cause: string }[];
}

const OFFICE_WORDS: Readonly<Record<string, string>> = { mod: 'Mod Bot', member: 'Member', benched: 'Benched' };
const HOW_WORDS: Readonly<Record<string, string>> = {
  seed: 'the first Boss',
  nomination: 'named by the Boss before it',
  rotation: 'by rotation',
  unchanged: 'held over, since no one else could be chosen',
  none: 'with no Boss chosen',
};
const CAUSE_WORDS: Readonly<Record<string, string>> = {
  seed: 'from the start',
  handover: 'at a handover',
  move: 'by a Boss\'s move',
  admin: 'by an admin',
};

/** The UTC date of an instant, whatever offset the database wrote it in. */
const day = (iso: string): string => new Date(iso).toISOString().slice(0, 10);
/** How long a season ran: days below fourteen, whole weeks (rounded down) from there. */
const weeks = (from: string, until: string): string => {
  const days = Math.round((Date.parse(until) - Date.parse(from)) / 86_400_000);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  const w = Math.floor(days / 7);
  return `${w} weeks`;
};

/**
 * The career in plain sentences, newest first. `seasonNames` names a season by its number where the instance has a name for it;
 * otherwise it is "Season N". A persona that never served has none.
 */
export function careerText(career: Career, seasonNames: Readonly<Record<number, string>> = {}): string[] {
  const entries = [
    ...career.led.map((l) => ({
      at: Date.parse(l.from),
      text: `Boss in ${seasonNames[l.season] ?? `Season ${l.season}`}, from ${day(l.from)} ${l.until ? `to ${day(l.until)} (${weeks(l.from, l.until)})` : 'until now'}, ${HOW_WORDS[l.how] ?? l.how}.`,
    })),
    ...career.offices.map((o) => ({
      at: Date.parse(o.from),
      text: `${OFFICE_WORDS[o.office] ?? o.office} from ${day(o.from)} ${o.until ? `to ${day(o.until)}` : 'until now'}, ${CAUSE_WORDS[o.cause] ?? o.cause}.`,
    })),
  ].sort((a, b) => b.at - a.at);
  const shown = entries.slice(0, CAREER_MOST).map((e) => e.text);
  return entries.length > CAREER_MOST ? [...shown, `and ${entries.length - CAREER_MOST} more.`] : shown;
}
