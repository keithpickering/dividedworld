Record, written 2026-11-18.

# Discipline's truths (what a ban does to its infractions, a house rule's charge, a report that opens no visit): design

A design session with the owner, the first of three that came out of a scrub of the open issues for defects that
break a sum or treat a player unfairly. It answers #316's "Task 10" and "F1" and #616, all three in the Mod Bots'
discipline (`docs/plans/2026-11-06-mod-bots-design.md`, sections 5 to 7). Its plan is
`docs/plans/2026-11-18-discipline-truths-plan.md`. The other two sessions take the catalog changing under live play
(#612, #742) and forged quotes (#403).

## 1. After a ban, the ban is what is appealed (#316, Task 10)

**What the issue said.** "Overturning an infraction leaves a ban it caused standing (the log line says
'overturned')."

**What the code does.** That cannot happen. A full bar files a ban and empties the bar: `live_infractions`
(`supabase/migrations/0361_discipline_cards.sql`) counts only infractions that landed after the character's last ban,
and `punishment_running` (same file) says the same of an infraction for an appeal. So once the ban lands:

- `open_appeal` (`0135_group_appeals.sql`) refuses every infraction that filled the bar with "that punishment has
  already run out". `supabase/tests/0111-appeals.sql` holds this ("an infraction the bar no longer counts was
  appealed").
- `close_appeal` (`0361_discipline_cards.sql`) refunds an appeal that was still waiting on one, with the same words
  and the refund reason `expired`, and writes no ruling.
- The ban itself is appealed to the Boss, once.

So the rule is sound and the words are not. The infraction did not run out: its points were spent filling the bar. And
the player's log (`engine/ui/log/lines.ts`, the appeals loop) tells every refunded appeal "No one could hear it, so
your Aura came back and you can appeal again", which is untrue of an appeal refunded as `expired`: that appeal stays
used and its punishment cannot be appealed again.

**What the owner was asked.** What a player may contest once the ban has landed:

1. The ban only, said truly. (Chosen; the recommendation.)
2. The infractions stay appealable while the ban runs, and a ruling that takes the bar under its size ends the ban.
   Weighed and left: a ban becomes several appeals deep, a lifted ban has to say what it does to the ladder and to
   what was refused meanwhile, and the Boss's one hearing of the ban already reads the whole of it.
3. Only an appeal already waiting carries over to the ban. Left: appeals are judged in the request that opens them
   (`supabase/functions/staff/appeal.ts`), so the window is the length of one model call, and the ban's own appeal
   covers it.

**What changes.**

- A refusal of its own for an infraction that a ban emptied, in `open_appeal`: it names the day the ban landed and
  says the ban is what can be appealed.
- A refund reason of its own, `banned`, in `close_appeal` and `appeal_refunds`, with the same plain words in the
  answer the Edge Function gives.
- The log's appeal line says why an appeal was refunded, by its reason: `failed` and `stale` keep today's words;
  `expired` and `banned` each say what happened and neither says "you can appeal again".

No state is added. The way out of a ban is unchanged: its end, its one appeal to the Boss, an Unban, and (once #315
is built) an admin.

## 2. Rule N and House Rule N are two charges (#316, F1)

**What happens.** A rule is numbered among the rules that ever landed on its board, and the every-board rules are
numbered on their own (`rules_now`, `0102_rules.sql`), so a board can have a Rule 1 and the instance a House Rule 1.
A charge carries `rule_number` and `board`, and a house rule's charge carries the post's board, so the two are the
same charge to `visit_charge_matches` (`0345_visit_charge_lookup.sql`). One post that breaks both draws one visit for
the first and the second is dropped as a repeat: House Rule 1 (minor, 2 points) and the board's severe Rule 1
(5 points) land 2 points, not 7. The infraction's own record has no house marker either, so `punishment_words`
(`0109_appeals.sql`) can pick the wrong charge's words, or fall back to "Rule 1" for a house rule.

**What changes.** A house rule's charge carries `house: true`, from the two places that build one
(`draw_visits`, `close_report`), through `start_visit` onto the visit or its join, and through `file_visit` and
`infract` onto the infraction. `visit_charge_matches` compares it, and `punishment_words` reads it.

**Alternative weighed.** Naming the rule by its `setRule` Act in place of its number. Left: a rule's number never
changes once it lands (`0102_rules.sql`, "The number is stable"), the number is what the player reads, and number
plus marker is the smallest change that makes the identity whole.

**Acts an instance already holds.** A charge or an infraction written before this has no marker and reads as a board
rule's, which is how it is compared today. No fill is run: an earlier house charge is not rewritten.

## 3. A report whose judgment opens no visit is refunded (#616)

**The owner's answer**, 2026-11-13: "616, refund."

**The cases.** A `visit` verdict in `close_report` (`0107_reports.sql`) calls `start_visit`, which opens or joins a
visit, or does neither. For a report, it does neither in two cases:

- **Hidden.** A Whodunnit? veil landed on the post between the report and its judgment (`start_visit` returns null
  for a veiled author, `0357_post_veils.sql`). `open_report` refuses a report made while the veil is up; this is the
  report paid just before.
- **Repeat.** The post has already answered for that charge: a visit for it, open or ended, is on the post
  (`{visit: null, repeat: true}`).

The owner confirmed both are refunded. (A staff post also returns null, and `open_report` refuses one before anything
is paid; the patrols' targeting cap never meets a report.)

**What changes.**

- `close_report` writes the verdict as it does today, then gives the price back with a reason of its own: `hidden` or
  `repeat` (`report_refunds.why`).
- The reporter's log line says what happened, in place of "judged it and sent a visit", which is false in both
  cases. A hidden author's line says the post can be reported again once the author shows; that is the way out.
- The Mod's in-character line is left as it is: the fiction may bluff, the log may not.
- The report still counts toward the character's reports for the day (`open_report` leaves out only a `failed`
  refund) and toward the instance's judgment budget, since a judgment was made. So reporting posts that have already
  been punished is not a free way to spend the Mods' day.

**The masks.** The veil and the earlier visit are both public Acts, and the refund is computed from them alone.

## 4. What is open

- #315, an admin's reversal of an infraction or a ban, is not in this design. The owner called it "not crucial", to
  be built before The System is turned on if easy.
- #313 (how big an appeal's "reduced" and "increased" are) and #312 ("no all caps" has no minimum length) are
  questions waiting on the owner and are untouched.
- #316's F3 (the rule check's cost growing with a board's rule history) is a cost, not a truth, and stays in #316.
