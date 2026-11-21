Record, written 2026-11-20.

# The refund outcome, with Kick Me and Pay It Forward: plan

Carries out `docs/plans/2026-11-20-refund-outcome-design.md`. One PR from `main`.

**May start** once the Whoopee Cushion build (`docs/plans/2026-11-20-whoopee-cushion-plan.md`) has merged, and not
while any other build redefines `card_kinds_problem`, `seed_instance`, `spring_traps`, `place_cast`, `place_set` or the
`acts_spring_payload` constraint. Every SQL object below is copied whole from its latest migration on `main` at build
time (find it with `grep -l "function <name>\b" supabase/migrations/*.sql | tail -1`, and for the constraint
`grep -l acts_spring_payload supabase/migrations/*.sql | tail -1`), never from the version this plan names, since
Whoopee Cushion's build moves several of them. The TypeScript edits start from Whoopee Cushion's versions of the same
functions (`outcome` with `every`, `staffOffers`' outcome line, `springWords`' ride sentence).

**Slots.** `kick-me` falls alone between `jimmy-wails` and `last-word` in the sorted lists; `pay-it-forward` alone
between `overreaction` and `publicity-tour`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the rules'
tests, or `node tools/test-sql.mjs <file>` for one SQL test). Run `npm run typecheck`, `npm run build` and `npm run
test:sql` once after the last task, with the tails in the PR. No deployed database, bucket or connector is touched;
SQL tests run against Postgres on localhost.

**The layers.** Tasks 1 to 5 are the engine's: the refund outcome, the `refunds` field, the SQL, the fake, the play
model and the engine's words. Nothing there names a card or a class. Tasks 6 to 9 are Divided World's, through
`CardRules`, `CardUi`, `AlertCopy.trapStruck` and the instance's words.

**The world.** Pay It Forward's back is the board's own card back, flipped when it springs, as every Reversal's is.
Kick Me's sign is drawn on the post in the board's house style (a 2003 message board, color only on the game's own
pieces), and the sign is one of those pieces. Both cards' faces and sheets are the glass.

**The migration.** Named `NNNN_refund_outcome.sql`, where `NNNN` is one above the highest number in
`supabase/migrations/` on `main` **at the time this build merges**, not now. Rebase and renumber if `main` moves during
review. The SQL test file is `supabase/tests/NNNN-refund-outcome.sql` with the same number. It redefines these shared
objects, each copied whole with only the named change: `card_kinds_problem`, `seed_instance`, `spring_traps`,
`place_set`, `place_cast`, and the `acts_spring_payload` constraint; and it adds the `card_kinds.refunds` column with
its constraint `card_kinds_refunds_use`.

## Task 1. The refund outcome and the refunds field, in the rules

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/instance.ts`, `engine/rules/cards.test.ts`,
`engine/rules/instance.test.ts`, `supabase/functions/_shared/seed.ts`.

- `cards.ts`: the trap's `outcome` becomes
  `{ readonly kind: 'ride'; readonly share: number; readonly every?: true } | { readonly kind: 'refund' }`. Rewrite the
  trap's doc comment: a ride lets the cast land and pays the setter (as Whoopee Cushion's build left it); a refund lets
  the cast land and hands its card back to its caster's hand, and a staff cast passes over it. A `RideOutcome` type
  alias may name the ride member where the code needs it.
- `cards.ts`, `CardRules`: add `readonly refunds?: { readonly flavors: readonly Alignment[]; readonly count: number }`
  with the doc comment "A use card on a post alone, with a time up: while it is up, the first `count` casts on its post
  whose printed flavor is one of `flavors`, landing and not handed back by a card set face down, each go back to their
  caster's hand. A staff cast passes over it."
- `decideSet`: the throw "has a ride and its checked configuration names no quadrant" applies only to a ride outcome
  (and, as Whoopee Cushion left it, one without `every`).
- `staffOffers`: Whoopee Cushion's line refusing a set card whose trap has an outcome is narrowed to a ride outcome:
  `if (card.trap?.outcome?.kind === 'ride') return false;` with its comment kept.
- `instance.ts`, `outcomeProblems`: accept `kind: 'refund'`, which takes no other key: where the kind is `refund` and
  the outcome has any key besides `kind`, push `${who} has a refund outcome with ${key}; a refund outcome has a kind
  alone`. The kind refusal becomes `${who} has an outcome of kind ${JSON.stringify(e.kind)}; an outcome is ride or
  refund`. Its doc comment says both kinds.
- `instance.ts`: a new `refundsProblems(c, who, play)`, called where `skimProblems` is, when `c.refunds !== undefined`:
  not an object → `${who} has refunds that are not an object`; `play !== 'use'` → `${who} has refunds, and only a use
  card does`; reaches other than exactly `['post']` → `${who} has refunds, and a card with refunds reaches a post
  alone`; no `lasts` → `${who} has refunds with no time up (lasts)`; `flavors` not a non-empty array of distinct
  alignments → `${who} has refunds whose flavors are ${JSON.stringify(flavors)}; flavors are one or more of sweet,
  salty and pepperoni`; `count` not an integer from 1 to 10 → `${who} has refunds whose count is
  ${JSON.stringify(count)}; count is a whole number from 1 to 10`.
- `seed.ts`: the card's entry carries `refunds: c.refunds`, beside `gimmick` (a field left out travels as none).

Tests, red first:
- `instance.test.ts`, beside the outcome block (search "an outcome is ride"): a set card on a cast with
  `match: { flavors: ['sweet'], upTo: 'uncommon' }` and `outcome: { kind: 'refund' }` has no problem; with
  `outcome: { kind: 'refund', share: 1 }` it has the "a kind alone" problem; `kind: 'gift'` gives the new kind words.
- `instance.test.ts`: a use card on a post with `lasts` and `refunds: { flavors: ['salty'], count: 3 }` has no problem;
  one case for each refusal above, each matching its words exactly.
- `cards.test.ts`: `decideSet` of a refund set card with configuration `{}` is ok with price 0 and no `catches` (no
  quadrant throw); a ride without `every` still throws it.
- `cards.test.ts`, beside Whoopee Cushion's `staffOffers` test: a set card with a refund outcome is offered; one with a
  ride outcome is not.

## Task 2. SQL: the column, the checks, the seed and the spring

Model: sonnet

**Files:** a new `supabase/migrations/NNNN_refund_outcome.sql`, a new `supabase/tests/NNNN-refund-outcome.sql`,
`supabase/tests/0157-skim.sql`.

The migration opens with a header comment that names this plan and says each object is copied whole from its latest
version with only the named change. In order:

1. `alter table card_kinds add column refunds jsonb;` and the constraint `card_kinds_refunds_use`:
   `check (refunds is null or (play = 'use' and reaches = '{post}' and lasts is not null))`.
2. `card_kinds_problem`, copied from its latest. The outcome checks: the kind check accepts `ride` or `refund`, in the
   words of Task 1 (`card "%s" has an outcome of kind %s; an outcome is ride or refund`); add the refund check
   (`card "%s" has a refund outcome with %s; a refund outcome has a kind alone`, naming the first key besides `kind`
   in key order); a ride's share check applies to a ride alone. Add the `refunds` checks of Task 1 in the same words,
   reading `e -> 'refunds'`, with `flavors` read as an array of distinct members of `sweet`, `salty`, `pepperoni`, and
   `count` as a JSON number that is an integer from 1 to 10. Keep its grants.
3. `seed_instance`, copied from its latest (`0377_sealed_packs.sql` today): `refunds` joins the insert's column list,
   the values (`nullif(e -> 'refunds', 'null')`) and the `on conflict` update, beside `gimmick`.
4. The `acts_spring_payload` constraint, dropped and added again from its latest, with `('cast', 'returned')` added to
   the list of `(trigger, did)` pairs. The quadrant predicate is Whoopee Cushion's, unchanged: a `returned` spring
   names no quadrant.
5. `spring_traps`, copied from its latest (`0357_post_veils.sql` today), with two changes:
   - `did`: for a cast trap, `case f.kind_trap #>> '{outcome,kind}' when 'ride' then 'rode' when 'refund' then
     'returned' else 'caught' end`.
   - Right after `springs` is decided: a refund trap does not spring on a cast with no paying account:
     `if back_trigger = 'cast' and f.kind_trap #>> '{outcome,kind}' = 'refund' and actor is null then return null; end if;`
     with the comment "A staff cast has no hand to hand a card back to, so a refund back passes over it and stays set;
     the caster's staff flag is public." (`place_cast` passes `actor => payer`, null for a staff caster.)
   Nothing else: the ledger row for a refund is written by `place_cast` (step 7), so `spring_traps` writes no
   `card_ledger` row for a `returned` spring.
6. `place_set`, copied from its latest (`0374_cards_on_a_spun_thread.sql` today): the check that a set card with an
   outcome names a quadrant applies only where `kind_of.trap #>> '{outcome,kind}' = 'ride'` (and, if Whoopee Cushion's
   build left an `every` exception, keep it).
7. `place_cast`, copied from its latest (`0374_cards_on_a_spun_thread.sql` today):
   - A new local `lands boolean`, true where `sprung is null` or its `did` is `rode` or `returned`; every
     `(sprung is null or rode)` test becomes `lands`, and the payload's `caught` case reads `not lands`.
   - A new local `handed jsonb`. For a cast on a post that lands, with a non-null `payer`:
     - where `sprung`'s `did` is `returned`, `handed := jsonb_build_object('by', sprung -> 'payload' ->> 'set', 'card',
       sprung -> 'payload' ->> 'card')`;
     - otherwise, the post's live refunds Gimmick: the latest card Act on the target (`target_act_id = target`, `reach`
       post) whose card's `refunds` is not null, its `ends` ahead, not `card_ended`, whose `refunds -> 'flavors'`
       holds `kind_of.alignment`, and whose count of card Acts on the target with
       `payload #>> '{handedBack,by}' = <its id>` is below `(refunds ->> 'count')::integer`; if one is found,
       `handed := jsonb_build_object('by', <its id>, 'card', <its card>)`. The target's row is already locked
       (`for no key update` above), so two casts are counted one after the other.
   - The cast's payload gains `'handedBack', handed` where `handed` is not null.
   - After the Act is written: where `handed` is not null,
     `insert into card_ledger (account, card, kind, act, price) values (payer, card, 'returned', written, 0);`.
   - Comment the order: the Ward first, then the back, then the sign; a cast is handed back once at most.

Tests, red first:
- `0157-skim.sql`: the case asserting "an outcome is ride" now expects "an outcome is ride or refund"; add a clean
  refund card (assert `card_kinds_problem('[…]') is null`), a refund with a `share` (the "kind alone" words), and one
  case per `refunds` refusal.
- `NNNN-refund-outcome.sql`, modelled on `supabase/tests/0158-ride.sql` (its helpers, two players, a post) and on
  Whoopee Cushion's `ride-every` test, with this file's own cards (`rf…`): `rfgift` (sweet, uncommon, set, trap
  `{"trigger": {"on": "cast"}, "match": {"flavors": ["sweet"], "upTo": "uncommon"}, "outcome": {"kind": "refund"}}`),
  `rfsign` (pepperoni, common, use, reaches `{post}`, lasts 3 days, gimmick a flat earn on `excitedNegative` and
  `boredNegative` of 1, refunds `{"flavors": ["salty"], "count": 3}`), `rfsweet` (sweet, common, cast), `rfrare`
  (sweet, rare, cast), `rfsalty` (salty, common, cast), `rfcatch` (salty, common, set, a `catches` trap). Assert:
  - A sets `rfgift` on A's post with `{}`. B casts `rfrare`: no spring. B casts `rfsweet`: the spring is
    `did: 'returned'` with no `quadrant`; B's cast carries `handedBack` `{by: <set play>, card: 'rfgift'}`, a `layer`
    and no `caught`; B's ledger gains a `returned` row naming the cast with price 0, and `card_held` for B and
    `rfsweet` is what it was before the cast; A's ledger gains nothing.
  - A second `rfsweet` by B lands with no spring and no `handedBack` (the back is spent).
  - A uses `rfsign` on A's post. B casts `rfsalty` four times (a stack that allows it, or four posts' worth of
    `rfsalty` kinds with stack ≥ 4; pick what the file's helpers make simplest): the first three carry
    `handedBack.by` the sign and each writes a `returned` row; the fourth carries none and writes none.
  - A's own other character casts `rfsalty` on a fresh `rfsign` post: refunded exactly as B's (the masks).
  - A staff character's cast of `rfsalty` on a fresh `rfsign` post: no `handedBack`, no row, and the sign's count is
    unchanged; a staff cast of `rfsweet` on a fresh `rfgift` post leaves the back live.
  - Make `rfcatch` salty and common, naming `rfsalty`. On a post with a live `rfsign` and `rfcatch` set face down, B's
    `rfsalty` is caught: it carries no `handedBack`, writes no `returned` row, and uses no kick.
  - A ward that turns `rfsalty` away refuses the cast, and the sign's count is unchanged.
  - The constraint refuses a hand-written `('cast', 'returned')` spring carrying a `quadrant`, and accepts one without.
  - `card_kinds_refunds_use` refuses a `cast` row with `refunds`.

## Task 3. The fake

Model: sonnet

**Files:** `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

`playCard` (near line 2066) does what Task 2's `place_cast` does, in the same order: a refund back springs with
`did: 'returned'` and no `quadrant`, except for a staff caster; a landed, non-staff cast is handed back by the back or
else by the post's live `refunds` play with a kick left and the cast's flavor; the cast's payload carries `handedBack`;
the caster's hand gains the card (the fake's equivalent of the `returned` row, as its take-back does).

Tests, red first, in `fake.test.tsx` beside its ride tests: each bullet of Task 2's SQL test that the fake can express
(the refund back, the spent back, the three kicks and the fourth, the staff cast, the caught cast).

## Task 4. The play model and the sign's count

Model: sonnet

**Files:** `engine/ui/cards/types.ts`, `engine/ui/cards/plays.ts`, `engine/ui/cards/Effects.tsx`,
`engine/ui/cards/plays.test.tsx`, `engine/ui/cards/Effects.test.tsx`.

- `CardPlay` gains `readonly handedBack?: { readonly by: Id; readonly card: string }` (the cast's own payload, public)
  and `readonly handedOut?: number` ("how many casts on this play's post name it in `handedBack`; set only where it is
  above zero").
- `playOf` reads `handedBack` where the payload's is an object with string `by` and `card`.
- An exported `withHandedOut(plays: readonly CardPlay[]): readonly CardPlay[]`, returning each play with `handedOut`
  counted from the others' `handedBack.by` (the same array where none is named).
- Where `PostEffects` assembles a post's plays before handing each card its own (`here.plays`), it runs
  `withHandedOut` over the whole post's plays first, so a sign's play carries its count, and a refunded cast that
  arrives live redraws the sign. Read the ORIGIN box path (`docs/plans/2026-11-16-cards-on-a-spun-thread-design.md`)
  and make the same true there.

Tests, red first: `playOf` of a cast with `handedBack` carries it, and of one with a malformed `handedBack` does not;
`withHandedOut` counts two casts naming one play and leaves a play nobody names without the key; an Effect on a post
with a sign play and two casts naming it is handed the sign's play with `handedOut: 2` (a test card's Effect that
records its props, as the file's other tests do).

## Task 5. The engine's words for a refund

Model: sonnet

**Files:** `engine/ui/cards/land.ts`, `engine/ui/cards/land.test.tsx`, `engine/ui/types.ts`,
`engine/ui/alerts/words.ts`, `engine/ui/alerts/trap-reads.ts`, `engine/ui/alerts/words.test.tsx`,
`engine/ui/log/lines.ts`, `engine/ui/log/lines.test.tsx`.

Each sentence branches on the data it already has, never on a card's key: before a spring on
`rules.trap.outcome.kind`, after it on the spring's `did`, and on a cast on `handedBack`.

- `springWords`: a trap with a refund outcome says, exactly,
  `Waits for ${waits}${comma} to be cast on this post, lets it land, and gives the card back to its caster.`
  with `waits` and the comma as the ride sentence builds them.
- `types.ts`: `TrapStruckFacts.how` gains `'returned'`, with its doc line ("a cast landed on a refund back's post and
  its card went back to its caster's hand").
- `trap-reads.ts`: `setOf` also reads `handedBack.by` where the cast's spring is a `returned` one.
- Alerts, `trapSprang`, `did === 'returned'`: "A card it was waiting for was cast there and set it off. The cast landed,
  and its card went back to its caster." The caster's `trapStruck` passes `how: 'returned'` to the instance's voice,
  with the engine's own fallback "A card set face down on that post sprang on your cast. It landed, and your card is
  back in your hand."
- Log, the setter's spring line (`setEndRows`), `did === 'returned'`:
  `${card} on ${post} sprang when ${caster} cast ${move} on it. ${move} landed, and its card went back to its caster's hand.`
- Log, the `returned` line (near line 890): before today's old-voice branch, where the Act is a card Act with
  `handedBack`, the line is what `Your ${cardName(e.card)} came back`, details
  `The ${cardName(handedBack.card)} on ${where} gave your card back.` with no aura and no wallet. Today's branch is
  unchanged for a card Act without `handedBack`.

Tests, red first: `land.test.tsx`, the refund sentence for a match of Sweet up to uncommon ("Waits for a Sweet card up
to uncommon to be cast on this post, …"; take the `waits` words from the existing match tests); `words.test.tsx`, the
`returned` setter alert and the caster's fallback; `lines.test.tsx`, the setter's `returned` spring line, the caster's
`returned` line for a back and for a sign, and an old-voice refund row unchanged.

## Task 6. Pay It Forward's rules

Model: haiku

**Files:** a new `instances/divided-world/cards/pay-it-forward.ts`, a new
`instances/divided-world/cards/pay-it-forward.test.ts`, `instances/divided-world/cards/index.ts` (one import line and
one list line, between `overreaction`'s and `publicity-tour`'s), `instances/divided-world/cards/cards.test.ts` (one
line in the list of `'the instance sells its cards at their prices'`, between the same two:
`['pay-it-forward', 'sweet', 150],`).

`pay-it-forward.ts`, whole:

```ts
/**
 * Pay It Forward (Sweet, uncommon, Set): set face down on one of the player's own posts, it springs on the first Sweet card up to uncommon
 * cast there (docs/plans/2026-11-20-refund-outcome-design.md). The cast lands as usual, and its card goes back to its caster's hand
 * (`trap.outcome`, a refund); the setter is paid nothing for it. A staff cast passes over it. It takes no configuration. A ward on the post
 * is asked before the back, and a Move that lands from a quote is no cast, so neither meets it.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const payItForward: CardRules<Record<string, never>> = {
  key: 'pay-it-forward',
  name: 'Pay It Forward',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { flavors: ['sweet'], upTo: 'uncommon' }, outcome: { kind: 'refund' } },
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
```

In `index.ts`: `import { payItForward, price as payItForwardPrice } from './pay-it-forward.ts';` and
`[payItForward as CardRules, payItForwardPrice],`.

Tests, red first, in `pay-it-forward.test.ts`, modelled line for line on `rope-break.test.ts` and Whoopee Cushion's
test: its facts (key, name, alignment, rarity, play, the trap deep-equal to the one above, no `catches`, no `lasts`,
price 150); `decideSet` with `{}` and with `undefined` is ok with price 0; a second card face down on the post is
refused in the engine's words; a cast of it is refused with `'Pay It Forward is set face down on your own post'`;
`instanceProblems(instance)` is empty; `staffOffers(payItForward)` is `true`.

## Task 7. Kick Me's rules

Model: haiku

**Files:** a new `instances/divided-world/cards/kick-me.ts`, a new `instances/divided-world/cards/kick-me.test.ts`,
`instances/divided-world/cards/index.ts` (between `jimmy-wails`'s and `last-word`'s),
`instances/divided-world/cards/cards.test.ts` (between the same two: `['kick-me', 'pepperoni', 100],`).

`kick-me.ts`, whole:

```ts
/**
 * Kick Me (Pepperoni, common, Gimmick on the player's own post): for 3 days a "Kick Me" sign is taped on the post. Each negative vote on it, heat
 * or groan, pays its author a vote more, to any class (a flat earn, as Required Reading's), and the first three Salty cards cast there land and
 * go back to their casters' hands (`refunds`), a card set face down that hands one back first taking its turn
 * (docs/plans/2026-11-20-refund-outcome-design.md; its row, docs/plans/2026-11-15-base-set-card-numbers-design.md, section 3). A cast by the
 * author's own other mask is handed back like any other; a staff cast passes over it. One sign per post.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const kickMe: CardRules<Record<string, never>> = {
  key: 'kick-me',
  name: 'Kick Me',
  alignment: 'pepperoni',
  rarity: 'common',
  play: 'use',
  reaches: ['post'],
  gimmick: { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 1 },
  refunds: { flavors: ['salty'], count: 3 },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(kickMe, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
```

Check `required-reading.ts` first: if it leaves `reaches` out (a use card's default), leave it out here too and match
its shape.

Tests, red first, in `kick-me.test.ts`, modelled on `required-reading.test.ts`: its facts, the gimmick and refunds
deep-equal to the above, `lasts` 3 days, price 100; `decideUse` on the player's own post is ok; on another
character's post it is refused in the engine's words; a second while one is up is refused in the engine's words;
`instanceProblems(instance)` is empty with the card in.

## Task 8. The faces, the sheets, the sign and the instance's words

Model: sonnet

**Files:** new `instances/divided-world/ui/cards/pay-it-forward/ui.ts`, `instances/divided-world/ui/cards/kick-me/ui.ts`,
`instances/divided-world/ui/kick-me/Effect.tsx` and `instances/divided-world/ui/kick-me/kick-me.css` (laid out as
`instances/divided-world/ui/steel-chair/` is, and loaded lazily from the card's `ui.ts` as Steel Chair's is),
`instances/divided-world/ui/cards.ts` (one import line and one list line for each, in their slots),
`instances/divided-world/ui/trap-words.ts`, `instances/divided-world/ui/trap-words.test.tsx`,
`instances/divided-world/ui/index.test.tsx`, `instances/divided-world/ui/cards/kick-me/ui.test.tsx`.

- **Pay It Forward's entry**, following `ui/cards/rope-break/ui.ts`: Sweet's face colors as the other Sweet cards';
  tagline, summary and status as the design's section 1, with "Sweet" and "uncommon" read from `payItForward`; a
  `describe` in the house style of Rope Break's and Whoopee Cushion's, saying: set face down on one of your own posts;
  everyone sees a card back; the first Sweet card up to uncommon cast there springs it and shows it; that card lands
  as usual and goes back to its caster's hand (the card, not any price paid to play it); a Mod Bot's cast passes over
  it; a rarer card passes over it, and a card your post's ward turns away never reaches it; it springs once, or comes
  back to your hand after `${setLastsWords(settings)}`; it costs nothing more to set. No `Effect`, no `ConfigForm`.
- **Kick Me's entry**, following `ui/cards/required-reading/ui.ts` where it exists (else `hype-up`'s): Pepperoni's face
  colors; tagline, summary, status and `logPlay` as the design's section 1; a `describe` saying the earn (one vote
  more for each heat or groan vote on the post, to any class), the three Salty casts handed back (the card, not a play
  price; casts a card set face down catches or hands back don't count; a Mod Bot's cast passes over it), that the sign
  stays up paying after the three are used, and the 3 days. Every number is read from `kickMe` (`refunds.count`,
  `gimmick.flat`, `lasts`). Its `Effect` is the sign.
- **The sign** (`Effect.tsx`): it wraps `children` and draws, for the card's live play, a cardboard sign taped across
  the top border of the content area it is given: half above the border, half inside, tilted a few degrees, at about
  a third of the way in from the right. "KICK ME" hand-lettered on it (an inline SVG; no web font), and along its
  bottom edge `refunds.count` boot prints, of which the first `handedOut` are scuffed out. While the sign is up, the
  content area's top padding grows by half the sign's height, so no word sits under it. Nothing in it is pressable,
  and it covers nothing pressable. It carries `role="img"` and an `aria-label`: "Kick Me sign: N of 3 Salty cards
  still go back to their casters" (N and 3 from the data). No motion. In a spun thread's ORIGIN box it is drawn the
  same way against that box's top border under its band. Its width is at most 40% of the content area's and at most
  160 px, so it fits a phone.
- `trap-words.ts`: a `returned` branch: line "Paid forward", detail `Their face-down ${f.card ?? 'card'} sprang on your
  ${f.laid ?? 'cast'}. It landed as usual, and the card is back in your hand.` (The glass may be warm here; it never
  bluffs.)

Tests, red first:
- `index.test.tsx`: each card's status, colors, tagline and summary are the strings above; Pay It Forward has no
  `Effect` and no `ConfigForm`; Kick Me has an `Effect`; each `describe(instance.settings)` reads the numbers from the
  rules (change `kickMe.refunds.count` in a copy and see the words follow, as the file's other "read from the rules"
  tests do); the file's rules over every card pass with both in.
- `trap-words.test.tsx`: `returned` with a card and with `card: null`.
- `kick-me/ui.test.tsx`: the sign renders three boot prints and none scuffed for a play with no `handedOut`; two
  scuffed for `handedOut: 2`; its label says "1 of 3"; the content area's padding grows while it is up and not after
  its `ends`.

## Task 9. Both refunds, end to end on the fake

Model: sonnet

**Files:** new `instances/divided-world/ui/cards/pay-it-forward/ui.test.tsx` and additions to
`instances/divided-world/ui/cards/kick-me/ui.test.tsx`.

Against the fake with the real instance, as `ui/cards/rope-break/ui.test.tsx` is. Red first: write them before Tasks 6
and 7's cards are in the lists, see them fail on "no such card", then run them green.

- A sets Pay It Forward on A's post. B casts Hype-Up (Sweet, common) there: it lands, its play carries `handedBack`,
  B's hand holds the Hype-Up again, and the back shows Pay It Forward. A second Hype-Up by B lands with no
  `handedBack`.
- B casts a Sweet card above uncommon (found from `instance.cards`) on a fresh Pay It Forward post: no spring.
- A uses Kick Me on A's post. B casts Whoops! (Salty, common) there four times (or Whoops! and other Salty commons
  found from `instance.cards`, if Whoops!'s stack allows fewer): the first three come back to B's hand and the sign's
  `handedOut` reaches 3; the fourth does not come back. B's wallet shows Whoops!'s play price spent each time.
- B casts THIS (Pepperoni) on the Kick Me post: it lands and is not handed back.
- B's log shows "The Kick Me on … gave your card back." for each of the three (the engine's line, Task 5, with the
  instance's card name).

## Task 10. The build

Model: inline

`npm run typecheck`, `npm run build` and `npm run test:sql`, with the tails in the PR.

## Review focus

- **The copied SQL.** `card_kinds_problem`, `seed_instance`, `spring_traps`, `place_set`, `place_cast` and the
  `acts_spring_payload` constraint are each copied whole from their latest migration at build time, after Whoopee
  Cushion's build. Diff each against that version and confirm only the named changes; in particular that Whoopee
  Cushion's `every` handling survives in each.
- **Springs and ledger rows an instance already holds.** The constraint only gains a pair; the `returned` log line
  keeps today's old-voice reading for a card Act without `handedBack`. Confirm no existing `returned` row changes
  how it reads, and `card_held` is unchanged.
- **The masks.** The refund reads the cast's flavor and rarity, the back or sign, the kicks used (public casts) and
  the staff flag (public). Confirm nothing reads who owns the caster or the post, and that a cast by the author's own
  other mask is refunded identically in SQL, the fake and every word.
- **A second cast at once.** Two Salty casts on one Kick Me post race for the last kick. Confirm both go through the
  post's row lock in `place_cast` before the count, so exactly three are handed back.
- **A busy instance.** The sign lookup and the kick count read card Acts on one post by `target_act_id`; confirm no
  read over all posts or all Acts, and that `withHandedOut` is linear in a post's plays.
- **The order.** Ward, then back, then sign: a caught cast is never handed back, a refunded-by-back cast never uses a
  kick, and a cast is handed back at most once.
- **The sign's frame.** It leaves the content area across its top border on purpose (design 2.4); confirm the padding
  keeps every word clear of it in a thread and in an ORIGIN box, at phone width.
