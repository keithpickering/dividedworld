# You Were Saying?: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-you-were-saying-design.md`, built by one build session in
one PR, from `main`. Section numbers below are the design's.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added, so no new
check needs a poison. The engine boundary check (`tools/check-engine-boundary.mjs`) holds throughout: nothing in
`engine/` or `supabase/` names You Were Saying?. The engine gains **a card that writes**, the generation queue, the
scrubber and the append layer, and reads the card only through `CardRules.writes`.

**One migration:** `supabase/migrations/0144_card_writes.sql`, with its SQL test `supabase/tests/0144-card-writes.sql`,
run against Postgres on localhost. If other work has taken these numbers by the time this is built, use the next free
ones. No deployed database, bucket or connector is touched.

## Task 1. A completion that keeps its lines (engine)

Model: inline

**Files:** `engine/system/model.ts` (`CompletionRequest`), `engine/system/validate.ts` (`cutCompletion`, line 127),
`supabase/functions/_shared/models/index.ts` (`complete`, line 155); tests `engine/system/validate.test.ts`,
`supabase/functions/_shared/models/index.test.ts`.

- `CompletionRequest` gains `lines?: 'one' | 'many'`, `'one'` when unset.
- `cutCompletion(text, stop, most, lines = 'one')`: with `'many'`, the implicit `'\n'` stop is not added, runs of more
  than two newlines collapse to two, and trailing whitespace is trimmed. Leading whitespace is kept only as a single
  space when the text began with one (a continuation of "i think" needs its space), never a newline.
- `complete` passes `request.lines` through.

Tests first: a three-line answer under `'one'` keeps the first line (today's behaviour, unchanged); under `'many'` keeps
all three; a stop sequence still cuts under `'many'`; `"   \n\n\n\nfoo"` under `'many'` is `" foo"`; an answer that is
only newlines is rejected `nonEmpty` under both.

## Task 2. The scrubber (engine)

Model: sonnet

**Files:** `engine/system/scrub.ts` (new), `engine/rules/types.ts` (`SystemContent` gains `scrubWords: readonly
string[]`), `engine/rules/instance.ts` (`instanceProblems`: a word list entry that is empty or not lower case is a
problem), `instances/divided-world/system/scrub-words.ts` (new) and `instances/divided-world/system/index.ts`,
`engine/rules/test-system.ts`, `supabase/functions/chatter/core.ts` (line 318); tests `engine/system/scrub.test.ts`
(new), `supabase/functions/chatter/core.test.ts`.

The staff design's section 13 scrubber, built for every old-voice output.

- `scrubHit(text, words): string | null` names the first predicate that hits: `word` (a whole-word, case-folded match
  of any entry, with common letter-for-digit swaps folded: 0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s), `email`, `phone`
  (seven or more digits with the usual separators), `url` (a scheme, `www.`, or a dotted host with a known TLD).
- `scrubbedComplete(models, request, words): Promise<ModelResult<string>>` calls `models.complete`, and on a hit calls it
  once more; a second hit throws `AnswerRejected('the completion failed the scrubber', 'scrub:<predicate>')`. Each call
  keeps its own ledger row.
- The chatter's old-voice branch calls `scrubbedComplete`; a rejection takes its existing `fail('rejected', …)` path.
- `scrub-words.ts` is the instance's starting list of slurs, in the instance's words; admins edit it later as they edit
  `realWorld`. Its header says it is a list the build session compiles from common slur lists, and the owner reviews it
  in the PR.

Tests first: each predicate hits on a planted sample and misses on a near miss ("Superman" for `word` against a list
holding a substring; a version number "1.2.3" for `url`; a year "2021" for `phone`); `scrubbedComplete` with a fake
`Models` answering hit then clean returns the clean answer and made two calls; hit then hit throws with the predicate;
the chatter test's old-voice persona answering a planted hit twice files a rejected pick.

## Task 3. A card that writes, and an instance that has the old voice (engine types)

Model: sonnet

**Files:** `engine/rules/cards.ts` (`CardRules`, line 123; `decided`, line 201), `engine/rules/types.ts` (`Settings`),
`engine/rules/instance.ts` (`instanceProblems`), `engine/system/model.ts` (`CallContext`, line 25),
`engine/system/duties.ts`, `engine/ui/cards/faces.ts` (`facesOf`, line 142), `supabase/functions/chatter/core.ts`
(`cardsOnOffer`, line 233); tests `engine/rules/cards.test.ts`, `engine/rules/instance.test.ts`,
`engine/ui/cards/faces.test.tsx`, `supabase/functions/chatter/core.test.ts`.

- `CardRules.writes?: Writes<Config>`, where
  `Writes<Config> = { tokens(config: Config, settings: Settings): number; frame(input: WriteFrameInput): { prompt: string; stop: readonly string[] } }`
  and `WriteFrameInput = { post: { name: string; text: string }; before: readonly { name: string; text: string }[];
  title: string; tails: readonly string[]; settings: Settings }`. `text` is the post's visible text
  (`engine/bbcode/visible.ts`); `tails` are the earlier chained tails, in play order. A card with `writes` has
  `reaches` of `['post']` only, and `instanceProblems` refuses one that reaches further.
- `Settings.oldVoice: boolean`: whether the instance runs a completion endpoint. Divided World's settings set it `true`;
  `engine/rules/test-system.ts`'s fixtures carry both values.
- **Withheld where there is none:** `facesOf` leaves out a writing card when `oldVoice` is false; `cardsOnOffer` does
  too; `decided` refuses its play with "The old voice isn't running on this forum, so this card can't be played."
  (glass copy, plain). SQL refuses again (Task 4).
- `CallContext` gains `play?: Id`. `CompletionRequest.duty` widens to `Duty | 'cardText'`; `DUTIES` stays staff work
  only, so `instanceProblems`' duty assignment check (line 551) and `DUTIES.length === 9` are unchanged.

Tests first: a test card with `writes` on a character reach is an instance problem; `facesOf` with `oldVoice: false`
omits it and keeps every other card; `decidePlay` refuses it with the sentence above; the pool's offer omits it; a
`CompletionRequest` with `duty: 'cardText'` and `play` type-checks (`npm run typecheck`).

## Task 4. The queue, the texts and the refund (SQL)

Model: sonnet

**Files:** `supabase/migrations/0144_card_writes.sql` (new); test `supabase/tests/0144-card-writes.sql` (new);
`supabase/functions/seed/` where it hands `seed_instance` the cards; `tools/export-instance.mjs` and
`tools/import-instance.mjs` with their round-trip test.

- **`card_kinds.writes boolean not null default false`**, set by `seed_instance` (latest `0139_machine.sql`, insert at
  line 567) from `CardRules.writes`. `settings.oldVoice` is seeded with the rest.
- **`card_texts`** (append-only, with the guards `play_moments` has, `0072_play_moments.sql`): `id`, `play` → acts,
  `version` → acts (the post's own Act or an edit), `text` (at most 4,000 characters), `failed text` (null, or the
  predicate: `unreachable`, `scrub:<predicate>`, `nonEmpty`), `call` → `model_calls` (nullable), `created_at`. Exactly
  one of `text` and `failed` is set. Unique on `(play, version)`.
- **`card_writes`** (the queue; a job row, not an Act): `play`, `version`, `queued_at`, `attempts`, `claimed_until`.
  Primary key `play`: a newer version replaces the waiting one (`on conflict (play) do update set version = …`), which
  is the design's "newest only" (section 4). A finished job is deleted.
- **Enqueue by trigger** on `acts` insert, so every path is covered without editing it:
  - a `card` Act whose card `writes`, on a post: queue `(play, post_version(post))`;
  - an `edit` Act: queue `(p, the edit)` for each live writing play `p` on the post, in play order.
- **`claim_card_writes(most int)`** (service only): takes up to `most` jobs, oldest first, whose `claimed_until` has
  passed, skipping any job whose post has an earlier writing play with a job still waiting (the chain, section 6), and
  sets `claimed_until = now() + interval '2 minutes'`, `attempts = attempts + 1`. It returns each job with the frame's
  inputs: the post's author name and body, the thread's title, the `before` posts (the instance's
  `pool.chatterThreadPosts` before it, public posts only), the earlier plays' texts for the same version (falling back
  to their latest text when one failed), and the play's configuration and card key.
- **`finish_card_write(play, version, text, failed, call)`** (service only): inserts the `card_texts` row and deletes the
  job if its version is still the queued one. If the job was replaced by a newer version meanwhile, the row is still
  written (History draws it) and the job stays. Then it queues the broadcast (`card_text`, on the thread's channel, through
  the outbox, `supabase/functions/_shared/outbox.ts`), carrying the play, the version and nothing else.
- **The refund** (`refund_card_write(play)`, called by `finish_card_write` when `failed` is set and the play has no
  `card_texts` row with `text`): the pattern of `refund_appeal` (`0109_appeals.sql:525`): an advisory lock, a side table
  `card_write_refunds (play primary key, amount, at)`, the payer from `wallet_events where kind = 'play' and ref = play`,
  `wallet_move(account, amount, 'refund', null, play)`, and a `card_ledger` row of a new kind `returned` (the kind check,
  last widened at `0142_face_down_moves.sql:172`, widens; `returned` names the act as `played` and `caught` do, and
  `card_held`, `0142_face_down_moves.sql:182`, counts it as it counts `bought`, `pulled` and `caught`). A play with no payer (a Mod Bot's, from
  `staff_play_card`) refunds nothing and returns nothing.
- **A clear** saves through the existing `save_effect_state` (latest `0092_card_end.sql:487`); the card's
  `validateState` (Task 7) holds its shape.
- **Refusals:** `play_card` and `buy_card` (latest `0140_machine_moves.sql:615`) refuse a writing card when
  `settings.oldVoice` is false, in the words of Task 3, and a pack's roll leaves it out (`roll_pack`'s `leaves`,
  `0139_machine.sql:201`), so it is neither sold singly nor pulled.
- **`post_tails(post)`** (granted as `effect_state` is read, to a signed-in player): every `card_texts` row for the plays
  on the post, ordered by version then play.
- **`model_calls.play bigint` → acts**, nullable; `record_model_call` (`0042_model_calls.sql:60`) writes it from the
  payload; `ledger.ts`'s `ModelCallRow` and `ledgered()` (`supabase/functions/_shared/models/index.ts:94`) carry
  `request.play`.
- **The schedule:** `schedule_card_writes()` adds `kayfabb-write` to pg_cron every minute, `net.http_post` to
  `/functions/v1/write` with the Vault secrets the other jobs use (`0089_*.sql:263` is the pattern).
- **Export and import** hold `card_texts`, `card_writes` and `card_write_refunds`, and the round-trip test proves them.

Tests first, in the SQL test: a play of a writing card queues one job; a second edit before the worker runs leaves one
job, at the newer version; `claim_card_writes` holds back the second play's job while the first's waits; a
`finish_card_write` for a replaced version writes its row and leaves the newer job; a failed finish on a paid play refunds
exactly the play's wallet event and writes `returned`, and a second call refunds nothing; a failed finish on a play that
already has a text refunds nothing; a Mod Bot play's failure moves no wallet; `card_texts` refuses an update and a
delete; `play_card` refuses with `oldVoice` false; `post_tails` is refused to anon.

## Task 5. The worker (Edge Function)

Model: sonnet

**Files:** `supabase/functions/write/core.ts`, `supabase/functions/write/index.ts` (new), `supabase/functions/act/core.ts`
(`afterTheAnswer`, line 229); tests `supabase/functions/write/core.test.ts` (new), `supabase/functions/act/core.test.ts`.

- `runWrites(db, models, instance, settings, most)`: claims jobs, and for each builds the frame with the card's
  `writes.frame`, calls `scrubbedComplete` with `duty: 'cardText'`, `play`, `lines: 'many'`, `maxTokens` the play's
  `writes.tokens(config)`, `temperature: 0.9`, `topP: 0.95`, and finishes it with the text or the failure's predicate. A
  transport failure that outlived its retries is `unreachable`. A database error stops the run and is thrown at once
  ("Three unrelated timeouts are not a poison pill"); a job left claimed is taken again when its claim runs out, and a
  job past three attempts is finished as `unreachable`.
- `index.ts` runs it on the cron's call, with the jobs key.
- **The kick:** after `play_card` or `edit_post` answers, `afterTheAnswer` runs `runWrites` for that post's jobs under
  `waitUntil`, so a tail types in seconds after the play, not at the next minute. The cron is the sweep.

Tests first: with a fake `Models`, a job is finished with its text and the call carries `play` and `duty: 'cardText'`;
a scrub hit twice finishes `scrub:word` and refunds; a thrown transport error finishes `unreachable`; a database error
on claim throws; the kick runs only for a post that has jobs.

## Task 6. Tails on the screens (engine UI)

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`EffectProps`, line 121), `engine/ui/cards/Effects.tsx` (`PostEffects`, line 42),
`engine/ui/data/api.ts` (line 1519 area), `engine/ui/data/fake.ts`, `web/src/data/supabase.ts`,
`engine/ui/thread/lines.tsx` (`Versions`, line 58), `engine/ui/cards/Moment.tsx` (`MomentFrame`, line 55); tests beside
each.

- `EffectProps.written: ReadonlyMap<Id, Written>`, where `Written = { text: string } | { waiting: true } | { failed: true }`,
  for the plays of a writing card on the post, at the version drawn. `PostEffects` fills it from `api.tails(post)`
  (`post_tails`), read with the page's other effect states in one batched request for the page's posts, never one per post.
- **Realtime:** a `card_text` event on the thread's channel refetches that post's tails.
- **The append layer:** an Effect draws after the body by wrapping `children` (`<>{children}<Tail/></>`), as Glitter Bomb
  wraps them; no new renderer interface is needed for that. The engine's part is that the body's container is a block the
  tail can follow inline, and a test pins it.
- **History:** `Versions` draws each version with the writing plays' Effects in still mode, `written` for that version,
  and `states` empty, so a tail shows in full (section 7). A version with no rows for a play draws none.
- **As it landed:** `MomentFrame` passes `written` for the moment's version, and the play's snapshot state, so a clear
  that stood then draws as cleared.

Tests first: `PostEffects` given two plays and tails passes each its text; a `card_text` event refetches only its post;
`Versions` with three versions and two rows draws two tails, still; a moment draws its version's tail, not the current
one's.

## Task 7. The card's rules (instance)

Model: sonnet

**Files:** `instances/divided-world/cards/you-were-saying.ts` (new), `instances/divided-world/cards/you-were-saying/frame.ts`
(new), `instances/divided-world/cards/index.ts`, `instances/divided-world/machine.ts` (its slot),
`instances/divided-world/settings.ts` (`economy`, near lines 177–181);
tests `instances/divided-world/cards/you-were-saying.test.ts` (new), `instances/divided-world/cards/cards.test.ts`
(line 20's list).

- **Rules:** key `you-were-saying`, name `You Were Saying?`, alignment `pepperoni`, rarity `common`, `stack: 3`; no
  price of its own (the booster packs design moved prices onto the machine's slots); `reads` for `youWereSaying.baseTokens`, `.stepTokens`, `.stepPrice`, `.mostTokens`.
- **Config:** `{ steps: number }`, a whole number from 0 to `(mostTokens − baseTokens) / stepTokens`. `tokens` is
  `baseTokens + steps × stepTokens`; `playPrice` is `steps × stepPrice` (a face, with no config, asks the most).
- **`canApply`:** `landsOn`, then refuses a post whose visible text is empty: "There's nothing in this post to continue."
- **`validateState`:** `{ cleared: Id }` (the version cleared) or nothing else.
- **`staffConfigs: [{ steps: 0 }]`**, so a Mod Bot plays it at the base length (section 10).
- **The frame** (`frame.ts`, the design's section 3): "Welcome to the Message Boards - Thread View", the title, each
  `before` post as `Name:` then its text, then `Name:` and the post's text with the earlier tails joined on, and nothing
  after, so the model continues mid-line. Stops: `\n<Name>:` shapes are not knowable ahead, so the stop list holds
  `"\nQuote:"`, `"\n---"`, `"\nPosted:"`, and the frame's header line; `cutCompletion` under `'many'` keeps the rest.
  Every name and text is collapsed to plain lines as `chatterCompletion` does, so a player's words cannot end the frame.
- **Economy:** `youWereSaying.baseTokens` 25, `.stepTokens` 25, `.stepPrice` 25, `.mostTokens` 200.
- **The machine:** a slot `{ item: { card: 'you-were-saying' }, availability: 'onSale', price: 100 }`. Being common, it
  is also in the Booster's common pulls.

Tests first: `tokens` and `playPrice` at 0 and at the most steps; a step past the most is refused by `validateConfig`; an
images-only post is refused; the frame ends with the post's last characters and no newline; a post body holding
`"\nName:"` cannot add a line to the frame; cards.test.ts's list gains `['you-were-saying', 'pepperoni', 100]` and its pool
tests pass for the new card.

## Task 8. The tail: terminal bleed (instance effect)

Model: sonnet

**Files:** `instances/divided-world/cards/you-were-saying/Effect.tsx`, `instances/divided-world/cards/you-were-saying/tail.css`
(new), `instances/divided-world/cards/you-were-saying/erase.ts` (new, the hold's clock), `instances/divided-world/ui/cards.ts`
(the lazy Effect and `describe`), `instances/divided-world/ui/settings` where `cardSettings` live (`settings.ts` line 152:
`youWereSaying.eraseCps` 6, `youWereSaying.retypeMs` 2000, `youWereSaying.typeCps` 40, as `screenReads`); tests
`Effect.test.tsx` and `erase.test.ts` beside them; a story under the screens' stories with a shot.

The look is the mock's B (`docs/research/2026-11-07-you-were-saying/look.html`), confirmed by the owner:

- **The tail:** all the post's tails as one run of Courier, `#0a6b2a` on a faint green wash, inline after the body, each
  play's text a span of its own. Contrast meets the usual standard on the post's white.
- **Typing:** each time the post enters view (`watchInView`, `engine/ui/shine/inView.ts`, at Glitter Bomb's threshold),
  the tail types in at `typeCps` with a block cursor, with a horizontal tear while it types. When it is done the tear
  stops and the cursor stays blinking at the end. `{ waiting: true }` shows the cursor typing nothing.
  `{ failed: true }` with no earlier text shows nothing.
- **The hold** (section 8): a pointer held anywhere on the tail block, or Backspace held while it is focused, erases from
  the end at `eraseCps` across every chained tail. A release before the end starts a `retypeMs` clock, after which it
  types itself back in, all of it. Erasing the last character, by the author, saves `{ cleared: version }` on every
  writing play on the post; anyone else's clear lasts until refresh. A focus ring meets the forum's standard; the block's
  name is "Continued by You Were Saying?: <text>. Hold to erase. It comes back if you stop."
- **Reduced motion:** the text shows at once; no tear; the cursor holds still; the hold erases at the same rate and the
  retype is instant after the same wait.
- **Still mode** (History, As it landed): the full text (or the snapshot's clear), no cursor animation, no input; `show`
  gives "You Were Saying?: 42 characters added" or "… erased".

Tests first (`erase.test.ts`, a pure clock): at 6 cps a 60-character tail is gone in 10 seconds of hold; a release at 5
seconds and 2 seconds' wait retypes to 60; a release at the end retypes nothing. (`Effect.test.tsx`, with the faked
observer of Glitter Bomb's test): typing starts on view; Backspace held erases on keyboard as the pointer does; the author's
clear saves once per play; a reader's clear saves nothing; still mode takes no input.

## Task 9. The form, the face and the art (instance)

Model: sonnet

**Files:** the card's play form beside Autocorrect's (`instances/divided-world/cards/autocorrect/` is the pattern),
`instances/divided-world/ui/cards.ts` (`art`), the card's art under the instance's card art (checked by
`tools/check-card-art.mjs`); tests beside the form.

- The form is a stepped slider from the base length to the most, labelled in words ("about a sentence" … "a rant") with
  the price beside it, in the glass's style, keyboard operable as a native range input.
- The face shows the price's range, as Autocorrect's does.
- The art: a CRT terminal with a blinking cursor, the instance's card art conventions.

Tests first: the slider's value is the config's `steps`; arrow keys step it; the price shown is `playPrice` of the step.

## Task 10. The log (engine and instance)

Model: haiku

**Files:** `engine/ui/log/lines.ts` (the card lines from line 506, the `back()` helper at 448), `instances/divided-world/ui/cards.ts`
(`logPlay`, `logSave`), the log data read that carries `wallet` events; tests `engine/ui/log/lines.test.tsx`.

The exact strings are the design's section 13:

- caster: "You played You Were Saying? on post N for M tokens" (`logPlay(config)` gives "for M tokens");
- caster, refunded: "The old voice didn't answer for your You Were Saying? on post N, so your X came back, and the card
  is back in your hand." (`X` from the play's `refund` wallet event, `ref` the play, as `back()` reads it);
- author: "You Were Saying? on your post continued it"; on each edit's new text: "Your edit of post N made its You Were
  Saying? again"; a failure: "You Were Saying? on post N didn't take.";
- author's clear (`logSave`): "You erased You Were Saying? on post N".

The engine's lines read the refund for any card play, and name no card. Tests first: one line per case above, from
fixture rows.

## Task 11. The Strategy Guide (instance, owner approves)

Model: inline

**Files:** `instances/divided-world/guide/strategy-guide.md`.

One entry in the card list, in the glass's voice, which may joke and never bluffs. Draft: "**You Were Saying?**
(Pepperoni, common): hand a post to a chatbot from 2021 and let it keep going. More Aura, more words. The author can
erase it, but only all at once: let go and it starts typing again. Every edit gets a fresh take." The owner approves it
in review.

## Task 12. The end-to-end run

Model: sonnet

**Files:** `supabase/tests/e2e/` (a new numbered file after the last), with a fake completion server on localhost.

A cast on a post, the tail written and broadcast, an edit and its new tail, History holding both, the author's clear
saved, and a failing endpoint refunding a second play and returning its card.

## Review focus

- **Acts already held:** the trigger reads every `edit` insert; an edit on a post with no writing play must do one
  indexed probe and nothing else.
- **The chain under races:** two edits and a cast arriving together; the claim's skip must never strand a later play's
  job forever when an earlier play's job keeps failing (attempts cap).
- **A refund twice:** a retry, a sweep and a kick finishing the same job; the side table must hold one refund.
- **Cost at a busy instance:** GPU seconds grow with edits on carded posts; check the kick and the sweep never both
  generate one job.
- **The masks:** nothing in the worker, the broadcast, or a refusal reads who owns the post or the play; the broadcast
  carries only play and version; a refund is visible only in the caster's own wallet events.
- **The frame:** a player's words must never inject a line into the frame or reach the stop list.
- **The scrubber's list** is content the owner reviews; its false positives on ordinary forum words cost a refund, not a
  post.
- **Export round-trip** holds generated texts, so an imported forum's tails are the same words, never regenerated.
