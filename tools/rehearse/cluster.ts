// A throwaway Postgres cluster whose now() is a file the rehearsal rewrites (libfaketime, with
// FAKETIME_TIMESTAMP_FILE and FAKETIME_NO_CACHE), listening only on a Unix socket in its own directory.
// The SQL reads now() throughout and every function pins its search_path, so the simulated clock reaches the
// jobs with no change to them. Linux only for now (the design's Open).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, chmodSync } from "node:fs";
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
  return join(root, versions[0]!, "bin");
}

// The socket lives in the unique directory, so every cluster can use the same port number.
const PORT = 54329;
// A Unix socket path must fit in 107 bytes: <dir>/.s.PGSQL.<port>.
const SOCKET_LIMIT = 107;

// Clusters still running, stopped by the exit and signal handlers below.
const live = new Set<{ dir: string; data: string; bin: string; stopNow: () => void }>();
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => {
    for (const c of [...live]) c.stopNow();
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      for (const c of [...live]) c.stopNow();
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
  }
}

function clockLine(ms: number): string {
  return `@${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}\n`;
}

export async function startCluster(opts: { at: number; preload?: boolean; extraServerOptions?: string }): Promise<Cluster> {
  if (process.platform !== "linux") throw new Error("The rehearsal is Linux only for now (libfaketime).");
  const lib = findFaketime();
  const bin = findPgBin();
  const base = tmpdir();
  const socketPath = join(base, "rehearse-pg-XXXXXX", `.s.PGSQL.${PORT}`);
  if (Buffer.byteLength(socketPath) > SOCKET_LIMIT) {
    throw new Error(`The socket path under ${base} would be ${Buffer.byteLength(socketPath)} bytes, over the ${SOCKET_LIMIT} a Unix socket allows. Set TMPDIR to a shorter directory.`);
  }
  const dir = mkdtempSync(join(base, "rehearse-pg-"));
  const root = process.getuid?.() === 0;
  const data = join(dir, "data");
  const clockFile = join(dir, "clock");
  const env = { ...process.env, LANG: "C", LC_ALL: "C" } as Record<string, string>;
  const run = (cmd: string, args: string[], extraEnv: Record<string, string> = {}) => {
    const envArgs = Object.entries(extraEnv).map(([k, v]) => `${k}=${v}`);
    // `env` carries the variables through runuser either way.
    if (root) return execFileSync("runuser", ["-u", "postgres", "--", "env", ...envArgs, cmd, ...args], { env, encoding: "utf8", stdio: "pipe" });
    return execFileSync(cmd, args, { env: { ...env, ...extraEnv }, encoding: "utf8", stdio: "pipe" });
  };
  const pgStop = (mode: string) => {
    try {
      run(join(bin, "pg_ctl"), ["-D", data, "-m", mode, "-w", "stop"]);
    } catch {
      // not running, or never started
    }
  };
  const entry = {
    dir,
    data,
    bin,
    stopNow() {
      pgStop("immediate");
      rmSync(dir, { recursive: true, force: true });
      live.delete(entry);
    },
  };
  const cluster: Cluster = {
    dir,
    port: PORT,
    setClock(ms) {
      // Written aside and renamed over, so libfaketime never reads an empty file mid-write.
      writeFileSync(`${clockFile}.tmp`, clockLine(ms), { mode: 0o644 });
      renameSync(`${clockFile}.tmp`, clockFile);
    },
    async stop({ keep = false } = {}) {
      if (keep) {
        pgStop("fast");
        live.delete(entry);
      } else {
        entry.stopNow();
      }
    },
  };
  hookExit();
  live.add(entry);
  try {
    writeFileSync(clockFile, clockLine(opts.at));
    chmodSync(dir, 0o755);
    chmodSync(clockFile, 0o644);
    if (root) execFileSync("chown", ["postgres:postgres", dir]);
    run(join(bin, "initdb"), ["-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8"]);
    const fake: Record<string, string> =
      opts.preload === false ? {} : { LD_PRELOAD: lib, FAKETIME_TIMESTAMP_FILE: clockFile, FAKETIME_NO_CACHE: "1" };
    run(
      join(bin, "pg_ctl"),
      ["-D", data, "-w", "-l", join(dir, "server.log"), "-o", `-k ${dir} -p ${PORT} -c listen_addresses='' -c fsync=off ${opts.extraServerOptions ?? ""}`, "start"],
      fake,
    );
  } catch (e) {
    let log = "";
    try {
      log = readFileSync(join(dir, "server.log"), "utf8").split("\n").slice(-20).join("\n");
    } catch {
      // no log yet
    }
    entry.stopNow();
    // The error names the directory, so a caller (and the cleanup test) can check that it is gone.
    throw Object.assign(new Error(`${e instanceof Error ? e.message : String(e)}\n--- server log tail ---\n${log}`), { dir });
  }
  return cluster;
}
