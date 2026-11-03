# The core loop's open questions, answered

Record, written 2026-11-03. A design session with the owner on the open issues about the core loop: reactions, the
settlement, the live estimate, Turns and reveals, and the words the log says about them. Six questions were put to the
owner one at a time, each with two or three alternatives; each section below gives the question, what was weighed, and
the answer. #137, a known bug in the same estimate read, is taken into the plan because its fix touches the same
function. The plan is `docs/plans/2026-11-03-core-loop-answers-plan.md`.

Out of scope, and left on their own issues: the card plays' defaults (#138), the alerts' questions (#143 to #147), the
glass's questions, and every follow-up list.

## 1. The live estimate is not The System's scoring (#19)

**The question.** The settlement never counts a player's reactions to their own characters (`engine/rules/settle.ts`).
The live estimate dropped them too, in `estimate_input`'s `all_reactions` (`supabase/migrations/0055_card_reach.sql`:
`r.reactor_account is distinct from c.owner`). So Ann, whose Face's Sweet card is on Bob's post, sees a fire land on
the card with no lift line, and knows it came from one of Bob's masks. That is a live response computed from who
reacted.

**Weighed.**
1. *The live estimate is not the exception* (chosen). It leaves out only the caller's own reactions, which the caller
   already knows, and counts every other reaction as anyone's. It can then say more than the settlement pays, as it
   already does by turning the shared vote and the halving off; it says "up to". The settled log stays exact.
2. *The live estimate is the exception.* Keep the code and widen the rule's text to cover it. Rejected: the exception
   was accepted for settled sums because a window's sum is coarse; a live line answers reaction by reaction.
3. *No live lines that turn on another's post* until the window settles. Exact, but it takes away the feedback a
   Face's lift and a Lurker's call exist to give.

**The rule.** CLAUDE.md's "A response never proves a private fact" gains one sentence after its exception: "The live
estimate is not that exception: it leaves out only the caller's own reactions, counts every other as anyone's, and the
settlement is exact." This PR carries the sentence and its record, so it waits on the owner (CLAUDE.md, Merging).

**What else this settles.** Any rule the estimate runs, wherever it would ask "whose reaction is this?", may answer only
"the caller's" or "not the caller's". The estimate's keys already give every other mask a player of its own
(`estimate_input`'s `keyed` and `others`), so in the engine the only owner it can recognize is the caller. The leak
was the SQL filter, and that filter is what changes.

## 2. A Pepperoni card's lean leaves out the two players it is between (#170)

**The question.** A Pepperoni play reads as Salty or Sweet at settlement by the lean of the window's reactions on it
(`readsAs` in `engine/rules/settle.ts`), leaving out only the caster's player. So a Jabroni's player can tip a Pepperoni
card on their own post to Salty with one negative reaction from another mask, and be paid `jabroni.soldTheL`; a Face
author can tip one toward Sweet.

**Weighed.**
1. *Leave out the caster's and the target author's players* (chosen). The room that decides is everyone but the two
   the card is between. This reads ownership only inside the settlement, which is the rule's stated exception.
2. *Caster only*, as built: the author's alts as a resource. Rejected: it pays a player for reacting to their own post,
   which the settlement refuses everywhere else.
3. *The author's reactions at a discount.* Rejected: a new number to tune and explain, for a middle no one asked for.

**On a staff post** nobody owns the post (`unscored`), so only the caster's player is left out, as now.

**In the live estimate** the same code runs, and by section 1 the only owner it can recognize is the caller. A card on
the caller's post leaves out the caller's own reactions, which the caller knows; any other author's player's reactions
are counted as anyone's. The estimate's lean can then differ from the settled one; the settled log is exact.

## 3. "Stole the thunder" names its unit and its window (#111)

**The question.** The log's `face.stoleThunder` and `heel.stoleThunder` say a card "drew more than the post", meaning
settlement votes in one window: one vote a player, halved. The Lens's "More reactions than the post" compares public
reaction counts over all time. Both are true about what they count, and they can disagree, which reads as the log
lying.

**Weighed.**
1. *Name the unit and the window in the log* (chosen): "drew more votes than the post this window". The Strategy Guide
   already teaches the vote (`instances/divided-world/guide/strategy-guide.md`: "Your reactions on a post share one
   vote").
2. *"drew more players than the post"*. Rejected: plainer, but untrue under the halving, and it names players where the
   log never should.
3. *Also mark the Lens "(all time)"*. Not taken: the Lens's words already say reactions, and they claim no settlement
   result.

## 4. A reveal waits out the settle run that is applying a Turn (#22)

**The question.** `unmask()` refuses while the character has a waiting Turn whose window end has passed
(`next_settlement_at(asked_at) <= now()`, `supabase/migrations/0027_unmask.sql`). Where that end is not known in
advance (a season's first window, and the window after a season's end) `next_settlement_at` is null, so a reveal made
during the settle run can name the class the Turn is replacing, dated after the Turn takes effect.

**Weighed.**
1. *The settle job records the window it has chosen before it reads its input* (chosen). `unmask()` refuses while a
   recorded run's window covers a waiting Turn and that window is not yet settled. The refusal lasts no longer than the
   run, as the known-end refusal does now, with the same words.
2. *Accept the gap* (seconds to a minute). Rejected: the record would be false on its own date, which the log may never
   be.
3. *Refuse whenever the end is unknown.* Rejected: it blocks a reveal for up to a day.

**Why a row, not a lock.** The settle function's steps (`next_settlement_window`, `settlement_input`,
`apply_settlement`, in `supabase/functions/settle/core.ts`) are separate requests, so no transaction lock spans the run.
The run's claim is a row in a table of its own, never an Act.

**Its way out.** A claim ends when the settlement for its window is applied. A run that dies leaves its claim, so a claim
also ends five minutes after it was made: five times the settle run's own budget (`MOST_RUN_MS`, 60 seconds, in
`supabase/functions/settle/core.ts`), so a live run is never outlived by its claim's end and a dead one blocks no
reveal for long. A refused reveal says to try again in a few minutes; the player may also withdraw the Turn.

## 5. An announced Turn states the class it leaves, and nothing else (#23)

**The question.** A Turn that names its old class (`show_from`) writes `was` and `since` into its tally
(`masks_change`, `supabase/migrations/0028_loud_classes.sql`). `since` is the date the old class began, so where an
earlier silent Turn began it, the announcement dates the silent Turn in public (`turns_announced`, and the season
reveal's `shown`). CLAUDE.md: a Turn announced with its old class makes that fact public "as of its date, ... and
nothing else about it is".

**Weighed.**
1. *Drop `since`* (chosen). An announced Turn says what the character was, as of the Turn.
2. *Keep `since` where no Turn set it* (the character's first class, from a season start that is already public).
   Rejected: two shapes for one statement, and a reader could infer a silent Turn from `since` being absent.
3. *Keep it and widen the rule.* Rejected.

**What the reader sees.** The reveal's statement changes from "Heel, from Sep 19 until its Turn on Oct 20" to "Heel,
until its Turn on Oct 20" (`engine/ui/reveal/statements.ts`).

**Tallies already written** keep their payload (Append-only). The read projections (`turns_announced`, and the season
reveal's `shown`) stop carrying `since`, so no screen or payload reads it. No instance is deployed, so no tally carries
it outside a test; the export carries Acts as written, which is the right copy of a record.

## 6. A class's words state the numbers in force (#57)

**The question.** A class card's `description` (`ClassLook`, `engine/ui/types.ts`) and its log words (`reasonWords`)
are fixed strings that state numbers an admin can retune (`lurker.postsAllowed`, `lurker.spunThreadRepliers`,
`lurker.crowd`, `technician.evergreenDays`). After a retune the log states the old number.

**Weighed.**
1. *The words read the settings* (chosen): `description: (economy) => string` and `reasonWords(reason, economy)`, with
   the number in force written in. A test renders every class's words under shifted settings and fails on any that
   still state a default.
2. *Leave numbers out*, as the Technician's words do. Rejected: the exact rule is what a player plans around.

**A settled line.** A ledger row holds only its reason (`supabase/migrations/0003_aura.sql`), so a line settled before a
retune is said with the number in force when it is read. The log must not lie about an old line either, so the
settlement writes the numbers it used into each ledger row whose reason has a tunable number (`params`, a jsonb column
of the ledger's own, beside the reason), and `reasonWords` reads `params` first and the live settings only where a row
has none. The live estimate, which has no ledger row, passes the settings it ran on.

## 7. The estimate reads a card's post when the caller only reacted to the card (#137)

Not a question; the root cause is found. `estimate_input` reads the Acts the caller reacted to (`reacted_by_me`) but not
the post a card among them landed on, so `estimateForOwner` throws `settle: Act <target> is not in the input`, and
anyone who reacts to another's card on a third player's post loses their estimate for the window. The fix adds every
card's and spring's post target among the read Acts to `touched`, as `settlement_input` does.

## The layers

Engine: all of it except the Divided World words of sections 3 and 6, which are the instance's (`instances/divided-world/ui/index.ts`).
The settings interface (`Settings.economy`) carries the instance's numbers into the engine's word functions; the engine
names no class.

## The masks

- Section 1 removes a live response computed from who reacted. After it, `estimate_input` reads ownership only to tell
  the caller's own from the rest.
- Section 2 reads the target author's player only in the settlement (the stated exception) and only for a sum.
- Section 4's refusal depends on a waiting Turn of the caller's own character and the run's clock, never on another
  player. A Turn is private, but the caller is the one who asked it. Its timing (a reveal refused during a run) says a
  run is underway, which is public.
- Section 5 removes a public date that dated a private Turn.
- Section 6's `params` hold settings, which are public.

## Ways out

Section 4 adds one state, a reveal refused during a run. It ends by itself when the run applies, or at the claim's
stated end, and the player can withdraw the Turn. Nothing else here adds a state.

## Open

- Nothing the owner was asked is open. The ledger's `params` (section 6) is this session's reading of "the log never
  lies" for lines settled before a retune; the owner may prefer old lines to read with today's numbers.
