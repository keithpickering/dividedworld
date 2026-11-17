# Settlement: the flat Earn and the cushion: plan

Record, written 2026-11-16. Carries out section 3 of `docs/plans/2026-11-16-settlement-design.md`. One PR from `main`.

**May start** now. It adds no card. No card build of Wave 2 starts until it merges, and no other build of the
roadmap that edits `engine/rules/settle.ts`, `settlement_input`, `estimate_input` or `card_kinds_problem` runs
beside it (`docs/plans/2026-11-14-base-set-design.md`, section 0.2).

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
tests of the changed code (`node --experimental-strip-types --test <file>` for the rules, `npx vitest run <file>`
for the screens, `npm run test:sql` for Task 4). Run `npm run typecheck` and `npm run build` once after the last
task, with the tails in the PR. Test against Postgres on localhost; no deployed database, bucket or connector is
touched.

**The layers.** Tasks 1 to 5 are the engine's and name no card and no class; their tests use cards and classes made
in the test file, as `engine/rules/settle.test.ts` does today. Task 6 is Divided World's.

**What a player sees change.** Heat Magnet, Publicity Tour, Class Clown and Hype-Up pay a flat share of a vote for
each vote, to any class; their words say so; a settled boost line says its size.

## Task 1. The effect types and their checks

Model: sonnet

**Files:** `engine/rules/cards.ts` (`GimmickEffect`, `GIMMICK_KINDS`, the comment above them),
`engine/rules/types.ts` (`Earning`), `engine/rules/instance.ts` (`gimmickProblems`), `engine/rules/instance.test.ts`,
`engine/rules/cards.test.ts` where it lists the kinds.

`GimmickEffect`'s `earn` member becomes two, and a new member is added:

```ts
| { readonly kind: 'earn'; readonly quadrants?: readonly Quadrant[]; readonly reactions?: readonly string[]; readonly by: number }
| { readonly kind: 'earn'; readonly quadrants?: readonly Quadrant[]; readonly reactions?: readonly string[]; readonly flat: number; readonly acts?: readonly ActKind[] }
| { readonly kind: 'cushion'; readonly share: number }
```

`GIMMICK_KINDS` gains `'cushion'`. `group` is gone from the type. Rewrite the comment above the type: an earn is a
percentage of what reactions earn (`by`) or a flat share of a vote for each vote (`flat`), on posts unless it names
`acts`; of the flat earns on one vote the largest applies; a cushion gives back a share of each loss a reaction
causes.

`Earning` gains, beside `kind`:

```ts
/** The signed votes of the one reaction it pays for, where it pays per vote: with a negative amount on positive votes it is a loss from a reaction, which a cushion softens; an earning without it is never cushioned. */
readonly votes?: number;
```

`gimmickProblems`, in the engine's words, each tested red first in `instance.test.ts` beside the earn problems there:

- an earn with both `by` and `flat`, or neither: `has an earn with no size; an earn has by or flat, and not both`;
- `flat` not a number above 0 and at most 1: `has an earn of flat <value>; flat is above 0 and at most 1`;
- `acts` on a `by` earn: `has an earn with acts and by; only a flat earn names acts`;
- `acts` not a non-empty list of Act kinds: `has an earn naming the acts <value>; an act is a kind of Act`. Find the
  list of Act kinds the engine already holds (`ActKind` in `types.ts`); if there is no runtime list, add one beside
  the type, as `QUADRANTS` is;
- a `group` key: `has an earn with a group; no earn has one, and of the flat earns on one vote the largest applies`;
- a cushion whose `share` is not above 0 and at most 1: `has a cushion of <value>; share is above 0 and at most 1`;
- the unknown-kind sentence now lists cushion (it is built from `GIMMICK_KINDS`).

The existing rules stay: an earn names a quadrant or a reaction; `by` is above 0 and at most 1. `playProblems`
needs no change (a cushion is a use card's, and a cast card may carry only an earn); add a test that a cast card
with a cushion is refused in the existing words.

## Task 2. The flat Earn in the settlement

Model: sonnet

**Files:** `engine/rules/settle.ts`, `engine/rules/settle.test.ts`, `engine/rules/settle.scale.test.ts`.

In `settle`:

- **`by` earns** keep the pass they have (the loop after each character's class earnings), with the group logic
  removed: every applicable `by` earn boosts on its own. A `by` boost's contribution carries
  `params: { card, by }`. A flat earn is left out of `boostsOn`.
- **Flat earns** get a pass of their own in the card payouts part of the function, after the ride. Index the flat
  plays once, by what they are on, as `boostsOn` is built (a character-reach play by `a.on`, a post play by
  `a.target`; a play with no `ends` pays nothing). Then one pass over `windowVotes`. For a line `v` on Act `t`
  (`actOf(v.act)`), the plays that apply are those on `t.character` and on `v.act`:
  - `v.at >= g.from && v.at < g.ends`;
  - `g.quadrants` holds `v.quadrant`, or `g.reactions` holds `v.kind`;
  - `g.acts` holds `t.kind`, or `g.acts` is absent and `isPost(t.kind)`;
  - the voter's first reaction to the Act is no earlier than the play:
    `onAct.get(v.act)!.first.get(v.player)! >= g.from`.

  Of those, the largest `flat`; a tie goes to the earlier play, then the smaller play id. It pays
  `tidy(g.flat * settings.vote * v.votes)` to `t.character`: a contribution with no `class`, reason `card.boost`,
  `params: { card: g.card, flat: g.flat }`, and `act`, `quadrant` and `at` from the line. A zero is no contribution.
  `v.votes` is the halved weight and may be negative.
- `entryKey` and the details are unchanged: an entry is still one per player, character, reason and card, and a
  detail keeps only `card` of the params.
- Rewrite the header comment's earn bullet to say all of this, and say there that a flat earn follows the halving
  where a skim and a ride do not.

Tests, red first, in `settle.test.ts`. The tests of `group` (from "a cast earn on a post boosts the post earning
alone, and shares its group" to "a tie in a group goes to the earliest play") are replaced by flat tests of the same
situations; the other `by` tests stay and gain the `by` in the entry's params. New, each with a class that gains
from one quadrant and loses from another:

- a flat earn pays `flat` of a vote for a vote in its quadrant to a class that gains there, one that loses there
  and one that ignores it, the same amount each;
- on a character's second Act of the window from the same voter it pays half (the halving), and the estimate
  (`estimateForOwner`) pays whole;
- it pays nothing outside its time, at its end, in a quadrant it does not name, on a play with no `ends`, or for a
  reaction by the character's own player;
- by reaction kind: it pays the named kind and leaves another kind of the same quadrant, and a post-local reaction of
  the same quadrant, alone;
- with no `acts` it pays on a post and a spin and not on the character's card Act; with `acts: ['card', 'spring']`
  it pays on a card Act and a spring Act and not on a post;
- a voter who first reacted before the play is never paid for, though they add a reaction in the quadrant while it
  is up;
- a vote paid in one window that splits to another quadrant in the next, while the play is up, takes back that
  share's pay; after the play ended it takes back nothing; and over any such sequence the play's entries sum to
  zero or more;
- two flat earns on one vote, one on the character and one on the post: one entry, the larger's card; a tie, the
  earlier play, then the smaller id; where their times overlap in part, a vote inside only one is paid by that one;
- a flat earn and a `by` earn on one vote both pay;
- a cast flat earn on another player's post pays the post's author and the caster nothing;
- the entry's params are `{ card, flat }`, and the details of the entry add up to it;
- an admin-ended play is not in the input and pays nothing (as the `by` test of that name).

In `settle.scale.test.ts`, beside "earn gimmicks on many characters": two flat earns on each of 3,000 characters,
and the time it prints stays in line with the `by` case there.

## Task 3. The cushion in the settlement

Model: sonnet

**Files:** `engine/rules/settle.ts`, `engine/rules/settle.test.ts`.

- `Contribution` carries `votes` from the class's `Earning` (add it where the class's earnings are pushed).
- Index cushion plays as the earns are (character-reach by `a.on`, a post play by `a.target`, with `ends`).
- In the per-character loop, after the class earnings and beside the `by` pass, over the class's own earnings only
  (the slice before any boost is pushed): an earning with `at`, `act` an Act of this character, `amount < 0` and
  `votes > 0`, inside a cushion's `[from, ends)` on the character or on the Act, gets one contribution from the
  largest `share` (tie: earlier play, then smaller id): reason `card.cushion`, amount `tidy(-share * e.amount)`,
  `params: { card, share }`, the earning's `act`, `quadrant` and `at`, and no `class`.
- The header comment gains a cushion bullet, with the bound from the design's section 3.2.

Tests, red first:

- a loss with `votes` is half given back under a 0.5 cushion; a gain is untouched; a loss outside its time is
  untouched;
- an earning with a negative amount and no `votes` (a cost no reaction caused) is untouched;
- a gain taken back (negative amount, negative `votes`) is untouched, and a loss taken back (positive amount) is
  untouched;
- two cushions: the larger alone; a cushion on a post softens that post's losses alone;
- beside a flat earn on the same vote: both entries, each as it would be alone;
- the entry's params are `{ card, share }`; it is in no class's `byClass`; the details add up;
- the estimate shows the cushion's line at the reaction's time.

## Task 4. The SQL

Model: sonnet

**Files:** a new migration, taking the next free number above the highest merged
(`supabase/migrations/`), and a new `supabase/tests/NNNN-cushion.sql` with the same number.

Before writing, find the latest definition of each thing replaced (`grep -ln` over `supabase/migrations/`), and copy
it whole from there: when this plan was written they were `card_kinds_problem` in `0369_hype_up_on_a_post.sql`,
`settlement_input` and `estimate_input` in `0370_caught_casts_never_end.sql`, and the constraint
`card_kinds_gimmick_kind` (first in `0148_card_types.sql`, widened since). Then
`grep -rn "gimmick ->> 'kind'" supabase/migrations` and read every reader in its latest definition: none other
should need the cushion (a ward, a price, a ride and a no-quote are each asked for by name); if one does, stop and
say so in the PR.

1. `card_kinds_gimmick_kind`: dropped and added again with `'cushion'` in its list.
2. `card_kinds_problem`: the kind list and its sentence gain cushion, in the engine's words from Task 1.
3. `settlement_input` and `estimate_input`: `earn_up` reads plays whose card's gimmick kind is `earn` or `cushion`,
   in both its filter and its longest-`lasts` subquery. Nothing else changes; `ends` is already sent for any card
   with a gimmick.

The migration's header says what changed in each, the ways out (a cushion ends at its time or by an admin, as any
use card) and the masks (nothing new is read: a cushion play is a public Act).

Tests, red first (model: `supabase/tests/0161-earn-casts.sql` and the test `0369` names in its header): the catalog
takes a use card with a cushion and refuses a gimmick of an unknown kind in the new sentence; `settlement_input`
carries a cushion play made before the window and still up, with its `ends` and `on`, and leaves out one an admin
ended and one that ended before the window; `estimate_input` carries the caller's and not another player's.

## Task 5. The engine's screens

Model: inline

**Files:** `engine/ui/copy-words.ts` and its test (`FRACTIONS` gains `[0.75, 'three quarters']`: "three quarters of
a vote"), `engine/ui/data/api.ts` (`LedgerParams`' comment: a boost's size and a cushion's share travel there too),
`engine/ui/log/lines.ts` (`scoredAs`' comment names `card.cushion`; its code already leaves out every `card.`
reason; add a test line that a `card.cushion` line does not change the class a character is scored as).

## Task 6. Divided World: the four built cards, the classes and the words

Model: sonnet

**Files:** `instances/divided-world/cards/publicity.ts`, `heat-magnet.ts`, `class-clown.ts`, `hype-up.ts`,
`publicity-tour.ts` (comments); `instances/divided-world/classes/shared.ts`, `technician.ts`, `tweener.ts`,
`lurker.ts`; `instances/divided-world/ui/cards/words.ts`; the four cards' `ui/cards/<key>/ui.ts`;
`instances/divided-world/ui/index.ts` (the reason words); and the tests that hold them:
`instances/divided-world/cards/cards.test.ts`, `instances/divided-world/classes/classes.test.ts`,
`instances/divided-world/ui/index.test.tsx`. Find any other test that states `75% higher`, `doubled` or
`group: 'publicity'` with `grep` and change it with its card.

The rules:

- `PUBLICITY`: `{ kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], flat: 0.5 }`; `HYPE`:
  `{ ...PUBLICITY, flat: 1 }`. No group.
- Heat Magnet: `{ kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 0.75 }`.
- Class Clown: `{ kind: 'earn', reactions: ['laughing', 'eye-roll'], flat: 1 }`.
- Each file's header comment says the flat size and that it pays any class.

The classes: every earning paid per vote sets `votes` to the votes it multiplied: `perVote` (`shared.ts`),
`technician.evergreen`, `tweener.shrugged`, `lurker.cardDrew`. No other earning gains it.

The words (`ui/cards/words.ts`): `earnWords(card)` returns the size for a flat earn as
`${shareWords(flat)} more` ("half a vote more", "three quarters of a vote more", "a vote more") and throws for a
card with no flat earn. Add `LARGEST = 'Where two cards pay on the same reaction, only the larger pays.'`.

Each card's `ui.ts`, with the tagline and status unchanged. The sentences, with every size and span read from the
rules as today:

- **Heat Magnet.** Summary: "Used on your own character. For 3 days, each negative reaction to its posts pays three
  quarters of a vote more." Log: "Each negative reaction to that character's posts pays three quarters of a vote more
  until it ends." Describe: "A Salty card, uncommon, used on your own character, the one playing it. For 3 days,
  each negative reaction (excited or bored) to its posts pays three quarters of a vote more, whatever its class
  makes of that reaction, and then it stops by itself. It counts reactions from players who first react to a post
  while it is up. Where two cards pay on the same reaction, only the larger pays. It costs nothing more to use."
- **Publicity Tour.** The same three, with "positive reaction", "(excited or calm)" and half a vote.
- **Class Clown.** The same three, with "each 😂 and each 🙄 on its posts pays a vote more".
- **Hype-Up.** Summary: "Cast on a post. For 3 days, each positive reaction to it pays its author a vote more."
  Log: "Each positive reaction to that post pays its author a vote more until it ends." Describe keeps its
  sentences about any post, one at a time, taking nothing from the caster, the Mod Bot and the set Move, and
  replaces the earning sentence, "It never makes a loss worse" and the Publicity Tour sentence with: "each positive
  reaction (excited or calm) to that post pays its author a vote more, whatever their class makes of it" and the
  `LARGEST` sentence.

The reason words (`ui/index.ts`):

- `card.boost`: with a `flat` in the params, "`<Card>`: `<shareWords(flat)>` more for each reaction it named, from
  players who first reacted while it was up"; with a `by`, or neither (a row settled before this change), today's
  words.
- `card.cushion`: "`<Card>`: `<share as a fraction: 'half'>` of each loss from a reaction, given back"; a card the
  instance does not have is "A card". If a test holds every reason the instance can settle to its words, add
  `card.cushion` there.

Tests, red first:

- `cards.test.ts`: the four gimmicks deep-equal the rules above; `instanceProblems(instance)` is empty;
- a new settlement test with the real instance, in `cards.test.ts` beside the earn cards' facts (the card plans
  model theirs on it): a Technician under Heat Magnet with one heat vote from another player on a post has
  `technician.draggedIn` of -10 and a `card.boost` of 8 (7.5, rounded) with params
  `{ card: 'heat-magnet', flat: 0.75 }`; a Heel with the same has its gain and the same boost; Hype-Up and
  Publicity Tour both up on one calm vote make one boost, Hype-Up's;
- `classes.test.ts`: each per-vote earning carries `votes`, and `lurker.postedTooMuch` does not;
- `ui/index.test.tsx`: the lines that match `75% higher` and `is doubled` match the new sentences; no card's words
  hold "%" for an earn; the `card.boost` words with and without a size, and the `card.cushion` words.

## Task 7. The build

Model: inline

`npm run typecheck`, `npm run build` and `npm run test:sql`, tails in the PR. Comment on #742 with what this merged
(a settled line records its size) and what remains (the play's own record, for Plays).

## Review focus

- **Acts an instance already holds.** A `card.boost` row settled before this change has no size and keeps today's
  words; an Earn play made before the merge and still up settles flat from the next window. No instance is deployed;
  confirm nothing reads a held row's params as if a size were always there.
- **A play never costs its holder.** The first-reaction rule is what bounds a take-back. Confirm it holds when the
  largest earn on a vote changes between the pay and the take-back, and across a retune between windows (#742's
  remainder: it need not hold there, and the PR says so).
- **The cushion's bound.** A cushioned loss later split away is given back whole (design, section 3.2). Confirm the
  bound stated in the header comment is the one the code allows, and that a reaction still cannot be removed.
- **A second run.** `settle` is pure and a retried window reads the same `paid`; confirm the new passes read only
  `windowVotes`, `onAct` and the input, and nothing that differs between a run and its retry.
- **A busy instance.** The flat pass is the window's vote lines times the plays on each line's Act and character.
  Confirm no step scans every play per vote, and read the scale test's time.
- **The masks.** The estimate must show nothing computed from who reacted: confirm that with the shared vote off the
  first-reaction rule reads each reaction's own time, and that `estimate_input` still sends only the caller's plays
  and the public plays on the caller's posts.
- **`by` is kept and no card uses it.** Its tests are the engine's own cards. Confirm it still pays as it did, less
  the group.
- **The words.** Every sentence in Task 6 is a draft the owner reads in the PR.
