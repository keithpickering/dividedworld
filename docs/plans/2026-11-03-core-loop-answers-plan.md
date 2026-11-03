# The core loop's open questions: plan

Record, written 2026-11-03. The plan for `docs/plans/2026-11-03-core-loop-answers-design.md`. It is built by one build
session in one PR, from `main`, after the design's PR (which changes CLAUDE.md) is merged by the owner. The build PR
says `Closes #19`, `Closes #22`, `Closes #23`, `Closes #57`, `Closes #111`, `Closes #137` and `Closes #170`.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added.

**The boundary check holds:** nothing in `engine/` or `supabase/` names a Divided World class. The engine's word
functions gain the instance's settings as an argument; the instance's words read them.

**One migration:** the next free number in `supabase/migrations/` as `NNNN_core_loop_answers.sql`, with its SQL test as
the next free number in `supabase/tests/` as `NNNN-core-loop-answers.sql`, run against Postgres on localhost. Plans
already merged may land first, and their numbers are taken in order. Each function the migration replaces is copied
from its latest definition (`estimate_input` from `0055_card_reach.sql`, `masks_change` from `0028_loud_classes.sql`,
the season reveal from `0051_succession.sql`, `unmask` from `0027_unmask.sql`, `apply_settlement` from its latest),
and the build checks for a later one with `grep -l "function <name>" supabase/migrations/*.sql` before copying.

## Task 1. The estimate reads a card's post (#137) (SQL)

**Files:** the migration's `estimate_input`; test `supabase/tests/NNNN-core-loop-answers.sql`, and a case in
`supabase/tests/e2e/0005-estimate.ts`.

**Change:** `touched` gains `select a.target_act_id from acts a join voted v on v.id = a.id where a.kind in ('card',
'spring') and a.target_act_id is not null and coalesce(a.payload ->> 'reach', 'post') = 'post'`, so a card the caller
reacted to brings its post in, and `unscored` finds a staff post such a card landed on.

Tests first:
- SQL: Q plays a Sweetie on Z's post; C reacts to the card; `estimate_input(C)`'s `acts` holds Z's post. Red on main.
- e2e: the same, through the estimate function; the answer is 200 with C's lines. Red on main (500, from
  `settle: Act <target> is not in the input`).
- SQL: the same with Z a staff character; the post is in `unscoredTargets`.

## Task 2. The estimate counts every reaction but the caller's own on the caller's own (#19) (SQL)

**Files:** the migration's `estimate_input` (`all_reactions`); tests the migration's SQL test,
`instances/divided-world/classes/classes.test.ts`.

**Change:** `all_reactions`' `r.reactor_account is distinct from c.owner` becomes `not (r.reactor_account = account and
c.owner = account)`. A reaction by the caller to the caller's own character is still left out; every other reaction,
the author's own player's included, is counted under `keyed`'s per-mask keys, which the engine cannot tie to an author.
The header comment over `all_reactions` says why, and names the CLAUDE.md sentence.

Tests first:
- SQL: Bob's mask B2 reacts to Bob's post P, on which Ann's card sits; `estimate_input(Ann)`'s `reactions` holds B2's
  reaction, under a key that is neither `player` nor the key `others` gives P's author. Red on main.
- SQL: Ann's own reaction to Ann's own post is not in `estimate_input(Ann)`.
- `classes.test.ts`: the test that pins "Neither Bob's own cheer on his post ..." is rewritten to run settle on the
  settlement's input (where Bob's own cheer is not counted) and on the estimate's shape of input (where it is), so the
  difference is pinned as the design's, not lost.

## Task 3. A Pepperoni card's lean leaves out the target author's player (#170) (engine)

**Files:** `engine/rules/settle.ts` (`readsAs`); tests `engine/rules/settle.test.ts`,
`instances/divided-world/classes/classes.test.ts`.

**Change:** `readsAs` leaves out a vote whose `owner` is the caster's player or the target's author's player. The
target is `actOf(a.target)` when the play has one; a target in `unscored` (a staff post) has no author player, and only
the caster's is left out. The comment over `readsAs` cites the design's section 2.

Tests first:
- `settle.test.ts`: a Pepperoni card on J's post; J's second mask leaves one negative reaction; nobody else reacts; it
  reads as Pepperoni. Red on main (Salty).
- The same with one more negative reaction from a third player; it reads as Salty.
- On a staff post, the target has no owner; a negative reaction from a third player makes it Salty, as now.
- `classes.test.ts`: the Jabroni case of #170 pays no `jabroni.soldTheL`. Red on main.
- `estimateForOwner` with the caller as J: J's own reaction is left out, as before. With the caller as the caster and
  the reaction from J's second mask (keyed): it is counted, by the design's section 2.

## Task 4. A settle run claims its window, and a reveal waits it out (#22) (SQL, Edge Function)

**Files:** the migration (`settlement_claims`, `claim_settlement_window`, `unmask`); `supabase/functions/settle/core.ts`
(`runSettle`'s loop); tests the migration's SQL test, `supabase/functions/settle/core.test.ts`.

**Table:** `settlement_claims (window_end timestamptz primary key, claimed_at timestamptz not null default now())`. No
grant to `anon` or `authenticated` (`supabase/tests/0005-default-deny.sql`'s list is updated). Not an Act.

**Function:** `claim_settlement_window(window_end timestamptz)`, service only: an upsert that sets `claimed_at = now()`.
The settle loop calls it after `next_settlement_window` and before `settlement_input`; a failure to claim fails the run,
as any read does.

**`unmask`** gains, beside its known-end refusal, the same refusal when a claim exists with `window_end > p.asked_at`,
`claimed_at > now() - interval '5 minutes'` and no settlement with `ends_at = window_end`. The refusal's words become
"this character's Turn takes effect at the settlement now running; reveal in a few minutes", for both paths.

Tests first:
- SQL: a season's first window (no known end); a Turn waiting; a claim made; `unmask` refuses. Red on main.
- SQL: the settlement for the claimed window applied; `unmask` goes through.
- SQL: a claim made six minutes ago, unsettled; `unmask` goes through (the dead run's way out).
- SQL: a claim for a window ending before the Turn was asked; `unmask` goes through.
- `core.test.ts`: the fake db records `claim_settlement_window` before `settlement_input` for each window, with the
  window's end. Red on main.

## Task 5. An announced Turn carries no `since` (#23) (SQL, engine UI)

**Files:** the migration (`masks_change`, `turns_announced`, the season reveal's `shown`); `engine/ui/reveal/statements.ts`,
`engine/ui/reveal/Reveal.stories.tsx`, `web/src/data/supabase.ts` (the `turns_announced` read and `TurnAnnounced`);
tests the migration's SQL test, `engine/ui/reveal/Reveal.test.tsx`.

**Change:**
- `masks_change` writes `{was}` alone where `show_from`.
- `turns_announced` is recreated without `since`; the season reveal's `shown` drops it.
- `TurnAnnounced` and `Statement` lose `since`. `statements.ts` says "Heel, until its Turn on Oct 20", and `speaks`
  orders by `at`.

Tests first:
- SQL: alpha, a silent Turn to beta, then a Turn to gamma naming its old class: the tally's entry is `{"was": "beta"}`,
  `turns_announced` has no `since` column, and the season reveal's `shown` has no `since`. Red on main.
- `statements` test: a Turn with `was` reads "Beta, until its Turn on ...". Red on main.

## Task 6. "Stole the thunder" names its unit and window (#111) (instance UI)

**Files:** `instances/divided-world/ui/index.ts` (`face.stoleThunder`, `heel.stoleThunder`); any test that pins those two
strings (`grep -rn "drew more than the post"`).

**Words:** "Stole the thunder: its card on another's post drew more votes than the post this window", and the Heel's
"its Salty card on another's post drew more votes than the post this window".

Test first: the instance UI test asserts both reasons contain "more votes than the post this window". Red on main.

## Task 7. A class's words state the numbers in force (#57) (engine UI, SQL, instance)

**Files:** `engine/ui/types.ts` (`ClassLook.description`, `InstanceUi.reasonWords`); `engine/ui/log/lines.ts`,
`engine/ui/log/Settlement.tsx`, `engine/ui/log/Log.tsx`, `engine/ui/characters/ClassCards.tsx`,
`engine/ui/guide/markers.tsx`; `engine/rules/settle.ts` (an entry gains `params`); the migration (`ledger.params`,
`apply_settlement`); `supabase/functions/settle/core.ts` (passes `params`); `instances/divided-world/ui/index.ts`;
`instances/divided-world/classes/*.ts` (each class's entries name their params); tests `engine/ui/log/*.test.tsx`,
`instances/divided-world/ui/index.test.tsx`, `supabase/functions/settle/core.test.ts`, the
migration's SQL test.

**Types:**
- `ClassLook.description: (economy: Economy) => string`.
- `InstanceUi.reasonWords: (reason: string, params: Readonly<Record<string, number>>) => string`. A caller passes the
  ledger row's `params` where it has them, else the economy values the reason reads, from the instance's settings as the
  screens hold them (`withDatabaseSettings`'s result, through the screens' existing settings read).
- An entry (`engine/rules/types.ts`) gains `params?: Record<string, number>`: each class names, on the entries whose
  reason states a tunable number, the economy keys and values it used (`lurker.postedTooMuch` writes
  `{ postsAllowed: 3 }`).

**SQL:** `ledger` gains `params jsonb` (null where none); `apply_settlement` writes each entry's `params`; the ledger's
reads that feed the log return it. The export and import carry the column; the round-trip test covers a row with it.

**The Log** groups lines by reason and params, so two windows settled under different numbers are two lines.

Tests first:
- The instance declares, beside its words, the economy keys each description and each reason states
  (`wordsRead: Record<string, readonly string[]>`, keyed by class key or reason). The instance UI test renders each
  with those keys shifted by +17 and asserts the shifted number appears and the default does not; and it asserts that
  every word holding a digit or a number word (one to twenty) under the defaults declares at least one key. Poison,
  recorded in the PR: the Lurker's "three times a day" restored as a literal; the test goes red.
- `settle.test.ts`: a Lurker's `postedTooMuch` entry carries `params.postsAllowed`.
- The SQL test: `apply_settlement` writes `params`, and a ledger row with none reads null.
- The log test: a row with `params.postsAllowed = 4` reads "a post past four in one day" while the settings say 3.

## Task 8. The rule's words in the Strategy Guide and onboarding (instance)

**Files:** `instances/divided-world/guide/strategy-guide.md`, and any onboarding tip that states the live estimate
leaves out an author's own reactions or that a Pepperoni card's room includes the author (`grep -rni "estimate\|pepperoni"
instances/divided-world/guide instances/divided-world/ui/onboarding.ts`).

The Guide says, plainly, that the live estimate says "up to" and can count reactions the settlement will not, and that
a Pepperoni card's room is everyone but its caster and the post's author. Its copy is the owner's to approve in review.

Test first: `check-guide.mjs`'s existing test covers the Guide's shape; no new test. The PR's description quotes the
changed lines for the owner.

## Last. The full build and the final review

`npm run typecheck`, then `npm run build:ci`, both green, with output in the PR.

## Ways out of the states this adds

- A reveal refused during a settle run (Task 4): it ends when the run applies the window, or five minutes after the
  claim, by itself; the player may withdraw the Turn. The refusal says to try again in a few minutes.

## The masks

- Task 2: `estimate_input` reads ownership only to tell the caller's own reactions from the rest; every other
  reaction is keyed per mask.
- Task 3: the author's player is read only in the settlement, for a sum. In the estimate it can recognize only the
  caller.
- Task 4: the refusal turns on the caller's own Turn and the run's clock.
- Task 5: no public projection dates a silent Turn.
- Task 7: `params` are settings, which are public.

## Review focus

- Task 2: the estimate now says more than the settlement pays wherever an author's own masks react to their post; read
  whether any screen states the estimate as exact.
- Task 3: a play from an earlier window reads by this window's votes; check the author exclusion where the target
  author has since retired, and where the target is a reply whose author is the caster.
- Task 4: a claim written by a run that then reads no window to settle (a race with another run); two runs' claims on
  one window; the claim's five minutes against a busy instance's window, where `apply_settlement` can run past
  `MOST_RUN_MS`.
- Task 5: tallies already written keep `since` in their payload, and `acts_public` still shows it; read whether any
  screen reads the payload directly rather than `turns_announced`.
- Task 7: a ledger row from before the column reads its numbers from today's settings; and the Log's grouping by params
  at a busy instance's count of rows per character.
