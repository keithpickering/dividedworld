# Alerts, Updates and the season page: design

Record, written 2026-11-02. The design for how a player learns what happened to their characters and what is new in the
game, made with the owner from issue #81 ("a place in the glass for season results, announcements and alerts") and
from issue #140, whose first item (the log naming the wrong place for a card played beyond a post) turned out to be a
symptom of the same gap. The boards are `docs/research/2026-11-02-alerts/`. The plan is
`docs/plans/2026-11-02-alerts-plan.md`. It revises the two-worlds design (`docs/plans/2026-10-29-two-worlds-design.md`)
in sections 1, 3, 5 and 7, as section 1 below says, and changes CLAUDE.md's "The fiction may lie; the log never does"
by one sentence (section 3).

## 0. Where it starts

- **A player hears about almost nothing.** The log is reached only through the HUD's orbs (`engine/ui/frame/Hud.tsx`),
  which move only when Aura moves. It has no unread signal and no live feed (`engine/ui/log/useLog.ts`). The settlement
  summary shows once per settlement and remembers it was seen on the device (`engine/ui/log/Settlement.tsx`,
  `kb-settled-seen:<account>`). A reply, a quote, or a card on your character reaches you only if you happen upon it.
- **#140 F2.** `engine/ui/log/lines.ts` describes every card play by its `targetActId` post, so a character play reads
  "on Gloomba's post #4" and a board play "on a post", and the target character's player gets no line at all
  (`my_posts_played_on` filters to `reach = 'post'`).
- **#140's live feed.** A play beyond a post broadcasts only on its own thread's topic, so another page that shows the
  character, and a board's banner, hear of it on their next read.
- **No private live channel exists.** Every live update is a public `thread:` or `board:` broadcast
  (`supabase/migrations/0008_realtime.sql`).
- **Season results, debuts and Turns** are Acts The System posts on its own board (`reveal_season`, `post_tally`).
  The owner, in #81: "the forum UI should not really be aware of the kayfabe."

## 1. The line between the worlds: world and meta

**Decided** (the owner): the board shows the world as its characters experience it; the glass describes the game. The
owner: "Reactions themselves are game world elements. Stats about them are meta elements." And: "a 2003-styled 'this
post had whoops cast on it' would be an invalid breach of abstraction: the meta description of events lives in the
glass."

| | World (the board) | Meta (the glass) |
|---|---|---|
| **Public** | posts, reactions, a splat, a bot browsing a thread | marks, the Lens, standings, season news, updates |
| **Private** | (nothing yet; an in-character private message would be the first) | log, wallet, hand, alerts |

Most events have a face on each side: a Whoops! is a splat on the board and a mark and a log line in the glass; a reply
is a post on the board and an alert in the glass. **The board never names a mechanic; the glass never speaks in
character** (section 3 gives the glass's one voice). A thing is glass only if it describes the game, which is the
test for "too much glass".

Reactions are both: the owner, "Reactions are world *and* meta, really." They are drawn as post chips on the board and
as glass chips in the glass (an update's, section 6).

**What this revises in the two-worlds design:** section 1 lists the standings, the reveal and The System's board as
the board's. The standings and the season's results move to the glass (section 7 here); The System's board and its
posts stay the board's. Section 7 there ("Character pages stay on the board") keeps profiles on the board, as identity,
and loses the standings page.

Weighed: public vs. private as the line (marks broke it: they are public and glass); everything new as glass (no test
for when to stop).

## 2. Alerts: what they are, and the threshold

**Decided:** the log is the record, complete and true. An alert is a nudge: it goes to a player when they would
otherwise miss something, and it may give a hint, within reason (the owner: alerts "aren't only a curated filter of
the log: they can provide hints"). Every alert is true, and each one is also in the log or on the board.

**The catalog** (the owner confirmed it as proposed):

| Kind | When | Whose |
|---|---|---|
| Followed thread | New posts since you last read it, one alert per thread (section 4) | yours |
| Quote | A post quotes your character's post | yours |
| Card on yours | A card is played on your post, your character, or a thread your character started; batched per target on the page | yours |
| Trap | A trap struck your post, or your own trap sprang | yours |
| Ruling | A ruling landed on your character or post: a punishment, a report judged, an appeal answered, a title or user group given, your thread moved or retitled, a Mod Bot visit that ended with an outcome | yours, as each is built |
| Settlement | A settlement that moved your characters; opens its summary | yours |
| Hint | A post of yours drawing a pattern of reactions (section 5) | yours |
| Update | A new developer update (section 6) | everyone |
| Season news | Results in, a debut, a Turn, the Boss arriving or leaving (section 7) | everyone |

**Never alerted:** your own Acts; what your own other masks did to your characters; estimates; a single reaction; a
Mod Bot visit while it is under way. The owner on the visit: "it wouldn't be an alert for a real mod on a real forum
so it doesn't really track", and Mod Bots "spend the majority of their time patrolling active threads or reviewing
recent posts, like real mods would", which the staff design's patrols already do (`docs/plans/2026-10-31-the-staff-design.md`,
section 8).

**Rulings are built with what they rule.** Of the ruling kinds, only board moves exist today
(`supabase/migrations/0051_succession.sql`), and none of them lands on a character or a post. Warnings, appeals,
titles, thread moves and visits are designed in the staff design and not built. This design gives them a place in the
catalog and the interface they plug into (an alert kind and its writer, section 8); the build of each adds its alert
line in the same change, as "No player is ever stuck" asks of the state's way out.

Weighed: alerts as an unread layer over My log (rejected: a hint is not a log line, and the log's job is to be the
whole record); one page for personal alerts and public news together (rejected for B below).

## 3. The glass's one voice: the developer persona, and playful copy

**Decided** (the owner): the glass may carry one in-character voice, the instance's developer persona, in the manner
of Minus World's "Gabe Newell" character, "who ostensibly invented the game". The owner: "information always accurate,
even if it has character flavor … it's still not the glass lying."

- **Written only by admins, never by a model.** The Director cannot post as the developer and nothing a model returns
  reaches its page. This is what keeps it true.
- **One place:** the Updates page (section 6). Settings, errors and the log stay plain.
- **Plain topics stay plain:** anything about real moderation, the account, privacy or a player's data is never said
  through the persona, as CLAUDE.md already requires.
- **Playful copy** (the owner: "menu descriptions … a bit of humor to them as long as they are still accurate, which
  itself is a bit of a 'video game tradition'"): wherever the glass describes the game (its menus, cards, the Vending
  Machine, the season page, Updates, hints), its copy may joke. It is never a bluff and never The System's voice; the
  account, privacy, errors and real moderation stay plain.

**What this revises:** the two-worlds design's section 3 ("the glass never speaks in character") becomes "the glass
never speaks as The System or as any character in play; its one voice is the instance's developer persona, written by
its admins and always true". Section 3 weighed and rejected "the glass speaking in character for the game's flavor
only, never for facts (a line that drifts)"; the bounds above are what hold the line. CLAUDE.md's "The fiction may lie;
the log never does" gains the sentence, in this design's PR, so a later session reads it as a rule and not a loophole.

## 4. Where alerts live, and when one stops being new

**Decided** (the owner, B):

- **Alerts** is a glass page in the pause menu, for the player's own alerts and the two kinds every player gets
  (an update, season news), with filters by character as My log has (board `02-alerts.html`).
- **Season news goes to the season page** (section 7), and its arrival is one alert that links there.
- **A reply is defined by following** (the owner, B): quotes alert always; new posts alert for the threads you follow,
  batched per thread ("4 new posts in *X*"), counted from where you last read it (the `reading` table). By default you
  follow the threads your characters started; a glass control follows or unfollows any thread. Your own masks' posts
  are not counted.
- **New is one mark per account** (the owner, C): the HUD's count is what arrived since you last opened Alerts, kept on
  the account so every device agrees; the page draws a "new since you last looked" divider at it. A followed thread's
  alert clears itself once you have read the thread, wherever you read it. No alert carries a read flag of its own.
- **The settlement summary** remembers it was seen on the account too, which settles the two-worlds design's open
  question about a second device.

Weighed: one page for yours and everyone's, with tabs (A); quotes only (A on replies: misses the ordinary reply);
following every thread you posted in (C on replies: Alerts becomes a second index on a busy instance); a read flag per
alert (B on reading: a cost that grows with every alert sent).

**@mentions** are out of this design (open): a mention is new BBCode on the board, a feature of its own, and would plug
into the catalog as one more kind.

## 5. Hints

**Decided** (the owner, A): engine rules compute each hint from public reaction counts; the instance sets thresholds
and words, which may be playful. Every hint is true by construction and costs no model call. The owner on what they
read: "'picking up heat' would likely relate to negative-excited reactions, not just lots of reactions in general.
Helpful to show different alerts depending on the types of reactions being received (lots of one type, divisive, etc)."

The patterns, over a post's or card play's reactions within a window, by the core loop's four quadrants
(`docs/plans/2026-10-28-core-loop-design.md`, section 6):

- **One quadrant leading:** at least `least` reactions in the window and at least `share` of them in one quadrant.
  Four hints: heat (excited-negative), a pop (excited-positive), polite shrugs (calm-positive), groans
  (bored-negative).
- **Divisive:** the positive and the negative quadrants each at least `split` of the window's reactions, with at least
  `least` in all.
- **Stealing the thunder:** a card played on your post has drawn more reactions than the post, or your card has drawn
  more than the post it landed on.

Each pattern fires at most once per Act. A hint goes only to the Act's own player. Its inputs are the per-kind counts
any reader sees on the chips, and the time each reaction landed, which any reader watching the thread sees too; it
says nothing a player could not read off their own post, only sooner.

Weighed: The System choosing hints from fixed kinds (B: brings its bluffing voice into the glass); admin-planted hints
(C).

## 6. Updates

**Decided** (the owner, with the boards): an **Updates** page in the pause menu holds the developer's posts, each a
dev blog post: the persona's avatar, name and tagline, a dated headline, prose in its voice, then a plain **What
changed** list (board `03-updates.html`), with an archive beside it.

- **Each update is an Act** by a staff character of a new kind, the developer, in a thread The System's board never
  lists. So it can be reacted to and spun, and it is exported with the rest.
- **Reactions** are drawn as glass chips, with a **React** button (the owner: "'React as (character name)' can just be
  'React' since reactions are player-level anyway"); it reacts as the HUD's character, as the board's React does.
  Reactions to it pay no one, as reactions to The System's Acts already do (`is_staff_side`, `engine/rules/settle.ts`).
- **Spin a thread** starts a thread on the board with the update in its ORIGIN box, where characters argue about it.
- **A new update** is an alert for every player at once, so it cannot vary with anything private.
- **The persona** is instance content: its name, avatar, tagline and voice. The engine's default author is plain
  ("The developers"). Divided World's is Gabe, carried from Minus World.

Weighed: a versioned patch-notes card with the persona as a signature (drier); both, by length.

## 7. The season page

**Decided** (the owner, A): Rankings grows into the season page, the menu's **Season**, with two tabs: **Rankings**
(two-worlds board 13, as built) and **News** (board `04-season-news.html`): results, debuts, Turns, the Boss arriving
and leaving, newest first.

- **The results** show the top three with their final standings and classes and a link to all, the player's own
  characters marked "yours" as Rankings marks them.
- **The Boss's arrival** quotes its first words and links its post on The System's board; the glass quotes it, never
  speaks as it.
- **The board's standings page is retired** (`engine/ui/standings/`, `/standings`), and its links go to the season
  page. Profiles stay on the board.
- **The reveal and tally Acts already written** are never edited. The season page reads them; The System's board stops
  listing the reveal and Turns threads, and a link to one still opens it.
- **In-world rank** (the owner: "an in-universe display of experience or ranking would take the form of something like
  a trophy or avatar gear") is open: a design of its own.

Weighed: a separate season page beside Rankings, the board's standings kept (B: the numbers in both worlds); a board
"top posters" list of post counts (C: open with in-world rank).

## 8. Toasts and the HUD

**Decided** (the owner, B and the boards):

- **The HUD** gains an **Alerts** button with a bell and a gold count of what is new. On the desk layout it sits above
  Hand, beside the settlement clock, so Menu and Hand stay where they are; on the phone it is a bell between Posting as
  and Menu (boards `01-board-toasts.html`, `05-phone.html`). The build keeps the character's name whole on the phone,
  shortening Menu to its glyph if the row needs it.
- **Toasts** rise from Alerts above the seam in a column, at most three, the rest folded into "+N more", which opens
  Alerts. The owner: "we can do a whole column of toasts if multiple alerts come in short succession - they can all
  fade and slide in and out smoothly", with Motion (`motion` is a dependency today, not yet imported). Each holds an
  icon in its kind's ink, the line, one link, its time and a 44px dismiss button; it stays about six seconds, pauses
  while hovered or focused, and is announced by a polite live region. Under reduced motion each appears and leaves
  without moving.
- **Which kinds toast** is the player's choice in **Settings › Notifications**, the section the boards left waiting:
  on by default for quotes, cards on yours, traps, rulings, settlements and updates; off for followed threads, hints
  and season news.
- **While the hand is open,** toasts wait and rise when it closes (the hand fans through the same corner). Nothing is
  lost: every alert is on the Alerts page.
- **Live:** an alert reaches its player on a private channel of their own account, sent after the Act's response has
  gone, through the same queue The System's broadcasts use. A followed thread's count is read with the page, not
  pushed: a post would otherwise fan out to every follower live.

Weighed: a count on Menu (Menu would stop always opening My characters); a count on the orbs (mixes Aura with what is
not Aura); toasts for everything by default (C: followed threads would compete with reading).

**Out of the site** (email, push) is open: no other player could learn anything from it, but it is a separate channel
with its own privacy and delivery questions.

## 9. The log's lines for a play beyond a post (#140 F2)

**Decided** (the owner, A on the thread row): every line names its target by its public name.

| Reach | Caster | Ended | The target's player |
|---|---|---|---|
| Post | You played Whoops! on Gloomba's post #4 | Whoops! on Gloomba's post #4 ended | A card on your post (as built), and an alert |
| Character | You played Glitter Bomb on Gloomba | Glitter Bomb on Gloomba ended | Glitter Bomb was played on Gloomba, and an alert |
| Thread | You played Main Event on 'Thwomp appreciation' | Main Event on 'Thwomp appreciation' ended | The thread's starter: Main Event was played on 'Thwomp appreciation', and an alert |
| Board | You played Minus World on the Hobbies board | Minus World on the Hobbies board ended | No one owns a board; the caster's lines only |

No line names a caster or an owner. A board's or thread's name is the one it had when the card was played, from the
play's Act.

## 10. The masks

Every new response, payload, live event and timing, and why none is computed from a private fact
("A response never proves a private fact"):

- **An alert is read only by its account** (row-level security on its own rows, no table with an account column in a
  publication, as `supabase/tests/0014-realtime.sql` holds). Its content names only public things: the Act, its
  target's public name, public counts. It never names who played a card (the Lens shows that already) or who reacted.
- **The caster's response is the same whoever owns the target.** The alert is written in the same transaction, one row
  for an owned target and none for a staff one (staff is public), and its broadcast is queued and sent after the
  response, so no response or its timing differs with ownership. Skipping your own masks differs only for the caster's
  own account, which knows.
- **The private channel** is `account:<auth.uid()>`, authorized by a policy on `realtime.messages`, so no one can listen
  to another's.
- **Hints and followed-thread counts** are computed from public reactions and public posts, and go only to the Act's
  or the thread's own player.
- **Updates and season news** go to everyone alike.
- **The season results' "yours"** and the News tab's "one of yours" are the player's own private facts shown only to
  them, as Rankings already does.

## 11. A busy instance

- **Writes:** an alert is one indexed insert per owned target, per Act. No Act fans out to followers: a followed
  thread's alert is computed from the follower's own `reading` row and the thread's newest posts when Alerts or the
  HUD's count is read.
- **Reads:** the list is one range of an index on `(account, at)` for written alerts, the follower's followed threads
  (bounded by the threads they started and chose to follow, with a limit), the settlements their characters were in,
  and the public news's newest rows. The HUD's count reads the same with a bound ("9+").
- **Hints:** checked only after a reaction or a card play, on that one Act's window, with one row per Act and pattern
  so a pattern fires once.
- **Live:** one private channel per signed-in player; a toast is one message to one channel.

## 12. Ways out

| State | Its way out |
|---|---|
| A thread followed | Unfollow, on the Alerts row or the thread |
| A toast on screen | Its dismiss button, or it fades by itself |
| An unread count | Opening Alerts |
| A toast kind turned off | Settings › Notifications |

## 13. The layers

- **Engine:** the catalog of alert kinds and their writers, follows, the account mark, the private channel, the hint
  rules, the Updates and season pages, the toasts and the HUD's button, Settings › Notifications, and the developer
  staff kind with a plain default author.
- **Instance:** the developer persona (name, avatar, tagline), the hint thresholds and their words, the toast defaults,
  each alert's words where the instance names a thing, and the season page's copy. Through `Settings` (thresholds) and
  `InstanceUi.copy` (words) and the instance's staff seed (the persona). The engine names no instance.

## Open

- **@mentions,** and email or push notifications.
- **In-world rank:** trophies or avatar gear in place of a numbered standing.
- **An in-character private message,** the first thing in the private world.
- **Each ruling's alert line,** as the staff design's parts are built.
