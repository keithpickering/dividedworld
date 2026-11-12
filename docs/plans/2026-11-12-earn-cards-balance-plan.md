Record, written 2026-11-12.

# The earn cards' time and size, and how often a Random Event finds a card: plan

Carries out `docs/plans/2026-11-12-earn-cards-balance-design.md`. Instance content only; the engine is not touched.
The card art prints no numbers, and every card's words read their span and amount from the card's own rules
(`spanWords`, `earnBy` in `instances/divided-world/ui/cards.ts`), so the words follow the rules once Task 2 teaches
them "doubled".

## Task 1: the cards' numbers

Model: inline

Tests first, red before the change (`instances/divided-world/cards/cards.test.ts`, the test "Publicity Tour, Heat
Magnet, Class Clown and Good Vibes are Gimmicks with the effects the design names"): replace `hours36` with
`days3 = { unit: 'day', count: 3 }`, and expect `by: 0.2` for Publicity Tour and Heat Magnet and `by: 1` for Class
Clown. Add Hype-Up: `[['character'], days3, { kind: 'earn', quadrants: ['excitedPositive', 'calmPositive'], by: 0.2,
group: 'publicity' }]`.

Then:
- `instances/divided-world/cards/publicity.ts`: `PUBLICITY.by` 0.2; `PUBLICITY_LASTS` `{ unit: 'day', count: 3 }`.
- `instances/divided-world/cards/heat-magnet.ts`: `by: 0.2`, `lasts: { unit: 'day', count: 3 }`.
- `instances/divided-world/cards/class-clown.ts`: `by: 1`, `lasts: { unit: 'day', count: 3 }`.
- The header comments of `heat-magnet.ts`, `class-clown.ts`, `publicity-tour.ts` and `hype-up.ts` say "for 3 days" and
  the new amounts ("counts 0.2 more"; Class Clown "counts double").

## Task 2: the cards' words

Model: inline

Tests first, red before the change (`instances/divided-world/ui/index.test.tsx`):
- In "each new Gimmick reads its span and its amount from its own rules": Publicity Tour, Heat Magnet and Hype-Up match
  `/3 days[\s\S]*earns from[\s\S]*20% higher/u`; Class Clown matches `/3 days[\s\S]*earns from[\s\S]*is doubled/u` and
  does not contain `100%`.
- Hype-Up's summary is `'Cast on a character. For 3 days, what it earns from positive reactions is 20% higher. A loss
  is never made worse.'` and its `logPlay` is `'What that character earns from positive reactions is 20% higher until
  it ends.'`
- Keep the `spanWords` test's `36 hours` line: it tests counting hours, not a card.

Then, in `instances/divided-world/ui/cards.ts`, replace `earnBy` with `earnWords`, which returns the whole predicate:
`'doubled'` when `by` is exactly 1, otherwise `` `${Math.round(by * 100)}% higher` ``. Each earn card's `summary`,
`describe` and `logPlay` says `is ${earnWords(card)}` where it said `is ${earnBy(card)} higher`. Class Clown then
reads "what it earns from 😂 and 🙄 is doubled".

## Task 3: found cards

Model: inline

Test first, red before the change (`instances/divided-world/settings.test.ts`): Divided World's
`defaults.cosmetics.events.outcomes` deep-equals `{ line: 70, gear: 20, card: 3 }`.

Then `instances/divided-world/settings.ts`: `outcomes: { line: 70, gear: 20, card: 3 }`, and the comment above
`cosmetics` says a found card is "rare" (about one event in thirty). The engine's tests and the SQL tests carry their
own fixtures with `card: 10` and are left as they are: they test the shape, not Divided World's numbers.

## Done

`npm run typecheck` and `npm run build:ci` green, with the output in the PR.

## Review focus

- A play of one of these cards already in a database keeps the `ends` stamped when it was played (36 hours); only new
  plays take three days. No instance is deployed, so none should exist; confirm nothing recomputes `ends` from the
  card's current `lasts`.
- Earn groups: Hype-Up and Publicity Tour still share `group: 'publicity'`, so both up on one character apply 20%, not
  40%.
- `earnWords` says "doubled" only at exactly 1; a `by` of 0.995 or 1.5 must still read as a percentage.
