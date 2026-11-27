# Copy pass: prepare the player, don't assign research

Record, written 2026-11-27. A design session with the owner, started by the orchestrating session after the owner's
review of Graffiti's card description on #1237. The plan is `docs/plans/2026-11-27-copy-pass-plan.md`. The Advanced
Strategy Guide this design hands off is #1257.

## 0. What started it

On #1237 the owner cut two clauses from Graffiti's card description. Each was true:

- "counting each tag's own paint, **even where it covers another tag**": "the type of thing people would never notice
  either way and describing it just introduces questions with boring answers".
- "The post's author can wash it off for everyone, **a coat at a pass**": "the speed is obvious by simply doing the
  thing."

The owner, starting this session: "I have been meaning to do an app-wide copy pass for this type of thing. Would be
worth launching a session to investigate where else we are including these little extra bits of information that are
100% honest in a way that muddies waters."

## 1. What was surveyed

The copy a player reads, on main at e8749c25:

- every card's `summary`, `status`, `hint` and `describe` in `instances/divided-world/ui/cards/*/ui.ts`, and the shared
  phrases in `instances/divided-world/ui/cards/words.ts`;
- the Strategy Guide (`instances/divided-world/guide/strategy-guide.md`) and the class hints (`guide/hints.ts`);
- the welcome letter and the tips (`instances/divided-world/ui/onboarding.ts`), and the front door's note
  (`ui/front-door.ts`);
- the Lens (`engine/ui/cards/lens-words.ts`, `engine/ui/cards/Lens.tsx`);
- Settings and Appearance (`engine/ui/account/Settings.tsx`, `engine/ui/account/appearanceRows.tsx`);
- the log (`engine/ui/log/lines.ts`, and each card's `logPlay`/`logSave`);
- the refusals a player meets in play: `refuse(...)` in the rules, and `raise exception ... kayfabb.refusal` in the
  migrations.

**What was found.** The card descriptions hold most of the pattern. The Strategy Guide holds a handful. Settings holds
a few lines. The log holds two. The hints, the tips, the front door's note and the Lens are already lean. Most
refusals are payload checks that no player meets in play. Graffiti's two clauses were cut on #1237 itself, along with
the Lens's "washed or painted over".

## 2. The test (Q1)

**Decided** (the owner, A, with their own words added): a clause **stays** if a player could act on it before doing the
thing, or needs it to know what was done to them, how a state ends, or what is private. A clause **goes** if it only
tells what a player sees the moment they do the thing, or what no player would notice either way. The owner:

> This is making sense. If I can provide any more direction: in Super Mario Bros, you die by the first Goomba in 1-1,
> repeatedly, until you figure out how to jump. This is the purest example of game design, learning through
> experience. Our 1-1 is a message board at whatever state it is on that day, so not quite as predictable - the
> omochao-style explanations are forgivable for that reason. But generally we want to surprise and delight and
> prepare, not assign research.

So a tip that points at a control ("Press Draw to tag this wall") is forgivable. A description of the confetti and the
drumroll spoils the surprise. A description of how slowly a strip peels is research.

Weighed:
- **Stricter** (B): also cut every rare rule interaction. The owner took this up as its own question (section 3).
- **Looser** (C): cut only sensory and UI description, keeping every rule clause however rare. This keeps the
  questions with boring answers that started this.

## 3. Rare interactions come out of the cards (Q2)

**Decided** (the owner, A): a card description loses the clauses that spell out a rare interaction, where the log or
the Lens names the outcome plainly when it happens. The cut clauses are:
- a ward turning a card away before a trap sees it;
- a Mod Bot's Move passing over a trap;
- what happens when an admin ends the card;
- LARGEST, "Where two cards pay on the same vote, only the larger pays";
- Cheap Shot and a quote.

A clause that would change whether a player plays the card at all stays. Examples: Force Field's "It never stops a
card set face down", and Sugar Coat's "It does not stop a card from being set face down there".

The outcomes are named where they happen:
- A pierce past a ward says so in the caster's log (`pierceSaid`, `engine/ui/log/lines.ts`).
- An admin ending a card is its own log row (`lines.ts`, the `card_end` row of the bot-card-options design).
- A trap a Mod Bot passed over is still set, and the Lens shows it set.
- Each settlement line names what paid.

So a cut makes no sentence false and hides nothing that was done.

Weighed:
- **Move them to the Guide** (B): one reference list in the Strategy Guide. The Guide is "surface only"
  (`docs/plans/2026-11-02-onboarding-design.md`, section 8). Where exact detail goes is now section 5's question.
- **Keep them** (C).

## 4. Aura arithmetic: intuitive here, exact elsewhere (Q3)

The question put three kinds to the owner:
- rounding and caps on cards: Jimmy Wails' "rounded up", and Tattle-Tale's patrol cap;
- the forecast's "shared vote and the halving", a term explained nowhere a player reads, in the Guide and in every
  estimate line of the log;
- two log clauses that say nothing this Act did.

The owner answered with a new idea:

> I feel like this points to a need for am Advanced Strategy Guide with exact numbers for min-maxxers. I have discussed
> this in previous sessions but unsure if records exist. We can keep intuitive explanations for general play and
> detailed ones for those curious - that said, something like "20% more than normal" is intuitive in the right way

**Decided:** player copy keeps the intuitive form. A relative amount such as "20% more than normal" is intuitive in the
right way and stays. Exact rounding, caps and settlement adjustments leave the cards. Where an unexplained term stood
for one of them, the sentence keeps its reason in plain words. The forecast "skips a few adjustments the settlement
makes", which is still why it says "up to". The two log clauses that told the player what they already knew go. The
log keeps what the Act did and the Aura it moved.

No record of the Advanced Strategy Guide was found in `docs/`, the issues, the PRs or the orchestrating session's
transcript. The owner's words above are its first record.

## 5. The Advanced Strategy Guide is its own design (Q4)

**Decided** (the owner, A): this pass cuts to intuitive copy now. Every exact detail it cuts is listed in the plan as
the Advanced Guide's seed, and #1257 holds it for a design session of its own.

That session has two rules to settle with the owner, because each stands against the idea as written:
- the onboarding design's section 8, "surface only";
- gabe.md section 5's "never reveals arithmetic, counter-play, tells".

One wording was offered: exact rules and numbers are published for the curious; strategy, counter-play and tells still
are not. It is #1257's to settle, not this design's.

**What the cut costs until then.** A player who wants an exact number finds it in the log and the Lens when it
happens, not before. Cutting a true detail makes no sentence false, and nothing about what was done to a player is
cut.

Weighed:
- **Both in one design** (B): a new glass page, its voice and the two rules' new words, inside a copy pass. That is
  scope drift.
- **Hold the exact ones** (C): leave the number clauses in place until the Advanced Guide lands. That keeps the copy
  the owner wants cut for a page with no design yet.

## 6. Keeping it from drifting back (Q5)

**Decided** (the owner, A): the test is written down once, in a current spec, `specs/player-copy.md`. The skills that
write and review copy point at it:
- the design-session skill, where a plan writes copy;
- the build-session skill's quality reviewer, which checks every player-facing string a task adds or changes;
- gabe.md's checklist.

No script is added. No detector can tell a boring true clause from a needed one. The cut words are also pinned already:
each card's description, the Settings rows and the log lines are asserted word for word in their tests. A cut clause
cannot come back without a test changing in the same diff, where the reviewer reads it against the spec.

Weighed:
- **A CLAUDE.md rule** (B): earned by this incident. The owner chose to hold it in a spec and the skills.
- **A word cap on card descriptions** (C), with a red self-test. It would fight the cards that are long for good reason:
  Stick Around's ways out, Jimmy Wails' money.

## 7. The cuts

The plan holds each string old and new. In short:

- **Cards**, sensory and UI description:
  - It's Curtains' drumroll, ta-da and confetti.
  - Steel Chair's list of thrown objects, the lid, the extinguisher's spray, the clang, and where it lands.
  - Feelin' Fab's three looks, and Feelin' Glam's "full prism".
  - Laugh Track's stirring audience and fading underline.
  - Hot Box's controls.
  - Autocorrect's strip that "lays back down", and its peel speed.
- **Cards**, what nobody would notice:
  - Main Event's "takes no other thread's place".
  - Line Cutter's "keeps its own number", and "a reply that cut in takes none under it".
  - Blind Study's "sees their own reactions".
  - Last Word's "Quotes made before it was played stay as they are".
  - The hearts' "The filings stay on the record; the card is a new entry beside them".
  - Ultra Happy Heart's restated "can post, react and play cards again".
  - Off Day's "Turn cooldown is untouched", which "no Turn is used" already says.
  - You Were Saying's "an edit to the post gets a fresh take". That one is a surprise to find.
- **Cards**, rare interactions (section 3), and exact arithmetic (section 4):
  - Jimmy Wails' "rounded up", and its staff-post overhead.
  - Tattle-Tale's patrol cap.
  - Thick Skin's window clause, and its "A card that pays more for the same reaction still pays".
- **Strategy Guide:**
  - "and the tile shows the wait";
  - the settlement summary that opens by itself;
  - the halving, reworded;
  - "every place it can land lights up";
  - "If the room can't decide, it stays Pepperoni";
  - the three frames described;
  - the retired-character clause;
  - "the form tells you how short";
  - punctuation at a phrase's ends;
  - "through code, a link or an image".
- **Settings:**
  - High contrast's "The smoke stays at the edges of the screen";
  - Smoke's "Off leaves plain black";
  - "the three steps of" the tour;
  - Tilt's fallback lights;
  - Text size's "folds into one column";
  - the caption's "at the bottom of the screen".
- **Log:**
  - the played row's "a post of one of your own characters" and "The card was paid for at the machine";
  - the estimate line's halving, reworded;
  - Autocorrect's peeled-clean line, "An edit that brings the phrase back brings a strip with it".

**One accuracy fix found on the way.** The Guide says the Lens names "who quoted if you used Only these". `sprungWords`
(`engine/ui/cards/lens-words.ts`) names the quoter on every quote spring, whatever the Who. The sentence draws a limit
that does not exist, so the glass is bluffing about how the game works. It becomes "and who quoted".

**One tidy found on the way.** Time Machine's summary types "3 days" and "rare" where every other card reads them from
its rules, so a retune would make it false. It reads them from `timeMachine.lasts` and `timeMachine.rewind.upTo`.

## 8. What stays, and why

Each of these was a candidate and is kept by the test:

- **How a state ends, and who it is for:**
  - Graffiti's and Below the Fold's "which lasts until they leave the page";
  - Stick Around's ways out;
  - Hot Box's haze and its airing-out;
  - every set card's "springs once, or ends by itself after".
- **What is private:**
  - Whodunnit's "Anyone who read it before remembers";
  - the set cards' "Everyone sees a card back there";
  - Cheap Shot's "only you are told";
  - Glitter Bomb's "It falls on that mask alone";
  - Off Day's "everyone can see which";
  - the Guide's privacy lines;
  - the log's "Who reacted is never shown".
- **Planning:**
  - FIRST_REACTORS, which says to play it before the pile-on;
  - Class Clown's first-reaction rule, the owner's answer on #778;
  - Feelin' Glam's "takes none of a post's three Feelin' Fab places";
  - Ultra Happy Heart's next-ban clause;
  - Jimmy Wails' full-wallet loss;
  - Blind Study's "Settlement counts every reaction";
  - Last Word's "a reply without the quote always goes through";
  - "and turns tips on" in Settings.
- **Choosing a setting:**
  - "at least 7:1";
  - "Text is readable at every setting";
  - "shown as a caption";
  - "as on a classic forum".
- **The log's "Toll landed as usual, and its caster keeps what it earns".** It answers "did I take this from them?".
- **The forgivable omochao:** the tips, the hints, and the Guide's "under Edit profile on My characters".
- **The refusals.** "a Laugh Track never cues a link" says why a phrase was refused. The appeal refusal's "each
  punishment is appealed once" is not reached in play, since the barred box says the move was appealed. Changing it
  would cost a migration for a string no player reads.

## 9. Where the honesty rules and the cut pull apart

The question was put to the owner as Q3, and sections 4 and 5 are their answer. Two places come nearest:

- **The forecast's "up to".** The halving is a real reason the forecast runs high. Cutting the term without a reason
  would leave the Guide's "up to" half explained. So the reason stays in plain words, and no number or unexplained
  term is used.
- **The log.** Its played row loses only the clauses that tell the player what they already know. It still names the
  card, the character, the post and the Aura the play cost. Nothing about what was done is cut.

## 10. Layers

- Cards, the Strategy Guide, gabe.md and the Autocorrect log line are Divided World's.
- Settings, Appearance, the log's lines and the spec are the engine's, and `specs/player-copy.md` names no instance.
- No interface changes.

## 11. Masks, ways out, releases

- **Masks:** no response, payload, event or timing changes. Only the words change.
- **Ways out:** no state is added. Every way out a description named is kept.
- **Releases:** no setting changes shape.
