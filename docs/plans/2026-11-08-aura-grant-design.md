# Aura grant: design

Record, written 2026-11-08. No screen, so no world; the one line it adds to the player's log is the glass's, plain and
never in character. All of it is engine; no instance file changes.

## 1. What the owner asked for

A way to give a player Aura, up to a full wallet, for testing. No UI is needed. The obvious route, an `update wallets`
by hand, would put Aura in a wallet with nothing in `wallet_events` to say where it came from. That breaks the wallet's
own invariant (its events add up to its balance, `supabase/tests/0008-wallet-history.sql`) and the log's ("The fiction
may lie; the log never does"). So the grant is a wallet move like any other: written by `wallet_move`
(`supabase/migrations/0003_aura.sql`) and recorded under a kind of its own, which the player's log shows.

## 2. Decided

**Who calls it: a SQL function, callable by the database owner and the service role only** (the owner chose this over
an admin RPC, or both). `grant_aura` is granted like `apply_settlement`: execute revoked from `public`, `anon` and
`authenticated`, and granted to `service_role`. The owner runs it from the Supabase SQL editor (which connects as the
owner) or `psql`. No player can reach it, and no signed-in admin is needed. An admin screen can wrap it later
without changing what it stores.

Weighed against it: an admin RPC behind `only_admins` (the shape a future admin screen wants, but with no UI it needs an
admin's access token, and the SQL editor's `auth.uid()` is null); and both at once (more surface than testing needs).

**What a call grants: an exact amount, or a fill when no amount is given** (the owner chose this over an amount only, or
a fill only). `grant_aura(account uuid, amount integer default null) returns jsonb`:

- `amount` is in hundredths, like every Aura amount in the database (`plain` in `engine/ui/log/lines.ts` shows 350 as
  "3.50").
- `null` fills the wallet to `setting('walletCap')`.
- A whole amount of at least 1 is credited through `wallet_move`. The cap clamps it, and the event records what did not
  fit as `overflow`, as a settlement's credit does.
- Zero or less is refused (`22023`, hint `kayfabb.refusal`): a debit is a different act and does not pass as a grant.
  A fraction cannot reach the function, because no numeric-to-integer cast is implicit.
- An account that does not exist is refused by name, never left to a foreign-key error.
- A grant that would move nothing (a wallet at or above its cap, including one above a cap an admin lowered) writes no
  row and returns `{"granted": 0, ...}`, so a log never says "gave you 0.00 Aura".
- It returns `{"granted": <change>, "overflow": <cut off>, "balance": <after>}`.

**What the log says: "An admin gave you 3.50 Aura."** (the owner chose this over naming the operators "for testing",
which might stop being true, or a terse "Aura granted: +3.50"). Where the cap cut some off, it adds: "1.00 more didn't
fit under your wallet's cap." It follows the log's existing admin voice ("An admin ended your…"). The caller is the
owner rather than a signed-in admin, so the row names no admin. "An admin" is true of whoever operates the instance.

**The kind is `grant`.** It is added to `wallet_events_kind_check` the way 0054, 0086 and 0107 to 0109 added theirs (drop
and re-add with the full list). `settlement` and `ref` are null.

## 3. Rules it answers to

- **Append-only.** It adds a `wallet_events` row and changes `wallets.balance` through `wallet_move`, the one writer. No
  ledger row and no Act: a grant is not scored, and a character's standing does not move.
- **The masks.** The event is the player's own, read through `my_wallet_events` (`account = auth.uid()`). Its log line
  belongs to the account, not to a character (`characters: []`, shown in every tab, like a purchase), so it says nothing
  about which mask the Aura is "for". No other player can see a grant or measure it.
- **No player is ever stuck.** It adds no state.
- **Portable.** `tools/export-instance.mjs` exports every table, and a `grant` row round-trips like any other kind.
- **The layers.** Engine only: a migration, the log line, and the `WalletEvent` kind.

## 4. Open

- Whether a live instance should keep this function once it has players, or have it only behind a future admin screen
  that names the admin. "Nobody is waiting on a hotfix" is rewritten when the game has players, and this is worth
  revisiting then.
