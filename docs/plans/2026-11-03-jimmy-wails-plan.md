# Jimmy Wails: plan

Record, written 2026-11-03. The plan for `docs/plans/2026-11-03-jimmy-wails-design.md`. It is built by one build session in
one PR, from `main`.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added.

**The boundary check holds:** nothing in `engine/` or `supabase/` names Jimmy Wails, a plate or Wikipedia. The engine
gains a draw from a pool, a drive and the `donation` Act kind. The instance gives them their content.

**One migration:** the next free number in `supabase/migrations/` as `NNNN_drives.sql`, with its SQL test as the next free
number in `supabase/tests/` as `NNNN-drives.sql`, run against Postgres on localhost. The Autocorrect plan's migration may
land first, and its numbers are taken in order.

## Task 1. A draw and a drive in a card's rules (engine)

**Files:** `engine/rules/cards.ts`, `engine/rules/instance.ts` (`instanceProblems`); tests `engine/rules/cards.test.ts`,
`engine/rules/instance.test.ts`.

**`CardRules` gains:**
- `draws?: readonly string[]`: keys the server draws one of at each play, stored on the play's payload as `drawn`.
- `drive?: { lasts: Span; gifts: readonly string[]; overhead: string }`: the card's plays on a post share a drive.
  `gifts` are the economy keys of the amounts a gift may be, and `overhead` the economy key of The System's percentage.

**`CardEffect` gains** `drive?: string` (the drive's id) and `closes?: string` (its computed close, an ISO time).

**Helpers:**
- `openDrive(effects, key, now)`: the open drive of card `key` among the effects, with its plays, or none.
- `giftSplit(amount, overheadPercent)`: `{ overhead: ceil(amount × pct / 100), arrives: amount − overhead }`, in
  hundredths. It is shared by the screens' preview and the tests that pin the SQL to it.

**`instanceProblems`** refuses:
- `draws` that is empty, holds a duplicate, or holds a key that is not `[a-z0-9-]{1,40}`
- `drive` on a card that is not a Cast reaching only a post
- a `gifts` key or `overhead` key the economy does not hold
- a gift that is not a positive whole number at most the wallet's cap
- an overhead outside 0 to 100
- `lasts` that is not a whole number of minutes, days or weeks, at most 30 days

Tests first:
- Each refusal, driven red by a seed holding the defect, one per line above.
- `giftSplit` at 10, 25, 50 and 100 with 25%, and at 0% and 100%.
- `openDrive` finds the drive whose `closes` is after now, and none when every drive has closed.

## Task 2. The drive and the draw in SQL (SQL)

**Files:** `supabase/migrations/NNNN_drives.sql` (new); test `supabase/tests/NNNN-drives.sql` (new).

**`card_kinds`** gains `draws text[]` and `drive jsonb`. `seed_instance` (last rewritten in
`supabase/migrations/0062_updates.sql`) writes them from the code. `card_kinds_problem` refuses what Task 1's
`instanceProblems` refuses, in the same words.

**`play_card`** (rewritten from its latest version):
- **The draw:** for a card with `draws`, the payload gains `drawn`: one key, drawn with `random()`. A `drawn` in the
  caster's config is dropped, as `seed` is.
- **The drive:** for a card with `drive`, under the post's lock it already takes, it finds the post's open drive of the
  card. A drive's close is the latest `created_at` of its plays plus `drive ->> 'lasts'`.
  - None open: the play opens one. Its payload's `drive` is its own id (`written`).
  - Open with fewer than `stack` plays: the payload's `drive` is that drive's id.
  - Open and full: refused, "this post's drive already carries N appeals" (`23505`, `kayfabb.refusal`).
- **A drive card's stack** is counted in the open drive only. The existing count stays for every other card.

**`card_target`** gives each drive play its `drive` and its `closes`, computed in one grouped read of the post's plays.

Tests first:
- A drawn key is one of the card's `draws`, and a config's `drawn` is ignored.
- A first play opens a drive. The second and third join it. A fourth is refused. A play after the close opens a new drive.
- The close moves back with each play.
- A seed with a bad `draws` or `drive` is refused, each in its words.
- Every other card's stack is unchanged (the existing `0054` and `0055` tests pass).

## Task 3. Gifts (SQL)

**Files:** the same migration and its test.

**The kind:**
- `acts_kind_check` admits `donation`.
- `acts_check1` requires its `target_act_id`, the drive's opening play.
- `acts_well_formed` requires a payload `{ amount, overhead, arrives }`, whole hundredths, with
  `amount = overhead + arrives`.
- `wallet_events_kind_check` admits `gift_out` and `gift_in`.

**`donate(who uuid, through uuid, drive uuid, amount integer) returns jsonb`**, `security definer`:
- `played_by(through, who)`.
- Lock the drive's post (`for no key update`), so a gift and a play that closes or opens a drive are ordered.
- Refuse, each in plain words with `kayfabb.refusal`:
  - a drive that is not a drive card's opening play
  - a closed drive: "this drive has ended"
  - an amount not among the card's `gifts` as the economy holds them now
  - a wallet short of the amount: "your wallet holds less than that", read from the giver's own wallet
- Split with the overhead read from the economy now (Task 1's `giftSplit`, in SQL).
- Find the post's author's account (`characters.owner`) inside the function. If the author is staff or The System
  (`is_staff_side`, `supabase/migrations/0043_staff.sql`), there is no account: `arrives` is 0 and `overhead` is the
  amount.
- Insert both wallets, then lock them in account order (`spring_traps`'s pattern). Write the `donation` Act. Then
  `wallet_move(giver, −amount, 'gift_out', null, gift)`, and, where there is an account, `wallet_move(author, arrives,
  'gift_in', null, gift)`. Where giver and author are one account, both moves land on the one wallet in that order.
- Return the gift's `act_projection` and the giver's own balance after. **Nothing about the author's wallet.**
- Grant `execute` to the service role only, as `play_card` is.

**Reads:**
- A partial index on `acts (target_act_id, created_at) where kind = 'donation'`.
- `drive_gifts(drives uuid[])` returns, per drive, its total, its count, and its latest 20 gifts (giver, amount, at).
- `drive_gifts_page(drive uuid, before timestamptz)` returns the next 20.
- Both are readable by `authenticated` and read only public columns.

**Settlement:** `settlement_input` (rewritten from its latest version, `supabase/migrations/0055_card_reach.sql`) leaves
`donation` out of every set it builds. That covers the window's Acts, the targets, the posts counted against the Lurker,
and the halving.

Tests first:
- A gift moves the amount out and `arrives` in, and the overhead is lost.
- At 0.10 and 25%, 0.03 is overhead.
- A full author wallet: the giver's answer is byte-identical to the same gift with room, and the author's `wallet_events`
  row records the overflow.
- A gift to one's own mask's drive costs exactly the overhead.
- A staff post's drive: all overhead, with no author wallet row.
- Each refusal, driven red: a closed drive, an amount not offered, a short wallet, a target that is not a drive.
- `settlement_input` over a window holding gifts equals the same window without them.
- A grant check: `authenticated` cannot call `donate`.

## Task 4. The act function and the screens' API (Edge Function, engine UI data)

**Files:** `supabase/functions/act/core.ts`, `supabase/functions/act/index.ts`, `engine/ui/data/api.ts` (and its
fixture and Supabase implementations beside it); tests `supabase/functions/act/core.test.ts`,
`engine/ui/data/*.test.ts` where the existing `playCard` tests live.

- **The `donate` action:** `{ character, drive, amount }`. It calls the SQL function and broadcasts the gift's projection
  on the thread's channel, as a play is broadcast. It never broadcasts a wallet.
- **The API:**
  - `donate(character, drive, amount)` returns the gift Act and the giver's balance after.
  - `driveGifts(drives)` and `driveGiftsPage(drive, before)` are the reads, batched for the page's drives.
- **The thread readers** skip `donation` Acts in a thread's list of posts, its counts, its unread marks and the reply
  trigger, as they skip `edit`. The build session finds every reader that lists a thread's Acts by kind (grep `kind` in
  `engine/ui/data/` and the `acts_public` readers) and names each in the PR.

Tests first:
- `core.test.ts`: `donate` calls the SQL function with its arguments, and the broadcast holds the gift's projection and no
  balance.
- The fixture API's `donate` follows Task 3's split and refusals, so the stories and the screen tests run against the same
  rules.
- A thread holding gifts lists the same posts, counts and unread marks as without them.

## Task 5. The drive on `EffectProps` (engine UI)

**Files:** `engine/ui/cards/types.ts`, `engine/ui/cards/Effects.tsx`; test `engine/ui/cards/view.test.tsx`, or a new
`engine/ui/cards/drive.test.tsx`.

- **`EffectProps` gains `drives`:** for a card with `drive`, each of its drives on this post. A drive is its id, its
  plays, its close, whether it is open, its total, its count and its latest gifts. It also gains `give(drive, amount)`,
  which returns the answer, and `moreGifts(drive)`.
- **`Effects.tsx`** reads every drive card's drives on the page in one `driveGifts` call, and keeps them live from the
  thread's channel: a broadcast `donation` adds to its drive.
- **The reader's wallet** comes to the Effect from the header's store, so a give button disabled for a short wallet is the
  reader's own fact. The engine's existing wallet store is reused, not read again.

Tests first:
- A broadcast gift updates the total on every screen without a reload.
- A page of ten posts with drives makes one `driveGifts` call.
- A card with no `drive` receives none.

## Task 6. The card's rules and the plates (instance)

**Files:**
- `instances/divided-world/cards/jimmy-wails.ts` (new)
- `instances/divided-world/cards/index.ts`
- `instances/divided-world/settings.ts`
- `instances/divided-world/ui/jimmy-wails/plates/blue-shirt.png`, `close-up.png` and `dark-logo.png`, copied from
  `docs/research/minus-world/jimmy-wails-plates/` (the research copy stays as the record)
- `instances/divided-world/ui/jimmy-wails/plates.ts` (new)
- test `instances/divided-world/cards/cards.test.ts`

**`jimmy-wails.ts`.** `CardRules<Record<string, never>>`:
- `key: 'jimmy-wails'`, `name: 'Jimmy Wails'`, Sweet, uncommon, a Cast, `stack: 3`, `priceKey: 'jimmyWails.price'`.
- `draws`: the plate keys from `plates.ts`.
- `drive`: `{ lasts: 7 days, gifts: ['jimmyWails.gift1' … 'gift4'], overhead: 'jimmyWails.overhead' }`.
- `canApply`: `landsOn`, then a refusal when `openDrive` holds `stack` plays, in Task 2's words.
- `validateConfig`: accepts `{}` only.
- `playPrice`: 0 beyond the base price.
- **A blank message is refused** ("an appeal needs a sob story"). The engine's `decided` gains an optional
  `CardRules.needsMessage`, checked after `casterMessage`, and `play_card` refuses an empty message for a card whose
  `card_kinds.needs_message` is set.

**`plates.ts`.** Each plate is:
- `key`, `src`, `width` and `height`
- `extend`: `'right'` or `null`, plus the panel's color
- `box`: `{ x, y, w, h }` in the plate's pixels
- `ink`: white or `#222`

Starting values: blue-shirt extends right with a white panel, its box in the panel, in dark ink. Close-up's box is the
left 45%, in dark ink. Dark-logo's box is the left 50%, in white ink. The owner judges them on the shots.

**`settings.ts`:**
- `jimmyWails.price` 200
- `jimmyWails.gift1` 10, `gift2` 25, `gift3` 50 and `gift4` 100
- `jimmyWails.overhead` 25

Tests first:
- The instance passes `instanceProblems`.
- Its `draws` equal `plates.ts`'s keys, and each plate file exists with the dimensions `plates.ts` states.
- A fourth play on an open drive is refused, and one after the close lands.
- A blank message is refused, and a message is required in SQL as well.

## Task 7. The banner, the carousel and the drive (instance screens)

**Files:** `instances/divided-world/cards/jimmy-wails/Effect.tsx`, `Banner.tsx`, `Drive.tsx` and `jimmy-wails.css`
(new); tests `Effect.test.tsx`, `Banner.test.tsx` and `Drive.test.tsx` beside them.

**The Effect.** It renders the post's words unchanged, then, below them, the latest drive's carousel and its drive. An
earlier closed drive shows as a collapsed line, "An earlier drive raised 3.10 in 7 gifts", that opens its banners.

**`Banner.tsx`:**
- The play's `drawn` plate, at its aspect ratio, scaled to the post's width. An unknown key (a plate removed from the
  pool) draws the first plate, so an old play never breaks.
- The text in the box: "Please read:" small, the message large, and "A personal appeal from {caster}". The size steps
  down from 28 px to 13 px until it fits the box, measured once per layout and on resize.
- `alt=""` on the plate, and the figure labeled "Appeal from {caster}".

**The carousel:**
- One banner shows at a time. It advances every 8 s, crossfading, and pauses on hover, on focus within, and from its
  pause button.
- Under `motionReduced()`, it never advances by itself, and it swaps with no fade.
- Previous and next buttons, plus dots, with "1 of 3".

**`Drive.tsx`.** In the Wikipedia appeal's plain look:
- The four amounts as buttons labeled "Give 0.25 Aura to this drive". A button over the reader's wallet is disabled, with
  that said in its description.
- Under the buttons: "0.19 reaches Pipewrench after The System's 25% overhead", from `giftSplit`.
- The total, "Raised 4.20 in 11 gifts", and the donor wall, latest first, with "and N more" calling `moreGifts`.
- A gift's result is announced in a polite live region. A refusal shows its words.
- A closed drive shows "This drive has ended. It raised 4.20 in 11 gifts." and no buttons.
- In the ORIGIN box, no buttons.
- A reader whose character wrote the post sees the buttons too, since giving to oneself is allowed.

Tests first:
- The drawn plate is the play's, and an unknown key falls back to the first.
- The message shrinks to fit 200 characters in each plate's box.
- The carousel advances, pauses on focus and on the pause button, and never advances under reduced motion.
- A button over the wallet is disabled.
- A gift updates the total and the wall.
- A closed drive has no buttons.
- No buttons in the ORIGIN box.
- The text keeps its contrast on each plate (`engine/ui/contrast.ts`, sampled against each box's darkest and lightest
  region, as recorded in `plates.ts`).
- axe finds nothing on a drive (the existing a11y test helper).

## Task 8. Its words, face and log (instance UI, engine log)

**Files:**
- `instances/divided-world/ui/cards.ts`
- `instances/divided-world/ui/cards/jimmy-wails.svg` and `jimmy-wails-mark.svg` (new)
- `engine/ui/log/lines.ts`
- the log's read of `wallet_events` (`gift_out` and `gift_in` rows)
- tests `instances/divided-world/ui/index.test.tsx` and `engine/ui/log/lines.test.tsx`

**The card's UI entry:**
- **`art`:** in Sweet's color, as Stick Around's.
- **`summary`:** "Puts your sob story on a donation banner under a post, so anyone can send its author Aura."
- **`hint`:** "Anyone can chip in. The System takes 25% for overhead."
- **`describe`:** the rules in plain words, true to the settings: the amounts, the overhead, three appeals per drive, and
  the 7 days.
- **`logPlay`** (the optional `CardUi.logPlay` the Autocorrect plan adds; if that plan has not landed, this task adds it as
  that plan specifies): "It opened a drive." or "It joined the drive."

**The log** (engine, naming no card):
- **`gift_out`:** "You gave 0.50 to the drive on post N; 0.38 reached its author after The System's 25% overhead", or
  "...; it all went to The System's overhead" where `arrives` is 0.
- **`gift_in`:** "Spritey gave 0.50 to the drive on your post N; you received 0.38", with "and your wallet was full, so
  0.12 of it was lost" where the event's `overflow` is above 0.
- Each line links the gift's Act and shows the wallet after, as the log's other wallet lines do.

Tests first:
- Each line, for the giver, the author, a full wallet, a staff post and the caster.
- No `gift_out` line names the author's wallet, and no line names an owner.
- The faces test finds the face and the mark.

## Task 9. Stories and shots for the owner's word

**Files:** `instances/divided-world/cards/jimmy-wails/Effect.board.stories.tsx` (new); shots under
`docs/research/2026-11-03-jimmy-wails-shots/` (new).

The shots show:
- each plate with a short message and with a 200-character message
- a drive of three mid-carousel
- a drive with a long donor wall
- a closed drive
- an earlier drive collapsed
- the reduced-motion carousel
- the ORIGIN box
- a disabled button over a short wallet

Each at 1440 and 390, light and dark. The PR waits on the owner's word on them, including the text boxes, the type and
the attribution line.

## Last. The full build and the final review

Run `npm run typecheck` and `npm run build:ci`, plus the e2e export test with a gift in its fixture, so a `donation` Act
and its wallet events round-trip. Include the output. The final reviewer reads this plan's Review focus.

## Ways out of the states this adds

- **A drive:** closes by itself 7 days after its latest play.
- **A full drive:** closes by itself, and the next play opens a new one.
- **A gift:** a finished Act.
- **The carousel:** pause, focus or hover, and reduced motion.

## The masks

- `donate` joins `characters.owner` for the post's author, inside the function, only to credit the wallet. Its answer,
  its Act and its broadcast carry no author account and nothing of the author's wallet.
- The refusals read the giver's own wallet, or public facts: the drive's close, the offered amounts.
- A gift to one's own mask is not refused.
- `drive_gifts` reads only the donation Acts' public columns.
- No timing differs by owner beyond the wallet lock, which a trap's Pay out already takes the same way.

## Review focus

- **The answer to a full wallet:** check that `donate`'s answer and broadcast are byte-identical whether or not the
  author's wallet overflowed, and whether or not the giver owns the post.
- **Every reader of a thread's Acts:** a `donation` is an Act in the thread. Check that no list of posts, reply count,
  unread mark, "first reply" trap trigger, presence or digest picks one up. List each reader checked.
- **Settlement:** check `settlement_input` leaves gifts out of every set, including the Lurker's post count and the
  halving, and that a settled window replayed with gifts present gives the same sums.
- **The drive's close under concurrency:** a play and a gift arriving at the close both lock the post. Check that a gift
  cannot land on a drive a simultaneous play just reopened as a new drive, or be refused for one it just extended.
- **The cost of a busy drive:** one `drive_gifts` read per page, an index on `target_act_id` for donations, and a donor
  wall limited to 20. Check the plan held these.
- **Acts an instance already holds:** no existing card has `draws` or `drive`. Check that every other card's stack, layer
  and `card_target` output is unchanged.
- **Self-dealing:** a player's masks giving to each other only ever lose the overhead. Check that no path credits more than
  `arrives`, and none credits a wallet twice.
