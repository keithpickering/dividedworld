Record, written 2026-11-18.

# The catalog over time (a retired card is never deleted; a play keeps its terms): design

A design session with the owner, the second of three that came out of a scrub of the open issues for defects that
break a sum or treat a player unfairly. It answers #612 (packs still pull cards the instance dropped) and #742, with
the same defect as filed in #572 (item 2) and #690 (item 4): a card retuned while a play of it is up. Both are one
question: what a change to an instance's cards does to what is already in play. Its plans are
`docs/plans/2026-11-18-retired-cards-plan.md` and `docs/plans/2026-11-18-play-terms-plan.md`, two builds that share no
code.

The owner said on 2026-11-18 that a test deployment exists, with rows and no players. So both plans say what they do
to rows an instance already holds, and test it.

## 1. A retired card is never deleted (#612)

**What happens.** Bluff and Trap Card were taken out of `instances/divided-world/cards/index.ts`. The seed
(`seed_instance`, latest in `supabase/migrations/0361_discipline_cards.sql`) only inserts and updates `card_kinds`, so
both rows stayed, and `draw_pool` (`0207_random_events.sql`), the one function that says which cards a pool can
give, went on giving them: Bluff three times and Trap Card twice after they were removed. The client has no face for
them (`engine/ui/vending/Vending.tsx`, `unknownFace`, which borrows the first card's art), no effect and no rules.
Copies sit in hands, in `machine_slots` and in `face_down`.

**What the owner was asked.** What becomes of a card an instance stops dealing:

1. Retired, never deleted. (Chosen; the recommendation.)
2. Retired and exchanged: the code may go, every held copy becomes a pull of the same rarity, and old plays draw
   nothing. Left: an effect already on a post would vanish from view, which is the engine destroying what a play did.
3. Retired, held copies frozen as keepsakes. Left: a card with no use and no way to turn it into anything is a state
   with no way out.

**The rule.** An instance's card is never removed from its list. One it stops dealing is marked `retired` and keeps
its code, art, words and rules.

- **Never dealt.** `draw_pool` leaves a retired card out, so a pack pull and a Random Event cannot give one. Its
  Vending Machine slot is hidden. A Mod Bot's offer of cards to play (`supabase/functions/chatter/core.ts`) leaves it
  out, and so do the cards a persona may name for Card Collector and 4D Chess
  (`instances/divided-world/cards/index.ts`, `staffOptions`). A card that deals others (`draws`) may not name one.
- **Still works.** A copy in a hand plays as any card does. A face-down one springs. A play already made draws,
  settles and reads in the log as before. Nothing about a held copy changes, so no state is added and none needs a
  way out.
- **Cannot vanish.** The seed refuses a payload that does not list a card the database holds, naming the card and
  saying it is to be marked retired. The release then stops before anything is written, which is what would have
  caught this.
- **Comes back.** A retired card listed as live again is dealt again from that seed.
- **Bluff and Trap Card** are restored to Divided World from the commit that removed them and marked retired, so the
  copies on the test deployment work again.
- **The unknown face** stays for a card the client truly cannot find (a client older than the database), and stops
  borrowing another card's art: it is drawn plain and claims nothing.

**The layers.** `retired` is a field of the engine's `CardRules` and a column of `card_kinds`. Which cards are retired
is the instance's.

**At a busy instance.** Retired cards are a handful of rows in a table of dozens. `draw_pool` gains one predicate.

## 2. A play keeps its terms (#742, #572, #690)

**What happens.** A card's rules are read from the current catalog by the play's card key long after the play is
made. The session's inventory found these readers:

- **Settlement and the live estimate** (`engine/rules/settle.ts`): alignment, whether the card is a Reversal, the
  earn gimmick (`by`, `flat`, quadrants, reactions, acts), the cushion share, the skim share and the ride shares, all
  from `instance.cards`. `settlement_input` and `estimate_input` (`0376_cushion_kind.sql`) choose which plays enter
  the input, and whether a play carries its `ends` and quadrant, from the current `card_kinds` row.
- **Later casts that meet the play:** `ward_refusal` (`0148_card_types.sql`) reads a live ward's strength;
  `card_target` (`0368_client_reads_plan_once.sql`) and `reach_effects` (0148) read a live play's gimmick, which is
  where a price add-on comes from, and a drive's close; `donate` (`0153_drives.sql`) reads a drive's length and
  overhead; `watched_characters` (`0362_patrol_weights.sql`) reads a watch's weight; `no_quote_on`
  (`0316_card_notes_part_4.sql`) reads a kind.
- **A face-down card when it springs:** `spring_facts` (`0374_cards_on_a_spun_thread.sql`), `spring_traps`
  (`0357_post_veils.sql`) and `lay_sprung` (`0360_setting_thread.sql`) read the trap, stack, skim, length and reach
  as they stand at the spring, not at the set.
- **Flags read later:** `keeps`, `writes`, `scores_as`, and the fall kind.
- **The words:** each card's `logPlay` and the Lens's `gimmickWords` (`engine/ui/cards/marks.ts`) say the sizes from
  the current rules, and the settled reasons `card.skim` and `card.ride` say the current share because their ledger
  lines record none.

So a play pays the old size on windows already settled and the new size on the rest, its log line restates the whole
play at the new size, and (the reviews of PR #777) a vote the old rule never paid for can be taken back at the new
size, so a play can cost its holder. PR #777 made each settled boost and cushion line record its size; the rest
stands.

**What the owner was asked.** What a retune does to a play already up:

1. A play keeps its terms. (Chosen; the recommendation.) What a player bought is what they get, and an old play's
   log line stays true. A balance fix reaches only plays made after it; an admin can end a play that must not stand.
2. A retune reaches live plays, said truly in a split log line. Left: a play changes under its holder, in either
   direction.
3. Only a retune that lowers a play's worth waits. Left: it needs a rule for which way every kind of number is
   better, and the log would explain two behaviors.

**What "terms" are.** Everything the seed writes about a card except its name: alignment, rarity, play, stack, trap,
gimmick, discipline, how long it lasts, where it reaches, skim, drive, what it draws and reads, and its flags. A
card's name is words, and a rename reaches every play. Its price is an economy setting, paid once at the play and
already recorded in the wallet's event.

**How.** The catalog keeps every version of a card's terms, and a play records the version it was made under.

- `card_terms`: one row for each version of each card, never edited. The seed adds a version when a card's terms
  differ from its latest.
- A play made by a cast, a use or a spring carries its version on its Act. A face-down card carries the version it
  was set under on its `face_down` row, and the card it lays when it springs takes that version.
- Every reader in the inventory reads the play's version in place of the current row.
- Settlement's input carries the terms of the plays it holds, and `settle` reads a play's rules from them. The words
  in the log and the Lens are given the play's terms.
- Skim and ride ledger lines record the share they were paid at, which finishes what #777 began.

**Alternative weighed: copy the terms onto each play.** Left for two reasons. A play would carry a few hundred bytes
that every other play of that card also carries. And an Act is never edited, so a play made before the change could
not be given its terms and would read the current catalog for good; with versions, every card gets a first version on
the day the migration runs and every earlier play reads that one.

**What reads the current catalog still, on purpose.** A play being made now (its own checks, price and stack), a
card's name, and the class rules' own economy settings.

**The guard.** A SQL test that makes a play of every kind of card, then changes every field of its card's current
row, and asserts that every read of that play answers as before. Its poison is one reader put back on the current
row. A settlement test retunes a card between two windows of one play (the test #742 proposed).

**The masks.** A card's terms are public catalog data, the same for every caller. A play's version says when it was
made relative to a retune, which its own timestamp already says.

**At a busy instance.** `card_terms` grows by one row per retune per card. A play's read of its terms is a
primary-key lookup. The settlement input grows by the distinct versions in play, a few dozen rows.

## 3. What is open

- **Economy settings read at settlement** (a class's pay rates and the like) are read as they stand when a window
  settles. Whether a setting retuned inside a window should reach it is a separate question, filed as an issue by the
  play-terms plan.
- **#735** (functions serve before the seed adds a new economy key) is a release-order question and is untouched.
- CLAUDE.md's "Merging" permission speaks of "while no instance is deployed". The owner was told on 2026-11-18 that
  it is out of step with the test deployment; the file is the owner's to change.
