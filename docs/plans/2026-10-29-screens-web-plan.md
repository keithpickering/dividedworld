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

## What could vary with a private fact, and how it does not

- The web app reads only public projections and the player's own rows (Task 2's guard).
- The quick-swap is the player's own device and session; nothing is broadcast when it changes, and no URL carries it.
- The React button's absence on a player's own characters' posts is shown only to that player, who knows.
- Reading marks, the estimate, preferences and releases are the player's own requests and are never broadcast.
- Account screens say the same words for every address.

## Review focus

- A thread of thousands of posts: render cost per page, and a live storm of tallies on a busy page.
- The estimate's fetch rate when a player's posts are reacted to constantly.
- A theme stylesheet's reach: whether any screen part a game effect needs (the HUD, a splat's canvas) can be hidden by a
  token or class a theme sets.
- Any URL, share link or `Referer` that carries the HUD's character or the player's other characters.
- The cropper's re-encoding on a phone: a large photo, an orientation tag, memory.
