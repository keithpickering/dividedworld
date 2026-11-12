# The meeting is sent uncached

Record, written 2026-11-12. A design session with the owner on keithpickering/dividedworld#509. The plan is
`docs/plans/2026-11-12-meeting-uncached-plan.md`.

This changes one paragraph of the provider schemas design (`docs/plans/2026-11-11-provider-schemas-design.md`, section
4, "Cost"). That paragraph marked the system prompt and the first message as a cacheable prefix, expecting the prefix
to be "paid once and read twice". Everything else in that design holds, the three-part meeting included.

## 1. What the live comparison showed

The provider schemas plan's Task 9 (keithpickering/dividedworld#501) ran `season-opening`, seed 2402, 7 days, against
the live API. The figures below are from #509:

| Strong tier | Meeting calls | Cache read | Cache write (5 m) | Plain input |
|---|---|---|---|---|
| Opus 5.5 | 21 | 0 | 256,618 | 10,229 |
| Sonnet 5.5 | 21 | 0 | 229,180 | 5,003 |

None of the meeting's three parts ever read the prefix. Within a meeting, the tokens each part wrote shrank from one
part to the next by exactly the difference between the parts' schemas, so the `output_config.format` schema is
rendered into the cached prefix, ahead of the system prompt. Each part sends a different schema, so each part has a
different prefix. Each part paid the write premium (1.25× input) for a cache it never read. On Opus, the week's
prefixes cost about $1.28 cached against about $1.03 uncached.

## 2. Decided: the meeting sends no cache marks, and `cachePrefix` leaves the interface

`ChatRequest.cachePrefix` is removed (`engine/system/model.ts`). The Anthropic adapter
(`supabase/functions/_shared/models/anthropic.ts`) sends `system` and every message as plain strings, as it did before
the provider schemas design. The meeting (`supabase/functions/meet/core.ts`) is the field's only caller, and it stops
sending the field.

The field is removed rather than left unset. A flag that no caller sets is an untested shape, and the only reason to set
it is the case #509 showed fails: a run of calls whose prompts match but whose schemas differ. A later duty whose calls
really do share a whole prefix, schema included, adds caching back in its own design, with a live measurement of
reads beside it.

The ledger still prices cache reads and writes from the usage block exactly as reported ("Cost is a column, not a
report"), so a provider that bills a cache on its own is still priced correctly. Rows already written keep their
cache-write tokens and costs: they are the true record of what was billed.

## 3. Alternatives weighed

- **Route 2: one schema in all three calls.** Rejected. A schema holding all three parts is the grammar the provider
  refuses, which is why the meeting was split (provider schemas design, the probe table).
- **Route 3: move each part's schema out of the prefix.** Weighed without a live probe; rejected for now, and left open
  (section 4). The forms considered:
  - **Strict tools in place of `output_config.format`.** Tools render first in the prefix, so the prefix only stays the
    same if every call sends all three parts' tools. That puts all three grammars in one request, about 79 schema
    properties against the roughly 46 the earlier probes found as the ceiling. This is the same refusal that split the
    meeting.
  - **One part's tool per call, chosen by `tool_choice`.** Opus 5.5 and Sonnet 5.5, the strong tiers, refuse forced
    `tool_choice` (`tool` or `any`) with a 400. Only `auto` is left, which does not guarantee the call: the model may
    answer in text or call the wrong part's tool, and a day then loses that part, possibly the Boss's moves.
    `output_config.format` guarantees the shape today.
  - **Mid-conversation tool additions** (a beta: each part's tool added after the cached prefix). Same `auto`-only
    weakness, plus a dependency on one vendor's beta, for about $0.60 a week per instance on Opus at today's digest
    size.
  - **Mid-conversation `output_config`** (a beta) carries `effort` only, by its documentation, not `format`.

  The owner chose not to probe: the forms that could work trade a guaranteed answer shape for a small saving, and the
  probe needs an API key this session has no way to ask for ("Secrets are never printed, pasted or asked for").
- **Keep the field and only stop the meeting setting it.** Rejected for the reason in section 2.

## 4. Open

- **Caching the meeting again.** Two things would reopen it: a provider documenting a way to vary the structured-output
  schema after a cached prefix (for example `format` added to mid-conversation `output_config`), or forced
  `tool_choice` returning on the strong tier. The question then is whether reads appear in a live comparison, measured
  as #509 measured. A busy instance's digest is longer, so the prefix and what caching it would save grow with it
  ("Weigh a design at the scale of a busy instance"). The saving reopens the question; it does not answer it.

## 5. The masks, the layers, the ways out

- **The masks.** No response, payload, event or timing is added or changed. The request loses a mark, nothing else.
- **The layers.** Engine: `ChatRequest` loses a field. Edge: the Anthropic adapter stops sending `cache_control`. No
  instance content is involved.
- **Ways out.** No state is added.
