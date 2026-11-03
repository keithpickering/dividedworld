# The build's main loop orchestrates, and each task names its model: design

Record, written 2026-11-03 by a session examining token usage with the owner, from main at a062846. Once written it is
left as it reads. The change is to `.claude/skills/build-session/SKILL.md` ("Working") and
`.claude/skills/design-session/SKILL.md` ("What it writes"), made in the same PR, so there is no separate plan.

## What was measured

Twelve build sessions from 2026-10-31 to 2026-11-03, all with merged PRs, read with `get_session` and each session's
newest `result` event (`modelUsage`); two traced from their first call.

- The median build cost $33.25 at list prices ($8.30 to $108.79), with a median of 1,478 changed lines outside `.md`
  files: about $1.85 per 100 lines.
- Every main loop ran on Opus 5.5, and the main loop was about 65% of the cost (estimated from the split of cache
  writes; Opus final reviews were about 10%, Sonnet about 25%). Cache reads were 59% of the cost, cache writes 25%,
  output 16%.
- Contexts ended at 227k to 791k tokens (median 544k), with no compaction. Late calls each re-read about half a
  million tokens at Opus's price.
- In 10 of the 12 builds the main loop wrote the code itself, and Sonnet ran only the per-task reviews. Two builds
  used Sonnet implementers; they were the cheapest per line ($0.74 and $0.86 per 100 lines) and also the two largest
  PRs, so size may explain part of it.
- Haiku ran in none of them beyond one call of about a thousand tokens per session, though the skill already allowed
  it "where the plan holds the code": no plan named a task for it.
- A reply to a finished session after more than an hour idle wrote its whole context to the cache again: one "PR
  merged" message cost $6.09, another $3.66.

## Why the main loop stays thin

A session's cost is roughly its model calls times its context times the price, and the main loop is the context that
lives longest and grows most. Work done there (reading files, editing, test output) is re-read on every later call;
work done in a subagent is re-read only inside that subagent and discarded when it reports. Once the main loop holds
only the plan, the briefs and the reports, its model matters much less to the cost, so the owner's choice to start
builds on Opus keeps Opus's judgment through the build (plan gaps, integration, the reviews' findings) without paying
Opus's price for the volume. A subagent is not free: it starts at tens of thousands of tokens before it reads its
task, so a small task stays inline.

The owner asked for this, and for Haiku where a task is "simple, well-scoped and yet voluminous" (Keith, 2026-11-03),
and approved the design ("Yeah let's go ahead and do that", Keith, 2026-11-03).

## The design

1. The main loop orchestrates: it reads the plan, briefs each task's implementer, reads the report, runs the reviews,
   makes the judgment calls and owns the PR. Implementer subagents write the code.
2. Each plan task carries a `Model:` line, chosen by the design session, which knows which tasks are mechanical:
   `haiku`, `sonnet` or `inline`. Untagged tasks (older plans) go to Sonnet, except a few lines in one or two files.
3. Haiku is for tasks whose code or strings the plan holds, or whose work is mechanical and voluminous, reading only
   the files the task names. Its price is a twentieth of Sonnet's while a prompt stays under 100k tokens and a fifth
   above, so its tasks are kept narrow. The task's tests and the per-task Sonnet reviewers catch what it misses.
4. A task an implementer could not finish goes once more to the next model up with the first report, then to the main
   loop. A plan gap is still a stop.
5. Reading that would bring a large file, log or search result into the main loop goes to a subagent that returns what
   is needed, and command output in the main loop is cut to its tail.
6. The skill's model line is corrected to what builds run: the main loop on the model the owner starts it with (Opus).

Not changed: the per-task spec and quality reviewers, the final review and the delta review
(`docs/plans/2026-11-03-delta-review-design.md`), and test first with its red run.

## For the owner, outside the skills

A session whose PR has merged is archived, not answered: a message to it after an hour idle pays to write its whole
context to the cache again.

## Measuring

The next ten build sessions against the twelve above: cost per 100 changed lines, the main loop's share of the cost,
context at the end, and the number of tasks that went to each model. Quality is read from the final reviews: blocking
findings per PR, and tasks sent up a model after a first attempt.
