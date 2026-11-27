Record, written 2026-11-27.

# The first load has a meter: design

Designed with the owner on 2026-11-27. The plan is `docs/plans/2026-11-27-first-load-splash-plan.md`.

## 1. The problem

After the first load, every click shows the banner's meter (`engine/ui/frame/Loading.tsx`, the forum-load design,
`docs/plans/2026-11-05-forum-load-design.md`, section 7), so a player knows a page is on its way. A fresh load shows
nothing. It is blank twice:

1. Before the bundle runs: `web/index.html` holds an empty `<div id="root">`.
2. While boot and the first route's load are out: `Gate` (`web/src/App.tsx`) draws an empty
   `<main className="kb-page" aria-busy="true" />`, with no banner and so no meter. The forum-load design chose to draw
   frame, HUD and page once, together (section 3), so the banner cannot simply be drawn early.

## 2. What a fresh load shows

**Decided** (the owner chose the splash meter). A lone copy of the banner's sunken meter, centered on the empty page,
with `Opening dw.gripe/t/3f2a9c1e…` above it: the address being opened, shortened exactly as the banner shortens it
(each UUID segment to eight characters and an ellipsis, no query, no fragment). It is in `index.html`'s own markup, so
it shows before the bundle has downloaded, and it stays up through Gate's wait. The page still draws once, frame, HUD
and screen together.

- The page's Content-Security-Policy (`web/headers.ts`) is `script-src 'self'` and `style-src 'self'`: no inline
  script, no `<style>`, no `style` attribute. So the splash is a classic script and a stylesheet served from the
  site's own origin, and its colors are set through the CSSOM, which the policy allows (as `applyBannerArt` already
  does). The policy is unchanged.
- It trickles toward 90% on a CSS animation that slows as it climbs (an ease-out over about 12 seconds, near the
  banner's `90 - (90 - p) * 0.82` per 120 ms), with the banner's march of blocks. Reduced motion (the device's, or the
  last-known override, section 3) makes it step, as the banner's meter steps.
- It is a `progressbar` with no `aria-valuenow` (it cannot report a true value; the banner's can't either before a
  page lands, but it reports its trickle), labelled "Loading the page", and the root is `aria-busy` until the page
  draws.

Weighed: drawing the banner early, with the real meter, which brings back the frame's pop-in the forum-load design
removed and still leaves the pre-bundle phase blank; and an IE-style status page with stage text ("Contacting…"),
whose stages are only as true as the three reads behind them.

## 3. Its colors

**Decided** (the owner chose the last theme used). Before boot nothing knows the account's theme, so the page keeps
it on the device:

- Whenever a theme's stylesheet is on the page and applied, the engine reads the resolved values of the seven tokens
  the splash draws with (`--kb-page-bg`, `--kb-fg`, `--kb-meter-face`, `--kb-meter-lo`, `--kb-meter-hi`,
  `--kb-meter-dark`, `--kb-meter-fill`) off the root and saves them to `localStorage` under `kb-splash`, with the mode
  they were read in, whether that mode was fixed (by the theme or the player) or the device's, and the motion override.
  It saves values, not the theme's stylesheet address: Vite hashes that address, so a deploy would leave a saved one
  pointing at nothing.
- The splash script, in the head before first paint, puts the saved values on the root as `--kb-splash-*`. Saved
  values that followed the device are used only while the device is still in the mode they were read in.
- A first visit, blocked storage, a value that does not parse, or a device that changed mode: the splash stylesheet's
  own fallback, the house theme's light and dark values under `prefers-color-scheme`, written at build time from the
  house theme's file by the same resolver the theme picker's miniatures use (`tools/theme-preview.mjs`), so the
  fallback cannot drift from the theme.

Weighed: the device's light or dark alone, which flips the colors on landing for anyone on another theme; and one
fixed neutral look, which always flips.

## 4. The hand-off

**Decided** (the owner chose to finish in the banner). The moment the first page draws, the splash is taken out of the
document in the same commit, with no delay added for show (forum-load design, section 7). The banner's meter mounts
full, holds 250 ms (IE's "Done"), says "Page loaded" in its status, then empties: the landing the banner already shows
after a click, so the fill a player was waiting for happens in the meter they will use from then on.

Weighed: filling the splash and holding it before the swap, which adds a quarter second to every fresh load; and the
splash vanishing with the banner's meter empty, so the load is never seen to finish.

## 5. Ways out

The splash is a state a player's screen can be put in, so each way it ends is named (CLAUDE.md, "No player is ever
stuck"):

- **The page lands**: section 4.
- **The first load fails or runs past 20 seconds**: `CannotDisplay` takes the page, with Try again, as today; the
  splash is taken out when it draws.
- **The app cannot start**: `StartError` takes the page; the splash is taken out when it draws.
- **The bundle never runs** (blocked, a 404 after a deploy, a browser too old for module scripts): the splash script
  waits `LOAD_LIMIT_MS` (`engine/ui/ahead.ts`, 20 seconds, the app's own limit, so the two are one number) from the
  page's start. If the app has not claimed the splash by then, the meter gives way to plain words, "This page could
  not be displayed", the address, and a Try again link that reloads it. The app claims the splash the moment its
  bundle runs, and from then on the app's own limit governs.
- **JavaScript is off**: a `<noscript>` line says the site needs JavaScript, and the splash's meter is not drawn.

The failure words are out of character and plain (CLAUDE.md, "The fiction may lie; the log never does").

## 6. The masks

Nothing here is computed from a private fact. The splash shows the address the reader asked for, on their own screen.
The saved colors never leave the device and are never sent. On a device two players share, the second sees the first's
theme colors before boot; a theme is not a private fact, and the masks are not touched. No response, payload,
Realtime event or timing is added.

## 7. The layers

The splash is the engine's: its markup, script, stylesheet and hand-off live in `engine/ui/frame/splash/` and name no
instance. A Vite plugin, `tools/splash.mjs`, beside `tools/theme-preview.mjs`, puts it into `index.html` at build and
in the dev server. The composition root (`web/vite.config.ts`) hands the plugin the house theme's file for the
fallback colors, so the engine never names Divided World; an instance contributes only the tokens its themes already
set.

## 8. Open

Nothing.
