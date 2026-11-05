# Divided World's reaction set: design

Record, written 2026-11-05. A design session with the owner, which started as a conversation about whether 👀 could be a
low-energy positive reaction. Its plan is `docs/plans/2026-11-05-reaction-set-plan.md`. A search of the issues found
none on the reaction set. #216 was filed in this session for the case this design refuses (section 3).

## 0. Where it starts

- **The set.** `instances/divided-world/reactions.ts` holds 16 reactions, four per quadrant. The core-loop engine plan
  (`docs/plans/2026-10-28-core-loop-engine-plan.md`) took them from the spec, and #161 later swapped 😡 for 🤢.
  - Hype: 🔥 ❤️ 🙌 🤩
  - Heat: 🍅 🤢 🤬 👎
  - Calm: 😌 ☕ 🤝 🧘
  - Groan: 💤 🙄 🗑️ 🥱
- **Each quadrant pays one class and costs another** (`docs/plans/2026-10-28-core-loop-design.md`, section 6, and
  `docs/plans/2026-10-30-technician-design.md`):
  - Face earns from Hype, Heel from Heat, Technician from Calm and Jabroni from Groan.
  - Calm costs the Heel and Heat costs the Technician, so they are foils both ways.
- **A reaction's key is its stored name, and also its accessible name.** `readable()` in `engine/ui/reactions/Reactions.tsx`
  turns `eye-roll` into "Eye roll". The picker names each button by that and its quadrant ("Eye roll, Groan").
- **Seeding adds and updates, and never removes.** `seed_instance` (last defined in `supabase/migrations/0062_updates.sql`)
  upserts each kind the payload lists. A kind the instance stopped listing stays in `reaction_kinds`. `react` (0002) and
  the System's reactions (0015) still accept it, but no post shows it, because the screens draw only the kinds in
  `instance.reactions` (`Reactions.tsx`, `MoveNotice.tsx`).

## 1. The set

**Decided.** Four per quadrant, chosen for how people already react on forums, Discord, Slack and in iMessage. The picker's
quadrant labels teach the game's meaning, but a player reaching for "lol" presses what they always press.

| Quadrant (class it pays) | Set | The four reasons |
|---|---|---|
| Hype (Face) | 🔥 ❤️ 😂 💯 | it's amazing, love it, it's funny, so true |
| Heat (Heel) | 🍅 🤮 🤬 👎 | boo, disgust, outrage, thumbs down |
| Calm (Technician) | 👍 🙏 🫡 💡 | sure, thanks, respect, learned something |
| Groan (Jabroni) | 🤦 🙄 🦗 🥱 | facepalm, oh please, crickets, boring |

**What a reaction has to be:**
1. **People already react with it.**
2. **Its everyday meaning lands in one quadrant.** If an emoji commonly means two things, a class gets paid for the wrong
   thing.
3. **The four in a quadrant give four different reasons, not four synonyms.** A player leaves at most three reactions on
   an Act, so the set needs range.
4. **It does not look like a moderation tool.** 🚩 ✅ ❌ 📌 ⚠️ read as report, approve or pin. The real moderation screens
   speak plainly (CLAUDE.md, "The fiction may lie; the log never does"), and a reaction that looks like a report blurs
   that line.

**What changes, and why:**
- **Hype:** 😂 replaces 🙌, and 💯 replaces 🤩.
  - 😂 is the most-used reaction there is, and 🤩 rarely gets pressed.
  - 😂 also scores the Jabroni correctly. A real laugh at an anti-joke means the Jabroni was "taken sincerely", which is
    their weakness.
  - 🙌 overlaps 🔥, while 💯 adds strong agreement, which nothing else in the set covers.
- **Heat:** 🤮 replaces 🤢. It means the same thing and is pressed more often. 🍅, 🤬 and 👎 stay.
- **Calm:** 👍 🙏 🫡 💡 replace 😌 ☕ 🤝 🧘.
  - 😌 and 🧘 are almost never used as reactions.
  - ☕ reads online as "tea", meaning gossip, and "sipping tea" is the passive-aggressive "none of my business". That is
    excitement about drama, not a calm nod.
  - 💡 suits the Technician, the effort poster: "I learned something" is what an effort post wants. 🤝 overlaps 👍 and 🫡.
- **Groan:** 🤦 and 🦗 replace 💤 and 🗑️.
  - 💤 and 🥱 both say "boring".
  - 🗑️ ("trash take") is contempt, which a Heel would count as heat.
  - 🦗 is the sound of a joke bombing, which is the Jabroni's act.
- **The thumbs pair sits on the Heel–Technician line.** Calm and Heat are the foil quadrants, so 👍 in Calm and 👎 in Heat
  put the pair on that line. A Heel given 👍 got a polite shrug. A Heel given 👎 got the crowd's verdict, which is what a
  heel works for. (The session first suggested moving 👎 to Groan, then withdrew it for this reason.)

**Order within a quadrant.** A kept kind keeps its place in the picker, and a new kind takes the place of the one it
replaces. The React board (`docs/research/2026-10-29-two-worlds/03-react.html`) is then matched slot for slot, as #161
matched 🤢 in 😡's place.

**Why four, and not five.** The quadrants stay equal, so the quadrant with the fewest good options sets the count. Hype
and Groan have good fifths (🎉, 😑), and Calm could take 🤝 or 🫂. Heat runs out:
- 😱 and 🫢 can also be happy surprise.
- 😈 reads as "devious, love it".
- 🧂 collides with the Salty postcard.
- 🚩 looks like a report.

**Weighed and rejected:**
- **👀** is curiosity or "drama incoming", with no valence, so it would pay whichever class's quadrant held it for a
  reaction that meant neither. It may suit a card or an effect better.
- **🙂** reads as passive-aggressive.
- **👌** has had a hate-symbol reading.
- **🤡** is a contemptuous insult, which reads as heat.
- **💀** means laughing to younger players and death to older ones.

**Accepted as is:**
- **No sympathy reaction.** When someone posts bad news, people will press ❤️, which lands in Hype and pays a Face.
  Everything on the board is play, so this stands. 🫂 in Calm was weighed as a fifth.
- **🫡 is from 2021, Emoji 14.** The UI draws each device's own emoji font and bundles none, so Windows 10 shows an empty
  box. The owner kept 🫡. 🤝 is the swap if that changes.

## 2. The keys

**Decided.** A key names what the emoji pictures, as today's keys do (`fire`, `tomato`, `eye-roll`). A screen reader
user then hears what a sighted player sees, so both read the same picture, as CLAUDE.md asks of a game obstacle's
accessible path ("An accessible path costs what the obstacle costs").

| Emoji | Key | Read as |
|---|---|---|
| 😂 | `laughing` | Laughing |
| 💯 | `hundred-points` | Hundred points |
| 🤮 | `vomiting` | Vomiting |
| 👍 | `thumbs-up` | Thumbs up |
| 🙏 | `folded-hands` | Folded hands |
| 🫡 | `salute` | Salute |
| 💡 | `light-bulb` | Light bulb |
| 🤦 | `facepalm` | Facepalm |
| 🦗 | `crickets` | Crickets |

Kept keys stay as they are: `fire`, `heart`, `tomato`, `cursing`, `thumbs-down`, `eye-roll`, `yawn`. Weighed and rejected:
keys that name the meaning (`so-true`, `thanks`, `respect`). They would tell a screen reader user the intended meaning,
which a sighted player only infers from the picture.

## 3. Seeding a changed set

**Decided.** When a seed payload carries `reactions`, that list is the instance's whole set.
- **A kind it no longer names, which no reaction uses, is deleted.** This happens before the upsert, so a payload that
  moves an emoji to a new key does not trip `reaction_kinds.emoji`'s unique constraint.
- **A kind it no longer names, which some reaction does use, stops the seed.** The seed fails with SQLSTATE 22023 and
  nothing is written. The error names each such kind with its number of reactions, and points to #216. "Used" means any
  row in `reactions` or `reaction_tallies`, the two tables that reference a kind.
- **A payload with no `reactions` key leaves the kinds as they are.** The deployed seed (`supabase/functions/_shared/seed.ts`,
  `instanceSeed`) always sends the whole list. The SQL suite's partial seeds, which now pass `'reactions', '[]'::jsonb` to
  mean "nothing to add", leave the key out instead.

Reaction kinds become the one vocabulary that seeding removes. Classes and cards are still never removed: a card's price
must outlive the card (0006), and 0009's test holds that a class the payload drops stays. A reaction kind has nothing that
must outlive it once nothing uses it.

**Way out of the refused seed.** This is an operator's state, not a player's. The instance puts the kind back in its
list and seeds again, or #216's design gives a used kind a way to retire.

**Weighed and rejected:**
- **Swap only.** This leaves a gap the change itself opens: a reseeded database keeps nine kinds that the server accepts
  and no post shows.
- **Build retirement now.** That would be built for kinds no reaction has ever used, since no instance is deployed.
  Retiring a used kind is a separate concern, so it is #216.

**Masks.** Only the service role calls `seed_instance`, and its refusal reads only per-kind counts. Those are already
public through `reaction_tallies`. Nothing in it is computed from who reacted.

## 4. Words that named the old set

- **The polite-shrugs hint** (`instances/divided-world/ui/hint-words.ts`) says Calm reactions are "a nod, a cup of tea".
  It becomes "a thumbs up, a thank-you". This is glass copy, so the owner approves it in review.
- **The demo** (`web/src/demo.ts`) has a thread asking "Who keeps reacting with tea?", with ☕ in its body. It asks about
  👍 instead.
- **Records stay as written.** These still name the old set and are not edited: the Technician design's "getting tea",
  the core-loop engine plan, the boards under `docs/research/`, and earlier plans.

## 5. Open

- Whether an engine rule should require each quadrant to hold at least one reaction, or an equal number. Today that is
  Divided World's own choice, held by its own test (plan Task 1). No engine change was asked for.
