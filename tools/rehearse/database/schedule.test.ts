// The scheduler against a real fake-clock Postgres: a job registered with cron.schedule runs on its own minutes.
// Needs libfaketime and Postgres; run by `npm run test:rehearse`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startCluster } from "../cluster.ts";
import { connect } from "../db.ts";
import { simulateClock } from "../clock.ts";
import { runMinute, type ScheduleCtx } from "../schedule.ts";

const T = Date.UTC(2027, 2, 1, 9, 0, 0);
const MIN = 60_000;

test("a */5 job over 30 minutes writes six rows, each on its own minute; a failing job does not stop the next", async () => {
  const cluster = await startCluster({ at: T });
  const sim = simulateClock();
  const conn = await connect(cluster.dir, cluster.port, "postgres");
  try {
    await conn.sql(readFileSync(new URL("../../../supabase/tests/setup/auth-shim.sql", import.meta.url), "utf8"));
    await conn.sql("create table beat (at timestamptz not null)");
    await conn.sql("select cron.schedule('beat', '*/5 * * * *', 'insert into beat values (now())')");
    await conn.sql("select cron.schedule('broken', '* * * * *', 'select 1/0')");
    await conn.sql("select cron.schedule('after', '*/10 * * * *', 'insert into beat values (now())')");
    const ctx: ScheduleCtx = {
      connection: conn,
      deps: {} as ScheduleCtx["deps"],
      cap: { reached: () => false },
      lastDrained: 0,
      dispatched: [],
      cluster,
      clock: sim,
      jobs: [],
    };
    const started = performance.now();
    for (let i = 0; i < 30; i++) await runMinute(ctx, T + i * MIN);
    console.log(`30 minutes in ${Math.round(performance.now() - started)} ms`);
    const rows = await conn.sql("select (extract(epoch from date_trunc('minute', at)) * 1000)::float8 as ms from beat order by at");
    const beats = rows.map((r) => Number(r.ms));
    // */5 gives minutes 0,5,...,25 (six); */10 adds 0,10,20 (three more, on the same minutes).
    const fives = [...new Set(beats)];
    assert.equal(fives.length, 6, `distinct minutes: ${fives.map((m) => new Date(m).toISOString())}`);
    assert.equal(beats.length, 9);
    assert.deepEqual(fives.map((m) => Math.floor((m - T) / MIN)), [0, 5, 10, 15, 20, 25]);
    assert.equal(ctx.jobs.filter((j) => j.job === "broken" && !j.ok && /division by zero/.test(j.error ?? "")).length, 30);
    assert.equal(ctx.jobs.filter((j) => j.job === "after" && j.ok).length, 3, "the job after the broken one still ran");
  } finally {
    sim.restore();
    await conn.end();
    await cluster.stop();
  }
});

test("a job rescheduled mid-run takes its new schedule from the next minute; an inactive job stops", async () => {
  const cluster = await startCluster({ at: T });
  const sim = simulateClock();
  const conn = await connect(cluster.dir, cluster.port, "postgres");
  try {
    await conn.sql(readFileSync(new URL("../../../supabase/tests/setup/auth-shim.sql", import.meta.url), "utf8"));
    await conn.sql("create table ran (job text, at timestamptz)");
    await conn.sql("select cron.schedule('a', '* * * * *', $$insert into ran values ('a', now())$$)");
    await conn.sql("select cron.schedule('b', '* * * * *', $$insert into ran values ('b', now())$$)");
    const ctx: ScheduleCtx = { connection: conn, deps: {} as ScheduleCtx["deps"], cap: { reached: () => false }, lastDrained: 0, dispatched: [], cluster, clock: sim, jobs: [] };
    for (let i = 0; i < 20; i++) {
      if (i === 10) {
        // The shim's cron.schedule upserts by name, as a settings trigger's reschedule does.
        await conn.sql("select cron.schedule('a', '*/5 * * * *', $$insert into ran values ('a', now())$$)");
        await conn.sql("update cron.job set active = false where jobname = 'b'");
      }
      await runMinute(ctx, T + i * MIN);
    }
    const minutes = async (job: string) =>
      (await conn.sql("select (extract(epoch from date_trunc('minute', at)) / 60 - $1)::int as m from ran where job = $2 order by at", [T / MIN, job])).map((r) => Number(r.m));
    assert.deepEqual(await minutes("a"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15], "every minute to 9, then */5 from minute 10");
    assert.deepEqual(await minutes("b"), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "inactive from minute 10");
  } finally {
    sim.restore();
    await conn.end();
    await cluster.stop();
  }
});
