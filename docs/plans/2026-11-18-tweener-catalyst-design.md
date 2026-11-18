Record, written 2026-11-18.

# Lit the fuse: the Tweener is paid for a debate its post sparked and it stayed out of: design

A design session with the owner. It adds a third way to earn to the Tweener of
`docs/plans/2026-11-07-tweener-design.md`. Its plan is `docs/plans/2026-11-18-tweener-catalyst-plan.md`.

## Why

The owner: "One of the mainstays of forum culture is a seemingly innocuous post from one person which turns out to act
as a catalyst for a lengthy debate between 2+ completely different people, with the original poster not even
participating beyond the initial spark. I wonder if there is a way to reward that somehow."

The Tweener's card already pays for setting another's post arguing (`tweener.stirredThePot`,
`instances/divided-world/classes/tweener.ts`). This is the same move made with a post. No class is paid today for what
others *write* under its post; the one rule that reads replies is the Lurker's spun thread, which pays the spinner
and never the origin's author.

## 1. What counts as the debate a post sparked

**Decided:** the quote chain, plus threads spun from the post. A post's debate is every post that quotes it, every
post that quotes one of those, and so on, together with the spin and the posts of each thread another player spun
from it. Quotes are recorded when a post is written (`quote_refs`, `supabase/migrations/0340_conduct.sql`), so the
chain is public and indexed.

Weighed: every post in the thread after it within a time (the owner's first wording), which pays the wrong post in a
flat thread, since every post in a busy thread is followed by posts and a calm one sitting before an unrelated
argument would collect for it; spun threads alone, which misses a debate that stays in its thread, the common case.

A thread spun from a post *inside* the debate, and not from the spark itself, is not followed. That was the session's
default, not a choice the owner was asked.

## 2. What makes it a debate

**Decided:** people who came back. At least three other players posted in the debate, and at least two of them posted
in it twice or more, all within three days of the spark. Returning to answer is the public sign of an argument, and it
roughly doubles what friends must type to fake one. The third voice keeps the result from singling out one pair of
characters (section 6).

Weighed: size alone (X posts from N players), which five one-word replies would meet; mutual quoting (two players who
each quoted the other), the strictest reading, which misses the many real arguments carried on without the quote
button.

## 3. Staying out

**Decided:** no posts in the debate until it pays. A post by the spark's author's player, through any of their
characters, anywhere in the debate before the moment it becomes one, voids that spark for good. Reactions and cards
are allowed: stirring with a card is already Tweener play, and the Lurker's rule draws the same line. Once it has
paid, the author may join, and nothing is taken back.

Two things follow from counting the player:

- A second mask of the author's player in the debate is the author taking part: it voids the spark and is never one of
  the other players.
- **A post inside the debate of an earlier post by the same player is never a spark.** Without this, a Tweener who
  argued for ten posts and then stopped would collect on their last word when the others carried on.

Weighed: no posts anywhere in the thread (it punishes answering a different conversation in a long thread); taking the
payment back when the author joins later (it locks a Tweener out of their own thread for as long as the debate runs).

## 4. What it pays

**Decided:** 0.20, flat, once for a spark, in the window its debate crosses the line of section 2. Where one
character's sparks pay more than once in a window, each further one pays half the one before (`settings.halving`), in
the order they crossed. Five baits in a day top out under 0.40.

Every number is an instance setting and a starting point for the season review: the amount, the three players, the two
who came back, and the three days.

Weighed: one paying spark per character per window (a second real debate the same day would pay nothing); pay scaled
by the debate's size (it pays more the more people type, and typing is the free thing to fake).

Defaults the owner accepted:

- **No reaction condition.** The spark need not have split the room's reactions. The debate alone qualifies it, and a
  split already pays through `tweener.splitTheRoom`.
- **Debaters earn nothing from this.**
- **The live estimate counts characters** where the settlement counts players, as a spun thread's repliers are
  counted, and knows only the caller's own characters as the author's.

## 5. Balance

- **Against the Tweener's own weakness.** An innocuous post tends to draw calm reactions, and each calm or bored vote
  costs a Tweener half a vote (`tweener.shrugged`). Four polite nods on the spark cost what the catalyst pays. So the
  perk is not free money on a bland post: it pays the post that reads as nothing and turns out to be something.
- **Against faking it.** Posts cost nothing, unlike cards, and are not held to one vote, unlike reactions. What holds
  this is the flat single payment, the two who must come back, the halving, and that the debaters are counted by
  player, so one friend's two masks are one voice.
- **The Lurker.** A Lurker who spins a thread from a Tweener's post is paid when it draws repliers, and the Tweener is
  paid as its origin. A pairing, and both numbers are 0.20.
- **Everyone else.** Unchanged. The pull on play is toward bait and toward not answering a direct question, which is
  the archetype.

## 6. The masks

- **What is read:** posts, quotes, spins and their times, which anyone can watch, and who owns the characters that
  wrote them, to count players. That count is The System's scoring, shown only as a settled sum, as a spun thread's
  repliers are.
- **What a settled sum can say.** Paid or not tells the spark's player whether the debaters were three players, and a
  watcher of the character's public standing can read the same in a quiet window. A spark that goes unpaid after a
  suspected second mask joined its debate is likewise a hint, among several other reasons it may be unpaid. Both are
  the reading the rule accepts of a settled sum. The threshold of three, never a pair, is chosen so that no result
  names two characters.
- **Live:** the estimate reads only the caller's own sparks, counts each other character as a voice of its own, and
  knows only the caller's own characters as the author's. A bystander's estimate reads nothing of this.
- **No response, event or timing is added.**

## 7. The layers

- **Engine:** how long a post's debate is followed (`debateDays`, a setting), the quote edges in the settlement's
  input, and for each of a character's posts whose debate moved in the window, the debate's posts as times and
  numbered voices that name no one. The engine names no class and no threshold.
- **Instance:** the Tweener's rule and its four numbers, the reason `tweener.litTheFuse`, and the log's and the
  Strategy Guide's words.

## 8. States and ways out

None is added. A voided spark is a payment that never happens; it holds no post, character or player in anything.

## Open

- Whether a thread spun from a post inside the debate should be followed (section 1).
- The numbers, which the season review has.
