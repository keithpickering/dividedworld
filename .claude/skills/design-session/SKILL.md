---
name: design-session
description: Use when the owner starts a session to design something with them (a feature, a slice of the game, a change to a rule) and the session should end in a committed design and plan, not code
---

# Design session

A design session designs one thing with the owner and ends in a committed design and plan under `docs/plans/`, which a
build session (`.claude/skills/build-session/SKILL.md`) carries out from the plan file alone. It writes no product code.
Carried from currents' "design session's instruction", which lives in its cockpit skill.

**Background:** CLAUDE.md, whole, and the designs under `docs/plans/` the subject touches. The repository's first
design is `docs/plans/2026-10-28-kit-step-1-design.md`; its section 8 lists questions the spec review left for the
sessions ahead, and a session that takes up one of those areas starts from them.

## How it plans

- **The form the change should keep.** The game is pre-alpha with no players, so no deadline, hotfix or count of
  today's players scopes a design down (CLAUDE.md, "Nobody is waiting on a hotfix"). Nothing is framed as urgent.
- **Socratically.** One question at a time, each with two or three alternatives and a recommendation. The design is
  confirmed with the owner in sections before the plan is written. A mockup where the question is visual. Scope drift
  is named as soon as it appears. "I don't know" is an answer: it is recorded in the design as open, and the session
  moves past it.
- **Inside the rules.** Where a rule followed to the letter would make the game worse, the session asks the owner
  (CLAUDE.md, "A rule that fights the product is asked about") rather than design around it.
- **Read the code first.** Before the plan is final it reads the code each task touches and names the files and
  functions, so a gap shows in planning and not in the build.
- **Ways out.** The plan names the way out of every state it adds that a player, a character or a post can be put in
  (CLAUDE.md, "No player is ever stuck").
- **The masks.** The plan names every response, payload, Realtime event and timing it adds that could be computed from a
  private fact, and how it is not (CLAUDE.md, "A response never proves a private fact").
- **The layers.** The plan says, for each part, whether it is engine or instance, and which interface carries an
  instance's content into the engine (CLAUDE.md, "KayfaBB never knows which instance it runs").
- **Screens.** A plan that adds a screen or a flow first says which world it is in
  (`docs/plans/2026-10-29-two-worlds-design.md`): the board, the arena, in the house style (a 2003 BBCode message
  board: Verdana and Courier, black and white, color only on the game's own pieces), or the glass, the game's own
  interface (the smoky neon look of the boards in `docs/research/2026-10-29-two-worlds/`, plain and never in
  character, with text by the game rules of that design's section 4). It designs the screen with the owner in that
  world's look. Once impeccable is installed, its `shape` step runs with the owner, briefed on that look, and the
  confirmed brief goes into the plan.

## What it writes

A design (what was decided, each alternative weighed, and what is open) and a plan (tasks in order, each with its files
and functions, the tests to write first, and the poisons for any check it adds), committed under `docs/plans/` with
a name `YYYY-MM-DD-<slug>.md` and opening `Record, written YYYY-MM-DD.` The plan's last section is `## Review focus`:
one line for each risk the design can name but its tests cannot settle before the code exists (what the change does
to Acts an instance already holds, a cost that grows with a busy instance, a path a second run, a retry or another
player could take, a way a mask could slip), for the final reviewer's charter in the build-session skill.

Its PR is the design and plan alone. The owner merges it, then starts a build session on the plan.
