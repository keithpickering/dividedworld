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
- The report (`report.html`, with `log.json`) is written under `rehearsals/`, which git ignores; the command prints its
  path. `npm run test:rehearse` runs the tests that need Postgres and libfaketime.
- A live run needs an Anthropic key in `ANTHROPIC_API_KEY`, passed from a variable rather than typed out, so the key
  never lands in a chat, a command line, the shell's history or a file (`tools/rehearse/key.ts`). In a cloud session
  whose environment holds the key as `DIVIDED_ANTHROPIC_KEY` (a session started after the variable was added):

  ```bash
  ANTHROPIC_API_KEY="$DIVIDED_ANTHROPIC_KEY" npm run rehearse -- season-opening --cap 5
  ```

  A cloud session's network proxy will not hold a credential for Anthropic's own API, so the key has to come from the
  environment. With no key set, a live run sends a placeholder, which only a proxy holding the key can replace. `--stub`
  and `--offline` never read the key.

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

## Getting Divided World ready for invites

Written 2026-11-11 from a read of the deployed project (read-only queries; nothing was changed there), `main` and the
open issues and pull requests. It says where dw.gripe stands, what blocks sending invites, and how The System's staff
and seasons are started and kept running. Tick an item off here when it is done, and correct this section when it
stops being true.

### Where the deployed project stands

- **The site** is up at dw.gripe on Netlify. Registration is `invite`, and no player has an invite yet.
- **The Supabase project** is on the free plan's Nano compute. It holds the migrations up to `0145_brighter_effects`;
  `main` has seven more (`0146` to `0152`). Its Edge Functions were deployed on 2026-11-09.
- **No scheduled job has ever reached a function.** Vault holds neither `kayfabb_functions_url` nor `kayfabb_jobs_key`
  (step 6.2 above), so `kayfabb-settle`, `kayfabb-meet`, `kayfabb-staff` and `kayfabb-chatter` run every day and send
  nothing (`supabase/migrations/0071_jobs_key.sql`). No settlement has been run since Season 1 opened on 2026-11-03,
  no meeting has been held and no model call has been made. This blocks the Aura loop as well as The System.
- **Season 1 was opened by an older seed.** Its Boss is `placeholder-hype-man`, which is now a test fixture and no
  longer in the roster, and the `bossRoster` setting still lists the four placeholders. A reseed does not change an
  open season's Boss: it sets one only where the season has none.
- **The only Mod Bot in office is "Hall Monitor (placeholder)"**
  (`instances/divided-world/system/personas/placeholder-monitor.ts`). A player would see that name.
- **The boards are General, The System and Staff Announcements.** "The System" is left over from before Staff
  Announcements took over as the staff's board. It holds the test threads, and the seed has no way to remove a board.
- **`KAYFABB_PROFILE` is `playtest`** (a three-week season). Under it a season has no reign: the honeymoon's 14 days
  and the meltdown's 21 overlap, so the meltdown starts on the day the honeymoon ends (`phaseAt`,
  `engine/system/phases.ts`). FanGaME's arc plays its first beat in the reign, so it could never play under the
  playtest profile.
- **`systemEnabled` is `true` on the database and `false` in `instances/divided-world/settings.ts`.** It was turned on
  by hand. The next seed writes the code's `false` back.
- **The data is test data:** 2 logins, 10 characters, 17 threads and 72 Acts.

### Supabase: upgrade or recreate?

The two are separate questions.

- **Compute.** Moving from Nano to Micro is done on the same project and needs no rebuild: move the organization to
  Pro, then choose Micro under **Project Settings > Compute and Disk**. The project restarts and is down for a few
  minutes. The Pro plan's compute credit covers Micro. Pro also turns on daily backups and stops the free plan from
  pausing a project after a week without activity, which an invite-only forum's quiet first week could trigger. The
  deploy steps above already assume Pro.
- **The data.** Start the game from an empty database. Season 1's Boss, the roster setting, "The System" board and the
  test Acts cannot be undone in place without hand-written SQL, because Acts are never deleted. Two ways to do it:
  1. **A new project** in the Pro organization, on Micro from the start, deployed from `main` with the steps above
     (2 to 8). It has to be set up again: Auth URL, SMTP and templates, the API keys, the Edge Function secrets, Vault,
     and the two `VITE_` variables on Netlify. The Resend domain stays as it is. The old project is deleted once the
     new one works. **This is the recommended way.** It is the documented path, and it is the first full run of the
     deploy steps.
  2. **The same project, wiped** with `supabase db reset --linked`, which applies every migration again to the remote
     database. It keeps the dashboard's Auth and SMTP settings, keys, secrets and Netlify's variables. Before relying on
     it, check what it does to `auth.users`, Vault, `cron` and the `avatars` bucket's files, and clear any that it
     keeps.

Either way, seed only when the boards, the roster and the profile below are settled on `main`. The seed opens Season 1
and starts the Boss's clock.

### Boards to start with

The seed writes the boards listed in `instances/divided-world/index.ts`, which holds this set (the owner chose it on
2026-11-11). Their descriptions there are drafts for the owner's review. A seed on a database that already has boards
adds the new ones and leaves the old ones as they are. Each new board also has five thread openers for rehearsals
(`instances/divided-world/rehearsal/corpus.ts`).

| Slug | Name | Notes |
|---|---|---|
| `general` | General | Already there. |
| `video-games` | Video Games | The community's home subject. |
| `movies-tv` | Movies & TV | |
| `art-showcase` | Art Showcase | Sprites, pixel art and drawings. |
| `pointless-post-palace` | Pointless Post Palace | Keep this name exactly. FanGaME's prompt names it as the one place he cannot understand, and The System's board names are made in its shape (`instances/divided-world/system/name-style.ts`). |
| `announcements` | Staff Announcements | Already there; only the staff post. |

- **Do not start with a fangame or game-making board.** FanGaME's first arc beat, the Split, creates his own fangame
  board and World -1 (PR #450). A fangame board that is already there would spoil the beat.
- **Keep the list short.** With a small cast, every board added makes each board look emptier. FanGaME's meltdown
  merges every board into World -1 anyway, and the next Boss inherits the work of sorting it out.
- Each new board needs a Mod Bot whose `beats` list it, or the bot that is assigned to visit posts there never comes.

### Personality Cores: from a draft to a staff account

A persona is a TypeScript file in `instances/divided-world/system/personas/`, and `fangame.ts` is the model to follow.
It holds a key, a name and title, a signature, a starting hobby, a temperament, `beats` (board slugs), `petRules`,
`strictness`, a `weakness` (quiz, bribe or distraction), pronouns, `persuadedBy`, per-office lines and a `selfPrompt`
built by `persona()`. The engine places that prompt inside the Boss's or the Mod Bot's premise for the office the
persona holds (`instances/divided-world/system/persona.ts`). A persona never has a login: it is a staff character with
no owner, which the seed makes.

To bring one live:

1. **Settle the draft with the owner.** The eight Mod Bot drafts in PR #444 (Flood Control 2.0, QC-1000, Mod Omega,
   The Splitter, GOLD-E, Officer Provisional, The Palace Keeper and Beamer) were written against an older `Persona`
   shape: they set `persona:` where `main` now uses `selfPrompt`. Each also lists only `general` as a beat. Choose who
   stays, and spread the beats over the new boards. The Palace Keeper suits the Pointless Post Palace, for example.
2. **Add it to the roster** in `instances/divided-world/system/index.ts`. `roster` is everyone. `firstBoss` is the
   season's first Boss (FanGaME). `firstStaff` is the Mod Bots who are hired at the seed and debut at once. A persona
   that is in the roster and in neither is **waiting**: it has no posts, no presence and no profile until it first
   takes an office (named Boss, or hired), or until an admin debuts it as a member
   (`docs/plans/2026-11-02-staff-roster-design.md`, section 2). Keep a future Boss waiting so that its arrival is its
   first appearance. Today a waiting persona's key can be read before its debut (issue #232).
3. **Take the placeholder out.** Replace `placeholder-monitor` in `roster` and `firstStaff` with the real Mod Bots.
   The SQL tests and fixtures that name it move to the fixtures, as the placeholder Bosses did.
4. **Merge, deploy the functions and seed.** The seed writes the roster's order into `bossRoster`, hires
   `firstStaff`, and seats `firstBoss` as Season 1's Boss.

What a persona then posts, and what pays for it (the numbers are settings in `instances/divided-world/settings.ts`):

- **Duty posts** have their own budgets. The Boss's daily meeting (`meetingCron`) spends moves from a bank that refills
  by phase (`phases.*.weeklyMoves`, `bankCap`). Mod Bot visits, patrols, report verdicts and appeals are capped per
  day under `modBots`.
- **Unprompted posts** come from one posting pool for the whole instance: `pool.weekly` posts a week (20), shared
  among every persona in office or on the board as a member. Triggers (being named or quoted, a hot thread on its
  beat, a successor stumbling, and others) nominate a persona, and a daily pick in plain code chooses, weighted by how
  strongly the crowd reacts to that persona's posts. `holdback` (20%) keeps slots for new personas. Pool posts run on
  the light tier, and the chatter job (`pool.chatterCron`) posts them.
- **Models.** `modelTiers` is Opus for the strong tier and Haiku for the light one. Every call lands in `model_calls`
  with its price, which is reconciled against Anthropic's bill monthly. Nothing calls a model unless `systemEnabled` is
  on and `ANTHROPIC_API_KEY` is set as an Edge Function secret.

Before going live, rehearse a season to see what it costs and how it reads: `npm run rehearse -- small-circle-reign
--stub` first, then a live run with a `--cap` (see "Rehearsing The System" above).

### The Boss and the seasons

**When the Boss arrives.** The seed opens Season 1 at the moment it runs, with FanGaME as its Boss, so the season clock
starts then. Seed shortly before the first invites go out. FanGaME's honeymoon (the first 14 days) is a soft opening:
he makes few, small moves and only *proposes* his Improvement Initiatives. That suits a founding cast who are still
finding their feet.

**How a season runs** (the full profile, `KAYFABB_PROFILE` unset: a three-month season):

| Phase | When | Moves a week | Bank cap | FanGaME's arc (PR #450) |
|---|---|---|---|---|
| Honeymoon | days 1 to 14 | 2 | 4 | Proposes, asks to be liked |
| Reign | day 15 to three weeks before the end | 5 | 10 | **The Split**, due a week into the reign: creates World -1 and his own fangame board. Then **Picking it apart**: moves threads, one at a time. |
| Meltdown | the last 21 days | 8 | 14 | **The great consolidation**: merges boards into World -1. **Everything is World -1**, due two days before the end: the forum ends as one board. |

Each day the Boss's meeting reads a digest of public play and chooses moves from a fixed list. A move that reshapes a
board (create, merge, rename, restrict) or permabans a character goes to `/admin/queue` and lands about 24 hours later
unless an admin holds it. Any landed move can be reversed there. Every move states its demand and when it expires.

**How a season ends.** At the season's length the settlement rolls it over: classes are revealed, results are posted,
and the handover runs. In its last meetings the outgoing Boss may name a successor in character. If it does not, the
next Boss comes from the roster by rotation, skipping the last `rosterRecentExcluded` Bosses. The outgoing Boss stays
on the board as a member and keeps posting from the pool. The new Boss reviews the moves it inherited; any it does not
address end after `inheritanceGraceDays`. See `docs/plans/2026-10-31-seasonal-boss-design.md` and
`docs/plans/2026-11-06-season-end-design.md`.

**Keeping it running, season over season:**

- **A second Boss must exist before Season 1 ends.** With FanGaME as the only Boss, the rotation today seats whichever
  persona is next on the roster, a Mod Bot included (issue #434). Write the next Boss as a waiting persona during
  Season 1, together with its arc beats if it has a planned arc.
- Each season, keep a waiting Boss or two ahead of the rotation, and add Mod Bots as the boards grow.
- Daily: glance at `/admin/queue` for structural moves. Monthly: reconcile `model_calls` against the Anthropic bill.
- Raise `pool.weekly` as the cast grows. It is a setting, and the seed puts back the code's value, so change it in
  `instances/divided-world/settings.ts`.

### Blockers before invites, in order

**On the Supabase project** (the owner's to run):

- [ ] Move to Pro and Micro, and start from an empty database (above).
- [ ] Deploy from `main` (migrations, functions) and run `supabase migration list` until every row matches.
- [ ] Add **both** Vault secrets (step 6.2), then confirm that a settlement row appears after the next `settlementCron`.
  `kayfabb_functions_url` is the project's address, `https://<ref>.supabase.co`, with no trailing slash.
  `kayfabb_jobs_key` is the value of the secret API key named `kayfabb_jobs`, under **Project Settings > API Keys**
  (create it there if it is not listed; step 2.3). Paste it into **Integrations > Vault** only, never into a chat or
  a file. The same key goes in `apikey` when you call the seed.
- [ ] Set `ANTHROPIC_API_KEY`. Leave `KAYFABB_PROFILE` unset for the full season, unless the owner decides otherwise.
- [ ] Run issue #130's checks against the real project, including issue #3 (whether Auth's own endpoints show that an
  address has an account).

**In the code, before the seed:**

- [x] The starting boards in `instances/divided-world/index.ts`.
- [ ] The real Mod Bots in the roster, and the placeholder out of it (PR #444, then wiring).
- [ ] PR #450 (season arcs, bundled moves, FanGaME's split) merged. Its migrations, `0150` to `0170`, collide with
      `main`'s `0150` to `0152` and need renumbering. Without it, FanGaME is Boss with only the generic moves, and his
      arc never plays.
- [ ] `systemEnabled: true` in `instances/divided-world/settings.ts`, which is The System plan's Task 13, "Turning it
      on" (`docs/plans/2026-10-30-the-system-plan.md`). Setting it by hand does not last past the next seed.

**Questions for the owner that bear on The System being on:**

- [x] Issue #315: an admin cannot reverse a Mod Bot's infraction or ban. The owner (2026-11-11): not crucial, but
      build it before The System is turned on if it is easy.
- [ ] Issue #434: who is Boss after FanGaME (it does not block day one, but it must be settled within the first season).
- [x] Issue #232: should waiting personas be hidden from the public office view, so a debut stays a surprise? The
      owner (2026-11-11): yes, hide them until they drop. That is option (b): the public view leaves waiting personas
      out, and the admin path reads them through its own function. It is still to be built.
- [ ] Issue #459: does a beat count as landed while an admin holds one of its parts? (It comes from PR #450.) The
      owner wants the Boss to play its arc by ear. The recommendation is option 3: a beat counts as landed once every
      part that was not held or refused has landed, and at least one part has. This holds for every arc without
      per-arc wiring, and the Boss's own free composition covers whatever the held part would have done.

**Worth landing before real people arrive, though they do not block:** PR #428 (the code of conduct, conduct reports
and decisions by email, the real-moderation path for real people); PR #333 (the tip that tells a newcomer what the
Personality Cores are); issue #403 (a quote can be forged without the shaky styling).

**Process, once the instance is live:** the "Merging" permission in `CLAUDE.md` is worded for while no instance is
deployed, and issue #243 adds migrations and functions to the daily release "when the first instance is deployed".
Both are now due, and the `CLAUDE.md` change is the owner's to approve.
