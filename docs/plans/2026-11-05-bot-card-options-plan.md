# A Mod Bot's card options, and an admin's reversal of a card: plan

Record, written 2026-11-05. The plan for `docs/plans/2026-11-05-bot-card-options-design.md`. One build session builds it in
one PR from `main`, after this plan's PR (which carries the CLAUDE.md rewording) has merged. The PR says `Closes #236`.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added. The SQL runs
against Postgres on localhost (`npm run test:sql`).

**One migration and one SQL test file**, each taking the next free number when it is written: `NNNN_card_end.sql` in
`supabase/migrations/` (0091 at the time of writing) and `NNNN-card-end.sql` in `supabase/tests/` (0093). Every function
it changes is redefined whole with `create or replace`, from its latest definition (named below), and its header says
what changed and that everything else is as the earlier migration wrote it, as 0086 does.

**The boundary check holds:** nothing in `engine/` or `supabase/` names Whoops!, Autocorrect or Stick Around. The engine
learns a card's options only through `CardRules.staffOptions`.

**Order:** the reversal first (Tasks 1 to 7), since the bot's free-text options rest on it; then the options (Tasks 8 and
9); then the export and the log's copy (Tasks 10 and 11).

## Task 1. The `card_end` Act and `reverse_card` (migration)

Model: sonnet

**Files:** the migration and its SQL test.

- **The kind.** `acts_kind_check` (latest 0062_updates.sql:48) gains `card_end`. `acts_character_null` (0046_moves.sql:57)
  becomes `(character is null) = (kind in ('tally', 'reveal', 'move_end', 'card_end'))`. `acts_well_formed` (latest
  0054_card_plays.sql:167): a `card_end` targets a `card` Act, sits in that play's thread, takes no seq (`acts_take_seq`,
  0054:151, and `acts_seq_check`, 0054:135), and is written only with the flag `kayfabb.card_end_writer` set, as `move_end`
  is with `kayfabb.move_end_writer`. A payload check, `acts_card_end_payload`: exactly `{why: 'reversed', by: 'admin'}`.
  `acts_check1` (0062:52): a `card_end` has a target.
- **One per play:** `create unique index acts_one_card_end on acts (target_act_id) where kind = 'card_end'`. It is also
  the index every reader below uses to ask whether a play has ended.
- **`card_ended(play uuid) returns boolean`**, stable, `exists` on that index. Every SQL reader below calls it, so one
  definition says what an ended play is.
- **`reverse_card(play uuid) returns jsonb`**, security definer, granted to `authenticated`:
  - `only_admins('ends a card')` (0021:89).
  - It locks the play's row (`for no key update`), then refuses, each with `hint = 'kayfabb.refusal'`, in plain words:
    - not a `card` Act: "that is not a card play";
    - caught (`payload ? 'caught'`): "that card was caught by a trap, so it never landed";
    - ended by time (`payload ->> 'ends'` passed, or its `play_reach.ends_at` passed): "that card has already worn off";
    - already reversed: "an admin has already ended that card".
    - A face-down Set is not a `card` Act (it is `set`), so it falls under the first refusal. The words never say whether
      a back exists.
  - It writes the `card_end` with the flag set and put back, then writes the alert (Task 4), and returns
    `act_projection(card_end) || {play}`.

Tests first (the SQL test):
- An admin ends a live Cast on a post: one `card_end`, attributed to no character, with the payload shown.
- A second call refuses. A non-admin refuses with 42501. A caught play, an expired Use and a `set` Act each refuse with
  their words.
- A play on a character, a thread and a board each end the same way.
- **The poisons:** an insert of a `card_end` without the flag fails; a `card_end` targeting a post fails; a second
  `card_end` on one play fails on the index; a `card_end` with `{by: 'boss'}` fails the payload check.

## Task 2. A reversed play stops counting on the server (migration)

Model: sonnet

**Files:** the migration and its SQL test.

Each of these is redefined whole from its latest definition, with `not card_ended(<play>.id)` added beside its existing
`caught` and `ends` tests:
- `place_cast` (0086_staff_cards.sql:161): the ward check (:211-216), the post stack count `up` (:224-228), the one live
  board card (:268) and the beyond-post stack (:273-275). **The layer is not changed:** `layer` still counts every play,
  since `acts_card_layers` refuses a reused layer. Only `up` drops a reversed play.
- `spring_traps` (0086:69): the strike's stack count (:104-108), again leaving its `layer` alone.
- `card_target` (0070_autocorrect.sql:25): a reversed play is not among the post's effects.
- `reach_effects` (0055_card_reach.sql:391), `effects_above` (0055:445) and `pinned_threads` (0055:357): a `play_reach`
  row whose play is reversed is not live. `play_reach` is append-only (0055:186), so it is never updated.
- `save_effect_state` (0055:536) and `release_effect` (0016_cards_screens.sql:117) refuse a reversed play: "an admin
  ended that card".

Tests first: for each reader, a reversed play is absent where an identical live play is present. A post carrying three
Whoops! with one reversed takes a fourth, and the fourth gets layer 4, not 3. A ward that is reversed turns away nothing.
A pinned thread whose pin is reversed is not pinned. A thread card reversed leaves `effects_above`.

## Task 3. A reversed play settles no further (migration, engine)

Model: sonnet

**Files:** the migration; `engine/rules/settle.ts` and its tests; `supabase/tests/e2e/0001-settlement.ts`.

- `settlement_input` (0055:577) and `estimate_input` (0073_core_loop_answers.sql:16) leave out a `card` Act with a
  `card_end` created before `window_end`, and the votes on it. A play reversed after a window closed was settled in that
  window, and that stays.
- `settle.ts` needs no new filter, because its input carries no reversed play. Its header comment gains one line saying
  so, beside "a caught play settles as the play it is".

Tests first:
- An e2e case in `0001-settlement.ts`: a Salty card played and voted on, reversed before the window's end, moves no
  Aura. The same card reversed after a settled window keeps that window's Aura and moves none in the next.
- The `estimate_input` twin of the first case.

## Task 4. The alert and the log's views (migration)

Model: sonnet

**Files:** the migration and its SQL test.

- **The alert kind** `cardEnded`. It is added to the alerts kind check (latest at 0058_alerts.sql:26 or a later
  redefinition, whichever is latest) and to the toast kinds lists (0064_toast_kinds.sql:8 and :36, 0068_tips.sql:40, or
  their latest).
  - `reverse_card` writes it to the caster's player through `write_alert(caster, 'cardEnded', null, card_end, null)`.
  - A staff caster has no player, so none is written.
- **`my_cards_ended`**, a security-invoker view for the log. Each row is a `card_end` on a play the caller's player cast,
  or on a play that landed on the caller's post, character or thread. Its columns are `card_end`, `play`, `card`, `at`,
  `side` (`cast` or `onMine`), and the target's public name. It reads `acts_public` and the caller's own characters,
  never another player's ownership.

Tests first:
- The caster's player sees their row with `side = 'cast'`, and the target's author sees theirs with `side = 'onMine'`.
- A third player sees neither row.
- A staff caster's reversed play writes no alert and appears only on the target's side.

## Task 5. Reversing from the act Edge Function, live (engine, Edge Function, web data)

Model: sonnet

**Files:**
- `engine/rules/actions.ts` (`ACTIONS`)
- `supabase/functions/act/core.ts`
- `engine/ui/data/api.ts`
- `web/src/data/supabase.ts`
- `engine/ui/data/fake.ts`
- each file's tests

`reverse_move` is called straight from the client and nothing is broadcast. A card's layer should come off for everyone
reading the thread, so the reversal goes through the act function, which owns the broadcasts:
- `ACTIONS.reverseCard({ play })`: a uuid.
- `act/core.ts` calls `reverse_card` as the caller's session, so `only_admins` reads the caller.
  - It broadcasts the `card_end` as an `act` on `thread:<thread>`.
  - For a play beyond a post, it also broadcasts on the play's reach topic, the way `onReach` (:58) does for the play.
  - The drain sends the alert.
- `api.reverseCard(play: Id): Promise<Answer<{ act: Id; play: Id }>>` in `api.ts`, `supabase.ts` and `fake.ts`. The fake
  mirrors Task 1's refusals and Task 2's counts: its layer count (:1040), its `card_target` twin (:1074-1085) and its
  reach effects (:1098).
- **The reads.** `cardsOn` and `cardsOnMany` (`supabase.ts`:833-844) read the plays on posts by `target_act_id`. They then
  read the `card_end` Acts whose target is one of those plays, chunked by the existing id-read helper. `ActKind`
  (`api.ts`:163) gains `card_end`.

Tests first:
- `actions.test.ts`: a request with no play or a bad uuid refuses.
- `act/core.test.ts`: a reversal broadcasts one `act` on the thread topic, plus one on the reach topic for a thread card.
  A refusal broadcasts nothing.
- `fake.ts` parity with the SQL for each refusal.

## Task 6. The screens: the layer comes off, the Lens says so, and an admin ends one (engine UI)

Model: sonnet

**Files:**
- `engine/ui/cards/types.ts`
- `engine/ui/cards/plays.ts`
- `engine/ui/cards/land.ts`
- `engine/ui/cards/Effects.tsx`
- `engine/ui/cards/Marks.tsx`
- `engine/ui/cards/Lens.tsx`
- `engine/ui/cards/marks.ts`
- `engine/ui/thread/Thread.tsx`
- `engine/ui/board/Board.tsx`
- each file's tests and stories

- `CardPlay` (`types.ts`:43) gains `reversed?: true`.
- **The plays store** (`plays.ts`):
  - `createPlays().add` (:233-260) takes a `card_end` the way it takes a spring: it marks its play `reversed`, and holds
    one that arrives first in the pending map.
  - `livePlays` (:85) drops reversed plays.
  - `WITHOUT_EFFECTS` (:383) gains `card_end`.
- **The screens:**
  - `effectsOf` (`land.ts`:25) skips a reversed play, as it skips a caught one.
  - The post layer in `Effects.tsx` (:84-87) skips it.
  - `momentParts` (:186-207) names a reversed play "ended by an admin" only when the moment is after its `card_end`.
- **Live updates.** `Thread.tsx`'s live `onAct` (:363-375) routes a `card_end` to `plays.add`. `Board.tsx`'s pins (:247)
  follow `livePlays`.
- **The Lens** (`Lens.tsx`:176-219):
  - A reversed play's state reads `endedWords()` ("Ended by an admin"), a new pure function in `marks.ts` beside
    `caughtWords` (:84).
  - For an admin viewer, a face-up play still in force carries an "End this card" button. It opens a confirm ("End this
    Whoops! by Gizmo? Its layer comes off for everyone, and nothing is refunded."), then calls `api.reverseCard`, and a
    refusal's words are shown.
  - The admin flag reaches the Lens as `admin: boolean` from where the screens already know it (the prop `Updates`
    takes, `engine/ui/updates/Updates.tsx`:59), threaded through `Thread` to the Lens.
  - No back, caught play or ended play shows the button.

Tests first:
- `plays.test.ts`: a `card_end` before its play and after it both end with the play reversed, and `livePlays` drops it.
- `marks.test.ts`: `endedWords`.
- A Lens test: the button shows for an admin on a live face-up play only. It never shows on a back, a caught play, or for
  a non-admin. The confirm calls `reverseCard`.
- **Stories:** a post with a reversed Whoops!, and the Lens on it, for the owner's word.

## Task 7. The admin queue's "Mod Bots' cards" (migration, engine UI)

Model: sonnet

**Files:**
- the migration
- `engine/ui/admin/Queue.tsx`
- `engine/ui/data/api.ts` (`AdminQueue`, :451)
- `web/src/data/supabase.ts`
- `engine/ui/data/fake.ts`
- tests

- **`admin_queue()`** (latest 0090_handover_todos.sql:52) is redefined whole, with two changes:
  - **A new group, `staffCards`.** It lists the face-up plays (`kind = 'card'`, not caught, not ended by time, not
    reversed) of staff characters from the last 30 days. Each row has the card, its name, the persona, the target's
    public name, the thread and `at`.
  - **The `ended` group** also lists `card_end` Acts from the last 30 days, with `how: 'reversed'`, `by: 'admin'` and the
    card's name.
  - The group is capped like the others (`cap`, `more.staffCards`). Two partial indexes keep the 30-day read to the
    window: one on staff card Acts by time, and `acts_card_ends` on `card_end` Acts by time. The cost stays the window's
    plays, never the history of Acts.
- **`Queue.tsx`**:
  - A `StaffCards` group after `InForce` (:266), with an END button per row that uses the Lens's confirm and calls
    `api.reverseCard`.
  - `endedLine` (:303-310) gains the card line "Ended by an admin".

Tests first:
- SQL: a staff Set never appears in `staffCards` until it springs, and its strike appears.
- SQL: a player's card never appears in `staffCards`. A reversed play leaves `staffCards` and enters `ended`.
- `Queue.test.tsx`: the group renders and the END button confirms.

## Task 8. A card says what the model may set (engine rules, instance)

Model: sonnet

**Files:**
- `engine/rules/cards.ts`
- `instances/divided-world/cards/whoops.ts`, `autocorrect.ts`, `stick-around.ts`
- `engine/rules/cards.test.ts`, `instances/divided-world/cards/cards.test.ts`

- **`CardRules.staffOptions?: { readonly prompt: string; readonly schema: Record<string, unknown> }`.** `prompt` is what
  the persona is told about the card's options, in the instance's words. `schema` is the options object's JSON schema
  for the provider: strings and enums only, since structured output cannot hold lengths, and the card's validator holds
  its bounds.
- **The comment at `cards.ts`:180** is rewritten: `staffConfigs` is now the fallback when a persona's own options fail,
  and the persona chooses (`staffOptions`).
- `staffConfigOf` keeps its behavior and its tests. Its doc says it is the fallback.
- **The instance's words**, plain and short. The build writes them, and they are read in review:
  - Whoops!: `{ color }`. The ink is any named color or `#rrggbb`. The five-ink `staffConfigs` stays as the fallback.
  - Autocorrect: `{ phrase, replacement }`. The phrase is words copied exactly from the post being replied to, at least
    4 characters. The replacement is up to 100 characters. It has no fallback.
  - Stick Around: `{ sentence }`, optional. It is what a reader must tick to be let go, at most 200 characters. Leaving
    it out gives the default.
- **The offer** (`chatter/core.ts`:229) adds a card when `staffConfigOf(c, () => 0) !== null || c.staffOptions`. So
  Autocorrect is offered.

Tests first:
- A card with `staffOptions` and no default is offered, and a card with neither is not.
- Each Divided World card's `schema` is an object schema whose properties its own `validateConfig` accepts, for a sample
  answer.
- **The poison:** a `schema` naming a field `validateConfig` drops (Whoops! with `seed`) is caught by a test asserting
  that every schema property survives `validateConfig` on a valid sample.

## Task 9. The persona chooses, and the chatter run decides the play (engine system, Edge Function)

Model: sonnet

**Files:**
- `engine/system/chatter.ts` and `chatter.test.ts`
- `supabase/functions/chatter/core.ts` and its tests

- **`OfferedCard`** gains `options?: { prompt: string; schema: Record<string, unknown> }`, copied from `staffOptions`.
- **`chatterPrompt`**: each offered card with options adds its `prompt` on the line after it. The prompt names
  `card.config.<key>` as where its options go.
- **`chatterSchema`**: `card` gains an optional `config` object. It has one optional property per offered card that has
  options, named by the card's key, whose schema is that card's. No `anyOf` is used, so any provider's structured output
  holds it.
- **`CHATTER_RULE` becomes `chatterRule({ offered })`.** `repair` keeps only the fields a rule names, so the rule is built
  per call, as the schema is.
- **`repairChatter`** keeps `card.config[card.key]` as the answer's `card.config` and drops the other cards' options with
  a trim.
- **`chatter/core.ts`** (:355-366), for a card in the answer:
  1. It reads the target as the act function does: `card_target_reach` for the post replied to, or the persona's own new
     post for a Set.
  2. It decides the play with the card's rules: `validateConfig(config)`, then `effectsOnTarget` and `decidePlay` or
     `decideSet`, as `act/core.ts` (:152-162) does.
  3. If the persona's options fail, it records a trim naming the failed predicate and uses `staffConfigOf` with the
     seeded generator it uses today. If that is null, it drops the card with the trim (`cardRefused`) and the post stands.
  4. It calls `staff_play_card` or `staff_set_card` with the decided config, as today.
  - `record.cardConfig` keeps the config that was played.
  - `record.cardOptionsFailed` names the failure, where there was one.
- **Comments rewritten:** `chatter.ts`'s header (:16-17) and `core.ts` (:358). `engine/system/moves.ts`'s header line
  "free text it returns is shown, never acted on" becomes the reworded rule's terms: a key outside the catalog is not a
  move, and a model's free text is never read as a choice.

Tests first (`chatter.test.ts`, and `core.test.ts` with its fake database and models):
- The schema carries `config.whoops` only when Whoops! is offered.
- A persona's valid Autocorrect is played with its phrase.
- A phrase that is not in the post drops the card with the trim, and the post is written.
- An ink that is not a color falls back to a `staffConfigs` ink, with the trim.
- An answer carrying another card's options keeps only the chosen card's.
- A rerun the same day writes nothing twice (the pool's existing test still passes).

## Task 10. The export round trip carries a `card_end`

Model: haiku

**Files:** `supabase/tests/e2e/0003-export.ts`.

- In the fixture's `do $$` block (:83-198), after the caught card, play one more card and end it through
  `reverse_card` as an admin (the fixture's admin, or `set local role` with an admin's claims, as the block does for
  other admin writes).
- Assert the `card_end` row by id after the round trip, as the trap rows are (:396-399).

Red first: the assertion fails before the fixture writes the `card_end`.

## Task 11. The log's lines and the alert's words (engine UI)

Model: sonnet

**Files:**
- `engine/ui/log/lines.ts`
- `engine/ui/log/useLog.ts`
- `engine/ui/data/log-page.ts`
- `engine/ui/alerts/words.ts`
- `engine/ui/alerts/toast-kinds.ts`
- `web/src/data/supabase.ts` (the log reads, :1146-1157)
- `engine/ui/data/fake.ts`
- tests

- **The log** reads `my_cards_ended` (Task 4) as one more page merged by `useLog`, as `my_caught` is (:31, :71).
- **The lines**, plain and true:
  - `side = 'cast'`: "An admin ended your Whoops! on Gizmo's post. The orbs and the card are not refunded."
  - `side = 'onMine'`: "An admin ended Gizmo's Whoops! on your post."
  - Each line follows to the play (`actsFollowed`, :562).
- **The alert words** (`words.ts`): `cardEnded` reads "An admin ended your Whoops! on Gizmo's post." It is toastable
  (`toast-kinds.ts`).

Tests first:
- `lines.test.ts`: both lines for a reversed play.
- No line for a third party's reversal (the view's rows only).
- `words.test.ts`: the alert's words.

## Last. The full build and the final review

`npm run build`, `npm run typecheck`, `npm run test:sql` and `npm run test:e2e` run green. Their output goes in the PR,
with the red runs of every task above.

## Ways out of the states this adds

- **A reversed card play** is final and holds nothing. Its layer is gone, it holds no stack place, and it wards nothing.
  The caster can play another card, and the target is free of it.
- **A card the bot's options failed on** is either played with code's fallback or dropped. The post stands either way,
  and no state is held.
- No state is added that a player, a character or a post is held in.

## The masks

- `reverse_card`'s refusals name a play's state only for `card` Acts. A back is a `set` Act and gets "that is not a card
  play", the same words as any other non-card. The Lens control is drawn only on face-up plays.
- `staffCards` lists only staff characters' face-up plays, all public Acts. A staff Set appears only once it has sprung.
- `my_cards_ended` is computed from the caller's own characters and public Acts. It never reads another player's
  ownership. A third party sees no row, which is about their own characters and so proves nothing about anyone else's.
- The `cardEnded` alert goes to the caster's own player, about their own play. It is written in the same transaction as
  the reversal, so its timing is the reversal's, never a function of who owns the target.

## Review focus

- **Every liveness reader the survey named.** Is any reader of a play's liveness left that does not call `card_ended`, or
  whose TypeScript twin does not drop `reversed`? Check especially `fake.ts` against the SQL, `momentParts`, and
  `PlayForm.tsx`/`PlayActions.tsx`, which read `livePlays`.
- **Layers after a reversal:** a fourth play after one of three is reversed takes a new layer, and nothing reuses one.
- **Settlement at a window's edge:** a reversal written in the same second as `window_end`, and a play voted on in two
  windows and reversed between them.
- **The bot's free text on a player's post.** Read the prompt lines Task 8 adds. Does any path put a model's words into an
  effect without the card's own `validateConfig` and `canApply`?
- **An Autocorrect cast against an excerpt.** The persona sees the post clipped to `digestExcerptChars`. Its phrase is
  checked against the post's full visible text, so a phrase from the excerpt is found. A phrase that spans markup in the
  raw body is refused, and the card drops with a trim.
- **The admin queue's cost** on a busy instance: the new group reads only the 30-day window through its partial indexes.
