# The Reveal on the glass: plan

Record, written 2026-11-03. Carries out `docs/plans/2026-11-03-glass-reveal-design.md` (its sections are cited as §N)
and closes issue #67. Every task is engine (`engine/ui/`), touches no SQL and no instance, and is test first: the test
named, its red run recorded, then the code, then the green run. No task adds a check.

## Task 1. The reveal's preview (§1)

**Files:** `engine/ui/characters/previews.ts`, `engine/ui/characters/previews.test.tsx`.

- Add `revealPreview({ name, className, message, threadTitle })`, which returns a `Preview` with one line,
  `{ by: name, text: "<name> revealed: <className>" }`, followed by ` — “<message>”` when the trimmed message is
  non-empty, and `where`: "At once, in <threadTitle>", or "At once, in the thread you choose" when `threadTitle` is
  null.
- Update the module comment: a preview's lines are what will be posted, The System's for a debut or a Turn and the
  character's own for a reveal.
- **Tests first** (red: `revealPreview` is not exported):
  - With an empty message, the line equals the text `UnmaskLine` renders for the same class and an empty message, in
    the same shape as the existing "a reveal" test.
  - With the message `It was me.`, the line equals `UnmaskLine`'s text for an Act whose payload carries that message.
  - The line's `by` is the character's name, never "The System".
  - `where` names the thread when given, and says "the thread you choose" when it is null.

## Task 2. The core, and the board's shell (§3)

**Files:** new `engine/ui/characters/reveal.ts`; `engine/ui/characters/RevealDialog.tsx` renamed by `git mv` to
`engine/ui/characters/RevealModal.tsx`; `engine/ui/composer/Composer.tsx`; `engine/ui/composer/reveal.test.tsx`;
`engine/ui/characters/characters.css`, where the comment "the reveal's board modal (RevealDialog.tsx)" now names
`RevealModal.tsx`.

- `reveal.ts` exports:
  - **`useReveal(character)`**, which returns `{ className, message, setMessage, count, over, busy, refusal,
    setRefusal, submit }`. `submit(thread: Id, threadTitle: string)` calls `api.unmask`, awaits `refresh()` on
    success, and returns `{ ok: true, done: "<name> revealed as <class> in <threadTitle>." }` or `{ ok: false }`, with
    the refusal set in the server's words, or set to "The reveal could not be sent. Check your connection and try
    again." when the call throws. The logic is moved from today's `submit`, not rewritten.
  - The constant `MAX = 200`.
  - **`revealWords(character, className)`**: the confirmation sentence, the pending Turn note, and the button label
    "Reveal <name> as <withArticle(class)>". These are today's strings, moved.
- `RevealModal` takes `{ character, thread: Id, onClose, onDone?, returnFocusTo? }`, with `thread` required. It renders
  today's `Modal` markup without the pickers: the sentence, the note, "It will be posted in this thread.", the
  message field and count, the refusals, and Cancel and Reveal. The threadTitle it passes to `submit` is "this
  thread".
- `Composer.tsx` imports `RevealModal`.
- **Tests first** (red: `RevealModal` does not exist):
  - In `engine/ui/composer/reveal.test.tsx`, add one test: the dialog the composer opens is the board's, not inside
    `.kb-glass-overlay` and with no `.kb-smoke` in it.
  - The existing composer reveal tests then pass unchanged against the renamed import.

## Task 3. The glass's shell, on My characters (§1, §2, §3)

**Files:** new `engine/ui/characters/RevealOverlay.tsx`; `engine/ui/characters/Characters.tsx` (line 390);
`engine/ui/characters/Characters.test.tsx`; `engine/ui/characters/characters.css`, with the rules for
`.kb-reveal-dialog` and `.kb-reveal`, drawn on the Debut dialog's rules (`.kb-debut-dialog` and `.kb-debut`).

- `RevealOverlay` takes `{ character, onClose, onDone, returnFocusTo? }`. It renders
  `<Overlay title="Reveal <name>'s class" kicker="My characters › Reveal" surface="turn" className="kb-reveal-dialog">`,
  which holds a form with:
  - the sentence and the note from `revealWords`;
  - Board and Thread as `label.kb-glass-field` around `select.kb-glass-select`, with "Show older threads" as a
    `kb-glass-action`. The loading and paging are moved from today's dialog, and their refusal words are unchanged;
  - "In the character's words (optional)" as `input.kb-glass-input`, with its count;
  - `<PreviewBox preview={revealPreview(...)} />`, which follows the message typed and the thread chosen;
  - the refusals;
  - `.kb-turn-actions` with Cancel as `kb-glass-action kb-glass-skew` and Reveal as `kb-glass-confirm kb-glass-skew`,
    their labels in `kb-glass-upright`, as Debut has them.
- `Characters.tsx` opens `RevealOverlay` in place of `RevealDialog`.
- **Tests first** (red: no `.kb-smoke` in the Reveal dialog). Add a `describe('the Reveal over My characters (the
  glass)')` beside the Turn's one (around line 673), using the same `page(w)` helper:
  - The dialog is a glass overlay on the `turn` smoke, with "My characters › Reveal" shown, and the menu bar inert
    and `data-kb-dimmed`.
  - For each of Close and Esc: the dialog is gone, focus is back on the row's Reveal button, and the menu bar is lit
    again.
  - The preview reads "Pipewrench revealed: Face" before anything is typed, and gains ` — “It was me.”` after typing
    `It was me.`. Its `where` names "The tea thread" once that thread is chosen.
  - The existing reveal tests (around lines 425 to 456, and 548 to 558) pass unchanged: the labels, the button name,
    the status line and the refusal are the same.

## Task 4. The issue's own words

- Run `npm run typecheck` and `npm run build:ci`, and record the green output in the PR.
- In the Storybook `Characters.stories.tsx`, if a story opens the reveal, check that it shows the glass overlay. Put a
  screenshot of the glass Reveal at the Main board's width and at phone width in the PR.
- The PR says `Closes #67`.

## Review focus

- Whether every string the board's composer dialog showed before is shown unchanged after the split.
  `reveal.test.tsx` checks only a few of them.
- Whether the preview's line can disagree with `UnmaskLine` for a message with leading or trailing spaces, or one
  that is only spaces. Compare what the server stores with what the preview trims.
- Whether `RevealOverlay`'s thread pickers keep the guard that stops a late page of threads from overwriting a newer
  board's list (the `live` flags in today's effects) once they are moved.
- The phone width: whether the form, the preview and the skewed actions fit inside the Overlay above the HUD without
  a horizontal scroll.
