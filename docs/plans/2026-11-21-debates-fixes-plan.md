Record, written 2026-11-21.

# Debates fixes: the refund starts from what was paid, and a spark pays the class that held it: plan

The build plan for issues #893 and #894, which the final review of PR #852 found: places where the Tweener catalyst's
code contradicts its design, `docs/plans/2026-11-18-tweener-catalyst-design.md`. The design is unchanged. This plan
makes the code match its text (sections 3 and 5).

## The owner's answers

The owner answered these questions through the coordinator on 2026-11-21. They are recorded on #893 and #894.

- **Q1 (#893, F1 and F2: the refund).** Accepted: options (a) and (c), with the clamp.
  - (c) The class is handed what earlier windows actually paid on a spark, reason by reason. A window pays the
    refund standing at its end less what was already paid, so a take-back never exceeds what was paid.
  - (a) A spark that has paid is handed to the class whenever a vote on it moves, however old the spark is, so a calm
    vote that moves away always takes its refund back.
  - The clamp: once the debate is no longer followed, the refund only goes down, never up, so a nod after that is
    charged as any other. A paid vote carries no reaction time, so the engine cannot tell an early nod from a late one.
    The clamp is the bound it can hold.
- **Q2 (#894, F3: a Turn in the window).** Yes. `tweener.litTheFuse` is paid to the class held at the time of the
  crossing. The debate is handed to every stretch of the window, and `fuse` pays only a crossing inside its own
  stretch. `tweener.outvoted` stays placed as it is now, in the stretch of the latest member or the latest moved vote.
- **Q3 (#894, F4: own debate).** The design's text decides it: "a post inside the debate of an earlier post by the
  same player is never a spark". The climb that answers `inOwnDebate` drops the `debateDays` cutoff. It is bounded by
  the length of the chain, and each step is a keyed probe.

No instance is deployed, so no settlement already holds a refund or a crossing that the new record would need filled
in. Nothing is backfilled.

## The shape

- **A tally by Act (engine).** An `Earning` may say `tally: true`. `settle` sums the window's tallied lines by
  (Act, reason) and returns them as `tallied`. `apply_settlement` writes them, one row per (settlement, Act, reason),
  into a new table, `tallied_lines`, which is append-only. Its rows are written in the window's own transaction, so a
  retried window never writes twice.
  - `settlement_input` and `estimate_input` read each handed spark's sums as `tallied`, and `settle` hands them to the
    class as `SparkedDebate.paid` (reason to amount).
  - The engine names no reason: it sums whatever a class marked.
- **Handing (engine).** A post with a nonzero tally is handed as a spark in any window in which a vote on it moves,
  with no `debateDays` cutoff. The posts of its debate are walked to as for any spark, with no cutoff either.
  - Every spark is handed to every stretch of the window, with `placed: boolean`, true in the one stretch its latest
    member or latest moved vote falls in.
- **The rule (instance).** `tweener.litTheFuse` and `tweener.outvoted` carry `tally: true`.
  - `litTheFuse` is paid in any stretch that holds the crossing, as it is now, since `fuse` already filters by the
    stretch.
  - `outvoted` is computed only where `placed` is true. Its amount is `target − paid`, where `paid` is
    `debate.paid['tweener.outvoted'] ?? 0`.
  - The target is 0 unless the spark has paid: `debate.paid['tweener.litTheFuse'] > 0`, or this stretch's own `fuse`
    pays it. Otherwise the target is `refundAt` at the stretch's end, as now.
  - Once `input.from >= debate.at + debateDays`, the target is `min(target, paid)`.
  - So the refund never goes below zero in all, and it is never paid on a spark whose crossing was not paid to a
    Tweener.

## Tasks

### Task 1: the tally and the handing, in the engine

Model: sonnet

Files: `engine/rules/types.ts`, `engine/rules/settle.ts` (its header comment too), `engine/rules/settle.test.ts`.

- `Earning.tally?: true`. `SettlementInput.tallied?: readonly { act; reason; amount }[]` holds the sums so far. The
  result gains `tallied: { act; reason; amount }[]`: this window's sums of the tallied lines, by (Act, reason), each
  whole (rounded as an entry is), with any 0 left out.
- `SparkedDebate.paid: Readonly<Record<string, number>>` is the input's sums for the spark, and `{}` with none.
  `SparkedDebate.placed: boolean` is described above.
- `sparksBy` also takes a post with any nonzero tallied sum, at any age, when a vote moved on it in the window
  (`windowVotesOn`). The age filter stays for every other post.
- `debates` in `ClassInput` gets every spark of the character, in every stretch, with `placed` set for the one
  stretch it falls in. The `empty` test still counts a stretch with debates.

Tests first, each red before the code:
- (a) A tallied earning comes back in `tallied`, summed by Act and reason, across two stretches.
- (b) A spark older than `debateDays` before the window, with `tallied` nonzero and a vote moved in the window, is
  handed with its `paid`. Without `tallied`, it is not handed.
- (c) A character that Turns inside the window gets the debate in both stretches, with `placed` true only in the
  stretch of the latest member.

Each test uses a stub class that records its input. Run `node --test engine/rules/settle.test.ts`.

### Task 2: the Tweener's rule

Model: sonnet

Files: `instances/divided-world/classes/tweener.ts` (its header comment too), `instances/divided-world/classes/classes.test.ts`,
`instances/divided-world/ui/index.ts` (the `tweener.outvoted` log words only if they become untrue).

Depends on Task 1. The rule is as "The shape" says.

Tests first, through `settle`, each red on the code as it stands:
- (F1) The issue's run: window 1 pays `litTheFuse 20`, `outvoted 20`, `shrugged -20`. In a window 5 with `paid`
  carried, four nodders each move to fire. The sum of `shrugged`, the cushion and `outvoted` on the spark is ≤ 0, and
  `outvoted` is taken back.
- (F2) The spark crossed while the character was a Face, and it Turned to Tweener. The nods move to hype. No
  `outvoted` line is negative, and none is paid at all.
- (F3) The character was a Tweener until 8H, then a Face. The crossing came at 7H and the latest member at 10H, and
  `litTheFuse 20` is paid. The control, with the Turn at 12H, is unchanged.
- The clamp: after `debateDays`, a new nod on a paid spark raises no `outvoted`.
- The property test #893 proposed: one spark settled across several windows, carrying `tallied` as the store would,
  varying when nods land and move, cushions and Turns. It asserts that shrugged + cushion + outvoted stays within
  #860's rounding (a unit a window), and that the running `outvoted` total is never below 0.

Run `node --test instances/divided-world/classes/classes.test.ts`.

### Task 3: the store and the inputs, in SQL

Model: sonnet

Files: `supabase/migrations/0398_debates_fixes.sql` (renumbered above main's highest when main is merged),
`supabase/tests/0398-debates-fixes.sql`, `supabase/functions/settle/core.ts`, `supabase/tests/e2e/0003-export.ts`
(`HELD`, with a fixture row).

Depends on Task 1.

- `tallied_lines (settlement bigint references settlements, act uuid references acts, reason text, amount integer
  check (amount <> 0), primary key (settlement, act, reason))`, indexed by `act`. It has row-level security on, no
  grant, and append-only triggers as `ledger_shares` has.
- `apply_settlement` is rebuilt on its latest definition (find it with the catalog), keeping every change already
  there. It gains `tallied jsonb default '[]'` and writes each row with the window's settlement, checking each Act
  exists and each reason by the ledger's pattern.
- `settlement_input` and `estimate_input` are rebuilt on `0395_polls.sql`'s copies (or a later one on main), keeping
  every change already there. Both pin `search_path` ending in `pg_temp`.
  - **The sparks** also take a post with a nonzero tally sum that a reaction reached in the window, with no cutoff.
    Its debate's members are walked to with no cutoff. For the estimate, only the caller's own posts count.
  - **The climb** (`ancestry`, and the spun thread's origin read) drops the cutoff. The window's end and the
    strictly-earlier step still bound it.
  - **`tallied`** is each handed spark's sums by reason, read by the `act` index.
- `core.ts` passes `tallied: result.tallied`.

Tests first, each red before the migration:
- (F4) The issue's run. Ann posts P at d0+12h, Bob quotes P at d0+14h, and Ann's S quotes Bob's reply at d0+3d5h. For
  the window starting at d0+4d, P and the edge are in the input, and settling it pays no `litTheFuse` for S.
- An old paid spark with a reaction in the window is in `settlement_input` with its `tallied` and its members.
- `apply_settlement` writes `tallied_lines`, and a second apply of the same window writes nothing.
- The export round-trips `tallied_lines` with a row.

Run `node tools/test-sql.mjs` (or the one file, as the repository's SQL test runner allows).

## Review focus

- A retry or two runs at once never writes a tally twice: the tally rides the settlement's own transaction.
- At a busy instance's scale, the old sparks handed whenever a vote moves cost their debate's size, and only in a
  window with a vote on them.
- The tally amounts are read only by The System's scoring and by the caller's own estimate, never by anyone else.
