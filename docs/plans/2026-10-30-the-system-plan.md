# The System, Part 1: the skeleton, with one move: plan

Record, written 2026-10-30. The plan for Part 1 of `docs/plans/2026-10-30-the-system-design.md` (issue #73): the model
interface in both modes, the cost ledger, the Director's character, profile, memory and bank, the digest and the role
that builds it, the meeting, moves with their demands and expiries, the standing-order tick, the admin queue, and one
move end to end, the Director renaming a board. Parts 2–5 each get a plan of their own from the design (its section
15). It is written against main at 212e275: migrations up to `0034_ledger_shares.sql`, SQL tests up to
`supabase/tests/0040-ledger-shares.sql`, e2e tests up to `supabase/tests/e2e/0010-reveal-across-0029.ts`. Each new file
takes the next free number when it is written, and a number that moved is reported under `Plan gaps` in the PR.

**The System ships switched off.** A setting `systemEnabled` (false by default) gates the meeting and the landing of
moves. Tasks 1–11 build and test everything with it off on a deployed instance and on in tests. Task 12's screens are
what make a landed move's way out visible, so the setting is turned on for Divided World only in Task 13, after them
("No player is ever stuck": a state's way out shows on the screen where the state shows).

## The layers

- **Engine** (`engine/system/`, new; SQL in `supabase/migrations/`; Edge Functions in `supabase/functions/`): the model
  interface and its validators, the move catalog and its effects, the demand whitelist, the digest and its role, the
  meeting and the bank, the tick, staff and duties, the model-call ledger, the admin queue's RPCs.
- **Instance** (`instances/divided-world/system/`, new): the Director's persona, its prompts, its stock lines, the
  outside feeds, the starting real-world list and wheelhouse, the PPP name style, the old voice's prompt frame, and
  every number as a setting. It reaches the engine through a new `Instance.system` field, seeded like classes and
  cards. The engine never names the Director's persona or Divided World ("KayfaBB never knows which instance it
  runs"); the engine's word is `staff`, and the Director is the instance's staff member keyed `director`.
- **Vendors** live only at the edges: adapters in `supabase/functions/_shared/models/` speak HTTP with `fetch`, and no
  module under `engine/` imports a vendor client ("Portable by construction").

## Tasks

### Task 1. The model interface, in engine

- `engine/system/model.ts`: the provider-neutral types. `ChatRequest` (`duty`, `tier`, `system`, `messages`, a JSON
  `schema` for structured output, `maxTokens`); `CompletionRequest` (`duty`, `prompt`, `temperature`, `topP`, `stop`,
  `maxTokens`); `Usage` (input, output and cache tokens, `serviceTier`, `gpuSeconds`, each as the provider reported
  it); `ModelResult<T>` (`value`, `usage`, `provider`, `model`, `trims`). A `Models` interface with `chat` and
  `complete`, which the meeting and the tick take as a parameter, so tests pass fakes.
- `engine/system/validate.ts`: `repair(value, rules)` for structured output. It trims a list one or two over its bound
  and a string over its length (each trim recorded as `{path, predicate, before, after}`), and rejects only what cannot
  be repaired without inventing content, naming the predicate that failed ("A validator tighter than the schema is a
  place a paid answer goes to die"). For a completion, `cutCompletion(text, stop, most)` cuts at the first stop
  sequence or newline and caps the length; only empty output is rejected.
- `engine/system/duties.ts`: `Duty` (`meeting`, `standingOrderLine`, `microEvent`, `renameJudge`, `appeal`), each with
  its mode (chat or completion) and default tier; `staffFor(duty, instance)` returns the staff key the instance assigns
  it, which for Divided World is `director` for every duty (design, section 14).

**Tests first** (`engine/system/*.test.ts`, red against stubs that return the input unchanged): a list of seven where
six is the bound trims to six and records the trim; a list of twelve is rejected with predicate `atMost(6)`; a missing
required field is rejected, never filled; a completion with a stop sequence mid-text is cut there; an empty completion
is rejected; `staffFor` throws for a duty the instance leaves unassigned. The poison: a `repair` that drops the
`trims` record still passes the value checks, so one test asserts the record.

### Task 2. Adapters and the price table, at the edge

- `supabase/functions/_shared/models/anthropic.ts`: `chat` over the Messages API with `fetch`, structured output by the
  API's JSON schema feature, reading the usage block as reported. The build session loads the `claude-api` skill first
  and takes model ids, the structured-output form and the usage block's fields from it, never from memory.
- `supabase/functions/_shared/models/completions.ts`: `complete` over the OpenAI-compatible `POST /v1/completions`
  shape, pointed at the instance's endpoint (`SYSTEM_COMPLETIONS_URL`, an Edge Function secret; the key, if any, is
  `SYSTEM_COMPLETIONS_KEY`). It reports the usage block it gets and, where the server reports none, token counts from
  the response and `gpuSeconds` from wall time.
- `supabase/functions/_shared/models/prices.ts`: one table per provider, each with a `verifiedOn` date, priced per
  million tokens by `serviceTier` as the usage block reports it, and per GPU second for the completions endpoint, whose
  self-hosted entry is an explicit `0`. `price(provider, model, usage)` throws for a model or tier missing from its
  table ("Cost is a column, not a report"). The build session fills the Anthropic table from the `claude-api` skill
  and records the date it read it.
- `supabase/functions/_shared/models/index.ts`: `models(env, record)` builds the `Models` the functions use. Every call
  goes through it; it retries a transport failure (a 5xx, a 429, a fetch that never answered) on the request itself
  with backoff, at most three times, and throws a 4xx at once ("Three unrelated timeouts are not a poison pill").

**Tests first** (`supabase/functions/_shared/models/*.test.ts`, with a fake `fetch`, red against main where the
modules don't exist): a usage block with `service_tier: "priority"` is priced from the priority row even when the
request asked for standard; a model missing from the table throws and names it; the self-hosted endpoint prices at
zero and still returns a row; a 503 then a 200 is one call with one retry recorded; a 400 is thrown without a retry; a
fetch that hangs past its timeout is retried.

### Task 3. The model-call ledger

- Migration `0035_model_calls.sql`: table `model_calls` (`id`, `at`, `duty`, `staff`, `provider`, `model`,
  `service_tier`, the token counts, `gpu_seconds`, `cost_microdollars bigint not null`, `outcome` in `ok | rejected |
  failed`, `predicate` for a rejection, `trims jsonb`, `retries`, `meeting` nullable). No client grant. Writer
  `record_model_call(payload jsonb)`, security definer, granted to `service_role` only. Each row is written once and
  never updated (`model_calls_no_update`, as `acts_no_update`).
- `models()` (Task 2) writes a row for every call it finishes, a rejection and a failure included, in a `finally`, so
  no call leaves no row. A call whose ledger write fails throws: an unrecorded call is the silent failure the ledger
  exists to prevent.

**Tests first:** `supabase/tests/0041-model-calls.sql` (no client can read or write `model_calls`; an update raises;
`record_model_call` refuses an outcome outside the three); `supabase/functions/_shared/models/index.test.ts` (a call
that throws in the adapter still writes a `failed` row; a rejected structured output writes `rejected` with its
predicate; a ledger write that fails makes the call throw). Add `model_calls` and `record_model_call` to
`supabase/tests/0005-default-deny.sql`'s lists.

### Task 4. Staff characters

- Migration `0036_staff.sql`:
  - `characters.owner` becomes nullable; a new column `staff text unique` holds a staff member's key, with the check
    `(owner is null) = (staff is not null)`. A staff character has no account behind it, publicly so.
  - `characters_within_cap` skips a row whose owner is null.
  - `acts_well_formed` (current form in `0027_unmask.sql:37`) refuses a staff character's Act unless the session sets
    `kayfabb.staff_writer` (as the existing writers use local settings, if they do; otherwise a parameter of the one
    writer `write_staff_act`, below). Players' writers already check `owner = auth.uid()`, which a null owner never
    matches; a test holds that.
  - `write_staff_act(staff_key, kind, thread, target, payload)`, security definer, `service_role` only: the one writer
    of a staff character's Acts.
  - `settlement_input` (`0004_schedule.sql:152`, as later replaced) leaves staff characters' Acts out of what earns:
    reactions to the Director pay nobody, and a staff character has no class, wallet or standing. The build session
    reads the function's current form before changing it.
  - `characters_public` gains `staff` (public: the Director is known to be the Director). `seed_instance` (current form
    in `0019_profiles.sql`) creates each staff member in the seed's `system.staff` once, debuted at seed time, with its
    name and the `character_profiles` row its seed gives; a reseed changes nothing an admin wrote, as boards already
    behave.
- `engine/rules/types.ts`: `StaffSeed {key, name, title, signature}`; `Instance.system` (Task 5) carries the list.

**Tests first** (`supabase/tests/0042-staff.sql`): a staff character has a null owner and a staff key; no player can
post, spin, play a card or edit as it; `write_staff_act` posts as it; a reaction to its Act appears in
`reaction_tallies` and in no `ledger` row after a settlement; the cap counts no staff character; a reseed leaves an
edited staff profile alone. `supabase/tests/0001-core.sql`'s "no readable relation has a column named owner" still
passes. The poison: a staff character with an owner (the check refuses it) and a player Act naming the staff character
(refused).

### Task 5. The instance's System content

- `engine/rules/types.ts`: `SystemContent` with `staff: StaffSeed[]`, `duties: Record<Duty, string>` (staff key per
  duty), `persona` (the meeting's system prompt frame), `stockLines` (keyed lines for every standing order, used when a
  micro-event call is out of budget or fails), `feeds` (outside feed URLs), `realWorld` (the starting list of subjects
  never amplified), `wheelhouse` (starting entries), `oldVoice` (the completion prompt frame for a board description),
  and `nameStyle(name): string[]` (problems with a name The System proposes; empty when it is in style).
- `engine/rules/instance.ts`: `instanceProblems` checks `system`: every duty assigned to a staff key that exists, every
  standing order's stock line present, `nameStyle` a function.
- `Settings` gains, with validators in `SETTINGS`: `systemEnabled` (false), `meetingCron` (daily), `weeklyMoves` (5),
  `bankCap` (10), `structuralHoldHours` (24), `microEventDailyCalls`, `digestThreads`, `digestExcerpts`,
  `digestExcerptChars`, `boardNameMaxLength` (60), `moveExpiryMostDays`, `moveExpiryLeastHours`, and `modelTiers`
  (`strong`, `light`, the model id for each; the meeting defaults to the strong tier). The defaults are starting
  points in the design's sense; the build session sets the model ids from the `claude-api` skill.
- `instances/divided-world/system/`: `persona.ts` (robo-McMahon, written from the design's premise: petty for years,
  prefers controversy, stokes kayfabe and deflates a real argument by making it absurd, never takes a side in one, its
  hobbies drawn from characters it thinks are cool and from outside material in the wheelhouse); `lines.ts`;
  `feeds.ts`; `real-world.ts`; `name-style.ts` (PPP: three words sharing a first letter, or a name ending in a word
  that alliterates with the two before it, or a take on "Pointless Post Palace"; the build session writes the test
  cases from the design's examples: Pointless Toast Palace, Pirate Puns Palace, Pointless Post SATAN SATAN SATAN pass;
  "General Discussion" fails); `old-voice.ts` (a 2003 board-index frame the old model continues).
- `supabase/functions/_shared/seed.ts`: `instanceSeed()` carries `system.staff` and the prompt texts into the seed, and
  the settings as before.

**Tests first:** `engine/rules/instance.test.ts` (an instance with a duty assigned to a missing staff key has a
problem; a missing stock line has a problem); `instances/divided-world/system/name-style.test.ts` (the cases above);
`instances/divided-world/settings.test.ts` (the new settings validate). Engine boundary: `npm run build` still passes
`check-engine-boundary`, since the engine names only `SystemContent`.

### Task 6. Memory, profile, bank and meetings

- Migration `0037_director.sql`:
  - `meetings` (`id`, `started_at`, `finished_at`, `outcome` in `ok | rejected | failed | off`, `error`, `bank_before`,
    `bank_after`, `consecutive_failures`), no client grant. A failed meeting keeps its whole record and its model
    calls' rows.
  - `staff_memory` (`id`, `staff`, `meeting`, `at`, `body jsonb`): one version per meeting, never updated. No client
    grant; the meeting reads the latest. The body's shape is `engine/system/memory.ts`'s `Memory`: `hobby {name,
    since, from}`, `opinions [{character, score -5..5, note}]`, `grudges`, `wheelhouse`, `realWorld`, `marks` (Part
    4's threads on thin ice; empty in Part 1).
  - `staff_profiles` (`id`, `staff`, `meeting`, `at`, `interests`, `favorites uuid[]`, `mood`, `signature`): the
    in-character profile, a version per meeting, public through a view `staff_profile_now` (latest per staff), granted
    to anon and authenticated. It may bluff; the hidden memory never reaches a client.
  - `move_bank` (one row: `balance numeric`, `as_of`): the bank accrues `weeklyMoves` per week continuously up to
    `bankCap`, and a meeting spends from it. `bank_now()` computes the accrued balance without writing.
- `engine/system/memory.ts`: `Memory`, and `repairMemory` built on Task 1's `repair` (an opinion score out of range is
  clamped and recorded; an opinion naming a character not in the digest is dropped and recorded, since the meeting may
  only hold opinions of characters it read in public play).

**Tests first:** `supabase/tests/0043-director.sql` (no client reads `staff_memory`, `meetings` or `move_bank`;
`staff_profile_now` is readable by anon; `bank_now()` caps at `bankCap` after a long idle stretch and accrues
`weeklyMoves` over a week); `engine/system/memory.test.ts` (clamping and dropping recorded as trims).

### Task 7. The digest and its role

- Migration `0038_digest.sql`:
  - A role `kayfabb_digest`, `nologin`, granted select only on public relations: `acts_public`, `characters_public`,
    `reaction_tallies`, `boards` and threads as clients read them, the settled standings, the move Acts (Task 8),
    `staff_profile_now`, and the board names view (Task 8). It is granted nothing on `characters`, `class_history`,
    `reactions`, `accounts`, `ledger`, `staff_memory` or any `my_*` view.
  - `system_digest(since timestamptz, until timestamptz)` returns `jsonb`, **owned by `kayfabb_digest`** and `security
    definer`, so it runs with that role's privileges and nothing else: the hottest threads by posts per hour, with
    their controversy (how split each thread's reactions are across quadrants, from `reaction_tallies`) and their
    length; settled standings that moved; landed moves and their demands' progress; quotes between characters (from
    `acts_public`'s quote targets); reactions to the Director's own Acts; excerpts of the top posts by heat, each cut to
    `digestExcerptChars`. Every list is capped by its setting, so the digest's size does not grow with the instance.
    `service_role` may execute it.
  - The memory and the outside feed are not in the SQL digest: the meeting adds them (Task 9).
- `engine/system/digest.ts`: the `Digest` type and `renderDigest(digest, memory, feed)`, the text the meeting reads.

**Tests first** (`supabase/tests/0044-digest.sql`, red against main): `has_column_privilege('kayfabb_digest',
'characters', 'owner', 'select')` is false, and likewise for `class_history` and `reactions`; `system_digest`'s owner
is `kayfabb_digest`; on the fixtures, the digest's thread list holds at most `digestThreads` and is ordered by heat; a
thread with 🔥 and 💀 in equal numbers ranks above one with only 🔥 on controversy. **The poison:** the test creates a
function owned by `kayfabb_digest` that reads `reactions.character` and asserts that calling it raises
`insufficient_privilege`, and a second that reads `characters.owner`; both are created and dropped inside the test's
transaction. A catalog check also asserts no function owned by `kayfabb_digest` other than `system_digest` and the
demand evaluator (Task 8) exists, so a later function given the role's ownership is reviewed. Add the role's
functions to `0005-default-deny.sql`.

### Task 8. Moves, demands and the board's name from Acts

- `engine/system/moves.ts`: the catalog. A `MoveKind` has `key`, `structural`, a params schema with bounds, and its
  effect. Part 1 holds one: `renameBoard` (structural; params `board`, `name`, `premise`, `description`). The catalog
  is seeded into `move_kinds` (key, structural) by `seed_instance`, so SQL and TypeScript read one list ("Two lists
  that must agree are one list").
- `engine/system/demands.ts`: the whitelist. Each `DemandKind` has `key`, a params schema with bounds, and a plain-words
  template for the glass. Part 1 holds: `postsOnBoard {board, count}`, `distinctCharactersOnBoard {board, count}`,
  `quadrantOnBoard {board, quadrant, count}`, `characterPostsInThread {character, thread}`, and `crossQuote {a, b,
  reactions}` (each of a and b quotes the other in a reply, and each reply draws `reactions` on its public tally).
  Every reaction threshold is at least the reaction cap plus one (design, section 3). Seeded into `demand_kinds`.
- Migration `0039_moves.sql`:
  - `acts.kind` gains `move` and `move_end` (rebuild `acts_kind_check` and `acts_check1` as `0027_unmask.sql:18-26`
    did). A `move` is the Director's Act (a staff character), with payload `{kind, params, demand, expires_at, why}`, posted
    on The System's board in its announcements thread. A `move_end` targets a `move`, has a null character (The
    System's plain record, as a tally is), and payload `{why: met | expired | reversed, by}`; extend the null-character
    check to it. One `move_end` per move (a unique partial index).
  - `queued_moves` (`id`, `meeting`, `kind`, `params`, `demand`, `why`, `go_live_at`, `expires_at`, `structural`,
    `held_at`, `held_by`, `landed_act`). `why` is the Director's one-line reason, its words, at most 200 characters: no client grant; admins read it through Task 11's RPC. A held move never lands and is
    never shown to a player.
  - `demand_progress(move_act uuid)` returns `{done, of, met}`, owned by `kayfabb_digest` (Task 7), reading only
    public relations, with a case per `demand_kinds` key; an unknown key raises.
  - `boards_now`: per board, the name, premise and description of its latest landed `renameBoard` move with no
    `move_end`, else the board's own row (its `description` stands as its first premise), and that move's Act id as
    `move_act` (null when none). Granted to anon and authenticated. `web/src/data/supabase.ts`'s `boards()` and `board()` (lines 479–496) read `boards_now` instead of
    `boards`, and `tools/check-web-reads.mjs`'s `ALLOWED_READS` gains it.
  - `moves_log`: every landed `move` Act with its `move_end`'s `why` and time, newest first, paged by keyset, for the
    Director's profile (Task 12). Granted to anon and authenticated, and added to `ALLOWED_READS`.
- An ended rename means the name it replaced comes back: the view computes this, and nothing is written to `boards`.

**Tests first:** `supabase/tests/0045-moves.sql` (a landed rename shows in `boards_now`; its `move_end` brings back the
old name; a second `move_end` on one move raises; a `move` by a player character raises; `demand_progress` raises for
an unknown kind; for every row of `demand_kinds`, a fixture move with that demand evaluates without raising, which
holds the two lists together); `engine/system/demands.test.ts` (a `crossQuote` with `reactions` at the cap is
rejected; at cap plus one it passes; every demand kind's template renders plain words). The poison for the two lists:
a demand kind seeded with no SQL case makes the per-row test raise.

### Task 9. The meeting

- `supabase/functions/meet/core.ts` (pure, as `settle/core.ts` is: takes a `Db`, the `Models`, the instance and a
  clock) and `supabase/functions/meet/index.ts` (the HTTP edge, `fromTheService()` as `settle/index.ts`).
  `runMeeting`:
  1. If `systemEnabled` is false, writes a `meetings` row with outcome `off` and returns.
  2. Reads `system_digest` for the window since the last meeting, the latest `staff_memory`, `bank_now()`, and the
     outside feeds (each fetched by plain code with a short timeout, item titles only, capped; a feed that fails is
     skipped and noted).
  3. Calls `chat` on the meeting's tier with the instance's persona and a structured schema: the new memory, the new
     profile, and `moves: [{kind, params, demand, go_live_at, expires_in_hours, why}]`.
  4. Repairs the answer (Task 1): moves past the bank are trimmed from the end and recorded; a move whose kind or
     demand kind is not in the catalog is dropped and recorded; a `renameBoard` whose name fails `nameStyle` or
     `boardNameMaxLength` is dropped and recorded, never rewritten; go-live times are clamped into the next day and
     expiries into `moveExpiryLeastHours`..`moveExpiryMostDays`.
  5. For each `renameBoard` kept, calls `complete` with the instance's old-voice frame and the new premise; the cut
     text is the description. If the endpoint fails, the instance's stock description stands in.
  6. Writes everything through one SQL function `apply_meeting(payload)` in one transaction: memory and profile
     versions, the queued moves (a structural move's `go_live_at` is at least `structuralHoldHours` away), the bank
     debit, the meeting row.
- `0039_moves.sql` or the next migration adds `schedule_meeting()` as `schedule_settlement()` does (`0004_schedule.sql`
  :67), on `meetingCron`, rescheduled by the same trigger pattern.
- A meeting that throws writes its row as `failed` with its error and the count of consecutive failures; only
  consecutive failures count toward any cap, and a success resets it.

**Tests first:** `supabase/functions/meet/core.test.ts` with a fake `Db` and fake `Models` (off writes `off` and calls
no model; a reply with seven moves and a bank of five queues five and records the trim; a rename failing the name
style is dropped, not rewritten; a structural move asked to go live in an hour is queued at the hold; the completion
endpoint failing leaves the stock description; a model failure writes `failed` and leaves memory and bank unchanged);
`supabase/tests/e2e/0011-meeting.ts` (against the scratch database: a meeting with a fake model queues a rename, writes
memory and profile versions, and debits the bank).

### Task 10. The tick: standing orders

- `system_tick()` in SQL, scheduled every minute by pg_cron as `count_thread_views()` is (`0018_reading.sql:93`), no
  model call:
  1. Lands each queued move whose `go_live_at` has passed, that is not held, while `systemEnabled` is on: writes the
     `move` Act through `write_staff_act`, with the stock line for its kind, and sets `landed_act`.
  2. For each landed move with no `move_end`: if `demand_progress` says met, writes `move_end {why: met}`; if
     `expires_at` has passed, writes `move_end {why: expired}`.
- Model-written lines for these moments (micro-events) arrive with Part 2, under `microEventDailyCalls`; Part 1 speaks
  stock lines only.

**Tests first** (`supabase/tests/0046-tick.sql`): a due move lands once even when the tick runs twice; a held move
never lands; a met demand ends its move with `met` and the old name returns; an expired move ends with `expired`; with
`systemEnabled` off nothing lands.

### Task 11. The admin queue and reversal

- `admin_queue()` returns the queued and landed moves in force with their demands, progress and times;
  `hold_move(id)` holds a queued move; `reverse_move(move_act)` writes `move_end {why: reversed, by: 'admin'}`. All
  three call `only_admins` (`0021_characters_listed.sql:90`). Add them to `ALLOWED_RPCS` in `tools/check-web-reads.mjs`.
- The next meeting's digest lists reversed moves, so the Director learns of them in memory only.

**Tests first** (`supabase/tests/0047-admin-queue.sql`): a player calling each raises 42501; an admin holds a queued
move and the tick never lands it; an admin reverses a landed rename and the old name returns; a held or reversed move
appears in the next digest's `moves` list as held or reversed.

### Task 12. The screens

Designed with the owner on 2026-10-30, after the plan was first written; the mocks are in
`docs/research/2026-10-30-the-system/`, and each item names the owner's choice. The tests are written from the mock.

- **The board's name** (the board world): `IndexScreen` (`engine/ui/index/Index.tsx:61-64`) and `BoardScreen`
  (`engine/ui/board/Board.tsx:108-110`) read `boards_now`'s name and description. No new look.
- **A move in force** (`mock-s1-move-notice.html`, C; the owner: "it's consistent with the similar labels for posts
  affected by postcards"). On the board the move changed, under its description:
  - the Director's `move` Act drawn as a 2003 notice ("ANNOUNCEMENT from The Director: …"), its text the move's stock
    line or, from Part 2, its micro-event line, with **its top three reactions, small**, from `reaction_tallies`;
  - on the notice's corner, the Act's label in glass, as a card's Act label breaks a post's frame: the long label
    ("THE SYSTEM RENAMED THIS BOARD"; the owner: "Since this is an Act I think we do need to use the longer label")
    and a plain segment, "WAY OUT: 7 OF 12 POSTERS ›", from `demand_progress` and the demand kind's template;
  - the segment opens a glass overlay with the plain detail: what was done and when, the demand in words, a progress
    bar, the expiry date, and that an admin can reverse it. Focus is held while it is open and returned when it closes.
  - A component `MoveNotice` in `engine/ui/board/`; the label's words come from the move kind's plain template, never
    from the Director.
- **The Director's profile** (`mock-s2-director-profile.html`, C). `ProfileScreen` (`engine/ui/profile/Profile.tsx:40`)
  for a staff character: name, an ADMINISTRATOR badge, its title, and a table of Interests, Favorite Members, Current
  Mood and Posts from `staff_profile_now`, with its signature; beside it a **Moderation log** from `moves_log`, each row
  a date, what was done (with links to the boards) and how it ended in short plain words ("in force", "undone: 12
  posted", "ran out Oct 31", "reversed by an admin"), newest first, with Older ›. No standing, class or season record.
- **The admin queue** (`mock-s3-admin-queue.html`, B). A glass page at `/admin/queue`, reached from an ADMIN tab in the
  pause menu shown only when `api.isAdmin()` (`engine/ui/data/api.ts:363`) is true. Three groups: **Waiting to land**
  (countdown and time, the full proposal with its new subject, demand and old-voice description, the Director's `why`
  quoted as its words, and HOLD); **In force** (since and until, the demand with its progress bar, and REVERSE);
  **Ended** (folded, the last 30 days, with how each ended). Plain text throughout; the glass quotes the Director and
  never speaks as it.
- **The Director's Acts on The System's board** render as posts by a character with the ADMINISTRATOR badge and its
  title, and a `move` Act's post carries the same glass label as the board's notice. No new mock.

**Tests first** (component tests, red against main): the board screen shows `MoveNotice` whenever `boards_now` has a
`move_act`, with the long label, the way-out segment's count and at most three reactions; the overlay opens from the
keyboard and returns focus; a staff profile shows the moderation log and no standing; the ADMIN tab is absent for a
player; the queue's groups render from a fixture `admin_queue()` with HOLD only on waiting moves and REVERSE only on
moves in force.

### Task 13. Turning it on

- Divided World's `settings.ts` sets `systemEnabled` to true only once Task 12 is merged; the playtest profile keeps it
  off until the owner says otherwise. `supabase/tests/e2e/0012-a-day-of-the-director.ts`: with a fake model, a meeting
  queues a rename, the tick lands it after its hold, characters post until its demand is met, the old name returns, and
  the next meeting's digest shows the move as met and the characters who met it.

## Ways out of the states this adds

| State | Its way out |
| --- | --- |
| A board renamed by The System | Its demand met by players' posts or reactions, shown in plain words on the board; its expiry, at most `moveExpiryMostDays`; an admin's reversal |
| A queued move | It lands at its time or is held by an admin; a player never sees it |
| A meeting that failed | The next scheduled meeting; its record kept |
| The System switched off | An admin's setting; nothing is stranded, since no move lands while it is off and landed moves still end by the tick |

## What could vary with a private fact, and how it does not

- **The digest** and **demand progress** run as `kayfabb_digest`, which the database refuses the private columns
  (Task 7's poison).
- **Reaction thresholds** in demands read only public tallies and are set above the reaction cap, so meeting one never
  depends on who reacted or whether two characters share a player.
- **The Director's opinions** are repaired to characters the digest named, so memory can't hold a character it learned
  of any other way.
- **A staff character** has no owner; reactions to it pay nobody, so no settled number moves with who reacted to it.
- **The profile** may bluff, but it is written only from the meeting, which read only the digest.

## Review focus

- `characters.owner` becoming nullable: every existing function that reads `owner` (writers, the cap, the reveal,
  exports) must still behave for a staff character; grep, don't assume.
- `settlement_input`'s exclusion of staff Acts: a reaction to the Director must change no ledger row, including the
  shares of `0034_ledger_shares.sql`.
- The `kayfabb_digest` role's grants: a later migration that grants it a private table would pass every other test.
- The cost of the meeting on a busy instance: the digest's caps hold its size flat; check the rendered digest's length
  at the fixture's largest settings.
- The tick every minute: its queries must use indexes on `queued_moves (go_live_at) where landed_act is null` and on
  open moves, so it costs the same however many moves an instance has made.
- A retry of the meeting after a crash must not queue the same moves twice (`apply_meeting` is one transaction keyed by
  the meeting's id).
- The price table: verified date recorded, and a missing model throws in the test, not only in prose.
