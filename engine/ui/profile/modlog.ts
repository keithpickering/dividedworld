/**
 * The plain words of a Mod's visit, a report it judged and an appeal it heard, as its moderation log lists them (the Mod Bots design, section 9; `moves_log`, 0109). Pure: the glass's
 * own voice, true and out of character. What a Mod said is not here; this says what it did and how it ended, from the Acts alone.
 */
import type { MoveLogRow } from '../data/api.ts';

/** Whether a row is a visit, a judged report or a heard appeal, and not a move. */
export const isModAct = (r: Pick<MoveLogRow, 'kind'>): boolean => r.kind === 'visit' || r.kind === 'report' || r.kind === 'appeal';

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** The post's number a row is about, or null where the row could not say. */
export const postOf = (r: Pick<MoveLogRow, 'params'>): number | null => num(r.params['post']);

/** What the row says was done, up to the post ("Visited"), and what follows it ("(Rule 2: No double posting, minor), after a report"): the screen links the post between them. */
export function didWords(r: Pick<MoveLogRow, 'kind' | 'params'>): { readonly before: string; readonly after: string } {
  const p = r.params;
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
  if (r.kind === 'visit') {
    switch (o) {
      case null: return 'open';
      case 'filed': return 'filed';
      case 'intercepted': return 'talked down';
      case 'trapped': return 'ended by a trap';
      case 'reversed': return 'ended by an admin';
      default: return 'ended';
    }
  }
  if (r.kind === 'report') return o === 'visit' ? 'sent a visit' : o === 'dismissed' ? 'dismissed' : o === 'backfire' ? 'backfired onto the reporter' : 'judged';
  const delta = num(r.params['points_delta']);
  switch (o) {
    case 'overturned': return 'overturned';
    case 'upheld': return 'upheld';
    case 'reduced': return delta ? `reduced by ${Math.abs(delta)}` : 'reduced';
    case 'increased': return delta ? `increased by ${Math.abs(delta)}` : 'increased';
    default: return 'ruled on';
  }
}
