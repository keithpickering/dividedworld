// Setup: a fresh database on the rehearsal's cluster, built the way the SQL suite builds one (the shim, every migration by name),
// seeded with the instance, with its jobs' secrets, its open season dated for the scenario, and the filler's cast made through the
// same code a player's actions run through (`runAction`). The cast is invented people only (the corpus's sketches).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Instance } from "../../engine/rules/types.ts";
import type { Memory } from "../../engine/system/memory.ts";
import type { RehearsalContent, Scenario } from "../../engine/rehearsal/types.ts";
import { castFor, DAY_MS, MINUTE } from "../../engine/rehearsal/generate.ts";
import { PRONOUN_PRESETS } from "../../engine/rules/pronouns.ts";
import { seededRng } from "../../engine/system/pool.ts";
import { instanceSeed } from "../../supabase/functions/_shared/seed.ts";
import { runAction } from "../../supabase/functions/act/core.ts";
import { connect, type Connection } from "./db.ts";
import type { Cluster } from "./cluster.ts";

/** The database the rehearsal builds. */
export const DATABASE = "rehearsal";

export interface Timeline {
  /** The open season's start, and its end as the season length runs out (calendar arithmetic, as the SQL does it). */
  readonly seasonStart: number;
  readonly seasonEnd: number;
  /** The first minute of the run's day 1, a UTC midnight. */
  readonly day1: number;
  /** The first minute of backstory: `backstoryDays` before day 1. */
  readonly clusterStart: number;
}

type Span = { readonly unit: "day" | "week" | "month"; readonly count: number };

/** `ms` plus a span, as Postgres adds the interval in UTC: a month keeps the day of the month, clamped to the month's end. */
export function addSpan(ms: number, span: Span): number {
  if (span.unit === "day") return ms + span.count * DAY_MS;
  if (span.unit === "week") return ms + span.count * 7 * DAY_MS;
  const d = new Date(ms);
  const first = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + span.count, 1);
  const last = new Date(Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(new Date(first).getUTCFullYear(), new Date(first).getUTCMonth(), Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

// A season the rehearsal dates: a 1 January start, so a three-month season is the 90 days the scenarios' day numbers are written in.
const SEASON_START = Date.UTC(2027, 0, 1);

/**
 * When everything falls. Day 1 is `scenario.dayOfSeason` of the season. The season's length is read off the calendar (`seasonEnd`, not
 * a nominal 90 days), so counting from the start and counting back from the end are the same instant; the formula counts back from the
 * end, so `meltdown-handover`'s day 83 puts day 1 exactly eight days before the end however long the months are.
 */
export function timeline(scenario: Scenario, instance: Instance): Timeline {
  const seasonStart = SEASON_START;
  const seasonEnd = addSpan(seasonStart, instance.settings.seasonLength as Span);
  const length = Math.round((seasonEnd - seasonStart) / DAY_MS);
  if (scenario.dayOfSeason < 1 || scenario.dayOfSeason > length) {
    throw new Error(`scenario ${scenario.key} starts on day ${scenario.dayOfSeason} of a season, and this instance's season is ${length} days`);
  }
  // Days from day 1 to the end, counting day 1: the season's length plus one, less the scenario's day number.
  const day1 = seasonEnd - (length + 1 - scenario.dayOfSeason) * DAY_MS;
  return { seasonStart, seasonEnd, day1, clusterStart: day1 - scenario.backstoryDays * DAY_MS };
}

/** Account id to the player's label (`player-1`), the filler's name for a person. */
export type Players = ReadonlyMap<string, string>;

export interface CastMember {
  readonly id: string;
  readonly name: string;
  readonly player: string;
  readonly sketch: string;
}

export interface Setup {
  readonly conn: Connection;
  /** The secrets the jobs read and the handlers check; random per run. */
  readonly keys: { readonly jobs: string; readonly secret: string; readonly publishable: string };
  /** Account id by player label, and the player label by account id. */
  readonly accounts: ReadonlyMap<string, string>;
  readonly players: Players;
  /** Player 1, the admin. */
  readonly admin: string;
  readonly characters: readonly CastMember[];
  /** What setup did that the report should say (a starting memory entry dropped for a character not in the cast, a debut that waits). */
  readonly notes: readonly string[];
}

/** The files a database is built from, in order: the same list the SQL suite reads (tools/test-sql.mjs). */
async function sqlFiles(): Promise<string[]> {
  // A variable specifier: TypeScript does not resolve it, so the .mjs needs no declaration file.
  const where = new URL("../test-sql.mjs", import.meta.url).href;
  const mod = (await import(where)) as { migrationFiles(): string[] };
  return mod.migrationFiles();
}

const hex = (n: number): string => randomBytes(n).toString("hex");

/**
 * `admin` is a connection to the cluster's `postgres` database, used to create the rehearsal's own. The clock is held at the start of
 * backstory while this runs, so the cast and the first threads are made in its first minute.
 */
export async function setUp(cluster: Cluster, admin: Connection, instance: Instance, content: RehearsalContent, scenario: Scenario, tl: Timeline): Promise<Setup> {
  let conn: Connection | undefined;
  try {
    return await build(cluster, admin, instance, content, scenario, tl, (c) => { conn = c; });
  } catch (e) {
    // The connection it opened is its own to close when it fails; the caller never got it.
    await conn?.end().catch(() => {});
    throw e;
  }
}

async function build(cluster: Cluster, admin: Connection, instance: Instance, content: RehearsalContent, scenario: Scenario, tl: Timeline, opened: (c: Connection) => void): Promise<Setup> {
  const notes: string[] = [];
  const hold = () => cluster.setClock(tl.clusterStart + 1000);
  hold();

  await admin.sql(`create database ${DATABASE}`);
  await admin.sql(`alter database ${DATABASE} set timezone to 'UTC'`);
  const conn = await connect(cluster.dir, cluster.port, DATABASE);
  opened(conn);
  const service = conn.db("service");
  for (const file of await sqlFiles()) await conn.sql(readFileSync(file, "utf8"));
  hold();

  await service.rpc("seed_instance", { payload: instanceSeed(instance) });

  // The vault stand-in's secrets the jobs read (supabase/tests/0009-schedule.sql writes them the same way), with a key per run.
  const keys = { jobs: `sb_secret_${hex(16)}`, secret: `sb_secret_${hex(16)}`, publishable: `sb_publishable_${hex(16)}` };
  await conn.sql("insert into vault.decrypted_secrets values ('kayfabb_functions_url', 'http://rehearsal.invalid'), ('kayfabb_jobs_key', $1)", [keys.jobs]);
  // The jobs are registered by the settings' triggers as the seed writes them. Where one was not, every schedule_* function is the
  // way to make it; cron.schedule by name is idempotent, so calling them all changes nothing that is already there.
  const fns = await conn.sql("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'schedule\\_%' and p.pronargs = 0");
  const jobs = await conn.sql("select count(*)::int as n from cron.job");
  if (Number(jobs[0]?.n) < fns.length) for (const f of fns) await conn.sql(`select public.${String(f.proname)}()`);

  await dateSeason(conn, tl);

  // The cast, through the code a player's actions run through.
  const cast = castFor(scenario, content.corpus);
  const accounts = new Map<string, string>();
  const players = new Map<string, string>();
  const dbsFor = (account: string) => ({ player: conn.db({ player: account }), service });
  const act = async (account: string, body: Record<string, unknown>) => {
    hold();
    const answer = await runAction(dbsFor(account), instance, body);
    if (answer.status !== 200) throw new Error(`setup: ${String(body.action)} for ${players.get(account) ?? account} was refused (${answer.status}): ${JSON.stringify(answer.body)}`);
    return answer.body as Record<string, unknown>;
  };
  const makeLogin = async (label: string): Promise<string> => {
    const row = await conn.sql("insert into auth.users (email) values ($1) returning id", [`${label}@rehearsal.invalid`]);
    const id = String(row[0]?.id);
    accounts.set(label, id);
    players.set(id, label);
    return id;
  };

  const first = cast[0];
  if (!first) throw new Error(`scenario ${scenario.key} has no players`);
  // The first account: registration is open for it alone (README, "The first admin"), then made an admin as 0020 says, and closed again.
  const mode = await conn.sql("select value from settings where key = 'registrationMode'");
  await conn.sql("update settings set value = '\"open\"' where key = 'registrationMode'");
  const adminId = await makeLogin(first.player);
  await act(adminId, { action: "openAccount" });
  await conn.sql("insert into admins (account) values ($1)", [adminId]);
  if (mode[0]) await conn.sql("update settings set value = $1::jsonb where key = 'registrationMode'", [JSON.stringify(mode[0].value)]);
  for (const p of cast.slice(1)) {
    const invite = await act(adminId, { action: "createInvite" });
    const id = await makeLogin(p.player);
    await act(id, { action: "openAccount", invite: invite.code });
  }

  const characters: CastMember[] = [];
  for (const p of cast) {
    const account = accounts.get(p.player)!;
    for (const c of p.characters) {
      const preset = c.pronouns && c.pronouns in PRONOUN_PRESETS ? { pronouns: PRONOUN_PRESETS[c.pronouns as keyof typeof PRONOUN_PRESETS] } : {};
      // A drop now, which is the default; the character debuts as it is made, so the filler can act at once.
      const made = await act(account, { action: "createCharacter", name: c.name, class: c.classKey, ...preset });
      characters.push({ id: String(made.id), name: c.name, player: p.player, sketch: c.sketch });
    }
  }

  // The first threads, started by the cast in turn, openers drawn by the scenario's seed.
  const rng = seededRng(`rehearsal/${scenario.seed}/setup`);
  const boards = Object.keys(content.corpus.openers).filter((b) => (content.corpus.openers[b]?.length ?? 0) > 0).sort();
  for (let i = 0; i < scenario.startThreads && boards.length > 0; i++) {
    const who = characters[i % characters.length]!;
    const board = boards[Math.floor(rng() * boards.length)]!;
    const openers = content.corpus.openers[board]!;
    const opener = openers[Math.floor(rng() * openers.length)]!;
    await act(accounts.get(who.player)!, {
      action: "startThread", board, character: who.id,
      title: Array.from(opener.title).slice(0, instance.settings.titleMaxLength).join(""),
      body: Array.from(opener.body).slice(0, instance.settings.postMaxLength).join(""),
    });
  }

  if (scenario.bossMemory) notes.push(...(await writeBossMemory(conn, instance, scenario.bossMemory, characters, tl)));

  return { conn, keys, accounts, players, admin: adminId, characters, notes };
}

/**
 * Dates the open season so day 1 of the run falls on the scenario's day of it. This is a setup write to a throwaway database: the
 * rehearsal's own cluster, which nothing else reads, and which the SQL's own rules (a season starts when its first window does) have no
 * way to be told about. `seed_instance` opened the season at the cluster's clock; its start moves to the timeline's.
 *
 * Where the season began before the cluster did, the days between are history no one lived: one settlement window covers them, so the
 * first real window starts where backstory does. Without it the settlement would take one run a day to walk from the season's start,
 * and a run of a week would never reach its own days.
 *
 * Where the season starts after backstory begins (a scenario on day 1 of the season, like `season-opening`), no window covers the
 * backstory days: they are before the season, so they stay unsettled, and the first window starts at the season's start.
 */
async function dateSeason(conn: Connection, tl: Timeline): Promise<void> {
  await conn.sql("update seasons set starts_at = to_timestamp($1 / 1000.0) where ends_at is null", [tl.seasonStart]);
  if (tl.seasonStart < tl.clusterStart) {
    await conn.sql(
      "insert into settlements (starts_at, ends_at, season) select s.starts_at, to_timestamp($1 / 1000.0), s.id from seasons s where s.ends_at is null",
      [tl.clusterStart],
    );
  }
  // The SQL's own calendar arithmetic must agree with the timeline's, or day 1 is not where the scenario says.
  const end = await conn.sql("select (extract(epoch from starts_at + span_interval(setting('seasonLength'))) * 1000)::float8 as ms from seasons where ends_at is null");
  if (Number(end[0]?.ms) !== tl.seasonEnd) {
    throw new Error(`the season ends at ${new Date(Number(end[0]?.ms)).toISOString()} in the database and ${new Date(tl.seasonEnd).toISOString()} in the timeline`);
  }
}

/**
 * The Boss's starting memory, written as `apply_meeting` writes one: a version in `staff_memory` hanging on a meeting, with the
 * opinions and grudges naming characters by id. The scenario names them by sketch name; a name with no character in the cast is
 * dropped (the SQL drops any entry whose character is not public), and said.
 */
async function writeBossMemory(conn: Connection, instance: Instance, memory: Memory, cast: readonly CastMember[], tl: Timeline): Promise<string[]> {
  const notes: string[] = [];
  const byName = new Map(cast.map((c) => [c.name, c.id]));
  const resolve = <T extends { character: string }>(list: readonly T[], what: string): T[] => {
    const out: T[] = [];
    for (const e of list) {
      const id = byName.get(e.character);
      if (id) out.push({ ...e, character: id });
      else notes.push(`the starting memory's ${what} of ${e.character} was left out: no such character in this cast`);
    }
    return out;
  };
  const body = { ...memory, opinions: resolve(memory.opinions, "opinion"), grudges: resolve(memory.grudges, "grudge") };
  const boss = await conn.sql("select coalesce((select boss from seasons where ends_at is null), (select staff from characters where staff = $1)) as staff", [instance.system.duties.meeting]);
  const staff = boss[0]?.staff;
  if (!staff) throw new Error("there is no Boss to hold a starting memory");
  // A meeting a day before backstory began, closed ok: the version hangs on it, and no run's slot is it.
  const slot = tl.clusterStart - DAY_MS;
  const meeting = await conn.sql(
    "insert into meetings (started_at, slot, finished_at, outcome, bank_before, bank_after) values (to_timestamp($1 / 1000.0), to_timestamp($1 / 1000.0), to_timestamp($2 / 1000.0), 'ok', 0, 0) returning id",
    [slot, slot + MINUTE],
  );
  await conn.sql("insert into staff_memory (staff, meeting, at, body) values ($1, $2, to_timestamp($3 / 1000.0), $4::jsonb)", [staff, meeting[0]?.id, slot + MINUTE, JSON.stringify(body)]);
  return notes;
}

/**
 * The tiers a run names, written as the instance's `modelTiers` setting in the rehearsal's own database (the rehearsal's cluster only),
 * merged over what the seed put there so a tier not named keeps the instance's model. The handlers read the setting from the database
 * each job (`withDatabaseSettings`), so this is before the first job. With no tier named nothing is written.
 */
export async function writeModelTiers(conn: Connection, tiers: { readonly strong?: string; readonly light?: string }): Promise<void> {
  const named = { ...(tiers.strong === undefined ? {} : { strong: tiers.strong }), ...(tiers.light === undefined ? {} : { light: tiers.light }) };
  if (Object.keys(named).length === 0) return;
  // The settings check (supabase/migrations/0149_card_writes.sql) wants both tiers in the row; with no row to merge over, a lone tier would be refused in its words, so say it in ours.
  const row = (await conn.sql("select value from settings where key = 'modelTiers'"))[0]?.value as { strong?: unknown; light?: unknown } | undefined;
  for (const tier of ["strong", "light"] as const) {
    if (named[tier as keyof typeof named] === undefined && (typeof row?.[tier] !== "string" || row[tier] === "")) {
      throw new Error(`The database has no modelTiers setting holding a "${tier}" model, so naming only the other tier would leave "${tier}" missing. Name both --strong and --light.`);
    }
  }
  // One statement, so a tier not named keeps the instance's model whatever else the row held.
  await conn.sql(
    "insert into settings (key, value) values ('modelTiers', $1::jsonb) on conflict (key) do update set value = settings.value || excluded.value",
    [JSON.stringify(named)],
  );
}
