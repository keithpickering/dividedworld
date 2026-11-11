# Card notes, Part 6: Mooch, Toll, 4D Chess and Off Day: plan

Record, written 2026-11-11. The plan for Part 6 of `docs/plans/2026-11-11-card-notes-design.md` (its section 2:
"Mooch", "Toll and 4D Chess" and "Off Day"; its section 5 holds the owner's answers, and every rework stands), built by
one build session in one PR, from `main`. It leans on `docs/plans/2026-11-11-card-types-design.md` (Moves, Reversals,
Gimmicks; what a Gimmick effect and a spring are), `docs/plans/2026-11-07-face-down-moves-design.md` section 4 (no
money moves between players through a card) and `docs/plans/2026-11-03-settle-claim-design.md` (a window is settled
once, by one run).

Every task is test first: the test named, its red run recorded, then the code. No `tools/check-*.mjs` is added; each
new validation in `instanceProblems` and `card_kinds_problem` is driven red by a poisoned card in its own tests. No
deployed database, bucket or connector is touched; SQL is tested against Postgres on localhost.

**Migrations.** The highest migration on this date is `supabase/migrations/0149_card_writes.sql` and the highest SQL
test is `supabase/tests/0155-back-live-readers.sql`. This plan writes two migrations at **the next free numbers**
(0150 and 0151 as this is written), `NNNN_ledger_names_a_card.sql` (Task 1) and `NNNN_card_payouts.sql` (Tasks 4 and
5, in sections by task as 0148 is), and SQL tests from the next free number in `supabase/tests/` (0156 on). Sibling
plans of the same design are built at the same time and may take numbers first: take the next free ones when the
branch is cut, and again after any merge of `main`. Each function replaced is copied from its latest definition
(search case-insensitively, as the card types plan says), changing only what this plan names, its lock order kept. As
this is written they are:

| Function or object | Latest definition |
|---|---|
| `apply_settlement`, `my_ledger` | 0073:381, 0073:373 |
| the index `ledger_entry` | 0034:17 |
| `card_kinds_problem`, `card_target`, `place_cast`, `place_set`, `spring_facts`, `spring_traps` | 0148:39, :1109, :153, :805, :961, :1038 |
| `settlement_input`, `estimate_input`, `staff_set_card` | 0148:1180, :1267, :1623 |
| `lay_sprung`, the type `spring_facts` | 0142:470, 0142:400 (two attributes added by `alter type` at 0144:612) |
| the constraint `acts_spring_payload` | 0144:680 |
| `seed_instance`, `log_page`, `play_card` | 0149:1021, 0149:1339, 0149 (the `drop function play_card` at :788 and the `create` after it) |
| `set_card` | 0144:573 |

**The layers.** The engine names no card, class, reaction or instance. It gains four neutral pieces, each chosen by a
card's rules (`CardRules`, `engine/rules/cards.ts`) and held again in the catalog (`card_kinds`):

- a **skim**: a cast card whose play pays its caster a share of a vote for votes its target post draws in a quadrant
  the play names (Mooch);
- a **ride**, as a Gimmick effect kind beside ward, earn and price (Toll), and as a set card's spring outcome beside
  the catch (4D Chess): the post's author is paid a share of a vote for votes on a card cast on the post;
- **scored as**: a cast card on a character whose play names a class the character is scored as for one settlement
  window (Off Day);
- the ledger entry that names a card (Task 1), which Earn's `card.boost` already needs.

Divided World's four cards, their numbers, their words, their forms and their art are instance content under
`instances/divided-world/`. `tools/check-engine-boundary.mjs` holds throughout.

**The world** (`docs/plans/2026-10-29-two-worlds-design.md`). No screen or flow is added. Each card shows on the board
as a mark on a post, as every play does (the game's own piece, so it may take the card's color). Everything a player
reads about them is the glass's and plain: the play form's settings, the Lens, the log, the alert, the Vending
Machine's words. None of it is in character and none of it bluffs.

## The cards

| | Mooch | Toll | 4D Chess | Off Day |
|---|---|---|---|---|
| Key | `mooch` | `toll` | `4d-chess` | `off-day` |
| Type (engine play) | Move (`cast`) | Gimmick (`use`), effect `ride` | Reversal (`set`), springs on a cast, outcome `ride` | Move (`cast`) |
| Flavor, rarity | Salty, uncommon | Pepperoni, uncommon | Salty, uncommon | Salty, legendary |
| Reach | a post | the player's own post | the player's own post | a character |
| Names | a quadrant | nothing | a Move up to uncommon, and a quadrant | a class |
| Stack | one live per post per quadrant | 1 | one back per post, as any | one per character per settlement window |
| Lasts | a week | a week | set: `setLasts`; once sprung its pay has no end | the one window after the next settlement |
| Pays | caster, 0.1 of a vote | post's author, 0.5 of a vote | setter, 1 vote | nobody |
| Play price | 0 | 0 | 0 | 0 |
| Machine | on sale, 150 | on sale, 150 | on sale, 150 | hidden, 500; pulled from the Booster |

With `Settings.vote` at 10 hundredths, a Mooch vote pays 0.01, a Toll vote 0.05 and a 4D Chess vote 0.10.

**What every payout here holds to** (Task 3 builds it; Tasks 5 and 10 prove it end to end):

- **Minted, never moved.** Each payout is a ledger entry written by the settlement, as a class's earning is. No entry
  is written for the other side: the poster under a Mooch, and the caster on a tolled or 4D Chess post, keep
  everything their class pays them. No money moves between players.
- **The wallet's cap and floor.** The entries reach the wallet through `apply_settlement`'s one `wallet_move` per
  account, so the cap and the floor apply as for any entry, and the standing keeps all of it.
- **Own-player plays pay nothing.** A Mooch on a post of the caster's own player pays nothing. A ride pays nothing on
  a cast by the author's own player. Reactions by the paid player's own masks pay nothing either (a player's reactions
  never pay that player). No play is refused for whose mask it is on: the play lands and shows the same, and only the
  settlement knows.
- **Whatever anyone's class.** No amount reads a class.
- **Only inside settlement.** Nothing but a settled window's sums, in the paid player's own ledger, and that player's
  own live estimate (which counts every other reaction as anyone's), is computed from who reacted or who owns what.

## Task 1. The ledger takes an entry that names a card (SQL, the settle function)

Model: sonnet

This is a defect on `main`, found in planning, that Part 6 stands on. `settle()` writes one `card.boost` entry per
character and card, with `params: { card: '<key>' }` (settle.ts:76-77, :512). `apply_settlement` (0073:381) refuses
any entry whose `params` holds a value that is not a number ("an entry's params are numbers by key"), refuses two
entries with one character and reason, the index `ledger_entry` (0034:17) is unique on (settlement, character,
reason), and the shares are matched to their entry by character and reason alone (core.ts:106 sends no card). So the
first window in which an Earn Gimmick boosts anything cannot be applied, and every settlement after it waits. If
`main` already carries this fix when the branch is cut, this task is its tests alone.

**Files:** `supabase/migrations/NNNN_ledger_names_a_card.sql` (new), `supabase/tests/NNNN-ledger-names-a-card.sql`
(new), `supabase/functions/settle/core.ts`, `supabase/functions/settle/core.test.ts`,
`supabase/tests/e2e/0001-settlement.ts`.

- `apply_settlement`: an entry's `params` are numbers by key, except the key `card`, which is a string of 1 to 64
  characters. Two entries may share a character and reason when their `params ->> 'card'` differ; two that agree on
  all three are refused in the old words with "and card" added. A share carries `card` where its entry has one, is
  matched to its entry by character, reason and card, and the "an entry's shares add up to it" check groups by the
  same three.
- `ledger_entry` is dropped and made again, unique on
  `(settlement, character, reason, (coalesce(params ->> 'card', '')))`.
- `core.ts`: each share is sent with `card` when `shareEntries` gave it `params.card`.

Tests first.
- SQL: an entry with `params {"card": "x"}` is applied and read back through `my_ledger`; two boost entries for one
  character naming two cards are two rows, each with its own shares; a share with no matching card is refused; a
  `params` holding a string under any other key is refused; a number under `card` is refused; a retried window still
  answers "already settled".
- `core.test.ts`: the shares sent for a boost entry carry its card.
- `0001-settlement.ts`: a window in which an Earn Gimmick boosts a post is applied, and the next window settles.

## Task 2. The rules: skim, ride and scored-as (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`.

**Types** (`cards.ts`):

- `GimmickEffect` (cards.ts:78) gains `{ readonly kind: 'ride'; readonly share: number }`; `GIMMICK_KINDS` gains
  `'ride'`. Its comment says: the author of the post it is on is paid `share` of a vote for each vote on a card another
  player casts on that post while it is up.
- `CardRules.trap` (cards.ts:196) gains `readonly outcome?: { readonly kind: 'ride'; readonly share: number }`. With
  none, a cast trap catches, as today. With it, the cast that springs the trap lands as usual and the setter is paid
  `share` of a vote for each vote that cast draws in the quadrant the set named.
- `CardRules.skim?: { readonly share: number }`: a cast card that reaches a post alone and has a `lasts`.
- `CardRules.scoresAs?: true`: a cast card that reaches a character alone.
- `CardEffect` (cards.ts:63) gains `readonly quadrant?: Quadrant`, carried for a live skim play.
- **The convention for what a play names.** A skim card's and a ride trap's checked configuration holds `quadrant`,
  one of `QUADRANTS`; a scored-as card's holds `class`, a string. The engine reads them there (TypeScript and SQL
  alike), so no function signature grows. A ride trap names its card through `catches(config)`, as a catching trap
  does; the name `catches` stays, and its comment says it is the card the trap waits for.

**Decisions** (`cards.ts`):

- `decided` (cards.ts:285): after the card's `validateConfig` accepts, a skim card whose value has no `quadrant` in
  `QUADRANTS`, and a scored-as card whose value has no non-empty string `class`, throw (a card's fault, as a bad price
  is), never a refusal.
- `decideSet` (cards.ts:362): the same throw for a ride trap's `quadrant`. A ride trap must name a card (`catches`);
  the existing checks on the name stand (cast on a post, at or below the set card's rarity).
- `landsOn` is unchanged. A new export, `quadrantFree(rules, target, effects, quadrant, now)`, refuses with
  `this post already carries that card for that quadrant` when a live effect of the same card on the post (not above
  it) names the same quadrant; a skim card's `canApply` calls `landsOn` and then this, when it is given a
  configuration.
- `decidePlay` gains nothing for scored-as beyond the throw: whether the character already has a class named for the
  window, and whether the window can be named at all, read the settlements, and are SQL's (Task 4).

**`instanceProblems`** (`playProblems`, instance.ts:434; `gimmickProblems`, :486), each in the engine's words naming
the card:

- a `ride` gimmick: `share` is above 0 and at most 1; a ride gimmick's card reaches a post alone;
- a trap `outcome`: only on a set card that springs on a cast, with `catches` and no `match`; its kind is `ride`; its
  `share` is above 0 and at most 1;
- `skim`: only on a cast card whose reaches are a post alone; `share` above 0 and at most 1; it has a `lasts`; it does
  not write. The rule at instance.ts:453 ("has a time up (lasts), and only a use card or a card reaching beyond a post
  does") lets a skim card through;
- `scoresAs`: true or left out; only on a cast card whose reaches are `['character']`.

Tests first, in `cards.test.ts` and `instance.test.ts`: each rule above red on a poisoned card (a ride with share 0, a
ride gimmick on a character, an outcome beside a match, an outcome on a visit trap, a skim on a use card, a skim with
no `lasts`, a skim reaching a thread, `scoresAs` on a post card), then green; `decided` throws for a skim card whose
validator drops the quadrant; `quadrantFree` refuses the same quadrant, lets another through, and ignores an ended
play and a play above the post; a cast card with `skim` and `lasts` passes `instanceProblems`.

## Task 3. Settlement: skim, ride and a class for a window (engine)

Model: sonnet

**Files:** `engine/rules/types.ts`, `engine/rules/settle.ts`, `engine/rules/settle.test.ts`,
`engine/rules/settle.scale.test.ts`.

**Input** (`types.ts`):

- `InputAct` (types.ts:351) gains `quadrant?: Quadrant`: the quadrant a skim play names, or a ride spring was set
  with. `ends` (types.ts:367) is also sent for a skim play.
- `SettlementInput` (types.ts:407) gains
  `scoredAs?: readonly { readonly character: string; readonly class: string; readonly play: string }[]`: the plays
  that name a class for this window, at most one per character.

**`settle()`** (`settle.ts`). The header comment gains a bullet for each of the three.

- **The vocabulary** (settle.ts:154-158): beside `earnOf`, maps from a card's key to its `skim`, its ride gimmick and
  its ride trap outcome.
- **A class for a window.** `stretchesOf` (settle.ts:284): a character in `scoredAs` keeps each stretch's bounds and
  takes the named class in every one, so a character that Turned inside the window is one class throughout. A class
  the instance does not have throws, as an unknown held class does (settle.ts:169). Nothing else changes: the class's
  rules are given the same Acts, and the character's reactions given and held are scored under the named class too.
- **Payouts**, after the loop over characters (settle.ts:476-515), as contributions with no class. `Contribution`'s
  `class` (settle.ts:459) becomes optional, and `byClass` (settle.ts:557) sums only contributions that have one: a
  card's payout is in no class's season total. Each contribution carries `params: { card }`, `act` (the Act the vote
  is on), `quadrant` and `at` (the vote's), so `entryKey` gives one entry per character and card, and the details and
  the estimate's lines name the Act, the quadrant and the time. Amounts are `tidy(share * settings.vote * v.share)`,
  on the unhalved share of a vote (`v.share`), as a card's lift counts (settle.ts:410).
  - **Skim**, reason `card.skim`. For each card Act in the input whose card skims, with a `target`, a `quadrant` and
    an `ends`: the target post is in `acts` (a staff post is not, and pays nothing) and its author's player is not the
    caster's. Each of `windowVotesOn.get(target)` pays the caster's character when its quadrant is the play's, its
    time is after the play and before `ends`, its `owner` is not the caster's player, and its voter's first reaction
    to the post (`onAct.get(target).first`) came after the play. So a vote that moves out of the quadrant inside the
    week takes back what it paid, and the play never costs more than it paid.
  - **Ride**, reason `card.ride`. Two indexes are built once: the live ride gimmick plays by the post they are on
    (card, user character, `at`, `ends`, share), and the ride springs by the Act that sprang them (`by`; card, setter
    character, `quadrant`, share). For each Act with window votes that is a card Act on a post (`reach` undefined,
    `target` in `acts`) by a character whose player is not the post's author's:
    - each ride gimmick on that post that was up when the cast was made (`g.at <= cast.at < g.ends`) pays its user's
      character for each of the cast's votes before `g.ends`, in any quadrant, whose `owner` is not that character's
      player;
    - each ride spring whose `by` is the cast pays its setter's character for each of the cast's votes in the
      spring's quadrant whose `owner` is not that character's player, with no end.
  - A spring is still scored as a play of its card on the cast (settle.ts:166), so 4D Chess's Salty flavor reads for
    the classes as any spring's does. That is unchanged.
- **The estimate** (`estimateForOwner`, settle.ts:672) needs no change: with the shared vote off, each reaction is a
  voter of its own whose first reaction is itself, and the only owner it can recognize is the caller.

Tests first, in `settle.test.ts`, with test cards of the test world (no instance card):

- **Skim.** Pays 0.1 of a vote per vote in the named quadrant on another player's post; nothing for another
  quadrant; nothing before the play or at or after `ends`; nothing from a player who had reacted to the post before
  the play, and nothing taken when that player's vote moves out; a vote that arrives and then moves out in a later
  window takes back exactly what it paid; nothing on the caster's own player's post, whichever mask; nothing for the
  caster's own player's vote; the poster's entries are identical with and without the play; an earlier window's play
  still up pays; a play with no `quadrant` or no `ends` pays nothing; two skim plays by two players on one post each
  pay their own caster.
- **Ride, gimmick.** Half a vote per vote, any quadrant, on another player's cast made while it was up; nothing for a
  cast by the author's own player; nothing for the author's own player's vote on the cast; nothing for a cast made
  before the gimmick or after it ended; nothing for a vote at or after its end; the caster's entries are identical
  with and without the gimmick.
- **Ride, spring.** A whole vote per vote in the named quadrant on the cast that sprang it, in this window and in a
  later one; nothing in another quadrant; nothing when the cast is the setter's own player's; the spring still
  scores for a class as a play on the cast (a Salty spring that outdraws the cast steals thunder, as the existing
  test at settle.test.ts:1155 has it).
- **Both at once.** A post with a ride gimmick and a ride spring pays one entry per card (`params.card`), and
  `shareEntries` splits each over its own Acts.
- **Scored as.** A character named in `scoredAs` earns the named class's reasons for the whole window and none of its
  own; one that Turned inside the window is still one class; a class the instance lacks throws; a character not
  named is untouched; `byClass` puts the amounts under the named class.
- **Totals.** `byClass` holds no payout; the entries' details add up to each entry; the result is the same in any
  input order.
- `settle.scale.test.ts`: a window with a thousand skim plays and a thousand ride springs, and a post with five
  thousand votes under one skim play, each settle in time that grows with the rows read (the existing scale test's
  bound).

## Task 4. The schema and the plays (SQL)

Model: sonnet

**Files:** `supabase/migrations/NNNN_card_payouts.sql` (new; this task's sections), `supabase/tests/NNNN-skim.sql`,
`NNNN-ride.sql`, `NNNN-scored-as.sql` (new).

1. **The catalog.** `card_kinds` gains `skim jsonb` and `scores_as boolean not null default false`.
   `card_kinds_gimmick_kind` (0148:30) takes `'ride'`. Check constraints hold the pairings Task 2 names (a skim only
   on a cast card with a `lasts`; `scores_as` only on a cast card). `card_kinds_problem` holds the same rules again in
   the engine's words, and lets a skim card have a `lasts`. `seed_instance` writes `skim`, `scores_as` and a trap with
   its `outcome`.
2. **`card_target`** sends `quadrant` (`payload #>> '{config,quadrant}'`) for a live play of a skim card.
3. **`place_cast`**, on a post:
   - a skim card: `config ->> 'quadrant'` must be one of the four, else `22023` with
     `this card names a reaction quadrant`. The stack count (0148:213) is of live plays of the card on the post naming
     the same quadrant, against 1, and its refusal is `this post already carries that card for that quadrant`. The
     play is written with `'ends', now() + kind_of.lasts`, as a Use's is (0148:289).
   - a cast that meets a ride back: `spring_traps` answers a spring whose `did` is `rode`. The cast then lands as
     usual: it takes its layer, carries `'rode', <the set's id>` and no `caught`, and the existing `trapStruck` alert
     to the caster is written (its actor the setter's account, as for a catch, so a cast on one's own other mask's
     back tells nobody).
4. **`place_cast`**, on a character, for a scored-as card:
   - `config ->> 'class'` must be a `class_kinds` key, else `22023`, `there is no such class`.
   - The window. `opens := next_settlement_at(now())`. Where it is null, the cast is refused (`55000`):
     `the next settlement's time is not known yet, so no window can be named; play it after that settlement`. Where
     the open season ends at `opens`, it is refused: `this season ends at the next settlement, so there is no window
     after it to name`. Otherwise `closes := least(opens + span_interval(setting('settlementLength')), the season's
     end)`. Both read only settlements, seasons and settings, which are public and the same for every caster.
   - One per character per window: refused (`23505`) with
     `this character already has a class named for the window after the next settlement` when a play of any
     scored-as card on the character, not ended by an admin, was made at or after the last settled window's end.
   - The play's `ends`, and its `play_reach.ends_at`, are `closes` (in place of now plus `lasts`), and its payload
     carries `'starts', opens`.
5. **`place_set`**: a set card whose trap has an `outcome` must be given `catches` and a `config ->> 'quadrant'` that
   is one of the four (`this card names a reaction quadrant`); the name's existing checks stand.
6. **`spring_facts` and `spring_traps`.**
   - `spring_traps` (0148:1078): for a cast trigger, `did` is `rode` where `f.kind_trap -> 'outcome' ->> 'kind' =
     'ride'`, else `caught`. A `rode` spring's payload carries `'quadrant', fd.config ->> 'quadrant'` and no `caught`,
     and no `caught` row is written to `card_ledger` (the setter takes no card).
   - `acts_spring_payload` (0144:680) takes the pair `('cast', 'rode')` and an optional string `quadrant` that is one
     of the four.
   - A face-down skim card (a Move springing on a quote): `spring_facts` counts, for every back alike, the live plays
     on the quoting post naming the back's `config ->> 'quadrant'`, and a skim card lands only when that is 0;
     `lay_sprung` (0142:470) writes its `ends`.
   - A face-down scored-as card: `spring_facts` reads, for every back alike, whether the window can be named and
     whether the quoting character already has a class named for it; the card lands only when it can and has none
     (otherwise the back stays set, as a Move that cannot land does), and `lay_sprung` writes `starts` and `ends` as
     `place_cast` does. The reads are made whatever the back holds, as every read in `spring_facts` is.
7. **An index**, `acts_spring_by on acts ((payload ->> 'by')) where kind = 'spring'`, for Task 5's reads.

Every reader of a post play's `payload ->> 'ends'` now meets a skim play's: the stack counts in `place_cast` and
`spring_facts`, `ward_refusal`, `card_target`, `live_writing_plays` (0149:548), `thread_page` and `log_page`. Read each
and say in the migration's header that it treats a skim play's end as a Use's.

Tests first (each refusal's words asserted; every case run as two players where an owner could matter, with the same
answer):

- **Skim:** a Mooch-shaped card lands with `ends` a week out; a second on the same quadrant is refused and one on
  another quadrant lands; after the first ends by time a new one on its quadrant lands; a play with no quadrant is
  refused; a play on a post of the caster's own other mask lands exactly as on a stranger's.
- **Ride:** a ride back springs on the named card and the cast lands with its layer and `rode`; the spring's payload
  is `did: rode` with its quadrant; no `caught` ledger row; a cast of another card passes over it; a cast a ward
  turns away never reaches the back; a cast by the setter's own other mask springs it the same; a catching back still
  catches (0152's cases pass unchanged); a spring payload with `('cast', 'rode')` and no quadrant is refused by the
  constraint.
- **Scored as:** the play's `starts` and `ends` are the next two window ends; a second in the same open window is
  refused, and one after the next settlement lands; an unknown class is refused; refused in a season's first window
  and where the season ends at the next settlement, in those words; an admin-ended play frees the window; the target's
  `class_history`, `pending_turns` and Turn cooldown are untouched, and no Act but the play is written.
- **Seed:** `card_kinds_problem` red on each poisoned row of Task 2's list, then green.

## Task 5. What the settlement reads and records (SQL)

Model: sonnet

**Files:** `supabase/migrations/NNNN_card_payouts.sql` (this task's sections),
`supabase/tests/NNNN-settlement-payouts.sql` (new), `supabase/tests/e2e/0001-settlement.ts`,
`supabase/tests/e2e/0005-estimate.ts`.

1. **`scored_as_plays(window_start, window_end)`**, the one place that says which plays name a class for a window:
   the plays of scored-as cards made inside the last settled window that ended at or before `window_start`, not ended
   by an admin before `window_end`, the earliest per character. Found through `acts_card_created` over that one
   window. Callable by no API role.
2. **`settlement_input`** sends:
   - `scoredAs`, from `scored_as_plays`, each with its character, class and play; a named character is in
     `characters` when it is there for any other reason, and not otherwise;
   - `quadrant` on a skim play (from its configuration) and on a spring that has one; `ends` on a skim play;
   - the skim plays made before the window and still up in it (as `earn_up` carries Earn plays, 0148:1188; found by
     creation time over the longest skim `lasts`), each with its target post;
   - for each Act reacted to in the window that is a card on a post: the springs whose `by` it is, the ride gimmick
     plays on its target post, and that post.
3. **`estimate_input`** sends the same for the caller alone: `scoredAs` for the caller's characters in the open
   window; the caller's live skim plays and their target posts (whose reactions are read); the casts on the caller's
   posts that a live ride gimmick covers, and the casts that sprang the caller's ride springs, where a reaction
   reached them in the window (each read through the reactions' index that leads with the Act), with the springs and
   gimmick plays. Every other reaction stays keyed per mask, as today. It also returns `scoredAs` beside `windowStart`
   so the caller's estimate can say it.
4. **`scored_as`**, a table of what a settlement did: `(settlement, character, class_key, play)`, primary key
   `(settlement, character)`, append-only by the ledger's triggers' pattern, row security on and no policy.
   `apply_settlement` writes it in its own transaction from `scored_as_plays(window_start, window_end)`, whether or
   not the character earned anything. `my_scored_as` is the caller's own characters' rows with the settlement's
   `starts_at` and `ends_at` and the play's card key; `log_page` sends them as `scoredAs`.

Tests first:

- `settlement_input` carries a week-old skim play still up and not one that ended, was admin-ended, or was caught; a
  ride spring from an earlier window when its cast is reacted to in this one, and not otherwise; the ride gimmick on
  the reacted cast's post; `scoredAs` for a play made in the window before and for no other; nothing for a play an
  admin ended before the window's end.
- `settlement_input` and `apply_settlement` agree: the characters in `scoredAs` are the rows written to `scored_as`,
  for a window with two plays, one admin-ended.
- `estimate_input` for the caster, the author and a bystander: the bystander's input holds none of the plays' extra
  Acts, and no key in anyone's input ties a reaction to an owner but the caller's own.
- e2e (`0001-settlement.ts`): three players, one window: a skim, a ride gimmick, a ride spring and a scored-as play
  settle through `runSettlement`; each paid account's wallet moves by its entries; the poster's and the casters'
  entries equal a control run without the plays; a wallet at the cap takes none of it and the standing takes all; the
  window after pays a late vote on the sprung cast.
- e2e (`0005-estimate.ts`): the caster's estimate shows a skim line for another's reaction and none for their own;
  the target's estimate in the named window is under the named class.

## Task 6. The act function, the API and the fake backend (functions, engine)

Model: sonnet

**Files:** `supabase/functions/act/core.ts`, `core.test.ts`; `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`,
`fake.test.tsx`; `engine/ui/cards/types.ts`; `engine/ui/data/log-page.ts`.

- `act/core.ts` needs no new argument: the configuration carries what a play names. Its tests gain: a skim play's
  configuration reaches `play_card` as the card's validator shaped it; a ride set sends `catches` from the card's
  rules and the quadrant in its configuration; each of Task 4's refusals comes back as a plain refusal with its
  words.
- `CardPlay` (`engine/ui/cards/types.ts`) gains `starts?: string` (when a play's effect starts, where that is later
  than the play) and `rode?: Id` (the set whose spring this cast rode); `api.ts` reads them from the payload, reads a
  spring's `quadrant`, and the log's `scoredAs` rows.
- The fake backend (`fake.ts`, near :1445 and :3785) plays the same rules: a skim play's `ends` and per-quadrant
  stack, the `rode` spring that lets the cast land, and a scored-as play's `starts`, `ends` and one-per-window
  refusal, in the server's words.

Tests first: `fake.test.tsx` cases mirroring Task 4's lists, one per rule.

## Task 7. Divided World's four cards, the machine and the pack (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/mooch.ts`, `toll.ts`, `4d-chess.ts`, `off-day.ts` (new);
`instances/divided-world/cards/index.ts` (`listed`, the header comment, and 4D Chess's `staffOptions` built as Card
Collector's are); `instances/divided-world/cards/cards.test.ts`; `instances/divided-world/machine.ts`;
`instances/divided-world/packs.ts` and their tests.

```ts
export const mooch: CardRules<{ readonly quadrant: Quadrant }> = {
  key: 'mooch', name: 'Mooch', alignment: 'salty', rarity: 'uncommon',
  skim: { share: 0.1 }, lasts: { unit: 'week', count: 1 }, stack: 4,
  playPrice: () => 0,
  canApply: (target, effects, config, now) => {
    const lands = landsOn(mooch, target, effects, now);
    return lands.ok && config ? quadrantFree(mooch, target, effects, config.quadrant, now) : lands;
  },
  validateConfig: (config) => (QUADRANTS.includes((config as { quadrant?: never })?.quadrant)
    ? ok({ quadrant: (config as { quadrant: Quadrant }).quadrant }) : refuse('choose the reactions to mooch')),
};

export const toll: CardRules<Record<string, never>> = {
  key: 'toll', name: 'Toll', alignment: 'pepperoni', rarity: 'uncommon', play: 'use',
  gimmick: { kind: 'ride', share: 0.5 }, lasts: { unit: 'week', count: 1 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(toll, target, effects, now),
  validateConfig: () => ok({}),
};

export const fourDChess: CardRules<{ readonly card: string; readonly quadrant: Quadrant }> = {
  key: '4d-chess', name: '4D Chess', alignment: 'salty', rarity: 'uncommon', play: 'set',
  trap: { trigger: { on: 'cast' }, outcome: { kind: 'ride', share: 1 } },
  catches: (config) => config.card,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: /* card: a key of 1 to 64 characters, else 'the card is the key of the Move to wait for';
                     quadrant: one of the four, else 'choose the reactions it pays on' */,
};

export const offDay: CardRules<{ readonly class: string }> = {
  key: 'off-day', name: 'Off Day', alignment: 'salty', rarity: 'legendary',
  reaches: ['character'], scoresAs: true, lasts: { unit: 'day', count: 2 }, stack: 2,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(offDay, target, effects, now),
  validateConfig: /* class: the key of one of the instance's classes (imported from ../classes/index.ts),
                     else 'choose the class to name' */,
};
```

Each file's header comment says what the card does, names the design, and says what is the settlement's (the pay,
the class) and what is the engine's (the window, the spring). Off Day's `lasts` is the bound a character effect needs
(`reachLasts.character` is a week); its true end is the window's, which the server writes. Its `stack` of 2 lets the
next window's Off Day land while this window's is still up; the one-per-window rule is the server's.

**The machine** (`machine.ts`), following its rarities: Mooch, Toll and 4D Chess each
`{ availability: 'onSale', price: 150 }`, after Good Vibes; Off Day `{ availability: 'hidden', price: 500 }`, last, as
Main Event (the one rare) is hidden at 300. **The pack** (`packs.ts`): the Booster's hit pull becomes
`{ uncommon: 74, rare: 24, legendary: 2 }` (the one set of weights, the card notes design, section 6), since the booster packs design says the first legendary card comes with
legendary in a table. If a sibling plan has already put legendary in the table, its weights stand and this adds none.

Tests first, in `cards.test.ts`: each card passes `instanceProblems`; Mooch lands with a quadrant, is refused on a
quadrant already live and lands on another, refuses a configuration with none; Toll lands on a post through `decideUse`, is
refused by `decidePlay` as any Gimmick is, and a second live one on the post is refused; 4D Chess names only Moves cast on a post up to uncommon (through `decideSet`, the words
"4D Chess names cards up to uncommon") and refuses a missing quadrant; Off Day refuses a class the instance lacks and
lands on a character. The machine's and the pack's tests gain their rows with their red runs.

## Task 8. The art (instance)

Model: haiku

**Files:** for each of `mooch`, `toll`, `4d-chess` and `off-day`, the folder
`instances/divided-world/ui/cards/<key>/` with four files, exactly as
`instances/divided-world/ui/cards/below-the-fold/` holds them (`docs/plans/2026-11-11-rendered-card-art-plan.md`,
Task 3; the commit "Below the Fold wears its render"):

- `art.webp`: the render `docs/research/2026-11-11-card-renders/<key>.png` (already 1080 by 1680) converted to a still,
  lossy WebP at quality 90, at most 400 KB. No scene is rendered again.
- `scene.py`: a copy of `docs/research/2026-11-11-card-renders/<key>.py` with the two changes Below the Fold's copy
  has: its docstring's first line says "card art" where it said "card art exploration", and the import-path line is
  replaced by the two lines that put the parent folder (where `rig.py` is) on the path and set
  `sys.dont_write_bytecode = True`, copied word for word from `below-the-fold/scene.py`. The research folder is not
  changed.
- `mark.svg`: a square silhouette that reads at 18 px, drawn for the card: a piggy bank with a straw (Mooch), a toll
  arm with a coin (Toll), a chessboard seen as a cube's corner (4D Chess), a mask under a raincloud (Off Day).
- `art.json`: `below-the-fold/art.json`, word for word.

Tests first: `node tools/check-card-art.mjs` red with one folder holding only `mark.svg` (record the refusal), then
green over every folder, with each `art.webp`'s size in the PR.

## Task 9. The screens and the words (engine UI, instance UI)

Model: sonnet

**Files:** `instances/divided-world/ui/cards.ts`; `instances/divided-world/cards/quadrant-pick/QuadrantPick.tsx`
(new, with its test), `cards/mooch/ConfigForm.tsx`, `cards/4d-chess/ConfigForm.tsx`, `cards/off-day/ConfigForm.tsx`
(new, each with its test); `instances/divided-world/ui/index.ts` (`REASONS`), `ui/trap-words.ts`, `ui/hint-words.ts`
if its test names every card, `ui/index.test.tsx`, `ui/trap-words.test.tsx`;
`instances/divided-world/guide/strategy-guide.md`; `engine/ui/log/lines.ts`, `lines.test.tsx`;
`engine/ui/alerts/words.ts`, `words.test.tsx`; `engine/ui/types.ts` (`TrapStruckFacts.how`);
`engine/ui/cards/lens-words.ts` and `sprung.ts` where they branch on `did`; a story per card beside
`engine/ui/cards/Gimmicks.stories.tsx`'s kind.

**The forms** (the glass; native radios, labeled, keyboard as Card Collector's):

- `QuadrantPick`: a radio group of the four quadrants, labeled by the instance's `quadrantLabels` read from the
  engine's context (`useKayfa`), giving `{ quadrant }`.
- Mooch: `QuadrantPick` under the legend "The reactions to mooch".
- 4D Chess: Card Collector's faces (the `castable` cards at or below uncommon) under "The Move it waits for", then
  `QuadrantPick` under "The reactions it pays on".
- Off Day: a radio group of the instance's classes by name, in the classes' order, under "The class it scores as".

**Each `CardUi` entry** (`cards.ts`; `L` is the quadrant's label, `C` the class's name with its article, read from
the play's configuration; a share is said by a helper `shareWords`: 1 "a vote", 0.5 "half a vote", 0.1 "a tenth of a
vote"; every number is read from the card's rules, never restated):

- **Mooch.** Salty's pink (`#ff3d7f`, ink `#14030a`).
  - `tagline`: `Ride a post's reactions.`
  - `summary`: `Names one kind of reaction on a post. For a week, each new vote the post draws there pays you a little, and costs its author nothing.`
  - `status`: one play, `Mooching L off this post`; more, `N Mooches on this post`.
  - `hint`: `A Mooch pays its caster when this post draws the reactions it named.`
  - `describe`: `A Salty card, uncommon. You name one of the four kinds of reaction. For a week, each vote the post draws there, from a player who had not reacted to the post before, pays you a tenth of a vote, whatever the author's class. It takes nothing from the author, and it pays nothing on a post of your own. A post holds one Mooch for each kind of reaction. <setMoveWords('the quoting post')> It costs nothing more to play.`
  - `logPlay`: `It names L: for a week, each new vote of L this post draws pays its caster a tenth of a vote. The post's author loses nothing.`
- **Toll.** Pepperoni's color (`#d24a2c`, ink `#1a0602`).
  - `tagline`: `Get paid when a Move lands here.`
  - `summary`: `Used on your post. For a week, every reaction to a Move another player casts there pays you too.`
  - `status`: `Charging a toll on Moves`
  - `hint`: `A Toll pays this post's author when a Move cast here draws reactions.`
  - `describe`: `A Pepperoni card, uncommon, used on one of your own posts. For a week, each vote on a Move another player casts on that post pays you half a vote, on top of everything its caster earns: the caster loses nothing. A Move cast by one of your own characters pays you nothing. It costs nothing more to use.`
  - `logPlay`: `Until it ends, each vote on a Move another player casts on that post pays you half a vote.`
- **4D Chess.** Salty's pink.
  - `tagline`: `Get paid for the Move you saw coming.`
  - `summary`: `Set face down on your post, naming a Move up to uncommon and one kind of reaction. When that Move is cast there it lands as usual, and its reactions of that kind pay you.`
  - `status`: `Set, face down to everyone else` (the words every Reversal shares).
  - `describe`: `A Salty card, uncommon, set face down on one of your own posts. Everyone sees a card back there, the same as any card set face down. You name one Move, uncommon or commoner, and one of the four kinds of reaction. When that Move is cast on your post, this springs and shows itself; the Move lands as usual and its caster keeps everything it earns, and from then on each vote of your kind on that Move pays you a vote. A Move cast by one of your own characters springs it and pays you nothing. It springs once, or comes back to your hand after <setLasts> if nothing springs it. It costs nothing more to set.`
- **Off Day.** Salty's pink.
  - `tagline`: `Give a character somebody else's day.`
  - `summary`: `Cast on a character, naming a class. For the one settlement window after the next settlement, that character scores as that class.`
  - `status`: before the play's `starts`, `Scores as C next window`; from then, `Scoring as C now`.
  - `hint`: `An Off Day makes a character score as another class for one settlement window.`
  - `describe`: `A Salty card, legendary, cast from any post by the character it lands on. You name a class, and everyone can see which. From the next settlement until the one after it, that character is scored as that class, whatever its own. Its own class does not change, no Turn is used and its Turn cooldown is untouched. You are never told whether it made a difference; the character's player is told exactly what happened. A character takes one Off Day for each window. <setMoveWords("the quoting post's character")> It costs nothing more to play.`
  - `logPlay` (given the play's `starts` and `ends` beside `tokens`): `From the settlement of <starts, UTC> to the settlement of <ends, UTC>, that character scores as C. Its own class does not change, no Turn is used, and its Turn cooldown is untouched.`

The Lens's `ends` is the engine's own for every one of them (`defaultView`, `engine/ui/cards/plays.ts:183`: "Ends
Nov 18, 9:14 PM"), from the play's `ends`.

**The log** (`engine/ui/log/lines.ts`; engine words, naming a card or a quadrant only through the instance's names):

- **A settled payout** is a line of the settlement's breakdown under its reason's words (`REASONS`,
  `instances/divided-world/ui/index.ts`), with its Acts and quadrants from the shares:
  - `card.skim`: `<card>: <share> for each vote its post drew in the reactions it named, from players who first reacted after it`
  - `card.ride`, for a ride gimmick's card: `<card>: <share> for each vote on a Move another player cast on the post`
  - `card.ride`, for a ride trap's card: `<card>: <share> for each vote, of the kind it named, on the Move that sprang it`
  - a card the instance no longer has: `A card: what its payout on a reaction earned`.
  A line that takes back a moved vote is the same reason with a negative amount, as a class's is.
- **`scoredAs(lines, instance)`** (lines.ts:132) leaves reasons whose first word is `card` out of its set, so a
  boosted or paid character still reads "Scored as a Face".
- **The Mooch caster and the poster:** the played line and the "A card on your post" line each end with Mooch's
  `logPlay` sentence, as any card's do (lines.ts:545, :725). The poster's settlements hold no line for it.
- **The Toll user:** the played line with `logPlay`; then each settlement's `card.ride` line. **A caster on a tolled
  post** has their played line and nothing else, in that log or any settlement.
- **The 4D Chess setter:** a new branch for `did === 'rode'` beside `caught` (lines.ts:841):
  `<card> on <post> sprang when <caster> cast <Move> on it. <Move> landed as usual, and its caster keeps what it earns. Each vote of <L> it draws pays you <share>, in each settlement's lines.`
  **The caster** gets the `trapStruck` alert (below) and their played line.
- **The Off Day target:**
  1. the row for a play on a character (lines.ts:714-721) gains the card's `logPlay` sentence, as a play on a post
     has, so the target reads the class, both settlements' times and that nothing else changed, the moment it is cast;
  2. in each settlement named by a `scoredAs` row, the character's sentence gains:
     `<card> named <C> for <name> in this window, so it was scored as one whatever its own class. That ended with this settlement, and its own class never changed.`;
  3. where the character has no line in that settlement, a row of its own at the settlement's end, What
     `<card> on <name> ended`, details
     `<name> was to be scored as <C> for <day>, and nothing was scored for it in that window. Its own class never changed.`;
  4. the live estimate's row for that character in the named window says `Scored as <C> this window by <card>.`
  **The Off Day caster** has their played line with `logPlay`, and nothing after it.

**The alert** (`engine/ui/alerts/words.ts`):

- `trapSprang` (words.ts:233), for `did === 'rode'`:
  `A cast of the card it named set it off. The cast landed, and its reactions of the kind you named pay you at each settlement.`
- `trapStruck`: a cast whose payload has `rode` is told with `how: 'rode'` (`TrapStruckFacts`, engine/ui/types.ts:166),
  and the engine's default line is `<setter>'s face-down <card> was waiting for your <Move>`, detail
  `Your <Move> landed as usual, and you keep everything it earns.` Divided World's voice (`trap-words.ts`):
  line `<setter> wanted you to do that.`, detail
  `Their face-down 4D Chess named your <Move>. It landed as usual and you keep everything it earns; <setter> is paid for the reactions it draws.`
  It says only what the spring shows everyone.

**The Strategy Guide** (`strategy-guide.md`, approved by the owner in this PR's review): where it says what a Reversal
springs on, one sentence that some Reversals catch the cast and one lets it land and pays its setter for the cast's
reactions; where it says what a settlement pays, one sentence that a few cards pay a share of a vote at the
settlement, whatever anyone's class, and never out of another player's Aura. The generated card list
(`<!-- kayfabb:cards -->`) picks the four up.

Tests first: each form (a choice gives the configuration; arrow keys and Space work; labels are the instance's);
`index.test.tsx` (every card has a face, a status within the Lens's word rules, words true to the rules' numbers:
retune a share in a test and see it said; `REASON_KEYS` holds the two reasons, with each card's words and the
fallback); `lines.test.tsx` (each line above, word for word; the Off Day settlement sentence with and without a line;
`scoredAs` beside a `card.*` line); `words.test.tsx` and `trap-words.test.tsx` (both `rode` alerts; a spring written
before this still reads as it did).

## Task 10. The export round-trips, and a week in a browser (SQL, e2e)

Model: sonnet

**Files:** `supabase/tests/e2e/0003-export.ts`, `tools/export-instance.mjs` and `tools/import-instance.mjs` if they
list tables or columns; `e2e/` (a spec beside `e2e/fold.spec.ts`, and `e2e/board-stories.test.ts` for the new
stories).

Tests first: the export fixture holds a skim play, a ride gimmick, a `rode` spring with its quadrant, a scored-as
play with `starts`, a `scored_as` row and a ledger row with `params.card`, and the imported instance is the same
table by table. In a browser, on the stories: each card's play form is reachable by keyboard and axe finds nothing;
the Lens of each shows its status and its end.

## Last. The full build and the final review

`npm run typecheck`, then `npm run build`, its tail in the PR; then the final reviewer, briefed with Review focus.

## Ways out

- **A Mooch on a post** ends by itself a week after it lands, or by an admin's end. The poster loses nothing while it
  is up, can ward the post, and has nothing to get out of.
- **A Toll** ends by itself at a week, or by an admin's end.
- **A 4D Chess set face down** springs once, is taken back, or returns to the hand at `setLasts`. Once sprung, its pay
  is no state anyone is in; an admin's end of the cast it rode takes that cast and its votes out of every later
  settlement.
- **A character with an Off Day** scores as the named class for one window and returns to its own class at the
  settlement that closes that window, by itself, at a time the play, the Lens and the target's log each state. An
  admin's end before that window closes means it is not applied to it. The target can post differently, or not at
  all, in that window.
- **A refused play** (a quadrant taken, a window already named, a window that cannot be named) writes nothing; the
  card and the money stay with the player, and the refusal says what is in the way.

## The masks

- **The refusals.** Each reads only public plays (the plays on the post or the character), the card's printed facts,
  and when The System settles, which is the same for everyone. None reads who owns the target: a Mooch on one's own
  other mask's post, a cast on one's own back, and an Off Day on one's own mask all land as on a stranger's.
- **The spring.** A ride back springs for any caster of the named card, the setter's own other mask included, with
  the same Acts and the same work; whether it pays is the settlement's. The spring shows the quadrant only once it
  has sprung; until then the configuration is the setter's own row (`face_down`).
- **The alert.** `trapStruck` goes to the caster with the setter's account as its actor, as a catch's does, so a
  player's cast on their own back tells nobody, and it is queued and sent after the answer as every alert is.
- **The payouts.** Entries are written only by the settlement, into the paid player's own ledger. What that player
  can read from a quiet window's sum (a vote that paid nothing came from the author's own player or their own; two
  masks' reactions paid one vote) is what a class's own lines already let an author read, under the rule's one
  exception. No other player's response changes.
- **The estimate.** It leaves out only the caller's own reactions and counts every other as anyone's, each a whole
  vote, so it can say more than the settlement pays ("up to"). A bystander's `estimate_input` holds nothing of these
  plays.
- **Off Day.** The caster's every response is the same whatever the target's class or owner. The named class is
  public on the play. What changed is in the target's own `scored_as` rows and ledger, read only through views
  bounded by the caller's own characters. Standings and ranks move by settled sums, as they always have. No Turn Act,
  announcement, `class_history` row or reveal is written, so nothing public dates a class change that did not happen.

## A busy instance

- **A cast:** one more indexed read of the plays on the post or of `play_reach` by character.
- **`settlement_input`:** the skim plays of the last week through `acts_card_created`; for each Act reacted to in the
  window, one probe of `acts_spring_by` and one of the plays on its post; the scored-as plays of one window. A sprung
  4D Chess costs nothing in a window in which its cast draws no reaction, however many have sprung.
- **`settle()`:** each skim play reads the window's votes on its one post; each voted cast reads the rides on its post
  and the springs it sprang. The work grows with the window's votes, never with their product or with the instance's
  plays.
- **`estimate_input`:** the caller's own skim plays, and one reactions probe for each of the caller's ride springs
  and tolled casts, as `mine_reacted` already probes each of the caller's Acts.
- **`apply_settlement` and the log:** one small insert per window; `my_scored_as` reads by the caller's characters.

## Decided in planning

- Mooch counts the votes of players whose first reaction to the post came after the Mooch: "each reaction the post
  draws" is the room that arrives, and a vote already there could otherwise only cost the caster when it moved.
- A vote that moves out of the named quadrant inside the week takes back what it paid: without it, switching a
  reaction back and forth across windows would pay each time.
- Toll pays on casts made while it is up, for reactions before it ends, in any quadrant: the design's "for a week".
- 4D Chess's pay has no end: the design gives none, a player has one vote per Act, and a quiet cast costs nothing.
- The paid player's own reactions never pay them, beside the design's "a cast by the author's own player": a player
  is never paid for reacting to their own side of a play.
- Payouts count the unhalved share of a vote, as a card's lift does: the halving prices a character's own Acts.
- The shares (0.1, 0.5, 1) are in each card's rules, as Earn's `by` is, not in the economy settings.
- A play names its quadrant or class at `config.quadrant` and `config.class`, read there by the engine: no SQL
  function's signature changes.
- A ride trap names its Move through `catches`, a `rode` spring carries its quadrant, and the cast carries `rode`.
- The engine's reasons are `card.skim` and `card.ride`, worded by the instance per card, as `card.boost` is.
- Card payouts are in no class's season total (`byClass`): they are paid whatever the class.
- Off Day covers its whole window, even where the character Turns inside it.
- Off Day is refused where the next settlement's time is not known (a season's first window) and where the season
  ends at that settlement: the play must state both its settlements truthfully.
- Off Day's `ends` is the close of the named window, written by the server; the rule is one scored-as play per
  character per open window, of any card.
- Mooch and Off Day can be set face down like any Move, and land on the quoting post or its character by the same
  rules.
- A Mooch on a staff post, and reactions to a staff character's cast, pay nothing, as every card on a staff post pays
  nobody.
- What a settlement scored a character as is recorded in `scored_as` by `apply_settlement`, so the log reads what was
  done and derives nothing.
- Off Day is hidden in the machine at 500 and pulled from the Booster at legendary 1 in 100 of the hit pull.
- The ledger keys an entry by its card too (Task 1), which `card.boost` already needed.

## Review focus

- **Windows already settled.** `apply_settlement` and `ledger_entry` change under ledger rows an instance holds: the
  new index must build over them, and a retried or overlapping run of a window must still answer "already settled"
  and write `scored_as` once.
- **A second run, a late run.** `scored_as_plays` is read by `settlement_input` and again by `apply_settlement`:
  can anything written between the two (an admin's end, a play dated inside the window) make them disagree? And a
  run that settles two missed windows in one go applies an Off Day to exactly one.
- **A retuned `settlementLength`** between an Off Day's cast and its window: the play's `starts` and `ends` were
  written at the cast, the settlement applies it to the window after the one it was cast in; what the Lens then says.
- **What a paid sum proves.** A Mooch lets any class buy, on any post, a sum of other players' votes there. Read the
  quiet cases (one new reactor, two masks) against "A response never proves a private fact" and the design's
  acceptance, and say whether anything beyond the stated exception is shown.
- **A mask slipping through the spring.** Timing and writes of a cast on a ride back, a catching back, a Move back
  and no back; the `trapStruck` alert on one's own back; the set and spring for a staff setter.
- **Farming.** Two players trading 4D Chess and the named Move; reactions switched across windows; a Toll with a
  friend's cheap Moves. Each pays only for other players' votes, once per vote: is any loop cheaper than it pays?
- **A busy instance.** `settlement_input`'s new reads under a window of a hundred thousand reactions (explain each);
  a post with five thousand votes under a Mooch; a player with thousands of sprung ride backs opening their log.
- **A skim play's `ends` on a post.** Every reader of a post play's end listed in Task 4, in a browser: the mark, the
  Lens, the moment, the stack after it ends, a face-down Mooch landing on a post that already has that quadrant.
- **The season's edges.** Off Day in a season's first window, its last, and across a gap between seasons; a
  face-down Off Day whose quote arrives in one of those.
- **The Lurker.** The design leaves to the season review whether Mooch crowds the Lurker's early call; the numbers
  here are starting numbers.
