# Forged quotes: design

Record, written 2026-11-20. A design session with the owner on #403: "As long as a post ID is included in the quote tag,
whatever you type is given the 'authentic quote' styling. Should check on post/edit events to see if the quoted post(s)
actually contain this text at the time of saving, and if not, force the 'shaky' look." It also settles the question the
BBCode design left open (`docs/plans/2026-11-07-bbcode-tags-design.md`, section 7, "Real quotes can be doctored"). Its
plan is `docs/plans/2026-11-20-forged-quotes-plan.md`.

## 0. Where it starts

- **A real quote is believed whatever it holds.** `engine/bbcode/parse.ts` makes `[quote=<uuid>]` a `quote` node whenever
  its name is a UUID, and `engine/ui/bbcode/render.tsx` draws the poster's words under that Act's real head: the
  author's linked name and a linked "Post #38". Nothing compares the words with the post. Only a name that is not a UUID
  is a `counterfeit` (the wobbly border; a head with no links).
- **A real quote's words are not the poster's own** (`visibleText`, `bbcode_walk`'s `plain` and `unquoted`), so
  wrapping any words in `[quote=<any post>]` carries them past Autocorrect, Says and every card that works on words.
- **A quote counts as quoting the post.** The composer passes the draft's first quote as `quoting`; `post()` stores it
  as the Act's `target_act_id`, springs the post's face-down back and writes the `quote` alert. No-quote
  (`acts_quote_guard`, 0316) refuses every real quote of a post that carries it. The conduct layer
  (`concealQuotes`, 0340) empties every real quote of a post with a hidden version.
- **The two honest ways to quote give different text.** The Quote button (`quoteText`) pastes the post's body with its
  markup live. Highlight-to-quote (`engine/ui/thread/SelectionQuote.tsx`) pastes what the post *showed* as plain text: a
  line break at each block edge, the words of a quote nested inside the post, Autocorrect's tape in place of the words
  under it, and nothing of a shut spoiler's body.
- **A post's versions are public**: the original and every edit, in the post's History.
- **SQL already reads BBCode at write time**: `bbcode_walk` (last defined in 0350), the parser's port, held to the shared
  fixtures (`engine/bbcode/plain.fixtures.ts`), runs in `acts_quote_guard` before an Act is inserted.

## 1. A doctored quote is a counterfeit

**Decided:** a real quote whose words are not in the post it names is a **counterfeit of that post's author in every
respect**. If the words are not in the post, no post stands behind the quote.

- **The look:** a counterfeit's. The wobbly border, and a head that is exactly a counterfeit's: the quoted post's author
  (as the post shows its author) with their avatar and their name as plain text, no profile link and no post number.
  The missing links are the cue a screen reader hears, as for every counterfeit ("An accessible path costs what the
  obstacle costs"). Under a live Whodunnit veil the head shows the stand-in, as every head of that post does.
- **Its words are the poster's own:** Autocorrect, Says and every card that works on words reach them, search indexes
  them, and the rules that judge an author's own words judge them. This closes the BBCode design's open question.
- **It quotes no post:** no back springs, no `quote` alert is written, and the post is not a reply to the quoted post
  (no `target_act_id`). The quoted post's author gets the `framed` alert ("Someone put words in {name}'s mouth"), as a
  counterfeit's named character does.
- **No-quote does not refuse it**, as it never refused a counterfeit; it refuses an authentic quote as before.
- **The conduct layer does not empty it.** It was checked against public versions only, so its words are the poster's
  own, and an admin judges them as the poster's.

Weighed: changing only the look (the quote still springs backs and alerts, and its words stay out of reach of the word
cards, so the Autocorrect gap stays); a third, "doctored" kind with a look of its own and a working post link (one more
thing to learn and to build, and a link that blurs the screen-reader cue).

## 2. What counts as being in the post

**Decided:** exact, spacing loose.

- **The quote's text** is what a reader sees inside it, markup aside: its words, the words of quotes nested in it, code,
  `[noparse]`, a link's words, a bare address, list items, and a spoiler's title and body. An image, a video, a rule and
  a cut have no words. The text is put in Unicode NFC, every run of whitespace becomes one space, and the ends are
  trimmed. One `...` (three or more full stops) or `…` at the very start or end is removed with the space beside it.
  A run of more than eight of one character is read as eight (section 12): "nooooooooooo" and "noooooooo" are the
  same, which changes no meaning and takes away the hostile input that makes a string search slow.
- **A version's text** is the same walk over the version's whole body.
- **Authentic** when the quote's text is empty, or stands whole, case and punctuation as written, in the text of an
  eligible version (section 3).
- **An ellipsis in the middle is not special.** That is how a quote is spliced ("I do not ... like Mario"). An excerpt
  of two parts is two quotes.
- **A quote holding a cut** (real quotes nested past the parser's cap of 16, drawn as a note): its text is split at each
  cut, and the pieces must stand in one version in that order, each after the last. Otherwise an honest whole-post quote
  at the foot of a deep pyramid would turn shaky, since it is cut one level sooner than the post it copies.

The words of a quote nested in the quoted post count as that post's text, so a highlight that runs through one still
matches, and a whole-post quote carrying it matches too. A highlight that runs across a *shut* spoiler leaves the
spoiler's words out of the middle and will not match; that is accepted.

Weighed: the phrase matcher of Says and Autocorrect (one matching rule to learn, but "!" could become "?" and "I didn't"
"i didnt?" under an authentic head); the BBCode source as a substring (every highlight of formatted words would shake).

## 3. Which versions

**Decided:** any version of the quoted post written before the save that no admin has hidden at the save: the post
itself and each of its edits. "Quoted for posterity" works: quote a post before its author edits it and the quote stays
authentic; quote an older version from its History and it is authentic. A quote of a quote, copied whole, still matches
after the post it quotes is edited.

**The verdict is worked out once**, when the quoting post, spin or edit is written, and never again ("Append-only").
A later edit of the quoted post, a hide or an unhide changes nothing already written. An edit of the quoting post is a
new Act with its own verdict.

A quoted id that is no Act, or an Act with no text body, has no version: the quote is forged.

Weighed: the current version only (the issue's words; an honest quote turns shaky when the author edits between the
reading and the posting); a live verdict at each read (an author could make every quote of a post look forged by
editing it, a gaslighting weapon, but the verdict would no longer be fixed at the save and History would contradict it).

## 4. Words the author never wrote

**Decided:** only words the author wrote count. Autocorrect's tape is a layer over the words, so a highlight that
carries the tape ("I love Wario" where the author wrote "Mario") is a counterfeit, and its words are the quoter's own.
Highlight-to-quote is unchanged; the joke reads as what it is, words someone else put there. No engine interface asks an
instance for a post's shown text.

Weighed: the tape counting (an interface for each instance's word-changing cards, and an authentic head over words the
author never wrote); highlight copying the words under the tape (it would reverse the quote-conditions rule that a quote
holds only words the reader saw).

## 5. One verdict per quoted post

**Decided:** the verdict is the list of quoted posts that have a doctored quote in the Act. If any quote of post #38 in a
post is doctored, every quote of #38 in that post is a counterfeit: one forgery taints the poster's other quotes of that
post.

Keyed by the post's id, the verdict holds through the conduct layer, which empties a hidden post's quotes and the quotes
inside them (a count of quotes would shift), and the SQL and the TypeScript need agree only on which posts a body
quotes, which the shared fixtures already hold. Weighed: each quote alone, keyed by its place (fairer to an honest quote
beside a forged one, but the conceal job would have to carry the keys through its layer, and the two parsers would have
to count quotes alike in every case).

## 6. Where the verdict lives

- **On the Act, as written.** A trigger before an Act of kind post, spin or edit is inserted works out the verdict and
  writes it into the payload as `forged`: the quoted posts with a doctored quote, sorted, each once, and absent when
  there are none. It replaces whatever a writer put there. Nothing ever updates it. A post's current verdict is its
  current payload's, the latest edit's over the original's, as its body is.
- **The target.** When a post's `target_act_id` names a forged post, the same trigger writes the post with no target, so
  `post()` and `write_staff_act` spring no back and write no `quote` alert (each reads the target from the row it wrote).
  `write_staff_act` already writes a pool post with no target where No-quote stands (0316).
- **No-quote** (`acts_quote_guard`) leaves out the forged posts; the verdict's trigger fires first.
- **The conduct layer:** `hidden_refs` leaves out the Act's forged posts, so the conceal job is never asked to empty a
  forged quote.
- **The `framed` alert:** `post`, `start_thread` and `spin` write one for the author of each forged post that is a debuted
  character, with the composer's `framing` ids, at most 5 in all, through `write_alert` as today (it skips staff and the
  acting account's own masks). An edit writes none, as it writes no `quote` or `framed` alert today; a Mod Bot's pool
  post writes none, as it writes no `framed` alert today.
- **A version's text is stored once** when the version is written: a `quote_sources` row (the Act, the walked text, and
  its hash), insert-only, so a check is string searches, never a walk of every version.
- **Restores and the export.** The trigger is an ordinary one, so a restore with triggers off keeps the verdict written
  at the save; the export round-trips it with the payload, and `quote_sources` with the Acts.
- **Acts written before this change** have no `forged` and read as they do today. No instance is deployed, so no verdict
  is backfilled (that would be an update of an Act's content). `quote_sources` is backfilled for the versions already
  written, since a source is a row of its own and not the Act's content, so a quote of an old post is checked like any.

## 7. Every reader treats a forged quote as a counterfeit

- **TypeScript:** `parse` takes the forged list and makes each `[quote=<forged id>]` a `counterfeit` node that also
  carries the Act it falsely names (`act`), so render, `visibleText`, `excerptText`, `quotedActs`, the layers and every
  card that reads a post's words agree from one place. Every screen that draws a post's words passes its payload's
  `forged`, a version in History its own.
- **SQL:** `bbcode_walk` and `bbcode_plain` take the same list, and every reader of an Act's words (search, Says, the
  passage check, `spring_facts`, the excerpt, `own_words`, `rule_breaks`) passes the Act's `forged`. The shared fixtures
  hold the two languages to one answer.
- **The head:** a counterfeit with an `act` draws that post's author as `acts_public` shows them, never a link; with no
  such post, "Someone".

## 8. The composer says so first

**Decided:** the preview shows it. When the draft stops changing for a moment and holds a real quote, the composer asks
`quote_check(body)`, which runs the save's check and returns the forged list. The preview draws those quotes as
counterfeits, and a plain line under the box says: "A quote here isn't in the post it names, so it will show as a
counterfeit." (engine copy, out of character; the owner approves the words in review). The line is a polite live region
and goes when no quote is forged. Posting is never refused. Weighed: finding out after posting; the line with no shaky
preview.

## 9. The screens

Board world (`docs/plans/2026-10-29-two-worlds-design.md`), in the house style: nothing new is drawn. A doctored quote
uses the counterfeit's look and head as they stand, and the preview line uses the composer's existing notice style (the
cut notice's).

## 10. The layers

All engine: the check, the verdict, the parser's option, the head, the preview and its words. Divided World adds
nothing; Autocorrect needs no change, because a forged quote's words simply join the visible text it already reads. The
`framed` line is engine copy, as it is today.

## 11. The masks

- **The verdict and `quote_check` read only public facts:** versions that are not hidden at that moment, which every
  reader can see in History. A hidden version is never compared, so a guess at a hidden post's words always comes back
  forged and proves nothing. The answer is the same whoever asks, the hidden post's own author included.
- **Timing** grows with the quote's length and the public versions' lengths, never with who owns anything.
- **Ownership is never read.** The head shows the quoted post's projected author (the stand-in under a veil). The
  `framed` alert goes where the `quote` alert would have gone, through `write_alert`, which skips the acting account's own
  masks the same way for every caller, and its result is not in the answer.

## 12. Cost at a busy instance

Per save: one walk of the quoting body (already made for the guard), then for each quoted post its eligible versions'
stored texts, newest first, each distinct text once, stopping at the first that holds the quote. Work grows with the
post's length and the quoted posts' public versions, never with players, characters or threads. A version's text is
walked once, when it is written.

A hostile pair is the risk: Postgres's `strpos` measured 30 to 90 ms for a 20,000-character run of one letter searched
for a 5,000 to 10,000-character near-miss (one version). A player who edits their own post into many such versions and
quotes it could make their own save slow. Reading a long run of one character as eight (section 2) takes that shape
away; the plan holds a budget in a scale test over it and over periodic shapes ("abab…"), and a shape that still
misses the budget goes back to the owner before any other search is chosen. `quote_check` is bounded the same way and
by `postMaxLength`.

## 13. Ways out

No new state. A counterfeit is the post's own words; its author edits the post to quote honestly, and the edit has its
own verdict. Nothing waits on a job.

## Open

- **A highlight across a shut spoiler** comes out forged (section 2). If players meet it, highlight-to-quote could
  refuse such a selection or open the spoiler's words into it.
- **Knockoff avatars** (#299) would draw a doctored quote's head too.
- **An unhide never re-judges a quote** written while the version was hidden. That is accepted ("Append-only").
