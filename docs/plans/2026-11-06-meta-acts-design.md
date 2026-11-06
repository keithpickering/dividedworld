Record, written 2026-11-06.

# Meta acts in the Marks' look: design

Part of #206, the owner's notes on the glass polish preview. This design takes two of its sections: "Meta acts belong to
the glass" as it concerns Reactions, and "Marks". The Reveal, Follow, the card-play pane and post effects that fill the
post cell are left to their own sessions. The mockups the owner chose from are in `docs/research/2026-11-06-meta-acts/`.

The owner's note: "Reactions, Turns, Reveals and card plays are meta acts. The 2003 board 'knows about' us only as
posters, so Marks are the bridge between the two worlds, and Reactions (and the button to leave one) should take the
Marks' look. The goal is one height for Reactions and Marks: big enough to keep play visible, small enough to keep the
focus on the post." And on Marks: "Slightly larger: closer to a HUD or pause-menu glass element, but not as large. The
card icons are hard to see now," with hover and focus styles.

**World.** Both are the glass's pieces laid on the board (`docs/plans/2026-10-29-two-worlds-design.md`): glass tiles on
a 2003 post, as the Marks already are (`docs/plans/2026-10-31-marks-and-the-lens-design.md`, section 1).

## 1. One tile, one height

**Decided** (the owner chose 2.25rem from `02-size.html`). A mark, the ghost mark, "+N", a reaction and "+ React" are
one glass tile, 2.25rem (36px) tall: skewed, on the glass field, with a 2px border. 36px is already the height of the
HUD's small controls and of the Lens's glass reaction chips, so the glass keeps one tile height on the post, in the Lens
and on the HUD. A card's icon grows from 1rem to 1.45rem.

The tile's size and shared rules are the engine's, in one stylesheet. A mark keeps its card's ink, edge, notch and
corner sign on top of the tile. The Reactions' `look="glass"` variant goes: the row draws the same tiles on the post, in
the Lens and on Updates, and the React button stops being the kit's 44px tile in the Lens.

Weighed:
- 2rem (32px): restrained, but the icons stay small and it adds a fourth glass height.
- 2.75rem (44px), the kit's tile: a row of reactions competes with a one-line post ("not as large").

## 2. The date bar holds the strip by straddling it

**Decided** (the owner chose 3 in `03-date-bar.html`). Every post's date bar has a min-height of 1.85rem, marks or none.
The strip is centered on the bar and overhangs its top and bottom rules by about 3px, into padding, so no word is
covered. A play landing never changes a post's height, as the Marks design requires.

Weighed:
- Hung as today: the bar stays thin, but a 36px mark sits on the ascenders of a long first line, and more where the
  body's padding is tighter.
- The bar holds the whole tile: covers nothing, but every bar becomes visibly chunky and stops reading as a 2003 line.

**The strips beyond a post** (card reach) take the same tile:
- The thread head and the board banner always reserve the tile's height, so arming a card never makes them taller.
- The pin mark straddles its row on the board's list the way the date bar's strip does.
- The postbit's name keeps clear of one 36px mark.
- The ORIGIN box's head holds its strip like a date bar.

## 3. Reactions stay under the words, as tiles

**Decided** (the owner chose B in `01-placement.html`): where people expect reactions, after what was said and before
the signature.

Weighed: the foot bar, at its right end. It kept reactions out of a post effect's area, but it made the bar a tile tall
on nearly every post (React is on every post not your own). On a desktop it also put the reactions far from the words,
reading as toolbar buttons. The tiles' own dark ground keeps them legible over an effect anyway, as the Marks hang over
the body.

The row keeps `data-kb-over-ink`, so Whoops! paints under it and starts nothing on a press inside it.

## 4. Color: neutral

**Decided** (the owner chose 1):
- **A reaction tile:** a `--kb-glass-text-2` border on the glass field, with no glow. Color stays the Marks' (each
  card's own ink), so a card played on a post stands out from a pile of reactions.
- **Your own kind:** a 2px ring in the post's own ink (`--kb-fg`; on the glass, `--kb-glass-text-hi`) outside the tile.
  It is drawn as a shadow, so the focus outline can stand beside it.
- **"+ React":** tinted in `--kb-glass-sweet` with its border in it.

Weighed:
- Each reaction in its quadrant's class color: ties to the picker, but sixteen colored tiles drown two colored marks, and
  the quadrant colors were chosen for the picker's smoke, not a white post.
- Your own in sweet cyan: it reads as "a card" or as React.

## 5. Hover, focus and disabled, on every tile

**Decided** (the owner agreed):
- **Hover:** the border goes to `--kb-glass-text-hi` and the field lifts (`color-mix` of the tile's line into the
  field).
- **Focus:** the Marks' ring, a 3px `--kb-glass-text-hi` outline doubled by the post's ink.
- **Disabled:** the emoji dimmed, with the border kept, as the picker's kinds are.
- **Forced colors:** system colors, as the Marks already are.

This answers #206's "hover and focus styles" for Marks. A mark's hover uses its own ink, not white, so it stays its
card's.

## 6. Pressing a tile reacts

**Decided** (the owner chose 1). This changes behavior on top of the restyle, and was named as scope when it was asked.
A tile that looks like a mark looks pressable, and pressing a count to add to it is what Slack, Discord and GitHub do.

- Pressing a tile reacts with that kind, as the HUD character, through the one send the picker uses (moved into a shared
  hook): the same cap, the same refusals, the same tally merge, the same estimate request.
- **Your own kind, or the cap reached:** the tile is `aria-disabled`. It stays focusable, and its name says why. No
  reaction can be taken back (the API has no unreact), so your own kind has nothing to do.
- **No way to react at all** (a post by one of your own characters, or no HUD character): the tiles are plain list
  items, not buttons, with no hover, and React is absent as today. This keeps up to sixteen dead tab stops off your own
  posts.
- **A refusal from the server** opens the picker with the refusal shown in it, where refusals already speak.
- **Keyboard:** the row is one tab stop. Left and Right move between the tiles and "+ React", and Home and End go to the
  first and last, as in the picker's grid. Disabled tiles are reached, so their reason is heard. A busy page is not
  hundreds of tab stops.
- **One at a time:** a second press while a send is in flight is ignored, as in the picker. A landed reaction is
  announced in a polite status ("Reacted with Laughing as Mrs. Hooligan").

Weighed:
- Inert counts: only "+ React" is a button. Two looks inside "one look", and an extra step in front of the common case.
- A tile opens the picker: safe, but roundabout for a reaction already in view.

## 7. Summaries keep the 2003 chip

**Decided** (the owner agreed): the move notice's top three reactions on the board (`MoveNotice.tsx`) and the front
door's sample (`FrontDoor.tsx`) are counts with nothing to press there. They stay `.kb-chip` in the board's tokens
(`--kb-chip-*`), since a tile that looks pressable and is not would be worse. The reaction tiles take a class of their
own, so the two never share rules.

## The rules

- **Masks.** Nothing new is computed from a private fact. Whether a tile is a button, enabled or yours comes from the
  reader's own reactions (`Mine`) and own characters, on their own screen, as the picker's enabled kinds already do. The
  send, its answer and its refusals are the picker's, unchanged. The tally a tile shows is the public one.
- **Ways out.** No state is added. A disabled tile is not a state of the post, and the cap is the picker's.
- **Layers.** All engine. An instance gives only its reactions' emoji and keys (`Instance.reactions`, `engine/rules/types.ts`), as today;
  the tile's size is an engine property, not a theme token.
- **Append-only.** A reaction is still one Act through `react`; nothing is edited.

## Open

Nothing is open. The other sections of #206 (the Reveal, Follow, the card-play pane, post effects filling the cell) are
for their own design sessions. Phases 2 and 3 of `docs/plans/2026-11-04-glass-polish-plan.md` touch `thread.css`; the
build session merges with whichever lands first.
