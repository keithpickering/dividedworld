# The old voice's window: prompts that fit, and tails that use their length

Record, written 2026-11-12. A design session with the owner. It started from the first casts of You Were Saying? on the
deployed instance after its completion server came up. Its plan is `docs/plans/2026-11-12-old-voice-window-plan.md`.
Each decision below was asked one at a time and answered by the owner, except where a section says it is the session's
own choice. The owner confirmed the whole summary before the plan was written.

## 0. Where it starts

- **The server.** The old voice runs as GPT-2 XL (1.5B, Q8 GGUF) on llama.cpp's `llama-server` with `-c 1024`, on a
  small VPS behind Caddy, as the System design's section 6 intended. GPT-2's learned position embeddings stop at 1,024
  tokens, so 1,024 is a hard window, prompt and output together.
- **Three callers send it prompts**, and none of them knows the window. Each frame bounds itself in characters only:
  - You Were Saying?'s frame (`instances/divided-world/cards/you-were-saying/frame.ts`): up to 8 earlier posts of 500
    characters, 2,000 characters of the post, and every tail already chained on it. Its output is up to 200 tokens by
    the economy, and up to `WRITE_TOKENS_MOST` (2,000) by the server's bound. That is about 6,500 characters (~1,600 tokens) before a word is
    written.
  - The old-voice pool post (`chatterCompletion`, `engine/system/chatter.ts`), with 400 output tokens, and the
    old-voice filing (`filingCompletion`, `engine/system/judgment.ts`), with 160. Each frame's length is
    `chatterThreadPosts` × `digestExcerptChars`, so whether either overflows depends on the settings.
- **An overflow is handled as a bug.** A server's refusal comes back as a `ProviderRefusal`, which the write job
  (`supabase/functions/write/core.ts`) treats as an unknown error. It is logged and left claimed, retried twice over
  about 12 minutes, and only then finished `unreachable` and refunded. A prompt too long for the window fails every time,
  so the two retries are wasted.
- **Length is a ceiling, not a target.** The first working cast bought 200 tokens ("a rant") on a 39-character post
  that read as a question. GPT-2 wrote `?`, judged the post finished and began the next post's header, where the
  frame's stops cut it. Three tokens out of 200. The You Were Saying? design (section 3) says the tail stops at its cap
  or where the text starts a new post. Nothing makes the model use the length bought.

## 1. Scope

**Decided** (the owner chose the recommendation): every old-voice call is fixed, not the card alone. The missing piece
is the completion interface's: it has no notion of a window. So the instance says what the window is, the engine gives
every old-voice frame a budget and a counter, and the interface refuses a prompt that would not fit before it is sent.
The re-roll of short tails (section 5) is for cards that write only: a pool post or a filing is one line, and a short
one is fine.

Weighed: the card alone (chatter and filings stay exposed until a setting tips them over); leaning on the server to
cope, by a longer-context model or its own truncation (not portable: llama.cpp, vLLM and text-generation-inference each
do something different, and "Portable by construction" lets an instance swap its server).

## 2. Counting tokens

**Decided** (the owner chose the recommendation): the engine ships GPT-2's tokenizer. GPT-2, GPT-Neo and GPT-J share
one byte-level BPE, so the count is exact for every model the System design names. The setting `oldVoiceTokenizer`
says which counter the instance's model takes: `gpt2`, or `bytes` for any other model. `bytes` counts one token for
each UTF-8 byte, which a byte-level BPE never exceeds, so it is a guaranteed bound for any such model. It is too
conservative to be the main counter: English runs about four bytes a token, so it would spend about three quarters of
the window.

- The counter is plain TypeScript with GPT-2's published vocabulary and merges vendored beside it. No package is added
  and no server call is made.
- It is engine code that only the edge imports. The frames are handed a counter as a function, so the vocabulary never
  reaches the browser's bundle (the card's rules, and so its frame, are imported by the screens).

Weighed: asking the server (`/tokenize` exists on llama.cpp, vLLM and text-generation-inference, but in three shapes,
none in the OpenAI-compatible API, at a round trip per try, behind another path Caddy must expose); the byte bound
alone (safe and dependency-free, and about 800 bytes of prompt for GPT-2: a few sentences of the post and no thread).

## 3. Fitting the prompt

**Decided** (the owner chose the recommendation): each frame is given a budget, the window less the output's
`maxTokens`, and the counter, and drops the oldest material first. What the model continues is always kept.

- **You Were Saying?**: earlier posts are dropped one at a time, oldest first. Then the title is shortened. Then the
  post's own text is clipped from its start. The page header, the post's author line, the post's last words and the
  tails already chained on it are kept. If those alone are over budget, the chained text is clipped from its start
  too, since its end is where the model continues.
- **Pool post and filing frames**: the oldest thread posts are dropped first, then the title is shortened. The persona's
  own line (and a filing's moderator-action line) is kept.
- **The interface refuses what still does not fit.** `models.complete` counts the final prompt before anything is
  sent. Over the window less `maxTokens`, it throws a rejection with the predicate `promptTooLong` and writes the call's
  ledger row as `failed` with that predicate (nothing was sent, as for a refused schema). The write job finishes the
  play at once with that predicate, and a first generation refunds by the existing path. A pool post or a filing
  falls back to its stock line, as for any rejection.
- **A server's own refusal ends at once too** (the session's choice, inside the owner's "fix the failure handling"): a
  4xx from the completions endpoint (an overflow the count missed, a bad key) becomes a rejection with the predicate
  `refused:<status>`, never an unknown error retried by claims. A 5xx and a 429 stay transport failures, retried as
  now.

Weighed: shrinking every part by the same fraction (the post's own start is cut while an old post that matters less
survives); dropping all thread context before touching the post (simple, and loses the thread's mood, which the frame
was built to carry).

## 4. The window bounds what a play may buy

**Decided** (the owner chose the recommendation): a play's length fits inside the window with room for a prompt. The
setting `oldVoicePromptFloor` (256 tokens to start) is the least prompt a play leaves room for. So the most any card
that writes may buy is the smallest of `WRITE_TOKENS_MOST` and the window less the floor. On GPT-2 that is 768 tokens,
well above You Were Saying?'s 200.

- **The settings live in the database** (the owner chose the recommendation over Edge Function secrets):
  `oldVoiceWindow`, `oldVoiceTokenizer` and `oldVoicePromptFloor` are instance settings beside `oldVoice`, with Divided
  World's defaults in its `settings.ts`. An admin changes them with the model. `screen_settings` carries the window
  and the floor, so the length slider offers only lengths that fit. Secrets were weighed: they keep everything about
  the server together, but the browser cannot read them, so the slider would offer a length the server then cuts.
- **The session's refinement of the owner's "a settings check refuses a bad pair"**: the card's most is computed as
  the smaller of its own `mostTokens` and the window less the floor, wherever the most is read (the slider, the price,
  the tokens a play records). No pair of settings can then be wrong, so none needs refusing, and a row that lowers the
  window never stops the instance the way a failed `instanceProblems` would. What is checked is the window and the
  floor alone: the floor is at least 1 and below the window.
- **A play bought before the window shrank** is generated at the smaller of what it bought and the window less the
  floor. It is never refused or left waiting, and the caster's log says how many characters it added, as now.

## 5. Re-rolling a short tail

**Decided** (the owner chose the recommendation): a tail well short of its length is rolled again, and the longest is
kept.

- **Short** is under `cardWriteShortShare` (0.5) of the tokens the generation asks for, counted by the instance's
  counter on the text kept after the cut. A short try is followed by another, up to `cardWriteRerolls` (3) more.
  The first try that is not short ends it.
- **Each try starts fresh from the same prompt** (the owner asked; the session's answer, accepted): the short try is
  dropped, not continued. The model stopped where it judged the post finished, and given its own `?` back it would most
  likely stop there again. Continuing only works if ending the post is forbidden, which was weighed and passed on
  (below).
- **The longest try is kept and charged in full** (the owner's choice), the earliest on a tie. If every try is short, the
  longest stands. A lone `?` stands only if nothing longer came back, and the owner finds that the joke. The log already
  says how many characters a tail added, so it never claims more.
- **Every try is scrubbed** (`scrubbedComplete`, its own regeneration on a hit included) and writes its own ledger row.
  A rejection or a transport failure on the first try ends the job as it does now. On a later try it ends the
  re-rolling and keeps the best so far.
- **No reader sees a try.** The text is stored once, when the job finishes, and readers see the typing cursor until
  then. Short tries return in seconds (the `?` took 2), so a re-roll adds seconds before the tail types in.
- **Time** (the session's choice): no new try starts more than two minutes after the job's first call, so a run of
  slow tries never outlives the job's five-minute claim.
- It applies to every generation of a card that writes: a cast, a regeneration after an edit, and a Mod Bot's play.
  The two numbers are engine settings beside `cardWriteSettleSeconds`, not the card's own. The session named them
  `cardWriteShortShare` and `cardWriteRerolls` rather than the `youWereSaying.*` keys first said, since the write job
  that re-rolls is the engine's and names no card.

Weighed: banning the newline token with `logit_bias` until the bought length is reached (a guaranteed length, but token
ids are the tokenizer's, so an instance would configure them, and a tail could no longer break a line); refunding the
unused steps (fairer on paper, but a refund is once per play and only for a failure today, and an edit's regeneration
could come back long); refunding the whole play (throws away a short tail that was funny).

## 6. Ways out, the masks, the layers

- **No player is ever stuck.** No state is added. A prompt that cannot fit ends at once and refunds through the path
  that already exists, which is quicker than today's three attempts. A play bought under a larger window is generated
  shorter, never held.
- **A response never proves a private fact.** Nothing here reads who owns a post, a play or a character. A tail's
  arrival time now varies with re-rolls, which depend on what the model wrote, never on whose post it is. The new
  settings are public, as the rest of `screen_settings` is.
- **KayfaBB never knows which instance it runs.** Engine: the settings and their checks, the counter, the budget handed
  to every frame, the refusal in `models.complete`, the re-roll in the write job, and the pool post and filing frames.
  Instance: Divided World's defaults, and You Were Saying?'s frame, its drop order and its slider. The interface that
  carries the instance's part in is the `WriteFrameInput` the engine already hands a card's frame, which gains the
  budget and the counter.

## 7. Open

- **What llama-server does with an over-long prompt is untested.** The owner chose not to test it, since the engine
  never sends one. If one slips through, a refusal is handled (section 3). A server that silently truncates instead
  would drop the page's header, which the count prevents.
- **The vendored vocabulary's weight** in each edge function that imports it (about 1.5 MB) is accepted untested. The
  first deploy shows whether it matters.

## 8. The README

**Decided** (the owner's): the README's setup gains the old voice's server, which it never had: the
`SYSTEM_COMPLETIONS_*` secrets were missing from it, and that gap is why the first cast failed. The present server setup
is written now. The new settings are added by the plan's last task, once they exist.
