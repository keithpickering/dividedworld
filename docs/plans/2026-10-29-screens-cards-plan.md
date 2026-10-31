# The screens: cards and their effects: plan

Record, written 2026-10-29. The third of three plans for `docs/plans/2026-10-29-screens-design.md`: the Vending
Machine, the hand, playing a card, and the effects of Stick Around and Whoops!. It starts after the web plan
(`docs/plans/2026-10-29-screens-web-plan.md`) is merged and works inside its brief, layers and guards. A build session
carries it out task by task, tests first, each red run recorded (`.claude/skills/build-session/SKILL.md`).

The two working prototypes are the reference for feel and numbers:
`docs/research/2026-10-29-screens/proto-q14-stick-around.html` and
`docs/research/2026-10-29-screens/proto-q15-whoops.html`. They are prototypes, not code to copy: the effects are
rebuilt as components and pure modules with tests, and the numbers below are starting points the season of play tunes.

**Amended 2026-10-29, after the two-worlds design** (`docs/plans/2026-10-29-two-worlds-design.md`, carried into the
web plan's brief, layout and Tasks 1, 3 and 12 by its own amendment). A card's machinery is the glass's and a post is
the board's. The boards in `docs/research/2026-10-29-two-worlds/` are the look; where a task below says otherwise, this
wins:

- **Task 2:** the Vending Machine is a glass page under the menu bar, as the Vending board draws it, its slots, price
  display and tray in the glass's type at the glass's sizes. The hand drawer is a glass overlay over the board, rising
  from the HUD, as the Main and Phone boards draw it; each card's description is its rules in plain words (design,
  section 3).
- **Task 3:** the play form is a glass overlay over the board, as the Cards board draws it. Arming a card marks each
  eligible post with a "Play Whoops! here" button in the glass's look over the post, which stays the board's.
- **Tasks 4 and 5:** the post a card lands on stays the board's 2003 post. What the card adds is the glass reaching
  in: Stick Around's frame, tag, handle, BREAK FREE button and certification panel, and Whoops!'s tag and Hold to scrub
  button, each in the glass's type, sizes and contrast rules (the web plan's Task 1 guard reads their tokens, and its
  Task 12 measurement covers them). Stick Around's frame is the board's cyan neon, as the Hold board draws it, in place
  of the gold frame Task 4 names; the ink of Whoops! is the caster's own color, as before.
- **Task 6:** the card lines are the log's, in the glass, in the words this task gives them.
- **Ways out:** unchanged; an overlay's way out is the web plan's (Esc or its close, onto what it was opened over).

**Amended 2026-10-30, after the boards' audit** (`docs/plans/2026-10-30-glass-to-the-boards-plan.md`), which wins over
the amendment above where they differ. Task 2 adds the board match's manifests for the Vending board, the Cards
board's hand sheet and the hand in the Main and Phone boards; Task 3 for the Cards board's play form, on Gloomba's #46,
and the Main board's armed card; Task 4 for the Hold board, seen by a reader who owns none of its characters (the
author is never held); Task 5 names Whoops!'s keyboard path "Hold to scrub" where the Main board wrote "Scrub with the
keyboard"; Task 6's log holds no Stick Around lines, so the Log board's eight rows are six. Stick Around's frame and
Whoops!'s tag draw the `effect` smoke recipe.

**Amended 2026-10-30, after PR #24 merged.** Tasks 1 to 5 are Part 3 of `docs/plans/2026-10-30-glass-build-plan.md`,
which says where they start and wins where it differs; Task 6 waits on issue #25's design of the log.

**Amended 2026-10-30, after issue #25's design.** Task 6 is Task 6 of `docs/plans/2026-10-30-log-shares-plan.md`, on
the log that plan builds.

**Amended 2026-10-30, the owner's answer on where a card play shows** (PR #39, Design questions). A card play is
shown only as its tag on the post it lands on ("Mrs. Hooligan played Whoops! on this post: “you dropped your ink”",
with when), as the Cards board draws it, and never as a line of its own in the thread. Main gave a card's Act a
number in its thread, like a post, and the thread drew it as a numbered line nobody could react to; in time order those
numbers fall between the posts and renumber them. The owner chose the tag ("We can go with your recommendation"):
reactions on the post are already what a play earns from (the settlement counts the target's reactions toward the
play), the posts keep their numbers, and the play stays a public Act, dated on its tag and true in the log. So Task 3
adds, tests first: a migration under which a `card` Act takes no thread number, as an `edit` takes none (the check on
`acts.seq` and `acts_take_seq` in `supabase/migrations/0001_core.sql`); the fake backend (`engine/ui/data/fake.ts`)
the same; the thread no longer drawing a card Act as a line (`CardLine` in `engine/ui/thread/lines.tsx` and its case in
`engine/ui/thread/Post.tsx`); the play's tag on its post, linking to the play; and the boards fixture
(`web/src/data/fixtures/boards.ts`) writing its plays in time order between the posts, its pinning test turned to
assert that page 3 holds #41 to #46 and nothing else.

**Amended 2026-10-31, after #84's design** (`docs/plans/2026-10-31-plays-on-a-post-design.md`). The tag stands, and a
card Act still takes no number. Two things change. "Reactions on the post are already what a play earns from" no longer
holds: a play is reacted to and spun from on its own, through the panel its tag opens, and the settlement already counts
its own votes. And the tag is a button that opens the panel, which carries "Go to post", in place of a link to the post.

## The layers

The card-effect interface is engine (`engine/ui/cards/`); Stick Around's and Whoops!'s effects are Divided World's
cards and live beside their rules (`instances/divided-world/cards/`). An effect's pure parts (Stick Around's gravity and
struggle, the pull's curve; Whoops!'s generator and shading) are plain TypeScript with Node tests; its drawing is a
React component with Vitest tests. The Vending Machine's look is the instance's (`instances/divided-world/ui/`), its
behavior the engine's.

## Tasks

### Task 1. The card-effect interface

- `engine/ui/cards/types.ts`: `CardUi`, which an instance gives per card key: `Effect` (wraps a post's body wherever
  the post appears: a thread, an ORIGIN box, a quote; given the plays on the post, their saved states, whether the
  reader is the author or a caster, and a save function); `ConfigForm` (the card's own settings in the play form);
  `describe` (a plain description for the Vending Machine and the hand); `art`.
- `InstanceUi` gains `cards: CardUi[]`; the post renderer of the web plan's Task 5 wraps a post's body in each played
  card's `Effect`, in play order.
- **Tests first:** a card with no `CardUi` renders the post untouched and its play as a plain Act; effects render in
  the ORIGIN box as in the thread (design, section 10, point 4).

### Task 2. The Vending Machine and the hand

- `engine/ui/vending/`: the drawn machine, sized in percentages of itself and of the screen: slots as buttons
  ("Buy Stick Around, 1.00 orb"), the price display, the tray. Buying spends solid orbs only and is refused in plain
  words otherwise; on success the HUD's orbs drain with the cascade backwards and the card drops into the tray and flies
  to the hand; with reduced motion the card appears in the hand. Empty slots for future cards.
- `instances/divided-world/ui/vending.css` and art: the machine's colors and the placeholder name until the owner
  names it.
- The hand drawer above the HUD (the web plan's hand button): each card held, its count, its description.
- **Tests first:** a purchase with too little solid Aura is refused before and by the server; the count rises by one;
  the cascade runs backwards; the buy buttons' accessible names carry the price.

**Amended 2026-10-30, the owner's answer on #75 (the Vending Machine on a phone).** The owner: "Looks good in
general. "In the machine" I think is not going to scale well, we should consider an `i` button on each card that opens a
modal showing what it is." So the phone's stack stands as #75 draws it, and the "In the machine" list is gone at every
width, since the list grows with every card added: each card's slot carries an info button named for its card ("About
Whoops!") that opens an `Overlay` with that card's rules in plain words (`describe`) and closes the usual way (its
Close, Esc, focus back on the button). Opening it never selects a slot and never spends. A sealed slot has no info
button; the line "4 slots empty: More postcards arrive in later seasons." stays, near the slots. Board 07 draws the list
on a desktop; its manifest leaves that region out, naming this answer. **Tests first:** the button's name; the
overlay's content and the focus's return; that it neither selects nor spends.

### Task 3. Playing a card

- From a post ("Play card" opens the hand, showing only cards whose `canApply` passes there) or by arming a card in the
  drawer (each eligible post on screen shows "Play Whoops! here", a real button; Esc disarms).
- The play form, a modal: the card's `ConfigForm`, the message (up to 200 characters, plain text, counted as typed),
  the price including Whoops!'s surcharge for a long post, Play as the HUD's character. On a post by another of the
  player's own characters it says so plainly ("You play both. It costs the same; your log will say so.").
- The card's Act shows the caster's message.
- **Tests first:** a post already carrying three Whoops! offers no fourth; the surcharge shown equals the server's;
  the message's bound; the armed state's way out (Esc, or play).

**Amended 2026-10-30, the owner's answer on #78.** "Paid for once at the machine makes sense." A card is paid for at
the Vending Machine; the play form's price is what the card's rules add for that post (Whoops!'s long-post fee), and
the form says the card is paid. The glass plan's section 2.1 amendment of this date moves the boards' timeline with it.

**Amended 2026-10-30, the owner's answer on #80 (an armed card on a phone), and the owner's notes on its screenshot.**
On #80: "Agreed with your rec for the question". While a card is armed, the Hand button reads "Armed · Whoops!" and one
press puts the card back; the screen reader's line says to press Armed on a phone and Esc on a wide screen. Of the play
tag, the owner: "the custom note from the card user is wrapping to too many lines, which will scale even worse with a longer message. This should break to its own line in a smaller font. The chip overlays the date line of the post itself, so it will need to be moved. At this screen size ui elements can stand to be a little smaller." So, at every width, the caster's message stands on its own line under the card's name and the
caster, in a smaller size, and wraps there; the tag never covers the post's line (its date and permalink); on the Phone
board's layout the tag and the other glass controls are a step smaller, within the size floors. And the principle the
owner's notes give, which holds for every card: game state and its controls never live in the 2003 chrome, so an effect
can cover a post freely. Whether "Play Whoops! here" in the post's action row (board 01 draws it there) goes against it
is raised in PR #71, not moved without the owner's word.

**Amended 2026-10-30, the owner on #80's shots: the play control.** The owner: "For "Play whoops here" and the associated "splatted" state data - whatever we did for the turn checkboxes to bring back the gamelike theatrics, impeccable or something else, let's do that here. It's starting to look a bit like just "let the text and buttons flow however", less focused and intentional than it could be. And yes we should try to find a way to make the play button itself glass-styled" So "Play Whoops! here" is a glass
control: while a card is armed it stands in the post's glass plate (Task 5's amendment of this date), or as its own
glass tile attached to each post it can land on, and leaves the 2003 action row; "Play card" stays in the row as a plain
2003 link that opens the hand. It keeps its accessible name and its keyboard path. It is drawn first as stories, for
the owner's word, before tests are written against its look.

### Task 4. Stick Around

- `instances/divided-world/cards/stick-around/hold.ts` (pure): which Stick Around pulls (the nearest seen and unescaped,
  by distance from the viewport's middle); the pull's curve (waits 160 ms for the reader's scroll to settle; eases in as
  t^2.4 over 74% of its time; lands with a rubber band overshooting at most 48 px and settling with a damped bounce;
  650 ms plus a fifth of a millisecond per pixel, at most 1300 ms); and the breakout (design, section 10, point 5):
  - the slingshot, for a finger and for the handle: cocked by dragging 0.12 of a screen one way at any speed, held
    while the pointer is down; fired by a release the other way of at least 7.5 screens a second (the owner's 6 to 9)
    over at least 0.08 of a screen, its speed read along the pointer's path over the last 70 ms (always reaching back
    one earlier point), counting only a mostly vertical path; uncocked by drifting back under the distance only below
    1 screen a second; read once more when the pointer lifts;
  - the wheel's flick: a run one way of at least 0.06 of a screen at 1 screen a second within 450 ms, then within
    140 ms a run the other way at 4 screens a second over 0.35 of a screen; a scroll event after a pause counts as at
    most 50 ms of motion;
  - the BREAK FREE button: a second press 0.12 to 0.6 seconds after the first.
  Each number is a constant named in one place, kept in the instance's card so a later tuning session changes one file.
  The prototype is the reference: `docs/research/2026-10-29-screens/proto-q14-stick-around.html`, round 6.
- `instances/divided-world/cards/stick-around/Effect.tsx`: the gold frame and its tag (with the hint after two pulls),
  the stretch while cocked, the handle, the pull, the BREAK FREE button, the certification checkbox in the caster's
  words. Certifying calls `release_effect`, so the release holds on every device; breaking free lasts this visit only;
  the author and the casters are never held; a finger down suppresses the pull; `overscroll-behavior` contains the
  page so a cock at its top is not taken for a pull-to-refresh. Reduced motion: the pull is instant, and still happens;
  the handle's launch jumps.
- **Tests first** (Node, on `hold.ts`, fed pointer samples): the nearest of two seen holds pulls; an escaped one never
  does; a slow cock held for seconds then a fierce release fires; a fierce flick never cocked does not; a release that
  passes back through the cocking distance fires (the bug round 5 had: the drift rule uncocked the fire itself); a slow
  drift back uncocks; an arced release fires where its vertical part alone would not; a sideways swipe does not; a hard
  wheel scroll with no nudge first does not break free; the button frees at 250 ms and not at 30 ms or 900 ms; the
  curve starts slowly, passes the target by at most 48 px and ends exactly on it. (Vitest and e2e on the effect): a
  certified release holds after a reload; a screen reader user reaches the checkbox at the end of the post and the
  button's name says how it works.
- **Tuning is not this task's to finish.** Simulated pointers cannot move like a thumb, so the numbers ship as the
  owner's starting points and a dedicated session tunes them with the owner on phones, a mouse and a wheel.

**Amended 2026-10-30, the breakout redesigned** (screens design, section 10's amendment of this date, which wins over
this task where they differ). In `hold.ts`, the slingshot, the wheel's flick and the handle are gone. In their place:
- `stickAroundTakesOver(post, viewport, scrollSettled)`: the post mostly in view and the reader's scroll settled.
- The bar, a pure step: `barStep(level, input, dt)` fills by scroll distance pushed past an end of the post and drains
  at a constant rate. The fill per screen, the drain per second and "mostly in view" are constants named in one place,
  starting points for the tuning session.
- `releaseSide(lastPush)`: `after` or `before`.

`Effect.tsx` lifts the post into a full-screen glass view through `Overlay` (the `effect` recipe), with the thread dimmed
and inert behind it. The post scrolls inside the view, the caster's checkbox sits at its end, and the bar and the BREAK
FREE button sit in the view's foot. A full bar closes the view and puts the reader just past the post on the side they
pushed toward.

**Tests first** replace the slingshot's:
- A scroll that does not settle never takes over, and a settled one with the post mostly in view does.
- Scrolling inside a long post fills nothing until an end is reached.
- A slow push past an end never fills the bar against the drain, and a sustained fast one does.
- The bar drains to empty when input stops.
- A release pushed down lands after the post, and one pushed up lands before it.
- The BREAK FREE button fills against the same drain, and pressing slowly never frees.
- In e2e, a long post is read to its end in the view, the reader is released past it, and a certified release holds
  after a reload.

The view is drawn by no board: its story goes to the owner on the PR before its tests are written against it. The
ways-out row below becomes "Certify (holds on every device), fill the bar by scrolling (or BREAK FREE) for this visit,
or leave the page."

**Amended 2026-10-30, the owner's answer on the view's story** (#74, PR #71). The stories stand as drawn, with one
change. On the view having no Close and Esc not closing it, the owner: "Yes, this is our rules working. By default the
build session would want to make the modal easily closeable - instead it's treating it according to the game rules.
"Esc" is something people may try though, so it's good to give it something to do: just map it to the "Break Free" so
each Esc press counts the same as if you had the button focused while tapping enter." And of the rest: "No other notes
on anything else, all looks/sounds good." So the view has no Close; each Esc press fills the bar exactly as one BREAK
FREE press does, against the same drain, and a held key's repeats count no more than repeated presses would; the line
the view shows on Esc says that Esc breaks free like the button. The take-over, the release after breaking free and
after certifying, what the view shows, the keys and touch, the focus and the bar's words stand as #74 draws them. The
view's tests and board 08's manifest follow from the approved stories.

### Task 5. Whoops!

- `instances/divided-world/cards/whoops/splat.ts` (pure): the seeded generator (the play's seed to a blob with
  harmonics, splash arms of shrinking blobs and droplets, one path, in units of the layout's width) and the shading by
  the ink's luminance (a white highlight for a dark ink; an edge shadow and a darker underside for a pale one).
- `instances/divided-world/cards/whoops/Effect.tsx`:
  - The fixed layout: the post's body laid out at a reference width (360 px) and scaled as a whole to the screen,
    capped at 1.5 times and centered, the ink free to run into the margins; strokes kept in units of that width, so they
    land on the same words everywhere and survive an edit.
  - Layers: up to three plays, each drawn from its seed in its ink, in play order; the tag takes the top layer's color,
    with black or white text by contrast.
  - Scrubbing: a stroke scrubs the top layer where it starts. A reader's scrubbing is kept in memory only; the
    author's (wash, or a thinner pen in the top layer's ink) is saved to that layer's play, debounced, within the
    engine's bounds.
  - Washed clean at 95% of a layer (a new instance setting, `whoopsClean`): the author's save marks the layer clean for
    everyone, and the log says so; a reader's own reaching it fades it on their screen.
  - Soap suds from the brush; none under reduced motion.
  - The accessible path: a "Hold to scrub" button that sweeps line by line at about 0.55 widths a second, never all at
    once. A line of text under ink is hidden from screen readers as it is from the eye, and read out once it is
    uncovered.
- `instances/divided-world/cards/whoops/ConfigForm.tsx`: a color picker, any color, previewed with its shading.
- **Tests first** (Node, on `splat.ts`): one seed always gives the same path; two seeds give different ones; the
  shading's highlight falls and its shadow rises with luminance. (Vitest and e2e): a stroke saved at 620 px wide
  uncovers the same words at 320 px; a stroke started where the top layer is gone scrubs the one under it; a reader's
  scrubbing is gone after a reload and the author's is not; the sweep at its pace takes about as long as a hand to clear
  a layer; a third play stacks and a fourth is not offered.

**Amended 2026-10-30, the owner's answer on #76 (a splatted post's size on a wide screen).** The owner: "B makes sense
for the splat". The fixed layout's scale is capped at 1×, not 1.5×: a splatted post keeps the board's 12px type in its
360px column on a wide screen, and is scaled down, never up, on a narrow one. Board 01's #42, #43 and "Hold to scrub"
are compared as fully as the 1× layout allows.

**Amended 2026-10-30, the owner's notes on #80's screenshot (Whoops! on a post).** The owner: "there is 2003 verdana with a glass button inline in the same paragraph, doesn't fit the break between the two styles. A description of a postcard effect is pure glass, only the effect itself should be integrated with the game world's copy and styling." And: "whoops spill looks odd when it's not actually filling a whole bordered container (another reason why game state data should not be in the 2003 chrome - we should be able to cover posts up without worrying about hiding controls)" So
the effect's copy and controls ("This post is splatted. Drag across the ink…", Hold to scrub, and the author's Wash and
Write in ink) leave the post's 2003 body for one glass element attached to the post, outside its chrome: a strip under
the post or a part of the tag. The 2003 post keeps only the effect itself, and no 2003 paragraph holds a glass control.
The splat covers the post's whole bordered body, edge to edge, since no control a player needs sits in it any more.
Stick Around's in-thread frame and tag hold to the same principle. Board 01 draws the scrub sentence in the post; its
manifest names that region as differing by this answer.

**Amended 2026-10-30, the owner on Whoops!'s line breaks and the board's width (in Part 3's build session).** With the
2003 board at most 960px wide (the glass plan's section 8 amendment of this date), the owner chose that the fixed
layout's reference width is the post body's width at the board's max, not 360px: at the board's max a splatted post is
laid out as any other post is, and the ink fills its body edge to edge; below it the layout is scaled down as a whole,
never up, so line breaks stay the same everywhere. This replaces the 360px reference (#76's cap at 1× stands: never
scaled up). On a phone a splatted post's text is small until it is scrubbed; the owner chose that knowingly.

**Amended 2026-10-30, the owner on #80's shots: the splat and the effect's plate.** Of the splat, the owner: "The spill still has edges that end before the black post borders, most likely an effort to avoid covering reactions etc - I think such things can just render in front of the splat, or we can slightly redesign the post component so the actual post content (coverable)is always contained within a dedicated block for these purposes (but that probably wouldn't look as nice)." The
owner's first option: the ink runs to the post's black borders, edge to edge, and the reactions row, the action row and
every other control in the post draw in front of it, visible and usable; the ink is not inset to avoid them, and the
post is not split into a coverable block. The words under the ink stay covered. Of the effect's words and controls,
the owner: "For "Play whoops here" and the associated "splatted" state data - whatever we did for the turn checkboxes to bring back the gamelike theatrics, impeccable or something else, let's do that here. It's starting to look a bit like just "let the text and buttons flow however", less focused and intentional than it could be. And yes we should try to find a way to make the play button itself glass-styled" So the strip of the amendment above becomes one deliberate game piece, given the treatment the Turn
modal's How loud row got (#51, restyled to board 06's idiom: skewed, chamfered tiles, a lit and glowing chosen state,
every part composed in one shape): a chamfered glass plate attached to the post, with the effect's name and state as a
readout, and its controls (Hold to scrub, Wash, Write in ink, and the armed card's play control of Task 3's amendment of
this date) as glass tiles in the boards' idiom. impeccable's shape and critique steps are run on it first. Every
control keeps its accessible name and keyboard path, and Hold to scrub's cost is unchanged. Drawn first as stories
(splatted, armed, and both), for the owner's word, before tests are written against its look.

**Amended 2026-10-31, the owner's word on #80's round 2.** The owner: "This is almost right but I think the Play Here
button is inheriting the Verdana". The plate, the tiles and the six choices #80's round 2 lists stand as drawn; the play
tile, standalone and in the plate, is set in the glass's own tile face and size, as the plate's other tiles are, and no
glass control in or under a 2003 post takes the board's face. The look's tests follow from the approved stories.

**Amended 2026-10-31, the owner on the post's footer bar.** The owner: "I think we will likely need to put Quote, Spin,
Edit, etc on a solid-color bar of their own, a footer bar similar to the header bar for the date and post number.
There's no way the current #000 text against that magenta ink passes contrast, and that ink color is totally variable
too." So every post, splatted or not, carries an opaque footer bar in the 2003 chrome, drawn like its header bar (the
same ground, rule and type), holding its action row (Quote, Spin thread, Edit, History, Play card); no 2003 text lies on ink. The owner then:
"Note: reactions are fine as is. They already each have an individual solid background+border", so the reactions
row stays as it is, over the ink, each chip read against its own ground. And then: "why do we have "Play card" in this row at all
anymore? It's a game act so it should be Glass, right? I believe the flow is Hand -> Select a card -> glass-styled
button appears on each applicable post?" So "Play card" leaves the post's action row everywhere (Task 3's "from a post"
path is gone): the footer bar holds only the board's own actions, Quote, Spin thread, Edit and History, and a card is
played only from the hand: the HUD's Hand, arm a card, then its glass "Play … here" tile on a post it can land on.
Boards 01 and 02 draw "Play card" in the row; their manifests say it differs by this answer. As built, the effect's glass plate
attaches under the footer bar, and a post's spin form and History open under the bar, which holds only the row. The splat fills the body between the
header bar and the footer bar, edge to edge; both bars draw over it and are never inked, so nothing's contrast depends
on an ink a player picks, and a splat never moves the layout. Boards 01 and 02 draw the row without a bar: that region
differs by this answer and their manifests say so. **Tests first:** at 390 and 1440 every footer control's text read
against the bar's own ground with the post splatted in the lightest and the darkest ink a player can pick; the bar's
ground opaque; a poison, the bar made transparent, fails.

### Task 6. The log's card lines, and the audit

- The log names, plainly: a card bought, a card played and on whose post (one of the player's own characters' posts
  said so), a play on the player's post, and a layer washed clean. A Stick Around certified is not logged: it is
  reading, which the log does not track.
- impeccable's `detect` and `audit` over the Vending Machine, the play form and both effects; fixes inside the brief;
  the rest under `Follow-ups`.
- **Tests first:** each line's words; an own-character play says so.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A reader held by Stick Around | Certify (holds on every device), or break free for this visit: the slingshot, the handle, the wheel's flick or the BREAK FREE button |
| A post under Whoops! | Any reader scrubs on their own screen; the author washes each layer for everyone |
| An armed card | Esc, or play it |
| The play form | Cancel, Esc, or play |
| A purchase refused | The next settlement fills the wallet |

## What could vary with a private fact, and how it does not

- Exempting the author and casters from a hold, and the outline of one's own play, are decided on their own screens
  from what they already know; nothing is sent.
- A purchase broadcasts nothing; a play is a public Act like any other, whoever owns the target.
- A release is the reader's own row.

## Review focus

- A page of many splatted posts on a phone: canvas memory and redraw cost.
- The author's saves at speed: the debounce, the bound, and a save racing a fourth play.
- The pull fighting a screen reader's own scrolling, and a keyboard user's PageDown.
- The slingshot on real phones: event spacing while the page scrolls, a release that ends at the page's edge, and iOS's
  own gestures at the screen's edges.
- Whether a theme can hide a splat or a hold for everyone who uses it.
- The tuning numbers on a real phone, against the owner's slider numbers.
- The glass over a post: whether Stick Around's frame or a card's controls, drawn over the board, can be hidden or
  thinned by a board theme.
