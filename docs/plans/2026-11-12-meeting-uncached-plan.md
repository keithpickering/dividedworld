# The meeting is sent uncached: the plan

Record, written 2026-11-12. The design is `docs/plans/2026-11-12-meeting-uncached-design.md`. The PR that carries this
plan out says `Closes #509`.

## The layers

- **Engine:** `ChatRequest` in `engine/system/model.ts` loses `cachePrefix`; the cassette key's test stops listing it.
- **Edge:** the Anthropic adapter stops marking a prefix; the meeting job stops asking for one; the e2e fake's reader
  of block content goes.
- **Divided World:** nothing.

## Task 1. The meeting asks for no cached prefix, and nothing can

Model: inline

**Files:** `supabase/functions/meet/core.test.ts`, `supabase/functions/meet/core.ts`, `engine/system/model.ts`,
`supabase/functions/_shared/models/anthropic.ts`, `supabase/functions/_shared/models/index.test.ts`,
`engine/rehearsal/cassette.test.ts`.

Tests first:

1. In `core.test.ts`, the test "a meeting is three chat calls in order, each with its part's schema, rule and token
   cap, the same cached prefix, and the earlier answers as prior turns" (around line 832): its name drops "the same
   cached prefix, " and its assertion `m.chats.map((c) => c.cachePrefix)` equal to `[true, true, true]` becomes
   `m.chats.map((c) => 'cachePrefix' in c)` equal to `[false, false, false]`. Run it and record the red: core.ts still
   sends `cachePrefix: true`.
2. In `index.test.ts`, replace the test "a request with cachePrefix marks the system prompt and the first message's one
   text block as cacheable; without it neither is marked" (around line 57) with "a chat request sends its system
   prompt and each message as plain strings, with no cache mark". It sends a three-message chat (user, assistant,
   user), and asserts that `body.system` is the string `'You are the Director.'`, that `body.messages` deep-equals the
   three messages as `{role, content}` with string content, and that the body's raw JSON contains no `cache_control`.
   This passes before the change (no flag is sent), and holds the adapter to it after.

Then the change:

- `core.ts` line 321: remove `cachePrefix: true,`. Update the comment above the message's last line ("so the message
  is the same in all three calls and is the cached prefix") to say only that the message is the same in all three
  calls.
- `model.ts`: remove `cachePrefix` and its doc comment from `ChatRequest`.
- `anthropic.ts`: remove the `cachePrefix` comment and `mark`, and send `system: request.system` and
  `messages: request.messages.map((m) => ({ role: m.role, content: m.content }))`. The header comment gains one
  sentence: no cache mark is sent, because the meeting's parts differ in schema, the schema is part of the cached
  prefix, and a mark only paid the write premium (`docs/plans/2026-11-12-meeting-uncached-design.md`).
- `cassette.test.ts` line 25: remove `{ cachePrefix: true }` from the changed fields.

Run `npm run typecheck`: it shows no use of `cachePrefix` is left. `grep -rn cachePrefix engine supabase tools` finds
nothing. Show the green run of both test files.

## Task 2. The e2e fake reads strings

Model: inline

**Files:** `supabase/tests/e2e/meeting-fake.ts`.

The adapter no longer sends block content, so `textOf`'s block branch has nothing to read. Tidy: `Content` becomes
`string | undefined`, `textOf` returns `content ?? ''`, and the header comment's sentence about `cachePrefix` and
"[object Object]" is removed (`systemOf`, `firstMessageOf` and `lastMessageOf` stay, reading strings). Check
`grep -rn "textOf\|systemOf\|firstMessageOf" supabase/tests` for callers that pass anything other than a body's
content. Run the e2e suites that import `meeting-fake.ts` and show them green.

## Task 3. The build

Model: inline

Run `npm run typecheck` and `npm run build:ci`, and show both green.

## Review focus

- **Cassettes recorded before this change** no longer match a meeting's request: the key hashes every request field,
  so removing `cachePrefix` changes it. Cassettes are git-ignored and local, so a replay of an old one re-records its
  meetings, and nothing committed breaks. Confirm that replay mode reports the mismatch plainly and does not answer
  stale.
- **The ledger's cache columns** stay priced as the usage block reports them. Confirm no code path now assumes cache
  tokens are zero, and that rows already written are untouched.
- **No other duty** relied on the Anthropic adapter sending block content (`grep` for `type: 'text'` readers of a
  request body in tests and fakes).
