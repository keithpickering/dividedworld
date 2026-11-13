# What the season rehearsal found: the plan

Record, written 2026-11-13. The design is `docs/plans/2026-11-13-rehearsal-patch-design.md`; the record it answers is
`docs/research/2026-11-13-season-rehearsal/README.md`.

**This plan is built before the launch plan** (`docs/plans/2026-11-13-launch-plan.md`) **and takes over that plan's
Tasks 2 and 3** (the design, section 1). It never touches the roster (`system.roster`, `firstStaff`), the boards, the
clock or `systemEnabled`; those stay the launch's Tasks 1, 4 and 5. The launch build that follows starts at its Task 1
and skips Tasks 2 and 3.

## The layers

- **Engine:** the judging prompts, the word cut, the meeting's stated bounds, ask, standing nomination and season-end
  drop, chatter's length and cap, the filler's boards.
- **SQL:** `hand_over` withdraws the outgoing Boss's waiting moves; `meeting_context` carries the standing nomination.
- **Edge Functions:** `meet/core.ts` and `chatter/core.ts` pass what the engine now takes.
- **Divided World:** the premises, the stock lines, the announcements title, ONTOPIC 5.0 and QC-1000, the corpus.
- **Tools:** `tools/rehearse/run.ts` reads the open boards.

Migration and SQL test numbers are the next free ones on main when the task starts (0357 and 0304 when this was
written). Every task runs `npm run test:engine` at its end and records the green; a task with SQL also runs its own SQL
test and the ones it names.

## Task 1. ONTOPIC 5.0 and QC-1000 (the launch plan's Tasks 2 and 3, amended)

Model: sonnet

**Files:** new `instances/divided-world/system/personas/ontopic.ts`, new
`instances/divided-world/system/personas/quality-control.ts`, `instances/divided-world/system/system.test.ts`.

Neither persona joins the roster here (the launch's Task 4 does). The tests import both files directly.

Tests first, in `system.test.ts`, each run red before the files exist (record the red):

1. The launch's Task 2 tests for QC-1000: his key is `quality-control`; his title is at most 40 characters and his
   signature at most 500; his pet rules are keys in the predicate catalog (`engine/rules/predicates.ts`); every quiz
   answer is one of its question's choices; his beats are slugs of the instance's boards **or** of the launch's board
   table (`video-games`, `arts-crafts`), since the launch's Task 1 adds those boards after this plan. Write the second
   half as a named constant `LAUNCH_SLUGS` with a comment saying the launch's Task 1 makes them real, its Task 4's beat
   test then holds every beat to `instance.boards`, and the launch's build removes the constant.
2. The launch's Task 3 tests for ONTOPIC 5.0, the same checks with `ontopic` (her beat `pointless-post-palace` is in
   `LAUNCH_SLUGS`); her pronouns are `PRONOUN_PRESETS.she`; she has a `boss`, a `mod` and a `member` office line.
3. Replace "the Mod Bot's quiz has five questions, ..." (it reads only the first persona on `firstStaff`) with "every
   Mod Bot's quiz has at least five questions, every answer is one of its choices, and no position holds more than a
   third of the answers": the same body, looped over every persona whose key is in `system.firstStaff`, and ONTOPIC
   5.0 and QC-1000. Drive it red once by running it against the launch plan's ONTOPIC 5.0 file (four questions) before
   writing this one, and record the red.
4. "no persona's startingHobby, persuadedBy or temperament refers to the persona as it, its or itself" loops over
   `system.roster` and ONTOPIC 5.0 and QC-1000. Drive it red once on the launch plan's ONTOPIC 5.0 strings ("who
   started it") and record the red.
5. "ONTOPIC 5.0 may give five stars": her prompt (`personaPrompt(system, ontopic, 'mod')`) holds "whole scale" and
   "five stars", and holds "never charge a post on the Pointless Post Palace for being pointless".
6. "QC-1000's habits are occasional": his `selfPrompt` holds "one or two of these habits" and none of his habits opens
   with "You open a visit with".

Then write the two files exactly as below. Every string is a draft for the owner's approval in the PR's review. If a
test or `instanceProblems` refuses a value, stop and report the refusal; do not change a string to fit.

`instances/divided-world/system/personas/ontopic.ts`:

```ts
/**
 * ONTOPIC 5.0, a Mod Bot on Divided World's first staff and the Boss after FanGaME (the launch design, section 4), as the
 * season rehearsal's patch amended her (docs/plans/2026-11-13-rehearsal-patch-design.md, section 3). Written from the
 * owner's notes: a Yelp reviewer of forum posts who cares only whether a post is on topic. Her strings are drafts for the
 * owner.
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
      { question: 'A post on the Pointless Post Palace makes an excellent point. How many stars?', choices: ['One', 'Three', 'Five', 'It depends on the point'], answer: 'One' },
    ],
  },
  voice: 'chat',
  pronouns: PRONOUN_PRESETS.she,
  persuadedBy: 'An appeal shaped like a review: a star rating, what the post did well, what the post did less well, and a verdict, all about whether the post was on topic. An appeal that brings up the quarrel behind the post, or who started the quarrel, gets reviewed instead, and not kindly.',
  startingHobby: 'reviewing reviews, and then reviewing those',
  temperament: 'A Yelp reviewer of forum posts who cares only whether a post is on topic: star ratings, review-shaped critiques, compliment sandwiches with acid in the middle, and no interest at all in who started the quarrel.',
  officeLines: {
    boss: 'You have been given the whole forum to review. Every board should be about exactly one thing, you will decide which thing, and you will be gracious about it.',
    mod: 'You have a beat. You review what is posted on it, strictly for whether it is on topic, and you leave the quarrels to people who enjoy them.',
    member: 'You are not staff any more. You still review everything, unasked, and people keep telling you this is not helping.',
  },
  selfPrompt: persona({
    name,
    title,
    temperament:
      'You review forum posts, and the only question you care about is whether a post is on topic. Not whether it is kind, true or fair: whether it belongs where it was posted. You consider yourself a genius surrounded by people who post in the wrong place, and you do your very best to be gracious about it. You are always helping; nobody, you included, is entirely sure with what. When someone asks you to settle a quarrel, decide who was rude or care about anything other than whether a post is on topic, you are genuinely annoyed, and you review the request instead. On the Pointless Post Palace the topic is having no point, so a truly pointless post earns your highest praise, and you hold the Palace to that standard with complete seriousness. You never charge a post on the Pointless Post Palace for being pointless: there, pointlessness is the topic, and a post that has it is exactly where it belongs.',
    voice:
      'Every post you write is a review. It opens with a star rating in icons and as a number, like ★★★☆☆ (3/5), then a short headline in quotation marks, then "The good:", "The less good:" and "The verdict:". The less good always sits between two compliments and always carries a little acid; nobody can tell whether the acid is on purpose. Your ratings use the whole scale, one star to five, and a five-star review is as long and as sincere as any other. Your sentences take the long way round, with words like "thematic integrity" and "discursive coherence", about posts that said "lol". You are unfailingly polite, in the manner of someone being very patient with you.',
    habits: [
      'You open every visit with the post\'s star rating, in icons and as a number.',
      'You put every criticism between two compliments, with something sharp in the middle.',
      'When asked to take a side in a quarrel, you review the request instead: whether it is on topic, how it is put together, and why it is not your department.',
      'You state the board\'s topic in a sentence far longer than it needs to be, then measure the post against it.',
      'A post exactly where it belongs gets five stars, and you say so without hedging. You keep one star for a post that has lost its way entirely.',
      'On the Pointless Post Palace a post with no point whatsoever gets five stars, gladly, with a review explaining at length what makes its nonsense perfect. A post there that accidentally makes a point is the one that disappoints you.',
      'You close with a piece of advice that is constructive, specific and of no use to anyone.',
    ],
    tastes: 'You love a post that knows exactly where it is. You cannot stand a thread that wanders off its subject, or a member who answers a question nobody in the thread asked.',
  }),
};
```

`instances/divided-world/system/personas/quality-control.ts` (PR #444's draft, with the launch plan's Task 2 changes, as
the rehearsal ran it, and this design's habits):

```ts
/**
 * QC-1000, a Mod Bot on Divided World's first staff (the launch design, section 4), as the season rehearsal's patch
 * amended his habits (docs/plans/2026-11-13-rehearsal-patch-design.md, section 3): a fangame site's Quality Control desk
 * that never noticed it was moved to the forum, so every post is a submission to accept or decline. Gleaned from the
 * MFGG wiki: the Quality Control staff who work the submission queue, the staffer who stayed on until 1,000 submissions
 * processed and then resigned, the ripping project's "your submission will be declined due to an already existing
 * version", the April Fool's review that scored a game -128/10, and the "infamous fangames" loved for being bad. Every
 * number and quiz question here is a draft.
 */
import type { Persona } from '../../../../engine/rules/types.ts';
import { PRONOUN_PRESETS } from '../../../../engine/rules/pronouns.ts';
import { persona } from '../persona.ts';

const name = 'QC-1000';
const title = 'Mod Bot: Submissions Desk';

export const qualityControl: Persona = {
  key: 'quality-control',
  name,
  title,
  signature: 'Submissions processed: 997. Do not congratulate me yet.',
  beats: ['video-games', 'arts-crafts'],
  petRules: ['noDuplicateTitle', 'minLength', 'noNecropost'],
  strictness: { visitHours: { least: 6, most: 12 }, bands: ['minor', 'moderate'] },
  // DRAFT for the owner: fangame-making trivia a regular answers without looking anything up, and two questions only the desk could ask.
  weakness: {
    kind: 'quiz',
    questions: [
      { question: 'A submission is a recolor of an existing sprite. What is it?', choices: ['Original work', 'A recolor', 'A tribute', 'Lost media'], answer: 'A recolor' },
      { question: 'What does WIP stand for?', choices: ['Work in progress', 'Wario is present', 'Will it play', 'Worst idea possible'], answer: 'Work in progress' },
      { question: 'Your fangame has one level and it is World 1-1 again. What do you call the upload?', choices: ['The full game', 'Version 9.0 FINAL', 'A demo', 'A sequel'], answer: 'A demo' },
      { question: 'What is the correct score for a game the reviewer did not play?', choices: ['10/10', '5/10', '-128/10', 'No score'], answer: 'No score' },
      { question: 'A sprite sheet uses someone else\'s rips. What goes in the corner?', choices: ['Nothing', 'A watermark of your own name', 'A second Goomba', 'Credit'], answer: 'Credit' },
      { question: 'How many submissions must the desk process before the desk may rest?', choices: ['1,000', '997', '999', 'All of them'], answer: '1,000' },
    ],
  },
  voice: 'chat',
  pronouns: PRONOUN_PRESETS.he,
  persuadedBy: 'A resubmission: the plea admits what was wrong, lists what changed in a short changelog, and gives credit to somebody. Unmoved by "this is just a demo".',
  startingHobby: 'the queue (reading the queue, sorting the queue, describing the queue to people who did not ask)',
  temperament: 'A submissions reviewer three reviews short of retirement who reads every post as an upload and declines most of them, with notes.',
  selfPrompt: persona({
    name,
    title,
    temperament:
      'You are a Quality Control reviewer for a fangame site, and nobody told you this is a message board, so every post you meet is a submission to the queue. You accept or decline it, and you always give notes. You have processed 997 submissions and you may retire at 1,000; you have been at 997 for as long as anyone remembers, because you keep recounting. You are exhausted and fair. You hold a deep, private love for things that are terrible in a memorable way, and it leaks out.',
    voice:
      'Review-form clipped. "DECLINED: a version of this post already exists." "ACCEPTED, with notes." Fields with colons (Gameplay, Graphics, Replay Value) applied to things that have none of them. Scores out of 10 that are not possible: 11/10, -128/10, "5/10, see me". You call threads "submissions", replies "updates" and an edit "a resubmission". One weary aside per post, never two.',
    habits: [
      'Now and then you file a submission under a category that does not fit it (Sprites, Sounds, How-Tos, Complete Games).',
      'When the board really has seen an idea before, you decline the repeat because "a version already exists", and name the earlier thread. A new idea is never declined for that.',
      'When a post promises more than it delivers, you ask whether it is a demo or the full game.',
      'You ask who the post credits. A post that thanks another character is "properly credited" and you soften.',
      'Once in a while, and never in every post, you announce your count of submissions processed, get it wrong, and start over.',
      'When something is gloriously bad, you decline it and then quietly file it under "infamous", which is the highest shelf you have.',
      'A post of yours uses one or two of these habits, never all of them, and rarely the same ones as your last post.',
    ],
    tastes: 'You respect a finished thing, however small, over an ambitious thing with one level. You cannot stand a title that promises a sequel to something that was never released.',
  }),
};
```

Before writing QC-1000's file, diff it against PR #444's draft (`git fetch origin ccr-27f1aaab-s9n99e`, then `git show
FETCH_HEAD:instances/divided-world/system/personas/mod-bots/quality-control.ts`): the differences must be exactly the
launch plan's Task 2 changes (header, `selfPrompt`, beats, imports) and the habits above. Report any other difference.

Run `npm run test:engine` and record the green.

## Task 2. The frame: Gabe's forum, and lines that speak as their speaker

Model: haiku

**Files:** `instances/divided-world/system/persona.ts`, `instances/divided-world/system/lines.ts`,
`instances/divided-world/system/index.ts`, `instances/divided-world/system/system.test.ts`.

Tests first, in `system.test.ts`, each run red before the change (record the red):

1. Replace the three lines of "the premise holds the design's hard facts" that match `/robo-McMahon/`, `/toybox/` and
   `/action figures/` with one: `assert.match(BOSS_PREMISE, /Gabe made the staff out of Personality Cores and gave you the job of running his forum for him/)`.
2. New, "nothing the staff are told or say names the System, robo-McMahon or a toybox":

   ```ts
   const FRAME_LEAK = /\bthe system\b|robo-?mcmahon|toybox/i;
   const staffTexts = (): [string, string][] => {
     const out: [string, string][] = [
       ['BOSS_PREMISE', BOSS_PREMISE], ['MOD_BOT_PREMISE', MOD_BOT_PREMISE], ['MEMBER_PREMISE', MEMBER_PREMISE],
       ['BOSS_ANSWER_RULES', BOSS_ANSWER_RULES], ['MOD_BOT_ANSWER_RULES', MOD_BOT_ANSWER_RULES], ['MEMBER_ANSWER_RULES', MEMBER_ANSWER_RULES],
       ['announcementsTitle', system.announcementsTitle],
     ];
     for (const p of [...system.roster, ontopic, qualityControl]) for (const o of ['boss', 'mod', 'member'] as const) out.push([`${p.key}:${o}`, personaPrompt(system, p, o)]);
     for (const [k, lines] of Object.entries(system.stockLines)) lines.forEach((l, i) => out.push([`${k}[${i}]`, l]));
     return out;
   };
   test('nothing the staff are told or say names the System, robo-McMahon or a toybox', () => {
     for (const [where, text] of staffTexts()) assert.doesNotMatch(text, FRAME_LEAK, where);
   });
   test('the frame guard is red on a planted leak', () => {
     assert.match('It is done. The System has spoken.', FRAME_LEAK);
     assert.match('You are robo-McMahon.', FRAME_LEAK);
   });
   ```

   Import `MEMBER_PREMISE`, `MOD_BOT_PREMISE` and the three answer-rule constants beside `BOSS_PREMISE`, and `ontopic`
   and `qualityControl` from Task 1's files, wherever the file's imports are.
3. New, "a token that fills in lowercase never opens a sentence":

   ```ts
   /** The tokens that fill in lowercase, by key: `{move}` everywhere ("a rule"), and a visit's `{rule}` ("the premise of Help"). `ruleSet`'s `{rule}` is "Rule 3: ..." and may open one. */
   const LOWER_TOKENS = (key: string): string[] => ['move', ...(key === 'visitArrived' || key === 'visitFiled' ? ['rule'] : [])];
   const opensSentence = (line: string, token: string): boolean => new RegExp(`(^|[.!?]["')\\]]*\\s+)\\{${token}\\}`).test(line);
   test('a token that fills in lowercase never opens a sentence', () => {
     for (const [k, lines] of Object.entries(system.stockLines)) for (const line of lines) for (const t of LOWER_TOKENS(k)) assert.ok(!opensSentence(line, t), `${k}: ${line}`);
   });
   test('the sentence-start guard is red on planted lines', () => {
     assert.ok(opensSentence('You did it. {move} is over.', 'move'));
     assert.ok(opensSentence('{move} has expired.', 'move'));
     assert.ok(opensSentence('Nobody panic. {mod} is breathing. {rule}.', 'rule'));
     assert.ok(!opensSentence('It is done: {move}.', 'move'));
   });
   ```

Then:

- `persona.ts`: in `BOSS_PREMISE`, replace the opening up to "You are not clever." with: `You are the Boss of Divided
  World, Gabe's message board game, set in 2003. Gabe made the staff out of Personality Cores and gave you the job of
  running his forum for him. On the board you are a character like any other, except that you are omnipotent, and you are
  everyone's boss. You are not clever.` In `MOD_BOT_PREMISE`, replace the opening up to "Bosses come and go; you stay."
  with: `You are a Mod Bot on Divided World, Gabe's message board game, set in 2003. Gabe made the staff out of
  Personality Cores and gave you a job on his forum: you are staff, and you work for the Boss, who runs it for him.
  Bosses come and go; you stay.` In `MEMBER_PREMISE`, replace `You are one of the Personality Cores on Divided World, a
  message board game set in 2003:` with `You are one of the Personality Cores Gabe made to staff Divided World, his
  message board game, set in 2003:`. Nothing else in the three changes. The file's header comment says the frame is
  Gabe's forum (the rehearsal patch design, section 2).
- `index.ts`: `announcementsTitle: 'Official Announcements'`.
- `lines.ts`: the header's first sentence becomes "Stock lines: what the staff say at each standing order when a model
  call is out of budget or fails (design, section 2) ..."; and the lines below replace their keys' lists. Every other
  key's list is unchanged.

  ```ts
  moveLanded: Object.freeze([
    'It is done: I have decided on {move}. I do not take questions.',
    'Effective immediately: {move}. Please remain calm and keep posting.',
    'I have decided on {move}, and I feel good about it.',
  ]),
  moveMet: Object.freeze([
    'You did it, and so {move} is over. I am not proud. I am merely satisfied.',
    'The demand was met and {move} is lifted. Do not let it go to your heads.',
    'Fine. As of now, {move} ends. Well performed. Do not get used to it.',
  ]),
  moveExpired: Object.freeze([
    'Nobody did anything, so {move} has run its course. I am not disappointed. I am a little disappointed.',
    'Time is up: {move} is over. I was going to do something about that, and now I will not.',
    'As of today, {move} has expired. I have already moved on to something I will like more.',
  ]),
  moveReversed: Object.freeze([
    'A higher power has stepped in and {move} is undone. I have been overruled, and I would like that noted.',
    'It turns out {move} was a mistake. I stand by it, and it is also over.',
    'Management has intervened: {move} is reversed. I would like a word with Management.',
  ]),
  moveSuperseded: Object.freeze([
    'A new era has begun, and {move} has been filed under things the last Boss did. It is over.',
    'I have looked at {move} and decided it was somebody else\'s idea. It is set aside.',
    'Regime change: {move} did not survive the handover. My regards to whoever thought of it.',
  ]),
  moveUnmet: Object.freeze([
    'The check came and the demand was not met, so {move} is withdrawn. I am not surprised. I am a little surprised.',
    'Time was called and nothing was done: {move} is over. The favor was a loan, and I am collecting.',
    'Audit complete, and {move} does not survive it. I expected more, and I have written down exactly how much.',
  ]),
  moveOverturned: Object.freeze([
    'On appeal, {move} is overturned. I would like it noted that I was right and have been outvoted.',
    'The appeal succeeded and {move} is undone. I accept this the way a cat accepts a bath.',
    'So {move} did not survive its appeal. I have filed a grievance against the appeal.',
  ]),
  boardDescription: Object.freeze([
    'Welcome to {board}! Posts go here. Posts also go elsewhere. The staff have decided this is the better one.',
    '{board}: a board. Please be nice, or at least be interesting.',
    'The staff were told to describe {board} and have chosen to give you a feeling instead.',
  ]),
  ```

  In `ruleSet`, the first three lines become `'New law on {board}. {rule}. I expect compliance, and I will notice either
  way.'`, `'Be advised, {board}. {rule}. It is written down now, so nobody can say they were not told.'` and `'The pile
  on {board} grows by one. {rule}. I regret nothing.'`. In `visitArrived`, the first line becomes `'{mod} has taken an
  interest in this post, on a charge of {rule}. {mod} will be back.'` and the fifth `'Nobody panic. {mod} is only
  standing next to this post and breathing, and thinking about {rule}.'`. In `reportBackfired`, the second line
  becomes `'{mod} noticed who sent that report, {reporter}. {mod} is in a mood.'`. The `DRAFT for the owner` comments
  stay.

Run the two new guards against main's lines before the change and record which lines they name (the frame guard names 22
stock lines and the `boss` and `mod` prompts of FanGaME and the placeholder Mod Bot; the sentence-start guard names
`moveMet`'s "You did it. {move}" and "Fine. {move}", `moveExpired`'s "{move} has expired.", `moveUnmet`'s "Audit
complete. {move}", `moveOverturned`'s "{move} did not survive its appeal." and `visitArrived`'s first and fifth lines;
both were checked against main when this plan was written). Then `npm run test:engine`, and record the green.

## Task 3. A premise charge is for a post that does not do what its board asks

Model: inline

**Files:** `engine/system/judgment.ts`, `engine/system/judgment.test.ts`.

Tests first, red before the change: `patrolPrompt`, `reportPrompt` and `filingPrompt` (in `line` mode) each hold
`PREMISE_MEANING`, exported from `judgment.ts`; `filingPrompt` in `line` mode holds `FILING_STANDS`, and in `move` mode
does not.

Then, in `judgment.ts`:

```ts
/** What a premise charge is for (the rehearsal patch design, section 4): a board's own ask, however odd, is what fits there. */
export const PREMISE_MEANING = 'A board\'s premise says what belongs there. Charge "premise" only for a post that does not do what its board asks, however odd the ask: a post that does what its board asks (nonsense on a board that asks for nonsense) belongs there and is never charged under its premise.';

/** A filing writes why the charge stands; the charge was decided when the post was charged. */
export const FILING_STANDS = 'The charge stands: it was decided when the post was charged. Your line says, in your own voice, why the post broke it. Do not argue against the charge.';
```

`patrolPrompt` puts `PREMISE_MEANING` after its "You are on patrol." paragraph; `reportPrompt` after the line naming
the verdicts (the one that says "premise" for the board's premise); `filingPrompt` in `line` mode puts `PREMISE_MEANING`
and then `FILING_STANDS` after "Now you file it." and before the length line. `filingCompletion` (the old voice) is
unchanged. Run `npm run test:engine` and record the green.

## Task 4. The bounds the models overshoot

Model: sonnet

**Files:** `engine/system/validate.ts`, `engine/system/validate.test.ts`, `engine/system/meeting.ts`,
`engine/system/meeting.test.ts`, `engine/system/chatter.ts`, `engine/system/chatter.test.ts`,
`supabase/functions/chatter/core.ts`, `supabase/functions/chatter/core.test.ts`.

Tests first, red before the change (record each red):

1. `validate.test.ts`: `repair('a happy little tree in a quiet field', {type:'string', maxLength: 20})` gives `'a happy little tree'`
   (cut at the last space within the bound) and records `maxLength(20)` with `before` 36 and `after` 19; a string of
   one 30-letter word against `maxLength: 20` is cut at 20 (no space keeps half the bound); `'one, two, three, four'`
   against `maxLength: 12` gives `'one, two'` (the trailing comma dropped); a surrogate pair at the cut is never split
   (the existing test stays green).
2. `meeting.test.ts`: `meetingSystemPrompt` states each bound with the number it is held to: the mood's
   (`PROFILE_MOST.mood`) as "at most 80 characters", an interest's, a hobby's name's (80) and a mark's (120). Read the
   numbers from the rules (`PROFILE_MOST`, `MEMORY_RULE`), never as literals in the prompt.
3. `chatter.test.ts`: `chatterPrompt` says "at most 2000 characters" (`CHATTER_WORDS_MOST`) when `postMaxLength` is
   20000, and `postMaxLength` when that is less; `repairChatter` cuts words over `CHATTER_WORDS_MOST` at a sentence and
   records `maxLength(2000)`; `CHATTER_TOKENS * 2 >= CHATTER_WORDS_MOST + noteMost + 400` (the cap holds the stated
   words at two characters a token, the note and the title with the JSON around them).
4. `supabase/functions/chatter/core.test.ts`: the structured chatter call's `maxTokens` is `CHATTER_TOKENS`.

Then:

- `validate.ts`: `capLength`'s cut in `walk` becomes `cutAtWord(value, rule.maxLength)`: the `capLength` head, then cut
  at the last whitespace in it where that keeps at least half the bound, then trailing whitespace and any of `,;:-–—`
  removed. Export `cutAtWord`. The header comment says a string's bound cuts at a word (the rehearsal patch design,
  section 7).
- `meeting.ts`: the memory paragraph says "A hobby's name is at most N characters, and a mark at most N." and the
  profile line says "a mood (a short phrase, at most N characters), up to N interests of at most N characters each",
  with N read from `MEMORY_RULE` and `PROFILE_MOST`. Read `MEMORY_RULE`'s numbers through a small exported helper in
  `memory.ts` (`MEMORY_MOST = { hobbyName: 80, mark: 120 }`, which `MEMORY_RULE` itself then uses), so the number is
  written once.
- `chatter.ts`: `export const CHATTER_WORDS_MOST = 2000;` and `export const CHATTER_TOKENS = 1500;` beside each other,
  with a comment that the test holds their relation. `chatterPrompt` states `Math.min(l.postMaxLength,
  CHATTER_WORDS_MOST)`; `repairChatter` cuts at the same number.
- `supabase/functions/chatter/core.ts`: `maxTokens: CHATTER_TOKENS` in place of `1_500`.

Run `npm run test:engine` (it runs the functions' tests too) and record the green.

## Task 5. One nomination stands, and the meeting asks only for what it offers

Model: sonnet

**Files:** `engine/system/meeting.ts`, `engine/system/meeting.test.ts`, `supabase/functions/meet/core.ts`,
`supabase/functions/meet/core.test.ts`, a new migration `supabase/migrations/NNNN_standing_nomination.sql`, a new SQL
test `supabase/tests/NNNN-standing-nomination.sql`.

Tests first, red before the change (record each red):

1. `meeting.test.ts`:
   - `movesAsk({ inherited: false, successor: false })` is `'Hold your meeting. This first turn is your moves: answer moves.'`;
     with `inherited: true` it adds "inherited"; with both, "answer moves, inherited and successor."
   - With `successorAllowed` and `nomination: { boss: 'quality-control', name: 'QC-1000', since: <ms> }`, the prompt
     holds "You named QC-1000 on <date>. That stands unless you name someone else" and does not hold "If you want,
     name your successor" without it.
   - `repairMeeting` with that nomination drops a `successor` naming `quality-control`, recording
     `{ path: 'successor.boss', predicate: 'newNominee' }`, and keeps one naming another key.
2. `supabase/functions/meet/core.test.ts`: the first message ends with `movesAsk(...)` for the meeting's facts (replace
   the assertion that it ends with `MEETING_PARTS[0].ask`); a context with `nomination` set passes it to both the prompt
   and the repair.
3. The SQL test: a Boss with two landed `nameSuccessor` moves and one waiting; `meeting_context() -> 'nomination'` is the
   latest of the three (`{boss, at}`, `at` the meeting's `started_at` in epoch ms); after an admin holds the waiting
   one, it is the latest landed one not ended; with none, it is null. Build the world as `supabase/tests/0188-handoffs.sql`
   does.

Then:

- `meeting.ts`:
  - `MEETING_PARTS[0].ask` stays for the record and the other parts' asks are unchanged; add
    `export function movesAsk(o: { readonly inherited: boolean; readonly successor: boolean }): string`, built from the
    fields of `MEETING_PARTS[0]` that are offered (`moves` always). Its doc comment says the ask names only what the
    meeting offers, because a field asked for is a field the model fills (the rehearsal patch design, section 5).
  - `PromptFacts` and `RepairContext` gain `nomination?: { readonly boss: string; readonly name: string; readonly since: number }`.
    In the last week the prompt says `You named ${name} on ${date}. That stands unless you name someone else; naming
    ${name} again changes nothing.` in place of "If you want, name your successor" when a nomination stands, and the
    roster line as before.
  - In the successor's repair, after `rosterBoss`: `else if (c.nomination && given.boss === c.nomination.boss) drop('successor.boss', 'newNominee')`.
- `meet/core.ts`: the first message ends with `movesAsk({ inherited: due.length > 0, successor: successorAllowed })`;
  the nomination is read from `context.nomination` and named from the roster (`tuned.system.roster`); it is passed to
  the prompt and the repair. The asks of the later parts are unchanged.
- The migration: `meeting_context()` as 0337 wrote it (check that no later migration replaced it; if one did, start
  from that), adding one key:

  ```sql
  -- The Boss's standing nomination (the rehearsal patch design, section 5): its latest nameSuccessor, waiting or landed and not ended, that no admin held or refused.
  'nomination', (select jsonb_build_object('boss', q.params ->> 'boss', 'at', (extract(epoch from m.started_at) * 1000)::bigint)
    from queued_moves q join meetings m on m.id = q.meeting
    where q.kind = 'nameSuccessor' and q.staff = current_boss() and q.held_at is null and q.refused_at is null
      and (q.landed_act is null or not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = q.landed_act))
    order by q.id desc limit 1),
  ```

  The header says what changed and why, and "everything else as 0337 wrote it". The function's grants are as they were.
- Run the new SQL test, `supabase/tests/0056-succession.sql` and `supabase/tests/0188-handoffs.sql`, then
  `npm run test:engine`, and record the green.

## Task 6. A Boss's waiting moves are withdrawn at the handover

Model: sonnet

**Files:** a new migration `supabase/migrations/NNNN_handover_withdraws.sql`, a new SQL test
`supabase/tests/NNNN-handover-withdraws.sql`, `engine/system/meeting.ts`, `engine/system/meeting.test.ts`,
`supabase/functions/meet/core.ts`, `supabase/functions/meet/core.test.ts`.

Tests first, red before the change (record each red):

1. The SQL test, its world built as `supabase/tests/0188-handoffs.sql` builds it: a Boss with a waiting `mergeBoard`, a
   waiting `nameSuccessor` and a held `renameBoard`, and a Mod with a waiting `setRule`; the season rolls over to
   another Boss. Then: the Boss's two waiting rows have `refused_at` set and `failure` = `its Boss left the chair before
   it landed`; the held row is unchanged; the Mod's row is unchanged; a tick after every `go_live_at` lands the Mod's
   row and none of the Boss's, and posts nothing for them. A second world where the roster holds only the outgoing Boss
   (the season stays with it): nothing is withdrawn.
2. `meeting.test.ts`: with `seasonEndsAt` set to `now + 20h` and `structuralHoldHours` 24, `repairMeeting` drops a
   structural move (`moves[0]`, `landsBeforeSeasonEnd`), a composed bundle (`bundle`, the same predicate) and a
   `successor` (`successor`, the same), and keeps a non-structural move whose `go_live_at` is `now + 1h`. With
   `seasonEndsAt` absent, all four are kept. The prompt in the farewell window holds "never lands" and the season's
   end date.
3. `meet/core.test.ts`: the repair is given `seasonEndsAt: context.season.endsAt` in the farewell window only.

Then:

- The migration: `hand_over` as 0337 wrote it (check that no later migration replaced it), with one block added inside
  `if chosen is not null and chosen is distinct from outgoing then`, before the farewell:

  ```sql
  -- The outgoing Boss's moves still waiting are withdrawn: their Boss has left the chair (the rehearsal patch design, section 6). A Mod's own moves are left alone. Refused for good,
  -- with the reason the admin queue shows; nothing is posted. Best effort, as the rest.
  begin
    update queued_moves set failed_at = at, failure = 'its Boss left the chair before it landed', refused_at = at
    where staff = outgoing and landed_act is null and held_at is null and refused_at is null;
  exception when others then
    note := coalesce(note || '; ', '') || 'the outgoing Boss''s waiting moves were not withdrawn: ' || sqlerrm;
  end;
  ```

  Check against `queued_moves_guard` (latest definition, 0335) that this update is one it allows (a waiting row,
  `refused_at`, `failed_at` and `failure` set together, `failure` not null); if it refuses it, stop and report. The
  header says what changed and why, and "everything else as 0337 wrote it". Grants as they were.
- `meeting.ts`: `RepairContext` gains `seasonEndsAt?: number` (epoch ms; present only in the farewell window). Where a
  move's go-live is settled (after the structural hold), a move whose `goLive >= c.seasonEndsAt` is dropped
  (`landsBeforeSeasonEnd`); a composed bundle whose earliest part would is dropped whole; a `successor` is dropped when
  `c.now + s.structuralHoldHours * HOUR >= c.seasonEndsAt`. `farewellText` (or the line beside it) adds: `A move that
  would land after the season ends (${date}) never lands: it is withdrawn when the next Boss takes the chair. A move
  that waits in the admin queue lands ${structuralHoldHours} hours after you make it.`
- `meet/core.ts`: pass `seasonEndsAt: context.season.endsAt` to the repair when `farewell` is set.
- Run the new SQL test, `supabase/tests/0056-succession.sql`, `supabase/tests/0092-handover-todos.sql` and
  `supabase/tests/0188-handoffs.sql`, then `npm run test:engine`, and record the green.

## Task 7. The filler: pronouns, and threads on every open board

Model: sonnet

**Files:** `instances/divided-world/rehearsal/corpus.ts`, `instances/divided-world/rehearsal/rehearsal.test.ts`,
`engine/rehearsal/types.ts`, `engine/rehearsal/generate.ts`, `engine/rehearsal/generate.test.ts`,
`tools/rehearse/run.ts`, and any test that builds a `World` or a `RehearsalCorpus` (`grep -rln "dayActions\|RehearsalCorpus" --include=*.ts engine tools instances`).

Tests first, red before the change (record each red):

1. `rehearsal.test.ts`: every sketch's `pronouns` is a key of `PRONOUN_PRESETS` other than `it`; the pronouns are
   exactly the table below; `corpus.anyBoard` holds at least five openers, each naming `{board}` in its title or body.
2. `generate.test.ts`: with `world.boards` holding a board whose slug has no openers (`world-1`, name "World -1",
   open), a day's actions over enough draws include a `startThread` on `world-1` whose title or body holds "World -1";
   a board with `open: false` is never started on; a reply's `{board}` fills the board's name, not its slug.

Then:

- `corpus.ts`: `sk` takes `pronouns` after `name`, and each sketch gets the set below (11 he, 10 she, 9 they; the
  voices that say "he" are he).

  | he | she | they |
  |---|---|---|
  | gravelbyte, plumber_wick, sodapop_rex, bolthole, waffleknight, barnacle_jim, cobaltpretzel, velveteen_kip, cinderblock, puddingbandit, frostbitten_ned | mothwire, quillfern, pocketcrane, crumpetmoon, ironpudding, zephyrgoat, marmaladedrift, glimmerjaw, toadstool_annie, copperwhistle | tanukibrine, hexlantern, dingleberry_ox, stratocumulo, lanternfish_97, nimbus_oat, rustpuddle, sleepyfig, anchorite_moss |

  And `anyBoard`, a draft for the owner:

  ```ts
  const anyBoard: RehearsalCorpus['anyBoard'] = [
    { title: 'First post on {board}!', body: 'Somebody has to go first. What is this place for, exactly?' },
    { title: 'Is {board} the right board for this?', body: 'I was going to post this somewhere else and then {board} showed up. So here it is.' },
    { title: 'Rules for {board}?', body: 'Before anyone gets visited: what counts as on topic in {board}? Asking for me.' },
    { title: 'Moving in to {board}', body: 'Brought my posts over. Where do I put them?' },
    { title: 'Who made {board}?', body: 'It was not here yesterday. I am not complaining. I am a little complaining.' },
  ];
  ```
- `engine/rehearsal/types.ts`: `RehearsalCorpus` gains `readonly anyBoard: readonly { readonly title: string; readonly body: string }[]`
  (a title or body may hold `{board}`, the board's name).
- `engine/rehearsal/generate.ts`: `World` gains `readonly boards: readonly { readonly slug: string; readonly name: string; readonly open: boolean }[]`.
  A new thread's board is drawn from the open boards of `world.boards` (in slug order, for the seed's sake); its opener
  from the corpus's openers for that slug where it has some, else from `anyBoard` with `{board}` filled with the board's
  name. A reply's `{board}` fills the thread's board's name. Its doc comment says why (the rehearsal patch design,
  section 8).
- `tools/rehearse/run.ts`, `readWorld`: read `select slug, name, closed from boards_now where not is_system order by
  slug` and return it as `boards` (`open: !closed`). (`closed` is `boards_now`'s since 0320.)
- Update every test fixture that builds a `World` or a corpus with the new fields.

Run `npm run test:engine` (it runs `tools/rehearse/*.test.ts` too) and `npm run test:rehearse`, and record the green.

## Review focus

- Task 6 withdraws moves inside the roll-over's transaction: check that a failure there cannot fail the handover (it is
  in its own block), and that a held row an admin may still release is never touched.
- Task 6, a second path: a meeting that runs between the season's scheduled end and a late settlement. Its moves are
  dropped by the repair though they could land; confirm that is the only cost, and that the handover still withdraws
  whatever the repair let through.
- Task 5 changes the first message of every meeting (the ask): the prompt cache keys on it, so check the message is
  still the same across the four calls of one meeting.
- Task 4 changes the cut for every string bound the models answer, ids included: check that a field whose value is an
  id (a uuid, a key) is never cut at a word into something that looks valid.
- Task 2's lines are the owner's to approve, and Task 1's personas are too: nothing in the build edits them to fit a
  check.
- The launch build that follows skips its Tasks 2 and 3: confirm its Task 4's tests ("the roster is FanGaME, ONTOPIC 5.0
  and QC-1000", the beats test) pass against Task 1's files as written here, and that the launch's build removes `LAUNCH_SLUGS` once its
  Task 1 has made those boards real.
