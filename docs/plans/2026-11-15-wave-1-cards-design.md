Record, written 2026-11-15.

# Wave 1 of the Base Set: Rope Break, Hot Box and Steel Chair: design

A design session with the owner on the three cards the roadmap (`docs/plans/2026-11-14-base-set-design.md`, section 2)
puts in Wave 1. The pool's gaps and each card's origin are in
[keithpickering/dividedworld#683](https://github.com/keithpickering/dividedworld/issues/683), which this design does not
copy. It decides each card's rules, numbers, words, look and ways out, and it adds one thing the roadmap did not
foresee: a small plan that builds before the cards (section 1).

Its plans, one per build:

| Plan | Builds | May start |
|---|---|---|
| `docs/plans/2026-11-15-wave-1-prep-plan.md` | the boards' fixed machine, the last two shared test lists, the engine's words for a trap that matches | after the stories-by-key build (PR #707) merges |
| `docs/plans/2026-11-15-rope-break-plan.md` | Rope Break | after the prep plan merges |
| `docs/plans/2026-11-15-hot-box-plan.md` | Hot Box | after the prep plan merges, beside Rope Break |
| `docs/plans/2026-11-15-steel-chair-plan.md` | Steel Chair | after Rope Break merges (they share a slot of the sorted lists) |

## 0. What the owner decided, and what was weighed

**Rope Break**

1. **Catch and keep.** The engine's catch as it stands: the caught cast does nothing and its card goes to the setter's
   hand. Weighed: catch and discard, and catch and hand back, each a new spring outcome and so the Plays plan's, which
   would move Rope Break to Wave 3.
2. **1.00 at the machine.** Weighed: 0.50 (a spring is then a profit, which taxes every Salty common), 1.50 (the
   uncommon Reversals' price, odd on a common).
3. **The Mod Bots may set it**, as the engine offers it: the staff pool takes commons, and Rope Break is the first
   common Reversal. Weighed: players only, which needs a per-card way out of the pool the engine does not have.
4. **Its picture is rendered again in Sweet's colors.** The art PR #688 added is pink and magenta, Salty's family.
   Weighed: keeping the pink picture in a cyan frame; the owner redoing it later.

**Hot Box**

5. **The smoke is an obstacle, not texture.** Words under it cannot be read until the reader clears them. Weighed: a
   thin haze read through (a cosmetic, and a weak way to outdraw a post); thick smoke that also parts as the page
   scrolls (a mild obstacle).
6. **Three days, thinning out.** Weighed: three days at full strength; for as long as the post.
7. **A flat 1.00**, nothing more to play. Weighed: Whoops!'s surcharge for long posts; a flat 0.50.
8. **The accessible path is a held control, "Wave the smoke"**: while it is held a clearing sweeps down the post at
   reading pace, and letting go lets the smoke back. Weighed: one press that clears the post for ten seconds (cheaper
   than the pointer's path on a long post, and Below the Fold's press again); arrow keys that steer the clearing
   (faithful, slow, awkward on a switch).
9. **The card build makes its art folder** from the research render as it is, and draws the mark; the owner approves
   the mark in review. Weighed: an art PR of the owner's first; rendering the scene again.

**Steel Chair**

10. **The chair is thrown, dents the post, and falls.** The owner's design, replacing the issue's "a chair wedged in a
    corner": "the post starts out normal (no reflow), the chair flies from a random direction, dents a random point
    on the post with physical distortion (like an aluminum sign being dented), then just bounces off the post and
    falls to the 'ground' (bottom of the post content container) with realistic gravity. The random position makes
    it a slightly different effect every time it gets scrolled into view, and the chair falling means the text
    doesn't need to get out of the way." Weighed: the chair wedged in the words' corner with the words wrapped
    around it; denting the row's own border, which is engine work.
11. **The chair is flat pieces in CSS 3D**, simulated on each throw, with a working hinge. The owner, on the mock:
    "this is the right direction for sure, the CSS planes work fine." Weighed: frames rendered in Blender and played
    on a 2D path (the same tumble every throw); WebGL with the real model (a 3D library, and a page allows about 16
    live WebGL canvases, so several chairs in a thread would need one shared canvas, which is engine work).
12. **It comes to rest by its own physics.** The owner: "the chair is sort of snapping back to a standard 2D
    orientation once it's on the floor, would be nice if we could make it settle on the floor in a way that completes
    the movement realistically." The plan models the folded chair as a rigid box with corner contacts and never eases
    it to a set pose.
13. **Up to three stack**, each its own dent and its own chair, and the chairs pile up. Weighed: one at a time; five.
14. **A clang, for players with game sounds on**, the first time a post's chairs play on a page. The owner supplied
    the sounds (ElevenLabs Sound Effects, as the laugh track's): one impact, to be cut to its first hit, and four
    sounds of a chair settling. Weighed: silence; a clang on every replay.
15. **A flat 1.00.** Weighed: 0.50 and 0.20, since it hides nothing.

**All three**

16. **The words** on each face and sheet are section 2's, as the owner approved them.
17. **A fourth plan builds first** (section 1). Weighed: building Wave 1 one card at a time with the boards measured
    again by hand each time; a separate design session for the fix.
18. **The engine's words for a trap that matches go in that plan.** Weighed: an engine plan of their own; leaving the
    untrue sentence until the Plays plan.

## 1. What the seams left, and the prep plan

The seams (roadmap section 4) left two sorted lists, and the roadmap's waves assume a card build touches nothing else
that is shared. Reading the code for these plans found three more places, and one gap in the engine's words:

1. **One line of `instances/divided-world/cards/cards.test.ts`** lists every card's key, flavor and price, and the same
   file asserts `cards.length` is 36. Two builds each edit that line.
2. **`PRICES` in `instances/divided-world/machine.test.ts`** lists every card's price again, unsorted, and asserts its
   length is the pool's.
3. **The Vending Machine's boards.** Five e2e board manifests (`e2e/boards/07-vending.ts`,
   `2026-11-05-backfill/33-settings-account.ts` and `34-vending-info.ts`, `2026-11-07-booster-packs/01-machine.ts` and
   `05-admin.ts`) are matched against the instance's real machine, which is computed from the pool. A new common Move
   moves every slot named after it; any new card adds a row to the admin page. THIS's build measured those shifts
   again by hand, and the manifests' headers keep a running history of them.
4. **The engine says a set card "names" its card.** The set form ("Waits for the card it names to be cast on this
   post, and takes it"), the setter's log line ("It waits for the card it names") and the sprang alert ("A cast of
   the card it named set it off") were written when every cast trap named one. The engine has had a trap that
   matches by flavor and rarity since `0148_card_types.sql`, tested in SQL, the seed, the rules and the fake, and no
   card used it. Rope Break is the first, and for it those sentences are untrue: the log may not be ("The fiction may
   lie; the log never does"), and a card build may not edit the engine.

So `docs/plans/2026-11-15-wave-1-prep-plan.md` builds first:

- **The boards draw a fixed machine.** The boards' fixture holds the list of card keys its machine shows, in order,
  and builds its fake from that list; a card added to the pool later is not on the boards' machine, so no manifest
  moves. The list is today's machine, so the manifests need no change now either. The boards go on showing the
  machine's design; the real machine's rule is held by `machine.test.ts`, which computes it from the pool.
- **The two test lists become one, a card to a line, sorted by key**, so a new card's line goes to its slot as in the
  two lists the seams left. The count of 36 goes: the test it is in already holds that the odds cover every card.
- **A trap with a match is said from its match**: "Waits for a Salty card, up to common, to be cast on this post,
  and takes it." The engine names no flavor and no card; it reads the trap's own `match`.

Weighed for the boards: hiding new slots with the fake's `seed.slot` (the admin page lists hidden slots, so its rows
would still move); drawing the boards from the engine's test instance (they are matched against Divided World's cards
and words, so every manifest would be rewritten).

## 2. The cards

Numbers in the instance's units: prices in orbs, as the machine shows them.

### 2.1 Rope Break

Sweet, common, a Reversal (`play: 'set'`), 1.00. Key `rope-break`.

- **What it does.** Set face down on one of the player's own posts. The first Salty common card cast on that post is
  caught: it lands as caught and does nothing, the setter takes it into their hand, and the caster's play is spent
  (card and play price, as any caught cast). Any other card passes over it. It springs once.
- **Rules.** `trap: { trigger: { on: 'cast' }, match: { flavors: ['salty'], upTo: 'common' } }`, no configuration.
  Nothing else: the engine's `decideSet`, `place_set`, `spring_traps` and the fake already carry a match.
- **What it catches** today: Whoops! and Below the Fold; with this wave, Hot Box and Steel Chair; later, Ratio.
- **What follows from the engine as it stands**, told to the owner and accepted:
  - A ward on the post is asked first, so a warded cast never meets the back.
  - A Move that springs on a quote and lands on the quoting post is not a cast, and is not caught.
  - A cast by another mask of the setter's own player is caught like anyone's, and the card comes back to the same
    account with the play price spent. Nothing differs with who owns the caster.
  - A Mod Bot's cast is caught too, and a player setter keeps the card. A Mod Bot that set the Rope Break keeps
    nothing: the caught card is spent.
- **Words.** Face: "Reach the ropes." Summary: "Set face down on your post. Catches the first Salty common cast
  there, and takes it into your hand." Status: "Set, face down to everyone else", the same words as every Reversal, so
  one back cannot be told from another.
- **Way out.** The back ends by itself after the instance's set time (7 days), springs, or is taken back by its
  setter, as every set card. A caught cast is over when it lands and holds nobody.
- **The masks.** A card back names no card. The spring makes the Rope Break and its setter's character public, as
  every spring does. Nothing new is sent, and nothing is computed from who owns what.
- **Art.** The scene's backdrop, mat and wristband move to Sweet's cyan family and the picture is rendered again;
  the mark's band follows. The face's color is Sweet's (`#2ee6ff`, ink `#03141a`).

### 2.2 Hot Box

Salty, common, a Move on a post, 1.00, nothing more to play. Key `hot-box`. Carried over from Minus World.

- **What it does.** The post's words fill with smoke in a color the caster picks. Under the smoke the words cannot be
  read. A reader clears a patch by pointing at it, and the smoke rolls back in behind them. It lasts 3 days and thins
  as it runs down, then it is gone by itself. One fits on a post at a time.
- **Rules.** `lasts: { unit: 'day', count: 3 }`, a stack of one, configuration `{ color }` checked by the engine's
  `color()` as Whoops!'s ink is. It can be set face down like any Move. A Mod Bot's play takes one of five colors the
  card lists (`staffConfigs`); a persona is given no option, so no list of cards with options grows.
- **How it is the same for everyone.** The smoke is drawn on each reader's own screen from the play's color and its
  two times. Nothing is saved, sent or counted when a reader clears it, and the author and the caster are smoked like
  anyone.
- **Reading through it.**
  - *A mouse or pen:* a clearing follows the pointer, and closes a couple of seconds after the pointer moves on.
  - *A touch screen:* the clearing sits where the reader last touched, holds a few seconds, then closes. Reading is
    tapping down the post; nothing takes the scroll.
  - *Keyboard, switch and screen reader:* a real button on the post, "Wave the smoke", also in the Lens. While it is
    held (Space, Enter or a press), a clearing sweeps down the post at the pace Whoops!'s sweep uses; the words it has
    passed are readable and are read out line by line. Letting go lets the smoke back. That costs about what the
    pointer's path costs: time in proportion to the post's length, and attention the whole way ("An accessible path
    costs what the obstacle costs").
  - While smoke covers the words they are hidden from a screen reader as from the eye, the way Whoops! hides inked
    lines.
- **Reduced motion.** The smoke does not drift and a clearing opens and closes with no easing. It is as thick, the
  clearing is as large, and the sweep takes as long.
- **Words.** Face: "Smoke out a post." Summary: "Fills a post with smoke in your color. Readers wave it away to read,
  and it rolls back in." Status: "Smoke on this post". Hint: "Point at the words to part the smoke." Control: "Wave
  the smoke".
- **Ways out.** For a reader: the pointer, a touch or the held control, on the post itself, each visit. For the post:
  the play's 3 days, written on the Lens ("Ends Nov 18, 9:14 PM"), or an admin ending the play.
- **The masks.** Nothing is added to any response, payload or event. The effect reads the play's public payload only.
- **Art.** No folder exists. The build makes `instances/divided-world/ui/cards/hot-box/` from
  `docs/research/2026-11-11-card-renders/hot-box.png` and `hotbox.py`, and draws a mark.

### 2.3 Steel Chair

Salty, common, a Move on a post, 1.00, nothing more to play. Key `steel-chair`.

- **What it does.** A folding chair flies in from a random side, hits the post at a random point and leaves a dent
  there: the words bend into it like print on dented sheet metal. The chair snaps shut, bounces off, falls, and comes
  to rest on a strip of floor under the words. Each time the post scrolls back into view it happens again, somewhere
  else. It lasts 3 days. Up to three stack on a post, each with its own dent, and the chairs pile up on the floor.
- **It hides nothing.** The words stay where they are, readable and selectable; a dent bends a few of them. The floor
  strip is added under the words, so a resting chair covers none. It is not an obstacle and owes no accessible path;
  it is loud so that it can outdraw the post it lands on, which is the Heel's win.
- **Rules.** `lasts: { unit: 'day', count: 3 }`, `stack: 3`, no configuration. Where each throw lands is chosen on the
  reader's screen each time, so nothing is seeded and no two readers need see the same throw.
- **The chair.** A dozen flat pieces (seat, backrest, two tube frames) in CSS 3D, shaded from the angle each faces.
  The flight and the hinge are simulated on each throw; after the hit the folded chair is a rigid box whose corners
  meet the floor, the walls and the chairs already lying there, so it tips, slides and settles on whichever face the
  throw leaves it on.
- **The dent.** An SVG displacement filter over the words, with sheet-metal shading on top. Where the browser cannot
  run the filter, the shading alone is drawn.
- **Sound.** With game sounds on: a clang at the hit and one of four clatters when the chair first meets the floor,
  the first time the post's chairs play on a page and never on a replay. Each is captioned, as every game sound is.
- **Reduced motion, and a moment.** Nothing flies. The dents are drawn and each chair lies at rest where a throw
  would have left it. No sound.
- **Words.** Face: "Dent a post." Summary: "Hits a post with a folding chair and leaves a dent." Status: "Dented by
  a chair" (two: "Dented by 2 chairs"). Hint: "Someone took a chair to this post. The Lens says who."
- **The Lens** carries two controls: "Throw again", which replays the throw for that reader, and the "Game sounds"
  switch Laugh Track has. "Throw again" is this design's own addition, from the mock's button; the owner can strike
  it in review.
- **Way out.** Each chair is gone 3 days after it landed, or when an admin ends its play. It holds nobody.
- **The masks.** Nothing is added to any response. Every random choice is the reader's own screen's.

## 3. The layers

- The prep plan's first two tasks are fixtures and tests. Its third is engine (`engine/rules/cards.ts`,
  `engine/ui/cards/land.ts`, `engine/ui/log/lines.ts`, `engine/ui/alerts/words.ts`) and names no instance, card or
  flavor: it reads `CardRules.trap.match`.
- Each card build is Divided World's alone, carried in through `CardRules` and `CardUi`. It touches no engine file and
  adds no migration: a card reaches the database through the instance's seed
  (`supabase/functions/_shared/seed.ts`, `instanceSeed`).

## 4. A busy instance

- Hot Box and Steel Chair draw only while their post is in view, and stop when it leaves. A thread page of 20 posts
  with a card on each runs the ones on screen.
- Hot Box keeps one canvas per smoked post, at most twice the screen's density. Steel Chair simulates at most three
  bodies per post, and only until they are at rest.
- Neither reads or writes anything while it plays. Their cost grows with the posts on one reader's screen, never
  with players, threads or Acts.

## 5. Open

- **Steel Chair in Safari.** The plan draws the dent's shading without the displacement where the filter cannot be
  trusted (WebKit's support for a filter's `feImage` on HTML content is uneven). Whether Safari can be given the real
  dent is left to a later look in that browser.
- **A baked steel texture on the chair's pieces** was offered and not asked for; the pieces are flat-shaded. The
  owner judges the look in the build's review.
- **Rope Break and the Mod Bots.** A Mod Bot that sets Reversals changes how safe a staff post is to ink. It is
  allowed as the engine offers it; the season review looks at how often it happens.
- **The owner's five raw sound files** are also untracked in the owner's own checkout
  (`instances/divided-world/ui/sounds/`, under their generated names). This PR carries copies under
  `docs/research/2026-11-15-steel-chair/sounds/`; the untracked ones are the owner's to delete.
- **The play picker's order** (#704) and **the boards' older drift notes** (#705, third item) are not this design's.
