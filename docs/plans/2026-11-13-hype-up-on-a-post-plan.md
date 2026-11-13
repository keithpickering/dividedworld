Record, written 2026-11-13.

# Hype-Up on a post: plan

Carries out `docs/plans/2026-11-13-hype-up-on-a-post-design.md`. Hype-Up becomes a common Sweet Move cast on one post,
which earns double from excited- and calm-positive reactions for 3 days and keeps Publicity Tour's group, sold at 1.00
orb. The engine learns that a cast card reaching a post alone may carry an earn and a time up. Line numbers are as read
at `00fa2cde`. Read the function, not the line.

## Task 1. The engine's rules allow a cast earn on a post (engine)

Model: sonnet

**Files:** `engine/rules/instance.ts` (`playProblems`); `engine/rules/instance.test.ts` (the cast-earn cases at
:766-806); `engine/rules/cards.ts` (the doc comments on `CardRules.gimmick` at :240-243, `CardRules.lasts` at
:247-250, and `GimmickEffect` at :84-91).

In `playProblems`:
- `castEarn` (:575) is true for a cast card whose earn reaches a character alone, or a post alone. A post alone is
  `reaches` undefined or exactly `['post']`, as `postAlone` already reads it (:585-586; move the `beyond`/`postAlone`
  lines above `castEarn`).
- The refusal (:576) becomes, in these exact words:
  `${who} has a gimmick, and only a use card has one, or a cast card on a character alone or a post alone an earn`.
- The time-up refusal (:587) also exempts a cast earn: `... && c.skim === undefined && !castEarn`.
- A new refusal, beside it: a cast earn on a post alone with no `lasts` gives
  `${who} has an earn with no time up (lasts); an earn on a cast card ends at its time`.
  A cast earn on a character already fails without one, through the beyond-a-post rule (:732).

**Tests first** (`instance.test.ts`, red before the change):
- `cast({ gimmick: earn, lasts: days3 })` and `cast({ reaches: ['post'], gimmick: earn, lasts: days3 })` pass (today
  :771 expects a refusal; it flips).
- `cast({ gimmick: earn })` with no `lasts` gives the new no-time-up words.
- `cast({ reaches: ['character', 'post'], gimmick: earn, lasts: days3 })` still refuses, with the new gimmick words.
- A cast card on a post with a ward and a `lasts` still refuses with the gimmick words, and with the time-up words.
- A cast earn on a character passes, as today.
- Update every existing assertion that matches the old gimmick words.

## Task 2. The catalog, the cast and the spring in SQL (engine)

Model: sonnet

**Files:** `supabase/migrations/0351_hype_up_on_a_post.sql` (new); `supabase/tests/0161-earn-casts.sql`; a new
`supabase/tests/0351-post-earn-casts.sql` if 0161 grows past one subject. Use the next free number at build time if
0351 is taken.

The migration opens with a header in the house form: what it changes, the ways out, the masks. Then:
1. **`card_kinds_gimmick_use`** (latest at `0316_card_notes_part_4.sql:35-36`), dropped and added again:
   `gimmick is null or play = 'use' or (play = 'cast' and gimmick ->> 'kind' = 'earn' and reaches in ('{character}', '{post}'))`.
2. **`card_kinds_lasts_use`** (latest at `0151_card_payouts.sql:53-54`), dropped and added again, with
   `or (play = 'cast' and gimmick ->> 'kind' = 'earn')` added.
3. **`card_kinds_problem`** (latest at `0316:44`): `create or replace`, copied whole from 0316, with only these
   changes, in the words Task 1 gives, byte for byte:
   - the gimmick rule (:78-79) accepts a post alone (`not c.beyond`) beside `c.character_alone`;
   - the time-up rule (:91-92) exempts a cast earn;
   - the new no-time-up rule for a cast earn on a post alone.
4. **`place_cast`** (latest at `0317_surfaces.sql:749`): `create or replace`, copied whole. The only change is that the
   `ends` line (:956) also writes `ends` for a cast earn on a post:
   `reach = 'post' and (kind_of.play = 'use' or kind_of.skim is not null or kind_of.gimmick ->> 'kind' = 'earn') and kind_of.lasts is not null`.
   The stack count (:835) already treats a play whose `ends` has passed as holding no place, so a second Hype-Up is
   refused while one is live, and lands after.
5. **`lay_sprung`** (latest at `0317:1144`): `create or replace`, copied whole. A sprung cast earn on a post gets `ends`
   (:1186-1187: `elsif (kind_of.skim is not null or kind_of.gimmick ->> 'kind' = 'earn') and kind_of.lasts is not null`)
   and writes it into the payload (:1195), as a skim's is.

Before copying, check that no migration after 0316/0317 redefines these functions
(`grep -l "function place_cast" supabase/migrations/*.sql | tail -1`).

**Tests first** (red before the migration):
- In `0161-earn-casts.sql`: the insert of a cast earn on `{post}` (:50-51) now goes in. The one on `{post,character}`
  (:48-49) is still refused. The `card_kinds_problem` case (:66-67) flips to clean with a `lasts`. A new case with no
  `lasts` gives the no-time-up words. A cast earn on `{post}` with no `lasts` is refused at the table by
  `card_kinds_gimmick_lasts` (0148:32, `gimmick is null or lasts is not null`, unchanged): assert it.
- A cast of a test earn card on a post writes `ends` equal to `now() + lasts`. A second cast on the same post is refused
  with "this post already carries that card". After `ends` has passed (backdate the payload's `ends` in the test), a
  cast lands.
- A test earn card set face down and sprung by a quote lands on the quoting post with `ends`.
- `settlement_input` for a window holding that post play carries it with `target` and `ends`. Then `settle()` boosts the
  post author's earning on that post and no other post of theirs. This is a TypeScript case in
  `engine/rules/settle.test.ts` beside `castGrouped` (:1137): a cast earn play on a post with `by: 1` and group
  `publicity`, beside a character play of group `publicity` with `by: 0.2`. The post's earning gets the 1, and another
  post of the same character gets the 0.2.
- Update the header comments of 0161 (:2-4, :130) that say a cast earn is a character's.

## Task 3. The fake back end writes the same `ends` (engine)

Model: inline

**Files:** `engine/ui/data/fake.ts` (the cast write, :1912; the spring's landing if it writes a payload `ends` for a
skim); `engine/ui/data/fake.test.tsx` (beside :4230).

The cast's payload writes `ends` when `rules.lasts` and (`rules.skim` or `rules.gimmick?.kind === 'earn'`), mirroring
Task 2. **Test first:** a cast of a post earn card in the fake has `ends` a `lasts` out, and a second cast on that post
is refused until it passes.

Tidy: `engine/ui/cards/Lens.tsx` near :222, where the `latestEnd` comment says only a play beyond a post ends on a timer,
now says any play with `ends`.

## Task 4. Hype-Up's rules and slot (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/publicity.ts`, `hype-up.ts`, `publicity-tour.ts` (header only);
`instances/divided-world/machine.ts`; `instances/divided-world/cards/cards.test.ts`.

`publicity.ts` keeps the one list the two cards share, the quadrants, the group and the span. Publicity Tour's push
stays as it is:

```ts
/** The push Publicity Tour gives its own character. Hype-Up gives one post the same push, doubled; one group, so the two do not add and the larger applies. */
export const PUBLICITY: GimmickEffect = { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.2, group: 'publicity' };
/** Hype-Up's push on one post: Publicity Tour's quadrants and group, doubled. */
export const HYPE: GimmickEffect = { ...PUBLICITY, by: 1 };
export const PUBLICITY_LASTS: Span = { unit: 'day', count: 3 };
```

`hype-up.ts`: `rarity: 'common'`, `reaches: ['post']`, `gimmick: HYPE`, `lasts: PUBLICITY_LASTS`, and the default stack
of one. Its header comment says: Sweet, common, Cast on a post, anyone's; for 3 days every positive reaction (excited or
calm) that post earns its author counts double, and then it ends by itself; one group with Publicity Tour, so the larger
applies; it pays the caster nothing; designs named.

`machine.ts:31`: `price: 100`. The slot stays where it is.

**Tests first** (`cards.test.ts`, red before the change):
- :31: the price list's `['hype-up', 'sweet', 100]`.
- :237: `[['post'], days3, { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 1, group: 'publicity' }]`.
- :671-673: `['hype-up', 'common', 'cast', 'sweet', 'onSale', 100]`.
- :682-684 becomes "Hype-Up holds Publicity Tour's quadrants, group and span, doubled": `gimmick.quadrants` and
  `gimmick.group` equal Publicity Tour's, `by` is 1, and `lasts` is the same object.
- :708-712: `canApply` lands on a post and is refused on a character. A second on a post with a live Hype-Up is refused.
  It lands on a post whose Hype-Up has ended. `castOnPost` is true. `staffOffers` is false.
- Card Collector's and 4D Chess's configuration enums (`index.ts:57`, :69) now hold `'hype-up'`: assert it.
- The Booster test (:553-574): fourteen uncommons share the 74 (`0.74 / 14`), and Hype-Up is not in the hit pull. Read
  the list as it stands on the branch; do not copy these numbers if a sibling plan has added cards. Update the comment's
  count and its note on which commons the hit pull leaves out.
- `instanceProblems(instance)` is empty.

## Task 5. Hype-Up's words (instance)

Model: inline

**Files:** `instances/divided-world/ui/cards.ts` (:374-380); `instances/divided-world/ui/index.test.tsx` (:120, :189,
:718, :726, :731).

`earnWords(hypeUp)` reads "doubled" for a `by` of 1 (the 11-12 change), so the words take the numbers from the rules:
- `tagline`: `'Give a post a push.'`
- `summary`: `` `Cast on a post. For ${spanWords(hypeUp.lasts!)}, what it earns from positive reactions is ${earnWords(hypeUp)}. A loss is never made worse.` ``
- `describe`: `` `A Sweet card, ${hypeUp.rarity}, cast on any post, yours or another's. For ${spanWords(hypeUp.lasts!)}, whatever that post earns its author from a positive reaction (excited or calm) is ${earnWords(hypeUp)}, and then it stops by itself. Only reactions after it lands count, and a post carries one at a time. It never makes a loss worse, and it takes nothing from you. It does not add to the author's own Publicity Tour: while both are up, the larger applies. A Mod Bot earns nothing, so its posts gain nothing from one. ${setMoveWords('the quoting post')} It costs nothing more to play.` ``
- `logPlay`: `` () => `What that post earns from positive reactions is ${earnWords(hypeUp)} until it ends.` ``
- `status` stays `'Earns more from positive reactions'`.

**Tests first:** :120's `lands` table gives `'hype-up': 'the quoting post'`. :189 drops `'hype-up'` from the 20% loop,
and a line beside it expects `3 days[\s\S]*earns its author[\s\S]*doubled`. :718's tagline. :726's and :731's strings
as above.

## Task 6. The export carries a post earn (SQL e2e)

Model: haiku

**File:** `supabase/tests/e2e/0003-export.ts` (the `expearn` fixture, :245-259). Add a twin card kind `exppost`: a cast,
`'{post}'`, `interval '3 days'`, the same earn with `"by": 1`. Add one play of it on `earn_post` through `play_card`
with reach `'post'`. The round trip compares it like every other row. Assert that its payload's `ends` survives.

## Last. The full build, the pictures and the final review

- `npm run typecheck` and `npm run build:ci` are green, with the build's tail in the PR.
- Pictures in the PR: Hype-Up's face at every card size with the new tagline; the post play form listing Hype-Up; the
  Lens on a post carrying one ("Earns 100% more from some reactions" or what `gimmickWords` says for a `by` of 1, and
  "Ends …"); the refusal of a second Hype-Up on the post.
- The final reviewer reads the Review focus below.

## Ways out

- **A Hype-Up on a post** ends by itself at 3 days, or by an admin's end (`reverse_card`/`card_end`). It only raises an
  earning, so nobody has anything to get out of.
- **A second Hype-Up refused** is refused before it is written. The caster keeps the card, and the refusal is the
  post's public play. The post can take another when the first ends; the Lens shows when.
- **A Hype-Up caught by Card Collector** goes to the setter's hand, as any caught Move does.

## The masks

- **The boost** is applied only inside settlement, which shows each settled window's sums, and in the post author's own
  live estimate. It reads a play that is a public Act on a public post.
- **No refusal reads who owns the post.** Self-cast is allowed, and the one-per-post refusal reads the post's public
  plays. The same sentence comes back for everyone.
- **The caster** gets no line, alert or payload that depends on what the post earns. The author's log names the card
  that paid (`card.boost`), as it does today.
- **"The larger applies"** is decided inside settlement from the plays' public numbers.
- No Realtime event is added. A post play goes out as any post play does.

## The layers

- **Engine:** the cast earn on a post in `playProblems`, `card_kinds_problem` and the two constraints; `ends` in
  `place_cast`, `lay_sprung` and the fake. The engine names no card.
- **Instance:** Hype-Up's rules, `HYPE`, the slot's price and the words.
- **The interface** is `CardRules.gimmick` and `CardRules.lasts`, as for every earn. The boundary check holds.

## A busy instance

- **`place_cast`** gains nothing: the `ends` is one more key in a payload it already builds, and the stack count it
  already runs on the post.
- **Settlement** reads the post's earn plays through the existing `earn_up` window, indexed once by what they are on.
  Each earning's cost is the earns on its own character and its own post, as today. A post carries at most one live
  Hype-Up.

## Decided in planning

- **A cast earn on a character stays allowed.** The engine stays general, and the export test and the engine tests
  hold one. Only Divided World's catalog stops using it.
- **`HYPE` is Publicity Tour's effect spread with a new `by`,** in `publicity.ts`, so the quadrants and group are one
  list and no card file imports another card.
- **The new refusal words** are the engine's, identical in TypeScript and SQL.

## Review focus

- **Acts an instance already holds.** No instance is deployed. Confirm that a character-reach Hype-Up play written
  before the catalog change still settles and still ends by its own `ends` and `play_reach` row. Confirm that a
  Hype-Up already face down springs onto the quoting post with an `ends`, and never lands with none, which would hold
  the post's place forever and boost nothing.
- **The words agree.** `card_kinds_problem`'s three changed or new sentences are byte for byte `playProblems`'s, and the
  full copy of `place_cast` and `lay_sprung` differs from 0317 only in the lines named.
- **The group across a character and a post.** A post with a Hype-Up whose author has a Publicity Tour up earns double
  and not more, in the settlement and in the live estimate alike. The author's other posts earn the Tour's 20%.
- **Only reactions after the cast.** A post's earnings before the play's `at` are not boosted, and those after `ends`
  are not either.
- **A mask.** The caster's screens and payloads hold nothing computed from the post's earnings. The one-per-post refusal
  is the same for the author and for anyone else.
- **Card Collector and 4D Chess** list Hype-Up in their pickers, and a caught Hype-Up writes no `ends` and holds no
  place on the post.
