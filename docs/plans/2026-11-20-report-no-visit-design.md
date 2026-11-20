Record, written 2026-11-20.

# A report judged a visit that opens none gets its price back: design

A design session for issue #616, dispatched with the owner's decision already made and the rest of the design left for
the owner to confirm in review. Its plan is `docs/plans/2026-11-20-report-no-visit-plan.md`. It changes how one
verdict ends, not how reports work.

## 1. What happens today

A player pays to report a post (`open_report`, latest in `supabase/migrations/0357_post_veils.sql`). The Mod on the
board's beat judges it, and `close_report` (`supabase/migrations/0107_reports.sql`) writes the verdict. On a `visit`
verdict it calls `start_visit` (latest in `0357_post_veils.sql`), and `start_visit` can open nothing:

| `start_visit` answers | When | Reachable from a report's `visit` verdict? |
|---|---|---|
| `null` | the post's author is a staff character | No. `open_report` refuses a staff post and `acts_report_guard` refuses a report of one; a player's character is never staff (`characters_staff_has_no_owner`) |
| `null` | the post's author is hidden (`author_veiled`) | Yes: a veil (a Whodunnit?) lands between the report being paid and its judgment. `open_report` refuses while the veil is up, so this is only the report paid just before |
| `{visit: null, repeat: true}` | an earlier visit of the post, ended and not reversed, already carried this charge (`visit_charge_repeats`: the same cause, rule number and board, or the same premise words) | Yes: a post visited after an earlier report on the same charge, once that visit has ended |
| `{visit: null, capped: true}` | a patrol's finding past the targeting cap | No: only cause `patrol` meets the cap |
| `{visit: <open visit>, joined: false}` | the charge is already on the visit open on the post | Yes, and a visit is open: not a no-visit (section 3) |

In the two reachable no-visit cases, `close_report` writes a `report_verdict` with no `visit_act`, writes the Mod's
in-character line (the model's, or the stock `visitArrived` line), and keeps the price. The reporter's log
(`engine/ui/log/lines.ts`) says the Mod "judged it and sent a visit", the report form
(`engine/ui/cards/Forms.tsx`) says "a visit is on its way to post #N" and "Your 0.25 Aura is spent", and the Mod's
public moderation log (`engine/ui/profile/modlog.ts`, read from `moves_log`) says the Mod "sent a visit". All three
are the glass speaking, and all three are untrue.

## 2. Decided by the owner

**A report whose `visit` judgment opens no visit gets its price back, with a plain log line saying so** (issue #616,
option 1, 2026-11-13: "616, refund."). Weighed by the issue and not chosen: keeping the price with a plain line (option
2), and leaving it (option 3). This design does not reopen it.

Everything below is recommended by this session, for the owner to confirm in review.

## 3. Which no-visit paths refund

**Recommended, for the owner to confirm in review: every `visit` verdict for which `start_visit` opens no visit is
refunded; a backfire that opens no visit is not.**

- **The veil** (`author_veiled`): refunded. The player paid for a visit, and the game's own rule (no Mod Bot visits a
  hidden author) stopped it.
- **The repeat** (`{visit: null, repeat: true}`): refunded. The player paid for a visit, and the game's own rule (a post
  is not charged twice for one breach) stopped it. The reporter did not choose the charge; the Mod did.
- **The staff post and the cap**: unreachable from a report (section 1). `close_report` treats an answer it cannot name
  as a fault: it raises, the transaction rolls back, and the staff function refunds the report as a failed judgment
  (`refund_report`, why `failed`), as it does for any database error before the verdict. A verdict is never written
  with a reason the code did not name.
- **The charge already on the open visit** (`joined: false`): not refunded. A visit is open on the post on that very
  charge, and the verdict links it (`visit_act`). "Sent a visit" is true of it.
- **A visit that opened and a trap ended at once** (`sprung`): not refunded. The visit opened; the trap is play.
- **A backfire that opens no visit** (the reporter has no post, or their latest post is hidden or already charged):
  not refunded. A backfire is the reporter's own punishment, and a punishment that did not land owes the reporter
  nothing back.

Weighed: refunding the veil alone, which is what the issue's report found. The repeat costs the player the same way
for the same kind of reason, and a rule that refunded one and not the other would need a sentence to explain why.

## 4. How the verdict and the refund coexist

**Recommended, for the owner to confirm in review: the verdict is still written, and a refund row is written beside
it, by `close_report`, in the same transaction and under the same lock.**

The judgment happened, it was billed, and its verdict is a public Act with the Mod's words; erasing it would hide what
The System did. The refund is the wallet's side of the same moment.

### 4.1 The invariant, before and after

Today (`0107_reports.sql`): "a report is closed once, or refunded once, never both." After:

> A report ends in exactly one of three ways, each decided under the report's own advisory lock: **a verdict alone**;
> **a refund alone**, why `failed` or `stale`, with no verdict ever after; or **a `visit` verdict with no `visit_act`
> and a refund beside it**, why `veiled` or `visited`, both written by `close_report` in one transaction. A refund
> of `failed` or `stale` is never beside a verdict, and a refund of `veiled` or `visited` is never without one.

What holds it:

- `close_report` and `refund_report` take the same lock, as today. `close_report` checks the verdict first (an
  existing verdict returns it, with its refund where it has one), then a refund (a report refunded with no verdict is
  not closed). Today it checks the refund first; with a refund that can sit beside a verdict, that order would answer a
  retried close of a no-visit report with "refunded before the Mod answered it", which is false.
- `refund_report` refuses a verdict, as today, and refuses a `why` other than `failed` and `stale`, so no service call
  can write a no-visit refund without its verdict.
- `refund_stale_reports` skips a report with a verdict, as today.
- A second refund is impossible twice over: `report_refunds.report_act` is its primary key, and the refund is in the
  transaction that inserts the verdict, which `acts_one_report_verdict` makes unique per report.

### 4.2 Where the reason is kept

**Recommended, for the owner to confirm in review: the refund's `why` names the reason, `veiled` or `visited`.**

| Weighed | For | Against |
|---|---|---|
| **`why` gains `veiled` and `visited`** | `report_refunds` keeps its shape; `my_reports` already serves `why` as `refund`, so `log_page` (latest in `supabase/migrations/0377_sealed_packs.sql`), the plain log read and the export need no change; the quota, which skips only `failed`, counts both with no change | `why` holds two facts at once: that the price came back, and why no visit opened |
| One `why`, `no_visit`, and a column naming the reason | each column one fact | a new column on an append-only table: `my_reports` and `log_page` widened to carry it, and the export's round trip with it |
| The reason on the public verdict Act (`acts_report_payload` gains a key) | the reason is public, and so may be | an out-of-character fact on an in-character Act; the log does not read the verdict's payload, so the read still widens |

`why` already means "why the price went back", and "the post's author was hidden" is that reason.

### 4.3 How `close_report` learns why

**Recommended, for the owner to confirm in review: `start_visit` names every no-visit.** It answers `{visit: null,
staff: true}` and `{visit: null, veiled: true}` where it answers `null` today, beside the `repeat` and `capped` it
already names. Every caller reads `->> 'visit'` (`draw_visits` in `supabase/migrations/0108_interception.sql`,
`close_report`) or `res?.visit` (`supabase/functions/staff/patrol.ts`), or ignores the answer, so none changes; two
tests that assert `null` change (`supabase/tests/0107-visits.sql`, `supabase/tests/0304-post-veils.sql`).

Weighed and rejected:
- `close_report` calling `author_veiled` again after a `null`. It decides a second time what `start_visit` decided
  under its lock: an admin's end of the veil, committed between the two reads, would make a veiled no-visit read as a
  staff post.
- `close_report` checking the veil before calling `start_visit`. A veil can land between the check and the call;
  `start_visit` takes the post's row for that reason.

## 5. The quota and the budget

**Recommended, for the owner to confirm in review: a no-visit refund counts toward the character's daily quota and
toward the instance's judgment budget, unlike a `failed` one.**

- **The budget.** The judgment was made and billed: its `reportJudge` call is in the ledger, which
  `judgment_calls_today` counts. A refund of the reporter's price gives nothing back to the instance's budget, and
  nothing is changed to make it count: `judgment_load_today` reads the ledger.
- **The quota.** The quota exists so that public reports are never free without end. A `failed` refund frees its slot
  because the player got nothing, not even a judgment. A no-visit refund makes the report free, and a player could
  arrange one: report a post, then veil it with a Whodunnit? before the judgment, and the report, with its public
  reason, cost nothing. Counting it keeps that bounded at the day's quota, as `stale` is counted for the same reason.
  Nothing is changed to make it count: `open_report` and `my_reports_left` skip only `failed`.

The log line and the form say plainly that it still counts (section 6), since a player who has seen a `failed` refund
free a slot would otherwise expect this one to.

## 6. The words

All of it is the glass: plain, true and out of character. **The copy below is proposed for the owner's approval in
review.**

### 6.1 The reporter's log (`engine/ui/log/lines.ts`)

After "Pipewrench reported post #42, for 0.25 Aura. The report is public.", in place of " The Clerk judged it and sent
a visit.":

- `veiled`: " The Clerk judged it a visit, but no visit opened: the post's author was hidden when it was judged. Your
  Aura came back (0.25). It still counts as one of Pipewrench's reports for that day."
- `visited`: " The Clerk judged it a visit, but no visit opened: the post had already been visited after a report on
  that charge, and a post is not charged twice for one breach. Your Aura came back (0.25). It still counts as one of
  Pipewrench's reports for that day."

The amount in brackets is the wallet's own refund event, as the `failed` line says it, and is left out where nothing
was paid. The row's Aura is the price less the refund: zero.

### 6.2 The report form (`engine/ui/cards/Forms.tsx`)

The result, in its status region, in place of "Your report was heard: a visit is on its way to post #N. Your 0.25 Aura
is spent.":

- `veiled`: "Your report was judged a visit, but no visit opened: post #N's author is hidden right now. Your 0.25 Aura
  came back. It still counts toward Pipewrench's reports today."
- `visited`: "Your report was judged a visit, but no visit opened: post #N was already visited after a report on that
  charge. Your 0.25 Aura came back. It still counts toward Pipewrench's reports today."

The Mod's own line follows, quoted, as it does today ("A Moderator said: “…”"). The amount is the one the answer says
came back.

The form's terms, in place of "If the Mod cannot judge it, your Aura comes back.": "If the Mod cannot judge it, or
judges it a visit and none can open, your Aura comes back."

### 6.3 The Mod's moderation log (`engine/ui/profile/modlog.ts`)

**Recommended, for the owner to confirm in review: built here.** A report row's end, today "sent a visit" for every
`visit` verdict, reads whether the verdict opened one. `moves_log` gains `visited` in a report row's `params`, from
whether the verdict's payload holds `visit_act`, a public Act's public field. Then:

- a `visit` verdict with no visit: "judged a visit, but none opened";
- a `backfire` with no visit: "backfired, but no visit opened";
- every other row as today.

Weighed: leaving it for a follow-up. It is the same untrue "sent a visit" in exactly this case, on a screen anyone can
read, and its fix is one field of a view and one branch of a function. The backfire's branch rides along because the
field is the same; nothing else about the backfire is changed here (section 9).

### 6.4 What is checked against the masks

Every reason is a public fact: a veil shows the stand-in to every reader, and `open_report` already tells anyone who
tries to report a veiled post that its author is hidden; an earlier visit and its charges are public Acts; `visit_act`
is on the public verdict. No reason reads who owns a character, who cast the veil, or anyone's class. The refund's
amount is what the reporter's own wallet paid. Nothing differs with who owns the post: a report across the reporter's
own masks is refunded, or not, as any other. The new `refund` in the staff function's answer goes to the reporter alone,
and `report_refunds` has no client read.

## 7. The Mod's in-character line

**Recommended, for the owner to confirm in review: unchanged.** The verdict keeps the line the Mod wrote, or the stock
`visitArrived` line where it wrote none, though no visit opened. The fiction may lie; the log, the form and the
moderation log now say what happened.

Weighed: a new stock line (`reportNoVisit`) put in place of the Mod's when no visit opens. The model's line was paid
for and written before the visit was tried; replacing a Mod's words after the fact is The System being edited, and a
Mod that says "a visit is coming" when none does is one more bluff of the kind the game is made of.

## 8. Reports an instance already holds

**Recommended, for the owner to confirm in review: forward only.** The migration refunds nothing retroactively.

- The reason cannot be recovered after the fact for every row: a veil that has ended no longer shows it was up at the
  judgment, and `close_report` kept no record of which no-visit it met.
- A refund written now would move Aura into a wallet long after the fact, with a log line dated now about a report made
  then.
- The game is pre-alpha; the rows this leaves are few and are test play.

What such a row shows after this change: the reporter's log still says "judged it and sent a visit" (the log reads no
visit presence, section 9), while the Mod's moderation log says "judged a visit, but none opened", which it computes
from the public verdict. The plan's `Review focus` names this.

## 9. Found here, not built here

**The reporter's log and form say a backfire sent a visit when none opened.** "judged it a backfire: a visit went to
Pipewrench's latest post" (`engine/ui/log/lines.ts`) and "a visit is on its way to Pipewrench's latest post"
(`engine/ui/cards/Forms.tsx`) are untrue for a backfire whose reporter has no post, or whose latest post is hidden or
already charged. No refund is owed (section 3), but the glass must not say a visit went. The form has `visit` in its
answer and could say so at once; the log reads `my_reports`, which carries no visit presence, and `log_page` (latest in
`supabase/migrations/0377_sealed_packs.sql`) would have to be redefined whole to carry it. The same widening would also
make the pre-change rows of section 8 true. Filed as #846.

## 10. The layers, states and scale

- **Layers.** All engine: the SQL, the staff function, the API, the fake and the glass's words. No instance content
  and no new interface; the words name the Mod by its public name and the role by `modRole`, as today.
- **States.** None added. A report whose visit opened none is closed and refunded at once; nothing waits. The reporter
  may report the post again, within the quota: after the veil ends for `veiled`, and on any other charge for
  `visited`.
- **Scale.** One more branch per `visit` verdict, and at most one insert and one wallet move, inside a transaction that
  already holds the report's lock. `moves_log` reads one more key of a payload it already reads. Nothing grows with
  players, characters, threads or Acts beyond what a report already costs.
