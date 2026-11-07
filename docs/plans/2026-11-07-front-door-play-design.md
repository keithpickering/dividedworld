Record, written 2026-11-07.

# The front door plays like a thread: design

The owner's notes on the front door (`docs/plans/2026-11-05-front-door-design.md`) after the meta acts landed:

- It still draws the old reaction chips, not the Marks' tiles (`docs/plans/2026-11-06-meta-acts-design.md`), and the posts a card
  is on show its effect but no Mark.
- A visitor should be able to open the reaction picker on every post and see their reactions land, in their browser alone,
  with nothing saved.
- "Hold to scrub" stands as a big tile under the splatted post. That is the glass reflowing the forum's layout, and it is not
  where the control is in play, which is the Lens.
- Captain Wholesome's post gets two Feelin' Fabs, to show a sweet effect and the idea of stacking.
- The reactions are toned down: every relevant reaction for each class on each post reads as staged. A realistic volume, some
  variety, the crowd following the crowd.

**World.** The board, with the glass's meta tiles on it, as in a thread. The persona's note under the thread is unchanged.

## 1. The posts are drawn by the thread's own pieces

**Decided.** A staged post is drawn as a thread draws one: the Marks on its date row (`PostMarks`), its words wrapped by
`PostEffects`, then `Reactions` under them. All of these run against stores the page builds for itself: a `Plays` store holding
the staged card plays, a `Tallies` holding the staged counts (on the posts, and on a play where the instance gives one), and a
`Mine` holding what the visitor has done. The page's own `LensProvider` holds one Lens. The front door's hand-made `Wrapped`
and its foot of `Kit` controls are gone. A card's controls live where they do in play: in the Lens the Mark opens, so nothing
glass is added to the forum's flow.

Weighed: Marks drawn for show only, unpressable. Then Whoops!'s keyboard path ("An accessible path costs what the obstacle
costs") has no home but the post, which is the reflow the owner asked to remove. The owner chose the real Lens.

## 2. A staged page says so once, in a context

**Decided.** `StagedCtx` (`engine/ui/staged.ts`) is true inside the front door. The pieces that would reach the server or
another page read it:

- `Reactions`: a press or a pick is answered locally. The kind goes into `Mine`, the post's tally grows by one in `Tallies`, and
  the answer is `'sent'`. No request is made, nothing is estimated, and a reload forgets it. The visitor needs no character, so
  the row offers React wherever the post is not "theirs", which a staged post never is. Its words leave out the mask ("React",
  "Fire, 3. React"), and the picker's description leaves out "reacting as …" (the owner: demo the quadrants, the buttons, the
  concept). The cap is the instance's own `reactionCap`, as in play.
- `PostEffects`: `save` and `release` refuse with "this is a sample post" without asking anyone, as the front door's own
  wrapper did.
- The Lens's play row: no Spin thread. The front door passes `to={null}` (no Go to post) and `moments={false}` (no As it
  landed), which the Lens already takes. The page's `LensProvider` is not an admin's, so there is no End this card.

Weighed: a prop through `PostMarks` → `Lens` → `PlayRow` → `Reactions`. That is four signatures for one fact about the page,
and a fifth (`PostEffects`). A context is read only where it matters.

## 3. Content

**Decided.** The counts are cut to what a quiet, real thread holds: two or three kinds a post, small numbers, one post the
crowd piles onto (the splat), and the Heel's heat the loudest. Captain Wholesome's post carries two Feelin' Fab plays (layers 1
and 2, by The Accountant and Mr. Roboto: the sincere one and the suck-up), so its Mark reads "×2" and the glow is the second
level. Mr. Roboto's Whoops! carries a couple of reactions of its own, which the Lens shows on its row. The words stay the
owner's to approve in review.

## The rules this touches

- **A response never proves a private fact.** The page still calls no API method, now including after a reaction, a pick and
  an open Lens. The test that wraps every backend method proves it.
- **No player is ever stuck.** No new state. A local reaction ends with a reload.
- **The fiction may lie; the log never does.** The label "Sample thread · made up" stays. A reaction the visitor leaves is
  theirs alone and says nothing about anyone.
- **The layers.** `StagedCtx` and the stores are the engine's. The cast, posts, plays and counts are the instance's
  (`FrontDoorUi`), which gains an optional `reactions` per play.

## Open

None.
