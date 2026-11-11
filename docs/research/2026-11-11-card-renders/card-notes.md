# Card art as 3D renders: the owner's card notes

Written 2026-11-11. A record of one session's renders for the cards of
`docs/plans/2026-11-11-card-notes-design.md`, in the style of the first exploration, whose own record is this folder's
`README.md` on the branch `ccr-51a4f655-4gy34e` (not on main when this was written). Nothing here is shipped: a render
cannot be a card's art today (`tools/check-card-art.mjs` refuses an `<image>`).

## What is here

Eighteen scenes, one for each card the design keeps that had no render. Whodunnit and Overreaction already have theirs
on that branch. Each scene is a Python script that builds a Blender scene from nothing, and the image it gave.

`rig.py` is that branch's, copied byte for byte so the two merge as one file; it was not changed here.

| Card | Flavor | Scene | Render | What it shows |
| --- | --- | --- | --- | --- |
| Line Cutter | Pepperoni | `line-cutter.py` | `line-cutter.png` | a queue of dull pawns at a velvet rope; a smirking orange one has squeezed in second |
| Off Day | Salty | `off-day.py` | `off-day.png` | a luchador mask hung on a locker hook, frowning, under its own small raincloud |
| Tattle-Tale | Salty | `tattle-tale.py` | `tattle-tale.png` | a cartoon glove pointing; a siren; a Mod Bot's head turning to look |
| Feelin' Glam | Sweet | `feelin-glam.py` | `feelin-glam.png` | Feelin' Fab's cloud in star sunglasses under a mirror ball, its beams across a thread's posts |
| Laugh Track | Pepperoni | `laugh-track.py` | `laugh-track.png` | a studio audience from behind, a lit LAUGH sign and a reel-to-reel |
| Mooch | Salty | `mooch.py` | `mooch.png` | a piggy bank on a pedestal sipping somebody else's pot of coins through a bendy straw |
| 4D Chess | Salty | `4d-chess.py` | `4d-chess.png` | three glass boards in tiers over a checker floor, and a tesseract |
| Graffiti | Pepperoni | `graffiti.py` | `graffiti.png` | a post on a brick wall under three colors of scribble, and the cans |
| Below the Fold | Salty | `below-the-fold.py` | `below-the-fold.png` | a page creased so its lower half bends away, a disclosure arrow and a pointer on it |
| Hype-Up | Sweet | `hype-up.py` | `hype-up.png` | a foam finger, a megaphone throwing rings and stars, pom-poms |
| Blind Study | Pepperoni | `blind-study.py` | `blind-study.png` | a chart under a blindfold, and four blindfolded reactions with a question mark each |
| Take the Fall | Sweet | `take-the-fall.py` | `take-the-fall.png` | a gavel coming down; one figure, arms wide, in front of a smaller one |
| Happy Heart | Sweet | `happy-heart.py` | `happy-heart.png` | a smiling heart beside the warn meter, its top notch popping off |
| Super Happy Heart | Sweet | `super-happy-heart.py` | `super-happy-heart.png` | the heart with wings, the meter empty |
| Ultra Happy Heart | Sweet | `ultra-happy-heart.py` | `ultra-happy-heart.png` | the heart crowned, through snapped bars, a padlock open on the floor |
| Sugar Coat | Sweet | `sugar-coat.py` | `sugar-coat.png` | a post under icing and sprinkles; a salt shaker and a pepperoni slice bouncing off |
| Toll | Pepperoni | `toll.py` | `toll.png` | a toll booth at dusk, its arm down, coins arcing into the basket |
| Last Word | Salty | `last-word.py` | `last-word.png` | a speech bubble zipped and padlocked; quotation marks cracked on the floor |

The colors are the first exploration's: orange for Pepperoni, cyan for Sweet, pink for Salty.

## How they were made

Three subagents wrote six scenes each from a one-paragraph idea, two to four drafts a scene (540 by 840, 40 samples),
looking at each draft. The session looked at every final draft and then rendered each at 1080 by 1680 and 200 samples.
None has been seen by the owner. To render one again, as the first exploration's record says:

```
python3 -m venv .venv
.venv/bin/pip install bpy==5.3.0 scipy
.venv/bin/python docs/research/2026-11-11-card-renders/toll.py out/toll.png
```

`ART_SCALE` and `ART_SAMPLES` work as they do there. Each scene but Below the Fold reads a seed from an environment
variable named after it in capitals with `_SEED` (`TOLL_SEED`; 4D Chess's is `FOURD_CHESS_SEED`). Take the Fall reads
its seed and uses it for nothing.

## What is weak, on this date

- **The name plate.** On most card sizes it covers the lower half. Mooch's coins, Toll's coin stacks, Last Word's
  quotation marks, Graffiti's cans, Blind Study's faces and Ultra Happy Heart's padlock are under it, so those cards
  read by their upper half alone at small sizes.
- **The gem corner.** Take the Fall's gavel and Tattle-Tale's upper beam run into the top right.
- **The hearts.** The three share a heart and a meter, copied into each file. Super Happy Heart's heart is a little
  smaller than Happy Heart's, where a step up was wanted; its wings and glow carry it.
- **Below the Fold** reads as a page bent away more than one tucked behind.
- **Last Word's** closing quotation marks foreshorten toward a pair of Ps.
- **Laugh Track's** sign says LAUGH; the game has no sound yet, and the card's design is still to come.
- **The cards these picture are recommendations.** If the owner reworks a card differently from the design, its scene
  may picture the wrong thing: Hype-Up, Mooch, Toll and Off Day most of all.
