Record, written 2026-11-18.

# A real quote holds words its post had: design

A design session with the owner, the third of three that came out of a scrub of the open issues for defects that
break a sum or treat a player unfairly. It answers #403: any words typed inside `[quote=<a post's id>]` are drawn as
that post's words. It builds on the counterfeit quote of `docs/plans/2026-11-07-bbcode-tags-design.md` (section 1),
the excerpt and matcher of `docs/plans/2026-11-08-quote-conditions-design.md` (sections 2 and 3) and the cut of
`docs/plans/2026-11-13-quote-cut-plan.md`. Its plan is `docs/plans/2026-11-18-quote-truth-plan.md`.

## 1. What happens today

A quote is real because its opener names an Act's UUID (`engine/bbcode/parse.ts`), and for no other reason. Nothing
on the server reads the words inside it. The session's inventory found that this is more than a look:

- **The forgery.** A player types anything inside a real quote of a post, and it is drawn with the author's avatar,
  linked name and "Post #N" link.
- **A trap sprung by a made-up target.** `post` (`supabase/migrations/0142_face_down_moves.sql`) takes the post a
  reply quotes from the client's `quoting` argument and springs `spring_traps('quote', quoting, …)` on it, without
  checking that the body quotes that post at all.
- **"Quotes this passage" sprung by invented words.** `spring_facts` (`0374_cards_on_a_spun_thread.sql`) tests the
  passage against the excerpt, which is whatever was typed inside the quote.
- **Words hidden from judging.** `rule_breaks` and `own_words` (`0340_conduct.sql`) and the Says condition cut real
  quotes out as not the author's words, so text typed inside a forged real quote is read by no rule check, no Says
  trap and no model.

## 2. The rule

**Decided.** A quote that names a post is real only when its words are one unbroken passage of that post. Anything
else is saved as a counterfeit.

- **The match.** The owner chose one unbroken passage over passages with marked cuts ("I do … like this" from "I do
  not like this" is the classic misquote) and over every word being somewhere in the post (a long post lets nearly
  any sentence be assembled). Differences of spacing, punctuation, case and formatting are ignored, as the phrase
  matcher of quote conditions ignores them. To quote two parts of a post, a player writes two quote blocks.
- **Which words.** The owner chose any version the post ever had, over the post as it stands when the quoting post
  is saved. A quote taken before its author edited the line out stays real when the quoter later fixes a typo in
  their own post, and an author cannot turn every later quote of a line into a fake by editing it. A real quote is a
  receipt. Every version is already an Act (the post and each of its edits).
- **Only versions the quoter can read.** A version an admin hid, or a post conduct has hidden, is not matched.
  Otherwise a player could guess at hidden words and learn from whether the quote was saved as real.
- **Each quote block on its own, at every depth.** The words checked are the quote's own-level visible words: a
  real quote or a link nested in it counts as one separator, as it does in the quoted post's plain text
  (`bbcode_walk`, `0350_quote_cut.sql`). So a whole-post quote of a post that itself quotes someone passes, and the
  nested quote is checked against its own post.
- **An empty quote stays real.** It claims no words. So does a quote the parser cut for depth: it shows none.
- **A quote naming an id that is not a readable post or spin** is a counterfeit with no one named.
- **The tape's words.** Highlighting a post under Autocorrect copies the tape's replacement words, which the post
  never had. The owner chose that a quote of them is a counterfeit, over counting a card's words as the post's while
  they show: they are the card's words, and the joke lands on whoever quotes the tape. What the Quote button reaches
  under the tape stays with #424.

## 3. What a failed quote becomes

**Decided:** it is rewritten as the post is saved, over refusing the post (a forgery would take typing the
counterfeit form by hand, and a Mod Bot's misquote would fail its post) and over keeping the body as typed with a
mark (about a dozen readers of quotes would each have to learn the mark, and one that forgot would treat a forgery
as real).

- **The form.** The opener `[quote=<post id>]` becomes `[quote user=<character id>]`, the existing counterfeit of a
  character: the wobble, the name as plain text, no link. Any `user=` the player typed on a real quote is dropped,
  as it is ignored today. Only the opener changes; the words are the player's and are never touched.
- **Whom it names.** The post's author as the post shows it (`shown_author`). Under a Whodunnit? veil that is the
  stand-in, so the rewrite never carries the hidden author. Where no one is shown, the opener is a bare `[quote]`.
- **The alert.** The named character gets the `framed` alert, as for a counterfeit typed by hand. An edit sends
  none, which is the standing rule for counterfeits in edits.
- **Before it is saved.** The composer's preview runs the same check and draws the quote as it will be saved. An
  honest player who trimmed badly sees the wobble; a forger knows what they are posting. After saving, the edit box
  shows the rewritten opener.
- **Everything downstream follows** with no change of its own: the renderer, the excerpt, the No quote guard, the
  conceal layers and the judging reads all see a counterfeit, whose words are the poster's.
- **A Mod Bot that misquotes** posts a counterfeit, as a player would. The owner confirmed this over dropping the
  quote from its post.

**"The System acts; it never destroys what a player wrote."** The rewrite changes a tag, at the moment of writing,
before the Act exists. No Act is edited and no word is lost.

## 4. The quote a reply is about

`post` stops taking the client's word for `quoting`. The post a reply is about (its `target_act_id`, which the quote
alert and the quote spring read) is the first top-level real quote left in the body after the check, or none. A
hand-made request can no longer spring a trap on a post it does not truly quote.

A Mod Bot's post keeps the target the chatter function gives it (`write_staff_act`): there it means the post the
Mod is answering, quoted or not.

## 5. Two things the check needs

- **Highlight-to-quote skips a nested quote's words** (`engine/ui/thread/SelectionQuote.tsx`, `shownWords`). Today
  a selection across an inner quote copies its words in flat; they are not the post's own-level words, and the quote
  would fail.
- **A matcher for long text.** `phrase_in` compiles its phrase into a pattern and is sized and scale-tested for 100
  characters (`SET_PHRASE_MOST`); a quote can be a whole post. The check uses a matcher of its own, `passage_in`:
  both sides through `phrase_norm` and the fold, breaks as spaces, then a plain substring search held to whole
  words. Its SQL and TypeScript are generated from and checked against one fixtures file, as the phrase matcher's
  are.

## 6. The layers, the masks, ways out, scale

- **The layers.** All of it is the engine's. No instance content is named.
- **The masks.** The check reads the quoted post's public versions and its shown author. It never reads who owns a
  character. A veiled author is never written into a body. A hidden version is not matched, so the outcome proves
  nothing about words a reader cannot see. The work done depends on the body sent and the public history of the
  posts it names.
- **Ways out.** No state is added. A poster who did not mean to forge edits the post: an edit is checked the same
  way and a corrected quote, written again with the post's id, is real.
- **A busy instance.** The check is one walk of the body, and for each post quoted, one read of its versions. Its
  cost grows with the quotes in one post and the edits of the posts they name. The plan measures the worst body and
  sets a bound on the versions read if it needs one; that bound is the one thing this design leaves to the build.

## 7. What is open, and what was accepted

- **Posts already saved are not re-checked.** An Act is never edited, so a forged quote an instance already holds
  stays drawn as real. The owner accepted this on 2026-11-18: there are no players.
- **#424** (what copy, find and the Quote button reach under Autocorrect's tape) is untouched.
- **#299** (knockoff avatars for counterfeits) would now also dress these.
