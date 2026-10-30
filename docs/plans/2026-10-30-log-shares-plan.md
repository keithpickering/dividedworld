# A settled log line, expanded into its posts: plan

Record, written 2026-10-30. The plan for `docs/plans/2026-10-30-log-shares-design.md` (issue #25), and with it the
web plan's Task 8 (the log and the settlement's summary) and the cards plan's Task 6 (the log's card lines), which
waited on it. It is Part 4 of `docs/plans/2026-10-30-glass-build-plan.md`, in two halves:

- **4a, the shares (Tasks 1 to 3):** engine and database only. It starts once that plan's Part A
  (`0033_glass_preferences.sql`) is merged, because both edit `supabase/tests/0005-default-deny.sql`.
- **4b, the log (Tasks 4 to 6):** the screens, in the glass. It starts once Part 3 (the cards) is merged, so the log
  is built once with its card lines, on the glass's page shell and the board match.

Each half is one build session and one PR, carried out task by task, tests first, each red run recorded
(`.claude/skills/build-session/SKILL.md`). The migration is `0034_ledger_shares.sql` and its test
`0040-ledger-shares.sql`. A build session that finds either number taken on main takes the next free one and says so
under `Plan gaps`.

## The layers

Engine: the shares' arithmetic (`engine/rules/`), the migration and its view, the settlement job, `KayfaApi.log`, the
fake's ledger and `engine/ui/log/`. Instance: nothing new. The words a share's quadrant is named by are the instance's
`InstanceUi.quadrantLabels`, and a reason's words are its `reasonWords`, both already carried by `InstanceUi`.

## Tasks

### Task 1. The shares, as a pure function

- `engine/rules/settle.ts`: new export `shareEntries(input: SettlementInput, instance: Instance, entries: readonly
  LedgerEntry[]): Share[]`, where `Share` is `{ player, character, reason, act, quadrant?, amount }` in whole
  hundredths. It runs `settle(input, instance, { sharedVote: false, halving: false })` once over the window (one run
  for every player, not one per player). Then for each entry it does this:
  - It takes that run's details for the same player, character and reason.
  - It sums them by Act and quadrant, dropping the reaction time and `valuing`: a card's lift is weighed on the
    card's own Act.
  - It keeps the sums whose sign is the entry's, and weighs each by its size.
  - It splits the entry's exact amount across them by largest remainder, ties by key. That is the same rounding the
    details already use, moved into one helper both call, so there is one implementation.
  - An entry whose estimate holds no weight of its sign gets no shares. A share of 0 is not written.
- `engine/rules/settle.test.ts`, **tests first,** red against a stub that returns `[]`:
  - Each entry's shares add up to it exactly, over the scale test's generated windows too
    (`engine/rules/settle.scale.test.ts`).
  - Three 🔥 on one post from one player, and three from three players, give the same shares. The poison is the one
    the design names: shares taken from the exact details, which this test must fail.
  - A reason the estimate pays on another post than the settlement does (a spun thread's repliers, where one player
    posts as two characters) is shared on the estimate's posts.
  - A negative entry (a polite shrug) is shared negatively. An entry with no weight of its sign has no shares.
  - A card's stolen thunder is shared on the card's Act.
  - The result is the same in any input order.

### Task 2. `ledger_shares`, written by the settlement

- New migration `supabase/migrations/0034_ledger_shares.sql`:
  - **A unique index** on `ledger (settlement, character, reason)`. The settlement writes one row per character and
    reason per window already; the index makes that a fact the view below can join on.
  - **The table:**
    `create table ledger_shares (id bigint generated always as identity primary key, ledger bigint not null
    references ledger (id), act uuid not null references acts (id), quadrant text check (quadrant in
    ('excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative')), amount integer not null check (amount
    <> 0))`.
    It has a unique index on `(ledger, act, coalesce(quadrant, ''))`, an index on `ledger`, and the append-only
    triggers of `0003_aura.sql` (`ledger_append_only`, for row and truncate). It gets no grant.
  - **`apply_settlement`** is dropped and made again with a sixth parameter, `shares jsonb default '[]'`: a list of
    `{character, reason, act, quadrant, amount}`. The body is 0003's as it stands on main, and after the ledger insert
    it inserts the shares against their ledger rows. It refuses, `errcode 22023`, a share that:
    - names no entry of this call;
    - names an Act that does not exist;
    - holds a quadrant outside the four;
    - carries an amount that is not whole or is 0.
    It also refuses a call whose shares for one entry do not add up to that entry's amount. An entry with no shares is
    allowed. A window already settled is still a no-op, so a retried run writes no share twice.
  - The grant is to `service_role` only, on the new signature, and the old one is gone.
  - **The view** `my_ledger_shares`:
    `select l.settlement, l.character, l.reason, sh.act, sh.quadrant, sh.amount from ledger_shares sh join ledger l
    on l.id = sh.ledger where l.account = auth.uid()`. It never shows the account or either id, as `my_ledger`
    (`0030_screens_reads.sql`) does. It is revoked from `anon` and `public`, and selected by `authenticated`.
- `supabase/tests/0005-default-deny.sql`: `my_ledger_shares` joins `readable`.
- **Tests first,** in a new `supabase/tests/0040-ledger-shares.sql`, red against main:
  - A window applied with shares writes them, and they read back through `my_ledger_shares` for their player.
  - A second account reads none of them, and `anon` reads nothing.
  - Each refusal, by its words.
  - A retried window writes no share twice.
  - `ledger_shares` refuses an update, a delete and a truncate.
  - The five-argument `apply_settlement` no longer exists.
  - A settlement applied without shares, as every one before this migration was, still applies.
- `supabase/tests/e2e/0003-export.ts`: the seeded instance holds a share, so the round trip proves `ledger_shares`
  is carried. The export already reads every table.

### Task 3. The settlement job sends the shares

- `supabase/functions/settle/core.ts`: after `settle(input, tuned)`, `shareEntries(input, tuned, result.entries)`,
  sent to `apply_settlement` as `shares`.
- **Tests first:**
  - `supabase/functions/settle/core.test.ts`: the call to `apply_settlement` carries shares that add up to each
    entry.
  - `supabase/tests/e2e/0001-settlement.ts`: a real window settled end to end leaves shares that add up, read
    through `my_ledger_shares`.
- The job runs `settle` a second time per window. The scale test measures both runs over the generated busy window,
  and the PR says what it costs.

### Task 4. `KayfaApi.log`, the Supabase adapter and the fake's ledger

- `engine/ui/data/api.ts`: `log(): Promise<Log>`, the player's own:
  - the settlements with their windows;
  - per character, each ledger line with its shares;
  - the wallet events, with their overflow and floor.
  
  It reads `my_ledger`, `my_ledger_shares` and `my_wallet_events`, newest first, a page at a time, as the web plan's
  Task 8 says, so a long-played account reads a page and not its history.
- `web/src/data/supabase.ts`: the reads. `tools/check-web-reads.mjs` gains `my_ledger_shares` in its own-views list,
  with a case in `tools/test-web-reads.mjs`.
- `engine/ui/data/fake.ts`: the fake keeps a ledger, wallet events and shares. `Seed.settle` takes ledger lines with
  their shares, and with none, as an old settlement has none. `Seed.cards`' purchases and plays write wallet events.
  Tests are in `engine/ui/data/fake.test.tsx`.
- `web/src/data/fixtures/boards.ts` (Part 1's), through new seed methods only: the Log board's settlement
  for Oct 29 (Act 2214) has its three lines with shares (drew heat on post #43, stole thunder on the Whoops! play of
  Act 2190, the polite shrug on a post of the window), and one settlement before it has none.

### Task 5. The log and the settlement's summary, in the glass (boards 12 and 09)

This is the web plan's Task 8, with every word its glass amendment gives it, on the glass's page shell, as the Log and
Settlement boards draw them.

- `engine/ui/log/Log.tsx`:
  - the open window's estimate lines first;
  - each settlement's row as the board draws it, with a Show posts button (`aria-expanded`, `aria-controls` naming
    the breakdown's row);
  - the breakdown, a row under the settlement's row:
    - each reason as a sub-heading with its exact total;
    - its shares, each with the post's link, the quadrant's label and the share;
    - then "Each reason's total is exact. It is split across your posts by how the live estimate valued their
      reactions.";
  - a reason with no shares reads "Scored over the whole window, not post by post.", and a settlement with no shares
    at all has no button and reads "This settlement was made before posts were kept with it.";
  - the tabs, All and one per character;
  - the cap's overflow and the floor said plainly;
  - stacked entries on a phone.
- `engine/ui/log/Settlement.tsx`: as the web plan's glass amendment to Task 8 says. Its Open my log opens the log
  with that settlement's breakdown open.
- The route `/log`, and the menu bar's My log and the HUD's orbs pointed at it, in place of Part 1's stand-in.
- **Tests first,** `engine/ui/log/Log.test.tsx` and `Settlement.test.tsx`:
  - the web plan's Task 8 tests;
  - Show posts opens and closes with the keyboard and returns focus;
  - each reason's shares add up to its total on screen;
  - the sentence of a reason with no shares, and of a settlement with none;
  - nothing on either screen names a reactor or another player's class;
  - the summary's lines are the log's for the same settlement.
- `e2e/boards/09-settlement.ts` and `e2e/boards/12-log.ts`, each taken out of the board match's `PENDING`. A further
  story, `engine/ui/log/Log.board.stories.tsx` "12 Log, open", draws the breakdown, which no board does. It is shown
  to the owner on the PR before its tests are written against it, as section 8 of
  `docs/plans/2026-10-30-glass-to-the-boards-plan.md` does for every screen no board draws, and the owner's word is
  recorded in the PR.

### Task 6. The log's card lines

This is the cards plan's Task 6, in the words it gives them, on the log of Task 5, with its 2026-10-30 amendment: no
Stick Around lines. The card lines in the Log board's rows are its manifest's.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A settlement's breakdown open | Show posts again (Hide posts), Esc on the button, or leaving the page; nothing persists |
| A settlement made before the shares | None needed: every amount is on its row, and the row says why it does not open |

## What could vary with a private fact, and how it does not

- A share is the reason's settled total, already shown, split by the estimate's valuation. That valuation is the
  settlement run with the shared vote and the halving off, which the player watched live (`estimateForOwner`). No
  share differs because two reactions were one player's (Task 1's test says so, with the exact details as its
  poison).
- Which posts a reason names is the estimate's choice, never the settlement's, so no line says which of several posts
  crossed a count of distinct players.
- `my_ledger_shares` is the caller's own rows alone, read only by the caller, never broadcast.
- The settlement summary and the log are the same rows; neither says more than the other.

## Review focus

- Task 1's sign rule: an entry whose estimate sums for one reason run both ways (a reason that pays and costs on
  different posts) and whether a dropped opposite-sign post leaves a share that misleads.
- A share on a post later hidden or redacted on the board: the log links to the Act, which keeps its words ("The
  System acts; it never destroys what a player wrote").
- The settlement's second `settle` run per window at a busy instance's scale, inside the run's `MOST_RUN_MS`.
- `apply_settlement` copied whole into `0034`: a later migration that changed its body on main before this lands, and
  the copy restoring an old body.
- The estimate's valuation excluding the player's own reactions to their own characters, as the live estimate does,
  and whether any share could therefore move with a reaction only one player could have made.
