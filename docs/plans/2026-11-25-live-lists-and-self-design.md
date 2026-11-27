# Live lists and the player's own state: design

Record, written 2026-11-25. A design session with the owner, begun from the question "Does our board index (main
index + thread list inside a board) update asynchronously without a refresh? Similar question for Aura, which I've
seen take a refresh when grant_aura is the source", and then: "Let's treat this as a design session and fill any gaps
we can find. The biggest one would be new posts inside an actual thread (this one might already be handled)." Its plan
is `docs/plans/2026-11-25-live-lists-and-self-plan.md`. It builds on the screens design's live updates
(`docs/plans/2026-10-29-screens-design.md`, section 2), the forum-load design's boot and Back cache
(`docs/plans/2026-11-05-forum-load-design.md`, sections 3 and 6) and the alerts design's private channel
(`docs/plans/2026-11-02-alerts-design.md`); everything those decided stands.

## 0. What was found

| Surface | Today | Server | Client |
|---|---|---|---|
| A thread | Live | `thread:<id>` carries Acts, tallies, effects, cut-ins, polls | `Thread.tsx` hears all of it |
| A board's thread list | Static until a reload | `board:<id>` fires `thread` only when The System's `masks_change` (latest `0100_announce.sql`) makes a thread; a reply sends nothing | `subscribeBoard` exists (`web/src/data/supabase.ts`) and no screen calls it |
| The index | Static until a reload | No topic | Nothing |
| The wallet | Read again only after the player's own actions | `wallet_move` writes `wallet_events` and sends nothing | Nothing hears a move |
| The hand | Same | `card_ledger` rows by others' acts (a card caught, returned, withdrawn) send nothing | Nothing |
| The player's characters (warns, bans, bars) | Same | A Mod Bot's ruling writes an Act and an alert; the alert is heard, the characters are not read again | Nothing |
| Profile, rankings, log, search, updates, vending | Read on each visit | — | — |

- **A thread was already handled.** New posts slide in at the bottom or show "N new posts" above the HUD, as the
  screens design decided; edits, tallies, plays, effects and polls update in place.
- **`grant_aura`** (`0146_aura_grant.sql`) credits through `wallet_move`, so the wallet it moved shows only after a
  reload. Every other move the player did not make themselves is the same: a settlement, a trap, a System trap, a
  refund, a gift, the crowd, an appeal's refund, a card's withdrawal.
- **A settlement** is heard as `settled` on `reach`, but only the alert feed listens; the HUD's wallet stays as it was.

## 1. Scope

**Decided (the owner):** the board's thread list, the index and the player's own state go live. Profile, rankings,
the log, search, updates and the Vending Machine stay read on each visit, as a 2003 forum's pages were.

## 2. A board's thread list

**Decided (the owner): update in place, and a bar for what would reorder.**

- **The server.** One trigger after insert on `acts`, for an Act in a thread with a place number (`seq` not null),
  queues a `row` event on `board:<board>` carrying that thread's row exactly as `board_page` lists it from
  `thread_list`. It is the one source: The System's `thread` broadcast in `masks_change` is removed, since a new thread's
  first Act fires the trigger.
- **On the page.** A row the page already shows takes the new row's replies, Last post, HOT and the reader's NEW (their
  own reading row against the new `lastSeq`) in place, without moving. A thread the page does not show, or one whose
  new `lastAt` would put it above a row shown before it, counts toward a bar above the list: "1 thread has new posts" /
  "N threads have new posts", with a **Show** button that reads the page again as a navigation to the same address
  does. Pins and moved-thread stubs never count. The bar is a polite live region that speaks its count; rows are never
  announced.
- Weighed: re-sorting live (a row moves out from under a press, and later pages shift); a bar alone (the counts on
  screen stay stale).

## 3. The index

**Decided (the owner): in scope; the session's call, confirmed: a topic of its own, rows in place.**

- A new topic, `index`, with the board topics' audience (every signed-in player). The same trigger queues a `board`
  event on it with that board's summary as `index_page` builds it: thread count, Last post's time and character, last
  thread and its title.
- Boards keep their order (by creation), so a row updates in place and nothing needs a bar. A Last-post character the
  page does not know is read once by id. A `board` event for a board the page does not list (one made or reopened since
  the load) reads the index again.
- Weighed: the index joining every `board:<id>` topic (a channel per board per reader, which grows with boards); the
  `reach` topic (every page on the instance would hear every post).

## 4. The player's own state

**Decided (the owner): a poke, then a read.** The player's own channel `account:<id>` (`0061_account_channel.sql`)
carries a bare `self` event, with no amount, card or character in it. The HUD gathers pokes over a short debounce and
runs the read it already runs after the player's own actions (`player.refresh`: characters, wallet, hand). The orbs'
cascade then plays from the wallet last seen on this device, as it does after a purchase.

What sends `self` to an account:

- a `wallet_events` row for the account, of any kind but `settlement`;
- a `card_ledger` row for the account;
- an Act that changes what `my_characters` shows for one of the account's characters: the kinds that name a character
  (an infraction, a ban, a move that names one, a reveal), and those that end or rule on one (a move's end, a card's end,
  an appeal's ruling), each routed to the account that owns the character it changes. The plan names each kind, and a
  test holds every Act kind to a choice of "can change a player's own state" or "cannot", so a kind added later is
  classified or the build fails.

**A settlement sends no `self`.** Every wallet moves in one transaction, and a poke to every account would bring every
reader's read in the same second. The HUD instead reads again on `settled`, which it already hears on `reach`, at a
random moment inside the alert feed's spread (`REACH_SPREAD_MS`, ten seconds). Weighed: the event carrying the new
values (a second shape of the same rows to keep in step with the reads); a read on focus alone (stale while the player
is looking, which is the case that was found).

A ban or bar that ends because its time passed writes nothing, so nothing pokes; the HUD's own timers end those as
they do today.

## 5. The masks

- `row` and `board` carry only what the board page and the index show any signed-in player. Neither carries views:
  those stay hourly batches (the screens design, section 2), and a test holds the `row` payload's keys to the list.
- `self` carries nothing, and only the account it names can hear `account:<id>`. Sending it reads who owns a character,
  a private fact, and the poke goes only to that owner, as an alert does. Its timing differs only for the owner.
- Nothing about who reacted reaches a list: a tally is not a `seq` Act, so it fires no `row`.

## 6. At a busy instance

- A post costs three broadcasts where it cost one (its thread, its board, the index), each a single row, and makes no
  reader read anything. The trigger's projection reads one `thread_list` row and one board summary, both indexed.
- A wallet move is one poke to one account and one read by that account's open pages. A settlement pokes no one; every
  reader's read is spread over ten seconds.
- The board bar's **Show** reads one page document, as a click does.

## 7. The layers

All of it is the engine's: the SQL, the adapter's topics and events, and the screens. No instance content takes part.

## 8. Open

- A thread moved to another board (a board move) lands on the new board's list on its next Act; the old board's stub
  comes from the page read. Whether a move should itself send a `row` to both boards is left to the build's reading of
  how a move is written, and named in the review focus.
