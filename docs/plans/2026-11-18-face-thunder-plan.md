Record, written 2026-11-18.

# The Face's stolen thunder, judged by how the room took what was upstaged: plan

Carries out `docs/plans/2026-11-18-face-thunder-design.md`. One PR from `main`.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`node --experimental-strip-types --test <file>` for the rules' tests, `npx vitest run
<file>` for the screens', `npm run test:sql` for the migration). Run `npm run typecheck` and `npm run build` once after
the last task, with the tail in the PR. No deployed database, bucket or connector is touched; SQL is tested against
Postgres on localhost.

**The rule, whole.** A Face's play on another player's Act that drew more votes than it in the window
(`outdraws`, `instances/divided-world/classes/shared.ts`) is charged `face.cardOutdraws` under `face.stoleThunder`,
unless the Act's reactions lean negative, or the Act is a cast that reads as Salty. A tie or no reactions holds the
charge.

**The layers.** Tasks 1 and 2 are the engine's and name no class. Tasks 3 and 4 are Divided World's.

**The masks.** The plan adds no response, payload, Realtime event or timing. It adds two numbers to what a class's
rules are handed at settlement and in the caller's own estimate. Both are computed from reactions and a card's flavor;
the lean groups reactions by player, inside The System's scoring, and leaves out the caster's own player's, whom the
estimate already knows as the caller. Nothing reads who owns the outdrawn Act beyond what `onOthers` reads today.

**States.** None added.

**Scale.** Task 1 costs, for each play made in the window, one pass over the reactors of the Act it is scored
against. Task 2 adds to the input the earlier reactions on those Acts where no reaction reached them in the window:
one probe by Act for each window play, never a scan of reactions.

## Task 1. The engine: a play's target's lean and flavor

Model: sonnet

**Files:** `engine/rules/types.ts` (`PlayedCard`, `UnscoredTarget`), `engine/rules/settle.ts` (`settle`: the header
comment, the `onAct` pass, the `readsAs` function and the loop over `windowActs` that builds `played`),
`engine/rules/settle.test.ts`, and the `card` helper in `instances/divided-world/classes/classes.test.ts` (defaults
only).

`PlayedCard` gains:

```ts
  /**
   * How the room took what the play is scored against: positive vote shares minus negative ones on it, over every
   * reaction up to the window's end, unhalved, the caster's own player's left out (its author's own player's are never
   * counted). Above zero it was well received, below zero booed; zero is a tie or no reaction.
   */
  readonly targetLean: number;
  /** Where what the play is scored against is itself a card's play, the alignment that play reads as this window (`readsAs`). */
  readonly targetReadsAs?: Alignment;
```

- **The lean.** `onAct` holds each scored Act's `lean` and each voter's shares and `owner`. It is built from `shared`,
  which leaves out reactions on a staff post, so build the same from `unscoredReactions` (their shares by
  `shareVotes`) for the `unscored` targets. For a play, sum the target's lean as `readsAs` signs it (the two positive
  quadrants +1, the two negative −1), subtract the shares of each voter there whose `owner` is the caster's player,
  and `tidy` it. A target with no entry is 0.
- **The flavor.** Where `acts.get(scored)` is a play (`isPlay`) whose card the instance has, `targetReadsAs` is
  `readsAs` of it. For a staff cast (below) it is the card's own alignment where that is not Pepperoni, and absent
  where it is.
- **A staff cast a spring caught.** `UnscoredTarget` gains `readonly card?: string`. A Reversal's spring whose `by` is
  in `unscored` already resolves through `unscored.has(scored)`; nothing else changes there.
- The header comment's list gains one entry saying how the lean and the flavor are read, beside the "outdraws" entry.

**Tests first** (`engine/rules/settle.test.ts`, with a stub class that returns each played card's two fields as
earnings, or by reading `settle`'s class input through a recording class):

- Two players boo a post and one cheers it: a card on it by a fourth has `targetLean` −1.
- The caster's player boos the target from another mask: that vote is not in the lean.
- One player leaves a heat and a cheer on the target: 0.
- A target with reactions only before the window has its lean from them.
- A target with no reactions: 0.
- A staff post target (`unscoredTargets`) with two boos: −2.
- A spring of a `set` card whose `by` is a Salty cast: `targetReadsAs` is `'salty'`; a Sweet cast: `'sweet'`; a
  Pepperoni cast with heat on it from a third player: `'salty'`; a play on a post: absent.
- With `{ sharedVote: false, halving: false }`, three reactions by one other player count as three.
- `engine/rules/settle.scale.test.ts` holds.

## Task 2. The inputs carry what the lean reads

Model: sonnet

**Files:** a new `supabase/migrations/0377_target_lean.sql` (`settlement_input`, `estimate_input`, each copied whole
from `supabase/migrations/0376_cushion_kind.sql` and changed), and its test under `supabase/tests/`, named as the
suite's last file is.

`settlement_input` sends a target's earlier reactions only where a reaction reached it in the window
(`earlier_reactions` joins `reacted`). A card that outdraws a post nobody reacted to that day would be handed a lean
of 0 whatever the room had said before.

- **`settlement_input`.** A CTE `scored` names what each window play is scored against: `target_act_id` of each
  `win_acts` card or spring on a post, and `(payload ->> 'by')::uuid` of each `win_acts` spring that has one.
  `earlier_reactions` joins `reacted` union `scored`. `touched` gains `scored`. `unscored` gains the staff Acts in
  `scored`, and `unscoredTargets` sends `'card'` (`payload ->> 'card'`) where the Act is a card's play, inside
  `jsonb_strip_nulls`. `paid` is not widened: `payVotes` (`engine/rules/votes.ts`) pays only a vote with a reaction in
  the window, so an earlier reaction alone pays nothing.
- **`estimate_input`.** `targets` already puts each of the caller's window plays' `target_act_id` in `voted`, with its
  reactions to now. Add the caller's window springs' `by`. The reactions go through `keyed` and `totals_withheld` as
  every other does; nothing new is keyed by owner.

**Tests first** (SQL, on localhost):

- A card played in the window on a post whose only reactions are before the window: `settlement_input` holds those
  reactions and the post. Red on 0376.
- No `paid` row is added for it, and settling the window writes no ledger entry to the post's author for those
  reactions (run `settle` over the input in the rehearsal, or assert through the suite's existing settle harness).
- A spring whose `by` is a staff character's Salty cast: `unscoredTargets` names the cast with its `card`.
- `estimate_input` for the setter holds the reactions on the cast a window spring caught.
- An input with no card plays is byte-for-byte what 0376 returns.

## Task 3. The Face's rule

Model: inline

**Files:** `instances/divided-world/classes/face.ts`, `instances/divided-world/classes/shared.ts`,
`instances/divided-world/classes/classes.test.ts`.

`shared.ts` gains, beside `outdraws`:

```ts
/** The room valued what the card outdrew: it was not booed, and it was no Salty play. A tie or no reaction is not booed. */
export const hadThunder = (c: { targetLean: number; targetReadsAs?: Alignment }) => !(c.targetLean < 0) && c.targetReadsAs !== 'salty';
```

`face.ts` filters on `c.onOthers && outdraws(c) && hadThunder(c)`, and its header comment says the rule as this
plan's opening does. `heel.ts` is not changed.

**Tests first** (`classes.test.ts`, by the `card` and `total` helpers, each `votes: 2, targetVotes: 1`):

- `targetLean: 1`: −20. `targetLean: 0`: −20. `targetLean: -1`: 0.
- `targetLean: 1, targetReadsAs: 'salty'`: 0. `targetReadsAs: 'sweet'`: −20. `targetReadsAs: 'pepperoni'`: −20.
- Not outdrawn, `targetLean: 1`: 0.
- A Heel's `heel.stoleThunder` pays 20 at every lean.
- Through `settle`, by `onTheBoss`: the Boss's post booed by two and outdrawn by a Face's card pays no
  `face.stoleThunder`; cheered, it pays −20 (the test at "outdrawn by the Boss's post, it pays nothing" keeps its
  meaning).
- Through `settle`: a Face's Sweet spring that outdraws the Salty cast it caught, with no reaction on the cast, pays
  no `face.stoleThunder`.

## Task 4. The words

Model: inline

**Files:** `instances/divided-world/ui/index.ts` (the reason `face.stoleThunder` and the Face's `hurtsBy`),
`instances/divided-world/ui/index.test.tsx`, and every other place `grep -rn "outdraws the post it was played on"
instances web/src e2e` finds the old sentence in a current file.

The owner approves these in review; they are the log's and the Strategy Guide's, so they are plain and true:

- `face.stoleThunder`: `Stole the thunder: a card the character played on another's post drew more votes than the post
  this window. Not charged where the post's reactions are mostly negative, or where the card answered a Salty play`
- The Face's `hurtsBy`: `Hurt by bored reactions, and by a card that outdraws the post it was played on, unless the
  room booed that post or the card answered a Salty play.`

**Tests first:** `index.test.tsx` asserts both strings; the existing assertion that both thunder reasons contain "more
votes than the post this window" holds.

## Task 5. The open question, filed

Model: inline

File an issue: "Hall Pass: is a Face charged for outdrawing a Mod Bot's visit?", with the design's section 8 as its
body, for the owner. It is a question waiting on the owner and is not closed by this PR.

## Review focus

- **Acts an instance already holds.** No ledger entry is rewritten; a settled window stays settled. Check that a
  window settled again by a retry under 0377 pays what it paid: the earlier reactions added to the input must move no
  amount for any class but through `targetLean`.
- **A busy instance.** `scored` adds one probe by Act for each window play; check the plan of `settlement_input` on
  the scale fixture does not scan `reactions`, and that a post with thousands of reactions is read once however many
  cards landed on it.
- **A mask.** The estimate's lean must leave out only the caller's own reactions. Check that no line of the caller's
  estimate appears or disappears with who owns the outdrawn Act or its reactors, as 0073's finding had it.
- **A second player's path.** The post's author reacting to the card, and the caster's player booing the post from
  another mask: the first may still trigger the charge, the second must never waive it.
- **The log's words.** A charge shown beside a post the public tallies show as booed (shares against counts) is the
  settlement being exact, as "More reactions than the post" is not the settlement's word
  (`docs/plans/2026-10-31-marks-and-the-lens-design.md`); check the reason's words claim nothing about the public
  tallies.
