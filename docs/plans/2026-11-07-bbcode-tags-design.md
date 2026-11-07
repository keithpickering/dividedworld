# BBCode tags: design

Record, written 2026-11-07. A design session with the owner, which started as a spike: which BBCode tags a 2003 board
would have that KayfaBB lacks, and what 2026 would do to make 2003 easier. Its plan is
`docs/plans/2026-11-07-bbcode-tags-plan.md`. Its mockup is
`docs/research/2026-11-07-bbcode/mock-counterfeit-quote.html`. Three issues were filed for what the session split off:
#299 (knockoff avatars for counterfeit quotes), #302 (smilies, weighed against the reaction set) and #303 (@mentions with
an autocomplete).

## 0. Where it starts

- **The parser** (`engine/bbcode/parse.ts`) turns a post into a tree of allowlisted nodes: `b i u s`, `color`,
  `size=1..7`, `url`, `img` (http or https), `quote=<Act id>`, `code` and `list` / `list=1`. Anything it does not cover
  stays in the tree as the text the player wrote ("The System acts; it never destroys what a player wrote"). It is one
  pass with an explicit stack, nesting capped at `MAX_DEPTH`, and no input makes it quadratic.
- **The renderer** (`engine/ui/bbcode/render.tsx`) draws exactly those node types, every string as a React text child.
- **The visible text** (`engine/bbcode/visible.ts`) is the post's own words in render order. Autocorrect matches phrases
  in it, on the server and on the screen, and the text layers (`engine/ui/bbcode/layers.tsx`) lay card effects over its
  offsets. A quote, code, a link and an image each stand in it as one `\n`.
- **The toolbar** (`engine/ui/composer/Toolbar.tsx`) has B, I, U, S, Link, Image, Quote (the last post shown), Code and
  List. `color` and `size` parse but have no button.
- **A quote names an Act and nothing else.** Its cite is "Post #38", linked (`QuoteLink`, `engine/ui/thread/lines.tsx`).
  It never names the author. `[quote=Name]`, the 2003 habit, is text.
- **A real quote alerts the quoted post's owner.** The composer passes the draft's first quote to `post()` as `quoting`
  (`firstQuote`, `engine/ui/composer/Composer.tsx`). `post()` stores it as the Act's `target_act_id`, springs the quoted
  post's traps, and calls `write_alert(..., 'quote', ...)` (last defined in `supabase/migrations/0078_reply_passes.sql`).
- **The CSP** (`web/headers.ts`, repeated in `netlify.toml`) allows images from any https host, by the owner's choice of
  2026-10-29, and no frames at all (`default-src 'self'`).

## 1. Counterfeit quotes

**Decided:** a quote may name a character and no post. It is a **counterfeit**: drawn as a copy of the real quote block
that is trying to pass, and is a little off. Fake quotes are classic forum trolling, and kayfabe is built for them.

- **The look is the wobble** (variant A of the mockup): the border is drawn through an SVG displacement filter, so its
  lines waver by a pixel or two, like a hand-traced copy. Weighed: a misregistered ghost border (B), a tilted clipping with
  a torn corner (C), a slightly wrong ink (D), and a soft wobble with a ghost (E, the session's recommendation). The owner
  chose A.
- **A real quote's head names its author:** the author's square avatar, their name linked to their profile, then the
  "Post #38" link. A counterfeit's head is the same shape: an avatar, and the name as plain text, never a link and never
  underlined. The links are the cue a screen reader hears, so a blind player spots a fake at the cost a sighted one does
  ("An accessible path costs what the obstacle costs").
- **The head is one shared component, a media object: the avatar and the name.** It replaces the three places the board
  draws a `Mini` beside a profile link by hand (`engine/ui/board/Board.tsx`, twice; `engine/ui/index/Index.tsx`, once),
  "The System" included.

### Syntax

| Written | Is |
|---|---|
| `[quote=<Act id>]` | A real quote, as today. The author comes from the Act. Every post already written keeps parsing this way, since an Act is never rewritten ("Append-only"). |
| `[quote=<Act id> user=<character id>]` | A real quote. `user=` is ignored: the author always comes from the post, so a real quote cannot pin one character's post on another. |
| `[quote=Geno user=<character id>]` | A counterfeit of that character: their current avatar and name. If the id does not resolve to a debuted character, the typed name with a letter avatar. |
| `[quote user=<character id>]` | The same, with no typed name to fall back on: "Someone". |
| `[quote=Geno]`, `[quote="Geno Wario"]` | A counterfeit typed by hand: the typed name, and the name's first letter for an avatar (what a character with no avatar shows). |
| `[quote]` | A counterfeit with no one named: the head says "Quote", with no avatar. |

The named attribute is phpBB 3's form (`[quote="Name" user_id=…]`). A typed name is plain text, at most 80 characters.

**Weighed for matching a counterfeit to a character:**
- **Fuzzy-match the typed name when the post is saved, and store the id.** Refused: it hides a guess (`[quote=Gen]`
  silently becomes Geno), it either rewrites the player's words or keeps a record beside the Act so the text no longer
  says what renders, and a name match that reached past debuted characters would prove a mask exists.
- **The id in the tag** (chosen, the owner's proposal). The text says exactly what renders. Renames behave as they do
  for a real quote, which also shows the author's current name. Names are unique across case and lookalikes
  (`supabase/migrations/0011_names.sql`), so one character is never two.

**The id is never typed by hand.** A toolbar tool, **Quote someone…**, opens the engine's one combobox
(`SearchCombobox`, `docs/plans/2026-11-07-search-design.md`, section 8) over debuted characters and inserts the tag
around the selection.

**Knockoff avatars** (a bootleg of the character's own avatar on a counterfeit, from an image model or a browser filter)
are #299.

### The framed alert

**Decided:** the character a counterfeit names gets a new written alert kind, `framed`, about the post that holds it.

- **It is not the `quote` alert.** That says "your post was quoted", which would be false. Alerts are out of character
  and never bluff ("The fiction may lie; the log never does").
- **The composer derives it from the draft**, as it derives `quoting`: the distinct `user=` ids of the draft's
  counterfeit quotes, at most 5, passed to `post()`, `start_thread()` and `spin()` as a new `framing uuid[]`.
- **The server writes one `framed` alert per id that is a debuted character and that the body names** (`user=<id>`
  appears in it), and skips every other id silently. No refusal, and nothing in the answer, differs with whether an id is
  real, debuted or anyone's. `write_alert` already skips a staff character and the acting account's own masks, and sends
  the owner's broadcast after the answer (`supabase/migrations/0058_alerts.sql`).
- **No trap springs.** A counterfeit has no post behind it for a trap to sit on.
- **An edit writes no `framed` alert**, as an edit writes no `quote` alert today.
- **Its line:** "Someone put words in {name}'s mouth", with the thread and post number as its detail and the post as its
  way, like `quote`'s. It is a toast kind, on by default as `quote` is. The owner approves the words in review.

Weighed: folding it into `quote` with other words (two events in one kind and one toast choice), and no alert (the framed
player may never notice).

### What counts as the post's words

A real quote's words are another post's and stay out of the visible text. **A counterfeit's words are the poster's own
and count.** Otherwise wrapping words in `[quote=Anyone]` would carry them past Autocorrect and every card that works on
words, a way around a game obstacle. So a card can land inside a counterfeit, which is one more way to tell it is fake.
That clue is the same for every player, and is accepted.

## 2. Spoilers

**Decided:** XenForo's pair.

- **`[spoiler]…[/spoiler]` and `[spoiler=Toggle text]…[/spoiler]`: a block.** Quote-styled, collapsed by default, built
  on `<details>`/`<summary>`. The toggle text is plain text, at most 80 characters, and defaults to "Spoiler" (also for an
  empty `[spoiler=]`). It holds anything a post can hold, other spoilers included.
- **`[ispoiler]…[/ispoiler]`: inline.** A black bar the width of its words, drawn as a `<button aria-expanded>`. Its
  accessible name is "Spoiler" while it is shut, and pressing it shows the words and shuts them again. It holds inline
  formatting only: a block tag opened inside it (a quote, code, a list, a spoiler, an alignment, `[hr]`, a video, a
  marquee) is text, which keeps the markup valid.
- **A spoiler's words count as the post's words**, for the same reason as a counterfeit's. Card runs land on them and
  show when the spoiler opens.
- **Opening a spoiler is the reader's alone.** No Act, no broadcast, no stored state.

Weighed: one `[spoiler]` that is inline or block by where it stands (harder to predict and to parse).

## 3. Video

**Decided:** `[video]URL[/video]`, with `[youtube]URL or id[/youtube]` accepted because old boards' YouTube mods used it.
The provider is read from the URL alone, by a pure table in the engine:

| Provider | Accepted | Played by |
|---|---|---|
| YouTube | `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`, `youtube.com/live/`, `t=` or `start=` as a start | `www.youtube-nocookie.com/embed/ID` |
| Vimeo | `vimeo.com/123` | `player.vimeo.com/video/123?dnt=1` |
| Twitch clips | `clips.twitch.tv/X`, `twitch.tv/*/clip/X` | `clips.twitch.tv/embed?clip=X&parent=<this host>` |
| Streamable | `streamable.com/X` | `streamable.com/e/X` |
| Niconico | `nicovideo.jp/watch/sm123` (and `nm`, `so`) | `embed.nicovideo.jp/watch/sm123` |
| SoundCloud | `soundcloud.com/artist/track` | `w.soundcloud.com/player/?url=…` |
| A file | an https URL whose path ends `.mp4` or `.webm` | a native `<video controls preload="none">` |

- **A URL no provider matches stays text**, the parser's rule for anything it does not cover.
- **Nothing third-party loads until the reader presses Play.** YouTube shows its thumbnail
  (`i.ytimg.com/vi/ID/hqdefault.jpg`, an address fixed by the id) behind a Play button. Every other provider shows a
  plain labeled box in the house style ("▶ Vimeo video: vimeo.com/123"), since finding their thumbnails needs an API
  call. Google sees who opened a thread with a YouTube video in it, the trade the owner already took for `[img]`.
  Weighed: a plain box for every provider, and thumbnails for all fetched by our server through oEmbed (a server job and
  outbound network access).
- **The player is a sandboxed iframe** (`allow-scripts allow-same-origin allow-presentation allow-popups`), lazy, with
  no referrer, at 16:9 (SoundCloud at its own height).
- **The CSP gains** `frame-src` for exactly the player hosts above and `media-src https:` for files.
- **Bluesky and X are out.** Their embeds need their own scripts, and `script-src 'self'` refuses them.
- **A video stands in the visible text as one `\n`**, as an image does.

## 4. The rest of the tags

**Decided, all in:**

| Tag | Is |
|---|---|
| `[center]`, `[left]`, `[right]` | A block aligned so. |
| `[hr]` | A rule. It has no closing tag. |
| `[sub]`, `[sup]` | Subscript, superscript. |
| `[font=Name]` | One of a fixed list: Verdana, Arial, Tahoma, Trebuchet MS, Georgia, Times New Roman, Courier New, Comic Sans MS, Impact. Anything else is text. |
| `[marquee]` | Scrolling text, a block. It pauses while hovered, and holds still under reduced motion (the system's, or the player's own `data-kb-motion`). |
| `[glow]`, `[glow=color]`, `[shadow]`, `[shadow=color]` | IE5's text filters in CSS: a blurred halo, an offset shadow. A color from `safeColor`'s list. |
| `[rainbow]` | Rainbow text, as a gradient clipped to the letters, so text layers still draw inside it. Its colors are one set for the light page and one for the dark, each readable on its own ground. |
| `[highlight]`, `[highlight=color]` | A highlighter behind the words, yellow by default. The words take black or white, whichever reads on that color. |
| `[noparse]…[/noparse]` | Its contents raw, as `[code]` takes them, drawn as plain text in the flow. Its words are the post's words. |

Every container among them is transparent to the visible text (its words count). `[hr]` stands as one `\n`.

**Auto-linking:** a bare `http://` or `https://` address in a post's text is drawn as a link. It is not inside a link,
an image, code, `[noparse]` or a video. Trailing punctuation (`.,;:!?` and a closing bracket with no opener in the
address) is left outside it, and the address passes `safeHref`. **It keeps its words in the visible text**, unlike a
written `[url]`, so no post already written changes where Autocorrect finds a phrase in it.

**Out of this design:** `[post=]`, `[thread=]` and `[roll=]` (the owner's choice); `[user=]`, which becomes an
@mention with an autocomplete (#303); smilies (#302).

## 5. The composer

- **The toolbar gains three buttons:** Quote someone… (section 1), Spoiler and Video.
  - **Spoiler:** a selection within one line is wrapped in `[ispoiler]`. Anything else, an empty selection included, is
    wrapped in `[spoiler=]…[/spoiler]` with the cursor waiting after `=` for the toggle text.
  - **Video:** a selected URL is wrapped in `[video]`; otherwise `[video][/video]` is inserted with the cursor inside.
  - Everything else stays typed, as a 2003 power user wrote it. Weighed: Color and Size buttons too, and Quote someone…
    alone.
- **Shortcuts in the box:** Ctrl+B, Ctrl+I, Ctrl+U and Ctrl+K (link), Cmd on a Mac, each the toolbar's own tool.
- **Paste to embed:** pasting a single URL that a video provider recognizes, or an https image address (a path ending
  `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp`), pastes it as written and then offers, in a line under the box, "Embed this
  video?" or "Show this image?" with Embed and Keep as link. Embed wraps the pasted URL in place as one undoable
  insertion. The offer is a polite status, reachable by keyboard, and goes away on the next edit or on Keep as link. It
  never converts anything by itself.

## 6. The layers, the masks, the ways out

- **Engine:** every tag, the provider table, the renderer, the composer tools, the alert. **Instance:** nothing. No
  instance names a provider, a font or a tag. The Divided World copy for the `framed` alert line is engine copy, as
  `quote`'s is.
- **The masks.** Nothing added reads a private fact. A counterfeit resolves its `user=` from public characters
  (debuted only). The `framed` alert's write is skipped silently for an id that is not a debuted character, so the
  answer is the same whatever the id; its broadcast follows `write_alert`'s existing rule. Opening a spoiler and pressing
  Play record nothing.
- **Ways out.** A shut spoiler opens on a press. A video that will not load is still its URL, shown in its box. A
  counterfeit is a post like any other, so an admin and the cards treat it as one.

## 7. Open

- **Real quotes can be doctored.** A real quote's words are whatever the quoter typed between the tags, and they stay
  out of the visible text, so editing a real quote's words is also a way past Autocorrect. That predates this design, and
  whether the renderer should compare a real quote's words with the post it names is a question for another session.
- **Does a video count toward what it costs to splat a post?** Images are #83's question; a video is the same one.
- **A BBCode help page,** the 2003 "BBCode is ON" link beside the reply box listing every tag. Not asked for here.
