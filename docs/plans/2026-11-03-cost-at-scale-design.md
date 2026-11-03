# Four costs at a busy instance's scale: design

Record, written 2026-11-03. Designed with the owner in a design session, from four review findings: #149 F3 (news
makes every client read its count within 250ms), #149 F4 (`my_followed_threads` counts posts in every followed
thread), #118 F5 (the database holds `presencePollSeconds` to nothing) and #136 F5 (`post()` probes every live card
back in its thread). #136 F2 (the trap deadlock) and #136 F1 (the export carries `face_down` by accident) are folded in,
since they live in the same statements and test file. The plan is `docs/plans/2026-11-03-cost-at-scale-plan.md`.

Each section is weighed at a busy instance (CLAUDE.md, "Weigh a design at the scale of a busy instance"): many players
signed in, players following hundreds of threads, and threads with many card backs.

## 1. Everyone's events are read back over the spread (#149 F3)

**The defect.** `useAlertFeed` (`engine/ui/alerts/useAlertFeed.ts`) spreads its read after `settled` over
`SETTLED_SPREAD_MS` (10s). But every arrival, `news` included, calls `countSoon`, which reads `alertsUnread` 250ms
later. A settlement writes a tally and a reveal header, and each sends `news` on `reach` (`news_announce`, 0063). So
the settlement makes every signed-in client read its count in the same 250ms anyway. The `settled` read itself fetches
a full `alerts()` page (`my_alerts`: four sources, k rows each) just to find one row.

**Decided.** The rule is about who hears an event:

- **An event only this account hears** (an alert on `account:<id>`) still reads the count 250ms after the burst. Its
  fan-out is one client, so there is nothing to spread.
- **An event everyone hears** (`news` and `settled` on `reach`) schedules one *spread read* at a random moment within
  `REACH_SPREAD_MS` (the renamed `SETTLED_SPREAD_MS`, still 10s). If one is already pending, the event joins it. So a
  burst of four news items and a `settled` costs each client one read, at its own moment. A news toast still shows at
  once, because its payload is the whole toast. Only the count waits.
- **The spread read** reads `alertsUnread`. For each settlement heard since the last spread read, it calls a new
  narrow read, `settlementMoved(id)`, backed by the SQL function `my_settlement_moved(settlement bigint)`. It returns
  the caller's count of characters that settlement moved and the time it was applied, or null when it moved none. It is
  one range of `ledger_account (account, settlement)` and one primary-key read of `settlements`. `alerts()` is no longer
  read live.

**Weighed.** *Read the count only, and toast a settlement only when the count rose.* Rejected: the count stops at 10
and mixes kinds, so a rise cannot say whether it was this settlement. *Fold the settlement check into
`my_alerts_unread`.* Rejected: it would widen a read every page load makes, for an event that comes once a window.

**At scale.** With N clients signed in, a settlement's burst costs N count reads and N narrow reads, spread over 10s.
Today it costs N count reads in 250ms plus N `my_alerts` pages over 10s.

## 2. Followed threads are ranked before they are counted (#149 F4)

**The defect.** `my_followed_threads` (0059) counts up to 100 new posts in *every* followed thread that has any, then
sorts and keeps 50. At 300 followed threads with 120 unread posts each, `my_alerts` read 3,406 buffers.

**Decided.** Rank first, then count. For each followed thread with posts past the caller's place, one backward probe
of `acts (thread, seq)` finds the newest post by a character the caller does not own. Its `created_at` is the row's
`newest_at`. The threads are ranked by it and 50 are kept, and the bounded count of up to 100 runs only for those 50.
The view keeps its name, columns, order and limit, so `my_alerts`, `followed()` in `web/src/data/supabase.ts` and the
fake are unchanged.

`newest_at` becomes the creation time of the newest qualifying post *by seq*, where today it is the max `created_at`
among the counted posts. The two differ only when two posts' transactions interleave, and then by less than one
transaction's length. This is accepted, and the view's header says so.

**At scale.** The cost is one probe per followed thread with unread posts, plus 50 bounded counts, where today it is up
to 100 rows per followed thread. The probe's one unbounded case stays as 0059 accepted it: a run of the caller's own
posts past their place.

**Noted, not changed.** `my_alerts` filters `my_followed_threads` by its cursor *after* the view's limit of 50, so
followed threads ranked below 50 never reach an older page. 0059 states the cap of 50 as intended. This design leaves it
alone.

## 3. Every setting is held where it is written (#118 F5)

**The defect.** The TS rules (`SETTINGS` in `engine/rules/instance.ts`) bound every setting. The Edge Functions refuse a
bad row loudly (`withDatabaseSettings`, `supabase/functions/_shared/settings.ts`). But SQL and the clients read settings
raw: `screen_settings` passes a `presencePollSeconds` of 0 to every client as `setInterval(poll, 0)`, and
`presenceNames` 0 breaks `here()`'s `limit cap`. About 14 of the roughly 48 keys have a SQL hold.

**Decided** (the owner chose this over the two presence keys alone, and over also checking on the client): every key
in `SETTINGS` is held at the write by a `before insert or update on settings` trigger. That is one new function,
`settings_held()`, for every key that has no hold today. The holds that exist stay as they are. The holds and the TS
rules are one list in two languages, so a test ties them together ("Two lists that must agree are one list"). The SQL
test holds a list of `(key, value)` poisons and one good value per key. A TS test parses that list and asserts three
things: its keys are exactly `SETTINGS`'s keys, the TS rule refuses every poison, and it accepts every good value. A new
setting cannot skip its SQL hold, and a SQL bound that drifts from its TS rule goes red on one side.

`instanceProblems`' cross-key rules (such as `moveExpiryLeastHours` against `moveExpiryMostDays`) stay with the Edge
Functions, which refuse loudly. A per-row trigger cannot see the other row without ordering every admin's edit. This is
open, and recorded, not decided.

## 4. A reply passes each card back once (#136 F5, with F2 and F1)

**The defect.** Every post locks and probes, through `spring_traps`, every live `face_down` row in its thread for
`setLasts` (7 days), including backs that already sprang. So a post's cost grows with the thread's card backs, against
the card design's section 12 ("one probe"). The loop also departs from that design's section 4, where a reply trap
springs on "the first post in the thread after it by another character". When one post meets two reply traps, the
newest springs and the older one springs on some *later* post.

**Decided** (the owner chose *spend the moment*). Each back's reply moment is spent by the first post that passes it:

- A new table, `face_down_reply (play primary key references face_down, thread, passed_by, passed_at)`, gets one row
  per set, for every card alike, Bluffs included. A partial index on `(thread) where passed_by is null` holds the backs
  still waiting for their reply.
- A post reads that index for its thread and takes the backs not on its own character's posts. It stamps each one
  `passed_by` with itself, whatever the card, then springs the newest reply trap among the live ones. One post springs
  at most one trap, as today. Every other back it passed has spent its moment. That includes a back that lost to a
  quote this post sprang, since the post is still the first after it.
- The row is a state of the back that changes once, so it lives in a row of its own and not in an Act or in
  `face_down`, which stays append-only. Nothing on a board shows it.

**At scale.** The scan reads only backs whose reply has not come yet. Those are backs set since the last post by
another character, plus backs on the current poster's own posts. That is bounded by activity between two posts and does
not grow with the thread. An expired back that no post has passed waits in the index until the next post passes it, at
one row per post at most.

**The deadlock (F2), folded in.** The lock order, everywhere a write may spring: the caster's account, the target post,
then every `face_down` and `face_down_reply` row the write may spring or pass (in `play` order), then the
`character_post_counts` rows of the writer and of every setter of those backs (in character-id order), and only then any
Act insert, and last the wallets. `post()` and `play_card` both insert their Act before they lock `face_down` today.
Both are reordered, and the 0054 header's lock paragraph is rewritten to this order.

**The log.** A reply trap that spends its moment without springing is a real change to the setter's card. So the
setter's log says plainly that a reply passed it and that it now ends by itself. `my_face_down` gains `passed_at`, which
is the setter's own row. #136 F3 is fixed on the same line: a card with no trap says "It ends by itself".

**The export (F1).** The new table must hold a row in the export round trip, so `0003-export.ts`'s cast gains a set and
a caught play, as F1 asked.

**Left in #136:** F4 (the setter-state read's timing).

## 5. The masks

- **The spread read** is at a random moment, and nothing about it depends on whose event it was. `my_settlement_moved`
  reads only the caller's own ledger lines. Its answer has the same shape for any id, and an id that does not exist
  answers null, as "moved none" does.
- **`my_followed_threads`** still reads only the caller's ownership, follows and place.
- **`face_down_reply`** is written for every back alike, Bluffs included, by every post that passes it. The reads,
  writes and locks a post takes are the same whatever cards are face down. Only the spring itself differs, and the
  spring is public. No client reads the table. `passed_at` reaches only the setter, through `my_face_down`.
- **The count-row locks** take every setter's row whatever their card is.

## 6. Ways out

The only state this adds is a back whose reply moment is spent. It ends by itself at `setLasts`, as every back does, and
it can still spring on any other trigger it names.

## 7. The layers

All engine. No instance's content enters. The renamed `REACH_SPREAD_MS` and the new `settlementMoved` are engine
interface. Divided World's settings pass through the same holds as any instance's.

## Open

- Cross-key setting rules in SQL (section 3).
- Whether a followed thread ranked below 50 should reach an older Alerts page (section 2).
