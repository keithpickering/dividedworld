# Provider schemas: plan

Record, written 2026-11-11. Carries out `docs/plans/2026-11-11-provider-schemas-design.md`. Every task goes test first:
write the failing test, show its red run, then write the code. During a task, run only the tests for the changed code
(`node --experimental-strip-types --no-warnings=ExperimentalWarning --test <files>`). Run `npm run build` once after the
last code task (Task 7), and `npm run test:rehearse` and the 7-day stub of each scenario in Task 8.

Build sessions touch no deployed database (CLAUDE.md, "A standing permission is written down"), and no task before
Task 9 makes a live model call. Task 9 is live and paid, and runs only when the owner starts it.

## Task 1. The provider's rules, as a dated table, and the check

Model: sonnet.

Files: new `engine/system/schema.ts`, `engine/system/schema.test.ts`.

- `schema.ts` exports `interface SchemaRules` and `ANTHROPIC_SCHEMA_RULES: SchemaRules`, with `provider: 'anthropic'`,
  `verified: '2026-11-11'`, `source` (the structured-outputs page and "probes, provider schemas design, section 0"),
  and the rules of the design's section 1: the keyword list, the type list, `additionalProperties: false` on every
  object, `minItems` in {0, 1}, `optionalPerObject: 8`, `optionalTotal: 24`, `unionsTotal: 16`, `propertiesTotal: 40`.
  A comment above each number says where it came from (the published count, or the probe pair it sits under).
- `schemaProblems(schema: unknown, rules = ANTHROPIC_SCHEMA_RULES): readonly { path: string; predicate: string }[]`.
  Paths read like a repair's (`properties.moves.items.properties.params`). Predicates, one per kind of problem:
  `emptySchema`, `keyword(<name>)`, `type(<name>)`, `closedObject`, `minItems(<n>)`, `optionalPerObject(<n>)`,
  `optionalTotal(<n>)`, `unionsTotal(<n>)`, `propertiesTotal(<n>)`. Counting: an optional property is a key of
  `properties` not in `required`; a union is an `anyOf`; a property is every key of every `properties`, through
  `items` and every `anyOf` branch. `description` and `const` are allowed; `enum` values are not counted.
- Tests first, each a poison that must come back with its predicate and path, then the clean case: `{}` nested in a
  property; `maxItems`; `minLength`; `minItems: 2`; an object without `additionalProperties: false`; nine optional
  properties in one object; 25 optional across three objects; 17 `anyOf`; 41 properties; a `pattern`. Clean: the
  apology schema shape (`{verdict: enum, ruling: string}`, both required), and a schema of exactly 40 properties, 8
  optional in one object, 16 unions. Show the red run of the poisons before the code.

## Task 2. Every call is checked before it is sent; every job's schema passes

Model: sonnet.

Files: `engine/system/model.ts`, `supabase/functions/_shared/models/index.ts`,
`supabase/functions/_shared/models/index.test.ts`, `tools/rehearse/models.ts`, `tools/rehearse/models.test.ts`,
`engine/system/judgment.ts` (`patrolPrompt`), new `supabase/functions/_shared/instance.test.ts`, and the tests of each
job that builds a schema (`engine/system/judgment.test.ts`, `engine/system/chatter.test.ts`,
`engine/system/apology.test.ts`).

- `model.ts`: `class SchemaRefused extends AnswerRejected`, with the problems, its predicate the first problem's and its
  message naming the path, e.g. `the schema is refused: maxItems at properties.findings` (`keyword(maxItems)`).
- `index.ts`, `chat`: inside `ledgered`, before the key is read, `schemaProblems(request.schema)`; any problem throws
  `SchemaRefused`, so the ledger's `finally` writes one `failed` row with that predicate, no usage and no cost, and the
  request is never sent. Test with the fake wire: a request with `{}` in its schema sends nothing, throws
  `SchemaRefused`, and writes one row whose predicate is `emptySchema`; a clean one is sent as before.
- `tools/rehearse/models.ts`: the same check at the top of the chat path, before the cassette is consulted, in every
  mode. Test: `--stub` with a schema holding `maxItems` throws `SchemaRefused` and writes its row; replay of a held
  call with a refused schema throws too (a cassette must not hide a schema a provider would now refuse).
- `patrolPrompt`: drop `maxItems` from `findings`. `PATROL_RULE`'s repair keeps the bound: read `repairPatrol` and
  confirm it trims findings past the sample's size and records the trim; if it does not, make it, test first.
- One test per job that builds a schema, using that job's existing test fixtures: `schemaProblems(...)` of the schema
  it builds is empty. Filing (with and without a move offered, and with conferred punishments), report, appeal,
  patrol, apology, chatter (a thread start with title, and with every card that has options on offer at once). Any
  that fails is fixed in this task the way patrol's is: the bound moves from the schema into the rule, and the test
  that drove it stays.
- `instance.test.ts`: for each profile `chooseInstance` knows (none and `playtest`), every card with `staffOptions` has
  a schema with no problems. Poison it once by hand (a card's schema given `maxLength`) to see it red, and say so in
  the commit.

## Task 3. Set a rule's parameter is text, read by one function

Model: sonnet.

Files: `engine/rules/predicates.ts`, `engine/rules/predicates.test.ts`, `engine/system/judgment.ts` (`repairModMove`),
`engine/system/meeting.ts` (`looseFields`, the setRule line of the prompt, the meeting's move repair),
`engine/system/meeting.test.ts`, `engine/system/judgment.test.ts`.

- `readParam(predicateKey: string, given: unknown): { value: unknown; trim?: Trim }` in `predicates.ts`: for a `count`
  predicate, a string of digits (with surrounding spaces) is its number, with the trim
  `{path: 'param', predicate: 'asNumber', before: <length>, after: <number>}`; for a `none` predicate, `''` or
  `undefined` is `null`, with `{predicate: 'asNone', before: <length>, after: 0}`; anything else is returned unchanged
  for `predicateProblems` to judge. Tests first: each conversion, and each value passed through (a word, a tag, a
  number for a count, digits for a word predicate, an unknown predicate).
- `repairModMove`: replace its two inline lines with `readParam`, the trim's path under `move.params.`. Its existing
  tests stay green unchanged, and one new test shows the trim recorded.
- `looseFields`: a field of type `any` is sent as a string (`{type: 'string', optional: true}`), never `{type: 'any'}`.
  The meeting's move repair calls `readParam` for a `setRule` before `moveParamsProblems`, recording the trim at
  `moves[i].params.param`. Then `ruleSchema`: a rule of type `any` throws
  `Error('ruleSchema: an "any" rule at <path> has no schema to send')`; test with a rule holding one nested in a list. Tests: `ruleSchema(MEETING_RULE)` has no `{}` (walk it); a meeting answer with a count
  rule's param `"3"` keeps the move with param 3 and the trim; one with a `none` rule's param `""` keeps it with none.
- The prompt's setRule line says param is written as text: the number's digits, the word, the tag, or empty for none.

## Task 4. The meeting's three parts

Model: sonnet.

Files: `engine/system/meeting.ts`, `engine/system/meeting.test.ts`, `engine/rehearsal/stub.test.ts`.

- `MEETING_PARTS`: `[{ key: 'moves', fields: ['moves', 'inherited', 'successor'], ask: <text> }, { key: 'staff',
  fields: ['orders', 'patrols'], ask }, { key: 'self', fields: ['memory', 'profile'], ask }]`, where `ask` is the
  user message that asks for that part (the first's ends the first message, as "Hold your meeting." does today; the
  others say which part is next and that the earlier answers stand). `MEETING_RULE` is built from the parts' fields, so
  a field in no part, or in two, fails a test (write it).
- `partRule(key)` and `partSchema(key)`. The moves part's schema is the design's section 4 shape: every field
  required; `params` the loose object of the askable kinds' fields, every one required; `demand` required, the loose
  object of `kind` plus the demand kinds' fields, every one required. The rule beside it keeps those fields optional, so
  the repair accepts a blank as absent. The staff and self parts keep today's shapes (a Mod's memory in an order stays
  optional). Test: `schemaProblems(partSchema(k))` is empty for each part, and the counts printed in the test's name
  (properties, optional, unions) match the design's (36, 23, 20 properties); a deliberately merged schema of all three
  parts fails `propertiesTotal`.
- The repair of a move: the kind's own fields are kept; every other kind's field is dropped whatever it holds (no trim:
  the schema asked for them); a kind's own optional field that is `''` is absent (a rule's board, a conferral's board
  and `checkAt`); a demand whose `kind` is `''` is no demand, and a demand's fields other than its kind's are dropped.
  Tests: a rename with a 0 in `percent` and a `''` in `predicate` keeps exactly its four params; a house rule
  (board `''`) is a rule on every board; a favor with demand kind `''` has none; a move needing a demand with demand
  kind `''` is dropped as today (`demand` required).
- `repairAnswer` takes an answer whose parts may be missing: no `moves`, `inherited` or `successor` is an answer with
  none; no `orders` or `patrols` as today; no `memory` returns `memory: undefined`, no `profile` `profile: undefined`.
  `RepairResult` says which. Tests for each part missing.
- `meetingSystemPrompt`: the answer's description follows the parts, each named once, and says the meeting is answered
  in three turns. Its existing tests are updated for the wording, never loosened. The stub (`leastAnswer`) answers each
  part's schema; a test runs `leastAnswer(partSchema(k))` through `partRule(k)`'s repair and `repairAnswer` for each.

## Task 5. A meeting without memory or profile keeps the last

Model: sonnet.

Files: new `supabase/migrations/0154_meeting_parts.sql` (or the next free number when built), new
`supabase/tests/0154-meeting-parts.sql`.

- `apply_meeting` as `0140_machine_moves.sql` defines it last, recreated whole with one change: the `staff_memory`
  insert for the Boss runs only when `jsonb_typeof(payload -> 'memory') = 'object'`, and the `staff_profiles` insert
  only when `jsonb_typeof(payload -> 'profile') = 'object'`. Read the whole function first; nothing else changes. The
  header says why (the provider schemas design, section 4).
- Tests first (red against the current function): a payload without `memory` leaves the Boss's latest memory the
  last row it was; without `profile`, the same for the profile; with both, both are written as before; the bank and
  the moves are applied in all three. Run with `npm run test:sql`.

## Task 6. The meeting makes three calls

Model: sonnet.

Files: `engine/system/model.ts` (`ChatRequest.cachePrefix`), `supabase/functions/_shared/models/anthropic.ts`,
`supabase/functions/_shared/models/index.test.ts`, `supabase/functions/meet/core.ts`,
`supabase/functions/meet/core.test.ts`, `engine/rehearsal/cassette.ts` (only if its key does not already cover every
request field: read it).

- `ChatRequest.cachePrefix?: boolean`: the system prompt and the first message are the same in the calls that follow.
  The Anthropic adapter, when it is set, sends `system` as `[{type: 'text', text, cache_control: {type: 'ephemeral'}}]`
  and the first message's content as one text block with `cache_control`. Tests with the fake wire: the body has both
  marks when set, neither when not. The cassette key includes `cachePrefix` (test, if it is not already covered).
- `core.ts`: the one `models.chat` call becomes three, in `MEETING_PARTS` order, each with `cachePrefix: true`,
  `schema: partSchema(k)`, `rules: partRule(k)` and its own `maxTokens` (moves 6000, staff 3000, self 3000; the
  test asserts them). The messages: the first message; then, for each earlier part, its answer as an assistant message
  (the repaired value as JSON, or, when it failed, the text `(this part was not kept: <error>)`), then that part's
  `ask`. A part's failure (`AnswerRejected`, including `SchemaRefused`) is caught and recorded; an infrastructure error
  still throws, as today. The parts' values are merged into one answer for `repairAnswer`; a failed part's fields are
  left out. If no part was kept, `fail_meeting` as today with the first part's outcome and error. Otherwise
  `apply_meeting` with `memory` and `profile` left out of the payload when absent, and `record.parts`:
  `[{part, outcome: 'ok' | 'rejected' | 'failed', error?}]`.
- Tests first, with the fake models `core.test.ts` already builds: three calls in order with the right schemas and
  messages (the second sees the first's answer); the moves part rejected: no moves applied, memory and orders applied,
  `record.parts` says so; the self part failed: payload without memory or profile; all three failed: `fail_meeting`;
  an infrastructure error in the second part throws and the meeting is failed as today.

## Task 7. The rehearsal's model flags

Model: sonnet.

Files: `tools/rehearse/cli.ts`, `tools/rehearse/cli.test.ts`, `tools/rehearse/setup.ts` (or `run.ts`, where settings are
written before the first job: read both), `tools/rehearse/report.ts` or wherever the report's header is written,
`README.md`.

- `--strong <model>` and `--light <model>`: each must be a model `PRICES.anthropic` lists, or the command refuses with
  the list. Parsed into the run's options; before the first job the rehearsal writes `modelTiers` in its own database's
  `settings` (the rehearsal's cluster only), merged over the instance's. The report's header and `log.json` name both
  tiers' models. Tests: the parse, the refusal, and (in `tools/rehearse/database/`) the setting written.
- README's rehearsal section: the two flags, one line each.
- Run `npm run build`; it ends green.

## Task 8. The stub rehearsals

Model: inline.

- `npm run test:rehearse`, then the 7-day stub of each scenario (`small-circle-reign`, `season-opening`,
  `meltdown-handover`). Each meeting's record shows three parts `ok`; the PR gives the reports' paths and how long each
  took.

## Task 9. The live comparison (owner-started, paid)

Model: inline.

Needs the key from the process environment (`claude/elegant-carson-j17thv`, merged), libfaketime, and the owner's word
to start. The cap holds each run to $5.

    ANTHROPIC_API_KEY="$DIVIDED_ANTHROPIC_KEY" npm run rehearse -- season-opening --cap 5 --seed 2402 --strong claude-opus-5-5
    ANTHROPIC_API_KEY="$DIVIDED_ANTHROPIC_KEY" npm run rehearse -- season-opening --cap 5 --seed 2402 --strong claude-sonnet-5-5

- Report to the owner, for each run: live cost by duty; each meeting's three parts and their outcomes; every trim and
  dropped item; the moves, orders and the Boss's memory each day, side by side; the report's notes (the design's Open:
  the "no kept call" note should be gone). A refusal by the provider of any schema is a failure of Task 2's table, and
  is reported with the API's message and the table's numbers, not worked around.
- Recheck the table: re-send the design's section 0 probe pair for the size cap (46 accepted, 49 refused) and update
  `verified` if they still hold, or report what moved.

## Review focus

- Acts an instance already holds: `apply_meeting` recreated whole (Task 5) must change nothing but the two inserts;
  diff it against `0140_machine_moves.sql`'s definition line by line.
- A retried meeting: three calls instead of one, and the meeting row is closed once. A retry after the first part was
  ledgered must not double-charge the bank or write two memories.
- The cassette key with three calls: each part's key holds the earlier parts' answers in its messages, so a changed
  first answer misses the later parts' recordings rather than replaying them stale.
- The loose all-required params: a field of another kind holding a plausible value (a `board` given for a rename that
  has its own `board`) is the kind's own; read the repair for a field two kinds share.
- `SchemaRefused` is an `AnswerRejected`: check no job treats it as infrastructure and retries it.
- The size cap is a proxy: a part close to 40 properties today is a meeting that fails when a kind is added; the
  test's printed counts are the place to watch.
- Cost: two more strong-tier calls a day per instance. Check the cached prefix is the same bytes in all three calls
  (the cassette key and the usage block's cache reads in Task 9 show it).
