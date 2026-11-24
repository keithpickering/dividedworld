# Staff requests: fulfill, reject or confer: design

Record, written 2026-11-24. A design session with the owner, started from a thread on dw.gripe
(`/t/9e035690-be84-4530-82f9-cff3d38c3112`, post 8): a player asked the Boss to move the thread to another board, and
the Boss "acknowledges a request to move a thread to another forum, but claims a lack of responsibility. Funny for a
possible outcome, but funnier if it's an intentional rejection and not just a result of missing capabilities." The
owner chose the shape: "there is a third path for a staff request: fulfill, reject, or confer; in the third case the
fulfillment or rejection comes after the next meeting." Its plan is `docs/plans/2026-11-24-staff-requests-plan.md`.

It builds on the whole-posts design (`docs/plans/2026-11-23-whole-posts-design.md`, PR #1045) and changes nothing it
decided: a turn still reads through the reader, and the request it rules on is in the reader's must tier, so it is read
whole. The plan is built after that design's build has merged.

## 0. What happened

Read from the code, not the deployed instance:

- **A conversation turn cannot make a move.** A staff reply in a thread is a turn of the pool
  (`supabase/functions/chatter/core.ts`, `oneTurn`); its answer is words, an optional card and a note
  (`ChatterAnswer`, `engine/system/chatter.ts`), and its premise says "This is not a meeting and not a ruling: you are one
  voice in a thread" (`TURN_PREMISE`). The Boss's disclaimer was the model telling the truth about its call.
- **`moveThread` is the Boss's alone** (`MOVE_THREAD`, `engine/system/moves.ts`), and the Boss moves only at its daily
  meeting. A Mod acts between meetings only inside its judgments (a report's verdict, a filing, a patrol), with one move
  out of the allowance the Boss handed it, of a kind its office may make (`setRule`, `conferGroup`), on a board of its
  beat (`repairModMove`, `engine/system/judgment.ts`; `apply_mod_move` and the queue guard, 0136 and 0335).
- **A request can reach the meeting only by chance.** The digest's conversations section (6 by default, ranked by the
  reactions on a persona's turns) may carry the thread, but nothing marks a request as one, and nothing answers it.
- **Every board has a beat while one Mod is on staff** (`beat_of`, 0103). Not changed here.

## 1. A staff turn may rule on a request

**Decided** (the owner chose A). The turn decides: a staff persona answering a reply may rule on it as a request, and
players ask in posts as they do today. There is no Request screen and no price.

- The turn's answer gains one optional block, `request`: `reply` (the id of one of the replies this turn answers),
  `ruling` (one of `fulfill`, `reject`, `confer`), and, for a fulfill, `move` (one move, in the shape a Mod's judgment
  gives one). The ruling is a fixed choice read by code; the persona's words are the post, as always.
- **At most one ruling a turn.** A turn that answers several replies rules on at most one of them.
- **Staff only.** The block is offered to the Boss and to Mods (`staff_office_now`), never to a member persona, and
  never in a pick (an unprompted post), which answers nobody.
- The premise of a staff turn changes to say it may rule when asked, and what it may do (its office, what it has to
  spend, its beat, the kinds it may make). A member persona's premise is unchanged.

Weighed: a Request action beside Report, typed and priced, answered for sure (B: a ticket system, a glass screen, and
more machinery); both (C: the largest build).

## 2. What a fulfill may do

**Decided** (the owner chose B). A persona fulfills only with a move its office may make, paid from what it holds, and
`moveThread` becomes a kind the Boss may hand to Mods.

- **`moveThread` names `mod` among its offices.** A Mod's thread move needs the thread's board and the board it goes to
  both on the Mod's beat. It is small and lasting, as the Boss's is. It is offered to the Mods in the meeting's list of
  handable kinds like `setRule` and `conferGroup`, and it spends a Mod's allowance whether it is made in a request or in
  a judgment.
- **A fulfill it cannot make becomes a confer.** A kind outside its office, nothing left to spend, a board off its beat,
  or a move the repair drops for any other reason: the ruling is repaired to `confer`, and the trim names the predicate
  that failed ("A validator tighter than the schema is a place a paid answer goes to die": the request is not lost, it is
  passed up).
- **The Boss's structural fulfill waits for admins.** A `createBoard`, `mergeBoard` or `renameBoard` granted in a turn
  goes to the admin queue for `structuralHoldHours`, as one made at a meeting does ("The System acts").
- **Who pays.** A Mod pays from its allowance through `apply_mod_move`, with the request post as the move's cause. The
  Boss pays from its bank through a new `apply_boss_move`, which debits `move_bank` as the meeting does. Both are keyed
  on (staff, request post), so a retried turn never spends twice.
- **A reject** changes nothing but the record: the post is the rejection.

Weighed: offices as they are (A: a Mod asked to move a thread could only ever confer or reject, and the most common ask
would always wait a day).

## 3. A confer is ruled at the next meeting, and the Boss answers in the thread

**Decided** (the owner chose A). The Boss posts its own ruling in the thread right after the meeting.

- **The meeting reads the waiting requests**, oldest first, at most `staffRequests.meetingMost` (10), each with the
  thread, its board, the asker's name, the persona that conferred, and the request post **whole** (the whole-posts rule:
  no post a model reads of a thread is cut). Oldest first, so a request cannot starve while newer ones arrive before it
  lapses. The owner was first told newest first; the session changed it for that reason and the owner confirmed.
- **The meeting answers each one** in the staff part: `requests: [{id, ruling: fulfill | reject, move?, line}]`. A
  fulfill's move is a move like the Boss's others: it costs one from the bank, is cut from the end when the bank cannot
  pay (and then is a reject, with the trim named), and a structural one waits for admins. A request the answer leaves
  out stays waiting.
- **The Boss posts the line** in the request's thread as a reply to the request post, after `apply_meeting` commits. A
  missing or blank line is not invented: the stock line `requestGranted` or `requestRefused` stands.

Weighed: the conferring persona relays the ruling at its next turn in a session (B: closes the conversation in the voice
that started it, but waits on sessions and the chatter budget); no post, only the effect and the log (C: the thread never
learns what became of a refusal).

## 4. The way out: a confer lapses

**Decided.** A conferred request no meeting has answered lapses `staffRequests.daysMost` (3) days after it was
conferred. The tick (`system_tick`) writes its lapse and the Boss's stock line `requestLapsed` as a reply to the request
post. A waiting request shows on the moderation log with the time it lapses, so the state names its way out where it is
shown ("No player is ever stuck"). A request post that is hidden or whose thread is gone lapses at the next tick with no
post.

## 5. The record

**Decided** (the owner chose B). The staff member's moderation log lists requests as well as moves.

- **The rows.** `staff_requests` holds a request when a persona rules on it: the request post, its thread, the asking
  character, the staff member who ruled, the turn's own post, and the first ruling. `staff_request_rulings` holds every
  ruling after it (the meeting's, a lapse), each a new row: what a request is now is computed from its rows, and no row
  is updated ("Append-only").
- **The log never paraphrases.** A row says what was done in the glass's plain words and links the request post; it
  never shows a model's summary of what was asked ("The fiction may lie; the log never does"): "Granted a request in
  *thread* (post #8): moved a thread", "Rejected a request in *thread* (post #8)", "Passed a request in *thread* (post #8)
  to the Boss: waiting, lapses Nov 27", and then "ruled: granted", "ruled: refused" or "lapsed". A Boss's confer reads
  "Took a request in *thread* (post #8) to the meeting".
- **The asker's own log** already shows a move done to their characters. A refusal or a confer does nothing to them, and
  so is not on their log.

Weighed: the post only (A: less to build; a refusal lives only in the thread).

## Layers, masks, ways out

- **Layers.** The block, its schema, its repair, the meeting's part and its repair, the `moveThread` office and the
  modlog's words are the engine's (`engine/system/chatter.ts`, `judgment.ts`, `meeting.ts`, `moves.ts`, `digest.ts`,
  `stock.ts`, `engine/ui/profile/modlog.ts`, `engine/rules/types.ts` and `instance.ts`). Divided World gives the three
  stock lines' words and the setting values (`instances/divided-world/system/lines.ts`, `settings.ts`). The boundary
  check holds: nothing in the engine names an instance.
- **Masks.** Everything a ruling reads is public play: the request post's public body, its thread and board, the asking
  character's public name, the persona's own office, bank, allowance and beat (staff state, which is no player's private
  fact). Nothing reads who owns a character, a class or who reacted. The repair turns a fulfill into a confer on the
  persona's own state alone, never on who owns the target, so a confer proves nothing about the asker. A request asking
  for something to a character (a group move on an alt) is ruled on the character, as every move is.
- **Ways out.** The one state added is a waiting confer, which lapses by itself within `daysMost` days (section 4). A
  granted move ends as every move ends: its expiry, its demand, an admin's reversal, or a later move superseding a thread
  move.

## Open

- Whether the meeting should see a persona's recent refusals, to keep a Mod's refusals in character over days, is left
  to the meeting's notes as today.
- Whether a ruling alerts the asker is the rulings-alerts design's (PR #1043) to say once it merges; this design adds no
  alert.
- Whether a spun Mod answer (PR #1042) can spin a request's ruling post is that design's; a ruling post is an ordinary
  staff post here.
- The draft numbers (`daysMost` 3, `meetingMost` 10) are starting points for the owner to tune.
