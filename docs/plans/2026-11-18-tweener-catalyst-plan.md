Record, written 2026-11-18.

# Lit the fuse: the Tweener is paid for a debate its post sparked and it stayed out of: plan

Carries out `docs/plans/2026-11-18-tweener-catalyst-design.md`. One PR from `main`. It shares no file's lines with
`docs/plans/2026-11-18-face-thunder-plan.md` but both add a migration that redefines `settlement_input` and
`estimate_input`: whichever builds second copies the functions from the other's migration, not from
`supabase/migrations/0376_cushion_kind.sql`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for the rules' tests, `npx vitest run
<file>` for the screens', `npm run test:sql` for the migration). Run `npm run typecheck` and `npm run build` once after
the last task, with the tail in the PR. No deployed database, bucket or connector is touched; SQL is tested against
Postgres on localhost.

**The rule, whole.** A post's debate is every post that quotes it, transitively, and the spin and posts of each thread
another player spun from it. A spark pays `tweener.catalyst` once, under `tweener.litTheFuse`, in the window in which
its debate first holds `tweener.catalystVoices` other players of whom `tweener.catalystReturned` posted twice or more,
if that moment is within `debateDays` of the spark, the author's player has no post in the debate up to that moment,
and the spark is in no debate of an earlier post by the same player. A character's further paying sparks in a window
each pay `settings.halving` of the one before, in the order they crossed.

**The refund, whole.** For a spark that has paid, while it is handed to the class, the refund standing is `(1 −
cushioned)` times the smaller of what the votes standing on the spark cost in shrugs (half a vote's worth for each
calm or bored vote, at its weight) and half a vote's worth for each other player with a post in the debate within
`debateDays` of the spark. A window pays, under `tweener.outvoted`, the refund standing at its end less the one at its
start, which is nothing before the spark has paid.

**The layers.** Tasks 1 and 2 are the engine's and name no class or threshold. Tasks 3 and 4 are Divided World's.

**The masks.** No response, payload, Realtime event or timing is added. The settlement counts a debate's voices by
player, inside The System's scoring; the estimate counts them by character and reads only the caller's own sparks.
What a class is handed names no one: a voice is a number.

**States.** None added.

**Scale.** The input grows by the debates that a post reached in the window, each read once however many of the
window's posts are in it, and by nothing for a window post that quotes nothing and sits in no spun thread. The
engine's work for a spark is its debate's size.

## Task 1. The engine: a post's debate

Model: sonnet

**Files:** `engine/rules/types.ts` (`Settings`, `SettlementInput`, `ClassInput`, a new `SparkedDebate`),
`engine/rules/settle.ts` (`settle`: the header comment, a new block beside the one that builds `spun`, the
`classInput` literal and its `empty` test), `engine/rules/settle.test.ts`, the instance problems check that refuses a
bad setting (find it by `grep -rn "halving" engine/rules`), and the `input` helper in
`instances/divided-world/classes/classes.test.ts` (a default of `debates: []`).

```ts
// Settings
  /** How many days after a post the settlement follows the debate it sparked. Whole, at least 1. */
  readonly debateDays: number;

// SettlementInput
  /** Each quote among the input's Acts: `act` quotes `quoted`. */
  readonly quotes?: readonly { readonly act: string; readonly quoted: string }[];

/**
 * One of the character's posts and the debate under it: every post that quotes it, or quotes a post that does, and the
 * spin and posts of each thread another player spun from it, up to the window's end, in time order. A voice is a number
 * that names no one: 0 for the post's author's player, and 1, 2, and so on for each other player in the order they
 * first posted in it. With the shared vote off a voice is a character, and 0 only the author's player's own.
 */
export interface SparkedDebate {
  readonly act: string;
  readonly at: number;
  readonly posts: readonly { readonly at: number; readonly voice: number }[];
  /** The post is itself in the debate of an earlier post by its author's player. */
  readonly inOwnDebate: boolean;
  /** Every other player's vote on the post at the stretch's start and at its end, as `ActStanding` lists them. */
  readonly standing: { readonly before: readonly Standing[]; readonly now: readonly Standing[] };
  /** The largest share of a cushion play that has been up on the post or on its character at any time since the post was made; 0 with none. */
  readonly cushioned: number;
}

// ClassInput
  /** The character's posts whose debate a post reached in this stretch, or on which a vote moved in it while the debate is followed, each with its debate. */
  readonly debates: readonly SparkedDebate[];
```

- A debate's members are found from `quotes` (walked from quoted to quoter) and from the spins whose `target` is the
  spark and whose spinner is another player, with the posts of their threads (`postsIn`). Only an Act that `isPost`
  is a member. A staff Act and one of The System's are no one's voice and are left out.
- A character is handed a `SparkedDebate` for each of its posts (kind `post`) made no earlier than `debateDays` before
  the window's start that has a member inside the window, or has a member at all and a vote that moved on it inside
  the window. `inside()` places it by its latest member's time, as
  `SpunThread.at` is placed.
- `inOwnDebate` is read from the same walk: the spark is a member of the debate of another post by the same player.
- `standing` is built as `standings` is (the block that fills `nowOn`), from `input.paid` and this window's paid votes,
  for a spark no vote moved on too: `paidBefore` is no longer filtered to the Acts a vote touched alone. With the
  shared vote off it is each earlier reaction as a voter of its own, as `reactedBefore` has it.
- `cushioned` is read from the cushion plays in the input on the post or on its character whose `[at, ends)` reaches
  past the spark's time (`cushionsOn`).
- Ties in time are ordered by Act id, as everywhere in `settle`.

**Tests first** (`settle.test.ts`, through a recording class):

- A quotes the spark, B quotes A, C posts in a thread B spun from the spark: three members, voices 1, 2, 3.
- Two masks of one player are one voice with the shared vote on, two with it off.
- The author's other mask quoting the spark is voice 0.
- A thread the author's own player spun from the spark adds nothing.
- A post that quotes the spark and was made at or after the window's end is not a member.
- A spark with no member in the window is not handed over; one older than `debateDays` before the window is not.
- The author's second post, quoting a reply to the first, has `inOwnDebate: true`; a first post quoting another
  player's post has `false`.
- A staff post quoting the spark is no member.
- A spark with two calm votes from an earlier window and none in this one has them in `standing.before` and `.now`;
  one that moved to hype in the window is in `before` as calm and `now` as hype.
- A spark with a debate and a vote in the window but no member in it is handed over; one with no member at all is not.
- A half cushion on the spark's character that ended before the window but after the spark: `cushioned` 0.5; one that
  ended before the spark: 0; two plays: the larger.
- `engine/rules/settle.scale.test.ts` gains a 2,000-post quote chain in one window and holds its time bound.

## Task 2. The inputs carry the debates

Model: sonnet

**Files:** a new migration under `supabase/migrations/`, the next free number, named `<number>_debates.sql`
(`settlement_input` and `estimate_input`, copied whole from their latest definition and changed; the settings
validator that holds `when 'halving'`, from its latest definition, gaining `debateDays`), its test under
`supabase/tests/`, `instances/divided-world/settings.ts` (`debateDays: 3`) and
`instances/divided-world/settings.test.ts`.

- **`settlement_input`.** A recursive CTE walks up from each window post through `quote_refs` (`act` to `quoted`), and
  from each window post in a spun thread to the thread's origin, keeping ancestors made no earlier than `debateDays`
  before the window's start. Those are the sparks. A second walks down from each spark through `quote_refs_quoted`
  and through the threads spun from it, to members made before the window's end. Sparks and members join `touched`.
  The result gains `'quotes'`: each `quote_refs` row with both ends in `all_acts`.
  `paid` joins the sparks beside `reacted`, and `earlier_reactions` too, so a spark's standing votes are in the
  input in a window no reaction reached it (`payVotes` pays only a vote with a reaction in the window, so nothing is
  paid twice). A CTE beside `earn_up` adds each cushion play on a spark or on its character that ended after the
  spark was made, whether or not it is still up.
- **`estimate_input`.** The same two walks, led only by the caller's own posts: a spark is a post of the caller's
  characters with a member in the window. Members join `touched`, never `voted`: their reactions are not read. The caller's sparks join `voted`: they are the
  caller's own posts, whose reactions the caller's log already shows. The cushion plays are added as above.
- Each walk is bounded by time on both ends and uses the two `quote_refs` indexes; neither scans `acts`.

**Tests first** (SQL, on localhost):

- A spark from two days before the window with one quote in the window: the input holds the spark, every member and
  each quote edge. Red before the migration.
- A spark four days old with a quote in the window is not in the input.
- A window with no quote and no spun thread returns what the function returned before, but for an empty `quotes`.
- `estimate_input` for a bystander holds no quote edge; for the spark's author it holds the debate, and no reaction on
  any member that the caller's input did not already hold.
- `debateDays` of 0, a fraction or text is refused by the settings validator.
- A spark with reactions only before the window and a quote inside it: the input holds those reactions and their
  `paid` rows, and settling pays its author nothing for them again.
- A Thick Skin on the spark's character that ended yesterday is in the input; one that ended before the spark is not.
- The scale suite's bound on `settlement_input` holds with a 2,000-post chain.

## Task 3. The Tweener's rule

Model: sonnet

**Files:** `instances/divided-world/classes/tweener.ts`, `instances/divided-world/settings.ts` and its test (the
economy keys `'tweener.catalyst': 20`, `'tweener.catalystVoices': 3`, `'tweener.catalystReturned': 2`),
`instances/divided-world/classes/classes.test.ts`.

- `tweener` gains `reads`: `'tweener.catalyst'`, `{ key: 'tweener.catalystVoices', whole: true, min: 3 }`,
  `{ key: 'tweener.catalystReturned', whole: true, min: 1 }`, in one list its rule reads from, as
  `instances/divided-world/classes/lurker.ts` does. The floor of 3 on the voices is the design's section 7 and is
  commented as such.
- An exported pure `crossedAt(debate, voices, returned)`: the time of the earliest member at which the members so far
  hold that many voices above 0, that many of them with two or more posts; `null` if never.
- A spark pays when `crossedAt` is inside the stretch, is less than `debateDays` days after `debate.at`, no member of
  voice 0 is at or before it, and `inOwnDebate` is false. Paying sparks are ordered by that time, then Act, and the
  i-th pays `catalyst * settings.halving ** i`.
- The earning: `{ reason: 'tweener.litTheFuse', amount, act: debate.act, at: crossedAt, params: {
  'tweener.catalystVoices': voices, 'tweener.catalystReturned': returned, debateDays } }`. Check
  `Earning.params`'s handling of a key with no dot before using `debateDays` as one; if it is refused, name it
  `'tweener.catalystDays'` in the params only.
- An exported pure `refundAt(debate, upTo, standing, settings)`: 0 unless the spark has paid by `upTo`; else `(1 −
  debate.cushioned) * Math.min(shrugLoss(standing), voices * 0.5 * settings.vote)`, where the voices are those above 0
  with a member at or before `upTo` and within `debateDays` of the spark, and `shrugLoss` sums `0.5 * settings.vote`
  times each standing vote's calm and bored parts. The rule emits `refundAt(…, end, standing.now) − refundAt(…, start,
  standing.before)` where it is not nothing, as `{ reason: 'tweener.outvoted', amount, act: debate.act, at }` with
  `at` the debate's latest member or the stretch's end. It carries no `votes`, so no cushion reads it.
- The half in `0.5 * settings.vote` is the one `tweener.shrugged` charges: name it once in the file and read it in
  both places.
- The header comment says the rule as this plan's opening does.

**Tests first** (`classes.test.ts`, with a `debate` helper):

- Voices 1, 2, 1, 2, 3 in order: 20, at the fifth post's time.
- 1, 2, 3 with nobody back: 0. 1, 2, 1, 2 with no third: 0.
- 1, 2, 1, 0, 2, 3: 0 (the author posted before it crossed). 1, 2, 1, 2, 3, 0: 20.
- Crossing three days and a second after the spark: 0; a second before: 20.
- Crossing before the stretch, with a later member inside it: 0 (it paid in its own window).
- `inOwnDebate`: 0.
- Three sparks crossing in one window: 20, 10, 5, in crossing order.
- Tuned settings move each number, as the test at "tuned" does for the other classes.
- Outvoted, in the window the spark pays: four calm votes and three voices give back 15; two calm votes and four
  voices give back 10; none where the spark is voided.
- In a later window: a fourth voice with four calm votes standing gives back 5 more; a third calm vote with four
  voices gives back 5 more; a calm vote that moved to hype takes 5 back; nothing changing gives nothing.
- A voice whose only post is after `debateDays` adds no allowance.
- `cushioned: 0.5` halves each of those. Through `settle`, with a half cushion up when the nods landed: the
  character's `tweener.shrugged`, `card.cushion` and `tweener.outvoted` on the spark sum to no more than zero.
- A halved vote (weight 0.5) in calm costs and gives back half as much.
- Through `settle`: two masks of one player and one other player, each back twice, pay nothing settled and are
  counted as three voices with `{ sharedVote: false, halving: false }`.

## Task 4. The words

Model: inline

**Files:** `instances/divided-world/ui/index.ts` (the reason's words, and the Tweener's `description`),
`instances/divided-world/ui/index.test.tsx`, and wherever `grep -rn "Splits the room. Earns when" instances web/src
e2e` finds the description in a current file.

For the owner's approval in review; plain and true, the numbers from `params`:

- `tweener.outvoted`: `Outvoted: the players arguing under the character's post cancel its calm and bored reactions,
  one player for one vote, less the share a cushion card has covered. Taken back where a reaction moved away`
- `tweener.litTheFuse`: `Lit the fuse: within {debateDays} days of the character's post, {voices} or more other
  players were arguing under it, {returned} of them more than once, in quotes of it and threads spun from it, and the
  character's player had not posted in it`
- The Tweener's `description` gains: `Also earns when its post sets others debating and it stays out, and the debate
  cancels that post's shrugs.`

**Tests first:** `index.test.tsx` asserts the words with the numbers filled, and that every Tweener reason has words.

## Review focus

- **Acts an instance already holds.** A debate under way when this lands is judged from its first post, so one that
  crossed before the first window settled under this code never pays; check that it does not pay late.
- **A retry.** A window settled twice pays one spark once: check the crossing is decided by the debate's own times and
  never by what the run happened to read.
- **A busy instance.** One 2,000-post debate, and two hundred small ones, in a window: the walks' query plans and the
  engine's time. Every post in a chain is a candidate spark for the posts under it.
- **No net gain.** Over any run of windows, a spark's `tweener.shrugged`, `card.cushion` and `tweener.outvoted` must
  never sum above zero: check a cushion played after a refund was paid, a refund across a Turn inside the window
  (two stretches), and a refund taken back after the debate is no longer followed, where the loss can still fall
  but the spark is no longer handed over.
- **A mask.** The estimate must lead only from the caller's own posts, and a bystander's must be byte-for-byte what it
  was. Check that no line of an author's estimate differs with whether two debating characters share a player.
- **Another player's path.** A debater's second mask (one voice), the author's second mask (voids), an edit of a
  member that adds or removes a quote (which `quote_refs` rows an edit writes, and whether a quote added by an edit
  can pull a post into a debate after the fact), and a member later hidden by a card or by conduct.
- **The log's words.** "Had not posted in it" is about the player; check the words do not tell a reader of someone
  else's log anything, since only the owner reads them.
