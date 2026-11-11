# System rehearsal: plan

Record, written 2026-11-11. Carries out `docs/plans/2026-11-11-system-rehearsal-design.md`. Every task goes test first:
write the failing test, show its red run, then write the code. During a task, run only the tests for the changed code.
Run `npm run build` once after the last task, and the stub rehearsal (Task 10). Tests that need no database are
`tools/rehearse/*.test.ts`, `engine/rehearsal/*.test.ts` and `instances/divided-world/rehearsal/*.test.ts`, run by
`npm run test:engine` (Task 10 adds the first glob to it; run them by path until then). Tests that need Postgres or
libfaketime are `tools/rehearse/database/*.test.ts`, run by `npm run test:rehearse` (Task 10), outside the build.

Build sessions touch no deployed database (CLAUDE.md, "A standing permission is written down"). Every database here is
one the rehearsal starts itself on this machine, or a scratch database on the local Postgres the session-start hook
starts. No task makes a live model call: the build runs `--stub` and the owner makes the first live run.

The environment needs libfaketime (`apt-get install -y faketime`, which brings `libfaketime`). Task 2 adds it to
`scripts/setup-container.sh`. A build session in a container without it installs it first.

## Task 1. The scheduled functions' wiring moves into handlers

Model: sonnet.

Files: new `supabase/functions/{meet,chatter,staff,settle}/handler.ts` and `handler.test.ts` beside each; the four
`index.ts` files; a new `supabase/functions/_shared/handler.ts` for the shared dependency type.

- `_shared/handler.ts` exports `interface JobDeps`: `env: (name: string) => string | undefined`;
  `db: (env: Environment, o?: { safeToRepeat?: (fn: string) => boolean }) => Db` (deployed: `postgrest({ url: env.url,
  key: env.secret, ...o })`); `models: typeof models` (from `_shared/models/index.ts`); `fetch: typeof fetch`;
  `broadcaster: typeof broadcaster` (from `_shared/broadcast.ts`). And `deployedDeps(get)`, which builds the deployed
  set from `Deno.env.get`.
- Each `handler.ts` exports `handle(request: Request, deps: JobDeps): Promise<Response>`, holding exactly what its
  `index.ts` holds today: the jobs-key check (`fromTheService`), the body check (`slot`, or `until` for settle),
  `withDatabaseSettings` for the tiers, `models(deps.env, ledgerWriter(db), { tiers, fetch: deps.fetch })`, the core
  call, the warnings and the answers. Meet passes `deps.fetch` where it passes `fetch` today. Staff keeps both doors
  (report and appeal) and its `WRITES` set, and its order: `runFilings`, then `runPatrolsAfterFilings` with
  `Date.now` and `begun`, then `runApologiesAfterFilings`. Settle uses `deps.broadcaster`.
- Each `index.ts` becomes `Deno.serve((r) => handle(r, deployedDeps((n) => Deno.env.get(n))))` with its header comment
  kept and pointed at the handler. Nothing deployed changes: the same status codes, bodies and logs.
- Tests first, per handler, with a fake `Db` and a fake `models` factory as `meet/core.test.ts` builds them: a request
  without the jobs key gets the not-the-service answer; a body without a valid `slot` (`until`) gets 400; a good request
  calls the core with the database `deps.db` made and the models `deps.models` made, built with the tiers the database
  holds; meet's feed reads go through `deps.fetch`; staff runs filings, then patrols, then apologies (record the order
  of the RPCs each one starts with); settle delivers through `deps.broadcaster`. Show each red before moving the code.

## Task 2. The fake-clock cluster and the Node clock

Model: sonnet.

Files: new `tools/rehearse/cluster.ts`, `tools/rehearse/clock.ts`, `tools/rehearse/clock.test.ts`,
`tools/rehearse/database/cluster.test.ts`; `scripts/setup-container.sh`.

- `cluster.ts`, `startCluster({ at: number }): Promise<Cluster>`:
  - Finds `libfaketime.so.1` (`/usr/lib/x86_64-linux-gnu/faketime/`, then `dpkg -L libfaketime`), and the newest
    `/usr/lib/postgresql/*/bin`. Missing either: refuse with the install line. On a platform other than Linux, refuse
    and say the rehearsal is Linux only for now (the design's Open).
  - Makes a fresh directory under `os.tmpdir()`, made accessible to the user the server runs as. Postgres refuses to
    run as root, so when `process.getuid() === 0` it runs `initdb`, `pg_ctl` and the server as `postgres` (`runuser
    -u postgres --`), with the directory chowned to it. The design session's spike found a directory under the
    scratchpad unreadable to `postgres`; this is why it is under `os.tmpdir()`.
  - `initdb -A trust`, then `pg_ctl -w start` with `LD_PRELOAD=<lib> FAKETIME_TIMESTAMP_FILE=<dir>/clock
    FAKETIME_NO_CACHE=1`, listening only on a Unix socket in the directory (`-k <dir> -c listen_addresses=''`), on a
    free port number.
  - `cluster.setClock(ms)` writes `@YYYY-MM-DD HH:MM:SS` (UTC) to the clock file. **It is called with a minute plus one
    second.** The spike showed `now()` reading 11:59:59.99993 just after the file was set to 12:00:00, and the jobs
    take their slot as `date_trunc('minute', now())`; one second in keeps every slot on its own minute.
  - `cluster.stop({ keep })` stops the server and removes the directory unless `keep`.
- `clock.ts`, `simulateClock()`: replaces `globalThis.Date` with a subclass whose `now()` and argument-less
  constructor return real time plus an offset, and `setSimulated(ms)` sets that offset. Everything else about `Date`
  is unchanged. Timers are not touched. Tests first (`clock.test.ts`): after `setSimulated(t)`, `Date.now()` and
  `new Date().getTime()` are within 50 ms of `t`; `new Date(0)` is still the epoch; `Date.parse` and `instanceof Date`
  still work; a `setTimeout(…, 10)` still fires.
- `database/cluster.test.ts`, tests first: a cluster started at `T` answers `now()` within a second after `T`; after
  `setClock(T + 3 days + 1 s)`, the same held connection's next `now()` and a column's `default now()` both read it;
  `date_trunc('minute', now())` after `setClock(m + 1 s)` is `m`, for 50 consecutive minutes. **Poison:** a server
  started without `LD_PRELOAD` makes `assertClock` (Task 4) refuse (keep that case here, using the export Task 4 adds;
  write it in this task as a test of a stub `assertClock` and finish it in Task 4).
- `scripts/setup-container.sh`: install `faketime` beside `postgresql` when `libfaketime.so.1` is missing.

## Task 3. A database client that does what PostgREST does

Model: sonnet.

Files: new `tools/rehearse/db.ts`, `tools/rehearse/database/db.test.ts`; `package.json` (devDependency `pg` and
`@types/pg`, exact versions at least two weeks old).

- `connect(socketDir, port, database): Promise<Connection>` holds one `pg.Client`. `connection.db(as: 'service' |
  { player: string }): Db` returns an object whose `rpc(fn, args)` does what PostgREST does for `POST /rpc/<fn>`:
  - Reads, once per function and cached, its argument names, their types (`format_type`), which have defaults, whether
    it returns a set (`proretset`), and its return type, from `pg_proc` in schema `public`. An unknown function, or an
    argument name it does not take, is a `DatabaseError` with code `PGRST202`, as PostgREST answers.
  - Builds `select … from public.<fn>(<name> => $1::jsonb -> '<name>' …)`, casting each argument from the JSON body:
    `jsonb` and `json` arguments take the JSON value; every other type takes `->>` text cast to the argument's type.
    A set comes back as `coalesce(json_agg(r), '[]')`, a scalar or composite as `to_json`. Names are quoted with
    `quote_ident` semantics (`pg`'s `escapeIdentifier`); no argument value is ever put into the SQL text.
  - Runs it in `begin` … `commit`: as the service, `set local role service_role` and
    `set_config('request.jwt.claims', '{"role":"service_role"}', true)`; as a player, `set local role authenticated`
    and claims `{"sub": <id>, "role": "authenticated"}`, as `tests.become` does (`supabase/tests/setup/fixtures.sql`).
    `rollback` on any error.
  - Maps an error to `DatabaseError(message, code, status, reason, hint)` from `supabase/functions/_shared/rpc.ts`,
    with the SQLSTATE as `code`, the message as `reason`, the hint as `hint`, and the status PostgREST gives the code
    (read the mapping in `rpc.ts` and PostgREST's documented table: `42501` is 403 for a signed-in caller, `P0001` 400,
    `23505` 409, the rest 400 or 500 as PostgREST does).
  - `connection.sql(text, params?)` runs plain SQL as the superuser, for setup and the scheduler.
- Tests first, in `database/db.test.ts`, on a scratch database made on `DATABASE_URL`'s local server with a few
  functions of its own (a scalar of a text and an integer argument, a `setof` of a composite, a `jsonb` argument, a
  function with a default, one that raises `22023` with hint `kayfabb.refusal`, one that returns
  `current_user` and `auth.uid()` after `supabase/tests/setup/auth-shim.sql` is applied, and one granted to
  `service_role` only). Each shape comes back as PostgREST would return it; the raise is a `DatabaseError` with that
  code and hint; the player sees their own id and `authenticated`, the service `service_role`; a player calling the
  service-only function gets `42501`; an argument whose value is `'); drop table x; --` is passed as data. The
  scratch database is dropped at the end. Refuse a `DATABASE_URL` that is not local, with `LOCAL_HOSTS` from
  `tools/test-sql.mjs`.

## Task 4. The scheduler and the dispatcher

Model: sonnet.

Files: new `tools/rehearse/cron.ts`, `tools/rehearse/cron.test.ts`, `tools/rehearse/schedule.ts`,
`tools/rehearse/dispatch.ts`, `tools/rehearse/dispatch.test.ts`, `tools/rehearse/database/schedule.test.ts`.

- `cron.ts`, `matches(expr: string, at: Date): boolean` for the five-field grammar `engine/rules/instance.ts` accepts
  (numbers, `*`, ranges, lists, steps, day of week 0 and 7 both Sunday), in UTC as pg_cron reads it. Day of month and
  day of week follow cron's rule: when both are restricted, either matching is enough. Tests first: every schedule the
  migrations and `instances/divided-world/settings.ts` use today (`* * * * *`, `*/5 * * * *`, `23 9 * * *`,
  `37 17 * * *`, the settlement and view-count crons, whatever they are), and the day-of-month or day-of-week rule.
- `schedule.ts`, `assertClock(conn, at)`: refuses unless the database's `now()` is within `[at, at + 5 s]`, naming
  both times and saying libfaketime may not be loaded. Finish Task 2's poison case with it.
- `schedule.ts`, `runMinute(ctx, minute)`: `cluster.setClock(minute + 1 s)`, `setSimulated(minute + 1 s)`,
  `assertClock`; reads `select jobid, jobname, schedule, command from cron.job where active order by jobid` (read each
  minute: a settings change reschedules a job); runs each matching job's `command` with `connection.sql` as the
  superuser, catching and recording an error per job as pg_cron would (the next job still runs); then calls
  `dispatch.drain`. Each job run is recorded `{ at, job, ok, error? }` for the report.
- `dispatch.ts`, `drain(ctx)`: reads `net.http_request_queue` rows with `id >` the last drained, in id order; builds a
  `Request(url, { method, headers, body: JSON.stringify(body) })`; routes on the path's `/functions/v1/<name>` to
  `{ meet, chatter, staff, settle }` `handle` (Task 1) with the rehearsal's `JobDeps` (Task 8 builds them); records
  `{ at, function, status, body }`. A path with no handler throws `UnknownFunction` naming it, and the run stops.
  When `ctx.cap.reached()` (Task 5) and the function is `meet`, `chatter` or `staff`, it is not called and is recorded
  `skipped: 'cost cap'`.
- Tests first: `dispatch.test.ts` with a fake queue: requests are handed over in id order, once each; an unknown path
  throws `UnknownFunction` (the poison); a capped model function is skipped and recorded, and settle still runs.
  `database/schedule.test.ts`: on a cluster with the shim and a job registered by `cron.schedule` that inserts
  `now()` into a table every 5 minutes, `runMinute` over 30 minutes writes six rows, each on its own minute.

## Task 5. The cassette, the stub answers and the cost cap

Model: sonnet.

Files: new `engine/rehearsal/cassette.ts`, `engine/rehearsal/cassette.test.ts`, `engine/rehearsal/stub.ts`,
`engine/rehearsal/stub.test.ts`, `tools/rehearse/models.ts`, `tools/rehearse/models.test.ts`.

- `cassette.ts`, `callKey(kind: 'chat' | 'complete', request, model: string): string`: the SHA-256 (`node:crypto`
  is not available in the engine's browser build, so take the hash function as a parameter) of canonical JSON (keys
  sorted) of every field of `ChatRequest` or `CompletionRequest` (`engine/system/model.ts`) except `staff` and
  `meeting` (which number rows, not content), plus the resolved model. Tests first: changing any one field
  (system, a message, the schema, the rules, `maxTokens`, `tier`, `duty`, the model) changes the key; key order in the
  request does not; `staff` and `meeting` do not.
- `stub.ts`, `leastAnswer(schema)`: the least value a JSON schema allows: an object with its required properties, an
  empty array (or `minItems` of least items), `'stub'` for a string (repeated to `minLength`), `minimum` or 0 for a
  number, the first `enum`, the first of `anyOf`/`oneOf`. Tests first: the schemas the meeting, chatter, filing,
  patrol and apology build today each produce a value their own repair (`repairAnswer`, `repairChatter`,
  `repairFiling`, `repairPatrol` and the apology's) accepts or rejects with a named predicate, never a throw of
  another kind.
- `tools/rehearse/models.ts`, `rehearsalModels(o): typeof models`, a factory with the real one's signature, so
  `JobDeps.models` takes it:
  - `mode: 'record' | 'offline' | 'fresh' | 'stub'`, the cassette directory, and `cap: { dollars }`.
  - It calls the real `models(env, countingRecord, options)` for live calls, where `countingRecord` writes the row
    through the `record` it was given and adds `row.costMicrodollars` to the live total. On a cassette hit it returns
    the recorded `ModelResult` (or rethrows the recorded `AnswerRejected`) and writes the recorded row through `record`,
    uncounted. On a miss: `offline` throws `CassetteMiss` naming the duty and key; `record` and `fresh` call live and
    save `{ key, request, result | error, row }` as one JSON file per key.
  - `stub` never calls live: it answers `chat` with `leastAnswer(request.schema)` and `complete` with an empty
    completion, usage empty, provider `'stub'`, cost 0, and writes a ledger row with outcome `ok`. If
    `record_model_call` refuses provider `stub`, read why in its migration and pass the row as the price table expects,
    priced at zero; do not change the migration.
  - It keeps every call `{ at, duty, staff, key, replayed, request, value | error, trims, cost }` for the report.
  - `cap.reached()` is `liveMicrodollars >= dollars * 1e6`.
  - The feeds: `rehearsalFetch(mode, dir)` wraps `fetch` for the meeting's feed reads, keyed on the URL and the
    simulated day, recorded and replayed like a call; `stub` mode answers every feed with an empty body.
- Tests first (`models.test.ts`, with a fake live factory): a miss in `record` calls live once and a second run with
  the same request replays it with no live call; `offline` throws on a miss; the live total counts live rows only and
  `cap.reached()` turns true at the cap; a replayed rejection is rethrown as `AnswerRejected`.

## Task 6. The corpus and scenario types and the generator

Model: sonnet.

Files: new `engine/rehearsal/types.ts`, `engine/rehearsal/generate.ts`, `engine/rehearsal/generate.test.ts`.

- `types.ts`:
  - `Sketch { key, name, pronouns?, classKey, voice: string, interests: string[], feuds: string[] (other sketch keys),
    postsPerDay: { least, most } }`.
  - `RehearsalCorpus { sketches: Sketch[], openers: Record<boardSlug, { title, body }[]>, replies: string[],
    agreeing: string[], disagreeing: string[] }`. A reply line may hold `{name}` (the replied-to character),
    `{interest}` (one of the poster's), and `{board}`.
  - `Scenario { key, seed, players, charactersPerPlayer: { least, most }, startThreads, backstoryDays, dayOfSeason,
    days, postsPerDay: { least, most }, reactionsPerPost: { least, most }, costCapDollars, bossMemory?: Memory,
    profile?: 'playtest' }`.
  - `RehearsalContent { corpus: RehearsalCorpus, scenarios: Scenario[] }`, which an instance exports.
- `generate.ts`, pure, with a seeded generator (mulberry32 from the scenario's seed and the day number):
  - `castFor(scenario, corpus)`: players, each with characters from the sketches, in order, without repeats, each
    character's `classKey` its sketch's.
  - `dayActions(world, corpus, scenario, day): TimedAction[]`, where `world` is the public state the rehearsal reads
    back each day (characters, threads by board, posts with their authors and times) and a `TimedAction` is
    `{ at, player, request }`, `request` a `runAction` body (`startThread`, `post`, `react`). Times spread across the
    day by a day curve weighted to the evening. Replies favor threads a character's feuds or interests are in;
    reactions lean by feud (`disagreeing` lines and a negative-quadrant kind toward a feud, agreement otherwise).
    A character never reacts to its own post, and a player's characters never react to each other's posts (the SQL
    refuses some of these; the generator avoids all of them so the report is not full of refusals).
- Tests first: the same seed and day give the same actions; another seed gives others; every action names a character
  and thread in `world`; each character's posts in a day are inside its sketch's bounds; no reaction is by the post's
  own player; replies name real characters in `{name}`.

## Task 7. Divided World's corpus and scenarios

Model: sonnet.

Files: new `instances/divided-world/rehearsal/corpus.ts`, `scenarios.ts`, `index.ts` (exports a
`RehearsalContent`), and `rehearsal.test.ts`.

- About 30 sketches of invented MFGG and Minus World regulars: fangame makers, spriters, speedrunners, lurkers, a
  contrarian, a reviewer, a newcomer. **No real member's name, handle or likeness**; names in the style the instance's
  name rules accept (`engine/rules/names.ts`). Each with a voice in a sentence, three to five interests drawn from the
  community's wheelhouse (`instances/divided-world/system/wheelhouse.ts`), a class key from
  `instances/divided-world/classes`, and a feud or two between sketches. Five to ten openers for each board slug in
  `instance.boards` that is not a System board, and about 60 reply lines, 20 agreeing and 20 disagreeing, short, in a
  2003 message board's register.
- Draft the words with care; the owner edits them in the PR, so keep each line on its own line for review.
- `scenarios.ts`: `small-circle-reign` (8 players, 2 to 3 characters each, 6 threads, 3 backstory days, day 30 of the
  season, 7 days, $5), `season-opening` (day 1 of the season, 2 backstory days, no starting memory), and
  `meltdown-handover` (the day that puts day 1 eight days before the season's end, so the last week runs inside the
  successor window, with a starting memory that has grudges and a hobby).
- Tests first (`rehearsal.test.ts`): every sketch's `classKey` is a class of the instance; every feud names a sketch;
  every opener's board is a non-System board of the instance; every name passes the instance's name rules; every
  opener and reply fits `settings.titleMaxLength` and `settings.postMaxLength`; scenario keys are unique; a starting
  memory passes `repairMemory` with no trim.

## Task 8. Setup and the run

Model: sonnet.

Files: new `tools/rehearse/instance.ts`, `tools/rehearse/setup.ts`, `tools/rehearse/run.ts`,
`tools/rehearse/database/run.test.ts`; `tools/test-sql.mjs` (export the file order); new `tools/sql-files.mjs` and
`tools/test-sql-files.mjs` if the order is moved out rather than exported.

- `instance.ts`, the rehearsal's composition root: `chooseInstance` from `supabase/functions/_shared/instance.ts`, and
  the content from `instances/divided-world/rehearsal/index.ts`, picked by `--profile` as `KAYFABB_PROFILE` is.
- The file order (`auth-shim.sql`, then `supabase/migrations/*.sql` by name) is one list: export it from
  `tools/test-sql.mjs` (`migrationFiles()`) and use it in both. The rehearsal does not apply `fixtures.sql`.
- `setup.ts`, `setUp(cluster, conn, instance, content, scenario)`:
  - Creates database `rehearsal`, applies the files, then `seed_instance` with `instanceSeed(instance)`
    (`supabase/functions/_shared/seed.ts`) as the service.
  - Writes the vault stand-in's secrets the jobs read (`kayfabb_functions_url` as `http://rehearsal.invalid`, and the
    jobs key the four handlers check, a random value generated per run), the way `supabase/tests/0009-schedule.sql`
    writes them, and calls the `schedule_*` functions if seeding did not.
  - Dates the open season so the first simulated day is `scenario.dayOfSeason` of it: read how `0007_seasons.sql` and
    settlement open and close a season and write `starts_at` (and `ends_at` if the season has one) as the superuser.
    This is a setup write to a throwaway database, said in the code's comment.
  - Makes the cast: the first account through a row in the shim's `auth.users` and `openAccount`, then made admin the
    way `0020_admins_invites.sql` makes the first admin; each other account through its own `auth.users` row,
    `createInvite` by the admin and `openAccount` with the code. Characters through `createCharacter` and, where the
    settings allow, `setDebut` now (`0071`); otherwise backstory settlement debuts them. Start threads through
    `startThread`. Every action through `runAction(dbs, instance, body)` (`supabase/functions/act/core.ts`) with
    `{ player: conn.db({ player }), service: conn.db('service') }`.
  - Writes `scenario.bossMemory`, if any, as the Boss's memory version the way `apply_meeting` writes one.
- `run.ts`, `rehearse(options)`: starts the cluster at the start of backstory, sets up, then for each minute from the
  start to the end of the last day: `runMinute`, and any filler action due that minute through `runAction`. Before day
  1, `systemEnabled` stays false; at day 1's first minute it is set true through the settings write an admin uses (find
  it from `engine/rules/settings` and the settings migration), as the admin account. Each day's `dayActions` is drawn
  at that day's first minute from the world read back then. At the end it collects (Task 9), writes the report, and
  stops the cluster unless `--keep`.
- The rehearsal's `JobDeps`: `env` a map with `SUPABASE_URL` `http://rehearsal.invalid`, the secret and jobs keys as
  set up, `ANTHROPIC_API_KEY` `placeholder` (the proxy holds the real key), and the profile; `db` returns
  `conn.db('service')`; `models` from Task 5; `fetch` from Task 5's feeds; `broadcaster` one that records and sends
  nothing.
- Tests first (`database/run.test.ts`): a one-day stub run of a tiny scenario (2 players, 1 backstory day) ends with at
  least one meeting row for day 1, every job in `cron.job` run at its minutes, no request undispatched, the filler's
  posts in `acts`, and The System's switch on from day 1 only.

## Task 9. The collector and the report

Model: sonnet.

Files: new `tools/rehearse/collect.ts`, `engine/rehearsal/report.ts`, `engine/rehearsal/report.test.ts`.

- `collect.ts`, `collect(conn, calls, jobs, requests)`: reads back, per simulated day, as the superuser: meetings
  (their status, error, trims), the Boss's memory versions, `queued_moves` with `why`, `go_live_at`, `landed_act`, and
  their ends, staff orders, visits and filings, patrols, apologies, chatter posts (Acts by staff characters), the
  ledger's rows, and the filler's volume. Read each table's columns from its migration; do not guess names. Joins the
  calls Task 5 kept (prompt and answer) to the meeting or job they belong to. Returns a `RehearsalLog` JSON value.
- `report.ts`, pure, `reportHtml(log): string`: one self-contained page (inline CSS, no script needed to read it): a
  header with the scenario, seed, mode, days and cost (live and replayed); a section per day with the meeting (its
  digest and memory as sent, in collapsible `<details>`; the answer; memory before and after side by side), the moves
  (reason, demand, go-live, landed, ended how), orders, Mod work, chatter, trims and drops, cost by job, and skips.
  Every string from the log is escaped.
- `run.ts` writes `report.html` and `log.json` to `rehearsals/<scenario>/<run>/`, where `<run>` is the start time and
  mode, and the cassette to `rehearsals/<scenario>/cassette/` (shared between runs of a scenario).
- Tests first: a move whose `why` is `<script>alert(1)</script>` and a chatter post with `<img src=x onerror=…>`
  appear as text, not markup (the poison); a log with a skipped job and a trimmed answer shows both; the page has no
  external reference (`src=` or `href=` to anything but `#`).

## Task 10. The command, the scripts and CI

Model: sonnet.

Files: new `tools/rehearse/cli.ts`; `package.json`; `tools/build.mjs` (`OUTSIDE_THE_BUILD`); `.gitignore`;
`tsconfig.json`; new `.github/workflows/rehearsal.yml`; `README.md`.

- `cli.ts`: `npm run rehearse -- <scenario> [--stub | --offline | --fresh] [--days N] [--seed N] [--cap DOLLARS]
  [--profile playtest] [--keep]`, and any scenario field as `--<field> <value>`. An unknown scenario lists the known
  ones. It prints a line a day as it goes, and the report's path at the end. Its header says what the design says, in
  brief, and that the key is a stored credential, never pasted.
- `package.json`: `"rehearse": "node --experimental-strip-types --no-warnings=ExperimentalWarning tools/rehearse/cli.ts"`,
  `"test:rehearse"` running `tools/rehearse/database/*.test.ts` the same way, and `"tools/rehearse/*.test.ts"` added to
  `test:engine`'s globs.
- `tools/build.mjs`: `OUTSIDE_THE_BUILD` gains `test:rehearse` and the command, with the reason (they need Postgres and
  libfaketime). Read how `problems()` names npm scripts before adding them.
- `tsconfig.json`: `include` gains `tools/rehearse/**/*.ts`. `.gitignore` gains `rehearsals/`.
- `rehearsal.yml`, on the same triggers as `sql.yml` (not called by the release): install `postgresql` and `faketime`
  when missing, `npm ci`, `npm run test:rehearse`, then `npm run rehearse -- small-circle-reign --stub --days 2`, and
  upload the run's directory as an artifact.
- `README.md`: a short section on running a rehearsal, the stub, the cassette and the cap, and that a live run needs
  the Anthropic key stored on the environment as a credential.
- Run the 7-day stub of each scenario once, and give the owner the reports' paths in the PR with how long each took.

## Review focus

- The handlers (Task 1) change nothing deployed: the same status codes, bodies, logs, `safeToRepeat` sets and the
  staff run's order, and `index.ts` reads only `Deno.env`.
- The database client against PostgREST: argument casting, a set against a single row, a composite, an error's status
  and hint, and the roles and claims. A difference here makes the rehearsal behave unlike production and says nothing.
- The clock: every slot on its own minute (the spike's 11:59:59.99993), a `Date` captured at module load before
  `simulateClock()` runs, and any job code that reads time some other way.
- The cassette's key: a request field left out of it replays a stale answer to a changed prompt.
- The cap: it counts live rows only, never a replayed one, and a run passes it by at most one job.
- The scheduler against pg_cron: the minute a job runs, two jobs on one minute, a job rescheduled by a settings change
  mid-run, and day-of-month or day-of-week matching.
- The corpus is invented people only, and the PR asks the owner to read every line.
- A week is about 10,080 minutes: the stub run's time is in the PR, and a step that grows with the cast or the posts
  is named.
- The report escapes every model and filler string.
