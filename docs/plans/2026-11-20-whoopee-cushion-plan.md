Record, written 2026-11-20.

# Whoopee Cushion, a common Reversal that pays on every vote of the cast it springs on: plan

Carries out `docs/plans/2026-11-20-whoopee-cushion-design.md`. One PR from `main`.

**May start** once this plan merges, with no wait on the Plays plan: this plan carries its own engine part (design,
section 3). It does not build while another build redefines `card_kinds_problem` or the `acts_spring_payload`
constraint, as Plays' refund outcome will. The second of the two starts from `main` after the first merges and copies
the first's version. Its key, `whoopee-cushion`, is alone in its slot of the sorted lists (between `whodunnit` and
`whoops`).

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the rules'
tests, or `node tools/test-sql.mjs <file>` for one SQL test). Run `npm run typecheck`, `npm run build` and `npm run
test:sql` once after the last task, with the tails in the PR. No deployed database, bucket or connector is touched;
SQL tests run against Postgres on localhost.

**The layers.** Tasks 1 to 4 are the engine's: an optional `every` flag on a ride outcome, the checks that allow a
ride beside a `match`, settlement, the staff pool and the engine's words. Nothing there names a card or a class. Tasks
5 to 7 are Divided World's, carried in through `CardRules`, `CardUi`, `AlertCopy.trapStruck` and the instance's
settlement reasons.

**The world.** A card set face down is the board's own card back, the same for every card. Whoopee Cushion draws
nothing of its own on a post, and when it springs, the back shows the card it was, as every Reversal's does. Its face
and its sheet are the glass.

**The migration.** It is named `NNNN_ride_every.sql`, where `NNNN` is one above the highest number in
`supabase/migrations/` on `main` **at the time this build merges**, not now. Rebase and renumber if `main` moves
during review. The SQL test file is named `NNNN-ride-every.sql` with the same number.

## Task 1. The ride's `every` flag, and the rules' checks

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/instance.ts`, `engine/rules/cards.test.ts`,
`engine/rules/instance.test.ts`.

- `CardRules.trap.outcome` becomes `{ readonly kind: 'ride'; readonly share: number; readonly every?: true }`. Rewrite
  the trap's doc comment (above `readonly trap?`): with an `outcome` the spring is a ride, the cast lands as usual, and
  the setter is paid `share` of a vote for each vote that cast draws, in every quadrant where the outcome says `every`,
  and otherwise in the quadrant the set named (its checked configuration's `quadrant`). Drop "Only a trap that names
  its card has one": a ride may sit beside a `match` or a `catches`. Fix the `catches` comment the same way.
- `decideSet`: the throw "has a ride and its checked configuration names no quadrant" applies only where
  `rules.trap.outcome.every !== true`.
- `staffOffers`: a set card whose trap has an `outcome` is not offered. Put it after the visit line, with the comment
  "A staff character has no wallet and its Acts are not settled, so a ride a persona set would pay nobody."
- `instance.ts`, `outcomeProblems`: remove the "outcome beside a match" refusal and the `match` parameter it needed.
  Add: where the outcome has the key `every` and its value is not `true`, push
  `${who} has an outcome whose every is ${JSON.stringify(e.every)}; every is true or left out`. Rewrite its doc comment
  ("a ride, on a set card that springs on a cast, beside a named card or a match").

Tests, red first:
- `instance.test.ts` (the block near line 860): the line asserting "outcome beside a match" becomes an assertion that
  `set({ trigger: cast, match: { upTo: 'common' }, outcome: { kind: 'ride', share: 0.25, every: true } }, {})` gives
  no problem naming the card. Add `every: 'yes'` and `every: false` cases, each matching the new words.
- `cards.test.ts`: `decideSet` of a set card with `match: { upTo: 'common' }` and
  `outcome: { kind: 'ride', share: 0.25, every: true }`, configuration `{}`, is ok with price 0 and no `catches`. The
  same card without `every` throws the quadrant error (the 4D Chess guard still stands).
- `cards.test.ts`, beside `'staffOffers: a cast card that carries a gimmick …'`: a set card with a ride outcome is not
  offered, and the same card without its `outcome` is offered.

## Task 2. SQL: the check and the spring's payload

Model: sonnet

**Files:** a new `supabase/migrations/NNNN_ride_every.sql`, `supabase/tests/0157-skim.sql`, a new
`supabase/tests/NNNN-ride-every.sql`.

The migration, opening with a header comment that names this plan and says each object is copied whole from its
latest version with only the named change:

1. `card_kinds_problem(cards jsonb)`, copied whole from `supabase/migrations/0357_post_veils.sql` (its latest; run
   `grep -l "function card_kinds_problem" supabase/migrations/*.sql | tail -1` again at build time and copy that one
   if it moved). Remove the `case` that returns "has an outcome beside a match; a ride outcome names its card
   (catches)". Add, beside the outcome checks, a `case` returning
   `format('card "%s" has an outcome whose every is %s; every is true or left out', c.key, (c.trap -> 'outcome' -> 'every')::text)`
   where the outcome is an object on a set card that springs on a cast, `c.trap -> 'outcome' ? 'every'`, and
   `c.trap -> 'outcome' -> 'every' is distinct from 'true'::jsonb`. Same words as Task 1's TypeScript, so a
   JSON-stringified value reads the same both sides (`'yes'` is `"yes"` in both). Keep its grants as they were (replace
   in place).
2. The `acts_spring_payload` constraint, dropped and added again from `0317_surfaces.sql`'s, with one line changed: the
   line `and coalesce(payload ->> 'did' = 'rode', false) = (payload ? 'quadrant')` becomes
   `and (not (payload ? 'quadrant') or coalesce(payload ->> 'did' = 'rode', false))`, and its comment becomes "A
   quadrant is only on a rode spring, naming the quadrant its pay is read in; a ride that pays on every quadrant names
   none." It only loosens, so every spring already written still passes.
3. `spring_traps` is **not** redefined: it writes `quadrant` from the set's configuration, which for a card with no
   configuration is null, and `jsonb_strip_nulls` drops it.

Tests, red first:
- `0157-skim.sql`, case `pr5`: the card with `match` and a ride outcome now has no problem. Change `pr5`'s outcome to
  `{"kind": "ride", "share": 1, "every": "yes"}` and its expected words to
  `card "pr5" has an outcome whose every is "yes"; every is true or left out`. Add a case with `"every": true` beside
  a match, which expects no problem (follow how the file asserts a clean card, or assert
  `card_kinds_problem('[…]') is null` directly).
- `NNNN-ride-every.sql`, modelled on `supabase/tests/0158-ride.sql` (its helpers, its two players, its post), with
  this file's own cards (`rw…`): `rwcushion` (pepperoni, common, set, trap
  `{"trigger": {"on": "cast"}, "match": {"upTo": "common"}, "outcome": {"kind": "ride", "share": 0.25, "every": true}}`),
  `rwcommon` (salty, common, cast), `rwunc` (sweet, uncommon, cast). Assert:
  - A sets `rwcushion` on A's post with configuration `{}`; B casts `rwunc` there: no spring, the back is still live.
  - B casts `rwcommon` there: the spring is `did: 'rode'` with no `quadrant` key; the cast carries `rode` (the set) and
    a `layer` and no `caught`; the setter's ledger gains no `caught` row; B is told by `trapStruck`.
  - A second `rwcommon` by B lands with no spring (the back is spent).
  - The constraint refuses a hand-written `caught` spring that carries a `quadrant`, and accepts a `rode` one without.
  - `card_kinds_problem` of `rwcushion`'s row is null.

## Task 3. Settlement pays an `every` ride on each vote

Model: sonnet

**Files:** `engine/rules/settle.ts`, `engine/rules/settle.test.ts`.

In the ride pass (`rideTrapOf`, built near line 256, and read near line 711): carry each ride trap's `every` beside its
share. A spring is indexed when its card is a ride trap and either the trap is `every` or the spring names a quadrant
(a named ride whose spring lacks one pays nothing, as today). An `every` spring's entry has no quadrant, and the pay
loop's test becomes `(s.quadrant === undefined || v.quadrant === s.quadrant) && v.owner !== playerOf(s.setter)`.
Update the file's header comment on rides (near line 76: "a ride spring … pays its setter's character its share for
each vote in the quadrant the set named") to say "or in every quadrant, where its outcome says `every`."

Tests, red first, in the "skim, ride and scored-as" block (near line 1587). Add a test card
`{ ...splat, key: 'cushion', play: 'set', trap: { trigger: { on: 'cast' }, match: { upTo: 'common' }, outcome: { kind: 'ride', share: 0.25, every: true } } }`
to that block's test world.
- A `cushion` spring with no quadrant on Ann's cast on Tom's post: votes by other players in all four quadrants each
  pay Tom's character a quarter of a vote under `card.ride` with `params.card` `cushion`. Votes by Tom's own player
  pay nothing, and Ann keeps what her cast earns.
- The existing `chess` ride still pays only in its quadrant, and a `chess` spring with no quadrant pays nothing.
- The estimate (`estimateForOwner`) shows the same `card.ride` line to Tom's player.

`settle.scale.test.ts` should pass unchanged. Run it.

## Task 4. The engine's words for a ride that names no quadrant, and the fake

Model: sonnet

**Files:** `engine/ui/cards/land.ts`, `engine/ui/cards/land.test.tsx`, `engine/ui/alerts/words.ts`,
`engine/ui/alerts/words.test.tsx`, `engine/ui/log/lines.ts`, `engine/ui/log/lines.test.tsx`,
`engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

Each sentence branches on the data it already has, never on a card's key. Before the spring, branch on
`rules.trap.outcome.every`. After it, branch on whether the spring's payload has a `quadrant`.

- `springWords` (the set form's sentence): a trap with a ride outcome no longer says "and takes it". Exactly:
  `Waits for ${waits}${comma} to be cast on this post, lets it land, and pays you ${shareWords(share)} for each vote it draws${every ? '' : ' of the kind you name'}.`
  `waits` and the comma as today; `shareWords` from `engine/ui/copy-words.ts`. A catching trap's sentence is
  unchanged. This also makes 4D Chess's form true: today it says it takes the Move.
- Alerts, `trapSprang`, `did === 'rode'`: with a quadrant on the spring, today's sentence. Without one: "A card it was
  waiting for was cast there and set it off. The cast landed, and every reaction to it pays you at each settlement."
- Log, the `did === 'rode'` row: with a quadrant, today's sentence. Without one, the same sentence with
  `Each vote it draws pays you ${…}` in place of `Each vote of ${kind} it draws pays you ${…}`.
- Fake, `playCard` (near line 2133): the spring carries `quadrant` only where the back's stored quadrant is a string
  (spread it in, as the real `jsonb_strip_nulls` drops a null).

Tests, red first:
- `land.test.tsx`: `springWords` of a set card with `match: { upTo: 'common' }` and an `every` ride of share 0.25 is
  "Waits for a card up to common to be cast on this post, lets it land, and pays you a quarter of a vote for each vote
  it draws."; of a named ride of share 1, "Waits for the card it names to be cast on this post, lets it land, and pays
  you a vote for each vote it draws of the kind you name."; a catching match is unchanged.
- `words.test.tsx`: the rode alert without a quadrant says the new sentence; with one, today's.
- `lines.test.tsx`, beside the 4D Chess rode test (near line 1303): a rode spring with no quadrant says "Each vote it
  draws pays you a quarter of a vote" (a test card with share 0.25) and never "of the kind".
- `fake.test.tsx`, beside its match test: a match ride back on A's post, B casts a common card: it lands with `rode`,
  the spring has `did: 'rode'` and no `quadrant` key, and A's hand gains nothing.

## Task 5. The card's rules

Model: haiku

**Files:** a new `instances/divided-world/cards/whoopee-cushion.ts`, a new
`instances/divided-world/cards/whoopee-cushion.test.ts`, `instances/divided-world/cards/index.ts` (one import line and
one list line, each between `whodunnit`'s and `whoops`'s), `instances/divided-world/cards/cards.test.ts` (one line in
the list of `'the instance sells its cards at their prices'`, between `whodunnit`'s and `whoops`'s:
`['whoopee-cushion', 'pepperoni', 100],`).

`whoopee-cushion.ts`, whole:

```ts
/**
 * Whoopee Cushion (Pepperoni, common, Set): set face down on one of the player's own posts, it springs on the first common card cast there,
 * whatever its flavor (docs/plans/2026-11-20-whoopee-cushion-design.md). The cast lands as usual and its caster keeps what it earns; each vote
 * it draws, in every quadrant, pays the setter a quarter of a vote (`trap.outcome`, a ride with `every`), for as long as it draws votes.
 * It names no card and no quadrant, so it takes no configuration. A ward on the post is asked before the back, and a Move that lands from a
 * quote is no cast, so neither meets it. A card back shows on the post like any other. A persona is never offered it (`staffOffers`).
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const whoopeeCushion: CardRules<Record<string, never>> = {
  key: 'whoopee-cushion',
  name: 'Whoopee Cushion',
  alignment: 'pepperoni',
  rarity: 'common',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { upTo: 'common' }, outcome: { kind: 'ride', share: 0.25, every: true } },
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
```

In `index.ts`: `import { whoopeeCushion, price as whoopeeCushionPrice } from './whoopee-cushion.ts';` and
`[whoopeeCushion as CardRules, whoopeeCushionPrice],`.

Tests, red first, in `whoopee-cushion.test.ts`, modelled line for line on `rope-break.test.ts`:
- its facts: key, name, alignment `pepperoni`, rarity `common`, `play` `set`, the trap deep-equal to the one above,
  no `catches`, no `lasts`, and the machine sells it for 100;
- `decideSet(whoopeeCushion, settings, post(10), [], {}, cards)` is ok with price 0 and no `catches`, and with
  `undefined` for the configuration too;
- a second card face down on the post is refused in the engine's words;
- a cast of it is refused with `'Whoopee Cushion is set face down on your own post'` (copy the exact refusal from
  `rope-break.test.ts`, with the name changed);
- `instanceProblems(instance)` is empty with the card in the pool;
- `staffOffers(whoopeeCushion)` is `false` (import it from `engine/rules/cards.ts`).

## Task 6. The face, the sheet and the instance's words

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/whoopee-cushion/ui.ts`, `instances/divided-world/ui/cards.ts` (one
import line and one list line, between `whodunnit`'s and `whoops`'s), `instances/divided-world/ui/cards/words.ts`,
`instances/divided-world/ui/index.ts`, `instances/divided-world/ui/index.test.tsx`,
`instances/divided-world/ui/trap-words.ts`, `instances/divided-world/ui/trap-words.test.tsx`.

- `words.ts`: beside `rideShare`, `export const cushionShare = () => …`, the same shape, reading
  `whoopeeCushion.trap.outcome.share` (throwing as `rideShare` does if it is missing).
- `ui.ts` follows `ui/cards/rope-break/ui.ts` and `ui/cards/4d-chess/ui.ts`. Its entry, exactly:
  - `key: 'whoopee-cushion'`
  - `art: { color: '#d24a2c', ink: '#0d0301', canvas, mark, credit: whoopeeCushionArt.credit, tagline: 'Get paid when a common card lands.' }`
    (Pepperoni's face colors, as THIS's and Whodunnit's; the art in the folder is already rendered in them).
  - `summary: 'Set face down on your post. The first common cast there lands, and every reaction to it pays you a quarter of a vote.'`
    with "common" read from `whoopeeCushion.rarity` and "a quarter of a vote" from `cushionShare()`.
  - `status: 'Set, face down to everyone else'`, with the Reversals' comment.
  - `describe: (settings) =>` "A Pepperoni card, common, set face down on one of your own posts. Everyone sees a card
    back there, the same as any card set face down. The first common card cast on that post, of any flavor, springs
    it and shows it: that card lands as usual and its caster keeps everything it earns, and from then on each vote it
    draws, of any kind, pays you a quarter of a vote. A card cast by one of your own characters springs it and pays
    you nothing. A rarer card passes over it, and a card your post's ward turns away never reaches it. It springs
    once, or comes back to your hand after `${setLastsWords(settings)}` if nothing springs it. It costs nothing more
    to set." The flavor, the rarity and the share are read from `whoopeeCushion` and `cushionShare()`, never written
    as literals.
  - No `Effect`, no `ConfigForm`, no `hint`.
- `index.ts`, the `'card.ride'` reason: where the card's `trap.outcome.every` is true,
  `${card.name}: ${shareWords(share)} for each vote on the card whose cast sprang it`; otherwise today's words.
- `trap-words.ts`, the `rode` branch: find the setter's card among the instance's cards by name (import the list from
  `../cards/index.ts`). Where it names its card (`catches` is defined), today's words. Otherwise the detail is
  `Their face-down ${f.card ?? 'card'} sprang on your ${f.laid ?? 'cast'}. It landed as usual and you keep everything it earns; ${f.setter} is paid for every reaction it draws.`
  Where the spring was not read (`f.card` null), use that second sentence with "card", since two cards ride now.
  Rewrite the comment that says 4D Chess is "the only one that rides".

Tests, red first:
- `index.test.tsx`, beside the Reversals' assertions (search for `'Set, face down to everyone else'`): the card's
  status equals Rope Break's; its art color, ink, tagline and summary are the strings above; it has no `Effect` and no
  `ConfigForm`; `describe(instance.settings)` is the text above with "7 days" (today's `setLasts`); the `card.ride`
  reason for `{ card: 'whoopee-cushion' }` is the new words and for `{ card: '4d-chess' }` is unchanged; the file's
  rules over every card (art, key order, `instanceUiProblems` empty) pass with the card in.
- `trap-words.test.tsx`: a `rode` with `card: 'Whoopee Cushion'` gives the new detail; with `card: '4D Chess'`,
  today's; with `card: null`, the new detail with "card".

## Task 7. A ride, end to end on the fake

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/whoopee-cushion/ui.test.tsx`.

One test file against the fake with the real instance, as `ui/cards/rope-break/ui.test.tsx` is. Red first: write it
before Task 5's card is in the list, see it fail on "no such card", then run it green.

- A sets Whoopee Cushion on A's post. B casts Whoops! (Salty, common) on it: the answer's play carries `rode` and a
  layer, the post's live effects hold the Whoops! layer, A's hand holds no Whoops!, and the spring has no quadrant.
- The back is spent: a second Whoops! by B on the same post lands with no `rode`.
- B casts THIS (Pepperoni, common) on a post with a fresh Whoopee Cushion: it springs the same way (any flavor).
- B casts Mooch (Salty, uncommon) on a post with a fresh Whoopee Cushion: it lands, and the back is still there. If
  Mooch is not cast on a post, use any card above common that is, found from `instance.cards`.
- The set form's sentence, `springWords(whoopeeCushion)`, is "Waits for a card up to common to be cast on this post,
  lets it land, and pays you a quarter of a vote for each vote it draws."

## Task 8. The build

Model: inline

`npm run typecheck`, `npm run build` and `npm run test:sql`, with the tails in the PR. `npm run test:sql` is needed
here, since Task 2 changes SQL.

## Review focus

- **Springs an instance already holds.** The constraint is dropped and added again, so Postgres checks every spring
  Act. Confirm the new predicate is strictly looser than the old one (every old `rode` spring has a quadrant; no old
  non-`rode` spring has one).
- **4D Chess unchanged.** Its spring still writes a quadrant, settlement still pays only in it, and its set form's
  sentence is now true ("lets it land … of the kind you name"). Read one 4D Chess path end to end.
- **The copied `card_kinds_problem`.** It is copied whole from its latest migration. Diff it against that version and
  confirm the two named changes are the only ones.
- **The masks.** The spring reads the cast's rarity and the back, never who owns the caster. A cast by the setter's own
  other mask springs it and pays nothing, and nothing in any answer, alert or word differs with that ownership.
- **A persona never sets it.** `staffOffers` refuses it, and the chatter tests pass unchanged; read what
  `supabase/functions/chatter/core.ts` offers at `pool.cardRarityMost: 'common'` with the card in.
- **A busy instance.** Settlement's ride pass reads each sprung cast's votes once, `every` or not; confirm no new loop
  over all springs or all votes.
- **The slot and the numbering.** The card's lines in the sorted lists sit between `whodunnit` and `whoops`. The
  migration's number is one above `main`'s highest at merge.
