# Autocorrect: plan

Record, written 2026-11-03. The plan for `docs/plans/2026-11-03-autocorrect-design.md`. It is built by one build session in
one PR, from `main`. The PR says `Closes #150`. It does not build the onboarding plan's Task 11, the Jabroni's starter
grant (`docs/plans/2026-11-02-onboarding-plan.md`), which that plan's own build takes up once this has merged.

Every task is test first: the test named, its red run recorded, then the code. No `check-*.mjs` is added.

**The boundary check holds:** nothing in `engine/` or `supabase/` names Autocorrect. The engine gains the text layer and
the post's text and version for every card. It reads `pepperoni` as an alignment, as it already reads `sweet` and `salty`.

**One migration:** `supabase/migrations/0067_autocorrect.sql`, with its SQL test `supabase/tests/0071-autocorrect.sql`, run
against Postgres on localhost. If other work has taken these numbers by the time this is built, use the next free ones.

## Task 1. A post's visible text (engine)

**Files:** `engine/bbcode/visible.ts` (new); test `engine/bbcode/visible.test.ts` (new).

`visibleText(nodes: readonly BbNode[]): string` walks the tree that `parse` makes, in the order the renderer draws it.

- **Kept:** the `text` nodes inside bold, italic, underline, strike, color, size and list items.
- **Left out:** quotes, code, links (a link's words are its own target's) and images. Each one leaves a single `\n` in
  its place, so no word is joined across it.
- **Between list items:** a `\n`.

The offsets into this string are the ones the text layer (Task 3) and every matcher use. One walk, never recursion, with
the parser's own `MAX_DEPTH` bounding it.

Tests first:
- Bold across a word ("ca[b]ts[/b]") reads "cats".
- A quote's words and a link's words are absent, with a `\n` in their place.
- A list's items are separated.
- The walk order matches `render.tsx`'s, shown by Task 3's test.

## Task 2. The post's text and version, and a stale play refused (SQL, engine, Edge Function)

**Files:**
- `supabase/migrations/0067_autocorrect.sql` (new)
- `engine/rules/cards.ts` (`PostTarget`)
- `supabase/functions/act/core.ts`
- tests `supabase/tests/0071-autocorrect.sql` (new) and `supabase/functions/act/core.test.ts`

**SQL.**
- `card_target(target)` adds two fields to what it returns:
  - `body`: `current_payload ->> 'body'`
  - `version`: the latest edit's id, or the post's own id when it has none (the lateral that `acts_public` uses, `0022_edit_grace.sql`)
- `play_card` gains `version uuid default null`. For a post reach given a version, it refuses in plain words when that is
  no longer the post's current version: "the post was edited; look again". It takes the lock on the post that it already
  takes, before reading.
- Re-grant the new signature as `0058_alerts.sql` grants the current one.

**Engine.** `PostTarget` gains `text: string` (the visible text, through Task 1) and `version: string`. `core.ts` builds
`text` from `body` with `visibleText(parse(body))`, and passes `version` to `play_card` for a post reach.

**Fixtures.** Every fixture that builds a post target gains the two fields. `card_target_reach` passes them through
unchanged.

Tests first:
- SQL: a play decided before an edit is refused, and one decided after it lands.
- SQL: `version` is the post's own id until the first edit.
- `core.test.ts`: `play_card` is called with the version read.
- The existing `play_card` tests pass with no version given, which skips the check for the reaches beyond a post.

## Task 3. Text layers in the renderer (engine)

**Files:** `engine/ui/bbcode/render.tsx`, `engine/ui/bbcode/layers.tsx` (new), `engine/ui/cards/types.ts` (docs on
`EffectProps`); test `engine/ui/bbcode/render.test.tsx`.

- `TextLayers`, a context: a list of runs over visible-text offsets, each with:
  - `from`, `to`, `key` and `z` (its order in the stack)
  - `render(run: { text: string; pieces: ReactNode }) => ReactNode`
- `<TextLayer runs>` appends its runs to any layers above it, so nested effects combine.
- **The renderer** walks in `visibleText`'s order and keeps the offset as it goes:
  - Where a run starts, it draws `render` once for the whole run, given the run's plain text and its pieces as the
    renderer would have drawn them, and skips the rest of the run, even across formatting.
  - Where runs overlap, the run with the higher `z` is drawn, and the lower one draws only the part outside it.
- No layers means the output is unchanged: the current snapshot tests pass as they are.

Tests first:
- A run over "ca[b]ts[/b]" draws once.
- An overlapping higher run wins.
- A run never starts inside a quote.
- Rendering with no layers is unchanged.
- The offsets agree with `visibleText` on a post that holds every node type.

## Task 4. The room decides (engine settlement, instance classes)

**Files:** `engine/rules/types.ts` (`PlayedCard`, `LandedCard`), `engine/rules/settle.ts`,
`instances/divided-world/classes/heel.ts`, `jabroni.ts`, `face.ts`; tests `engine/rules/settle.test.ts`,
`engine/rules/settle.scale.test.ts`, `instances/divided-world/classes/classes.test.ts`.

**The type.** `PlayedCard` and `LandedCard` gain `readsAs: Alignment`.
- For Sweet and Salty cards, `readsAs` is the card's own alignment.
- For a Pepperoni card, it is the lean of other players' vote shares on the play in the window: positive is
  excited-positive plus calm-positive, and negative is excited-negative plus bored-negative. Shares are summed with
  `tidy`, as the existing sums are. A tie stays `pepperoni`.

**`settle.ts`.**
- Compute each play's `readsAs` first, from `windowVotesOn`.
- Key `holder` by `readsAs`, so a player's Sweet card and their Pepperoni card read as Sweet on one post pay once.
- A play from an earlier window is keyed by the alignment it reads as in this window.

**The classes.** Heel's `stoleThunder`, Jabroni's `soldTheL` and Face's `liftedAPost` filter on `readsAs`. Face's
`stoleThunder` stays on any card.

Tests first:
- A Pepperoni card drawing groans on a Jabroni's post pays `jabroni.soldTheL`.
- One drawing heat that outdraws pays a Heel `heel.stoleThunder`.
- One drawing cheers on another's post pays a Face `face.liftedAPost`.
- A tie pays none of them.
- Votes from the caster's own player do not move the lean.
- A Sweet card and a Pepperoni card read as Sweet by one player on one post pay one `liftedAPost`.
- The existing fixtures, where no Pepperoni play draws reactions, are unchanged.
- The scale test stays within its bound.

## Task 5. The card's rules (instance)

**Files:** `instances/divided-world/cards/autocorrect.ts` (new), `instances/divided-world/cards/autocorrect/match.ts`
(new), `instances/divided-world/cards/index.ts`, `instances/divided-world/settings.ts`; tests
`instances/divided-world/cards/autocorrect/match.test.ts` (new), `instances/divided-world/cards/cards.test.ts`.

**`match.ts`.** `occurrences(text, phrase): { from: number; to: number }[]` is a regex over the escaped phrase with flags
`giu`. It has a `(?<![\p{L}\p{N}])` guard before and a `(?![\p{L}\p{N}])` guard after. Occurrences never overlap, and are
returned in order. It is shared by the rules and the Effect.

**`autocorrect.ts`.** `CardRules<{ phrase: string; replacement: string }>`:
- **The card:** `key: 'autocorrect'`, `name: 'Autocorrect'`, Pepperoni, common, a Cast, `stack: 3`, and
  `priceKey: 'autocorrect.price'`.
- **`reads`:** `autocorrect.perVolume`, `autocorrect.volumeStep` and `autocorrect.mostInAll`.
- **`validateConfig`:**
  - Trim both.
  - The phrase is 4 to 100 characters, with at least 4 that are `\p{L}` or `\p{N}`.
  - The replacement is 1 to 100 characters, plain text, and not the phrase, compared case-folded.
  - Each refusal names the bound it failed.
  - BBCode in the replacement is kept as text: it is drawn as a string, never parsed.
- **`canApply`:** `landsOn`, then a refusal when `occurrences(target.text, phrase)` is empty. The config must be visible
  to it, so `canApply` gains an optional third argument, the checked config. `decided` in `engine/rules/cards.ts` calls
  `validateConfig` first and passes the result. Every other card ignores it.
- **`playPrice`:** `min(perVolume × floor(volume / volumeStep), mostInAll − base)`, where the volume is the occurrences
  times the phrase's length in characters.
- **`validateState`:** `{ peeled: number[]; clean?: boolean }`. The peeled indexes are unique whole numbers from 0 to
  1999, sorted on the way out. More than 2000 is refused.
- **`settings.ts`:**
  - `autocorrect.price` 100
  - `autocorrect.perVolume` 25
  - `autocorrect.volumeStep` 50
  - `autocorrect.mostInAll` 300
  - `cardSettings['autocorrect.peelMs']` 700, read by the screens through `screenReads`

Tests first:
- Each bound, driven red by a config one past it.
- "cats" covers "Cats." and "CATS" but not "concatenate" or "cats" inside a quote.
- Accented and non-Latin words match whole.
- The price at 0, 1 and many steps, and at the cap.
- A phrase not in the post is refused.
- The instance passes `instanceProblems`.
- The largest state fits `effect_state`'s bound, measured as Postgres writes it, as `cards.test.ts` measures Whoops!.

## Task 6. The strip, the peel and the fall (instance screens)

**Files:** `instances/divided-world/cards/autocorrect/Effect.tsx`, `autocorrect.css`, `peel.ts` and `fall.ts` (new), and
`ConfigForm.tsx` (new); tests `Effect.test.tsx`, `peel.test.ts` and `ConfigForm.test.tsx` beside them.

**The Effect.** It gives one `<TextLayer>` for all its plays on the post.
- Each play's occurrences in `visibleText(parse(post body))` are runs, with `z` by play order. Saved author peels and this
  screen's peels are left out.
- A run's strip:
  - It is a `<button>` drawn as label tape: off-white, torn ends, a faint shadow, and a tilt of about 1° seeded by the
    play and the occurrence so it is the same on every screen. The replacement is in Courier.
  - Its box is an inline grid with the covered pieces (`visibility: hidden; aria-hidden`) and the replacement in one cell,
    so it takes the wider of the two.
  - A run longer than the line wraps as tape broken across lines (`box-decoration-break: clone`), as the design leaves to
    the owner's eye on the shots.
  - Its accessible name is "Autocorrected text: “{replacement}”. Hold Enter or Space to peel".
- A peeled run is drawn as its pieces with the adhesive band behind them (`.kb-ac-adhesive`).

**`peel.ts`** is pure, so it can be tested.
- A drag past the threshold peels, and the threshold is twice the strip's height, at least 24 px. Short of it, the strip
  settles back.
- A hold of `cardSettings['autocorrect.peelMs']` peels, and a release before it settles back.
- On an overlap, the top strip goes first.

**Saving.** The post's author's peels are saved debounced through `save`, as Whoops!'s are, with the one-save-at-a-time
rule and its backoff. `clean: true` is saved when no current occurrence is left. A reader's peels live in memory.

**`fall.ts`.** A peeled strip is cloned into a fixed layer above the page with `pointer-events: none`. It curls from the
grabbed corner, then falls with a damped sway for about 3 s, and is removed once it leaves the viewport. Under
`motionReduced()`, it fades in place within 200 ms instead.

**`ConfigForm.tsx`.** Two labeled text fields, Phrase and Replacement. Beneath them, a live line read from `ConfigFormProps.post`: "Covers 3 places in this post", or
"Not in this post".

Tests first:
- Strips land on every occurrence, and none in a quote.
- An author's saved peel holds after a re-render, and a reader's does not survive a remount.
- The keyboard hold peels at `peelMs` and not before.
- Reduced motion leaves no animation running (as Glitter Bomb's test checks).
- The strip text keeps the house style's contrast (`engine/ui/contrast.ts`).
- The overlapping top strip peels first.
- After an edit that removes an occurrence, that strip is gone. After an edit that adds one, a new strip is there.

## Task 7. Its words, face and log (instance UI, engine log)

**Files:**
- `instances/divided-world/ui/cards.ts`
- `instances/divided-world/ui/cards/autocorrect.svg` and `autocorrect-mark.svg` (new)
- `engine/ui/cards/types.ts` (`CardUi.logPlay`)
- `engine/ui/log/lines.ts`
- tests `instances/divided-world/ui/index.test.tsx` and `engine/ui/log/lines.test.tsx`

**The card's UI entry:**
- **`art`:** Pepperoni's color is the one the Cards board already gives Bluff and Glitter Bomb.
- **`summary`:** "Covers a phrase everywhere it appears in a post with words of your choosing."
- **`hint`:** "Drag a strip off to read what's under it."
- **`surcharge`:** "Covers a lot, +0.25 per 50 characters covered", said from the settings.
- **`describe`:** says the rules in plain words, true to the settings.
- **`logPlay(config)`:** returns "It covers “phrase” with “replacement”."
- **`logSave(state)`:** returns "You peeled N of its strips", or "Peeled clean" when `clean` is set.

**The engine.** `CardUi` gains an optional `logPlay(config) => string | undefined`. In `lines.ts`, the `played` and
`onMine` rows append it to their details where a card gives one.

Tests first:
- The log lines for the caster, for the author, and for a save.
- `describe` reads the settings' numbers.
- The faces test (`engine/ui/cards/faces.test.tsx`) finds the face and the mark.

## Task 8. Stories and shots for the owner's word

**Files:** `instances/divided-world/cards/autocorrect/Effect.board.stories.tsx` (new); shots under
`docs/research/2026-11-03-autocorrect-shots/` (new).

The shots show:
- one strip, three stacked plays with an overlap, a phrase across bold, and a long strip wrapping at 390
- a peel mid-drag, the adhesive band, and frames of the fall
- the reduced-motion fade
- the play form with its live count

Each at 1440 and 390, light and dark. The PR waits on the owner's word on them.

## Last. The full build and the final review

Run `npm run typecheck` and `npm run build:ci`, and include the output. The final reviewer reads this plan's Review focus.

## Ways out of the states this touches

- **A strip:** a reader peels it on their own screen; the author peels it for everyone or edits the phrase away; History
  shows the author's words.
- **A play refused as stale:** it was never made. The form reads the post again, and the caster tries again.

## The masks

- `card_target`'s `body` and `version` are the post's public text and its public latest edit.
- Each refusal (a missing phrase, a stale version, a full stack) reads only public facts and is the same for every caster.
- The lean reads reaction tallies inside The System's scoring, which is the stated exception, and it is shown only in each
  settled window's sums.
- Nothing joins `characters.owner` outside settlement.

## Review focus

- **Acts an instance already holds:** existing Bluff and Glitter Bomb plays now read through the lean. Check that a window
  settled again from the same input gives the same sums as before for windows where those plays drew no reactions, and
  name any change where they did.
- **The holder keyed by `readsAs`:** a Pepperoni play from an earlier window reads as this window's lean. Check that this
  never pays one player twice for the same later votes on one post.
- **Offsets:** the server's `visibleText` and the renderer's walk must agree on every node type, or a strip lands on the
  wrong words. Check the agreement test covers lists, nested formatting, an unclosed tag and the depth cap.
- **A stale price:** check that `play_card`'s version check runs under the post's lock, so an edit that lands between the
  read and the write cannot slip through.
- **The cost of matching on a page of many autocorrected posts:** one `parse` and one `visibleText` per post per render.
  Check that both are memoized on the body, and that a post with no Autocorrect does neither.
- **Peels kept by index:** an edit that inserts an occurrence earlier in the post moves which strip is peeled. That is the
  design, and it should be stated in the Effect's header comment.
