# A commit after the final review gets a delta review: design

Record, written 2026-11-03 by a session examining token usage with the owner, from main at f795fe2. Once written it is
left as it reads. The change is one step of `.claude/skills/build-session/SKILL.md`, made in the same PR, so there is no
separate plan.

## Why

Review step 4 asked for a fresh Opus review of the whole branch after any commit, even one that fixed a single
finding of the final review. A fix round therefore paid for a full read of the branch by a reviewer that starts at
tens of thousands of tokens before it reads the PR, and a PR whose fixes each needed fixing paid for that several
times over. In currents, where this skill was first built, the owner's session-cost ledger showed Opus reviews at about
a third of a build session's cost, most of it in these re-reviews; currents made the same change on 2026-11-03. The
owner asked for it here: "Let's port it to dividedworld too" (Keith, 2026-11-03).

## The design

1. One full Opus final review per PR, as now, with its charter and coverage table.
2. Every head after it, a fix or a merge of main, gets a **delta review**: a fresh Opus subagent whose brief is the PR
   number, the reviewed SHA, the new SHA and a link to the review it extends. It reads each commit since the reviewed
   head, each merge's remerge diff, the change in the PR's own diff between the two heads, the code each change
   touches, and the earlier review's findings. It checks that each blocking finding is fixed, reads the change against
   every charter row it touches, and breaks fix code that has no red run of its own (charter item 1). It does not
   review the rest of the branch.
3. Where the change reaches past what the full review covered (a new task, table, migration or job, or a rule changed
   rather than a defect fixed), the delta reviewer says so with its reason and asks for a full review.
4. Its record names both SHAs and links the review it extends; `Final review read:` moves to the new head once no
   blocking finding is open. The full build on the new head is unchanged.
5. The reviewer is fresh, never the earlier one resumed: a subagent's cache lives five minutes and a fix round takes
   longer, so a resumed reviewer would write its whole context again.

CLAUDE.md's merging permission asks only that a PR's review findings are answered, so no rule changes.

## Measuring

The owner's weekly limit is shared with currents, which measures Opus spend per merged build PR from its own ledger.
Here, each PR's record already names every final review it ran; the number of Opus reviews per PR before and after is
the measure, and so is any blocking defect found on main afterwards in code only a delta review read.
