# Starting the repository: premise, nouns, stack and method

Record, written 2026-10-28. The design session that set this repository up with the working method from currents
(the `currents-kit` skill in keithpickering/claude-skills, step 1, synced to currents at f6aa96d). It read `spec.md`,
the MVP specification the owner wrote with Gemini, as input, not as a plan. Each section below was confirmed by the
owner before the next began.

## 1. Who plays (Q1)

**Decided:** a cast of people who have known each other for over twenty years, across MFGG and then Minus World, whose
second version (2015) first added the gameplay. 18+, not for explicit content but because the game asks for a shared
social context in which its "harassment" reads as play: friends who shoot each other in a shooter and stay friends.
Registration is open, so nobody who likes the idea is stopped; the game is designed around the known cast, and an
instance setting chooses open, invite-only or closed registration. Small is a choice of play ("you're always wondering
if a character is a person you know"), never a limit of the architecture.

Alternatives weighed: invite-gated growth to hundreds; open public signup. Autocorrect and Stick Around come from Minus
World, and more of its postcards will follow; the old forums are likely offline, so the Wayback Machine is the
reference, fetched rather than recalled.

## 2. Engine and instance (Q2)

**Decided:** the system is **KayfaBB**, an open-source engine other groups can fork, and **Divided World** is its first
instance. One repository now, in two layers (the engine, and the instance's content beside it), with a build check
that the engine never imports an instance. The engine moves to its own repository when it is first published as open
source, so this repository never maintains another community's instance. Alternatives weighed: two repositories from
the start; build Divided World alone and extract later.

## 3. The System (Q3)

**Decided:** The System acts on its own inside effects the code defines and bounds; nothing destroys what a player
wrote; the weekly board list goes to admins about a day ahead and goes live unless held. The owner's frame: The System
is "irony-aware RNG", like the Director in Left 4 Dead, whose decisions are informed by the state of play. So what The
System reads (streaks, recent punishments, which threads are boiling) is as much its design as its prompt. Alternatives
weighed: fully autonomous; an admin signs every ruling.

## 4. Nouns

**Decided:** player (the person behind the masks), account, character, Act, The System.

## 5. Stack and portability (Q4)

**Decided:** Vite, React and TypeScript with Motion and Storybook, served as a static site (Netlify); Supabase
(Postgres, Auth, row-level security, Realtime, Edge Functions, pg_cron), one project per instance. The server decides
every game rule and the client only previews. The weekly Director runs on a stronger model than the appeals, which run
on Haiku; every model call writes a cost row. impeccable is installed for its accessibility and focus checks, but is
briefed on the 2003 BBCode house style before it judges anything.

Portability: Supabase is the platform and self-hosted Supabase is the way out; rules in plain SQL and pure TypeScript;
one provider-neutral model interface; an instance's export round-trips. Alternatives weighed: full portability with
adapters (currents' form); Supabase cloud with no portability work.

## 6. Stage (Q5)

**Decided:** the kit's Stage 1, the method. The owner starts sessions and merges. The cockpit comes when several build
sessions are in flight at once.

## 7. Which rules came across (Q6 and the table)

Carried: How a task starts here; Nobody is waiting on a hotfix; This repository copies; A guard that has never been
red; Two lists that must agree; A test that builds its own subject; Record every schema change as a migration; Write in
American English; Cost is a column; A validator tighter than the schema; Three unrelated timeouts; A path in prose; A
rule that fights the product; A standing permission is written down (Closing an issue, Build sessions and every
subagent, Secrets, Tidying).

Rewritten for this game: "The AI proposes; a person signs" became "The System acts; it never destroys what a player
wrote"; "Understanding may fall, but it must never be stuck" became "No player is ever stuck"; "Write for a member's
understanding" became "The fiction may lie; the log never does" (Q6: chosen over an opaque game and over an honest
System); "Never answer whether an address has an account" widened to "A response never varies with a private fact";
"Portable by construction" took section 5's form; "Weigh a design at the scale of a real workspace" became "at the scale
of a busy instance". New: "KayfaBB never knows which instance it runs".

Left out, as currents' product: Read the authority; Read a publisher; One automation is a hope; Real documents are the
test of record; Read it well once; A citation that finds nothing; Deploy markers; and the spending and owner's-documents
permissions. Not carried yet, to enter when an incident earns them: Derive every number; A fallback gated on
"nothing"; Count the second way; An experiment is run once; A finding with a parent.

## 8. What the spec review found, for the design sessions ahead

Read critically against the decisions above. None is settled; each is a question for the design session that takes up
its area.

**The game's loop**
- Guessing a class pays off only as griefing: the one place deduction is rewarded is naming a suspected griefer for a
  ward. Deduction could be the core action rather than a defense.
- Reactions that are currency stop being honest signals, and friends will feed each other's classes. A player's own
  characters reacting to each other is refused by the server; a second email address is a social matter here.
- No stated goal: Aura is both score and wallet and is capped at six. What a player works toward over a season is open.
- The shared account inventory moves Aura between masks (farm on one, play cards as another), suggests who owns what
  (a rare card seen on two characters), and lets a character be drained before it goes to the Pound.
- Mod Bots need someone watching at the right moment; with a cast of tens a bot usually escapes. Cursor-lingering aggro
  has no equivalent on a phone. Whether the game is played on phones at all is open.
- The system's own behavior could give masks away: presence on a quick swap (one character leaves and another joins at
  the same instant), timing, shared inventory. The rule "A response never varies with a private fact" now covers this.
- Smaller: Jester's favored quadrants overlap both Face's and Heel's; Lurker's hostile quadrant is not a quadrant.

**The architecture**
- Rules decided in the browser in a game with a currency: the spec's postcard `calculateCost` and `canApply` run in the
  client, and clients broadcast a Mod Bot's position and aggro. One rules module, previewed in the client and decided on
  the server; a Mod Bot as a timeline the server holds (state, start, duration) that clients animate. Whether a rule is
  decided in SQL or in an Edge Function is the first architecture question.
- The spec makes Acts a log, then edits them (`active_effects`, `is_destroyed`). "Append-only" now settles this.
- Supabase Realtime's row changes carry whole rows; the reactions table is never published, and counts are sent from
  the server.
- Player posts are the Director's input and an appeal is a plea to a model: players will try to steer The System. That
  may be part of the game, and "The System acts" bounds every outcome to choices the code defines.
- "Zero migrations" for postcards is the right instinct as "a new card is one file", not as an absolute.

**The order of building**
- The spec's phases are layers (UI kit, schema, realtime, economy, The System), so whether it is fun is learned last.
  Proposed instead: vertical slices, the first the thinnest playable loop (characters, one board, posts, reactions,
  hidden class, Aura), played by the cast before postcards and Mod Bots. This is order, not trimming ("Nobody is waiting
  on a hotfix").

## Open

- The first design session's subject: the order of slices, or the core loop's design first.
- 18+: what the age gate at registration is.
- Phones: whether the game is played on them, which decides the drag-based postcards and Mod Bot aggro.
- The models: which model the Director runs on, and its cost per week, measured once it exists.
