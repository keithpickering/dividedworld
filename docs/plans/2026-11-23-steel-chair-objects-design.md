Record, written 2026-11-23.

# Steel Chair throws other things: design

A design session with the owner. The owner's words: "for the Steel Chair effect, keep about a 90% chance for the thrown
object to be a Chair, but also add an assortment of other possible objects: metal trash can with lid that flies off,
step ladder, fire extinguisher that causes an incidental white hot box when it hits the floor." And on the puff: it
"can animate in from the can spout, then fade out over a few seconds while still maintaining the cursor interactivity
from hot box while it fades."

The card stays as it is: Steel Chair (Salty, common, a Move on a post), `docs/plans/2026-11-15-wave-1-cards-design.md`,
section 2.3, with its dent (`docs/plans/2026-11-16-steel-chair-dent-design.md`) and its ORIGIN box
(`docs/plans/2026-11-16-steel-chair-origin-design.md`). What changes is what is thrown. Its rules
(`instances/divided-world/cards/steel-chair.ts`) do not change, and no migration, seed or configuration is added.

## 1. What is thrown, and how it is chosen

**The table.** One weighted list in a new `instances/divided-world/ui/steel-chair/objects.ts`, out of 1000:

| Object | Weight | Share |
|---|---|---|
| chair | 900 | 90% |
| trash can | 40 | 4% |
| step ladder | 40 | 4% |
| fire extinguisher | 20 | 2% |

The owner chose the extinguisher as the rarest, since it brings the puff. A post with three Steel Chairs shows at least
one thing that isn't a chair about 27% of the time. Adding an object later means one entry in the table, plus its shape,
its pieces, its dent, its sounds and its words.

**The roll: from the play's id.** `objectOf(playId)` draws from `rng(seedOfIds(['object', playId]))`, the generator and
hash the dent already uses (`dent.ts` `dentShape` seeds from `['dent', playId]`). So a play is the same object for
every reader, on every load and every replay, in its thread, its ORIGIN box and its moments, while where it lands stays
each run's own. The alternatives:
- *Rolled when the Move is played, and stored in the play's configuration.* The same result for readers, but it needs a
  configuration field and a seed change, and it only pays its way if the object ever changes the rules. It doesn't.
- *Rolled on every load.* Cheapest, but a reader who saw a ladder sees a chair on the next scroll, and the shared
  moment ("did you see the ladder?") is gone.

A player cannot fish for an object: a play's id is made by the server (`gen_random_uuid()` in `play_card`,
`supabase/migrations/0374_cards_on_a_spun_thread.sql`).

**What changes for plays that already exist.** About 10% of the Steel Chairs already on an instance become other
objects, since the hash reads ids that are already there. Nothing is stored, so nothing needs migrating. The game has no
players, so no reader sees a chair turn into a ladder.

## 2. The physics: shapes, not the chair's box

`body.ts` today simulates one shape, the folded chair's 46 by 90 by 8 box (`HALF`, `CORNERS`, `SAMPLES`, `RADIUS`,
`probe`, `separation`). It becomes a per-body `Shape`: the points that can touch (corners and edge samples), the face
axes and edge directions for the separating axis test, the inertia of a uniform solid of that shape, an optional hinge,
and the poses it may sleep in. Three ways were weighed:
- **Convex hulls (chosen).** Chair and ladder stay boxes; the can, the extinguisher and the lid's outline are 12-sided
  prisms, so they roll and wobble out of the contacts the solver already has, with no scripted rolling. One collision
  path serves floor, walls and piles. Twelve sides give six distinct rim directions, so a prism's separating axis test
  has 7 edge directions against a box's 3.
- *Exact cylinders.* Smoother rolling, but each pairing (cylinder and box, cylinder and cylinder) is its own special
  case: much more code and testing for a difference that is hard to see at 40 px.
- *Everything a box, drawn round.* Round things would rest on flat sides they don't have.

The chair's simulation must be the same after the refactor: a chair's throw and rest for a given seed do not move by a
pixel. The refactor is proved against a record of 200 seeded rests taken before it.

**The shapes**, in px, each reaching no farther from its middle than the chair does (`Math.hypot(23, 45, 4)`, about
50.7), so the floor's drawn depth `K` (`chair.ts`) is the same for every post:

| Object | Shape | Size |
|---|---|---|
| chair | box, hinged (unchanged) | 46 wide, 90 tall, 8 thick folded |
| ladder | box, hinged | 30 wide, 96 tall, 6 thick folded |
| trash can | 12-sided prism | 30 across, 40 tall |
| extinguisher | 12-sided prism | 15 across, 50 tall, with a spout point at its top |

**The ladder** flies in open as a three-step A-frame and snaps shut at the hit, the chair's own beat and hinge timing.
The alternatives were flying in shut and springing open on impact (funnier, but a standing A-frame isn't lying low, so
it would need its own rest rule) and a rigid ladder with no hinge (the least lively).

**Upright rest.** A chair or a ladder may sleep only lying low; one that goes quiet standing up is nudged over, as
today. The can and the extinguisher may also sleep standing on a flat end: a can that lands on its base and stays there
is the joke. `REST_RISE` becomes each shape's own figure, and the floor's room (`ROOM_HEIGHT`, today a fixed 77 px held
equal to `steel-chair.css` by a test) becomes `roomHeightOf(objects)`, worked out per post from the objects its plays
rolled. The effect sets it on the marked content area as a custom property, so a post of chairs alone keeps today's
77 px exactly, and a post with a standing can gets the few px more it needs.

## 3. The trash can's lid

At the hit the lid leaves: it spins up and out on a scripted arc, past the content area's border, and is gone within
about a second. Breaking the frame is the joke (CLAUDE.md, "An effect fills the post, border to border": an effect may
leave the content area "where leaving is the joke"). The alternatives were a second body that lands in the pile (a post
could hold six bodies) and choosing between the two by the roll.

The lid is not a body and collides with nothing. Its arc is pure: the seeded numbers of its throw, and the time since
the hit. It is drawn on the chairs' layer, which is already overflow-visible, and every ancestor between that layer and
the page must let it out, in a thread and in an ORIGIN box alike. After the hit the can is drawn without its lid; under
reduced motion it is drawn lidless at rest.

The lid has no sound of its own. The can's hit, a hollow bang with a tinny ring, covers it. The owner was unsure the lid
needed one; this is the session's call, and the owner can strike it in review.

## 4. The extinguisher's puff

When the extinguisher first meets the floor (the body's first `floor` event), white smoke jets from its spout, billows
to fill the post's content area border to border in about 0.6 s, holds for about 0.4 s, and fades to nothing over about
4 s. While it fades, a reader's pointer or finger clears it the way it clears Hot Box: a clearing that follows the
pointer, a wake behind it, and fog that flows around it.

- **It is drawn with Hot Box's machinery.** The fog field and its painting are `hot-box/fog.ts` (pure, with no Hot Box
  in it), the clearings and trail are `hot-box/smoke.ts`'s, and the canvases are the engine's tile layer
  (`engine/ui/cards/tiles.ts`). A new pure model, `steel-chair/puff.ts`, gives the field its floor at each moment: open
  outside the billow's front, which grows from the spout, and an opacity that fades the whole. Hot Box's pointer
  handling (`hot-box/Effect.tsx`, "the pointer: on the content area, passive, never prevented, never captured") moves
  into a shared hook that both effects use, so the two clear alike.
- **It is not an obstacle.** It clears itself within about 5 s, so the words never go inert, nothing waits on a
  control, and the Lens gains nothing. Waiting a few seconds costs every reader the same (CLAUDE.md, "An accessible path
  costs what the obstacle costs"). The pointer's clearing is play, not a way through.
- **When.** On every throw: each scroll back into view, each "Throw again", each play landing while the run stands, and
  in a moment, which is a live run (the owner, in this session: "Moments play animations now, so viewers of a Spun
  moment will see the lid fly"). Reduced motion has no flight and no puff, as it has no sound; the extinguisher is drawn
  at rest. Under forced colors no puff is drawn: it cannot be drawn in system colors, and it hides nothing for long.
  The alternatives were a puff only with the first throw on a page, as the sounds play, and a faint haze that stays for
  the play's three days (a real obstacle with Hot Box's whole accessible path, and a balance change).
- **The look.** White (`#f2f4f7`), shaded by `fog.ts`'s own lighting. The numbers (the jet, the billow, the hold and
  the fade) are set on a bench page the owner approves before the effect draws it, as Hot Box's fog was
  (`docs/research/2026-11-15-hot-box-fog/01-fog.html`).
- **Its sound** is the hiss, on the puff's start.

## 5. The dents

`dentShape(playId, object)` gives each object its own dent from the same pipeline (the height map, the displacement
filter, the shading). Only the shape's parameters differ:

| Object | Dent |
|---|---|
| chair | today's crumple, unchanged for every play id |
| ladder | long and narrow, a crease with a rung's ridge across it |
| trash can | round and deeper, fewer lobes |
| extinguisher | the smallest and deepest, round |

## 6. Words and sounds

- **Status** names what was thrown, in the order the plays landed: "Dented by a ladder", "Dented by a chair and a fire
  extinguisher", "Dented by 2 chairs and a trash can". The alternatives were keeping "chair" for everything as a gag, and
  neutral words ("Dented 2 times").
- **The rules text** (`describe`, which must be true, per CLAUDE.md "The fiction may lie; the log never does") says that
  the thing thrown is usually a folding chair and sometimes something else, names the three others, and says the
  extinguisher's spray clears by itself in a few seconds. The face's tagline and summary stay. The log names the Act,
  Steel Chair, as it does now.
- **Sounds**, picked by the owner from four takes each (`docs/research/2026-11-23-steel-chair-objects/README.md`): a hit
  and two settle sounds each for the can, the ladder and the extinguisher, and the extinguisher's hiss. Each object
  plays its own hit and one of its own settles; the chair keeps its hit and four settles.
- **Captions:** "A trash can bangs", "A trash can clatters to the floor", "A ladder clangs", "A ladder clatters to the
  floor", "A fire extinguisher thunks", "A fire extinguisher clunks to the floor", "A fire extinguisher hisses".

## 7. The hype film

The commentary film's three staged Steel Chairs stay chairs, so the commentary still matches. The fake backend makes a
play's id itself (`engine/ui/data/fake.ts`, `seed.card`), so `seed.card` gains an optional `id`, and the stage draws ids
until `objectOf` gives a chair. Board stories and e2e use the same option to show a chosen object.

## 8. The layers, the masks and the ways out

- **Layers.** Everything here is Divided World's: `instances/divided-world/ui/steel-chair/`, `hot-box/` (the shared
  pointer hook), `sounds/`, `cards/steel-chair/ui.ts`, and the hype stage. The one engine change is the fake's optional
  `id` on `seed.card`, which names no instance. No engine interface is added.
- **Masks.** `objectOf` reads the play's id, which every reader already has. Nothing is added to any response, payload,
  Realtime event or timing, and the effect still reads neither who wrote the post nor who played the card.
- **Ways out.** No new state is put on a player, a character or a post. The puff ends by itself within about 5 s.
  An object goes with its play: 3 days after it landed, or when an admin ends the play.

## 9. A busy instance

A post holds at most three bodies, as it does now (the lid isn't a body). A prism pair's separating axis test has more
axes than two boxes, so a step costs more where cans and extinguishers lie together. The plan measures this the way
`body.ts`'s header does, and the frame's cap of 4 steps holds the worst. The puff disturbs the whole content area for
about 5 s, so its fog is stepped everywhere in that time, not only where a pointer is. It goes on the page's shared fog
ladder (`hot-box/Effect.tsx`, `FOG_BUDGET_MS`) with every smoked post, so a page with a puff and several Hot Boxes steps
down a rung rather than dropping frames. At 2% of plays, a page rarely holds two puffs at once.

## 10. Open

Nothing is open. The puff's numbers wait on the bench page (plan, Task 10), which the owner approves before Task 11
draws it.
