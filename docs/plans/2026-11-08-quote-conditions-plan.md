# Quote conditions: plan

Record, written 2026-11-08. The plan for `docs/plans/2026-11-08-quote-conditions-design.md`. One build session builds it
in one PR from `main`, after the design's PR is merged.

Every task is test first: name the test, record its red run, then write the code. The checks this plan changes
(Tasks 1 and 2 extend two existing generated-SQL pairs) are driven red again on a poisoned input of the new kind.

**Migrations.** One migration, `NNNN_quote_conditions.sql`, taking the next free number in `supabase/migrations/` (0144
as this is written), written section by section, one task at a time, as 0142 was. Its SQL tests take the next free
numbers in `supabase/tests/` (0142 on). Each function it replaces is copied from its latest definition, found with
`grep -l "function <name>\|view <name>" supabase/migrations/*.sql` before copying. As this is written those are
`phrase_fold`, `phrase_in`, `phrase_pattern`, `phrase_probe`, `place_set`, `set_card`, `my_face_down`, `spring_facts`
(and its type), `spring_traps` and the `acts_spring_payload` constraint (all 0142), and `bbcode_plain` (0118).
Everything a copied function does that this plan does not name stays as written, the lock order included (0075's
header, steps 1 to 6). A task that finds a function taking a later lock before an earlier one stops and asks before
widening the change.

**The layers.** Everything here is the engine's. Divided World gives only its alert voice (`UiCopy`) and the Strategy
Guide's words, and Autocorrect keeps `setPhrase`. The boundary check holds.

## The words this plan uses

- A **condition** narrows a face-down Move's quote trigger: **Says** (a phrase in the quoting post's own words),
  **Quotes** (a passage in the quoted excerpt) and **Who** (Anyone, Only these, Anyone but these).
- The **excerpt** is the visible text of each real quote of the trapped post at the quoting post's own level, joined
  with line breaks (design section 3).

## Task 1. One looser matcher, in two languages (engine, instance, SQL, tools)

Model: sonnet

**Files:** `engine/bbcode/phrase.ts`, `phrase.fixtures.ts`, `phrase.test.ts`;
`instances/divided-world/cards/autocorrect.ts`, `autocorrect/match.ts`, `autocorrect/peel.ts` and their tests; the
migration (`phrase_norm`, and `phrase_in`, `phrase_pattern`, `phrase_probe` redefined); the regenerated
`supabase/tests/0136-phrase.sql` (`node tools/phrase-sql.mjs`).

- `normalize(text)` in `phrase.ts`, applied to the text and the phrase after case folding, per design section 2: a run
  of characters that are not letters, digits or whitespace with a letter or digit on each side is removed; every other
  run of non-letters-or-digits becomes one `\n` if it holds a line break, else one space. `occurrences` matches the
  normalized phrase, whole words as today, in the normalized text, and maps each hit back to the original text's
  offsets (first letter or digit to last), so Autocorrect's strips and the renderer's layers still take original
  offsets. `sameWords` compares normalized forms.
- SQL: `phrase_norm(t)` does the same with two `regexp_replace` passes over `phrase_word_class()`; `phrase_in` and
  `phrase_probe` normalize both sides. `phrase_pattern` builds from the normalized phrase. A normalized phrase is never
  longer than the phrase, so the 400-character padding still makes every back's pattern one length (state this in
  the header).
- New fixtures: "don't" for "dont" and the reverse, "e-mail", "U.S.A.", "Nice... try!" for "nice try", "nice-try" (no
  match for "nice try"), "don" in "don't" (no match), a phrase across a line break (no match), across a quote's
  separator (no match), punctuation at a phrase's ends ("wow!"), and a phrase that normalizes to nothing.

**Tests first:** `phrase.test.ts` over the new fixtures; Autocorrect's strip offsets on "don't" for "dont"; the
regenerated SQL test. **Red:** today's matcher misses "don't" for "dont". Drive `check-phrase-sql.mjs` red once on a
hand-edited line of the regenerated file.

## Task 2. The excerpt, in the same walk (engine, SQL, tools)

Model: sonnet

**Files:** `engine/bbcode/visible.ts` and `visible.test.ts`; `engine/bbcode/plain.fixtures.ts`, `plain.test.ts`;
`tools/bbcode-plain.mjs`, `tools/check-bbcode-plain.mjs`, `tools/test-bbcode-plain.mjs`; the regenerated
`supabase/tests/0117-bbcode-plain.sql`; the migration (`bbcode_walk`, and `bbcode_plain` as its wrapper).

- `excerptText(nodes, act)` in `visible.ts`: the `visibleText` of the children of every `quote` node whose `act` is
  `act` and that no other real quote encloses, joined with `SEPARATOR`. Written as `visibleWalk` is, with its own
  stack.
- SQL: `bbcode_walk(body text, quoted uuid) returns table(plain text, excerpt text)` is 0118's `bbcode_plain` with one
  frame kind added: a real quote whose head names `quoted`, with no real quote below it on the stack, is a `keep`
  frame. In the plain output it is cut back to one separator as today; its words are also appended to a second output
  (with a separator before each kept quote after the first), with nested real quotes and links cut back there as they
  are in the plain output.
  `bbcode_plain(body)` becomes `(bbcode_walk(body, null)).plain`, so the one parser serves both ("Two lists that must
  agree are one list"). Its grants follow `bbcode_plain`'s.
- Each fixture in `plain.fixtures.ts` may name an `excerptOf` (an Act id) and an `excerpt`. `plain.test.ts` holds
  `excerptText(parse(body), excerptOf)` to it, and `tools/bbcode-plain.mjs` asserts `bbcode_walk(body, excerptOf)`'s
  excerpt the same way. New fixtures: one quote of the act; two; a quote of another act (empty); the act's quote
  nested in another's (empty); another's quote nested in the act's (cut out); a counterfeit quote naming the id
  (empty: a counterfeit is the post's own words); an unclosed quote; formatting, a link and code inside the excerpt.

**Tests first:** the fixtures in both languages; `bbcode_plain` still passes every existing fixture and the scale test
(`supabase/tests/0118-bbcode-plain-scale.sql`). **Red:** `excerptText` and `bbcode_walk` do not exist. Drive
`check-bbcode-plain.mjs` red once on a poisoned excerpt line.

## Task 3. The rules: conditions on a Set (engine, the act function)

Model: sonnet

**Files:** `engine/rules/cards.ts` and `cards.test.ts`; `engine/rules/actions.ts` and its tests;
`supabase/functions/act/core.ts` and its tests.

- `SetConditions = { says?: string; passage?: string; who?: { except: boolean; characters: readonly string[] } }`.
  `decideSet(rules, settings, target, effects, config, cards, conditions = {}, now)` returns `phrase`, `passage` and
  `who` beside today's fields.
- Refusals, in plain words: conditions on a Gimmick ("<card> takes no conditions"); a Says on a card with `setPhrase`
  ("<card> already waits for its own phrase"; its `phrase` is still `setPhrase`'s); a Says or a passage that is blank,
  has no letter or digit, or is longer than `SET_PHRASE_MOST`; a passage not in `target.text` by `phraseIn` ("that
  passage is not in this post's words"); a Who with no characters, more than five, or one twice. No refusal reads who
  owns a character: whether a named character is on the board is SQL's (Task 4).
- `setArgs` reads an optional `when` object from the request into `conditions`. `core.ts` passes `phrase`, `passage`,
  `who` (the ids) and `who_except` to `set_card`.

**Tests first:** each refusal above; a Move with all three conditions; Autocorrect's phrase is its Says; naming one's
own acting character is accepted. **Red:** `decideSet` takes no conditions.

## Task 4. The schema and setting (SQL)

Model: sonnet

**Files:** the migration (`face_down` columns, `place_set`, `set_card`, `my_face_down`); a new
`supabase/tests/NNNN-quote-conditions.sql`; `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`, `engine/ui/cards/plays.ts`
(the setter's face-down row gains the fields); `tools/check-web-reads.mjs`'s list if it names `my_face_down`'s columns.

- `face_down` gains `passage text`, `who uuid[]` and `who_except boolean`. Checks: `passage` is null or not blank; `who`
  and `who_except` are both null or both set; `who` holds 1 to 5 distinct ids; `catches` excludes every condition
  (`face_down_one_of` widened). No row is updated (the append-only triggers stay).
- `place_set` and `set_card` take `passage`, `who` and `who_except` (default null). `place_set` refuses a condition on
  a Gimmick; a passage not `phrase_in(bbcode_plain(<the post's current body>), passage)`; and any `who` id that is not a
  debuted character, with one message for a missing and an undebuted one ("<n> is not a character on the board"); a
  retired character is accepted (design section 4). It reads `characters` as `suggest_characters` does, never
  `characters.owner`.
- `my_face_down` returns `passage`, `who` and `who_except` last.

**Tests first:** a back stored with each condition; each refusal; the one message for a missing and an undebuted
character; a retired character is accepted; naming one's own other mask is accepted. **Red:** the columns do not exist.

## Task 5. Springing on the conditions (SQL)

Model: sonnet

**Files:** the migration (`spring_facts` and its type, `spring_traps`, `acts_spring_payload`);
`supabase/tests/0135-face-down-moves.sql` (or a new test beside it that counts reads as it does).

- `spring_facts` replaces `bbcode_plain(f.by_body)` with one `bbcode_walk(f.by_body, fd.post)` and probes both outputs
  for every back: `phrase_hit` from `phrase_probe(plain, fd.phrase, fd.play::text)`, `passage_hit` from
  `phrase_probe(excerpt, fd.passage, fd.play::text || 'p')`, and `who_hit` from `f.by_character = any(coalesce(fd.who,
  '{}'))`. These run whatever the back holds.
- `spring_traps`: a quote springs a Move only when `(fd.phrase is null or phrase_hit) and (fd.passage is null or
  passage_hit) and (fd.who is null or who_hit <> fd.who_except)`. Everything else stays as 0142 wrote it, landing
  included.
- The spring's payload gains `when` (`{says?, passage?}`, the conditions the back held) and `for` (the quoting
  character, only where `who_except` is false). `acts_spring_payload` accepts both keys as optional, so springs written
  before this still pass.

**Tests first:** a spring and a non-spring for each condition and for their combinations; Anyone but never writes
`for`; an old back with no conditions springs on any quote. The even-work count: a back with each condition absent,
present and met, a Bluff, and a Move that cannot land make the same reads. **Red:** a Says-conditioned back springs on a
quote without the phrase.

## Task 6. The words: log, Lens, alerts (engine, instance)

Model: sonnet

**Files:** `engine/ui/log/lines.ts` and its tests; `engine/ui/cards/lens-words.ts` and `lens-words.test.ts`;
`engine/ui/alerts/words.ts`, `trap-reads.ts` and their tests; `engine/ui/types.ts` (`UiCopy`, if a slot is added);
`instances/divided-world/ui/trap-words.ts`.

- One helper, `shortQuote(text, most = 40)`: the text in quotation marks, cut at the last word boundary within `most`
  characters, with "…" when cut.
- The setter's `set` line names every condition in full ("to spring when Spritey or Boshi quotes 'the punchline'
  saying 'nice try'"; "when anyone but Boshi quotes it"). A sprung line, the struck player's alert and the toast name
  the matched conditions from the spring's `when` and `for`, shortened. The Lens says them in full: "Set face down by
  Pipewrench on 5 November for Spritey; sprang when Spritey quoted 'the punchline' saying 'nice try'".
- The instance's voice may gloat about a condition that matched, and never bluffs.

**Tests first:** each line for each condition and their combinations; a 100-character passage is shortened in the
alert and whole in the Lens; Anyone but's list appears only in the setter's own log. **Red:** the lines name no
condition.

## Task 7. The set form's conditions (engine, the glass)

Model: sonnet

**Files:** `engine/ui/cards/PlayForm.tsx`, its CSS and tests; a new `engine/ui/cards/SetConditions.tsx`; the board search's
character box, reused as it is: `GlassCombobox` (`engine/ui/glass/GlassCombobox.tsx`) over `charactersSource`
(`engine/ui/search/suggest.ts`), as `engine/ui/composer/QuoteSomeone.tsx` and `engine/ui/characters/RevealOverlay.tsx`
use them. No new character query is added.

- Under the set summary, an optional **Only when** group: "they say…" (text, at most 100 characters, locked and filled
  for a card with `setPhrase`); "they quote…" (text, plus a read-only view of the post's visible text in which a
  selection fills the field); "Who" (a radio trio, Anyone, Only these, Anyone but these; for the two lists, the character box,
  each choice added as a removable chip, up to five, a character already chosen not added twice). The summary line reads the conditions back in plain words, as Task 6's `set` line does.
- The request sends `when` only with the conditions set. Refusals show beside the field they belong to.
- Every control has a visible label and works by keyboard. The passage field can always be typed.

**Tests first:** the group shows only for a Move being set; Autocorrect's Says is locked; selecting in the post view
fills the passage; a sixth character cannot be added; the request carries `when`. **Red:** the form has no group.

**Before building,** run impeccable's `shape` step with the owner on the group, briefed on the glass's look
(`docs/plans/2026-10-29-two-worlds-design.md`, section 4, and `docs/research/2026-10-29-two-worlds/05-cards.html`), and
write the confirmed brief into the PR.

## Task 8. Highlight-to-quote (engine, the board)

Model: sonnet

**Files:** `engine/ui/thread/Thread.tsx` and its tests; a new `engine/ui/thread/SelectionQuote.tsx`;
`engine/ui/composer/text.ts` (`quoteText`) and `text.test.tsx`; the thread's board CSS.

- While the document's selection lies inside one post's rendered body, a **Quote** button (board style: plain, black
  and white, Verdana) shows beside its end. Pressing it calls the composer's `quote(act, selection text)` and clears
  the selection. A selection that crosses posts, or lies outside a body, shows nothing. The button is a real `button`
  with a label ("Quote the selected text"), and Esc dismisses it.
- `quoteText` keeps a selection's text as typed: text that would parse as a tag is wrapped in `[noparse]`, so the
  quote holds no markup it did not show.
- The whole-post Quote button stays as it is, and quoting it and trimming in the reply box remains the keyboard path.

**Tests first:** a selection in one post offers the button and quotes only the selection; a cross-post selection
offers none; a selection holding "[b]" quotes it as text. **Red:** no button appears on a selection.

## Task 9. The glass's words: the Strategy Guide (instance)

Model: sonnet

**Files:** `instances/divided-world/guide/strategy-guide.md`; `instances/divided-world/ui/cards.ts` if a card's set
copy names the trigger.

The guide's face-down section explains the three conditions, the looser phrase matching that Says and Autocorrect
share, and highlight-to-quote, in the developer persona's voice, truthfully. The owner approves it in review.

**Tests first:** none beyond the build's document checks (the paths named exist).

## Task 10. The export round-trips the new columns (e2e)

Model: haiku

**Files:** `supabase/tests/e2e/0003-export.ts`.

Seed, beside the Autocorrect back already there, a Move set with a passage and an Anyone but list, and a spring
carrying `when` and `for`; the round trip holds each.

**Tests first:** the round trip with the new rows. **Red:** before Task 4 the columns do not exist; after it, the test
fails until the seed is added.

## Last. The full build, the pictures and the final review

`npm run typecheck` and `npm run build:ci` green; screenshots of the set form with each condition, Autocorrect's locked
Says, highlight-to-quote's button on a post, and the Lens of a conditioned spring, attached to the PR. The final
reviewer reads the Review focus below.

## Ways out of the states this touches

- A conditioned back: springs once, or ends by itself at `setLasts`. One whose conditions can no longer be met waits
  for its time.
- No other state is added. Highlight-to-quote's button goes on Esc, a click elsewhere or a quote.

## The masks

- A back's conditions are read only by the setter's account (`face_down`'s own policy, `my_face_down`). The Set Act,
  its Realtime event, `card_target` and the thread page carry none of them.
- Setting never reads who owns a character. Characters are picked through `suggest_characters`, which returns
  nothing computed from ownership, and a named id is refused only for not being a debuted character, with one message
  for both ways of not being one.
- Every quote that meets a back makes the same walk, both probes and the Who check, whatever the back holds (Task 5).
- A spring names the matched Says and passage, and the quoter only for Only these. An Anyone but list is never in an Act.

## Review focus

- **Even work.** The walk and both probes run for every back, with a pattern of one length each, so a back's
  conditions never change how long a quote takes (Task 5's count, and the pattern lengths of Task 1).
- **The one parser.** `bbcode_plain` is now a wrapper over `bbcode_walk`. Every old fixture and the scale test still
  pass, and the search index's words do not change (Task 2).
- **Autocorrect under the new matcher.** Plays already laid redraw with it; strips map to original offsets, and a
  replacement equal to its phrase is still refused under normalization (Task 1).
- **Normalization in two languages** agrees on punctuation from other scripts (CJK and Arabic punctuation, the
  ideographic space) as well as ASCII. The fixtures should reach them.
- **Highlight-to-quote** never quotes words the post did not show (a spoiler's hidden text, an image's alt text, a
  Lens overlay) and never produces live markup.
- **Old springs and backs:** a spring without `when` still passes the payload check; a back from before this springs
  on any quote.
