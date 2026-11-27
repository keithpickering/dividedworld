Record, written 2026-11-27.

# The first load has a meter: plan

Carries out `docs/plans/2026-11-27-first-load-splash-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task run only the
tests for the changed code (`npx vitest run <file>`; `npx playwright test <spec> --trace off` for Task 7). Run
`npm run typecheck` and `npm run build` once after the last task, with the tail in the PR. No deployed database,
bucket or connector is touched, and no migration is added. The Content-Security-Policy in `web/headers.ts` is not
changed; a task that finds it must change stops and asks.

**The layers.** Tasks 1 to 3, 5 and 6 are engine code under `engine/ui/` and name no instance; their tests use made-up
colors and hosts. Task 4's plugin is a tool, handed the house theme's file by `web/vite.config.ts`, the composition
root. Task 7 is the end-to-end proof.

## Task 1. One shortening of the address

Model: inline

**Files:** `engine/ui/frame/address.ts` (new), `engine/ui/frame/Loading.tsx`, `engine/ui/frame/Loading.test.tsx`.

Move `shortenPath` and its `UUID` pattern out of `Loading.tsx` into `address.ts`, unchanged, so the splash script
(Task 2) and the banner share one function (CLAUDE.md, "Two lists that must agree are one list"). `address.ts` imports
nothing from React or the DOM, since Task 4 bundles it into a classic script. `Loading.tsx` imports it from there;
`Loading.test.tsx`'s `shortenPath` cases import it from `address.ts`. This is a move: the existing tests are the red
run's guard and must stay green.

## Task 2. The splash script

Model: sonnet

**Files:** `engine/ui/frame/splash/boot.ts` (new), `engine/ui/frame/splash/boot.test.ts` (new),
`engine/ui/frame/splash/stored.ts` (new).

`stored.ts` holds what both sides of the storage share: `SPLASH_KEY = 'kb-splash'`, `SPLASH_TOKENS` (the seven tokens
of the design's section 3, in that order), the stored shape
`{ v: 1, mode: 'light' | 'dark', fixed: boolean, motion: 'reduce' | 'full' | null, tokens: Record<token, string> }`,
and `parseStored(text: string | null): Stored | null`, which returns null for anything not that shape, a token
missing, or a value that is not a plain color (`/^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|[a-z]+)$/iu`), so nothing
stored is ever put on the page as a `url()` or an expression.

`boot.ts` exports `bootSplash(env)`, where `env` is `{ doc, storage: Pick<Storage, 'getItem'> | null, dark: boolean,
now: () => number, setTimeout, limitMs }`, and is the classic script's whole body (Task 4 calls it with the real
globals and `LOAD_LIMIT_MS` from `engine/ui/ahead.ts`). In order:

1. **Colors, before first paint.** Add the class `kb-splash-js` to `doc.documentElement`. Read `SPLASH_KEY` inside try/catch (storage can throw). If `parseStored` gives a
   value and (`fixed`, or its `mode` matches `dark`), set each token on `doc.documentElement.style` as
   `--kb-splash-<name without --kb->` (`--kb-splash-page-bg`, `--kb-splash-meter-fill`, …) through `setProperty`, and
   set `data-kb-motion` from `motion` when it is not null. Otherwise set nothing: the stylesheet's fallback holds.
2. **The address.** When the document is parsed (`DOMContentLoaded`, or at once if `doc.readyState !== 'loading'`),
   fill `#kb-splash-text` with `Opening ${location.host}${shortenPath(location.pathname)}` plus `…` (as `Loading.tsx`
   builds its `opening` string), set `aria-busy="true"` on the root.
3. **The limit.** Start `setTimeout(limitMs)`. When it fires, if `#kb-splash` is still in the document and has no
   `data-kb-claimed`, replace its meter with `<h1>This page could not be displayed</h1>`, a `<p>` holding the address
   (`host` plus the shortened path), and `<a href>` to `location.href` reading "Try again"; remove `aria-busy`.
   Built with `createElement` and `textContent`, never `innerHTML`.

**Test first** (`boot.test.ts`, jsdom, fake timers): stored light colors applied on a light device and not on a dark
one when `fixed` is false; applied on either when `fixed`; a stored `url(x)` value, a missing token, unparseable JSON
and a `getItem` that throws each set nothing and throw nothing; the text for `/t/3f2a9c1e-…-…` reads
`Opening h.test/t/3f2a9c1e……`; at `limitMs - 1` nothing has changed and at `limitMs` the failure words and a Try again
link to the address are shown; a splash marked `data-kb-claimed` before the limit is left alone; a splash already
removed is left alone.

## Task 3. The splash's markup and stylesheet

Model: sonnet

**Files:** `engine/ui/frame/splash/splash.css` (new), `engine/ui/frame/splash/markup.ts` (new),
`engine/ui/frame/splash/markup.test.ts` (new).

`markup.ts` exports `SPLASH_HTML`, the static markup the plugin puts in `<body>` before `#root`, as a sibling so
`createRoot` never clears it:

```html
<div id="kb-splash" class="kb-splash">
  <p id="kb-splash-text" class="kb-splash-text"></p>
  <span class="kb-splash-meter" role="progressbar" aria-label="Loading the page"><span class="kb-splash-fill"></span></span>
</div>
<noscript><p class="kb-splash-noscript">This site needs JavaScript to run.</p></noscript>
```

`splash.css` draws it with the banner meter's look (`engine/ui/frame/frame.css`, `.kb-meter` and `.kb-meter-fill`:
96 by 12 px is the banner's; the splash's is the same well at twice the size, 192 by 24 px, blocks 16 px with 4 px
gaps), centered in the viewport, Verdana small for the text, every color a `var(--kb-splash-*)` whose fallback the
plugin writes (Task 4). It sets `html, body { background: var(--kb-splash-page-bg) }` only while `#kb-splash` is
present (`html:has(#kb-splash)`), so the page's own background governs once it is gone. The fill animates `width`
from 0 to 90% over 12 s with `cubic-bezier(0.1, 0.6, 0.3, 1)`; under reduced motion (the device's
unless `[data-kb-motion="full"]`, or `[data-kb-motion="reduce"]`, mirroring frame.css's two blocks) it animates with
`steps(9)` and no march. The failure words (Task 2, step 3) use the text color and a plain underlined link with a
visible focus ring. `.kb-splash` shows only under `html.kb-splash-js`, the class the script puts on the root first
(Task 2), so with JavaScript off the `noscript` line shows and no meter does.

**Test first** (`markup.test.ts`): `SPLASH_HTML` parses to one `#kb-splash` holding a `progressbar` with an
`aria-label` and no `aria-valuenow`, and holds no `style` attribute, `<style>` or `<script>` (the policy would block
them); `splash.css` uses no color literal outside the plugin's fallback block (every `color`, `background` and
`border-color` is a `var(--kb-splash-…)`).

## Task 4. The plugin

Model: sonnet

**Files:** `tools/splash.mjs` (new), `web/splash-plugin.test.ts` (new), `web/vite.config.ts`, `tools/theme-preview.mjs`.

`splashPlugin({ fallbackTheme })` takes the path of the theme whose colors are the fallback; `web/vite.config.ts`
passes `instances/divided-world/ui/theme.css` beside `themePreviewPlugin()`.

- **The fallback.** `tools/theme-preview.mjs`'s `previewOf(text, defaults)` gains a third parameter, the tokens to
  resolve, defaulting to `PREVIEW_TOKENS`, so the splash's seven are resolved by the same walk (theme blocks, then
  `engine/ui/tokens.css`). The plugin writes `:root { --kb-splash-…: <light> }` and, when the preview has `dark`,
  `@media (prefers-color-scheme: dark) { :root { … } }`, ahead of `splash.css`'s text, as one stylesheet. Saved values
  (Task 2) are set on the root's inline style, which wins over both.
- **The script.** `engine/ui/frame/splash/boot.ts` bundled with esbuild (Vite's own dependency) to one IIFE, with
  `LOAD_LIMIT_MS` and the real globals passed to `bootSplash`.
- **The page.** `transformIndexHtml` puts `<link rel="stylesheet" href=…>` and a classic, non-deferred
  `<script src=…>` at the start of `<head>` (before the module entry, so it runs before first paint), and
  `SPLASH_HTML` at the start of `<body>`. At build both files are emitted with `this.emitFile` as hashed assets; in
  the dev server they are answered by a middleware at `/@kayfabb/splash.css` and `/@kayfabb/splash.js`, rebuilt when
  their sources change.

**Test first** (`web/splash-plugin.test.ts`): run `vite build` on a temp root with the plugin and a two-mode theme of
made-up colors; the built `index.html` has no inline script or style, its first `<script>` in `<head>` is the
classic splash script, `#kb-splash` comes before `#root`, and the emitted stylesheet holds the theme's light colors on
`:root` and its dark ones under the media query. A second case with a light-only theme writes no dark block.

## Task 5. The hand-off

Model: sonnet

**Files:** `engine/ui/frame/splash/handoff.ts` (new), `engine/ui/frame/splash/handoff.test.tsx` (new),
`web/src/main.tsx`, `web/src/App.tsx`, `web/src/StartError.tsx`, `engine/ui/frame/Loading.tsx`,
`engine/ui/frame/Loading.test.tsx`, `web/src/App.test.tsx`.

`handoff.ts` exports:

- `claimSplash(doc = document)`: marks `#kb-splash` `data-kb-claimed`, so the script's limit stands down. `main.tsx`
  calls it first thing, before `createBackend()`.
- `useEndSplash()`: a layout effect that, once, removes `#kb-splash`, removes the root's `aria-busy` and
  `kb-splash-js`, and records that a splash was showing (a module-level flag). Called by what draws in place of the
  wait: `Gate` once `opened` (its children branch), `App`'s `failed` branch (around `CannotDisplay`), `StartError`,
  and the e2e story render in `main.tsx`. Gate's empty `main` does not call it, so the splash covers that wait.
- `takeSplashLanding(): boolean`: true once, if a splash was ended, then false.

`Loading.tsx`'s initial state reads `takeSplashLanding()` once (a `useState` initializer): when true, it starts with
`value` 100 and `loaded` true and schedules the same `HOLD_MS` empty that `land()` does.

**Test first:** `handoff.test.tsx`: claim marks the element; ending removes it and `aria-busy`, and a second end is a
no-op; `takeSplashLanding` is true once after an end and false with no splash. `Loading.test.tsx`: mounted after an
ended splash the meter reads 100 and the status "Page loaded", and after 250 ms reads 0 and the status is empty;
mounted with no splash it reads 0. `App.test.tsx`, with a `#kb-splash` put in the document before render: it is
present while boot is held and gone in the first render where `aria-busy` clears on `main`, in the same commit as the
banner; with boot rejected it is gone when `CannotDisplay` draws.

## Task 6. Remembering the colors

Model: sonnet

**Files:** `engine/ui/frame/splash/remember.ts` (new), `engine/ui/frame/splash/remember.test.ts` (new),
`engine/ui/appearance.ts`.

`rememberSplash(doc, appearance, storage, dark)` reads `getComputedStyle(doc.documentElement)` for `SPLASH_TOKENS`,
and, when every one is a value `parseStored` would accept, writes `{ v: 1, mode, fixed, motion, tokens }` to
`SPLASH_KEY` (try/catch: storage can throw or be full; a failure is silent and the fallback holds). `mode` is
`appearance.mode ?? (dark ? 'dark' : 'light')`, `fixed` is `appearance.mode !== null`, `motion` is
`appearance.motion`.

`applyAppearance` calls it once the theme link has loaded: on the link's `load` event when it set a new `href`, and at
once when the `href` was already there and `link.sheet` is set. It also calls it on the device's
`prefers-color-scheme` change while `mode` is null, through one listener held per document so repeated applies do
not stack listeners. Values written are the resolved tokens, so a theme's `var()` chain is followed by the browser.

**Test first** (`remember.test.ts`, jsdom with tokens set on the root): a write holds the seven values, the mode and
`fixed`; a missing token writes nothing; a `setItem` that throws throws nothing; what `rememberSplash` writes,
`parseStored` reads back equal (the two sides are one shape). In `engine/ui/appearance` tests: a new `href` writes on
`load` and not before; ten applies leave one media listener.

## Task 7. The first load, end to end

Model: sonnet

**Files:** `e2e/first-load.spec.ts` (new), `e2e/cost.json`.

Under `vite preview`, so the real Content-Security-Policy applies, with the console watched for CSP violations:

- With the first route's load held (route the screen request and release it by hand), the splash shows its meter and
  `Opening <host>/t/<8 chars>…`; on release the page draws, `#kb-splash` is gone, and the banner's
  `progressbar` reads 100 and then 0.
- After one visit under a dark-only theme, a reload with the load held shows the splash with that theme's
  `--kb-meter-fill` (computed color of `.kb-splash-fill`'s blocks), not the house fallback.
- With the bundle's module request aborted and `page.clock` installed, at 20 s the splash shows "This page could not
  be displayed" and a Try again link to the address; with the abort lifted, Try again loads the page.
- With JavaScript disabled, the `noscript` line shows and no meter does.

No CSP violation in any case. Add the spec to `e2e/cost.json` as `tools/check-e2e-cost.mjs` reports it needs.

## Review focus

- First paint: the classic script is in `<head>` before the stylesheet's paint and the module entry; check in the
  built `web/dist/index.html` that no ordering lets the house fallback flash before saved colors on a return visit.
- The splash never outlives the page: every branch that draws in place of Gate's wait calls `useEndSplash`, including
  any branch a later change adds to `App`; a splash left up over a drawn page covers it.
- The two limits: the script's limit stands down once the app claims the splash, so a slow but live first load ends in
  `CannotDisplay`, never in the script's failure words over a page that is about to draw.
- Stored values go onto the page through `setProperty` only after `parseStored`'s color test; nothing stored reaches
  `innerHTML`, a `url()` or an attribute.
- The `prefers-color-scheme` listener in `applyAppearance` is one per document, not one per apply.
