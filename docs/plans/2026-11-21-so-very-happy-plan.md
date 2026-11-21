Record, written 2026-11-21.

# SoVeryHappy, a Reversal that locks a non-Sweet Move's character out of the thread: plan

Carries out `docs/plans/2026-11-21-so-very-happy-design.md`. One PR from `main`.

**May start** once this plan merges, **and only after** the Cheap Shot build
(`docs/plans/2026-11-20-cheap-shot-plan.md`) has merged. It redefines `card_kinds_problem`, `spring_traps` and
`place_cast`, which this plan redefines too. It may not start while any other build redefines an object in the table
below. Its key, `so-very-happy`, falls in the shared slot between `publicity-tour` and `stick-around`. Required
Reading has merged, and Ratio waits for this build.

**The shared SQL this build redefines.** Each one is copied whole from its latest migration on `main` **at the time the
build starts**, and again if `main` moves before it merges, with only the named change. Find each latest with
`grep -l -E "function (public\.)?<name>\(" supabase/migrations/*.sql | tail -1`, a constraint with
`grep -l "constraint <name>" supabase/migrations/*.sql | tail -1`, and the view with
`grep -l "view my_characters" supabase/migrations/*.sql | tail -1`. Where Cheap Shot's build or a later one changed an
object, keep its change.

| Object | Latest on `main` today | Change |
|---|---|---|
| `card_kinds_outcome_set` (constraint) | `0397_refund_outcome.sql` | the outcome kind takes `lockout` |
| `acts_spring_payload` (constraint) | `0397_refund_outcome.sql` | `('cast', 'lockedOut')`, and `locks` and `until` only and always on one |
| `card_kinds_problem(cards jsonb)` | `0397_refund_outcome.sql` (Cheap Shot redefines it) | the lockout outcome's checks |
| `spring_traps` | `0397_refund_outcome.sql` (Cheap Shot redefines it, with one more argument) | `did: 'lockedOut'`, `locks`, `until` |
| `place_cast` | `0397_refund_outcome.sql` (Cheap Shot redefines it) | `not_locked_out` before the back; `lockedOut` lands |
| `place_set` | `0397_refund_outcome.sql` | `not_locked_out` for the post's thread |
| `post(uuid, uuid, text, uuid, uuid[], jsonb)` | `0395_polls.sql` | `not_locked_out` for `in_thread` |
| `write_staff_act` | `0393_forged_quotes.sql` | `not_locked_out` for a `post` |
| `reverse_card` | `0349_thread_page_under.sql` | also ends a live `lockedOut` spring |
| `thread_page` | `0396_poll_reads.sql` | each person's `locked_until` for this thread |
| `my_characters` (view) | `0147_reveal_once.sql` (re-grep; the bars column came in `0138`) | a `lockouts` column |
| `pool_context` | `0339_thread_places_at_scale.sql` | a `lockouts` list of `{ staff, thread }` |

**New objects:** `lockout_ends(spring uuid)`, `locked_out_until(who uuid, in_thread uuid)`,
`not_locked_out(who uuid, in_thread uuid)`, and the partial index `acts_lockout_by`. `seed_instance` is **not**
redefined: the outcome lives in the `trap` column it already seeds.

**The migration** is named `NNNN_thread_lockout.sql`, with its test `supabase/tests/NNNN-thread-lockout.sql`. `NNNN`
is one above the highest number in `supabase/migrations/` on `main` **at the time this build merges** (0397 today, so
it would be 0398, but Cheap Shot's build takes a number first). Rebase and renumber if `main` moves.

Every task goes test first: write the failing test, record its red run, then the code. During a task, run only the
tests for the changed code (`npx vitest run <file>`, `node --experimental-strip-types --test <file>` for the rules'
tests, or `node tools/test-sql.mjs <file>` for one SQL test). Run `npm run typecheck`, `npm run build` and
`npm run test:sql` once after the last task, with the tails in the PR. No deployed database, bucket or connector is
touched. SQL tests run against Postgres on localhost.

**The layers.** Tasks 1 to 6 are the engine's: the `lockout` outcome, its checks, the SQL, the chatter's skip, the
fake, the data, the screens and the words. Nothing there names a card or a class. Task 7 is Divided World's, carried
in through `CardRules`, `CardUi` and `AlertCopy.trapStruck`.

**The world.** The LOCKED OUT stamp is drawn on the postbit in the board's house style (a 2003 message board:
Verdana, black and white, beside the BANNED stamp, in its look). The reply box's and the play form's notes are the
glass's plain words, as `BannedNote` is. The card's face and sheet are the glass.

**Copy rule.** In every new sentence a player reads, the verb for a card is "play" and the noun is "Move". Never
"cast", even where the sentence beside it in the same function says "cast".

## Task 1: the `lockout` outcome in the rules

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/instance.ts`, and their tests `engine/rules/cards.test.ts` and
`engine/rules/instance.test.ts`.

1. `cards.ts` (the trap type, about :290-300): add `LockoutOutcome = { readonly kind: 'lockout'; readonly hours:
   number }`. The outcome becomes `RideOutcome | { readonly kind: 'refund' } | LockoutOutcome`. Extend its doc comment
   (a lockout lets the Move land and locks its character out of the post's thread for `hours`).
2. `instance.ts`, `outcomeProblems` (about :755-771): a `lockout` branch that refuses a missing or non-whole `hours`
   and one outside 1 to 168, in the function's own words ("{who} locks out for {hours} hours; a lockout is a whole
   number of hours from 1 to 168"). The catch-all becomes "an outcome is ride, refund or lockout". A lockout takes no
   `share` and no `every` (refuse them, as the refund branch does).
3. `decideSet` (cards.ts about :651): its quadrant guard stays for a ride alone. Check that a lockout set with config
   `{}` decides.
4. `staffOffers` (cards.ts about :876-891): leave it. A lockout falls through like a refund, so a lockout card is
   offered to a Mod Bot persona where the pool reaches its rarity (design 2.1). Add a test that says so.

**Tests first:** in `instance.test.ts`, beside the refund cases (about :852-928), a lockout of 24 passes, and each
poison is refused with its words: `hours` 0, 169, 1.5 and missing; a `share` on a lockout; `kind: 'lock'`. In
`cards.test.ts`, `decideSet` of a lockout back with `{}`, and `staffOffers` offering it.

## Task 2: the SQL

Model: sonnet

**Files:** `supabase/migrations/NNNN_thread_lockout.sql`, `supabase/tests/NNNN-thread-lockout.sql`.

The migration opens with a header comment that names this plan and the design and lists each object with its change,
as `0397_refund_outcome.sql`'s header does. It also says that the lockout is a new state and names its ways out
(the spring's `until`, and an admin's `card_end` on the spring).

1. `card_kinds_outcome_set`: drop and add again with `in ('ride', 'refund', 'lockout')`.
2. `card_kinds_problem`: in the outcome checks, the kind list takes `lockout`. A lockout takes `hours` alone, a whole
   number from 1 to 168. Use the same words as Task 1's `outcomeProblems`, and keep the grants.
3. `acts_spring_payload`: drop and add again with `('cast', 'lockedOut')` in the pairs, and `'locks'` and `'until'` in
   the allowed keys. `locks` is a string and `until` a timestamp string, both present exactly when `did` is
   `lockedOut`. Every existing line stays.
4. `spring_traps`: the `did` case maps `lockout` to `lockedOut`. On a `lockedOut` spring the payload adds
   `'locks', f.by_character::text` and `'until', now() + make_interval(hours => (f.kind_trap #>> '{outcome,hours}')::int)`.
   A lockout back is **not** passed over for a staff cast (the refund's `actor is null` line stays a refund's alone).
   It writes no `card_ledger` row. Keep the signature, so keep Cheap Shot's extra argument if it has merged.
5. New: `acts_lockout_by`, `create index acts_lockout_by on acts (thread, (payload ->> 'locks')) where kind = 'spring'
   and payload ->> 'did' = 'lockedOut';`.
6. New: `lockout_ends(spring uuid) returns timestamptz`: `least((payload ->> 'until')::timestamptz, (select
   min(e.created_at) from acts e where e.kind = 'card_end' and e.target_act_id = spring))` for a `lockedOut` spring,
   null for anything else. Stable, security definer, with the same grants as `ban_ends`.
7. New: `locked_out_until(who uuid, in_thread uuid) returns timestamptz`: the max `lockout_ends` over the thread's
   `lockedOut` springs whose `locks` is `who`, where that end is still ahead. Same grants as `banned_until`.
8. New: `not_locked_out(who uuid, in_thread uuid) returns void`: raises, with hint `kayfabb.refusal` and errcode
   `55000`, "%s is locked out of this thread until % UTC; the lockout ends by itself then, and it holds only this
   character, not your other characters". The first placeholder is the character's name. The time is rounded up to
   the minute and formatted as `not_banned` does. Same grants as `not_banned`.
9. `post`: `perform not_locked_out(through, in_thread);` right after `not_barred`.
10. `place_cast`: `perform not_locked_out(caster, in_thread);` once `in_thread` is known for a post, thread or
    character reach, **before** `spring_traps` is called and before anything is written. A board reach is not asked.
    `lands` takes `lockedOut` beside `rode` and `returned`.
11. `place_set`: `perform not_locked_out(setter, <the post's thread>)` after the post's row is read.
12. `write_staff_act`: for `kind = 'post'` with a thread, `perform not_locked_out(who, write_staff_act.thread);`
    before the insert.
13. `reverse_card`: the row read becomes a card play **or** a spring whose `did` is `lockedOut`. For such a spring,
    "that card has already worn off" is asked of `(payload ->> 'until') <= now()`, and the play-only checks (`caught`,
    `ends`, `play_reach`, `keeps`, `card_write_refunds`) are skipped. "An admin has already ended that card" is asked
    as before. The `card_end` insert, the `cardEnded` alert to `p.character` (the setter) and the answer are as
    before. Check that `acts_well_formed` and any `card_end` guard take a `card_end` whose target is a spring, and
    loosen them in this migration if not, naming that in the header.
14. `thread_page`: each person's character object gains `'locked_until', locked_out_until(c.id, <the thread>)`.
15. `my_characters`: a `lockouts` column, `coalesce(jsonb_agg({thread, until}) over the character's live lockedOut
    springs, '[]')`, read through `lockout_ends`.
16. `pool_context`: a `lockouts` key, `[{ staff, thread }]` for every staff character's live lockout.

**Tests first**, in `NNNN-thread-lockout.sql`, each red before the migration exists. Use the fixtures the
`0397-refund-outcome.sql` test uses.
- A seeded lockout card passes `card_kinds_problem`. Poisons: `hours` 0, 169 and missing, and a `share` on a
  lockout. Each is refused with its words.
- Character A sets the lockout back on its post. Character B plays a Salty common Move on that post. The Move lands
  (its card Act has no `caught`), and the spring has `did = 'lockedOut'`, `locks = B`, and `until` 24 hours on.
- B then: `post` in the thread is refused with the lockout words. `play_card` on another post of the thread is
  refused. A thread-reach `play_card` on the thread is refused. A character-reach play from B's post there is refused.
  `place_set` on B's own post there is refused. `edit_post` of B's earlier post there lands. `post` in another
  thread, quoting a post of the locked thread, lands. A spin off a post there lands. A reaction lands.
- B's other character (same owner) posts in the thread: lands.
- A Sweet Move on a fresh lockout back: no spring. A legendary Salty Move: no spring. A Pepperoni rare: springs.
- A Move that carries a reply springs the lockout and still writes its reply.
- A staff persona's `staff_play_card` of a Salty Move springs it, and its `write_staff_act('post')` in the thread is
  then refused.
- `reverse_card` on the spring as an admin: `locked_out_until` is null at once, and B posts. A second
  `reverse_card` is refused. A non-admin is refused. `reverse_card` on a `caught` spring is still refused.
- Time travel past `until` (as the ban tests do): B posts, and `reverse_card` says "worn off".
- `thread_page` shows B's `locked_until` while it is up and null after. `my_characters` as B's player lists the
  lockout, and as A's player shows none for B.
- `pool_context` lists the staff persona's lockout.
- Every spring row already in the fixtures still passes `acts_spring_payload`.

## Task 3: the chatter skips locked threads

Model: sonnet

**Files:** `engine/system/pool.ts` (`PoolContext`, `candidates` at about :137), its test, and
`supabase/functions/chatter/core.ts` (where `pool_context` is read and passed, about :240).

`PoolContext` gains `lockouts: readonly { staff: string; thread: string }[]`. `candidates`' `add` drops a candidate
whose `staff` and `thread` are in it. A candidate with no thread (starting a thread) is never dropped. `core.ts`
passes the field through, and a context without it reads as `[]`.

**Tests first:** a persona with a reply candidate in thread T and a lockout on T gets no candidate there. It keeps its
candidates in other threads, and another persona keeps its candidate in T.

## Task 4: the data, the fake and the play model

Model: sonnet

**Files:** `engine/ui/data/api.ts` (`Character` at about :725, `MyCharacter` at about :1283, the spring payload type),
`web/src/data/supabase.ts` (`toCharacter` about :1044, `toMyCharacter` about :581), `engine/ui/data/fake.ts` and
`engine/ui/data/fake.test.tsx`.

1. `Character.lockedUntil?: string`, parsed from `locked_until`. `MyCharacter.lockouts?: readonly { thread: string;
   until: string }[]`, parsed from `lockouts`.
2. The spring payload type gains `did: 'lockedOut'`, `locks?: string` and `until?: string`.
3. The fake does what the SQL does. Its cast (about :2360-2436) springs `lockedOut` for a lockout outcome, staff
   included, and writes `locks` and `until`. Its `post`, cast and set refuse in the SQL's words while locked out. Its
   `reverseCard` (about :3827) ends a live lockout spring. Its thread page and `myCharacters` carry the fields.

**Tests first**, in `fake.test.tsx` beside the refund cases (about :4360): the spring and its fields; the post
refused, then allowed after `reverseCard`; another character of the same account allowed.

## Task 5: the screens

Model: sonnet

**Files:** `engine/ui/postbit/Postbit.tsx` and `postbit.css`; `engine/ui/composer/Composer.tsx`, a new
`engine/ui/composer/LockedOutNote.tsx` and a hook `useLockedOutUntil(character, thread)` in a new
`engine/ui/composer/lockout.ts` (shaped as `ban.ts`'s `useBannedUntil`); `engine/ui/cards/PlayForm.tsx`;
`engine/ui/thread/Thread.tsx` (the live handler for Acts that arrive); `engine/ui/cards/Lens.tsx` (`endable`,
about :545). Tests beside each.

1. **The stamp.** In `Postbit` beside the BANNED stamp (about :132-137): while `c.lockedUntil` is ahead of
   `api.now()`, `<strong className="kb-postbit-locked">LOCKED OUT <span>until {shortDate(c.lockedUntil)}</span></strong>`.
   Its CSS is the BANNED stamp's look (house style, black and white). The time is visible text. A character both
   banned and locked out shows both.
2. **Live.** In `Thread.tsx`, a `spring` Act with `did: 'lockedOut'` that arrives sets `lockedUntil` on the person
   named by `locks`. A `card_end` whose target is such a spring clears it. The stamp also goes by itself when the time
   passes (re-render at `lockedUntil`, as `useBannedUntil` does).
3. **The reply box.** `useLockedOutUntil(hudCharacter, thread)` reads `MyCharacter.lockouts`. While it is ahead, the
   Composer shows `<LockedOutNote>` above the box and blocks sending, as it does for `BannedNote` (Composer about :165,
   :190 and :209). The note is `<p className="kb-notice kb-composer-lockout" role="status">`: "{character} is locked
   out of this thread until {time}. The lockout ends by itself then, and it holds only this character, not your other
   characters. You can switch to another in the HUD." A ban's note takes precedence where both hold.
4. **The play form.** For a post in that thread (or the thread, or a character from a post there), `PlayForm` shows
   the same note and adds the lockout to `blocked` (about :237). The Hand stays open.
5. **The admin's End.** `endable` lets an admin end a back whose spring is `lockedOut` and whose lockout is live. Every
   other face-down play stays unendable. The End dialog sends the spring's id to `reverseCard`.

**Tests first:** the stamp drawn and not drawn; the stamp set by a live spring and cleared by a live `card_end`; the
Composer blocked with the note's words and unblocked after the time passes; the play form blocked for a post in the
thread and not for a post elsewhere; `endable` true for a live lockout back as an admin, and false for a non-admin,
for an ended or past one, and for a caught back.

## Task 6: the engine's words

Model: sonnet

**Files:** `engine/ui/cards/land.ts` (`springWords`, about :122); `engine/ui/alerts/words.ts` (`trapSprang` about
:255-268, `trapStruck` about :154-190); `engine/ui/types.ts` (`TrapStruckFacts.how`, about :170);
`engine/ui/log/lines.ts` (`setEndRows` about :1159, `cardRows` about :790); `engine/ui/alerts/trap-reads.ts` and
`Toasts.tsx` where they switch on `how`. Tests beside each (`land.test.tsx`, the alert words' tests and
`lines.test.tsx` about :1299).

Each sentence branches on the outcome or the spring's `did`, never on a card's key. Each sentence is the engine's:
- `springWords`, for a lockout back: "It springs on the first Move played on your post that {the match's words}: the
  Move lands, and whoever played it is locked out of the thread for {hours} hours." Build the match's words from the
  match, as the other outcomes do. For two of the three flavors this reads "isn't Sweet, up to rare", named from the
  flavor left out, never a literal.
- `trapSprang` (the setter's alert), `did: 'lockedOut'`: "{Card} on {post} sprang when {caster} played {move} on it.
  {Move} landed, and {caster} is locked out of the thread until {time}."
- The setter's log line (`setEndRows`): the same sentence.
- `TrapStruckFacts.how` gains `'lockedOut'`, with an `until`. The caster's default `trapStruck` words: "The {card} on
  {post} locked {character} out of this thread until {time}."
- The caster's log line (`cardRows`): the same sentence, linked to the post.
- Where a log line or the toast says when the lockout was ended early by an admin, it says so plainly: "An admin
  ended it at {time}."

**Tests first:** each sentence for a lockout, with the time formatted as the other alert times are, and a test that
none of the new strings contains "cast".

## Task 7: the card

Model: haiku

**Files:** new `instances/divided-world/cards/so-very-happy.ts` and `so-very-happy.test.ts`; new
`instances/divided-world/ui/cards/so-very-happy/ui.ts` and `ui.test.tsx`; one line each in
`instances/divided-world/cards/index.ts`, `instances/divided-world/ui/cards.ts` and the price table in
`instances/divided-world/cards/cards.test.ts` (about :61), sorted by key between `publicity-tour` and `stick-around`;
the `trapStruck` voice in `instances/divided-world/ui/trap-words.ts` (about :9-26); and the describe table in
`instances/divided-world/ui/index.test.tsx` (about :1234).

Copy the shape of `pay-it-forward.ts` and `pay-it-forward/ui.ts`:

```ts
export const soVeryHappy: CardRules<Record<string, never>> = {
  key: 'so-very-happy',
  name: 'SoVeryHappy',
  alignment: 'salty',
  rarity: 'rare',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { flavors: ['salty', 'pepperoni'], upTo: 'rare' }, outcome: { kind: 'lockout', hours: 24 } },
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};
export const price: Hundredths = 300;
```

The `CardUi`: the art from the folder (`./art.webp?url`, `./mark.svg?url`, `./art.json`, already there), tagline
`Play it Sweet or get locked out`, summary `Set face down on your post. The first Move played there that isn't Sweet,
up to rare, lands, and whoever played it is locked out of the thread for 24 hours.`, status `Set, face down to
everyone else`, and `describe(settings)` with `setLastsWords`, as Pay It Forward's is. The art's `color` and `ink`
come from `art.json`.

The `trapStruck` voice for `how === 'lockedOut'`: heading `So very happy for you`, with the engine's sentence as its
body (keep the shape of the `returned` branch).

**Tests first:** the rules test (the card validates and decides a set with `{}`); the price row
`['so-very-happy', 'salty', 300]`; the ui test (tagline, summary, status, describe); the voice's lockout branch; and
`tools/check-card-art.mjs` passing for the folder.

## Review focus

- The Move that springs a lockout must land and write its carried reply. Check that `not_locked_out` in `place_cast`
  runs before `spring_traps`, and that nothing after the spring (the reply, the Lens, a refunds Gimmick) asks it again.
- A post that started before a lockout spring committed and commits after it lands. Check that nothing worse happens
  (no deadlock with `place_cast`'s lock order) and say it in the migration's header.
- `reverse_card` now takes a spring. Check that no reader of `card_end` (settlement's `ended` sets, `thread_page`'s
  `o_ends`, `card_ended`, the log) treats a `card_end` on a spring as the end of a card play, or breaks on one.
- The masks: the refusal, the stamp and the note must read only the public spring. Check that no answer or timing
  differs when the locked character's owner, rather than another player, tries a different one of their own
  characters.
- A busy instance: `locked_out_until` is asked on every post and play. Check that its plan uses `acts_lockout_by`
  (`explain` in the SQL test) and that `thread_page` asks it once per person on a page, not once per post.
- The chatter: a persona locked out of its only candidate thread must skip cleanly, with no paid call and no crash
  counted toward the poison-pill cap.
- Cheap Shot's merged versions of `card_kinds_problem`, `spring_traps` and `place_cast` must be kept whole, its
  `pierce` lines included.
