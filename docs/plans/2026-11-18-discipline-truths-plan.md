Record, written 2026-11-18.

# Discipline's truths: plan

Carries out `docs/plans/2026-11-18-discipline-truths-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npm run test:sql` for the migration, `npx vitest run <file>` for the screens',
`node --experimental-strip-types --test <file>` for the Edge Functions' tests). Run `npm run typecheck` and
`npm run build` once after the last task, with the tail in the PR. No deployed database, bucket or connector is
touched; SQL is tested against Postgres on localhost.

**One migration**, the next free number at build time (0377 as this is written), named `discipline_truths`, with one
SQL test file of the same number. Every function it changes is written whole with `create or replace` from its latest
definition, named in each task, and keeps its signature, security, search_path and grants unless the task says
otherwise.

**The layers.** All of it is the engine's. No class, card or persona is named; the words added are out-of-character
refusals and log lines, which are the engine's plain words.

**The masks.** Nothing added reads who owns a character, a class or who reacted. The appeal's new refusal is computed
from the character's own public ban Act; the report's refund from a public veil or a public visit on the post. No
Realtime event or timing is added.

**States.** None added. A report refunded as `hidden` names its way out in the log line (report again once the
author shows).

**Scale.** Task 1 adds one read of a character's bans by `acts_bans`, on a refusal only. Task 2 adds one text
comparison to a lookup already bounded by the Acts on one post. Task 3 adds one insert and one wallet event to a
`close_report` that opens no visit.

## Task 1. An infraction a ban emptied says so

Model: sonnet

**Files:** the migration; `supabase/tests/` (the new file, and `0111-appeals.sql` where its three "already run out"
cases are asserted); `supabase/functions/staff/appeal.ts` and `appeal.test.ts`; `engine/ui/data/api.ts` (the appeal
row's `refund` type, line 1922 as written); `engine/ui/data/fake.ts` (its `open_appeal` refusal, near "that
punishment has already run out"); `engine/ui/log/lines.ts` (the appeals loop) and its test.

**SQL.**

- A new function `infraction_emptied_at(infraction uuid) returns timestamptz`: the `created_at` of the first ban of
  the infraction's character that landed after it, null where none has. `stable`, `security definer`, executable by
  `service_role` only. It is the read `my_infractions.emptied_at` already makes (`0361_discipline_cards.sql`); the
  view is left as it is.
- `appeal_refunds.why` also allows `banned` (drop and add its check constraint, `0109_appeals.sql`).
- `open_appeal` (latest: `0135_group_appeals.sql`): before its `punishment_running` refusal, an infraction that has
  not expired and whose `infraction_emptied_at` is not null is refused with, exactly:
  `these warn points filled the bar and a ban took their place on <day> UTC; the ban is what can be appealed`
  (`<day>` as `to_char(at time zone 'UTC', 'YYYY-MM-DD')`), hint `kayfabb.refusal`, errcode `55000`. Every other
  refusal and their order stand.
- `close_appeal` (latest: `0361_discipline_cards.sql`): in its `not punishment_running` branch, the same infraction
  is refunded with `refund_appeal(ap.id, 'banned')` and returns `closed: false, refunded: true, banned: true` with
  the reason, exactly: `a ban landed before this appeal was heard and took these warn points' place, so nothing was
  ruled and your Aura is back; the ban is what can be appealed`. Any other punishment that is not running keeps
  `expired` and its words.

**The Edge Function.** `appeal.ts`'s `Closed` gains `banned`; the 409 answer for `closed.banned` carries
`banned: true` and the database's reason.

**The log.** In `lines.ts`, an appeal with no verdict and a refund reads by its reason:

- `failed`, `stale`: today's words, unchanged.
- `expired`: ` The punishment ran out before the appeal was heard, so nothing was ruled and your Aura came back.`
- `banned`: ` A ban took these warn points' place before the appeal was heard, so nothing was ruled and your Aura
  came back. The ban is what can be appealed.`

**Tests first.** SQL: an infraction emptied by a ban is refused with the new words and the ban's day; an expired
infraction and an ended ban keep "already run out"; an appeal open on an infraction when a second infraction fills
the bar is refunded as `banned`, once, with no ruling, and `my_appeals.refund` reads `banned`; the ban of that
character can then be appealed. Log: one row for each of the four refund reasons, asserting that `expired` and
`banned` do not contain "appeal again". Function: a `closeSays` of `banned` answers 409 with `banned: true`.

## Task 2. A house rule's charge is marked

Model: sonnet

**Files:** the migration; the SQL test file (and `0107-visits.sql`, `0109-reports.sql` where a house charge's shape
is asserted); `engine/ui/data/fake.ts` (`SeedCharge`, the charge mapping near line 852, `ruleWords` near line 2906,
and wherever the fake decides a repeat charge); `engine/ui/data/api.ts` (`VisitCharge`, if the screens read the
marker; they need not).

**SQL**, each from its latest definition:

- `draw_visits` (`0108_interception.sql`): the charge built for a rule with `r.board is null` carries
  `'house', true`.
- `close_report` (`0107_reports.sql`; Task 3 changes it too, so the two tasks are one definition): the charge built
  from a `rule_row` with `board is null` carries `'house', true`.
- `start_visit` (`0357_post_veils.sql`): `ch` keeps `house` when the charge passed has it true, and leaves the key
  out otherwise.
- `visit_charge_matches` (`0345_visit_charge_lookup.sql`): a match also needs
  `coalesce(c.charge ->> 'house', 'false') = coalesce(ch ->> 'house', 'false')`. Its plan must stay as 0345's header
  describes it: the comparison is added to the outer `where` only.
- `infract` (`0361_discipline_cards.sql`): a new last parameter `house boolean default false`; the infraction's
  payload carries `'house', true` when it is, and no key otherwise. Drop the old signature and re-grant as 0361 does.
  The infraction payload constraint (0361, near line 1408) also allows a `house` key that is the boolean `true`.
- `file_visit` (0361, near line 1609) passes the top charge's `house`; `close_appeal`'s `increased` (0361, near line
  1692) passes the appealed infraction's.
- `punishment_words` (`0109_appeals.sql`): the charge is matched on `rule_number` and on the marker, and the
  fallback for a numbered rule is `'House Rule N'` where the infraction is marked.

A charge or an infraction with no marker reads as a board rule's. No fill is run.

**Tests first.** A post that breaks House Rule 1 (minor) and its board's Rule 1 (severe) holds both charges on one
visit and files the severe band, where today the second is dropped (the red run shows one charge). A second draw of
either charge on that post is still a repeat. A house infraction's `punishment_words` begin "House Rule 1", and a
board infraction's on the same post begin "Rule 1". A charge written without the marker (inserted as 0345 wrote
them) still matches a board rule's charge and not a house rule's. 0345's row-read bound on the lookup still holds
(`supabase/tests/` has its guard; run it).

## Task 3. A visit verdict that opens no visit gives the price back

Model: sonnet

**Files:** the migration; the SQL test file (and `0109-reports.sql`); `supabase/functions/staff/report.ts` and
`report.test.ts`; `engine/ui/data/api.ts` (the report row's `refund` type, line 1905 as written);
`engine/ui/data/fake.ts` (its `close_report`); `engine/ui/log/lines.ts` (the reports loop) and its test;
`engine/ui/admin/Reports.tsx` if it prints a refund's reason.

**SQL.**

- `report_refunds.why` also allows `hidden` and `repeat` (`0107_reports.sql`).
- `close_report`: after the `report_verdict` Act is written, when the verdict is `visit` and `started` names no
  visit, the price goes back under the report's lock it already holds: a `report_refunds` row and a `wallet_move`
  of kind `refund` with `ref` the report, as `refund_report` writes them (move that pair into one private helper
  both call, so the two cannot drift). The reason is `repeat` where `started ->> 'repeat'` is true and `hidden`
  where `started` is null. Its answer gains `refunded: true` and `no_visit: 'hidden' | 'repeat'`.
- `refund_report` still refuses a report that has a verdict; `open_report`'s per-day count is unchanged, so a
  `hidden` or `repeat` report counts toward the day.

**The Edge Function.** `report.ts`'s `Closed` gains the two keys and its answer to the reporter passes them on.

**The log.** In `lines.ts`, a report whose verdict is `visit`:

- no refund: today's words.
- `hidden`: ` <Mod> judged it, but no visit opened: the post's author was hidden by then. Your Aura came back
  (<amount>). You can report the post again once the author shows.`
- `repeat`: ` <Mod> judged it, but no visit opened: the post had already answered for that rule. Your Aura came back
  (<amount>).`

The row's `aura` already adds what came back.

**Tests first.** SQL: a report paid, then a veil on the post, then `close_report('visit')`: the verdict Act has no
`visit_act`, one `report_refunds` row says `hidden`, the wallet is whole, and a second `close_report` answers
`existing` and moves nothing. The same for a post already visited for the charge, with `repeat`. A `visit` verdict
that opens or joins a visit refunds nothing. A `hidden` report still counts toward `per_day`. `refund_stale_reports`
passes over both. Log: the three lines, and that neither new line says "sent a visit".

## Task 4. The issues

Model: inline

In the PR's description: `Closes #616`. On #316, check F1 and Task 10, with a comment on Task 10 saying it does not
reproduce (an infraction a ban emptied cannot be ruled on; `0111-appeals.sql`) and what was changed instead. #316
stays open for its other items.

## Review focus

- What a visit, a join or an infraction written before the marker does when a marked charge meets it: a house charge
  drawn on a post whose earlier house charge has no marker is not a repeat and could visit twice.
- `visit_charge_matches`'s plan after the added comparison, under statistics gathered on an empty instance (0345's
  header).
- `close_report` called twice, or beside `refund_report` and `refund_stale_reports`: the price comes back once.
- A report refunded as `repeat` many times a day by one character: the per-day count and the judgment budget hold.
- Every reader of `appeal_refunds.why` and `report_refunds.why` (`appeal_blocks`, `open_report`'s count, the two
  `my_` views, the admin's Reports screen) with the new reasons.
- The export and import round trip with the two widened check constraints and the infraction's new key.
