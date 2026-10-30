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

### Task 3. Playing a card

- From a post ("Play card" opens the hand, showing only cards whose `canApply` passes there) or by arming a card in the
  drawer (each eligible post on screen shows "Play Whoops! here", a real button; Esc disarms).
- The play form, a modal: the card's `ConfigForm`, the message (up to 200 characters, plain text, counted as typed),
  the price including Whoops!'s surcharge for a long post, Play as the HUD's character. On a post by another of the
  player's own characters it says so plainly ("You play both. It costs the same; your log will say so.").
- The card's Act shows the caster's message.
- **Tests first:** a post already carrying three Whoops! offers no fourth; the surcharge shown equals the server's;
  the message's bound; the armed state's way out (Esc, or play).

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
