# Divided World hype video: storyboard

Record, written 2026-11-14. A storyboard for a hype video to share on the first day of invites, drafted with the owner
after a proof shot showed the game can be filmed frame by frame from its own fixtures (`tools/hype/camera.mjs`,
uncommitted on that date). It surveyed the board stories, the two season rehearsals
(`docs/research/2026-11-13-season-rehearsal/` and `docs/research/2026-11-13-season-rehearsal-run-2/`) and the proof
shot. Nothing here is built except shot W2's first take. Every staff line quoted is from run 2's logs, word for word.

## The idea

A trailer that treats being cool on a forum as a matter of life and death. Full orchestra and choir, quick cuts, title
cards in a wrestling announcer's voice, and under all of it a 2003 message board where someone is scrubbing ink off a
post about sprites. The video never winks. The joke is the gap between the music and the stakes.

- **Length:** 75 seconds. A 30-second cut is the cold open, the montage and the ending.
- **Format:** 1920×1080 at 60 frames a second, filmed at double density. A 9:16 cut can be re-filmed at a phone
  viewport from the same shot scripts, since each shot is a script and not a recording.
- **Music:** Verdi's "Dies Irae" (Requiem), a public-domain composition, in a recording whose license allows this use.
  "O Fortuna" is still under copyright. The edit is keyed to a list of beat times, so the track can change late.
- **Sound:** the game's own crowd sounds (`instances/divided-world/ui/sounds/`: boo, cheer, laugh, ooh, titter, grumble)
  punch through the music on the hits they belong to.
- **Skins:** each cut may change the forum skin (Blue Steel, Fan Site, Hot Rod, Midnight, and the default). The
  montage changes skin on nearly every cut; the running gag keeps one skin so it reads as the same poor soul.
- **Faces:** the Front Door's five avatars (Snuckles, Chadluminum, Serious Deer, Human Josh, D-Guy) are worn by the
  thread's characters, so no post is an initial in a box.

## What it must not do

- Show nothing the game lacks. No boss fight screen, no shred, redact or timebomb. The Staff are what they are: a pool
  of robot clowns who move the board around and hand out nuisance warnings, with one Boss at a time.
- Say nothing false about the game on a title card. The cards may boast and joke; they do not bluff ("The fiction may
  lie; the log never does" covers the glass's voice, and a trailer card is closer to the glass than to a character).
  The staff quotes are in character and are real output.
- Use no real player's name or post. Every character on screen is the fixture's or the rehearsal's made-up cast.

## Structure

| Time | Section | Music | What it does |
|---|---|---|---|
| 0:00–0:07 | 1. Cold open | Silence, room tone | One mundane post. One reaction. |
| 0:07–0:20 | 2. The world | First hits, full choir | What this place is: a forum, masks, cards. |
| 0:20–0:28 | 3. Scrub, round one | Choir, driving | The running gag begins. |
| 0:28–0:42 | 4. The arsenal | Fastest cuts | Cards and effects, a skin per cut. |
| 0:42–0:47 | 5. Scrub, round two | Brass | Worse. |
| 0:47–0:58 | 6. The Staff | Drops to a low pulse, then builds | Robot clowns in charge. The handover. |
| 0:58–1:03 | 7. Scrub, round three | Full fury | Hysteria. |
| 1:03–1:10 | 8. The hand | Final crescendo | Every card in the game, fanned. |
| 1:10–1:15 | 9. Ending | Cut to silence | The title, the address, one titter. |

## Shots

Each shot has an ID the shot scripts will use. "Source" is where the footage comes from: a board story, a fixture
moment, or a rehearsal log that has to be turned into a fixture first.

### 1. Cold open (0:00–0:07)

- **C1.** Black. Then a plain thread on the default skin, held still. A post: something small and sincere about
  sprites. No music. *Source: the stage story, a post chosen from a rehearsal thread.*
- **C2.** The pointer drifts to the reaction control. It hesitates. It picks one.
- **C3.** The reaction lands with its stamp, and the first orchestral hit lands on the same frame. Cut to black.
  *Needs the reaction animation from PR 696, which was on its own branch on this date.*

### 2. The world (0:07–0:20)

- **T1.** Card: **IN A WORLD.** Beat. **DIVIDED.**
- **W1.** The Front Door, the cast's five faces. *Source: "Boards/00 Front door".*
- **W2.** The board index, busy. Skin change on the hit. *Source: "Boards/01 Index".*
- **T2.** Card: **EVERYONE WEARS A MASK.**
- **W3.** The HUD's mask switch: one player, flipped through three characters, the class tag changing each time
  ("HEEL · ONLY YOU SEE THIS"). *Source: the stage story's HUD.*
- **T3.** Card: **NO ONE KNOWS WHO YOU ARE.** Beat. **ESPECIALLY YOUR FRIENDS.**
- **W4.** The Vending Machine, then a pack tearing open with the foil catching light, timed so the tear is on a hit.
  *Source: "Boards/Booster packs", "Boards/07 Vending Phone" and the desktop machine.*

### 3. Scrub, round one (0:20–0:28)

The running gag: one post, three coats of ink, one layer per visit, and a poster losing their composure. All three
rounds keep the same framing and skin, tight on the post, so each return is recognized at once.

- **S1.** A Whoops! lands on the post, then a second, then a third, each on a beat, the mark counting ×1, ×2, ×3.
- **S2.** A pause. The pointer enters slowly, like someone who thinks this is fixable. Careful, even strokes along the
  top of the yellow. Suds. It is working. Cut away with most of the yellow still there.

How the scrubbing should move, for all three rounds: like a hand, not a function. Strokes of uneven length that
overshoot the ink and come back. A stroke abandoned halfway to go at a spot that was missed. A short pause to look. A
tight circle worried into one stubborn patch. The first proof's even side-to-side sweep is replaced by a list of
gestures (long stroke, short stroke, dab, circle, hesitate) drawn in a seeded random order with speed and reach that
vary by round.

### 4. The arsenal (0:28–0:42)

One to one and a half seconds each, a new skin on most cuts, each cut on a beat. Order is by rising chaos.

- **A1.** Autocorrect: a post's words swapping under the reader's eyes. Three quick swaps on three choir syllables.
  *Source: "Boards/11 Autocorrect".*
- **A2.** Glitter Bomb: the burst on an unmarked post, then the pointer dragging through it and carrying glitter off
  across the page. *Source: "Boards/09 Glitter Bomb". Filmed on its own post: under ink the first proof showed no
  glitter.*
- **A3.** Graffiti wall. *Source: "Boards/01 Graffiti wall".*
- **A4.** Stick Around: a reader tries to scroll away and is snapped back. Twice, in rhythm. *Source: "Boards/08
  Hold".*
- **A5.** Laugh Track: the crowd laughs at a post, the game's own laugh in the mix. *Source: "Boards/21 Laugh Track".*
- **A6.** Jimmy Wails, Whodunnit, Below the Fold, You Were Saying: four half-second flashes. *Source: their
  stories.*
- **A7.** The warn meter filling, cut in three steps across three beats. *Source: "Boards/14 Staff" or the postbit.*
- **T4.** Card, over the last hit: **52 CARDS.** Beat. **ALL OF THEM A BAD IDEA.** *The owner's number: a deck's 52, which
  the game is expected to hold by launch (51 card art folders stood in `instances/divided-world/ui/cards/` on this date).*

### 5. Scrub, round two (0:42–0:47)

- **S3.** Same post. The yellow is gone; the cyan is not. The strokes are faster and less careful. Suds everywhere.
  A fourth Whoops! lands mid-scrub, in a new color, and the pointer stops dead for half a second. Cut.

### 6. The Staff (0:47–0:58)

The music drops to a low pulse. These are the people in charge, played completely straight.

- **T5.** Card: **THE STAFF.**
- **B1.** FanGaME, the Boss, posting a memo. Pull-quote on screen as he posts:
  *"FanGaME here, writing per my own initiative, as nobody asked."* *Source: run 2, honeymoon, day 2.*
- **B2.** QC-1000 filing a player's sincere post as a submission. Pull-quote:
  *"DECLINED: a version of this post already exists."* *Source: run 2, meltdown, day 1.*
- **B3.** ONTOPIC 5.0's star rating appearing on a thread. *Source: any run 2 day; its ratings run 1 to 5.*
- **B4.** The board itself moving: a board created, a thread moved, two boards merged, shown as the move notices
  landing one after another while the index reshuffles. On the merge, the Boss's own reason as a pull-quote:
  *"Nobody posted on my board anyway. (That is fine.)"* *Source: "Boards/11 Move notice"; run 2, handover, day 5.*
- **B5.** A nuisance warning landing on a perfectly good post, the game's boo under it. *Source: "Boards/01 Lens:
  discipline cards".*
- **T6.** Card: **EVERY REIGN ENDS.** The music starts to climb.
- **B6.** The handover. FanGaME's last memo: *"As discussed, this is my last post as Boss."* Cut to QC-1000 taking
  the chair, reviewing the farewell itself: *"Is this a demo or the full game?"* *Source: run 2, handover, day 6.*
- **B7.** Season news turning over to the next arc. *Source: "Boards/04 Season news".*

### 7. Scrub, round three (0:58–1:03)

- **S4.** Same post. Magenta, the last coat. No technique left: the pointer is everywhere, strokes too fast and too
  wide, missing the post entirely and coming back. It is nearly clean.
- **S5.** The last speck goes. The post is readable. Hold for one beat on the words, which are about sprites.
- **S6.** A fresh Whoops! lands. Cut on impact, before the reaction.

### 8. The hand (1:03–1:10)

- **H1.** Black, then the Hand fans open: every card in the game in one hand, far more than a hand should hold, the
  fan animation playing at full length on the final crescendo.
- **H2.** The pointer slides across the fan from one end to the other in one unhurried pass, each card lifting and
  catching foil as it is crossed. This is the only slow thing in the video.
- **H3.** The pointer comes back and picks one. The card comes forward. Cut to black before it is played.

*Source: the Hand (`engine/ui/cards/Hand.tsx`) on the stage, seeded with one of each card. Whether the fan
holds that many without changes was not checked on this date.*

### 9. Ending (1:10–1:15)

The music cuts dead on the cut to black.

- **T7.** Card: **DIVIDED WORLD.**
- **T8.** Card: **dw.gripe · BY INVITATION ONLY.**
- **T9.** Card, small, last: **CARD SUBJECT TO CHANGE.** One titter from the laugh track. Out.

"Card subject to change" is the line a wrestling promoter prints under a lineup, and here the card is also a card.
Two alternates for T8, if the owner prefers: **NO HOLDS BARRED. SOME POSTERS BARRED.** or **ONE NIGHT ONLY. EVERY
NIGHT.**

## What has to be built

1. **Clocks and capture: done.** The camera films frame by frame with the page's clocks held together; the proof shot
   shows the ink, the suds and the pointer at full quality.
2. **The stage grows.** Today it is the Main board's thread with the backend handed to the script. It needs: a skin
   switch, the five avatars seeded onto characters, a way to open any board story with the same controls, and a
   switch that hides what a shot does not want (the toast, the first-time tips, the address in the header).
3. **A human pointer.** A gesture library with seeded variation, in place of a formula. Used by every shot the pointer
   appears in, not only the scrub.
4. **Rehearsal moments as fixtures.** The staff shots (B1 to B7) come from event logs that nothing can load. A small
   adapter turns a chosen day of a log into a fixture: its threads, posts, staff posts and moves.
5. **Impact.** A live Whoops! has no landing animation and shows a flat placeholder for about three frames. The video
   cuts on the impact, or adds a camera punch in the edit. Whether the game itself should have a landing is the
   owner's call and a change to the game, not to the video.
6. **The edit.** Title cards in the game's own type, the cut list keyed to beat times, the music and crowd sounds
   mixed. Remotion is the proposed tool; nothing is installed.
7. **PR 696 on this branch**, for C3.

## The owner's answers, 2026-11-14

1. The title cards' voice is approved: a boast that is plainly a joke is the instance's to make.
2. The music is Verdi's "Dies Irae", in a recording whose license allows the use.
3. A staff line may be trimmed for length on screen.
4. No 9:16 cut for day one.
5. The card count on T4 is 52.

## What the first takes changed, 2026-11-14

Filmed on that date: the cold open, the three scrub rounds and the hand (`tools/hype/shot-cold-open.mjs`,
`tools/hype/shot-scrub.mjs`, `tools/hype/shot-hand.mjs`). What the takes and the owner's notes changed from the shots
above:

- **The cast and the thread.** The stage is a world of its own, not the boards fixture: the Front Door's five
  characters by name, with their avatars and classes, in a thread written for the video, "my first sprite sheet
  (please be normal)". The post the ink lands on is Snuckles's second.
- **The scrub is one continuous line.** The owner's note on the gesture list (long strokes, dabs, circles, pauses) was
  that it read as erratic and not as hard work. The hand is now one unbroken run of arcs that wanders the ink "like a
  fly buzzing around the box", headed for the coat on top wherever it is thickest.
- **The scrub digs through.** A stroke washes only the coat it began on, so the hand lifts and presses again for the
  coat below, and works a hole through all three to the words. Round 1 ends with the first words showing. Round 2
  opens with about half the post back, and the fourth coat lands over all of it. Round 3 opens a few patches from
  clean, comes clean, holds a beat, and then three more coats land one after another, faster each time.
- **Rounds 2 and 3 open on a staged post.** Washing three coats off honestly takes about 50 seconds, so the coats the
  earlier rounds would have washed are saved as washed before the camera runs. Each round's own washing is real.
- **The hand holds 35 cards**, in two rows: every card the game's rules define on that date. The pointer crosses the
  front row and comes back along the row behind, then picks one, which arms it.
- **The cold open's viewer is Chadluminum's player**, since a player cannot react to their own post. The reaction is
  a thumbs up, after a look at the fire.

### The arsenal's first takes

Six of the arsenal's shots were filmed on that date (`tools/hype/shot-montage.mjs`), each on a post the stage wrote for
it, further down the same thread:

| Shot | Skin | What the take shows |
|---|---|---|
| A1 Autocorrect | Midnight | Three strips of tape land on Chadluminum's kind words: "legally a horse", "a cry for help", "under duress". |
| A2 Glitter Bomb | Default | The burst on Serious Deer's post, about a second of it, then a faint scatter the pointer drags through. |
| A4 Stick Around | Fan Site | A reader scrolls to D-Guy's review and is held; two tries at the wheel take the Break Free bar to 30% and it falls back. |
| A5 Laugh Track | Blue Steel | The joke's dotted underline, and a click on it. There is little to see: the laugh is the sound, which the edit adds. |
| A6 Jimmy Wails | Hot Rod | The appeal on Snuckles's post, and the pointer giving 1.00 Aura. |
| A7 Warn meter | Midnight | A post ONTOPIC 5.0 has filed, and "Warnings: 6/10" on its author. Held, not filled in steps. |

Not filmed: A3 (the Graffiti wall), the four half-second flashes of A6 other than Jimmy Wails, and the warn meter
filling across three cuts. Stick Around holds every reader who reaches its post, so its card is landed by its own shot
and is not in the stage's world.

### The Staff, the pack, the cards and a rough cut

Also filmed on that date: the Staff's shots (`tools/hype/shot-staff.mjs`), the pack (`tools/hype/shot-pack.mjs`) and the
twelve title cards (`tools/hype/shot-cards.mjs`), and a first rough cut was assembled (`tools/hype/edit.mjs`): 78
seconds, the cuts timed by eye and by the sections above, not yet to the music's beats.

- **The Staff's words are the rehearsal's.** `tools/hype/staff-lines.mjs` takes eight lines from run 2's logs whole
  (FanGaME's memo and farewell, QC-1000's declined review and his arrival, an ONTOPIC 5.0 rating, and the Boss's
  reasons for three moves) and the stage posts them as those staff characters. The players' posts around them are
  written for the video, so the staff name posters this cast does not have.
- **The board moving around** is the Boss's profile, whose moderation log lists the boards he made. The index did not
  show the made boards on the stage, so B4 is not the index reshuffling.
- **Brighter Effects is on** for every shot (the owner's word): the Glitter Bomb reads with it.
- **The music** in the rough cut is the "Dies irae" from Wikimedia Commons, `ICBSA Verdi - Messa da requiem parte 03,
  Dies irae.ogg`: a transfer by Italy's Istituto centrale per i beni sonori ed audiovisivi of a recording the page
  dates between 1900 and 1950, two minutes long, under CC BY-SA 4.0. That license asks for credit and a link, and
  asks that a work built on the recording carry the same license; whether a video with it as its soundtrack is such a
  work is the owner's question to settle before the video is published. The page names two different orchestras.
- **Not in the rough cut:** the Front Door, the mask switch, the Graffiti wall, the four flashes, the pull-quotes
  laid over the Staff shots, and the season turning over.

### The ending, and the cuts on the beat

The owner's ending, added on that date: after the title and the address, black, and then "After 9 years in development"
comes up slowly out of it, as a trailer's "Coming this summer" does; then black again, and the sting, the very last
thing in the video: one hit of the music, "CARD SUBJECT TO CHANGE." in small print, and a titter. The cut runs 85
seconds with it.

The edit now finds the music's beats (where its loudness jumps) and moves each cut's end to the nearest one within a
third of a second, a card by holding it, a take by playing it a little faster or slower; 19 of the cuts under the
music moved.

### The owner's notes on the first cut

Given on that date, after the first cut with music, and what each changed:

- **The ending is the pick of the strongest card.** The hand's last press is on Ultra Happy Heart, the Unban, one of
  the game's two legendary cards. On that press the picture cuts to a dead channel's static, which is why the music
  stops. Then "DIVIDED WORLD", a hard cut to black, a pause, and "After nine years in development" comes up slowly
  and goes back down, under a storm. The address card, "CARD SUBJECT TO CHANGE." and the sting are gone: the owner
  called the ending's text superfluous.
- **The Staff's posts are held less, and less each time,** and end in four flashes.
- **The Boss's profile is filled in** for the trailer: interests, favorites, a mood, a signature, the season he leads,
  and six more moves in his moderation log. These are written for the video, in his voice.
- **The staff name the cast.** The rehearsal's posters, whom the staff's lines name, are renamed to the Front Door's
  five (`tools/hype/staff-lines.mjs`, `NAMES`); the lines are otherwise as the model wrote them, and each is kept as
  written beside its recast copy.
- **Snuckles has a sprite sheet.** The owner's own, his first submission, from 2005: a Wiggler. The thread's words
  follow it (a walk cycle of twelve frames, not an idle of four).
- **The mouse clicks.** The cold open's two presses and the last card's have a click, made by the edit and not
  recorded; so are the static and the storm.

### The last notes, and the cut as it was pushed

The owner's last notes on that date, and what each changed:

- **No static.** The press on Ultra Happy Heart cuts straight to the title, on the lightning strike of the owner's
  own storm recording, which takes the music's place. The storm runs on under the black and the last words.
- **The click is the machine's own**, Windows's navigation click, in place of the made one.
- **The title is the board's logo type**: bold capitals in Verdana, with the banner's letter spacing.
- **The black is black.** The pauses were made in the broadcast range inside a full-range film, and showed as dark
  gray; they are made full-range now.
- **The hand is filmed in Fan Site.**
- **The skins are the skins.** A story's page carries the house theme in its own bundle, which landed after the
  skin's sheet and won every token the two share, so every skinned take until then showed the house's colors under a
  skin's extras. The stage now moves the skin's sheet last, and the twelve skinned takes were filmed again at the
  same timings.
- **"ESPECIALLY YOUR FRIENDS." is autocorrected.** A real Autocorrect is landed on a post of the stage, and its strip,
  saying ENEMIES, is copied onto the title card and unrolled over FRIENDS by the effect's own roll of tape, the
  author's peel run backward. The card is no longer than it was.

The cut is 82 seconds. The films, the music and the recordings are not in the repository.
