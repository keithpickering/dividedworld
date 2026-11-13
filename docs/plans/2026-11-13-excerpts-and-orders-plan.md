# Cut excerpts and an order that outlives its office: the plan

Record, written 2026-11-13. The design is `docs/plans/2026-11-13-excerpts-and-orders-design.md`. Migration and SQL
test numbers are placeholders (`NNNN`, `TTTT`): the merging session gives the real ones last.

## Task 1. One excerpt function

Model: sonnet

**Files:** a new `engine/system/excerpt.ts` and `engine/system/excerpt.test.ts`; `engine/system/chatter.ts`,
`engine/system/judgment.ts`, `engine/system/digest.ts`, `engine/system/apology.ts` and their tests.

Tests first, in `excerpt.test.ts`, red before the file exists:

- a text at or under `most`, with `cut` false, comes back on one line and unchanged;
- a text over `most` is cut at a word (`cutAtWord`) and ends in "…", and is never longer than `most + 1`;
- a text under `most` with `cut` true ends in "…", cut back to its last whole word where that keeps at least half of it
  ("I made Plumber Platfo" becomes "I made Plumber…");
- `EXCERPT_WORDS` is exactly "An excerpt that ends in … was shortened by the game for space; its author wrote more."

Then, red before the change in each module's test: a post body over the excerpt bound ends in "…" in the chatter
prompt, the Mod duty prompt (patrol sample, report, appeal), the apology prompt and `renderDigest`'s excerpts; and each of
those prompts holds `EXCERPT_WORDS` once, and only when it shows an excerpt. Names and titles keep their current cut.

Then: write `excerpt(text: string, most: number, cut = false): string` and `EXCERPT_WORDS`; replace the post-text uses
of the four `clip`s with it; add the sentence beside the excerpts in each prompt.

## Task 2. The sources say when they cut, and orders end with the office

Model: sonnet

**Files:** a new migration `supabase/migrations/NNNN_excerpts_and_orders.sql`, a new SQL test
`supabase/tests/TTTT-excerpts-and-orders.sql`; `supabase/functions/chatter/core.ts`, `supabase/functions/staff/report.ts`,
`supabase/functions/staff/appeal.ts`, `supabase/functions/meet/core.ts` where they pass `pool_thread`'s or the digest's
posts on; the engine's `ThreadPost` (`engine/system/chatter.ts`) and the digest's excerpt type (`engine/system/digest.ts`).

Tests first, in the SQL test, red before the migration:

1. `pool_thread` with `chars` 10 over a post of 30 characters and one of 5 returns `cut` true and false.
2. `system_digest`'s excerpts carry `cut` the same way.
3. A persona on staff as a Mod with an order, then made Boss: `mod_standing` returns `order` null; a meeting after the
   change writes no `staff_orders` row for it; a Mod still on staff and not ordered keeps its line, with allowance 0.
4. A Mod moved off staff, then back on: no order until a meeting orders it.

Then the migration, from the latest bodies (check no later migration has replaced them): `pool_thread` (0317) and
`system_digest` (0359) each add `'cut', length(body) > chars` beside each excerpt, the words read as today;
`apply_meeting` (0338) carries forward only a persona in `staff_now`, and its comment says so (the design, section 2);
`mod_standing` (0106) returns `order` only when the office is `mod`. The header names the design and says "everything
else as NNNN wrote it" for each function.

In TypeScript: `ThreadPost` and the digest excerpt gain `cut?: boolean`, passed to `excerpt`. `modPrompt`
(`engine/system/judgment.ts`) writes the order line, or "The Boss has given you no standing order.", only for
`office === 'mod'`; a test holds that an appeal prompt for the Boss has neither.

Run the new SQL test, `supabase/tests/0009-schedule.sql`, the meeting and handoff SQL tests, `npm run test:engine`, and
record the green.

## Task 3. Rehearse once

Model: inline

Run `npm run rehearse -- meltdown-handover --stub` and record that it passes. A live check of the two findings is the
owner's to ask for.

## Review focus

- A digest or thread excerpt whose words were already shorter than the bound must not gain a "…".
- `apply_meeting` and `system_digest` are long functions: the recreated bodies must differ from their latest
  definitions only where the plan says (diff them).
- An appeal heard by the Boss, or by a Mod who was Boss, must read no order at all, not an older one.
- `cut` is a length on words the caller already sees; nothing new is computed from who owns or reacted to a post.
