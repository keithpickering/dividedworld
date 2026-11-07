# Markdown shorthand: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-markdown-shorthand-design.md`. One build session builds
it in one PR from `main`.

Every task is test first: name the test, record its red run, then write the code. Migrations take the next free number
when the build starts (0101 at the time of writing; read `supabase/migrations/` and `tools/check-migration-versions.mjs`
first). SQL tests go in `supabase/tests/` under the numbering the suite uses, and run with `npm run test:sql`. A
redefinition starts from the latest definition of the function, whole. The engine names no instance
(`tools/check-engine-boundary.mjs`).

Read before Task 2: `engine/bbcode/parse.ts` whole (its header lists the rules the Markdown half must keep), and its
tests `engine/bbcode/parse.test.ts`.

## Task 1: the tree's three changes (engine)

Model: sonnet

- `engine/bbcode/parse.ts`: `BbNode`'s `code` gains `readonly inline?: true`; `img` gains `readonly alt?: string`; a new
  `{ type: 'greentext'; children: readonly BbNode[] }`. Nothing in the BBCode half makes them yet.
- `engine/bbcode/visible.ts` (`visibleWalk`): `greentext`'s children are the post's own words, and the line ends with
  `SEPARATOR`, as a list item's does. Inline code is code: one `SEPARATOR` and none of its text, as block code.
- `engine/ui/bbcode/render.tsx` (`node`): inline code renders `<code className="kb-bb-code-inline">`, not `<pre>`;
  `img` uses `n.alt` when it is a non-empty string, else `altFor(n.src)`; `greentext` renders
  `<span className="kb-bb-greentext">` with its children, through the text layers as bold's are, followed by a line
  break where the source had one (the renderer's line handling for text today decides how; read it).
- `engine/ui/bbcode/bbcode.css`: `.kb-bb-greentext { color: var(--kb-bb-greentext) }`, `.kb-bb-code-inline` in the
  board's Courier at the text's size.
- `engine/ui/tokens.css`: `--kb-bb-greentext` in light and dark, a green at 4.5:1 or better on `--kb-bg`.
  `engine/ui/contrast.ts` `PAIRS` gains `['--kb-bb-greentext', '--kb-bg', 4.5, 'greentext']`.
- Tests first: `visible.test.ts` (a greentext line's words are kept and separated; inline code leaves one separator),
  `render.test.tsx` (each of the three renders as above; a Markdown alt is the image's accessible name), and the
  contrast test red on the new pair before the token exists.

## Task 2: Markdown in the parser (engine)

Model: sonnet

- `engine/bbcode/parse.ts`: `export type PostSyntax = 'bbcode' | 'bbcode+markdown'`, `export const POST_SYNTAXES`,
  and `export function syntaxOf(payload: unknown): PostSyntax` (the payload's `syntax` when it is one of
  `POST_SYNTAXES`, else `'bbcode'`). `parse(input: string, syntax: PostSyntax)`: the argument is required, so every
  caller states it (Task 4 updates them). With `'bbcode'` the parser is today's, character for character.
- With `'bbcode+markdown'`, the same one pass handles the design's section 3 constructs by its section 5 rules. The
  scan today jumps from `[` to `[`; it now stops at the next character that can begin either syntax (`[`, `*`, `_`, `~`,
  `` ` ``, `!`, `<`, `\`, and a line start for `- `, `* `, `1. `, `>` and a fence). Markdown frames go on the same
  `stack` with `kind: 'md'` and a `name` of their delimiter (`**`, `*`, `_`, `~~`), so `closeTag`'s rule holds across
  both. A Markdown frame still open at the end is unwound as text (rule 2): its delimiter as written, then its contents,
  as a literal frame is today. A fence or backtick run with no closer is its characters, and what follows parses.
- `[text](url)` is tried only when the `[` did not begin a known tag (rule 4); its target goes through `safeHref`, and a
  failed check leaves the whole span text. `![alt](src)` through `safeImageSrc`; `alt` is the bracket's text, plain.
  `<https://…>` through `safeHref`, http and https only.
- Bounds, as the header promises: no recursion; `MAX_DEPTH` counts Markdown frames; the closer of a backtick run and of
  a fence is looked up once and remembered, as `rawEnds` does for `[code]`; a run of delimiters is consumed whole.
  Rewrite the header comment to cover both syntaxes.
- Tests first, in `parse.test.ts`:
  - a precedence table, one row per rule of section 5 with the design's own examples (`**[i]x**[/i]`, `2 * 3 * 4`, a lone
    `**`, `snake_case`, `[b](http://x)`, `\[b]`, `` `[b]x[/b]` ``, `[url=x]**y**[/url]`);
  - each construct of section 3, and each one's text fallback (`[a](javascript:x)` and `![a](data:x)` stay text);
  - **the property test** (rule 8): every input in the file's existing cases, and 2,000 generated BBCode posts drawn
    from tag names, attributes and words with no Markdown punctuation, parse to deep-equal trees under both syntaxes;
  - bounds: 50,000 `*`, 50,000 `` ` ``, 10,000 nested `**[i]` and a 20,000-line list each parse within the time the
    file's existing bound tests allow.

## Task 3: the setting (engine, instance)

Model: haiku

- `engine/rules/types.ts` `Settings`: `readonly postSyntax: PostSyntax;` with the doc comment: "Which syntax a post,
  edit, spin, update or signature is written under, recorded on it when written and never reread: `'bbcode+markdown'`,
  BBCode with the Markdown shorthand, is the recommended value; `'bbcode'` is the plain 2003 board."
- `engine/rules/instance.ts` (the validator map beside `postMaxLength` at :148): `postSyntax: (v) =>
  (POST_SYNTAXES.includes(v) ? null : 'bbcode or bbcode+markdown')`.
- `engine/ui/data/api.ts` `Settings` (beside `postMaxLength` at :63) gains `postSyntax`, carried by `fake.ts` (:333) and
  by the Supabase adapter wherever it reads the other settings.
- `engine/ui/guide/markdown.ts` (:281): `postSyntax: null` in the key list, as `registrationMode`.
- `instances/divided-world/settings.ts`: `postSyntax: 'bbcode+markdown'`.
- Tests first: `instance.test.ts` refuses `'markdown'` and an absent key; `settings.test.ts` passes with the new key.

## Task 4: every reader states the syntax (engine, instance)

Model: sonnet

- `engine/ui/bbcode/render.tsx` `BbCodeProps` gains a required `syntax: PostSyntax`, passed to `parse`. Every call site
  passes one: a post's, edit's, spin's or update's from `syntaxOf(act.currentPayload)` (`thread/Post.tsx`,
  `thread/lines.tsx`, `postbit/Postbit.tsx`, `spin/Origin.tsx`, `updates/UpdateWords.tsx`, `reveal/Reveal.tsx`); a
  signature's from the profile's `signatureSyntax` (`profile/Profile.tsx`, `profile/Staff.tsx`, after Task 5 carries it);
  the editor's preview from `settings.postSyntax` (`composer/Editor.tsx`); a stock line's `'bbcode'`
  (`board/MoveNotice.tsx`); the front door's staged posts `'bbcode'` unless their staged Act says otherwise
  (`front-door/FrontDoor.tsx`).
- `engine/ui/composer/Composer.tsx` `firstQuote` parses with `settings.postSyntax`.
- `engine/rules/cards.ts` `postTarget(act, kind, body, version?)` gains `syntax: PostSyntax` before `version`;
  `supabase/functions/act/core.ts` (:166) reads `syntax` from what `card_target` returns (Task 5) through `syntaxOf`.
- `instances/divided-world/cards/autocorrect/ConfigForm.tsx` and `Effect.tsx` parse with the post's syntax, which they
  read where they read its body.
- `engine/ui/composer/Editor.tsx`: with `settings.postSyntax === 'bbcode+markdown'`, the line "BBCode, or Markdown
  shorthand." in `kb-small kb-muted`, beside the count and hint, joined to the box's `aria-describedby`.
- Tests first: one per reader that a post recorded `'bbcode+markdown'` holding `**x**` draws bold and one recorded
  `'bbcode'` draws the asterisks (`Thread.test.tsx`, `render.test.tsx`, `core.test.ts`, the autocorrect tests: the
  server's and the screen's visible text agree for a Markdown post); `Composer.test.tsx` shows the line only with
  the setting on. TypeScript drives the call sites: the required prop is the red run for each.

## Task 5: recording it (migration)

Model: sonnet

- One SQL function `post_syntax() returns text`, stable, reading the `postSyntax` setting, defaulting to `'bbcode'` only
  where the row is absent in a database seeded before this change.
- Redefine from their latest definitions, writing `'syntax', post_syntax()` beside `'body'`: `post`
  (`0078_reply_passes.sql`), `edit_post` (`0005_actions.sql`), `start_thread` and `spin` (`0013_system_board.sql`),
  `post_update` (`0062_updates.sql`), and the staff writer for a Mod Bot's or a pool persona's model-written post
  (`write_staff_thread`, `0089_pool_spends.sql`). Stock lines write `'syntax', 'bbcode'`: `say_in_announcements`
  (`0082_offices.sql`) and `say_move_end` (`0051_succession.sql`). Before writing, grep the migrations for every other
  `insert into acts` whose payload has a `body` and sort each into one of these two kinds; the PR lists them.
- `acts_well_formed` (latest `0092_card_end.sql:57`): a payload's `syntax`, where present, is one of the two values,
  else `23514` naming it, so an import cannot plant a third.
- `card_target` (latest `0092_card_end.sql:464`) returns `'syntax'` beside `'body'`, from `current_payload`, or
  `'bbcode'` where absent.
- `profiles` gains `signature_syntax text not null default 'bbcode'` with the same check; `set_profile`
  (`0019_profiles.sql:119`) writes `post_syntax()` when the signature changes, and the profile read (`0019:112`) returns
  it. The UI's profile type gains `signatureSyntax`.
- The instance seed (`supabase/functions/_shared/seed.ts`, `seed_instance`'s `jsonb_each(payload -> 'settings')`)
  writes every setting key, so `postSyntax` needs no seed change; a test confirms it lands.
- Tests first, SQL: each function above records the syntax in force, and each stock line `'bbcode'`; flipping the setting
  changes what is written next and no existing payload; an edit records the syntax in force at the edit; an Act with no
  key reads as `'bbcode'` through `card_target`; `acts_well_formed` refuses `'markdown'`; the export round-trip test
  (`supabase/tests/e2e/0003-export.ts`) holds a post of each syntax and a signature of each.

## Task 6: the Strategy Guide (instance words)

Model: sonnet

- `instances/divided-world/guide/strategy-guide.md`: a short section "Writing posts", placed before "The masks", in the
  developer persona's voice as the rest of the file is: BBCode is the board's own; Markdown shorthand works too; a table
  of each construct in both syntaxes (section 3's table, without the node column); that `>` is greentext and quotes are
  Quote's; that a backslash shows a Markdown character as itself. True, plain, and never in character. The owner
  approves it in review.
- Test first: whatever `engine/ui/guide/` tests require of a section (its key, its markers) red before it is written.

## Review focus

- Acts an instance already holds: every one has no `syntax` key. Check that each reader goes through `syntaxOf` and no
  path reads `payload ->> 'syntax'` raw in a way that treats null as Markdown.
- The property test is the guard on old posts: check its generator really produces the existing tag shapes (attributes,
  quotes of Acts, lists, `[code]`, stray closers), not only plain words.
- The parser's cost on a hostile post of `postMaxLength` (20,000) characters under both syntaxes: confirm no new scan is
  quadratic, in particular the backtick-run and fence closer lookups.
- Card text and visible text must agree between server (`postTarget` in the `act` function) and screen (autocorrect's
  `Effect.tsx`, the text layers) for a Markdown post; a disagreement mis-places an autocorrect strike.
- Every `insert into acts` with a `body` has been sorted into written-by-someone or stock line; a stock line recorded
  `'bbcode+markdown'` would read a filled-in character name as Markdown.
- `noTag` (Mod Bots plan) stays literal by design; check its build, if it lands first, does not parse the tree.
