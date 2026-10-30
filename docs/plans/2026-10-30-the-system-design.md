# The System: the Director, its moves and their ways out: design

Record, written 2026-10-30. The design session for The System's frame, with the owner, starting from the idea board
in issue #73. Its plan for Part 1 is `docs/plans/2026-10-30-the-system-plan.md`. It replaces the weekly board turnover
of the kit design (`docs/plans/2026-10-28-kit-step-1-design.md`, section 3) and takes up that design's section 8 on
Mod Bots and on players steering The System. Each section below was decided one question at a time; the owner's words
are quoted where they set the direction.

## The premise

The first idea was a weekly turnover: boards shuffled and archived at random each week, and a board "cleared" by
posting in it. The owner set both aside. A week is too short for the long haul: "Posts, threads, and forums are
expendable in the sense that they can be temporarily 'destroyed' as game events, but they can still be cherished, which
is what makes the destruction a meaningful event in the first place." And clearing gets it backwards: "a board people
post in is a board people like."

What the board shuffle was really after is nuisance administration: mods "trying to help" by closing boards, putting
them behind groups or passwords with arbitrary grants, retitling them, moving things without notice, policing with
arbitrary or contradictory rules, inventing rules, shaming people with ironic user groups, and boards that shift with
the owner's hobbies. "This is the kind of thing to chase." The Director "should probably feel more like absurd chess
moves than a big tornado."

**The Director is robo-McMahon.** "It's not just a big dumb robot, it's a big dumb robot that sees this board as its
toybox, our characters as its action figures, and it not only reports on good performances and mocks bad ones, but
demands the former and punishes the latter." Its hobbies, its opinions of characters, the meta and legacies are its
motivations, and everything it does ties back to them. "The System cares about us even though it is dumb." Left 4
Dead's Director still fits for when to act; this one is petty for years, not for a campaign.

**Two worlds.** In the board's world (2003) the Director is a character like any other, except that it is omnipotent,
and it is the characters' boss. From the glass, the player sees it from outside: "The Director is the character's boss,
but the player's Tamagotchi in some ways."

**Why the humor.** The masks let real emotions out, and "there really will be arguments, because we are playing with
emotions." This is part of why the game is 18+. "The humor of the system should ideally defuse these arguments by
showing us that they are absurd, something we will realize eventually anyway."

## 1. Scope

**Decided:** this design is The System's frame and its first moves. Feuds and matches, and the Mod Bots as personas,
are the next two design sessions; the frame is what they plug into. Weighed: everything in one design, with feuds and
Mod Bots squeezed in at the end; feuds and matches first.

## 2. How the Director runs: the meeting and its standing orders

**Decided:** a scheduled meeting plans, and plain code carries out its standing orders between meetings. The meeting
runs on a schedule (daily by default, an instance setting) on the stronger model tier. It reads the digest (section
5), updates its memory, and spends from its bank of moves (section 12), queuing each move at a go-live time it
chooses so the moves spread across the day. Between meetings, plain code applies what the meeting set: a broken rule
is punished, a met demand reverts its move, a marked thread locks when it crosses its line, all without a model call.

Cheaper model calls fill in micro-events inside the day's canon (the owner: "We can still use cheaper model calls for
smaller micro-events within the day's established canon"): a line when a standing order fires, a flavor reply. They
have a daily budget per instance; past it, standing orders still apply in plain code with stock lines from the
instance's content, so cost never grows without bound on a busy instance.

Weighed: the meeting alone, with nothing between meetings; event-driven calls, whose cost grows with activity and
which players could learn to trigger.

## 3. A move is a card: an effect, a demand and an expiry

**Decided:** every move is a card the board's admin plays against the userbase. It has an **effect** from the code's
fixed list, with limits; a **demand** the Director parameterizes from a whitelist of conditions code can check against
public Acts; and a **hard expiry**. Every move is an Act signed by the Director's character (section 4).

- **A met demand reverts the move early** and raises the Director's opinion of the characters who met it, in its
  memory; that feeds later pushes, titles and hobbies taken from them.
- **At expiry the move ends anyway** and the Director remembers the disappointment, which feeds its next meeting.
  Escalation is its judgment, never an automatic rule.
- **No Aura from The System.** Aura comes from performing a class to other players, and that economy is the game's
  core; Aura paid by The System would make playing to the robot a farming strategy. A demand may involve Aura players
  pay in (a petition's signatures), because players spend it.
- **The crowd judges, not the parties.** A condition between two characters is met by the crowd's reactions to what
  they post, never by their reactions to each other: two named characters may be one player's two masks, which can't
  react to each other, so a condition on reactions between them would fail for a reason that proves a private fact.
  The count reads only the public tally, since excluding the pair's own reactions would read who reacted. Instead,
  every reaction threshold is set above the reaction cap (3 per player per Act), so meeting it always takes at least
  one player outside the pair. Found while planning, after the session; the owner's call stands on the intent.
- **A way out is always reachable.** A demand nobody can meet would trap everyone ("No player is ever stuck"), so a
  move ends at its expiry or carries a fallback a player can always reach (the lock's petition, section 11).

The whitelist for Part 1 is in the plan; it starts with counts of posts, of distinct characters, of reactions in a
quadrant on a post or a board, a named character posting in a named thread, and Aura paid in.

Weighed: revert only, with no memory; revert plus Aura paid by The System.

## 4. The Director's mind: a profile in front, memory behind

**Decided:** the Director has a character of its own, with no account behind it, and a member profile written in
character that may bluff: Interests ("tomatoes, since Tuesday"), Favorite Members, a mood line, a signature that turns
with its hobby. Its real memory stays hidden and drives its moves: its current hobby and where it came from, its
opinion of each character, its grudges, the rules it has made, the wheelhouse it has learned, the real-world subjects
it leaves alone. Memory changes often, so under "Append-only" it lives in rows of its own, a new version at each
meeting, never in an Act. The gap between profile and behavior is part of the comedy ("Favorite Members: Pipewrench",
the week it permabans Pipewrench).

**The glass shows its moves plainly.** For each move in force: what it did, its demand and how far along it is, and
when it expires, in plain words and never in character. That is where "No player is ever stuck" is kept while the
board's world bluffs.

**Hobbies** are absorbed from characters it thinks are cool and dropped when they disappoint it, mixed with outside
material in the userbase's wheelhouse (the owner: "any events in the userbase's wheelhouse (helpful if this is learned
information over time)"). Outside material comes from feeds an instance lists, fetched by plain code and handed to the
meeting as text, never through a provider's search tool ("Portable by construction"). What the old voice writes
(section 6) may leak into its tastes, as input to its next meeting.

Weighed: hidden entirely; fully public memory, which kills the bluffing and makes its opinions a stat sheet.

## 5. What it reads: a digest of public play, built by a role that cannot read the private

**Decided:** a digest of fixed size, built in plain code: the hottest threads ranked by heat and by controversy (how
split their reactions are across quadrants), with their instability; who settled up or down; demands met and failed;
quotes and replies that cross between characters; its moves and how they landed, and the reactions its own
announcements drew; excerpts from the top posts; the outside feed; its own memory. Its size is capped however busy the
instance is ("Weigh a design at the scale of a busy instance").

The digest is built by a database role that **cannot read** who owns a character, a character's class or who reacted,
held by a test that drives it red on a planted read. "Its opinions come from public play" is then held by the database,
not only by a prompt ("A response never proves a private fact").

Weighed: everything since the last meeting; the digest plus tool calls, kept as a later extension the interface leaves
room for.

## 6. The model interface: two modes, and the old voice self-hosted

**Decided:** one provider-neutral interface with two modes. **Chat with structured output** carries the meeting, the
micro-events, the rename judge and appeals. **Raw completion** (prompt, temperature, top-p, stop sequences, a token
cap) speaks the OpenAI-compatible completions shape that llama.cpp, vLLM and text-generation-inference serve, and an
instance points it at a small server of its own running an open-weights 2019–2021 base model (GPT-2 XL or GPT-Neo),
priced at an explicit zero. If that server is down, a stock line from the instance's content stands in and nothing
stalls. The owner: completion mode is "potentially helpful for some as-of-yet-unknown postcard effects or a
particularly unhinged mod bot."

The meeting runs on a stronger tier; micro-events, the rename judge and appeals on Haiku; each tier is an instance
setting. Every call writes a cost row priced from the provider's usage block, and a model missing from the price table
throws ("Cost is a column, not a report"). What the meeting costs a week is measured once it runs.

Weighed: chat only, with a modern model told to write badly (#40: it performs the voice and the nonsense winks); the
old model on a hosted platform, which drops old models.

## 7. What admins see first

**Decided:** structural moves wait about 24 hours in the admin queue and go live unless an admin holds them: creating,
merging or restricting a board, renaming a board, a permaban. Small moves land when the Director scheduled them: a
lock, a retitle, a moved thread, a shame title, a rule, a timed ban. An admin can reverse any live move with an admin
Act; the Director learns of it at its next meeting, in memory only. A held move never happens, so players never see
it. This rewords `CLAUDE.md` ("The System acts", the opening's word list, and "No player is ever stuck"), in this
design's PR.

Weighed: every move waiting a hold window, which makes a lock a day late; no preview at all.

## 8. Rules and the warn bar

**Decided:** a rule is an Act: a predicate from a fixed list, a scope (a board, or every board), a band, and an
expiry. A rule **never refuses a post**; the post goes up and the punishment follows. Code checks before a rule goes
live that a compliant path still exists.

The punishment is a warn bar, lifted from the old forums (the owner: "the way it worked originally was honestly
already pretty gamified"). A broken rule adds its band's points to the character's bar, and each infraction expires on
its own. A full bar brings a timed ban and empties; each ban in a season is longer than the one before; the ladder
resets with the season. The bar shows on the postbit, the broken post carries a layer ("This post was found in
violation of Rule 4"), and the character's own log says plainly which Act broke which rule, the points, and when they
expire. The code holds the bands, the decay and the ladder; the Director's judgment is only which band a rule gets.

Weighed: each rule naming its own punishment; violations flagged for the next meeting.

## 9. Renames: The System's and a player's

**Decided:** a board has a **premise** (its subject) and a **name**, both computed from rename Acts as a post's text is
computed from its edits.

- **The Director's rename** changes both. The name is PPP-shaped: three alliterative words, or a take on "Pointless
  Post Palace" (Pointless Toast Palace, Pirate Puns Palace), not bound to the board's old name or initials. The
  subject really changes, and the regime enforces it; old threads become contraband that may be moved out under a
  "Moved:" stub. It is a structural move (section 7).
- **A player's rename** is an Act others can react to. It changes the name only, free-form (the owner: "more open than
  the 3-word alliterative shape"), held to the ordinary length and blank rules. A Haiku judge, in the Director's
  persona, decides whether it still fits the board's premise; its verdict is one of a fixed set and its free text is
  shown. It costs six orbs by default, paid with the proposal; a rejection refunds all but a fee (3.00 by default, so
  it is a real bet: "losing only one isn't much of a risk"). Any rename starts a cooldown on the board (a week by
  default).
- **Every rename gets a description from the old voice** (section 6), based loosely on the premise, which may then leak
  into the Director's tastes.

Weighed for a player's rename: paying only on acceptance, which makes the judge a free name-checker; a rejection
keeping everything.

## 10. Bans, the permaban, the Unban and Minus Balls

**Decided:** a banned character cannot post, react or play cards, but can browse, and its postbit shows BANNED. Each
ban's character log says why, until when, and how this kind of ban ends. Harshness is allowed because the masks
protect the player: the Director can never know who owns a character, so its grudges land on masks, never on the
friend behind them.

- **The permaban** is the ladder's top (the third full bar in a season, a setting: three strikes, game over) and also a
  structural move the Director can make outright. The owner: "Permaban is a funny 'game over' state so it's worth
  putting in early." It still takes a roster slot, until the Pound frees one.
- **The Unban** is the way out. It comes in a gold Minus Ball, only to a character that is banned. It is used where it
  is found: bound to that character, never stored, so no hand holds fifty and no mask passes one to another, which
  would hint at who owns what. Its chance starts low and climbs with time banned until it is certain by a stated day
  (14 by default), which the log says plainly. The character comes back on parole with its warn bar half full. A ban
  stays "a real inconvenience to clear."
- **Minus Balls are a general spawn** for every character (the owner: "a general feature for unbanned players too,
  containing good-condition cards, gear, etc."). A ball appears at a random spot on a page load; the server decides
  each spawn and a claim must name one it issued, so reloading cannot farm them; the hourly cap is per account, seen
  only by its player. Its keyboard path costs what the click costs ("An accessible path costs what the obstacle
  costs"). The first pool holds the Unban and the cards that exist; gear joins with #35's design and card condition
  with #55's. Luck may lean toward a character on a cold streak, read from its public standing. The rainbow ball is
  the ordinary drop and the gold ball the rare tier; the art is the owner's (`docs/research/2026-10-30-the-system/`),
  and the engine knows only a spawn, a pool and a claim.
- **The heist protocol** for a permaban stays the stretch goal: a second, active way out a later design adds beside
  the Unban.

Weighed: the permaban as a Director move only.

## 11. Locks, petitions and sequels

**Decided:** a thread's instability is computed in plain code from public facts (its length, its posts per hour, how
long it has run hot). The Director marks threads on thin ice at a meeting, and a marked thread locks when it crosses
its line, with an in-character reason. A lock is a move, so the Director picks its demand from the whitelist: a
petition (distinct characters sign, each paying Aura, 0.25 by default), a fund (anyone pays toward a target), or a
demand that isn't Aura ("the thread's two loudest characters each post an apology"). A lock whose demand isn't Aura
carries a fallback petition, so a reachable way out always exists, and a lock has no expiry: a locked thread stays
locked unless people rally, which is the classic forum outcome. Met, the thread unlocks with its instability halved.
The sequel needs nothing new: "Official X Thread v2" is a thread spun from the lock Act. An admin can always unlock.

Weighed: always a petition; always a fund.

## 12. The bank of moves

**Decided:** a fixed weekly budget (5 by default) that the Director may bank up to a cap (twice the weekly budget), so
it can sit quiet and then binge. Carrying out standing orders never spends it. The budget never depends on activity, so
players cannot manufacture moves and the cost stays flat on a busy instance.

Weighed: a fixed budget with no bank; a budget that grows with activity.

## 13. Controversy, crescendos and interventions

**Decided:** the Director prefers controversy. The owner, from Left 4 Dead's commentary: the game was "too boring, a
rush from A to B, until they added 'crescendo events'." A **crescendo** is a declared event: the Director spends banked
moves to declare one around a focus (a thread, a feud or a board) for a stated window of 24 to 72 hours. A banner runs
across the board; stakes rise by bounded multipliers on things the code already limits (instability lines drop, warn
points double, rare spawns are likelier); and it ends in an aftermath announcement, with its memory recording how it
went.

**Kayfabe is stoked; a real argument is deflated.** When the Director reads a disagreement as genuine (heated in a way
that isn't a performance, or on a subject on the instance's real-world list), it moves to make the fight look absurd,
never to take a side: an **intervention**, a crescendo aimed at deflating, with the same window, banner and aftermath.
The joke is aimed at the argument, never at a person. The real-world list is the instance's content, learned beside the
wheelhouse and editable by admins. Reading which is which is a judgment from context; it will sometimes be wrong, and
that is survivable because every move is bounded and has a way out.

Weighed: no structure, a crescendo as only spending the bank; players igniting crescendos, which makes the Director's
choice of moment a toll.

## 14. Appeals, and the staff

**Decided:** an infraction, a ban, a shame title or a move aimed at one character can be appealed once, for Aura (0.50
by default, refunded if overturned). The verdict is one of a fixed set: overturned, upheld, reduced, or increased
("for wasting the staff's time"), the increase capped by the code. A Haiku judge reads the plea, what was done and why,
and the Director's opinion of the character; its free text is shown as the ruling. Pleas that try to steer the model
are part of the game (kit design, section 8), bounded by the fixed verdicts.

**The staff.** The engine has duties (the meeting, hearing an appeal, judging a rename, the line a standing order
speaks, a micro-event), each assigned to a member of staff, and for now every duty belongs to the Director. The owner:
"the director is the big cheese and the mod bots are its henchmen to take a load off of it; in the backend everything
can go through the director until we build in the granularity of the mod bots." The Mod Bots session adds henchmen and
reassigns duties without changing what a duty does.

Weighed: appeals waiting for the Mod Bots; appeals heard at the next meeting.

## 15. The order of building

**Decided:** five parts, each its own plan written from this design, with no new design questions unless an earlier
part raises some.

1. **The skeleton, with one move:** the model interface in both modes, the cost ledger and price table; the Director's
   character, profile and memory; the digest and its role; the meeting and the bank; moves, demands and expiries; the
   admin queue; and the Director renaming a board end to end, with premise, name and old-voice description. Its plan
   is `docs/plans/2026-10-30-the-system-plan.md`.
2. Rules, the warn bar, bans, the permaban and appeals.
3. Minus Balls and the Unban.
4. Locks, petitions and crescendos (interventions with them).
5. A player's rename.

Weighed: plain-code parts first, built before the thing that makes their rules; everything in one plan.

## 16. The screens

**Decided** with mocks after the plan was first written (`docs/research/2026-10-30-the-system/`): a move in force
shows on the board it changed as the Director's 2003 notice, with its Act's long label in glass on its corner ("THE
SYSTEM RENAMED THIS BOARD"), a plain way-out segment that opens the detail, and its top reactions, small; the
Director's profile is an ordinary profile with an admin's fields, plus a moderation log of every move and how it
ended; the admin queue is a glass page grouped by what an admin can do (waiting to land, in force, ended). Weighed: a
glass panel set into the board, and a HUD chip; a garish staff page; one feed of every move.

## The layers

The engine holds the meeting, the bank, the move catalog and its effects, the demand whitelist, the digest and its
role, the model interface and ledger, the warn bar, the spawn, and the staff duties. The instance holds the Director's
persona and prompts, its stock lines, the outside feeds, the real-world list's starting entries, the PPP style, the
Minus Ball's name and art, and every number as a setting. The persona and prompts reach the engine through the
instance seed, as classes and cards do ("KayfaBB never knows which instance it runs").

## What could slip a mask

- **The digest** is read by a role without the private columns (section 5).
- **Demands** read only public tallies, with every reaction threshold above the reaction cap (section 3).
- **The Unban** is bound to the character that finds it (section 10).
- **The Minus Ball cap** is per account and seen only by its player (section 10).
- **The Director's opinions** come only from the digest, so its favor and its grudges are computed from public play.

## Open

- What feuds and matches are: the next design session (#73's sketch is its start).
- The Mod Bots as personas, and which duties move to them: the session after.
- The heist protocol's design.
- Which outside feeds Divided World lists, and how the wheelhouse is learned past its first entries.
- Which old model, on which host, for Divided World.
- What a week of meetings costs, measured once it runs.
