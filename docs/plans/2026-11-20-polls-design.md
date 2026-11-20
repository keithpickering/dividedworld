# Polls: design

Record, written 2026-11-20. A design session with the owner, who opened it: "traditionally a forum will let you attach
one to the top of a thread; we may as well allow them in single posts. Our act structure makes voting a character Act,
and the poll itself (and its results, if it has ended) could be spinnable into new threads, allowing voting and viewing
to have greater reach." Each question below was asked one at a time and answered by the owner. Where a section says a
choice was made in planning, it is the session's own. The owner confirmed the summary before the plan was written. The
plan is `docs/plans/2026-11-20-polls-plan.md`. The mockup is `docs/research/2026-11-20-polls/01-placement.html`.

**A word.** "Vote" already names a reaction's weight in settlement (`engine/rules/votes.ts`). In code and in this
design, what a character casts in a poll is a **ballot**. The button a player presses still says Vote.

## 1. Who sees a ballot (Q1)

**Decided: the poll's author chooses** public or secret ballots when making the poll.

- **Public ballots.** Each ballot is a public Act by its character. Each option lists the masks that picked it, and a
  change of ballot is visible.
- **Secret ballots.** Each ballot is still an Act, so it is append-only, in its own player's log and in the export.
  The public projection withholds its character, and only the tally is public: how many characters picked each option.

Weighed:
- Public always: ballots as clues, one path to build. Turned down by the owner for the playstyles a secret poll serves.
- Secret always, like reactions (a private table, no Act). It loses the Act the owner asked for.

## 2. One ballot per character (Q2)

**Decided: every character may cast one ballot on a poll, always**, after the owner weighed a per-player cap and its
patterns. A cap counted per player would break "A response never proves a private fact" either way:

- On a secret poll, the tally would be a count of players where it could count characters. Three characters in a
  debate, two of them one player's, all voting: a final tally of 2 proves two of them share an owner.
- On a public poll, the cap is a quota shared across a player's masks that others can watch: a mask that never votes
  beside one that did is the quota showing.

Counting characters breaks neither, and it fits the fiction: on the board each mask is a poster, and a forum poll
counts posters. Stuffing a poll with your own masks, splitting them to throw others off, or keeping one out are all
things the masks do in public: clues the game gives, not leaks.

Weighed: one per player (the owner's omission example); the author choosing per poll. If the owner ever wants a
per-player option, it is asked under "A rule that fights the product", not designed around.

## 3. A ballot can change until the poll closes (Q3)

**Decided.** A change is a new ballot Act by the same character. A poll counts each character's latest ballot alone.
Nothing is edited. On a public poll a change shows as a change ("Wario switched from Pipe Frame to Badwagon").

**Decided in planning:** a ballot with no picks withdraws the character's ballot, under the same rule, until close.

Weighed: final once cast (a misclick would stand for the poll's life); the author choosing.

## 4. How a poll ends, and its results (Q4)

**Decided.** The author sets a closing time when making the poll. It is required, so a poll can never sit open forever,
and it is bounded by the instance's settings (one hour to fourteen days in Divided World). The author may close the
poll early, and an admin may close any poll. Each early close is an Act. Results are live, for every reader, the
whole time. A closed poll shows its final results and takes no ballot.

Weighed: counts sealed until close (suspense, but nothing to argue about while it runs); the author choosing.

## 5. Choosing more than one (Q5)

**Decided.** The author sets how many options a ballot may pick: one by default, up to all of them, as phpBB did. A
ballot holds its set of picks, and the tally counts picks per option, beside the number of characters whose ballots
count.

## 6. Editing a poll (Q6)

**Decided: until the first ballot.** While no ballot has been cast on a poll, an edit of its post may change the
question, the options and the settings, or remove the poll. An edit may also add a poll to a post that has none. From
the first ballot on, an edit changes only the post's words, and the poll can only be closed. Every version stays as its
own Act.

Weighed: never editable (a typo stands); editable always, with ballots kept (a ballot for "Yes" could come to count for
something else).

## 7. Spinning (Q7)

**Decided: the poll is its own origin.**

- A poll has its own Spin, in its foot. The spun thread's ORIGIN box shows the poll live: a reader can vote there
  while it is open, and once it closes the box shows its final results. Its head reads "Spun from the poll “Best kart
  in the series?” on #12 in Title".
- A public ballot can be spun: "Spun from Wario's ballot in the poll “…” on #12 in Title". The box shows the poll
  with that ballot named. **Decided in planning:** a secret ballot cannot be spun, since the spin's head would have no
  one to name. The Spin is offered only where it can be made, and the server refuses it in one sentence.
- A spin of the post still shows the whole post, its poll included, live and votable.

Weighed: the post's spin alone (its head could not say the thread is about the poll); a poll spin with no ballot spins.

## 8. The game (Q8)

**Decided: a plain board feature first.**

- Ballots pay no Aura and cost nothing.
- A poll and its ballots are not reacted to: reactions go to the post.
- A poll, a ballot and a close are not in a settlement's Acts.
- The poll is part of its post. An effect on the post covers the poll as it covers the words.
- The System may read polls as part of the state of play: its digest gains each excerpted post's poll and counts.
- Cards that act on a poll or a ballot (rigging, a recount) are left to a later card design.

Weighed: ballots feeding settlement (a new source of Aura, overlapping reactions); designing poll cards now (scope).

## 9. Where it sits (Q9)

**Decided: under the words** (option A in the mockup). The poll is drawn in the post's content area, after the words
and before the last-edited line, the reactions and the signature, the same in every post, the first included, and the
same in an ORIGIN box.

Weighed:
- B, over the words. The poll leads, and the words become its commentary.
- C, a thread's poll in a phpBB panel above the first post. Two looks, and an effect on the first post would not reach
  its own poll.

**The world.** The board, in its house style: a 2003 poll table in the post's ink, black and white, the options in
rows
with a mono count and percentage and a bar, a gray button, the masks under each option on a public poll, and the
settings and the closing time in the head in Courier. No color: a poll is a board's piece, not the game's.

**The effect rule.** An effect on the post fills the content area border to border, the poll inside it. The poll is
marked as the reactions are (`data-kb-over-ink`), so an ink effect paints under it and starts nothing on a press
inside it. Its controls stay pressable or are plainly covered.

## 10. The masks

- A secret ballot's character is withheld by the one projection every read goes through (`acts_public`), for every
  reader alike. Only its player's own reads (`my_ballots`, the log) name it.
- Every count counts characters. Nothing counts players.
- A refusal of a ballot reads public facts: the poll's state, the picks' shape, whether the caller plays the character.
- A live event for a secret ballot carries the poll's counts and no character. Its timing does not depend on who
  casts it.
- A public ballot is its mask's public act, like a post: who voted for what, and when, is play.

## 11. Ways out

- **An open poll** closes by itself at its time, or by its author or an admin.
- **A ballot** changes or is withdrawn by its character until close.
- **A closed poll** is a final state that takes nothing from anyone: its post and its words go on as before.
- **A poll that cannot be edited** after its first ballot can still be closed, and its post's words edited.

No player, character or post is stuck.

## 12. Layers

All engine. An instance gives only its settings' numbers (the most options, the bounds of a closing time, the
lengths). Divided World's `settings.ts` sets them.

## 13. Open

- Cards that act on polls or ballots.
- A board's thread list marking a thread whose first post holds a poll, phpBB's "[ Poll ]". Not taken up.
- Search over a poll's question and options. Not taken up.
- Whether the welcome page or the Strategy Guide mention polls: owner-approved copy, for its own change.
- Whether a Mod Bot may cast a ballot. Not in this design: staff write no ballot.
