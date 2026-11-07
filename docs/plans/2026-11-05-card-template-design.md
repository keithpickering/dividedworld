# The card template: design

Record, written 2026-11-05. A design session with the owner, which started from the owner's question of how to turn
the card designs into vector templates that allow custom art variants. The board drawn with the owner is
`docs/research/2026-11-05-card-template/01-layouts.html`, and its history holds the two layouts that were not chosen.
The plan is `docs/plans/2026-11-05-card-template-plan.md`.

The owner's opening, in their words: "The black edges of the current card design are a good direction - it can be made
into a black border, which the metadata elements (alignment, play type etc) will slightly overlap. Text and other
graphical elements (rarity etc) can remain where they are, but the inner area becomes a transparent mask for any art
variants people want to submit. We can also use the opportunity to think more in depth about the card's layout in
general, take inspiration from other popular TCGs to make it familiar yet distinct and compatible with the glass
appearance we already have." And: "This can all be part of a required art set for creating a new card (until now,
filled in implicitly by sessions, but now able to be specified)".

## 0. Where it starts

- **One component draws every card face**: `engine/ui/cards/Postcard.tsx` with `postcard.css`. It has four sizes in
  three shapes: the Vending Machine's slot at 92 by 128, the Phone board's sheet at 104 by 156, the HUD's fan at 150 by
  225, and the hand's sheet at 276 by 480.
- **An instance gives each card a `CardArt`** (`engine/ui/cards/types.ts`): a color, an ink, one `image` (a spot
  picture of about 120 by 110, set in the middle of the face), an optional `mark` and a tagline. Divided World's nine
  cards each ship `<key>.svg` and `<key>-mark.svg` in `instances/divided-world/ui/cards/`, and most of the pairs are the
  same drawing.
- **The mark** is that icon in a skewed glass tile, about 1.7rem tall, on a post's date row (`marks.css`).
- **Variants were already left a place.** The booster packs design (section 9) left alternate art open and settled one
  thing about it: "a variant would be a column on that row, never per-copy state."
- **No card-sized back exists yet.** A face-down card is drawn only as a mark (`.kb-card-back`). The booster packs plan's
  Task 5 draws the reveal's face-down cards "as the hand draws a postcard (`Postcard.tsx`)".

## 1. What this design covers

**The template and the art contract, not variants.** The owner chose this over designing variants as collectibles now,
or as a per-player cosmetic choice: "I am thinking about purely cosmetic differences, like a 'full art' pokemon card that
might be more rare but in actual play has the same functionality. It can be exciting to own, maybe something that people
hesitate to use in play (which also implies we should show the full art of the actual played card as part of an Act)."
So this design makes a variant possible: another art set on the same template. Who owns a variant, how it is found and
how a played one shows are the variant design's (section 11).

## 2. One shape: 2:3 at every size

**Every size is the same card, scaled.** The owner chose 2:3 over 5:7 (the real TCG ratio, squatter, and a change to all
four sizes) and over keeping the four shapes with art cropped to a safe area (which spoils any composed art).

| Size | Was | Now | What it holds |
|---|---|---|---|
| slot | 92 × 128 | 86 × 129 | the art, the name plate, the gem |
| phone | 104 × 156 | 104 × 156 | and the alignment and play badges |
| fan | 150 × 225 | 150 × 225 | and the tagline plate |
| sheet | 276 × 480 | 276 × 414 | and the summary plate, the price, and the foot line with the credit |

A smaller size drops pieces. It never reshapes the art. The slot keeps nearly its height so the machine's rows hold; the
sheet loses 66px of height, and the hand's sheet takes it back.

## 3. The frame and its numbers

**The template's units are a 600 by 900 card.** One module holds every number (the plan's Task 1), and both the card
face and the artist's template file are drawn from it, so they cannot drift.

- **The border** is 30 units, black, ringed and glowing in the card's color. The engine draws it, so no art file holds
  it.
- **The outer corner** has a radius of 45: the border's 30 plus the canvas's 15, so the border is 30 thick all the way
  round, at every size. The owner caught the first board's corners too round at small sizes, where the border thinned:
  the radius had been measured against the page, not the card.
- **The canvas** is the inner area, 540 by 840 at 30, 30, with a corner radius of 15. It is the art file's whole canvas
  and the only clip.
- **The keep-clear line** is 12 units in from the outer edge. The owner: "We do want everything to be kept inside the
  rounded rectangle silhouette. Shapes can encroach on the inner edge of the border but not the outer." So a piece may
  cover the border's inner part, and nothing is ever drawn outside the card's outline, at any size, in any variant.
- **The focus zone** is 460 by 400 at 70, 100: an optional guide (section 5).
- **The plate zone** is the lower third, under the name plate and the text plate.

## 4. Layout A, Low name

**The owner chose A, "today's card, grown up".** Weighed against it on the board: a Banner (from Magic and Yu-Gi-Oh!: a
title bar on the top border and the badges on the left one; the name is read first, but the bar takes a slice off the top
of the art) and a Cost corner (from Hearthstone and Lorcana: the price as a coin on the corner and the badges on the
bottom border; the most familiar game shape, but it puts the price on every size, where today it shows only on the
sheet).

- **Alignment and play** are parallelograms on the top border at the left, at the glass's tag skew: the alignment filled
  in the card's color with its ink, the play outlined.
- **Rarity** is a gem on its point in the top right corner. Its glyph says the rarity by shape (`gemOf`); its color is
  the booster packs plan's (Task 5).
- **The name** sits in a skewed glass plate across the art's lower third, with the card's color as a stripe at its left
  edge. The name is centered in its plate, with room at the left and top (the owner: "The card's title is not perfectly
  aligned within its container, could use more left and top padding").
- **The text plate** below it holds the tagline (fan) or the summary (sheet). It is chamfered at two corners, the glass's
  cut, and its 1px edge runs all the way round, the chamfers included (the owner: "border all around").
- **The price** sits on the bottom border at the right, on the sheet.
- **The foot line** sits in the bottom border on the sheet: "Postcard · One per post" (or "Stacks 3 deep") at the left,
  and the art's credit at the right, ending before the price.

**The plates keep their words readable over any art.** They are translucent glass, so art shows through them as
texture, and their opacity is held so their text meets contrast over pure white, the brightest art can be. Reading a card
is the forum itself under "An accessible path costs what the obstacle costs", so no art can make a card's words
unreadable, and the contrast guard proves it (the plan's Task 6).

## 5. Full art only

**Every card's art fills the whole canvas.** The session first proposed a window above the text box, then a default art
kept to the focus zone with full art reserved for variants. The owner, on seeing the board's full-art pieces: "I prefer
your full art variants even for the defaults, so I guess we should just go 'full art only', and a submitted design can
focus on one area of the frame if desired."

- **A design that keeps to one area** puts its subject in the focus zone on a transparent ground. The engine always
  draws the card's dark ground and a soft glow in the card's color under the canvas, so a transparent ground shows those,
  and glow, rings and splashes may run past the zone. The zone is a guide, never a mask.
- **A variant is another canvas of the same size.** What sets it apart is its art, and whatever the variant design gives
  it. It is not a different frame.

## 6. The art set

**Every card has an art set, and the build holds it to the template.**

- **The canvas**: `art.svg`, viewBox exactly `0 0 540 840`. Vector, so it is sharp from the slot to the sheet.
- **The mark**: `mark.svg`, a square viewBox. A silhouette drawn to read at 18px in the post's mark tile. It is required,
  not a fallback to the canvas: a full-art canvas shrunk to 18px is mud.
- **The color and ink**, and the tagline, as today, in the instance's `CardUi`.
- **The manifest**: `art.json`, holding `credit` (who made it) and `license` (the terms they offer it under). It is the
  shape an upload would later fill.

**Format.** The owner agreed: the required set is SVG, and a variant's canvas may be SVG or a raster image at 1080 by
1680 (twice the canvas, enough for the largest size on a 2× screen). Painted art is much of what makes a variant
exciting, and vector alone would shut out most artists. Weighed: vector everywhere (painted and pixel art ruled out), and
any format everywhere (a raster mark is mud at 18px). The raster rule is written here for the variant design to build;
this plan builds the required set's rules.

**Art arrives by pull request** into the instance's folder, one folder per card: `instances/<name>/ui/cards/<key>/`. The
owner approves art in review, as the glass's own copy is approved. Weighed: uploads accepted by an admin in the running
instance, which need storage, moderation, admin screens and a place in the export, and belong with the variant design
(section 11).

**The check** (`tools/check-card-art.mjs`, with its self-test) reads every instance's card art folders and fails on: a
folder missing a file, a canvas whose viewBox is not `0 0 540 840`, a mark that is not square, a manifest without a
non-empty credit and license, a file over its size cap, and anything in an SVG that runs or reaches out: a `script`, a
`foreignObject`, an `on…` attribute, or an `href`, `xlink:href` or `url()` that is not a fragment (`#…`). Art comes from
the community, and an SVG is a document that can carry script. That every card has a folder is the type system's: a
`CardUi` without a canvas, mark and credit does not compile.

**The artist's template** is an SVG generated from the template module: the frame's outline, the canvas, the focus zone,
the plate zone and the keep-clear line on a locked guides layer, and an empty art layer. A test fails when the committed
file differs from what the module generates. Beside it, a short guide for artists says what the set is and how to send
it.

**The credit shows on the sheet's foot line only.** "Art · <credit>". The owner chose this over the fan and the sheet
(the foot text would be about 5px at the fan's width, decoration and not credit) and over no credit on the card (the
artist invisible where their work is seen). A credit names a real person and describes the art, never a character, so it
says nothing about who plays which mask.

## 7. The nine cards' art

**A build session draws full-art canvases and marks for all nine cards**, in the spirit of the board's two (Stick
Around's rings and pin to the edges, Whoops!'s splat filling the card). They are placeholders, credited "Divided World".
The owner: "Placeholder art is fine, I like what you came up with so far." The old spot pictures and marks go.

## 8. The card back

**A card's back is drawn in the same frame and silhouette, at every size**, as the engine's own art: its border, the
glass's crossed bands on the canvas, and no card's color, so a back says nothing about the card it is. The hit pull's
back is gold, as the booster packs design draws it. The mark's back (`.kb-card-back`) is unchanged. The booster packs
plan's reveal draws its face-down cards with it.

## 9. The boards

**Boards 05 (the hand's sheet) and 07 (the Vending Machine's slot) are amended** for the new sizes, with a dated note
naming this design, as earlier designs amended their boards. Boards 01 and 02 draw the fan and the phone sheet, whose
sizes do not change. The boards compare a card by its box and its name, never its face, so only the boxes move.

## 10. The rules this touches

- **The masks.** A card's art, mark and credit belong to the card, the same for every player, and nothing here is computed
  from who owns or played a card. No response, payload, Realtime event or timing is added.
- **Ways out.** No state a player, a character or a post can be put in is added.
- **The layers.** The frame, the template module, the template file, the back, the check and the guide's contract are
  the engine's. The art, the manifests and the instance's guide are Divided World's, and reach the engine through
  `CardArt`. The check reads every instance's folders and names none.
- **Portable.** The art is files in the repository, so a fork or a self-hosted instance carries it.

## 11. Open

For the variant design, which takes up the booster packs design's alternate art:

- **Owning a variant**: the ledger column, how a variant is found (pulled, granted, sold), and its own rarity beside the
  card's.
- **A played variant**: the owner wants "the full art of the actual played card" shown as part of the Act. So the play
  Act records the variant, and the mark and the Lens show it. Spending a rare copy is then visible, which is part of the
  fun the owner described.
- **A variant can fingerprint a player.** A rare variant played by several of one player's characters ties those masks
  together. Whether that is a clue the game is happy to give is the variant design's call, under "A response never proves
  a private fact".
- **Foil.** The board's idea of a foil edge on a variant's ring and mark.
- **Uploads** in the running instance, filling the same manifest, and a variant's raster canvas.
- **A credits page** in the Strategy Guide.
- **The placeholders' license.** The repository has no license yet; the placeholders' manifests say they are the
  project's own art, and the owner gives the license when the repository gets one.

## Amended 2026-11-07: the back carries the instance's mark

The owner, during the build: "Can we make card backs use our favicon, maybe?" So section 8's back gains an emblem, the
way a trading card's back carries its game's logo. An instance may give one mark for its cards' backs
(`InstanceUi.cardBack.mark`, a URL the bundler resolved), and `PostcardBack` draws it centered on the crossed bands. The
engine names no instance's mark: without one, the back is the bands alone, as section 8 drew it. Divided World gives its
favicon's vector, `instances/divided-world/ui/icon/coin.svg`. The back still says nothing about the card it is: the
mark is the instance's, the same on every back. A hit's back keeps its gold ring and bands, with the same mark on them.
The mark's back (`.kb-card-back`, a post's face-down tile) is unchanged by this amendment. Bluff's art, a red held-up
card with a question mark, stays clear of the back either way.

## Amended 2026-11-07: the back is a cloud, and its mark glows

The owner, on the booster packs boards redrawn that day: "I think we can do without the X shape on the card back. Let's
make the coin a bit larger on there, give it an outer glow and a cloudy multicolor background, like we use for the
glass." So section 8's back changes, at every size:

- **No crossed bands.** The canvas is a still cloud in the glass's look: two layers of fractal noise (the smoke's own
  kind, `GlassTheme.smoke.field`, frozen), white with alpha, tinted by a gradient of the glass's tokens multiplied over
  them (violet, the neon, violet, then the salty pink at the foot), so the clouds take the colors and the field between
  them stays dark. The engine names no color: the noise is a monochrome SVG in a `url()`, and every color is a token. It
  is still, never the page's drifting smoke, so a back reads the same in the hand, the reveal and a screenshot, and costs
  one shared image however many backs are drawn.
- **The mark is larger and glows.** Two thirds of the card's width (it was half), with no disc under it since the mark
  draws its own rim, and an outer glow in the neon: a thin ring, a close glow and a wide one.
- **The hit's back** keeps its gold ring, and its clouds (gold, pink, gold) and glow are the machine's gold.

The back still says nothing about the card it is: the cloud, the mark and the colors are the same on every back. The
mark's back (`.kb-card-back`, a post's face-down tile) is unchanged. The booster packs plan's Task 9 builds it; the
booster packs boards (`docs/research/2026-11-07-booster-packs/`) draw it.

## Amended 2026-11-07: the mark's back is the card's back, small

The owner, on the face-down mark in a post's date row, which still drew the old crossed bands: "Can we change the 'card
back' Mark to look more like one of our actual redesigned card backs (with the cloudy background + logo coin, or even
just the cloudy background alone)?" And on the setter's own card in the mark's corner: "It may not be needed, the lens
would already tell the owner which card back is which." So the amendment above's "the mark's back is unchanged" no
longer holds, and section 3 of the card mechanic's design (`2026-11-01-card-mechanic-design.md`) changes where it says
the setter's screen shows their card's face on the back:

- **The mark's back** (`.kb-card-back`) is the card's back drawn small: a 2:3 card in the icon's height, its cloud and
  glow the back's own rules in `postcard.css` (one selector list, never a copy), and the instance's mark
  (`InstanceUi.cardBack`) at its center with the back's glow. An instance with no mark draws the cloud alone.
- **No face on the mark.** The back is drawn the same to every reader, its setter too. The setter's Lens already names
  their card on each of their backs ("Yours: …, which nobody else can see."), so nothing is lost.
