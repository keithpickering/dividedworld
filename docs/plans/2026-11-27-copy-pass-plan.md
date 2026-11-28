# Copy pass: the plan

Record, written 2026-11-27. Carries out `docs/plans/2026-11-27-copy-pass-design.md`. Five tasks, in order, each test
first with its red run. Only words change: no migration, no setting, no interface, no payload. Exact details cut here
are the seed of #1257, listed at the end.

**How every copy task runs.** For each string below:
1. Find every test that pins it: `grep -rnF '<a fragment of the old words>' engine instances web e2e tools`.
2. Change the test to expect the new words, and run it red against the old copy. That is the task's red run; record it.
3. Change the copy, and run the test green.

Card descriptions are pinned in `instances/divided-world/ui/index.test.tsx` and in some cards' own `ui.test.tsx`.
Settings rows are pinned in `engine/ui/account/Settings.test.tsx` and `e2e/boards/11-settings.ts`. The log is pinned in
`engine/ui/log/Log.test.tsx`, `engine/ui/log/lines.test.tsx`, `engine/ui/cards/play.test.tsx` and
`web/src/data/fixtures/boards.ts`.

A string a test does not pin gets a new assertion in `index.test.tsx` that the cut words are gone, e.g.
`expect(ui.describe(instance.settings)).not.toContain("takes no other thread's place")`. Run it red first.

An e2e spec that reads a cut phrase is changed only where it reads the description, never where it checks an effect.
`e2e/its-curtains.spec.ts` and `e2e/hot-box.spec.ts` name "ta-da" and "Wave the smoke" for the effect itself; leave
those.

Where the old words below sit in a template literal, the `${...}` parts are copied from the file as they stand.
"Cut X" means delete X and the space before it. Where a describe's `settings` parameter goes unused after a cut, rename
it `_settings`, as Buzzkill's is.

## Task 1. The test, written down

Model: haiku

1. **Create `specs/player-copy.md`** with exactly this content:

   ```markdown
   # Player copy: prepare, don't assign research

   Current. The test for every word a player reads in the glass: card descriptions, the Strategy Guide, tips, Settings,
   the Lens and the log. The owner settled it on 2026-11-27 (`docs/plans/2026-11-27-copy-pass-design.md`).

   > In Super Mario Bros, you die by the first Goomba in 1-1, repeatedly, until you figure out how to jump. This is the
   > purest example of game design, learning through experience. Our 1-1 is a message board at whatever state it is on
   > that day, so not quite as predictable - the omochao-style explanations are forgivable for that reason. But
   > generally we want to surprise and delight and prepare, not assign research.

   ## The test

   A clause **stays** if a player could act on it before doing the thing (plan a play, spend, choose a setting), or
   needs it to know what was done to them, how a state ends, or what is private.

   A clause **goes** if it only tells what a player sees the moment they do the thing, or what no player would notice
   either way. Such a clause is true, and it raises a question whose answer is boring.

   - Goes: how an effect looks or sounds ("with a ta-da and confetti"), how fast a control works ("a coat at a pass"),
     what nobody would notice ("even where it covers another tag"), and a rare interaction the log or the Lens names
     when it happens ("a card your post's ward turns away never reaches it").
   - Stays: how a state ends ("which lasts until they leave the page"), what is private ("Anyone who read it before
     remembers"), what a player plans around ("It never stops a card set face down"), and the accessible path's
     existence where a player needs it to choose a setting ("shown as a caption").
   - Forgivable: a tip or a hint that points at a control. The board is never the same 1-1 twice.

   ## Numbers

   A relative amount, such as "20% more than normal", is intuitive in the right way. Exact rounding, caps and
   settlement adjustments are not player copy. They wait for the Advanced Strategy Guide (#1257). Where a sentence
   needs the reason a number exists, it says the reason in plain words, with no unexplained term.

   ## What the test never cuts

   CLAUDE.md's honesty rules stand over this one:
   - The log names which Act did a thing, what it changed and how much Aura moved, in plain words.
   - The glass never bluffs about how the game works.

   Cutting a true detail is fine. Making a sentence untrue is not, and neither is cutting what a player needs to step
   back and see the game.
   ```

2. **Edit `.claude/skills/design-session/SKILL.md`.** Under "How it plans", after the "Screens." bullet, add:

   ```markdown
   - **Copy.** Words a plan writes for a player pass `specs/player-copy.md`: they prepare the player, and leave what
     doing the thing shows for the player to find.
   ```

3. **Edit `.claude/skills/build-session/SKILL.md`.** In "Review, inside this session", item 1, change
   `and a quality reviewer
   (is it correct, tested, and written like the code around it?)` to `and a quality reviewer
   (is it correct, tested, and written like the code around it, and does every string a player reads that it adds or
   changes pass `specs/player-copy.md`?)`. Re-wrap the paragraph at 120 columns.

4. **Edit `instances/divided-world/voice/gabe.md`.**
   - Section 9: add an item 8, `Does any clause only tell what doing the thing shows, or what no player would notice
     (specs/player-copy.md)?`
   - Section 5: after the bullet "**Reveal what players are meant to find:** ...", add one line:
     `Exact numbers for the curious are #1257's question, not yet an answer.`

- **Test first:** `node tools/check-doc-references.mjs` runs red with the spec's path named in the skill before the spec
  exists. Record that, then make it green.

## Task 2. Card descriptions

Model: haiku

All files are `instances/divided-world/ui/cards/<key>/ui.ts`, in `describe` unless noted.

- **autocorrect.**
  - Old: `Any reader can lift a strip by one end to read under it, and it lays back down. Only the post's author can peel strips off, slowly, for everyone and press a started peel back down, and the author's words`
  - New: `Any reader can lift a strip to read under it. Only the post's author can peel strips off for everyone, and the author's words`
  - In `logSave`, change `'You peeled every strip it had then. An edit that brings the phrase back brings a strip with it.'` to `'You peeled every strip it had then.'`
- **blind-study.** Change `Everyone can still react, and sees their own reactions.` to `Everyone can still react.`
- **buzzkill.** Cut ` If an admin ends it, the Gimmick comes back for the rest of its time.` Its `ui.test.tsx` pins it.
- **cheap-shot.** Cut ` A card that lets a Move land and pays or gives it back still springs. It does nothing for a Move that lands from a quote.`
- **class-clown, heat-magnet, hype-up, publicity-tour, required-reading, sweet-heat.**
  - Cut ` ${LARGEST}` and its import.
  - Delete `LARGEST` and its comment from `instances/divided-world/ui/cards/words.ts` once nothing imports it. `instances/divided-world/cards/*.ts` mention "only the larger" in comments and rules; leave those.
- **feelin-fab.**
  - Old: `It gives a post a rainbow behind its words, which stay as readable as ever. One makes the whole post's background drift slowly through the rainbow; two make it an animated rainbow band; three make it an animated radial rainbow, with the colors spreading out from the middle. A few twinkles come with it. Up to three`
  - New: `It gives a post a rainbow behind its words, which stay as readable as ever, and each one more on the post makes it grander. Up to three`
- **feelin-glam.**
  - Change `up to Feelin' Fab's three: two Feelin' Fabs and a Feelin' Glam make the full prism.` to `up to Feelin' Fab's three.`
  - Cut ` If an admin ends the card, every post loses the level.`
- **happy-heart, super-happy-heart.** Cut ` The filings stay on the record; the card is a new entry beside them.`
- **hot-box.**
  - Old: `Under the smoke the words can't be read: a reader points at them to clear a patch, or holds Wave the smoke to clear the post line by line, and the smoke rolls back in.`
  - New: `Under the smoke the words can't be read until a reader waves it away, and the smoke rolls back in.`
  - The test's `body(...)` helper in `index.test.tsx` holds the old sentence; change it there.
- **hype-up.** Cut ` A Mod Bot earns nothing, so its posts gain nothing from one.`
- **its-curtains.** Change `A drumroll plays while a reader points at it, and one press opens it, with a ta-da and confetti. Each reader opens it for themselves, and the post's effects start only then.` to `Each reader opens it for themselves with one press, and the post's effects start only then.`
- **jimmy-wails.**
  - Change `% to overhead, rounded up, and the rest` to `% to overhead, and the rest`.
  - Change `loses what does not fit, and a gift on a post by staff is all overhead.` to `loses what does not fit.`
- **kick-me.** Cut ` A Move that a card set face down catches or hands back first, or a Mod Bot's Move, does not count.`
- **last-word.** Cut ` Quotes made before it was played stay as they are.`
- **laugh-track.** Change `Wherever a phrase appears in the post's own words, the audience stirs as a reader gets close and the phrase's underline fades in. Pointing at the phrase, tapping it, or pressing Enter on it plays the reaction.` to `Wherever a phrase appears in the post's own words, a reader can set the audience off.`
- **line-cutter.**
  - Old: `It is a post like any other: it keeps its own number, and it can be quoted, reacted to and played on. One fits under a post, and a reply that cut in takes none under it. It is only ever cast face up. If an admin ends the card, the reply drops back to its own place in the thread.`
  - New: `It is a post like any other: it can be quoted, reacted to and played on. One fits under a post. It is only ever cast face up.`
  - `engine/ui/thread/Thread.test.tsx` names "keeps its own number" about the engine's own behavior; leave it.
- **main-event.** Cut ` It takes no other thread's place on the page.`
- **off-day.** In `describe` only, change `Its own class does not change, no Turn is used and its Turn cooldown is untouched.` to `Its own class does not change and no Turn is used.` The log line at `off-day/ui.ts` says what was not done to the player's character, and stays.
- **pay-it-forward.**
  - Cut ` A Mod Bot's Move passes over it.`
  - Change `A rarer Move passes over it, and a Move your post's ward turns away never reaches it.` to `A rarer Move passes over it.`
- **pop-steal, rope-break.** Change `Any other card passes over it, and a card your post's ward turns away never reaches it.` to `Any other card passes over it.`
- **so-very-happy.** Change `A rarer Move passes over it, and a Move your post's ward turns away never reaches it.` to `A rarer Move passes over it.`
- **whoopee-cushion.** Change `A rarer card passes over it, and a card your post's ward turns away never reaches it.` to `A rarer card passes over it.` Its `ui.test.tsx` pins it.
- **steel-chair.**
  - Old: `Something is thrown at a post and dents it, usually a folding chair, sometimes a trash can, a step ladder or a fire extinguisher: the words bend into the dent, and the thing drops to the floor under them. A trash can's lid flies off, and a fire extinguisher fills the post with spray that clears by itself in a few seconds. Once it lands it covers none of the words, and it holds nobody. It plays again each time the post scrolls into view, somewhere else each time, and with Game sounds on it clangs each time, unless motion is reduced. Up to`
  - New: `Something is thrown at a post and dents it, and the words bend into the dent. Once it lands it covers none of the words, and it holds nobody. Up to`
  - `instances/divided-world/ui/steel-chair/body.ts` and `ui/front-door.ts` name the folding chair for the effect; leave them.
- **tattle-tale.** Change `the Mod Bot still judges each post against the rules, and a patrol still drops a finding against a character staff has already punished ${settings.modBots.cap.punishments} times in the last ${settings.modBots.cap.days} days.` to `the Mod Bot still judges each post against the rules.`
- **thick-skin.**
  - Cut ` A loss counted from a whole settlement window's reactions, and not from one reaction, is ${halved} where this card is still up when that window ends.`
  - Cut ` A card that pays more for the same reaction still pays.`
  - `halved` stays, since `summary` uses it.
- **this.** Change `It costs nothing more to play than its price at the machine.` to `It costs nothing more to play.`, as every other card says.
- **time-machine** (a tidy, design section 7).
  - In `summary`, change `For 3 days` to `` For ${spanWords(timeMachine.lasts!)} ``, and `up to rare` to `` up to ${timeMachine.rewind!.upTo} ``, as `describe` already does.
  - Make the literal a template literal and import `spanWords` if it is not imported.
  - Assert in `index.test.tsx` that `summary` and `describe` agree with the card's rules under a changed `lasts`.
- **ultra-happy-heart.**
  - Old: `It ends that character's ban at once: the character can post, react and play cards again from that moment. The ban stays`
  - New: `It ends that character's ban at once. The ban stays`
  - Change `A banned character cannot play cards, so another character plays it: anyone's, one of your own included.` to `Any character but the banned one can play it, one of your own included.`
- **you-were-saying.** Change `The author can erase it, but all at once, and an edit to the post gets a fresh take.` to `The author can erase it, but all at once.`

**Before cutting a rare-interaction clause** (Buzzkill, Cheap Shot, Feelin' Glam, Hype Up, Kick Me, Line Cutter, the
traps' ward and Mod Bot clauses), open its log row or Lens line and confirm the outcome is named there when it happens:
- an admin's end: the `card_end` row, `engine/ui/log/lines.ts`;
- a pierce: `pierceSaid`;
- a trap still set: the Lens.

Where one is not named, keep the clause, and note it under the PR's `Design questions`.

- **Test first:** each changed string's assertion runs red against the old copy, as "How every copy task runs" says.
  `npx vitest run instances/divided-world/ui` passes after.

## Task 3. The Strategy Guide

Model: haiku

File: `instances/divided-world/guide/strategy-guide.md`. These are Gabe's words. They are cuts, plus one reworded
reason in his plain register (gabe.md, setting 2). Run gabe.md's checklist on the result.

1. Change `A reaction waits a few seconds before it's sent, and the tile shows the wait.` to `A reaction waits a few seconds before it's sent.`
2. Cut ` The first time you load the board after a settlement that scored you, a summary opens by itself.`
3. Change `It also skips the shared vote and the halving.` to `It also skips a few adjustments the settlement makes.`
4. Change `pick where it lands: every place it can land lights up.` to `pick where it lands.`
5. Cut ` If the room can't decide, it stays Pepperoni.`
6. Change `There are three kinds of card, and the frame shows which: a Move's is solid, a Reversal's is doubled with a folded corner, and a Gimmick's is dashed like a ticket.` to `There are three kinds of card, and the frame shows which.`
7. Cut ` A retired character can be named too, but it can't match while it's retired.`
8. Cut `A phrase or passage is short, and the form tells you how short. ` (the paragraph then opens with `A Reversal takes no conditions.`).
9. Delete the bullet `- Punctuation at the very ends of your phrase is ignored, so "wow!" matches "wow".`
10. Change `A phrase never matches across a line break, or across the edge of a quote, or through code, a link or an image.` to `A phrase never matches across a line break, or across the edge of a quote.`
11. Change `and who quoted if you used Only these.` to `and who quoted.`
    - This is the accuracy fix: `sprungWords` in `engine/ui/cards/lens-words.ts` names the quoter on every quote spring.
    - First add a case to `engine/ui/cards/lens-words.test.ts` (or the file that tests `sprungWords`) asserting that the quoter is named under the Who `anyone`. Expect it green, since it pins existing behavior.

`tools/test-guide.mjs` has a fixture sentence about a folded corner. It is a fixture for the check, not the Guide. Leave
it.

- **Test first:** `engine/ui/guide/Guide.test.tsx` gains one assertion per cut that the rendered guide no longer holds
  the cut words. It runs red before the edits. `node tools/check-guide.mjs` and `node tools/test-guide.mjs` pass after.

## Task 4. Settings and Appearance

Model: haiku

- `engine/ui/account/Settings.tsx`, and the same sentence in `e2e/boards/11-settings.ts`:
  - Contrast: cut ` The smoke stays at the edges of the screen.`
  - Smoke: cut ` Off leaves plain black.`
- `engine/ui/account/Settings.tsx`, the Tips row: change `Replay the HUD tour shows the three steps of the tour again and turns tips on.` to `Replay the HUD tour shows the tour again and turns tips on.`
- `engine/ui/account/appearanceRows.tsx`, `TILT_SAYS`:
  - `off`: `'Off.'`
  - `denied`: `'Your browser said no. To change that, allow motion and orientation access for this site in your browser\'s settings, then turn this on again.'`
  - `unsupported`: `'This device doesn\'t report tilt.'`
  - `held`: `'Off while motion is reduced.'`
  - `on` and `needs-allow` are unchanged.
- `appearanceRows.tsx`, Text size: change `Applies to the board and the glass together. Past 150% the glass folds into one column, and nothing is cut off.` to `Applies to the board and the glass together, and nothing is cut off at any size.`
- `appearanceRows.tsx`, Game sounds: change `Every one is also shown as a caption at the bottom of the screen.` to `Every one is also shown as a caption.`
  - `engine/ui/welcome/Welcome.test.tsx` names "bottom of the screen". Check whether it reads this row. Change it only if it does.

- **Test first:** `engine/ui/account/Settings.test.tsx`'s assertions on these rows, changed to the new words, run red.
  `npx vitest run engine/ui/account` passes after.

## Task 5. The log

Model: haiku

- `engine/ui/log/lines.ts`, the `played` row's `details`:
  - Old: `` `As ${nameOf(caster, 'one of your characters')}, on `, link ?? 'a post', `${ownOther ? ', a post of one of your own characters' : ''}. `, `` followed by `` `The card was paid for at the machine; ${e.price > 0 ? `this ${place ? 'play' : 'post'} added ${plain(e.price)}.` : 'this play cost nothing more.'}`, ``
  - New: `` `As ${nameOf(caster, 'one of your characters')}, on `, link ?? 'a post', '. ', `` followed by `` e.price > 0 ? `This ${place ? 'play' : 'post'} added ${plain(e.price)}.` : 'This play cost nothing more.', ``
  - Delete `ownOther`'s computation if nothing else reads it.
- `lines.ts`, the estimate line: change `' It counts at the next settlement, before the shared vote and halving. Who reacted is never shown.'` to `" It counts at the next settlement, before the settlement's own adjustments. Who reacted is never shown."`
  - Change the doc comment above `estimate` (`before the shared vote and halving`) to match.
- The Autocorrect `logSave` line is Task 2's.
- Fixtures that hold the played row's words: `web/src/data/fixtures/boards.ts`, `engine/ui/cards/play.test.tsx`, `engine/ui/log/Log.test.tsx`. Change them to the new words.

- **Test first:** `Log.test.tsx`'s assertions on the played row and the estimate line, changed to the new words, run
  red. `npx vitest run engine/ui/log engine/ui/cards` passes after. Then run the full `npm run build`.

## The seed of #1257

What this plan cuts that an Advanced Strategy Guide might carry. Each is true on main at e8749c25.
- Jimmy Wails: overhead is rounded up, and a gift on a staff post is all overhead.
- Tattle-Tale: a patrol drops a finding against a character staff has punished `modBots.cap.punishments` times in
  `modBots.cap.days` days.
- Thick Skin: a loss from a whole window's reactions is halved where the card is up when the window ends. A card that
  pays more for the same reaction still pays.
- The forecast skips the shared vote and the halving.
- A Pepperoni play the room can't decide stays Pepperoni.
- Where two cards pay on the same vote, only the larger pays.
- Wards turn a card away before a trap sees it. A Mod Bot's Move passes over Pay It Forward. Kick Me's refunds skip a
  Move a back caught or handed back, and a Mod Bot's.
- Cheap Shot does nothing for a Move that lands from a quote. A card that lets a Move land and pays or gives it back
  still springs.
- An admin ending Buzzkill brings the Gimmick back. An admin ending Feelin' Glam takes every post's level. An admin
  ending Line Cutter drops the reply back.
- A retired character named in a Who can't match while retired.
- Phrase matching ignores punctuation at a phrase's ends, and never matches through code, a link or an image.

## Review focus

- The Strategy Guide edits are Gabe's words. CLAUDE.md says they are "approved by the owner in review", so the build's
  PR waits on the owner's read of Task 3's diff, whatever the merging permission allows.
- Each rare-interaction cut stands on the log or the Lens naming the outcome when it happens. Is that true for every
  one the build cut, or does a player now have no way to learn what happened to their card?
- A cut leaves the sentence around it true. Check in particular:
  - Ultra Happy Heart's "Any character but the banned one";
  - the forecast's "a few adjustments";
  - Hot Box's "until a reader waves it away", against the effect's real controls.
- The played log row still names the card, the character, the post and the Aura the play cost, at every price.
- No e2e spec that checks an effect lost the words it reads.
