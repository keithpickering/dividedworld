# The glass, built to its boards: plan

Record, written 2026-10-30. The plan that takes the repository as it stands (an engine of `engine/bbcode/` and
`engine/rules/`, Divided World's rules in `instances/divided-world/`, migrations up to `0029_reveal_rolls_over.sql`,
and no web app) to the screens the boards in `docs/research/2026-10-29-two-worlds/` show. The owner asked for it after
choosing the pause-menu boards: "Let's make sure this direction is fully dialed in as build-ready plans that will turn
what we have now into what is seen in the mockups."

It is written after an audit of every board: each one's size, type, colors, shapes, smoke and accessibility tree,
held against the two-worlds design (`docs/plans/2026-10-29-two-worlds-design.md`), the screens' two plans and the
rules in `instances/divided-world/`. The audit found that the plans as amended say what to build but not how a build
is shown to match its boards, that the boards' smoke is not one recipe but nine, and that the boards' sample data
breaks five decided rules. This plan settles each of those, and says which choices it made where nobody had decided
(section 9), so the owner can overturn any of them in review.

**Amended 2026-10-30, after PR #24 merged.** The order this plan is built in, and every place main differs from
what it assumed, are in `docs/plans/2026-10-30-glass-build-plan.md`, which wins where they differ: the e2e suite is the
root `e2e/` (so `web/e2e/board-match.ts` is `e2e/board-match.ts`, and so on), the fake backend is
`engine/ui/data/fake.ts`, the build is the existing `--mode e2e`, the bundle assertion is the guard
`tools/check-web-bundle.mjs`, and section 10's task map is replaced by that plan's parts.

## 1. How this plan relates to the others

- It adds no task of its own. Each section below rides with a named task of
  `docs/plans/2026-10-29-screens-web-plan.md` (web Tasks 0 to 12) or `docs/plans/2026-10-29-screens-cards-plan.md`
  (cards Tasks 1 to 6), and that task is not done until its part of this plan is. Section 10 is the list.
- Where this plan and the glass amendments of those two plans (both dated 2026-10-29 and 2026-10-30) say different
  things, this plan wins. Everything else in those plans stands: every word their tasks give a screen, their tests and
  their poisons.
- `docs/plans/2026-10-29-two-worlds-plan.md` (migration `0030_glass_preferences.sql`) is unchanged, and is still merged
  before web Task 11.
- The order of the build is the web plan's, then the cards plan's. A build session reads this plan beside the task it
  is carrying out, and its spec reviewer holds the task to both.

## 2. What "matches its board" means: the board match

A board is a fixed-size HTML file. A build matches it when the same screen, in the same state, at the same size,
has the same parts in the same places in the same type. That is checked by a machine, not by eye, because the boards
carry about four hundred measured values between them and nobody holds that many in view.

### 2.1 The fixture

`web/src/data/fixtures/boards.ts` (web Task 2) seeds the fake backend (`web/src/data/fake.ts`) with one coherent
season: the accounts, characters, threads, posts, Acts, reactions, ledger lines, wallets, hands and pending Turn the
boards show, and a named moment for each board. It is the boards' sample data made consistent with the rules
(section 3 lists every place it departs from a board, and why).

- **Three accounts.** *The player* owns Pipewrench, Mrs. Hooligan and Spritey, the three the boards' swap select,
  roster and log tabs name. *The rival* owns Gloomba. *The reader* owns one character, Thwompson, which no board
  shows; it exists so the Hold board has a reader Stick Around can hold (section 3).
- **One thread,** "who keeps splatting my posts" on General, page 3 holding posts #41 to #46: #41 Spritey 9:14 pm
  (splatted by Mrs. Hooligan, "you dropped your ink"), #42 Mrs. Hooligan 9:20 pm, #43 Pipewrench 9:31 pm, #44 Spritey
  9:40 pm (the changelog, held by Gloomba's Stick Around, "required reading", with the release sentence "I have read
  every word of Spritey's changelog and I feel changed."), #45 Gloomba, #46 Gloomba (812 characters).
- **Ranks** from `instances/divided-world/index.ts`: Spritey Main Eventer (4 pips), Mrs. Hooligan Midcarder (3),
  Pipewrench Enhancement Talent (2) until the Oct 30 settlement and Midcarder (3) after it.
- **Pipewrench's timeline, Oct 29 to 30 (UTC),** the Log board's set, which is the coherent one (design, Open):

  | When | Act | Wallet after | Hand after |
  |---|---|---|---|
  | before | (earlier play) | 5.62 | 2 |
  | Oct 29 20:10 | Bought Whoops! from slot A2, −1.00 (Act 2170) | 4.62 | 3 |
  | Oct 29 21:52 | Played Whoops! on Gloomba's #46 in magenta ink, "you dropped your ink", card 1.00 and long post 0.25 (Act 2190) | 3.37 | 2 |
  | Oct 29 22:04 | Four reactions on #43 | 3.37 | 2 |
  | Oct 30 00:35 | Chose a Turn to Face, announced with its old class (pending) | 3.37 | 2 |
  | Oct 30 08:17 | Settlement, scored as a Heel: drew heat +0.20, stole thunder +0.20 (the Whoops! on #46), polite shrug −0.05 (Act 2214) | 3.72 | 2 |
  | Oct 30 08:17 | Turn took effect (Act 2215); rank up, standing 2.95 to 3.30 (Act 2216) | 3.72 | 2 |

- **The moments,** each a clock time, an account and a route, named in the fixture and read by the board match:

  | Board | Moment | Account | Shown |
  |---|---|---|---|
  | 01 main, 02 phone | Oct 29 21:47 | the player | page 3 of the thread, the HUD on Pipewrench, the second Whoops! armed (02: the hand open) |
  | 03 react | Oct 29 21:30 | the rival | the picker open on Mrs. Hooligan's #42, the rival's own Tea outlined |
  | 04 orbs | none | none | a story of the orb states |
  | 05 cards | Oct 29 21:51 | the player | the hand sheet (a story); the play form open on Gloomba's #46 (the app) |
  | 06 turn | Oct 30 00:35 | the player | My characters, the Turn modal on Pipewrench, Face and Announced with old class chosen |
  | 07 vending | Oct 29 20:09 | the player | the Vending Machine, Whoops! in A2 selected, before the buy |
  | 08 hold | Oct 29 21:41 | the reader | #44 held (a story of the thread view and the effect, without the HUD) |
  | 09 settlement | Oct 30 08:20 | the player | the first load after the settlement, Pipewrench's tab |
  | 10 roster | Oct 30 08:30 | the player | My characters, Pipewrench selected |
  | 11 settings | Oct 30 08:30 | the player | Settings, Accessibility |
  | 12 log | Oct 30 08:30 | the player | My log, Pipewrench's tab |

  **Amended 2026-10-30, the owner's answer on #78 (what playing a card costs).** The owner: "Paid for once at the
  machine makes sense." A card's price is charged once, when it is bought; playing it costs only what its own rules add.
  So the 21:52 play of Whoops! on Gloomba's #46 costs the long post's 0.25 alone, and the wallet after it is 4.37, not
  3.37; every later figure in the timeline moves by 1.00 with it (the settlement's 4.37 → 4.72). Board 05's cost lines
  are read as the build draws them: "Card: paid", the long post 0.25, "To pay now 0.25", "Wallet after playing: 4.37
  of 6.00".

  **Amended 2026-10-30, in the glass build's Task 2.2.** 06 turn is at Oct 30 00:34, a minute before the Turn,
  as 05 cards and 07 vending sit a minute before their acts: the board shows the Turn being chosen, so the
  build opens Turn Pipewrench and chooses Face, rather than reopening a Turn already made.

- The fake backend takes the moment from `?fixture=boards&moment=<name>` in the e2e build only (`vite build --mode
  fake`). The Supabase adapter never reads either parameter, and `fake.ts` and the fixture are absent from the
  production bundle: web Task 0's build asserts that the production bundle contains neither file's marker string
  (`KAYFA_FAKE_BACKEND`), driven red once by importing the fake adapter from `web/src/main.tsx`.

### 2.2 Where each board is compared

- **The app,** under the fake backend at the board's moment: 01, 02, the play form of 05, 06, 07, 09, 10, 11 and 12.
- **A story,** where a board is a reference sheet or shows one component over a post: 03 (the picker over the post),
  04 (the orb states), the hand sheet of 05 (the cards in each state, and "On the board, the same card reads like
  this"), 08 (the held post with its effect). Each is a Storybook story in a `*.board.stories.tsx` file beside its
  component, rendered from the fixture at the board's size, and named for its board (`Boards/03 React`).

### 2.3 The comparator, and its self-test

`web/e2e/board-match.ts` (web Task 1, so every later task can use it) is a pure function:
`compareBoard(board: Snapshot, build: Snapshot, manifest: BoardManifest): Mismatch[]`. A snapshot is a list of the
manifest's landmarks as each side rendered them: found or not, its box, and the computed style of its first
text-bearing element (the first family named in `font-family`, `font-size`, `font-weight`, `color`,
`letter-spacing`). A manifest, one per board in `web/e2e/boards/<NN>-<name>.ts`, lists landmarks by role and
accessible name, as section 7 gives them, each with:

- `buildName` where the build's accessible name differs from the board's by a decision (section 3 and 7 name each);
- `box`: `full` (the default: x and y within 8px, width and height within 4px), `position` (x and y only, for a
  landmark whose text the fixture changes), `height` (y and height only, for a row of variable count) or `none`;
- `type: false` for a landmark whose type is not the glass's to compare (an image);
- `buildSize` where the build's font size differs from the board's by a decision (amended 2026-10-30, the owner's
  answer on #54: board 03's quadrant labels); the rest of the type is still the board's.

The match is on role and name, with names compared case-insensitively and with `aria-hidden` glyphs left out: the
boards write their capitals into the text, and the build writes the instance's copy in sentence case and sets
capitals with `text-transform`, so a screen reader reads words and not letters (section 9). Font size, weight and
family must be equal; color must be equal as an opaque sRGB value; letter-spacing within 0.5px.

It never compares the smoke's pixels (the smoke is procedural and drifts; its legibility is the two guards' work),
numbers (dates, clocks, amounts and counts are the fixture's), the 2003 board's post bodies, or a landmark the
manifest leaves out.

**Self-test,** `web/e2e/board-match.test.ts`, run by `npm run test:ui` (Vitest's include takes `web/**/*.test.ts`
and leaves `web/e2e/**/*.spec.ts` to Playwright), driven red before the comparator is written. **Poisons:**

- the menu bar 72px tall where the board's is 84px: a mismatch naming the landmark, the field and both values;
- a menu tab at 17px where the board's is 21px;
- the HUD with no Menu button: a mismatch saying the landmark is missing from the build;
- a body line in Arial where the board's is Barlow Condensed;
- a body line in `#d9d3f0` where the board's is `#e4def7`;
- a box 9px off the board's passes nothing, and 8px off passes (the tolerance's own edge, both ways);
- a `buildName` that matches nothing in the build: a mismatch, never a silent skip.

**Amended 2026-10-30, after Task 2.1 (the React picker).** The comparator gains a fifth box mode and one landmark
option. The `size` mode compares a box's width and height only. A landmark's `origin` names another landmark, earlier
in the manifest, and the landmark's x and y are then compared as offsets from that one's top-left corner on each side;
its width and height are compared as before. A missing origin is a mismatch, never a silent pass. Board 03 needs both.
The post under its picker is the board's drawing on one side and the app's own thread article on the other, so the
reactions row the picker opens by stands elsewhere, and the picker lands about 102px left and 36px up of the board's,
while every part inside it sits at the board's offsets. Board 03 therefore compares the picker by `size` and each of its
parts from the picker's corner, in full. Where the picker stands against its post is held by `e2e/reactions.spec.ts`
instead. Both were driven red in `e2e/board-match.test.ts` first: a whole popover moved with its parts is clean, a part
9px off within it fails and 8px passes, `size` never compares the place, and a missing or unknown origin is a mismatch.

**Amended 2026-10-30, in the glass build's Part 3 (the cards).** The comparator gains four things, each driven red in
`e2e/board-match.test.ts` or `e2e/board-snapshot.spec.ts` first. A landmark's `buildRole` names its role in the build
where it differs by a decision (as `buildName` names its name). A board's manifest may name further build sides
(`also`), each its own build (the app at a moment, or a story) compared against the same board, so board 05 holds its
hand sheet (a story) and its play form (the app); a mismatch names its side, and each side's report is its own folder.
A press that reaches a state may pick the last of several matches (`nth: -1`) and may type into a field (`fill`).

### 2.4 The e2e spec

`web/e2e/boards.spec.ts`, in `npm run test:e2e` and `.github/workflows/web.yml` (web Task 0):

- for each board: open the board file and the build (the app at its moment, or its story) in two pages at the board's
  size, device scale 1, reduced motion, each waiting for `document.fonts.ready`;
- both pages load the same faces: the board's Google Fonts requests are routed (`page.route`) to the instance's own
  files in `instances/divided-world/ui/fonts/`, so the comparison runs offline and a fallback face can neither pass
  nor fail it;
- snapshot both by the manifest, run `compareBoard`, and fail on any mismatch, printing each;
- write a report to `web/e2e/report/boards/`: each board and its build side by side, the manifest's boxes outlined on
  both, the mismatches listed. CI uploads it as an artifact, so a reviewer looks at the two pictures rather than at
  the numbers.

A board's entry is added by the task that builds its screen (section 10), and that task is not done until it is
green. The spec's list of boards is the folder's list: a board file in `docs/research/2026-10-29-two-worlds/` with no
manifest fails the spec by name, so a board cannot be left out by forgetting it.

## 3. The boards' sample data against the rules, and how each resolves

The design wins on what is decided and the board on how it looks. Five things the boards show are decided otherwise,
and the fixture follows the decision.

1. **No React on one's own characters' posts** (web Task 6). The Main board's #41 and #42 carry React and "1 of 3
   left", and both are the player's own characters' posts. The build shows neither there. The React board is seen by
   the rival, whose Tea on Mrs. Hooligan's #42 is the outlined one, so its picker, its heading "React to Mrs.
   Hooligan's post" and "2 of 3 left" are exactly the board's. #42's tallies at the Main moment carry that Tea too, so
   Main shows a fourth chip (☕ 1) the board left out.
2. **The author is never held** (cards Task 4), and **a Stick Around is not logged** (cards Task 6: it is reading,
   which the log does not track). The Hold board's reader is held on Spritey's #44, and the Log board's Pipewrench tab
   says "Stick Around held you" and "Released" on it; the player owns Spritey. The Hold story is seen by the reader,
   who owns none of the boards' characters, and Pipewrench's log has neither line, so the Log board's eight rows are
   six in the build (its manifest compares the table's header and first row, and the table's box by `height`).
3. **"Your Whoops!"** in the settlement's "Stole thunder" line is Pipewrench's own play. The Settlement board puts it
   on Spritey's #41, which Mrs. Hooligan splatted; the fixture's is the 21:52 play on Gloomba's #46, as the log says.
   The play form (Cards board) is therefore open on Gloomba's #46, 812 characters, not Spritey's #41.
4. **The hand.** The Log board says the 20:10 purchase took the hand from 3 to 4, but the Main board, after it, shows
   three cards. The purchase takes the hand from 2 to 3, and the Vending board's "3 → 4" and "4.62 → 3.62" read "2 →
   3" and "5.62 → 4.62" at its moment, the minute before the buy.
5. **Accessible names the plans already worded.** The orbs: web Task 3's "Wallet 4.62 of 6 orbs, 0.30 pending until
   the next settlement (estimate)", with no "about" (the clues amendment), in place of the boards' "Aura: 4.62 of 6.00
   settled, about 0.30 more estimated". Whoops!'s keyboard path: cards Task 5's "Hold to scrub", in place of the
   Main board's "Scrub with the keyboard". "Play Whoops! here" is a button (cards Task 3), where the Main board draws a
   link. The Turn board's standing reads 2.95, not 2.40 (design, Open).

And three that the boards drew before a later decision, where the decision stands: the Main board's banner lists
Search (not built; the banner holds Index and the instance's boards from `instances/divided-world/index.ts`); the
Settings board's menu bar has no Rankings (every glass page has the same six tabs, web Task 3); the Settings board's
Notifications, Privacy and Export my data sections and its Read-outs row (not built, web Task 11).

**Amended 2026-10-30, the owner's answer on where a card play shows.** A sixth: main numbers a card play in its
thread and draws it as its own line, where the boards show #41 to #46 with no gap and the play as its tag on the post.
The owner chose the boards' way (the cards plan's amendment of this date says what cards Task 3 changes). Until cards
Task 3 lands, the fixture writes its plays after the moment's posts, so page 3 shows their lines below #46; the Main
and Phone manifests leave the thread below #46 out, and compare what stands below it (the pager, the HUD) by
`position` only, each with a comment naming Part 3, which turns them back to `full`.

**Amended 2026-10-30, after Part 1's final review.** The sentence above overstates what moves below #46. The Game HUD
is docked to the window, so the play lines cannot move it, and the Main and Phone manifests compare it in `full`, which
holds it closer than `position`. Board 01 draws no pager below #46, so the build's bottom pager has no landmark on
either side. What the play lines do move is #42 and #43's own post lines, behind #41's splat and the play tags, so those
two posts are compared by type with box `none`. Part 3 adds the tags and the hand, and turns #42 and #43 to `position`.

## 4. The glass's tokens: a closed list

Web Task 1 gives the token names; this is the list, closed. `engine/ui/glass/tokens.css` names exactly these, and
Divided World's `instances/divided-world/ui/glass.json` gives each its value from the boards. A color on a glass
surface that is not one of them is art, and lives in the instance's art (a card's face, the Vending Machine's sign,
Whoops!'s ink swatches), never in a component's style. `tools/check-ui-tokens.mjs` (web Task 1) gains a poison for
that: a `#ff2bd6` in an `engine/ui/glass/` component.

Each text token is tagged as the guard reads it: `body` (4.5:1 against its surface's calmed worst pixel), `large`
(3:1 against the full smoke), `waiting` (3:1 calmed), or `ink` (4.5:1 against the fill it is named for).

| Token | Divided World | Tag | Where the boards use it |
|---|---|---|---|
| `--kb-glass-ground` | `#07050d` | ground | under the smoke, every glass surface |
| `--kb-glass-panel-soft` | `rgba(10,6,20,.72)` | ground | the HUD's character plate |
| `--kb-glass-panel` | `rgba(10,6,20,.82)` | ground | panels (the boards draw .8 and .82) |
| `--kb-glass-panel-strong` | `rgba(10,6,20,.88)` | ground | the HUD's buttons; the menu bar (the boards draw .88 and .9) |
| `--kb-glass-sheet` | `rgba(9,5,18,.92)` | ground | dialogs and sheets (the boards draw .9 to .94) |
| `--kb-glass-field` | `#160d2a` | ground | selects and inputs |
| `--kb-glass-field-2` | `#120b22` | ground | the message box, empty slots |
| `--kb-glass-card` | `#0b0914` | ground | a postcard's face |
| `--kb-glass-text` | `#f1ecff` | body, large | text |
| `--kb-glass-text-2` | `#e4def7` | body | secondary text, descriptions |
| `--kb-glass-text-hi` | `#ffffff` | body, large | Back to the board, focus outlines, the settlement's figures |
| `--kb-glass-pale` | `#c9f8ff` | body, large | the clock, links, the seam's light |
| `--kb-glass-neon-text` | `#9ef4ff` | body, waiting | column heads, gains, a Turn that opens later |
| `--kb-glass-neon` | `#19e3ff` | body | borders, glows, the selected fill |
| `--kb-glass-sweet` | `#2ee6ff` | body | Sweet tags, Stick Around's frame |
| `--kb-glass-ready` | `#ffd93d` | body | gold: ready, the Vending Machine's frame |
| `--kb-glass-ready-text` | `#ffe27a` | body | gold labels |
| `--kb-glass-salty` | `#ff3d7f` | fill | Salty tags, the hand button |
| `--kb-glass-salty-text` | `#ff9cc0` | body | Salty text, the hand's count |
| `--kb-glass-estimate` | `#ffc48a` | body | the estimate ("+0.30 EST.") |
| `--kb-glass-loss` | `#ff8ab0` | body | a loss in the log |
| `--kb-glass-over` | `#ff8a96` | body, large | past the cap |
| `--kb-glass-ink-neon` | `#03141a` | ink on `--kb-glass-neon` and `--kb-glass-sweet` | text on cyan |
| `--kb-glass-ink-salty` | `#14030a` | ink on `--kb-glass-salty` | text on pink |
| `--kb-glass-ink-ready` | `#1a1403` | ink on `--kb-glass-ready` | text on gold |
| `--kb-glass-font-display` | Anton | | headings, figures |
| `--kb-glass-font-body` | Barlow Condensed | | everything else |

Panel alphas within .02 of each other are one token: over a ground this dark the difference is under one step of
8-bit color, and the comparator does not read backgrounds.

**Two families of color are the instance's data, not tokens,** because the engine cannot name them:

- **The classes' glass colors** go into `glass.json` beside the keys, keyed by the instance's class keys: Face
  `#3db8ff`, Heel `#ff3d57` (its large text `#ff8a96`, `#ff959f` as amended in section 6), Lurker `#2ef0a0`, Jabroni `#ffd93d`, each with its fill, its
  ink on the fill and its large text. The guard checks each as it checks the tokens.
- **The orbs** (web Task 3) go into `glass.json` as six gradients of three stops (highlight, color, shade) and the
  orb's body: c1 `#ead6ff`, `#b46cff`, `#3d1475`; c2 `#d6e9ff`, `#3d9bff`, `#0c3275`; c3 `#d6fff0`, `#2ef0a0`,
  `#08603f`; c4 `#fff7d6`, `#ffd93d`, `#7a5c06`; c5 `#ffe7d6`, `#ff9a3d`, `#7a3406`; c6 `#ffd6da`, `#ff4d5e`,
  `#750815`; the body from `#1c1533` to `#07060c`; the gloss a white ellipse; the ghost the hatched band of the Orbs
  board, pulsing (`ghostpulse`, 2.4s) under full motion. The 2003 board's pips stay the board's (`--kb-pip`).

## 5. The glass's shapes

In `engine/ui/glass/base.css` (web Task 1), as tokens a component sets and classes it takes:

- **Skew.** `--kb-glass-skew: -10deg` for buttons, tabs and plates; `--kb-glass-skew-tag: -12deg` for tags (Sweet,
  Salty, a card's state, ARMED, Stick Around's tag, the Main card tag). Text inside a skewed element is set upright by
  the opposite skew on an inner element, as the boards do (`<b>` in a `.tab`).
- **Chamfers,** cut with `clip-path`, in five steps: `--kb-glass-chamfer-1` 16px, `-2` 20px, `-3` 24px, `-4` 34px,
  `-5` 40px. Three placements, each a class: `kb-glass-cut-panel` (top-right only), `kb-glass-cut-dialog` (top-right
  and bottom-left), `kb-glass-cut-button` (bottom-right). The boards' chamfers, by step: the Vending buy button 1; the
  Hold certification label 2; the Vending wallet (22px) 3, the Orbs sections (26px) 3, the React picker 3; the Roster's
  selected panel 4, the play form 4, the Settlement's rank-up (36px) 4; the Turn modal 5. A chamfer's border is drawn
  on the cut, not under it (an inner element one border-width in, cut by the same polygon).
- **The HUD's top edge is a tab.** `clip-path: polygon(0 24px, var(--tab-a) 24px, var(--tab-b) 0, var(--tab-c) 0,
  var(--tab-d) 24px, 100% 24px, 100% 100%, 0 100%)`, the four points from the aura block's own position (on the Main
  board 452, 480, 972 and 1000: 28px slopes, 24px tall), so the tab follows the orbs at every width. The seam is an SVG
  polyline along the same points at y + 6, drawn twice: `--kb-glass-neon` 6px wide at 0.7 opacity under a blur of 4,
  then `--kb-glass-pale` at 1.5px.
- **Postcards.** 150×225, a 9px corner (the card's art, not a chamfer), a 1.5px ring in the card's own color with its
  glow. In the HUD's hand they fan through the seam at −11, −1 and 10 degrees; the armed one pulses (`armed`) and
  carries the floating tag "Armed · pick a post".
- **Focus.** A 3px `--kb-glass-text-hi` outline, offset 3px, on every control; on a skewed control it is the skewed
  shape's.
- **Motion,** all stopped under reduced motion with the end state shown: the HUD smoke's drift (28s, a 1560px strip
  moving 120px), `ghostpulse`, `armed`, and the Vending sign's `flicker`.

**Amended 2026-10-30, the owner's notes on #80's screenshot.** A card's tag over a post holds the card's name and its
caster on one line and the caster's message on its own line under them, a size smaller, and stands clear of the post's
line; an effect's words and controls are one glass element attached to the post, outside its 2003 chrome (the cards
plan's Task 3 and 5 amendments of this date). On the Phone board's layout these are a step smaller, within the size
floors.

**Amended 2026-10-30, the owner on #80's shots.** "For "Play whoops here" and the associated "splatted" state data - whatever we did for the turn checkboxes to bring back the gamelike theatrics, impeccable or something else, let's do that here. It's starting to look a bit like just "let the text and buttons flow however", less focused and intentional than it could be. And yes we should try to find a way to make the play button itself glass-styled" An effect's words and controls over a post
are one chamfered glass plate attached to the post, in board 06's idiom (the How loud row's, #51), and "Play Whoops!
here" is a glass control in it while a card is armed (the cards plan's Task 3 and 5 amendments of this date); the
splat runs to the post's borders with the post's controls drawn in front of it.

## 6. The smoke: a recipe per surface

The design and web Task 1 describe one smoke of two layers. The boards draw nine recipes, each tuned to its screen.
The look is the board's, so the smoke becomes recipes, and the guard checks each.

- **`engine/ui/types.ts`:** `GlassTheme.smoke` becomes `{ recipes: Record<string, SmokeRecipe>; surfaces:
  Record<GlassSurface, string> }`. `GlassSurface` is the engine's closed list of where smoke is drawn: `hud`, `hand`,
  `play`, `react`, `turn`, `effect`, `vending`, `characters`, `rankings`, `log`, `settings`, `account`, `settlement`.
  A `SmokeRecipe` is its layers (each a color, opacity, base frequencies, octaves, seed and blur, as before), and
  optionally: `drift` (strip width, seconds and travel), `calm` (the calm's opacity for this surface, default the
  theme's), `calmAll` (every text node on this surface stands in a calm, large text too), and `narrow` (the layers
  below 600px wide).
- **`engine/ui/glass/Smoke.tsx`** takes `surface` and draws that surface's recipe. A card's glass on a post (Stick
  Around's frame and panel, Whoops!'s tag) draws `effect`.
- **Divided World's recipes,** each copied from its board's `<filter>` elements (matrix, base frequency, octaves, seed,
  blur and the `<rect>`'s opacity), with the worst pixel the audit computed for each:

  | Recipe | Surfaces | From | Layers | Worst pixel |
  |---|---|---|---|---|
  | `page` | `log`, `settings`, `account`, `rankings` | 12 log, 11 settings | violet .95, cyan .5 | 0.230 |
  | `characters` | `characters` | 10 roster | violet .85, cyan .45 | 0.196 |
  | `turn` | `turn` | 06 turn | violet .6, cyan .4, over the dimmed page | 0.116 |
  | `effect` | `effect` | 08 hold | cyan .5, violet .55 | 0.103 |
  | `react` | `react` | 03 react | violet .8, blur 10 | 0.087 |
  | `cards` | `hand`, `play` | 05 cards; `narrow` from 02 phone's sheet | violet .85, pink .5, cyan .4 | 0.193 |
  | `vending` | `vending` | 07 vending | violet .85, pink .45, gold .3 | 0.230 |
  | `settlement` | `settlement` | 09 settlement, `calmAll` | violet .85, gold .35, cyan .4 | 0.274 |
  | `hud` | `hud` | 01 main, `drift` 1560px, 28s, 120px; `narrow` from 02 phone's HUD | violet 1.0, cyan .55, pink .5, blur 9 | 0.216 |

  The phone's two regions (the sheet and the HUD) are each two layers at blur 9, worst 0.249.
- **The settlement's large type.** At its worst pixel `#f1ecff` is 2.81:1 and white 3.24:1, so its large text cannot
  stand on its full smoke in the text color. The board puts its heading in a 0.8 calm; the recipe's `calmAll` makes
  that the rule for the whole surface, and web Task 12's measurement holds it.
- **`tools/check-glass-contrast.mjs`** (web Task 1) computes the worst pixel and the calmed worst for every recipe,
  and its `narrow` layers, and checks every text token, class color and ink pair against every recipe a surface
  uses: `large` at 3:1 against the full smoke unless the recipe is `calmAll`, `body` at 4.5:1 and `waiting` at 3:1
  against the calmed worst, `ink` at 4.5:1 against its fill, and the `high` key at 7:1 against the bare ground as
  before. Every `GlassSurface` must name a recipe that exists. Its output names the recipe as well as the token, the
  pair and the ratio. **Poisons,** added to web Task 1's: a surface naming a recipe that does not exist; the
  `settlement` recipe without `calmAll` (`#f1ecff` large falls to 2.81:1); the `hud` recipe's `narrow` cyan raised to
  1.0; an `ink` token of `#5a5a5a` on cyan; a class color whose large text is under 3:1.
- **Web Task 12's rendered measurement** writes each surface's ceilings from its own recipe, and on a `calmAll`
  surface requires every text node, large or not, inside a calm. **Poison:** the settlement's heading moved out of its
  calm.

**Amended 2026-10-30, the owner's answer on class large text (PR #39's Design question 2).** The owner chose "Per
screen + 9% lift". A class's large text is checked at 3:1 against the full worst only of the recipes for the surfaces
where the boards draw that class's large text on the full smoke (turn and react), and against the calmed worst where the
boards draw it inside a calm (settlement). The boards draw no class large text on the other surfaces (effect, hud,
vending, characters, the hand, the play and the page surfaces: there a class is a chip, body text, or a gold that is
`--kb-glass-ready-text`), so the list says none for each, and a screen that later draws it there keeps it in a calm, as
those surfaces' clouds are still too bright, and changes the list first. The engine names, for every `GlassSurface`, whether a class's large text is drawn there on the full smoke, in a calm, or not
at all; the guard checks each class against that list and writes a class ceiling only for the surfaces that draw it,
so Part 2's rendered measurement fails class large text on a surface with no ceiling. Heel's large text is lifted 9%,
from `#ff8a96` to `#ff959f`, which meets 3:1 on the turn recipe's full worst (`#ff8a96` is 2.80:1 there). Face, Lurker
and Jabroni are unchanged. **Poisons:** Heel's large text back at `#ff8a96` on turn; a surface missing from the
engine's list; a class's large text on a surface the list says does not draw it (Part 2's measurement).

**Amended 2026-10-30, the owner's answer on #53.** The owner: "#53 reword is fine, we should avoid being too strict with contrast, if we can still pass accessibility requirements by changing a rule slightly then that points to too much strictness in the rule itself." A
text node that is not `large` stands where the worst pixel its surface can put under it is under its color's ceiling:
in a calm's interior, on an opaque panel, or on a recipe whose full worst is under that ceiling. So a dim recipe's words
need no calm where the recipe's full worst is under their colors' ceilings (the turn recipe, 0.116, for `--kb-glass-text`,
`-text-2`, `-text-hi`, `-pale` and `-neon-text`, as the Turn board draws them), and a color whose ceiling is under it
still takes a calm or a panel there (`--kb-glass-over`, 0.054, the Turn's hurt marks). The guard is unchanged: it already
writes each surface's full worst (`worst`, and `narrowWorst` for a recipe with narrow layers) beside its ceilings, and the
rendered measurement reads them there. `calmAll` is unchanged: on the settlement, whose full worst is under no ceiling,
every text node, large or not, stands in a calm.

**Amended 2026-10-30, the owner's answer on #54.** The rendered measurement read a class's large color as large at any
size, which let the React picker's quadrant labels (22px Anton in the classes' large colors) stand at 3:1 on the react
smoke under a size no rule calls large. The owner chose to set them at WCAG's large size: "24px should work for #54".
So text that may stand at 3:1 as large is text at WCAG's large size or more (24px, or 18.66px at a weight of 700 or
more) as well as the design's large (36px of ink); a token still needs its `large` tag to be read so. That reaches past
the class colors to the `large`-tagged tokens too, under the owner's answer on #53 that a rule is not to be stricter
than accessibility needs: WCAG's large size is accessibility's own line. A class's large
color under that size takes the body path: it stands in a calm, on an opaque panel, or on a recipe whose full worst is
under its color's 4.5:1 ceiling, worked out from its color as the guard works out a token's. The picker's labels are
24px. **Poison:** a class's large color at 22px, bare on the react smoke, fails.

## 7. Each board: what it shows, what builds it, and what is compared

The board file is the geometry. Each part below is found in the board by its role and name; its size, position,
type and color are read from the board, not restated here. Names in quotes are the board's; an arrow gives the
build's where section 3 changed it.

### 01 main (1440×1120): web Task 3, Task 5, Task 6; cards Tasks 2 and 3

| Part | Built by | Compared |
|---|---|---|
| banner, `navigation "Main"` (Index, General, The System) | `engine/ui/frame/` (web Task 3) | landmarks; "Search" is not built |
| the thread's breadcrumb, `heading` level 1, pages, Jump to latest | `engine/ui/thread/` (web Task 5) | type only |
| `article` per post, its author link, rank `img`, `#41` permalink | `engine/ui/postbit/` (web Task 5) | position and type |
| `status` "3 new posts" | `engine/ui/thread/` (web Task 5) | full |
| `button "Hold to scrub"` on #41 (was "Scrub with the keyboard") | Whoops!'s `Effect.tsx` (cards Task 5) | position |
| "React" and "1 of 3 left" on #41 and #42 | not shown: the player's own posts (section 3) | absent in the build |
| `button "Play Whoops! here"` on #42 (the board draws a link) | `engine/ui/cards/` (cards Task 3) | full |
| `region "Game HUD"`: its box, the tab and seam | `engine/ui/frame/Hud.tsx` (web Task 3) | full |
| the character plate: avatar, name, the class tag "Heel" with "Only you see this", `combobox "Swap mask"` | web Task 3 | full |
| the orbs, `img` → "Wallet 4.62 of 6 orbs, 0.30 pending until the next settlement (estimate)", "+0.30 est." | `engine/ui/orbs/` (web Task 3) | full |
| the clock, "Next settlement" | web Task 3 | position and type |
| `button "Menu"` (`aria-keyshortcuts="Escape"`, `aria-haspopup`), its Esc key cap | web Task 3 | full |
| `button "Hand, 3 postcards"` | web Task 3, cards Task 2 | full |
| the fanned postcards, each a `button` by its name, the armed one's tag | cards Task 2 (hand), Task 3 (armed) | full |

**Amended 2026-10-30, the owner's notes on #80's screenshot.** Board 01 draws #41's scrub sentence, with its keyboard
button, inside the 2003 post; the build draws Whoops!'s words and controls as a glass element outside the post, and the
splat over the post's whole body, by the owner's word (the cards plan's Task 5 amendment of this date). The manifest
names that region as differing.

### 02 phone (390×844): web Task 3; cards Task 2

| Part | Built by | Compared |
|---|---|---|
| banner `button "Boards"` | `engine/ui/frame/` (web Task 3) | full |
| `region "Your hand"`, its `button "Close the hand"`, the cards, the Vending Machine link | cards Task 2 | full |
| `region "Game HUD"`: `combobox "Posting as"`, `button "Menu"` (no key cap), `button "Hand, 3 postcards, open"` | web Task 3 | full |

Type at the phone's sizes (body 17px, nothing under 16px), controls 48px tall.

### 03 react (900×700): web Task 6

A story: the rival's view of Mrs. Hooligan's #42 with the picker open. `dialog "React to Mrs. Hooligan's post"`,
"2 of 3 left", `group` Heat, Hype, Groan and Calm, each emoji `button` by its name ("Tea, your reaction" outlined),
the hint "Arrow keys move, Enter reacts. Outlined: yours." All full.

Amended 2026-10-30, after Task 2.1: the picker is compared by `size` and its parts from its corner (`origin`), as
section 2.3's amendment says. The emoji buttons are `type: false`, since an emoji is set in the system's face and not
the glass's. Heat, Hype and Calm's groups are `type: false`, since the board drew their labels in shades that differ
from `glass.json`'s class large text, which wins as section 4's instance class data (Heel's by the owner's lift);
Groan's label matches and is compared.

Amended 2026-10-30, the owner's answer on #54 (section 6): the quadrant labels are 24px, 2px over the board's 22px,
so they are large at WCAG's size; Groan's label is compared with that size as the decided one.

**Amended 2026-10-30, in the glass build's Part 3 (the cards).** Boards 01 and 05 are compared as the build reached
them, each difference in its manifest's header. On 01: the hand's fan opens from the hand button, so the button is
compared as "Hand, 3 postcards, open"; the fan's postcards are named by the words each shows (Label in Name), by
`buildName`; "Play Whoops! here" on #42 is compared by type, as #42 itself is (#76's numbers: #41's 360px column and the
board's avatar slot under #42 move it); "Hold to scrub" likewise. On 05: the play form's dialog is compared by
position and some rows below the ink by size, since Whoops!'s ink form adds an "Any color" picker and a preview the
board does not draw (about 190px); "Total" reads "To pay now" at the body size; the cost lines read as #78 settled
("Card: paid", the long post 0.25, to pay now 0.25, the wallet after 4.37). On 07: the "In the machine" list is gone
(#75), and the title, the slots and the price display are the instance's art, compared by place.

### 04 orbs (1440×900): web Task 3

A story of the orb states as the board lays them out: empty, settled, the ghost's gain, the ghost's loss band, past
the cap ("+0.40 past the cap"), and the cascade's frames. Each orb row's `img` by its name, in web Task 3's wording;
the legends' type.

### 05 cards (1440×1080): cards Tasks 2 and 3

- A story of the hand sheet: Stick Around and Whoops! in hand, armed, and the sealed slot ("An empty slot for a
  future postcard"), each card's name, price, rules in plain words and state tag; "On the board, the same card reads
  like this", the card's tag on a 2003 post. Full.
- The app at the play moment: `dialog "Whoops!"`, the play form, on Gloomba's #46 (was Spritey's #41): the ink colors
  as a `radiogroup` (Magenta chosen; the swatches are the card's art), `textbox` the message with its count "20 / 200",
  the cost lines (card 1.00, long post 0.25, total 1.25), `img` → "Wallet after playing: 3.37 of 6.00", `button "Play
  as Pipewrench"`, `button "Cancel"`, `button "Close"`. Full, the target line by `position`.

### 06 turn (1440×1420): web Task 9

The app at the Turn moment: the menu bar dimmed and inert behind; `dialog "Turn Pipewrench"`: the portrait, the
standing (2.95, was 2.40), "Class now Heel, only you"; the four class cards as a `radiogroup` with each class's
quadrant marks and description from `instances/divided-world/classes/`; how loud as a `radiogroup` (Silent, Announced,
Announced with old class); "What everyone will see", The System's post as it will read; "Takes effect at the next
settlement, in 7 h 42 min"; the 30-day cooldown line from `instances/divided-world/settings.ts`; Cancel and Confirm
Turn. Full.

### 07 vending (1440×1080): cards Task 2

The app before the buy: the menu bar (Vending Machine current); the heading; the wallet panel, "Wallet · solid only",
5.62 → 4.62 (was 4.62 → 3.62); "Your hand 2 → 3" (was 3 → 4); the machine's name "[Machine name]" (a placeholder in
the instance's copy); slots A1 and A2 as `button "Buy Stick Around, 1.00 orb"` and `button "Buy Whoops!, 1.00 orb,
selected"`, the four sealed slots; the price `status`; `button "Buy Whoops! · 1.00"`; "Push Whoops! to your hand"; the
"In the machine" descriptions. The machine's drawing (its body, its sign, the slot labels B1 to C2, Push and Aura in)
is the instance's art, `aria-hidden`, and its 13px labels are decoration, exempt from the type floor. Full, the
machine's art `none`.

### 08 hold (1440×980): cards Task 4

A story: the reader's view of #44, without the HUD (the board draws none; the HUD is the Main board's). The 2003 banner
and the thread's earlier posts above; `article "Held post: Spritey, #44"` in the board's 2003 post; the frame in
`--kb-glass-sweet`, its tag "Stick Around · Gloomba: 'required reading'"; `region "Release"` with the `checkbox` in the
caster's sentence; `progressbar "Break free"` at 40%; `button "Break free"`; "Keep scrolling away to break free for
this visit. Next visit, it holds you again until you check." Full.

**Amended 2026-10-30.** Stick Around now lifts the held post into a full-screen view (screens design, section 10's
amendment of this date), which board 08 does not draw. Board 08 stays the reference for the frame, the tag, the release
checkbox in the caster's words and the bar's look. The full-screen view is drawn first as a story for the owner, and
08's manifest is rewritten from the approved story, as Rankings' board 13 was.

### 09 settlement (1440×960): web Task 8

The app at the first load after the settlement. No menu bar: a results screen whose ways out are Open my log and Back
to the board, and Esc (section 9). "Settled Oct 30 · 08:17 UTC"; `navigation "Your characters"` (a tab each); "While
you were away"; `region "Wallet"` with `img` "Wallet now 3.72 of 6.00" and 3.37 → 3.72, +0.35; "Why, in plain words ·
scored as a Heel" and each line in `reasonWords`' words with its amount, "Stole thunder" on Gloomba's #46 (was
Spritey's #41); `region "Rank up"` (Enhancement Talent to Midcarder, `img "Rank: 3 of 6 pips"`, standing 2.95 → 3.30);
`region "Turn"` (Heel to Face, "announced it, with the old class, in Season 1: Who Turned"); Open my log, Back to the
board. Full; the reason lines by `height`.

### 10 roster (1440×1160): web Task 9

The app: the menu bar (My characters current); the heading and "Only you see this page…"; `list "Roster, 3 of 6
slots used"`, a card per character with portrait, name, class in its color, rank and its Turn state ("Next Turn opens
Nov 29", "Turn ready"), and New character; the selected panel (chamfer step 4) for Pipewrench: class Face since Oct 30,
"Was Heel, announced publicly", rank and standing, wallet 3.72 of 6.00, posts and the month joined, pip style, the
disabled `button` "Turn · opens Nov 29" in `--kb-glass-neon-text` on a dashed border, the cooldown line, Change avatar,
Pipewrench's log; the six-character note. Full.

### 11 settings (1440×1360): web Task 11

The app: the menu bar with all six tabs (Settings current; the board omits Rankings); the heading; `navigation
"Settings sections"` with Account and Accessibility (the board's other three are not built); Accessibility: the
`radiogroup`s Motion (Follow my device, Reduced, Full), Smoke (Full, Low, Off), Contrast (Standard, High), Text size
(100%, 125%, 150%, 200%) and The board (section 9), each with its sentence; "Changes save as you make them." The
Read-outs row is not built. Full.

### 12 log (1440×1240): web Task 8; cards Task 6

The app: the menu bar (My log current); the heading; `navigation "Whose log"` (All and a tab per character, Pipewrench
current); "Everything on this page is true…"; `table "Pipewrench's log, newest first"`, its columns When (UTC), What,
Details, Aura, Wallet, each line naming its Act's link; six rows where the board has eight (section 3); "If a line
here looks wrong, that is a bug and not the game. Tell an admin." Header and first row full; the table by `height`.

## 8. What no board draws, specified

Each of these is drawn first as a story and shown to the owner on the PR of the task that builds it, before its tests
are written against it. The owner's word on the story is recorded in that PR.

**Amended 2026-10-30, the owner's answer on the glass between the boards' widths (PR #39's section 8 story).** The
owner chose "Board layout, scaled", which replaces the 1340px switch to the Phone board's HUD below. Above 1440px
nothing changes. Below 1440px the Main board's layout, the HUD's three groups and the glass pages alike, keeps the
board's arrangement and scales in proportion to the window. It becomes the Phone board's layout only at the width where
the smallest scaled text would fall below the Phone board's sizes: 1440px times the smallest phone size over the
smallest Main board size, worked out from the instance's size tokens (for Divided World, 1440 × 16 / 20 = 1152px), never
picked by hand, and a test asserts it. The one width also replaces the menu bar's 900px switch to the phone's menu
bar, so a glass page and the HUD change layout together. The 1024px story is replaced by two, one just above that
width and one just below it, and the owner reviews those.

**Amended 2026-10-30, the owner's answer on #48 (a wallet past its cap on a phone).** The owner chose (c): "it's
normal to need to hide some explanatory text on mobile layouts and an additional 40px is not nothing for a sticky
bar." On the Phone board's layout (below the switch above), a wallet past its cap shows as a visible marker on the last
orb, and the words "past the cap" and its amount are not drawn in the HUD's row: they are in the orbs' accessible name
only, which already says them (`walletName`, `engine/ui/orbs/fill.ts`). The docked HUD keeps its 124px with an
over-cap wallet at 360px. The Main board's layout keeps the words as board 04 draws them ("+0.40 past the cap"). Built
in Part 3, tests first: the docked HUD's height with an over-cap wallet at 360px, the marker visible, and the orbs'
accessible name saying past the cap with its amount.

- **The glass between the boards' widths.** A glass page's content sits in a column at most 1312px wide (the boards'
  1440 less two 64px gutters), centered past 1440px; its gutters are `clamp(16px, 4.44vw, 64px)`; text blocks stay at
  most 680px wide; at more than 150% text size the page is one column (web Task 11). The menu bar spans the width: its
  Esc hint is the first thing it drops when its tabs no longer fit, and below 900px it is the phone's menu bar.
- **The HUD between the boards' widths.** Its three groups (the character plate, the orbs and clock, Menu and the hand)
  are a grid at the Main board's widths and gaps, centered past 1440px with the glass and seam full width. Below
  1340px, where the three no longer fit, it is the Phone board's HUD, at the phone's sizes, and the hand opens as the
  Phone board's sheet. First story at 1024px.
- **The menu bar on a phone.** A row 48px tall holding "← Back to the board" (no key cap), then a strip of the five
  page tabs, each 48px tall, scrolling sideways on its own with the current tab scrolled into view; the page itself
  never scrolls sideways. Type at the phone's sizes. First story at 390×844.
- **Rankings** (web Task 10). The page shell and menu bar; the heading as the Settings board sets its own; a table set
  as the Log board's: Place, Character, Rank, Standing and Class; the player's own rows marked with a tag ("Yours",
  skewed as a tag, in `--kb-glass-neon`) and their classes in their colors; a revealed class shown with its date. Its
  surface is `rankings` (the `page` recipe). Once the owner approves the story, a board is drawn from it into
  `docs/research/2026-10-29-two-worlds/` as `13-rankings.html` and a manifest is added, so it is held like the others.
- **The account screens** (web Task 11): registration, sign-in, invites and the errors. Signed out there is no menu
  bar (its pages need an account); a thin bar holds "← Back to the board". Each is the Settings board's parts: its
  heading, its rows (a label column of 230px, the controls, the sentence under them), its segmented choices, and the
  HUD's field (`--kb-glass-field`, a cyan border, 52px tall). Settings › Account holds the sign-in address (plain, not
  editable), invites (make one, the cap and expiry said plainly, reissue) and Sign out at its foot. Its surface is
  `account`.
- **High contrast and 200% text** have no board. Their tests are web Tasks 11 and 12's.

**Amended 2026-10-30, the owner on the 2003 board's width (in Part 3's build session).** The owner: "Looks like we
need a smaller max width for the 2003 board in general. There's the need to keep the line breaks the same for whoops,
and widening the table too much makes it look a bit silly." Asked for a width, the owner chose 960px. So the board's
own pages (the banner, the index, the boards, the threads, the profile, the standings) stand in a column at most 960px
wide, centered past it; the glass (the HUD, the menu bar, the glass pages and overlays) keeps its own widths. The boards
drawn at 1440 (01 and 08 among them) draw the board across the window; their manifests compare the board's parts by
the decision (`box` modes or an `origin`, each saying so). Whoops!'s layout follows it (the cards plan's Task 5
amendment of this date).

## 9. Choices this plan made, for the owner to overturn

Nothing here was decided by the owner; each is the plan's default, chosen so the build can go on, and each is listed
in this plan's PR.

1. **Menu opens My characters,** as web Task 3 says.
2. **Sign out is at the foot of Settings › Account.** (The design left where it lives open.)
3. **Settings shows Account and Accessibility only.** Notifications, Privacy, Export my data and Read-outs wait for a
   design.
4. **The board row in Settings** offers Follow my device, Black on white and White on black, then any theme the
   instance adds (web Task 11's theme choice, in the board's words). The postbit style is a row of its own under it,
   "Posts": Side by side, Stacked.
5. **The banner** holds Index and the instance's boards from its data (General, The System). Search is not built.
6. **The machine's name** stays "[Machine name]" in the instance's copy until the owner names it.
7. **"Swap mask"** on a wide screen and **"Posting as"** on a phone stay as the boards word them.
8. **The settlement's summary has no menu bar,** and Esc goes back to the board.
9. **The fixture's three accounts,** and the new character Thwompson, so the Hold and React boards can be seen by a
   player the rules let see them (section 3).
10. **Copy in sentence case, capitals by CSS,** so a screen reader reads words.
11. **Near values made one:** panel alphas within .02, and chamfers in five steps (section 5).
12. **The HUD below 1340px is the phone's** (amended 2026-10-30: the owner chose the Main board's layout scaled, down to
    a width worked out from the size tokens; section 8), and **the phone's menu bar** is a Back row over a scrolling strip
    (section 8).
13. **Rankings' look** (section 8).

## 10. Which task carries what

| Task | Carries from this plan |
|---|---|
| web Task 0 | `test:e2e` runs `web/e2e/boards.spec.ts`; the e2e build in `--mode fake`; the production bundle's assertion that the fake backend is absent (section 2.1); `web.yml` uploads `web/e2e/report/boards/` |
| web Task 1 | the closed tokens and the instance's colors (section 4); the shapes (section 5); the smoke's recipes, the type change and the guard's new checks and poisons (section 6); `web/e2e/board-match.ts` and its self-test (section 2.3) |
| web Task 2 | the fixture and its moments (section 2.1) |
| web Task 3 | boards 01 (frame, HUD), 02 (HUD, banner) and 04 (orbs); the HUD and menu bar between widths, the phone's menu bar (section 8) |
| web Task 5 | board 01's thread and posts |
| web Task 6 | board 03; no React on the player's own posts in board 01 |
| web Task 8 | boards 09 and 12 |
| web Task 9 | boards 06 and 10 |
| web Task 10 | Rankings' story, its board and manifest (section 8) |
| web Task 11 | board 11; the account screens (section 8) |
| web Task 12 | the per-recipe ceilings and `calmAll` in the rendered measurement (section 6); the axe test over every board story |
| cards Task 2 | board 07; board 05's hand sheet; the hand in boards 01 and 02 |
| cards Task 3 | board 05's play form; board 01's armed card and "Play Whoops! here" |
| cards Task 4 | board 08 |
| cards Task 5 | "Hold to scrub" in board 01 |
| cards Task 6 | board 12 without the Stick Around lines |

## Ways out of the states this adds

This plan adds no state a player, a character or a post can be put in. The states its screens show are the web and
cards plans', with their ways out. The one this plan settles is the settlement's summary without a menu bar: Open my
log, Back to the board, or Esc.

## What could vary with a private fact, and how it does not

- The fixture is test data, read only by the fake backend in the e2e build, and absent from the production bundle
  (section 2.1, asserted).
- The React board seen by the rival shows the rival's own Tea and the rival's own "2 of 3 left": both the viewer's own
  rows. Nothing on it is computed from who else reacted.
- Rankings' marks and classes are the viewer's own rows and the public `class_reveals`, as web Task 10 says. The tag
  "Yours" is drawn on the viewer's own screen only.
- The smoke's recipe is chosen by the surface, never by the account, the character or what the player holds.

## Open

- **The phone's floor** (design, Open) is still to be checked with the owner on real phones. The phone's menu bar and
  the HUD between the boards' widths are this plan's, shown to the owner as stories (the HUD's answered 2026-10-30,
  section 8).
- **Rankings beyond the public standings** (design, Open): its first board is this plan's minimal one.
- **Whether a player-made theme can reach the glass** (design, Open): until it is decided, `glass.json` is the
  instance's only.

## Review focus

- The board match's tolerances: whether ±8px and ±4px hold the boards' look across Chromium versions, and whether a
  real drift (a menu bar 6px taller) can hide inside them.
- The fixture's moments: a later task that changes the fixture's data for its own test and moves another board's
  screen under it.
- The comparator's name matching: two landmarks with the same role and name on one screen (two "Play Whoops! here"
  buttons) matched to the wrong one.
- Each recipe drawn on a long page on a phone, and the HUD's drifting strip under full motion: their cost.
- A recipe an instance tunes brighter for one surface, and whether the guard is the only thing between it and that
  surface's text.
- The `effect` surface: a card's glass drawn over a post on a 2003 white board (light theme), where the smoke's worst
  pixel is not the only ground behind the text.
- The fake backend's moment parameter reaching a production build by a configuration slip.
