// Cluster lifecycle: what a stopped, failed or abandoned cluster leaves behind. Needs libfaketime and Postgres.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { startCluster } from "../cluster.ts";

const T = Date.UTC(2027, 2, 1, 9, 0, 0);
const leftovers = () => readdirSync(tmpdir()).filter((n) => n.startsWith("rehearse-pg-"));
const procsFor = (dir: string) => {
  try {
    return execFileSync("pgrep", ["-f", dir], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

test("stop() removes the directory and the server", async () => {
  const c = await startCluster({ at: T });
  assert.ok(existsSync(c.dir));
  await c.stop();
  assert.ok(!existsSync(c.dir));
  assert.equal(procsFor(c.dir), "");
});

test("stop({ keep: true }) leaves the directory", async () => {
  const c = await startCluster({ at: T });
  await c.stop({ keep: true });
  try {
    assert.ok(existsSync(c.dir));
  } finally {
    execFileSync("rm", ["-rf", c.dir]);
  }
});

test("a start that fails leaves no directory and no process, and the error carries the server log", async () => {
  const before = leftovers();
  await assert.rejects(() => startCluster({ at: T, extraServerOptions: "-c no_such_setting=1" }), /no_such_setting/);
  assert.deepEqual(leftovers().sort(), before.sort());
});

test("setClock never leaves an empty clock file", async () => {
  const c = await startCluster({ at: T });
  try {
    for (let i = 0; i < 200; i++) {
      c.setClock(T + i * 1000);
      assert.match(readFileSync(`${c.dir}/clock`, "utf8"), /^@\d{4}-/);
    }
    assert.ok(!existsSync(`${c.dir}/clock.tmp`));
  } finally {
    await c.stop();
  }
});

test("a long TMPDIR is refused with a clear message", async () => {
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = "/tmp/" + "x".repeat(120);
  try {
    await assert.rejects(() => startCluster({ at: T }), /socket path/i);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
});
