# Polls: plan

Record, written 2026-11-20. The plan for `docs/plans/2026-11-20-polls-design.md`. One build session builds it in one PR
from `main`, after the design's PR is merged.

Every task is test first: name the test, record its red run, then write the code. No check is added, so no poison is
needed. The registries that already hold lists (`tools/check-web-reads.mjs`, `supabase/tests/0005-default-deny.sql`,
`supabase/tests/e2e/0003-export.ts`) gain their entries in the task that adds the thing they list.

**Migrations.** Two migrations, `NNNN_polls.sql` (Task 1) and `NNNN_poll_reads.sql` (Task 2), taking the next free
numbers in `supabase/migrations/` (0379 and 0380 as this is written; `docs/plans/2026-11-20-forged-quotes-plan.md` may
take 0379 first). Their SQL tests take the matching numbers in `supabase/tests/`. Each function a migration replaces is
copied from its latest definition, found with `grep -il "function <name>" supabase/migrations/*.sql | tail -1` before
copying, and changes only what this plan names. As this is written:

- `post` (0142)
- `start_thread` (0326)
- `edit_post` (0130)
- `react` (0054)
- `spin_written` (0374) and `spin` (0357)
- `acts_take_seq` and the two kind checks (0317)
- `acts_well_formed` (0374)
- `acts_veil_cover` (0371)
- `acts_public` (0371)
- `settlement_input` and `estimate_input` (0378)
- `thread_page` (0375)
- `thread_open` (0357)
- `log_page` (0377)
- `system_digest` (0366)

The forged-quotes plan also replaces `post` and `start_thread`, so whichever lands second copies the other's version.
Lock order stays as 0357's header writes it: POST, THEN visits_open, THEN CHARACTER.

**The layers.** Everything is the engine's, except the five settings' values in `instances/divided-world/settings.ts`.
The boundary check holds.

**The world.** The board, in its house style (`docs/plans/2026-10-29-two-worlds-design.md`), as the mockup draws it.

## The words this plan uses

- A **poll** is an Act of kind `poll` whose target is a post (`post_kind`: a post or a spin), written by that post's
  character in the post's thread. Its payload is
  `{question, options: text[], pick: int, secret: bool, closes_at: timestamptz}`, or `{removed: true}`.
- A post's **current poll** is the latest `poll` Act on it, by `(created_at, id)`, unless that Act is `removed`, in
  which case the post has none. Every earlier poll Act on the post is **replaced**.
- A **ballot** is an Act of kind `ballot` whose target is a poll, with payload `{picks: int[]}`: distinct option
  indices, sorted, at most the poll's `pick`, possibly empty (a withdrawal).
- A **close** is an Act of kind `poll_close` whose target is a poll, with payload `{by: 'author' | 'admin'}`.
- A poll's **end** is the earlier of its `closes_at` and its close's `created_at`. It is **closed** once `now()` passes
  its end.
- A character's **counted ballot** on a poll is its latest ballot by `(created_at, id)` whose `created_at` is before
  the poll's end. A poll's **counts** are, per option, the counted ballots that pick it, and its **voters** are the
  characters whose counted ballot picks anything.

All three kinds take no `seq`, so none is a place in a thread.

## Task 1. The kinds, the writes and the guards (SQL)

Model: sonnet

**Files:** the migration `NNNN_polls.sql`; `supabase/tests/NNNN-polls.sql`;
`supabase/tests/0005-default-deny.sql`; the settings' seeding as `reactionCap` travels (read
`tools/rehearse/setup.ts` and `engine/rules/instance.ts` for its path before writing).

1. **Kinds.** `acts_kind_check`, `acts_seq_check` and `acts_take_seq` gain `poll`, `ballot` and `poll_close` among the
   seq-less kinds.
2. **`acts_well_formed`** gains three target rules:
   - a `poll` targets a `post_kind` Act by the same character in the same thread;
   - a `ballot` and a `poll_close` target a `poll` Act in the same thread.
3. **Payload checks**, as `acts_<kind>_payload` constraints:
   - `poll`: either exactly `{removed: true}`, or `question` is a string, `options` an array of 2 or more strings,
     `pick` an integer from 1 to the options' length, `secret` a boolean and `closes_at` a string;
   - `ballot`: `picks` is an array of integers;
   - `poll_close`: `by` is `author` or `admin`.

   Lengths and counts that depend on settings are checked in the writers.
4. **Settings**, in `engine/rules/types.ts` `Settings`, validated in `engine/rules/instance.ts`, seeded as `reactionCap`
   is, with Divided World's values:

   | Setting | Divided World |
   | --- | --- |
   | `pollOptionsMax` | 10 |
   | `pollQuestionMax` | 200 |
   | `pollOptionMax` | 100 |
   | `pollLastsMin` | 1 hour |
   | `pollLastsMax` | 14 days |

   The two `pollLasts` settings are `Span`s.
5. **Index:** `acts_ballots on acts (target_act_id, character, created_at desc, id desc) where kind = 'ballot'`.
6. **`poll_written(on_post uuid, through uuid, draft jsonb)`**, internal, not granted. `draft` is
   `{question, options, pick, secret, lasts}`, where `lasts` is a span string. It checks:
   - the lengths, with `within`;
   - the option count, from 2 to `pollOptionsMax`, with no two options equal after trimming;
   - `pick`;
   - `lasts`, within `pollLastsMin` and `pollLastsMax`.

   It then inserts the poll Act with `closes_at = now() + lasts`. Its refusals name the failed predicate, for example
   `a poll has 2 to 10 options`.
7. **The writers** gain a last parameter, `poll jsonb default null`:
   - **`post` and `start_thread`** call `poll_written` after the post's insert when `poll` is given.
   - **`edit_post`**: null keeps the poll; an object sets one; `{"removed": true}` removes it. Setting or removing
     takes the post `for no key update` before anything else. It is refused, in one sentence (`a poll cannot change
     once a ballot is cast; you can still close it`), when the post's current poll has any ballot.
8. **`cast_ballot(poll uuid, through uuid, picks int[])`**, granted to `authenticated`. It runs the gates `post` runs
   for a character writing in a thread: `acting`, `not_banned`, `not_the_systems` and `not_barred`. It takes the
   poll's post `for share`, so it meets an edit's lock. It refuses:
   - a poll that is replaced or removed (`that poll was replaced`);
   - a poll that is closed (`that poll has closed`);
   - picks that are out of range, repeated or more than `pick` (`pick up to N options`).

   It then inserts the ballot with its picks sorted, and returns the ballot's projection, the poll's id and thread,
   and the poll's counts.
9. **Closing.**
   - **`close_poll(poll uuid, through uuid)`**: `through` must be the poll's character, played by the caller (`acting`).
   - **`close_poll_as_admin(poll uuid)`**: `only_admins('closes a poll')`.

   Both refuse a poll that is already closed, replaced or removed. Each inserts the close, and each is granted to
   `authenticated`.
10. **`poll_counts`**: a view with owner rights, granted to `authenticated`, with one row per poll:
    `{poll, counts int[], voters int, ends_at, closed}`, computed from the counted ballots through `acts_ballots`. It
    counts characters and reads no owner.
11. **`acts_public`** (both of its selects): a `ballot` whose poll is `secret` projects a null `character` and
    `{"secret": true}` as `payload` and `current_payload`. The poll's secrecy is read once per row by the ballot's
    `target_act_id`.
12. **`my_ballots`**: the caller's own ballots (`characters.owner = auth.uid()`), as `my_veiled_posts` is written:
    `{act, poll, character, picks, created_at}`. Granted to `authenticated`, and added to `0005-default-deny.sql`'s
    readable list.
13. **The guards.**
    - `react` refuses `poll`, `ballot` and `poll_close` (`a poll is not reacted to; react to the post`).
    - `settlement_input`'s and `estimate_input`'s `win_acts` leave out all three kinds.
    - `spin_written` refuses a `poll_close` (`spin the poll`), a replaced or removed poll (`that poll was replaced`),
      and a secret ballot (`a secret ballot cannot be spun`).
    - `acts_veil_cover` treats a ballot on a veiled post's poll as it treats an Act on the post: it resolves the
      ballot's post through its poll, so the veiled author's own ballot shows the stand-in.
    - Every function that reads `acts` (not `acts_public`) by `character` is listed in the migration's header, and
      each is shown to skip secret ballots by kind or is changed to. Find them with `grep -n "from acts "` over the
      latest definitions.
14. **Tests** (`NNNN-polls.sql`), each a `raise exception` claim:
    - every refusal above, each in its one sentence;
    - an edit's poll is refused after a ballot, and allowed before one;
    - a removed poll takes no ballot;
    - counts follow each character's latest ballot, and a withdrawal drops that character from the voters;
    - a ballot made in the transaction a close commits after is not counted, by `created_at`;
    - two characters of one account each count, and a secret poll's counts equal the characters, not the account;
    - a secret ballot reads with a null `character` and no picks through `acts_public` for every caller, its author
      included, and with its character and picks through `my_ballots` for its owner alone;
    - a react on a poll is refused;
    - `settlement_input` holds no ballot;
    - a spin of a secret ballot is refused, and a spin of a public ballot and of a poll is written;
    - a veiled author's ballot shows the stand-in;
    - two sessions, one editing the poll and one casting a ballot: whichever commits second either is refused or
      counts against the current poll, never a ballot on a replaced poll that counts (the lock test pattern of
      `supabase/tests/0304-post-veils.sql`, section 13).

## Task 2. The reads (SQL)

Model: sonnet

**Files:** the migration `NNNN_poll_reads.sql`; `supabase/tests/NNNN-poll-reads.sql`; `supabase/tests/0005-default-deny.sql`;
`tools/check-web-reads.mjs` (`ALLOWED_READS`, `ALLOWED_RPCS`).

1. **`thread_page`** gains, for the current poll of each post in `page_posts`, of the post in `nested` (quotes) and of
   the origin's post:
   - `polls`: each poll Act as `acts_public` shows it, with its `poll_counts` row and its close Act if any.
   - `voters`: for a public poll, its counted ballots, newest first, up to 50 per poll, as
     `{poll, act, character, picks}`, with `votersMore` per poll. Each voter's `character` and `profile` objects go in
     a list of their own, as the origin's `cast` is, never `people`.
   - `mine` holds the caller's own counted ballots on these polls, from `my_ballots`, beside the reactions it holds
     today. Use a key of its own, `myBallots`, if `mine`'s shape cannot take it.
   - The poll ids join `ids`, so `spun` holds the threads spun from each poll.
   - Where the thread's origin is a `poll` or a `ballot`, the `origin` part carries that poll the same way (`polls`,
     `voters`, `myBallots` hold it). `at` is the poll's post's `{thread, seq}`.
2. **`poll_ballots(poll uuid, before timestamptz default null)`**, granted to `authenticated`. It lists a public poll's
   ballots, every one and not only the counted ones, newest first, 50 at a time, each with its character's public
   name and avatar. It refuses a secret poll (`that poll's ballots are secret`). It serves the full voter list and the
   history of changes.
3. **`thread_open`'s `origin_place`** gains:
   - `{kind: 'poll', question, on: <the post's place>}`
   - `{kind: 'ballot', character: {id, name}, question, on: <the post's place>}`

   `<the post's place>` is the `post` place's object.
4. **`log_page`** gains two sources:
   - `ballots`: the caller's own ballots in the window, from `my_ballots`, with each poll's question and its post's
     place;
   - `pollCloses`: closes by an admin of polls written by the caller's characters.
5. **`system_digest`**'s excerpts gain, for an excerpted post with a current poll, `poll: {question, options:
   [{text, count}], closed}`. It never names a voter, public or secret.
6. **Tests:**
   - the page's poll parts for a public and a secret poll, read by a voter's owner and by another account. The secret
     parts are byte-equal for both, except `myBallots`.
   - `poll_ballots` refuses a secret poll.
   - `origin_place` for each new kind.
   - the log's lines name the caller's own secret ballot.
   - the digest names no voter.
   - **Scale:** the `thread_page` scale test (the one 0375 extends) gains a page of 20 posts, each with a public poll
     of 200 characters' ballots and 3 changes each. Its plan stays bounded by the 50 per poll and the index, and its
     time is recorded beside the existing budget.

## Task 3. The rules in TypeScript (engine)

Model: sonnet

**Files:** a new `engine/rules/polls.ts` and `polls.test.ts`; `engine/rules/types.ts`; `engine/rules/instance.ts`;
`instances/divided-world/settings.ts`; `engine/ui/data/api.ts` (`ActKind` :331 gains the three kinds, and new
`Poll`, `PollCounts`, `PollDraft`, `Ballot` types).

- `pollDraftProblems(draft, settings)` returns the same predicates, in the same words, as `poll_written`. A table test
  holds each refusal beside the SQL test's sentence.
- `countedBallots(ballots, endsAt)` and `pollCounts(poll, ballots)`: the client's preview of a live event before the
  server's counts arrive, and the fake's arithmetic.
- `pollClosed(poll, close, now)` and `percent(count, total)`. The percent is of the picks, rounded so that it reads
  as the mockup draws it.
- Register the kinds:
  - `UNPLACED` in `engine/ui/data/fake.ts` :491;
  - `WITHOUT_EFFECTS` in `engine/ui/cards/plays.ts` :700;
  - every list Task 1's grep found that names seq-less kinds.

  `ACT_KINDS` in `engine/rules/types.ts` (the settlement's) does not gain them.

## Task 4. The actions, the broadcasts and the data layer

Model: sonnet

**Files:** `engine/rules/actions.ts` and `actions.test.ts`; `supabase/functions/act/core.ts` and `core.test.ts`;
`engine/ui/data/api.ts`; `web/src/data/supabase.ts`; `engine/ui/data/fake.ts` and `fake.test.tsx`.

1. **`ACTIONS`** gains `castBallot`, `closePoll` and `closePollAsAdmin`. `post`, `startThread` and `edit` pass `poll`.
2. **`BROADCASTS`**:
   - `cast_ballot` sends `act` (the ballot's projection, which on a secret poll names no one) and a new `poll` event
     `{poll, counts, voters, ends_at, closed}` on `thread:<id>`.
   - Both closes send `act` and `poll`.

   A secret ballot's event is built from the projection, never from the request.
3. **`api`** gains `castBallot`, `closePoll`, `closePollAsAdmin`, `pollBallots` and `subscribeThread`'s `poll` event.
   `post`, `startThread` and `edit` take `poll`. `ThreadPage` and `PageOrigin` gain the Task 2 parts.
4. **The fake** holds polls and ballots by the same rules, with `pollCounts` from Task 3, and seeds one public and one
   secret poll in a seeded thread for the stories.

## Task 5. The poll on a post (engine, the board)

Model: sonnet

**Files:** a new `engine/ui/polls/Poll.tsx`, `poll.css`, `Poll.test.tsx` and `Poll.board.stories.tsx`;
`engine/ui/thread/Post.tsx` (`Body`'s default branch, after the words at :123 and before `LastEdited`);
`engine/ui/thread/Thread.tsx` (`onAct` :702, and the new `poll` event).

As the mockup's option A draws it:

- **The table.** A table in the post's ink: a head with the question in bold, and in Courier the ballots' kind, "choose
  N" and "closes in 2 days" or "closed Nov 22, 2026" ("closed early by its author" or "by an admin"). Below it, one row
  per option: a radio button (choose 1) or a checkbox (choose more), the option, the bar, and a mono `3 · 50%`. On a
  public poll the voters' names sit under the option, the first eight, then "and 12 more", which opens the full list.
- **The foot:**
  - "Vote as <HUD mask>", or "Change ballot" once the HUD mask's counted ballot exists, with its picks checked;
  - "Withdraw" beside it;
  - the voter count ("6 characters voted");
  - Ballots (a public poll's history, through `pollBallots`, 50 at a time, "Wario picked Badwagon", "switched to…",
    "withdrew");
  - Spin;
  - "Close poll" for the author's HUD mask, and for an admin;
  - the poll's `SpunInto`.
- **Who can vote.** The form is shown when the HUD mask can vote. Where it cannot, the inputs are absent and one plain
  line says why: no HUD mask, the poll is closed, or the mask is banned or barred, in the words `post`'s refusals use.
  A refusal from the server shows in the foot in a `role="alert"`.
- **Accessibility.** A `fieldset` whose `legend` is the question. The bars are `aria-hidden`, and each count is text. A
  landed ballot is announced politely ("Ballot cast as Peach"). Every control is reachable by keyboard.
- **The effect rule.** The poll's root carries `data-kb-over-ink`. It sits inside `data-kb-content-area` and adds no
  border box of its own beyond the 2003 table.
- **Live.**
  - A `poll` event replaces the poll's counts.
  - A ballot `act` event on a public poll moves the character's name. For a voter not in the list, the name is read
    once by `api.characters`.
  - A `poll` Act heard live (an edit's) replaces the post's poll.
- **Phone.** Below the board's phone width, each option's bar and count go on their own line under the option.
- **Stories:** open, voted, closed, secret, choose 3, the author's own, no HUD mask, and under a Whoops! ink.
- **Tests:** each of those states' controls and words, the keyboard path, and a refusal shown.

## Task 6. Making and editing a poll (engine, the board)

Model: sonnet

**Files:** a new `engine/ui/polls/PollDraft.tsx` and its test; `engine/ui/composer/Composer.tsx` (`submit` :154);
`engine/ui/board/NewThread.tsx` (:49); `engine/ui/composer/EditPost.tsx` (:64); `engine/ui/composer/draft.ts`, so a
draft keeps its poll.

- **The editor.** "Add a poll" opens a fieldset under the editor with:
  - the question;
  - the options: two rows to start, "Add option" up to `pollOptionsMax`, and a remove button on each row past two;
  - "Voters may pick" 1…N, as a select;
  - "Secret ballots: only the counts are shown", as a checkbox;
  - "Closes in": 1 hour, 1 day, 3 days, 1 week or 2 weeks, bounded by the settings.

  "Remove poll" closes it. `pollDraftProblems` speaks under the field it names before sending.
- **EditPost.**
  - A post whose poll has no ballot opens the editor filled, and an edit sends it, or `{removed: true}`.
  - A post whose poll has a ballot shows one plain line in place of the editor: "This poll has ballots, so it can't
    change. You can still close it."
  - A post with no poll offers "Add a poll".
- **Tests:** a draft round-trips through `draft.ts`, each problem shows, and each of the three call sites sends the
  poll.

## Task 7. Spinning a poll and a ballot (engine, the board)

Model: sonnet

**Files:** `engine/ui/spin/place.ts` (`placeParts` :43, `onWords`, `onHref`), `engine/ui/spin/OriginLink.tsx`,
`engine/ui/spin/Origin.tsx` (`body()`, `takeInOrigin` :62), `engine/ui/spin/SpinForm.tsx`, and their tests.

- **The place's words:**
  - `the poll “Best kart in the series?” on #12 in Title`;
  - `Wario's ballot in the poll “…” on #12 in Title`.

  The whole phrase is one link to the poll's post. The question is cut to 60 characters with an ellipsis.
- **The box** draws the `Poll` of Task 5 from the page's `origin` parts. It can be voted in while open and is final
  once closed, and it hears the origin thread's `poll` events through the channel it already joins. For a ballot
  origin, that ballot's line is named above the table: "Wario picked Badwagon, Nov 20".
- **SpinForm** opens from the poll's Spin and from a ballot's Spin in the Ballots list. A secret poll's history has no
  rows, so no ballot Spin is drawn.
- **Tests:** each place's words and link, the box for an open and a closed poll origin, and a vote made in the box.

## Task 8. The log (engine, the glass)

Model: sonnet

**Files:** `engine/ui/log/lines.ts` (beside the wash line at :1047 and the ids at :1270), `engine/ui/data/log-page.ts`,
and their tests.

The log's lines, in plain words:

- "Wario cast a ballot for Pipe Frame in the poll “…” on #12 in Title."
- "… (secret ballot)."
- "Wario changed its ballot to …"
- "Wario withdrew its ballot …"
- "An admin closed Wario's poll “…”."

A character's pronouns are read where the log already reads them. The lines say what was done and never who else
voted.

## Task 9. The export and the masks, end to end (e2e)

Model: sonnet

**Files:** `supabase/tests/e2e/0003-export.ts` (its fixture gains a poll, a replaced poll, a ballot, a changed ballot
and a close; `HELD` needs no new table); a new `supabase/tests/e2e/NNNN-polls.ts`.

- **The round trip:** export, then import, then the same counts and the same `my_ballots` for the owner.
- **Two accounts, one with two characters, on a secret poll:**
  - every read the other account can make holds no character for a secret ballot: the page, the event as the edge
    function builds it, `poll_ballots`, the origin and the digest;
  - the counts count characters;
  - a refusal's words and a ballot's response time do not depend on who owns a character. Time them as the existing
    e2e timing tests do.

## Last. The full build, the pictures and the final review

`npm run typecheck` and `npm run build:ci` green. Attach screenshots to the PR for the owner to approve the words:

- **Board world, desktop and phone:** a post with a public poll, open, as a voter and as a reader with no HUD mask; a
  secret poll; a closed poll; a poll under Whoops!'s ink; the composer with a poll; a spun thread whose ORIGIN box is a
  poll.
- **The glass:** the log's ballot lines.

The final reviewer reads the Review focus below.

## Ways out of the states this touches

| State | Its way out |
| --- | --- |
| An open poll | It closes by itself at `closes_at`, by its author's Close poll, or by an admin's |
| A character's ballot | Changed or withdrawn by its character, from the poll, until close |
| A closed poll | Final. It holds nothing of anyone's; the post and its words are as before |
| A poll that cannot change (it has ballots) | The edit screen says so and offers Close; the post's words still edit |
| A ballot refused | The foot says why; nothing is written, and the form stays for another try |

## The masks

- A secret ballot's character and picks are withheld in `acts_public`, the one projection, for every reader alike
  (Task 1). Its owner reads it through `my_ballots` alone (Tasks 1, 2 and 8).
- `poll_counts` counts characters, reads no owner, and is the same for every caller.
- `cast_ballot`'s refusals read the poll, the picks and the caller's own character. No refusal differs with who owns
  another character.
- The live `poll` event and a secret ballot's `act` event carry no character (Task 4).
- Every reader of base `acts` by `character` skips secret ballots (Task 1, item 13).
- `poll_ballots` refuses a secret poll whatever the caller.

## Review focus

- **Every reader of `acts` by character:** a secret ballot reaching a profile, a presence list, a post count, a
  search, the digest or a group's numbers would name its voter. Task 1's list must be complete.
- **Acts an instance already holds** gain nothing. No post has a poll, and the kind checks only widen.
- **The edit and ballot race:** the post lock in `edit_post` and `cast_ballot` keeps a ballot from counting on a
  replaced poll. Check that the lock order matches 0357's header in each function the migration copies.
- **Close and ballot at once:** counting by `created_at` against the end, not by commit order, gives every reader the
  same counts.
- **Cost at a busy instance:** `thread_page` with many polls of many voters stays bounded by the 50 per poll and
  `acts_ballots`. `acts_public`'s added lookup applies only to `ballot` rows.
- **The forged-quotes plan's copies** of `post` and `start_thread`: whichever lands second carries both changes.
- **The settlement** sees no ballot. `estimate_input` and `settlement_input` agree.
