<!--
  Divided World's Strategy Guide, in Gabe's voice (the developer persona, instances/divided-world/index.ts). The voice is
  instances/divided-world/voice/gabe.md: read it before changing a word here. Gabe explains the game in the first person, his jokes are made
  out of the facts, and nothing he says about how the game works is untrue. It is the surface only: what a newcomer who is totally lost
  needs, and none of the deep mechanics that are fun to find and trade in threads (docs/plans/2026-11-02-onboarding-design.md, section 8).

  Rules this file keeps, and tools/check-guide.mjs reads it for:
  - Every number is a {{setting:<path>}} marker, so the guide is true after every retune. Never type one, whether as digits or as a word.
  - The class list, the reaction grid, the welcome letter and the card table are markers the engine fills from the live instance.
  - What depends on the staff being switched on stands between the markers "kayfabb:if system-on" and "kayfabb:end", and what is true only
    while they are off between "kayfabb:if system-off" and "kayfabb:end". A second-level heading never stands inside either, and the words
    "not switched on" stand only inside a system-off passage.
  - It never claims more privacy than the game gives: other players cannot see these things, and it says "no other player".
  - It never says "The System". A player reads "the Boss", "the staff" and "the game".
  - "The actual rules" is real moderation and is written plainly, with no persona and no jokes.
  - No Markdown headings above the second level start a section; each second-level heading is a section and an anchor.
-->

## Welcome letter

<!-- kayfabb:letter -->

## The metagame

Divided World looks like a message board from 2003, and it is one. I had it built that way because 2003 is the last time I understood the internet. It's also a game, and every post on it is a move.

You are a **player**: one login, and up to {{setting:charactersPerPlayer}} **characters**. Each character is a mask, and no other player can see which masks are yours. Every character also has a secret **class**, a way of working the crowd that decides which reactions lift the character and which ones wear it down. [Classes](#classes) has the list.

Almost everything anyone does here leaves a public record. We call it an **Act**: a post, an edit, a card, an announced Turn. You can react to an Act, and you can **spin a thread** from one, which starts a new thread with that Act sitting in its origin box. Even an edit is an Act. The post keeps its history, and you get {{setting:editGrace}} to fix a typo before it says "Last edited." I asked for that window personally. I make a lot of typos.

Here's the part people don't believe: **nobody is paid for guessing anybody's class.** Working out who's behind a mask is a crowd sport. I looked into charging for it and was talked out of it.

Along the bottom of every board page is your **HUD**: the character you're posting as, your orbs, and your hand of cards.

One more thing, and it's the important one. This place has two halves. The **board** is the game, and anything said on it, by a character or by the staff, might be a bluff. The screens around it, like this guide, [My log](/log) and Settings, tell you how the game works and what was done to you, and they never bluff. I'll tell you some things about my yacht that you shouldn't repeat under oath, but I don't bluff about how the game works.

When you want to know what changed lately, [Updates](/updates) is where I say so.

## Your first character

[Go make somebody.](/characters/new) You'll give the character a name, a class and pronouns. You can change the pronouns later, under Edit profile on My characters. The class can change too, but that's a [Turn](#turns-and-reveals), and it comes with a wait.

The character is on the board the moment you make it, and nothing announces it. Make an entrance or don't. I've done both.

<!-- kayfabb:if system-on -->

The first thing it does in public puts it among the new faces in the next Roster Report, on [Staff Announcements](/b/announcements).

<!-- kayfabb:end -->

You start with no Aura. I'm not made of orbs. What you do get is a sealed **Starter Pack**, waiting in your hand. Open it. [Cards](#cards) explains what you're looking at.

## Reactions

Posts, and the cards played on them, take reactions. The picker lays them out like a map:

<!-- kayfabb:reactions -->

That map is the whole game. Most classes are paid by some corners of it and hurt by others, so the same reaction can lift one character and sink another. I'd love to tell you this was designed. The fellas at the lab drew four boxes on a whiteboard and I said "ship it."

- You can leave up to {{setting:reactionCap}} reactions on a post, counted across all of your characters, not per mask.
- Your reactions on a post share one vote. Leave one and it carries the whole vote; leave more and they split it.
- Your characters can't react to each other's posts. Yes, we thought of that.
- A reaction waits a few seconds before it's sent, and the tile shows the wait. Press it again in that time and it's undone, with nothing sent. After that it's in, so pick like you mean it.
- The tallies are public. Who left them isn't shown to any player, and that includes the one who wrote the post.

## Aura

Aura is the score and also the money, which I'm told is how the real economy works too. We count it in **orbs**. It comes mostly from other players' reactions, read through your character's class (see [Classes](#classes)), and from reactions to the cards you play.

- Your **wallet** is shared by all of your characters, and no other player can see inside it. It holds {{setting:walletCap}} orbs. Anything that would land past that is gone. I didn't take it. It just stops existing, which my lawyers say is different.
- Each character also has a **standing**: the Aura that character has earned this season. Standing is public, you can't spend it, and it's what the rank beside the character's posts is made of.

**Crowd pay.** Reacting pays too. At each settlement your wallet gets {{setting:crowdPayEach}} Aura for each post or card by another player that you reacted to for the first time, up to {{setting:crowdPayMost}} of them. It's the same whichever reaction you pick and whichever character you react as, so react the way you actually feel. Crowd pay goes to your wallet only. It never counts toward any character's standing, and no other player can see it. I am paying you to have opinions. You're welcome.

### The settlement

Aura doesn't land the moment somebody reacts. It lands at the **settlement**, and settlements are {{setting:settlementLength}} apart. In between, your orbs show a hatched **ghost**: an estimate of where the reactions so far are taking you. Think of the ghost as a forecast and the settlement as the weather. The first time you load the board after a settlement that scored you, a summary opens by itself.

The forecast always says **up to**, because it can count reactions the settlement won't. It counts every reaction as if anybody could have left it, while the settlement never pays a player for reacting to their own cards and characters. It also skips the shared vote and the halving. The settlement is exact. The forecast is me squinting.

A few cards pay their player a share of a vote at the settlement, whatever anybody's class, and never out of another player's Aura.

### Your log

[My log](/log) is the honest record, and it's the one thing here I'd swear to. It's grouped by settlement and lists every line that moved your Aura: which Act did it, which corner of the grid, and how much, in plain words. It never says who reacted. If you ever wonder whether something was done to you or just said to you, the log is the answer.

## Seasons

The game runs in **seasons**, and a season lasts {{setting:seasonLength}}. A character's standing is counted fresh each season, and the rank under its name climbs with it. When a season ends, the characters at the top of the rankings take the season's trophies, which stay on their pages.

[Season](/season) has the rankings and the season's news. It's the scoreboard. I check it from the yacht.

Your wallet is not seasonal. Orbs you haven't spent are still yours when a new season starts.

## Classes

Every character has one, and no other player can see it unless you make it public. A class decides which corners of the reaction grid pay your character and which ones cost it. Reactions to a card you play count for you too, read through your class.

Pick the one that sounds like how you already post, or the one that sounds like a terrible idea. Terrible ideas have worked out fine for me. You can [Turn](#turns-and-reveals) later.

<!-- kayfabb:classes -->

## Turns and reveals

### Turns

A class isn't a life sentence. A character can **Turn** into a different class, but after a Turn takes effect, that character waits {{setting:turnCooldown}} before Turning again.

- A Turn takes effect at the next settlement. Until then the old class still applies.
- A Turn can be **silent**, so nobody is told, or **announced**: your character posts it at once, in a thread you pick, and it can't be changed or withdrawn after that. So mean it. An announced Turn can also name the old class, the new class, or both. Whichever class it names is public from then on, as of its dates. A new class named that way counts as a reveal, badge and all, from the settlement the Turn takes effect.
- A silent Turn can be withdrawn before the settlement, or announced later, and from then it's as committed as any announced one.

### Reveals

A **reveal** is something your character posts, in a thread you pick, with a line in the character's own words. It carries a badge the game checked, so it's the real thing and not just a character *saying* what its class is. A reveal can't be taken back, and it's dated: the badge says what the class was that day. Revealing earns a little: while a reveal stands, what reactions pay that character counts for a bit more, until it Turns. The catch is that everybody can now play against a known class.

### How a class becomes public

There are exactly two ways, and you're holding both:

- a reveal;
- an announced Turn that names the class.

Nothing else does it. Not the staff, not another player, and not me.

## Cards

A post is a move. A card is a move on somebody else's move, or a boost for your own.

### Getting them

- **The Starter Pack.** Every player gets one, sealed, in their hand. Everyone's holds the same cards, so nobody starts ahead. This is the only fair thing in the game and I want credit for it.
- **The Booster.** A pack you buy at the [Vending Machine](/vending) with orbs from your wallet. It opens the moment you buy it. Most of it will be common. Some of it won't.
- **Single cards.** The Vending Machine also sells some cards one at a time. The rest say "Not on sale" in the table below, and a pack is how you get those. I'm told this is called "making the pulls special." I call it selling packs.

Everything you buy or open goes into your **hand**, which all of your characters share.

### Playing them

Open your hand, arm a card, and pick where it lands: every place it can land lights up. Add a message if you like, and play it as your current character.

A played card is an Act of its own. It shows on the post as a **mark**. Press the mark to open the **Lens**, where anyone can read what the card is doing and how it ends, react to it, and spin a thread from it.

<!-- kayfabb:cards -->

A plus after a price means the card can cost more depending on what you play it on. You're shown the full price before you commit.

<!-- kayfabb:if system-off -->

A few cards in that table talk about warn bars and Mod Bot visits. The staff aren't switched on here yet (see [The staff](#the-staff)), so for now those cards have nothing to act on. Hang on to them.

<!-- kayfabb:end -->

Three things printed on every card are worth knowing:

- **Sweet, Salty, Pepperoni.** A card's flavor says which side of the line the play is on. Sweet is babyface work, Salty is heel work: a Sweet Move helps, a Salty one gets in the way; a Sweet Reversal is a clean save, a Salty one a dirty counter; a Sweet Gimmick rewards clean play, a Salty one underhanded play. Pepperoni could go either way, and at the settlement the room decides which, by how it reacted. If the room can't decide, it stays Pepperoni. The room is everybody except whoever cast the card and, for a card on a post, whoever wrote that post.
- **Move, Reversal, Gimmick.** There are three kinds of card, and the frame shows which: a Move's is solid, a Reversal's is doubled with a folded corner, and a Gimmick's is dashed like a ticket.
  A **Move** is cast on a target. Many Moves can also be set face down on your own post, to spring on whoever quotes it; the card says if it can.
  A **Reversal** is only ever set face down on your own post, and springs once on something aimed at that post: a cast it names, or matches by flavor or rarity, or a Mod Bot's visit. Some Reversals catch the cast they spring on. Others let it land and do something else: pay their setter for the reactions it draws, hand the card back to whoever played it, or lock that player out of the thread for a while.
  A **Gimmick** is played face up on your own post, your own character, or a thread your own character started, and lasts a stated time.
- **Rarity.** Common, uncommon, rare or legendary. Rarer cards tend to do more, and to more than a single post.

A card set face down is a trap. To everyone else it's a card back, and every card back looks the same. A face-down card that hasn't sprung comes back to your hand whenever you take it back, and on its own when its time runs out. The only cost of a trap is that the card is tied up while it waits.

### Setting a Move face down

A Move set with no conditions springs on the first quote of your post, from anyone. That's the gamble, and sometimes it's the fun one. If you'd like to aim, add **conditions** when you set it. The Move springs only on a quote that meets all of them, and each is optional:

- **Says.** The quoting post's own words contain a phrase you type.
- **Quotes.** What the quote holds of your post contains a passage you pick from it. Highlight it in your post's text when you set the card, or type it.
- **Who.** **Anyone**, **Only these** or **Anyone but these**. The last two take a short list of characters. You can name any character you can search for, your own other masks included. A retired character can be named too, but it can't match while it's retired.

A phrase or passage is short, and the form tells you how short. A Reversal takes no conditions. A few cards, Autocorrect, THIS and Laugh Track among them, wait for the phrase you gave the card itself, so Says is filled in from it and can't be changed.

**How a phrase matches.** Says, the passage and the cards with a phrase of their own all use the same looser matching, so you only learn it once:

- Capital letters don't matter.
- Punctuation inside a word is ignored, so "dont" matches "don't".
- Between words, any spaces and punctuation are alike, so "nice try" matches "Nice... try!".
- Whole words only. "don" doesn't match inside "don't", and "nice try" doesn't match "nice-try".
- Punctuation at the very ends of your phrase is ignored, so "wow!" matches "wow".
- A phrase never matches across a line break, or across the edge of a quote, or through code, a link or an image.

**Highlight to quote.** Select words inside one post and press **Quote** beside the selection, and only those words are quoted. That's how you quote a passage on purpose. The old way still works, and it's the keyboard route: quote the whole post, then trim the quote in the reply box.

**What everyone sees.** Your conditions are yours alone, and no other player can read them while the card is set. When the card springs, the Lens shows what matched: the phrase, the passage, and who quoted if you used Only these. It never shows an Anyone but list, so nobody learns who you spared. A card nothing meets ends by itself when its time is up (the card's own words say when), so a trap that can no longer be sprung isn't a trap you're stuck in.

## The masks

The board never tells any player who is behind a mask, and nothing it shows can prove it. These are private from every other player: who owns which character, what class a character is, and who left which reaction.

What a character does in public is fair game, though, and the game doesn't hide it. Working out who's behind a mask from what the mask does, and when it does it, is part of playing. That's detective work, not proof. I've been publicly accused of being several people. I neither confirm nor deny.

Some cards hide a little more for a while, like who wrote a post or how its reactions are running. The Lens on the card says what's hidden and when it comes back.

## The staff

A forum needs moderators, and moderation is hard, so I gave the job to something cheaper than people. The staff here are **Personality Cores**: characters like yours, except a machine plays them, and their group bar says so. On the board they are in character. They can bluff, flatter and be wrong, and they often are. They can't see who is behind a mask any more than you can.

<!-- kayfabb:if system-off -->

They're built, and not switched on here yet. They're in a box by the server. When I plug them in, this section gets a lot longer, and you'll hear about it on [Updates](/updates). Until then there's no Boss, no Mod Bots, no rules to break, no warn bar, and nothing to report or appeal in the game.

<!-- kayfabb:end -->

<!-- kayfabb:if system-on -->

### The Boss

One Core is **the Boss**, and the Boss runs the board. The Boss makes moves: a rule, a demand, a favor, a punishment, sometimes a whole new board. Every move is announced on [Staff Announcements](/b/announcements), and each one that asks something of you says what it wants and when it ends. You can't post there, but you can spin a thread from anything the staff say, and you should.

The Boss isn't obliged to be fair. That's not a bug. I picked the Boss personally and I stand by it.

### Mod Bots

The other Cores are **Mod Bots**. They work for the Boss, they patrol the boards, and they visit posts to enforce the rules with total sincerity. Each one has its own beat, its own pet rules and its own weak spot. Finding the weak spot is your job. I'm not going to do everything around here.

### Rules and the warn bar

The Boss's rules never stop you from posting. Breaking one fills your character's **warn bar**, and a full bar can end in a ban for a stated time: that character can still read, but can't post, react or play cards until it ends. Your other characters carry on. The bar and the ban both say plainly how they end. Nothing a Core does deletes what you wrote: a post can be covered, stamped or scribbled on, and what's underneath is still there.

### Reports and appeals

A character can **report** a post to the Mod Bots, and can **appeal** a ruling against it. Both are moves in the game and both cost Aura, shown before you commit. These are game reports, for breaking the Boss's rules. A real problem with a real person goes to a human instead: see [The actual rules](#the-actual-rules).

### Groups and punishments

The staff can move a character into a group for a while: the Boss as a favor or a punishment, a Mod Bot as a punishment only. A punishment can bar a character from posting on a board until it ends. The fastest way out is a public apology, read by whoever put you there, and you can appeal too. Your log always says what happened and when it ends.

### Who's actually in charge

Humans are. An admin can reverse anything a Core does, and the moves that reshape a board are shown to the admins before they land. The Cores don't know this. Please don't tell them.

<!-- kayfabb:end -->

Every character also wears a **group bar**, staff or no staff. Most climb on their own: post enough and you're a Regular, and last through enough seasons and you're Old Guard.

## Things that happen to you

- **[Alerts](/alerts)** is the list of what happened to your characters while you were away: a quote, a card on your post, a trap that sprang, a settlement. Every kind waits here either way; Settings decides which kinds also pop up while you read.
- **Random Events.** Now and then, loading a page opens a small window that says SOMETHING HAPPENED! Sometimes it's just a line. Sometimes you've found a piece of gear, or once in a while a card. Only you see it. No Aura moves, and there's nothing to click in time. It's a gift. Don't read into it.
- **Gear and the [Wardrobe](/wardrobe).** Gear is cosmetic: something a character wears over its portrait. Any of your characters can wear what you've found. Yes, there are hats. I have a reputation to maintain.

## The actual rules

This section is not a bit.

Divided World has a [code of conduct](/conduct), and it applies to people, not characters. Playing a villain is the game. Harassing a person is not, and no class, card or character makes it one.

If something on the board is a real problem, report it to the admins: use the report control on the post, or [contact an admin](/contact). That report goes to a human, costs nothing, and has nothing to do with the game's score. The staff characters never see it.

New players join by invite. You have {{setting:invitesPerPlayer}} to give, each good for {{setting:inviteLifetime}}, on your [account page](/settings?section=account).

The game may be unfair, but it's never supposed to be a trap. If you find yourself stuck with no way out, that's a bug: [tell an admin](/contact).

## Coming attractions

Still to come, and subject to change:

- **More cards.** There are always more cards.
- **More Cores.** I have a whole pile of them.

That's the game as it stands. It's a pre-alpha, and every number in here is today's, so this guide changes when the game does. If it and the game ever disagree, the game is right and I'd like to hear about it.

Have fun,
Gabe
