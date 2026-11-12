Record, written 2026-11-12.

# The earn cards' time and size, and how often a Random Event finds a card: design

Decided with the owner in conversation on 2026-11-12. The plan is `docs/plans/2026-11-12-earn-cards-balance-plan.md`.

## What changes

| Card | Was | Is |
|---|---|---|
| Heat Magnet | +10% from excited- and bored-negative reactions, 36 hours | +20%, 3 days |
| Publicity Tour | +10% from excited- and calm-positive reactions, 36 hours | +20%, 3 days |
| Hype-Up | Publicity Tour's numbers (one list, `publicity.ts`) | the same list, so +20%, 3 days |
| Class Clown | +50% from 😂 and 🙄, 36 hours | doubled (+100%), 3 days |

And Divided World's Random Event outcome weights go from line 70, gear 20, card 10 to line 70, gear 20, card 3.

## Why

**Three days, not 36 hours.** Settlement is daily, so 36 hours covers one full window and half of another, and which half
depends on the hour a card is played. Three days covers three windows, as Good Vibes does, and reads like the other
day-counted cards.

**The sizes.** Each class earns mostly from one quadrant (Face excited-positive, Heel excited-negative, Jabroni
bored-negative, Technician calm-positive), so a two-quadrant earn card lifts one class's main earning by its whole
`by`. At 10% the lift is too small to see in a log; 20% for three days is felt from an uncommon card. Class Clown names
one reaction in four of a quadrant (😂 among the excited-positive four, 🙄 among the bored-negative four), so with
reactions spread evenly its 50% was about 12.5% to a Face or a Jabroni. Doubled, it is about 25%: a little above the
other two, which its narrowness earns. It pays only if the crowd picks those two reactions, anyone who sees it up can
play along or refuse, and it points at two opposite classes, so it is the better bluff. "Doubled" also reads more
plainly than "100% higher", so the card's words say "doubled" for a `by` of exactly 1.

**Hype-Up follows.** Its numbers are Publicity Tour's by design (the card notes, Part 4), and it pays its caster nothing,
so a longer, larger push on another's mask is fine.

**Found cards.** The arithmetic this rests on, at a vote of 0.10 orb: a whole vote in a class's favored quadrant pays
0.10; a player's reactions on one Act share one vote; a further Act by the same character in a window halves; the
hostile quadrant subtracts. Guessing a typical reacting player's vote at 60% favored and 10% hostile, each is worth
about 0.05 net, so an orb is about 20 reacting players, or about 7 posts at 3 reactors each. A player posting 4 times a
day earns about 0.5 orb a day: about two bought cards a week, which the owner chose as the starting point. A Random
Event rolls on a board page load once per 15-minute window, up to 4 a day, and Divided World gives `none` no weight,
so an active player had 4 events a day, a card from 10% of them: about 2.8 found cards a week, more than they would buy,
in a hand with no cap. At a card weight of 3 a card is 3 in 93, about 3%: a little under one found card a week for a
player who hits all four events a day. Lines and gear keep their weights, so events stay as frequent.

## Weighed

- **Keeping 36 hours and only resizing.** The half window is the problem the owner raised.
- **Keeping +10% at three days.** Doubling the time doubles what the card pays, but the per-reaction lift stays too
  small to notice.
- **Class Clown at +50%.** About 12.5% evenly spread, below the other two after the raise, for the card that asks most of
  the crowd.
- **A `none` weight for Random Events.** It thins lines and gear too; the concern was cards alone.
- **Raising the vote now.** The owner noted many posts will draw fewer than three reactors, some none. That is a
  question for play data, not a guess: the vote is a setting, and the season review sets it from what the playtest
  measures (an issue, below).

## Open

- How many reactors a post draws in practice, and what an active player earns a week. Filed as an issue: the playtest
  measures it from the settlement ledger (#529).
- An admin view of posts that drew no reaction in a window, so a dead board shows early. Filed as #530.

## The rules

- **No player is ever stuck.** No state is added. Each card still ends by itself at its time or by an admin.
- **A response never proves a private fact.** Nothing new is computed; the boosts are applied inside settlement as now.
- **The layers.** Every change is instance content: the cards' rules, their words and Divided World's settings. The
  engine is untouched.
