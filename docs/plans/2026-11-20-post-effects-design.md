# Effects on a post: a limit the rules hold, and a read the rules bound

Record, written 2026-11-20. A design session with the owner on package 5 of the backlog roadmap (#845, "Reads at a busy
instance's scale"), started from the owner's words: "Only drawing 8 effects on a post seems somewhat reasonable but we should
likely reject additional plays that create visual effects if a certain number are already active. This would need to account
for effects like autocorrect where even after it's cleared an 'effect' is still rendered, albeit a practically free one." The
plan is `docs/plans/2026-11-20-post-effects-plan.md`.

## 1. What is there today

- **The 8 is a read, not a rule.** `thread_page` takes the *oldest 8* Acts of kind `card`, `set` or `spring` on each post
  (its `on_posts` CTE, `row_number() ... where n <= 8`), and its ORIGIN box the oldest 20 (`o_plays`). The client asks
  `cardsOn`/`cardsOnMany` (`web/src/data/supabase.ts`, straight from `acts_public`) with `PLAYS_PER_POST = 8`
  (`engine/ui/cards/plays.ts`), and `cardsOnMany`'s limit is a page's total (`posts.length * 8`), so one post can take the
  whole page's share.
- **What the rules allow is far more.** The only per-post bound is each card's own stack (`landsOn`, `engine/rules/cards.ts`;
  `place_cast` in SQL). Divided World's fifteen cards that draw an `Effect` stack to about 30 between them, and about 25 more
  cards draw only a mark.
- **So more than a ninth play goes missing.** The 8 slots are spent on any play, oldest first, ended or not, drawing or not: a
  post that has seen eight Mooch plays, ended Uses or caught casts draws no Whoops! played after them, though it was paid for.
  This is #86's last important item ("The engine guesses an instance's stack limit").
- **The server cannot tell what draws.** `Effect` is the screens' (`CardUi`). `CardRules` and `card_kinds` hold nothing that
  says a card draws on its post, and the `clean` flag Whoops! and Autocorrect save in their state is read only by TypeScript.

## 2. Scope

Plays on a post: a limit on the effects a post draws, and a read of a post's plays that the rules bound. The rest of package 5
(#327, #641, #673, #580, #354, #194, #491, #690, #703, #466, #497) shares a theme and no code, and each takes a session of its
own. #317's layer cost and #557's Glitter Bomb canvases are not settled here: the limit bounds how many layers one post can
stack, which #317's measurements can now be taken against, and its remedy (merge, cull or rest) stays its own.

Weighed alternatives: a design over the whole package (rejected: a dozen designs in one), and this one with #317 and #557
folded in (rejected: #317's remedy waits on measurements it does not have).

## 3. The limit

**A post holds at most `postEffects` drawing effects in force.** An engine rule; the number is the instance's.

### What counts

On the post itself, each of these counts one:

- a play in force of a card whose rules say it draws (`CardRules.drawsEffect`), unless its saved state says it is cleared;
- a live card back, whatever card it hides.

Nothing else counts: a mark-only card (Mooch, Toll), a play that ended by its time, was ended by an admin, did not take or was
caught, an instant play, and every effect falling on the post from its character, thread or board.

**Weighed: what counts.**
- *Drawing plays, cleared ones free* (chosen). One number a refusal can say plainly, and no guessed costs.
- *A weighted budget* (each card a draw weight against a per-post budget): closer to the real cost, but the weights would be
  guesses until #317's measurements exist, and "too heavy" is harder to say to a player than "too many".
- *Every live play*: a post full of marks would refuse a Whoops! for a cost that is not there.

### Cleared plays count as they draw now

`CardRules.drawsEffect` is `{ cleared?(state: unknown): boolean }`: a card that draws declares it, and a card whose author can
clear its effect gives the predicate. Whoops! answers its `clean` (washed clean); Autocorrect answers its `clean` (no strip
left). At every save of a play's state the act function asks the card and stores the answer in an engine column,
`effect_state.cleared`. The count reads that column, so it counts what draws now.

A later save can un-clear a play (an edit brings Autocorrect's phrase back, and its tape with it). If the post is full by then,
that play draws over the limit: it was paid for and is never refused after the fact. The overshoot is bounded by the cards'
stacks, since every drawing play in force still holds a place in its card's stack.

**Weighed.** *Freed once, for good* (the first clean save frees the slot whatever later saves say): the count could say free
while tape is back on the post. *Never frees*: a washed-out post stays full until its plays end, and a cast with no end never
does.

### Card backs hold a slot alike

A live back counts one whatever it hides, so the count is the same for every setter and proves nothing about the card ("A
response never proves a private fact"). A Set is refused on a full post. When a back springs, the sprung play counts only if
its card draws; taken back or timed out, the back's slot frees. A post holds one live back at a time (`place_cast`), so a back
holds at most one slot, and a spring can never overfill a post because its slot was held.

**Weighed.** *Backs never count*, a spring landing over the limit: each spring overshoots by one, and spring after spring the
overshoot builds, bounded only by the stacks.

### Effects from above do not count

A play on a character, a thread or a board is never refused because a post under it is full, and a post's own plays are never
refused for effects falling on it from above. Each reach above already holds at most one effect falling on a post's date, so
a post draws at most `postEffects` plus about three.

**Weighed.** *Counting them where they fall*: a Glitter Bomb on a character would take a slot on every post that character
wrote while it was up, which the post's players never chose.

### The number

`Settings.postEffects`, a whole number the engine bounds to 1–16 (`instanceProblems`), seeded and read like every setting, so an
admin tunes it in the running instance. Divided World ships 8. Lowering it refuses new plays on posts above it and changes
nothing already on them.

**Weighed.** *An engine constant*: one number for every instance, changed only by a release.

### Where it is held

- **The engine's decisions.** `decidePlay`, `decideUse` and `decideSet` (`engine/rules/cards.ts`) refuse a drawing play or a
  set on a post whose count has reached `settings.postEffects`, after the card's own landing. Whatever asks them holds the
  limit: the act function, the play form, the ghost marks (`engine/ui/cards/land.ts`) and the Mod Bots' pool. The Mod Bots'
  offer (`supabase/functions/chatter/core.ts`) also leaves drawing cards out when the post it would quote is full, so no paid
  answer picks a card the decision must refuse.
- **The database.** `place_cast` and `place_set` count again under the lock they already take on the post, so two plays racing
  for the last slot cannot both land. One SQL function, `post_effects_up(post)`, is the count, read by both, by the spring and
  by the Mod Bots' offer. It reads `card_kinds.draws_effect` (seeded from `drawsEffect`) and `effect_state.cleared`.
- **A spring.** A back's slot is held on the post it is set on, but a Move springs onto the post that quoted it. A spring
  already lands only where its card's stack has room there, and otherwise leaves its back set for the next quote
  (`spring_traps`); room under the limit joins that test for a card that draws. It is the stack's room test widened, read
  from the quoting post's public plays.
- **The rules' view of a post.** `CardEffect` gains `draws?: true` and `cleared?: true`. `card_target` gives them from the
  same columns; the screens' `effectsOf` gives them from the instance's rules and the store's saved states, so the screen and
  the server count alike.
- **One list.** `drawsEffect` (rules) and `Effect` (screens) say the same thing in two layers, which cannot import each other.
  `instanceUiProblems` holds them equal both ways (a card that reaches a post and draws an `Effect`, or is `drawnBy` one,
  declares `drawsEffect`, and a card that declares it draws one), driven red on a card that disagrees.

## 4. What the player sees

The glass, plain and out of character.

- **Before anyone pays.** On a full post, a drawing card's ghost mark is not drawn, as for any card that cannot land there, and
  the play form says why for a drawing card; mark-only cards are still offered.
- **The words**, from the form and from the server alike: "This post already shows 8 effects, the most it takes. A slot opens
  when one ends, is ended by an admin, or its author clears it." (The number is the instance's.)
- **No running count.** A post shows nothing of the limit until it is full.

**Weighed.** *A count in every Lens* ("6 of 8 effects"): a line on every Lens for a limit most posts never reach. *The refusal
alone*: the player learns the post is full only after choosing a card and its configuration.

**The masks.** The count is computed from public plays and from backs counted alike; nothing in it reads who owns a play, what
a back hides or who reacted. A refusal's words and timing are the same for every caster.

**Ways out.** A full post is no state a player is stuck in: the post and its words are untouched, and the refusal names how a
slot opens (a play's time, an admin's end, the author's clearing). A play that un-clears over the limit is a post drawing one
more, and ends as that play ends.

## 5. The read

**A page carries every play in force on its posts, and the newest 8 ended plays on each.** Both are bounded by the rules at any
age of a post.

- **In force** is bounded by the stacks: drawing plays by `postEffects` (plus any un-cleared overshoot), mark-only plays by
  their cards' stacks, one live back.
- **Ended** (ended by time, ended by an admin, untaken, caught, a back sprung, taken back or timed out, an instant) grows
  without end as a post is played on for months. The page carries the newest 8 (`ENDED_PER_POST`, an engine constant), so
  their marks and what their effects leave (Whodunnit's "it was X all along" line, an "Ended by an admin" row) draw as today.
  The Lens ends with "Show earlier plays" where a post has more, which pages the older ones in, 20 at a time, into the
  post's store. The read says only whether more are there, never how many, since a count would grow with the post's age.

**Weighed.** *None on the page*, the Lens loading ended plays when opened: ended marks and residues would vanish from the
thread. *All of them*: the page read grows with a post's age, which is what this package exists to fix.

### A row per post play

Plays in force cannot be found by recency: a cast with no end played a year ago sits behind any number of later ended Uses.
So each play on a post gets a row of its own, `play_post (play, post, card, created_at, ends_at)`, as `play_reach` is for plays
beyond a post. It is the play's state, not the play: the Act is never touched ("Append-only"). A trigger on `acts` writes it for
every `card` or `set` Act with a target, whichever function wrote the Act (`place_cast`, `place_set`, `lay_sprung`, a surface
card, a Mod Bot's play), with `ends_at` the play's own end (its `ends`, a back's time), or its creation for a play over when it
lands (caught, instant). A later Act or row that ends a play sets `ends_at` to that moment if it is earlier: an admin's
`card_end`, a back's `spring` or `take_back`, a write refunded as untaken (`card_write_refunds`). `card` is null for a back, so
the row holds no hidden card. A migration fills it for the plays already held. Indexes on `(post, ends_at)` and
`(post, ends_at desc)` make each post's read two probes whose size the rules bound: the plays not yet ended, and the newest
ended. A spring rides with the back it sprang and an admin's end with its play, as `card_end` rides today.

**Weighed.** *Scan every play on the post and filter*: correct, and costs more each month a hot post stays in play.

### What goes

`PLAYS_PER_POST`, `thread_page`'s "oldest 8" CTE and its ORIGIN box's "oldest 20", replaced by one SQL function both call
(`post_plays(posts uuid[])`), so the shape lives once. `cardsOn` and `cardsOnMany` call the same function and take no limit.

## 6. The layers

Engine: the limit, its setting and bounds, `drawsEffect`, the count in the decisions and in SQL, `effect_state.cleared`,
`card_kinds.draws_effect`, `play_post`, `post_plays`, the Lens's paging and the refusal's words. Instance: which cards declare
`drawsEffect` and their `cleared` predicates (Whoops!, Autocorrect), and the number 8 in Divided World's settings. Nothing in
the engine names a card.

## 7. Open

- Whether a card other than Whoops! and Autocorrect can be cleared by its author (Graffiti's wall washed bare, say). The plan
  gives the two that save `clean` today; another card gives `cleared` when it gains such a state.
- What the measurements #317 asks for show once posts are bounded at 8 drawing effects. That issue is unchanged by this design.
- `effect_state.cleared` starts false for states saved before it exists, which counts them as drawing. No instance is deployed,
  so nothing is held over the limit by it; a state saved again is counted right.
