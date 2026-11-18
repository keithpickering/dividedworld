# Loser Leaves Town: plan

Record, written 2026-11-13. The plan for `docs/plans/2026-11-13-loser-leaves-town-design.md`, built by one build
session in one PR, from `main`. It leans on card notes Part 6 as built (`docs/plans/2026-11-11-card-notes-part-6-plan.md`:
Off Day's window, `scored_as_plays`, the `scored_as` record), the Mod Bots plan's warn bar and appeals
(`supabase/migrations/0104_warn_bar.sql`, `0109_appeals.sql`, `0135_group_appeals.sql`) and
`docs/plans/2026-11-03-settle-claim-design.md` (a window is settled once, by one run).

Every task is test first: the test named, its red run recorded, then the code. No `tools/check-*.mjs` is added; each
new validation in `instanceProblems` and `card_kinds_problem` is driven red by a poisoned card in its own tests. No
deployed database, bucket or connector is touched; SQL is tested against Postgres on localhost.

**Migrations.** The highest migration on this date is `supabase/migrations/0343_surface_face_up.sql` and the highest
SQL test is `supabase/tests/0291-surface-face-up.sql`. This plan writes one migration at the next free number,
`NNNN_duels.sql`, in sections by task, and SQL tests from the next free number in `supabase/tests/`. Take the numbers
when the branch is cut and again after any merge of `main`. Each function replaced is copied from its latest
definition (search case-insensitively), changing only what this plan names, its lock order kept. As this is written
they are:

| Function or object | Latest definition |
|---|---|
| `acts_warn_guard`, `warn_points`, the constraint `acts_ban_payload`, the index `acts_bans` | 0104:86, :247, :57, :67 |
| `banned_until`, `infract`, `punishment_words` | 0109:204, :219, :280 |
| `punishment_running`, `appeal_hearer`, `open_appeal`, `close_appeal` | 0135:111, :126, :151, :241 |
| `reach_effects`, `staff_set_card` | 0148:84, :1623 |
| `play_card`, `card_ended`, `reverse_card` | 0149:790, :461, :470 |
| `scored_as_plays`, `apply_settlement` | 0151:1071, :1423 |
| `my_bans` | 0157:98 |
| `card_kinds_problem` | 0316:44 |
| `place_cast`, `lay_sprung`, `card_target` | 0317:749, :1144, :986 |
| `seed_instance` | 0332:300 |
| `spring_facts`, `thread_page`, `profile_page`, `record_page`, `log_page` | 0340:879, :1712, :1840, :1879, :1970 |
| `next_settlement_at` | 0014:15 |

**The layers.** The engine names no card. It gains one neutral piece, a **duel**, chosen by a card's rules
(`CardRules`, `engine/rules/cards.ts`) and held again in the catalog (`card_kinds`). Loser Leaves Town, its numbers,
words, form, mark and art are instance content under `instances/divided-world/`. `tools/check-engine-boundary.mjs`
holds throughout.

**The world** (`docs/plans/2026-10-29-two-worlds-design.md`). No screen or flow is added. The card shows on the board
as a mark on two postbits, as a play on a character does on one (the game's own piece, so it may take the card's
color), and the ban shows as any ban does. Everything a player reads about it is the glass's and plain: the Lens, the
log, the alert, the Vending Machine's words, the appeal form. None of it is in character and none of it bluffs.

## The card

| | Loser Leaves Town |
|---|---|
| Key | `loser-leaves-town` |
| Type (engine play) | Move (`cast`) |
| Flavor, rarity | Salty, legendary |
| Reach | a character |
| Names | nothing |
| Stack | one live duel per character, on either side; a rest of 7 days after a window closes |
| Lasts | the one window after the next settlement |
| Pays | nobody |
| Bans | the side that settled lower, or both on a tie, for 3 days, off the ladder |
| Play price | 0 |
| Machine | hidden, 500; pulled from the Booster, as Off Day |

## Task 1. The rules: a duel (engine)

Model: sonnet

**Files:** `engine/rules/cards.ts`, `engine/rules/cards.test.ts`, `engine/rules/instance.ts`,
`engine/rules/instance.test.ts`.

- `CardRules.duel?: { readonly banDays: number; readonly restDays: number }`, beside `scoresAs` (cards.ts:237). Its
  comment: a cast card that reaches a character alone; its play pairs the caster's character with the target for the
  one settlement window after the next settlement; at that window's settlement the side whose settled sum is lower is
  banned for `banDays`, both on a tie; each side then rests `restDays` before another duel. Whether the window can be
  named, and whether either side is free, are the server's, which reads the settlements, the bans and the duels.
- `staffOffers` (cards.ts:716) answers false for a duel card, with the comment that a staff character's Acts are not
  settled, so it has no sum to compare.
- `decidePlay` gains nothing: every duel rule reads the settlements or another character's state, and is SQL's (Task 3).
- `instanceProblems` (`playProblems`, where `scoresAs` is held, instance.ts:602), in the engine's words naming the
  card: `duel` only on a cast card whose reaches are `['character']`; `banDays` and `restDays` whole numbers from 1 to
  365; not beside `scoresAs`, `skim`, a gimmick or `needsMessage`.

Tests first: each rule red on a poisoned card (a duel on a post card, on a use card, `banDays` 0, `restDays` 1.5, a
duel beside `scoresAs`), then green; `staffOffers` false for a duel card with an empty configuration; a well-formed
duel card passes `instanceProblems`.

## Task 2. A ban that comes from a play, off the ladder (SQL)

Model: sonnet

**Files:** `supabase/migrations/NNNN_duels.sql` (new; this task's section), `supabase/tests/NNNN-play-ban.sql` (new).

A ban today is written only by `infract` and names the infraction that filled the bar. This task lets a ban name a
card play instead, and keeps such a ban out of everything the warn bar counts.

1. **`acts_ban_payload`** (0104:57): the payload holds exactly one of `infraction_act` and `play_act` (a uuid string),
   and with `play_act` a `duel` object: `{ "caster": uuid, "target": uuid, "caster_amount": integer,
   "target_amount": integer }`. Everything else as written.
2. **`acts_warn_guard`** (0104:86): a ban with `play_act` must name a `card` Act in the ban's thread whose card kind
   is a duel and whose caster (`character`) or target (`payload ->> 'character'`) is the banned character. A ban with
   `infraction_act` is held as today. The words: `a ban follows an infraction of the same character, or a duel it was
   in, in its thread`.
3. **`play_ban(who uuid, play uuid, days integer, facts jsonb)`**, the second writer, callable by no API role: locks
   the character as `infract` does, sets `kayfabb.warn_writer` for the one insert, and writes the ban in the play's
   thread with `until` its own time plus `days`, `season` as `infract` reads it, `play_act` and `duel`. It answers the
   ban's id and `until`.
4. **Off the ladder.** A helper `ban_from_bar(b acts) returns boolean` (`b.payload ? 'infraction_act'`) is the one
   definition, used by:
   - `warn_points` (0104:247) and `punishment_running` (0135:111): "landed after its last ban" reads the last ban from
     the bar only, so a play's ban does not empty the bar;
   - `infract` (0109:219): `prior` counts bans from the bar only, so a play's ban is no rung.
   `banned_until` (0109:204) is unchanged: it already takes the latest end among every running ban, read through each
   ban's ruling, which is the overlap the design decides.
5. **`appeal_hearer`** (0135:126) is unchanged: a ban is heard by the Boss, else the Mod on the beat of the board the
   ban's thread is on, and a play's ban sits in its play's thread.

Tests first: a ban with neither act, with both, and with `play_act` and no `duel`, each refused by the constraint; a
`play_act` naming a play of a card that is no duel, a play in another thread, and a play the character was not in,
each refused by the guard in its words; `play_ban` outside the service refused; a character with 6 warn points and a
play's ban still has 6 points, and its next full bar is banned for the ladder's first step; a character with one
ladder ban and one play's ban is next banned for the second step; a ladder ban of 1 day and a play's ban of 3 days
running together give `banned_until` the later end; `not_banned` refuses the character with that end in its words;
0104's and 0109's own tests pass unchanged.

## Task 3. The catalog and the cast (SQL)

Model: sonnet

**Files:** `supabase/migrations/NNNN_duels.sql` (this task's section), `supabase/tests/NNNN-duel-cast.sql` (new).

1. **The catalog.** `card_kinds` gains `duel jsonb`; a check constraint holds it to a cast card whose reaches are
   `{character}` with the two whole numbers; `card_kinds_problem` holds Task 1's rules again in the engine's words;
   `seed_instance` writes it.
2. **`duel_sides`**: `(play uuid references acts, character uuid references characters, opens timestamptz,
   closes timestamptz, primary key (play, character))`, two rows per duel, with an index on `(character, closes
   desc)`. Insert only (no update, no delete, by the pattern `play_reach` uses), row security on and no policy. It is
   the one place every reader asks "is this character in a duel, and when did its last one close".
3. **`duel_of(who uuid)`**, stable, callable by signed-in players (it answers public facts): the character's live
   duel, if any (a side row whose `closes` is after now and whose play no admin ended), with the play, the other
   side, `opens` and `closes`; and `duel_rest_until(who uuid)`: the latest `closes` among its sides whose play no
   admin ended, plus that play's card kind's `restDays`, or null where that is past.
4. **`place_cast`** (0317:749), on a character, for a duel card, after the existing checks and before the write. Each
   refusal's words name characters by their public names and read only public facts:
   - the caster is a staff character, or the target is: `22023`, `a staff character earns no Aura, so it cannot be in
     <card>`;
   - the target is the caster's character: `22023`, `a character cannot play <card> on itself`;
   - the target is banned (`banned_until`): `55000`, `<name> is banned until <until, UTC>, and a banned character
     cannot be in <card>`;
   - the window, exactly as a scored-as card's (0151, "Task 4, 4"): `opens := next_settlement_at(now())`, refused
     where it is null or where the open season ends at `opens`, in Off Day's two sentences; `closes` as there;
   - either side has a live duel (`duel_of`): `23505`, `<name> is already in <card's name of that duel> until the
     settlement of <closes, UTC>`;
   - either side is resting (`duel_rest_until`): `55000`, `<name> was in <card> and rests until <time, UTC>`.
   The caster's side is checked before the target's, whoever owns either. Both characters are locked in id order
   before the reads, so two casts that cross cannot both land.
   The play is written as a scored-as play is: `ends` and `play_reach.ends_at` are `closes`, the payload carries
   `'starts', opens`, and the two `duel_sides` rows are written with it.
5. **`reach_effects`** (0148:84), for a character: also the live duel plays in which the character is the caster's
   side (through `duel_sides`), so both postbits carry the mark. Each duel effect carries `'against', <the other
   side's character id>` and `'starts'`. `card_target` (0317:986) sends the same for the play.
6. **Face down.** A duel card set face down as a Move springs on a quote as any Move does: `spring_facts` (0340:879)
   reads, for every back alike, whether the window can be named and whether the setter's character and the quoting
   character are each free, unbanned, not staff and not the same; the card lands only when all hold (otherwise the
   back stays set, as a Move that cannot land does), and `lay_sprung` (0317:1144) writes `starts`, `ends` and the two
   sides as `place_cast` does.
7. **An admin's end.** `reverse_card` (0149:470) needs no change to end a duel before its window closes; the migration's
   header says that `duel_of`, `duel_rest_until` and Task 4's `duel_plays` each leave an ended play out. It refuses a
   play that "has worn off" by its `ends`, which for a duel is the window's close.

Tests first (each refusal's words asserted; every case that could turn on an owner run twice, once with the two
characters of one account and once of two, with the same answer and the same rows written): a cast lands with `starts`
and `ends` the next two settlements and two side rows; itself, a staff target, a banned target, a caster in a duel, a
target in a duel, a resting caster and a resting target each refused; a rest that ended lets the cast land; an
admin-ended duel leaves both sides free at once; a retired target is cast on exactly as a live one; the season's first
window and its last refused in Off Day's words; two crossing casts (A on B, B on A) in two sessions land exactly one;
`reach_effects` answers the play for both characters and for no third; `card_kinds_problem` red on each poisoned row
of Task 1's list.

## Task 4. The settlement decides it (SQL)

Model: sonnet

**Files:** `supabase/migrations/NNNN_duels.sql` (this task's section), `supabase/tests/NNNN-duel-settled.sql` (new),
`supabase/tests/e2e/0001-settlement.ts`.

`settle()` (engine/rules/settle.ts) is not changed: nothing about a duel reads a class, a vote or an owner. The result
is read from what the settlement has just written.

1. **`duel_plays(window_start, window_end)`**, the one place that says which duels a window decides, written as
   `scored_as_plays` is (0151:1071): the plays of duel cards made inside the last settled window that ended at or
   before `window_start`, not ended by an admin before `window_end`, with caster, target, the card key and its
   `banDays`. Callable by no API role.
2. **`duel_results`**, the record of what a settlement decided: `(settlement, play, caster, target, caster_amount
   integer, target_amount integer, caster_ban uuid null, target_ban uuid null, primary key (settlement, play))`,
   append-only by the ledger's triggers' pattern, row security on and no policy.
3. **`apply_settlement`** (0151:1423), after the `standings` insert and the `scored_as` insert, in the same
   transaction: for each row of `duel_plays(window_start, window_end)`, in play order, each side's amount is
   `coalesce(sum(ledger.amount), 0)` over that character's rows of this settlement (every reason, card payouts
   included: it is what the standing moved by). The lower side is banned through `play_ban` for the card's `banDays`,
   both where the amounts are equal, with the `duel` facts on each ban, and the row is written to `duel_results` with
   the bans' ids. A retried window answers "already settled" before any of this, as today.
   A side that is a staff character cannot occur (Task 3); a character deleted or retired is summed as any other.
4. **The reads.**
   - `my_duels`: the caller's own characters' `duel_results` rows (either side), with the settlement's `starts_at` and
     `ends_at`, the play's card key, both public names, both amounts and each ban's `until`; `log_page` (0340:1970)
     sends them as `duels`. `my_bans` (0157:98) carries `play_act` and `duel` beside `infraction_act`.
   - `thread_page` (0340:1712), `profile_page` (:1840) and `record_page` (:1879), wherever a ban is read for its
     notice or its row: a ban with `play_act` sends the play's card key and its `duel` facts in place of the
     infraction's rule and band. A ban is a public Act, and these are the two public sums.

Tests first:

- A lower caster is banned and the target is not; a lower target likewise; equal amounts at zero and at a nonzero
  sum ban both; a negative sum loses to zero; amounts include a card payout entry.
- The ban's `until` is its own time plus `banDays`, its thread the play's, and its `duel` facts the two sums.
- An admin's end before the window closes: no row, no ban. A play made in the window being settled is decided by the
  next settlement, never this one.
- A run that settles two missed windows in turn decides the duel in exactly one of them.
- A retried `apply_settlement` of the window writes no second row and no second ban.
- A side banned by `infract` mid-window is still decided, and its two bans overlap.
- `my_duels` for the caster's account, the target's and a bystander's: the bystander's is empty; each side's row holds
  both amounts; no key ties a character to an account but the caller's own.
- e2e (`0001-settlement.ts`): two players; a cast in one window, a second window in which one earns more, settled
  through `runSettlement`; the loser's character is refused a post with the ban's end in the refusal, the loser's other
  character posts, the winner posts; three days on (the clock moved as the file's other cases move it) the loser posts.

## Task 5. The appeal of a play's ban (SQL, the staff function)

Model: sonnet

**Files:** `supabase/migrations/NNNN_duels.sql` (this task's section), `supabase/tests/NNNN-duel-appeal.sql` (new),
`supabase/functions/staff/appeal.ts`, `supabase/functions/staff/appeal.test.ts`.

- **`open_appeal`** (0135:151): where the punishment is a ban with `play_act`, the details it hands the judgment are
  `{ kind: 'ban', by_card: <the card's name from card_kinds>, against: <the other side's public name>, amount: <this
  side's>, against_amount: <the other's>, tied: boolean, days, until, filed_at }` and no `band`, `points`, `rule` or
  `filed_by`. Its order, locks, budget and price are unchanged. `punishment_words` is not called for it.
- **`close_appeal`** (0135:241): unchanged in what a verdict does to a ban; its test here proves each verdict on a
  play's ban. An overturned play's ban bans nobody else and changes no `duel_results` row (the record is what the
  settlement decided; `banned_until` reads the ruling).
- **`appeal.ts`**: the dossier type (appeal.ts:55-58) takes the optional fields above; the part of the prompt that
  states the punishment says, for a ban with `by_card`: that the character lost (or tied) a card another character
  played, the two settled amounts, and that the ban is the card's and not a rule's. The verdict is still one of the
  fixed four and no free text is read as a choice.

Tests first: SQL: an appeal of a play's ban by the banned character is opened, heard by the Boss, and each of the four
verdicts moves `banned_until` as it does for a ladder ban; the winner cannot appeal it (the existing words for a
punishment that is another's); a second appeal is refused; the ladder is unchanged by an overturned play's ban.
`appeal.test.ts`: the prompt for a play's ban holds the card's name, both amounts and no rule; a ladder ban's prompt
is word for word what it was.

## Task 6. The act function, the API and the fake backend (functions, engine)

Model: sonnet

**Files:** `supabase/functions/act/core.ts`, `core.test.ts`; `engine/ui/data/api.ts`, `engine/ui/data/fake.ts`,
`fake.test.tsx`; `engine/ui/cards/types.ts`; `engine/ui/data/log-page.ts`; `engine/ui/types.ts`.

- `act/core.ts` needs no new argument. Its tests gain: each of Task 3's refusals comes back as a plain refusal with
  its words.
- `CardPlay` and the effect a postbit is given (`engine/ui/cards/types.ts`) gain `against?: Id`; `api.ts` reads it and
  `starts` from `reach_effects` and `card_target`, reads a ban's `play_act` and `duel`, and the log's `duels` rows.
- The fake backend plays the same rules in the server's words: the refusals, the two sides, the mark on both
  postbits, and a settlement that bans the lower side (the fake's settle, where it writes `scoredAs`).

Tests first: `fake.test.tsx` cases mirroring Task 3's and Task 4's lists, one per rule.

## Task 7. Divided World's card, the machine and the pack (instance)

Model: inline

**Files:** `instances/divided-world/cards/loser-leaves-town.ts` (new), `instances/divided-world/cards/index.ts`
(`listed`, the header comment), `instances/divided-world/cards/cards.test.ts`, `instances/divided-world/machine.ts`
and its test.

```ts
export const loserLeavesTown: CardRules<Record<string, never>> = {
  key: 'loser-leaves-town',
  name: 'Loser Leaves Town',
  alignment: 'salty',
  rarity: 'legendary',
  reaches: ['character'],
  duel: { banDays: 3, restDays: 7 },
  lasts: { unit: 'day', count: 2 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(loserLeavesTown, target, effects, now),
  validateConfig: () => ok({}),
};
```

The header comment says what the card does, names the design, and says what is the settlement's (the result and the
ban) and what is the server's (the window, the sides, the rest). Its `lasts` is only the bound a character effect
needs, as Off Day's is; its true end is the window's. The machine: `{ item: { card: 'loser-leaves-town' },
availability: 'hidden', price: 500 }`, after Off Day. The Booster's weights are not changed.

Tests first, in `cards.test.ts`: the card passes `instanceProblems`, lands on a character, and `staffOffers` is false
for it; the machine's test gains its row with its red run.

## Task 8. The art (instance)

Model: inline (it needs Blender's Python module, which only the main loop has set up)

**Files:** `instances/divided-world/ui/cards/loser-leaves-town/` with `scene.py`, `art.webp`, `mark.svg` and
`art.json`, as `instances/divided-world/ui/cards/off-day/` holds them
(`instances/divided-world/ui/cards/README.md`; `specs/card-art.md`).

- `scene.py`: built on `rig.py` as every scene is. The subject, proposed for the owner's approval in this PR: a
  battered suitcase standing in the road at a town-limits sign, the town's lights behind it, in the subject zone of the
  upper half, with the top corners quiet.
- `art.webp`: its render at 1080 by 1680, lossy WebP at quality 90, at most 400 KB.
- `mark.svg`: a square silhouette that reads at 18 px: a suitcase.
- `art.json`: `off-day/art.json`, word for word.

Tests first: `node tools/check-card-art.mjs` red with the folder holding only `mark.svg` (record the refusal), then
green, with `art.webp`'s size and the picture itself in the PR.

## Task 9. The screens and the words (engine UI, instance UI)

Model: sonnet

**Files:** `instances/divided-world/ui/cards.ts`; `instances/divided-world/ui/index.test.tsx`;
`instances/divided-world/ui/hint-words.ts` if its test names every card;
`instances/divided-world/guide/strategy-guide.md`; `engine/ui/log/lines.ts`, `lines.test.tsx`;
`engine/ui/cards/plays.ts` and `Effects.tsx` (the Lens of a play with `against`); `engine/ui/postbit/Postbit.tsx` and
its test where a ban's reason is shown; the thread's ban notice where it words an infraction's rule; `engine/ui/cards/Forms.tsx`
(`BanAppeal`) where it words what is appealed; a story beside `engine/ui/cards/Reach.board.stories.tsx`.

`A` is the caster character's public name, `B` the target's, `X` the other side as seen from the reader. Every number
is read from the card's rules, never restated in a string.

**The `CardUi` entry** (`cards.ts`; Salty's pink, `#ff3d7f`, ink `#14030a`; no form, since the card names nothing):

- `tagline`: `One of you is leaving.`
- `summary`: `Cast on a character. For the one settlement window after the next settlement, your character and theirs are matched. Whichever settles lower is banned for 3 days. A tie bans both.`
- `status`: before the play's `starts`, `Faces X next window`; from then, `Facing X now`.
- `hint`: `A Loser Leaves Town bans whichever of two characters earns less Aura in one settlement window.`
- `describe`: `A Salty card, legendary, cast from any post by the character it lands on. From the next settlement until the one after it, your character and that one are matched, and everyone can see it on both. At that second settlement, whichever of the two earned less Aura in the window is banned for 3 days; if they earned the same, both are. The ban is that character's alone, does not touch its warn bar and does not count toward a longer ban. It ends by itself, and it can be appealed like any ban. A character can be in one at a time, and rests for 7 days after one. <setMoveWords("the quoting post's character")> It costs nothing more to play.`
- `logPlay` (given `starts` and `ends`): `From the settlement of <starts, UTC> to the settlement of <ends, UTC>, A and B are matched. Whichever earns less Aura in that window is banned for 3 days; a tie bans both.`

**The log** (`engine/ui/log/lines.ts`; engine words, naming the card through the instance's name):

- **Both sides, at the cast:** the played line and the "A card on your character" line (lines.ts, where a play on a
  character is worded) each end with `logPlay`.
- **Both sides, at the settlement** named by a `duels` row, a row of its own at the settlement's end. What:
  `<card>: A against B was decided`. Details, one of:
  - `A settled at <a> and B at <b> in this window. <loser> earned less and is banned until <until, UTC>.`
  - `A and B both settled at <a> in this window. A tie bans both, until <until, UTC>.`
  then, for the reader whose character was banned: `The ban is on <name> only. Its warn bar is unchanged and this does not count toward a longer ban. It ends by itself at that time, and you can appeal it once.`
  and for the reader whose character was not: `<name> is not banned.`
- **The ban row** (lines.ts:656) for a ban with `duel`: What stays `<name> was banned`; its details say
  `<card>, against X: <name> settled at <own> and X at <other>.` in place of the rule's words, and keep the sentence
  that the ban is on that character only.
- Amounts are shown as Aura is everywhere in the log.

**The board.** The thread's ban notice and the postbit's BANNED reason, for a ban with `duel`: `Lost <card> to X` or,
on a tie, `Tied <card> with X`, where a ladder ban names its rule. These are the game's own pieces on the board and
state public facts.

**The appeal form** (`BanAppeal`): where it says what is appealed, a play's ban reads `the ban from <card>`.

**The Strategy Guide** (`strategy-guide.md`, approved by the owner in this PR's review): where it says how a ban
comes about, one sentence that a ban usually comes from a full warn bar, and that one card bans whichever of two
characters earns less in a day, off the bar. The generated card list (`<!-- kayfabb:cards -->`) picks the card up.

Tests first: `index.test.tsx` (the card has a face, a status within the Lens's word rules, and words true to the
rules' numbers: retune `banDays` and `restDays` in a test and see both said); `lines.test.tsx` (each line above, word
for word, for the caster, the target, a loss, a win and a tie); the postbit's and the notice's words for a play's ban
and, unchanged, for a ladder ban; the story's two postbits both carry the mark.

## Task 10. The export round-trips, and a duel in a browser (SQL, e2e)

Model: sonnet

**Files:** `supabase/tests/e2e/0003-export.ts`; `tools/instance-files.mjs` if it lists tables by hand; `e2e/` (a
spec beside `e2e/fold.spec.ts`, and `e2e/board-stories.test.ts` for the new story).

Tests first: the export fixture holds a duel play with its two `duel_sides` rows, a `duel_results` row and a ban with
`play_act`, and the imported instance is the same table by table, with `banned_until` and `duel_rest_until` answering
the same on both. In a browser, on the stories: the mark on both postbits is reachable by keyboard, its Lens names the
opponent and both times, and axe finds nothing.

## Last. The full build, the issue and the final review

`npm run typecheck`, then `npm run build`, its tail in the PR. A comment on #315 says that a ban may now name
`play_act` in place of `infraction_act`, and that the reversal it designs must read both. Then the final reviewer,
briefed with Review focus.

## Ways out

- **A bonded character** is decided by itself at the settlement that closes its window, at a time the play, the Lens
  and both logs state. An admin's end of the play before then (`reverse_card`) means nothing is compared, nobody is
  banned and neither side rests.
- **A resting character** is free by itself `restDays` after its window closed, and each refusal states the time.
- **A character the card banned** is free by itself after `banDays`, at a time the ban, the refusal and the log state;
  or by an appeal to the Boss (Task 5). An admin's reversal of any ban is #315, not built here.
- **A refused play** writes nothing; the card stays with the player, and the refusal says what is in the way and
  until when.
- **A face-down duel card** that cannot land when quoted stays set, and returns to the hand at `setLasts` as any
  Reversal or set Move does.

## The masks

- **The cast's refusals** read `banned_until`, `duel_sides`, the characters' staff flag and when The System settles:
  public, and the same for every caster. The checks run in one order whatever the owner of either character, and both
  characters are locked whoever owns them.
- **The same work for one's own character.** A duel between two characters of one account writes the same rows, the
  same marks and the same alert as any other, and Task 3's tests assert it.
- **The alert** to the target's player for a play on their character is the existing one for a play on a character,
  with the caster's account as its actor, so a play on one's own other character tells nobody.
- **The result** is computed only inside `apply_settlement`, from ledger rows that settlement wrote, and shows as two
  sums that each equal what a public standing moved by. Nothing live is computed from it, and no estimate names an
  opponent's amount.
- **`my_duels`** is bounded by the caller's own characters; the same facts are public on the ban Act for a banned
  side, and public by subtraction of standings for the other.
- **Retirement** is read nowhere here.

## A busy instance

- **A cast:** two probes of `duel_sides` by character, two of `acts_bans`.
- **A thread's page:** one probe of `duel_sides` per character on the page, beside the probe of `play_reach` it
  already makes.
- **`apply_settlement`:** the duel plays of one window through `acts_card_created`, and for each, two reads of the
  settlement's ledger by character. A character is in one duel at a time and rests a week, so a window's duels are at
  most half its characters.
- **The log:** `my_duels` reads by the caller's characters.

## Decided in planning

- The engine's piece is called a duel, and its two numbers are in the card's rules.
- The result is computed in SQL inside `apply_settlement` from the ledger, not in `settle()`: it reads no class, vote
  or owner, and it must equal what the standings moved by.
- A ban from a play names `play_act` and carries the two sums on the Act, so every public reader words it from the
  ban alone.
- "Off the ladder" is one predicate, `ban_from_bar`, read by the bar, the ladder and `punishment_running`.
- An admin-ended duel leaves no rest: it never ran.
- The rest runs from the window's close, for both sides, whoever lost.
- The window and its refusals at a season's edges are Off Day's, word for word.
- The card can be set face down like any Move.
- An overturned appeal frees the appellant and bans nobody else.
- The card is hidden in the machine at 500 and pulled from the Booster at legendary, as Off Day is.

## Review focus

- **Bans an instance already holds.** `acts_ban_payload` is replaced over existing ban Acts: every ban written by
  `infract` must still pass, and the export of an instance with ladder bans must import under the new constraint.
- **The bar and the ladder.** Every reader of "the character's last ban" and "this season's bans" (search for
  `kind = 'ban'`): is any left counting a play's ban as a rung, or emptying the bar on it?
- **A second run, a late run.** `duel_plays` is read inside `apply_settlement` only; a run that settles two missed
  windows, a retried window and two overlapping runs each decide a duel exactly once and write one ban per loser.
- **A retuned `settlementLength`** between the cast and the window: the play's `starts` and `ends` were written at
  the cast, the settlement decides it in the window after the one it was cast in; what the Lens and the rest then say.
- **Crossing casts.** A on B while B casts on A, and A on B while C casts on A: the lock order, and that no pair of
  plays leaves a character in two duels.
- **A mask slipping.** Timing and writes of a cast on one's own character against a stranger's; the alert; the order
  of refusals when both sides are unfree; anything in a response that differs with a retired side.
- **What two sums prove.** A duel publishes nothing but a ban and two amounts that standings already give. Read a
  very quiet window (one reactor) against "A response never proves a private fact" and the design's acceptance.
- **Farming and forcing.** A caster who earns nothing to force a double ban on a silent character; a player who bonds
  two of their own characters; Off Day stacked on a bonded character. Each is accepted in the design: is any cheaper
  or more repeatable than the rest and the rarity suggest?
- **A busy instance.** A thread page of 40 characters each in a duel; a window with a thousand duels (explain the
  reads in `apply_settlement`).
- **The appeal's prompt.** That a play's ban reaches the Boss with true facts and no rule, and that a ladder ban's
  prompt did not change.
