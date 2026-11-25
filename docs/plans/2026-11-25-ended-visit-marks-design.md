# Ended visit marks: design

Record, written 2026-11-25 by a session designing with the owner, from main at 92fe3f2. World: the glass. All of it is
engine; no instance file changes. It amends one bullet of `docs/plans/2026-11-06-mod-bots-design.md`, section 9 ("A
visit is a mark"), which is left as it reads. The mocks are in `docs/research/2026-11-25-ended-visit-marks/`.

## 1. What the owner saw

"The 'Talked down' mark takes up a large amount of space and will presumably be on a post forever. Any way to condense
it to the size of other marks?" (Keith, 2026-11-25.)

A visit's mark (`VisitMark`, `engine/ui/cards/Visit.tsx`) is the one mark with words on it: a stopwatch and then
`markText` (`engine/ui/cards/visit.ts`), the time left while the visit is open, and afterwards "Filed", "Talked down",
"Trapped", "Ended" or "Dropped". Measured in the TalkedDown story, the "Talked down" mark is 169px wide and the Whoops!
mark beside it 48px. A visit's mark stays on its post for good, since the visit is a public Act. Every other mark keeps
the rule at the head of `engine/ui/cards/marks.css`: "A mark has no words on it; it is the card's icon, a count, an
edge… a gold notch and a still corner sign." The Mod Bots design approved words on the visit mark ("2:41", or "Filed"
once it files); the other outcomes' words came after it, in the same shape.

## 2. Decided

**An ended visit's mark has no words: it is the stopwatch alone, drawn differently for each outcome, in a tile the size
of a card's mark.** An open visit's mark keeps the stopwatch and the time left ("2:41"), which is short and live.

| Outcome | The stopwatch |
|---|---|
| open | as now, with the time left beside it |
| filed | the clock hand over a dot, so the face reads as a "!" (the owner's own design) |
| intercepted (talked down) | a slash through it |
| trapped | a row of teeth under it |
| reversed (ended by an admin) | a stop square in the face, with no hand |
| dropped | the face's circle dashed |

- The stopwatch and the filed dot are in the visit's ink (`--kb-visit-ink`); the slash, the teeth and the stop square
  in the glass's bright text, so they read over the ink. In forced colors every stroke and fill is `ButtonText`, as the
  stopwatch's stroke is now.
- The ended tile takes the meta tile's own padding, so it is as wide as a card's mark; the open tile keeps its wider
  padding for the time.
- The words move nowhere new: the mark's accessible name (`markLabel`) already says how the visit ended ("The Clerk's
  visit to this post was talked down. Opens the visit."), and the Lens tab it opens is named in words ("Talked down").
  With no visible words on an ended tile, WCAG 2.5.3 (label in name) has nothing to match.
- The build check that holds the glass's outcome words to the database's list
  (`tools/check-visit-outcome-words.mjs`) reads `markText`'s cases today. With no words on an ended mark, its place is
  taken by the icon each outcome draws, so an outcome added to `end_visit` with no icon still fails the build ("Two
  lists that must agree are one list").

## 3. Alternatives weighed

- **A: the plain stopwatch with a corner badge** (`01-options.png`): "!", "✕", a zigzag, a square, a dash in a small
  square at the tile's top right, where card marks keep their corner sign. Easier to tell apart at a glance, but the
  badge peeks over the date bar's top and crowds the next mark's gold notch. The owner chose B: "B is a better look and
  I don't find it hard to read."
- **B's first filed icon**, a solid face: replaced by the owner's "!" ("For 'filed' try a dot under the clock hand,
  which will turn it into a `!`"), approved as `02-approved.png` ("Looks good to me").
- **A shorter word** ("Off", "Done"): still a word on a mark, and still wider than a card's tile.
- **Fading or hiding an ended mark**: not asked for, and a finished visit is a public Act the strip should keep showing.

## 4. What it touches

- No new state, so no new way out ("No player is ever stuck").
- No new response, payload, Realtime event or timing; the mark draws from the visit's outcome, which is public
  ("A response never proves a private fact").
- Engine only: the icons are the engine's, in the instance's ink token, as the stopwatch is now.

## 5. Open

Nothing.
