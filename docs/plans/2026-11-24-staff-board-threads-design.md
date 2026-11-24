# The staff's board as a staff keeps one: design

Record, written 2026-11-24. A design session with the owner, started from four questions about the Staff Announcements
board. Its plan is `docs/plans/2026-11-24-staff-board-threads-plan.md`. Each section was decided one question at a time;
where the owner chose the recommendation as put, the section says so.

## 0. The question

The owner:

- "How does a thread like this scale over time? Seems it will grow to have many pages."
- "The entire board is 'Staff Announcements': is a single thread for announcements an antipattern? We should consider how
  a human forum staff might approach this. New threads for new subjects?"
- "Debuts and Reveals take place within Staff Announcements, a thread per-season: this scales fine, but announcements
  here are odd, as they ostensibly are posted by the character profiles themselves within a Staff Announcements board
  that forbids such a thing. The events themselves are also detached from any surrounding context other than
  date/time."
- "Without these threads the Staff Announcements board truly becomes a living archive of incidental staff bureaucracy to
  be reacted to, which is a better fit: we can even consider putting the daily meetings into per-season threads like
  'Staff Meetings: Season 1' so that model output is actually seen by somebody."

And the aim: "complete 'the system''s transformation from a named entity to an under-the-hood mechanism powering a Staff
that acts as one would expect a Staff to act, albeit a flawed and robotic one."

What the code held when this was written (main, b61309b):

- **One announcements thread** (the setting `systemAnnouncements`, opened by `seed_instance`, latest
  `0413_rewind.sql:684`) takes every landed move and rule (`system_tick`, latest `0403_departed_personas.sql`), every
  move's end and keep (`say_move_end` 0129, `end_move` 0322, `apply_meeting` 0415), each handover's farewell and arrival
  (`hand_over`, 0403), every board card a player plays (`place_cast` 0413, `lay_sprung` 0360, `spring_facts` 0411), and
  the appeals of a group move with their rulings (`open_appeal`, `close_appeal`, 0135). A page holds 20 posts
  (`postsPerPage`), and the thread is bumped by each new Act. On a busy instance it runs to hundreds of pages.
- **Each season's thread** (`seasons.turns_thread`, `promos_thread` in `0100_announce.sql`, titled "Season {season}:
  Promos") takes every announced debut and Turn as the character's own `announce` Act, written on its behalf at the
  settlement or at a drop (`masks_change`, `announce_drop`, `write_announce`). A Turn is queued and lands at the
  settlement; it can be changed or withdrawn until then (the season-end design,
  `docs/plans/2026-11-06-season-end-design.md`, sections 4 and 5).
- **A Reveal** is already the character's own `unmask` Act, made at once in a thread its player picks
  (`docs/plans/2026-10-29-class-reveal-design.md`, section 2; `docs/plans/2026-11-03-glass-reveal-design.md`).
- **The meeting writes nothing for players.** Its output is moves (each with a `why` only admins read), memories, Mod
  orders and talking points (both closed to clients), a profile, and a farewell and handoff note at a handover. Its
  digest reads only public facts (`engine/system/digest.ts`, `supabase/functions/meet/core.test.ts:767`).

## 1. An announced Turn is posted at once, in a thread its player picks

**Decided** (the owner proposed it, over the recommendation that the post be written at the settlement in a thread
picked when the Turn was queued). An announced Turn writes the character's own `announce` Act at once, in the thread its
player picks, saying the Turn is done and when it takes effect: "Spritey has Turned to Face. It takes effect at the next
settlement." No balance changes: the Turn still takes effect at the settlement. It is opened as Reveal is: from the HUD
on the thread being read, and from My characters with a board and thread picker.

Weighed: a thread picked at queueing and written at the settlement (the post lands after the conversation that
prompted it has moved on, and a thread locked or moved by then needs a fallback); instant Turns first (#280), which is a
balance change and a design of its own; the per-season thread moved to the players' boards (keeps the detachment from
context the owner named).

The owner: "This translates naturally to instant Turns when they become available." When #280 lands, only the post's
second line changes.

What follows:

- **A Turn naming its new class reveals that class from the settlement.** The Act is dated when it is written; the
  reveal it carries is the character's verified class from the moment the Turn takes effect. The badge reads as such
  until then, the reveal perk starts at the settlement, and the guard that an `announce` names the class held becomes:
  the class held, or the class the character's queued Turn lands on.
- **Naming the old class** ("leaving Heel") is true at once, as today.
- **The settlement writes no Act for a Turn.** The Turn takes effect; the player's log says so.

## 2. Announcing commits the Turn

**Decided** (the owner chose B1). Once announced, a Turn can no longer be changed or withdrawn, and the Turn dialog says so
before it is confirmed. A silent queued Turn can still be changed or withdrawn, and can be announced later, which commits
it from then.

Weighed: withdrawal open with a public retraction Act (a cheap verified bluff: announce Face, retract before the
settlement); withdrawal open with nothing posted (the verified announcement would be false).

## 3. A debut is not a mechanic

**Decided** (the owner, over the recommendation that a Debut become an explicit action like Reveal). The owner: "A
'Debut' act next to a First Post is redundant: the first Act is itself the debut, and as an Act, it is already
reactable and spinnable … debut may not be a necessary mechanic." And: "there's not much of a gameplay reaction to
create a character and wait for it to become available tomorrow, which means 'when it debuts' does not really need to be
a question. 'How loud' is the real question … and the real answer is almost entirely about the user's actual
behavior."

So the creation screen loses "when it debuts" and "how loud". A character's first public Act is its entrance. A Lurker
that only reacts never makes one, which is what a Lurker wants; a Lurker that spins or plays cards enters that way. A
class shown from birth is a Reveal made at once, which already works in any thread. Debut `announce` Acts already
written are never edited and still draw.

Weighed: Debut as its own action, built like Reveal, announced or silent (the owner: "is a silent debut an oxymoron?");
an implicit debut banner in front of the first public Act (redundant with the Act itself).

## 4. A character is public and active from creation

**Decided** (the owner chose E1). `debuted_at` becomes the creation time: dropping a character is the only way to make
one. The cover a scheduled debut gave, landing among the settlement's other debuts so that its creation could not be
timed, is given up. Timing is a clue the game allows (CLAUDE.md, "A response never proves a private fact": "a mask
dropped the hour a story broke"), not a private fact; a player who wants cover creates the character at a quiet hour.

Weighed: active from creation but listed nowhere until its first public Act (keeps the cover; splits `debuted_at` into
"may act" and "seen", a filter for every list, and a Lurker invisible even in rankings while it earns Aura).

**The changeover.** A character still waiting to debut when the change lands is made active then. A Turn queued and
announced before the change lands the old way at its settlement, one last time, in the season's thread.

## 5. Two different things: the character's Act, and the season's record

The owner: "It's possible we are really thinking about two different things: the character's Act (a decision in the
moment to debut, turn, and/or reveal; helpful inside a thread, either an existing one or as the first post of a new
one), and the system's season record (a log of all of these Acts, day-by-day, to establish chronology for the season).
The current boss posting in a … thread every day (every day where there is new information to give, that is),
potentially with some Haiku commentary on the changes, coupled with the in-thread drops we are hypothesizing about,
might work."

**Decided** (the owner chose F1, and the title as proposed). The season's thread (`seasons.turns_thread`) becomes the
**Roster Report**, Divided World's title "Season {season}: Roster Report". At each settlement with something to report,
the Boss posts one entry:

- **A list built by code, exact and complete**, each item linking to its Act:
  - **Newcomers:** characters whose first public Act fell in the window. A reaction is never public (who reacted is
    private), and a face-down card is not public until it springs, so neither makes a character a newcomer: the
    record must never say that a new mask has begun to react or has laid a trap.
  - **Turns announced** in the window, and **Turns taking effect** at this settlement (announced ones only).
  - **Reveals** made in the window.
  - A silent Turn is never listed. A busy day's list runs across as many posts as `postMaxLength` needs.
- **One or two lines of commentary** above the list, from one light-tier call in the Boss's voice, given the list and the
  Boss's persona and nothing else: it may needle and bluff, and it has no private fact to leak. If the call fails, the
  entry is posted under a stock heading.

The current season's thread ("Season 1: Promos" on dw.gripe) takes the entries under its title: retitling it would be an
edit. New seasons open theirs under the new title. Season News in the glass stops listing debuts and keeps one item per
settlement with Turns.

Weighed: the meeting writing the commentary (richer, no extra call, but the strong tier's public words would be written
an hour after the settlement, and the commentary would no longer be bounded to the list); the Boss posting each event
as it happens (noise that repeats the Act it links).

## 6. A thread for each decision

**Decided** (the owner chose G1: "the board becomes an archive of discussions about the decisions themselves, which is
how forums are really used"). Each landed move opens a thread of its own on the staff board, started by the staff member
who made it, the move its first post, titled by a stock title for its kind (instance copy: "New board: Retro Corner",
"New rule in Help", "Moved: <thread title>"). Its words are the stock line they are today. What belongs to the move
follows it there: its keep, its end, the appeals against it and their rulings. Moves the meeting made as one bundle land
in one thread, titled by the bundle's first move. Each handover opens a thread: the farewell, then the arrival.

The "Official Announcements" thread takes no new Act and stays listed, an archive. Every thread the staff opens on the
staff board follows the board's flag, as the instance-placed threads do (`docs/plans/2026-11-22-system-threads-follow-the-flag-design.md`).

Weighed: a thread per board, collecting every move on it (long-lived threads of unrelated decisions); a thread per day (a
move's end or an appeal weeks later lands far from its move).

## 7. A board card is played on its board

**Decided** (the owner chose H1). A board card is played in a thread on the board it targets, which the player picks (by
default the thread being read, when it is on that board). The card Act is written there as it is written in the
announcements thread today, free-standing, reacted to and spun; only its place changes. A board with no thread yet
refuses with plain words: start a thread there first. Cards already played stay where they are.

**Appeals** stay in the move's thread (the owner: "appeals can stay in the move's thread"): a petition in the decision's
own file, answered there.

Weighed: a thread opened by each board card (a thread whose first Act is a card, which takes no seq: new machinery for a
notice); a thread per board card on the staff board (keeps the oddity).

## 8. The meeting's minutes

**Decided** (the owner chose J1: "if it's a somewhat negligible addition … and it would add some comedy value, then
it's probably worthwhile"). The meeting's last part, where the Boss already writes its memory and farewell, gains a
`minutes` field: at most about 600 characters, in character, summarizing the meeting just held (what was argued, what was
decided, who is on notice). After the meeting the Boss posts them in the season's **Staff Meetings** thread, Divided
World's title "Season {season}: Staff Meetings". One post a day: a season of about 90 days is about 5 pages.

The cost: output tokens on a call already made, with no extra call and no input sent again. At 150 tokens a day at
Opus's $20 per million output tokens, about $0.003 a meeting.

The minutes are words, never read as a move. They may mention a move that waits on admins and is later held: the
fiction may lie, and "the Boss promised Retro Corner and it never came" plays as staff bureaucracy, while the move
threads say what landed. Mod orders, memories and talking points stay private.

Weighed: minutes assembled by code from each move's `why` and the talking points (written for admins and for the
personas' prompts, not for readers; making them public changes what the model should write in them); a Haiku summary of
the meeting's record (second-hand reasoning, a call a day); publishing the Mod orders as memos (they tell players
exactly what each Mod will enforce, which is why they are closed).

## 9. The copy

- The Strategy Guide's Turns, new characters and staff sections are rewritten (and its "The System posts that your
  character has Turned", `strategy-guide.md:84`, goes). The owner approves the words in review.
- The dialogs' "own Promo" goes; the log's settlement line names where the Turn was announced.
- New instance copy: each move kind's thread title, the handover thread's title, the Roster Report and Staff Meetings
  titles, and the Roster Report's stock heading. The plan proposes the strings; the owner approves them in review.

## 10. What the rules ask

- **Layers.** All of the mechanics are engine. Divided World gives the thread titles, the stock heading and its Boss's
  voice. The Roster Report's and the minutes' thread titles join the engine's `Copy` and its completeness check; the
  move thread titles join the staff's stock lines.
- **The masks.** The Roster Report's list reads public Acts only, and its commentary call is given that list and
  nothing else. Newcomers are counted from public Acts, never reactions or face-down cards. The minutes are written by a
  meeting whose input is public facts. A Turn's announcement is posted when its player chooses, in a thread its player
  chooses. A silent Turn appears nowhere but its own player's log. No refusal here differs with who owns a target.
- **Ways out.** One state goes (waiting to debut). A committed Turn ends at its settlement, as a queued one does. A board
  card on a board with no thread says how to proceed. No other state is added.
- **Append-only.** No Act is edited. The announcements thread, the Promos Acts and the board cards already played stay
  where they are; old debut Acts still draw.
- **The fiction and the log.** The commentary and the minutes may bluff; the list under the commentary, the move threads
  and the player's log are exact.
- **At a busy instance.** A move thread a landed move (a few a day), each a short thread. The Roster Report: one entry
  per settlement, its list split by length; finding newcomers reads each character's first public Act through an index,
  not a scan of the window's Acts by character. The minutes: one post a day. Staff threads following the flag: a set
  of one thread per move, read only on the rare seed that moves the flag.

## 11. Open

Nothing is open. #280 (instant Turns) changes the announcement's second line when it lands.
