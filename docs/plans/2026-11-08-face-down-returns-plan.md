# Face-down returns: plan

Record, written 2026-11-08. The plan for `docs/plans/2026-11-08-face-down-returns-design.md`. One build session builds
it in one PR from `main`, after the design's PR is merged.

Every task is test first: name the test, record its red run, then write the code. No check is added.

**Migrations.** One migration, `NNNN_face_down_returns.sql`, taking the next free number in `supabase/migrations/`
(0144 as this is written; `docs/plans/2026-11-08-quote-conditions-plan.md` also claims the next free number, so take
whichever is free when the build starts). Its SQL test takes the next free number in `supabase/tests/`. It replaces
one function, `card_held`, copied from its latest definition, found with `grep -l "function card_held"
supabase/migrations/*.sql` (0142 as this is written). Its signature, grants and mode (security invoker) stay as they
are.

**The layers.** Everything here is the engine's except Task 5's copy, which is Divided World's. The boundary check
holds.

## The words this plan uses

- A back **springs** where its card is a Move (play `cast`) or a Gimmick with a trap. The SQL already says this in
  `my_card_ledger` (0142: `k.trap is not null or k.play = 'cast'`) and the fake in `recordCard`'s `springs`
  (`engine/ui/data/fake.ts`, the set path).
- A back **comes back** when its time (`face_down.ends_at`) has passed, nothing sprang it, no admin ended it
  (`card_ended(play)`), its setter is a player (`account` not null), and its card springs.

## Task 1. One predicate for a back that can spring (engine)

Model: inline

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/ui/data/fake.ts`.

- `everSprings(rules: Pick<CardRules, 'play' | 'trap'>): boolean` in `cards.ts`: `rules.trap != null || playOf(rules)
  === 'cast'`, with a comment that names the SQL twin in `my_card_ledger`.
- Test first: a Move, a cast Gimmick, a visit Gimmick and a trapless Gimmick (the `bluff` fixture in `cards.test.ts`),
  true, true, true, false.
- The fake's set path computes `springs` through it rather than inline.

## Task 2. The hand counts a card that came back (SQL)

Model: sonnet

**Files:** the migration (`card_held`); a new SQL test `supabase/tests/NNNN-face-down-returns.sql`.

- `card_held(who, card)` becomes bought, pulled and caught, plus the backs that came back, less played. The added term
  counts `face_down f join card_kinds k on k.key = f.card` where `f.account = who`, `f.card = card`, `f.ends_at <=
  now()`, no `spring` Act names `f.play` (`s.kind = 'spring' and s.payload ->> 'set' = f.play::text`, as `my_face_down`
  reads it), `not card_ended(f.play)`, and `k.trap is not null or k.play = 'cast'`. It stays `language sql stable`,
  security invoker: under a signed-in caller the `own` policy on `face_down` limits the rows to theirs, as `card_ledger`'s
  does. Check that `card_ended` can be called under the invoker (its grants); if it cannot, say so in the PR and stop
  rather than make `card_held` a definer.
- The header says what the design's section 6 says: computed, not written, so nothing is timed from the card.
- Tests first, in the new file, each from a fresh fixture as `supabase/tests/0135-face-down-moves.sql` builds them (a
  `face_down` row inserted with `ends_at` in the past stands for a back whose time has passed):
  - a Trap Card set and ended unsprung counts 1 more than before the set's time passed, and `my_cards` shows it;
  - a Bluff ended unsprung counts nothing back;
  - a Move ended unsprung counts 1 back;
  - a sprung back counts nothing back, and a Trap Card that caught still counts the caught card once;
  - a back an admin ended (`card_end`) counts nothing back;
  - a live back (`ends_at` in the future) counts nothing back;
  - a staff back (`account` null) changes no player's count;
  - signed in as another player, `card_held(setter, card)` reads 0, as it does today;
  - `set_card` with the card that came back succeeds on the same post, and the hand is one less again.

## Task 3. The fake counts it too (engine)

Model: sonnet

**Files:** `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

- The fake's hand (`me().cards`, read by `myCards` and by every play that checks a card is held) gains the same term:
  the caller's entries in `faceDown` whose `endsAt` has passed, `sprung` null, not ended by an admin (`reversedPlays`),
  and whose card `everSprings`. Count it where the hand is read, not by writing to `cards` at the end, so the fake has
  no timer either. One function answers "how many of this card does this account hold", used by `myCards` and every
  held check.
- Tests first: Task 2's cases that the fake can express (Trap Card back, Bluff spent, sprung, admin-ended, live, re-set on
  the same post), with the clock moved past `setLasts` as the fake's other timed tests move it.

## Task 4. The setter's log says where the card went (engine)

Model: sonnet

**Files:** `engine/ui/log/lines.ts`, `engine/ui/log/lines.test.tsx`.

- `setEndRows`, the unsprung branch, uses the setter's character (`own`, through `nameOf`) and `everSprings` of the card's
  rules:
  - springs: `what` is `` `${card} came back to your hand` ``; `details` are
    `` [`${name}'s face-down ${card} on `, on, ' never activated, and was removed from the post. It came back to your hand.'] ``;
  - a Bluff: `what` is `` `${card} ended` ``; `details` are
    `` [`${name}'s face-down ${card} on `, on, ' never activated, and was removed from the post. It is used up.'] ``;
  - a back whose play is in `data.log.ended` (an admin ended it) says neither: it keeps the "ended" row `endedRows`
    writes and adds no `setEnded` row, so the log never says a card came back that did not. Confirm in the test that
    `my_cards_ended` names a `set` play; if it does not, the unsprung row for such a back says
    `' never activated, and was removed from the post. An admin ended it, and the card is not returned.'`, read from the
    `card_end` Act, and the PR says which was found.
- The set row's tail (`details`'s last part) becomes:
  - a Bluff (`e.springs === false`): `'. It never springs, and ends by itself, used up.'`;
  - waits: `` `. It waits ${waits}, and comes back to your hand if none comes.` ``;
  - otherwise: `'. It springs once, or comes back to your hand.'`
- Tests first: each wording above, and the existing #136 F3 test ("a Bluff set face down says it never springs") with
  its new words.

## Task 5. The words a setter and a reader see (engine, instance)

Model: haiku

**Files:** `engine/ui/cards/land.ts` (`endsWords`), `engine/ui/cards/PlayForm.tsx`, their tests;
`instances/divided-world/ui/cards.ts`; `instances/divided-world/guide/strategy-guide.md`;
`instances/divided-world/settings.ts` (the comment on `setLasts`).

- `endsWords(lasts: Span, springs: boolean)` in `land.ts`, with `n` and `unit` as today (`${lasts.count}
  ${lasts.unit}` plus `s` unless the count is 1):
  - springs: `` `If nothing springs it in ${n} ${unit}, it comes back to your hand.` ``;
  - not: `` `It ends by itself in ${n} ${unit}, and is used up.` ``
- `PlayForm.tsx` line 272 passes `everSprings(rules)` of the card being set. Its test (find it with `grep -rl
  "data-kb-ends" engine/ui`) asserts both sentences.
- `instances/divided-world/ui/cards.ts`, replacing only the named sentence in each description and keeping the
  template that writes the span:
  - Trap Card: `It springs once, or ends by itself after ${…}.` becomes
    `It springs once, or comes back to your hand after ${…} if that card never comes.`
  - Hall Pass: `It springs once, or ends by itself after ${…} if no visit comes.` becomes
    `It springs once, or comes back to your hand after ${…} if no visit comes.`
  - Bluff: `It does nothing, and ends by itself after ${…} with nothing revealed.` becomes
    `It does nothing, and ends by itself after ${…} with nothing revealed, used up.`
  - `setMoveWords`: `…at no further cost, using up the card.` becomes
    `…at no further cost, using up the card. If nobody quotes it in time, the card comes back to your hand.`
  - Any test in `instances/divided-world/ui/` that holds the old sentences is updated to the new.
- `strategy-guide.md`, line 101's bullet, append: ` A card set face down that never springs comes back to your hand
  when its week is up, except a Bluff, which is used up, so setting a card costs you only the time it is out of your
  hand.` (The guide is committed glass copy; the owner approves it in review.)
- `settings.ts`, the comment on `setLasts` becomes: `/** A card set face down waits a week; if nothing springs it, its
  card comes back to its setter's hand, except a card that can never spring (Bluff), which is used up. */`

## Review focus

- A card that came back is counted at every place a hand is counted. `card_held` is the one place in SQL (0139's header
  says so). Check that nothing spends or shows a card by reading `card_ledger` directly instead, and that the fake has no
  second count.
- Under a signed-in caller, `card_held` must stay security invoker and read no other account's `face_down` row. A
  definer added to reach `card_ended` would let a caller count another account's backs.
- The cost at a busy instance's scale: `card_held` now reads the setter's `face_down` rows on every hand read and every
  spend (`face_down_account` indexes `account`). The rows grow with backs ever set by the account. Say what the read
  costs for an account with thousands of ended backs, and whether an index on `(account, card)` is needed.
- No write, event or alert happens at a back's end, so nothing is timed from which card it was.
- The log never says a card came back when it did not: a Bluff, a staff back, an admin-ended back, a sprung back.
