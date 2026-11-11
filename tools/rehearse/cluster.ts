// A throwaway Postgres cluster whose now() is a file the rehearsal rewrites (libfaketime, with
// FAKETIME_TIMESTAMP_FILE and FAKETIME_NO_CACHE), listening only on a Unix socket in its own directory.
// The SQL reads now() throughout and every function pins its search_path, so the simulated clock reaches the
// jobs with no change to them. Linux only for now (the design's Open).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Cluster = {
  /** The socket directory and data directory (one directory). Connect with host = dir. */
  dir: string;
  port: number;
  /** Writes the clock file. Call it with a minute plus one second (see the plan). */
  setClock(ms: number): void;
  stop(opts?: { keep?: boolean }): Promise<void>;
};

const INSTALL = "apt-get install -y faketime postgresql";

function findFaketime(): string {
  const known = "/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1";
  if (existsSync(known)) return known;
  try {
    const listed = execFileSync("dpkg", ["-L", "libfaketime"], { encoding: "utf8" })
      .split("\n")
      .find((l) => l.endsWith("/libfaketime.so.1"));
    if (listed && existsSync(listed)) return listed;
  } catch {
    // dpkg missing or the package absent: fall through to the refusal.
  }
  throw new Error(`libfaketime.so.1 not found. Install it: ${INSTALL}`);
}

function findPgBin(): string {
  const root = "/usr/lib/postgresql";
  const versions = existsSync(root)
    ? readdirSync(root)
        .filter((v) => /^\d+$/.test(v) && existsSync(join(root, v, "bin", "initdb")))
        .sort((a, b) => Number(b) - Number(a))
    : [];
  if (versions.length === 0) throw new Error(`No Postgres server binaries in ${root}/*/bin. Install them: ${INSTALL}`);
  return join(root, versions[0], "bin");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function clockLine(ms: number): string {
  return `@${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}\n`;
}

export async function startCluster(opts: { at: number; preload?: boolean }): Promise<Cluster> {
  if (process.platform !== "linux") throw new Error("The rehearsal is Linux only for now (libfaketime).");
  const lib = findFaketime();
  const bin = findPgBin();
  const dir = mkdtempSync(join(tmpdir(), "rehearse-pg-"));
  const root = process.getuid?.() === 0;
  const as = (cmd: string, args: string[]): [string, string[]] =>
    root ? ["runuser", ["-u", "postgres", "--", cmd, ...args]] as [string, string[]] : [cmd, args];
  const data = join(dir, "data");
  const clockFile = join(dir, "clock");
  writeFileSync(clockFile, clockLine(opts.at));
  chmodSync(dir, 0o755);
  chmodSync(clockFile, 0o644);
  if (root) execFileSync("chown", ["postgres:postgres", dir]);
  const port = await freePort();
  const env = { ...process.env, LANG: "C", LC_ALL: "C" } as Record<string, string>;
  const run = (cmd: string, args: string[], extraEnv: Record<string, string> = {}) => {
    const [c, a] = as(cmd, args);
    // runuser keeps the environment unless told otherwise; pass the variables through `env` so they survive either way.
    const envArgs = Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`);
    if (root && envArgs.length) return execFileSync("runuser", ["-u", "postgres", "--", "env", ...envArgs, cmd, ...args], { env, encoding: "utf8", stdio: "pipe" });
    return execFileSync(c, a, { env: { ...env, ...extraEnv }, encoding: "utf8", stdio: "pipe" });
  };
  let started = false;
  const cluster: Cluster = {
    dir,
    port,
    setClock(ms) {
      writeFileSync(clockFile, clockLine(ms));
    },
    async stop({ keep = false } = {}) {
      if (started) {
        try {
          run(join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
        } catch {
          // already down
        }
        started = false;
      }
      if (!keep) rmSync(dir, { recursive: true, force: true });
    },
  };
  try {
    run(join(bin, "initdb"), ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8"]);
    const fake: Record<string, string> =
      opts.preload === false
        ? {}
        : { LD_PRELOAD: lib, FAKETIME_TIMESTAMP_FILE: clockFile, FAKETIME_NO_CACHE: "1" };
    run(
      join(bin, "pg_ctl"),
      ["-D", data, "-w", "-l", join(dir, "server.log"), "-o", `-k ${dir} -p ${port} -c listen_addresses='' -c fsync=off`, "start"],
      fake,
    );
    started = true;
  } catch (e) {
    await cluster.stop();
    throw e;
  }
  return cluster;
}
