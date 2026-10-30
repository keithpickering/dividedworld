# The screens: the web app's core: plan

Record, written 2026-10-29. The second of three plans for `docs/plans/2026-10-29-screens-design.md`: the web app and
every screen of the first slice except the cards (the third plan, `docs/plans/2026-10-29-screens-cards-plan.md`). It
starts after the engine plan (`docs/plans/2026-10-29-screens-engine-plan.md`) is merged, and reads PR #2's engine as
merged. A build session carries it out task by task, tests first, each red run recorded
(`.claude/skills/build-session/SKILL.md`).

**Amended 2026-10-29, after PR #7** (`docs/plans/2026-10-29-core-loop-build-answers.md`): sign-in is passwordless;
a new character waits to debut at the next settlement; a Turn is pending until then and can be changed or withdrawn;
announced Turns and debuts appear in The System's tally. Tasks 9, 10 and 11 say so.

**Amended 2026-10-29, after the clues design** (`docs/plans/2026-10-29-clues-design.md`, built by
`docs/plans/2026-10-29-clues-plan.md`, which this plan starts after). Where a task below says otherwise, this wins:

- Task 3: the estimate is asked for when the HUD opens, when a reaction lands on one of the player's own Acts, after
  the player's own reaction (a line they earn by reacting, such as the Lurker's call, otherwise waits), and once more
  at the answer's `freshAfter`; never on a timer.
- Task 4: a thread's views are its character views (`thread_view_counts.views`), read by every signed-in player.
- Task 8: the estimate's lines are each reaction's own amount at its own time; none says "about".
- Task 9: New character offers drop now or debut at the tally, each silent or announced, with a preview of what
  everyone will see (no class is ever shown); a waiting character offers Drop now and a change of loudness; a Turn
  whose `takes_effect_at` is null says "at the next settlement". The cropper sends a portrait (256 to 512 wide, up to
  twice as tall) and a square cut from inside it, and no original; a recrop of the square cuts it from the stored
  portrait and sends the square alone.

**Amended 2026-10-29, after the class reveal design** (`docs/plans/2026-10-29-class-reveal-design.md`, built by
`docs/plans/2026-10-29-class-reveal-plan.md`, which this plan also starts after):

- Task 5's postbit and Task 10's profile show a character's latest public statement of its class, from
  `class_reveals`: "Revealed: Heel (Oct 3)", and "Has Turned since (Oct 20)" when a later announced Turn came after
  it; the profile's public record lists every reveal.
- Task 9: a Reveal action on My characters and in the composer's menu names the class it will show and asks to
  confirm ("this can't be taken back"), with an optional line of the character's words; New character and the Turn
  modal gain "with its class" and "name the new class" in their previews of what everyone will see.
- Task 10: the season's reveal shows each character's place, rank and standing, and only what its player made public
  (`shown`); no class timeline.

**Amended 2026-10-29, after the two-worlds design** (`docs/plans/2026-10-29-two-worlds-design.md`; its one engine
change, `docs/plans/2026-10-29-two-worlds-plan.md`, is merged before Task 11). The screens are two worlds: **the
board** (the index, boards, threads, posts, profiles, the standings, the reveal), which keeps this plan's 2003 look,
and **the glass**, everything outside it, in the look of the boards in `docs/research/2026-10-29-two-worlds/`. The
owner on those boards: "These mockups are perfect, I'd like to really aim for this exact look." A glass screen matches
its board; where a board and the design disagree, the design wins on what is decided and the board on how it looks.
Where a task below says otherwise, this wins:

- **The brief.** Point 1: the board is Operate mode as before; the glass (the HUD, the hand, the React picker, the
  play form, the Turn modal, the Vending Machine, My characters, the log, Rankings, settings, the account screens,
  invites, errors) is Experience mode, a game's own menu, and it speaks plainly, never in character (design, section 3).
  Point 3: the 2003 direction is the board's; the glass's is the design's section 2 (the near-black ground, two layers
  of procedural smoke, cyan, gold and Salty neon, Anton and Barlow Condensed, skewed tabs, chamfered panels), and the
  focal moment is the seam where the HUD's glass meets the board. Point 4's anti-goals hold in both worlds (no rounded
  pills, no soft drop shadows); "no color on the forum chrome" is the board's. Point 7: the board meets WCAG 2.2 AA;
  the glass meets it and XAG 101 and 102 as the design's section 4 reads them: text inks at least 18px at 1080p, so
  Barlow Condensed is never under 20px and body copy is 21px at 1.5 and at most 680px wide (16px and 17px on a phone);
  large text (Anton at 37px or more, Barlow Condensed at 40px or more) may stand on the full smoke at 3:1; everything
  else reaches 4.5:1 in a calm; high contrast reaches 7:1; controls are at least 52px tall (48px on a phone), as the
  boards set them, with 3px focus outlines.
- **The layout** gains three rows:

  | Path | Layer | Holds |
  |---|---|---|
  | `engine/ui/glass/` | engine | The glass's frame: the menu bar, the page shell, the overlay shell, the smoke and the calm, the glass's token names and base CSS, and the `GlassTheme` type |
  | `instances/divided-world/ui/glass.json` | instance | Divided World's glass as data: the standard and high-contrast keys, the smoke's layers, the calm's opacity and feather, each font's file, weights and measured ink ratio. JSON, so the guard reads it with no TypeScript loader; `index.ts` imports it into `InstanceUi.glass` |
  | `instances/divided-world/ui/fonts/` | instance | Anton and Barlow Condensed as WOFF2, only the weights the glass uses, with the SIL Open Font License beside them (`OFL.txt`). Served from the instance's own files, never a font service |

- **Task 1** gains the glass:
  - `engine/ui/glass/tokens.css` (`--kb-glass-ground`, `--kb-glass-text`, `--kb-glass-text-2`, `--kb-glass-neon`,
    `--kb-glass-neon-text`, `--kb-glass-ready`, `--kb-glass-loss`, `--kb-glass-seam`, `--kb-glass-font-display`,
    `--kb-glass-font-body`, the size steps, …) and `engine/ui/glass/base.css`: the menu bar, tabs skewed -10 degrees
    with their text set upright, chamfered panels, the seam (1px pale cyan with a cyan glow), at the boards' sizes.
    `tools/check-ui-tokens.mjs` reads `engine/ui/glass/` as it reads the rest of `engine/ui/`.
  - `engine/ui/types.ts`: `InstanceUi.glass: GlassTheme`: `keys` (`standard` and `high`, each a map from token to
    value, each text token tagged `body`, `large` or `waiting`); `smoke` (each layer's color, opacity, base frequencies,
    octaves, seed and blur); `calm` (opacity and feather); `fonts` (family, file, weights, style, and ink ratio, the
    share of its em the face inks from ascender to descender: Barlow Condensed 0.90, 0.91 at weight 800; Anton 0.99).
  - `engine/ui/glass/Smoke.tsx`: the layers as SVG fractal noise, as the boards draw them, behind every glass page and
    under every glass overlay's panel; drifting slowly under full motion, still under reduced motion, at a third of
    each layer's opacity under the `low` preference and not drawn under `off`. The ground is opaque under it, so a page
    is legible before the smoke draws and when it never does.
  - The calm, `engine/ui/glass/calm.css`: a `kb-calm` class whose `::before` is a backing on the text block's own
    element, sized by the block, feathered at its edge with a mask, and failing safe (`@supports not (mask-image: …)`)
    to a hard-edged panel of the ground at the calm's opacity. The boards draw their calms as masks on the smoke; the
    build draws them on the words, as the design's section 4.4 says, so a calm follows its text when it reflows.
  - `@font-face` for each of the instance's fonts, from its own files, `font-display: swap`; the fallback is the
    generic `sans-serif`.
  - New guard `tools/check-glass-contrast.mjs` with `tools/test-glass-contrast.mjs`, into `STEPS`, test first. It
    reads every `instances/*/ui/glass.json` (the engine's guard names no instance) and, before anything renders:
    composites the smoke's layers at full noise over the ground, in order, for the worst pixel (Divided World's is
    `rgb(77,126,247)`, luminance 0.231), and again with each layer thinned by the calm's opacity for the calmed worst;
    then requires each `large` text token at 3:1 against the worst, each `body` token at 4.5:1 and each `waiting` token
    at 3:1 against the calmed worst, every text token opaque, the `high` key at 7:1 against the bare ground and naming
    exactly the tokens the `standard` key names, every size token times its face's ink ratio at 18px or more (a phone
    size token at 16px or more), and every font with an ink ratio. Its output names the token, the pair and the ratio
    that failed, and writes the computed ceilings for Task 12's measurement.
  - **Poisons** (in `tools/test-glass-contrast.mjs`): the calm's opacity lowered to 0.3 (`#e4def7` falls to 4.42:1
    against the calmed smoke); a `large` heading token in `#9ef4ff` on the full smoke (2.99:1); the cyan layer's
    opacity raised to 1.0 (white large text falls to 1.69:1); a body size of 19px (17.1px of ink); a text color with an
    alpha of 0.8; a `high` key missing one token the `standard` key has; a font with no ink ratio.
- **Task 3. The frame is two worlds.** The 2003 banner holds only the board's own navigation (the index and the
  boards, and sign-in when signed out). The HUD is glass, docked at the bottom with the seam along its top edge; it
  keeps everything this task gives it and gains a Menu button. Every way into the glass is the HUD's: Menu opens the
  glass at My characters, the orbs open My log, the avatar opens My characters, the hand opens the hand drawer.
  - `engine/ui/glass/MenuBar.tsx`, on every glass page: Back to the board with an Esc key cap, then the Vending
    Machine, My characters, Rankings, My log and Settings; the current page carries `aria-current="page"`. Each is a
    full-screen page under it, not a modal.
  - Going back: entering the glass keeps the board's route and the post in view; Back and Esc restore both, and a
    thread that grew meanwhile shows its "new posts" bar rather than moving the reader.
  - `engine/ui/glass/Overlay.tsx`: the glass's overlays (the hand drawer, the React picker, the play form, the Turn
    modal) open over what they were opened from, dim it, hold focus, close on Esc and return focus. Esc inside an
    overlay closes the overlay only.
  - The orbs take the glass's look, as the Orbs board draws them; their states and numbers are this task's.
  - **Tests first:** the banner's links are the board's alone; the orbs, the avatar, Menu and the hand each open their
    page or drawer; Back and Esc return to the same post on the same page; Esc in an overlay on a glass page closes the
    overlay and leaves the page; focus returns to the control that opened an overlay.
- **Task 6:** the picker is a glass overlay, as the React board draws it; the chips on a post stay the board's.
- **Task 8:** the log is a glass page, as the Log board draws it: one row per line with when (UTC), what, the details
  with the Act's link, the Aura moved and the wallet after; a tab per character and All. Every word of this task stays.
  It gains the settlement's summary, `engine/ui/log/Settlement.tsx`, as the Settlement board draws it (design, section
  8): on the player's first load after a settlement they have not seen, a glass page with a tab per character, the
  wallet before and after, each reason in the log's own words with its amount, a rank change and a Turn that took
  effect, with Open my log and Back to the board. It reads the same rows as the log and says nothing the log does not.
  The last settlement seen is kept on the device (design, Open). **Tests first:** shown once per settlement and not
  again after either way out; each line equal to the log's line for the same reason; nothing shown before the first
  settlement.
- **Task 9:** My characters, New character, the Turn modal and `engine/ui/profile-edit/` are glass, as the Roster and
  Turn boards draw them. The Turn modal is an overlay over what opened it (My characters, or the board from the
  composer's menu). A character's class shows here in its own color, to its own player only.
- **Task 10:** the profile, the standings, the tally and the reveal stay on the board. New, in the glass:
  `engine/ui/rankings/`, Rankings: the season's public standings from `season_standings`, in their order, the
  player's own characters marked and shown with their classes from the player's own rows; another character's class
  shown only from `class_reveals`, with its date, and nothing else about it. **Tests first:** a character with no
  reveal shows no class; a revealed class shows with the reveal's date and a later announced Turn says so; the order is
  `season_standings`' order whoever is signed in; the page's requests are the same for every player apart from the
  player's own rows.
- **Task 11:** registration, sign-in, invites, settings and errors are glass, as the Settings board draws them, and
  keep every word this task gives them. Settings gains smoke (full, low, off), contrast (standard, high) and text size
  (100, 125, 150 and 200 percent), saved with the other preferences through `set_preferences`. High contrast puts solid
  ground under every line of glass text and switches to the `high` key. Text size scales the board and the glass
  together, so the board's own sizes are set in units that follow it; past 150% the glass folds into one column with
  nothing cut off. The theme choice restyles the board only (design, Open). The board's Notifications, Privacy and
  Export my data sections and its "Announce card effects" read-out are not built: no design has decided them.
  **Tests first:** smoke off draws no smoke element; each new preference persists across a fresh load; 200% at
  1280px wide has no horizontal scroll and no clipped text.
- **Task 12** gains the rendered glass measurement, in the e2e suite (`web/e2e/glass-text.spec.ts`), over every glass
  page and overlay at 1920×1080 and at 390×844, under reduced motion so the smoke holds still:
  - each text node's face, at its computed size, inks at least 18px (16px of computed size on the phone), measured
    with the canvas's `measureText` over a string carrying an ascender and a descender, in the loaded face;
  - each text node that is not `large` lies inside its calm's backing (inset by the feather) or an opaque panel;
  - with all text made transparent, the brightest pixel under each text node's box stays below its color's ceiling
    from Task 1's guard; under high contrast, every text node stands on solid ground.
  - **Poisons:** a calm moved off its text; a feather that reaches into the text; a 19px label; a translucent text
    color; under high contrast, one line left on the smoke.
  The axe test of this task runs over the glass's stories too. axe cannot read contrast over the smoke and reports it
  as incomplete there; the two glass guards decide it.

**Amended 2026-10-30, after the pause-menu boards** (the design's amendment of that date). Task 3: the banner's links
leave out Sign out, which belongs in the glass. The HUD's Menu sits beside the hand, with an Esc key cap on a wide
screen and none on a phone. On a phone the banner's own menu button (`engine/ui/frame/`) reads Boards, so the two
worlds do not both have a button called Menu. Task 9: the Turn modal opened from My characters leaves the menu bar
in view, dimmed and inert, and Close and Esc return to My characters. **Tests first,** added to Task 3's: the banner
holds no Sign out; the phone's banner button and the HUD's Menu have different accessible names.

**Amended 2026-10-30, after the boards' audit** (`docs/plans/2026-10-30-glass-to-the-boards-plan.md`). That plan
says how a build is shown to match its board and wins over the glass amendments above where they differ. Task 0 runs
its board match (`web/e2e/boards.spec.ts`) and asserts the fake backend is absent from the production bundle. Task 1
takes its closed token list, its shapes, the smoke as a recipe per surface (`GlassTheme.smoke` becomes recipes and
surfaces) with the guard's new poisons, and the comparator `web/e2e/board-match.ts` with its self-test. Task 2 takes
its fixture, `web/src/data/fixtures/boards.ts`, and the boards' moments. Tasks 3, 5, 6 and 8 to 12 each add the
manifests of the boards they build, as its section 10 lists, and are not done until those are green.

**Amended 2026-10-30, after PR #24 merged.** PR #24 built this plan's tasks except Task 8; the glass amendments
above are built onto it in the order, and at the paths, of `docs/plans/2026-10-30-glass-build-plan.md`, which wins
where they differ. Task 8 waits on issue #25's design.

**Amended 2026-10-30, after issue #25's design.** Task 8 is built by `docs/plans/2026-10-30-log-shares-plan.md`
(Tasks 4 and 5), which adds the expansion of a settled line into its posts and wins where it differs.

The mockups each screen follows are in `docs/research/2026-10-29-screens/`; the design's sections say what was decided
and why. Where a mockup and the design disagree, the design wins. impeccable is installed (`.claude/skills/impeccable/`)
with its product record (`PRODUCT.md`); a builder runs `.claude/skills/impeccable/scripts/impeccable context` once, then
works from the brief below, and reads its `reference/craft-floor.md` before UI edits, as its skill says.

## The brief (impeccable's `shape`, confirmed by the owner)

1. **Job and audience.** The MFGG and Minus World cast, each playing several masks, on phones and desktops. The surface
   is the forum: reading, posting, reacting, playing postcards, checking their own math. The forum is Operate mode
   (precision and restraint; brand in the details); the game pieces (orbs, Vending Machine, Stick Around, Whoops!) are
   Experience mode, toys built with full commitment.
2. **Outcome and proof.** A player always knows who they are posting as and what they hold (the HUD); reads and answers
   a thread without leaving it; sees how their characters are doing in plain words (the log); plays a card that lands as
   a riposte; and the masks hold throughout.
3. **Selected direction.** A 2003 BBCode board that is secretly a game screen: Verdana and bold Courier New; black and
   white in light and dark; 1px rules and tables. Color only on game pieces: the six TTYD orbs and their ghost fill,
   rank pips, reaction chips, the drawn Vending Machine, Stick Around's gold frame, Whoops!'s ink. The focal moment is the
   HUD docked at the bottom. The game pieces carry the motion (the orb cascade, the rubber-band pull, soap suds, a card
   dropping into the tray). The forum's chrome leans still as a contrast with them, not as a rule: layout transitions
   and animations are used where the experience calls for them (a new post sliding in arrives with motion by its
   nature) and never for their own sake. A modal or a sheet is used where it is the best experience.
4. **Scope.** Every screen of the core-loop design's section 11 at production quality (this plan and the cards plan).
   Anti-goals: no modern-SaaS look (soft-shadowed cards, rounded pills), no color on the forum chrome, no motion that
   delays reading, nothing that hints at who owns what.
5. **States and ranges.** Posts up to 20,000 characters; threads from 1 to thousands of posts, 20 to a page; 1 to 6
   characters; ranks 0 to 6 pips; a wallet 0 to 6.00; a hand 0 to many; Whoops! stacked to 3. Empty states: a new player
   with no character, a board with no threads, a log before the first settlement, a season with no record. Refusals in
   plain words.
6. **Interaction and layout.** Percentages throughout. The postbit side by side on a desktop and stacked on a phone, a
   reader setting choosing on a desktop; reaction picker and hand as bottom sheets on a phone; live posts slide in only
   at the bottom, otherwise a "3 new posts" bar; every game effect has a keyboard and screen-reader path of equal cost;
   modals hold focus, close on Esc, return focus.
7. **Constraints and open decisions.** WCAG 2.2 AA for the forum; tokens and stable class names so a theme is a CSS
   file; the engine's screens never name an instance. Not for the builder to invent: the Vending Machine's name, rank
   names, card art, pip styles beyond the default, quadrant labels, Stick Around's touch tuning. Each is a placeholder
   the instance holds until the owner gives it.

## The layout, and which layer each part is

| Path | Layer | Holds |
|---|---|---|
| `engine/ui/` | engine | KayfaBB's React screens and components, its token names and base CSS, the BBCode renderer, the card-effect interface. Imports `engine/rules/` and `engine/bbcode/`, never an instance |
| `instances/divided-world/ui/` | instance | The house theme (light and dark token values), copy, rank and class looks, quadrant labels, pip images, the words each ledger reason is shown in. Implements `engine/ui/`'s `InstanceUi` |
| `web/` | composition root | The Vite app: routes, the Supabase client and data adapter, the one place `engine/ui/` and an instance's `ui/` meet |

The instance's look and words reach the engine's screens through one interface, `InstanceUi` (Task 1), beside the
engine's `Instance`. A Supabase client lives only in `web/src/data/` ("Portable by construction").

## Tasks

### Task 0. The toolchain, and the boundary guard over the new layers

- `package.json`: Vite, React, TypeScript (`jsx: react-jsx`), Motion, Storybook (React and Vite, with `@storybook/addon-a11y`),
  Vitest with Testing Library and jsdom, `axe-core`, `@supabase/supabase-js`. Scripts: `dev:web`, `build:web`
  (`vite build web`), `test:ui` (Vitest over `engine/ui/`, `instances/*/ui/`, `web/`), `storybook`, `test:e2e`
  (Playwright against `vite preview` with the fake backend of Task 2; it uses the browser the environment provides and
  never runs `playwright install` in a session).
- `tools/build.mjs`: `npm run test:ui` and `npm run build:web` into `STEPS`; `test:e2e` stays outside the build
  (`OUTSIDE_THE_BUILD`, with the reason: it needs a browser) and runs in a new `.github/workflows/web.yml`.
- `tools/check-engine-boundary.mjs` and its test: `.tsx` files and CSS `@import`/`url()` are read too; `engine/ui/`
  never reaches `instances/`; `instances/*/ui/` reaches no other instance.
- **Poisons:** an `engine/ui/` component importing `instances/divided-world/ui/theme.css`; the same through a `.tsx`
  re-export; a CSS `@import` from `engine/ui/` into an instance.

### Task 1. Tokens, the house theme, and `InstanceUi`

- `engine/ui/tokens.css`: the token names (`--kb-fg`, `--kb-bg`, `--kb-rule`, `--kb-muted`, `--kb-font-body`,
  `--kb-font-mono`, `--kb-orb-1` to `--kb-orb-6`, `--kb-pip`, `--kb-sweet`, …) with no values a theme must not set;
  `engine/ui/base.css`: the 2003 layout on those tokens, with stable `kb-` class names for every screen part.
- `engine/ui/types.ts`: `InstanceUi`: `theme` (a stylesheet with light and dark), `quadrantLabels`, `classLooks` (a
  color or pattern per class for the reveal's bar), `reasonWords` (a ledger reason and its details to a plain sentence),
  `copy` (out-of-character strings the engine's screens need), and the pip images.
- `instances/divided-world/ui/theme.css` and `index.ts`: the house theme, from the design's section 12 and the mockups;
  placeholders where the owner has not named a thing.
- New guard `tools/check-ui-tokens.mjs` with `tools/test-ui-tokens.mjs`: no color, font family or border color literal
  in `engine/ui/` outside `tokens.css`. Into `STEPS`, test first.
- Theme choice: the device's light or dark, with the account's override (the engine plan's `account_preferences`).
- **Poisons:** a `#fff` in an `engine/ui/` component's style; a `font-family: Arial` in `base.css`.

### Task 2. The data layer, sign-in and live updates

- `web/src/data/api.ts`: one interface, `KayfaApi`, for every read and action the screens make: public views
  (`acts_public`, `characters_public`, `thread_view_counts`, `season_standings`, `character_profiles`, reaction
  tallies, standings), the player's own rows (`my_cards`, wallet, `my_reactions`, `my_pending_turns`, `reading`,
  preferences, `effect_releases`), the `act`, `account`, `estimate` and `avatar` functions, and the thread's and
  board's channels.
- `web/src/data/supabase.ts`: the adapter; `web/src/data/fake.ts`: an in-memory backend the stories, unit tests and
  e2e tests use, holding the same invariants the server refuses in the same words.
- New guard `tools/check-web-reads.mjs` with `tools/test-web-reads.mjs`: the web app reads only the tables and views in
  an allowlist of public projections and own-row views; it never names `characters`, `class_history`, `reactions`,
  `ledger`, `wallet_events`, `effect_state`'s writes, or any other private table. Into `STEPS`, test first.
- Sign-in, sign-up and reset go through the `account` function only, never Auth's own endpoints (issue #3 stays open).
- **Poisons:** `.from('reactions')`; `.from('class_history')`; `.from('characters').select('owner')`.

### Task 3. The frame, the HUD and the orbs

- `engine/ui/frame/`: the banner and links (a Menu button on a phone), the HUD docked at the bottom: avatar, the
  quick-swap select (the HUD's character, kept per device and per account), the orbs, the hand button (the cards plan
  fills the drawer).
- `engine/ui/orbs/`: six rings in the instance's colors; the solid fill from the settled wallet; the ghost from the
  estimate (hatched gain, pale band for loss, "+0.40 past the cap"); the cascade at a settlement (one orb a second, a
  flash and a shine on each that fills), from the owner's TTYD pen as the design describes; reduced motion shows the end
  state. An accessible name: "Wallet 2.40 of 6 orbs, 0.85 pending until the next settlement (estimate)".
- The estimate is fetched on load and again, debounced, when a tally broadcast lands on one of the player's own Acts.
- **Tests first:** hundredths to six fills for 0, 2.40, 6.00 and 6.40 settled-plus-pending; a loss shown as a pale band
  over solid fill; the accessible name; the cascade's order and timing; no animation under reduced motion.

### Task 4. The index and the thread list

- `engine/ui/index/` and `engine/ui/board/`: the index (the ordinary board and The System's, read-only noted); the
  thread list: NEW from the player's reading rows, HOT (replies this week, a new instance setting `hotReplies`),
  replies, hourly views, square avatars beside "started by" and "last post", pages and "first unread", "↳ spun from";
  stacked cards on a phone; a new-thread form above the list (none on The System's board).
- **Tests first:** NEW from a reading row behind the last post; no NEW when caught up; the System's board shows no
  form; a list of 0, 1 and 200 threads; the phone layout at 320px wide with no horizontal scroll.

### Task 5. The thread

- `engine/ui/thread/`: pages of 20 with `?page=N#post-M` permalinks (no HUD character in any URL); "Continue to page N"
  loads in place and updates the address; "Jump to latest"; `mark_read` as posts come into view, debounced.
- `engine/ui/postbit/`: side by side (tall avatar) and stacked (square avatar), by the reader's preference, always
  stacked on a phone; the square in the tall slot when there is no portrait; title, rank and pips from the instance's
  ranks and the character's pip style, posts, "Joined Oct 2026" (the month only), the signature.
- Live updates: a new post slides in at the bottom; reading higher up, a "3 new posts" bar above the HUD; on an earlier
  page, "3 new posts on page 7"; tallies and edits update in place; an `aria-live` region announces new posts only.
- **Tests first:** a permalink to post 142 opens page 8 at it; the bar appears when reading higher up and the post
  slides in at the bottom; reduced motion inserts without sliding; the announcer says each new post once and no
  reaction; `mark_read` never sends a lower seq.

### Task 6. Reactions

- `engine/ui/reactions/`: chips with counts, the player's own outlined; the 2×2 picker (heat top-left, hype top-right,
  groan bottom-left, calm bottom-right; labels from `InstanceUi`), arrow keys through the grid, each button named by its
  emoji's name and quadrant; "2 of 3 left" across the player's characters from `my_reactions`; no React button on the
  player's own characters' posts; a bottom sheet above the HUD on a phone. Refusals in the server's words.
- **Tests first:** the fourth kind is not offered; a post by another of the player's characters shows no button; the
  picker's keyboard path; the counts converge when tally broadcasts arrive twice or out of order (keep each kind's
  largest).

### Task 7. Writing, editing, spinning

- `engine/ui/bbcode/render.tsx`: the renderer for `engine/bbcode/parse.ts`' tree, including a quote of an Act.
- `engine/ui/composer/`: the quick reply at the foot of the thread, a toolbar, an in-place preview; it names the HUD's
  character in bold and, when the HUD's character changes with a draft open, says "now posting as …" and needs the send
  pressed again; Quote appends `[quote=…]` and moves focus to the box; the draft is kept per thread on the device.
- Editing: "Last edited" from `shown_edited_at`; a History link listing every version, to everyone.
- `engine/ui/spin/`: the Spin thread link on every Act, its small form, the ORIGIN box (a live view of the Act, its
  effects included, linking back), and "↳ Spun into: …" under an origin.
- **Tests first:** a character swap mid-draft blocks the send until confirmed; the preview equals the posted render; an
  edit inside the grace period shows no "Last edited" and is in the History; the ORIGIN box shows an edit made to its
  Act after the spin.

### Task 8. The log

- `engine/ui/log/`: the open window first, its lines in italics, from the estimate ("up to +0.10, before the shared
  vote and halving"); then each settlement with its total and one line per reason from `reasonWords`, each expandable to
  its Acts; a filter by character; each line linking its Act; the wallet's floor, cap and overflow said plainly; stacked
  entries on a phone. Out of character and true ("The fiction may lie; the log never does"): it names which Act, which
  quadrant and how much, never who reacted.
- **Tests first:** the estimate's lines are labeled as estimates; a settled reason expands to its Acts; overflow past the
  cap is said; the empty state before the first settlement.

### Task 9. Characters and Turns

- `engine/ui/characters/`: My characters (class marked "only you", standing and pips, the Turn button or the date it
  opens, a pending Turn with Change and Withdraw, a new character "waiting to debut at tonight's settlement"); New character with the class cards (each class's description from the instance);
  a full roster's plain note that an admin can retire a character on request.
- The Turn modal: the class, how loud, the preview of what everyone will see ("Pipewrench has Turned", or with the old
  class, as it will read in The System's tally), "takes effect at the next settlement"; focus held, Esc closes, focus
  returned.
- `engine/ui/profile-edit/`: title, signature, pip style (the default only, in the slice), and the avatar cropper: one
  image, two frames (square; portrait up to 1:2, the square defaulting to its top), re-encoded in the browser to WebP
  with nothing but pixels, sent to the `avatar` function.
- **Tests first:** the modal's focus trap and return; a pending Turn changed and withdrawn; a new character shown as
  waiting to debut and absent from every public list; the cropper refuses a portrait frame
  taller than 2:1; the re-encoded file carries no EXIF chunk.

### Task 10. The profile, the standings and the reveal

- `engine/ui/profile/`: the public profile (tall avatar, title, rank, exact standing and when settled, place, counts,
  the month joined, signature); the public record's latest rows and a full view, paged and filtered by kind.
- `engine/ui/standings/`: the season's standings from `season_standings`.
- The tally: The System's Act each settlement naming the night's debuts and announced Turns, on its board.
- The reveal thread: each character's post with place, rank, standing, a bar of its classes in `classLooks`, every Turn
  listed; reactable and spinnable like any Act.
- **Tests first:** the profile shows no class except one announced with a revealed Turn; a character with no Act and no
  settlement is in no list; the public record pages; the reveal bar's accessible description lists each class and its
  dates.

### Task 11. Out of character: registration, sign-in, invites, settings

- `engine/ui/account/`: registration (an invite field while the instance is invite-only; the 18+ acknowledgement) and
  passwordless sign-in (request a code or link by email, then enter the code), in the plain words of `account`'s
  answers, the same for every address.
- Invites: make one (a link to copy), the cap and expiry said plainly, reissue.
- Settings: theme (device, light, dark, and the instance's themes), postbit style, motion (device, reduce, full), sign
  out; all saved to the account.
- **Tests first:** the screens render the same words for an address with an account and without; the cap is said before
  it is hit; each preference persists across a fresh load.

### Task 12. Accessibility, audit, and the site

- The a11y test: every Storybook story renders with no axe violation at AA (`engine/ui/a11y.test.tsx`), with a
  self-test (`engine/ui/a11y.selftest.test.tsx`) that runs the same function on a poisoned story (an unlabeled button, a
  low-contrast text) and expects it to fail. Keyboard e2e for the core flows: read a thread, react, reply, spin, Turn.
- Run `.claude/skills/impeccable/scripts/impeccable detect --json` over the changed UI once it is finished, and
  impeccable's `audit` over each screen; fix what they find inside the brief, and list what is left under `Follow-ups`.
- `netlify.toml`: the static build of `web/` with its single-page fallback, and the public Supabase URL and key as the
  only build environment.
- **Poisons:** the a11y self-test above; a story with `outline: none` on a focused control.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A draft whose HUD character changed | Send again to confirm, or swap back |
| The Turn modal | Cancel, Esc, or confirm |
| A pending Turn | Change or withdraw it on My characters; or the settlement applies it |
| A character waiting to debut | The next settlement |
| A "3 new posts" bar | Click it, or read on; it never moves the page by itself |
| A full roster | The plain note: an admin retires a character on request |
| A glass page | Back to the board or Esc, to the post the player left |
| A glass overlay | Esc or its close, onto what it was opened over, focus returned |
| The settlement's summary | Open my log, or Back to the board; it does not show again for that settlement |
| Smoke off, high contrast, or text at 200% | Settings, where each is changed back |

## What could vary with a private fact, and how it does not

- The web app reads only public projections and the player's own rows (Task 2's guard).
- The quick-swap is the player's own device and session; nothing is broadcast when it changes, and no URL carries it.
- The React button's absence on a player's own characters' posts is shown only to that player, who knows.
- Reading marks, the estimate, preferences and releases are the player's own requests and are never broadcast.
- Account screens say the same words for every address.
- Rankings reads `season_standings` and `class_reveals`, which are public, and the player's own rows; its marks are
  drawn on the player's own screen, and its order and counts are the public standings'. Its requests are the same for
  every player apart from the own-row read.
- The glass sends nothing anyone else can see: entering it, the page open, the board position kept for Back, the
  settlement's summary seen and the three new preferences are the player's own, never broadcast.

## Review focus

- A thread of thousands of posts: render cost per page, and a live storm of tallies on a busy page.
- The estimate's fetch rate when a player's posts are reacted to constantly.
- A theme stylesheet's reach: whether any screen part a game effect needs (the HUD, a splat's canvas) can be hidden by a
  token or class a theme sets.
- Any URL, share link or `Referer` that carries the HUD's character or the player's other characters.
- The cropper's re-encoding on a phone: a large photo, an orientation tag, memory.
- The smoke's drawing cost behind a long glass page on a phone, and the battery under full motion.
- The calm at 200% text and in one column: whether a backing sized by its block covers every glyph when the block
  wraps, and whether the feather stays outside the text.
- The glyph measurement trusting the canvas's metrics: a fallback face loaded in place of the instance's would pass or
  fail for the wrong reason.
- The seam: a board theme reaching across into the HUD or an overlay's frame.
- Back to the board on a thread that grew, or a post that was edited or splatted, while the player was in the glass.
