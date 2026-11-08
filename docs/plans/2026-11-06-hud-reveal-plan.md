# The Reveal from the HUD: plan

Record, written 2026-11-06. The plan for `docs/plans/2026-11-06-hud-reveal-design.md` (part of #206). One build session
builds it in one PR from `main`.

Every task is test first: name the test, record its red run, then write the code. This plan adds one migration and no
`check-*.mjs`. Every part is engine. No instance file changes, and the engine names no instance
(`tools/check-engine-boundary.mjs`).

PR #294 (the board look) restyles the composer's buttons, the "Reveal…" this plan removes among them, and other open
PRs may add migrations. Merge `main` before starting and again before opening the PR. Number the migration and its SQL
test with the next free numbers at that time; this plan calls them `NNNN_reveal_once.sql` and `MMMM-reveal-once.sql`.

## Task 1: the server knows when a class is public (engine)

Model: sonnet

Files: new `supabase/migrations/NNNN_reveal_once.sql`; new `supabase/tests/MMMM-reveal-once.sql`; the SQL tests that
reveal one class twice (below).

- `my_characters` is redefined exactly as `0074_settle_claim.sql` wrote it, plus one last column:
  `(select max(r.at) from class_reveals r where r.character = c.id and r.class = h.class_key and r.at >= h.started_at)
  as class_shown_at`. The header comment says what it reads, and that it is bounded by the caller's own characters.
- `unmask()` is redefined as 0074 wrote it, with one check after the `for no key update` lock and before the due-Turn
  check. The check raises `that character''s class is already public; after a Turn, the new class can be revealed`
  with `hint = 'kayfabb.refusal'` and `errcode = '55000'` when a `class_reveals` row exists for `through` whose class
  is its current `class_history` class and whose `at` is on or after that row's `started_at`. `write_unmask()` is not
  touched.
- Tests first, in `MMMM-reveal-once.sql`, in the style of `supabase/tests/0032-unmask.sql` (`pg_temp.refusal`,
  `tests.become`):
  - `class_shown_at` is null before any reveal. After `unmask()` it is that Act's `created_at`.
  - After a Turn (a `class_history` row with a new class) it is null again. After a Turn back to the first class it is
    still null, because the old reveal predates the new `started_at`.
  - A debut with its class and a Turn announced with its new class (an `announce` Act with `class`, as `0100` writes
    one) each set it.
  - A second `unmask()` of the same class is refused with the words above and writes no Act. After a Turn, `unmask()`
    succeeds again.
  - Another player's `unmask()` on the character gets the same refusal `acting()` gave before, whether or not the class
    is public. Assert the refusal text is identical in both cases.
  - `my_characters` lists only the caller's own characters' `class_shown_at` (another account reads no row for them).
- Red run: the new test fails on the missing column and on the accepted second reveal.
- Existing SQL tests that reveal one class twice must now refuse or take a Turn between. Search with
  `grep -n "unmask(" supabase/tests/*.sql`: `0032-unmask.sql` holds most of them, and `0013-seasons.sql`,
  `0077-settle-claim.sql` and `0101-season-results.sql` hold several. Where a test needs two reveals, insert a
  `class_history` row between them, as `0032-unmask.sql` already does for "A Turn takes effect". Where a test asserted
  that a repeat was accepted, it now asserts the refusal. Change no test's subject.

## Task 2: the client carries it (engine, web)

Model: sonnet

Files: `engine/ui/data/api.ts` (`MyCharacter`); `engine/ui/data/fake.ts` (`myCharacters`, `unmask`);
`web/src/data/supabase.ts` (`toMyCharacter`); `engine/ui/data/fake.test.tsx`; `web/src/data/supabase.test.tsx`; any
fixture or test that builds a `MyCharacter` literal (the type check finds them).

- `MyCharacter` gains `readonly classShownAt: string | null`, with a comment: "When its current class was made public
  (a reveal, a debut with its class, or a Turn announced with it); null while only its player knows it."
- `fake.ts`'s `myCharacters` computes it the same way as Task 1: the latest of the character's `unmask` Acts and
  `announce` Acts with a string `class` (the same filter `classReveals` uses) whose class is `classNow(c).cls` and
  whose `at` is on or after `classNow(c).at`. `unmask` returns the same refusal, in the same words, after `acting` and
  before the System board check. Write the words once in `fake.ts` as a constant beside its other refusals.
- `toMyCharacter` reads `class_shown_at`.
- Tests first: in `fake.test.tsx`, `classShownAt` is null, then set by a reveal, then null after a Turn, and a second
  reveal is refused with the server's words. In `supabase.test.tsx`, `toMyCharacter` maps the column. Red run: both
  fail on the missing field.

## Task 3: the overlay starts on a thread (engine)

Model: sonnet

Files: `engine/ui/characters/RevealOverlay.tsx`; new `engine/ui/characters/RevealOverlay.test.tsx` (or the reveal
cases in `engine/ui/characters/Characters.test.tsx`, wherever the overlay's tests stand at build time).

- `RevealOverlayProps` gains `readonly at?: { readonly id: Id; readonly title: string; readonly board: Id } | null`
  and `readonly kicker: string`. The kicker was the fixed "My characters › Reveal" and is now passed by each opener.
- With `at`, `board` starts as `at.board` and `chosen` as `at.id`. The effect that loads a board's threads still runs.
  When it runs for `at.board`, it keeps `chosen` and adds `at` to the list as a `ThreadSummary`-shaped option, unless
  the page already holds it. A change of board clears the thread as today. A later "Show older threads" page that holds
  `at` does not list it twice, as the existing filter already ensures.
  - So the effect does not clear the pre-filled choice on its first run, seed `chosen` from `at` and clear it only when
    `board` changes after mount. Track the board the choice belongs to in a ref.
- The preview's thread title is `at.title` until the list loads.
- The thread picker stays one block of markup (the Thread `label` and `select`), so a later search can replace it
  (design §4).
- Tests first: opened with `at`, both selects show the thread and Reveal is enabled before the list loads. The thread
  is listed when it is not on the first page. A change of board clears it. Without `at` it behaves as today. The
  kicker is the one passed. Red run: `at` is not a prop.

## Task 4: the HUD opens it, and says when a class is public (engine)

Model: sonnet

Files: new `engine/ui/thread/open.tsx`; `engine/ui/frame/Frame.tsx`; `engine/ui/thread/Thread.tsx` (`ThreadScreen`);
`engine/ui/frame/Hud.tsx`; `engine/ui/frame/frame.css`; `engine/ui/characters/Characters.tsx`;
`engine/ui/frame/Frame.test.tsx`; `engine/ui/characters/Characters.test.tsx`; `engine/ui/frame/Hud.board.stories.tsx`.

- **The open thread.** `open.tsx` exports `OpenThreadProvider`, `useOpenThread(): OpenThread | null` and
  `useShowOpenThread(t: OpenThread | null)`, where `OpenThread` is `{ id, title, board }`. `Frame.tsx` mounts the
  provider around the HUD and the page. `ThreadScreen` calls `useShowOpenThread` with its thread's summary while
  `systemBoard === false`, and with null otherwise. It clears on unmount, and a newer thread replaces an older one. The
  HUD reads the thread from this hook, never from the route's path or document, so the HUD doesn't need to know which
  route is a thread.
- **The HUD's line** (`Hud.tsx`, the `kb-hud-secret` span):
  - When `hud.classShownAt !== null`, it reads "Revealed" beside an open lock: the same SVG with the shackle path
    `M3 5 V3.4 a2.5 2.5 0 0 1 5 0`, so it no longer comes down to the right post. It is a `span`.
  - Otherwise, for a live mask (`debutedAt !== null && retiredAt === null`), it is a `button type="button"` with
    `className="kb-hud-secret"`, the same lock and words, and `aria-label={`Only you see this: reveal ${hud.name}'s
    class`}`. It opens `RevealOverlay` with `at={useOpenThread()}`, `kicker="Reveal"`, and `returnFocusTo` the button.
    `onDone` shows the overlay's done line where the HUD shows its toasts. If the HUD has no toast for a line of its
    own, show it as My characters shows its flash, in a `role="status"` region inside the HUD. The plan leaves the
    choice to the build, as long as it is announced and dismisses itself.
  - Otherwise (an undebuted or retired mask), it stays the plain `span` it is today.
- **`frame.css`.** `.kb-hud-secret` as a button resets the button's own box (`background: none; border: 0; padding: 0;
  font: inherit; color: inherit; cursor: pointer`). On `:hover` it takes `--kb-glass-text` in place of
  `--kb-glass-text-2`. On `:focus-visible` it takes the glass's focus ring, as the HUD's other controls draw it. Add a
  forced-colors rule if the HUD's other buttons have one. Nothing changes at rest.
- **The way to My characters carries the thread.** The HUD's avatar `Link`, the Menu button and the Esc handler
  navigate to `GLASS_NAV.characters` with `state: { thread: open }` when `useOpenThread()` is not null. `Characters.tsx`
  reads it beside `carried` with a reader of the same shape (`carriedThread`), which checks each field is a string.
- **My characters.** For a live character with `classShownAt !== null`, the "Reveal…" `GlassButton` is replaced by a
  plain `kb-roster-line` "Revealed". Otherwise "Reveal…" opens `RevealOverlay` with `kicker="My characters › Reveal"`
  and `at` from the carried thread.
- Tests first:
  - `Frame.test.tsx`: on a thread, the HUD's "Only you see this" is a button named "Only you see this: reveal
    Pipewrench's class". It opens a dialog of that title whose Board and Thread selects show the open thread, and the
    reveal lands there. Off a thread, the selects start empty. With `classShownAt` set, the line reads "Revealed", and
    no button by either name is in the HUD. After a Turn in the fake (a new class), the button is back. An undebuted
    mask's line is not a button. Esc in the overlay closes it and focus returns to the button.
  - `Characters.test.tsx`: arrived with a carried thread, "Reveal…" opens on it. A revealed character shows "Revealed"
    and no "Reveal…".
  - Red run: no button by that name exists.
- Update `Hud.board.stories.tsx` with a revealed mask's story beside the hidden one, so the owner can see both.

## Task 5: the board's Reveal goes (engine)

Model: sonnet

Files: `engine/ui/composer/Composer.tsx`; delete `engine/ui/characters/RevealModal.tsx` and
`engine/ui/composer/reveal.test.tsx`; `engine/ui/modal.tsx`; `engine/ui/modal.test.tsx`;
`engine/ui/glass/Overlay.test.tsx`; `engine/ui/characters/reveal.ts`; `engine/ui/characters/RevealOverlay.tsx`; the
composer's CSS that styles `.kb-composer-reveal`; any story that draws the composer's "Reveal…".

- The composer loses `revealing`, its "Reveal…" button and the `RevealModal` import.
- `RevealModal.tsx` is deleted. Before deleting `composer/reveal.test.tsx`, move any case that is about the reveal
  itself (its words, the pending-Turn note, the refusal in the server's words, the over-200 notice and disabled Reveal
  that #184 notes are unasserted) to the overlay's tests from Task 3, so no behavior loses its test. Cases about the
  composer's button go with it.
- `modal.tsx` loses the `Modal` component and its props; `useModalLayer`, `tabbables`, `modalOpen` and `topModalHolds`
  stay. Its header and the comment at the layer ("the board's Modal here, and the glass's Overlay") name only what
  remains.
- `modal.test.tsx` keeps every case, driving the layer through the glass's `Overlay` in place of `Modal`. Its subject
  is the layer, so no case is dropped. Where `Overlay.test.tsx` opens an `Overlay` inside a `Modal`, it opens one inside
  another `Overlay`.
- `reveal.ts`'s and `RevealOverlay.tsx`'s header comments describe one dialog and its two openers (the HUD and My
  characters).
- Test first: a composer test that no "Reveal…" button is in the reply box. Red run: it is there.
- `grep -rn "RevealModal\|kb-composer-reveal" engine web` returns nothing when done.
  - The research boards in `docs/research/` that draw the old button are records and stay as drawn.

## Task 6: the issues (inline)

Model: inline

- After the PR merges, the build session ticks #206's Reveal bullet by a comment on #206 linking the PR. It also
  comments on #184 that its `RevealModal.tsx` item is moot (the file is gone) and that the over-200 notice is asserted
  on the overlay.
- The thread-search issue (design §4) is filed by the design session with this plan's PR, not by the build.

## Review focus

- A repeat reveal an instance already holds: `class_shown_at` reads the latest, and nothing reads a count, so a
  duplicate changes nothing a player sees. Check the Rankings and the profile record, which list reveals, still draw
  duplicates as they did.
- The refusal and the masks: `acting()` must stay first in `unmask()`, so that someone else's character answers the
  same way, in the same time, whether its class is public or not.
- Two reveals at once: the check must sit after the row lock, so the second waits and then sees the first.
- `class_since` and a Turn waiting past its due settlement (`class_due_at`, 0074): a reveal made while the Turn waits
  names the old class. When the Turn lands, `started_at` is the landing, so `class_shown_at` goes null. Confirm that
  `started_at` and not `due_at` is the date compared.
- The pre-filled thread: a choice seeded before the thread list loads must not be cleared by the list's effect, and a
  page of older threads arriving after a change of board must still be dropped.
- The open thread carried to My characters lives in history state: Back to the thread and forward again must not open
  the overlay by itself, only pre-fill it when the player presses "Reveal…".
