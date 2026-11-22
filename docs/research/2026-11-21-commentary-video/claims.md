# The commentary video's claims, checked against the code

Record, written 2026-11-21. Task 9 of `docs/plans/2026-11-21-commentary-video-plan.md`: every sentence of the script as the film
says it (`instances/divided-world/ui/hype/commentary.ts`, which follows `docs/plans/2026-11-21-commentary-video-design.md`, section 4),
classified, and each sentence a player could act on checked against this checkout. Line numbers are of the checkout this was written
on; the script was not edited.

The rule the check is made under is the owner's answer on #904 (design, section 3): tall tales about Gabe, the playtesters, where the
game came from and his own decisions are free; whatever he says about how the game works is true (CLAUDE.md, "The fiction may lie; the
log never does"). The three kinds:

- **Claim**: a player could act on it. The code that makes it true, why, and a verdict: `true`, `false` or `true with a caveat`.
- **Tall tale**: about Gabe, the playtesters, the game's origin or his decisions. No check.
- **Film**: about the film itself (the commentary nodes, "I'm clicking it"). The game has no commentary nodes, so no player could
  take it for a rule. No check.

## Result

Claims checked: 17 entries (a sentence that holds two claims is two entries). **True: 10. True with a caveat: 7. False: 0.**

The seven caveats, each in full in the tables below:

- n02-13, "he made money": the pay is Aura, in the wallet, and comes at the daily settlement.
- n03-20, "you can't know what's waiting": the setter does, and that a back exists, who set it and when it ends are public.
- n05-29, "being caught can be the plan": 4D Chess rides and does not catch; the plan needs the catcher to throw the card back.
- n06-32, "set to go off when somebody says a phrase": the somebody must quote the setter's post.
- n09-46, "This is GPT-2": the owner's word is the evidence; the card says 2021 and the words on screen are made up.
- n10-49, "That's the moderator": a Boss is not a Mod Bot.
- n10-51, "he's merging the boards": a merge waits about a day for the admins and the film lands it at once.

## The script, one entry per sentence

Entry ids are node and sentence. Where a sentence holds two claims, they are lettered.

### Node 1 (the welcome)

| Id | Sentence | Kind | Note |
| --- | --- | --- | --- |
| n01-1 | Hi, my name is Gabe, and welcome to Divided World. | Tall tale | Gabe is the instance's developer persona. |
| n01-2 | After nine years in development, hopefully it will have been worth the wait. | Tall tale | The game's origin. |
| n01-3 | The last forum ran on code I wrote when I was twenty, and it's not easy to open that up and wonder what you were thinking. | Tall tale | About himself, by the owner's wish (design, section 8). |
| n01-4 | This is, I think, better. | Tall tale | An opinion. |
| n01-5 | To listen to a commentary node, put your cursor over the floating commentary symbol and click. | Film | The game has no commentary nodes. |
| n01-6 | To stop a commentary node, click it again. | Film | Same. |
| n01-7 | Some commentary nodes may take control of the forum in order to show something to you. | Film | Same; the takes are filmed frame by frame, the game never scrolls itself. |
| n01-8 | In these cases, simply click again to stop the commentary. | Film | Same. |

### Node 2 (the class)

| Id | Sentence | Kind | Verdict and code |
| --- | --- | --- | --- |
| n02-9 | Early playtests showed that people on a forum want to be liked. | Tall tale | |
| n02-10 | We considered this a design problem. | Tall tale | |
| n02-11a | So every character has a secret class, | Claim | **True.** `supabase/migrations/0001_core.sql:92` makes `class_history` hold a `class_key not null` for each character a player makes (the creation paths insert it, last at `supabase/migrations/0067_debut_now.sql:33`), and `0001_core.sql:297-299` lets only the character's owner read it (`class_history` is granted by column and policy `own`, `0001_core.sql:295`). The table's comment says private until the season's reveal (`0001_core.sql:91`). A player may make their own class public by a reveal or a Turn announcement (CLAUDE.md, "A response never proves a private fact"). A staff character has no class (`supabase/migrations/0043_staff.sql:8`); the film's characters are players'. |
| n02-11b | and some classes are paid for being disliked. | Claim | **True.** The Heel is paid per excited-negative vote (`instances/divided-world/classes/heel.ts:14`), the Jabroni per bored-negative vote (`instances/divided-world/classes/jabroni.ts:15`), and the Tweener on the smaller of its hype and heat (`instances/divided-world/classes/tweener.ts:2-4`). `perVote` pays `settings.vote` per vote of a quadrant (`instances/divided-world/classes/shared.ts:8-12`). |
| n02-12 | This one is a Heel. | Claim | **True** of the film's cast: D-Guy is a Heel (`instances/divided-world/ui/hype/stage-world.ts:10`), and the Heel is one of the instance's classes (`instances/divided-world/classes/index.ts:14`). |
| n02-13 | Playtesters threw tomatoes at him and he made money. | Claim, framed as a tall tale | **True with a caveat.** A tomato is an excited-negative reaction (`instances/divided-world/reactions.ts:14`), and the Heel earns `heel.drewHeat` for each (`heel.ts:14`). The caveat: the pay is Aura in the player's wallet, which buys cards, so "money" is loose; and it is paid by the daily settlement (`instances/divided-world/settings.ts:28`, 08:17 UTC), not at the throw. Before then it is only a forecast. The playtesters are the tall tale. |
| n02-14 | We then found they could hurt him by agreeing with him, politely. | Claim, framed as a tall tale | **True.** A calm-positive reaction costs the Heel one vote (`heel.ts:18`, `heel.shrugged`), and a thumbs up, folded hands, salute or light bulb is calm-positive (`reactions.ts:18-21`). The comment on `heel.ts:2-3` calls this its weakness, "the polite shrug". |
| n02-15 | We didn't design that. | Tall tale | The game's origin. Note for the owner: `heel.ts:2-4` says the weakness is designed (design, section 6), so the line is false as history and free by the ruling. |
| n02-16 | We kept it. | Tall tale | |

### Node 3 (the gate)

| Id | Sentence | Kind | Verdict and code |
| --- | --- | --- | --- |
| n03-17 | Sometimes we need to stop a player from doing something. | Tall tale | |
| n03-18 | In our other games we use what we call a gate. | Tall tale | |
| n03-19 | Here, the gate is another player. | Claim | **True.** A card another player sets face down on their own post can stop your cast there: Rope Break catches the first Salty common cast on its post (`instances/divided-world/cards/rope-break.ts:17`), and the cast does nothing (`supabase/migrations/0370_caught_casts_never_end.sql:2`; it lands nothing, `supabase/migrations/0374_cards_on_a_spun_thread.sql:458`). |
| n03-20 | Every card back looks the same, so you can't know what's waiting on a post. | Claim | **True with a caveat.** One back for every card: `CARD_BACK` (`engine/ui/cards/plays.ts:27-30`), drawn alike to every reader. Which card it is lives in `face_down`, read by the setter's account alone (`supabase/migrations/0054_card_plays.sql:6-8`, policy at `:267-269`), and a set Act's payload is `{}` (`0054_card_plays.sql:137`). The caveats: the setter does know, and sees their own card on the Lens (`engine/ui/cards/backs.test.tsx:2-4`, the test file's header; the Lens says who set a back and when it ends, `engine/ui/cards/Lens.tsx:219-221`); and that a back exists, who set it and when it ends are public. "You can't know" holds for a reader who is not the setter. |
| n03-21 | Playtesters described this as unfair. | Tall tale | |
| n03-22 | We agree. | Tall tale | |

### Node 4 (the vibes)

| Id | Sentence | Kind |
| --- | --- | --- |
| n04-23 | I understand there may be some concerns that vibe coding was used on this project. | Tall tale (the project's origin; the owner's words) |
| n04-24 | I want to assure you that all vibes were completely negative, | Tall tale |
| n04-25 | and that the requisite amount of human suffering for a project to count as art was achieved. | Tall tale |
| n04-26 | In fact, it was exceeded, and I personally saw to it that that was the case. | Tall tale |

### Node 5 (the read)

| Id | Sentence | Kind | Verdict and code |
| --- | --- | --- | --- |
| n05-27 | This is a training arc. | Tall tale | |
| n05-28 | The player learns that a card can be caught, | Claim | **True.** `spring_traps` marks a cast `caught` when a back's named card or its match meets the incoming card (`supabase/migrations/0357_post_veils.sql:944`; `did` is `caught` at `:1003`), and the caught card is written to the setter's own ledger as one more card in their hand (`0357_post_veils.sql:1028-1029`). Rope Break's match is a Salty card up to common (`rope-break.ts:17`); Whoops! is a Salty common (`instances/divided-world/cards/whoops.ts:40-41`). |
| n05-29 | and then learns that being caught can be the plan. | Claim | **True with a caveat.** 4D Chess does not catch; it rides: its trap outcome is a `ride` (`instances/divided-world/cards/4d-chess.ts:24`), the named Move lands (`0357_post_veils.sql:1003`, `did` is `rode`), and the setter is paid one whole vote for each vote that card draws in the quadrant the set named (`engine/rules/settle.ts:809-825`, the own-player rule at `:825`). So the line holds only in the sense the film films: a player baits a catch, the catcher holds the card, and if the catcher throws it onto the baiter's 4D Chess post naming that card, the baiter is paid on the votes it draws. That needs the catcher to throw it back, and the pay comes at the settlement, in the named quadrant, from other players' votes. The line does not say 4D Chess catches, and it does not need to. |
| n05-30 | We found that about one playtester in five understood this. | Tall tale | |
| n05-31 | He won everything, and we couldn't work out who he was. | Tall tale | |

### Node 6 (the phrase trap)

| Id | Sentence | Kind | Verdict and code |
| --- | --- | --- | --- |
| n06-32 | A card can be set to go off when somebody says a particular phrase. | Claim | **True with a caveat.** A Move may be set face down on the setter's own post with a `says` phrase (`engine/rules/cards.ts:625-628`, validated at `:685-688`); the back springs on a quote of that post whose words hold the phrase (`supabase/migrations/0357_post_veils.sql:953`, the decision at `:988-990`), and the Move lands on the quoting post. The caveats the sentence glosses: the "somebody" must quote the setter's post, a phrase said anywhere else springs nothing; a post holds one card face down (`engine/rules/cards.ts:656`); and it is a Move, so it is a card that lands from a quote, not a cast (design, "Why these plays"). |
| n06-33 | This trains players to choose their words carefully, | Tall tale | An opinion about an effect. |
| n06-34 | which, on a forum, we think is new. | Tall tale | |

### Node 7 (the mask)

| Id | Sentence | Kind | Verdict and code |
| --- | --- | --- | --- |
| n07-35a | Each player has several characters, | Claim | **True.** `charactersPerPlayer: 6` (`instances/divided-world/settings.ts:26`), held by the insert trigger (`supabase/migrations/0043_staff.sql:31-45`, the last definition of it). |
| n07-35b | and no other player can see which are theirs. | Claim | **True.** `characters_public` has no owner column (`supabase/migrations/0357_post_veils.sql:65-70`, the last definition), and a character's row is readable by its owner alone (`supabase/migrations/0001_core.sql:297`). Players may still work it out from the clues play leaves, which the game does not hide (CLAUDE.md, "A response never proves a private fact"); the sentence says "see", and no screen shows it. |
| n07-36 | So the argument you've been watching is, I think, mostly, one person. | Tall tale about the film's cast | D-Guy and Chadluminum are one made-up player (`stage-world.ts:8-10`). No mechanic is stated. |
| n07-37 | That's, um. | Film | |
| n07-38 | There seem to be more nodes than we shipped. | Film | |

### Node 8 (the node takes control)

| Id | Sentence | Kind |
| --- | --- | --- |
| n08-39 | Some commentary nodes may take control of the forum in order to show something to you. | Film |
| n08-40 | In these cases, simply click again to stop the— | Film |
| n08-41 | I'm clicking it. | Film |

### Node 9 (everything, on one post)

| Id | Sentence | Kind | Verdict and code |
| --- | --- | --- | --- |
| n09-42 | So the, the way we think about this is, | Tall tale | |
| n09-43 | any time you do something new there's a normal distribution of pain, | Tall tale | |
| n09-44 | and this is— that's a chair. | Claim (light) | **True.** Steel Chair is a Move that throws a folding chair at the post and dents it (`instances/divided-world/cards/steel-chair.ts:2-4`); up to three stack, each gone after 3 days (`steel-chair.ts:18-19`). |
| n09-45 | This is not in the middle of the curve. Okay. | Tall tale | |
| n09-46 | This is GPT-2 finishing someone's post. | Claim | **True with a caveat.** The owner stated on 2026-11-21 that the model is literally GPT-2 and the line stands; it is recorded here as given. What the repository says: the settings name the model family, "The model is GPT-2's family" with `oldVoiceTokenizer: 'gpt2'` (`instances/divided-world/settings.ts:61-62`); the README says "GPT-2 XL under llama.cpp's `llama-server` is what Divided World runs" (`README.md:200`) and that an instance may swap it (`README.md:244`); the card's own words are "a chatbot from 2021, which keeps writing after the author stops" (`instances/divided-world/ui/cards/you-were-saying/ui.ts:25`, again at `:36`). The card does continue a post after its author stops, in the chatbot's words, never the author's (`ui.ts:36`). The caveats: the repository cannot show which model the deployed server runs, so the owner's word is the evidence; GPT-2 dates from 2019 and the card says 2021 (the README calls the class of model "2019-2021", `README.md:199`), so a player comparing the card to the film sees two dates; and the words on screen in node 9 are a made-up sentence typed in by the stage (`stage-play.ts:49`), not model output. |
| n09-47 | Do we... do we have a filter on that? | Tall tale | A question. For the record, the card does have a list of texts the voice may never produce (`instances/divided-world/cards/you-were-saying/frame.ts:35-37`). |
| n09-48 | My god, there are laws about this stuff, you know. | Tall tale | |

### Node 10 (the Staff arrive)

| Id | Sentence | Kind | Verdict and code |
| --- | --- | --- | --- |
| n10-49 | That's the moderator. | Claim | **True with a caveat.** The poster on screen is FanGaME, a Boss; the Boss runs the board for the instance's staff (`instances/divided-world/system/persona.ts:22`), and moderation visits and filings are the Mod Bots' work (`persona.ts:62`). "The moderator" is loose for a Boss. No player could act on the difference, and the film shows both a Boss and a Mod Bot. |
| n10-50a | He's a Personality Core, | Claim | **True.** Staff characters carry the badge "Personality Core" (`instances/divided-world/groups.ts:13`). |
| n10-50b | we found him in a pile, | Tall tale | |
| n10-50c | he's the permanent Boss, | Tall tale | By the owner's ruling: Gabe's optimism about his own decisions. The code has a succession: "Bosses come and go" (`persona.ts:62`), a season's Boss is chosen by nomination or rotation (`engine/system/career.ts:21-27`), and a move that would land after the season ends is withdrawn when the next Boss takes the chair (`engine/system/meeting.ts:1504`). |
| n10-51 | and nothing will go— he's merging the boards. | Claim | **True with a caveat.** `mergeBoard` is a Boss move that closes a board and moves its threads into another (`engine/system/moves.ts:435-451`). It reshapes a board, so it waits in the admin queue about a day and lands unless an admin holds it (`engine/system/moves.ts:385`; `structuralHoldHours: 24`, `instances/divided-world/settings.ts:88`; CLAUDE.md, "The System acts; it never destroys what a player wrote"). The film shows it landing at once. "He's merging" is true of the move; "nothing will go" is Gabe's hope. FanGaME's own arc holds the merge back until its "consolidation" beat (`instances/divided-world/system/personas/fangame.ts:43`). |
| n10-52 | To stop a commentary node, put your cursor over— I'm doing that. | Film | |

### Node 11 (the chords)

| Id | Sentence | Kind |
| --- | --- | --- |
| n11-53 | Please let me know— | Tall tale (a request to the viewer; the fragments are cut off by the music) |
| n11-54 | —what you think— | Tall tale |
| n11-55 | —after you have had a chance— | Tall tale |

The end card (`END_CARD` in `commentary.ts`) is a joke about the film's own making, in Comic Sans: Film.

### The tally

17 claim entries: n02-11a, 11b, 12, 13, 14; n03-19, 20; n05-28, 29; n06-32; n07-35a, 35b; n09-44, 46; n10-49, 50a, 51. True (10): n02-11a, 11b,
12, 14; n03-19; n05-28; n07-35a, 35b; n09-44; n10-50a. True with a caveat (7): n02-13, n03-20, n05-29, n06-32, n09-46, n10-49, n10-51.
False (0). Every other sentence is a tall tale or about the film, unchecked by design.

## What the picture asserts beyond the words

Each of these is something a viewer could learn as a rule from what is on screen. Each with its code.

| Picture | Source in the film | Code that makes it true | Verdict |
| --- | --- | --- | --- |
| A Heel's forecast rises on excited-negative reactions and falls on a calm-positive one | n02, `tools/hype/shot-commentary-1.mjs:130-141` (tomatoes and a vomit, then a thumbs up) | `heel.ts:14` pays per excited-negative vote and `heel.ts:18` charges per calm-positive vote; the stage's forecast runs the class's own `earn` over the character's posts' tallies (`instances/divided-world/ui/hype/forecast.ts:1-14`), as the real estimate does (`engine/rules/settle.ts`, the same `earn`; CLAUDE.md, "A response never proves a private fact": the live estimate leaves out only the caller's own reactions). | **True.** The real estimate is held for `freshAfter` (`engine/ui/data/api.ts:1240`) and the film's answers at once (see departures). |
| Rope Break catches a Salty common, and the card goes to the setter | n03, n05 prep | `rope-break.ts:17`; `0357_post_veils.sql:944` (the match), `:1003` (caught), `:1028-1029` (the card to the setter's ledger). The ink does not land: a caught cast writes no landing rows (`0370_caught_casts_never_end.sql:2`, carried by `place_cast` at `supabase/migrations/0374_cards_on_a_spun_thread.sql:458`). | **True.** The take asserts the cast `caught` through the backend's own play (`stage-play.ts:100`, `cast`). |
| 4D Chess pays its setter on the named Move | n05 | `4d-chess.ts:24` (ride), `0357_post_veils.sql:1003` (`rode`), `settle.ts:809-825` (the pay: the setter's character, the named quadrant, other players' votes). | **True with a caveat.** The take asserts the spring says `rode` (`tools/hype/shot-commentary-2.mjs`, the assertion after the ink lands); the pay itself is made at the settlement and is not on screen. |
| A set Move springs on a quote whose words hold the phrase | n06 | `0357_post_veils.sql:953,988-990`; Steel Chair is a Move (`steel-chair.ts`). | **True, but the take stages the trigger.** See departures. |
| Off Day names a class in public | n09 | "You name a class, and everyone can see which" (`instances/divided-world/ui/cards/off-day/ui.ts:27`); the card's configuration is `{ class }` (`instances/divided-world/cards/off-day.ts:9-11`). Nothing reaches the target to stop it; it is a Move on a character (`off-day.ts:19-20`, `reaches: ['character']`). | **True.** The character's own class does not change, and the player is told what happened (`ui.ts:27`). |
| Stick Around does not hold a post's own author | n09 (a reader who is not the author is held; the take's reader is a crowd member, `shot-commentary-3.mjs:82`) | `isHeld` is false for the post's author and the card's caster (`instances/divided-world/cards/stick-around/hold.ts:89-91`); the card's words say so (`instances/divided-world/ui/cards/stick-around/ui.ts:24`); its Lens says "Not holding you · you wrote it" (`instances/divided-world/ui/stick-around/Effect.tsx:50`). | **True.** The film's held reader is neither. |

## Where the film departs from the game

What the takes' stage does that the real game does differently, and whether any spoken line depends on it.

1. **The pile's Hot Box lasts seven seconds** (`instances/divided-world/ui/hype/stage-play.ts:40`, `lastsMs: 7000`); the card lasts 3
   days (`instances/divided-world/cards/hot-box.ts:11`). No line depends on it.
2. **The forecast answers at once.** The real estimate is held for `freshAfter`; the stage's says it is fresh the moment a reaction
   lands (`forecast.ts:11-14`). Node 2's "he made money" names no time. No line depends on it.
3. **A crowd of made-up players seeds the reactions** (`stage-world.ts:10-11`, `:74`), and each reaction counts as one whole vote
   (`forecast.ts:7-9`). The real game pays a vote's weight with a halving and one vote per player per Act (`engine/rules/votes.ts:68-75`);
   one vote each from distinct players is the case where the two agree. No line depends on it.
4. **The phrase trap's spring is seeded, not computed.** The in-memory backend plays no Move from a quote, so `springsOn` writes the
   spring and the landed card it would have written (`stage-play.ts:111-131`); the take types "to be fair" with real key events and
   asserts the reply holds it, but the spring is written after the post whatever it says. The server decides it from the words
   (`0357_post_veils.sql:953,988-990`). Node 6's line depends on the mechanic, which is real; it does not depend on the stage's
   deciding it.
5. **The Lens does not show the matched phrase in the film.** The real game's Lens does, from the spring's `when.says`
   (`engine/ui/cards/lens-words.ts:56-57,90-98`; the server writes it, `0357_post_veils.sql:1006-1016`). The stage's seeded spring
   has no `when`, so the Lens cannot show it, and the take asserts the phrase where it is on the page, in the post the chair dented
   (`tools/hype/shot-commentary-2.mjs`, n06). The design's "the Lens shows the phrase" (section 4) does not hold in the film. No
   spoken line depends on it.
6. **The Staff's three beats are seeded** (`stage-play.ts:154-190`): the memo, the merge and the Mod's filing are written as the
   database would write them. The merge lands at once; the real one waits about a day in the admin queue (`settings.ts:88`). Node 10's
   "he's merging the boards" depends on it, with the caveat recorded at n10-51. The staff lines are the second rehearsal's logs, with
   the cast's names given to the posters they speak of (`tools/hype/staff-lines.mjs:1-10`); the Staff are not switched on in the
   deployed instance (below).
7. **You Were Saying?'s words are a made-up sentence** typed in as the play lands (`stage-play.ts:49`, written at `:211-214`), not a
   model's output. Node 9's "This is GPT-2 finishing someone's post" depends on it only as a picture of what the card does.
8. **The cards and wallet are stocked free** (`stage-play.ts:85-89`): the film's casts are not about the economy, so nothing
   shows what a card costs. No line depends on it.
9. **The pile's plays are written by the seed** (`stage-play.ts:211`), which does not run each card's `canApply` or its price. Whether
   all twelve could stand on one post at once under the real rules was not checked in this task. No line says they could.
10. **The caster's alert is written by the stage.** The in-memory backend writes no `trapStruck` alert; the database does
    (`supabase/migrations/0374_cards_on_a_spun_thread.sql:480`). The stage writes one (`stage-play.ts:145-152`). No line depends on it.

What is real in the takes: the Rope Break's catch (n03) and the 4D Chess's ride (n05) are the backend's own plays, asserted on the page;
the Heel's forecast is the class's own `earn`; the set backs are placed through the backend's own `setCard`.

## What the video waits on before it is published

From the plan's Task 9 and the design's sections 7 and 9.

1. **`systemEnabled` true in the deployed instance.** Today it is `false` (`instances/divided-world/settings.ts:53`; its comment at
   `:52` says it stays off until Task 13 of The System's plan). The design holds the film until the Staff are on (design, section 7:
   "the video waits for the switch"), and until every sentence a player could act on has been checked against the code that day. This
   record is that check as of 2026-11-21; it is repeated on the day of publication.
2. **The voice.** The owner's performance, or the placeholder: "DW Commentary Placeholder" in the owner's ElevenLabs library, an
   original designed voice (design, section 3). The edit refuses a clip that overruns its music window and prints the timing sheet. With
   no voice folder the film is silent and says "PLACEHOLDER SOUND" in a corner (plan, Task 8).
3. **The recordings and their credit line.** The Musopen Symphony recording of 2012 (Czech National Symphony Orchestra, 2:34), as FLAC
   from Wikimedia Commons, marked public domain by Musopen and listed on IMSLP as CC BY 3.0 (design, section 6). The film's description
   carries the credit; the source page and a dated copy of its license are kept beside the film. The plan names "the two
   recordings"; the second is the end card's circus music, not yet chosen (item 5). None is committed (`.runs/` is ignored).
4. **Comic Sans for the end card.** The end card shot throws when "Comic Sans MS" is not installed; `--stand-in` makes a film that
   says "FONT MISSING" on its face (`tools/hype/shot-commentary-end.mjs:1-12`). The final film is assembled on the owner's machine,
   where the font is.
5. **The open items of the design's section 9, as of today.**
   - GPT-2: **answered.** The owner stated on 2026-11-21 that the model is literally GPT-2 and the line stands (see n09-46).
   - Free, and by invitation: **open.** The owner has not said; one flat clause in the welcome would carry it.
   - The circus music: **open.** Fučík's "Entry of the Gladiators" is the obvious piece; no recording has been checked.
   - The style guide: **open.** Whether Gabe's written voice moves toward this register.
   - What the picture gives away: **open**, and standing unless struck. Node 2 shows a Heel hurt by a thumbs up, which the onboarding
     design counts among the things players are meant to find.
   - The block timings: **open.** Estimates from the score; the plan measures them on the recording.

## Revised, 2026-11-21

The film was revised after the second rehearsal. This section records what the revised takes show and where they differ from the game. It
adds to the record above and does not replace it; the entries above keep their verdicts as written.

### The Staff's lines

Every staff line the stage shows is now the second rehearsal's output. `instances/divided-world/ui/hype/staff-lines.json` holds each line
twice: as `said`, the log's exact words, and as `text`, the same line with the cast's names put in for the posters it speaks of. The stage
shows `text`. A test in `instances/divided-world/ui/hype/Stage.test.tsx` finds every `said` in the logs under
`docs/research/2026-11-13-season-rehearsal-run-2/logs/`, character for character, in the log that names it; a filing's aimed-at post is
checked the same way.

The two lines round 1 wrote for ONTOPIC 5.0's visit and filing, which the final review of #914 found in no log, are removed.

One line is not from a log. The quiz is the game's own fixture ("Which form is used to request another form?"), from
`engine/ui/cards/Visit.board.stories.tsx`. The owner gave leave for it on 2026-11-21, because the rehearsal never ran a quiz. It is the only
exception.

The logs hold no report verdict, appeal ruling or apology. So the report and appeal takes show the game's own forms, and the fake backend's
own invented answer line is hidden in those takes (see the departures below).

### The GPT-2 text

`instances/divided-world/ui/hype/gpt2-tail.txt` is real output of the You Were Saying? card: row 14 of `card_texts` on the owner's test
instance, cast by the owner on 2026-11-21. The post it continues is "Seriously what the fuck is a video game", and the stage's post 20 is that
post, word for word. So the film shows a true pair: a post, and what the card wrote after it. The owner stated the same day that the model is
literally GPT-2 (see n09-46 above).

The text was read once from the instance by the session the owner asked. No build session or subagent touched the instance.

### Departures the new takes add

What the new takes do that the game does not, beyond the departures listed above. None of these changes a line the film says, unless a line
is named.

- **The Hall Pass.** A real play sets it, but its spring and the trapped ending are seeded, because the fake backend never springs one. The
  notice shown on screen is the game's own.
- **Filings.** They are seeded, and aimed at posts written for them, with the words the rehearsal's posts had.
- **The full warn bar.** It is five seeded filings on one character.
- **The Autocorrect on the stage.** It is seeded as played 26 hours ago, so its author is past the 24-hour hold and can peel it.
- **The report and appeal takes.** The fake backend's invented verdict line is drawn invisible. The words the reader sees are the game's forms.
- **The card back.** Its turn to Rope Break or Hall Pass is an instant swap in the game, not an animation.
- **The close-ups.** They are filmed at small viewports with high density, so the game is drawn large.

### The music

The film's music is the Musopen recording of Edvard Grieg's "In the Hall of the Mountain King" (Peer Gynt Suite No. 1, Op. 46), the Czech
National Symphony Orchestra, 2012, 154.09 seconds whole. The source file is listed in `instances/divided-world/ui/hype/music-map.json`
(`source`).

The edit uses the whole recording, or a shortened version of it, made by removing two whole theme statements from the first block. The
recipes are the `versions` in `music-map.json`: `mk-a` removes statements 2 and 3 (2:16.4 is the length it cuts to, from 2:34), and `mk-b`
removes statements 2 and 5 (1:58.4). The edit chooses the longest version the narration allows.

The joins were measured, not listened to. The analysis's README (`.runs/hype/musiccut`, ignored by git) holds the measurements, and the
owner's ear is the test. Nobody building this has heard a join.

## Revised, 2026-11-22

The thread under the film was rewritten as one story (`docs/plans/2026-11-22-wiggler-thread-design.md`). This section records where its
staff lines come from. It adds to the record above and does not replace it.

### The Staff's lines, again

The owner relaxed the rule of 2026-11-21 that every staff line is the rehearsal's. Asked whether a rehearsal should be reworked to take a
written thread, the owner chose generated output in its place: "real rehearsal dialogue is ideal but probably not worth reworking the
rehearsal system". So the film's staff lines are now of three kinds, each named on screen nowhere and recorded here:

- **REAL:** the second rehearsal's logs, as in the section above. Two lines: QC-1000's visit opener (`openerQcArts`) and its filing on
  Serious Deer (`filingQcGotcha`).
- **GENERATED:** six lines, from `docs/research/2026-11-21-commentary-video/staff-takes/`:
  - two report verdicts;
  - three filings;
  - one pool post.

  `build.ts` builds each call's prompt with the engine's own builders (`filingPrompt`, `reportPrompt`, `chatterPrompt`) from the thread's
  posts. One fresh light-tier agent answered each prompt with nothing else in view. `check.ts` puts the answers through the engine's repair:
  none was trimmed or dropped. Each is one take, kept as it came, except the Obstruction filing, retaken once because its first prompt
  carried the wrong charge. Its first take is kept as `answers/d-filing-20.premise-mistake.json`.
- **WRITTEN** by the session, by the owner's leave on 2026-11-22: the quiz on Chadluminum's post, in the shape the written-quiz design
  (#1002) will give a Mod, and FanGaME's reason for moving the thread, in his voice from his logged lines.

The prompts in `staff-takes/prompts/` are rebuilt after two corrections to the cast: Serious Deer's pronouns and Chadluminum's spelling. So
they are not byte for byte what was sent. No GENERATED line uses either, and each line stands as it came.

What the visits do on screen (who is visited and when, the Hall Pass, the lockout, the Turn) is scripted by the stage, as the Hall Pass and
the filings were before (departures, above). The quiz's wrong answer and the filings that follow are therefore the stage's, and so are the
points they move.
