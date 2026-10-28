# The core loop: the first playable slice

Record, written 2026-10-28. The design session for Divided World's first slice: what a player plays for, what a class
is, how reactions and postcards turn into Aura, and what the slice holds. It starts from the open questions in
`docs/plans/2026-10-28-kit-step-1-design.md` section 8. Each section was confirmed by the owner before the next. The
engine's plan is `docs/plans/2026-10-28-core-loop-engine-plan.md`; the screens and effects get a design session of
their own (section 12).

## 1. What a player plays for

**Decided:** seasons that end in a reveal. A season is about three months by default, "like actual seasons", long
enough for arcs; its length is an instance setting. It ends with The System posting a public reveal of every
character's class history that season, Turns included. Who plays a character is never revealed. Each character gets a
season record, and characters carry on into the next season.

Alternatives weighed: an endless forum where Aura is only a wallet (the spec); arcs per weekly board only.

## 2. Reading a class is a crowd skill, not a score

**Decided:** nothing pays a player for guessing a class right, and nothing punishes a character for being obvious. A
class can be an open secret. An overt Heel farming love-to-hate reactions and a subtle Heel floating genuinely annoying
opinions are both real strategies, fun to play against and to think about, and both earn by drawing their class's
reactions. Knowing someone's act tells you how to play along with it, or how to grief it.

Weighed and rejected: sealed calls paid at the reveal. The owner's reason: rewarding guessers would discourage the
overt performances that are half the fun.

## 3. Turns

**Decided:** a Turn can happen mid-season. It is the game's storytelling move (the WWE parallel) and the way a player
pivots a performance that is not working. Each time, the player chooses how loud it is: silent; announced ("Pipewrench
has Turned", never to what); or announced with the old class revealed ("Pipewrench, a Heel since August, has Turned").
The cooldown is an instance setting, 30 days by default. The season reveal shows every Turn, silent ones included.

## 4. When Aura moves where others can see it

**Decided:** live for the owner, settled for everyone else. A player sees each reaction's effect on their own
characters at once in their own log (which Act, which quadrant, how much), never who reacted. What others see moves
only when The System settles, on a schedule set per instance (daily by default), as the sum since the last settlement.
In a very quiet stretch the settled number can still be read; that is accepted as part of the open secret, with no
noise added.

The owner's picture of it: a player tracks the meters over days and opens an Among Us-style "X is a secret Heel"
thread, and X answers with a silent Turn that turns every grief attempt into Aura.

## 5. Reactions

**Decided**, from the owner's proposal:
- **The display cap:** at most three distinct reactions per player per Act, counted across all of that player's
  characters, as Minus World capped them. Without it, every post's reactions become a list of every reaction there
  is, not a heatmap of how the crowd responded; with it, people think about what to leave.
- **Counted per player, recorded per character.** Switching characters to react becomes a choice of voice for the
  story, never a way to multiply points. Who reacted is recorded per character and hidden by default.
- **A player's characters cannot react to each other.** The server refuses it; only the player who tried sees the
  refusal, and they already know who owns what.
- **The shared vote:** a player's reactions on one Act share one vote. One reaction carries the whole vote; three
  carry a third each.
- **Halving across posts:** within a settlement window, a player's vote on a character's first Act counts in full, and
  each further Act by the same character counts half as much as the one before.

Noted for later: where reactors are ever revealed (a ward, a postcard), a pattern can link two characters (they never
repeat an emoji on one post and never total more than three between them); the session that designs reveals weighs
it. Changing or removing a reaction is a new Act, never an edit, and it bears on the Lurker's timing.

## 6. Classes are playstyles

**Decided:** a class is a playstyle, a real way people take part in a forum. A player picks the class that fits how
they already engage, or takes one on as a challenge. New seasons may add new classes as new playstyles and advanced
methods become known, so the design has no fixed number of classes. Face, Heel and Lurker are the core; the fourth
class is the **Jabroni** (slang for a jobber, the wrestler whose job is to lose, and a general word for a
knucklehead): anti-comedy, posts built to bomb, whose win is the groan.

In the engine, a class is an instance plugin: rules that read what a character did and received in a settlement
window and return its Aura. A class's rules read **only Acts**, things anyone could see happen: posts, reactions given
and received (their quadrant and timing, never who gave them), threads spun, Turns and postcards. Nothing tracks
reading time or page views, so what earns Aura is always something others can watch a character do, and every class
stays readable.

Weighed and rejected: a balanced wheel of one favored and one hostile quadrant per class (it allows exactly four
classes, ever); reading-time signals for the Lurker.

| Class | Earns from | Weakness |
|---|---|---|
| **Face** | Excited-positive reactions on its own posts and cards; Sweet cards it plays on others' posts when that post then draws excited-positive reactions | Bored-negative reactions on its Acts; its card outdrawing the post it landed on (stealing thunder is unbecoming) |
| **Heel** | Excited-negative reactions (heat) on its own posts and cards; a Salty card that outdraws the post it landed on | Calm-positive reactions (polite shrugs) on its Acts |
| **Lurker** | Reacting early in the direction a post's reactions end up; threads it spins from others' Acts that draw replies; reactions to cards it plays | Posting beyond a few posts per window; cards and reactions never count as posting |
| **Jabroni** | Bored-negative reactions (the groan) on its own posts and cards; Salty cards landing on its posts (selling the L) | Excited-positive reactions (being taken sincerely) on its Acts |

Reactions to a card count for the card's player under their class's rules, which is how stealing thunder lands
differently for each class with no special rule. Balance is judged by play: each settlement records what each class
earned, and the season review reads it.

## 7. Postcards are in the first slice

**Decided:** postcards are as fundamental as reactions. "A post is a move; a postcard is a riposte or a hype-up, a way
to either enhance or defuse somebody else's attempt at clarity." Playing one is an Act of its own, posted in the
thread and open to reactions, so a sharp card can steal a post's thunder. Postcards are also one of the Lurker's few
ways to act without posting. Divided World keeps Minus World's alignments, Sweet (enhances), Salty (defuses) and
Pepperoni (depends on context), and a class's rules can read them.

Minus World's spellbooks are in `docs/research/minus-world/`. The aim is to bring back its greatest hits over time, at
various rarities, and to go beyond it. The owner's standing wish: WebGL effects, an anachronistic 3D warp of a plain
2003 page.

A Minus World mechanic weighed: "you absorbed half the EXP" when a Salty or Pepperoni spell landed on you. As a
universal rule it would tax the Heel for playing the cards a Heel should play; Minus World had no classes. It is a
class trick instead, already in the Jabroni's kit.

**The first slice's two cards:**

- **Stick Around (Sweet).** Once the post scrolls into view, the reader is held: each time a scroll ends anywhere
  else, the page smoothly scrolls back to the post, as Minus World built it. The reader is released by a checkbox in
  the caster's own words (by default "I legally certify that I have read this post in full and thought about it
  contemplatively"), remembered on the reader's own device and never on the server, or by scrolling vigorously enough
  to break through. Weighed and rejected: release by reacting, which would fill the post's reactions with coerced ones
  and buy Aura for its author.
- **Whoops! (Salty).** The caster chooses the ink's color and splats a post. Any reader can scrub the ink to read
  underneath, but only on their own screen; a refresh brings back the saved state. Only the post's author's strokes are
  saved, so the author can wash the post clean or write back in the ink (keep the thunder, make lemonade), and
  everyone loads into the author's version. Strokes are stored as paths so handwriting stays legible. Every reader can
  always read the post, so the splat needs no expiry. The keyboard and screen-reader path is a scrub control timed like
  a scrub, never a shortcut.

## 8. Where Aura lives

**Decided:** a private wallet per player, and a public season standing per character.
- The **wallet** is a player's hand: their spendable Aura and their cards, seen only by them, shown as the TTYD orbs in
  their own header. All of their characters earn into it and spend from it, so a veteran can play a planned strategy
  on a brand-new character, and cards need no owner but the player.
- Each character's **standing** is the Aura it has earned this season, settled on The System's schedule. It cannot be
  spent; it resets each season into the season record. Accusation threads keep their evidence.
- The wallet **caps at six orbs**; Aura earned past the cap leaves the wallet (the standing keeps it). Nobody is at the
  mercy of someone sitting on years of banked fake money.
- Income growing with the number of characters a player runs is accepted and watched in the season review.

Weighed: Aura per character, with cards per character (the spec's per-account cards would have moved Aura between
masks and linked them); fully private Aura with only cosmetic standing; an uncapped wallet.

## 9. Accessibility in a game

**Decided, and added to CLAUDE.md** as "An accessible path costs what the obstacle costs": the forum itself is fully
accessible, and a game obstacle's accessible path gives every player the same challenge, never a way around it. The
owner's words are in the rule's record.

## 10. The starting economy

Every number is an instance setting, a starting point that the season review replaces with what the cast does. Aura
is stored in hundredths of an orb.

| Setting | Start at |
|---|---|
| Wallet cap | 6.00 orbs |
| Settlement | daily |
| One whole vote on a class's favored or hostile reactions | ±0.10 orb |
| A further Act by the same character in a window | half the vote before it |
| Lurker: an early reaction (among the first three players to react) that matches where the post ends up | +0.10 |
| Lurker: a spun thread that draws replies from three or more other players | +0.20 |
| Lurker: each post beyond three in a window | −0.10 |
| Heel: a Salty card that outdraws its target post | +0.20 |
| Face: its card outdraws its target post | −0.20 |
| Jabroni: a Salty card lands on its post | +0.20 |
| Stick Around | 1.00 orb |
| Whoops! | 1.00 to buy, plus 0.25 per 500 characters of the target when played, at most 3.00 in all |
| Reaction cap | 3 per player per Act |
| Characters per player | 6 |
| Season | 3 months; 3 weeks for the playtest |
| Turn cooldown | 30 days; 7 for the playtest |

Whoops!'s price in the table depends on the post it is played on, so it is split: the Vending Machine sells the card
at its base price, and playing it on a long post costs the rest from the wallet at that moment.

## 11. What the slice holds

**In:** accounts and characters (up to the cap, with a quick swap); one ordinary board; threads and posts in BBCode
with whole-post quoting; spinning a thread from any Act; reactions with the cap and the shared vote; the four classes
and Turns; the wallet, the standing and each player's own log; the Vending Machine's fixed-price slots; Stick Around
and Whoops!; the daily settlement; one season ending in the reveal thread; live updates. The System in this slice is
plain code on a schedule, with no model calls. Registration is invite-only for the playtest, since the real
moderation tools are not in this slice.

**Waits:** Autocorrect (the next card: Minus World's signature, and a Pepperoni test of the class rules); the gacha;
Mod Bots and appeals; the weekly boards and the Director; the Pound; wards; highlight-to-quote; presence (who is
reading a thread), which would show one character leaving and another arriving at the instant of a quick swap and
needs its own design against "A response never varies with a private fact".

## 12. Where the rules run, and what comes next

**Decided:** invariants in SQL; judgment in TypeScript. Class and card rules are pure TypeScript in the instance's
layer; the browser runs them to preview, and an Edge Function runs them to decide and then calls one SQL function per
action, which re-checks every invariant and writes in one transaction. Acts are never edited, the reaction cap holds,
the wallet stays between zero and six orbs, a player's characters never react to each other, and the private columns
(who owns a character, its class, who reacted) never leave the database, whatever an instance's TypeScript does. The
settlement is a scheduled Edge Function using the same class rules. Live updates carry only what the server has
already made public. Weighed: everything in SQL; everything in Edge Functions.

The screens and the card effects are a second design session, after this one: it installs impeccable, briefed first on
the 2003 house style, mocks each screen with the owner, and works from the owner's prototypes of Whoops! and the TTYD
bar. The engine's build does not wait for it.

## Open

- Wards: how one is earned and placed, and the reveal fingerprint in section 5.
- Changing or removing a reaction, and the Lurker's "early" with it.
- Season standing's look on the postbit, and levels and trophies beside it (the screens session).
- How the season review reads per-class and per-player earnings, and who sees it.
