# dividedworld

**Divided World** (dw.gripe) is a kayfabe forum game: a message board where each person plays several masked
characters with hidden classes, everything anyone does is a public Act, and an arbitrary machine, The System, runs the
board. It is built on **KayfaBB**, an open-source engine that lives here until it is first published.

The engine's core loop is built (`docs/plans/2026-10-28-core-loop-engine-plan.md`), and the screens are being built
(`docs/plans/2026-10-29-screens-web-plan.md`). Where things stand:

- `spec.md`: the MVP specification the owner wrote with Gemini, read as input, not as the plan.
- `docs/plans/2026-10-28-kit-step-1-design.md`: the premise, nouns, stack and method decided from it, and what the spec
  review left for the design sessions ahead.
- `CLAUDE.md`: the working rules every session follows.
- `engine/`: KayfaBB's rules as pure TypeScript (`engine/rules/`: the instance interface, votes, the settlement, the
  actions and cards) and its BBCode parser (`engine/bbcode/`). It never imports an instance.
- `instances/divided-world/`: Divided World's classes, cards, reactions, settings and words, plugged into the engine.
- `supabase/migrations/`: the schema, its policies and its SQL functions, in plain SQL.
- `supabase/functions/`: the Edge Functions (`act`, `account`, `settle`, `seed`), the one place that imports both the
  engine and an instance.
- `engine/ui/`: KayfaBB's screens in React; `instances/divided-world/ui/`: Divided World's theme and words for them;
  `web/`: the Vite app where the two meet (`npm run dev:web`, `npm run storybook`, and `npm run test:e2e` for the
  keyboard flows in `e2e/`, which need a browser).
- `npm run build`: the guard chain (`tools/build.mjs`), which CI runs on every ready pull request.
- `npm run test:sql`: the migrations replayed into a scratch database on a local Postgres, with the assertion files and
  end-to-end tests in `supabase/tests/` (`tools/test-sql.mjs`; it refuses any database but localhost).
- `tools/export-instance.mjs` and `tools/import-instance.mjs`: an instance's every table, private ones included, out to
  a directory and back into a fresh instance.

## Rehearsing The System

A rehearsal runs the real schema and the real scheduled jobs on a Postgres of its own, on a fake clock, through a
scenario's days, with filler players acting as people would (`docs/plans/2026-11-11-system-rehearsal-design.md`). It
needs Linux, the Postgres binaries under `/usr/lib/postgresql/*` and libfaketime (`apt-get install -y postgresql
faketime`). It touches no deployed database.

    npm run rehearse -- small-circle-reign --stub --days 2

- `--stub` makes no model call and costs nothing; the build and CI use it. Without a mode flag the run is `record`: it
  replays any answer already in the cassette (`rehearsals/<scenario>/cassette`) and makes live, paid calls for the
  rest. `--offline` replays only; `--fresh` ignores the cassette.
- The cap (`--cap DOLLARS`, default the scenario's `costCapDollars`) counts live calls only, never a replayed one, and
  a run passes it by at most one job.
- Other flags: `--days N`, `--seed N`, `--profile playtest`, `--keep` (leave the cluster running, with the commands to
  reach it), and any scenario field as `--players 6` or, for a range, `--postsPerDay 1-3`.
- `--strong <model>`: the strong tier's model for this run, one the Anthropic price table lists
  (`supabase/functions/_shared/models/prices.ts`); left out, the instance's. The report and `log.json` name it.
- `--light <model>`: the same for the light tier.
- The report (`report.html`, with `log.json`) is written under `rehearsals/`, which git ignores; the command prints its
  path. `npm run test:rehearse` runs the tests that need Postgres and libfaketime.
- A live run needs the Anthropic key stored on the environment as a credential, added through the secure form, never
  pasted into a chat, a command line or a file.

## Deploying Divided World

This is the first deploy of dw.gripe, from nothing: a Supabase project for the database, Auth, Storage, Realtime, the
Edge Functions and the schedules; a Netlify site for the web app; and Resend for the sign-in emails, through Supabase
Auth's custom SMTP. It assumes a Pro plan on Supabase and on Netlify, and a Resend account. Every step is the owner's
to run: no session touches a deployed project ("A standing permission is written down, or it is only remembered" in
`CLAUDE.md`).

Before the first step, read the known problems at the end of this section.

KayfaBB takes Supabase's publishable and secret keys (`sb_publishable_…`, `sb_secret_…`) and no legacy JWT key
anywhere: a function, the web app and the export tools each refuse a key in the legacy shape, naming the key to use
instead (`docs/plans/2026-11-02-api-keys-design.md`).

### What you need on your own machine

- Node 22 and this repository, with `npm ci` run in it. Run `npm run build` once; it should end green.
- The Supabase CLI. `npx supabase` runs it without installing anything; the steps below write `supabase` for short.
- `psql`, which `tools/sweep-avatars.mjs`, `tools/export-instance.mjs` and `tools/import-instance.mjs` call.
- Access to dw.gripe's DNS.

### 1. Resend: a sending domain

1. In Resend, add the domain `dw.gripe` (or a subdomain such as `mail.dw.gripe`, if you would rather keep the root's
   mail records clear). Add the DNS records Resend lists (the DKIM `TXT`, and the `MX` and SPF `TXT` on its `send`
   subdomain) wherever dw.gripe's DNS lives, and wait until Resend shows the domain as verified.
2. Create an API key with **Sending access** only, restricted to that domain. It is the SMTP password in step 4. Keep
   it in your password manager; nothing in this repository stores it.

### 2. Supabase: the project

1. Create a project in your Pro organization. Choose the region nearest the players, and a strong database password,
   which goes in your password manager.
2. Note the project's ref (the `<ref>` in `https://<ref>.supabase.co`).
3. Under **Project Settings > API Keys**, note the `default` publishable key and the `default` secret key. Then
   create a second secret key named `kayfabb_jobs`: the scheduled jobs and the seed call the functions with it, and
   `settle`, `meet` and `seed` accept no other key, so it can be rotated or revoked without touching the key the
   functions reach the database with. Both secret keys go only where these steps say. No legacy key is used anywhere.
4. Stay on the `<ref>.supabase.co` address. A custom Supabase domain would be refused by the site's
   Content-Security-Policy, which allows `https://*.supabase.co` and `wss://*.supabase.co` alone (`netlify.toml`, kept
   equal to `web/headers.ts`); adding one means changing both in a pull request first.

### 3. Supabase: the schema

From the repository's root:

```bash
supabase login
```

```bash
supabase link --project-ref <ref>
```

```bash
supabase db push
```

`db push` applies every file in `supabase/migrations/` in order. They create the extensions they need (`pg_cron`,
`pg_net`, `pgcrypto`), the tables, policies and functions, the Realtime policies, and the `avatars` bucket. A fresh
project holds no avatar from before `0025_avatars.sql`, so the bucket is public from the start (issue #20).

Then compare the repository's migrations with the project's ("A test that builds its own subject cannot tell you the
subject is missing"):

```bash
supabase migration list
```

Every row should show the same version under Local and Remote. Run it again after every later deploy. From this
first push on, a migration a database holds is never edited in place; a change is a new migration.

**Do not run `supabase config push`.** `supabase/config.toml` holds the Auth settings the code relies on, but not
yet SMTP, rate limits or token lifetimes, and a push writes the CLI's default over every setting the file leaves out,
which would switch the Resend SMTP off. Step 4 sets Auth in the dashboard instead, to the values the file holds.

### 4. Supabase: Auth and email

In the dashboard, under **Authentication**:

1. **URL Configuration**: Site URL `https://dw.gripe`, no extra redirect URLs.
2. **Sign In / Providers > Email**: email enabled, **Confirm email** on, password sign-in irrelevant (every login's
   password is kept empty by `0012_passwordless.sql`), **Email OTP Expiration** `3600` seconds and **Email OTP
   Length** `6`. Leave new sign-ups allowed: accounts open only with an invite, through the `account` function.
3. **Emails > SMTP Settings**: enable custom SMTP with host `smtp.resend.com`, port `465`, username `resend`, the
   Resend API key from step 1 as the password, the sender `noreply@dw.gripe` (on the domain you verified) and the
   sender name `Divided World`.
4. **Emails > Templates**: set **Magic Link** to the subject `Your Divided World sign-in code` and the body of
   `supabase/templates/sign-in.html`, and **Confirm signup** to `Your Divided World sign-up code` and the body of
   `supabase/templates/sign-up.html`. Both must keep `{{ .Token }}`: the `account` function signs in with the code.
5. **Rate Limits**: with custom SMTP on, raise the emails-per-hour limit to what a sign-up evening needs; a few
   dozen an hour is plenty for a small circle.

Send yourself a code from the site once it is up (step 8) and check that it arrives from your domain.

### 5. Supabase: the Edge Functions

The functions are `account`, `act`, `avatar`, `estimate`, `meet`, `seed` and `settle`. Supabase gives each of them
`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` itself, every key of each kind by its name; the
functions take the ones named `default`, and the secret key named `kayfabb_jobs` as the only key the scheduled calls
may carry (`supabase/functions/_shared/serve.ts`). A function with no `default` key of either kind stops and says
which key to make; `settle`, `meet` and `seed` with no `kayfabb_jobs` key answer every call 401, naming it. Set the
rest as secrets, under **Edge Functions > Secrets** or with the CLI:

- `ANTHROPIC_API_KEY`: the model provider's key for The System. It is read only while the instance's `systemEnabled`
  setting is on, which Divided World ships off (issue #73 turns it on); setting the key now does no harm.
- `KAYFABB_PROFILE`: `playtest` for the playtest's three-week season and seven-day Turn cooldown; leave it unset for
  the full game's numbers. Any other value is refused (`supabase/functions/_shared/instance.ts`).

Then deploy all seven:

```bash
supabase functions deploy --use-api
```

The deploy reads `verify_jwt = false` for each function from `supabase/config.toml`: the platform's JWT check takes
the legacy keys only, so every function checks its caller in its own code. In the dashboard, each function's
**Details** should show **Enforce JWT verification** off.

The functions import the engine and the instance from outside `supabase/functions/` (`engine/`, `instances/`).
Whether the CLI bundles those is one of the checks for the first deploy (issue #5, gathered in #130); if a deploy says
a module is not found, stop there and file what it printed.

### 6. Supabase: the instance and its schedules

1. **Seed the instance.** This writes Divided World's settings, classes, reactions, cards and boards, opens the first
   season, and, through the settings' triggers, schedules the jobs. Run it with the `kayfabb_jobs` secret key in your
   shell's environment, never typed into a file. `read -s` takes it without echoing it or keeping it in the shell's
   history:

   ```bash
   read -rs KAYFABB_JOBS_KEY
   ```

   ```bash
   curl -sS -X POST "https://<ref>.supabase.co/functions/v1/seed" -H "apikey: $KAYFABB_JOBS_KEY"
   ```

   It answers with how many settings, classes, reactions, cards and boards the instance holds. Seeding is safe to run
   again, and every deploy that changes the instance's settings or vocabulary runs it again; it puts back the code's
   numbers over any an admin tuned by hand.
2. **Give the jobs their address and key.** The settlement and the meeting are called by `pg_cron` through `pg_net`
   with two secrets from Vault (`0071_jobs_key.sql`); until both exist those jobs send nothing. In **Integrations >
   Vault**, add `kayfabb_functions_url` with the value `https://<ref>.supabase.co` (no trailing slash), and
   `kayfabb_jobs_key` with the `kayfabb_jobs` secret key, which the jobs send in `apikey`. The Vault screen keeps the
   key out of the SQL editor's history. The next scheduled minute after both exist runs.
3. **Check the schedules.** In the SQL editor:

   ```sql
   select jobname, schedule, active from cron.job order by jobname;
   ```

   It should list `kayfabb-meet`, `kayfabb-settle`, `kayfabb-system-tick` and `kayfabb-view-counts`. After the first
   settlement time has passed (`settlementCron` in `instances/divided-world/settings.ts`),
   `select * from cron.job_run_details order by start_time desc limit 10;` and the `settle` function's log say whether
   it ran.

### 7. Netlify: the site

1. Add a new site from this GitHub repository, with `production` as its production branch, not `main`. If
   `production` does not exist yet, dispatch **Release** once from the Actions tab first (step 4 says why).
   `netlify.toml` already says the build command (`npm run build:web`), the published directory (`web/dist`), Node 22,
   the single-page redirect and the security headers; leave those fields as the file sets them.
2. Under **Site configuration > Environment variables**, set `VITE_SUPABASE_URL` to `https://<ref>.supabase.co` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` to the `default` publishable key. Both are public by design; no other variable
   belongs here, and no secret key ever does. A build without the two succeeds and the app refuses to start, saying
   so.
3. Deploy, then under **Domain management** add `dw.gripe`, point its DNS at Netlify as Netlify says (or move the
   domain's DNS to Netlify), and let Netlify issue the certificate. Turn on **Force HTTPS**.
4. `production` is moved only by the Release workflow (`.github/workflows/release.yml`), once a night: it builds
   `main`'s head, runs the SQL suite and the e2e flows on it, and only then fast-forwards `production`. `main` is a
   branch deploy the team can see. Under **Site configuration > Build & deploy > Branches and deploy contexts**, add
   `main` as a branch deploy.

### 8. The first admin, and the first invites

Divided World opens an account only with an invite, and an invite is made by someone who already has an account, so
the first account is opened with registration briefly open.

1. In the SQL editor, open registration:

   ```sql
   update settings set value = '"open"' where key = 'registrationMode';
   ```

2. On https://dw.gripe, sign up with your own address and type the code from the email. Your account opens.
3. Make that account an admin, and close registration back to invites by seeding again (step 6.1), which writes
   `invite` back:

   ```sql
   insert into admins (account) select id from auth.users where email = '<your address>';
   ```

4. Sign in again and make invites for the players. An admin holds any number of open invites.

### 9. After the first deploy

- Work through issue #130, the checks that could only be made against a real project, and record each one where it
  lives.
- Every later deploy is the same in a shorter order: `supabase db push` and `supabase migration list` when there are
  new migrations, `supabase functions deploy --use-api` when the functions, the engine or the instance changed, the
  seed when the instance's settings or vocabulary changed, and the Release workflow moves the site once a night, or
  when you dispatch it. Migrations and functions are not in the release yet. They join it when the first instance is
  deployed (issue #243).
- Keep an export. `tools/export-instance.mjs` writes every table and every avatar to a directory only you can read,
  and `tools/import-instance.mjs` brings it back into a fresh project. Use the database's session-pooler connection
  string from the dashboard's **Connect** dialog as `--from`, and the `default` secret key in `KAYFABB_STORAGE_KEY`.
  The export holds who plays every character, so keep it as private as the database.
- The ledger of model calls (`model_calls`) is to be reconciled against Anthropic's bill monthly ("Cost is a column,
  not a report").

### Known problems before the first deploy

- **Two things about the new keys are confirmed only on a real project (issue #130).** Whether Storage on the
  platform answers a secret key in `apikey` alone, with no `Authorization`, as the gateway's documentation says (the
  avatar function and the export tools rely on it); and, for an instance that self-hosts, whether self-hosted
  Supabase gives its functions container `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY` under those names.
- **Auth's own endpoints are reachable with the public key (issue #3).** Whether Supabase Auth answers an address it
  knows measurably differently from one it does not is to be measured on the deployed project before players arrive.
