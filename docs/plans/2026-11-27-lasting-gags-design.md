# Lasting gags: Steel Chair and Hot Box stay

Record, written 2026-11-27. A design session with the owner, started from the owner's note:

> I have found Steel Chair and Hot Box are standing alone as visual effects with an automatic timer before they are
> deactivated. A gag like this disappearing can kill jokes on later re-reads. We give the author a "way out" in the form
> of an expiry, which is different from other effects that either stay forever (Feelin' Fab, Laugh Track, It's Curtains,
> etc) or stay unchanged until the author decides to clean them up (Whoops, Autocorrect). Steel Chair and Hot Box simply
> disappear after awhile whether people want them to or not.

It revises `docs/plans/2026-11-15-wave-1-cards-design.md`, sections 2.2 (Hot Box) and 2.3 (Steel Chair), and
`docs/plans/2026-11-15-hot-box-fog-design.md` where it ties the fog's thinning to the play's end. Every other part of
those designs holds. The plan is `docs/plans/2026-11-27-lasting-gags-plan.md`.

## 0. Where it starts

- **The timer is the card's `lasts`.** `HOT_BOX_LASTS` and `STEEL_CHAIR_LASTS` are 3 days. `place_cast` writes each play's
  `ends` into its Act payload from `card_kinds.lasts` (seeded from the rules). After `ends` the effect stops drawing and the
  kind's mark goes unlit (`docs/plans/2026-11-20-spent-marks-design.md`). A moment still draws the play as it stood.
- **Hot Box's thinning reads the end.** `strength(now, playedAt, ends)` (`instances/divided-world/ui/hot-box/smoke.ts`) runs
  from 1 at the play to 0 at its end, and the fog's opacity from full to `SMOKE.least` (0.45).
- **The effects that stay** (Feelin' Fab, Laugh Track, It's Curtains) have no `lasts` and no clear. Each play holds one of the
  post's `postEffects` slots (8 in Divided World) for good.
- **The effects the author cleans up** (Whoops!, Autocorrect) save the post author's work in `effect_state`. The card's
  `drawsEffect.cleared` says when a state is clean, which frees the slot. Autocorrect holds the author's saves for 24 hours
  after a play lands (`stateHeldUntil`, `docs/plans/2026-11-16-autocorrect-hold-design.md`).
- **A cleared play still holds its stack place.** `landsOn` (`engine/rules/cards.ts`) and the stack counts in `place_cast`
  and `spring_facts` (`supabase/migrations/0438_board_cards_on_their_board.sql`) count every live play, cleared or not. The
  post-effects design chose that on purpose (`docs/plans/2026-11-20-post-effects-design.md`, "Cleared plays count as they
  draw now"): Whoops!'s and Autocorrect's clears can be undone, so the stack bounds the overshoot.
- **Other timed cards that draw** (Kick Me, Blind Study, Whodunnit?, Time Machine, Jimmy Wails's drive) are timed because
  their game effect is: a sign that pays, a veil, a rewind, a drive. Their picture ends with their rule. They are not
  this design's subject and are unchanged.

## 1. The default: permanent, with the author's way out

**Decided** (the owner chose the recommendation): neither card has a timer. A play stays until the way out its card names.

Weighed:
- *Timed, with the author able to keep it* (the owner's third option: a Lens control that waives the timeout). A joke still
  vanishes when its author is away, has stopped playing, or is the victim of the Salty play and doesn't care to keep it, so it
  answers the note only for the posts whose author acts.
- *Permanent, with no way out for either card* (the owner's second option). Every later reader of a Hot Boxed post waves
  through full smoke for good.
- *A new card or a "fan" to clear it* (the owner's first option, as first framed). Whoops!'s and Autocorrect's saved clean-up
  is the house pattern already, so the way out can be the author's own work on the screen they already have, and no card is
  added.

## 2. Hot Box

### 2.1 The author airs it out

**Decided** (the owner chose the recommendation):

- **The control.** The held control readers know as "Wave the smoke" reads **"Air it out"** on a screen where
  `reader.author` is true, once the hold (2.2) is over. It is held as Wave the smoke is, on the post and in the Lens, and its
  sweep travels the lines at the same pace (Whoops!'s `SWEEP_PX_S`).
- **What it saves.** Each line the author's sweep finishes is cleared for every reader and saved. The saved state is
  `{ aired }`, the share of the content area's height cleared from its top, from 0 to 1 to a ten-thousandth, taken from the
  bottom of the last finished line. A share is used, not a line number, because lines differ from screen to screen, the way
  Whoops! keeps its strokes in shares of the box. When the last line is finished the state is `{ clean: true }`.
- **Letting go** keeps what was saved. The next hold starts at the first line below the saved share.
- **What a reader sees.** The band above `aired` is clear of smoke, across the whole content area; the rest is smoke as
  before, and a reader's pointer, touch and Wave the smoke work on it unchanged. A clean play draws no smoke.
- **One control for every input.** A mouse, a touch, a keyboard and a switch all air out through the same held control at the
  same pace, so the cost is the same for everyone ("An accessible path costs what the obstacle costs"). The author's pointer
  still parts the smoke for a moment as a reader's does, and saves nothing.
- **Edits.** A share outlives an edit: an edit that adds lines above the band leaves the band its share of the new box.
  `clean` holds across every edit.

Weighed: *the author's wipes, saved* as Whoops!'s wash is (a stroke store and coverage math, more to build); *one press in the
Lens* (the Salty card's sting lasts only until the victim notices).

### 2.2 The hold

**Decided** (the owner: "We should also have a 24 hour freeze like Autocorrect"): the author's saves on a Hot Box play are
refused for `hotBox.holdHours` hours after it lands, by the engine's `stateHeldUntil`, exactly as Autocorrect's are.

- `hotBox.holdHours` is an economy number, whole, from 0 to 168, at 24; 0 turns the hold off.
- During the hold the author's control reads "Wave the smoke" and does what a reader's does: nothing is saved.
- The refusal's words: "This smoke is too thick to air out until {time}. It can be aired out after that."
- No exemption for a caster who is also the author, for the reason Autocorrect's design gives: who owns both masks is private.

### 2.3 The thinning

**Decided** (the owner chose the recommendation): over the first 3 days the smoke thins as it does today, to its floor
(`SMOKE.least`, 0.45, where the words half show), and holds there. The span is `HOT_BOX_THINS`, 3 days, a constant of the
card's screen, no longer the play's `lasts`. A play that carries an `ends` (one played before this ships, section 5) thins
to its `ends` and ends there, as it does today.

The owner noted the dynamic this makes: Hot Box stacks one deep, so an author can hedge against a fresh, thick Hot Box by
leaving a thinned one up. The owner judged it balanced.

### 2.4 Aired out is final, and the post can be smoked again

**Decided** (the owner chose the recommendation): once a Hot Box play is aired out clean, no save on it is taken again, and
it holds no place in its card's stack and no slot on the post. A new Hot Box can then land there.

- **The engine rule.** `CardRules.drawsEffect` gains `final?: true`: once a play's saved state is cleared for every version
  of the post (`cleared` answers `true`, not `{ version }`), its card's clear is final. Then the database refuses any later
  save on that play, and the play is left out of its card's stack count in `landsOn`, `place_cast` and `spring_facts`. It
  names no card. A card that declares `final` must give `cleared` (`instanceProblems`).
- **Why this is safe where Whoops!'s is not.** The post-effects design kept a cleared play's stack place because a later save
  could un-clear it. A final clear cannot be undone, so the bound the stack gave is not needed for it.

Weighed: *airing out buys immunity* (the aired-out play keeps its place, so the post can never be Hot Boxed again). No engine
change, but the author's work then buys permanent protection, a stronger hedge than leaving a haze up.

### 2.5 Words

- **Description** (`describe`, with the settings): "A Salty card, common. It fills a post with smoke in the color you
  choose. Under the smoke the words can't be read: a reader points at them to clear a patch, or holds Wave the smoke to clear
  the post line by line, and the smoke rolls back in. It is the same for every reader, the post's author and you included.
  Over 3 days it thins to a haze, and the haze stays. 24 hours after it lands, the post's author can hold Air it out to clear
  it line by line for good, and once it is all aired out the post can be smoked again. One fits on a post at a time. {set
  words} It costs nothing more to play." With the hold at 0, the sentence opens "The post's author can hold Air it out".
- **The Lens's state:** "Smoke over the words"; "Smoke over part of the words" once some is aired; "Waving it away" or
  "Airing it out" while held; "Waved clear for you" while waved; "Aired out" once clean.
- **The Lens's ends**, for a reader: "Point at the words, or hold Wave the smoke, to read." For the author during the hold:
  "You can air it out for good in 5h 12m. Until then, point at the words, or hold Wave the smoke, to read." For the author
  after it: "Hold Air it out to clear the smoke line by line, for good and for everyone. Let go and you keep what you
  cleared." Once clean: "Its author aired it out for good." A play with an `ends` adds its end as today.
- **The staff read** (`seen`): "{who} filled this post with thick {color} smoke, {ago}: a reader has to wave it away to read
  through, and over three days it thins to a haze that stays." With some aired: "... Its author has aired out the top of it."
  Clean: "{who} filled this post with smoke, {ago}, and its author has aired it all out: the words read clearly."
- **The log** (`CardUi.logSave`): a clean save gives the author's line "Smoke aired out", verb "aired out", as You Were
  Saying?'s "Tail erased" does. A partial save gives no line. The line names the Act and what it changed, and nothing hidden.

## 3. Steel Chair

**Decided** (the owner chose the recommendation): Steel Chair has no `lasts` and no way out but an admin's, like Laugh Track.
It hides none of the words and holds nobody, so nobody is stuck. Up to three chairs hold up to three of the post's slots,
each its own chair and dent.

- **Words.** The description's "and each is gone 3 days after it lands" becomes "and they stay". The Lens gives no `ends`
  line for a play with none. A play with an `ends` (section 5) says its end as today.
- **Unchanged.** The throw on each scroll into view, the sounds, Throw again and reduced motion.

Weighed: *the author hauls chairs off* (more to build, and an out from a card that blocks nothing); *throw once, then rest*
(changes the gag, not asked for).

**Scope drift named.** The owner observed that three Feelin' Fabs read as one effect, made more vivid, yet take three slots.
That is a separate concern, filed as #1217. Chairs are three objects, so three slots stays right for them.

## 4. The rules

- **No player is ever stuck.**

  | State | Way out |
  | --- | --- |
  | Smoke on a post (a reader) | The pointer, a touch, or holding Wave the smoke, on the post, each visit; Quote and History show the words. |
  | Smoke on a post (the post) | The author holds Air it out after the hold; an admin ends the play. |
  | The author's hold | It ends by itself `holdHours` after the play landed; meanwhile the author reads through as any reader. |
  | Part aired out | The author holds Air it out again. |
  | Chairs on a post | They hold nobody; an admin ends a play. |

- **An accessible path costs what the obstacle costs.** Air it out is one held control for every input, timed by the post's
  length, as Wave the smoke is.
- **An effect fills the post.** The smoke fills the content area border to border. The aired band is the content area's full
  width, from its top border, and the smoke below it still meets the side and bottom borders.
- **The masks.** The hold is computed from the play's public landing time and a setting, and refused before the author check
  (the act function, as Autocorrect's). "Air it out" and the countdown are drawn only where the screen's own `reader.author`
  is true, from the reader's own characters; nothing is sent for it. The saved share and `clean` are public, as every effect
  state is, since every reader loads them. The stack count reads `effect_state.cleared`, which every reader can see in the
  smoke being gone. The refusal of a save on a play cleared for good comes after the database's author check, so only the
  post's own author can meet it.
- **The layers.** `drawsEffect.final` and its reads (rules, fake, SQL, seed) are engine and name no card. Everything about
  smoke, airing, the hold's setting and the words is Divided World's, carried by `CardRules` and `CardUi`.
- **Append-only.** The author's progress lives in `effect_state`, the row of its own a play's changing state already uses.
  No Act is changed.
- **The log never lies.** The clean save's line says what was done. A play's own line keeps saying when it ends only where its
  Act carries `ends`.

## 5. Plays already landed

**Decided** (the owner chose the recommendation): new plays only. A play keeps the end its Act records, so a Steel Chair or
Hot Box played before this ships still ends on its `ends`, its Lens says so, and its smoke thins to that end. Only plays that
land after the seed drops `lasts` are permanent. Nothing in the Acts, the log or the Lens needs a special case. Weighed:
*every play stays, ended ones too* and *plays still up stay* (the screens would ignore an `ends` the Act records).

## 6. A busy instance

- Each save of a card with `final` reads the play's state once by primary key, in `save_effect_state`. The stack counts read
  `effect_state` by primary key for each counted play of the card, at most its stack.
- An author's airing saves once per finished line, through the save path Whoops! debounces to one save at a time per play. A
  long post is tens of saves, made only by its author, once.
- Permanent plays add no work while off screen: both effects draw only while their post is in view (wave 1's section 4). More
  slots stay taken on old posts, which is how Feelin' Fab already behaves.

## Open

- Whether 24 hours is the right hold for Hot Box is judged in play; it is a settings row.
- Whether a moment (a spun thread's ORIGIN box) should show a post's smoke as it stood before it was aired out. A moment draws
  from the states as given (playable moments' section 3), so today it shows the airing as it stands now, as Whoops!'s wash
  does. Left as it is.
