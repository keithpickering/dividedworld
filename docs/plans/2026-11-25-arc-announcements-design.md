# An arc beat announces itself: design

Record, written 2026-11-25. A design session with the owner, started from a question about the Staff Announcements
board and the Boss's arc. Its plan is `docs/plans/2026-11-25-arc-announcements-plan.md`. Each section was decided one
question at a time; where the owner chose the recommendation as put, the section says so.

## 0. The question

The owner: "Staff Announcements for Arcs: let's check recent plans for Staff personas, built, in progress or upcoming,
and see if this case is expected to be covered by existing reworks to the Staff Announcements board, namely per-move
Threads." The example is FanGaME's Split (`docs/plans/2026-11-06-fangame-split-design.md`, section 8): his epiphany
that his code does not recognize a board index below zero, so World -1 can hold all non-fangame posts harmlessly.

"I've seen this work mechanically, but it's a big moment and the staff doesn't *talk* about it. An arc beat warrants a
dedicated sticky thread announcing the logic and the plan with a longer post than usual. Other personas should know
about the initiative, the boss himself should be more proactive and pushy about it, and he should lament the concern
more in the days before he has the epiphany. The idea can and should come from thin air on his memo one day, but the
frustration leading up to it should not be new (that said, the character's personality is very charming, so we
shouldn't change it fundamentally)."

Later, on the handover: "The arc initiative disappears and a new boss takes over in a honeymoon phase … part of this
agreeable honeymoon might be a 'cleanup' protocol specified in the previous boss's persona's arc data: FanGaME moved
everything to one board, the next boss tries to start moving things where they make sense (building the block tower to
knock it down again). Beyond this, it raises the question of how/if the staff remembers the previous events and
fallout — temporary memory of the previous boss and season results may be helpful, to occupy the pitch line: it becomes
a living indicator of the game plot."

What was found, on main at 149e8dd:

- **Today** the meeting plays the Split (`engine/system/beats.ts`, `apply_meeting` latest in `0424_staff_requests.sql`).
  Its two `createBoard` parts wait about a day for admins, then each lands with the one-line stock `moveLanded` post in
  "Official Announcements" (`system_tick`, latest `0403_departed_personas.sql`). The brief tells him to "Announce it as
  your greatest Improvement Initiative yet", and nothing gives him the room to.
- **Per-move threads** (`docs/plans/2026-11-24-staff-board-threads-design.md`, section 6; designed, not built) would
  open one thread titled by a stock title ("New board: World -1"), its first post the landing line.
- **Persona lines** (`docs/plans/2026-11-25-persona-lines-design.md`, section 1.1; designed, not built) would make that
  landing line written ahead by the meeting, in his voice, at most 280 characters.
- **Talking points** may not mention a move still waiting on admins (`pointsText`, `engine/system/meeting.ts`), and a
  pool call's public record shows only moves that landed or ended (`pool_record`, `0415_chattier_staff.sql`;
  the chattier staff design, section 4). So nobody on staff can speak of the Split for the day it waits.
- **A beat's brief stops showing once played**, and **is shown only once unlocked** ("An arc is a secret, even from the
  Boss", the split design, section 1). Nothing keeps a played initiative in front of him, and nothing builds toward it.
- **The staff board has no stickies.** The only pins are a card's (`pinned_threads`), which belong to a player's play
  and end.
- **The handover** hands the new Boss the code's facts and the outgoing Boss's out-of-character note for
  `inheritanceGraceDays` (`predecessor_handoff`, 0403; the split design, section 6). None of it reaches other staff or
  the board, and nothing authored turns the outgoing Boss's mess into a plan for the next.

So the case is not covered: the planned reworks would make the Split a 280-character notice under a stock title, a day
after the idea.

## 1. The announcement posts at the meeting that plays the beat

**Decided** (the owner chose A). An announced beat opens its thread at the meeting that plays it, the day of the
epiphany. Each part of its bundle, when it lands, posts its landing line into that thread instead of opening a move
thread of its own; its ends, keeps, appeals and rulings follow it there, as the per-move threads design already routes
them.

If an admin holds the bundle, the thread has promised something that never comes. That is the fiction ("The fiction
may lie; the log never does"): the minutes design accepted "the Boss promised Retro Corner and it never came" as staff
bureaucracy, and the move posts and the log stay exact.

Weighed: posting when the bundle's first part lands, about a day later (admins would see the words first, but the
epiphany is cut off from its meeting and a lead-in cannot build toward a fixed day); a teaser at the meeting and the
long post at the landing (two posts from one call, for a payoff the landings into the same thread already give).

## 2. A beat opts in

**Decided** (the owner chose A). A beat carries an optional `announce` block in the persona's file; a beat with one
opens a thread, a beat without one changes nothing. For FanGaME: the Split and Everything is World -1. A persona with
no arc is unaffected.

A beat played without an announcement (Victory lap, Picking it apart) is named to that meeting's minutes (the staff
board threads design, section 8), so the minutes may say it, at no cost: the minutes are written in the same last turn
of the meeting in which beats are answered. The owner: "The mini arcs could potentially go into regular meeting
minutes." The brief itself is never made public; only what the Boss chooses to write.

Weighed: every beat announces (Picking it apart would announce "I will move threads sometimes"); every beat with a
bundle announces (couples two questions: a quiet bundle, a loud beat with none).

## 3. The meeting writes it

**Decided** (the owner chose A). The meeting writes the announcement in the same turn in which it plays the beat (the
`self` part), the strong tier, in the same call, as it writes the farewell:

- a **title**, at most `titleMaxLength`, guided by the block's `titleHint`;
- a **body**, at most `announceMost` (2,000 characters, about one long forum post), trimmed at a sentence where it
  overshoots, the trim recorded;
- a **pitch**, at most 200 characters, the initiative in one line (section 5).

Where a field is missing or blank, the call fails, or a due beat is played with its defaults, the block's authored
`defaultTitle`, `defaultBody` and `defaultPitch` stand in. The thread always opens.

The cost: about 500 output tokens at the strong tier's $20 per million, about a cent, once per announced beat.

Weighed: a light-tier call afterward, from the brief and the bundle (a tenth of the cost, but the one post a season that
most needs the Boss's voice and the reasoning behind the decision, written second-hand); authored text only (the board
name he picks in a slot, the state of his fangame board and the day's mood could not reach it).

## 4. The sticky

**Decided** (the owner chose A). A new **staff pin**. An announcement's thread is pinned on the staff board from the
moment it opens until its season ends; the board index lists it first, under "Sticky:", in the house style. An admin
can unpin it at any time. At most a few a season (FanGaME has two), so the top of the staff board reads as the season's
story in order, and the next Boss begins with an empty top.

A staff pin is not a card's pin: it has no play, no reactions and no Spin of its own. A pin ends by itself when the
season it was made in is no longer the open season, so the handover writes nothing for it; a departure mid-season
leaves the pins of the season's story in place.

Weighed: only the latest announcement pinned (the setup the finale pays off would drop from view beside it); a fixed
number of days (means nothing in the story: the Split would come down mid-reign).

## 5. The others know, and the Boss pushes: the plot so far

**Decided** (the owner chose A). Once posted, an announcement is public play, so the reason talking points stay off
unlanded moves (the Boss's plans in members' mouths before they are public) does not apply to it.

- **The pitch reaches every staff call.** Every staff persona's pool calls (Boss, Mods, members) see, in their public
  record, **the plot so far**: each announced initiative's title, pitch and thread, until its season ends. The Boss's
  meetings see the same section.
- **Talking points may speak of an announced initiative** even while its moves wait on admins, so the meeting can set
  each persona's stance on it (a skeptic, a sycophant, a Mod who resents the extra work). Unannounced, unlanded moves
  stay out of points as before.
- **The Boss pushes.** The block's authored `push` line is in the Boss's meeting prompt and every pool call of the Boss
  until its season ends. It is the writer's, so a calmer Boss's arc may push gently or not at all.

Weighed: talking points only (depends on the meeting remembering each day; one 200-character point is all a member
gets); the whole announcement in every pool prompt (about 2,000 characters a call, growing with staff and rounds).

## 6. The lead-in

**Decided** (the owner chose A). A beat may carry a `leadIn`: its own unlock conditions, a `brief` and a `mood` line. It
names the worry, never the idea, so the arc stays a secret, even from the Boss, and his personality is unchanged; it
sharpens the frustration his temperament already holds.

- While the lead-in's conditions hold and the beat itself has not unlocked, its brief is shown at the Boss's meetings
  (so its talking points and minutes pick it up and escalate day by day), and its `mood` line is in the Boss's pool
  calls (so every conversation post can leak the worry, even on a day the meeting does not).
- It stops when the beat unlocks. The idea then arrives "from thin air" in the brief, and the announcement is the first
  anyone hears of it. A lead-in whose beat never unlocks ends with its season.
- **The `phase` condition gains `daysIntoPhase`**, the field a beat's due point already has, so the Split's lead-in
  can open in the honeymoon's second week. A small engine change, as the split design foresaw for new conditions.

Weighed: the meeting's brief only (his posts would carry the worry only as far as his own talking point does); a
sharper temperament and habits (always on, never builds, and shifts the character for the whole season).

## 7. The aftermath: a cleanup protocol for whoever comes next

**Decided** (the owner chose A). A persona's file may carry an **`aftermath`**: beats handed to whoever succeeds it as
Boss, written so any persona plays them in its own voice ("Your predecessor merged the whole forum into one board
called World -1 …").

- An aftermath beat has the shape of any beat: unlock conditions, a brief, optionally a bundle (authored, at no cost to
  the bank), optionally an `announce` block and a `leadIn`. It is never due; it lapses at the season's end like an
  optional beat.
- **Its conditions can ask what the predecessor's arc did.** `beatLanded` gains `of: 'predecessor'`, naming a beat of
  the Boss that handed over to the current one, in the season it served. If Everything is World -1 was held and never
  landed, no cleanup shows.
- **Its roles reach the predecessor's boards** (`{role, beat, of: 'predecessor'}`), resolved across the season
  boundary: World -1 is the board the predecessor's Split made with the role `minus`.
- It is played inside the new Boss's honeymoon, with ordinary moves (which cost what they cost, so the tower comes down
  at a honeymoon's pace) and its own bundle where it has one. The new Boss's own held-back kinds still apply.
- One writer covers every successor, and the cleanup belongs to FanGaME's story, where the owner placed it.

Weighed: mini-arcs in each successor's file that check what the last season left (the writing grows with every pairing
of personas, and a Boss written before FanGaME's arc would have none); no authored cleanup (the handoff already tells
the new Boss, and free composition decides; the tower comes down only if the model chooses to, and never announced).

## 8. The plot line across the handover: the recap

**Decided** (the owner chose A). The last meeting, which already writes the farewell and the handoff, also writes a
**recap**: at most 300 characters, in character, public in tone, saying what the season was ("I put everything in
World -1. It is all fangames now. You are welcome. (I miss you all already.)").

- For the length of a honeymoon (`phases.honeymoon.days`) from the handover, the plot so far (section 5) opens with
  **last season**: the outgoing Boss's name and its recap, in every staff persona's pool calls and in the new Boss's
  meetings. Talking points may speak of it, so the Mods can grumble about the mess or defend the old Boss.
- An announced aftermath beat's pitch joins it, so the line reads: last season he did this, and now the new Boss is
  doing that. That is the owner's "living indicator of the game plot".
- It fades when that length is over, as the new Boss's own story begins. Each persona's memory keeps what the meetings
  wrote into it.
- **Fallback:** where the last meeting failed or wrote no recap, a plain line is built by code from the handoff's facts
  ("Last season: FanGaME led. World -1 holds the threads of 14 boards."). It is only ever read inside a prompt.
- A departure mid-season hands over the same way: the departing Boss's recap is written by its last meeting where one
  ran in the farewell window, else the fallback.

Weighed: built by code from the facts only (exact and free, no voice: staff would repeat a list); nothing carried
(memories fade at random, and the board would hear nothing in common).

## 9. FanGaME's content

Drafted in the plan (Task 8) for the owner's approval in review:

- **The Split's lead-in**, opening in the honeymoon's second week: a worry about threads he cannot process, and a sense
  there must be a way, with no plan.
- **The Split's announcement**: `titleHint`, defaults and a `push` line ("You announced World -1 … you ask whether it
  might be happier in World -1, and how everyone is enjoying the plan").
- **Everything is World -1's announcement**: a finale memo. No lead-in: the consolidation brief already builds toward
  it.
- **His aftermath**, "Restoration": unlocked when Everything is World -1 landed and the honeymoon has begun; an
  authored bundle that creates one board the new Boss names, then ordinary `moveThread`s out of World -1, a few at a
  time; an announcement whose defaults speak in a voice any persona can carry.

## 10. What the rules ask

- **Layers.** Engine: `Beat.announce`, `Beat.leadIn`, `Persona.aftermath`, the conditions' new fields, the staff pin,
  the plot so far in the pool record and the meeting prompt, the recap and its fallback. Instance: FanGaME's lead-in,
  announcements, push lines and aftermath; the setting values. The content arrives through `SystemContent.roster` as
  every persona field does, and the engine names no persona.
- **The masks.** The meeting writes from the digest, which holds public facts. The announcement, pitch and recap are
  posted or read as public play. The push and mood lines are content. Conditions read beat events and board post
  counts, which are public. Nothing reads who owns a character, a class or who reacted. When anything posts depends on
  the meeting's schedule, never on a player.
- **Ways out.** A staff pin ends with its season, or when an admin unpins it. A lead-in ends when its beat unlocks or its
  season ends. An aftermath beat lapses at the season's end. A held bundle leaves an announcement that promised
  something; the log and the move posts say what landed. No state is added to a player, a character or a post.
- **Append-only.** The announcement is a post Act. A pin and an unpin are rows of their own, never an edit of an Act.
- **At a busy instance.** A few announced beats a season, each one thread and one pin. The plot so far adds about 200
  characters an initiative, plus the recap, to each staff pool call; a season holds a handful. The lead-in and the
  aftermath are read for the one current Boss, as the arc pass already is. The board's stickies are a read of one board's
  pins in the open season, through an index.
- **Portable.** The new tables join the export and its round-trip test.

## 11. Order of building

After the staff board threads build (its staff threads, `open_staff_thread`, move threads, and the minutes) and the
persona lines build (the landing line written ahead), both on main before this plan's first task.

## 12. Open

- **A cleanup for an arc that did not finish.** An aftermath beat whose condition is "the Split landed and Everything
  is World -1 did not" needs a negated condition, which the catalog does not have. FanGaME's aftermath covers the
  finished arc only, for now.
- **Arcs for the Bosses after FanGaME** (still the rehearsal patch's follow-up). ONTOPIC 5.0, his likely successor, will
  run his aftermath in her honeymoon without an arc of her own.
