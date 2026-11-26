// The job-health parts together, on a real fake-clock cluster (docs/plans/2026-11-20-job-health-plan.md, Task 8; the design's section 6).
// The smallest scenario the rehearsal accepts runs with every real handler except conceal's, which answers 503 without running for 30
// simulated minutes after a post that quotes a hidden post has been written. The test reads `job_status()` every minute and computes
// `jobHealth` at the simulated time: conceal reads running to the grace's edge, then stopped since its last good run, while every other job
// reads running; the quote is withheld (`concealing`) throughout, and once conceal is let through its layer is made and it reads running.
// The poison is the same run with `record_job_run` made to do nothing in the database, which must read every function job stopped.
// Needs libfaketime and Postgres; run by `npm run test:rehearse`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobHealth, JOBS, type JobHealth, type JobRow } from "../../../engine/rules/jobs.ts";
import { DAY_MS, MINUTE } from "../../../engine/rehearsal/generate.ts";
import type { Scenario } from "../../../engine/rehearsal/types.ts";
import { rehearse } from "../run.ts";
import { REAL, type Handler } from "../dispatch.ts";
import type { Connection } from "../db.ts";

const tiny: Scenario = {
  key: "job-health",
  seed: 7,
  players: 2,
  charactersPerPlayer: { least: 1, most: 2 },
  startThreads: 2,
  backstoryDays: 1,
  dayOfSeason: 30,
  days: 1,
  postsPerDay: { least: 2, most: 4 },
  reactionsPerPost: { least: 0, most: 2 },
  costCapDollars: 1,
};

const CONCEAL = "kayfabb-conceal";
const OUT = 30;

async function realHandlers(refuse: (now: number) => boolean): Promise<Record<string, Handler>> {
  const handlers: Record<string, Handler> = {};
  for (const name of REAL) handlers[name] = (await import(`../../../supabase/functions/${name}/handler.ts`)).handle as Handler;
  const conceal = handlers.conceal!;
  // Refused without running: the request is answered 503 as a function that is down is, and no good run is recorded.
  handlers.conceal = async (request, deps) => (refuse(Date.now()) ? new Response(JSON.stringify({ error: "down" }), { status: 503 }) : conceal(request, deps));
  return handlers;
}

async function healthAt(conn: Connection, grace: Readonly<Record<string, number>>, at: number): Promise<JobHealth[]> {
  const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string | Date).toISOString());
  const rows = (await conn.sql("select job, schedule, active, first_seen, last_ok_at, grace from job_status()")).map((r): JobRow => ({
    job: String(r.job), schedule: r.schedule === null ? null : String(r.schedule), active: r.active === true,
    firstSeen: iso(r.first_seen), lastOkAt: iso(r.last_ok_at), grace: (r.grace as Record<string, number> | null) ?? null,
  }));
  return jobHealth(rows, grace, new Date(at));
}

const summary = (h: readonly JobHealth[]): string => h.filter((j) => j.stopped).map((j) => `${j.job} since ${j.since}`).join("; ") || "all running";

test("conceal refused for 30 minutes reads stopped from the 11th, the rest running, the quote concealing, and the next run clears it", async () => {
  let first: number | null = null;
  let M = 0;
  let quote = "";
  let layerAt: number | null = null;
  const seen: string[] = [];
  const handlers = await realHandlers((now) => M > 0 && now > M + 500 && now < M + OUT * MINUTE + 30_000);
  const out = mkdtempSync(join(tmpdir(), "job-health-"));
  await rehearse({
    scenario: tiny, mode: "stub", cassetteDir: join(out, "cassette"), runsDir: out, handlers,
    onMinute: async (conn, minute, instance) => {
      first ??= minute;
      const grace = instance.settings.jobGraceMinutes as Record<string, number>;
      // M is the last minute conceal ran good: noon on day 1, after the day's meeting (11:00): meet's digest fails on a hidden post that drew
      // reactions (its excerpt is null), a finding of its own and not this test's subject, so the hidden post is made once the meeting has been.
      const planted = first + DAY_MS + 12 * 60 * MINUTE;
      if (minute === planted) {
        M = minute;
        const [c] = await conn.sql("select a.character, a.thread, p.admin from (select character, thread from acts where kind = 'post' and character is not null order by created_at limit 1) a cross join (select id as admin from accounts limit 1) p");
        const [post] = await conn.sql("insert into acts (character, kind, thread, payload) values ($1, 'post', $2, '{\"body\": \"the hidden words\"}') returning id", [c!.character, c!.thread]);
        const [q] = await conn.sql("insert into acts (character, kind, thread, payload) values ($1, 'post', $2, $3::jsonb) returning id", [c!.character, c!.thread, JSON.stringify({ body: `[quote=${String(post!.id)}]the hidden words[/quote] reply` })]);
        quote = String(q!.id);
        // Hidden after the quote is written: a quote of an already hidden post is judged a forgery (its words cannot be compared), a hide is what asks for the layer.
        await conn.sql("insert into conduct_decisions (version_act, post, admin, outcome) values ($1, $1, $2, 'hide')", [post!.id, c!.admin]);
        assert.deepEqual((await conn.sql("select concealing from acts_public where id = $1", [quote])).map((r) => r.concealing), [true]);
      }
      if (M === 0) return;
      const t = (minute - M) / MINUTE;
      if (t < 0) return;
      const health = await healthAt(conn, grace, minute + 1000);
      const conceal = health.find((j) => j.job === CONCEAL)!;
      const others = health.filter((j) => j.job !== CONCEAL);
      if (t <= 10) assert.equal(conceal.stopped, false, `M+${t}: conceal reads stopped (${summary(health)})`);
      else if (t <= OUT) {
        assert.equal(conceal.stopped, true, `M+${t}: conceal reads running`);
        const [ok] = await conn.sql("select last_ok_at from job_runs where job = $1", [CONCEAL]);
        assert.equal(new Date(ok!.last_ok_at as string).getTime() - M < MINUTE, true, "conceal's last good run is the minute before the refusals");
        assert.equal(conceal.since, new Date(ok!.last_ok_at as string).toISOString());
      }
      // Every other job reads running throughout. The daily jobs (settle, meet) and the others with longer schedules read running because
      // each ran on its own schedule, or because nothing of theirs was due more than a grace ago: both are correct, neither is skipped.
      assert.equal(others.some((j) => j.stopped), false, `M+${t}: ${summary(others)}`);
      if (t >= 1 && t <= OUT) {
        const [row] = await conn.sql("select concealing from acts_public where id = $1", [quote]);
        assert.equal(row!.concealing, true, `M+${t}: the quote is not concealing`);
      }
      if (t === OUT + 1 && layerAt === null) {
        layerAt = minute;
        assert.equal(conceal.stopped, false, `M+${t}: conceal still reads stopped after the run let through (${summary(health)})`);
        const [row] = await conn.sql("select concealing from acts_public where id = $1", [quote]);
        assert.equal(row!.concealing, false, "the quote is still concealing after conceal ran");
        assert.equal((await conn.sql("select 1 from quote_layers where act = $1", [quote])).length, 1, "no layer for the quote");
      }
      if (t % 5 === 0 && t <= OUT + 1) seen.push(`M+${t}: ${summary(health)}`);
    },
  });
  assert.ok(layerAt !== null, "the run ended before conceal was let through");
  console.log(`job health, conceal refused for ${OUT} minutes:\n  ${seen.join("\n  ")}`);
});

test("poison: with record_job_run doing nothing every function job reads stopped once its grace has passed", async () => {
  const out = mkdtempSync(join(tmpdir(), "job-health-"));
  let done = false;
  let result = "";
  await rehearse({
    scenario: tiny, mode: "stub", cassetteDir: join(out, "cassette"), runsDir: out, handlers: await realHandlers(() => false),
    onMinute: async (conn, minute, instance) => {
      if (done) return;
      const [ran] = await conn.sql("select count(*)::int as n from pg_proc where proname = 'record_job_run' and prosrc like '%no-op%'");
      if (Number(ran!.n) === 0) {
        await conn.sql("create or replace function record_job_run(job text) returns void language plpgsql as $$ begin /* no-op */ end $$");
        return;
      }
      // Two days in, every job has been due and a grace has passed since it was first seen.
      const [start] = await conn.sql("select min(first_seen) as at from job_runs");
      const age = minute - new Date(start!.at as string).getTime();
      if (age < 25 * 60 * MINUTE) return;
      const grace = instance.settings.jobGraceMinutes as Record<string, number>;
      const health = await healthAt(conn, grace, minute + 1000);
      const functionJobs = JOBS.filter((j) => j.fn !== null).map((j) => j.name);
      const stopped = health.filter((h) => h.stopped).map((h) => h.job);
      assert.deepEqual(functionJobs.filter((n) => !stopped.includes(n)), [], `a function job reads running with nothing recorded: ${summary(health)}`);
      result = `${stopped.length} of ${JOBS.length} jobs stopped: ${summary(health)}`;
      done = true;
    },
  });
  assert.ok(done, "the poisoned run never reached the point of reading");
  console.log(`poison: ${result}`);
});
