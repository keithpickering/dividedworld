# Effect load: a page lands with its card effects already drawn

Record, written 2026-11-07. A design session with the owner, after the forum-load and glass-load work merged. In their
words: "we added routes and a loading bar to avoid different parts of the forum screens popping in one at a time, a
deliberate simulation of regular webpage loading within an async app. This worked for everything except post effects,
which still pop in after the load." On how far to go: "We always load X posts at a time ... Lazy loading effects on a
few posts out of 10ish might be over engineering depending on how much load time it actually saves", and once the
chunks were measured, "39kb is less than the average image ... We can probably preload all, even if we had 25x as many
effects we would still be under a megabyte, and this is all background work." The plan that carries it out is
`docs/plans/2026-11-07-effect-load-plan.md`.

World: the board. Nothing new is drawn. The IE6 meter runs a little longer on a page whose effects have not been
fetched yet, and the page lands with them already on it.

## 0. Where it starts

Read from the code on 2026-11-07 (`main` at e9c4146):

- Each card's effect is a `React.lazy` chunk (`instances/divided-world/ui/cards.ts`, the five `lazy(() => import(...))`
  lines). The forum-load design split them out of the first script (`docs/plans/2026-11-05-forum-load-design.md`,
  section 9).
- The engine draws an effect inside a `Suspense` whose fallback is the post's words (`engine/ui/cards/Effects.tsx`,
  `BoundEffect` and `StillEffect`). `engine/ui/cards/lazy.test.tsx` holds that fallback.
- The thread's document already carries everything an effect needs except its code. `loadThread`
  (`engine/ui/screen-docs.ts`) asks `threadPage` with `env.effects`, and the answer holds the page's `plays`, the
  `above` plays (board, thread and author) and their saved `states`.
- So the order of a thread's landing is: the loader resolves, the page swaps in and the meter fills; the first render
  of a post that wears a card calls the lazy factory; the chunk arrives one round trip later, and the effect pops on
  over words already shown.
- A production build on that commit: the main script is 209 KB gzipped; the five effect chunks are 4 to 15 KB each and
  39 KB together.

## 1. What a page waits for

**Decided:** a route's loader resolves only once the code of every effect its document will draw is loaded. The card
keys come from the document itself (its plays and the plays above it), not from any new query: the per-page SQL
already says which cards are on the page.

Alternatives weighed:

- *Wait only for the effects of posts that will be onscreen at first paint* (by a bound on the number of posts a
  viewport can hold, or by laying the page out hidden and measuring). Dropped by the owner: the chunks of a page all
  fetch in parallel, so the page waits about one round trip either way, and leaving out the offscreen few saves a few
  KB and no time. React's `lazy` fetches on render, not on scroll, so every effect on the page is fetched right after
  landing in any case.
- *Put the effects back in the first script.* Undoes the forum-load split; the first script would grow with every card
  an instance adds.

A page with no effects on it waits for nothing. A chunk already fetched (by the warm-up, a hover's prefetch or an
earlier page) is waited for not at all.

## 2. Every effect warms in the background

**Decided:** once the first load has landed, the app fetches every effect's code at idle, all of them, with no order
and no budget. At today's 39 KB that is less than one avatar image; at 25 times as many effects it is still under a
megabyte, all of it background work that the browser caches by its hashed name.

Alternatives weighed:

- *Order the warm-up by how often each card is live* (a public count of live plays in `boot()`). Dropped: with every
  effect fetched there is nothing to order.
- *No warm-up.* A page's own wait (section 1) is then the only fetch, and a card played live while a reader is on the
  page (heard through Realtime) arrives before its code, then pops on. The warm-up makes both rare.

The warm-up runs signed in and signed out (the front door draws staged posts with effects).

## 3. A preloaded effect draws on the first frame

React 19's `lazy` suspends once on its first render even when its module is already loaded, so a preload alone would
still show the fallback for a frame. **Decided:** the engine gives instances `lazyEffect(factory)`, a component with a
`preload()`. Once the module is loaded the component draws it directly; before, it suspends as `lazy` does, under the
same `Suspense` and the same fallback (the post's words), so a post never shows without its words. An instance's card
effect is either a plain component or a `lazyEffect`; a bare `React.lazy` is refused by a test, so an instance that
adds its twentieth effect cannot bring the pop back.

## 4. A chunk that will not load

A preload that fails (offline, or a deploy that replaced the chunk's name) never fails the page: the loader's wait
settles either way, the page lands, and that effect's post shows its words, as the fallback does today. The failed
import is forgotten, so the next post that draws the card tries again. A slow chunk is waited for inside the load's
existing 20-second limit (the forum-load design, section 11), and Escape leaves the old page, as for any load.

## 5. The masks

- The wait depends on which cards are on the page, read from the document's plays as the caller already receives them.
  A card set face down is a card back in the document (`playOf`, `CARD_BACK`) and names no card, so its identity never
  decides what is waited for. The caller's own face-down cards (`faces`) draw no effect and are not read for this.
- After the warm-up every chunk is cached, and the wait is the same for every page.
- No response, payload or Realtime event is added.

## 6. Ways out

No state is added to a player, a character or a post. A load that waits on a chunk ends as every load does (section
4). A post whose effect cannot load shows its words.

## 7. Layers

- Engine: `lazyEffect` and the preload of a set of cards (`engine/ui/cards/`), the card keys a document draws, the
  loaders' wait (`engine/ui/screen-docs.ts`, `LoadEnv`), and the warm-up's function.
- Instance: `instances/divided-world/ui/cards.ts` builds its effects with `lazyEffect`, through the existing
  `CardUi.Effect` interface; the engine never names a card.
- Composition (`web/src/App.tsx`): gives the loaders the preload and starts the warm-up.

## 8. At a busy instance's scale

The wait per page grows with the number of distinct cards on it, fetched in parallel, and is zero once warmed. The
warm-up grows with the number of effects the instance ships, not with players, threads or Acts.

## 9. Open

- The ORIGIN box of a spun thread reads its origin post and that post's plays after it mounts
  (`engine/ui/spin/Origin.tsx`, `useOrigin`), so the box itself arrives after the page. That is outside this design;
  the warm-up makes its effects' code present when it does.
- An effect whose drawn size differs from its words, arriving on a post above the viewport (a live play heard before
  the warm-up finished), moves the page. The owner judged this fine for offscreen posts; it is not compensated here.
