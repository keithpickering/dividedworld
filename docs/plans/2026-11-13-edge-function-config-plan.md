# Every Edge Function is in config.toml, and every job's function takes the jobs key: plan

Record, written 2026-11-13. A fix built straight from its fault (issue #646, a dead end found by the final review of
PR #642), dispatched by the session that watches and merges PRs; no design session. Built in one PR from `main`
(6ec5a27c).

No migration. No deployed database, bucket or connector is touched. CLAUDE.md is not changed. One `check-*.mjs` is
added, with the self-test that drives it red.

## The problem

`supabase/config.toml` has a `[functions.<name>]` table with `verify_jwt = false` for every folder under
`supabase/functions/` except `conceal`. `supabase functions deploy` reads that file, so `conceal` deploys with the
platform's JWT check on. Its only caller is the `kayfabb-conceal` job (`schedule_conceal`,
`supabase/migrations/0341_conduct_mail.sql`), which sends the `kayfabb_jobs` secret key in `apikey` and no JWT. The
platform's check takes the legacy keys only, so the gateway refuses every call before the function runs. A post that
quotes a post hidden from quoting is then served with a null body and `concealing` true (`acts_public`, 0340) for as
long as the job is refused, and the screen says "It will show again in a moment."

## The cause

Three lists must agree, and nothing held them together:

1. the function folders under `supabase/functions/` (what a deploy uploads);
2. the `[functions.<name>]` tables in `supabase/config.toml` (how each is deployed);
3. the jobs in the migrations that post to `/functions/v1/<name>` (who calls them, and with what).

`conceal` arrived with 0340 and 0341 as a folder and a job and never got its table. Issue #173 named the gap on
2026-11-03 and proposed the check; it was not built. `mail`, added in the same change, got its table, so the miss was
one line by hand, which is the kind a check exists for ("Two lists that must agree are one list").

What was read to rule out a wider fault, on main at 6ec5a27c:

| Function | Table in config.toml | Called by a job | Takes the jobs key (`fromTheService`) |
|---|---|---|---|
| account, act, avatar, estimate, trophy-art, wardrobe | yes | no | no (a player's session, or any visitor) |
| seed | yes | no (run by hand) | yes |
| settle, meet, chatter, staff, write, mail | yes | yes | yes |
| conceal | **no** | yes | yes |

Every job's latest command sends the key in `apikey` and no `Authorization` header (0004 and 0047 sent
`Authorization`; 0071 rescheduled both). So `conceal`'s missing table is the only instance of the fault. Two documents
are stale beside it: the comment over the tables in `config.toml` lists the functions that take the jobs key without
`mail` or `conceal`, and README step 5 says "`settle`, `meet` and `seed`" for the same list.

## What is built

### Task 1: the check and its self-test

Model: sonnet

`tools/check-edge-functions.mjs` and `tools/test-edge-functions.mjs`, written like
`tools/check-release-workflows.mjs` and `tools/test-release-workflows.mjs`: an exported pure
`problems(files)` over a map of repository path to text, an exported `readFiles(root = '.')`, a CLI that prints each
problem and exits 1 on any. `files` holds `supabase/config.toml`, every `.ts` file under `supabase/functions/` and
every `supabase/migrations/*.sql`. No TOML package is installed; the tables are read by line, as
`check-release-workflows.mjs` reads `netlify.toml` (a `#` comment is not a setting).

A **function** is a folder directly under `supabase/functions/`, other than `_shared`, that holds `index.ts`. A
**job** is a `cron.schedule('<job>', …)` in a migration whose command posts to `/functions/v1/<name>`; the migrations
are read in file-name order and the last `cron.schedule` of a job name is the job (0071 replaced 0004's and 0047's
commands), and a `cron.unschedule('<job>')` after it ends the job. A `cron.schedule` whose command names no function
(`kayfabb-system-tick`) is not held to anything.

The rules, each complaint naming its rule and the function or job:

- **E1** every function has a `[functions.<name>]` table whose `verify_jwt` is `false`. A missing table, a missing
  key and `verify_jwt = true` are each a complaint.
- **E2** every `[functions.<name>]` table names a function. A table left behind by a removed or renamed function is
  a complaint.
- **E3** every job's function exists (is a function, as above).
- **E4** every job's command sends `apikey` and no `Authorization` header: the functions take the jobs key in
  `apikey` alone (`fromTheService`, `supabase/functions/_shared/serve.ts`).
- **E5** every job's function calls `fromTheService(` in a `.ts` file of its own folder that is not a test
  (`*.test.ts`): a function a job calls and that never asks for the jobs key would run for any caller, since the
  platform's check is off.
- A `files` with no `supabase/config.toml`, or with no function at all, is a complaint: a check over nothing has
  nothing wrong in it.

The self-test starts every case from the real files read from disk and breaks one thing, and its last case asserts
the real files pass. Tests first; the red cases:

| Case | Expected |
|---|---|
| `[functions.settle]` and its line deleted (the poison #173 proposed) | E1 names settle |
| `[functions.settle]` kept, `verify_jwt = true` | E1 |
| `[functions.settle]` kept, its `verify_jwt` line only in a comment | E1 |
| a new folder `supabase/functions/later/index.ts` with no table | E1 names later |
| a table `[functions.gone]` with no folder | E2 names gone |
| a later migration schedules `kayfabb-ghost` posting to `/functions/v1/ghost` | E3 |
| a later migration reschedules `kayfabb-conceal` with `'Authorization', 'Bearer ' \|\| s.secret` in place of `apikey` | E4 |
| `fromTheService` removed from `supabase/functions/mail/index.ts` | E5 names mail |
| `fromTheService` only in `supabase/functions/mail/core.test.ts` | E5 |
| `supabase/config.toml` missing | a complaint |
| quiet: 0004's `Authorization` job is superseded by 0071 (the real files, once Task 2 lands) | no complaint |
| quiet: a later migration schedules `kayfabb-ghost` and a later one still unschedules it | no complaint |
| quiet: the real files | no complaint |

Both files go into `STEPS` in `tools/build.mjs`, the test immediately before the check, after
`tools/check-migration-versions.mjs`.

**The red runs to record.** (a) The self-test with `problems()` returning `[]` (every red case fails on its
assertion). (b) With `problems()` written, before Task 2: `node tools/check-edge-functions.mjs` exits 1 naming
`conceal` under E1, and the self-test's last case fails. That is the real fault, caught by the check before the fix.

### Task 2: the fix

Model: inline

- `supabase/config.toml`: `[functions.conceal]` with `verify_jwt = false`, and the comment over the tables names
  `mail` and `conceal` among the functions that accept only the jobs key, and names the check that now holds the list.
- Green: `node tools/test-edge-functions.mjs`, `node tools/check-edge-functions.mjs`.

README step 5's stale list ("`settle`, `meet` and `seed`") is left to a follow-up: PR #642 (open) rewrites README.md,
and one sentence is not worth a conflict with it.

## The way out, stated (#646 item 3)

`concealing` ends by itself: the job runs every minute, takes the oldest 200 Acts with an open request and records a
layer for each (`conceal_due`, `record_layer`, 0340). A request is append-only and stays open until a layer answers
it, so a run that fails, is refused or never happens loses nothing; the first run that reaches the function clears the
backlog, 200 Acts a minute. The quoting post's author can also end it on the screen, by editing the quote out. With
this change the job is no longer refused, so "in a moment" is true again.

What this plan does not build is a bound: if the job stays stopped for another reason (the function throws, the
`kayfabb_jobs` key is missing, pg_net is down), the post waits until an operator restores the job, and nothing tells
an admin. That is true of every state a job ends (mail waiting to send, a card write, a Mod Bot's filing), so it is
one design, not a conceal-only fallback, and it is a design session's: it goes to the owner as a design question on
the PR, with its own issue.

## What is shared with PR #642

PR #642 (open, head 8a6070a1) changes `.github/workflows/release.yml`, `tools/check-release-workflows.mjs`,
`tools/build.mjs` and `README.md`. This plan touches `tools/build.mjs` only to add two lines to `STEPS`, and none of
the others. Whichever merges second merges main's `STEPS` with its own.

## Review focus

- The job reader takes the last `cron.schedule` of each job name across the migrations in file-name order, and reads
  the whole command, not only its first line.
- A commented-out `verify_jwt = false` is not read as a setting.
- The self-test's cases start from the real files, and each fails on its assertion when `problems()` is empty.
