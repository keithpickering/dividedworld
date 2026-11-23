Record, written 2026-11-23.

# The Wiggler thread at the front door: design

The owner, after the thread under the commentary video was written (`docs/plans/2026-11-22-wiggler-thread-design.md`, #1006):
"It contains an extreme example of a thread with all sorts of effects, and I'm thinking it may work as a better example for the
Front Door than what is there currently, possibly trimmed down, but with the same general arc." The front door today is six posts
under "WELCOME TO THE BEEF ZONE" (`instances/divided-world/ui/front-door.ts`), drawn by the thread's own pieces on staged stores
(`docs/plans/2026-11-07-front-door-play-design.md`). This design replaces its thread with ten posts of the Wiggler thread and adds
the two things the engine's front door cannot yet stage: an effect's saved state and a surface card's draws.

**World.** The board, as the front door is now. The persona's note under the thread stays word for word, "rated M" included (the
owner: this thread is the restrained example for someone landing on it, not a change of rating).

## 1. What comes over, and what stays with the film

**Decided.** The forum's half of the arc comes over: an earnest sprite sheet, a Heel's insult, a confused Jabroni, a rant taped
over, the Face's burn, the shading critique, the "fix", the AI accusation, the exit. The Mods' half stays with the film: the Hall
Pass, visits, filings, warn bars, Take the Fall, the quiz, So Very Happy's lockout, the spun thread, the Turn and the move. The front
door draws posts, the plays on them and their reactions (`FrontDoorPost`, `engine/ui/types.ts`), and nothing of The System; the beats
that only land through a filing ("Some go their whole lives wondering…", "This has been debunked, D-Guy.", the Turn) are cut whole
rather than kept without their punchline.

Weighed: staging Mod activity on the front door (a filed post, a warn bar). That is a new staged kind with its own design, and the
owner did not ask for it here. It is open (section 7).

## 2. The thread

**Decided** with the owner, 2026-11-23. Title: **Look At My Wiggler Sprites**. Label unchanged ("Sample thread · made up").

The cast keeps one character of each posting class, each through the postbit's "Revealed:" line. Human Josh leaves and
**Hotel Bro** (Heel) comes in, drawn with his initial until the owner supplies his pictures (open, section 7).

| # | By | Words | Plays (caster) | Reactions |
|---|---|---|---|---|
| 1 | Snuckles | "Hi divided world, it's ya boy Snuckles here with my first ever sprite sheet. He's an original character I invented after I saw him in a Mario game." / the sheet / "Let me know what you think!" | Graffiti (Serious Deer), its wall drawn by three hands (section 4) | ❤️ 1 |
| 2 | D-Guy | "The walk looks like it was hard to make 💪" | Feelin' Fab (Snuckles) | ❤️ 1 |
| 3 | Hotel Bro | "OF COURSE YOUR SPRITES LOOK LIKE THIS WITH THOSE STEAMBOAT WILLIE ASS FINGERS" | Whoops! in tomato red (Chadluminum), partly washed by Hotel Bro (section 3); the play 😂 2 | 🍅 5, 👍 1 |
| 4 | Snuckles | "I don't understand. Is that good or bad? Steamboat Willie is a classic." | | 😂 1 |
| 5 | Hotel Bro | "Who was that react from?! Come fight me like a man and I'll show ya where to put that thumbs up." | Autocorrect ×3: "man" → "Goomba" (D-Guy), "where" → "how" (Chadluminum), "put that thumbs up" → "do the Mario" (Serious Deer); the last play 😂 2 | 👍 7, 🍅 2 |
| 6 | Chadluminum | "Big talk from a guy whose girlfriend went to 7 hotels in one night." | Overreaction 💀 (D-Guy), Feelin' Fab ×2 (Serious Deer, Snuckles), Steel Chair (Hotel Bro) | 💀 4, 🔥 2, 💯 1 |
| 7 | Serious Deer | "You would do well to address the pillow shading." | | 💡 1 |
| 8 | Snuckles | "What's shading?" / "EDIT: ok I looked it up. I think I fixed it." / the drop-shadow sheet | | 🤦 2 |
| 9 | Serious Deer | "After analyzing the pixels in this sprite sheet I have come to the unfortunate conclusion that it was created with the assistance of generative AI." | Below the Fold (Hotel Bro) | 👎 1 |
| 10 | Snuckles | "That does it! I'll kindly take my Wigglers elsewhere!!!" | | 😂 2 |

- **The counts** are the owner's: a quiet post gets nought to two reactions of one kind, and the hits (#3, #5, #6) get several. #5's
  seven 👍 answer Hotel Bro's complaint about the one on #3.
- **#8 joins the film's #16 and #19**, so Snuckles does not post twice in a row, with "EDIT:" as the forum's own joint. The owner
  approved the join; the words are reviewed in the PR.
- **#8 quotes nothing.** A quote on the front door can only be a counterfeit (a real quote names an Act's UUID, `engine/bbcode/parse.ts`),
  drawn with the wobbling border that tells a reader the quote is fake. Snuckles is not faking Serious Deer, and #8 follows #7 directly.
- **The words are the owner's** (#1006), except #8's joint. The film's #1 text is used whole.

## 3. Whoops! on #3: tomato red, partly washed

**Decided.** The owner: "Close to the tomatoes is a good idea, it gives the play meaning: 'your post got lots of tomatoes, here's what
that would look like'." The ink is `#e8402a`, a custom hex near the 🍅 rather than one of the six swatches; Whoops! takes any color
(`validateConfig`, `instances/divided-world/cards/whoops.ts`). Chadluminum throws it, which sets up his burn in #6.

The splat is **partly washed**, so the words read at first. Only the post's author can wash for every reader, so the wash is Hotel
Bro's own saved state: a list of wash strokes (`validateState`, the same file), staged as the play's saved state. Each pass of a wash
takes some of the ink (`WASH_TAKES`, `instances/divided-world/cards/whoops/field.ts`), so a few overlapping passes leave thinned ink
the words read through (`READ_THROUGH`) and heavier ink at the splat's edges and core: the natural partial scrub, at half opacity
where it was washed once. The Lens reports how much is washed, truthfully, and a visitor can scrub further on their own screen.

Weighed: seeding the visitor's own scrub. The Lens would then say "washed for you" of a scrub the visitor never made. Rejected.

## 4. Staged saved state and staged wall draws: the engine

**Decided.** A front door play may carry two things it cannot carry today:

- `state`: what the post's author saved for the play. The page puts it in its plays store (`Plays.setStates`) at the staged instant,
  so the effect loads it as a thread's effect loads an author's save.
- `draws`: for a surface card, the draws on its wall, each `{ by, draw }`, oldest first. The page runs each through the card's own
  `surface.validateDraw`, makes each a `draw` Act on the play with the payload the rules returned, counts the cells covered from the
  rules' strokes (`cellsOf`, `count`, `union`, `engine/rules/surface.ts`), and puts the wall in the store (`Plays.setSurfaceActs`). A
  staged page never reads a wall from the server: the effect slot's `near` (`engine/ui/cards/Effects.tsx`) does nothing under
  `StagedCtx`, as `draw`, `wash` and `save` already refuse there.

Both are general: any card with a saved state, any surface card. The engine names no card.

**The check.** `frontDoorProblems` (`engine/ui/tips/problems.ts`) holds every staged play to its card's rules: the config passes
`validateConfig`, a `state` passes `validateState` (and a card without one carries none), `draws` belong only to a surface card, each
passes `validateDraw`, there are at most `surface.mostLive` of them, and the cells they cover stay within `surfaceMost`. A broken mark
fails the build in words that name the post and the play. It also accepts a reaction count keyed by the local kind a reaction card's
play adds to that post (`localKey`, `engine/rules/emoji.ts`), which is how #6's 💀 is counted, and refuses one no play on the post adds.

Weighed: leaving Graffiti off (no surface work). The critique wall is the opener's joke and the owner chose the real wall.

## 5. Strokes from shapes

**Decided.** The graffiti and the wash are described as shapes in Divided World's front door content: an arrow from here to there,
a ring around this, a hand-lettered "??", a heart, a scribble-out, wash passes across these bands. Small helpers turn each shape into
strokes in the card's own format, with a fixed-seed wobble, so every visitor sees the same hand-drawn marks and a review can move
one by changing a number. The owner approves them from screenshots.

The wall on #1:

- **Serious Deer** (red, stock cap): a ring around the Example panel's wiggler and an arrow into it, at the pillow shading.
- **Hotel Bro** (black, fat cap): "??" beside the "Build Yer Own" panel, and a scribble-out over a line of the sheet's credit text.
- **D-Guy** (pink, stock cap): a small heart near "Let me know what you think!".

Weighed: the owner drawing them in Storybook with an export. More authentic, but a story-only tool and a drawing pass for a few marks.

## 6. The sheets, and where pictures come from

**Decided.** The two sheets live beside the front door's content and are bundled as the avatars are (a `?url` import). A post's image
must be an `http(s)` address (`safeImageSrc`, `engine/bbcode/parse.ts`), and a bundle's address is root-relative, so the front door
makes a root-relative image address in a staged post absolute against the page's own origin before it parses the words. The words are
the instance's committed content, never a player's, and the same thread then works on dw.gripe, a test instance and localhost.

The drop-shadow sheet is made by a committed Pillow script from the original: a hard black offset shadow under every non-white pixel,
sprites, borders, headings and credit text alike (the owner: "Everything"), the look of someone who has just found Layer Style.

## 7. The film keeps its own cast

**Decided.** The hype stage reads the front door's cast today (`instances/divided-world/ui/hype/stage-world.ts`), and its takes, test
and shot scripts use Human Josh by name. The stage gets its own list of the five it films with now, and stops reading the front
door's. The film's move to Hotel Bro belongs to #1006's build, which already lists the cast as owed.

## The rules this touches

- **A response never proves a private fact.** The front door still calls no API method; the test that wraps every backend method
  covers the staged wall and the staged state.
- **No player is ever stuck.** No state is added that a player, character or post can be put in. The partial wash is a visitor's to
  scrub further on their own screen, and a reload restores the thread as written.
- **KayfaBB never knows which instance it runs.** The engine takes a `state` and `draws` on any play and reads them through the card's
  rules; the cards, colors, words and shapes are Divided World's.
- **The fiction may lie; the log never does.** The Lens's washed share is the staged wash's own; nothing on the page claims a visitor did it.
- **An effect fills the post, border to border.** Unchanged: every effect is drawn by its card's own Effect in the post's content area.

## Open

- **Hotel Bro's pictures.** The owner supplies a square and a portrait; until then the postbit draws his initial. Adding them is one
  import each in the content file.
- **Mod activity on the front door.** Not designed. If wanted, a design of its own: a staged filing, a visit mark, a warn bar.
