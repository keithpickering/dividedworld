/**
 * The jobs admin page, a glass page at /admin/jobs (the job health plan, Task 6; its design, sections 3 and 7), reached from the strip over the admin pages'
 * buttons while a job is stopped, from the Admin tab's marker, and from the strip's own Jobs button. One plain table of the ten scheduled jobs, the stopped
 * ones first and then the rest by name:
 *
 *   Job       its name and, under it, what it does in plain words.
 *   Schedule  in words ("every minute", "hourly at :41", "daily at 08:17") for the shapes the instance uses, the expression itself for any other.
 *   State     "Running · 2:31 PM" with its last good run, or "Stopped since 2:02 PM (missed 3 runs)": the count is a floor, "99 or more" at it.
 *
 * A stopped job adds a row under it: the diagnosis (pg_cron's last run of it by status and time, a request sent or not for a function job, whether the two
 * Vault entries a function job reads exist by name and never value, whether the job is in cron.job and active) and one sentence of where to look next.
 * The page only reads: nothing reruns or reschedules a job, and it says the fix is made in Supabase.
 *
 * Glass, plain and out of character ("The fiction may lie; the log never does"). An admin's alone: a player who opens it is told so and the jobs are not
 * asked for. A read that fails is said, never read as a job that stopped.
 */
import { useEffect, useState } from 'react';
import { JOBS, jobHealth, type JobHealth, type JobSpec } from '../../rules/jobs.ts';
import { CalmRegion } from '../glass/Calm.tsx';
import { PageHead } from '../glass/PageHead.tsx';
import { useKayfa } from '../context.tsx';
import type { AdminJob, AdminJobs } from '../data/api.ts';
import { shortTime } from '../postbit/dates.ts';
import { AdminPages } from './AdminPages.tsx';
import './jobs.css';

/** A schedule in words for the shapes the instance uses, else the expression as it stands. */
export function scheduleWords(schedule: string | null): string {
  if (schedule === null) return 'not scheduled';
  const f = schedule.trim().split(/\s+/u);
  if (f.length === 5 && f.slice(2).every((x) => x === '*')) {
    const [minute, hour] = f as [string, string, ...string[]];
    if (minute === '*' && hour === '*') return 'every minute';
    const step = /^\*\/(\d+)$/u.exec(minute);
    if (step !== null && hour === '*') return `every ${step[1]} minutes`;
    if (/^\d{1,2}$/u.test(minute) && hour === '*') return `hourly at :${minute.padStart(2, '0')}`;
    if (/^\d{1,2}$/u.test(minute) && /^\d{1,2}$/u.test(hour)) return `daily at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }
  return schedule;
}

const short = (name: string): string => name.replace(/^kayfabb-/u, '');

/** How many runs a stopped job missed, in words; the count is a floor at 99. */
function missedWords(n: number): string {
  return n >= 99 ? 'missed 99 or more runs' : `missed ${n} ${n === 1 ? 'run' : 'runs'}`;
}

/** The state column's words. */
function stateWords(h: JobHealth, at: (iso: string) => string): string {
  if (!h.stopped) return h.since === null ? 'Running · no good run yet' : `Running · ${at(h.since)}`;
  if (h.since === null) return 'Stopped: has not run yet';
  return `Stopped since ${at(h.since)}${h.missedRuns > 0 ? ` (${missedWords(h.missedRuns)})` : ''}`;
}

/** The diagnosis line of a stopped job, and the one sentence of where to look next. */
function diagnose(spec: JobSpec, h: JobHealth, job: AdminJob | undefined, vault: AdminJobs['vault'], at: (iso: string) => string): { readonly line: string; readonly next: string } {
  const parts: string[] = [];
  const run = job?.lastRun ?? null;
  const functionJob = spec.fn !== null;
  const sent = run !== null && run.status === 'succeeded' && run.message === '1 row';
  const nothingSent = functionJob && run !== null && run.status === 'succeeded' && !sent;
  if (run === null) parts.push('pg_cron has no run of it on record');
  else if (run.status === 'failed') parts.push(`pg_cron ${at(run.at)}: failed${run.message ? `: ${run.message}` : ''}`);
  /* Only a finished run says whether a request went out: a run still going (running, starting, sending) has said nothing yet. */
  else if (functionJob && run.status === 'succeeded') parts.push(`pg_cron ${at(run.at)}: succeeded, ${sent ? 'a request was sent' : 'no request was sent'}`);
  else if (functionJob) parts.push(`pg_cron ${at(run.at)}: ${run.status}`);
  else parts.push(`pg_cron ${at(run.at)}: ${run.status}${run.message ? `, ${run.message}` : ''}`);
  if (functionJob) parts.push(`Vault: kayfabb_functions_url ${vault.functionsUrl ? 'present' : 'missing'}, kayfabb_jobs_key ${vault.jobsKey ? 'present' : 'missing'}`);
  const inCron = job !== undefined && job.schedule !== null;
  if (!inCron) parts.push('not scheduled');
  else if (h.unreadable) parts.push(`scheduled, ${job.active ? 'active' : 'inactive'}; its schedule is not one the engine reads: ${job.schedule}`);
  else parts.push(`scheduled, ${job.active ? 'active' : 'inactive'}`);

  let next: string;
  if (!inCron) next = 'The job is not in cron.job: run the migrations (README, the release steps).';
  else if (!job.active) next = 'The job is in cron.job but switched off: switch it on in Supabase.';
  else if (functionJob && (!vault.functionsUrl || !vault.jobsKey)) next = 'Add the missing Vault entry (README, Give the jobs their address and key).';
  else if (nothingSent) next = "The job's command sent nothing: check both Vault entries have values.";
  else if (run !== null && run.status === 'failed') next = 'pg_cron could not run it: the message above is why.';
  else if (h.unreadable) next = 'Change its schedule in Supabase to one with five fields, such as * * * * *.';
  else if (run === null) next = 'pg_cron has not run it: check pg_cron is running in Supabase.';
  else if (run.status !== 'succeeded') next = "pg_cron's last run of it has not finished: check pg_cron in Supabase.";
  else if (functionJob) next = `The request is sent and the function never answers well. Look at ${short(spec.name)}'s log in Supabase.`;
  else next = 'The command runs and fails or never finishes: the message above is why.';
  return { line: parts.join(' · '), next };
}

export function JobsScreen() {
  const { api } = useKayfa();
  const [admin, setAdmin] = useState<boolean | null>(null);
  /* undefined while the read is out; null is the server's answer for a caller who is not an admin. */
  const [read, setRead] = useState<AdminJobs | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  /* A minute's tick while the page is open, so a job that goes late in the meantime reads Stopped without a reload. The read itself is not repeated. */
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let live = true;
    void api.isAdmin().then((a) => { if (live) setAdmin(a); }, () => { if (live) setAdmin(false); });
    return () => { live = false; };
  }, [api]);
  useEffect(() => {
    if (!admin) return undefined;
    let live = true;
    api.adminJobs().then(
      (r) => { if (live) { setRead(r); setFailed(false); } },
      () => { if (live) setFailed(true); },
    );
    return () => { live = false; };
  }, [admin, api]);

  if (admin === null) return <div className="kb-jobs" aria-busy="true" />;
  if (!admin || read === null) {
    return (
      <div className="kb-jobs">
        <PageHead title="Jobs" />
        <CalmRegion as="p" className="kb-jobs-lead">The jobs page is for admins.</CalmRegion>
      </div>
    );
  }
  if (failed) {
    return (
      <div className="kb-jobs">
        <PageHead title="Jobs" />
        <AdminPages current="jobs" />
        <CalmRegion as="p" className="kb-jobs-note" role="alert">The jobs could not be read. Reload the page to try again.</CalmRegion>
      </div>
    );
  }
  if (read === undefined) return <div className="kb-jobs" aria-busy="true" />;

  const at = new Date(api.now());
  const health = jobHealth(read.jobs, {}, at);
  const stoppedCount = health.filter((h) => h.stopped).length;
  const shown = (iso: string): string => shortTime(iso, api.now());
  const rows = JOBS.map((spec, i) => ({ spec, h: health[i]!, job: read.jobs.find((j) => j.job === spec.name) }))
    .sort((a, b) => Number(b.h.stopped) - Number(a.h.stopped) || a.spec.name.localeCompare(b.spec.name));
  const lead = stoppedCount === 0
    ? `All ${JOBS.length} jobs are running.`
    : `${stoppedCount} ${stoppedCount === 1 ? 'job has' : 'jobs have'} stopped.`;

  return (
    <div className="kb-jobs">
      <PageHead title="Jobs" />
      <CalmRegion as="p" className="kb-jobs-lead">{lead}</CalmRegion>
      <CalmRegion as="p" className="kb-jobs-note">This page only reads: a stopped job is fixed in Supabase.</CalmRegion>
      <AdminPages current="jobs" />
      <CalmRegion as="section" aria-label="The jobs" className="kb-jobs-calm">
        <table className="kb-jobs-table">
          <thead>
            <tr><th scope="col">Job</th><th scope="col">Schedule</th><th scope="col">State</th></tr>
          </thead>
          {rows.map(({ spec, h, job }) => {
            const why = h.stopped ? diagnose(spec, h, job, read.vault, shown) : null;
            return (
              <tbody key={spec.name} data-kb-stopped={h.stopped ? '' : undefined}>
                <tr>
                  <th scope="row">{short(spec.name)}<span className="kb-jobs-about">{spec.about}</span></th>
                  <td><span className="kb-jobs-col">Schedule </span>{scheduleWords(job?.schedule ?? null)}</td>
                  <td className="kb-jobs-state"><span className="kb-jobs-col">State </span>{stateWords(h, shown)}</td>
                </tr>
                {why !== null && (
                  <tr className="kb-jobs-why">
                    <td colSpan={3}>
                      <p><span className="kb-visually-hidden">Why {short(spec.name)} stopped: </span>{why.line}</p>
                      <p className="kb-jobs-next">{why.next}</p>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </CalmRegion>
    </div>
  );
}
