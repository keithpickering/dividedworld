// `npm run rehearse -- <scenario> [--stub | --offline | --fresh] [--days N] [--seed N] [--cap DOLLARS] [--profile playtest] [--keep]`
//
// What docs/plans/2026-11-11-system-rehearsal-design.md says, in brief: the rehearsal runs the real database and the real scheduled
// jobs on a Postgres of its own, on a fake clock, minute by minute through a scenario's days, with filler players made of the corpus
// acting through the same code a player's action takes. Model calls go through a cassette: `record` (the default) replays what it has
// and makes live calls, paid and capped, for the rest; `offline` replays only; `fresh` ignores the cassette; `stub` makes no model
// call at all. The run's directory under rehearsals/ holds report.html and log.json.
//
// A live run needs the Anthropic key, and the key is a stored credential on the environment, added through the secure form
// (request_credential), never pasted into a chat, a command line, a file or this repository. The rehearsal never holds the key itself.
//
// Any scenario field is a flag too: `--players 6`, and a {least,most} field as `--postsPerDay 1-3` (one number means both ends).
import { fileURLToPath } from "node:url";
import type { Scenario } from "../../engine/rehearsal/types.ts";
import type { Mode } from "./models.ts";

export const USAGE = `Usage: npm run rehearse -- <scenario> [--stub | --offline | --fresh] [--days N] [--seed N] [--cap DOLLARS]
                           [--profile playtest] [--keep] [--<scenario field> <value>]
  A {least,most} field takes --postsPerDay 1-3 (one number means both ends). The default mode is record.`;

export type Parsed =
  | { readonly ok: true; readonly scenario: Scenario; readonly mode: Mode; readonly profile: string | undefined; readonly keep: boolean }
  | { readonly ok: false; readonly error: string };

const MODES: Record<string, Mode> = { "--stub": "stub", "--offline": "offline", "--fresh": "fresh" };
const refuse = (what: string): Parsed => ({ ok: false, error: `${what}\n${USAGE}` });

/** A number, whole text only. */
function num(text: string): number | undefined {
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined;
}

export function parseArgs(argv: readonly string[], known: readonly Scenario[]): Parsed {
  const names = known.map((s) => s.key).join(", ");
  const key = argv[0];
  if (key === undefined || key.startsWith("--")) return { ok: false, error: `Name a scenario. Known scenarios: ${names}\n${USAGE}` };
  const base = known.find((s) => s.key === key);
  if (!base) return { ok: false, error: `Unknown scenario "${key}". Known scenarios: ${names}\n${USAGE}` };

  let mode: Mode | undefined;
  let keep = false;
  let profile: string | undefined;
  const over: Record<string, unknown> = {};
  const rest = argv.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg in MODES) {
      if (mode) return refuse("Give one of --stub, --offline, --fresh, not several.");
      mode = MODES[arg];
      continue;
    }
    if (arg === "--keep") { keep = true; continue; }
    if (!arg.startsWith("--")) return refuse(`Unexpected argument "${arg}".`);
    const name = arg.slice(2);
    const value = rest[++i];
    if (value === undefined) return refuse(`${arg} needs a value.`);
    if (name === "cap") { // --cap is the scenario's costCapDollars
      const n = num(value);
      if (n === undefined || n < 0) return refuse(`--cap needs dollars, not "${value}".`);
      over.costCapDollars = n;
    } else if (name === "profile") {
      if (value !== "playtest") return refuse(`--profile is "playtest" or left out, not "${value}".`);
      profile = value;
      over.profile = value;
    } else if (name === "key") {
      return refuse("--key is not a field a run can change.");
    } else if (name in base) {
      const current = (base as unknown as Record<string, unknown>)[name];
      if (typeof current === "number") {
        const n = num(value);
        if (n === undefined) return refuse(`--${name} needs a number, not "${value}".`);
        over[name] = n;
      } else if (current && typeof current === "object" && "least" in current && "most" in current) {
        const m = /^(\d+)(?:-(\d+))?$/.exec(value);
        if (!m) return refuse(`--${name} needs a number or a range like 1-3, not "${value}".`);
        const least = Number(m[1]);
        const most = m[2] === undefined ? least : Number(m[2]);
        if (least > most) return refuse(`--${name} ${value} has its least above its most.`);
        over[name] = { least, most };
      } else {
        return refuse(`--${name} cannot be set from the command line.`);
      }
    } else {
      return refuse(`Unknown flag ${arg}.`);
    }
  }
  return { ok: true, scenario: { ...base, ...over }, mode: mode ?? "record", profile, keep };
}

async function main(): Promise<number> {
  const { rehearse } = await import("./run.ts");
  const { rehearsedInstance } = await import("./instance.ts");
  const parsed = parseArgs(process.argv.slice(2), rehearsedInstance().content.scenarios);
  if (!parsed.ok) {
    console.error(parsed.error);
    return 2;
  }
  const { scenario, mode, profile, keep } = parsed;
  console.log(`Rehearsing ${scenario.key}: ${scenario.days} days, ${mode} mode, seed ${scenario.seed}.`);
  const startedAt = Date.now();
  const run = await rehearse({ scenario, mode, ...(profile ? { profile } : {}), keep, onDay: (line) => console.log(line) });
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`Done in ${seconds}s. Live model spend: $${(run.liveMicrodollars / 1e6).toFixed(4)}.`);
  for (const note of run.notes) console.log(`Note: ${note}`);
  if (run.reportDir) console.log(`Report: ${run.reportDir}/report.html`);
  if (run.kept) {
    console.log(`Kept the cluster in ${run.kept.dir} (port ${run.kept.port}, database ${run.kept.database}).`);
    const k = run.kept as { pg_ctl?: string; psql?: string };
    if (k.pg_ctl) console.log(k.pg_ctl);
    if (k.psql) console.log(k.psql);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
