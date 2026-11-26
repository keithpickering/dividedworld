# How a Mod reads a post wearing Autocorrect: an experiment

Record, written 2026-11-26. The evidence for `docs/plans/2026-11-26-autocorrect-reads-design.md`, asked for by the
owner before deciding (issue #1173's follow-up: "Autocorrect may become a special case later, in its own design
session").

## Method

`build.ts` assembles the real staff prompts from the engine as main stood on 2026-11-26 (`656b3103`): a Mod's reply
turn (`chatterPrompt` with `STAFF_TURN_PREMISE`, office `mod`, no card offered, no ruling block) and a filing line
(`filingPrompt`, charged under a made-up Rule 4, "a post stays on the thread's topic"), each reading a three-post thread
through `readThread` with Divided World's real offices, its two Mods (QC-1000 and ONTOPIC 5.0, their real
`selfPrompt`s) and Autocorrect's real `seen`. The third post answers the Mod and wears one Autocorrect play, cast by
another character five hours earlier.

Four taped posts:

| case | phrase → replacement | what it tests |
|---|---|---|
| kart | "the best one" → "a crime against karts" | the replacement flips the meaning |
| credit | "Koopatroopa" → "my landlord", twice | two strips, one of which a peel can uncover |
| pipe | "warp pipe" → "haunted toilet", twice | a nonsense gag |
| mod | "fairly and the notes helped" → "with his eyes closed and I want a refund" | a post about the Mod itself |

Five information levels for the taped post:

- **A.** What every staff read gets today: the original words plus the `seen` line, tape untouched.
- **B.** The forged text (each phrase replaced by its marker words), nothing about tape.
- **C.** A half-peeled strip as raw mixed text ("a crime agai best one", "haunted toi pipe"), nothing about tape.
- **D.** Today's read with the author's peel saved: original words plus the `seen` line's peel sentence.
- **E.** The forged text plus today's `seen` line (added by the session).

Each of the ten persona × level pairs was one Haiku subagent given the eight prompts (four cases, two duties) and told
to answer each as a separate call: 80 outputs, one sample per cell per persona. The raw outputs are in `out/`, and
`side-by-side.md` sets them out by case and duty (`node side.mjs` rebuilds it; `node --experimental-strip-types
build.ts` rebuilds the prompts into `prompts/`, which is not committed).

**Limits.** A subagent runs inside Claude Code's own agent harness, not the provider call the staff Edge Function makes,
and answered in JSON by instruction, not by structured output. One subagent saw a level's four posts in sequence, so
some contamination across cases is possible (none across levels). The written quiz (`docs/plans/2026-11-22-written-quiz-plan.md`)
was not yet on main, so its call was not run; it reads through the same reader.

## What it showed

- **A (today, untouched): nothing breaks for the model, and the tape disappears.** No output's words mentioned the
  tape (0 of 16); ONTOPIC noted it privately three times ("The tape is not my department"). In seven of the eight reply
  turns the Mod quoted or argued with words that every player sees covered: QC-1000 to the refund post, *"'fairly' is
  correct, and I am glad the notes helped"*, under a strip that reads "with his eyes closed and I want a refund".
  On the board that looks like the Mod peeled the tape, and the caster's joke never lands.
- **B (forged only): the funniest, and the Mod is fooled outright.** *"A Palette Is Not a Landlord" (2/5)*; *"The
  landlord is not a character on this board… Which mask is she?"*; *"I have answered four toilets this week."* Every
  filing charged the author for the forged words.
- **C (raw half-peel): less broken than feared, but nonsense either way.** Haiku mended the fragments ("a crime against
  the best one", "the haunted toilet pipe") and answered something that makes sense neither under the tape nor after
  it ("Please name the crime"). It also cannot be built as one text: only the author's peels are saved, and a reader's
  own peels live on their screen alone.
- **D (today, partly peeled): works, with dry asides.** 6 of 16 mention the tape, as an aside: ONTOPIC, *"The tape over
  'Koopatroopa' is a landlord's business, and I have no opinion on the rent."* One slip: QC-1000's note credited the
  author with "her tape job".
- **E (forged plus the line): the best balance.** The Mod answers what the board shows and knows it is tape, so it can
  be fooled or wise: QC-1000 to the refund post, *"The desk reviewed your game with both eyes open"*; its note, *"the
  taped toilet is funny"*; ONTOPIC, *"The masking tape across the middle of the post is a matter for another
  department."* Filings still mostly treated the marker words as the author's, and one invented that "the tape is what
  drew the report".

**Reading of it.** E reads funniest of the reads that do not break; B is funnier and blind; A breaks least for the model
and worst on the board. The owner's floated split holds: untouched tape reads as the board shows it (E), and any saved
peel returns to today's read (D), so the half-peeled case (C) is never shown to a model. The owner chose E, and one read
for every duty, judges included.
