# Effect history: plan

Record, written 2026-11-03. Carries out `docs/plans/2026-11-03-effect-history-design.md` (its sections are cited as §N).
Closes #164.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task adds a
check (`tools/check-*.mjs`), so no poison is planted for one. Each SQL task's red run is its own assertion file failing
before its migration exists. Migrations and SQL assertion files take the next free numbers when the build starts
(`tools/test-sql.mjs`). PR #156 holds `0067` and `0068`, so if it has merged, the migration is `0069`. Each task is
engine unless it says instance.

## Task 1. The snapshot at landing (§2)

**Layer:** engine (SQL).

**Migration `NNNN_play_moments.sql`:**
- `play_moments (play uuid primary key references acts (id), post_version uuid not null references acts (id),
  taken_at timestamptz not null default clock_timestamp())`. `post_version` is the post's latest edit Act at the
  insert, or the post itself where it has none, read through `acts_edits`.
- `play_moment_layers (play uuid references play_moments (play), layer uuid references acts (id), state jsonb,
  saved_at timestamptz, primary key (play, layer))`. One row for each other Act already on the post that is a layer
  (`kind in ('card', 'set', 'spring')`, `target_act_id` the post, on the post's own reach). `state` and `saved_at` are
  copied from `effect_state` where that layer saved one, and are null where it saved none. The rows list the moment's
  layers exactly, so the read never orders by time (card Acts take no `seq` since `0054_card_plays.sql:135`).
- A function `take_play_moment()` (security definer, `search_path` pinned) and the trigger
  `acts_take_play_moment after insert on acts for each row when (new.kind in ('card', 'set', 'spring') and
  new.target_act_id is not null and coalesce(new.payload ->> 'reach', 'post') = 'post')`. It is an ordinary trigger, not
  `enable always`, so an import written as a replica (`tools/import-instance.mjs`) does not fire it.
- Append-only guards on both tables, as `play_reach`'s (`0055_card_reach.sql:186`): no update, delete or truncate, with
  the truncate guard `enable always`.
- RLS: `select` to `authenticated` with `using (true)`, as `effect_state` and `play_reach`; nothing to `anon`; written by
  the trigger alone.
- The function never names `face_down`.

**Tests first:** `supabase/tests/NNNN-play-moments.sql`:
- A Whoops! cast on a post with no other play: one `play_moments` row naming the post itself, and no layer rows.
- A second Whoops! after the author saved 40% of the first: a layer row holding that save, byte for byte, with its
  `saved_at`. The first layer's later saves leave the row unchanged.
- A cast after an edit names the edit as `post_version`. An edit after the cast leaves it unchanged.
- A Set, a spring, a caught play and a trap's Strike each take a row (the Strike through `spring_traps`, so the trigger
  is proven on a path that never calls `play_card` directly).
- A character, a thread and a board play take none.
- A layer row for a card back carries the Set's state (none), and the table holds no card key.
- Update, delete and truncate on both tables are refused.
- `anon` reads neither table.
- Red today: the tables do not exist.

**Also:**
- `supabase/tests/0005-default-deny.sql` covers the two tables.
- `supabase/tests/e2e/0003-export.ts` inserts a moment and a layer row beside its `effect_state` row (line 97). It
  asserts the round trip holds both tables, and that the import made no extra rows (the trigger stayed silent).

## Task 2. The moment's read (§3, §6, §8)

**Layer:** engine (SQL).

**In the same migration, `play_moment(play uuid) returns jsonb`** (stable, security definer, granted to `authenticated`
alone):
- The play must be a layer on a post. Anything else raises in words (`kayfabb.refusal`).
- **`version`:** the projection (as `act_projection`) of the moment's post with the version's payload as its current
  payload.
- **`layers`:** the play's own Act projection, then each layer row's Act projection with its `state` and `savedAt`.
- **`above`:** each play in `play_reach` on the post's author (`character`), its thread, or its board whose Act came
  before the play and whose `ends_at` is after it. Each has its reach and its Act projection, as `effects_above` returns
  them.
- **`recorded`:** true when `play_moments` has a row.
- A play with no row is answered by §6: `version` is found by time from `acts_edits` (the latest edit at or before the
  play's `created_at`), `layers` holds the play alone, and `recorded` is false.
- A Set's projection carries no card key, whoever calls.

**Tests first:**
- In `supabase/tests/NNNN-play-moments.sql`:
  - the answer for each of Task 1's cases;
  - a Glitter Bomb live then is in `above`, and one ended before or begun after is not;
  - a play from before snapshots (its `play_moments` row removed with the guards disabled in the test's own
    transaction) answers `recorded: false`;
  - a post id and an edit id are refused in words.
- In `supabase/tests/0017-masks.sql`: `play_moment` on a post holding a Set returns the same bytes to the setter and to
  a stranger, and never the card key.
- A scale assertion, in the manner of `supabase/tests/0058-progress-scale.sql`: the read's buffers stay flat between a
  thread of 200 posts and one of 2,000, and between a post with 1 layer and one with its stack full.
- Red today: the function does not exist.

## Task 3. The API (§4)

**Layer:** engine (`engine/ui/data/`) and the web adapter.

- `engine/ui/data/api.ts`: a `PlayMoment` type
  `{ version: Act; layers: readonly { act: Act; state: EffectState | null }[]; above: readonly PlayAbove[];
  recorded: boolean }`, and `KayfaApi.playMoment(play: Id): Promise<PlayMoment | null>`, which is null for an id that is
  no play on a post.
- `web/src/data/supabase.ts`: calls the RPC through `read` and maps with `toAct`, as `effectsAbove` and `effectStates`
  do (lines near 754 and 773).
- `engine/ui/data/fake.ts`: serves the same from its acts, effects and a snapshot map. Its `playCard`, `setCard` and
  spring paths fill the map at landing, as the trigger does.

**Tests first:** the fake's tests beside the others for card reads: a moment after two casts and a save; a play
with none recorded. Red today: `playMoment` does not exist.

## Task 4. Which cards are drawn, and the still mode (§3, §5)

**Layer:** engine (`engine/rules/cards.ts`, `engine/ui/cards/`).

- `engine/rules/cards.ts`: `drawnInMoment(rules: Pick<CardRules, 'validateState' | 'stack' | 'lasts'>): boolean`, true
  when `validateState` is given, `stack` is above 1, or `lasts` is given.
- `engine/ui/cards/types.ts`: `EffectProps.still: boolean`. Its comment states the contract:
  - with `still`, the effect draws `states` as given, takes no input, starts no animation, lifts nothing, and makes
    nothing inert;
  - its `show` gives the words the frame shows for it;
  - `save` and `release` refuse without asking, and `met` does nothing.
- `engine/ui/cards/Effects.tsx`:
  - `BoundEffect` passes `still: false` on the live path.
  - A new `MomentEffects({ moment, nameOf, onWords })` wraps `moment.version`'s body in the effects of the moment's
    layers whose cards qualify. It uses a `Plays` store of its own, filled from `moment.layers` with their states, and
    wraps in the order `PostEffects` uses (§3). Each layer is drawn with `still: true`, `marks: null`, a refusing
    `save` and `release`, a no-op `met`, and a `show` that hands the view's `state` to `onWords` by card.
  - Liveness (a Use play's `ends`, a caught play, a card back) is judged at the play's own time, never now.
  - Cards that don't qualify, card backs, caught plays and `moment.above` are returned as the named list (§3's
    words). Nothing above the post is drawn.

**Tests first:**
- `engine/rules/cards.test.ts`: `drawnInMoment` holds for Whoops!'s shape and an engine test card with `lasts`, and fails
  for Stick Around's shape.
- `engine/ui/cards/moment.test.tsx` (new), with engine test cards:
  - a card that would call `save`, `release` and `met`, and add a pointer handler, does none of them under `still`;
  - a non-qualifying takeover card is named and never mounted;
  - layers wrap in `PostEffects`' order;
  - a card back is named "a card set face down", and its key is never read;
  - a caught play is named with its trap's card from the spring;
  - a Use play that had ended by the moment is left out.
- Red today: `MomentEffects` does not exist.

## Task 5. As it landed, on the post (§4)

**Layer:** engine (`engine/ui/cards/`, `engine/ui/thread/`, the glass's CSS).

- `engine/ui/cards/Lens.tsx`:
  - `LensStore` gains `moment(): Id | null` and `showMoment(play: Id | null)`. Every change of `open` (`toggle` to
    another strip or to closed, and `close`) also clears the moment, so one moment shows per page and it goes with its
    Lens (§4).
  - `PlayRow` gains **As it landed** (`aria-pressed`, a `kb-kit-tile kb-lens-action` like Spin thread), beside React
    and Spin, for every play on a post. Pressing it again clears the moment.
- `engine/ui/cards/Effects.tsx`, `PostEffects`:
  - when the Lens store's moment is a play on this post, the non-takeover wraps and `children` are replaced by
    `<MomentFrame>` around `<MomentEffects>`, and the live takeovers still wrap outside it (§4);
  - the moment is read with `api.playMoment` once per play pressed, and kept for the page while it is read.
- `engine/ui/cards/Moment.tsx` (new): `MomentFrame`:
  - the chamfered frame in the play's ink (`inkOf`) or its alignment's, with its glow on a wrapper;
  - the tag "AS IT LANDED · {when} · Back to now", where Back to now is a button that clears the moment;
  - the named list, each still card's words, and §6's line where `recorded` is false;
  - the tag and the list are positioned out of flow;
  - while loading, the tag says "Loading the moment…". On a failure it says so in plain words with Try again, and Back
    to now still works.
- Styles in the glass's CSS beside the Lens's, from the glass's tokens. No color is named
  (`tools/check-ui-tokens.mjs`).

**Tests first:** in `engine/ui/cards/lens.test.tsx`:
- As it landed draws the moment's version in place of the live body, inside a Stick Around takeover's lift.
- Esc, the ×, another post's Lens and Back to now each restore the live body.
- The marks stay pressable while a moment shows.
- No stroke reaches the live effect while a moment shows.
- The ORIGIN box's case of #105: a Lens opened there makes nothing inert.
- The failure line and Try again.
- Red today: there is no such control.

**Stories:** `engine/ui/cards/Marks.board.stories.tsx` gains a post showing a moment over a washed-clean live layer, at
1440 and 390, for the owner's review of the frame.

## Task 6. The ORIGIN box of a play-spun thread (§4)

**Layer:** engine (`engine/ui/spin/Origin.tsx`).

- In `case 'card'` (line 169), when `cardPlay` is a play on a post, the box reads `api.playMoment(cardPlay.id)` and draws
  `<MomentFrame>` around `<MomentEffects>` under its mark, in place of nothing. Its tag has no Back to now. The mark's
  link to the post as it is now is unchanged.
- A play beyond a post keeps today's box.
- The play's own Lens from the box's mark works as in Task 5, without the moment control, since the box already shows it.
- The live subscription of `useOrigin` keeps serving the mark's reactions. The moment itself is read once.

**Tests first:** `engine/ui/spin/Spin.test.tsx`:
- A thread spun from a Stick Around play on a post with a 40%-washed Whoops! draws the Whoops! still at 40%, and names
  Stick Around.
- A later wash on the live post leaves the box unchanged.
- A thread spun from a post keeps its live box.
- Red today: the box draws no post for a play.

## Task 7. Whoops!'s still drawing (§3, §5)

**Layer:** instance (`instances/divided-world/cards/whoops/`).

- `Effect.tsx` honors `still`:
  - it draws each layer from `states` alone, ignoring local scrubbing (`localClean`, `wantClean`) and the save queue;
  - a layer saved clean is not drawn, with no fade (`cleanedAt` untouched);
  - no pointer handlers are bound, and no `met` is sent;
  - its `show` gives the moment's words: "Gloomba's yellow, 40% washed" for one layer, and for several, each layer top
    first, joined, with "washed clean" where a layer was.
- The live path is unchanged.

**Tests first:** `instances/divided-world/cards/whoops/Effect.test.tsx`:
- Under `still`, a saved 40% wash draws as saved.
- A pointer drag changes nothing and calls no `save`.
- A clean layer is absent and nothing fades.
- The words, for one layer and for three.
- `instances/divided-world/cards/cards.test.ts` asserts that every instance card for which `drawnInMoment` holds, and
  which has an `Effect`, renders under `still` without calling `save`, `release` or `met`. Today that is Whoops!, and the
  test fails for any later card that skips the contract.
- Red today: the effect ignores `still`.

**Stories:** `instances/divided-world/ui/whoops/Lens.board.stories.tsx` gains a washed-clean post with its moment shown.

## Review focus

- **Acts already written:** plays with no `play_moments` row answering by §6, and a post whose edits all fell inside the
  grace.
- **A race at landing:** an author's save committed in the same instant as a cast. The snapshot holds what was committed
  when the trigger ran, and nothing errors or blocks either write.
- **The trigger's paths:** every insert of a layer Act, `spring_traps`' Strike and spring included, takes exactly one row.
  An import takes none and doubles nothing.
- **The masks:** `play_moment` and the snapshot never touch `face_down`. A card back's moment is byte-identical for its
  setter and a stranger, and the trigger's work doesn't differ with a set trap.
- **A busy instance:** snapshot storage per play (at most the post's other layers, each up to 256KB), and the read's
  cost as threads and plays grow.
- **The still contract:** a card that qualifies but mishandles `still`, whether by saving, starting the fade, binding
  input or lifting, on a page where a moment shows.
