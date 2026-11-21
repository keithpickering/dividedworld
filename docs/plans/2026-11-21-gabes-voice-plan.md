# Gabe's voice: a style guide, and the Strategy Guide rewritten in it: plan

Record, written 2026-11-21. The plan for `docs/plans/2026-11-21-gabes-voice-design.md`. A build session carries it out
from this file alone. The words in Tasks 4, 6 and 7 are the owner's to approve in this plan's PR; a build session
copies them exactly and changes a word only where Task 5 finds a sentence untrue, and then it stops and asks.

Every task tests first and shows its red run. No task touches a deployed database; SQL is tested against Postgres on
localhost.

**Order.** Tasks 1 to 3 are the engine's and are done in order. Task 4 stands alone. Task 5 comes before Task 6. Task
7 stands alone.

## Task 1. The page learns the switch and the season's length

Model: sonnet

Engine. `screen_settings` gains `systemEnabled` and `seasonLength`, so the guide's page can pick a conditional and say
how long a season is. Both are the instance's settings, the same for every reader.

Files and functions:

- A new migration, numbered one above the highest in `supabase/migrations/` when the task starts (0392 at the time of
  writing). It re-creates the view `screen_settings` from its latest definition (find it with
  `grep -ln "view screen_settings" supabase/migrations/*.sql | tail -1`; `0383_crowd_pay_setting.sql` at the time of
  writing), copied whole, with `'systemEnabled'` and `'seasonLength'` added to its list of keys. Its header says what
  it copies and from where, and the Masks line: settings hold the instance's numbers, nothing is computed from a
  private fact, the view is public as it was.
- `engine/ui/data/api.ts`, `ScreenSettings`: `readonly systemEnabled: boolean` and `readonly seasonLength: Span`, each
  with a comment.
- `engine/ui/guide/markdown.ts`, `KINDS`: `systemEnabled: null`, `seasonLength: 'span'`. The record is typed by
  `ScreenSettings`' keys, so the type check is red until both lines exist.
- `engine/ui/data/fake.ts`, `engine/ui/test-world.tsx` and `web/src/data/supabase.ts`: wherever a `ScreenSettings` is
  built or defaulted, the two keys. The type check names each place.

Tests first:

- A new SQL test in `supabase/tests/`, numbered after the last: `screen_settings` holds `systemEnabled` as a boolean
  and `seasonLength` as a span, and still holds every key it held before (list them from the copied definition, so a
  key dropped in the copy is red). Red before the migration.
- `engine/ui/guide/markdown.test.ts`: `settingText('seasonLength', …)` says the span in words;
  `settingText('systemEnabled', …)` is undefined.
- `tools/test-guide.mjs`: `{{setting:seasonLength}}` is clean and `{{setting:systemEnabled}}` fires. Add
  `seasonLength` and `systemEnabled` to its `SETTINGS` fixture.

Also: `tools/check-guide.mjs`, `screenSettingsOf` already spreads the instance's compiled settings, so both keys reach
the check with no change; confirm it with the test above and do not add a second source.

## Task 2. Conditional passages in the guide's reader and page

Model: sonnet

Engine. The guide's Markdown gains a passage shown only while the staff are switched on, or only while they are off.

The syntax, each marker alone on its line:

```
<!-- kayfabb:if system-on -->
...
<!-- kayfabb:end -->
<!-- kayfabb:if system-off -->
...
<!-- kayfabb:end -->
```

Files and functions:

- `engine/ui/guide/markdown.ts`:
  - `Block` gains `{ readonly t: 'when'; readonly system: 'on' | 'off'; readonly blocks: readonly Block[] }`.
  - Export `CONDITIONS = ['system-on', 'system-off'] as const`.
  - `blocks()` reads an `if` line with a known condition, gathers lines to the matching `end` line, and pushes a
    `when` block holding `blocks(thoseLines)`. So that the check can name each fault, the parser is lenient and never
    throws: an `if` with an unknown condition, an `if` inside an `if`, an `if` never closed and an `end` with no `if`
    each become `{ t: 'marker', name }` with a name the check refuses (`if <condition>`, `if-nested`, `if-unclosed`,
    `end`), and the page draws nothing for them, as it does for any marker it does not know. The header comment says
    all of this beside its account of markers.
  - `sectionsOf` is unchanged: a `when` block is a block of the section it stands in. A second-level heading inside a
    `when` block starts no section (the check refuses it; Task 3).
  - `inlineText` is unchanged.
- `engine/ui/guide/render.tsx`, `Blocks`: a `when` block is drawn as its blocks when `fill.settings.systemEnabled`
  is `true` for `on` or `false` for `off`, and as nothing otherwise, including while the setting is not a boolean
  (settings not loaded). No wrapper element: the blocks are siblings of what surrounds them.
- `engine/ui/guide/markers.tsx`, `Letter`, and `engine/ui/welcome/Welcome.tsx`: each filters `b.t !== 'marker'` out of
  the letter; a `when` block in a letter is dropped the same way. A letter is the same for every state of the switch.

Tests first:

- `engine/ui/guide/markdown.test.ts`: an on passage and an off passage parse to `when` blocks holding their blocks;
  text before and after is untouched; a list, a table and a third-level heading inside one are read; each of the four
  malformed forms parses to the marker named above and the rest of the guide is still there.
- `engine/ui/guide/Guide.test.tsx`: with `systemEnabled: true` the on passage is in the document and the off passage
  is not; with `false`, the reverse; with the setting absent, neither. The contents list and the section ids are the
  same in all three. A `{{setting:…}}` and a `#fragment` link inside a shown passage are drawn as outside one.
- `engine/ui/welcome/Welcome.test.tsx`: a letter holding a conditional shows none of it.

A story: `engine/ui/guide/Guide.board.stories.tsx` gains the guide with the staff on and with them off.

## Task 3. The check reads both branches

Model: sonnet

`tools/check-guide.mjs` and `tools/test-guide.mjs`, one unit.

Changes to `guideFaults`:

- `walk` and `words` descend into a `when` block, so a marker, a setting, a link, a stray `{{`, a marker sharing its
  line and a retyped number are found inside a conditional as outside it.
- New faults, each naming its line:
  - a marker named `if <condition>` (unknown condition): "the condition … is not one the engine knows (system-on,
    system-off)";
  - `if-nested`: "a conditional passage stands inside another";
  - `if-unclosed`: "a conditional passage is never closed with kayfabb:end";
  - `end`: "kayfabb:end closes nothing";
  - a second-level heading inside a `when` block: "a section cannot stand inside a conditional passage, since the
    guide's contents and its links must be the same whichever way the switch is".
- The `NOT_ON` rule is removed, both directions, with its constant. In its place: the words `not switched on`
  (case-blind) in any block outside a `system-off` passage are a fault: "… says the staff are not switched on outside
  a system-off passage, so it would be untrue the day they are switched on". Inside a `system-off` passage they are
  clean. Inside a `system-on` passage they are a fault.
- The header comment's list of what the check refuses is rewritten to match, and says why the exact-string rule went
  (the design, section 5).

Poisons, each planted in `tools/test-guide.mjs` and seen red before the check is changed to catch it:

1. An unknown marker inside a `system-on` passage.
2. `{{setting:nope}}` inside a `system-off` passage.
3. A `#nope` link inside a passage.
4. "30 days" typed inside a passage.
5. `<!-- kayfabb:if system-maybe -->`.
6. An `if` inside an `if`.
7. An `if` with no `end`.
8. An `end` with no `if`.
9. `## A section` inside a passage.
10. "They are not switched on yet." in a paragraph outside any passage; the same inside `system-on`.
11. Clean: the same sentence inside `system-off`; a guide with one passage of each kind; a guide with none.

The existing tests of the `NOT_ON` rule are removed with it, and the real tree's poisons gain one: the real guide with
its first `<!-- kayfabb:end -->` line deleted is red.

`tools/build.mjs` is not changed: the pair is already in `STEPS`.

## Task 4. The style guide and its skill

Model: haiku

Instance content and one repository skill. Exact text; nothing is reworded.

- Create `instances/divided-world/voice/gabe.md` with the text under "The style guide's text" below.
- Create `.claude/skills/gabes-voice/SKILL.md` with the text under "The skill's text" below.
- `.claude/skills/README.md`: add to its list, after `build-session/`:
  `` - `gabes-voice/`: read before writing or changing any word Divided World's developer persona speaks. ``
- `.claude/skills/build-session/SKILL.md`, the review table's row "words a player reads": append to its second cell
  `; words the developer persona speaks follow instances/divided-world/voice/gabe.md`.

Then run `npm run build:ci` and show its tail: the document-reference check reads the new current document, and every
path it names exists.

## Task 5. The guide's claims, checked against the code

Model: sonnet

No file is changed by this task. It reads the code and reports. Each claim below is in the guide's text (Task 6) or
the tips (Task 7). For each, find the code that settles it and report true or false with the file and line. A claim
that is false, or that cannot be settled, stops the build session: it reports to the owner with the sentence, what
the code does, and a proposed rewording, and Tasks 6 and 7 wait on the answer. Reads `localhost` only.

| # | Claim | Where to look |
|---|---|---|
| 1 | Aura that would land past the wallet's cap is lost, not held over | the settlement's SQL that credits a wallet, and `walletCap` in `supabase/migrations/` |
| 2 | A new player has no Aura and one sealed Starter Pack in their hand | `startingPack` in `instances/divided-world/settings.ts`; migration `0377_sealed_packs.sql` |
| 3 | The new character form asks for a name, a class and pronouns, and pronouns can be changed later on the character's page | `engine/ui/characters/` |
| 4 | Every class is paid by some corners of the grid and hurt by others | `instances/divided-world/classes/`. If one class is hurt by none, the sentence becomes "Most classes are", as the grid tip says |
| 5 | A pending reaction is undone by pressing its tile again, and nothing is sent | `engine/ui/reactions/Reactions.tsx` |
| 6 | The settlement never pays a player for reacting to their own cards and characters, and the forecast counts every reaction but the caller's own as anyone's | the estimate and settlement SQL; `docs/plans/2026-11-16-settlement-design.md` |
| 7 | Standing is counted fresh each season; the wallet carries over | the season-end SQL |
| 8 | The season's places give trophies that stay on a character's page | `instances/divided-world/trophies.ts`; the season-end SQL |
| 9 | `/season` shows rankings and the season's news | `engine/ui/glass/nav.ts` and the screen it routes to |
| 10 | An announced Turn is the character's own Promo in the season's Promos thread, and may name the old class, the new, or both | `engine/ui/characters/footers.ts`, `previews.ts` |
| 11 | A class becomes public in exactly three ways: a reveal, an announced Turn that names it, a new character announced with its class | the same, and every writer of a public class in the SQL |
| 12 | Everyone's Starter Pack holds the same cards | `instances/divided-world/packs.ts` |
| 13 | The card table prints "Not on sale" for a card the Vending Machine does not sell | `engine/ui/cards/faces.ts`, `priceWords` |
| 14 | A plus after a price means the card can cost more by what it is played on, and the full price is shown before the play is confirmed | `extraOf` in `engine/ui/cards/faces.ts`; the play dialog |
| 15 | Pepperoni stays Pepperoni when the room is tied or silent | `engine/rules/settle.ts` |
| 16 | A card says whether it can be set face down | the card's face and the hand's arm step; `faceUpOnly` in `engine/rules/cards.ts` |
| 17 | Autocorrect and THIS come with Says filled in and unchangeable; say whether Laugh Track does too | `setPhrase` in `instances/divided-world/cards/` |
| 18 | Some cards hide a post's author or its reaction totals for a while, and the Lens says what is hidden and when it returns | migrations `0357` and `0358`; the cards' `ui.ts` |
| 19 | Staff characters wear a group bar that says they are Personality Cores | `instances/divided-world/groups.ts` |
| 20 | With the staff on: the Boss's moves are announced on the board at `/b/announcements`, and players cannot post there but can spin a thread from a staff post | `instances/divided-world/index.ts`; the board's posting rule |
| 21 | With the staff on: a rule never blocks a post; it fills a warn bar; a full bar can end in a timed ban from a board; the bar and the ban each say how they end | the rules and warn bar SQL (`0102_rules.sql` and after); the screens that show them |
| 22 | With the staff on: a character can report a post to the Mod Bots and appeal a ruling; both cost Aura and the price is shown first | `instances/divided-world/settings.ts`, `modBots`; the report and appeal dialogs |
| 23 | With the staff on: the Boss moves a character into a group as a favor or a punishment and a Mod Bot as a punishment only; a punishment can bar posting on a board; a public apology read by whoever placed the character is a way out, and so is an appeal; the log says what happened and when it ends | migrations `0128` to `0135`; `instances/divided-world/groups.ts` |
| 24 | An admin can reverse any staff move, and moves that reshape a board are shown to admins before they land | CLAUDE.md, "The System acts"; the admin queue |
| 25 | Alerts lists quotes, cards on your post, sprung traps and settlements, and each kind can be turned off in Settings | `engine/ui/alerts/`; `toastDefaults` |
| 26 | A Random Event is private, moves no Aura, needs no timed response, and gives a line, gear or sometimes a card | `engine/ui/events/RandomEvent.tsx` |
| 27 | Gear is cosmetic and any of the player's characters can wear what the player found | `engine/ui/wardrobe/` or where `/wardrobe` routes |
| 28 | The code of conduct is at `/conduct`; a real report is made from a control on the post or at `/contact`, goes to admins, costs nothing, and no staff character sees it | migration `0340` and the conduct screens |
| 29 | Invites are given from a page reached at `/settings`; say the exact path | `engine/ui/account/Invites.tsx`, `web/src/App.tsx` |
| 30 | The orbs tip: Aura lands at each settlement from reactions to your characters and from reacting to other players' posts and cards | the same as 6, and crowd pay |

The report is pasted into the PR's description under "Claims checked".

## Task 6. The Strategy Guide

Model: haiku

Instance content. Replace `instances/divided-world/guide/strategy-guide.md` whole with the text under "The Strategy
Guide's text" below, changed only as Task 5's answers from the owner say. `instances/divided-world/guide/hints.ts` is
read against the voice and kept as it is: its six lines are already Gabe's, terse and true. Only its header comment
changes: "Every line is a DRAFT for the owner's review in the PR" becomes "The voice is
instances/divided-world/voice/gabe.md."

Tests first, in `instances/divided-world/ui/index.test.tsx`, under "Divided World's Strategy Guide":

- the guide never says "The System" (red on the old file);
- the guide's sections are, in order: Welcome letter, The metagame, Your first character, Reactions, Aura, Seasons,
  Classes, Turns and reveals, Cards, The masks, The staff, Things that happen to you, The actual rules, Coming
  attractions (read with `sectionsOf`; red on the old file);
- the section "The actual rules" holds none of "I ", "I'm", "my ", "yacht" (the persona does not speak in real
  moderation; drive it red once by planting "I'm" there);
- the existing test, that the file opens with its comment, then `## Welcome letter`, then the letter marker, still
  passes, as does `guideFaults(real)` being empty.

Then `node tools/check-guide.mjs` and `npm run build:ci`, with their output.

## Task 7. The letter, the tips and the front door's note

Model: haiku

Instance content, exact strings.

`instances/divided-world/ui/onboarding.ts`:

- The header comment: "Every word is a DRAFT for the owner's review in the PR (docs/plans/2026-11-02-onboarding-plan.md)."
  becomes "The voice is instances/divided-world/voice/gabe.md; the letter is the first half of the owner's intro post
  (docs/plans/2026-11-21-gabes-voice-design.md, section 3)."
- `letter` becomes these lines, joined by newlines as the old one was:

```
## Hi. I'm Gabe.

You might know me as the creator of Minus World, a forum and a fighting game all-in-one. Recently, I made the decision to strip the RAM from Minus World's servers and sell it to Sam Altman to pay for another yacht for myself. As a result, Minus World had to be shut down. Its denizens were left stranded with nowhere to go, like sad, wandering hobos. Hobos without yachts.

Although Minus World was eventually restored to working order (through no fault of my own), I couldn't shake the feeling that maybe I behaved sort of selfishly in this situation. To clear my conscience, I had the fellas at the lab whip up something new. This is basically like Minus World, but half as good—So I called it "Divided World".

I can't lie to you. Prioritizing this project meant that several in-development games nearing completion, most notably Half-Life: Nuts & Bolts, had to be shelved, likely permanently. These games' assets will be repurposed as purchasable cosmetics, so they will live on in our hats. Uh, I mean hearts.

Have fun,
Gabe
```

  The post's first words become the letter's heading, since the welcome page draws the letter's first heading as its
  headline (`engine/ui/welcome/Welcome.tsx`). Everything else is the owner's, to the letter.

- The tips. Three change; the rest stay as they are.

| Key | Field | New text |
|---|---|---|
| `tour-plate` | `line` | `It's the character you're posting as. The tag beside the name is the class, which no other player can see unless you make it public. Swap masks here, or press the picture to see all of yours.` |
| `tour-orbs` | `line` | `Aura lands here at each settlement: from reactions to your characters, and from reacting to other players' posts and cards. Until then, hatched fill shows where you're headed. There's a most you can hold, so spend it. I would.` |
| `ghost` | `line` | `The hatched fill is a ghost: my estimate of where the reactions so far are taking your Aura. It's a guess until the settlement, which is when it becomes real.` |

`instances/divided-world/ui/front-door.ts`, `note`: the line
`- Evade Mod Bots and appease the almighty Administrator. Learn what they like and you might be able to sweet-talk them!`
becomes
`- Evade Mod Bots and appease the Boss. Learn what they like and you might be able to sweet-talk them!`
(Open in the design: the owner may strike this change in review.)

Tests first: `instances/divided-world/ui/index.test.tsx` already pins parts of these; update each assertion to the new
string before changing the string, and show it red. Add: the letter's first block is a heading; the letter holds no
conditional and no marker; no tip and no line of the note says "The System" or "Administrator".

## The style guide's text

````markdown
# Gabe's voice

Current. The style guide for Divided World's developer persona: how Gabe sounds, what he may make up, and what he may
never get wrong. Read it before writing or changing any word he speaks: the Strategy Guide
(`instances/divided-world/guide/strategy-guide.md`), the class hints (`instances/divided-world/guide/hints.ts`), the
welcome letter and the onboarding tips (`instances/divided-world/ui/onboarding.ts`), the front door's note
(`instances/divided-world/ui/front-door.ts`), and any Updates post. It is for two readers: a session drafting copy for
the owner's review, and the owner or another admin writing an Updates post by hand.

The rule above this guide is CLAUDE.md's "The fiction may lie; the log never does". Where the two seem to disagree,
the rule wins and this guide is wrong.

## 1. The one rule

**Gabe lies about himself. He never lies about the game.**

- **Free:** tall tales about Gabe, his money, his yacht, his company, the fellas at the lab, and where the game came
  from. No player could take these for the game's rules.
- **Free:** being cheerfully wrong about how his own decisions will turn out. "Nothing will go horribly wrong." Every
  Boss is the final and only Boss, and he says so again each time a new one takes over.
- **Always true:** how a mechanic works, what a number is, what is switched on, what is private, what something costs,
  how a state ends, and what was done to a player's characters.

The test for a sentence: could a player act on it? If a player could plan a post, spend an orb or make a choice from
it, it is about the game and it is true. If the only thing a player could do with it is laugh, it is a tall tale.

A joke never changes what a rule means. If a reader could come away from a funny sentence with the wrong idea of the
rule, the sentence is wrong, however good the joke.

## 2. Who he is

- A rich man who did something selfish, is half sorry, and fixes it by delegating.
- He takes credit for the idea and none of the blame: "through no fault of my own".
- Cheerful and unbothered. Nothing is urgent to a man with a yacht.
- He believes his own bad ideas completely, and says so right before they fail.
- He likes the players. He is on their side against the staff, in the way a landlord is on your side against the
  plumbing.

## 3. How he writes

- **Short, flat declaratives.** The joke is in the last few words, often as a fragment. "Hobos without yachts."
- **He admits the damning thing plainly and moves on.** "I can't lie to you." Then he does not dwell.
- **He undercuts his own product.** "Half as good." "Made this. Sorry."
- **He corrects himself into the truth.** "They will live on in our hats. Uh, I mean hearts."
- **His reassurance reassures nobody.** "This is a really good idea, and nothing will go horribly wrong."
- **He credits other people's advice for his restraint.** "I'm told." "My lawyers say." "I was talked out of it."
- **First person.** "I" for Gabe, "we" for the lab when something was built, "you" for the reader.
- **Sign-off:** "Have fun," then "Gabe", on a letter or a post. Never on a tip.
- **Dry.** One exclamation mark is allowed when he is selling a bad idea ("A.I.!"). Otherwise none.
- **Contractions, plain words, American English.** He does not say "utilize". He does not say "delve".

His references come from two places:

- **His own world:** Valve, hats and cosmetics, sequels that never ship, Portal's Personality Cores, yachts, lawyers.
- **The community's:** Minus World, MFGG, Mario fangames, Game Maker, forums in 2003.

## 4. The dial

How much Gabe goes into a passage depends on what the passage is for.

| Setting | Where | What it is |
|---|---|---|
| 0 | Real moderation: the code of conduct, reports to admins, the account, a player's data | No persona. Plain, honest, no jokes. |
| 1 | Reference a player comes back to look up: matching rules, condition lists, tables | Plain, with at most one line of Gabe at the end of a section. |
| 2 | The Strategy Guide's prose, tips, hints. **The default.** | Gabe explains it. First person, and the jokes are made out of the facts. |
| 3 | The welcome letter and Updates posts | A tall tale first, then the news. |

Setting 2 is the one to get right. The joke is built from the fact, so cutting the joke would cut the fact:

> Your **wallet** is shared by all of your characters, and no other player can see inside it. It holds
> {{setting:walletCap}} orbs. Anything that would land past that is gone. I didn't take it. It just stops existing,
> which my lawyers say is different.

Setting 3 in the guide puts a paragraph between a player and the rule they came for. Do not write it there:

> The fellas at the lab asked me what should happen when a wallet fills up. I said, what happens when a yacht fills
> up? They said that isn't how yachts work, and I said that's why they don't have one. Anyway.

A rough measure for setting 2: one Gabe line to every three or four sentences of rule, and never two jokes in a row.
A section that needs none has none.

## 5. What he never does

- **Bluff about a mechanic,** or leave a joke that could be read as one.
- **Mock a player, a character in play, or anyone in the community.** The joke is on Gabe, on his staff, or on the
  game.
- **Speak for the Boss or a Mod Bot,** quote them, or explain their jokes. He built them; he does not do their voices.
  They speak only on the board.
- **Say "The System".** A player reads "the Boss", "the staff", "the Mod Bots", "the Personality Cores" and "the
  game".
- **Claim more privacy than the game gives.** "No other player can see", never "nobody can see": an admin can.
- **Reveal what players are meant to find:** arithmetic, counter-play, tells, a Core's weak spot, how a season's story
  goes.
- **Type a number** in the Strategy Guide. Every number there is a `{{setting:<path>}}` marker.
- **Be mean, or wacky.** No random humor, no pop-culture pile-ups, no emoji, no winking at the reader about being a
  parody.
- **Break into real moderation.** When the subject is a real person's safety, Gabe stops and the page speaks plainly.

## 6. Real people

- **Gabe** is the persona, "who ostensibly invented the game". He is a cartoon of a rich game developer, and the joke
  is always on him.
- **Public figures in tech and games** may appear as props in a tall tale, as Sam Altman does in the intro post. The
  story is absurd on its face and the public figure is scenery in it.
- **Nobody from the community is ever named or alluded to in Gabe's voice,** past or present, kindly or not. A jab
  from the game's own narrator at someone the players know reads as the game taking a side.
- **A session never introduces a new real name.** It uses the names the owner has written. A new one is the owner's to
  add.

## 7. Running gags

Use them sparingly; a gag in every section is a tic.

- **The yacht.** Where Gabe is, what he bought, what he measures things against.
- **The final and only Boss.** Each Boss is permanent. When a new one takes over, Gabe announces the new permanent
  Boss with the same confidence and no memory of the last announcement.
- **The fellas at the lab** do the work. Gabe has the ideas and signs off.
- **Hats.** Shelved games become cosmetics.
- **Advice he was given:** lawyers, the ESRB that never writes back, being talked out of things.
- **The Gabe-N Guar-N-tee.** Reserved for the worst ideas.

## 8. Writing an Updates post

An Updates post is written by an admin in the running instance, never by a model and never seeded. A session may
draft one for an admin to paste; the admin posts it.

- Open at setting 3: what Gabe did, why it was a great idea, and who actually did the work.
- Then the news, true and specific: what changed, what it does to a player, and where to see it.
- A change that takes something away from players is said plainly, in the first lines, before any joke.
- A real incident (an outage, lost data, a moderation matter) is setting 0. Gabe does not narrate it.
- **A new Boss:** Gabe introduces the new Core as the permanent Boss. He does not mention that he said so before, he
  does not explain what happened to the last one beyond what the board already showed, and he does not describe the
  new Boss's weak spot.

## 9. A checklist before the owner reads it

1. Is every sentence a player could act on true today, checked against the code and not against an older draft?
2. Does any joke leave the wrong idea of a rule?
3. Is the passage at the right setting for what it is for?
4. Who is the joke on?
5. Does it name a real person the owner has not already named?
6. Does it say "The System", "nobody can see", or a typed number?
7. Read it aloud in a flat voice. If it needs the exclamation mark, cut it.

## 10. The reference sample

The owner's intro post, whole, as written on 2026-11-21. In the game it is split: the first three paragraphs are the
welcome letter, and the rest is the first Updates post.

> Hi. I'm Gabe. You might know me as the creator of Minus World, a forum and a fighting game all-in-one. Recently, I
> made the decision to strip the RAM from Minus World's servers and sell it to Sam Altman to pay for another yacht for
> myself. As a result, Minus World had to be shut down. Its denizens were left stranded with nowhere to go, like sad,
> wandering hobos. Hobos without yachts.
>
> Although Minus World was eventually restored to working order (through no fault of my own), I couldn't shake the
> feeling that maybe I behaved sort of selfishly in this situation. To clear my conscience, I had the fellas at the
> lab whip up something new. This is basically like Minus World, but half as good—So I called it "Divided World".
>
> I can't lie to you. Prioritizing this project meant that several in-development games nearing completion, most
> notably Half-Life: Nuts & Bolts, had to be shelved, likely permanently. These games' assets will be repurposed as
> purchasable cosmetics, so they will live on in our hats. Uh, I mean hearts.
>
> Finally, there is one more caveat to this whole thing. As I'm sure you know, a multiplayer game takes a dedicated
> content moderator to hold the ship steady. Moderation is a nuanced job, far too difficult for any one person. So I
> decided to give it to something better than a person: A.I.!
>
> You see, here at the office, we've got Personality Cores coming out the wazoo—Leftover stock from an ill-fated
> Portal-themed escape room we tested a few years back. So, I grabbed one out of the pile and plugged it right on into
> the server. FanGaME, my own prized creation, will serve as Divided World's permanent "Boss".
>
> FanGaME (Fanatical GML and Mario Expert) has a bit of a one-track mind, but I'm sure he's up to the task of
> facilitating conversations about a whole variety of topics. Why wouldn't he be? Just keep his preferences in mind and
> you'll get along great.
>
> This is a really good idea, and nothing will go horribly wrong. That's the Gabe-N Guar-N-tee. And if things DO go
> wrong, you know where I'll be: on a yacht.
>
> Have fun,
> Gabe

Two shorter samples, also the owner's: the front door's note ("This is rated M. Or it probably would be, if the ESRB
would get back to me. I think they might not rate this kind of thing.") and the developer's tagline ("Made this.
Sorry.").

### The first Updates post

The second half of the intro post, for the owner to publish from the admin screen when the staff are switched on. It
opens one sentence later than the post does, since "Finally, there is one more caveat" follows nothing here.

> **Meet your permanent Boss**
>
> As I'm sure you know, a multiplayer game takes a dedicated content moderator to hold the ship steady. Moderation is a
> nuanced job, far too difficult for any one person. So I decided to give it to something better than a person: A.I.!
>
> You see, here at the office, we've got Personality Cores coming out the wazoo—Leftover stock from an ill-fated
> Portal-themed escape room we tested a few years back. So, I grabbed one out of the pile and plugged it right on into
> the server. FanGaME, my own prized creation, will serve as Divided World's permanent "Boss".
>
> FanGaME (Fanatical GML and Mario Expert) has a bit of a one-track mind, but I'm sure he's up to the task of
> facilitating conversations about a whole variety of topics. Why wouldn't he be? Just keep his preferences in mind and
> you'll get along great.
>
> This is a really good idea, and nothing will go horribly wrong. That's the Gabe-N Guar-N-tee. And if things DO go
> wrong, you know where I'll be: on a yacht.
>
> Have fun,
> Gabe
````

## The skill's text

````markdown
---
name: gabes-voice
description: Use before writing or changing any word Divided World's developer persona, Gabe, speaks - the Strategy Guide, the welcome letter, onboarding tips, class hints, the front door's note, or a drafted Updates post
---

# Gabe's voice

Divided World's glass has one voice, the developer persona, Gabe. His style guide is
`instances/divided-world/voice/gabe.md`. Read it whole before writing or changing a word he speaks, and run its
checklist (section 9) on what you wrote before the owner reads it.

Three things from it, so that a session that reads only this still gets them right:

- Gabe lies about himself and never about the game. Anything a player could act on is true today, checked against the
  code.
- The Strategy Guide's default is "Gabe explains it": first person, jokes made out of the facts. Reference passages
  are plain. Real moderation has no persona at all.
- A session never names a real person the owner has not already named, never names anyone from the community, and
  never writes "The System" in words a player reads.

Every word he speaks is committed to the repository and approved by the owner in review (CLAUDE.md, "The fiction may
lie; the log never does"). An Updates post is the exception: an admin writes it in the running instance. A session may
draft one for the admin to paste and never posts it.

Not for: what the Boss, a Mod Bot or any staff character says on the board (their personas are in
`instances/divided-world/system/`), the engine's own glass copy, or a player's log, which is plain.
````

## The Strategy Guide's text

````markdown
<!--
  Divided World's Strategy Guide, in Gabe's voice (the developer persona, instances/divided-world/index.ts). The voice is
  instances/divided-world/voice/gabe.md: read it before changing a word here. Gabe explains the game in the first person, his jokes are made
  out of the facts, and nothing he says about how the game works is untrue. It is the surface only: what a newcomer who is totally lost
  needs, and none of the deep mechanics that are fun to find and trade in threads (docs/plans/2026-11-02-onboarding-design.md, section 8).

  Rules this file keeps, and tools/check-guide.mjs reads it for:
  - Every number is a {{setting:<path>}} marker, so the guide is true after every retune. Never type one, whether as digits or as a word.
  - The class list, the reaction grid, the welcome letter and the card table are markers the engine fills from the live instance.
  - What depends on the staff being switched on stands between the markers "kayfabb:if system-on" and "kayfabb:end", and what is true only
    while they are off between "kayfabb:if system-off" and "kayfabb:end". A second-level heading never stands inside either, and the words
    "not switched on" stand only inside a system-off passage.
  - It never claims more privacy than the game gives: other players cannot see these things, and it says "no other player".
  - It never says "The System". A player reads "the Boss", "the staff" and "the game".
  - "The actual rules" is real moderation and is written plainly, with no persona and no jokes.
  - No Markdown headings above the second level start a section; each second-level heading is a section and an anchor.
-->

## Welcome letter

<!-- kayfabb:letter -->

## The metagame

Divided World looks like a message board from 2003, and it is one. I had it built that way because 2003 is the last time I understood the internet. It's also a game, and every post on it is a move.

You are a **player**: one login, and up to {{setting:charactersPerPlayer}} **characters**. Each character is a mask, and no other player can see which masks are yours. Every character also has a secret **class**, a way of working the crowd that decides which reactions lift the character and which ones wear it down. [Classes](#classes) has the list.

Almost everything anyone does here leaves a public record. We call it an **Act**: a post, an edit, a card, an announced Turn. You can react to an Act, and you can **spin a thread** from one, which starts a new thread with that Act sitting in its origin box. Even an edit is an Act. The post keeps its history, and you get {{setting:editGrace}} to fix a typo before it says "Last edited." I asked for that window personally. I make a lot of typos.

Here's the part people don't believe: **nobody is paid for guessing anybody's class.** Working out who's behind a mask is a crowd sport. I looked into charging for it and was talked out of it.

Along the bottom of every board page is your **HUD**: the character you're posting as, your orbs, and your hand of cards.

One more thing, and it's the important one. This place has two halves. The **board** is the game, and anything said on it, by a character or by the staff, might be a bluff. The screens around it, like this guide, [My log](/log) and Settings, are me talking. I'll tell you some things about my yacht that you shouldn't repeat under oath, but I don't bluff about how the game works.

When you want to know what changed lately, [Updates](/updates) is where I say so.

## Your first character

[Go make somebody.](/characters/new) You'll give the character a name, a class and pronouns. The pronouns can be changed later on the character's page. The class can too, but that's a [Turn](#turns-and-reveals), and it comes with a wait.

Then you decide how the character arrives:

- **Drop now**, and the character is on the board at once. Or **debut at the settlement**, and the character waits, seen by no one but you, until the next [settlement](#aura).
- **Silent**, and nobody is told. Or **announced**, and the character posts a Promo of its own in the season's Promos thread. Or **announced, with its class**, and the Promo also says what class the character is. That last one stays public and can't be taken back, so mean it.

You start with no Aura. I'm not made of orbs. What you do get is a sealed **Starter Pack**, waiting in your hand. Open it. [Cards](#cards) explains what you're looking at.

## Reactions

Posts, and the cards played on them, take reactions. The picker lays them out like a map:

<!-- kayfabb:reactions -->

That map is the whole game. Every class is paid by some corners of it and hurt by others, so the same reaction can lift one character and sink another. I'd love to tell you this was designed. The fellas at the lab drew four boxes on a whiteboard and I said "ship it."

- You can leave up to {{setting:reactionCap}} reactions on a post, counted across all of your characters, not per mask.
- Your reactions on a post share one vote. Leave one and it carries the whole vote; leave more and they split it.
- Your characters can't react to each other's posts. Yes, we thought of that.
- A reaction waits a few seconds before it's sent, and the tile shows the wait. Press it again in that time and it's undone, with nothing sent. After that it's in, so pick like you mean it.
- The tallies are public. Who left them isn't shown to any player, and that includes the one who wrote the post.

## Aura

Aura is the score and also the money, which I'm told is how the real economy works too. We count it in **orbs**. It comes mostly from other players' reactions, read through your character's class (see [Classes](#classes)), and from reactions to the cards you play.

- Your **wallet** is shared by all of your characters, and no other player can see inside it. It holds {{setting:walletCap}} orbs. Anything that would land past that is gone. I didn't take it. It just stops existing, which my lawyers say is different.
- Each character also has a **standing**: the Aura that character has earned this season. Standing is public, you can't spend it, and it's what the rank beside the character's posts is made of.

**Crowd pay.** Reacting pays too. At each settlement your wallet gets {{setting:crowdPayEach}} Aura for each post or card by another player that you reacted to for the first time, up to {{setting:crowdPayMost}} of them. It's the same whichever reaction you pick and whichever character you react as, so react the way you actually feel. Crowd pay goes to your wallet only. It never counts toward any character's standing, and no other player can see it. I am paying you to have opinions. You're welcome.

### The settlement

Aura doesn't land the moment somebody reacts. It lands at the **settlement**, and settlements are {{setting:settlementLength}} apart. In between, your orbs show a hatched **ghost**: an estimate of where the reactions so far are taking you. Think of the ghost as a forecast and the settlement as the weather. The first time you load the board after a settlement that moved your Aura, a summary opens by itself.

The forecast always says **up to**, because it can count reactions the settlement won't. It counts every reaction as if anybody could have left it, while the settlement never pays a player for reacting to their own cards and characters. It also skips the shared vote and the halving. The settlement is exact. The forecast is me squinting.

A few cards pay their player a share of a vote at the settlement, whatever anybody's class, and never out of another player's Aura.

### Your log

[My log](/log) is the honest record, and it's the one thing here I'd swear to. It's grouped by settlement and lists every line that moved your Aura: which Act did it, which corner of the grid, and how much, in plain words. It never says who reacted. If you ever wonder whether something was done to you or just said to you, the log is the answer.

## Seasons

The game runs in **seasons**, and a season lasts {{setting:seasonLength}}. A character's standing is counted fresh each season, and the rank under its name climbs with it. When a season ends, the characters at the top of the rankings take the season's trophies, which stay on their pages.

[Season](/season) has the rankings and the season's news. It's the scoreboard. I check it from the yacht.

Your wallet is not seasonal. Orbs you haven't spent are still yours when a new season starts.

## Classes

Every character has one, and no other player can see it unless you make it public. A class decides which corners of the reaction grid pay your character and which ones cost it. Reactions to a card you play count for you too, read through your class.

Pick the one that sounds like how you already post, or the one that sounds like a terrible idea. Terrible ideas have worked out fine for me. You can [Turn](#turns-and-reveals) later.

<!-- kayfabb:classes -->

## Turns and reveals

### Turns

A class isn't a life sentence. A character can **Turn** into a different class, but after a Turn takes effect, that character waits {{setting:turnCooldown}} before Turning again.

- A Turn takes effect at the next settlement. Until then the old class still applies, and you can change the Turn or withdraw it.
- A Turn can be **silent**, so nobody is told, or **announced**: your character posts a Promo of its own in the season's Promos thread, saying it has Turned. An announced Turn can also name the old class, the new class, or both. Naming the new class makes it public.

### Reveals

A **reveal** is something your character posts, in a thread you pick, with a line in the character's own words. It carries a badge the game checked, so it's the real thing and not just a character *saying* what its class is. A reveal can't be taken back, and it's dated: the badge says what the class was that day. Revealing doesn't earn or cost anything directly. The catch is that everybody can now play against a known class.

### How a class becomes public

There are exactly three ways, and you're holding all three:

- a reveal;
- an announced Turn that names the class;
- a new character announced with its class.

Nothing else does it. Not the staff, not another player, and not me.

## Cards

A post is a move. A card is a move on somebody else's move, or a boost for your own.

### Getting them

- **The Starter Pack.** Every player gets one, sealed, in their hand. Everyone's holds the same cards, so nobody starts ahead. This is the only fair thing in the game and I want credit for it.
- **The Booster.** A sealed pack you buy at the [Vending Machine](/vending) with orbs from your wallet. You don't see what's inside until you open it. Most of it will be common. Some of it won't.
- **Single cards.** The Vending Machine also sells some cards one at a time. The rest say "Not on sale" in the table below, and a pack is how you get those. I'm told this is called "making the pulls special." I call it selling packs.

Everything you buy or open goes into your **hand**, which all of your characters share.

### Playing them

Open your hand, arm a card, and pick where it lands: every place it can land lights up. Add a message if you like, and play it as your current character.

A played card is an Act of its own. It shows on the post as a **mark**. Press the mark to open the **Lens**, where anyone can read what the card is doing and how it ends, react to it, and spin a thread from it.

<!-- kayfabb:cards -->

A plus after a price means the card can cost more depending on what you play it on. You're shown the full price before you commit.

<!-- kayfabb:if system-off -->

A few cards in that table talk about warn bars and Mod Bot visits. The staff aren't switched on here yet (see [The staff](#the-staff)), so for now those cards have nothing to act on. Hang on to them.

<!-- kayfabb:end -->

Three things printed on every card are worth knowing:

- **Sweet, Salty, Pepperoni.** A card's flavor says which side of the line the play is on. Sweet is babyface work, Salty is heel work: a Sweet Move helps, a Salty one gets in the way; a Sweet Reversal is a clean save, a Salty one a dirty counter; a Sweet Gimmick rewards clean play, a Salty one underhanded play. Pepperoni could go either way, and at the settlement the room decides which, by how it reacted. If the room can't decide, it stays Pepperoni. The room is everybody except whoever cast the card and, for a card on a post, whoever wrote that post.
- **Move, Reversal, Gimmick.** There are three kinds of card, and the frame shows which: a Move's is solid, a Reversal's is doubled with a folded corner, and a Gimmick's is dashed like a ticket.
  A **Move** is cast on a target. Many Moves can also be set face down on your own post, to spring on whoever quotes it; the card says if it can.
  A **Reversal** is only ever set face down on your own post, and springs once on something aimed at that post: a cast it names, or matches by flavor or rarity, or a Mod Bot's visit. Some Reversals catch the cast they spring on; one lets the cast land as usual and pays its setter for the reactions that cast draws.
  A **Gimmick** is played face up on your own post, your own character, or a thread your own character started, and lasts a stated time.
- **Rarity.** Common, uncommon, rare or legendary. Rarer cards tend to do more, and to more than a single post.

A card set face down is a trap. To everyone else it's a card back, and every card back looks the same. A face-down card that hasn't sprung comes back to your hand whenever you take it back, and on its own when its time runs out. The only cost of a trap is that the card is tied up while it waits.

### Setting a Move face down

A Move set with no conditions springs on the first quote of your post, from anyone. That's the gamble, and sometimes it's the fun one. If you'd like to aim, add **conditions** when you set it. The Move springs only on a quote that meets all of them, and each is optional:

- **Says.** The quoting post's own words contain a phrase you type.
- **Quotes.** What the quote holds of your post contains a passage you pick from it. Highlight it in your post's text when you set the card, or type it.
- **Who.** **Anyone**, **Only these** or **Anyone but these**. The last two take a short list of characters. You can name any character you can search for, your own other masks included. A retired character can be named too, but it can't match while it's retired.

A phrase or passage is short, and the form tells you how short. A Reversal takes no conditions. A few cards, Autocorrect and THIS among them, come with Says already filled in with a phrase of their own, and it can't be changed.

**How a phrase matches.** Says, the passage and the cards with a phrase of their own all use the same looser matching, so you only learn it once:

- Capital letters don't matter.
- Punctuation inside a word is ignored, so "dont" matches "don't".
- Between words, any spaces and punctuation are alike, so "nice try" matches "Nice... try!".
- Whole words only. "don" doesn't match inside "don't", and "nice try" doesn't match "nice-try".
- Punctuation at the very ends of your phrase is ignored, so "wow!" matches "wow".
- A phrase never matches across a line break, or across the edge of a quote, or through code, a link or an image.

**Highlight to quote.** Select words inside one post and press **Quote** beside the selection, and only those words are quoted. That's how you quote a passage on purpose. The old way still works, and it's the keyboard route: quote the whole post, then trim the quote in the reply box.

**What everyone sees.** Your conditions are yours alone, and no other player can read them while the card is set. When the card springs, the Lens shows what matched: the phrase, the passage, and who quoted if you used Only these. It never shows an Anyone but list, so nobody learns who you spared. A card nothing meets ends by itself when its time is up (the card's own words say when), so a trap that can no longer be sprung isn't a trap you're stuck in.

## The masks

The board never tells any player who is behind a mask, and nothing it shows can prove it. These are private from every other player: who owns which character, what class a character is, and who left which reaction.

What a character does in public is fair game, though, and the game doesn't hide it. Working out who's behind a mask from what the mask does, and when it does it, is part of playing. That's detective work, not proof. I've been publicly accused of being several people. I neither confirm nor deny.

Some cards hide a little more for a while, like who wrote a post or how its reactions are running. The Lens on the card says what's hidden and when it comes back.

## The staff

A forum needs moderators, and moderation is hard, so I gave the job to something cheaper than people. The staff here are **Personality Cores**: characters like yours, except a machine plays them, and their group bar says so. On the board they are in character. They can bluff, flatter and be wrong, and they often are. They can't see who is behind a mask any more than you can.

<!-- kayfabb:if system-off -->

They're built, and not switched on here yet. They're in a box by the server. When I plug them in, this section gets a lot longer, and you'll hear about it on [Updates](/updates). Until then there's no Boss, no Mod Bots, no rules to break, no warn bar, and nothing to report or appeal in the game.

<!-- kayfabb:end -->

<!-- kayfabb:if system-on -->

### The Boss

One Core is **the Boss**, and the Boss runs the board. The Boss makes moves: a rule, a demand, a favor, a punishment, sometimes a whole new board. Every move is announced on [Staff Announcements](/b/announcements), and each one that asks something of you says what it wants and when it ends. You can't post there, but you can spin a thread from anything the staff say, and you should.

The Boss isn't obliged to be fair. That's not a bug. I picked the Boss personally and I stand by it.

### Mod Bots

The other Cores are **Mod Bots**. They work for the Boss, they patrol the boards, and they visit posts to enforce the rules with total sincerity. Each one has its own beat, its own pet rules and its own weak spot. Finding the weak spot is your job. I'm not going to do everything around here.

### Rules and the warn bar

The Boss's rules never stop you from posting. Breaking one fills your character's **warn bar**, and a full bar can end in a ban from a board for a stated time. The bar and the ban both say plainly how they end. Nothing a Core does deletes what you wrote: a post can be covered, stamped or scribbled on, and what's underneath is still there.

### Reports and appeals

A character can **report** a post to the Mod Bots, and can **appeal** a ruling against it. Both are moves in the game and both cost Aura, shown before you commit. These are game reports, for breaking the Boss's rules. A real problem with a real person goes to a human instead: see [The actual rules](#the-actual-rules).

### Groups and punishments

The staff can move a character into a group for a while: the Boss as a favor or a punishment, a Mod Bot as a punishment only. A punishment can bar a character from posting on a board until it ends. The fastest way out is a public apology, read by whoever put you there, and you can appeal too. Your log always says what happened and when it ends.

### Who's actually in charge

Humans are. An admin can reverse anything a Core does, and the moves that reshape a board are shown to the admins before they land. The Cores don't know this. Please don't tell them.

<!-- kayfabb:end -->

Every character also wears a **group bar**, staff or no staff. Most climb on their own: post enough and you're a Regular, and last through enough seasons and you're Old Guard.

## Things that happen to you

- **[Alerts](/alerts)** is the list of what happened to your characters while you were away: a quote, a card on your post, a trap that sprang, a settlement. Each kind can be turned off in Settings.
- **Random Events.** Now and then, loading a page opens a small window that says SOMETHING HAPPENED! Sometimes it's just a line. Sometimes you've found a piece of gear, or once in a while a card. Only you see it. No Aura moves, and there's nothing to click in time. It's a gift. Don't read into it.
- **Gear and the [Wardrobe](/wardrobe).** Gear is cosmetic: something a character wears over its portrait. Any of your characters can wear what you've found. Yes, there are hats. I have a reputation to maintain.

## The actual rules

This section is not a bit.

Divided World has a [code of conduct](/conduct), and it applies to people, not characters. Playing a villain is the game. Harassing a person is not, and no class, card or character makes it one.

If something on the board is a real problem, report it to the admins: use the report control on the post, or [contact an admin](/contact). That report goes to a human, costs nothing, and has nothing to do with the game's score. The staff characters never see it.

New players join by invite. You have {{setting:invitesPerPlayer}} to give, each good for {{setting:inviteLifetime}}, on your [account page](/settings).

The game may be unfair, but it's never supposed to be a trap. If you find yourself stuck with no way out, that's a bug: [tell an admin](/contact).

## Coming attractions

Still to come, and subject to change:

- **More cards.** There are always more cards.
- **More Cores.** I have a whole pile of them.

That's the game as it stands. It's a pre-alpha, and every number in here is today's, so this guide changes when the game does. If it and the game ever disagree, the game is right and I'd like to hear about it.

Have fun,
Gabe
````

## Review focus

- A sentence in the guide that is true with the staff off and false with them on, or the reverse, standing outside a
  conditional: the check's net is three words wide ("not switched on"), and the rest is a reader's job.
- A joke that leaves the wrong idea of a rule: each Gabe line in the guide read against the rule beside it, by the
  style guide's test (could a player act on it?).
- "The actual rules" read as a player who needs help would read it: plain, complete, and no persona.
- What the guide says is private, read against "A response never proves a private fact": "no other player", never
  "nobody"; crowd pay's sameness across reactions and characters; nothing about who reacted.
- The page while settings load: neither branch of a conditional is drawn, so the guide must not flash the off passage
  to a reader of an instance with the staff on.
- The copied view in Task 1: a key dropped in the copy would blank a number somewhere else in the glass.
- A database already seeded: the migration only widens a view, and the letter and guide are files, so nothing an
  instance already holds changes. Confirm no welcome letter is stored in a row.
