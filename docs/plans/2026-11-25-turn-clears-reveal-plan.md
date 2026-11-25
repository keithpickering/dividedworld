Record, written 2026-11-25.

# An announced Turn clears a character's shown class: plan

The design is `docs/plans/2026-11-25-turn-clears-reveal-design.md`; read it first. Built in one PR from `main`.

No migration, no SQL, no change to any view or Act. No deployed database, bucket or connector is touched. CLAUDE.md
and `tools/build.mjs` are not changed. Every task is test first, with its red run recorded in the PR. Tests are
rewritten where they asserted "Has Turned since". None is deleted unless its subject is gone, and each rewrite asserts
the new behavior in the old test's place.

## Task 1. `reveals()` clears on an announced Turn, and the live places draw it

Model: sonnet

Files: `engine/ui/postbit/reveals.ts`, `engine/ui/postbit/Postbit.tsx`, `engine/ui/postbit/Postbit.test.tsx`,
`engine/ui/postbit/Postbit.stories.tsx`, `engine/ui/profile/Profile.tsx`, `engine/ui/profile/Profile.test.tsx`,
`engine/ui/rankings/Rankings.tsx` (`ClassCell` and the header comment), `engine/ui/rankings/Rankings.test.tsx` (the
live table's tests), `engine/ui/thread/Thread.tsx`, `engine/ui/profile-edit/ProfilePreview.tsx`,
`engine/ui/front-door/FrontDoor.tsx`, `engine/ui/reactions/Picker.board.stories.tsx`,
`engine/ui/postbit/Postbit.board.stories.tsx`, `instances/divided-world/ui/stick-around/Hold.board.stories.tsx`.

**Tests first** (each red before the code changes):
- `Postbit.test.tsx`, `reveals()`: a character whose latest reveal has an announced Turn after it has **no entry**
  (`out.has('a')` is false). A Turn before the reveal, or at its exact moment, leaves the entry as
  `{ revealed: { class, at } }`. A character with only a Turn has no entry, as before. A later reveal after the Turn
  (the reveal at Oct 25 after a Turn at Oct 20) is shown again. Rewrite the two existing `reveals()` tests to these
  cases. Their `toEqual` shapes lose `turnedAt`.
- `Postbit.test.tsx`: the test "and 'Has Turned since' when a later announced Turn came after it" goes, because its
  subject (a `turnedAt` on the person) no longer exists. The dates test keeps its "Revealed: Heel (Oct 3)" assertion
  and drops the `turnedAt` and its "Has Turned since" assertion.
- `Profile.test.tsx`, "a Turn announced after the reveal makes the statement out of date": rename it to say the Turn
  clears the Class fact. Assert that the "About Pipewrench" table has no "Revealed:" and no "Has Turned since", and
  that its rows have no Class row. Wait for the table's Posts fact first, so the assertion is not read before the
  data. The public-record test below it stays and still passes: the record still lists the old reveal.
- `Rankings.test.tsx`, "a revealed class shows with the reveal's date, and a later announced Turn says so": Spritey's
  row (revealed Oct 3, Turned announced Oct 20) now reads "Not revealed" and has no "Face" and no "Revealed Oct 3".
  Gloomba's reveal still shows as it does. Rename the test to match.

**The code.**
- `reveals.ts`: `Statement` becomes `{ readonly revealed: { readonly class: string; readonly at: string } | null }`.
  `reveals()` sets an entry only for a character none of whose `turns_announced` rows is strictly later than its
  latest reveal. Keep the existing tie rule: a Turn at the reveal's moment does not count, because a Turn announced with
  its new class is written as both rows at one instant. Rewrite the header comment to say what is now true: the class
  is stated while it is current and public, an announced Turn after it clears it, and a silent Turn is never read.
- `Postbit.tsx`: drop the `turnedAt` span. `PostbitPerson` keeps extending `Statement`.
- `Profile.tsx`: drop the `· Has Turned since` part of the Class fact, and rewrite the header comment's sentence that
  quotes it.
- `Rankings.tsx`: drop the `turnedAt` line from `ClassCell`. Rewrite the header comment's "and 'Has Turned since'
  when an announced Turn came after it" to say an announced Turn after the reveal clears it.
- Every place that builds a `PostbitPerson` or reads a `Statement` drops `turnedAt` (`Thread.tsx` twice and its
  `null` placeholder, `ProfilePreview.tsx`, `FrontDoor.tsx`, and the three board stories). `npm run typecheck` finds
  any that are missed.
- `Postbit.stories.tsx`: the story at line 34 that shows a reveal and a Turn becomes a plain revealed story, or goes if
  another story already shows a reveal. Say which in the PR.

## Task 2. A finished season's final class clears the same way

Model: sonnet

Files: `engine/ui/reveal/statements.ts` (`finalClass`), `engine/ui/rankings/Rankings.tsx` (`FinalClassCell`),
`engine/ui/rankings/Rankings.test.tsx` (the finished-season tests), `engine/ui/season/Season.tsx` (`stated` and the
podium line), `engine/ui/season/Season.test.tsx`, plus whichever test covers `finalClass` directly (find it with
`grep -rn finalClass engine`; if none, add one beside `statements.ts`'s other tests).

**Tests first:**
- `finalClass`: a `shown` list whose last reveal has a `turn` entry after it returns `null`. A `shown` list ending on a
  reveal returns `{ cls, at }`. A Turn announced with its new class is `[…, turn, reveal]` at one instant (the turn
  sorts first, `0099_season_results.sql`'s `after` column), so it returns that reveal.
- `Rankings.test.tsx`, "shows the class its player made public, with the Turn after it, and no class for anyone
  else": `Name 000` (Heel revealed Oct 3, Turned Oct 9) now reads "Not revealed", with no "Heel" and no
  "Has Turned since". Add a row to the `finished()` world whose last reveal has no Turn after it, and assert that it
  shows its chip and "Revealed …", so the test still sees a class drawn. Rename the test.
- `Season.test.tsx`: in the results item, a podium character whose last reveal has an announced Turn after it reads
  "class not revealed", and no "has Turned since" appears anywhere on the page. Seed it in the test's world if none of
  the top three is in that state now. A podium character with a current reveal still reads "was a …".

**The code.** `finalClass` returns `{ readonly cls: string; readonly at: string } | null`, and `null` when a `turn`
entry follows the last reveal. Its doc comment is rewritten to match. `FinalClassCell` drops its `turnedAt` line.
`Season.tsx`'s `stated` returns `{ cls } | null` and the podium drops `and has Turned since`. Its comment ("and whether
a Turn was announced after") is rewritten.

## Task 3. Board 13 and the Rankings story

Model: sonnet

Files: `e2e/boards/13-rankings.ts`, `engine/ui/rankings/Rankings.board.stories.tsx` (header comment),
`web/src/data/fixtures/boards.ts` (the comment at lines 68 to 72 only), `web/src/data/fixtures/stories.test.tsx`.

The boards fixture keeps Thwompson's reveal on Oct 8 and its Turn announced on Oct 30 with neither class named. On the
build, Thwompson's class cell is now the dash. The fixture's data does not change, and neither does
`web/src/data/fixtures/boards.test.ts`, which asserts the data.

**Tests first:** `stories.test.tsx`, the Rankings story test: `Revealed ` once (Gloomba), `Has Turned since` none
(`queryAllByText(...)` has length 0), and `Not revealed` five times. Red before Task 1 lands (if this task is built
after Tasks 1 and 2, record the red run by checking out the test change alone against the old code first).

**The board match.** `docs/research/2026-10-29-two-worlds/13-rankings.html` is a record and is not edited. Its
Thwompson row draws the Lurker chip, "Revealed Oct 8" and "Has Turned since Oct 30". Add a departure paragraph to the
manifest's header, citing this design, in the form of the two departures already there:
- `class-thwompson`, `revealed-thwompson` and `turned-thwompson` go. A `none-thwompson` dash landmark takes their
  place. The board draws no dash in that cell, so it is found by the build's dash order (`buildNth`) and compared with
  `box: 'none'`, as the place dashes' landmark does. Say why in the header.
- The class dashes' `buildNth` for the four Ringside rows shift by one, because Thwompson's dash now comes first.
- Thwompson's row was two lines tall in the class column, because the second "when" line takes its own line
  (`.kb-rankings-when + .kb-rankings-when`). Run the board match (`npm run test:e2e`, board 13) after the change and
  read each mismatch. Expect every landmark below Thwompson's row to rise by one line. For each one that moves,
  compare it by the mode that leaves y out, or from an origin in its own row. Name in the header which landmarks
  changed mode and why. Do not loosen a landmark above Thwompson's row: a mismatch there is a bug in Tasks 1 and 2,
  not a departure.
- The header's first paragraph ("both ways a stranger's class shows (Gloomba's reveal; Thwompson's, Turned since)")
  is rewritten: Gloomba's reveal shows, and Thwompson's is cleared by its announced Turn.

The Rankings story's header and the fixture's comment are rewritten the same way.

## Task 4. The Strategy Guide's sentence

Model: inline

File: `instances/divided-world/guide/strategy-guide.md`, the Reveals section. After "A reveal can't be taken back, and
it's dated: the badge says what the class was that day." insert:

> An announced Turn takes the badge down until the character reveals again; a silent Turn leaves it up.

Run the guide's own tests (`grep -rln strategy-guide engine instances tools --include=*.test.*`) and the build. The
owner approves this line in the PR's review, as CLAUDE.md requires for the guide's copy.

## Review focus

- A Turn announced with its new class writes a `class_reveals` row and a `turns_announced` row at one instant. Check
  that `reveals()`'s strict "later than" and `finalClass`'s order still show that new class, not "Not revealed".
- No silent Turn reaches the client or `reveals()`: the read is still `turns_announced` alone.
- Board 13: only landmarks at or below Thwompson's row changed mode. Each change is named in the header.
- Nothing left says "Has Turned since" or "has Turned since": `grep -rniE "turned since" engine instances web e2e`
  finds nothing but records.
