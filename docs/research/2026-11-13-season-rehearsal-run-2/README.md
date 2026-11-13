# Season rehearsal, run 2: after the patch

Record, written 2026-11-13. The second run of the five season snapshots in
`docs/research/2026-11-13-season-rehearsal/README.md`, asked for by the owner once #658 (Patch what the season
rehearsal found, `docs/plans/2026-11-13-rehearsal-patch-design.md`) was on main: "once the updated system personas are
in main, let's rerun the rehearsal as we did earlier today, creating a similar artifact to compare the results … Same
budgets approved." Every count below is what these runs showed on that date.

## What was run

Main at 568db0bf, with the same preview overlay as run 1 on branch `claude/rehearsal-test-real-personas-gmw7m2`
(ONTOPIC 5.0 and QC-1000 on the roster and first staff, the six starter boards, openers for the five new boards, the
five `arc-*` scenarios), none of it for merge. Each snapshot was `npm run rehearse -- <scenario> --cap 5 --fresh`, live,
same seeds as run 1, with nothing replayed from run 1's cassettes. Live spend was $11.81 (run 1: $11.51). #658 also
changed the filler: its regulars have pronouns, and it starts threads on boards the Boss creates, so thread placement
differs between the runs.

## Files

- `review.html`: the comparison page: run 2's findings, a finding-by-finding table against run 1, and every snapshot
  with a switch between the two runs.
- `logs/<scenario>.json.gz`: each run 2 `log.json`. Run 1's are in the first record's `logs/`.
- `extract.py` (`python3 extract.py <out.json> <dir of <scenario>.json logs>`), `metrics.py` (the table's counts:
  `python3 metrics.py <run1 data> <run1 logs> <run2 data> <run2 logs> <out.json>`), `template.html` and `reads.json`
  (the written findings), as in the first record.

## Run 1 against run 2

| Finding | Run 1 | Run 2 |
|---|---|---|
| 2. QC-1000 says "queue position 998" | 34 of 35 posts | 8 of 34 |
| 2. QC-1000 asks "demo or full game?" | 26 of 35 | 15 of 34 |
| 2. QC-1000 declines because "a version already exists" | 22 of 35 | 3 of 34 |
| 2. QC-1000 recounts his total | 26 of 35 | 11 of 34 |
| 2. FanGaME's "(This is fine. I am fine.)", kept by the owner's word | 34 of 37 | 34 of 36 |
| 2. ONTOPIC 5.0's stars, 1 to 5 | 2, 9, 14, 1, 0 | 2, 5, 6, 4, 4 |
| 3. "robo-McMahon" in anything the staff wrote | 1 | 0 |
| 4. "The System" in anything the staff wrote | 2 | 0 |
| 4. A stock line with a lowercase move name | 2 | 0 |
| 5. nameSuccessor moves in the last week | 5 | 1 |
| 6. FanGaME's moves landing after he left the chair | 2 | 0 |
| 6. A repeated "everything" merge refused as closed (kept by the design) | 1 | 1 |
| 7. Palace filings against a post that was pointless | 6 of 7 | 0 of 5 |
| 8. `profile.mood` trimmed at 80 | 27 of 35 meetings | 1 of 35 |
| 8. Chatter answers dropped at the token cap | 2 | 1 |
| 9. "(it/its)" tags in what the models were sent | 8,434 | 0 |
| 9. Posts on FanGaME's fangame board, by his farewell | 0 | 2 (World -1: 16) |

Run 1's README gave one dropped chatter answer; its logs hold two (honeymoon day 6, meltdown day 77).

## New in run 2

1. **A reply excerpt cut with no mark.** The staff are shown the post they reply to cut at the excerpt length with no
   ellipsis, and review the cut as the author's: QC-1000 files FanGaME's complete farewell "as a demo" because it "cuts
   off at Plumber Platfo" (day 91), and again on day 92 ("your post ends at I will ask"). Four times in run 2, and once in
   run 1 (ONTOPIC 5.0's "stops at the word will", which run 1's review missed). The body reaches the prompt already cut:
   `clip` in `engine/system/chatter.ts` adds "…" only when it cuts itself.
2. **The new Boss keeps an order addressed to itself.** After the handover, QC-1000's meetings on days 91 and 92 still
   carry FanGaME's last order to him ("Last day. You are Boss next, as discussed.") as a standing order on staff, though
   he is Boss.
3. **One chatter answer still dropped at the token cap** (ONTOPIC 5.0, day 86), after #658's 2,000-character ask.

The tone held. ONTOPIC 5.0's four 5/5s are all for real nonsense on the Palace; QC-1000's habits come and go; FanGaME is
unchanged; the handover (one nomination, the farewell, QC-1000's arrival line and first orders) reads well.
