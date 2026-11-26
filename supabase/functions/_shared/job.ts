/**
 * A scheduled function's heartbeat (docs/plans/2026-11-20-job-health-design.md, section 1). `asJob` wraps a job's `handle`: when the
 * run answers 200 it records the run with SQL's `record_job_run(job)`, so the Jobs page can tell a job that runs from one that
 * stopped. Any other answer (a refusal, a bad request, a failed run) is returned untouched and records nothing: a run that did
 * not finish is not a heartbeat. A heartbeat that cannot be written turns the 200 into a 500, so a run whose record is lost is
 * seen by the schedule's own response log and never reads as healthy; the work it did stays done. Only a call carrying the jobs
 * key (the schedule's) is recorded; a 200 to a player at staff's report or appeal door is no heartbeat.
 */
import type { JobName } from '../../../engine/rules/jobs.ts';
import { environment, fromTheService, json } from './serve.ts';
import type { JobDeps } from './handler.ts';

/** `rest` is what a handler takes past the two every one takes (settle's test seam for the instance), handed on unchanged. */
export function asJob<R extends unknown[] = []>(job: JobName, handle: (request: Request, deps: JobDeps, ...rest: R) => Promise<Response>): (request: Request, deps: JobDeps, ...rest: R) => Promise<Response> {
  return async (request, deps, ...rest) => {
    const response = await handle(request, deps, ...rest);
    if (response.status !== 200) return response;
    // Only the schedule's own call is a heartbeat: staff also answers players at its report and appeal doors, and a player's
    // report that lands proves nothing about pg_cron, the Vault or the jobs key, so it must never make a stopped job read running.
    const env = environment(deps.env);
    if (!fromTheService(request, env.jobs)) return response;
    try {
      await deps.db(env).rpc('record_job_run', { job });
    } catch (e) {
      // The details go to the function's log (no key is ever in an error); the answer says only that the record is missing.
      console.error('job health not recorded', job, e instanceof Error ? e.message : 'unknown');
      return json(500, { error: 'the run finished but its heartbeat was not recorded' });
    }
    return response;
  };
}
