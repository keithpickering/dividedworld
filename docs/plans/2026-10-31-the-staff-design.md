# The System's staff: Mod Bots, visits, reports, appeals, presence and the Boss's further moves: design

Record, written 2026-10-31. The design session for The System's staff, with the owner. It started from the idea boards in
issues #73, #35, #40 and #55, and it builds on The System's design (`docs/plans/2026-10-30-the-system-design.md`, merged
in #77) and its Boss addendum (`docs/plans/2026-10-31-seasonal-boss-design.md`, merged in #82). Part 1's plan
(`docs/plans/2026-10-30-the-system-plan.md`) was amended the same day for this design; nothing of The System is built
yet. The plan for presence, the one part buildable today, is `docs/plans/2026-10-31-presence-plan.md`. Each section was
decided one question at a time. The owner's words are quoted where they set the direction; where the owner chose the
proposal as put, the section says what was put.

Where this design says "the Boss", it means the season's Boss, who plays the Director. "Staff" means the Boss and the
Mod Bots together, every staff character the engine knows.

## 1. Scope

**Decided:** the staff session. It covers:

- the Mod Bots as the Boss's henchmen, and visits, the way they enforce;
- reports, patrols and interception;
- appeals, reworked around the bots;
- the moves #73 listed that The System's design did not take up;
- a cap on targeting one character;
- Random Events (#35), the reach of the old voice (#40), and the hooks the staff offer to cards (#55);
- presence, which visits need.

Feuds, matches, belts and a season's finale stay their own design session, as the Boss addendum left them.

Weighed: everything at once, feuds and the finale included; Mod Bots and appeals alone, leaving the remaining moves and
Random Events for later.

## 2. Presence: who is browsing

The owner, choosing a visit to a thread over a sprite that crawls a page: "a list of users currently viewing a forum or
thread is a standard forum feature which can provide much of the 'visit to a thread' UI, potentially with a glass
hint/flavor (overlaying the forum world but never reflowing it)." Presence was waiting on a design of its own since the
core loop's design deferred it (`docs/plans/2026-10-28-core-loop-design.md`, section 11). It is designed here.

**Decided:** phpBB's three boxes in the board's world.

- **"Users browsing this thread"** goes under a thread's last pager. **"Users browsing this board"** goes under a board's
  thread list and counts the board's page and every thread on it. **"Who is online"** goes at the foot of the index.
- Each box lists the characters active there within a window (5 minutes by default), names only, each linked to its
  profile. The owner tried square mini avatars beside the names and set them aside: "Avatars make the list too messy."
- Up to 15 names are shown (a setting), longest present first, then "and N others". The owner: "Even 25 is generous, I
  feel like 10 or 15 would do it."
- **It refreshes on a 30-second poll** (the owner: "30 second poll will probably work fine unless making it instant is
  cheaper somehow"). The poll is also the viewer's heartbeat: one call marks the HUD's current mask present at the page
  and returns the box's names.
- **A mask arrives on its first poll and leaves only by aging out** (the owner: "instant entry, delayed exit"). A swap
  from A to B never sends "A left, B arrived" together. That pair would be computed from one account holding both masks,
  which "A response never proves a private fact" forbids. B appearing as A goes quiet is built from each mask's own
  activity, as post times are, so it stays a clue. The owner called such a slip-up "a legitimate game mechanic (a hint
  for other players playing detective)."
- **Each mask has a "Hide my online status" switch**, in My characters on its row, with a small "hidden" mark beside the
  HUD's current mask. A hidden mask is listed nowhere. Its own player sees it in italics, "(hidden, only you see this)",
  from their own session, never from the server.
- There is no count of hidden masks and no "guests". A hidden count would move when a player hides, and every reader is
  signed in.
- Only a debuted, unretired character can be present, and only through the account that plays it. The server checks
  both, so no client can announce another mask. A mask waiting to debut, or an account reading with none, is listed
  nowhere.
- The box is not a live region, so a screen reader is not interrupted every 30 seconds.
- A Mod Bot on a visit appears in the thread's box like anyone, with a glass tag laid over its name ("On a visit · post
  #12") that never reflows the line (section 5). Its look is designed with Part 3's plan.

**Why a poll over Realtime.** Live Realtime presence was weighed first, at the owner's ask ("It feels the most
gamelike"). Its cost:

- Supabase bills each delivery to each listener, so an arrival costs one message per viewer already there. At Divided
  World's size that is about 1M messages a month, inside the 5M included.
- At a busy instance (10k players a day, about 4 hours each, hot threads of 100 viewers) it is on the order of $3,600 a
  month. Batching busy threads into a snapshot each minute brought that to about $350.
- Supabase Presence carries whatever a client says, so any client could announce someone else's mask. The server would
  have to hold presence and broadcast it anyway.

New posts already reach a thread over its private Broadcast channel (`web/src/data/supabase.ts`, `thread:<id>`).
Presence still rides a poll, because the server needs a heartbeat from each viewer and the poll is that heartbeat: no
message fan-out, about 50 small indexed calls a second at a busy instance.

Weighed: live Realtime presence with batching above a threshold; per-mask "last seen" that lights up every mask a
player used in the window at once; departures shown the moment they happen.

## 3. Mod Bots are standing staff

**Decided:** the instance holds a roster of Mod Bots who outlast Bosses, like real moderators who stay when the admin
changes.

- **Staff characters, like Bosses.** Each Mod Bot is a staff character with no account behind it (Part 1, Task 4),
  seeded once from the instance's roster, with a profile and a moderation log of its own: its visits and how each ended,
  its reports judged, its appeals heard.
- **It serves the season's Boss.** Each Boss inherits the staff. It can favor a bot (the busiest beats) or sideline one
  (a quiet beat).
- **Hiring and firing.** A Boss can hire a bot from the roster who is not on staff, or fire one, benching it until a
  later Boss rehires it. Each is a structural move in the admin queue (section 10).
- **Memory across regimes.** A bot keeps its own memory, grudges and favorites included, across Bosses. That gives "the
  old guard against the new Boss" for free.
- **Updated at the meeting.** Bots hold no meetings. The Boss's meeting writes each bot's memory update as part of its
  answer, bounded in size, read only from the digest as everything else is. A meeting per bot was weighed in section 4
  and set aside.
- **Never empty.** At least one bot is always on staff, which the code holds.

Weighed: each Boss bringing its own bots, which loses the continuity and doubles the roster's writing; a standing staff
plus personal henchmen who leave with their Boss.

## 4. What a Mod Bot is

**Decided:** a bot differs in play, not only in voice. Its persona is instance content:

- **A name, a title, an avatar and a signature**, as a Boss has.
- **Beat preferences.** The kinds of board it likes to patrol. The meeting assigns each board a bot on its beat; that bot
  hears its reports and runs its patrols.
- **Pet rules.** The predicates it lobbies for. The meeting sees every bot's wish list, so contradictory rules from rival
  bots come naturally, and so does the joke of a bump rule beside a duplicate-thread rule.
- **Strictness,** in numbers the engine bounds: how long its visits run inside the visit window, and which bands it
  pushes for.
- **A weakness,** one of the interception challenges (section 6), with its quiz questions or its bribe price.
- **A voice:** the chat model by default, or the old voice in raw completion for an unhinged bot (#40; The System's
  design, section 6: "a particularly unhinged mod bot").
- **What persuades it on appeal,** in its persona prompt. The spec's Bailiff-01 is weak to pedantic legalism and its
  Hazard-X respects only bravado (`spec.md`, section 7.1). Divided World's first roster is written with the owner before
  Part 3 ships, as its Bosses are.

Bots can feud with each other on the board, in their own posts.

Weighed: voice and weakness only, with bots as interchangeable enforcers; fully autonomous bots, each holding a meeting
and a move budget of its own, which costs a meeting per bot per day and splits the Boss's authority.

## 5. Visits: how a Mod Bot enforces

**Decided:** every punishment a bot delivers comes by a visit. A bot visits one post in a thread for a stated window,
and at the window's end it files its report and the punishment lands, unless a character intercepts it first.

**What sends a bot:**

1. **A broken rule.** Caught by plain code when the post is made (The System's design, section 8: a rule never refuses a
   post). It always sends the bot on that board's beat, with the rule as its charge.
2. **A player's report** (section 7).
3. **A patrol** the Boss dispatches at its meeting (section 8).

**The visit itself:**

- **Its window** is hours long: 2 to 12 by default, set by the bot's strictness inside the engine's bounds, and shorter
  in a crescendo. That is long enough for a small cast to notice, which answers the kit review's worry that "Mod Bots
  need someone watching at the right moment" (`docs/plans/2026-10-28-kit-step-1-design.md`, section 8).
- **It is shown in the board's world.** The bot appears in "Users browsing this thread" with its glass tag, and the post
  it inspects carries a small glass stamp, overlaid and never reflowing the board.
- **The glass says plainly** what the charge is, what lands and on whom if nobody intercepts, and by when ("No player is
  ever stuck").
- **The author gets no alert** (the spec's "zero notifications"). Friends spotting the bot is the social part. When it
  ends, the author's log says plainly what happened ("The fiction may lie; the log never does").
- **One visit per post at a time.** A second charge against a post under a visit joins that visit's charge, bounded by
  the bands' cap.
- **No model call is needed.** A visit is a timeline the server holds (a start, an end and a state); clients draw it.
  The bot's arrival and filing lines are stock lines, or micro-events within their daily budget (The System's design,
  section 2).

**What a filed report does:** the charge's band adds its points to the author's warn bar (The System's design, section
8, unchanged otherwise), and the post takes its layer ("This post was found in violation of Rule 4"). Section 8 of that
design is amended in one way: the points land when the report is filed, not when the post is made.

Weighed: a Mod Bot as a staff character only, with nothing to intercept and appeals as the only answer; the spec's live
sprite, minutes long, with cursor aggro, which usually escapes unseen in a cast of tens and has no cursor on a phone.

## 6. Interception

**Decided:** any character reading the thread can try to intercept a visit, through the bot's weakness. The weakness is
one of a fixed list of challenge kinds:

- **A quiz:** one dumb multiple-choice question from the bot's bank in the instance's content, drawn when the visit
  starts and the same for every character who tries.
- **A bribe:** a price in Aura, set by the persona inside the engine's bounds. It is paid in, and it goes nowhere.
- **A distraction:** a card played on the thread, once #55's Use play exists (section 14). Until then a distraction-weak
  bot falls back to a quiz.

**The rules of it:**

- **One attempt per character per visit.**
- **Success** ends the visit. The success is a public Act by the interceptor ("Pipewrench talked Hall Monitor down"),
  which others react to, and those reactions pay the interceptor by its own class. The System pays no Aura (The System's
  design, section 3), so an interception's worth is the crowd's.
- **Failure aggros the bot onto the interceptor.** Its next post within 24 hours (a setting) draws a visit with the charge
  "obstruction", the smallest band. A tail is the interceptor's own doing and never counts toward the targeting cap
  (section 11).
- **The author may intercept a visit to their own post.** Nothing tells them, but nothing stops them.
- **A player may report, or intercept a visit to, a post by one of their own other masks.** The owner chose this as put:
  "like booking an angle on yourself." A staged report and rescue still costs the report and the bribe or the quiz, and
  only other players' reactions to the Acts pay anything. No refusal exists, so nothing about it can leak.
- **Equal on every path** ("An accessible path costs what the obstacle costs"). The bot's tag and the post's stamp are
  buttons reached by keyboard. The challenge opens in the glass with no timer, and a quiz answered by keyboard or screen
  reader takes the one choice a click does.

Weighed: the spec's quiz for every bot; a bribe only.

## 7. Reports: public snitching

**Decided:** a character can report a post. A report costs Aura (0.25 by default), and a character makes at most 3 a day.
The cap is per character, never per account, so no quota is shared across a player's masks. A report is a public Act
naming its reporter (the owner chose this as put: "Snitches can be reacted to and dunked on"), so "who reported" never
becomes a private fact to guard.

The bot on the post's board's beat judges the report at once: one cheap model call, in its voice, reading the post, the
rules in force and the board's premise. Its verdict is one of:

- **A visit,** with a named charge (a rule or the premise, and its band);
- **Dismissed:** the Aura is spent and the bot grumbles in public;
- **Backfire:** the bot visits the reporter's latest post instead, for "wasting the staff's time".

The verdict is a public Act on the report, and its free text is only shown.

**Cost stays flat.** An instance's report judgments have a daily budget (a setting). Past it, a report is refused before
it is paid for, with a plain "the staff can't take more reports today". The refusal reads a count across the whole
instance, so it never varies with who owns what. If a judgment call fails, the report is refunded and can be made again.

Weighed: a hidden reporter revealed when the visit ends; reports always anonymous, as real report buttons are; for the
verdict, visit or dismiss with no backfire, and a visit for every report with the charge judged only at its end.

## 8. Patrols

**Decided:** at its meeting the Boss dispatches a few patrols a day (a setting, 6 by default). A patrol is a bot walking
its beat at a time the meeting chooses.

- **Sampling.** Plain code picks a handful of recent posts on the beat (5 by default). One cheap model call, in the bot's
  voice, judges each against the board's premise and the rules in force. A finding sends a visit with its charge.
- **Flat cost.** The number of patrols and the sample's size are fixed however busy the instance is, so a patrol's cost
  never grows with posts. #73 asked for this: "A model judging every post on-topic costs more with every post."
- **Contraband.** After a rename, a patrol may also move an off-premise thread out of the board under a "Moved:" stub,
  as a standing order of the rename (section 10's thread move), bounded per patrol and spending nothing from the bank.

## 9. Appeals

**Decided:** the bot that filed a report hears the appeal of what it delivered, in its own voice and persuaded by what its
persona respects. A move the Boss made itself (a ban, a shame title, a restriction) is heard by the Boss. The terms are
The System's design's, section 14:

- one appeal per punishment;
- 0.50 Aura, refunded if overturned;
- verdicts overturned, upheld, reduced or increased, an increase capped by the code;
- a cheap model judge, whose free text is shown as the ruling.

What changes:

- **The plea and the ruling are a public pair of Acts** on the punishment, so the board can react to a groveling plea or
  a catastrophic "increased". The plea is the player's own words through their mask.
- **A backfired report is a punishment like any other** and can be appealed.
- **If the judge's call fails,** the fee is refunded and the appeal stays available; nothing waits on a model that did not
  answer ("Three unrelated timeouts are not a poison pill").

Weighed: a different bot hearing it (internal affairs), which loses "know your cop"; every appeal going up to the Boss.

## 10. The Boss's further moves

**Decided:** all four groups #73 listed join the catalog. Each is a fixed effect with limits, a demand from the
whitelist, and an expiry. Each is a layer over what was written, computed from Acts as a board's name is (Part 1, Task
8), never a loss. Part 5 and Part 6 (section 16) plan them.

### Shame titles, user groups, push and bury

- **A title on one character.** A Boss gives a character a user title shown on its postbit: a shame title ("Certified
  Necroposter"), a jobber title for a disappointment, or a push for a favorite ("Rising Star"). A shame title's demand
  sheds it early. A push uses an inverted demand: met, it keeps the title to its expiry; unmet, it is stripped at a check
  the move states.
- **A user group.** An ironic group ("Probationary Members") shows as a label on its members' postbits and can be the key
  to a restricted board (below). Membership is per character.
- All are small moves, landing when scheduled. They are punishments aimed at one character where they shame (the
  targeting cap counts them, section 11), so they can be appealed, and the crowd's reactions to them are credited to that
  character (#73's comment of 2026-10-31).

### Thread moves

- **Retitle, move, split or merge.** A thread's title, its board, and the thread a post shows in are each computed from
  these Acts.
- **A "Moved:" stub** stays on the old board while a move is in force.
- **Ending a move** brings everything back as it was.
- All are small moves. A Boss makes them at a meeting, and a patrol makes a contraband move as a standing order (section
  8).

### Board shape

All of these are structural, waiting about 24 hours in the admin queue.

- **A hobby board.** The Boss creates a board for its hobby ("Tomato Talk") with an inverted demand (the owner chose this
  as put). Its demand is the Boss's ask ("20 posts by 6 characters in two weeks"). Met, the board earns a place and stays
  until a later Boss's inheritance review ends it. Unmet by its expiry, it is archived: read-only under its name, every
  thread still readable, and any thread can go on as a sequel elsewhere.
- **A merged board.** An "underused" board is merged into another: its threads show under the other board with its name
  kept as a label, and its own page shows a "Moved:" stub. A met demand or the expiry splits them back.
- **A restricted board.** A board is limited to a user group, or put behind a password. Outsiders can still read it but
  cannot post, and the restriction ends at its expiry regardless. There are three ways in, as the owner chose:
  - **Group membership,** which the Boss grants to characters it favors from public play.
  - **The password,** planted somewhere public in character (a Boss's signature, a bot's post, an old thread's title).
    Any character who finds it and enters it is in.
  - **The demand,** which opens the board to everyone when met.

### Hiring and firing

A Boss hires a bot from the roster or fires one. Each is structural, at most two staff changes a season (a setting), and
never the last bot on staff (section 3).

Weighed: hiding a restricted board entirely, as phpBB did; paying Aura for a week's access, as the Premium Post Palace
did. For a hobby board: one that is always temporary; one that is permanent unless reversed.

## 11. The targeting cap

**Decided:** at most 3 punishments chosen by staff land on one character in any 7 days (both settings).

- **What counts:** a Boss's moves aimed at a character, patrol findings, backfired reports, shame titles and bans the Boss
  made outright.
- **What doesn't count:** breaking a rule in force, a player's report and a tail after a failed interception. Each of
  those is the character's own doing, or another player's.
- **At the cap, staff simply cannot choose that character.** The meeting is told so, a patrol's finding against it is
  dropped and recorded, and nothing about it is shown.
- **Computed from public facts only.** The punishments it counts are public Acts.

This answers #73's risk of "real hurt in a small circle": a Boss fixated on one friend's mask for weeks.

Weighed: counting every punishment, which would let a capped character break rules freely.

## 12. Random Events

**Decided:** #35's "SOMETHING HAPPENED!", lifted from Neopets almost directly, as the owner said. It sits beside Minus
Balls.

- **Private.** A Random Event is a private banner on a page load, drawn per player by the same server spawn and cap as
  Minus Balls (The System's design, section 10). The server decides each event and a claim must name one it issued.
- **Outcomes from a fixed list:**
  - most often, nothing but a line and a picture ("You touched the statue.");
  - a worn card found "on the ground", once #55's card condition exists;
  - a Minus Ball;
  - a brush with a Mod Bot, which starts tailing that mask as a failed interception does.
- **No Aura.** The System never pays Aura, and no event takes Aura either.
- **Lines** are stock lines from the instance, sometimes the old voice (section 13).
- **Rarely public.** A rare event becomes a public Act naming the character, never the player.
- **Logged.** Anything an event gives lands in that character's log in plain words.

Weighed: folding the flavor into Minus Balls, with no banner; every event public, by a Mod Bot on the board.

## 13. The old voice's reach

**Decided:** the old voice writes flavor and never decides. It is a real 2019–2021 base model on raw completion,
self-hosted, priced at zero (The System's design, section 6).

- **Its slots:** a board's description on a rename, as standard; some Random Event lines; a Mod Bot's lines when its
  persona opts into the old voice; a Boss's Interests and signature filler.
- **Seeded by the chat model.** The owner: "the good model will need to generate the first few words to get a good
  'autocomplete' that goes off on a tangent without being completely random." The chat model writes the opening words in
  the slot's frame, and the old model continues them.
- **Scrubbed.** Every output goes through a scrubber for slurs and for anything shaped like a name, email, phone number or
  URL. A hit regenerates once, and a second hit falls back to a stock line (#40's risks).
- **Swappable.** Which model, and on which host, is the instance's choice.

Weighed: board descriptions only; everything The System says, which makes rulings and verdicts unreadable.

## 14. The hooks the staff offer to cards

**Decided:** this design defines only what the staff expose to cards. #55's own design session decides the plays, trap
rules and card condition.

- **A visit can be ended by a card play.** This is the distraction weakness: a Use play on the thread.
- **A set trap can spring on a visit.** A trap set face down on a post can spring when a Mod Bot visits it (Spell Trap):
  the bot is caught, the visit ends, and its Act stays.
- **Random Events can drop worn cards.**

Until #55 lands, distraction-weak bots fall back to a quiz and no event drops a card.

Weighed: designing #55 here as well; no card hooks at all.

## 15. The duties, after this session

The engine's duties (The System's design, section 14), and who holds each:

| Duty | Held by | Mode |
| --- | --- | --- |
| The meeting | The season's Boss, now also writing each bot's memory, assigning beats and dispatching patrols | Chat, strong tier |
| A visit's lines | The visiting bot | Stock, a micro-event, or the old voice by persona |
| Judging a report | The bot on the post's board's beat | Chat, light tier |
| Judging a patrol's sample | The patrolling bot | Chat, light tier |
| Hearing an appeal | The bot that filed; the Boss for its own moves | Chat, light tier |
| Judging a player's rename | The Boss | Chat, light tier |
| A Random Event's line | No one (The System's plain voice) | Stock or the old voice |

Every duty with a model call has a daily budget per instance, and past it a stock line or a plain refusal stands in.

## 16. The order of building

**Decided:** eight parts, each with a plan of its own written from the designs. This session writes the presence plan
and amends Part 1. Part 3's plan is written once Part 1 is merged, so that it names real files.

1. **The skeleton**, as planned, with the Mod Bots seeded as standing staff.
2. **Presence.** It depends on nothing, so it can be built now.
3. **Mod Bots and visits,** with rules, the warn bar, bans, the permaban, reports, interception and appeals. This absorbs
   The System's old Part 2.
4. **Minus Balls, the Unban and Random Events.**
5. **Patrols, thread moves, shame titles and user groups, and the targeting cap.**
6. **Board shape, and hiring and firing.**
7. **Locks, petitions and crescendos.**
8. **A player's rename.**

## 17. The screens

- **The board's world:**
  - the presence boxes (section 2; mock `docs/research/2026-10-31-the-staff/mock-p1-presence.html`);
  - a Mod Bot's posts, profile and moderation log, as a Boss's;
  - user titles and group labels on the postbit;
  - "Moved:" stubs;
  - a restricted board's phpBB password form;
  - the report link on a post;
  - the public Acts of reports, verdicts, interceptions, pleas and rulings.
- **The glass:**
  - a visit's tag and stamp, overlaid and never reflowing the board;
  - the visit's plain detail and its interception challenge;
  - the report and appeal forms;
  - the Random Event banner;
  - the hide switch in My characters.

Each screen past presence is designed with the owner in its world's look, with its plan.

## The layers

- **The engine holds the mechanics:**
  - presence;
  - the visit timeline and its states;
  - the challenge kinds;
  - reports and their verdict set, patrols, appeals and their verdicts;
  - the move kinds of section 10;
  - the targeting cap;
  - the Random Event spawn;
  - the duties and their budgets.
- **The instance holds the content and the numbers:**
  - every Mod Bot's persona (name, title, avatar, signature, beat preferences, pet rules, strictness, weakness, quiz
    bank, bribe price, voice mode, what persuades it);
  - the starting staff;
  - Random Event lines, pictures and weights;
  - the old voice's frames and slots;
  - stock lines;
  - every number, as a setting.
- **How it reaches the engine:** through `Instance.system`, as the Bosses do. The engine never names a bot or Divided
  World ("KayfaBB never knows which instance it runs").

## Ways out of the states this adds

| State | Its way out |
| --- | --- |
| A mask hidden from presence | Its own switch, any time |
| A post under a visit | An interception by any character, or the visit's end at its stated time; then an appeal |
| A tail after a failed interception | It lapses after its 24 hours, or after the next post's visit ends |
| A report waiting on its judgment | Judged at once; a failed judgment refunds it |
| A punishment from a filed report | The warn bar's decay; an appeal; an admin's reversal |
| A shame title, jobber title or user group | Its demand, its expiry, an appeal or an admin's reversal |
| A push not lived up to | Stripped at its stated check; nothing worse |
| A thread retitled, moved, split or merged | Its demand, its expiry or an admin's reversal; everything returns |
| A restricted board | Group membership, the planted password, the demand, the expiry or an admin |
| A merged board | Its demand or its expiry splits it back |
| An archived hobby board | Its threads stay readable and continue as sequels; an admin or a later Boss can reopen it |
| A character at the targeting cap | Nothing to escape; staff simply can't choose it until the window passes |
| A fired bot | A later Boss's hire (staff, not a player) |
| An appeal whose judge failed | Refunded, and it can be made again |

## What could slip a mask

- **Presence** lists masks by their own activity: departures age out, the server checks who may present a mask, a hidden
  mask is never sent, there is no hidden count, and a swap never sends a paired leave and arrival.
- **Reports and interceptions** are public Acts naming their characters. They are allowed across one's own masks, so no
  refusal exists to leak.
- **Report quotas** are per character, never shared across a player's masks.
- **The targeting cap** counts public punishments of one character.
- **Bots' memory, beats and judgments** are written by the meeting and the judges from the digest, the post, the rules
  and the premise, all public. A judge is never given who owns a character or its class.
- **A tail** follows the character, not the account. A swap escapes it, which is a clue and the player's own doing.
- **Random Events** are drawn per player and seen only by that player, as Minus Balls are. A public one names its
  character.
- **Restricted boards' grants** and **user groups** are per character.

## Open

- Divided World's first roster of Mod Bots, with their weaknesses, quiz banks and pet rules, written with the owner
  before Part 3 ships.
- The look of a visit's tag and stamp, and of the interception challenge: designed with Part 3's plan.
- Which old model, on which host, for Divided World (#40).
- #55's plays, traps and card condition: its own design session.
- Feuds, matches, belts and the finale: their own design session.
- What a week of reports, patrols and appeals costs, measured once they run.
