# Cosmetics: avatar gear, trophies and belts, and Random Events: plan

Record, written 2026-11-04. The plan for `docs/plans/2026-11-04-cosmetics-design.md`. One build session builds it in one
PR from `main`, **after the booster packs plan (`docs/plans/2026-11-04-booster-packs-plan.md`) is merged**, since Task 4
moves that plan's draw into a shared function and adds a kind to its `card_held`. #35 and #209 track the ideas; this PR
closes neither (each keeps what is still open: public events, Minus Balls, trading).

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added.

**Three migrations**, each taking the next free number in `supabase/migrations/` when it is written: `NNNN_gear.sql`
(Task 2), `NNNN_trophies.sql` (Task 3) and `NNNN_random_events.sql` (Task 4). Their SQL tests take the next free numbers
in `supabase/tests/`. All run against Postgres on localhost (`npm run test:sql`).

The boards are `docs/research/2026-11-04-cosmetics/` (01 to 05), confirmed by the owner. Their art is a placeholder.

## The shapes, exactly

In `engine/rules/cosmetics.ts` (new, engine):

```ts
import type { Rarity } from './cards.ts';

/** A piece of gear an instance offers. Its art is the instance's UI (`InstanceUi.gear`). */
export interface GearRules { readonly key: string; readonly name: string; readonly line: string; readonly rarity: Rarity }

/** A trophy kind the instance's code defines. Admin-made kinds live in the database only. */
export interface TrophyRules { readonly key: string; readonly name: string; readonly line?: string; readonly belt?: true }

export interface TrophyCatalog {
  readonly kinds: readonly TrophyRules[];
  /** The trophy for first, second and third place at a season's end, by key. */
  readonly seasonPlaces: readonly [string, string, string];
  /** The kinds the Boss may give with AWARD_TROPHY (belts included). */
  readonly boss: readonly string[];
  /** The kind every counted character gets when a move's demand is met. */
  readonly demandMet: string;
}

/** A line a Random Event can say. `{item}` is replaced by the found item's name. */
export interface EventLine { readonly key: string; readonly outcome: 'line' | 'gear' | 'card'; readonly text: string }

/** A piece as worn: fractions of the portrait (center x of its width, center y of its height, width of its width). */
export interface Piece { readonly gear: string; readonly x: number; readonly y: number; readonly w: number; readonly turn: number; readonly layer: number }
```

Plus pure functions, used by the fake, the dress-up page and the instance check:
- `pieceProblem(piece, settings)`: `x` and `y` within 0..1 (the center lies on the portrait), `w` within 0.05..1.5,
  `turn` within −180..180, `layer` a whole number 0..`gear.wornMost`−1. Returns the failed predicate's name or null.
- `outfitProblems(pieces, held, wornElsewhere, settings)`: more than `gear.wornMost` pieces, two pieces on one layer, or
  a gear worn more times than the account's free copies allow. Each problem names its gear.
- `inSquare(piece, squareFrame)`: the piece's place in the square's coordinates (the square's frame is fractions of the
  portrait, as `engine/ui/profile-edit/frames.ts` holds it).
- `beltHolder(awards)`: the latest standing award's character, for the fake.

`Instance` (`engine/rules/types.ts:614`) gains `gear: readonly GearRules[]`, `trophies: TrophyCatalog` and `events: {
lines: readonly EventLine[] }`. `InstanceUi` (`engine/ui/types.ts`) gains `gear: Record<string, { art: string; aspect:
number }>` (the art's height over its width) and `trophies: Record<string, { art: string }>`, placed as card faces are.

**Settings** (engine defaults, in a new `Settings.cosmetics`, each a setting the season review may replace):

| Key | Default |
|---|---|
| `gear.wornMost` | 12 |
| `gear.reach` | 0.4 (of the portrait's width, past each edge) |
| `trophies.shownMost` | 3 |
| `events.windowMinutes` | 15 |
| `events.dayMost` | 4 (in a rolling 24 hours) |
| `events.outcomes` | `{ line: 70, gear: 20, card: 10 }` |
| `events.gearRarity` | `{ common: 80, uncommon: 17, rare: 3 }` |
| `events.cardRarity` | `{ common: 80, uncommon: 17, rare: 3 }` |

**Divided World's starting content** (`instances/divided-world/gear.ts`, `trophies.ts`, `events.ts`, new):
- **Gear**: Baseball Cap (common), Mustache (uncommon), Shades (common), "I Really Wish I Weren't Here" Button (rare),
  Nostalgic Hat (rare). Names and lines are placeholders the owner replaces with the Minus World gear. Art: each item's
  SVG from `docs/research/2026-11-04-cosmetics/art.svg`, copied to `instances/divided-world/ui/gear/` as placeholders.
- **Trophies**: Season Champion, Season Runner-Up, Season Third (the places); Boss's Pet and Employee of the Month (the
  Boss's); Met the Boss's Demand; the Hardcore Belt (a belt, also on the Boss's list). Art as the boards' badges.
- **Event lines**: the line-only lines are #35's ("You touched the statue.", "Delayed due to Bird Migration.", "This was
  intentional.", "Pointless lag may occur for no reason.") and three gear and three card lines in board 04's manner ("You
  found a {item} under a park bench. It smells like nachos.", "A postcard was stuck to your shoe. It's a {item}."). The
  owner approves the lines in review.

## Task 1. Gear, trophies and events as instance content (engine rules, instance)

Model: sonnet

**Files:** `engine/rules/cosmetics.ts` (new) and its test; `engine/rules/types.ts`; `engine/rules/instance.ts`
(`instanceProblems`, :211); `engine/ui/types.ts`; the three instance files above, `instances/divided-world/index.ts` and
`instances/divided-world/ui/index.ts`; `engine/rules/test-system.ts` and the engine's neutral test instance, which gain
neutral fixtures (no Divided World words in an engine fixture).

**`instanceProblems` adds:**
- a gear or trophy key repeated, or a gear key equal to a card key (the log's lines name both);
- `seasonPlaces`, `boss` or `demandMet` naming an unknown trophy kind;
- `demandMet` or a season place that is a belt;
- an event line with an outcome that has no line, or a `gear`/`card` line without `{item}`;
- `events.gearRarity` or `events.cardRarity` naming a rarity with no item at it (the booster plan's rule: the odds are
  never a promise the draw cannot keep);
- a weight that is not a positive whole number;
- a gear with no art in `InstanceUi.gear`, or a trophy with none in `InstanceUi.trophies` (in the UI's own check,
  `instances/divided-world/ui/index.test.tsx`).

**Tests first:**
- `cosmetics.test.ts`: `pieceProblem` at each bound and one past it; `outfitProblems` refuses a 13th piece, two pieces on
  one layer, and a second Mustache worn where one copy is free; `inSquare` maps a piece at the portrait's top-left
  quarter into the square cut there; `beltHolder` returns the one before after the latest award is reversed.
- `instance.test.ts`: one fixture per problem above. Poison: `gearRarity: { legendary: 1 }` over gear with no legendary is
  a problem.
- Divided World's instance has no problems.

## Task 2. The wardrobe and the outfit in SQL (migration)

Model: sonnet

**Files:** `supabase/migrations/NNNN_gear.sql` and its SQL test; `supabase/functions/_shared/seed.ts`;
`supabase/functions/avatar/core.ts` and its test; `tools/instance-files.mjs` and `supabase/tests/e2e/0003-export.ts`
(the export round trip's seed rows).

**What the migration holds:**
- **`gear_kinds`** (`key`, `rarity`), seeded by `seed_instance` (latest `0062_updates.sql:272`, as amended by the
  booster plan's migration) from `Instance.gear`. A re-seed adds kinds and never deletes one a ledger row names.
- **`gear_ledger`** (`id`, `account`, `gear`, `kind` in (`found`, `granted`), `event uuid` (Task 4's, null for a grant),
  `at`), append-only with `ledger_append_only()` as `card_ledger` is (`0006_cards.sql:28-31`), with
  `(kind = 'found') = (event is not null)`. Read by its own account alone.
- **`gear_held(who uuid, gear text) returns integer`**: rows in. Trading adds rows out later; this is the one place that
  counts.
- **`gear_worn`** (`character`, `layer`, `gear`, `x`, `y`, `w`, `turn`), primary key (`character`, `layer`), with checks
  that hold `pieceProblem`'s bounds. Public through `profile_projection` (latest `0025_avatars.sql`), which gains
  `outfit`: the pieces in layer order.
- **`set_outfit(who uuid, through uuid, pieces jsonb)`**: `played_by(through, who)`; the character's row locked, then the
  account's other masks' `gear_worn` rows locked in id order (so two saves for two masks of one player go one after the
  other); refuses with `outfitProblems`'s words, in plain words, `hint = 'kayfabb.refusal'`; replaces the character's
  pieces in one statement. The refusals read the caller's own copies, and only the caller sees them.
- **`my_wardrobe()`**: the caller's gear with copies held and, for each, which of the caller's characters wear it.
- **`grant_gear(character uuid, gear text, copies integer)`**: `only_admins` (`0021:89`); 1 to 100 copies; writes
  `granted` rows to that character's account; returns `{ granted: copies }` whoever plays it.
- **`character_profiles.portrait_tallness`** (numeric, 1 to 2, null for an avatar written before it). The avatar function
  already reads the portrait's width and height (`readWebp`, `supabase/functions/avatar/core.ts:50`); `set_avatar`
  (latest `0025_avatars.sql`) gains the tallness, and `profile_projection` returns it.
- **A new portrait takes the outfit off.** `set_avatar` deletes the character's `gear_worn` rows when `portrait` is not
  null (a new portrait); a square recrop (`portrait` null) keeps them. `retire_character` (`0021_characters_listed.sql:96`)
  deletes them too.

**Tests first** (the SQL test):
- `set_outfit` refuses a second Mustache on a second mask when the account holds one, and names the gear; with two held
  it accepts both. Poison: a `gear_held` that counts every account's rows.
- Another account calling `set_outfit` through a character it does not play is refused as `played_by` refuses.
- A new portrait empties the outfit; a square recrop keeps it.
- `gear_ledger` cannot be updated or deleted.
- `my_wardrobe` returns the caller's rows only. Poison: a policy that lets an authenticated caller read `gear_ledger`.
- `grant_gear` by a player is refused; by an admin it returns the same answer for two characters of two different players.
- The export round trip carries `gear_kinds`, `gear_ledger` and `gear_worn`.

## Task 3. Trophies and belts in SQL (migration)

Model: sonnet

**Files:** `supabase/migrations/NNNN_trophies.sql` and its SQL test; `supabase/functions/_shared/seed.ts`; a new Edge
Function `supabase/functions/trophy-art/` (`core.ts`, `index.ts`, `core.test.ts`) modeled on the avatar function;
`tools/instance-files.mjs` (`BUCKETS` gains `trophies`); the export round trip.

**What the migration holds:**
- **`trophy_kinds`** (`key`, `name`, `line`, `belt boolean`, `made_by` null for the instance's or the admin's account
  for one made on the page, `art` null for the instance's or the file's key in the `trophies` bucket). The instance's
  kinds are seeded; an admin-made kind's key is generated and never collides with the instance's.
- **`trophy_awards`** (`id`, `trophy`, `character`, `at`, `by` in (`season`, `boss`, `demand`, `admin`), `act` (the move
  Act for `boss` and `demand`), `season` (for `season`), `line`), append-only. Never to a staff character.
- **`trophy_reversals`** (`award` primary key, `at`, `by` the admin's account), append-only. An award with a reversal no
  longer stands.
- **`trophies_of(character uuid)`**, public: the character's standing awards, newest first, each with its kind's name,
  line and art, who gave it in plain words ("the season", "Sighbot, the Boss", "a met demand", "an admin"; never which
  admin), and for a belt whether it holds it now.
- **`belt_lineage(trophy text)`**, public: each standing award of the belt in order, with when the reign began and ended.
- **`trophies_shown`** (`character`, `award`), at most `trophies.shownMost` rows a character, set by
  `show_trophies(who, through, awards uuid[])`, which refuses an award not the character's or not standing.
  `profile_projection` gains `trophies`: the shown standing awards, then every belt it holds.
- **`award_trophy(trophy text, character uuid, line text)`** and **`reverse_award(award uuid)`**: `only_admins`.
- **`make_trophy(name, line, art, belt)`**: `only_admins`; `art` is a key the `trophy-art` function stored.
- **The season's places.** `reveal_season` (latest `0073_core_loop_answers.sql:298`) writes one `season` award for each
  character at place 1 to 3 (by `rank()` as its reveal Acts do, so ties share a place), in the same transaction, after
  the reveal Acts.
- **A met demand.** `demand_contributors(move_act uuid) returns uuid[]`, owned by `kayfabb_digest` as
  `demand_progress` is (`0046_moves.sql:345`), reading the same public Acts per kind: for `postsOnBoard` and
  `distinctCharactersOnBoard`, the authors of the posts counted; for `quadrantOnBoard`, the authors of posts that drew
  that quadrant on their public tally; for `characterPostsInThread`, that character; for `crossQuote`, the pair. Staff
  are left out, as the count leaves them out. It **never reads `reactions`**, only `reaction_tallies`. `system_tick`
  (latest `0053_stored_progress.sql:120`), where it ends a move as `met` (:224-226), writes a `demand` award to each, in
  a block of its own so a failure is recorded and never undoes the end.
- **The `trophies` bucket**, public by URL and listed by nobody, as `avatars` is (`0025_avatars.sql`), WebP only, at
  most 16 KB and 48 by 48 pixels. The `trophy-art` function checks an admin's file with `readWebp` and stores it.

**Tests first** (the SQL test, and `trophy-art/core.test.ts`):
- A belt awarded to B while A holds it: `trophies_of(A)` shows it not held, `trophies_of(B)` held. Reversing B's award
  returns it to A. `belt_lineage` lists A, B in order.
- A reversed award leaves `profile_projection`'s `trophies` at once.
- `show_trophies` refuses a fourth, and an award of another character.
- `reveal_season` over a cast with a tie at second writes two Runner-Up awards and one Third.
- A met `quadrantOnBoard` demand credits the posts' authors. Poison: a `demand_contributors` that reads `reactions` (the
  test asserts the function's body names no `reactions` relation, and that a reactor who authored nothing gets nothing).
- `trophy_awards` and `trophy_reversals` cannot be updated or deleted. A player calling `award_trophy` is refused.
- `trophy-art` refuses a PNG, a 64-by-64 WebP, and a player's request.
- The export round trip carries the three tables and the bucket's files.

## Task 4. Random Events and the shared draw (migration)

Model: sonnet

**Files:** `supabase/migrations/NNNN_random_events.sql` and its SQL test; `supabase/functions/_shared/seed.ts` (the
settings and the event lines travel in the seed as the system's stock lines do); the export round trip.

**What the migration holds:**
- **`draw_by_rarity(pool text, weights jsonb, leaves text[]) returns text`**: draws a rarity by weight with `random()`,
  then a key uniformly among `card_kinds` (pool `card`) or `gear_kinds` (pool `gear`) at that rarity, less `leaves`.
  `buy_pack` (the booster plan's migration) is redefined to call it for each pull, with no change to what it writes.
- **`card_ledger.kind` gains `found`**, with an `event` column referencing `random_events` and
  `(kind = 'found') = (event is not null)`, price 0. `card_held` counts it in.
- **`random_events`** (`id`, `account`, `character`, `at`, `outcome` in (`line`, `gear`, `card`), `item`, `line`),
  append-only, read by its own account. Only events are rows.
- **`random_event_rolls`** (`account` primary key, `rolled_at`): the last roll, whatever it drew, updated on each roll.
  The window is read from it, never from the latest event, so a roll that drew nothing still closes the window.
- **`random_event(who uuid, through uuid) returns jsonb`**: `played_by(through, who)`; locks the account's
  `random_event_rolls` row; returns null when the last roll is inside `events.windowMinutes`, or when `events.dayMost`
  events stand in the last 24 hours. Otherwise it stamps the roll and draws an outcome by `events.outcomes`, whose
  optional `none` weight (default 0) is a roll that draws nothing and returns null. For `gear` and `card` it draws the item
  with `draw_by_rarity` and writes the `found` ledger row in the same transaction. It picks a line of that outcome
  uniformly, writes the event, and returns `{ event, outcome, item, rarity, line, character }`. It reads no other
  account.

**Tests first:**
- Two calls in one window: the second returns null and writes nothing. Poison: a window read from `now()` minus the
  latest *event* rather than the latest *roll*.
- With `dayMost` 2, the third roll in a day returns null.
- With `setseed()` and `{ gear: 1 }`, a roll writes one `found` gear row, and `gear_held` counts it.
- A `card` event adds to `card_held`. `buy_pack`'s seeded test from the booster plan still passes with the shared draw.
- Another account's `random_events` rows are not readable. A call through another player's character is refused.

## Task 5. The Boss's AWARD_TROPHY move (engine system, SQL)

Model: sonnet

**Files:** `engine/system/moves.ts`, `engine/system/meeting.ts`, `supabase/functions/meet/core.ts`, and Task 3's
migration (or a section of it) for the landing.

- **`AWARD_TROPHY`** in `MOVE_KINDS` (`moves.ts:100`): `structural: false`, `shapesBoard: false`, `askable: true`, params
  `{ trophy, character }` (`character` a uuid), plain words, a log template and `parts`, following `RENAME_BOARD` (:65).
  It carries no demand (a favor).
- **Limits**, each checked in `moveParamsProblems`, in the meeting's `repairAnswer` (`meeting.ts:335`), and again at
  landing in SQL, where a failure ends the move `reversed` with the reason recorded, as the booster plan's machine moves
  do: the trophy is on the instance's `boss` list; the character is not staff and is not retired; a trophy that is not a
  belt has not been given to that character in this season; a belt is not given to its holder.
- **The landing** writes a `boss` award naming the move's Act, and the move ends at once in the same transaction (its
  effect is the award, which outlasts it). An admin reverses the award on the trophies page (Task 11).
- **The meeting's reference text** (`referenceText`, `meeting.ts:237`) lists the Boss's trophies by key and name and each
  belt's current holder, read in `meet/core.ts` beside the other references. It reads `trophies_of` and `belt_lineage`
  only, never a wardrobe.

**Tests first:**
- `moves.test.ts`: each limit refused by `moveParamsProblems`, naming its predicate; `repairAnswer` drops an award of a
  trophy not on the list.
- The SQL test: a landed move writes one award and ends; a second award of Boss's Pet to that character in the same
  season is refused at landing; a belt award moves the belt.

## Task 6. The client (engine data, web adapter, fake)

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`, `engine/ui/player.tsx`.

- `Character` (`api.ts:195`) gains `portraitTallness: number | null`, `outfit: readonly Piece[]` and `trophies: readonly
  ShownTrophy[]` (`{ award, name, art, belt, held }`).
- New calls: `wardrobe(): Answer<WardrobeItem[]>`, `setOutfit(character, pieces)`, `trophies(character)`,
  `beltLineage(trophy)`, `showTrophies(character, awards)`, `randomEvent(character): Answer<RandomEvent | null>`, and for
  admins `grantGear`, `awardTrophy`, `reverseAward`, `makeTrophy` (which uploads through `trophy-art` first).
- The fake holds a wardrobe, outfits and awards, refusing with `outfitProblems` and passing belts with `beltHolder`, and
  rolls events from a scripted random.

**Tests first:** the adapter's `supabase.test.tsx` maps a profile's `outfit` and `trophies`; the fake refuses a piece
over the worn limit with the server's words.

## Task 7. One carousel (engine UI)

Model: sonnet

**Files:** `engine/ui/carousel/Carousel.tsx` (new) and its test; `engine/ui/characters/ClassCards.tsx`,
`engine/ui/characters/carousel.ts` (moved into the new folder).

Draw the class cards' carousel out of `ClassCards.tsx` as a component that takes its items and renders them: as many as
fit, the next peeking under a fade, arrows and a count ("1–4 of 5") while the row overflows, nothing hidden or inert, a
chosen item scrolled whole into view (at once under reduced motion). The radiogroup behavior stays the class cards' own.

**Tests first:** the class cards' existing tests pass unchanged; the new component's test shows the count and the arrows
for 30 items in a narrow row and none for 2.

## Task 8. Gear where the portrait is drawn (engine UI)

Model: sonnet

**Files:** `engine/ui/gear/Outfit.tsx` (new) and its test; `engine/ui/postbit/Postbit.tsx` (`Avatar`, :33) and
`postbit.css`; `engine/ui/profile/Avatar.tsx` and `profile.css`; the postbit's and profile's stories.

- **`Outfit`** draws a portrait (or the square) with its pieces: each piece an `<img>` of the item's art, positioned by
  its fractions, sized by its width and the art's `aspect`, rotated, stacked by layer. The whole is `aria-hidden`.
- **The tall slot** takes the portrait's shape from `portraitTallness` (an `aspect-ratio`), falling back to the image's
  own size for an avatar written before it. No `object-fit: cover` on the tall slot.
- **On the tall portrait** the pieces are clipped to a box `gear.reach` of the portrait's width past each edge, and the
  slot sits under the postbit's text: the name, title, rank, trophies and counts are on a layer above it, each run of
  text on `var(--kb-bg)` (board 01).
- **On the square** (the stacked band, a phone, lists), the pieces are mapped by `inSquare` and clipped to the square.
- A mask without a portrait draws its square or initial as today, and no gear.

**Tests first:** a piece at `x: 0.5, y: 0` sits centered on the slot's top edge; the tall slot's aspect ratio is the
portrait's tallness; a piece wholly below the square draws nothing on the square; the postbit's name is above the outfit
in stacking order (its computed `z-index`).

## Task 9. The dress-up page (engine UI, glass)

Model: sonnet

**Files:** `engine/ui/wardrobe/Wardrobe.tsx` (new), its test, story and CSS; `engine/ui/glass/nav.ts`
(`GLASS_NAV.wardrobe = '/wardrobe'`); `web/src/App.tsx` (the route); `engine/ui/characters/Characters.tsx` (a "Dress up"
link per character) and the HUD's menu (`engine/ui/frame/Hud.tsx`).

The look is board 02. The mask is chosen with a select of the player's own, opening on the HUD's, as profile edit does
(`engine/ui/profile-edit/ProfileEdit.tsx`). No address names a character the player plays.
- **The stage** draws the portrait with `Outfit` at a large size, the reach line dashed around it.
- **Placing:** drag a wardrobe item onto the stage, or press Enter on it, which places it at the center on the next free
  layer. A free copy is required; a wardrobe item with none free says so ("1 held · on Dr. Bones").
- **The selected piece** has four corner handles (size) and a round handle (turn), and the panel's buttons and keys do
  the same: arrows move by 1% (Shift: 5%), `+`/`-` size by 5%, `[`/`]` turn by 5 degrees, Bring forward, Send back, Take it
  off (Delete). Every pointer move has a button (CLAUDE.md, "An accessible path costs what the obstacle costs": this is a
  settings screen).
- **The square's preview** draws the same outfit through the square's frame.
- **The wardrobe** is the carousel (Task 7) of the account's items: art, rarity gem, name, copies held and where each is
  worn; the selected item's panel shows its line and where its copies came from.
- **Shown on posts:** a row of the mask's trophies with up to `trophies.shownMost` checked (`showTrophies`).
- **Save the outfit** sends the whole outfit; a refusal shows the server's words and keeps the arrangement.
- No portrait: the page says "Gear is worn on a portrait. Upload one in profile edit." with the link.

**Tests first:** placing by Enter puts a piece on the next layer; the arrow keys and buttons move, size, turn and layer
the selected piece within `pieceProblem`'s bounds; an item with no free copy cannot be placed and says why; Save sends
the pieces in layer order; reduced motion changes nothing about placing; an axe check over the page passes.

## Task 10. Trophies on posts and the profile's case (engine UI, board)

Model: sonnet

**Files:** `engine/ui/postbit/Postbit.tsx` and `postbit.css`; `engine/ui/profile/Profile.tsx` and `profile.css`; their
tests and stories.

The look is boards 01 and 03; the profile's, in the house theme, `docs/research/2026-11-06-board-look/08-profile.html` (the Wearing row, the trophy case table and the belt's lineage as that board draws them).
- **The postbit**, side layout: under the rank, the shown trophies and any held belt, each an `<img>` with its name as
  `alt` and `title`. Stacked and on a phone: a held belt only, beside the name.
- **The profile:** "Wearing:" naming each piece's gear in words; the trophy case (`trophies(character)`), newest first,
  each with its giver and date in plain words and a link to the move or post where there is one; each belt's lineage
  (`beltLineage`) under the case.

**Tests first:** a fourth chosen trophy is not drawn; a held belt is drawn on the stacked band; the case names "an
admin", never an account; "Wearing:" lists the outfit in layer order.

## Task 11. The Random Event dialog and the trophies admin page (engine UI, glass)

Model: sonnet

**Files:** `engine/ui/events/RandomEvent.tsx` (new) with its test and story; the board and thread pages that call it
(`engine/ui/board/Board.tsx`, `engine/ui/thread/Thread.tsx`); `engine/ui/admin/Trophies.tsx` (new) with its test and
story; `GLASS_NAV.adminTrophies = '/admin/trophies'`; `web/src/App.tsx`; the admin menu.

- **The dialog** (board 04): on a board or thread page's load, for a signed-in player, `randomEvent(hudCharacter)`. An
  answer opens the dialog through the glass's modal (`engine/ui/modal.tsx`): "SOMETHING HAPPENED!", the line with
  `{item}` filled, the item's art and its rarity in words, "It happened to {name}. Only you see this.", and Wear it (gear:
  opens `/wardrobe` on that mask with the item placed) or OK and Esc. A failed roll shows nothing. Focus returns to where
  it was.
- **The admin page** (board 05): award a trophy (a belt says it passes to the character), grant gear (copies), make a
  trophy (name, line, belt or not, a file the browser turns to WebP with `engine/ui/profile-edit/webp.ts` and uploads
  through `trophy-art`), and recent awards with Reverse. A player is refused, in SQL and on the page, as the queue does.

**Tests first:** the dialog names the item, its rarity and the mask, and Esc closes it; no answer opens nothing; the admin
page refuses a player; a reversed award leaves the list's standing rows.

## Task 12. The log and alerts

Model: sonnet

**Files:** `engine/ui/log/lines.ts` and its test; `engine/rules/alerts.ts` and the alerts' writer in SQL (Task 3's
migration); `instances/divided-world/` copy for the alert words.

- **Log lines** (`LineKind` gains `found`, `gearGranted`, `trophy`, `beltLost`):
  - "Something happened to Pipewrench: you found a Baseball Cap (common gear)." / "... a Trap Card (uncommon card)."
  - "An admin gave you 5 Mustaches, through Dr. Bones."
  - "Pipewrench was given Boss's Pet by Sighbot, the Boss." / "... Season 1 Champion, for first place." / "... Met the
    Boss's Demand, for posting toward it."
  - "Pipewrench lost the Hardcore Belt to Sock Puppet, by Sighbot's move."
  - A reversed award: "An admin took back Pipewrench's Boss's Pet."
- **Alerts:** `WRITTEN_KINDS` gains `trophy` and `beltLost`, written to the character's player when an award or a lost
  belt lands.

**Tests first** (`lines.test.tsx`, `alerts.test.ts`): each line above from its rows; a `beltLost` alert to the old
holder's player when the belt passes.

## Last. The full build and the final review

`npm run build:ci` and `npm run typecheck`, with their output. Then shots of the postbit with gear and trophies (side and
stacked), the dress-up page mid-arrangement, the profile's case, the event dialog, and the admin page, for the owner's
word.

## Ways out of the states this adds

- **A worn piece:** taken off on the dress-up page any time; a new portrait or a retirement takes it off.
- **A belt held:** the Boss's move, an admin's award or reversal. Holding it is a reward.
- **A trophy shown:** unchecked on the dress-up page; a reversal removes it.
- **The event dialog:** OK, Esc, or Wear it.
- **A day's events spent:** the rolling 24 hours.

## The masks

- `gear_ledger`, `random_events`, `random_event_rolls` and `my_wardrobe` are read by their own account alone.
- `gear_worn`, `trophy_awards` and the belts are public, read by character.
- `set_outfit`'s refusals read only the caller's copies and reach only the caller.
- `grant_gear` answers the same whoever plays the character; the admin page names no account.
- `demand_contributors` reads public Acts and `reaction_tallies`, never `reactions`.
- The meeting reads trophies and belts, never a wardrobe.
- `random_event`'s answer and timing depend only on the caller's own rolls. No Realtime event is added.

## Review focus

- Two saves of outfits for two masks of one player at once: the lock order in `set_outfit` keeps a single copy from being
  worn twice, and never deadlocks.
- The side postbit's change from a 1:2 cover box to the portrait's own shape, on every thread page: no layout shift
  where the tallness is stored, and posts by masks without a portrait unchanged.
- At a busy instance, a thread page draws each item's art once however many masks wear it; `profile_projection`'s
  outfit and trophies cost a lookup by character, never a scan of awards.
- `demand_contributors` on a large board: it reads only Acts since the move landed, as `demand_progress` does.
- `system_tick` ending a move as met when its awards fail: the end stands, the failure is recorded.
- `buy_pack` after the shared draw: the same rows and order as before.
- Text over gear: no text on the postbit is hidden by a piece in any theme, including high contrast.
- Event lines, gear names and trophy names are the instance's, with no Divided World word in an engine file or fixture.
