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
