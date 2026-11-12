# A rendered card back: an instance may give the back its picture

Record, written 2026-11-11. It surveys the card face and back (`engine/ui/cards/Postcard.tsx`,
`engine/ui/cards/postcard.css`), `InstanceUi.cardBack` (`engine/ui/types.ts`), the art guard
(`tools/check-card-art.mjs`), the art contract (`specs/card-art.md`), and the rendered card art design
(`docs/plans/2026-11-11-rendered-card-art-design.md`), which this follows.

The owner, once every card's face was a render: "we need a rendered card back (same look as the current, but in 3D)".

## 0. Where it starts

- **The back today is the stylesheet's.** `PostcardBack` draws the card's frame with, on its canvas, two layers of
  smoke made by an inline SVG filter under a diagonal tint in the glass's colors, and at the center the instance's mark
  (`InstanceUi.cardBack.mark`, Divided World's coin) with a glow. The hit pull's back (`hit`) is the same in the
  machine's gold. A back names no card: its look is the instance's, never a card's.
- **The same smoke** is the small tile of a face-down card on a post (`.kb-mark[data-kb-back='down']::before`).
- **An instance can give only the mark.** `cardBack?: { readonly mark: string }`.
- **Card faces are now renders**: a card's canvas may be `art.webp`, 1080 by 1680, held by the guard by its header.

## 1. The back may have a picture

**Decided** (the owner chose the recommendation of two): `InstanceUi.cardBack` may carry two pictures, `canvas` (the
back of every card) and `hitCanvas` (the hit pull's). Each is a canvas as a card's is: an SVG on `0 0 540 840` or a WebP
of 1080 by 1680.

- **With a picture, the engine draws it** over the back's canvas, as a face's art is drawn, and draws no separate mark:
  the picture holds the emblem. The frame, and the hit pull's gold edge and glow on it, are still the engine's.
- **Without one, the back is today's**: the stylesheet's smoke and the mark. So an instance that gives nothing, or only
  a mark, is unchanged.
- **A hit pull with no `hitCanvas` draws today's gold stylesheet back**, never the default picture: the hit pull's back
  must be told from the others at a glance, and a default picture under a gold frame would not be.

Weighed: one picture recolored gold by a filter for the hit pull (one file, but the gold is whatever a hue shift gives,
and Divided World's violet coin would shift with it); a picture for the smoke alone with the mark still laid over by
the engine (the point of a render is the coin in the scene, lit by it).

## 2. The small tile keeps the stylesheet's smoke

**Decided** (part of the choice above): the 18px tile of a face-down card on a post is not given the picture. A 1080 by
1680 image decoded for a tile that small, once per face-down card on a page, is the cost the rendered card art design's
review flagged for the Vending Machine, on a screen with far more of them. The tile's smoke stays the stylesheet's, in
the same colors, so the two still read as one thing.

## 3. Where the files live, and what holds them

An instance's back art is one folder, `instances/<name>/ui/card-back/`:

- `art.svg` or `art.webp`, exactly one: the back of every card.
- `hit.svg` or `hit.webp`, at most one: the hit pull's. Optional.
- `art.json`: credit and license, as a card's. It is not shown anywhere today (a back has no foot line); it is there so
  the art's terms are with the art.
- No `mark.svg`: the back's mark is the instance's own, given separately, and a back has no tile of its own.

`tools/check-card-art.mjs` reads the folder where it exists, and holds each picture to what it holds a card's canvas
to: an SVG's viewBox and safety, or a WebP's header, size, stillness and 400 KB cap. A repository with no such folder
passes, as one with no card folder does.

Divided World's two pictures are rendered from `instances/divided-world/ui/card-back/scene.py`, with the card scenes'
rig: the coin as a raised medallion with a glow, in smoke lit in the back's own colors.

## 4. The layers, the masks, the scale

- **Engine:** `InstanceUi.cardBack`'s two new fields, `PostcardBack`, its three callers (the Vending Machine's pack
  rows, the pack opening, the Postcard story), the guard, the spec. The engine never learns which instance's back it is.
- **Instance:** the folder, and `cardBack` in `instances/divided-world/ui/index.ts`.
- **Nothing private.** A back's picture is the same file for every card, every player and every viewer; it is chosen by
  `hit` alone, which is already public on the screens that show it (the last pull of a pack). No response, payload,
  event or timing is added.
- **No state** a player, character or post can be put in is added.
- **Scale.** Two files for the whole instance, however many cards, players or Acts: about 100 to 200 KB each, fetched
  once. A pack opening shows up to a pack's worth of backs at once, all the same image, which a browser decodes once.

## 5. Open

- **The gold.** The hit pull's picture is made by the same scene with the smoke's and the glow's colors changed, as the
  stylesheet does. Whether the hit pull wants a scene of its own is the owner's.
- **A back for a variant** is the variant design's, as before.
