Record, written 2026-11-21.

# The Trading Post: plan

Carries out `docs/plans/2026-11-21-trading-post-design.md` (the design; its sections are cited as "design, 3"). A
build session (`.claude/skills/build-session/SKILL.md`) builds it from this file alone.

**When it may start.** Any time. It may not start while another build redefines an object in the table below; it checks
open PRs for a migration that does.

**The shared SQL this build redefines.** Each is copied whole from its latest migration on `main` **at the time this
build starts**, with only the change named. Find each one's latest with
`grep -l -E "(function|view) (public\.)?<name>\b" supabase/migrations/*.sql | tail -1`. The column is `main` at
`f558174`.

| Object | Latest at `f558174` | Change |
|---|---|---|
| `card_ledger_kind_check` | `0207_random_events.sql` | four more kinds (Task 2) |
| `card_held(who, card)` | `0340_conduct.sql` | the four kinds in and out |
| `gear_held(who, gear)` | `0205_gear.sql` | rows out taken off |
| `my_wardrobe()` | `0368_client_reads_plan_once.sql` | counts by `gear_held`'s rule, not `count(*)` |
| `my_packs` (view) | `0377_sealed_packs.sql` | holder from `pack_holder`; `held`; contents only to the holder |
| `open_pack(pack)` | `0377_sealed_packs.sql` | the holder from `pack_holder` |
| `my_card_ledger` (view) | `0377_sealed_packs.sql` | carries `offer` |
| `seed_instance` | `0397_refund_outcome.sql` | a gear kind named by a trade line is not deleted |
| `settings_held()` | `0395_polls.sql` | the `trading` rule |
| `screen_settings` (view) | `0395_polls.sql` | lists `trading` |
| `log_page(in_before)` | `0396_poll_reads.sql` | a `trades` source; trade kinds out of `cards` and `cosmetics` |
| `cosmetic_log_rows` | `0213_cosmetics_log.sql` | leaves out the trade kinds |
| alerts' kind and toast checks | `0213_cosmetics_log.sql` | three kinds (Task 4) |

New objects, which no other build defines: the tables `trade_offers`, `trade_lines`, `trade_ends`, `trade_picks` and
`pack_moves`; the functions `pack_holder`, `trade_line_problem`, `trade_fill`, `post_offer`, `take_offer`,
`withdraw_offer`, `close_offer_as_admin`, `expire_trade_offers`, `schedule_trade_expiry`, `trading_page`,
`trades_recent`, `my_trade_log_rows`, `trade_alert`; the cron job `kayfabb-trade-expiry`.

**Overlap.** The card retirement plan (`docs/plans/2026-11-20-card-retirement-plan.md`), if it has not landed: its seed
moves or refunds "every copy an account holds" of a renamed or withdrawn card. Whichever build lands second makes that
seed first close every open offer whose lines name the card, as `close_offer_as_admin` does (escrow returned, a
`tradeClosed` alert), before it moves or refunds, and adds a test with a card in escrow. The job-health plan
(`docs/plans/2026-11-20-job-health-plan.md`), if it has landed: `kayfabb-trade-expiry` is registered as its design
prescribes (`JOBS`, `record_job_run`, a `job_runs` row).

The migration is the next free number when the build starts (`0402` at `f558174`), named `<n>_trading_post.sql`, with
the header convention of `0401_report_no_visit.sql`: what it does, each object copied whole and its one change, and
paragraphs on append-only, ways out, masks, and a busy instance's scale. Tasks 2 to 5 may be one migration file or
several consecutive files, one per task.

## Task 1. The rules: offers, groups and the fill

Model: sonnet

Files: `engine/rules/trades.ts` (new), `engine/rules/trades.test.ts` (new), `engine/rules/types.ts`,
`engine/rules/instance.ts`, `instances/divided-world/settings.ts`, `engine/rules/trade-fills.json` (new, the shared
case table).

1. **Types.** An item is `{ item: 'card', card: string } | { item: 'gear', gear: string } | { item: 'pack', kind:
   string }`. A group is `{ item: 'card', alignment?: 'sweet' | 'salty' | 'pepperoni', play?: 'cast' | 'set' | 'use',
   rarity?: Rarity } | { item: 'gear', rarity?: Rarity } | { item: 'pack', kind?: string }`. A give line is an exact
   card or gear with a count, or `{ item: 'pack', pack: Id }` (one particular pack, count 1). A want line is
   `{ exact: Item, n }` or `{ group: Group, n }`.
2. **`offerProblem(give, want, settings, catalog)`**: the first thing wrong, in plain words, or null. Each side has 1
   to `linesMost` lines and at most `copiesMost` copies. Every count is a whole number ≥ 1. A card or gear named is in
   the catalog. A pack is given at most once. Exact want lines name no item twice.
3. **`matches(group, kind)`**: whether a held kind (with its alignment, play and rarity, or its gear rarity, or its pack
   kind) is in a group.
4. **`fillOffer(want, holdings)`**: the greedy fill of design, 6. `holdings` is the caller's free copies by item, and
   their sealed packs with each one's kind and bought time. It takes exact lines first, then group lines ordered by how
   many held kinds the group matches (fewest first, ties in line order), each taking from the largest remaining stack
   (ties by key; for packs, the most recently bought first). It returns `{ picks: per line, missing: per line }`, and a
   line's `missing` is the copies it is short by.
5. **`picksProblem(want, picks, holdings)`**: whether hand-made picks fill each line exactly (an exact line its own
   item and count, a group line N copies that match), with no copy used twice and nothing beyond what is held.
6. **Settings.** `trading: { offerHours, openMost, linesMost, copiesMost }` in `engine/rules/types.ts`, its rule in
   `SETTINGS` (`engine/rules/instance.ts`, modelled on `pollOptionsMax`'s `whole`): `offerHours` 1 to 720, `openMost` 1
   to 50, `linesMost` 1 to 20, `copiesMost` 1 to 500. Divided World's values are 168, 5, 8, 60.
7. **The case table** `engine/rules/trade-fills.json`: at least 12 cases of a want, holdings and the expected
   `{ picks, missing }`, including two overlapping groups ("any 2 Sweet", then "any 1 rare" with only one rare Sweet
   held), packs, an exact line that empties a stack a group would have used, and a case the greedy fill misses that
   `picksProblem` accepts by hand.

**Tests first** (`engine/rules/trades.test.ts`): each `offerProblem` refusal with its words; `matches` on each
dimension; `fillOffer` against every case in `trade-fills.json`; `picksProblem` accepting the hand fill the greedy one
missed and refusing a copy used twice. The settings rule refuses `openMost: 0` and `offerHours: 721` (red first).

## Task 2. SQL: the tables, the ledgers and the holder

Model: sonnet

Files: the migration; `supabase/tests/<next>-trading-post.sql` (new); `supabase/tests/0005-default-deny.sql`;
`supabase/tests/0079-settings-held.sql`; `engine/rules/settings-held.test.ts` if its rows list keys.

1. **`trade_offers`**: `id uuid pk`, `account uuid not null references accounts`, `posted_at`, `ends_at` (from
   `trading.offerHours`, written once). **`trade_lines`**: `offer`, `side` ('give' | 'want'), `n` (line order),
   `count`, and either an exact item (`card` → card_kinds, `gear` → gear_kinds, `pack_kind` → pack_kinds, or `pack` →
   packs for a give line) or a group (`group_item` 'card' | 'gear' | 'pack', `alignment`, `play`, `rarity`,
   `pack_kind`), held by checks that one shape is set and a pack give line has `count = 1`. Index on
   `(card, side)`, `(gear, side)`, `(pack_kind, side)` for the item filter. **`trade_ends`**: `offer pk`, `how`
   ('taken' | 'withdrawn' | 'expired' | 'closed'), `taker uuid` (set iff taken), `at`. **`trade_picks`**: `offer`,
   `line`, and the item the taker gave (card, gear or pack) and its count. All four are append-only
   (`ledger_append_only` triggers, always enabled), with row level security on and **no policy**, and no grant to an
   API role.
2. **`card_ledger`** gains `offer uuid references trade_offers`, and the kinds `escrowed` and `traded_out` (out),
   `unescrowed` and `traded_in` (in), with a check that `offer is not null` exactly for those four. `card_held` counts
   them. **`gear_ledger`** gains the same column, kinds and check (the inline `kind in ('found','granted')` check is
   dropped by its generated name, found in `pg_constraint`), and `gear_held` becomes the ins minus the outs.
   `my_wardrobe` counts the same way. `set_outfit` is unchanged: it already reads `gear_held`.
3. **`pack_moves`**: `id`, `pack → packs`, `offer → trade_offers`, `kind` ('escrowed' | 'unescrowed' | 'traded'),
   `to_account` (null exactly when escrowed), `at`; append-only, row level security, no policy. Indexes
   `(pack, at desc, id desc)` and `(to_account)`. **`pack_holder(pack) returns uuid`** (stable, definer, granted to no
   API role): the latest move's `to_account`, or `packs.account` with no move. A pack in escrow has no holder.
4. **`my_packs`** returns the packs the caller holds or bought, with `held boolean` (holder is the caller) and
   `contents` only when opened **and** held by the caller, so a buyer never reads the cards a taker pulled. **`open_pack`**
   locks the pack row and refuses, in its existing words, a pack whose `pack_holder` is not the caller. The hand's
   sealed packs (`sealedPacks` in `web/src/data/supabase.ts`) filter on `held`.
5. **`seed_instance`**: a gear kind named by a `trade_lines` row is kept, as one a ledger row names already is.
6. **`settings_held()`** gains the `trading` rule of Task 1, and `0079-settings-held.sql` its good row and a poison
   for each bound.

**Tests first** (in the new SQL test file): an `escrowed` row with no offer is refused; `card_held` and `gear_held`
fall by an escrow and rise by an `unescrowed`; an UPDATE and a DELETE on each new table are refused; `pack_holder`
follows two moves; `my_packs` shows a traded-away pack to its buyer with `held = false` and no contents after the taker
opens it; `open_pack` by the buyer of a traded-away pack is refused in the words used for a pack that does not exist.
`0005-default-deny.sql` asserts the new tables' append-only triggers fire always and that no API role reads them. The
existing `0001-core.sql` rule (no readable relation with an `account` column unless under row level security) must stay
green unchanged.

## Task 3. SQL: posting, taking, withdrawing and expiring

Model: sonnet

Files: the migration; the SQL test file; `tools/import-instance.mjs` (reschedules the job after an import, beside the
others at its rescheduling block).

1. **`trade_line_problem(lines jsonb, side text) returns text`**: SQL's half of `offerProblem` (Task 1, item 2), in
   the same words.
2. **`post_offer(who uuid, give jsonb, want jsonb) returns jsonb`** (definer, service role only, called through `act`
   as `buy_pack` is):
   - Locks `accounts where id = who for no key update`, then `pg_advisory_xact_lock(hashtext('kayfabb.outfit'),
     hashtext(who::text))` when gear is given.
   - Refuses an offer at `openMost` ("You have 5 open offers; withdraw one or wait for one to end"), a shape problem, a
     card short in `card_held`, a gear short in **free** copies (`set_outfit`'s rule: held minus worn by any of the
     account's characters), or a pack not sealed or not held by `who`, each naming the item.
   - Writes the offer, its lines, an `escrowed` ledger row per copy (card and gear), and an `escrowed` pack move per
     pack. Returns the offer's id and `ends_at`.
3. **`take_offer(who uuid, offer uuid, picks jsonb) returns jsonb`** (service role only):
   - Locks the offer row `for update` **first**. It refuses "This offer is no longer open" when it has a `trade_ends`
     row or `ends_at <= now()`, and "That's your own offer" when `account = who`.
   - Then locks `who`'s account row and, when gear is picked, `who`'s outfit lock. **It takes no lock on the
     offerer's account or outfit** (design, 5).
   - Checks the picks with SQL's half of `picksProblem`, against `who`'s free copies and held sealed packs. A shortfall
     names the item and the count missing.
   - Writes: `traded_out` rows for the taker's picks; `traded_in` rows to the taker for each escrowed copy; `traded_in`
     rows to the offerer for each pick; `traded` pack moves both ways; `trade_picks`; the `trade_ends` row
     (`how = 'taken'`, `taker = who`); the `tradeTaken` alert (Task 4). Two takes at once: the second waits on the
     offer row, then finds the end.
4. **`withdraw_offer(who uuid, offer uuid)`** (service role only): locks the offer, refuses one that is not `who`'s in
   the same words as one that does not exist ("No such open offer"), writes `unescrowed` rows, `unescrowed` pack moves
   back to `who` and the end.
5. **`close_offer_as_admin(offer uuid)`** (authenticated, guarded by `only_admins`, as `close_poll_as_admin` in
   `0395_polls.sql` is): the same return of the escrow, `how = 'closed'`, and a `tradeClosed` alert.
6. **`expire_trade_offers()`**: up to 500 offers with `ends_at <= now()` and no end, `for update skip locked`, each
   returned as a withdrawal is, with `how = 'expired'` and a `tradeExpired` alert. **`schedule_trade_expiry()`**
   schedules `kayfabb-trade-expiry` every 5 minutes (modelled on `schedule_search_rebuild`, `0117_search.sql`), called
   once in the migration and again by `tools/import-instance.mjs`.

**Tests first:**
- a post escrows, and `card_held` falls by its counts;
- a post of a worn gear copy is refused, and the same copy unworn posts;
- a post at the cap is refused;
- a take moves every item both ways, and both hands balance;
- a take of a withdrawn offer, of an expired-but-unswept offer, and of a taken one is refused in the one sentence;
- a take of one's own offer is refused;
- a take short one copy names it;
- two takes from two sessions at once (the suite's concurrency harness, as the face-down tests use it) produce one
  trade;
- **a take completes while the offerer's account row is locked by another session** (the masks' timing: red first by
  briefly writing the take with that lock);
- withdraw by another account reads as no offer;
- expiry returns the escrow and writes the alert;
- an admin close by a non-admin is refused.

## Task 4. SQL: the reads, the log and the alerts

Model: sonnet

Files: the migration; the SQL test file; `supabase/tests/0005-default-deny.sql` (`callable`);
`supabase/tests/0320-client-reads-plan-once.sql` if it lists reads; `engine/rules/alerts.ts`;
`engine/rules/alerts.test.ts`; `instances/divided-world/settings.ts` (`toastDefaults`); `tools/check-web-reads.mjs`
(`ALLOWED_RPCS`); `engine/rules/trade-fills.json` (read by the SQL test as well).

1. **`trade_fill(want jsonb, holdings jsonb) returns jsonb`**: the SQL fill, the same as `fillOffer`.
   **`trading_page(tab text, item jsonb, can_fill boolean, before jsonb) returns jsonb`** (authenticated, plpgsql,
   `force_generic_plan`, `jit = off`, as `0368_client_reads_plan_once.sql` writes reads):
   - `tab` is 'open' or 'mine'. Each row carries the offer's id, its lines (a pack as kind and `to_char(bought_at,
     'YYYY-MM')`, never its id), `posted_at`, `ends_at`, and `mine`.
   - The account itself is never returned.
   - 'mine' also returns the caller's open count and `openMost`.
   - `can_fill` keeps the open offers whose `trade_fill` against the caller's own holdings misses nothing, before
     paging.
   - Pages by keyset of 25.
2. **`trades_recent(before jsonb) returns jsonb`**: taken offers by the end's time, keyset of 25, each with its give
   lines and the taker's picks (as items, packs as kind and month) and the end's time. No account, no taker.
3. **The log.** `my_trade_log_rows(in_before, most)` (definer, the caller's own): one row per trade event the caller
   was party to (posted, taken as offerer, took as taker, withdrawn, expired, closed), each with what went out and what
   came in. `log_page` gains a `trades` source from it, and its `cards` and `cosmetics` sources leave out the four trade
   kinds, so nothing shows twice.
4. **Alerts.** The kinds `tradeTaken`, `tradeExpired` and `tradeClosed` join `WRITTEN_KINDS` (`engine/rules/alerts.ts`)
   and the alerts' kind and toast checks. `trade_alert(account, kind, offer)` inserts with a null character and a null
   act, and calls `broadcast_later('account:' || account, 'alert', ...)`, as `trophy_awards_alert` (`0213`) does.
   Divided World's toast defaults: all three on.

**Tests first:**
- `trading_page`'s JSON has no key `account`, `taker` or `pack` id at any depth, for either tab;
- `mine` is true only on the caller's offers;
- `can_fill` keeps exactly the offers the case table says;
- **every case in `engine/rules/trade-fills.json` gives the same `{picks, missing}` from `trade_fill` as from
  `fillOffer`** (the agreement test; red first with one case's expected output changed in the SQL harness only);
- `trades_recent` shows a taken offer and not a withdrawn one;
- the log shows one line per trade event and no ledger line of a trade kind;
- the alert is the offerer's and not the taker's.

## Task 5. The export

Model: haiku

Files: `supabase/tests/e2e/0003-export.ts` only.

Add `trade_offers`, `trade_lines`, `trade_ends`, `trade_picks` and `pack_moves` to `HELD`, and to the fixture one open
offer (a card given, a group wanted), one taken offer (with its picks and a traded pack's two moves) and one expired
offer, written through `post_offer`, `take_offer` and `expire_trade_offers` as the fixture writes other rows. The
export itself needs no change (`tools/instance-files.mjs` exports every public table). Run the round-trip test and show
it green.

## Task 6. The data layer and the actions

Model: sonnet

Files: `engine/rules/actions.ts`, its test; `engine/ui/data/api.ts`; `web/src/data/supabase.ts`;
`engine/ui/data/fake.ts`; `engine/ui/player.tsx`; `tools/check-web-reads.mjs`.

- **Actions.** `postOffer`, `takeOffer` and `withdrawOffer` in `decide()`, each `asService: true`, as `buyPack` is.
  Each checks its shape with Task 1's `offerProblem` or `picksProblem` and throws `Refused` with the same words before
  any call. `who` is the session's account, never the request's.
- **The API.** `tradingPage`, `tradesRecent`, `postOffer`, `takeOffer`, `withdrawOffer` and `closeOfferAsAdmin` in
  `api.ts`, implemented in `supabase.ts` and in the fake (which holds offers in memory with the same refusals). The
  log's `trades` source is mapped in `toLogRead` and `logPage`.
- The two reads and the admin close are added to `ALLOWED_RPCS`.

**Tests first:** each action refuses a bad shape before calling; the fake refuses a take of one's own offer; the
supabase mapping of a `trading_page` fixture.

## Task 7. The Trading Post page

Model: sonnet

Files: `engine/ui/trading/TradingPost.tsx`, `PostOffer.tsx`, `TakeOffer.tsx`, `trading.css` and their tests (new);
`engine/ui/glass-routes.tsx` (`GlassScreens`, a document route `/trading` with `loadTrading` and `tradingKey`);
`engine/ui/glass-docs.ts`; `engine/ui/loaded.tsx` (`SCREENS`); `web/src/App.tsx` (`lazyScreen`);
`engine/ui/glass/nav.ts` (`GLASS_NAV.trading`); `engine/ui/glass/MenuBar.tsx` (a tab after the Vending Machine) and
`MenuBar.test.tsx`; `engine/ui/types.ts` (`tradingPostName`, and `'trading'` in `GlassSurface`, checked by
`instanceUiProblems` as `shopName` is, at most 20 characters); `instances/divided-world/ui/index.ts`
(`tradingPostName: 'Trading Post'`); `instances/divided-world/ui/glass.json` (the surface's smoke);
`e2e/glass-screens.ts`; `e2e/a11y.spec.ts` (`GLASS`).

Build to the brief in design, 7, in the glass's existing parts: `PageHead`, `CalmRegion`, `GlassButton`, the
`Overlay` dialog (a bottom sheet on a phone, as the glass's other dialogs do), and the item faces the hand, the
wardrobe and the machine draw (`engine/ui/cards/faces.ts`, `engine/ui/gear/Outfit.tsx`, `engine/ui/vending/PackArt.tsx`).
Read `.claude/skills/impeccable/reference/craft-floor.md` before the first edit, and run `impeccable detect` on the
finished files.

- The tabs are a real tablist (arrow keys, `aria-selected`). The rows are a list, each with its Take as a button named
  for the offer ("Take: 12 Whoops! for any 3 Sweet cards").
- The composer's tray lists only what can be offered, and a worn gear shows its unworn count with a link to the
  dress-up page. The plain sentence names the expiry date. Post is disabled with the reason at the cap.
- The Take dialog prefills with `fillOffer`, lets each group pick be changed among matching held items, names what is
  missing in Salty pink with words (never color alone), and keeps Take off until `picksProblem` is null.
- "This offer is no longer open" closes the dialog, says so in a status line, and reloads the list.
- Withdraw asks once ("Withdraw this offer? 12 Whoops! come back to your hand.").

**Tests first:**
- the page renders each state of design, 7.4 against the fake;
- the tablist's keys;
- a Take's prefill and a swapped pick;
- Take disabled with the missing line;
- the composer refusing at the cap;
- no DOM text naming a character or account (render with a fake whose characters' names are known, and assert none
  appears);
- `MenuBar.test.tsx` lists the new tab.

Screenshots at 390 and 1280 of each tab and both dialogs, at deviceScaleFactor 2, attached to the PR.

## Task 8. The log lines, the alerts' words and the admin page

Model: sonnet

Files: `engine/ui/log/lines.ts` (`LineKind`, `ORDER`, a `tradeRows` builder) and its test; `engine/ui/data/api.ts`
(the log's trade type); `engine/ui/alerts/words.ts`, `toast-kinds.ts`, `AlertIcon.tsx`; `engine/ui/admin/AdminPages.tsx`
and a new `engine/ui/admin/Trades.tsx` with its route (`GLASS_NAV.adminTrades`) and loader.

- The log's words are design, 8's, item names from the instance's UI, packs as their kind's name and month.
- The alerts: "Your trade offer was taken." / "Your trade offer expired; its items are back in your hand." / "An admin
  closed your trade offer; its items are back in your hand." Each opens the Trading Post's Mine tab.
- The admin page lists open offers (as the public list shows them: no account) with Close, which asks once.

**Tests first:** a line for each trade event; no line for a trade-kind ledger row; each alert's words; the admin page's
Close for an admin and its absence for anyone else.

## Task 9. The build

Model: inline

`npm run typecheck`, `npm run build:ci`, the SQL suite and the e2e shards the glass touches. The output of each is
shown in the PR.

## Review focus

- **A take must never wait on the offerer.** Any lock, read of the offerer's hand or `card_held(offerer, …)` in
  `take_offer` makes a take's timing measure the offerer's activity at that moment.
- **No pack id, account or taker in any public payload**, including nested lines, `trades_recent`'s picks and the
  admin page.
- **Escrow balances.** For every offer, the sum of its ledger rows and pack moves returns each copy to exactly one
  account, whichever way it ended, including an expiry racing a take, and a withdrawal racing the sweep.
- **The fill's two halves.** `trade_fill` and `fillOffer` agree on the case table, and Take never trusts the fill:
  it checks the picks.
- **`can_fill` at the bound**: `trading_page(can_fill => true)`'s plan and time with `openMost` × 1,000 accounts of
  open offers.
- **Existing hands.** `card_held`, `gear_held` and `my_wardrobe` give the same counts as before on an instance with no
  trades (compare before and after the migration on the fixture).
- **A sealed pack bought, then traded, then opened**: the buyer's log keeps its bought line and never shows its cards.
- **Gear worn and offered**: no path escrows a copy a character wears, including two posts at once by one account.
