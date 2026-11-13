# Season rehearsal: FanGaME, ONTOPIC 5.0 and QC-1000

Record, written 2026-11-13. Five live rehearsals of one Divided World season, run for the owner's review of tone and
character quality before the launch plan (`docs/plans/2026-11-13-launch-plan.md`) is built. Every finding below is
what these runs showed on that date; the owner's answers follow them.

## What was run

The launch plan's roster and boards were applied on branch `claude/rehearsal-test-real-personas-gmw7m2` as a preview
(commit "Preview only, not for merge"): ONTOPIC 5.0 copied from the plan's Task 3, QC-1000 from PR #444's draft with
Task 2's changes, the roster and first staff as Task 4 says, the six starter boards of Task 1, filler openers for the
five new boards, and five scenarios placed on the 90-day season:

| Scenario | Season days | What it shows |
|---|---|---|
| `arc-1-honeymoon` | 1–7 | FanGaME's arrival, initiatives proposed, first standing orders |
| `arc-2-split` | 18–24 | The Split, due on day 22 |
| `arc-3-reign` | 45–51 | Picking apart, threads moved one at a time |
| `arc-4-meltdown` | 72–78 | Consolidation, from the shipped meltdown memory |
| `arc-5-handover` | 86–92 | "Everything is World -1", the farewell, and season 2's first days |

Each was `npm run rehearse -- <scenario> --cap 5`, live, with the instance's tiers (strong `claude-opus-5-5`, light
`claude-haiku-5-5`). Live spend was $11.51 in all. The snapshots share no memory.

## Files

- `review.html`: the review page (self-contained): each day's staff posts, standing orders, moves, beats and filings,
  filterable by persona, with each persona's notes at the end of its snapshot.
- `logs/<scenario>.json.gz`: each run's `log.json`, as the rehearsal's collector wrote it.
- `extract.py`, `template.html`, `reads.json`: how the page was made. With the logs unpacked to
  `rehearsals/<scenario>/<run>-record/log.json`, `python3 extract.py data.json` writes the page's data; `reads.json`
  holds the written findings; the page is the template with both substituted for `__DATA__` and `__READS__`.

## Findings

1. **The voices hold.** All three personas stay in character across 35 days. FanGaME's farewell memo (day 91) is the
   best post of the run. The arc plays as written: the Split on day 22 exactly when due, threads picked apart, boards
   merged in the meltdown, the victory lap once, "Everything is World -1" on day 90.
2. **Habits read as a checklist.** QC-1000 says "queue position 998" in 34 of 35 posts and nearly always asks "demo or
   full game?" and declines because "a version already exists". FanGaME ends 34 of 37 posts with "(This is fine. I am
   fine.)". ONTOPIC 5.0 gives one 4/5 and otherwise at most 3/5.
3. **The engine's frame leaks into the fiction.** On day 88 FanGaME signs a post "from your Boss, robo-McMahon, and also
   from FanGaME". `BOSS_PREMISE` and `MOD_BOT_PREMISE` in `instances/divided-world/system/persona.ts` call the Boss
   robo-McMahon and speak of "the System".
4. **Stock lines speak as the System, under the Boss's name.** "You did it. a rule is over. The System is not proud, it
   is merely satisfied." (day 22) and "The favor was a loan and the System is collecting." (day 51) posted as FanGaME.
   They come from `instances/divided-world/system/lines.ts`; `{move}` fills in lowercase at a sentence's start.
5. **Succession repeats.** FanGaME played `nameSuccessor` for QC-1000 on five days running (87–91), each a new move with
   a near-identical reason.
6. **A queued move outlives its Boss.** On day 91, with QC-1000 in the chair, FanGaME's merge of Movies & TV into
   World -1 landed. On day 90 a second "everything" merge failed because its board was already closed.
7. **ONTOPIC 5.0 charges pointlessness on the Pointless Post Palace** (day 7: "Pointless is what we asked for; I simply
   cannot award it five stars"). The patrol judge charged "premise" and her filing argued against its own charge.
   QC-1000 did the same on day 6 ("a gentle decline of the charge", filed anyway).
8. **Bounds the models overshoot.** One ONTOPIC chatter answer was dropped at its token cap (day 77). `profile.mood` was
   trimmed at 80 characters in 27 of 35 meetings, often mid-word.
9. **The filler, not the personas.** Every filler regular has it/its pronouns (the corpus sketches set none), so the
   staff call members "it". The filler never posts on a board the Boss creates, so FanGaME's fangame board is empty in
   every run.
10. **Two of the launch plan's tests fail on its own ONTOPIC 5.0 file.** `system.test.ts` requires a Mod Bot quiz of at
    least five questions (hers has four), and its it/its check flags her `persuadedBy` and `temperament`, where "it" is
    the post or the quarrel.

## The owner's answers, 2026-11-13

- **Tone.** Very impressed overall; no major tone changes. FanGaME's "This is fine, I am fine" is hilarious and his
  prompt is dialed in: leave it. The others may be adjusted. ONTOPIC 5.0 should feel free to give 5/5 for true
  nonsense, and admonishing pointlessness on the Pointless Post Palace is a bug.
- **The frame.** Agreed on the stock-line leaks and the robo-McMahon mention. No reference to "The System" should
  remain in what the staff are told: the staff understand the forum as Gabe's forum, which they are tasked with running
  (and they already run it well in these tests).
- **Succession.** The current Boss choosing the successor is right: the season's interpersonal dynamics make the choice
  more realistic. The repeated nomination is not addressed by that answer. Ideally the replacement Bosses get arcs too;
  not a launch blocker.
