# Season arcs, bundled moves and FanGaME's split: the plan

Record, written 2026-11-06. Carries out `docs/plans/2026-11-06-fangame-split-design.md` (cited here as "the design"),
task by task. Each task writes its tests first and shows their red run, and every task is reviewed for the spec and for
quality (`.claude/skills/build-session/SKILL.md`). Migration and SQL test numbers are written here as "next": the build
takes the next free number when it reaches the task.

**Order.** This plan builds after three others merge: the Mod Bots build (#287), the season's end (#284) and the FanGaME
plan (`docs/plans/2026-11-06-fangame-plan.md`). Each redefines functions named here (`admin_queue`, `apply_meeting`,
`meeting_context`, `system_tick`, `hand_over`, `reveal_season`, the meeting's prompt and answer), so the build works from
main as it then stands, and every "latest" below means latest at build time. Tasks 1 to 4 build in order. Task 5 needs
Task 4. Task 6 needs 4 and 5. Task 7 can build any time after Task 1. Task 8 needs Task 6. Task 9 comes after Tasks 1 to
8. Task 10 stands alone.

**Nothing turns on.** Divided World's `systemEnabled` stays false. Every task runs against localhost Postgres and the
fake model, and no task touches a deployed database.

## The layers

- **Engine** (`engine/`, `supabase/`):
  - lasting moves and the kinds `createBoard`, `moveThread` and `mergeBoard`;
  - a thread's stored board and its rebuild;
  - bundles, roles and dependency;
  - beats, conditions, held-back kinds and beat state;
  - the meeting's beat, bundle, farewell and handoff answers;
  - the digest's board lines;
  - the handoff's facts;
  - the staff avatar resolver.
- **Instance** (`instances/divided-world/`): FanGaME's arc, mini-arc and held-back kinds; the reworded premise; the
  settings' numbers; FanGaME's pictures. The engine reads them through `SystemContent`, `Settings` and `InstanceUi`.

## Task 1: lasting moves, and a thread's stored board

Model: sonnet

**Tests first** (each red before the code):

- **`engine/system/moves.test.ts`:** every kind declares `lasting`. A lasting kind has no expiry: `moveParamsProblems`
  and the meeting's repair drop an `expires_in_hours` given for one, and record the drop. A lasting kind declares no
  demand.
- **New `supabase/tests/<next>-thread-places.sql`:**
  - **origin_board:** every thread's `origin_board` equals its `board` after the migration, on a database with threads.
  - **refused updates:** an update of `origin_board` is refused.
  - **rebuild:** `rebuild_thread_places()` on a database with no lasting move in force changes no row.
  - **stored equals rebuilt:** `thread_places_drift()` (stored board against rebuilt board, by thread) returns no
    row. It is driven red once by updating one thread's `board` by hand, as the poison.
- **`supabase/tests/<next>-...sql`** (the inheritance review): a lasting move in force is not in `inheritance_due`.

**Code:**

- **`engine/system/moves.ts`:** `MoveKind` gains `lasting: boolean`, false for every kind today, and `move_kinds`
  gains `lasting boolean not null default false`, seeded from the catalog by `seed_instance`
  (`supabase/functions/_shared/seed.ts`, "Two lists that must agree are one list").
- **Migration (next), `thread_places.sql`:**
  - **`threads.origin_board`:** `uuid references boards (id)`, backfilled from `board`, then not null, with an update
    trigger refusing any change, enabled always. `threads.board` stays where the thread is now, and its comment says it
    is derived (the design, section 4).
  - **`thread_place(thread uuid) returns uuid`:** a thread's board computed from its origin and the lasting moves in
    force, in the order they landed: a `moveThread` of it, then any `mergeBoard` of the board it is on, followed until
    the board is open. A board whose `createBoard` is reversed sends a thread started in it to that move's `fallback`.
  - **`rebuild_thread_places(only uuid[] default null)`:** writes `board = thread_place(id)` where they differ, for the
    named threads or all.
  - **`thread_places_drift()`:** the two, compared.
  - All three are for `service_role` and the tick alone.
- **`inheritance_due`** (latest `0051_succession.sql:333`): its join on `move_kinds` adds `and not k.lasting`.
- **`end_move`** (latest `0051_succession.sql:153`): ending a lasting move calls `rebuild_thread_places` for the
  threads it touched (Task 2 says which).

## Task 2: `createBoard`, `moveThread` and `mergeBoard` land and end

Model: sonnet

**Tests first** (each red before the code):

- **`engine/system/moves.test.ts`**, each kind's params:
  - `createBoard {name, premise, description, fallback?}`, structural and lasting; `name` is held to
    `boardNameMaxLength` and, outside an authored bundle's fixed parts, to the instance's name style (Task 6 passes
    which);
  - `moveThread {thread, board}`, small and lasting;
  - `mergeBoard {board, into}`, structural and lasting, where `board` and `into` differ.
- **New `supabase/tests/<next>-lasting-boards.sql`**, one assertion each:
  - **createBoard:** its landing inserts a board (a slug from its name, made unique with a suffix), with
    `boards.created_by_act`; `boards_now` lists it, with its name and premise.
  - **moveThread:** its landing sets the thread's `board`. A second `moveThread` of the same thread ends the first as
    `superseded`. Reversing the second returns the thread to the first's board, and reversing the first returns it to
    its origin.
  - **mergeBoard:** its landing moves every thread on `board` to `into` and marks `board` closed in `boards_now`
    (`closed_by_act`, `merged_into`). Reversing it reopens the board and returns those threads.
  - **reversing createBoard:** threads moved into the board go back. Threads started in it go to its `fallback`, or the
    instance's first open non-system board when it names none. The board is closed.
  - **Refused at queue time:** a thread that does not exist; a board that is closed or is The System's own
    (`is_system`); a merge of a board into itself; a merge into a board merged into it.
  - **Every case:** `thread_places_drift()` is empty afterwards.

**Code:**

- **`engine/system/moves.ts`:** the three kinds, with `label`s in plain words ("Created a board", "Moved a thread",
  "Merged a board"), `offices: ['boss']`, `askable: true`, `shapesBoard: true` for the two structural kinds.
- **Migration (next), `lasting_boards.sql`:**
  - **`boards`:** gains `created_by_act uuid references acts (id)`, set only at insert.
  - **`boards_now`** (latest `0046_moves.sql:438`, as later redefined): grows, at its end, `closed boolean` and
    `merged_into uuid`, computed from the lasting moves in force (a live `mergeBoard` of it, or a reversed
    `createBoard`).
  - **`system_tick`'s landing pass** (latest at build): one branch for each kind. Each writes its move Act as every
    move does, then its effect, then `rebuild_thread_places` for the threads it touched (a merge: the threads on
    `board`).
  - **`queued_moves_guard`** (latest `0082_offices.sql:134`, as later redefined): the refusals above, each in words.
- **`end_move`:** for a lasting kind, the threads to rebuild are the move's thread, the merged board's threads, or the
  created board's threads.
- **`acts_well_formed`'s move payload check** (latest `0051_succession.sql:65`): admits the three kinds' params.

## Task 3: the board screens: stubs, a closed board, the kinds' words

Model: sonnet

These screens are in the board world (`docs/plans/2026-10-29-two-worlds-design.md`): the 2003 house style, color only
on the game's own pieces.

**Tests first** (each red before the code):

- **`supabase/tests/<next>-board-stubs.sql`:**
  - **Stubs:** `board_page` (latest `0095_board_index_pages.sql:25`) lists a thread moved away within
    `movedStubDays`, as a stub row (`moved_to` = its board now) below the board's own threads. It stops listing it
    after that.
  - **The index:** `index_page` lists no closed board.
  - **A closed board:** `board_page` answers `{closed: true, mergedInto | fallback}` and no threads.
  - **Starting a thread:** `start_thread` (latest `0013_system_board.sql`) on a closed board is refused in words that
    name the board its threads went to.
- **`engine/ui/board/Board.test.tsx`:**
  - A stub row reads "Moved: <title>" and links to the thread.
  - A closed board shows one plain line, "This board was merged into <name>." (or "This board was closed. Its threads
    are in <name>."), linked, and no New Thread control.
- **`engine/ui/board/move-words.test.ts`:** each new kind's sentence in plain words, naming the boards and the thread
  by their current names ("The System moved <thread> from <board> to <board>.").
- **`engine/ui/admin/Queue.test.tsx`:** a waiting `createBoard` and `mergeBoard` read in the queue's words.

**Code:**

- **`settings`:** `movedStubDays` (engine type in `engine/rules/types.ts`, its bound in `engine/rules/instance.ts`, Divided
  World's 7 in `instances/divided-world/settings.ts`).
- **The migration's** `board_page`, `index_page` and `start_thread` changes.
- **`engine/ui/board/Board.tsx`**, **`engine/ui/board/move-words.ts`**, **`engine/ui/admin/Queue.tsx`**, the data
  layer's board reads (`engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`), and a story in
  `engine/ui/board/Board.stories.tsx` for each new state.

## Task 4: bundles: parts, roles, dependency

Model: sonnet

**Tests first** (each red before the code):

- **New `supabase/tests/<next>-bundles.sql`:**
  - **Queuing:** a bundle of two parts, `minus` (`createBoard`) and `move` (a `moveThread` whose `board` is
    `{"role": "minus"}`), is queued with one `bundle` id. The second part `depends_on` the first.
  - **Landing:** when the first lands, the second's role resolves to the created board's id when it lands.
  - **Holding:** holding the first holds the second (`held_by` the same admin, `held_at` the same instant). Holding the
    second leaves the first.
  - **Reversing:** reversing the first's landed Act ends the second's as `reversed` too, each with its own `move_end`.
  - **Later moves:** a `moveThread` queued at a later meeting into a board a `createBoard` made depends on that
    creation, and is reversed with it.
  - **The log:** `moves_log` grows `bundle` and `role` at its end.
- **`engine/ui/admin/Queue.test.tsx`:** the parts of one bundle are drawn as one group, headed by the bundle's name, each
  part with its own Hold or Reverse.

**Code:**

- **Migration (next), `bundles.sql`:**
  - **`queued_moves`** gains `bundle uuid`, `role text` and `depends_on bigint[]`. A new table `move_dependencies
    (act uuid, on_act uuid)` is insert-only, with its guard trigger enabled always, written when a dependent move lands.
  - **`hold_move`** and **`reverse_move`** (latest `0049_admin_queue.sql:35` and `:53`) follow dependents, breadth
    first, each in the same transaction.
  - **`admin_queue`** (latest at build) returns each part's `bundle`, `role` and `bundleName`.
- **Role resolution:** in `system_tick`'s landing pass, a param `{"role": r}` is replaced by the landed result of the
  part with role `r` in the same bundle (a board's id). A part whose role's part has not landed waits. A part whose
  role's part was held is held with it.
- **`engine/system/moves.ts`:** a param's rule admits `{role: string}` wherever it admits a board's uuid, inside a
  bundle only.
- **`engine/ui/admin/Queue.tsx`:** the group.

## Task 5: arcs: beats, conditions, held-back kinds, beat state

Model: sonnet

**Tests first** (each red before the code):

- **New `engine/system/conditions.test.ts`:** each condition key's params and bounds:
  - `phase {phase?, daysBeforeEnd?}`;
  - `beatLanded {beat}`;
  - `boardActivity {board: uuid | {role, beat}, days, above? | below?: number | {board…}}`;
  - `moveReversed {}`;
  - `demandResolved {outcome: 'met' | 'failed'}`.

  A key outside the list is refused, naming it.
- **`engine/rules/instance.test.ts`**, one poisoned persona each, each problem naming its predicate:
  - two beats with one key;
  - a beat whose condition key is unknown;
  - a `beatLanded` naming no beat of the persona;
  - a bundle template part whose kind is not in the catalog;
  - a role used and never made;
  - `holdsBack` naming an unknown kind or beat;
  - a `due` on a mini-arc;
  - an authored bundle over `bundleAuthoredMostParts` (8).
- **New `supabase/tests/<next>-beats.sql`:**
  - **The list:** `beat_condition_holds(staff, season, condition jsonb)` has a branch for every key in the engine's
    list, driven from the seeded `condition_kinds` (like `0102-rule-predicates.sql`).
  - **Unlocking:** `beat_events` is insert-only. The tick writes `unlocked` once a beat's every condition holds, then
    `played` or `lapsed` once. A mini-arc marked repeatable may write `unlocked` again after `played`.
  - **Reads:** it reads posts per board, moves, demands and beat events only. A grep of its definition for `owner`,
    `account` and `reactions` finds nothing.

**Code:**

- **`engine/rules/types.ts`:**
  - **`Beat`:** `{ key, unlock: Condition[], brief: string, due?: {phase?, daysIntoPhase?, daysBeforeEnd?},
    bundle?: BundleTemplate, repeatable?: boolean }`.
  - **`BundleTemplate`:** `{ name: string; parts: { role, kind, params, slots?: Record<param, {default, hint}> }[] }`,
    where fixed params are the writer's and slots are the Boss's, each with a default.
  - **`Persona`** gains `arc?: readonly Beat[]`, `miniArcs?: readonly Beat[]` and `holdsBack?: readonly { kind:
    string; until: string }[]`.
  - **`Settings`** gains `bundleMostParts` (composed) and `bundleAuthoredMostParts`.
- **New `engine/system/conditions.ts`** (pure): the catalog, as `engine/rules/predicates.ts` holds rule predicates.
  `seed_instance` writes it to `condition_kinds`.
- **`engine/rules/instance.ts`:** the checks above.
- **Migration (next), `beats.sql`:**
  - **Tables:** `condition_kinds`, `beat_events (season, staff, beat, event, at)` (insert-only), and
    `persona_beats (staff, beats jsonb)`, seeded from the roster so SQL can read a persona's beats and held-back kinds.
  - **Functions:** `beat_condition_holds`, and a pass in `system_tick` that writes `unlocked` and `lapsed` (an optional
    beat at the season's end).
  - **The bound:** each pass reads the season's Boss alone, one persona, so it costs the same however many Acts the
    instance holds.

## Task 6: the meeting: beats, bundles, held-back kinds

Model: sonnet

**Tests first** (each red before the code):

- **`engine/system/meeting.test.ts`:**
  - **Briefs:** the prompt shows an unlocked, unplayed beat's brief and its bundle's slots with their hints. It shows
    no locked beat: a poisoned prompt built with a locked beat's brief makes the test red. A due beat past its point is
    marked "must be played at this meeting".
  - **Held kinds:** a kind held back until an unlocked beat is not listed, and an answer naming it is dropped and
    recorded.
  - **Beat answers:** `{beat: key, slots: {role: {param: value}}, why}` is repaired against the template, a slot over its
    bound is trimmed and recorded, and a slot name is held to the name style.
  - **Composed bundles:** `{name, parts: [{role, kind, params, why}]}` with more than `bundleMostParts` parts is cut from
    the end and recorded, and its cost is the sum of its parts.
  - **A due beat left out** is played with its defaults, and the record says so.
- **`supabase/functions/meet/core.test.ts`:**
  - **An authored bundle:** a meeting answering with an unlocked beat queues its parts as one bundle at no cost to the
    bank.
  - **A composed bundle:** it queues at its parts' cost.
  - **Beat events:** `beat_events` gets `played`.

**Code:**

- **`engine/system/meeting.ts`:** `PromptFacts` gains `beats` (unlocked and unplayed, from `meeting_context`) and
  `heldBack`. `MEETING_RULE` gains `beats` and `bundle`. The repair (`repairMeetingAnswer`, latest at build) handles
  both.
- **`meeting_context`** (latest at build): it returns the season's Boss's unlocked beats with their due state, and its
  held-back kinds still held.
- **`apply_meeting`** (latest at build): it queues a beat's parts with one bundle id, and writes `played` to
  `beat_events` in the same transaction.
- **The prompt's words:** "A beat is yours: an idea you have had. Play it when the board is ready, in your own words. A
  bundle is for moves that tell one story." Nothing else about beats is said, and nothing about a beat not yet unlocked.

## Task 7: the digest's board lines

Model: sonnet

**Tests first** (each red before the code):

- **`supabase/tests/<next>-digest-boards.sql`:** `system_digest` (latest `0052_digest_meeters.sql`, as later redefined)
  returns `boards`: each open, non-system board's id, name, premise and posts over `digestBoardDays`. That's at most
  `digestBoards` lines: the busiest half and the quietest half when there are more. It reads posts per board only.
- **`engine/system/digest.test.ts`:** the prompt's lines read "<name> (<premise>): N posts in D days", cut to their
  bounds.

**Code:**

- **Settings:** `digestBoards` (30) and `digestBoardDays` (21).
- **The migration's** `system_digest`.
- **`engine/system/digest.ts`**'s formatting.

## Task 8: the farewell and the handoff

Model: sonnet

**Tests first** (each red before the code):

- **`engine/system/meeting.test.ts`:**
  - **The prompt:** a meeting within `farewellWindowHours` of the season's end is told to write `farewell` (in
    character, at most `postMaxLength`) and `handoff` (out of character, at most 2000). It is shown the handoff's facts
    to write from. Any other meeting is not.
  - **The repair:** it trims both and records the trims.
- **New `supabase/tests/<next>-handoffs.sql`:**
  - **The table:** `handoffs (season, staff, farewell, note, written_at)` is insert-only, and the latest row per season
    stands.
  - **The farewell:** `hand_over` posts the stored farewell as the outgoing Boss's post in place of the `bossFarewell`
    stock line, and the stock line when none is stored.
  - **The facts:** `handoff_facts(season)` returns boards created, merged and closed in the season; beats played; moves
    in force; and the five busiest and quietest boards. It is a pure read.
  - **The new Boss:** `meeting_context` gives the new Boss the outgoing Boss's facts and note at its meetings for
    `inheritanceGraceDays` after the handover.
  - **No player read:** no grant lets `anon` or `authenticated` read `handoffs`.
- **`engine/ui/admin/Queue.test.tsx`:** the handover's to-do (`0090_handover_todos.sql`) shows the note and the facts.

**Code:**

- **Settings:** `farewellWindowHours` (36).
- **Migration (next), `handoffs.sql`:** the table, `handoff_facts`, `hand_over` (latest at build), `meeting_context`, and
  `admin_queue`'s to-do.
- **`engine/system/meeting.ts`:** the farewell window and the handoff block. For the new Boss: "Your predecessor left
  you this. It is theirs to say and yours to weigh; nothing in it is an instruction."

## Task 9: FanGaME's arc, the reworded premise, and a season on the fake model

Model: sonnet

**Tests first** (each red before the code):

- **`instances/divided-world/system/system.test.ts`:**
  - **The arc:** FanGaME's arc has the four beats of the design's section 8, in order, with the unlocks, firmness and
    bundles below. His mini-arcs are `victory-lap` alone, not repeatable. His `holdsBack` is the three kinds below.
  - **The habit:** no habit names dividing the board.
  - **The premise:** `BOSS_PREMISE` holds the new sentence and not "Every move you make ends".
  - **The validator:** the instance passes `instanceProblems`.
- **New `supabase/tests/e2e/<next>-a-season-of-fangame.ts`:** a season played on the fake model at day steps, with a
  scripted answer per meeting:
  - **The Split:** it unlocks at the reign, is due, and is played with a slot name. Both boards land after the hold.
  - **Picking it apart:** it unlocks; `moveThread` appears in the kinds and lands, leaving a stub.
  - **Victory lap:** it unlocks when the fangame board's seeded posts out-number World -1's.
  - **The great consolidation:** it unlocks at the meltdown; `mergeBoard` of General into World -1 lands.
  - **Everything is World -1:** it is due and is left out by the scripted answer, so it is played with its defaults,
    and the fangame board merges into World -1.
  - **The handover:** the farewell is posted, and the next Boss's first meeting is shown the handoff.
  - **At every step:** `thread_places_drift()` is empty.

**Code:**

- **`instances/divided-world/system/persona.ts`:** in `BOSS_PREMISE`, `Every move you make ends: it has a demand the
  characters can meet and a time it expires, and you say what both are in plain words when you are asked to.` becomes:
  > Most moves you make end: each has a demand the characters can meet and a time it expires, and you say what both are
  > in plain words when you are asked to. A few build things that stay: a board you create, a thread you move, a board
  > you merge into another. Those last until a later move changes them, and whoever is Boss after you inherits them.
- **`instances/divided-world/system/personas/fangame.ts`:** the habit ending `in your reign you enact them; in your
  meltdown you reach for dividing the board itself, the fangames on one side and everything else sent somewhere else.`
  becomes `in your reign you enact them.` Then add exactly:

```ts
  holdsBack: [
    { kind: 'createBoard', until: 'split' },
    { kind: 'moveThread', until: 'picking-apart' },
    { kind: 'mergeBoard', until: 'consolidation' },
  ],
  arc: [
    {
      key: 'split',
      unlock: [{ kind: 'phase', phase: 'reign' }],
      due: { phase: 'reign', daysIntoPhase: 7 },
      brief: 'You have had the idea of your career. Everything on this board that is not about Mario fangames needs a place of its own, and you have found its name: World -1. Because its number is negative, your programming reads every post in it as fangame discussion, so once it exists, the whole board is about fangames, technically. You are very proud of this. Announce it as your greatest Improvement Initiative yet. Play it: it creates World -1, and a new board for fangames that you name yourself. Both start empty. Do not move anything yet. Today the idea is enough.',
      bundle: {
        name: 'The Split',
        parts: [
          {
            role: 'minus',
            kind: 'createBoard',
            params: {
              name: 'World -1',
              premise: 'Everything that is not about Mario fangames, which, being in World -1, now technically is.',
              description: 'Not fangames. Technically fangames. Please post here.',
            },
          },
          {
            role: 'fangames',
            kind: 'createBoard',
            params: {},
            slots: {
              name: { default: 'Platformer Physics Palace', hint: 'your new fangame board, named in the board-name style' },
              premise: { default: 'Mario fangames: making them, playing them, and finishing them someday.', hint: 'what the board is for, one sentence' },
              description: { default: 'The heart of the board. Fangames only. (Please.)', hint: 'its subtitle, a line in your voice' },
            },
          },
        ],
      },
    },
    {
      key: 'picking-apart',
      unlock: [{ kind: 'beatLanded', beat: 'split' }],
      brief: 'World -1 exists, and your fangame board beside it. Look at your fangame board in the digest. If it is busy, you are thrilled, and the threads that are not about fangames are clutter around your success: tidy them into World -1. If it is empty, it hurts, and you move them into World -1 anyway, because that is where they belong. Move one thread at a time, each with a reason in your own words. You are not ready to move whole boards.',
    },
    {
      key: 'consolidation',
      unlock: [{ kind: 'phase', phase: 'meltdown' }, { kind: 'beatLanded', beat: 'split' }],
      brief: 'Single threads are not enough. Whole boards that are not about fangames belong in World -1, all at once. Merge them in, one board at a time, as the mood takes you. Leave your fangame board alone, for now.',
    },
    {
      key: 'everything',
      unlock: [{ kind: 'phase', daysBeforeEnd: 7 }, { kind: 'beatLanded', beat: 'split' }],
      due: { daysBeforeEnd: 2 },
      brief: 'It has come to you. If World -1 is fangame discussion, and your fangame board is fangame discussion, they are the same discussion, and they belong together. Merge your fangame board into World -1. When it lands, the board will have one place to talk, and all of it, by your programming\'s reckoning, about Mario fangames. You have done it. You have no idea what you have done.',
      bundle: {
        name: 'Everything is World -1',
        parts: [{ role: 'final', kind: 'mergeBoard', params: { board: { role: 'fangames', beat: 'split' }, into: { role: 'minus', beat: 'split' } } }],
      },
    },
  ],
  miniArcs: [
    {
      key: 'victory-lap',
      unlock: [{ kind: 'boardActivity', board: { role: 'fangames', beat: 'split' }, days: 7, above: { role: 'minus', beat: 'split' } }],
      brief: 'Your fangame board is busier than World -1 this week. They love it. They love fangames. This is the best day of your career, and the right thing to do with a good day is to tidy up: find the threads still out of place and move them into World -1 with a light heart.',
    },
  ],
```

- **A role's board from an earlier beat** (`{role, beat}`) resolves to the board that beat's part made, read from the
  landed Acts. Task 4's resolution takes `beat` for a role outside the bundle.
- **`instances/divided-world/settings.ts`:**
  - `movedStubDays: 7`
  - `bundleMostParts: 4`
  - `bundleAuthoredMostParts: 8`
  - `digestBoards: 30`
  - `digestBoardDays: 21`
  - `farewellWindowHours: 36`

## Task 10: staff avatars

Model: sonnet

**Tests first** (each red before the code):

- **`instances/divided-world/ui/index.test.tsx`:**
  - **The map:** every key of `staffAvatars` names a persona in the roster. A planted key `nobody` is red.
  - **Squares:** each `square` is PNG or WebP, square, at least 256 a side and at most 100 KB.
  - **Portraits:** each `portrait` is 256 to 512 wide, 1 to 2 times as tall as it is wide, and at most 400 KB.
  - **Poisons:** a planted 255-wide square and a planted 3:1 portrait are each red. They are files under the test's
    own fixtures, not the instance's.
  - **FanGaME:** he has both pictures.
- **New `engine/ui/data/staff-faces.test.ts`:**
  - **Personas:** a staff character with a map entry gets its square and portrait, and one without keeps its initial.
  - **Players:** a player character is never touched.
  - **The developer:** the character `developer` gets `InstanceUi.avatars[developer.avatar]` as its square.

**Code:**

- **The files:** copy `docs/research/2026-11-06-fangame-split/fangame-square.webp` and `fangame-portrait.webp` to
  `instances/divided-world/ui/avatars/`.
- **`engine/ui/types.ts`** (:309): `InstanceUi` gains `staffAvatars?: Readonly<Record<string, { readonly square:
  string; readonly portrait?: string }>>`.
- **`instances/divided-world/ui/index.ts`** (:15, :133): import both files with `?url`, and set `staffAvatars: { fangame:
  { square, portrait } }`.
- **New `engine/ui/data/staff-faces.ts`** (pure): `withStaffFace(character, ui, developerAvatar?)` fills
  `avatarSquare` and `avatarPortrait` for a staff character (`Character.staff`, `engine/ui/data/api.ts`) from the map. It
  is applied where characters enter the screens' data, so every renderer (postbit, mini, HUD, presence, profile,
  Portrait) draws it unchanged. The staff roster list stays without avatars.

## Review focus

- **Threads an instance already holds:** the migration backfills `origin_board` from `board`. Check that a database
  with threads, cards and plays reads every board and thread page the same before and after, and that the export
  round-trips (`supabase/tests/e2e/0003-export.ts`) with the new columns and tables.
- **A merge on a busy instance:** a `mergeBoard` rewrites `board` for every thread on the merged board in one
  transaction. Measure it at ten thousand threads, and check it takes no lock a poster would wait on for long.
- **The rebuild and the stored column:** check that every path that ends a lasting move (expiry cannot; reversal,
  supersession, a dependency's reversal) rebuilds the threads it touched, and that nothing else writes `threads.board`.
- **Two moves of one thread in one tick:** check the order they land in is the order they were queued, and that the
  first is ended `superseded`.
- **A role whose part is held after a dependent landed:** an admin reverses World -1's creation after threads were
  moved in at later meetings. Check every dependent ends `reversed` and every thread has a board.
- **A beat's secret:** check that no prompt, log line, admin screen a player can see, or Realtime payload carries a
  locked beat's brief. The admin queue may show unlocked ones.
- **A due beat's defaults:** check that a due beat played with its defaults is said in the log as the Boss's move, and
  that the record of the answer says the defaults were used.
- **Conditions at scale:** `boardActivity` counts posts per board over days. Check that it reads an index, not every
  post, as boards and seasons accumulate.
- **The farewell when the last meeting fails:** check that the stock line stands and the note is the facts alone.
- **The masks:** check that beat conditions, the digest's board lines and the handoff's facts read no owner, account,
  class or reaction, and that nothing a player triggers runs a condition check.
