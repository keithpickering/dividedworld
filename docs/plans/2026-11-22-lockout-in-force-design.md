Record, written 2026-11-22.

# A live lockout is in force everywhere it is shown: design

Decided with the owner in a design session on 2026-11-22, for #989 and #991, with the two open follow-ups on #873 from
#975's delta review folded in. The plan is `docs/plans/2026-11-22-lockout-in-force-plan.md`. It finishes the owner's answer
to #984 (`docs/plans/2026-11-20-lens-who-rows-design.md`, decision 2 as amended): a card whose effect is still in force is
up now, even after its trap has sprung. #975 made the Lens's Who and the kinds grid say so (`inForce`,
`engine/ui/cards/plays.ts`). Everything else that judges a sprung back still calls it over the moment it springs.

The Lens is the glass: every word added is plain and out of character, and the copy below is the owner's, approved in this
session.

## What was found

- **Who lists one kind at a time, and a back's life crosses tabs.** Every live face-down back on a post shares one kind
  (`CARD_BACK`) and so one tab. A back that springs becomes a kind of its own (`CARD_BACK:<spring>`, `isBack`), its own
  mark and tab, named for the card it became. So a "Set" group and an "Up now" group never meet in one list: the card-back
  tab holds only face-down backs, and a sprung tab holds one sprung back (and, once post plays lands, the earlier sprung
  backs its pager reads).
- **Three places still call a live lockout over** (#991):
  - `backWords` (`engine/ui/cards/marks.ts`) gives every sprung back the way out "It has sprung, and ended.";
  - `playOver` (`plays.ts`) counts every `revealed` back over, so `kindSpent` draws the post's mark spent
    (`data-kb-spent="true"`, `engine/ui/cards/Marks.tsx`) and the billing sorts the kind among the spent ones
    (`engine/ui/cards/billing.ts`);
  - `nextEnd` (`plays.ts`) reads only a play's `ends`, so `useUntil` never wakes at a back's `endsAt` or a lockout's
    `revealed.until`. A Lens or a mark left open past a lockout's end goes on showing it up now, and an admin's End is
    refused by the server (#873, second delta follow-up). This was already true of a face-down back's `endsAt`.
- **Nothing holds `until` when the spring is read before its back** (#873, first delta follow-up): the merge in
  `createPlays().add` that reveals a back from a spring read earlier (`early`) copies `until`, and no test goes red when
  it is dropped. The same merge does not look at whether an admin's end of that spring was read first (the `ended` set),
  which the in-order path does; the plan's test settles whether that loses `reversed`.
- **Post plays (#973, not merged) keeps a lockout back over from its spring.** Its kept row (`play_post`,
  `play_row` in `0407_play_post.sql` on `claude/post-plays-build`) sets a back's `over_at` at its spring. Its read of a
  page (`post_play_ids`) holds a sprung back only as one of its kind's two stand-ins (newest, most drawn), and its pager
  (`kind_play_ids`) reads every play not in force as ended. Three springs inside one lockout's span would leave the oldest
  live lockout off the page, found only by "Show older plays", under Ended.

## What was decided

1. **No Set group (#989).** The owner, on seeing that face-down backs already stand in a tab of their own: the tab, its
   name and its status line ("Face down on this post") already say a back is set, so no group, heading or grid sign is
   added. The kinds grid's "N up now" stays true of a live back, which is in force. #989 closes as won't-fix on the
   owner's word, linking this design. Weighed: a "Set" heading on the card-back tab, drawn by the Who-rows rule (only
   where an Ended group follows); the same heading always drawn; a grid sign of its own for the card-back kind ("N set").
2. **One rule for a sprung back, read everywhere.** A sprung back is in force while it sprang into a lockout
   (`revealed.until` present), the lockout's `until` is ahead, and no admin ended it (`reversed`). Before, `inForce`
   alone said this; now `playOver` says its negation for a sprung back, by the same helper. In a spun thread's ORIGIN box
   (`then`), a sprung back the moment holds is judged as it stood, as every other play is: a live lockout then is not over.
   A sprung back with no lockout is over, as today.
3. **The status line (#991), the owner's copy, approved as written.** `backWords`'s `ends` for a sprung back:
   - lockout live: **"Its lockout ends Nov 23, 9:14 PM."**
   - lockout ran out: **"It sprang, and its lockout ended Nov 23, 9:14 PM."**
   - an admin ended the lockout: **"It sprang, and an admin ended its lockout."**
   - a sprung back that locked nobody out: unchanged, **"It has sprung, and ended."**

   The time is `dayAndTime`, in the reader's zone, as every other end the Lens says. The heading "Sprang on Nov 21" and
   the note are unchanged. The locked character is not named here (the owner weighed naming them, as the log does, and
   kept the line short); the log line already names them to those it is shown to. In a moment the Lens's clock is
   `BEFORE_EVERY_END`, so a lockout the moment holds reads "Its lockout ends …".
4. **The mark stays lit until the lockout ends.** It follows from decision 2: `kindSpent` reads `playOver`. The billing's
   spent-last order reads the same.
5. **An open screen wakes at every end it shows.** `nextEnd` reads a face-down back's `endsAt` (while it has neither
   sprung nor been taken back) and a sprung back's `revealed.until`, beside a play's `ends`. So `useUntil` wakes the Lens,
   the marks and the Who groups when a back's time or a lockout runs out: the row moves to Ended, the status line turns to
   the past tense, the mark unlights and End goes, with no read.
6. **The kept row agrees with the screen (owner's choice).** In post plays' `play_row`, a back that sprang into a
   lockout (its spring's `did` is `lockedOut`) takes the lockout's `until` as its `ends_at` and an admin's `card_end` of
   that spring as its `over_at`; any other back is as post plays left it. A `card_end` of a lockedOut spring refreshes the
   back it names. So `post_play_ids` holds every live lockout as in force, `kind_play_ids` never pages one as ended, and
   the drift check (`play_post_drift`) holds the rows to the Acts as it does every row. Weighed: leaving the rare case
   (a live lockout read through the pager, under Ended, until paged in).

## Layers

All engine. `plays.ts`, `marks.ts`, the Lens and the marks are the engine's, and so is the migration: a lockout is an
engine trap outcome (`0402_thread_lockout.sql`), and nothing added names an instance. No interface is added.

## The masks

Nothing added reads a private fact. A lockout's `until`, its spring, and an admin's end of it are public Acts every reader's
page already holds (#984 grouped by them); the kept row's `ends_at` and `over_at` are public facts of those Acts. A
face-down back's kind stays hidden: the card-back tab is unchanged, and `nextEnd` reads a back's `endsAt`, which is the
same span for every Set and names no card (the card mechanic's design, section 3). The extra wakes are a reader's own
clock at public times; no read, payload, Realtime event or timing is added.

## Ways out

No state is added. A lockout already ends by itself at its `until`, or by an admin's End on the Lens
(`0402_thread_lockout.sql`); this design makes every screen say so while it lasts and the moment it ends.

## At a busy instance's scale

`nextEnd` stays one pass over the plays it is given. A kind is woken only at its own ends, so a lockout's end redraws the
marks and Lens of its own post. The kept row's change touches only backs with a lockedOut spring, through the same
indexed probes `play_row` already makes (the spring by `set`, the `card_end` by target); the backfill refreshes only
those backs. A post holds at most as many live lockouts as its springs inside one lockout's span (a week at most).

## Open

Nothing.
