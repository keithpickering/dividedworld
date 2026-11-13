# The release deploys the backend: design

Record, written 2026-11-12. The design session's decisions, made with the owner, for issue #243: the daily release
(`docs/plans/2026-11-05-daily-release-design.md`) deploys the schema, the Edge Functions and the seed ahead of the
site, so an instance never runs half-deployed. The plan is `docs/plans/2026-11-12-release-backend-plan.md`.

## 1. The problem

On 2026-11-12 the owner deployed by hand with `supabase db push` and `supabase functions deploy --use-api`, and every
card action (`act`'s `playCard`) and every `estimate` call answered 500. The function log said:

```
act failed play_card Error: the settings rows make the instance not whole: card "laugh-track" reads economy
"laughTrack.perPlace", which the settings do not hold; …
```

Laugh Track's economy numbers reach the database only through the seed (`supabase/functions/seed/`), the third step
of README's "After the first deploy", and it had not been run. `withDatabaseSettings`
(`supabase/functions/_shared/settings.ts`) refuses the whole instance when one card's numbers are missing, so one card
stopped all of them. That refusal is right. What failed was a deploy with three manual steps and nothing that says when
one was skipped.

Issue #243 held the schema and functions jobs until the first instance was deployed. Divided World is deployed now.

## 2. Decisions (the owner, 2026-11-12)

- **D1. The release runs the whole deploy.** After `web` and before `promote`, three jobs: `schema`, `functions` and
  `seed`, each `needs:` the one before. The live project is touched only once every test has passed on the candidate,
  and the site moves last.
- **D2. The release seeds every run, and a hand-tuned settings row is kept.** Today `seed_instance` overwrites every
  settings row with the code's value (the economy row is merged key by key, with the code's value winning). A nightly
  seed would undo every admin's tuning every night, and `settings.ts` says the season review retunes "with a row,
  never a deploy".
  - *Rejected:* code always wins. Tuning would last only until that night's release.
  - *Rejected:* the release seeds missing keys only. A default changed in code would never reach the instance without a
    full manual seed, which brings back the step this design removes.
- **D3. A missing key is always filled, in a tuned row too, at any depth.** The economy is one row, so marking it tuned
  for one retuned price must not keep a new card's numbers out. That would be today's 500 again. In a tuned row, the
  seed keeps every value already there and adds only the paths the row lacks (a deep merge, the row's values winning).
  In an untuned row the seed writes as it does today.
- **D4. The tuned mark is automatic.** `settings` gains `tuned_at timestamptz` (null means untuned). A trigger sets it
  to `now()` when a row's value is written by anything other than the seed. The seed marks its own transaction with
  `set_config('kayfabb.seeding', 'on', true)`. An admin keeps tuning in the SQL editor and cannot forget the mark. To
  hand a row back to the code, an admin sets `tuned_at` to null in the SQL editor, and the next release writes the
  code's value. The only writer of settings outside the seed is `set_admin_contact` (0081), which is an admin's choice,
  so it is marked too.
  - *Rejected:* an explicit `tune_setting` function. A plain SQL update would not be protected, and the next release
    would undo it silently.
  - The README's first-admin steps change: registration is closed again by setting `registrationMode` back to
    `"invite"` (or by clearing its mark and letting the next release write it), not by seeding again.
- **D5. A red step holds, and the fix goes forward** (the 2026-11-05 design's D5, carried). A red step stops everything
  after it. The site stays where it is, GitHub emails the owner, and `report` names the step. Each step is safe to run
  twice: `db push` applies only what is pending, a deploy overwrites, and the seed is idempotent. So after the fix
  merges, the owner dispatches Release again. Migrations cannot be rolled back, so a red `functions` or `seed` leaves
  the schema ahead of the functions until the fix lands. The `sql` job has already replayed every migration from zero,
  so a migration that fails to apply is caught before the live project is touched.
  - *Rejected:* rehearsing on a Supabase preview branch first. That is a paid project for every release, plus a second
    set of secrets.
  - *Rejected:* requiring every migration to be backward-compatible with yesterday's functions. It is a discipline
    every design would carry, and nothing can check it.
- **D6. The seed proves the instance whole before it answers 200.** After `seed_instance`, the seed function runs
  `withDatabaseSettings` on the database it just wrote. A seed whose settings are still not whole (a tuned row holding
  a value the code no longer accepts, say) answers **422** with each problem named, and the release goes red before
  the site moves. Any other failure of the seed's own (a `seed_instance` refusal) is a 422 too, so a 5xx from the seed
  means the platform failed, and only that is retried.
- **D7. The deployed-migrations check** ("A test that builds its own subject cannot tell you the subject is missing").
  `tools/check-deployed-migrations.mjs` reads `supabase_migrations.schema_migrations` from the database named by an
  explicit `--db` argument. It prints the host it read and refuses when none is given or the host is this machine's.
  It compares that list with the versions of `supabase/migrations/*.sql`:
  - `--before`, run before the push: red if the live database holds a version the repository does not (SQL applied by
    hand, or a migration renamed after it was applied).
  - `--after`, run after the push: red unless the two lists are equal.
  `problems(local, remote, mode)` is pure, and its test poisons each case.
- **D8. Transport failures are retried where they happen; a refusal is not** ("Three unrelated timeouts are not a
  poison pill"). The seed call uses curl's own `--retry 3`, which retries only a timeout, a refused connection, 408,
  429 and 5xx, so the seed's 422 stops at once. The functions deploy is retried whole, up to three attempts: it
  overwrites, and the CLI does not tell a transport failure from a refusal, so a bad bundle fails three times and costs
  a minute. `check-deployed-migrations` retries its own connection. `db push` runs once. Each migration applies in its
  own transaction, so a dispatch after the failure picks up where it stopped.
- **D9. The secrets live in a GitHub Environment named `production`**, whose deployment branches are `main` alone.
  It holds `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL` (the session pooler's string) and
  `KAYFABB_JOBS_KEY`. Only `schema`, `functions` and `seed` name the environment, so no pull-request workflow can read
  them. The owner creates it. No session sees or asks for a secret.
- **D10. Sessions still never move production** (the 2026-11-05 design's D3, carried). A dispatch is the owner's. A
  hand deploy stays possible, and the next release lands on top of it.

## 3. The release, after this change

`candidate → build → sql → web → schema → functions → seed → promote → report`.

- `schema`: `environment: production`, `needs: [candidate, web]`. It checks out the candidate, runs `npm ci`, which
  installs the Supabase CLI at the exact version `package.json` gains as a devDependency (the owner's `npx supabase`
  then runs the same version), then runs `check-deployed-migrations --before`, then `supabase db push
  --db-url "$SUPABASE_DB_URL"` (never `--include-all`), then `check-deployed-migrations --after`.
- `functions`: `environment: production`, `needs: [candidate, schema]`. It runs `supabase functions deploy --use-api
  --project-ref "$SUPABASE_PROJECT_REF"` through the retry wrapper.
- `seed`: `environment: production`, `needs: [candidate, functions]`. It POSTs to
  `https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/seed` with `apikey: $KAYFABB_JOBS_KEY` through the retry
  wrapper, writes the answer's counts to the run summary, and goes red on anything but 200.
- `promote`: `needs: [candidate, seed]`.
- `report` lists `schema`, `functions` and `seed` among its results.

## 4. The guard

`tools/check-release-workflows.mjs` grows. R1's chain becomes `build → sql → web → schema → functions → seed →
promote`. Added:

- R8. `schema`, `functions` and `seed` each declare `environment: production`, and no other job in any workflow does.
- R9. No workflow but `release.yml` names `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF` or
  `KAYFABB_JOBS_KEY`, and in `release.yml` only those three jobs do.
- R10. No workflow runs `--include-all`, `db reset`, or `functions delete`.
- R11. `schema` runs `check-deployed-migrations` with `--before`, then `db push`, then the check with `--after`, in that
  order.

Each has a poison in `tools/test-release-workflows.mjs`.

## 5. The cutover (the owner's, in order)

1. In GitHub, under **Settings > Environments**, create `production`, limit its deployment branches to `main`, and add
   the four secrets (D9).
2. Merge the build PR. If the Environment is missing, the next release goes red at `schema` and the site holds, which
   is safe but stops the site moving.
3. Dispatch **Release** once and read its summary.

## 6. The rules this touches

- **No player is ever stuck.** The tuned mark is a state a settings row can be in. Its way out is an admin's (D4).
  No player-facing state is added.
- **A response never proves a private fact.** The seed's 422 names settings and card keys, which are instance
  vocabulary, and it answers only the `kayfabb_jobs` key. Nothing else is added.
- **The layers.** The trigger and the seed's merge are engine SQL and name no key. The workflow and the checks are
  repository tooling.
- **Append-only.** `settings` holds no Acts. `tuned_at` is configuration state.
- **Portable by construction.** The export lists each table's columns from the database (`tools/instance-files.mjs`
  `tables`), so `tuned_at` travels with no list to update. The import writes in replica mode, where the marking
  trigger (an ordinary trigger) does not fire, so an imported mark is kept as exported. The round-trip test (`supabase/tests/e2e/0003-export.ts`) shows it.
- **A guard that has never been red.** D7's check and R8 to R11 each have a poison.
- **Record every schema change as a migration.** The column, the trigger and the seed's change are one migration.
- **A standing permission is written down.** The release deploys to the live project on the owner's schedule and
  dispatch. No session gains a permission. Build sessions still touch no deployed service.

## 7. Open

- CLAUDE.md's Merging bullet says it "is rewritten when an instance is first deployed". An instance is deployed. The
  wording is the owner's, and it is not part of this design.
- Whether `main`'s branch deploy should point at its own Supabase project (the 2026-11-05 design's §7) is still open.
