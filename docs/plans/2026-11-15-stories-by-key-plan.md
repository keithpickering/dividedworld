# Stories pick their cards by key: plan

Record, written 2026-11-15. Carries out `docs/plans/2026-11-15-stories-by-key-design.md` (its sections are cited as
§N), task by task. It covers the first, second and fifth checklist items of issue #705; the build's PR links #705 as a
checklist and does not close it (items 3 and 4 remain).

All of it is engine stories, one engine helper, one tool pair and one instance story file. No product code, no
migration, no database, no screen, no state a player, a character or a post can be put in, and no response computed
from a private fact. Engine or instance, by part: `engine/ui/story.tsx` and every `engine/ui/**` story are engine;
`instances/divided-world/ui/whoops/Lens.board.stories.tsx` is the instance's; `tools/` is neither. The keys an engine
story names are strings checked against the instance it is handed (§3); no engine file imports an instance.

**What must not change:** no file under `e2e/` and no board manifest. `git diff --stat origin/main -- e2e/` is empty at
the end. If a spec or a board goes red, the story is wrong: find which card it drew before and name that one.

**If main has moved:** §2's table was resolved at `c6ca737e` with 36 cards. If
`instances/divided-world/cards/index.ts` has changed since, resolve each row again before editing (run the predicate
in the table's "How it picks today" column against `instance.cards` as it stands on the commit before this build) and
name what it yields then; say so in the PR.

Commits: Task 1 is one commit. Tasks 2 to 5 are one commit, because `tools/build.mjs` refuses a check that is not in
`STEPS`, and the check is red until the stories are moved.

## Task 1. One lookup, in `engine/ui/story.tsx` (§3)

Model: sonnet

Test first, `engine/ui/story.test.tsx` (vitest, `npm run test:ui`): `cardOf` returns the entry whose key matches,
from a list of rules and from a list of looks; it throws `the instance has no card "nope", which this story names`
for a key the list lacks; `classOf` throws `the instance has no class "nope", which this story names`. Red run: the
functions do not exist. Record it.

Then, in `engine/ui/story.tsx`:

```ts
function keyed<T extends { readonly key: string }>(list: readonly T[], key: string, what: string): T {
  const found = list.find((entry) => entry.key === key);
  if (!found) throw new Error(`the instance has no ${what} "${key}", which this story names`);
  return found;
}
/** The instance's card of this key; the story fails, naming it, when the instance has none. */
export function cardOf<T extends { readonly key: string }>(cards: readonly T[], key: string): T { return keyed(cards, key, 'card'); }
/** The instance's class of this key, the same way. */
export function classOf<T extends { readonly key: string }>(classes: readonly T[], key: string): T { return keyed(classes, key, 'class'); }
```

The file's header says a story "never names an instance"; reword it: a story imports no instance, and where it must
draw one particular card it names the card's key and fails if the instance it is handed has none (§3).

Replace the three copies with `cardOf`: `known()` in `engine/ui/cards/Marks.board.stories.tsx` (it returns the key, so
its callers take `.key`), `card()` in `engine/ui/cards/Backs.board.stories.tsx` and in
`engine/ui/cards/Gimmicks.stories.tsx`. Green: `npm run typecheck`, `npm run test:ui`.

## Task 2. The check and its self-test, red on the tree (§4)

Model: sonnet

Read `tools/check-engine-boundary.mjs` and `tools/test-engine-boundary.mjs` first and follow their manner: the
TypeScript AST, an exported pure function the test calls (`storyPickFaults(files)` over `{ path, text }` entries, and
the tree reader beside it), a header that says what the guard holds and what it cannot see (§4's last paragraphs).

`tools/test-story-picks.mjs` first. Each poison is a planted file the check must name, with its line:

1. `instance.cards[0]`
2. `const [first, second] = instance.cards;`
3. `const { cards } = instance;`
4. `instance.cards.find((c) => c.reaction === true)`
5. `instance.cards.find((c) => c.key === 'whoops')` (by key, but not through `cardOf`)
6. `instance.cards.filter((c) => c.rarity === 'common')`
7. `instance.cards.slice(0, 3)`
8. `kayfa.ui.cards.at(-1)`
9. `instance.cards.length`
10. `const pool = instance.cards;`
11. a pick in a `*-world.ts` file, and one in a path ending `engine/ui/story.tsx`
12. a pick in a story under `instances/<name>/`

Each clean case must stay clean: `cardOf(instance.cards, KEY)`; `facesOf(instance.cards, ui.cards, settings)`;
`for (const c of instance.cards)`; `instance.cards.map(…)`, `.forEach(…)`, `.some(…)`, `.every(…)`;
`[...kayfa.ui.cards, EXTRA]`; `[instance, ui.cards]` as a dependency list; `player.cards.find(…)` and
`log.cards.filter(…)` (not an instance's pool); the same picks in `X.test.tsx` and in a file that is neither a story
nor a world; `instance.cards[0]` inside a comment and inside a string. The last case runs the check over the real
tree and expects it clean, as the boundary test does.

Then `tools/check-story-picks.mjs`. A fault's message names the file, the line, the use, and the way to write it:
`pick the card by key: cardOf(instance.cards, '<key>') (engine/ui/story.tsx)`.

Red run to record: every poison fires, and the check over the real tree lists the spots of §2's table (and only
those; anything else it lists is either a spot the survey missed, which is then moved in Task 3 or 4 and named in the
PR, or a use the check should allow, which is a question for the PR, not a quiet widening of the list).

## Task 3. The worlds name their cards (§2)

Model: sonnet

Each file names its keys as constants at its top, with a one-line comment saying what the card is to the story, and
looks them up with `cardOf` (`classOf` for Alerts). The keys are §2's; nothing else about what each story seeds
changes. The `?? 'card'` fallbacks and the `if (first && second)` guards go: a missing card throws.

- `engine/ui/story.tsx` `playerWorld`: `4d-chess`, 2 held.
- `engine/ui/frame/Hud.board.stories.tsx`: `4d-chess`, 3 held.
- `engine/ui/profile/Profile.stories.tsx`, `engine/ui/profile/spritey-world.ts`: `4d-chess`.
- `engine/ui/spin/Spin.stories.tsx`: `world` plays `4d-chess`; `reachWorld` casts `class-clown`, and its
  `if (!card) return;` and the header's "With no such card in the instance, nothing is spun" go.
- `engine/ui/events/RandomEvent.stories.tsx`: the found card is `4d-chess`. `instance.gear[0]` and the line stay
  (§2, left as they are).
- `engine/ui/frame/HandArc.stories.tsx`: `hand` takes the keys to hold or `null`.
  `hand(['4d-chess', 'autocorrect', 'below-the-fold'])` holds 1, 2 and 3 in that order; `hand(null)` holds every
  card, 1 to 3 down the list, with `instance.cards.forEach`. `Arm` takes a key or `null` in place of `nth`; the four
  armed stories pass `autocorrect`. The header's "the engine names none" is reworded: the three-kind hand names its
  cards, the every-kind hand follows the pool.
- `engine/ui/vending/Packs.board.stories.tsx`: the hand is `4d-chess` and `autocorrect`, one each; the pack's answer
  is `autocorrect`, `below-the-fold`, `feelin-fab`, `hype-up`, then `main-event`, each through `cardOf`, with no
  fallback. The header's "picked by rarity and place in the instance's order" is reworded.
- `engine/ui/alerts/Alerts.board.stories.tsx`: `cls` is `classOf(instance.classes, 'face').key`, `other` is
  `classOf(instance.classes, 'heel').key`; its card lookup at line 28 becomes `cardOf`.

Green: the check no longer lists these files; `npm run typecheck`.

## Task 4. The scene stories name their cards (§2)

Model: sonnet

The same manner, a constant for each key and `cardOf`. A helper that took the pool and a scene takes the scene and
answers a key.

- `engine/ui/cards/PlayForm.stories.tsx`: scenes `play`, `set` and `conditions` open `autocorrect`; `gimmick` opens
  `4d-chess`. `withForm` goes.
- `engine/ui/cards/Reach.board.stories.tsx`: `onCharacter` is `happy-heart` for scene `first` and `class-clown`
  otherwise; `onThread` is `main-event` for `pinned` and `feelin-glam` otherwise; `ArmCharacter` arms `class-clown`.
  Look each up only in the scenes that use it, so no scene throws over a card it does not draw. The `&& onCharacter`
  and `&& onThread` guards go.
- `engine/ui/cards/ReactionForm.board.stories.tsx`: `overreaction`, in both places.
- `engine/ui/cards/Payouts.board.stories.tsx`: `found` becomes a map from scene to key: `skim` and `skimForm`
  `mooch`; `ride` `toll`; `rideBack` and `rideBackForm` `4d-chess`; `scoredAs` and `scoredAsForm` `off-day`.
- `engine/ui/cards/Discipline.board.stories.tsx`: `heart` `happy-heart`; `toldOn` `tattle-tale`; `fallWaiting` and
  `fallTaken` `take-the-fall`.
- `engine/ui/thread/Under.board.stories.tsx`: `line-cutter`. Its `'missing'` state is reached only where the
  instance had no such card; read what else sets it before removing it, and keep it if the fixture's thread can also
  be missing.
- `engine/ui/thread/Veils.board.stories.tsx`: `whodunnit` (author), `blind-study` (totals), `overreaction`; the
  `if (author)` guards and the `flatMap` over maybe-missing cards go.
- `engine/ui/cards/Armed.board.stories.tsx`: `whoops`, by key where it read the name.
- `engine/ui/cards/Marks.board.stories.tsx:188`: `cardOf(ui.cards, TAKEOVER)`, then its own throw if that card's
  `takeover` is not true.
- `instances/divided-world/ui/whoops/Lens.board.stories.tsx`: `whoops` and `stick-around` where it reads "Whoops!"
  and "Stick Around"; the five-kinds loop names `force-field`, `autocorrect`, `glitter-bomb` in that order.

Each file's header comment that says the story draws "the instance's first card that …", or that the engine names
none, is reworded to say the cards are named by key.

Green: the check over the tree is clean.

## Task 5. Wire the check in, and prove nothing moved

Model: inline

In `tools/build.mjs`, add `'node tools/test-story-picks.mjs'` then `'node tools/check-story-picks.mjs'` to `STEPS`,
directly after the engine-boundary pair. Then, with the output in the PR:

- `npm run typecheck` and `npm run build`: green, the two new steps among them, `check-engine-boundary` green.
- `npm run test:e2e`: green.
- `git diff --stat origin/main -- e2e/`: empty.
- The poison, once, not committed: put `instance.cards[0]` back in `engine/ui/story.tsx`; `npm run build` fails at
  `check-story-picks` naming the line. Revert.

In the PR, tick items 1, 2 and 5 of #705 by link (`Part of #705`), and list anything Task 2's red run found beyond
§2's table.

## Review focus

- Whether each story draws the card it drew before: a wrong key in a story no spec reads (`Spin`, `Profile`,
  `HandArc`, `PlayForm`, `Payouts`, `Discipline`, `Veils`, `Under`) passes every test. Compare each against §2's
  table, and against the list at the build's base commit if main moved.
- Throws where a story used to skip: a scene that now looks up a card it does not draw fails for no reason. In
  `Reach` and `Payouts` each scene should look up only its own card.
- The a11y sweep (`web/a11y-stories.tsx`) renders every story: a story that throws in render or in an effect must
  fail there, not log to the console and pass. Several seeders end in `.catch(console.error)`; check that a missing
  key is still seen by something.
- The check's reach: a helper that takes the pool as a parameter and indexes it is not seen (§4). After the build,
  no story helper should take the pool except `cardOf` and the engine's own functions (`facesOf`).
- The allowed list in the check: anything added to it during the build beyond §4's four uses needs its reason in the
  PR.
- A second card build running beside this one: none should be, since this lands first; if main gained a card
  meanwhile, the table was resolved again.
