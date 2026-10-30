# The screens and card effects of the first slice

Record, written 2026-10-29. The second design session that `docs/plans/2026-10-28-core-loop-design.md` section 12
named: the screens and the two cards' effects for the first slice. Each question was put to the owner one at a time,
mocked where it was visual, and confirmed before the next. The mockups and the two working prototypes are in
`docs/research/2026-10-29-screens/`, as each stood when it was decided. The engine half was being built in PR #2 when
this was written; section 14 lists what these decisions change in it.

Three plans carry this out, built in order, each by its own build session:
`docs/plans/2026-10-29-screens-engine-plan.md` (what the engine must change for the screens),
`docs/plans/2026-10-29-screens-web-plan.md` (the web app and every screen but the cards) and
`docs/plans/2026-10-29-screens-cards-plan.md` (the Vending Machine, playing a card, Stick Around and Whoops!).

## 1. Phones, and percentages

**Decided:** desktop-first and fully playable on a phone. On a wide screen, the classic table layout; on a phone the
same pages fold into one column. The owner: "we need to design things with percentage positioning to accommodate
variable screen sizes." Widths, effect geometry and saved strokes are in percentages or in units of a box, never pixels
of one screen.

Weighed: desktop only for the playtest (phones read and react); phone-first.

## 2. The frame: a HUD docked at the bottom

**Decided:** the forum is the game screen and the bar is its HUD. A plain 2003 banner with the links at the top (a Menu
button on a phone); fixed to the bottom of every page, the HUD: avatar, the character quick-swap (a plain select), the
six orbs, and the hand (section 9). The owner: "it makes the forum feel like the game screen and the bar a HUD."

Weighed: the classic phpBB user bar under the banner (it was recommended); the character and orbs only where used.

## 3. The orbs between settlements

**Decided:** a live ghost fill. The solid fill is the settled wallet, the only Aura that can be spent. A hatched fill
grows as favored reactions land; hostile ones drain solid fill to a pale band; Aura that would settle past six orbs
shows as "+0.40 past the cap". At the settlement the ghost turns solid with the TTYD cascade from the owner's pen (orb
by orb, a flash and a shine on each that fills). Section 11 makes the ghost an estimate.

**The cadence stays daily.** The owner: "The cadence should support healthy forum activity - a player shouldn't feel
like they have to wait arbitrarily in order for an act to be worthwhile. A day might work out fine, especially since not
every postcard actually consumes aura, so there's always something to do." And: "sometimes waiting is more fun, e.g.
monthly Class Turns instead of 'whenever you want'. Let's be careful the rule isn't too harsh." So the principle this
design carries is **a wait is designed, never incidental**: no Act feels worthless because what it earned is held up for
nothing, and a wait the game chooses for its drama (a Turn's cooldown, a settlement's suspense) is play, tuned like any
other setting.

Weighed: orbs still until the settlement; a pending number beside still orbs.

## 4. The postbit: a rank with pips

**Decided:** the postbit shows the character's season standing as a 2003 member rank, a title and a row of pips,
earned from the settled standing; the exact standing is on the profile. Rank names and thresholds are instance content.
It shows "Joined Oct 2026", the month and never the time: two characters made a minute apart is a way of reading who owns
them.

**Pip styles.** The owner: "make different styles of pips unlockable and assignable per-character. Endless possibilities
for a 'full/empty' pair of images, lots of visual comedy opportunities." On binding: "Rather than bound to the character
who unlocked the style, I would say the player can pick it for one of their characters at a time. It's a player's choice
to share whether they own a character or not." The system never moves a style by itself, so any link a style shows is
one its player chose. The slice builds the interface and one default style ("supporting future styles is enough");
unlocks wait for the gacha and trophies.

**Avatars.** One upload, re-encoded with its metadata stripped, with two crops: a square (lists, the phone, the stacked
postbit) and a portrait up to twice as tall as wide (the desktop's side column). The owner: "rendering avatars next to
usernames in lists adds a lot of life to a forum", and people "enjoy having an uncropped version with up to a 2:1
portrait orientation". A reader setting chooses side by side (tall avatar, the desktop default) or stacked (square); a
phone is always stacked; where no portrait crop exists, the square fills the tall slot. The re-encoded original and both
frames are kept, so a player recrops without uploading again.

Weighed: the number with a gauge; standing only on the profile; an image URL as avatar (the host sees every reader);
no avatars in the slice.

## 5. Reactions

**Decided:** tallies as emoji chips with counts; the picker a 2×2 grid shaped like the circumplex, excited at the top,
negative on the left (the Heel's heat top-left, the Face's hype top-right, the groan bottom-left, the calm bottom-right),
so the game's map is the control. The quadrants' labels are instance content. "2 of 3 left" counts across all of a
player's characters on that post. Your own reactions are outlined on your screen only. A post by one of your own
characters shows its tallies and no React button: your screen already knows which characters are yours. On a phone the
picker is a sheet above the HUD; arrow keys move through the grid.

Weighed: a quadrant heat square on every post (it shows the shared vote and halving moving); a flat picker.

## 6. Writing, editing, reading

- **The composer:** a quick reply at the foot of every thread with an in-place preview. It names the HUD's character in
  bold, and if the HUD's character changes while a draft is open it says "now posting as …" before anything can be
  sent. Quote inserts the whole post by its Act. BBCode, with a toolbar. Weighed: a separate reply page; both.
- **Editing:** every edit is a public Act with a public history, and an edit can be spun. A grace period (an instance
  setting, two minutes) records a version but does not set "Last edited", so a typo fix is not a confession.
  Reactions belong to the post, not to a version. Weighed: a private history; silent edits.
- **Live updates:** at the bottom, a new post slides in; reading higher up, nothing moves under you and a bar above the
  HUD says "3 new posts". Tallies and edits update in place; screen readers hear new posts, never each reaction.
- **Moving through a thread:** pages (20 to a page, an instance setting) with permalinks; "Continue to page 4" loads the
  next page in place and updates the address; "Jump to latest"; live posts arrive on the last page.
- **Reading is remembered on the server.** The owner asked how forums track views, and: "Why did we decide against
  tracking reading? I think not remembering the state of a stick around check in the database sounds a bit flawed too.
  People will switch between phones and desktops often, we should endeavor to make it seamless where possible." The
  core-loop design's "nothing tracks reading time or page views" was a promise about scoring (section 6 there), not a
  ban on remembering what a player has read. So: one private row per player per thread (the furthest post read) for
  first-unread and new-post markers on every device; Stick Around releases kept per account (this **revises the
  core-loop design's section 7**, which kept them on the device); public view counts, unique players per thread,
  **published in batches** (hourly, an instance setting) and never live, since a live count shows whether a new
  poster's player had already read; **a view is a private row, not an Act**, and a future reveal of who read something
  would be the Act ("These acts are typically anonymous but could be made public in certain scenarios if a situation
  calls for it for comedic purposes"). A view records the HUD's character at the time, so such a reveal names a
  character, never a player. Class rules still read no reading.
- **Spinning a thread:** a "Spin thread" link on every Act opens a small form; the new thread opens on an ORIGIN box, a
  live view of the Act that links back; the origin lists what was spun from it. Weighed: the spec's global button with
  a picking mode; both.

## 7. The log, and a mask found in the live preview

**Decided:** the player's own log is a ledger grouped by settlement window: the open window first, its lines pending;
then each settlement with its total and one line per reason, each expandable into its Acts; filtered by character; each
line links its Act; plain words, never in character. Weighed: a narrative feed; a page per character.

**A mask leak, found mocking it.** The core-loop design's section 4 promised the owner each reaction's effect live,
"which Act, which quadrant, how much". But "how much" depends on who else reacted: a 🔥 at +0.10 that becomes +0.05 when a
☕ lands says the two came from one player; "counts a quarter" says its player reacted to two earlier posts. Neither says
who, but together they let a player follow one unknown reactor across their posts and count distinct reactors, in real
time ("A response never varies with a private fact"). **Decided: live lines are an estimate; the settlement is exact.**
Live, each reaction is valued as a whole vote alone ("up to +0.10, before the shared vote and halving"), and the ghost
fill shows the same estimate; at the settlement the exact amounts arrive per reason for the whole window. This **revises
the core-loop design's section 4**. The per-Act settled amounts a settled line expands into are a day-after aggregate,
the same leak the core-loop design accepted for a quiet stretch's public standing.

Weighed: keep the exact live preview and accept the leak; no live amounts.

## 8. Characters and Turns

**Decided:** "My characters" is out of character and seen only by its player: each mask with its class marked "only
you", its standing and pips, the Turn button or the date it opens, and New character. Creating a character and a Turn
use the same class cards, each a plain description of how the class earns and what hurts it. The Turn is a modal: the
class, how loud (silent, announced, announced with the old class), and a preview of exactly what everyone will see.

**A Turn takes effect at the next settlement.** The window that is open is scored under the old class; announced Turns
are posted at the settlement. A pending Turn can be cancelled until then. This keeps a window's arithmetic whole, and
turns a Turn's time into a settlement's, which also settles issue #4's question 17 (a player who Turns several masks in
one sitting no longer shows them as one player's in the reveal).

**A full roster** (six characters) has no way to free a slot until the Pound is designed; for the slice an admin
retires a character on request, its every Act kept, and can restore it.

## 9. The Vending Machine and playing a card

**Decided:** the Vending Machine is a drawn machine, a game piece in color: each slot a real button ("Buy Stick Around,
1.00 orb"), a little price display, the orbs drained in the HUD with the cascade running backwards, the card dropped into
the tray and flown into the hand. Empty slots wait for future cards. Its name is the owner's to give later. Buying is
private and spends solid orbs only. The HUD gains a hand button with a count, opening a drawer above it.

**Playing a card:** from a post ("Play card" opens the hand, showing only cards that can land there) or by arming a card
in the drawer (every eligible post shows "Play Whoops! here"); either leads to one small form: the card's setting, the
caster's **message** (up to 200 characters, plain text, shown on the card's Act: "a riposte with no words falls flat"),
the price, and Play as the HUD's character. **A card may be played on a post by one of your own characters**: a staged
feud between your own masks costs real Aura (Whoops! costs at least 1.00 and pays a Jabroni 0.20), and the log says so.

**The house style governs looks, not interactions.** The owner: "we shouldn't hesitate to use a modal when/if it's the
best ux, even though there wouldn't have been one in an early 2000s site." And on motion: the forum's stillness "is good
as a stylistic juxtaposition but not a hard rule that should prevent us from using transitions or animations for layout
where appropriate. No hard rule that they must be used either - just something to stay open to when the ux calls for it,
such as sliding in a new post asynchronously, which requires motion inherently." A modal holds focus, closes on Esc and
returns focus.

Weighed: a 2003 shop table; dragging a card onto a post (the spec's); playing only from a post.

## 10. Stick Around

From the working prototype (`docs/research/2026-10-29-screens/proto-q14-stick-around.html`):

1. Breaking free lasts this visit only; the next time the post holds you, you are held until you certify. The checkbox
   is the release; breaking free is the way out that is always there.
2. The post's author and the card's caster are never held; only their own screen knows to skip it.
3. **Gravity.** The owner: "worth considering a gravity-style system where the closest one you are scrolled to pulls you
   toward it." When you stop scrolling, the nearest Stick Around you have seen and not escaped pulls you; escaping one
   leaves the others.
4. **An effect works wherever its Act appears**, a spun thread's ORIGIN box included. The owner: "the same logic should
   extend to other postcard effects."
5. **Breaking free is a slingshot.** The struggle meter of the first rounds let a phone's ordinary fling break free.
   The owner: "What if it takes a 'flick', so you have to scroll quickly in the opposite direction of where you're
   trying to escape to, and then immediately and fiercely in the intended direction, all as one quick motion", and then:
   "lean more into the slingshot feel on touch - no minimum speed for the first gesture, but a minimum distance to
   'cock' the slingshot. It stays valid in this state indefinitely as long as your finger stays on the screen and you
   don't go back below that distance. Then the second gesture, the fierce flick, 'fires' the slingshot. This might even
   work with click-and-drag if we add a little handle." So:
   - **Touch:** dragging one way past a distance (0.12 of a screen) cocks it, at any speed, for as long as the finger
     stays down; the frame stretches as it is drawn back. A fierce flick the other way fires it: the owner found 6 to 9
     screens a second "the sweet spot". The release is read along the finger's path, so a thumb's arc counts, and only
     when it is mostly vertical. Drifting back under the distance uncocks it only when slow, since a fire swings back
     past it by nature; the speed is read once more as the finger lifts. While a finger is down the post does not pull,
     and the page's own pull-to-refresh and overscroll are contained so a cock at the top of a page is not swallowed.
   - **A mouse:** a small handle on the frame, dragged back to cock and flicked the other way to fire; the page launches
     the way it was flicked. Dragging the handle never scrolls.
   - **A wheel:** a quick nudge one way, then at once a fierce scroll the other (round 4's flick); untried by the owner.
   - **Keyboard and screen reader:** a BREAK FREE button worked like the gesture: press to wind up (the frame tightens),
     press again between 0.12 and 0.6 seconds later to release; too soon or too late and the band goes slack. Certifying
     is reading and ticking, at everyone's cost.
   - An ordinary hard scroll, however fast, never breaks free; after a post has pulled a reader back twice its tag says
     "fire the slingshot to break free".

**The pull.** The owner: "on a phone it's very easy to 'break free', and I also think rubber-band easing would enhance
the effect", and "add a bit of ease-in to the scroll, so the user's natural scroll finishes (typically with an ease out
from the browser), they start to get pulled toward the sticky post slowly at first, and they finally snap to it with the
rubber band at the end." So the pull waits for the reader's own scroll to settle, eases in, gathers speed, and lands with
a rubber band whose overshoot is a fixed number of pixels, so a long pull and a short one land alike. With reduced
motion the pull is instant, and still happens.

**Tuning on real devices is a session of its own.** The owner: "it is a bit finicky to get it registered in a way that
feels right. My guess is that measuring the velocity is probably done based on Y position when a finger swipe can really
be more like an arc", and "If this is too complex for the goal here we can take it to a dedicated session". Round 6 reads
the release along the arc; how it feels on phones, on a mouse's handle and on a wheel is tuned with the owner on real
devices, which no build session has. The numbers in the cards plan are starting points.

## 11. Whoops!

From the working prototype (`docs/research/2026-10-29-screens/proto-q15-whoops.html`). The owner of the old pens: "Do
not feel compelled to use these prototypes' code or appearance verbatim, they are very old. Would be cool if the splat
looked slightly different every time etc."

- **A splat different every time.** A play stores a seed and an ink; every reader rebuilds the same splat from them (a
  lumpy blob, splash arms of shrinking blobs, droplets, filled as one shape, with a wet gloss).
- **One fixed layout, scaled.** While a post is splatted its text is laid out at one reference width and scaled as a
  whole to the screen (capped on a wide screen, centered, the ink free to run into the margins), so lines break in the
  same places everywhere: a wash uncovers the same words on every screen and handwriting never stretches. Text then
  scales with the screen. Weighed: normal reflow (a wash uncovers different words on a phone); washes anchored to words.
- **Any color.** The owner: "I would like to try it with a color picker (with the highlight/shading dynamic). A pale
  color will need a shadow instead of a light highlight, but I don't see why it would 'hide nothing', it's an opaque
  color either way." Shading follows the ink's luminance: a white highlight for a dark ink, a soft edge shadow and a
  darker underside for a pale one. The tag over the post takes the top layer's color.
- **Stacking.** "Stacking is a great idea." Up to three Whoops! on one post, each its own play, seed and ink. **A stroke
  scrubs the top layer where it starts**, so each layer is a full layer of washing; the owner tried every layer at once
  and chose this: "there's not much of a reason to play more than one whoops if they can all be cleared at once".
- A reader's scrubbing is theirs alone, and a refresh brings the ink back. The author's strokes are saved for everyone:
  washing, or writing back in the ink with a thinner pen.
- An edit leaves the splat and the saved strokes where they are; new text reflows under them.
- **Washed clean:** at about 95% (an instance setting) the layer fades for everyone when the author does it, and the log
  says so; a reader who scrubs that far sees it fade on their own screen.
- The accessible path: a "Hold to scrub" button that sweeps line by line at about a hand's pace, never all at once.
- Soap suds, from the owner's pen.

## 12. The out-of-character screens

- **Invites:** one-use links the inviter shares themselves, expiring after seven days; every player holds three at a
  time (an instance setting), admins any number. This settles issue #4's question 14.
- **Registration:** a normal registration page. The owner: "we should have a normal registration page; the community is
  tight knit but it shouldn't be invite-only to join." The playtest instance starts invite-only, as the core-loop design
  section 11 decided, because real moderation is not in the slice; open registration waits for an admin's hide-a-post
  (a layer, never a deletion) and suspend-an-account tools.
- **Signing in:** email and password.
- **18+:** a checkbox, "more of an acknowledgement", nothing legally binding.
- **Themes:** the device's light or dark by default, with an override saved to the account. The owner: "I would like
  the templates to be very themeable in general though. Ideally people could create their own themes with some CSS
  overrides to be considered for the selector - old forum stuff." So every color, font and border comes from named
  tokens and every screen has stable class names; a theme is a CSS file of overrides; an admin considers a player's
  theme for the selector (CSS can load outside images that watch readers, and can hide a game piece for everyone who
  uses it). The slice builds the tokens and hooks and the house theme; the submission flow comes later.
- **Sound:** none in the slice ("Wouldn't be hard to add later").
- **Motion:** the device's reduced-motion setting, with an override. Reduced motion keeps every obstacle's cost.

## 13. The index, the profile, the reveal

- **The System has a board of its own,** beside the ordinary board on the index. Only The System posts there: the
  season's Turns thread (announced Turns, each its own Act, written at the settlement) and the reveal. Players react and
  spin threads from its Acts but do not reply in place.
- **A thread list** in the classic table: NEW (from the player's reading rows), HOT (replies this week, a setting),
  replies, views (hourly), square avatars beside "started by" and "last post", page links and "first unread", and a spun
  thread naming its origin. On a phone, stacked cards.
- **The profile** shows only what anyone could have watched: the tall avatar, title, rank, the exact standing and when
  it was settled, its place in the season, counts of posts, spins and card plays, the month it joined, its signature,
  and its public record (announced Turns, past seasons). The public record shows its latest rows with a link to a full
  view, paged and filtered. A Turn announced with the old class shows that class, because it was announced.
- **The season standings page** ranks every character by settled standing. **A character appears in any list only from
  its first settlement or its first Act**, so a new mask never shows up live in a list; this is the screens' answer to
  issue #4's question 16. A character's own first post shows it, which is play.
- **The reveal** is one post per character in order of final standing, each with its place, rank, standing, a timeline
  bar of its classes (each class's look is instance content) and every Turn, silent ones included; each can be reacted
  to and spun on its own.

## 14. What these decisions change in the engine

PR #2 built the core loop's engine; these change it, and the engine plan carries each:

1. The System's board is its own, flagged in the instance's board seed (PR #2's `system_board()` is the first board).
2. A Turn is pending until the next settlement and can be cancelled; the settlement applies it and posts announced
   Turns.
3. A reveal post can be reacted to (PR #2 refuses it); it moves nobody's Aura.
4. Whoops! stacks up to three, with a layer number, a server-chosen seed, and strokes that carry their tool and are
   measured in widths of the fixed layout; a card play carries the caster's message.
5. The owner's live preview is an estimate, served by an endpoint.
6. New tables: reading rows and hourly view counts; Stick Around releases; preferences; character profiles and
   avatars; admins; and a player's own reactions, readable by that player.
7. Invites: three per player, seven days.
8. A character appears in lists from its first settlement or Act.
9. An admin retires and restores a character.

## 15. impeccable

impeccable 4.8.0 is installed from npm (`.claude/skills/impeccable/`). Its `scripts/VERSION` names its engine (0.1.18),
not its npm version, which is why currents' `impeccable:update` script cannot install from it. Its product record is
`PRODUCT.md`; its `shape` brief, confirmed by the owner, is in the web plan, and its build path is code-first
(`.impeccable/config.json`). The forum meets WCAG 2.2 AA.

## Open

- The Vending Machine's name, the rank names and thresholds, card art, the quadrant labels, each class's look on the
  reveal's timeline: instance content the owner names.
- Stick Around's breakout tuned on real devices (section 10), in a session of its own with the owner.
- Pip styles beyond the default, and how they are unlocked (with the gacha and trophies).
- The player-made theme submission flow.
- Open registration, after real moderation exists.
- PR #2's issue #3 (Auth's own endpoints and whether an address has an account) is untouched here.

## Amended 2026-10-29: after PR #7

PR #7 (`docs/plans/2026-10-29-core-loop-build-answers.md`) answered the engine build's questions the same day, and
the owner left this design to follow it where the two differ:

- **Sign-in is passwordless** (a code or link by email), not email and password (section 12), which closes the timing
  question of issue #3 for passwords.
- **Masks change at the tally.** A new character debuts at the next settlement and cannot act until then; a Turn is
  pending until it and may be changed or withdrawn; each settlement The System posts one tally Act naming the night's
  debuts and announced Turns. This replaces section 8's "a pending Turn can be cancelled", section 13's "one Act per
  announced Turn" and section 13's "listed from its first settlement or Act", which was this design's answer to issue
  #4's question 16.
- Invites: PR #7 keeps "no cap yet"; section 12's cap of three, expiring after seven days, is built on top by the
  engine plan's Task 8.

## Amended 2026-10-29: after the clues design

`docs/plans/2026-10-29-clues-design.md` moved the masks' rule to "A response never proves a private fact" and, the
owner deciding, changed these:

- Section 4: an avatar is two files, a portrait up to 512 wide and a square cut from it, both public; the original is
  not kept.
- Section 6: a thread's view count counts the characters that read it, never players, and is public; it still moves
  hourly.
- Section 7: the estimate's lines are each reaction's own, exact; none is apportioned.
- Section 8, and the amendment after PR #7: a new character either drops at once or debuts at the next tally, each
  silent or announced.

## Amended 2026-10-29: after the class reveal design

`docs/plans/2026-10-29-class-reveal-design.md` (#14): a player may reveal a character's class at any time, as its own
Act, and the postbit and profile show it as a dated fact. Section 13's reveal no longer shows a timeline of every
character's classes: each character's post carries its place, rank and standing and only what its player made public,
and class secrets roll over into the next season.

## Amended 2026-10-29: after the two-worlds design

`docs/plans/2026-10-29-two-worlds-design.md` divides these screens into two worlds, and where it says otherwise it
wins. The board (sections 4, 5, 6, 10, 11 and 13: the index, threads, posts, reactions on a post, the card effects on a
post, the profile, the standings and the reveal) keeps every decision here and the 2003 look; a card's frame and
controls over a post take the glass's look (the cards plan's amendment). Everything else is the
glass, a game's own interface in the look of the boards in `docs/research/2026-10-29-two-worlds/`:

- **Section 2:** the 2003 banner holds the board's own navigation; the HUD is the glass, docked at the bottom as
  decided, and its Menu button, orbs, avatar and hand are the only ways into the rest of the glass, a set of full-screen
  pages under one menu bar (the pause menu), with Back and Esc returning the reader to the post they left.
- **Sections 3, 5's picker, 7, 8, 9 and 12:** the orbs, the React picker, the log, My characters, the Turn modal, the
  Vending Machine, the hand, the play form and the out-of-character screens are glass. Each keeps every decision of its
  section; only its look changes. The log gains the settlement's summary, and the glass gains Rankings.
- **Section 15:** the board meets WCAG 2.2 AA; the glass meets it and the Xbox Accessibility Guidelines 101 and 102,
  as the two-worlds design's section 4 reads them.
