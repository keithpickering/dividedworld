Record, written 2026-11-20.

# Crowd pay: a wallet's pay for reacting: design

A design session with the owner. It began with the owner's question: "Do you think there is enough of an incentive to
React to acts? This is the only way to get Aura - but players are crowd members and also competitors. You can starve
others of aura by reacting in ways opposite their suspected class, or by simply not reacting at all. What incentivizes
reacting, and reacting honestly?" Its plan is `docs/plans/2026-11-20-crowd-pay-plan.md`. It takes up a question the
spec review left open (`docs/plans/2026-10-28-kit-step-1-design.md`, section 8: "Reactions that are currency stop being
honest signals").

## 0. The appraisal it starts from

- **Only the Lurker is paid for reacting.** Its early calls pay, and since the class-balance design
  (`docs/plans/2026-11-20-class-balance-design.md`, section 5) its misses cost the same. That pays for reading the
  crowd, not for reacting as one feels: a contrarian reaction is a losing bet through a Lurker. Mooch pays its caster
  for others' reactions, never for the caster's own.
- **Every other reaction is a gift to a rival.** Aura is minted, so a reaction costs its giver nothing, but Rankings
  ranks standings and the season's top three places take trophies, so each vote given is a relative loss.
- **Withholding is free and unseen.** Every player's income is the others' reactions, which is a public-goods game.
  Among friends reciprocity would hold it up, but who reacted is hidden, so a player can neither thank a reactor nor
  find a starver. That is the game's premise and stays; nothing here reveals a reactor.
- **Griefing is already checked.** Every reaction pays some class, so a wrong guess pays someone (a groan aimed at a
  suspected Face pays a Jabroni double since the class-balance design), a silent Turn turns a campaign into Aura, and
  the shared vote and the halving bound what one player can swing. Griefing is part of the game (the core loop design,
  section 2: "how to play along with it, or how to grief it"). Silence was the leak.
- **Honesty cannot be paid for directly**, since it cannot be observed. What a rule can do is leave no reason to fake:
  a pay that is the same whichever reaction is given.

The owner's answer: "Crowd pay exists on minus world so it makes sense." Minus World's table, as the owner gave it:

| Minus World | EX |
|---|---|
| New Post | 5 |
| New Thread | 20 |
| New Registration | 1500 |
| Per Reply | 5 |
| Per Referral | 300 |
| Get Good Sh*t | 10 |
| Give Reaction | 1 |
| Get Reaction | 5 |

Giving a reaction paid a fifth of getting one. The owner noted the table also pays for posting, "worth considering but
not necessarily the focus here": it is left open (below).

## 1. One pay for each Act reacted to

**Decided:** crowd pay counts Acts, not reactions. A player is paid once for each Act they react to, whether they leave
one reaction there or three, and whichever of their masks gives them. It is the shared vote's shape (one player, one
vote per Act), and it never pays a player to fill all three slots, which would turn a post's reactions from a heatmap
into a list of every reaction there is (the core loop design, section 5, the display cap).

Weighed: per reaction, as Minus World paid (simpler to say, but it pays to always leave three).

- **An Act counts in the window of the player's first reaction to it**, so a second reaction on another day never
  counts it again. An old Act counts: reacting to the archive is reacting.
- **Counted:** an Act of another player's character, a post or a card, as the settlement reads it.
- **Not counted** (the session's defaults, which the owner did not object to): the Acts of staff characters (Mod Bots)
  and The System's own Acts (a tally, a reveal), as the settlement already pays nobody for reacting there
  (`SettlementInput.systemActs`, `unscoredTargets`), so the tally every player reacts to is no free pay; a gift
  (`donation`), which nobody reacts to as a vote; and a card play an admin ended before the window's end, whose votes
  the settlement does not read. A player's own characters' Acts cannot be reacted to at all.

## 2. Wallet only

**Decided:** crowd pay is a wallet move of its own kind (`crowd`), seen only by the player, and never part of any
character's standing. Rankings stays a measure of how each mask performs.

The masks decide it as much as the economy does. Crowd pay is counted per player across all their masks (section 3's
cap is one cap), so a mask's public standing that held it would move with what another of the player's masks did: a
watcher who sees one mask's standing stop rising when another mask reacts more could link the two. In the wallet,
nobody but the player sees it.

Weighed: the reacting mask's standing (on Rankings, but computed from who owns which mask).

So crowd pay is not a ledger entry: a ledger entry belongs to a character, and `apply_settlement` adds every entry to
its character's standing. It has its own record (section 5).

## 3. Flat, up to a cap

**Decided:** each counted Act pays the same amount, up to a number of Acts per window. **0.02 orb an Act, up to 10 Acts
a window**: at most 0.20 orb a day, about a common card a week from reacting alone. 0.02 is Minus World's ratio (give 1,
get 5) against a 0.10 vote. An active poster earns about 0.5 orb a day (`docs/plans/2026-11-12-earn-cards-balance-design.md`),
so crowd pay is noticeable and stays under half of that.

Past the cap, the Acts paid are the earliest by the player's first reaction, ties by the Act's id. Nothing tells a
player which Act fell past the cap but their own log.

Weighed: halving per Act (it tops out near 0.04 a day and stops being a reason by the third Act); flat with no cap, as
Minus World paid (at a busy instance's hundreds of Acts a day it outgrows every class's pay); 0.01 × 10 (too small to
feel); 0.02 × 20 (close to an active poster's income, so reacting rivals posting as a way to earn).

The numbers are two engine settings, `crowdPayEach` (hundredths of an orb) and `crowdPayMost` (Acts), which the
season review retunes with a settings row. They are two flat keys rather than one object so the Strategy Guide's
`{{setting:…}}` markers say them as an amount and a count, as they say `walletCap` and `reactionCap`.
`crowdPayEach: 0` switches crowd pay off for an instance.

## 4. What it does to play

- **Honesty is the easy default.** The pay is the same whichever reaction and whichever mask, so it gives no reason
  to fake a reaction. A griefer is paid what an honest reactor is.
- **Silence now costs.** A player who withholds gives up up to 0.20 a day.
- **The Lurker** is paid crowd pay as any mask is. A miss (−0.10 at a whole vote) still outweighs one Act's crowd pay,
  so the misread still bites.
- **More masks earn no more.** The cap is the player's, not each mask's.
- **The wallet's cap** holds crowd pay as it holds any income: past six orbs it is lost, and since it is in no
  standing, nothing keeps it. A full wallet is a reason to spend.
- **Collusion** gains nothing new: two friends reacting to each other are paid what any two reactors are, up to the
  same cap.

## 5. Where it is decided and kept

- **The engine** decides it, in `settle` (`engine/rules/settle.ts`), from the window's reactions, which
  `settlement_input` already sends with their players; it reads only the reacting player's own reactions. The live
  estimate (`estimateForOwner`) runs the same code for the caller alone. One implementation.
- **The SQL** re-checks what it is handed (the core loop design, section 12: "invariants in SQL; judgment in
  TypeScript"). `apply_settlement` takes, for each player, the Acts paid. It refuses an Act the player did not first
  react to in the window, an Act of their own, a staff or System Act, a gift, a repeated Act, and a list longer than
  the cap; it prices the move itself from the setting, so the amount is never the caller's to say. It writes the Acts
  to a private table, `crowd_paid`, and one `wallet_move` of kind `crowd` per player, after the settlement's own
  moves. It writes no ledger row and no standing.
- **The log** (the player's own) shows a settlement's crowd pay as a line of its own: how many Acts, how much, what the
  cap held back, and a link to each Act. The open window's estimate says crowd pay so far. The settlement's summary
  ("While you were away") shows it in the All tab, and a settlement that paid a player crowd pay alone still opens it.
- **The Strategy Guide** says it under Aura, in the glass's plain voice, with its numbers as setting markers. The
  owner approves the words in review.

## 6. The masks

- **Read:** who reacted, in settlement (The System's scoring, the exception CLAUDE.md names) and in the caller's own
  estimate, which reads only the caller's own reactions, which the caller already knows.
- **Shown:** only to the player: their wallet, their log, their estimate. No page, payload, Realtime event or count
  another player can see changes. No standing changes (section 2).
- **Timing:** the settlement runs for everyone at once, as today; the estimate's hold (`ESTIMATE_HOLD_SECONDS`) is
  unchanged.
- **A refusal:** none is added. Reacting is refused or accepted exactly as before.

## 7. The rest of the rules

- **The layers.** The engine holds the setting, the rule, the SQL and the log line; it names no instance. Divided
  World holds the numbers (`instances/divided-world/settings.ts`) and its Strategy Guide's paragraph.
- **Append-only.** `crowd_paid` and `wallet_events` take inserts only. No Act is touched.
- **Ways out.** No state is added.
- **A busy instance.** The engine's pass is one walk over the window's reactions, grouped by player; the SQL's check
  is one index probe per paid Act, at most players × the cap rows a window. Neither grows with Acts beyond the
  reactions the settlement already reads.
- **Portable.** `crowd_paid` is an ordinary table, so the export carries it (`tools/instance-files.mjs` lists every
  table); the round-trip test covers it.
- **Accessibility.** The log line is text with links, as every log line.

## Open

- **Pay for posting.** Minus World paid for posts, threads and replies. Here a post earns only through reactions, by
  class. The owner: "worth considering but not necessarily the focus here." A design of its own if wanted.
- **Cards that touch crowd pay** (a card that raises a character's player's cap for a day, or one that takes it away
  from a target, as Minus World's Sh*tStorm stopped EXP): none now; the setting and the record leave room for one.
- **The numbers**: 0.02 and 10. The season review has them, beside the open question of how many reactors a post draws
  (`docs/plans/2026-11-12-earn-cards-balance-design.md`, Open).
- **Whether staff Acts should count.** Reacting to a Mod Bot's post is play; the default leaves it out with the
  settlement's other staff rules. Revisit if Mod Bot threads become where the crowd gathers.
