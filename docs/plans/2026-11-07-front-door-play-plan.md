Record, written 2026-11-07.

# The front door plays like a thread: plan

Design: `docs/plans/2026-11-07-front-door-play-design.md`. Designed and built in one session at the owner's request. The tasks
are `inline` because the session that read the code for the design holds it.

## Task 1: the staged context, and the pieces that read it

Model: inline

- `engine/ui/staged.ts`: `StagedCtx` (a boolean context, false by default), `useStaged()`.
- `engine/ui/reactions/Reactions.tsx`: under `useStaged()`, `canReact` is `!theirs`, and the row's send is a local one that
  adds to `mine` and grows `tallies` by one for the kind. Labels leave out "as <name>" when there is no character.
  `useReactionSend` is still called, as a hook must be.
- `engine/ui/reactions/Picker.tsx`: with `as` null, the description is "N of M left" with no "reacting as".
- `engine/ui/cards/Effects.tsx` (`PostEffects`): staged `save` and `release` refuse with "this is a sample post".
- `engine/ui/cards/Lens.tsx` (`PlayRow`): staged, no Spin thread.

Tests first (`engine/ui/reactions/Reactions.test.tsx`): a staged row with no one signed in offers React and its tiles as
buttons. A press grows the count, rings the tile as yours and makes no API call. The picker's description has no "reacting as".

## Task 2: the front door on the thread's pieces

Model: inline

- `engine/ui/types.ts`: `FrontDoorPost.plays[].reactions?` and an optional `layer`. `reactions` on a post is no longer
  "static".
- `engine/ui/front-door/FrontDoor.tsx`: builds `Plays`, `Tallies` and `Mine` once, wraps the thread in `StagedCtx` and
  `LensProvider`, and draws each post with `PostMarks` (`to={null}`, `moments={false}`), `PostEffects` and `Reactions`. The
  `Wrapped`, `Kit` and foot are removed.
- `engine/ui/front-door/front-door.css`: the date row holds the marks as a thread's does.
- `engine/ui/test-world.tsx`: the fixture's play gets a reaction.

Tests first (`engine/ui/front-door/FrontDoor.test.tsx`): the reactions are meta tiles with React buttons. Reacting grows a
count. A post with a play shows its Mark, pressing it opens the Lens with the card's controls in it, and none under the post.
The Lens has no Spin thread or Go to post. The screen calls no API method even after reacting and opening the Lens.

## Task 3: Divided World's content

Model: inline

`instances/divided-world/ui/front-door.ts`: toned-down counts, two Feelin' Fab plays on Captain Wholesome's post, reactions on
the Whoops! play. Its header comment is updated to match.

## Review focus

- The local send must never reach `api.react`, `api.myReactions` or `player.reactionLanded` on a staged page, and must never
  run on a real one. `StagedCtx` defaults to false.
- The Lens's Kit controls for Whoops! work from the front door's Lens (Hold to scrub drives the effect's scrub). The view
  reaches the Lens through the `Plays` store's `setView`, which `BoundEffect` calls.
- The marks' absolute layout on a date row that has no time element.
