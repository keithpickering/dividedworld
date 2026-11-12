Record, written 2026-11-12.

# The log's shares find their line by its card: plan

This carries out finding F1 of issue #470 (the follow-ups of PR #457's final review), at the owner's ask, as a fix of
its own. It has no separate design: the finding is a defect against a rule already settled ("The fiction may lie; the
log never does"), and the form of the fix follows from what `0150_ledger_names_a_card.sql` already decided.

## The defect

Since 0150 a ledger entry may name a card (`params.card`), and two entries for one character and one reason are two
entries when their cards differ (two `card.boost`, `card.skim` or `card.ride` entries). `settle()` makes an entry by
`entryKey` (`engine/rules/settle.ts`): player, character, reason and, where there is one, the card. `apply_settlement`
matches a share to its entry by the same three (character, reason, card), and `ledger_shares` holds the entry's id, so
the ledger is right.

The read is not. `my_ledger_shares` (0034) names a share's line by settlement, character and reason, with no card;
`log_page` (0157) and the web adapter select the same columns; and `cutLog` (`engine/ui/data/log-page.ts`) files
shares under `character\0reason`. Two entries that differ only by card share one list, so each line in the player's
log shows both cards' shares, and the log says one card paid for an Act another card paid for. The fake backend
flattens its shares through the same `ShareRow` and has the same fault.

## The form it keeps

A share finds its line by the key its entry was made by, end to end:

- **One key.** `engine/rules/settle.ts` gains `lineKey(character, reason, card)`: `character\0reason`, and `\0card`
  where there is a card. `entryKey` becomes the player and `lineKey`, the same string it makes today. `cutLog` keys a
  ledger row and a share by `lineKey`, so the screens' key is the settlement's, not a second one that agrees with it.
- **SQL.** `my_ledger_shares` gains a last column `card` (`l.params ->> 'card'`, null for an entry that names none).
  `log_page`'s `shares` carry it. Both read orders (the function's, and the adapter's paged read of the view) gain
  `card` between `reason` and `act`: without it two cards' shares of one Act and quadrant tie, and a paged read over a
  tie may repeat or skip a row.
- **The read.** `ShareRow` gains `card: string | null`; the web adapter selects and maps it; the fake carries each
  line's `params.card` onto its shares.
- **The screens.** `LogLine` already carries `params`, and `Log.tsx` already keys a line by its card.
  `Settlement.tsx` keys a line by `reason` alone, which gives two card lines one React key; it takes the same key.
  A line's shares stay ordered as they are; lines are ordered by character, reason, then card.
- **Existing rows.** Nothing is backfilled and no row changes. A share has always pointed at its ledger row
  (`ledger_shares.ledger`), and the card is read from that row's `params`, so every share already written reads its
  right card the moment the view changes, and a share of an entry with no card reads `card` null, as before.
- **The export.** `ledger_shares` and `ledger.params` already round-trip (`supabase/tests/e2e/0003-export.ts`). The
  view is derived from them, so nothing is added to the export; Task 1 adds a share on the export test's card-naming
  ledger row and asserts `my_ledger_shares` reads its card after the import.
- **Masks.** The new column is read from the caller's own ledger rows, which `my_ledger` already shows them with
  `params`. It says nothing of who reacted or who owns another character.

The migration is built as `0290_log_shares_by_card.sql` and renumbered as the last step before the PR is reported
ready, above every migration on main at that moment (the coordinating session hands out the number). If main has
re-made `log_page` by then, the function's body is taken from main's newest and the one change applied again.

## Tasks

### Task 1: the view and `log_page` carry the card

Model: sonnet

Files: `supabase/migrations/0290_log_shares_by_card.sql` (new), `supabase/tests/0290-log-shares-by-card.sql` (new),
`supabase/tests/0040-ledger-shares.sql`, `supabase/tests/0124-log-page.sql`, `supabase/tests/e2e/0003-export.ts`.

Tests first, with the red run recorded (`npm run test:sql`, or the runner's way of running one file):

1. `0290-log-shares-by-card.sql`. Two players; Ann's character has, in one settlement applied through
   `apply_settlement`, two `card.ride` entries naming cards `x` and `y`, each with a share on the **same** Act and
   quadrant with different amounts, and one entry with no card with its share. As Ann:
   - each share in `my_ledger_shares` reads its own entry's card, and the no-card entry's share reads null. Read the
     column as `to_jsonb(s) ->> 'card'`, so that the red run fails on the assertion and not on a missing column;
   - `log_page(null) -> 'shares'` holds the same rows with `card`, in the order settlement desc, character, reason,
     card, act, quadrant;
   - a share written before this migration reads right: insert a `ledger` row with `params.card` and a
     `ledger_shares` row directly (as a row 0150 wrote), and read its card through the view;
   - the view's columns are exactly `settlement, character, reason, act, quadrant, amount, card`.
   As the other player: none of Ann's shares are read.
2. `0040-ledger-shares.sql`: the column list gains `card`.
3. `0124-log-page.sql`: the shares comparison selects `card` and orders by it between `reason` and `act`.
4. `e2e/0003-export.ts`: a `ledger_shares` row on the seeded `card.skim` ledger row that names `expskim`; after the
   round trip its owner reads `card = 'expskim'` for it through `my_ledger_shares`.

Then the migration:

- `create or replace view my_ledger_shares` with `card` appended last (a view may gain a last column in place; its
  grants stand). The header comment says what existing rows read as.
- `create or replace function log_page(timestamptz)` as 0157 wrote it, whole, with two changes: the `sh` CTE selects
  `s.card`, and the `shares` aggregate orders by `x.settlement desc, x.character, x.reason, x.card, x.act,
  x.quadrant`. Its language, security, `search_path` and grants stay as 0157 has them; if `create or replace` cannot
  be used, drop and re-create with the grants restated, as 0157 did.

### Task 2: one key from the settlement to the screens

Model: sonnet

Depends on Task 1 (the column the adapter selects).

Files: `engine/rules/settle.ts` (`lineKey`, `entryKey`), `engine/rules/settle.test.ts`, `engine/ui/data/log-page.ts`
(`ShareRow`, `cutLog`), `engine/ui/data/log-page.test.ts`, `engine/ui/data/fake.ts` (`log`), the fake's test file
that covers `log`, `web/src/data/supabase.ts` (`toLogRead`, the `my_ledger_shares` read), `web/src/data/supabase.test.tsx`,
`engine/ui/log/Settlement.tsx`, `engine/ui/log/Settlement.test.tsx`, `engine/ui/data/api.ts` (comments only, where
they describe how a share is named).

Tests first, each with its red run:

1. `log-page.test.ts`: one settlement, one character, two `card.ride` ledger rows naming `x` and `y`, and a share for
   each on the same Act and quadrant; each line holds only its own share. A second case: lines of one character and
   reason are ordered by card, and a share with `card: null` files under the line with no card and never under a
   card's. Today's `cutLog` is the poison: it puts both shares on both lines.
2. `settle.test.ts`: `entryKey` is the player and `lineKey`, and `lineKey` differs for two cards and for a card and
   none.
3. The fake: a fake backend holding a settlement with two card lines of one character and reason reads a log whose
   lines each hold their own shares.
4. `supabase.test.tsx`: the `my_ledger_shares` request selects `card` and orders by it between `reason` and `act`;
   rows with two cards map to two lines with their own shares, by the views and by `log_page`.
5. `Settlement.test.tsx`: two lines of one reason and two cards render both, with no duplicate-key warning.

Then the code, as "The form it keeps" says. `lineKey` lives in `engine/rules/settle.ts` and `log-page.ts` imports it;
if the engine's import check refuses a value import from `engine/rules/settle.ts` into `engine/ui/data`, stop and
report it as a plan gap instead of writing a second key.

## Review focus

- What rows an instance already holds read as: shares written by 0034, 0073 and 0150 before this migration, with and
  without a card on their ledger row, and settlements made before shares were kept.
- The paged read of `my_ledger_shares` (`web/src/data/supabase.ts`) is a total order now: no two rows of one
  settlement tie on every ordered column.
- `log_page` as re-made here differs from main's newest only by the card; nothing another migration added to it since
  0157 is lost at the renumber.
- The new column is computed from the caller's own ledger rows alone ("A response never proves a private fact").
- The log's words for a card line's shares are true for the card the line names ("The fiction may lie; the log never
  does"): no path (views, `log_page`, the fake) still files a share by character and reason alone.
