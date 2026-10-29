# A class revealed by choice

Record, written 2026-10-29. A design session with the owner on #14, which the clues design
(`docs/plans/2026-10-29-clues-design.md`, Open) left for a session of its own. Each question was put to the owner one at
a time, with alternatives and a recommendation. The plan is `docs/plans/2026-10-29-class-reveal-plan.md`.

The owner, opening it: "Maybe it's always a player's choice whether to reveal the class, and when. Heel and Jabroni are
currently the only ones where a 'forced reveal' would really be dramatic, and it's not fair to only put those classes
into that position of potential exposure unless there is something to nerf the others in an equal way. In any case I
think there's value to the reveal: the granularity in how the player wants to present their character, and in how other
players will interpret that presentation vs the displayed behavior, adds interesting strategic depth."

## 1. Only the player reveals a class, whenever they choose

**Decided** (the owner's opening): nothing forces a class into the open, neither a card, The System nor the season's
end. A forced reveal would fall unequally on the classes, since exposing a Heel or a Jabroni costs far more than
exposing a Face, and nothing in the design balances that.

**The rule gains a sentence** (CLAUDE.md, "A response never proves a private fact"): "A player may make one of their
own private facts public: a character's class, by a reveal or a Turn announced with its old class. From then that fact,
as of its date, is public, and nothing else about it is." A Turn announced with its old class already did this without
the rule saying so. Weighed: leaving the rule as it is (a later session reading it could block reveals).

## 2. A reveal is the character's own Act

**Decided:** a reveal is an Act the character makes at once, in a thread its player chooses, on its own or with a line
of the character's own words (plain text, up to 200 characters, as a card's message). It carries the class The System
checked when the Act was made. That check is the one thing a claim in an ordinary post cannot carry, so a "verified"
reveal and a character that merely says what it is are different moves. A reveal can be reacted to and spun like any
Act, and the reactions are scored as on any other Act (section 4).

Creation and Turns gain the same choice through the tally:

- **Creating a character:** announced *with its class*, beside silent and announced (the clues design, section 4), for
  a drop or a scheduled debut alike.
- **A Turn:** an announced Turn may name the class it Turns *to*, the class it Turns *from* (today's "revealed"), or
  both.

Only the class a character holds when the reveal is made can be revealed by a reveal Act; a class it held before is
revealed only by a Turn announced with its old class, as today. A character waiting to debut cannot act, so its class is
revealed through its debut's announcement. A reveal made while a Turn is pending names the class held then, which is
true on its date.

Weighed: only through the tally (no in-thread moment; The System, not the character, would say it); a profile setting
with no Act (nobody watching a thread would see it happen).

## 3. A reveal is a dated fact

**Decided:** a reveal states what was true on its date: "Revealed: Heel (Oct 3)". A silent Turn afterwards stays silent,
and the badge does not change, because it was true and still is as a statement about Oct 3. What happened since is for
the other players to read from the character's behavior. An announced Turn after a reveal shows "Has Turned since (Oct
20)", because the tally said so; a Turn announced with its new class is a new reveal, and the badge shows that one.

The postbit and the profile show the character's latest public statement of its class: its latest reveal (an Act, a
debut announced with its class, or a Turn announced with its new class), and, if a later announced Turn came after it,
that it has Turned since. The profile's public record lists every reveal.

Weighed: a badge showing the current class until the next Turn (a silent Turn after a reveal would show, so it could
not be silent); a live badge with silent Turns barred after a reveal (commits the player, at the cost of a choice the
game already gives).

## 4. Presentation only

**Decided:** no class rule reads whether a class was revealed. The cost of revealing is that others can play against a
known class: shrug at the Heel, cheer the Jabroni. The gain is the story. The reveal Act itself is an Act like a post or
a card: reactions to it are scored by the revealing character's class as on any of its Acts, it counts in the halving,
and it is no post for the Lurker's limit (a reveal is not a post). A bonus for revealing, or for staying hidden, can come
with the season review.

Weighed: a bonus while revealed (revealing would become the default for anyone chasing standing); a bonus for staying
hidden (every reveal a sacrifice).

## 5. Secrets roll over at the season's end

**Decided:** the season's reveal no longer shows every character's classes. It still posts each character in order of
final standing, with its place, rank and standing, as The System's big moment, and with what its player made public in
the season: its reveals and its announced Turns, an old class where the Turn named it. Unrevealed classes and silent
Turns stay secret into the next season. A player can reveal at the finale like at any other time. The owner, on #14:
"whether the secret should be allowed to roll over, with 'how did that person get so much aura by being such an ass?'
being a clue instead of a stated fact."

A season revealed before this change keeps its Acts as they were written ("Append-only").

Weighed: the finale as planned, every class and silent Turn (secrets last one season at most); each player choosing per
character before the last settlement (much the same as rolling over, since a player can reveal at any time, with more
screens).

## 6. The words, and the layers

The season's existing Acts are of kind `reveal`; a character's reveal is a new kind, `unmask`, so the two never share a
name in code. What a player reads (the button, the badge, the tally's wording) is the instance's to name. The engine
stores a reveal's class key and the character's message; how each class's badge looks is instance content, as each
class's look on the reveal's timeline already is.

## 7. What stays private

- `class_history` stays private; nothing reads a class for anyone but the character's own player except at that
  player's request, and then only the class held at that moment.
- A reveal's refusal (a character that is not the caller's, one waiting to debut, one retired) is only ever seen by
  the player who asked, who knows what they asked about.
- The season's reveal names no class its player did not make public.

## Open

- A revealed-class rule for a class, or a bonus either way (section 4), for the season review.
- Whether a card could ever claim to reveal a class falsely, in character ("The fiction may lie"), as long as the log
  and the checked badge never do. Not designed; a card that did must never carry the checked badge.
