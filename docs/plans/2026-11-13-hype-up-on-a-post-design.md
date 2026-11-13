Record, written 2026-11-13.

# Hype-Up on a post: design

Decided with the owner in a design session on 2026-11-13. The plan is `docs/plans/2026-11-13-hype-up-on-a-post-plan.md`.
It revises Hype-Up as the card notes reworked it (`docs/plans/2026-11-11-card-notes-design.md`, "Hype-Up") and as the
earn cards' balance sized it (`docs/plans/2026-11-12-earn-cards-balance-design.md`).

## Why

Hype-Up and Publicity Tour were one effect that differed only in who could aim it: Publicity Tour on your own character,
Hype-Up on anyone's. The card notes said so themselves: "Played on one's own mask it is a Publicity Tour, which is no
gain." Two cards in the shop doing one thing is a card too many. The owner's proposal was to make Hype-Up act only on the
post it is cast on, and make it common. That gives the two cards separate jobs:

- **Publicity Tour** is a Gimmick you use on your own character. It lifts every post that character writes for 3 days.
  Unchanged, uncommon.
- **Hype-Up** is a Move cast on one post, anyone's: "this post deserves more." Common.

## What was decided

| | Was | Is |
|---|---|---|
| Reaches | a character (anyone's) | a post (anyone's) alone |
| Rarity | uncommon | common |
| Machine price | 1.50 orbs | 1.00 orb, the commons' price |
| Boost | +20% from excited- and calm-positive reactions | doubled, from the same two quadrants |
| Time | 3 days | 3 days |
| With Publicity Tour | the larger applies (group `publicity`) | the larger applies (group `publicity`) |
| Pays its caster | nothing | nothing |

**Doubled, at 1.00 orb.** By the 11-12 arithmetic an average post earns about 0.15 orb, and only reactions after the
cast are boosted, so doubling one post adds about 0.15 on average. Hype-Up is therefore a bet: it pays back a common
card only on a post that keeps drawing reactions, roughly seven or more reactors after it lands. Picking that post is
the skill. On another's post it is a gift whose value the giver cannot read.

Weighed:
- **Doubled at 0.20 orb** (Feelin' Fab's price). Near break-even on an average post and very profitable on a hot one,
  so a player hyping their own rising posts would make it the strongest money play in the shop.
- **+50% at 1.00 orb.** About 0.07 orb on an average post, which the 11-12 design already found too small to see in a
  log.

**3 days.** The same as the other earn cards: three settlement windows wherever the hour of the cast falls, and nearly
all of a post's reactions arrive inside it. Weighed:
- **1 day**, which half brings back the half-window problem the 11-12 change fixed.
- **As long as the post**, which needs a "never ends" earn the settlement does not have and gains little, since old
  posts rarely draw reactions.

**The larger applies with Publicity Tour.** Hype-Up keeps Publicity Tour's group, so a post carrying a Hype-Up whose
author has a Tour up earns double, not double and a fifth. The settlement already spans a group across a character's
play and a post's (`engine/rules/settle.ts`, the earn pass). Weighed: **letting them add**, which rewards the author
who hypes their own posts during their own Tour.

**The smaller decisions**, confirmed together:
- **One live Hype-Up per post.** A second is refused before it is spent ("this post already carries that card"); with
  the shared group it could add nothing. When the first ends, the post can take another.
- **Allowed on one's own post.** The card is the cost. A refusal there would differ with who owns the post.
- **Allowed on a Mod Bot's post, and it gives nothing**, because staff Acts are not settled; the card's words say so.
  A Mod Bot is still never offered Hype-Up (`staffOffers` refuses any cast card with a gimmick).
- **Card Collector and 4D Chess can name it.** Each names a Move cast on a post, which Hype-Up now is, so a Salty
  player can catch a hype.
- **Set face down, it lands on the quoting post**, no longer that post's character.
- **The megaphone art and mark stay.** The tagline becomes "Give a post a push."
- **It moves to the Booster's common share** by its rarity, as every card does, so it leaves the hit pull.

## What the engine gains

The engine allows "a cast card that reaches a post alone may carry an earn, and lasts". Today it allows an earn on a
cast card only when the card reaches a character alone, and a time up on a cast card on a post only for a skim
(Mooch). A cast earn on a character stays allowed: the engine stays general, and the export test holds one. The
settlement and the live estimate already boost an earn play on a post that has an end (`settle.ts`, the earn index;
`settlement_input` and `estimate_input`'s `earn_up`, 0316). What they lack is the play's `ends`, which `place_cast` and
`lay_sprung` write for a cast on a post only when it skims. Without it a play boosts nothing and holds its place on
the post forever.

The engine names no card. Hype-Up's numbers stay in the instance.

## Acts an instance already holds

No instance is deployed. On one that held a Hype-Up play on a character, that play keeps its reach and its `ends`
(both are on the Act), and the settlement keeps boosting that character until it ends. It would boost at the card's
numbers as the catalog holds them now, doubled, for at most 3 days. A Hype-Up already set face down springs onto the
quoting post. New casts on a character are refused once the catalog says post.

## Open

- **A card's numbers at the time of its play.** The settlement reads an earn's `by` from the catalog as it stands, not
  as it stood when the card was played. So every rebalance (the 11-12 change too) reprices plays already up. This is a
  separate concern from Hype-Up's reach, and the owner is asked whether it is wanted.
