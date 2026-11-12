# The conduct design session's boards (Task 6)

Record, written 2026-11-11. The boards for Task 6 of `docs/plans/2026-11-02-conduct-plan.md` (the report form and the
hidden note), drawn to "The confirmed brief" in that task. They are a reference for the look, not code to copy.

Each board is an `.html` with a PNG at 1440 and at 390 wide (2x) in `shots/`.

- `01-lens-foot`: a post with the Lens docked open on its Report tab (the board's own Report form, unchanged), and the
  plain "Report to admins" link at the Lens's foot under a hairline rule. On the phone the Lens is a sheet.
- `02-history`: the History panel open, three versions. The original and the current version each carry the link; the
  second version is the one-line note and no link.
- `03-dialog`: the report dialog over the thread, form state: seven radios from `instances/divided-world/ui/conduct.ts`,
  one selected, each with a "Read" link to `/conduct#<key>`, a typed note with its live count (109 of 1000). A centered
  modal at 1440, a sheet at 390 (drawn 1700 tall so the whole sheet shows; on a device it scrolls under the sticky title row).
- `04-dialog-states`: sent, limit (n = 3) and error, side by side (stacked on the phone).
- `05-hidden-post`: a hidden post (note strip for the body, postbit, line and footer kept) and a later post quoting it
  (the note inside the quote's frame, the cite and its links kept).
- `06-author-view`: the author's view of a post hidden until edited ("Only you see this" panel with their words and Edit),
  and the waiting state after a second hide and their edit. The two captions are the board's, not the screen's.

## How the boards are made

The boards use the app's real stylesheets, linked by relative path: `engine/ui/base.css` (and its `tokens.css`),
the instance's `theme.css` (Silver, light), the glass's `tokens.css`, `base.css`, `calm.css`, `parts.css`, `shell.css`,
and the `thread`, `postbit`, `bbcode`, `cards/lens`, `cards/visit`, `cards/forms` and `account` stylesheets, with the
real class names (`kb-act-*`, `kb-quote`, `kb-post-history`, `kb-glass-dialog*`, `kb-lens-*`, `kb-glass-button`...).

- `glass-tokens.css` is the glass's token values. The app sets them by script from `glass.json`; `mock.mjs` writes the
  same values by calling the engine's own `glassVars` (standard key) and adds the instance's `@font-face` rules from
  `instances/divided-world/ui/fonts/`. It is generated; do not edit it.
- `board.css` holds what is not in the app yet: the stage, the proposed pieces (`kb-hidden-note`, `kb-hidden-own`,
  `kb-report-*`, `kb-linklike`) and the captions. Every color in them is a glass token.
- `mock.mjs` writes the six HTML files and `glass-tokens.css`. A small script in each board sets what the app's JS
  decides from width: the Phone board's layout below 1152px, the stacked postbit at 640px and under.

Not faithful: the smoke (the field's rasters are made by script) is left out, so the glass shows its flat ground; the
Lens is placed by hand where `Float.tsx` would place it, and there is no HUD; the board's Verdana falls back to DejaVu Sans on
this machine; avatars are the initial's box; the Lens tabs are an existing Lens look, including its filled selected tab.

Re-shoot (Playwright with Chromium installed): `node mock.mjs && node shoot.mjs` from this folder, or with this folder's
path. `shoot.mjs` writes `shots/<board>-1440.png` and `-390.png`.

## Contrast

Measured from the token values: the note's text on its field 16.2:1, its link 16.3:1; the author panel's text 14.7:1;
the dialog's text on the ground 15.5 to 17.5:1; the kicker 16.2:1; every size is a glass size token. No `ready` (gold),
`salty` or `over` (pink) token is used by any piece added here.

## What a builder must keep

- The entry is a plain text link, a `<button>` drawn as a link: at the foot of the Lens's scrolling body under a hairline
  rule, and on each version row's line in History. Never a tab, mark, chip or button. A hidden version's row has none.
- The History row's link is named for its version ("Report to admins: edit 2") while its visible words stay "Report to admins".
- The dialog's kicker names the version ("Post #2 by Gravy Knight, current version"); the title is "Report to admins".
  The radio group has a visually hidden legend; each section's link reads "Read" and is named for its section.
- Send to admins is the glass's secondary (outlined) button and Cancel the quiet one, because the brief bars neon fill.
  The glass's primary is neon filled; if the owner wants it, it is one attribute.
- A state stands in the dialog (the limit instead of the form, sent instead of the form, the error above the form, which
  keeps the typed note). Its rule is the text color: no `over` red-pink. Focus goes to the heading.
- The note is one strip: dark field (`--kb-glass-field`) under a 1px pale-cyan rule, no left bar, no glow, no mark; the
  same node in a post, a History row and inside a quote's frame. The author's panel is muted (`--kb-glass-field-2`, a
  hairline all round), its words in the board's face, Edit a small glass button.
- Nothing animates.
