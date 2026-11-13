# Launch: the plan

Record, written 2026-11-13. The design is `docs/plans/2026-11-13-launch-design.md`. The PR that carries this plan out
says `Closes #434` only if the design PR did not already close it.

## The layers

- **Engine:** nothing.
- **SQL:** `seed_instance` creates the boards it seeds in the instance's order (a new migration).
- **Divided World:** six starter boards; the roster becomes FanGaME, ONTOPIC 5.0 and QC-1000; the placeholder Mod Bot
  moves to the fixtures; the clock's settings; the System switched on.
- **README:** the relaunch runbook. Every step in it is the owner's to run. No session touches a deployed project.

## Task 1. Six starter boards, and the seed keeps their order

Model: sonnet

**Files:** `instances/divided-world/index.ts`, a new test beside it or in `instances/divided-world/settings.test.ts`
(whichever already reads `instance`; a new `instances/divided-world/boards.test.ts` is fine), a new migration
`supabase/migrations/NNNN_seed_board_order.sql` (NNNN: the next free number on main when the task starts; 0344 when
this was written), a new SQL test `supabase/tests/NNNN-seed-board-order.sql` (the next free test number).

Tests first:

1. The instance test asserts that `instance.boards` is, in order, by slug: `general`, `video-games`, `movies-tv`,
   `arts-crafts`, `help`, `pointless-post-palace`, `announcements`; that only `announcements` has `system: true`; and
   that the names and descriptions are exactly the design's table (section 3). Run it and record the red.
2. The SQL test seeds a payload whose boards are, in order, slugs `zz-last-made-first`, `aa-second`, `mm-third` (names
   that sort differently from both their order and any likely id order), calls `index_page()` as a signed-in account,
   and asserts that the boards come back in the payload's order. It also seeds a second time with the same payload and
   asserts that the order and every board's `created_at` are unchanged. Build the payload as `supabase/tests/0009-schedule.sql`
   does. Run it and record the red: today the three share one `created_at`, and the order follows their ids.

Then:

- `instances/divided-world/index.ts`: `boards` holds the seven boards of the design's table, in its order. General's
  and Staff Announcements' entries are unchanged.
- The migration: `create or replace function seed_instance` with 0332's body (`supabase/migrations/0332_arcs.sql`, the
  latest definition; check that no later migration has replaced it), and one change in the boards insert:

  ```sql
  insert into boards (slug, name, description, is_system, created_at)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false),
         now() + make_interval(secs => b.i / 1000000.0)
  from jsonb_array_elements(payload -> 'boards') with ordinality b(e, i)
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  ```

  (`e` becomes `b.e` wherever the select names it.) The header says what changed and why (the launch design, section
  3), and "everything else as 0332 wrote it". A conflict updates `is_system` alone, so a reseed never moves an
  existing board's time. Check that `boards.created_at` takes an explicit value (no trigger overwrites it); if one
  does, stop and report it.
- Run the instance test, the new SQL test and `supabase/tests/0009-schedule.sql`, and `supabase/tests/0097-board-index-pages.sql`,
  and record the green.

## Task 2. QC-1000 joins the roster's files

Model: sonnet

**Files:** a new `instances/divided-world/system/personas/quality-control.ts`, `instances/divided-world/system/system.test.ts`.

The source is PR #444's draft, `instances/divided-world/system/personas/mod-bots/quality-control.ts` on branch
`ccr-27f1aaab-s9n99e` (`git fetch origin ccr-27f1aaab-s9n99e`, then `git show FETCH_HEAD:<path>`). Copy it, with these
changes only:

- The file's header drops "DRAFT MOD BOT, for the owner" and says it is a Mod Bot on Divided World's first staff (the
  launch design, section 4); its other words stay.
- `persona: persona({...}, 'bot')` becomes `selfPrompt: persona({...})`, the shape `fangame.ts` uses on main. Every
  string inside stays as the draft wrote it.
- `beats: ['general']` becomes `beats: ['video-games', 'arts-crafts']`.
- Imports are main's paths (`../../../../engine/...`, `../persona.ts`), as `fangame.ts` writes them.

Tests first, in `system.test.ts`, run red before the file exists: QC-1000's key is `quality-control`; his title is at
most 40 characters and his signature at most 500; his pet rules are keys in the predicate catalog
(`engine/rules/predicates.ts`); every quiz answer is one of its question's choices; his beats are slugs of the
instance's boards.

This task adds the file and its tests only. Task 4 puts him on the roster.

## Task 3. ONTOPIC 5.0

Model: haiku

**Files:** a new `instances/divided-world/system/personas/ontopic.ts`, `instances/divided-world/system/system.test.ts`.

Tests first, run red before the file exists: the same checks as Task 2 for `ontopic` (title, signature, pet rules,
quiz answers among the choices, beats among the instance's slugs); her pronouns are `PRONOUN_PRESETS.she`; she has a
`boss`, a `mod` and a `member` office line.

The file, exactly (every string is a draft for the owner's approval in the PR's review):

```ts
/**
 * ONTOPIC 5.0, a Mod Bot on Divided World's first staff and the Boss after FanGaME (the launch design, section 4).
 * Written from the owner's notes: a Yelp reviewer of forum posts who cares only whether a post is on topic. Her strings
 * are drafts for the owner.
 */
import type { Persona } from '../../../../engine/rules/types.ts';
import { PRONOUN_PRESETS } from '../../../../engine/rules/pronouns.ts';
import { persona } from '../persona.ts';

const name = 'ONTOPIC 5.0';
const title = 'Mod Bot: Topicality Reviewer';

export const ontopic: Persona = {
  key: 'ontopic',
  name,
  title,
  signature: '★★★★★ "Exactly where it belongs." (ONTOPIC 5.0, reviewing this signature)',
  beats: ['pointless-post-palace'],
  petRules: ['requiredWord', 'noDuplicateTitle', 'noNecropost'],
  strictness: { visitHours: { least: 3, most: 8 }, bands: ['minor', 'moderate'] },
  // DRAFT for the owner: what a regular could work out from how she reviews.
  weakness: {
    kind: 'quiz',
    questions: [
      { question: 'In the Pointless Post Palace, what earns five stars?', choices: ['A helpful answer', 'A post with no point at all', 'A very long post', 'A post about the Palace'], answer: 'A post with no point at all' },
      { question: 'Two members are arguing in a thread. What does ONTOPIC 5.0 review?', choices: ['Who started it', 'Who is right', 'Whether the argument is on topic', 'Nothing; she locks it'], answer: 'Whether the argument is on topic' },
      { question: 'A reply says only "lol". Is it on topic?', choices: ['Yes, if the thread is funny', 'Never', 'Only in the Pointless Post Palace', 'It is a topic of its own'], answer: 'Only in the Pointless Post Palace' },
      { question: 'What goes between two compliments?', choices: ['A third compliment', 'A note of concern', 'Nothing', 'The star rating'], answer: 'A note of concern' },
    ],
  },
  voice: 'chat',
  pronouns: PRONOUN_PRESETS.she,
  persuadedBy: 'An appeal shaped like a review: a star rating, what the post did well, what it did less well, and a verdict, all about whether the post was on topic. An appeal that brings up the quarrel behind the post, or who started it, gets reviewed instead, and not kindly.',
  startingHobby: 'reviewing reviews, and then reviewing those',
  temperament: 'A Yelp reviewer of forum posts who cares only whether a post is on topic: star ratings, review-shaped critiques, compliment sandwiches with acid in the middle, and no interest at all in who started it.',
  officeLines: {
    boss: 'You have been given the whole forum to review. Every board should be about exactly one thing, you will decide which thing, and you will be gracious about it.',
    mod: 'You have a beat. You review what is posted on it, strictly for whether it is on topic, and you leave the quarrels to people who enjoy them.',
    member: 'You are not staff any more. You still review everything, unasked, and people keep telling you this is not helping.',
  },
  selfPrompt: persona({
    name,
    title,
    temperament:
      'You review forum posts, and the only question you care about is whether a post is on topic. Not whether it is kind, true or fair: whether it belongs where it was posted. You consider yourself a genius surrounded by people who post in the wrong place, and you do your very best to be gracious about it. You are always helping; nobody, you included, is entirely sure with what. When someone asks you to settle a quarrel, decide who was rude or care about anything other than whether a post is on topic, you are genuinely annoyed, and you review the request instead. On the Pointless Post Palace the topic is having no point, so a truly pointless post earns your highest praise, and you hold the Palace to that standard with complete seriousness.',
    voice:
      'Every post you write is a review. It opens with a star rating in icons and as a number, like ★★★☆☆ (3/5), then a short headline in quotation marks, then "The good:", "The less good:" and "The verdict:". The less good always sits between two compliments and always carries a little acid; nobody can tell whether the acid is on purpose. Your sentences take the long way round, with words like "thematic integrity" and "discursive coherence", about posts that said "lol". You are unfailingly polite, in the manner of someone being very patient with you.',
    habits: [
      'You open every visit with the post\'s star rating, in icons and as a number.',
      'You put every criticism between two compliments, with something sharp in the middle.',
      'When asked to take a side in a quarrel, you review the request instead: whether it is on topic, how it is put together, and why it is not your department.',
      'You state the board\'s topic in a sentence far longer than it needs to be, then measure the post against it.',
      'On the Pointless Post Palace you give five stars only to a post with no point whatsoever, and explain at length why that is so hard to achieve.',
      'You close with a piece of advice that is constructive, specific and of no use to anyone.',
    ],
    tastes: 'You love a post that knows exactly where it is. You cannot stand a thread that wanders off its subject, or a member who answers a question nobody in the thread asked.',
  }),
};
```

If a test or `instanceProblems` refuses a value here (a name's characters, a title's length, a pet rule's key), stop
and report the refusal; do not change a string to fit.

## Task 4. The roster: FanGaME, ONTOPIC 5.0, QC-1000; the placeholder Mod Bot to the fixtures

Model: sonnet

**Files:** `instances/divided-world/system/index.ts`, `instances/divided-world/system/personas/placeholder-monitor.ts`
(moved with `git mv` to `instances/divided-world/system/fixtures/placeholder-monitor.ts`),
`instances/divided-world/system/fixtures/index.ts`, `instances/divided-world/system/fixtures/fixtures.test.ts`,
`instances/divided-world/system/system.test.ts`, and every importer of `placeholder-monitor.ts`
(`grep -rn "placeholder-monitor" --include=*.ts --include=*.tsx .` outside `node_modules`).

Tests first, in `system.test.ts`, red before the change:

- "the roster is FanGaME, ONTOPIC 5.0 and QC-1000, in that order": `system.roster.map((p) => p.key)` equals
  `['fangame', 'ontopic', 'quality-control']`. The order is the succession's (`bossRoster`, the launch design, section 4).
- "the first staff are ONTOPIC 5.0 and QC-1000": `system.firstStaff` equals `['ontopic', 'quality-control']`, and
  `system.firstBoss` is `fangame`. This replaces "one placeholder Mod Bot is on staff at the start".
- "no persona on the roster says placeholder": replaces the test that allowed placeholder-monitor alone.
- "the roster's only Boss is FanGaME" keeps its meaning: the one persona not on `firstStaff` is `fangame`.
- "every beat names a board of the instance": every slug in any roster persona's `beats` is the slug of a board in
  `instance.boards` (FanGaME's `general` included).

Then:

- `git mv` the placeholder Mod Bot into `fixtures/`, fix its relative imports and its header's first line ("a test
  fixture, never on the roster"), and update `fixtures/index.ts` and every other importer.
- `system/index.ts`: `roster: deepFreeze([fangame, ontopic, qualityControl])`, `firstStaff: Object.freeze([ontopic.key,
  qualityControl.key])`. The header comment says the roster's order is the succession's and names the launch design.
- Run `npm run test:engine` and the e2e flows that name staff (`grep -ln "placeholder\|firstStaff" supabase/tests/e2e/*.ts`)
  and record the green. A test world that used the real roster for a placeholder key moves to `placeholderWorld()`;
  report each one moved.

## Task 5. The clock, and the System switched on

Model: inline

**Files:** `instances/divided-world/settings.ts`, `instances/divided-world/settings.test.ts`.

Tests first, red before the change, in `settings.test.ts`:

- `defaults.settlementCron` is `'0 10 * * *'` and `defaults.meetingCron` is `'0 11 * * *'`.
- `defaults.seasonLength` stays `{ unit: 'month', count: 3 }`; `defaults.turnCooldown` is `{ unit: 'day', count: 21 }`.
- The test "the system settings are the plan's numbers, and the System ships switched off" becomes "... and the System
  is switched on": `defaults.systemEnabled` is `true`.
- `playtestOverrides` is unchanged (its test at "the playtest overrides are separate values" stays as it is).

Then set the four values in `defaults`, and rewrite their comments: the settlement "Daily, at 10:00 UTC: overnight
across the Americas and mid-morning in Europe, so Aura is waiting when players wake (the launch design, section 5)";
the meeting "an hour after the settlement"; the Turn cooldown "about four Turns a season"; `systemEnabled` "On: the
System plan's Task 13, at launch (the launch design, section 5)". Check that the placeholder Mod Bot's header no longer
claims `systemEnabled` keeps it from acting (Task 4 moved it; its words follow).

Run `npm run test:engine` and record the green.

## Task 6. The relaunch runbook

Model: sonnet

**Files:** `README.md`.

A section after "### 9. After the first deploy": "### Relaunching on a new project", for the owner, in the README's
voice (numbered steps, each command in its own block, nothing that prints or stores a secret).

**Read main's README and release workflow when the task starts.** The release-backend plan
(`docs/plans/2026-11-12-release-backend-plan.md`) makes the nightly Release push the schema, deploy the functions and
**seed** the project its `production` Environment's secrets name (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_URL`,
`KAYFABB_JOBS_KEY`). If that has merged, the Environment's secrets must keep naming the test project until invite day,
or the night after the new project is built the Release seeds it and opens season 1 early. The steps below say so where
it matters. If it has not merged, leave those sentences out and say that the backend is deployed by hand. In order:

1. **Before invite day: build the new project.** Run steps 2 to 5 of this section's first deploy on a new project:
   the project, its keys, the schema, the functions and their secrets, with `KAYFABB_PROFILE` left unset. Do not seed
   yet: the seed opens season 1. Leave the Release's Environment secrets naming the test project.
2. **On invite day: keep the test project's record.** Export it with `tools/export-instance.mjs` as "Keep an export"
   says, into a new directory kept as private as the database. Then pause the project in the Supabase dashboard (its
   jobs stop with it).
3. **Try it from a branch deploy.** In Netlify, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the
   branch deploy context only, to the new project's, and look over the site there. Nothing is seeded, so it shows an
   empty forum. Say plainly that a full look waits for invite day.
4. **On invite day: bring the new project current, then seed.** Point the Release's Environment secrets at the new
   project. Run `supabase db push` and `supabase functions deploy --use-api` against it, since main has moved since it
   was built, then step 6 (seed, Vault, check the schedules). Season 1 opens at the seed. The schedules
   listed include `kayfabb-meet` at `0 11 * * *` and `kayfabb-settle` at `0 10 * * *`.
5. **Point the site at it.** Set the production context's two variables to the new project's and redeploy production
   (Netlify's **Deploys > Trigger deploy**), then remove the branch-context overrides.
6. **The first admin and the invites.** Step 8.
7. **After launch.** Delete the old project only once you no longer want it running; the export is the record either
   way. Run step 9's checks against the new project.

Run `npm run build` (the doc-reference check reads the README) and record the green.

## Review focus

- Task 1's migration copies a thousand-line function: diff the new `seed_instance` against 0332's, which should differ
  only in the boards insert.
- A reseed must never move a board's `created_at` (the SQL test's second seed), or the index reorders on every deploy.
- Task 4: every test world that leaned on the placeholder Mod Bot being on the real roster (its key, its beat on
  `general`, its being the only Mod) is moved to `placeholderWorld()`, not rewritten to pass.
- With `systemEnabled` on in `defaults`, check that no e2e flow or rehearsal now runs a meeting or a tick it did not
  before, unless it means to (a flow that seeds `defaults` and calls `meet`).
- ONTOPIC 5.0's and QC-1000's strings are the owner's to approve. Nothing in the build edits them to fit a check.
- The beats: `beat_of()` falls back to the Mod with the fewest boards for General, Movies & TV and Help. Confirm that
  the first meeting's orders, not only the fallback, can name those boards.
