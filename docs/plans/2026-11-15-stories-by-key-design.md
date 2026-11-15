# Stories pick their cards by key: design

Record, written 2026-11-15. The first two checklist items of issue #705, and its fifth. Its plan is
`docs/plans/2026-11-15-stories-by-key-plan.md`.

## 0. What the owner decided before this session

Relayed by the session that started this one, and not asked again:

1. The stories are fixed now, before the first card build of the Base Set (`docs/plans/2026-11-14-base-set-design.md`).
2. Each story picks its cards by key, and throws naming the key when the instance has no such card, as the stories
   fixed in PR #699 do (`engine/ui/cards/Marks.board.stories.tsx`, commit `985d64a9`).
3. Each story keeps drawing exactly the cards it draws today, so no board manifest and no spec changes.
4. The order of the picker in `engine/ui/cards/PlayForm.tsx` is issue #704's, not this design's.

## 1. Why

`instance.cards` is sorted by key since PR #699. A story that takes `instance.cards[0]`, or "the first card that
reaches a character", draws whatever card the list yields today. A card build adds one line to that list. A new card
that sorts first, or is the first of its kind, then changes what an engine story draws, and a board match or an e2e
spec that reads the story goes red in a build that may touch no engine file (the Base Set design, section 3). Three
stories broke that way during the seams build. Card builds run side by side, so the break would also land on whichever
build merged second, with nothing in its own diff to explain it.

## 2. Every spot, and the card it draws today

Found by reading every `*.stories.tsx`, `*-world.ts` and `engine/ui/story.tsx` under `engine/` and `instances/`, then
resolved against `origin/main` at `c6ca737e` (36 cards) by loading the instance and running each story's own
predicate. `#705` marks the spots the issue lists; the others were found here.

| Spot | How it picks today | Card today |
| --- | --- | --- |
| `engine/ui/story.tsx:32` (`playerWorld`) #705 | `cards[0]`, else the literal `'card'` | `4d-chess` |
| `engine/ui/frame/Hud.board.stories.tsx:18` #705 | `cards[0]`, else `'card'` | `4d-chess` |
| `engine/ui/profile/Profile.stories.tsx:25` #705 | `cards[0]` | `4d-chess` |
| `engine/ui/profile/spritey-world.ts:21` #705 | `cards[0]` | `4d-chess` |
| `engine/ui/spin/Spin.stories.tsx:76` #705 | `cards[0]` | `4d-chess` |
| `engine/ui/spin/Spin.stories.tsx:89` #705 | first that reaches a character | `class-clown` |
| `engine/ui/events/RandomEvent.stories.tsx:25` #705 | first that is not common, else `cards[0]` | `4d-chess` |
| `engine/ui/frame/HandArc.stories.tsx:25`, `hand(3)` #705 | `cards.slice(0, 3)`, held 1, 2, 3 | `4d-chess` 1, `autocorrect` 2, `below-the-fold` 3 |
| `engine/ui/frame/HandArc.stories.tsx:40`, `Arm nth={1}` #705 | `cards[1]` | `autocorrect` |
| `engine/ui/cards/PlayForm.stories.tsx:27`, scenes `play`, `set`, `conditions` #705 | first Cast with a `ConfigForm` | `autocorrect` |
| the same line, scene `gimmick` #705 | first Set with a `ConfigForm` and a cast trap | `4d-chess` |
| `engine/ui/cards/Reach.board.stories.tsx:58`, scenes `character`, `still`, `armed` | first that reaches a character | `class-clown` |
| the same line, scene `first` | the same, with a hint | `happy-heart` |
| `engine/ui/cards/Reach.board.stories.tsx:59`, scene `thread` #705 | first that reaches a thread | `feelin-glam` |
| the same line, scene `pinned` #705 | the same, and pins | `main-event` |
| `engine/ui/cards/Reach.board.stories.tsx:80` (`ArmCharacter`) #705 | first that reaches a character | `class-clown` |
| `engine/ui/cards/ReactionForm.board.stories.tsx:22,44` #705 | first reaction card | `overreaction` |
| `engine/ui/cards/Payouts.board.stories.tsx:23`, `skim`, `skimForm` #705 | first with a skim | `mooch` |
| `:24`, `ride` #705 | first ride gimmick | `toll` |
| `:25`, `rideBack`, `rideBackForm` #705 | first Set whose trap has an outcome | `4d-chess` |
| `:26`, `scoredAs`, `scoredAsForm` #705 | first that scores as | `off-day` |
| `engine/ui/cards/Discipline.board.stories.tsx:24`, `heart` #705 | first relief | `happy-heart` |
| the same line, `toldOn` #705 | first watch | `tattle-tale` |
| the same line, `fallWaiting`, `fallTaken` #705 | first fall | `take-the-fall` |
| `engine/ui/thread/Under.board.stories.tsx:47` | first that replies | `line-cutter` |
| `engine/ui/thread/Veils.board.stories.tsx:47` | first author veil | `whodunnit` |
| `:48` | first totals veil | `blind-study` |
| `:49` | first reaction card | `overreaction` |
| `engine/ui/vending/Packs.board.stories.tsx:28-29` (the hand) #705 | `const [first, second] = instance.cards` | `4d-chess` 1, `autocorrect` 1 |
| `:48` (the pack's four commons) #705 | the first four commons | `autocorrect`, `below-the-fold`, `feelin-fab`, `hype-up` |
| `:49` (the hit) #705 | `main-event` by key, then two silent fallbacks | `main-event` |
| `engine/ui/cards/Armed.board.stories.tsx:26` | the card named "Whoops!" | `whoops` |
| `engine/ui/cards/Marks.board.stories.tsx:188` | `ui.cards.find` by key and `takeover` | `stick-around` |
| `engine/ui/alerts/Alerts.board.stories.tsx:28` | `.find` by key, its own throw | `4d-chess` |
| `instances/divided-world/ui/whoops/Lens.board.stories.tsx:67,68,99,158` | by name | `whoops`, `stick-around`, `force-field`, `autocorrect`, `glitter-bomb` |
| `engine/ui/alerts/Alerts.board.stories.tsx:17-18` (classes) #705 | `classes[0]`, `classes[1]` | `face`, `heel` |

The last five card rows are not by place: a name or a key already holds them still. They are in the list because the
check of section 4 allows one way to pick a card, and they are moved to it.

`tools/rehearse/`, `e2e/` and `web/src/data/fixtures/` hold no pick by place. The fixtures and specs name cards by
key, and `e2e/focus.spec.ts` and `e2e/hand-arc.spec.ts` index the cards drawn on the page, which is the hand the
fixture seeded. `supabase/functions/_shared/seed.test.ts` spreads `instance.cards[0]` as a template and overrides its
key and every field it asserts on; it is not a story and no card changes it.

### Left as they are, each weighed

- **Stories whose subject is the whole pool** (`HandArc`'s `EveryKind` family, `Postcard.stories.tsx`'s `Faces`, the
  Guide and the Vending Machine): a new card is meant to appear in them. `hand(null)` keeps holding every card with
  one to three copies down the list. No e2e spec reads the `EveryKind` stories.
- **`engine/ui/cards/Hand.board.stories.tsx:36-40`**: "the second card in the hand" is a place in the hand the
  boards fixture seeds by key, not in the instance's list. A new card is not in that hand.
- **Classes picked by place in 46 other story files** (`instance.classes[0]` and its kin). Item 2 of #705 names
  Alerts alone, no plan on the roadmap adds or reorders a class, and the classes list is not sorted, so a new class
  would be appended and change none of them. Open for the owner, section 6.
- **`instance.gear[0]` and the first event line of an outcome in `RandomEvent.stories.tsx`**: not cards; the gear
  list is hand-ordered and no plan on the roadmap adds gear. Left, and named in section 6.

## 3. How an engine story names a key

**Decided (the owner's item 2): a string literal in the story file, checked against the instance the story is
handed.** Each story file names its keys as constants at its top (`const REACTION = 'overreaction';`) and looks each
up through one helper in `engine/ui/story.tsx`:

```ts
/** The instance's card of this key; the story fails, naming it, when the instance has none. */
export function cardOf<T extends { readonly key: string }>(cards: readonly T[], key: string): T
/** The instance's class of this key, the same way. */
export function classOf<T extends { readonly key: string }>(classes: readonly T[], key: string): T
```

The error is the one the fixed stories throw: `the instance has no card "<key>", which this story names`. The three
copies of that lookup (`known()` in `Marks.board.stories.tsx`, `card()` in `Backs.board.stories.tsx` and
`Gimmicks.stories.tsx`) become this one, which is #705's fifth item. `cardOf` takes `instance.cards` or `ui.cards`.

**The boundary stays green.** `tools/check-engine-boundary.mjs` reads imports, re-exports, `import()`, `require`,
globs and filesystem paths from the AST; a string that is a card's key is none of those, and the stories fixed in
PR #699 already pass it. No engine file imports an instance, and the engine's product code still names no card: only
story files do, and they render only where a composition root hands them Divided World (`.storybook/preview.tsx`,
`web/a11y-stories.tsx`, `web/src/data/fixtures/stories.tsx`, two `web/*.test.tsx`). No test renders a story against
the engine's test instance, so a throw on a missing key reaches no test that passes today.

**A silent skip becomes a throw.** Several stories return quietly, or draw an emptier scene, when the instance has no
card of the kind (`Spin`'s `reachWorld`, `Reach`, `Under`'s "missing", `Veils`, `ReactionForm`, `Packs`' fallbacks).
With a key named, a missing card is a story that names something gone, and it fails saying which.

Weighed and not chosen:

- **Move these stories into the instance** (`instances/divided-world/ui/`), where a key is the instance's own word,
  as the Lens stories already live. This is where they belong on the day the engine moves to its own repository
  (CLAUDE.md, "KayfaBB never knows which instance it runs"). It moves about thirty files and their board manifests'
  story ids, and the owner chose keys in place. Named in section 6 as what that move will have to do.
- **A cast list the instance supplies** (`{ reaction: 'overreaction', … }` through an engine interface, the story
  naming a part and never a card). The engine would name no key, but every new story adds a line to one shared
  instance file, which is the seam PR #699 removed, and the interface would carry test content only.
- **Keep the predicates and sort the pick by something stable.** No ordering is stable under a card that is the new
  first of its kind.

## 4. The check

**Decided: add one.** `tools/check-story-picks.mjs`, with `tools/test-story-picks.mjs` driving it red, both in
`STEPS` in `tools/build.mjs` beside the engine-boundary pair.

Why it is worth it: the failure it prevents shows up in someone else's build. A story written next month with
`instance.cards[0]` passes its own PR and turns red a later card build that may not edit it. Review will not hold
that across 52 cards and several engine plans; a build step will. The cost is one AST walk over about 110 files.

What it reads: every tracked `*.stories.tsx` and `*-world.ts` under `engine/` and `instances/`, and
`engine/ui/story.tsx`. Test files are not read (a test builds its own cards).

What it refuses: in those files, an instance's pool of cards is `X.cards` where `X` ends in `instance` or `ui`
(`instance.cards`, `ui.cards`, `kayfa.instance.cards`, `kayfa.ui.cards`). The pool may be used whole, and nothing
else:

- as an argument of a call (`cardOf(instance.cards, KEY)`, `facesOf(instance.cards, ui.cards, …)`);
- as the iterable of a `for … of`;
- as the receiver of `.map`, `.forEach`, `.some` or `.every`;
- spread into an array (`[...kayfa.ui.cards, RUMBLE_UI]`), or as an element of an array literal (a hook's
  dependency list).

Every other use is a fault that names the file, the line and the way to write it (`cardOf(instance.cards, '<key>')`):
an index, an array or object destructuring, `.find`, `.filter`, `.slice`, `.at`, `.length`, an assignment to another
name. A list of allowed uses was chosen over a list of refused ones because a refused list misses the next way to
take the first of something.

What it cannot see, said in its header: a helper that receives the pool as an argument and indexes its own parameter,
and `instance.cards.map(…)[0]`. The first is how `Payouts` and `Discipline` pick today (`found(cards, scene)`); the
plan removes both, and the check's header says a story's helper takes a key, never the pool. Following arguments into
functions was weighed and left out: it is most of a type checker for one more case.

It does not cover classes (section 2, left as they are), and it reads no database, so "A test that builds its own
subject" has nothing to say here.

## 5. The rules this touches

- **Engine and instance.** The helper and the check are engine and tooling. The keys named in engine stories are
  Divided World's; they are strings, checked at run time against the instance handed in. One instance file changes
  (`Lens.board.stories.tsx`, from names to keys).
- **No screen, no state, no response.** Nothing a player sees changes; no state is added; nothing is computed from a
  private fact. No migration.
- **Scale.** A story's cost does not grow with the pool: a lookup by key replaces a scan for the first match.

## 6. Open for the owner

1. **Classes by place in 46 other story files.** Not asked for and not in the plan. If a later plan adds a class,
   that plan should move them to `classOf` and extend the check to `instance.classes`; say if you want it done now
   instead.
2. **`instance.gear[0]` in `RandomEvent.stories.tsx`** is read by the board `boards-00-random-event--gear-found`.
   The same hazard exists the day a plan adds gear that sorts or is listed first. Not in the plan.
3. **When the engine moves to its own repository**, every engine story that names a Divided World key has to move to
   the instance or name a card of the engine's own test instance. That is true of the stories PR #699 fixed as well,
   and this design adds about fifteen files to that list.
