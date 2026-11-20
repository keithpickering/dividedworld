# Job health: a stopped scheduled job is bounded, named to admins and said on the screens that wait on it

Record, written 2026-11-20. A design session with the owner, for issue #653 ("No player is ever stuck"). The plan is
`docs/plans/2026-11-20-job-health-plan.md`.

## 0. What was found

**Ten jobs, not five.** Seven post to an Edge Function through pg_net: `kayfabb-settle`, `-meet`, `-chatter`,
`-staff`, `-write`, `-mail` and `-conceal`. Three are plain SQL: `kayfabb-system-tick` (0048), `kayfabb-search-rebuild`
(0117) and `kayfabb-view-counts` (0018). Each job's work stays due when a run fails, so the first run that gets through
clears the backlog. Nothing bounds the wait when no run gets through, and nothing tells anyone.

**The job's own records cannot say whether a run worked.** The deployed database was read with the owner's permission,
read only, on 2026-11-20 at 13:03 UTC (no Vault value was read, only whether the two names exist):

- `cron.job_run_details` reads `succeeded / 1 row` for every run of every job. `net.http_post` only queues a request,
  so pg_cron's success means "a request was queued" and never what the function answered. A job whose Vault entries
  are missing selects no row, sends nothing, and still succeeds.
- `net._http_response` held 1,154 responses, all 200, from 07:04 on: `pg_net.ttl` is `6 hours`. The table has no URL
  and no job name (`id, status_code, content_type, headers, content, timed_out, error_msg, created`), and the queue
  row that held the URL is deleted once sent. With seven jobs posting each minute, a 401 cannot be tied to a job.
- The real shapes, which the SQL suite's shim follows from now on: `cron.job (jobid, schedule, command, nodename,
  nodeport, database, username, active, jobname)` and `cron.job_run_details (jobid, runid, job_pid, database,
  username, command, status, return_message, start_time, end_time)`.
- All ten jobs were active and current, none failed in a day, and both Vault names were present.

**Nothing reads these tables today, and no admin page shows a job.** The admin pages are Moves, Reports, The machine
and Trophies (`engine/ui/admin/AdminPages.tsx`). `view_count_runs.ran_at` (0018) is the only "last ran" any job leaves.

**There is no single place every job function passes through.** Five functions (settle, meet, chatter, staff, write)
export `handle(request, deps)` from a `handler.ts` and share `JobDeps` (`supabase/functions/_shared/handler.ts`).
`mail` and `conceal` call `Deno.serve` inline, and the rehearsal keeps a Node twin of each
(`tools/rehearse/mail.ts`, `tools/rehearse/conceal.ts`) that copies their wiring.

**What each waiting state shows today.**

| State | Today | Job |
|---|---|---|
| A post quoting a hidden post | "Part of this post quotes a post an admin hid. It will show again in a moment." (`engine/ui/conduct/Hidden.tsx`) | conceal |
| A card's words | a typing cursor; "… is still writing." to a screen reader (`engine/ui/cards/written.ts`, the waiting state) | write |
| A Mod Bot's visit whose time is up | "The time is up, so it files at the next check …" (`engine/ui/cards/Visit.tsx`) | staff |
| The HUD's next settlement | the time quietly moves on to the next window (`engine/ui/frame/Hud.tsx`, `next_settlement_at`) | settle |
| A move overdue to land, in the admin queue | "ANY MINUTE NOW" (`engine/ui/admin/Queue.tsx`, `countdown`) | system-tick |
| Mail | the Reports page names mail held for a missing reply-to address; queued mail shows nowhere | mail |

meet, chatter, search-rebuild and view-counts have no screen that waits on them.

## 1. Decided: a job writes its own heartbeat (Q1)

**"The job ran" means the job said so: each run that finishes and answers writes the time into `job_runs`.**

- `job_runs (job text primary key, first_seen timestamptz not null default now(), last_ok_at timestamptz)`, one row per
  job, updated in place by `record_job_run(job)`, as `view_count_runs` is. It is not an Act ("Append-only" is about
  Acts) and keeps no history: pg_cron's own table is the history.
- A function job records through one wrapper, `asJob(job, handle)` in `supabase/functions/_shared/job.ts`: it runs
  the handler and, when the answer is 200, calls `record_job_run`. All seven functions export a `handle` wrapped in it.
  `mail` and `conceal` gain a `handler.ts` like the other five, the rehearsal's twins of them are deleted, and
  `JobDeps` gains what mail needs from outside (the mailer and the Auth admin), so the rehearsal runs the same code
  the deploy does.
- A SQL job records in its own command: the three are rescheduled as `select public.<work>(); select
  public.record_job_run('<job>');`, one transaction, so a run that throws records nothing. The big functions they call
  are not redefined.
- A good run is one that answered: one with nothing to do, one that found the System off, and a tick that skipped
  because another held its lock all count. Each proves the chain (pg_cron, Vault, pg_net, the gateway, the key, the
  function, the database) is whole.
- A failure to write the row is a database error, thrown at once, and the function answers 500 ("Three unrelated
  timeouts are not a poison pill"): a heartbeat that cannot be written must not read as health.
- `first_seen` is when the row began. The migration inserts one for every job; a later migration that schedules a new
  job inserts its row too, which the build check holds (section 6). It is what a job that has never run is measured from.

**Alternatives weighed.**

- **The issue's reads, made attributable.** Each job's command would write `net.http_post`'s request id into a table,
  joined later to `net._http_response`. It keeps pg_net's word as the truth, but it is tied to pg_net, needs a copy
  taken before the six-hour TTL, says nothing about the SQL jobs, and the suite could only test it against its
  stand-ins. Rejected.
- **Both as equals.** Healthy only with pg_net's 200 and the heartbeat. A 200 with no heartbeat cannot happen once the
  wrapper writes it, so it doubles the machinery for nothing. Rejected.

pg_cron's and the Vault's words stay, as the diagnosis an admin reads (section 3), never as the health itself.

## 2. Decided: the bound is measured from the job's own schedule (Q2)

**A job is stopped when a time it was due is more than its grace in the past and no good run has been recorded since
then.**

- The schedule is the deployed one, `cron.job.schedule`; a job the engine lists that is not in `cron.job`, or is
  inactive, reads as not scheduled, which is stopped.
- The reference is `last_ok_at`, or `first_seen` for a job that has never run. A job is stopped at `at` when the
  latest due time `d` with `d <= at - grace` is after the reference. It is stopped since the reference, and the run it
  missed first is the first due time after the reference.
- The grace is a setting, `jobGraceMinutes`, an object keyed by job; the engine lists the jobs and their defaults, and
  Divided World states its own values:

  | Job | Schedule | Grace |
  |---|---|---|
  | conceal, mail, write, system-tick, search-rebuild | every minute | 10 minutes |
  | staff | `filingCron`, every 5 minutes | 15 minutes |
  | view-counts | `viewCountCron`, hourly at :41 | 30 minutes |
  | settle, meet, chatter | daily | 30 minutes |

- The health is computed in pure TypeScript, `jobHealth(rows, grace, at)` in `engine/rules/jobs.ts`, from the rows
  SQL returns. It needs to know when a cron expression was last due, and there is already one reading of cron, the
  rehearsal's matcher (`tools/rehearse/cron.ts`, built to the grammar `engine/rules/instance.ts` accepts). It moves to
  `engine/rules/cron.ts`, gains `lastDue(expr, at)`, and the rehearsal imports it: one reading of cron, not a second
  one in SQL. (The confirmed outline said `job_health(at)` in SQL; this keeps the same answer and moves its arithmetic
  to the engine, so the cron grammar is never read twice.)
- SQL reads the grace from the settings row without raising when the row is missing, and the engine's defaults stand
  in. A release serves the functions before it seeds (#735), so a key a function or a screen needs before the seed must
  not break it.

**Alternatives weighed.** A multiple of each job's interval since its last run (three intervals and five minutes) is
simpler and needs no cron reading, but a daily job is then noticed after about three days, and a missed settlement
goes unsaid for that long. One flat bound for every job fits none of the daily ones. Rejected.

## 3. Decided: admins see it on a Jobs page, on every admin page, and off the instance (Q3)

**A Jobs page, a strip on every admin page while a job is stopped, and an hourly GitHub check that emails the owner.**

- **The Jobs page**, a glass page at `/admin/jobs`, "Jobs" in the admin pages' strip after Trophies. Its brief is
  section 7.
- **The strip.** While any job is stopped, `AdminPages` shows a plain line over its buttons on every admin page: "1 job
  has stopped: conceal, since 14:02." with a link to Jobs. The Admin tab of the menu bar gains a marker, and its
  accessible name says how many jobs have stopped.
- **`job-health.yml`**, an hourly workflow in the `production` Environment, reusing `SUPABASE_DB_URL`, runs
  `tools/check-job-health.mjs --db`. It goes red when a job has stopped, or when a job the repository schedules is
  missing from the deployed `cron.job` (which also compares the repository with the deployed database, "A test that
  builds its own subject …"), and GitHub emails the owner. It is separate from Release, so a stopped job never holds
  the release that might fix it, and it is off the instance, so it is heard when the database or pg_cron itself is down.

Not used: mail, which goes through `kayfabb-mail`, a job that can stop; and the Updates page, which only admins write
("The fiction may lie; the log never does").

**Alternatives weighed.** The page and strip alone leave nobody told when no admin signs in, the case of an instance
whose admins are away. The page and the external check without the strip make an admin already signed in remember to
look. Rejected.

**Portable by construction.** `job_status()` and `admin_jobs()` are plain SQL a self-hosted instance answers the same
way, and the Jobs page reads them on any instance. The workflow is Divided World's deployment alone, and reads nothing
an admin page does not.

## 4. Decided: each waiting state says it is late on its own screen (Q4)

**Past its job's bound, each waiting state adds one plain glass note under its existing words; before the bound,
nothing changes but conceal's promise.**

- `job_status()` is readable by anyone, signed in or not, and returns per job only its schedule, whether it is active,
  `first_seen`, `last_ok_at` and its grace. The screens compute the health with `jobHealth` and cache the read for 60
  seconds, so it is one tiny read per minute per open page, whatever the instance's size. The note appears on the next
  page load or cache refresh, never by Realtime.
- The notes (times in the viewer's own short form, as the screens show times today):
  - **conceal**, always: "Part of this post quotes a post an admin hid. It will show again within a few minutes."
    Past the bound it adds: "This is taking longer than it should: the job that hides it has not run since 14:02.
    Nothing is lost, and it catches up as soon as the job runs again. The admins can see this."
  - **write:** "This card's words are late: the job that writes them has not run since 14:02. Nothing is lost, and
    it catches up as soon as the job runs again. The admins can see this."
  - **staff:** "Filing is late: the check that files it has not run since 14:02. Nothing is lost, and it catches up
    as soon as the job runs again. The admins can see this."
  - **settle:** "Settlement is late: it was due at 08:17 and has not run. Nothing is lost: every missed window settles
    when it runs. The admins can see this." (08:17 is the first missed run.)
  - **admin queue:** "ANY MINUTE NOW" becomes "Late: the tick that lands moves has not run since 14:02."
  - **mail**, on the Reports page: "Mail is late: the job that sends it has not run since 14:02. Nothing is lost, and
    it catches up as soon as the job runs again."
- A job that has never run says "has not run yet" for "has not run since 14:02".

**Alternatives weighed.** Replacing each state's words outright drops what they already say (what the hidden quote is)
and is more copy to approve. One banner for every player while any job is stopped tells a player about a mail job
they will never notice and puts the machine in front of everyone for a fault that touches a few screens. Rejected.

## 5. Decided: no conceal fallback (Q5)

**A stopped conceal job keeps the quoting post's words withheld; its notes and the alerts are its way out.**

The concealer empties the hidden quote with the engine's one reading of BBCode (`engine/bbcode/conceal.ts`), and
until a layer exists `acts_public` serves the words as null. Its ways out are the job running again (admins are told
on the strip and the Jobs page, the owner by the hourly check), and the author editing the quote out.

**Alternatives weighed.** Stripping every `[quote]` in SQL past the bound is a second reading of BBCode that must agree
with the engine's on nested and malformed quotes; where they disagree, what an admin hid leaks, which is worse than a
delay, and it cuts more than the layer does. Hiding the whole post past the bound is no better for readers and hides
more. Rejected.

## 6. Decided: how it is tested without a deploy, and what drives each check red (Q6)

**Four layers, each with its poison.**

1. **The SQL suite** (`supabase/tests/0379-job-health.sql`): `record_job_run`, `job_status()` and `admin_jobs()`
   against seeded rows, the shim's `cron.job` and its new `cron.job_run_details` in the real shape read on
   2026-11-20, and the three SQL jobs' commands recording only after their work. Poisons: a SQL job command with the
   record before the work must fail a case; `admin_jobs()` called by a player must be refused.
2. **The engine's unit tests** (`engine/rules/cron.test.ts`, `engine/rules/jobs.test.ts`): `lastDue` for every
   schedule shape the instance uses, and `jobHealth` at the bound's edges. Poison: a run one minute past the grace
   reads stopped, and the grace dropped from the comparison fails a case.
3. **The build check**, two rules added to `tools/check-edge-functions.mjs`:
   - **E6:** every job's function wraps its exported `handle` in `asJob('<that job>', …)` in its own non-test code,
     and every SQL job's command calls `record_job_run('<its own name>')` after its work. Poisons: `asJob` removed from
     `conceal`; a SQL job's command recording another job's name.
   - **E7:** every scheduled job is in the engine's list (`JOBS`, `engine/rules/jobs.ts`), has a `jobGraceMinutes`
     entry in Divided World's settings, and is named by an `insert into job_runs` in a migration; and every listed job
     is scheduled. Poison: a planted `kayfabb-ghost` schedule with none of these.
4. **The rehearsal** (`tools/rehearse/database/job-health.test.ts`): conceal is refused for 30 simulated minutes; from
   minute 11 `jobHealth` reads it stopped and every other job running, a quote of a hidden post is still concealing;
   the job is let through again, the health recovers and the backlog clears. Poison: the same run with `record_job_run`
   made to do nothing reads every function job stopped.
5. **The deployed read**, `tools/check-job-health.mjs --db <url>`, run only by the workflow, with
   `tools/test-job-health.mjs` in the build driving it red on stubbed answers: a stopped job, a job missing from
   `cron.job`, localhost refused in every spelling, a URL never printed, and a transport failure retried, not reported
   as a stopped job.

**Alternatives weighed.** Leaving out the rehearsal leaves nothing showing the parts work together. A real local
Supabase stack in CI (`supabase start`) adds a heavy dependency, and the one thing it would add, the shim checked
against the real tables, was done by reading the deployed database once, and is done again by the hourly check from
its first run. Rejected.

## 7. The Jobs page (the shape brief, confirmed)

- **Job and audience.** An admin, usually arriving from the strip or the Admin tab's marker, who needs to know what has
  stopped, since when, and why, in about ten seconds.
- **Direction.** The glass, plain and out of character, as Reports and The machine are: `PageHead` lead, the
  `AdminPages` strip with Jobs added, then one table. Nothing new is invented visually.
- **Layout.** Stopped jobs first, then the rest by name. A row is the job's name, what it does in plain words, its
  schedule in words, its last good run, and its state ("Running" or "Stopped since 14:02 (missed 3 runs)"). A stopped
  row adds a diagnosis line: pg_cron's last status and message for that job ("1 row" glossed as "a request was
  sent"; any other count of rows as "no request was sent", for a function job), whether `kayfabb_functions_url` and
  `kayfabb_jobs_key` exist (by name, never value), and whether the job is in `cron.job` and active; then one sentence
  of where to look next.
- **States.** All running: the lead says "All 10 jobs are running." A player who opens it is told it is an admin's, as
  Reports does. The read failing is the existing unavailable screen.
- **Out of scope.** No button reruns or reschedules a job; the page is read only, and says the fix is made in Supabase.

```
Jobs
1 job has stopped.                                   [Moves][Reports][The machine][Trophies][Jobs]
────────────────────────────────────────────────────────────────
conceal   Hides quotes of hidden posts · every minute
          STOPPED since 14:02 (last good run)
          pg_cron 14:31: succeeded, a request was sent · Vault: both entries present · scheduled, active
          → The request is sent and the function never answers well. Look at conceal's log in Supabase.
mail      Sends moderation mail · every minute          Running · 14:31
settle    Settles Aura · daily at 08:17                 Running · 08:17
…
```

## 8. The rules

- **No player is ever stuck.** One state is added, a job stopped. It ends by itself on the job's next good run, or by
  an admin fixing the cause the Jobs page names; the strip, the marker and the hourly check say it exists. Every
  waiting state that turns on a job now names, past its bound, that it is late and how it ends.
- **A response never proves a private fact.** `job_status()` reads `job_runs`, `cron.job` and the settings row;
  `admin_jobs()` adds `cron.job_run_details` and the names of two Vault entries. None reads an account, a character, a
  reaction or an address, and no timing depends on one.
- **KayfaBB never knows which instance it runs.** All of it is engine. Divided World supplies only its
  `jobGraceMinutes` values in its settings, and the workflow, which is its deployment.
- **The fiction may lie; the log never does.** Every note and the Jobs page are glass, plain, and never in character.
- **Weigh a design at the scale of a busy instance.** The jobs are fixed in number; `job_runs` is ten rows; the public
  read is one small call per open page a minute, the same with ten players or ten thousand.
- **Portable by construction.** Plain SQL and pure TypeScript; nothing reads pg_net.

## Open

- **One Act that fails every run.** conceal counts and logs a refusal for one Act and goes on, so a run that fails on
  the same Act each time still answers 200 and the job reads healthy while that post waits. The same shape exists in
  write (a play that fails without its refund) and mail (a row whose attempts keep failing, which Reports shows). An
  item's failure is not a stopped job; it is filed as #854, to be designed per job.
- **A new project before invite day.** A fresh project reads every job as never run until both Vault entries exist,
  so the hourly check is red from the deploy until the Vault is set. That is the true answer; README's relaunch
  section says so.
