# Release order: the plan

Record, written 2026-11-27. Carries out `docs/plans/2026-11-27-release-order-design.md` (issues #1209, #1210, #1200).
Five tasks, in order, each test first with its red run. Everything is tooling, workflows and the engine's settings
reader. No migration is added, and Divided World supplies nothing new.

## Task 1. `--before` refuses a stray older migration

Model: sonnet

- **Change** `problems(local, remote, mode)` in `tools/check-deployed-migrations.mjs`. Under `before` it also returns,
  for each local version missing from the remote and below the remote's newest (`max(remote)`, compared as the
  four-digit strings they are), `the repository has migration ${v}, which the database does not hold and which is
  numbered below the database's newest, ${newest}: db push would refuse it, and applying it now would run it after
  migrations the SQL suite ran it before`. A remote that is empty has no newest, so this adds nothing. `after` is
  unchanged, since it already names every difference.
- **Change** `main()`'s tail. When any problem of this kind is found, after the list it prints: `Renumber each of these
  above ${newest} in a PR (no database holds it yet), so production applies it in the order the SQL suite tests. Only
  if you have checked that it shares no objects with the newer migrations, apply it by hand with supabase db push
  --include-all.` Exit status 1, as for every other problem.
- **Change** the file's header comment, the `--before` paragraph, and the comment in `.github/workflows/release.yml`
  above the push, which already claims this.
- **Tests first** (`tools/test-deployed-migrations.mjs`, red before the change): local `['0001','0424','0425']`, remote
  `['0001','0425']` under `before` gives one problem naming `0424` and `0425` (the 25 Nov case). Two stray versions give
  two problems, in order. Local `['0001','0425','0426']`, remote `['0001','0425']` gives nothing under `before`, since
  0426 is above the newest. An empty remote gives nothing. Under `after` the 25 Nov case still gives exactly one problem
  for `0424`, not two. Add a case to the header's list of poisons.

## Task 2. The migration-order check and its test

Model: sonnet

- **New** `tools/check-migration-order.mjs`, with the header shape of `check-migration-versions.mjs`.
  - `orderFaults(baseNames, headNames)`, pure. Both arguments are lists of file names, and only names matching
    `MIGRATION_NAME` (imported from `check-migration-versions.mjs`) are read. *Added* means a name in head that is not in
    base, so a renamed file counts as added. The base's newest is the highest version among the base's names. Each added
    file whose version is at or below the newest is a fault: `${name} is new on this branch and numbered at or below
    ${newest}, the newest migration on the base (${newestName}); renumber it above ${newest}`. A base with no migrations
    gives no faults.
  - The command: `node tools/check-migration-order.mjs --base <ref>`. It reads the base's names with `git ls-tree
    --name-only <ref> supabase/migrations/`, and head's from the working tree's folder. With no `--base`, or a ref git
    cannot read, it exits 2 with a plain reason. With faults it exits 1, listing each. Otherwise it prints `N
    migration(s) added on this branch, each above ${newest}` and exits 0.
- **New** `tools/test-migration-order.mjs`, red against an `orderFaults` that returns `[]`. The cases: the 25 Nov case
  (base has 0425, head adds 0424), which faults naming both. An added version equal to the base's newest (two files of
  one number arriving from two branches) faults. An added version above it passes. A rename of an existing file to a
  lower number faults. A rename to a number above the newest passes. A base with no migrations passes. Non-migration
  names are ignored. The command with no `--base` exits 2. The command against `HEAD` in this checkout exits 0, since
  nothing is added.
- **Add** the test to `STEPS` in `tools/build.mjs` beside `test-migration-versions.mjs`. Add the check to the list of
  checks the build does not run, with its reason: "compares a branch's migrations with its base's, which only CI knows;
  it runs in build.yml on a pull request and in migration-order.yml on a push to main, and tools/test-migration-order.mjs
  drives it red in the build". Run `tools/test-build-steps.mjs` and the pair rule to confirm the build accepts the pair.

## Task 3. The check runs in the PR and on main

Model: sonnet

- **`.github/workflows/build.yml`**: after `npm ci`, a step with `if: github.event_name == 'pull_request'`, running
  `git fetch --no-tags --depth=1 origin "$GITHUB_BASE_REF"` and then `node tools/check-migration-order.mjs --base
  FETCH_HEAD`. Comment: the base is fetched when the step runs, not when the PR was opened. Head is the PR's merge ref as
  checked out.
- **New** `.github/workflows/migration-order.yml`: `on: push: branches: [main]`, `permissions: contents: read`, one job
  (`timeout-minutes: 5`). It checks out `github.event.after` with `fetch-depth: 0` (the `before` commit must be
  readable), runs `npm ci` only if the check needs it (it imports nothing outside `tools/`, so it does not), then runs
  `node tools/check-migration-order.mjs --base "${{ github.event.before }}"`. A `before` of forty zeros (a new branch)
  is skipped with a summary line. The header comment says why it exists: a merge made after main moved, by anyone, turns
  main red within minutes, before the nightly release, while no database holds the migration. It names no secret and no
  Environment, which R10 and R11 of `tools/check-release-workflows.mjs` already require of every workflow but the
  release's three jobs. Run that check and its test.
- **Where a skill or note tells a session to compare migration numbers by hand before a merge** (`grep -rni
  "renumber\|lands second" .claude docs/working-rules`; none was found when this was planned), it now says the check
  does this in CI. The hand check stays as a habit, not as the guard.

## Task 4. The functions drop a settings field they do not know

Model: sonnet

- **`engine/rules/instance.ts`**: one table, `SETTING_FIELDS`, holds, for each setting whose rule refuses a field it
  does not know, the fields it knows, including the nested ones (`pool.strengths` → `POOL_TRIGGERS`, `pool.sessions`,
  `pool.turns`, `modBots.visitHours`, `modBots.cap`, and each rule with a `*_KEYS` list: `poolRule`, `modBotsRule`,
  `warnBarRule`, `apologyRule`, `owedLinesRule`, `staffRequestsRule`, `conductRule`, `habitsProblem`, and every other
  rule `grep -n '"is not one of\|is not a trigger\|stray' engine/rules/instance.ts` finds). Each rule reads its known
  fields from the table, so the rule and the drop below cannot disagree ("Two lists that must agree are one list"). The
  existing `*_KEYS` constants become entries of the table.
- **New** `dropUnknownFields(settings: Settings): { settings: Settings; dropped: string[] }`, pure. It removes, at each
  path the table names, every key the table does not list, and returns the cleaned settings and each dropped path
  (`modBots.quizWriteMinutes`). The economy is not touched: it is a keyed record whose keys the cards name, and an
  unknown key in it is no problem today.
- **`supabase/functions/_shared/settings.ts`**: `databaseSettingsProblems(instance, db, { unknownFields })`, where
  `unknownFields` is `'drop'` or `'report'`. `withDatabaseSettings`, which every job reads through, uses `'drop'`: it lays
  the rows, drops what the code does not know, and judges the rest. The seed's proof (`supabase/functions/seed/core.ts`)
  uses `'report'`, so a field unknown to the code that seeded it is still a 422. With `'drop'`, a dropped path is
  logged once per call (`console.warn`, path only, never a value) so the function log shows the gap.
- **Tests first**, red before the change:
  - `engine/rules/instance.test.ts`: for every entry of `SETTING_FIELDS`, a valid setting with one extra field fails
    `settingsProblems` and, after `dropUnknownFields`, passes and names that path. This is generated from the table, so a
    rule added later is covered. An extra key under `pool.strengths` is dropped too. A missing field is not filled: a
    `modBots` row lacking `quizWriteMinutes` still fails after the drop.
  - `supabase/functions/_shared/settings.test.ts` (new, or beside the settle tests that read it): a database answering
    the 27 Nov `modBots` row plus a field the code does not know reads whole under `withDatabaseSettings`. The same rows
    are a 422 from `runSeed` (`supabase/functions/seed/core.test.ts`).
  - The poison, recorded in the PR: make `dropUnknownFields` return its input unchanged and see the 27 Nov case fail.

## Task 5. The schema job writes the seed

Model: sonnet

- **New** `tools/release/seed-database.ts`, run as `node --experimental-strip-types --no-warnings=ExperimentalWarning
  tools/release/seed-database.ts --db <postgres URL> [--profile <name>]`. It builds the payload with
  `instanceSeed(chooseInstance(profile), conduct)` (the seed function's own `supabase/functions/seed/core.ts` imports, so
  the two cannot drift) and runs `select seed_instance($1::jsonb)` through `connection` and `psql` from
  `tools/instance-files.mjs`, with the payload passed as a psql variable and never on the command line. It prints the
  host and the counts, never the URL, and every message goes through `scrub()`. `--db` is required and has no default. A
  refusal from `seed_instance` exits 1 with its reason. A transport failure is retried with `retrying` from
  `check-deployed-migrations.mjs` ("Three unrelated timeouts are not a poison pill"). The pure part, `seedArgs(argv)` and
  the SQL text, is exported for the test. If node cannot import the `.ts` composition root under strip-types (an
  import a Deno-only path breaks), say so in the PR and change the tool, never the functions.
- **Tests first** (`tools/release/seed-database.test.ts`, added to the `test:engine` glob in `package.json`): the
  arguments' refusals; the payload equals what `runSeed` sends for the same profile; and, against the local Postgres
  (`DATABASE_URL`, a scratch database the test creates from the migrations as `supabase/tests/e2e/` does), a run seeds an
  empty instance and a second run changes nothing but the counts. That test is red until the tool exists.
- **`.github/workflows/release.yml`**, in `schema`, after `check-deployed-migrations --after`: `node
  --experimental-strip-types --no-warnings=ExperimentalWarning tools/release/seed-database.ts --db "$SUPABASE_DB_URL"
  --profile "$KAYFABB_PROFILE"`, with `KAYFABB_PROFILE: ${{ vars.KAYFABB_PROFILE }}` (an unset variable is empty, which
  is no profile, as `chooseInstance` reads it). The comment says why the seed now comes before the functions: the
  functions must never start on rows older than their code (design, D3). The seed job is unchanged and is now the proof.
- **`tools/check-release-workflows.mjs`**: R13 grows. `schema` runs the `--before` check, `db push`, the `--after`
  check, then `seed-database.ts`, in that order. A poison in `tools/test-release-workflows.mjs` moves the seed line above
  the push, and another drops it.
- **The PR body** asks the owner to confirm, before the release that carries this, that the `production` environment's
  `KAYFABB_PROFILE` variable matches the seed function's secret of the same name (design, section 3). It also says that
  this release is the last with the gap (design, D5). The body carries `Closes #1209`, `Closes #1210` and `Closes #1200`.

## Review focus

- Task 4's drop runs on every job's read of settings. Confirm it never drops a field the code does know (a nested path
  spelled differently in the table and the rule), and that a field it drops is never read by the new code's SQL, which
  reads rows directly.
- The seed now runs twice per release, once by psql before the functions and once by the function after. Confirm that
  `seed_instance` is idempotent across the two and that the tuned mark (`kayfabb.seeding`, 2026-11-12 design D4)
  is set by psql's transaction too, so the first seed does not mark every row tuned.
- The schema job's seed writes cards, classes and boards rows before the new functions are live. A player who acts on a
  new card in that minute meets old functions. Confirm that the old functions skip or retry an Act of an unknown card
  rather than fail the whole job.
- `migration-order.yml` reads `github.event.before`. A force-push to main or a push of several commits at once must
  still compare against the main that was there before.
- The PR check reads the merge ref against a freshly fetched base. Confirm a PR whose merge ref is stale (base moved, PR
  not re-run) is caught by the push check and not by a false green.
