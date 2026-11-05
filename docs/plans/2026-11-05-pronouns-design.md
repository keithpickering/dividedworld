# Character pronouns: design

Record, written 2026-11-05. A design session with the owner, which started from "characters are always `it/its`, which
impacts the role-playing a bit". Its plan is `docs/plans/2026-11-05-pronouns-plan.md`.

## 0. Where it starts

- **Every character is "it".** The copy calls a character `it/its` in about 70 places: about 40 on its own player's
  out-of-character screens (`engine/ui/characters/`, the ledger reasons in `instances/divided-world/ui/index.ts`, the
  guide), about 22 on public pages about any character (`engine/ui/profile/Profile.tsx`, `engine/ui/season/Season.tsx`,
  `engine/ui/profile/Staff.tsx`), 3 in the fiction on the board (`MoveKeepLine` in `engine/ui/thread/lines.tsx`, the
  season reveal post in `engine/ui/reveal/Reveal.tsx`), 4 on the admin Queue, 5 SQL refusals, and the model prompts.
- **"They" slips in twice:** `engine/ui/cards/PlayForm.tsx` ("on every post of theirs") and Glitter Bomb's rules text
  ("any of their posts"). He and she appear nowhere.
- **The System's own announcements on the board use names only** (debuts, Turns, reveals).
- **The model is told nothing about pronouns.** The digest (`engine/system/digest.ts`) and the meeting's ids
  (`referenceText` in `engine/system/meeting.ts`) name characters only; the personas call the Boss "it" and other
  characters "them".
- **A profile is state, not an Act** (`supabase/migrations/0019_profiles.sql`): its player sets it, and when it was set
  is never shown, since two masks retitled a minute apart would show one player.

## 1. The choice: presets and a custom set

**Decided (B).** A character's pronouns are one of four presets or a custom set.

| Preset | Subject | Object | Determiner | Possessive | Reflexive | Verbs |
|---|---|---|---|---|---|---|
| it/its | it | it | its | its | itself | singular |
| he/him | he | him | his | his | himself | singular |
| she/her | she | her | her | hers | herself | singular |
| they/them | they | them | their | theirs | themself | plural |

"Determiner" is what the owner called the possessive adjective (*her* card). The they/them reflexive is **themself**,
since it is one character (the owner's word). A custom set is the five forms and whether its verbs agree like "they are"
or like "it is". Each form is one word: 1 to 12 letters, an apostrophe or hyphen allowed inside, nothing hidden, no space.

*Weighed:* presets only (A), which does no less templating work and leaves neopronouns to a later redesign; custom only
(C), which makes the common case five fields.

## 2. Two kinds of sentence

**Decided.** A sentence about **one character** uses that character's pronouns, or its name ("Gloomba is now a Face.
She Turned on Oct 20."). A sentence about **characters in general** (class descriptions, ledger reasons, the guide,
onboarding tips) is rephrased to need no pronoun where "its" reads clumsily, pointing at the player whose mask it is.
The owner's example: "Its class is its own secret" becomes "Each character's class is kept secret, unless its player
chooses to reveal it." A general "its" that reads cleanly may stay. The guide's, onboarding's and the welcome page's new
wording is the owner's to approve in review (CLAUDE.md, "The fiction may lie; the log never does").

**Left as written:** the SQL refusals ("a card on a character is played from one of its posts"). Each is general, and a
word in one costs a whole function redefined in a new migration. The System's own "it" (it is the machine, not a
character) and robo-McMahon's premise ("its toybox") stay.

## 3. When pronouns are set

**Decided (A).** Chosen on New character, preselected with the instance's default, and editable at any time on Edit
profile. A change is profile state like the title: no Act, and its time is never shown. Every screen reads the current
set when it is drawn, so an act line drawn later reads the new pronouns. Words a player or the model already wrote stay
as written (CLAUDE.md, "Append-only").

*Weighed:* locked at creation like the name (B), which leaves a player who wants a change stuck; each change a public Act
(C), which makes a profile tweak an announcement and its time a clue.

Existing characters are backfilled with it/its, so nothing they show changes until their player chooses.

## 4. Staff characters

**Decided (A).** Each persona file declares its pronouns, committed and approved in review. A persona or the developer
that declares none gets the instance's default. Unlike a persona's title, which the seed writes once, a persona's
pronouns are written on every seed, so the file stays the authority. Divided World's four personas declare it/its,
matching their prompt texts; the owner may change any in the plan's PR.

*Weighed:* admins setting them on the staff profile (B), which adds an admin screen for what is the persona's; the Boss
choosing its own from the preset list at each meeting (C), a fixed choice and so safe, filed as a follow-up of its own.

## 5. The model

**Decided.** Every place the model is shown a character by name carries its pronouns: the meeting's ids (`- Gloomba
(she/her): <id>`), the digest's characters, the roster of successors, and Mod Bot chatter's thread posts and quoted post
(`Gloomba (she/her): …`). Both premises gain one line: refer to each character by the pronouns beside its name. The old
voice's completion frame (`chatterCompletion`), a 2003 thread transcript, carries none: a pronoun tag would break the
frame. Nothing checks a model's free text for pronouns: a wrong one cannot be repaired without inventing content, and it
stands as written, as a bluff does (CLAUDE.md, "A validator tighter than the schema").

## 6. Where pronouns show

**Decided (A).** On the profile page only, one quiet line under the title, in the board's house style: `she/her`. The
postbit is unchanged. A character at the default shows it too (`it/its`), so the default never reads as "not set". The
line is the subject and the object, or the subject and the determiner where those two are the same word: he/him,
she/her, they/them, it/its, xe/xem.

*Weighed:* the postbit as well (B), a line on every post; nowhere (C), which leaves players to infer pronouns from the copy.

## 7. The picker

**Decided.** One control, on New character and Edit profile, in the glass: the four presets and Custom… as radio cards
like the class cards (`engine/ui/characters/ClassCards.tsx`); Custom… opens five labeled one-word fields and a choice of
"verbs like *they are*" or "verbs like *it is*"; under it, a live preview in the character's name: "Gloomba posted. She is
a Face. The card is hers; she played it on her own post herself." Impeccable's `shape` step is not run: the control is
one addition to two existing forms, built from house parts, and the owner was offered a mockup and took the description.

## 8. The game's rules

- **Layers.** The set's shape, the presets, the check and the copy helpers are engine (`engine/rules/pronouns.ts`). The
  default is the instance's (`Settings.pronouns`), the staff's are the persona files' (`Persona.pronouns`,
  `DeveloperPersona.pronouns`). The engine's own fallback, for a seed that names none, is it/its, matching all of today's
  copy.
- **The masks.** A character's pronouns are a public fact about the mask, chosen by its player, never a private one. An
  edit's time is never shown. A player who chooses the same unusual set for every mask leaves a clue from public play,
  which the game allows (CLAUDE.md, "A response never proves a private fact").
- **Ways out.** No state is added that a player can be stuck in: pronouns are edited whenever the player likes.
- **Portable.** The exporter copies every column of every table (`tools/instance-files.mjs`), so the new column travels;
  the round-trip test is given a custom set to prove it.
- **Accessibility.** The picker is a labeled radio group with labeled fields, keyboard-reachable, and the preview is
  plain text.

## 9. Open

- **The Boss choosing its own pronouns at a meeting** (section 4, C), from the preset list, as it rewrites its mood. A
  separate concern, filed as #252.
