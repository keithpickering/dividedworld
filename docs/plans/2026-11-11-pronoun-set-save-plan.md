# Saving a pronoun set: plan

Record, written 2026-11-11. Fixes items F3 and N1 of issue #370 (follow-ups from PR #331's reviews), two defects in
the path that saves a character's pronouns from Edit profile. No design session ran: the owner asked for the build
straight from the issue, so this plan holds each root cause and the direction taken. Every task goes test first: write
the failing test, show its red run, then write the code. During a task run only the tests for the changed code
(`npx vitest run <file>`); run `npm run build` once after the last task.

The form the fix keeps: nothing a player chose is ever overwritten by a default, and the real client, the fake and
SQL agree on what a stored set is.

## The two root causes

**F3. Edit profile sends a custom set untrimmed.** A set is normalized (trimmed and lowercased) by
`normalizePronouns` (`engine/rules/pronouns.ts`), and every screen judges a set after normalizing it
(`pronounsHold` in `engine/ui/characters/PronounPicker.tsx`), so `"xe "` shows no problem and Save is enabled. Three
writers take a set from a player:

- `createCharacter` goes through the `act` function, whose `pronouns` (`engine/rules/actions.ts`) trims and lowers
  before `create_character` sees it;
- the fake's `setProfile` and `createCharacter` (`engine/ui/data/fake.ts`) hold and store `normalizePronouns(set)`;
- the real client's `setProfile` (`web/src/data/supabase.ts`) calls the `set_profile` RPC directly with the set as
  typed. `set_profile` (0124) lowers it (`pronouns_lowered`) and holds it (`pronouns_hold`), and `pronouns_hold`
  rightly refuses a space, with "pronouns are five words of 1 to 12 letters", which names no form.

So the root cause is that one TypeScript edge, the real client's `setProfile`, skips the normalizing every other
TypeScript edge does. The direction taken is the issue's first: `setProfile` sends `normalizePronouns(pronouns)`.

Why not trim in `pronouns_lowered`: SQL would then hold a second definition of "trimmed" (`String.prototype.trim`
strips a list of Unicode spaces and line ends that a SQL expression would have to repeat), and two definitions that
must agree drift ("Two lists that must agree are one list"). With this direction there is one definition,
`normalizePronouns`, applied at each TypeScript edge before SQL; SQL never trims, so it cannot disagree about what a
space is, and it stays strict: a caller that hands `set_profile` a padded set is refused, which is right for a caller
that skipped the edge. No SQL changes, so there is no migration.

**N1. A profile read missing its set falls back to it/its.** `toCharacter` (`web/src/data/supabase.ts`) builds a
`Character` from a character row and its profile row. Its `pronouns` line is
`p ? pronounsOrDefault(p['pronouns']) : ENGINE_DEFAULT_PRONOUNS`: a profile row that comes without `pronouns` (as
when a select or a projection drops the column) yields the engine's it/its, indistinguishable from a stored it/its.
The comment above it says the fallback "stands only for a character with no profile row at all", which the code does
not do. `character_profiles.pronouns` is `not null`, so a profile row without a set is always a read that failed to
carry it. Edit profile (`engine/ui/profile-edit/ProfileEdit.tsx`) starts its form from that `Character`, so it
would open on it/its with Save enabled, and a save would send it/its and overwrite the set the player chose.
`ProfileEdit` already disables Save and hides the picker when its set is null, but `Character.pronouns` is never null,
so that branch is unreachable.

The direction taken: a missing set stays known to be missing. `Character.pronouns` keeps its type, because about forty
places write copy with it and the engine's it/its is a fair word for display. `Character` gains an optional marker,
`pronounsUnread?: true`, set by `toCharacter` when a profile row came without its set; `pronouns` is then the engine's
fallback, for display only. A character with no profile row at all is not marked (amended while building, see below). `ProfileEdit` reads a marked character's set as null, so the picker is not shown and Save
is disabled: both of the issue's directions end at "a profile without a set does not enable Save". That is a state a
player can now reach, so it names its way out on the screen ("No player is ever stuck"): a plain notice that the
pronouns could not be loaded, nothing was changed, and reloading the page tries again.

Why not `pronouns: PronounSet | null` on `Character`: every display site would need its own fallback, forty copies of
one decision. Why not throw on a profile without a set: a thread page would fail whole because one face's set was
dropped from a read.

Amended 2026-11-11, while building (Task 2's quality review): this plan first marked a character with no profile row
too, reasoning that every character has a row since 0124. That is not so: 0124's backfill makes no row in a database
that had no `default` pip style, "and set_profile makes the row". For such a character nothing is stored to
overwrite, and marking it would close Edit profile to it for good, since no reload brings a set. So the marker is
only for a row that came without its set, which is what the old comment said and the issue's second direction asks
("make the comment above that line true"). The form also takes a set that a later document carries, so the state ends
without a full reload where the page reads again.

## Task 1. The real client sends a normalized set (F3)

Model: inline.

Files: `web/src/data/supabase.ts`, `web/src/data/supabase.test.tsx`, `engine/ui/data/fake.ts` (a comment only).

- Test first, in `supabase.test.tsx` beside "sends the pronouns with createCharacter and set_profile": `setProfile`
  with a set whose forms are padded and capitalized (`' Xe '`, `'xem\t'`, ...) sends `set_profile` the trimmed,
  lowercased set; a call with no set still sends `pronouns: null`. Red run: the body carries the padded set.
- `setProfile` sends `pronouns === undefined ? null : normalizePronouns(pronouns)`. Its comment says why: the picker
  and the fake judge a set normalized, and `set_profile` refuses a space.
- `fake.ts`: the comment over `pronounsHold` says a set is held "after it is lowercased"; make it say what the code
  does and why it matches the real client (normalized, as the real client's `setProfile` and the `act` function send
  it).

## Task 2. A set no read carried is never saved (N1)

Model: sonnet.

Files: `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `web/src/data/supabase.test.tsx`,
`engine/ui/profile-edit/ProfileEdit.tsx`, `engine/ui/profile-edit/ProfileEdit.test.tsx`.

- `api.ts`, `Character`: `readonly pronounsUnread?: true`, documented: the read that built this character carried no
  set, so `pronouns` is the engine's it/its for display only and is never offered for saving. Correct the comment on
  `pronouns` (it says a character with no profile row has the engine's it/its).
- Tests first, in `supabase.test.tsx`: `characters()` given a profile row with no `pronouns` yields
  `pronounsUnread: true` with `pronouns` the engine's default; a row that carries a set, and a character with no
  profile row in the read, yield no marker. Red run: no marker.
- `toCharacter`: the set is the row's when the row carries an object, else the engine's default, with the marker where
  there is a row. Make the comment above the line true. `pronounsOrDefault` stays for the staff reads that use it.
- Test first, in `ProfileEdit.test.tsx`: a world whose document hands Edit profile a face with `pronounsUnread: true`
  (wrap the fake's read; the fake itself always knows the set) shows no pronoun picker, shows the notice, has Save
  disabled, and submitting the form calls `setProfile` zero times. Red run: the picker shows it/its and Save is
  enabled.
- `ProfileEdit`: the form's set is `profile.pronounsUnread ? null : profile.pronouns` in both places it is set (the
  initial state and the reset when the chosen character changes), and a form whose set is null takes the set of a
  later document that carries one (test: the document changes under the form, and the picker comes back on the stored
  set with Save enabled). Where the set is null for a live profile, a notice
  in the form's place of the picker, out of character and plain: "{Name}'s pronouns could not be loaded, so this
  profile cannot be saved right now. Nothing has been changed. Reload the page to try again." (the name only; no
  pronoun words, since the set is the thing unknown). It is announced the way the screen's other notices are.

## Review focus

- No path from a `Character` with `pronounsUnread` reaches `setProfile` or `set_profile` with a set.
- The marker is computed only from whether the read carried a set, never from who is reading ("A response never
  proves a private fact"): pronouns are public, like a title.
