# Booster packs: the boards, redrawn

Record, written 2026-11-07. The booster packs boards drawn again after the card template merged
(`docs/plans/2026-11-05-card-template-design.md`), for the screens in `docs/plans/2026-11-04-booster-packs-design.md`.
The first drawing (`docs/research/2026-11-04-booster-packs/`) stays as the record of what the owner chose on 2026-11-04;
these boards keep every one of those choices and are the ones the board match reads (`e2e/boards.spec.ts`). Why they were
redrawn, and the two choices the owner made for them, are in the design's amendment of 2026-11-07.

| Board | What it shows |
|---|---|
| `01-machine.html` | The machine at 1440, laid out as the build lays it out on main: the Booster in A1 selected, with what is in it, its price and Buy; its odds pull by pull in the right column, each rarity drawn as the card face's own gem; the Boss's moves in force in plain words. Whoops! is pulled by the Boss (A2), Glitter Bomb is marked up (E1), Main Event is hidden so it draws no slot, and E2 is sealed. |
| `02-reveal.html` | The reveal after buying, three of five turned: the card last turned in the spotlight at the sheet's size, and the pack in pull order beneath at the fan's size, the next back a button and the hit's back gold. |
| `03-hit.html` | All five turned: the hit in the spotlight, a rare Main Event with its gold tag, glow and sparkles. |
| `04-phone.html` | Four screens at 390 by 844: the machine scrolled to the selected Booster, the reveal as a pile (three turned), all five turned, and the admin page with each slot a block. |
| `05-admin.html` | The machine's admin page under the Admin tab, its two pages (Moves and The machine) in a strip of two under the lead: slots in grid order with move up and down, availability, price, any Boss move in force linked to the queue, and one Save changes. |

`gen.mjs` writes every board. Run it from the repository's root: `node docs/research/2026-11-07-booster-packs/gen.mjs`.
It renders each card face and back with the engine's own `Postcard` and `PostcardBack` (`engine/ui/cards/Postcard.tsx`),
through Vite, from Divided World's cards, and inlines the engine's stylesheet over the instance's glass values, so a board
shows the card template exactly as the build draws it on the day it was run. Run again, it follows the cards' art.

The pack's wrapper and foil are a placeholder, with the instance's mark (its favicon's coin, as the card back carries it);
the pack's art is the owner's to give, and is the instance's, as a card's art is.
