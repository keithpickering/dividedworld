# Player copy: prepare, don't assign research

Current. The test for every word a player reads in the glass: card descriptions, the Strategy Guide, tips, Settings,
the Lens and the log. The owner settled it on 2026-11-27 (`docs/plans/2026-11-27-copy-pass-design.md`).

> In Super Mario Bros, you die by the first Goomba in 1-1, repeatedly, until you figure out how to jump. This is the
> purest example of game design, learning through experience. Our 1-1 is a message board at whatever state it is on
> that day, so not quite as predictable - the omochao-style explanations are forgivable for that reason. But
> generally we want to surprise and delight and prepare, not assign research.

## The test

A clause **stays** if a player could act on it before doing the thing (plan a play, spend, choose a setting), or
needs it to know what was done to them, how a state ends, or what is private.

A clause **goes** if it only tells what a player sees the moment they do the thing, or what no player would notice
either way. Such a clause is true, and it raises a question whose answer is boring.

- Goes: how an effect looks or sounds ("with a ta-da and confetti"), how fast a control works ("a coat at a pass"),
  what nobody would notice ("even where it covers another tag"), and a rare interaction the log or the Lens names
  when it happens ("a card your post's ward turns away never reaches it").
- Stays: how a state ends ("which lasts until they leave the page"), what is private ("Anyone who read it before
  remembers"), what a player plans around ("It never stops a card set face down"), and the accessible path's
  existence where a player needs it to choose a setting ("shown as a caption").
- Forgivable: a tip or a hint that points at a control. The board is never the same 1-1 twice.

## Numbers

A relative amount, such as "20% more than normal", is intuitive in the right way. Exact rounding, caps and
settlement adjustments are not player copy. They wait for the Advanced Strategy Guide (#1257). Where a sentence
needs the reason a number exists, it says the reason in plain words, with no unexplained term.

## What the test never cuts

CLAUDE.md's honesty rules stand over this one:
- The log names which Act did a thing, what it changed and how much Aura moved, in plain words.
- The glass never bluffs about how the game works.

Cutting a true detail is fine. Making a sentence untrue is not, and neither is cutting what a player needs to step
back and see the game.
