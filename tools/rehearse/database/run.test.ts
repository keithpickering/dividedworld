// The rehearsal's run, end to end in stub mode: a one-day tiny scenario on a real fake-clock cluster. Needs libfaketime and
// Postgres; run by `npm run test:rehearse`.
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { matches } from "../cron.ts";
import { rehearse, readWorld, type RunContext } from "../run.ts";
import type { Scenario } from "../../../engine/rehearsal/types.ts";
import { DAY_MS, MINUTE } from "../../../engine/rehearsal/generate.ts";

const tiny: Scenario = {
  key: "tiny",
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

test("a one-day stub run: a meeting, every job at its minutes, nothing undispatched, the filler's posts, the switch on from day 1", async () => {
  const started = performance.now();
  let seen = false;
  const out = mkdtempSync(join(tmpdir(), "rehearsal-run-"));
  const raw = await rehearse({
    scenario: tiny,
    mode: "stub",
    cassetteDir: join(out, "cassette"),
    runsDir: out,
    onFinish: async (ctx: RunContext) => {
      seen = true;
      const { conn, timeline } = ctx;
      const day1 = timeline.day1;
      const end = day1 + tiny.days * DAY_MS;

      // At least one meeting row for day 1.
      const meetings = await conn.sql("select count(*)::int as n from meetings where started_at >= to_timestamp($1 / 1000.0) and started_at < to_timestamp($2 / 1000.0)", [day1, end]);
      assert.ok(Number(meetings[0]?.n) >= 1, "no meeting row for day 1");

      // Every job in cron.job ran at its minutes, and only at them.
      const jobs = await conn.sql("select jobname, schedule from cron.job order by jobid");
      assert.ok(jobs.length >= 5, `jobs: ${jobs.map((j) => j.jobname)}`);
      for (const j of jobs) {
        const name = String(j.jobname);
        const ran = ctx.jobs.filter((r) => r.job === name);
        assert.ok(ran.length > 0, `${name} never ran`);
        for (const r of ran) assert.ok(matches(String(j.schedule), new Date(r.at)), `${name} ran at ${new Date(r.at).toISOString()}, off its schedule ${j.schedule}`);
        let due = 0;
        for (let m = timeline.clusterStart; m < end; m += MINUTE) if (matches(String(j.schedule), new Date(m))) due++;
        assert.equal(ran.length, due, `${name} ran ${ran.length} times, its schedule is due ${due}`);
      }

      // No request left undispatched.
      const queue = await conn.sql("select coalesce(max(id), 0)::int as top from net.http_request_queue");
      assert.equal(ctx.lastDrained, Number(queue[0]?.top), "a request is left in the queue");

      // The filler's posts are in acts, written by characters with owners.
      const posts = await conn.sql("select count(*)::int as n from acts a join characters c on c.id = a.character where a.kind = 'post' and c.owner is not null");
      assert.ok(Number(posts[0]?.n) >= 1, "no filler post in acts");
      assert.ok(ctx.filler.filter((f) => f.ok).length >= 1, "no filler action went through");

      // The System's switch: off before day 1, on from day 1's first minute.
      assert.equal(ctx.systemOnAt, day1);
      const on = await conn.sql("select value from settings where key = 'systemEnabled'");
      assert.equal(JSON.stringify(on[0]?.value), "true");
      const early = await conn.sql("select count(*)::int as n from acts where kind in ('move', 'move_end') and created_at < to_timestamp($1 / 1000.0)", [day1]);
      assert.equal(Number(early[0]?.n), 0, "a move landed before day 1");

      // The world reader leaves out The System's own posts and staff characters.
      const staff = await conn.sql("select id, staff from characters where staff_kind = 'persona' order by staff limit 1");
      assert.equal(staff.length, 1, "the instance has no staff character");
      const open = await conn.sql("select t.id from threads t join boards b on b.id = t.board where not b.is_system order by t.created_at limit 1");
      await ctx.conn.db("service").rpc("write_staff_act", { staff_key: staff[0]!.staff, kind: "post", thread: open[0]!.id, target: null, payload: { body: "a staff post" } });
      // A System act (no character) in an open thread and one on the System board: no settlement of this short a run posts a tally, so one is written here.
      const systemThread = await conn.sql("select t.id from threads t join boards b on b.id = t.board where b.is_system order by t.created_at limit 1");
      await conn.sql("insert into acts (character, kind, thread, payload) values (null, 'tally', $1, '{}'::jsonb), (null, 'tally', $2, '{}'::jsonb)", [open[0]!.id, systemThread[0]!.id]);
      const systemActs = await conn.sql("select a.id from acts a where a.character is null");
      assert.ok(systemActs.length >= 1, "no System act to leave out");
      const world = await readWorld(conn, ctx.instance, ctx.content.corpus, ctx.players, end);
      const staffIds = new Set((await conn.sql("select id from characters where staff is not null")).map((r) => String(r.id)));
      assert.ok(world.characters.length >= 2);
      assert.ok(world.characters.every((c) => !staffIds.has(c.id)), "a staff character is in the world");
      const staffPosts = new Set((await conn.sql("select a.id from acts a join characters c on c.id = a.character where c.staff is not null")).map((r) => String(r.id)));
      assert.ok(staffPosts.size >= 1);
      const systemSet = new Set(systemActs.map((r) => String(r.id)));
      assert.ok(world.posts.every((p) => !systemSet.has(p.act) && !staffPosts.has(p.act)), "a System or staff post is in the world");
      assert.ok(world.posts.length >= 1);
      const systemBoard = new Set((await conn.sql("select t.id from threads t join boards b on b.id = t.board where b.is_system")).map((r) => String(r.id)));
      assert.ok(systemBoard.size >= 1);
      assert.ok(world.threads.every((t) => !systemBoard.has(t.id) || !t.open), "a System thread is open in the world");
    },
  });
  assert.ok(seen, "onFinish never ran");
  // The report and the log are written, and the log has a meeting on day 1.
  assert.ok(raw.reportDir && existsSync(join(raw.reportDir, "report.html")), "no report.html");
  const log = JSON.parse(readFileSync(join(raw.reportDir!, "log.json"), "utf8"));
  assert.ok(log.days[0].meetings.length >= 1, "the log has no meeting on day 1");
  assert.match(readFileSync(join(raw.reportDir!, "report.html"), "utf8"), /<h2>Day 1,/);
  assert.ok(raw.jobs.length > 0 && raw.dispatched.length > 0);
  console.log(`one-day stub run (1 backstory day + 1 day): ${Math.round(performance.now() - started)} ms`);
});
