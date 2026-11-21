# Pop Steal's other picture: the caught bouquet

Written 2026-11-20. It records one scene from the session that made Pop Steal's card art
(`instances/divided-world/ui/cards/pop-steal/`): the second idea, which the owner liked as a model and did not choose
for the card. It is a record: nothing here is shipped.

Pop Steal's picture is a glove lifting the studio's APPLAUSE sign. The other idea was the same glove catching a bouquet
thrown for somebody else: red roses in a cyan paper wrap, tied with a white bow, over a pink ring. The owner kept the
sign for the card as the better picture for it, and asked that the bouquet be kept for some later picture.

- `bouquet.py` builds the scene from nothing with the cards' rig (`instances/divided-world/ui/cards/rig.py`), as a
  card's `scene.py` does, and renders it: `python bouquet.py bouquet.webp` from this folder, under the setup the cards'
  README gives.
- `bouquet.webp` is that render at the rig's defaults, 1080 by 1680.

To use the bouquet elsewhere, take the block that fills the list `bq`: the stems, the wrap and its lining, the seven
roses (`rose()`), the leaves and the bow, standing on z with the grip at the origin. The hand under it is Rope Break's
with a glove, studs, a cuff and a hooped sleeve, as in Pop Steal's scene.
