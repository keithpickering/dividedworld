# What the meeting and the patrol see of the board: design

Record, written 2026-11-25. A design session with the owner, the same day and session as
`docs/plans/2026-11-25-reads-see-the-board-design.md` (the reader), which it builds on and is built after. Its plan
is `docs/plans/2026-11-25-digest-sees-the-board-plan.md`; the issue is #1071. It carries out the polls design's
unbuilt promise (`docs/plans/2026-11-20-polls-design.md`, section 8: "its digest gains each excerpted post's poll and
counts") and goes further, at the owner's direction.

## 0. What was found

- **The digest** (`engine/system/digest.ts`, from `system_digest`, latest in `supabase/migrations/0415_chattier_staff.sql`)
  is what the Boss reads at a meeting: hot threads, boards, standings, moves, quotes, reactions to its own posts, top
  posts (`digestExcerpts`, 8) and conversations (`digestConversations`, 6), each post cut to `digestExcerptChars` (280).
  It holds no poll, no spin and no card play, and no count of plays of any kind.
- **The Boss's reactions** ("Reactions to your own posts") name a post id and a thread and nothing of the post, so the
  Boss cannot tell which of its posts drew them.
- **The window** runs from the last meeting to this one (`supabase/functions/meet/core.ts`, near line 220), and the
  meeting's cadence is the setting `meetingCron` (daily, 11:00 UTC, in Divided World). The lists' caps are fixed, so a
  window of two days reads half as much per day as a window of one.
- **The patrol** (`patrol_sample`, latest in `0362_patrol_weights.sql`, then `patrolPrompt` in `engine/system/judgment.ts`)
  shows a Mod five posts drawn from the newest twenty on its beat, cut to 280 characters, and the Mod judges whether to
  send a visit, a punishment. The whole-posts design kept that cut. It is QC-1000's failure with consequences: a charge
  can rest on a post's first 280 characters, with no poll, play or reaction in view.

### What a meeting costs, and what that says about cadence

The owner proposed "a more detailed meeting every other day compared to tightly limiting the daily one … The higher the
quality of the information we carry forward to the next meeting, the less often the meeting can occur. Lots of Haiku
queries, orders of magnitude cheaper, give Opus its money's worth", and asked to be pushed back on if the numbers did not
bear it out. From #509's live run (`docs/plans/2026-11-12-meeting-uncached-design.md`) and
`supabase/functions/_shared/models/prices.ts`:

- A meeting is three Opus 5.5 calls, each reading the whole prompt, digest included: about 12.7k input tokens a call,
  38k a meeting, about $0.15 to $0.25 a day. Opus is $4 per million input tokens and $20 per million output; Haiku 5.5
  is $0.10 and $0.50, forty times cheaper.
- **Cadence is a weak lever on cost.** Meeting every other day saves the fixed part of each call (the persona, the
  rules, the schema), about $0.08 a day. A two-day digest at the same detail per day costs about what two one-day
  digests do. What it costs is play: The System acts half as often, and a board move, which waits about a day for the
  admins, lands two or three days after what caused it. Cadence is a choice about play.
- **Reading by Haiku first is the strong lever, as the owner expected.** Opus reads a digest token three times at $4
  per million: 10k tokens of raw thread cost about $0.12 a meeting. Read by Haiku (about $0.001) and condensed to a
  1k-token note, the Boss reads it for about $0.012: about ten times the board for the same strong-tier spend. That is
  the reporters design (#1073), next.

## 1. Each excerpt carries its extras

**Decided.** Every post the digest shows (a top post, each side of a conversation's exchange, and each of the Boss's
reacted posts) keeps its excerpt and gains, whole, the reader's extras in their short forms (the reader design's
section 3b, `engine/system/extras.ts`): its poll as one line (`pollShort`: the question, the leading option, the
time); each play the board shows on it as its `seen` line; and, for a spun thread's opener, the origin line. Weighed:
the excerpt alone (the digest is blind to the game's own pieces); the full poll on every excerpt (the Polls section
carries the full form).

**The Boss's reactions** gain an excerpt of the post each tally is on (the owner: "My post about Mario's wiggler sprites
got 3 heart reactions"), and keep their exact counts by kind.

## 2. Three new sections: Polls, Spins, Cards on the board

**Decided** (the owner: "A at least, and potentially B", B being these sections beside the excerpts' extras).

- **Polls:** the window's polls (open in it at any time) with the most voters, at most `digestPolls` (5) a day of
  window, each in the full form: the question, its board and thread, every option's count, the voters, the time left
  or since it closed and how. A poll is the crowd speaking, and a Boss answering one ("You voted to rename it. Denied.")
  is The System at its best.
- **Spins:** the threads spun in the window, the most replied first, at most `digestSpins` (5) a day, each as its
  origin line (the reader's, with its times) and the thread's title.
- **Cards on the board:** the window's plays with the largest public reaction totals on the play (`play_post.drawn`),
  at most `digestPlays` (5) a day, each as its `seen` line and where it was played (the post's thread and number).

Weighed: the excerpts' extras alone (a poll with many voters on a post with few reactions never reaches the Boss).

## 3. Standouts: the evidence a trophy is argued from

**Decided.** The owner: "The Boss giving a trophy to someone based on their card play over the last few days, amount of
polls participated in, etc is a great possibility. A natural extension of its existing ability to hand out trophies,
Achievements but without fixed parameters, you truly have to convince a somewhat unreasonable character that you
earned the trophy."

- **The span** is `digestStandoutDays` (7), whatever the meeting's window, so an award can rest on several days.
- **The categories:** cards played (cast face up, or a back that sprang), cards played on their posts, polls started,
  public ballots cast, threads spun from their posts, and exchanges with staff (their replies a persona's turn
  answered).
- **In words, never numbers.** The owner: "the exact counts might just give the model red herrings, it's probably more
  important that a character did 'a lot of X' than they 'did X n times'." Each category names its top three and how
  they stand, from each count's share of the leader's: `Most cards played this week: Wario, by far; then Toad and
  Peach.` or `…: Wario and Toad, neck and neck; Peach behind.` The counts never leave the database's answer for the
  renderer; the prompt holds the names and the words.
- **Beside it**, the trophies the meeting already shows (`boss_trophies()`: each belt's holder), so the Boss knows who
  holds what.
- **Who counts:** characters that are not staff. Every count is read of `acts_public`, so a face-down set that has not
  sprung, whose caster is hidden, and a secret ballot, whose voter is hidden, are never counted.

Weighed: a line per character for the six busiest, every count on it (a quiet specialist who spun five threads falls
out); both (the longest section, for little more).

## 4. The caps grow with the window

**Decided.** Each list's setting (`digestThreads`, `digestExcerpts`, `digestConversations`, and the new
`digestPolls`, `digestSpins`, `digestPlays`) is a number a day of window: a list holds the setting times the window's
days (rounded up, at least one), held within its ceiling in `DIGEST_MOST`, which the renderer still slices to. Changing
`meetingCron` then reads as much of each day as before. `digestBoards` and `digestBoardDays` describe the board's
shape, not the window, and stay as they are. `system_digest` also uses `digestExcerpts` as the cap of lists that are
not a window's flow (standings, moves, quotes, the Boss's reactions); those keep it unscaled, and only the top posts
scale. **Divided World stays daily** (the owner agreed): The System reacts within
the day. Weighed: moving Divided World to every other day (a few dollars a month, a slower System); fixed caps (a
rarer meeting reads less of each day).

## 5. The patrol reads whole posts

**Decided.** Each post of the patrol's sample is shown whole, with its extras (poll, plays, reactions, and the origin
for a spun opener), through the same renderers. The sample is newest first; the newest is always shown, and each other
is added while the patrol's text stays within `pool.readMost`; a post that does not fit is not judged in this patrol,
and nobody is told (a post left out is left alone, as the patrol's prompt already says). The patrol's `excerptChars`
goes, and with it the last exception the whole-posts design kept for a judge. On the light tier, five whole posts cost
about $0.001 a patrol. Weighed: the cut kept with the extras added (a charge still rests on a part of a post); leaving
the patrol to the reporters design. The digest keeps its excerpts: a cut there is a summary, not a judgment.

## 6. Layers, masks, ways out

- **Layers.** The digest's sections, the standouts' words, the window's caps and the patrol's read are the engine's.
  Divided World sets the new settings' values and nothing else; its cards' `seen` lines come from the reader's plan.
- **Masks.** Every count is of public Acts, read through `acts_public`, `poll_counts`, `reaction_tallies` and
  `play_post`, the same for every reader. The standouts' counts reach the model only as rank and spread. No secret
  ballot, no unsprung set, no reactor and no owner is read.
- **Ways out.** No state is added. A patrol post left out for space is left alone, as one not drawn is today.

## 7. Next: reporters

Light-tier notes through the day for the Boss, the strong lever of section 0, are their own design (#1073), next. The
digest is built of sections, so they join it as one more without moving anything here.
