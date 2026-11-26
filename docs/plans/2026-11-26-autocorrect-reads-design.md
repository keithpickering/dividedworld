# How The System reads a post wearing Autocorrect: design

Record, written 2026-11-26. A design session with the owner, from the owner's note on issue #1173 ("Autocorrect may
become a special case later, in its own design session"). Its plan is `docs/plans/2026-11-26-autocorrect-reads-plan.md`
and its evidence `docs/research/2026-11-26-autocorrect-reads/`. It amends one decision of
`docs/plans/2026-11-25-reads-see-the-board-design.md` (section 3, "The words the model reads are the words a reader
sees") for a play that rewrites a post's words; everything else that design decided stands.

## 0. The question

Every staff read gets a post's own words and, under them, one `seen` line per play. For Autocorrect the line names
the phrase and its replacement, and says whether the author has peeled any tape. The owner's thinking: most effects are
fine that way, but Autocorrect has a gag of its own. A Mod that "doesn't notice" untouched tape and reads the forged
words is funny. A partly peeled strip is the risk: a nonsense fragment read out of context, answered with a word that
makes no sense once the strip is off. Floated: untouched tape reads with the tape, and any peel makes the Mod "wise up"
and read the original and the play like any other card's. Also floated: the simplest path, today's read, may already be
good enough. The owner asked for evidence first.

## 1. What the experiment showed

Haiku, on the real staff prompts, two Mods, four taped posts, a reply turn and a filing, five information levels
(`docs/research/2026-11-26-autocorrect-reads/README.md`):

- **Today's read, tape untouched** breaks nothing for the model and loses the tape: no output mentioned it, and in
  seven of eight replies the Mod answered words every player sees covered, which on the board reads as the Mod peeling
  the tape.
- **The forged text alone** is the funniest and blind: the Mod is fooled outright.
- **A half-peeled strip as raw text** is mended by the model into something that makes sense under neither state, and
  cannot be one text anyway: only the author's peels are saved; a reader's own peels stay on that reader's screen.
- **Today's read, partly peeled** works, with dry asides about the tape.
- **The forged text plus today's line** is the best balance: the Mod answers what the board shows and knows it is tape.

## 2. Untouched tape reads as the board shows it

**Decided.** While an Autocorrect play on a post has no saved peel, every staff read shows that post's words with each
of the play's strips in place: the phrase replaced by its marker words, as a reader sees it before touching the tape. The
play's `seen` line stays under the post. Once the post's author saves any peel of that play (a strip peeled, a strip
half peeled, or all of it clean), the play reads as it does today: the original words, and the line saying the tape has
been peeled. The owner chose this over the forged text alone (the Mod never knows) and over today's read unchanged.

**Per play, not per post.** A post may wear up to three Autocorrect plays (`stack: 3`). Each is judged by its own
state: an untouched play's strips are in place in the read while a peeled play's are not.

**Stacked strips read as they stack.** The board lays every play's strips over the post's visible text in play order,
a later play's strip over an earlier one's where they overlap (`stripsOf`, `instances/divided-world/cards/autocorrect/tape.ts`).
The read does the same: of two overlapping strips that are both in place, the later play's is read and the earlier one's
is left out where they meet, so its words read as the board shows them at the top.

**A reader's own peel never counts.** What a reader peels and does not save is theirs alone and is never stored; the
staff read follows only what every reader loads, the author's saves.

## 3. One read for every duty

**Decided.** The rule holds for every staff call that reads a post: the chatter's turns and picks, the written quiz,
filings, report verdicts, appeals, the patrol and the meeting digest. Weighed: the judging duties always reading the
original (a Mod at the desk "wises up"), so that tape could never get its post's author punished; one read everywhere
with a louder line in judging prompts. The owner chose one read everywhere: taping a post into something reportable is
a play, and the author's way out is to peel the strip once the card's hold ends (`autocorrect.holdHours`), or to appeal.

The rule checks the code runs (a banned word, a minimum length, `phrase_in`) are not model reads and keep reading the
post's own words, as they do today.

## 4. The interface: a card says what it covers

**Decided.** `CardRules` gains an optional `covers(p)`: from what a reader of the board can see of one play (its
configuration and state as the board shows them) and the post's visible text (`visibleWalk`, `engine/bbcode/visible.ts`),
the stretches of that text the play covers and the words written over each, or nothing. A card with no `covers`, or a
play whose `covers` returns nothing, leaves the words as they are. The engine never names a card; Autocorrect's
`covers` is Divided World's.

**The engine applies them** in one function, before quotes are marked, so every renderer that shows a post's words
inherits it: the reader (`readThread` and the origin's post), the patrol's sample and the digest's excerpts.

**Into the source, never re-serialized.** A model reads a post's BBCode as written, and the visible text's offsets are
not the source's. The parser already reports where each real quote lies in the input, so a caller can change the input
without re-serializing the tree (`parse`'s `spans`, used by `markQuotes`); it gains the same for each text node it
keeps, recorded only where the input's slice is exactly the node's text. A cover is written into the source over the
text nodes it touches: its words into the first, the rest of its stretch blanked in the others, every tag left where
it is. A stretch that touches a text node with no recorded span is left as written (its words stay the post's own, and
the play's line still names them); this is the parser's corner, not a case play reaches.

**Autocorrect's `covers`** finds its phrase with the one matcher its rules and its screens share (`occurrences`,
`instances/divided-world/cards/autocorrect/match.ts`), so the strips the read lays are the strips the board lays. It
returns every occurrence while the play's state holds no saved peel (`peeled` empty, no `stuck`, not `clean`), and
nothing otherwise.

## 5. The line, tuned

**Decided.** While Autocorrect's tape is untouched, its `seen` line adds one sentence saying that the post above reads
as the tape shows it and whose marker words they are:

```
[Wario taped over every “the best one” in this post in masking tape with “a crime against karts” scrawled across it in marker, 5 hours ago. The post above reads as the tape shows it; the marker words are Wario's.]
```

It answers the two slips the experiment found: a filing that blamed the tape for the report, and a Mod that took the
post's author for the caster. With no caster named, it reads "the marker words are not the post's own". The peeled
sentences are unchanged.

## 6. Layers, masks, ways out, scale

- **Layers.** The parser's text spans, the `covers` interface and applying covers are the engine's. Autocorrect's
  `covers` and its `seen` sentence are Divided World's, carried by `CardRules`.
- **Masks.** A cover is computed from the post's public words and the play's public configuration and state, the
  same inputs the board draws from; nothing is computed from who owns a character. The caster is named only where the
  board names one, as today.
- **Ways out.** No state is added. A post a Mod judged by its tape has the ways out it has today: its author peels
  the tape once the hold ends, or appeals.
- **Scale.** Only a post with a play whose card has `covers` is parsed again, once per read, linear in its length; a
  thread of untaped posts costs what it does today.

## 7. Not here

- **Grudges.** The owner's idea of working what a play did into a persona's grudges (a Mod remembering who taped its
  post) belongs to a design of its own about what a Mod remembers of plays aimed at it, since splats, Kick Me and the
  rest raise the same question. Filed as an issue with this design's PR.
- **Other cards.** Every other card keeps today's read: the post's own words and its line. A card that rewrites words
  later may give itself a `covers`.
- **A digest request's post** carries no plays today, so it reads as written, as it does now.

## 8. Open

Nothing.
