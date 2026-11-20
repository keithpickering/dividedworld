Record, written 2026-11-20.

# Spent marks: the plan

Carries out `docs/plans/2026-11-20-spent-marks-design.md`. Six tasks, in order, each test first with its red run. The
code is the engine's (`engine/ui/cards/`, and the two callers of `billPost`), plus the four Divided World effects that
call `endsWords`. No interface is added. `endsWords` gains a required argument. No migration, and nothing on the
server.

## Task 1. One function for both tenses of an end

Model: sonnet

- **`endsWords(ends, now)`** in `engine/ui/cards/marks.ts` takes `now: number` (ms), now required. It returns
  `Ends ${dayAndTime(ends)}` while `Date.parse(ends) > now`, else `Ended ${dayAndTime(ends)}`. Its doc comment says why
  the time is required: a caller cannot forget the tense.
- **`keptEndedWords`** is written from it: `${endsWords(ends, now)}. Posts written while it was up keep it.`, called
  only once the end has passed, so it takes the same `now`.
- **Callers**, each passing the clock it already holds:
  - `defaultView` (`engine/ui/cards/plays.ts`): `now ?? Date.now()` is not allowed. `defaultView`'s `now` becomes
    required wherever `endsAt` is given, and `useResolvedView` already passes `api.now()`. Check every other caller of
    `defaultView` with a grep.
  - `gimmickWords` (`marks.ts`): its `finish` passes `now.getTime()`. Its "Ended, changing nothing" branch stays until
    Task 3 makes it unreachable.
  - `backWords` (`marks.ts`): a live back's end is ahead by definition (an over back is dropped by `shownPlays`). It
    is given the `now` its callers hold (`useResolvedView`'s, the Mark's).
  - Divided World: `blind-study/Effect.tsx` (its `now`), `steel-chair/Effect.tsx` (its `now`), `hot-box/Effect.tsx`
    (its `at`), `whodunnit/Effect.tsx` (its clock).
- **Tests first** in `engine/ui/cards/lens-words.test.ts` (or a new `describe` in `marks.test.ts`): `endsWords` says
  "Ends …" a minute before its end, "Ended …" at it and after; `keptEndedWords` begins "Ended". Red: the current
  function says "Ends" after the end. Update the tests that build their expectation from `endsWords` (`lens.test.tsx`,
  `marks.test.ts`, `lens-words.test.ts`, and the Blind Study, Hot Box and Whodunnit effect tests) to pass a time.
- **Test first** in `engine/ui/cards/lens.test.tsx`: a card with no effect and a Use on a post whose `ends` has passed
  shows "Ended {date}" in `.kb-lens-ends`. Red: "Ends {date}".

## Task 2. What is over, and what is spent

Model: haiku

- In `engine/ui/cards/plays.ts`, beside `livePlays`:

  ```ts
  /**
   * Whether a play is over (spent-marks design, section 1): caught, ended by an admin, didn't take, instant, spent by a filing, a back that sprang, or its
   * time is up and its card does not keep. In a moment (`then`), a play named there is judged as it stood: its timed end does not count.
   */
  export function playOver(p: CardPlay, now: number, keeps: ReadonlySet<string>, then?: ReadonlySet<Id>): boolean {
    if (p.caught || p.reversed || p.untaken || p.instant || p.spent || p.revealed) return true;
    if (then?.has(p.id)) return false;
    return p.ends !== undefined && Date.parse(p.ends) <= now && !keeps.has(p.card);
  }

  /** Whether a kind is spent on a post: it has plays, and every one is over. */
  export const kindSpent = (plays: readonly CardPlay[], now: number, keeps: ReadonlySet<string>, then?: ReadonlySet<Id>): boolean =>
    plays.length > 0 && plays.every((p) => playOver(p, now, keeps, then));
  ```

- **Tests first** in `engine/ui/cards/plays.test.tsx` (a `describe('playOver')`), one case per line of the design's
  section 1: caught, reversed, untaken, instant, spent and revealed are over; a play with `ends` one ms ahead is not,
  at its end it is; a play with `ends` passed whose card keeps is not; a play in `then` with `ends` passed is not, but
  one in `then` that is caught is; a play with only `starts` ahead is not. `kindSpent` is false for no plays, false for
  one live and one caught, true for two over. Red: the functions do not exist.

## Task 3. The Lens's view of a spent kind

Model: sonnet

- **Words** in `marks.ts`: `export const ENDED_STATE = 'Ended';`, documented beside `OVER_STATE`.
- **`useResolvedView`** (`engine/ui/cards/Lens.tsx`), for a kind that is not a back:
  - Compute `spent = kindSpent(here.plays, now, keeping, then)`. `here.plays` are already the kind's plays as the
    strip draws them, and `then` is in scope.
  - When `spent`, return the engine's view, never the effect's (`given`). This generalizes `allEnded`, which it
    replaces. The view: `progress: null`, `controls: []`, `yours: false`, the notes the fallback already builds, and the
    heading from the design's section 3 table:
    - every play timed out: `ENDED_STATE`;
    - every play reversed: `endedWords()`. Every play untaken: `UNTAKEN_STATE`. Every play caught: `CAUGHT_STATE`;
    - every play instant or spent by a filing: the card's own status (`base.state`, as today);
    - otherwise `OVER_STATE`.

    The way-out line is `endsWords(latest timed end, now)` when any play timed out, else none (and `FALL_ENDS` is never
    shown for a spent fall, as today).
  - Order the branches so that this comes before the gimmick branch. `gimmickWords`'s ended branch is then
    unreachable from the Lens: remove it and its test, and say in `gimmickWords`'s comment that a spent gimmick is the
    Lens's `ENDED_STATE`.
  - **A play's row:** in a kind that is not spent, a play that timed out (not caught, reversed or untaken, `ends`
    passed, card does not keep, not in `then`) gets the note `${endsWords(p.ends, now)}.` in `notes`, merged with the
    effect's notes as the catches already are.
- **Instance:** remove Blind Study's `over` state and Whodunnit's `over` view. Their effects now give views only while
  live. Keep whatever the effect draws on the post. Update their tests to stop expecting an after-the-end view.
- **Tests first** in `engine/ui/cards/lens.test.tsx`:
  - A card with no effect whose single Use timed out: heading "Ended", way out "Ended {date}". Red: its status and
    "Ends".
  - A card whose effect keeps giving a live view (a stub effect that always says "Smoke over the words") with every play
    timed out: heading "Ended", not the effect's. Red: the effect's view.
  - A gimmick timed out: "Ended". Red: "Ended, changing nothing".
  - One play timed out and one caught: "Over", with "Ended {date}". One timed out and one live: the live view, and
    the timed-out play's row says "Ended {date}.".
  - An instant play: the card's own status. A spent fall: "Took the fall" (the instance's status, through a stub
    card).
  - A card that keeps, timed out: unchanged ("Ended … Posts written while it was up keep it."), not `ENDED_STATE`.
  - In a moment (`then` holding the play), a timed-out play: the live view.
  - `viewProblems` holds every new view: run it over each case's view.

## Task 4. The unlit mark

Model: sonnet

- **`Mark`** (`engine/ui/cards/Marks.tsx`): `const now = useUntil(plays)` and `const spent = kindSpent(plays, now,
  keepingKeys(instance.cards), then)` (memoize the keys). It replaces `caught`. The button carries
  `data-kb-spent={spent ? 'true' : undefined}`, and `data-kb-caught` is removed. When spent, the ink is not applied
  (no `--kb-mark-ink`) and no edge is drawn.
- **`marks.css`**: replace the `[data-kb-caught='true']` rule with:

  ```css
  /* A spent kind (spent-marks design, section 2): every play over. Unlit: no glow, a gray solid border (never dashed, the ghost's sign), the ground under
     it, the icon grayed. It stays a button, so its border is held to 3:1 on the ground (web/src/contrast.test.ts). */
  .kb-mark.kb-meta-tile[data-kb-spent='true'] {
    --kb-meta-line: color-mix(in srgb, var(--kb-glass-text) 60%, transparent);
    background: var(--kb-glass-ground);
    box-shadow: none;
  }
  .kb-mark[data-kb-spent='true'] .kb-mark-icon,
  .kb-mark[data-kb-spent='true'] .kb-mark-swatch {
    filter: grayscale(1);
    opacity: 0.6;
  }
  ```

  The glow rule's `:not(...)` gains `[data-kb-spent='true']`, so the shared specificity order holds without
  `!important`. The open state (`aria-expanded`) on a spent mark fills with
  `color-mix(in srgb, var(--kb-glass-text) 18%, var(--kb-glass-ground))`. Under `forced-colors`, a spent mark's
  border is `GrayText`.
- **Contrast** in `web/src/contrast.test.ts`: for each instance key, the spent border (resolved with `resolveColor`
  from `engine/ui/glass/border-contrast.ts`) composited over `--kb-glass-ground` reaches 3:1 against
  `--kb-glass-ground`. Drive it red once with 20% in place of 60%, and say so in the PR.
- **Tests first** in `engine/ui/cards/marks.test.tsx`: a kind whose only play timed out has `data-kb-spent="true"`
  and, before its end, has none (advance the clock across the end and see it flip without a re-read). It is also set
  for a kind all caught, all reversed, all untaken, instant, and a spent fall. It is not set for one live and one
  caught, a card that keeps, or a timed-out play in `then`. The accessible name ends "…, Ended. Opens the cards on this
  post." Rename the existing `data-kb-caught` assertions in `marks.test.tsx` and `backs.test.tsx`. Red: no attribute
  for a timed-out play.
- **Stories:** `Marks.board.stories.tsx` gains a post with a live mark, a timed-out mark, an instant (heart) and the
  ghost, beside each other.

## Task 5. Spent last, at page read

Model: sonnet

- **`billPost`** (`engine/ui/cards/billing.ts`) takes `over: { readonly now: number; readonly keeps: ReadonlySet<string> }`.
  After `billing(...)`, it partitions the billed plays stably: plays of kinds that are not `kindSpent` (judged on all of
  the post's counted plays of that kind) first, then the rest, each part in billing order. `billing` itself is
  unchanged (it is the tags' order and its tests stay).
- **Callers:** `engine/ui/thread/Thread.tsx` (its `billPost` loop) and `engine/ui/spin/Origin.tsx` (`takeInOrigin`)
  pass `{ now: api.now(), keeps: keepingKeys(instance.cards) }` from what they hold. Give `takeInOrigin` the two
  values as arguments if it has neither.
- The header comments of `billing.ts` and `Marks.tsx` gain a sentence: spent kinds go last when a page is read, and a
  kind that goes spent later keeps its place.
- **Tests first** in `engine/ui/cards/billing.test.ts` (or wherever `billPost` is tested): a post with a spent kind
  drawn most and a live kind drawn least bills the live kind first. Two spent kinds keep billing order between them.
  A play arriving live after billing keeps its place after them. Red: billing order alone. And in
  `marks.test.tsx`: a strip whose live kind would be fifth by draws shows it among the first four, and a kind that
  goes spent while mounted does not move.

## Task 6. The card's icon on its Lens tab

Model: sonnet

- **`Lens`** (`engine/ui/cards/Lens.tsx`), where the tabs are drawn (around `PreparedTab`'s children): before the
  label, a `TabIcon` for a card kind. The kind is `open.card`'s form kind on a form, the revealed card for a sprung
  back, else the kind. It looks up `ui.cards.find(...)?.art`:
  - `art.mark`: `<img className="kb-lens-tab-icon" src={art.mark} alt="" draggable={false} />`;
  - art without a mark: `<span className="kb-lens-tab-icon kb-lens-tab-swatch" style={{ background: art.color }} />`;
  - no art, a face-down back, or the visit's tab: nothing.
- **`lens.css`**:

  ```css
  /* A card's icon on its tab (spent-marks design, section 5): always in color, spent or not. A tight halo in the field color lifts it off its own ink
     fill, and a soft shadow under it keeps it from looking cut out. */
  .kb-lens-tab .kb-glass-upright { display: inline-flex; align-items: center; gap: 8px; }
  .kb-lens-tab-icon {
    flex: none;
    width: 1.35em;
    height: 1.35em;
    object-fit: contain;
    filter: drop-shadow(0 0 1.5px var(--kb-glass-field)) drop-shadow(0 0 1.5px var(--kb-glass-field)) drop-shadow(0 3px 5px rgb(0 0 0 / 0.5));
  }
  .kb-lens-tab-swatch { box-sizing: border-box; border: 2px solid var(--kb-glass-text-hi); }
  @media (forced-colors: active) { .kb-lens-tab-icon { filter: none; } }
  ```

  Check that the tab's `min-height: 44px` and the strip's fades are unchanged, and that a busy tab's `Spinner` still
  sits after the label.
- **Tests first** in `engine/ui/cards/lens.test.tsx`: a card tab with a mark has an `img.kb-lens-tab-icon` with
  `alt=""` and the mark's `src`, and keeps it when the kind is spent. A sprung back's tab shows the revealed card's icon.
  A face-down back's tab and the visit tab have none. A card with art but no mark has the swatch. The tab's accessible
  name is unchanged. Red: no icon.
- **Look:** one screenshot at deviceScaleFactor 2 of the Lens open on the story's post (Task 4), its Whoops!-style tab
  open, for the owner in the PR.

## After the tasks

- The full `npm run build`.
- The PR shows the Task 4 story and the Task 6 screenshot.

## Review focus

- Acts an instance already holds: every timed-out Use on a post now draws unlit and says "Ended". Check a card whose
  `ends` is set but which a player still expects to act on after it (none known; Steel Chair's chairs, Hot Box's smoke
  and Blind Study's totals all end then).
- "The engine wins" hides an effect's view once spent. An effect that still draws something on the post after its end
  (Blind Study's revealed totals, Whodunnit's restored name) keeps drawing it. Only its Lens words change. Check that no
  effect's control (a Reset, a Hold) was the reader's only way to do something after the end.
- A sprung back counted as over: its mark shows its card unlit, and the play it laid has a mark of its own. Check that the
  two never read as the same card both lit and unlit in a confusing way, and say in the PR what a post with a sprung
  Move looks like.
- A moment (`then`): a timed end since the moment never makes a play there over. The spent-last order in an ORIGIN
  box is judged at `takeInOrigin`'s now, not the moment's, which is accepted: billing is set once and never moves.
- The masks: `playOver` reads only public fields of a play. A face-down back's end must never make the back spent
  before it is dropped, and a back's `endsAt` is the same span for every card.
- A busy instance: `useUntil(plays)` per mark adds one timer per mark with an end ahead. Check that the Mark and
  `useResolvedView` share the same clock rather than arming two timers for one end.
