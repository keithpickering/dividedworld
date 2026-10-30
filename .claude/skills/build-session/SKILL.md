---
name: build-session
description: Use when a session is started to carry out a written plan, builds it, reviews it, opens the PR, or answers that PR's review rounds
---

# Build session

## Overview

A build session starts fresh from one plan file, so it never re-reads the design conversation. It builds, tests,
reviews, opens the PR and owns it while it lives: review rounds and CI are its own work. The owner merges.

**Background:** CLAUDE.md, whole. The plan is carried out task by task, in its order, by you or by implementer
subagents (see "Working"). Each step goes test first: the failing test and its red run, then the code that makes it
pass. A claim of done, for a task, a check or the PR, is shown with the output of the command that proves it, never
asserted. A bug or a red run gets its root cause found before a fix. These are the practices CLAUDE.md's "How a task
starts here" lists; a build reads no process skill for them.

**Not for:** designing or merging. Designing is a design session's (`.claude/skills/design-session/SKILL.md`); merging
is the owner's. Carried from currents' build-session skill with its cockpit, merger, light lane and UI gate left behind
(`docs/plans/port-manifest.md`).

## Reading

Read the plan, its design, and CLAUDE.md before starting, then the slice of each file you need. Touch only the plan's
files. Where the plan is wrong, stop and ask the owner rather than investigate around it. A gap found while building
(a file or function the plan missed, a task that cannot be done as written) is also listed in the PR under `Plan gaps`,
with the task it touched, so that gaps can be counted.

## Working

- An implementer subagent's prompt holds the task's text from the plan, the files and functions it names, what the
  task depends on, the tests to write first, and what to report back (what changed, the red and green runs, any plan
  gap).
- Models: the main loop is Sonnet; implementer subagents Sonnet, or Haiku where the plan holds the code; task
  reviewers and a fix round's re-review Sonnet; the final branch review Opus, on the head the PR ends on.
- During tasks, run only the tests for the code changed. Run the full build (`npm run build`) once after all tasks and
  before the PR, again on any head after the final review, and otherwise only when CI disagrees.
- Push to the designated branch after every task's commit, so a container restart loses only the task in progress.
- Never merge, and touch no deployed database, bucket or connector.

## Review, inside this session

1. Per task: a spec reviewer (does the code do what the plan's task says, no less and no more?) and a quality reviewer
   (is it correct, tested, and written like the code around it?). Each is a subagent, never the task's implementer,
   with a prompt you write for that task: the task's text, the diff, and what to report. The spec review passes
   before the quality review starts; each finding is fixed and that reviewer reads again until it reports none, for
   at most 3 re-reads; after the third, tell the owner what is still open.
2. Poisons: for each check, apply the defect it exists to catch, record the red run in the PR, then make it pass.
3. One final review of the whole branch by a fresh subagent on Opus, never the builder. It starts once the PR is ready
   and CI is green on the head it will read, so a CI fix never buys a second review. Its brief is the PR number, the
   head SHA and "The final review's charter" below, which it reads itself; it carries no account of the build. Its
   record names the head SHA it read and is in the PR with no open blocking finding, as one line
   `Final review read: <40-hex SHA>`. Before it, the PR lists every open design question, numbered, under
   `Design questions`; the reviewer answers none of them, and each goes to the owner.
4. The final review is the last thing to read the branch. Any commit after it means a fresh Opus final review of the
   new head and a full build on it. That review reads a fix's diff against every row of the charter it touches, not
   only the finding it fixed: a fix is new code.
5. A final review with no blocking finding ends the build: write its `Final review read:` line and the PR is done.
   Its non-blocking findings, and any earlier review's still unbuilt, are filed as follow-ups (below), never fixed in
   this PR, because each fix buys another final review and the PR never lands. Only a blocking finding is fixed here,
   tests first, followed by one more final review of the new head.

**The final review's charter.** By the final review, the per-task reviewers have held each task to the plan and the
plan's tests have their red runs. The final review is for what neither of those proves. It covers these five, in
order:
1. **The red runs show what they claim.** It reads each recorded red run and asks two things: did the test fail on its
   assertion, not on a missing module, function or fixture; and does it assert the effect a player or a caller sees,
   not that a line of source is present. Where a red run does not show that, or a test has no recorded red run, break
   that code in a scratch copy and run the suite; a test that stays green is a finding ("A guard that has never been
   red is not known to work").
2. **What is already there.** What the change does to the Acts, characters, boards and jobs an instance already holds
   when it ships, and on a re-run, a retry or two runs at once. Every state a player can reach this way has its way out
   ("No player is ever stuck").
3. **What the diff triggers.** For each line of this table the diff matches, the rule it brings. A line gains a check
   when one is written and driven red.

   | The diff adds | The rule | Its check |
   |---|---|---|
   | a security definer function | it pins `search_path`, ending in `pg_temp` | |
   | a table | row-level security, and the instance export round-trips it ("Portable by construction") | |
   | a response, payload, Realtime event, presence update or delay | computed from no private fact: not who owns a character, its class, who reacted, or whether an address has an account ("A response never proves a private fact") | |
   | a write to an Act | a new Act beside the old, never an `UPDATE` ("Append-only") | |
   | a way to destroy, hide or overwrite a post | the original survives and can come back ("The System acts; it never destroys what a player wrote") | |
   | a state a player, character or post can be put in | its way out ("No player is ever stuck") | |
   | an import between the engine and an instance | the engine never imports an instance ("KayfaBB never knows which instance it runs") | |
   | a game rule | decided on the server; the client only previews | |
   | a model call | a ledger row priced from the usage block ("Cost is a column, not a report"); its outcome is a choice the code defines | |
   | work done per player, character, thread, Act, reaction or viewer | its cost at a busy instance's scale ("Weigh a design at the scale of a busy instance") | |
   | a fallback, rescue or retry | it retries transport failures only ("Three unrelated timeouts are not a poison pill") | |
   | a validator on a model's output | it trims a bound overshot and rejects only what cannot be repaired ("A validator tighter than the schema") | |
   | a card or game effect meant to be tough to get through | its accessible path costs about what the effect costs; the forum around it meets the usual standards ("An accessible path costs what the obstacle costs") | |
   | words a player reads | in character they may bluff; in the player's own log and out of character they are true and plain ("The fiction may lie; the log never does") | |
4. **Across tasks.** Where one task's code calls or relies on another's, each holds to what the other assumes; each
   per-task reviewer read one task.
5. **The plan's `Review focus`.** Each line of it, where the plan has one.

The record opens with a coverage table: one row per item, per table line the diff matched and per `Review focus` line,
each saying what was read or run and its result, `clean` or the ids of its findings. `clean` is a complete answer: a
row with nothing found is never filled with a lesser finding. Findings outside the charter follow under
`Outside the charter`. What blocks: a security hole, a mask that slips (a private fact readable by anyone it is hidden
from), a player's words destroyed, a player left with no way out, and a cost that grows wrongly with a busy instance.
A finding that a check could have caught, of a kind a review has made before, is also proposed in the record as a
check with its poison.

**The round cap.** After two review rounds, a finding that is a question about behavior, not a defect, stops the loop.
Do not build round 3; put the question to the owner, and build the next round only after the answer.

## The PR

Open the PR **as a draft on your first push**, so the work is on GitHub from the start, and fill the description in as
the build goes. **Mark it ready before the final review**, once the full local `npm run build` is green and the
description holds everything but the final review, so CI runs on the head the review will read. Fix a red run before
the review starts. Wait on CI with a background until-loop, never a foreground `sleep`.

The description opens with `**Owner:** the build session.`, then a line `Session: session_…` (your own id), and
records: each poison with its red run, one item per poison with the red run's output; the final review with the head
SHA it read, as the `Final review read:` line; `Design questions`, each with the owner's answer or its issue; and
`Plan gaps`. It lists a `Closes #N` line for every issue the PR settles. A non-blocking finding becomes a line under a
`Follow-ups` checklist on the plan's issue, or a new issue where there is none; a dead end and a question for the owner
always get their own issue.

The final report is the PR description, not a message: the head SHA, the red runs, the poisons, and what differed from
the plan stay there, where the owner reads them.
