# The owner's card notes, appraised: design

Record, written 2026-11-11. The owner handed a session twenty-one cards "copied verbatim from my notes", some from
before card types became Moves, Reversals and Gimmicks (`docs/plans/2026-11-11-card-types-design.md`, not on main on
this date), and asked for each to be appraised ("to see if they will hold up in gameplay, be fun etc"), and for those
that hold up, "or work in spirit with reworks to the effect", to be planned, built and given 1990s-style rendered art.
"The ultimate goal is a fun tribute to 2000s forums."

This is that appraisal. It was written by the session alone, with the owner away: **every rework below was this
session's recommendation when written; the owner's answers are section 5.** The notes' own words are quoted in each entry. The
first plan is `docs/plans/2026-11-11-below-the-fold-plan.md`. The renders are
`docs/research/2026-11-11-card-renders/card-notes.md`.

## 0. What each card was read against

- **The three types** (card types design, sections 1, 4 and 5). A note's "Ward" is a Gimmick today. A card played on
  one's own post that waits for something is a Reversal. A Gimmick picks one of a fixed list of engine effects.
- **Flavor is face or heel conduct** (card types design, section 2): Sweet helps, Salty gets in the way, and Pepperoni
  could be either and the room decides.
- **No money moves between players through a card** (`docs/plans/2026-11-07-face-down-moves-design.md`, section 4), and
  no play may pay a player's masks more than they spent by playing on each other (card mechanic design, section 1).
- **The masks.** A card's payout, refusal or timing is never computed from a class, an owner or who reacted, outside
  settlement's sums (CLAUDE.md, "A response never proves a private fact").
- **Ways out, layers and reach.** Every state names its end; a post's words survive under any layer; a character
  card is at least uncommon, a thread card at least rare.
- **A busy instance.** A card on a thread of five thousand posts is weighed at that size.
- **The tribute.** Whether a 2004 forum regular would grin at it.

## 1. The verdicts

| Card | Verdict | Type, flavor, rarity recommended | Part |
|---|---|---|---|
| Overreaction | Holds, one change | Move, Pepperoni, common | 3 |
| Line Cutter | Holds | Move, Pepperoni, rare | 2 |
| Off Day | Holds, reworked | Move on a character, Salty, legendary | 6 |
| Tattle-Tale | Holds | Move on a character, Salty, rare | 5 |
| Feelin' Glam | Holds, reworked | Move on a thread, Sweet, rare | 2 |
| Laugh Track | Holds; a design of its own | Move, Pepperoni, uncommon | 8 |
| Mooch | Works in spirit, reworked | Move, Salty, uncommon | 6 |
| 4D Chess | Holds as a Reversal | Reversal, Salty, uncommon | 6 |
| Graffiti | Holds; a design of its own | Move, Pepperoni, rare | 7 |
| Below the Fold | Holds as written | Move, Salty, common (the owner's decision) | 1 |
| Whodunnit? | Holds, with an end | Move, Pepperoni, rare | 3 |
| Hype-Up | Works in spirit, reworked | Move on a character, Sweet, uncommon | 4 |
| Blind Study | Holds, with an end | Move, Pepperoni, uncommon | 3 |
| Delayed Reaction | **Cut** | none | none |
| Happy Heart | Holds | Move on a character, Sweet, uncommon | 5 |
| Super Happy Heart | Holds | Move on a character, Sweet, rare | 5 |
| Ultra Happy Heart | Holds; it is the Unban | Move on a character, Sweet, legendary | 5 |
| Take the Fall | Holds | Move, Sweet, uncommon | 5 |
| Sugar Coat | Holds as written | Gimmick (Ward), own post, Sweet, rare | 4 |
| Toll | Works in spirit, reworked | Gimmick (new effect), own post, Pepperoni, uncommon | 6 |
| Last Word | Holds | Gimmick (new effect), own post, Salty, uncommon | 4 |

Twenty hold or work in spirit; one is cut. Seven hold as the notes wrote them or with a number filled in.

## 2. Each card

### Below the Fold (holds as written)

> Collapse a post inside an accordion toggle so reading it takes an extra click.

The `[spoiler]` tag played on somebody else. It is the gentlest Salty Move there is: one click, for every reader
alike, so its accessible path is the same click on a real button ("An accessible path costs what the obstacle costs").
The words stay in the Act; the fold is a layer.

- **One per post.** A second fold on a folded post is refused in plain words.
- **Its way out:** the reader's click, which lasts their visit to the page; an admin's end.
- **Rarity.** The notes say uncommon. It does less than Whoops!, a common, so common was suggested; the owner decided common.
- **Layers:** all instance. The engine's effect slot already wraps a post.

### Line Cutter (holds)

> Leave a reply to this post that appears permanently nested underneath it, no matter how many replies have come since.

A threaded reply on a flat 2003 board is a real power: on page forty of a thread, the cutter's words sit on page one.
The reply is an ordinary post Act in the thread; what the card adds is where it is drawn.

- **One per post**, so a post has one cutter and no chain grows under it. A cutter's reply cannot itself be cut under.
- The nested post counts on its parent's page and not in its own time order, so a page's length is still a page.
- It can be quoted, reacted to, played on and visited by a Mod Bot like any post.
- **Its way out:** an admin's end drops it back to its place in time. The parent's author can ward the post.
- **A busy instance:** a page's read gains one indexed lookup of the cutters under the page's posts.

### Feelin' Glam (holds, reworked)

> Give a Feelin' Fab rainbow effect to every post in a thread for one week. Posts made during that week within the
> thread will keep the effect permanently. Counts as a regular Feelin' Fab play on each affected post, and stacks as such.

The notes' last sentence is the part that does not hold: "a regular Feelin' Fab play on each affected post" is one Act
per post, so one card on a five-thousand-post thread writes five thousand Acts, and pays a Face `face.liftedAPost` on
every one of them.

**Reworked:** one play on the thread, drawn on each post.

- While it is up, every post in the thread is drawn with one more Feelin' Fab level, counted toward Fab's stack of
  three, so two Fabs and a Glam is the prism.
- A post written in the thread during the week keeps that level for good. This is computed from the play's own dates
  and the post's, never stored on the post ("Append-only").
- It scores once, as a thread play does: its Act's reactions pay its caster by class.
- **Lasts** a week. `reachLasts` caps a thread play at a day today, so this raises the thread bound to a week, which
  the owner should confirm (Good Vibes is three days on a thread already).
- **Its way out:** it ends at its time; the permanent level is decoration and an admin can end the play.

### Sugar Coat (holds as written)

> Block all non-sweet moves for one week.

A Ward that names printed flavors is already in the card types design (section 5). Sugar Coat turns away Salty and
Pepperoni casts on its post, at any rarity, for a week. Force Field turns away everything up to uncommon; Sugar Coat
lets every Sweet card through and stops a legendary Salty one, so it is rare. Pure instance content once card types
lands.

### Last Word (holds)

> Prevent a post from being quoted for one week.

A new Gimmick effect, the first of the "Gimmicks that set posting rules" the card types design left open: **No quote**.
A post that quotes the warded post is refused before it is written, in plain words that are the same for everyone.

- A reply without the quote is always possible, so nobody is stuck.
- **It also switches off quote springs on that post,** including the player's own face-down Moves there. The engine
  refuses a Last Word on a post with a live back, and a set on a post with a live Last Word, both public facts.
- Salty fits: it gets in the way of the oldest move on a forum, the quote-and-dunk.

### Hype-Up (works in spirit, reworked)

> 50% of your earned aura will go to the receiver's wallet for the next week.

As written it is the first card to move money between players, which the face-down Moves design ruled out. It is also
a card that halves its caster's income for a week, so the only player who would play it is one funneling Aura to a
friend, and the receiver's log would show the caster's earnings to the hundredth.

**Reworked:** the hype man gives the push, not the purse. Hype-Up is a Sweet Move on a character: that character earns
10% more from excited-positive and calm-positive reactions for 36 hours. It is Publicity Tour (card types design,
section 8) played on somebody else, with the same Earn effect, which only raises an earning.

- An Earn from Hype-Up and one from the character's own Publicity Tour do not add; the larger applies. Otherwise two
  friends trade a standing 20%.
- Played on one's own mask it is a Publicity Tour, which is no gain.
- Its numbers are Publicity Tour's until the season review.

### Happy Heart, Super Happy Heart, Ultra Happy Heart (hold)

> Reduce a character's warn level by one notch. / Restore a character's warn level to 0%. / Unban a banned character
> instantly.

The babyface run-in, in three sizes, and the social play the warn bar wants: asking the room for a heart.

- **Happy Heart** (uncommon) takes the oldest live points off a character's warn bar, as many as the lightest band
  lands (`docs/plans/2026-11-06-mod-bots-design.md`, section 5). That is the notes' "one notch".
- **Super Happy Heart** (rare) empties the bar.
- **Ultra Happy Heart** (legendary) ends a timed ban at once. The System's design already holds this card under
  another name: the Unban, the permaban's way out, found in a gold Minus Ball
  (`docs/plans/2026-10-30-the-system-design.md`, section 10). The recommendation is that they are one card, so the
  Unban has a face and a name, and Part 4 of the staff's work gives it the permaban.
- Each is a new Act beside the points or the ban; none edits them. A heart on an empty bar, or an Ultra on a character
  that is not banned, is refused before it is spent, and both facts are public.
- A heart on one's own mask is allowed. The card is the cost.
- A Mod Bot's ruling is still The System's own; a heart is a player's game move after it, as an appeal is.

### Take the Fall (holds)

> If a character receives Mod Bot action for this post, the consequences go to you instead.

A Sweet Move, face up, on another's post: "Spritey takes the fall for this post." When a visit to that post files, its
points land on the caster character's bar, and a ban they bring is that character's.

- **Only the points and the ban move.** The post's own layer (a redaction, a shred) stays on the post, because it is
  the post that broke the rule.
- **One per post, and it is spent by the first filing.** Until then it stays up; an admin can end it.
- **The burner.** A player can keep a spare mask to take every fall. That costs a card per post and a banned mask, and
  the mod bots design already accepts that a ban follows the character and "a swap escapes" it.
- The filing reads the play, which is public, and never an owner.

### Tattle-Tale (holds)

> Make Mod Bot visits twice as likely for a character of your choice for one week.

The snitch card. A patrol's pick of where to look is weighted; Tattle-Tale doubles a character's weight for a week.

- The targeting cap (mod bots design, section 8) still bounds how often one character is visited, so this is never a
  pile-on.
- It makes a visit likelier, never a ruling: the Mod still judges the post against its rules.
- One live Tattle-Tale per character; a second is refused in plain words.
- Rare is right for a week on a character.

### Whodunnit? (holds, with an end)

> Make a post's author completely anonymous, so reactions happen in a vacuum.

A mask on a mask, and Minus World's own spell. The honest version is the only one worth building: while it is up, no
read of that post carries its author. The postbit, the quote header, search, the profile's post list, alerts and
Realtime all show the instance's anonymous poster in its place. A hidden name the page still ships is a bluff the
glass may not make.

- Anyone who read the post before the cast remembers, and that is a clue the game gives ("you never see Superman and
  Clark Kent in the same room"). It is strongest played fast.
- **It lasts three days, then the name comes back**, with a public line that it did: the unmasking is the payoff.
- Settlement still pays the real author. The author's own screens show the post as theirs.
- Replies and quotes made while it is up name "the anonymous poster"; they are not rewritten when it ends.
- **A busy instance:** the author is removed in the read itself, per post, by a join on the post's live plays that
  every post read already makes for marks.

### Blind Study (holds, with an end)

> Hide a post's reaction totals from everybody but you and the author.

The totals leave every payload but the author's and the caster's own. Each of those is the reader's own fact about
their own characters, as a setter's face-down card is, so no response to anyone else differs.

- **It lasts three days,** then the totals show. A hidden total forever is a dead end for the Lurker, whose whole game
  is reading the room.
- The Lurker's early call is still paid at settlement by where the post leaned; nobody is paid less for not seeing.
- With Whodunnit? it is the full vacuum: no name, no numbers.

### Overreaction (holds, one change)

> Leave any emoji as a reaction on this post, choosing whether to score it as Heat, Hype, Groan, or Calm. Others will
> be able to leave the same reaction freely.

The custom emote, and Pepperoni exactly: 💀 scored as Hype is a different joke from 💀 scored as Groan.

**The one change:** the card adds the emoji to that post's picker; it does not react for the caster. Who reacted is
private, and a card play is a public Act, so a play that was also a reaction would sign it. The caster reacts after,
like anyone, or does not.

- Any single Unicode emoji that is not already in the instance's set. No image, no text.
- Up to three on a post, each its own play.
- The quadrant is public, on the play and in the picker's label, so nobody reacts into a quadrant they did not mean.
- Settlement reads a post-local reaction by its quadrant, as it reads any reaction.
- The play does not end. An admin's end leaves the reactions already given and their scoring.

### Mooch (works in spirit, reworked)

> Select a post and a reaction quadrant. You will receive 10% of the Aura the poster earns from reactions in that
> quadrant for one week. Does not stack.

"Of the Aura the poster earns" is the trouble: what a poster earns from a quadrant is its class. A Mooch on Hype that
pays says the poster is a Face, and one that costs says a Jabroni.

**Reworked:** the mooch rides the room, not the poster. For a week, each reaction the post draws in the named quadrant
pays the caster a tenth of a vote, whatever the poster's class, and the poster loses nothing.

- It pays only on another player's post, applied in settlement, which already knows.
- One Mooch per post per quadrant.
- It overlaps the Lurker's early call (a paid guess at where a post goes). The difference is that a Mooch is bought,
  public and names its guess. Whether that crowds the Lurker is the season review's to watch.

### Toll and 4D Chess (one new effect, two cards)

> TOLL (Ward): Take 50% of the Aura earned from reactions to moves played on this post. (Aura lost does not apply)
>
> 4D CHESS (Move): Name a Move and a reaction quadrant. If someone casts that Move on your post, you collect from the
> reactions its cast draws in that quadrant.

Both say: a card played on my post should pay me. Both, as written, take it from the caster, which is money between
players, and both pay by what the caster earns, which is the caster's class.

**Reworked,** as one settlement effect, **Ride**: the post's author is paid for reactions to a card play on their
post, at a share of a vote each, whatever anyone's class, and the caster keeps everything.

- **Toll** is the face-up Gimmick: for a week, every reaction to a Move cast on the post pays its author half a vote.
  It is a deterrent with a smile, softer than a Force Field.
- **4D Chess** is the face-down Reversal: it names a Move at or below its rarity, and a quadrant. When that Move is
  cast on the post it springs, the cast lands as usual, and the setter is paid a vote for each reaction that cast
  draws in the named quadrant. "I wanted you to do that" is the reveal. This is a second spring outcome beside the
  catch, which is engine work.
- Neither pays on a cast by the author's own player, in settlement.

### Off Day (holds, reworked)

> Force a Turn for a character of your choice. It takes effect at the next settlement, and returns to normal at the one
> after that.

The notes do not say what the character turns into, and a real Turn is the player's own Act with its own cooldown and
announcement. **Reworked:** Off Day is not a Turn. For the one settlement window after the next settlement, the target
character **scores as the class the caster names**.

- This makes it a guess at a hidden class, which is the game. A caster who thinks Spritey is a Heel names Technician,
  and Spritey's heat costs it for a day. A wrong guess may hand the target a good day.
- The caster never learns whether it worked. The target's log says exactly what happened and when it ends.
- The target sees it coming a settlement ahead, and can post differently or not at all that day. That is the counter.
- The named class is public on the play. One Off Day per character per window.
- Applied only inside settlement. No Turn Act is written, and the character's Turn cooldown is untouched.

### Graffiti (holds; a design of its own)

> Allow players to draw over a post with multiple ink colors, up to a maximum ink amount. The author can wash ink
> away, but it can always be scribbled back. Readers can temporarily scrub anytime (similar to Whoops)

Oekaki on somebody's post. It stands on Whoops!'s machinery (strokes in a state row, a reader's scrub, the author's
wash) with one large difference: anyone draws, so what is drawn is player content and not a seeded splat.

- Each batch of strokes is an Act by the character that drew it, so the code of conduct's report reaches a drawing as
  it reaches a post.
- The ink budget is the post's, shared, and washed ink returns to it.
- The reader's scrub is timed like Whoops!'s.
- Its screen (the drawing tool, on a phone too) needs a design session with the owner. It is not planned here.

### Laugh Track (holds; a design of its own)

> Add a sitcom audience to a post, selecting parts of its text that will play audible laughter, cheering, or booing as
> they are read.

The autoplaying MIDI of this game, and the best tribute on the list. It is also the largest build:

- **Sound needs the player's leave.** Browsers play nothing before a gesture, and sound that starts by itself needs a
  control. The game has no sound setting today; this card brings one, in the plain settings.
- **Its accessible path** is a caption where the sound would be ("[the audience boos]"), shown to a reader with sound
  off as well. It is decoration, so the path has nothing to cost.
- **The recordings** must be the project's own or licensed for it, and an instance supplies them.
- The reading heat map (pointer, touch and scroll) and the cross-fades are a design of their own with the owner.

### Delayed Reaction (cut)

> Aura earned from the affected post will be settled a day late.

Nothing a player can see, plan around or laugh at happens. Its whole effect is a line in one player's log a day late,
and it would thread a per-post delay through settlement's claim and windows
(`docs/plans/2026-11-03-settle-claim-design.md`) to do it. If the notes meant a tease, Blind Study is that card.

## 3. What is new for the engine

| Part | Cards | What the engine gains |
|---|---|---|
| 1 | Below the Fold | nothing; instance content |
| 2 | Line Cutter, Feelin' Glam | a post drawn under another; a thread play that adds a level to a post card |
| 3 | Whodunnit?, Blind Study, Overreaction | a play that withholds a post's author, or its totals, from a read; a post-local reaction |
| 4 | Sugar Coat, Hype-Up, Last Word | (after card types) Earn cast on another's character; the No quote Gimmick effect |
| 5 | Happy Hearts, Take the Fall, Tattle-Tale | cards that read and write the warn bar, a ban, a filing and a patrol's weights |
| 6 | Mooch, Toll, 4D Chess, Off Day | settlement: Ride, a spring that lets the cast land, a class for a window |
| 7 | Graffiti | its own design |
| 8 | Laugh Track | its own design, and the sound setting |

Parts 2 to 6 each need a plan written against the code, by a design session once the owner has answered section 5.
Part 4 waits for card types to merge; Part 5 for the staff's Part 4 where it touches the permaban.

## 4. The art

Every card that holds has a rendered scene in the style of the first exploration
(`docs/research/2026-11-11-card-renders/README.md`, on the branch `ccr-51a4f655-4gy34e` on this date), which already
holds Whodunnit and Overreaction. Each new scene is a script and its image, listed in
`docs/research/2026-11-11-card-renders/card-notes.md`. A render cannot be a card's art today
(`tools/check-card-art.mjs` refuses an `<image>`), so Below the Fold ships with vector placeholder art like every
card, and the render waits on the same design the first exploration named.

## 5. The owner's answers

Asked the six questions this section first held, the owner answered the same day:

1. **The reworks hold**: Feelin' Glam as one thread play; Hype-Up as an Earn; Mooch, Toll and 4D Chess paying on the
   room's reactions and taking nothing; Off Day as a named class for a window. "Yes, reworks hold."
2. **Ultra Happy Heart is the Unban.** "Yes."
3. **Below the Fold is common.** "Yes."
4. **Three days** on Whodunnit? and Blind Study. "Yes."
5. **A thread play may last a week**, for Feelin' Glam: "Week is fine, we have glitter bomb which affects a character
   for a week, thread-level is no stronger."
6. **Delayed Reaction is cut.** "Works for me."

So every rework in section 2 is decided, and "this session's recommendation" above reads as the owner's decision from
here. The owner then asked for the plans to be written and carried through to builds. Graffiti and Laugh Track still
each need a design session of their own for their screens (section 2).

## 6. The plans

Written the same day, after the owner's answers, each against the code on main once card types and rendered card art
had merged. Section 4's last sentence is out of date from that merge: a render can be a card's art now (`art.webp`),
Below the Fold wears its own, and every plan gives each card its render.

| Part | Plan | Cards |
|---|---|---|
| 1 | `docs/plans/2026-11-11-below-the-fold-plan.md` (built) | Below the Fold |
| 2 | `docs/plans/2026-11-11-card-notes-part-2-plan.md` | Line Cutter, Feelin' Glam |
| 3 | `docs/plans/2026-11-11-card-notes-part-3-plan.md` | Whodunnit?, Blind Study, Overreaction |
| 4 | `docs/plans/2026-11-11-card-notes-part-4-plan.md` | Sugar Coat, Hype-Up, Last Word |
| 5 | `docs/plans/2026-11-11-card-notes-part-5-plan.md` | the three Happy Hearts, Take the Fall, Tattle-Tale |
| 6 | `docs/plans/2026-11-11-card-notes-part-6-plan.md` | Mooch, Toll, 4D Chess, Off Day |

**They are built one at a time, in this order: 6, 4, 3, 2, 5.** Each was planned alone against the same main, and
they meet in the same places (`place_cast`, `card_kinds_problem`, `seed_instance`, `thread_page`, the instance's card
list, the machine and the Booster), so each build copies those from their latest definition on its day and takes the
next free migration numbers then.

- **Part 6 goes first** because its Task 1 fixes issue #452: a settlement that holds an Earn Gimmick's boost is refused
  by `apply_settlement` on main today. Part 4's Hype-Up is an Earn and needs that fix under it.
- **A timed Move on a post.** Parts 3 and 6 each let a cast on a post carry a `lasts` (Whodunnit?, Blind Study, Mooch).
  The second to build finds it done.
- **The Booster's hit pull.** Parts 5 and 6 each add the first legendary and each change the weights. The one set of
  weights is `{ uncommon: 74, rare: 24, legendary: 2 }`, and the second to build leaves them.
- **Section 2 where the code said otherwise.** Each plan lists these under its own "Decided in planning". The ones
  that change what a player meets are open for the owner below.

### Open, for the owner

Each plan's choice stands unless the owner says otherwise; the build goes on meanwhile and takes the answer when it
comes.

1. **Whodunnit? and the Mod Bots** (Part 3). A filing names its author in public Acts and on the warn bar. The plan
   has a Mod Bot leave a veiled post alone, and reports wait, until the name is back, and refuses the card on a post
   a Mod Bot has already visited. That makes the card a three-day shield from moderation. The other way is that a
   visit unmasks the post.
2. **The Unban** (Part 5). The System's design has it bound to the banned character and found only in a gold Minus
   Ball; this design makes it Ultra Happy Heart, a legendary held in any hand and played by any character. The plan
   builds the card for timed bans. Which form takes the permaban, and whether a lifted permaban returns on parole, are
   asked when the permaban is built.
3. **Patrols** (Part 5). A patrol reads the newest five posts today, with no draw, so Tattle-Tale has no weight to
   double. The plan makes the sample a weighted draw of five from the newest twenty, for every patrol.
4. **A legendary in the Booster** (Parts 5 and 6). Two in a hundred hit pulls, so Ultra Happy Heart and Off Day can
   be found while The System is off.
5. **Mooch in a quiet window** (Part 6). A Mooch's settled sum is other players' votes on one post. Where few react,
   it can show that a reactor is the author's own mask. A Face's lift already reads the same way under the
   settlement exception; the plan accepts it and names it for the review.
6. **Line Cutter, caught** (Part 2). A Card Collector that catches a Line Cutter posts no reply; the words stay in
   the caster's editor.

### The owner's answers

Answered the same day:

1. **Whodunnit? and the Mod Bots:** "Plan is fine." A Mod Bot leaves a veiled post alone until the name is back.
2. **The Unban:** "Ultra Happy Heart should work for any unban, I'd say. More flexible than hunting for a gold
   ball." So the card is the permaban's way out too, when the permaban is built, in place of The System's design's
   bound Unban from a gold Minus Ball. Whether a lifted permaban returns on parole is still asked then.
3. **Patrols** as a weighted draw: "Makes sense."
4. **A legendary in the Booster:** "Makes sense."
5. **Mooch in a quiet window:** "Players can't react to their own masks, I don't think?" They cannot: `react` refuses
   a reaction to one's own character (`supabase/migrations/0065_hints.sql` says so of `react`), so no reaction on a
   post is ever its author's own player's, and a Mooch's sum cannot show one. What is left is only that a Mooch's
   caster is paid nothing for their own reactions, which tells the caster a fact they already hold.
6. **Line Cutter, caught:** "OK."
