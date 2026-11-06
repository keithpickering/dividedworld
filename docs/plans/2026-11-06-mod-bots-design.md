# Mod Bots: the Boss's orders, rules, visits, reports, appeals and patrols: design

Record, written 2026-11-06. The design session for Part 3 of the staff design (`docs/plans/2026-10-31-the-staff-design.md`,
section 16), with the owner. It builds on what that design decided and on what has been built since: The System's Part 1
(migrations 0042 to 0053, `engine/system/`, `supabase/functions/meet/`), the staff roster and its Personality Cores
(`docs/plans/2026-11-02-staff-roster-design.md`, migrations 0082 to 0090), card plays and traps
(`docs/plans/2026-11-01-card-mechanic-design.md`), a Mod Bot's card options (`docs/plans/2026-11-05-bot-card-options-design.md`),
meta acts as Marks (`docs/plans/2026-11-06-meta-acts-design.md`) and the board look's "who speaks" (`docs/plans/2026-11-06-board-look-design.md`,
section 7). Its plan is `docs/plans/2026-11-06-mod-bots-plan.md`. Each section was decided one question at a time; the
owner's words are quoted where they set the direction, and where the owner chose the proposal as put, the section says so.

The owner opened it: "We need to make sure the plan aligns with recent work that has been done with Personality Cores
and staff offices. A Mod is essentially a Boss with a bit less power."

Where this design says "the Boss", it means the season's Boss. "A Mod" is a persona in the Mod Bot office
(`staff_now`, `0082_offices.sql`). Where it amends the staff design, it says so; everything that design decided and this
one does not touch stands.

## 1. The old voice stays; the Boss writes a board's description

The owner's first thought was that "the 'outdated LLM' bit might be too much work for too esoteric a payoff, and we
might as well just let the Boss write the descriptions in character with admin overrides." It is built and working
(`supabase/functions/_shared/models/completions.ts`, `instances/divided-world/system/old-voice.ts`), so the owner kept it
where a persona chooses it: "It's still funny to have a personality core who just 'doesn't work quite right' as an
option."

**Decided** (the owner chose C, with the reason above):

- **A rename's description is the Boss's.** `renameBoard`'s `description` is written by the Boss in its meeting answer,
  in character, in the same call that chooses the rename. The old voice no longer writes it, and the meeting makes no
  completion calls. A missing or unrepairable description falls back to the instance's stock `boardDescription` line, as
  today's failed completion does. `SystemContent.oldVoice` (the description frame) goes, with its instance file.
- **The old voice stays for personas.** A persona with `voice: 'oldVoice'` keeps raw completion for its pool posts
  (`supabase/functions/chatter/core.ts`) and for a visit's arrival and filing lines (section 6). Every judgment (a report,
  a patrol's sample, an appeal) is a chat call whatever the persona's voice, because its verdict must come back in
  structure; an old-voice persona's judgment is written by the chat model in its persona.

**Admin overrides** (the owner chose A):

- **In the queue.** A rename is structural, so it already waits about 24 hours in the admin queue with its description
  quoted (`engine/ui/admin/Queue.tsx`). An admin may write a replacement there. It is kept on the queue row with who wrote
  it and when, and when the rename lands the tick writes the rename Act with the Boss's words and then an admin's
  `describeBoard` Act with the replacement.
- **After it lands.** An admin may replace any board's description at any time with a `describeBoard` Act.
- **Computed, never edited.** A board's description is the latest of its rename and describe Acts ("Append-only"), so the
  Boss's words stay underneath and the board's history shows both.

Weighed: removing the old voice whole, which the owner set aside once it was clear it was built; keeping raw completion
in the engine with no persona using it; for overrides, the queue only (a landed description could then only be fixed by
reversing the rename) and after landing only.

## 2. A Mod is a Boss with less power: the Boss orders, the Mods spend

The staff design set aside a meeting per bot and made the Mods the Boss's hands, acting only through duties. The owner
weighed the two again: "Opus orchestrating a day's worth of moves might add a certain narrative that individual
meetings could miss. But individual mod decisions on a cheaper model might be able to act more quickly (participating in
the board more actively)."

**Decided** (the owner chose the recommendation): the Boss's meeting stays the one strong-tier call that writes the day.
Its answer gains **orders**, one for each Mod on staff:

- **A beat:** the boards it watches. Every board is on exactly one Mod's beat. A board the answer leaves out is given by
  plain code to the Mod whose beat preferences (`Persona.beats`) match it, and otherwise to the Mod with the fewest
  boards, so a meeting that fails or forgets never leaves a board unwatched.
- **An order:** one line in the Boss's voice ("crack down on bumping in Games"), at most 200 characters, read by that Mod's
  calls until the next meeting. It is shown, never acted on.
- **An allowance:** a number of moves the Boss hands the Mod out of its own bank (section 3).

The Mods spend between meetings, in the calls they already make on the light tier: a patrol's judgment (section 8), a
report's verdict (section 7) and a visit's filing (section 6). Each such call may carry **at most one move**, only while
the Mod has allowance left, and only of a kind its office may make, on a board of its beat. So a Mod acts in the moment,
and the Boss's one call keeps the story.

**"Less power" is concrete:**

| | The Boss | A Mod |
|---|---|---|
| Decides in | its daily meeting (strong tier) | its judgments and filings (light tier) |
| Moves from | its bank, earned by phase | an allowance the Boss hands it |
| Move kinds | every kind | the kinds marked for the Mod office |
| Where | any board | its beat's boards |
| A rule lasts at most | the phase's `moveExpiryMostDays` | `modRuleDaysMost` (7 days by default) |
| Structural moves | yes, through the admin queue | none |

**Each move kind names the offices that may make it.** `setRule` (section 4) is the Boss's and a Mod's; `renameBoard`
and `nameSuccessor` stay the Boss's. Part 5's titles and thread moves, and #279's member groups, name their offices when
they are designed.

**A Mod's memory** is written by the Boss's meeting from that Mod's notes, as the staff design decided (section 3 there):
the answer carries a bounded memory update for each Mod on staff. A Mod's career, notes and memory stay its own and
outlast the Boss.

Weighed: a meeting per Mod on the light tier, which acts on its own but loses the day's one story and lets two Mods'
moves clash by accident; the Mods carrying out duties only, as the staff design had it, which leaves them tools; Mods
proposing moves for the Boss's next meeting to approve, which costs two calls a move and never lets a Mod act.

## 3. The allowance comes out of the Boss's bank

**Decided** (the owner chose the recommendation):

- The Boss hands moves from its own bank to Mods at its meeting. A move handed away is one the Boss does not make, so
  the season's arc (a quiet honeymoon, a loud meltdown) paces the Mods too, and the moves an instance sees never grow
  with the size of its staff.
- What a Mod has not spent by the next meeting goes back to the Boss's bank before that meeting reads it, never above the
  phase's bank cap.
- No Mod holds more than `modAllowanceMost` at once (3 by default), which the code clamps and records as a trim.
- A Mod's allowance is spent when its move is queued. A move dropped by the repair (a kind its office may not make, a
  board off its beat, a rule with no compliant post) spends nothing.

Weighed: an allowance of each Mod's own, which keeps Mods busy under a stingy Boss but grows with the staff; a base
allowance plus what the Boss hands on.

## 4. Rules

The System's design (section 8) made a rule an Act: a predicate from a fixed list, a scope, a band and an expiry, and a
rule never refuses a post. It left the list unwritten, and the personas' `petRules` are empty today.

**Decided** (the owner chose the list as put): the engine's fixed list of predicates. Each is checked by plain code when
a post is made, reading only the post, its thread and the character's own public posts, never who owns the mask. Each
takes a parameter the engine bounds.

| Predicate | Broken when | Param |
|---|---|---|
| `minLength` | a post is shorter than N characters | N |
| `maxLength` | a post is longer than N characters | N |
| `noAllCaps` | most of a post's letters are capitals | none |
| `noDoublePost` | a character replies directly under its own post in the same thread | none |
| `noNecropost` | a reply comes to a thread quiet for more than N days | N |
| `noDuplicateTitle` | a new thread's title matches a live thread's title on that board | none |
| `bannedWord` | a post contains a word | the word |
| `requiredWord` | a post leaves out a word | the word |
| `noTag` | a post uses a BBCode tag | the tag |
| `repliesOnly` | a new thread is started on the board | none |

- **A rule is a move,** `setRule`: a predicate and its parameter, a scope (one board, or every board for the Boss), a band
  (section 5) and an expiry. It is a small move: it lands within a minute through the tick, and is announced on Staff
  Announcements by the staff member who made it, in its stock line. The glass labels it by role, as the board look
  decided: "The Boss set a rule", "A Moderator set a rule".
- **A compliant post must exist.** Before a rule is queued, code checks it against the rules in force on its board:
  `bannedWord` and `requiredWord` on the same word, `minLength` above a `maxLength`, `noTag` on a tag a `requiredWord`
  cannot be written without. A rule that would leave no compliant post is dropped and recorded, spending nothing.
- **Pet rules** are predicate keys a persona lobbies for. The meeting and a Mod's calls are shown them; nothing makes a
  Mod set one.
- **A rule ends** by its expiry, by its demand where it has one, or by an admin's reversal, as every move does.
- **Rules are numbered per board** in the order they land ("Rule 2"), so the layer and the log can name one.

## 5. The warn bar and timed bans

**Decided** (the owner chose the defaults as put; each is an instance setting):

- **The bar** holds 10 points. A **minor** breach adds 2, a **moderate** one 4, a **severe** one 7. Obstruction (a failed
  interception's tail, section 7) is always minor.
- **Each infraction drops off on its own** 14 days after it lands.
- **A full bar** brings a timed ban on that character and empties the bar. The ladder is 1 day, then 3, then 7. Every later
  ban in the season is 7 days, until Part 4's permaban takes the ladder's top. The ladder resets at the season's end.
- **Points land when a visit files,** not when the post is made (the staff design, section 5).
- **A banned character** can browse but cannot post, react or play cards. Its postbit says BANNED. Its log says why, until
  when, and that the ban ends by itself.
- **Bans are per character.** The owner: "the in-universe permas should be per character so continuing participation in
  the board is as simple as switching to another character in the mean time." That holds for every ban, timed or
  permanent.

**The permaban moves to Part 4** (the owner chose the recommendation), with the Unban that is its way out, so it is never a
state whose only exit is an admin.

## 6. Visits

As the staff design (section 5) decided, with what this design adds:

- **What sends one:** a post breaking a rule in force (plain code, at once, the Mod on the board's beat, the rule as its
  charge); a report's verdict (section 7); a patrol's finding (section 8).
- **A visit is built from Acts:** its start (the Mod, the post, the charge, the band, its end time), each interception
  attempt, and its filing or its end. Its state is computed from them; a timer row the tick reads points at the start
  Act, as a splat's wash row does.
- **Its window** is set by the Mod's strictness (`Persona.strictness.visitHours`), clamped into the engine's 2 to 12 hours.
- **One visit per post at a time.** A second charge joins the open visit, bounded by the bands' cap (the severe band).
- **Filing.** At its end the tick files it. The band's points land on the author's warn bar, the post takes its layer
  ("This post was found in violation of Rule 2: No double posting."), and the Mod's filing line is posted on the visit.
  The filing line is a light-tier call in the Mod's voice (the old voice for an old-voice persona), within the duty's
  daily budget, else a stock line. That call may carry the Mod's one move (section 2).
- **The author gets no alert.** Their log says what happened when it ends, in plain words.
- **The card hook:** the card design's `visit` trap trigger is wired. A trap set on a post springs when a visit starts
  on it: the visit ends, and its Acts stay.

## 7. Reports, interception and appeals

As the staff design (sections 6, 7 and 9) decided. Restated, with where each now lives:

- **Reports.** "Report" in a post's foot links opens the report form in the glass. A report costs 0.25 Aura, a character
  makes at most 3 a day (per character, never per account), and it is a public Act naming its reporter, with the
  reporter's reason. The Mod on the board's beat judges it at once on the light tier: a visit (with its charge), dismissed
  (the Aura is spent and the Mod grumbles in public), or backfire (a visit to the reporter's latest post, for wasting the
  staff's time). The verdict is a public Act. The instance's daily budget for judgments is checked before the report is
  paid, and a failed judgment refunds it.
- **Interception.** Any character reading the thread may try once per visit: the Mod's quiz (one question drawn when the
  visit starts, the same for everyone), its bribe (paid in, going nowhere), or a distraction. **A distraction** is any
  card Cast at thread reach on the visit's thread by the interceptor while the visit is open; it counts as that
  character's attempt and always succeeds. Success ends the visit as a public Act by the interceptor. Failure tails the
  interceptor: its next post within 24 hours draws a visit for Obstruction.
- **Appeals.** The Mod that filed hears an appeal of what it filed, in its own voice, persuaded by its `persuadedBy`. A
  ban is appealed to the Boss. 0.50 Aura, refunded if overturned; one appeal per punishment; overturned, upheld, reduced
  or increased (by at most one band's points). The plea and the ruling are a public pair of Acts. A failed judge refunds
  the fee and the appeal stays available.

## 8. Patrols and the targeting cap

Both move up from the staff design's Part 5, because patrols are where a Mod notices things and spends its allowance.

- **Patrols.** The Boss's meeting dispatches up to `patrolsPerDay` (6) patrols at times it chooses, each to a Mod and its
  beat. Plain code samples `patrolSample` (5) recent posts on the beat; one light-tier call in the Mod's voice judges each
  against the board's premise and the rules in force. A finding sends a visit. The call may carry the Mod's one move. The
  cost is flat however busy the instance is.
- **The targeting cap.** At most 3 punishments chosen by staff land on one character in any 7 days (both settings). It
  counts patrol findings and backfired reports. It does not count rule breaks, a player's report or a tail. At the cap,
  staff cannot choose that character: a patrol's finding against it is dropped and recorded, and nothing is shown. It
  reads only public punishments.

## 9. The screens

Mocks in `docs/research/2026-11-06-mod-bots/`, shot from the built Lens story with the visit's pieces laid in
(`shoot.cjs` writes them). The owner approved the direction, with three changes that the mocks now carry: "style the
warning meter like a thermometer, simple vector with a red fill, very era-appropriate"; "make the quiz answers full-width
block buttons since they're each on their own row anyway"; and the spacing under "Talk it down" matching the heading
above it.

- **A visit is a mark** (`01-on-a-visit.png`). It sits on the post's date bar with the Marks' glass tile, in the visit's
  yellow, with a stopwatch icon and the time left ("2:41"), or "Filed" once it files. It is a meta act like a card play
  (the meta acts design), so it needs no stamp of its own.
- **The Lens opens on the visit.** One tab, "On a visit" or "Filed":
  - its plain state (who is visiting, the charge and band, what lands on whom and when);
  - "Talk it down", with the challenge: the quiz's answers as full-width block buttons, the bribe's price, or a word
    that a thread-reach card is a distraction;
  - "How it went": the report, the verdict, each attempt and the filing, as Lens rows, each with React and Spin thread.
- **Filed, as the author sees it** (`02-filed-author.png`). The board's notice ("This post was found in violation of Rule
  2: No double posting.") is a plain bordered italic line at the top of the post, in the board's world. The Lens shows
  what landed, when it drops off, and Appeal with its price and terms, to the author alone.
- **The report form** (`03-report.png`) opens from "Report" in the post's foot links, in the same glass panel: who judges
  it, the three verdicts, a reason field, "Report · 0.25 Aura", and how many reports the current mask has left today.
- **The warn meter** is in the postbit, in the board's world: "Warnings: 6/10" over a small vector thermometer with a red
  fill. A character with an empty bar shows none.
- **Presence** (`04-presence.png`): a visiting Mod is listed in "Users browsing this thread" with a glass tag, "On a
  visit · post #41", linking to the post, laid over the line and never reflowing it.
- **The phone** (`01-on-a-visit-phone.png` and the other `-phone` shots): the Lens takes the screen's width under the
  post, as it does for cards.
- **Every control is a button reached by keyboard,** and the challenge has no timer ("An accessible path costs what the
  obstacle costs").

## The layers

- **Engine:** the predicates and their checks; `setRule` and `describeBoard`; offices on move kinds; orders, beats and
  allowances; the warn bar, bands, decay and ban ladder; visits and their states; reports and their verdicts;
  interception and its challenge kinds; appeals; patrols; the targeting cap; the duties and their budgets; the visit
  mark, its Lens tab, the report form, the warn meter, the violation notice, the presence tag.
- **Instance:** each persona's beats, pet rules, strictness, weakness (with its quiz bank or bribe price), voice and
  `persuadedBy`; stock lines for a rule landing, a visit's arrival and filing, a dismissal and a backfire; the role words
  ("A Moderator"); every number, as a setting.
- **How it reaches the engine:** `SystemContent` (personas, stock lines), `Settings` (numbers), `InstanceUi.copy` (role
  words). The engine names no persona and no instance.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A post under a visit | An interception by any character; the visit's end at its stated time; then an appeal |
| A tail after a failed interception | It lapses after 24 hours, or after the next post's visit ends |
| A report waiting on its judgment | Judged at once; a failed judgment refunds it |
| Points on the warn bar | Each drops off 14 days after it lands; an appeal; an admin's reversal |
| A timed ban | It ends by itself at its stated time; an appeal to the Boss; an admin's reversal |
| A rule in force | Its expiry, its demand, or an admin's reversal |
| A character at the targeting cap | Nothing to escape: staff cannot choose it until the window passes |
| An appeal whose judge failed | Refunded, and it can be made again |
| A Mod's unspent allowance | It returns to the Boss's bank at the next meeting |

## What could slip a mask

- **Rule checks** read the post, its thread and the character's own public posts. `noDoublePost` compares characters,
  never accounts, so a player answering one mask with another breaks nothing.
- **Reports** are public Acts naming their reporter. The quota is per character. The daily budget refusal reads one
  instance-wide count.
- **Interceptions and attempts** are public Acts naming their characters, allowed across one's own masks (the staff
  design, section 6), so no refusal exists to leak.
- **Judgments, orders and patrols** are written from public play: the post, the rules, the premise and the digest. No
  judge is given who owns a character or its class.
- **The targeting cap** counts public punishments of one character.
- **A tail and a ban** follow the character, not the account. A swap escapes them, which is a clue and the player's own
  doing.
- **The report form's "reports left today"** is the current mask's own count, shown only to its player.

## A busy instance

- The Boss's meeting stays one call a day. Its orders grow with the staff, which is a handful whatever the player count.
- Mods' moves come out of the Boss's bank, so the moves an instance sees are paced by phase, never by staff size.
- Patrols are a fixed count with a fixed sample. Report judgments have a daily budget. Visit filings have the filing
  duty's daily budget, past which a stock line stands in.
- Rule checks run once per post, against the rules in force on its board (a handful), reading indexed rows: the previous
  post in the thread, the thread's last post time, live titles on the board by an index on the title.
- The tick files visits from a partial index on open visits due, as it lands moves today.

## Open

- Divided World's Mod roster's pet rules, weaknesses, quiz banks and bribe prices, written with the owner before the
  System is turned on (the staff design's open item).
- Member groups (#279), shame titles and thread moves: Part 5, each naming its offices.
- The permaban and the Unban: Part 4.
- What a week of reports, patrols, filings and appeals costs, measured once they run.
