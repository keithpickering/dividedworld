# BBCode tags: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-bbcode-tags-design.md`. One build session builds it in
one PR from `main`, **started once the search build's PR (`docs/plans/2026-11-07-search-plan.md`) is merged**: Task 10
uses its `useSearchCombobox`, its board skin and its `suggest_characters`, and Task 7 changes its `bbcode_plain`. If the
search build is not on `main` when this one starts, the build session asks the owner before going on.

Every task is test first: name the test, record its red run, then write the code. Each task is engine: no instance file
changes, and the engine's new files name no instance (`tools/check-engine-boundary.mjs`). One migration, numbered the next
free number when Task 8 starts (`supabase/migrations/NNNN_bbcode_tags.sql` below), in sections by task, as
`0092_card_end.sql` is. Every CSS class is in `tools/check-css-classes.mjs`'s reach and every color a token
(`tools/check-ui-tokens.mjs`). The words a player reads are American English.

Read before Task 1: `engine/bbcode/parse.ts` whole (its header is the safety argument every new tag must keep),
`engine/bbcode/visible.ts`, `engine/ui/bbcode/render.tsx` and `layers.tsx`.

## Task 1: counterfeit quotes in the parser

Model: sonnet

Design section 1, "Syntax".

Files: `engine/bbcode/parse.ts`, `parse.test.ts`, `engine/bbcode/visible.ts`, `visible.test.ts`.

- A new node, `{ type: 'counterfeit'; name: string | null; user: string | null; children }`. `quote` keeps its shape, so
  `firstQuote` (`engine/ui/composer/Composer.tsx`) and every real quote already written read as before.
- `[quote=…]`'s value is read as: an optional name (a quoted string, or the words up to ` user=`), then an optional
  ` user=<uuid>`. A name that is a UUID with or without `user=` is a real quote (`user=` dropped). Any other name, at
  most 80 characters after trimming, with or without a well-formed `user=`, is a counterfeit. `[quote user=<uuid>]` and a
  bare `[quote]` are counterfeits with no name. A malformed `user=` value (not a UUID) makes the whole opener text, as a
  bad attribute does everywhere else. Ids are lowercased.
- `visible.ts`: a counterfeit's children are walked (its words count); a `quote` still stands as one `\n`.
- Tests first: each row of the design's syntax table; `[quote=<act> user=<other>]` gives a real quote of `<act>`;
  `[quote="Geno Wario" user=…]`; an 81-character name is text; `user=notauuid` is text and so is its closer; a counterfeit
  inside a counterfeit; `MAX_DEPTH` still caps it; the visible text of `a[quote=Geno]b c[/quote]d` keeps `b c`.

## Task 2: spoilers

Model: sonnet

Design section 2.

Files: `parse.ts`, `parse.test.ts`, `visible.ts`, `visible.test.ts`, `engine/ui/bbcode/render.tsx`, `render.test.tsx`,
`bbcode.css`.

- Nodes `{ type: 'spoiler'; title: string; children }` (title defaulted to "Spoiler", at most 80 characters, else the
  opener is text) and `{ type: 'ispoiler'; children }`.
- **Inline only inside `[ispoiler]`.** The parser knows the block tags (`quote` in both forms, `code`, `list`,
  `spoiler`, `center`, `left`, `right`, `hr`, `video`, `youtube`, `marquee`; Tasks 3 and 4 add theirs to the same set,
  one `BLOCK` set in `parse.ts`). An opener of one while an `ispoiler` frame is open is text, and so is its closer. Kept
  as a count of open `ispoiler` frames, as `openUrls` is, so it costs nothing per tag.
- `visible.ts`: both are transparent.
- Render: `spoiler` is `<details className="kb-bb-spoiler"><summary>{title}</summary><div>…</div></details>`, styled as
  `.kb-quote` is. `ispoiler` is a small component, `ISpoiler`, a `<button type="button" aria-expanded>` whose content is
  the words, drawn as a black bar (`color` and `background` the same token) while shut; its accessible name while shut is
  "Spoiler" (`aria-label`, dropped once open). Text layers draw inside both, as everywhere else.
- Tests first: parse of each form and of `[spoiler=]`; a quote, a list and `[spoiler]` inside `[ispoiler]` are text;
  `[ispoiler]` inside `[spoiler]` works; the visible text keeps both's words; render: summary text, shut by default,
  the button's name and `aria-expanded` before and after a press, a text layer's run inside a shut `ispoiler` is drawn
  when it opens; axe clean (`engine/ui/a11y.ts`).

## Task 3: video

Model: sonnet

Design section 3.

Files: `engine/bbcode/video.ts` and `video.test.ts` (new), `parse.ts`, `parse.test.ts`, `visible.ts`,
`engine/ui/bbcode/Video.tsx` and `Video.test.tsx` (new), `render.tsx`, `bbcode.css`, `web/headers.ts`,
`netlify.toml`.

- `video.ts`: `videoOf(raw: string): Video | null`, a pure table from a URL (passed first through `safeImageSrc`, so the
  address checks are the ones images have) to `{ provider, id, start?, src }`, where `src` is the URL the player loads
  (Twitch's `parent` is filled at render, from `location.hostname`, since the engine does not know its host). Ids are
  checked against each provider's own character set, so nothing but an id reaches a player URL. `PLAYER_HOSTS`, the list
  of hosts a player loads from, is exported from here.
- Parser: `[video]` and `[youtube]` take their contents raw up to the closer, as `[img]` does (its `rawEnds` entry, its
  bound on work). `[youtube]` also takes a bare 11-character id. A URL `videoOf` refuses leaves only the opener as text.
  Node `{ type: 'video'; video: Video }`. Both are in `BLOCK`.
- `visible.ts`: a video is one `\n`.
- `Video.tsx`: shut, a box with a Play button. YouTube's box shows `i.ytimg.com/vi/<id>/hqdefault.jpg` behind it;
  every other provider's box says "▶ {Provider} video: {host and path}". Pressing Play swaps in the iframe (`sandbox`,
  `allow` for fullscreen and encrypted media, `referrerPolicy="no-referrer"`, a title naming the provider) or, for a
  file, `<video controls preload="none">`. Focus moves to the player. The URL is shown in the box as a link, so a
  player that will not load still gives the reader the address.
- CSP: `frame-src` lists `PLAYER_HOSTS` exactly; `media-src https:`. `web/headers.ts` builds the directive from
  `PLAYER_HOSTS`, and `netlify.toml` repeats it; `web/headers.test.tsx` already fails if they differ.
- Tests first: a table in `video.test.ts` with every accepted form of the design's table, start times, ids with bad
  characters refused, a lookalike host (`youtube.com.evil.example`, `evilyoutube.com`) refused, `http:` refused for a
  file; parse of `[video]` with a good URL, a bad one, no closer; render: no iframe before Play, the iframe's `src` and
  `sandbox` after, the YouTube thumbnail's address; axe clean.

## Task 4: layout, effects and `[noparse]`

Model: sonnet

Design section 4.

Files: `parse.ts`, `parse.test.ts`, `visible.ts`, `visible.test.ts`, `render.tsx`, `render.test.tsx`, `bbcode.css`,
`engine/ui/tokens.css`.

- Nodes: `align` (`center`, `left`, `right`), `hr`, `sub`, `sup`, `font` (a key from a `FONTS` table in `parse.ts`
  mapping each allowed name, compared without case, to a CSS stack the renderer reads), `marquee`, `glow` and `shadow`
  (each with an optional `safeColor`), `rainbow`, `highlight` (an optional `safeColor`, yellow by default), and
  `noparse` taken raw as `[code]` is (its own `rawEnds` entry), giving a `text` node, so its words are the post's.
  `[hr]` has no closer; `[/hr]` is text. `align`, `hr` and `marquee` are in `BLOCK`.
- `visible.ts`: every container is transparent; `hr` is one `\n`.
- Render and CSS:
  - `marquee` is a block whose inner span is animated across with a CSS keyframe; it pauses on `:hover`, and is still
    under `@media (prefers-reduced-motion: reduce)` and under `[data-kb-motion="reduce"]`, and moves under
    `[data-kb-motion="full"]` whatever the system says (`engine/ui/appearance.ts`).
  - `glow` and `shadow` are `text-shadow`s in the given color, else in the page's ink.
  - `rainbow` is a linear gradient clipped to the text (`background-clip: text`), from two token sets,
    `--kb-rainbow-1` … `--kb-rainbow-6`, one for the light page and one for the dark, each stop at least 4.5:1 on its
    ground (a test in `engine/ui/contrast.test.tsx` reads them). Under forced colors it is plain text.
  - `highlight` sets the background, and the ink to black or white, whichever has the higher contrast on it
    (`ratio`, `engine/ui/contrast.ts`).
- Tests first: parse of each, a font not on the list is text, `[hr]` alone, `[noparse][b]x[/b][/noparse]` is the text
  `[b]x[/b]`; the visible text of each; render: the marquee's class and that it is still with `data-kb-motion="reduce"`
  (a computed-style check in the test's DOM where it can, else the rule's presence), highlight's ink on yellow and on
  navy, the rainbow tokens' contrast; axe clean.

## Task 5: auto-linking

Model: sonnet

Design section 4, "Auto-linking".

Files: `parse.ts`, `parse.test.ts`, `visible.ts`, `visible.test.ts`, `render.tsx`, `render.test.tsx`.

- After the main pass, one walk over the tree's `text` nodes that are not inside `url`, `img`, `code`, `noparse` or
  `video` (those never hold a `text` node to split, or are skipped by type) splits each bare `https?://` address into an
  `{ type: 'autolink'; href: string; text: string }` node. The address ends at whitespace or a character `safeHref`
  refuses; trailing `.,;:!?` and an unmatched closing `)` or `]` are left outside. One linear scan per text node.
- `visible.ts`: an `autolink`'s `text` is walked as a `text` node is, with its offset, so the visible text of every post
  already written is unchanged.
- Render: an `<a>` (`rel` and `referrerPolicy` as `url`'s), whose inside is drawn by the layered-text path, so a card
  run over an address still draws.
- Tests first: an address mid-sentence, at the end before a period, in parentheses, with a query and a fragment; inside
  `[url]` and `[code]` it is not split; `javascript:` and `data:` are not linked; the visible text of a post with an
  address is identical before and after this task (fixtures from `visible.test.ts`); a long run of `http://http://…`
  stays linear (a timing bound like `parse.test.ts`'s).

## Task 6: the avatar-and-name component

Model: sonnet

Design section 1.

Files: `engine/ui/mini.tsx`, `mini.css`, `mini.test.tsx`, `engine/ui/board/Board.tsx`, `engine/ui/index/Index.tsx`, and
their tests.

- `Byline({ character, name, link })`: the `Mini` avatar and the name. `link` true draws the name as the profile link
  (`/c/<id>`); false draws it as plain text in the same place, never underlined. With no character id it is "The
  System" in `kb-system-name`, as the three sites draw it today. `Mini` stays the avatar alone.
- The three sites (`Board.tsx`'s thread starter and last poster, `Index.tsx`'s last poster) use it; what they draw does
  not change.
- Tests first: `Byline` with a character, with no avatar (the letter), with no id (The System), unlinked; the board's and
  the index's existing tests still pass unchanged.

## Task 7: search's plain words follow

Model: sonnet

The search design, section 4: `bbcode_plain(body)` mirrors `visibleText`, held by fixtures and
`tools/check-bbcode-plain.mjs`.

Files: the fixtures the search build added, the generated SQL test, `supabase/migrations/NNNN_bbcode_tags.sql` (its first
section), and the reindex.

- Fixtures first, for every node Tasks 1 to 5 added: a counterfeit's words kept and a real quote's not; both spoilers'
  words kept; a video as a separator; each layout and effect tag's words kept; `[hr]` a separator; `[noparse]`'s
  contents as text; an autolink's words kept. Regenerate the SQL test, run it red against the old `bbcode_plain`.
- Redefine `bbcode_plain` whole in the migration so the check passes, then rebuild every post's `post_search` row in the
  same migration (a post that holds `[spoiler]` as text before this change now indexes the words without the tags).

## Task 8: the framed alert, in the database

Model: sonnet

Design section 1, "The framed alert". Read `supabase/migrations/0092_card_end.sql`'s header first: it added `cardEnded`
the same way, and this task copies its list of what changes.

Files: `supabase/migrations/NNNN_bbcode_tags.sql`, `supabase/tests/NNNN-framed.sql` (new), `engine/rules/alerts.ts`.

- `alerts_kind_check` and `account_preferences_toasts_check` gain `'framed'`; `set_preferences` and `settings_held`
  list it (each redefined whole from its latest definition). `WRITTEN_KINDS` in `engine/rules/alerts.ts` gains it.
- `write_framed(body text, framing uuid[], about uuid, acting uuid)`: for each distinct id among the first 5, if it is a
  debuted character (`characters.debuted_at is not null`) and `body` contains `user=<id>` (case ignored), it calls
  `write_alert(id, 'framed', null, about, acting)`. Otherwise it does nothing. It returns nothing. No API role executes
  it.
- `post`, `start_thread` and `spin` gain `framing uuid[] default '{}'`, each dropped and created whole from its latest
  definition (`post` from `0078_reply_passes.sql`; the build finds the others' latest), with their grants as before,
  calling `write_framed` after the Act is written. Nothing else in them changes.
- Tests first, in `supabase/tests/NNNN-framed.sql`: a post framing another player's debuted character writes one alert
  for its owner; an undebuted id, an unknown id, an id the body does not name, a staff character and the poster's own
  other mask write none; and in each of those the function's answer is identical to the same post with no `framing`;
  six ids write five; a repeated id writes one; `start_thread` and `spin` write it too; an edit writes none.

## Task 9: the framed alert, on the screens

Model: sonnet

Files: `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`, `web/src/data/supabase.ts`, their tests,
`engine/ui/composer/Composer.tsx` and the thread-start and spin composers (the build finds where `startThread` and `spin`
are called), `engine/ui/composer/text.ts`, `engine/ui/alerts/words.ts`, `engine/ui/alerts/toast-kinds.ts`, and the
settings screen that lists toast kinds.

- `framedIn(draft): Id[]`, in `text.ts`: the distinct `user` ids of the draft's counterfeits, at most 5, from `parse`.
- `post`, `startThread` and `spin` take `framing` and pass it; the fake writes the alert under the same rules as Task 8.
- `words.ts`: `case 'framed'`: the line "Someone put words in {name}'s mouth", detail and way as `quote`'s. It is a toast
  kind on by default, as `quote` is, and appears in the toast settings.
- Tests first: `framedIn` on a draft with two counterfeits, a repeat, a real quote and a hand-typed one; the composer
  sends `framing`; the fake writes and skips as Task 8's tests say; the alert's words and its toast.

## Task 10: quote heads and the counterfeit's look

Model: sonnet

Design section 1, and the mockup's variant A
(`docs/research/2026-11-07-bbcode/mock-counterfeit-quote.html`).

Files: `engine/ui/bbcode/render.tsx`, `render.test.tsx`, `bbcode.css`, `engine/ui/bbcode/Wobble.tsx` (new),
`engine/ui/thread/lines.tsx`, `engine/ui/thread/locate.tsx`, their tests, and every caller of `BbCode`'s `quoteLink` (the
build finds them: `Post.tsx`, the reveal posts, the profile and others).

- `BbCodeProps.quoteLink` becomes `quoteHead?: (q: QuoteOf) => ReactNode`, where `QuoteOf` is
  `{ kind: 'real'; act: Id } | { kind: 'counterfeit'; user: Id | null; name: string | null }`. With none given, a real
  quote's head says "Quoting an earlier post" and a counterfeit's shows its typed name and letter (or "Quote").
- `lines.tsx`'s `QuoteHead`: a real quote is `Byline` (linked) of the Act's author, then "Post #N" linked, from
  `useLocated` and the author from the Act loader's `Known.character`; a counterfeit is `Byline` unlinked of the
  `user`'s character, else of the typed name with no id.
- A character loader beside the Act loader in `locate.tsx`, batched per tick and bounded (`ACT_CACHE_SIZE`'s rule), over
  `api.characters(ids)`, so a page of quotes asks once. A character it cannot find is the typed-name fallback.
- The wobble: `Wobble.tsx` draws the SVG filter (`feTurbulence` and `feDisplacementMap`, the mockup's numbers) once, in a
  hidden `<svg>` the app frame mounts once, `id="kb-wobble"`; `.kb-quote[data-kb-counterfeit]` draws its border in a
  `::before` through `filter: url(#kb-wobble)`, as the mockup's `.fake-a` does. Under forced colors the border is a plain
  dashed one, so the difference still shows.
- Tests first: a real quote's head names the author and links both the profile and the post; a counterfeit's names the
  character, has no link and carries `data-kb-counterfeit`; an unknown `user` falls back to the typed name; one
  `characters` read for a page of ten quotes; the filter is in the DOM once with two posts on screen; axe clean.

## Task 11: the composer

Model: sonnet

Design section 5.

Files: `engine/ui/composer/text.ts`, `text.test.tsx`, `Toolbar.tsx`, `Editor.tsx`, `composer.css`,
`engine/ui/composer/QuoteSomeone.tsx` (new), `Composer.test.tsx`.

- `Tool` gains `spoiler` and `video`, each a pure edit in `applyTool` as the design says. `quoteSomeone(text, start,
  end, character: { id; name })` wraps the selection in `[quote=<name> user=<id>]…[/quote]` (the name quoted when it holds
  a space or `=`).
- Toolbar: Quote someone… (opens `QuoteSomeone`), Spoiler and Video, in the toolbar's one Tab stop.
- `QuoteSomeone`: a small board dialog (`engine/ui/modal.tsx`) holding the search build's board combobox over
  `suggest_characters`. Choosing one applies `quoteSomeone` as one undoable insertion (the box's `diffRange` path) and
  returns focus to the box; Escape closes it with nothing inserted.
- Shortcuts in `Editor.tsx`: Ctrl or Cmd with B, I, U and K apply bold, italic, underline and link, and prevent the
  browser's own.
- Paste to embed: on a paste whose text, trimmed, is one URL that `videoOf` recognizes or one https image address, the
  paste goes in as written and a polite status line under the box offers Embed and Keep as link. Embed wraps that URL in
  place, as one insertion, if it is still where it was pasted; the offer goes on the next edit.
- Tests first: each new tool's edit on a selection, an empty selection and a multi-line one; the dialog inserts the tag
  and Escape inserts nothing; each shortcut; a pasted YouTube link offers, Embed wraps it, typing dismisses it, and a
  pasted sentence offers nothing; axe clean with the offer showing and with the dialog open.

## Task 12: the board story and the shots

Model: sonnet

Files: `engine/ui/bbcode/Tags.board.stories.tsx` (new, as the other `*.board.stories.tsx` are), and shots in
`docs/research/2026-11-07-bbcode/`.

- One thread of posts that use every tag in this plan: a real quote, a counterfeit of a known character, a hand-typed one
  and a bare `[quote]`; both spoilers, shut and open; a YouTube box, a Vimeo box and an open player; each layout and effect
  tag; an autolink; the toolbar with the Quote someone… dialog open and a paste offer showing.
- Shots at 1440 and 390, light and dark, for the final review, and the board's a11y run over the story.

## Review focus

- The parser's safety argument with eleven new tags: every attribute checked before it is a node, every failed one text
  with its closer, `BLOCK` inside `[ispoiler]`, no input quadratic (two new raw tags, the autolink scan), `MAX_DEPTH`.
- Posts already written: any that holds `[spoiler]`, `[video]` or a URL as text now draws differently; the visible text,
  and so Autocorrect's matches, must change only where a new tag is now a tag, never because of auto-linking.
- The video player URLs: only an id checked against its provider's character set reaches a `src`; the CSP's `frame-src`
  is exactly `PLAYER_HOSTS`.
- The masks in `write_framed`: the answer and its timing the same for a real, an undebuted and an unknown id; the
  broadcast only through `write_alert`'s outbox.
- The marquee under reduced motion and on hover (WCAG 2.2.2), the rainbow and highlight inks' contrast, and the wobble
  under forced colors.
- The reindex in Task 7 on an instance that already holds posts: every post indexed once, inside one migration.
