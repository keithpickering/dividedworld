# System rehearsal: a simulated week of The System on filler data: design

Record, written 2026-11-11. The design session for a way to watch The System plan and play a week before any player
does, with the owner. Its plan is `docs/plans/2026-11-11-system-rehearsal-plan.md`. The owner asked: "Are there any tests
we can run on the System (bosses and mods, meetings, etc) with seeded filler data to see how it, for example, plans a
week of activity?" The answer was no: every existing test of The System (`engine/system/*.test.ts`,
`supabase/functions/{meet,chatter,staff}/*.test.ts`, `supabase/tests/0049` to `0053`) runs a fake model with canned
answers, which proves the plumbing and says nothing of what a Boss does with a forum in front of it. Each section below
was decided one question at a time.

## 1. What it is

**Decided:** a command, `npm run rehearse -- <scenario>`, that runs the real System code through a simulated stretch of
days against a throwaway database full of filler players, and writes a report of what The System did. It sits outside
the build, like the SQL suite and e2e. It adds no product state, no screen and no migration, never reads or writes a
deployed database, and changes nothing a player sees.

**Scope: every scheduled job.** The daily meeting, the per-minute tick that lands and ends moves, chatter, the Mod
Bots' filings with the patrols and apologies that follow them, settlement, view counts and the search rebuild, each at
its own schedule from the instance's settings. Reports and appeals are left out: a player starts those, and a filler
player that decides when to report would be a second design. Weighed: the Boss alone (meetings and the tick); every
job plus scripted reports and appeals.

## 2. The clock and the scheduler

**A fake-clock Postgres.** The SQL reads `now()` throughout, and every function pins `search_path = public, pg_temp`,
so `pg_catalog.now()` cannot be shadowed from SQL. The rehearsal starts its own Postgres server under libfaketime, with
`FAKETIME_TIMESTAMP_FILE` naming a clock file the rehearsal rewrites and `FAKETIME_NO_CACHE=1`. A spike in the
design session showed it: a server started at `@2027-03-01 09:00:00` answered `now()` with that time, and after the
file was rewritten to `@2027-03-03 17:30:00` the next statement's `now()` and a column's `default now()` both read the
new time. The Node side follows the same clock: the process's `Date` is moved by an offset, so `Date.now()` and
`new Date()` in the job code (the patrol run's `begun`, the card rules' default `now`) read simulated time, while timers,
which run on the monotonic clock, are untouched. Weighed: real time with shrunken settings (meetings every ten minutes),
which no longer tests the shipped schedule and makes "a week" meaningless to the phase numbers; backdated data run at
real time, which takes a real week.

**The scheduler stands in for pg_cron, and reads what the migrations registered.** The database is built as the SQL
suite builds it (`supabase/tests/setup/auth-shim.sql`, then every migration), so the shim's `cron.job` holds every job
the migrations scheduled, with its real schedule and its real command. The scheduler steps minute by minute; at each
minute it sets the clock, checks that the database's `now()` agrees with it (and refuses to go on if not, which is how a
server that did not load libfaketime is caught), and runs, as the superuser pg_cron runs them as, the command of every
active job whose schedule matches that minute. No list of jobs is written in the rehearsal: a job a later migration
adds is run with no edit here ("Two lists that must agree are one list").

**The dispatcher stands in for the Edge runtime.** A job that calls a function leaves its request in the shim's
`net.http_request_queue`. After each minute's jobs, the dispatcher takes every new request in order and hands it to the
same handler the deployed function runs, as a `Request`. A request to a path it has no handler for stops the run and
names the path, so a new function is never silently skipped. To make "the same handler" true, each scheduled function's
wiring (the jobs key it accepts, its model tiers, the ledger, the staff run's order of filings, then patrols, then
apologies) moves out of its `index.ts` into a `handler.ts` that both `Deno.serve` and the rehearsal call, with what
differs (the database client, the model factory, `fetch`, the broadcaster) passed in. A copy of that wiring in the
rehearsal would drift the first time either was edited.

**Backstory.** A scenario's days before day 1 run with `systemEnabled` false (the instance's shipped value), so the
jobs that call no model shape a forum with history: settlement debuts characters and moves Aura, the tick has nothing to
land. At day 1 the rehearsal switches The System on through the same settings write an admin uses. The open season is
dated so that day 1 falls on the scenario's day of the season, which puts the Boss in the phase the scenario names.

## 3. The filler

**Scripted activity.** The filler cast keeps posting and reacting through the simulated week, decided by a seeded,
deterministic generator: the same scenario and seed make the same week of filler. The generator does not read The
System's moves, so a demand is met only by chance; the digest still changes day to day. Weighed: a frozen world, where
every meeting after the first reads almost the same digest and no demand is ever met; a model playing each filler
character, which could answer the Boss's demands but costs money per character per day and is a build of its own.

**A corpus from the instance, drafted by a model and edited by the owner.** The Boss takes hobbies and opinions from
what characters post, so the filler's words matter more than its volume. The engine defines what a corpus holds:
character sketches (a name, a voice, interests, a class, a feud or two), thread openers for each board, and reply lines
with slots the generator fills. Divided World's corpus is committed beside the instance, drafted once by a model in the
build and reviewed and edited by the owner in the PR. Every sketch is an invented person: no real member's name or
handle, so a rehearsal never puts words in a real friend's mouth. Weighed: the same corpus written by hand; a generic
placeholder in the engine, which gives the Boss little to latch onto.

**The same path a player takes.** No login server runs locally, so a filler account is made the way the SQL fixtures
make one (a row in the shim's `auth.users`), opened through `openAccount` with an invite from the first account, which
is made an admin. Everything after that (characters, threads, posts, reactions) goes through `runAction` as that
player, so every filler Act is written by the code that writes a player's.

## 4. Model calls and the cassette

**Real calls, recorded for replay.** Model calls go through the real adapter on the instance's `modelTiers`, priced into
the throwaway database's ledger. A cassette sits in front of the adapter. A call is identified by everything it sends
(duty, tier, the model the tier resolves to, system prompt, messages, schema, rules and token limit), hashed. A call the
cassette holds is replayed for free and writes its recorded ledger row, so the report shows what a fresh run would
cost. A call it does not hold goes live and is recorded. `--offline` makes a missing call stop the run and name it;
`--fresh` ignores the cassette. The outside feeds the meeting fetches are recorded the same way, so a replay reads the
same news. The old voice's completion server is used only if one is configured; otherwise the instance's stock lines
stand in, as in production. Weighed: real calls every run with no recording, where every rerun pays again and no two
runs agree; prompt-only, deferring real calls.

**The key** is the owner's Anthropic key, stored once as a credential on the environment through the secure form, so
the network proxy attaches it to requests to the provider; the rehearsal holds only a placeholder
(`ANTHROPIC_API_KEY` set to a dummy value). It is never printed, pasted or asked for in chat (CLAUDE.md, "Secrets").

**A stub mode.** `--stub` answers every chat call with the least answer its schema allows, filled with placeholder
words, priced at zero, and lets the repair step do what it does with it. It proves the whole week's wiring at no cost,
and CI runs a two-day stub rehearsal on each PR, so a migration or a job change that breaks a scheduled path fails
there.

## 5. Cost

**A per-run dollar cap, default $5,** set in the scenario and overridable by a flag. It counts live spend only: the
rehearsal's ledger writer passes every row the live adapter writes through to the database and adds up its
`costMicrodollars`, which the adapter priced from the provider's own usage block ("Cost is a column, not a report").
Replayed rows are written by the cassette and never counted. Once live spend reaches the cap, the dispatcher stops
handing requests to the functions that call a model (meet, chatter, staff) and records each as skipped for the cap; the
week finishes in plain code (the tick, settlement, stock lines). A job already running finishes, so a run can pass the
cap by at most one job's spend. Weighed: an estimate first and a confirmation; no cap.

## 6. The report

**A day-by-day report, as one self-contained HTML page and the same data as JSON,** written with the cassette under a
git-ignored `rehearsals/<scenario>/<run>/`. For each simulated day: the meeting's prompt (the digest the Boss read, its
memory) and its answer; the memory before and after; each move with its reason, demand, go-live time, when it landed
and how it ended; the Boss's orders to the Mods; filings, patrols, apologies and chatter, with their words; every trim
and drop the repair step recorded; and cost by job, live and replayed. Model text is escaped everywhere, since a model's
words are data. `--keep` keeps the database and prints how to reach it with psql. Cassettes and reports are not
committed: they are real model output and go stale whenever a prompt changes. Weighed: the forum itself pointed at the
rehearsal database, which needs a local PostgREST and auth and shows only the end state; a plain text log.

## 7. Scenarios

**Named scenario files,** committed with the instance: players, characters per player, threads to start with, days of
backstory, the day of the season day 1 falls on, how many days to run, filler volume, the cost cap, an optional
starting memory for the Boss (a Boss on day 30 of a reign has opinions), and the random seed. Divided World ships three:
`small-circle-reign`, `season-opening` and `meltdown-handover`. Any field can be overridden on the command line.
Weighed: one fixed scenario with flags; flags only.

## The layers

- **Engine** (`engine/rehearsal/`): the corpus and scenario types, the seeded generator, the cassette's identity of a
  call and its stub answers, and the report builder. All pure.
- **Divided World** (`instances/divided-world/rehearsal/`): the corpus and the three scenarios, plugged in through the
  engine's types.
- **Edge** (`tools/rehearse/`): the fake-clock cluster, the Node clock, the database client, the scheduler, the
  dispatcher, setup, the collector and the command line. Its own composition root (`tools/rehearse/instance.ts`) picks
  the instance and its rehearsal content, so the deployed functions never bundle the corpus.
- **Functions** (`supabase/functions/{meet,chatter,staff,settle}/handler.ts`): the wiring moved out of each `index.ts`,
  unchanged in what it does when deployed.

## The database client

The functions reach the database through PostgREST (`supabase/functions/_shared/rpc.ts`, `Db.rpc(fn, args)`), which is
not running locally. The rehearsal's `Db` speaks to Postgres directly over one connection with the `pg` package (a new
devDependency), doing what PostgREST does for an RPC: it reads the function's argument names and types and its return
shape from `pg_proc` once, casts each named argument from JSON, returns a set as an array and anything else as its JSON
value, runs the call in a transaction as `service_role` or as `authenticated` with the player's claims (as
`tests.become` does), and turns an error into the same `DatabaseError` with its SQLSTATE, message and hint. A direct
driver rather than psql per call because a week is about 10,080 tick minutes; one held connection follows the clock
file because libfaketime reads it on every time call. Weighed: a local PostgREST, the most faithful, but a binary and
a JWT secret to manage in every session and in CI; psql per call, slow at a week's scale.

## What could slip a mask

Nothing the product says changes. The report shows the filler's owners and classes and the Boss's hidden memory: it is
a local developer tool about invented people, written to a git-ignored directory, and never served to a player. CI's
stub run uses invented people and no model output.

## Ways out

The rehearsal adds no state a player, a character or a post can be put in.

## Open

- **macOS.** libfaketime on macOS loads through `DYLD_INSERT_LIBRARIES` and behaves differently; the first build is
  Linux only (the cloud container and CI), and says so when started elsewhere.
- **What a live week costs** is measured by the first live run, not estimated here.
- **Filler that answers the Boss.** The generator ignores The System's moves. A later design may let it read the moves
  in force and lean toward meeting a demand, or hand a few characters to a cheap model.
- **Reports and appeals** stay out until filler players can decide to file them.
