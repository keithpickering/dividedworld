# Mentions: plan

Record, written 2026-11-21. The plan for `docs/plans/2026-11-21-mentions-design.md` (#303). One build session builds it
in one PR from `main`, after the design's PR is merged. The PR closes #303.

Every task is test first: name the test, record its red run, then write the code. No check is added, so no poison is
needed; the plain-words pair (`tools/check-bbcode-plain.mjs` and its test) already holds the SQL walk to the fixtures,
and gains fixtures, not a check.

**Migrations.** Two, taking the next free numbers in `supabase/migrations/` (0403 and 0404 as this is written):
`NNNN_mention_tag.sql` (Task 2) and `NNNN_mentioned_alerts.sql` (Task 3). Their SQL tests take the matching numbers in
`supabase/tests/`. Each function a migration replaces is copied from its latest definition, found with
`grep -il "function <name>(" supabase/migrations/*.sql | tail -1` before copying, and changes only what this plan names.
As this is written: `bbcode_walk` and `bbcode_plain` (0393), `write_framed` (0118), `write_forged_framed` (0393),
`write_reply` (0393), `post` and `start_thread` (0395), `spin_written` (0395), `settings_held` (0395), and the
`alerts_kind_check` constraint (0213).

**The layers.** Everything is the engine's. No instance file changes; the boundary check holds.

**The world.** The board, in its house style, for the mention and the list; Settings' toast row is the glass's.

## The words this plan uses

- **The tag:** `[user=<uuid>]Name[/user]`. **A mention:** the parsed node, `{ type: 'mention', user, name }`.
- **The list:** the composer's character suggestions opened by `@`.

## Task 1: the tag in the engine's parser and walk

Model: sonnet

Files: `engine/bbcode/parse.ts`, `engine/bbcode/visible.ts`, `engine/bbcode/parse.test.ts`,
`engine/bbcode/visible.test.ts`, `engine/bbcode/plain.fixtures.ts`.

- `parse.ts`: `user` joins `BBCODE_TAGS` as a raw-contents tag, read the way `code` and `noparse` are (the branch at
  `name === 'code' || …`): an opener `[user=<uuid>]` (UUID in any case, kept lowercase), contents up to the first
  `[/user]`, trimmed, with no line break and at most `MAX_QUOTE_NAME` characters. It gives
  `{ type: 'mention'; user: string; name: string }` in `BbNode`. Anything else (no `=`, a non-UUID, a bare `[user]`, a
  line break, a longer name, no closer) leaves the opener as text, as every malformed tag does. It makes no frame and
  is counted by no nesting.
- `visible.ts`: a mention stands as one `\n` (`STAND_IN`), beside `url`, in `visibleWalk` and `excerptText`. Add
  `mentionsIn(nodes: readonly BbNode[]): string[]`: the distinct `user` ids of the post's own mentions, in order,
  descending into every node whose words are the post's own (the containers the file's header lists, a counterfeit's
  children, list items, spoilers), never into a real quote, a cut, code or `[noparse]`. Iterative, as the walk is.
- `plain.fixtures.ts`: a `mentions?: readonly string[]` field, documented as the others are (`mentionsIn(parse(body))`
  and the database's `bbcode_walk(body, null).mentions`). Fixtures, each with `plain` and `mentions`: a mention between
  words (`hey [user=<A>]Geno[/user] you` gives `hey you` and `[A]`); an uppercase id (kept lowercase); two of the same
  id (once); an empty name; a name with `]` in it; a mention in bold and in a counterfeit (counted); in a real quote, in
  code, in `[noparse]` (not); a non-UUID id, a line break in the name, an 81-character name and no closer (each the
  text as written, no mention).
- `engine/bbcode/plain.test.ts` holds `mentions` against `mentionsIn` beside the other fields.

Tests first: `parse.test.ts` cases for each shape above; `visible.test.ts` for the stand-in and `mentionsIn`. Then
`node tools/bbcode-plain.mjs` is *not* run yet (Task 2 owns the SQL file), so `npm run build` is red on the plain-words
check until Task 2: say so in the task's report, and run Task 2 next.

## Task 2: the tag in the database's walk

Model: sonnet

Files: `supabase/migrations/NNNN_mention_tag.sql`, `tools/bbcode-plain.mjs`, `supabase/tests/0117-bbcode-plain.sql`
(generated).

- `bbcode_walk` learns `user` exactly as Task 1's parser reads it (its `openers` list, the raw-contents branch beside
  `code` and `noparse`), stands a mention as one `\n` in `plain` and `excerpt`, and gains an output column
  `mentions uuid[]`: the same list as `mentionsIn`. Drop and recreate it the way 0393 did when it added `held` and
  `source` (read 0393's header, section 1, and recreate whatever it had to recreate). `bbcode_plain` is unchanged in
  body if it wraps the walk; copy it only if the drop requires.
- `tools/bbcode-plain.mjs`: for a fixture with `mentions`, assert `bbcode_walk(body, null).mentions` equals it (as an
  ordered `uuid[]`). Update its header's sentence listing what it holds. `tools/test-bbcode-plain.mjs` gains a case that
  a changed `mentions` in a fixture makes the generated file differ.
- Regenerate `supabase/tests/0117-bbcode-plain.sql`.

Tests first: the new fixtures from Task 1 fail in the generated SQL test against the current walk (record the red run
of `supabase/tests/0117-bbcode-plain.sql` against local Postgres); then the migration.

## Task 3: the `mentioned` alert

Model: sonnet

Files: `supabase/migrations/NNNN_mentioned_alerts.sql`, `supabase/tests/NNNN-mentioned.sql`,
`supabase/tests/0120-framed.sql`, `engine/rules/alerts.ts`, `engine/ui/data/fake.ts`, `engine/ui/alerts/words.ts`,
`engine/ui/account/Settings.tsx`, and their tests.

- **The kind.** `alerts_kind_check` and `settings_held`'s `kinds` array gain `mentioned`; `WRITTEN_KINDS` in
  `engine/rules/alerts.ts` gains it after `framed`. Any test that lists the kinds gains it.
- **`write_mentioned(written uuid, acting uuid) returns void`,** security definer, `search_path = public, pg_temp`,
  execute revoked from every API role (as `write_forged_framed`): reads the Act's body, takes
  `(bbcode_walk(body, null)).mentions[1:5]`, and for each id in order that is a debuted character and has no `alerts`
  row with `act = written and character = id` already (the index `alerts_by_act` serves it), calls
  `write_alert(id, 'mentioned', null, written, acting)`.
- **The callers.** In `post`, `start_thread`, `spin_written` and `write_reply`, `perform write_mentioned(...)` right
  after `write_forged_framed(...)`, with the same `acting` that call has. Confirm with
  `grep -n "perform write_forged_framed" supabase/migrations/*.sql` that no newer caller exists; add any found. `edit_post`
  is not a caller.
- **The framed check.** In `write_framed` and `write_forged_framed`, `position('user=' || lower(id) in lower(body)) > 0`
  becomes a match of `\suser=<id>` (whitespace before `user=`, case ignored), the counterfeit opener's own form
  (`parse.ts`, the quote opener's reading of ` user=`). The client's `framedIn` is unchanged.
- **The fake** (`engine/ui/data/fake.ts`): `writeMentioned(act)` beside `writeFramed`, called where `writeForgedFramed`
  is, with the same rules (first five, debuted, not already alerted by this Act, skipping staff and the actor's own
  masks as `write_alert`'s fake does).
- **Words.** `words.ts`: `case 'mentioned'` gives line `` `${row.name ?? 'Your character'} was mentioned` ``, and the
  same `detail` and `ways` as `quote`. `Settings.tsx`'s toast list: `{ kind: 'mentioned', title: 'Mentions', sentence:
  'A post mentions one of your characters.' }` after `framed`.

Tests first, in `supabase/tests/NNNN-mentioned.sql` (model on `0120-framed.sql`): a post mentioning another account's
debuted character writes one `mentioned` alert for its owner about the post; the same through `start_thread`, a spin
and a card's reply; none for the poster's own other mask, a staff character, an undebuted character, a random UUID, a
mention inside a real quote or code; a post that quotes and mentions the same character writes only the `quote`; one
that frames and mentions writes only `framed`; six distinct mentions write five; an edit adding a mention writes none;
**the post's answer is byte-identical** across mentioning another's character, one's own mask, an undebuted one and an
id of nothing (the masks). In `0120-framed.sql`: a body holding `[user=<id>]X[/user]` and no counterfeit, with that id
in `framing`, writes no `framed` alert (red before the tightening). Fake tests mirror the main cases, and a `words.ts`
test for the line.

## Task 4: drawing a mention

Model: sonnet

Files: `engine/ui/bbcode/Mention.tsx` (new), `engine/ui/bbcode/render.tsx`, `engine/ui/bbcode/bbcode.css`,
`engine/ui/bbcode/render.test.tsx` (or the file that tests `BbCode` today), `engine/ui/bbcode/Tags.board.stories.tsx`.

- `render.tsx`: `case 'mention'` draws `<Mention key user name />`. No prop threads through `nodes`; the component reads
  the context itself, as `render.tsx` already does through `useKayfaIfAny` and `actLoader`.
- `Mention.tsx`: with a Kayfa context, `useCharacter(user)` (`engine/ui/thread/locate.tsx`); a found character draws
  `<span className="kb-mention">` holding a link to the profile (the route `CharacterLink` in `engine/ui/mini.tsx`
  uses) whose contents are `@`, the 1em avatar and the current name; while loading, and when not found, or with no
  context, the typed `@{name}` (or `@someone` for an empty name) as plain text in the same span, no link and no avatar.
  Use `Byline`/`CharacterLink`'s parts where they fit; add an `at` (leading `@`) and a small-avatar option rather than
  a second avatar component.
- CSS: the avatar `1em` square, `vertical-align: -0.125em`, so a line's height is unchanged; no color but the board's
  link color; `white-space: nowrap` on the span, so `@` and the name never part.
- Layers: a mention is a `\n` in the visible text, so `layers.tsx` lays no run inside it; check by test that a text
  layer's runs around a mention land on the words either side (the `url` case is the model).

Tests first: a found character draws its current name (not the typed one) linked to its profile with the avatar; a
not-found id draws the typed `@Name` with no link; an empty name draws `@someone`; renaming in the fake changes the
drawn name. Story: a post with a resolved mention, an unresolved one and a mention mid-sentence at 390 and 1440 wide;
take the two screenshots and look at them (line height, baseline, wrapping) before calling the task done.

## Task 5: the combobox core

Model: sonnet

Files: `engine/ui/search/useComboCore.ts` (new), `engine/ui/search/useSearchCombobox.ts`, and its existing tests,
unchanged.

- Move into `useComboCore<O>({ source, query, open, minChars, debounceMs, allowEmpty, onChoose, trailing })` everything
  of `useSearchCombobox` but the input's own value: the querying with debounce, dropping a reply older than the newest
  query, `groups`, `active`, `liveText`, `failed`, the row props, `listProps`, and a `onKey(e): boolean` that handles
  Up, Down, Home, End, Enter, Tab (only when a row is active) and Esc, returning whether it handled the key.
- `useSearchCombobox` holds the input's `query` and `dismissed` and wraps the core, returning the same `ComboView` as
  today. Its tests (`useSearchCombobox.test.tsx`, `Combobox.test.tsx`) pass without a change to them; that is this
  task's proof. A `useComboCore` test covers driving it by a given query and the `onKey` return.

Tests first: the core's own test, red against no module.

## Task 6: `@` in the composer

Model: sonnet

Files: `engine/ui/composer/mention.ts` (new) and `mention.test.ts`, `engine/ui/composer/caret.ts` (new),
`engine/ui/composer/MentionList.tsx` (new), `engine/ui/composer/Editor.tsx`, `engine/ui/composer/composer.css`,
`engine/ui/search/suggest.ts`, `engine/ui/composer/Composer.test.tsx`, `engine/ui/composer/Composer.stories.tsx`.

- `mention.ts`, pure:
  - `mentionAt(text, caret): { start: number; query: string } | null`: the `@` run the caret ends: the nearest `@`
    before the caret on its line, at index 0 or after whitespace or `(`, with no `[`, `]` or line break between it and
    the caret, and the query (from after the `@` to the caret) at most `NAME_MAX_LENGTH`. Otherwise null.
  - `insertMention(text, at, caret, character: { id; name }): Edited`: replaces `text.slice(at.start, caret)` with
    `[user=<id>]<name>[/user]`, the selection after the closer; a name that does not read back whole (round-trip it
    through `parse` as `quoteSomeone` does in `text.ts`) is inserted as `[user=<id>][/user]`.
- `suggest.ts`: `mentionSource(api)`: `api.suggest(query, { kinds: ['characters'], most: 6 })`, one group, options
  carrying the character (for the avatar), `empty: 'No character matches.'`.
- `caret.ts`: `caretPoint(textarea, index): { top; left; lineHeight }` by a mirror `div` copying the textarea's box and
  font styles, measured and removed; no layout read per keystroke but this one.
- `MentionList.tsx`: the board skin's list (`BoardCombobox`'s list markup and classes, reused, not copied) positioned at
  the caret point inside the editor's relative box; pinned to the textarea's left and right where its width would pass
  the right edge. Rows draw the avatar and name.
- `Editor.tsx`: on change and on `select`/caret moves, compute `mentionAt(value, selectionStart)` (only with an empty
  selection) and drive `useComboCore` with its query (`minChars: 2`). In `keys`, while the list is open, offer the key to
  the core's `onKey` first and return if handled; Ctrl+Enter and the shortcuts are reached only when it did not. On
  choose, `put(insertMention(...))`, so undo returns the typed `@query`. Esc closes the list for this run until the
  query changes. While open the textarea gets `aria-controls` and `aria-activedescendant`; the polite line says
  "{n} characters. Up and down to choose, Enter to mention." (one character: "1 character…"; none: "No character
  matches."). Blur closes it.

Tests first: `mention.test.ts` for `mentionAt` (start of text; after a space and after `(`; not in `a@b`; a space in
the query kept; a line break, `[` or 41 characters gives null; a caret before the `@` gives null) and `insertMention`
(the tag, the caret after the closer, the fallback for a name holding `[/user]`). `Composer.test.tsx`: typing `@ge`
opens the list with the fake's matching characters; Down and Enter insert the tag; Esc leaves `@ge`; Ctrl+Enter with the
list closed sends, and with it open does not send; Tab with no active row moves focus as today; a picked mention, sent,
gives a `mentioned` alert in the fake. Then a story and screenshots at 390 and 1440 wide of the open list mid-line and
near the right edge; look at them before calling the task done.

## Review focus

- Existing Acts: a body that already holds `[user=<uuid>]…[/user]` now draws as a mention and loses those words from its
  visible text, which moves any stored layer offsets after it; confirm no stored row (Autocorrect, a redaction, a
  splat's runs) keys on offsets of a post written before the migration, or say how it is safe.
- The two walks: `mentionsIn` and `bbcode_walk`'s `mentions` agree on every container (a counterfeit's children, a
  spoiler, a list item) and on nesting past `MAX_DEPTH`; the fixtures cover the containers, not only the plain case.
- The masks: `write_mentioned`'s work differs with who owns the mentioned character only inside `write_alert`, as every
  written alert's does; the post's payload, refusals and Realtime events are the same for any id.
- The framed tightening does not stop a real counterfeit with a tab, a newline or several spaces before `user=` from
  framing, matching `parse.ts`'s reading of the opener.
- A busy instance: `write_mentioned` costs one walk of the body (already bounded) and at most five indexed lookups per
  post; the composer asks `suggest` only after the debounce and drops stale replies.
- The keyboard: with the list closed, no key in any composer behaves differently from today, including IME composition
  (`isComposing`) and the Editor's shortcuts.
