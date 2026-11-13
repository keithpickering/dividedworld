# The release deploys the backend: plan

Record, written 2026-11-12. Carries out `docs/plans/2026-11-12-release-backend-design.md` (its sections are cited as
§N, its decisions as DN and its guard rules as RN). No task touches a deployed service: every test runs against
Postgres on localhost or against files. The Environment and its secrets (§5) are the owner's and are not a task.

Every task is test first: the test named, its red run recorded, then the code, then the green run.

## Task 1. Tuned settings rows (D2, D3, D4)

Model: sonnet

Files: `supabase/migrations/0340_settings_tuned.sql` (new), `supabase/tests/0291-settings-tuned.sql` (new).
`seed_instance` was last defined in `supabase/migrations/0332_arcs.sql`. The new migration redefines it from that body,
and its header says "seed_instance (0332), with every settings write through seed_setting. Everything else as 0332
wrote it." Check that no migration after 0332 redefined it before copying.

- `alter table settings add column tuned_at timestamptz`.
- `jsonb_fill(base jsonb, fill jsonb) returns jsonb`, immutable: when both are objects, every key of `fill` missing
  from `base` is added, and every key in both recurses. Otherwise `base` is returned. No key is ever removed.
- `settings_tuned()` trigger, `before insert or update on settings for each row`, an ordinary trigger (so a replica
  write in an import skips it). When `current_setting('kayfabb.seeding', true) = 'on'` it returns `new` untouched. On
  insert, it sets `new.tuned_at := now()`. On update, it sets `new.tuned_at := now()` when `new.value is distinct from
  old.value`, and otherwise leaves `new.tuned_at` as written, so `update settings set tuned_at = null` clears the mark.
- `seed_setting(in_key text, in_value jsonb)`, used only by `seed_instance`:
  - row missing: insert it, untuned;
  - row untuned, key `economy`: `old || in_value` (today's merge);
  - row untuned, any other key: `in_value`;
  - row tuned: `jsonb_fill(old, in_value)`, with `tuned_at` kept.
- `seed_instance`: its first statement after the advisory lock is `perform set_config('kayfabb.seeding', 'on', true)`.
  Each of its writes to `settings` (the payload's settings, `bossRoster`, `developerAvatar`, `systemAnnouncements`,
  `updatesThread`; grep the body for `into settings` to be sure that is all of them) goes through `seed_setting`.
- Grants: `jsonb_fill` and `seed_setting` revoked from `public, anon, authenticated`, as 0001's default privileges
  already do.

Tests first, in `0291-settings-tuned.sql`, each a `raise exception` on failure, using the fixtures' seed:
1. An admin's `update settings set value = … where key = 'registrationMode'` sets `tuned_at`. Seeding again keeps the
   tuned value.
2. Clearing `tuned_at` and seeding again writes the code's value and leaves the row untuned.
3. A tuned economy row with one price changed: seeding with a payload whose economy has a new nested key keeps the
   changed price and gains the new key. This is the 2026-11-12 case.
4. An untuned economy row: seeding replaces each top-level key with the code's and keeps a key the code dropped.
5. A seed's own writes leave `tuned_at` null on every row it wrote.
6. `set_admin_contact` marks `adminContact` tuned.
7. Under `set local session_replication_role = replica`, an insert with a given `tuned_at` keeps it, as the import
   writes.
8. `jsonb_fill`: a scalar base wins over an object fill, an object base gains a missing nested path, and an array base
   is returned as is.

Red run: the file against the migrations as they stand (no `tuned_at` column). Record the output in the PR.

## Task 2. The seed proves the instance whole (D6)

Model: sonnet

Files: `supabase/functions/seed/core.ts` and `supabase/functions/seed/core.test.ts` (new), `supabase/functions/seed/index.ts`.

- `runSeed(db: Db, instance: Instance): Promise<{ status: number; body: unknown }>`: calls
  `seed_instance` with `instanceSeed(instance)`, then `withDatabaseSettings(instance, db)`.
  - Both succeed: 200, with the counts `seed_instance` returned.
  - `withDatabaseSettings` throws: 422, `{ error: 'the seeded instance is not whole', problems: [...] }`, with each
    problem as `instanceProblems` words it. `withDatabaseSettings` throws one joined string, so export a function from
    `_shared/settings.ts` that returns the problems list, and have `withDatabaseSettings` throw from it. One source,
    two callers.
  - `seed_instance` throws a database error (anything the `Db` wrapper raises as a refusal): 422 with the error's
    message.
  - Anything else (`fetch` failing, a 5xx from PostgREST): rethrown, and `index.ts` answers 500 as today.
- `index.ts` keeps its key check and calls `runSeed`. Its header comment says the release calls it nightly (§3).
- Tests first, with a fake `Db` in the style of `_shared/handler-test-kit.ts`:
  1. Seeded and whole: 200 with counts.
  2. `instance_settings` answers an economy missing `laughTrack`: 422 naming `laughTrack.perPlace`.
  3. `seed_instance` refuses: 422 with its message, and `instance_settings` is never called.
  4. A transport failure is rethrown, not turned into 422.

Red run: the test file before `core.ts` exists.

## Task 3. The deployed-migrations check (D7)

Model: sonnet

Files: `tools/check-deployed-migrations.mjs` and `tools/test-deployed-migrations.mjs` (new), `tools/build.mjs`
(`STEPS`: the test only, since the check reads a live database and runs only in the release).

- `problems(local: string[], remote: string[], mode: 'before' | 'after'): string[]`, pure and exported. Each problem
  names the versions.
  - `before`: one complaint per remote version missing from local.
  - `after`: one complaint per difference in either direction.
- `localVersions(dir)`: the leading digits of each `supabase/migrations/*.sql` name, as `supabase` reads them.
  `tools/check-migration-versions.mjs` already parses these names, so share it rather than parsing twice.
- The CLI: `--db <url>` and `--before` or `--after`. It refuses (exit 2, plainly worded) when `--db` is missing, when
  the host is `localhost`, `127.0.0.1` or `::1`, or when no mode is given. It prints `reading supabase_migrations from
  <host>` and never the URL's password. It reads `select version from supabase_migrations.schema_migrations order by
  1` through `psql` (as `tools/instance-files.mjs` does), retrying the connection three times with backoff. A query
  error is thrown at once.
- Poisons in the test, each its own case:
  1. A remote version not in local, under `before`.
  2. The same under `after`.
  3. A local version not yet remote is fine under `before` and a complaint under `after`.
  4. Equal lists are `[]` under both.
  5. The CLI with no `--db`, and with a `localhost` URL, exits 2 without connecting (run it as a child process).
  6. `localVersions` on the real directory returns as many versions as there are `.sql` files.

## Task 4. The release runs the backend (§3, D1, D5, D8, D9, R8 to R11)

Model: sonnet

Files: `.github/workflows/release.yml`, `tools/check-release-workflows.mjs`, `tools/test-release-workflows.mjs`,
`package.json` and `package-lock.json`.

- `package.json` gains `supabase` as a devDependency pinned exactly (no `^`), at the newest release at least two weeks
  old on the day of the build. Record the version and that date in the PR.
- The guard first: R1's chain becomes `build → sql → web → schema → functions → seed → promote`, and `JOBS` gains the
  three. Add R8 to R11 as §4 words them. New poisons, each its own case:
  1. `seed` dropped from the jobs (R1).
  2. `promote.needs` set to `web`, skipping the backend (R1).
  3. `functions` with no `environment` (R8).
  4. `build.yml` given a job with `environment: production` (R8).
  5. `web.yml` naming `secrets.SUPABASE_DB_URL` (R9).
  6. `promote` given `env: { KAYFABB_JOBS_KEY: … }` (R9).
  7. `schema` running `supabase db push --include-all` (R10).
  8. `schema` with its `--after` check moved before the push (R11).
  9. `schema` with its `--before` check removed (R11).

  Red run: the guard on `release.yml` as it stands names R1 and R8.
- Then `release.yml` as §3 says. The header comment drops "Migrations and functions are still deployed by hand (issue
  #243)" and names this design. Each backend job checks out `${{ needs.candidate.outputs.sha }}`, runs `npm ci`, and
  takes its secrets through `env:` from `secrets.*`, never inline in a `run:` line.
  - The functions deploy loop: `for i in 1 2 3; do npx supabase functions deploy --use-api --project-ref
    "$SUPABASE_PROJECT_REF" && exit 0; sleep $((i * 20)); done; exit 1`.
  - The seed: `curl -sS --fail-with-body --retry 3 --retry-connrefused --max-time 120 -X POST
    "https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/seed" -H "apikey: ${KAYFABB_JOBS_KEY}"`, with its body
    written to `$GITHUB_STEP_SUMMARY`.
  - `report`'s `RESULTS` gains `schema`, `functions` and `seed`.
- Green: `npm run build:ci` passes, with the guard among its steps.

## Task 5. The documents (D4, §5)

Model: inline

Files: `README.md`, `supabase/functions/_shared/settings.ts` (header comment only).

- README §6.1: the seed now keeps a hand-tuned row and fills only what it lacks. Remove "it puts back the code's numbers
  over any an admin tuned by hand". Say how a row is handed back (`update settings set tuned_at = null where key =
  '…'`).
- README §8 step 3: close registration with `update settings set value = '"invite"' where key = 'registrationMode';`,
  not by seeding again.
- README §9: the release deploys migrations, functions and the seed nightly once the `production` Environment exists
  (§5's three steps, in order). A hand deploy is still possible, and the release lands on top of it. Remove the issue
  #243 link.
- `settings.ts`'s header: "retunes … with a row, never a deploy" stays true. Add that the release's seed keeps a tuned
  row (design D2).
- `npm run build:ci` passes `check-doc-references`.

## Review focus

- The seed's 422 versus 500: a `Db` refusal must not be mistaken for a transport failure, or the release retries a
  refusal three times and buries the message under curl's.
- `seed_setting` on a tuned row holding a value the code's validator (`settings_held`) would now refuse: it must fail
  loudly in the seed (a 422), not be silently overwritten.
- `kayfabb.seeding` is transaction-local: confirm no path calls `seed_instance` inside a transaction that then writes
  settings as an admin, which would leave those writes unmarked.
- The 2026-11-12 case, end to end: a tuned economy row plus a new card's nested keys must come out whole, both in
  `0291` and in Task 2's test.
- Secrets: no `run:` line interpolates `${{ secrets.* }}` directly, and `set -x` appears nowhere in a backend job.
- The functions job deploys every function in `supabase/functions/`. A new function that needs a secret the project
  lacks deploys and then answers 401 or 500 at run time, not at release time. Name this in the PR as a known limit,
  not a fix.
- A schedule day where `schema` has nothing to push: `--before` and `--after` both pass, and `db push` exits 0 with
  nothing pending.
