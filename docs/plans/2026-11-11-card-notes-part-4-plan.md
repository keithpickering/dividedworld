# Card notes, Part 4: Sugar Coat, Hype-Up and Last Word: plan

Record, written 2026-11-11. The plan for Part 4 of `docs/plans/2026-11-11-card-notes-design.md` (its section 2:
"Sugar Coat", "Hype-Up" and "Last Word"; its section 5 holds the owner's answers, so every rework stands). It stands
on `docs/plans/2026-11-11-card-types-design.md` (Gimmick effects, section 5), which is on `main`. Built by one build
session in one PR, from `main`.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added.
`tools/bbcode-plain.mjs` changes (Task 3), and its self-test `tools/test-bbcode-plain.mjs` gains the poison named
there. Each new validation in `instanceProblems` and `card_kinds_problem` is driven red by a poisoned card in its test.
No deployed database, bucket or connector is touched; SQL is tested against Postgres on localhost (`npm run test:sql`).

**Migrations.** One migration, `NNNN_card_notes_part_4.sql`, taking the next free number in `supabase/migrations/`
(the highest is `0149_card_writes.sql` as this is written, so 0150). Its SQL tests take the next free numbers in
`supabase/tests/` (the highest is `0155-back-live-readers.sql`, so 0156 on). Sibling plans of the same design are
built at the same time and may take numbers first: take the next free ones when the branch is cut, and again after any
merge of `main`. Each function the migration replaces is copied from its latest definition, found case-insensitively
(`grep -il "function public.<name>(\|function <name>(" supabase/migrations/*.sql`). As this is written:

| Function | Latest definition |
|---|---|
| `card_kinds_problem` | 0148:39 |
| `place_cast` | 0148:153 |
| `place_set` | 0148:805 |
| `settlement_input` | 0148:1180 |
| `estimate_input` | 0148:1267 |
| `write_staff_act` | 0142:664 |
| `bbcode_walk`, `bbcode_plain` | 0144:108, 0144:426 |
| the constraints `card_kinds_gimmick_use`, `card_kinds_gimmick_kind` | 0148:28-32 |

Everything a copied function does that this plan does not name stays as written, its lock order included
(`supabase/migrations/0075_trap_locks.sql`, header; 0142:75). `post`, `edit_post`, `spin_written`, `start_thread`,
`lock_for_quote`, `spring_facts`, `spring_traps` and `lay_sprung` are **not** replaced. A task that finds it must
take a later lock before an earlier one stops and asks.

## What the code holds today

Read before the plan was written; each task leans on these.

- **A Ward that names flavors is whole.** `GimmickEffect`'s ward has `flavors` (`engine/rules/cards.ts:79`);
  `wardTurnsAway` (:129) and `wardWords` (:138) read them; `decidePlay` (:320) refuses with them; SQL's `ward_refusal`
  (0148:122) is the same test in the same words for `place_cast` at every reach and for `spring_facts` step 4b;
  `gimmickWords` (`engine/ui/cards/marks.ts:94`) says "Turns away Salty and Pepperoni cards"; `instanceProblems`
  checks the list (`engine/rules/instance.ts:491`). `supabase/tests/0151-gimmick-wards.sql` holds a flavor ward. So
  **Sugar Coat is instance content only**, as the design says.
- **An Earn is tied to a use card in six places.** `playProblems` (`instance.ts:444`: "has a gimmick, and only a use
  card has one"); the constraint `card_kinds_gimmick_use` (0148:29); `card_kinds_problem` (0148:54);
  `settlement_input` and `estimate_input`, which send `ends` only for a use card's play (0148:1248, 1403) and find the
  Earn plays of earlier windows only among use cards (`earn_up`, 0148:1188-1194, 1295-1303); and `place_cast`, which
  refuses a use card on a character that is not the caster (0148:237). `settle.ts` itself already reads any card whose
  `gimmick` is an earn (`earnOf`, `engine/rules/settle.ts:157-158`) on the character a character-reach play is `on`
  (:468).
- **Every Earn boosts on its own today** (`settle.ts:508-513`), so two Earns on one character add.
- **A staff character's Acts are not in the settlement's input** (`is_staff_side`, 0148:1197, 1222), so an Earn play
  by a Mod Bot would boost nothing.
- **`estimate_input` leaves out an Earn another player cast on the caller's character inside the open window**: its
  window Acts are the caller's own (0148:1304), and `earn_up` takes only plays from before the window (:1299).
- **A quote, to the face-down Moves, is the post's `quoting` target**: `post(in_thread, through, body, quoting)`
  (0142:629) hands it to `lock_for_quote` and `spring_traps('quote', quoting, …)`. The composer sends the first real
  quote at the top of the draft (`firstQuote`, `engine/ui/composer/Composer.tsx:53`). A body can hold real quotes
  (`[quote=<Act id>]`, `engine/bbcode/parse.ts:34`) of other posts that are not its target, and `edit_post`
  (0130:198), `start_thread` and a spin's words carry bodies too. `bbcode_walk(body, quoted)` (0144:108) finds only
  the quotes of one Act that no other real quote encloses (the excerpt). So neither is enough to stop a quote, and
  Task 3 adds the list of every real quote to the one walk.
- **Guards on `acts` are `before insert` triggers with a `when`** (`acts_visit_guard`, 0105:223; `acts_report_guard`,
  0107:110). `acts_search` (0117:511) names the kinds that carry a body: `post`, `spin`, `edit`. The import writes as
  a replica, where they do not fire (0117:291).

## The words this plan uses

A **Move** is a card whose play is `cast`, a **Reversal** `set`, a **Gimmick** `use`; a **back** is a card lying face
down. The engine's own strings and comments say "a cast card", "a use card", "a set card", and name no card.

## The cards

| | Sugar Coat | Hype-Up | Last Word |
|---|---|---|---|
| Key | `sugar-coat` | `hype-up` | `last-word` |
| Type (engine play) | Gimmick (`use`) | Move (`cast`) | Gimmick (`use`) |
| Flavor | Sweet | Sweet | Salty |
| Rarity | rare | uncommon | uncommon |
| Reach | one's own post | a character, anyone's | one's own post |
| Stack | 1 | 1 | 1 |
| Lasts | 7 days | 36 hours | 7 days |
| Effect | `{ kind: 'ward', flavors: ['salty', 'pepperoni'] }` | `{ kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.1, group: 'publicity' }` | `{ kind: 'noQuote' }` |
| Play price | 0 | 0 | 0 |
| Machine slot | `hidden`, 300 | `onSale`, 150 | `onSale`, 150 |
| Configuration | none | none | none |
| Render | `sugar-coat.png` | `hype-up.png` | `last-word.png` |

Sugar Coat's slot follows Main Event, the one rare (`instances/divided-world/machine.ts`, last slot): every card has a
slot (`cards.test.ts:38`), a rare's is hidden at 300, and it is found in the Booster's hit pull, whose 25% the rares
share (`instances/divided-world/packs.ts`).

## Task 1. An Earn a cast card carries, and Earns that do not add (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`, `engine/rules/settle.ts`, `engine/rules/settle.test.ts`, `engine/rules/types.ts`.

**The effect on a cast card.**
- `CardRules.gimmick` (cards.ts:201-202): its comment becomes "A use card's effect while it is up; every use card has
  one. A cast card that reaches a character alone may carry an earn, which the character it lands on has while the
  play is up. Nothing else has one."
- `playProblems` (instance.ts:444): a `gimmick` on a card that is not a use card is refused **unless** the card is a
  cast card, the gimmick's kind is `earn`, and `reaches` is exactly `['character']`. The refusal's words become
  `card "<key>" has a gimmick, and only a use card has one, or a cast card on a character an earn`. An allowed cast
  earn goes through `gimmickProblems` as a use card's does. (`lasts` is already required beyond a post.)
- `staffOffers` (cards.ts:524): a cast card that carries a gimmick is never offered. Its comment says why: a staff
  character's Acts are not settled, so an earn a persona cast would never be paid.

**Earns that do not add.**
- The earn effect (cards.ts:80) gains `readonly group?: string`. Its comment: earn effects on one character or post
  that share a group do not add; for each earning the largest `by` among them applies. An earn with no group boosts on
  its own, as before.
- `gimmickProblems` (instance.ts:496): a `group` that is not a non-empty string is refused
  (`card "<key>" has an earn with the group <value>; a group is a word`).
- `settle.ts`: `Boost` (:464) gains `group?: string` and `play: string` (the play's Act id). In the pass at :506-514,
  for each earning the applicable boosts are found as today (window, quadrant or kind). Then:
  - each applicable boost with no group adds its own `card.boost` earning, as today;
  - among the applicable boosts of one group, only one adds: the largest `by`; on a tie the earliest `from`; then the
    smaller `play` id. Its `params.card` is that play's card, so the log names the card that paid.
- The header comment (settle.ts:35-38) says both, and that an earn may be a cast card's on a character.
- `InputAct.ends` (types.ts:366): "When a play of a card that carries a gimmick ends".

**Tests first.**
- `instance.test.ts`, each a poisoned card: a cast card on a post with an earn; a cast card on a character with a
  ward; a cast card reaching a character and a post with an earn; an earn with `group: ''`. And one that passes: a
  cast card on a character with an earn and `lasts`.
- `cards.test.ts`: `staffOffers` is false for a cast card with an earn, and still true for the same card without it.
- `settle.test.ts`:
  - a cast earn on another player's character boosts that character's positive earnings in `[at, ends)`, by the
    target's player, and pays the caster nothing for it;
  - two earns of one group on one character (one use, one cast, both 0.1): one `card.boost` per earning, the earlier
    play's card;
  - one of 0.1 and one of 0.2 in a group: the 0.2's alone, whichever was played first;
  - their windows overlap in part: an earning inside only one window is boosted by that one;
  - a grouped earn beside an ungrouped one naming the same quadrant: both boost (today's test "each boosts on its
    own" still passes unchanged);
  - a cast earn on one's own other mask boosts like a use.

## Task 2. The No quote effect in the rules (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`, `engine/bbcode/visible.ts`, `engine/bbcode/plain.fixtures.ts`,
`engine/bbcode/plain.test.ts`.

**The effect.**
- `GimmickEffect` (cards.ts:78) gains `{ readonly kind: 'noQuote' }`, and `GIMMICK_KINDS` (:83) gains `'noQuote'`.
  The type's comment gains: "a no-quote stops a post that quotes the post it is on, before that post is written".
- `gimmickProblems` (instance.ts:486): a `noQuote` branch. `playProblems` refuses a card whose gimmick is `noQuote`
  and whose `reaches` is given and is not exactly `['post']`:
  `card "<key>" stops quotes, and a card that stops quotes reaches a post alone`.
- New exports in cards.ts, beside `wardWords`:

  ```ts
  /** The live no-quote effect on a post, if it has one: the play that stops quotes of it. */
  export const quoteStop = (effects: readonly CardEffect[], now: Date = new Date()): CardEffect | undefined =>
    effects.find((e) => e.gimmick?.kind === 'noQuote' && (e.reach ?? 'post') === 'post' && isLive(e, now));

  /** A stopped quote's refusal, the same for every writer; the guard on acts says it in the same words. `seq` is the quoted post's number where it is in the thread written to. */
  export function noQuoteWords(cardName: string, ends: string | undefined, seq: number | null): string {
    const post = seq === null ? 'a post in another thread' : `post ${seq}`;
    return `${post} carries ${cardName}, so it cannot be quoted until ${ends ? refusalTime(ends) : 'it ends'}; take that quote out and send again`;
  }
  ```

**The two refusals that keep a back and a no-quote apart.**
- `decideUse` (cards.ts:332), before `decided`: a card whose gimmick is `noQuote` is refused on a target that holds a
  live face-down effect (`e.faceDown && isLive(e, now)`):
  `<name> stops quotes, and this post holds a card face down; take that card back first`.
- `decideSet` (cards.ts:362), after the "already holds a card face down" line (:369): a target with a live
  `quoteStop` is refused: `this post's <name> stops quotes until <refusalTime(ends)>, so no card is set face down here
  until then`. The name is the stopping card's, from `cards` (the list `decideSet` already takes), or `card` where it
  is not found.
- Both read only the post's public effects. They hold for a back of any card, a Reversal's too, since a back names no
  card.

**Every real quote in a post.**
- `visible.ts` gains `quotedActs(nodes: readonly BbNode[]): string[]`: the Act of every `quote` node the parser
  built, at any depth, in the order they open, each once (lowercase, as `parse` gives them). Written with its own
  stack, as `excerptText` (:73) is, but it goes into every node that has children, a quote's and a link's included.
- `PlainFixture` (plain.fixtures.ts:15) gains `readonly quotes?: readonly string[]`: where given, `plain.test.ts`
  holds `quotedActs(parse(body))` to it. Task 3 holds the database to the same list.
- New fixtures, each with `quotes`: one real quote; two of different Acts; the same Act twice (listed once); a real
  quote inside a real quote of another Act (both, outer first); inside a counterfeit quote; inside `[code]` and
  inside `[noparse]` (not listed); inside a link, a list item and a spoiler; a `[quote=<id> user=<id>]` head and a
  quoted `[quote="<id>"]` head; an upper-case id; an unclosed real quote; a real quote past `MAX_DEPTH`; a body with
  none (`[]`). For the last four, the expected list is what `parse` builds, read from the red run and confirmed
  against `parse.test.ts`.

**Tests first.** `cards.test.ts`: `quoteStop` finds a live no-quote and not an ended one or one on a thread;
`noQuoteWords` with a number and without; `decideUse` refused on a post with a live back and accepted once the back
has ended; `decideSet` refused on a post with a live no-quote, in the words above, and accepted once it has ended.
`instance.test.ts`: a poisoned `noQuote` card that reaches a character. `plain.test.ts`: the fixtures above.

## Task 3. The schema (SQL)

Model: sonnet

**Files:** the migration; `tools/bbcode-plain.mjs`, `tools/test-bbcode-plain.mjs`,
`supabase/tests/0117-bbcode-plain.sql` (generated); the new SQL tests.

The migration's header says, as 0148's does, what each section changes, its ways out and its masks. Sections:

**1. The catalog.**
- `card_kinds_gimmick_use` is dropped and added again as
  `gimmick is null or play = 'use' or (play = 'cast' and gimmick ->> 'kind' = 'earn' and reaches = array['character'])`.
- `card_kinds_gimmick_kind` is dropped and added again with `'noQuote'` in its list.
- A new constraint `card_kinds_no_quote_post`: `gimmick ->> 'kind' is distinct from 'noQuote' or reaches = array['post']`.
- `card_kinds_problem` (0148:39): the gimmick-on-a-non-use-card case (:54) gains the cast-earn exception, in Task 1's
  words; the kind list (:57-58) gains `noQuote` ("a gimmick is ward, earn, price or noQuote"; `instanceProblems`'
  sentence is built from `GIMMICK_KINDS`, so the two agree); a no-quote card reaching anything but a post is refused
  in Task 2's words. Poisons in the SQL test: each of those three.
- No row a database holds changes: no card kind on `main` is a cast card with a gimmick or a no-quote.

**2. Every real quote, in the same walk.**
- `bbcode_walk(text, uuid)` is dropped and created again returning `table(plain text, excerpt text, quotes text[])`,
  copied from 0144:108-423. `quotes` is the Act (`bbcode_plain_quote_act(qrest)`) of every quote opener the walk makes
  a frame for as a real quote (`want` of `sep` or `keep`, in the branch at 0144:407-415, so an opener past `max_depth`
  that becomes text is not listed), in order, each once. It is written into an array by index, as `out[]` is, never
  by appending in the loop. The early return for an empty body (0144:183) gives `'{}'`.
- `bbcode_plain` (0144:426) is stated again unchanged, with both functions' revokes and grants (0144:431-432).
  `spring_facts` reads `plain` and `excerpt` by name and is not replaced.
- `tools/bbcode-plain.mjs`: `readFixtures` checks a `quotes` that is given (an array of Act ids), and `sqlTests`
  (:57) asserts, for a fixture with `quotes`, that `(select w.quotes from bbcode_walk(body, null) w)` equals it.
  `node tools/bbcode-plain.mjs` writes `supabase/tests/0117-bbcode-plain.sql` again.
- **Poison** in `tools/test-bbcode-plain.mjs`: a generated file whose `quotes` for one fixture was changed by hand
  drives `check-bbcode-plain.mjs` red; a fixture whose `quotes` holds a string that is not an Act id is refused by
  `readFixtures`.
- `supabase/tests/0118-bbcode-plain-scale.sql` must still pass: the walk stays linear with a body of many quotes.

**3. `no_quote_on(post uuid) returns table(name text, ends timestamptz)`.** `stable security definer`, executable by
no API role. The live no-quote play on a post, the latest-ending first: a `card` Act on it at post reach, not caught,
whose `payload.ends` is after `now()`, not `card_ended`, whose kind's `gimmick ->> 'kind' = 'noQuote'`. The same
shape of read as `ward_refusal`'s post branch (0148:131-133, 139), through `acts_layers` (0072:67). It reads only
the post's public plays.

**4. The guard.** `acts_quote_guard()`, a trigger function, and
`create trigger acts_quote_guard before insert on acts for each row when (new.kind in ('post', 'spin', 'edit'))`.
- What the new Act quotes: its `target_act_id` where it is a `post` (the `quoting` target; a spin's target is its
  origin and an edit's is its post, and neither is a quote), and every Act in `bbcode_walk(body, null).quotes`. The
  walk runs only when the body matches `\[quote=` case-insensitively; with no target and no such text the function
  returns at once.
- For an `edit`, the Acts the post's current body already quotes (`acts_public.current_payload ->> 'body'` of the
  edited post, walked the same way) are taken out of the list first, so an edit is refused only for a quote it adds.
  That second walk runs only when the first list is not empty.
- The first Act of the list, in order, with a row in `no_quote_on` is the refusal:
  `raise exception '%', <words> using hint = 'kayfabb.refusal', errcode = '42501'`. The words are `noQuoteWords`'
  (Task 2): `post <seq>` where the quoted post's thread is `new.thread`, else `a post in another thread`; the card's
  name from `card_kinds`; the end by `refusal_time` (0055:64).
- It is the same for every writer, the quoted post's own author and a staff character included. It reads the new
  Act's body and target and the quoted posts' public plays, and nothing about who owns anything.

**5. `write_staff_act`** (0142:664): where `kind = 'post'` and `target` is not null and `no_quote_on(target)` has a
row, the post is written with no target and `quoting` is false, so a pool reply to a post that cannot be quoted lands
as a plain reply and the paid answer is kept (CLAUDE.md, "A validator tighter than the schema is a place a paid
answer goes to die"). A staff body that itself holds a real quote of such a post is refused by the guard like anyone's.

**6. `place_cast`** (0148:153). Three additions:
- At post reach, after the own-post check (:202-204): a use card whose gimmick is `noQuote` is refused where the post
  holds a live back, by the predicate `place_set` uses (0148:895-897): `'% stops quotes, and this post holds a card
  face down; take that card back first'`, errcode 23505. The post's row is already locked (:200), and `place_set`
  takes the same row first (0148:885), so the two are laid one at a time.
- At character reach, the use-card check (:237) is unchanged: a cast card carrying an earn passes it and lands on any
  character, by the stack count that follows.
- Before the reach branch: a staff caster's cast card that carries a gimmick is refused with a plain exception
  (`'a staff character casts no card that carries an earn'`, errcode 22023, no refusal hint): the settlement leaves a
  staff character's Acts out, and the play's Lens would claim a boost that is never paid.

**7. `place_set`** (0148:805): after the live-back check (:895-899), a post with a row in `no_quote_on` is refused:
`'this post''s % stops quotes until %, so no card is set face down here until then'` (the card's name,
`refusal_time(ends)`), errcode 23505. `staff_set_card` sets through `place_set`, so a persona's set is held too.

**8. `settlement_input` and `estimate_input`** (0148:1180, 1267):
- `ends` is sent for a `card` Act whose kind holds a gimmick (`ck.gimmick is not null`), in place of `ck.play = 'use'`
  (:1248, :1403).
- `earn_up` drops `ck.play = 'use'` from its filter and from its `max(e.lasts)` subquery (:1191-1192, :1298-1299).
- In `estimate_input` alone, `earn_up`'s upper bound becomes `k.created_at < window_end` (:1299), so an Earn another
  player cast on the caller's character inside the open window is in the caller's estimate. The caller's own plays in
  the window are already Acts of the input, and `touched` is a union, so nothing is counted twice.

**SQL tests first** (the cards are each file's own, never an instance's, as 0151's are).

`NNNN-earn-casts.sql`:
- a cast card with an earn seeds; the three catalog poisons are refused in the engine's words;
- it lands on another account's character, and on the caster's own; a second on the same character is refused
  (`this character already carries that card`);
- a use card with an earn is still refused on another's character (`% is used on your own character`);
- a staff caster's is refused;
- set face down, it lands on the quoting post's character with `reach`, `character` and `ends` in its payload;
- `settlement_input` carries the cast play with `ends` and `on`, in its own window and, through `earn_up`, in the
  next; `estimate_input` for the target's account carries another's play made inside the open window, and for a third
  account does not.

`NNNN-no-quote.sql`:
- a post that targets a post with a live no-quote is refused, 42501, in `noQuoteWords`' words with the post's number;
  the same post with no target and no quote is written;
- a body holding `[quote=<it>]` with another target, with no target, nested in a quote of another post, and in a
  thread's first post and a spin's words: each refused; inside `[code]`: written;
- a quote from another thread says "a post in another thread";
- the quoted post's own author is refused in the same words;
- an edit that adds the quote is refused; an edit of a post that already held the quote, changing other words, is
  written; an edit of the stopped post by its author is written;
- a spin **from** the stopped post is written;
- once the play's time has passed, and once an admin has ended it (`reverse_card`), the quote is written;
- the no-quote card is refused on a post with a live back, and accepted after `take_back`; a set is refused on a post
  with a live no-quote, in `decideSet`'s words, and accepted once it has ended;
- `write_staff_act` with a stopped target writes a post with no target and springs nothing; a staff body with the real
  quote is refused;
- a quote of a post whose no-quote has ended springs that post's back as before (0135's cases still pass).

## Task 4. The act function and the fake backend (engine, functions)

Model: sonnet

**Files:** `supabase/functions/act/core.test.ts` (`core.ts` itself reads the target's effects, backs included, and
calls `decideUse` and `decideSet` already: 157-191), `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

**The fake** mirrors Task 3:
- `post` (fake.ts:1052), the edit and the spin refuse a stopped quote: the quoted Acts are the `quote` argument and
  `quotedActs(parse(body))`; for an edit, less those the current body holds; a quoted post is stopped where
  `quoteStop` finds a live effect among its effects (the read at fake.ts:1486-1493); the words are `noQuoteWords`.
- A cast card with an earn lands on another account's character (the fake's own-character check is for use cards).
- The set and the use go through `decideSet` and `decideUse`, so Task 2's refusals hold with no code of the fake's.
- The fake's note of what it does not mirror (fake.ts:1467) is kept true.

**Tests first.** `fake.test.tsx`: a quote of a stopped post refused and the plain reply written; an edit that adds
the quote refused; the no-quote card refused on a post with a back; a set refused on a stopped post; a cast earn on
another's character lands and shows among that character's effects. `core.test.ts`: a `playCard` of a no-quote card
on a post whose target read holds a face-down effect is refused before `play_card` is called; a `setCard` on a post
whose read holds a live no-quote is refused in `decideSet`'s words.

## Task 5. The screens (engine; the board and the glass)

Model: sonnet

**The world.** The Quote link is the board's (`docs/plans/2026-10-29-two-worlds-design.md`): nothing new is drawn
there, a link is only left out. The Lens's words are the glass's, plain and never in character. A refusal is shown
where the composer and the forms already show one.

**Files:** `engine/ui/cards/marks.ts` and its test; `engine/ui/thread/Post.tsx`, `engine/ui/thread/Thread.tsx`,
`engine/ui/thread/Thread.test.tsx`; `engine/ui/cards/lens.test.tsx`; `engine/ui/thread/Thread.stories.tsx` (or the
board story file the thread's card stories live in).

- **`gimmickWords`** (marks.ts:94) gains a `noQuote` branch before the ward's (today any kind that is not price or
  earn is read as a ward): state `Cannot be quoted`, with `endsWords(ends)`. An ended one says what every ended use
  card says (:95).
- **The Quote link.** `Actions` (Post.tsx:118-132): `quotable` is false while `quoteStop(effectsOf(plays of the post,
  instance.cards, settings.setLasts))` finds a live effect (`effectsOf`, `engine/ui/cards/land.ts:25`; the post's
  plays come from `useThread().plays`, as Post.tsx:50 reads them). `quotableAt` (Thread.tsx:568) returns `undefined` for
  such a post, so highlight-to-quote offers nothing in it, and the toolbar's Quote (`onQuote`, Thread.tsx:573 on)
  is absent when the last post shown is one. The link comes back when the play ends, at the next render after its
  time.
- The link is left out and not disabled: a disabled control says nothing, and the post's mark and its Lens say why.
- No change to the composer: a quote typed by hand, or sent from a page read before the card landed, is refused by
  the server in `noQuoteWords`' words, which the composer shows as it shows any refusal, with the draft kept.

**Tests first.**
- marks test: the no-quote's state and end, live and ended; a ward's words unchanged.
- `Thread.test.tsx`: a post with a live no-quote play has no Quote button and its neighbors do; a selection inside
  it shows no Quote; with the play ended (`ends` in the past) and with it reversed, the button is there.
- `lens.test.tsx`: the Lens of a live no-quote play reads "Cannot be quoted" and "Ends …"; the Lens of a cast earn on
  a character reads "Earns 10% more from some reactions" (Lens.tsx:237 reads the card's `gimmick` whatever its play).
- The Lens word rules (`engine/ui/cards/lens-words.ts`) pass for "Cannot be quoted".
- A board story: a thread with one post under a no-quote card, light and dark. Its id goes where
  `e2e/board-stories.ts` lists stories, if that is a list.

## Task 6. Divided World's cards (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/publicity.ts`, `sugar-coat.ts`, `hype-up.ts`, `last-word.ts` (new);
`publicity-tour.ts`; `index.ts` (`listed` and the header comment); `cards.test.ts`;
`instances/divided-world/machine.ts`.

`publicity.ts` holds the numbers Publicity Tour and Hype-Up share, so "its numbers are Publicity Tour's" is one
list (no card file imports another card: `index.ts`, the note on Card Collector):

```ts
import type { GimmickEffect } from '../../../engine/rules/cards.ts';
import type { Span } from '../../../engine/rules/types.ts';

/** The push Publicity Tour gives its own character and Hype-Up gives another's. One group: the two do not add, and the larger applies. */
export const PUBLICITY: GimmickEffect = { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.1, group: 'publicity' };
export const PUBLICITY_LASTS: Span = { unit: 'hour', count: 36 };
```

`publicity-tour.ts` reads both. The three cards, each with a header comment that says what it does and names the
design:

```ts
export const sugarCoat: CardRules<Record<string, never>> = {
  key: 'sugar-coat', name: 'Sugar Coat', alignment: 'sweet', rarity: 'rare', play: 'use',
  gimmick: { kind: 'ward', flavors: ['salty', 'pepperoni'] },
  lasts: { unit: 'day', count: 7 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(sugarCoat, target, effects, now),
  validateConfig: () => ok({}),
};

export const hypeUp: CardRules<Record<string, never>> = {
  key: 'hype-up', name: 'Hype-Up', alignment: 'sweet', rarity: 'uncommon',
  reaches: ['character'], gimmick: PUBLICITY, lasts: PUBLICITY_LASTS,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(hypeUp, target, effects, now),
  validateConfig: () => ok({}),
};

export const lastWord: CardRules<Record<string, never>> = {
  key: 'last-word', name: 'Last Word', alignment: 'salty', rarity: 'uncommon', play: 'use',
  gimmick: { kind: 'noQuote' },
  lasts: { unit: 'day', count: 7 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(lastWord, target, effects, now),
  validateConfig: () => ok({}),
};
```

`reachLasts.character` is 7 days and `reachRarity.character` uncommon (`settings.ts:141-143`), so Hype-Up fits.

**The machine** (`machine.ts`): `{ item: { card: 'hype-up' }, availability: 'onSale', price: 150 }` after Publicity
Tour's slot; `{ item: { card: 'last-word' }, availability: 'onSale', price: 150 }` after Force Field's;
`{ item: { card: 'sugar-coat' }, availability: 'hidden', price: 300 }` after Main Event's. Check that the grid has
room, as the card types plan did.

**Tests first**, in `cards.test.ts`:
- the table at :183-188 gains the three rows (`['hype-up', 'uncommon', 'cast', 'sweet', 150]`,
  `['last-word', 'uncommon', 'use', 'salty', 150]`, and Sugar Coat's, rare, at 300 and hidden);
- `hypeUp.gimmick` and `hypeUp.lasts` are the very objects Publicity Tour holds;
- Sugar Coat turns away a Salty common and a Pepperoni legendary and passes a Sweet rare, through `decidePlay`, with
  the words "this post's Sugar Coat turns away Salty cards" and "… Pepperoni cards";
- Last Word is refused on a post with a live back and lands on one without; a second on the same post is refused;
- Hype-Up lands on a character, is refused on a post, and `castOnPost` is false for it (so Card Collector cannot
  name it); `staffOffers` is false for it;
- `instanceProblems(instance)` is empty;
- the machine sells every card (:38), and the Booster's odds test (:504-516) follows: its counts are recomputed from
  the list as it stands on the branch (from `main` as this is written, with these three: 18 cards, ten uncommons
  sharing the 75%, and Main Event and Sugar Coat sharing the 25%). Sibling plans add cards too, so read the list, do
  not copy these numbers.

## Task 7. The cards' art and words (instance)

Model: sonnet

**Files:** `instances/divided-world/ui/cards/{sugar-coat,hype-up,last-word}/` (`art.webp`, `scene.py`, `mark.svg`,
`art.json` each); `instances/divided-world/ui/cards.ts`; `instances/divided-world/ui/index.test.tsx`;
`instances/divided-world/ui/still.test.tsx` and `hint-words.ts` only if their tests name every card.

**The art**, exactly as `instances/divided-world/ui/cards/below-the-fold/` holds it (the README beside the folders;
`docs/plans/2026-11-11-rendered-card-art-plan.md`):
- `art.webp`: the render `docs/research/2026-11-11-card-renders/<name>.png` (each is 1080 by 1680 already) saved as
  lossy WebP at quality 90, as Below the Fold's was. Pillow does it:
  `Image.open(png).convert('RGB').save('art.webp', 'WEBP', quality=90)`. At most 400 KB.
- `scene.py`: `docs/research/2026-11-11-card-renders/<name>.py` copied, with the two lines every card's scene
  carries (`below-the-fold/scene.py:5-6`): the import path is the folder's parent, where `rig.py` is, and
  `sys.dont_write_bytecode = True`. Every `rig.` function the three scenes call is in the instance's `rig.py`
  (checked). The research folder is not changed, and nothing renders in the build.
- `mark.svg`: a square silhouette (`viewBox="0 0 108 108"`, as Below the Fold's) that reads at 18 px, in the card's
  color with the card's ink: Sugar Coat a slab with icing dripping over its top; Hype-Up a megaphone with three
  rings; Last Word a speech bubble with a padlock.
- `art.json`: Below the Fold's, word for word.

**Tests first:** `node tools/check-card-art.mjs` red with a folder holding only `art.webp` (record the refusal), then
green over all three.

**The `CardUi` entries** (`cards.ts`; imports as the other rendered cards', `art.webp?url`). Sweet is
`color: '#2ee6ff', ink: '#03141a'`; Salty is `color: '#ff3d7f', ink: '#14030a'`. None has an `Effect`: none draws on
a post. Numbers are read from the rules (`spanWords`, `earnBy`), as the Gimmicks' are.

Sugar Coat (after Force Field's):
- `tagline`: `'Only Sweet cards land on your post.'`
- `summary`: `` `Used on your post. Turns away Salty and Pepperoni cards for ${spanWords(sugarCoat.lasts!)}.` ``
- `status`: `'Turning away Salty and Pepperoni cards'`
- `describe`: `` `A Sweet card, ${sugarCoat.rarity}, used on one of your own posts. For ${spanWords(sugarCoat.lasts!)}, every Salty or Pepperoni card cast there is turned away before it lands, whatever its rarity, and its caster is told so; a Sweet card lands as usual. It never stops a card set face down. It costs nothing more to use.` ``

Hype-Up (after Publicity Tour's):
- `tagline`: `'Give a character a push.'`
- `summary`: `` `Cast on a character. For ${spanWords(hypeUp.lasts!)}, what it earns from positive reactions is ${earnBy(hypeUp)} higher. A loss is never made worse.` ``
- `status`: `'Earns more from positive reactions'`
- `describe`: `` `A Sweet card, ${hypeUp.rarity}, cast from any post by the character it lands on. For ${spanWords(hypeUp.lasts!)}, whatever that character earns from a positive reaction (excited or calm) to its posts is ${earnBy(hypeUp)} higher, and then it stops by itself. It never makes a loss worse, and it takes nothing from you. It does not add to that character's own Publicity Tour: while both are up, the larger of the two applies. A Mod Bot earns nothing, so it gains nothing from one. ${setMoveWords("the quoting post's character")} It costs nothing more to play.` ``
- `logPlay`: `` () => `What that character earns from positive reactions is ${earnBy(hypeUp)} higher until it ends.` ``

Last Word (after Sugar Coat's):
- `tagline`: `'Stop quotes of your post.'`
- `summary`: `` `Used on your post. Nobody can quote it for ${spanWords(lastWord.lasts!)}.` ``
- `status`: `'Stopping quotes of this post'`
- `describe`: `` `A Salty card, ${lastWord.rarity}, used on one of your own posts. For ${spanWords(lastWord.lasts!)}, a post that quotes it is refused before it is written, for everyone alike, you included; a reply without the quote always goes through. Quotes made before it was played stay as they are. It cannot share a post with a card set face down: take that card back first, and no card can be set face down there until it ends. It costs nothing more to use.` ``
- `logPlay`: `` () => 'Nobody can quote that post until it ends.' ``

What a player reads from the engine for these cards, for the reviewer's eye:
- Sugar Coat's refusal: `this post's Sugar Coat turns away Salty cards` (or `Pepperoni cards`). Lens: `Turns away
  Salty and Pepperoni cards`, `Ends <day and time>`.
- Hype-Up's refusal on a character that has one: `this character already carries that card`. Lens: `Earns 10% more
  from some reactions`, `Ends …`. The target's settled log line: `Hype-Up added: what the card's boost on a reaction
  earned` (`REASONS['card.boost']`, `instances/divided-world/ui/index.ts:90`), with the amount.
- Last Word's refusals: Task 2's three sentences. Lens: `Cannot be quoted`, `Ends …`. The player's log when it ends:
  `Last Word on post N ended.` (`engine/ui/log/lines.ts:668`).

**Tests first**, in `ui/index.test.tsx`: the `lands` table (:86) gains `'hype-up': "the quoting post's character"`;
the Gimmick words test (:113-122) gains Hype-Up beside Publicity Tour (`36 hours … earns from … 10% higher`), Sugar
Coat (`a week … Salty or Pepperoni`) and Last Word (`a week … refused before it is written`); `cardsUi` keys equal
the rules' keys and every card has art (:126 on); each `status` is at most six words.

## Task 8. The export round-trips the new rows (SQL, e2e)

Model: haiku

**File:** `supabase/tests/e2e/0003-export.ts`. Its fixture (:85-160) gains a test card kind that is a cast card on a
character with an earn that has a `group`, a use card with `{"kind": "noQuote"}`, a play of each, and a post written
before the no-quote play that quotes its post. The round trip compares them like every other row. The import writes
as a replica, so the guard does not fire on the imported quote; the test asserts the quoting post is there.

## Last. The full build, the pictures and the final review

- `npm run typecheck` and `npm run build:ci` are green, with the build's tail in the PR.
- Pictures in the PR: the three cards' faces at every card size; a post under Last Word with no Quote link beside one
  with it; the composer showing the refusal; Hype-Up's mark and Lens on a postbit; Sugar Coat's Lens.
- The final reviewer reads the Review focus below.

## Ways out

- **Sugar Coat** and **Last Word** end at their time, a week, or by an admin's end (`reverse_card`).
- **Hype-Up** ends at 36 hours, or by an admin's end. It only raises an earning, so the character it is on has
  nothing to get out of.
- **A cast Sugar Coat turns away** is refused before it is written; the caster keeps the card and the money.
- **A quote Last Word stops** is refused before it is written, with the draft kept. The reply without the quote is
  always possible, and the refusal says so and says when quoting comes back.
- **A post under Last Word cannot take a back** until the Last Word ends, and the refusal names the time. **A post
  with a back cannot take Last Word** until the back springs, ends, or its setter takes it back, which is one press
  in the back's Lens, by the same player.
- **A post that already quoted** a post now under Last Word stays as written and can still be edited.

## The masks

- **The stopped quote's refusal** is computed from the new Act's own body and target and from the quoted post's
  public plays. It is the same sentence for every writer, the quoted post's author included, and it reads no owner.
  Its work depends only on the writer's own body (whether it holds `[quote=`), so its timing says nothing about anyone
  else.
- **The back and the no-quote** each refuse on a public fact: a card back and a face-up play are both drawn for
  everyone. The refusals do the same reads whatever card is face down.
- **Hype-Up's boost** is applied only inside settlement, which shows each settled window's sums, and in the target's
  own live estimate, from a play that is a public Act on the target's own character. The caster gets no answer that
  depends on what the target earns, on its class, or on who owns it.
- **Hype-Up on one's own mask is not refused**, so no refusal differs with who owns the target.
- **"The larger applies"** is decided inside settlement from the plays' public numbers; the target's log names the one
  card that paid.
- **The staff reply** to a stopped post is written as a plain reply for a public reason, the post's Last Word.
- No Realtime event is added: Hype-Up goes out on `reach` as any character play does (`act/core.ts:53-61`), and a
  refused quote writes and sends nothing.

## The layers

- **Engine:** the earn on a cast card and its `group`; the `noQuote` effect, its guard, its two refusals and their
  words; `quotedActs` and the walk's `quotes`; the Quote link's absence; `gimmickWords`. The engine names no card: a
  refusal takes the card's name from the catalog (`card_kinds.name`, `CardRules.name`).
- **Instance:** the three cards' rules, `publicity.ts`, the machine's slots, the art and every word in `CardUi`.
- **The interface** is `CardRules.gimmick` for the rules and `CardUi` for the screens, as for every Gimmick. The
  boundary check (`tools/check-engine-boundary.mjs`) holds throughout.

## A busy instance

- **Every post, spin and edit** runs the guard: one case-insensitive match of `[quote=` over its own body (at most
  `postMaxLength`, 20,000 characters). Only a body that holds one is walked, once, as the search trigger already
  walks every body; then one index probe (`acts_layers`) per distinct quoted Act, bounded by how many quote tags fit
  in a post. An edit that hits walks the post's current body once more. A thread of five thousand posts adds nothing:
  the guard reads only the quoted posts.
- **A thread page's read** gains nothing: the Last Word play is one of the post's plays the page already reads for
  its marks, and the Quote link is decided from them in the browser.
- **`place_cast` and `place_set`** each gain one probe of the plays or backs on one post.
- **Settlement** reads the cast Earn plays through the same `earn_up` window as the use cards' (a creation-time range
  of the longest Earn `lasts`), and the grouped pass costs each earning the Earns on its own character and post, as
  today: at most one live play per Earn card per character.
- **Hype-Up** writes one Act and one `play_reach` row per play, as Glitter Bomb does.

## Decided in planning

- **A cast card carries the earn in `CardRules.gimmick`**, allowed only for an earn on a card that reaches a character
  alone, in place of a new field: the readers (`reach_effects`, the Lens, `settle.ts`) then need no second path.
- **"Do not add; the larger applies" is a `group` on the earn**, which Publicity Tour and Hype-Up share. Heat Magnet
  and Class Clown have none and still add, as shipped. A tie goes to the earlier play.
- **One live Hype-Up per character** (stack 1), so two friends cannot both hype a third.
- **A Mod Bot is never offered Hype-Up, and a staff cast of it is refused**, because the settlement leaves staff Acts
  out and the Lens would claim a boost nobody is paid. **Hype-Up on a Mod Bot is allowed and gives nothing**; the
  card's words say so. A refusal there would add a read to every back's spring (`spring_facts`' even work).
- **Sugar Coat's slot is hidden at 300**, as Main Event's, and it is pulled from the Booster's rare share.
- **What "quotes" means for Last Word:** the post's `quoting` target, or a real quote of the post anywhere in the
  body, at any depth, in a new post, a thread's first post, a spin's words or an edit. Depth is "any" because a real
  quote wrapped in a quote of another post would otherwise walk through. A counterfeit or bare quote and copied words
  are the fiction's and are not stopped. **A spin from the post is not a quote.**
- **An edit is refused only for a quote it adds**, so a post that quoted before the card can still be edited.
- **The author is refused like anyone** ("the same for everyone").
- **The guard is one trigger on `acts`**, where the other guards are, so no writer of a body can miss it.
- **A Mod Bot's reply to a stopped post lands as a plain reply**, so no paid answer is lost.
- **`post()` takes no new lock.** A quote already past the guard when a Last Word commits lands; the lock order is
  left as it is.
- **The refusal names the post by its number, never its author**, since Part 3's Whodunnit? hides an author.
- **The Quote link is left out, not disabled**, on a post under a live Last Word.
- **Last Word lasts a week and is sold at 150; Hype-Up is sold at 150**: the notes' week, and the uncommons' price.

## Review focus

- **A quote that slips the guard.** Every path that writes a body is a `post`, `spin` or `edit` Act; check that none
  writes a quote some other way (an apology's spin, a staff thread, `post_update`), and the two parsers agree on what
  a real quote is for the fixtures at the edges: unclosed, past the depth limit, inside a link.
- **The guard and the walk at scale.** A 20,000-character body of nothing but quote tags, and an edit of one: the
  walk stays linear and the probes are one per distinct Act.
- **The race the plan accepts.** A quote read as allowed while a Last Word is being laid lands after it. Confirm it
  is only that, and that a back and a Last Word can never both be live on one post (both paths hold the post's row).
- **Acts an instance already holds.** No row changes. A post that quotes a post later put under Last Word is still
  drawn with its quote, can be edited, and round-trips through the export.
- **Earn's edges with a cast.** A Hype-Up sprung from a back onto a quoter; one on a character whose class changes
  mid-window; one ended by an admin; two groups on one earning; a group across a character play and a post play.
- **The estimate and the settlement agree** on a Hype-Up cast inside the open window by another player, and the
  target's estimate never counts it twice when the target's own Publicity Tour is up.
- **A mask.** The target's log shows `Hype-Up added` and the caster's shows nothing of the target's. Check that no
  line, alert or Realtime payload to the caster carries an amount, and that the refusal for a stopped quote is byte
  for byte the same for the author, another player and a staff character.
- **The Lens's claim.** While a character's own Publicity Tour is up, Hype-Up's Lens still says "Earns 10% more" and
  adds nothing. The card's description says so; whether the Lens should is the owner's to say.
- **The link's return.** The Quote link comes back when the Last Word's time passes on a page left open, without a
  reload, or the first press after that is refused by nothing.
