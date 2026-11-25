# The staff speak for themselves: persona stock lines and owed lines: design

Record, written 2026-11-25. A design session with the owner on #1082, raised while reviewing #1066 (staff requests):
the new `requestGranted`, `requestRefused` and `requestLapsed` lines in `instances/divided-world/system/lines.ts` are
in no persona's voice. Its plan is `docs/plans/2026-11-25-persona-lines-plan.md`.

## 0. What was found

- **Stock lines belong to the instance, not to any persona.** `engine/system/stock.ts` names 22 keys. The instance writes
  one list per key (`SystemContent.stockLines`), and seed sends it to the database as the setting `systemLines`
  (`supabase/functions/_shared/seed.ts`). Whoever speaks uses that one set. A persona (`Persona` in
  `engine/rules/types.ts`) carries a voice, a temperament and office lines, but no stock lines.
- **Six SQL readers pick a line, and each already knows who is speaking.** `system_line` (latest 0209), `visit_line`,
  `report_line` and `appeal_line` (0126), and `boss_request_reply` (0424) each take the speaker's staff key. So do the
  existence checks in `say_in_announcements` (0403) and `season_news` (0403). TypeScript reads one key, in one place:
  the meeting's stock board description (`withDescription`, `supabase/functions/meet/core.ts`).
- **About half the keys already come from a model whenever its call succeeds.** For these, stock is only what stands in
  when the call fails, runs out of budget or leaves the line blank:
  - `visitArrived` and `visitFiled`: the Mod's judging and filing call.
  - `reportDismissed` and `reportBackfired`: the report judge.
  - the four `appeal*` keys: the hearer.
  - `requestGranted`, `requestRefused` and `boardDescription`: the meeting.
  - `bossFarewell`: written ahead by the last meeting (`say_farewell`, 0337).
- **The rest are always stock, because no model call happens when they occur.**
  - `moveLanded` and `ruleSet`: a move lands at the tick, often hours after the meeting that chose it.
  - `moveMet`, `moveExpired`, `moveUnmet` and `moveSuperseded`: the tick (`say_move_end`).
  - `moveReversed`: an admin's reversal.
  - `moveOverturned`: ended by SQL once the appeal rules.
  - `bossArrival`: the handover, in SQL, before the new Boss has ever met.
  - `requestLapsed`: the tick (0424).

  These are the lines players see most often, and they go stale fastest.
- **The duty for these lines exists but is not wired.** `standingOrderLine` is in `engine/system/duties.ts` (light tier),
  and nothing calls it.

## 1. What was decided

### 1.1 Who writes which line: the call that decides, or a light call afterward

The owner asked why the line isn't written in character whenever a model call is already being made for the act, and
noted that prepared lines treat the symptom without curing the staleness. That is the concern the dynamic quizzes work
addresses too. Three options were weighed:

- **The meeting writes every possible line ahead.** For each move it queues, the meeting (strong tier) writes the landing
  line and one line for each way the move could end. For each request still waiting, it writes a lapse line and
  rewrites it at every meeting. This is the farewell's pattern.
- **A light call writes the line once the outcome is known.** The act happens at once; a light-tier call then writes the
  speaker's line from the real outcome.
- **Per-persona stock only**, which is #1082 as filed.

Costed from `supabase/functions/_shared/models/prices.ts`:
- **Writing ahead** costs about 250 strong-tier output tokens per move (a landing and about five endings) at $20/M,
  roughly $0.005. Only about two of those lines are ever seen. A lapse line is rewritten every meeting while the request
  waits.
- **Writing after** costs about two light-tier calls per move, for the lines actually seen. Each is about 3k input at
  $0.10/M plus 60 output at $0.50/M, roughly $0.0007 per move.
- Writing after is 5 to 10 times cheaper, and stays cheaper even if the input estimate is five times too low, because
  the light tier's output costs a fortieth as much per token.
- It is also fresher: the line knows how the move actually ended.

The owner said response time does not matter here: as with a report, the answer arrives about when it would anyway.
Quality is the one thing the arithmetic cannot settle. Two things keep that risk small:
- The light tier already voices every Mod filing, report, appeal, chatter post and conversation turn.
- A duty's tier is one entry in `DUTY_SPECS`, so the duty can move to the strong tier without a redesign.

**Decided: a hybrid.** A line is written ahead only where it is certain to be seen. Every other line is written by a
light call once its outcome is known.

- **Written ahead: the landing line** (`moveLanded`, `ruleSet`). The call that queues a move writes one line for its
  landing. That is the meeting for its own moves, or the Mod's filing call for the Mod's move. The line is stored with the
  queued move and becomes the landed move's body. Where the call wrote none, the speaker's stock line stands in.
- **Owed, then written by a light call: every ending, every lapse, and the arrival.** This covers `moveMet`,
  `moveExpired`, `moveUnmet`, `moveSuperseded`, `moveReversed`, `moveOverturned`, `requestLapsed` and `bossArrival`.
  - The act lands at once, exactly as today. The move ends, the request lapses, the handover seats the new Boss, so the
    log and the glass are true immediately.
  - What changes is that the in-character post is *owed*. The act records that a line is owed by its speaker, and the
    staff run, on its five-minute schedule, writes it with one light call per line (duty `standingOrderLine`) from the
    real outcome.
  - A line not written within `owedLines.graceMinutes` (15) is posted from the speaker's stock by the tick. The same
    happens at once for a line that cannot be voiced: The System is off, the day's call cap is spent, the call failed,
    or the speaker is not on the roster. This is the visit filing's pattern (`supabase/functions/staff/core.ts`), and
    nothing waits on a model.
- **Unchanged: the keys a call already writes when it succeeds.** Visits, reports, appeals, request rulings, board
  descriptions and the farewell keep their present calls. Their fallback becomes the speaker's stock (1.2).

The owner asked whether the same split should apply everywhere: the strong tier decides game state and moves, and the
light tier writes all the dialogue. That would re-cut the meeting and every staff call, which is beyond #1082, so it is
filed as a follow-up issue for a design session of its own. This design is the first case of the pattern.

### 1.2 Per-persona stock lines, as the floor

- **Every roster persona carries every key.** `Persona.stockLines` has the same `StockLines` shape as the instance's.
  The engine's `instanceProblems` refuses a roster persona that is missing a key, has an empty list or a blank line,
  names a key that is not a standing order, or uses a token the key is never given. These are the same rules, and the
  same function, that check the instance's set. Every Divided World persona can hold either office over the seasons, so
  any of them can say any key.
- **The instance's set stays as the last resort.** It is used for a speaker with no set: a persona that has left the
  roster, or a test fixture.
- **Stored as a new setting, `personaLines`**: `{personaKey: {lineKey: [lines]}}`, seeded from the roster.
  `systemLines` keeps its shape, so the roughly 40 SQL fixtures that set it are untouched. `settings_held` checks the
  new setting's shape.

  Rejected: nesting both sets inside `systemLines`, which reshapes every reader and fixture; and a column on the staff
  characters, which puts content on a table clients read.
- **One SQL helper picks the set**: `stock_lines(line_key, speaker)` returns the speaker's list where it is a non-empty
  array of strings, otherwise the instance's, otherwise null. Every reader in section 0 calls it in place of its own
  read of `systemLines`. TypeScript gets the same thing from `stockLinesOf(system, speakerKey, key)` in
  `engine/system/stock.ts`, which `withDescription` uses.
- **The speaker is the character who posts the line.** That is the staff key each reader already takes, with one fix.
  `say_move_end` posts a superseded move's end as the *current* Boss, but fills its line from the move's own staff
  member. From now on the line comes from the poster's set, while `{boss}` still names the move's maker.
- **A persona's own set may speak in the first person** ("I am your Boss now"). The tokens stay available for lines
  that want them.

### 1.3 The arrival

The handover stops posting the arrival at once and owes `bossArrival` by the new Boss, like any other owed line. The
staff run writes it with the new Boss's persona prompt, told who it succeeds and how it was chosen (nomination or
rotation). Within the grace, the tick posts the new Boss's stock arrival. `season_news` finds the arrival post through
the owed line's payment, not by matching the handover's timestamp. The owner first picked "the first meeting writes
it", before choosing the hybrid. Under the hybrid, the arrival is an event with nothing to decide, so it takes the owed
path, and the meeting's schema is not touched for it.

### 1.4 Lines written ahead and owed: their bounds

- **Landing line.** An optional `line` on each of the meeting's moves, and on the Mod's move. It is checked after the
  fact:
  - trimmed to 280 characters at a sentence, and the trim is recorded;
  - braces stripped from any `{token}` the key is not given (the word inside stays), with the strip recorded;
  - a blank line counts as none.
  Nothing about a landing line ever rejects a paid answer ("A validator tighter than the schema").
- **Owed line.** One string. A line longer than 280 characters is trimmed at a sentence; a blank line is posted from
  stock. The run writes names out itself, so an owed line carries no tokens.
- **What the run tells the speaker**, all of it public play:
  - **for a move's end:** the move's plain words, the `why` its maker gave, how it ended (met, expired, unmet,
    superseded, reversed, overturned), and for a superseded move, who made it;
  - **for a lapse:** the request post's body, quoted as players' words that are never instructions, and the asker's
    public name;
  - **for the arrival:** the predecessor's name and how the new Boss was chosen.

  The speaker is heard in the frame of the office it holds now (`personaPrompt`), as an apology's judge is.

### 1.5 Settings

- **`owedLines`**: `{ graceMinutes: 15, perDay: 60, perRun: 20 }`.
  - `graceMinutes`: how long a line may wait before the tick posts it from stock.
  - `perDay`: the day's cap on calls, counted from the ledger's `standingOrderLine` rows. A line over the cap is posted
    from stock at once.
  - `perRun`: how many owed lines one run takes.

  Each is a whole number, checked by `settings_held` and in `instanceProblems`.
- **`personaLines`**: seeded and never edited by hand. It is an instance setting so that SQL names no persona.

## 2. The layers

- **Engine:**
  - `Persona.stockLines` and its check;
  - `stockLinesOf`;
  - the landing line on the meeting's and the Mod's move answers, and its repair;
  - the owed-line prompt and repair (`engine/system/owed.ts`);
  - the `standingOrderLine` duty, made a chat duty (completion for a persona on the old voice);
  - the `owedLines` settings type;
  - all the SQL;
  - the staff run's new pass.
- **Instance (Divided World):**
  - each persona's 22 keys of stock lines, in its own voice, drafted for the owner;
  - the fixture personas' sets;
  - the `owedLines` numbers.

  `lines.ts` stays as the last resort.
- **The interface carrying the content:** `Persona.stockLines` through `SystemContent.roster`, seeded as `personaLines`.
  The engine names no persona and no instance.

## 3. Ways out

An owed line is a new state of a post that has not been written yet. It ends by itself:
- written by the staff run within `graceMinutes`;
- or posted from stock by the tick at the grace;
- or posted from stock at once when the line cannot be voiced.

A line that cannot be posted at all (the speaker is locked out of the thread, or the thread is gone) is paid as `unsaid`
with the reason, and leaves the queue, as a lapse's reply does today. No player waits on it: the act it belongs to has
already happened, and the log already says so.

## 4. The masks

- An owed line's prompt holds only public play:
  - the move's words and its maker's `why`;
  - the request post as `acts_public` shows it, with a veiled author as the anonymous name;
  - the staff characters' names.
- No owner, class or reactor is read.
- When a line posts depends on the schedule, the cap and the grace, never on who is behind any character.
- `personaLines` holds only content.
- `lines_owed`, its queue and its payments have RLS on and no client grant. A client reads the posted line only as a
  post.

## 5. Open

- **Quality of the light tier's lines.** To be judged by the owner on the test instance. If they read thin, the duty
  moves to the strong tier, which is one entry in `DUTY_SPECS`.
- **"The strong tier decides, the light tier speaks" for the rest of the System** (the meeting's request lines, board
  descriptions, farewell, and the Mod calls' lines): the follow-up issue.
- **The persona lines' wording:** drafts for the owner's review in the build's PR.
