# Laugh Track, and the sound it brings: design

Record, written 2026-11-11. A design session with the owner, on the card the card-notes appraisal left for a design of
its own (`docs/plans/2026-11-11-card-notes-design.md`, section 2, "Laugh Track", and its Part 8). The card, as the
owner's notes have it:

> Add a sitcom audience to a post, selecting parts of its text that will play audible laughter, cheering, or booing as
> they are read.

The appraisal settled that it holds as an uncommon Pepperoni Move on a post, that it brings the game's first sound
setting, that its accessible path is a caption shown with sound off as well, and that its recordings are the project's
own or licensed for it. It left the reading trigger and the cross-fades to this session. Mid-session the owner pointed
at issue #240 ("Idea board: gameplay audio, and its settings"), which asks for one audio engine and its settings before
any feature brings its own `<audio>`. The owner chose to design that foundation here, with Laugh Track as its first
user. The plan is `docs/plans/2026-11-11-laugh-track-plan.md`.

The design has two halves: the sound foundation (engine, sections 1 to 4) and the card (Divided World, sections 5 to
8). Each was confirmed with the owner as a whole after the questions below.

## 0. What the owner decided, and what was weighed

Each question was asked with its alternatives; the owner's choice is first.

1. **When a cue plays: on a reading line.** A cued place plays the first time it rests on a line about 40% down the
   reading space for a moment while the reader scrolls. Weighed: a reading heat map from pointer, touch and scroll
   together (the appraisal's idea; guesswork on a phone, and hard to make predictable); the post playing its cues in
   order on a timer once on screen (the autoplaying MIDI, tied to time and not to the words).
2. **What a cue is: a phrase, at every place it appears.** A running gag ("the crowd boos every time he says Luigi"),
   found by the engine's phrase matcher, so cues follow the author's edits and a Mod Bot can name them. Weighed: the
   one selected place (a phrase and which occurrence; it moves to the wrong place when an earlier copy is edited out);
   exact offsets (any edit silences the play, an easy way out of every one). The owner added: **"Let's think about
   experimenting with proximity: maybe hovering near a 'boo' will begin a bit of a murmur."** That murmur is section 6's
   build-up, and it is the cross-fade the appraisal left open.
3. **The foundation is in this design** (#240's engine, its settings, and the slot an instance fills), with Laugh Track
   as Part 2 on top of it. The navigation click stays on #240. Weighed: building the click too, as a second user;
   a separate design for #240 first.
4. **The settings: off by default, in two categories, offered during the welcome step as Brighter effects is.** Game
   sounds and Interface sounds, each Off or On with its own volume. Weighed: one Sound row and a Volume row; sound on
   by default (more people hear the joke, more are startled).
5. **The palette: Laugh, Cheer and Boo, each with its own build-up** (a titter before a laugh, an "ooh" before a
   cheer, a grumble before a boo), and two or three takes of each hit. Weighed: one murmur for every cue (fewer files,
   but no hint of what is coming); a wider palette of Aww, Ooh, Gasp, Applause and a rimshot (twice the sourcing, and
   the card's text changes).
6. **One director per post.** The owner: "the 'sitcom audience' shouldn't be fighting amongst themselves... in a real
   sitcom a laugh track is one director's vision for when the crowd should react." So Laugh Track stacks 1 and a play
   holds the whole script. Weighed: three plays to a post; stacking only where a cue is far enough from words already
   cued (coherent, but a refusal that turns on distance is hard to say on the play form and hard to predict).
7. **Up to five cues in a play.** Weighed: three; no set count, bounded by price alone.
8. **Captions in one shared bar, at the bottom of the screen, above the HUD.** The session recommended a caption box
   dropping in after the phrase when it fires. The owner: "care will need to be taken to keep it responsive, and to
   avoid both reflowing the surrounding text when a caption pops in + covering the surrounding text with a caption that
   doesn't reflow it. One option is to make a shared TV CC box that renders fixed at the bottom of the player's screen
   (above the HUD), more like actual closed-captioning - when a cue is hovered or focused the CC can update, and it
   disappears after the sound stops playing." Adopted: it is real closed captioning, it never touches the post's
   layout, and it belongs to the foundation, not to the card. Weighed: the phrase marked ahead with a dotted
   underline; an inline comic-book sound-word.
   **Its look: TV captions in a glass tray.** The owner first leaned to a glass panel ("since this will be reused for
   other sounds as well, but it might be worth prototyping to test the options out. The rec sounds like it could add
   too much height to the HUD"), so the session made a bench of the three looks working in place
   (`docs/research/2026-11-11-laugh-track-bench/01-bench.html`), and the owner chose the tray from it. Weighed there: a
   glass panel in the glass's own type, the toasts' kin; bare TV captions with no glass around them.
   **A fired cue's mark: a dotted underline in its sound's flavor ink** (Laugh in Pepperoni's orange, Cheer in Sweet's
   pink, Boo in Salty's blue: the board's own inks for the game's pieces). Weighed: one color for every cue; the board's
   muted ink.
9. **The murmur is captioned too** ("[a grumble rises]"), so a reader with sound off gets the build-up as well as the
   punchline. Weighed: captioning the cue alone.
10. **It can be set face down, and the back waits for its first cue's phrase.** "Boo whoever quotes me saying Luigi."
    Weighed: any cue's phrase springing it (the engine's backs hold one phrase today); face up only, as You Were
    Saying? is.
11. **The recordings.** The owner: "If we can't source these sounds or generate them here I can try to generate them in
    elevenlabs." The session cannot judge a laugh by ear, so the owner generates them from the plan's brief.

## 1. The audio engine (engine)

One place where sounds are loaded, played and mixed (`engine/ui/audio/`), so no feature brings its own `<audio>`.

- **One Web Audio context a page**, made on first use. It is unlocked by the reader's first click, tap or key press
  after the page loads, as the browser requires. A sound asked for before the unlock is **skipped, never queued**, so a
  page never bursts into every sound it saved up; its caption is still shown (section 3).
- **Two buses, Game and Interface**, each a gain the account's settings drive (section 2). A bus that is off plays
  nothing and loads nothing.
- **Loading** is lazy: a sound's file is fetched and decoded the first time it is asked for while its bus is on, and
  kept for the page's life. An instance's sounds are files the bundler resolves, as card art is.
- **Voice groups.** A sound may name a group. A new sound in a group cross-fades over the one already sounding there,
  over a time the caller gives, so a group is one voice. Laugh Track's is one "audience" for the whole page: two posts'
  cues never pile up.
- **Loops with a live gain**, for a build-up: the caller starts a loop, sets its gain as often as it likes (smoothed,
  never stepped), and stops it. A loop at gain 0 is silent and stays cheap.
- **A hidden tab is suspended**, and resumed when shown.
- **Every sound has a caption.** A sound slot carries its caption, and the engine posts it to the caption bar itself
  when the sound plays, or would play with its bus off. A feature cannot play a sound without one. This is #240's
  "anything audible is also visible", held by the shape of the code.

## 2. The settings (engine)

Four fields on `account_preferences`, read by their own account alone like the rest, and in the instance's export:

| Field | Values | Default |
|---|---|---|
| Game sounds | Off, On | Off |
| Game volume | 0 to 100 | 80 |
| Interface sounds | Off, On | Off |
| Interface volume | 0 to 100 | 80 |

- **Where:** a new **Sound** section of Settings, and the welcome page's Before you start, after Brighter effects. A
  volume shows only while its category is on.
- **Copy**, plain and never in character (the plan holds the words): Game sounds are the sounds cards and game effects
  make on the board; Interface sounds are the board's own clicks and chimes. Both are off until turned on, and every
  sound is also shown as a caption.
- **A preview.** An instance may name one of its sounds as each category's preview. Releasing a volume control plays
  it at the new volume, so a player hears what they chose. With no preview named, nothing plays.

## 3. The caption bar (engine, the glass)

One bar for the whole page, fixed at the bottom of the screen above the HUD's seam. The alerts' toasts stack above it.

- It shows the caption of whatever sound is sounding, or would be with its bus off, for **game** sounds, and clears
  when the sound ends (or, with sound off, after the sound's own length).
- A newer caption replaces an older one. A loop's caption shows while its gain is above a threshold and goes with it.
- It is a **polite live region**, so a screen reader announces it.
- A feature can show a caption without playing it (Laugh Track's replay on focus with sound off).
- It is the glass, plain, never in character. **Its look** (the owner's choice from the bench): 1990s TV captions,
  white monospace capitals on solid black, held in a slim chamfered glass tray with the glass's neon edge, centered,
  as wide as its words and never wider than the page less its gutters. A small dot in the sound's own ink leads the
  words (a feature may give one). It never covers the HUD, the hand or a dialog.
- **Open:** whether an interface sound captions with sound off (the IE click's visible twin is the loading meter
  already). Decided when the first interface sound is designed; this design adds none.

## 4. What an instance supplies (the layers)

`InstanceUi.sounds`: each sound's key, file, bus and caption, and the optional preview for each bus. The engine names no
sound. A card's effect asks for its own sounds by key through the engine's hook.

**Provenance.** Each instance's sounds folder holds a manifest naming, for every file, where it came from, its license
and who made it, as card art's `art.json` does. A new check, `tools/check-sounds.mjs`, refuses a file with no manifest
entry, an entry with no file, an entry with no license, and a slot in `InstanceUi.sounds` whose file is not in the
folder. It arrives with its self-test, driven red by each poison (CLAUDE.md, "A guard that has never been red").

## 5. Laugh Track's rules (Divided World)

- **The card.** Key `laugh-track`, "Laugh Track", Pepperoni, uncommon, a Move on a post, seeded, sold at 1.50 with
  the other uncommons.
- **Stack 1: one director.** A second cast is refused in plain words: "this post already has an audience".
- **Its configuration: one to five cues.** A cue is a phrase and a sound: Laugh, Cheer or Boo. A phrase is bounded as
  Autocorrect's is (whole words in any case, at least 4 letters or digits, at most 100 characters, one line), and found
  by the engine's matcher (`engine/bbcode/phrase.ts`) at every place it is in the post's own words: never in a quote,
  code or a link. No two cues' places may overlap. Two cues with the same phrase are one cue too many, and refused.
- **It lands** only where every cue's phrase is in the post; a missing one is refused by name ("“Luigi” is not in
  this post's own words"). A play is priced against the version of the post the caster saw, as Autocorrect is, and
  refused if the post has another (0070). After an edit, cues follow their phrases, and a cue whose phrase is edited out
  goes quiet.
- **Its price:** the base price, plus 0.05 for each cued place past the first five, never more than 1.00 added
  (`laughTrack.perPlace`, `laughTrack.freePlaces`, `laughTrack.mostAdded`). **At most thirty cued places** in a play,
  so a common phrase cannot wallpaper a long post; a play past it is refused, saying how many places its cues cover.
- **Face down.** It can be set face down on one's own post. The back waits for a quote whose own words hold its first
  cue's phrase (`setPhrase`), as a set Autocorrect does. It lands on the quoting post, and any other cue whose phrase is
  not there stays quiet. The play form says which cue the back waits for.
- **The seed** the server stores on the play picks each cued place's take, so every reader hears the same laugh.
- **A Mod Bot** plays it by naming phrases copied from the post and their sounds. By CLAUDE.md's rule on validators
  tighter than the schema, a sixth cue is trimmed rather than refused, and cues that overlap, are not in the post, or
  pass the thirty places are dropped, so long as one remains; each trim is written on the call's record. A player's
  play is never repaired: the form holds five rows and the server refuses what is wrong in plain words. The engine gains
  the interface this needs, `CardRules.repairStaff` (a card's repair of a persona's options against the post, with the
  trims it made), called where the chatter function decides a persona's options; the card names nothing the engine
  knows.
- **No saved state.** Nothing about it is the author's to save.

## 6. On the board (Divided World)

- **The reading line** is 40% of the way down the space between the top of the window and the HUD. A cued place
  **fires** the first time it rests on the line for 0.4 seconds, so a fling past it fires nothing. A place fires once
  a visit to the page.
- **The build-up.** As an unfired place nears the line, within 12rem, or a fine pointer nears it, the murmur of its
  kind swells: a titter before a laugh, an "ooh" before a cheer, a grumble before a boo. Its caption shows
  ("[the audience titters]"). The nearest unfired place decides which murmur.
- **The hit.** When a place fires, its take cross-fades over the murmur in the page's one audience voice, about 250ms,
  and the bar shows the cue's caption ("[THE AUDIENCE BOOS]").
- **After it fires** the phrase carries a dotted underline in its sound's flavor ink (Laugh Pepperoni, Cheer Sweet, Boo
  Salty) that does not move a word, and its first piece is a button,
  "Replay: the audience boos". Hover, focus or a tap replays it and shows its caption. Before it fires nothing marks
  the phrase, so the joke is not telegraphed.
- **With sound off** everything happens alike: places fire, murmurs and hits are captioned. The card's Lens offers a
  "Game sounds" toggle that sets the account's setting.
- **In a play's moment** (history) nothing fires or plays; the Lens says how many cues the play holds.
- **The play form** follows Autocorrect's: up to five rows of phrase and sound, each counting "Cues N places in this
  post" live, through the same matcher. Selecting words in a read-only copy of the post fills the focused row's phrase.
- **Its look** is the board's house style: Verdana, the board's ink and ground, color only on the underline and the
  caption's dot. The play form is Autocorrect's form with more rows. The bench shows the behavior and the marks.
- **The screen numbers** (the line's place, the dwell, the build-up's reach and loudness, the fade) are the card's
  `screenReads` in `cardSettings`, so an instance can tune them.

## 7. The sounds (Divided World)

Twelve files, MP3, mono: three takes each of Laugh, Cheer and Boo (two to four seconds each), and three seamless
build-up loops (four to six seconds each). The plan holds a brief for each: a prompt to generate it, its length, and
whether it loops. **The owner generates them** and confirms their tool's terms allow them to be redistributed in an
open-source repository; the manifest records the source, the terms and the maker.

The card is not built until the twelve files and their manifest are on `main` (the plan's Part 2): an instance's card
is in its booster packs from the moment it is listed, so a card with no sounds would be drawn in a pack and play
silence.

## 8. The masks, the ways out, and a busy page

- **The masks.** Nothing about reading is sent: what fires, when, and what the bar says are computed on the reader's
  own screen from the play's public cues and the reader's own scroll and pointer. No sound, caption or timing depends on
  who owns, wrote or cast anything. The settings are read by their own account alone. #240's warning ("a sound that
  plays for someone else's act, or one whose timing differs with who owns a target, would be a tell") holds because a
  sound plays only for what the reader's own screen shows.
- **The ways out.** A reader turns Game sounds off, in Settings or from the post's Lens; the captions remain. The
  author can edit a phrase out. An admin can end the play. Nothing holds anyone.
- **A busy page.** A thread page of many posts carrying Laugh Track runs one scroll listener and one pointer listener
  for the page, not one a post: places register with a page-level watcher, which reads their boxes once a frame only
  while the page scrolls or the pointer moves, and only for places near the viewport (an intersection observer says
  which). At thirty places a post and forty posts a page that is at most 1,200 places, of which only those on screen
  are measured.

## 9. Open

- Whether an interface sound captions with sound off (section 3).
- The navigation click, and any other sound, stays on #240.
