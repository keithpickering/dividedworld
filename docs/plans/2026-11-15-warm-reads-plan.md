# Reads find a warm connection: plan

Record, written 2026-11-15. Carries out `docs/plans/2026-11-15-warm-reads-design.md` (its sections are cited as §N),
task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No migration is
added and no SQL in `supabase/migrations/` changes. Everything is tested on this machine and on Postgres on
localhost; no task touches a deployed database, project or service, and the release tool of Task 5 is driven only by
its self-test until the release itself runs it. No state a player, a character or a post can be put in is added.
Nothing added is computed from a private fact (§7): the gate is per browser tab, the pool is the same for every
caller, and the budget file reads plans.

Layers: the gate (Tasks 1 to 3), the adapter's change (Task 4), the release tool (Task 5) and the budget file (Task 7)
are engine. The declared values in `instances/divided-world/` and the release workflow's step (Task 6) are Divided
World's; the tool is handed the file and the project and knows no instance.

The deployed project's pool is already 2, set by hand in the design session at the owner's word (§2). Its idle time
is still the default until the first release that carries Task 6.

The order: 1, then 2 and 3 (either order, each needs 1). 4, 7 and the pair 5 then 6 need nothing from the others.

## Task 1. The gate: one read ahead at a time (§4)

Model: sonnet

**Files:** a new `engine/ui/ahead.ts` and `engine/ui/ahead.test.ts`. Read first: `engine/ui/router.tsx` (`prefetch`,
`LOAD_LIMIT_MS`, `Link`), `engine/ui/glass/prepared.ts` (`usePrepared`, `useRest`).

**What:** a module that holds, for the document it is loaded in, at most one read ahead in flight and at most one
waiting.

- `readAhead(start: () => Promise<unknown>): () => void`. With none in flight it calls `start` at once and holds the
  gate until the promise settles, either way, or until `LOAD_LIMIT_MS` has passed (a read that never answers must not
  hold the gate; move `LOAD_LIMIT_MS` here or import it, whichever leaves no import cycle, and keep one constant).
  With one in flight, `start` becomes the one waiting, replacing any that waited before; the replaced one is never
  called. When the one in flight lets go, the one waiting is called and takes the gate.
- The function returned withdraws: a waiting `start` that is withdrawn is never called. Withdrawing one that has
  started, or was replaced, does nothing. It is safe to call twice.
- A `start` that throws before it returns a promise lets the gate go at once.
- `resetReadAhead()` for tests: empties the gate.
- A press does not use the gate at all; that is the callers' business (Tasks 2 and 3), and the header comment says
  so, with the reason from §4 (one connection reads ahead, one serves the press).

**Tests first** (`ahead.test.ts`, fake timers): the first starts at once; a second while the first is out does not
start until the first resolves, and also when it rejects; a third replaces the second, and the second is never
called; a withdrawn waiter is never called and the next rest starts normally after the first settles; a read that
never settles lets go at `LOAD_LIMIT_MS` and the waiter starts; a `start` that throws does not jam the gate; withdraw
after start is a no-op. **Red run:** the file fails at the missing module. Record it.

## Task 2. Links read ahead through the gate (§4)

Model: sonnet

**Files:** `engine/ui/router.tsx`, `engine/ui/router.test.tsx`. Read first: the whole of `prefetch`, `takePrefetch`,
`dropPrefetches`, `Link` and `usePrefetch` in `router.tsx`, and the prefetch tests in `router.test.tsx` (`manualLoader`,
`setupLinks`, "prefetches are capped at twenty", "focus rests 100 ms like the pointer, and pointerdown starts one at
once", "a link's focus rests before it reads").

**What:**
- `prefetch(to, options?: { readonly now?: boolean }): () => void` on the router's context and from `usePrefetch`.
  Everything it refuses today it still refuses (another origin, a route with no loader, the document already shown,
  an address already held), and then returns a withdraw that does nothing. Otherwise: with `now`, it reads at once as
  today; without, the body that calls `invoke` and records the entry runs as the `start` handed to `readAhead`, and
  the gate's withdraw is returned. The entry is made when the read starts, never while it waits, so a waiting address
  is not "held": a click on it loads on its own.
- The sweep of old answers and the cap of twenty stay as they are, and run when a read starts.
- `Link`: the pointer's rest and the focus's rest call `prefetch(to)` and keep the withdraw; `onPointerLeave` and
  `onBlur` clear their timer as today and call it. `onPointerDown` (primary button, no modifier) calls
  `prefetch(to, { now: true })`.
- `dropPrefetches` and an account change leave nothing waiting: a withdraw kept by a `Link` for a read that was
  dropped must stay harmless.
- The comment above `REST_MS` and the file's header say one read ahead is in flight at a time, and why, citing the
  design.

**Tests first** (`router.test.tsx`; call `resetReadAhead()` in the file's `beforeEach`): two links rested on one
after the other, the first's loader still out: one loader call; resolve it, and the second's loader is called; the
pointer leaves the second link before the first resolves: the second is never loaded; a pointer down on a second
link while the first's read ahead is out loads at once; a click on a link whose read is waiting loads once, and the
waiting read does not then start a second; the existing cap test still passes once each of its reads is resolved in
turn or made with `now` (rewrite it to say what it now holds: twenty answers kept, the oldest dropped). Existing
tests that start several prefetches at once and expect them all are rewritten to the new rule, each named in the
task's record. **Red run** recorded before the code.

## Task 3. Card buttons read ahead through the same gate (§4)

Model: sonnet

**Files:** `engine/ui/glass/prepared.ts`, `engine/ui/glass/prepared.test.tsx`, `engine/ui/cards/play.tsx`
(`readyForm`, and its type on line 89), `engine/ui/cards/Forms.tsx`, `engine/ui/cards/Lens.tsx` (two triggers),
`engine/ui/cards/PlayActions.tsx` (two triggers). Read first: all of `prepared.ts`.

**What:**
- `usePrepared`'s `early(arg)` returns a withdraw: where an answer for the same key is held it does nothing; else it
  hands `() => start(arg).promise` to `readAhead` and returns the gate's withdraw. `open` is unchanged and never
  waits: it calls `start` itself.
- `useRest(early)` takes an `early` that may return a withdraw, keeps the latest one, and calls it on
  `onPointerLeave`, on `onBlur` and on a press (`press()`), beside the timers it already clears.
- `play.readyForm` returns what `readEarly` returns, and its type says so. The five `useRest(...)` callers return
  their `early`'s result from the closure (`useRest(() => (ban ? undefined : prepared.early()))` and the like).
- `Prepared`'s doc comment says `early` goes through the gate and `open` does not.

**Tests first** (`prepared.test.tsx`, `resetReadAhead()` before each): two `usePrepared` triggers rested on while
the first's read is out make one read; the second starts when the first lands; leaving the second before then means
it never reads; `open` on the second while the first's read ahead is out reads at once. A test in the same file or
`router.test.tsx` holds the sharing: a link's read ahead in flight makes a card trigger's rest wait, and the other
way round. **Red run** recorded.

## Task 4. A statement timeout is not sent again (§5)

Model: inline

**Files:** `web/src/data/supabase.ts` (`transport`, line 763, and the comment on `read`),
`web/src/data/supabase.test.tsx` (beside "retries a read once on a 5xx and once on a thrown fetch, then gives up").

**What:** `transport(r)` is true for a status of 0, and for a status of 500 or more whose error carries no Postgres
code. A Postgres code is five characters of digits and capital letters (`/^[0-9A-Z]{5}$/`); PostgREST's own codes
begin `PGRST` and are longer, and a gateway's error has none. The comment says a database error is a fact about the
request and names the rule.

**Tests first:** a read answered `500` with `{ code: '57014', message: 'canceling statement due to statement
timeout' }` rejects, its failure kind is `server`, and the harness saw one request; a `504` with `{ code: 'PGRST003'
}` is sent twice; the existing 503, 502 and thrown-fetch cases are unchanged. **Red run:** the first case sees two
requests. Record it.

## Task 5. The release tool: the Data API's pool, declared, set and checked (§3)

Model: sonnet

**Files:** new `tools/check-data-api.mjs` and `tools/test-data-api.mjs`; a new
`instances/divided-world/data-api.json`; `tools/build.mjs` (`STEPS`, `OUTSIDE_THE_BUILD`). Read first:
`tools/check-deployed-migrations.mjs` and `tools/test-deployed-migrations.mjs` (the shape to follow: `problems`,
`retrying`, `parseArgs`, what is refused before any connection, what is printed), `tools/instance-files.mjs`
(`scrub`), and how `tools/build.mjs` reads a check without a test and a file in `OUTSIDE_THE_BUILD`.

**What:**
- `instances/divided-world/data-api.json`: `{ "pool": 2, "idleSeconds": 60 }`. `pool` is a whole number of 1 or
  more, or `null` for Supabase's automatic size; `idleSeconds` is a whole number from 1 to 60, or `null` for the
  default. Anything else is refused before a request is made.
- `node tools/check-data-api.mjs --project <ref> --declared <file> [--set]`, the token read from
  `SUPABASE_ACCESS_TOKEN` and never from an argument. It reads `GET https://api.supabase.com/v1/projects/<ref>/postgrest`
  and compares `db_pool` with `pool` and `db_pool_max_idletime` with `idleSeconds`. Without `--set` a difference is a
  problem, named with both values. With `--set` it sends `PATCH` to the same address with only the fields that
  differ, then reads again and compares; nothing is written when nothing differs. The field names and ranges are
  Supabase's management API reference as read on 2026-11-15 (`v1-update-postgrest-service-config`); the header says
  so with the date.
- It prints the project ref it read and the two values, never the token; every message passes through `scrub`. Exit
  status as its neighbor: 0 no problems, 1 problems, 2 refused. No `--project`, no `--declared`, no token, or a
  declared file that does not parse or is out of range, is refused before any request.
- A request that got no answer, a 429 and a 5xx are tried again, three attempts with a pause that doubles; a 401,
  403, 404 or 400 is thrown at once with the status and the API's message ("Three unrelated timeouts are not a poison
  pill").
- The pure parts are exported for the test: the declared file's validation, the comparison (`problems(declared,
  deployed)`), the body a `--set` sends, and the retry classification, with `fetch` injected.
- `tools/build.mjs`: `node tools/test-data-api.mjs` joins `STEPS` beside `test-deployed-migrations`, and
  `tools/check-data-api.mjs` joins `OUTSIDE_THE_BUILD` with its reason (it reads a deployed project through
  Supabase's management API, which the build has not got; it runs in the release workflow; its refusals, its
  comparison and its retry are driven red in the build by its test).

**Tests first** (`test-data-api.mjs`, connecting nowhere): equal values, no problem; each field differing, named;
`null` declared against a number deployed, and the reverse; `--set` sends only what differs and nothing when equal;
a `--set` whose second read still differs is a problem; the declared file with a pool of 0, an idle time of 61, a
string, a missing key and an extra key, each refused; the command with no project, no file and no token, each exit
2; a 500 then a 200 is retried; a 403 is thrown at once; the token appears in no output. The real
`instances/divided-world/data-api.json` validates. **Red run:** the test fails at the missing module. Record it.

## Task 6. The release runs it, the guard holds the step, and the README says why (§3)

Model: sonnet

**Files:** `.github/workflows/release.yml` (the `functions` job, which already names `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_PROJECT_REF`), `tools/check-release-workflows.mjs` and `tools/test-release-workflows.mjs`, `README.md`
("Deploying Divided World": a part of step 2 or a step of its own after it, and "9. After the first deploy"). Read
first: the header of `tools/check-release-workflows.mjs` (R10 to R14) and how its test poisons a rule.

**What:**
- The `functions` job gains a step, before the functions deploy, that runs `node tools/check-data-api.mjs --project
  "$SUPABASE_PROJECT_REF" --declared instances/divided-world/data-api.json --set`, the two secrets through `env:`
  as R11 requires.
- A new rule, the next free number (R15 when this was written): `release.yml` runs `tools/check-data-api.mjs`
  exactly once, with `--set` and a `--declared` file that exists, in a job that names `environment: production`, and
  no other workflow runs it. The check's header gains the rule in the words of its neighbors.
- README: what the pool is and why it is declared (a page's plan is kept on its connection, so a connection has to be
  used again; each connection holds about 26 MB of kept plans and a planning needs about 105 MB for a moment), the
  arithmetic for choosing a pool on a larger compute size or `null` for automatic (§3), that the release sets it
  every night from `instances/divided-world/data-api.json`, and the two settings a self-hosted Supabase gives
  PostgREST instead (`db-pool`, `db-pool-max-idletime`). American English; the paths it names must exist
  (`tools/check-doc-references.mjs`).

**Tests first** (`test-release-workflows.mjs`): poisons for the new rule, each its own case: the step removed; the
step without `--set`; a second workflow that runs the tool; the step in a job that does not name production; a
`--declared` path that does not exist. **Red run** recorded with the rule added to the check and the step not yet in
the workflow.

## Task 7. The budget on a cold read (§6)

Model: sonnet

**Files:** a new `supabase/tests/e2e/0028-cold-read-budget.ts` (the next free number when this was written; take
main's next if it is taken), and `supabase/tests/e2e/0016-screen-reads.ts` (export the rule that names the screen
functions, so the two files read one list). Read first: `0016-screen-reads.ts` (how screen functions are found and
how its poisons are made and removed), `supabase/tests/e2e/psql-db.ts` (`sql`: each call is one psql, so one fresh
connection), `supabase/tests/setup/fixtures.sql` (`tests.account`, `tests.character`, `tests.thread`, `tests.post`,
`tests.act`, `tests.become`, `tests.unbecome`), and a test under `supabase/tests/` that calls each page function, for
its arguments.

**What:**
- `0016` exports the names of the screen functions as it finds them today (`boot`, names ending `_page` but not
  `NOT_SCREEN_FUNCTIONS`, and `SEARCH_READS`); its own check reads the same export.
- The fixture, made once and committed by the file: two accounts, three characters, a thread of twenty posts with
  five card plays, an admin where a page needs one, and whatever else each page's call needs to answer a document
  rather than a refusal.
- `kept(call)`: one `sql()` call, so one fresh connection, that reads `sum(total_bytes)` from
  `pg_backend_memory_contexts` as the harness's superuser, then in a transaction becomes the fixture's account, makes
  the call once and unbecomes, then reads the sum again, and answers the difference in bytes.
- `BUDGETS`: for each screen function, its call and its budget in megabytes to one decimal. The budget is the figure
  measured on the Postgres the suite's workflow pins, rounded up to the next half megabyte. On this session's
  machine (17.11) a connection held 18.3 MB after thread_page; the build records its own measurements for all of
  them in the task's record.
- `budgetFaults(names, budgets, measured)`: one line for each fault: a screen function with no budget; a budget for
  a name that is no screen function; a measurement over its budget; a measurement more than a tenth under its budget
  (the budget is to be lowered). The test asserts no faults and prints every measurement, so a red run names the
  figures.
- The file fails, before measuring, on a Postgres whose major version is not 17, saying the budgets were recorded on
  17.
- **The poisons** (each made in the scratch database and removed in a `finally`, as 0016's are): a plpgsql function
  with `plan_cache_mode = force_generic_plan` whose one statement reads `acts_public` thirty times, measured and
  judged against thread_page's budget, must be named as over; `budgetFaults` given a screen function with no budget,
  a budget with no function and a measurement far under its budget must name each.

**Tests first:** the poisons and `budgetFaults` cases are written and seen red (no `kept`, no budgets) before the
measurements are recorded. `npm run test:sql` with `DATABASE_URL` on localhost runs it. Record the red and green
runs, and the table of measurements.

## Review focus

- **The pool is two for writes as well.** Every Edge Function and schedule that calls the Data API shares the two
  connections with the players' reads. Check what the longest call holds one for (a play, a settlement step, an
  export) and what a read does behind it: it waits up to the API's ten-second acquisition limit, and the router's own
  limit is twenty.
- **A cold load's fan-out.** A first page load sends about six reads at once and Realtime's own checks beside them;
  with two connections they queue. Measured once in the design session (§2) as no slower; check it holds with a
  second tab open.
- **The gate and the screens that load on mount.** Only reads ahead use the gate. Confirm nothing that a screen needs
  in order to draw was routed through `prefetch` or `early` and now waits behind a hover.
- **A waiting read whose trigger unmounts.** A `Link` or card button removed while its read waits must withdraw, or
  the gate later starts a read for a trigger that is gone.
- **Touch.** A tap is a pointer down, so it reads at once. Check a phone never leaves a read waiting at the gate that
  nothing will withdraw (a pointer enter with no leave).
- **The budget's figures across machines.** They were identical run to run on one machine. If the workflow's Postgres
  and a developer's 17 differ by more than the tenth the file allows, the budgets are the workflow's, and the file
  says how a developer reads the difference.
- **The management API's field names** (`db_pool`, `db_pool_max_idletime`) were read from Supabase's reference, not
  from a call. The first release that runs Task 6 is where they are proven; its failure must name the API's answer.
- **What the release's `PATCH` does to requests in flight.** It is sent only when a value differs, so on most nights
  never. On the night it is sent the API's pool restarts; check the release's later jobs do not call the Data API in
  that moment and fail.
- **The masks.** A read waiting behind another on a pool of two says only that the instance is busy. Confirm no
  response's time now differs with who owns a character or who reacted: the gate and the pool never read either.
