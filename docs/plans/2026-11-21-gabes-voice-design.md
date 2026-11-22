# Gabe's voice: a style guide, and the Strategy Guide rewritten in it: design

Record, written 2026-11-21. A design session with the owner, started from an intro post the owner wrote as Gabe, the
developer persona. The owner asked for the post's tone to become a style guide and for the Strategy Guide's wording to
be revisited, for that tone and for what the engine has gained since the guide was written. The plan is
`docs/plans/2026-11-21-gabes-voice-plan.md`. This design's PR also rewords one rule in CLAUDE.md (section 1), which is
why it waits on the owner.

## 0. Where it starts

- The Strategy Guide (`instances/divided-world/guide/strategy-guide.md`) was written by 2026-11-14 and has had one
  paragraph added since (crowd pay, 2026-11-20). Its header still calls it a draft.
- No style guide exists. What the persona may say is spread over CLAUDE.md ("The fiction may lie; the log never
  does"), the alerts design (section 3), the onboarding design (sections 8 and 9), the board-look design (section 7)
  and the two-worlds design (section 3). None of them says how Gabe sounds.
- The owner's intro post is the first long piece in the voice. Two shorter ones were already in the repository in the
  owner's hand: the front door's note (`instances/divided-world/ui/front-door.ts`: "Uh, no?", "This is rated M. Or it
  probably would be, if the ESRB would get back to me.") and the developer's tagline ("Made this. Sorry.").
- A read of the guide against the code at `bbc9584` found sentences that are false now, features that are built and
  never mentioned, and a frame ("The System" as a voice) the owner retired on 2026-11-06. The findings are section 6.

## 1. What Gabe may make up (#904)

CLAUDE.md said the developer persona is "always true" and that the glass's copy "never bluffs". The intro post is a
tall tale: Gabe sold Minus World's RAM to pay for a yacht, shelved Half-Life: Nuts & Bolts, staffed the forum with
Personality Cores left over from an escape room, and guarantees that nothing will go wrong. Read to the letter the
rule forbade the post. The session filed #904 and asked.

**Decided (the owner, A):** tall tales about himself and about where the game came from are free, because no player
could take them for the game's rules. Whatever he says about how the game works, what is switched on, and what was done
to a player's characters is always true. He may be wrong about the future of his own decisions and never about how a
mechanic works today. The owner: "You've got it right. Gabe is facetiously optimistic that this will be the final and
only boss, and he will claim the same every time a new one takes over."

So two lines of the post that sit on the edge stand as written: FanGaME as the "permanent" Boss, while the code holds
a succession, and "nothing will go horribly wrong", which the season's arc is written to break. Both are Gabe's
optimism about his own decisions, and the running gag is a rule of the voice: every Boss is the final and only one.

CLAUDE.md's rule is reworded in this PR, and its record gains the owner's words.

Weighed: **B**, tall tales on the Updates page and the welcome letter only, with the guide and tips literal (simpler
to check, and the guide loses the tone the owner asked to carry into it); **C**, the rule kept and the post softened
to exaggerations of true things (it removes the joke).

## 2. Where the style guide lives

**Decided (the owner, A):** the style guide is a current document in the instance,
`instances/divided-world/voice/gabe.md`, beside the copy it governs, so it leaves with Divided World when the engine
moves to a repository of its own. A thin skill, `.claude/skills/gabes-voice/SKILL.md`, tells any session that writes
words the persona speaks (the guide, the welcome letter, tips, hints, the front door's note, a drafted Updates post) to
read it first. The owner's post is kept in the style guide whole, as its reference sample. It is written for two
readers: a session drafting copy, and the owner or another admin writing an Updates post by hand.

Weighed: **B**, a skill alone (it sits with the repository's working machinery and is left behind at the split);
**C**, a document alone (a build session adding one paragraph for a new card has no reason to open it; the crowd pay
paragraph of 2026-11-20 is accurate and not in the voice).

The layers: the style guide is instance content. The engine never reads it, and nothing in it is checked by a build
step; what the build can hold about the guide is section 5's.

## 3. Where the intro post appears

The post does two jobs. It tells the origin story, which is true for every newcomer for good, and it introduces
FanGaME as Boss, which is true until the next Boss.

**Decided (the owner, A):** it is split along that line. The origin story, through "they will live on in our hats.
Uh, I mean hearts.", becomes the **welcome letter** (`onboarding.letter`), replacing "After nine years of
development". The FanGaME half becomes the **first Updates post**, which the owner publishes from the admin screen at
launch; each later Boss gets an Updates post of his own from Gabe. The old letter's practical lines (several masks,
secret classes, nobody sees which are yours) move into the guide's second section. The sign-off is on both halves.

The Updates post is written in the running instance by an admin, as the rule requires, so nothing is seeded and
nothing is built for it. The style guide holds its text ready to paste.

Weighed: **B**, the whole post as the welcome letter (it names FanGaME and is edited in the repository at every
succession); **C**, the whole post as the first Updates post (a player who joins later scrolls back to find the
premise of the place).

## 4. The dial: how much Gabe is in a paragraph

The owner was shown the wallet's paragraph at three settings with the same facts in each.

**Decided (the owner, 2):** "Gabe explains it" is the guide's default. First person throughout, and the jokes are
made out of the facts, so cutting a joke would cut a fact. The sample the owner approved:

> Aura is the score and also the money, which I'm told is how the real economy works too. We count it in **orbs**. Your
> **wallet** is shared by all of your characters, and no other player can see inside it. It holds
> {{setting:walletCap}} orbs. Anything that would land past that is gone. I didn't take it. It just stops existing,
> which my lawyers say is different.

Two fixed exceptions:

- **Reference passages are setting 1**, plain with at most a joke at the end: the phrase-matching rules and the
  condition lists, which a player comes back to look up.
- **Real moderation is setting 0**, no persona at all: the code of conduct, reports to admins, the account and a
  player's data, as CLAUDE.md already requires.

Setting 3, a tall tale before the rules, is how the welcome letter and Updates posts read, and stays there. In the
guide it puts a paragraph between a player and the rule they came for.

## 5. The guide follows the switch

The Boss, Mod Bots, rules, the warn bar, reports, appeals and staff group moves are built and gated by
`systemEnabled`, false today. `tools/check-guide.mjs` ties one line of the guide to the switch ("Built, and not
switched on here yet:", the plain-words design, sections 6 and 7), so the guide as it stands fails the build when the
launch flips the switch, and a launch session would write the staff sections then.

**Decided (the owner, A):** the guide holds both, and the switch picks. The engine's guide reader gains a pair of
markers, each alone on its line, closed by a third:

```
<!-- kayfabb:if system-on -->
...shown only while systemEnabled is true...
<!-- kayfabb:end -->

<!-- kayfabb:if system-off -->
...shown only while systemEnabled is false...
<!-- kayfabb:end -->
```

The staff sections are written in full now for the game with a Boss, and a short passage says what is built and not
on until then. Nothing is rewritten at launch, and the guide is true for any instance that runs with the staff off,
which the engine allows for good ("Portable by construction").

What this needs, all engine:

- **The page learns the switch.** `screen_settings` does not carry `systemEnabled`; it gains it. It is one of the
  instance's settings, the same for every reader, and is computed from no private fact.
- **The reader.** `parse` returns a `when` block holding the blocks between the markers. The page draws a `when` block
  only when its condition matches the live setting, and draws neither while the settings have not loaded.
- **A conditional never holds a section.** A second-level heading inside a conditional is refused by the check, so
  the guide's sections, its contents list and every `#fragment` are the same whichever way the switch is.
- **The check reads both branches.** Markers, settings, links and retyped numbers are checked inside a conditional as
  outside it. It refuses an `if` with a condition it does not know, an `if` inside an `if`, an `if` never closed, an
  `end` with no `if`, and a second-level heading inside one.
- **The exact-string rule is retired.** The check no longer looks for "Built, and not switched on here yet:"; what it
  held by a string is now held by structure. In its place the check refuses a guide that says the staff are switched
  off outside a `system-off` block: the words "not switched on" may stand only inside one. That is the same kind of
  net the retyped-number check is, for the same slip (a sentence that is true today and false after the launch).

Also falling out of the new guide: the season's length is not a number the guide can print. `seasonLength` joins
`screen_settings` and the reader's table of sayable settings, as a span.

The discipline cards (Happy Heart and its two bigger sizes, Take the Fall, Tattle-Tale, Hall Pass) are in packs and
describe warn bars and Mod Bot visits. The `system-off` passage says plainly that they have nothing to act on yet.

Weighed: **B**, write for today and let the launch rewrite it (no engine change, and the sections that carry the most
tone are written later by another session); **C**, write for the launch only and merge with it (an instance with the
staff off has a guide that is false).

## 6. The guide's shape, and what the read found

**Decided (the owner, A):** one guide, reordered around what a newcomer meets first.

| # | Section | What changes |
|---|---|---|
| 1 | Welcome letter | The owner's origin story |
| 2 | The metagame | Takes the old letter's practical lines: masks, secret classes, Acts, the HUD, the board and the glass |
| 3 | Your first character | New. No Aura and one sealed Starter Pack; pronouns; drop now or debut; silent, announced, announced with class |
| 4 | Reactions | Adds the grace before a reaction is sent |
| 5 | Aura | Wallet, standing, crowd pay, the settlement, the forecast, the log |
| 6 | Seasons | New. What a season is, Rankings, ranks, trophies |
| 7 | Classes | Same shape; the hints read against the voice and kept |
| 8 | Turns and reveals | An announced Turn is the character's own Promo; all three ways a class becomes public |
| 9 | Cards | Getting them (the Starter Pack, the Booster, what the Vending Machine sells and why most cards say "Not on sale"), then playing them. Face-down conditions and phrase matching stay, as plain reference |
| 10 | The masks | One line on cards that hide an author or a tally for a while |
| 11 | The staff | Replaces "The System". The Boss, the Mod Bots, groups, punishments and their ways out. Follows the switch |
| 12 | Things that happen to you | New. Alerts, Random Events, gear and the Wardrobe |
| 13 | The actual rules | New, and plain. The code of conduct, reporting a real problem to an admin, invites, contact |
| 14 | Coming attractions | Only what is not built |

Weighed: **B**, two tiers, a one-screen "Start here" and the rest as reference (a second guide page in the engine,
and most of the voice in the part fewer people read); **C**, today's sections patched (packs, seasons and the staff
squeezed into sections written before they existed).

**False in the guide today**, each fixed by the rewrite:

- "The System" as a voice, in five places. The owner decided on 2026-11-06 (the board-look design, section 7) that a
  player never reads that name: the copy says "the Boss", "the staff" and "the game".
- An announced Turn is the character's own Promo in the season's Promos thread, not a post by The System
  (`engine/ui/characters/footers.ts`).
- A class also becomes public when a new character is announced with its class.
- Nine Moves can never be set face down (`faceUpOnly`, `engine/rules/cards.ts`), so "a back might be any Move" is
  wrong.
- THIS has a fixed phrase as Autocorrect has.
- Only the Booster and the commons are on sale (`instances/divided-world/machine.ts`), so the card table prints "Not
  on sale" on most cards with no word of why.
- The Groups section speaks of staff moves as live; they are gated by the switch.
- "A plus after a price" is said of long posts only; three cards price their extra another way.

**Built, and the guide is silent:** the Starter Pack and the Booster; the reaction grace; what a season is, with
Rankings, ranks and trophies; Alerts; Random Events, gear and the Wardrobe; pronouns; cards that hide a post's author
or its tallies for a while; invites; the code of conduct and real reports to admins.

**Designed and not built, so left out:** polls, forged quotes, post layers, card retirement, spent marks, Cheap Shot,
Whoopee Cushion, Kick Me, Pay It Forward, the class balance change (its own plan adds its sentence when it is built).

**Held from the onboarding design, section 8:** surface only. No arithmetic, no counter-play, no list of tells, no
phase names, nothing a player is meant to find and trade in threads.

**Also in the wording pass:** the class hints (`guide/hints.ts`), which were read against the voice and are kept as
they are; the onboarding tips (`ui/onboarding.ts`), three of which change; and the front door's note, which says
"appease the almighty Administrator" where the post and the copy say "Boss".

**Not in it:** the Random Events' lines (`instances/divided-world/events.ts`) are the owner's own and are a different
register, a private aside and not Gabe explaining; they are left as written. Menu descriptions and the engine's own
glass copy are the engine's and say nothing in the persona.

## 7. The voice

Read from the post and confirmed by the owner in the session. The style guide's full text is in the plan.

**Who he is.** A rich man who did something selfish, is half sorry, and fixes it by delegating. He takes credit for
the idea and none of the blame ("through no fault of my own"). He is cheerful and unbothered; nothing is urgent to a
man with a yacht. He believes his own bad ideas completely.

**How he writes.** Short, flat declaratives, with the joke in the last few words, often as a fragment ("Hobos without
yachts."). He admits the damning thing plainly and moves on ("I can't lie to you."). He undercuts his own product
("half as good"). He corrects himself into the truth ("in our hats. Uh, I mean hearts."). His reassurance reassures
nobody. He says "I", calls his staff "the fellas at the lab", says "you" to the reader, and signs "Gabe". His
references are his own world (Valve, hats, sequels that never ship, Portal's cores) and the community's (Minus World,
fangames).

**What he never does.** Bluff about a mechanic. Mock a player, a character in play or a member of the community: the
joke is on Gabe, his staff or the game. Speak for the Boss or a Mod Bot, or explain their jokes. Hype with exclamation
marks, except when he is selling a bad idea ("A.I.!"). He is dry, never mean and never wacky.

**Real people (the owner, A).** Public figures in tech and games may appear as props in a tall tale; the post names
Sam Altman. Nobody from the community, past or present, is named or alluded to in Gabe's voice: a jab from the game's
own narrator at someone the players know reads as the game taking a side. A session never introduces a new real name;
it uses the ones the owner has written, and a new one is the owner's to add. Weighed: only Gabe (it costs the post its
line); no rule.

## 8. The layers

- **Engine:** the conditional markers in the guide's reader and page, `systemEnabled` and `seasonLength` in
  `screen_settings` and `ScreenSettings`, and the check with its self-test. The condition's names (`system-on`,
  `system-off`) are the engine's words for its own switch; no instance is named.
- **Instance (Divided World):** the style guide, the Strategy Guide, the letter, the tips, the hints and the front
  door's note. They reach the engine by the interfaces that carry them today (`InstanceUi.guide`,
  `InstanceUi.onboarding`, `InstanceUi.frontDoor`); none is added.
- **The repository's skills:** the pointer skill.

## 9. The masks

- `systemEnabled` and `seasonLength` in `screen_settings` are the instance's settings, the same for every reader.
- The guide is committed prose, the same for every reader, and the conditional is picked by a setting. Nothing a page
  draws from it is computed from who is reading.
- The new wording says what is private in the words the guide already holds to: "no other player" can see a wallet, a
  class, who reacted or which masks are whose. It never says "nobody", since an admin can.
- The crowd pay passage keeps its statement that the pay is the same whichever reaction and whichever character.

## 10. Ways out

This design adds no state a player, a character or a post can be put in. The staff section names the way out of each
state it describes (a punishment group, a ban from a board, a full warn bar), as the screens that show them do, and
its claims are checked against the code before the words are committed (the plan, Task 6).

## 11. At a busy instance

The guide is one static document per instance, parsed once per page. A conditional adds no query: the switch arrives
with the settings the page already loads. Nothing here grows with players, characters or Acts.

## Open

- **The wallet's cap.** The guide has said since the first draft that Aura past the cap is gone, and the session did
  not trace the SQL. The plan's Task 6 checks it, and stops if it is not so.
- **Gabe's note on the front door** was written by the owner, and "almighty Administrator" may be deliberate. The
  plan changes it to "Boss" to match the post; the owner can strike that line in review.
- **The Tweener's hint** ("Say the thing half the room will hate.") predates the catalyst change. The plan's wording
  keeps it as true of the class and adds nothing of the new mechanic, which is for players to find. If the owner would
  rather it point at the new way of playing, that is one line.
- **The front door's note says the Boss and the Mod Bots are in play** while they are switched off, and the front
  door has no conditional. Under the reworded rule that is a claim about what is switched on. It becomes true at
  launch. Whether the front door should follow the switch as the guide now does is the owner's to say; this plan
  changes one word of the note and nothing else.
- **An Updates post for each new Boss** is the owner's to write when it happens. The style guide gives the pattern;
  nothing reminds an admin to write one. Whether the succession should prompt an admin is a separate question.
