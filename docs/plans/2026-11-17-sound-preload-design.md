Record, written 2026-11-17.

# Sounds ready before they are needed: design

Designed with the owner on 2026-11-17. The plan is `docs/plans/2026-11-17-sound-preload-plan.md`.

## 1. The problem

A sound often lands a split second late, and a late sound kills the timing it exists for. Steel Chair's clang is
meant to land at the moment the chair hits the post.

The cause is in `engine/ui/audio/mixer.ts`. `decoded()` fetches and decodes a file only when the first `play()` or
`loop()` of it asks, and caches it for the page from then on. So the first play of every file on a page waits a
network round trip and a decode: Steel Chair's hit, each of its four settle sounds, and each of Laugh Track's twelve.
Every play after that is immediate. Decoding needs the `AudioContext`, and the mixer makes the context only in
`unlock()`, at the reader's first gesture (`pointerdown`, `keydown` or `touchend`), so nothing could decode earlier
even if something asked. A fetch needs no context.

A late sound is also played late rather than dropped: `steel-chair/Effect.tsx` calls `play` at the hit, and the
clang sounds whenever its file arrives, after the dent it belongs to.

The files are small (Steel Chair's five are about 93 KB, Laugh Track's twelve about 1.1 MB), and they are built into
`/assets/` under content-hashed names that `netlify.toml` caches for a year. So the wait is mostly a round trip on a
first visit, and a cache lookup and a decode after that.

## 2. What was decided

### 2.1 Fetching and decoding are separate steps, and a sound can be warmed

The mixer gets `warm(slots)`. For each slot whose bus is on, it fetches the file's bytes now; decoding waits for a
context. At `unlock()` the mixer decodes every file it has warmed, and once unlocked, `warm` decodes at once. A play
of a warmed file finds its fetch or decode already under way, or finished, and waits only for what is left.

`warm` keeps the mixer's rule that a bus that is off fetches nothing. A slot warmed while its bus is off is
remembered, and `setBus` turning that bus on fetches it then. Before the account's preferences arrive both buses are
off (the mixer's starting state), so a page that warms early fetches when `setSoundPreference` first says sound is
on, and never fetches for a reader who has sound off.

A failed fetch or decode is forgotten, as a failed play's is today, so the next `warm` or `play` tries it again.
`warm` never throws and never sounds anything.

**Weighed:** making the `AudioContext` at once, before any gesture, so that decoding could start then too. Browsers
allow a context made before a gesture (it stays suspended until one resumes it), but Chromium logs a console warning
for it on every page load. The first gesture almost always comes well before a chair is thrown, since a run starts
only after a post has sat in view for 300 ms, so the gain is small. Not done; a late play is covered by 2.3 instead.

### 2.2 A card names its sounds, and the engine warms them

`CardUi` gets `sounds?: readonly string[]`: the keys of the instance's sound slots its effect may play. When a post
wearing the card is drawn, the engine warms those slots (`BoundEffect` in `engine/ui/cards/Effects.tsx`, through a new
`useWarmSounds(keys)` beside `useSound` in `engine/ui/audio/sound.ts`). That happens before the card's lazily loaded
effect code arrives, so the sound's fetch runs alongside the effect's chunk. `instanceUiProblems` reports a card whose
`sounds` names a key the instance's `ui.sounds` lacks, so a typo fails the build and not a play.

Steel Chair names its five sounds and Laugh Track its twelve. The Settings sound row warms its bus's preview sound
when it mounts.

**Weighed:** a `useSound().warm(keys)` call inside each effect. It is simpler, but every card must remember to call
it, and it can run only once the effect's code has loaded. The owner chose the declared list.

**Weighed:** warming every slot the instance has, on every page. It is one call with no per-card list, but its cost
grows with the instance's sound library, and most of it would never play on a given page. A busy instance with many
sounding cards would fetch megabytes per page (CLAUDE.md, "Weigh a design at the scale of a busy instance"). With
the declared list, a page fetches only the sounds of the cards drawn on it, each file once however many posts wear
the card.

### 2.3 A play can say how late is too late

`play(key, { lateMs })`, on both `useSound().play` and `Mixer.play`: if the sound cannot start within `lateMs` of the
call (its file is still loading), it does not sound, and the play resolves `null`. A skipped game sound shows its
caption for `CAPTION_MS`, as one skipped for a bus that is off does today, so a reader with captions still learns that
the chair clanged. The mixer measures the wait on a clock it is given (`MixerDeps.now`; the page passes
`performance.now`), so its tests drive the clock.

Steel Chair passes `lateMs: 120` for the hit and the settles. 120 ms is about where a sound that lags what is seen
starts to be noticed (broadcast practice puts detectability at about 125 ms of audio lag). Laugh Track passes none:
an audience that answers a beat late still reads as an audience, so its plays keep today's behavior of sounding
whenever the file is ready.

### 2.4 Steel Chair clangs on every run

The Steel Chair plan (`docs/plans/2026-11-15-steel-chair-plan.md`, Task 5) gave sound to the first run after the
effect mounts and kept every replay silent, so a thread of chaired posts scrolled quickly would not be a wall of
clangs. In practice a silent replay reads as a bug. The owner chose: **every animated run sounds**, whether it
started from the post scrolling back into view, from "Throw again", or from a new play landing. Two limits that
already exist keep it from becoming a wall of noise. Every Steel Chair sound on a page plays in the one group
`steel-chair`, so a new clang replaces any still sounding. And a run starts only once the post's middle has been in
view for 300 ms, so posts scrolled past quickly never start one.

A run under reduced motion and a play's moment (`still`) stay silent: neither has a flight or a hit to time a sound
to.

**Weighed:** sound on "Throw again" only, since it is an explicit press, with scroll replays silent. **Weighed:**
every run, with a cooldown of about 10 s per post. The owner chose every run.

The card's description (`instances/divided-world/ui/cards/steel-chair/ui.ts`) says "with Game sounds on, it clangs
the first time", which is no longer true, and was already untrue under reduced motion (#733, F4). It becomes:
"with Game sounds on, it clangs each time, unless motion is reduced."

## 3. The rules

- **The layers.** The mixer, `warm`, `lateMs`, `CardUi.sounds`, `useWarmSounds` and the problem check are engine
  code and name no card and no instance. Divided World's sound keys reach the engine only through `CardUi.sounds`
  and `InstanceUi.sounds`.
- **The masks.** Warming fetches public, static files named by a card that is publicly on the post. What is fetched
  depends on the cards drawn on the page and the reader's own sound setting, never on who owns a character or who
  played a card. A sound skipped for lateness depends on the reader's own network.
- **No player is ever stuck.** No state is added.
- **The fiction and the log.** The card's description is out-of-character copy and must be true; 2.4 corrects it.
- **Accessibility.** A late skip still captions a game sound, so a reader who relies on captions loses nothing.

## 4. Open

- Whether 120 ms is the right limit for the settle sounds, which land as a chair slides rather than at an impact, is
  to be judged by ear in the build's screen check. The plan gives both the same limit.
- Whether Laugh Track's twelve files (about 1.1 MB) are worth warming on every page that shows a Laugh Track post,
  given that most of its takes may never be pointed at on a visit. The design warms them all; a later design could
  warm only the takes the post's cues pick.
