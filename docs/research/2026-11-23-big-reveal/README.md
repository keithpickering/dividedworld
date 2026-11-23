# The Big Reveal: the owner's references

Record, written 2026-11-23. What the owner supplied in the design session for The Big Reveal
(`docs/plans/2026-11-23-big-reveal-design.md`).

- `minus-world/bigreveal.js`, `minus-world/curtain.svg` and `minus-world/curtain-draped.svg`: Minus World's own Big
  Reveal spell, the jQuery plugin and its two drawings. The roster in
  `docs/research/minus-world/season-1-spellbook-roster.csv` lists it as "Unstarted, mostly just CSS". The plugin
  hangs three curtains (top, left, right) and a lights layer on a post. It loops a drumroll while the mouse is over the
  post, and on a click plays a tada and opens the curtains in 750 ms before removing them. `curtain.svg` is six red
  pleats (#AF0000, #EE0000, #F73434); `curtain-draped.svg` is one swag with a striped gold trim (#E2BA00, #AA8C00).
  The audio files the plugin names were not supplied.
- `card-art-reference.png`: the card face's reference: red curtains drawn back by gold tiebacks, and a chicken on a bare
  stage in a spotlight.
- `sounds/`: the raw takes the owner makes in ElevenLabs for the card (a looping drumroll, a curtain whoosh and an
  original tada flourish). It is empty until the owner adds them; the plan's sound task waits on them.
