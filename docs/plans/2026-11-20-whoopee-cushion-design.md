Record, written 2026-11-20.

# Whoopee Cushion: design

A design session with the owner for Whoopee Cushion, the Base Set's first Pepperoni Reversal and one of its two common
Reversals (`docs/plans/2026-11-14-base-set-design.md`, wave 3). Its row (rarity, price, words) was already settled by
`docs/plans/2026-11-15-base-set-card-numbers-design.md` (section 3, "Whoopee Cushion"), and its art is already rendered
(`instances/divided-world/ui/cards/whoopee-cushion/`). This session settles what the engine needs for it. Its plan is
`docs/plans/2026-11-20-whoopee-cushion-plan.md`. Read on `main` at `f47ef9c`.

## 1. The card

**Whoopee Cushion** (Pepperoni, common, 1.00, Reversal set face down on one's own post). It springs on the first
common card cast on that post, whatever its flavor. The cast lands as usual and its caster keeps everything it earns.
From then on, each vote the cast draws, in any quadrant, pays the setter a quarter of a vote. Votes by the setter's own
player pay nothing. It springs once, or comes back to the setter's hand when the set time ends. Once sprung, it pays
for as long as the cast draws votes, as 4D Chess does.

- Tagline: "Get paid when a common card lands." Summary: "Set face down on your post. The first common cast there
  lands, and every reaction to it pays you a quarter of a vote." Status: every Reversal's, "Set, face down to everyone
  else". (The numbers design's words, kept.)
- No configuration and no form: it names no card and no quadrant.
- Its key, `whoopee-cushion`, falls alone in its slot of the sorted lists (between `whodunnit` and `whoops`).

## 2. What the owner decided, and what was weighed

1. **It pays on every vote, in any quadrant** (the owner's pick). Weighed: the setter names a quadrant at the set, as
   4D Chess does. That reuses the quadrant picker, but at a quarter of a vote one quadrant pays very little, and the
   pick hints at the setter's class. Also weighed: one quadrant printed on the card (groan, the fart noise). That reads
   at a glance, but it ties the card to the class that scores from that quadrant. Every vote names no class and needs
   no form, which suits a common that teaches the Reversal type.
2. **When it springs, the room sees the flip and nothing else** (the owner's pick). As with every Reversal, the card
   back on the post turns into the card it was (`engine/ui/cards/Marks.tsx`). Weighed: a one-time whoopee sound for
   readers with game sounds on, and a "pfffbt" stamp on the cast that sprang it. Each needs a new engine interface for
   one card. The face is the joke.
3. **Mod Bots are not offered it** (the owner's pick). A staff character has no wallet and its Acts are not settled,
   so a Mod Bot's cushion would spring and pay nobody. The engine stops offering a persona any set card whose trap has
   an outcome (`staffOffers`), which also covers 4D Chess if the pool ever reaches uncommon. The numbers design
   (section 2) took this for already true, citing `0086_staff_cards.sql`. That migration's rule was about the old
   payout outcome, and today's `staffOffers` would offer the card, since its configuration is `{}`. Weighed: offering
   it as a pure prank, a free gag for The System. The room would see a card that does nothing, and the log would have
   to explain why.
4. **"Every quadrant" is a flag on the outcome** (the owner's pick): `outcome: { kind: 'ride', share, every: true }`.
   Weighed: inferring it from a `match` (a ride beside a match pays everywhere, a ride that names its card pays in the
   named quadrant). That adds nothing to the shape, but it ties two unrelated things together and rules out a later
   matching ride with a quadrant.

## 3. The engine need, and why "no new engine work" did not hold

The roadmap expected Whoopee Cushion to reuse 4D Chess's pay outcome (the ride) as it stands, and left that question
to the Plays design session (`2026-11-14-base-set-design.md`, section 5). No Plays design has been written, so this
session settled it. Reading the code shows three things in the way, all small:

- **A ride beside a match is refused**, twice: `outcomeProblems` in `engine/rules/instance.ts` ("has an outcome beside
  a match; a ride outcome names its card (catches)") and `card_kinds_problem` in SQL (latest
  `supabase/migrations/0357_post_veils.sql`). The spring itself already handles the pair: `spring_facts` matches by
  `match`, and `spring_traps` writes `did: 'rode'` for any trap whose outcome is a ride.
- **A ride spring must name a quadrant.** `acts_spring_payload` (latest `0317_surfaces.sql`) requires a quadrant on
  every `rode` spring, and `decideSet` throws when a ride's checked configuration names none. `spring_traps` writes
  the quadrant from the set's configuration, so for a card with no configuration it writes none, which the constraint
  refuses today.
- **Settlement pays a ride spring only in its quadrant** (`engine/rules/settle.ts`, the ride pass). It skips a spring
  with no quadrant.

So: the TypeScript and SQL checks allow a ride beside a match; an `every` ride's spring carries no quadrant, and the
constraint allows that (a quadrant only ever on a `rode` spring, no longer required on one); settlement pays an
`every` ride on each vote the cast draws. `spring_traps` is unchanged. The words that assume a ride names its card and
a quadrant are made true for both kinds. Those are the set form's sentence (`springWords`, which says "and takes it"
for a ride, wrong for 4D Chess today), the setter's alert ("of the kind you named"), the log's spring line, the
settlement reason `card.ride`, and the caster's `trapStruck` voice (which names 4D Chess as "the only one that
rides").

This plan carries its own engine part rather than waiting for the Plays plan. The work is narrow, and it shares no
decision with the refund outcome, the lockout, Ward-piercing or ending a Gimmick.

## 4. What it does to the rest of the game

- **The masks.** The spring is computed from the cast card's rarity and the back alone, never from who cast it: a cast
  by the setter's own other mask springs it the same, as 4D Chess's does. The pay is settled, and shown only as each
  settled window's sums. Settlement leaves out votes by the setter's own player, as for every ride, and nothing live
  reads who reacted. No new response, payload, event or timing.
- **Ways out.** No state is added. The back ends by itself at the set time or springs once. The ride pays for as long
  as the cast draws votes, as 4D Chess's does, and an admin can end the play.
- **The layers.** The flag, the checks, the settlement and the words are the engine's, named for what they do, never
  for a card. The card, its face, its sheet and the `trapStruck` voice are Divided World's.
- **A busy instance.** Settlement's ride pass already walks each cast's votes once. An `every` ride reads the same
  votes and skips the quadrant test, so the cost is unchanged: it grows with the votes on sprung casts.
- **Acts an instance already holds.** The constraint only loosens, so every existing spring still passes. A 4D Chess
  spring keeps its quadrant and is paid exactly as before.

## 5. Departures from the numbers design

- **Its log line.** The numbers design wrote the setter's log as "It sprang on a {card}. Each reaction to that card
  pays you a quarter of a vote." The log's spring lines are the engine's, one sentence for every ride, with the share
  read from the card. For an `every` ride it says: "{Card} on {post} sprang when {caster} cast {move} on it. {Move}
  landed as usual, and its caster keeps what it earns. Each vote it draws pays you a quarter of a vote, in each
  settlement's lines." That is the same fact, in the engine's sentence.
- **Mod Bots** (section 2.3): the numbers design took the refusal as given; this design builds it.

## 6. Open

- **A spring sound or stamp** for Reversals in general (section 2.2) was not taken up. If one is wanted later, it
  needs its own design as an engine interface for every set card.
