Record, written 2026-11-21.

# Time Machine, and rewinding and freezing a post: design

A design session with the owner for Time Machine, the Base Set's rare Pepperoni Move
(`docs/plans/2026-11-14-base-set-design.md`, wave 4;
[#683](https://github.com/keithpickering/dividedworld/issues/683), "Time Machine"). Its row (rarity, price, 3 days,
blocking up to rare, its words) was settled by `docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3.3),
and its art is already rendered (`instances/divided-world/ui/cards/time-machine/`: a VCR, "BE KIND, REWIND", a
blinking 12:00). The roadmap gave "rewind and freeze" to a post-and-thread engine design session. None has been
written, so, as the SoVeryHappy and Buzzkill sessions did for their parts of Plays, this session settles the rewind and
the freeze and plans them with the card. Ratio's mark and Necro Bump's bump stay with their own sessions. Its plan is
`docs/plans/2026-11-21-time-machine-plan.md`. Read on `main` at `d39e456`, with SoVeryHappy's and Buzzkill's designs
and plans (`docs/plans/2026-11-21-so-very-happy-*`, `docs/plans/2026-11-21-buzzkill-*`) read for overlap.

This design changes three things in the card-numbers row, each the owner's decision below: the author's edit no longer
ends it (2.2), the cards shown are those that were on the post at the point (2.1), and the freeze refuses every kind
of play, not only Moves (2.6).

## 1. The card

**Time Machine** (Pepperoni, rare, 3.00, Move on any post, the player's own included, 3 days).

- The player picks a point from the post's public History: as first posted, or any later edit. A version saved inside
  the edit grace window is never a point (section 4.1).
- For 3 days the post shows as it was at that point: its words as of the point, and only the cards that were already
  on it then and are still up. Cards played on it after the point are hidden, not ended.
- While it is up, no card up to rare can be played on the post, whether a Move, a Gimmick or a card set face down, and
  nothing face down on the post springs.
- The author can still edit. The edit lands at once and History lists it, but the post keeps showing the rewound
  version until the Time Machine ends.
- Refused when no point would change what the post shows: never edited past the grace window, and no card played on
  it that is still showing.
- Face up only: it is never set face down, since its point is picked when it is played.
- **Its way out:** 3 days, or an admin's "End this card". Nothing is destroyed: every version and every hidden card is
  still there, and the post is drawn from its Acts as of the point.
- Tagline: "Go back to better days." (the owner's, from the card-numbers design).
- Summary: "Played on a post. For 3 days it shows as it was at an earlier point you pick, and no card up to rare can
  be played on it."
- Status: "Showing an earlier version". First-meet hint: "This post is showing an earlier version. Its History has
  the rest." Log: "That post shows as it was on {date} until it ends."
- Its key, `time-machine`, falls in the slot between `this` and `toll`, which no other Base Set card shares.

## 2. What the owner decided, and what was weighed

1. **The post shows as it was at the point, cards included** (the owner's pick). Its words as of the point, and only
   the cards already on it then that are still up. Cards played after the point are hidden until it ends; their clocks
   run, a Mooch or a Toll keeps scoring, and an Earn on the post keeps paying. A card that has ended since the point
   does not come back: the Time Machine shows the past, it does not undo an ending. Weighed: hiding every card (a full
   cleanse, the way the row read), and rewinding only the words with every card left on top of them (old words under
   new splats, which is no point in time at all).
2. **Edits queue; only time or an admin ends it** (the owner's direction). The owner, on the author's edit ending it:
   "I've actually wondered if this is too powerful, the ability to end a rare card immediately with an edit. Maybe we
   can still allow edits but effectively queue them as future history until the effect runs out naturally?" Then:
   "Closer to [History only], but it may make sense to add a 'Return to present' button in the Lens which does the
   same thing as the existing History, just accessible from an area that is about the Effect." So an edit lands as an
   Act at once and History lists it, and the post keeps showing the rewound version. Weighed: the row's own way out
   (the author's edit ends it at once), and a Fast-forward on the post itself that any reader could press and keep.
3. **The edit box holds the author's newest words** (the owner: "I think an edit box would hold their newest words").
   Nothing about editing changes: the box starts from the latest version, as it does on any post.
4. **The Lens gets "Return to present"** (2.2). On a Time Machine's Lens, beside "As it landed", a tile shows the post
   as it is now in the post's body, the way "As it landed" shows a moment, and pressed again returns to the rewind. It
   shows nothing History does not: every version of a post is already public.
5. **Kept at 3 days, any post, up to rare** (the owner: "Keep as is"). With edits queued, a Time Machine on one's own
   post is a 3-day undo and a 3-day block on every card up to rare. Sugar Coat, also rare, blocks Salty and Pepperoni
   for a week. Weighed: refusing it on the player's own post; blocking new cards for only the first 24 hours.
6. **The freeze refuses every kind of play up to rare** (confirmed with the design). A Move, a Gimmick used on the
   post, and a card set face down are all refused, and nothing face down there springs, so the rewound post is still.
   A legendary card gets through (no card up to rare is a rarity bound, as every Ward's is), lands, and shows on top,
   since it was played in the present. Weighed: refusing only Moves, as a Ward does, which would let a Reversal be set
   on a post that cannot spring it.
7. **The look is VHS** (the owner's pick, from a mockup of three). The post's content area takes faint scanlines, a
   slow tracking line, and a VCR read-out in the corner, "◀◀ PLAY NOV 14 9:02PM", in the card art's green. On arrival
   it plays one short rewind, lines streaking backward. Weighed: a faded photo (a sepia wash and a dated caption), and a
   plain band above the words that fills nothing.
8. **Quoting it quotes the words it shows**, which the forged-quotes rule already holds authentic ("any version of the
   quoted post written before the save that no admin has hidden",
   `docs/plans/2026-11-20-forged-quotes-design.md`). A spun thread's live ORIGIN box shows the post rewound too.
9. **The owner's copy rule:** in a player's words the verb is "play", never "cast", and the noun is "Move". The row's
   summary said "Cast on a post"; it is now "Played on a post".

## 3. What the engine gains: the rewind

The engine names no card (CLAUDE.md, "KayfaBB never knows which instance it runs"). It gains one card property, named
for what it does:

- **`CardRules.rewind: { upTo: Rarity }`.** A cast card on a post alone, with a `lasts`, face up only, whose checked
  configuration is `{ to: <a version's Act id> }`. While it is up, the post shows as of the point `to` names, and no
  play of a card no rarer than `upTo` lands on the post. The instance's Time Machine sets `upTo: 'rare'`. SQL knows the
  rarity (`card_kinds.rewind`).
- A rewind card has no Gimmick, no veil, no reaction, does not write, reply, draw or run a drive, and is never offered
  to a Mod Bot (it has a point to pick, which a persona's play has no way to choose). `instanceProblems` and
  `card_kinds_problem` both hold this.
- A second rewind on a rewound post is refused by the first one's freeze at any rarity up to its `upTo`; a rewind
  card rarer than another's `upTo` gets through and its own point and freeze apply over the first, the later play
  drawn (no card in the Base Set does this; the rule is stated so the engine has one).

## 4. How it works

### 4.1 The points

A **version** is the post itself or one of its `edit` Acts (`edit_post`, `0395_polls.sql`). A version's **time** is
when it was saved. The point a version names is:

- **The post itself:** as first posted, at the post's time plus `editGrace`. An edit saved inside the grace window is
  part of "as first posted", as "Last edited" already treats it (`acts_public`'s `shown_edited_at`).
- **An edit saved after the grace window:** at that edit's time.
- **An edit saved inside it** is never a point, and is refused if named.

A point is **offered** when showing it would change what the post shows: a version was saved after the point's time,
or a card played on the post after the point's time is still showing. A post with no offered point refuses the card,
in the same words for every player.

The engine computes the offered points in one pure function (`rewindPoints`, `engine/rules/rewind.ts`) from the
post's versions, its plays and the grace, and the play form lists them. SQL decides again (`rewind_point_problem`) and
is the authority.

### 4.2 What the rewound post shows

Given a live rewind play R on post P, naming a point at time T:

- **Words:** the latest version of P saved at or before T, through `shown_payload`, so a version an admin has hidden
  stays hidden exactly as it does in History.
- **Cards on P and above it:** a play shows if it was played at or before T and still shows now (it is not over by
  the engine's own `shownPlays`), or if it was played at or after R itself (R, and anything that got through the
  freeze). Every other play is hidden. A hidden play is not ended: its clock runs, settlement reads it as before, and
  it shows again when R ends.
- **"Last edited"** shows as of the version shown.
- **Reactions** go to the post as always; a rewind changes nothing about reacting or about any count.

R is **live** while its time is not up and it is not ended (`card_ended`). More than one live rewind on a post can
only be a rarer one over a lesser one; the latest played is drawn.

The server gives the rewound version with the page, so the post's first paint is already rewound and the present
never flashes: `rewind_view(play)` returns `{ play, post, at, version }` (the version shaped as `play_moment`'s
`version` is), and `thread_page` carries a `rewinds` list for every live rewind on the page's posts and on its ORIGIN
post. A rewind that lands while a reader is on the page arrives with its play; the client reads its view once
(`api.rewindView`) and keeps it, as "As it landed" keeps a moment.

### 4.3 The freeze

In `place_cast` (a Move, and a Gimmick used on a post) and `place_set` (a card set face down), before anything is
written: if the target post has a live rewind and the incoming card is no rarer than its `upTo`, the play is refused
with words built like a Ward's ("this post's Time Machine turns away cards up to rare until {time}"), mirrored in the
engine (`rewindWords`, beside `wardWords`) so the screens refuse before the server does. A pierce (Cheap Shot) gets
past a rewind as it gets past a Ward: when the rewind card is no rarer than the pierce's `upTo`. Cheap Shot is
uncommon and Time Machine rare, so today it never does.

A play that gets through (a legendary) springs nothing: `place_cast` does not call `spring_traps` for a post with a
live rewind. A card already face down there stays, and comes back to its setter's hand when its set time ends, as any
unsprung back does.

### 4.4 Edits

Nothing changes in `edit_post`. An edit during a rewind lands as the newest version, and `acts_public`'s
`current_payload` is that version, as it always is. Only the drawing of the post in a thread and in an ORIGIN box
reads the rewind. History, a quote already written, the board's and profile's previews, search and every other
surface show the post as it is now.

### 4.5 The Lens

A Time Machine's Lens shows the engine's status, "Showing an earlier version", and:
- **"As it landed"**, as every play has: the post as it was when the Time Machine was played.
- **"Return to present"**: the post's newest version with every card showing, in the post's body, framed and tagged
  "The present" the way a moment is, without the rewind's own effect. Pressed again, it goes back to the rewind. Like
  "As it landed", one view shows at a time and it goes with the Lens.
- **A plain line** when cards are hidden: "{n} later cards hidden until it ends" (n counted from plays the page
  already holds, all public).

### 4.6 The look (the board world)

The rewind is drawn on the post, in the board world (`docs/plans/2026-10-29-two-worlds-design.md`), in a 2003 message
board's black and white with color only on the game's own pieces.

- **Which box it fills** (CLAUDE.md, "An effect fills the post, border to border"): the post's content area, border to
  border, in a thread and in a spun thread's ORIGIN box alike. It never leaves the area. The scanlines and the tracking
  line take no pointer, so every link and spoiler in the words stays pressable.
- **Scanlines:** a faint repeating line over the whole area, dark enough to read as tape and light enough that the
  words keep the board's contrast.
- **The tracking line:** a soft bright band that drifts slowly down the area and wraps.
- **The read-out:** "◀◀ PLAY" and the point's date and time ("NOV 14 9:02PM", in the reader's time zone, uppercase, in
  Courier), set in the area's top right corner, in the card's green darkened to at least 4.5:1 on white. It is a
  picture of the status: the words "Showing this post as it was on {date}" are given to assistive technology.
- **Arrival:** once per page load per play, a 600ms rewind: horizontal streaks run backward across the area and the
  words settle. Reduced motion skips it and holds the tracking line still.
- **Accessibility** (CLAUDE.md, "An accessible path costs what the obstacle costs"): the rewind hides nothing a reader
  needs to get through; the rewound words are readable as any post's, and the present is one press away in the Lens or
  History for every reader alike. So it needs no accessible path of its own beyond the label and reduced motion.

## 5. Ways out

(CLAUDE.md, "No player is ever stuck.")
- **The rewound post** ends by itself after 3 days, or at an admin's "End this card" (`reverse_card`, which writes a
  `card_end` that `card_ended` already reads).
- **The author** is never locked: they edit as always, and the edit shows when the rewind ends.
- **A card hidden by the rewind** keeps its own way out, which is time-based for every timed card. A Whoops! splat
  hidden by a rewind cannot be washed while hidden, but it is hidden, so it costs the author nothing until it shows
  again, and its own time runs.
- **A card face down on the post** cannot spring while the rewind is up, and comes back to its setter at its set time,
  as every unsprung back does.
- **A player refused by the freeze** is told the time it ends, in the refusal.

## 6. The masks

(CLAUDE.md, "A response never proves a private fact.")
- The points are computed from a post's versions and plays and the grace setting, which are all public.
- The freeze's refusal reads the post's plays and the incoming card's rarity alone; it is the same for every player,
  whoever owns the post or the playing character.
- `rewind_view` reads `acts_public` and `shown_payload`, as History does; an admin-hidden version stays hidden.
- The Lens's hidden count is counted from plays already on the page.
- Nothing new is broadcast: a rewind's play arrives as any play does.

## 7. A busy instance

(CLAUDE.md, "Weigh a design at the scale of a busy instance.")
- `thread_page` asks for live rewinds once per page, over the page's posts and its ORIGIN post, from the card plays
  on those posts that it already reads by target, filtered by `card_kinds.rewind`. A page holds at most
  `postsPerPage` posts, so the cost is bounded by the page and never grows with a thread's or board's history.
- `rewind_point_problem` reads one post's versions and plays, at a play's time, never a board's or thread's.
- The freeze check in `place_cast` and `place_set` is one indexed lookup on the target post.
- The client filters the plays it already holds; no extra read per post.

## 8. Overlap with builds in progress

SoVeryHappy (#936) redefines `card_kinds_problem`, `place_cast`, `place_set` and `thread_page`. Buzzkill, which waits
for SoVeryHappy, redefines `card_kinds_problem`, `seed_instance`, `place_cast` and `reverse_card`. This build redefines
`card_kinds_problem`, `seed_instance`, `place_cast`, `place_set` and `thread_page`, so it starts after both have
merged and copies each object whole from its latest migration on `main` at that time. It touches neither
`spring_traps` nor `reverse_card`.

## 9. Open

- **Whether 3 days is too strong on one's own post** without the edit's way out is left to the season review, like
  every economy number.
- **Necro Bump and Ratio** remain for their own design sessions; the roadmap's "post and thread plan" is now three
  card plans, each with its own engine part.
- **What a rewind does to a post shown in a quote box or a preview** is nothing (section 4.4); if play shows readers
  expect a quote box to rewind too, that is a later design.
