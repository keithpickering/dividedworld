# It's Curtains: the owner's references

Record, written 2026-11-23. What the owner supplied in the design session for It's Curtains
(`docs/plans/2026-11-23-its-curtains-design.md`).

- `minus-world/bigreveal.js`, `minus-world/curtain.svg` and `minus-world/curtain-draped.svg`: Minus World's own spell
  (then named The Big Reveal; the card was renamed It's Curtains on 2026-11-25), the jQuery plugin and its two drawings. The roster in
  `docs/research/minus-world/season-1-spellbook-roster.csv` lists it as "Unstarted, mostly just CSS". The plugin
  hangs three curtains (top, left, right) and a lights layer on a post. It loops a drumroll while the mouse is over the
  post, and on a click plays a tada and opens the curtains in 750 ms before removing them. `curtain.svg` is six red
  pleats (#AF0000, #EE0000, #F73434); `curtain-draped.svg` is one swag with a striped gold trim (#E2BA00, #AA8C00).
  The audio files the plugin names were not supplied.
- `card-art-reference.png`: the card face's reference: red curtains drawn back by gold tiebacks, and a chicken on a bare
  stage in a spotlight.
- `sounds/`: the owner's four ElevenLabs takes, added 2026-11-25 and renamed for the slots they fill:
  `its-curtains-drumroll.mp3` (a steady drumroll, 5.0 s), `its-curtains-crash.mp3` (a snare and splash cymbal hit,
  3.0 s), `its-curtains-whoosh.mp3` (a fabric whoosh, 1.2 s) and `its-curtains-tada.mp3` (a quick horn fanfare, 3.0 s).
  They are the raw takes; the plan's sound task cuts them.
- `sounds/its-curtains-whoosh-take3-raw.mp3` and `sounds/its-curtains-whoosh-trimmed.mp3`, added 2026-11-25. The first
  whoosh swelled for about 200 ms before its body, so the curtain sounded late. Four new ElevenLabs takes swelled the
  same way, so each was cut at its onset (110 ms in for this take, with a 12 ms fade-in). The owner chose this take,
  trimmed, in the bench ("trim3 working well. Approved"). It replaces `its-curtains-whoosh.mp3` as the whoosh the
  build cuts from. The original take stays as the record of what was first supplied.
- `bench.html`: the prototype bench the owner tuned and approved on 2026-11-25 (fabrics, timing, look). Its defaults
  are the approved values; "Copy values" prints them as JSON.
