Record, written 2026-11-19.

# A reaction waits five seconds before it is sent: plan

Carries out `docs/plans/2026-11-19-reaction-grace-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the tests
for the changed code (`npx vitest run <file>`). Run `npm run typecheck` and `npm run build` once after the last task,
with the tail in the PR. No deployed database, bucket or connector is touched, and no migration is added: nothing on
the server changes.

**The layers.** Every task is engine code, apart from the keepalive in Task 3, which is the web build's Supabase client
(`web/src/data/supabase.ts`). No task names an instance, a reaction key or a class. Tests use the fake world's kinds.

**Clocks.** Every test of the grace uses `vi.useFakeTimers()` and advances by `REACTION_GRACE_MS`, never a real wait.
An existing test that presses and expects the send is changed only to advance the clock first. No expectation is
weakened, and the PR lists each test so changed.

## Task 1. `Mine` holds pending reactions

Model: sonnet

**Files:** `engine/ui/reactions/mine.ts`, `engine/ui/reactions/mine.test.tsx`.

- Add `export const REACTION_GRACE_MS = 5000;` with a comment pointing at the design, section 2.
- Add `interface Pending { readonly act: Id; readonly kind: string; readonly character: Id; readonly due: number }`,
  where `due` is the epoch milliseconds at which it sends.
- `Mine` gains:
  - `pending(act): readonly Pending[]`, frozen-empty when there is none, like `get`;
  - `hold(p: Pending): boolean`, false when the kind is already held or already sent on that Act;
  - `release(act, kind): Pending | null`, which removes it and returns what was removed.
- `merge` and `add` are unchanged, but adding a sent kind also removes a pending entry of the same kind, so a sent kind
  is never both.
- `useMine` is unchanged. Add `usePending(mine, act)`, a `useSyncExternalStore` over `pending(act)` that wakes on the
  same per-Act listeners.

**Tests first** (mine.test.tsx):
- `hold` then `pending` lists it, and `get` does not.
- `hold` of a kind already sent is refused, and so is a kind already held.
- `release` returns the entry and empties `pending`.
- `add` of a held kind moves it from `pending` to `get`.
- A listener on another Act is not woken.

## Task 2. The send waits, queues, undoes and flushes

Model: sonnet

**Files:** `engine/ui/reactions/send.ts`, `engine/ui/reactions/send.test.tsx`, `engine/ui/data/api.ts` (the `react`
signature only), `engine/ui/data/fake.ts` (accept and ignore the new argument).

- `api.react(act, character, kind, opts?: { readonly keepalive?: boolean })`. The fake ignores `opts`. Task 3 wires it
  for the web build.
- `useReactionSend` takes one more argument, `onAnswer`, and its result becomes
  `{ press(kind): 'held' | 'busy'; undo(kind): boolean; busy: boolean }`, where:
  - **`press`** holds the kind in `mine` as `as` with `due = Date.now() + REACTION_GRACE_MS`, and starts a timer for
    it. It answers `'busy'` with no `as`, or when `mine.hold` refuses. It does not check the cap: the row and the
    picker already do, now counting pending kinds (Task 4).
  - **`undo`** clears that kind's timer and `mine.release`s it. It answers false when nothing was pending.
  - **A due timer** puts the kind on a queue for the Act. The queue sends one at a time through `api.react`, as the
    character stored in the pending entry, never the current `as` (design, section 5). Nothing is dropped as `'busy'`
    any more.
  - **Each answer** is given to `onAnswer` (a callback argument the row passes in), as `{ kind, character, answer }`
    with `answer: 'sent' | { refusal }`. On `'sent'` it does what `send` does today: `mine.add`, the tally merge and
    `player.reactionLanded()`. On a refusal it does `mine.release`, then today's re-read of `myReactions`.
- **Flush** sends every pending kind at once, in order, through the same queue:
  - On unmount of the hook: leaving the thread, or the row going away. Only the timers this hook started are flushed,
    so a Lens row closing does not send what the thread row is holding.
  - On `pagehide`, with `{ keepalive: true }`. The listener is added while anything is pending and removed when nothing
    is.
- `busy` is true while the queue is sending.

**Tests first** (send.test.tsx, fake timers):
- `press` sends nothing.
- After `REACTION_GRACE_MS - 1` nothing is sent; at `REACTION_GRACE_MS` one `react` is sent, as the pressed character.
- `undo` within the grace sends nothing ever, and empties `pending`.
- Two kinds pressed 1 second apart send in order, the second not dropped. This is driven red against today's `'busy'`
  drop.
- A mask change in `as` after `press` still sends as the first character.
- Unmount with one pending sends it at once.
- A `pagehide` event sends it at once, with `keepalive: true`, through a spied `api.react`.
- A refusal releases the pending kind and calls `onAnswer` with the server's words.
- The estimate (`reactionLanded`) is asked once per sent kind, as today's test checks.

## Task 3. The web client sends with keepalive

Model: haiku

**Files:** `web/src/data/supabase.ts`, `web/src/data/supabase.test.tsx`.

- `edge(fn, body, lost, resend = false, keepalive = false)`: when `keepalive` is true, the `doFetch` init carries
  `keepalive: true`. Nothing else in `edge` changes.
- `react: (target, character, kind, opts) => …` passes `opts?.keepalive === true` through `act`. Add a `keepalive`
  parameter to the local `act` helper, defaulting to false.

**Test first:** with a stub `fetch`, `api.react(a, c, k, { keepalive: true })` makes one request whose init has
`keepalive: true`, and `api.react(a, c, k)` makes one without it.

## Task 4. The row: pending, undo, the stamp at the send, the refusal note

Model: sonnet

**Files:** `engine/ui/reactions/Reactions.tsx`, `engine/ui/reactions/reactions.css`,
`engine/ui/reactions/Reactions.test.tsx`, `engine/ui/reactions/Reactions.stories.tsx`.

- `send`, `sending` and `stagedSend` are replaced by the hook's `press` and `undo`.
  - The staged page gets its own `press`, `undo` and timers, with the same grace. When one comes due it does what
    `stagedSend` does today, and calls no API (design, section 6).
- **Chips.** Read `usePending(mine, act)`.
  - A pending kind is drawn as a chip whose count is one more, with `data-kb-pending=""` and
    `style --kb-grace-due` (ms left).
  - A kind with no chip yet gets one.
  - Where the totals are hidden, the pending kind shows as "yours", with the pending style.
- **The cap and the one-of-each-kind rule** count `own` kinds plus pending kinds (`kinds` and `left` in the component).
- **A press:**
  - on a pending tile, it is `undo`, and the status says "`{Readable}` undone";
  - on a free tile, it is `press`, and the status says "Reacting with `{Readable}` as `{name}` in 5 seconds";
  - on your own sent tile, it shows the tooltip (Task 6);
  - at the cap, nothing happens, as today.
- **Names.**
  - A pending tile's `aria-label` is "`{Readable}`, sending in `{s}` seconds as `{name}`. Press again to undo". `{s}`
    is the whole seconds left, read at render, rounded up.
  - A pending tile is a pressable button, without `aria-disabled`.
- **At the send** (`onAnswer`):
  - `'sent'` sets `landed` (the stamp), and the status says today's "Reacted with …".
  - A refusal sets `rowRefusal`, shown as `<p className="kb-notice kb-reactions-refusal" data-kb-tone="refusal"
    role="alert">` under the row. It is cleared at the next press on the row. It no longer opens the picker.
  - A mask change or a lost `canReact` does not drop the answer's effect on `mine` or the tallies, which the hook does
    already. It only skips the stamp, as today.
- **CSS** (reactions.css):
  - The ring is `.kb-reaction[data-kb-pending]::after`: a conic mask in `--kb-reaction-hue`, animated from full to
    empty over `REACTION_GRACE_MS`. The duration is a custom property set from the constant, never a second literal.
  - The pending count is drawn at the reduced-emphasis text token.
  - The press pop is the existing give, plus a scale on `.kb-reaction-emoji` keyed off `data-kb-pending`.
  - Under reduced motion, nothing animates. A `<span className="kb-reaction-grace">` shows the seconds left, re-rendered
    once a second by an interval that runs only while something is pending.
- **Stories:** add "Pending" and "Pending, reduced motion" to `Reactions.stories.tsx`.

**Tests first** (Reactions.test.tsx, fake timers):
- A tile press shows the pending chip with count + 1, and sends nothing.
- A second press within the grace undoes it: the count is back, nothing is sent, and the status says undone.
- At the grace's end one send happens, and the stamp (`data-kb-landed`) appears only then, not at the press.
- A pending kind counts toward the cap: with a cap of 2, one sent and one pending, a third tile is `aria-disabled`
  with the cap's words.
- A refusal at the end of the grace shows the row's alert and does not open the picker.
- Under reduced motion, the seconds-left text is present and counts down. The send is still at 5 seconds.
- On the staged page, the same press, undo and send with no API call.
- The thread row and a Lens row for the same Act both show the pending chip (shared `mine`).

## Task 5. A glass tooltip

Model: sonnet

**Files:** `engine/ui/glass/Tooltip.tsx`, `engine/ui/glass/tooltip.css`, `engine/ui/glass/Tooltip.test.tsx`,
`engine/ui/glass/index.ts` (export).

- `Tooltip({ anchor: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, children })`.
- It is portaled into the layers (`engine/ui/glass/layer.tsx`), placed above its anchor or below where above would leave
  the window, and clamped inside the window with the phone's 16px gutters (`engine/ui/glass/place.ts`).
- It is a `role="tooltip"` element whose id the anchor gets in `aria-describedby` while it is open.
- Its text is repeated once into a polite `role="status"` region, so a screen reader hears it on a press, not only on
  focus.
- It closes:
  - by itself after `TOOLTIP_MS = 3000`;
  - on the anchor's `blur`;
  - on Esc, through `pageEscape` (`engine/ui/glass/keys.ts`), so Esc typed in a field stays the field's.
- It takes no focus, and nothing in it is pressable.
- Its look is the glass's: a small panel on the `--kb-glass` tokens, with the ⓘ drawn `aria-hidden`, and no smoke.

**Tests first:**
- Open shows the text and sets `aria-describedby`.
- After 3000ms it is gone.
- `blur` closes it, and so does Esc.
- Esc in a text input does not close it.
- It stays inside a 360px-wide window.
- It is in the axe pass of `web/a11y.test.tsx` through a story.

## Task 6. "Reactions can't be taken back," in the row and the picker

Model: sonnet

**Files:** `engine/ui/reactions/Reactions.tsx`, `engine/ui/reactions/Picker.tsx`,
`engine/ui/reactions/Reactions.test.tsx`.

- The words are one constant, `export const CANT_TAKE_BACK = "Reactions can't be taken back.";` in `Reactions.tsx`,
  used by both.
- **Row.**
  - A press on your own sent tile opens the `Tooltip` on it with `CANT_TAKE_BACK`. A second press while it is open
    restarts its 3 seconds.
  - Its `aria-label` becomes "`{Readable}`, `{n}`, including yours, can't be taken back". Where the totals are hidden,
    it is "`{Readable}`, yours, can't be taken back".
  - It stays `aria-disabled`.
- **Picker.**
  - Your own sent kinds become `aria-disabled="true"` instead of `disabled`, keep `data-kb-own`, and join the arrow-key
    grid. `buttons()` selects `button:not(:disabled)`, which now includes them. This is intended, and a test holds it.
  - Pressing one opens the `Tooltip` on it, and does not send or close the picker.
  - A kind unavailable only because of the cap stays `disabled`.
  - A pending kind in the picker is drawn as yours (`data-kb-own`, `data-kb-pending`). Pressing it undoes it, as in the
    row.
- **Picker choose.** With the grace, `choose(kind)` calls the row's `press` and closes the picker at once
  (`onClose(true)`). The `choosing` state and its awaited send go. The row shows the pending chip once the picker has
  gone, where `landed.after` used to wait for it. The picker's `send` prop becomes `press` and `undo` (types in Props).

**Tests first:**
- Pressing your own sent tile shows `role="tooltip"` with the words, and sends nothing.
- In the picker, your own kind is `aria-disabled`, not `disabled`. Pressing it shows the tooltip, and the picker stays
  open.
- Arrow keys land on your own kind in the picker.
- A capped kind is still `disabled`.
- Choosing a free kind closes the picker at once, the row shows it pending, and nothing is sent until the grace ends.
- A pending tile shows no tooltip when pressed: it undoes.
- The tile's name includes "can't be taken back".

## Task 7. The end-to-end specs wait out the grace

Model: haiku

**Files:** the specs that press a reaction and expect it to land, from
`grep -ln "kb-reaction\|React to" e2e/*.spec.ts`: `e2e/reactions.spec.ts`, `e2e/meta-tiles.spec.ts`,
`e2e/keyboard.spec.ts`, `e2e/veils.spec.ts`, `e2e/whoops.spec.ts`, `e2e/steel-chair.spec.ts`, `e2e/hot-box.spec.ts`,
`e2e/post-room.spec.ts`, `e2e/footer.spec.ts`.

- Where a spec presses a reaction and then expects the stamp, the count or a tally change, install `page.clock` before
  the page loads and run it forward 5000ms after the press. Never a `waitForTimeout`.
- A spec that only opens the picker is untouched.
- Add one spec to `e2e/reactions.spec.ts`:
  - press a tile, see the pending chip, press it again, and see the count back;
  - press, run the clock 5000ms, and see the stamp;
  - press it again, and see the tooltip's words.
- Run the changed specs with `--trace off`.

## Review focus

- **Lost reactions.** Does the `pagehide` keepalive actually leave the page in Chromium and Safari? `edge` awaits
  `bearer()` (`client.auth.getSession()`) before it fetches. If that await outlives `pagehide`, the request never
  starts. Check that it resolves from memory, or read the token earlier.
- **A double send.** Can a kind be sent twice, by a timer firing while the same kind is being flushed on unmount, or
  by two rows for the same Act each running a timer? Only the hook that pressed owns a timer, and `mine.hold` refuses
  a second hold.
- **The queue and refusals.** When one queued send is refused for the cap (another tab reacted meanwhile), the next in
  the queue still goes, and each refusal reaches the row.
- **Masks.** Nothing pending reaches the server, Realtime or another tab. The tally other screens see moves only at
  the send.
- **Settlement and estimates** see a reaction 5 seconds later than today (design, section 8). Check that nothing reads
  a reaction's press time from the screen, so the server's time is the only time.
- **Old tests' expectations.** A test changed to advance the clock must keep everything it asserted before.
