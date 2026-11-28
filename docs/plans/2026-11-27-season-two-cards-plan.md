# Season Two cards: the plan

Record, written 2026-11-28. Carries out `docs/plans/2026-11-27-season-two-cards-design.md`: five cards (Heads Will Roll,
Console Slog, Tune It Out, AdFlock Minus, Present For You), the engine they need, Hot Box's move to the row and You Were
Saying?'s font. Fifteen tasks, in order; the engine tasks come before the cards that use them. Each goes test first, with
its red run shown. Postgres on localhost only. Run `npm run typecheck` and `npm run build` once after the last task, with
the tail in the PR. No task changes an Act already written, and none touches a deployed database.

The benches (`docs/research/2026-11-27-heads-will-roll/`, `docs/research/2026-11-28-console-slog/`,
`docs/research/2026-11-28-tune-it-out/`, `docs/research/2026-11-28-adflock/`) are the look and feel to match, opened in a
browser; their code is a reference, never copied. Every number below is a starting value the owner may tune in settings.

Line numbers are as of `b1e124ee` and may have moved; the function names are what to find.

**Release.** One release. The new settings keys are fields old functions drop until theirs land, and the new card kinds and
the gift's table arrive by migration before the seed (`docs/plans/2026-11-27-release-order-design.md`).

**Scope of each PR.** The build may land this as one PR or as a few in task order (tasks 1 to 4, then 5 to 9, then 10 to
15); each PR says which tasks it carries.

## Task 1. Row layers in the instance's order

Model: sonnet

- **`engine/ui/cards/types.ts`**: `CardUi.fillsRow?: true` beside `coversRow` (about line 467), documented: the engine mounts
  the card's `Effect` over the post's whole row (`div.kb-row-layer`, inside the row's grid as `kb-row-cover` is) instead of
  around the words, in a thread's post; where a post has no row (ORIGIN box, front door, moment, History) it wraps the words
  as any effect does. It makes nothing inert. A card is never both `coversRow` and `fillsRow`.
- **`engine/ui/types.ts`**, `InstanceUi` (about line 466): `rowOrder?: readonly string[]`, the keys of every card that covers or
  fills the row, outermost first. The fold (`foldsRow`) is outside all of them and is not listed.
- **`engine/ui/thread/cover.tsx`**, `useRowCovering` (about line 39): the `.reverse()` at about line 44 becomes a sort by
  `rowOrder` rank, ties (a stack of one card) latest first, as now. Update its header comment.
- **`engine/ui/cards/Effects.tsx`**, `nestOrder` (about line 440): `covers` becomes the row layers, covers and fills both,
  ranked by `rowOrder` (it gains the order as an argument; its three callers pass `ui.rowOrder`). Where there is a row, a
  `fillsRow` card's Effect is mounted in the row layer in its rank, inside every cover ranked outside it, so a shut cover
  keeps it `covered`.
- **`engine/ui/thread/Post.tsx`**: mounts the fill layers (`useRowFilling`, beside `useRowCovering` in a new
  `engine/ui/thread/fill.tsx`), each given `EffectProps` as a post's effect is.
- **`engine/ui/tips/problems.ts`**, beside `coversRowProblems` (about line 146): `rowOrderProblems(ui)`: a covering or filling
  card missing from `rowOrder`; a `rowOrder` key that is no card, or a card that neither covers nor fills; a key listed twice;
  a card both covering and filling. Each in plain words naming the key.
- **`instances/divided-world/ui/index.ts`**: `rowOrder: ['tune-it-out', 'its-curtains', 'hot-box', 'adflock-minus']` once those
  cards exist; until Task 9, `['its-curtains']`, with each later task adding its key in its place.
- **Tests first.**
  - `engine/ui/tips/problems.test.ts`: the guard is driven red on each poison before it passes: a covering card left out of
    the order; a fill left out; a key that is no card; a key of a card that neither covers nor fills; a key twice; a card
    with both flags. A clean order gives no problem.
  - `engine/ui/cards/Effects.test.tsx` (or the file holding `nestOrder`'s tests): with three test cards (a cover ranked
    outermost, a fill, a cover inside it) played in the reverse of their rank, `nestOrder` returns them by rank; two plays
    of one cover stay latest outermost.
  - `engine/ui/thread/cover.test.tsx`: the cover shown first is the outermost by rank, not the latest played.
  - Red run: `rowOrder` and `fillsRow` do not exist.

## Task 2. What a reader keeps

Model: sonnet

- **`engine/ui/cards/reader-memory.ts`** (new): `readerMemory<T>(play: Id, parse: (raw: unknown) => T | null)` returns
  `{ get(): T | null; set(value: T): void; clear(): void }`, keeping JSON in `localStorage` under `kb-reader:<play>`. Every
  read and write is in a `try`; a throw or a value `parse` refuses falls back to a `Map` in the page's memory. It sends
  nothing. Its header says what may go in it (a reader's own progress on a play) and what never may (anything another
  reader's screen or the server reads).
- **`engine/ui/cards/index.ts`** (or wherever the cards' kit is exported) re-exports it.
- **Tests first** `engine/ui/cards/reader-memory.test.ts`: a value set is got back; another play's key is separate; a
  storage that throws on `getItem` and `setItem` still keeps the value for the page; a stored value `parse` refuses reads
  as null; `clear` removes it. Red run: the module does not exist.

## Task 3. A card that draws the reactions

Model: sonnet

- **`engine/ui/reactions/Reactions.tsx`**: extract `useReactionRow({ act, author, authorName, tallies, mine, subject, plays })`
  holding everything the row does now (chips via `useReactionChips`, own kinds, `usePending`, `useReactionSend`, the cap and
  one-of-a-kind rule, the refusal note, the stamp's landed kind, the picker's open state). It returns
  `{ chips, own, pending, press(kind), undo(kind), refusal, landed, picker: { open(anchor, onlyNew?), close(), node } }`.
  `Reactions` draws with it; its behavior and every existing test stay as they are.
- **`engine/ui/reactions/Picker.tsx`**: an `onlyNew?: true` prop leaves out kinds already on the post (the chips' kinds and
  the post's local kinds).
- **`engine/ui/cards/types.ts`**: `CardUi.drawsReactions?: true`, and `EffectProps.reactions?: ReactionDeck` (the hook's
  return, minus the stamp's drawing), given only to a card that draws the reactions, on its post's own reach, in a thread's
  post and in the ORIGIN box.
- **`engine/ui/thread/Post.tsx`** (about line 134): while a live play of a `drawsReactions` card is on the post's own reach,
  the post calls `useReactionRow` itself, passes it to the effects, and draws the row's bar with one line instead of tiles:
  "This post's reactions are loose inside it." On the author's own screen the deck's tiles are plain, as now.
- **`instances`-free.** The engine names no card.
- **Tests first** `engine/ui/reactions/Reactions.test.tsx` and `engine/ui/thread/Post.test.tsx` (or the files holding them):
  - every existing reactions test passes unchanged against the extracted hook;
  - a test card with `drawsReactions` live on a post: the row shows the line and no tiles; its Effect is given a deck whose
    `press` sends after the grace, and whose second `press` of a pending kind undoes it, sending nothing;
  - the picker opened with `onlyNew` lists no kind already on the post;
  - a play of the card that has ended gives the row back.
  - Red run: `drawsReactions` does not exist.

## Task 4. A card wrapped in another, in the rules and the fake

Model: sonnet

- **`engine/rules/cards.ts`**:
  - `CardRules.wraps?: true`, documented as the design's section 1.4. `faceUpOnly` (about line 824) is true for a wrapper.
  - `giftProblem(wrapper, gift, config)`: refuses a gift that is not a Move (`playOf(gift) !== 'cast'`), one that does not
    reach a post, one that is itself a wrapper, or one whose `validateConfig` refuses the configuration, each in plain words
    ("a present holds a Move that is cast on a post", "a present can't hold another present").
  - `staffOffers` (about line 1058) is false for a wrapper.
  - `instanceProblems` (`engine/rules/instance.ts`): a wrapper that stacks more than 1, or reaches anything but a post, is a
    problem.
- **`engine/ui/data/api.ts`**: `playCard` gains an optional `gift?: { readonly card: string; readonly config: Readonly<Record<string, unknown>> }`,
  sent apart from `config` so it never joins the box's payload; `openGift(box: Id): Promise<Answer<{ readonly box: Id; readonly did: 'landed' | 'returned'; readonly gift: Act | null; readonly why: string | null }>>`.
- **`engine/ui/data/fake.ts`**: a `gifts` map keyed by box play holding `{ account, card, config, paid }`, read only by the
  giver's own calls. `playCard` with a gift: refuses without one for a wrapper and with one for any other card; takes both
  cards from the hand; checks `giftProblem`; charges the box's price plus the gift's `playPrice` on the target. `openGift`:
  refuses anyone but the post's author ("only this post's author can open it"); writes the open; ends the box's play; frees
  its slot; tries the gift through the same landing as a cast by the giver's character at no price; on a refusal returns the
  gift to the giver's hand with `did: 'returned'` and the refusal's words as `why`. An admin end of an unopened box returns
  the gift to the giver.
- **Tests first** `engine/rules/cards.test.ts` (each refusal of `giftProblem`; `faceUpOnly` and `staffOffers` for a wrapper),
  `engine/rules/instance.test.ts` (the two problems), and a fake test beside the fake's play tests: a box takes two cards and
  charges its price plus the gift's; the box's Act and payload hold no gift; a non-author's open is refused; the author's
  open lands the gift as the giver's play and frees the box's slot; a gift a ward turns away comes back to the giver's hand
  with the ward's words; an admin end returns the gift. Red run: `wraps` does not exist.

## Task 5. A card wrapped in another, in the database

Model: sonnet

- **Migration** `supabase/migrations/0455_gift_boxes.sql` (the next free number above main's newest), with a header listing
  each function as copied whole from its latest definition:
  1. `card_kinds.wraps boolean not null default false`; `card_kinds_problem` (latest `0413_rewind.sql`) refuses a wrapper
     that stacks above 1 or reaches anything but a post.
  2. `create table gift_box (box uuid primary key references acts(id), account uuid not null, card text not null, config jsonb not null, paid bigint not null, at timestamptz not null default now())`,
     append-only with the `ledger_append_only` triggers `face_down` carries (0054), and row security so an account reads
     its own rows alone. An opened or ended box is told by the open or end Act, never by editing the row.
  3. `seed_instance`, copied whole from `0454_final_clears.sql`: `wraps` joins the card insert from the seed's `wraps`.
  4. `place_cast`, copied whole from 0454 (about line 550), and `play_card`, copied whole from
     `0438_board_cards_on_their_board.sql` (about line 518): each gains `gift_card text default null, gift_config jsonb default null`.
     A wrapper without a gift, or a gift on any other card, raises in plain words. With a gift: the giver holds it (the hand's
     check, as for the box), it is a Move that reaches a post and wraps nothing, both cards leave the hand, the price is the
     box's plus the gift's play price on the target as the caller computed it and the server checks it as it checks any
     play price, and a `gift_box` row is written. The box's Act payload is the box's alone.
  5. `open_gift(who uuid, box uuid)` (new, security definer, callable by the authenticated role through the API's usual
     wrapper): locks in the order 0054 states (the account, then the post, then the box's row); refuses a caller who does
     not own the post's character ("only this post's author can open it"), a box already opened or ended, and an admin-ended
     one; writes an `open_gift` Act (append-only, kind added to the Act kinds as `spring` was) and ends the box's play as a
     card end does; then lands the gift through `place_cast`'s landing with the giver's character as caster, no price and
     `marker` naming the open; on a refusal, returns the card to the giver's hand as the refund outcome does
     (0397_refund_outcome.sql) and records `did: 'returned'` and the refusal's words on the open Act.
  6. The admin's end of a box (`reverse_card` or its latest form): returns the gift to the giver's hand.
- **`supabase/functions/_shared/seed.ts`**: `wraps: c.wraps === true`, and its type and test.
- **`engine/ui/data/`**: the Supabase client's `playCard` passes `gift_card`/`gift_config`; `openGift` calls `open_gift`.
- **SQL test first** `supabase/tests/0455-gift-boxes.sql`, on the harness the 0411 and 0454 tests use, with a test wrapper
  card and two Moves (one that draws, one with a length price): every refusal above; the box's Act and every view another
  account can read hold no gift key, config or price beyond the box's; another account cannot select from `gift_box`; the
  author's open lands the gift as the giver's play and frees the box's slot on a full post; a ward on the post at the open
  returns the gift with the ward's words; a second open is refused; an admin end returns the gift. Red run: the table and
  functions do not exist.

## Task 6. Heads Will Roll's rules and orbit

Model: sonnet

- **`instances/divided-world/cards/heads-will-roll.ts`**: the design's section 2.4. Pepperoni, rare, `stack: 1`,
  `drawsEffect: {}`, `reads` none, `screenReads` for `headsWillRoll.overMass` (1 to 5, 2), `headsWillRoll.suns` (whole, 1 to 4,
  2), `headsWillRoll.mostTurns` (0.05 to 3, 0.5), `headsWillRoll.reelBase` (0 to 5, 0.8), `headsWillRoll.reelPerSpeed` (0 to 1,
  0.12); `price` 300; its `seen`; `validateConfig: () => ok({})`. Defaults in `instances/divided-world/settings.ts`
  `cardSettings`. One line each in `cards/index.ts` and `cards/cards.test.ts`'s table.
- **`instances/divided-world/ui/heads-will-roll/orbit.ts`** (pure TS): `createOrbit(box)`, `setHeads(heads)` (mass, size,
  whether Overreaction), `step(dt)` and `project()` returning each head's screen centre, scale, depth order and angle. The
  rules of section 2.2: suns by mass; satellites to the nearest sun, heavier nearer; ring fit to the box; suns steered home
  at their drift speed and parted by similarity of mass; walls that keep room at zero or more and turn a sun back inward;
  the roll from sideways travel, eased and capped; a fit of the box's corners so a head is never past a border. The
  bench's Space mode is the reference for the numbers it starts from.
- **Tests first** `orbit.test.ts`: on a 200 px wide box (a phone's) and a 900 px one, run 60 s of steps: no head's projected
  box crosses the area's borders; no head moves more than 4 px between two steps of 1/60 s (the bench's flicker read as
  ~90 px); the angle never turns faster than the cap; two suns of equal mass end at least the sum of their sizes apart; a
  satellite stays on its sun's ring. A test that a sun's clamp with negative room once flipped it (a box narrower than the
  system) shows the fit holds. Red run: the module does not exist.

## Task 7. Heads Will Roll's screen

Model: sonnet

- **`instances/divided-world/ui/heads-will-roll/Effect.tsx`**: fills the content area with the space ground and starfield,
  the words over it in light ink with a shadow; the deck's chips as round heads (buttons) positioned by the orbit each frame
  through `transform` alone; the React head opens `deck.picker.open(anchor, true)`; a pointer press is `deck.press`; Enter
  or Space starts the reel-in (section 2.3), drawn as a thin bar under the head, a second press cancels; under `still` the
  heads stand still and every press reels in. Tab order heaviest first. Each head's label: "{emoji} {count}, press to
  catch" (and ", an Overreaction" for a local kind, ", yours" for the reader's own).
- **`instances/divided-world/ui/cards/heads-will-roll/ui.ts`**: `drawsReactions: true`, its summary, hint, describe and
  status, its Lens view (what it does; how the reel-in works by key).
- **Tests first** `Effect.test.tsx`: with a deck of three kinds, three heads and a React head render in mass order; a
  pointer press calls `press` once; Enter starts a reel-in and calls `press` after the computed time (fake timers); a second
  Enter cancels it; under `still` a pointer press reels in too; the React head opens the picker with `onlyNew`. Red run:
  the effect does not exist.

## Task 8. Console Slog, and You Were Saying?'s font

Model: sonnet

- **`instances/divided-world/cards/console-slog.ts`**: Salty, common, `stack: 1`, `drawsEffect: {}`, `reads` for
  `consoleSlog.perLength` (25), `consoleSlog.lengthStep` (500), `consoleSlog.mostAdded` (200), `playPrice` as Whoops!'s
  (`instances/divided-world/cards/whoops.ts`, about line 56); `screenReads` for `consoleSlog.rhythmMs` (150 to 1,500, 450),
  `consoleSlog.perStep` (whole, 1 to 20, 5), `consoleSlog.mostPerPress` (whole, 1 to 24, 8), `consoleSlog.drain` (1 to 60, 12),
  `consoleSlog.bands` (whole, 4 to 40, 16); `canApply` refuses a post with no words of its own, as You Were Saying? does;
  `price` 100; its `seen`.
- **`instances/divided-world/ui/console-slog/slog.ts`** (pure): `unitsOf(nodes)` turns the post's parsed BBCode
  (`engine/ui/bbcode/`) into the units a press reveals (a character; a quote line's `> `; a link's text then ` [address]`;
  an image's `[IMG] name` line then its bands); `pressWorth(streak, settings)`; `nextStreak(streak, sinceLastMs, settings)`;
  `drained(streak, idleMs, settings)`.
- **`instances/divided-world/ui/console-slog/Effect.tsx`**: the terminal over the content area (section 3.2), a `button`-role
  region labelled "Console Slog: press any key or tap to type out this post"; keydown with `repeat` ignored, pointerdown;
  progress in `readerMemory(play)`; at the last unit, `release(play)`; a released reader sees the post as written. A link
  works once all its units are out.
- **`instances/divided-world/ui/cards/console-slog/ui.ts`**: summary, hint, describe, status, Lens.
- **You Were Saying?**: `instances/divided-world/cards/you-were-saying/tail.css` (about line 14) sets Verdana
  (`Verdana, Geneva, sans-serif`); the cursor's offsets at about line 69 are measured again for Verdana; the comments at
  line 3 there and in its `Effect.tsx` header say Verdana.
- **Tests first** `slog.test.ts` (units of a post with a quote, a link, code and an image; the momentum's steps, cap and
  drain), `console-slog.test.ts` (price by length, capped; the refusal of a post with no words), and `Effect.test.tsx` (a
  key press reveals one character, a repeat none; twenty quick presses reveal more each; progress survives a remount from
  reader memory; the last unit calls `release`; a released play draws the post). Red run: none of it exists.

## Task 9. Hot Box over the row

Model: sonnet

- **`instances/divided-world/ui/cards/hot-box/ui.ts`**: `fillsRow: true`; `instances/divided-world/ui/index.ts`'s `rowOrder`
  gains `'hot-box'` after `'its-curtains'`.
- **`instances/divided-world/ui/hot-box/Effect.tsx`** and `fog.ts`/`paint.ts`: the smoke's box is the layer's (the row's)
  where there is a row, the content area's where there is not. "Air it out" sweeps the row's lines (the postbit's and the
  words' together, top to bottom by the row's height); the saved `{ aired }` is a share of the row's height. Update the
  comments that say content area.
- **`docs/plans/2026-11-27-lasting-gags-design.md`** is a record and is not edited; this design's section 7 is the revision.
- **Tests first** (beside Hot Box's existing effect tests): in a thread the smoke's box is the row (postbit included); in
  the ORIGIN box it is the content area; an author's sweep saves a share of the row's height; a reader's pointer still
  parts the smoke over the postbit. Red run: the smoke is the content area's.

## Task 10. Tune It Out

Model: sonnet

- **`instances/divided-world/cards/tune-it-out.ts`**: Salty, uncommon, `stack: 1`, `drawsEffect: {}`, `price` 150, its `seen`;
  `screenReads` for `tuneItOut.snowWidth` (0.03 to 0.5, 0.18), `tuneItOut.rollWidth` (0.18), `tuneItOut.tolerance` (0.005 to
  0.1, 0.025), `tuneItOut.step` (0.002 to 0.03, 0.008), `tuneItOut.turns` (0.5 to 4, 1.5), `tuneItOut.channels` (whole, 0 to 6,
  3), `tuneItOut.channelWidth` (0.02 to 0.2, 0.08), `tuneItOut.segmentMs` (3,000 to 20,000, 12,000), `tuneItOut.mostRoll` (0.2
  to 6, 2.2).
- **`instances/divided-world/ui/tune-it-out/tuning.ts`** (pure): `signal(dials, station, channels, settings)` returning the
  station the fine tuning is nearest (the post or a channel), the snow and the roll (0 to 1), and whether it is locked;
  `slip(channel, station, random)` moving a channel away from the post's station.
- **`instances/divided-world/ui/tune-it-out/Cover.tsx`**: `coversRow: true`. The screen (a picture of the post at the row's
  size, rolled and snowed; a canvas of noise frames made once; the channel's video or drawn placeholder), the two dials as
  `slider`s (drag round, wheel, arrows, Page Up/Down) and the lamp, beside the screen and under it on a phone; the reveal
  (section 4.2) and its reduced-motion crossfade; station and dials in `readerMemory`, the lock in `release` and the cover's
  open. A released reader is never covered.
- **`instances/divided-world/ui/tune-it-out/channels.ts`**: the instance's channel list, `{ key, caption, video?: { webm, mp4 }, draw? }`;
  until the clips arrive, the three drawn placeholders of the bench (bars and tone, test card and beep, weather and chord).
  A clip loads (`preload="none"`, then `"auto"` for the nearest) only once the post is near the view.
- **Sound** (`instances/divided-world/ui/sounds.ts`): a `tuneItOut.hiss` loop made from noise (a generated buffer through the
  mixer, no file; if the mixer takes only files, add the smallest engine hook for a generated loop in
  `engine/ui/audio/mixer.ts`, with a test), captioned "[static hiss]"; each channel's sound as a loop slot with its caption.
  The hiss's gain is the share of the post in view times the snow; a channel's is its signal against the snow, as the
  picture's. `CardUi.sounds` lists them.
- **`instances/divided-world/ui/cards/tune-it-out/ui.ts`**: `coversRow: true`, `Cover`, summary, hint, describe, Lens (the
  dials' state in words: "Snow heavy, picture rolling").
- **`instances/divided-world/ui/index.ts`**: `rowOrder` gains `'tune-it-out'` first.
- **Tests first** `tuning.test.ts` (each dial alone moves its own fault; the lock needs both in tolerance; a channel's
  station wins the picture near it; a slip moves it away from the post), `tune-it-out.test.ts` (the card's rules), and
  `Cover.test.tsx` (arrow keys move a dial by the step and set its `aria-valuenow`; a lock calls `release` and opens the
  row; a remount keeps the dials from reader memory; a released reader sees no cover; the hiss's gain follows view and
  snow, with a fake mixer). Red run: none of it exists.

## Task 11. AdFlock Minus

Model: sonnet

- **`instances/divided-world/cards/adflock-minus.ts`**: Salty, rare, `stack: 1`, `drawsEffect: {}`, `price` 300, its `seen`;
  `screenReads` for `adFlock.cover` (0.2 to 1.6, 1.1), `adFlock.most` (whole, 2 to 16, 9), `adFlock.overhang` (whole, 0 to 40,
  14), `adFlock.spawns` (whole, 0 to 8, 3).
- **`instances/divided-world/ui/adflock/ads.ts`**: the instance's ads, `{ key, look: 'classic' | 'loud' | 'chat' | 'slick', title, art, text, cta, decoy: null | 'dodge' | 'hydra' | 'nothanks', noThanks? }`,
  `art` an emoji or an image path; seeded with the bench's eleven as placeholders, marked so in a comment.
- **`instances/divided-world/ui/adflock/deal.ts`** (pure): `deal(ads, wordsBox, settings, random)` choosing a hand to cover
  the share and placing one window to each jittered grid cell; `clampTo(layerBox, window)`.
- **`instances/divided-world/ui/adflock/Effect.tsx`**: `fillsRow`; the layer is the row plus the overhang, clipped there; the
  windows (`role="dialog"`, labelled by title), title-bar drag and arrow keys, the three decoys, the call to action's
  pop-up, the spawn limit per load, a dodge that jumps under `still`. A new deal on each mount (each load). Starts only once
  the post is uncovered.
- **`instances/divided-world/ui/cards/adflock-minus/ui.ts`**: `fillsRow: true`, summary, hint, describe, Lens.
- **`instances/divided-world/ui/index.ts`**: `rowOrder` gains `'adflock-minus'` last.
- **Tests first** `deal.test.ts` (covers at least the share of the words' box on a wide and a narrow box with a fixed random;
  never more than `most`; every window inside the layer), `adflock-minus.test.ts`, and `Effect.test.tsx` (a plain ad's ×
  closes it; a dodge's closes on the third press; a hydra's closes it and opens another until the spawns are spent, then
  just closes; a no-thanks ad's × does nothing and its line closes it; arrow keys on a focused title bar move the window;
  nothing renders while `covered`). Red run: none of it exists.

## Task 12. Present For You's rules and screen

Model: sonnet

- **`instances/divided-world/cards/present-for-you.ts`**: Pepperoni, uncommon, `stack: 1`, `wraps: true`, `drawsEffect: {}`,
  `reaches: ['post']`, `price` 150, its `seen` (the design's section 6, never naming the gift); `playPrice` the gift's
  `playPrice` on the target where the configuration carries it (the client computes it; the server checks it).
- **`instances/divided-world/ui/present-for-you/ConfigForm.tsx`**: lists the Moves in the player's hand that `giftProblem`
  allows on this post, then shows the chosen card's own `ConfigForm` for the target; the total price is the box's plus the
  chosen card's play price. It passes the gift to `playCard` as `gift`, never inside `config`.
- **`instances/divided-world/ui/present-for-you/Effect.tsx`**: the wrapped box under the words, ribboned in the Pepperoni
  ink; on the author's own screen an **Open** button calling `openGift`, with a short unwrap (reduced motion: none), then the
  page reads the gift's play; to every other reader the line "A present for {author}". A refusal of the open is shown in
  plain words under the button.
- **Log lines** (`engine/ui/log/lines.ts`, beside `sprung` and `returned`): a box left ("left a present on this post"), a box
  opened (naming the gift), a gift returned (with `why`), and the giver's own line naming what they wrapped. Engine words,
  naming no card.
- **`instances/divided-world/ui/cards/present-for-you/ui.ts`**: summary, hint, describe, `ConfigForm`, Lens.
- **Tests first** `present-for-you.test.ts`, `ConfigForm.test.tsx` (only allowed Moves are offered; the price adds; the gift
  goes as `gift`), `Effect.test.tsx` (the author sees Open and the open calls `openGift`; another reader sees the line and
  no button), and the log lines' tests. Red run: none of it exists.

## Task 13. The cards' art

Model: sonnet

Five folders under `instances/divided-world/ui/cards/` (`heads-will-roll`, `console-slog`, `tune-it-out`, `adflock-minus`,
`present-for-you`), each with `art.webp` (1080×1680), `mark.svg`, `art.json` (`credit: "Divided World"`, Hot Box's license
string) and its scene, made as `instances/divided-world/ui/cards/README.md` and `specs/card-art.md` say:

- **Heads Will Roll:** emoji heads as glossy balls rolling across a starfield, the largest a sun with smaller ones in orbit.
- **Console Slog:** a beige CRT on a desk, a green prompt and a half-typed line, a keyboard with worn keys.
- **Tune It Out:** a wood-cabinet TV of snow, two brass dials, a hand on one.
- **AdFlock Minus:** a flock of pop-up windows flying like birds across a sky.
- **Present For You:** a wrapped box with a big bow on a forum post, a question mark in the ribbon's shadow.

The marks: a ringed head, a prompt chevron with a cursor, a dial, a pop-up window with a ×, a bow. `node
tools/check-card-art.mjs` passes. Each picture is shown to the owner in the PR and is theirs to approve.

## Task 14. Browser checks

Model: sonnet

**Files:** `e2e/season-two-cards.spec.ts`, and one case each in `e2e/origin-effects.spec.ts`.

- **Heads Will Roll:** heads orbit inside the content area and never past it at desktop and phone width; a click catches a
  head and its count rises after the grace; Tab then Enter reels one in; under reduced motion the heads stand still.
- **Console Slog:** key presses type the post; a held key types one character; a reload keeps the place; the last character
  shows the post.
- **Tune It Out:** the row is covered and inert; arrow keys turn each dial and the snow or roll changes; locking reveals the
  post; a reload shows it tuned.
- **AdFlock Minus:** windows cover the row and not the posts around it; a drag moves one; each decoy behaves; a reload
  deals again.
- **Present For You:** the giver plays it with a gift; another reader sees the box and no Open; the author opens it and the
  gift draws.
- **The order:** a post with Tune It Out, It's Curtains, Hot Box and AdFlock Minus shows the TV first, then the curtain,
  then the smoke, then the ads.
- An axe check over a page with each card passes.

## Task 15. The words' review

Model: inline

Every summary, hint, describe, Lens line and log line added above is read once against "The fiction may lie; the log never
does": the log lines name the Act, what changed and how much Aura moved, plainly, and none names a gift before it is opened
to anyone but its giver. American English throughout.

## Review focus

- What Hot Box's move to the row does to plays already up: their saved `aired` is read as a share of the row.
- The gift's privacy at every surface: the box's Act, the play's payload, `card_target`, the Lens, the thread page's read,
  Realtime events, the price, and the timing and words of `open_gift`'s refusal.
- `open_gift` racing a second open, an admin's end, or a cast that fills the post's last slot between the box's end and the
  gift's landing; and the lock order against `place_cast`'s.
- Heads Will Roll at a busy post: dozens of kinds and a thread of such posts, each running its own orbit; whether off-screen
  posts stop stepping.
- Tune It Out on a thread of many such posts: only the post in view loads a clip or runs the hiss.
- The extracted `useReactionRow`: every behavior of the row unchanged, the reaction grace's privacy included.
- Reader memory never read by anything but the reader's own screen, and a release that adds nothing anyone else can count.
- AdFlock Minus's windows never covering another post, the HUD or the page's controls, at every width.
