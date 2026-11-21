# The commentary video, revised: design

Record, written 2026-11-21. The owner's notes on the third cut of the commentary video
(`docs/plans/2026-11-21-commentary-video-design.md`, built by #914) and what they change. The script's words do not
change. The plan is `docs/plans/2026-11-21-commentary-video-revision-plan.md`. Nothing here changes the game.

## 0. What the third cut taught

The owner, on the cut: "Good start!", the commentary nodes work "though they could be a bit bigger", and:

- "There are times where the shot holds on no action or narration for an extended period of time awaiting a music
  cue. This is mainly happening in the shots around the middle of the video and is the main issue right now."
- "The earliest footage in the video has effectively no movement at all; when narrating a screen like this it's common
  to move the cursor or scroll around the page idly while talking."
- "This zoomed-out desktop view makes it a bit hard to see some of our most delicate effects, like picking and rolling
  an autocorrect strip with the screen zoomed in... It can rip several times." And: "In these takes the effects are not
  being interacted with much, which is most of the fun."
- "So early in the video it appears to be a simple narrated demo and it reveals itself as a tightly edited production
  over time, with the shot length generally decreasing as the music gains intensity. Cutting between 'Whoops' spills
  in the previous video, with the user scrubbing the spills away with increasing franticness and futility, worked
  well."
- "I don't actually see a You Were Saying cast when he mentions gpt2."
- "Let's try to only use real rehearsal lines for the staff", and "there are definitely some mechanisms (reporting,
  moderation reviews and quizzes, hall passes being triggered, etc) which don't seem to be represented, but which are
  built. Quicker cuts... give us an opportunity to pack in more game footage."
- The graffiti "could use more varied shapes in the scribbles".

The first design had one take a node, held or trimmed to its window. That is where the waiting came from: forty
seconds of speech laid over a hundred seconds of music.

## 1. The music starts early, and the voice chooses its length

**Decided (the owner):** the music does not wait for part two. "The track starts out quiet enough that I think it can
begin very shortly after Gabe begins initially talking... The calm beginning of the song functions well against the
narration which itself starts calm, sort of an instant air of subtle mischief that gets out of control."

So the narration runs continuously from the first frame, one node after another with a breath between, and the music
is laid under it from its end backward: the coda's first chord falls just after node 10's last word, and the music's
start is wherever that puts it. The full orchestra's entrance then falls where the speech is at that moment; with the
placeholder voice that is inside node 8, as he fails to stop his own node.

**The recording may be shortened.** The owner: "The song can be cut down if it's seamless, doesn't skip a beat."
An analysis of the recording found eighteen statements of the theme, sixteen beats each, six to a block; the first
block is at a constant tempo and level, so a pair of statements can be taken out of it with a tempo step under one
percent. Two shortened versions were rendered, each with one join in the first block: **mk-A** (2:16, statements 2
and 3 removed) and **mk-B** (1:58, statements 2 to 5 removed). A third, with a join in the accelerating second block,
leaves a tempo step of about a tenth and is not used. Shorter than that is not possible without an audible step.

The owner chose mk-B by ear. With the placeholder's two and a half minutes of speech, mk-B would start a minute in and
the full recording twenty-three seconds in. **Decided:** the edit chooses among the full recording, mk-A and mk-B the
longest whose start is at least five seconds into the film, so the music begins as early as the speech allows; a
quicker performance by the owner brings mk-A or mk-B in by itself. `--recording full|mk-a|mk-b` overrides. The owner
was told of the arithmetic and may still fix mk-B; that is one flag.

The first design's map of the recording was wrong in three places (the theme's first note is at 4.4 s after a held
drone, not 0.5; the second block starts at 58.1 s, not 64.4; the full orchestra enters at 102.3 s, not 100.3). The
measured statements replace it.

## 2. The cut: a demo that turns out to be an edit

**Decided:** shot length falls as the music climbs, by a cut list written against the music's statements and beats.

| Stretch | Music | The cut |
|---|---|---|
| Nodes 1 and 2 | Silence, then the drone and the first statements | One take a node, a locked frame, and a narrator's pointer that is alive (section 3). It looks like a narrated demo. |
| Nodes 3 and 4 | The first block | Two or three shots a node: the first cut-ins, to the card back turning over and the alert. |
| Nodes 5 to 7 | The second block, accelerating | A cut on every statement, then every half statement. Close-ups of effects being handled are cut against the node's own action. |
| Nodes 8 to 10 | The full orchestra | A cut every two to four beats: the heap, the scrub, the Staff's mechanisms, the board turning in space. |
| Node 11 | The coda | A cut on every chord, as now. |

The cut list is data (`cutlist.json`): for each statement of the music, the shots that fill its sixteen beats, each
naming a take, where in the take it starts, and its move. A shot of a node's own action may be pinned to a word of the
narration instead of a beat, so the chair still lands as he says "phrase". The edit refuses a statement whose beats
do not add up, and prints the median shot length of each block, which a test holds to be falling.

## 3. The narrator's pointer

In nodes 1 to 4 the camera stays locked off and the pointer does what a person's does while talking over a screen: it
drifts to the thing being named and rests near it, circles a word, scrolls a little and comes back, hovers a button
without pressing it. Each gesture is tied to the caption being spoken, so the pointer is on the class tag at "secret
class" and on the tomatoes at "threw tomatoes at him". The shot reads the voice clips' lengths to time them; a new
performance means filming part one again, which is four short takes.

## 4. Close-ups, and hands on the effects

**Decided:** a library of short close-up takes, filmed with the page zoomed in and driven by the real pointer, each of
one effect being handled:

- **Autocorrect:** a strip picked at its corner and rolled back, tearing, three times.
- **Whoops!:** the scrub, in three takes of rising franticness; the last ends as a fresh coat lands.
- **Hot Box:** the smoke waved away and rolling back in.
- **Glitter Bomb:** the pointer dragged through it.
- **Graffiti:** a wall tagged live, with shapes that differ (an arrow, a heart, a face, a word, a scribble-out).
- **Stick Around:** the wheel against the Break Free bar.
- **Steel Chair, Laugh Track, Jimmy Wails, Below the Fold, a reaction's stamp, the booster pack, the hand.**
- **You Were Saying?:** the tail typing in under a post, large enough to read, as he says "This is GPT-2 finishing
  someone's post." The words are the model's own (section 6).

The stage's five dressed posts get graffiti of varied shapes, and the commentary nodes are drawn about half again as
large.

## 5. The Staff, in their own words

**Decided (the owner):** every staff line on screen is the second rehearsal's output. The two lines the first build
inherited from round 1 for ONTOPIC 5.0's filing are in no log (#914's final review, F1) and go.

The logs hold: the Boss's memos to his Mods, his board moves with their reasons, six templates of a Mod's opening
line on a visit, each filing's words with the post it was aimed at, ONTOPIC 5.0's star reviews, group and trophy
moves, and the whole handover (the succession, FanGaME's farewell, QC-1000's arrival). They hold no text for a quiz,
a report's verdict, an appeal's ruling or an apology: the rehearsal never exercised them.

So the mechanisms are shown this way:

| Mechanism | Shown as | The words |
|---|---|---|
| A visit opens | The Mod's mark and countdown on a post, its Lens open | A real opening line |
| A quiz | The Lens's choices; a wrong answer pressed | **The fixture's quiz** ("Which form is used to request another form?"), by the owner's leave, as the one exception |
| A Hall Pass springs | A face-down card turns over as the visit begins; the visit ends | The game's own notice |
| A filing | The filing on the post, the warn bar rising | A real filing line, aimed at a post like the one it was written about |
| A report | The report form opened from a post and sent | The game's own form; no verdict line is shown |
| An appeal | The Appeal button and its form | The game's own form; no ruling line is shown |
| A board made, a thread moved, boards merged | The move notices | The Boss's real reasons |
| A memo, a star review | Staff posts | Real |
| The handover | The Boss's farewell, and the new Boss taking the seat | Real |

The rehearsal's posters are renamed to the cast, as round 1's were, and each line is kept as written beside its
recast copy.

## 6. Smaller things settled

- **The GPT-2 text** is real output of the card, read from the owner's test instance: the owner casts one at length
  and its text is copied into the stage. Until then a shorter real one stands in ("...but for some reason this shit
  keeps"). The post it continues on the stage is not the post it continued in the instance; the record of claims says
  so.
- **The Jimmy Wails banner stays.** The owner: the image "can be used under the same CC license as the effect itself."
  The film's credits carry the image's credit beside the recording's.
- **The end card's stand-in** stays as an opt-in for previews; the owner did not strike it.

## 7. The rules

- **The layers, the masks, ways out, scale:** as the first design's section 8. The stage, the cut list, the lines and
  the maps are Divided World's; the camera and the edit are tools; the engine is not changed.
- **The one write to a deployed database** in this work was the owner's own instruction: a grant of Aura to the
  owner's test account, through the game's `grant_aura`, so the owner can cast the card whose text the film shows. No
  build session or subagent touches the instance; the text is read once, by the session the owner asked.

## 8. Open

- **mk-B, fixed, or the rule in section 1.** The rule stands unless the owner fixes the version.
- **Free, and by invitation:** still said nowhere in the film.
- **Whether node 2's forecast counts as filmed from the game** (#914's design question 3): unanswered.
- **The matched phrase in node 6's Lens** needs the fake's seeded spring to carry it (#922). Without it the close-up
  shows the phrase in the dented post.
