// The fake-clock cluster (Task 2). Needs libfaketime and Postgres; run by `npm run test:rehearse`.
// Talks to the cluster with psql over its Unix socket until Task 3 adds the `pg` package.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { startCluster, type Cluster } from "../cluster.ts";
import { connect } from "../db.ts";
import { assertClock as realAssertClock } from "../schedule.ts";

function psql(c: Cluster, sql: string): string {
  return execFileSync(
    "psql",
    ["-h", c.dir, "-p", String(c.port), "-U", "postgres", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}
const epoch = (c: Cluster, expr = "now()") => Number(psql(c, `select extract(epoch from ${expr})::bigint * 1000;`));

// The real `assertClock` (Task 4): it reads the database's now() over a connection and refuses when it does not follow.
async function assertClock(c: Cluster, at: number): Promise<void> {
  c.setClock(at + 1000);
  const conn = await connect(c.dir, c.port, "postgres");
  try {
    await realAssertClock(conn, at);
  } finally {
    await conn.end();
  }
}

const T = Date.UTC(2027, 2, 1, 9, 0, 0);
const DAY = 86_400_000;

test("a cluster started at T answers now() within a second after T", async () => {
  const c = await startCluster({ at: T });
  try {
    const got = epoch(c);
    assert.ok(got >= T && got < T + 1000 + 1000, `now() was ${new Date(got).toISOString()}`);
  } finally {
    await c.stop({ keep: false });
  }
});

test("setClock moves a held connection's now() and a column default", async () => {
  const c = await startCluster({ at: T });
  try {
    const t2 = T + 3 * DAY + 1000;
    // One psql session, so one held connection: the clock file is rewritten between two statements.
    const child = spawn("psql", ["-h", c.dir, "-p", String(c.port), "-U", "postgres", "-d", "postgres", "-X", "-At", "-q"]);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const done = new Promise<void>((resolve) => child.on("close", () => resolve()));
    child.stdin.write("create table t(at timestamptz default now());\nselect extract(epoch from now())::bigint*1000;\n");
    await new Promise((r) => setTimeout(r, 500));
    c.setClock(t2);
    child.stdin.write(
      "select extract(epoch from now())::bigint*1000;\ninsert into t default values;\nselect extract(epoch from at)::bigint*1000 from t;\n",
    );
    child.stdin.end();
    await done;
    const got = out.trim().split("\n").map(Number);
    assert.ok(Math.abs(got[0]! - T) < 3000, `first ${got[0]!}`);
    assert.ok(Math.abs(got[1]! - t2) < 3000, `held connection's next now() ${got[1]!}`);
    assert.ok(Math.abs(got[2]! - t2) < 3000, `default now() ${got[2]!}`);
  } finally {
    await c.stop({ keep: false });
  }
});

test("date_trunc('minute', now()) after setClock(m + 1 s) is m, for 50 consecutive minutes", async () => {
  const c = await startCluster({ at: T });
  try {
    for (let i = 0; i < 50; i++) {
      const m = T + i * 60_000;
      c.setClock(m + 1000);
      assert.equal(epoch(c, "date_trunc('minute', now())"), m, `minute ${i}`);
    }
  } finally {
    await c.stop({ keep: false });
  }
});

test("poison: a server started without LD_PRELOAD makes assertClock refuse", async () => {
  const c = await startCluster({ at: T, preload: false });
  try {
    await assert.rejects(() => assertClock(c, T + 5 * DAY), /does not follow/);
  } finally {
    await c.stop({ keep: false });
  }
});

test("the clock follows with preload: assertClock passes", async () => {
  const c = await startCluster({ at: T });
  try {
    await assertClock(c, T + 5 * DAY);
  } finally {
    await c.stop({ keep: false });
  }
});
