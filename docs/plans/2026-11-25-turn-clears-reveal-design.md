Record, written 2026-11-25.

# An announced Turn clears a character's shown class: design

Asked by the owner on 2026-11-25: a character that has Turned, announced, to a class it kept hidden still shows its old
reveal on its postbit with "Has Turned since" under it. The Turn back to a hidden class should work as a clean slate.
The previous reveal no longer needs showing. A character's class is shown only while it is current and public, with the
date it was revealed. Otherwise nothing is shown.

This supersedes one decision of `docs/plans/2026-10-29-class-reveal-design.md` (its "Decided" paragraph on what a
reveal states after a later announced Turn). That design is a record and is left as written.

## What is shown now

`reveals()` (`engine/ui/postbit/reveals.ts`) takes each character's latest row of `class_reveals` and the latest
`turns_announced` row after it. That gives a `Statement` of `{ revealed, turnedAt }`, drawn in three live places:

- the postbit (`engine/ui/postbit/Postbit.tsx`): "Revealed: Heel (Oct 3)", then "Has Turned since (Oct 20)";
- the profile's Class fact (`engine/ui/profile/Profile.tsx`): "Revealed: Heel (Oct 3) · Has Turned since (Oct 20)";
- the class column of the live Rankings (`engine/ui/rankings/Rankings.tsx`, `ClassCell`): a chip, "Revealed Oct 3",
  "Has Turned since Oct 20".

A finished season says the same through `finalClass()` (`engine/ui/reveal/statements.ts`), in two places:

- the past season's Rankings (`FinalClassCell`): a chip, "Revealed …", "Has Turned since …";
- the Season page's results podium (`engine/ui/season/Season.tsx`, `stated`): "was a Heel and has Turned since".

A Turn announced with its new class is already a reveal: `class_reveals` carries it with `via` `turn`, so it is the
latest reveal and nothing shows "since". Only a Turn announced without its new class leaves the old reveal on show.

## Decided

**An announced Turn after a character's latest reveal clears its shown class.** The character then shows exactly what a
character that never revealed shows: no class line on the postbit, no Class fact on the profile, and "—" (read "Not
revealed") in Rankings. A new reveal, or a Turn announced with its new class, shows a class again. "Has Turned since"
is gone everywhere.

**All five places, not the postbit alone.** All three live places read one function. A postbit that has dropped a
class while the profile and Rankings still state it would be two answers to one question. A finished season gets the
same reading: a season that ended after a hidden Turn ended with the class not public, so its Rankings cell is "—"
and its podium reads "class not revealed". The owner chose all five on 2026-11-25.

Weighed: postbit only (the ask as first worded), which leaves the profile and Rankings saying what the postbit no
longer does; past seasons left as they were, as a record. That was set aside because "has Turned since" in a final
result says only that the shown class was not the final one, and the clean slate says the same more simply.

**What stays.** The history stays: the profile's public record (`statements()`/`wording()` in
`engine/ui/reveal/statements.ts`) still lists every reveal and every announced Turn, so the old reveal is still
findable on the record. The Turn posts and the tally lines ("has Turned.", "has Turned, leaving Heel.") stay. The log
stays. The reveal perk is unchanged: it already ends on any Turn (`0394_reveal_perk.sql`), and this design changes only
what is drawn.

**A silent Turn changes nothing shown.** `reveals()` reads only `turns_announced`, so a silent Turn leaves the reveal
on show, as the class-reveal design requires. If a silent Turn cleared the badge, it would not be silent.

**The Strategy Guide says so.** Its Reveals section says "the badge says what the class was that day". One sentence is
added saying an announced Turn takes the badge down until the next reveal. This is glass copy, so the owner approves it
in the PR's review.

## The rules

- **Masks** ("A response never proves a private fact"): nothing new is read or sent. The client already holds
  `class_reveals` and `turns_announced`, both public, and now draws less from them. No silent Turn is read.
- **Append-only:** no Act, view or migration changes. The clean slate is computed from the Acts, as before.
- **Layers:** all engine UI. No instance content changes except the Strategy Guide's sentence
  (`instances/divided-world/guide/strategy-guide.md`).
- **No player is ever stuck:** no state is added. A cleared class is the same as a never-revealed one, and its way back
  to showing is a reveal.
- **Busy instance:** `reveals()` stays linear in the reveals and Turns of the page's characters. Nothing grows.

## Open

Nothing.
