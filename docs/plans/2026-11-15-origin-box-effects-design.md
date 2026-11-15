# Card effects fill a spin's ORIGIN box, border to border: design

Record, written 2026-11-15. The design session with the owner, after the owner asked for the rule "An effect fills the
post, border to border" to reach a spun thread's ORIGIN box (PR #723, which rewords the rule and was open when this was
written). Its plan is `docs/plans/2026-11-15-origin-box-effects-plan.md`. Sections 3, 4, 7 and 9 hold the four
questions the owner answered, one at a time; where a section says a choice is the session's own, it is.

## 1. What was found

The rule, as PR #723 words it: in a spun thread's ORIGIN box the content area is "the box under its band, out to the
box's other three borders, whether the box shows the post live or as it was at a moment", and an effect's "floor and
walls are that box's borders". The code does not do this:

- **There is no such element.** `engine/ui/spin/Origin.tsx` puts the byline, the words (in `PostEffects` or a
  `MomentView`), `LastEdited`, the History button and panel, and the "More than 20 cards" note straight into
  `div.kb-origin` after the band (`p.kb-origin-head`). The box's padding (`engine/ui/spin/spin.css`, `0 0.75em 0.4em`)
  and the band's negative margins leave no element whose padding box is "under the band, out to the three borders".
- **The engine names no content area there.** `engine/ui/cards/body.ts` `bodyOf(host, place)` returns the post's body
  (`.kb-act-main`) for place `thread` and null for `origin`, so Feelin' Fab, Glitter Bomb, Hot Box, Steel Chair
  (PR #718) and the moment's ring paint the effect's own element, the words.
- **Whoops! and Graffiti carry their own copy of that rule.** Each has `const bleed = place === 'thread'` and three
  `closest('.kb-act-main')` lookups (`instances/divided-world/cards/whoops/Effect.tsx`,
  `instances/divided-world/cards/graffiti/Effect.tsx`), and measure the box by hand. Changing `bodyOf` alone would not
  reach them.
- **The box is inside another post's content area.** `engine/ui/thread/Post.tsx` draws `<Origin>` inside the spun
  thread's opening post's `.kb-act-main`, before that post's own words. `place` is the only thing that stops an effect
  in the box from finding the opening post's body. The reverse already leaks: an effect on the opening post paints its
  whole body, so Hot Box smoke there fogs the box, band included; a Glitter Bomb burst flies over it; a pointer over the
  box opens the opening post's clearings.
- **Steel Chair's room leaks through the nesting.** On PR #718's branch the room for resting chairs is
  `.kb-act-main:has(.dw-chair)::after`. A chair in the box matches the opening post's body by descent, so the opening
  post grows by the room (126 px at head `182e01df`; the "about 62 px" in this session's brief is the height of three
  flat chairs, a comment in `chair.ts`), and the same block hides the strip that would have been the room in the box.
- **Nothing tests an effect's size in the box.** `e2e/spin-at-post.spec.ts` checks that still glitter in the box has
  painted pixels; no story or spec measures any effect against the box.
- **One correction to the brief.** The box is drawn inside the thread's first Act, so only the page that holds that
  Act draws it (`ThreadPage.origin`, `docs/plans/2026-11-14-origin-in-page-design.md`), not every page of a spun thread.

## 2. The content area is an element, and says so itself (the session's own choice)

**The element.** Everything under the band moves into one new element, `div.kb-origin-area`. `.kb-origin` keeps its 1px
frame, its ground and its bottom margin, and loses its padding; the band loses its negative margins (there is no inset
left to take back) and its bottom margin; the area takes the padding (`0.4em var(--kb-origin-inset)`). The area's
padding box is then exactly the rule's box: its top edge is the band's bottom rule, and its other three edges are the
frame's inner edges. It is `isolation: isolate`, as a post's body is, so a layer an effect lays under the words
(Feelin' Fab's foil, Glitter Bomb's flakes, both at `z-index: -1`) lands inside the box over the box's ground, instead
of under it in the opening post's stacking context. It has no `min-height`: PR #695's 22.5em is the postbit's ratio,
and the box has no postbit. Where nothing stands under the band (the Act is a draw or a wash, or a play on a thread or
a board, whose box "is the head and nothing under it"), no area is drawn, so the box is never a band over an empty
padded strip.

**The marker.** A content area carries `data-kb-content-area`: the post's body in a thread and on the front door
(`engine/ui/thread/Post.tsx`, `engine/ui/front-door/FrontDoor.tsx`), and `div.kb-origin-area`. `bodyOf(host)` becomes
`host.closest('[data-kb-content-area]')` and takes no `place`. The nearest area wins, which is what the nesting needs:
an effect in the box finds the box's area and never the opening post's body, with no reading of `place`. Stick Around's
view, which lifts the words out of every area, still finds none and paints the effect's own element.

Weighed:
- *A second branch in `bodyOf`* (`place === 'origin' ? closest('.kb-origin-area') : closest('.kb-act-main')`). Least
  churn, but each place added later edits the engine's lookup and every effect's CSS, and the rule says a place "says
  where its content area is". Not chosen.
- *One selector list in `body.ts`* (`closest('.kb-act-main, .kb-origin-area')`). Nearest-wins as well, and no test
  harness changes, but the CSS that lifts ink and reads the bright ink would still be written once per place. Not chosen.
- *A marker the place sets on its own element* (chosen). The engine's three ink rules in `engine/ui/thread/thread.css`
  (`[data-kb-effect-ink]`, `[data-kb-over-ink]`, the bright ink) are rewritten once against the marker and hold for
  every place. The cost is mechanical: each unit-test harness that fakes a body with `<div className="kb-act-main">`
  adds the attribute.

`place` stays in `EffectProps`: effects still read it for what is not about the box (Jimmy Wails draws no buttons
outside a thread).

## 3. What lies under the effect in the box (the owner's choice)

The area holds more than a post's body does in a thread: the byline, the Last edited line, the History button and its
panel, and the "More than 20 cards" note. Asked which of those lie under an effect that fills the box, the owner chose
the recommendation, "but the effect area should be surrounded by a border nonetheless", and confirmed that the border
meant is the four edges of section 2: the band's rule above and the frame on the other three sides, with the effect
touching all four and nothing new drawn.

- **Under the effect, with the words:** the byline and the Last edited line. Last edited is under the ink in a thread
  post too. Under Feelin' Fab's bright ink they wear the white ink and outline, as a post's own lines do.
- **Lifted over the effect** (`data-kb-over-ink`, as the reactions row is in a thread): the History button, the open
  History panel and the "More than 20 cards" note with its link. Each stands on a ground of its own (the button has
  one; the panel and the note paint `--kb-post-bg`), so it is readable over any ink, takes the board's inks back under
  the bright ink, and a press on it is its own and starts no stroke, clearing or throw.
- **A moment's list** ("Also on the post then", each still card's words) already stands on its own ground over the ink
  (`engine/ui/cards/moment.css`), and stays there.

Weighed and not chosen: lifting the byline and Last edited as well (who wrote the post always readable, but strips
across the top and foot of the effect; the band already names the post); lifting nothing (History unpressable under
Whoops! ink until washed, in a box whose reader may not be the author).

## 4. The box stands above the opening post's effect (the owner's choice)

Asked whether an effect on the spun thread's opening post also covers the ORIGIN box set into it, the owner chose that
the box stands above it. The box is another thread's post in its own frame with its own effects: the opening post's
effect fills that post's content area around the box and stops at the box's border, and a press inside the box goes
only to the box's own effect.

How: `div.kb-origin` carries `data-kb-over-ink`, the engine's existing mark for what stands over a post's ink. The
engine's rule gives it `z-index: 2` (over ink at 1); a rule beside it keeps the box's full width (the mark's
`fit-content` is for chips). The bright ink's reset already names both `.kb-origin` and the mark.

"A press inside a lifted thing starts nothing" is today a `closest('[data-kb-over-ink]')` test in each effect
(`instances/divided-world/cards/wiping.ts` `overInk`, Hot Box's own). With the whole box lifted, that test would also
stop the box's own effect: from the box's words the nearest lifted ancestor is the box. So the test becomes the
engine's, in `body.ts`: `liftedOver(target, body)` is true where the nearest lifted ancestor of `target` is inside
`body`. For the opening post's effect the box is inside its body, so a press in the box is not its own; for the box's
effect the box is outside its area, so the press is its own, and the lifted History button inside the area still is not.

Weighed and not chosen: the opening post's effect covering the box, band and all (two effects piled in one frame, and
ink over the band covers the mark and Go to post); covering the area but never the band.

## 5. A moment in the box is painted as a live post is

The rule decides it ("whether the box shows the post live or as it was at a moment"), and section 2 makes it so with
no code of its own: `MomentView` and `CharacterMoment` are drawn inside the area, their still effects are given place
`origin` as now, and `bodyOf` finds the area. "As it landed" and "As it was spun" in the box are the content (no ring,
no tag), so `useRing` in `engine/ui/cards/Moment.tsx` still returns before it measures anything.

## 6. Each effect in the box

- **Whoops!** Drops `bleed` and its three `closest('.kb-act-main')` lookups for `bodyOf`, measures with `bodyBox`, and
  shows its overflow wherever a body is found. The ink's bands, canvases, suds, the scrub's hit area and the
  `touch-action` it sets all follow the box it measured, so in the ORIGIN box the ink reaches the band's rule and the
  frame, and the author scrubs anywhere in the area. The byline is under the ink; History is pressable (section 3).
- **Graffiti** has the same code and gets the same change. It marks particular places and fills nothing, but its wall
  is the content area: paint placed at a share of the body in the thread must land at the same share in the box, and
  the Draw tile stands at the area's top right. `Compose.tsx` finds its body through `bodyOf` too.
- **Feelin' Fab.** No change to its code. The foil fills the area under the words; the area is marked for the bright
  ink and the engine's rule (now on the marker) turns the box's words, byline and Last edited bright; the band sets its
  own ink and never changes. `fab.css` gains the area's twin of the rule that hands the words the body's outline.
- **Glitter Bomb.** No change to how it paints. Its `pointermove` for cling ignores a pointer over a lifted thing in
  its body, so the opening post's glitter no longer clings from inside the box.
- **The shine effects' cost.** `paintScale` and `paintShare` keep their meaning: `own` is the words' box and `painted`
  the area, which in the box also holds the byline, Last edited, History and the padding, so a short origin post is
  drawn softer and redrawn less often, never below the two floors (half the density, a quarter of the rate).
- **Hot Box.** No change to how it paints: the smoke, the clearings' radius, the pointer's surface, the in-view watch
  and the forced-colors outline all come from the area it finds. Its press test becomes `liftedOver`.
- **Steel Chair.** Its code already asks `bodyOf` for its world, so the box's bottom border becomes the floor and its
  side borders the walls. Its room (the owner's choice, section 7) stops being a `:has()` selector, which cannot tell
  the nearest area from an outer one: the effect marks the body it found (`data-dw-chair-room`) and its own element
  (`data-kb-bleed`), and the stylesheet draws the room at the foot of the marked body and hides the in-host strip where
  a body was found. That also ends the `@supports selector(:has(a))` fallback. The throw's aim and the dents are in the
  body's px and need nothing.
- **A quote's border under the bright ink.** With two areas nested and both bright, a selector cannot say which is
  nearer, and today's reset rule outweighs the bright one. The border reads a custom property the bright rule and the
  reset both set, so inheritance, which is nearest-wins, decides.

## 7. Steel Chair's room in the box (the owner's choice)

The owner chose the same room in the box as in a thread post: chairs rest on the box's bottom border, never on the
words, and a box whose post has a chair on it is taller by the room (`ROOM_HEIGHT`) while a chair is on it. Not chosen:
a smaller room with standing chairs laid flat (a second room size in the physics); no room (words under a chair).

## 8. Scale, masks, ways out, layers

- **Scale.** One box at most on a page, on the page that holds the thread's first Act. A box with a shiny effect is one
  more painted area the size of a post's body: the shine loop registers it as it does a post, frees its canvases out of
  view, and draws it at the density and rate `paintScale` and `paintShare` give. Hot Box runs its own loop only in view
  and caps its canvas. Nothing here grows with players, characters, threads, Acts or viewers.
- **Masks.** Nothing is read, sent or timed differently. The change is markup, CSS and where layers are placed, from
  facts the page already holds.
- **Ways out.** No state is added. Three ways out are kept open that the fill could have closed: History is always
  pressable; the band's mark and Go to post are never under any effect; a Whoops!ed origin is washed by its author in
  the box, or in its own thread through Go to post.
- **Layers.** Engine: the marker, `bodyOf`, `liftedOver`, the area and its CSS, the three ink rules. Instance (Divided
  World): each effect's lookup, press test and stylesheet, the stories. The engine names no card.

## 9. What must be merged first (the owner's choice)

The owner chose one plan and one PR, started once all three are merged:

- **PR #723** (the rule). It changes `CLAUDE.md` and waits on the owner. If its wording changes in review, this design
  is read against the merged wording before the build starts, and a difference goes to the owner.
- **PR #695** (post room). It makes the post's body a flex column and moves the reactions to its foot, which changes
  where Steel Chair's room sits and which shine allowances `e2e/shine.spec.ts` holds.
- **PR #718** (Steel Chair). The plan's Steel Chair task edits files that exist only on its branch.

Not chosen: a second, short plan for Steel Chair after #718. If one of the three is closed unmerged, the build does not
start, and the owner is asked.

## 10. Open

- **History inside the box.** A version row in the open panel draws writing cards' still effects with place `thread`
  (`VersionEffects`). None of today's writing cards finds a body, so nothing changes; a later one that does would find
  the box's area from inside the lifted panel. Left for that card's design.
- **`article:has(> .kb-act-main .kb-hold)`** in `instances/divided-world/ui/stick-around/hold.css` is written with a
  child selector that may have matched nothing since the cells moved into `.kb-act-grid`. Not verified in a browser,
  and not this change; listed as a follow-up in the PR.
