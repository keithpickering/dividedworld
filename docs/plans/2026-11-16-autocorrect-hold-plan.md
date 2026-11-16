# Autocorrect's hold: the plan

Record, written 2026-11-16. Carries out `docs/plans/2026-11-16-autocorrect-hold-design.md`. Three tasks, in order. Each goes test
first, with its red run.

## Task 1. The landing time, read

Model: inline

- **Migration** `supabase/migrations/0373_play_landed_at.sql`: `play_landed_at(play uuid) returns timestamptz`, `language sql stable
  security definer set search_path = public, pg_temp`, selecting `created_at` from `acts` where `id = play and kind = 'card'`; null for
  anything else. Revoke from public and anon; grant execute to `authenticated`, as `card_of_play` is (`0006_cards.sql:220-224`).
- **SQL test first** `supabase/tests/0373-play-landed-at.sql`: a card Act's time comes back; a post's id and an unknown id give null.
  Red run: the function does not exist.
- **`SAFE_TO_REPEAT`** in `supabase/functions/act/core.ts` gains `play_landed_at` (a read), and the test at `core.test.ts:244` lists it.

## Task 2. The rule and its refusal

Model: sonnet

- **Engine** `engine/rules/cards.ts`, `CardRules`: an optional `stateHeldUntil?(settings: Settings, landed: Date): Date | undefined`,
  documented next to `validateState`: before that time, the post's author's saves on a play are refused; undefined is no hold. It names
  no card. Beside it, an optional `stateHeldWords?(until: string): string`, the refusal's words given the time as `refusalTime` writes
  it, with a plain default in the act function for a card that gives none.
- **Act** `supabase/functions/act/core.ts`, the `needsCardOfPlay` branch (line 235): after `validateState`, when `rules.stateHeldUntil`
  is set, read `play_landed_at` as the player, read the settings rows (`withDatabaseSettings`, as `tuned` is read for a play), and when
  `now < until` answer `refused('play', words)` with no write, `words` being the card's `stateHeldWords(refusalTime(until))`. Autocorrect's:
  "This tape is stuck on until <time>. It can be peeled after that." `now` is the clock the function already uses (inject it the way the file's other time checks do, or `new Date()`).
  A null landing time is "there is no such card on a post".
- **Instance** `instances/divided-world/cards/autocorrect.ts`: `reads` gains `{ key: 'autocorrect.holdHours', whole: true, min: 0,
  max: 168 }`; `stateHeldUntil` gives `landed + holdHours` hours, or undefined at 0. Export `heldUntil(settings, playedAt: string):
  Date | undefined` built on it for the screens. The header's state paragraph says the hold.
- **Settings** `instances/divided-world/settings.ts`: economy `'autocorrect.holdHours': 24`, with a comment like its neighbors';
  `settings.test.ts:55` lists it.
- **Tests first:**
  - `core.test.ts`, beside the save test at line 136: a save of an autocorrect play landed 1 hour ago is refused with the words above
    and no `save_effect_state` call; one landed 25 hours ago saves; a whoops save makes no `play_landed_at` call. Red: the save goes
    through.
  - `instances/divided-world/cards/autocorrect.test.ts`: `stateHeldUntil` gives landed + 24h; 0 gives undefined; `holdHours` of -1,
    169 and 1.5 are refused by `instanceProblems`.

## Task 3. The screens

Model: sonnet

- **Hands** `instances/divided-world/cards/autocorrect/hands.ts`: `PieceSpec` gains `held: boolean`. Wherever the hands choose
  between the author's peel and a reader's peek (`press` at line 183, `keyDown` at line 280, and any other `settings.author` branch),
  the author peels only on a piece that is not held; on a held piece they peek, as a reader. A piece whose `held` turns false on `sync`
  peels from then on.
  - Tests first in `hands.test.ts`: as author on a held piece, a press and drag lifts and lays back down, makes no `change` event, and
    cannot tear; the same piece unheld by `sync` peels. Red: the held piece peels.
- **Effect** `instances/divided-world/cards/autocorrect/Effect.tsx`:
  - For each play, `heldUntil(settings, play.playedAt)` (Task 2). A strip is held while `now <` its play's time. Only when
    `reader.author` and a hold is running, a timer moves `now` on once a minute, and once at the moment the latest hold ends; no timer
    otherwise.
  - Pieces get `held` in their specs (line 1009).
  - `LENS` gains `authorHeld(left: string)`: "Stuck on for ${left}. After that you can peel strips off for good: hold one end until it
    lifts, then pull slowly. Pull too fast and it tears." The view's `ends` for the author uses it while any live strip is held, with
    the latest time among them; else `LENS.authorEnds`.
  - The `Anchor`'s name for the author on a held strip: "Autocorrected text: “${replacement}”. Stuck on for ${left}. Hold Enter or
    Space to lift it and read under it".
  - `left` is a function in the file: whole hours and minutes, "5h 12m", "12m", "less than a minute", rounded up to the minute.
  - Tests first in `Effect.test.tsx` (its plays are dated 2026-11-03, older than any hold, so its tests stand): an author on a play
    landed 1 hour ago drags and nothing is saved, the Lens says "Stuck on for 23h 0m. …" (with a fixed clock), the anchor's name says
    so; a reader's ends are unchanged; with fake timers, after the hold passes, the author's drag peels and saves. Red: it saves at
    once.
- **Words** `instances/divided-world/ui/cards/autocorrect/ui.ts`: `describe` gains, after "Only the post's author can peel strips
  off, slowly, for everyone": " The author can't peel any of a play's tape for the first ${holdHours} hours after it lands." (left out
  at 0). `logPlay` is given no settings (`CardUi.logPlay`, `engine/ui/cards/types.ts`), so it says nothing of the hold (design
  section 4).
- **Stories** `instances/divided-world/ui/autocorrect/Autocorrect.board.stories.tsx`: the plays must be landed before the hold, so
  the author stories and `e2e/autocorrect.spec.ts` keep peeling. Find how the fake dates a seeded Act (`engine/ui/data/fake.ts:1318`)
  and date the plays 2 days back. Add a `held` case (`OneAuthorHeld`): the author, a play landed an hour ago. The fake's `saveEffect`
  is unchecked by card rules (its header says so) and stays so.

## Review focus

- A play already on a post when this ships, under 24 hours old with a half peel saved: the half peel stays drawn, and the author's
  next save is refused until the hold ends. The screen must not try to save in a loop meanwhile.
- The refusal comes before the author check for every caller, so a non-author learns nothing new.
- A deployed economy row lacks `autocorrect.holdHours` until the seed adds it, and `withDatabaseSettings` throws on a missing read
  key, and every play, set and draw reads the settings through it: the seed must run before the act function serves any card action on
  the new code.
- The timer exists only for the author's screen while a hold runs, never once per post for every reader.
