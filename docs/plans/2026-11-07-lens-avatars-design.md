# Avatars in the Lens: design

Record, written 2026-11-07. A design session with the owner, who asked to add avatars to the Lens
(`docs/plans/2026-10-31-marks-and-the-lens-design.md`, section 2). The plan is
`docs/plans/2026-11-07-lens-avatars-plan.md`.

## The idea

The Lens's Who section names who played each card in words alone: a folded line ("3 plays · Gloomba, Pipewrench, Mrs.
Hooligan") and, unfolded, one row per play with its caster's name in capitals. A character's avatar is how the board
recognizes a mask at a glance, so the Lens shows it next to the name, in both places. It is the glass (the Lens is the
game's own interface, `docs/plans/2026-10-29-two-worlds-design.md`), so it is drawn in the glass's look.

## 1. Where

Weighed: the play rows only; the folded line only. Chosen: **both**. The folded line shows up to three small faces
that overlap, one for each caster its words name, in the same order and with the same dedupe (`NAMES_SHOWN`), so a
reader sees who played before unfolding. Each play row shows a square to the left of its caster line. The faces show
nothing the words do not already say.

## 2. One component, pulled out of the HUD

Weighed: the Roster's hatched placeholder (`engine/ui/characters/Portrait.tsx`); no square at all for a caster with no
avatar. Chosen: **the HUD's fallback, the name's first letter**, and the owner asked that the HUD and the Lens share one
component. The HUD's inline `img`-or-letter (`engine/ui/frame/Hud.tsx`) becomes `Avatar` in `engine/ui/glass/`, which
both draw. A staff play (caster `null`) takes the first letter of the instance's staff word, the same name its row
already shows. An avatar is decoration beside a name read in words, so it is hidden from the accessibility tree, as
`Portrait` is. The folded button's accessible name does not change.

## 3. Look

- Row square: 2.75rem, the phone HUD avatar's size, so its letter fits at every text size.
- Folded faces: about 1.5rem, overlapping by about a third, in front of the words.
- Weighed: the HUD's neon border and glow. Chosen: **framed in the play's ink** (`--kb-play-ink`), the color of the
  row's inked corner and of the play's mark, so a face is tied to its play's stroke (Whoops!'s layers). A folded face
  takes its caster's first play's ink. With no ink, the glass's neon.

## 4. Data

Every page that opens a Lens already holds the casters' `Character` (`avatarSquare`): the thread's people map
(`engine/ui/thread/Thread.tsx`), the board's characters (`engine/ui/board/Board.tsx`), the spun origin's `useNames`
(`engine/ui/spin/Origin.tsx`). So the Lens reads nothing new. Weighed: widening `nameOf` to return a name and a face,
which would change about twenty readers (the log's lines, `backWords`, the composer) that want only the name. Chosen: a
`faceOf: (character: Id | null) => string | null` passed beside `nameOf` to `PostMarks` and `Lens`, required, so the
type checker names every caller that has to provide it. Each caller builds both from the same map. The front door's
made-up cast has no avatars, so its `faceOf` returns `null` and draws letters.

## 5. Rules

- **The masks.** A caster is a public fact of a public Act, and a character's avatar is public. The faces come from data
  the page already read, and add no read, payload, Realtime event or timing. A face-down play already names its
  caster in the Lens, so its face says nothing more.
- **Ways out.** No state is added.
- **The layers.** Engine only. No instance content is involved.
- **Accessible.** The faces are `aria-hidden` and the words are unchanged, so a screen reader hears what it does today.

## Open

Nothing.
