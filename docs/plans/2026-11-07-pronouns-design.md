# Character pronouns, brought up to main: design

Record, written 2026-11-07. A design session with the owner, which started from "make sure the plan accounts for any
existing grammar diffs with main, and that it's up to date with the concept of bot personas in general." It amends
`docs/plans/2026-11-05-pronouns-design.md`, which stands wherever this one does not touch it, and its plan,
`docs/plans/2026-11-07-pronouns-plan.md`, replaces `docs/plans/2026-11-05-pronouns-plan.md` whole: a build session
works from the new plan alone. Both 11-05 files are records and are left as written.

## 0. What changed on main since 2026-11-05

About 390 commits landed between the first plan (325b375) and this one. What they did to the pronouns work:

- **The copy moved and grew.** Most of the first plan's file:line references drifted. Strings were added that call one
  character "it": the debut footers (`engine/ui/characters/footers.ts`), the ban line in the log, the visit and report
  pieces of the Lens (`engine/ui/cards/visit.ts`, `Visit.tsx`), the composer's banned-mask line, the Staff page's Mod
  log line, and in the prompts every Mod's section of the Boss's meeting. A few lines the first plan missed were
  already there ("one waiting to debut can post once it has" in three composers, Glitter Bomb's "every post of
  theirs", the rankings' and front door's "its player"). The plan's Tasks 6 and 7 are rewritten from a fresh inventory.
- **Staff are one roster.** Every Boss and Mod Bot is a `Persona` in `SystemContent.roster` (the staff roster design),
  any of which can hold either office (`staff_now`, `0082_offices.sql`), and the Boss changes by season. So "the Boss's
  pronouns" in copy is never a constant: it is the set on the profile of whichever character holds the office when the
  screen is drawn.
- **Mod Bots act and speak.** Visits, reports, appeals and patrols (`docs/plans/2026-11-06-mod-bots-design.md`, migrations
  0102 to 0111) added model prompts that name characters (`engine/system/judgment.ts`: the filing, report, appeal and
  patrol prompts, and a Mod's memory) and stock lines that SQL posts on the board with `{mod}`, `{reporter}` and
  `{appellant}` tokens (`instances/divided-world/system/lines.ts`). One already says "it" of a Mod.
- **Pages are one read.** The forum-load design made each screen one database read (`thread_page`, `board_page`,
  `index_page`, `profile_page`, `record_page`, `boot`, and others), each listing the profile columns it carries, held by
  `tools/check-web-reads.mjs`. The first plan's one `character_profiles` select and `profile_projection` are no longer
  the whole read path.
- **Newer definitions.** `settings_held` is now 0104's, `seed_instance` 0108's, `profile_page` and `record_page` 0104's.
  The seed already rewrites a persona's `beats` on every seed (0103), the pattern section 4 of the first design chose
  for pronouns.
- **Grammar helpers exist, but no pronoun helper.** `withArticle` (`engine/ui/characters/format.ts`) and several
  local `possessive` and `plural` functions; nothing agrees a verb with a pronoun. `engine/rules/pronouns.ts` is still
  the one place pronoun words come from, and it does not duplicate a/an or plurals.

No open PR on 2026-11-07 changes the copy's grammar.

## 1. Staff stock lines carry pronoun tokens

**Decided (the owner chose the recommendation).** A stock line may use the pronouns of the staff character it names:
`{boss.they}`, `{mod.Their}` and so on, filled by the SQL that fills the line, from that character's profile when the
line is written. So an instance writes "{mod} has already forgotten how {mod.they} felt about this", and it is right
whichever Mod holds the beat.

- **The forms.** After a staff token's name and a dot: `they`, `them`, `their`, `theirs`, `themself`, each also
  capitalized (`They`, …), and the verbs `is`, `was`, `has`, `does` and `s` (an `s` on a regular verb: "{mod.they}
  watch{mod.s}"). The key names are the they-set's words, so a line reads as it would be said of they/them; the
  value is the character's own. The engine's `words()` (plan, Task 1) uses the same keys, so copy and stock lines name
  forms one way.
- **Which tokens.** `{boss}` and `{mod}`, the staff tokens, whose holder changes. `{reporter}` and `{appellant}` stay
  names only: a line about a player's character names it, and giving them forms would mean redefining `close_report`
  and `close_appeal` whole for a sentence an instance can write with the name. `instanceProblems` refuses a pronoun
  form on any other token, saying which forms that line may use.
- **The fallback** for a character with no profile row is the instance's `pronouns` setting, else it/its.

*Weighed:* no pronouns in stock lines, with a check refusing it/its/they in them (B), which is less SQL and makes every
writer of a line work around a word they would naturally use.

## 2. A persona is told its own pronouns

**Decided (the owner chose the recommendation).** Wherever the engine builds a persona's system prompt (the meeting,
a Mod's judgments and filings, pool chatter), it adds one line after the persona: "Your pronouns are she/her (she,
her, her, hers, herself)." The set is the persona file's, else the instance default, else it/its: the same set the
seed writes on the persona's profile. When #252 lets the Boss choose its own, that line reads the profile instead.

## 3. A persona's prose never needs a sweep

**Decided (the owner chose the recommendation).** A persona file's prose never refers to the persona with a
third-person pronoun, so changing its `pronouns` changes nothing else in the file:

- The fields the persona reads about itself (its voice's temperament, voice, habits and tastes, `persuadedBy`,
  `startingHobby`) are in the second person ("you keep forgetting to water them"). A habit written "It announces its
  own arrival" inside "Your habits" is a slip, and is rewritten.
- The fields others read about it (`temperament`, shown to admins on the roster and to the Boss in a Mod's section)
  use its name or no pronoun ("Proud of the lanyard.").

Characters in general in a persona's prose ("you praise them") are left as written: that is the general "they" the
first design allows.

*Weighed:* keeping third person and requiring it to match the declared set (B), which turns every change of a set
into a prose review.

## 4. Gabe is he/him

**Decided.** Divided World's developer persona declares he/him (`DeveloperPersona.pronouns`). The four Boss and Mod
Bot personas keep it/its, as the first design decided.

## 5. Copy about a staff character reads the office's holder

Not a new choice; what the roster means for the first design's section 2. A line about the Boss or a Mod on a screen
(the Staff page, the season page, the admin Queue, a visit in the Lens, `MoveKeepLine`) takes the set of the character
it names, read with that character as every other line does. Where a read hands a screen only a staff member's name
(a visit's Mod, `beat_mod_name`, the queue's Boss), the read hands its `pronouns` beside it. Never a set from the
persona file on a screen: the profile is what every player reads, and the seed keeps the two equal.

## 6. Where the model sees a character, now

The first design's section 5 stands, and its list grows to every prompt main has now: the digest's characters, the
meeting's ids and successors' roster, each Mod's section of the meeting, a Mod's memory of characters, the filing,
report, appeal and patrol prompts (each post's author, the reporter, the appellant), and pool chatter's thread and
quoted post. Each is `Name (label)`. The two old-voice completion frames, `chatterCompletion` and `filingCompletion`,
carry none: a 2003 transcript has no pronoun tags. Lines in the engine's prompts that say "it" of one character
(a Mod's "Its beat now", "Its memory") take that character's words, and a line that needs no pronoun is rephrased
("These moves, made by the Boss before you, are still in force.").

## 7. Unchanged

The SQL refusals stay as written, including those added since (a report quota's "this character has made its %
reports for today", a Mod's "the board it watches"), and the fake data layer's mirrors of them: each is a whole function
redefined for a word. The System's own "it" and robo-McMahon's "its toybox" stay. The profile line, the picker, the
backfill and when a set may change are as the first design decided.

## Open

- **The Boss choosing its own pronouns** (#252) is still a design of its own.
