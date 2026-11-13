# What the season rehearsal found: the design

Record, written 2026-11-13. A design session with the owner, on the ten findings of the live season rehearsal
(`docs/research/2026-11-13-season-rehearsal/README.md`, carried in this design's PR) and the owner's answers there. The
plan is `docs/plans/2026-11-13-rehearsal-patch-plan.md`.

The owner was very pleased with the run. Nothing here changes the tone of the game: FanGaME's prompt is dialed in and is
not touched (his "This is fine. I am fine." stays), and the arc plays as written. What follows are the frame the staff
are told, two habits that read as a checklist, a bug in how a Mod judges the Pointless Post Palace, two places the
season's end and the succession meet badly, the bounds the models overshoot, and the rehearsal's own filler.

## 1. How this lines up with the launch plan

`docs/plans/2026-11-13-launch-plan.md` is merged and not yet built; no launch PR is open. Its Task 3 writes ONTOPIC
5.0's file exactly as it prints it and says to stop if a test refuses a value, and two of main's tests refuse it
(finding 10). Its Task 2 copies QC-1000 from PR #444's draft. Both personas need this design's changes.

**Decided (the owner):** this plan is built first, and it takes over the launch plan's Tasks 2 and 3: it writes both
persona files, with this design's changes, and their tests. The launch build then starts at Task 1 and skips Tasks 2
and 3; the owner tells that session so when starting it. Task 4 of the launch puts the two personas on the roster as it
says. Both plans stay records as written, and neither undoes the other: this plan never touches the roster, the boards,
the clock or `systemEnabled`, and the launch plan never touches what this plan writes. The two will meet only in
`instances/divided-world/system/system.test.ts`, where each adds tests, and the later rebases.

Weighed: building the launch first with its build session told to use this design's strings for Task 3 (a session
started from one plan reading a second for its strings), and building the launch as written (its Task 3 would stop).

## 2. The frame (findings 3 and 4)

The staff were told they work for "robo-McMahon", "a big dumb robot that sees this board as its toybox", and the stock
lines speak as "The System". On day 88 FanGaME signed a post "from your Boss, robo-McMahon, and also from FanGaME".

**Decided (the owner):** nothing the staff are told and nothing posted under a persona's name says "The System",
"robo-McMahon" or the toybox. The staff understand the forum as Gabe's forum, which they were made to run. Only the
sentences that set the frame change:

- `BOSS_PREMISE` opens: "You are the Boss of Divided World, Gabe's message board game, set in 2003. Gabe made the staff
  out of Personality Cores and gave you the job of running his forum for him. On the board you are a character like any
  other, except that you are omnipotent, and you are everyone's boss. You are not clever." The paragraphs on what the
  Boss wants, kayfabe, what it cannot know, how it acts and its phase stay as written.
- `MOD_BOT_PREMISE` opens: "You are a Mod Bot on Divided World, Gabe's message board game, set in 2003. Gabe made the
  staff out of Personality Cores and gave you a job on his forum: you are staff, and you work for the Boss, who runs it
  for him." The rest stays.
- `MEMBER_PREMISE` opens: "You are one of the Personality Cores Gabe made to staff Divided World, his message board
  game, set in 2003: ..." The rest stays.

"Game" stays, as does the kayfabe paragraph: the staff know everyone plays a character, which is how a real argument
is deflated rather than joined. Weighed: dropping "game" from the opening.

The stock lines that post under a staff character's name speak as that character: a move's lines (landed, met,
expired, reversed, superseded, unmet, overturned) in the first person ("I have decided on ..."), and a Mod's lines name
the Mod. The board-description lines speak of "the staff". The announcements thread, where every move is said, is
titled **"Official Announcements"** (weighed: "Announcements From Management", "Announcements From The Boss"). The seed
makes that thread once, so the title takes effect at the launch's fresh seed; a project already seeded keeps its
thread as it is.

The template bug: `{move}` fills in lowercase ("a rule"), and so does a visit's `{rule}` ("the premise of Help"), and
both opened sentences ("You did it. a rule is over."; "... and breathing. the premise of Help."). The lines are
rewritten so that neither opens a sentence, and a test holds it, driven red on a planted line. A capitalized token
(`{Move}`) was weighed and not chosen: it is a change to the SQL that fills every line, for a problem the lines alone
can avoid. In `ruleSet`, `{rule}` is "Rule 3: ..." and may open a sentence.

A test reads every prompt text and line the instance hands the engine (the three premises, the answer rules, every
persona's prompt in every office, every stock line, the announcements title) and refuses "the System", "robo-McMahon"
and "toybox". The engine's own comments and the out-of-character glass still say The System, which is right: that is
the engine's word for the machine, and the glass speaks plainly.

## 3. The two personas (findings 2, 7 and 10)

**Decided (the owner):** no major tone changes. ONTOPIC 5.0 and QC-1000 are adjusted where their habits read as a
checklist, and ONTOPIC 5.0 feels free to give 5/5 for true nonsense.

- **QC-1000** said "queue position 998" in 34 of 35 posts and nearly always asked "demo or full game?" and declined
  because "a version already exists". His habits each became a rule for every post. Each is rewritten as occasional or
  conditional ("now and then", "when the board really has seen an idea before", "when a post promises more than it
  delivers"), and a new habit says a post uses one or two of them, never all, and rarely the same as the last. His
  temperament, voice, quiz and numbers are as the draft wrote them.
- **ONTOPIC 5.0** gave one 4/5 and otherwise at most 3/5. Her voice gains "Your ratings use the whole scale", her
  Palace habit becomes five stars given gladly to perfect nonsense, and her temperament says she never charges a
  Palace post for being pointless. Her format (star rating, headline, the compliment sandwich) is her bit and stays.
- **Finding 10.** Her quiz had four questions where a Mod Bot's needs five: a fifth is added ("A post on the Pointless
  Post Palace makes an excellent point. How many stars?", answer "One"). Her `persuadedBy` and `temperament` said "who
  started it" and "what it did less well", which the it/its guard cannot tell from a persona calling itself "it": they
  say "who started the quarrel" and "what the post did less well". The guard stays as strict as it is. The quiz test,
  which read only the first Mod Bot on staff, reads every one.

Every string in both files is a draft for the owner's approval in the PR's review, as the launch plan said.

## 4. Judging the Pointless Post Palace (finding 7)

On day 7 a patrol charged "premise" against a post on the Palace, and the filing argued against its own charge
("Pointless is what we asked for; I simply cannot award it five stars"). QC-1000 did the same on Arts & Crafts ("a
gentle decline of the charge", filed anyway). Two causes: the judging prompts never say what a premise charge is for,
and a filing is told only "it is charged with", so a Mod that disagrees has nowhere to put it but the line.

**Decided (the owner):** the engine's patrol, report and filing prompts say that a premise charge is for a post that
does not do what its board asks, however odd the ask, so a post that does what its board asks (nonsense on a board that
asks for nonsense) is never charged under its premise. A filing is told the charge stands, decided when the post was
charged, and that its line says why the post broke it. A visit that ends cleared, with no infraction, was weighed and
left for a design of its own if it is wanted: it is a new outcome for a visit, with its own log line and Aura.

## 5. Succession (finding 5)

FanGaME nominated QC-1000 on five days running, each a new move posted in the announcements. The meeting never told
him whom he had named, and the moves turn asks "answer moves, inherited and successor" at every meeting, so both Bosses
also answered `inherited` every day with made-up ids (dropped, as `isUuid`, and trimmed at 64 characters on the way).

**Decided (the owner):** the current Boss chooses the successor, and one nomination stands. Each meeting in the last
week is told whom the Boss named and when; it stands unless the Boss names someone else, and naming the same persona
again is dropped and recorded (`newNominee`). The moves turn asks for `inherited` only when moves are inherited,
and for `successor` only in the last week. A Boss can change its mind, which is drama; it cannot repeat itself.
Weighed: one nomination per season, final; leaving it.

Not in scope, and wanted: arcs for the Bosses after FanGaME (the owner: not a launch blocker; a follow-up).

## 6. A move that outlives its Boss (finding 6)

On day 91, with QC-1000 in the chair, FanGaME's merge of Movies & TV into World -1 landed under his name. Under the
launch clock this happens every season: the settlement is at 10:00 and the meeting at 11:00, so the last meeting before
the season ends is about 23 hours before it, and a move that waits `structuralHoldHours` (24) in the admin queue lands
about an hour after the handover. A board move is never inherited (the new Boss inherits the landscape), so the new
Boss could not review it.

**Decided (the owner):** the handover withdraws the outgoing Boss's moves still waiting. They are refused for good with
the reason "its Boss left the chair before it landed", which the admin queue shows; nothing posts. Mod Bots' own queued
moves are left alone, since Mods stay on staff. A Boss in its last day is told that a move that would land after the
season ends never lands, and the meeting drops such a move, a composed bundle, and a nomination, recording
`landsBeforeSeasonEnd`, so a paid answer is not queued only to be withdrawn. The meeting reads the season's scheduled
end, the same one the farewell window reads; a settlement that runs late leaves a little time in which a dropped move
could have landed, and that is accepted, since the handover is the guarantee and the drop is the courtesy. Weighed:
letting the move land as a parting shot (today's behavior), and landing it for the new Boss to keep or end (board moves
would become reviewable).

On day 90 a second "everything" merge failed because its board was already closed: the meeting queued a free move
repeating the beat's own bundle, and the tick refused the second for good with that reason. That is the guard working,
in the admin queue only; nothing here changes it.

## 7. The bounds (finding 8)

`profile.mood` was trimmed at 80 characters in 27 of 35 meetings, often mid-word, and `memory.hobby.name` (80) and
`profile.interests` (40) were trimmed too. The meeting's prompt never states those bounds. One ONTOPIC 5.0 chatter
answer was cut off at its 1,500-token cap on day 77, and another on day 6 of the honeymoon run. The chatter prompt
tells the model a post may be `postMaxLength` (20,000) characters, while the call's cap holds about 5,000.

**Decided (the owner):**

- The meeting's prompt states the bounds it is held to: mood (a short phrase, at most 80), interests (40 each), a
  hobby's name (80), a mark (120). The 80 stays (weighed: raising mood to 120).
- `repair` cuts a string over its bound at the last space within it, where that keeps at least half the bound, and at
  the bound otherwise, dropping a trailing comma, semicolon, colon or dash. The trim is recorded as before. This is the
  generic cut, so every string bound cuts at a word.
- Chatter asks for at most 2,000 characters (`CHATTER_WORDS_MOST`) and cuts longer words at a sentence, as it already
  does at `postMaxLength`. The call's cap is derived from that number in one place (`CHATTER_TOKENS`), and a test holds
  that the cap holds the stated length with room for the rest of the answer. The rehearsal's record kept no cut
  answer, so the length the prompt invited is the cause the code shows, not one the record proves; if a cut recurs, the
  ledger row's output tokens say whether it was length.

## 8. The rehearsal's filler (finding 9)

Every filler regular had it/its pronouns, because the corpus sketches set none and `it` is the engine's fallback; the
staff called members "it". And the filler only starts threads on boards the corpus has openers for, so a board the
Boss creates stays empty and FanGaME's fangame board was empty in every run.

**Decided (the owner):** each of the 30 regulars gets pronouns, he, she or they (11, 10 and 9), matching the voices that
already say "he", and a test refuses a sketch without them. The filler's world carries the open boards, and it starts
threads on any of them: a board with openers of its own draws from those, and any other from a small set of general
openers that name the board. A reply line's `{board}` names the board, where it filled the slug before.

## 9. The layers

- **Engine:** the judging prompts (`engine/system/judgment.ts`), the word cut (`engine/system/validate.ts`), the
  meeting's stated bounds, ask, nomination and season-end drop (`engine/system/meeting.ts`), chatter's length and cap
  (`engine/system/chatter.ts`), the filler's boards (`engine/rehearsal/`). None names an instance.
- **SQL:** `hand_over` withdraws the outgoing Boss's waiting moves; `meeting_context` carries the standing nomination.
- **Edge Functions:** `supabase/functions/meet/core.ts` passes the nomination, the season's end and the ask;
  `supabase/functions/chatter/core.ts` takes its cap from the engine.
- **Divided World:** the premises, the stock lines, the announcements title, the two persona files, the corpus. Each
  reaches the engine through `SystemContent` and `RehearsalContent` as today; no interface is added.
- **Tools:** the rehearsal's `readWorld` reads the open boards.

## 10. The masks, ways out and scale

- **Masks.** The nomination a meeting is shown is the Boss's own move, a public Act. The withdrawal reads only the
  outgoing Boss's queue. Nothing here reads an owner, a class or a reaction.
- **Ways out.** No state is added for a player, a character or a post. A withdrawn move holds nobody; a withdrawn
  nomination leaves the handover to the rotation, as a failed one does today.
- **Scale.** The withdrawal touches the waiting rows of one staff member (the queue's due index covers the waiting
  rows). The nomination read is one staff member's `nameSuccessor` rows, a handful a season, from a table that grows by
  a few rows a day. The filler's board read is the boards, a few dozen rows. Nothing grows with players or Acts.

## 11. Open

- Arcs for the Bosses after FanGaME: wanted by the owner, not a launch blocker, a follow-up.
- A visit that ends cleared, with no infraction: weighed in section 4 and not taken up.
