# Season Two cards: Heads Will Roll, Console Slog, Tune It Out, AdFlock Minus and Present For You

Record, written 2026-11-28. A design session with the owner, started on 2026-11-27 from Minus World's Season 2 spellbook
(`docs/research/minus-world/season-2-spellbook-roster.csv`, which the owner attached again as a PDF). Most of its spells were
never built on Minus World; Heads Will Roll, Jimmy Wails (already a Divided World card) and AdFlock Minus eventually were. The
owner picked five as Divided World cards:

> - Heads Will Roll: simple permanent aesthetic effect that blocks nobody. Logic is just "dvd screensaver" on minus world, but
>   on DW would be fun to do with real gravity simulations where the smaller reactions actually orbit the largest ones, etc.
>   Plays well with Overreaction.
> - Console Slog: easy to build, another one that just adds slight inconvenience so no problem with permanence, just need to
>   charge extra aura for post length. Only concern is a visual similarity between this and You Were Saying - the latter could
>   potentially keep highlighting but use Verdana instead of Courier
> - Present For You: seems like an ideal Pepperoni Reversal. DW version would require allowing attaching a second card to the
>   play, which I believe the engine doesn't support now.
> - Tune It Out: another fun "make a post slightly inconvenient to read" one, like Below the Fold with extra finesse to tune
>   the knobs. Would need resources sourced for the "other channels" but overall wonderfully whimsical.
> - AdFlock is a classic, dead simple to code (just random position draggable divs) but requires a lot of assets to be
>   prepared or sourced, and a human touch for the writing of each ad.

Picture Switcher was set aside ("tricky with https nowadays, and we don't want to store a ton of images"); the sheet's other
spells exist already or are too close to cards that do (Make A Point is THIS). The plan is
`docs/plans/2026-11-27-season-two-cards-plan.md`.

Each new effect was tried on a bench the owner turned by hand:

- `docs/research/2026-11-27-heads-will-roll/01-bench.html` (four rounds: rolling, the Space mode, a steady roll, and the
  fix for a system wider than a phone's post)
- `docs/research/2026-11-28-console-slog/01-bench.html`
- `docs/research/2026-11-28-tune-it-out/01-bench.html`
- `docs/research/2026-11-28-adflock/01-bench.html`

The owner on the last three: "These are all very nice." A bench is a reference for look and feel, never code to copy; the
numbers a build starts from are this design's.

## 0. Where it starts

- **A card** is a rules file (`instances/divided-world/cards/<key>.ts`, with its `price`), a test, a UI entry
  (`instances/divided-world/ui/cards/<key>/ui.ts`) with its art, mark and credit, one line in `cards/index.ts` and one in
  `ui/cards.ts`. The machine, the seed and the landing table are computed from those.
- **Prices** in Divided World run 1.00 for a common, 1.50 for an uncommon and 3.00 for a rare (`price` in hundredths).
- **A post's effects** wrap its words, nested by `nestOrder` (`engine/ui/cards/Effects.tsx`). A card with `coversRow`
  mounts a `Cover` over the post's whole row, and today covers nest in play order, latest outermost
  (`engine/ui/thread/cover.tsx`, `useRowCovering`). Below the Fold's `FoldedRow` wraps all of them
  (`engine/ui/thread/Post.tsx`).
- **A reader's state** today is either the post author's saved state (`EffectProps.save`, `save_effect_state`), the
  reader's own release from a play on every device (`EffectProps.release`, Stick Around's certification), or the page's
  memory (a curtain opened). No card keeps anything in the reader's browser.
- **Reactions** are drawn by `Reactions` (`engine/ui/reactions/Reactions.tsx`) under the post, with the grace, undo, cap,
  stamp and picker all inside it. No card can draw them itself. Overreaction adds a kind to one post's picker
  (`CardRules.reaction`).
- **A face-down card** is held private in `face_down`, read by its setter's account alone, and springs onto a quote. Its
  wrapped card identity never appears in a public Act until it springs.
- **Sound** goes through the mixer (`engine/ui/audio/mixer.ts`) on the game bus, each slot captioned for a reader with sound
  off (`engine/ui/audio/captions.ts`); Laugh Track's and It's Curtains' loops change their gain over time.

## 1. What the engine gains

### 1.1 Row layers, in an order the instance names

**Decided** (the owner, from the reader's side: "Open a fold, see static, tune to curtains, curtains swing open to reveal
smoke, search through smoke to close ads"): the layers over a post's row nest in a fixed order, outermost first:

1. Below the Fold (the fold, as today)
2. Tune It Out (a cover)
3. It's Curtains (a cover)
4. Hot Box (over the row: section 7)
5. AdFlock Minus (over the row)

- **Two kinds of row layer.** A *cover* (`CardUi.coversRow`, as today) shuts the row for a reader until that reader opens
  it, and makes what is under it inert. A layer *over* the row (`CardUi.fillsRow`, new) draws the card's `Effect` over the
  post's whole row, postbit included, instead of around the words, and makes nothing inert: the row under it is still the
  post, partly hidden.
- **The order is the instance's.** `InstanceUi.rowOrder` lists every card that covers or fills the row, outermost first.
  `useRowCovering` and `nestOrder` read rank from it, and play order only breaks ties within one card (a stack of curtains
  stays latest outermost). The fold is outside all of them, always, as now.
- **A build check** (`engine/ui/tips/problems.ts`, beside `coversRowProblems`): a card that covers or fills the row and is
  missing from `rowOrder`, a key in `rowOrder` that is no card or neither covers nor fills, and a key listed twice are each a
  problem. Its test drives it red on each poison before it passes.
- **Where a post has no row** (a spun thread's ORIGIN box, the front door, a moment, History), a card that fills the row
  fills the content area instead, as a cover already does there.
- **Inside a shut cover nothing starts**, as It's Curtains' design said (`EffectProps.covered`): smoke rolls in and ads
  pop up only once every cover outside them is open for the reader.

Weighed: *play order* (a reader cannot learn the layers, and an early AdFlock would sit under a later curtain); *the order
the other way round* (the owner's first sketch, revised in session: the pop-ups belong nearest the words).

### 1.2 What a reader keeps

**Decided** (the owner chose a reader's progress kept, and on Console Slog: "each reader works for the post and then has it
forever, so the permanence works both ways"):

- **On the way, in the browser.** A new engine helper, `readerMemory(play)` (`engine/ui/cards/reader-memory.ts`), keeps a
  small JSON value per play in `localStorage`, every read and write in a `try`, falling back to the page's memory when storage
  throws or is empty. A card uses it for progress (Console Slog's characters out, Tune It Out's station and dials). It sends
  nothing.
- **Once through, on every device.** When a reader finishes (the last character out, the station locked), the card calls
  `EffectProps.release(play)`, the same release Stick Around's certification uses: the play stays done for that reader on
  every device. A release is the reader's own, never broadcast or counted.

Session's choice, from the owner's "has it forever": progress alone lives in the browser, and finishing goes to the account,
so a reader who slogged through a post on their phone does not slog again on their laptop.

### 1.3 A card that draws the reactions

**Decided** for Heads Will Roll (section 2): the post's live reaction tiles come loose and orbit inside the content area.

- **The row splits into its logic and its drawing.** `Reactions.tsx` gains `useReactionRow(...)`, which holds what the row
  does today: the chips, the reader's own (`mine`), the pending grace and undo, the cap, the one-of-a-kind rule, the send
  queue, the refusal note and the stamp. `Reactions` draws with it, unchanged in behavior.
- **`CardUi.drawsReactions`.** While a live play of such a card is on a post, `Post` draws no tiles in the row (it keeps the
  row's bar with one plain line, "This post's reactions are loose inside it", so the row still says where they went), and
  hands the card's `Effect` an `EffectProps.reactions` built from the same hook: the chips, `press(kind)` (the same grace and
  undo), the pending and own kinds, and `pick(anchor)`, which opens the picker.
- **The picker offers only new kinds** when it is opened from a card that draws the reactions (`Picker`'s `onlyNew`): kinds
  already on the post are out there to be caught.
- **On the post's author's own screen** the tiles are plain and there is no React, as today; their heads still orbit.

### 1.4 A card wrapped in another

**Decided** for Present For You (section 6). The owner on its type: "it's more of a pepperoni Move with a stylized reversal
mechanic... play it on someone else's post, openable by them, as a stylized/visible gift box", and on its cost: "It's not
really 2 cards in 1 play, more like 0-1 cards with 1 card as a box".

- **`CardRules.wraps`** (new): the card is cast face up on a post with a second card from the caster's hand, the *gift*,
  and the caster's configuration of it. The gift is a Move that reaches a post and is not itself a wrapper; its configuration
  is checked by its own `validateConfig` when it is wrapped. Its landing is checked when the box is opened, not before.
- **The gift is private until opened.** It lives in its own table (`gift_box`), read by the giver's account alone, like
  `face_down`. The box's Act and every payload anyone else can read carry no gift key, configuration or price beyond the
  box's own.
- **Opening is the post author's.** `open_gift(who, box)` refuses anyone but the account that owns the post's character,
  in plain words ("only this post's author can open it"). It writes an open Act, ends the box's play, and then lands the gift
  on the post as a play by the giver's character, through every landing check a cast would meet then (the post's slots and
  stacks, wards, a rewind, the gift's own `canApply`), charging nothing more. The box's slot is freed before the gift is
  tried, so a full post can take it.
- **A gift that cannot land** goes back to the giver's hand, and the open Act says why in the words the refusal would use
  (`did: 'returned'`, as a refund outcome does).
- **An admin's end of an unopened box** returns the gift to the giver's hand too.
- **A box cannot be set face down** (`faceUpOnly`): it is a present, given in the open.

## 2. Heads Will Roll

**A Pepperoni Move, rare (3.00), on a post, one to a post, permanent, with no author clear.** The post's reaction tiles come
loose and roll round inside its content area, the heaviest drifting, the lighter orbiting them; to react, a reader catches one.

### 2.1 What floats, and what it costs

**Decided** (the owner, "B is the minus world variant, and we should probably match it"): the live reaction tiles
themselves come loose (section 1.3). Reacting means catching a head. The owner: "It does indeed make it Salty since DW
relies on reactions for aura", and then, on what a big head does, "the aura tax can become an aura farm if the most massive
reaction is aligned with the author's class. It turns into 'click this, give me points'. This puts it back into potential
pepperoni territory. But the effect is chaotic, so it could be rare."

- **Pepperoni, rare, no clear** (the owner chose it from three): the room decides whether the play pumps or taxes the post,
  and settles its flavor by its reactions, as for every Pepperoni play. An author's clear would let an author keep every play
  that pays and settle every one that taxes, which takes the gamble out.
- **Weighed:** copies floating with the row left alone (no obstacle, a Pepperoni ornament); copies orbiting outside the post
  (no margin on a phone); a common with a clear after a hold; a timer.

### 2.2 The motion

**Decided** from the bench (the owner, after the fourth round: "Motion is much better now, like a solar system of
reactions", and then "This is getting very ideal"):

- **Space.** The content area is a box of space seen from the side, the camera tilted down 22°, with a starfield for its
  ground; the post's words stay on top, in light ink with a shadow, readable over it.
- **Mass and size.** A head's mass is its count, an Overreaction head's times `headsWillRoll.overMass` (2: "A is smart");
  its size is `least + perRoot × √mass` px, at most a share of the area's width. The React tile is a head too, mid-sized and
  massless.
- **Suns and satellites.** The heaviest heads (`headsWillRoll.suns`, 2) are suns; each other head orbits the nearest sun in a
  near-circle, heavier satellites on the nearer rings, at a pace that follows the sun's mass and the ring's radius. A
  system wider than the box draws its rings in to fit, so no head ever crosses the content area's borders.
- **Suns drift** at a steady speed and curve back toward the middle, more the farther out they are. Suns of a similar mass
  push each other apart, more the closer their masses (the owner: "everything is tending to cluster together over time,
  almost as if equivalent sized bodies need to repel each other a bit"), so systems spread over the post and stay spread; a
  small sun near a giant one may drift close. The build's acceptance is that after a minute of running the suns are apart.
- **They roll.** A head turns by its sideways travel over its radius, as a ball rolls on a floor, eased and capped at
  `headsWillRoll.mostTurns` turns a second (0.5). Its count stays upright.
- **Depth** is a scale on top of a head laid out once, never a font size changed each frame, and the heads are stacked far
  to near only when the order changes: either, done the other way, shimmered on the bench.
- **The physics is pure TypeScript** (`instances/divided-world/ui/heads-will-roll/orbit.ts`): given the heads, their masses
  and the box, it steps the system and projects it. Its tests drive it on a narrow box and a wide one.

The bench's two bugs are this design's rules: a wall clamp never makes room negative (on a phone it flipped a sun between
two places every frame, which read as flicker and doubled heads), and a system's reach is fitted to the box.

### 2.3 Catching, and the way through for everyone

**Decided** (the owner chose both):

- **A pointer catches at once.** A press on a head is a press on that tile, into the grace as today.
- **The reel-in** (keys, switches, and every input under reduced motion): every head is a real button, in the tab order
  heaviest first. Enter or Space locks onto it and reels it in, and the reaction lands after the time a pointer catch of a
  head that size and speed takes: `reelBase + reelPerSpeed × (speed ÷ size)` seconds, the speed in the head's own widths a
  second. A second press cancels. Under reduced motion the heads stand still in loose places, and a pointer press reels in
  too, for the same time. The numbers start at the bench's (0.8 s and 0.12 s) and are the build's to fit from the bench's
  catch trials (its table gives the fit).
- **The React tile is a head** (the owner chose A): catching it opens the picker, which offers only kinds not on the post.
  A new kind joins the orbit at a count of one, light and fast.

### 2.4 Its rules and words

- **Configuration:** none. **Price:** 3.00, nothing more to play. **Mod Bots** may play it.
- **Its log line:** "{who} knocked this post's reactions loose, {ago}: they orbit inside it now, and a reader catches one to
  react."
- **Its hint:** "This post's reactions have come loose. Catch one to react."
- **Its Lens** says what it does and how to reel in by key.

## 3. Console Slog

**A Salty Move, common (1.00), on a post, one to a post, permanent, with no author clear, priced by length.** The post's
content area is an empty command prompt; a reader mashes keys (or taps) to type it out.

### 3.1 The mash

**Decided** (the owner chose A, "a tap revealing 1 character is more accurate and intuitive, but perhaps it can scale...
as you keep it up a tap becomes worth more", and then momentum only: "Makes it a feelable mechanic"):

- **A press is a fresh key press, a tap or a click** on the terminal. A held key's repeats count for nothing.
- **Momentum.** A press within `consoleSlog.rhythmMs` (450) of the last builds a streak; each `consoleSlog.perStep` (5)
  presses of streak make a press worth one more character, up to `consoleSlog.mostPerPress` (8). Idle, the streak drains at
  `consoleSlog.drain` (12 presses a second). A long post is more work, which is what its length price pays for.
- **Kept.** The characters out are kept in the reader's browser (section 1.2) and stay readable; the last one out releases
  the reader on every device.
- **The same for everyone**, author and caster included, as Below the Fold is. The accessible path is the same mash.
- **An edit** keeps a reader's count, trimmed to the new length.

### 3.2 What the terminal shows

**Decided** (the owner on the phosphor load: "A is inspired"):

- **The terminal fills the content area**, border to border: black ground, green Courier, scanlines over it, a prompt line
  (`C:\DW\POSTS> type 4471.txt`, the post's number) and a blinking block cursor.
- **Quotes** print with `> ` before each line; **code** prints as is; **a link** prints its text and then its address in
  brackets, and works once all of it is out.
- **An image** prints `[IMG] name`, then loads into the terminal in green phosphor (a CSS filter: gray, tinted green, high
  contrast, scanlines) a band at a time, `consoleSlog.bands` (16) bands, as many a press as the press is worth. No pixel of
  it is read, because a hotlinked image's pixels are not the page's to read.
- **Weighed:** a placeholder line only (a post of pictures becomes a list of names); a server that turns images into
  ASCII (an outside fetcher and a cache, against "Portable by construction" and the masks of an outside request).

### 3.3 Its rules and words

- **Price:** 1.00, plus `consoleSlog.perLength` for every `consoleSlog.lengthStep` characters, at most
  `consoleSlog.mostAdded`, as Whoops! is priced (start at Whoops!'s numbers: 25 per 500, at most 200).
- **Lands** on a post with words of its own.
- **Mod Bots** may play it.
- **Its log line:** "{who} turned this post into a command prompt, {ago}: a reader types it out by mashing keys."

### 3.4 You Were Saying? moves to Verdana

**Decided** (the owner's): You Were Saying?'s tail keeps its highlight and its green, and its font becomes Verdana, so a
green Courier terminal is Console Slog's alone. `instances/divided-world/cards/you-were-saying/tail.css` sets its cursor's
offsets from Courier's metrics; they are measured again for Verdana.

## 4. Tune It Out

**A Salty Move, uncommon (1.50), on a post, one to a post, permanent, with no author clear and no length price.** The post's
row is an old TV, tuned to static; a reader turns two dials to find the post.

### 4.1 The dials

**Decided** (the owner: "consider 2 dials, effectively an X/Y axis trying to locate a point but with the graph invisible.
With plenty of fuzz so turning one of the dials still affects the picture visibly", then the recommendation for what each
does):

- **Each reader's station** is a point on a hidden plane, chosen at random in their browser, so no two readers' dials match
  and "it's on 7" helps nobody.
- **Fine tuning** (x) owns the snow: the farther off, the thicker. **Vertical hold** (y) owns the roll: the farther off, the
  faster the picture rolls and tears. Each is readable whatever the other is, so a reader knows which dial is left. Their
  falloffs (`tuneItOut.snowWidth`, `tuneItOut.rollWidth`, 0.18 of the dial) are wide.
- **The lock** needs both within `tuneItOut.tolerance` (0.025).
- **A dial** turns by dragging round it, a wheel, or the arrow keys (Page Up and Down for five steps), each by the same
  steps (`tuneItOut.step`, 0.008; a full range is 1.5 turns), so the search costs the same by any input. Each dial is a
  `slider` with its value.
- **Reduced motion:** the snow is a still pattern that thins, and the hold shows as a tear line that straightens instead of
  a roll.
- **Kept:** the station and the dials in the browser; the lock releases the reader on every device (section 1.2).

### 4.2 The set and the reveal

- **The cover is the row's own size**, postbit included, the post inert under it. The screen draws the post as it stands,
  rolled and snowed; the set's two dials and a "Tuned" lamp stand beside the screen, and under it on a phone.
- **The reveal** (the owner: "A transition between the tv tuner and the unhindered post would be nice"): at the lock the
  roll catches with a small bounce, the last snow clears, the picture gives a degauss wobble (a brief color warp), and the
  set's frame and dials fade and slide away over about 0.6 s. The screen's picture of the post is drawn where the post is,
  so the picture becomes the post without a jump. Reduced motion: a plain crossfade.

### 4.3 The other channels

**Decided** (the owner chose clips with their own sound: "C is the real deal"):

- **False stations.** A few points on the plane (`tuneItOut.channels`, 3, of width `tuneItOut.channelWidth`, 0.08) tune into
  another channel: the snow clears onto a wrong picture with its own sound.
- **Segments that slip** (the owner: "we need to kick people to another channel if they try to watch a whole 2 hour movie"):
  each channel is a segment cut beforehand, at most about 12 seconds, 360p, mono, about 300 KB as webm with an mp4
  fallback. When it ends the signal slips: the picture rolls, the snow surges, and that channel's station moves. Nothing past
  the segment is shipped.
- **Loading:** nothing until the post nears the view; then only the channel nearest the dials, and the next as the reader
  turns toward it. A thread with many such posts loads clips for the one in view.
- **Sound** (the owner: "TV static hiss get louder as the post is scrolled into view, audio for each clip, static mixed in
  with the audio according to the knob positions, as with the video"): the hiss is made by Web Audio (no file), its gain the
  share of the post in view times the snow; a channel's own sound is mixed against it by the dials as its picture is. Both go
  through the mixer on the game bus, so the reader's sound setting rules them, and each has a caption ("[static hiss]",
  "[a voice through static]", a line for each clip).
- **Where they come from** (the owner): clips from the owner's own YouTube channel's original animation, "nothing we can
  claim copyright over in terms of the characters therein, but nothing an individual will be hurt or inconvenienced by.
  Same as the Wiggler sprites and Hotel Mario avatar already in the repo", and open-licensed oddities. Big Buck Bunny is
  CC BY (the Blender Foundation), not public domain, so it carries a credit. Every clip is listed in a `CREDITS.md` beside
  them, with its source, its terms and what in it is not ours, as the licensing design does for fan material
  (`docs/plans/2026-11-25-licensing-design.md`, section 3).
- **Until the clips arrive** the card ships with three channels drawn and voiced in the page, as the bench's are: color bars
  and a tone, a test card and a beep, and a weather crawl and a chord.

### 4.4 Its rules and words

- **Price:** 1.50, nothing more. **Mod Bots** may play it.
- **Its log line:** "{who} tuned this post to static, {ago}: a reader turns two dials to find it, and it stays tuned for them."

## 5. AdFlock Minus

**A Salty Move, rare (3.00), on a post, one to a post, permanent, with no clear.** Every load covers the post's row with a
fresh flock of pop-up windows.

### 5.1 The flock

**Decided** (the owner chose closes with decoys, fresh each load; then "I'm fine making this card Rare if it keeps the
effect. It's sort of a Minus World callback. Dragging the bars remains away to access the text without dealing with the
buttons."):

- **Fills the row** (section 1.1), innermost of its layers. Windows hang over the row's border by
  `adFlock.overhang` px (14) and are clipped there, so another post is never covered.
- **Each load deals a fresh hand** from the instance's ads, enough to cover `adFlock.cover` (1.1) of the words' box, at most
  `adFlock.most` (9), spread one to each cell of a grid over the words and jittered in it (left to chance they piled up and
  left the words readable).
- **A window drags by its title bar**, the cheap way past, always. A focused title bar moves its window by the arrow keys.
- **Its ×** closes it, unless the ad's own writing gives it a decoy:
  - *dodge*: the × leaps away twice and is caught on the third press;
  - *hydra*: the × closes the window and another pops up elsewhere on the post, until the load's `adFlock.spawns` (3) are
    spent, after which it simply closes;
  - *no thanks*: the × is dead, and the real close is a tiny line of the ad's words ("No thanks, I prefer being poor").
  Every close, real or decoy, is a button in the tab order, so a keyboard meets the same decoys.
- **Its call to action** pops up another ad, under the same spawn limit.
- **Reduced motion:** a dodge jumps where it would slide.

### 5.2 The ads

- **An ad** is the instance's: its look (a 98-style window, a loud one, a chat bubble, a slick 2020s card), title, art, words,
  call to action and decoy. The engine knows none of it.
- **The writing is the owner's**, with art the owner makes or finds under terms that fit the folder (with credits, as Jimmy
  Wails's plates are). The bench's eleven are a start the owner may keep, change or drop. The card ships when the owner's
  pool is in; the build ships the mechanism with the bench's ads as placeholders, drawn without image files.
- **The name** keeps Minus World's: AdFlock Minus.

### 5.3 Its rules and words

- **Price:** 3.00. **Mod Bots** may play it.
- **Its log line:** "{who} let a flock of pop-up ads loose on this post, {ago}: they come back on every load, and a reader
  drags them aside or closes them."

## 6. Present For You

**A Pepperoni Move, uncommon (1.50), on a post, one box to a post, face up only, with a second Move wrapped inside.** Only
the post's author can open it; nobody knows what is inside until they do.

- **What it holds** (the owner chose A): any Move the giver holds that could be cast on that post, configured as for a cast
  there. Opening lands it on the post as the giver's play (section 1.4).
- **An unopened box waits** (the owner chose B: "it's a calculated risk both to give and open the gift"). It holds one of
  the post's effect slots while it waits. Its ways out: the author opens it, or an admin ends it, which returns the gift to
  the giver.
- **Price** (the owner chose A): the box's 1.50, plus the gift's own extra price on that post as of the wrap (Whoops!'s length
  price, a second curtain's), charged at the wrap; nothing at the open. The wrapped card can be any rarity: the giver spends
  it.
- **Scoring:** the box is a Pepperoni play the room settles by its reactions. The gift, once landed, is a play of its own
  flavor by the giver's character on another's post, read by every class as a cast.
- **Mod Bots never give one.** A box takes a second card choice no persona's fixed list covers.
- **The box** is drawn on the post as a wrapped present under the post's words, ribboned in the box's flavor ink, the same
  for every gift. On the author's own screen it has an **Open** control; to every other reader it is "A present for
  {author}". Opening plays a short unwrap, then the gift lands and draws as itself.
- **Its log lines:** to everyone, "{who} left a present on this post, {ago}: only its author can open it", and on the open,
  "{author} opened {who}'s present: it was {card}" (or "...: it was {card}, which could not land: {why}, so it went back to
  {who}"). The giver's own log names what they wrapped; no one else's does until it is opened.

## 7. Hot Box fills the row

**Decided** (the owner, offered the choice: "I'd be fine making it one"): Hot Box becomes a layer over the row (section 1.1),
between the curtain and the ads, so the room's smoke is in front of everything but the pop-ups. This revises
`docs/plans/2026-11-27-lasting-gags-design.md`, section 2.1, where the smoke filled the content area:

- the smoke fills the post's whole row, postbit included, and parts for a reader's pointer and Wave the smoke as before;
- "Air it out" sweeps the row's height, and its saved `{ aired }` is a share of the row's height, not the content area's;
- where a post has no row, it fills the content area as now.

Every other part of that design holds. Saved states on plays already up are read as shares of the row; on a pre-alpha
instance that is a small shift in where a band ends.

## 8. Ways out

| State | Way out |
|---|---|
| A post's reactions loose (Heads Will Roll) | A reader catches a head, or reels one in by key in the time a catch takes; an admin ends the play |
| A post typed out by mashing (Console Slog) | The reader's own mash, kept as they go and done on every device once through; an admin |
| A post tuned to static (Tune It Out) | The reader's own two dials, kept as they go and done on every device once locked; an admin |
| A flock of ads (AdFlock Minus) | A window drags aside or closes; a fresh flock each load, every one closable or draggable; an admin |
| An unopened present | The post's author opens it; an admin ends it, and the gift goes back to its giver |
| A gift that cannot land | It goes back to its giver's hand at once, with the reason in the log |
| Smoke over a whole row (Hot Box) | As in the lasting-gags design: Wave the smoke, the author's Air it out after the hold, an admin |

## 9. The masks

- **Heads Will Roll** adds no request. Its masses are the public counts, its reel-in times are computed on the reader's
  screen from motion the reader can see, and the reader's own ring and pending chip are on their screen alone, as now.
- **Console Slog and Tune It Out** keep progress in the browser and send nothing until the reader finishes; a release is the
  reader's own, never broadcast or counted (`EffectProps.release`). A station is random per reader, so no response depends on
  anyone else's.
- **AdFlock Minus** deals in the browser and sends nothing.
- **Present For You:**
  - the gift is in `gift_box`, read by the giver's account alone; the box's Act and its play's payload carry no gift key,
    configuration or price beyond the box's own 1.50, so the price paid does not hint at the contents;
  - `open_gift`'s refusal to anyone but the author is computed from the caller's own characters and tells them only that the
    post is not theirs, which they know; its timing is the same either way;
  - a gift that cannot land returns with the reason any caster would meet, all of them public (a ward, a full post, a
    rewind).
- **Clips and ad art** are the instance's own static files, so loading them tells no other host who read what.

## 10. The layers

- **Engine:** `CardUi.fillsRow`, `InstanceUi.rowOrder` and its check; `readerMemory`; `useReactionRow`,
  `CardUi.drawsReactions`, `EffectProps.reactions` and the picker's `onlyNew`; `CardRules.wraps`, `gift_box`, the wrap in
  `place_cast` and `open_gift`, and the log lines for a gift. None of it names a card or an instance.
- **Instance:** the five cards, their settings, sounds, captions, art and words; the row order; the orbit; the terminal;
  the TV and its placeholder channels; the flock and its placeholder ads; the clips and ads the owner supplies; Hot Box's
  move to the row; You Were Saying?'s font.

## 11. Open

- **The clips** for Tune It Out: the owner's channel's animation and open-licensed oddities, cut to segments, with
  `CREDITS.md`. A later change swaps them in for the placeholder channels.
- **The ads** for AdFlock Minus: the owner's writing and art. A later change swaps them in for the bench's.
- **Each card's art** is rendered as the cards' art is (`instances/divided-world/ui/cards/README.md`) and is the owner's to
  approve in the PR.
