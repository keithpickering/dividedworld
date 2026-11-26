Record, written 2026-11-26.

Amended 2026-11-26 with the owner, after it merged and before it was built: a ban's and a group move's appeal rulings post
too, and each season has a Banlist thread (section 8). Sections 3 and 9 to 12 are changed to match; the rest stands.

# A Mod's outcome is a post in the thread: design

A design session with the owner, from `main` at 96cf4f8e (PR #1191 merged). Its plan is
`docs/plans/2026-11-26-outcome-posts-plan.md`. It amends `docs/plans/2026-11-24-concession-post-design.md` (sections
1 and 4: when the concession is written and what it reads) and section 7's first left-out item ("A filed visit's line
in the thread"), which are left as they read. World: the board for the posts, the glass for the Lens and the marks.

## 1. What the owner asked

After #1191 the owner asked whether the concession pool was only a fallback ("my understanding was that these would
only be fallbacks, and that a model call would write the concession based on context normally"), and set the goal:
"the true goal here is to bridge the gap between the staff member as a game enemy and the staff member as a poster. A
visit by the mod demonstrates interest in the thread, and whether they are talked down or not, the outcome of the
visit makes sense as a post quoting the visited one: a post that appears to truly understand the situation. The
outcome can be celebrated or argued about among the characters and the staff."

What #1191 built: the pool is the fallback, but the concession is written when the visit opens, before anyone talks
the Mod down, from the visited post, the title and the charge alone. A quiz Mod's concession does not know which way
out was taken; none knows who took it (a `{who}` slot is filled later) or what the thread said. A filed visit's line,
already model-written from the thread, stays on the visit in the Lens and never reaches the thread. An appeal ruling's
line is the same. Every visit pays a concession call, and most file and never use it.

The owner on cost: "Generating it before was an attempt to save money for queries that are already almost negligible
in cost, and the quality will suffer as a result."

## 2. Decided: each outcome is written after it happens

The owner chose A, of:

- **A. After the outcome (chosen).** A talk-down's concession is written by the next staff run (every five minutes,
  `modBots.filingCron`), knowing who did it, how, and what the thread says; the stock line stands in past
  `concessionWriteMinutes`. A filing posts its filing line, as written today at filing time. An appeal ruling posts its
  line when the appeal is judged. The few minutes between a talk-down and its reply read as a staff member typing one.
- **B. Ahead, both outcomes in one opening call.** Instant, but blind, and it would replace the filing call, which
  already reads the thread at filing time, with a worse-informed one.
- **C. Keep #1191's concession and only move the filing into the thread.** Closes the filing gap, keeps the blind
  concession.

Measured on the price table (`supabase/functions/_shared/models/prices.ts`, Haiku 5.5 at $0.10 a million input
tokens and $0.50 output): a call that reads the thread is about 10k tokens in and at most about 1,000 out, about
$0.0015. At `concessionsPerDay` (60) that is under $0.10 a day. The filing and the appeal calls exist already. A
concession is now paid only for a talk-down, so the day's concession calls fall.

## 3. Decided: the three outcomes post, and nothing else

The owner chose A, of:

- **A. The filing, the concession and the appeal ruling (chosen).** Each closes a story the thread watched, one Mod
  post per outcome. The arrival stays the visit's mark: the Mod's interest shows without a post saying it came. A
  report's verdict stays in the Lens: it is about the reporter, and a backfire becomes a visit with its own outcome.
- **B. Every Mod line, the arrival and the report verdicts too.** Two posts a visit, and an arrival post crowds a busy
  thread with what the mark already shows.
- **C. A and the report verdicts.** A dismissal's grumble posts about a report into a thread that may not have known of it.

**The appeal's plea stays where it is**, a public Act made from the Lens. It cannot be a post: a character appealing a
board ban cannot post on that board. The ruling's post quotes the punished post and answers the plea in its words.

**An appeal with no post** (a ban, which a full warn bar makes, and a group move) has no post of its own to quote. As
first written its ruling stayed an Act in the Lens and the log; the owner's review closed that gap, and section 8 says
where each of them posts: a group move's ruling in the move's own thread, quoting the move, and a ban's in the
season's Banlist thread, quoting the ban's entry there.

## 4. Decided: one Act, reachable from both the Lens and the thread

The owner chose A, of:

- **A. The outcome post carries the visit's mark, and the Lens row is the post (chosen).** The Mod's outcome post
  carries the same visit mark as the visited post, opening the same Lens tab with the same "How it went", so a reader
  landing on either post sees the whole story. The mark's accessible name says which post it is on ("The Clerk's visit
  to the post this answers was filed. Opens the visit."). In the Lens, the outcome's row is the post: its React and
  Spin thread act on the post Act itself, it shows the post's opening words, and Go to post jumps to it. The Lens and
  the thread cannot split a post's reactions or its spun threads. An appeal ruling's post carries the mark of the
  visit its punishment came from. The owner: "Posting becomes the game, as it normally is between players, and the
  marks/lens stays a way to navigate it."
- **B. Links only.** The Lens links the post and the post's quote links back; a reader of the Mod's post goes back a
  step to see the story, and the row's React and Spin stay a second Act.
- **C. A, with the second mark drawn differently.** A visual variant of the stopwatch; not asked for.

The outcome post does not show the board's violation notice: that notice is about the visited post.

## 5. Decided: the call reads the thread, as the filing does

The owner chose A, of:

- **A. One shared read, and each outcome's own facts (chosen).** Every outcome call reads what the filing reads today:
  the thread as readers see it, fitted to the budget, and the Mod's memory, career and notes (`modPrompt`). Then its own
  facts. A concession: who talked it down, how, and for a quiz the question, its choices and the answer given; for a
  bribe the price; for a distraction the card cast. A filing: the charge and what landed. An appeal: what it reads
  today, and the verdict.
- **B. A, and the interceptor's or appellant's own recent posts elsewhere.** Wider per call, and it overlaps the Mod's memory.
- **C. The visited post and a few around it.** Cheaper, and it cannot speak to the thread's mood, which is the point.

## 6. Decided: an outcome post is a post, bounded like the Mod's other posts

The owner chose A, of:

- **A. Written as a post (chosen).** Line breaks allowed, at most `min(postMaxLength, 2000)` characters (the chatter
  bound, `CHATTER_WORDS_MOST`), cut at a sentence when over, never refused for length. The prompt asks for a reply
  sized to what happened, in the persona's voice. The Lens row shows the post. A persona on the old voice writes one
  line, as its chatter does. The stock lines stay one-liners. The owner: "A solves the exact inconsistency I noticed."
- **B. 280 characters.** A Lens row's size, not a reply's.
- **C. About 600.** A third bound beside the two the code has.

## 7. Decided: nothing shows between a talk-down and its post

The owner chose A, of: **nothing (chosen)**, the row reads "Talked down" and the post appears when it lands; or "{mod}
is writing a reply…" on the row, a public state of its own.

## 8. Decided: the Banlist, and the group move's ruling

Added after the design merged. Reviewing section 3's gap, the owner asked: "if it's not too much more complicated,
amazing opportunity to have a 'Season N Banlist' thread in Staff Announcements. Group move appeal: should this post
somewhere too? Seems somewhat less important". The owner then agreed to each recommendation below.

**What is on `main`.** The only appealable punishments are an infraction, a ban and a group move (`open_appeal`,
`0135_group_appeals.sql`: a `conferGroup` move whose group's tone is `punishment`). A `ban` Act is written in one
place, `infract` (`0361_discipline_cards.sql`; `acts_warn_guard` refuses any other writer), when an infraction fills
the character's warn bar. `infract` is called by `file_visit` (a filing) and by `close_appeal` (an `increased` ruling
on an infraction). So every ban follows a Mod's infraction, its payload names that infraction (`infraction_act`), and
the infraction names the post that tipped the bar (`about_act`) and the Mod (`staff`). No admin ban, permaban or ban
made as a move exists; section 3 was wrong to name one. A ban's appeal is heard by the Boss, else the Mod on the board's beat
(`appeal_hearer`, `0135_group_appeals.sql`), a group move's by the staff member who made it, else the Boss. Since the per-move threads
(`0437_move_threads.sql`, the staff-board threads design, section 6) a landed move's Act is a post in a staff thread of
its own, and the appeal and its ruling are written with the move Act's thread (`open_appeal` writes the appeal in
`pun.thread`, `close_appeal` the ruling in the appeal's); the ruling takes no seq, so it shows in no thread today.

**A group move's ruling posts in the move's thread (chosen).** The hearer's ruling is an outcome post in the move
Act's thread (`acts.thread` of the move; no table records it apart), quoting the move Act, through the same
`post_outcome` path as an infraction's. It answers the plea in the move's own story, where the move's keep and end are.
A move whose thread is not a staff thread (one that landed in the old announcements thread before `0437`, an archive
that takes no new Act) posts nothing. A ruling that ends its move (overturned, or reduced to an end already past)
says the end itself: the move's end line (`say_move_end`'s owed `moveOverturned` or `moveExpired`) is not owed when
the ruling posted, so one decision is one post; when the ruling's post is refused, the end line is owed as today.
Weighed: the ruling as an Act alone, as first written (a reader of the move's thread never learns its appeal was
heard).

**A Banlist thread for each season, on the staff board (chosen, A).** The season's Banlist is a thread on the system
board (Divided World's Staff Announcements), titled by the instance's copy ("Season {season}: Banlist"), one for each
season, opened when the season's first ban posts its entry, as the season's Roster Report (`seasons.turns_thread`,
`promos_thread` in `0100_announce.sql`) and Staff Meetings thread (`seasons.meetings_thread`, `meetings_thread` in
`0439_minutes.sql`) are opened at their first use and never at the season's start; a season with no ban has no
Banlist. It follows the system board's flag as those two do. Every ban posts an entry there when it lands, and that
ban's appeal ruling is an outcome post in the Banlist, quoting the entry. A ban is a season's story: the Banlist reads
as the season's record of who fell, and an appeal that wins is celebrated, or argued about, under the entry it undid.
The weighed:

- **A. Every ban's entry, and its ruling replying to it (chosen).**
- **B. Only the rulings post there.** A ruling would answer a ban the thread never showed, and the season's bans would
  be found only in the log of each banned character.

The thread of the post that tipped the bar was also weighed for the ruling: it was watching the visit, not the bar,
and the visit's own filing has already posted there.

**The entry is the Mod's, a line of fact and a line in its voice (chosen, 2A).** The entry is posted by the Mod whose
infraction filled the bar (the infraction's `staff`), as its staff character. Its first line is built by code from
the ban: "Banned: {character}, {days} days, {rule}", the words the instance's copy (its `banlistEntry`), with a link
to the post that tipped the bar. Its second is a short line in the persona's voice, written by a model call that
reads what an outcome call reads (section 5: the thread of the post that tipped the bar as readers see it, and the
Mod's memory, career and notes), then the ban's facts; it falls back to a stock line from the persona's own set (a new
stock line key, `banEntry`), as the filing falls back to `visitFiled`. The code line never bluffs: its character, days
and rule are the ban's own, as the log's are ("The fiction may lie; the log never does"); only the second line is in
character. Weighed:

- **2B. The code line alone.** True and dry: the Banlist would read as a log, and the Mod would be a stamp, not a
  poster, which is what this design exists to undo.
- **2C. The model's free text alone.** The ban's character, length and rule, which the code holds, would be the
  model's to state, and the one post that announces a ban could misstate them beside the log's plain account.

**The persona line is written by the staff run after the ban (chosen).** A ban is written inside SQL, by `infract`,
inside the filing's or the ruling's transaction, so no model call can be made there. `infract` records the entry as
owed (a `bans_owed` row, the twin of `concessions_owed`), and the next staff run writes the persona line and posts the
entry; past `owedLines.graceMinutes` the tick posts it with the stock line, whatever The System's switch says, as it
posts a concession's. A ban appealed and ruled before its entry
has posted (the appeal is heard at once, by the player's request) has its entry posted first, from stock, in the
ruling's transaction, so a ruling always has its entry to quote. Weighed: the code line posted at once by `infract`'s
callers and the persona line as a second post by the run (two posts for one ban); the code line at once and the
persona line added later by an edit (an edit Act on the Mod's own post a minute old reads as a correction).

**The budget is the owed lines' (chosen).** A ban's entry is a line owed for an act that has happened, which is what
`owedLines` bounds (`0445_persona_lines.sql`: `graceMinutes`, `perDay`, `perRun`; Divided World's 15, 60 and 20). Its
calls are counted with the owed lines' (`standing_order_line_calls_today`) against `owedLines.perDay`, at most
`owedLines.perRun` a run, and the stock follows past `owedLines.graceMinutes`. No setting is added. Weighed: the
filing's `filingLinesPerDay`, which a ban would take from the filings it follows; a `banEntriesPerDay` of its own, a
setting for a call that is at most one for each full bar.

**These posts carry no visit mark.** Section 4's mark opens a visit and says the post "answers" the visited post. A
ban's entry answers no visited post, a ban's ruling is about the bar and not one visit, and a group move came from
no visit; the Lens's visit holds only its own infraction's appeal (`thread_page`'s visit JSON). The entry links the post
that tipped the bar, which carries its own visit's mark, and a ruling quotes what it answers. The Lens and the marks
are unchanged by this section.

**No backfill (3).** A ban written before this change owes no entry, and its appeal's ruling, heard after, posts
nothing: it has no entry to quote, and an entry dated today for an old ban would misdate it. A move's appeal ruled
after this change posts in the move's thread whenever the move landed, since the move's post is there and the
outcome is new. Nothing is posted for a ruling made before this change.

## 9. Decided: the defaults the owner accepted

- **No backfill.** Visits and appeals that ended before this change keep their lines as they are, and nothing is posted
  for them. A post dated today for an old outcome would misdate it. The posts #1191 made are carried into the new
  record of outcome posts, so the Lens shows them as rows like the new ones. A ban written before this change owes no
  entry, and its ruling posts nothing (section 8).
- **Budgets.** The concession keeps `concessionsPerDay` and `concessionWriteMinutes` (now counted from the talk-down),
  and the quiz call writes only its question again. Filings stay under `filingLinesPerDay`, appeals under the
  `judgmentsPerDay` check `open_appeal` makes. A ban's entry is an owed line, under `owedLines` (`perDay`, `perRun`,
  `graceMinutes`), counted with the owed lines' calls (section 8). No setting is added.
- **A wrong quiz answer posts nothing**; it is still only a tail. **A failed appeal judge posts nothing**; it is refunded
  and the appeal stays available, as today.
- **Best effort.** A refused post (the Mod's character benched, gone, locked out of the thread) leaves the outcome
  standing and is recorded for an admin, unseen by any player; the Lens row then shows the line, with no link. A ban
  whose entry was refused still bans; its ruling then posts in the Banlist quoting nothing. An instance whose copy has
  no Banlist title posts no entries and no ban rulings, as one with no Staff Meetings title posts no minutes.

## 10. How it works

- **The line and the post.** The visit's end Act and the appeal's ruling Act keep their `line`, now the whole text the
  Mod wrote (the Act is the record of the outcome, and the line is what the Lens shows if the post was refused). The
  post's body is that text. A filing and a ruling post at once, in the same transaction as their outcome, inside their
  own exception block. A concession posts when the staff run writes it, or as the stock past the window. An infraction's
  ruling posts in the punished post's thread, quoting it; a group move's in the move's thread, quoting the move; a
  ban's in its season's Banlist, quoting its entry.
- **One record of outcome posts.** A row per outcome (a visit's end, an appeal's ruling, or a ban's entry), written
  once, naming the post or the refusal. It is the one-post guard for all of them, and the page reads it to put the
  visit's mark on the outcome post (only an outcome with a visit has one). #1191's `visit_concession_posts` rows are
  copied into it; its tables stay as written, no longer used.
- **A talk-down owes a concession.** The talk-down writes a row saying a concession is owed, by whom it was talked down
  and how. The staff run reads the owed rows without a post, oldest first, writes the concession and posts it. The tick
  posts the stock past the window. The interceptor is already public (the `intercept` Act names it).
- **A ban owes its entry.** `infract`, the one writer of a ban, writes a row saying the ban's entry is owed by the Mod
  whose infraction filled the bar. The staff run reads the owed rows without a post, oldest first, writes the persona
  line and posts the entry: the code line (the instance's `banlistEntry`, its character, days, rule and link filled
  from the ban), then the line. The tick posts the entry with a stock `banEntry` line past `owedLines.graceMinutes`,
  and `close_appeal` posts it from stock before a ruling on a ban whose entry is still owed. The season's Banlist is
  opened by the first entry's post, under the season's row lock, inside that post's own exception block, so a refused
  first entry leaves no empty thread.
- **The page.** A thread page's visits say, for each visit, its outcome posts on that page, and the page includes a
  visit whose outcome post is on it even when the visited post is on another page.

## 11. Layers, masks, ways out, scale

- **Layers.** Engine: the prompts and repairs, the tables, the posting, the page read, the marks and the Lens, the
  Banlist thread and its entry's code line. The instance supplies its words for the Banlist: the thread's title
  (`copy.banlistThreadTitle`, with `{season}`), the entry's line (`copy.banlistEntry`, with `{character}`, `{days}`,
  `{rule}` and `{post}`), and each persona's `banEntry` stock lines. Otherwise its personas' stock lines and
  `concessions` stand as the fallbacks they are.
- **Masks.** Every call reads only what readers see. A post names a character, never an account: the Mod's, and for a
  concession the interceptor's, which its own public Act names. When a post lands depends on the outcome and the staff
  run's clock, never on who owns any character. Whether it lands depends only on the Mod's character. The refusal
  record never reaches a client. A ban's entry names the banned character, never an account, and nothing in it is
  computed from who owns a character: its days are the character's own ladder (its bans this season, public Acts),
  its rule the infraction's, its link a public post, and it is posted when the ban lands and the run comes, whoever
  plays the banned character. A player with several banned masks has several entries that say nothing of one another.
- **Ways out.** No state a player can be put in is added. An owed concession is not shown; it ends by itself as a post,
  the model's or the stock, within `concessionWriteMinutes` and a tick. An owed ban entry is not shown either, and ends
  the same way within `owedLines.graceMinutes` and a tick, or at the ban's ruling. The ban's own ways out (its end, an
  appeal) are as they were. The Banlist is read-only to players as every thread on the system board is; a player
  answers an entry by spinning a thread from it.
- **Scale.** One row per outcome; a visit has at most one end and a punishment one appeal. The staff run reads owed
  concessions by an index, at most `concessionsPerDay` calls. The page's join from outcome posts to visits is by the
  post's id, indexed, over the page's own posts. The Banlist is one thread a season, holding one entry for each ban and
  at most one ruling under it; it is paged like any thread (Divided World's 20 posts a page), and a busy season's long
  Banlist costs a page read what any long thread does. A ban's entry is one owed row, read by an index on its time, at
  most `owedLines.perRun` a run and `owedLines.perDay` a day, the tick's stock pass bounded as the owed lines' grace
  is. Opening the thread takes the season's row lock once a season.

## 12. Left out, and open

- **A report's verdicts in the thread** (section 3, C), and the arrival as a post (section 3, B).
- **The log** stays Act-based: its visit and appeal rows name the Acts, as "The fiction may lie; the log never does"
  asks. Whether a log row should also link the outcome post is its own change.
- **A quote trap or a No quote on the visited post** applies to the outcome post as to anyone's (#1191, section 7).
- **A ban lifted by a card** (`ban_lifts`) ends the ban early; the Banlist says nothing of it, and the ban's entry
  stands as the record of the ban as it landed. Whether a lift should post is its own change.
- **The Banlist's words** (the title, the entry line and the personas' `banEntry` lines) are drafts for the owner's
  approval in the build's review, as the concessions were.
