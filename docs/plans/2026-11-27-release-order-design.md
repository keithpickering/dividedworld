# Release order: migrations land in the order they were tested, and functions never meet settings from another release

Record, written 2026-11-27. A design session with the owner, for issues #1209, #1210 and #1200 (with its comment of
2026-11-27 and the orchestrating session's correction of it). The plan is `docs/plans/2026-11-27-release-order-plan.md`.
The staff half of the same session is `docs/plans/2026-11-27-staff-reliability-design.md`.

## 0. What was found

**The order a migration was tested in is not the order production applies it.** `0424_staff_requests` was numbered
while 0423 was main's newest. #1070 merged 0425 at 03:24 UTC on 25 Nov, and the 05:13 release deployed it. #1066 merged
0424 at 07:27. The SQL suite (`tools/test-sql.mjs`) replays migrations in name order, so every build tested 0424 before
0425. Production held 0425 and not 0424, so `supabase db push` refused every release from then on with "Found local
migration files to be inserted before the last migration on remote database". On 27 Nov at 11:29 the owner ran
`db push --include-all` by hand. That applied 0424 after 0425, an order no build had tested. It was safe only because
the two touch no common objects.

**`--before` checks only one direction.** `problems(local, remote, 'before')` in
`tools/check-deployed-migrations.mjs` complains only about a version the database holds and the repository lacks.
On that run it printed "269 migration(s) in the database, 289 in the repository: nothing wrong before the push". The
comment in `release.yml` says the check names this case, but it does not.

**Nothing compares a PR's new migration numbers with its base.** `tools/check-migration-versions.mjs` holds each
version unique and well-formed within one tree. "Whichever lands second renumbers" is a convention, and only an
orchestrating session checks it before a merge. GitHub does not re-run a PR's CI when main moves. Main has no branch
protection, and a merge queue needs an organization-owned repository.

**The functions refuse settings from another release, in both directions** (orchestrator's evidence, run 45990989682
and the 27 Nov logs):
- *Rows newer than the code.* From 11:29, when the hand push applied 0426–0452, until the release deployed functions at
  12:16:52, staff, chatter, mail and write all failed on every run with "the settings rows make the instance not whole
  … "quizWriteMinutes" is not one of its fields". The cause is 0446, which writes `quizWriteMinutes` into the `modBots`
  row. Each of the strict rules in `engine/rules/instance.ts` (`modBotsRule`, `poolRule`, `apologyRule`, …) refuses a
  field it does not know, and `withDatabaseSettings` (`supabase/functions/_shared/settings.ts`) throws on any problem.
- *Rows older than the code.* At 12:17:01, between the functions job (12:15:57 → 12:16:52) and the seed job (12:16:54 →
  12:17:19), mail and write failed with `card "its-curtains" reads economy "itsCurtains.secondAdd", which the settings
  do not hold`. The new functions were live before the seed wrote the new economy keys.
- In a normal release the schema and functions jobs are about a minute apart. A red functions job, or a hand push,
  leaves the database ahead of the functions for as long as that lasts. The 2026-11-12 design's D5 already says so.

**#1200's original case no longer applies.** It was a one-off for the release carrying 0450: a daily job that fell due
between schema and functions would run on code that recorded no heartbeat. 0450 was applied by the 11:29 hand push, and
the functions that record heartbeats were live at 12:16:52. No daily job fell due in between (settle is due at 10:00 and
meet at 11:00). Every function deployed since records its heartbeat, so the case cannot recur.

## 1. Decisions

- **D1. `--before` refuses a repository migration older than the database's newest that the database lacks** (#1209).
  `problems(local, remote, 'before')` adds one problem for each local version missing remotely and numbered below the
  remote's newest. Each problem names the version and the remote's newest. The command's tail then says what to do:
  renumber the migration above the database's newest in a PR, so production applies it in the order the SQL suite
  tested it. `supabase db push --include-all` is mentioned only as a hand step, for once the owner has checked that the
  migration shares no objects with the newer ones. A local version above the remote's newest is still just what the
  push is about to apply.
  - *Rejected:* advising `--include-all` first. It applies an order no build tested.
  - *Rejected:* naming the versions with no remedy. The owner would have to work out the remedy from the CLI's error,
    which is what happened on 25–27 Nov.
- **D2. A new check holds a change's added migrations above its base's newest, in the PR and on every push to main**
  (#1210). `tools/check-migration-order.mjs --base <ref>` reads the migration file names in `<ref>` and in the working
  tree (`git ls-tree --name-only`, so no merge base and no deep history is needed). Every name in the tree but not in
  the base is *added*, a rename included, and each added version at or below the base's newest is a fault naming both,
  with "renumber it above <newest>". The pure part is `orderFaults(baseNames, headNames)`.
  - In the PR: `build.yml` gains a step, on `pull_request` only, that fetches `github.base_ref` at run time and runs the
    check against it.
  - On main: a new workflow, `migration-order.yml`, runs on every `push` to `main` and checks `github.event.after`'s tree
    against `github.event.before`. So a merge made after main moved, whether by the owner, an orchestrating session or
    anyone else, turns main red within minutes. No database holds the migration yet, so a renumbering PR fixes it before
    the nightly release, and D1 is the last net if it does not.
  - *Rejected:* a ruleset requiring branches to be up to date. Every merge would need a re-run after main moved, and the
    push check gives the same safety without that cost.
  - *Rejected:* the PR check alone. It misses exactly the 25 Nov case, a base that moved after the PR's last run.
- **D3. The release writes the seed in the schema job, right after `db push`** (#1200, the older-rows direction). A new
  tool, `tools/release/seed-database.ts`, run with `node --experimental-strip-types`, builds the payload exactly as the
  seed function does (`instanceSeed(chooseInstance(profile), conduct)`, from `supabase/functions/_shared/seed.ts` and
  `_shared/instance.ts`). It calls `seed_instance(payload)` through psql (`tools/instance-files.mjs`'s `connection` and
  `psql`) on the database an explicit `--db` names. So the functions job always starts on a database that holds every
  row and key its new code reads. The seed job stays where it is: it re-seeds (idempotent) and proves the instance whole
  with the deployed code's own reading, so it remains the release's proof (the 2026-11-12 design's D6).
  - *Rejected:* holding every job during the backend steps. A red step would stop the whole game until the fix lands.
- **D4. The functions read a settings row from a newer release without refusing it** (#1200, the newer-rows
  direction). When `withDatabaseSettings` reads the database's rows, a field that the code's own rules do not know is
  dropped from the tuned instance, not reported as a problem. This applies at any depth the strict rules check: a field
  of a setting object, and a key of a keyed record such as `pool.strengths`. The SQL's `settings_held` already checks
  each row's shape on write, so the database never holds a field no release knows. Strictness stays in three places:
  the code's own instance (`instanceProblems`, unchanged, and every instance test), `settings_held`, and the seed's
  proof, which runs when code and rows are from the same release and so keeps reporting an unknown field.
  - *Rejected:* filling a missing field from the code's own value at read time. The economy row is the whole economy as
    `buy_card` reads it, so SQL and TypeScript would read different numbers.
  - *Rejected:* migrations never writing settings fields. A migration that adds a field must still make the row whole
    for its own SQL. D3 makes the rest of the order safe.
- **D5. The release that carries D4 is the last one with the gap.** The old functions it replaces are still strict, so
  D4 protects only from the release after it onward. The plan says so in its PR body, and the release that carries it is
  dispatched when no hand push is pending.
- **D6. #1200's original question is closed as answered by events** (section 0). The release that carried 0450 crossed
  no daily due time. The PR that carries this plan closes #1200 for its comment's case.

## 2. What this touches, by layer

All of it is engine, tooling and workflows. The instance supplies nothing new: the seed tool reaches Divided World only
through `supabase/functions/_shared/instance.ts`, the one composition root that already chooses it ("KayfaBB never
knows which instance it runs"). `tools/check-engine-boundary.mjs` already allows `tools/` to import the composition
root.

No player-facing state, screen or response is added. Nothing here reads or exposes a private fact.

## 3. Open

- **Which profile production runs.** The seed function picks its instance with the `KAYFABB_PROFILE` function secret.
  The schema job's tool must pick the same one. The plan reads it from the `production` environment's variable
  `KAYFABB_PROFILE`, unset meaning none, and the owner confirms that it matches the function secret before the first
  release that carries D3. A mismatch would make the two seeds write different instances each night.
- **Other changes between releases besides settings** (an RPC whose signature a migration changes, called by an old
  function). D4 covers only settings, the case seen. The 2026-11-12 design's D5 rejected a general compatibility
  discipline because nothing can check it. That still holds, and is not reopened here.
