# Member groups: a group bar for every character, and the Boss who moves characters between groups: design

Record, written 2026-11-06. The design session for #279, with the owner. It builds on the staff design
(`docs/plans/2026-10-31-the-staff-design.md`, sections 10 and 11, which already named "a user group" as a Boss move and the
targeting cap), The System's design (`docs/plans/2026-10-30-the-system-design.md`, section 11's apology demand), and the
board look design on its branch (`docs/plans/2026-11-06-board-look-design.md`, batch 4, where the owner raised #279). Each
section was decided one question at a time. Its plan is `docs/plans/2026-11-06-member-groups-plan.md`; its mockup is
`docs/research/2026-11-06-member-groups/01-bars.html`.

## The idea

The owner, in the board look session: "I like the member group bars for the staff members, and it reminds me that we
should really have these for regular members as well … it's a fun aesthetic quirk plus a fun thing for a boss or mod to be
able to swap characters in and out of." And opening this session: "Groups are cosmetic for the most part but could also
be used to control access to forums if the shoe fits. The Boss changing a character's group could keep them out of a
forum unless they make a public apology."

## 1. What decides a character's group

**Decided (the owner chose A):** every character is in exactly one group, shown as a bar. It starts in the instance's
default group and climbs an **earned ladder** by public facts, as 2003 boards promoted by post count. While a group move
is in force, the Boss may put a character in a **conferred group** that overrides the ladder; when the move ends, the
character is back on its rung, with nothing rewritten (a group is computed from Acts and public facts, never stored).

Weighed: everyone in one default group with only the Boss's moves changing it (B), which leaves most bars reading
"Members"; phpBB's many memberships with one on display (C), needed only if a character must hold several board keys at
once, and one group serves as a key.

## 2. Keeping a character out of a board

**Decided (the owner chose C, as recommended):** the move that confers a punishment group may name **one board it bars**
the character from posting on, until the move ends. It is a small move, not a structural one: it reshapes no board and
touches one character. A barred character still reads the board; the staff design already chose that over hiding a
board, so the crowd can watch. Part 6's restricted board (the staff design, section 10) takes a group as its key, earned
groups included; this plan builds the bar, and Part 6 builds the restricted board.

A barred player can post from another mask. The owner: "the ability to circumvent it simply with another mask is what
keeps it fun." It is the player's own doing and a clue, as a tail escaped by a swap is (the staff design, section 5).

Weighed: boards carrying group rules ("everyone but Trial Members", B), structural and waiting a day in the admin queue,
with a punishment's reach set by boards it does not name; A alone, without Part 6's key.

## 3. The public apology

**Decided (the owner chose B):** a punishment that bars a board carries the demand **an accepted apology**. The barred
character writes its apology publicly, as a thread spun from the move's Act, which the bar never blocks since it is the
way out. The staff member who signed the move judges it with one light model call in its own voice, choosing from a
fixed list: **accepted** (the demand is met and the move ends) or **rejected** (it stays; the ruling's words are shown).
The plea and the ruling are a public pair, as the staff design's appeals are, without a fee.

Its bounds: one apology per character per move per 24 hours (a setting); a judge's call that fails or answers outside the
list returns the attempt, which then does not count toward the day's one ("Three unrelated timeouts are not a poison
pill"); the move's expiry ends it whatever the verdicts, so a cruel judge means a longer wait and never a trap.

Weighed: any post in an apology thread meeting the demand (A), free and predictable, where "lol no" counts; the crowd's
reactions deciding (C), where a reaction count moves when one player reacts from several masks, so it would be computed
from a private fact.

## 4. The earned ladder

**Decided (the owner chose A):** a rung's condition is one of a fixed set the engine holds, each a lifetime public fact
about the one character:

- **default**: every character;
- **posts**: its post count is at least N;
- **seasons**: it has been revealed in at least N settled seasons;
- **staff**: it holds a staff office.

A character's earned group is the highest rung whose condition holds. None of these facts goes down except a staff
office, so a character never falls down the ladder by play. The staff rung is the top one, and it **replaces the
`staffGroup` setting**: "Personality Cores" stops being a special case and becomes a rung of the same list (CLAUDE.md, "Two
lists that must agree are one list").

Weighed: the season's standing as a condition (B), which moves every settlement and repeats the rank and pips; post count
alone (C).

## 5. Conferred groups: punishments and favors

**Decided (the owner chose A):** the instance lists the groups the Boss may confer, each marked a **punishment** or a
**favor**. The Boss names one by key; a key outside the list is not a move, and the model's free text is never read as a
choice.

- **A punishment** may bar one board (and then carries the apology demand), counts toward the targeting cap, and can be
  appealed once Part 3 builds appeals.
- **A favor** bars nothing and is the staff design's push: an inverted demand ("post 10 times on Tomato Talk this
  week"). Met by its stated check, the character keeps the group to the expiry; unmet, it is stripped at the check.
  A favor is not counted by the cap.

The owner named the first punishment group: **Trial Members** ("an actual thing MFGG did once").

Weighed: punishments only (B), which loses the Boss's favorite and the jealousy it starts; groups named freely by the
model (C), which an instance cannot style.

**The targeting cap** (the staff design, section 11: at most 3 staff punishments on one character in any 7 days) is
designed but not built. A punishment group is the first move aimed at one character, so this plan builds the cap with it.

**One group move per character at a time** (proposed with the sections and confirmed): a group move on a character that
already has one in force is refused, so every character has exactly one way out at a time.

## 6. The look

**Decided (the owner chose A):** the **rank bar**, a 2003 rank image: a gradient bar about 160 by 18 under the name, in the
group's color, its name in white capitals; a group may be striped (the mockup stripes Trial Members). A group's color is
a game piece's and keeps it in every theme; a theme restyles the bar's shape through tokens. The staff bar replaces the
staff chip on the postbit, beside ADMINISTRATOR or MODERATOR.

It shows under the name on every postbit and as a Group row in the profile's facts, and not in the Who is online box.

A barred board's reply box says plainly who barred the character, from where, until when, and the apology as the way out,
with **Write an apology** and **See the move** (the mockup's last panel). Plain board copy, true about the game's state;
the Boss's in-character words are on the move's own post.

Weighed: the staff chip made general (B); a plain "Group:" line among the counts (C).

## 7. Who confers a group

**Decided (the owner chose A):** the Boss at its meeting now, and Mod Bots through the same move once Part 3 builds them.
Admins never confer a group by hand ("The System acts": no person signs its rulings); an admin may end any group move
after it lands, so an admin can override.

Weighed: admins conferring by hand (B); the Boss only (C).

## The layers

- **The engine** holds: the condition kinds and the ladder's computation; the `conferGroup` move kind and the
  `apologyAccepted` demand kind; the inverted demand's check; the bar on posting; the apology, its limit and its judge;
  the targeting cap; the rank bar's component and its shape tokens; the log lines.
- **The instance** holds: the ladder's rungs and the conferred groups (keys, names, colors, stripes, thresholds, tones),
  which staff duty judges apologies, every number as a setting, and the Strategy Guide's words about groups.
- **How it reaches the engine:** a new `Instance.groups`, seeded into a `group_kinds` table by `seed_instance` as moves and
  demands are, and carried to the screens by `screen_settings`. The engine never names a group.

## Ways out of the states this adds

| State | Its way out |
| --- | --- |
| An earned group | Nothing to escape; the next rung by play |
| A punishment group with a bar | An accepted apology, the move's expiry, an admin's reversal; an appeal once Part 3 builds it |
| A punishment group without a bar | Its demand, its expiry, an admin; an appeal once Part 3 builds it |
| An apology waiting on its judge | Judged at the next run; a failed judgment returns the attempt |
| A rejected apology | Another after 24 hours; the expiry |
| A favor | Kept to its expiry if met, stripped at its check if not, or an admin |
| A character at the targeting cap | Nothing to escape; staff can't choose it until the window passes |

## What could slip a mask

- A character's group is computed from its own public facts (post count, reveals, office) and public moves, never from
  who owns it.
- A refusal to post differs only with the acting character's own public group move, which anyone can read.
- The apology limit is per character, never shared across a player's masks.
- The judge is given the move, the apology and the persona, never an owner or a class.
- The targeting cap counts public punishment moves on one character.
- The log's rows are the caller's own characters' moves, read through the caller's own characters.

## Open

- Divided World's conferred groups past Trial Members, and the ladder's thresholds and colors: drafted in the plan's
  Task 2 for the owner's review in the PR.
- Appeals of a group move, and Mod Bots conferring groups: Part 3 (no plan yet).
- A restricted board keyed to a group: Part 6.

## 8. After the Mod Bots design (amended 2026-11-06)

The Mod Bots design and plan (`docs/plans/2026-11-06-mod-bots-design.md`, `docs/plans/2026-11-06-mod-bots-plan.md`)
were merged after this design. A second session with the owner, the same day, reconciled the two. What it decided:

- **Groups build after Mod Bots merges** (the owner chose A). Groups then reuse what Mod Bots builds rather than
  building beside it: the offices each move kind names (its Task 3), the `staff` Edge Function (Task 7), appeals
  (Task 10) and the targeting cap's `staff_punishments` and `modBots.cap` setting (Task 11). Two caps, two judge crons
  or two appeal paths would be two lists that must agree.
- **A Mod may confer a group** (the owner chose A): punishments only, and only barring a board on its own beat, spent from
  its allowance as its one move. It judges apologies to its own moves, in its own voice. Favors stay the Boss's, so
  Teacher's Pet means the Boss itself noticed. `conferGroup` names the offices `boss` and `mod`. Section 7's "Mod Bots
  through the same move" is this.
  Weighed: Mods conferring favors too, on their beat; groups the Boss's alone.
- **A group punishment is appealed** (the owner chose A) through Mod Bots' appeals, to the staff member who made the move,
  with the same fee, refund and verdicts:
  - **overturned**: the move ends at once, with the new reason `overturned`, and the fee is refunded;
  - **upheld**: nothing changes;
  - **reduced**: the expiry moves halfway to now;
  - **increased**: the expiry moves later by at most half the move's original length, never past the phase's longest
    move.
  The new expiry is carried in the ruling Act and read from there, never edited into the move. The appeal and the
  apology are separate ways out; a character may use both.
  Weighed: the Boss hearing every group appeal over its Mods' heads; overturned or upheld only.
- **No alert when a group move lands** (the owner chose A), as Mod Bots sends none for a visit: the bar shows on every
  postbit, the log says what was done and when it ends, and the barred box explains itself when the player tries to post.
  Weighed: an alert for a bar only; an alert for every group move, as this design first planned.
- **With bans:** a banned character (Mod Bots, section 5) cannot post, so it cannot apologize; its ban ends by itself, then
  the apology is open again. The reply box shows the ban over the bar. The postbit reads, top down: name, group bar,
  title or BANNED, pips, warn meter.

The ways-out table above gains: a punishment group's appeal is available now, not "once Part 3 builds it".
