# Provider schemas: what structured output accepts, and the meeting in three calls: design

Record, written 2026-11-11. The design session that followed the first live rehearsal, with the owner. Its plan is
`docs/plans/2026-11-11-provider-schemas-plan.md`.

## 0. What started it

The first live rehearsal (`season-opening --cap 5`, record mode, seed 2402, run from `claude/elegant-carson-j17thv`
with the key passed from the environment) ran seven days and spent $0.0071, and every Boss's meeting closed `failed`:

    HTTP 400 output_config.format.schema: Empty schema ({}) that accepts any JSON value is not supported.

`ruleSchema` (`engine/system/meeting.ts`) turns a rule of type `any` into `{}`, and the meeting's loose move params
carry one: Set a rule's `param` (`engine/system/moves.ts`, `SET_RULE`), which is a whole number, a word, a BBCode tag or
nothing, by predicate. Only the meeting builds its schema from its rule; the other jobs (filing, report, appeal,
patrol, apology, chatter) write theirs by hand, and their `any` rules steer only the repair. The stub's `leastAnswer`
takes `{}` like any schema, so `--stub` and CI never saw it.

The session then probed the API directly (each refused request is free; an accepted one was capped at 16 tokens). What
it found is the ground this design stands on, and none of it is visible without a live call:

| Probe | Answer |
|---|---|
| the meeting's schema with `param` as `{type: 'string'}` | 400: too many optional parameters (32), limit 24 |
| an array with `maxItems` | 400: `maxItems` is not supported (the patrol schema has one, `engine/system/judgment.ts`) |
| a flat object of 25 optional strings | 400: too many optional parameters |
| a flat object of 24 optional strings | 400 after 180 s: schema is too complex |
| flat objects of 4, 8, 12 optional strings | accepted in 2 s, 5 s and 41 s: the compile time grows steeply with optional fields |
| each part of the meeting alone (memory, profile, moves, inherited, successor, orders, patrols) | accepted; the loose moves took 194 s |
| the meeting's moves as one branch per kind (`anyOf`), each with its demand as `anyOf` the demand kinds, all required | 400 at once: the compiled grammar is too large |
| the same without the demand inside the branches | accepted in 3 s |
| the meeting's whole answer in every shape tried, all fields required | 400 at once: the compiled grammar is too large |
| memory, orders, profile, inherited, successor, all required | accepted in 5 s; adding patrols tips it over |
| the same two on Opus 5.5 | refused the same: the limit is the service's, not the model's |
| the loose moves alone, all required; with inherited and successor | accepted in 4 s |

Anthropic publishes the keyword rules and the 24 and 16 counts
(`platform.claude.com/docs/en/build-with-claude/structured-outputs`, read 2026-11-11); the grammar's size limit is
unpublished. So the Boss's whole meeting cannot be one structured call in any shape, and a schema that compiles today
can stop compiling when a move kind or a field is added. This design is the form that holds.

## 1. A provider's schema rules are one dated table (decided)

`engine/system/schema.ts` holds what structured output accepts, as data with a verification date, the way
`supabase/functions/_shared/models/prices.ts` holds prices:

- **Keywords:** `type` (object, array, string, number, integer, boolean), `properties`, `required`, `items`, `enum`,
  `const`, `anyOf` and `description`. Nothing else. Every object has `additionalProperties: false`. No `{}`. `minItems`
  only 0 or 1; no `maxItems`, `minimum`, `maximum`, `minLength`, `maxLength` or `pattern`. A bound the schema cannot
  carry lives in the rule (`engine/system/validate.ts`), which the repair holds after the fact, as it does today.
- **Size:** at most 8 optional properties in one object and 24 in the whole schema (the compile time, not only the
  published count: 12 in one object took 41 s); at most 16 `anyOf`; and at most 40 properties in the whole schema,
  counted as every key of every `properties` through items and branches. The last is a proxy for the unpublished
  grammar limit, set under the 46 the probes accepted and the 49 they refused, and recorded with the probes that set it.

`schemaProblems(schema)` returns each problem as `{path, predicate}`, the way a repair names a failed bound. The table
names the provider it was measured on and the date; a new provider adds its own measured rules, and the check holds a
request to the rules of the provider the request goes to. Alternatives weighed: a test-only check of each job's schema
from fixtures (rejected: an enum of boards, a card's options and an instance's content shape the schema at run time, so
a fixture misses what live data builds); a check in the stub alone (rejected: a live call would still send it).

## 2. Every call is checked before it is sent, in every mode (decided)

The model interface runs `schemaProblems` on a chat request's schema before anything is sent: the real factory
(`supabase/functions/_shared/models/index.ts`) and the rehearsal's (`tools/rehearse/models.ts`), in stub, offline,
replay, record and fresh alike. A refused request throws `SchemaRefused` (a kind of `AnswerRejected`, so a job treats
it as a rejected answer, never as infrastructure), inside the ledger's `finally`, so it writes one `failed` row with the
first problem's path and predicate, no usage and no cost. A `--stub` rehearsal therefore goes red on a schema a provider
would refuse, and so does CI, which runs one.

`ruleSchema` throws on a rule of type `any`, naming its path: a rule that is sent must say what the model writes. `any`
stays in `Rule` for the hand-written schemas' repair, where it means "a later check owns this field".

The instance's own schemas are checked at build time too: a test beside `chooseInstance`
(`supabase/functions/_shared/instance.ts`) runs `schemaProblems` on every card's `staffOptions.schema` of every
instance profile, so an instance's content cannot carry a schema a provider refuses into a deployed chatter call.

## 3. The fixes the check forces (decided)

- **Set a rule's `param` is sent as text** (owner's answer, the first question). It is what a Mod's own Set a rule
  already sends (`MOVE_SCHEMA`, `engine/system/judgment.ts`, "no anyOf, so any provider's structured output holds
  it"). Reading it is one function, `readParam(predicateKey, given)` in `engine/rules/predicates.ts`: digits are the
  count a `count` predicate takes, empty text is no parameter for a `none` predicate, and anything else is passed on
  for `predicateProblems` to judge; each conversion returns a trim (`asNumber`, `asNone`) for the call's record. The
  Mod's repair (`repairModMove`) and the meeting's both call it; today the Mod's has the two lines inline and the
  meeting's has none.
- **The patrol schema drops `maxItems`.** The prompt already says the most; the patrol's rule keeps the bound and its
  repair trims findings past it and records the trim, as the rule does today.
- Any other schema the check refuses when it first runs over every job (Task 2 of the plan) is fixed in that task, in
  the same way: a bound moves from the schema into the rule.

## 4. The meeting is three calls (decided)

The owner's first answer was one branch per move kind in a single schema. The probes after it showed the whole answer
cannot compile as one schema in any shape, so the owner chose to split. One meeting makes three structured calls, in
order, all with the same system prompt and the same first message (the digest, the memory, the reference lists):

1. **Moves:** `moves`, `inherited`, `successor`. The decision the meeting exists for, made first, against the bank.
2. **Staff:** `orders`, `patrols`. The Mods are ordered after the Boss has chosen its own moves, shown them.
3. **Self:** `memory`, `profile`. The Boss writes down what it now thinks, having done the day's work.

Each later call has the earlier calls' answers in its messages as prior turns (assistant, then a user message naming
the next part), so the Boss stays one mind across the three. The parts are one list, `MEETING_PARTS` in
`engine/system/meeting.ts`, each with its key, its fields and its rule, and `MEETING_RULE` is built from it: the whole
and the parts cannot disagree ("Two lists that must agree are one list").

**Shapes inside a part.** A part's schema requires every field where a blank can say "none", which compiles in
seconds where optional fields take minutes: the moves' params stay one loose object (the union of the askable kinds'
fields), now all required, with empty text and 0 meaning "not given"; a move's `demand` is the same loose object of the
demand kinds' fields, with an empty `kind` for a favor. The repair keeps a move's own fields and drops every other
kind's, whatever it holds, so a 0 in another kind's field is never read; a kind's own optional field (a rule's board,
a conferral's board and check time) is absent when blank. Fields that cannot say "none" by a blank (a Mod's memory in an
order) stay optional, inside the table's caps. The branch-per-kind shape is not used: with its demand inside, it is too
large, and without it, it buys nothing the repair does not already hold.

**A part that fails leaves its fields as they were.** Each call is repaired and ledgered on its own. A failed or
rejected part is an answer that left its fields out, which the meeting already handles for orders and patrols: no new
moves, inherited moves unanswered (they end by themselves after the grace, as today), no successor; the Mods keep their
last orders and memory; the Boss keeps yesterday's memory and profile. So `apply_meeting` gains a migration: a payload
without `memory` writes no `staff_memory` row and one without `profile` no `staff_profiles` row (both tables are
append-only, so "as it was" is the last row). The meeting closes through `apply_meeting` when any part was kept, with
each part's outcome and error on its record; when all three fail, it closes through `fail_meeting` as today, with the
first part's outcome. Calls run in order and a later call runs even when an earlier one failed, shown that the earlier
part was not kept.

**Cost.** Two more calls a day per instance, on the strong tier. The system prompt and the first message are the same
for all three, so the request marks them as a cacheable prefix: `ChatRequest` gains `cachePrefix?: boolean`, and the
Anthropic adapter puts `cache_control: {type: 'ephemeral'}` on the system block and the first message's last block.
The ledger already prices cache writes and reads from the usage block ("Cost is a column, not a report"). A provider
without caching ignores the flag.

**Busy instance.** The parts' sizes grow with the catalogs (move kinds, demand kinds, a Mod's fields), not with players,
threads or Acts: the digest is in the message, never the schema. A larger cast lengthens the cached prefix, which is
paid once and read twice. Each part sits well under the size cap today (moves, inherited and successor: 36 properties;
orders and patrols: 23; memory and profile: 20), and a kind added later that crosses it fails the build, not a meeting.

## 5. Rehearsing Opus against Sonnet (decided)

The owner asked for the strong tier to be tried on Sonnet 5.5 as well as Opus 5.5, since Sonnet is half the price and
may make the game's decisions as well. The rehearsal gains `--strong <model>` and `--light <model>`, which set
`modelTiers` in the rehearsal's own database before the first job; a model the price table does not list is refused at
the command line, since an unpriced call throws. The plan's last task runs `season-opening` live twice on one seed, once
per strong model, with the light tier unchanged, and reports for each: cost by duty, each part's outcome, every trim and
dropped item, and the moves, orders and memory each Boss made, side by side. Which model the instance uses stays the
owner's call, made from the reports: the plan changes no setting.

## 6. The layers, the masks and the ways out

- **Layers.** `schema.ts`, `MEETING_PARTS`, `readParam` and the meeting's repair are engine. The table names a provider
  as data, never imports a vendor client. The Anthropic adapter's `cache_control` is the edge. The instance test is at
  the edge beside `chooseInstance`, which already knows the instances; the engine never imports one.
- **Masks.** Nothing here computes from a private fact. The calls carry what the single call carried; the parts' record
  holds outcomes and errors, which are the System's own.
- **Ways out.** No state is added that a player, a character or a post can be put in. A failed part leaves the game as
  an absent answer does today, and every way out that already exists (an inherited move's grace, a Mod's last order)
  still applies.

## 7. Open

- The 40-property cap is a proxy, measured on one day; the unpublished limit may move. The table's date says when it
  was last checked, and the plan's last task re-runs the probes.
- The rehearsal's report notes "ledger rows have no kept call" for each failed meeting: a failed live call writes a
  ledger row and the cassette keeps nothing. Not changed here; the report reads correctly once meetings succeed, and
  the notes are rechecked in the last task.
- The live runs need the key from the process environment, which is `claude/elegant-carson-j17thv` (not yet on
  `main` when this was written).
