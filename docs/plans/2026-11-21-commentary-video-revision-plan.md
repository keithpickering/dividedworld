# The commentary video, revised: plan

Record, written 2026-11-21. The plan for `docs/plans/2026-11-21-commentary-video-revision-design.md`; read that first,
and the first design and plan it revises (`docs/plans/2026-11-21-commentary-video-design.md`,
`docs/plans/2026-11-21-commentary-video-plan.md`), whose tools #914 put on main.

**The layers.** Every task is instance content (`instances/divided-world/ui/hype/`) or a repository tool
(`tools/hype/`). No task changes `engine/` or `supabase/`; a task that cannot film a beat without that stops and says
so. No task touches a deployed database, a bucket or a connector.

**On this machine and not in git** (`.runs/hype/`): the voice clips (`voice/`), the recording
(`music/mountain-king-musopen.flac`, sha1 `7d34c97620149eff83bc14a1e838ef5d8e66746b`), the analysis that measured it
(`musiccut/`: its `README.md` holds the eighteen statements, and `mk-A.json`, `mk-B.json` the shortened versions'
maps), the circus track (`music/circus-2.mp3`), and the first build's takes.

**Every task's done** is shown with output: a test's red run on an assertion and its green one; for a take, its frame
count and stills the implementer has looked at.

**Filming.** `npx vite build web --mode e2e`, then `npx vite preview web --port 4319 --strictPort`; a shot takes
`--only <take>`. Filming runs a few frames a second, so a task films only its own takes.

## Task R1. The recording, measured and cut

Model: sonnet

- `instances/divided-world/ui/hype/music-map.json` is replaced by a map of the measured recording: `drone`, the
  eighteen `statements` (start, length, block, beats 16), the coda's chords and the final chord's end, each with
  `confident`, from `.runs/hype/musiccut/README.md` and its JSON. Block 3's statements were estimated on a beat grid
  (about 70 ms); say so in the file.
- New `tools/hype/music-cut.mjs`: makes a shortened version from the recording with ffmpeg alone, by a recipe in the
  map (`versions: { "mk-a": { remove: [2, 3], join, crossfadeMs }, "mk-b": { remove: [2, 5], … } }`), and writes the
  version's own map (every later time shifted by what was removed). It checks its output's length against the
  recipe's to 5 ms and refuses otherwise. `mk-b` made this way is compared with `.runs/hype/musiccut/mk-B.flac`: the
  same length, and a difference signal under -40 dB outside the join.
- `tools/hype/windows.mjs` and `music-map.mjs` read the new shape; what read `blocks[].entries` reads `statements`.
- New pure `beats(map, version)`: every beat's time, sixteen to a statement, evenly within its statement.
- Tests first: a version's map has no statement removed from blocks 2 or 3; statement starts ascend and each ends
  where the next begins; `beats` returns 16 × the statements kept; the recipe's refusal on a wrong length.

## Task R2. The voice leads, the music is laid from its end

Model: sonnet

`tools/hype/edit-commentary.mjs`, `timeline`:

- The narration is continuous: node after node, a breath of 0.35 s between, from the film's first frame. Node 11's
  three lines sit in the coda's three longest gaps, as now.
- `musicStart = end of node 10's clip + 0.2 s − the version's first coda chord`. The version is the longest of
  full, mk-a, mk-b whose `musicStart` is at least 5 s; `--recording` fixes it; if none reaches 5 s the shortest is
  used and the edit says the music starts before the speech allows. The run prints the version, the start, and where
  in the speech the second block and the full orchestra fall.
- The old windows (a node fitted to a stretch of music) go; `fit`'s refusals that no longer apply go with their
  tests, and the refusals that still do (a missing clip, a wrong recording) stay.
- Ducking as now, and never in the coda.
- Tests first, on made-up clips and a made-up map: the start for each version; the choice among them; the override;
  the full orchestra's place in the speech; the coda directly after node 10.

## Task R3. The cut list

Model: sonnet

- New `instances/divided-world/ui/hype/cutlist.json` and its reader in `tools/hype/cutlist.mjs`. Two kinds of row:
  - **on the music:** `{ "statement": 9, "beats": 8, "take": "b-scrub-2", "from": 120, "move": … }`, filling a
    statement's sixteen beats in order;
  - **on the speech:** `{ "node": "n06", "word": "phrase", "take": "c-n06", "sync": "steel-chair", "lead": 20 }`: the
    take's landing named by `sync` falls on that word (its time from the caption's share of the clip), starting
    `lead` frames before it, and the row runs to the next cut.
  Before the music starts, rows are on the speech only.
- The reader resolves the list against a timeline to frames, and refuses: a statement whose beats do not sum to 16; a
  take that is neither on disk nor allowed as a slate; a shot under 6 frames; a row past its take's end without
  `hold: true`.
- It prints, per block, the count of shots and their median length. A test holds that the committed list's medians
  fall from part one to the first block to the second to the third.
- The edit cuts from the list. A take's own `move` and `punches` still apply to its shots; a row's `move` overrides.
- The list itself is written in Task R8, once the takes exist; this task ships the reader, the edit's use of it, and
  a list of slates that passes.

## Task R4. The stage: nodes, graffiti, the Staff's lines, the GPT-2 text

Model: sonnet

- `Nodes.tsx`: the symbol half again as large; the test's size assertion first.
- `stage-world.ts`: the dressed graffiti post's strokes become varied shapes (an arrow, a heart, a face, a word in
  block capitals, a scribble-out, an underline), built by small named functions; a test holds at least five distinct
  shape kinds and that no two strokes are the same polyline.
- `tools/hype/staff-lines.mjs` and `staff-lines.json`: take from the logs, whole, with `said` beside `text` as now:
  two opening lines for each Mod; three filings for each Mod with the post each was aimed at (author recast, words
  kept); four of the Boss's move reasons (a board made, a thread moved, a merge, and the merge that failed); three
  memos; two star reviews; the succession, the farewell, the handoff, QC-1000's arrival and his follow-up. The design's
  section 5 and `.runs/hype/scratch/dump.txt` name them. The two round-1 lines for ONTOPIC 5.0's visit and filing are
  removed, and a test holds that every `said` is found, character for character, in a log.
- `stage-play.ts`, `staff` gains: `visit(mod, postSeq, { quiz })` (a real opener; the quiz is the fixture's from
  `engine/ui/cards/Visit.board.stories.tsx`, imported if it is exported, else its three strings copied with a comment
  naming the story), `hallPass(postSeq)` (a Hall Pass set by the post's author through the real `setCard`, then a
  visit that it traps), `filing(mod, postSeq, key)`, `report(name, postSeq)`, `appeal(name)`, `review(key)`,
  `handover()`. Each writes a post for a filing to be aimed at where the cast has none like the one in the log.
- The GPT-2 text: `instances/divided-world/ui/hype/gpt2-tail.txt`, holding the stand-in the design names, with a
  header line saying where it is from; `pile`'s You Were Saying? and the close-up read it. A test holds it is not
  empty and is the text the stage types.
- Tests first for each; the stage's existing tests keep passing.

## Task R5. Part one, with a narrator's pointer

Model: sonnet

- `tools/hype/pointer.mjs` gains `narrate(cam, cues)`: gestures (drift to an element and rest near it, circle it,
  hover without pressing, scroll a little and return, idle wander) run on the virtual clock between cues, seeded, with
  eased, slightly curved paths and small overshoots. Pure path math is tested: a path between two points stays within
  bounds, ends where asked, and never jumps more than a set distance in a frame.
- `shot-commentary-1.mjs`: nodes 1 to 4 filmed again, each with cues tied to its captions (the caption's start is
  its share of the node's clip, read from `.runs/hype/voice` or 150 words a minute without it). Node 2: the pointer on
  the class tag at "secret class", on the tally at "threw tomatoes at him", on the forecast at "made money", on the
  thumbs up at "politely". Node 1: the node clicked at "click", and clicked again at "click it again". Node 3 keeps
  its real-pointer cast. Node 4: the pointer rests, drifts once, rests.
- Nodes 3 and 4 also get their cut-ins as takes: `c-n03-back` (the card back turning over, close) and `c-n03-alert`.
- Every assertion the first build's takes make stays.

## Task R6. The close-ups

Model: sonnet

New `tools/hype/shot-closeups.mjs`, takes named `b-…`, each 3 to 8 s, 2880x1620, the page zoomed (a 720 by 405
viewport at four times density, or the stage's `turn({ scale })` where the layout must not reflow; say which per take
and why), driven by the real pointer, each with `landed` frames for its beats:

`b-autocorrect-peel` (pick a strip's corner and roll it; it tears; three times), `b-scrub-1`, `b-scrub-2`, `b-scrub-3`
(round 1's `shot-scrub.mjs` is the model; the third ends as a fresh coat lands), `b-smoke-wave`, `b-glitter-drag`,
`b-graffiti-tag` (drawn live on a wall, five shapes), `b-stick-around`, `b-chair`, `b-laugh`, `b-jimmy`, `b-fold`,
`b-react` (the film's own player reacting, with its stamp), `b-gpt2` (the tail typing in, readable), `b-pack` and
`b-hand` (round 1's shots, filmed again at this size).

Each take asserts what it shows (a strip was torn; the wash saved; the smoke's cover fell and rose; the bar moved).
Look at stills of every take; a close-up that does not read is filmed again or dropped, and the report says which.

## Task R7. The Staff's takes

Model: sonnet

New `tools/hype/shot-staff-2.mjs`, takes named `s-…`, each 2 to 5 s, 2880x1620, with real lines only (Task R4):
`s-visit` (the mark and countdown, the Lens opening on a real opener), `s-quiz` (the choices; the pointer presses a
wrong one; the game's answer to that), `s-hallpass` (the back turning over, the visit ending), `s-filing-qc` and
`s-filing-ontopic` (the filing's words on the post, the warn bar rising), `s-report` (the form opened and sent),
`s-appeal` (the button and the form), `s-made`, `s-moved`, `s-merged` (the move notices with their reasons),
`s-memo`, `s-stars`, `s-farewell`, `s-seat` (QC-1000 taking the seat). Each asserts its line is on screen. Node 10's
old take is retired.

## Task R8. The list, and the cut

Model: sonnet

- Write `cutlist.json` for the whole film from the takes that exist, by the design's section 2: nodes 1 and 2 whole;
  nodes 3 and 4 with their cut-ins; from the second block a cut on every statement, then every eight beats, with
  close-ups cut against each node's own take and that take's landings pinned to their words; through the full
  orchestra a cut every two to four beats across the heap's three framings, the three scrubs in order, the Staff's
  takes in the order a visit runs (opens, quiz, Hall Pass, filing, report, appeal, moves, farewell, seat), ending on
  the turned heap; the coda as now. `b-gpt2` is on screen at "This is GPT-2 finishing someone's post."
- Assemble with the placeholder voice. Look at stills at every tenth second and at five cuts in each block. Report
  the per-block medians, the film's length, the version of the recording the rule chose, and, honestly, what still
  looks wrong.
- A 720p copy for the owner.

## Task R9. The record

Model: haiku

`docs/research/2026-11-21-commentary-video/claims.md` gains a dated section: the staff lines now all from the logs,
with the quiz named as the fixture's by the owner's leave; the GPT-2 text's source and that the post it continues
differs; the departures the new takes add. New `credits.md` beside it: the recording's credit line, the Jimmy Wales
image's credit from the card's `art.json`, the circus track's source, the placeholder voice.

## Review focus

- Whether a join in a shortened recording can be heard: nobody building this can listen; the measurements are in the
  analysis's README and the owner's ear is the test.
- Whether any staff line on screen is not in a log (the quiz is the one allowed exception).
- Whether a close-up fakes its interaction: each must be the real pointer on the real effect, and assert its result.
- Whether the cut list can drift from the takes: a take filmed again with different landings must fail the list's
  check, not silently shift a shot.
- Whether the film can be assembled looking finished with a take missing: slates are stamped, and the list's check
  names them.
- Whether anything of the stage reaches the web bundle (as #914's review checked).
