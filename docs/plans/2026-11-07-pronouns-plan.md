# Character pronouns: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-05-pronouns-design.md` as amended by
`docs/plans/2026-11-07-pronouns-design.md` ("the amendment"). It replaces `docs/plans/2026-11-05-pronouns-plan.md`
whole. One build session builds it in one PR from `main`. The Boss choosing its own pronouns (#252) is not built here.

Every task is test first: name the test, record its red run, then write the code. The SQL runs against Postgres on
localhost (`npm run test:sql`). Line numbers below are main's on 2026-11-07, for finding a string; the string is the
authority.

**Four migrations and four SQL test files**, each taking the next free number when it is written (migrations and tests
are numbered apart; 0113 to 0116 and 0115 to 0118 at the time of writing):

| Migration | Its test | Task |
|---|---|---|
| `NNNN_pronouns.sql` | `NNNN-pronouns.sql` | 2 |
| `NNNN_pronouns_on_screens.sql` | `NNNN-pronouns-on-screens.sql` | 4 |
| `NNNN_pronouns_for_the_model.sql` | `NNNN-pronouns-for-the-model.sql` | 8 |
| `NNNN_pronoun_tokens.sql` | `NNNN-pronoun-tokens.sql` | 9 |

Every function a migration changes is copied whole from its **latest** definition, found with
`grep -ln "function <name>(" supabase/migrations/* | tail -1` when the task is built, never from the version named here
if a later one has landed.

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
hyphen allowed between two letters; stored lowercase. The label is `subject/object`, or `subject/determiner` when
object equals subject.

**The words**, one shape for copy (`words(set)`) and for stock-line tokens (`{mod.they}`, the amendment, section 1).
The keys are the they-set's words; the values are the set's own:

| Key | it | they | Key | it | they |
|---|---|---|---|---|---|
| `they` / `They` | it / It | they / They | `is` | is | are |
| `them` / `Them` | it / It | them / Them | `was` | was | were |
| `their` / `Their` | its / Its | their / Their | `has` | has | have |
| `theirs` / `Theirs` | its / Its | theirs / Theirs | `does` | does | do |
| `themself` / `Themself` | itself / Itself | themself / Themself | `s` | s | (empty) |

## Task 1. The set, its check and its words (engine)

Model: sonnet

**Files:** new `engine/rules/pronouns.ts` and `engine/rules/pronouns.test.ts`; `engine/rules/types.ts` (`PronounSet`
re-exported; `Settings.pronouns`; `StaffSeed.pronouns?`, so every `Persona` may carry one; `DeveloperPersona.pronouns?`);
`engine/rules/instance.ts` (`SETTINGS` gains `pronouns`, held by `pronounProblems`; `instanceProblems` checks each
roster persona's and the developer's set where given; the stock-line check at the `STOCK_LINE_TOKENS` loop accepts
`{boss.<form>}` and `{mod.<form>}` where the line may use `{boss}` or `{mod}`, and names the forms when it refuses one);
`engine/system/stock.ts` (`STAFF_TOKENS = ['boss', 'mod']`, `PRONOUN_FORMS`, the doc comment naming them).

`pronouns.ts` exports:
- `PRONOUN_PRESETS: Readonly<Record<'it' | 'he' | 'she' | 'they', PronounSet>>`, the table above.
- `ENGINE_DEFAULT_PRONOUNS = PRONOUN_PRESETS.it`, commented as the engine's fallback, matching every line written
  before pronouns existed.
- `pronounProblems(v: unknown): string[]`, each failing predicate named ("the subject has 13 characters; at most 12",
  "the object holds a space"), an unknown or missing key named, a non-boolean `plural` a problem.
- `normalizePronouns(set): PronounSet` (lowercase, trim); `pronounLabel(set)`; `presetOf(set): key | null`.
- `PRONOUN_FORMS`, the twenty keys of the words table, and `words(set)`, a frozen record of them. It does not repeat
  a/an (`withArticle`, `engine/ui/characters/format.ts`) or plurals of nouns.
- `selfPronounLine(set)`: "Your pronouns are she/her (she, her, her, hers, herself)." (the amendment, section 2).

**Tests first:** every preset passes `pronounProblems`; `words(they).is` is `are` and `words(it).is` is `is`;
`words(it).s` is `s` and `words(they).s` empty; `words(she).Their` is `Her`; labels he/him, she/her, they/them, it/its,
xe/xem; `presetOf` of a custom set is null. Poisons, each refused with its predicate named: a 13-letter form, an empty
form, `"they "`, `"x​y"` (hidden), `"-xe"`, `"x3"`, `plural: "yes"`, a missing `reflexive`, an extra key.
`settingsProblems` refuses a bad `pronouns`; `instanceProblems` names a persona whose set is bad, and refuses a stock line
using `{reporter.they}` or `{mod.thei}` while accepting `{mod.They}` on `visitFiled`.

## Task 2. Stored, created, edited and seeded (migration)

Model: sonnet

**Files:** the first migration and its SQL test; `supabase/tests/0079-settings-held.sql` (rows for `pronouns`);
`engine/rules/pronouns-held.test.ts`, new.

The migration, its header citing both designs:
1. **`pronouns_hold(v jsonb) returns boolean`**, immutable: `pronounProblems`'s rule, exactly six keys, its letter class
   `[[:alpha:]]` plus the combining-mark range used for names. Execute revoked from everyone but its callers.
2. **`settings_held()`**, copied whole (0104 at the time of writing), with a branch for `pronouns`.
3. **`character_profiles.pronouns jsonb not null`**, default the it-set as a jsonb literal, `check (pronouns_hold(pronouns))`.
4. **The backfill:** a profile row with the default for every character that has none.
5. **`profile_projection`** (0025) gains `'pronouns', p.pronouns`.
6. **`set_profile`**: the four-argument function (0019) dropped; a five-argument one with `pronouns jsonb default null`
   (null keeps the stored set). A bad set is refused with `hint = 'kayfabb.refusal'`, errcode `22023`, "pronouns are five
   words of 1 to 12 letters". `updated_at` set as for the title, never projected. Grant renewed for the new signature.
7. **`create_character`**, copied whole (0067), its signature dropped and remade with `pronouns jsonb default null`
   last. Null takes the `pronouns` setting, else the column default. It inserts the character's profile row with that
   set. Grant renewed.
8. **`seed_instance`**, copied whole (0108). A roster entry and the developer may carry `pronouns`. A new staff
   profile is inserted with it (else the setting, else the default), and for every roster entry and the developer whose
   payload names `pronouns`, the existing profile's set is rewritten on every seed, as 0103 rewrites `beats`. Title and
   signature keep their write-once behavior.

**Tests first,** with `tests.account` and `tests.character` (`supabase/tests/setup/fixtures.sql`):
- A character made with no set gets the setting's set; with no setting, the it-set. One made with she/her reads she/her
  from `profile_projection`.
- `set_profile` with a custom set stores it; with null keeps it; with a 13-letter subject is refused with the hint.
- A character made before the migration (inserted in the test's setup) has a row with the it-set.
- A reseed that changes a persona's or the developer's `pronouns` changes its profile's; a reseed naming none leaves
  it; its title is not rewritten.
- `profile_projection` never carries `updated_at`.

`pronouns-held.test.ts` reads a poison list and a good list from the SQL test file, one row per line, as
`engine/rules/settings-held.test.ts` reads `0079-settings-held.sql`, and asserts each poison fails `pronounProblems` and
each good passes; the SQL file asserts the same rows against `pronouns_hold`.

**Poisons,** each run once and recorded red: `pronouns_hold` without the length bound; the reseed's rewrite left out;
`create_character`'s profile insert left out.

## Task 3. Divided World's default, its staff and their prose (instance)

Model: sonnet

**Files:** `instances/divided-world/settings.ts` (`pronouns: PRONOUN_PRESETS.it`); the four files in
`instances/divided-world/system/personas/` (`pronouns: PRONOUN_PRESETS.it` on each); `instances/divided-world/index.ts`
(Gabe's `pronouns: PRONOUN_PRESETS.he`, the amendment, section 4); `supabase/functions/_shared/seed.ts` (each roster entry
and the developer carry `pronouns` when the persona names it) and `seed.test.ts`.

**The prose** (the amendment, section 3). Third-person self-references in persona files are rewritten:
- In the second person, for what the persona reads about itself: `sighbot.ts` `startingHobby` ("houseplants (you keep
  forgetting to water them and blame the board)"), `persuadedBy` in `sighbot.ts`, `placeholder-monitor.ts` and
  `the-clerk.ts`, `placeholder-monitor.ts`'s `startingHobby`, and its habit "It announces its own arrival…" in "Your
  habits".
- With the persona's name or no pronoun, for `temperament`, which admins and the Boss read (`placeholder-monitor.ts`,
  "proud of its lanyard. It enforces…").
- Characters in general ("you praise them") stay.

**Tests first:** in `seed.test.ts`, the payload for an instance whose first persona declares she/her carries `pronouns`
on that roster entry and not on one that declares none, and the developer carries Gabe's he/him. In
`instances/divided-world/system/system.test.ts`, every persona's `startingHobby`, `persuadedBy` and `temperament` hold no
`\b(it|its|itself)\b`; the test lists the fields and is red on today's files. An "it" there that means a thing is
reworded too, so the test needs no judgment of what a pronoun refers to.

## Task 4. The reads carry it (migration and data layer)

Model: sonnet

**Files:** the second migration and its SQL test; `engine/ui/data/api.ts` (`Character.pronouns`, `MyCharacter.pronouns`,
`createCharacter(…, pronouns)`, `setProfile(…, pronouns)`); `engine/ui/data/fake.ts` (the same, refusing what
`pronounProblems` refuses, with the SQL's words); `web/src/data/supabase.ts` (`toCharacter` reads `pronouns`, falling back
to `ENGINE_DEFAULT_PRONOUNS` only for a row with no profile; the `character_profiles` select in `characters()` gains it;
the two calls pass it); their tests (`engine/ui/data/fake.test.tsx`, `web/src/data/supabase.test.tsx`);
`engine/ui/test-world.tsx` and the stories' fixtures (staff in the fake world take their persona's set).

**The migration.** Every page read that hands a screen a character's profile hands its `pronouns` too: each function,
at its latest definition, whose body projects `character_profiles` columns to a screen (`grep -l pip_style` over the
latest definitions finds them: `thread_page` 0111, `board_page` and `index_page` 0095, `profile_page` and `record_page`
0104, `boot` 0098, `updates` 0062, `boss_roster` 0082 and `admin_queue` 0102 at the time of writing). Where a read hands a
screen a staff member by name alone, its `pronouns` go beside the name (the amendment, section 5): a visit's Mod in
`thread_page`, `beat_mod_name` (0111; its callers in `web/src/data/supabase.ts` move with it), the queue's Boss. The
column is public; each read stays `security invoker` where it was, and `tools/check-web-reads.mjs`'s lists are unchanged.

**Tests first:** the SQL test calls each read above for a she/her character and finds `pronouns` on it;
`supabase/tests/e2e/0016-screen-reads.ts` stays green. The fake makes a character with she/her and reads it back on
`Character` and `MyCharacter`, and refuses a bad set with the SQL's words; the Supabase client sends `pronouns` to
`create_character` and `set_profile` and reads it from every page.

**Poison,** run once and recorded red: `thread_page` left without `pronouns` (the SQL test names it).

## Task 5. The picker and the profile line (screens, the glass)

Model: sonnet

**Files:** new `engine/ui/characters/PronounPicker.tsx` with its test and a story; `engine/ui/characters/NewCharacter.tsx`;
`engine/ui/profile-edit/ProfileEdit.tsx`; `engine/ui/profile/Profile.tsx` (the label under the title, class
`kb-profile-pronouns kb-muted`); `engine/ui/profile/Staff.tsx` (the same line on a staff profile);
`engine/ui/characters/characters.css`.

The picker (the first design, section 7): a radio group, legend "Pronouns", five options (`it/its`, `he/him`, `she/her`,
`they/them`, `Custom…`), drawn as the class cards are (`ClassCards.tsx`). Custom… shows five fields labeled Subject,
Object, Possessive adjective, Possessive, Reflexive, each with a they-set placeholder, and a radio pair "Verbs like *they
are*" / "Verbs like *it is*". Each field's problem shows under it in `pronounProblems`' words. The preview is a
`<p aria-live="polite">` in the character's name (or "Your character"): `{Name} posted. {They} {is} a Face. The card is
{theirs}; {they} played it on {their} own post {themself}.` New character starts on `settings.pronouns`; Edit profile on
the stored set, saved with the rest.

**Tests first:** choosing she/her sends she/her; a 13-letter custom subject shows its problem and disables saving; the
preview reads "She is" and "They are"; the group is keyboard-operable and passes the axe check (`engine/ui/a11y.ts`); a
profile shows `it/its` for a default character and `xe/xem` for a custom one; a staff profile shows its set.

## Task 6. Copy about one character

Model: sonnet

Each line names one character and takes that character's set through `words()`, its verbs agreeing. The set comes with
the character the screen already reads (Task 4), passed down, never fetched again. A line about the Boss or a Mod takes
the set of the character holding the office now (the amendment, section 5).

- **The tab's own character** (`engine/ui/characters/`): `previews.ts:32`; `footers.ts:16,19-21,36`; `reveal.ts:21`;
  `TurnDialog.tsx:107`; `DebutChoice.tsx:31,34,38,46,54` (a `pronouns` prop beside `name`: the picker's live choice on
  New character, the stored set in `DebutDialog.tsx`); `Characters.tsx:45,236,237,302,314,350`; `NewCharacter.tsx:90`
  ("Only you will know {their} class, unless you choose to reveal it.").
- **The composers' current mask:** `engine/ui/composer/Composer.tsx:117,175`, `engine/ui/board/NewThread.tsx:56`,
  `engine/ui/spin/SpinForm.tsx:63` ("can post once {they} {has}").
- **The log's character:** `engine/ui/log/Settlement.tsx:142` ("{they} score{s} as"), `engine/ui/log/lines.ts:302,360`,
  `engine/ui/log/Log.tsx:157`.
- **A profile's character:** `engine/ui/profile/Profile.tsx:94`, `Record.tsx:71`, `engine/ui/profile-edit/ProfileEdit.tsx:108,111`,
  `engine/ui/reveal/Reveal.tsx:84,131`, `engine/ui/reveal/statements.ts:57,59` ("until {their} Turn").
- **Staff:** `engine/ui/profile/Staff.tsx:61,63,80,107,177`; `engine/ui/season/Season.tsx:113,115,116` (the debut and
  Turn lines, about the one character named) and `:143,144,146` (the Boss's); `engine/ui/admin/Queue.tsx:190,508,510,511`;
  `engine/ui/thread/lines.tsx:110` (`MoveKeepLine`: "{name} kept a move of an earlier Boss. The move is now {theirs}.");
  `engine/ui/cards/visit.ts:68,114` and `engine/ui/cards/Visit.tsx:99,300` (the visit's Mod).
- **A card's target:** `engine/ui/cards/PlayForm.tsx:232` ("on every post of {theirs}"); Glitter Bomb's status and
  summary (`instances/divided-world/ui/cards.ts:178,179`) are general and are rephrased with no pronoun in Task 7.
- **Rephrased with no pronoun,** since their strings name no character: `engine/system/career.ts:22` ("named by the Boss
  before"), `engine/system/demands.ts:99` ("the named character posted").

Each changed string's test is moved to a non-it set first (she/her for one, they/them for another, so agreement is
exercised), and red before the change. The tests that hold these strings: in `engine/ui/characters/` `footers.test.ts`,
`NewCharacter.test.tsx`, `Characters.test.tsx`; `engine/ui/log/` `Settlement.test.tsx`, `Log.test.tsx`, `lines.test.tsx`;
`engine/ui/profile/` `Profile.test.tsx`, `Staff.test.tsx`; `Season.test.tsx`, `Reveal.test.tsx`,
`engine/ui/thread/Staff.test.tsx`, `Queue.test.tsx`; `engine/ui/cards/` `marks.test.tsx`, `lens.test.tsx`, `forms.test.tsx`,
`lens-words.test.ts`, `plays.test.tsx`; `career.test.ts`. The e2e mirrors move with them: `e2e/boards/09-settlement.ts:84,86`,
`06-turn.ts`, `2026-11-05-backfill/23-new-character.ts`, `24-debut.ts`, `28-lens.ts:118`, `30-log-empty.ts:41`.

## Task 7. Copy about characters in general

Model: sonnet

The first design, section 2: a general "its" stays where it reads cleanly; where it is clumsy, the sentence is rephrased
to need no pronoun, pointing at the player where that reads better. Files:
- `instances/divided-world/ui/index.ts`: the ledger reasons (52-74) and the class descriptions (110-114).
- `instances/divided-world/ui/cards.ts:123,178,179,181` (Trap Card's "their wallet", Glitter Bomb's "posts of theirs" and
  "any of their posts").
- `instances/divided-world/ui/onboarding.ts:16,49`; `instances/divided-world/ui/front-door.ts:61`;
  `instances/divided-world/guide/strategy-guide.md` (21, 49, 63, 73, 75, 76, 82, 108); `engine/ui/welcome/Welcome.tsx:40`.
- `engine/ui/characters/Characters.tsx:361,410`, `engine/ui/characters/NewCharacter.tsx:51`,
  `engine/ui/rankings/Rankings.tsx:175,177`, `engine/rules/actions.ts:124`, `engine/rules/instance.ts:324`.
- Their mirrors: `engine/ui/test-world.tsx:82-85`, `e2e/boards/09-settlement.ts:58,63,68`,
  `e2e/boards/2026-11-05-backfill/31-log-open.ts:25`, `e2e/boards/10-roster.ts:106,107`, `e2e/boards/13-rankings.ts:79`.

`tools/check-guide.mjs` runs on the guide as before. The PR's description lists each changed sentence before and after,
for the owner's word on the guide's, onboarding's, front door's and welcome page's (CLAUDE.md, "The fiction may lie; the
log never does").

## Task 8. The model is told (migration and system)

Model: sonnet

**The migration:** `system_digest` (0052), its `characters` gaining `'pronouns'` from `character_profiles`; `pool_thread`
(0089), each post gaining its author's `pronouns`; `patrol_sample` (0110), each sampled post gaining its author's;
`character_faces(ids jsonb) returns jsonb`, new, `{id: {name, pronouns}}` for public characters, owned by
`kayfabb_digest` as `pool_names` is, replacing `pool_names` (dropped, its two callers moved). The digest role is granted
select on `character_profiles (character, pronouns)` if it lacks it. Every read is of a public column.

**The system** (the amendment, sections 2 and 6), each prompt writing a character as `Name (label)`:
- `engine/system/digest.ts`: `DigestCharacter.pronouns` and the renderer.
- `engine/system/meeting.ts`: `ReferenceIds.characters` (`- Gloomba (she/her): <id>`); the successors' roster (`key (Name,
  she/her)`); each Mod's section, its heading carrying the label and its "It…/Its…" lines (257, 263, 287, 289-294) taking
  the Mod's `words()`; 326 rephrased ("These moves, made by the Boss before you, are still in force."); the persona's
  `selfPronounLine` after `f.boss.persona` (220).
- `engine/system/judgment.ts`: `modPrompt`'s character names (the memory's opinions), `selfPronounLine` after
  `i.persona.persona` (294), 299 rephrased ("until the Boss's next meeting"); `filingPrompt`, `reportPrompt`,
  `appealPrompt` and `patrolPrompt` label each post's author, the reporter and the appellant. `filingCompletion` is
  unchanged.
- `engine/system/chatter.ts`: `ThreadPost` and the quoted post labeled; `selfPronounLine` after `i.persona.persona` (320);
  `chatterCompletion` unchanged.
- `supabase/functions/meet/core.ts`, `supabase/functions/chatter/core.ts` and `supabase/functions/staff/` (`core.ts`,
  `report.ts`, `appeal.ts`, `patrol.ts`): pass the sets from the reads above, the reporter's and appellant's from
  `character_faces`, a persona's own from its file else `settings.pronouns` else the engine default.
- `instances/divided-world/system/persona.ts`: one line in `BOSS_PREMISE` and `MOD_BOT_PREMISE`: "Each character's
  pronouns are written beside its name; use them."

**Tests first:** the SQL test reads `pronouns` on a digest character, a `pool_thread` post, a `patrol_sample` post and a
`character_faces` entry. `digest.test.ts`, `meeting.test.ts`, `judgment.test.ts` and `chatter.test.ts` expect the
`(she/her)` tags and the self line, and a Mod's section for a they/them Mod reads "Their beat now"; the two completion
frames' tests expect no tag.

## Task 9. Staff pronoun tokens in stock lines (migration and instance)

Model: sonnet

**The migration** (the amendment, section 1):
- `fill_tokens` (0048), copied whole, its token pattern `[\w.]+` where it was `\w+`, so `{mod.they}` is a token.
- `pronoun_tokens(prefix text, who uuid) returns jsonb`, stable, new: `{prefix}.{form}` for every key of the words
  table, from `who`'s profile, else the `pronouns` setting, else the it-set. The verb keys follow `plural`.
- `system_line` (0102), `visit_line` (0105), `report_line` (0107) and `appeal_line` (0109), each copied whole, merging
  `pronoun_tokens('boss', …)` or `pronoun_tokens('mod', …)` for the staff character they already look up into the
  values they fill. No caller changes.

**The instance:** `instances/divided-world/system/lines.ts:75` becomes "Case closed by {mod}, with the finding {rule}.
{mod} has already forgotten how {mod.they} felt about this."; the comment at the top of the file names the forms.

**Tests first:** the SQL test fills `visitFiled` for a they/them Mod and reads "how they felt", for an it/its Mod "how
it felt"; `{mod.They} {mod.is}` reads "They are" and "It is"; a token for a form that does not exist is left as written,
as `fill_tokens` leaves an unknown token today. `instanceProblems` refuses `{reporter.they}` (Task 1's test).

**Poison,** run once and recorded red: `fill_tokens` with its old pattern (the they/them row fails).

## Task 10. The export carries it

Model: inline

`supabase/tests/e2e/0003-export.ts`: one character is given a custom set (`xe/xem/xyr/xyrs/xemself`, plural false)
before the export, and the round trip compares it. Red first with the column left out of the comparison's expectation,
then green with the exporter as it is (`tools/instance-files.mjs` copies every column).

## Last. The full build and the final review

`npm run typecheck` and `npm run build:ci`, with their output. Screenshots at deviceScaleFactor 2 of New character with
Custom… open, Edit profile, and a profile page with `she/her`, for the owner.

## Ways out of the states this adds

- No state is added that a player, a character or a post can be put in. A character's pronouns are edited on Edit
  profile whenever its player likes; a refused set says which form failed and why. A staff character's follow its
  persona file at the next seed.

## The masks

- `pronouns` is a public profile column, read only where a profile or a public name already is. Nothing is computed
  from who owns a character.
- `updated_at` is set on an edit and never projected, as for the title (0019).
- A player's same set across masks is a clue from public play, which the game allows.
- No Realtime event or timing is added. The page reads gain a column, not a query.

## Review focus

- **Characters an instance already holds.** The backfill gives every character a row; no read path still treats a
  missing profile row as "no profile" in a way the new rows change (`set_avatar` in 0025, the profile editor's "has no
  profile to edit until it has debuted", the avatar sweep).
- **The dropped signatures.** `set_profile`, `create_character`, `beat_mod_name` and `pool_names` change; every caller
  (`web/src/data/supabase.ts`, the SQL tests' fixtures, `supabase/tests/e2e/`, the edge functions) moves, and the grants
  follow.
- **Copied functions.** Each copied body is the latest on `main` when the migration is written; a definition that
  landed after this plan is not overwritten by an older copy.
- **A reseed** rewrites staff pronouns and nothing else on a staff profile.
- **Verb agreement** in every Task 6 line and stock line, read aloud with they/them: no "they is", no "they scores".
- **The office's holder.** A line about the Boss or a Mod reads the current holder's set, never a persona file's.
- **The digest's and prompts' size** at a busy instance: one short tag per named character, bounded by the lists
  already capped (`DIGEST_MOST`, `REFERENCE_MOST`, the patrol sample, the thread excerpts).
