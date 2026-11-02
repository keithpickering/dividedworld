# The publishable and secret keys: plan

Record, written 2026-11-02. The plan for `docs/plans/2026-11-02-api-keys-design.md` (issue #157), confirmed with the
owner in its design session. It is written against main at ac701e1: migrations up to `0065_hints.sql`, SQL tests up
to `supabase/tests/0070-toast-kinds.sql`. Each new file takes the next free number when it is written, and a number
that moved is reported under `Plan gaps` in the PR.

## What it builds

KayfaBB on Supabase's publishable and secret keys alone, before the first deploy:

- every Edge Function reads its keys through one reader, which takes the platform's named keys or the single keys of
  the local stack and self-hosted Supabase, and refuses a legacy JWT key by name;
- every call a function makes sends a key in `apikey` alone, and a player's session in `Authorization` only when one is
  there;
- `settle`, `meet` and `seed` accept only the secret key named `kayfabb_jobs`, in `apikey`, which the scheduled jobs
  send from Vault's `kayfabb_jobs_key`;
- `verify_jwt` is off for every function, and the player's functions keep `whoami()` as their gate, held by tests;
- the web app builds with `VITE_SUPABASE_PUBLISHABLE_KEY`, and the operator's tools take a secret key in `apikey`;
- the deploy guide in `README.md` says all of it.

## The layers

All engine-side edge: `supabase/functions/_shared/` and each function's `index.ts` (the composition root), one
migration, `supabase/config.toml`, `web/src/data/`, `netlify.toml`'s comment, `tools/instance-files.mjs` and the
guide. Nothing in `engine/` or `instances/` changes, and no interface does.

## Tasks

### Task 1. The key reader

- **`supabase/functions/_shared/serve.ts`.** `environment(get)` returns `{ url, secret, publishable, jobs }`:
  - `secret`: `SUPABASE_SECRET_KEYS`'s `default`, parsed as JSON; where `SUPABASE_SECRET_KEYS` is unset,
    `SUPABASE_SECRET_KEY`.
  - `publishable`: `SUPABASE_PUBLISHABLE_KEYS`'s `default`; where it is unset, `SUPABASE_PUBLISHABLE_KEY`.
  - `jobs`: `SUPABASE_SECRET_KEYS`'s `kayfabb_jobs`; where `SUPABASE_SECRET_KEYS` is unset, `SUPABASE_SECRET_KEY`.
    Where `SUPABASE_SECRET_KEYS` is set and holds no `kayfabb_jobs`, `jobs` is `null`, never `default`.
  - `url`: `SUPABASE_URL`, as now.
- A missing `url`, `secret` or `publishable` throws, naming what to set (for example "make a secret key named
  default, or set SUPABASE_SECRET_KEY"). `SUPABASE_SECRET_KEYS` or `SUPABASE_PUBLISHABLE_KEYS` that is not a JSON
  object of strings throws, naming the variable and not its value. A key that starts `eyJ` (the legacy JWT shape)
  throws: "<which> is a legacy JWT key; KayfaBB takes the publishable and secret keys (sb_publishable_…, sb_secret_…)".
  No message ever holds a key's value: the test asserts each thrown message contains none of the values it was given.
- `jobs` being `null` does not throw here: only the three service-called functions need it, and they refuse in
  Task 3.
- `serviceDb(env)` takes `{ url, secret }`.
- **Tests first** (`serve.test.ts`, red before the change): the platform shape (both JSON objects, with and without
  `kayfabb_jobs`); the single-key shape; each missing key's message; a malformed JSON object; a legacy-shaped key in
  each of the four variables; `jobs` never `default` on the platform shape (the poison: a reader that falls back to
  `default` must fail it); no thrown message holding a given value.

### Task 2. What the functions send

- **`rpc.ts` (`postgrest`).** Headers are `apikey: key`, plus `Authorization: Bearer <bearer>` only when `bearer` is
  given. A service connection sends no `Authorization`.
- **`gotrue.ts`, `storage.ts`, `broadcast.ts`.** `apikey` alone.
- **Callers.** `account`, `act`, `avatar`, `estimate`, `meet`, `seed` and `settle` take every key from Task 1's
  `environment()`; each `Deno.env.get('SUPABASE_ANON_KEY')` and its throw go. `actDbs` and `estimateDbs` take
  `publishable` where they took `anon` (rename the field; the player connection is `postgrest({ key: publishable,
  bearer: session })`). `account`'s `gotrue` and its player connections use `publishable`.
- **Tests first.** `rpc.test.ts`: a service connection sends `apikey` and no `Authorization`; a player connection sends
  both, the session as the bearer. `gotrue.test.ts`, `storage.test.ts` and `broadcast.test.ts`: `apikey` alone, no
  `Authorization`. Each red before its change.

### Task 3. What `settle`, `meet` and `seed` accept

- **`fromTheService(request, jobs)`** reads the `apikey` header and compares it with `jobs` by `sameSecret`. It ignores
  `Authorization`. With `jobs` `null` it is false, and the three functions answer 401 with a plain body that names
  the missing key ("this project has no secret key named kayfabb_jobs") and log the same line. The body names a key's
  name only, never a value.
- **`settle/index.ts`, `meet/index.ts`, `seed/index.ts`** pass `env.jobs`.
- **Tests first** (`serve.test.ts`): the right key in `apikey` passes; in `Authorization` as `Bearer`, it fails;
  near-misses (one character short, one longer, case changed, empty) fail; a request carrying the `default` secret
  key while `jobs` is the named one fails (the poison: an implementation that accepts any secret key must fail it);
  `jobs` `null` fails every request, including one with no `apikey`.

### Task 4. `verify_jwt` off, and the player functions' gate held

- **`supabase/config.toml`.** A `[functions.<name>]` table with `verify_jwt = false` for each of the seven, under one
  comment saying why (the platform's check takes legacy keys only and breaks under asymmetric session JWTs; each
  function authorizes in its own code; the design's section 2).
- **The rule, written where it is kept.** Each of `act/index.ts`, `avatar/index.ts` and `estimate/index.ts` says in its
  header that nothing is done as the service before `whoami()`, read with the caller's session, names an account.
- **Tests first,** in each function's `core.test.ts`, one test each: with the player connection answering `whoami` as
  PostgREST answers a bad bearer (a 401, as `DatabaseError`) and, separately, as `null`, the answer is the function's
  401 ("sign in to …") and the service connection received no call. For `act`, the same for an action that is the
  player's own call (`decision.asService` false): the player's call is the one made, and the service's none. Drive
  each red once by planting a service read before `whoami()` and see it fail; remove the plant.
- **`act`'s work after the answer.** Read `handleAction` and `afterTheAnswer` (`act/core.ts`): a request refused at
  `whoami()` must schedule no drain and no hint check. If it does, that is a fix in this task, with its test (the
  refusal leaves `drain` uncalled).

### Task 5. The schedules send the jobs key

- **A new migration** (the next free number, `0066` when this plan was written), redefining with `create or replace`:
  - `schedule_settlement()` (from `0004_schedule.sql`) and `schedule_meeting()` (from `0047_meeting.sql`), each
    exactly as its latest definition, except the header: `'apikey', s.secret` in place of `'Authorization', 'Bearer ' ||
    s.secret`, and `s.secret` read from Vault's `kayfabb_jobs_key` in place of `kayfabb_service_key`. Grep every later
    migration for a redefinition of either before copying, and copy the latest.
  - Then `select schedule_settlement() where exists (select 1 from settings where key = 'settlementCron');` and the
    same for the meeting with `meetingCron`, so a database already seeded carries the new command.
  - Its header comment says what the two Vault secrets are now, and that `kayfabb_service_key` is read nowhere.
- **`tools/instance-files.mjs`.** `NOT_EXPORTED`'s Vault line names `kayfabb_jobs_key` and its `vault.create_secret`
  with the `kayfabb_jobs` key. `supabase/tests/e2e/0003-export.ts` matches the new names.
- **Tests first.** `supabase/tests/0009-schedule.sql`: the job sends nothing with no secrets and with half of them,
  then carries `apikey` equal to the Vault's `kayfabb_jobs_key` and no `Authorization`; it sends nothing when only
  `kayfabb_service_key` is set (the old name). The same for the meeting, in the test file that holds its schedule
  (`supabase/tests/0052-meeting.sql`, or a new file with the next free number if it reads better on its own). Red
  before the migration.

### Task 6. The web app

- **`web/src/data/backend.ts`.** Reads `VITE_SUPABASE_PUBLISHABLE_KEY`; the refusal names it. A key in the legacy
  shape (`eyJ…`) is refused at start, in the same plain words as the functions' message.
- **`web/src/data/supabase.ts`.** `anonKey` is renamed `publishableKey` through the file. `bearer()` returns the
  session's token or `null`; `edge()` sends `apikey` always and `Authorization` only when there is a token.
- **`netlify.toml`.** Its opening comment names `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **Tests first.** `web/src/data/backend.test.tsx`: the refusal names the new variable; a legacy-shaped key is refused.
  `web/src/data/supabase.test.tsx`: the tests that expected `Bearer ${ANON}` on a signed-out call now expect no
  `authorization` and `apikey` equal to the publishable key; signed in, the session's JWT is the bearer, as now.
- `ALLOWED_RPCS` and the bundle guards (`tools/check-web-reads.mjs`, `tools/check-web-bundle.mjs`) are untouched;
  confirm `npm run build` still passes them.

### Task 7. The operator's tools

- **`tools/instance-files.mjs` (`storage`).** Headers are `apikey: key` alone. A key in the legacy shape is refused
  before any request, naming `KAYFABB_STORAGE_KEY` and never its value. The usage lines and comments in
  `tools/export-instance.mjs`, `tools/import-instance.mjs` and `tools/sweep-avatars.mjs` say "a secret key".
- **Tests first.** `supabase/tests/e2e/0003-export.ts` and `0007-avatar-sweep.ts`: the stand-in Storage keys a request
  by `apikey` and answers 403 to one carrying the key only in `Authorization`; a legacy-shaped `KAYFABB_STORAGE_KEY`
  is refused with nothing fetched, and the output holds no key.

### Task 8. The deploy guide

Rewrite the key steps of "Deploying Divided World" in `README.md`:

- Step 2: note the `default` publishable and secret keys under **Settings > API Keys**, and create a second secret key
  named `kayfabb_jobs`. No legacy key is used anywhere.
- Step 6: the seed is called with the `kayfabb_jobs` key in `apikey` (`curl … -H "apikey: $KAYFABB_JOBS_KEY"`, read
  with `read -rs`). Vault holds `kayfabb_functions_url` and `kayfabb_jobs_key`.
- Step 7: Netlify's variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Step 9's export line: `KAYFABB_STORAGE_KEY` is the `default` secret key.
- "Known problems": the legacy-keys item goes, and the design's two open questions are named where they are checked
  (#130).

`npm run build` passes `tools/check-doc-references.mjs` on the new text.

### Task 9. The whole

- `npm run typecheck`, `npm run build`, `npm run test:sql` and `npm run test:e2e` pass.
- A grep of the repository's current code and current documents finds no `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY` or `kayfabb_service_key`, except in migrations before the new
  one and in records, which are left as written.
- The PR says `Closes #157`, and adds to #130's list: the self-hosted variable names and Storage's answer to `apikey`
  alone (the design's "Open").

## Ways out of the states this adds

No state is added for a player, a character or a post. For an operator: a project with no `kayfabb_jobs` key answers
the scheduled calls and the seed 401, naming the key; a project with no `kayfabb_jobs_key` in Vault sends no
scheduled call at all, as with no secrets today. Making the key, or the Vault secret, is the way out, and the next
scheduled minute runs.

## What could vary with a private fact, and how it does not

- **A player function's refusal** of a bad session comes from `whoami()` before anything about the target is read, so
  it is the same words and the same path whoever owns the target.
- **The service check** turns on the caller's key alone, compared in the same time whatever is sent.
- No payload, Realtime event or timing is added.

## Review focus

- **A service read before `whoami()`.** With `verify_jwt` off, any caller reaches each player function's handler.
  Read `act`, `avatar` and `estimate` end to end, including `boundedJson`, the form parse in `avatar` and anything
  in `act`'s `after` (the outbox drain, the hint check): nothing done as the service, and nothing costly, before the
  session names an account.
- **The latest definition copied.** The new migration's `schedule_settlement()` and `schedule_meeting()` must be their
  latest text with the header changed and nothing else; diff each against the definition it replaces.
- **No key in any message or log.** Every throw and every `console.error` added names a key's name, never its value;
  check the thrown errors in `environment()` and the tools' refusals.
- **`jobs` never falls back to `default` on the platform shape**, by any path, including a `SUPABASE_SECRET_KEY` that
  happens to be set beside `SUPABASE_SECRET_KEYS`.
- **The signed-out client.** A visitor's calls (the account function, the settings read) carry `apikey` and no
  `Authorization`; Realtime is listened to only with a session, so the 24-hour limit on connections without one never
  reaches a player.
