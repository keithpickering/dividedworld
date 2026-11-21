# The commentary video: plan

Record, written 2026-11-21. The plan for `docs/plans/2026-11-21-commentary-video-design.md`; read that first, whole.
A build session carries it out. It films takes and builds the edit; it does not publish anything, and it makes no
voice (a build session and its subagents touch no connector).

**What exists.** Round 1's tools are one commit, `ca044da`, on the branch `claude/divided-world-hype-video-27387f`,
never merged: `tools/hype/` (the camera, the stage's opener, the pointer, the shots, the edit),
`instances/divided-world/ui/hype/` (the stage story, the staff's lines, the Wiggler sheet) and round 1's storyboard.
Every file is new to main, so the commit's files apply as they are. The commit says the build was not run on them,
and `tsconfig.tools.json` type-checks every `tools/**/*.mjs`. The camera finds Chromium under `LOCALAPPDATA`, so it
runs on Windows only.

**The layers.** Every task is instance content (`instances/divided-world/ui/hype/`) or a repository tool
(`tools/hype/`). No task changes `engine/` or `supabase/`. A task that finds it cannot film a beat without an engine
change stops and says so; it does not make the change.

**The masks, ways out, scale.** Nothing here reaches the app or a database. The stage is drawn only by the story
route and Storybook, on the fake.

**Every task's done** is shown with output: the test's red run and its green one, and for a shot, the take's frame
count and three still frames from it (start, the beat, end) written under `.runs/hype/stills/`.

## Task 1. Round 1's tools on main, on any machine

Model: sonnet

- Bring the files of `ca044da` onto the branch (`git cherry-pick ca044da`, or check its paths out of it).
- `tools/hype/camera.mjs`, `headlessShell()`: find the browser where Playwright put it on this machine. Order:
  `PLAYWRIGHT_BROWSERS_PATH`, then `/opt/pw-browsers`, then `LOCALAPPDATA/ms-playwright`, then `~/.cache/ms-playwright`;
  the executable is `chrome-headless-shell` or `headless_shell`, with `.exe` on Windows. Throw naming every place
  looked.
- Tests first: `tools/hype/camera.test.mjs` (node's own test runner, as the repository's other `.test.` files are run)
  builds a temporary directory shaped like each layout and asserts the path found, and asserts the throw's message
  when none is there. Show it red before the change.
- Make `npm run typecheck` and `npm run build:ci` pass with these files in. Fix what the type check and the story
  checks find (`tools/check-story-picks.mjs`, the accessibility sweeps of the stories) in the files themselves.
- Film round 1's cold open (`node tools/hype/shot-cold-open.mjs`) against the story server to prove the camera here.

## Task 2. The script, as data

Model: haiku

- New `instances/divided-world/ui/hype/commentary.ts`: `export const commentary: readonly Node[]`, one entry per node
  1 to 11 of the design's section 4, each `{ id, part: 1 | 2 | 3, lines: string[] }` where a line is one caption. The
  words are the design's, to the letter. Node 11's three fragments are three lines. `export const END_CARD` is the
  end card's sentence, to the letter, WROLD included.
- Test first, `commentary.test.ts`: eleven nodes with ids `n01` to `n11` in order; no line longer than 90 characters
  (a caption's two rows); no line says "The System" or "nobody can see"; `END_CARD` contains "WROLD" and does not
  contain "WORLD ("; and a table of each node's first six words, so a dropped node fails by name.
- Split a sentence across captions only at a comma, a dash or a full stop.

## Task 3. The music's map and the windows

Model: sonnet

- New `tools/hype/music-map.mjs`: reads a recording with ffmpeg as `onsets` in `tools/hype/edit.mjs` does, and
  prints the times of: the first note, each entry of the theme (about eighteen), the two block boundaries, each of
  the coda's chords, and the final chord's end. It marks which it is confident of. It is run by hand on the Musopen
  FLAC (the design, section 6) and its output is committed as `instances/divided-world/ui/hype/music-map.json` with
  the recording's source address, length and checksum.
- New `tools/hype/windows.mjs`, pure: `windows(map)` gives each node of parts two and three its start and end in the
  music (nodes 5 and 6 in block 1; 7 and 8 in block 2; 9 and 10 in block 3; 11 across the coda, one fragment to each
  gap between chords). `fit(windows, clips)` returns each node's slack, and throws for a clip longer than its
  window, naming the node, the window's length and the overrun. `sheet(windows)` is the timing sheet as text.
- Tests first, `windows.test.mjs`, on a made-up map: the windows cover the music with no gap or overlap; a clip one
  frame too long throws with that node's id; a clip that fits returns its slack; node 11 gets as many gaps as it has
  lines, and throws when the map has fewer chords than lines.
- If the music is not on the machine, say so and stop this task's hand-run step; do not download it without the
  owner's word, and do not guess a map.

## Task 4. The stage grows

Model: sonnet

`instances/divided-world/ui/hype/Stage.board.stories.tsx`, its `world` and `Made`:

- **The seat.** `as=` already signs in a character's player. Make D-Guy and Chadluminum one player's masks (node 7),
  and keep Snuckles and Human Josh the film's first player's. D-Guy's class is Heel and Chadluminum's Face.
- **The thread's new posts,** written here in the cast's voices: D-Guy's review (it holds "2/10" and "twelve frames
  and none of them are walking"), Chadluminum's kind post (the one Human Josh quotes), and five posts further down
  for node 8's scroll, each wearing one effect (Hot Box, Glitter Bomb on its author, Feelin' Fab, Graffiti,
  Autocorrect). Round 1's montage posts may be reused where they already hold these.
- **What is set before the camera runs:** Rope Break face down on Snuckles's post (`fake.seed.set`), 4D Chess face
  down on D-Guy's review naming Whoops! and the Heat quadrant, and a Steel Chair face down on Chadluminum's post with
  the "They say" phrase "to be fair".
- **`window.__shot` gains** (in `tools/hype/stage.mjs`, beside `splat`): `react(name, post, key)`, a reaction by a
  cast member; `cast(name, post, card, config)`, a live cast through the fake's own play path, so Rope Break catches
  and 4D Chess rides as the fake already does (`engine/ui/data/fake.ts`, the catching and riding branches of its
  play); `quoteSprings(name, post, words)`, which writes the quoting post, then `seed.spring` and `seed.card` with
  `spring`, since the fake does not play a Move from a quote; `staff(key, ...)` for node 10's memo, merge
  (`seed.closeBoard`) and filing (`seed.visit`, `seed.visitEnd`, `seed.infraction`); and `pile(post)`, which lands
  node 9's plays one call at a time in the order the shot asks.
- **The commentary nodes.** New `instances/divided-world/ui/hype/Nodes.tsx`: speech-bubble symbols drawn over the
  page, each a button with a name, placed by the shot (`window.__shot.node(x, y)`), turning slowly once started as
  Valve's do. They are the stage's and exist in no other story. Drawn with the theme's `--kb-` tokens, so a node takes the skin's
  colors as the board around it does.
- Tests first, in a `Stage.test.tsx` beside the story, on the world's seed: the two players' masks are as above; the
  three face-down cards are on their posts; a cast of Whoops! by D-Guy on Snuckles's post is caught and Snuckles's
  hand holds a Whoops!; a cast of Whoops! by Snuckles on D-Guy's review lands and a spring on that post says it rode.

## Task 5. Part one's shots (nodes 1 to 4)

Model: sonnet

New `tools/hype/shot-commentary-1.mjs`, one take a node, named `c-n01` to `c-n04`. Default skin throughout, 1440 by
810 at double density, the HUD in frame.

- **n01:** the thread at rest; a node placed over the first post; the pointer travels to it and clicks.
- **n02:** `as=D-Guy`. Four tomatoes and a vomit land a beat apart; the orbs' hatched forecast rises with each. Then
  one thumbs up, and it falls. Read the forecast's value from the page before and after each and fail the take if a
  tomato did not raise it or the thumbs up did not lower it: the picture must be the rule, not a staging of it.
- **n03:** `as=D-Guy`. Open the hand, arm Whoops!, press Snuckles's post. The back turns over; hold on the alert's
  words. Assert no ink canvas is on the post.
- **n04:** Snuckles's post, held still for ten seconds. Nothing moves.

Each take is long enough at its end to be held: the last two seconds are a still page.

## Task 6. Part two's shots (nodes 5 to 8)

Model: sonnet

New `tools/hype/shot-commentary-2.mjs`, takes `c-n05` to `c-n08`.

- **n05:** `as=Snuckles`. Arm the caught Whoops!, press D-Guy's review; the ink lands and fills the post's body;
  the back on it turns over. End on the Lens of the 4D Chess, open.
- **n06:** `as=Snuckles` (Human Josh's player). Quote Chadluminum's post, type a reply holding "to be fair", post;
  `quoteSprings` lands the chair. The Lens shows the phrase. Late in the take a second node appears at the margin.
- **n07:** `as=D-Guy`. The HUD's mask switch, from D-Guy to Chadluminum; the class tag changes. Three more nodes
  drift in during the take.
- **n08:** the page scrolls itself from the review to the foot of the thread at a steady pace, past the five dressed
  posts; the pointer clicks a node twice on the way and nothing changes.

## Task 7. Part three's shots, and the end

Model: sonnet

New `tools/hype/shot-commentary-3.mjs`, takes `c-n09` to `c-n11`, and `tools/hype/shot-commentary-end.mjs`.

- **n09:** tight on Snuckles's first post. `pile` lands, in order: Whoops! three times, Steel Chair three times, Hot
  Box, Laugh Track on "walk cycle", Jimmy Wails, You Were Saying? (its tail typing in), Off Day on Snuckles naming a
  class. Then the reader wheels away and Stick Around holds the page, twice. The take exposes the frame each play
  landed on (`window.__shot.landed`), written beside the film as `c-n09.json`, so the edit can put each on an entry of
  the theme. Stick Around is landed by this take alone, as round 1's was.
- **n10:** the Staff's three beats, from round 1's `tools/hype/shot-staff.mjs` and its lines: the memo; the merge,
  with the Boss's reason on the notice; the filing of the sprite post.
- **n11:** five stills of two seconds each for the chords: a chair mid-fall, the ink, the Boss's post, the pile, and
  the settlement summary opening (the story "Boards/12 Log", Open).
- **The end card:** a page of the tool's own, not the game's: a rainbow gradient behind `END_CARD` in Comic Sans MS,
  centered, wrapped, filling the frame's width. If `document.fonts.check('16px "Comic Sans MS"')` is false the shot
  throws, naming the font; it never substitutes another.

## Task 8. The edit

Model: sonnet

New `tools/hype/edit-commentary.mjs`, beside round 1's edit and sharing its helpers (move what both use into
`tools/hype/cutting.mjs` rather than copy it).

- **Inputs,** each a flag with a default under `.runs/hype/`: `--voice` (a folder holding `n01` to `n11`, any audio
  format ffmpeg reads; node 11 as `n11-1`, `n11-2`, `n11-3`), `--music`, `--circus`, `--out`.
- **Part one:** each node's take is held on its last frame, or trimmed, to its clip's length plus a breath of 0.4 s.
- **Parts two and three:** the music starts on node 5's first frame. Each node's take is fitted to its window from
  `windows(map)`; `fit` is run on the clips' lengths (ffprobe) and its refusal is the edit's. `--sheet` prints the
  timing sheet and stops.
- **Node 9's plays** are moved to the theme's entries in block 3 by playing the stretches between them faster or
  slower, never past a third either way; where that is not enough the edit says which play and by how much.
- **The out:** on the final chord, black for 5 s with no sound; then the end card for 10 s under the circus music
  from its start; then stop.
- **Sound:** the voice at full level; the music ducked under each clip and up between them, and never ducked in the
  coda; the game's sounds on their hits (the chair's clang at each landing, a boo on the filing), read from the
  takes' `landed` files.
- **Captions:** `captions(commentary, timeline)` writes `.srt` beside the film, each line shown while its share of
  its clip plays (by its share of the clip's characters), and the same cues are burned in: white on a translucent
  dark band at the foot, in the board's own body font. `--clean` leaves them off the picture.
- **Without inputs:** with no voice folder, each clip is silence of the length its words would take at 150 words a
  minute; with no music, silence. The film says "PLACEHOLDER SOUND" in a corner of every frame, so a silent cut is
  never taken for the film.
- Tests first, `edit-commentary.test.mjs`, on the pure parts: the timeline for a made-up set of clip lengths and a
  made-up map (part one's lengths follow the clips; part two starts where part one ends; the black and the card
  follow the last chord); `captions` for a node of three lines; the refusal passes through from `fit`.

## Task 9. The truth check, and the note to the owner

Model: sonnet

- New `docs/research/2026-11-21-commentary-video/claims.md`, a record: every sentence of the script a player could
  act on, the code that makes it true (file and line), and the date. At least: a Heel is paid by excited-negative
  votes and costs on calm-positive ones; every card back looks the same; a caught card goes to the setter; a card can
  spring on a phrase; a player has several characters and no other player can see which; a node of the page is not
  the game's (no claim); the chatbot card's model.
- **Stop on "GPT-2".** Find the model the instance's settings name for You Were Saying?. If it is not GPT-2 itself,
  do not change the line: report it to the owner with the model's name and the safe wording, "a chatbot from 2021".
- State in the PR what the video waits on before it is published: `systemEnabled` true in the deployed instance, the
  owner's voice or the placeholder's clips, the two recordings, and the open items of the design's section 9.

## Review focus

- Whether node 2's take films the rule or a staging of it: the forecast must move because the fake scored the
  reactions for a Heel, not because the shot set a number.
- Whether anything of the stage, the nodes or the tools can reach the web bundle (`tools/check-web-bundle.mjs`).
- Whether a take's timing depends on the machine: every wait in a shot is on the page's virtual clock or on a
  condition, never on the wall clock.
- Whether the edit can produce a film that looks finished with a clip silently missing or a window overrun.
- Whether any staff line on screen differs from the rehearsal's output beyond the recast names round 1 recorded.
- Whether the script's words in `commentary.ts` still match the design's after the owner's later line changes: the
  design is a record, and the data file is what the film says.
