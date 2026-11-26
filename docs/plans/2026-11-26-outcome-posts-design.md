Record, written 2026-11-26.

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

**An appeal with no post** (a ban made as a Mod's move, a group move) has nothing to quote and no thread a reader was
watching for it. Its ruling stays as today, an Act in the Lens and the log. This was not put to the owner as a
question; it is the one reading the decision allows, and it is named for the owner's review of this design.

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

## 8. Decided: the defaults the owner accepted

- **No backfill.** Visits and appeals that ended before this change keep their lines as they are, and nothing is posted
  for them. A post dated today for an old outcome would misdate it. The posts #1191 made are carried into the new
  record of outcome posts, so the Lens shows them as rows like the new ones.
- **Budgets.** The concession keeps `concessionsPerDay` and `concessionWriteMinutes` (now counted from the talk-down),
  and the quiz call writes only its question again. Filings stay under `filingLinesPerDay`, appeals under the
  `judgmentsPerDay` check `open_appeal` makes. No setting is added.
- **A wrong quiz answer posts nothing**; it is still only a tail. **A failed appeal judge posts nothing**; it is refunded
  and the appeal stays available, as today.
- **Best effort.** A refused post (the Mod's character benched, gone, locked out of the thread) leaves the outcome
  standing and is recorded for an admin, unseen by any player; the Lens row then shows the line, with no link.

## 9. How it works

- **The line and the post.** The visit's end Act and the appeal's ruling Act keep their `line`, now the whole text the
  Mod wrote (the Act is the record of the outcome, and the line is what the Lens shows if the post was refused). The
  post's body is that text. A filing and a ruling post at once, in the same transaction as their outcome, inside their
  own exception block. A concession posts when the staff run writes it, or as the stock past the window.
- **One record of outcome posts.** A row per outcome (a visit's end, or an appeal's ruling), written once, naming the
  post or the refusal. It is the one-post guard for all three, and the page reads it to put the visit's mark on the
  outcome post. #1191's `visit_concession_posts` rows are copied into it; its tables stay as written, no longer used.
- **A talk-down owes a concession.** The talk-down writes a row saying a concession is owed, by whom it was talked down
  and how. The staff run reads the owed rows without a post, oldest first, writes the concession and posts it. The tick
  posts the stock past the window. The interceptor is already public (the `intercept` Act names it).
- **The page.** A thread page's visits say, for each visit, its outcome posts on that page, and the page includes a
  visit whose outcome post is on it even when the visited post is on another page.

## 10. Layers, masks, ways out, scale

- **Layers.** Engine: the prompts and repairs, the tables, the posting, the page read, the marks and the Lens. The
  instance supplies nothing new: its personas' stock lines and `concessions` stand as the fallbacks they are.
- **Masks.** Every call reads only what readers see. A post names a character, never an account: the Mod's, and for a
  concession the interceptor's, which its own public Act names. When a post lands depends on the outcome and the staff
  run's clock, never on who owns any character. Whether it lands depends only on the Mod's character. The refusal
  record never reaches a client.
- **Ways out.** No state a player can be put in is added. An owed concession is not shown; it ends by itself as a post,
  the model's or the stock, within `concessionWriteMinutes` and a tick.
- **Scale.** One row per outcome; a visit has at most one end and a punishment one appeal. The staff run reads owed
  concessions by an index, at most `concessionsPerDay` calls. The page's join from outcome posts to visits is by the
  post's id, indexed, over the page's own posts.

## 11. Left out, and open

- **A report's verdicts in the thread** (section 3, C), and the arrival as a post (section 3, B).
- **The log** stays Act-based: its visit and appeal rows name the Acts, as "The fiction may lie; the log never does"
  asks. Whether a log row should also link the outcome post is its own change.
- **A quote trap or a No quote on the visited post** applies to the outcome post as to anyone's (#1191, section 7).
