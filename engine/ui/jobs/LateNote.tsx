/**
 * The plain glass note a waiting state adds under its own words once the job it waits on has stopped (design, section 4). The glass speaking
 * out of character and truthfully: it names the job's last good run in the viewer's own short time, says nothing is lost, and says admins can
 * see it. It shows nothing while the job runs and nothing while the health is not known, so a read that failed is never a reason to say a job
 * stopped (`useJobLate`). It carries the class of `ConcealingNote`'s strip, so every waiting note looks as one.
 */
import type { JobName } from '../../rules/jobs.ts';
import { useKayfa } from '../context.tsx';
import { shortTime } from '../postbit/dates.ts';
import { useJobLate } from './useJobHealth.ts';

/** What a lead sentence is built from. */
export interface LateWhen {
  /** "has not run since 2:02 PM", or "has not run yet" for a job that has never run. */
  readonly ran: string;
  /** The first run it missed, in the short time ("" where none is known). */
  readonly missed: string;
}

export const LATE_TAIL = 'Nothing is lost, and it catches up as soon as the job runs again. The admins can see this.';

export function LateNote({ job, lead, tail = LATE_TAIL, className }: {
  readonly job: JobName;
  readonly lead: (when: LateWhen) => string;
  /** The sentence after the lead: the standard one unless the screen's words differ. */
  readonly tail?: string;
  readonly className?: string;
}) {
  const { api } = useKayfa();
  const late = useJobLate(job);
  if (late === null) return null;
  const now = api.now();
  const when: LateWhen = {
    ran: late.since === null ? 'has not run yet' : `has not run since ${shortTime(late.since, now)}`,
    missed: late.missed === null ? '' : shortTime(late.missed, now),
  };
  return <p className={`kb-glass kb-hidden-note${className ? ` ${className}` : ''}`} role="note">{lead(when)} {tail}</p>;
}
