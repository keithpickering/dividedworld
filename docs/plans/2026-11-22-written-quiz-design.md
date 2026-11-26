Record, written 2026-11-22.

# A Mod writes its quiz question for each visit: design

A design session with the owner. Its plan is `docs/plans/2026-11-22-written-quiz-plan.md`. It follows a question the
owner asked on 2026-11-21: whether the quiz part of a visit is superfluous beside appeals, since a fixed bank can be
memorized while an appeal is different every time. The answer was to keep interception (it is the visit's only live,
communal, in-thread way out, and the only free one) and make its question impossible to memorize.

## 1. What happens today

A quiz Mod's visit draws one question when it starts (`visit_challenge`, `0105_visits.sql`): an index into the
persona's bank, by a hash of the post's id, stored in the visit Act as `challenge.question_index`. The bank is the
persona file's `weakness.questions` (for example `instances/divided-world/system/personas/ontopic.ts`), seeded into
`staff_quiz_questions`, which no client reads. The page reads the question and its choices through `visit_quiz(visit)`
(latest `0368_client_reads_plan_once.sql`), and `intercept` (`0108_interception.sql`) checks an answer against the
bank. One try per character per visit; a wrong answer starts a tail, and the character's next post draws a visit for
Obstruction.

A bank of five four-choice questions per persona is learned in a week, and after that the quiz is a free button that
ends the visit. A reseed that changes a bank also changes the question an open visit's index points at.

## 2. Decided: a question written for each visit, in the Mod's voice

Each quiz visit gets its own question, written by a light-tier (Haiku) call in the Mod's voice, about the visited post
and the rule it was charged under. The persona's bank stays, as the free fallback.

**When it is written** (the owner chose):

- **Pending, then the bank as a fallback (chosen).** The visit opens with its quiz pending, and every reader sees the
  same note that the Mod is writing a question. The next staff run (every 5 minutes) writes it. If none has been written
  by `modBots.quizWriteMinutes` (15) after the visit opened, or the call fails or is rejected, or the day's budget is
  spent, the bank's question is used. Nobody sees one question replaced by another, and a visit lasts hours, so a few
  minutes' wait costs little.
- **The bank first, then swapped.** Available at once, but a question someone has read can change under them.
- **The bank for the first readers, the model's for the rest.** Two questions on one visit, which is unfair in a way
  that isn't the fun kind.

**What it is about** (the owner chose):

- **The post and its charge, in persona (chosen).** The Mod quizzes readers about the visited post, its thread and the
  rule it broke, by its own warped standard: ONTOPIC 5.0 grades topicality, QC-1000 grades craft. Reading the post
  gives a fair shot, but the right answer is the Mod's opinion, so it can be unreasonable. That is the same fun as an
  appeal to an unreasonable judge, and it cannot be memorized.
- **The Mod's own lore, freshly written.** It rewards regulars who know the persona, but it doesn't change with the
  post.
- **A mix the Mod chooses.** More varied, but harder to make consistent or to test.

**What bounds the cost** (the owner chose):

- **A daily cap of its own, then the bank (chosen).** `modBots.quizQuestionsPerDay` (60), counted from the ledger like
  `filingLinesPerDay`. Past it, a quiz visit takes the bank's question at once. Each call is a ledger row under a new
  duty, `quizQuestion` ("Cost is a column, not a report").
- **Sharing the filing lines' budget.** Fewer settings, but a busy day of quizzes would leave the Mods without filing
  lines.
- **No cap beyond the visits.** Visits come from rules broken at post time, reports and patrols, so nothing would stop
  a flood of rule-breaking posts from becoming a flood of calls.

## 3. How it works

**One question per visit, kept with the visit.** A new table, `visit_quizzes`, holds one row per quiz visit: the
visit, its source (`model` or `bank`), the question, the choices and the answer, written once and never changed. No
client reads it. `visit_quiz()` hands a page the question and choices, never the answer. A quiz visit with no row is
**pending**: `visit_quiz()` answers `{pending: true}`, and `intercept` refuses with "the question is still being
written; try again in a few minutes", in the same words for everyone.

**The way out of pending.** The tick writes the bank question (the same hash draw as today) into the row for any quiz
visit still pending `quizWriteMinutes` after it opened, whatever the switch says, so no visit waits longer. A bank
question is snapshotted into the row too, so a later reseed of the bank cannot change a question already shown.

**The call.** Each staff run picks up the pending quiz visits, oldest first, and makes one chat call each, on the light
tier, in the Mod's voice (`selfPrompt`), under the duty `quizQuestion`. The model reads only what is public:

- the post **as it is shown now**: a redaction, a splat or an autocorrect stays as readers see it, so a question can
  never quote words a card has hidden;
- the author **as shown**, so a veil holds;
- the thread's title and the charge's rule;
- the persona's optional `weakness.quizBrief` (the instance's own steer, such as "ask whether it is on topic"), else its
  tastes.

It returns a fixed shape: a question, two to four choices, and which choice is right. The checks follow "A validator
tighter than the schema is a place a paid answer goes to die":

- **Trimmed:** an over-long question or choice is cut to its bound; a fifth or later choice is dropped, as long as the
  answer survives; duplicate choices are merged.
- **Rejected:** an answer that is not among the choices, or fewer than two distinct choices left after the trims. The
  bank's question is used instead.
- Every trim and every rejection, with the predicate that failed, is written on the call's record.

**What does not change.** One try per character per visit; a wrong answer's tail; the bribe and distraction Mods; the
banks, kept as the fallback; an admin's reversal of a visit.

## 4. Layers, masks, ways out, scale

- **Layers.** The engine holds the duty, its frame, the table, the reads, the settings and their checks. An instance
  supplies each quiz persona's `quizBrief` (optional) and its bank. Divided World's briefs are drafts for the owner to
  approve in review.
- **Masks.** The call reads only what every reader can see. The pending note, the question and the choices are the same
  for every reader; when the question arrives depends on the staff run's clock and the visit's age, never on who owns
  anything. The answer is checked in SQL and never sent to a page.
- **Ways out.** The new state is a pending quiz. It ends by itself within `quizWriteMinutes` (the tick's fallback), and
  the visit's own ways out (its end time, a bribe or a distraction where the Mod takes one, a trap, an admin's reversal)
  all still apply while it is pending.
- **Scale.** At most `quizQuestionsPerDay` calls a day for the whole instance, one row per quiz visit, and the staff run
  and the tick read only the pending visits, by an index on the visits that have no row yet.

## 5. Open

- The tail after a wrong answer was built for a bank question a reader could know. Against an opinionated question it
  will land more often. The owner kept it; whether it feels fair is for play to show.
