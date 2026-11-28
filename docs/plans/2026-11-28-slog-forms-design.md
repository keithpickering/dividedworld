# Console Slog draws every other effect: the design

Record, written 2026-11-28. A design session with the owner on #1276, raised on #1273 (Season Two cards, part 2), where
Console Slog's terminal was built (`docs/plans/2026-11-27-season-two-cards-design.md`, section 3). The plan is
`docs/plans/2026-11-28-slog-forms-plan.md`. The bench the owner turned is
`docs/research/2026-11-28-slog-forms/01-forms.html`; its look is the terminal's bench,
`docs/research/2026-11-28-console-slog/01-bench.html`.

The owner's direction, from #1276:

> 2 seems like the "real" solution, where effects not only work together but gain unique combinations. [...] My immediate
> thought is Slog is the only card that redraws the text completely (at this time). So it mainly becomes a problem of how to
> represent every other effect that occurs at a lower level as something "ascii-esque", as we've done with images inside the
> post.

## 0. The survey: how each effect behaved under the terminal

Read from the code on #1273's branch. A post's effects nest in play order (`nestOrder`, `engine/ui/cards/Effects.tsx`),
and the terminal draws its own text and none of its `children` until the reader is released. So an effect played
**before** Console Slog was not mounted while the terminal held, and one played **after** wrapped the terminal, which never
read the text layers it laid.

| Card | What it does | Played before | Played after |
|---|---|---|---|
| Autocorrect | tape over each phrase (a `TextLayer` wrap run) | not mounted: the real words typed | mounted, no tape: the real words typed |
| THIS | a note wedged under the phrase (a run with a standing trail) | not mounted | mounted; gap and note have nothing to hold |
| Laugh Track | cued phrases, a murmur near them, a hit on pointing | not mounted | mounted, no places, silent |
| You Were Saying? | a tail after the words (a writing card, always innermost) | never drawn while the terminal holds | the same |
| Graffiti | a wall over the area (`beneath`, always inside) | never drawn | the same |
| Glitter Bomb | on a character, so nested before the post's own cards | never drawn | the same |
| Whoops!, Steel Chair, Time Machine's tape, Kick Me | layers over the content area | not mounted | drawn over the terminal, working |
| Feelin' Fab / Glam | foil under the words | not mounted | under the terminal's black ground |
| Heads Will Roll | the reactions orbit in the area | not mounted, while the row says the reactions are loose inside the post: nobody could react until it was typed out | orbits over the terminal |
| Jimmy Wails | banners under the words | not mounted | drawn under the terminal |
| Blind Study, Whodunnit? | draw nothing; give the Lens a view | not mounted: their Lens view gone | fine |
| Below the Fold, It's Curtains, Hot Box, Stick Around | row layers and a takeover, outermost | unaffected | unaffected |

And under a Time Machine rewind the terminal typed the post's current words (`post.currentPayload.body`), while a released
reader saw the rewound version.

## 1. The terminal is innermost

**Decided** (the owner chose A): a card that redraws the post's words (`CardUi.redraws`, new) nests innermost of all,
inside even the cards that write, so every other effect on the post is mounted around it whatever the play order. The
combinations stop depending on who cast first, and Heads Will Roll is always there to catch from.

- **`nestOrder`** returns a new group, `redraws`, wrapped first. Two redrawing plays of different cards on one post (none
  exists yet) nest in play order among themselves.
- **`EffectProps.redrawn`** (new): true for every other effect on the post while a live play of a redrawing card holds
  this reader, that is, it is not in `released`. An effect that draws something of its own beside the words (THIS's note,
  You Were Saying?'s tail, the foil's canvas, the glitter's canvases, Heads Will Roll's starfield) draws its form instead,
  below, and not its own drawing. An effect that draws over the content area draws as on any post. Once the reader is
  released, `redrawn` is false and everything is drawn as written.
- **`EffectProps.body`** (new, given to a redrawing card): the BBCode source of the version the screen draws for this
  post: the current payload's body, a live rewind's version, or a moment's version. The terminal types this, so a rewound
  post is typed as the rewound words (the survey's bug).
- **The instance check** (`instanceUiProblems`) refuses a card that `redraws` and is also a `takeover`, `coversRow`,
  `fillsRow` or `foldsRow`, or whose rules write (`CardRules.writes`), and one with no `Effect`; its test drives each red.

Weighed: *play order as now* (combinations depend on cast order, and a first Heads Will Roll is a dead end until the post
is typed out); *pure forms with no mount* (each card a pure function of its plays; sound and any live behavior would need
a second channel, and the effects that draw over the area would still be unmounted).

## 2. How a card lends its form

**Decided** (the owner chose A): two engine channels, in a plain-text vocabulary any card that redraws words reads in its
own medium. The engine names no card and no medium.

- **`TextRun.plain`** (`engine/ui/bbcode/layers.tsx`): a run's form when the post is redrawn as plain text.
  - `text`: printed in place of the run's words (a replace).
  - `before`, `after`: printed around the run's words.
  - `below`: `{ art: (column, columns) => string[], label: string }`: lines printed under the line the run's last
    character ends on, the art laid out from that character's column and the line's width; `label` is the one part a
    screen reader reads (the art is hidden from it). The art's lines are given the label to place.
  - `appendix`: `{ name: string, text: string }`: a piece printed after the post, as another file.
  - `ink`: `'inverse' | 'bright'`: how the run's printed characters stand out (reverse video, or brighter phosphor), each a
    redrawer's own drawing of it.
  - `near(share)`: told, 0 to 1, how near the cursor is to the run's end as the reader types toward it, over the last
    `near` units (a redrawer's setting); 0 once passed.
  - `typed()`: called once when a reader's press types past the run's end. Never called on load.
  A `mark` run may carry `plain` too, for a form at one offset (the appendix sits on a mark at the text's end).
- **`GroundLayer`** (`engine/ui/cards/ground.tsx`, new): what lies under the words, for a redrawer, as context the way
  `TextLayer` is: `inks` (a cycle of line inks, `#rrggbb`) and `sparkle` (`{ glyphs, density, still }`). Layers combine:
  the inks of the latest, the sparkles of all.

The runs reach the terminal as context (`useTextLayers`), since every card that lays them is now mounted around it.

Weighed: *a terminal-specific node on the run* (each card would design for Console Slog alone, and a later redrawer would
need a form from every word card again); *the runs drawn as they are* (real tape and a highlighter inside green text: not
the terminal's look, and the tape measures the board's layout).

## 3. The forms

**Decided** (the owner, on the bench: Autocorrect B, THIS A, Laugh Track A, You Were Saying? B; then the ground forms):

- **Autocorrect:** each strip's replacement in brackets, in reverse video, like a strip of tape: `[Goomba]`, in place of
  the words (`text`, `ink: 'inverse'`), while any stretch of the strip is stuck in the author's saved state; the real
  words once the author has peeled it whole. A reader cannot peek in the terminal: the terminal is the obstacle.
- **THIS:** the terminal wraps its own lines, at the number of its columns that fit (it is monospace), so the art lines
  up. Under the line the phrase ends on, an arrow climbs from its last letter: `^`, `|`, then `|___ THIS: <note>` to the
  right; the mirror `THIS: <note> ___|` where the right has no room; or `|` and the label on a line of its own where
  neither fits. The phrase itself is printed bright.
- **Laugh Track:** sound, and no added words. As the cursor nears a cue (`near`), a synthesized chip crowd murmurs louder;
  when the cue is typed out (`typed`), the chip version of its laugh, cheer or boo plays (the boo a sad trombone), and the
  phrase prints bright from then on. The owner on the bench's synth: "I actually like the detail of the crowd noise being
  synthesized like this while the terminal is up." Four files (murmur, laugh, cheer, boo) are rendered in the repository
  by a script, played through the mixer on the game bus with Laugh Track's own captions. A press past several cues plays
  the last.
- **You Were Saying?:** its tail as an `appendix`: after the post, a blank line, then `C:\DW\POSTS> type continued.txt`
  dimmed, then the tail typed out. A tail still being written is not printed; a cleared tail is not printed.
- **Feelin' Fab and Feelin' Glam:** a color terminal: each line's phosphor in the next of the foil's hues (its palette,
  bright under Brighter effects), drawn by level as the foil is.
- **Glitter Bomb:** `* + . '` twinkling in the empty cells, a seeded few in a hundred, still under reduced motion.
- **Heads Will Roll:** its starfield as a still sparkle of `.`; the heads orbit over the black as they do.
- **Over the words, unchanged:** Whoops!, Graffiti, Steel Chair, Time Machine's tape, Kick Me and Jimmy Wails draw on the
  terminal's content area as on any post. Blind Study and Whodunnit? keep their Lens views.

**The terminal** lifts a line ink under 7:1 against its ground toward white, so every form reads.

**Console Slog becomes rare, 3.00.** The owner: "this card is powerful: it not only hides other full effects beneath a
minigame, but even uses them to 'upgrade' itself. [...] Rare seems fitting." Its length surcharge stays.

## 4. Reader memory and cost

**Decided** (the owner chose A):

- **The kept place counts the post's own units.** A form's characters are typed like any and cost presses; an art line's
  leading spaces print as one unit. The memory (`readerMemory`) keeps the post's own units out, so a play landing or
  ending before the cursor never moves a reader's place. A value kept under #1273's shape (all units) is read as the
  post's own units, which is what it was then, since #1273 had no forms.
- **On load** everything before the place is drawn in its form, with nothing played: a `typed()` is called only by a
  press, and the murmur starts from where the cursor stands.
- **A form that changes** (a strip peeled, a cue ended) is redrawn in place; the reader's place holds.
- **Released** readers see the post as written with every effect, as before.

Weighed: *count every unit* (a play landing shifts a reader); *forms free* (pasted in rather than typed).

## 5. The rules

- **"An accessible path costs what the obstacle costs."** The mash is the same for every reader and every way to press.
  The forms are plain text in the page (`[Goomba]`, `THIS: bold words`, the tail), read as typed; the art and the
  sparkle are `aria-hidden`; each chip sound is captioned with Laugh Track's caption. Reduced motion holds the sparkle and
  the cursor still and never changes what a press reveals.
- **"An effect fills the post, border to border."** The terminal is the content area border to border, in a thread and
  in the ORIGIN box; the ground forms color and sparkle its whole ground; the cards over the words fill the same area as
  on any post.
- **"A response never proves a private fact."** Every form is computed from the plays' public configuration, the post's
  version and the author's saved state, which every reader loads; none reads who wrote the post or cast a card
  (`reader.author`, `reader.caster`). Sounds fire on the reader's own presses alone. Nothing is sent or saved but the
  reader's own place, in their browser, and their release, as before.
- **"No player is ever stuck."** No new state. The terminal's way out is the same: type the post out. Heads Will Roll,
  now always mounted, can be caught from during the mash.
- **The layers.** Engine: `redraws`, `redrawn`, `body`, `TextRun.plain`, `GroundLayer`, the check. Instance: every form,
  the terminal's drawing of them, the chip sounds and their script, the rarity.

## 6. Open

- A second card that redraws the words, and how two redraws compose, waits for one to exist.
- Whether a quote of a post under the terminal quotes the forms: it does not (a quote holds the post's words), and no one
  asked otherwise.
