# Autocorrect: the common Pepperoni card

Record, written 2026-11-03. The design session on #150, made with the owner. Autocorrect is Minus World's signature spell
(`docs/research/minus-world/season-1-spellbook-roster.csv`: Pepperoni, 100), queued as "the next card" by the core loop's
design (`docs/plans/2026-10-28-core-loop-design.md`, section 11). The onboarding design chose it as the Jabroni's starter
card (`docs/plans/2026-11-02-onboarding-design.md`, section 5), and that plan's Task 11 waits for it. The owner confirmed
each section below. The plan is `docs/plans/2026-11-03-autocorrect-plan.md`, built by one build session in one PR.

The owner's notes from the onboarding session, carried here: common, Pepperoni; the paper strip takes the width of the
wider of the phrase and its replacement; a peeled strip leaves an adhesive mark where it was stuck, so it reads as
something that used to be there; and the peeled strip drifts slowly down the screen, swaying back and forth like paper.

## 1. What it does

**Decided:** the caster types a phrase and a replacement. Every occurrence of the phrase in the post is covered by a strip of
paper tape bearing the replacement. It is a Cast on a post, common and Pepperoni, and up to three stack on one post.

- **Replace all**, with a minimum length so that tiny words cannot be carpet-bombed cheaply. The owner chose this over
  highlighting one span and over covering only the first occurrence.
- **Matching:** whole words, any case. "cats" covers "Cats" and "CATS" but not "concatenate". It reads the post's visible
  text: a match may cross formatting (half bold, half not), but never lands inside a quote of another post, code, a link
  or an image. Exact case and raw substrings were weighed and not chosen.
- **Bounds:**
  - The phrase is 4 to 100 characters, with at least 4 letters or digits. Three characters and "two words" were weighed.
  - The replacement is plain text (no BBCode), 1 to 100 characters, and never the phrase itself, ignoring case. The strip
    shows it as the caster typed it.
- **A phrase that is not in the post** is refused in plain words.
- **Price:** the base price, plus a surcharge for the volume covered. The volume is the occurrences times the phrase's
  length in characters. Like Whoops!'s price for a long post, it adds a step's price per step and is capped in all. The
  starting numbers are 1.00 to buy, 0.25 per 50 characters covered, and 3.00 at most in all. All are economy settings,
  and the season review replaces them.
- **Each play is matched against the author's words**, never against another play's replacement.

## 2. Edits

**Decided** (the owner chose the recommendation): the strips follow the phrase.

- Every version of the post is matched again. An occurrence the author edits out loses its strip, and an occurrence added
  later gains one. Writing around a correction is a real move, and it costs an edit, which is public with its history.
- The price stays what was paid at the cast.
- The play never ends, and it needs no end: the post is always readable, by peeling and through History.
- A play is priced against the version it was decided on. A cast that arrives after an edit has changed the post is
  refused ("the post was edited; look again"), so no price is stale.

Weighed: strips pinned to the version cast on (offsets mapped across versions, and new occurrences never covered); any edit
peeling everything (a cheap undo).

## 3. Stacking

**Decided** (the owner chose the recommendation): up to three Autocorrects per post, each its own play. Where two plays'
occurrences overlap (one covers "big cats", another "cats"), the later play's strip is stuck over the earlier one, and a
peel takes the top strip first. Refusing overlaps and one per post were weighed.

## 4. Peeling

**Decided** (the owner chose the recommendation): like Whoops!.

- Any reader peels a strip on their own screen, and it is back on refresh.
- Only the post's author's peels are saved, and they hold for everyone. That is the author's way out, one strip at a
  time. A peel is kept by occurrence: after an edit, the second "Mario" stays peeled.
- **The adhesive mark:** a peeled strip leaves a faint yellowed, slightly glossy band over the author's words.
- **The fall:** the peeled strip curls up from the corner it was pulled at, then drifts slowly down the screen, swaying
  like a piece of paper, and is gone.

Weighed: only the author may peel (a reader could see the original only in History); every reader's peels saved per
account.

## 5. The look

**Decided** (the owner chose the recommendation): label-maker tape. The post is on the board, in the house style, and the
strip is one of the game's own pieces, so it may carry color.

- The strip is slightly crooked off-white paper tape with torn ends and a faint drop shadow, and the replacement is typed
  on it in Courier.
- It is as wide as the wider of the covered words and the replacement.
- The adhesive band is described in section 4.

A pale yellow sticky note and a paper color the caster picks were weighed.

## 6. The accessible path

**Decided** (the owner chose the recommendation), under "An accessible path costs what the obstacle costs":

- **The pointer:** grab a strip and drag it past a threshold to peel it. Let go before the threshold and it settles back.
- **The keyboard and screen readers:** each strip is a focusable button, announced as "Autocorrected text: 'Luigi'. Hold
  Enter or Space to peel". Holding for about as long as a drag takes peels it, and letting go early lets it settle back.
- A screen reader reads the replacement until the strip is peeled, as the eye does. After that it reads the author's words.
- **Reduced motion:** the strip lifts off and fades where it was, with no drift and no sway. It is still peeled the same way.

Tap to peel and "pick a corner, then pull" were weighed.

## 7. Where the correction shows

**Decided** (the owner chose the recommendation): only on the post itself, where the strips are drawn. Quotes, alert
excerpts, thread previews and The System's digests all read the author's words. A Quote copies the original, so quoting
an autocorrected post is a way to show what was really said. That is one more clue, and the layer is never baked into
anything else ("The System acts; it never destroys what a player wrote"). Quotes carrying the correction, and every
surface showing it, were weighed.

## 8. How a Pepperoni card settles: the room decides

**Decided** (the owner chose the recommendation): Pepperoni is "depends on context", read literally.

At settlement, a Pepperoni play reads as **Salty** if its own reactions in the window lean negative, as **Sweet** if they
lean positive, and stays **Pepperoni** on a tie or with none.

- **The lean** compares other players' reaction shares on the play in the window. Positive is excited-positive plus
  calm-positive. Negative is excited-negative plus bored-negative.
- **Class rules read the alignment a play reads as.**
  - A Jabroni sells the L when a Pepperoni card that read as Salty lands on its post.
  - A Heel earns when one that read as Salty outdraws the post.
  - A Face lifts a post with one that read as Sweet.
- **All three Pepperoni cards change:** Autocorrect, Bluff and Glitter Bomb. (A Glitter Bomb lands on a character, not a
  post, so only its own reactions and its caster's reading of them apply. Section 7 of the card mechanic's design holds.)
- **Two cards of one player on one post** still pay what one would per alignment. A Pepperoni play is held by the
  alignment it reads as (the owner's answer 3 on #4).
- **Its cost:** the lean reads only public reaction tallies, inside The System's scoring.

Weighed: Pepperoni staying neutral, read by no class rule; Pepperoni counting as both Sweet and Salty.

## 9. The engine and the instance

- **Instance** (`instances/divided-world/`): the card's rules (matching, bounds, price, state), its effect, its form, its
  face and its words. The matcher is the card's own, shared by its rules and its screens.
- **Engine:**
  - A post's target, as a card's rules see it, carries the post's current text and its version.
  - The engine extracts a post's visible text from its BBCode tree.
  - The BBCode renderer takes **text layers**: runs of visible text that an effect draws over, by offset.
  - A card's `canApply` may see its checked configuration, so a phrase that is not in the post is refused before it is
    priced.
  - `play_card` refuses a play decided against an older version.
  - Settlement gives each play the alignment it reads as.
  - The engine names no card. The "room decides" rule reads `pepperoni` as an engine alignment, as `sweet` and `salty`
    are already read.
- **This session's own choice, not one the owner was asked:** text layers are the interface, rather than an effect
  searching the rendered page's DOM for the phrase. The server and the screens then agree on what an occurrence is
  through one walk of the BBCode tree, and a strip's run is known before anything is drawn.

## 10. The masks

Nothing this adds reads who owns anything.

- Matching and the price read the post's public text.
- The refusal of a missing phrase, of a stale version and of a full stack each read only public facts, and are the same
  for every caster.
- The lean reads public reaction tallies inside The System's scoring, which is the one exception "A response never proves
  a private fact" already makes.
- An author's peel is a save by the post's author, and it is public as every effect state is.

## 11. The log

- **The author:** "Autocorrect on your post" (the existing line), with what it replaced: "It covers 'Mario' with 'Luigi'."
- **The caster:** "You played Autocorrect on post N" (the existing line), with what the volume added.
- **The author's saved peels:** one line per play, as of the latest save (the log's existing `logSave`), such as "Autocorrect
  on post N: you peeled 2 of its strips". Once none is left: "Autocorrect on post N is peeled clean".

## 12. Ways out

- **A strip:**
  - Any reader peels it on their own screen.
  - The author peels it for everyone, or edits the phrase away.
  - History always shows the author's words.
- **The play:** a finished Act, with no state that traps anyone.

## 13. A busy instance

- Matching runs once per decision on the server, over one post's text, bounded by the post's maximum length.
- On the screens it runs once per autocorrected post per render of its text, and never for a post with no Autocorrect.
- An author's saved peels are one `effect_state` row per play, read with the page's other effect states.
- The lean adds a sum over votes already grouped by Act (`windowVotesOn`). No new read.

## Open

- **#164, effect history** (filed by the owner in this session): a play whose effect its target cleared is hard to react
  to or Spin, so a play could be shown as it landed. It is its own design.
- **A long strip on a narrow screen:** a strip wider than the line. The plan lets it wrap as tape that is broken across
  lines, and the owner judges it on the shots.
