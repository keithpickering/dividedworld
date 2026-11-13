# You Were Saying?'s voice: plan

Record, written 2026-11-13. Carries out `docs/plans/2026-11-13-you-were-saying-voice-design.md` (its sections are cited as
§N), task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. One migration is
added (Task 2), tested on Postgres on localhost; no task touches a deployed database or service. Engine: Tasks 1 to 4.
Instance: Task 5, and Divided World's defaults in Task 2. The interface that carries the instance's part is `Writes`
(`engine/rules/cards.ts`), which gains `sampling`, and `WriteFrameInput`, which gains `sofar`, with the frame's answer
gaining `stopPattern` (Task 3). No check is added, so no poison is needed. No state a player, a character or a post can
be put in is added, and no response, payload, Realtime event or timing is computed from a private fact (§6).

The order: 1 and 2 (independent), then 3 (needs 1), 4 (needs 1, 2 and 3), 5 (needs 3), 6 last.

## Task 1. The completion request's sampling and the cut's pattern (engine)

Model: sonnet

**Files:** `engine/system/model.ts` (`CompletionRequest`), `engine/system/validate.ts` (`cutCompletion`),
`engine/system/tokens.ts` (a new `tokenId`), `supabase/functions/_shared/models/completions.ts` (`complete`),
`supabase/functions/_shared/models/index.ts` (`complete`, which passes the pattern to `cutCompletion`). Tests:
`engine/system/validate.test.ts`, `engine/system/tokens.test.ts`, `supabase/functions/_shared/models/index.test.ts`.

**What:**
- `CompletionRequest` gains optional fields, each with a doc comment: `topK`, `minP`, `repeatPenalty`, `repeatLastN`,
  `ignoreEos` (boolean), `ban` (readonly token ids the answer may never contain), and `stopPattern` (a `RegExp` the
  answer is also cut at, applied where the answer is cut and never sent; for a stop a plain string cannot say).
- `complete` in completions.ts adds to the body only the fields set: `top_k`, `min_p`, `repeat_penalty`,
  `repeat_last_n`, `ignore_eos`, and `logit_bias` as `[[id, false], …]` (llama.cpp's array form) for a non-empty `ban`.
  A request that sets none of them sends exactly today's body, so the Mod Bots' chatter and filing calls are unchanged.
- `cutCompletion(text, stop, most, lines, pattern?)`: the cut is at the earliest of the stops and the pattern's first
  match (searched in the same `body` the stops are). Index.ts passes `request.stopPattern`.
- `tokenId(kind, text)`: the id of `text` when it is exactly one token of the instance's tokenizer, else null; `gpt2`
  reads `encoder` in the vendored `bpe.json` through the module's bytes-to-unicode table (`' ---'` is `Ġ---`, 11420);
  `bytes` is always null. Edge code only, like `tokenCounter`.

**Tests first:**
- validate: a `many` cut with a pattern `/-{2,}\s*Posted by /` cuts `"a b -- Posted by X: c"` to `"a b"` and leaves
  `"posted by my friend"` whole; the earlier of a stop and the pattern wins either way round; no pattern is today's
  behavior.
- tokens: `tokenId('gpt2', '---')` is 6329, `' ---'` 11420, `'Posted'` 14231, `' Posted'` 12918; `'hello world'` is null;
  every `bytes` call is null.
- index (with the fake fetch the file already uses): a request with every new field sends `top_k`, `min_p`,
  `repeat_penalty`, `repeat_last_n`, `ignore_eos: true` and `logit_bias: [[6329, false], [11420, false]]`; a request
  with none sends exactly the keys `model, prompt, temperature, top_p, stop, max_tokens`; an answer
  `"fine -- Posted by Z: no"` with that pattern comes back `"fine"`.

## Task 2. `cardWriteTopUps` and `cardWriteFullShare` (engine, with Divided World's defaults, and a migration)

Model: sonnet

**Files:** `engine/rules/types.ts` (`Settings`), `engine/rules/instance.ts` (`SETTINGS`), `engine/rules/test-system.ts`,
`instances/divided-world/settings.ts`, every settings fixture the type check names, a new migration
`supabase/migrations/0357_card_write_top_ups.sql`. Tests: `engine/rules/instance.test.ts`,
`instances/divided-world/settings.test.ts`, `supabase/tests/0079-settings-held.sql`,
`supabase/tests/0300-old-voice-window.sql`.

**What:** rename `cardWriteRerolls` to `cardWriteTopUps` (a whole number from 0 to 5; Divided World 3: "Up to three
more calls after the first, each continuing a tail that came back short") and `cardWriteShortShare` to
`cardWriteFullShare` (a number from 0 to 1; Divided World 0.9: "A tail under nine tenths of the tokens it bought is
topped up"). The migration redefines `settings_held` from its body in `0353_old_voice_window.sql` with the two keys
renamed and nothing else changed, renames a stored `cardWriteRerolls` row to `cardWriteTopUps` (its value and
`tuned_at` kept), and deletes a stored `cardWriteShortShare` row (§3: its meaning changed, so the next seed writes the
code's value). Its header comment says this, its ways out and its masks, in the manner of 0355's.

**Tests first:** the instance test's bad values for both new names (and the old names no longer named); the settings
test's two defaults; the SQL tests' poisons and goods moved to the new names; a test in `0300-old-voice-window.sql` (or
a new `supabase/tests/0302-card-write-top-ups.sql`) that a `cardWriteRerolls` row with `tuned_at` set survives the
migration's statements as a `cardWriteTopUps` row with both kept, and a `cardWriteShortShare` row is gone.

## Task 3. The card's sampling, its top-up input and its pattern (engine interface)

Model: sonnet

**Files:** `engine/rules/cards.ts` (`Writes`, `WriteFrameInput`, a new `WriteSampling`), and every card that writes
(today only `instances/divided-world/cards/you-were-saying.ts`, which gets today's numbers here, `{ temperature: 0.9,
topP: 0.95 }`, so this task changes no behavior; Task 5 gives it the rambler). Tests: `engine/rules/cards.test.ts`
where it covers `Writes`, and the type check.

**What:**
- `WriteSampling`: `temperature`, `topP`, and optional `topK`, `minP`, `repeatPenalty`, `repeatLastN`, and `ban`
  (readonly strings, each one token of the instance's tokenizer, the voice may never produce). Doc comments cite §1
  and §3.
- `Writes` gains `sampling: WriteSampling`.
- `WriteFrameInput` gains `sofar: string`: the text this play has written so far, `''` on a play's first call. A frame
  continues after it, and where it is not empty, after a paragraph break the frame writes.
- The frame's answer gains an optional `stopPattern?: RegExp`.

**Tests first:** a type-level test (the file's own manner) that a `Writes` without `sampling` does not compile; the
existing frame tests pass `sofar: ''` and stay green.

## Task 4. The top-up loop (engine)

Model: sonnet

**Files:** `supabase/functions/write/core.ts` (the job's generation, its doc comment's **Re-rolls** paragraph, which
becomes **Top-ups**, and `REROLL_DEADLINE_MS`, renamed `TOP_UP_DEADLINE_MS`). Tests: `supabase/functions/write/core.test.ts`,
and `supabase/tests/e2e/0020-you-were-saying.ts` where its comment and tails assume re-rolls.

**What** (§3):
- The request carries the card's `sampling` (temperature, top-p and every optional number), `ban` mapped through
  `tokenId(settings.oldVoiceTokenizer, text)` with nulls dropped, `ignoreEos: true`, and the frame's `stopPattern`.
- The loop: the first call asks for the play's `maxTokens` with `sofar: ''`. While the tail's count is under
  `ceil(cardWriteFullShare × maxTokens)` (rounded as `shortUnder` is today), fewer than `cardWriteTopUps` top-ups have
  run, and `TOP_UP_DEADLINE_MS` has not passed since the first call: renew the claim (as each re-roll did), build the
  frame again with `sofar` set to the tail so far and `budget` the window less the tokens still owed, and ask for the
  tokens still owed (`maxTokens` less the tail's count, at least 1), with `maxChars` the room left under `MOST_CHARS`
  less the two characters of the break. The tail becomes the tail so far, `'\n\n'`, and the call's text. Room under 1
  character ends the loop.
- A failure of the first call finishes the job as today (its predicate, or `unreachable`). A rejection or a transport
  failure of a top-up ends the loop and the tail so far is the text. `ClaimLost`, a database error and an unwritten
  ledger row behave as today.

**Tests first** (with the fake models the file already has):
- a first answer at the full length makes one call;
- a short first answer, then a long one: two calls, the second's prompt ends with the first answer and a paragraph
  break, its `maxTokens` is the tokens owed, and the stored text is the two joined by `'\n\n'`;
- a top-up rejected as empty (`nonEmpty`) ends the loop with the first answer stored, not refunded;
- `cardWriteTopUps: 0` makes one call whatever its length;
- the request carries `ignoreEos: true`, the card's sampling, and the ban as ids;
- the claim is renewed before each top-up and not before the first call (the existing renewal tests, moved over);
- the e2e's tails stay at least nine tenths of their 75 tokens, so each generation is still one call.

## Task 5. The rambler, the ban and the pattern (Divided World)

Model: sonnet

**Files:** `instances/divided-world/cards/you-were-saying.ts` (`writes.sampling`),
`instances/divided-world/cards/you-were-saying/frame.ts` (`youWereSayingFrame`, its doc comment, a new exported `BAN`
and `HEADER_IN_LINE`), `instances/divided-world/settings.ts` (the economy's four `youWereSaying.*` numbers),
`instances/divided-world/ui/cards.ts` (`describe`). Tests: `instances/divided-world/cards/you-were-saying.test.ts`,
`instances/divided-world/settings.test.ts`, and any test the new economy numbers turn red, which is changed to say
them.

**What:**
- The sampling (§1): `{ temperature: 0.9, topP: 0.95, topK: 40, minP: 0.05, repeatPenalty: 1.6, repeatLastN: 64, ban: BAN }`,
  with a comment citing the design's measurements (§0).
- `BAN` (§3): `Posted`, `Quote`, and the dash runs of lengths 2 to 16, 20, 24, 32, 48, 56 and 64 that GPT-2 has a token
  for, each with and without a leading space where that is a token (the session's list: 37 strings).
- The frame: `sofar` is flattened like a tail and follows the tails; where it is not empty the prompt ends with it and
  `'\n\n'`, which the frame alone writes. The fitting clips it with the tails (the tails' text and `sofar` together
  are the last material clipped, from their start), and the break is never clipped. The answer carries
  `stopPattern: HEADER_IN_LINE`, `/-{2,}[ \t]*Posted by /`.
- The economy: `youWereSaying.baseTokens` 50, `stepTokens` 50, `stepPrice` 25, `mostTokens` 300.
- `describe`: "from about 50 tokens, a short paragraph, up to 300, a rant" in place of today's sentence's numbers and
  words (the numbers still read from the settings).

**Tests first:**
- every string in `BAN` is one GPT-2 token (`tokenId('gpt2', s) !== null`), and the list holds 37;
- a frame with `sofar: ' and then'` ends `"…What are your favorite games and then\n\n"` (the tails before it kept), and
  with `sofar: ''` ends where today's does;
- a frame squeezed by a small budget with a long `sofar` keeps its end and the break;
- the pattern matches `--- Posted by A:` and `-- Posted by B:` mid-line and not `posted by my friend`;
- `mostSteps(defaults)` is 5 and a play of 5 steps buys 300 tokens and costs 125;
- the settings test's four numbers.

## Task 6. The README

Model: inline

**Files:** `README.md` ("The old voice's server").

**What:** the settings paragraph names `cardWriteFullShare` (0.9) and `cardWriteTopUps` (3) in place of the two old
names, in one sentence saying a tail short of this share is continued, up to this many more calls; and one sentence
after the server's setup says that You Were Saying? sends llama.cpp's sampling fields (`top_k`, `min_p`,
`repeat_penalty`, `repeat_last_n`, `ignore_eos`, `logit_bias`), so its server is `llama-server` (§5, §7).

**Tests first:** none; `npm run build`'s path check reads the README.

## Review focus

- Plays that already landed regenerate in the new voice at their bought 25 tokens on the next edit; nothing else about
  them changes, and a regeneration's top-ups never ask for more than the play bought.
- A tuned economy row on the deployed instance keeps 25/25/200 (0355's seed fills only missing keys); the PR says so
  for the owner.
- The migration on an instance holding tuned `cardWriteRerolls` or `cardWriteShortShare` rows, and on a re-run.
- The Mod Bots' chatter and filing requests send byte-for-byte today's body.
- A stored tail never passes 4,000 characters (`MOST_CHARS`, `require_write_tokens` in 0149) however many top-ups join.
- The ban is sent as ids in llama.cpp's array form; whether the deployed llama.cpp honors it is checked on the instance
  after deploy, by a play's `model_calls` rows and its tail, and is the owner's to see.
