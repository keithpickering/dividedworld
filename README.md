# dividedworld

**Divided World** (dw.gripe) is a kayfabe forum game: a message board where each person plays several masked
characters with hidden classes, everything anyone does is a public Act, and an arbitrary machine, The System, runs the
board. It is built on **KayfaBB**, an open-source engine that lives here until it is first published.

The engine's core loop is built (`docs/plans/2026-10-28-core-loop-engine-plan.md`); no screen is yet. Where things
stand:

- `spec.md`: the MVP specification the owner wrote with Gemini, read as input, not as the plan.
- `docs/plans/2026-10-28-kit-step-1-design.md`: the premise, nouns, stack and method decided from it, and what the spec
  review left for the design sessions ahead.
- `CLAUDE.md`: the working rules every session follows.
- `engine/`: KayfaBB's rules as pure TypeScript (`engine/rules/`: the instance interface, votes, the settlement, the
  actions and cards) and its BBCode parser (`engine/bbcode/`). It never imports an instance.
- `instances/divided-world/`: Divided World's classes, cards, reactions, settings and words, plugged into the engine.
- `supabase/migrations/`: the schema, its policies and its SQL functions, in plain SQL.
- `supabase/functions/`: the Edge Functions (`act`, `account`, `settle`, `seed`), the one place that imports both the
  engine and an instance.
- `npm run build`: the guard chain (`tools/build.mjs`), which CI runs on every ready pull request.
- `npm run test:sql`: the migrations replayed into a scratch database on a local Postgres, with the assertion files and
  end-to-end tests in `supabase/tests/` (`tools/test-sql.mjs`; it refuses any database but localhost).
- `tools/export-instance.mjs` and `tools/import-instance.mjs`: an instance's every table, private ones included, out to
  a directory and back into a fresh instance.
