# The Vending Machine's flow: the boards

Record, written 2026-11-22. The boards of the Vending Machine flow design session, drawn in the glass as the two-worlds
boards are (`docs/research/2026-10-29-two-worlds/`), for `docs/plans/2026-11-22-vending-machine-flow-design.md`. They are
a reference for the look and the layout, not code to copy; where a board and the design disagree, the design wins on
what is decided and the board on how it looks. They replace board 07's machine (`2026-10-29-two-worlds/07-vending.html`)
and the booster packs' board 01 (`2026-11-07-booster-packs/01-machine.html`) where those draw the coin slot, the push
tray, the shelf edge and the rounded body.

| Board | What it shows |
|---|---|
| `01-desk-picked.html` | 1440 by 1080. Overreaction (C2) picked: the cell's cyan border, the decision column (the price display, Buy with the card's name, the empty tray, the hand counter "2 → 3"), the wallet's drain. |
| `02-desk-bought.html` | 1440 by 1080. Just after buying it: the pick cleared, "Bought · Overreaction / 4.62 left", "Buy another", the card resting in the tray, the hand at 3. |
| `03-phone-picked.html` | 390 by 844. The compact head, the machine on the first screen, Autocorrect (A2) picked, and the purchase bar risen at the window's foot. |
| `04-phone-short.html` | 390 by 844. The Booster (A1) picked with 1.62 solid: the cell and price in Salty pink, "Need 3.00 · have 1.62 solid", Buy muted. |
| `05-phone-info.html` | 390 by 844. Overreaction's info as the phone's bottom sheet, with Close and Buy in its sticky foot. |

Each `.png` is its board at twice its size. `gen.mjs` writes every board (`node docs/research/2026-11-22-vending-flow/gen.mjs`);
the card art is the instance's own (`instances/divided-world/ui/cards/<key>/art.webp`), and the pack's foil is drawn in
place of `PackArt`. The type sizes are the glass's (body 21px, labels 20px, the price in Anton), and every corner is
chamfered.
