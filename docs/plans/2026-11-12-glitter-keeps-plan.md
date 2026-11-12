# Glitter Bomb keeps: the plan

Record, written 2026-11-12. The design is `docs/plans/2026-11-12-glitter-keeps-design.md`.

**Builds after card notes Part 2** (`docs/plans/2026-11-11-card-notes-part-2-plan.md`), which adds what this widens:
`CardRules.keeps`, `fallsOn` (its Task 1), `card_kinds.keeps` and the seed's mirror (Task 2), `thread_page`'s `kept` key
and `reverse_card`'s acceptance of an ended `keeps` play (Task 3), `ThreadPage.kept` in the data layer (Task 5), and
the kept thread layer in `PostEffects`, `markedPlays`' keeping of an ended `keeps` play and the Lens's ended words
(Task 7). A build session that finds Part 2 not on main stops and says so; it does not build Part 2's pieces here.
Line numbers below are main's on 2026-11-12, before Part 2; read each function again where Part 2 has moved it.

## The layers

- **Engine:** the `keeps` check widened to a character; `thread_page`'s `kept` for the page's authors; the fake's
  `kept`; `PostEffects`' character layer; `EffectProps.kept`; a kept play's mark on the postbits it falls on; the log's
  ended line for a card that keeps. The engine names no card.
- **Divided World:** Glitter Bomb's `keeps: true`, its words and `logPlay`, and its effect loading a kept post settled.

## Task 1. The rules: a character play may keep

Model: inline

**Files:** `engine/rules/instance.ts`, `engine/rules/instance.test.ts`.

Part 2's check (beside the reach checks, `instance.ts` lines 520 to 545 before Part 2) says `keeps` is only on a cast
card whose `reaches` is exactly `['thread']` and that has `lasts`. It becomes: a cast card whose `reaches` is exactly
`['thread']` or exactly `['character']`, with `lasts`. Its fault says so in the words its neighbors use
(`` `${who} keeps, and only a cast card that reaches one thread or one character, with a time up, does` ``). The
`CardRules.keeps` comment in `engine/rules/cards.ts` says "a thread or character play of it stays on every post written
in its target while it was up, after its time". `fallsOn` is not changed: it takes no reach.

Tests first, in `instance.test.ts` beside Part 2's: a `keeps` card reaching `['character']` with `lasts` is not
reported; one reaching `['character', 'thread']`, one reaching `['post']`, and one reaching `['character']` with no
`lasts` are each reported, in the words above.

## Task 2. The migration: a kept character play on the thread's page

Model: sonnet

**Files:** `supabase/migrations/<next>_kept_character.sql`, `supabase/tests/<next>-kept-character.sql`.

Its header says what it adds, its way out (an admin's end), its masks and its cost, as Part 2's migrations' do.

1. **The seed's mirror.** Where Part 2's `seed_instance` mirrors the `keeps` check of `instance.ts`, the mirror is
   widened as Task 1 widens the check, `seed_instance` written again whole with that one change. If Part 2 mirrors no
   `keeps` check in SQL, nothing here changes and the header says so.
2. **`thread_page`** is written again whole from Part 2's version, with one change: the `kept` CTE also reads plays at
   character reach. For each distinct author among the page's `posts`: plays in `play_reach` with that `character`,
   whose kind `keeps`, ended by time (`ends_at <= now()`), not `card_ended`, and whose window holds a post **by that
   character** among `posts` (`k.created_at <= p.created_at and p.created_at < r.ends_at and p.character = r.character`),
   read through `play_reach_character` (`(character, ends_at)`, `0055_card_reach.sql` line 181) with
   `ends_at > ` the page's earliest post date. Thread and character rows together, at most 100, oldest first, in the
   `'kept'` key's shape (`{ play, reach, target, ends_at, act }`, `'above'`'s); their casters join `who` and their
   ids join `ids`, as Part 2's thread rows do.
3. `reverse_card` is not changed: Part 2's acceptance of an ended play whose kind `keeps` takes no reach. The test
   proves it for a character play.

Tests first, in `<next>-kept-character.sql`, a worn-off play made the way Part 2's test makes one (it follows
`supabase/tests/0094-card-end.sql`'s `worn_reach`):

- a `keeps` kind cast on character A, worn off: a page holding A's post written inside the window lists the play in
  `kept`; a page holding only A's posts written before the play, or after its end, lists nothing;
- **another character's post inside the window does not bring it in**: a page whose only post in the window is B's
  lists nothing for A's play;
- a live play is in `above` and not in `kept`; an admin-ended one, ended during the week or after it, is in neither;
- a worn-off play of a kind that does not keep is in neither;
- `reverse_card` ends a worn-off character play of a `keeps` kind;
- the document is the same for two different callers (`supabase/tests/e2e/0016-screen-reads.ts`'s way), and `explain`
  of the new probe names `play_reach_character` (read line by line, as `supabase/tests/0034-thread-list.sql` does).

## Task 3. The fake backend

Model: sonnet

**Files:** `engine/ui/data/fake.ts`, `engine/ui/data/fake.test.tsx`.

`threadPage` answers Task 2's character rows in `kept` with the same rules (the author's own posts, the window, ended by
time, not ended by an admin, at most 100), beside Part 2's thread rows. The fake's seeding can already make a reach play
with an end in the past (`seed.reach(caster, 'character', target, key, { post, ends })`); a post dated inside a window
is made the way Part 2's fake test makes one. `web/src/data/supabase.ts` maps `kept` already (Part 2, Task 5): read it
and change nothing unless it drops a row whose `reach` is `character`.

Tests first, in `fake.test.tsx`: Task 2's cases against the fake.

## Task 4. The engine's screens: a kept character play draws, marks and logs

Model: sonnet

**Files:** `engine/ui/cards/Effects.tsx`, `engine/ui/cards/types.ts`, `engine/ui/cards/plays.ts`,
`engine/ui/cards/Marks.tsx`, `engine/ui/thread/Post.tsx`, Part 2's `engine/ui/cards/kept.test.tsx`,
`engine/ui/cards/plays.test.tsx`, `engine/ui/log/lines.ts`, `engine/ui/log/lines.test.tsx`, `engine/ui/test-world.tsx`
(a `keeps` card that reaches a character).

- **`PostEffects`** (`Effects.tsx`, lines 84 to 95 before Part 2). Part 2 makes the thread layer's `acting` the plays
  for which `fallsOn(play, post, keeps, now)` holds. The character layer does the same: the author's plays at character
  reach, not reversed, for which `fallsOn` holds with the post's `createdAt`. `useUntil` already redraws at the end.
- **`EffectProps.kept?: true`** (`types.ts`, line 163): "every play handed has worn off, and falls on this post because
  the post was written while it was up (`CardRules.keeps`). An effect may draw what such a play left behind rather than
  the play going off." `BoundEffect` passes it when every play in its wrap has `ends` at or before `now`. It is absent
  for a live play, a post-reach play and a moment.
- **Marks.** A character play's marks are drawn on every postbit of the character (`Post.tsx` line 202,
  `PostMarks post={act.character}`), and Part 2's `markedPlays` keeps an ended play of a card that keeps. After its end
  a character play's mark is drawn only on the postbits of the posts it falls on: `PostMarks` takes the post's date
  (`postAt`) where its `post` is a character, and `markedPlays` drops an ended keeping play at character reach whose
  window does not hold `postAt` (by `fallsOn`). A kept mark opens the Lens, whose ended words are Part 2's.
- **The log** (`lines.ts`, the timed end, lines 764 to 771): for a card whose rules `keep`, the `gimmickEnded` row's
  details end `` ` ended. Posts written while it was up keep it.` `` in place of `' ended.'`. Any other card's line is
  as it was. This is the caster's log; the target player's log carries the card's `logPlay` (Task 5).

Tests first:

- `kept.test.tsx`: under a live character play of a `keeps` card every post by that character is wrapped, without
  `kept`; after its end (fake timers past `ends`) only that character's posts dated inside the window are wrapped, with
  `kept`, and another character's post dated inside it is not; a reversed play wraps none; a card that does not keep
  wraps none after its end.
- `plays.test.tsx`: an ended keeping character play is marked for a `postAt` inside its window and not for one outside;
  a live one is marked for both.
- `lines.test.tsx`, beside the `gimmickEnded` tests (line 471): an ended play of a keeping card says the kept sentence;
  of another card, the line as today.

## Task 5. Divided World: Glitter Bomb keeps, says so, and loads a kept post settled

Model: sonnet

**Files:** `instances/divided-world/cards/glitter-bomb.ts`, `instances/divided-world/cards/cards.test.ts`,
`instances/divided-world/ui/cards.ts`, `instances/divided-world/ui/glitter-bomb/Effect.tsx`,
`instances/divided-world/ui/glitter-bomb/Effect.test.tsx`, `instances/divided-world/ui/glitter-bomb/Glitter.board.stories.tsx`.

- `glitter-bomb.ts`: `keeps: true`. The header comment says a post written during the week keeps its glitter for good,
  that the database and the screens work that out from dates alone, and names this design.
- `ui/cards.ts` (line 376): `summary` and `describe` are the design's section 6 words, `describe` keeping
  `${glitterBomb.rarity}`, `${spanWords(glitterBomb.lasts!)}` for "a week" in its first sentence and
  `${setMoveWords("the quoting post's character")}`; `status` is unchanged. A new
  `logPlay: () => 'Posts that character writes before it ends keep their sparkle for good.'`
- `Effect.tsx`: the effect reads `kept` at mount and, where it is set, starts as a post that has already fired: `fired`
  (line 104) is `still || kept`, so no burst point is watched and the flakes are built landed, while the loop, the
  glints, cling and shake run as for any live post. `kept` is read through a ref, never in the effect's dependencies, so
  a post on screen when the week ends is not built again (its glitter would jump to a new load's seed); the next load
  draws it settled. The header comment says so.
- The board stories gain a kept scene, a post loaded after the week.

Tests first:

- `cards.test.ts` (line 219's test): Glitter Bomb keeps; `instanceProblems` of the whole instance is empty (red until
  Task 1 widens the check, which is the red run for the card).
- `Effect.test.tsx`, beside the burst tests (line 199) and reduced motion's (line 240): with `kept`, every flake is
  placed at once, no burst point is watched and nothing is drawn over the words, while cling registers and the loop
  draws the lit flakes; a rerender that sets `kept` on a mounted post builds nothing again and keeps its seed.

## Task 6. In a browser, and the whole build

Model: sonnet

**Files:** `e2e/glitter.spec.ts`.

A kept post in a thread on the fake backend: a Glitter Bomb on a character, worn off, with one post of theirs written
inside the window and one before it. The post inside shows its glitter settled with no burst; the post before shows
none; the postbit of the post inside carries the card's mark, and its Lens says the ended words. Then
`npm run typecheck` and `npm run build:ci`, each with its output, and the SQL tests against Postgres on localhost.

## Ways out

- **A Glitter Bomb, up:** ends by itself at its week, or by an admin's end, as today.
- **Kept glitter:** decoration over words that stay readable; an admin can end the play at any time after its week,
  which takes it off every post (Part 2's `reverse_card`, Task 2's test).

## The masks

- `thread_page`'s character rows in `kept`: from `play_reach`, the plays' public Acts and the posts' public dates and
  authors; the same document for every caller (Task 2's test). The author a row is matched on is the post's character,
  which every reader sees on its postbit; nothing reads who owns it.
- `EffectProps.kept` and the marks: dates the page already holds.
- The glitter's seed is the play's and the post's ids, then the mount's own draw, as today.

## A busy instance

- **A page's read** gains one range scan of `play_reach_character` for each distinct author on the page (at most
  `postsPerPage`, 20 in Divided World), from the page's earliest post date. A character carries one Glitter Bomb at a
  time, so each scan meets about one row for each week the page's posts span, and the read returns at most 100.
- **Drawing:** one glitter for each kept post in view, under the page's one loop; nothing more than a live bomb costs.
- **Nothing is written** for a post, at the week's end or ever.

## Decided in planning

- **A kept play's mark is drawn on the postbits of the posts it falls on**, not on every postbit of the character (as
  a live one is) and not on none, so a reader who sees old glitter can open the Lens and read what did it. A live
  play's marks are as today.
- **A post on screen when the week ends keeps its glitter as drawn.** It becomes settled on its next load.
- **Kept glitter is drawn in the post's thread only**, as Part 2 decided for Glam.

## Review focus

- **The author match in `kept`.** A character play kept must fall only on posts by that character, never on another
  author's post in the same window on the same page; read the CTE's join, not only the test.
- **Acts an instance already holds:** every worn-off Glitter Bomb before this change starts keeping on the posts its
  character wrote during its week, once this lands. That is the design's intent (no stored fact changes), but the
  reviewer confirms nothing else turns on a worn-off Glitter Bomb.
- **A page spanning years:** the scan's lower bound is the page's earliest post date, so an old page reads old windows
  only; confirm with `explain` on a character with many worn-off plays.
- **The remount at the week's end:** a post in view as `kept` flips is not rebuilt, and a post that leaves view and
  returns after it builds landed from the same seed.
- **Glam's thread rows** in `kept` still come back exactly as Part 2's test expects after `thread_page` is rewritten.
