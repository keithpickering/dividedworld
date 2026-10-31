# Plays on a post: design

Record, written 2026-10-31. The design for #84, made with the owner, with #79 included. #84 asked how a post with two or
three Whoops! shows each play apart. The owner widened it on the issue: "this is ultimately a pattern for any post with
multiple cards played on it, and there could be potentially be several on one post, different types and users. Also
each is an Act which needs to be easily reacted to or spun into a thread." The plan is
`docs/plans/2026-10-31-plays-on-a-post-plan.md`. The mockup the owner chose from is
`docs/research/2026-10-31-plays-on-a-post/mock-a-b.html`.

## 0. Where it starts

- `PlayTags` (`engine/ui/cards/Effects.tsx`) draws one full tag per play, in play order: the card, the caster, the
  message on a line of its own, and when. Every tag links to the post. Nothing on a tag can be reacted to or spun from.
- The engine already treats a play as an Act like any other. `react()` (`supabase/migrations/0002_reactions.sql`)
  refuses only an `edit`. `settle.ts` counts votes on the play itself to decide whether a card "outdraws" its target,
  which decides the Face's −0.20 and the Heel's +0.20. `spin()` takes any origin, and the ORIGIN box draws a spin
  from a play (`CardOrigin`, `engine/ui/spin/Origin.tsx`). So the screens are what is missing. Today no player can
  make a card outdraw its post.
- PR #39's answer (the cards plan's amendment of 2026-10-30) put a play on its post as a tag and said "reactions on the
  post are already what a play earns from". The tag stands. This design revises that sentence: a play is reacted to
  and spun from on its own, as the core-loop design's section 7 first said ("open to reactions, so a sharp card can
  steal a post's thunder").
- Whoops!'s plate (`instances/divided-world/cards/whoops/Effect.tsx`) reads "3 layers · 40% washed", with one plain bar
  per layer. Only the top play's tag takes its ink (`tag` in `instances/divided-world/ui/cards.ts`).

## 1. Scope: one pattern for every post's plays, with #79

**Decided** (the owner chose the recommendation): one engine pattern for all of a post's plays, of any card and any
caster. It covers billing order, quiet tags, a panel per play with React and Spin thread, and each play's top
reactions shown small (#79). Whoops!'s layers sit on top of it as the instance's part.

Weighed: the pattern without React and Spin, which would leave "outdraws" unreachable until a later design; and
Whoops! alone, as #84 first proposed, which the general pattern would later redo.

## 2. Billing: the most drawn play goes on top, and the order holds still

**Decided** (the owner chose the recommendation): the play that has drawn the most gets top billing. "Drawn" is the
play's public reaction count (the sum of its tally) plus the threads spun from it. Ties go to the newest. Only public
counts are read, never who reacted (section 7). The order is set when a page of the thread is read, and again on a
refresh or another read. It never moves while a reader looks at it, so a tag is never pulled from under a finger. A
play that arrives live joins at the end of the order. A tally that grows live updates the numbers on its tag in place.

The billing order is only the order of the tags. The order the effects wrap the post's words in (`inPlayOrder`, layer
then time) is unchanged, and Whoops!'s top layer is still its newest play.

Weighed: newest on top (simple, but a sharp early card is buried by later ones), and live reordering by Realtime (a tag
can jump while it is being reached for).

## 3. The tags are quiet; a panel holds the play

**Decided** (the owner, having seen both in the mockup, chose B, fully quiet). The owner on A: "having all those
buttons laid out by default (including the caster's custom message etc) just feels distracting from the actual
reading process in a way that only a postcard effect should be, not the glass in general."

- **The tags.** The top-billed play gets a one-line tag: the card's name, its caster, and at most its three top
  reactions, small, from the public tally, or none when it has none (#79). Each other play is a chip in its card's
  color (its alignment's, or the ink the card chooses with `CardUi.tag`), showing the caster and the card's name.
  On a desktop, up to three chips are shown, then "+N more". On a phone (the thread's 40em breakpoint) there are no
  chips, only "+N more". "+N more" opens the rest of the chips in place, and they stay open until the page is read
  again.
- **The panel.** A tag or chip is a button that opens its play's panel. On a desktop the panel is a glass popover
  beside the tag; on a phone it is a bottom sheet. It holds the card's name, the caster and when it was played, the
  message, the card's own line about the play's state if it has one (section 4), the play's reactions with React,
  "Spin thread", and "Go to post". The panel is a dialog. It takes focus, closes on Esc, on its close button, or
  by a tap outside it, and returns focus to the tag that opened it.
- **React** is the post's React: the same picker, slots, refusal words and "your own reaction" outline, for the play's
  Act. A play by one of the reader's own characters shows its reactions and no React, as a post does. Only the
  reader's screen knows the play is theirs.
- **Spin thread** closes the panel and opens the spin form under the post, with the play as its origin. The form is
  named "Spin a thread from Mrs. Hooligan's Whoops!" and the thread's ORIGIN box draws the play (`CardOrigin`). A
  play's spun threads are not listed under the post (that line, `SpunInto`, belongs to the post). The panel says how
  many there are and links them.
- **Go to post** is the link the tag used to be. In the thread it goes to the post's own address. In an ORIGIN box it
  goes back to the post the play landed on.
- **A screen reader** hears the list as "Cards played on this post", then each tag as one sentence ("Whoops! by
  Mrs. Hooligan, 8 reactions. Opens the play."), then "+N more" as "Show 2 more cards played on this post".

Weighed: A, with React and Spin on the top tag and the message on it, all shown by default (the mockup's A). It
covered the top of the post and pushed its words down, on a desktop and a phone alike. Also weighed: a choice in the
post's own action row between "this post or a play on it", which is easy to miss and puts the glass in the 2003 chrome.

**Amended 2026-10-31, the owner's word on #97's shots.** The owner: "the glass has some Verdana in it (usernames
should be all caps in the glass font, like the HUD - it's condensed too, more room to work with), and also the smaller
chips format the card name + username differently compared to the larger chip. I worry the smaller chips will not be
applicable to longer usernames or postcard names - fragile in general. I generally like the look of the larger chip,
curious if we can handle these as an actual layered stack with a button to expand ("unstack") the list, allowing any to
be clicked to access its menu." Then, on the unstacked list: "I think we can unstack the list and have it float over the
post like a dropdown menu - absolutely positioned, not a block that will cause the post to change height whether it is
expanded or collapsed."

So the chips and "+N more" are gone, and every play is drawn as the one tag:
- **Stacked** (as the page opens): the top-billed play's tag, with the edges of up to three more tags fanned behind it,
  each in its own ink, for the eye alone, and a "+N" button beside it ("Unstack 2 more cards played on this post").
- **Unstacked**: the other plays' tags float under the stack like a dropdown, over the post, in billing order, each the
  same tag that opens its own panel. The post's height is the same stacked or unstacked, on a desktop and a phone. The
  button, now "Stack the cards played on this post", folds them back.
- **Its ways out**: the button, Esc, a press outside it, and a read of the page, which stacks it again. While a play's
  panel is open over it, the list stays unstacked, and Esc and a press close the panel first.
- **The names**: a caster's name on the glass is in the glass's own face, in capitals, as the HUD sets a name, never the
  board's. No glass control in or under a 2003 post takes the board's face (the cards plan's amendment on #80's round 2).

The panel, billing, the notes and Whoops!'s layers stand as written.

## 4. A card may say one line about a play, on this screen

**Decided** (the owner chose the recommendation): the panel shows a line from the card about the play's state when the
card has one. The engine names no card. An effect writes the line for each of its plays into the post's plays store
(`Plays.setNote`), and the panel reads it. The line is the effect's view on this reader's screen. It is never saved or
sent, and the card writes it in plain words, because the panel is the glass (two-worlds design, section 3).

Whoops! writes "Layer 3 of 3, on top · 40% washed", "Layer 1 of 3 · 0% washed", or "Washed clean". Stick Around can
write "You broke free this visit" the same way. That is open, and the plan does not build it.

## 5. Whoops!'s layers

- **Each Whoops! tag and chip takes its own play's ink.** Today only the top play's tag does. Screens §11's "the
  tag over the post takes the top layer's color" becomes "each Whoops! play's tag takes its own ink", since the tag on
  top is now the most drawn play and not always the top ink. An ink the card cannot read (a `luminance` throw) keeps
  the alignment's color, as today.
- **The plate's readout** (the owner chose the recommendation): one meter segment per layer, in that layer's ink, the
  top layer first and lit, a washed-clean layer faded. The readout names the top layer, which is the layer the next
  stroke washes: "3 layers · top: Spritey's yellow, 40% washed". It gives the share washed of the top layer, not a sum
  across layers. Once every layer is clean it reads "Washed clean". A layer's color is named in words: the swatch's
  name when the ink is one of the play form's swatches (`SWATCHES`, `ConfigForm.tsx`), and otherwise the name of the
  swatch nearest it in hue. So the readout never says a hex code, and nothing new is saved on the play. The visually hidden readout says the same sentence.
- The rest of §11 stands: up to three, a stroke scrubs the top layer where it starts, Hold to scrub works the top layer
  at the same pace, and the author's Wash and Write in ink act on the top layer.

## 6. The layers: engine and instance

- **Engine** (`engine/ui/`): billing (`cards/billing.ts`), the quiet tags, chips and "+N more", the panel, the notes in
  the plays store, the plays' tallies, own reactions and spins read with the page, React and Spin for a play, the spin
  form's origin name, and the reactions' glass look in the panel. `CardUi` gains no field: the note goes through the
  `Plays` store an effect already gets, and the tag's ink is the `tag` hook that already exists.
- **Instance** (`instances/divided-world/`): Whoops!'s per-layer readout and its notes, its color names, and its `tag`
  hook returning each play's own ink.

## 7. The masks

- **Billing** is computed from public tallies and the public list of spun threads. It reads no reactor and no owner, so
  two readers see the same order for the same counts.
- **React hidden on one's own play** is decided on the reader's screen from their own characters, as it is for a post.
  The server refuses a reaction to one's own Act in the same words for a play as for a post (0002's refusal).
- **Notes** are this screen's scrub state, which is already local. Nothing new is sent.
- **The plays' tallies and own reactions** are read through the same `tallies` and `myReactions` calls as the posts',
  and the same Realtime tally events update them. A reaction to a play is a public Act exactly as a reaction to a post
  is.

## 8. A busy instance

A page's plays are already read in one request (`readPlays`). Their tallies and the reader's own reactions to them join
the page's existing `tallies` and `myReactions` reads as one more batched read per page, never one per post or per
play. Their spins go through `spun.ts`'s batching (`spunFromMany`, chunked). A post with many plays draws one tag and a
"+N more", so the cost on screen does not grow with the plays on a post. A panel reads nothing new when it opens.

## 9. Ways out

The panel closes by Esc, its close button, a tap outside it, or leaving the page, and focus returns to the tag. "+N
more" is a disclosure: it opens the rest, and a reread closes it. Nothing here puts a player, a character or a post in a
new state. The log is unchanged: it already names each play on its own line, and a reaction to a play is named as one.

## Open

- Stick Around's note ("You broke free this visit") is not built.
- Whether "drawn" should weigh a spun thread more than a reaction. Both count as one for now.
- Tuning on phones of the sheet's height and the chips' wrap, with the owner, once the build's stories are up.
