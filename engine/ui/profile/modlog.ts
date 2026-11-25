/**
 * The plain words of a Mod's visit, a report it judged and an appeal it heard, as its moderation log lists them (the Mod Bots design, section 9; `moves_log`, 0111). Pure: the glass's
 * own voice, true and out of character. What a Mod said is not here; this says what it did and how it ended, from the Acts alone.
 */
import { moveKind } from '../../system/moves.ts';
import { shortDate } from '../postbit/dates.ts';
import type { MoveLogRow } from '../data/api.ts';

/** Whether a row is a visit, a judged report, a heard appeal or a request ruled on, and not a move. */
export const isModAct = (r: Pick<MoveLogRow, 'kind'>): boolean => r.kind === 'visit' || r.kind === 'report' || r.kind === 'appeal' || r.kind === 'request';

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** The post's number a row is about, or null where the row could not say. */
export const postOf = (r: Pick<MoveLogRow, 'params'>): number | null => num(r.params['post']);

/** The catalog's plain label of a move kind, as a clause ("moved a thread"); a kind this build has no words for is said plainly. Never a model's words. */
function moveClause(kind: string | null): string {
  const label = kind === null ? undefined : moveKind(kind)?.label;
  return label ? label.charAt(0).toLowerCase() + label.slice(1) : 'made a move';
}

/**
 * What the row says was done, up to the post ("Visited"), and what follows it ("(Rule 2: No double posting, minor), after a report"): the screen links the post between them.
 * A request has a thread too: `thread` is the thread's title (the screen links it), `between` what separates it from the post's link, and `after` closes the post's parenthesis. A request
 * says what the code did with it (granted it, rejected it, passed it up or took it to the meeting) and the move's plain words; never what was asked or what anyone answered.
 */
export function didWords(r: Pick<MoveLogRow, 'kind' | 'params'>): { readonly before: string; readonly after: string; readonly thread?: string; readonly between?: string } {
  const p = r.params;
  if (r.kind === 'request') {
    const ruling = text(p['ruling']);
    const head = ruling === 'fulfill' ? 'Granted' : ruling === 'reject' ? 'Rejected' : p['by'] === 'boss' ? 'Took' : 'Passed';
    const tail = ruling === 'fulfill' ? `: ${moveClause(text(p['move_kind']))}` : ruling === 'reject' ? '' : p['by'] === 'boss' ? ' to the meeting' : ' to the Boss';
    return { before: `${head} a request in `, thread: text(p['title']) ?? 'a thread', between: ' (', after: `)${tail}` };
  }
  if (r.kind === 'visit') {
    const cause = text(p['cause']);
    const why = cause === 'report' ? ', after a report' : cause === 'backfire' ? ', after a report backfired' : cause === 'patrol' ? ', on patrol' : cause === 'tail' ? ', for Obstruction' : '';
    const rule = text(p['rule']) ?? (num(p['rule_number']) === null ? null : `Rule ${num(p['rule_number'])}`);
    const band = text(p['band']);
    return { before: 'Visited ', after: `${rule || band ? ` (${[rule, band].filter(Boolean).join(', ')})` : ''}${why}` };
  }
  if (r.kind === 'report') return { before: 'Judged a report of ', after: '' };
  const what = p['punishment'] === 'ban' ? 'a ban' : 'warn points';
  return { before: `Heard an appeal of ${what} from `, after: '' };
}

/** How it ended, in a few words. A visit still open says so. */
export function endedModWords(r: Pick<MoveLogRow, 'kind' | 'outcome' | 'params'>): string {
  const o = r.outcome ?? null;
  if (r.kind === 'request') {
    /* Only a request passed on has an end: it waits (and lapses by itself on a day), then is ruled at a meeting, or lapses. */
    if (r.params['ruling'] !== 'confer') return '';
    const lapses = text(r.params['lapses_at']);
    return o === null ? (lapses === null ? 'waiting' : `waiting, lapses ${shortDate(lapses)}`) : o === 'fulfill' ? 'ruled: granted' : o === 'reject' ? 'ruled: refused' : o === 'lapsed' ? 'lapsed' : 'ruled';
  }
  if (r.kind === 'visit') {
    switch (o) {
      case null: return 'open';
      case 'filed': return 'filed';
      case 'intercepted': return 'talked down';
      case 'trapped': return 'ended by a trap';
      case 'reversed': return 'ended by an admin';
      case 'dropped': return 'dropped, never filed';
      default: return 'ended';
    }
  }
  if (r.kind === 'report') {
    /* `visited` is in a row's params from `moves_log`: false where the verdict opened no visit; a row without it reads as it did. */
    const none = r.params['visited'] === false;
    return o === 'visit' ? (none ? 'judged a visit, but none opened' : 'sent a visit') : o === 'dismissed' ? 'dismissed' : o === 'backfire' ? (none ? 'backfired, but no visit opened' : 'backfired onto the reporter') : 'judged';
  }
  const delta = num(r.params['points_delta']);
  switch (o) {
    case 'overturned': return 'overturned';
    case 'upheld': return 'upheld';
    case 'reduced': return delta ? `reduced by ${Math.abs(delta)}` : 'reduced';
    case 'increased': return delta ? `increased by ${Math.abs(delta)}` : 'increased';
    default: return 'ruled on';
  }
}
