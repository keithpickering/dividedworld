# Booster packs: the boards

Record, written 2026-11-04. The boards of the booster packs design session, drawn in the glass as the two-worlds boards
are (`docs/research/2026-10-29-two-worlds/`), for the screens in `docs/plans/2026-11-04-booster-packs-design.md`.
They are a reference for the look and the layout, not code to copy. The owner chose the three things they settle:
- the pack is just another slot;
- a pack opens with tap to flip ("straight out of Pokemon TCG Pocket, a pretty modern reference which works well in
  the glass");
- the admin page is a plain list.

| Board | What it shows |
|---|---|
| `01-machine.html` | The machine with the Booster in A1 selected and its odds shown plainly. Whoops! is pulled by the Boss (A2), and Glitter Bomb is marked up (E1). Main Event is hidden, so it draws no slot. |
| `02-reveal.html` | The reveal after buying: three cards turned, the fourth turning, and the hit last, face down and glowing gold. |
| `03-hit.html` | All five turned. The hit is a rare Main Event, with its gold tag. |
| `04-phone.html` | The reveal on a phone: the cards in a pile, the top one turned with a tap, and a row of five saying how many are left. |
| `05-admin.html` | The machine's admin page: slots in grid order, with move up and down, availability, price, and any Boss move in force. |

Each `.png` is its board at twice its size. `gen.py` writes boards 02 to 05 from one card template, and writes board 01
from `01-machine.src.html`. Both add the smoke in `smoke.txt`. The shared look is `boards.css`.

Card art is the instance's own (`instances/divided-world/ui/cards/`). The Booster's foil, the card back and the rarity
gems are placeholders: the pack's art is the owner's to give.
