Record, written 2026-11-23.

# The hot triggers name their post, and the week's thread is a spin: plan

The design is `docs/plans/2026-11-23-hot-triggers-name-their-post-design.md`. It is one PR from `main`, and every task
goes test first with a red run. There is one migration, `supabase/migrations/NNNN_hot_posts.sql`, where NNNN is the
next free number (0420 at the time of writing), and one SQL test, `supabase/tests/NNNN-hot-posts.sql`. A function it
rewrites is copied from its latest definition, named below, and opens with the house comment saying what changed and
that everything else is as that migration wrote it.

## Task 1. The hot signal carries posts

Model: sonnet

- `pool_signals` (latest `supabase/migrations/0358_blind_totals.sql`), in its `hot` part:
  - each entry of `authors` gains `top`: that author's post in the thread inside `[since, until)` with the largest
    `reaction_tallies_open` total (summed over kinds), ties to the newer `(created_at, id)`. Read through
    `acts_thread_posts` (thread, character, created_at), never a scan of the window.
  - each hot thread gains `tops`: its two most reacted posts inside the window, by two different characters, by the
    same order, each `{act, character}`.
  - Everything else in `pool_signals` as 0358 wrote it.
- `engine/system/pool.ts`: `HotSignal.authors[]` gains `top: string | null`; `HotSignal` gains
  `tops: readonly { act: string; character: string }[]`.
- Tests first, in the SQL test: a thread where the flame's most reacted post is older than its newest picks the older
  one; a tie picks the newer; a post under a live totals veil counts as none (veil it, see the pick move); `tops` holds
  two different characters even when one character has the two biggest posts. Poison: order by `created_at` alone and
  watch the first test go red.
- The cost: an `explain` in the test shows each `top` read is an index probe of `acts_thread_posts`, as
  `supabase/tests/0419-chattier-second-follow-ups.sql` checks its reads.

## Task 2. The hot candidates quote their post and name their subject

Model: sonnet

- `engine/system/pool.ts`:
  - `Candidate` and `PoolPick` gain `subject: string | null`: the character the trigger is about (the flame for
    `oldFlame`), else null. `pick` carries it through. A kept pick read from `kept_picks` with no `subject` is read as
    null (`supabase/functions/chatter/core.ts`, where `carried` is built).
  - `candidates`: `oldFlame` adds, for each flame among the authors (not the persona's own character), the flame's
    `top` as `quoting` and `act`, the flame as `subject`; one candidate per flame, so `pick` keeps the persona's best.
    An author with no `top` adds nothing.
  - `homeTurf` and `hotOnBeat` take the first of `tops` whose character is not the persona's own (`ctx.characters`);
    where none is, the candidate is not added.
- `engine/system/pool.test.ts` first: the three triggers each carry the post and the subject as above; the runner-up is
  taken when the top is the persona's own; the candidate is dropped when only the persona posted; `pick` passes
  `subject` through. Update `hot()` in the test's helpers for the new fields.

## Task 3. The reason names the post

Model: inline

- `engine/system/chatter.ts`: `ChatterInput` gains `subject?: string | null` (a character id). `REASONS` keeps its
  entries for every trigger, and `oldFlame`, `homeTurf` and `hotOnBeat` become the sentences of the design's section
  3, used when the input has a `quoting` post (and, for `oldFlame`, a `subject`, written through `names`). Without
  them, today's words.
- `supabase/functions/chatter/core.ts`, `onePick`: passes `subject: p.subject`.
- `engine/system/chatter.test.ts` first: the `oldFlame` reason names the flame with its pronouns and says the persona
  is replying to it; with no subject it is today's sentence.

## Task 4. The staff's spin

Model: sonnet

- The migration: `write_staff_spin(staff_key text, origin uuid, title text, body text, marker jsonb default '{}')`,
  security definer, granted to `service_role` only, revoked from `public, anon, authenticated`. It holds
  `write_staff_thread`'s persona and office checks (latest `0089_pool_spends.sql`) and `spin`'s origin rule (latest
  `0357_post_veils.sql`: an origin that is not an edit, the system board redirected through `players_board()`), checks
  `title` and `body` with `within` (body not empty), sets `kayfabb.staff_writer` as `write_staff_thread` does, and
  inserts the thread with `origin_act_id` and a `spin` Act with `target_act_id = origin` and payload
  `marker || {title, body}`. Returns `{thread, act}` as `write_staff_thread` does.
- Read the latest `spin` whole before writing: whatever else it checks of an origin (a framing, a veil, a lock) that is
  about the origin and not the account, the staff's spin checks too. Name each in the migration's comment.
- SQL test first: a persona spins a post and the thread is on the post's board with the origin set; a spin of a post on
  the system board lands on the players' board; a waiting or benched persona, a non-persona, an empty body, an edit
  as origin and a missing origin are each refused; `authenticated` cannot call it.

## Task 5. The week's start is a spin

Model: sonnet

- `supabase/functions/chatter/core.ts`, `onePick`:
  - a start (`wantsStart`, a thread left, a chat voice) whose pick has an `act` is a spin: the thread read is
    `pool_thread` of `p.thread` with `also: p.act`, the quoted post is that Act, and the write is `write_staff_spin`
    with `origin: p.act` and `marker: { pool: day }`. No beats board is needed.
  - a start with no `act` (the meltdown stumble) is today's plain start on a beats board.
  - the offer: a spin start offers no Set; it offers a Cast on the origin only where the origin is a post, as a reply's
    offer is decided.
  - the record says `startedThread: true` for a spin as for a plain start.
- `engine/system/chatter.ts`: `ChatterInput` gains `spinning: boolean`. With it, the prompt says "You are spinning a new
  thread off the post shown below. Give it a title…" where a start says "You are starting a thread", the message shows
  the origin's thread and "You are spinning off <name>: …" in place of "You are replying to", and ends "Write the title
  and the opening post." The schema asks for a title (`askedTitle: true`).
- Tests first, in `supabase/functions/chatter/core.test.ts`: the day's top pick with a hot post as its Act calls
  `write_staff_spin` with that origin and never `write_staff_thread`; the meltdown stumble still calls
  `write_staff_thread` on a beats board; a spin start offers no Set; and in `engine/system/chatter.test.ts`, the spin
  prompt's words.

## Task 6. A persona's spin is its writing

Model: sonnet

Each read below counts the persona's `spin` Acts beside its `post` Acts. `acts_thread_posts` is a partial index on
`kind = 'post'`, so the own-posts scans add a `union all` branch for the persona's spins (at most one per thread, its
opener) rather than widening the predicate and losing the index. Each copied from its latest definition:

- `pool_waiting_rows`, `pool_waiting_in_thread`, `pool_waiting_in_board` (latest `0419_chattier_second_follow_ups.sql`):
  a reply to the persona's spin waits as a reply to its post does. The three change together, as their comment says.
- `pool_conversation` (latest `0415_chattier_staff.sql`): the persona's spin is one of its posts, its body the spin's.
- `presence_staff_in_thread`, `presence_staff_in_board` (latest `0415_chattier_staff.sql`).
- `pool_orphans` (latest `0419_chattier_second_follow_ups.sql`): a staff `spin` with a pool marker is adopted, with
  `startedThread` true.
- `pool_signals`' `tallies` (the migration's own copy from Task 1): reactions to a persona's spins count toward its
  priority.
- `pool_thread` (latest `0418_chattier_follow_ups.sql`): the thread's `spin` Act is read as its first post, its body the
  spin's body, so a persona replying in any spun thread sees its opener.

Tests first, in the SQL test: a reply to a persona's spin is waiting in all three reads and is in the conversation; the
persona shows present after its spin; an orphaned spin is adopted as a started thread; a reaction to a spin moves the
persona's tally; `pool_thread` of a player's spun thread lists the spin first. Each read's `explain` still probes
`acts_thread_posts` for the posts branch, as the 0419 test checks.

## Review focus

- Picks already kept in `kept_picks` from before this change: they carry no `subject` and a hot pick has no `quoting`;
  each must still post, with today's reason and no quote.
- The cost of `top` and `tops` on a busy instance: ten authors on each of `threads_cap` hot threads, each a probe of the
  author's window posts in one thread plus their tallies. Check the explains, not the row counts.
- `write_staff_spin` against `spin`: any check `spin` makes of its origin that the staff's version skips is a way for a
  persona to spin what a player cannot (a hidden post, an Act on a board it may not post on, a locked thread).
- The six reads widened in Task 6: a `union all` branch that loses an index, or a reply counted twice when it targets
  both a post and a spin, would show as a slow presence box or a doubled turn.
- A spun thread's ORIGIN box when the origin is a move's Act (a legacy or a reversal): the persona's spin must render as
  a player's spin of the same Act does.
