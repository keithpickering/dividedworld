// The scheduled jobs the engine knows and the one reading of whether each is running (docs/plans/2026-11-20-job-health-design.md).
// A job is a pg_cron job named `kayfabb-*`. A function job posts to an Edge Function and a SQL job runs a SQL function. A job
// is stopped when a time it was due is more than its grace in the past and no good run has been recorded since then; the
// health is pure, computed from the rows SQL's `job_status()` returns, so the cron grammar is read here and never twice.
import { lastDue, nextDue } from './cron.ts';

export interface JobSpec {
  readonly name: string;
  /** The Edge Function's folder name, or null for a job that runs a SQL function. */
  readonly fn: string | null;
  /** The Jobs page's plain words for what the job does. */
  readonly about: string;
  /** The grace, in minutes, a job gets when neither the row nor the setting states one. */
  readonly defaultGraceMinutes: number;
}

const job = <const S extends JobSpec>(spec: S): S => Object.freeze(spec);

/** The ten jobs, in name order. */
export const JOBS = Object.freeze([
  job({ name: 'kayfabb-chatter', fn: 'chatter', about: "Posts the Mod Bots' chatter", defaultGraceMinutes: 30 }),
  job({ name: 'kayfabb-conceal', fn: 'conceal', about: 'Hides quotes of hidden posts', defaultGraceMinutes: 10 }),
  job({ name: 'kayfabb-mail', fn: 'mail', about: 'Sends moderation mail', defaultGraceMinutes: 10 }),
  job({ name: 'kayfabb-meet', fn: 'meet', about: "Holds the Boss's daily meeting", defaultGraceMinutes: 30 }),
  job({ name: 'kayfabb-search-rebuild', fn: null, about: 'Rebuilds the search index', defaultGraceMinutes: 10 }),
  job({ name: 'kayfabb-settle', fn: 'settle', about: 'Settles Aura', defaultGraceMinutes: 30 }),
  job({ name: 'kayfabb-staff', fn: 'staff', about: "Files Mod Bots' visits and judges reports", defaultGraceMinutes: 15 }),
  job({ name: 'kayfabb-system-tick', fn: null, about: "Lands The System's moves", defaultGraceMinutes: 10 }),
  job({ name: 'kayfabb-view-counts', fn: null, about: 'Counts thread views', defaultGraceMinutes: 30 }),
  job({ name: 'kayfabb-write', fn: 'write', about: 'Writes the words of cards that write', defaultGraceMinutes: 10 }),
] as const);

export type JobName = (typeof JOBS)[number]['name'];

/** What SQL's `job_status()` returns for one job. */
export interface JobRow {
  readonly job: string;
  readonly schedule: string | null;
  readonly active: boolean;
  readonly firstSeen: string | null;
  readonly lastOkAt: string | null;
  /** The `jobGraceMinutes` settings row as the database holds it, or null when there is none. */
  readonly grace: Readonly<Record<string, number>> | null;
}

export interface JobHealth {
  readonly job: JobName;
  /** False for a job with no row, no schedule or an inactive one. */
  readonly scheduled: boolean;
  readonly stopped: boolean;
  /** The reference: the last good run, else when the job was first seen, else null. */
  readonly since: string | null;
  /** The first due time after the reference, for a stopped job that is scheduled. */
  readonly missed: string | null;
  /** How many due times fell between the reference and `at` less the grace, at most MISSED_MOST. */
  readonly missedRuns: number;
}

export const MISSED_MOST = 99;
const MINUTE = 60_000;

export function jobHealth(rows: readonly JobRow[], grace: Readonly<Record<string, number>>, at: Date): JobHealth[] {
  return JOBS.map((spec): JobHealth => {
    const row = rows.find((r) => r.job === spec.name);
    const since = row ? (row.lastOkAt ?? row.firstSeen) : null;
    if (!row || row.schedule === null || !row.active) return { job: spec.name, scheduled: false, stopped: true, since, missed: null, missedRuns: 0 };
    if (since === null) return { job: spec.name, scheduled: true, stopped: true, since, missed: null, missedRuns: 0 };
    const minutes = row.grace?.[spec.name] ?? grace[spec.name] ?? spec.defaultGraceMinutes;
    const bound = new Date(at.getTime() - minutes * MINUTE);
    const reference = new Date(since);
    const latest = lastDue(row.schedule, bound);
    if (latest === null || latest.getTime() <= reference.getTime()) return { job: spec.name, scheduled: true, stopped: false, since, missed: null, missedRuns: 0 };
    const first = nextDue(row.schedule, reference);
    let runs = 0;
    for (let d = first; d !== null && d.getTime() <= latest.getTime() && runs < MISSED_MOST; d = nextDue(row.schedule, d)) runs++;
    return { job: spec.name, scheduled: true, stopped: true, since, missed: first === null ? null : first.toISOString(), missedRuns: runs };
  });
}

/** The stopped entries, for the strip and the marker. */
export function stoppedJobs(health: readonly JobHealth[]): JobHealth[] {
  return health.filter((h) => h.stopped);
}
