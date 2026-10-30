# Minus World's Strategy Guide

Record, written 2026-10-30. The text of Minus World's Strategy Guide (`minus.world/strategy.php`), from the Wayback
Machine's capture of January 14, 2025, which the owner saved as a web archive and supplied. Below it are the forum's
board list and themes from the same page, and what each mechanic suggests for Divided World. The guide is the rules as
Minus World stated them to its players. The spellbooks (`README.md` here) are the plans behind them.

## The guide, as written

The guide opens on a fake quote: "The only post of no value is one not submitted" — Abraham Lincoln.

**The Metagame.** "At the end of the day, this thing we call life is just a game. Minus World is like a game within a
game, a digital life nestled discretely within your real life. [...] If your real life had an EX bar, it would make
things much easier—on Minus World, that dream becomes a reality. You really can gauge your worth based on an arbitrary
number, and it's an exciting thing."

**Good Sh\*t.** Each post has a "Good Sh\*t" button, and posts take emoji reactions besides. Nobody can Good Sh\*t or react
to their own posts. A post climbs three **Sh\*t Levels**: Good Sh\*t (5 EX a click), Great Sh\*t from 5 clicks (10 EX),
Perfect Sh\*t from 10 (20 EX). "Once a post's Sh\*t Level is upgraded, it can never go back down, even if Good Sh\*ts are
taken away."

**EX** measures "how much you've contributed to the forum", gained by forum activity and spent on two things: casting
Spells on other users' posts, and donating EX to other users.

**Levels.** 20 levels, each needing exponentially more EX. "Levels are currently little more than epeen, but who knows
what the future holds…?" Spending EX can drop you back a level.

**Rally.** "Designed to keep Old Money players from having an unfair advantage": a multiplier on all incoming EX, 1.00
by default, raised for a while by casting Spells (more expensive Spells raise it more), at most 5.00. It decays on the
first minute of every hour, faster for a higher level and when more registered users are online. With fewer than two
people online it doesn't decay, and it never decays for banned users.

**The EX Legend** (before Rally):

| Action | EX |
|---|---|
| New post | 5 |
| New thread | 20 |
| New registration | 1500 |
| Per reply | 5 |
| Per referral | 300 |
| Get Good Sh\*t | 10 |
| Give a reaction | 1 |
| Get a reaction | 5 |
| Place in a competition's top 5 | 50 |
| Second place in a competition | 100 |
| Win a competition | 250 |
| Receive a Spell | 50% of its cost, no Rally applied |

**Spells.** "At Minus World, influence is your reward for contributing." Spells are cast from the Spellbook, a purple
star button on every post but your own.
- **Sweet**: "beneficial to the recipient [...] Usually used to express gratitude or appreciation."
- **Salty**: "serve to inconvenience or annoy the recipient in a controlled manner. They usually inhibit the affected
  post's readability and/or accessibility, with more expensive options having a more pronounced effect."
- **Pepperoni**: "context-dependent and must be used creatively in order to craft your desired reaction."
- Which Spells are available changes through Minus World's **Seasons**. The Spell Reference page lists all of them.

**Spell costs.** Up to 3 Spells can stack on one post, each Spell at most once per post. The recipient gains 50% of the
cost as **"knockback EXP"**: "the more EXP you spend messing with someone's posts, the more EXP they'll gain in turn." The
first Spell on a post costs its base price. After that, the cost is X × (Y + 1), where X is the base price and Y the
number of Spells already active. Sweet Spells always cost their base price. Some Spells are temporary, with an expiry
shown after casting; others are permanent.

**Boss Battles.** "Occasionally, a special event will occur in which a Boss appears and terrorizes the forum. The Boss
will relentlessly shitpost and cast unique Spells which will not expire until the Boss has been defeated." Users band
together with **Attack Spells**, which work only on Bosses: "Unlike Salty Spells, which are mildly annoying and all in
good fun, Attack Spells are vicious, cruel, and incredibly effective." They stack without limit, some can be used many
times by many members on the same post, and they never expire. A defeated Boss's profile redirects to a Boss Results
page of each user's damage. The top contributors get badges, and the Boss's Spells are removed.

**Items.** Found "scattered across Minus World": a treasure chest from a random event, or a Minus Ball "while scrolling
through a thread".
- **Items** (consumables) apply to one post or the whole account. For example, a can of **Respellent**, used from the
  Spellbook on your own post, keeps Spells away for a while.
- **Gear** is cosmetic: hats, accessories and memberbars, dragged onto your postbit, then rotated and scaled to fit.
- **Knick-Knacks** "appear useless at first...but they could come in handy when you least expect it."

It closes: "this is a new Minus World. We will be adding and tweaking features continually until we've created the
perfect game."

## The forum around it, on the same page

- **Boards.** Mayhem Whereabouts held the Feedback Forum and Resolved Issues/Suggestions, the PPP (that week,
  **Positive Pyromaniac Pandemic**), Entertainment Enterprise, and Arts and Crafts. Event Horizon held **Mario Plays the
  Killing Game Gacha and Dies**, Killing Game Grounds, **Recycling World** and **Anonymous World**. Other held The
  Archives, Gimmuseum Garrison, Cuckarooney's Vault and Smeg.
- **The Killing Game Mausoleum** archived every Killing Game, with numbered games and variants: 1, 2, 2.5, 3, 3.5, 4,
  4.2, 4.5, 5, Mall KG, 5.TOM, 6, 6.Masquerade, 6.Random, Kira Game Minus, 7, 7.Atua, 7.TOM, 7.Random, 8, 8.Ramsay,
  8.Random, KGVania and 9. There was a **Killing Game Wiki** (`wiki.minus.world`).
- **The menu** held Spells (My Active Spells, Spell Reference, Spell Settings), the Strategy Guide, and The Goods
  (`goods.minus.world`).
- **Themes:** Minus Blue 2.04, Diet Minus World, Christmas Presence, Positive World (Light), Beach Fun, Nightly Stroll,
  Halloween Spooktacular.
- **The tagline:** "Minus World is an interactive fighting game inspired by mid-2000s forum culture. Sign up and post
  some Good Sh\*t!"

## What it suggests

- **Rally is the six-orb cap's ancestor.** Both exist so Old Money can't dominate. Rally rewards spending, which keeps
  currency moving. Divided World's cap does it by making saved Aura useless past six orbs. A decaying spend-boost is an
  idea for the season review. Its decay reads how many users are online, which Divided World would compute from
  characters, never players ("A response never proves a private fact").
- **Knockback EXP was universal in Minus World and is a Jabroni trick in Divided World**
  (`docs/plans/2026-10-28-core-loop-design.md`, section 7).
- **Stacking pricing (X × (Y + 1), Sweet always at base)** is a ready answer for #33's cards: piling on costs more, and
  kindness never does. The three-Spell cap is the card interface's `stack`.
- **Sh\*t Levels that never go back down** are a post-level standing that ratchets, a possible postbit decoration.
- **Respellent is a ward.** Wards are open in the core-loop design. Respellent is the simplest version: a consumable
  that keeps cards off your own post for a while.
- **Boss Battles are the Mod Bots' ancestor, played the other way.** A Boss is a System-run character that shitposts
  and casts until the crowd beats it down with Attack cards, and the Boss Results page credits damage. It is a
  board-wide cooperative event (#34) with a clear way out: the Boss's spells end when it falls.
- **Items found while scrolling** (the Minus Ball) and **chests from random events** are how #35's drops reach a
  player.
- **Gear dragged, rotated and scaled on the postbit** settles how #35's gear is worn.
- **Boards:** "Positive Pyromaniac Pandemic" is one week's random P + P + P. "Mario Plays the Killing Game Gacha and
  Dies" shows the Killing Game had a gacha. Recycling World and Anonymous World are event boards whose names suggest
  mechanics.
- **The Killing Game's numbering (4.2, 5.TOM, 6.Masquerade, KGVania)** is a community's history kept as a canon, and the
  Mausoleum is the season reveal's ancestor.

## Not yet read

The Wayback Machine holds 24 captures of this page (May 2020 to April 2025), and links from it to the Spell Reference
(`minus.world/spells.php`), the Inventory (`minus.world/items.php`), the Killing Game Wiki and The Goods. From this
session's container `web.archive.org` did not answer, so the owner's saved archives are the way in. A full Minus World
export is the source most wanted.
