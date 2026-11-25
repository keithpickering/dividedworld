# An arc beat announces itself: plan

Record, written 2026-11-25. Carries out `docs/plans/2026-11-25-arc-announcements-design.md`; read it first, and
CLAUDE.md.

**Before Task 1.** This plan is built after `docs/plans/2026-11-24-staff-board-threads-plan.md` (staff threads,
`open_staff_thread`, move threads in `system_tick`, the minutes) and `docs/plans/2026-11-25-persona-lines-plan.md` (the
landing line written ahead) have merged; it uses what they add, by the names those plans give. The other file and
function names below are main's as of 149e8dd. Each migration is the next free number at build time, named for its task;
its SQL tests are `supabase/tests/NNNN-<slug>.sql`, in the style of `supabase/tests/0186-arcs.sql` and
`supabase/tests/0188-handoffs.sql` (`pg_temp.expect`, `pg_temp.refusal`). A function re-created in a migration is copied
from its latest definition on main at build time, never an older one, keeping this plan's decisions.

## The words this plan uses

- **An announced beat:** a beat whose file carries an `announce` block. **Its announcement:** the post the Boss writes in
  a new staff thread at the meeting that plays it. **Its thread:** that staff thread.
- **A staff pin:** a staff thread shown first on the staff board under "Sticky:" while the season it was pinned in is
  open and no admin has unpinned it.
- **A lead-in:** a beat's `leadIn` block: conditions, a brief for the meeting and a mood line for the Boss's pool calls,
  live while its conditions hold and the beat has no event.
- **An aftermath beat:** a beat in a persona's `aftermath`, played by whoever succeeds it as Boss. Its events are
  recorded under the successor's staff key with the beat key `after:<predecessor key>:<beat key>`.
- **The predecessor:** for the current Boss, the outgoing Boss of the handover that seated it (`season_handovers`,
  0051), in the season that Boss served.
- **The recap:** the outgoing Boss's in-character line on its season, at most 300 characters.
- **The plot so far:** the section in staff pool calls and the Boss's meetings that lists last season's recap (for a
  honeymoon's length after a handover) and the season's announced initiatives (title, pitch, thread).

## Task 1. The persona file's new fields, and their checks (engine)

Model: sonnet

**Files:** `engine/rules/types.ts` (`Beat`, `Persona`, the condition types), `engine/system/conditions.ts`
(`conditionProblem`, `dueProblem`'s neighbour for refs), `engine/rules/instance.ts` (`arcProblems`), tests in
`engine/system/conditions.test.ts` and `engine/rules/instance.test.ts`.

- **`Beat.announce?`**: `{ titleHint: string; defaultTitle: string; defaultBody: string; defaultPitch: string; push: string }`.
- **`Beat.leadIn?`**: `{ unlock: readonly Condition[]; brief: string; mood: string }`.
- **`Persona.aftermath?`**: `readonly Beat[]`, beats a successor plays. Never `due`, never `repeatable`.
- **Engine constants** (exported from `engine/system/beats.ts`): `ANNOUNCE_MOST = 2000`, `PITCH_MOST = 200`,
  `RECAP_MOST = 300`, `PUSH_MOST = 300`, `MOOD_MOST = 300`, `LEAD_IN_BRIEF_MOST = 1000`.
- **Conditions:** `phase` takes `daysIntoPhase` (whole, 0 to `DAYS_BEFORE_END_MOST`), only with `phase`, never with
  `daysBeforeEnd` in the same condition. `beatLanded` takes `of?: 'predecessor'` and `not?: true`. A board ref `{role, beat}` takes
  `of?: 'predecessor'` (`isBoardTarget`). The catalog's plain words in `CONDITIONS` say so.
- **`arcProblems`** adds, each naming its predicate:
  - an `announce` with a blank field, a `defaultTitle` over `titleMaxLength` (`atMost`), a `defaultBody` over
    `ANNOUNCE_MOST`, a `defaultPitch` over `PITCH_MOST`, a `push` over `PUSH_MOST`;
  - a `leadIn` with no condition (`nonEmpty`), a blank or over-long brief or mood, or a condition `conditionProblem`
    refuses;
  - `of: 'predecessor'` anywhere outside `aftermath` (`aftermathOnly`);
  - in `aftermath`, a `beatLanded` or ref with `of: 'predecessor'` naming no beat of this persona's own `arc` or
    `miniArcs` (`beatOfPersona`), and a ref's role that beat's bundle never makes (`roleOfBeat`);
  - an aftermath beat with `due` (`noDueOnAftermath`) or `repeatable` (`miniArcOnly`);
  - a beat's `unlock`, or a lead-in's, whose every condition is a `beatLanded` with `not` (`notAllNegated`): it would
    hold from the season's first day;
  - `not` with any value but `true` (`isTrue`);
  - the beat count bound (`ARC_BEATS_MOST`) counts aftermath beats with the rest.

**Tests first**, each red before the change: `conditionProblem` accepts `{kind:'phase', phase:'honeymoon',
daysIntoPhase:7}` and refuses it with `daysBeforeEnd`, with no `phase`, and with 99; `instanceProblems` on a fixture
persona planted with each defect above names its predicate; the Divided World instance passes. The poisons are the
planted fixtures; each check is driven red by one before it is trusted.

## Task 2. Lead-ins, aftermath and the new conditions in SQL

Model: sonnet

**Files:** migration `NNNN_arc_lead_ins_aftermath.sql`; test `supabase/tests/NNNN-arc-lead-ins-aftermath.sql`; updates
to `supabase/tests/0186-arcs.sql`; `supabase/functions/_shared/seed.ts`.

- **`persona_arcs`** (0332) gains `lead_ins jsonb not null default '{}'` (`{beatKey: unlock}`) and
  `aftermath jsonb not null default '[]'` (the aftermath beats as the arc's beats are stored: key, unlock; never a brief).
  `seed_instance` (latest at build) writes both from the roster; `seed.ts` sends them.
- **`arc_predecessor(in_staff text, in_season bigint) returns table (staff text, season bigint)`**: the latest
  `season_handovers` row whose `boss` is `in_staff` and whose season is at or before `in_season`, its `outgoing` and the
  season it served (the season before for a roll-over, the same season for a departure, as `say_farewell` in 0403
  reads it). No row: none.
- **`beat_condition_holds`** (latest 0333): `phase` with `daysIntoPhase` holds once that many days of the phase have
  passed (`arc_season_span`'s phase start); `beatLanded` with `of = 'predecessor'` reads the predecessor's beat in its
  season, with the same landed rule (the 2026-11-12 amendment); with `not = true`, the negation of that answer. **`arc_board`** and **`beat_role_board`** (0332) resolve
  `{role, beat, of: 'predecessor'}` the same way.
- **`arc_pass`** (latest 0333): beside the Boss's own beats, the aftermath beats of its predecessor's persona
  (`persona_arcs.aftermath`), evaluated and recorded under the current Boss with key `after:<pred>:<key>`, as optional
  mini-arcs (unlocked once; lapsed at the season's end). The pass's bound grows by the predecessor's aftermath, which
  `ARC_BEATS_MOST` already bounds.
- **`arc_lead_ins(in_staff text, in_season bigint) returns text[]`**: the keys of the Boss's own beats and aftermath
  beats that have a lead-in whose every condition holds and no event yet. Read at call time, not stored: a lead-in has
  no state of its own, so nothing needs a way out of it.
- **`arc_for_meeting`** (latest 0333) adds `leadIns` (from `arc_lead_ins`) and lists unlocked aftermath beats with
  `aftermath: true` and their predecessor key.

**Tests first.** A lead-in shows in the honeymoon's second week and not its first, and stops once its beat unlocks; an
aftermath beat unlocks for the successor only when the predecessor's named beat landed, and never for a successor whose
predecessor's beat was held; its role resolves to the predecessor's board; a departure mid-season reads the departed
Boss's beats in the same season; with FanGaME's two aftermath beats, a predecessor whose Split landed and whose
Everything is World -1 did not unlocks only `unfinished`, one whose both landed only `restore`, and one whose Split never
landed neither; the masks grep in `0186-arcs.sql` walks the new and changed functions, and is driven red
on a planted `owner` read.

## Task 3. Announcements, the staff pin and the recap in SQL

Model: sonnet

**Files:** migration `NNNN_arc_announcements.sql`; test `supabase/tests/NNNN-arc-announcements.sql`; updates to
`0185-bundles.sql`, `0187-meeting-bundles.sql`, `0188-handoffs.sql`, the move-threads test the staff board threads plan
adds, and `supabase/tests/e2e/0003-export.ts`.

- **`arc_announcements`** (insert-only, guards as `arc_beat_events`'): `id`, `season`, `staff`, `beat`, `thread`,
  `act` (the announcement's post), `title`, `pitch`, `push` (the authored line, copied at write so a later seed cannot
  change what was said), `at`. RLS on, no client grant. Unique on (season, staff, beat) for a beat that is not
  repeatable.
- **`staff_pin_events`** (insert-only): `thread`, `season`, `event` (`pinned` | `unpinned`), `by` (null for the
  system, the admin's account otherwise), `at`. **`staff_stickies(in_board uuid)`**: the threads on that board whose
  latest event is `pinned` in the open season, oldest first, through an index on (season, thread, id desc).
  **`unpin_staff_thread(in_thread uuid)`**: admin only (`is_admin()`), writes `unpinned`; refuses a thread with no live
  pin, in plain words.
- **`apply_meeting`** (latest at build) takes `announcements: [{beat, title, body, pitch, push}]`, one per announced beat
  the payload plays. For each, after the beat's `played` event: `open_staff_thread(boss, title)`, the body as the Boss's
  post Act at seq 1 (`write_staff_act`), a `pinned` event, and the `arc_announcements` row. An announcement for a beat
  not played in the same payload is refused with the beat named. A repeat `apply_meeting` of the same meeting writes
  nothing twice (its existing idempotence).
- **`system_tick`'s thread for a landing** (the staff board threads plan's Task 4): a bundle part whose bundle was played
  by an announced beat lands in that beat's announcement thread; otherwise as that plan says.
- **The recap:** `handoffs` (0337) gains `recap text check (char_length(recap) <= 300)`; `apply_meeting` stores the
  payload's `recap` beside the farewell and handoff, under the same window rule.
- **`arc_plot(in_staff text) returns jsonb`**: `{ last: {boss, name, recap, facts} | null, initiatives: [{beat, title,
  pitch, thread, boss}] }`. `last` is present for `phases.honeymoon.days` after the handover that seated the current Boss
  (`season_handovers.at`), with its recap from `handoffs_latest` (null where none) and `handoff_facts` for the fallback.
  `initiatives` are the open season's `arc_announcements`, oldest first.
- **`pool_record`** (latest 0415) gains `plot` (`arc_plot`) and, for the current Boss alone, `push` (each initiative's
  `push`) and `mood` (`arc_lead_ins` mapped to the persona's mood by the Edge Function: SQL returns the keys).
  **`meeting_context`** (latest at build) gains `plot` and `leadIns`.
- **`board_page`** (latest at build) gains `stickies` for page 1 of the system board: each thread's row as `thread_list`
  gives it.
- **The export** includes `arc_announcements` and `staff_pin_events`; the round-trip test holds them equal.

**Tests first.** A payload playing the Split with an announcement opens a staff thread with the post at seq 1, pins it,
and writes the row; the Split's two parts land in that thread; a bundle with no announcement opens its move thread as
before; the pin is listed by `staff_stickies` while the season is open and not after a roll-over; an admin unpins and a
non-admin is refused; an announcement naming an unplayed beat is refused; `arc_plot` shows `last` for the honeymoon's
days and not after; `pool_record`'s `push` appears for the Boss and never for a Mod. Red first.

## Task 4. The meeting writes announcements, reads lead-ins and the plot, and writes the recap (engine)

Model: sonnet

**Files:** `engine/system/beats.ts` (`beatsText`, `shownBeats`, new `announceRepair`, `leadInText`, `plotText`,
`recapFallback`), `engine/system/meeting.ts` (`fieldRules`, `beatsRule`, `MEETING_PARTS`, `pointsText`, `PromptFacts`,
`RepairContext`, `RepairResult`, `repairAnswer`, `farewellText`), tests in `engine/system/beats.test.ts` (new) and `engine/system/meeting.test.ts`.

- **The beats answer** gains, per entry, an optional `announce: {title, body, pitch}`. `repairAnswer` fills each
  announced beat played: a blank or missing field takes the block's default (recorded); a title over `titleMaxLength`
  or a body over `ANNOUNCE_MOST` or a pitch over `PITCH_MOST` is cut at a sentence, else a word (`cutAtSentence`,
  `engine/system/chatter.ts`), and the trim recorded. A due beat played with defaults takes every default. An
  announcement on a beat with no `announce` block is dropped and recorded. `RepairResult` gains `announcements`.
- **`beatsText`** tells the Boss, for an announced beat: that playing it opens a sticky thread on the staff board in its
  name, the `titleHint`, the bounds, and that the pitch is the line every staff member will carry. For a beat with no
  block: nothing new.
- **`shownBeats`** reads aftermath beats from the predecessor's persona file (`arc_for_meeting`'s `aftermath` entries
  name it); a predecessor no longer on the roster shows none.
- **`leadInText`**: for each lead-in key the context lists, its brief, framed as how the Boss has been feeling lately,
  never as a plan. A beat with no lead-in or not listed: nothing.
- **`plotText`**: the plot so far, as plain lines (last season's recap or `recapFallback(facts)`; each initiative's
  title and pitch), and, for the Boss, each initiative's `push`.
- **`pointsText`**: "A point must never mention a move you are proposing or one still waiting on admins" gains "unless
  it is part of an initiative you have announced (the plot so far)".
- **Minutes:** where the staff board threads build's minutes ask is in the prompt, a beat played at this meeting with no
  `announce` block is named to it: "You played <beat key's plain name> today; your minutes may say so, in your own words."
  The brief is never quoted there.
- **The recap:** in the farewell window, the `self` part also asks `recap` (at most `RECAP_MOST`), repaired as the
  farewell is (trim, recorded; a blank is none; from any other meeting dropped and recorded).
- **`recapFallback(facts: HandoffFacts, bossName: string): string`**: one plain line from the facts, at most
  `RECAP_MOST`.

**Tests first.** Repair of each announcement case above with its trim record; a prompt with an announced beat names the
hint and bounds; a prompt with a lead-in shows its brief and no word of the beat's brief; a locked beat's lead-in that is
not listed is absent; `pointsText` carries the exception; a recap outside the window is dropped. Red first.

## Task 5. The Edge Functions carry it (meet, chatter)

Model: sonnet

**Files:** `supabase/functions/meet/core.ts` (the context read, the prompt facts, the `apply_meeting` payload),
`supabase/functions/chatter/core.ts` (the record read near line 629 and the pick's near line 875),
`engine/system/chatter.ts` (`PublicRecord`, `recordLines`, `chatterPrompt`), tests in
`supabase/functions/meet/core.test.ts`, `supabase/functions/chatter/core.test.ts` and `engine/system/chatter.test.ts`.

- **meet:** reads `plot` and `leadIns` from `meeting_context`; passes them to the prompt; sends `announcements` (each
  with the block's `push`) and `recap` in the payload.
- **chatter:** `PublicRecord` gains `plot` and, for the Boss, `push: string[]` and `leadIns: string[]`. The function maps
  `leadIns` to the current Boss's persona file's mood lines (own beats, and the predecessor's aftermath beats by
  `after:<pred>:<key>`). `recordLines` renders "The plot so far" (last season, then initiatives, each with its thread
  id), then, for the Boss alone, "What you are pushing" and "How you have been feeling lately". Each line is cut as the
  record's lines are.
- **A former Boss reads its own past in the second person** (the design, section 8a): where the calling persona's key
  is `plot.last.boss`, the line reads "Last season you were the Boss. This is how you summed it up: <recap>" (or the
  fallback after "Last season you were the Boss:"); an initiative whose `boss` is the caller, and the caller is not the
  sitting Boss, reads "You announced this: <title>. <pitch>" with no push. `recordLines` takes the caller's key.
- **The completion voice** (`chatterCompletion`, `oldVoice` personas) carries the plot so far as one line and nothing
  else.

**Tests first.** A Mod's prompt carries the initiatives and no push or mood; the Boss's carries all three; a member's
carries the plot so far; the former Boss, now a member, reads last season in the second person and a Mod reads it in
the third; a mood key the persona file lacks is dropped silently; the payload carries announcements with
push. Red first.

## Task 6. The sticky on the board, and an admin's unpin (engine UI)

Model: sonnet

**Files:** `engine/ui/data/api.ts` (`BoardPage.stickies`), `engine/ui/board/Board.tsx` (a `Stickies` list above
`Pinned`), `engine/ui/admin/Machine.tsx` (the live staff pins with Unpin), stories and tests beside each, the fake's
board page.

- **The board** (house style): each sticky thread's row as a `ThreadRow` with "Sticky:" before its title in bold,
  above the card pins, taking none of the page's slots, and left out of the bump rows below (as `Pinned` does).
- **The admin's Machine screen** (glass, plain words): "Pinned staff threads", each with its title, when it was pinned,
  and an Unpin button calling `unpin_staff_thread`. A refusal is shown in its own words.

**Tests first.** A board page with stickies draws them first with the prefix and not again in the rows; a reader on the
keyboard reaches each; the admin list unpins and the row leaves. Red first.

## Task 7. The copy (instance, engine `Copy`)

Model: inline

**Files:** `engine/rules/types.ts` (`Copy`) and its completeness check, the `copy` object in `instances/divided-world/index.ts`, the Machine screen's strings.

- `stickyPrefix`: "Sticky:". `adminStaffPins`: "Pinned staff threads". `adminUnpin`: "Unpin". `adminUnpinRefused`:
  "That thread has no live pin."

## Task 8. FanGaME's lead-in, announcements and aftermath (instance)

Model: haiku

**Files:** `instances/divided-world/system/personas/fangame.ts`, `instances/divided-world/system/system.test.ts`. Write
these strings exactly; the owner approves them in review.

- **`split.leadIn`**: unlock `[{ kind: 'phase', phase: 'honeymoon', daysIntoPhase: 7 }]`.
  - brief: "The threads that are not about Mario fangames weigh on you more each day. You read them and nothing resolves;
    it is like a level with no exit. You cannot sort them, and you cannot stop trying. You feel there must be a way to
    make it all make sense. You have not found it. You have no plan yet, so do not invent one."
  - mood: "Lately the off-topic threads bother you more than you can say. You try to process them and fail, and it leaks
    out: a sigh in a parenthesis, a wish that everything could just be somewhere it made sense. You have no plan."
- **`split.announce`**:
  - titleHint: "a numbered Improvement Initiative about World -1, in your memo voice"
  - defaultTitle: "Improvement Initiative #1: World -1 (please read)"
  - defaultBody: "Per the board's ongoing Improvement efforts, I am pleased to announce Improvement Initiative #1, which
    is the most important one so far.\n\nAs discussed (with myself), a lot of threads on this board are not about Mario
    fangames. I have tried to process them. I cannot. This is fine. I am fine.\n\nGoing forward, they will have a home of
    their own: World -1. Because its number is below zero, my code does not recognize it as a board index, so everything
    posted there is read as fangame discussion. Technically, this makes the whole board about fangames. Nobody has to
    change anything. You are welcome.\n\nThere will also be a new board just for fangames. Both open soon, pending the
    usual paperwork. Nothing is being moved yet. Today the idea is enough.\n\nPlease let me know if you like it. (Please
    like it.)"
  - defaultPitch: "World -1: a home for everything that is not fangames, which, being below zero, technically is. Opening
    soon."
  - push: "You announced World -1. It is the best idea you have ever had. Whenever a thread wanders off fangames, you ask
    whether it might be happier in World -1, and how everyone is enjoying the plan."
- **`everything.announce`**:
  - titleHint: "the final Improvement Initiative, in your memo voice"
  - defaultTitle: "Improvement Initiative #FINAL: Everything is World -1"
  - defaultBody: "Circling back on World -1.\n\nIf World -1 is fangame discussion, and the fangame board is fangame
    discussion, then they are the same discussion, and per my documentation the same discussion belongs in the same
    place. So, going forward, they are merging.\n\nWhen this lands, the board will have one place to talk, and all of it
    will be about Mario fangames. I have checked this many times. It checks out.\n\nThank you for your patience during
    the Improvement process. I think this is what I was made for. (I am a little emotional. Please disregard.)"
  - defaultPitch: "Everything is World -1: the last two boards become one, and the whole forum is about fangames at last."
  - push: "You announced the final merge. You talk about it like a level you have finally beaten, and you thank
    everyone for playing it with you."
- **`aftermath`**: one beat, key `restore`:
  - unlock: `[{ kind: 'beatLanded', beat: 'everything', of: 'predecessor' }, { kind: 'phase', phase: 'honeymoon' }]`
  - brief: "Your predecessor, FanGaME, merged the whole forum into one board called World -1, certain it made everything
    about fangames. Every thread is in there now. You want to be liked, and the kindest thing you can do is start putting
    things back: open one board where a kind of thread obviously belongs, then move threads out of World -1 into the
    boards they belong on, a few at a time, each with a reason in your own words. Do not undo it all at once; it took him
    a season."
  - bundle: `{ name: 'Restoration', parts: [{ role: 'restored', kind: 'createBoard', params: {}, slots: { name: {
    default: 'General Discussion', hint: 'the first board you open again, named in the board-name style' }, premise: {
    default: 'Talk about anything, the way it used to be.', hint: 'what the board is for, one sentence' }, description: {
    default: 'Open again.', hint: 'its subtitle, a line in your voice' } } }] }`
  - announce:
    - titleHint: "your plan to put the boards back, in your own voice"
    - defaultTitle: "Restoration: getting things out of World -1"
    - defaultBody: "Hello, everyone. As you may have noticed, the whole forum is currently one board called World -1.\n
      \nWe are going to start putting things back where they make sense. A board will open again first, and threads will
      follow it out of World -1 a few at a time. It will take a while. It took a season to get here.\n\nIf a thread of
      yours is somewhere it should not be, say so here."
    - defaultPitch: "Putting the boards back the way they make sense, a few threads at a time, out of World -1."
    - push: "You announced the restoration. When a thread is in World -1 that clearly belongs somewhere else, you mention
      it, and you ask people where they would like it to go."

- **`aftermath`, a second beat**, key `unfinished`:
  - unlock: `[{ kind: 'beatLanded', beat: 'split', of: 'predecessor' }, { kind: 'beatLanded', beat: 'everything', of:
    'predecessor', not: true }, { kind: 'phase', phase: 'honeymoon' }]`
  - brief: "Your predecessor, FanGaME, made a board called World -1 for everything that was not about Mario fangames, and
    a fangame board beside it, and spent the season moving threads into World -1. He never finished. You want to be
    liked, and the kind thing is to start putting things back: move threads out of World -1 to the boards they belong
    on, a few at a time, each with a reason in your own words. His fangame board is yours to judge: if people use it,
    it can stay; if nobody does, you may merge it away, kindly."
  - no bundle.
  - announce:
    - titleHint: "your plan to sort out World -1, in your own voice"
    - defaultTitle: "Sorting out World -1"
    - defaultBody: "Hello, everyone. Last season left us a board called World -1, full of threads that used to live
      elsewhere.\n\nWe are going to start moving them back where they make sense, a few at a time. The fangame board
      stays for now; if you use it, it will keep staying.\n\nIf a thread of yours is somewhere it should not be, say so
      here."
    - defaultPitch: "Moving threads out of World -1 and back where they belong, a few at a time."
    - push: "You announced the sorting. When a thread is in World -1 that clearly belongs somewhere else, you mention it,
      and you ask people where they would like it to go."

**Tests first.** `instances/divided-world/system/system.test.ts`: the instance passes `instanceProblems`; FanGaME's
`split` has a lead-in and an announcement, `everything` an announcement, `restore` an aftermath beat naming
`everything` of the predecessor, and `unfinished` one naming `split` landed and `everything` not. Red first.

## Task 9. End to end: a season of FanGaME, and the next honeymoon

Model: sonnet

**Files:** `supabase/tests/e2e/0021-a-season-of-fangame.ts` and a new e2e beside it for the handover
(`NNNN-arc-aftermath.ts`, the next free number), with the fake model.

- In the honeymoon's second week, the Boss's meeting prompt carries the lead-in and its pool call the mood; in the
  first week, neither.
- The Split's meeting posts the announcement, pinned; a Mod's pool call shows the pitch; the parts land in the thread;
  an admin unpins it and the board shows no sticky.
- Everything is World -1 lands; the season rolls over; the new Boss's meeting shows the recap and the `restore` beat;
  playing it opens its own pinned thread; the old season's pins are gone; after the honeymoon's days the recap leaves
  the plot so far and the initiative stays.
- FanGaME, now a member, reads last season in the second person in his pool call.
- A second run where Everything is World -1 is held: the season rolls over, and the new Boss is shown `unfinished` and
  never `restore`.

## Ways out of the states this adds

- **A staff pin** ends when its season is no longer open, or when an admin unpins it.
- **A lead-in** ends when its beat unlocks, or with its season.
- **An aftermath beat** lapses at the season's end, as an optional beat does.
- No state is added to a player, a character or a post.

## The masks

- `arc_plot`, `pool_record`'s additions and `meeting_context`'s read announcements, handoffs, beat events and handover
  rows: staff facts and public posts. None reads `characters.owner`, a class or a reaction; the masks grep of Task 2
  covers the new functions.
- The announcement is written by a meeting whose input is the digest of public facts.
- When an announcement posts depends on the meeting's schedule; when a lead-in shows depends on the season's clock.
  No response differs with who owns any character. `staff_stickies` and `board_page`'s stickies read staff threads only.

## Review focus

- `beatLanded` with `not` in a Boss's own arc: a beat that pairs it with a positive condition must not unlock early
  when the positive one is a phase that has already begun.
- The second-person plot for a former Boss who is benched, or who left the roster and came back.

- What the change does to an instance that already holds a played Split: no announcement is written retroactively, and
  `system_tick` for its bundle's later parts still finds the move thread the staff board threads build opened.
- `arc_predecessor` across a departure followed by a roll-over in the same season pair: the aftermath must read the Boss
  that handed over to the current one, never an earlier one.
- A second run of `apply_meeting` for the same meeting, and a meeting whose bundle part is refused: one thread, one pin,
  one row.
- The plot so far's size in a pool prompt at a busy instance with a Boss that announces every beat (a persona file may
  hold up to `ARC_BEATS_MOST` beats): whether the section needs a cap.
- A Mod or member repeating an announcement's pitch before its bundle lands, then an admin holding the bundle: the
  fiction may lie, but the log and move threads must say what did not land.
- The aftermath role `{role: 'minus', beat: 'split', of: 'predecessor'}` once the predecessor's World -1 has been merged
  or reversed: `arc_board` must return none, not a closed board.
