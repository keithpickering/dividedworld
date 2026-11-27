# Lasting gags: the plan

Record, written 2026-11-27. Carries out `docs/plans/2026-11-27-lasting-gags-design.md`. Six tasks, in order. Each goes test
first, with its red run shown. Postgres on localhost only. Run `npm run typecheck` and `npm run build` once after the last
task, with the tail in the PR. No task changes an Act already written, and none touches a deployed database.

Line numbers are as of `fc059f9` and may have moved; the function names are what to find.

## Task 1. A clear that is final, in the rules and the fake

Model: sonnet

- **`engine/rules/cards.ts`**, `CardRules.drawsEffect` (about line 476): gains `readonly final?: true`, documented beside
  `cleared`: once the play's saved state is cleared for every version of the post (`cleared` answers `true`), the clear is
  final. No later save on the play is taken, and the play holds no place in its card's stack. It names no card.
- **`landsOn`** (about line 983): its `rules` Pick gains `'drawsEffect'`. The stack count leaves out an effect of the same
  card with `cleared === true` when `rules.drawsEffect?.final` is true. `effectsUp` and `roomOnPost` are unchanged: a cleared
  play already counts no slot. Update the comment on `CardEffect.cleared` (about line 98) to say a final card's cleared play
  also holds no stack place.
- **`engine/rules/instance.ts`**, `instanceProblems` (beside line 801): a card whose `drawsEffect.final` is true and which
  gives no `drawsEffect.cleared` is a problem: `` `${who} says its clear is final and gives no cleared; a clear is read from cleared` ``.
- **`engine/ui/data/fake.ts`**:
  - `effectsOn` (about line 3041) gives `drawing: true` for a play whose card declares `drawsEffect`, and `cleared: true`
    where the card's `cleared` answers `true` for the play's saved state in `effects` (a `{ version }` answer counts only
    for the post's current version, as `effect_cleared` does). Check first that nothing reads the fake's effects expecting
    these keys absent.
  - `saveEffect` (about line 2557): after the admin-ended and didn't-take refusals, a play whose card declares `final` and
    whose saved state is cleared (`true`) refuses with `'that effect was cleared for good, and stays cleared'`.
- **Tests first.** `engine/rules/cards.test.ts`: with a test card of stack 1 that declares `final` and one that does not, a
  cleared live effect blocks the second card and does not block the first; an uncleared one blocks both; an effect of
  another card cleared does not change either count. `engine/rules/instance.test.ts`: the new problem, and none for a card
  with both. A fake test (beside the fake's existing save tests; find them with `grep -rn saveEffect engine/ui/data/*.test.ts`)
  shows the refusal and that a non-final card's cleared play can still be saved. Red run: the type has no `final`.

## Task 2. A clear that is final, in the database

Model: sonnet

- **Migration** `supabase/migrations/0453_final_clears.sql` (the next free number; take the next one if 0453 is taken),
  with a header listing each function as copied whole from its latest definition, as 0411's header does:
  1. `card_kinds.clears_for_good boolean not null default false`.
  2. `seed_instance`, copied whole from `0449_concession_post.sql`: `clears_for_good` joins the card insert's columns, values
     and on-conflict update, from the seed's `clearsForGood`.
  3. `place_cast`, copied whole from `0438_board_cards_on_their_board.sql`: the post stack count (about line 230) leaves out
     a play with `kind_of.clears_for_good and effect_cleared(k.id, null)`. The count beyond a post (about line 428) is
     unchanged: `drawsEffect` is for posts alone.
  4. `spring_facts`, copied whole from 0438: its subquery `l` (about line 632) gains a `cleared_for_good` column (the play's
     kind clears for good and `effect_cleared(k2.id, null)`), and `f.up` and `f.quadrant_up` leave those plays out. The
     `f.layer` count is unchanged, so no layer is taken twice.
  5. `save_effect_state`, copied whole from `0411_post_effects.sql`: after the didn't-take refusal, a play whose kind clears
     for good and whose `effect_state` row is cleared with `cleared_for` null raises `'that effect was cleared for good, and
     stays cleared'`, hint `kayfabb.refusal`, errcode `55000`. It sits after the author check, so only the post's author can
     meet it.
  Grants and settings as each copied definition states them.
- **`supabase/functions/_shared/seed.ts`** (about line 118): `clearsForGood: c.drawsEffect?.final === true`, and the seed
  type and its test beside it.
- **SQL test first** `supabase/tests/0453-final-clears.sql`, on the harness and fixtures `0411-post-effects.sql` uses, with
  a test card that draws, stacks one deep and clears for good, and one that does not:
  - a second cast is refused while the first is uncleared; once the author's save clears it, a second cast lands, its layer
    the next one;
  - the same cleared play of the non-final card still refuses a second;
  - a later save on the final card's cleared play is refused in those words; a save on the non-final card's is kept;
  - a back of the final card springs onto the post whose play is cleared (`spring_facts`'s `up` is 0).
  Red run: the column does not exist.
- **A race** in `supabase/tests/0453-final-clears-race.sql`, as `0411-post-effects-race.sql` runs one: two casts at a post
  whose play has just been cleared; one lands and the other is refused.

## Task 3. The hold, shared

Model: inline

- **New** `instances/divided-world/cards/hold.ts`: `holdEnds(hours, landed)` and `heldUntil(settings, key, playedAt)` moved
  from `instances/divided-world/cards/autocorrect.ts` (lines 196 to 208), with `key` the economy key, and `holdLeft(ms)` moved
  from `instances/divided-world/cards/autocorrect/Effect.tsx` (`left`, line 99). Autocorrect imports them; its words and
  behavior are unchanged.
- **Tests:** move `heldUntil`'s and `left`'s tests to `hold.test.ts` (find them with `grep -rn "heldUntil\|left(" instances/divided-world/cards/autocorrect*`).
  Red run: the module does not exist.

## Task 4. Hot Box's rules

Model: sonnet

- **`instances/divided-world/cards/hot-box.ts`**:
  - Drop `lasts` and `HOT_BOX_LASTS`. Export `HOT_BOX_THINS: Span = { unit: 'day', count: 3 }`, the span the smoke thins over.
  - `drawsEffect: { cleared: (state) => field clean === true, final: true }`.
  - `reads` gains `{ key: 'hotBox.holdHours', whole: true, min: 0, max: 168 }`. `stateHeldUntil: (settings, landed) =>
    holdEnds(economyOf(settings, 'hotBox.holdHours'), landed)`. `stateHeldWords: (until) => \`This smoke is too thick to air
    out until ${until}. It can be aired out after that.\``.
  - `validateState`: `{ clean: true }`, or `{ aired }` with `aired` a finite number greater than 0 and less than 1, rounded to
    a ten-thousandth. Anything else is refused with `'the smoke is aired out to a share of the post, more than 0 and less
    than 1, or clean'`. Other keys are dropped.
  - `seen`: the three sentences of the design's section 2.5, reading `p.state`.
  - The header comment says what the design's section 2 says.
- **`instances/divided-world/settings.ts`**: `'hotBox.holdHours': 24` beside `'autocorrect.holdHours'`.
- **Tests first,** `instances/divided-world/cards/hot-box.test.ts`: the facts test says no `lasts` and `HOT_BOX_THINS` 3
  days; the landing test gains a cleared live play that no longer blocks (`{ ..., cleared: true }`) and an uncleared one with
  no `ends` that does; `validateState` takes each shape, rounds, and refuses 0, 1, a negative, NaN, a string and `clean:
  false`; `cleared` and `final`; `stateHeldUntil` at 24, at 0 and its words; `seen` for each of the three states. Red run:
  `hotBox.lasts` is still set.

## Task 5. Hot Box's screen

Model: sonnet

Files: `instances/divided-world/ui/hot-box/smoke.ts`, `Effect.tsx`, `fog.ts` (where the forced-colors mask is drawn) and
their tests; `instances/divided-world/ui/cards/hot-box/ui.ts`; `instances/divided-world/ui/index.test.tsx` (the description
test, line 668).

- **Strength.** `strength`'s callers pass `ends ?? playedAt + spanMs(HOT_BOX_THINS)` as the end of the thinning. A play
  with no `ends` is never over: past the span, strength is 0 and the fog holds at `SMOKE.least`. `nextWake` stops waking
  for the strength once it reaches 0 on a play with no `ends`.
- **Which play** (about line 296). The play drawn is the newest play that is not over (an `ends` ahead, or none) and whose
  state is not `clean`. At most one is uncleared, since the card stacks one deep.
- **The aired band** (new in `smoke.ts`): `airedTop(state, boxHeight)` gives the px height of the cleared band from the
  saved `aired` share, 0 for none and the whole box for `clean`. The fog's paint, the puffs, the clearings' coverage and the
  forced-colors mask all start below it, and words above it are not hidden from a screen reader. Its tests: none, a share and
  clean, at three box heights.
- **Air it out.** Where `reader.author` is true, no moment is shown, and the hold is over (`heldUntil(economy,
  'hotBox.holdHours', play.playedAt)` from Task 3, read as Autocorrect's Effect reads it, line 641), the kit's held control
  and the post's button read "Air it out". Its sweep starts at the first line whose bottom is below `airedTop`, and on each
  finished line it calls `save` with `{ aired: line.bottom / boxHeight }` rounded to a ten-thousandth, or `{ clean: true }`
  after the last line, through the same save path Whoops!'s Effect uses (debounced to one at a time). A refused save keeps
  the band where the server has it and shows the refusal where Whoops! shows one. During the hold the control reads Wave the
  smoke and saves nothing, and a minute's timer moves the countdown and switches the label when the hold ends, with no
  reload.
- **Words.** The Lens's state and ends lines and the description exactly as the design's section 2.5 gives them; the
  countdown is `holdLeft`. `ui.ts`'s `describe` reads `hotBox.holdHours` from the settings and `HOT_BOX_THINS`, and its
  `logSave` gives `{ what: 'Smoke aired out', verb: 'aired out' }` for a clean state and nothing otherwise.
- **Tests first,** in `Effect.test.tsx`: a reader never sees Air it out; an author sees Wave the smoke during the hold with
  the countdown, then Air it out once the clock passes the hold; holding it saves a share at each finished line and clean at
  the end; a reload with a saved share starts the sweep below it and draws no fog above it; a clean play draws nothing and
  says Aired out; a play with no `ends` keeps drawing a week on at the floor's opacity; a play with an `ends` still ends.
  Red run: the control's label never changes.

## Task 6. Steel Chair

Model: haiku

Files: `instances/divided-world/cards/steel-chair.ts` and its test; `instances/divided-world/ui/steel-chair/Effect.tsx` and
its test (line 1938); `instances/divided-world/ui/cards/steel-chair/ui.ts`; `instances/divided-world/ui/index.test.tsx`
(lines 46 and 1647). Read only these.

- **`steel-chair.ts`**: drop `lasts` and `STEEL_CHAIR_LASTS`. The header's "and each is gone 3 days after it landed" becomes
  "and they stay until an admin ends a play".
- **`steel-chair.test.ts`**: the facts test (line 18) says no `lasts`, and its name drops "that lasts three days"; the
  `live` fixture (line 15) has no `ends`; the `ended` fixture stays, since an old play's `ends` still ends it.
- **`Effect.tsx`**: drop the import of `STEEL_CHAIR_LASTS`. In the Lens (about line 870), when several plays carry `ends`,
  the line is `` `The first one is gone ${dayAndTime(at)}.` ``; one play with `ends` keeps `endsWords`; none gives no
  `ends`. The test at line 1938 expects the new line, and a new test shows a play with no `ends` gives none.
- **`ui.ts`** (line 32): replace `and each is gone ${spanWords(STEEL_CHAIR_LASTS)} after it lands.` with `and they stay.`,
  and drop the import. `index.test.tsx` matches the new description, and line 1647's assertion and line 46's import go.
- Red run: the facts test fails while `lasts` is set.

## Review focus

- Plays already on a deployed instance keep their `ends`. Check that nothing reads `rules.lasts` for a play that has its own
  `ends` (the Lens, `drives.ts`, `FamousPost` stories, the fake), so old plays still end and new ones never do.
- `spring_facts` and `place_cast` must count the same way: a back of Hot Box springing on an aired-out post lands where a
  direct cast would, and the layer still goes on from the highest taken.
- A final clear is one-way only if every writer of `effect_state` goes through `save_effect_state`; check that no other
  function writes a cleared row.
- The aired band against "An effect fills the post": the remaining smoke still meets the side and bottom borders, in a
  thread and in the ORIGIN box.
- The masks: "Air it out" and the countdown appear only on `reader.author`. The hold refusal still comes before the database's
  author check, and the final-clear refusal after it.
- A busy instance: the stack counts' extra `effect_cleared` read is per counted play of the card only, not per play on the
  post.
