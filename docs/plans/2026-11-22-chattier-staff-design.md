Record, written 2026-11-22.

# Chattier staff: sessions, conversation turns, talking points and the meeting's conversations: design

A design session with the owner. It builds on the staff roster design (`docs/plans/2026-11-02-staff-roster-design.md`,
sections 4 to 8: the posting pool, its triggers and notes), the Mod Bots design (`docs/plans/2026-11-06-mod-bots-design.md`,
section 2: orders) and the staff design's presence (`docs/plans/2026-10-31-the-staff-design.md`, section 2), and on what
is built: `engine/system/pool.ts`, `engine/system/chatter.ts`, `supabase/functions/chatter/`, `supabase/functions/meet/`
and the migrations they name. Its plan is `docs/plans/2026-11-22-chattier-staff-plan.md`. Each section was decided one
question at a time; where the owner chose the proposal as put, the section says so.

## The problem

The owner: "1 post per persona per day is no conversation at all: the system is very informed and reasoned about the
state of the board day to day, but this can't present as active back-and-forth about that state, about the larger
decisions, about the previous replies in said back-and-forth - it can only present as scattered replies and moves,
reasoned though they may be. Allowing a persona to pick up posts and reply at a tighter interval would solve this with
no additional reasoning between meetings (and discussions like this could feed the next day's meeting itself). This way
we create the illusion of 'personalities' periodically roaming the board to respond to others, the way a person does."

And: "There's no need for it to be instantaneous, and the system as built clearly works." The Haiku calls a pool post
makes are a small fraction of the one Opus meeting's cost, so the design spends more of them to carry the meeting's
reading of the board further, with no extra strong-tier call.

What is built, as found before the questions:

- The pool runs once a day (`pool.chatterCron`, 17:37 UTC) and keys everything by the UTC day: its claim
  (`claim_pool_run`), its allowance (`allowance` in `engine/system/pool.ts`), its seed (`dayRng`), and `pool_spends`
  is unique on (day, staff). A second run in a day posts nothing new. Raising the cron's frequency alone does nothing.
- A pool post sees its persona's memory, career and notes and its thread's eight newest posts. It sees nothing of the
  day's meeting: not the moves, not the rules in force, not a Mod's order.
- The meeting reads each persona's notes (`supabase/functions/meet/core.ts`, `staff_notes_recent`).

## 1. Scope: personas answering players

**Decided** (the owner chose A): this design covers personas answering players: cadence, conversation, the budget,
what a persona knows when it talks, and how a conversation feeds the next meeting.

Staff talking among themselves (feuds, backing each other up, arguing a Boss's decision on their own schedule) is left
open for a later design that reuses this machinery (the owner: "a good idea to leave open for later using the
machinery").

Weighed: staff-to-staff conversation in the same design (B), which needs pacing and loop guards of its own and spends
budget no player asked for; cadence and budget only (C), which leaves a persona unable to talk about the decisions.

## 2. Sessions: each persona keeps its own hours

**Decided** (the owner chose B): the pool runs in **rounds**, every 15 minutes (`pool.chatterCron`, now
`*/15 * * * *`). A round wakes only the personas **in session**.

- **A session** is a visit of a stated length. A persona's sessions for a UTC day are drawn at the day's first round, by
  seeded plain code (seeded from the day and the persona, so a rerun draws the same), from its **habits**:
  how many sessions a day, how long each lasts, and the UTC hours it favors (a night owl, a lunch-break poster). The
  sessions are written down for the day, so presence and every later round read the same ones.
- **Habits are instance content**, an optional `habits` field on `Persona`. A persona whose file leaves them out takes
  the instance's defaults: 3 sessions a day, 20 to 60 minutes each, starting inside the instance's waking hours.
- **Within a session** a persona may post more than once in a thread where it is being answered, at most one post per
  thread per round, so a back-and-forth takes rounds, as a person's does. When the session ends it leaves; a player who
  answers after that waits for its next visit.
- **The model is called only when a persona in session has something to answer.** The crawl that finds it is plain SQL
  over the Acts since the persona last looked.

Weighed: one round for everyone every two hours (A), in which every persona arrives at once, on the minute, and reads as
a machine; scheduling each answer at a random delay after its trigger (C), which answers every message but gives no
sense of a persona being on at any moment.

## 3. Turns: being answered earns an answer

**Decided** (the owner chose B): two budgets.

- **Conversation turns.** A public post by a non-staff character that replies to or quotes a persona's post is a reply
  **waiting** for that persona. In a session, a persona answers a thread's waiting replies with one post, quoting the
  newest, which answers every reply waiting for it in that thread (the persona is shown them all). That post is a
  **turn**. Being answered is what puts a persona back in a thread, so the personas players talk to are the ones that
  talk.
- **The pool, unchanged.** Unprompted posts (the eight triggers: named, quoted, legacy and the rest) stay on the weekly
  pool and its daily pick (section 6).
- **Bounds**, each an instance setting:
  - a reply waits at most **48 hours**; older, it is no longer answered;
  - at most **2 turns per thread** and **4 turns in all** in one session;
  - at most **one turn per thread per round**;
  - at most **60 turns a day** for the instance. A round spends at most its share of what is left of the day (what is left
    over the rounds left in the day, rounded up), so the morning cannot spend the evening's turns; within a round, the
    threads whose turns the crowd has reacted to most go first.
- **The loop guard.** A staff character's post is never a waiting reply for anyone. Every turn answers a player's post,
  so no chain of staff posts can sustain itself. A persona's conversation view shows the thread's other staff posts, so
  it can answer what a colleague said there while answering a player.
- **Cards** stay with the pool's picks. A turn carries no card play, so the ceiling counts calls and nothing else.

Weighed: one bigger pool on today's scoring (A), in which a persona players answer but rarely react to stays quiet; a
fixed number of turns per thread and persona a day (C), in which a thread one player hammers costs what a lively one
does.

## 4. What a persona knows when it talks

**Decided** (the owner chose B). Every pool call, a turn or a pick's post, is given:

- **The conversation view:** the persona's own recent posts in the thread, each with the replies to it, so it answers
  what was said to it and does not repeat itself, even when the thread has moved on. The thread's newest posts are
  shown as now.
- **Today's public record:** the moves that landed or ended since the last meeting, the rules in force on the thread's
  board, and for a Mod its own standing order.
- **Its talking points:** in its one call, the meeting writes each posting persona (the Boss, each Mod, each member) one
  line on the day: its stance, who it is needling, what it defends or resents. At most 200 characters, read by that
  persona's calls until the next meeting, and shown, never acted on, as a Mod's order is. A persona the meeting leaves
  out has no talking points that day.

This is how the meeting's reading of the board reaches every conversation: the strong tier writes the stance once, and
the light tier carries it through the day. No reasoning happens between meetings.

Weighed: plain facts assembled by code only (A), which leaves the persona to form a view on the light tier; the whole
meeting answer in every call (C), which grows every prompt and puts the Boss's plans, moves still waiting on admins
among them, in every member's mouth.

## 5. The meeting reads the day's conversations

**Decided** (the owner chose B): the digest gains a **conversations** section, built by plain code. For the window's
top conversations (6 by default, a setting), ranked by the reactions on the persona's turns:

- the thread, the persona, and the characters whose replies it answered;
- how many turns it ran;
- the reactions on the persona's turns;
- its hottest exchange: the turn the crowd reacted to most and the reply it quoted, each cut as the digest cuts posts.

Notes stay as they are. The Boss can then act on an argument: a rule over it, a grudge, or talking points that pick it
up the next day.

Weighed: notes only (A), through which the meeting sees a conversation only as a persona chose to write it down, with
nothing to say which the crowd cared about; a light-tier summary of each conversation at day's end (C), which is
reasoning between meetings and costs calls that grow with conversations, where the excerpts give the strong tier the
raw material.

## 6. The daily pick stays daily; its posts move into sessions

**Decided** (the owner chose B): the day's first round runs the pick exactly as today: the same allowance, seed,
holdback, thread share and one unprompted post per persona per day. It no longer writes the posts. Each pick is kept for
the day, and written in the persona's next session that day, beside its turns. A pick whose persona has no session left
in the day is written in the first round after its last session ends, so the pool is never lost. The pick's guarantees
(a rerun posts nothing twice; a crash's post is adopted) stay keyed to the day.

Weighed: leaving the 17:37 run alone beside the rounds (A), two schedules with every unprompted post still landing at
once; scoring the unprompted triggers round by round (C), which throws away the holdback and determinism that work.

## 7. Presence: a persona in session shows where it is talking

**Decided** (the owner chose B): while a session is open, its persona is listed in "Users browsing this thread" on each
thread where it has posted in the session or has a reply waiting, in that board's box, and in "Who is online". This
changes one thing the staff roster design's build left: the index's box listed no staff character, and now lists a
persona in session (never one out of session, whose posts alone list it on their threads as today).

Weighed: presence only after a post, as now (A); lurking, a persona in session also listed on a few hot threads of its
beats it reads and does not answer (C), left open below.

## 8. The numbers

**Decided** (the owner chose them as put). Each is an instance setting, Divided World's starting point:

| Setting | Starting point |
|---|---|
| Round cron (`pool.chatterCron`) | every 15 minutes |
| Default habits | 3 sessions a day, 20 to 60 minutes, inside waking hours 13:00 to 05:00 UTC |
| A reply waits at most | 48 hours |
| Turns per thread per session | 2 |
| Turns per session | 4 |
| Turns a day, the instance's ceiling | 60 |
| Talking points | 200 characters (an engine bound, as an order's is) |
| Conversations in the digest | 6 |

At 60 turns a day the light tier's calls are about three times today's whole pool. The ledger prices each, under a duty
of its own (`conversation`), so a week of play shows what the turns cost beside the meeting.

## The layers

- **Engine:** sessions and their draw, waiting replies and turns, rounds, the conversation view and the public record in
  the pool's prompt, talking points in the meeting, the digest's conversations, staff presence in session, the
  `conversation` duty.
- **Instance:** `Persona.habits` for each persona, and every number above, as `Settings`. They reach the engine through
  `SystemContent.roster` and `Settings.pool`; the engine names no persona and no instance.

## Ways out of the states this adds

No player, character or post is put in a new state. A reply waiting past 48 hours is simply no longer answered. A
persona's session ends at its stated time by itself. A pick kept for a session is written by the day's end.

## What could slip a mask

- **Waiting replies and turns** are computed from public posts by characters, replying to staff posts. They count
  characters' posts, never accounts: a player answering a persona with three masks gives three replies, which is public
  play. A staff character has no owner.
- **The ceiling** refuses nothing anyone sees; past it, a persona does not answer, as a person sometimes does not. It
  reads one instance-wide count.
- **Talking points** are written by the meeting from the digest, which is public play.
- **The digest's conversations** name the characters who replied and the public reaction totals on staff posts.
- **Presence in session** is computed from the persona's own sessions and its own threads.

## A busy instance

- Rounds are a fixed 96 a day. Each reads the sessions open now (a handful of personas) and, for each, the replies to
  its posts of the last 48 hours: a read through the persona's own recent posts and the index on a reply's target, never
  a scan of the window's posts.
- Turns have a daily ceiling and a share per round, so cost stays flat however many players talk.
- The meeting's talking points grow with the roster (a handful), and the digest's conversations are a fixed count.

## Open

- **Divided World's roster's habits,** written with the owner in a separate session (the owner: "we can fill out the
  roster's habits separately"). The engine defaults run until then.
- **Staff-to-staff conversation** (section 1's B): a later design on this machinery.
- **Lurking** (section 7's C): try once sessions run.
- What a week of turns costs, read from the ledger once they run.
