# What the staff read sees of the board: polls, spun origins and plays: design

Record, written 2026-11-25. A design session with the owner, begun from the question "check recent plans related to
the staff features and see if we've accounted for bots' inability to read polls", with the same concern for spun
threads: "important context especially when the op of the spun thread has short content or none at all, confusing the
bot." The owner: "I think the fix is pretty straightforward, just include this content under the existing 'whole
posts' logic." Its plan is `docs/plans/2026-11-25-reads-see-the-board-plan.md`. It extends
`docs/plans/2026-11-23-whole-posts-design.md` (the reader); everything that design decided stands.

## 0. What was found

- **No plan covered either.** The staff plans from 2026-11-22 to 2026-11-24 (chattier staff and its follow-ups, whole
  posts, spin mod answers, rulings and alerts, staff requests, staff board threads) never say what a model reads of a
  poll or of a spun thread's origin, and no issue held it.
- **The reader reads words alone.** `pool_read` (latest in `supabase/migrations/0421_whole_posts.sql`) returns, for
  each post, its author, name, pronouns, current public body, reply target and quotes, and the thread's title. Nothing
  else reaches `readThread` (`engine/system/read.ts`), which every staff call that reads a thread goes through (the
  chatter's turns and picks, the Mods' filings, reports and appeals: `supabase/functions/_shared/pool-read.ts`).
- **A poll is invisible.** A poll is an Act of its own (`kind = 'poll'`, target the post; `0395_polls.sql`). A post that
  is only a poll reads as an empty post.
- **A spin's origin is invisible.** The thread's origin (`threads.origin_act_id`) is never read, so a spun thread whose
  opener is short or empty gives the model nothing to go on. The ORIGIN box players see comes from
  `thread_open.origin_place` (latest in `0422_spin_answers.sql`), which no model read uses.
- **Plays are invisible, and the model reads under them.** A post's card plays are layers drawn over it. The model is
  shown none of them, so a splatted, Kick Me'd or Steel Chaired post reads as a clean one, and where a card changes what
  a reader sees (Autocorrect's tape, Time Machine's older version, You Were Saying?'s tail) the model reads something
  other than what every player sees. No prompt describes a card the persona is not holding, so a card's name alone
  would tell a light-tier model nothing.
- **The polls design promised part of this for the digest** (`docs/plans/2026-11-20-polls-design.md`, section 8: "its
  digest gains each excerpted post's poll and counts"). It was never built. The digest is section 6 here.

## 1. A post's poll is read with the post

**Decided.** Each post the reader is given carries its live poll (the latest poll Act unless that is a removal, as
`latest_poll` reads it) with: the question, the options, how many picks a ballot may make, whether ballots are secret,
when it ends, whether it is closed and by whom (its time ran out, its author, an admin), each option's count and the
number of characters whose ballots count, as `poll_counts` gives them. It is rendered under the post's body:

```
[poll on this post] "Best kart in the series?" (pick up to 2; secret ballots)
  Open: ends in 2 hours.
  1. Mach 8: 5 (42%)
  2. Blue Falcon: 7 (58%)
  9 characters voted.
```

A closed poll reads `Closed 6 months ago.`, or `Closed 3 days ago, early, by its author.` (or `by an admin`).

**Times are relative to the call** (the owner: "the current poll results + time between the planned mod post and the end
of the poll are likely important information for context"). A staff post is written as the model answers, seconds
after the call, so the call's own time is "now"; the caller passes it in and the reader stays pure. Rounded as a person
says it: minutes under an hour, hours under two days, days under two months, months under two years, then years.

**Who voted is not shown.** Weighed: the names under each option on a public poll, at most ten with "and N more" (a
public ballot is public play, and "Wario, you voted Blue Falcon?" is good kayfabe); names only for a poll the call is
focused on. The owner: counts only, "because I don't think Haiku will really be able to reason through the 'Wario
voted for this, which is remarkable because...' But let's make a note of that and/or leave a path for it in the code
because models will certainly get more capable over time." **The path:** the poll's shape in the reader has a
`voters` field, absent today; a later change fills it in SQL for a public poll and adds one rendering line, and nothing
else moves.

## 2. A spun thread's origin rides with its opener

**Decided.** `pool_read` returns the thread's origin, and the reader shows it directly above the opening post, as one
line and, where the origin stands on a post, that post whole:

```
(This thread was spun 3 days ago from Wario's post #4 in "Best kart?", written 6 months ago.)
Wario (he/him) [origin, post #4 in "Best kart?"]
<the post's body, its poll, its plays>
Toad (he/him) [post #1]
<the opener>
```

It is shown whenever the opener is shown, never without it, and its size counts as part of the opener's. A spun
thread's opener ranks in tier 2 (with the persona's own and the posts to it), not tier 3: without the origin the
opener cannot be understood, and a short or empty opener, the case that started this, costs almost nothing. Weighed:
always shown, as the must tier is (one long origin read on every turn in the thread, deep in a side conversation too); a
tier of its own between "to it" and the opener (the origin could then be shown without its opener, which reads
oddly).

**What of the origin is shown, by its kind.** The line always uses the words of the ORIGIN band
(`thread_open.origin_place`), so the model sees what a player sees there:

- **A post:** the post whole, with its poll and its plays.
- **A poll or a public ballot:** the post the poll is on, whole, with the poll; the line names the poll, and for a
  ballot who cast it and what it picked (a secret ballot cannot be spun, so a spun ballot's picks are public).
- **A card play:** the line ("spun from Whoops! played on #4 in …"), and the post it was played on, whole, where it was
  played on a post.
- **An Updates post:** its title and body, whole.
- **A report, a verdict, an appeal or a ruling:** the line from `spin_answer_place`, and the post the report or appeal
  is about, whole. Everything there is already public on the band.

Weighed: the band's line alone for every kind but a post (a spun verdict on a three-word opener confuses the model as
much as today); the post alone (loses why the thread exists).

**When.** The line says how long ago the thread was spun and how long ago its origin happened, for every kind of
origin (the owner: "A spin from something that happened months ago is thought about differently, it's the kind of
subtle difference that makes an interaction human").

**Live or as it was.** The origin is read as its ORIGIN box shows it. A spin of a post shows the post live, its plays as
they are now. A spin of a play shows the post with its plays as they stood at the spin (`spin_moment`), and the line
says so: "as it stood when it was spun, 3 months ago". The owner: "Both different things which are thought about
differently."

An origin the board no longer shows (a hidden post) is read as the band reads it, and no body is shown for it.

## 3. A play on a post is one line, in the fiction

**Decided.** Each play the board shows on a post (`post_plays`: the plays in force and the sprung backs whose lockout
is live) is one line under the post's body, written as the thing a reader sees, not as a mechanic. The owner: "with
more illustrative descriptions, less mechanical. Guide the model to engage with the fiction. 'Wario covered this post
with a big {color} splat of goop' plus progress info mapping numbers to descriptions, 'a bit of it has been washed
away', 'almost all of it' etc."

```
[Wario covered this post in a big teal splat of goop, 2 days ago. A bit of it has been scrubbed away.]
```

- **The sentence is the card's.** `CardRules` gains an optional `seen(play)`, a pure function from what a reader of the
  board can see of one play (the card's configuration as the board shows it, its public effect state, its caster's
  name as the board names it, how long ago it was played, its amounts) to one or two sentences in the fiction's voice.
  Each card in Divided World writes its own. The engine never names a card.
- **Amounts become words, the same way for every card.** The engine's `amountWords(share)` maps a share from 0 to 1 to
  a band: none, a bit, some, about half, most, almost all, all. A card says what is washed, scrubbed, peeled or swept;
  the engine says how much.
- **A card with no `seen`** is still shown, as `[<card name> was played on this post, 2 days ago.]`, so nothing on the
  board is silently missing. A test holds that every card of Divided World that reaches a post has a `seen`.
- **The words the model reads are the words a reader sees.** The body stays the post's own words, and the play's line
  says what lies over them: Autocorrect names each phrase and what it is taped over with; You Were Saying?'s line
  carries its tail's text, which is public on the post. A live rewind (Time Machine; `card_kinds.rewind`) is the one
  case that replaces the body: the model reads the version the post shows, as every reader does, and the play's line
  says the post is showing how it looked a while ago.
- **Hidden stays hidden.** A face-down set that has not sprung is not shown, as the board does not show it. A caster is
  named only where the board names one.

Weighed: the card's name and when only (a light-tier model cannot reason about "Kick Me"); plays only on the origin (a
Mod answering a splatted post would still treat it as clean).

**The balance the owner asked for**, "between providing a ridiculous amount of context that won't really be reasoned
about + breaking the illusion by making it clear that context was missing": a play is one line, a poll a few, an
origin one line and one post; every line is a thing that is on the board, written as such; nothing is marked as left
out except whole posts, as the whole-posts design already says.

## 3a. A post's reactions are read with it

**Decided** (added later in the same session, while designing the digest). The owner: "they are currently blind to
reactions received on their posts. These of course are anonymous, and the exact counts might in fact add a bit of
realism in this case ('My post about Mario's wiggler sprites got 3 heart reactions')." Each shown post carries its
public reaction counts by kind, as every reader of the board sees them (`reaction_tallies`), never who reacted, and they
are rendered as one line under the post: `[Reactions: ❤ 3, 😂 1]`. A post with none has no line. Every shown post, not
only the persona's own: a reply's tone depends on whether the post it answers drew twelve laughs or none. Weighed: the
persona's own posts alone (a Mod answering a post the crowd loved would not know it); the counts in words, as the
digest's standouts are (here the exact count is the realism).

## 3b. One set of renderers for every read

**Decided**, for the same reason: the digest and the patrol show the same extras (section 6 here and
`docs/plans/2026-11-25-digest-sees-the-board-design.md`). A post's poll, plays and reactions are read by one SQL
function, `post_extras(posts uuid[])`, and rendered by one engine module, `engine/system/extras.ts`; `pool_read`, the
reader, the digest and the patrol all use them, so a card's `seen` line or a poll reads the same in every prompt.

## 4. The prompt and the budget

- **One more sentence in `READ_WORDS`:** polls, the cards played on posts and where a thread was spun from are things
  that really happened on the board; the persona may react to them in character, and never quotes the bracketed lines
  as anyone's words.
- **A post's size is its rendered size:** body, poll, play and reaction lines, and for the opener its origin. The ceiling
  (`pool.readMost`) and the must tier's rule are unchanged; a post with a long poll weighs what it reads.

## 5. Layers, masks, ways out

- **Layers.** The reader, the poll and origin rendering, `amountWords`, the relative times and the `seen` interface are
  the engine's. Each card's `seen` sentence is Divided World's content, carried by `CardRules`, the interface every card
  already plugs into.
- **Masks.** Everything shown is what any reader of the board sees: a poll's counts count characters and are the same
  for every reader; reactions are the public sums by kind, never who reacted; no secret ballot is read; no face-down set is named; a caster is named only where the board names
  one; the origin's line is the band's. The relative times come from the call's clock and public times. Nothing is
  computed from who owns a character.
- **Ways out.** No state is added that a player, a character or a post can be put in.

## 6. Not here: the meeting digest and the patrol

The meeting digest and the patrol's cross-board sample still read marked excerpts, not the reader, and gain nothing
here. The owner chose to design them next, while this is fresh: `docs/plans/2026-11-25-digest-sees-the-board-design.md`,
written the same day, which also moves the patrol to whole posts.

## 7. Open

- Voters' names on a public poll (section 1): recorded, with its path, for when models reason well enough to use them.
