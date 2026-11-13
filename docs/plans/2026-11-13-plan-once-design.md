# Client reads plan once

Record, written 2026-11-13. The design session with the owner, after thread pages on the deployed instance went from
about a quarter of a second to about ten seconds. Its plan is `docs/plans/2026-11-13-plan-once-plan.md`. Each decision
below was asked one at a time and answered by the owner, except where a section says it is the session's own choice.
The owner confirmed the summary before the plan was written.

## 1. What was found

The owner saw slow thread loading on main and asked whether it was a recent update or the nano instance. Diagnosis,
read-only on the deployed instance and by replaying migrations on Postgres on localhost:

- **The deployed instance's edge logs.** `/rpc/thread_page` held a median of about 250 ms (p95 0.4 to 1.9 s) for the 24
  hours before 19:34 UTC on 2026-11-13. From the first call after (19:40) every call was slow: median about 9.7 s, p95
  up to 21 s, worst 37 s. Requests stayed at 2 to 19 in five minutes, as before. Every other RPC's median barely moved,
  but its p95 rose from about 0.4 s to 4 to 5 s: queued behind thread_page on the nano's CPU.
- **The deploy.** At 19:34 UTC the migrations through 0363 were applied; thread_page was redefined by 0356, 0357 and
  0361 in turn. The instance holds 104 Acts (46 MB), cache hit 100%: the data is not the cost.
- **Locally, migration by migration** (a thread of 33 posts and 34 card plays, the deployed shape): thread_page took
  about 45 ms through 0356, about 200 ms from 0357 (`0357_post_veils.sql`) on, and nothing later moved it.
- **Not thread_page's text.** 0356's text of thread_page, installed beside the current one on the 0357 schema, is as
  slow as the current one. Its statement on the 0356 schema: about 45 ms to plan and 27 ms to run. On the 0357 schema:
  about 190 ms to plan and 60 ms to run.
- **Why.** 0357 made `acts_public` a union of two selects over `acts`, each with its own subqueries on
  `post_veils_live`, under the concealment's lateral joins; the view's own comment says what it costs is planning.
  thread_page reads `acts_public` 17 times. A `language sql` function's statements are planned again on every call
  on the Postgres the instance runs (17), and every screen read the client calls is one.
- **A plan kept.** The same statement prepared once and executed with its plan kept runs in about 18 ms: faster than
  before 0357. Planning was always most of a page's cost; 0357 multiplied it.

So it is the update. The nano explains the size of the multiple (a shared CPU turns 200 ms of planning into seconds,
and the other reads queue behind it), not the regression.

## 2. Where the fix goes: plans are kept (the owner's choice)

Weighed:
- **Keep plans** (chosen). The screen reads become `plpgsql`, which keeps each statement's plan for the life of a
  database connection. Every page gains, and so does every later change to a view a page reads.
- **A cheaper `acts_public`.** Reshape the view so it plans fast again (for one, the veil as a table of covered Acts
  joined once). It reaches every reader of the view, the client's own selects included, but reopens the veil's design
  and its tests, and pages would still plan on every call.
- **Both**, the second as a separate design afterwards. Not chosen now; open (§7).

## 3. Which plan is kept: a fixed generic plan (the owner's choice)

Each converted function sets `plan_cache_mode = force_generic_plan`: one plan for each statement, built on its first
call on a connection, the same for every caller and every argument. The scale tests that call these functions then read
exactly the plan that runs on an instance, from their first call. Weighed: Postgres's default (`auto`), which plans the
first five calls on a connection for their values and then keeps a generic plan only if it looks no worse: it adapts,
but which plan runs depends on a connection's history, and the first five calls on every pooled connection still pay
full planning. The risk the choice carries: a plan made without the arguments' values. The existing scale tests are what
show it is still an index read at a busy instance's scale.

## 4. Which functions: every stable function the client calls (the owner's choice)

Every function in `ALLOWED_RPCS` (`tools/check-web-reads.mjs`, the one list of what the screens may call) that is
stable is `plpgsql` with the fixed plan, except one an exemption list names with its reason. Today that is 41 functions
written `language sql` (20 of them reach `acts_public` through a view or a function); the 20 already in `plpgsql` gain
the setting. Weighed: only the 20 that reach `acts_public`, which needs the check to find reach by reading function
bodies for names (`plpgsql` records no dependencies), and can miss an indirect read.

The exemption list starts empty: every one of the 41 carries `set search_path`, so none is inlined into a caller today,
and none is read by a policy (the session's own finding, from the catalog). The list exists for a later helper that must
stay inlinable, each entry with its reason. Volatile functions (the actions) are not touched: they write, and their cost
is not their planning.

## 5. What takes over from `begin atomic`'s dependencies (the owner's choice)

A `begin atomic` body records what it reads, so a migration that drops or renames a column or view a page reads fails
as it is applied. A `plpgsql` body is checked only when it runs. The guard that takes over: the SQL suite asserts, after
its last file (end-to-end files included), that every stable function in `ALLOWED_RPCS` was called at least once,
counted by Postgres's own function statistics (`track_functions`), which count a call in a rolled-back transaction and
are seen from another session (checked in this session). A page that reads something a later migration removed then
fails in whichever test calls it. No second list of call arguments is kept. Weighed: the `plpgsql_check` extension,
which reads bodies without calling them and catches more, but adds an extension every Postgres this runs on must have.

## 6. What the change keeps

The return shapes, argument names, `security definer` or invoker, `search_path`, grants and behavior of every converted
function are unchanged; each body is today's, with `#variable_conflict use_column` so that a name that is both a
parameter and a column means the column, as it did in SQL (the session's own choice; without it, `plpgsql` raises on
the ambiguity). No state a player, a character or a post can be put in is added. No response, payload, Realtime event or
timing is computed from a private fact: a plan is kept per connection, never per account, and is the same for every
caller; a connection's first call of a page is slower than its later ones whoever makes it. All of it is engine; no
instance content is involved.

## 7. Open

- The client's own selects on `acts_public` (11 in `web/src/data/supabase.ts`) are still planned on each request by
  PostgREST. If they show slow once this lands, a cheaper-to-plan `acts_public` is the design to take up (§2).
- After this is deployed, the same edge-log query (thread_page's median and p95 by hour, beside every other RPC's)
  says whether the instance is back under its old figures. A build session touches no deployed database, so the
  session that dispatches it, or the owner, reads that.
