# Cards beyond a post: plan (Part 2)

Record, written 2026-11-01. Part 2 of `docs/plans/2026-11-01-card-mechanic-design.md`: its sections 7 and 8, with the
masks, the busy instance and the ways out that go with them. It is built by one build session in one PR, after Part 1
(`docs/plans/2026-11-01-card-plays-plan.md`) has merged, and it starts from `main` with Part 1's names. The PR says
`Closes #34`, and it links #132 without closing it.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added. The
engine/instance boundary check holds: the board reach is proven by a test card in the engine's tests, and nothing in
`engine/` or `supabase/` names Glitter Bomb or Main Event. One migration, `supabase/migrations/0055_card_reach.sql`, is
committed with its SQL test, `supabase/tests/0060-card-reach.sql`, against Postgres on localhost. If Part 1's numbers have
moved by the time this is built, these take the next free numbers.

## Task 1. `CardTarget` as a sum type (engine)

**Files:** `engine/rules/cards.ts`, `engine/rules/types.ts` (`Settings`), `engine/rules/instance.ts`, `engine/ui/cards/land.ts`;
tests `engine/rules/cards.test.ts`, `engine/rules/instance.test.ts`, `engine/ui/cards/land.test.tsx`.

- `Reach = 'post' | 'character' | 'thread' | 'board'`.
- `CardTarget` is one of:
  - `{ reach: 'post', act, kind, length }`
  - `{ reach: 'character', character }`
  - `{ reach: 'thread', thread }`
  - `{ reach: 'board', board }`
- Every existing reader of `target.act` and `target.length` narrows on `reach`. Whoops!'s `playPrice` narrows to a post.
- `CardRules` gains `reaches?: readonly Reach[]` (`['post']` unless said) and `lasts?: Span`, its time beyond a post.
- `CardEffect` gains `reach`. `effectsOnTarget` holds the target's own effects and every live effect above it (board, then
  thread, then character, then post, for a post).
- `landsOnPost` becomes `landsOn(rules, target, effects)`: the reach must be one the card lists, its stack counts only
  effects on that same target, and a second live board card on a board is refused ("this board already carries a board
  card until <time>").
- `Settings` gains:
  - `reachRarity: { character, thread, board }`, each a `Rarity`
  - `reachLasts: { character, thread, board }`, each a `Span`
- `instanceProblems` refuses each of these, naming the card:
  - a card whose reaches go beyond its rarity's
  - a card beyond a post with no `lasts`
  - a `lasts` over its reach's bound
  - a Set that lists a reach other than a post
  - missing or ill-formed `reachRarity` or `reachLasts`

Tests first:
- Each refusal, driven red by an instance holding it.
- A post effect sees the board's, the thread's and its author's effects in that order.
- A second board card is refused while one is live, and not after it ends.

## Task 2. Where a play beyond a post lands (SQL)

**Files:** `supabase/migrations/0055_card_reach.sql` (new); test `supabase/tests/0060-card-reach.sql` (new).

- `card_kinds` gains `reaches text[]` and the `lasts` beyond a post. `seed_instance` writes them and holds the same rarity
  table check as `instanceProblems`, reading the `reachRarity` setting.
- `play_reach` (play pk references acts, reach, character, thread, board, ends_at):
  - exactly one target column, matching `reach`
  - written with the play's Act, and never updated
  - indexes on (character, ends_at), (thread, ends_at) and (board, ends_at)
- A card Act beyond a post:
  - a character play: in the thread it was played in, with `target_act_id` the post whose postbit took it, so "Go to
    post" and a spin's ORIGIN box still have a post
  - a thread play: in that thread, with `target_act_id` its first post
  - a board play: in The System's announcements thread, with `target_act_id` null, which the target check allows for a
    `card` whose payload's `reach` is `board`
- `play_card` takes `reach` and the target's id:
  - checks the card lists the reach
  - locks the target's row (the character, the thread or the board)
  - holds the stack against that target's live plays, and for a board, one live board card
  - writes `play_reach` with `ends_at = now() + least(card lasts, reachLasts)`
  - casts beyond a post still run Part 1's ward and trap checks only on a post target
- `card_target_reach(reach, id)`, the counterpart of `card_target` for the rules, with the effects above.
- `effects_above(characters uuid[], thread uuid, board uuid)` gives the live plays on these, public, in one query, for a
  page. It is chunked the way `cardsOnMany` is, and bounded by its arguments.

Tests first:
- A character play is refused for a card that does not list it.
- A second board card while one is live is refused, even with two arriving at once.
- `play_reach` refuses UPDATE.
- `effects_above` returns only live plays, and costs one index probe per character asked.
- A play beyond a post on a staff character lands.

## Task 3. The act function and data (Edge Function, engine, web)

**Files:** `engine/rules/actions.ts` (`playCard` takes a `reach`), `supabase/functions/act/core.ts`,
`engine/ui/data/api.ts` (`effectsAbove`), `engine/ui/data/fake.ts`, `web/src/data/supabase.ts`; tests beside each.

- `playCard`'s request names its reach and target. `needsTarget` reads `card_target_reach`.
- `effectsAbove` is one batched read.

Tests first:
- A request with a reach the card lacks is refused before SQL.
- `effectsAbove` with many characters chunks and joins its answer.

## Task 4. Marks on postbits, thread heads and banners (engine)

The glass for marks, ghost marks and the Lens; the board, in the house style, for what an effect does to a 2003 post.

**Files:** `engine/ui/postbit/Postbit.tsx`, `engine/ui/thread/Thread.tsx` (`prepare`), `engine/ui/board/Board.tsx`,
`engine/ui/cards/Marks.tsx`, `engine/ui/cards/PlayActions.tsx`, `engine/ui/cards/Effects.tsx` (`PostEffects`, wrap
order), `engine/ui/cards/types.ts` (`EffectProps.reach`); tests beside each.

- `prepare` reads `effectsAbove` once for the page's distinct authors, its thread and its board.
- A postbit draws the marks of its character's live plays, and a ghost mark while a character card is armed.
- The thread's head draws the thread's marks and ghost. The board's banner draws the board's.
- Every mark opens the Lens, with React and Spin as a post play's does.
- `PostEffects` wraps a post's words in the board's effect, then the thread's, then the author's, then the post's own.
- An effect's `ends` shows in its Lens line.
- A live play beyond a post joins the marks where its target shows, and never reorders them.

Tests first:
- One `effectsAbove` read per page however many posts it holds.
- The wrap order.
- Ghost marks for a character card on every postbit in view and nowhere else.
- An ended effect stops drawing at its `ends` without a reread.

## Task 5. Main Event's pins on the board's list (SQL, engine)

**Files:** `supabase/migrations/0055_card_reach.sql` (`pinned_threads(board)`), `engine/ui/data/api.ts`, `web/src/data/supabase.ts`,
`engine/ui/board/Board.tsx`; tests `engine/ui/board/Board.test.tsx` and `supabase/tests/0060-card-reach.sql`.

- `pinned_threads(board)` gives the board's threads with a live thread play whose card's rules ask to pin. The engine's
  card interface gains `pins?: true`, seeded on `card_kinds`.
- The list draws pinned threads above page 1's threads, each with its mark, without taking a page's slots or moving the
  pager's numbers. A pinned thread is still listed in its bump place too, unless it is on the same page.
- The pin ends at its play's `ends_at`.

Tests first:
- A pin shows above page 1 and not above page 2.
- The pager's total is unchanged.
- An ended pin is gone.
- The read is one index probe of the board's live thread plays.

## Task 6. Settlement beyond a post (engine)

**Files:** `supabase/migrations/0055_card_reach.sql` (`settlement_input`), `engine/rules/settle.ts`; test `engine/rules/settle.test.ts`.

- A play beyond a post has no target post to outdraw. Its reactions pay its caster by class as any card's do, and class
  rules that read a card's target post pass it over.
- A character play does not count as a card landing on that character's posts.

Tests first:
- A Glitter Bomb's reactions pay its caster.
- A Heel's Salty character card earns no outdraw bonus.
- The existing fixtures are unchanged.

## Task 7. Glitter Bomb and Main Event (instance)

**Files:** `instances/divided-world/cards/glitter-bomb.ts`, `main-event.ts` (new), `instances/divided-world/cards/index.ts`,
`instances/divided-world/settings.ts` (prices, `reachRarity`, `reachLasts`), `instances/divided-world/ui/cards.ts`,
`instances/divided-world/ui/glitter-bomb/` (new: its `Effect`); tests beside each.

- **Glitter Bomb:** uncommon, Pepperoni, Cast, reaches `['character']`, lasts 7 days. Price 1.50. Its effect sparkles the
  character's posts. Reduced motion holds the sparkle still. The words stay readable at the house style's contrast with
  the sparkle on.
- **Main Event:** rare, Sweet, Cast, reaches `['thread']`, lasts 1 day, `pins`. Price 3.00.
- `reachRarity`: character uncommon, thread rare, board legendary. `reachLasts`: character 7 days, thread 1 day, board
  1 day.

Tests first:
- The instance passes `instanceProblems`.
- Glitter Bomb under reduced motion draws no animation.
- The sparkle keeps the post's text contrast (`engine/ui/contrast.ts`).

## Task 8. Stories and shots for the owner's word

**Files:** stories beside Tasks 4, 5 and 7, and shots under `docs/research/2026-11-01-card-reach-shots/` (new).

Postbit marks and ghosts, a thread's head, a board's banner with the engine's test board card, Main Event's pinned row,
and Glitter Bomb, still and moving, at 1440 and 390, light and dark. The PR waits on the owner's word on them.

## Last. The full build and the final review

`npm run typecheck` and `npm run build:ci`, with output. The final reviewer reads this plan's Review focus.

## Ways out of the states this touches

- A character, thread or board effect ends at its `ends_at`, at most its reach's `reachLasts`.
- A pin ends with its play.
- One board card at a time ends with its time, so a board is never held by a card past a day by default.

## Review focus

- `effects_above` runs on every thread page. Check its cost at a busy instance's scale (a page of many authors), and that it
  is one read.
- A character effect must never be drawn on, or computed from, another of the player's masks. Check that nothing in
  `play_reach` or `effects_above` joins `characters.owner`.
- The relaxed target check for a board play. Check that no other kind can use it, and that spins, the log and the digest
  handle a card Act with a null `target_act_id`.
- Two board cards arriving at once on one board. Check that the lock holds it to one.
- Acts an instance already holds: every existing card play reads as a post reach. Check that an export from before 0055
  round-trips.
