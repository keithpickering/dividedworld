# The publishable and secret keys: design

Record, written 2026-11-02. The design session for issue #157, held with the owner before the first deploy. It is
written against main at ac701e1: migrations up to `0065_hints.sql`. The plan is
`docs/plans/2026-11-02-api-keys-plan.md`.

## Why

Supabase's migration guide (https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys, read
2026-11-02) says the legacy JWT-based `anon` and `service_role` keys keep working until the end of 2026. Their
replacements are the publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys, which are not JWTs. KayfaBB
reads only the legacy keys:

- the Edge Functions read `SUPABASE_SERVICE_ROLE_KEY` (`supabase/functions/_shared/serve.ts`) and `SUPABASE_ANON_KEY`
  (`account`, `act`, `avatar`, `estimate`);
- `fromTheService()` compares `Authorization` with `Bearer <service key>`, and the settlement's and the meeting's jobs
  send the Vault's `kayfabb_service_key` that way (`0004_schedule.sql`, `0047_meeting.sql`);
- the web app sends the anon key as the bearer when nobody is signed in (`web/src/data/supabase.ts`, `bearer()`);
- `supabase/config.toml` leaves every function's `verify_jwt` on.

A deploy on the legacy keys would stop signing anyone in, landing any Act and running any schedule when they end. The
game has no players, so nothing is deployed on them; this is built before the first deploy, the way it should stand.

## What the platform does with the new keys

From Supabase's documentation, read 2026-11-02 (the migration guide; "Securing Edge Functions"; "JWT Signing Keys";
the self-hosting pages "New API Keys and Asymmetric Authentication" and "Envoy API Gateway", which describe the gateway
the platform runs):

- **Auth, the Data API, Realtime's REST API and Storage**: the gateway takes a new key in the `apikey` header and puts
  an internal JWT for its role in `Authorization` itself, unless `Authorization` carries a real session JWT, which it
  passes through. A `Bearer sb_…` in `Authorization` is replaced the same way, but the guide says to send the new keys
  in `apikey` alone.
- **Edge Functions**: the gateway passes the headers through untouched. The platform's `verify_jwt` understands the
  legacy keys only, and the signing-keys guide says it breaks under asymmetric session JWTs, which new projects use by
  default. So a function turns it off and authorizes in its own code.
- **The keys in a function's environment**: on the platform, `SUPABASE_SECRET_KEYS` and `SUPABASE_PUBLISHABLE_KEYS`,
  JSON objects of every key by its name (the first of each is named `default`). The CLI's local stack, and self-hosted
  Supabase, give one of each, as `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`.
- **Realtime**: a connection that is not upgraded with a user's session is limited to 24 hours. KayfaBB's channels are
  private and listened to only with a session (`0008_realtime.sql`), so this does not reach a player.

## What was decided

### 1. What the scheduled jobs and the seed present: a secret key of their own

Alternatives weighed:

1. **A secret key named `kayfabb_jobs`** (chosen). The owner creates it in the dashboard and stores it in Vault as
   `kayfabb_jobs_key`. `settle`, `meet` and `seed` accept only that key, read from `SUPABASE_SECRET_KEYS` by its name;
   where the environment has one secret key alone (local, self-hosted) it is that key. It rotates or is revoked without
   touching the key the functions reach the database with.
2. Any secret key the project holds (Supabase's own `auth: 'secret'`). Simpler, but a key leaked from anywhere else
   could run a settlement.
3. A shared secret of KayfaBB's own. Portable to any host, but a second secret to keep beside the named keys Supabase
   already gives.

On the platform `jobs` never falls back to `default`: that would be alternative 2 by another road.

### 2. How the player's functions know who calls: the database's check is the gate

Alternatives weighed:

1. **The database's check** (chosen). `act`, `avatar` and `estimate` already ask the database, as the player, who is
   calling (`whoami()`, `act/core.ts`, `estimate/core.ts`, `avatar/core.ts`) before any work as the service, and the
   database verifies the session; a forged or absent session is refused there with "sign in to …". The order is
   written down as a rule, in each function's header comment, and held by a test per function that sends a
   publishable key and a malformed token as the bearer and finds the refusal with no service call made. An act that is
   the player's own call (`decision.asService` false) is verified by the database on that call itself.
2. A JWT check in the function against `SUPABASE_JWKS`. A bad request is turned away one round trip sooner, but it is a
   second verifier beside the database's, with keys to cache and rotate, and a legacy HS256 shape to tell apart locally.
3. Auth's `/auth/v1/user` before every request. Simplest code, and a round trip on every Act, which a busy instance
   would feel.

### 3. The legacy keys: not accepted

Alternatives weighed:

1. **New keys only** (chosen). The functions read only the new variables and the web build only
   `VITE_SUPABASE_PUBLISHABLE_KEY`; a key in the legacy shape (a JWT, `eyJ…`) is refused with a plain message naming
   the key to use instead. One path, and nothing to remove in January.
2. Both, the new first. Works either way, and leaves a fallback that is dead code from January, guarded by tests of a
   path nobody should take.

### 4. The rest, confirmed with the owner in one section

- **One reader.** `environment()` in `supabase/functions/_shared/serve.ts` gives `{ url, secret, publishable, jobs }`:
  `secret` is the functions' own way to the Data API, Storage, Realtime and Auth (`SUPABASE_SECRET_KEYS.default`, or
  `SUPABASE_SECRET_KEY`); `publishable` is `SUPABASE_PUBLISHABLE_KEYS.default` or `SUPABASE_PUBLISHABLE_KEY`; `jobs`
  as in section 1. A missing key, or one in the legacy shape, stops the function with a message naming which key to
  make or use, never its value. No `index.ts` reads a key itself.
- **What the functions send.** `rpc.ts`, `gotrue.ts`, `storage.ts` and `broadcast.ts` send a key in `apikey` alone, and
  `Authorization: Bearer <session>` only when a player's session is there.
- **What the functions check.** `fromTheService()` compares the `apikey` header with `jobs`, in the same time whatever
  is sent, and ignores `Authorization`. `supabase/config.toml` sets `verify_jwt = false` for all seven functions.
- **The schedules.** A new migration redefines `schedule_settlement()` and `schedule_meeting()` to send the Vault's
  `kayfabb_jobs_key` in `apikey`, and schedules both again wherever their settings are held. `kayfabb_service_key` is
  read nowhere after it.
- **The web app.** `VITE_SUPABASE_ANON_KEY` becomes `VITE_SUPABASE_PUBLISHABLE_KEY`; `edge()` sends `apikey` always and
  `Authorization` only with a session.
- **The operator's tools.** `KAYFABB_STORAGE_KEY` is a secret key, sent in `apikey`, and a legacy-shaped one is refused.
- **The deploy guide** in `README.md` is rewritten for the new keys in the build's last task.
- **The guide in the meantime.** The guide written before this session (legacy keys, pointing at #157) lands in this
  design's pull request with the design and the plan. It is documentation, and it says plainly that it waits on #157.

## The rules this touches

- **The layers.** All of it is KayfaBB's own edge: `supabase/functions/_shared/`, the functions' `index.ts`, a
  migration, `supabase/config.toml`, `web/src/data/` and `tools/`. No instance content is involved, and no interface
  changes.
- **A response never proves a private fact.** Nothing new is computed from one. A refusal turns on the caller's own
  session or key; a player function's refusal for a bad session is the same words and the same path whoever the
  target was, since it comes before the target is read.
- **No player is ever stuck.** No state is added for a player. For an operator: a project without `kayfabb_jobs` (or
  without `kayfabb_jobs_key` in Vault) has its scheduled calls answered 401, or sends none, and the function's log and
  the guide name the key to make; making it is the way out, and the next scheduled minute runs.
- **Portable by construction.** The reader takes both the platform's named keys and the single keys of the local stack
  and self-hosted Supabase, so the way out keeps working.
- **Weigh a design at the scale of a busy instance.** Nothing here grows with players, characters or Acts: the same
  calls each request already makes, with other headers.

## Open

- Whether self-hosted Supabase's functions container is given `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`
  under those names. The docs name them for the CLI's local stack; the self-hosted pages name them in the gateway's
  `.env`. To confirm when an instance first self-hosts.
- Whether Storage on the platform answers a secret key in `apikey` alone with no `Authorization`, as the gateway pages
  say. To confirm on the first deploy, with the other checks gathered in #130.
