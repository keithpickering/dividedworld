# A spin from a card on a character shows the post it was spun at: the plan

Record, written 2026-11-12. The design is `docs/plans/2026-11-12-spin-at-post-design.md`.

It builds on main as it stands and waits on nothing. It does not need card notes Part 2 or Glitter Bomb keeps; if
either has landed, read each function named below again where it has moved, and see Review focus for the one place
they meet. Line numbers are main's on 2026-11-12.

## The layers

- **Engine:** all of it. The spin's `at`, the spin's moment, a character play's moment, the place's two posts, the
  shared name link, the box. The engine names no card: every rule here is about a play whose reach is a character.
- **Divided World:** nothing changes. Glitter Bomb's effect already draws `still` (`instances/divided-world/ui/glitter-bomb/Effect.tsx`),
  and the e2e test of Task 8 runs on Divided World's seed because that is where a card cast on a character is.

## Words used below

- **The pressed post:** the post whose postbit carried the mark the spinner pressed Spin thread on. The spin Act's
  payload holds its id under `at`.
- **The cast-from post:** the character play's `target_act_id` (`0055_card_reach.sql`, header).
- **A spin's moment:** the pressed post as it was when the spin was written, in `PlayMoment`'s shape.

## Task 1. The rules: a spin may name a post

Model: inline

**Files:** `engine/rules/actions.ts` (the `spin` entry, line 229), `engine/rules/actions.test.ts`.

`spin`'s args gain `at_post: optionalId(r, 'at')`, as `post` passes `quoting: optionalId(r, 'quote')` (line 223).
`apologize` is not changed.

Tests first, beside "a spin's own words may be empty": a spin with `at: <id>` decides `at_post: <id>`; one with no
`at` decides `at_post: null`; one with `at: 'nope'` is refused on `at`. The existing `deepEqual`s on a spin's args
(lines 36 and 50) gain `at_post: null`.

## Task 2. The migration: the spin's post, its moment, and the place

Model: sonnet

**Files:** `supabase/migrations/<next>_spin_at_post.sql`, `supabase/tests/<next>-spin-at-post.sql`,
`supabase/tests/0005-default-deny.sql`, `supabase/tests/0017-masks.sql`, `supabase/tests/e2e/0003-export.ts` and the
export it drives.

The header says what it adds, that it adds no state to leave, its masks (design section 5) and its cost (section 7),
as `0072_play_moments.sql`'s and `0152_origin_place_board_now.sql`'s do.

1. **`spin` and `spin_written`** (`0130_bars_apologies.sql`, lines 162 and 185). Both are dropped and made again with
   one more parameter, `at_post uuid default null`, last; grants and revokes as 0130 and `0118_bbcode_tags.sql` (line
   942) left them. `apologize` passes null. In `spin_written`, after the origin's board is found and before the
   thread is made, when `at_post` is not null:

   ```sql
   if not exists (
     select 1 from acts k join play_reach r on r.play = k.id join acts p on p.id = at_post
     where k.id = origin and k.kind = 'card' and not (k.payload ? 'caught')
       and r.reach = 'character' and p.kind = 'post' and p.character = r.character
       and r.ends_at > now()
       and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = k.id)
   ) then raise exception 'that card is not on that post' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
   ```

   The spin Act's payload is `{title, body}` and, when `at_post` is not null, `at` too. Nothing here reads
   `characters.owner`.
2. **`spin_moments` and `spin_moment_layers`**, as `play_moments` and `play_moment_layers` are made in 0072 (lines 29
   to 62): `spin_moments (spin uuid primary key references acts, post_version uuid not null references acts)`,
   `spin_moment_layers (spin, layer, state, saved_at, primary key (spin, layer))`; append-only by the same kind of
   trigger; RLS on, `select` for `authenticated`, nothing else granted.
3. **`take_spin_moment`**, a trigger after insert on `acts` when `new.kind = 'spin' and new.payload ? 'at'`. It writes
   what `take_play_moment` writes (0072, line 70) for the post `(new.payload ->> 'at')::uuid`: the post's latest
   edit or the post itself as `post_version`, and every layer on the post (`acts_layers`' predicate, word for word)
   with what `effect_state` holds for it.
4. **`spin_moment(spin uuid) returns jsonb`**, stable, security definer, granted to `authenticated` alone. It is
   `play_moment` as `0340_conduct.sql` wrote it (line 1535), read whole first, with these differences:
   - the moment's time is the spin's `created_at`, not a play's; it is returned as a new key, `'at'`;
   - `version` is `spin_moments.post_version` shown through `public_payload(..., version_hidden(...), ...)`;
   - `layers` is the origin play first (`act_projection` of the spin's `target_act_id`, no state), then the
     snapshot's layers, then the `card_end`s at or before the spin's time of any of them;
   - `above` is every play beyond a post live at the spin's time on the post's author, thread or board, bounded as
     `play_moment` bounds it, **leaving out the origin play**;
   - `recorded` is true;
   - a spin with no `spin_moments` row is refused: `that spin names no post`, `kayfabb.refusal`, `P0002`.
5. **`thread_open`**, written again whole from 0152 with `create or replace`, the columns unchanged. Grep
   `origin_place` first and say in the header every other place that computes it, changing each the same way or
   saying why not. The `'play'` object gains two keys, each a post place
   (`{'kind': 'post', 'thread', 'title', 'seq'}`) or null:
   - `'from'`: the cast-from post. `left join acts cf on cf.id = o.target_act_id and o.kind = 'card' and
     o.payload ->> 'reach' = 'character'`, and its thread;
   - `'at'`: the pressed post. `left join acts sp on sp.id = (f.payload ->> 'at')::uuid and f.kind = 'spin'`, and its
     thread (`f` is the thread's first Act, the spin).
   Each join's predicate keeps it a null probe for a thread not spun from a character play.
6. **The export.** Find how `play_moments` and `play_moment_layers` ride the export and the import (grep both names
   outside `supabase/migrations/0072`; `supabase/tests/e2e/0003-export.ts` line 766 counts them across a round trip)
   and carry `spin_moments` and `spin_moment_layers` the same way, with the same count in that test.

Tests first, in `<next>-spin-at-post.sql`, made the way `supabase/tests/0075-play-moments.sql` makes its plays:

- a spin of a live character play with a post by that character writes `at` on the Act and one `spin_moments` row;
  a post edited before the spin snapshots the edit; a layer on the post with saved state is in `spin_moment_layers`
  with that state;
- each of these is refused with exactly `that card is not on that post`: a post by another character; an Act that is
  no post; a play on a post; a thread's play; a caught play; a play whose time has run out; a play an admin ended;
- a spin with no `at_post` writes no `at` and no moment, for a character play and for a post;
- `spin_moment`: the version's words are the edit's as of the spin, and stay so after a later edit; a later layer is
  not in it; the origin play is `layers[0]` and is not in `above`; another character play live then is in `above`;
  a version hidden after the spin reads as `acts_public` shows it; `'at'` is the spin's time; a spin with no post is
  refused;
- `thread_open.origin_place` for such a thread has `'at'` and `'from'` with the right thread, title and seq; for a
  spin with no post, `'at'` is null and `'from'` is set; for a spin from a play on a post, a thread's play and a
  board's play, both are null and the rest is as before;
- **the cost**, as 0152's header measures it: 5,000 threads, half spun from a character play with a post, a deep
  page (offset 2000) timed before and after, the figures written in the header.

`0005-default-deny.sql` lists the two tables where it lists `play_moments`. `0017-masks.sql`, beside its
`play_moment` case (line 442): `spin_moment` answers the same bytes to the post's owner, the play's caster and a
stranger, and the refusal for a post by another character is the same words and code whoever owns either.

## Task 3. The migration: a character play's moment

Model: sonnet

**Files:** `supabase/migrations/<next>_character_play_moment.sql`, `supabase/tests/<next>-character-play-moment.sql`.

1. **The trigger** `acts_take_play_moment` (0072, line 85) is dropped and made again with
   `coalesce(new.payload ->> 'reach', 'post') in ('post', 'character')`. `take_play_moment` itself is not changed: for
   a character play `new.target_act_id` is the cast-from post, and its layers query already reads only layers whose
   reach is a post's.
2. **`play_moment`** is written again whole from 0340 with two changes: the play may be one whose reach is `character`
   (its post is its `target_act_id`), and the answer gains `'at'`, the play's `created_at`. A thread's and a board's
   play are refused as before, in the same words.

Tests first: a character play made after the migration has a `play_moments` row, and its moment is the cast-from
post's version then, with the layers on it then, itself first, itself not in `above`, `recorded` true; a character
play inserted with no snapshot (as an old one is; `0075-play-moments.sql` makes an unrecorded play) answers the version
current at its time from the post's edits, itself alone, `recorded` false; a thread's play is still refused; a play on
a post answers as before, with `'at'`.

## Task 4. The data layer

Model: sonnet

**Files:** `engine/ui/data/api.ts`, `web/src/data/supabase.ts`, `engine/ui/data/fake.ts`,
`engine/ui/data/fake.test.tsx`.

- `api.ts`: `OriginPlace`'s `'play'` member (line 312) gains `readonly at: PostPlace | null` and
  `readonly from: PostPlace | null`, where `PostPlace` is `Extract<PlaceOn, { kind: 'post' }>`. `PlayMoment` (line
  2066) gains `readonly at: string`, and its comment says a moment is a play's or a spin's. `spin` (line 2796) gains a
  last parameter `at?: Id`. A new `spinMoment(spin: Id): Promise<PlayMoment | null>`, null for a spin that names no
  post, beside `playMoment` (line 2551).
- `supabase.ts`: `spin` (line 2179) sends `at` when given; `spinMoment` beside `playMoment` (line 1501), the refusal
  read as null the way `playMoment` reads its own; `toPlace` (line 306) reads `at` and `from`, each checked as a post
  place is and null when missing or malformed, so a row from before this migration still reads.
- `fake.ts`: `spin` (line 1363) takes `at` and refuses in the migration's words under the migration's checks; a spin
  with `at` keeps a moment as `moments` does for a play; `spinMoment`; `playMoment` (line 1452) answers a character
  play and returns `at`; `originPlace` (line 829) gives `at` and `from`.

Tests first, in `fake.test.tsx`, one for each SQL test of Tasks 2 and 3 that the fake can show (the refusals by name,
the frozen version after a later edit, the origin play first and not above, the place's two posts), so the fake and
the database say the same thing.

## Task 5. The shared piece: a character's name and avatar, one link

Model: sonnet

**Files:** `engine/ui/mini.tsx`, `engine/ui/mini.css`, a test beside them.

`CharacterLink({ id, character, name, avatar = true })`: one `Link` to `/c/<id>` holding the `Mini` avatar (when
`avatar`) and the name, in a `Who` box so the two never part across a line. The avatar stays decoration
(`aria-hidden`), so the link's name is the character's name alone. `Byline`'s `link` branch (line 50) draws it, so
every screen that already links a byline gets the avatar inside the link; `link={false}` and the staff are as they
are. No other screen is moved here: that is the sweep's design (design section 4).

Tests first: the link's accessible name is the name alone; the avatar is inside the link; `avatar={false}` draws the
name link alone; a `Byline` with `link` draws one link and with `link={false}` none; the staff's byline draws none.

## Task 6. The phrase: its words and its links

Model: sonnet

**Files:** `engine/ui/spin/place.ts`, `engine/ui/spin/place.test.ts`, `engine/ui/spin/OriginLink.tsx`,
`engine/ui/board/Board.tsx` (line 343), `engine/ui/board/Board.test.tsx`.

A phrase that was one link becomes parts for a play on a character, and stays one link for everything else.

- `place.ts` gains `placeParts(place, cardName, perPage)`: an ordered list of `{ words, href | null, character? }`.
  For a play on a character: `Glitter Bomb on `, then the name (`href` the profile, `character` its id), then
  `, at ` and `#31 in <title>` (`href` the pressed post) when `at` is set, else `, cast from ` and `#12 in <title>`
  (`href` the cast-from post) when `from` is set. For every other place it is the one part `placeWords` and
  `placeHref` give today, and those two functions stay, built on it, for their other callers.
- `OriginLink` draws the parts. It gains `faces?: (id) => Character | undefined`: where given, the character part is
  `CharacterLink` with its avatar (the box); where not, a plain `Link` on the name (the board's row).

Tests first, in `place.test.ts`: the parts for a character play with `at`; with `from` alone; with neither (name
alone, as an answer from an older server); a play on a post, a thread, a board, an update and a face-down set each
one part with today's words and address. In `Board.test.tsx`: a row spun from a character play with `at` has two
links, to the profile and to the post, and no avatar in the phrase.

## Task 7. The moment draws its own play when that play is on a character

Model: sonnet

**Files:** `engine/ui/cards/Effects.tsx` (`momentParts`, line 405; `MomentEffects`, line 489),
`engine/ui/cards/Moment.tsx` (`useMomentRead`, line 39; `MomentView`, line 191), their tests
(`engine/ui/cards/lens.test.tsx` and the moment tests beside it), `instances/divided-world/ui/still.test.tsx`.

- `momentParts` judges liveness at `moment.at`, not at `layers[0]`'s date (the two are equal for a play's moment).
  Where `layers[0]` is a play whose reach is a character, it is returned as a new field, `above: CardPlay | null`,
  and is neither drawn among the post's layers nor named. Every other play beyond a post is named, as today.
- `MomentEffects` wraps the words in `above`'s card's effect, given `still`, the way `PostEffects` (line 50) wraps a
  post in its author's live play: outside the post's own layers, inside every takeover. Read how `PostEffects` finds
  and orders that layer and use the same path; do not write a second ordering.
- `useMomentRead(key, load)` takes the reader, so the Lens store keeps a spin's moment under the spin's id as it keeps
  a play's under the play's. `MomentView` gains `source?: { readonly spin: Id }`: with it the moment is
  `api.spinMoment(spin)`, the frame's time is the moment's `at`, and its label is "As it was spun"; without it,
  everything is as today.

Tests first: a moment whose first layer is a character play draws that card's effect once, `still`, and names it
nowhere; another character play in `above` is named and not drawn; a play's moment on a post is unchanged (the
existing tests stand); a Use that ended between the play and `moment.at` is left out. In `still.test.tsx`: Glitter
Bomb drawn from a spin's moment is the still form, with no burst canvas sized.

## Task 8. The box, and the press

Model: sonnet

**Files:** `engine/ui/thread/Post.tsx` (`SpinOrigin`, line 133; `characterMarks`, line 252),
`engine/ui/spin/SpinForm.tsx`, `engine/ui/spin/Origin.tsx`, `engine/ui/spin/spin.css`,
`engine/ui/spin/Spin.test.tsx`, `engine/ui/spin/Spin.stories.tsx`, `e2e/` (a new spec beside `e2e/shine.spec.ts`).

- **The press.** `SpinOrigin` gains `readonly at?: Id`. `characterMarks`' `onSpin` sets `at: act.id`; no other caller
  sets it. `SpinForm` takes `at` and passes it to `api.spin`. Its look for an answer that never came back
  (`spunLoader`) is by origin, title and character, and is not changed.
- **The box**, in `Origin.tsx`'s `case 'card'`, for a play whose reach is a character:
  - the head: `<OriginLink>` with `faces`, then `· as it was spun` where the place has `at`, `· as it landed` where it
    has `from` alone; under it, where the place has `at` and `from`, a second line, `Cast from ` and a link to the
    cast-from post in `placeParts`' words;
  - a byline: `CharacterLink` for the post's author and the version's date, in the line the default case uses;
  - the moment: `MomentView` with `source={{ spin: summary.firstAct }}` where the place has `at` (check the field's
    name on `ThreadSummary`; it is `thread_open.first_act`), else `MomentView` of the play, which Task 3 now answers;
  - the mark's Go to post leads to the pressed post where there is one, else the cast-from post.
  A thread's and a board's play draw the mark alone, as today. The file's header comment says all of this.
- The world is the board (`docs/plans/2026-10-29-two-worlds-design.md`): the box is in the house style, and the
  moment's small print under the post is the board's own, as it is for a play on a post.

Tests first, in `Spin.test.tsx` against the fake: pressing Spin thread on a character mark on post 31 sends `at`;
the new thread's box shows post 31's words as they were, the glitter's still effect, the two head links and the
Cast from line; an edit to post 31 afterwards does not change the box; a thread spun with no `at` shows the cast-from
post and "as it landed"; a spin from a play on a post and from a thread's play are unchanged. A story for each of the
two boxes. The e2e spec, on Divided World's seed against localhost: cast Glitter Bomb from a post, spin from the mark
on a later post by that character, and see the box's canvas, both links' addresses and the profile link.

## Review focus

- **Acts an instance already holds.** Every spin already made from a character play has no `at`, and every character
  play already made has no snapshot: the box for each must read as the cast-from post "as it landed", unrecorded, and
  never as an error or an empty box.
- **A hidden version.** A post version hidden after a spin or a play must leave both moments; check `spin_moment`
  and the widened `play_moment` against `acts_public` for a hidden original and a hidden edit.
- **A mask.** The refusal `that card is not on that post` and its timing must not differ with who owns the play's
  character, the post's character or the caster; `spin_moment` must be the same bytes for every reader.
- **A second run.** A spin sent twice (the form's "Spin again anyway") writes two spins and two moments, each of its
  own time; a play ended by an admin between the check and the insert leaves a moment of a play that had just ended.
- **The deep board page.** `thread_open`'s three new joins on a page whose skipped rows are mostly spun from
  character plays: the header's measured figures, and that the planner probes by primary key.
- **Kept glitter.** If card notes Part 2 and Glitter Bomb keeps are on main, a kept post shows a mark whose spin this
  check refuses once the play's time is up. The check then takes a post the play falls on by `fallsOn`'s rule; if they
  are not on main, say in the PR that the keeps build must widen it.
- **The Lens.** `play_moment` now answers a character play; nothing but the box should have started offering it.
