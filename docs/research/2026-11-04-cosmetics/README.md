# Cosmetics: the boards

Record, written 2026-11-04. The boards of the cosmetics design session, for the screens in
`docs/plans/2026-11-04-cosmetics-design.md`, section 6. The board's world is drawn as the screens boards are
(`docs/research/2026-10-29-screens/`); the glass as the two-worlds and booster packs boards are
(`docs/research/2026-10-29-two-worlds/`, `docs/research/2026-11-04-booster-packs/`). They are a reference for the look
and the layout, not code to copy. The owner confirmed them on 2026-11-04, adding that the wardrobe uses the class cards'
carousel so it holds a large inventory.

| Board | World | What it shows |
|---|---|---|
| `01-postbit.html` | The board | Two posts with gear on portraits of two shapes, a cap and a top hat reaching above the slot under the text, the chosen trophies and a belt; then the stacked band's square, gear cut at its edge. |
| `02-dressup.html` | The glass | The Wardrobe page: the portrait with its reach line, the selected mustache with its handles, the same moves as buttons, the square's preview, and the wardrobe's copies with where each is worn. |
| `03-trophy-case.html` | The board | A profile: the gear named in words, the trophy case with givers and dates, and a belt's lineage. |
| `04-event.html` | The glass | The Random Event dialog over a board, finding gear; below it, a line alone and a found card. |
| `05-admin.html` | The glass | The admin page: award a trophy, grant gear, make a trophy, recent awards with reversal. |

Each `.png` is its board at twice its size. `gen.mjs` writes each board from its `.src.html`, inlining the placeholder
art (`art.svg`) and the glass's smoke (`smoke.txt`, the booster packs boards' own), and with `--shots` takes the pictures.
The shared glass look is `boards.css`, copied from the booster packs boards.

All the art is a placeholder: the owner's Minus World gear and the trophies' badges replace it.
