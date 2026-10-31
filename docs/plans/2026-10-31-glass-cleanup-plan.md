# The glass cleanup: plan

Record, written 2026-10-31. The plan for `docs/plans/2026-10-31-glass-cleanup-design.md`, built by one build session
in one PR. The PR says `Closes #85`, `Closes #88` and `Closes #90`. It ticks the items it builds on #86 and #89 and
leaves those two issues open for the rest.

Every task is test first: the test named, its red run recorded, then the code. Every check that is added comes with
its poison. Engine or instance is said for each part; nothing in `engine/` names Divided World.

## Task 1. Back to the board in every state of a page with no menu bar (#90)

**Layer:** engine (`engine/ui/log/Settlement.tsx`); web (`web/src/App.tsx`).

**Files and functions:**
- `SettlementScreen` draws Back to the board, the ready state's link, around every state. The page owns the link,
  not `Summary`, so loading (`aria-busy`), failed, empty and signed out each carry it.
- Esc keeps working in every state.
- Export `NO_MENU` from `App.tsx`, or move it beside the routes it names, so a test can read it.

**Tests first:**
- In `engine/ui/log/Settlement.test.tsx`, each of the four states renders a Back to the board link with the ready
  state's href.
- In `web/src/App.test.tsx` (or beside it), for every path in `NO_MENU`, the page is rendered in its loading, failed,
  empty and signed-out states against the fake, and each has a link named Back to the board.

**Poison:** today's empty state (`Nothing has settled for you yet.` with no link). Record the red run.

**Way out:** this task is the way out.

## Task 2. A retired character's player washes its splat clean (#85)

**Layer:**
- engine: the migration, `engine/ui/cards/Effects.tsx`, `engine/ui/player.tsx` and `engine/ui/data/fake.ts`;
- instance: none. Whoops! reads `reader.author` as it does today.

**Files and functions:**
- A new migration, `0038_retired_author_washes.sql`. It redefines `save_effect_state(who, through, on_play, state)`
  without `played_by` for the one case where `through` is owned by `who`, has debuted, and is the post's author.
  - A retired `through` is then accepted.
  - A waiting one, a character `who` does not own, and a non-author are refused, with today's words.
  - Pin `search_path` ending in `pg_temp`, as today.
  - Its header says why it skips `played_by` and that `effect_state` is not an Act.
- In `engine/ui/player.tsx`, a list beside `actingCharacters` of the player's debuted characters, retired among them
  (e.g. `writingCharacters`). Name it for what it is: the masks whose own posts the player answers for.
- In `engine/ui/cards/Effects.tsx`, `author` is found in that list. `caster` stays on `actingCharacters`.
- In `engine/ui/data/fake.ts`, `saveEffect` accepts a retired author the same way.
- `releaseEffect` and every other path keep refusing a retired character.

**Tests first:**
- A pgTAP file, `supabase/tests/0043-retired-author-washes.sql`:
  - a retired author's save lands and is read by another reader;
  - a retired non-author is refused;
  - another player's retired character is refused, with the same words and code as any character they do not own;
  - a waiting character is refused;
  - no Act is written.
- `engine/ui/cards/Effects.test.tsx`, or the whoops `Effect.test.tsx` against the fake: the player of a retired
  author washes to the clean share, and a second reader loads the layer clean.
- The fake and the adapter agree, through the contract test both run, if one covers `saveEffect`.

**Masks:** the refusal for a character the caller does not own must not differ between retired and unretired
characters. The pgTAP test asserts it.

**Way out:** this task is #85's way out. Note it in the screens engine plan's ways-out table only if that table is a
current document; a record is left as written.

## Task 3. The breakdown's tests (#88)

**Layer:** engine (`engine/ui/log/Log.test.tsx`), against the boards fixture's `12-log` moment or a fixture of its
own.

**Tests first.** These are tests of code already built. Each is driven red by a scratch break of the code it covers,
and the break and the red run are recorded in the PR:
- Keyboard: Tab to Show posts, Enter opens it, and focus stays on the control. Esc on the control closes it and focus
  stays there. Open it again, Tab into the breakdown, and Esc there closes it with focus back on the control.
  - Break: drop the focus return in `Breakdown`'s Esc handler.
- Each reason's shares, as drawn, add up to the reason's exact total as drawn, for every reason of the open
  settlement.
  - Break: drop the last share's remainder.
- The two sentences: "Each reason's total is exact. It is split across your posts by how the live estimate valued
  their reactions." and, for a reason with no post, "Scored over the whole window, not post by post."
  - Break: delete each push.

## Task 4. The log's untested lines and the stuck cursor (#89 F2, F3, F4)

**Layer:**
- engine: `engine/ui/data/log-page.ts` and `engine/ui/log/lines.ts`;
- web: `web/src/data/supabase.ts`.

**Tests first:**
- F2: in `web/src/data/supabase.test.tsx`, a `my_ledger` row with `shares_kept: false` maps to `sharesKept: false`.
  - Poison: `sharesKept: true`.
- F3: in `engine/ui/log/lines.test.tsx`, a pre-0034 settlement's row says "This settlement was made before posts were
  kept with it.", and a silent Turn says "A silent Turn: no one else was told."
  - Poison: delete each push.
- F4: in `engine/ui/data/log-page.test.ts`, a read with `LOG_ROWS` ledger rows at one `ends_at`. Two cursors must
  never repeat: the next cursor is strictly older than the one the page was read with, or the call throws an error
  that names the full instant.
  - Poison: today's `cutLog`.

**Code:** `cutLog` must never return `before` equal to the cursor it was given. The build session picks between two
fixes and writes the choice in `log-page.ts`'s header:
- a source that fills `LOG_ROWS` at a single instant is read again at that instant without the limit;
- or the page fails loudly.

The first is preferred, because a failure there is itself a dead end. Weigh it at a busy instance's scale.

## Task 5. The summary's first load is not lost (#89)

**Layer:** engine (`SettlementOnLoad`, `engine/ui/log/Settlement.tsx`).

**Code:** if the component unmounts, or `active` turns false, while its log read is in flight, nothing is marked seen
for this load (`seenThisLoad`). The next board page asks again.

**Tests first:** in `Settlement.test.tsx`, leave the board page while the read is held, then return. The summary
opens.
- Poison: today's code, where the summary never opens.

The narrower read #89 also names is not taken. It costs one page of the log once a load. Note it on #89 as still open.

## Task 6. Whoops!: true words and no lost strokes (#86)

**Layer:** instance (`instances/divided-world/cards/whoops/Effect.tsx`).

**Code:**
- The no-room report reads "This layer has no room for more strokes to save. What you wash from here shows on your
  screen only, but washing it clean still clears it for everyone."
- On unmount with a save in flight, `flush` is not skipped. The strokes made since are sent once the save in flight
  settles, from a promise the unmount does not cancel. Nothing writes to state after unmount.

**Tests first:** in `Effect.test.tsx`:
- the bound's report carries the second clause;
- the author makes strokes while a save is held, unmounts, then the held save resolves; a second save carries the
  later strokes.
  - Poison: today's skip.

## Task 7. The screens price cards as the server does (#86)

**Layer:**
- engine: the migration, `seed_instance` and `engine/ui/cards/faces.ts`;
- web: `web/src/data/supabase.ts`.

**Code:**
- Migration `0039_card_economy.sql`.
  - `screen_settings` adds `cardEconomy`: the live economy row restricted to the keys the cards read. These are each
    `card_kinds.price_setting`, plus the keys in a new `card_kinds.reads text[]` that `seed_instance` writes from
    each card's `reads`.
  - The classes' numbers stay out.
  - Its header says why a price is not a private fact.
- `supabase/functions/_shared/seed.ts` carries `reads` per card.
- The web adapter merges `cardEconomy` over the compiled `economy` before `facesOf` and the play form price.
  - A key the view lacks falls back to the compiled one, as `screen_settings` already does.
- The fake reads the same.

**Tests first:**
- pgTAP: `screen_settings.settings -> 'cardEconomy'` holds each card's price and reads, follows an update to the
  economy row, and holds no class key.
  - Poison: the whole economy.
- In `supabase.test.tsx`, a tuned price in `cardEconomy` shows on the Vending Machine's face and on the play form.
- In `seed.test.ts`, `reads` is carried.

**Masks:** no private fact. Every reader gets the same numbers.

## Task 8. The cards' screens speak to a screen reader (#89 P2-1, P2-2, P3-2)

**Layer:**
- engine: `engine/ui/vending/Vending.tsx` and `engine/ui/cards/PlayForm.tsx`;
- instance: `whoops/Effect.tsx`.

**Code:**
- The purchase's outcome, and the Whoops! report and uncovered lines, write into a polite live region that is
  mounted with the component and empty until it speaks, as `HoldView.tsx`'s status line does.
- The play form's message sets `maxLength={MESSAGE_MOST}` and keeps the code-point slice.
- The counter is announced politely, at most on crossing set thresholds rather than on every key.
- The Vending Machine loses `kb-vending-list` and `kb-vending-item*`, in markup and CSS.

**Tests first:**
- Each live region is in the DOM before its message and receives it afterward.
  - Poison: today's conditional mount.
- The message field carries `maxLength`, and pasting 210 characters leaves 200 and announces the limit.
- No element or rule names `kb-vending-list` or `kb-vending-item`.

## Last. The full build, the poisons in the PR, the final review

- `npm run build` and `npm run typecheck`.
- The PR lists each poison's red run, ticks the items built on #86 and #89, and comments on #89 that the narrower
  first-load read is still open.
- Plan gaps and design questions are listed as the build-session skill says.

## Ways out of the states this touches

| State | Way out |
|---|---|
| A settlement page in any state | Back to the board, and Esc |
| A splat on a retired character's post | Its player washes it clean through the retired mask; a reader's own scrub holds on their screen; an admin's restore still works |
| Show older lines at a full instant | The page moves on, never repeats |
| A first-load summary whose read was dropped | It is looked for again on the next board page |

## Review focus

- 0038 skips `played_by` for one path. Does any other refusal (the waiting check, the owner check) now read differently
  between a retired and an unretired mask, to anyone but its own player?
- Whether a retired author's save can now be reached through any other effect or card than Whoops!, and whether that is
  what each card means.
- 0039 against an instance seeded before it: `card_kinds.reads` is empty until a re-seed, so `cardEconomy` must still
  hold each price, and the screen must fall back cleanly.
- `cutLog` at a busy instance's scale: a read again without the limit is unbounded at one instant. Say how large that can
  grow.
- Task 6's deferred flush after unmount: two tabs of the same author, and a save that fails after unmount.
