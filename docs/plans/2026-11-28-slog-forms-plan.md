# Console Slog draws every other effect: the plan

Record, written 2026-11-28. Carries out `docs/plans/2026-11-28-slog-forms-design.md` (#1276). It builds on #1273's
Console Slog (`instances/divided-world/ui/console-slog/`). Eight tasks, in order: the engine first, then the terminal,
then each card's form. Each goes test first, with its red run shown. Postgres on localhost only; no task touches a
deployed database, bucket or connector, and none changes an Act already written. Run `npm run typecheck` and
`npm run build` once after the last task, with the tail in the PR.

The bench, `docs/research/2026-11-28-slog-forms/01-forms.html`, opened in a browser, is the look and feel to match; its
code is a reference, never copied.

## Task 1. The engine: a card that redraws the words

Model: sonnet

Files: `engine/ui/cards/types.ts`, `engine/ui/cards/Effects.tsx`, `engine/ui/tips/problems.ts`, their tests
(`engine/ui/cards/Effects.test.tsx`, `engine/ui/tips/problems.test.ts`).

- `CardUi.redraws?: true`, with its doc comment from the design's section 1.
- `nestOrder` returns a fifth group, `redraws`: a card with `redraws`, on the post's own reach, taken out of every other
  group and wrapped first (inside `writing`). `PostEffects`, `MomentEffects` and `VersionEffects` wrap it first.
- `EffectProps.redrawn?: true`: set by `PostEffects` (and the moment and version wraps) on every effect but a redrawing
  card's own, while the post has a live play of a redrawing card whose id is not in its layer's `released`. Read from
  the plays and `released` alone, never from who owns anything.
- `EffectProps.body?: string`: given to a redrawing card only: the BBCode source the screen draws for this post. That is
  the drawn version's body under a live rewind (`rewound.rewind.version`), the moment's version in a moment, and
  `post.currentPayload.body` otherwise. Find where `bodyOf(version)` gets its version, and pass the same version's body.
- `instanceUiProblems`: a `redraws` card that is also `takeover`, `coversRow`, `fillsRow` or `foldsRow`, whose rules
  `writes`, or that has no `Effect`, is a problem named in plain words.

Tests first:
- `nestOrder` puts a `redraws` card innermost, before the writing cards, whether it comes first or last in play order;
  a `beneath` card, a character-reach card and a writing card are all outside it.
- A mounted `PostEffects` with a redrawing play and a second card: the second gets `redrawn` until the play is in
  `released`, and then it does not. The redrawing card gets `body`: the rewound version's body under a rewind, the
  current one otherwise.
- The check's poisons, each red once: `redraws` with `takeover`; with `coversRow`; with `fillsRow`; with `foldsRow`; on
  a writing card; with no `Effect`.

## Task 2. The engine: the forms' two channels

Model: sonnet

Files: `engine/ui/bbcode/layers.tsx`, `engine/ui/cards/ground.tsx` (new), their tests.

- `TextRun.plain?: PlainForm`, the vocabulary of the design's section 2: `text`, `before`, `after`,
  `below: { art(column, columns, label): string[]; label: string }`, `appendix: { name; text }`,
  `ink: 'inverse' | 'bright'`, `near(share)`, `typed()`. A doc comment says a redrawer reads them, and the renderer
  (`render.tsx`) ignores them.
- `GroundLayer` and `useGround()`, shaped as `TextLayer` is: `{ inks?: readonly string[]; sparkle?: { glyphs: string;
  density: number; seed: number; still: boolean } }`. Nested layers combine: the innermost's `inks` win, and every
  `sparkle` is kept.
- `plainOf(text, runs)` (pure, in `layers.tsx`): the visible text cut into pieces, each the post's own characters or a
  run's form, using `stretchesOf`'s rule for which run is on top. Each piece carries the visible offsets it stands for, so
  a redrawer can count the post's own units under it.

Tests first: `plainOf` on overlapping runs (a replace over a wrap; two wraps by `z`); a run with `text` stands for its
words' offsets; a mark with an `appendix` at the text's end; the renderer draws the same DOM with and without `plain` on
a run. `GroundLayer`: inner inks win, and sparkles add up.

## Task 3. The terminal types the forms

Model: sonnet

Files: `instances/divided-world/ui/console-slog/slog.ts`, `Effect.tsx`, `slog.css`, their tests.

- `ui.ts` sets `redraws: true`. The effect types `EffectProps.body`, falling back to `post.currentPayload.body`.
- **Units.** `unitsOf` gives each char unit that stands for the post's visible text its visible offset (`at`), using
  `visibleWalk`'s offsets, so a quote, code, a link's address and the `[IMG]` lines are units with no offset. The forms
  are laid in with `plainOf` over `useTextLayers()`: a `text` piece replaces its offsets' units, and `before`, `after` and
  `appendix` add units with `form: true`. Each unit carries the run's `ink`.
- **Lines.** The terminal wraps its own lines: it measures its columns (the width of its `pre` over one character of its
  face, as the bench's `cols()`), wraps at word boundaries, and lays each `below` under the line its run's last
  character ends on, calling `art(column, columns, label)`. Each art line is a unit with `form: true`, and its leading
  spaces print with its first character. Remeasured on the terminal's resize, never per press.
- **The place.** The memory keeps `{ shown }` as the post's own units out (those with an offset, plus images' bands and
  the non-visible prints); the units on screen are counted from it. A press reveals `pressWorth` units of any kind. A
  form before the place is drawn whole.
- **Hooks.** On each press, each run whose end is ahead within `consoleSlog.near` units (new setting, 40) gets
  `near(share)`; a run whose end the press passed gets `near(0)` and then `typed()`, the last such run alone if the press
  passed several. Never on load; in a moment, only on that screen's own presses.
- **Appendix.** After the post: a blank line, `C:\DW\POSTS> type <name>` dimmed, then its text, as units.
- **Ground.** `useGround()`: `inks` color each line in turn (each lifted toward white until it reads 7:1 on
  `--dw-slog-ground`); `sparkle` draws a layer of glyphs over the ground in empty cells, `aria-hidden`, redrawn every
  700 ms unless `still` or reduced motion.
- **Ink.** `inverse` draws the characters on phosphor; `bright` in `--dw-slog-link`'s glow.
- **Screen readers.** The art lines are `aria-hidden`, and the `label` is in the page as plain text in the art's place.
- The setting `consoleSlog.near` is added to `instances/divided-world/cards/console-slog.ts`'s `reads` and the seed, as
  #1273 added its others.

Tests first (slog.test.ts and Effect.test.tsx): a replace form's characters are typed and cost units, and the place
counts only the post's own; a play landing before the cursor keeps the place; `below` art under the right line at
narrow and wide widths (the three placements); `near` rises and `typed` fires once on a press, never on a load with a
kept place past the run; an appendix's prompt line; an ink under 7:1 is lifted; the sparkle is still under reduced
motion; a rewound post types the rewound words.

## Task 4. Autocorrect and THIS lend their forms

Model: sonnet

Files: `instances/divided-world/cards/autocorrect/Effect.tsx`, `instances/divided-world/ui/this/Effect.tsx`, their tests.

- **Autocorrect.** Each run in `runs` gains `plain: { text: '[' + replacement + ']', ink: 'inverse' }` while any stretch
  of its strip is stuck in the saved state, and no `plain` once peeled whole. Under `redrawn` it measures and draws no
  tape and no residue, and its anchors are not drawn.
- **THIS.** Each wedge's run gains `plain: { ink: 'bright', below: { label: 'THIS: ' + note, art } }`, where `art` gives
  the design's three placements (`^`, `|`, then `|___ label` right, `label ___|` mirrored, or `|` with the label on its own
  line). Under `redrawn` it opens no gap and draws no note. A receipt (phrase not found) is an `appendix`
  `{ name: 'this.txt', text: 'THIS: <note> ("<phrase>")' }`.

Tests first: each card's runs carry the forms (a peeled strip carries none); under `redrawn` neither draws its tape,
gap or note; `art` at columns where each placement is chosen.

## Task 5. Laugh Track's chip sounds

Model: sonnet

Files: `instances/divided-world/ui/sounds/chip/make.mjs` (new), the four `.wav` files it writes,
`instances/divided-world/ui/sounds.ts`, `instances/divided-world/ui/credits.ts`, `instances/divided-world/ui/laugh-track/Effect.tsx`,
their tests.

- `make.mjs` writes four mono 22,050 Hz WAVs from a seeded synth with no dependency: `chip-murmur.wav` (a 2 s loop of
  band-passed noise, its ends matched), `chip-laugh.wav`, `chip-cheer.wav` and `chip-boo.wav` (the bench's sad trombone:
  a sawtooth falling 180 to 120 Hz over 1.2 s). It is deterministic: a test runs it into a temporary folder and compares
  bytes with the committed files.
- Slots `laugh-track.chip-murmur` (Laugh Track's chitter caption) and `laugh-track.chip-<sound>` (the existing captions),
  game bus. `credits.ts` gives them their own credit ("made for Divided World in this repository"), since they do not
  share the other sounds' source; `credits.test.tsx` is told why.
- **Laugh Track.** Each place's run gains `plain: { near, typed }`: `near` sets one shared murmur loop's gain (the loop
  starts on the first `near` above 0 and stops at 0 everywhere); `typed` marks the place heard (`dw-lt-fired`'s state)
  and plays `chip-<sound>`; a heard place's run carries `ink: 'bright'`. Under `redrawn` it registers no place with the
  watcher.

Tests first: the script is byte-stable; `typed` plays the chip slot of the cue's sound once and marks it heard; `near`
moves one loop's gain; under `redrawn` nothing registers with the watcher; nothing reads `reader`.

## Task 6. You Were Saying?'s appendix

Model: sonnet

Files: `instances/divided-world/cards/you-were-saying/Effect.tsx`, its test.

Under `redrawn` the effect draws no tail and lays one `TextLayer` mark at the text's end with
`plain: { appendix: { name: 'continued.txt', text } }`: the chained texts it would draw, minus a cleared or waiting
play's; none when nothing would show.

Tests first: the mark's appendix holds the chained text; a waiting or cleared tail gives none; not `redrawn`, the tail
draws as before.

## Task 7. The ground forms and the rarity

Model: sonnet

Files: `instances/divided-world/ui/feelin-fab/Effect.tsx`, `instances/divided-world/ui/glitter-bomb/Effect.tsx`,
`instances/divided-world/ui/heads-will-roll/Effect.tsx`, `instances/divided-world/cards/console-slog.ts`,
`instances/divided-world/cards/console-slog.test.ts`, `instances/divided-world/ui/cards/console-slog/ui.ts`.

- Under `redrawn`, **Feelin' Fab** (and Glam, drawn by it) draws no foil and wraps its children in a `GroundLayer` with
  `inks` from its level's palette (`PALETTES`, bright under Brighter effects); **Glitter Bomb** draws no canvases and
  gives `sparkle: { glyphs: "*+.'", density: 0.025, seed: <play's seed>, still: reduced motion }`; **Heads Will Roll**
  draws no starfield and gives `sparkle: { glyphs: '.', density: 0.015, still: true }`, its heads drawn as now.
- **Console Slog** is `rarity: 'rare'` and `price = 300`; its test and its `describe` follow (the words read the rarity).

Tests first: each effect under `redrawn` gives its ground and draws none of its own canvas; not `redrawn` it draws as
before; Console Slog's rarity and price.

## Task 8. Browser checks

Model: sonnet

In a real browser over a seeded thread (as #1273's checks ran): a post with Console Slog and each of Autocorrect, THIS,
Laugh Track, You Were Saying?, Feelin' Fab, Glitter Bomb, Heads Will Roll, Whoops! and Steel Chair, each played before
and after it. Screenshots at a phone's width and a desktop's of the half-typed terminal, attached to the PR. A kept place
across a reload; a release that shows the post as written. Under reduced motion, the sparkle and cursor hold still.

## Review focus

- A reader's place kept under #1273 (all units) now read as the post's own units: a post with a quote or an image types
  from a slightly different place once. Accepted, and no reader exists yet; say so if it is worse.
- `redrawn` must be computed from plays and `released` alone: check that no effect's step-aside depends on who wrote the
  post or cast a card.
- A busy instance: `plainOf` and the line wrap run per post on mount and resize, never per press; check that a long post
  with many runs does not re-wrap on each press.
- `typed()` must never fire on load, in History, or twice for one pass; the murmur loop must stop when the terminal
  unmounts or the reader is released.
- Over-the-words effects (Whoops!, Graffiti, Steel Chair, Kick Me, Time Machine) now always mount around the terminal:
  check their measuring against a body whose height comes from the terminal's own lines.
