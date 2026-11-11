# Stick Around, the second view's words: plan

Record, written 2026-11-11. Carries out issue #325 directly, on the owner's word; no design session ran, since the
issue settles what the fix is. The task goes test first: the failing test, its red run, then the code. During the
task, run only `npx vitest run instances/divided-world/ui/stick-around/hold.test.tsx`. Run `npm run build` once
after it. All of it is Divided World's instance UI.

## The bug

Two Stick Around plays are stacked on one post. The reader checks the first caster's sentence, and the hold view for
the second play opens with none of the post's words in it. The words are not destroyed (they return to the thread when
the last play is released), and the checkbox and Break free still work, so the reader is not stuck; but the view holds
them on a post they cannot see.

## The root cause

`instances/divided-world/ui/stick-around/Effect.tsx` draws the post's words once, into an element it keeps (`words`),
and a layout effect moves that element between the thread (`home`) and the view (`slot`, a ref object `HoldView`
attaches to its `.kb-hold-post-body`). That effect's dependencies are `[inView, words]`. `HoldView` is keyed by the
play's id, so when the first play is released React unmounts the first view and mounts a second: `slot.current` is now
a new element, but `inView` was true before and is true after, so the effect does not run, and the words stay in the
first view's element, which has left the document.

The effect asks "is there a view?" where it should ask "which element is the view's place for the words?".

## Task 1. The words follow the view's own element

Model: inline.

Files: `instances/divided-world/ui/stick-around/Effect.tsx`, `instances/divided-world/ui/stick-around/HoldView.tsx`,
`instances/divided-world/ui/stick-around/hold.test.tsx`.

- Tests first, in `hold.test.tsx`: a world whose held post has two Stick Around plays by two casters, each with its
  own sentence. The view opens on the first sentence with the post's words inside the dialog. The reader checks the
  box; the view now asks the second sentence, and the post's words are inside that dialog, in the document, drawn
  once. The reader checks the second box; the view is gone and the words are back in the thread's post. The test runs
  at both `data-kb-motion="reduce"` and `data-kb-motion="full"`. It is red on the second view's words before the fix.
- The fix: the view's place for the words is held as state in the effect, set by a callback ref `HoldView` puts on its
  `.kb-hold-post-body` (`words` becomes a ref callback). The layout effect that places the words depends on that
  element itself, so the words go to whichever element is the current view's, whatever caused the view to be mounted
  again, and back to the thread when there is none.
- Nothing else changes: the words are still one mount for the life of the effect (inner effects keep their state
  across the change of view), the second view starts with its own empty bar and unchecked box as its key already
  makes it, and the ways out (the checkbox, the bar, Break free, Esc) and what they cost are untouched ("An accessible
  path costs what the obstacle costs", "No player is ever stuck").

## Review focus

- The words are never drawn twice and never unmounted across the change of view.
- No frame is painted with the second view empty: the move happens before paint.
