# The mobile postbit: the whole 1:2 avatar, and rank above group: design

Record, written 2026-11-14. Designed with the owner in a design session. The plan is
`docs/plans/2026-11-14-mobile-postbit-plan.md`. The mock is `docs/research/2026-11-14-mobile-postbit/` (the real
postbit at 360px with the proposed CSS injected; `mock.cjs` makes the images).

## 1. What the owner asked for

On the desktop postbit the rank moved above the avatar and the group bar under it (PR #660, `20215ba5`). On a phone,
the postbit is a row: a 3.2em square avatar on the left, and on the right the name, the group bar, the title and the
rank with its pips. The owner asked for two changes there:

1. Rank and group switch places, as they did on the desktop.
2. The avatar shows the whole 1:2 crop in place of the square, and is narrowed so its height is no greater than the
   elements beside it.

## 2. Decisions

**The avatar is the portrait.** On a phone the slot is the tall portrait slot at every width, `3.6em` wide, with the
shape the portrait was cut (1:1 to 1:2, `portraitTallness`), so at most `7.2em` tall. The `3.6em` is half of the right
column's measured height, 109px at the 15px body size, with its four rows (name, rank and pips, title, group bar).
The slot's picture is the portrait file: the `<source media="(max-width: 40em)">` that swapped in the square is gone.

**The right column reads name, rank, title, group.** The rank (its name and its pips) sits directly under the name,
then the title (with BANNED, where it applies), then the group bar (with a staff character's office title beside it),
then the warn meter and the revealed class, as the desktop's order puts them after the group. A character's marks
strip stays where it is, in the corner out of the flow. *Weighed and not chosen:* the group bar under the avatar, as on
the desktop. The avatar is only 41px wide at the height the right column leaves it without a bar, and the bar clips to
"REG…" at that width (the mock's second variant). A narrower bar would need its own lettering.

**Both postbit layouts draw this on a phone (the owner's word, 2026-11-14).** A reader who chose "stacked" gets the
same tall avatar on a phone as one who chose "side by side"; the setting changes nothing there, which the postbit's
header already says ("a phone is always stacked, whatever the reader chose"). The stacked band stays square on wide
screens. The cost: a stacked reader on a phone now loads the portrait file, where stacked "never loads the portrait"
(`Postbit.test.tsx`, "stacked uses the square") so far. That rule is now "never loads the portrait on a wide screen".
The postbit already reads the width (`useNarrow`, to drop Posts and Joined); it now also picks its shape by it:
stacked and narrow draws the side markup, and the phone block of `postbit.css` is that markup's.

**The square is for the stacked band, and for a mask with no portrait.** A phone no longer draws the square layer of
gear (`data-kb-on="square"`) on a portrait slot, so the slot holds one outfit layer, the portrait's, and
`data-kb-square` goes. This also ends a phone rule that was a workaround: a portrait with no square was cropped to the
square slot with `cover` and wore no gear on a phone. It now shows whole and wears its gear like any portrait.

**Gear stands over the slot's edges, so the text keeps its ground on a phone too.** On the desktop every run of text in
the postbit sits on the post's ground over the gear, so no letters are ever read over art (the header's reason, and the
cosmetics design's). The phone slot is narrow (54px) and a piece reaches up to `0.4` of its width, 21.6px, past each
side, into the gap and under the name. So that desktop rule (`.kb-postbit-text > *`, `z-index: 2` and a ground) stops
being wide-only and applies at every width.

**A cap that stands above the slot gets room, so it never covers the post above.** On the desktop it reaches into the
column head's band. On a phone the postbit's top edge is the post's, and a cap 21px above the slot would cover the
previous post's actions. The postbit takes top padding on a phone equal to how far its highest piece stands above the
slot (a pure function of the pieces, the art's shapes and the portrait's tallness), zero for a mask whose gear stays
inside. The mock does not show this; it is the build's to measure.

## 3. Open

- **A character with no title has a shorter right column** (about 87px), so its avatar, fixed at `3.6em`, stands about
  20px taller than the column beside it. The owner's rule (the avatar's height no greater than the column) holds for
  the usual four rows and not for that one. The alternatives are a width that follows the rows (a layout that makes
  the column set the avatar's width, which a grid cannot do for an aspect-ratio box without a measured value) or
  letting the avatar be the taller one for a mask with no title. Left as a fixed width for now; the owner may want it
  looked at on a real instance's postbits.
- **A group's name longer than the bar's 160px** already ellipsizes; unchanged here.

## 4. The rules this touches

- **Engine, not instance.** Every part is engine (`engine/ui/postbit`, `engine/ui/thread`, `e2e`). No interface is
  added and no instance file changes.
- **No state is added**, so there is no way out to name. A post's postbit has no new way to be put in a bad place.
- **No response, payload, Realtime event or timing is added.** The portrait file a phone loads is the avatar the
  character already shows on the desktop, public to everyone; which file a reader loads reveals the reader's own
  width, not a private fact about a character.
- **Accessible path.** The avatar is decoration (`aria-hidden`). Contrast, focus and keyboard are untouched; the text's
  ground over gear is the same rule the desktop keeps. Reading order is the DOM's, which does not change: the order
  on screen is CSS, as it already is on the desktop.
- **Screen.** The board (arena) in its house style; the owner approved the look in the mock.
- **Append-only, The System, the log**: not touched.
