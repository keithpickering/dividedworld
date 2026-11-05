# A spun thread's origin, wherever it is: design

Record, written 2026-11-04. A design session with the owner. A thread spun from a post shows "↳ spun from #12 in Title" in
its board's index and "Spun from #12 in Title" at the head of its ORIGIN box. A thread spun from a card play shows
neither: the index has no line, and the box's head reads "Spun from an Act". This design gives every spun thread its
origin's link wherever that origin can be found. Its plan is `docs/plans/2026-11-04-origin-place-plan.md`. No issue was
filed before this session. The search found none that covers it (#26, #86, #100 and #164 are near it, but none of them
covers it).

## 0. Where it starts

- **The link is three columns.** `thread_open` and `thread_list` (last defined in `supabase/migrations/0063_season_news.sql`)
  join a thread's `origin_act_id` to the Act and read `origin_thread`, `origin_title` and `origin_seq`: the origin Act's
  thread, that thread's title, and the Act's own place number.
- **A card play has no place number.** `acts_take_seq()` (`0035`, then `0054_card_plays.sql`) gives `card`, `set`,
  `spring` and `edit` a null `seq`. So a spin from a play has a null `origin_seq`.
- **Both screens drop the link when the number is null.** `ThreadRow` in `engine/ui/board/Board.tsx` draws no "spun
  from" line. The head of `Origin` in `engine/ui/spin/Origin.tsx` falls back to "an Act". The box's mark still offers
  Go to post because it finds the post by itself (`useLocated`). That is why the box half works and the index does not.
- **An update's spin is half handled.** The ORIGIN box links an update to `/updates?update=…`. The board's row reads it
  as "#N in Updates" and links into the updates thread, which `thread_open` leaves out (`0062_updates.sql`), so that link
  leads nowhere.
- **A play can be beyond a post.** A card cast on a character, a thread or a board (`0055_card_reach.sql`) names its
  target in one `play_reach` row, by exactly one of `character`, `thread` or `board`.

## 1. What the link says and where it goes

**Decided** (the owner chose the recommendation over two alternatives): the link names the play and goes to where it
landed.

| Origin | Words | Goes to |
| --- | --- | --- |
| An Act with a place number (a post, a spin's first post, a reveal, an unmask, a tally) | `#12 in Title` | the post, as now |
| A face-up play on a post, and a trap's spring | `Whoops! on #12 in Title` | that post |
| A face-down set on a post | `a face-down card on #12 in Title` | that post |
| An update | `the update “Headline”` | `/updates?update=<id>` |
| A play on an update | `Whoops! on the update “Headline”` | `/updates?update=<id>` |
| A play on a character | `Whoops! on Mario Mask` | `/c/<id>` |
| A play on a thread | `Whoops! on the thread Title` | the thread's first page |
| A play on a board | `Whoops! on the board General` | `/b/<slug>` |
| An origin that cannot be placed | `an Act`, unlinked | nowhere, as now |

The board's row reads "↳ spun from …" and the box's head reads "Spun from …", with the whole phrase as one link. The
card's name comes from the instance (`instance.cards`, by `key`), the interface the marks already read it from. A key
the instance no longer has reads "a card".

Weighed:
- **Just the post** ("spun from #12 in Title"). Shorter, but it cannot tell a reader that the thread came from a play
  and not the post.
- **Open the play** (a link that opens the Lens on that play). It lands on the play itself, but it needs a new address
  parameter, and the box already shows the play.

**Decided** (the owner chose the recommendation): a play beyond a post links to its target's page. Naming the target
without a link was weighed and turned down, because the page is there and the reader would have nowhere to go.

The update rows fix today's board link for an update's spin, so the two screens say the same thing for every origin.

## 2. One place, read with the row

**Decided** (confirmed with the owner): the views work out the origin's place in SQL, as one `origin_place` jsonb
column, so the board's single read carries everything the line draws and no row costs a read of its own.

The place is a tagged object (the plan gives its exact keys):
- `post`: a thread, its title and a place number.
- `update`: the update's Act and its headline.
- `play`: the card's key, or none for a face-down set, and `on`, the place it landed. That place is a post, an update,
  or one of `character` (an id and a name), `thread` (an id and a title) and `board` (a slug and a name).

It goes by the Act's kind before its place number, so a legacy card that still holds a number (0035's note, #86) reads
as a play. `origin_title` and `origin_seq` go, since the place replaces them. `origin_thread` stays: the ORIGIN box
subscribes to the origin Act's own thread for live edits and plays, and that is a different fact from where the link
goes.

Weighed: a client-side lookup for each row with no place number. That is a read per spun row on every board page, which
grows with a busy board's spins, and it would leave the board and the box working the place out in two places.

## 3. One line, drawn in one place

**Decided** (confirmed with the owner): one engine component, `OriginLink`, draws the phrase and its link, and both the
board's row and the box's head use it. The board's line and the box's head drifted apart because each drew its own
link, so one component makes that drift impossible. `ThreadSummary` swaps `originTitle` and `originSeq` for one typed
`origin: OriginPlace | null`. `Post` still opens the ORIGIN box on `originActId` and `originThread`, so a spun thread
whose origin cannot be placed keeps its box, which reads "Spun from an Act".

## 4. The rules

- **The masks.** The place uses only facts every reader already sees: the card on a face-up play (its mark shows it),
  the post, update, character, thread or board it landed on, and their public names. A set's payload holds no card
  (`acts_set_payload`, 0054), and the card a trap holds is named only by its spring, a separate public Act, so a
  face-down set's place carries no card. The place never names the caster, and nothing in it depends on who owns a
  character. Characters' names are read from `characters_public`.
- **The layers.** All of it is engine. The engine names no card: the instance's `cards` list turns a key into a name.
- **The scale.** The view adds a handful of left joins by primary key (the target Act, its thread, the `play_reach` row
  and the one target it names), once for each row a read returns. A board page stays one read, and `spunFromMany` stays
  one read for each chunk.
- **Append-only and the export.** Nothing is stored. Only the two views change, so the export and its round trip are
  untouched.
- **No one is stuck.** There is no new state. An origin that cannot be placed reads "an Act" as it does now.
- **The worlds.** Both lines are in the board's house style, as they are now, with no new styles.

## 5. Open

- A play on a thread that no list holds (the updates, reveal or Turns thread) links to `/t/<id>`. The reveal and Turns
  threads open by link (0063). For the updates thread the link leads nowhere, as an update's row does today. No card
  targets that thread today. If one ever can, its place should be `update`, and that is left for the change that lets
  it.
