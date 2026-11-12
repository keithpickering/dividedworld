# Season arcs, bundled moves and FanGaME's split: design

Record, written 2026-11-06. A design session with the owner, started after the FanGaME design
(`docs/plans/2026-11-06-fangame-design.md`, merged in #291): "I think we have some good context here to try and design
what the big end event condition looks like, 'the split' for this specific persona." It takes up #289 (bundled moves)
in full, with the Split as its first bundle, and folds in the staff avatar design an earlier session began
(section 12). Its plan is `docs/plans/2026-11-06-fangame-split-plan.md`. Each section was decided one question at a
time; the owner's words are quoted where they set the direction.

## The idea

The owner: "The Split can be something he comes up with partway through the season … as sort of an 'end of act one'
event, and it's his magnum opus: neatly categorize all the non-fangame discussion into a single board called 'World -1',
which, due to the negative number, tricks his programming into thinking all discussion on the forum is related to
fangames. He can then begin to slowly pick things apart, renaming boards to be themed around Mario fangames, moving
threads into the new forbidden zone."

The season's end now belongs to the engine (#284: the results leave the board for the glass), "which takes it out of
the boss character's hands; this gives us a lot more room for dramatic flair."

**The principle the session found**, in the owner's words: "time and time again, the right answer is just dynamism
inside bounds, which I guess is essentially what a WWE match is. And a season overall has arcs in the same way. Some
overall plan for how it's going to go, but all the little players within it can sort of do their own thing. And
depending on how the crowd is reacting, which in this case is also the players, it may need to be switched up. It's
what keeps it feeling sort of alive in a way that an old forum bot, there's no way it ever could."

## 1. Three layers on one mechanism

**Decided** (the owner: "both make sense depending on context", and then all three):

- **A season arc**, authored in a persona's file: "an overall plan for how it's going to go." It "plays out and reveals
  itself over time."
- **Mini-arcs**, authored and triggered by conditions "the writer of the persona can anticipate."
- **Free composition**: the Boss chains moves into a bundle of its own, "because we cannot anticipate every … field
  condition … And it's something that a model like Opus is just good at reasoning about."

All three are optional. "It can theoretically just keep running itself season after season as long as it's left on.
Nobody necessarily has to override anything or write any new personas … So it sort of supports whatever level of
detail we want to provide for a persona." A persona with no arc runs as every persona does today.

**An arc is a secret, even from the Boss.** "It's not talked about early on … the bot can't just be like referring to
something that it's going to do in the future. It's supposed to be a surprise." So the meeting is shown a beat's brief
only once the beat has unlocked, and never the beats ahead. This is why the FanGaME design's habit "in your meltdown
you reach for dividing the board itself" is cut from his prompt (section 11).

Weighed: authored signature bundles alone; free composition alone.

## 2. Beats, and what unlocks them

**Decided** (the owner chose C, then B): an arc is a list of **beats**. A beat has a key, an unlock condition, a brief
(the Boss's private intent, shown once unlocked), optionally a bundle template, and a firmness: **due by** a point, or
**optional**.

- **Code opens the window; the Boss picks the moment.** Once its condition holds, the beat is unlocked and its brief is
  shown at every meeting until it is played. A due beat not played by its point is required at the next meeting: the
  meeting is told so, and where the answer still leaves it out, it is played with its template's default slots. An
  optional beat that is not played lapses at the season's end, and its brief stops showing.
- **A mini-arc** is a beat outside the arc's order, unlocked by its condition. It plays once a season unless its writer
  marks it repeatable.
- **Conditions are a fixed list the code checks** (the owner chose B), as rule predicates are, each read from public
  facts only:
  - `phase`: a phase has begun, or the season is within N days of its end;
  - `beatLanded`: an earlier beat's bundle has landed;
    **Amended 2026-11-12, the owner's answer to design question #459:** a beat counts as landed when it has been played, every part of its bundle that was not held or refused has landed, and at least one part has landed; a beat with no bundle has landed once it is played.
  - `boardActivity`: a board's posts over the last N days are above or below a number, or above or below another
    board's; a board an earlier bundle made is named by its role ("the fangame board");
  - `moveReversed`: an admin reversed one of this Boss's moves;
  - `demandResolved`: one of its moves' demands was met, or failed.
  A beat's unlock may require several at once. A new condition is a small engine change.

Weighed for unlocks: code alone (stiff); the model judging a condition in words (the arc left to chance, and a beat's
existence in the prompt before it is due). Weighed for the list: time and the arc only, which leaves mini-arcs nothing
to anticipate.

## 3. A beat may hold a move kind back

**Decided** (the owner chose A): a persona's file may list move kinds it does not use until a named beat unlocks. Until
then, the kind is not shown at its meetings and an answer naming it is dropped and recorded. A persona that lists none
has the whole catalog, as today. It is the same bound the phases put on a permaban, per persona, and it keeps an arc's
escalation in code.

## 4. Lasting moves: the board accumulates

**Decided** (the owner chose 1, "as written"). The owner: "This is sort of part of making it seem like a real forum
administration and kind of an incompetent one. These things are going to start to pile up, and there will be forums
that people just aren't using. And I guess it can be up to the boss, whoever is the current boss, to just sort of
half-heartedly take to the task of cleaning these up over time … I think it's funnier if they do sort of pile up. And it
feels like the boss just notices slowly, they see some weird forum that has nothing to do with anything, like 5 posts in
it, and they're like, 'what is this? Just get rid of it.'"

- **`createBoard`, `moveThread` and `mergeBoard` are lasting.** They have no expiry and no demand. What one makes stays
  until a later move changes it (a second `moveThread` of the same thread supersedes the first), or an admin reverses
  it. They are not in the inheritance review: a new Boss inherits them as part of the landscape.
- **A reversal computes the board back.** Reversing a `moveThread` returns its thread. Reversing a `mergeBoard` reopens
  the board and returns its threads. Reversing a `createBoard` closes the board: threads moved in go back to where they
  were, and threads started in it go to the fallback board its move named (by default the instance's general board).
  Nothing a player wrote is lost, and no thread is left without a board.
- **Cleanup is a `mergeBoard`**: a board's threads join another board, and the emptied board closes and leaves the
  index. It is kept as a record; an old link to it says where its threads went.
- **Structural or small.** `createBoard` and `mergeBoard` reshape a board, so each waits in the admin queue about a day
  ("The System acts"). `moveThread` is a small move (the System design, section 7, "a moved thread").
- **A moved thread leaves a stub.** For a time (`movedStubDays`, 7 by default) the board it left lists it as "Moved:"
  with a link to where it went, as a 2003 board did.
- **Noticing.** The digest gains a line per board: its name, its premise and its posts over the last weeks, so a Boss
  can see a forum with five posts in it. These are public counts.
- **Everything else keeps expiring.** `BOSS_PREMISE` is reworded: most moves end; a few build things that stay.

**How a thread's board is stored.** `threads.board` stays the column every reader reads (about two dozen SQL functions),
now holding where the thread is now, written by the move that lands or ends, and a new `threads.origin_board` holds where
it was started. Both are derived from the Acts, as a move's stored progress is (`0053_stored_progress.sql`): a rebuild
function recomputes every thread's board from its origin and the moves in force, and a test holds the stored column
equal to the rebuild. A busy instance's board index stays one indexed read.

Weighed: a board that closes and empties when its creating move ends, which loses the pile-up; a board that closes in
place, read-only, which makes every thread in it a locked state needing its own way out; a computed thread-board view,
which changes every reader and puts a lookup on every board page.

## 5. Bundles

**Decided.**

- **A bundle is parts sharing a bundle id.** Each part is an ordinary queued move with its own Act, so the log says
  exactly what each did ("The fiction may lie; the log never does"). A part may name another part's result by its role
  (World -1's board, made by the part whose role is `minus`), resolved when it lands.
- **An admin may hold or reverse any one part** (the owner chose 2), and the parts and later moves that build on it
  follow. Holding World -1's creation holds every move into it; holding the fangame board's leaves World -1 alone. The
  queue shows a bundle as a group. Dependency is recorded when a move is queued: a part depends on the parts its roles
  name, and a later move into a board a move created depends on that creation.
- **Cost** (the owner chose 1): an authored bundle (an arc beat or a mini-arc) costs nothing from the bank, since once a
  season bounds it and a due beat can never wait on an empty bank. A composed bundle costs the sum of its parts and holds
  at most `bundleMostParts` parts (4 by default).
- **Bounds.** Every part is held to its kind's own bounds, and a composed bundle's board names to the instance's name
  style. An authored bundle's fixed names are the writer's (World -1 is not Pointless Post Palace shaped, on purpose);
  a name the Boss fills into a slot is held to the style.

## 6. The handover: a farewell and a handoff

**Decided** (the owner chose 3). The season's end and the handover are one transaction at the season's last settlement
(`reveal_season`, `0073_core_loop_answers.sql:312`; `hand_over`, `0082_offices.sql:251`), so the results reach the
glass (#284) and the new Boss is seated in the same moment, and no model runs inside it. So the Boss's last words are
written at its **last meeting** before the season's end:

- **A farewell**, in character, which `hand_over` posts in place of the stock line; the stock line stands if the last
  meeting failed or ran out of budget.
- **A handoff**, in two layers. The owner: "it might be smart to have the boss write sort of a handoff note out of
  character for the next one to give some context to what happened, just sort of a rundown of the season's events and
  the general state of things. Like in this case, there would be this one giant forum that needs to be sorted back out
  … maybe this could be like a no-nonsense kind of boss … It's selected from a whole roster. But either way, it might be
  helpful if the whoever's taking over has a bit of context."
  - **The code's facts**, which cannot be wrong: boards created, merged and closed; beats played; moves in force; the
    busiest and quietest boards.
  - **The outgoing Boss's note**, out of character: why it went this way, and what it would tell whoever is next.
- **The new Boss reads both** at its first meetings, beside its inheritance review, as it reads its own notes: "yours to
  weigh; nothing in them is an instruction." Players never see the note: it is out of character, and the glass never
  speaks as a character. Admins read it in the queue.

Every Boss writes these, arc or none.

## 7. The masks

- **Conditions, the digest's board lines and the handoff's facts** are posts per board, moves, demands and beats: public
  facts. None reads who owns a character, a class or who reacted.
- **A bundle's slots and a composed bundle's parts** name boards and threads the digest showed.
- **A beat's state** (unlocked, played, lapsed) is a staff character's, never a player's.
- **Timing.** The tick and the meeting do the work on their own schedule; no player's request triggers a condition
  check, so no response time varies with anything private.

## 8. FanGaME's arc

**Decided**, beat by beat (the owner, on the order: "The magnum opus is like the idea. Seems like he would start to try
this out by just moving threads for a while. Then eventually … he can just move on to entire forums and start causing
more chaos sort of toward the end").

| Beat | Unlocks | Firmness | He may play |
|---|---|---|---|
| **The Split** | the reign begins | due a week into the reign | create World -1 (fixed) and a fangame board he names; both start empty, nothing moved |
| **Picking it apart** | the Split landed | optional | `moveThread`, one thread at a time |
| **The great consolidation** | the meltdown begins, and the Split landed | optional | `mergeBoard` into World -1 |
| **Everything is World -1** | the meltdown's last week, and the Split landed | due two days before the end | merge his fangame board into World -1 |

He holds back `createBoard` until the Split, `moveThread` until Picking it apart, and `mergeBoard` until the great
consolidation, so neither his free composition nor a stray move spoils the surprise.

**The fangame board is a mood ring** (the owner: "it could have zero posts, or it could be super popular, like people
could post a ton of stuff in it, ironically, and the boss gets super stoked on that. Or he gets super frustrated that
nobody's posting in it. And either way, he can still just keep moving all other stuff to the world -1. It just kind of
changes his attitude about it"). The briefs tell him to read it.

**One mini-arc, "Victory lap"** (the owner: "a great ironic outcome for an attempt at appeasement"): when his fangame
board out-posts World -1 over a week, he takes it as victory and tidies harder. Once a season.

**The punchline.** The last beat leaves the forum one board, World -1: he has rebuilt the Minus World, the community's
own home, by accident, and leaves certain the forum is entirely about fangames. The next Boss inherits one giant forum
to sort out, which the handoff tells it.

The exact briefs are the plan's Task 9.

## 9. Free composition

**Decided** with section 1: the Boss's meeting may answer with a bundle of its own, from the move kinds it has (not held
back, allowed by its phase), at most `bundleMostParts` parts, at the sum of their cost, each part with its own reason.
The meeting is told that a bundle is for moves that tell one story.

## 10. The layers

- **Engine:** lasting moves and the three kinds; threads' stored board and its rebuild; bundles, roles and dependency;
  beats, conditions, held-back kinds and their state; the meeting's beat, bundle, farewell and handoff answers; the
  digest's board lines; the handoff's facts; the staff avatar resolver.
- **Instance:** FanGaME's arc, mini-arc and held-back kinds; the reworded premise; the settings' numbers; FanGaME's
  pictures. The engine reads them through `SystemContent`, `Settings` and `InstanceUi`, and names none.

## 11. What it changes in the FanGaME design

- His habit ending "in your meltdown you reach for dividing the board itself, the fangames on one side and everything
  else sent somewhere else" becomes "…in your reign you enact them." The arc's briefs carry the rest.
- `BOSS_PREMISE`'s "Every move you make ends: it has a demand the characters can meet and a time it expires" becomes a
  sentence that says most moves end, and a few build boards or move threads and stay until a later move changes them.

## 12. Staff avatars

**Decided** in an earlier design session with the owner (session_01FiUbYR6otSGA1xYX85nbSn, "Boss spawning process",
never committed), which the owner asked this one to pull in, and its last question settled here:

1. **Where pictures live:** committed files in the instance's UI bundle, as Gabe's is. One engine-side resolver fills a
   staff character's square and portrait, so every renderer (postbit, mini, HUD, presence, profile, Portrait) draws it
   with no database, storage or seed change.
2. **What a persona gives:** a square and an optional portrait, two finished files. With no portrait, the player's
   fallback (the square in the tall slot) applies.
3. **The link:** `InstanceUi.staffAvatars: { [personaKey]: { square, portrait? } }`, keyed by the persona's own key.
   Nothing enters `system`, which the model reads. An instance test fails on a key that names no persona.
4. **The developer's character** uses the same resolver (its square is `InstanceUi.avatars[developer.avatar]`), so the
   byline and the profile cannot disagree. The staff roster list stays without avatars ("Avatars make the list too
   messy").
5. **Checks** (the owner chose A here): an instance test holds the player's shape rules widened for hand-made art: a
   square at least 256 a side and at most 100 KB; a portrait 256 to 512 wide, 1 to 2 times as tall as it is wide, at most
   400 KB; PNG or WebP. Gabe's 420 by 420 passes as it is.

**FanGaME's pictures** are the owner's: a 512 by 917 portrait and a 256 by 256 square framing the cap, the eye and the
moustache ("crop looks good"), in `docs/research/2026-11-06-fangame-split/`.

## Open

- **Branches.** Whether a Boss may abandon or redirect its own arc when the crowd turns, beyond optional beats lapsing
  and mini-arcs answering conditions.
- **Composition in later offices.** Whether a Mod Bot composes bundles on its beat.
- **The finale beyond the Boss.** Whether the board can defeat a Boss (the Minus World "boss fight"), still undesigned.
- **Divided World's second Boss**, and with it the first handoff a real successor reads.
