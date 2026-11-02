# Onboarding: the plan

Record, written 2026-11-02. Carries out `docs/plans/2026-11-02-onboarding-design.md` (cited here as "the design"),
task by task. Each task writes its tests first and shows their red run, and every task is reviewed for the spec and
for quality (`.claude/skills/build-session/SKILL.md`). The boards are `docs/research/2026-11-02-onboarding/`; a screen
is built to its board.

The copy every task adds in Gabe's voice (the welcome letter, the guide, the tips, the class hints) is drafted by the
build and approved by the owner in its PR (CLAUDE.md, "The fiction may lie; the log never does", as the design's
section 9 rewords it). It says nothing untrue and nothing hidden.

**Order.** Tasks 1 to 10 build in order. Task 11, the starting grant, waits until Autocorrect (#150) has been designed
and built, since the grant names it; a build session that reaches Task 11 first stops there and says so.

## The layers

- **Engine** (`engine/`, `supabase/`): the welcome and guide screens and their routes; the guide's Markdown renderer
  and its markers; the tips (their state, the spotlight, the pacing, the tour's mechanics); the starting grant's
  setting, its check and its SQL; the debut default.
- **Instance** (`instances/divided-world/`): every word of Gabe's (the letter, the guide's Markdown, the tips' copy,
  the class hints); Gabe's avatar; the starter pairings; Feelin' Fab, its rules and its effect.
- **The interfaces** that carry the instance's content in: `InstanceUi.onboarding` (Task 4: the letter, each tip's
  title and line, keyed by the engine's tip keys), `InstanceUi.guide` (Task 8: the Markdown and the hints), and
  `Settings.startingGrant` (Task 11). Each has a check that the instance fills it exactly: no tip key, class or marker
  missing, none extra.

## The masks, for every task

- The welcome mark, the tips' state and the cards met are the player's own `account_preferences` row: read by its own
  account alone (0019's policy), never broadcast, never in any answer to another account.
- The grant writes the player's own wallet and hand, which nobody else reads. Its card is an ordinary common one, so
  playing it says nothing about its player.
- A tip's trigger is on the player's own screen, so another player cannot cause one and watch for it.
- Nothing here reads a class, an owner or a reactor for anyone but the caller.

## Task 1: "Drop now" is the default debut

- **Files:** `engine/ui/characters/NewCharacter.tsx` (`useState<DebutTiming>('tally')` becomes `'now'`); a migration
  `supabase/migrations/0066_debut_now.sql` that makes `create_character`'s `timing` default `'now'` (0028's
  `create or replace`, same signature and grants), with `supabase/tests/0066-debut-now.sql`.
- **Tests first:** `NewCharacter.test.tsx`: the form opens with Drop now chosen and announced; a character made
  without touching the timing can post at once. The SQL test: `create_character(name, class)` called with no timing
  makes a character with `debuted_at` set.
- **Copy:** the debut preview's words follow the new default (`engine/ui/characters/previews.ts`).

## Task 2: Gabe's face

- **Files:** `instances/divided-world/ui/avatars/gabe.png`, made from
  `docs/research/2026-11-02-onboarding/assets/gabe-sprite.gif` exactly as `assets/gabe-avatar.png` was (crop 210 by 210
  at 32,2; scale 2x nearest-neighbor; violet matte `#2a1a4a`), replacing `gabe.svg` in
  `instances/divided-world/ui/index.ts`'s `avatars`. The engine draws a persona's avatar with
  `image-rendering: pixelated` wherever it draws one (the Updates page today; the welcome, the guide and the tips
  after Tasks 4 to 8).
- **Tests first:** the Updates page's test reads Gabe's avatar as an image with the instance's URL; a story shows it.

## Task 3: The tips' state on the account

- **Files:** migration `0067_tips.sql`: `account_preferences` gains `welcomed_at timestamptz`, `tips text not null
  default 'on' check (tips in ('on', 'off'))` and `tips_seen text[] not null default '{}'` (bounded like `cards_met`,
  each key `^[a-z][a-z0-9-]{0,39}$`). RPCs, each the caller's own row, answering the whole preferences as
  `set_preferences` does:
  - `see_welcome()`: sets `welcomed_at` once; a second call leaves it.
  - `see_tip(key)`: adds one key, once.
  - `skip_tips()`: `tips = 'off'`.
  - `restore_tips()`: `tips = 'on'`, `tips_seen = '{}'`, `cards_met = '{}'`.
  - `replay_tour()`: removes the tour's keys from `tips_seen` and turns tips on.
  `forget_cards_met` (0040) stays as an alias of `restore_tips` for the Settings row until Task 9 replaces the row,
  then is dropped in the same task's migration. `supabase/tests/0067-tips.sql`.
- **API:** `Preferences` gains `welcomedAt`, `tips`, `tipsSeen` (`engine/ui/data/api.ts`), with `seeWelcome`, `seeTip`,
  `skipTips`, `restoreTips`, `replayTour` on `KayfaApi`, in the fake (`engine/ui/data/fake.ts`) and the adapter
  (`web/src/data/supabase.ts`).
- **Tests first:** the SQL test calls each RPC as one account and reads another's row unchanged; a key that is not a
  key is refused in plain words; the bound holds. The export round-trip (`supabase/tests/e2e/0003-export.ts`) sets the
  three columns and gets them back.
- **Way out:** every state here is undone by an RPC the Settings row calls (Task 9).

## Task 4: The tips' frame: keys, copy, pacing and the spotlight

- **Engine files:** `engine/ui/tips/keys.ts` (the tip keys the engine knows: `tour-plate`, `tour-orbs`, `tour-hand`,
  `grid`, `ghost`, `first-card`), `engine/ui/tips/Tips.tsx` (a `TipsProvider` beside `CalloutProvider`, holding the
  page's one tip), `engine/ui/tips/Spotlight.tsx` and `tips.css`.
  - **The spotlight:** a fixed layer over the whole page (the board and the HUD), `rgba(3,2,8,.72)` with
    `backdrop-filter: blur(6px)`, clipped by an even-odd path with the target's rectangle cut out, and a cyan ring
    round the cut-out. It follows the target on scroll and resize. Gabe's panel is a `role="dialog"` with
    `aria-modal`, labeled by its title; focus starts on Got it, Tab stays inside, Escape is Skip all tips. It fades in
    (Motion); under reduced motion it appears, and the cut-out jumps between steps. At the glass's phone width the panel
    docks as a sheet above the HUD (`04-phone.html`); otherwise it sits beside the cut-out with a pointer.
  - **Pacing:** one tip a page load; none while focus is in a text field or a contenteditable; none while the screen is
    held by a game effect. The engine adds a held-screen signal a takeover sets while it holds (`EffectProps` gains it;
    Stick Around's effect, `instances/divided-world/ui/stick-around/Effect.tsx`, sets it while it holds the reader). A
    tip that cannot show waits for the next load.
  - **State:** a tip shows only when `tips` is on and its key is not in `tipsSeen`. Got it calls `seeTip`. Skip all
    tips calls `skipTips`, and nothing shows again until `restoreTips`.
  - **The callouts join:** `engine/ui/cards/Callout.tsx` shows nothing while `tips` is off, and the page's one-tip
    budget is shared with it, a spotlight first.
- **Instance files:** `InstanceUi.onboarding` (`engine/ui/types.ts`): `tips: Record<TipKey, { title, line }>` and
  `letter` (Task 7), filled in `instances/divided-world/ui/onboarding.ts`.
- **A check:** `instanceUiProblems` (beside `instanceProblems`) refuses an instance whose `tips` misses a key or has an
  extra one. Its self-test plants a missing key and an extra key and sees each refused.
- **Tests first:** `Tips.test.tsx`: two tips wanted on one load show one; a tip wanted while a textarea has focus waits;
  a tip wanted while the held-screen signal is set waits; Skip all tips stops every later tip and the callouts; Escape is
  Skip; focus is trapped and returned; with tips off nothing shows. An axe check on the spotlight (`engine/ui/a11y.ts`).
  A board story of each step.

## Task 5: The HUD tour

- **Files:** `engine/ui/frame/Hud.tsx` marks its three targets (the plate, the orbs, the Hand button) for the tour;
  `engine/ui/tips/tour.ts` sequences `tour-plate`, `tour-orbs`, `tour-hand`, each "N of 3".
- **When:** on a board page, once the account has a character and `welcomedAt` is set, while any tour key is unseen. A
  page load that cannot show it (pacing) tries on the next.
- **Tests first:** a world with a new account and one character shows step 1 on its first board page, Got it moves to
  2 then 3, and a reload after step 2 resumes at 3; Skip at step 1 ends it and every later tip; reduced motion jumps.

## Task 6: The two tips in play, and the first card's line

- **Files:** `engine/ui/reactions/Picker.tsx` asks for `grid` when it opens; the HUD's orbs ask for `ghost` the first time
  an estimate shows on them (`Hud.tsx`); `engine/ui/cards/Callout.tsx` adds the `first-card` line ("the mark opens the
  Lens", in the instance's words) to the first callout a player ever sees, and marks `first-card` seen with it.
- **Tests first:** opening the picker for the first time shows the grid tip with the picker in the cut-out, and not
  the second time; the first estimate shows the ghost tip; the first callout carries the extra line and the second
  does not; none shows with tips off.

## Task 7: The welcome page

- **Files:** `engine/ui/welcome/Welcome.tsx` and `welcome.css`, at `/welcome`, a glass page on the `settings` surface
  (`web/src/App.tsx`'s `ROUTES` and `GLASS`). Gabe's header and letter (`InstanceUi.onboarding.letter`, the instance's
  Markdown through Task 8's renderer), Before you start (theme, motion and text size: the Settings rows' own
  components, lifted from `engine/ui/account/Settings.tsx` so both draw one control), Make your first character
  (`/characters/new`) and Read the Strategy Guide first (`/guide`).
- **When:** the session listener sends a signed-in account with no `welcomedAt` and no character to `/welcome` from
  any board page (the sign-in pages and the glass pages are let through). The page calls `seeWelcome` when it opens,
  so it shows once whatever the player does next.
- **Tests first:** a new account lands on `/welcome` after `openAccount`; changing motion there changes the account's
  preferences; the button opens New character; a second visit to the board goes nowhere; an account with a character
  is never sent there. Board story against `01-welcome.html` and `04-phone.html`.
- **Way out:** the button, the menu's Back to the board, and every tab.

## Task 8: The Strategy Guide

- **Engine files:** `engine/ui/guide/markdown.ts`, a small Markdown renderer for trusted instance prose (headings,
  paragraphs, bold, italic, lists, tables, links, block quotes; no raw HTML), with its markers:
  - `<!-- kayfabb:letter -->` (the welcome letter, so it is written once);
  - `<!-- kayfabb:reactions -->` (the instance's reaction grid);
  - `<!-- kayfabb:classes -->` (each class: its color chip, the class card's own grid marks from `ClassCards.tsx`,
    its description, and its hint);
  - `<!-- kayfabb:cards -->` (each card: name, rarity, flavor, play, and price from the economy settings);
  - `{{setting:<path>}}` (a number from the live settings, formatted as the HUD formats Aura).
  `engine/ui/guide/Guide.tsx` and `guide.css` at `/guide`, a glass page; contents that stay in view and mark the section
  on screen; each section has an anchor; on a phone the contents are a menu. The menu bar gains Guide
  (`engine/ui/glass/MenuBar.tsx`, `engine/ui/glass/nav.ts`).
- **Instance files:** `instances/divided-world/guide/strategy-guide.md`, from the draft at commit `ca64ab9` (read it
  with `git show ca64ab9:instances/divided-world/guide/strategy-guide.md`), rewritten in Gabe's voice and trimmed to the
  surface as the design's section 8 lists; its numbers become markers. `instances/divided-world/guide/hints.ts`: one
  hint per class. `InstanceUi.guide` carries both.
- **A check:** `tools/check-guide.mjs` with `tools/test-check-guide.mjs`, added to `STEPS` in `tools/build.mjs`. It
  refuses: a hint map whose keys are not exactly the instance's classes; a marker the engine does not know; a
  `{{setting:...}}` path the settings do not have; a bare number in the prose next to a word the settings name (a
  heuristic for a retyped setting: "6.00 orbs", "30 days"). Its self-test plants each one and sees it refused.
- **Tests first:** `markdown.test.ts` (each construct; raw HTML shown as text; a marker resolved); `Guide.test.tsx`
  (the classes section shows each class's description from the class entry and its hint; the Face's grid marks
  excited-positive earns and bored-negative hurts; a settings override changes the number on the page; the contents mark
  the section in view). Board stories against `02-guide.html` and the phone.

## Task 9: Settings › Accessibility › Tips

- **Files:** `engine/ui/account/Settings.tsx`: the Card tips row becomes **Tips**: a switch (on calls `restoreTips`
  without forgetting, off calls `skipTips`), Show tips again (`restoreTips`), Replay the HUD tour (`replayTour`). The
  migration that drops `forget_cards_met` (`0068_tips_settings.sql`), with its test.
- **Tests first:** each control calls its RPC and the next board page behaves so; the row's words are plain.

## Task 10: Feelin' Fab

- **Instance files:** `instances/divided-world/cards/feelin-fab.ts` (`key: 'feelin-fab'`, `name: "Feelin' Fab"`,
  `alignment: 'sweet'`, `rarity: 'common'`, `reaches: ['post']`, `stack: 3`, no `lasts`, `priceKey: 'feelinFab.price'`,
  `playPrice: () => 0`), in `cards/index.ts`; `'feelinFab.price': 20` in `settings.ts`, below Bluff's 25; its `CardUi`
  in `ui/cards.ts` (mark, hint, Vending art); `ui/feelin-fab/Effect.tsx` and `fab.css`.
- **The effect,** by the count of Feelin' Fabs up on the post (1 to 3), drawn under the post's text, which keeps a text
  shadow:
  1. the background cycles through the rainbow's stops, slowly; a few twinkles at random spots;
  2. an animated linear rainbow, more twinkles;
  3. an animated radial rainbow.
  Under reduced motion: level 1 a random stop chosen on each load in the reader's own browser; levels 2 and 3 still
  gradients; twinkles still. Animation runs only while the post is in view (one `IntersectionObserver` per page), as an
  animated `background-position` or a registered custom property, never layout.
- **Contrast:** two palettes, one per board theme (pastels under black text, deep under white), each stop held at
  4.5:1 against the theme's post text by a test through `engine/ui/contrast.ts`.
- **Tests first:** `cards.test.ts` (the rules: a fourth refused in plain words, lands only on a post, costs its price);
  `Effect.test.tsx` (each level's class and stops; reduced motion holds still; level 1's reduced color is one of the
  stops; out of view stops the animation); the contrast test for every stop in both themes, driven red once with a stop
  that fails. A board story of the three levels in both themes and reduced.
- **Way out:** none needed; the post is readable under every level (the design's section 11).

## Task 11: The starting grant (after #150)

- **Engine files:** `Settings.startingGrant: { readonly aura: number; readonly cards: Readonly<Record<string, string>> }`
  (`engine/rules/types.ts`); `settingsProblems`/`instanceProblems` (`engine/rules/instance.ts`) refuse a grant whose
  `cards` misses one of the instance's classes, names a class it lacks, or names a card that is not in its cards or is
  not common, and an `aura` that is negative or past `walletCap`. A migration `0069_starting_grant.sql`:
  - `wallet_events.kind` gains `'grant'`; `card_ledger.kind` gains `'granted'` (price 0, no Act), and `my_cards` counts it
    as held;
  - a table `account_grants (account uuid primary key references accounts (id), at timestamptz not null default now())`,
    so a grant is given once whatever a retry or a racing second character does;
  - `create_character` (0028's, same signature): when the caller has no `account_grants` row, insert it, credit
    `startingGrant.aura` to the wallet with a `'grant'` event (held to the cap like any credit), and add the class's
    card with a `'granted'` ledger row; all in the same transaction as the character.
- **The log:** `engine/ui/log/lines.ts` reads a `'grant'` wallet event and a `'granted'` card line as one row, "Welcome
  gift: +1.00 and a Feelin' Fab", in the instance's card name.
- **Instance:** `startingGrant: { aura: 100, cards: { heel: 'whoops', face: 'feelin-fab', technician: 'stick-around',
  jabroni: 'autocorrect', lurker: 'bluff' } }` in `settings.ts` (the keys as the cards define them).
- **Tests first:** the SQL test: a first character grants once; a second character grants nothing; two first
  characters made at once grant once; a wallet near the cap keeps the overflow rule; another account reads none of it.
  `instance.test.ts`: each refusal above, planted. `lines.test.tsx`: the grant's one line. The export round-trip carries
  `account_grants` and the new kinds.

## Review focus

- **Existing accounts:** the migrations run on an instance with accounts and characters. Every account that has a
  character must not be sent to `/welcome` (Task 7), must not be granted (Task 11), and must not see the HUD tour as if
  new (Task 5). Decide in review whether accounts made before Task 11 are marked granted by the migration.
- **The grant racing itself:** two first characters created at once, or a retry after a lost answer, must grant once;
  `account_grants`' key is the only guard, and the review should try to get past it.
- **Skip means all:** every path that shows something tip-like (a spotlight, a callout, a hint toast that reads as a
  tip) must check `tips`. The alerts design's pattern hints are alerts, not tips, and stay; the review confirms the line.
- **A page of Feelin' Fabs:** a thread with twenty animated posts must not drop frames while scrolling; measure it.
- **The spotlight over game effects:** the cut-out and the blur must never let a tip be used to see through a splat,
  a hold or any obstacle more cheaply than its accessible path ("An accessible path costs what the obstacle costs").
- **The guide's numbers:** after a settings override, the guide, the HUD and the Vending Machine must say the same
  number.
- **Gabe's copy:** it must not claim privacy the game does not give (admins), and must not reveal a deep mechanic the
  design's section 8 cut.
