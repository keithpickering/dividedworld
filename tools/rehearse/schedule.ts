// The scheduler stands in for pg_cron. It reads cron.job (never a list of jobs written here: a job a later migration
// adds runs with no edit), and at each simulated minute sets both clocks, checks the database agrees, runs the command of
// every active job whose schedule matches, as the superuser pg_cron runs them as, and then drains the dispatcher.
import { matches } from "./cron.ts";
import { drain, Stalled, within, type DispatchCtx } from "./dispatch.ts";

export interface SqlConnection {
  sql(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}
export interface JobRun {
  at: number;
  job: string;
  ok: boolean;
  error?: string;
}
export interface ScheduleCtx extends DispatchCtx {
  cluster: { setClock(ms: number): void };
  clock: { setSimulated(ms: number): void };
  /** Every job run, for the report. */
  jobs: JobRun[];
}

const fmt = (ms: number) => new Date(ms).toISOString();

/** Refuses unless the database's now() is within [at, at + 5 s]. How a server that did not load libfaketime is caught. */
export async function assertClock(conn: SqlConnection, at: number): Promise<void> {
  const [row] = await conn.sql("select (extract(epoch from now()) * 1000)::float8 as ms");
  const got = Number(row?.ms);
  if (!(got >= at && got <= at + 5000)) {
    throw new Error(
      `the database clock does not follow the rehearsal clock: now() is ${fmt(got)}, expected between ${fmt(at)} and ${fmt(at + 5000)}; libfaketime may not be loaded`,
    );
  }
}

export async function runMinute(ctx: ScheduleCtx, minute: number): Promise<void> {
  // One second in keeps date_trunc('minute', now()) on the minute: the clock file is read a hair before it is set.
  const now = minute + 1000;
  ctx.cluster.setClock(now);
  ctx.clock.setSimulated(now);
  // Checked against the minute, not minute + 1 s: now() reads a hair before the file's time (the spike's 11:59:59.99993).
  await assertClock(ctx.connection, minute);
  // Read each minute: a settings change reschedules a job.
  const jobs = await ctx.connection.sql("select jobid, jobname, schedule, command from cron.job where active order by jobid");
  for (const j of jobs) {
    if (!matches(String(j.schedule), new Date(minute))) continue;
    const job = String(j.jobname ?? j.jobid);
    try {
      await within(`the cron job ${job}`, ctx.connection.sql(String(j.command)));
      ctx.jobs.push({ at: minute, job, ok: true });
    } catch (e) {
      // A job that never answers is not a job that failed: the run stops and names it.
      if (e instanceof Stalled) throw e;
      // As pg_cron does: record it, and the next job still runs.
      ctx.jobs.push({ at: minute, job, ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      // pg_cron runs each job in a session of its own; here they share one, so whatever a job left behind (a
      // role, a setting, an open transaction) is cleared before the next. `discard all` cannot run inside a
      // transaction, hence the rollback first; it warns harmlessly when there is none.
      await ctx.connection.sql("rollback");
      await ctx.connection.sql("discard all");
    }
  }
  await drain(ctx);
}
