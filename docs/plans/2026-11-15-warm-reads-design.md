# Reads find a warm connection

Record, written 2026-11-15. The design session with the owner, after `docs/plans/2026-11-13-plan-once-design.md`
(migration `0368_client_reads_plan_once.sql`) and `docs/plans/2026-11-14-veil-cover-design.md` (migration
`0371_veil_cover.sql`) were both deployed and thread pages on the deployed instance still answered 500 with statement
timeouts. Its plan is `docs/plans/2026-11-15-warm-reads-plan.md`. Each decision below was asked one at a time and
answered by the owner, except where a section says it is the session's own choice. The owner confirmed the summary
before the plan was written.

## 1. What was found

The owner could reproduce the 500s by clicking in and out of threads, suspected the hover prefetch, and asked whether
the nano instance is the bottleneck. The session reproduced the failure on the deployed instance from the owner's
signed-in browser, read the project's logs and reports, ran read-only statistics queries in the SQL editor, and
measured the rest by replaying every migration through `0372_origin_in_page.sql` on Postgres 17.11 on localhost with
fifteen threads of twenty posts and five card plays each.

- **The failure is a statement timeout, and it is not only thread_page.** Between 08:41:16 and 08:41:55 Postgres
  cancelled 19 statements at the API role's 8 s limit: `thread_page` 6, `profile_page` 6, `here` 5,
  `claim_card_writes` 1. A presence write that times out is waiting on the machine, not on its own work.
- **It is memory.** Over the incident the project's report shows CPU in single digits with IO-wait spikes, swap
  rising from its standing 450 MB to about 700 MB, and memory commitment rising from 1.44 GB to 1.87 GB on about
  0.47 GB of RAM. The veil-cover design found the same instance at its limit (its §1).
- **No burst is needed.** Fifteen `thread_page` reads started one at a time, each after the last had answered, took
  1.0, 1.0, 1.0, 2.0, 2.6, 1.3, 1.7 and 1.9 s, then failed: six 500s in 44 s, with nine cancellations in the Postgres
  log. Every read was slower than the one before.
- **Nearly every call is a connection's first call.** This is the question the veil-cover design left open (its §7,
  "The API's pool"). The Data API's pool was on automatic and held ten connections: one that listens, and nine for
  requests. Each of the nine was between 27 and 97 s old and had last been used in the first second of its life. The
  API hands a request the connection that has been idle longest and replaces one that has been idle past its limit
  (PostgREST's `db-pool-max-idletime`, 30 s by default), so at an instance's ordinary traffic a request gets a
  connection that has never planned anything. That the pool takes the longest-idle connection is the session's
  reading of the ages it saw; PostgREST's documentation does not say.
- **So kept plans were the worst of both.** 0368 keeps each page's plan for the life of its connection. With each
  connection used once, every call pays the planning, and every connection then holds the plan until it is closed.
  The fifteen sequential reads filled nine connections with kept plans one after another, each needing its own
  planning burst on a machine with less memory than the last.
- **What a first call costs, locally, with 0371 and 0372 in place.** Planning thread_page's one statement uses 59 MB
  (`explain (generic_plan, memory)`); the backend's private memory peaks at 107 MB during the call and holds 25 MB
  after it. The memory a connection's contexts hold after each page's first call, measured three times on fresh
  connections and identical each time: 18.3 MB after thread_page, 20.2 after profile_page as well, 24.1 after
  board_page, 25.8 after index_page. A second call on the same connection takes 16 ms where the first took 324.
- **Where the planning goes.** thread_page's statement reads `acts_public` 15 times. One read of the view plans in
  2.3 MB; fifteen are about 35 MB of the 59. With `acts_base` (no veil) in its place the statement plans in 30 MB.
  `thread_list` (5.5 MB), `thread_open` (4.6) and `character_post_counts` (4.5) are the next largest.
- **Hover is a multiplier.** The General board's page holds 74 links a pointer's rest reads ahead (41 to threads, 33
  to profiles). `Link` (`engine/ui/router.tsx`) starts a link's whole page read after the pointer rests 100 ms, and the
  router holds up to twenty at once. A read the router gives up on is not stopped: the Supabase adapter
  (`web/src/data/supabase.ts`) passes no signal to a request. Card buttons read ahead the same way through
  `usePrepared` and `useRest` (`engine/ui/glass/prepared.ts`).
- **A timed-out read is sent again.** The adapter's `transport` reads every 5xx as a transport failure and sends the
  read once more. A statement timeout arrives as a 500 that carries Postgres's code 57014, so each cancelled 8 s read
  was followed by a second.
- **Timings on localhost were not trusted.** The machine was busy during the session and a cold thread_page ranged
  from 0.3 to 2.6 s. The memory figures did not move, and the design rests on those.

So the regression is as the two earlier designs found, and what turns it into failures is that a plan is kept on a
connection that is never used again, on an instance with no memory for ten of them.

## 2. The test on the instance: a pool of two

The owner had the session set the Data API's pool size to 2 on the deployed project and run the same reads.

| Run | Pool of 10 (automatic) | Pool of 2 |
|---|---|---|
| 15 reads, one at a time | 44 s, six 500s | 6 s, none failed: 670, 659 and 397 ms, then 126 to 246 ms each |
| 20 reads at once (15 threads, 5 profiles) | timeouts at this load in the owner's runs | none failed; 2.5 to 5.0 s each, queued on the two connections |
| A page's own reads on a reload | boot 432 ms, the board 441 ms | boot 371 ms, the board 357 ms |

After the change the API held two request connections and one had been used across 19 s. A small pool does two
things: its connections are reused, so a kept plan is used; and at most two plannings run at once, so the memory a
burst can ask for is bounded. The burst shows what the pool does not fix: nothing fails, but a click made during it
waits behind the reads ahead.

The pool was left at 2 at the owner's word (§3).

## 3. The pool is declared, and the release sets it (the owner's choice)

An instance declares its Data API pool, and the nightly release keeps the deployed project at what is declared.
Weighed:
- **Declared and checked** (chosen). The value is in the repository, the README's deploy steps say what it is for,
  and the release compares the deployed value with it, so it cannot go back to automatic unnoticed.
- **The owner's by hand, not designed.** The design would then rest only on what code can do. Not chosen: the test
  shows the pool is what makes the kept plans work, and a setting nobody wrote down is one that drifts.
- **Cleared, decided later.** Not chosen: the instance returns to timing out.

**The release sets it, then checks** (the owner's choice). Weighed: check only, with the owner setting the values by
hand. Chosen because the repository is the source, as it is for migrations, and because the idle time is not on the
dashboard at all. The release writes a value only where the deployed one differs, so a night with nothing to change
writes nothing and does not restart the API's pool.

**What Divided World declares:** a pool of 2 and an idle time of 60 s. The idle time is the session's own choice,
confirmed by the owner: it is the most Supabase's management API takes (0 to 60, 30 by default), and it keeps a
connection through a quiet minute, where the schedules' own calls arrive once a minute.

**How a larger instance chooses.** The README gives the arithmetic: each pooled connection comes to hold a kept plan
for every page type it has served (about 26 MB today, and the cold-read budget of §6 is what keeps that figure
known), and each planning needs about 105 MB for a moment; the pool times the first, plus the second for each
connection that could plan at once, has to fit beside Postgres's own memory. An instance on a compute size with
memory to spare declares a larger pool, or `null` for Supabase's automatic one. Small is a choice of play; the pool is
sized to the machine, never to the cast.

## 4. One read ahead at a time (the owner's choice)

A pointer's rest or the keyboard's focus starts a read ahead only when no other read ahead is in flight in that
browser tab. While one is, the trigger rested on most recently waits, and starts when the one in flight answers if
the pointer or focus is still on it; a trigger that is left gives up its place. A press or a click never waits: it
joins its own trigger's read if that is out, or starts its own at once. Weighed:
- **One at a time** (chosen). With a pool of two, one connection reads ahead and one serves the click.
- **On press only.** Nothing is ever read on a guess, and a click gains only the time between press and release.
- **Hover capped at three, with a 250 ms rest.** More reads land before their click, but three can fill a pool of two
  and make a click wait.

**One gate for links and card buttons** (the owner's choice). The router's `Link` and the card triggers that use
`useRest` and `usePrepared` (card forms, the Lens, the play actions) share the gate. Weighed: links only, since a card
button's read is lighter and each button holds at most one. Chosen because the bound is about the two connections,
not about what was hovered.

A read ahead that never answers stops holding the gate at the router's own load limit (twenty seconds). The answers
the router keeps (thirty seconds, at most twenty) are unchanged. Nothing a player sees changes: no control, no text
and no timing a player is told about.

**No signal is passed to the requests** (the session's own choice, confirmed by the owner). It was not established
that the API stops a query when the browser drops the request, and with one read ahead at a time there is no longer a
crowd of abandoned reads to stop.

## 5. A statement timeout is not sent again (the session's own choice, confirmed by the owner)

The adapter still retries a read once on a 5xx or on a fetch that never answered. A response that carries a Postgres
error code is a database error, and is thrown at once, as CLAUDE.md says of one ("Three unrelated timeouts are not a
poison pill"). A statement timeout is the database saying it had no room; a second copy of the read at that moment
is the wrong answer to it. The API's own errors (codes that begin `PGRST`, a pool that is full among them) and a
gateway's 5xx carry no Postgres code and are retried as before. CLAUDE.md is not changed.

## 6. A budget on a cold read (the owner's choice)

Both earlier designs recorded that this regression had no guard. The SQL suite gains an end-to-end file that
measures, for each screen function, the memory a fresh connection's contexts hold after that function's first call
(`pg_backend_memory_contexts`, read before and after), against a budget recorded for that function. Weighed:
- **A budget for each page read** (chosen). It names the function that grew.
- **One figure for the whole pool**: what a connection holds after every page type, times the declared pool, under a
  share of the declared compute's memory. Simpler, and silent about which function grew.
- **No check.** A later change to a view could bring the cost back unnoticed, as 0357 did.

What is measured is what a connection keeps, not the peak of the planning. It is the figure the pool's arithmetic
needs (§3), it is exact from one fresh connection to the next (three runs, identical to the tenth of a megabyte), and
it moves with the planning: the kept plan is what the planner built. The peak has no reading Postgres will give from
inside a function.

- **Both directions.** A function over its budget fails. A budget far above what is measured guards nothing, so a
  measurement more than a tenth under its budget fails too, and asks for the budget to be lowered.
- **Every screen function has one.** The file takes the screen functions from the catalog by the rule
  `supabase/tests/e2e/0016-screen-reads.ts` already holds, and fails for one with no budget or a budget with no
  function.
- **Driven red.** A planted function that reads `acts_public` thirty times is measured against thread_page's budget
  and must be named as over.
- **Postgres 17 only** (the session's own choice, confirmed by the owner). The figures differ by major version, so on
  another the file fails with a plain message. CI's image is pinned to 17 and the owner's machine runs 17.11.

## 7. What stays, and what the change keeps

- **Kept plans stay.** Nothing in 0368 is reverted. With a pool that is reused they do what that design intended.
- **Append-only, and no player stuck.** No migration is added and no Act changes. No state a player, a character or a
  post can be put in is added, so nothing needs a way out. A read that waits at the gate is not a state: the press
  that wants it starts it.
- **The masks.** Nothing is computed from a private fact. The gate is per browser tab and the same for everyone. The
  pool is the same for every caller; a read that waits behind another says that someone is reading, never who, and
  never who owns a character. The budget file reads plans, which are the same for every caller (the plan-once design,
  section 6).
- **Scale.** At a busy instance a larger pool is declared and its connections stay warm by traffic alone; what each
  holds is fixed by the number of page types, never by players or Acts, and the budget keeps that figure known. One
  read ahead at a time bounds what a hover costs an instance to one read per open tab, where today a pointer drifting
  down a list starts one for every row.
- **Layers.** The gate, the adapter's change, the budget file and the release tool are engine. The declared values
  (`instances/divided-world/`) and the release workflow's step are Divided World's. The tool is told which file
  declares the values and which project to read; it knows no instance.
- **Portable.** A self-hosted Supabase sets the same two values in PostgREST's own configuration (`db-pool`,
  `db-pool-max-idletime`); the README says so beside the hosted steps.

## 8. Open

- **Pages reading the view once** (the owner's choice: left open, held by the budget). thread_page gathering its
  Acts' ids first and reading `acts_public` once would take about 32 MB from the 59 its planning uses. Weighed against
  rewriting thread_page now, and rewriting every page read now. Left because a cold read is now rare (after a quiet
  minute, an API restart or a cancelled call) and costs about 670 ms on the instance; the budget fails the next change
  that adds a read of the view, and the rewrite is a design of its own then, with these figures.
- **The instance's size.** With a pool of two the instance still lives in swap. Whether it moves up a compute size is
  the owner's, outside this design.
- **Whether the API stops a query when its request is dropped** (§4). Not established.
- **How the pool chooses a connection** (§1). Read from what the session saw, not from PostgREST's source.
- **Seen in passing, not designed here:** a page load asks `whoami`, `my_bar` and `conduct_accepted` three times
  each; `instance_settings` has been called 14,353 times against thread_page's 786; five schedules start a backend
  each every minute; and the Supabase dashboard's own lint query ran for 28.7 s during the 08:41 incident, so an open
  dashboard is load on a nano.
- **After this is deployed,** the owner's probe is the one this session ran: fifteen thread pages opened one after
  another, and the report's memory graph. A build session touches no deployed project.
