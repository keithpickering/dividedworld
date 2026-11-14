# Cursor bounds a generic plan can seek on: design

Record, written 2026-11-14. Designed with the owner in a design session. The plan is
`docs/plans/2026-11-14-cursor-bounds-plan.md`.

## 1. The problem

`docs/plans/2026-11-13-plan-once-design.md` §3 sets `plan_cache_mode = force_generic_plan` on every client read, so
each statement is planned once with its arguments unknown. Paged reads bound their cursor with a catch-all predicate,
`(in_before is null or <col> <= in_before)`. A generic plan can't know whether the argument is null, so it can't make
`<col> <= in_before` an index condition. It reads every row the other conditions allow and then filters them.

The probe (2026-11-14) replayed every migration into Postgres 16 on localhost. It prepared each of `log_page`'s 20 view
branches under `force_generic_plan` with `enable_seqscan = off`:
- **Catch-all form:** none of the 20 branches seeks on the bound.
- **`<col> <= coalesce($1, 'infinity')`:** the bound is an index condition on every branch whose view has an index
  for it, which is 10 of 20: `my_wallet_events`, `my_draws`, `my_walls_drawn_on`, `my_posts_played_on.at`,
  `my_cards_ended`, `my_infractions`, `my_bans`, `my_group_moves`, `my_reports`, `my_appeals`.

It already costs on main today, not only once plan-once lands. Postgres 16 plans the statements of a `language sql`
function that can't be inlined (every one carrying `set search_path`) with its arguments as unknown parameters, which is
generic in effect. Measured on localhost, with a player holding 20,000 `wallet_events`, a `log_page`-shaped read:
- catch-all form, cursor 19,000 rows deep: reads **19,199** rows to return 200;
- infinity form, the same cursor: reads **200**;
- infinity form, first page (null): reads **200**.

Deep pagination in the log is O(depth) today, on every branch that has an index. Plan-once would bring the same cost to
its `plpgsql` reads, so this change goes before plan-once as well as fixing what runs now.

## 2. Decided: an infinity bound in place of the null branch (the owner's choice)

Every cursor bound is written so that a null argument becomes an extreme value. The predicate is then always one range
comparison:
- a "before" bound: `<col> <= coalesce(in_before, 'infinity')` (`<` where the function used `<`);
- a "since" bound: `<col> > coalesce(since, '-infinity')`;
- a keyset bound with a tie-breaker: `(a.at, a.id) < (coalesce(before, 'infinity'), coalesce(before_id, <nil uuid>))`.
  It replaces `before is null or a.at < before or (before_id is not null and a.at = before and a.id < before_id)`. The
  two give the same rows: with no `before_id`, a row at exactly `before` would need an id below the nil uuid, which no
  id has, so the comparison is a strict `a.at < before`. With no `before`, every row is below infinity. A row
  comparison is an index condition on an `(at, id)` index.

The argument and the API don't change, and null still means "from the newest". The repository already uses this form:
`my_alerts`, `updates` and `season_news` bound their cursors with `coalesce($1, 'infinity'::timestamptz)`.

Alternatives weighed:
- **Make null impossible** (the client always sends a timestamp). This changes the API in `web/src/data/supabase.ts` and
  `engine/ui/data/api.ts`. The first page would send `now()`, which can miss a row written in the same instant, so it
  would end up sending infinity anyway.
- **Two queries, one for null and one for a timestamp** (IF/ELSE, or dynamic SQL). That's two copies of a 20-branch
  query, which "Two lists that must agree are one list" forbids, or SQL built from strings, which gives up the checks a
  `begin atomic` body gets when the migration runs. The generic plan it gets is the same one the infinity bound gets.
- **Exempt the paged reads from the generic plan** (`force_custom_plan`). This reverses the plan-once design's §3 for
  the busiest paged reads, and the problem comes back when someone removes the exemption.
- **Keyset pagination with a tie-breaker cursor for `log_page`.** `log_page` already pages by keyset. It has no
  `OFFSET`. Each branch orders and limits to 200 on its own, so the outer read merges a bounded number of rows at any
  depth. The client already handles ties: `readLogPage` cuts the page, and a page that wouldn't move the cursor makes a
  second read at that instant (the glass-load design, section 9). A combined cursor across 23 sources with different
  id types would replace a mechanism that works.

## 3. Scope: the six functions, and a guard for all of them

The probe's catalog scan (the guard in plan Task 1) finds a cursor catch-all in exactly six live functions:
`log_page` (20), `cosmetic_log_rows` (6), `trophies_of`, `admin_awards`, `belt_lineage` and `staff_notes_recent`. All
six are rewritten.

Other `<arg> is null or` patterns are out of scope:
- **Optional equality filters** (`rules_in_force`, `rule_conflict`, `rule_breaks`, `drive_plays`, `season_page`).
  These filter a small table or a JSON key that has no index, so a seek has nothing to gain.
- **Argument validation** (`conduct_write`'s `ends is null or ends <= now()`, `pool_signals`' `since is null or ...`).
  These aren't predicates on a table.

The guard looks for range comparisons against a column, not against an argument, a literal or a function call, so it
doesn't flag these.

## 4. Decided: views that can't seek on time under any plan go to a design of their own (issue #673)

The probe also found 10 branches whose time column has no index under it, so no plan seeks on it, a custom plan with a
real timestamp included. It also found branches that seek on `acts` by `created_at` across every player and filter to
the caller's afterwards. These are a separate concern: they don't seek today, and plan-once doesn't make them worse.
The owner chose to file them as issue #673, with the probe's table, for a design session of their own, rather than
widen this one. That design involves choices such as a column like `ledger.ends_at` written at insert.

## 5. The rules

- **Layers:** all engine. No instance content, and no interface changes.
- **Ways out:** no state is added.
- **The masks:** every rewritten read returns the same rows as before for every argument, so no response changes. The
  bounds read only the caller's own cursor.
- **Scale:** the gain is exactly that a generic plan reads what a custom plan reads, on every bound that has an index.
  The views that can't seek at a busy instance's scale are #673's.

## 6. Open

Nothing.
