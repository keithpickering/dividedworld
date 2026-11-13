# THIS, a note that points at a post's words: design

Record, written 2026-11-13. A design session with the owner, which began from the owner's "We don't have a lot of good
cards for Lurkers." It adds one card to Divided World and one opt-in to the engine's text layers. Its plan is
`docs/plans/2026-11-13-this-plan.md`. The mocks are `docs/research/2026-11-12-this/` (`01-phone.png`, `02-desk.png`,
`03-look.png`; `build.cjs` draws them).

## Why

The Lurker earns three ways (`instances/divided-world/classes/lurker.ts`): an early reaction that matches where a post
ends up, a thread spun from another's Act that draws replies, and reactions to the cards it plays. The pool as it
stood fed none of them well:

- The Earn Gimmicks (Publicity Tour, Heat Magnet, Class Clown) raise what a character's *posts* earn, and a Lurker
  posts a few times a window.
- Reversals and own-post Gimmicks need a post of one's own to sit on.
- A Move pays a Lurker only when the play's own Act draws reactions, and few plays are themselves the thing to react
  to.
- The onboarding design gave the Lurker Bluff as its starter, and the card types design deleted Bluff.

Seven cards were sketched. The owner took two: a one-line note stuck to a post ("Rep Comment") and a bump of a dead
thread ("Necrobump"). The owner then brought an idea of their own, "THIS": "just a big THIS arrow pointing toward any
line of a post in the margin. This makes it more interesting because it could be a disagreement too." This design is
the two merged. **Necrobump is not in it** and gets a design of its own.

## 0. What the owner decided, and what was weighed

1. **One card.** THIS is the arrow; the Rep Comment is the optional words after it. The note always begins "THIS",
   and the caster's words finish the sentence, so "THIS finally somebody said it" and "THIS is how you lose the whole
   board" are the same card. No words at all is a play too: the plain "^ this" of an old forum.
2. **The wedge, on every screen.** The line under the pointed-at words opens, and the note sits in the gap. The owner:
   "The wedge is funnier." Weighed: the margin (the note hangs outside the post's frame; a phone has no margin, a
   narrow desktop has none either, and it leaves about 110 px for the words); the sticker (a label over the words that
   a reader presses aside; hiding a post's words is Whoops!'s job, and a common should not do it).
3. **Reactions are the Lens's.** The owner: "Lens already allows reactions to plays, I think that covers reactions out
   of the box." Nothing is added for them.
4. **With other cards** (the owner agreed to each recommendation):
   - **Autocorrect wins the words.** Where a tape covers the phrase, the tape stays and the highlight is not drawn
     there; the wedge is still drawn, pointing at the tape. Weighed: refusing a THIS on taped words (simpler, and it
     loses the joke of pointing at a replacement).
   - **Laugh Track's cue still fires.** THIS's highlight yields to every other card's run, as Laugh Track's does, and
     sits below Laugh Track's too.
   - **Ink stretches, and that is the card.** Whoops! and Graffiti fit their strokes to the body's box
     (`docs/plans/2026-11-06-whoops-refinements-design.md`, section 1: "It is not a defect"). A wedge makes the body
     taller, so a cheap common can nudge a careful wash or a tag out of place. Accepted for a Pepperoni card.
5. **Up to three on a post, and they do not end.** The owner: "I lean toward A, it's unobstructive." Weighed: three
   that each last a week (the post gets its height back by itself); one per phrase with no cap on the post (a hot post
   could double in height).
6. **An edit does not shake a note off.** The owner raised it: "if it's by character offset it won't hold up to slight
   edits in unrelated parts of the text, and if it's a search like autocorrect it could be trivial to remove a note by
   rephrasing something slightly." Decided: a search, with a receipt (section 3). Weighed: offsets (any edit moves or
   silences it); the plain search Autocorrect and Laugh Track use, where editing the phrase out is the way out
   ("Writing around a correction is a real move", the Autocorrect design, section 2). That suits a card that changes
   how a post reads. THIS is a remark about what was said, so rephrasing to dodge it should make the remark land
   harder.
7. **What is printed on it.** Named THIS; a Move on a post, anyone's; Pepperoni; common, at the lowest price in the
   machine with nothing more to play; the Lurker's starter. Weighed: a Sweet THIS and a Salty one (the ambiguity is
   the joke, and two cards would settle at the machine what the thread should settle); uncommon (three notes a post is
   already the limit on spam); Necrobump as the starter (a starter should be playable on any thread at once).
8. **Sixty characters.** The words after THIS are 0 to 60 characters. Weighed: 40 (a caption, not a sentence); 100
   (three of them would more than double a short post).
9. **All of it in marker.** THIS and the words are in the same handwriting, so the note reads as one gesture by one
   hand. Weighed: THIS in marker and the words in the board's own type (easier at length, and it reads as a label).

## 1. The card (Divided World)

| | |
|---|---|
| Key, name | `this`, "THIS" |
| Play | A Move (`cast`), reaching a post, anyone's, the caster's own included |
| Flavor, rarity | Pepperoni, common |
| Price | 0.20 at the machine, Feelin' Fab's, the lowest in the shop. Nothing more to play |
| On a post | Up to three (`stack: 3`). No `lasts`: a play on a post that is not a Gimmick does not end |
| Configuration | `{ phrase, words }` |

- **The phrase** is bounded as Autocorrect's and Laugh Track's is: 4 to 100 characters, at least 4 letters or digits,
  one line. It lands only where the phrase is in the post's own words, found by the engine's one matcher
  (`engine/bbcode/phrase.ts`): a quote, code, a link or an image cannot be pointed at. The three cards share the bound
  as one function, not three copies.
- **The words** are 0 to 60 characters of plain text on one line, trimmed. BBCode in them is shown as the text it is and
  never parsed, as on Autocorrect's tape. They need not differ from anything.
- **A phrase that is in the post more than once points at the first.** The play form says how many times the phrase
  appears and that selecting more words points further down. Weighed, and first proposed to the owner: remembering
  which occurrence was meant. An index goes wrong when an earlier copy is edited out (the Laugh Track design weighed
  and rejected it for that), and nothing re-checks a configuration when a face-down card springs, so the one rule that
  holds at a cast, at a spring and after any edit is "the first".
- **Two notes may name the same phrase.** A card's rules cannot see another play's configuration (`CardEffect` carries
  none), and nothing is lost: both wedges open under the same words, in play order.
- **It scores as any Pepperoni play does.** Settlement reads the play as Sweet or Salty by how the room reacted to it.
  Reactions to the play pay a Lurker (`lurker.cardDrew`) with no new rule.
- **No database change.** A card reaches the database through the instance's seed, and a play's configuration is
  checked by the instance's rules at the edge. THIS adds no table, column, function or economy number.

## 2. On the post (Divided World, the board)

The board's world: Verdana and the board's tokens, with color only on the game's own piece, which here is the note.

- **The highlight.** The phrase's words are drawn over a highlighter's swipe (a band across the lower part of the
  line, not a box), wherever no other card's run covers them.
- **The wedge.** Right after the phrase's last word the line opens: that one line's box grows downward by the note's
  height, and the words after it continue below. Because the gap is in the line and not at a pixel offset, it lands
  under the phrase however the post wraps on a reader's screen.
- **The note** sits in the gap, as wide as the post's words: "THIS" in marker, tilted a little, the caster's words
  after it in the same marker, and a hand-drawn arrow from the word up to the phrase. It names no caster: who played a
  card is shown only in the Lens (`docs/plans/2026-10-31-marks-and-the-lens-design.md`), which makes the note the
  anonymous rep comment of an old forum.
- **The ink** is the note's own red on the post's ground, with a light and a dark value, held to 4.5:1 against every
  theme's post rows in both modes by a test. Under Feelin' Fab's bright ink the note takes the bright ink, as the
  post's words do.
- **The handwriting** is Permanent Marker, the face in the mocks, kept in the card's folder with its license, as
  Autocorrect's Gochi Hand is. Nothing is fetched at run time (the page's `font-src 'self'`).
- **Under the ink, like the words.** The note is part of what is on the post, so a Whoops! splat and a Graffiti wall
  cover it as they cover the words, and a reader scrubs through to it. During the session the note was first said to
  sit above ink; it does not, because a common card should not float over a splat, and a note over an ink of any color
  cannot be held to a contrast.
- **The Lens.** THIS has one mark on the post, like any card. Its tab lists each play with its words (the note for
  that play: “phrase”, then the caster's words, or "no words"), the caster, and the reactions to the play.
- **A moment.** A card that stacks is drawn in a play's moment (`drawnInMoment`). THIS saves no state, so its moment is
  the post's version then with the notes that were on it, drawn still.

## 3. Edits: a search, with a receipt

- **While the phrase is in the post's own words, the note follows it,** by the same search on every version. An edit
  anywhere else never moves it.
- **When the phrase is edited out, the note becomes a receipt.** It leaves the words and stands at the foot of the
  post's body, above "Last edited" and the reactions, and quotes what it pointed at:
  `THIS “Stop asking for slopes.” (edited out) is how you lose the whole board`. The phrase quoted is the one the play
  named, which the play's own configuration holds, so nothing is read from the post's history to draw it. Every
  version of a post is public under History, so the receipt shows nothing a reader could not find.
- **When a later edit puts the phrase back, the note goes back to pointing at it.**
- **No fuzzy matching.** A phrase with one word changed is edited out. The rule is one a player can predict.
- **A post's three notes** may be split between wedges and receipts. Receipts stand in play order.
- The author's real defenses are before the note lands: Force Field and Sugar Coat turn a THIS away, as they turn away
  any Pepperoni common.

## 4. Face down, and a Mod Bot

- **Face down.** Like any Move, THIS can be set on one of the player's own posts. Its back springs on a quote whose
  own words hold the phrase (`setPhrase`), and the note lands on the quoting post with the setter's phrase and words
  unchanged. It points at the first place the phrase is there.
- **A Mod Bot** is offered THIS, since the pool offers every common card that says what its options are. The persona
  names a phrase and its words; they are checked by the card's own rules, the bounds any player's are held to (CLAUDE.md,
  "The System acts"). Words over 60 characters are trimmed to 60 at a word's end and the trim is written on the call's
  record; a phrase that is not in the post, or is out of bounds, cannot be repaired without inventing content, so
  nothing is played ("A validator tighter than the schema").

## 5. The engine: a trail that stands

One change, and it names no card. A text layer's wrap run may leave a **trail** after its last word
(`engine/ui/bbcode/layers.tsx`), and today the trail is drawn only where the run's own end is drawn: a run whose end
lies under a higher run has none. THIS must open its line after a taped phrase, where Autocorrect's run is on top.

- A wrap run may say its trail **stands**: it is drawn at the run's end whatever run is drawn there.
- Where a wrap run or plain words are drawn across that offset, they are drawn in two pieces with the trail between
  them. Where a replace run covers it, the trail follows what the replace run draws.
- At one offset, the trail of the run on top comes first (it belongs to that run's words), then the standing trails,
  the lower `z` first and then in the order the runs were laid.
- A run that does not ask for this draws exactly what it drew before.

Weighed: drawing the note from measured positions with no gap in the line (the words after the phrase would sit under
the note); giving THIS the highest `z` so its own end is always drawn (it would take the words from Autocorrect's tape
and silence Laugh Track's cues, the two things section 0 decides against).

## 6. The masks, the ways out, the fiction, and a busy page

- **The masks.** A cast is refused only for what anyone can see: the post's words, the cards already on it, a ward.
  Nothing differs with who wrote the post or who casts. The note names no caster, and the Lens names the caster's
  character, as for every play. The receipt quotes a public version of a public post. No response is computed from a
  private fact.
- **Ways out.** THIS adds one state: a post that carries a note.
  - Before it lands: Force Field or Sugar Coat on the post.
  - After it lands: an admin's "End this card" in the Lens, which takes the note off for everyone.
  - It holds nobody: the post can be read, quoted, edited and reacted to as before. The caster cannot take a landed
    note back (a take-back is only a setter's own unsprung back); during the session this was said otherwise, and it
    is corrected here. The note is permanent, as Feelin' Fab's rainbow is.
- **The fiction and the log.** The note is in play and may say anything a player may say. The log's line for a play is
  plain: what it pointed at, and the words.
- **Reading and the accessible path.** THIS is no obstacle, so there is nothing to make as hard another way. A screen
  reader hears the note in place, after the phrase, as a note ("Note on these words: THIS finally somebody said it").
  The drawn note and its arrow are hidden from it, so it is read once. The note's words are never part of a quote of
  the post, by selection or by the Quote button, and are not lines of the post to Whoops!'s readout.
- **A busy instance.** A post carries at most three notes. Each is one phrase search over the post's visible text at
  render, as an Autocorrect strip is, and its plays arrive in the read every post already makes for its marks. No new
  read, row or index; the cost does not grow with players, threads or Acts.

## 7. The layers

- **Engine:** the standing trail (section 5), in `engine/ui/bbcode/`. It knows no instance and no card.
- **Divided World:** everything else. The card's rules reach the engine through `CardRules`, its look through `CardUi`
  and a `TextLayer`, and its art through the card art folder.

## 8. Open

- **The starting grant is not built, for any class.** The onboarding plan's Task 11 (a `startingGrant` in the
  instance's settings and the migration that gives a new character its class's card) was never carried out, so today
  no class starts with a card. This design records THIS as the Lurker's starter in place of Bluff, and building the
  grant for all six classes is its own work, filed as an issue.
- **The card's art.** The plan gives THIS a drawn placeholder canvas and mark, as Part 4's cards had. Its rendered
  art is the owner's, as every card's is.
- **Whether Mooch crowds the Lurker** stays the season review's, as the card notes design left it. THIS does not
  change it.
