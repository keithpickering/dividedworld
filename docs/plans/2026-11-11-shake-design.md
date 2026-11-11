# Shake: glitter that flies, settles and stays

Record, written 2026-11-11. A design session with the owner, begun after issue #399 (cling restored, PR #411): "A quick
scroll makes some glitter shake off the post. This is good, except that it loses glitterlike properties by going sort of
zero-gravity and then fading away. Might be nicer if we can shake the glitter around more realistically on a quick
flick, without fading it, so it really looks like the glitter is shaking out of the post bounds and getting all over the
place." The look and the motion are the Shake bench (`docs/research/2026-11-11-shake-bench/01-bench.html`), which the
owner tuned and approved on 2026-11-11. The plan is `docs/plans/2026-11-11-shake-plan.md`.

This changes Glitter Bomb's shake and the landing of glitter dropped from the cursor, as the Shine design describes
them (`docs/plans/2026-11-06-shine-design.md`, section 2's cling and section 11's "A fast scroll shakes glitter off").
Everything else there holds.

## 1. Why today's shake floats and fades

What a fast scroll shakes off goes onto the page-fixed cling layer, so it stays in screen space while the page scrolls
on under it. It is thrown at 4 to 10% of the scroll's speed and falls at most 90 px a second, so it drifts rather than
flies. It may land only on a Glitter Bomb post, and by the time it comes down the page has scrolled away, so nearly all
of it fades in the air.

## 2. The decisions

- **Keep shake; don't remove it.** The alternative was to drop shake now that the cursor works again (#399). Shake is
  the only way a touch reader moves the glitter, so removing it would make glitter a mouse-only toy.
- **Glitter flies, settles and stays.** A flick throws flakes the way the page was moving, at about half its speed,
  sprayed sideways past the post's edges. They tumble and glint as air drag slows them, settle at a slow flutter and
  land. Nothing in the air fades. Alternatives weighed: realistic motion that still landed only on Glitter Bomb posts
  and faded elsewhere (rejected: the fade is what bothered the owner).
- **Every post catches glitter (the owner: "Posts catch it").** A flake lands on whichever post is under it, any post,
  and stays there, moving with that post when the layout shifts. Within a post it lands on the cell under it (the
  postbit, the date bar, the body or the actions bar) and lies under that cell's content, so it never covers words.
  On a Glitter Bomb post's body it lands on the Glitter Bomb's own surface, as today.
- **Off the posts, glitter lands on the page (the owner, after trying the bench).** In the margins and between the
  posts, a flake that settles lands on the page itself and scrolls with it. In the bench's first version it fell on
  until it reached a post or left the screen, and the owner saw it "float down like snow". The alternatives were
  landing and then fading (still a fade) or dropping fast off the screen (most of the glitter lost).
- **Merging canvases is not a prerequisite.** The owner asked whether this was a reason to merge each post's effects
  onto one canvas (issue #317). It isn't: catching glitter on every post would add layers, not remove them, unless a
  layer exists only where glitter lies. #317 measures layer cost first and stays its own work. These surfaces fold into
  a merged canvas if its data later calls for one.
- **Landed glitter lies still, except on a Glitter Bomb post (the owner: "We can turn glinting off if it will help
  performance").** It does help: a glinting surface is redrawn about twenty times a second wherever it is in view, on
  posts that otherwise have nothing to draw. Lying still, a surface is drawn only when a flake lands on it. A Glitter
  Bomb post's own loose glitter keeps glinting, as it does today.
- **Cursor drops follow the same rule.** Glitter dropped from the cursor flies the same way, with a short hang, and lands
  on a post cell, a Glitter Bomb post or the page. All loose glitter behaves one way.

## 3. The motion, from the bench

The owner's settings are the defaults: thrown with 55%, air drag 7, flutter 50%, hang time 0.6 s.

- **The trigger.** Shake starts at 2,200 CSS px a second of scroll, as today. A full flick shakes about 40 flakes off
  each Glitter Bomb post in view, over its first 0.4 s, scaled from 40% at the threshold to 100% at twice it. At most
  400 flakes are in the air across the page (today 160 falling).
- **The throw.** Each flake is a copy of a settled flake on screen (the post keeps its own; the Shine design's reason
  holds). It leaves at its spot with a vertical speed of `-v × 0.55 × (0.6 to 1.4)`, where `v` is the scroll's speed
  (down positive, so a scroll down throws it up the screen with the post), and a sideways speed of up to 11% of `|v|`
  either way.
- **The air.** Each frame, drag multiplies both speeds by `exp(-7 × dt)` and gravity adds `480 × dt` down, so a flake
  settles to about 70 px a second. A flutter of up to 35 px a second sways it sideways (a sine at 5.5 radians a second,
  its phase the flake's own). It turns at 6 to 20 radians a second, faster while it moves fast, and its turn makes it
  flash as the cling layer's flakes do.
- **Landing.** After its hang time (0.6 s × 0.6 to 1.4), a flake lands at the next frame where it is over a landing
  place: a Glitter Bomb surface, a post cell or the page. A flake that has left the top of the screen comes back down
  first; one that leaves the bottom or the sides is gone, as glitter thrown off a table is.
- **The cursor.** A flake dropped from the cursor leaves with a sideways speed of up to 20 px a second, falls at 30 to 80
  px a second, and hangs 0.15 to 0.5 s.
- **Reduced motion.** It shakes nothing and picks nothing up, as today.

## 4. Where glitter lands

- **Order.** A landing point is hit-tested as cling does (#399): the first registered surface on the walk up from the
  element the browser finds there. Glitter Bomb's surface and the body's own cell both name the body as their hit; an
  effect's surface, which draws its own loose glitter, wins over a post cell. A hit has one owner at a time (issue
  #412's third finding): among registrations of one rank, the most recent wins, and unregistering it hands the hit back
  to the one before.
- **Post cells.** The thread registers each post when it mounts. A flake lands on the post's cell under it, in that
  cell's px, and takes the cell's board band (`engine/ui/shine/band.ts`), so it holds the readable band against the
  post's inks as every cling flake does.
- **The page.** Anywhere on the thread screen that is not a post or a Glitter Bomb surface, a flake lands on the page,
  in document px, and takes the page's band (the root's tokens).
- **Chrome with its own ground.** The banner, the nav bar, the thread's head and pager rows and the glass HUD each paint
  a ground of their own, which would hide glitter lying on the page under them. A flake that settles over one keeps
  falling at its settled speed until it is over a post or the page's own ground, or leaves the screen. Those bars are a
  row or two tall, so the fall is short. This is the one place glitter still falls on, and it is listed for the owner
  in the PR's design questions.
- **Layout shifts.** Glitter on a post moves with the post. Glitter on the page stays where it landed on the page; if
  the layout above it moves, it may end up beside or under a different post (behind it, since the page lies under the
  posts). That is accepted: it is glitter on the floor.

## 5. How it is drawn

- **Tiles.** Every landing surface, a post cell or the page, is drawn on tiles of 512 by 256 CSS px, at the loop's
  density (at most 2). A tile exists only where glitter has landed. Its backing store exists only while the tile is in
  view; out of view it is zeroed, and it is drawn again from its flakes when it returns.
- **A post cell's tiles** lie inside the cell, under its content, as the Glitter Bomb's canvases lie in the body: the
  cell is isolated only while it holds glitter.
- **The page's tiles** lie in the document at the bottom of the page's stacking order, under the frame and the posts,
  so glitter on the page shows only where the page's own ground does.
- **Still.** A tile is drawn when a flake lands on it (all landings in a frame together, one draw per tile) and when it
  returns to view. Nothing on a tile glints or is redrawn by the loop.
- **The air.** Flakes in the air stay on the page-fixed cling layer, which clears only the squares it drew in the frame
  before (Shine section 6).
- **Caps.** Loose glitter: 300 across the page, the oldest first to go, counting every surface (today's cap, now
  counting post cells and the page). In the air: 400. On the cursor: 26.

## 6. The rules

- **The engine never knows the instance.** Landing surfaces, tiles, the motion and the caps are the engine's
  (`engine/ui/shine/`), and the thread registers its posts (`engine/ui/thread/`). The flakes' inks come with each flake,
  from the Glitter Bomb that lent them (`instances/divided-world/ui/glitter-bomb/Effect.tsx`), as they do today.
- **Nothing private.** Loose glitter is the reader's own, never saved or sent, and is computed from nothing but public
  posts and the reader's own scroll and pointer.
- **No player is ever stuck.** Glitter is decoration, never an obstacle, and takes no pointer. It ends when the reader
  leaves the thread: leaving the thread screen sweeps every surface and removes the page's tiles. (The Shine design said
  loose glitter ends when the page is left; nothing swept it until now.)
- **Accessible.** All of it is hidden from assistive tech and lies under every word it lands near. Reduced motion turns
  it off. It is not an obstacle, so it needs no accessible path.
- **A busy instance.** Registering a post is one map entry; no post has a canvas until glitter lands on it. On screen
  there are at most the tiles in view that hold glitter, fewer than the 300 flakes and in practice a handful. Each is
  drawn once per landing, never per frame, so a fast scroll over landed glitter draws nothing but the air layer.

## 7. Open

- Whether chrome with its own ground should catch glitter as a post cell does, instead of letting it fall on to the
  page (section 4). Asked in the PR.
