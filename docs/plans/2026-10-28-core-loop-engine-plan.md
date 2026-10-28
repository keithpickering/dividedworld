# The core loop's engine: plan

Record, written 2026-10-28. The plan for the engine half of `docs/plans/2026-10-28-core-loop-design.md`: the
database and its invariants, the rules, the settlement, the season and live updates. It draws no screens; the screens
and card effects get their own design session and plan, built on the projections this plan publishes. A build session
carries this out task by task, tests first, each red run recorded (`.claude/skills/build-session/SKILL.md`).

No product code exists yet, so every file below is new. Names are the plan's; a builder who finds a better one keeps
the meaning and lists the change under `Plan gaps`.

## The layout, and which layer each part is

| Path | Layer | Holds |
|---|---|---|
| `engine/rules/` | engine | Pure TypeScript: the types every instance implements, the vote math, the settlement, cards' and classes' interfaces |
| `engine/bbcode/` | engine | Parsing BBCode into an allowlisted tree; no rendering |
| `instances/divided-world/` | instance | The four classes, the two cards, the reaction set, the economy settings, the board seed; one `index.ts` exporting the instance |
| `supabase/migrations/` | engine | Plain SQL: schema, invariants, row-level security, public views, the SQL function for each action. No class, card or emoji is named in SQL; they arrive as data from the instance |
| `supabase/functions/` | composition root | Thin Edge Functions that import the engine and the one deployed instance and call SQL. The only place both layers meet |
| `supabase/tests/` | engine | SQL tests, run against Postgres on localhost |
| `tools/` | repository | Guards and test runners |

The instance's content reaches the engine through one interface, `Instance` (Task 1): `classes`, `cards`, `reactions`
(each emoji's key and quadrant), `settings` (section 10 of the design), `boards` (the seed). The engine is written
against `Instance` and never names Divided World.

TypeScript runs under Node 22's type stripping in tests (`node --experimental-strip-types`) and under Deno in Edge
Functions. Imports carry their `.ts` extension, which both accept.

## Tasks

### Task 0. The toolchain, local Postgres and the boundary guard

- `tsconfig.json`: include `engine/**/*.ts`, `instances/**/*.ts`, `supabase/functions/**/*.ts`; add
  `allowImportingTsExtensions`; turn `strict` on for those paths.
- `package.json`: `test:engine` runs `node --experimental-strip-types --test` over `engine/` and `instances/`;
  `test:sql` runs `tools/test-sql.mjs`. `test:engine` goes into `STEPS` in `tools/build.mjs`.
- Local Postgres, carried from currents (`docs/plans/port-manifest.md`): `scripts/setup-container.sh` installs it
  once per environment; the Postgres half of currents' `.claude/hooks/session-start.sh` comes back.
- `tools/test-sql.mjs`: applies `supabase/tests/setup/auth-shim.sql` (a stand-in for Supabase's `auth.uid()` and
  roles, read from a setting a test sets) and then every migration to a scratch schema on `DATABASE_URL`, runs
  `supabase/tests/*.sql`, and drops the schema. It refuses to run when `DATABASE_URL` is unset or names a host that
  is not localhost ("A test that builds its own subject cannot tell you the subject is missing"). It stays outside the
  build (`OUTSIDE_THE_BUILD`, with the reason) and runs in a new `.github/workflows/sql.yml` with a Postgres service.
- **The boundary guard**, `tools/check-engine-boundary.mjs` with `tools/test-engine-boundary.mjs`: no file under
  `engine/` imports, re-exports or dynamically imports a path that resolves into `instances/`, and no file under
  `instances/` imports another instance. Into `STEPS`, test first.
- **Poisons:** an `engine/` file importing `../instances/divided-world/index.ts`; the same through a re-export; the
  same through `await import()`; `tools/test-sql.mjs` pointed at a non-localhost `DATABASE_URL`.

### Task 1. The instance interface and the reaction set

- `engine/rules/types.ts`: `Quadrant` (`excitedPositive`, `excitedNegative`, `calmPositive`, `boredNegative`);
  `ReactionKind` (key, emoji, quadrant); `Alignment` (`sweet`, `salty`, `pepperoni`); `ClassRules`, `CardRules`,
  `Settings`, `Instance`.
- `instances/divided-world/reactions.ts`: the spec's four sets (🔥❤️🙌🤩, 🍅😡🤬👎, 😌☕🤝🧘, 💤🙄🗑️🥱).
- `instances/divided-world/settings.ts`: the design's section 10 table, in hundredths of an orb.
- **Tests first:** every reaction key is unique and has a quadrant; every setting the engine reads is present; the
  playtest overrides (season, cooldown) are separate values, not edits of the defaults.

### Task 2. The vote math

- `engine/rules/votes.ts`: `shareVotes(reactions)` splits one player's reactions on one Act into equal shares of one
  vote; `halveAcrossActs(votes, settings)` orders a player's votes on one character's Acts within a window by time and
  weights them 1, ½, ¼ and so on; both are keyed by player, never character.
- **Tests first:** one reaction is a whole vote; three are a third each; two players' reactions never share a vote; a
  player reacting through two of their characters is one player; the fourth Act by one character in a window weighs ⅛.

### Task 3. The settlement, as a pure function

- `engine/rules/settle.ts`: `settle(window, instance)` takes a window's Acts, reactions (with quadrant, time, player
  and character, never leaving the server), threads spun and card plays, calls each character's class rules, and
  returns ledger entries per player and character with a reason each. `applyCap(balance, entries, cap)` applies the
  wallet's floor of zero and its cap, recording what overflowed.
- `previewForOwner(openWindow, instance, account)` runs the same computation on the window so far, for one player's
  own characters: the live view in the player's own log (design, section 4). No second implementation.
- **Tests first,** with two fake classes: entries are deterministic for the same inputs in any order; a hostile reaction
  never takes the wallet below zero; Aura past the cap leaves the wallet and stays in the standing; a reaction from the
  target's own player is never counted even if one reached the function.

### Task 4. Divided World's classes

- `instances/divided-world/classes/face.ts`, `heel.ts`, `lurker.ts`, `jabroni.ts`, each implementing `ClassRules` from
  the design's section 6 table; `instances/divided-world/classes/index.ts`.
- The Lurker's "where the post ends up" is the post's dominant quadrant by vote weight at the settlement; "early" is
  among the first three players to react to it. "Outdraws" compares a card's vote total with its target post's within
  the window. Replies to a spun thread count from distinct other players only.
- **Tests first:** one test per cell of the table, income and weakness, plus: a Lurker's cards and reactions never
  count as posting; reactions to a card count for the card's player; a Heel's thunder-stealing Salty card pays and a
  Face's costs.

### Task 5. Schema: accounts, characters, boards, threads, Acts

- `supabase/migrations/0001_core.sql`: `accounts` (one per auth user); `characters` (owner account and class key
  private; name unique per instance); `class_history` (private until the reveal); `boards`; `threads` (with
  `origin_act_id` for a thread spun from an Act); `acts` (actor character, kind, thread, target Act, payload, sequence
  number per thread for `?page=N#post-M` links). A trigger refuses every `UPDATE` and `DELETE` on `acts`. An edit is a
  new Act; a post's current text is the latest edit, read through a view.
- Row-level security on every table; `characters_public` and `acts_public` views carry no owner and no class. Every
  `security definer` function pins `search_path` ending in `pg_temp`.
- **Tests first** (`supabase/tests/0001-core.sql`): another account cannot read a character's owner or class through
  any table or view; an `UPDATE` of an Act's payload is refused; a seventh character is refused; a quoted Act and a
  spun thread point at the Act they came from.

### Task 6. Reactions

- `supabase/migrations/0002_reactions.sql`: `reactions` (Act, reactor character, reactor account, kind; private,
  never in a Realtime publication); `reaction_tallies` (Act, kind, count; public); `react(act, character, kind)`:
  refuses a character the caller does not own, a target whose author the caller owns, a fourth distinct kind from one
  player on one Act, and the same kind twice from one player; inserts and updates the tally in one transaction.
- **Tests first:** each refusal; the tally matches the rows; a player using two characters is held to three kinds
  between them; the refusal for one's own character reads the same whichever of the caller's characters wrote the post.

### Task 7. The wallet, the standing and the settlement's writes

- `supabase/migrations/0003_aura.sql`: `ledger` (append-only entries: account, character, window, reason, amount in
  hundredths); `wallets` (the balance, read only by its own account); `standings` (character, season, settled total;
  public); `settlements` (one row per window). `apply_settlement(window, entries)` refuses a window already settled,
  re-checks the floor and the cap, and writes entries, wallets and standings in one transaction.
- **Tests first:** applying a window twice writes once; a balance never leaves zero to six orbs; another account cannot
  read a wallet; a standing changes only at a settlement.

### Task 8. The settlement job

- `supabase/functions/settle/index.ts`: reads the window, calls `settle()` with the instance, calls
  `apply_settlement()`. A transport failure is retried on the request; a database error is thrown ("Three unrelated
  timeouts are not a poison pill"). `supabase/migrations/0004_schedule.sql` schedules it with `pg_cron` at the
  instance's settlement time.
- **Tests first:** the function's core is a pure module tested under Node against fixtures; a second run of the same
  window is a no-op.

### Task 9. Actions

- `supabase/functions/act/index.ts`, one entry per action: post, edit, reply with quote, spin a thread from an Act,
  react, Turn, buy a card, play a card, save Whoops! strokes. Each checks the session, takes the acting character from
  the request, runs the instance's rules to decide (a price, `canApply`), and calls the action's SQL function, which
  checks again. Responses carry public projections only.
- **Tests first:** each action's decision module under Node; for each, the SQL function refuses what the decision
  would refuse when called directly, so a missed check in TypeScript cannot get through.

### Task 10. Cards and the Vending Machine

- `engine/rules/cards.ts`: `CardRules` (key, alignment, base price, `playPrice(target, config)`, `canApply(target,
  effectsOnTarget)`, `validateConfig(config)`, and the effects already on a target, so combinations are possible
  later).
- `instances/divided-world/cards/stick-around.ts` (config: the certification sentence, bounded in length) and
  `whoops.ts` (config: a color; the play price from the target's length; strokes bounded in count and size).
- `supabase/migrations/0005_cards.sql`: `card_ledger` (cards bought and played per account, append-only);
  `effect_state` (the Whoops! strokes: written only by the target post's author, never an Act's payload, "Append-only");
  `buy_card()` and `play_card()` debit the wallet in the same transaction and refuse a card the player does not hold.
- **Tests first:** a play price at 499, 500 and 6,000 characters (the last at the 3.00 cap); a color that is not one
  is refused; only the post's author can save strokes; buying with too little Aura is refused and writes nothing.

### Task 11. BBCode

- `engine/bbcode/parse.ts`: BBCode to a tree of allowlisted nodes (bold, italic, underline, strike, color, size,
  url, img, quote of an Act, code, list); everything else stays text.
- **Tests first:** `[url=javascript:…]` and `[img]` with a `data:` or `javascript:` source become text; unclosed and
  badly nested tags close safely; a quote names an Act by id and survives nesting.

### Task 12. Seasons, Turns and the reveal

- `supabase/migrations/0006_seasons.sql`: `seasons`; `turn(character, class, loudness)` checks the cooldown, writes
  `class_history`, and writes a public Act only when announced. The reveal job
  (`supabase/functions/reveal/index.ts`) posts The System's reveal thread at the season's end, with each character's
  class history, and opens the next season.
- **Tests first:** a silent Turn writes no public Act and no public column changes; the reveal includes the silent
  Turn; a Turn inside the cooldown is refused, and the refusal says when it can be made.

### Task 13. Live updates

- After each write, the Edge Function broadcasts the public projection on the thread's channel (a new Act, a new
  tally). `supabase/migrations/0007_realtime.sql` publishes no table with a private column.
- **Tests first:** an SQL test that lists the Realtime publication's tables and fails on any table with an owner,
  class, reactor or wallet column.

### Task 14. Registration and characters

- Invite-only registration (`registration_mode` in the settings); invites; creating a character with a class.
- **Tests first:** sign-in, sign-up and reset give the same response and timing for an address with an account as for
  one without; a seventh character is refused.

### Task 15. Export and import

- `tools/export-instance.mjs` and `tools/import-instance.mjs`: every table, private ones included (an admin's act).
- **Tests first:** an instance seeded with players, characters, Acts, reactions, cards, settlements and a reveal,
  exported and imported into a fresh schema, is the same instance, table by table ("Portable by construction").

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A reader held by Stick Around | The certification checkbox; a vigorous enough scroll |
| A post under Whoops! | Any reader scrubs it on their own screen; the author washes it for everyone |
| A Turn inside the cooldown | Time: the refusal says when |
| An empty wallet | The next settlement |
| A season ended | The next season opens with the reveal |
| An invite not yet used | The inviter can send another (an expiry is the screens session's to show) |

## What could vary with a private fact, and how it does not

- `react()`'s refusal for one's own character reaches only the player who owns it.
- `characters_public`, `acts_public`, tallies and standings carry no owner, class or reactor; standings move only at
  a settlement.
- Wallets and the owner's live preview are read only by their own account.
- Sign-in, sign-up and reset answer every address alike.
- Realtime carries only public projections; presence is not in this slice.

## Review focus

- A private column reaching the client by a path no test lists: a view joined later, an error message carrying a row,
  an Edge Function returning more than the projection.
- The settlement at a busy instance's scale: one window with many players, characters and reactions, timed, and
  whether it needs batching per character.
- Two settlement runs at once, or one retried after a partial failure.
- A player's two characters reacting at the same instant: the cap and the self-reaction refusal under concurrency.
- The live preview and the settled result disagreeing for the same window.
- The Lurker's "early" and "ends up" when a post keeps drawing reactions after the settlement.
- Whoops! strokes: their size bound, and an author saving faster than the debounce.
