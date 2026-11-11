# Graffiti: plan

Record, written 2026-11-11. The plan for `docs/plans/2026-11-11-graffiti-design.md` (Part 7 of
`docs/plans/2026-11-11-card-notes-design.md`), built in one PR from `main`. Every task is test first: the test named,
its red run recorded, then the code. No deployed database, bucket or connector is touched. SQL is tested against
Postgres on localhost.

**Migrations.** This plan adds one migration and one SQL test file, each at the next free number in
`supabase/migrations/` and `supabase/tests/` when the task starts (0150 and 0156 on this date, after
`0149_card_writes.sql` and `0155-back-live-readers.sql`). The card notes' Parts 2 to 6 may be building at the same time
and may take numbers first, so take the next free ones again before the PR is opened. Each redefined function is
copied from its latest definition, named in the task, and changed only as the task says.

**The layers.** Tasks 1 to 6 are the engine's. They name no card, can or stencil, and Graffiti's words never appear in
`engine/` or `supabase/` (`tools/check-engine-boundary.mjs` holds throughout). Tasks 7 to 12 are Divided World's.

**The words this plan uses.** A **surface** is the engine's word for a play whose layer any character may add to. A
**wall** is Graffiti's surface. A **draw** is an Act adding strokes to a surface. A **wash** is an Act by the post's
character taking ink off. **Cells** are the 100 × 100 grid in shares of the post body's box. **Live** Acts are the draws
and washes a reader needs to draw the surface now (the design, section 3).

**Numbers** (the design's, settled here):

| | |
|---|---|
| Grid | 100 × 100 cells; a cell is covered when a draw's core covers its center and no later wash has taken it |
| Limit | `graffiti.limit`, whole percent, 1 to 100; Divided World 40 (4,000 cells) |
| A draw | at most 120 strokes, 300 points a stroke, 3,000 points in all, 64 KiB as Postgres writes it |
| A wash | the same bounds as a draw |
| Live draws on one surface | at most 48 (`surface.mostLive`); a draw that would make a 49th is refused (way out: wash, or paint over an old tag) |
| Points | shares to a ten-thousandth; `aspect` to three significant figures; `width` in (0, 0.25] of the box's width |
| Caps (Graffiti) | Skinny 0.006, Stock 0.016, Fat 0.04 of the box's width (the core) |
| Wash debounce | 1,500 ms after the author's last sponge stroke, or on leaving the post |
| Price | rare: `{ item: { card: 'graffiti' }, availability: 'hidden', price: 300 }`, as the rares of Parts 2 to 6 |

## Task 1. The surface's rules

Model: sonnet

**Files:** `engine/rules/surface.ts` (new), `engine/rules/surface.test.ts` (new), `engine/rules/cards.ts` (`CardRules`
gains `surface?`; new `decideDraw`, `decideWash`; `decidePlay` and `decideSet` carry a surface card's first draw).

`surface.ts` is pure and holds the engine's geometry:

```ts
export const GRID = 100;
export type Cells = Uint8Array;                 // GRID * GRID / 8 bytes, row-major, bit (y * GRID + x)
export interface SurfaceStroke { readonly width: number; readonly aspect: number; readonly points: readonly (readonly [number, number])[] }
export function cellsOf(strokes: readonly SurfaceStroke[]): Cells;   // a cell whose center lies inside a stroke's core
export function count(cells: Cells): number;
export function union(a: Cells, b: Cells): Cells; export function minus(a: Cells, b: Cells): Cells;
export function toBits(cells: Cells): string;   // Postgres bit(10000) text, '0'/'1', row-major
export function fromBits(bits: string): Cells;
```

The core of a stroke with `width` w and `aspect` a is the capsule swept by an ellipse with radii `w/2` across and
`w/2 · a` down, in shares (Whoops!'s brush, `docs/plans/2026-11-06-whoops-refinements-design.md`, section 3). A
single-point stroke is a dab.

`CardRules.surface`:

```ts
readonly surface?: {
  /** The `screenReads` key holding the limit, in whole percent of the cells. */
  readonly limitKey: string;
  readonly mostLive: number;
  /** A draw or a wash as the card keeps it, with the strokes the engine counts. */
  validateDraw(input: unknown): Verdict<{ readonly strokes: readonly SurfaceStroke[]; readonly payload: Record<string, unknown> }>;
  validateWash(input: unknown): Verdict<{ readonly strokes: readonly SurfaceStroke[]; readonly payload: Record<string, unknown> }>;
};
```

`decideDraw(rules, settings, input)` returns `{ payload, cells: toBits(...), most }`, where `most` is
`round(limit / 100 · GRID²)` from `settings.cardSettings[limitKey]`. `decideWash` returns `{ payload, cells }`. A card
with a surface is a cast card on a post with `stack: 1`, and an instance holding one otherwise is refused by
`engine/rules/instance.ts` (beside the `screenReads` check, l.415).

**Tests first** (`surface.test.ts`): a horizontal stroke across the middle covers row 50 and not rows 45 or 55 at a
width of 0.04; the same stroke at `aspect` 0.5 covers half as many rows; a dab at (0.505, 0.505) of width 0.012 covers
cell (50, 50) alone; `union`, `minus` and `count` on hand-built grids; `toBits` and `fromBits` round-trip, and
`toBits(empty)` is 10,000 zeros. In `engine/rules/cards.test.ts`: `decideDraw` refuses what `validateDraw` refuses with
its words, reads the limit from the settings, and refuses a card with no surface; the instance check refuses a surface
card with a stack of 2.

## Task 2. The surface in SQL

Model: sonnet

**Files:** `supabase/migrations/<next>_surfaces.sql` (new), `supabase/tests/<next>-surfaces.sql` (new),
`supabase/functions/_shared/seed.ts` (`surface: c.surface !== undefined` in the card row, l.41-51).

The migration, in its header's words and in this order:

1. **The kind.** `card_kinds.surface boolean not null default false`, written by `seed_instance` (latest 0149, l.1082).
2. **Two Act kinds, `draw` and `wash`.** Each targets the play's Act (`target_act_id`), takes no seq, and is by a
   character. The migration redefines these, each from its latest definition:
   - `acts_kind_check` (0148:672);
   - `acts_seq_check` (0148:677);
   - `acts_take_seq()` (0148:683);
   - `acts_check1` (0104:39), which needs a target for both kinds;
   - `acts_well_formed()` (0148:705), where a `draw` or `wash` is written only by the functions below, under a
     `kayfabb.surface_writer` flag, as the other writers' flags work.

   A payload check holds `strokes` as an array and `octet_length(payload::text) <= 65536`.
3. **The derived row.**

   ```sql
   create table surfaces (
     play uuid primary key references acts, post uuid not null references acts,
     cover bit(10000) not null, owners smallint[] not null,   -- owners[i] = 1-based index into live of the draw that last inked cell i, 0 for none
     live uuid[] not null,                                    -- the live draws and washes, oldest first
     most_live smallint not null, updated_at timestamptz not null);
   ```

   It is readable by `authenticated` (as `effect_state` is, 0006:166). It holds only what the Acts already say.
4. **The private draft.** `face_down_draws(play uuid primary key references face_down, payload jsonb, cells
   bit(10000))`, readable by nobody but the definer functions, as `face_down` is.
5. **The functions.** All are security definer, executed by `service_role` alone, and raise with the refusal hint.
   - **`open_surface(play)`** inserts the row with an empty cover. `place_cast` (latest 0148:153) calls it when the
     card's kind is a surface, so a play and its wall land together.
   - **`draw_on_surface(who, through, play, payload, cells, most)`**, in this order:
     1. `played_by`;
     2. `not_banned(through)`;
     3. `not_barred(through, the post's board)`;
     4. the play is a live surface on a post (not `card_ended`; "an admin ended that card");
     5. lock the row `for update`;
     6. `new_cover := cover | cells`;
     7. refuse past `most`, with the wall's own figures: `this wall is 31% covered, and its limit is 40%; this tag would
        take it to 46%`;
     8. refuse a 49th live draw: `this wall holds 48 tags; paint over one or wait for a wash`;
     9. insert the `draw` Act;
     10. `owners` for every cell in `cells` becomes the new draw's index;
     11. prune `live` (step 7 below);
     12. return the Act's projection with `{ covered, live }`.
   - **`wash_surface(who, through, play, payload, cells)`**: `through` is the post's character, owned by `who`. A
     retired author may still wash, as `save_effect_state` lets a retired author save (0038, latest 0149:502). Then
     `not_banned`, the live play, the lock, `cover := cover & ~cells`, `owners` set to 0 under `cells`, insert the
     `wash` Act, and prune. **A wash is never refused for the limit or the live count.**
   - **Pruning.** A draw stays live while it owns at least one cell. A wash stays live while some draw before it in
     `live` owns a cell under the wash's cells, which are read from the wash's own `payload.cells`. Indices in `owners`
     are renumbered after a prune.
   - **`play_surface_card(...)`**: `play_card`'s arguments (latest 0149:790) plus `first jsonb, first_cells bit(10000),
     most int`. It calls `play_card`, then `draw_on_surface` as the caster, in one transaction. A refused draw undoes
     the play.
   - **`staff_play_surface_card(...)`**: the same around `staff_play_card` (0149:834).
   - **`staff_draw_on_surface(staff_key, play, payload, cells, most)`**: a persona's draw on an open wall, with the
     persona checks of `staff_play_card`.
   - **`set_surface_card(...)`**: `set_card`'s arguments plus the draft, which is written to `face_down_draws`.
   - **`lay_sprung`** (latest definition, called at 0148:1095): when the card's kind is a surface, open the surface
     and write the draft as the first `draw`, by the setter, if it fits the limit as it stands then. Otherwise the wall
     opens bare, and the spring's payload says `drawn: false`. The draft row is deleted once read.
   - **`surface_acts(play)`** returns the live Acts' projections, oldest first, for a reader near the post.
   - **`rebuild_surface(play)`** computes the row from the play's Acts alone, for the test below and for import.
6. **`thread_page`** (latest 0149:150) returns `surfaces: { [play]: { covered, live } }` for the surface plays on the
   page. It returns ids and counts, never strokes.
7. **`card_target`** and `card_target_reach` show a surface's `covered` to the rules, so a second Graffiti is refused by
   `landsOn`'s stack.

**Tests first** (`<next>-surfaces.sql`, on its own cards `sfwall` with the surface flag, written as 0155 writes its
own):
- a play opens an empty surface;
- a draw covers its cells and returns `covered`;
- a draw over a covered cell adds nothing to `covered`;
- a draw past `most` is refused with the figures and writes nothing;
- two draws racing under the limit cannot both pass (two sessions, one waiting on the lock, as `0004-reactions-race.sql`
  races);
- a wash by the post's character uncovers its cells, and by anyone else is refused;
- a wash on a full wall lands;
- a draw wholly painted over leaves `live`, and a wash that cuts nothing live leaves it;
- the 49th live draw is refused;
- a banned or barred drawer is refused with `not_banned`'s and `not_barred`'s words, and a drawer playing the post's own
  author's other mask is not refused;
- an ended play refuses a draw and a wash;
- `rebuild_surface` equals the stored row after a mixed run of twenty Acts;
- a set surface card springs with its draft as the first draw, and a draft over the limit opens the wall bare;
- `thread_page` carries no strokes;
- an `update` of a `draw` Act is refused by `acts_append_only`.

The export round trip (`supabase/tests/e2e/0003-export.ts`) gains one wall with a draw and a wash in its fixture
(l.101-102), and passes.

## Task 3. The act function

Model: sonnet

**Files:** `engine/rules/actions.ts` (new actions `draw`, `wash`; `playCard` and `setCard` carry `first`),
`engine/rules/actions.test.ts`, `supabase/functions/act/core.ts` (`runAction`, `BROADCASTS` l.83-117),
`supabase/functions/act/core.test.ts` (or the file that tests `runAction` today), `supabase/functions/chatter/core.ts`
(l.367-393, `decideOptions` l.441), `engine/system/chatter.ts` (`OfferedCard` gains `walls?`).

- **`draw` and `wash` actions.**
  - They go `asService` with a new `needsSurface` flag. `runAction` reads `card_of_play`, refuses a card with no
    `surface` ("this card holds no wall"), runs `decideDraw` or `decideWash` with `withDatabaseSettings`, and calls
    `draw_on_surface` or `wash_surface`.
  - Neither is in `REPEATABLE` (l.124). A lost answer is said as lost, as a save's is.
- **`playCard` and `setCard` of a surface card** must carry `first`.
  - `runAction` decides the play as today, then the first draw with `decideDraw`, and calls `play_surface_card` or
    `set_surface_card`.
  - A surface card's play with no `first` is refused: "draw your tag first".
- **Broadcasts.** `draw_on_surface` and `wash_surface` send `{ topic: 'thread:<id>', event: 'surface', payload: { play,
  covered } }`. The strokes are never in the broadcast.
- **Mod Bots.**
  - The chatter pool's options for a surface card are the card's `staffConfigs` (Task 7: a stencil, a can, a spot),
    expanded into strokes by the card's `surface.validateDraw`. A persona's play goes through
    `staff_play_surface_card`.
  - A pool day may also offer open walls on its thread (`walls`: up to three live surfaces on the page it reads). A
    persona that picks one draws through `staff_draw_on_surface` with a stencil.
  - `repairChatter` (l.155) drops a wall pick that names no offered wall.

**Tests first:**
- `actions.test.ts`: the two actions' shapes.
- The `runAction` test, with the fake database the file already uses:
  - a draw's limit comes from the settings rows, not the deployed code;
  - a draw on a non-surface card is refused;
  - a surface play without `first` is refused;
  - a wash's broadcast holds no strokes.
- The chatter test:
  - a persona's Graffiti play carries a stencil's strokes;
  - a wall pick that is not offered is dropped.

## Task 4. The surface on the page

Model: sonnet

**Files:**
- **Data:** `engine/ui/data/api.ts` (`ActKind` l.277; `draw`, `wash`, `surfaceActs`; `threadPage`'s `surfaces`);
  `web/src/data/supabase.ts` (l.1338-1347 beside `playCard` and `saveEffect`; `subscribeThread` l.1916 gains
  `onSurface`); `engine/ui/data/fake.ts` (`UNPLACED` l.385, and a fake surface that runs Task 1's model).
- **Plays and effects:** `engine/ui/cards/plays.ts` (`hydrate` l.430 takes `surfaces`; `WITHOUT_EFFECTS` l.456);
  `engine/ui/cards/types.ts` (`EffectProps`, `CardUi`); `engine/ui/cards/Effects.tsx`.
- **The thread:** `engine/ui/thread/Thread.tsx` (`absorb` l.175, the live handler near l.443), `engine/ui/thread/Post.tsx`
  (l.51), `engine/ui/spin/Origin.tsx` (l.60).

**`EffectProps` gains `surface`**, present for a surface card's plays:

```ts
readonly surface?: {
  readonly covered: number; readonly most: number;
  /** The live draws and washes, oldest first; null until read (fetched near the viewport). */
  readonly acts: readonly SurfaceAct[] | null;
  near(): void;   // ask for `acts` (once, then live)
  draw(play: Id, as: Id, input: unknown): Promise<Result<SurfaceAct>>;
  wash(play: Id, input: unknown): Promise<Result<SurfaceAct>>;   // as the post's character, refused for anyone else
};
```

`acts` is read by `surfaceActs` when the effect calls `near()`, and read again on a `surface` broadcast for that play.
A page of many walls reads only the walls near the viewport. `draw` and `wash` are refused in a moment (`still`), as
`save` is.

**Two engine interfaces, so two cards can hold ink on one post:**

- **`CardUi.beneath?: true`.** `PostEffects` nests a card with it innermost, whatever its play order, under every card
  without it. Among several, play order holds.
- **`EffectProps.ink`**: `{ claim(hit: (x: number, y: number) => boolean): () => void; topAt(x: number, y: number):
  boolean }`.
  - Each effect that holds ink claims a hit test with its post's registry (one per `PostEffects`).
  - `topAt` is true for the outermost claimant whose hit test is true at that point, in client px.
  - An effect starts a stroke only where `topAt` is true. So a press on a splat over a wall scrubs the splat, and a
    press beside it scrubs the wall.
  - Whoops!'s `Effect.tsx` adopts it in Task 9.

**Draw and wash Acts are not posts.** `Post.tsx`'s switch draws nothing for them. `WITHOUT_EFFECTS` includes them.
They never take reactions, since the Reactions row is drawn only for kinds that take them. Task 6 adds the Lens rows.

**Tests first:**
- `Effects.test.tsx`: a `beneath` card nests inside a later card without it.
- `ink.test.tsx` (new): `topAt` answers for the outer of two claimants, and for the inner one where the outer has no ink.
- `plays.test.ts`: `hydrate` carries `surfaces`.
- `Thread.test.tsx`: a `surface` broadcast re-reads that play's acts only.
- `fake.test.ts`: the fake's limit refusal matches the SQL's words.

## Task 5. Drawing on the post: the compose slot

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`CardUi.Compose`), `engine/ui/cards/play.tsx`, `engine/ui/cards/PlayForm.tsx`,
`engine/ui/cards/Effects.tsx`, `engine/ui/cards/play.test.tsx`.

`CardUi.Compose?: ComponentType<ComposeProps>` is a card whose play is made on the post itself:

```ts
interface ComposeProps {
  readonly post: Act; readonly mode: 'cast' | 'set';
  readonly box: { readonly w: number; readonly h: number } | null;   // the post body's box, measured by the slot
  /** Lands the play: `first` is the card's first draw; `config` its configuration. */
  submit(config: unknown, first: unknown): Promise<Result<unknown>>;
  cancel(): void;
  readonly children: ReactNode;
}
```

- **Opening it.** When the armed card has `Compose`, pressing the post's ghost mark ("Play Graffiti on post N") does not
  open `PlayForm`. It mounts `Compose` in that post's effect slot, innermost (as `beneath` does), with `mode: 'cast'`.
  On the player's own post, Set mounts it with `mode: 'set'`.
- **`submit`** goes through the same `api.playCard` or `api.setCard` that `PlayForm` calls, with `first`, and shows the
  answer in the same status ("Playing a card"). A refusal stays in the toolbar, and the drawing is kept.
- **Ways out:** Esc, Cancel, the armed card pressed again, or leaving the page. With strokes drawn, leaving first asks
  "Leave without tagging? Your drawing isn't saved."
- **One compose at a time.** Arming another card, or opening a second compose, cancels the first after the same ask.

**Tests first** (`play.test.tsx`):
- a card with `Compose` mounts it on the pressed post, and `PlayForm` does not open;
- `submit` calls `playCard` with `first`;
- Esc with an empty drawing closes at once, and with strokes it asks;
- Set on one's own post mounts `mode: 'set'`.

## Task 6. The Lens and the log

Model: sonnet

**Files:**
- **The Lens:** `engine/ui/cards/Lens.tsx` (a surface play's tab), `engine/ui/cards/lens-words.ts`,
  `engine/ui/cards/lens.test.tsx`.
- **The log:** `engine/ui/log/lines.ts` (`LineKind` l.36ff, l.944), `engine/ui/log/lines.test.ts`; the migration of
  Task 2 gains two views beside `my_posts_written_on` (0149:1322), `my_draws` and `my_walls_drawn_on`, and `log_page`
  (0149:1339) reads them.

**The Lens**, for a surface play:
- below the play's own Who row, one row per live draw and wash, oldest first;
- for a draw, the character, the time, the colors the card names (`CardUi.describeDraw?(payload) => string`, Task 10)
  and its share of the wall now ("6% of the wall"), counted from `owners`, which `surface_acts` returns with each draw;
- for a wash, the post's character and "washed";
- under them, one line for the rest: "and 14 older tags, washed or painted over". The count comes from `surface_acts`
  (all draws on the play less the live ones).

**The log**, in plain words, from the instance's `CardUi.logDraw?` and `logWash?` with engine defaults:
- the drawer's own: "You tagged Spritey's post (6% of the wall)";
- the post's author: "Gloomba tagged your post (6% of the wall)";
- the author's wash: "You washed 9% of the wall off your post";
- the drawers whose tags it cut: "Spritey washed your tag on their post".

None of these lines names an owner or a class. A wash's line to a drawer is computed from the drawer's own draw and
the wash, both public Acts.

**Tests first:** the Lens rows and the "older tags" line for a fixture surface; each log line from a fixture page; a log
read by a third character shows none of the four lines.

## Task 7. Graffiti's rules

Model: sonnet

**Files:** `instances/divided-world/cards/graffiti.ts` (new), `instances/divided-world/cards/graffiti/stencils.ts`
(new), `instances/divided-world/cards/index.ts` (`listed`, header), `instances/divided-world/cards/cards.test.ts`
(l.24 table, l.38, l.416), `instances/divided-world/machine.ts` (the hidden rare slot, last),
`instances/divided-world/settings.ts` (`cardSettings` l.161: `'graffiti.limit': 40`),
`e2e/boards/2026-11-07-booster-packs/01-machine.ts` and `05-admin.ts` (a hidden slot's row, as Part 2's plan adds
its rares).

```ts
export const CANS = { black: '#111111', white: '#fafafa', red: '#e8202a', orange: '#ff7a1a', yellow: '#ffd200',
  lime: '#7ed321', green: '#16a34a', teal: '#14b8a6', cyan: '#22c7f0', blue: '#2457e6', purple: '#7c3aed',
  pink: '#ff3d9a', brown: '#8b5a2b', silver: '#b8bcc4' } as const;
export const CAPS = { skinny: 0.006, stock: 0.016, fat: 0.04 } as const;
// A drawn stroke: { can: keyof CANS; cap: keyof CAPS; aspect; points }. width is CAPS[cap], never sent.
// A draw: { strokes } | { stencil: StencilKey; can; spot: 0..8 }, kept with its strokes and, for a stencil, its key.
// A wash stroke: { aspect; points }, width the sponge's (0.06 of the box's width).
export const graffiti: CardRules<Record<string, never>> = {
  key: 'graffiti', name: 'Graffiti', alignment: 'pepperoni', rarity: 'rare', stack: 1,
  screenReads: [{ key: 'graffiti.limit', whole: true, min: 1, max: 100 }],
  surface: { limitKey: 'graffiti.limit', mostLive: 48, validateDraw, validateWash },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(graffiti, target, effects, now),
  validateConfig: () => ok({}),
  staffConfigs: [{}],
};
```

- **The stencils** (`stencils.ts`): six, each a list of strokes in a unit box with a cap, drawn by hand in code. They
  are `mustache`, `horns`, `crown`, `kilroy` (the nose over a wall and "KILROY WAS HERE"), `x` and `smiley`.
- **A spot** is one cell of a 3 × 3 grid over the body. A stencil is scaled to a third of the box's width, centered in
  its spot, with `aspect` 1.
- **Expanding** a stencil is done in `validateDraw`, so the server, the chatter and the screen all place it the same.
- **Mod Bots:** the persona's options for Graffiti are `{ stencil, can, spot }` (`staffOptions`, with a prompt naming
  the six and the cans), and `staffConfigs` falls back to a stencil chosen by the day's seed.
- **The limit refusal** reads the setting as a whole percent.
- The header comment names the design and says what the engine counts.

**Tests first** (`cards.test.ts`):
- `validateDraw` keeps a can and a cap and drops a sent `width`;
- an unknown can is refused with the cans listed;
- a 121st stroke is refused;
- a point outside 0 to 1 is refused;
- a stencil expands to strokes inside its spot;
- a stencil `x` at spot 4 covers the center cell;
- each stencil's cells at spot 4 are under 12% of the grid, so three stencils fit a 40% wall;
- `validateWash` drops a sent `can`;
- the largest draw measures under 64 KiB as Postgres writes it (as Whoops!'s does);
- Graffiti is in the machine at 300, hidden;
- every staff config validates.

## Task 8. The spray painter

Model: sonnet

**Files:** `instances/divided-world/cards/graffiti/spray.ts` (new), `spray.test.ts` (new).

`paintWall(ctx, box, density, acts)` draws a surface's live Acts in order onto a canvas, in CSS px of the box. Each draw
is drawn stroke by stroke as spray paint:
- **The core:** the capsule at the stroke's width, in the can's color, alpha 0.92.
- **The overspray:** a radial falloff to 1.9× the core's radius at alpha 0.35, built once per cap and color as a sprite
  and stamped along the path at a spacing of a quarter of the core's radius.
- **The speckle:** dots beyond the overspray, 0.6 to 1.6 CSS px, alpha 0.5. Their count is in proportion to the path's
  length and the cap's width, and their places come from `mulberry32` (Whoops!'s `splat.ts`), seeded by a hash of the
  stroke's own points. So every screen draws the same speckle.
- **Pooling:** where consecutive points lie closer than a third of the core's radius, a second core stamp at alpha 0.2.

A wash is drawn with `destination-out` at its width, cutting every draw before it. A draw after a wash is not cut.
`hitAt(acts, box, x, y)` says whether any ink lies under a point, by the same geometry as Task 1, used by `ink.claim`.
The canvas is capped as Whoops!'s is (`MAX_DPR`, `MAX_CANVAS_PX` from `whoops/paint.ts`).

**Tests first** (with the canvas fake `paint.test.tsx` uses):
- the speckle for one stroke is the same on two calls and differs for a moved stroke;
- a wash after a draw clears its core pixels, and a draw after the wash is intact;
- a Fat cap's overspray reaches farther than a Skinny cap's;
- `hitAt` is true on a core and false on overspray alone.

## Task 9. The wall on a post

Model: sonnet

**Files:** `instances/divided-world/cards/graffiti/Effect.tsx` (new), `Effect.test.tsx` (new), `graffiti.css` (new),
`instances/divided-world/cards/whoops/Effect.tsx` (adopts `ink`), `instances/divided-world/ui/cards.ts` (the
`CardUi` entry: `beneath: true`, lazy `Effect`, `Compose` from Task 10).

- **The ink layer.** The wall's ink is a canvas over the body's box (`data-kb-effect-ink`), drawn by `paintWall` when
  the post is near the viewport. It calls `surface.near()` then, and drops the canvas when the post leaves, as Whoops!
  does.
- **The reader's scrub.** On their own screen, never saved, for the page visit. It reuses Whoops!'s modules:
  - the touch rules and constants from `whoops/Effect.tsx` (`HOLD_MS`, `SLOP_PX`), lifted to a shared
    `instances/divided-world/cards/wiping.ts` that both effects import;
  - `suds.ts` for the suds, `cursor.ts` for the sponge, `lines.ts` for the words under ink;
  - the sweep's pace ("Hold to scrub", `bandsOf` and `sweepStep` from `whoops/scrub.ts`).

  A stroke starts only where `ink.topAt` is true.
- **The author's wash.** For the post's author, the sponge's strokes are collected and sent with `surface.wash` after
  1,500 ms without a stroke, or on unmount. A refusal is shown in the view and not retried. A lost answer is retried as
  Whoops!'s saves are (`RETRY_AFTER_MS`, `MAX_SAVE_RETRIES`).
- **The Draw tile.** A glass tile at the body's top right, `data-kb-over-ink`, with a drawn can in the reader's last can
  (kept per account in `localStorage`, wrapped in try/catch) and the word Draw. It opens draw mode (Task 10) as an
  addition to the wall. A signed-out reader, or one with no character, sees no tile.
- **The view** (`show`):
  - state: "31% of the wall";
  - controls: Hold to scrub, and for the author "Wash" (held in the kit as Whoops!'s Wash is);
  - ends: "Ends on your screen when you scrub it off. The author can wash it off for everyone, and anyone can tag it
    again."
- **Under a splat.** `beneath: true` puts the wall inside every Whoops! layer. Whoops!'s effect now claims its ink and
  checks `topAt` before starting a stroke, and its own tests still pass.

**Tests first** (`Effect.test.tsx`, with the fake surface):
- the canvas is drawn only when near;
- a reader's stroke is not sent;
- the author's strokes are sent once after the pause;
- a press on the Whoops! ink over the wall scrubs Whoops! and not the wall, and beside it scrubs the wall (both effects
  mounted);
- the Draw tile opens draw mode;
- a quick vertical swipe scrolls and draws nothing.

## Task 10. The toolbar and draw mode

Model: sonnet

**Files:** `instances/divided-world/cards/graffiti/Toolbar.tsx` (new), `Toolbar.test.tsx` (new), `Compose.tsx` (new, the
`Compose` of Task 5 and the Draw tile's draw mode), `can.svg.ts` (new, the drawn can), `graffiti.css`,
`instances/divided-world/cards/whoops/cursor.ts` (a third mode, `can`), `instances/divided-world/ui/cards.ts` (`describe`,
`status`, `summary`, `hint`, `tagline`, `describeDraw`, `logDraw`, `logWash`).

The look is D of `docs/research/2026-11-11-graffiti/01-tool-styles.html`, with the design's changes (section 8): the
caps are Skinny, Stock and Fat; the ink is the spray painter's; and there is a Stencils tab.

- **The dock.** On a screen under 720px wide, it is fixed to the foot of the window, with the safe-area inset. Wider, it
  sits under the post body. It is the glass's panel and seam, from the glass tokens only (`--kb-glass-*`). It has two
  tabs, **Spray** and **Stencils**.
- **Spray:**
  - the meter: the can's name, and "Wall 31% of 40%" counting this drawing's cells as the model adds them;
  - fourteen cans, a radiogroup named "Can", each can named by its color;
  - the caps, a radiogroup named "Cap": Skinny, Stock, Fat;
  - Undo;
  - Cancel and Tag it (Set it in `mode: 'set'`).
- **Stencils:** six stencil buttons drawn from their strokes, the cans, and a 3 × 3 grid of spot buttons ("Top left" to
  "Bottom right"). The stencil is previewed on the post before Tag it.
- **Tag it** is disabled while the drawing is empty or over the limit. The reason is under it: "Draw something first",
  or "This tag would take the wall to 46%; its limit is 40%".
- **Drawing on the post.** A press draws and never scrubs, and the touch rules hold. On an existing wall, the strokes
  draw over it. Under a splat, they draw under it and show only where the splat is scrubbed.
- **The cursor.** For a fine mouse over the post in draw mode, a drawn can tilted 20°, in the selected color, with a
  puff while pressed (reduced motion: no puff).
- **The words** are the glass's, plain, in American English. The card's `summary` reads "Turn a post into a wall anyone
  can tag. The author can wash it off; anyone can tag it again."

**Tests first** (`Toolbar.test.tsx`):
- every control is reachable by Tab and named;
- the cans and the caps are radiogroups with arrow keys;
- Tag it is disabled empty, and over the limit with the figures;
- Undo takes the last stroke;
- a stencil at a spot tags with `{ stencil, can, spot }`;
- the meter counts a stroke over existing ink as nothing more;
- Cancel with strokes asks first;
- the instance's UI test (`instances/divided-world/ui/index.test.tsx`) holds the new words to `lens-words.ts`.

## Task 11. The art

Model: sonnet

**Files:** `instances/divided-world/ui/cards/graffiti/art.webp`, `mark.svg`, `art.json` (new);
`docs/research/2026-11-11-card-renders/graffiti.py` (moved to `instances/divided-world/ui/cards/graffiti/scene.py`,
as Below the Fold's render was, in commit 99441413).

- Render `scene.py` at 1080 × 1680 as the card renders' README says, and convert it to `art.webp` as Below the Fold's
  was.
- The card renders' record names the scene's cans under the name plate as weak. Move the cans up into the upper half
  before rendering.
- `mark.svg` is the can icon of the mockup, square.
- `art.json` gives the credit and license, as Below the Fold's does.
- The art is checked by `tools/check-card-art.mjs`.

**Tests:** `instances/divided-world/ui/index.test.tsx`'s every-card-has-art and names-legible tests pass with Graffiti
in them.

## Task 12. In a browser

Model: sonnet

**Files:** `e2e/graffiti.spec.ts` (new), `instances/divided-world/cards/graffiti/Wall.board.stories.tsx` (new),
`e2e/board-stories.test.ts` (l.36, the story ids).

**The story** shows the mockup's moment (a wall at 31%, a cyan stroke in progress) at 360px and 1200px, and a wall
under a Whoops! splat.

**The spec** runs against the fake data:
- play Graffiti on a post by drawing and Tag it;
- a second character draws;
- the author washes, and the meter falls for both;
- a reader scrubs and reloads, and the wall is back;
- a tag over the limit is refused with the figures;
- a stencil is tagged by keyboard alone;
- on an emulated Pixel 7, a quick vertical swipe over the wall scrolls and draws nothing.

Screenshots are at `deviceScaleFactor` 1 unless the owner will see them.

## Review focus

- **A wash is never refused for the limit or the live count**, and no drawer's act can stop or slow one: check
  `wash_surface` against every refusal `draw_on_surface` makes.
- **The masks.** No refusal, count or timing of `draw_on_surface` differs with who owns the drawer or the post. The
  author's other masks draw like anyone. No broadcast or `thread_page` field carries strokes or owners.
- **Concurrency.** The limit and the live count are checked under the row's lock. Check a race between a draw and a wash
  on one wall, and between two draws.
- **Pruning.** `owners` and `live` must be renumbered together after a prune. `rebuild_surface` agreeing with the stored
  row after a long mixed run is the test that catches a drift. Check it covers washes that cut nothing live.
- **A busy instance.** A thread page reads no strokes, and a wall's strokes are read only near the viewport. A wall's
  worst read is 48 live draws of 64 KiB plus the live washes. Check that a long run of small author washes on one
  drawing cannot grow the live list past what the design names, or say what it grows to.
- **Two inks on one post.** `ink.topAt` decides between Whoops! and Graffiti. Check Whoops!'s own tests, a press on a
  washed-clean splat over a wall, and Stick Around's lift of a post that holds both.
- **A face-down Graffiti's draft** stays private until the spring (`face_down_draws` readable by no player), and its
  row is gone once read.
- **The boundary.** No word of Graffiti, no can and no stencil in `engine/` or `supabase/`.
  `tools/check-engine-boundary.mjs` passes.
- **What it does to an instance's Acts.** Two new kinds and no change to any existing Act. The export round trip holds
  with a wall in its fixture.
