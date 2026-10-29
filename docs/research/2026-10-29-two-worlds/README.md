# The two-worlds design session's boards

Record, written 2026-10-29. The boards the two-worlds design session (`docs/plans/2026-10-29-two-worlds-design.md`)
drew with the owner, one screen each, as the owner approved them: "These mockups are perfect, I'd like to really aim
for this exact look." They are the glass's reference for a build: a glass screen matches its board, and where a board
and the design disagree, the design wins on what is decided and the board on how it looks. They are references, not
code to copy; the web and cards plans say what is built. Open any of them in a browser; each is one self-contained
HTML file at a fixed size, loading Anton and Barlow Condensed from Google Fonts (a build serves both from the
instance's own files). The smoke in each is drawn as SVG fractal noise, with the calms as masks on it; the build draws
each calm on its own text block instead (design, section 4.4).

- `01-main.html`: the game screen: the 2003 board with the HUD docked at the bottom as glass (the character being
  played and its swap, the orbs and the next settlement, the hand), a card armed with "Play Whoops! here" on the
  eligible posts. Drawn before the pause menu was decided, so its banner still lists the glass's pages and its HUD has
  no Menu button; the design's section 5 wins (design, Open).
- `02-phone.html`: the same on a phone, with the hand drawer open as a glass sheet over the board.
- `03-react.html`: the React picker, a glass overlay over a post, its 2×2 quadrants.
- `04-orbs.html`: the aura orbs in every state: empty, settled, the estimate's ghost gain and loss band, past the cap,
  the cascade.
- `05-cards.html`: the postcards in the hand and the play form, a glass overlay over the board.
- `06-turn.html`: the Turn modal: the class, how loud, and the preview of what everyone will see. It opens over a 2003
  My characters table, drawn before My characters became the glass page of `10-roster.html`; the design wins.
- `07-vending.html`: the Vending Machine, a glass page under the menu bar.
- `08-hold.html`: Stick Around holding a reader: the post stays the board's, the frame, tag, BREAK FREE and the
  certification panel are the glass's. Its 2003 banner still lists the glass's pages; the design's section 5 wins.
- `09-settlement.html`: the settlement's summary, "While you were away", on the first visit after a settlement.
- `10-roster.html`: My characters, a glass page under the menu bar, with a character selected.
- `11-settings.html`: Settings, Accessibility: motion, smoke, contrast, text size and the board's colors. Its other
  sections and the read-out are placeholders no design has decided (design, Open).
- `12-log.html`: My log, plain and true, one row per line, a tab per character.
