# The 2003 board look: design

Record, written 2026-11-06. A design session with the owner, started from the owner's request to draw design boards for
the board world's screens as the backfill session drew them for the glass
(`docs/plans/2026-11-05-backfill-boards-design.md`), so a build session has an accurate reference. The owner: the board
should look "very quaint. But still well organized ... the best version of an old school forum", and asked whether the
house theme could be more period-accurate than "maximum simplicity", whether image buttons could be simulated with CSS,
and what support exists for themes beyond light and dark. This document is written in rounds as the session goes; the
plan follows once the screen boards are approved.

## 0. Where it starts

Shot on main (354dbc4) from the in-memory demo (`npx vite build web --mode e2e`), the index, a board, a thread and a
profile at 1440 and 390, light and dark. The critique:

- **Every rule is the same rule.** The outer frame, the column heads and the lines between rows are one 1px line in
  `--kb-rule`, so a table has no anchor.
- **Three things look identical.** The NEW chip, the avatar's letter box and Start a thread are each a black-bordered
  box; a control cannot be told from a label.
- **Rows do not alternate**, so a long thread list is a field of lines.
- **The page stops rather than ends**: nothing follows Who is online.
- **Dark mode is #fff on #000**, and its 1px rules shimmer at that edge.

What exists for themes: a theme is a stylesheet of `--kb-*` tokens only (`tools/check-theme.mjs`); an instance lists
its themes as `ThemeOption`s (`engine/ui/types.ts`), each with `modes` of both, light or dark; `ThemeRow`
(`engine/ui/account/appearanceRows.tsx`) appends every instance theme after the house's two; Divided World lists one
(`instances/divided-world/ui/index.ts`). The tokens (`engine/ui/tokens.css`) name about eleven chrome colors, so no
period skin can be written in them.

## 1. Round one: the look

The board `docs/research/2026-11-06-board-look/00-look.html` (published for the owner as an artifact) draws the index,
a board and a thread in each look, light and dark, with three button treatments, four tribute concepts and a sketch of
a theme picker on the glass.

1. **The house is Silver** (the owner, agreeing with the recommendation, over Strict). The house stays black and white
   with grays between: the page on a gray so the tables lift off it; the table drawn as `cellspacing="1"` draws it, the
   gaps in a mid gray as the grid; the column heads a dark gradient band with white text; the category a light gradient
   band; rows alternating between two grays and counts and post feet in a third; folder icons (new posts, none, busy,
   locked) in place of the NEW chip; a footer with "Powered by KayfaBB" and 80×15 badges whose words are true. Dark is
   charcoal (#141414 page, #262626 and #1f1f1f rows), text #e8e8e8. Color stays only on the game's pieces. PRODUCT.md's
   brand commitment "black and white" becomes "black, white and grays", which the owner approves in review of this
   design.
2. **Buttons are Chrome** (the owner, agreeing with the recommendation, over Bevel and Plain). New thread, Post reply,
   a post's Quote, Spin thread, Edit and History, and the composer's buttons are drawn as a 2003 Photoshop button: a
   gradient with a hard midline, a 1px stroke, an inner highlight, a soft drop shadow, lettering in bold lowercase
   Verdana with a glow. Each is real text in a real `<button>`: its accessible name keeps the copy's case, its contrast
   is measured on its face, it has a focus ring. A theme recolors it through tokens.
3. **Themes are part of this design** (the owner, agreeing with the recommendation). The token vocabulary grows to what
   a period skin needs (row grays, the head and category bands, the grid gap, the banner, the nav bar, links' hover,
   inputs, icons, the button faces; about twenty-five, each able to hold a gradient where it is a background); Settings'
   board row splits into a Theme picker of preview tiles, each drawn from that theme's own tokens read at build time,
   and a Mode row that a single-mode theme greys and explains; and tribute themes ship as Divided World's own theme
   files, named for how they look and using no other product's art. The tributes drawn as concepts in round one: Blue
   Steel (light), Midnight (dark), Hot Rod (dark), Fan Site (light).

4. **All four tributes ship** (the owner): Blue Steel, Midnight, Hot Rod and Fan Site are drawn properly and ship
   with the plan. The owner gave screenshots for two of them:
   - **Hot Rod** keeps round one's flames (the owner: "I like yours better") and takes its buttons from a red
     proto-MFGG ezboard: gray pillow-shaded GIFs, lit from the center and dark at every edge, black bold lettering in
     title case. So the button's background and case are tokens a theme sets, not only its gradient's four stops.
   - **Fan Site** becomes classic MFGG blue (the owner), from a 2008 Invision Power Board capture: a black page under a
     dim tiled navy pattern, royal-blue panels with pale-blue text, a teal sub-bar, yellow links in the nav, and the
     column heads in that board's texture, a navy gradient under a grid of small squares fading downward with cyan
     lettering spaced wide. It is dark only. The tile is drawn from plain shapes, never MFGG's sprite, and its name is
     open.
5. **Screen boards in the order a reader meets them** (the owner, agreeing with the recommendation), each batch at 1440
   with one phone board at 390, in Silver light and dark: 1. the index and a board; 2. a thread, the composer and New
   thread; 3. a profile and its record; 4. the standings and the reveal; 5. The System's profile and the move notice;
   6. the errors and Unavailable; 7. the theme picker.

## 2. Batch 1: the index and a board

Drawn on main (354dbc4)'s screens (`engine/ui/index/Index.tsx`, `engine/ui/board/Board.tsx`) in Silver, light and dark:
`docs/research/2026-11-06-board-look/01-index.html` and `-dark`, `02-board.html` and `-dark` at 1440 by 1000, and
`03-phone.html`, the four at 390 by 844 side by side, all written by `gen.mjs` in the token names this design proposes.
The boards draw only what the screens show; round one's mock had a locked thread and a "new posts" state on the index,
which the app does not have, and both are gone.

- **Folder icons on the thread list only.** A thread row's NEW and HOT chips become a folder icon, with four states from
  those two facts: new posts filled, none hollow, and either with a flame when the thread is hot
  (`settings.hotReplies` replies this week). Each icon carries its state as hidden text ("New, hot"). The owner: the
  first pixel icons "end up getting rendered at an arbitrary size and the pixel grid gets messed up. Also they are a bit
  more 1990 than 2003". So the icons are drawn as 2003 icon GIFs were, a few flat tones with a 1px outline and a
  highlight line (new posts a sheet in a dark folder, none an empty light one), as vectors drawn at their own viewBox's
  whole-pixel size with every stroke on a half pixel, so no icon is ever scaled. Their tones are theme tokens
  (`--kb-icon-ink`, `-back`, `-front`, `-new`, `-hi`, `-line`, `-hot`). The index draws no
  icon, because it has no state to show (`Index.tsx`: a board's unread count would need a read of every thread).
- **A legend** under the thread list names the icons, in plain words: "Hot: 10 replies this week" takes its number from
  the setting, and is a draft for the owner's review. The pin is not in it (the owner: a mark in the legend "is a bit of
  an antipattern (pressing it gives this info regardless, and it's intermingling with the board world in a sort of
  illusion-breaking way)"); the board's key speaks only of the board's own things.
- **A character's mini avatar and name are one unit**, the box centered on the name's capitals rather than its line box,
  which in Verdana holds more room under the capitals than over them (2px at these sizes in the boards, which render a
  Verdana substitute; the build measures it on Verdana itself). The owner found the first boards' avatars misaligned.
- **No category bar.** Divided World's boards are not grouped; the light band heads real sections only (Who is online,
  Users browsing this board), each an `h2`.
- **The banner and the boards' bar are one block**, the logo on the light gradient and the board links on the dark bar.
- **Pinned threads are a group of their own** above the rest, split by a 4px row in the third gray; the pin's mark keeps
  the glass's cyan, as a card's mark is a game piece.
- **Counts sit in the third gray** with tabular figures.
- **A footer ends every board page**: "Powered by KayfaBB" and three 80×15 badges reading GAME ON, MASKS ON and KILTER
  OFF (the owner's words), hidden from assistive tech. It links nothing on the glass: every way into the glass is the HUD's.
- **On the phone a row's counts fold into one line** ("169 replies · 4 views · last: Pipewrench, Oct 5"), where today
  each takes a line and a phone shows two and a half threads; the index folds the same way, and a date never breaks.
  Boards is a Chrome button in the banner.

**Batch 1 approved by the owner** ("Looks great, approved"), after the nits above.

## 3. Batch 2: a thread, the reply box, Start a thread

Drawn on main (354dbc4)'s screens (`engine/ui/thread/Thread.tsx` and `Post.tsx`, `engine/ui/composer/Composer.tsx` and
`Editor.tsx`, `engine/ui/board/NewThread.tsx`) in Silver: `04-thread` (page 3 of "who keeps splatting my posts", the
Main board's thread, with Pipewrench on the HUD), `05-reply` (the same thread scrolled to its foot), `06-new-thread`
(General with Start a thread open), each light and dark at 1440 by 1000, and `07-phone`. The game's pieces on the thread
(the reactions, the Whoops! mark, its ink) are drawn for place and keep their own look; Whoops!'s ink is held by its own
boards and `e2e/whoops.spec.ts`.

- **The crumb names the board** (Index › General › the thread). `Thread.tsx` draws Index › the thread today, though
  `ThreadSummary.board` names it.
- **A post is three cells of one color**: the post line, the words, the actions, ruled edge to edge by the table's 1px
  grid, with posts alternating between the two row grays and split by a 4px spacer row of the third. The owner, on the
  first draw: keep "the full 'cell' for the row with the datetime and post number, I.e. a border from edge to edge.
  Provides a better backing for Marks", and give it and the actions' row "the same bg color as the post content itself.
  Right now the post options are drawing attention away from the post content". The actions are small Chrome buttons;
  today they are underlined links at the body's weight.
- **Reactions are drawn as marks are** (the owner: "in another in-progress build, reactions are becoming Mark-styled ...
  Let's make our designs align with that"): a skewed glass tile with a lavender edge, the emoji and a Barlow Condensed
  count, as that build draws them. The Whoops! mark is drawn at the same tile size, 32px tall, so the post line's band
  holds both kinds of piece. Both stay game pieces: no theme token reaches them.
- **The pager's current page is a small band** in the column head's gradient.
- **Send and Start thread are the one primary button** of their form: Chrome on the column head's dark gradient, larger
  than Preview and Reveal…, which today stand at the same weight.
- **Unfollow this thread shares the bottom pager's row**, at its right.
- **The text box is inset** under a 1px inner shadow (`--kb-input-bg`, `--kb-input-edge`, `--kb-input-shadow`).
- **Start a thread stays pressed in** while its form is open, an inset Chrome button, where today it inverts.
- **On the phone** the postbit is a band over its post (the avatar at its left, the name, rank and pips beside it), the
  nine formatting buttons fit one row, the reply box drops the keyboard hint, and a date in the current year drops its
  year, as batch 1's thread list does.
- **Kept as built:** the postbit's order and sizes, the Author and Message heads. `e2e/boards/01-main.ts` compares this
  thread's board-world type and places today; the plan moves those landmarks to this batch's manifests, and 01-main
  keeps the HUD, the hand and the game's pieces.

Decided with the owner ("Agreed with your recommendations on 1 and 2"):
- **New thread uses the shared editor.** `NewThread.tsx` draws a bare textarea, with no toolbar, no Preview and no
  Ctrl+Enter, where a reply and an edit share `Editor.tsx`; the first post takes `Editor.tsx`, since a first post is a
  post. Its hint reads "Ctrl+Enter or Command+Enter starts it".
- **The phone postbit drops Posts and Joined**, which the profile carries a tap away.

**Batch 2 approved by the owner** ("Looking good, approved"), after the nits above.

## 4. Batch 3: a profile and its record

Drawn on main (354dbc4)'s `engine/ui/profile/Profile.tsx` and `Record.tsx` in Silver: `08-profile` (Spritey, with a
title, a settled standing, a revealed class and a signature) and `09-record`, light and dark at 1440 by 1000, and
`10-phone`.

- **The profile's facts are a table of labels and values**: Title, Rank, Aura this season, Place, Posts, Threads spun,
  Cards played, Joined, Class, each a row with its label (a row header) in the third gray, right-aligned and bold. Today
  they run on three lines joined by middots, and the 1:2 avatar leaves most of the card empty beside them. Every fact's
  wording and link is kept; the character's own title line gains the label "Title" (the owner: "'Title' is fine").
- **The signature closes the card** under a short rule.
- **The profile's record has its band and its heads in one table**, five rows, then See the full record at its right.
- **The record's kind filter is a row of small Chrome buttons**, the current one pressed in, where today it is a row of
  bare links with the current one bold.
- **On the phone** the profile leads with the avatar beside the rank and title, then the facts as a two-column table and
  the signature; a record row's date stacks above it (today the When column breaks every date in two), and the six
  kinds fit one row.
- **The trophy case.** The owner, approving the batch: "we have a plan for trophy cosmetics which adds a 'trophy case' to
  this page ... make sure our design accounts for the ability to display those cosmetics". That is
  `docs/plans/2026-11-04-cosmetics-plan.md`, Task 10 (its design's section 4, its board
  `docs/research/2026-11-04-cosmetics/03-trophy-case.html`), not built yet. `08-profile` is drawn whole at 1440 by 1700
  with what that task adds, in Silver, on the cosmetics boards' placeholder art (`art.svg`, inlined):
  - the portrait wearing its gear, the cap reaching above the slot as `gear.reach` allows, and a **Wearing** row naming
    each piece in words;
  - the **trophy case** as its own table under the card: a light band with the count, each trophy's badge in a cell of
    its own, its name and line, who gave it and when in plain words with a link to its post or move, and an On posts
    column (a held belt always shows);
  - each **belt's lineage**: holder, reign, and whose move gave it.

  The badges are trophy art and keep their own colors, as the game's pieces do. On the phone (`10-phone`, its second
  screen) the case folds On posts under each row's line and the lineage to one cell per reign. The cosmetics plan's
  Task 10 takes its profile's look from `08-profile`, and its board 03 stays the record of what the case holds; its
  postbit's badges (board 01) sit under the rank in the house's tokens and change nothing in batch 2.

**Batch 3 approved by the owner** ("This is good, approved"), with the trophy case added after.

## 5. The batches, corrected

Round one's batch list named "the standings" as a board page. It is not one any more: `/standings` moves to the glass's
Rankings (`web/src/App.tsx`, `MovedToRankings`; the two-worlds design's section 7), and the season's public standings
are read on The System's reveal and tally posts. So batches 4 and 5 are one: **The System on the board**, its reveal and
tally posts (`engine/ui/reveal/Reveal.tsx`), the move notice (`engine/ui/board/MoveNotice.tsx`) and its profile
(`engine/ui/profile/Staff.tsx`). Then the errors and Unavailable, then the theme picker.

## 6. Batch 4: The System on the board

Drawn on main (354dbc4)'s `engine/ui/board/MoveNotice.tsx`, `engine/ui/reveal/Reveal.tsx` and `engine/ui/profile/Staff.tsx`,
on their stories' content (shot from Storybook), in Silver: `11-move-notice`, `12-reveal`, `13-tally`, `14-staff`, light
and dark at 1440 by 1000, and `15-phone`. The two voices stay where they are: The System's and the Director's words in
character, the glass label, the moderation log and the notes plain. The boards give each the house's frame and change no
word of either.

- **The move notice is a period announcement**: a light band reading "Announcement from The Director", the words under
  it, its top reactions as mark tiles. The glass label (the move's long label, and Way out, the button that opens the
  overlay) stays on its corner, breaking the frame as a card's mark does; on the phone each segment keeps its words
  whole and Way out wraps under the label when the row is full.
- **The System's posts take batch 2's post frame**: three cells of one color, alternating, with Quote, Spin thread and
  History; its postbit is its name alone. The reveal's class bar keeps its game-piece look (each class's color with its
  pattern, one equal segment per statement) with its words listed under it, and a character whose player made nothing
  public says so. The tally lists who debuts and who has Turned under The System's words.
- **On The System's board the composer's place holds its note** ("Replies here are spins. …", `SystemBoardNote`) in a
  banded cell.
- **A staff profile takes batch 3's card**: its badges, title, interests, favorite members, mood and career as label
  rows beside the avatar, where today they are a small nested table and Career a heading floating between card and log;
  the plain note stays under the signature; the moderation log is one full-width table under the card (When, What it
  did, How it ended), where today it is a narrow column beside it.

## 7. Who speaks: "The System" leaves the copy

The owner, after batch 4: the lore now has two voices, "the developer persona (Gabe) who speaks about the metagame openly,
and personality cores who 'work as the staff', I.e. act as the game's NPCs", and "The System is the underlying process
behind all of the llm-powered content, but I don't know what role it plays in the actual copy anymore ... these posts
would more fittingly come from the current Boss". Folded into this design and its plan (the owner: "Let's fold the copy
into this plan").

What already stood: a move is signed by the staff member who made it (the move notice, the Boss's arrival, farewell and
announcements, its moderation log); the season's reveal and the settlements' tallies were "not the Boss's"
(`docs/plans/2026-10-31-seasonal-boss-design.md`, section 1) and moved to the glass's Season › News, their threads
unlisted (`docs/plans/2026-11-02-alerts-design.md`, section 7; `supabase/migrations/0063_season_news.sql`); the forum is
never without a Boss (succession), and a defeat is the finale's design, not yet made. Gabe cannot sign a board post:
CLAUDE.md gives the developer persona to the glass alone, always true and written only by admins, never by a model, and
the alerts design's line holds ("the board never names a mechanic; the glass never speaks in character").

**Decided:**

1. **"The System" is the engine's name for the process, never a voice in a player's copy.** It stays in the code, the
   documents and the admin screens (Queue's "The System's moves", which admins read as the machinery it is).
2. **On the board every post is signed by a staff character.** The season's reveal and each settlement's tally are
   signed by the season's Boss (the owner chose the recommendation), the reveal by the outgoing Boss as part of its
   handover. The post opens with one line in the Boss's voice, in character, which may gloat or bluff; the list under it
   (debuts, Turns, places, ranks, figures, the classes each player made public) is the engine's and exact, so nothing
   true is ever the Boss's to change. The line comes from the Boss's roster entry (stock lines, the instance's content),
   so a settlement never waits on a model and an instance with The System switched off still signs it. Should the
   finale ever open a gap with no Boss, the season's Mod Bot signs, or the post waits for the arriving Boss; never Gabe.
   Acts already written with no character are never edited (CLAUDE.md, Append-only): they show the instance's word for
   the staff as their author.
3. **The board where only the staff post is Staff Announcements** (the owner, over "The Front Office"): Divided World's
   board content becomes the name "Staff Announcements", the description "Where the staff post. Reply by spinning a
   thread.", and the index's tag "Staff post here; you react and spin". General's description becomes "Anything and
   everything. The staff are watching." (drafts for the owner's review with the plan).
4. **The glass's plain voice names who acted, or the game.** Where a staff member acted, the glass names it: the move's
   label reads "The Director renamed this board" (the move's actor, from the data), Season News quotes the Boss's first
   words "on Staff Announcements" (the board's name, from the data). Where a mechanic acted, the glass says "the game":
   "The game paid you 0.35 Aura", "checked by the game". Debut and Turn copy says the Boss posts the announcement, by the
   instance's word for the role.
5. **The engine never names the instance.** Every string above that names a role, the staff, or the staff's board comes
   from the instance's copy (`InstanceUi.copy`) or the board's own data, and the strings that today hard-code "The
   System" in `engine/ui/` (the index, board, thread, post, move notice, spin origin, character previews and footers,
   the debut and Turn dialogs, the log's lines and the settlement page, Season News) move to it. The plan lists each.

The boards follow: the nav and the index name Staff Announcements; `11-move-notice`'s label names the Director;
`12-reveal` and `13-tally` are signed by the Director with a staff postbit (its name, its badges, its title, its avatar,
no rank, since staff are not scored), the reveal opening with its farewell line.

The masks: a Boss signing a post reads no private fact; the list it carries is the same public record the reveal and
tally hold today.

## Open

- Fan Site's name, now that it salutes one board's blue.
- The legend's words.
- Batch 4's approval.
