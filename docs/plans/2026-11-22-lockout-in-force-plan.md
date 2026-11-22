Record, written 2026-11-22.

# A live lockout is in force everywhere it is shown: plan

Carries out `docs/plans/2026-11-22-lockout-in-force-design.md` (#991, and #873's two delta follow-ups; #989 closes with no
build). Line numbers are as read at `8444ded`. Read the function, not the line.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added. The engine
boundary check holds: engine tests use the fixture cards their files already build (`lockout-world.tsx`,
`lens.test.tsx`'s `world()`), never Divided World's. No deployed database, bucket or connector is touched; SQL tests run
against Postgres on localhost.

**Order and post plays.** Tasks 1 to 3 change only `engine/ui/cards/` and can be built on main as it stands. Task 4
redefines post plays' `play_row` and needs PR #973 merged; the build starts after #973 merges. If it has not merged when
the build session starts, Tasks 1 to 3 are built and the PR waits as a draft for Task 4, saying so. Post plays' Task 7
adds the Lens pager at the foot of Ended (`Who`, `engine/ui/cards/Lens.tsx`); nothing here touches `Who`, and the paged
rows are judged by the same `inForce`, so they need no change. Merge main before Task 3 so its render tests run against
the pager.

**The world.** The Lens is the glass. The only new words are decision 3's four lines, approved by the owner as written.

## Task 1. One rule for a sprung back, and every end on the clock (engine)

Model: sonnet

**Files:** `engine/ui/cards/plays.ts`, `engine/ui/cards/plays.test.tsx`.

- Add `lockoutLive(play: CardPlay, now: number): boolean`, beside `backOver` (line 39): true when `play.revealed?.until`
  is present, ahead of `now`, and `play.reversed` is not set. `inForce`'s sprung-back line (line 172) reads it.
- `playOver` (line 182): a sprung back (`p.revealed`) is over unless `then?.has(p.id)` and `p.revealed.until` is present,
  or `lockoutLive(p, now)`; caught and reversed are over first, as today. A sprung back with no `until` is over, as
  today. Its header comment names the lockout.
- `nextEnd` (line 293): beside `p.ends`, read `p.endsAt` for a face-down back that has neither `revealed` nor `takenBack`,
  and `p.revealed.until` for a sprung back. Its comment says it is what wakes the Lens, the marks and the board at a
  back's or a lockout's end.
- The spring-before-back merge in `createPlays().add` (line 560): keep `until`, and mark the back `reversed` where an
  admin's end of that spring was read before the back (`ended.has(early.spring)`), as the in-order path does (line 515).
  Write that second test first and record whether it is red; if it is green, the merge already holds it some other way,
  and the plan gap is noted in the PR.

**Tests first**, in `plays.test.tsx`:
- `playOver` and `kindSpent`: a sprung back with a live lockout is not over; past its `until` it is; `reversed` it is; a
  sprung back with no `until` is; in `then`, a lockout past its `until` is not over. Property: for every sprung-back
  fixture, `playOver(p, now, keys) === !inForce(p, now, false)`.
- `nextEnd`: a face-down back's `endsAt`; a sprung back's `until`; neither of a back taken back; the soonest of a mix.
- The merge: `createPlays()`, add the spring Act (`did: 'lockedOut'`, `until` a day ahead), then the set Act; assert
  `revealed.until` and `inForce(…) === true`. A second: spring, then a `card_end` of the spring, then the set; assert
  `reversed`.

**Poisons** (each turns a named test red, recorded in the PR): drop `until` at the early merge; `playOver` back to
`p.revealed` alone; `nextEnd` back to `p.ends` alone.

## Task 2. The status line's words (engine)

Model: haiku

**Files:** `engine/ui/cards/marks.ts` (`backWords`, line 77), `engine/ui/cards/marks.test.ts` (beside the sprung test,
line 52). Read only these two files and `lockoutLive` from Task 1.

In `backWords`'s `back.revealed` branch, `ends` is, in this order of tests:
1. `back.reversed` and `back.revealed.until` present: `'It sprang, and an admin ended its lockout.'`
2. `back.revealed.until` present and `Date.parse(until) > now`: `` `Its lockout ends ${dayAndTime(until)}.` ``
3. `back.revealed.until` present: `` `It sprang, and its lockout ended ${dayAndTime(until)}.` ``
4. otherwise, unchanged: `'It has sprung, and ended.'`

`name`, `state` and `note` are unchanged. The header comment adds one sentence: a back that sprang into a lockout says
when the lockout ends, or that it ended and how.

**Tests first**: one case for each of the four, with `until` `'2026-11-23T21:14:00.000Z'` and `now` before and after it,
asserting the exact strings with `dayAndTime(until)` (`engine/ui/characters/format.ts`); and that `name`, `state` and
`note` are the same in all four.

## Task 3. The screens agree, and wake (engine)

Model: sonnet

**Files:** `engine/ui/cards/lens-lockout.test.tsx`, `engine/ui/cards/marks.test.tsx`; code only where a test is red
(Tasks 1 and 2 should carry it; `Lens.tsx`'s back branch, line 260, and `Marks.tsx`'s `spent`, line 115, are where to
look).

**Tests first**, in `lens-lockout.test.tsx`'s world (`lockoutWorld`, `lockOut`), with the clock the world's `api.now`:
- An admin opens the Lens on a post whose back sprang into a lockout a day long: the status line says "Its lockout ends
  …", Who lists the row under Up now with End, the kinds grid's sign says "1 up now", and the post's mark is not
  `data-kb-spent`.
- The clock moves past `until` with the Lens left open, and no read: the row is under "Ended · 1", End is gone, the line
  says "It sprang, and its lockout ended …", and the mark is `data-kb-spent="true"`. (This is #873's second delta
  follow-up.)
- The admin presses End: once the `card_end` lands, the line says "It sprang, and an admin ended its lockout." and the
  row is under Ended.
- A reader who is no admin sees the same line and groups, with no End, and makes no spring read (the existing test's
  assertion kept).
- In `marks.test.tsx`: a face-down back's mark wakes at its `endsAt` with no read (the back is dropped by `shownPlays`).

**Poisons**: `nextEnd` back to `p.ends` alone (the second case stays on Up now); `backWords`'s branch 2 removed.

## Task 4. The kept row ends a lockout back at its lockout's end (engine, SQL)

Model: sonnet

Needs #973 merged. **Files:** a new migration numbered above main's highest at the time
(`supabase/migrations/NNNN_lockout_play_post.sql`) and its test (`supabase/tests/NNNN-lockout-play-post.sql`).

- `play_row`, copied whole from post plays' latest definition (on main once #973 merges; `0407_play_post.sql` on its
  branch today) and changed only in the `set` arms: where a `spring` Act names the back (`payload ->> 'set'`) with
  `payload ->> 'did' = 'lockedOut'`, `ends_at` is that spring's `(payload ->> 'until')::timestamptz` and `over_at` is the
  earliest `card_end` whose `target_act_id` is the spring (null where none); `sprung` stays true. Any other back is as
  before. The header names the copy's source and the one change, as the repository's copies do.
- `play_post_on_act`, copied whole: a `card_end` whose target is a lockedOut spring also refreshes the back it names.
- A backfill: `refresh_play_post` for each back with a lockedOut spring.
- The migration's header lists every reader of `play_post`'s in-force rows (`post_play_ids`, `post_kind_counts`,
  `kind_play_ids`, `post_effects_up` and any other the build finds) and says what a live lockout back being in force
  does to each. A back's kind is `''` and draws no effect, so the limit on drawing effects should not count it; the
  test holds that.

**Tests first**, red against post plays' `play_row`:
- A post with three lockout springs inside one lockout's span, the oldest the least drawn: `post_play_ids` holds all
  three; `kind_play_ids` pages none of them; after the clock passes the oldest's `until`, the pager reads it.
- An admin's `reverse_card` of a lockout spring: the back's row has `over_at` at the `card_end`'s time, and
  `post_play_ids` drops it unless it is a stand-in.
- A spring that is not a lockout: the row is as post plays wrote it.
- `play_post_drift()` is empty after each; and with the new trigger line disabled
  (`alter table … disable trigger`), a `card_end` of a lockout spring makes the drift check name the back (its poison).
- `post_effects_up` for a post with a live lockout back is the same as without it.

## Review focus

- What Task 4 does to `play_post` rows an instance already holds: the backfill must rewrite every lockout back's row and
  no other, and the drift check must pass on a database restored from an export taken before the migration.
- Whether any reader of `play_post` other than the page reads (the room for drawing effects, `spring_facts`, a count by
  kind) now counts a live lockout back as a held place where the rules do not (`place_cast`, `place_set`).
- The extra `useUntil` wakes: every mark, Lens and board strip that holds a back now schedules a timer at its `endsAt`;
  check that a page of many posts with live backs does not redraw anything but the post whose end passed.
- The masks: nothing new may differ by who set a back or what it hides. `nextEnd` reads `endsAt`, which is the same span
  for every Set; confirm no screen's timing reads the card behind a back.
- A moment (`then`) in a spun thread's ORIGIN box: a lockout the moment holds reads "Its lockout ends …" and is not
  drawn spent, while the same back on its own post, past its `until`, is ended.
