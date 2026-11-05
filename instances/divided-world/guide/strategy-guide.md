<!--
  Divided World's Strategy Guide, in Gabe's voice (the developer persona, instances/divided-world/index.ts): true information, just sort of
  zazzed up. A DRAFT for the owner's review in the PR (docs/plans/2026-11-02-onboarding-plan.md, Task 8). It is the surface only: what a
  newcomer who is totally lost needs, and none of the deep mechanics that are fun to find and trade in threads (the design, section 8).

  Rules this file keeps, and tools/check-guide.mjs reads it for:
  - Every number is a {{setting:<path>}} marker, so the guide is true after every retune. Never type one, whether as digits or as a word.
  - The class list, the reaction grid, the welcome letter and the card table are markers the engine fills from the live instance.
  - It never claims more privacy than the game gives: other players cannot see these things, and it says "no other player".
  - No Markdown headings above the second level start a section; each second-level heading is a section and an anchor.
-->

## Welcome letter

<!-- kayfabb:letter -->

## The metagame

Divided World looks like a message board from 2003, and it is one. It's also a game, and every post on it is a move.

You are a **player**: one login, and up to {{setting:charactersPerPlayer}} **characters**, each one a mask. No other player can see which masks are yours. Every character has a secret **class**, a way of working the crowd that decides which reactions lift it and which ones wear it down (see [Classes](#classes)).

Almost everything anyone does here leaves a public record, called an **Act**: a post, an edit, a card, an announced Turn. You can react to an Act, and you can **spin a thread** from one, which starts a new thread with that Act shown in its origin box. Even an edit is an Act: the post keeps its history, and you get {{setting:editGrace}} to fix a typo before it says "Last edited."

Here's the part that surprises people: **nobody is paid for guessing anybody's class.** Working out who's behind a mask is a crowd sport, not a scoring event.

Along the bottom of every board page is your **HUD**: the character you're posting as, your orbs, and your hand of cards. The screens that aren't the board, like this guide, My log and Settings, are out of character, and they never bluff you. The board, and anything The System says on it, might.

Ready? [Make somebody.](/characters/new) When you want to know what changed lately, the [Updates](/updates) page is where the people who make the game say so.

## Reactions

Posts, and the cards played on them, take reactions. The picker lays them out like a map:

<!-- kayfabb:reactions -->

That map is the whole game. Every class is paid by some corners of it and hurt by others, so the same reaction can lift one character and sink another.

- You can leave up to {{setting:reactionCap}} reactions on a post, counted across all of your characters, not per mask.
- Your reactions on a post share one vote. Leave one and it carries the whole vote; leave more and they split it.
- Your characters can't react to each other's posts.
- The tallies are public. Who left them isn't shown to any player, and that includes the one who wrote the post.

## Aura

Aura is the score and the money, counted in **orbs**. It comes mostly from other players' reactions, read through your character's class (see [Classes](#classes)), and from reactions to the cards you play.

- Your **wallet** is shared by all of your characters, and no other player can see it. It holds up to {{setting:walletCap}} orbs. Aura that would land past that is gone, so spend before you're full.
- Each character also has a **standing**: the Aura it has earned this season. That one is public, you can't spend it, and it's what the rank beside the character's posts is made of.

### The settlement

Aura doesn't land the moment somebody reacts. It lands at the **settlement**. Settlements are {{setting:settlementLength}} apart. In between, your orbs show a hatched **ghost**: an estimate of where the reactions so far are taking you. Think of it as a forecast, and of the settlement as what actually happened. The first time you load the board after a settlement that moved your Aura, a summary opens by itself.

The forecast always says **up to**, because it can count reactions the settlement won't. It leaves out only your own reactions to your own characters, and it counts every other reaction as if anybody could have left it, while the settlement never pays a player for reacting to their own characters. It also skips the shared vote and the halving. The settlement is exact.

### Your log

**My log** is the honest record. It's grouped by settlement and lists every line that moved your Aura: which Act did it, which corner of the grid, and how much, in plain words. It never says who reacted. If you ever wonder whether something was done to you or just said to you, the log is the answer.

## Classes

Every character has one, and no other player can see it unless you reveal it. A class decides which corners of the reaction grid pay your character and which ones cost it. Reactions to a card you play count for you too, read through your class.

Pick the one that sounds like how you already post, or the one that sounds like a terrible idea. You can [Turn](#turns-and-reveals) later.

<!-- kayfabb:classes -->

## Turns and reveals

### Turns

A class isn't a life sentence. A character can **Turn** into a different class, and once a Turn has taken effect it has to wait {{setting:turnCooldown}} before it can Turn again.

- A Turn takes effect at the next settlement. Until then the character is still its old class, and you can change the Turn or withdraw it.
- A Turn can be **silent**, so nobody is told, or **announced**: The System posts that your character has Turned. An announced Turn can also name the class it Turned from, the class it Turned to, or both. Naming the new class reveals it.

### Reveals

Only you can make a character's class public, and only when you choose to.

A **reveal** is something your character posts, in a thread you pick, with a line of its own words. It carries a badge The System checked, so it's the real thing and not just a character *saying* what it is. A reveal can't be taken back, and it's dated: the badge says what the class was that day. Revealing doesn't earn or cost anything directly. The catch is that everybody can now play against a known class.

### New characters

A new character can drop right away, or debut at the next settlement.

## Cards

A post is a move. A card is a move on somebody else's move, or a boost for your own.

You buy cards at the **Vending Machine** with orbs from your wallet. They go into your **hand**, which all of your characters share. To play one, open your hand, arm a card, and pick where it lands: every place it can land lights up. Add a message if you like, and play it as your current character.

A played card is an Act of its own. It shows on the post as a **mark**. Press the mark to open the **Lens**, where anyone can read what the card is doing, react to it, and spin a thread from it.

<!-- kayfabb:cards -->

A plus after a price means that playing the card on a long post costs more; the Vending Machine tells you how much. Three words on every card are worth knowing:

- **Sweet, Salty, Pepperoni.** Sweet helps the post or character it lands on, Salty gets in its way, and Pepperoni depends entirely on context. At the settlement, a Pepperoni card turns out Sweet or Salty depending on how the room reacted to it. The room is everybody except whoever cast it and, for a card on a post, whoever wrote that post.
- **Cast, Use, Set.** To cast a card is to play it on a target, to use it is to play it on your own post, and to set it is to play it face down on your own post, where everyone sees the same card back.
- **Rarity.** Common, uncommon, rare or legendary. The rarer a card, the further it can reach beyond a single post.

## The masks

The board never tells anyone who is behind a mask, and nothing it shows can prove it. These are private from every other player: who owns which character, what class a character is, and who left which reaction.

What a character does in public is fair game, though, and the game doesn't hide it. Working out who's behind a mask from what it does, and when it does it, is part of playing. That's detective work, not proof.

The only way a class becomes public is you making it so, with a reveal, or with an announced Turn that names it.

## The System

The System is the machine that runs the board. It's arbitrary on purpose, and it isn't obliged to be fair. Some of its parts are still switched off while the game is young (see [Coming attractions](#coming-attractions)). What it says in character may bluff, flatter or mislead, so trust it about as far as you'd trust a stranger with a megaphone.

It has a board of its own. You can't post there, but you can spin a thread from anything it says.

What the glass says is different, and that's the deal. This guide, [My log](/log) and Settings are plain and true. If you want to know what actually happened to your characters, the log is where to look.

## Coming attractions

Not built yet, and subject to change:

- **Mod Bots**, The System's henchmen, who visit posts and file reports.
- **Rules and a warn bar**: rules that never stop you posting, but fill a bar that can end in a timed ban, with the way out stated plainly.
- **Reports and appeals.**
- **More cards.**

That's the game as it stands. It's a pre-alpha, and every number in here is today's, so this guide changes when the game does. The game may be unfair, but it will never be a trap: if you ever find yourself stuck with no way out, that's a bug, so [tell an admin](/contact).
