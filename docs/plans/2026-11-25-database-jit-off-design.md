Record, written 2026-11-25.

# JIT off for the whole database: design

A design session with the owner. It began as the investigation of issue #1091 (why `supabase/tests/0420-hot-posts.sql`
takes 6 s alone and 142 s after the files before it). That turned out to be a test artifact, recorded on #1091, and
along the way it found the product cost this design fixes. Its plan is `docs/plans/2026-11-25-database-jit-off-plan.md`.
Each decision below was asked one at a time and answered by the owner, except where a section says it is the session's
own choice. The owner confirmed the summary before the plan was written.

## 1. What was found

**#1091, the test artifact (no product change).** Measured on this container's Postgres 16.15 at main 01f08ba. In order
after 0000–0419, 0420's Task 6 block calls `pool_signals(now() - 1h, now() + 1h)` twice, at 70 s each (0.22 s fresh).
Inside it, the `quoted` read takes 60.7 s, against 0.23 ms on a fresh clone.

The cause is the partial index `acts_edits` (`where kind = 'edit'`), which is 3,903 pages for 5 live tuples:
`0393-forged-quotes-clock.sql` inserts 100,000 edits and rolls back, and `vacuum` frees pages without shrinking the
file. The planner estimates an index probe's pages as index pages × the fraction of tuples read, so it prices that
probe at 3,128 against a seq scan's 1,256. `acts_public`'s latest-edit probe becomes a seq scan of `acts`, and `quoted`
merge-joins the file's 40,000 posts, each paying a 1.4 ms scan.

Each of these alone restores the fast plan: `reindex index acts_edits`, removing the 4 edits earlier files leaked, or
moving the leaked Acts out of the window. Acts are append-only, so a deployed instance's `acts_edits` only gets dead
entries from aborted inserts and cannot reach this shape. #1096's clone per file removes it from the suite.

**The product cost (this design).** The session built a busy-instance fixture inside one transaction: 0420's 40,000
posts over 80 threads and 400 characters, 4,000 edits, a persona with 300 posts in the last five hours, and 600 replies
to them in the last hour, then `analyze`. On it the planner keeps the right plan (`acts_pkey` and `acts_edits` probes;
`quoted` executes in 22 ms). Even so:

| `pool_signals(now() - 1h, now() + 1h)` | per call |
|---|---|
| `jit = on` (Postgres's default) | 6.9 s, twice in a row |
| `jit = off` | 1.1 s, twice in a row |

The statement's estimated cost is about 788,000, over `jit_above_cost` (100,000) and `jit_optimize_above_cost`
(500,000). The estimate runs far above the real cost because `acts_public` is a union of two selects, each with its own
subqueries (`0357_post_veils.sql`). So every call compiles about 5.8 s of JIT for a read that takes under a second.

On the fixture, `quoted` alone executes in 22 ms and spends about 0.8 s compiling. Most of the 1.1 s left with JIT off
is `pool_named`'s folding of the window's words (602 distinct words, 1.18 s). That is its own accepted cost, outside
this design.

This is the mechanism `0368_client_reads_plan_once.sql` found for the client reads ("at about 200 thousand Acts
thread_page plans just above that line and spent about 2 s compiling a 15 ms read"). 0368 put `set jit = off` on each
client read. On main, 87 of 795 functions in `public` carry it, and none of the 22 `pool_*` reads, the System's other
reads (`system_digest`, `standings_season`, `patrol_sample`…), the actions, the triggers, or PostgREST's own selects on
`acts_public` (plan-once's open §7) do.

`pool_signals` is called by the chatter job (`supabase/functions/chatter/core.ts`) once per slot, over the past day, as
the service role. It runs on a schedule, never on a player's request. The cost grows with the window's Acts, which is
what the estimate scales with, and every Edge Function's read over `acts_public` takes the same risk.

Not measured: whether the deployed instance has JIT on. Postgres's default is on wherever it is built with LLVM, and
the session did not establish how the host builds it. `show jit;` there is the owner's read; a design session touches
no deployed database.

## 2. Where the setting lives: the database (the owner's choice)

A migration sets `jit = off` on the database it runs on:
`execute format('alter database %I set jit = off', current_database())`, so it never names an instance's database
(CLAUDE.md, "KayfaBB never knows which instance it runs"). A database-level setting is read by every new connection,
so every connection and every statement on any of them plans without JIT: PostgREST's pool, an Edge Function's RPC, a
trigger, a write, a client's select. New code needs nothing. 0368's per-function `jit = off` stays, as a second guard on
the client reads. The setting is the only thing the migration changes.

Weighed:
- **Per function, by a list** (0368's pattern widened): every stable function the Edge Functions call, kept by a check
  against a second list like `ALLOWED_RPCS`. Explicit, but a list to keep in step, and writes, triggers and
  PostgREST's selects stay uncovered. Also, a `set` clause on a function makes Postgres save and restore the setting on
  every call and stops a SQL function from being inlined. So it cannot go on the small per-row helpers
  (`version_hidden`, `ballot_secret`, `conceal_layer`) that the hot plans call per row.
- **Per API role** (`alter role service_role/authenticated/anon set jit = off`): narrower. But whether PostgREST applies
  an impersonated role's settings depends on its version and how the host configures it, so it is less certain to take
  effect.

JIT pays off for analytic queries over many rows. KayfaBB's reads are bounded reads by key, and its estimates run high
because of `acts_public`, so JIT costs it and never helps it. A self-hosted instance runs the same migration and gets
the same setting ("Portable by construction"). An export and import replays the migrations, so the setting comes back
with them.

## 3. How the suite proves it: clones copy what the migrations stored (the owner's choice)

`alter database … set` is stored for the database it names (`pg_db_role_setting`). `create database … template` does
not copy it (design `2026-11-25-sql-suite-split-design.md` §1). So after #1096, a clone holds only the settings the
runner gives it. A test reading `show jit` on a clone would therefore prove the runner's settings, not the migration's
("A test that builds its own subject cannot tell you the subject is missing").

So the runner's `cloneSql` first copies onto the clone every setting stored for its source database with no role
(`setrole = 0`), read from `pg_db_role_setting` on the server, then applies its own: the bounds, `track_functions`,
`kayfabb.client_rpcs`, and `kayfabb.scratch_url` naming the clone. Its own come last, so they win where both are set:
the template's `scratch_url` names the template, and the clone's must name the clone. The copy reads the source's
settings by name in the catalog and holds no list of them. So any database-level setting a later migration adds travels
to every clone without a runner change. The same `cloneSql` makes the end-to-end files' databases
(`supabase/tests/e2e/psql-db.ts`), so they get the copy too.

A new assertion file then states, on its own clone:
- the session reads `jit` as `off`;
- `pg_db_role_setting` holds `jit=off` for `current_database()` with no role, which tells the migration's setting apart
  from one a connection made for itself;
- with `jit_above_cost` lowered to 0 in the transaction, an `explain (analyze, format json)` of a small query carries no
  `JIT` key. Under `set local jit = on` the same explain does carry one, when `pg_jit_available()`; where JIT is not
  available, the file says so and asserts only the first two. This is what shows the setting does what it is for, not
  only that it is stored.

Weighed:
- **Read the catalog on the template only:** simpler, but every file would then run with JIT on, unlike an instance,
  so a plan-cost test would see a different machine than production.
- **A deployed check as well** (`tools/check-deployed-migrations.mjs` reading `show jit`): not chosen now. The first
  apply shows whether the host refuses the statement (§5), and the migrations comparison already says whether it was
  applied.

## 4. What the change keeps

No state a player, a character or a post can be put in is added, so there is no new way out to name. No response,
payload, Realtime event or timing is computed from a private fact: the setting is the same for every connection and
every caller, and it removes a per-call cost that never depended on who called. Statements return the same rows with JIT
on or off; only the time differs. All of it is engine: no instance content and no instance's name.

The test suite's timings change. A scale file whose statements cross `jit_above_cost` stops compiling. Files that set
`jit` themselves (`0372-origin-scale.sql` and `0410-post-plays-scale.sql` turn it off; none turns it on) are unchanged.

## 5. Open

- **Whether the host lets the migration role run `alter database … set`.** `jit` is a setting any user may change, but
  `alter database … set` also needs the database's owner, and the session did not establish which role owns the
  deployed database. If the host refuses it, the migration fails as it is applied and the deploy stops there, so it
  cannot pass unnoticed. The owner's first apply settles it; a refusal comes back to a design session.
- **How much the deployed instance gains.** `show jit;` there says whether JIT was on. If it was off already, the
  change only makes a self-hosted instance match.
- **`pool_named`'s folding** (1.18 s for 602 distinct words in an hour's window on the fixture) grows with a day's
  distinct words. It runs once a slot, and it is outside this design. Filed only if the owner wants it weighed.
