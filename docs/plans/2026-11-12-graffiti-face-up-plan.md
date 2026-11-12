# Graffiti face up: plan

Record, written 2026-11-12. The plan for `docs/plans/2026-11-12-graffiti-face-up-design.md`, built in one PR from
`main`. Every task is test first: the test named, its red run recorded, then the code. No deployed database, bucket or
connector is touched. SQL is tested against Postgres on localhost.

**Migrations.** One migration and one SQL test file, each at the next free number when the task starts
(`0340_surface_face_up.sql` and `0291-surface-face-up.sql` on this date, after `0339_thread_places_at_scale.sql` and
`0290-log-shares-by-card.sql`). Take the next free numbers again before the PR is opened.

**The layers.** Tasks 1 to 4 are the engine's and name no card. Task 5 is Divided World's. Task 6 checks it all in a
browser.

## Task 1. A surface card is face up only (rules)

Model: inline

- `engine/rules/cards.ts`: `faceUpOnly`'s `Pick` gains `'surface'`, and it returns true for `rules.surface !==
  undefined`. Its header comment names surface cards, citing the design section 1. `decideSet`'s `firstDraw` call and its
  `draw` output are removed, along with `SetConditions.first` (`engine/rules/actions.ts` and wherever the type lives):
  no set carries a draw now.
- Tests first, in `engine/rules/cards.test.ts`: `faceUpOnly` is true for a card with only `surface`, and `decideSet` on
  such a card refuses with "<name> is cast face up and never set face down". Red before the change. Remove or rewrite
  any existing test that sets a surface card face down; say which in the task's report.

## Task 2. The server refuses it (SQL and the act function)

Model: sonnet

- `supabase/migrations/0340_surface_face_up.sql`, its header in the house shape (what it changes, ways out, privacy):
  1. `face_down_never_writes()` copied from its latest definition (`0153_drives.sql`, section 11) with `or k.surface` in
     the general branch's condition. The trigger itself is unchanged.
  2. `drop function set_surface_card(...)` with its full signature from `0317_surfaces.sql`.
  3. Nothing else: `face_down_draws`, `lay_sprung`'s draft branch and `take_back`'s draft delete stay for backs already
     set (the design, section 1).
- `supabase/functions/act/core.ts`: remove the `set_surface_card` entry (line ~107) and the `set.value.draw` branch
  (lines ~199-210). `decideSet` is called without `first`. Its test (`supabase/functions/act/*.test.ts`): a set of a
  surface card is refused in decideSet's words and calls no RPC.
- `supabase/tests/0291-surface-face-up.sql`, test first: inserting a `face_down` row for a surface card raises
  "... is cast face up and never set face down"; `set_surface_card` no longer exists; a back for a surface card already
  in `face_down` with its `face_down_draws` row (inserted directly, as a back set before 0340) still springs through
  `lay_sprung` with its draft written in and the draft row deleted, and is still taken back with its draft deleted.
  Red before the migration.
- `supabase/tests/0162-surfaces.sql`: its fixtures that call `set_surface_card` (around lines 537, 541 and 724) insert
  the `face_down` and `face_down_draws` rows directly instead, as line 732 already does, with the trigger disabled for
  the insert (`alter table face_down disable trigger face_down_never_writes` inside the test's transaction) and a comment
  that these stand for backs set before 0340. Its assertions are unchanged.
- `tools/` checks that compare migrations to SQL tests or list functions (the definer search-path test,
  `0002-definer-search-path.sql`) pass with the function dropped.

## Task 3. One ghost and no set compose (UI and data)

Model: sonnet

- `engine/ui/cards/PlayActions.tsx` `GhostMark`: the `cardUi?.Compose` branch draws one ghost, cast, named by
  `ghostName(rules.name, how, seq)`, offered where `casts` is true. No `mode` is passed.
- `engine/ui/cards/play.tsx`: `Composing.mode`, `openCompose`'s `mode` argument and `submitCompose`'s set path
  (`api.setCard(..., first)`, the `who` lookup for a set, the "Set ... face down" words) are removed. `dropCompose`
  compares card and post alone.
- `engine/ui/cards/types.ts` `ComposeProps.mode` is removed; `engine/ui/cards/Effects.tsx` stops passing it and drops
  `data-kb-compose`.
- `engine/ui/data/api.ts` `setCard` loses its `first` parameter, and so do `engine/ui/data/fake.ts` and the live client
  that sends it.
- Tests first, in `engine/ui/cards/play.test.tsx`: on one's own post an armed Compose card shows exactly one ghost
  (`getAllByRole('button', { name: /Graffiti|<the test card's name>/ })` has length 1), named "Play … on post N". Red
  against two ghosts today. The set-mode test (around line 1204) is removed, with the reason in the task's report.
- `instances/divided-world/cards/graffiti/Compose.tsx` and `Toolbar.tsx` lose `mode` and the "Set it" words; the
  button is always "Tag it". Their tests drop the set cases.

## Task 4. Playing: the post is picked, and it comes into view (engine)

Model: sonnet

- `engine/ui/cards/play.tsx`: `PlayControls` gains `playing: { readonly card: string; readonly seq: number } | null`,
  derived from `compose`. `openCompose` brings the post's body (`#post-<seq> .kb-act-main`) into view when its top is not
  on screen: `scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })`, with `reduced` read from
  `prefers-reduced-motion`, and with the top offset by the board's sticky chrome where the thread already accounts for
  it (`focusPost` shows how).
- `GhostMark` and `ReachGhost`: return null while `play.compose` is open on another target; the playing post's own ghost
  stays, `aria-pressed`.
- `engine/ui/cards/Hand.tsx`: a `playing` prop (`{ seq } | null`). While set, the armed card's tag reads
  "Playing · post #N" and its name ends ", playing on post N", in the fan and the phone sheet.
- `engine/ui/frame/Hud.tsx`: the peek's tag (line ~475) reads the same while playing; the Phone board's hand button reads
  "Playing · <card>" with the name "Playing · <card>, press to put it back". Pressing it, or the playing card in the hand,
  is `play.arm(null)`, which already asks first when the drawing holds work.
- Tests first: `engine/ui/cards/play.test.tsx` (opening a compose hides the ghost on another post and a reach ghost, and
  keeps its own, pressed; Esc ends the compose and the other ghost is back with the card still armed; landing the play
  clears the armed card); `engine/ui/frame/hand-modal.test.tsx` (the peek's tag says "Playing · post #N" while a compose
  is open, "Armed · pick a post" after Esc); a test that `openCompose` calls `scrollIntoView` on a post whose top is off
  screen and not on one in view, with `behavior: 'auto'` under reduced motion. Each red first.
- `engine/ui/cards/Hand.board.stories.tsx` gains a playing state beside the armed one.

## Task 5. The dock is fixed at every width (Divided World)

Model: sonnet

- `instances/divided-world/cards/graffiti/graffiti.css`: the rules now under `@media (max-width: 719px)` for
  `.kb-graffiti-dock` and `:root[data-kb-graffiti-dock] body` apply at every width. At 720px and wider the dock is the
  thread column's width and aligned with it (read the thread's column from `engine/ui/thread/thread.css`; take its
  variable if it has one, else `left`/`right` measured by the toolbar alongside `--kb-graffiti-dock-h`). The comment above
  the dock says why (the design, section 2). The fallback dock host (`.kb-graffiti-dockhost`) stays.
- `Toolbar.tsx`: `focusOnMount` focuses with `preventScroll: true`, so focus never scrolls the page away from the post.
- Tests first: `Toolbar.test.tsx` asserts the focus call passes `preventScroll`. The layout is checked in Task 6.

## Task 6. In a browser

Model: sonnet

- `e2e/graffiti.spec.ts`, at a 1280 × 800 viewport on a thread whose post is taller than the viewport: arming Graffiti
  shows one ghost on the player's own post; pressing it shows the dock in the viewport (its bounding box inside the
  window, above the HUD); the hand's peek says "Playing · post #N"; another post shows no ghost; Esc brings back
  "Armed · pick a post" and the other post's ghost. The same at a phone viewport. Run with `--trace off`.
- Screenshots of the wide and phone draw mode at deviceScaleFactor 2 go in the PR description.

## Review focus

- A Graffiti back set face down before 0340 on a deployed instance still springs and is still taken back: the spring
  and take-back paths must not have lost anything they read when `set_surface_card` was dropped.
- The dock fixed at the foot of a wide screen must not hide the post's last lines, the reactions row or the Lens: the
  page's foot padding has to follow the dock's measured height at every width.
- The ghosts hiding while playing must not hide them for a compose that has already ended (a compose dropped when its
  post leaves the page, an account switch): read `compose` as play.tsx reads it for the signed-in account.
- No Mod Bot path still sets a surface card face down: `supabase/functions/chatter/core.ts` calls `decideSet`, which now
  refuses, so its pick must fall through to a cast or to nothing without a crash or a paid model call wasted on a retry.
