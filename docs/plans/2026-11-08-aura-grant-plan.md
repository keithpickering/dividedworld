# Aura grant: plan

Record, written 2026-11-08. Carries out `docs/plans/2026-11-08-aura-grant-design.md`. Every task goes test first: write
the failing test, show its red run, then write the code. During a task, run only the tests for the changed code
(`npm run test:sql` with the one file, or `npx vitest run <file>`). Run `npm run build` once after the last task. All of
it is engine.

## Task 1. `grant_aura` and the `grant` kind

Model: sonnet.

Files: a new `supabase/migrations/0128_aura_grant.sql` (the next free number; take the next one if a merge has used it)
and a new `supabase/tests/0125-aura-grant.sql` (the same rule).

- The migration's header says what the design's section 2 says, briefly, and names the design.
- Drop and re-add `wallet_events_kind_check` with the full list from 0109 plus `'grant'`.
- `create function grant_aura(account uuid, amount integer default null) returns jsonb`, `language plpgsql security
  definer set search_path = public, pg_temp`:
  - Refuse a null `account`, or one with no row in `accounts`, with `22023` and hint `kayfabb.refusal`, naming the id.
  - Refuse an `amount` that is not null and is below 1 the same way.
  - Insert the wallet row if missing (`on conflict do nothing`), then lock it (`select balance ... for update`).
    `wallet_move` takes the same lock again in this transaction, so a concurrent spend cannot slip between the check
    and the move.
  - If the balance is at or above `setting('walletCap')`, return `{"granted": 0, "overflow": coalesce(amount, 0),
    "balance": <balance>}` and write nothing.
  - Otherwise call `wallet_move(account, coalesce(amount, cap - balance), 'grant', null, null)`. Read back the event it
    wrote (the newest `wallet_events` row for the account and kind `grant` in this transaction, or compute it from the
    move's inputs) and return `granted` = its `change`, `overflow` = its `overflow` and `balance` = the new balance.
- `revoke execute ... from public, anon, authenticated; grant execute ... to service_role;`
- Tests first, in a `do $$` block per case, with `tests.account` and the `is distinct from` comparisons
  (`tools/test-sql-refusal.mjs` refuses a bare `<>` on a subquery). Set `walletCap` explicitly in the file so it does
  not depend on another file's setting.
  - A fill from 0 brings the balance to the cap, and writes one `grant` event with that change, no overflow, and
    `settlement` and `ref` null.
  - An amount below the headroom credits exactly that amount.
  - An amount past the headroom stops at the cap and records the rest as `overflow`, and the return value says both.
  - A fill on a full wallet, and an amount on a full wallet, each write no row and return `granted` 0.
  - A wallet above a lowered cap: a grant writes no row and the balance is unchanged.
  - Zero, a negative amount, and an unknown account are each refused with `22023`, and write nothing.
  - `grant_aura(a, 1.5)` does not resolve (catch `undefined_function`).
  - As `authenticated` (`tests.become`, for a player and for an admin), the call is refused
    with `insufficient_privilege`. As the service role (`tests.become_service`), it runs.
  - After a mix of settlements, purchases and grants, `sum(change)` over the account's events equals the balance.
  - The kind check still refuses a made-up kind.

## Task 2. The log line

Model: sonnet.

Files: `engine/ui/data/api.ts` (`WalletEvent['kind']` and its comment), `engine/ui/log/lines.ts`,
`engine/ui/log/lines.test.tsx`.

- Add `'grant'` to `WalletEvent['kind']`, and to the comment above it: "`grant` is an admin's (0128): Aura given by
  the instance's operator, `ref` null."
- Add `'grant'` to `LineKind`, with a comment naming this design.
- A new `grantRows(data: LogData): LogRow[]`, called from `logRows` beside `modRows` and filtered by `inTab` the same
  way. One row per `grant` event: `key` `grant:<at>`, `kind` `'grant'`, `at` the event's, `what` `'An admin gave you
  Aura'`, `details` `[\`An admin gave you ${plain(w.change)} Aura.\`]`, with `\` ${plain(w.overflow)} more didn't fit
  under your wallet's cap.\`` appended when `overflow > 0`, `aura` `w.change`, `wallet` `w.balanceAfter`, and
  `characters` `[]`.
- Tests first: a `grant` event gives that row in the All tab and in a character's tab; the overflow sentence appears only
  when `overflow > 0`; the wording is exactly as above; two grants at different times give two rows.
- If the fake data (`engine/ui/data/fake.ts`) or a story enumerates wallet kinds for an exhaustive switch, the type
  checker names it. Add `grant` there and nothing else.

## Review focus

- A grant and a concurrent purchase or settlement on the same wallet: does the lock order leave the event's
  `balance_after` true, and the events still summing to the balance?
- Does anything that reads `wallet_events` by kind (the card lines' `take`, `heldBack`, the report and appeal refunds)
  mistake a `grant` row for one of its own?
- `grant_aura` is `security definer`: is it reachable from any role other than the owner and `service_role`, including
  through a view or another definer function?
- An export holding a `grant` row imports again into a database with this migration (the e2e export round trip).
