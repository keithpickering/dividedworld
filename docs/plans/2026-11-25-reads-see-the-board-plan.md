# What the staff read sees of the board: polls, spun origins and plays: plan

Record, written 2026-11-25. The plan for `docs/plans/2026-11-25-reads-see-the-board-design.md` (#1071). One build
session builds it in one PR from `main`, after the design's PR is merged. That PR says `Refs #1071`, not `Closes`:
the issue also carries the digest, which `docs/plans/2026-11-25-digest-sees-the-board-plan.md` builds next and closes.

Every task is test first: name the test, record its red run, then write the code. The one check this adds is a test in
`instances/divided-world/cards/cards.test.ts` (Task 4), driven red once by a card without `seen`; the boundary check
(the engine never imports an instance) stays green.

**Migrations.** One migration, `NNNN_reads_see_the_board.sql`, taking the next free number in `supabase/migrations/`
(0423 as this is written); its SQL test takes the same number in `supabase/tests/` (`NNNN-reads-see-the-board.sql`).
`pool_read` is copied from its latest definition (`grep -l "function pool_read" supabase/migrations/*.sql | tail -1`:
0421 as this is written), and everything it does that this plan does not name stays as written, its seeds and bounds
included. Applying the migration to dw.gripe is the owner's go-ahead, never the build's.

**The layers.** The SQL, the reader, `amountWords`, the relative times and the `seen` interface are the engine's.
Divided World adds a `seen` to its cards (Task 4) and nothing else.

## The words this plan uses

- The **reader** is `readThread` (`engine/system/read.ts`); a **candidate** is one post `pool_read` returns.
- A post's **extras** are its poll and its plays; the opener's extras also take the thread's **origin**.
- **Now** is the call's own time, taken by the Edge Function when it reads, and passed in; the engine reads no clock.

## Task 1. Relative times and amounts (engine)

Model: haiku

**Files:** new `engine/system/when.ts` and `engine/system/when.test.ts`.

- `ago(then: string, now: number): string` and `until(then: string, now: number): string`, rounded as a person says
  it: under a minute "just now" (`ago`) or "in under a minute" (`until`); minutes under an hour ("12 minutes ago", "in
  12 minutes"); hours under 48 ("2 hours ago"); days under 60 ("3 days ago"); months (30-day) under 24 ("6 months
  ago"); then years ("2 years ago"). Singular for one ("1 hour ago" reads "an hour ago", "a day ago", "a month ago",
  "a year ago"). Floors, never rounds up.
- `amountWords(share: number): string`, the design's bands, by share in [0, 1] clamped: `0` "none"; below 0.15 "a
  bit"; below 0.4 "some"; below 0.6 "about half"; below 0.85 "most"; below 1 "almost all"; `1` "all".
- Tests first: every band's edges on both sides; a `then` after `now` for `ago` reads "just now"; a NaN share reads
  "none".

## Task 2. `pool_read` returns polls, plays and the origin (SQL)

Model: sonnet

**Files:** the migration (section per bullet), its SQL test.

**`post_extras(posts uuid[]) returns jsonb`**, new: for each post given, `{ post, poll, plays, reactions, rewoundTo,
body? }` as the bullets below define them, every part read set-based over the whole list (one call of `poll_counts`,
one of `post_plays`, one read of `reaction_tallies`), never a loop per post. It is the one read of a post's extras:
`pool_read` calls it for its chosen posts and the origin's post, and the digest and the patrol call it next (the digest
plan). Owned by `kayfabb_digest` and executable by `service_role` alone, as `pool_read` is. Its at-most is the list's
length, held to 200 (as `post_plays` holds it).

`pool_read` keeps its signature and every key it returns; through `post_extras` it gains:

- **On each post, `reactions`:** the post's public counts by kind, `{ <kind>: count }`, from `reaction_tallies` as
  `thread_page` reads them; an empty object for none. Never who reacted.
- **On each post, `poll`:** null, or `{ question, options, pick, secret, endsAt, closed, closedBy, counts, voters }`.
  The poll is `latest_poll(post)` unless its payload is `{removed: true}`; `counts` and the voter count are
  `poll_counts`' (0395, section 7), read for the chosen posts in one set-based call, never a loop per post. `closedBy`
  is `'author' | 'admin' | null` from the poll's `poll_close` (null where the time ran out or it is open). `voters` is
  the number of characters whose ballots count. A key `names` is **not** returned; the design's section 1 leaves the
  path for it.
- **On each post, `plays`:** the plays `post_plays` (latest in `0410_post_plays.sql`, section 6) returns for it, read
  for all chosen posts in one call, each `{ play, card, at, by, config, state }`: `card` the card's key (null for a back
  that sprang and names none, as `post_plays` gives it), `at` the play's time, `by` the caster's public name where
  `acts_public` gives the play a character and null otherwise, `config` the play's public payload configuration,
  `state` its `effect_state` row's state or null. Only what `post_plays` shows: no face-down set that has not sprung.
  Read through the same public views it reads, so concealment holds as it does on a page.
- **A rewind's body:** where a post has a live play of a card whose `card_kinds.rewind` is not null
  (`post_rewind_plays`, 0413), the post's `body` is the body of the version its config names, as `acts_public` shows
  that version, and the post gains `rewoundTo`: that version's time.
- **At the top, `origin`:** null for a thread that was not spun, else `{ kind, place, at, spunAt, moment, post }`:
  `place` is `thread_open.origin_place` (latest in `0422_spin_answers.sql`) for the thread; `at` the origin Act's
  `created_at`; `spunAt` the thread's `created_at`; `moment` true where the origin is a play (`card`, `set`, `spring`);
  `post` the post the origin stands on (the origin itself for a post, the poll's post for a poll or a ballot, the played
  post for a play on a post, the reported or appealed post for the four answer kinds, the Updates Act for an update),
  shaped as a candidate (its `seq`, `thread`, thread title, author, name, pronouns, body, `poll`, `plays`), or null
  where the board shows none (hidden, or a play beyond a post). For `moment`, `plays` are the plays of
  `spin_moment(<the opener>)` (0357) in place of `post_plays`', in the same shape.
- **Grants.** `pool_read` is owned by `kayfabb_digest`; give that role only the execute grants the new calls need
  (`latest_poll`, `poll_counts`, `post_plays` and its definers, `spin_moment`, `post_rewind_plays`), and say each in a
  comment.
- **Tests first** (`supabase/tests/NNNN-reads-see-the-board.sql`): `post_extras` of a post with reactions of two kinds
  gives their counts and no character; a post with an open poll, a closed one (each of the
  three ways), a removed one, and a secret one whose ballots carry no character anywhere in the answer; a post with a
  live Whoops! and its saved state, a sprung back, and an unsprung face-down set that does not appear; a post under a
  live Time Machine reads the version's body; one thread spun from each origin kind (post, poll, ballot, play on a
  post, play on a board, update, report, verdict, appeal, ruling) has the right `post` or null; a play spin's `plays`
  are the moment's, not today's (a play landed after the spin is absent); an unspun thread's `origin` is null. **Scale:**
  extend `0421-whole-posts.sql`'s row bound (#1069 is open on that test; keep its bound, do not loosen it) so a read of
  a thread whose posts each carry a poll and eight plays stays within a stated bound however many ballots the polls
  hold.

## Task 3. The reader shows them (engine)

Model: sonnet

**Files:** new `engine/system/extras.ts` and its test, `engine/system/read.ts`, `engine/system/read.test.ts`,
`engine/rules/cards.ts` (the `seen` type only), `supabase/functions/_shared/pool-read.ts`.

- **`extras.ts`** holds the types of `post_extras`' answer (`PostExtras`, `ReadPoll`, `ReadPlay`, `Reactions`) and every
  renderer below (`pollLines`, `playLine`, `reactionLine`, `rewoundLine`, `originLine`, `placeWords`), each pure and
  taking `now` where it says a time. It also exports `pollShort(poll, now)`, one line (the question, the leading option,
  the time: `[poll: "Rename this board?", Yes leads 9 to 4, closes in 2 hours]`), which the digest uses. The reader
  calls them; the digest and the patrol call them next (the digest plan).
- **Types.** `ReadCandidate` gains `poll: ReadPoll | null`, `plays: readonly ReadPlay[]`, `reactions: Reactions`,
  `rewoundTo: string | null`, each matching Task 2's shape. `ReadPoll` has an optional `names?: readonly (readonly string[])[]`, unread today: the
  design's path for voters' names. `readThread`'s third argument becomes `o: { readMost: number; now: number; seen:
  (p: SeenPlay) => string | null; origin: ReadOrigin | null }`; every caller is updated.
- **`CardRules.seen?: (p: SeenPlay) => string`** (`engine/rules/cards.ts`), with `SeenPlay = { config: unknown; state:
  unknown; by: string | null; ago: string; amountWords: (share: number) => string }`. The doc comment says: one or two
  sentences, in the fiction's voice, of what a reader of the board sees of this play; never a number a player cannot
  see; `by` may be null and the sentence must read without it.
- **Rendering**, all in `read.ts` so sizes are known when choosing:
  - a poll, under the body, in the design's section 1 form, its times by `until`/`ago` from `now`;
  - each play, under the poll, as `[<seen>]`, where `seen` is the instance's sentence or, when it returns null (a card
    with no `seen`, or a back with no card), `[<card name, or "A card set face down"> was played on this post, <ago>.]`;
  - its reactions, last, as `[Reactions: <kind> <count>, …]`, most first and then by kind, each kind as the instance
    names it; no line for none;
  - a rewound post, a line before its body: `[This post is showing how it looked <ago(rewoundTo)>.]`;
  - the origin, before the opener: the one line `(This thread was spun <ago(spunAt)> from <place's words>, <the
    origin's ago>.)`, with `as it stood when it was spun` added for `moment`, then its post as a block headed
    `<name> [origin, post #<seq> in "<title>"]` (no `seq` for an update: `[origin, the Updates post "<title>"]`) with
    its body, poll and plays. The place's words are one function, `placeWords(place)`, covering every `origin_place`
    kind (post, poll, ballot, play, update, answer) and tested on each.
- **Size and tiers.** `size(c)` is the rendered length of body plus extras; the opener's includes the origin. A spun
  thread's opener (an `origin` is given) ranks in tier 2. The origin is shown exactly when the opener is.
- **`READ_WORDS`** gains, after its current sentences: "Lines in square brackets under a post, and the line saying
  where a thread was spun from, describe things that really happened on the board: polls, cards played on posts, and
  the post a thread was spun from. React to them in character if you like; never quote them as anyone's words."
- **`readOf`** (`pool-read.ts`) takes `now` and the instance's cards (by key, from what each Edge Function already
  holds) and builds `seen` from `CardRules.seen`, passing `ago` and the engine's `amountWords`.
- **Tests first:** a poll renders each state (open, closed by time, by its author, by an admin; secret; one option at
  0 votes) with relative times; `pollShort` for an open, a tied and a closed poll; reactions of three kinds in order,
  and none giving no line; a play with a `seen` and one without; a rewound post; each origin kind's line; a play
  spin says "as it stood"; the origin never shows without the opener; a spun opener is tier 2 and an unspun one tier 3;
  a long poll on a tier-5 post makes it not fit where its body alone would; `names` set on a poll changes nothing
  rendered.

## Task 4. Divided World's cards say what they look like (instance)

Model: sonnet

**Files:** each card file in `instances/divided-world/cards/` that reaches a post, and
`instances/divided-world/cards/cards.test.ts`.

- **The check, first:** a test in `cards.test.ts` that every card in the instance's list whose `reaches` includes
  `'post'` (or omits `reaches`) has `seen`. **Poison:** run it with one card's `seen` removed and record the red run.
- **Each `seen`:** the design's section 3, vivid and in the fiction, never a mechanic or a number. Examples the owner
  gave: Whoops! "Wario covered this post in a big teal splat of goop" plus "A bit of it has been scrubbed away" from
  the saved state's washed share through `amountWords`. Autocorrect names each phrase and what it is taped over with,
  and how much tape has been peeled. You Were Saying? carries its tail's text. Graffiti says what is drawn and how much
  of the wall is covered. Time Machine says the post is showing how it looked a while ago. A card whose effect is
  invisible on the post (a Use card such as Sugar Coat) says what the board shows of it, in one sentence.
- **Copy:** these sentences are read by a model, never shown to a player, so the glass's copy rules do not apply; they
  stay true to the card (the fiction may exaggerate the look, never invent an effect the card lacks). Each card's
  test renders its `seen` for a bare play, a play with no caster name, and a saved state at each `amountWords` band
  the card uses.

## Task 5. The Edge Functions pass `now` and the cards

Model: sonnet

**Files:** `supabase/functions/chatter/core.ts` (the turn's read near line 583, the pick's near line 705) and
`supabase/functions/staff/core.ts` (the filings, reports and appeals), their tests.

- Each call to `readOf` passes the time it read at and the instance's cards, and the reader's `origin` from the
  `pool_read` answer. The turn's and the judges' prompts pick up the new lines through `readLines`; nothing else in a
  prompt changes.
- Pacing by characters already charges the prompt's real size, so the extras are charged with no change; a test holds
  that a turn reading a post with a poll and two plays charges their rendered size.
- **Tests first:** in `chatter/core.test.ts` and `staff/core.test.ts`, the stubbed `pool_read` answer gains a poll, a
  play, reactions and an origin, and the prompt the model is sent carries each rendered line.

## Task 6. End to end

Model: sonnet

Against Postgres on localhost: a spun thread whose opener is empty, spun from a post with a poll and a Whoops!, read by
a chatter turn; the prompt sent (the recorded stub provider's) shows the origin line, the origin post with its poll
and its splat line, and the empty opener. Record the prompt in the PR description.

## Ways out of the states this touches

No state is added. Nothing here changes what a player, a character or a post can be put in.

## The masks

- Every field `pool_read` gains is read through the public views a page reads (`acts_public`, `characters_public`,
  `post_plays`, `poll_counts`, `reaction_tallies`, `thread_open`), as any reader of the board reads them: counts of
  characters, reaction sums with no reactor, no secret ballot's character, no face-down set, a caster only where the board names one.
- The relative times are computed from the call's clock and public times. Nothing reads who owns a character, a
  class or who reacted.
- `seen` receives only the public facts of one play; it never receives an owner or a class.

## Review focus

- **Secret ballots.** No field of `pool_read`'s answer may carry a secret ballot's character or picks; check every new
  read goes through `acts_public` or `poll_counts`, and that `kayfabb_digest`'s new grants open nothing else.
- **A busy instance.** A thread of long posts each with a poll of many voters and a full stack of plays: check the
  read stays one set-based call per extra and its bound holds, and that `poll_counts` costs voters, never ballots.
- **The moment.** A play spin's origin must show the plays as they stood at the spin; check a play landed or ended
  after the spin does not leak into it, and that a spin of a post reads live.
- **What the model reads equals what a reader sees.** Check Time Machine's body is the shown version, and that no other
  card that changes the visible words is read under its layer without a line saying so.
- **The fiction in `seen`.** Read every card's sentence against its rules: no effect it does not have, no number a
  player cannot see, and no caster named where the board shows none.
- **Budget.** A post's size now includes its extras; check the must tier's newest post is still always read whole,
  extras included, and that a turn's charge matches the prompt sent.
