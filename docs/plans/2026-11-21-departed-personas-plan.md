Record, written 2026-11-21.

# A persona that leaves the roster leaves the staff: plan

Carries out `docs/plans/2026-11-21-departed-personas-design.md`. One PR from `main`, which closes #938.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `npm run test:sql` for the SQL (it replays every migration into a scratch database on the
local Postgres `DATABASE_URL` names), `node --experimental-strip-types --test <file>` for the seed's and the rules'
tests, `npx vitest run <file>` for the screens' and the fake's. Run `npm run typecheck` and `npm run build` once after
the last task, with the tail in the PR. No deployed database, bucket or connector is touched.

The migration is one file, `supabase/migrations/NNNN_departed_personas.sql`, NNNN the next free number on `main` when
the build starts (0401 when this plan was written). Each function it rewrites is copied from its **latest** definition,
which the build confirms before copying (`grep -l "function <name>(" supabase/migrations/*.sql | tail -1`, and the latest
`create or replace view` for a view); the latest named below is as of this plan, and a later migration on `main` wins.
Each rewrite opens with the house comment "`<name>` (`<latest>`), <what changes>. Everything else as `<latest>` wrote
it."

**The rule, whole.** The seed's roster is the whole staff. A `persona` character whose key the seed's roster does not
list, and whose latest office row is not already `benched` with cause `seed`, is departing: the seed benches it
(cause `seed`). Where the open season's Boss is departing, the seed first benches the other departing personas, then
hands the Boss's office over in the open season (`cause = 'departure'`), then benches the outgoing Boss. A persona
benched by the seed comes back only by a seed that lists it again. No departure can leave the season without a Boss in
the roster, or the staff without a Mod: the seed refuses instead, writing nothing.

**The layers.** All engine: SQL, the seed's tests, the API types, the web client's mapping, the fake and the admin
queue's words. No instance file changes.

**The masks.** Nothing added reads who owns a character, a class or who reacted. Personas have no owners; offices,
handovers and the announcements are public already; the to-do and the dismissal are an admin's alone, as today.

**States.** One cause of an existing state: `benched` by the seed. Its way out: a seed that lists the persona again
(Task 2). The design, section 5.

**Scale.** The seed's new work is a read of the persona characters (a handful) and at most one handover. The changed
reads keep their indexes; the to-dos and the news go from one row per season to one per handover.

**Acts and rows already held.** Every existing `season_handovers` row becomes `cause = 'rollover'` with a fresh `id`,
and every `handover_dismissals` row is carried to its season's (only) handover's id. No Act is touched.

## Task 1. The database: one handover row per handover, and a departure

Model: sonnet

**Files:** the new migration; `supabase/tests/NNNN-departed-handover.sql` (new).

**The table.** `season_handovers`: add `id bigint generated always as identity`, move the primary key to it, keep
`season` not null with a plain index `(season, id)`; add `cause text not null default 'rollover' check (cause in
('rollover', 'departure'))`. A unique partial index keeps one roll-over per season:
`create unique index season_handovers_one_rollover on season_handovers (season) where cause = 'rollover'`.
`handover_dismissals`: add `handover bigint references season_handovers (id)`, fill it from the season's roll-over row,
make it not null, drop the old primary key on `season` and the foreign key to `season_handovers (season)` (keep the
column `season`, filled, for the record) and make `handover` the primary key. Keep the append-only triggers. The
`kayfabb_digest` column grant (0088) is restated with `cause` added.

**`hand_over`** (latest `0365_handover_withdraws.sql`) becomes `hand_over(new_season bigint, outgoing text, at
timestamptz, departure boolean default false)`. The three-argument form is dropped; every caller passes three
arguments, so the default keeps them. With `departure`:

- If the chosen Boss would be null or the outgoing one (the nomination and the rotation both failed to seat someone
  else), raise `the open season's Boss % has left the roster, and no Boss in it can take the chair` with `hint =
  'kayfabb.refusal'`, `errcode = '55000'`, writing nothing (no fallback to `unchanged`).
- Everything else runs as for a roll-over: the bank, the offices (the outgoing Boss's `member`/`mod` row, cause
  `handover`, season `new_season`), the waiting moves withdrawn, the farewell and the arrival.
- `say_farewell(outgoing, new_season, departure)` reads the outgoing Boss's handoff for the season it served:
  `new_season` itself for a departure, the season before for a roll-over. `say_farewell` gains the third argument
  (default false); its latest is `0337_handoffs.sql`.
- The row written carries `cause = case when departure then 'departure' else 'rollover' end`.

**The readers**, each rewritten from its latest so that a season with two handovers reads right. As of this plan:

| Object | Latest | What changes |
|---|---|---|
| `season_boss_changes` (view) | `0063_season_news.sql` | adds `h.id as handover` and `h.cause`; one row per Boss-changing handover, as now |
| `news_announce` | `0100_announce.sql` | its `season_handovers` branch reads `new` per row as now; check it keys nothing by season alone |
| `alerts_news_unread` | `0099_season_results.sql` | the same check |
| `season_news` | `0368_client_reads_plan_once.sql` | `bossLeft`'s season is `h.number` for a departure, `h.number - 1` for a roll-over |
| `admin_queue` | `0337_handoffs.sql` (confirm) | each to-do carries `handover` (the id) and `cause`; `join season_handovers h on h.id = t.handover`; the handoff note and facts are read for the season the outgoing Boss served (`t.season` for a departure, the season before for a roll-over); dismissed by `d.handover = t.handover` |
| `dismiss_handover_todo` | `0090_handover_todos.sql` | becomes `dismiss_handover_todo(handover bigint)`; refuses an id that is not a Boss-changing handover (`there is no to-do for that handover: it did not change the Boss`); answers `{handover, season}`; the integer form is dropped, its grants restated on the new one |
| `predecessor_handoff` | `0337_handoffs.sql` | reads the open season's **latest** Boss-changing handover; its season, note and facts are the outgoing Boss's served season, as above; the window counts from that row's `landed_at` |
| `say_farewell` | `0337_handoffs.sql` | the third argument, above |
| `apply_meeting` | `0366_excerpts_and_orders.sql` | check its `handoffs_latest` read: a handoff is written for the season the Boss sits in, so nothing changes unless it keys by "the season before"; record what was found |
| `pool_context` | `0339_thread_places_at_scale.sql` | `predecessor` is the latest Boss-changing handover's outgoing Boss in the open season |
| `pool_signals` | `0358_blind_totals.sql` | reads handovers in a window by `landed_at`: unchanged unless it joins by season; record what was found |
| `staff_career` | `0368_client_reads_plan_once.sql` | `left join season_handovers h on h.season = s.id` becomes the season's roll-over row (`and h.cause = 'rollover'`) for how the season opened, and a departure in that season is listed as its own entry (how the persona came to or left the chair mid-season) |
| `reveal_season` | `0206_trophies.sql` | its failure insert writes `cause = 'rollover'` (the default does); nothing else |

The build lists every other object whose latest definition reads `season_handovers`, `season_boss_changes`,
`handover_dismissals` or `handoffs_latest` (a script over `supabase/migrations/` that keeps each name's last
definition, as the design session ran) and handles any this table misses the same way, naming it in the PR.

**The tick.** `system_tick` (latest `0334_meeting_bundles.sql`): the grace for an inherited move counts from
`greatest(inforce.landed_at, handed)`, where `handed` is the open season's latest Boss-changing handover's `landed_at`,
else `season_start`. Read once at the top, beside `season_start`.

**Tests first** (`supabase/tests/NNNN-departed-handover.sql`, built as `0317-handover-withdraws.sql` builds its world):

1. A roll-over writes one row, `cause = 'rollover'`, and every reader answers as before (the to-do, the news, the
   predecessor, the career).
2. `hand_over(open_season, boss, now(), true)` with a second Boss on the roster: a second row in the same season,
   `cause = 'departure'`, `how = 'rotation'`; `current_boss()` is the new Boss; the outgoing Boss's office row is
   `member` (or `mod` where no Mod stands); its waiting moves are withdrawn; the arrival is posted.
3. The departure's to-do carries its own `handover` id, its season is the open one, and dismissing it leaves the
   roll-over's to-do (if still open) as it was. `dismiss_handover_todo` of a roll-over's id that kept the Boss is refused.
4. `predecessor_handoff()` and `pool_context().predecessor` name the departed Boss after a departure.
5. `season_news` shows `bossLeft` and `bossArrived` in the open season for a departure.
6. An inherited board move that landed 10 days before a departure, with `inheritanceGraceDays = 3`, is **not** ended
   by the next tick, and is ended by a tick 3 days after the departure.
7. `hand_over(open_season, boss, now(), true)` where the roster holds no other Boss: refused with the message, and no
   row, office or announcement was written.
8. The migration on a database with a roll-over and a dismissal (seed them, then apply the migration's table part in the
   test as the replay does): every old row is `rollover`, every dismissal has its `handover`.

## Task 2. The database: the seed benches the departing

Model: sonnet

**Files:** the same migration; `supabase/tests/NNNN-departed-personas.sql` (new); `supabase/functions/seed/core.test.ts`.

**`boss_roster()`** (latest `0082_offices.sql`): the `personas` CTE also leaves out a persona whose **latest
`staff_offices` row** is `benched`, whatever `staff_office_now` shows (a waiting persona benched by the seed reads
`waiting` there).

**`set_office`** (latest `0082_offices.sql`): before the other checks on the persona, refuse a persona whose latest
office row is `benched` with cause `seed`: `that persona left the instance's roster; a seed that lists it brings it
back` (`hint = 'kayfabb.refusal'`, `errcode = '55000'`).

**`seed_instance`** (latest `0397_refund_outcome.sql`), after the personas are made and their beats, traits and quizzes
written, and after `firstStaff` is hired, in one block:

1. `listed` is the set of keys in `payload -> 'system' -> 'staff'`. `departing` is every `characters` row with
   `staff_kind = 'persona'` whose `staff` is not in `listed` and whose latest `staff_offices` row is not (`benched`,
   cause `seed`). Take `pg_advisory_xact_lock(hashtext('kayfabb.offices'))` first.
2. `boss` is the open season's Boss (`seasons where ends_at is null`). Bench every departing persona other than `boss`
   (`insert into staff_offices (staff, office, cause) values (k, 'benched', 'seed')`). Debut nothing.
3. If `boss` is departing: `perform hand_over(open_season_id, boss, now(), true)` (it refuses as Task 1 says, and the
   refusal aborts the seed), then bench `boss` the same way.
4. Re-listing: every persona in `listed` whose latest row is (`benched`, cause `seed`) gets `mod` (cause `seed`) if
   `firstStaff` names it, else `member` (cause `seed`). A `mod` row debuts it as the `firstStaff` hire above does; a
   `member` row debuts nothing.
5. If no persona's `staff_office_now.office` is `mod` (retired ones excluded), hire each `firstStaff` key that is listed,
   not the season's Boss and not a Mod (`mod`, cause `seed`, debuting it). If that still leaves none, raise `the seed
   leaves no Mod Bot on staff: name one in firstStaff` (`hint = 'kayfabb.refusal'`, `errcode = '55000'`).
6. Add the counts to the seed's answer: `departed` (keys benched this run), `returned` (keys re-listed this run) and
   `handover` (the new Boss's key, or null).

**Tests first** (`supabase/tests/NNNN-departed-personas.sql`, seeding a world with personas `a` (Boss), `b`, `c`
(Mod), `w` (waiting), then reseeding with fewer):

1. A reseed without `b`: `b` is benched (cause `seed`), keeps its character and posts, `write_staff_act('b', ...)` is
   refused, and `boss_roster()` lacks it.
2. A reseed without `w` (never debuted): `w` gets the bench row, is still not debuted, and `boss_roster()` lacks it.
3. A reseed without `a`, the Boss: the season goes on (same id, same `ends_at`), a `departure` handover seats `b` or
   whoever the rotation names (never a departing persona), `a`'s farewell or stock line is posted before its bench,
   `a` is benched, and the answer names the new Boss.
4. A reseed without `a` and without every other Boss: refused with the message; `a` is still Boss and nothing was
   written (no office row, no handover, no announcement).
5. A reseed that drops `c`, the only Mod, with `firstStaff` naming `b`: `b` is hired, `c` is benched. With `firstStaff`
   naming only `c`: refused with the no-Mod message.
6. `set_office('b', 'mod')` by an admin after (1): refused with the roster message. An admin's own bench of `c`
   followed by `set_office('c', 'mod')` works as today.
7. A reseed that lists `b` again: `b` is a member (or a Mod where `firstStaff` names it), and a third identical reseed
   writes no office row at all.
8. Two identical reseeds after a departure write nothing the second time (no row, no handover).

**The seed function's test** (`supabase/functions/seed/core.test.ts`): a fake `db.rpc` that raises the departure
refusal as a 4xx `DatabaseError` answers 422 with the message, as the existing refusal test does. No change to
`core.ts` is expected; if one is needed, the test says why.

## Task 3. The API, the web client, the fake and the words

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`,
`engine/ui/admin/handover-words.ts`, `engine/ui/admin/Queue.tsx`, their tests (`engine/ui/admin/Queue.test.tsx`,
`web/src/data/supabase.test.tsx`, the fake's), and `engine/ui/admin/Queue.stories.tsx`.

- `HandoverTodo` gains `handover: number` and `cause: 'rollover' | 'departure'`. `dismissHandoverTodo(handover:
  number)` replaces the season form, answering `{ handover, season }`; the web client calls
  `dismiss_handover_todo` with `{ handover }`. The fake's `handover(...)` takes `cause` (default `rollover`) and writes
  ids as the database does.
- The words (`handover-words.ts`), for a departure:
  - `todoSentence`: `` `${t.bossName} takes over Season ${t.season} from ${t.outgoingName}.` `` (a roll-over's stays
    "Season N opens with X.").
  - `todoTitle`: the same sentence without its full stop.
  - `todoFacts`: the role line as today; then `` `${t.outgoingName} left the instance's roster and is now benched.` ``
    in place of the outgoing line; then the how line as today.
- Tests first: the words for both causes; a departure to-do and a roll-over to-do in one season both show and dismiss
  on their own in the queue; the web client sends `{ handover }`.
- A story, `DepartureTodo`, beside the queue's existing to-do story.

These strings are the glass speaking plainly, and the owner approves them in review.

## Task 4. The build

Model: inline

`npm run typecheck`, `npm run build`, `npm run test:sql`, `npm run test:engine` and `npx vitest run engine/ui/admin`,
with the tails in the PR. The PR body says, for the owner: after it merges and the release runs, dw.gripe's seed benches
the three placeholder fixtures and hands season 1 to FanGaME, and the seed's answer in the release log shows it.

## Review focus

- The migration's table change on an instance that already holds handovers and dismissals: every old row carried,
  nothing lost, and the unique roll-over index holding.
- Every reader of `season_handovers` and the handoff notes at its latest definition: a missed one reads two handovers
  in a season as one, or "the season before" for a departure.
- `hand_over`'s departure refusal leaves nothing behind (an office row, a bank row, an announcement, a spent nomination)
  when it raises inside the seed's transaction.
- The order inside the seed: the other departing personas benched before the handover, so the rotation and a standing
  nomination can never seat one; the farewell posted before the outgoing Boss's bench.
- A second release on the same day with the same content writes nothing (idempotence), and a re-listed persona comes
  back once.
- The inheritance grace after a departure: a move older than the grace survives the first tick.
- `boss_roster()` reading the latest office row: a waiting persona benched by the seed is never seated, and an admin's
  bench still behaves as before.
