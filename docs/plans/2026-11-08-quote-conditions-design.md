# Quote conditions: aiming a face-down Move

Record, written 2026-11-08. The design session on a face-down Move's trigger, made with the owner. It builds on
`docs/plans/2026-11-07-face-down-moves-design.md`, whose section 2 left the set form with no trigger picker, and on its
section 6, which gave Autocorrect a phrase its landing needs. The owner's ask: "A catch-all quote trigger is a bit of a
loose cannon, nice to have some precision."

## 1. What a condition is

**Decided:** a face-down Move still springs on a quote, and only on a quote. When setting it, the setter may add
**conditions**, and the Move springs only on a quote that meets all of them. A condition narrows the one trigger. It is
never a trigger of its own, so a quote still meets exactly one back, the quoted post's, and nothing scans a thread's
backs ("Says", the open trigger, keeps its own cost question).

Three conditions, each optional:

- **Says:** the quoting post's own words contain a phrase the setter types (section 2).
- **Quotes:** what the quote holds of the trapped post contains a passage the setter picks from that post (section 3).
- **Who:** Anyone (the default), **Only these**, or **Anyone but these**, with one to five characters (section 4).

A Move set with no condition springs on any quote, as today. The catch-all stays the default, and it remains the
gamble.

- **No change to price or lifetime** (the owner chose the recommendation). A condition makes a back less likely to
  spring before `setLasts`, and that lower chance is its price. Any tuning is left to the season review. Weighed: a
  longer `setLasts` for a conditioned back; a price in Aura per condition.
- **A Gimmick takes no conditions.** Trap Card already names its card, and Hall Pass waits for a visit.

## 2. Says, and one matcher for every phrase

**Decided:** Says matches as Autocorrect does today, a little more loosely, and **Autocorrect moves to the same
looser matcher**, so a player learns one way phrases match (the owner: "so people only have to get used to one set of
matching logic either way"). Weighed: Autocorrect's matcher unchanged; true fuzzy matching. Edit distance has to agree in
SQL and TypeScript, its running time depends on the text (which works against the rule that every back costs the same
to check), and a near-miss is hard to explain truthfully in the log.

The matcher (`engine/bbcode/phrase.ts`, mirrored by `phrase_in` and `phrase_probe` in SQL) reads both the text and the
phrase through one normalization, then matches whole words in any case as today:

1. **Case** folds as today (JavaScript's `i` with `u`; the SQL fold already agrees).
2. **Punctuation inside a word is ignored.** A run of characters that are neither letters, digits nor whitespace,
   with a letter or digit on each side, is removed: "don't" is "dont", "e-mail" is "email", "U.S.A." is "USA".
3. **Between words, any spaces and punctuation are alike.** Every other run of characters that are not letters or
   digits becomes one space, unless it holds a line break, in which case it becomes one line break. A phrase is one
   line, so it never matches across a line break. That keeps today's rule that no phrase joins words across a quote,
   code, a link or an image, since each leaves a line break in the visible text.

So "nice try" matches "Nice... try!", and "dont" matches "Don't". What it gives up: "don" no longer matches inside
"don't", and "nice try" does not match "nice-try" (that reads as one word, "nicetry"). An Autocorrect strip's span is
the run of original text the match covers, from its first letter to its last, so the renderer's layers are unchanged.

A Move whose card has its own phrase (`CardRules.setPhrase`, Autocorrect's) has its Says **fixed to that phrase**. Its
form shows the condition already filled and locked, and a set that names another Says is refused. One back holds one
phrase.

## 3. Quotes this passage, and highlight-to-quote

**Decided** (the owner chose the recommendation): the condition is that the **quoted excerpt** (the words inside
`[quote=<the trapped post>]` in the quoting post) contains the passage. Because the Quote button pastes the whole post
today, that condition alone would almost always hold, so this design adds **highlight-to-quote**, deferred until now by
the core loop design (`docs/plans/2026-10-28-core-loop-design.md`). Weighed: the excerpt containing the passage with no
new way to quote (a catch-all on short posts); the passage being most of the excerpt (a threshold players must learn).

- **The excerpt** is the visible text of each real quote of the trapped post at the quoting post's own level, joined
  with line breaks. A quote of the trapped post inside a quote of another post is that other post's words and does not
  count. The matcher is section 2's, so a passage tolerates the spacing and punctuation a selection loses.
- **The passage** is picked when setting: typed, or selected in the form's view of the post. It is at most 100
  characters (`SET_PHRASE_MOST`, the same bound as a phrase, which keeps the SQL probe's pattern one length for every
  back), has at least one letter or digit, and must be in the trapped post's own visible words when it is set ("that
  passage is not in this post's words"). The post is the setter's own and public, so that refusal reads nothing
  private. If the setter later edits the passage out of the post, the back waits until `setLasts` like any back
  nothing meets.
- **Highlight-to-quote** is in the board world (`docs/plans/2026-10-29-two-worlds-design.md`), in the house style.
  Selecting text inside one post's body shows a small **Quote** button beside the selection. Pressing it quotes the
  selection's text into the reply box as `[quote=<post>]…[/quote]`, as plain text with no formatting, as the forums the
  house style recalls did. A selection that crosses posts offers no button. Text that would read as a tag is kept as
  typed, so a quote never turns into markup it did not hold.
- **The keyboard path** is the one that exists today: quote the whole post, then trim it in the reply box. It ends in
  the same quote at the same cost ("An accessible path costs what the obstacle costs"; here it is the forum, so the path
  only needs to exist).

## 4. Who

**Decided** (the owner chose the recommendation): one control, **Anyone / Only these / Anyone but these**, with a list
of one to five characters for the last two. Weighed: one character only; independent From and Not from fields, which
allow contradictions.

- **Any public character may be named**, a Mod Bot's included, and so may the setter's own other masks and the setting
  character itself. **No refusal reads who owns a character**, so naming one's own other mask is accepted without a
  word ("A response never proves a private fact"). The list is picked with the board's search (the owner: "we can use
  the Search we just built for the character select part"): `charactersSource` (`engine/ui/search/suggest.ts`), whose
  `suggest_characters` returns only debuted characters' ids and names and nothing computed from who owns one. So the
  only refusal is for an id that is not a debuted character (missing or not yet debuted), with one message for both,
  which a player using the form never meets.
- **A retired character may be named.** The search offers them, and an admin may restore one. A back naming a
  character that is retired, at the set or after it, leaves that part of the condition unmeetable while the character
  stays retired, and the back still ends by itself at `setLasts`, the way out every back already has.

## 5. When it springs: what is shown

**Decided** (the owner chose the recommendation, adding that long text must be accounted for): the spring shows the
conditions that matched. The spring Act's payload gains `when`, holding the Says phrase and the passage where they
were set, and `for`, the quoting character, where the Who was Only these. **Anyone but is never named**, so a spring
never says who the setter chose to spare. The rest of an Only list stays unnamed too; `for` is the quoter, who is already
public as the quote's author. Weighed: showing every condition, the spared list included; showing none.

- The Lens: "Set face down by Pipewrench on 5 November for Spritey; sprang when Spritey quoted 'the punchline' saying
  'nice try'". The struck player's alert and both players' logs carry the same facts.
- **Long text:** a phrase or passage is at most 100 characters. Alerts, toasts and log lines shorten it at a word
  boundary to about 40 characters with "…". The Lens shows it in full.
- **Before it springs**, a condition is the setter's alone: it is stored in their `face_down` row, read through
  `my_face_down`, and never in the Set Act, its Realtime event, `card_target` or a projection. The setter's log line for
  the Set says what the back waits for, in full.

## 6. The masks: even work

Every quote that meets a back does the same work whatever the back holds (`spring_facts`, the trap-locks design's
rule). For each back, conditioned or not:

- One walk of the quoting post's BBCode gives both its own visible words and the excerpt of the trapped post, so the
  walk's cost is the same whether or not the back has a passage.
- Two probes run, the Says probe over the post's own words and the Quotes probe over the excerpt, each `phrase_probe`
  with a pattern of one length. A back without that condition is probed with a pattern no text satisfies, as a no-phrase
  back is today.
- The Who check compares the quoter with a list of up to five, and an empty list for Anyone.

Only then is anything decided. A quote that a condition turns away writes nothing, exactly as a Bluff or a Move that
cannot land does. Cost at a busy instance's scale: a quote still meets one back. The added work is one walk of the
quoting post (already made today for its own words), one more probe and a membership test of at most five, all bounded
by the post's length and independent of how many backs, characters or threads the instance holds.

## 7. The screens

- **The set form (the glass).** Below the card's own settings, under "Springs when someone quotes this post", a
  **Only when** group: "they say…" (a text field), "they quote…" (a field with a picker over the post's text), and
  "Who" (a three-way choice; for the two lists, the search's character box, `GlassCombobox` over `charactersSource`,
  as the Reveal overlay and Quote someone already use it, with each chosen character shown as a removable chip). Each is
  optional. The summary line reads the conditions back in plain words ("Springs when Spritey or Boshi quotes 'the
  punchline'"). Impeccable's `shape` step runs on it with the owner before it is built.
- **Highlight-to-quote (the board).** Section 3.
- **The log, the Lens and alerts.** Section 5.

## 8. The layers

All of it is the engine's: the conditions, the matcher, the excerpt walk, highlight-to-quote and the form. Divided
World supplies only its voice for the alerts (`UiCopy`), which may gloat and never bluffs, and Autocorrect's
`setPhrase`, unchanged. The engine names no card.

## 9. What the change does to what an instance holds

No instance is deployed. Backs set before this hold no conditions and spring on any quote. Autocorrect plays already
laid are drawn through the new matcher, so a post may show a strip where the old matcher saw none (on "don't" for "dont"),
or lose one where a phrase sat inside a contraction. Springs already written keep their payload; the payload check
accepts them with or without `when`.

## 10. Ways out

No new state is added. A conditioned back springs once or ends by itself at `setLasts`. A back whose conditions can no
longer be met (a passage edited away, every named character retired) waits for its time like any back nothing meets.

## Open

- **Says, as its own trigger**, still waits on its cost design (the face-down Moves design, "Open"). This form's
  "they say…" field is where its phrase would be typed.
- **Telling the setter about near misses** (a quote that met the back and failed a condition) was not discussed. It
  is the setter's own back, so their own log could say it, but it adds a write per quote.
- **A Mod Bot setting a Move with conditions** waits with Mod Bot Moves (the face-down Moves design, "Open").
