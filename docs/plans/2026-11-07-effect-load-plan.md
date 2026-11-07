# Effect load: plan

Record, written 2026-11-07. Carries out `docs/plans/2026-11-07-effect-load-design.md`. Every task goes test first: the
failing test and its red run, then the code. Run only the changed code's tests during a task (`npx vitest run <file>`),
and `npm run build` once after the last task.

World: the board; nothing new is drawn. The engine gains `lazyEffect` and the loaders' wait; the instance changes only
how it builds its five effects; `web/src/App.tsx` wires both.

## Task 1. `lazyEffect`: a lazy effect that can be preloaded

Model: sonnet

**Files:** `engine/ui/cards/lazy-effect.ts` (new), `engine/ui/cards/lazy-effect.test.tsx` (new),
`engine/ui/cards/lazy.test.tsx`, `engine/ui/cards/types.ts` (the `CardUi.Effect` doc comment).

- `lazyEffect(factory: () => Promise<{ default: ComponentType<EffectProps> }>)` returns a `ComponentType<EffectProps>`
  carrying `preload(): Promise<void>`.
- It holds the loaded component once the import resolves. While it holds one, the component renders it directly and
  never suspends. Before, it suspends (React 19's `use` on the one in-flight promise) under the caller's `Suspense`, so
  `BoundEffect` and `StillEffect` (`engine/ui/cards/Effects.tsx`) keep their fallback, the post's words, unchanged.
- `preload()` starts the import once and returns the same promise to every caller until it settles. A rejected import
  is forgotten, so the next `preload()` or render tries again; a render whose import rejected draws `children` (the
  words) and never throws to an error boundary.
- `preloadEffects(cards: readonly CardUi[], keys: Iterable<string>): Promise<void>` preloads the effect of each card
  named, in parallel, and always resolves (each failure is swallowed). A card whose `Effect` is a plain component, or
  has no `Effect`, needs nothing.
- `isBareLazy(Effect)`: true for a `React.lazy` component (`$$typeof === Symbol.for('react.lazy')`), for Task 4's test.

**Test first** (`lazy-effect.test.tsx`, with the engine's own test cards as `lazy.test.tsx` builds them):
- After `await preload()`, a first `render` of a post wearing the card shows the effect's wrapper in the very first
  commit; the words never appear outside it. Red: a bare `lazy` shows the words first.
- Before the module lands the words show, and after it lands they are inside the effect (as `lazy.test.tsx` holds for
  `lazy`, kept and run on `lazyEffect` as well).
- Two `preload()` calls and a render call the factory once.
- A factory that rejects once: `preloadEffects` resolves, the render shows the words, and the next `preload()` calls
  the factory again and lands.
- `isBareLazy` is true for `lazy(...)` and false for `lazyEffect(...)` and for a plain function component.

## Task 2. The cards a document draws

Model: sonnet

**Files:** `engine/ui/cards/plays.ts` (a new `cardsDrawnBy`), `engine/ui/cards/plays.test.ts` (or the nearest existing
test of `playOf`).

- `cardsDrawnBy(acts: Iterable<Act>): ReadonlySet<string>`: the `card` of each Act `playOf` reads as a play that is not
  face down. A set (`CARD_BACK`) names no card.
- The thread's acts are its document's `plays` and `above[].act`. Read `engine/ui/board/Board.tsx` and confirm the
  board's document (`banner`, `pins`) draws marks and no `PostEffects`; if so, the board waits for nothing and gets no
  call. If it does draw an effect, its acts go through the same function and Task 3 gives `loadBoard` the wait.
- The front door's cards: `frontDoorCards(door: FrontDoorUi): ReadonlySet<string>`, the `card` of every staged play
  (`engine/ui/front-door/FrontDoor.tsx` builds them from `door.posts[].plays[].card`).

**Test first:** a play, a set, a play above (thread reach) and a post with no play give the play's and the above's cards
and not the set's; a staged door with two plays of one card and one of another gives two keys. Red: no function.

## Task 3. The loaders wait for their page's effects

Model: sonnet

**Files:** `engine/ui/screen-docs.ts` (`LoadEnv`, `loadThread`, the signed-out branch of the board-world loaders),
`engine/ui/screen-docs.test.ts` (or the screens' tests that build a `LoadEnv`), every `LoadEnv` built in tests and
stories (`grep -rn "LoadEnv\|effects:" engine web --include=*.ts*`; `engine/ui/loaded.tsx` among them).

- `LoadEnv` gains `preloadEffects: (keys: ReadonlySet<string>) => Promise<void>` and `frontDoorCards: ReadonlySet<string>`.
- `loadThread`, once `threadPage` answers a document, awaits `env.preloadEffects(cardsDrawnBy([...doc.plays,
  ...doc.above.map((a) => a.act)]))`, then resolves the document. A null document waits for nothing.
- A signed-out answer from a route that draws the front door awaits `env.preloadEffects(env.frontDoorCards)` before
  `SIGNED_OUT_DOC`.
- The wait never rejects (Task 1), so a chunk never fails a load.

**Test first:** a `LoadEnv` whose `preloadEffects` returns a promise the test holds: `loadThread` stays pending until it
resolves, and is asked with exactly the page's drawn cards (a set on the page adds none); a thread with no plays asks
with an empty set and resolves at once; signed out, the front door's cards are asked. Red: `loadThread` resolves before
the preload.

## Task 4. Divided World's effects are `lazyEffect`s

Model: inline

**Files:** `instances/divided-world/ui/cards.ts`, `instances/divided-world/ui/cards.test.ts` (new).

- The five `lazy(() => import(...).then(...))` lines become `lazyEffect(...)` with the same factories; the comment
  above them says the code preloads with its page and warms at idle (the effect-load design, sections 1 and 2).
- The test: no card in `cardsUi` has an `Effect` that `isBareLazy`. Poison, run red once and recorded in the PR: one
  effect left as a bare `lazy`.

## Task 5. The app gives the loaders the preload and warms every effect

Model: sonnet

**Files:** `web/src/App.tsx` (`EFFECTS`, the `LoadEnv` in `App`, the first load), `web/src/App.test.tsx`.

- The `LoadEnv` gets `preloadEffects: (keys) => preloadEffects(instanceUi.cards, keys)` and
  `frontDoorCards: frontDoorCards(instanceUi.frontDoor)`.
- Once the first load has landed (signed in or out), the app schedules
  `preloadEffects(instanceUi.cards, every card key with an Effect)` with `requestIdleCallback`, falling back to a
  `setTimeout` of 0 where there is none. Once per app; it is cancelled if the app unmounts first.

**Test first:** with the fake backend and a thread whose post wears an effect (the fixtures' Whoops! play, or a test
card), a direct open of `/t/:thread` draws the effect in the first commit after the route lands, with no frame showing
the bare words; after the first load and an idle tick, every effect's `preload` has been called once. Red: the effect
draws a commit later.

## Review focus

- A `lazyEffect` that suspends through `use` inside `BoundEffect`'s `Suspense`: the fallback is still the post's words
  in every place an effect draws (thread, ORIGIN box, the Lens's moment, the front door).
- A rejected import never reaches an error boundary and never fails a route's load; a later render retries it.
- Nothing waited for is read from a face-down play or the caller's `faces`.
- Every `LoadEnv` in tests and stories gets the two new fields, so no story's loader hangs on a missing preload.
- The warm-up runs once, after the first load, and does not delay the first page's own load.
