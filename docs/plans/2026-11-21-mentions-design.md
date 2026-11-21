# Mentions: design

Record, written 2026-11-21. A design session with the owner on #303: an `@` in the composer that opens a character
autocomplete from Search's existing suggestions, and puts a mention in the post that alerts the character's owner. Its
plan is `docs/plans/2026-11-21-mentions-plan.md`. The session settled the questions #303 left, by the owner's choices
below.

## 0. Where it starts

- **Mentions were left out twice.** The alerts design (`docs/plans/2026-11-02-alerts-design.md`, section 4) left them
  open as "one more kind" in the catalog; the BBCode design (`docs/plans/2026-11-07-bbcode-tags-design.md`, section 4)
  turned the 2003 `[user=]` tag into "an @mention with an autocomplete (#303)"; the Markdown shorthand design left
  `@mentions` to "a feature of their own".
- **Search already suggests characters.** `charactersSource` (`engine/ui/search/suggest.ts`) asks `api.suggest` for
  debuted characters only (`characters_public`, `docs/plans/2026-11-07-search-design.md`, section 9). The one headless
  combobox, `useSearchCombobox` (`engine/ui/search/useSearchCombobox.ts`), owns an `<input>`'s value; its board skin
  (`BoardCombobox`) already serves Quote someone… (`engine/ui/composer/QuoteSomeone.tsx`).
- **A counterfeit quote is the pattern.** `[quote=Geno user=<id>]` draws the character's *current* avatar and name
  (`CounterfeitHead`, `engine/ui/thread/lines.tsx`, through `Byline`, `engine/ui/mini.tsx`), and the typed name with a
  letter avatar when the id does not resolve to a debuted character. Its `framed` alert is written by `write_framed`
  (0118) and `write_forged_framed` (0393): at most five, each only for a debuted character the body names, through
  `write_alert`, which skips staff and the acting account's own masks.
- **Characters are renamed** (`supabase/migrations/0011_names.sql`; names are unique across case and lookalikes). A
  bare `@Name` would follow the name, not the character.
- **One parser in two languages.** `engine/bbcode/parse.ts` and `visible.ts` on the client, `bbcode_walk` and
  `bbcode_plain` in SQL (newest in `0393_forged_quotes.sql`), held to each other by `engine/bbcode/plain.fixtures.ts`,
  `tools/bbcode-plain.mjs` and `tools/check-bbcode-plain.mjs`.

## 1. What a mention stores

**Decided** (the owner, A): the composer inserts `[user=<character id>]Name[/user]`, the name as it was picked.

- The id survives a rename, as a counterfeit's `user=` does; the `user=` spelling is the convention the board already
  has. The draft shows the tag, as a 2003 board's did.
- The tag's contents are raw text, as `[code]`'s are, up to the first `[/user]`: one line, at most `MAX_QUOTE_NAME`
  (80) characters after trimming, possibly empty. A `user=` that is not a UUID, a contents with a line break, a longer
  one, or no closer leaves the whole opener as the text the player wrote.
- Weighed: B, a bare `@Name` resolved when read, a clean draft but a mention that moves to whoever takes the name and
  dies with a rename; C, `@Name` in the text and ids in the Act's payload keyed by offset, a clean draft but offsets that
  break under an edit, and a text that no longer says what it means on its own (export, quoting, copying BBCode).

## 2. How a mention looks

**Decided** (the owner, A): `@`, a small avatar and the character's **current** name, linked to their profile, in the
board's house style.

- The avatar is 1em, inline, on the text's baseline, so a line with a mention keeps its height; the name is a board
  link, underlined as every link on the board is. It is `Byline` with `link` on, after an `@` that is part of the link.
- An id that is not a debuted character's draws the typed `@Name` as plain text: no link and no avatar. An empty typed
  name draws `@someone`. A character that has not debuted and one that never existed draw alike, since both read
  `characters_public`.
- Weighed: B, a bold `@Name` link with no avatar, the quietest; C, a plain link with a hover card, more interface on every
  mention and a touch fallback to design.

**In the visible text a mention is one `\n`**, as a link is (`engine/bbcode/visible.ts`). Its words are a character's
name, not the post's own, and the name drawn can change after the post is written: if it counted, a rename would move
every offset the text layers lay a card's effect on, and Autocorrect would match a phrase in a name. So a card's effect
on the words skips over a mention as it skips a link, and the effects that fill the content area fill over it as they
fill over a link ("An effect fills the post, border to border"). A mention inside a real quote is the quoted post's,
as all of a real quote's words are; one inside a counterfeit is the post's own.

`bbcode_plain`, the words Search indexes, follows the visible text, so a post is not found by the name of a character
it mentions. Open below.

## 3. The composer

**Decided:** `@` in any draft opens the board skin's list of characters at the caret (the owner chose A on where).

- It works wherever the shared `Editor` (`engine/ui/composer/Editor.tsx`) is: a post, a thread start, a spin, an
  apology, an edit and a card's reply.
- **The trigger.** An `@` at the start of the draft or after whitespace or `(`, and the caret after it on the same
  line. The query is what stands between the `@` and the caret, trimmed of nothing (names hold spaces). The list opens
  at two characters, as Search's suggest does, and closes when the query passes 40 characters (`NAME_MAX_LENGTH`), holds
  a `[` or `]`, the caret leaves the run, or Esc is pressed. It reopens when the player types into the run again.
- **The list** is up to six debuted characters from `api.suggest` (`kinds: ['characters']`), each with its avatar and
  name, in the board skin. It floats under the caret's line, measured with a mirror of the textarea; narrower than its
  own width from the textarea's right edge, it is pinned to the textarea's left and right. The trailing row is none.
- **Keys while it is open:** Up and Down move, Home and End, Enter or Tab picks, Esc closes it and leaves the text.
  While it is closed every key does what it does today, Ctrl+Enter and the shortcuts included. A click or a tap picks.
- **A pick** replaces `@` and the query with the tag, the caret after `[/user]`, through the Editor's `put`, so one undo
  takes it back to the typed `@query`. A name the parser would not read back whole (one holding `[/user]`) is inserted
  as `[user=<id>][/user]`, which draws the current name all the same.
- **Unpicked is plain** (the owner, A): `@Geno` typed and never picked is the words `@Geno`. The server never turns a
  name into a mention, and the composer never does on a space. So `@everyone`, an address and a name that is a word are
  never touched. Weighed: B, the server converts an exact name on posting, which rewrites what a player wrote; C, the
  composer converts an exact top match on Space, which surprises the player who meant the word.
- **No toolbar button.** The `@` is the way in, as it is on every forum since.
- **Accessibility.** The textarea keeps its role. While the list is open it carries `aria-controls` and
  `aria-activedescendant` naming the active option, and a polite line says how many characters match and how to choose
  ("3 characters. Up and down to choose, Enter to mention."). Focus never leaves the textarea.

**The combobox splits once.** `useSearchCombobox`'s querying, debounce, stale-reply dropping, active row, keyboard and
ARIA move into a core hook driven by a query it is given, `useComboCore`; `useSearchCombobox` becomes the `<input>`
wrapper over it with the same behavior and tests, and the mention list is a second wrapper over the textarea. One
implementation of the keyboard and the live line stays the one to keep correct (search design, section 8).

## 4. The `mentioned` alert

**Decided** (the owner, A): a mention alerts the character's owner, a new written kind, `mentioned`.

- **The server reads the mentions from the body**, not from a list the client sends: `bbcode_walk` gains a `mentions`
  column, the distinct ids of the post's own mentions in the order they stand (none inside a real quote, code or
  `[noparse]`). So no write function's signature changes. The client computes the same list (`mentionsIn`,
  `engine/bbcode/visible.ts`), held to the SQL by the plain fixtures.
- **`write_mentioned(written, acting)`** writes one `mentioned` alert for each of the first five that is a debuted
  character and that the same Act has not already alerted (its quote's `quote` alert, a `framed` one), through
  `write_alert`, so staff and the acting account's own masks get none, as for every written kind.
- **Where.** Every function that writes a post's framed alerts calls it after them: `post`, `start_thread`,
  `spin_written` and `write_reply` (a card's reply). An edit writes none, as it writes no quote or framed alert today; a
  Mod Bot's pool post writes none.
- **Its words** (engine copy, `engine/ui/alerts/words.ts`): "{name} was mentioned", with "In *title*, post #N." and the
  way to the post, as a quote's alert has. A toast choice and `toastDefaults` may name it; Settings lists it as
  "Mentions: A post mentions one of your characters."
- **The framed check is tightened.** `write_framed` and `write_forged_framed` accept an id the body holds as `user=<id>`
  anywhere, so a mention's `[user=<id>]` would let a client send a mentioned id as `framing` and write a `framed` alert
  for a character nobody framed. Both now require the counterfeit's own form, `user=` after whitespace inside a quote
  opener.
- Weighed: B, no alert, only a link, which loses the reason anyone mentions anyone; C, an alert only for an owner who
  opted in, a setting and an off state to explain where a toast choice already lets a player mute a kind.

## 5. The rules

**The masks.** A mention's drawing reads `characters_public`, as a counterfeit's head does: a debuted character's name
and avatar, public. The list reads `api.suggest`, which reads only debuted characters. `write_mentioned` reads who owns
the character, inside `write_alert`, to address the row, as every written alert does; nothing it returns or refuses
differs by it. A post's answer, refusals and payload are the same whether the mention names someone else's character,
the poster's own other mask, a staff character, an undebuted one or an id of nothing. The poster never learns whether
an alert was written.

**Ways out.** A mention puts nothing in a state: a `mentioned` alert clears as every alert does (Alerts' mark), and a
toast choice mutes it.

**The layers.** All of it is the engine's: the tag, the walk, the drawing, the list, the alert kind and its words. An
instance supplies nothing; the boundary check holds.

**The world.** The board, in its house style (`docs/plans/2026-10-29-two-worlds-design.md`): the mention in a post and
the list in the composer, in the board skin Quote someone… already uses. Settings' toast row is the glass's, as its
other rows are.

**Append-only.** A mention is words in a post's body; nothing is stored beside it, and an edit's mentions are its own.

**Existing Acts.** A post written before this with `[user=<uuid>]…[/user]` in it draws as a mention from then on, and
one with a malformed `[user=` still reads as its text. No instance holds players, so no post's meaning is taken from it.

## Open

- Whether Search should find a post by the name of a character it mentions (today it does not, since the visible text
  holds a `\n` there).
- Whether the welcome page or the Strategy Guide mention mentions: owner-approved copy, for its own change.
- Whether a card's own words (a postcard's message, a Mod Bot's card) may hold a mention. They take BBCode where they
  do today and so draw one, but write no `mentioned` alert.
