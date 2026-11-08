# Brighter effects: design

Record, written 2026-11-08. A design session with the owner, started from the owner's wish for an opt-in setting that
lets Feelin' Fab and Glitter Bomb leave the readable band (`docs/plans/2026-11-06-shine-design.md` section 5) for
vividness, judged by eye rather than by a ratio: "It is great that we adhere to text accessibility standards. The only
downside is that we have to tone down effects ... even though some players might prefer maximum vibrancy in spite of
them." For reference: on Minus World, Feelin' Fab always makes the background a full-saturation rainbow with white
text and a black shadow, on any theme. The owner compared the options on a bench
(`docs/research/2026-11-08-brighter-effects-bench/01-bench.html`, made from the Shine bench). Where this design and the
bench disagree, this design wins on what is decided and the bench on how it looks. The plan is
`docs/plans/2026-11-08-brighter-effects-plan.md`.

The setting is a row of the glass (Settings and the welcome page), plain and never in character. The effects it changes
are the board's.

## 0. What the band costs today

Every pixel of the shine holds 4.5:1 against every post ink (`--kb-fg`, `--kb-link`, `--kb-link-visited`,
`--kb-muted`), so each board leaves the shine a luminance band (`engine/ui/shine/band.ts`): 0.59 to 1 on the light
board (pastels only) and 0 to 0.048 on the dark board. On the dark board that turns half of Feelin' Fab's rainbow to
mud (`#682d06`, `#4a3d00`, `#0d471e`), and Glitter Bomb needed issue #340 to let its glints out.

The band is computed against the board's own inks: an effect cannot change the words' color, so it can only move its own
colors away from it. Minus World's look comes from changing the ink, not only from loosening the bound. White on pure
yellow is 1.07:1, on green 1.4:1; what makes those words readable is the black outline.

## 1. Decided

**A setting, off by default.** "Brighter effects", a row of Off and On, in Settings › Accessibility (after Text size)
and in the welcome page's Before you start (after Text size), saved to the account with the other preferences, so it
follows the player across devices and is in the instance's export. The owner chose both places over Settings alone, and
over a per-device setting. Copy (the owner chose it over the first draft and over a wording that names the cards):

> **Brighter effects**
> Let card effects on posts use their full colors, even below the usual contrast standard. Some posts may be harder to
> read.

With it off, everything is as it is today, and every check of the readable band holds as it does today.

**Feelin' Fab, bright: a full-saturation rainbow under white words with a black outline, the same on both boards**
(the owner chose this over black words with a white outline, and over the board's own ink with a heavy halo).

- The foil is drawn free of the band from its own palette, `FAB_BRIGHT`
  (`#ff1f2d`, `#ff8a00`, `#ffe600`, `#19d43c`, `#1a8cff`, `#9a2bff`, the bench's), on both boards. Its starbursts flare
  at full strength on both boards.
- Everything drawn straight on the foil wears the bright ink: the words, links, a quote's byline and border, the edit
  note and the signature, in white with a tight black outline (four one-pixel offsets and a 3px blur, the bench's).
  Visited links look like unvisited ones over the foil (white, underlined): a second ink would be one more color to
  hold over a rainbow.
- Anything that brings its own ground keeps that ground and its own ink: the reaction chips (`.kb-tally`), the ORIGIN
  box, and any control the engine lifts over a post's ink.
- The colors are Divided World's: the instance declares the palette, the ink and the outline. The engine names none.

**Glitter Bomb, bright: every flake in full color** (the owner chose this over freeing the flakes but keeping today's
shading, and over leaving Glitter Bomb unchanged).

- Every flake's ink is drawn free of the band. An unlit flake shows its ink at 50% on the dark board and 85% on the
  light board (where it is mixed toward white by the rest); a lit flake goes to its full ink.
- Any flake lit past `GLINT_MIN` glints, on both boards: added, in its hue at full brightness with the instance's glint
  at its heart, as the dark board's glints are today. `glintsAreFew` does not hold this mode to its share.
- The burst, the puff, loose glitter and the cling are free in the same way.
- Under reduced motion the light rests, so the few flakes facing it glint and hold. Today a glint is withheld there only
  because it would be a lasting patch out of the band; with Brighter effects on there is no band.
- The words keep the board's ink, with the firmer halo the bench shows (five shadows in the board's ground, out to
  10px), since the flakes are scattered and not a fill.

**Whoops!, and every other effect, are unchanged.** An effect opts in by declaring a bright look; one that declares
none draws as it does today whatever the setting says.

**Independent of the other rows.** High contrast puts solid ground under the glass's text, not under a post's words,
so the two do not touch. Reduced motion holds the light still in both modes.

## 2. The layers

- **Engine.** The preference (`account_preferences.effects`, `'standard'` or `'bright'`), its row
  (`engine/ui/account/appearanceRows.tsx`), and its mark on the root, `data-kb-effects="bright"`, put there by
  `applyAppearance` (`engine/ui/appearance.ts`) as `data-kb-contrast` is. The shine's `Band` gains the board it is
  for and whether it is bright: `bandFor` reads the mark and, when bright, returns the free band (0 to 1) of the same
  board, and `clampInto` leaves a bright band's colors as they are. Every place that tells the board from the band's
  bounds today (`band.hi < 0.5`, `band.lo === 0`, `band.hi >= 1`) reads its board instead. The flakes' bright shading
  is engine (`engine/ui/shine/flakes.ts`); the floors are the engine's, the inks the instance's. The bright ink on a
  post's body is engine CSS (`engine/ui/thread/thread.css`) keyed on a mark the effect asks for
  (`engine/ui/cards/body.ts`), reading the colors from two custom properties the instance sets,
  `--kb-bright-ink` and `--kb-bright-outline`.
- **Instance.** Divided World's `FAB_BRIGHT`, its ink (`#ffffff`) and outline (`#000000`), Feelin' Fab asking for the
  bright ink when the band is bright, and Glitter Bomb's firmer halo
  (`instances/divided-world/ui/feelin-fab/`, `instances/divided-world/ui/glitter-bomb/`).

## 3. The rules

- **An accessible path costs what the obstacle costs.** The forum's default stays fully accessible: with the setting
  off nothing changes, and the readable-band checks hold as before. The setting is the reader's own choice about their
  own screen, like text size; it changes no card's difficulty, and no other reader's view.
- **A response never proves a private fact.** The preference is read by its own account alone, like the rest of
  `account_preferences`; nothing about it reaches another player's screen, and the effects' seeds are unchanged.
- **No player is ever stuck.** It adds no state a player, a character or a post can be put in; the row turns it off.
- **Portable by construction.** A column of `account_preferences`, in the export like `tilt`, and round-tripped by
  `supabase/tests/e2e/0003-export.ts`.
- **Write in American English.** The copy above.

## 4. Weighed

- **A measured loosening (3:1 instead of 4.5:1).** It doubles the dark board's ceiling to about 0.10 and lowers the
  light board's floor to about 0.37; the dark board's yellow stays olive. Not worth a setting.
- **Black words with a white outline over Feelin' Fab.** Strongest on the warm half of the rainbow, weakest on blue and
  violet.
- **The board's ink with a heavy halo over Feelin' Fab.** Keeps the board's link colors, but the halo dulls the foil
  around every line and leaves dark-board words glowing gray.
- **Glitter Bomb freed but shaded as today, or unchanged.** Smaller steps than the owner wanted.
- **Settings alone, or per device.** The owner wanted a new player to meet the choice on the welcome page.

## 5. Open

Nothing is open. Found during this session and kept out of it: glitter does not cling to the cursor on the live site,
issue #399.
