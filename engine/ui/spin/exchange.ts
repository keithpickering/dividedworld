/**
 * The plain line of a spun exchange (the spin-mod-answers design, section 3): what the staff member's
 * verdict or ruling did, in plain words, read from the Act's own public payload ("The fiction may lie;
 * the log never does"). It leaves out Aura, and never says why a visit did not open.
 */
import type { Act } from '../data/api.ts';
import { utcWhen } from '../log/lines.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function answerWords(answer: Act, punishmentKind: 'infraction' | 'ban' | 'move' | null, hearer: string, reporter: string, now: number): string {
  const p = answer.payload;
  const verdict = p.verdict;
  if (answer.kind === 'report_verdict') {
    const visited = typeof p.visit_act === 'string';
    if (verdict === 'visit') return visited ? `${hearer} sent a visit to the post.` : `${hearer} judged it a visit, but no visit opened.`;
    if (verdict === 'dismissed') return `${hearer} dismissed it. No visit opened.`;
    if (verdict === 'backfire') {
      return visited ? `${hearer} judged it a backfire: a visit went to ${reporter}'s latest post.` : `${hearer} judged it a backfire, but no visit opened.`;
    }
    return `${hearer} ruled on it.`;
  }
  if (verdict === 'upheld') return `${hearer} upheld it. Nothing changed.`;
  const delta = typeof p.points_delta === 'number' ? p.points_delta : 0;
  if (punishmentKind === 'ban' || punishmentKind === 'move') {
    const until = typeof p.until === 'string' ? p.until : undefined;
    const when = until === undefined ? '' : ` ${utcWhen(until)} UTC`;
    const ended = until !== undefined && Date.parse(until) <= now;
    if (verdict === 'overturned') return `${hearer} overturned it: it ended${when}.`;
    if (verdict === 'reduced') return `${hearer} reduced it: it ${ended ? 'ended' : 'ends'}${when}.`;
    if (verdict === 'increased') return `${hearer} lengthened it: it ${ended ? 'ended' : 'ends'}${when}.`;
    return `${hearer} ruled on it.`;
  }
  const n = Math.abs(delta);
  if (verdict === 'overturned' || verdict === 'reduced') {
    const word = verdict === 'overturned' ? 'overturned' : 'reduced';
    return delta === 0 ? `${hearer} ${word} it.` : `${hearer} ${word} it: ${plural(n, 'point', 'points')} came off.`;
  }
  if (verdict === 'increased') {
    return delta === 0 ? `${hearer} increased it.` : `${hearer} increased it: ${n} more ${n === 1 ? 'point' : 'points'} landed.`;
  }
  return `${hearer} ruled on it.`;
}
