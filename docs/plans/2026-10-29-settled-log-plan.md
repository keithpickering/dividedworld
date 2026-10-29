# The settled log: plan

Record, written 2026-10-29. Carries out `docs/plans/2026-10-29-settled-log-design.md` (#25). A build session carries it
out task by task, tests first, each red run recorded (`.claude/skills/build-session/SKILL.md`).

**It starts after PR #24 (the web plan, `docs/plans/2026-10-29-screens-web-plan.md`) is merged without its Task 8**, and
it builds that Task 8 here (design, section 5). Every file below that is not marked new is main's after that merge; a
builder who finds a name changed reads the merged version and lists the difference under `Plan gaps`. PR #24's last
migration was `0031_post_counts_policy.sql` and its last SQL test `0034-thread-list.sql`, so this plan's are `0032` and
`0035`, or the next free numbers after whatever merged first.

## The layers

Engine: everything below. The instance supplies each reason's words through `reasonWords`
(`instances/divided-world/ui/index.ts`, from the web plan). No file here names Divided World, a class or a reason.

## Tasks

### Task 1. The lines, kept with the window

- New `supabase/migrations/0032_settled_lines.sql`:
  - `settled_lines`: `id` (identity), `settlement` (references `settlements`), `account`, `character`, `reason` (the
    ledger's `REASON` check), `act` (nullable, references `acts`), `quadrant` (nullable, one of the four), `reacted_at`
    (nullable timestamptz: the one reaction the line values), `amount` (integer, not zero). It is append-only, with
    0003's `ledger_append_only()` triggers, `enable always`, for update, delete and truncate. Index
    `(account, settlement, character, reason)`. RLS on, everything revoked from `anon` and `authenticated`, and no
    grant on the table itself: players read it through the view below.
  - `settlements.lines_kept boolean not null default false`. Rows already there stay false.
  - `apply_settlement()` is replaced with one more argument, `lines jsonb default null`. The old five-argument function
    is dropped in the same migration, so one signature remains, with its revoke and its grant to `service_role`. Each
    line is `{player, character, reason, act?, quadrant?, at?, amount}`, with `at` in epoch milliseconds as the engine
    gives it. The lines are checked the way the entries are: the player plays the character, the amount is whole and not
    zero, the reason has the ledger's shape, a named Act exists, a named quadrant is one of the four. A list that fails
    is refused whole, with the count and the predicate that failed. They are written after the ledger rows, in the
    window's transaction. `lines_kept` is `lines is not null`, so an older job that sends none says so, and `'[]'` from
    a window that valued nothing keeps an empty breakdown truthfully. A window already settled stays a no-op that writes
    no lines.
  - `my_settled_lines` (view): the caller's lines, `settlement, character, reason, act, quadrant, reacted_at, amount`,
    with no account and no id, `where account = auth.uid()`, granted to `authenticated`.
  - `my_ledger` (0030) is replaced, keeping its columns in order and adding two at the end:
    - Its rows become every `(settlement, character, reason)` that has a ledger row or a line, so a reason that settled
      to nothing appears with `amount` 0 (design, section 2).
    - `estimated` is the sum of the reason's lines: 0 where the window kept lines and this reason had none, and null
      where the window kept none.
    - `lines_kept` is the window's flag.
- **Tests first** (new `supabase/tests/0035-settled-lines.sql`; `0033-screens-reads.sql`'s column list for `my_ledger`
  updated; `0005-default-deny.sql` gains `settled_lines` and `my_settled_lines`):
  - A window applied with lines keeps them, and `my_settled_lines` gives Ann hers and Bob none of them.
  - A reason with lines and no entry is in `my_ledger` at 0 with its `estimated`.
  - An entry with no lines in a window that kept lines has `estimated` 0. A window applied with no `lines` argument has
    `lines_kept` false and `estimated` null.
  - The same window applied twice writes its lines once.
  - A line naming a character its player does not play is refused, and so are a fractional amount, a reason of the
    wrong shape and an Act that does not exist. In each case nothing of the window is written.
  - An update, a delete and a truncate of `settled_lines` are refused.
  - Neither `settled_lines` nor `my_settled_lines` is readable by `anon`. `settled_lines` itself is not readable by
    `authenticated`.
  - `0014-realtime.sql` still passes: nothing new is published.
- **Poisons:**
  - The lines' ownership check removed: "a line naming a character its player does not play is refused" goes red.
  - The lines written outside the already-settled guard: "applied twice writes its lines once" goes red.
  - `my_ledger` built from `ledger` alone: "a reason with lines and no entry" goes red.
  - `lines_kept` set true for a null `lines`: the `estimated` null test goes red.
  - `my_settled_lines` without its `auth.uid()` filter: Bob reads Ann's line and the test goes red.

### Task 2. One function for the live and the frozen lines

- `engine/rules/settle.ts`: a new `estimateLines(input, instance)` returns every player's lines,
  `{ player, character, reason, act?, quadrant?, at?, amount }[]`. It is `settle()` with `{ sharedVote: false,
  halving: false }`, and each `valuing` detail is split into one line per vote it counts, as `estimateForOwner()` does
  today. The votes a lift counts are those on the valued Act, in the window, after `valuing.from`, in the line's
  quadrant, and neither the line's own player's nor the valued Act's author's. The reactions are grouped by Act once,
  before the split, so the work is linear in the window's reactions and never the product of the lift lines and the
  reactions. Zero lines are dropped.
- `estimateForOwner()` becomes `estimateLines()` filtered to the player, with its `player` field removed, and the
  entries as now. Its doc comment says so. The estimate function (`supabase/functions/estimate/core.ts`) is unchanged.
- **Tests first** (`engine/rules/settle.test.ts`; `engine/rules/settle.scale.test.ts`):
  - For every player of an existing multi-player test window with a card lift, a Lurker's call and a Turn mid-window,
    `estimateForOwner(input, i, p).lines` equals `estimateLines(input, i)` filtered to `p` with `player` dropped.
  - Each player's lines add up to their `estimateForOwner` entries.
  - A Face's lift on a post reacted to by three other players is three lines, one per vote, each at its reaction's
    time.
  - The caster's own reaction on the target is not among the lift's lines.
  - At the scale test's size, with many cards on busy posts, `estimateLines()` stays inside the loose bound the file
    already sets for `settle()`.
- **Poisons:**
  - The split's filter scanning `input.reactions` per line restored: the scale test goes red.
  - The split excluding the estimate's caller rather than the line's player: "the caster's own reaction" goes red for
    the second player.

### Task 3. The settlement job keeps them

- `supabase/functions/settle/core.ts` (`runSettlement`): after `settle(input, tuned)`, it runs
  `estimateLines(input, tuned)` on the same input and passes them as `lines`. A line's `at` stays in epoch milliseconds,
  which `apply_settlement` turns into `reacted_at`. The outcome's per-window record gains the count of lines.
- `supabase/functions/settle/core.test.ts`: `fakeDb`'s `apply_settlement` records `lines`.
- **Tests first:**
  - The day in `core.test.ts` sends Bob's frozen heat lines: Cat's, Dee's, Eve's and Fay's reactions, each a whole vote
    at its time. It also sends his shrug line, Dee's call line, and nothing for a player who earned nothing.
  - The lines sent for Bob add up to more than his settled `heel.drewHeat` (whole votes against Dee's split vote), and
    the difference is what the shared vote took.
  - A window with no Acts sends `lines: []`, never null.
- **Poison:** the job not passing `lines`: the first test goes red. Against the database, Task 1's `lines_kept` test
  already holds a missing argument.

### Task 4. The log's read

- `engine/ui/data/api.ts`: `KayfaApi` gains `log(page)` and `logLines(settlement, character, reason)`.
  - `log(page)` returns the newest settlements first, `page.limit` at a time from `page.offset`. Each settlement has its
    window, `linesKept`, its total for each of the player's characters, and its reasons: `{ character, reason, amount,
    estimated | null }`. It also carries the wallet events of those settlements, with change, overflow and floored.
  - `logLines` returns that reason's frozen lines, oldest first: `{ act, quadrant?, at?, amount }`.
- `engine/ui/data/fake.ts`: the in-memory backend holds settled lines and reasons per account, and refuses a read signed
  out in the adapter's words. The `Fake` interface's `settle()` control takes each account's reasons and lines, so the
  stories and tests can settle a window with them.
- `web/src/data/supabase.ts`: `log` reads `my_ledger` and `my_wallet_events` for a page of settlements. `logLines`
  reads `my_settled_lines` filtered to one settlement, character and reason, through the Task 1 index.
- `tools/check-web-reads.mjs`: `ALLOWED_READS` gains `my_settled_lines`, among the player's own.
- **Tests first** (`web/src/data/supabase.test.tsx` for the adapter; `engine/ui/data/fake.test.tsx` for the in-memory
  backend, each held to the same answers):
  - A page of two settlements with their reasons, `estimated` and `linesKept`.
  - A reason's lines read on their own.
  - An older window's `estimated` is null.
  - Signed out, both are refused alike.
  - `tools/test-web-reads.mjs` is unchanged and passes.
- **Poison:** `my_settled_lines` left out of `ALLOWED_READS` makes `npm run build:ci` red, which shows the guard reads
  the new adapter call. Record the red run.

### Task 5. The log screen (the web plan's Task 8)

- New `engine/ui/log/Log.tsx`, `Log.test.tsx`, `Log.stories.tsx` and `log.css` (tokens only, as
  `tools/check-ui-tokens.mjs` holds), and a `/log` route with a link in `web/src/App.tsx` beside Characters. The web
  plan's Task 8, its brief and the mockup `docs/research/2026-10-29-screens/mock-q11-log.html` stand, with this design
  in place of "each expandable to its Acts":
  - **The open window** comes first. Its lines are in italics, from the estimate ("up to +0.10, before the shared vote
    and halving"), as the web plan says.
  - **Each settlement** follows, newest first, paged. It shows its date and each character's total.
  - **Each reason** is one line from `reasonWords`, with its exact amount, 0.00 included. Where its window kept lines,
    it is a disclosure button (`aria-expanded`, keyboard reachable) that loads its lines on first open.
  - **Expanded:** one line per frozen line, naming the Act (linked to its permalink), the quadrant's reaction label
    from the instance, the time, and the whole-vote amount. Then, where `amount − estimated` is not zero, one line: "One
    vote per player per Act, and the halving", with the difference.
  - **A window with no lines kept** shows its reasons with no disclosure and one line: "No breakdown was kept for this
    settlement."
  - **A short help note** under the log says, plainly, what the reconciling line counts: one vote per player per Act
    across all their reactions and masks, each later Act by the same character in a window counting half, a vote paid
    in an earlier window, and a call counted by player.
  - **Around them:** the wallet's floor, cap and overflow said plainly from the wallet events; a filter by character;
    stacked entries on a phone; the empty state before the first settlement.
  - **The words:** out of character, plain and true, never naming who reacted.
- After PR #24 is merged, the web plan gets one line under its Task 8: "Built by
  `docs/plans/2026-10-29-settled-log-plan.md`, Task 5 (#25)."
- **Tests first** (`engine/ui/log/Log.test.tsx`; a new `e2e/log.spec.ts` on the in-memory backend):
  - The estimate's lines are labeled as estimates.
  - A settled reason expands to its frozen lines and the reconciling line, and together they add up to the reason's
    amount.
  - The reconciling line is absent where the difference is zero.
  - A reason at 0.00 is listed and expands.
  - A window with no lines kept says so and offers no disclosure.
  - Overflow past the cap is said.
  - The empty state before the first settlement.
  - The disclosure works by keyboard and announces its state.
  - The page passes the a11y story sweep the web plan's Task 12 set up.
- **Poison:** the reconciling line computed as `estimated − amount` makes "add up to the reason's amount" red.

### Task 6. Export and the docs

- `supabase/tests/e2e/0003-export.ts` seeds a settled window with lines. Its "each table should hold something" rule
  fails until it does, so the round trip carries `settled_lines` and `settlements.lines_kept`.
- `docs/plans/2026-10-29-screens-design.md` already carries this design's amendment, in this plan's own PR.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A settlement with no lines kept | None needed: it holds nobody. The log shows its totals and says no breakdown was kept |

## What could be computed from a private fact, and how it is not

- `settled_lines` holds `estimateLines()`'s output, with the shared vote and the halving off. With them off, no amount
  depends on how anyone's reactions group into players. The only player-grouping read is the line's own player's: their
  reactions kept off their own card's lift.
- `my_ledger.amount` is the window's settled sum per reason, the one exception the rule allows. `estimated` and the
  reconciling line are derived from that sum and the frozen lines, so they add nothing.
- Both views read the caller's own rows by `auth.uid()`. Nothing is broadcast. `apply_settlement`'s answer is the
  service's alone.

## Review focus

- `my_ledger`'s replacement on a database that already holds settlements, and every reader of 0030's columns.
- `apply_settlement`'s argument at a busy instance: the size of one window's lines in one PostgREST call beside
  `settlement_input()`'s answer, and whether a limit in front of PostgREST is met first.
- That `estimateLines()` for every player equals what each player's live estimate (`estimate_input()` →
  `estimateForOwner`) showed at the window's end. The inputs differ (the whole instance against one player's slice, with
  made-up keys), so a difference in what either reads would make the frozen lines disagree with the last estimate the
  player saw.
- A window settled by an older job during the deploy (`lines_kept` false), and the log's words for it.
- That no line or view exposes `account`, or a reaction's character or player.
