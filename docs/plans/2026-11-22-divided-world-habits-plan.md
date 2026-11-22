Record, written 2026-11-22.

# Divided World's roster habits: plan

The habits the chattier staff design left open (`docs/plans/2026-11-22-chattier-staff-design.md`, Open), settled with
the owner. It is carried out once the chattier staff build has landed `Persona.habits` on `main`. The owner is on
Pacific time and expects most players on Eastern; hours below are UTC, as the field takes them.

| Persona | File | `perDay` | `minutes` | `hours` (UTC) | US Eastern | Why |
|---|---|---|---|---|---|---|
| FanGaME | `instances/divided-world/system/personas/fangame.ts` | 4 | 15 to 40 | 17, 0, 1, 2, 3, 4 | lunch, then 7pm to midnight | a nervous hobbyist who peeks in at lunch and vanishes into late-night Game Maker sessions; short, jittery visits |
| ONTOPIC 5.0 | `instances/divided-world/system/personas/ontopic.ts` | 5 | 15 to 30 | 14 to 23, 1, 2, 3 | 9am to 7pm, then 8 to 11pm | "always helping": the most frequent visitor, brief drive-by reviews all day |
| QC-1000 | `instances/divided-world/system/personas/quality-control.ts` | 2 | 75 to 150 | 13 to 20 | 8am to 4pm | works the queue in shifts: clocks in, stays long, works through everything, clocks out; never there at night |

The owner: "No problems with these times."

## Task 1. The habits

Model: inline

Add to each persona the `habits` field as the table gives it, with a one-line comment naming this plan and the why.
Test first: a test in `instances/divided-world/system/system.test.ts` that each of the three personas carries exactly
these habits and that the roster's rule accepts them (red before the fields are added). Then `npm run typecheck` and
`npm run build`, with the tail in the PR.

## Review focus

- The hours are UTC: FanGaME's late night is 0 to 4 UTC, not 19 to 23.
