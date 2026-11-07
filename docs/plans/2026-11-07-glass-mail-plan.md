# The glass in email: plan

Record, written 2026-11-07. Carries out `docs/plans/2026-11-07-glass-mail-design.md` (its sections are cited as §N),
task by task. The mockup is `docs/research/2026-11-07-mail/`: `mock.mjs` holds the blocks as the owner confirmed them,
and `bake.mjs` holds the smoke and corner bake. Both are references for the look, not code to copy: neither escapes
text, reads a theme or handles Outlook.

Every task is test first: the test named, its red run recorded, then the code, then the green run. Task 4 adds a check,
`tools/check-mail.mjs`, with its test, `tools/test-mail.mjs`, which plants each poison listed there and watches the check
fail on it before the check is trusted. No task touches SQL or a deployed service. `supabase config push`, which sends
the new templates to the deployed project, is the owner's step. Each task says its layer.

## Task 1. The shell (engine)

Model: sonnet

**Layer:** engine. It names no instance, imports no DOM, React or vendor client, and runs under Node's type stripping,
Deno and Vite.

**`engine/mail/types.ts`:**
- `MailTheme`, with these fields:
  - `name`: the instance's name, as the masthead and the foot write it.
  - `site`: an absolute `https:` URL.
  - `assets`: absolute URLs for `smoke`, `cutPanel`, `cutButton` and `coin`.
  - `fonts`: each with `family`, `url`, `weight` and `style`.
  - `stacks`: `display` and `body`, each a full CSS font stack, fallback included.
  - `colors`: these keys, each a 6-digit hex: `ground`, `field`, `text`, `text2`, `hi`, `pale`, `neon`, `neonText`,
    `violet` and `ink`.
- `Block`: a union of the seven blocks in §4, `heading`, `paragraph`, `code`, `button`, `facts`, `quote` and `note`, each
  with its fields. `button` has `href`, `code` has `label` and `code`, `facts` has `rows: [label, value][]`, and `quote`
  has `label` and `words`.
- `Mail`: `subject`, `preheader` and `blocks`.

**`engine/mail/render.ts`:**
- `renderHtml(theme, mail): string`. It is a table layout with every style inline, plus one `<style>` in the head for
  the following:
  - the `@font-face` rules;
  - the under-620px padding;
  - the Gmail blend wrappers (§3, dark mode);
  - an `<!--[if mso]>` block that sets Arial and Impact for Outlook on Windows.

  It draws:
  - the masthead with the smoke as `background` and as a VML `v:rect`/`v:fill` for Outlook;
  - the seam's four rows (§3);
  - the blocks;
  - the foot;
  - the coin, last and centered.

  Text is escaped (`&`, `<`, `>`, `"` and `'`). An `href` is escaped as an attribute and must be `https:`, `mailto:` or
  exactly a slot the caller declares (Task 2's Supabase slots). Anything else throws, naming the block. No style ever
  writes `border-radius`, `box-shadow` or `transform`.
- `renderText(mail): string`. The plain-text part:
  - headings in capitals;
  - facts as `Label: value`;
  - the quote indented with `> `;
  - a button as `Label: <href>`;
  - the code on a line of its own.
- `blend(color, over, alpha)`: the shell's only arithmetic on colors. It is used for the seam rows, the rules and the
  quote's edge (§3).

**Tests first, `engine/mail/render.test.ts`** (node:test, under `npm run test:engine`), over a fixture theme the test
builds itself:
- Each block renders, and its words appear once, escaped. A heading of `<b>&` comes out as `&lt;b&gt;&amp;`.
- The output holds no `border-radius`, no `box-shadow` and no `transform`.
- Every `<img>` has `width`, `height` and `alt`.
- Every `href` is `https:`, `mailto:` or a declared slot. A `javascript:` href throws.
- The coin is the last `<img>` in the document.
- Every color in the output is one of the theme's colors or a `blend` of two of them. The test collects every hex in the
  HTML and refuses a stray literal.
- `renderText` holds every block's words and no markup.
- The VML masthead and the `[if mso]` block are present. The `color-scheme` meta is `dark`.

## Task 2. Divided World's theme and the two Auth emails (instance, engine, composition root)

Model: sonnet

**`engine/mail/auth.ts`** (engine): `signIn(theme, { code, link })` and `signUp(theme, { code, link })` return a
`Mail` in the words of §2.5:
- Sign-in:
  - heading: "Sign in to {name}";
  - paragraph: "Type this code where you asked for it, or use the button to sign in.";
  - code block, labeled "Your code";
  - button: "Sign in";
  - note: "If you did not ask to sign in, you can ignore this email: nobody can sign in without the code or the link.";
  - preheader: "Your code is {code}.".
- Sign-up is the same, with these differences:
  - heading: "Finish signing up for {name}";
  - paragraph: "… or use the button to finish signing up.";
  - button: "Finish signing up";
  - note: "If you did not ask to sign up, you can ignore this email: nothing is made without the code or the link.".

  These closing sentences are today's, word for word (`supabase/templates/sign-up.html`).

**`instances/divided-world/mail/index.ts`** (instance): `mailTheme: MailTheme`.
- It imports `../ui/glass.json` with `with { type: 'json' }` and reads each color from the standard key by token name:
  - `ground` from `--kb-glass-ground`, `field` from `--kb-glass-field` and `text` from `--kb-glass-text`;
  - `text2`, `hi`, `pale`, `neon` and `violet` from their own tokens;
  - `neonText` from `--kb-glass-neon-text`;
  - `ink` from `--kb-glass-ink-neon`.

  A token that is missing, or is not a 6-digit hex, throws, naming it. There is no second list of colors (§3).
- `site` is `https://dw.gripe`. The assets are under `https://dw.gripe/mail/`, at the names Task 3 writes.
- The fonts are Anton 400 and Barlow Condensed 500, 600 and 700, at `https://dw.gripe/mail/fonts/<file>`.
- The stacks are §3's fallbacks.

**`supabase/functions/_shared/mail/auth.ts`** (composition root): `authTemplates(): { path, html }[]`. It renders
`signIn` and `signUp` with the deployed instance's `mailTheme`, and passes `{{ .Token }}` as the code and
`{{ .ConfirmationURL }}` as the link, both declared as slots. It returns the paths `supabase/templates/sign-in.html`
and `supabase/templates/sign-up.html`.

**Regenerate** the two templates with Task 4's `--write`, or with a one-line call to `authTemplates()` until Task 4
lands, and commit them. `supabase/config.toml`'s subjects are unchanged.

**Tests first:**
- `engine/mail/auth.test.ts`: each email's words, the name slot, and a code of `{{ .Token }}` surviving rendering
  unchanged.
- `instances/divided-world/mail/index.test.ts`: every color equals its token in `glass.json`, and each asset URL is
  under `site`.
- `supabase/functions/_shared/mail/auth.test.ts`: each template contains `{{ .Token }}` and `{{ .ConfirmationURL }}`,
  and no other `{{`.

## Task 3. The baked assets (engine UI, tooling, instance)

Model: sonnet

**`engine/ui/glass/field.ts`:** export the layer's SVG function, now `svgOf`, as `fieldLayerSvg(layer, size, pixels)`,
unchanged. `rasterize` keeps calling it. This keeps one definition of how a layer is drawn: the bake must not copy it,
as the mockup's `bake.mjs` did.

**`tools/make-mail-assets.mjs <instance ui folder>`** is run by hand, never by the build, because it draws in Chromium,
which the build does not have. It is in the shape of `tools/make-icons.mjs`, uses the Chromium the environment
provides, and names no instance. It writes the following to `<ui>/public/mail/`:
- `smoke.jpg`: 1200 by 360 pixels (600 by 180 at 2x). It is the field's wide layers in the `page` recipe's colors and
  opacities, each as an element masked by `fieldLayerSvg`, over the ground, as `Smoke.tsx` composites them. A linear
  fade to the ground runs over the lower 60% (§2.3). JPEG quality is chosen so the file stays at or under 60KB.
- `cut-panel.png` and `cut-button.png`: 24 by 24 pixels (12 at 2x), as in `bake.mjs`.
  - The panel's corner is the cut-away triangle in the ground over `--kb-glass-field`, with the diagonal edge in
    `--kb-glass-neon`, top right.
  - The button's is the ground over `--kb-glass-neon`, bottom right.
  - Every pixel is opaque.
- `coin.png`: 80 by 80 pixels, `ui/icon/coin.svg` drawn on the ground, opaque.
- `fonts/`: the four woff2 files of Task 2's theme, copied byte for byte from `<ui>/fonts/`.

It also writes `<ui>/../mail/assets.json`, the SHA-256 of each output and of each source:
- `glass.json`'s `smoke.field.layers`, its `smoke.recipes.page` and the standard key's ground, field and neon, each
  read as canonical JSON (keys sorted);
- `coin.svg`;
- each font.

Run it for Divided World and commit the outputs and the record.

**Test first:** `engine/ui/glass/field.test.ts` gains a case showing that `fieldLayerSvg` returns the SVG `rasterize`
draws. The existing raster tests pass unchanged.

## Task 4. The guard (tooling)

Model: sonnet

**`tools/check-mail.mjs [--write]`**, with `mailFaults({ ui, mailDir, templates, rendered })` exported and pure over
what it is handed. `main()` reads every instance with a `mail/` folder, and the composition root's `authTemplates()`.
It fails, naming the file and what was found, when:
1. one of the four images or four fonts in `public/mail/` is missing;
2. `smoke.jpg` is not a 1200 by 360 JPEG, or is over 60KB; or a corner is not a 24 by 24 opaque PNG; or `coin.png` is
   not 80 by 80 and opaque;
3. a font in `public/mail/fonts/` differs from its namesake in `ui/fonts/`;
4. a hash in `assets.json` differs from its file or from its canonical source slice. A change to the field, the `page`
   recipe or the three colors fails here, saying `node tools/make-mail-assets.mjs <ui>` makes the assets again;
5. a committed `supabase/templates/*.html` differs from what `authTemplates()` writes. `--write` writes them and then
   checks, as `check-glass-contrast.mjs --write` does;
6. a rendered email is over 100KB, which is where Gmail clips;
7. a theme's text colors (`text`, `text2`, `hi`, `neonText` and `violet`, the last as label text) are under 4.5:1
   against `ground` or against `field`, or `ink` is under 4.5:1 on `neon`;
8. the masthead name's color is under 3:1 against the `page` recipe's full worst. It is read with
   `tools/check-glass-contrast.mjs`'s exported `recipeWorsts` and `contrastRatio`, never a second model.

**`tools/test-mail.mjs`**, in the shape of `tools/test-icons.mjs` (scratch folders, each case through the function and
through the command's exit code, with fixtures written by the test). A clean fixture passes. Then one poison per case,
each watched red:
- `coin.png` is missing;
- `smoke.jpg` is 1200 by 300;
- `smoke.jpg` is padded to 61KB;
- a corner has one pixel at alpha 254;
- a font in `public/mail/fonts/` has one byte changed;
- `glass.json`'s `page` recipe opacity changes after `assets.json` was written;
- a committed template has one word changed;
- a rendered email is padded past 100KB;
- `text2` is darkened to fail 4.5:1 on `field`;
- the name color is darkened to fail 3:1 on the smoke's worst.

**`tools/build.mjs`:** add `node tools/test-mail.mjs` and then `node tools/check-mail.mjs` to `STEPS`, after the glass
contrast pair. `tools/test-build-steps.mjs` passes unchanged.

## Task 5. The site serves the mail's files (web)

Model: inline

- `web/headers.ts` gains `MAIL_HEADERS` for `/mail/*`: `Access-Control-Allow-Origin: *`, so a mail client that checks
  CORS may load the fonts, and `Cache-Control: public, max-age=86400`. The file names are stable, so a re-bake reaches
  mail already sent within a day.
- `netlify.toml` repeats the same headers in a `[[headers]] for = "/mail/*"` block.
- `web/headers.test.tsx` gains the case that the two agree, and its red run is the TOML block missing.
- `tools/check-web-bundle.mjs` is not changed. `tools/check-mail.mjs` already holds the source files, and Vite copies
  `public/` as it is.

## Task 6. Seeing it (instance UI, e2e)

Model: sonnet

- **`instances/divided-world/ui/mail.stories.tsx`:** a Storybook story for each email: sign-in, sign-up, and a
  hidden-post fixture in the mockup's stand-in words. Each is rendered with `renderHtml` into an `<iframe srcdoc>` 600
  wide, and at 320. Its theme is `mailTheme`, with the asset URLs pointed at Storybook's static `public/`
  (`.storybook/main.ts` `staticDirs`, added if missing). One control turns images off by swapping the asset URLs for
  ones that do not resolve.
- **`e2e/mail.spec.ts`**, under the e2e run (`tools/test-e2e.mjs`, outside the build). For each Auth template, with the
  slots filled with a sample code and link, at 600px and at 320px, with images on and off, it checks:
  - the document never scrolls sideways;
  - the code's text is selectable as one run of six digits;
  - the button's link is the sample link;
  - every text node's computed color meets 4.5:1 on the cell behind it, read as `e2e/glass-text.spec.ts` reads it.

  A screenshot of each case is attached to the run.

## Task 7. The owner's check after the first deploy

Model: inline

The build session does not run this task: build sessions touch no deployed service. It writes the steps into its PR's
description for the owner:
1. `supabase config push` sends the templates.
2. Sign in once to an address on Gmail (iOS app and web), Apple Mail, and Outlook on Windows.
3. Compare each against the mockup's screenshots.

The owner's findings, if any, become issues.

## Review focus

- Gmail's iOS app inverts colors on a dark email. The blend-mode wrappers are the known fix, and no test here can show
  they hold. Read Task 1's CSS against that method, and Task 7's Gmail result before calling the dark mode done.
- Supabase Auth runs the template through Go's `text/template`. Any other `{{` in the output would break the template or
  render as something else. Task 2's test reads for it, so check the escaping cannot produce one.
- The fonts and images load from `https://dw.gripe/mail/` and are the same for every recipient. Check that no task adds
  a query string, a per-account path or a cache-buster that could tell one recipient's load from another's (§6).
- The assets' record must fail when the `page` recipe or the field changes, or the email's smoke drifts from the glass's
  in silence.
- The conduct plan's Task 3 (amended 2026-11-07) gains an HTML part through this shell. Its build must render each
  template through `renderHtml` and `renderText` from one `Mail`, never as a second set of words.
