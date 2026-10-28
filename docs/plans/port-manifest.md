# Port manifest

Record, written 2026-10-28. What is copied into this repository from currents (`keithpickering/currents`), from
where, and what changes on the way. The porting session works from the `currents-kit` snapshot in
`keithpickering/claude-skills`, synced to currents at f6aa96d, and attaches currents read-only. Its name appears in
this file, in the rule records and in header comments that say where a file came from, and nowhere else.

The rule for every file: copy it, strip the origin's literals, keep the header comment's reasoning, and bring the test
that sat next to it. Each check is run red once on a poisoned input before it is trusted; the red runs are recorded in
the first PR.

| Area | Copy from (currents paths) | Becomes | Changes on the way |
|---|---|---|---|
| Working rules | `CLAUDE.md` | `CLAUDE.md` | The preamble and the rules the design chose (`docs/plans/2026-10-28-kit-step-1-design.md`, section 7). Nouns: member becomes player, document becomes Act, workspace becomes instance. Five rules rewritten for the game and one added; the owner is "the owner", never a pronoun |
| Rule records | `docs/working-rules/` | `docs/working-rules/` | A carried rule's record points back to currents' and does not retell its incident. A rewritten or new rule's record holds this design session and the owner's words |
| Build runner | `tools/build.mjs`, `tools/test-build-steps.mjs` | The same runner and self-test | `STEPS` holds only the two doc guards. Left behind for now: `DOCS` and `--docs` (with the Docs workflow, at Stage 2), `E2E_RUNS` and the SQL workflow's checks (with the database), the site build's `SERIAL` rule (with a site). The pool and its tests come over whole. `yaml` is no longer needed |
| Doc guards | `tools/check-working-rules.mjs`, `tools/test-working-rules.mjs`, `tools/check-doc-references.mjs`, `tools/test-doc-references.mjs` | The same pairs | The working-rules test's cases name this file's own records and bullets. The doc-references floor is half of this repository's own first count |
| Doc layers | `specs/2026-09-18-doc-layers.md` | `specs/2026-10-28-doc-layers.md` | Dated for this repository; the reasoning is unchanged |
| Session start | `.claude/hooks/session-start.sh`, `.claude/settings.json` | The same hook | The local Postgres half waits for the first migration; the settings keep only the hook (currents' `gh api` permissions and the context-check hook are Stage 2) |
| Session roles | `.claude/skills/build-session/SKILL.md`; "The design session's instruction" in `.claude/skills/cockpit/SKILL.md`; `.claude/skills/README.md` | `build-session`, a small `design-session` skill, and the index | The cockpit, the merger, the light lane, the friction log, the UI critique gate and currents' checks stay behind. The final review's charter keeps its five items; its table starts with the rows this repository's rules hold |
| CI | `.github/workflows/build.yml` | `.github/workflows/build.yml` | Only ready pull requests and a hand dispatch. No release call and no state paths |
| Design skill | `.claude/skills/impeccable/scripts/VERSION` | impeccable, installed from npm at that version | Not copied; installed with currents' `impeccable:update` script when the first screen is designed, and briefed then on the house style |

**Not ported at Stage 1** (each comes with the stage or the code that needs it): `docs/state.md`, the cockpit and its
`reference/`, `tools/merge-ready.mjs` and its libraries, `.github/workflows/merge.yml`, `.github/workflows/docs.yml`
and the `--docs` subset, `tools/check-state-file.mjs`, the context-check hook and handover, `tools/check-branch-fresh.mjs`,
`tools/check-workflow-yaml.mjs`, the plans index, the clerk, the backlog session, batch review and the light lane.

**Never copied:** currents' product: its documents, citations, statutes, readings and watches; its migrations,
functions and source; `adding-an-authority`; its plans and surveys as files; its incidents retold. Rules travel as
method; incidents and subjects do not.
