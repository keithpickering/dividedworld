// The run: a cluster at the start of backstory, setup, then every minute to the end of the last day. Each minute is the scheduler's
// (`runMinute`: the clock, every cron job that is due, the dispatcher) and then any filler action due in it, through `runAction`, so every
// filler Act is written by the code that writes a player's. The System's switch is off through backstory and on at day 1's first minute.
// Each day's filler is drawn at that day's first minute from the public world read back then (`readWorld`).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Instance } from "../../engine/rules/types.ts";
import type { RehearsalContent, RehearsalCorpus, Scenario } from "../../engine/rehearsal/types.ts";
import { dayActions, DAY_MS, MINUTE, type TimedAction, type World } from "../../engine/rehearsal/generate.ts";
import { runAction } from "../../supabase/functions/act/core.ts";
import type { JobDeps } from "../../supabase/functions/_shared/handler.ts";
import { startCluster, type Cluster } from "./cluster.ts";
import { simulateClock } from "./clock.ts";
import { connect, type Connection } from "./db.ts";
import { rehearsalFetch, rehearsalModels, type KeptCall, type Mode } from "./models.ts";
import { runMinute, type JobRun, type ScheduleCtx } from "./schedule.ts";
import { STALL_MS, Stalled, within, type Dispatched } from "./dispatch.ts";
import { collect } from "./collect.ts";
import { reportHtml } from "../../engine/rehearsal/report.ts";
import { rehearsedInstance } from "./instance.ts";
import { DATABASE, setUp, timeline, writeModelTiers, type CastMember, type Players, type Setup, type Timeline } from "./setup.ts";

/** One filler action's end: through, or refused (a refusal is recorded and the run goes on). */
export interface FillerResult {
  readonly at: number;
  readonly player: string;
  readonly action: string;
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
}

/** Everything a finished run holds, for the collector and the report (Task 9). */
export interface RunContext {
  readonly conn: Connection;
  readonly instance: Instance;
  readonly content: RehearsalContent;
  readonly scenario: Scenario;
  readonly mode: Mode;
  readonly timeline: Timeline;
  readonly players: Players;
  readonly characters: readonly CastMember[];
  readonly jobs: readonly JobRun[];
  readonly dispatched: readonly Dispatched[];
  readonly calls: readonly KeptCall[];
  readonly filler: readonly FillerResult[];
  /** The last queue id the dispatcher took. */
  readonly lastDrained: number;
  /** The minute The System was switched on, which is day 1's first. */
  readonly systemOnAt: number | null;
  readonly notes: readonly string[];
}

export interface RehearseOptions {
  readonly scenario: Scenario;
  readonly mode: Mode;
  /** Defaults to the rehearsed instance's (`rehearsedInstance(profile)`). */
  readonly content?: RehearsalContent;
  readonly instance?: Instance;
  /** `playtest`, or none; the scenario's own `profile` where this is not given. */
  readonly profile?: string;
  /** Where the cassette is kept; defaults to `rehearsals/<scenario>/cassette`. */
  readonly cassetteDir?: string;
  /** Where the run's directory is made; defaults to `rehearsals/<scenario>`. */
  readonly runsDir?: string;
  readonly keep?: boolean;
  /** The model each tier asks for, where named (`--strong`, `--light`): written to the rehearsal's own settings before the first job. */
  readonly tiers?: { readonly strong?: string; readonly light?: string };
  /** How long one step may take in real time before the run stops as stalled (dispatch.ts, STALL_MS; tests shorten it). */
  readonly stallMs?: number;
  /** Replaces `runAction` for the filler (tests). */
  readonly act?: typeof runAction;
  /** A line a day, as it goes. */
  readonly onDay?: (line: string) => void;
  /** Called with the finished run before the cluster stops: the collector's place (Task 9), and where a test reads the database. */
  readonly onFinish?: (ctx: RunContext) => Promise<void>;
}

/** What `rehearse` returns until Task 9 collects it into a log. */
export interface RawRun {
  readonly scenario: Scenario;
  readonly mode: Mode;
  readonly timeline: Timeline;
  readonly jobs: readonly JobRun[];
  readonly dispatched: readonly Dispatched[];
  readonly calls: readonly KeptCall[];
  readonly filler: readonly FillerResult[];
  readonly systemOnAt: number | null;
  readonly notes: readonly string[];
  readonly liveMicrodollars: number;
  /** How many filler actions the generator drew over the run: each ran exactly once, so it is `filler.length`. */
  readonly drawn: number;
  /** Where report.html and log.json were written. */
  readonly reportDir?: string;
  /** Set when the cluster was kept: where to reach it. */
  readonly kept?: Reach;
}

/** How to reach a kept cluster again: it is stopped, so the first line starts it with the fake clock, the second is psql. */
export interface Reach {
  readonly dir: string;
  readonly port: number;
  readonly database: string;
  readonly pg_ctl: string;
  readonly psql: string;
}

function reach(cluster: Cluster): Reach {
  const as = process.getuid?.() === 0 ? "runuser -u postgres -- " : "";
  const start =
    `${as}env LD_PRELOAD=${cluster.lib} FAKETIME_TIMESTAMP_FILE=${cluster.dir}/clock FAKETIME_NO_CACHE=1 ` +
    `${cluster.bin}/pg_ctl -D ${cluster.dir}/data -w -l ${cluster.dir}/server.log -o "-k ${cluster.dir} -p ${cluster.port} -c listen_addresses='' -c fsync=off" start`;
  return { dir: cluster.dir, port: cluster.port, database: DATABASE, pg_ctl: start, psql: `psql -h ${cluster.dir} -p ${cluster.port} -U postgres ${DATABASE}` };
}

const BACKSTORY_WINDOW = 7 * DAY_MS;

/**
 * The public state of the board at `dayStart`, as the filler's generator reads it (engine/rehearsal/generate.ts's World). It leaves out
 * The System's own Acts (an Act with no character) and staff (Mod Bot and Boss) characters, since the SQL refuses a reaction to either,
 * and marks a thread on a System board not open. At a busy instance's scale it reads a week of posts and the threads they are in, never
 * the whole forum.
 */
export async function readWorld(conn: Connection, instance: Instance, corpus: RehearsalCorpus, players: Players, dayStart: number): Promise<World> {
  const sketchOfName = new Map(corpus.sketches.map((s) => [s.name, s.key]));
  const since = dayStart - BACKSTORY_WINDOW;
  const chars = await conn.sql(
    "select c.id, c.name, c.owner from characters c where c.staff is null and c.owner is not null and c.debuted_at is not null and c.retired_at is null order by c.created_at, c.id",
  );
  const characters = chars.flatMap((c) => {
    const player = players.get(String(c.owner));
    const sketch = sketchOfName.get(String(c.name));
    return player && sketch ? [{ id: String(c.id), name: String(c.name), player, sketch }] : [];
  });
  const threads = await conn.sql(
    "select t.id, b.slug as board, t.title, b.is_system from threads t join boards b on b.id = t.board where (t.last_at >= to_timestamp($1 / 1000.0) or (t.last_at is null and t.created_at >= to_timestamp($1 / 1000.0))) order by t.created_at, t.id",
    [since],
  );
  const posts = await conn.sql(
    "select a.id, a.thread, a.character, (extract(epoch from a.created_at) * 1000)::float8 as ms from acts a join characters c on c.id = a.character " +
      "where a.kind = 'post' and c.staff is null and c.owner is not null and a.created_at >= to_timestamp($1 / 1000.0) order by a.created_at, a.id",
    [since],
  );
  const known = new Set(characters.map((c) => c.id));
  const inThreads = new Set(threads.map((t) => String(t.id)));
  return {
    dayStart,
    reactions: instance.reactions,
    characters,
    // Open to a post or a reaction: no thread on a System board is, and no other thread here is closed to anyone (nothing in the
    // SQL locks a thread or restricts a board against posting; rules act on words, never on who may post).
    threads: threads.map((t) => ({ id: String(t.id), board: String(t.board), title: String(t.title), open: t.is_system !== true })),
    posts: posts.filter((p) => known.has(String(p.character)) && inThreads.has(String(p.thread))).map((p) => ({ act: String(p.id), thread: String(p.thread), character: String(p.character), at: Number(p.ms) })),
  };
}

const dayName = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export async function rehearse(o: RehearseOptions): Promise<RawRun> {
  const { scenario, mode } = o;
  const profile = o.profile ?? scenario.profile;
  const chosen = rehearsedInstance(profile);
  const instance = o.instance ?? chosen.instance;
  const content = o.content ?? chosen.content;
  const tl = timeline(scenario, instance);
  // Real time, taken before the simulated clock replaces Date: the run's directory name.
  const startedReal = new Date().toISOString();
  const cassetteDir = o.cassetteDir ?? join("rehearsals", scenario.key, "cassette");

  const cluster = await startCluster({ at: tl.clusterStart });
  const clock = simulateClock();
  clock.setSimulated(tl.clusterStart + 1000);
  let admin: Connection | undefined;
  let stalled = false;
  let setup: Setup | undefined;
  let kept: RawRun["kept"];
  let reportDir: string | undefined;
  try {
    admin = await connect(cluster.dir, cluster.port, "postgres");
    setup = await setUp(cluster, admin, instance, content, scenario, tl);
    const conn = setup.conn;
    const service = conn.db("service");
    await writeModelTiers(conn, o.tiers ?? {});

    // The shipped value is off; backstory runs with the System off whatever a profile says.
    await conn.sql("update settings set value = 'false'::jsonb where key = 'systemEnabled'");

    const simDay = (): string => dayName(Date.now());
    const models = rehearsalModels({ mode, dir: cassetteDir, cap: { dollars: scenario.costCapDollars }, now: () => Date.now() });
    const secretKeys = JSON.stringify({ default: setup.keys.secret, kayfabb_jobs: setup.keys.jobs });
    const env: Record<string, string | undefined> = {
      SUPABASE_URL: "http://rehearsal.invalid",
      SUPABASE_SECRET_KEYS: secretKeys,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: setup.keys.publishable }),
      // The proxy holds the real key; the rehearsal never does.
      ANTHROPIC_API_KEY: "placeholder",
      ...(profile ? { KAYFABB_PROFILE: profile } : {}),
    };
    const sent: { topic: string; event: string }[] = [];
    const deps: JobDeps = {
      env: (name) => env[name],
      db: () => service,
      models,
      fetch: rehearsalFetch(mode, cassetteDir, { day: simDay }),
      // Records and sends nothing: nobody is listening.
      broadcaster: (() => ({
        deliver: async (messages: readonly { topic: string; event: string }[]) => {
          for (const m of messages) sent.push({ topic: m.topic, event: m.event });
          return "sent" as const;
        },
        send: async (messages: readonly { topic: string; event: string }[]) => {
          for (const m of messages) sent.push({ topic: m.topic, event: m.event });
          return true;
        },
      })) as unknown as JobDeps["broadcaster"],
    };
    const sched: ScheduleCtx = {
      connection: conn, deps, cap: models.cap, ...(o.stallMs === undefined ? {} : { stallMs: o.stallMs }), lastDrained: 0, dispatched: [], cluster, clock, jobs: [],
    };
    const filler: FillerResult[] = [];
    let systemOnAt: number | null = null;

    const lastMinute = tl.day1 + scenario.days * DAY_MS - MINUTE;
    let pending: TimedAction[] = [];
    let next = 0;
    let dayPosts = 0;
    let drawn = 0;
    const limits = { title: instance.settings.titleMaxLength, post: instance.settings.postMaxLength };
    const accountOf = setup.accounts;

    for (let minute = tl.clusterStart; minute <= lastMinute; minute += MINUTE) {
      const offset = minute - tl.clusterStart;
      const dayStarts = offset % DAY_MS === 0;
      const index = offset / DAY_MS;
      if (minute === tl.day1) {
        // The switch an operator's settings write makes (the settings table has no player write; the README does it in SQL), made at
        // day 1's first minute with the clock on it.
        cluster.setClock(minute + 1000);
        clock.setSimulated(minute + 1000);
        await conn.sql("update settings set value = 'true'::jsonb where key = 'systemEnabled'");
        systemOnAt = minute;
      }
      // A step inside the minute names itself first (dispatch.ts, Stalled); this is for whatever else the minute waits on.
      await within(`the minute ${new Date(minute).toISOString()}`, runMinute(sched, minute), 2 * (o.stallMs ?? STALL_MS));
      if (dayStarts) {
        if (index > 0) o.onDay?.(`${dayName(minute - DAY_MS)}: ${dayPosts} filler actions through, ${filler.filter((f) => !f.ok && f.at >= minute - DAY_MS).length} refused, ${sched.dispatched.length} requests dispatched so far`);
        dayPosts = 0;
        // Backstory days count back from day 1 as -2, -3, ... (-1 is the cast's draw); the run's days are 1, 2, ...
        const number = index < scenario.backstoryDays ? index - scenario.backstoryDays - 1 : index - scenario.backstoryDays + 1;
        const world = await readWorld(conn, instance, content.corpus, setup.players, minute);
        pending = dayActions(world, content.corpus, scenario, number, limits);
        drawn += pending.length;
        next = 0;
      }
      while (next < pending.length && pending[next]!.at < minute + MINUTE) {
        const a = pending[next++]!;
        const account = accountOf.get(a.player);
        const action = String(a.request.action);
        // The generator names only players that setup made: one it does not know is a bug here, and so is any throw below.
        if (!account) throw new Error(`filler: ${action} names ${a.player}, who setup did not make`);
        const answer = await within(`the filler's ${action} by ${a.player}`, (o.act ?? runAction)({ player: conn.db({ player: account }), service }, instance, a.request), o.stallMs);
        if (answer.status === 200) { filler.push({ at: a.at, player: a.player, action, ok: true, status: 200 }); dayPosts++; }
        else if (answer.status >= 400 && answer.status < 500) {
          // A refusal a player would see: recorded, and the run goes on.
          filler.push({ at: a.at, player: a.player, action, ok: false, status: answer.status, error: JSON.stringify(answer.body) });
        } else {
          // A 5xx is the code failing, not the game refusing: it stops the run with what it said.
          throw new Error(`filler: ${action} by ${a.player} answered ${answer.status}: ${JSON.stringify(answer.body)}`);
        }
      }
    }
    o.onDay?.(`${dayName(lastMinute)}: ${dayPosts} filler actions through, ${filler.filter((f) => !f.ok && f.at >= lastMinute + MINUTE - DAY_MS).length} refused, ${sched.dispatched.length} requests dispatched in all`);

    const ctx: RunContext = {
      conn, instance, content, scenario, mode, timeline: tl, players: setup.players, characters: setup.characters,
      jobs: sched.jobs, dispatched: sched.dispatched, calls: models.calls, filler,
      get lastDrained() { return sched.lastDrained; },
      systemOnAt, notes: setup.notes,
    };
    await o.onFinish?.(ctx);
    // Task 9: the collector reads the run back; the report and the JSON go to rehearsals/<scenario>/<run>/ (the cassette is beside it).
    const log = await collect(ctx);
    const runDir = join(o.runsDir ?? join("rehearsals", scenario.key), `${startedReal.replace(/[:.]/g, "-")}-${mode}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "report.html"), reportHtml(log));
    writeFileSync(join(runDir, "log.json"), `${JSON.stringify(log, null, 2)}\n`);
    reportDir = runDir;

    if (o.keep) kept = reach(cluster);
    return {
      scenario, mode, timeline: tl, jobs: sched.jobs, dispatched: sched.dispatched, calls: models.calls, filler, systemOnAt,
      notes: setup.notes, liveMicrodollars: models.cap.liveMicrodollars(), drawn, ...(reportDir ? { reportDir } : {}), ...(kept ? { kept } : {}),
    };
  } catch (e) {
    if (e instanceof Stalled) {
      // The step's own connection is still waiting on its answer, so nothing more is asked of it (its close would wait behind the
      // answer that is not coming, and the error would never be said). What the database is doing is read on the other connection
      // and said at once, before anything else can wait.
      stalled = true;
      const doing = await within("the read of what the database is doing", admin!.sql(
        `select a.pid, a.state, a.wait_event_type, a.wait_event, now() - a.query_start as running, left(a.query, 400) as query,
                (select string_agg(l.locktype || ' ' || l.mode || coalesce(' on ' || l.relation::regclass::text, ''), '; ') from pg_locks l where l.pid = a.pid and not l.granted) as waiting_for
         from pg_stat_activity a where a.datname is not null and a.pid <> pg_backend_pid() and a.backend_type = 'client backend'`), 15_000).catch((x: unknown) => `not read: ${x instanceof Error ? x.message : String(x)}`);
      // Where the server itself does not answer, its own log and what each of its processes is waiting in are all there is to read.
      const tail = (() => { try { return readFileSync(join(cluster.dir, "server.log"), "utf8").split("\n").slice(-40).join("\n"); } catch { return "no server log"; } })();
      const processes = (() => { try { return execFileSync("ps", ["-eo", "pid,stat,wchan:32,etime,args"], { encoding: "utf8" }).split("\n").filter((l) => /postgres|PID/.test(l)).map((l) => l.slice(0, 200)).join("\n"); } catch { return "not read"; } })();
      console.error(`${e.message}\nwhat the database was doing:\n${typeof doing === "string" ? doing : JSON.stringify(doing, null, 2)}\n--- server log tail ---\n${tail}\n--- the server's processes ---\n${processes}`);
    }
    // A failed run with --keep leaves its cluster for a look: the error says where, and how to start it again.
    if (!o.keep) throw e;
    const r = reach(cluster);
    throw new Error(`${e instanceof Error ? e.message : String(e)}\nthe cluster is kept in ${r.dir} (stopped). To start it: ${r.pg_ctl}\nTo look: ${r.psql}`, { cause: e });
  } finally {
    clock.restore();
    // After a stall the connections are not closed politely (the stalled one would never answer): stopping the cluster ends them.
    if (stalled) {
      setup?.conn.drop();
      admin?.drop();
    } else {
      await setup?.conn.end().catch(() => {});
      await admin?.end().catch(() => {});
    }
    await cluster.stop({ keep: o.keep === true });
  }
}
