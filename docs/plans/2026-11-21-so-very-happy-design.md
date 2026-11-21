Record, written 2026-11-21.

# SoVeryHappy and the thread lockout: design

A design session with the owner for SoVeryHappy, the Base Set's first rare Reversal
(`docs/plans/2026-11-14-base-set-design.md`, wave 3;
[#683](https://github.com/keithpickering/dividedworld/issues/683), "SoVeryHappy"). Its row (rarity, price, the 24 hours,
its way out) was settled by `docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3, "SoVeryHappy"), and its
art is already rendered (`instances/divided-world/ui/cards/so-very-happy/`). The roadmap gave the thread lockout to a
Plays design session. No Plays design has been written, so, as the Whoopee Cushion, refund outcome and Cheap Shot
sessions did for their parts, this session settles the lockout and plans it with the card. Its plan is
`docs/plans/2026-11-21-so-very-happy-plan.md`. Read on `main` at `8b5739d`, with Cheap Shot's design and plan
(`docs/plans/2026-11-20-cheap-shot-*`, building now) read for overlap.

## 1. The card

**SoVeryHappy** (Salty, rare, 3.00, Reversal set face down on one's own post). It springs on the first Move played on
that post that isn't Sweet (a Salty or a Pepperoni Move), up to rare. The Move lands as usual, and its caster keeps
everything it earns. From the spring, the character that played the Move cannot post or play cards in that thread for
24 hours. It springs once, or comes back to the setter's hand when the set time ends (`settings.setLasts`).

- Tagline: "Play it Sweet or get locked out" (the owner's, 31 characters).
- Summary: "Set face down on your post. The first Move played there that isn't Sweet, up to rare, lands, and whoever
  played it is locked out of the thread for 24 hours."
- Status: every Reversal's, "Set, face down to everyone else".
- No configuration and no form: it names no card and no quadrant.
- Its key, `so-very-happy`, falls in the shared slot between `publicity-tour` and `stick-around`. Required Reading
  has merged. Ratio (wave 4) waits for this one.

## 2. What the owner decided, and what was weighed

1. **A Mod Bot's Move springs it, and locks the Mod Bot out** (the owner's pick). The System getting owned in public
   is funny. A staff character is public, so nothing private shows. Only the Mod Bot's posts and card plays in that
   thread are refused. Its moderation (warns, visits, moves, verdicts, rulings) is not posting, and it is untouched.
   Weighed: passing over Mod Bots, as Pay It Forward and Kick Me do. Those cards pass over a Mod Bot because it has no
   hand to give a card back to, and nothing like that applies here. Also weighed: springing with no lockout, which
   spends the card on a flip and nothing else.
2. **The lockout refuses new posts and card plays in the thread, and nothing else** (the owner's pick). Refused: a
   post or reply in the thread; a card played on a post in it, on the thread itself, or on a character from one of its
   posts; and a card set face down on a post there. Untouched: reading, reacting, editing the character's own posts
   already there (a player can always fix their words), quoting a post of the thread from another thread, spinning a
   new thread off a post there, and taking back its own cards. Weighed: refusing edits too, which leaves a player who
   must correct something real waiting a day or for an admin. Also weighed: refusing spins and quotes from elsewhere,
   which closes the thread entirely and takes away the counterplay of spinning off it.
3. **The room sees a LOCKED OUT stamp on the character's postbits in that thread** (the owner's pick). Each of the
   locked character's postbits in that thread carries "LOCKED OUT" and the end time, beside where BANNED is drawn, and
   it goes when the lockout ends. It reads at the scene, and the back has already flipped to its SoVeryHappy face on
   the post that did it. Weighed: a line in the sprung card's Lens only (quiet, but the reader who wonders why someone
   went silent has to go looking); a notice above the thread's reply box (every reader sees one list, but it is far
   from the posts it is about).
4. **An admin ends a lockout by ending the sprung SoVeryHappy** (the owner's pick). The Lens's End button, and the
   dialog the admin queue shares, reach a sprung lockout back on the post. Ending it ends the lockout at once, and the
   Move that sprang it stays landed. Weighed: ending the Move that sprang it, which needs no new admin path but takes
   the Move's effect with it (a Whoops!'s ink vanishes); a Lift control on the stamp, which puts a new admin control
   on the postbit.
5. **The words say "play" and "Move"** (the owner's copy rule). The numbers design's tagline ("Non-Sweet casters get
   locked out.") and summary said "cast". The owner gave the new tagline. Every new sentence below, engine or
   instance, uses "play" for what a character does with a card and "Move" for the card played, wherever a player
   reads it. The engine's existing sentences for other outcomes are not reworded here. That is a separate copy pass.

## 3. The engine need

### 3.1 No new match

The numbers design listed "a `match` that excludes a flavor" as needed. It is not: the engine has three flavors
(`ALIGNMENTS`), so "not Sweet" is `match: { flavors: ['salty', 'pepperoni'], upTo: 'rare' }`. `spring_facts` already
asks a cast's flavor and rarity of a match, and its rarity at or below the back's own card's (rare). A legendary Move
passes over it. Weighed: an `except` list on the match, which says the same thing in a second way, and every reader
of a match would need to learn it.

### 3.2 A new trap outcome, `lockout`

A cast trap's `outcome` becomes one of three kinds: `{ kind: 'ride', share, every? }`, `{ kind: 'refund' }` and
`{ kind: 'lockout', hours }`. A lockout outcome sits beside a `match` or a `catches`, takes no configuration and no
quadrant, and its `hours` is a whole number from 1 to 168 (a week). The instance checks (`outcomeProblems`) and SQL's
`card_kinds_problem` and `card_kinds_outcome_set` refuse anything else in the engine's words.

Weighed: the 24 hours as an economy setting, which holds a card's number apart from its card. Every other number a
Reversal has (a ride's share) is on the card.

### 3.3 The spring is the lockout

`spring_traps` writes a lockout back's spring as `did: 'lockedOut'`, with two more fields:
- `locks`: the character that played the Move (`by_act`'s character), which is public as the Move is;
- `until`: the spring's time plus `hours`, frozen when it is written, as a ban's `until` is.

`acts_spring_payload` takes `('cast', 'lockedOut')` and the two keys (`locks` and `until` only on a `lockedOut`
spring, and always on one). Nothing is edited in place: the lockout is the spring Act, and its early end is a
`card_end` Act on it (CLAUDE.md, "Append-only").

A lockout back springs on a staff cast as on any other. It writes no `card_ledger` row: nothing is caught, and nothing
is handed back.

**When it ends.** `lockout_ends(spring)` is the least of the spring's `until` and the time of a `card_end` on the
spring. `locked_out_until(who, in_thread)` is the latest `lockout_ends` of the thread's live `lockedOut` springs that
lock `who`. A partial index on `acts (thread, (payload ->> 'locks'))` for `lockedOut` springs makes that one index read.
Two lockouts on one character in one thread (two SoVeryHappy posts) overlap, and the later end holds.

**The refusal.** `not_locked_out(who, in_thread)`, beside `not_banned`, raises "{character} is locked out of this
thread until {time} UTC; the lockout ends by itself then, and it holds only this character, not your other
characters" (the time rounded up to the minute, as `not_banned` does). It is called:
- in `post`, for the thread posted in (a reply, a quoting post);
- in `place_cast`, once its `in_thread` is known, for a post, a thread or a character reach (a card on a character is
  played from one of its posts, so it is written in that post's thread). A board card is written in the
  announcements thread and is not a play in any thread a player posts in, so it is not asked;
- in `place_set`, for the post's thread;
- in `write_staff_act`, for a staff `post` in a thread. (A staff card goes through `place_cast` or `place_set`, from
  `staff_play_card` and `staff_set_card`, so it is asked there.)

`place_cast` asks it before its back is met, so the Move that springs a lockout is not refused by the lockout it
springs, and a Move that carries a reply (Line Cutter) writes that reply after the spring without asking again
(`write_reply` does not ask it).

`spin` (a new thread off a post), `edit_post`, `take_back`, reactions and quotes from another thread do not call it.

### 3.4 An admin ends it

`reverse_card` accepts, beside a card play, a `spring` whose `did` is `lockedOut` and whose lockout has not ended. It
writes the same `card_end` Act on it, with the same refusals ("an admin has already ended that card", and "that card
has already worn off" once `until` has passed), and the same `cardEnded` alert to the setter's player. The Lens's
`endable` lets the End button show on a sprung lockout back for an admin. Every other back stays unendable, as today.

### 3.5 Mod Bots don't pay for an answer they cannot post

The chatter job pays a model before it writes the post (`supabase/functions/chatter/core.ts`). A persona locked out
of a thread would be refused after the paid answer (CLAUDE.md, "A validator tighter than the schema is a place a paid
answer goes to die"). So `pool_context` carries each persona's live lockouts (`{ staff, thread }`, public), and
`candidates` (`engine/system/pool.ts`) offers no reply or card in a thread its persona is locked out of. The database
still refuses one that gets through, as for a player.

### 3.6 What the screens read

- **The thread page.** Each person of `thread_page` carries `locked_until` for that thread, the time or null.
  `Postbit` draws the LOCKED OUT stamp while it is ahead. A `lockedOut` spring arriving live sets it on that
  character's people. A `card_end` on it clears it.
- **The character's own screens.** `my_characters` carries `lockouts`, the character's live lockouts as
  `[{ thread, until }]` (its own, read only by its player). The reply box shows a plain note and refuses to send, as it
  does for a ban, and the play form for a post in that thread shows the same note and is blocked. Both re-render when
  the time passes, as `useBannedUntil` does.
- **The words.** The set form's `springWords`, the setter's `trapSprang` alert, the setter's log line, the caster's
  log line and the caster's `trapStruck` alert each gain the lockout case, branching on the outcome and the spring's
  `did`, never on a card's key.

## 4. What it does to the rest of the game

- **The masks.** The spring is computed from the Move's printed flavor and rarity and the back alone, never from who
  owns the Move's character: a Move by the setter's own other mask springs it and is locked out the same. `locks` is
  the Move's character, already public. The refusal, the stamp and the note depend on the public spring alone, and the
  refusal's words are the same for any caller who plays that character. `lockouts` on `my_characters` is the
  character's own, read only by its player. No count, timing or answer differs with ownership. `pool_context`'s
  lockouts are staff characters', which are public.
- **Ways out.** The lockout is a new state. It ends by itself at `until` (24 hours), and an admin can end it at once
  by ending the sprung card. The locked-out player's screens name the end time where the state shows: the reply box,
  the play form and the stamp. The character is untouched everywhere else, and the player's other characters are
  untouched everywhere (CLAUDE.md, "No player is ever stuck").
- **The layers.** The outcome, the checks, the spring, the SQL functions, the fields, the stamp, the notes and every
  sentence are the engine's, named for what they do. The card, its face, its sheet and its `trapStruck` voice are
  Divided World's, through `CardRules`, `CardUi` and `AlertCopy.trapStruck`.
- **A busy instance.** Every post and play in a thread asks one indexed read of that thread's lockout springs for one
  character, so the cost grows with lockouts in one thread, never with players, threads or Acts overall.
  `thread_page` reads the same index once per page, for the page's people. `my_characters` reads one character's.
- **Acts an instance already holds.** Each constraint and check only loosens or adds. No existing spring, card row or
  ledger row changes meaning. `reverse_card` refuses every spring it refused before except a `lockedOut` one, which no
  instance holds yet.
- **Accessibility.** The stamp is text ("LOCKED OUT until {time}"), not color alone. The notes are `role="status"`.
  The lockout is not an obstacle a player gets through, so it needs no accessible path of its own.
- **Cheap Shot.** A lockout back lets the Move land, so it is not a catch, and a Cheap Shot does not get past it. It
  springs as a ride or a refund does (Cheap Shot's design, section 2.1). It is rare, above Cheap Shot's reach anyway.

## 5. Departures from the numbers design

- **The words** (section 2.5): the tagline is the owner's and the summary says "played" and "Move".
- **Its log line.** The numbers design wrote "A SoVeryHappy on that post locked {character} out of the thread until
  {time}." The log's spring lines are the engine's, so the caster's line is: "The {card} on {post} locked {character}
  out of this thread until {time}." The setter's is: "{Card} on {post} sprang when {caster} played {move} on it.
  {Move} landed, and {caster} is locked out of the thread until {time}." These are the same facts in the engine's
  sentences.
- **"A match that excludes a flavor"** is not needed (section 3.1).

## 6. Open

- **Whether a lockout should also stop a character from reacting in the thread.** Settled as no by the numbers design.
  It is noted here only because the stamp makes the locked character visible, and a reaction from it may read as
  breaking the lockout. The season review can revisit it.
- **The engine's other spring sentences still say "cast".** A copy pass under the owner's rule is its own change.
