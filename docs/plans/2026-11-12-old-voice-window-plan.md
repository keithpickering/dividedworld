# The old voice's window: plan

Record, written 2026-11-12. Carries out `docs/plans/2026-11-12-old-voice-window-design.md` (its sections are cited as
§N), task by task.

Every task is test first: the test named, its red run recorded, then the code, then the green run. One migration is
added (Task 2), tested on Postgres on localhost; no task touches a deployed database or service. Engine: Tasks 1 to 5
and 7. Instance: Task 6 and Divided World's defaults in Task 1. The interface that carries the instance's part is
`WriteFrameInput` (`engine/rules/cards.ts`), which gains `budget` and `count` (Task 4). No check is added, so no
poison is needed. No state a player, a character or a post can be put in is added (§6). No response, payload,
Realtime event or timing is computed from a private fact. The settings added to `screen_settings` are public, and a
re-roll's delay depends on the model's words alone (§6).

The order: 1, then 2 and 3 (independent of each other), then 4 (needs 1 and 3), 5 (needs 4), 6 (needs 1 and 4), 7
(needs 1 and 3), 8 last.

## Task 1. The five settings (engine, with Divided World's defaults)

Model: sonnet

**Files:** `engine/rules/types.ts` (`Settings`), `engine/rules/instance.ts` (`SETTINGS`, `settingsProblems`),
`engine/rules/cards.ts` (a new `writeTokensMost`), `instances/divided-world/settings.ts`, and every settings fixture
the type check then names (`engine/rules/test-system.ts` and the tests' own). Tests: `engine/rules/instance.test.ts`,
`engine/rules/cards.test.ts`.

**What:** five settings, each with a doc comment in the manner of `cardWriteSettleSeconds`:
- `oldVoiceWindow`: the old voice's context window in tokens, prompt and output together. A whole number from 64 to
  1,000,000. Divided World: 1024.
- `oldVoiceTokenizer`: `'gpt2' | 'bytes'`, the counter the instance's model takes (§2). Divided World: `'gpt2'`.
- `oldVoicePromptFloor`: the least prompt a play leaves room for, in tokens. A whole number, at least 1. Divided
  World: 256.
- `cardWriteShortShare`: under this share of its tokens a card's text is short and rolled again (§5). A number from 0
  to 1; 0 never re-rolls. Divided World: 0.5.
- `cardWriteRerolls`: the most rolls after the first. A whole number from 0 to 5. Divided World: 3.

`settingsProblems` also says, in its own sentence, when `oldVoicePromptFloor` is not below `oldVoiceWindow`.
`writeTokensMost(settings)` is `Math.min(WRITE_TOKENS_MOST, settings.oldVoiceWindow - settings.oldVoicePromptFloor)`,
and its doc comment cites §4.

**Tests first:**
1. Each of the five refuses a value outside its bounds, with the words above (one case per setting: 63 and
   1,000,001 for the window, `'llama'` for the tokenizer, 0 for the floor, 1.5 for the share, 6 and 2.5 for the
   rerolls).
2. A floor equal to the window is refused, naming both settings. A floor one below it is held.
3. Divided World's settings hold all five, and `instanceProblems` is empty for the instance as compiled.
4. `writeTokensMost` is 768 for Divided World's settings, 2000 for a window of 100,000 and a floor of 256 (bounded by
   `WRITE_TOKENS_MOST`), and 144 for a window of 400 and a floor of 256.

## Task 2. The database holds them, and the screens read two (SQL and data layer)

Model: sonnet

**Files:** a new migration, `supabase/migrations/NNNN_old_voice_window.sql` at the next free number (0343 as this is written), and its test `supabase/tests/NNNN-old-voice-window.sql`;
`engine/ui/data/api.ts` (`ScreenSettings`); `web/src/data/supabase.ts` (where it reads `screen_settings`);
`engine/ui/data/fake.ts` (its screen settings). Read `supabase/migrations/0340_conduct.sql` (the last `settings_held`)
and `supabase/migrations/0156_back_ends.sql` (the last `screen_settings`), and `supabase/tests/0079-settings-held.sql`
for the test's manner.

**What:** the migration re-creates `settings_held` from 0340's definition, whole, with five cases added, each worded
as Task 1's. The floor-below-window relation is not checked here, since each row is checked alone (§4: the most is
computed, so no pair can be wrong). It re-creates the `screen_settings` view from 0156's definition with
`oldVoiceWindow` and `oldVoicePromptFloor` added. The header comment cites §4 and names what is unchanged.
`ScreenSettings` gains the two as numbers, the web reader lays them over the compiled defaults as it does every key,
and the fake carries them.

**Tests first:**
1. (SQL) A settings row of each new key with an out-of-bounds value is refused with Task 1's words. One in bounds is
   held.
2. (SQL) `screen_settings` returns `oldVoiceWindow` and `oldVoicePromptFloor` from their rows to `anon`.
3. (`web/src/data/supabase.test.tsx`) a `screen_settings` that lacks the two reads as the compiled defaults, and one
   that holds them reads them.

## Task 3. The counter (engine)

Model: sonnet

**Files:** a new `engine/system/tokens.ts`, its test `engine/system/tokens.test.ts`, and a new directory
`engine/system/tokenizers/gpt2/` holding the vendored vocabulary as one JSON file (`bpe.json`: `{ encoder, merges }`),
its `LICENSE` (MIT, from openai/gpt-2), and a `README.md` saying where it came from, on what date, and how `bpe.json`
was made from the two published files.

**What:** `tokenCounter(kind: Settings['oldVoiceTokenizer']): (text: string) => number`.
- `bytes` is the text's UTF-8 length, with a lone surrogate counted as the replacement character's three bytes.
- `gpt2` is GPT-2's byte-level BPE in plain TypeScript: the published pre-tokenizing pattern, the bytes-to-unicode
  table, then merges by rank. Each piece's result is kept in a bounded cache.
- The vocabulary comes from `openai-community/gpt2`'s `vocab.json` and `merges.txt` (or the same files at
  `openaipublic.blob.core.windows.net/gpt-2/encodings/main/`), merged into `bpe.json` once, and imported with
  `with { type: 'json' }` so it loads the same way in Node's tests and in Deno.
- Only edge code imports this module (§2). The doc comment says so: a card's frame gets the counter as a function
  (Task 4).

**Tests first:**
1. `gpt2` counts `hello world` as 2 (ids 31373 and 995), and the empty string as 0.
2. A table of at least 12 golden counts: English, a run of spaces, a URL, BBCode, an emoji with a skin tone, CJK,
   Cyrillic, digits, `'s`, a newline run, a 2,000-character post. The counts are produced once by Python's `tokenizers`
   (`ByteLevelBPETokenizer` loaded from the same `vocab.json` and `merges.txt`). The test's comment holds the script,
   so anyone can produce them again.
3. For 500 seeded random strings over mixed scripts, emoji and lone surrogates, `gpt2` ≤ `bytes`: the bound §2 relies
   on.
4. A text of 100,000 characters is counted in under a second.

## Task 4. A budget for the card's frame, and the refusal before sending (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts` (`WriteFrameInput`), `engine/system/model.ts` (a new `PromptTooLong extends
AnswerRejected`), `supabase/functions/_shared/models/index.ts` (`ModelOptions`, `complete`),
`supabase/functions/write/core.ts`, every place `models(…)` is made (`supabase/functions/act/index.ts`, and the
`chatter`, `meet`, `staff` and `write` handlers), and `tools/rehearse/models.ts`. Tests:
`supabase/functions/_shared/models/index.test.ts`, `supabase/functions/write/core.test.ts`.

**What:**
- `WriteFrameInput` gains `budget: number` (the prompt's most tokens) and `count: (text: string) => number`.
- `ModelOptions` gains a required `oldVoice: { window: number; count: (text: string) => number }`, so the type check
  names every construction. Each passes `oldVoiceWindow` and `tokenCounter(oldVoiceTokenizer)` from its tuned
  settings.
- `complete` counts the prompt before anything is sent. If `count(prompt) + maxTokens > window`, it throws
  `PromptTooLong` (predicate `promptTooLong`). The ledger row is `failed` with that predicate and no usage, as for
  `SchemaRefused`.
- In `complete` only, a `ProviderRefusal` becomes `AnswerRejected` with the predicate `refused:<status>` (§3), and its
  row is `rejected`. `chat` is unchanged.
- The write job's generation asks for `maxTokens = min(job.tokens, writeTokensMost(settings))` (§4) and hands the frame
  `budget = oldVoiceWindow - maxTokens` and the counter.

**Tests first:**
1. A prompt one token over the budget is refused with `promptTooLong` and no fetch made; one exactly at it is sent.
   The ledger row is `failed`, with the predicate.
2. A 400 from the endpoint is a rejection `refused:400` after one fetch, with no retry; a 503 is still retried.
3. In the write job, a frame that ignores its budget ends the job at once (`finish_card_write` with `promptTooLong`),
   not left claimed: the first claim finishes it.
4. A play that bought 768 tokens, under settings whose window less floor is 400, is asked for 400 and framed with a
   budget of `window − 400`.

## Task 5. Re-rolling a short tail (engine)

Model: sonnet

**Files:** `supabase/functions/write/core.ts`, `supabase/functions/write/core.test.ts`.

**What** (§5): the generation is a loop of at most `1 + cardWriteRerolls` tries, each a `scrubbedComplete` with the same
request. A try's length is `count(text)`, using the counter Task 4 hands the frame. A try is short when its length
is under `Math.ceil(cardWriteShortShare × maxTokens)`. The first try that is not short ends the loop. Otherwise the
longest is kept, the earliest on a tie.
- An `AnswerRejected` or a `TransportFailure` on the first try finishes the job as now. On a later try it ends the loop
  and the best so far is finished as the text.
- A database error or a `LedgerWriteFailed` on any try stops the run as now.
- No try starts once `REROLL_DEADLINE_MS` (120,000) has passed since the job's first call (read from the job's
  `now`), and the constant's comment says why: the claim is five minutes.
- The module's header comment gains a **Re-rolls** paragraph in its manner.

**Tests first** (a fake `Models` answering a scripted sequence):
1. Answers `?`, then 150 tokens' worth, for a 200-token play: two calls, and the 150 is finished.
2. Four short answers of lengths 3, 40, 12 and 40: four calls, the first 40 is finished.
3. A long first answer: one call.
4. `cardWriteRerolls` 0: one call, whatever its length. `cardWriteShortShare` 0: one call.
5. A short first try then a scrub rejection: the short text is finished, not the rejection.
6. A clock past the deadline after the first short try: one call, the short text finished.
7. A regeneration after an edit and a staff play (`tokens` from the play) re-roll the same way.

## Task 6. You Were Saying?'s frame fits its budget, and its slider fits the window (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/you-were-saying/frame.ts`, `instances/divided-world/cards/you-were-saying.ts`
(`mostSteps`), `instances/divided-world/cards/you-were-saying/ConfigForm.tsx`. Tests:
`instances/divided-world/cards/you-were-saying.test.ts`,
`instances/divided-world/cards/you-were-saying/ConfigForm.test.tsx`.

**What:**
- The frame keeps its character caps and then fits `budget` with `count`, in §3's order: earlier posts dropped oldest
  first; the title clipped to 40 characters, then to none (`Thread:` with nothing after it); the post's text clipped
  from its start; and last, the chained tails' text clipped from its start.
- Each clip searches for the most characters that fit by bisection, so a 2,000-character post costs about a dozen
  counts, not a thousand. The page header, the author line and the end of the post's text with its tails are never
  removed.
- A budget even those cannot meet returns the smallest prompt. `models.complete` refuses it (Task 4), and the frame
  never throws.
- The header comment states the order and cites §3.
- `mostSteps(settings)` reads its most as `Math.min(mostTokens, writeTokensMost(settings))`, so the slider, the
  price and the recorded tokens agree (§4). The form lays `screen_settings`' `oldVoiceWindow` and
  `oldVoicePromptFloor` over the instance's settings before it reads `mostSteps`.

**Tests first** (with the `bytes` counter unless the case says `gpt2`):
1. Under budget, the prompt is unchanged from today's, byte for byte.
2. Over budget with 8 earlier posts: the oldest go first, and the newest earlier post is the last of them to go.
3. With no earlier posts left, the title is clipped, then emptied, before the post loses a character.
4. A 2,000-character post with a budget of 100 bytes keeps the header, the author line and the post's last
   characters, and ends exactly where the post (and its tails) end.
5. Three chained tails over budget: the tails' end survives, and the prompt still ends with the last tail's text.
6. With the `gpt2` counter and a 1,024 window less 200, a thread of 8 posts of 500 characters and a 2,000-character
   post fits (count ≤ budget).
7. `mostSteps` for a window of 400 and a floor of 256 is 4 (most 144, base 25, step 25). For Divided World's settings
   it is unchanged (7).
8. (`ConfigForm.test.tsx`) with `screen_settings` holding a window of 400 and a floor of 256, the slider's last stop is
   step 4.

## Task 7. The pool post and filing frames fit their budget (engine)

Model: sonnet

**Files:** `engine/system/chatter.ts` (`chatterCompletion`), `engine/system/judgment.ts` (`filingCompletion`),
`supabase/functions/chatter/core.ts` (the old-voice call), `supabase/functions/staff/core.ts` (the old-voice filing
call). Tests: `engine/system/chatter.test.ts`, `engine/system/judgment.test.ts`,
`supabase/functions/chatter/core.test.ts`, `supabase/functions/staff/core.test.ts`.

**What:**
- Both frames take a `fit: { budget: number; count: (text: string) => number }`. They drop thread posts oldest first,
  then clip the title as Task 6 does.
- The persona's own `Name:` line, and a filing's `[Moderator action: …]` line, are never removed.
- The callers ask for `maxTokens = min(400 or 160, writeTokensMost(settings))` and pass `budget = oldVoiceWindow −
  maxTokens` with `tokenCounter(oldVoiceTokenizer)`.
- A `promptTooLong` or `refused:<status>` comes back as the rejection it is, and the existing stock line or failure
  path takes it. The tests show it, and no new path is added.

**Tests first:**
1. Under budget, each frame's prompt is unchanged, byte for byte.
2. Over budget, the oldest thread posts go first, and the last line is still the persona's `Name:`.
3. A filing over budget keeps the moderator-action line.
4. (`chatter/core.test.ts`, `staff/core.test.ts`) a fake `Models` that refuses with `promptTooLong` leads to the
   existing rejected path (a pool post's failure; a filing's stock line).

## Task 8. The README's old voice gains the new settings (docs)

Model: inline

**Files:** `README.md`.

**What:** the old voice's part of step 5 gains a paragraph naming `oldVoiceWindow`, `oldVoiceTokenizer`,
`oldVoicePromptFloor`, `cardWriteShortShare` and `cardWriteRerolls`, with Divided World's defaults, and says that the
window and tokenizer change with the model. Each path named exists.

## Review focus

- Plays already in `card_writes` when this deploys: a job queued before the change is framed with a budget and
  re-rolled on its next claim. Nothing in the queue's rows changes shape.
- The vendored vocabulary must stay out of the browser's bundle. Check that nothing under `engine/ui/`,
  `instances/` or `web/` imports `engine/system/tokens.ts`, and that the built web bundle holds no `bpe.json`.
- A re-roll multiplies the calls per play by up to four, and each scrub hit adds one. Check the deadline holds a job
  inside its five-minute claim with the endpoint answering at its 60-second timeout.
- `count` runs inside the bisection on every job. At a busy instance's scale (many jobs a minute), check that the
  cache bound holds memory flat across a run.
- A prompt the count fits but the server still refuses (a server whose window is smaller than the setting) must end in
  `refused:400`, never a crash loop through `attempts`.
- The frame's output under budget must be byte-identical to today's, so a tail generated before and after the change
  continues the same page.
