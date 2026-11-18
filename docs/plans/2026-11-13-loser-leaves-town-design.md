# Loser Leaves Town: a card that bonds two characters, and bans the one that earns less: design

Record, written 2026-11-13. A design session with the owner, begun on 2026-11-12: "What if we did a card that was like
destiny bond for getting a Ban? Pick a player, whoever gets less aura in 24 hours is banned? An ingame ban of course."
The plan is `docs/plans/2026-11-13-loser-leaves-town-plan.md`.

It stands on the Mod Bots design (`docs/plans/2026-11-06-mod-bots-design.md`, section 5: the warn bar, timed bans,
"Bans are per character"), The System's design (`docs/plans/2026-10-30-the-system-design.md`, section 10), the card
types design (`docs/plans/2026-11-11-card-types-design.md`: a Move), the core loop
(`docs/plans/2026-10-28-core-loop-design.md`: a public season standing per character, settled on a schedule) and Off Day
as card notes Part 6 built it (`docs/plans/2026-11-11-card-notes-part-6-plan.md`: a play that names the one settlement
window after the next settlement).

## 1. The card

**Decided.** Loser Leaves Town is a Salty Move on a character, legendary. The character that plays it and the
character it lands on are bonded for one settlement window. At the settlement that closes the window, whichever of the
two settled lower is banned. The name is the wrestling stipulation: two wrestlers fight and the loser leaves the
territory, for a while.

Weighed for the name: Ban Bet (plain, with no joke in it), Pistols at Dawn (nothing to do with forums or wrestling).
"Destiny Bond" is another game's name for its own move and is not used.

What the owner's idea became, read against the designs it stands on:

- **A character, never a player.** Bans are per character and who owns a character is private, so it is one mask
  against another.
- **A settlement window, not a rolling 24 hours.** A character's Aura becomes public only when The System settles
  (daily by default). A comparison made mid-window would be computed from who reacted. So the bond covers the first
  full window after the play, as Off Day does: played at noon, it starts at that night's settlement and is decided at
  the next one. Both characters see it coming.
- **What is compared** is each character's whole settled sum for that window: every ledger entry the settlement writes
  for it, which is exactly the amount its public season standing moves by. Anyone can check the result from two public
  numbers. A character with no entry settled at zero.
- **No Aura changes hands**, so the rule that no card moves money between players holds.

## 2. The target has no say

**Decided** (the owner chose the recommendation). The target is bonded the moment the card lands. The caster carries
exactly the same risk, which is what makes it a shared fate and not an attack. The target's counter is the day itself:
post well, or rally the room.

Weighed: a challenge the target can duck at a public price, such as a shame title (softer, and a pending state to
build); mutual only (most challenges would be ignored).

## 3. The ban

**Decided** (the owner chose the recommendation): a fixed ban, 3 days by default, **off the ladder**.

- Both sides risk the same thing. The length is the card's own number, set by the instance in the card's rules, as a
  card's share or price is.
- The loser's warn bar is untouched and the season's ladder does not count it: the next full bar brings the ban it
  would have brought anyway.
- So a card can never be what permabans a character. That matters because a permaban goes to admins a day before it
  lands, and a card lands at once.
- It is a ban like any other in what it stops (posting, reacting, playing cards) and in how it reads: BANNED on the
  postbit, and the same refusal words.
- **Two bans at once overlap; they do not add up.** If a Mod Bot bans a bonded character partway through the window, the
  bond stands and its earlier posts keep earning. If it then loses, the later end date holds.

Weighed: the loser's own next rung, on the ladder (lopsided stakes, and it needs a carve-out so the card never delivers
the permaban); a fixed ban that also counts as a rung (the same carve-out). One day was weighed as too cheap for a
legendary when the player can switch masks, and seven as too much for one bad day.

## 4. A tie bans both

**Decided** (the owner chose the recommendation). Ties will happen, most often at zero when neither character does
anything. Both are banned. Hiding is therefore no counter, and a caster can force a double ban on a silent target by
earning nothing. The target avoids that by earning anything at all.

Weighed: nobody is banned (makes "both do nothing" the safe play, and a legendary fizzles); the caster is banned
(punishes the caster harder than the target for the same result).

## 5. Raw Aura, and a rest after each bond

**Decided** (the owner chose 1). Whoever settles lower loses, with no handicap. A character that was in a bond, on
either side, cannot be in another for 7 days after its window closes (the card's own number, as the ban's length is).
A character is in at most one bond at a time.

A strong earner can pick on a quiet character. What bounds that: nothing is a sure thing, because the room can pile on
and nobody knows which reactions help or hurt a hidden class; the bond is public, and picking on a quiet character is
Salty conduct the board can answer; the rest caps how often any character is dragged in; and losing costs 3 days on
one character while its player carries on with another.

Weighed: punch up only, by public season standing (the season leader could never play it, and two close rivals could
only bond one way); each against its own recent average (hard to read at a glance, and a character can sandbag for a
week to lower its bar).

## 6. The edges

**Decided** (the owner confirmed the section as put).

**When it can be played**

- A character cannot bond itself. A banned character cannot play it, as it can play no card, and an already banned
  character cannot be targeted. A staff character can be neither side: a Mod Bot's Acts are not settled, so it earns no
  Aura, and the pool never offers a persona this card.
- Bonding one of your own characters is allowed and never checked, because checking would read who owns what. It bans
  one of your own characters.
- It is refused where Off Day is: in a season's first window, where the next settlement's time is not yet known, and
  where the season ends at the next settlement, since there is then no window to name truthfully.
- A retired character is treated like any other. Retirement is hidden today, so a refusal or an early end would reveal
  it. The bond settles as usual, so a caster who targets a dead character and earns nothing ties and is banned too.
- Every refusal reads only public facts: the two characters' bans, their bonds and when The System settles.

**What everyone sees**

- From the play until the window closes, both postbits carry the card's mark, and its Lens names the opponent and both
  settlements' times.
- At the settlement the loser's postbit shows BANNED. The ban is a public Act that names the play it came from, so the
  thread and the record say which card, against whom, and both settled sums.
- Each bonded character's own log says in plain words which play it was, both settled numbers, who was banned, until
  when, and how the ban ends.

**Other cards**

- Off Day can be played on a bonded character. It changes how that character scores in the window, which is a strong
  combination that the rest bounds.

## 7. Ways out

| State | How it ends |
|---|---|
| Bonded, before the window closes | By itself at the settlement that closes the window, at a time the play states. An admin's end of the play before then: nothing is compared, nobody is banned, and neither character owes a rest. |
| Resting after a bond | By itself, 7 days after the window closed, at a time each refusal states. |
| Banned by the card | By itself after 3 days, at a time the ban and the log state. An appeal to the Boss, once, for the price any appeal has: overturned ends it at once and refunds, reduced halves it, increased runs it half as long again, upheld changes nothing. |
| A refused play | Nothing is written; the card stays in the hand and the refusal says what is in the way. |

**Corrected from what the owner was shown.** The section the owner confirmed listed "the Unban card and an admin's
reversal" among the ban's exits. Neither exists today: an admin's reversal of a ban is issue #315, open, and the
Unban (Ultra Happy Heart, card notes Part 5) is not built. A timed ban's exits today are its clock and its appeal, and
this card's ban has both. The ban Act this design writes is shaped so that each of those two, when it is built, reads
it as it reads any ban; the plan has the build say so on #315.

**An appeal of a result anyone can check.** The Boss may overturn a loss that two public numbers prove. That is
kept on purpose: The System's arbitrariness is the game, the finish a promoter reverses after the bell is the oldest
one in wrestling, and it costs the appellant Aura. An overturned ban does not ban the winner.

## 8. The masks

- **The cast.** Its refusals read bans, bonds and settlement times, all public and the same for every caster. Nothing
  reads who owns either character.
- **The result** is computed inside the settlement from the two characters' settled sums, which are exactly what their
  public standings move by. This is the rule's one exception (The System's own scoring, shown as settled sums) and
  shows nothing a reader could not already subtract. A very quiet window's sum can still be read; that was accepted
  when the standing was made public.
- **Nothing live.** No mid-window lead, estimate or "who is ahead" is shown to anyone. A player's own live estimate is
  theirs alone, as today, and says nothing about the opponent.
- **Own characters.** A bond between two of one player's characters lands, shows, settles and bans exactly as any
  other.
- **Retirement** changes no response.

## 9. The layers

The engine gains one neutral piece, a **duel**: a cast card that reaches a character alone, whose play pairs its
caster's character with the target for the one settlement window after the next settlement, and whose rules give a
ban's length and a rest in days. The engine names no card. Loser Leaves Town, its two numbers, its words, its mark and
its art are Divided World's, under `instances/divided-world/`.

The numbers live in the card's rules and not in the instance's economy settings, as card notes Part 6 decided for a
card's share: they are the card's, and another instance's card could use other numbers.

## 10. A busy instance

A cast reads the two characters' bans and bonds by index. A settlement reads the duels of one window and, for each, two
characters' ledger rows of that settlement. A character is in at most one duel per window and rests for a week, so
duels grow with characters, never with Acts or reactions. A thread's page reads each postbit's live duel by one index
probe, beside the probe it already makes for the character's bans.

## 11. Open

- **The art's subject** is proposed in the plan (a suitcase at the town line) and is the owner's to approve in the
  build's PR, as every card's art is.
- **Whether the rest and the tie hold up** is for the first season's review: the numbers (3 days, 7 days) are starting
  numbers.
- **A character's record against others** (wins and losses on the profile) was not asked for and is not designed.
