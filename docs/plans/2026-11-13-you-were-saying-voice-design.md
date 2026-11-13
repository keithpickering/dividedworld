# You Were Saying?: the rambler's voice and a tail that fills its length

Record, written 2026-11-13. The design session with the owner, after the card first ran on the deployed instance. Its
plan is `docs/plans/2026-11-13-you-were-saying-voice-plan.md`. It changes `docs/plans/2026-11-07-you-were-saying-design.md`
(sections 2 and 3) and `docs/plans/2026-11-12-old-voice-window-design.md` (section 5, the re-rolls). Each decision below
was asked one at a time and answered by the owner, except where a section says it is the session's own choice. The
owner confirmed the summary before the plan was written.

The owner's reason, from a live play: a post reading "What are your favorite", given three plays at the base length,
grew three plain sentences ("games for the Vibeo? I would like to add one or two more. If you can, please post a link
to your favorite. …"). Too little for a sibling of Autocorrect, and too sane. The owner asked for more text and a
weirder voice, and offered three sampling recipes to try: a high-temperature "tangent", a "broken record" with no
repetition penalty, and a "word salad" with a heavy one.

## 0. What the session measured

The live server's address and key are secrets the session does not hold, so the session ran the same model, GPT-2 XL,
in a scratch copy of transformers on the screenshot's post, through the frame `youWereSayingFrame` builds, with
llama.cpp's sampler chain imitated (its defaults are top-k 40 and min-p 0.05, which the server applies to every request
that does not name them; today's request names only temperature and top-p).

- **Why tails are short.** The model often ends the post: it writes its end-of-text token, or starts the next post
  (`\n---`, `\nPosted by`), and the stop cuts there. With today's numbers (temperature 0.9, top-p 0.95) the first try
  kept 5 tokens of 150 ("games with vibes?"), and two of three were cut short. A larger budget alone does not help.
- **The tangent** (temperature 1.3, no top-k, top-p 1.0) is unreadable token soup ("streamingsedate0836", stray
  Japanese, a crude word). With min-p as a floor it turns tame, since llama.cpp applies min-p before temperature.
- **The broken record** (temperature 0.6 to 0.8, no penalty) loops, but only once it has room; at 25 tokens a play it
  never shows.
- **The word salad** (repetition penalty 1.6 to 1.7) is not salad on GPT-2: it is fluent, manic, run-on and invents a
  life ("I'm currently working on my own Game Boy Advance RPG with all new artwork done by me in Photoshop! I've also
  started work on another game which is inspired from Sonic Adventure 2, but will take much longer to finish because
  it's so huge..."). It filled its length on every try. The session named it **the rambler**.
- **Banning the tokens a new post starts with** (`---` and every other run of dashes, `Posted`, `Quote`, with and
  without a leading space) through llama.cpp's `logit_bias` made every one of twelve simulated plays (four seeds, three
  chained plays each, 50 tokens) fill its length in one call. Without the ban, a play the model wanted to end often came
  back empty on every top-up (three of four calls in one seed).
- **The loop comes for free.** The rambler's penalty looks back 64 tokens, so once a chain of tails is longer than that
  the third play often repeats an earlier tail word for word: the broken record, arriving in chained plays on its own.

## 1. One house voice: the rambler

**Decided** (the owner chose C of three, after first choosing B): every play, a Mod Bot's included, is written in one
voice, the rambler: temperature 0.9, top-p 0.95, top-k 40, min-p 0.05, a repetition penalty of 1.6 over the last 64
tokens, the end-of-text token ignored, and the tokens a new post starts with banned (section 3). The owner: "that's what
I had in mind all along really".

- **Where the numbers live** (the session's choice): in the card's own file in the instance, beside its frame, as the
  card's `sampling`. They are the card's voice, not an economy number the season review tunes, and every number the
  server would otherwise default is named, so the voice does not move when llama.cpp changes a default.
- **The old voice's other slots** (a Mod Bot's pool posts, its filings) keep the numbers they send today.

Weighed: **B**, a mood drawn at random per play from a fixed list (rambler, stuck, inventor), named in the log; the owner
first chose it, then chose C. **A**, one fixed voice tuned only a little weirder. **The caster picks the mood**, which
trades surprise for control. Dropped with B: the log line naming the mood, since one voice has nothing to name.

## 2. The length: doubled

**Decided** (the owner chose A of three): 50 tokens at the base, 50 more a step at 0.25 a step, 300 at most, so a play
costs at most 1.25 over the machine's price. A base play is a short paragraph; three base plays are 150 tokens; a maxed
play is about 225 words. These are the economy's starting numbers, which the season review replaces. The card's
description (`describe` in `instances/divided-world/ui/cards.ts`) says the new range.

Weighed: a larger floor with today's ceiling (75 base, 25 a step, 200 at most); going long (100 base, 100 a step, 500 at
most), where a third chained tail sees little of the post the frame must clip to fit.

## 3. A tail fills what it was paid for

**Decided** (the owner chose B of three): the model is kept inside the post, and where a stop still cuts a tail short, it
is topped up from where it ended.

- **The ban.** The card's sampling names texts the voice may never produce: every run of two or more dashes GPT-2 has a
  token for, `Posted` and `Quote`, each with and without a leading space. Each is one token of GPT-2's vocabulary, so a
  ban removes that token and nothing else. The cost: no `--` in a tail, and no capitalized "Posted" or "Quote" in its
  prose.
- **End-of-text is ignored** for every card that writes: the length is bought, so the engine never lets the model end it
  early by choice.
- **The top-up** replaces the re-roll. When a call's text, kept after the cut, leaves the tail under
  `cardWriteFullShare` (0.9) of the tokens the play bought, the next call continues it: its prompt is the same frame with
  the tail so far after the post and the tails before it, then a paragraph break the frame writes, and it asks for the
  tokens still owed. The stored tail is each call's text joined by that paragraph break. At most `cardWriteTopUps` (3)
  calls follow the first. A top-up that fails (a rejection, an empty answer, a scrub hit twice, a transport failure that
  outlived its retries) ends the loop, and the tail so far is the play's text; only a failure of the first call finishes
  the play as a failure, which refunds as before. Each call is its own ledger row and its own scrub. No top-up starts
  after the deadline the re-rolls had.
- **The two settings are renamed** (the session's choice), since the loop they named is gone: `cardWriteRerolls` becomes
  `cardWriteTopUps`, its stored row renamed and kept; `cardWriteShortShare` becomes `cardWriteFullShare`, at 0.9, and its
  stored row, which meant something else, is removed, so the next seed writes the code's value.

Weighed: **A**, end-of-text ignored alone, which leaves the stops that cut most of the short tails; **C**, the stops
turned off, which shows the model's invented posts and names inside a real one, a bluff the board's own frame would be
making.

## 4. The fake post header

**Decided** (the owner: "not a deal breaker but maybe breaks the illusion a bit"; the form is the session's choice): a
tail is also cut where a run of two or more dashes is followed by `Posted by`, anywhere in a line, since the model
sometimes writes the frame's rule and header on one line (`--- Posted by Snuckles:`, `-- Posted by D3V4M1N7B0T9Y8ZD5:`),
which the line-start stops miss. A plain "posted by" in prose stays. The frame returns the pattern beside its stops; the
server is sent only the plain stops, and the pattern is applied where the answer is cut. With the ban in place the
pattern is a backstop.

## 5. The server

The request names llama.cpp's fields (`top_k`, `min_p`, `repeat_penalty`, `repeat_last_n`, `ignore_eos`, and
`logit_bias` by token id, `[[6329, false], …]`), since llama.cpp's `llama-server` is what the README sets up and what
Divided World runs (the session's choice). The ids come from the vendored GPT-2 vocabulary
(`engine/system/tokenizers/gpt2/bpe.json`), which the token counter already reads, so a ban is exact for the instance's
tokenizer; an instance whose `oldVoiceTokenizer` is `bytes` has no ids, and sends no ban. Weighed: the string form
llama.cpp also takes, which leaves the tokenizing to the server and bans every piece of a string that is not one token. A request that sets none of them sends a body byte for byte as today's, so the Mod Bots' calls
are unchanged.

## 6. What is already there

- **Plays that already landed** keep the tokens they bought (25 each). An edit regenerates them in the new voice, with
  top-ups, at their bought length.
- **A tuned economy row** keeps its numbers: a seed fills only the keys it lacks (0355), so the new lengths reach an
  instance only where the economy row is the code's.
- **No state is added** that a player, a character or a post can be put in. A tail that stays short after its top-ups
  is a shorter tail, as a short re-roll was.
- **No response, payload, Realtime event or timing** is computed from a private fact. How long a tail takes depends on
  the post's words, the tokens bought and the model's answers, the same for every caster.
- **Cost at a busy instance's scale.** A play makes at most four calls, as the re-rolls did, and in the simulation one.
  A maxed play is 300 tokens, not 200, which is CPU seconds on the instance's own server; the worker's concurrency and
  the queue are unchanged, so a busy board waits longer for tails and never stalls.

## 7. Open

- **A vLLM or text-generation-inference server.** vLLM names the penalty `repetition_penalty` and takes `logit_bias` as an
  object keyed by id, where llama.cpp's array form is sent, which it may refuse. An instance on another server would
  need the request shaped for it. Open until an instance runs one.
- **The other voices** (stuck, inventor, a tuned tangent) are left for a later card or a later change; the session's
  samples are its record.
