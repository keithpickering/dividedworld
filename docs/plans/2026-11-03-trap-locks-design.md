# Trap locks, even trap work, and seven true lines: design

Record, written 2026-11-03. A design session with the owner. It takes up #136 whole (F1–F5), #171's first follow-up,
#149's F2, #118's F7, and #179's Lurker words. Its plan is `docs/plans/2026-11-03-trap-locks-plan.md`.

## The defects

- **#136 F2, a deadlock on a trap path.** `post()` (`supabase/migrations/0058_alerts.sql`) inserts the post and only
  then locks the `face_down` rows the post may spring. The insert's `acts_count_character` trigger
  (`0030_screens_reads.sql`) has already locked the poster's `character_post_counts` row. `play_card` (0058, and its
  ten-argument wrapper in `0070_autocorrect.sql`) works the other way round: `spring_traps` locks `face_down`, then the
  card's insert locks the caster's count row. A character that quotes a trapped post while a cast goes onto that post
  through the same character deadlocks. This was reproduced on localhost (40P01).
  `docs/plans/2026-11-01-card-mechanic-design.md` section 4 promises that "a trap never refuses, delays or rolls back the
  write that springs it", and Postgres refuses one of the two writes.
- **#136 F4, uneven work behind a card back.** `spring_traps` decides whether a trap `springs` before it reads the
  setter's state. A matching trap whose setter is retired, or has not debuted, therefore makes two reads before it
  returns null, and a Bluff makes none. A matching strike trap whose target's stack is already full also makes a
  stack count that a Bluff never makes. Both writes come back alike, but the time each takes is computed from what is
  face down, which is a private fact ("A response never proves a private fact").
- **#136 F5, backs that already sprang.** `post()` locks and probes every live back in the thread, including those that
  have already sprung, until their `setLasts` runs out.
- **#136 F1, the export test.** `supabase/tests/e2e/0003-export.ts` seeds no set and no spring. Its "each table holds
  something" guard passes only because 0059's race block commits rows.
- **Five lines that say something untrue**, each in the player's own log or on the glass:
  - #136 F3, `engine/ui/log/lines.ts`: every set card's line says "It springs once, or ends by itself". A Bluff never
    springs.
  - #171 F1, `instances/divided-world/ui/cards.ts` (`logSave`): "it covers nothing now" goes untrue once an edit brings
    the phrase back, because strips follow the phrase.
  - #149 F2, `instances/divided-world/ui/hint-words.ts`: thunder says "more reactions than the post itself has", but
    `supabase/functions/act/core.ts` (`fireHints`) compares only the window's counts.
  - #118 F7, `engine/ui/characters/Characters.tsx`: "Only you see it there" is true only for the character the player
    is posting as.
  - #179, `instances/divided-world/ui/index.ts`: the Lurker says "a day", but the rule counts per settlement window
    (`settlementLength`, which an admin can tune).

## 1. One lock order for every trap path (#136 F2, F5)

**Decided:** every path that can spring a trap takes its locks in one written order:

1. the player's `accounts` row (`play_card`, `set_card`);
2. the target post's `acts` row (`play_card`'s `for no key update`);
3. `face_down` rows, by `play`, all in one statement;
4. the `threads` row that a post's `seq` comes from (`acts_take_seq`'s update), taken explicitly before the count rows;
5. `character_post_counts` rows, by `character`;
6. `wallets` rows, by `account` (a payout, as 0058 already does).

`post()` takes 3, then 4, then 5 before it inserts. Step 5 covers the poster and every setter of a back it locked. A
strike writes a card through the setter's character, which is a counted Act, so holding the setter's row ahead of time
keeps two strikes on each other's posts from crossing. `play_card` already takes 1, 2, 3 and then 5 (through its
insert), and a card takes no `seq`, so it does not change. The order is written once, in the new migration's header, and
each function that takes these locks cites it.

Step 4 is part of the order because the post's own insert updates the thread row before its count trigger runs. If
`post()` held its count rows first, a post-kind Act inserted elsewhere by the same character in the same thread would
take the thread row and then wait on the count row, which is the same deadlock moved one step along.

A count row that does not exist yet is inserted (`on conflict do nothing`) in character order, in one statement, before
it is locked. Two writers creating the same row then wait in the same order as well.

**F5, folded in:** the lock statement skips a back that has already sprung (`not exists` a `spring` naming its `play`,
through `acts_one_spring`). A spring is public, so skipping one tells nobody anything. `spring_traps` keeps its own
check after the lock, which catches a spring that lands while `post()` waits. The migration's header states the cost:
one probe per live, unsprung back in the thread and on the quoted post, plus one count row per distinct setter.

**Weighed and set aside:**
- *Retry on 40P01 inside `post()`.* This leaves the deadlock in place, and the detector's wait (about a second) lands on
  the player's write.
- *A per-thread advisory lock.* Every post in a busy thread would wait behind every cast in it, which goes against "Weigh
  a design at the scale of a busy instance".

## 2. Every back costs the same work before its decision (#136 F4)

**Decided:** `spring_traps` runs the same statements for every back it holds, whether it is a Bluff or a trap, and
whether the trap matches or not, until the decision is made:

- the setter's character and its `retired_at` and `debuted_at`;
- the struck card's kind, and the stack count on `by_act` for that card. Where the back's card strikes nothing, or is a
  Bluff, the key is null. The count then reads the same index and finds nothing.

Only then are `springs` and "can land" decided. After the decision, only a spring does more work, and a spring is a
public Act.

**Weighed:** reading only the setter's state, which is all the issue names. The owner chose both reads, because the
full-stack strike is the same leak by another route.

## 3. The locks are not computed from the card either

The locks in section 1 are visible as waits: another writer on the setter's count row can feel one. So `post()` locks
**every** setter's count row, whatever card is face down. It never locks only the setters of strike traps. Which backs
are locked depends only on public facts: live and unsprung backs, on the quoted post or in the thread.

## 4. The seven true lines

The owner approved these words.

| Where | Today | Now |
| --- | --- | --- |
| Set line, card with no trap (#136 F3) | It springs once, or ends by itself. | It never springs, and ends by itself. |
| Set line, a trap | (unchanged) | It springs once, or ends by itself. |
| Autocorrect peeled clean (#171 F1) | You peeled every strip; it covers nothing now. | You peeled every strip it had then. An edit that brings the phrase back brings a strip with it. |
| Thunder, post (#149 F2) | …has drawn more reactions than the post itself has… | A card played on your post has drawn more reactions lately than the post itself. The card is the main event now. |
| Thunder, card (#149 F2) | …more reactions than the post it landed on… | The card you played has drawn more reactions lately than the post it landed on. You are the main event now. |
| Hidden online status (#118 F7) | …Only you see it there. | A hidden character isn't listed in Who is online or Users browsing. While you post as it, only you see it there. |
| Lurker class card (#179) | …posting more than twice a day. | …posting more than twice in one settlement window (1 day). The span comes from `settlementLength`. |
| Lurker log reason (#179) | Posted too much: a post past 2 in one day | Posted too much: a post past 2 in one settlement window |

**Where the set line learns it is a Bluff:** `my_card_ledger` gains `springs` (`card_kinds.trap is not null`) on each
row, and the log reads it. Which cards carry a trap is a public rule. The row is the setter's own. `card_kinds` stays
the one source. The owner set aside a flag on the instance's card definition, which would be a second list beside
`card_kinds.trap`.

**Where the Lurker learns its window:** the engine's `ClassLook.description` takes the settlement span as a second
argument, and `engine/ui/characters/ClassCards.tsx` and `engine/ui/guide/markers.tsx` pass the screen settings' `settlementLength`. A log reason sits
under its settlement, and that settlement already shows its dates, so the reason says "one settlement window" with no
length. That stays true for a row settled before a retune.

## Ways out

This design adds no state. A write that used to deadlock now lands.

## The masks

- The locks in section 1 are chosen from public facts only (section 3).
- `spring_traps`'s work before its decision is the same for every back (section 2). The new SQL test holds it there,
  with read counts.
- `my_card_ledger.springs` says whether the caller's own card has a trap. That is a public rule about a card the caller
  already knows they hold.
- The thunder words still state only public counts.

## The layers

- Engine: the SQL migration, `engine/ui/log/lines.ts`, `engine/ui/characters/Characters.tsx`, `ClassLook.description`'s
  signature (`engine/ui/types.ts`) and its two callers, and `web/src/data/supabase.ts`'s ledger read.
- Instance: `cards.ts` (`logSave`), `hint-words.ts`, and `index.ts` (the Lurker's description and reason). The span
  reaches the instance through `ClassLook.description`, and nothing in the engine names a card or a class.

## Open

- Whether a System character can ever hold a back. If one could, a Director post through it would follow the same
  order through `post()`, and the build confirms that no other inserter of a post-kind Act takes a count row before a
  `face_down` row (plan, Task 1).
