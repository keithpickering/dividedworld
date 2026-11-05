# Character pronouns: plan

Record, written 2026-11-05. The plan for `docs/plans/2026-11-05-pronouns-design.md`. One build session builds it in one
PR from `main`. The Boss choosing its own pronouns (design, section 9; #252) is not built here.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added. The SQL runs
against Postgres on localhost (`npm run test:sql`).

**Two migrations and two SQL test files**, each taking the next free number when it is written: `NNNN_pronouns.sql` and
`NNNN_pronouns_for_the_model.sql` in `supabase/migrations/` (0092 and 0093 at the time of writing), and `NNNN-pronouns.sql`
and `NNNN-pronouns-for-the-model.sql` in `supabase/tests/` (0094 and 0095).

## The set, exactly

```ts
export interface PronounSet {
  readonly subject: string;     // they
  readonly object: string;      // them
  readonly determiner: string;  // their (card)
  readonly possessive: string;  // theirs
  readonly reflexive: string;   // themself
  readonly plural: boolean;     // verbs agree like "they are"
}
```

| Key | subject | object | determiner | possessive | reflexive | plural |
|---|---|---|---|---|---|---|
| `it` | it | it | its | its | itself | false |
| `he` | he | him | his | his | himself | false |
| `she` | she | her | her | hers | herself | false |
| `they` | they | them | their | theirs | themself | true |

A form holds: 1 to 12 code points; letters (`\p{L}`) and combining marks (`\p{M}`), with an apostrophe (`'` or `’`) or a
hyphen allowed between two letters; stored lowercase. The label (design, section 6) is `subject/object`, or
`subject/determiner` when object equals subject.

## Task 1. The set, its check and its words (engine)

Model: sonnet

**Files:** new `engine/rules/pronouns.ts` and `engine/rules/pronouns.test.ts`; `engine/rules/types.ts` (`PronounSet`
re-exported, `Settings.pronouns`, `Persona.pronouns?`, `DeveloperPersona.pronouns?`); `engine/rules/instance.ts`
(`SETTINGS` gains `pronouns`, held by `pronounProblems`; `instanceProblems` checks each persona's and the developer's set
where given).

`pronouns.ts` exports:
- `PRONOUN_PRESETS: Readonly<Record<'it' | 'he' | 'she' | 'they', PronounSet>>`, the table above.
- `ENGINE_DEFAULT_PRONOUNS = PRONOUN_PRESETS.it`, with a comment: the engine's fallback, matching every line written
  before pronouns existed (design, section 8).
- `pronounProblems(v: unknown): string[]`: each failing predicate named ("the subject has 13 characters; at most 12",
  "the object holds a space"), and an unknown or missing key named. A non-boolean `plural` is a problem.
- `normalizePronouns(set): PronounSet`: lowercases and trims each form; the screens send this.
- `pronounLabel(set): string`.
- `presetOf(set): key | null`: the preset a set equals, for the picker's selection.
- `words(set)`: what copy writes with. Each form, and the same capitalized (`They`, `Their`, …); `be` (is/are), `was`
  (was/were), `have` (has/have), `does` (does/doesn't stays the caller's), and `verb(singular, plural)` for any other.
  A custom set with `plural: true` reads "xe are"; that is the player's choice and is not second-guessed.

**Tests first:** every preset passes `pronounProblems`; `words(PRONOUN_PRESETS.they).be` is `are`, `it`'s is `is`;
`pronounLabel` gives he/him, she/her, they/them, it/its and xe/xem for a custom set; `presetOf` of a custom set is null.
Poisons each refused with the predicate named: a form of 13 letters, an empty form, `"they "` with a space, `"x​y"`
(hidden), `"-xe"` (hyphen not between letters), `"x3"` (a digit), `plural: "yes"`, a missing `reflexive`, an extra key.
`settingsProblems` refuses a bad `pronouns` setting; `instanceProblems` names a persona whose set is bad.

## Task 2. Stored, created and edited (migration)

Model: sonnet

**Files:** the first migration and its SQL test; `supabase/tests/0079-settings-held.sql` (rows for `pronouns`);
`engine/rules/pronouns-held.test.ts`, new.

The migration, with a header citing the design, sections 1, 3 and 4:
1. **`pronouns_hold(v jsonb) returns boolean`**, immutable: the same rule as `pronounProblems`, exactly six keys. Its
   letter class is `[[:alpha:]]` plus the combining-mark range used for names; the drift test below holds the two sides
   together. Granted to nobody beyond its callers.
2. **`settings_held()`**, copied whole from its latest definition (`supabase/migrations/0085_staff_notes.sql`), with a
   branch for `pronouns` that calls `pronouns_hold`.
3. **`character_profiles.pronouns jsonb not null`**, default the it-set as a jsonb literal, `check (pronouns_hold(pronouns))`.
4. **The backfill:** a profile row, with the default, for every character that has none.
5. **`profile_projection`**, copied from `supabase/migrations/0025_avatars.sql`, with `'pronouns', p.pronouns` added.
6. **`set_profile`**: the four-argument function (0019) is dropped and a five-argument one made, `pronouns jsonb default
   null`; null keeps the stored set. A bad set is refused with `hint = 'kayfabb.refusal'`, errcode `22023`, "pronouns are
   five words of 1 to 12 letters". `updated_at` is set as for the title, never projected. The execute grant to
   `authenticated` is renewed for the new signature.
7. **`create_character`**: copied whole from `supabase/migrations/0067_debut_now.sql`, the old signature dropped and a
   new one with `pronouns jsonb default null` last. Null takes the `pronouns` setting, else the column default. It
   inserts the character's profile row with that set (a character waiting to debut has a row; `characters_public` still
   hides it). The grant is renewed.
8. **`seed_instance`**: copied whole from `supabase/migrations/0091_seed_reaction_kinds.sql`. A roster entry and the
   developer may carry `pronouns`. The insert of a new staff profile writes it (else the setting, else the default).
   Then, for every roster entry and the developer whose payload names `pronouns`, the existing profile's `pronouns` is
   set to it, on every seed (design, section 4). Title and signature keep 0091's write-once behavior.

**Tests first,** in the SQL test file, with `tests.account` and `tests.character` (`supabase/tests/setup/fixtures.sql`):
- A character made with no set gets the setting's set; with no setting, the it-set.
- A character made with she/her reads she/her from `profile_projection`.
- `set_profile` with a custom set stores it; with null keeps it; with a 13-letter subject is refused with the hint.
- A character made before the migration (inserted before it runs, in the test's setup) has a row with the it-set.
- A reseed that changes a persona's `pronouns` changes its profile's; a reseed with none leaves it; its title is not
  rewritten.
- `projection` never carries `updated_at`.

`pronouns-held.test.ts` reads a poison list and a good list from the SQL test file (one row per line, as
`engine/rules/settings-held.test.ts` reads `0079-settings-held.sql`) and asserts each poison fails `pronounProblems` and
each good passes. The SQL file asserts the same rows against `pronouns_hold`. The poisons are Task 1's.

**Poisons,** each run once and recorded red: `pronouns_hold` without the length bound (the 13-letter row passes the
SQL side); the reseed's update left out (the reseed test fails); `create_character`'s profile insert left out (the
first test reads no row).

## Task 3. Divided World's default and its staff (instance)

Model: haiku

**Files:** `instances/divided-world/settings.ts` (`pronouns: PRONOUN_PRESETS.it`); the four files in
`instances/divided-world/system/personas/` (`pronouns: PRONOUN_PRESETS.it` on each); `supabase/functions/_shared/seed.ts`
(each roster entry and the developer carry `pronouns` when the persona names it); the seed's test beside it.

**Test first,** in `supabase/functions/_shared/seed.test.ts`: the payload for an instance whose first persona declares
she/her carries `pronouns` on that roster entry and not on one that declares none.

## Task 4. The data layer

Model: sonnet

**Files:** `engine/ui/data/api.ts` (`Character.pronouns`, `MyCharacter.pronouns`, `createCharacter(…, pronouns)`,
`setProfile(…, pronouns)`); `engine/ui/data/fake.ts` (the same, with the fake refusing what `pronounProblems` refuses);
`web/src/data/supabase.ts` (the `character_profiles` select gains `pronouns`; the two calls pass it); their tests
(`engine/ui/data/fake.test.tsx`, `web/src/data/supabase.test.tsx`); `engine/ui/test-world.tsx` and stories' fixtures,
which gain the field (staff in the fake world take their persona's set).

**Tests first:** the fake makes a character with she/her and reads it back on `Character` and `MyCharacter`; refuses a
bad set with the same words as the SQL; the Supabase client sends `pronouns` to `create_character` and `set_profile`
and reads it from the select.

## Task 5. The picker and the profile line (screens)

Model: sonnet

**Files:** new `engine/ui/characters/PronounPicker.tsx` with its test and a story; `engine/ui/characters/NewCharacter.tsx`;
`engine/ui/profile-edit/ProfileEdit.tsx`; `engine/ui/profile/Profile.tsx` (the label line under the title, class
`kb-profile-pronouns kb-muted`); `engine/ui/characters/characters.css`.

The picker (design, section 7): a radio group legend "Pronouns", five options (`it/its`, `he/him`, `she/her`,
`they/them`, `Custom…`), drawn as the class cards are (`ClassCards.tsx`). Custom… shows five fields labeled Subject,
Object, Possessive adjective, Possessive, Reflexive, each with an example placeholder from the they set, and a radio
pair "Verbs like *they are*" / "Verbs like *it is*". Each field's problem shows under it as `pronounProblems` words it.
The preview is a `<p aria-live="polite">` with the character's name (or "Your character" before one is typed):
`{Name} posted. {They} {be} a Face. The card is {theirs}; {they} played it on {their} own post {themself}.` New
character starts on the instance's `settings.pronouns`; Edit profile starts on the stored set and saves it with the rest.

**Tests first:** choosing she/her sends she/her; Custom… with a 13-letter subject shows the problem and disables saving;
the preview reads "She is" for she/her and "They are" for they/them; the group is keyboard-operable and passes the
axe check in `engine/ui/a11y.ts`; the profile shows `it/its` for a default character and `xe/xem` for a custom one.

## Task 6. Copy about one character

Model: sonnet

Each line below names one character, and takes that character's set through `words()`, its verbs agreeing. Where a
component has no set to hand, the character it names is already loaded with its profile (Task 4); the set is passed
down, never fetched again.

- `engine/ui/characters/previews.ts:32`, `DebutChoice.tsx` (its five lines; it takes a `pronouns` prop beside `name`,
  the picker's live choice on New character, the stored set in `DebutDialog.tsx`), `reveal.ts:21`, `TurnDialog.tsx:107`,
  `Characters.tsx` (the lines about the tab's character: 213, 214, 279, 283, 291, 327, 338, 385).
- `engine/ui/log/Settlement.tsx:139` ("it scores as"), `engine/ui/log/lines.ts:294`.
- `engine/ui/profile-edit/ProfileEdit.tsx:96,105`; `engine/ui/profile/Profile.tsx:96,110`; `engine/ui/profile/Record.tsx:97`.
- `engine/ui/season/Season.tsx:116-119` (a debut: "{name} joins the board. {Their} class is kept secret until {their}
  player reveals it." and the Turn lines), `:146-149` (the Boss's).
- `engine/ui/profile/Staff.tsx:59,61,78,105,159`; `engine/ui/admin/Queue.tsx:171,379,381,382` (the Boss's set).
- `engine/ui/thread/lines.tsx:89` (`MoveKeepLine`); `engine/ui/reveal/Reveal.tsx:84,131` and
  `engine/ui/reveal/statements.ts:56,58` ("until {their} Turn").
- `engine/ui/cards/PlayForm.tsx:231` ("on every post of {theirs}").
- Rephrased with no pronoun, since their strings name no character: `engine/system/career.ts:22` ("named by the Boss
  before"), `engine/system/demands.ts:99,109` ("the named character posted", "the two quoted each other").

Each changed string's test is updated to a non-it set first (she/her for one, they/them for another, so verb agreement
is exercised), and red before the change. The e2e mirrors (`e2e/boards/09-settlement.ts`, `e2e/boards/06-turn.ts`) are
updated with them.

## Task 7. Copy about characters in general

Model: sonnet

Design, section 2: a general "its" stays where it reads cleanly; where it is clumsy, the sentence is rephrased to need
no pronoun, pointing at the player where that reads better ("Each character's class is kept secret, unless its player
chooses to reveal it."). Files: `instances/divided-world/ui/index.ts` (the ledger reasons, 51-73, and the class
descriptions, 109-113), `instances/divided-world/guide/strategy-guide.md`, `instances/divided-world/ui/onboarding.ts`
(16, 44), `engine/ui/welcome/Welcome.tsx:38`, `engine/ui/characters/NewCharacter.tsx:44,82`, and their mirrors in
`engine/ui/test-world.tsx` and `e2e/boards/`. `tools/check-guide.mjs` runs on the guide as before.

The PR's description lists each changed sentence before and after, for the owner's word on the guide's, onboarding's and
welcome page's (CLAUDE.md, "The fiction may lie; the log never does").

## Task 8. The model is told (migration and system)

Model: sonnet

**Files:** the second migration and its SQL test; `engine/system/digest.ts` (`DigestCharacter.pronouns`, the renderer
naming characters as `Name (label)`); `engine/system/meeting.ts` (`ReferenceIds.characters` and the roster carry
`pronouns`; `referenceText` writes `- Gloomba (she/her): <id>`; line 229 rephrased to "These moves, made by the Boss
before you, are still in force."); `supabase/functions/meet/core.ts` (passes them; the roster's from the persona file);
`engine/system/chatter.ts` (`ThreadPost` and the quoted post carry the label, written `Name (label): body`;
`chatterCompletion` unchanged, design section 5); `supabase/functions/chatter/core.ts`;
`instances/divided-world/system/persona.ts` (one line in `BOSS_PREMISE` and in `MOD_BOT_PREMISE`: "Each character's
pronouns are written beside its name; use them.").

The migration: `system_digest`, copied whole from `supabase/migrations/0052_digest_meeters.sql`, its `characters` entries
gaining `'pronouns', p.pronouns` from `character_profiles`; `pool_thread`, copied whole from
`supabase/migrations/0089_pool_spends.sql`, each post gaining its author's `pronouns`. Each read is of a public profile
column. The `kayfabb_digest` role is granted select on `character_profiles (character, pronouns)` if it lacks it.

**Tests first:** the SQL test reads `pronouns` on a digest character and a `pool_thread` post; `renderDigest`,
`referenceText` and `chatterPrompt` tests expect the `(she/her)` tag; `chatterCompletion`'s test expects none.

## Task 9. The export carries it

Model: inline

`supabase/tests/e2e/0003-export.ts`: one of its characters is given a custom set (`xe/xem/xyr/xyrs/xemself`, plural false)
before the export, and the round trip compares it. Red first by running the test with the column left out of the
compare's expectation, then green with the exporter as it is (it copies every column).

## Last. The full build and the final review

`npm run typecheck` and `npm run build:ci`, with their output. Screenshots at deviceScaleFactor 2 of New character with
Custom… open, Edit profile, and a profile page with `she/her`, for the owner.

## Ways out of the states this adds

- No state is added that a player, a character or a post can be put in. A character's pronouns are edited on Edit
  profile whenever its player likes; a refused set says which form failed and why.

## The masks

- `pronouns` is a public profile column, read only where a profile already is. Nothing is computed from who owns a
  character.
- `updated_at` is set on an edit and never projected, as for the title (0019).
- A player's same set across masks is a clue from public play, which the game allows (design, section 8).
- No Realtime event or timing is added.

## Review focus

- **Characters an instance already holds.** The backfill gives every character a row; no read path still treats a
  missing profile row as "no profile" in a way the new rows change (`set_avatar` in 0025, the profile editor's "has no
  profile to edit until it has debuted", the avatar sweep).
- **The dropped signatures.** `set_profile` and `create_character` change arity; every caller (`web/src/data/supabase.ts`,
  the SQL tests' fixtures, `supabase/tests/e2e/`) moves with them, and the grants follow.
- **A reseed** rewrites staff pronouns and nothing else on a staff profile.
- **Verb agreement** in every Task 6 line, read aloud with they/them: no "they is".
- **The digest's size** at a busy instance: one short tag per named character, bounded by the lists already capped
  (`DIGEST_MOST`, `REFERENCE_MOST`).
