Record, written 2026-11-21.

# Buzzkill, a Move that ends a Gimmick early: plan

Carries out `docs/plans/2026-11-21-buzzkill-design.md`. One PR from `main`.

**May start** once this plan merges, **and only after** SoVeryHappy's build (PR #936, `0401_thread_lockout.sql`) has
merged. It redefines `card_kinds_problem`, `place_cast` and `reverse_card`, which this plan redefines too. No other
build may redefine an object in the table below while this one builds. This build copies every SQL object whole from its
latest version on `main` **at the time it starts**, and again if `main` moves before it merges. Its key, `buzzkill`, is
alone in its slot of the sorted lists (between `blind-study` and `card-collector`).

**The shared SQL this build redefines**, each copied whole from its latest migration with only the named change. Find
each one's latest with `grep -l -E "function (public\.)?<name>\(" supabase/migrations/*.sql | tail -1` (a table's with
`grep -l "table card_kinds"`). Where a later build changed one, keep its change.

| Object | Latest on `main` today | Also redefined by | Change |
|---|---|---|---|
| `card_kinds` (table) | `0397_refund_outcome.sql` adds its last column | | `add column cuts jsonb` |
| `seed_instance` | `0397_refund_outcome.sql` | | seeds `cuts` |
| `card_kinds_problem(cards jsonb)` | `0400_pierce.sql` | #936 (`0401`) | the `cuts` checks |
| `card_reach_problem(cards jsonb)` | `0361_discipline_cards.sql` | | a `cuts` card reaches a character with no `lasts` |
| `face_down_never_writes()` | `0361_discipline_cards.sql` | | refuses a `cuts` card's back |
| `card_ended(play uuid)` | `0400_pierce.sql` | | a fourth way: `card_cut_at(play) is not null` |
| `place_cast` | `0400_pierce.sql` | #936 (`0401`) | the cut (design, section 3.3) |
| `reverse_card(play uuid)` | `0349_thread_page_under.sql` | #936 (`0401`) | the refusal for a play already over, split |
| `settlement_input` | `0398_debates_fixes.sql` | | each play's `ends` is cut |
| `estimate_input` | `0398_debates_fixes.sql` | | each play's `ends` is cut |

New: `card_cut_at(play uuid)`, `cut_refusal(kind_of card_kinds, of_reach text, of_target uuid, config jsonb)`, and the
partial index `acts_cut_play`.

**The migration.** It is named `NNNN_cut.sql`, where `NNNN` is one above the highest number in `supabase/migrations/` on
`main` **at the time this build merges**, not now (0401 once #936 merges, so 0402 today). Rebase and renumber if `main`
moves during review. The SQL test is `supabase/tests/NNNN-cut.sql`, with the same number.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the rules'
tests, or `node tools/test-sql.mjs` for the SQL suite). Run `npm run typecheck`, `npm run build` and `npm run test:sql`
once after the last task, with the tails in the PR. No deployed database, bucket or connector is touched; SQL tests run
against Postgres on localhost.

**The layers.** Tasks 1 to 6 are the engine's: the `cuts` property, its checks, the SQL, the fake, the page, the form's
list, the Lens and the log. Nothing there names a card or a class. Tasks 7 and 8 are Divided World's, carried in
through `CardRules`, `CardUi` and `CardUi.ConfigForm`.

**The world.** Buzzkill draws nothing on a post. Its face and sheet are the glass, its form's list is the play form's
(the glass), and the Lens and log lines are the glass's plain words.

## Task 1. The `cuts` property, its checks, and the play decision

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/instance.ts`, `engine/rules/cards.test.ts`,
`engine/rules/instance.test.ts`.

- `CardRules` gains `readonly cuts?: { readonly upTo: Rarity }`, documented: "A cast card's play ends one live Gimmick (a
  Use card's play) on its target, the one its checked configuration names (`play`), whose card is no rarer than `upTo`.
  It is over when it lands: no time up, no layer, no place in a stack. Cast face up, never set face down, never offered
  to a staff persona."
- `instant` (line 131) becomes true also for a card with `cuts`; its `Pick` widens to `'discipline' | 'cuts'`. Check
  every caller of `instant` still compiles and reads right.
- `faceUpOnly` (line 660) gains `rules.cuts !== undefined`; its `Pick` widens. `decideSet` (line 674's sentence covers it).
- `staffOffers` (line 888): `if (card.cuts !== undefined) return false;` with the comment "A card that cuts names a
  Gimmick by its play, which a persona does not choose (the Buzzkill design, section 2.5)."
- `PlayContext` gains `readonly rulesOf?: (key: string) => Pick<CardRules, 'play' | 'rarity'> | undefined`.
- A new exported `cuttable(rules, effects, target, now, rulesOf)`: the effects on `target.reach` that are live
  (`isLive`), whose card's rules `rulesOf` gives with `playOf === 'use'` and a rarity `atOrBelow` `rules.cuts.upTo`.
- `decidePlay`, after the Ward and before `disciplineRefusal`: for a card with `cuts` and a `rulesOf`, where
  `cuttable` is empty, refuse `there's no Gimmick up on this ${target.reach} for ${rules.name} to end`. The named play is
  checked in `decided`'s configuration step (below), so the ghost marks' lenient call refuses only the empty target.
- The configuration of a cut card: `validateConfig` is the card's (Task 7); `decided` then, with a `rulesOf`, refuses
  `that Gimmick isn't up on this ${target.reach}` where `config.play` is not the `act` of a live effect on the target,
  and `${rules.name} ends a Gimmick up to ${upTo}, and ${name} is ${rarity}` where it is one rarer than `upTo`.
- `instance.ts`, `playProblems`, a `cuts` block, each sentence starting `${who}` as the others do:
  `has cuts up to ${JSON.stringify(upTo)}; a rarity is common, uncommon, rare or legendary` (from `RARITIES`);
  `has cuts and is not a cast card`; `has cuts up to ${upTo}, rarer than the card`;
  `has cuts and reaches ${...}; a card that cuts reaches a post or a character`;
  `has cuts and a time up (lasts); a card that cuts is over when it lands`;
  `has cuts and ${what}; a card that cuts has no other effect`, `what` the first present of gimmick, skim, refunds,
  discipline, writes, replies, keeps, scoresAs, draws, drive, surface, veil, needsMessage.
  The reach check that asks every card beyond a post for a `lasts` skips a card that cuts, as it skips a heart.

Tests, red first:
- `instance.test.ts`: a cast card `{ rarity: 'rare', reaches: ['post', 'character'], cuts: { upTo: 'rare' } }` has no
  problem; each sentence above, one case each.
- `cards.test.ts`: `faceUpOnly` and `instant` are true for it and `staffOffers` false; `decidePlay` with a `rulesOf`
  refuses it on a post with no effects, and on a post whose only effect is a live Move's earn (a cast card's
  gimmick); lands with `{ play }` naming a live rare Use-card effect; refuses a named play absent from the effects, one
  past its `ends`, and one whose card is legendary; with no `rulesOf` it refuses nothing of these.

## Task 2. SQL: the column, the checks, the cut fact and settlement's end

Model: sonnet

**Files:** a new `supabase/migrations/NNNN_cut.sql`, a new `supabase/tests/NNNN-cut.sql`.

The migration opens with a header comment naming this plan and the design, listing each object with its change as
`0400_pierce.sql`'s header does, and saying: "Ways out: a play of a card that cuts is over when it lands and leaves no
state. A cut Gimmick is over, as an expired one is; an admin's end of the cutting play (reverse_card) brings it back,
computed. Masks: nothing private is read; the cut is a public fact of the play, decided from the target's public plays
and the cards' printed rarity." In order:

1. `alter table card_kinds add column cuts jsonb;`
2. `seed_instance`, copied whole: the insert's column list and `select` gain `cuts` (`nullif(e -> 'cuts', 'null')`), and
   the `on conflict` update `cuts = excluded.cuts`.
3. `card_kinds_problem`, copied whole: Task 1's sentences as `card "%s" ...`, beside the pierce's, reading `c.e -> 'cuts'`.
4. `card_reach_problem`, copied whole: its "reaches beyond a post with no time up" case also passes a card with
   `e ? 'cuts'` (beside `dkind in ('relief', 'unban')`).
5. `face_down_never_writes`, copied whole: `elsif k.cuts is not null then raise exception '% is cast face up and never
   set face down', k.name ...` in the words `decideSet` gives (Task 1).
6. `create index acts_cut_play on acts ((payload #>> '{cut,play}')) where kind = 'card' and payload ? 'cut';`
7. `card_cut_at(play uuid) returns timestamptz`, `stable security definer`, grants as `card_ended`'s:
   `select min(c.created_at) from acts c where c.kind = 'card' and c.payload ? 'cut' and (c.payload #>> '{cut,play}') =
   card_cut_at.play::text and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = c.id)`.
   Comment: "When a card that cuts ended this play, or null: the earliest landed cut that an admin has not ended. It
   reads `card_end` itself, not card_ended, so the two never call each other."
8. `card_ended`, copied whole, with `or card_cut_at(card_ended.play) is not null`. Keep its grants.
9. `cut_refusal(kind_of card_kinds, of_reach text, of_target uuid, config jsonb) returns text`, `stable security definer`,
   revoked from everyone as `wards_against` is. Null for a card without `cuts`. The live Gimmicks on the target: for
   `post`, card Acts with `target_act_id = of_target`, reach post, not caught, `payload ->> 'ends'` after now, not
   `card_ended`, whose card's `play = 'use'`; for `character`, `play_reach` rows with `character = of_target`,
   `ends_at > now()`, not `card_ended`, whose card's `play = 'use'`. Then, in order: none of them at or below
   `cuts ->> 'upTo'` → `there''s no Gimmick up on this <reach> for <name> to end`; `config ->> 'play'` missing or not a
   uuid → `<name> names the Gimmick it ends`; not one of them → `that Gimmick isn''t up on this <reach>`; rarer than
   `upTo` → `<name> ends a Gimmick up to <upTo>, and <its name> is <its rarity>`. The words match Task 1's.
10. `place_cast`, copied whole:
    - `is_instant` is also true for `kind_of.cuts is not null`.
    - A staff caster with a cut card: `raise exception 'a staff character casts no card that ends a Gimmick' using
      errcode = '42501';` beside the discipline's.
    - Post branch: the stack count's `where` gains `and not (k.payload ? 'instant')`; a cut card is not refused by the
      stack.
    - In both branches, after the Ward check and (post) `land_refusal`, before `spring_traps`: `cut_words :=
      cut_refusal(kind_of, reach, target, config)`, raised with the refusal hint (errcode `55000`) where not null.
    - The lock (character branch): where the card cuts and the named play has a `play_reach` row, before the pierce
      loop, `perform 1 from play_reach r where r.play = <named> or (r.character = caster and r.ends_at > now() and
      <its card's gimmick is a pierce>) order by r.play for update of r;`, then `cut_refusal` is asked after it. Comment:
      "The named play's row, with the caster's own pierces, in one order: a cast that spends that play as a pierce takes
      the same row, so the two go one after the other, and no two cuts hold rows in opposite orders."
    - The payload, where the card cuts: `instant: true` (post reach too) and no `layer`; where it lands, `cut:
      {play, card}` (`card` read from the named Act). A caught play carries no `cut`.
11. `reverse_card`, copied whole: the `card_ended` refusal becomes: an admin's `card_end` on it → its words as now; else
    `card_cut_at(p.id)` not null → `raise exception 'a % already ended that card; end that card to bring this one back',
    <the cutting card's name>`; else → `'that card is already over'`. Same hint and errcode.
12. `settlement_input` and `estimate_input`, copied whole: the `'ends'` each sends for a card Act (the `case when
    a.kind = 'card' and not (a.payload ? 'caught') ...` near lines 526 and 853 of `0398`) becomes the least of its own and
    `card_cut_at(a.id)` (`least` skips a null). Search each function for every other place it sends or compares a play's
    end to the rules (`ends`, `ends_at`) and say in the header which were changed and which are only a pre-filter the
    rules narrow again.

Tests, red first (`NNNN-cut.sql`, on the seeded test fixtures as `0400-pierce.sql` sets up its cards; a test cut card
`{ key: 'ctest', rarity: 'rare', alignment: 'salty', reaches: ['post', 'character'], cuts: { upTo: 'rare' } }`):
- The catalog refuses each bad `cuts` of Task 1 and accepts the good one; `card_reach_problem` accepts it with no
  `lasts`; a back of it is refused by `face_down_never_writes`.
- On B's post with a live Kick Me (a Use with an earn and refunds), A plays the cut card naming it: it lands, its
  payload has `instant` and `cut` naming the Kick Me play and card and no `layer`; `card_ended(<kick me>)` is true;
  `card_cut_at` is the Buzzkill's time; a later Salty Move on the post is not handed back.
- A second cut card on the same post naming another Gimmick lands (no stack refusal); naming the cut one is refused
  with "that Gimmick isn't up on this post".
- Each `cut_refusal` sentence: a post with no Gimmick; a post with only a Move's earn; no `play`; a play on another post;
  a Gimmick whose card is legendary (a test card); a thread's Gimmick named from a post.
- A live Sugar Coat (a rare Ward of Salty) turns it away with the Ward's words before `cut_refusal`; a Force Field
  (uncommon) does not, and the cut card ends it.
- A rare catching back on the post catches it: no `cut`, the Gimmick still live.
- On B's character with a live Cheap Shot, A plays it from B's post: the Cheap Shot is ended; B's next Move carries no
  `pierce`.
- A staff caster is refused.
- An admin reverses the cut card: `card_cut_at` is null and the Kick Me is live again until its own `ends`.
  `reverse_card` on the Kick Me while cut is refused with the cutting card's name; on a spent Cheap Shot with "that card
  is already over"; on an admin-ended play with the words as before.
- Settlement: a Kick Me used at t0, a negative vote at t1, the cut at t2, a negative vote at t3, all in one window:
  `settlement_input`'s Kick Me Act has `ends` at t2, and the settled sum pays the t1 vote's boost and not t3's. With the
  cut reversed before the window settles, both are paid. `estimate_input` agrees.
- `explain` of `card_ended` on a play no cut names shows `acts_cut_play`.
- Every existing test file passes unchanged (`npm run test:sql`).

## Task 3. The fake and the act function

Model: sonnet

**Files:** `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`, `supabase/functions/act/core.ts`,
`supabase/functions/act/core.test.ts`.

- `core.ts`: the `decidePlay` call (near line 234) passes `rulesOf: (key) => instance.cards.find((c) => c.key === key)`.
- `fake.ts`: `playCard` (near line 2337) and `playBeyond` (near line 2671) do what Task 2's `place_cast` does, in the same
  order: pass `rulesOf`; the cut card is instant (no layer, no `ends`, no stack place); after the Ward, `cut_refusal`'s
  refusals in its words; on landing, `instant` and `cut` on the payload. `effectsOn` and `reachEffects` leave out a play
  a landed, un-reversed `cut` names, as `card_ended` does; the fake's admin reversal of the cut card brings it back, and
  its reversal of a cut play refuses in Task 2's words.

Tests, red first: each bullet of Task 2's SQL test the fake can express, in `fake.test.tsx` beside its ward and pierce
tests; and in `core.test.ts`, that a cut card with a `play` not among `card_target_reach`'s effects is refused before
`play_card` is called.

## Task 4. The page: the play, the store, the marks and the Lens

Model: sonnet

**Files:** `engine/ui/cards/types.ts`, `engine/ui/cards/plays.ts`, `engine/ui/cards/land.ts`,
`engine/ui/cards/PlayActions.tsx`, `engine/ui/cards/Lens.tsx`, `engine/ui/cards/lens-words.ts`, `engine/ui/cards/Effects.tsx`,
and the tests beside each.

- `CardPlay` gains `readonly cut?: { readonly by: Id; readonly card: string }` (on the Gimmick a landed play ended) and,
  on the cutting play itself, `readonly cuts?: { readonly play: Id; readonly card: string }` read by `playOf` from a
  well-formed payload `cut` (string `play` and `card`).
- The store (`plays.ts`, the loop that takes in card Acts and `card_end`s, near line 470): a card Act with `cuts` marks
  the named play `cut: { by: <its id>, card: <its card> }`, now or held for when that play arrives (as `spentPlays` is).
  A `card_end` whose target is a cutting play clears `cut` from the play it named (and from the held set). `setEnded`
  does the same.
- Every reader that leaves a `reversed` play out of force also leaves a `cut` one out: grep `reversed` in
  `engine/ui/cards/` and `engine/ui/thread/` and list each in the PR (`stackPlays`, `livePlays`, `effectsOf`,
  `markedPlays`, `endable` in `Lens.tsx`, the statuses in `Effects.tsx` at least). `markedPlays` keeps a cut play on a
  post for its Lens row, as it keeps a reversed one.
- `land.ts`: `landingOn` and `waysOn` pass `rulesOf` (from `context.cards`) to `decidePlay`, so a ghost mark offers a
  cut card only where `cuttable` is not empty. `PlayActions.tsx` needs nothing more unless it builds its own context.
- `lens-words.ts`: `cutWords(card) => \`Ended the ${card} here early\`` and `cutByWords(card) => \`Ended early by a
  ${card}\``, names from the instance's cards. `Lens.tsx`, `PlayRow`: the cutting play's row shows `cutWords`; a cut
  play's row shows `cutByWords` where a reversed one shows "Ended by an admin".

Tests, red first:
- `plays` tests: `playOf` reads a well-formed `cut` and drops a malformed one; the store marks the named play cut when
  the cutting play arrives after it and when it arrives first; a `card_end` on the cutting play clears it; `stackPlays`
  and `livePlays` leave a cut play out.
- `land` tests: `waysOn` offers a cut card on a post with a live rare Use-card play and not on one with none.
- `Lens` tests: both rows' lines, and the cut row back to normal once the cutting play is reversed.

## Task 5. The form's list of Gimmicks

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`ConfigFormProps`), `engine/ui/cards/PlayForm.tsx`, its test.

- `ConfigFormProps` gains `readonly gimmicks?: readonly { readonly play: Id; readonly card: string; readonly caster: Id;
  readonly ends?: string }[]`, documented: "The live Gimmicks on the target up to the card's `cuts.upTo`, oldest first,
  for a card that cuts (`CardRules.cuts`); undefined for any other card."
- `PlayForm.tsx` (where it renders `cardUi.ConfigForm`, near line 342) computes it for a card with `cuts`: for a post,
  from the store's plays on the post (`livePlays`, Use cards by `rulesOf`); for a character, from the character's plays
  the form already reads for the pierce (`effectsAbove([character])`). The engine's `cuttable` decides which.

Tests, red first: the form gives `gimmicks` to a cut card's `ConfigForm` (a test form that prints them) for a post and
for a character, with a cut or expired play left out, and gives none to another card.

## Task 6. The engine's words: the log

Model: sonnet

**Files:** `engine/ui/log/lines.ts`, `engine/ui/log/lines.test.tsx`.

From the public payload alone, with names from the instance's cards and times as the log already writes them (design,
section 3.5):
- The player's own `played` row of a cutting play: details gain `It ended the ${card} there.`
- The `playsOnMine` row of a cutting play: details gain `It ended your ${card} early, at ${time}.`
- The `gimmickEnded` row (near line 959): where the play is cut (a cutting Act in `data.acts` naming it and not in
  `data.log.ended`), the row's `at` is the cutting Act's time and its details say `A ${cuttingCard} ended it early.` in
  place of `ended.`; with the cutting play reversed, the row is as before.
- The `ended` row of a cutting play, for the Gimmick's player: details gain `Your ${card} is back up until ${time}.`, or
  `Your ${card} came back and has since ended.` where its `ends` has passed.

Tests, red first: each line, and each row unchanged for a play with no `cut`.

## Task 7. Buzzkill's rules and form

Model: sonnet

**Files:** a new `instances/divided-world/cards/buzzkill.ts`, a new `instances/divided-world/cards/buzzkill.test.ts`, a
new `instances/divided-world/cards/buzzkill/ConfigForm.tsx`, `instances/divided-world/cards/index.ts`.

`buzzkill.ts`, modeled on `kick-me.ts`:

```ts
/**
 * Buzzkill (Salty, rare, a Move on a post or a character; instant): ends one Gimmick up on its target, up to rare, which the player picks
 * from those showing there (docs/plans/2026-11-21-buzzkill-design.md). The Gimmick is not refunded; what it did before stands. Wards are
 * asked as for any Salty Move, so a Sugar Coat turns it away and a Force Field does not. Cast face up, never set face down.
 */
export const buzzkill: CardRules<{ readonly play: string }> = {
  key: 'buzzkill',
  name: 'Buzzkill',
  alignment: 'salty',
  rarity: 'rare',
  reaches: ['post', 'character'],
  cuts: { upTo: 'rare' },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(buzzkill, target, effects, now),
  validateConfig: (config) => {
    const play = (config as { play?: unknown } | null)?.play;
    return typeof play === 'string' && UUID.test(play) ? ok({ play }) : refuse('Buzzkill names the Gimmick it ends');
  },
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 300;
```

`UUID` is the engine's uuid pattern if one is exported (grep `engine/rules/` for it), else a local one. The refusal's
words are the engine's ("{name} names the Gimmick it ends"). Register it in `index.ts` in key order (after
`blind-study`).

`buzzkill/ConfigForm.tsx`, modeled on `4d-chess/ConfigForm.tsx`: a fieldset, legend `The Gimmick it ends`, one radio per
`gimmicks` entry showing the card's face (as `FacePick` draws one) and its name, with `ends ${time}` where it has one,
in the order given; choosing one gives `{ play }`. With an empty list it says `Nothing here to end.` (the form is not
offered then, by Task 1, but it says so plainly if it is). Keyboard and label rules as the other forms.

`buzzkill.test.ts`: no instance problem; `faceUpOnly`; not `staffOffers`; it lands on a post and on a character
(`landsOn`); `validateConfig` refuses `{}` and a non-uuid; the form test gives `{ play }` for a chosen radio.

## Task 8. The face, the sheet and the instance's words

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/buzzkill/ui.ts`, a new
`instances/divided-world/ui/cards/buzzkill/ui.test.tsx`, `instances/divided-world/ui/cards.ts`.

- `ui.ts`, modeled on `cheap-shot/ui.ts`, with the art already in the folder (`art.webp`, `mark.svg`, `art.json`; set
  `color` and `ink` as Salty's in `ui.ts` where `art.json` holds none, as `steel-chair` does). `ConfigForm` from Task 7.
  Tagline `End a Gimmick early.`; summary `Played on a post or a character. Ends one Gimmick there, up to ${upTo}. You
  choose which.`; `logPlay`: `It ended the {card} there.` where the instance's `logPlay` takes the play (else the
  engine's line of Task 6 stands alone). `upTo` is read from `buzzkill.cuts` and throws if missing. `describe`, in the
  sheet's plain style: a Salty card, rare, played on a post or a character; it ends one Gimmick there, up to rare, which
  you pick; the Gimmick isn't refunded, and what it did before it ended stands; a card that would turn a Salty card
  away still does, and a card set face down there can still catch it; it is played face up, never set face down; an
  admin who ends it brings the Gimmick back for the rest of its time.
- Register it in `ui/cards.ts` in key order.

Tests: the sheet's words, and its row in the tables `instances/divided-world/ui/index.test.tsx` computes from `reaches`.

## Task 9. A Buzzkill, end to end on the fake

Model: sonnet

**Files:** `engine/ui/data/fake.test.tsx` or the instance's end-to-end test beside Cheap Shot's.

- B uses Kick Me on B's post. A's ghost mark offers Buzzkill there and not on a post of B's with no Gimmick.
- A plays it; the form lists the Kick Me; it lands. The sign is gone, the Lens rows say "Ended the Kick Me here early"
  and "Ended early by a Buzzkill", A's log says it ended the Kick Me, B's log says a Buzzkill ended it early and the
  Kick Me's end is the Buzzkill's time.
- B uses Sugar Coat on another post: Buzzkill is turned away. B uses Force Field there instead: Buzzkill ends it.
- An admin ends A's Buzzkill: the Kick Me's sign is back, and B's log says it is back up until its time.

## Task 10. The build

Model: inline

Run `npm run typecheck`, `npm run build` and `npm run test:sql`, and put the tails in the PR. Confirm the migration's
number is one above `main`'s highest, and that each copied SQL object matches its latest on `main` apart from the named
change (`diff` each against its source and paste the diffs' summary in the PR).

## Review focus

- **The copied SQL.** `card_kinds_problem`, `place_cast` and `reverse_card` are copied after #936 merged: its lockout,
  Cheap Shot's pierce and Kick Me's refunds must all survive, and `settlement_input` and `estimate_input` must differ
  from `0398` only in the `ends` they send.
- **Settlement's ends.** Every place the two inputs hand the rules a play's end (an earn, a cushion, a skim, a ride's
  window) must be the cut end, or a cut Kick Me keeps paying in the window it was cut in; and a cut play must never join
  the `ended` list that voids a play whole.
- **`card_ended` on a busy instance.** It is read once per play in many page reads and now probes twice; both probes
  must use their partial indexes (`explain`), and `card_cut_at` must never call `card_ended`.
- **The lock.** A cut of a Cheap Shot and that Cheap Shot's spending cast at once: one wins, and the log says which. The
  ordered `play_reach` lock must close no cycle with the pierce loop, the post, the visit or the character locks.
- **Instant on a post.** A play with no `layer` must not collide in `acts_card_layers`, must hold no stack place on the
  server or the page, and must still show in the post's card list and Lens.
- **Restored Gimmicks.** After an admin reverses a Buzzkill, the store, the Lens, the statuses, `reach_effects` and the
  log all show the Gimmick up again, and nothing that read it as over wrote a fact that stays (a refunds count, a
  spent pierce).
- **The log's truth.** The Gimmick's `gimmickEnded` row must find its cutting Act wherever the log has paged; a row that
  says "ended" at the original time for a cut play is a lie.
- **The masks.** No refusal, list or payload reads who owns the player, the target or the Gimmick; a Buzzkill on one's own
  other mask is refused or lands in the same words as anyone's.
