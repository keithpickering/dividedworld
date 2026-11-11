# Apologies go through the `act` function: plan

Record, written 2026-11-11. A bug fix built straight from its issue: the first item of issue #371's follow-ups,
"Apologies bypass the `act` function". No design session ran, because the issue settles the direction (route the
apology through `act`, and drop `apologize` from `ALLOWED_RPCS`). The issue's other items are not touched. Every task
goes test first: the failing test and its red run, then the code. During a task, run only the tests for the changed
code; `npm run build` runs once after the last task. Every database is the local Postgres the session-start hook
starts.

## The bug

A barred character's apology is a player's action like a spin: it opens a public thread and writes an Act. Every such
action goes through the `act` Edge Function (`supabase/functions/act/`), which reads the request with the action rules
(`engine/rules/actions.ts`, `decide`), calls the SQL function, sends the write's live updates (`BROADCASTS` in
`supabase/functions/act/core.ts`) and then drains the outbox (`afterTheAnswer`). The apology alone does not. So today:

- the apology's new thread and Act are never broadcast, so nobody on the board sees the thread arrive live;
- the after-action work is skipped, so the alerts the apology queued (its framed characters) wait for somebody else's
  write to drain the outbox;
- the action rules never read the request, so an empty body, which `actions.ts` refuses for an apology (the judge
  reads its words), reaches `apologize` in SQL, which takes it.

## The root cause

PR #347 (member groups) built the server half in full: `apologize` is in `actions.ts`'s rules (with a body that may
not be empty), in `BROADCASTS` and in the functions `act` never resends (`SAFE_TO_REPEAT`, `core.test.ts`). The web
adapter was then wired past it: `apologize` in `web/src/data/supabase.ts` calls `client.rpc('apologize', …)` through
`rpcWrite`, and `apologize` was added to `ALLOWED_RPCS` in `tools/check-web-reads.mjs` so that the guard that exists to
catch a write outside `act` stayed green. Two things let it stand unseen:

- nothing ever sent an apology through `act` against the real migrations, so the action rule's arguments
  (`in_move`, `through`, `title`, `body`, `framing`) have never been shown to be the ones the SQL function takes;
- the in-memory backend (`engine/ui/data/fake.ts`), which the screens' tests run on and which says it "refuses what
  the server refuses", reads every other action with `decide` (its `request()` helper) but not the apology, so no
  screen test could notice that the action rules were skipped.

## The form the fix keeps

The apology becomes an action like any other, end to end, and the exception is removed everywhere it was made: the
adapter, the guard's allowlist and the fake. No migration: `apologize` in SQL is unchanged, and its grant to
`authenticated` stays, since `act` calls it as the player (as it calls `spin`).

## Task 1. The web adapter sends the apology to `act`, and the guard forbids the direct call

Model: sonnet.

Files: `web/src/data/supabase.ts`, `web/src/data/supabase.test.tsx`, `tools/check-web-reads.mjs`,
`tools/test-web-reads.mjs`.

- Tests first, in `web/src/data/supabase.test.tsx` beside "writes through the act function": `api.apologize(move,
  character, title, body)` sends one POST to `/functions/v1/act` with the body
  `{ action: 'apologize', move, character, title, body }` (and `framing` when given, as spin's test shows), sends
  nothing to `/rest/v1/rpc/apologize`, and maps the answer `{ thread, act }` as `spin` does; a refusal from `act` with
  a `field` (`{ error: 'body is empty', field: 'body' }`, status 400) comes back as that refusal; a 5xx comes back
  `uncertain`, so the spin form looks before it resends. Red run: the request goes to the rpc path.
- In `tools/test-web-reads.mjs`: `client.rpc('apologize', {})` fires. Red run: it is clean while the name is listed.
- The change: `apologize` in `supabase.ts` becomes
  `act({ action: 'apologize', move, character, title, body, ...framed(framing) }, withThread)`. The adapter's own
  malformed-id refusal goes with the rpc call; `act` refuses a malformed id by field, as for every other action.
  `apologize` leaves `ALLOWED_RPCS` and its comment line leaves with it (`my_apologies` stays: it is a read).
- Poison for the guard: put the old `client.rpc('apologize', …)` line back in `supabase.ts`, run
  `node tools/check-web-reads.mjs`, record the red run, restore.

## Task 2. The in-memory backend reads an apology as the server does

Model: sonnet.

Files: `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`, `engine/ui/composer/barred.test.tsx`.

- Tests first. In `fake.test.tsx`: an apology with an empty (or whitespace) body is refused with the action rule's
  words and `field: 'body'`, and writes no thread, no Act and no apology row; a title over the limit is refused by
  `title`; signed out, it is refused with "sign in to act". In `barred.test.tsx`: sending an apology with no body
  shows the refusal on the form, the form stays open with what was typed, and a body then typed sends it. Red runs:
  the fake accepts the empty body.
- The change: `apologize` in `fake.ts` begins with `request({ action: 'apologize', move, character, title, body,
  framing })`, in the same place and order `spin` reads its request, before its own checks. If a test elsewhere sent
  an empty apology and now fails, the test is given a body; the screens are not changed. The file's header list of
  where the fake differs from the server needs no new line: this removes a difference.

## Task 3. An apology through `act`'s core against the real migrations

Model: sonnet.

Files: `supabase/tests/e2e/0002-actions.ts` (a new test in it).

- A new test beside the first: seed the instance, an account and a debuted character, a staff move that bars the
  character from a board and asks an apology (the rows `supabase/tests/0127-bars-apologies.sql` builds are the model),
  then, as the player through `runAction`:
  - `{ action: 'apologize', move, character, title, body: '' }` answers 400 with `field: 'body'`, and no thread, Act
    or `apologies` row was written;
  - the same with a body answers 200 with `{ thread, act }`, the Act a `spin` whose target is the move, one `pending`
    row in `apologies`, and the answer's live updates name the thread and the Act (through `handleAction` with a
    recording broadcaster, if `runAction` does not return them; `core.test.ts` shows the stubbed form);
  - a second apology at once is refused in the SQL function's words (a 4xx whose error says one is still waiting).
- This test passes on today's server, which was never wrong; what it has not had is a run. Its red run is a poison:
  in a scratch edit rename `in_move` to `move` in `actions.ts`'s `apologize` rule, run the test, record the failure,
  restore. Run with `node tools/test-sql.mjs` (or the narrowest filter it takes).

## Task 4. The apology form says the rule it now meets

Model: sonnet.

Added during the build (a plan gap, found after Task 2): Task 2 said the screens are not changed, and that was wrong.
The spin form (`engine/ui/spin/SpinForm.tsx`) labels the body "Your opening post (optional)" in an apology too, which
stops being true the moment the apology reaches the action rules, and it shows a refusal's words bare, so a player who
sent an apology with no body would read only "is empty". Out of character the screens speak plainly and truly
("The fiction may lie; the log never does"), so the form previews the rule the server holds.

Files: `engine/ui/spin/SpinForm.tsx`, its tests (`engine/ui/spin/`), `engine/ui/composer/barred.test.tsx`.

- Tests first: in an apology the body's label is "Your apology" and does not say "optional"; "Send apology" is
  disabled until the body holds something other than whitespace (as the button already is for an empty title), and
  enabled once it does; a refusal that names a field is worded with the field's label, in an apology and in a spin
  ("Your apology is empty", "The thread title is longer than N characters"), while a refusal with no field, and an
  uncertain answer, read as they do today. In a spin nothing else changes: the label still says "(optional)" and an
  empty body still sends. Task 2's form test in `barred.test.tsx` is kept as the server's refusal reaching the form: it
  reaches the rule with a body the button lets through and the rule calls empty (a zero-width space), and asserts the
  full sentence. Red runs: the label, the enabled button, the bare "is empty".
- The change is in `SpinForm.tsx` alone. The button is a preview; the server (and the fake) still decide.

## After the tasks

`npm run build`, the PR against main, the final review. The PR says it fixes the first item of #371 and does not
close the issue, which is an umbrella; the item's checkbox is ticked when the PR merges.

## Review focus

- A refusal's words and timing through `act` are the same for any caller: nothing in the apology's path answers from
  who owns the move's character beyond what `apologize` in SQL already refuses ("A response never proves a private
  fact").
- An apology whose answer is lost (a 5xx from `act`) is never resent by the adapter; the form looks for the thread
  first (`SpinForm.tsx`, `look`), so a character is not left with two apologies or none ("No player is ever stuck").
