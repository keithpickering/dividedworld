# Meta acts in the Marks' look: plan

Record, written 2026-11-06. The plan for `docs/plans/2026-11-06-meta-acts-design.md` (part of #206). One build session
builds it in one PR from `main`. The look is the mockups in `docs/research/2026-11-06-meta-acts/` that the owner chose
from: `02-size.html` at 2.25rem for the tile, and `03-date-bar.html`'s option 3 for the date bar. Where a mockup and the
design disagree, the design wins on what is decided and the mockup on how it looks.

Every task is test first: name the test, record its red run, then write the code. This plan adds no `check-*.mjs` and no
migration. Every part is engine; no instance file changes, and the engine names no instance
(`tools/check-engine-boundary.mjs`).

Phases 2 and 3 of `docs/plans/2026-11-04-glass-polish-plan.md` touch `engine/ui/thread/thread.css`. Merge `main` before
starting and again before opening the PR.

## Task 1: the tile (engine)

Model: sonnet

Files: new `engine/ui/glass/meta-tile.css`; `engine/ui/cards/marks.css`; `engine/ui/cards/Marks.tsx` (`Mark`, `More`);
`engine/ui/cards/PlayActions.tsx` (`GhostMark`, `ReachGhost`); new `e2e/meta-tiles.spec.ts`.

- `meta-tile.css` defines `--kb-meta-tile: 2.25rem` on `:root` and the class `.kb-meta-tile`. The class sets:
  `display: inline-flex`, centered, `box-sizing: border-box`, `height` and `min-width` of `var(--kb-meta-tile)`,
  `padding: 0 0.45rem`, the `--kb-glass-skew` skew, `border: 2px solid var(--kb-meta-line)`, `background:
  var(--kb-glass-field)`, `color: var(--kb-glass-text)`, and the body face at `--kb-glass-size-label` weight 800 with
  `line-height: 1`.
  - `.kb-meta-tile-in` sets the counter-skew for the upright contents (what `.kb-mark-in` does today).
  - The shared states, each written once (design, section 5):
    - `:hover` (not disabled): border `--kb-glass-text-hi` and background `color-mix(in srgb, var(--kb-meta-line) 18%,
      var(--kb-glass-field))`.
    - `:focus-visible`: the Marks' ring as `marks.css` has it today.
    - `[aria-disabled="true"]`: no hover and `cursor: default`.
    - The forced-colors block.
- `.kb-mark` becomes `.kb-mark.kb-meta-tile` (every mark, "+N" and both ghosts carry both classes).
  - `marks.css` keeps only what is a mark's: `--kb-meta-line` from the card's ink or alignment, the glow, the edge, the
    notch, the sign, `[aria-expanded]`, the ghost's dashes and the caught dimming.
  - `--kb-mark-size` goes. `.kb-mark-icon`, `.kb-mark-swatch` and `.kb-card-back` grow to 1.45rem.
  - A mark's hover border is its own line color brightened (`color-mix` of the line with `--kb-glass-text-hi`, 60%),
    not white, so it stays its card's.
  - The phone rule keeps its font size and does not shrink the tile.
- **Tests first** (red: a mark is 27px tall and does not answer a hover). In `e2e/meta-tiles.spec.ts`, at 1440 by 900 on
  `/?fixture=boards&moment=01-main`:
  - Every `.kb-mark` on the page is 36px tall, plus or minus 1.
  - Hovering the first mark changes its computed `borderTopColor` or `backgroundColor` (read as `e2e/glass-hover.spec.ts`
    reads a hover).
  - Then run `engine/ui/cards/marks.test.tsx` and `e2e/plays.spec.ts`, which must stay green.

## Task 2: the date bar and the strips beyond a post (engine)

Model: sonnet

Files: `engine/ui/thread/thread.css` (`.kb-act-meta`), `engine/ui/cards/marks.css` (`.kb-marks`, `.kb-marks-anchor`,
the `.kb-postbit-marks`, `.kb-thread-head-marks`, `.kb-board-banner-marks` and `.kb-thread-pin-mark` rules),
`engine/ui/spin/spin.css` (`.kb-origin-head`), `e2e/meta-tiles.spec.ts`.

- **The date bar** (design, section 2):
  - `.kb-act-meta { min-height: calc(var(--kb-meta-tile) - 0.4rem); align-items: center; }`, on every post kind.
  - `.kb-marks` is centered on its anchor (`top: 50%; transform: translateY(-50%)`), so a 36px tile overhangs a bar
    about 30px tall by about 3px each side.
  - The anchor stays out of the flow, and its measured width (`--kb-marks-width`) is unchanged.
- **The ORIGIN box's head** holds its strip the same way: `min-height` as the date bar's, the strip centered.
- **The thread head's and the board banner's strips** always reserve `var(--kb-meta-tile)`. The rule goes on the head
  and the banner, not on the strip, so arming a card or a play landing never makes either taller. Their strips are
  centered.
- **The pin mark** on the board's list takes `margin-block: calc((var(--kb-meta-tile) - 1lh) / -2)`, so it straddles
  its row and the row's height is its words'.
- **The postbit's strip** sits as it does (absolute, top right), and `.kb-postbit-name`'s inline-end padding becomes
  `calc(var(--kb-meta-tile) + 0.5rem)`.
- **Tests first** (red: hung strip, thin bar). In `e2e/meta-tiles.spec.ts`:
  - On `#post-41` (marks) and a post on the same page with none, the two `header.kb-act-meta` are the same height, at
    least 29px.
  - Each mark's top is no more than 4px above its bar's top and its bottom no more than 4px below its bar's bottom.
  - No mark's box intersects any client rect of the first line of words in its post's `.kb-act-main` (a `Range` over
    the body's first text node).
  - The thread head is as tall with a play on the thread as with none: open `Thread` in
    `engine/ui/cards/Reach.board.stories.tsx` as `/?fixture=boards&story=<its id>` (the way `e2e/whoops.spec.ts` opens
    a story), and compare its `.kb-thread-head` with a thread of the boards fixture that has no play. Do the same for
    `Banner` and `.kb-board-banner`. On `Pinned`, the pinned row is as tall as an unpinned row of the list.
  - Repeat the post assertions at 390 by 844.

## Task 3: one send for a reaction (engine)

Model: sonnet

Files: new `engine/ui/reactions/send.ts` and `engine/ui/reactions/send.test.tsx`; `engine/ui/reactions/Picker.tsx`
(`choose`).

- `useReactionSend({ act, as, tallies, mine }): { send(kind: string): Promise<'sent' | { refusal: string } | 'busy'>;
  busy: boolean }`. Its body is `Picker`'s `choose` today, moved whole:
  - The `sending` ref drops a second call while one is in flight, answering `'busy'`.
  - On `answer.ok`: `mine.add`, `tallies.merge` and `player.reactionLanded()`.
  - On a refusal: `mine.merge` after re-reading `api.myReactions([act])`, then `{ refusal: answer.error }`.
  - On a throw: `{ refusal: 'The reaction could not be sent. Try again.' }`.
  - `busy` is state for `aria-busy`. The unmount guard (`alive`) moves with it.
- `Picker` calls `send` and keeps its own `refusal` state, closing on `'sent'` as now.
- **Tests first** (red: the module does not exist). `send.test.tsx`:
  - It records the reaction as the HUD character in the fake, merges the tally, adds to `mine` and asks for the
    estimate once.
  - A refusal answers the server's words and re-reads the player's own reactions.
  - A throw answers the plain sentence.
  - A second `send` while the first is in flight answers `'busy'`, and the fake holds one reaction.
  - Every test under `describe('reacting')` and `describe('from the Task 6 quality review')` in
    `engine/ui/reactions/Reactions.test.tsx` stays green, unchanged.

## Task 4: reaction tiles (engine)

Model: sonnet

Files: `engine/ui/reactions/Reactions.tsx`, `engine/ui/reactions/reactions.css`, `engine/ui/reactions/Picker.tsx`
(a `refusal` prop), `engine/ui/cards/Lens.tsx` (`PlayRow`), `engine/ui/cards/lens.css`,
`engine/ui/updates/Updates.tsx`, `engine/ui/updates/updates.css`, `engine/ui/reactions/Reactions.stories.tsx`,
`engine/ui/reactions/Reactions.test.tsx`, `engine/ui/updates/Updates.test.tsx`.

- **The row.** One look: the `look` prop and `data-kb-look` go, and the Lens and Updates drop `look="glass"`. The row
  carries `data-kb-over-ink` everywhere. Its rule is scoped to `.kb-act-main`, so it does nothing in the Lens.
  - The list is `<ul class="kb-reaction-list" aria-label="Reactions">`.
  - Each item is `<li>` holding a tile: `class="kb-meta-tile kb-reaction"`, `data-kb-reaction={key}`, and
    `data-kb-own` on your own kind. Its contents are `<span class="kb-meta-tile-in" aria-hidden="true">{emoji}
    {count}</span>`.
  - `.kb-chips` and `.kb-chip` are left to `MoveNotice.tsx` and `FrontDoor.tsx` (design, section 7) with their rules in
    `reactions.css` as they are; the row stops using them.
- **Pressable or not.** `canReact` (as today: not one of the player's own characters' Acts, and a HUD character set)
  decides it.
  - **Where it is true,** each tile is a `<button type="button">`.
  - **Where it is false,** each tile is a `<span>` with the same classes and no hover (`.kb-reaction:not(button)` takes
    no hover and `cursor: default`), and there is no React, as today.
- **Names**, exact. `Name` is `readable(key)`, `n` the count, `who` the HUD character's name, and `cap` is
  `settings.reactionCap`.
  - Pressable, free: `${Name}, ${n}. React as ${who}`.
  - Pressable, your own kind: `${Name}, ${n}, including yours`, with `aria-disabled="true"`.
  - Pressable, none left: `${Name}, ${n}. You have left all ${cap} of your reactions on this post`, with
    `aria-disabled="true"`. Your own kind wins where both hold.
  - Not pressable: `${Name}, ${n}`, with `, including yours` where it is yours. This goes in a visually hidden span, as
    today, since the span has no role.
- **Pressing** a free tile calls Task 3's `send(key)`.
  - `'sent'`: focus stays on the tile, which is now your own and disabled. A visually hidden `role="status"` in the row
    says `Reacted with ${Name} as ${who}`. It is cleared when the HUD character changes.
  - `{ refusal }`: open the picker with `refusal` set. `Picker` shows a `refusal` prop as its initial refusal, in its
    `role="alert"`, and its Close returns focus to React as today.
  - `'busy'`: nothing.
  - The row has `aria-busy` while `busy`.
- **Keyboard** (design, section 6). The row's buttons (the tiles that are buttons, then React) are one tab stop with a
  roving `tabIndex`.
  - The stop starts on React where there is one, else the first tile. After that it is the last one focused.
  - Left and Right move along the row and stop at its ends (no wrap). Home and End go to the first and last.
  - `aria-disabled` tiles are reached. Wrapping onto a second line changes nothing: the order is the DOM's.
- **React** becomes `<button class="kb-meta-tile kb-reaction kb-react-button">` with
  `<span class="kb-meta-tile-in"><span aria-hidden="true">+ </span>React</span>`. Its name stays "React".
- **reactions.css.**
  - `.kb-reaction` sets `--kb-meta-line: var(--kb-glass-text-2)` with no glow.
  - `.kb-reaction[data-kb-own]` sets `box-shadow: 0 0 0 2px var(--kb-glass-ground), 0 0 0 4px var(--kb-fg)`. Inside
    `.kb-lens` and `.kb-updates-acts` (the glass), `--kb-fg` is not the ground's ink: set the ring there to
    `--kb-glass-text-hi`.
  - `.kb-react-button` sets `--kb-meta-line: var(--kb-glass-sweet)` and a background of `color-mix(in srgb,
    var(--kb-glass-sweet) 18%, var(--kb-glass-field))`.
  - `[aria-disabled="true"] .kb-meta-tile-in` dims the emoji alone: wrap the emoji in its own span for it.
  - The old `.kb-reactions[data-kb-look="glass"]` rules and `.kb-react-button { border-style: dashed }` go.
  - The emoji takes the system's emoji faces before the body face.
- **lens.css and updates.css:** their comments say the reactions are the tiles. `.kb-lens-row-foot` aligns its items
  center, so a 36px tile and a 44px kit tile share a line.
- **Tests first** (red: chips are list items, and the glass look exists). In `Reactions.test.tsx`, replacing `describe('the
  chips')`'s first test:
  - On another player's post, each shown kind is a button named as above. On the HUD character's own post they are no
    buttons, there is no React, and each is named in its hidden span.
  - Your own kind is `aria-disabled` and named "including yours". With the cap reached, a free kind is `aria-disabled`
    with the cap sentence.
  - Pressing a free tile records the reaction as the HUD character in the fake, raises the tile's count, marks it your
    own, keeps focus on it and puts the status sentence in the row.
  - Pressing a disabled tile sends nothing.
  - A refusal (the fake set to refuse) opens the picker with the refusal in its alert.
  - Tab reaches React first. ArrowLeft moves to the last tile, Home to the first, End to React. Tab out and back
    returns to the last one focused. An `aria-disabled` tile is reached.
  - The row carries `data-kb-over-ink` in a post, in the Lens and on Updates, and no element has `data-kb-look`.
  - `Updates.test.tsx` line 187 reads `ul.kb-reaction-list`.
  - Every test in `describe('the picker')` and `describe('in the glass')` stays green.

## Task 5: the browser's checks follow the tiles (engine)

Model: sonnet

Files: `e2e/whoops.spec.ts`, `e2e/footer.spec.ts`, `e2e/meta-tiles.spec.ts`; read `e2e/keyboard.spec.ts`,
`e2e/a11y.spec.ts`, `e2e/glass-hover.spec.ts`, `e2e/reactions.spec.ts`.

- `whoops.spec.ts`: `.kb-chip` becomes `.kb-reaction` (lines 278 and 290). `.kb-react-button` stays.
- `footer.spec.ts` (line 46): its chips check reads `.kb-reaction` tiles: each tile's ground is opaque, and its text is
  4.5:1 on it.
- Add to `meta-tiles.spec.ts`:
  - On `/?fixture=boards&moment=01-main`, every `.kb-reaction` is 36px tall, plus or minus 1, and the first free tile
    on a post not the HUD character's answers a hover.
  - Pressing it raises its count by one and leaves focus on it.
  - Two posts' rows each take one Tab: from the first row's stop, Tab goes past the rest of that row.
- Run all of `npm run test:e2e`. `keyboard.spec.ts` (React is the row's first stop), `a11y.spec.ts`,
  `glass-hover.spec.ts` (Updates' tiles are glass controls now and answer a hover) and `reactions.spec.ts` (the picker
  opens by the row) must pass unchanged. A failure there is a defect in Tasks 1 to 4, not in the spec.
- **In the PR:** screenshots at 1440 and 390 of a post with marks and a busy row, a post without, the Lens with a
  play's row, and Updates. Compare with `02-size.html` at 2.25rem and `03-date-bar.html`'s option 3.

## Review focus

- A reaction pressed on a tile must take exactly the picker's path (Task 3's one `send`): the same cap, refusal,
  re-read of `mine` and estimate request. Check that no second send path was written into `Reactions.tsx`.
- Whether a tile is a button, enabled or "yours" must come only from the reader's own `Mine` and own characters. Check
  that no tile state, name or timing reads anything about another player's reactions beyond the public tally.
- A busy instance's posts each hold a row: check that a tally change still redraws only its own post's row
  (`useTally`), and that the roving `tabIndex` adds no listener or state outside its own row.
- The date bar is now taller on every post of every thread: check the thread at 320px wide for the date's ellipsis
  against four marks and "+N", and that `MARKS_NARROW` still fits.
- A held Stick Around and a Whoops! splat both lift the row (`data-kb-over-ink`): check that a 36px tile still sits in
  front of the ink and is what a press reaches (`e2e/whoops.spec.ts`'s hold test).
- `MoveNotice.tsx` and `FrontDoor.tsx` must still draw the 2003 `.kb-chip`, untouched.
