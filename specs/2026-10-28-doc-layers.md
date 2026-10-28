# Document layers: current and record

Date: 2026-10-28, carried from currents' decision of 2026-09-18 with its reasoning unchanged.

Prose in this repository is one of two declared kinds.

- A **current** document is read as true today: `README.md`, `CLAUDE.md` and everything in `specs/`. A path or
  `npm run` script named in a current document must exist, or the sentence must say the thing is gone. The build fails
  otherwise (`tools/check-doc-references.mjs`).
- A **record** is left as written and only reported on: plans under `docs/plans/`, the rule records under
  `docs/working-rules/`, the skills under `.claude/skills/`, and any document that opens by saying what it surveyed or
  the date it was written. A dead path in a record is listed in the build's tail and never gated, because editing a
  record to make a report shorter destroys the one thing it is for: knowing what was true on its date.

A new document is current until it says what it surveyed and when.
