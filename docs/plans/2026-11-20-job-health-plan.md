# Job health: the plan

Record, written 2026-11-20. Carries out `docs/plans/2026-11-20-job-health-design.md` (issue #653). Nine tasks, in order,
each test first with its red run. Everything is engine, SQL, the shared function code and the tools; Divided World
supplies only its `jobGraceMinutes` values. The migration is `0379_job_health.sql`; if main has taken that number by
the time the build starts, take the next free one and rename its test to match.

Words used below: a **job** is a pg_cron job named `kayfabb-*`; a **function job** posts to an Edge Function, a **SQL
job** runs a SQL function; a **good run** is one that finished and answered (design, section 1).

## Task 1. One reading of cron, the job list, and the health in the engine

Model: sonnet

- **Move** `tools/rehearse/cron.ts` to `engine/rules/cron.ts` and `tools/rehearse/cron.test.ts` to
  `engine/rules/cron.test.ts` (`git mv`, header comments kept and updated to the new place). Every importer
  (`grep -rn "rehearse/cron\|from \"./cron.ts\"" tools`) imports the engine's. The engine's file imports nothing outside
  `engine/rules/`.
- **Add** `lastDue(expr: string, at: Date): Date | null` to `engine/rules/cron.ts`: the latest minute `<= at` (to the
  minute, seconds dropped) the expression matches, or null when none in the 366 days before `at`. It walks back by day
  and, within a matching day, takes the latest matching hour and minute, so a daily or monthly schedule costs at most a
  few hundred steps, not a minute-by-minute walk. Tests first, red against a stub that returns `null`: `* * * * *`,
  `*/5 * * * *`, `41 * * * *`, `17 8 * * *` (before and after 08:17 on the same day), `23 9 * * *` across a month end,
  `0 0 29 2 *` (a leap day, found four years back or null within 366 days), both day fields restricted (cron's "either"
  rule), and `at` exactly on a due minute (it is that minute).
- **New** `engine/rules/jobs.ts`:
  - `JOBS`: a frozen list, in name order, of `{ name, fn, about, defaultGraceMinutes }` for the ten jobs (design,
    section 0): `name` (`'kayfabb-conceal'` …), `fn` (the function's folder name, or `null` for a SQL job), `about` (the
    Jobs page's plain words: "Hides quotes of hidden posts", "Sends moderation mail", "Writes the words of cards that
    write", "Files Mod Bots' visits and judges reports", "Settles Aura", "Holds the Boss's daily meeting", "Posts the
    Mod Bots' chatter", "Lands The System's moves", "Rebuilds the search index", "Counts thread views"), and the
    defaults of the design's section 2 table. `type JobName = (typeof JOBS)[number]['name']`.
  - `interface JobRow { job: string; schedule: string | null; active: boolean; firstSeen: string | null; lastOkAt:
    string | null; grace: Readonly<Record<string, number>> | null }` (what `job_status()` returns, task 2).
  - `interface JobHealth { job: JobName; scheduled: boolean; stopped: boolean; since: string | null; missed: string |
    null; missedRuns: number }`. `since` is the reference (`lastOkAt`, else `firstSeen`, else null); `missed` the first
    due time after it; `missedRuns` how many due times fell between the reference and `at - grace`, capped at 99.
  - `jobHealth(rows: readonly JobRow[], grace: Readonly<Record<string, number>>, at: Date): JobHealth[]`, pure, one
    entry per `JOBS` entry in its order. A job with no row, a null schedule or `active: false` is `scheduled: false,
    stopped: true`. Otherwise it is stopped when `lastDue(schedule, at - grace)` is after the reference, and a job with
    no reference at all is stopped. The grace for a job is the row's `grace[job]`, else the argument's `grace[job]`,
    else `defaultGraceMinutes`.
  - `stoppedJobs(health)`: the stopped entries, for the strip and the marker.
- **Tests** (`engine/rules/jobs.test.ts`), first, red against a `jobHealth` that returns every job running: each
  schedule shape at the bound's edges (a conceal run at 14:02 is running at 14:12:59 and stopped at 14:13 when due each
  minute, grace 10); a run one minute past the grace reads stopped (the design's poison); a run exactly at the latest
  due time reads running; settle's first missed run is the 08:17 after `lastOkAt`; a never-run job measured from
  `firstSeen`; a missing row and an inactive row are not scheduled; the row's grace beats the argument's, which beats
  the default. Then drop `grace` from the comparison in a scratch copy and record that a case fails, in the PR.
- **Settings.** `Settings` (`engine/rules/types.ts`) gains `jobGraceMinutes: Readonly<Record<string, number>>`;
  `settingsProblems` (`engine/rules/instance.ts`) refuses a key that is not a `JOBS` name and a value that is not a
  whole number from 1 to 1440, in the shape of the other keyed settings' messages. Divided World
  (`instances/divided-world/settings.ts`) states all ten values of the design's table. Every settings fixture the type
  check then names gains the key (`engine/rules/instance.test.ts`, `engine/rules/actions.test.ts` and any others it
  names). A case in `instance.test.ts` per refusal, red first.

## Task 2. `job_runs`, the reads, and the SQL jobs' heartbeats

Model: sonnet

Files: `supabase/migrations/0379_job_health.sql`, `supabase/tests/0379-job-health.sql`,
`supabase/tests/setup/auth-shim.sql`.

- **The shim** gains `cron.job_run_details` in the deployed shape (design, section 0), and `cron.job` gains the
  deployed columns it lacks (`nodename`, `nodeport`, `database`, `username`), each nullable. A comment says the shape
  was read from the deployed database on 2026-11-20.
- **`job_runs`** as the design's section 1 states it; RLS on with no policy; no grant to `anon` or `authenticated`.
  The migration inserts a row for every `kayfabb-%` job in `cron.job` (`on conflict do nothing`).
- **`record_job_run(job text)`**: `security definer`, upserts `last_ok_at = now()` (and the row, if it is the first);
  execute granted to `service_role` only. It refuses a name not matching `^kayfabb-[a-z-]+$`.
- **`job_status()`**: `security definer`, `stable`, granted to `anon` and `authenticated`. One row per job in the
  union of `cron.job` names matching `kayfabb-%` and `job_runs` names: `job, schedule, active, first_seen, last_ok_at,
  grace`, where `grace` is the `jobGraceMinutes` settings row's value read from `settings` directly (null when there is
  no row; never `setting()`, which raises). It reads nothing else.
- **`admin_jobs()`**: refused for a caller who is not an admin, as `admin_reports` refuses (0342). `job_status()`'s
  columns plus, per job, the last `cron.job_run_details` row's `status, return_message, start_time`, and two booleans
  for whether `vault.decrypted_secrets` has a non-empty `kayfabb_functions_url` and `kayfabb_jobs_key` (the same two
  for every row). It never returns a secret's value.
- **The SQL jobs record.** Redefine `schedule_system_tick()`, `schedule_search_rebuild()` and `schedule_view_counts()`
  with commands `select public.system_tick(); select public.record_job_run('kayfabb-system-tick');` and likewise, keeping
  each schedule expression exactly as the function it replaces reads it, and call each with the guard the original
  migration used (`where exists (...)` for the tick and view counts, as 0048 and 0018 did).
- **Tests first**, red against the migration with `job_runs` and the functions stubbed: `record_job_run` sets and
  moves `last_ok_at`; a second job's call leaves the first's row alone; `job_status()` as `anon` returns the ten jobs
  with the settings row's grace and null when the row is deleted; `admin_jobs()` as a player is refused and as an
  admin returns the last run row and the two Vault booleans (true, then false with the shim's secret deleted); each
  SQL job's `cron.job.command` runs its work before its record (poison: the record placed first in a scratch command
  must fail the case that reads the order) and names its own job.
- Add `job_status` and `admin_jobs` to `ALLOWED_RPCS` (`tools/check-web-reads.mjs`) in task 5, when the web first
  calls them.

## Task 3. Every function job records through `asJob`

Model: sonnet

- **New** `supabase/functions/_shared/job.ts`: `asJob(job: JobName, handle: Handler): Handler`, where `Handler` is
  `(request: Request, deps: JobDeps) => Promise<Response>`. It awaits `handle`; on a 200 it calls
  `deps.db(environment(deps.env)).rpc('record_job_run', { job })` and returns the answer; when that call throws it logs
  "job health not recorded" with the job and answers 500 `{ error: 'the run finished but its heartbeat was not
  recorded' }`. Any other status is returned untouched and records nothing. `JobName` is the engine's (task 1).
- **Wrap** each `handle`: `supabase/functions/{settle,meet,chatter,staff,write}/handler.ts` export
  `handle = asJob('kayfabb-<name>', async (request, deps) => { … })` with the body unchanged.
- **conceal and mail gain a `handler.ts`.** Move the body of `supabase/functions/conceal/index.ts`'s `Deno.serve` into
  `supabase/functions/conceal/handler.ts`, reading the database through `deps.db(env)`; its `index.ts` becomes the
  one line the others hold. The same for mail, with what it reaches outside the database coming through `JobDeps`:
  add `mailer: (env: (name: string) => string | undefined) => Mailer` and `authAdmin: (o: { url: string; key: string })
  => AuthAdmin & { address(account: string): Promise<string> }` to `JobDeps` (`_shared/handler.ts`), with
  `deployedDeps` giving `resendMailer` and `authAdmin`. Both handlers are wrapped in `asJob`.
- **The rehearsal runs them.** Delete `tools/rehearse/conceal.ts` and `tools/rehearse/mail.ts`; `REHEARSAL_OWN` in
  `tools/rehearse/dispatch.ts` is removed and the dispatcher imports every function's `handler.ts`. The rehearsal's
  `JobDeps` (`grep -rn "JobDeps" tools/rehearse`) supplies the recording mailer, the recording Auth admin and
  `standInAddress` that `tools/rehearse/mail.ts` held, moved there with their comments.
- **Tests first** (`supabase/functions/_shared/job.test.ts`), red against an `asJob` that returns `handle` unchanged:
  a 200 records once with the job's name; 400, 401 and 500 record nothing; a record that throws turns a 200 into a 500
  with the body above. The existing handler tests of the seven functions stay green, with their database stand-ins
  answering `record_job_run`; a conceal and a mail handler test, each moved from the twins' coverage if any, run the
  real `handle`.
- `tools/check-edge-functions.mjs`'s E5 reads a function's own non-test `.ts`, so `fromTheService(` in the new
  `handler.ts` files keeps it green; run it.

## Task 4. The build check holds the heartbeats and the job list

Model: sonnet

Files: `tools/check-edge-functions.mjs`, `tools/test-edge-functions.mjs`.

- **E6.** Every function job's function has, in its own non-test `.ts` (comments removed and strings emptied, as E5
  reads), a call `asJob(` whose first argument is the string literal of the job that posts to it; every SQL job's
  command calls `record_job_run('<its own name>')` after its first statement. A command is a SQL job's when it names
  no function (as today's reading already decides).
- **E7.** `problems(files, { jobs, grace })` takes the engine's `JOBS` names and Divided World's `jobGraceMinutes`
  keys (the CLI imports both, `engine/rules/jobs.ts` and `instances/divided-world/settings.ts`). Every scheduled job is
  in `jobs`, has a `grace` key, and is named by an `insert into job_runs` in some migration; every `jobs` entry is
  scheduled.
- The header lists E6 and E7 with E1 to E5 and says why: a job that never records reads stopped for ever, and a job
  the engine does not list is never watched.
- **Cases first**, red with `problems()` stubbed to `[]`, then with the real check before the rules are added:
  `asJob` removed from conceal's handler (poison); `asJob('kayfabb-mail', …)` in conceal's handler; `asJob` named only
  in a comment; a SQL job recording another job's name; a SQL job recording before its work; a planted `kayfabb-ghost`
  schedule with no `JOBS` entry, no grace and no `job_runs` row (three complaints, poison); a `JOBS` entry with no
  schedule. The real files pass. Record each red run in the PR.

## Task 5. The reads reach the screens

Model: sonnet

- `KayfaApi` (`engine/ui/data/api.ts`) gains `jobStatus(): Promise<readonly JobRow[]>` and `adminJobs():
  Promise<AdminJobs | null>` (null for a caller who is not an admin, as the reports page is), with `AdminJobs` holding
  each row's `job_status` columns, `lastRun: { status: string; message: string | null; at: string } | null`, and the
  page-wide `vault: { functionsUrl: boolean; jobsKey: boolean }`.
- `web/src/data/supabase.ts` calls `job_status` and `admin_jobs`, mapping snake case as its neighbours do;
  `engine/ui/data/fake.ts` answers both from a world that holds rows, with a way for stories and tests to stop a job
  and set its last run. Add both RPC names to `ALLOWED_RPCS` (`tools/check-web-reads.mjs`).
- **New** `engine/ui/jobs/useJobHealth.ts`: `useJobHealth(): readonly JobHealth[] | null`, reading `jobStatus()` at
  most once a minute for the whole page (one shared cache, as other screen reads share theirs), computing with
  `jobHealth(rows, settings.jobGraceMinutes, new Date(api.now()))`, and recomputing each minute from the cached rows.
  A failed read gives `null` and the screens show nothing late: the read failing is never a reason to say a job
  stopped. `useJobLate(job: JobName): JobHealth | null` returns the entry when it is stopped.
- Tests first: the hook reads once for two consumers in one minute and again after a minute; a failed read yields
  null; a stopped fake job is returned by `useJobLate`.

## Task 6. The Jobs page, the strip and the marker

Model: sonnet

Read `engine/ui/admin/Reports.tsx` and `engine/ui/admin/Machine.tsx` first; the page follows them (design, section 7).

- **Route and nav.** `GLASS_NAV.adminJobs = '/admin/jobs'` (`engine/ui/glass/nav.ts`); a route in
  `engine/ui/glass-routes.tsx` beside `/admin/trophies`; `AdminPage` gains `'jobs'` and `AdminPages` a "Jobs" button
  after Trophies.
- **New** `engine/ui/admin/Jobs.tsx` and `jobs.css`: the page of the design's section 7, from `adminJobs()` and
  `jobHealth`. Its rows in the order stopped first, then by name. Schedule words: "every minute", "every 5 minutes",
  "hourly at :41", "daily at 08:17" for the shapes the instance uses, and the expression itself for any other. The
  diagnosis line: pg_cron's last status, time and message, with `1 row` read as "a request was sent" and any other row
  count, for a function job, as "no request was sent"; the two Vault names "present" or "missing"; "scheduled, active",
  "scheduled, inactive" or "not scheduled". The next-step sentence, chosen in this order: not scheduled, "The job is
  not in cron.job: run the migrations (README, the release steps)."; a Vault name missing, "Add the missing Vault entry
  (README, Give the jobs their address and key)."; no request sent, "The job's command sent nothing: check both Vault
  entries have values."; pg_cron failed, "pg_cron could not run it: the message above is why."; otherwise, "The request
  is sent and the function never answers well. Look at <fn>'s log in Supabase." (SQL jobs: "The command runs and fails
  or never finishes: the message above is why.")
- **The strip.** `AdminPages` reads `useJobHealth()` and, while any job is stopped, shows above its buttons "1 job has
  stopped: conceal, since 14:02." ("2 jobs have stopped: conceal, mail." for more, names in `JOBS` order, the earliest
  `since`), linking to Jobs, in a `CalmRegion` with `role="status"`.
- **The marker.** The Admin tab (`engine/ui/glass/MenuBar.tsx`, `ADMIN`) shows a small mark while any job is stopped,
  and its accessible name becomes "Admin, 1 job stopped". The mark is the glass's existing alert mark if there is one
  (read the Alerts tab first); otherwise a dot in the alert color with its border contrast checked
  (`engine/ui/glass/border-contrast.ts`).
- **Tests first** (`Jobs.test.tsx`, `AdminPages` and `MenuBar.test.tsx` cases): all running ("All 10 jobs are
  running."); one stopped with each diagnosis branch's sentence; a player told it is an admin's; the strip absent with
  none stopped and present with one; the marker's accessible name. Stories: `Jobs.stories.tsx` (admin, all running;
  one stopped; a player) and a `.board.stories.tsx` as the other admin pages have.

## Task 7. The waiting states say they are late

Model: sonnet

- **New** `engine/ui/jobs/LateNote.tsx`: `<LateNote job lead>` renders, when `useJobLate(job)` is stopped, a glass note
  (`role="note"`, the class `ConcealingNote` uses) of the `lead` sentence and, unless told not to, "Nothing is lost, and
  it catches up as soon as the job runs again. The admins can see this." Times are the screens' short time
  (`engine/ui/postbit/dates.ts`); "has not run since <time>" becomes "has not run yet" when `since` is null.
- **conceal**: `ConcealingNote` (`engine/ui/conduct/Hidden.tsx`) says "Part of this post quotes a post an admin hid.
  It will show again within a few minutes." and, past the bound, the design's conceal sentences. Both callers
  (`engine/ui/thread/Post.tsx`, `engine/ui/thread/lines.tsx`) are unchanged.
- **write**: where a play's text is `waiting` (`engine/ui/cards/written.ts`), the engine draws the late note under the
  post's content area, never inside an instance's effect, with the design's write sentence. Find the engine component
  that draws a written card's effect and its waiting state; the instance's effect (`instances/divided-world/cards/
  you-were-saying/Effect.tsx`) does not change.
- **staff**: `engine/ui/cards/Visit.tsx`, under the "time is up" facts, the design's staff sentence.
- **settle**: `engine/ui/frame/Hud.tsx`, under "Next settlement", the design's settle sentence, with the time of
  `missed`.
- **admin queue**: `countdown` (`engine/ui/admin/Queue.tsx`) stays pure; where it is shown for a move whose time has
  come, the queue shows "Late: the tick that lands moves has not run since <time>." when the tick is stopped.
- **mail**: `engine/ui/admin/Reports.tsx`, above its groups, the design's mail sentence when the mail job is stopped.
- **Tests first**, each red before its note: each screen with its job stopped in the fake shows its sentence, and with
  it running shows none; conceal's "within a few minutes" in both. Update the stories and tests that assert "It will
  show again in a moment" (`grep -rn "in a moment" engine instances e2e`).

## Task 8. The rehearsal shows the parts together

Model: sonnet

- **New** `tools/rehearse/database/job-health.test.ts`, run by `npm run test:rehearse` (it needs Postgres and
  libfaketime, as its neighbours do). A short scenario (one day is enough; the smallest the rehearsal accepts) whose
  dispatcher `handlers` (`DispatchCtx.handlers`, `tools/rehearse/dispatch.ts`) are the real ones, except conceal's,
  which answers 503 without running between minutes M and M+30 (M after a post quoting a hidden post is made; plant
  one if the scenario does not).
- It asserts, reading `job_status()` and computing `jobHealth` at the simulated time: up to M+10 conceal is running;
  from M+11 to M+30 it is stopped since its last good run and every other job is running; the quote is concealing
  throughout; after M+30 the next run clears it, its layer exists, and conceal reads running.
- **Poison:** the same run with `record_job_run` replaced by a no-op in the test's database reads every function job
  stopped once grace has passed. Record both runs in the PR.

## Task 9. The hourly check, its test, the workflow and the README

Model: sonnet

- **New** `tools/check-job-health.mjs --db <postgres URL>`, modelled on `tools/check-deployed-migrations.mjs` (read
  its header and reuse its URL refusal, `scrub()`, the password through psql's environment, and its retry of a
  transport failure: three attempts, the pause doubling). It reads `select * from job_status()`, computes `jobHealth`
  with the engine's `JOBS` and Divided World's `jobGraceMinutes`, and exits 1 naming each stopped job with its
  `since`, and each job in `JOBS` missing from the deployed `cron.job`. It prints the host it read, never the URL.
  A server that answered and refused, or a query error, is exit 1 at once, not retried.
- **New** `tools/test-job-health.mjs`, in `STEPS` (`tools/build.mjs`), test then nothing: the check is outside the
  build and gets an `OUTSIDE_THE_BUILD` entry worded as `check-deployed-migrations`'s is. Cases, red first with the
  check's comparison stubbed: a stopped job (exit 1, named); a job missing from `cron.job` (exit 1); all running
  (exit 0); `localhost`, `127.0.0.1`, `::1` and a URL with a `host=` parameter refused; the URL never printed; a
  transport failure retried and, when it outlasts the retries, reported as a failure to read, never as a stopped job.
  `test-build-steps.mjs` refuses a `STEPS` entry git does not track, so the new files and the `STEPS` line land in one
  commit.
- **New** `.github/workflows/job-health.yml`: `schedule: cron: '7 * * * *'` and `workflow_dispatch`; one job in the
  `production` Environment, Node 22, `npm ci`, then `node tools/check-job-health.mjs --db "$SUPABASE_DB_URL"` with the
  secret in `env`. A comment says it is apart from Release so a stopped job never holds a release, and that GitHub's
  failed-run email is the alert. If `tools/check-release-workflows.mjs` holds every workflow's shape, extend it.
- **README.** Section 6's "Check the schedules" lists all ten jobs and points at the Jobs page and the workflow; the
  relaunch section says a new project's check reads every job "never run" and red until both Vault entries exist.
- The design's Open item "one Act that fails every run" is #854, filed by the design session; nothing here builds it.

## After the tasks

The PR says `Closes #653`. The owner merges. After the first nightly Release that carries it, the owner dispatches
`job-health.yml` once and reads that it is green, which is the live check of the diagnosis and status reads (#130's
kind of check, done by the workflow itself).

## Review focus

- What the migration does to a database already running: `job_runs` rows begin at the migration's minute, and the
  function jobs record only once the new functions deploy; Release pushes the schema, then the functions, inside the
  ten-minute grace (#735 is the order's issue). A gap past the grace would read stopped and the hourly check red.
- The three rescheduled SQL jobs: each schedule expression and guard kept exactly; a run that throws records nothing;
  a settings change that reschedules them (`settings_reschedule_*`) keeps the record.
- `asJob` around every handler: a 200 that is not a good run (a handler that swallows its error and answers 200) would
  read healthy; read each handler's catch.
- `job_status()` is open to `anon`: it must read nothing but `job_runs`, `cron.job` and the one settings row, and
  `admin_jobs()` must never return a Vault value.
- The public read at a busy instance: one shared cache per page, at most one call a minute, and a failed read never
  shown as a stopped job.
- `lastDue` against pg_cron's own reading for every expression the settings validator accepts (UTC, both day fields
  restricted), since a wrong due time reads a healthy job stopped or a stopped one healthy.
- mail's move to `handler.ts`: the Resend key and the Auth admin are read where they were, and never logged.
