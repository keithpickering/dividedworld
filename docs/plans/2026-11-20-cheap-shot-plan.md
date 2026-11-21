Record, written 2026-11-20.

# Cheap Shot, a Gimmick that gets the character's next Move past Wards and catches: plan

Carries out `docs/plans/2026-11-20-cheap-shot-design.md`. One PR from `main`.

**May start** once this plan merges, **and only after** the Whoopee Cushion build (PR #891) and the refund outcome
build (Kick Me and Pay It Forward, from PR #892's plan) have both merged. Each of them redefines SQL this plan
redefines (below). This build copies every SQL object whole from its latest version on `main` at the time it starts,
and again if `main` moves before it merges. Its key, `cheap-shot`, is alone in its slot of the sorted lists (between
`card-collector` and `class-clown`).

**The shared SQL this build redefines**, each copied whole from its latest migration with only the named change:

| Object | Latest on `main` today | Also redefined by |
|---|---|---|
| `card_kinds_gimmick_kind` (constraint) | `0376_cushion_kind.sql` | |
| `card_kinds_problem(cards jsonb)` | `0376_cushion_kind.sql` | #891, #892 |
| `card_ended(play uuid)` | `0149_card_writes.sql` | |
| `ward_refusal`: dropped as `(text, uuid, card_kinds)`, created as `(text, uuid, card_kinds, text default null)` | `0148_card_types.sql` | |
| `spring_traps`: dropped as `(text, uuid, uuid, text, uuid[], uuid)`, created with one more `text default null` | `0357_post_veils.sql` | #891, #892 |
| `place_cast` | `0374_cards_on_a_spun_thread.sql` | #892 |

It adds `wards_against(text, uuid, card_kinds)` and the index `acts_pierce_by`. Before copying, find each object's
latest with `grep -l "function public.<name>\|function <name>" supabase/migrations/*.sql | tail -1` (for the constraint,
`grep -l "constraint card_kinds_gimmick_kind"`). Where #891 or #892 changed one, keep their change.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, or `node --experimental-strip-types --test <file>` for the rules'
tests, or `node tools/test-sql.mjs <file>` for one SQL test). Run `npm run typecheck`, `npm run build` and `npm run
test:sql` once after the last task, with the tails in the PR. No deployed database, bucket or connector is touched;
SQL tests run against Postgres on localhost.

**The layers.** Tasks 1 to 5 are the engine's: the `pierce` Gimmick kind, its checks, the cast, the fake, the page and
the words. Nothing there names a card or a class. Tasks 6 and 7 are Divided World's, carried in through `CardRules`,
`CardUi` and `AlertCopy.trapStruck`.

**The world.** Cheap Shot draws nothing on a post. Its status shows where a character's plays show, its face and its
sheet are the glass, and the Lens line and the form's line are the glass's plain words.

**The migration.** It is named `NNNN_pierce.sql`, where `NNNN` is one above the highest number in
`supabase/migrations/` on `main` **at the time this build merges**, not now. Rebase and renumber if `main` moves
during review. The SQL test file is `supabase/tests/NNNN-pierce.sql`, with the same number.

## Task 1. The `pierce` kind, its checks, and the cast decision

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/instance.ts`, `engine/rules/cards.test.ts`,
`engine/rules/instance.test.ts`.

- `GimmickEffect` gains `| { readonly kind: 'pierce'; readonly upTo: Rarity }`. `GIMMICK_KINDS` gains `'pierce'`
  (last). Add to the type's doc comment: "a pierce, used on the player's own character, gets that character's next
  cast past every live ward, and every set card that would catch it, whose card is no rarer than `upTo`; that cast
  spends it."
- `PlayContext` gains `readonly pierce?: Rarity` ("the caster's live pierce, where one is up: a ward whose card is at or
  below it does not turn the cast away") and `readonly rarityOf?: (key: string) => Rarity | undefined`.
- `decidePlay`: the `ward` find skips a ward whose `card` is not null and whose `context.rarityOf?.(card)` is defined
  and `atOrBelow` `context.pierce`. With no `pierce`, nothing changes.
- `instance.ts`, `gimmickProblems`: a `pierce` branch. `upTo` missing or not one of `RARITIES` pushes
  `${who} has a pierce up to ${JSON.stringify(e.upTo)}; a rarity is common, uncommon, rare or legendary` (built from
  `RARITIES` as the ward's sentence is).
- `instance.ts`, `playProblems`, beside the other gimmick-and-play checks: a card whose gimmick is a pierce and whose
  `play` is not `use` pushes `${who} has a pierce and is not a use card`; one whose `reaches` is not exactly
  `['character']` pushes `${who} has a pierce and reaches more than a character`; one whose `upTo` is rarer than its
  own `rarity` pushes `${who} has a pierce up to ${upTo}, rarer than the card`.

Tests, red first:
- `instance.test.ts`, beside the cushion's checks: a use card reaching `['character']` with
  `{ kind: 'pierce', upTo: 'uncommon' }` at rarity `uncommon` has no problem; each sentence above, one case each
  (no `upTo`, `upTo: 'mythic'`, `play: 'cast'`, `reaches: ['post']`, `upTo: 'rare'` on an uncommon card).
- `cards.test.ts`, beside the ward tests: a common Salty cast on a post with a live uncommon ward (`upTo: 'uncommon'`)
  is refused with no `pierce`, lands with `pierce: 'uncommon'` and a `rarityOf` that names the ward uncommon, and is
  still refused with `pierce: 'uncommon'` where `rarityOf` names the ward rare.

## Task 2. SQL: the kind, the spent fact, the Ward, the spring and the cast

Model: sonnet

**Files:** a new `supabase/migrations/NNNN_pierce.sql`, a new `supabase/tests/NNNN-pierce.sql`.

The migration opens with a header comment naming this plan and the design, and saying each object is copied whole from
its latest version with only the named change. In order:

1. `card_kinds_gimmick_kind`, dropped and added again with `'pierce'` in its list.
2. `card_kinds_problem`, copied whole: the kind list and its sentence gain `pierce`, and four cases in Task 1's words
   (`card "%s" ...`, as the function's other sentences start): no or unknown `upTo`; not a use card; `reaches` not
   `["character"]`; `upTo` rarer than the card (`rarity_rank`).
3. The index: `create index acts_pierce_by on acts ((payload #>> '{pierce,by}')) where kind = 'card' and payload ? 'pierce';`
4. `card_ended(play uuid)`, copied whole from `0149_card_writes.sql`, with a third `or exists (select 1 from acts c
   where c.kind = 'card' and c.payload ? 'pierce' and (c.payload #>> '{pierce,by}') = card_ended.play::text)`. Comment:
   "A pierce play is spent by the cast that names it (`pierce.by`): it is over, as an ended play is, for every
   reader." Keep its grants.
5. `wards_against(of_reach text, of_target uuid, incoming card_kinds) returns table (play uuid, at timestamptz, card
   text, rarity text, words text)`: the body of `ward_refusal` (`0148_card_types.sql`) without its `limit`, returning
   each matching live ward's play, time, card key, the card's printed `rarity` (from `card_kinds`) and the refusal's
   words. `stable security definer`, revoked from public, anon, authenticated and service_role, as `ward_refusal` is.
6. `drop function ward_refusal(text, uuid, card_kinds);` then `ward_refusal(of_reach text, of_target uuid, incoming
   card_kinds, passing text default null) returns text`: `select w.words from wards_against(of_reach, of_target,
   incoming) w where passing is null or rarity_rank(w.rarity) > rarity_rank(passing) order by w.at, w.play limit 1`.
   The same grants as before. Check with `grep -n "ward_refusal(" supabase/migrations/*.sql` that every caller's
   latest version passes three arguments.
7. `drop function spring_traps(text, uuid, uuid, text, uuid[], uuid);` then `spring_traps`, copied whole from its
   latest, with `passing text default null` as its last argument. One change: right after `did` is decided, `if
   trigger = 'cast' and did = 'caught' and passing is not null and rarity_rank(<the back's card's rarity>) <=
   rarity_rank(passing) then return '{"passed": true}'::jsonb; end if;`, with the comment "A pierce gets the cast past a
   catch no rarer than it: the back stays set and unsprung, and nothing is written or told (Cheap Shot's design, section
   3.3). A ride or a refund springs as before." The back's rarity is read from `card_kinds` by `fd.card` (add it to
   `spring_facts` only if that function is already being copied; otherwise read it here). Keep the grants with the new
   signature.
8. `place_cast`, copied whole from its latest:
   - New locals `shot acts%rowtype` (or the columns needed), `shot_up_to text`, `shot_card text`, `passed_ward text`
     and `passed_back boolean := false`.
   - For a `cast` (not a `use`), after the target's lock in each reach's branch and before its Ward check: read the
     caster's live pierce: `select r.play ... from play_reach r join acts k on k.id = r.play join card_kinds ck on
     ck.key = k.payload ->> 'card' where r.character = caster and r.ends_at > now() and ck.gimmick ->> 'kind' = 'pierce'
     order by k.created_at, k.id limit 1 for update of r`. Then, in a separate statement after the lock, drop it if
     `card_ended(r.play)`. Comment: "The caster's pierce, locked last before the Ward check (no other writer locks a
     play_reach row), so two casts by one character take it one after the other, and the second, reading after the
     lock, finds it spent."
   - The Ward check calls `ward_refusal(<reach>, target, kind_of, shot_up_to)`. Where a pierce is up and
     `ward_refusal(<reach>, target, kind_of)` is not null, `passed_ward` is the card key of the oldest
     `wards_against` row at or below `shot_up_to`.
   - The `spring_traps('cast', ...)` call passes `passing => shot_up_to`. Where it answers `passed`, set
     `passed_back := true` and treat the answer as null (nothing sprang).
   - The cast's payload gains `'pierce', jsonb_strip_nulls(jsonb_build_object('by', <the play>, 'card', shot_card,
     'ward', passed_ward))` wherever a pierce was found, whether the cast lands or is caught.
   - After the Act is written, `if passed_back then perform write_alert(caster, 'trapStruck', 'passed', written); end
     if;`
   - A Use, and `lay_sprung`, read no pierce. Nothing else changes.

Tests, red first (`NNNN-pierce.sql`, on the seeded instance's test fixtures, as `0157-skim.sql` sets up its cards):
- The catalog refuses each bad pierce of Task 1, and accepts a good one.
- A character A with a pierce up to uncommon casts a common Salty Move on B's post under a live uncommon ward: it
  lands, its payload's `pierce` names A's play, the card and the ward's key, and the pierce play is now
  `card_ended`.
- The same under a rare ward is refused with the ward's words, and the pierce is still live (not `card_ended`).
- A's pierce, and B's post with a live common catching back that matches the Move: the Move lands, no `spring` Act is
  written, the back is still live (`face_down`, no spring), A's account has one `trapStruck` alert with sub
  `passed`, and B's account has none.
- With a rare catching back the Move is caught as before, and the pierce is spent.
- With a ride back (a test card with `outcome: { kind: 'ride', ... }`) the back springs `rode` as before.
- A second cast by A after the first lands: no `pierce` on its payload, and the ward turns it away.
- A Use by A, and a Move landing from a quote on A's set, leave the pierce live.
- With no pierce, every existing test file passes unchanged (`npm run test:sql`).

## Task 3. The fake

Model: sonnet

**Files:** `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

`playCard` (near line 2066) and `playBeyond` do what Task 2's `place_cast` does, in the same order: find the caster's
live, unspent pierce (a reach play on the character whose card's gimmick is a pierce, not reversed, with no card Act
naming it in `pierce.by`); pass `pierce` and `rarityOf` to `decidePlay`; skip a catch at or below it where the fake
springs a back (`liveBack` and the code that follows it); write `pierce` on the play's payload; and write a
`trapStruck` alert with sub `passed` to the caster's account where a back was passed. `effectsOn` and `reachEffects`
leave out a spent pierce, as `card_ended` does on the server.

Tests, red first, in `fake.test.tsx` beside its ward and catch tests: each bullet of Task 2's SQL test that the fake
can express.

## Task 4. The page: the play, the store, the marks, the form and the Lens

Model: sonnet

**Files:** `engine/ui/cards/types.ts`, `engine/ui/cards/plays.ts`, `engine/ui/cards/land.ts`,
`engine/ui/cards/PlayActions.tsx`, `engine/ui/cards/PlayForm.tsx`, `engine/ui/cards/Lens.tsx`, a new
`engine/ui/cards/pierce.ts`, and the tests beside each.

- `CardPlay` gains `readonly pierce?: { readonly by: Id; readonly card: string; readonly ward?: string }` (the cast's
  own payload, public). `playOf` reads it where the payload's `pierce` is an object with string `by` and `card`.
- `CardPlay.spent`'s comment widens: "a play something has spent: a Take the Fall play a filing named (the thread
  page's `spent`), or a pierce play a cast named in `pierce.by`."
- The store (`plays.ts`, the method that takes in card Acts and `card_end`s): a card Act whose payload names
  `pierce.by` also marks that play spent, as `setSpent` does, holding it for later where the play is not here yet.
- `pierce.ts`: `usePierce(character: Id | null): { readonly upTo: Rarity; readonly card: string } | null`. It is the
  caster's live, unspent pierce, read with `api.effectsAbove([character], null, null)`, at most once per character
  per page, kept in one cache the page shares, and dropped when the store marks that play spent or a play by that
  character arrives.
- `land.ts`: `LandingContext` and `waysOn`'s context gain `pierce?: Rarity`; `landingOn` passes `pierce` and a
  `rarityOf` read from `context.cards` to `decidePlay`. `PlayActions.tsx` and `PlayForm.tsx` pass the acting
  character's `usePierce(...)?.upTo`.
- `PlayForm.tsx`: for a cast, with a pierce up, one line beside the price: `This Move uses up your ${name}.`, `name`
  being the pierce card's name from the instance's cards.
- `Lens.tsx`, `PlayRow`: a play with `pierce` shows one line under its caster: `Cast on a ${name}` or `Cast on a
  ${name}, past ${ward}`, names from the instance's cards (`nameOf`). Put the words in `lens-words.ts` as
  `pierceWords(card, ward?)`.

Tests, red first:
- `plays` tests: `playOf` reads a well-formed `pierce` and drops a malformed one; the store marks the named play spent
  when the Move arrives after it, and when it arrives first.
- `land` tests: the ghost mark's `waysOn` offers a cast on a post under a live uncommon ward with `pierce: 'uncommon'`
  and not without it.
- `Lens` tests: the row's line, with and without `ward`.
- `PlayForm` tests (or its story test): the line shows with a pierce up and not without.

## Task 5. The engine's words: the alert and the log

Model: sonnet

**Files:** `engine/ui/types.ts`, `engine/ui/alerts/words.ts`, `engine/ui/alerts/words.test.tsx`,
`engine/ui/log/lines.ts`, `engine/ui/log/lines.test.tsx`.

- `TrapStruckFacts.how` gains `'passed'`, documented as "a pierce got the player's cast past a set card that would
  have caught it; `laid` is the cast's card, `card` the pierce's card, and `setter` and `span` are null (nothing about
  the back is public)."
- `words.ts`, `trapStruck`: first, where `row.sub === 'passed'`: line `Your ${pierceCard} got your ${laid} past a card
  set face down`, detail `It stays face down and didn't spring, and whoever set it isn't told.`, ways to the cast's
  post (`postWay`). `pierceCard` and `laid` come from the Act's `pierce.card` and `card` (`cardName`), and the
  instance's `trapStruck` voice is asked first with `how: 'passed'`.
- `lines.ts`, `cardRows`, for the caster's own `played` row of a cast whose Act has `pierce.ward`: the details gain
  `Your ${pierceCard} got it past a ${wardCard} that would have turned it away.` Nothing for a back: that is the
  alert's.

Tests, red first: the alert's line and detail for a `passed` row, with and without instance words; the log row with
`pierce.ward`, and the same row without `pierce` unchanged.

## Task 6. Cheap Shot's rules

Model: haiku

**Files:** a new `instances/divided-world/cards/cheap-shot.ts`, a new `instances/divided-world/cards/cheap-shot.test.ts`,
`instances/divided-world/cards/index.ts`, `instances/divided-world/cards/cards.test.ts`,
`instances/divided-world/machine.ts` only if it lists cards by hand (today it does not need to: an uncommon is hidden
by rule).

`cheap-shot.ts`, modeled on `thick-skin.ts`:

```ts
/**
 * Cheap Shot (Salty, uncommon, Gimmick on a character): the character's next Move within 3 days gets past every ward and every catching
 * card set face down that is no rarer than uncommon, and spends it (docs/plans/2026-11-20-cheap-shot-design.md). A ride or a refund springs as
 * usual. With no Move cast, it ends by itself after 3 days.
 */
export const cheapShot: CardRules<Record<string, never>> = {
  key: 'cheap-shot',
  name: 'Cheap Shot',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'pierce', upTo: 'uncommon' },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(cheapShot, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
```

Register it in `index.ts` in key order (after `card-collector`), and add `['cheap-shot', 'salty', 150]` to
`cards.test.ts`'s list in key order. `cheap-shot.test.ts`: the card has no instance problem; it lands on the caster's
own character and is refused on a post; a second is refused while one is up (stack 1).

## Task 7. The face, the sheet and the instance's words

Model: sonnet

**Files:** a new `instances/divided-world/ui/cards/cheap-shot/ui.ts`, `instances/divided-world/ui/cards.ts`,
`instances/divided-world/ui/index.test.tsx`, `instances/divided-world/ui/trap-words.ts`,
`instances/divided-world/ui/trap-words.test.tsx`.

- `ui.ts`, modeled on `thick-skin/ui.ts`, with the art already in the folder (`art.webp`, `mark.svg`, `art.json`).
  Tagline `Your next Move slips past defenses.`; summary `Used on your own character. Its next Move within
  ${spanWords(cheapShot.lasts!)} can't be turned away or caught by a card up to ${upTo}.`; status `Lining up a cheap
  shot`; `logPlay`: `That character's next Move can't be turned away or caught by a card up to ${upTo}.` `upTo` is
  read from `cheapShot.gimmick` and throws if it is not a pierce, as Thick Skin's share is read. `describe` says, in
  the sheet's plain style: a Salty card, uncommon, used on your own character; its next Move within 3 days gets past
  any card that would turn it away or catch it, up to uncommon; a card set face down that it gets past stays face
  down, and only you are told; a card that lets a Move land and pays or gives it back still springs; it does nothing
  for a Move that lands from a quote; that Move uses it up, whatever was in the way; it costs nothing more to use.
  The `art.color` and `ink` are read from `art.json` or the render, as the built cards' are.
- Register it in `ui/cards.ts` in key order, and add its row to `index.test.tsx`'s tables as Thick Skin's is.
- `trap-words.ts`: a `passed` case in the instance's `trapStruck` voice, which may gloat and may not bluff: a short
  line saying the player's card slipped past something face down, and a detail saying it stays face down and its
  setter is not told. Its test beside the others.

## Task 8. A Cheap Shot, end to end on the fake

Model: sonnet

**Files:** `engine/ui/data/fake.test.tsx` or the instance's end-to-end test beside Whoopee Cushion's.

- A uses Cheap Shot on A's character, and its status shows on A's posts.
- B has Force Field up on B's post. The ghost mark offers A's Whoops! there; it lands; its Lens row says "Cast on a
  Cheap Shot, past Force Field"; A's status is gone; A's log shows the Ward line.
- B sets Rope Break on another post. A uses a second Cheap Shot and casts a Salty common there: it lands, the back is
  still face down, A has the `passed` alert, and B has no alert.
- A casts again with no Cheap Shot: Force Field turns it away.

## Task 9. The build

Model: inline

Run `npm run typecheck`, `npm run build` and `npm run test:sql`, and put the tails in the PR. Confirm the migration's
number is one above `main`'s highest, and that each copied SQL object matches its latest on `main` apart from the
named change (`diff` each against its source and paste the diffs' summary in the PR).

## Review focus

- **The copied SQL.** `card_kinds_problem`, `spring_traps` and `place_cast` are copied after #891 and #892 merged:
  each of their changes must survive, and the dropped `ward_refusal` and `spring_traps` signatures must leave no
  caller passing the old argument list.
- **`card_ended` on a busy instance.** It is read once per play in many page reads; the new probe must use
  `acts_pierce_by` (check the plan with `explain`), and it must answer false for every play that is not a pierce.
- **The lock.** Two casts by one character at once spend one Cheap Shot; the `play_reach` lock is last before the
  Ward check, and no deadlock with the post, visit or character locks `place_cast` already takes.
- **The masks.** The public payload names the Cheap Shot and a Ward only; nothing public or timed says a back was
  passed; the `passed` alert reaches the caster's account alone, and its decision reads no owner.
- **The page's read.** `usePierce` reads the acting character's plays once per page, not once per post's ghost mark.
- **Acts already held.** No existing play becomes ended, and every existing ward and catch test passes unchanged.
