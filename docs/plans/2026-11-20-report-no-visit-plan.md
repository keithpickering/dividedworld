Record, written 2026-11-20.

# A report judged a visit that opens none gets its price back: plan

Carries out `docs/plans/2026-11-20-report-no-visit-design.md`. One PR from `main`, which closes #616. The design's
recommendations (sections 3 to 8) are the owner's to confirm in review; where the owner answers otherwise before the
build starts, the plan follows the answer.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code: `npm run test:sql` for the SQL (it replays every migration into a scratch database on the
local Postgres DATABASE_URL names), `node --experimental-strip-types --test <file>` for the staff function's and the
rules' tests, `npx vitest run <file>` for the screens' and the fake's. Run `npm run typecheck` and `npm run build` once
after the last task, with the tail in the PR. No deployed database, bucket or connector is touched.

**The rule, whole.** A report's `visit` verdict whose `start_visit` opens no visit, because the post's author is
hidden (`veiled`) or because an earlier visit of the post already carried the charge (`visited`), is closed with its
verdict, and in the same transaction its price goes back to the account that paid it, in a `report_refunds` row whose
`why` names the reason. It still counts toward the character's daily quota and the instance's judgment budget. A
backfire refunds nothing. Every other report ends as today.

**The layers.** All engine: SQL, the staff function, the API types, the fake, the web client's mapping and the glass's
words. No instance file changes.

**The masks.** Added: a `refund` in `close_report`'s answer (service only) and in the staff function's answer to the
reporter; the reporter's log line and form result, read from the reporter's own refund; `visited` in `moves_log`'s
report rows. Each is computed from a public fact (a live author veil shows the stand-in to every reader; an earlier
visit's charges are a public Act's; `visit_act` is on the public verdict) or the reporter's own wallet. None reads who
owns a character, who cast the veil, or a class, and none differs with who owns the post. No Realtime event, presence
update or timing is added; the refund's wallet event is the reporter's own, as a `failed` refund's is.

**States.** None added (the design, section 10).

**Scale.** One more branch per `visit` verdict, at most one insert and one wallet move under the report's lock, and one
more key read per `moves_log` report row.

**Reports already held.** Forward only: the migration refunds nothing it finds (the design, section 8).

## Task 1. The database: the reason named, the refund beside the verdict

Model: sonnet

**Files:** a new migration under `supabase/migrations/`, the next free number (today `0379`), named
`<number>_report_no_visit.sql`; a new test, `supabase/tests/<number>-report-no-visit.sql`, with the same number;
`supabase/tests/0107-visits.sql` (the staff post's `start_visit`, its section around "start_visit visited a staff
character's post"); `supabase/tests/0304-post-veils.sql` (the block "While the author is hidden no Mod Bot visits the
post").

The migration's header says what it changes, in the house form (what each function becomes, then Append-only, Ways
out, Masks and the cost at a busy instance's scale, from the plan's lines above). In it, in this order:

1. **`report_refunds.why`.** `alter table report_refunds drop constraint report_refunds_why_check`, and add it again
   as `check (why in ('failed', 'stale', 'veiled', 'visited'))`, with a comment: `veiled` and `visited` are a `visit`
   verdict that opened no visit, written beside the verdict by `close_report`, and counted toward the quota as
   `stale` is (only `failed` frees a slot). No column is added, so `my_reports`, `my_reports_left`, `open_report`,
   `log_page` and the export are unchanged.
2. **`start_visit`**, copied whole from `supabase/migrations/0357_post_veils.sql` with two lines changed: a staff
   post answers `jsonb_build_object('visit', null, 'staff', true)` and a hidden author
   `jsonb_build_object('visit', null, 'veiled', true)`, where each answers `null` today. Its comment says every
   no-visit is now an object with `visit: null` and one flag naming why (`staff`, `veiled`, `repeat`, `capped`), and
   that every caller reads `visit`.
3. **`pay_report_back(report_act uuid, why text) returns integer`**, new, `security definer`, `search_path = public,
   pg_temp`: the body of today's `refund_report` from "select w.account" to the wallet move, unchanged (the account and
   price from the `report` wallet event, the `report_refunds` row, `wallet_move(..., 'refund', null, report_act)` where
   the amount is above zero), returning the amount. It takes no lock and checks nothing: its callers hold the report's
   lock and have decided. Revoked from `public, anon, authenticated, service_role`.
4. **`refund_report`**, copied whole from `supabase/migrations/0107_reports.sql`, changed: before anything, a `why`
   other than `failed` or `stale` is refused (`raise exception 'refund_report refunds a failed or a stale report, not
   %', why using errcode = '22023'`); the payment is `pay_report_back`. Everything else as 0107 wrote it.
5. **`close_report`**, copied whole from `0107_reports.sql`, changed:
   - Under the report's lock, the verdict is checked first: a report with a verdict answers `existing` as today, and
     with `'refund', jsonb_build_object('why', f.why, 'amount', f.amount)` where `report_refunds` holds a row for it.
     Then a report with a refund and no verdict answers `{closed: false, refunded: true}` as today. (The staff
     function sends `close_report` again after a lost answer, `supabase/functions/staff/handler.ts`, so a repeat of a
     no-visit close must answer as the first did.)
   - On a `visit` verdict, after `start_visit`: where `started ->> 'visit'` is null, the reason is `veiled` where
     `started ->> 'veiled' = 'true'`, `visited` where `started ->> 'repeat' = 'true'`, and anything else raises
     (`'a report''s visit opened none, for no reason a report can meet: %'`, `P0001`), so nothing is written and the
     staff function refunds the report as `failed`.
   - The verdict is written as today (no `visit_act`, the line as today). Then, where there is a reason,
     `pay_report_back(r.id, reason)`, and the answer gains `'refund', jsonb_build_object('why', reason, 'amount',
     amount)`.
   - The backfire and the dismissal are as 0107 wrote them.
   - Its header comment states the invariant in the design's words (section 4.1).
6. **`moves_log`**, copied whole from `supabase/migrations/0329_bundles.sql`, with one change: a report row's
   `params` is `jsonb_build_object('post', p.seq, 'verdict', d.payload ->> 'verdict', 'visited', d.payload ?
   'visit_act')`. Columns, rows and grants as 0329 left them.

**Tests first**, in the new test file, its own world as `supabase/tests/0314-discipline-veils.sql` builds one (the seed
with a Mod on General's beat, the stand-in, `reportPrice` 25, `systemLines.visitArrived`, and a veil card kind of the
file's own, `t-rn-veil`, cast through `play_card` as that file's `pg_temp.veil` does). Each case reads the rows, not
only the answer:

- **The veil between the payment and the judgment.** Ann's character reports Bob's post (`open_report`, as Ann); a
  third player veils the post; `close_report(report, 'visit', 'Noted.', null)`: the answer is `closed` with
  `refund = {why: veiled, amount: 25}` and no `visit`; one `report_verdict` with exactly `{report_act, verdict: visit,
  line: 'Noted.'}`; no `visit` Act on the post; one `report_refunds` row (`veiled`, 25); one `refund` wallet event of
  25 on Ann's account referring to the report; Ann's wallet back where it was before the report.
- **The stock line still stands** where the Mod gave none, with no visit (the design, section 7).
- **The repeat.** A post visited after an earlier report on the board's premise, that visit ended (`end_visit`,
  `filed`); a second report closed `visit` with the same charge: refund `visited`, 25, no new visit. The same with the
  earlier visit still open: the verdict's `visit_act` is that open visit, and no refund row.
- **The same whoever owns the post.** Ann reports her own other mask's post, which is then veiled: the same answer, the
  same rows.
- **Twice closes once.** `close_report` again on the veiled report: `closed` false, `existing` true, the same `refund`,
  and no second verdict, refund row or wallet event.
- **The invariant's other doors.** `refund_report` on the veiled report: `refunded` false, `closed` true, nothing
  written. `refund_report(fresh, 'veiled')` and `refund_report(fresh, 'visited')` on a fresh, unjudged report: refused
  with 22023, nothing written. `refund_stale_reports` with the veiled report backdated past its age: 0, nothing
  written.
- **The quota counts it.** With `reportsPerDay` 2, a character whose first report was refunded `veiled` makes a second
  and is refused a third ("has made its 2 reports"); `my_reports_left` as its owner says 0.
- **The budget counts it.** With the report's `staff_call_records` and `model_calls` rows written as section 7b of
  `supabase/tests/0109-reports.sql` writes them, `judgment_load_today()` is the same before the close and after it.
- **A backfire refunds nothing.** A reporter with no post, and a reporter whose latest post is veiled: the verdict
  lands with no visit, and no `report_refunds` row.
- **What the reporter reads.** As Ann, `my_reports.refund` for the veiled report is `veiled`; for the repeat,
  `visited`.
- **The moderation log.** `moves_log` report rows: `visited` false for the veiled report and for the backfire with no
  post, true for a report whose visit opened.
- **`start_visit` names it.** A staff post: exactly `{"visit": null, "staff": true}`. A veiled post: exactly `{"visit":
  null, "veiled": true}`.
- **A reason it cannot name** (the file's last block, since it replaces a function for the rest of the transaction):
  `start_visit` replaced, in the file, by one answering `{"visit": null, "capped": true}`; `close_report` on a fresh
  report raises, and no verdict, refund or wallet event is written.

`supabase/tests/0107-visits.sql`'s staff-post check and `supabase/tests/0304-post-veils.sql`'s veiled check assert
the named answers in place of `null`.

Red runs to record: the new file before the migration (the veil case fails on its missing refund row, not on a
missing function); the two changed checks before the `start_visit` change.

**Poisons, each recorded in the PR with its red run, then put back:**
- Check the refund before the verdict in `close_report`, as today: "twice closes once" goes red (the repeat answers
  `refunded`).
- Map `repeat` to nothing (only `veiled` refunds): the repeat case goes red, on its missing refund row.
- Drop the `why` guard from `refund_report`: the invariant's other doors go red.
- Write the refund with why `failed`: the quota case goes red.

## Task 2. The staff function passes the refund on

Model: sonnet

**Files:** `supabase/functions/staff/report.ts` (`Closed`, `judge`, the header comment's steps 3 and 4),
`supabase/functions/staff/report.test.ts`.

`Closed` gains `readonly refund?: { readonly why: 'veiled' | 'visited'; readonly amount: number }`. `judge`'s answer
gains `refund: closed.refund ?? null`, beside `visit`. A close that answers `existing` passes its refund on the same
way. Nothing else changes: the 409 for a report refunded before its verdict is as today, and no path calls
`refund_report` after a close that answered.

The header comment's step 3 says `close_report` writes the verdict and the visit, or, where the visit verdict opens
none, the verdict and the price's refund, in one transaction; step 4 is unchanged.

**Tests first:**
- A visit verdict whose `close_report` answers `{closed: true, verdict: 'visit', line, refund: {why: 'veiled',
  amount: 25}}` with no visit (the fake's `closeSays`): status 200, `visit` null, `refund` as sent, and no
  `refund_report` call.
- The same with `existing: true`: the same body.
- Every existing verdict test's body has `refund: null`.

## Task 3. The API, the web client and the fake

Model: sonnet

**Files:** `engine/ui/data/api.ts` (`LogReport`, `ReportResult`), `web/src/data/supabase.ts` (the reports mapping in
the log read, `reports: src['reports'].map`, and `fileReport`), `web/src/data/supabase.test.tsx`,
`engine/ui/data/fake.ts` (`Seed.judging`, `judged`, `refundedReports`, `reportsLeftNow`, `fileReport`, the log's
`reports`, `movesLog`), `engine/ui/data/fake.test.tsx`.

In `api.ts`:

```ts
/** Why a report's price went back (`report_refunds.why`): its judgment failed, it was never judged, or it was judged a visit and none opened. */
export const REPORT_REFUNDS = ['failed', 'stale', 'veiled', 'visited'] as const;
export type ReportRefund = (typeof REPORT_REFUNDS)[number];
/** A `visit` verdict that opened no visit, and why: the post's author was hidden, or the post was already visited on that charge. */
export type NoVisit = Extract<ReportRefund, 'veiled' | 'visited'>;
```

`LogReport.refund` becomes `ReportRefund | null`. `ReportResult` gains
`readonly refund: { readonly why: NoVisit; readonly amount: number } | null`, its comment saying it is the price back
for a visit verdict that opened no visit, and null otherwise.

In `supabase.ts`: the log's report `refund` is `REPORT_REFUNDS.find((w) => w === r['refund']) ?? null`;
`fileReport` maps `a.value['refund']` to `{ why, amount }` where `why` is `veiled` or `visited` and `amount` a
number, else null.

In the fake, mirroring Task 1:
- `refundedReports` becomes a `Map<Id, ReportRefund>`; `reportsLeftNow` skips only `failed`; the log's report
  `refund` reads the map.
- `Seed.judging` gains `meanwhile?: () => void`, run once after the price is taken and before the verdict (the model
  call's window, in which a veil can land), then cleared.
- `fileReport`, on a `visit` verdict: where `liveVeils(post, 'author')` is not empty, no visit and refund `veiled`;
  else where a visit of the post that has not ended `reversed` carries a charge of cause `report` with the same
  `rule_number` (and the same `rule` where the number is null), and it is open, `visit` is that visit and nothing is
  written for it; where it has ended, no visit and refund `visited`; else a new visit, as today. A refund is
  `giveBack(account, price, report.id)` and the map's entry, and the answer carries `refund: { why, amount: price }`.
  The verdict Act carries no `visit_act` where no visit opened. (The fake's charges carry no board, and all of a post's
  charges are on its own board.)
- `movesLog`'s report row `params` gains `visited: typeof a.payload.visit_act === 'string'`.

**Tests first:**
- `supabase.test.tsx`: `fileReport` maps `refund: {why: 'veiled', amount: 25}` and answers `refund: null` where the
  function sends none (the existing test's expected value gains `refund: null`); the log's reports map `veiled` and
  `visited` and map an unknown why to null.
- `fake.test.tsx`, in the veil world: a report whose `meanwhile` veils the post answers `visit: null`, `refund:
  {why: 'veiled', amount: 25}`; the wallet is back; `reportsLeft` is one less; `log().reports[0].refund` is `veiled`;
  no visit Act is on the post. A post whose earlier report visit has ended: `visited`, the same. With that visit still
  open: `visit` is the open visit, no new visit Act, no refund. `movesLog` of the Mod: `visited` false and true on the
  matching rows.

## Task 4. The words

Model: sonnet

**Files:** `engine/ui/log/lines.ts` (the report rows), `engine/ui/log/lines.test.tsx`, `engine/ui/log/Log.test.tsx`
(the Mod Bots' lines), `engine/ui/cards/Forms.tsx` (`ReportForm`), `engine/ui/cards/forms.test.tsx`,
`engine/ui/profile/modlog.ts` (`endedModWords`), `engine/ui/profile/modlog.test.ts`.

The words are the design's, section 6, proposed for the owner's approval in the PR.

In `lines.ts`, the verdict branch for `r.verdict === 'visit'` reads `r.refund` first, with `gone` and `nameOf` as the
`failed` line has them:

- `veiled`: `` ` ${mod} judged it a visit, but no visit opened: the post's author was hidden when it was judged. Your Aura came back${amount}. It still counts as one of ${name}'s reports for that day.` ``
- `visited`: `` ` ${mod} judged it a visit, but no visit opened: the post had already been visited after a report on that charge, and a post is not charged twice for one breach. Your Aura came back${amount}. It still counts as one of ${name}'s reports for that day.` ``

where `mod` is `r.mod ?? 'The Mod'`, `amount` is `` gone > 0 ? ` (${plain(gone)})` : '' ``, and `name` is
`nameOf(r.character)`. Any other `refund` beside a `visit` verdict says what it says today.

In `Forms.tsx`, the result state carries the answer's `refund`. Where it is set, the status says, in place of the
`visit` sentence (with `auraWords(refund.amount)` and the HUD mask's name):

- `veiled`: "Your report was judged a visit, but no visit opened: post #{seq}'s author is hidden right now. Your
  {amount} came back. It still counts toward {mask}'s reports today."
- `visited`: "Your report was judged a visit, but no visit opened: post #{seq} was already visited after a report on
  that charge. Your {amount} came back. It still counts toward {mask}'s reports today."

The Mod's quoted line follows as today. The terms sentence becomes "If the Mod cannot judge it, or judges it a visit
and none can open, your Aura comes back."

In `modlog.ts`, `endedModWords` for a report: `visit` with `params.visited === false` is "judged a visit, but none
opened"; `backfire` with `params.visited === false` is "backfired, but no visit opened"; a row without the param
reads as today.

**Tests first:**
- `lines.test.tsx`: each of the two lines whole, with the wallet's report and refund events, and the row's Aura 0; a
  free report's line has no amount in brackets; a `visit` verdict with no refund still says "judged it and sent a
  visit."
- `Log.test.tsx`: a report through the fake whose visit opens none (the repeat, with the earlier visit ended) shows its
  line in the character's tab, and nothing of it in another player's log.
- `forms.test.tsx`: the terms sentence; the veiled result through the fake's `meanwhile`, in the status region, with
  the Mod's line after it and the count of reports left one less.
- `modlog.test.ts`: the two new endings and every existing one unchanged.

`node tools/check-visit-outcome-words.mjs` reads `endedModWords`; it must stay green, and the visit outcomes it holds
are not touched.

## Task 5. The build

Model: inline

`npm run test:sql`, `npm run typecheck` and `npm run build`, tails in the PR. In the PR: the issue's question as
settled, each of the design's recommendations as a numbered design question for the owner, each proposed sentence for
the owner's approval, and a link to the backfire finding (the design, section 9), filed as #846, which this PR does not
close.

## Review focus

- **Reports an instance already holds.** Nothing is refunded retroactively. A report closed before this change with a
  `visit` verdict and no visit still says "judged it and sent a visit" in its reporter's log, while the Mod's
  moderation log, computed from the verdict, now says "judged a visit, but none opened". Check no other read is made
  false by the change and that this one is the backfire issue's to fix (the design, sections 8 and 9).
- **The invariant, at every door.** Read `close_report`, `refund_report`, `refund_stale_reports` and `open_report`
  together and confirm a report can end in only the three ways of the design, section 4.1, including on a repeat of
  `close_report` after a lost answer and with two sessions closing one report at once (the report's lock and
  `acts_one_report_verdict`; no race test is added, so read it).
- **The quota and the budget.** Every reader that counts the day's reports (`open_report`, `my_reports_left`, the
  fake's `reportsLeftNow`) must free a slot for `failed` alone; check none tests `why <> 'stale'` or the like, which
  would free one for the new reasons. `judgment_load_today` leaves out a report with any refund from the reports in
  flight; a no-visit report has a verdict and a billed call, so it is the ledger's either way.
- **Two lists.** The `why` list is in the SQL check and in `REPORT_REFUNDS`, held together by the tests of Tasks 1 and
  3 and by no check. Say whether that is enough or propose a check with its poison.
- **`start_visit`'s new answers.** Every caller of `start_visit` (in SQL, `draw_visits` at its latest; in TypeScript,
  `supabase/functions/staff/patrol.ts`; and the tests) must read `visit` and never test the answer for null. Check
  none does, including any added on `main` since this plan.
- **A mask.** No reason given to the reporter depends on who owns the post, who cast the veil, or anyone's class; the
  answer and the rows are the same for a report across the reporter's own masks.
- **A paid answer.** The Mod's model call is billed and recorded before `close_report`, so a no-visit judgment is in
  the ledger like any other; check the refund touches no ledger row.
- **The words.** Each proposed sentence against what the code does in each case, and against the open visit, the
  trapped visit and the backfire, which say what they say today.
