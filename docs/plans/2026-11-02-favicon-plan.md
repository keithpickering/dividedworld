# Divided World's favicon: plan

Record, written 2026-11-02. Carries out `docs/plans/2026-11-02-favicon-design.md` (its sections are cited as §N). The
art is `docs/research/2026-11-02-favicon/coin-16.png` (the owner's sprite) and `docs/research/2026-11-02-favicon/coin.svg`
(the B1 vector); a task copies them, and never redraws either.

Every task is test first: the test named, its red run recorded, then the code, then the green run. Task 1 adds a check,
`tools/check-icons.mjs`, with its test, `tools/test-icons.mjs`, which plants each poison below and watches the check
fail on it before the check is trusted. No task touches SQL, the engine or a deployed service. Each task says its layer.

## Task 1. The check, red on the repository as it stands (§3, §4)

**Layer:** tooling (`tools/`), naming no instance.

**`tools/icons.mjs`** (the shared, pure part; no browser, no dependency beyond Node):
- `readIco(buffer)`: parses an ICO's header and directory (`reserved 0`, `type 1`, the count, then each 16-byte entry)
  and returns each image's declared width and height and its bytes. Throws, naming what it found, on a header that is
  not an ICO, an entry whose offset and length run past the file, or an image that is not a PNG (a BMP image inside an
  ICO is legal but is not what §3 ships, and the check would otherwise have to decode it).
- `writeIco(pngs)`: the inverse, for Task 2's script: a header, one entry per PNG (a width or height of 256 written as
  0, as the format says), the PNGs in order.
- `pngInfo(buffer)`: the PNG signature, then IHDR's width, height, bit depth and color type; and `pngOpaque(buffer)`,
  which inflates the IDAT chunks with `node:zlib`, undoes the five row filters and says whether every alpha sample is
  255 (true outright for color types without alpha). Only 8-bit, non-interlaced images need to be read: the ones Task 2
  writes and the owner's sprite are all of that kind, and any other kind throws, naming it.
- `sha256(buffer)`.

**`tools/check-icons.mjs`**, `iconFaults({ instanceUi, indexHtml, dist })` exported and pure over the folders it is
handed, with `main()` passing every `instances/*/ui/` that has an `icon/` folder, `web/index.html` and `web/dist/`.
For each instance it reads `icon/coin-16.png`, `icon/coin.svg`, `icon/icons.json`, `public/favicon.ico` and
`public/apple-touch-icon.png`, and fails, naming the file and what was found, when:
1. any of the five is missing;
2. the ICO does not hold exactly three images, of 16, 32 and 48px, each a PNG whose IHDR agrees with its entry;
3. the ICO's 16px image is not `coin-16.png` byte for byte (§2: the 16px icon is the owner's sprite, never a
   rendering);
4. `apple-touch-icon.png` is not 180 by 180, or has a pixel whose alpha is below 255 (§3: iOS fills it with black);
5. a SHA-256 in `icons.json` (`sources["coin-16.png"]`, `sources["coin.svg"]`, `outputs["favicon.ico"]`,
   `outputs["apple-touch-icon.png"]`) differs from the file's, saying which, and that
   `node tools/make-icons.mjs <icon folder> <public folder>` makes them again (§4).

And for the site:
6. `web/index.html` has no `<link rel="icon" href="/favicon.ico" …>` or no
   `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`;
7. `web/dist/favicon.ico` or `web/dist/apple-touch-icon.png` is missing, or is not byte for byte one instance's
   `public/` file of the same name (the build copied the wrong folder, or none, and the single-page redirect would
   answer the request with HTML); an empty or missing `web/dist/` fails as "nothing built", as
   `tools/check-web-bundle.mjs` does.

**`tools/test-icons.mjs`**, in the shape of `tools/test-web-bundle.mjs` (scratch folders under `os.tmpdir()`, each case
through the function and through the command's exit code). The fixtures are made in the test from bytes it writes
itself with `writeIco` and a minimal PNG writer in the test (an IHDR, one IDAT from `zlib.deflateSync`, an IEND), so the
test reads no file in the repository. A clean fixture passes; then one poison per failure above, each watched red:
- a missing `icons.json`; a missing `apple-touch-icon.png`;
- an ICO with only 16 and 32; an ICO whose 32px entry holds a 31px PNG; a BMP image in an ICO; a file that is not an ICO;
- an ICO whose 16px image is a different PNG from `coin-16.png` (one pixel changed);
- a 180px apple icon with one pixel at alpha 254; a 192px apple icon;
- `coin-16.png` changed after `icons.json` was written (the record's source hash is stale); the same for `coin.svg`;
  `favicon.ico` replaced after the record was written;
- an `index.html` without the icon link; one without the apple-touch link;
- a dist whose `favicon.ico` differs from the instance's; a dist without `apple-touch-icon.png`; an empty dist.
- And the parser's own refusals: a PNG with color type 3 (palette) or bit depth 16, and an interlaced PNG, each throw
  naming what they are; `pngOpaque` is checked on a fixture using each of the five row filters, so a filter undone
  wrong shows as a wrong answer.

**`tools/build.mjs`:** `node tools/test-icons.mjs` joins the pool (beside the other tests, before the check it drives);
`node tools/check-icons.mjs` goes after `node tools/check-web-bundle.mjs`, into `SERIAL`, and into `AFTER` against
`npm run build:web`, because it reads `web/dist/`. `tools/test-build-steps.mjs` passes with the new entries.

**Red run:** `node tools/check-icons.mjs` on the repository as it stands finds no instance with an `icon/` folder and
fails on (6) and (7). Record that output.

## Task 2. The icons, made and committed (§2, §3, §4)

**Layer:** tooling (`tools/make-icons.mjs`, naming no instance) and instance (the files).

**Copy the art:** `docs/research/2026-11-02-favicon/coin-16.png` to `instances/divided-world/ui/icon/coin-16.png`, and
`docs/research/2026-11-02-favicon/coin.svg` to `instances/divided-world/ui/icon/coin.svg`, unchanged (compare with
`cmp`).

**`tools/make-icons.mjs <icon folder> <public folder>`**, run by hand, never by the build (it needs a browser; it is not
a `check-*` or `test-*` file, so `OUTSIDE_THE_BUILD` does not list it):
- launches Chromium through `playwright` (as `tools/test-e2e.mjs`'s run does) and renders `coin.svg` with a transparent
  background (`omitBackground`) at 32 and 48px, a page whose viewport is the size and whose one element is the SVG
  as an `<img>` at that size, `deviceScaleFactor: 1`;
- renders the 180px home-screen icon: a 180px page of `#07050d` with the SVG centered at 148px, screenshotted without
  `omitBackground`, so every pixel is opaque;
- writes `favicon.ico` with `writeIco([coin-16.png as read, the 32, the 48])` and `apple-touch-icon.png` to the public
  folder, then `icons.json` to the icon folder: `{ "sources": {…}, "outputs": {…} }`, SHA-256 hex of each file, keys
  sorted, so a rerun on unchanged sources writes the same record if Chromium draws the same pixels (Review focus);
- prints each file it wrote with its size.

**Tests first:** none of its own; Task 1's check is its test. Run `node tools/check-icons.mjs` before the script (red:
(1) the public files are missing), then the script, then the check (green on (1) to (5); (6) and (7) still red until
Task 3). Look at the 32px and 48px images and the home-screen icon at 1x and enlarged, beside
`docs/research/2026-11-02-favicon/q5-vector-beside-sprite.png`, and put the comparison in the PR.

## Task 3. The site serves them (§3, §5)

**Layer:** composition root (`web/`).

- **`web/vite.config.ts`:** `publicDir` set to the repository's `instances/divided-world/ui/public/`, resolved from
  `repo` as the file already does, with a line in its header comment saying an instance's `ui/public/` is the site's
  root (§5). `icon/` is a sibling of `public/`, so the sources are not served.
- **`web/index.html`:** in `<head>`, after the title, `<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />`
  and `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`.
- **`e2e/icons.spec.ts`** (new, test first, red before the two changes above): against `vite preview` of the e2e build,
  `GET /favicon.ico` answers 200 with a body starting `00 00 01 00` and a content type that is not `text/html`, and
  `GET /apple-touch-icon.png` answers 200 with the PNG signature. Red today: both are answered with `index.html`.
- `e2e/csp.spec.ts` passes unchanged: both files are same-origin images, which `img-src 'self'` already allows.

**Green:** `npm run build` (the full list, with `check-icons` green on all seven), and `npm run test:e2e` with the new
spec.

## Review focus

- Whether Chromium's rendering of `coin.svg` is stable across machines and versions: the record pins the outputs'
  hashes, so a rerun of `make-icons` on another machine may rewrite `favicon.ico` with no source changed. That is
  allowed (the check reads the record against the committed files, not a re-render), but the PR should say on which
  Chromium the committed files were made.
- That the ICO's 16px image is the sprite's own bytes, not a re-encode: a PNG decoded and written again can change its
  bytes and, through a color profile or gamma chunk, its colors.
- That `publicDir` copies nothing but `public/`: a `web/dist/` holding `coin.svg`, `coin-16.png` or `icons.json` means
  the folder named is the wrong one.
- That Netlify serves `/favicon.ico` as the file and not through the `/*` redirect: a rewrite without `force` yields to
  an existing file, which is what the design relies on (`netlify.toml`); worth confirming on the first deploy preview.
- That `tools/icons.mjs`'s PNG reader refuses what it cannot read rather than misreading it: a 16-bit or palette sprite
  from a future redraw must fail the check by name, never pass `pngOpaque` by accident.
