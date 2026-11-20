Record, written 2026-11-20.

# Crowd pay: a wallet's pay for reacting: plan

Carries out `docs/plans/2026-11-20-crowd-pay-design.md`. One PR from `main`.

**Order with work in flight.** `docs/plans/2026-11-20-class-balance-plan.md` changes `engine/rules/settle.ts`,
`engine/rules/types.ts`, `settlement_input` and `estimate_input`. This plan reads the two SQL functions and changes
neither. Each migration here copies a function it replaces from the newest migration that defines it (`grep -ln
"function apply_settlement" supabase/migrations/*.sql | tail -1`, and so for `log_page`, `settings_held`,
`screen_settings`), never from a file named here, and takes the next free migration number at build time.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for the rules' and functions' tests, `npx
vitest run <file>` for the screens', `npm run test:sql` for the migrations). Run `npm run typecheck` and `npm run build`
once after the last task, with the tail in the PR. No deployed database, bucket or connector is touched; SQL is tested
against Postgres on localhost.

**The layers.** Tasks 1 to 5 are the engine's and name no instance. Task 1's numbers and Task 6's paragraph are
Divided World's (`instances/divided-world/settings.ts`, `instances/divided-world/guide/strategy-guide.md`).

**The masks.** Crowd pay is read from who reacted in the settlement (The System's scoring) and, for the caller alone,
in the caller's own estimate, which already keys the caller's own reactions as the caller's (`estimate_input`'s
`keyed`). It is shown only in the player's own wallet, log, estimate and settlement summary. No public read, Realtime
event, refusal or timing changes, and no standing (design, sections 2 and 6).

**States.** None added.

**Scale.** One pass over the window's reactions in the engine; one index probe per paid Act in the SQL, at most players
× `crowdPayMost` rows a window (design, section 7).

## Task 1. The setting

Model: sonnet

**Files:** `engine/rules/types.ts` (`Settings`), `engine/rules/instance.ts` (the settings' rules, beside `halving` and
`reactionCap`), `instances/divided-world/settings.ts` (`defaults`), `engine/ui/data/api.ts` (`ScreenSettings`),
`engine/ui/guide/markdown.ts` (`KINDS`), a new migration (`settings_held`'s clauses and `screen_settings`' key list),
`supabase/tests/0079-settings-held.sql`, and whatever test fixture lists every setting (`npm run typecheck` names it).

- `Settings` gains, with these comments:
  ```ts
  /** What each Act a player reacts to pays their wallet at the settlement (crowd pay), in hundredths; 0 switches crowd pay off. */
  readonly crowdPayEach: Hundredths;
  /** The most Acts one player is paid crowd pay for in one settlement window, across all their characters. */
  readonly crowdPayMost: number;
  ```
- The rules: `crowdPayEach` a whole number at least 0 (`'a whole number of hundredths, at least 0'`); `crowdPayMost`
  a whole number at least 1. The migration's `settings_held` holds the same, and `screen_settings` exposes both keys,
  so the guide and the log can say them.
- Divided World's defaults, with the design's reasons in their comments: `crowdPayEach: 2` ("Minus World's ratio: giving
  a reaction paid a fifth of getting one, and a vote is 10"), `crowdPayMost: 10` ("at most 0.20 orb a day, about a
  common card a week from reacting alone").
- `KINDS`: `crowdPayEach: 'aura'`, `crowdPayMost: 'count'`.

**Tests first:** `engine/rules/settings-held.test.ts` goes red once the keys are in `Settings` and the SQL test has no
rows for them; then add to `supabase/tests/0079-settings-held.sql` the poisons (`crowdPayEach` −1 and 1.5;
`crowdPayMost` 0 and 2.5) and the goods (2 and 10). A guide test that `{{setting:crowdPayEach}}` says "0.02" and
`{{setting:crowdPayMost}}` says "10".

## Task 2. The rule, in the engine

Model: sonnet

**Files:** `engine/rules/settle.ts` (`Settlement`, `settle`, the header comment's list of rules), `engine/rules/settle.test.ts`,
`engine/rules/settle.scale.test.ts`.

- `Settlement` gains:
  ```ts
  /**
   * Each player's crowd pay for the window (docs/plans/2026-11-20-crowd-pay-design.md): the Acts paid, in the order paid, and the amount.
   * A wallet's alone: in no entry, no standing and no class's total.
   */
  readonly crowd: readonly { readonly player: string; readonly acts: readonly string[]; readonly amount: number }[];
  ```
- `crowdPay(input, settings)`, a function of its own in `settle.ts`, called by `settle` and its result returned as
  `crowd`. For each player, the Acts that count are those where:
  - the Act is in `input.acts` (so not a System Act, not an unscored staff post, not a gift, not an admin-ended play,
    none of which `settlement_input` puts there);
  - the Act's character's player is not the reacting player;
  - the player's earliest reaction on the Act, over every reaction the input holds, is inside the window
    (`window.from <= at < window.to`).
  Sorted by that earliest reaction's time, then by Act id; the first `crowdPayMost` are paid; `amount = acts.length *
  crowdPayEach`. A player with no Act, or `crowdPayEach` 0, has no row. Rows are sorted by player.
- It reads neither quadrant nor kind nor character of the reaction, and `SettleOptions` do not change it (the shared
  vote and the halving are a vote's, not crowd pay's).
- The header comment gains a bullet for crowd pay.

**Tests first**, in `settle.test.ts`:
- one reaction, and three reactions by two of the player's masks on one Act, each pay one Act (`2`);
- a hype and a heat reaction each pay the same (quadrant-blind);
- a player whose first reaction on the Act was before the window, reacting again inside it, is paid nothing for it;
- a reaction on a System Act (`systemActs`) and on an `unscoredTargets` post pays nothing;
- a reaction on an Act of the player's own character (put in the input by hand) pays nothing;
- with `crowdPayMost: 2` and three Acts, the two earliest are paid, and a tie in time goes to the smaller Act id;
- `crowdPayEach: 0` gives `crowd: []`;
- the same input in another row order gives the same `crowd`;
- `entries`, `standings` and `byClass` are the same with crowd pay at 2 and at 0.

In `settle.scale.test.ts`, the busy instance's run gains crowd pay and stays inside its existing bound.

## Task 3. The estimate, and the ghost

Model: sonnet

**Files:** `engine/rules/settle.ts` (`estimateForOwner`), `engine/rules/settle.test.ts`, `supabase/functions/estimate/core.ts`
and `core.test.ts`, `engine/ui/data/api.ts` (`Estimate`), `engine/ui/player.tsx` (`pending`), and the stories or
fixtures that build an `Estimate` (`npm run typecheck` names them).

- `estimateForOwner` returns `crowd: { acts: string[]; amount: number } | null`: the caller's row of `crowdPay` over
  the estimate's input, or null. Run on `estimate_input`, whose window is the open one, it is the crowd pay so far,
  exact for the caller.
- `Estimate` gains `readonly crowd: { readonly acts: readonly Id[]; readonly amount: number } | null`. An estimate
  kept before this change (`estimate_kept`'s jsonb, at most `ESTIMATE_HOLD_SECONDS` old) has no `crowd`: the reader
  takes a missing one as null.
- `pending` (the ghost) adds `crowd.amount`.

**Tests first:** `estimateForOwner` on an input where the caller and another player each reacted to two Acts returns
the caller's two and never the other's; the estimate core's answer carries `crowd`; the ghost's sum with entries of 10
and crowd of 4 is 14; an `Estimate` with no `crowd` key reads as none.

## Task 4. The SQL: kept, checked and paid

Model: sonnet

**Files:** a new migration; a new SQL test `supabase/tests/<number>-crowd-pay.sql`; `supabase/functions/settle/core.ts` and
`core.test.ts`; `instances/divided-world/data-api.json` if `tools/check-data-api.mjs` asks for the new view.

- `wallet_events_kind_check` (newest in `0153_drives.sql`) admits `'crowd'`.
- A table, private (RLS on, no grant to `anon` or `authenticated`):
  ```sql
  create table crowd_paid (
    settlement bigint not null references settlements (id),
    account uuid not null references accounts (id),
    act uuid not null references acts (id),
    primary key (settlement, account, act)
  );
  ```
  and a view for the player's own, as `my_ledger_shares` is written: `create view my_crowd_paid as select settlement,
  act from crowd_paid where account = auth.uid();`, granted as `my_ledger_shares` is.
- `apply_settlement` gains a last parameter `crowd jsonb default '[]'`: a list of `{ player, acts }`. Since adding a
  parameter makes a new overload, the migration drops the old signature and creates the new one, with the old one's
  grants stated again. After the existing checks and before any insert, it refuses (`22023`, each in words of its own):
  - a row that is not an object with a `player` and an array `acts` of uuids, or two rows for one player;
  - an Act listed twice for one player;
  - more Acts than `setting('crowdPayMost')`;
  - an Act the player did not react to inside the window, or reacted to before it (`reactions.reactor_account`,
    `created_at`, by the index on reactor);
  - an Act whose character the player owns, a staff-side Act (`is_staff_side`), an Act with no character, a
    `donation`, or a card play an admin ended before `window_end` (as `settlement_input`'s `ended`).
  With `setting('crowdPayEach')` at 0 it refuses any non-empty `crowd`. After the settlement's own wallet moves, for
  each row, in player order: insert its `crowd_paid` rows, then `wallet_move(player, count * crowdPayEach, 'crowd',
  settled, null)`. Nothing is written to `ledger`, `ledger_shares` or `standings`. A retried window answers `already
  settled` before any of it, as today.
- `runSettlement` sends `crowd: result.crowd.map(({ player, acts }) => ({ player, acts }))`; the amount is never sent.

**Tests first**, in the SQL test, each poison refused with its words and writing nothing: an Act the player never
reacted to; one first reacted to the window before; the player's own character's Act; a staff Act; a System Act; an
admin-ended play; an Act listed twice; one more Act than the cap; `crowdPayEach` 0 with a row. The good case: two Acts
for one player write two `crowd_paid` rows, one `wallet_events` row of kind `crowd` and change 4, and no `ledger` or
`standings` row for it; a wallet at 598 takes 2 and overflows 2. In `core.test.ts`, the call carries `crowd` without
amounts. The export round trip (`supabase/tests/e2e/0003-export.ts`): if it asserts by table, a settlement with crowd
pay is among what it exports.

## Task 5. The log and the summary

Model: sonnet

**Files:** a new migration (`log_page` with a `crowd` source), `engine/ui/data/api.ts` (`Log`), `engine/ui/log/lines.ts`
and `lines.test.tsx`, `engine/ui/log/Settlement.tsx` and `Settlement.test.tsx`, `engine/ui/log/useLog.ts` if it lists
sources.

- `log_page`, copied whole from its newest migration, gains `'crowd'` under `sources`: the caller's `my_crowd_paid`
  rows for the settlements its wallet rows name, ordered by settlement then Act; and those Acts join `named`, so the
  log can link them. Its grants are kept.
- `lines.ts`: a `LineKind` `'crowd'`. A row per wallet event of kind `crowd` (`crowdRows`, beside `grantRows`), in
  every tab, at the event's time:
  - `what`: `Crowd pay`
  - `details`: `You reacted to {n} {Act|Acts} by other players and were paid {amount} Aura.` then, where the count is
    `crowdPayMost`, ` That's the most one settlement pays.` then, where `overflow > 0`, ` {overflow} more didn't fit
    under your wallet's cap.` then each Act as a link, named as the log names an Act elsewhere (the helper the share
    lines use).
  - `aura`: the event's change; `wallet`: its balance after.
- The estimate's rows gain one for `crowd` where it is not null, in every tab: `Crowd pay so far: {n} {Act|Acts}, {amount}
  Aura.` with the Acts linked (`actsNamed` gains them).
- `ORDER` places `crowd` with the wallet's other rows (4).
- The summary shows the crowd pay line in its All tab with the same words, and a settlement whose only line of the
  player's is crowd pay opens it (`SettlementOnLoad`'s test of "a line of the player's").

**Tests first:** a `crowd` wallet event of change 14 over 7 Acts says the sentence with 7 links and 14; at the cap it
says the cap's sentence; with an overflow it says the overflow's; it shows in a character's tab as in All; an estimate
with `crowd` shows its row; a settlement with crowd pay alone opens the summary.

## Task 6. The Strategy Guide

Model: inline

**Files:** `instances/divided-world/guide/strategy-guide.md`, under `## Aura`, after the paragraph that says where Aura
comes from.

> **Crowd pay.** Reacting pays too. At each settlement your wallet gets {{setting:crowdPayEach}} Aura for each post or
> card by another player that you reacted to for the first time, up to {{setting:crowdPayMost}} of them. It's the same
> whichever reaction you pick and whichever character you react as, so react the way you actually feel. Crowd pay goes
> to your wallet only: it never counts toward any character's standing, and nobody else can see it.

The paragraph above it says Aura "comes mostly from other players' reactions"; it stays true. `npm run build`'s guide
check (`tools/check-guide.mjs`) passes with both markers. The owner approves the words in review (CLAUDE.md, "The
fiction may lie; the log never does").

## Review focus

- A settlement already applied before the migration: `apply_settlement`'s new parameter defaults to `[]`, so a retry of
  an old window pays no crowd pay and writes nothing new.
- The engine's rule and the SQL's check describe the same Acts; a case where `settlement_input` puts an Act in `acts`
  that the SQL refuses (or the reverse) fails the whole window. Check the filters line by line against `settlement_input`.
- The cap is per player across every mask: nothing written to a public table or view may vary with it.
- The order of wallet moves: the settlement's own moves first, then crowd pay, so the cap's overflow lands on crowd pay.
- `estimate_kept` answers saved before the change carry no `crowd`.
- The new `apply_settlement` overload: no caller is left on the old signature, and the old one is gone.
