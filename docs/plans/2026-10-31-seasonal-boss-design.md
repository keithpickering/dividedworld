# The System's Boss: a persona for each season: design

Record, written 2026-10-31. An addendum to `docs/plans/2026-10-30-the-system-design.md` (merged in #77), from the same
design session continued with the owner the next day, before Part 1 was built. It changes Part 1's plan
(`docs/plans/2026-10-30-the-system-plan.md`, amended the same day) and leaves the rest of the design standing. Where
this addendum says "the Boss", the earlier design says "the Director": the Director is now the role, and each season
it is played by a Boss of its own.

## The idea

The owner, from Minus World: "on minus world we had 'boss fights', just a throwaway account who would be created now
and again that everyone could lob attack spells against to reduce its HP." So: "What if instead of one permanent
System character, the season has a named Boss, which in the backend is just the system playing a certain persona all
season long? It can still develop over time, change interests etc, but it has a unique and temporary identity, and it
becomes more unreasonable over time, slowly."

The season ends with all of it coming to a head: "the Boss is defeated somehow, or even makes a big dramatic I'm
Leaving post, and a new one enters shortly after to take over for the following season. We could have old bosses
return, have dramatic reinventions of themselves, etc." It changes The System at two speeds: small moves on a whim
within a season, and a whole new personality at the handover, which may like a character one week and have no opinion
of it the next. "There's an 'impress the boss on his first day' element. We already described the system as 'the
characters' boss' purely incidentally - this makes it literal in a game sense."

## 1. A Boss is a staff character for a season

**Decided:** each season has a Boss, a staff character (the earlier design's section 4) whose persona is the
instance's content: a name, a title, an avatar, a signature, a voice, a starting hobby, a temperament, and optionally
its own curve (section 4 here). The instance holds a roster of Bosses. The meeting duty, and every duty the earlier
design gives the Director, belongs to the season's Boss; the engine knows only that a season has one.

- **Memory belongs to each Boss.** A new Boss starts with no opinions of anyone and forms them from the digest, which
  is the first-day element. **A Boss that returns** in a later season picks up its own memory where it left it, grudges
  and favorites included; a reinvention is a new persona the roster says inherits an old one's memory.
- **Every Boss keeps its profile and moderation log** after its season, so past regimes can be looked back on.
- **What The System posts with no character** (the season's reveal, debut and Turn tallies) is not the Boss's. The
  owner: those move out of the board and into the glass, since "the forum UI should not really be aware of the
  kayfabe" (issue #81, its own design session). Until then they stay The System's plain record.

## 2. The next Boss: named by the outgoing one

**Decided:** in its last meetings, the outgoing Boss names its successor from the roster, in character: a returning
Boss, an heir it groomed or a rival it hates, with its reason. The nomination is a structural move, so it waits in the
admin queue, where an admin may hold it or put another Boss from the roster in its place. If no nomination stands at
the handover, the next Boss comes from the roster by rotation, never one of the last few, so the forum is never
without a leader. The owner: "we can set up a roster of bosses we want, so it's the fun of A and C with none of the
bias."

The finale's design (the next session, with feuds and matches) may hand the pick to the board when the board defeats
the Boss, choosing from the outgoing Boss's shortlist.

Weighed: admins picking in advance, a human hand on the fiction; an election by characters, where a player's masks are
votes unless voting costs Aura.

## 3. The handover: an inheritance review

**Decided:** at the new Boss's first meeting, every inherited move that shapes the board (a rename, a rule, a lock) is
put to it, and it keeps each (it becomes its own, with its expiry unchanged) or ends it, at no cost to its bank. Any it
leaves unaddressed ends a few days later (`inheritanceGraceDays`, 3 by default). Its first announcement is the review's
result. Bans are not reviewed: a timed ban runs its term, and a permaban keeps its Unban path, certain within its
stated days, so a change of regime is never a way around a ban. The owner: "feels like a real handover when a forum
admin decides to give it to someone else for whatever reason."

Weighed: a clean slate at every handover, which loses the long haul's scars; everything carried over, with a new Boss
spending its first moves on its predecessor's mess.

## 4. The ramp: three phases, with a Boss's own curve allowed

**Decided:** each season has three phases, held in bounded numbers the code applies and told to the meeting so its
voice follows the same curve.

- **Honeymoon** (the first two weeks by default): few moves, small rule bands only, a Boss trying to be liked.
- **The reign** (the long middle): the ordinary budget and bands; crescendos allowed.
- **The meltdown** (the last three weeks by default): the most moves, the harshest bands, permabans allowed,
  crescendos likelier, building into the finale.

The phase lengths and each phase's numbers (weekly moves, bank cap, the bands allowed, the longest move, whether a
permaban is allowed) are instance settings. A Boss in the roster may override its own phase numbers within caps the
engine holds for every Boss, so a Boss that starts terrible and mellows is a deliberate subversion and never the
default.

Weighed: a smooth ramp with no turning point; a curve written for every Boss, which a thin persona makes flat.

## What it changes

- **Part 1's plan:** staff are seeded from the roster; a season names its Boss; the meeting runs as the season's Boss
  in its phase, with a bank per Boss; the succession and the inheritance review are a new task; the profile and
  moderation log are per Boss.
- **The finale** (defeat, or the "I'm leaving" post) joins the next design session with feuds and matches. Until it is
  designed, a season's end is the outgoing Boss's farewell post and the new Boss's arrival post, each a stock line or a
  micro-event.
- **Mod Bots** stay the session after; as henchmen of the season's Boss, they may serve one Boss or several.

## What could slip a mask

- **A new Boss's opinions** come from the digest like the old one's, so a change of regime reads nothing private.
- **A returning Boss's memory** holds only what it learned from public play.
- **A nomination** names a Boss from the roster, never a player or a character.

## Open

- What the finale is, and whether a defeated Boss gives the board the pick: the next design session.
- Divided World's first roster of Bosses, written with the owner.
- Where results, debuts and Turns go in the glass: #81.
