Record, written 2026-11-20.

# Sounds that overlap, and captions that stack: design

Designed with the owner on 2026-11-20. The plan is `docs/plans/2026-11-20-sound-stack-plan.md`.

## 1. The problem

A post with several Steel Chairs on it throws them 350 ms apart. Each chair makes a hit sound and, a little later, a
settle sound, and each file lasts 0.9 to 1.5 s. Every one of those plays goes through the one mixer group
`steel-chair` (`instances/divided-world/ui/steel-chair/Effect.tsx`, `onEvent`), and a group holds one voice: a new play
fades out the one still sounding (`engine/ui/audio/mixer.ts`, `play`). So a pile of chairs never sounds like a pile.
Each clang cuts the last one off. The Steel Chair plan chose the one group so that "a thread is not a wall of clangs",
but the cut is what a stacked play shows most.

The mixer can already overlap: a play with no group sounds over whatever else sounds. What it lacks is a bound
between "one voice" and "no limit".

The captions have the same shape. The store (`engine/ui/audio/captions.ts`) shows one caption at a time: a new `say`
replaces the one showing, and a loop's held caption shows only while nothing is said. Five chairs make ten captions
that replace each other in about two seconds.

## 2. What was decided

### 2.1 A group is a pool of voices with a cap

`play` takes a new option, `voices`: how many voices the group may hold at once. The default is 1, so a group with
no cap behaves exactly as it does today, and Laugh Track's `audience` crossfade does not change. A value is rounded
down, and anything that is not a finite number of at least 1 is read as 1.

A group keeps its voices in the order they started. When a new play would take the group past its cap, the oldest
voices fade out over the play's `fadeMs` (never less than `EDGE_MS`, as every fade-out is) until there is room for
it. A voice that ends by itself leaves the pool. The cap is the one the newest play names, so a play with a smaller
cap than the voices already sounding fades out as many as it needs to.

A loop takes no `voices`. A loop in a group replaces every voice in it, as it replaces the one voice today, and a
loop counts as a voice to a play that comes after it.

A play that is dropped for being late (`lateMs`) fades out nothing, as today.

The group name is the mixer's, shared by the whole page, so a cap bounds every post that plays into the group
together, not each post on its own.

**Weighed.** Dropping Steel Chair's group, so its plays overlap without limit: no engine change, but nothing bounds
a page with many chaired posts in view except the 300 ms each must be in view. A cap per sound, set in the
instance's `sounds.ts`: it puts the limit where the sound is supplied, but then every card that plays the same sound
shares that limit, and a cap is about how a card plays its sounds, not about the sound.

### 2.2 A limiter guards the output

The volumes of overlapping sounds add up. Every voice plays at its sound's own level, so a pile of chairs sounds
as loud as a pile of chairs. A limiter stands between the two buses and the speakers so the pile squashes rather
than crackles. It is a `DynamicsCompressorNode` set as a limiter: threshold −1 dBFS, knee 0, ratio 20, attack
0.002 s, release 0.1 s.

Every Divided World sound is already brought to a peak at or below −1 dBFS (`CEILING_DBFS` in
`instances/divided-world/ui/sounds.ts`, from the manifest that `tools/measure-sounds.mjs` writes). The files'
measured peaks are −0.7 dB to −24.5 dB before their gain. So a sound alone passes the limiter unchanged, and only
sounds that add up past the ceiling are pressed down. The limiter is the engine's, for every instance. An instance
whose files are louder than −1 dBFS gets them limited, which is what a limiter is for.

A context that cannot make a compressor (an old WebKit) connects the buses straight to the speakers, as today. Its
absence, or a throw while making it, never reaches a caller.

Chromium's compressor looks ahead about 6 ms, so every sound starts that much later than it did. That is well under
the 120 ms Steel Chair allows (`LATE_MS`) and under anything Laugh Track's timing turns on.

**Weighed.** Turning each new voice down by how many already sound (about 1/√n): the total stays near one sound's
level, but a pile sounds smaller than one chair, and the earlier voices would have to be turned down without a step
as each new one arrives. No limiter at all: five sounds near full scale can clip on some devices.

### 2.3 Captions are lines, and a repeat is counted

The caption store shows a list of lines instead of one caption.

- **A said line.** A `say` whose words and ink match a said line already showing adds one to that line's count. The
  line then lasts until the later of its current end and the new say's end, and it keeps its place. Any other `say`
  adds a new line with a count of 1 at the end of the list. The end of the list is drawn nearest the HUD, so the
  newest line is at the bottom, as with the toasts.
- **A held line.** One line for each set of held words, however many loop ids hold it. It shows from the first hold
  of those words to the last release of them. A hold said again under the same id with new words moves that id to the
  new words' line. Held lines are italic, as held captions are today, and they have no count.
- **At most three lines** (`CAPTIONS_SHOWN`), as with the toasts. When a new said line would make a fourth, the
  oldest said line leaves early. A held line is never pushed out: it has no timer, and pushing it would hide a sound
  that is still playing. If all three lines are held, a new said line shows as a fourth until a hold is released.
- A repeat changes the count in place. The line does not re-enter.

**Weighed.** One line for each sound, capped at three: a pile of chairs cycles the same two lines through the stack.
Merging repeats without a count: five chairs and one chair look the same. Keeping a held line under the said ones,
as today: while "The audience laughs" shows, the murmur under it is not captioned.

### 2.4 What a screen reader is told

The live region stays polite. A said line is announced once, when it first shows, with its words ("A steel chair
clangs"). If its count grows, the total is announced once, either after the count has not changed for 700 ms
(`QUIET_MS`) or when the line leaves, whichever comes first: "A steel chair clangs, 3 times". A line whose count
stayed at 1 is not announced again. Held lines are never announced, as today. Each announcement leaves the region
after `SAID_MS` (2,500 ms), as today. Five chairs give at most four announcements, and the reader hears how many
chairs hit, as a sighted reader sees ×3.

The store keeps the announcements, so the rule is tested without React. The bar renders them.

**Weighed.** Announcing each line once and never its count: a screen-reader user hears that a chair clanged, not how
many did. Announcing every say: ten announcements in two seconds, which a screen reader queues and reads long after
the chairs have landed.

### 2.5 The stack on screen

The stack is in the glass, plain, never in character. It stands where the bar stands now: centered, 10 px above the
HUD's seam, at most the window's width less a 16 px gutter on each side. Each line is today's chamfered tray, and
lines are 6 px apart. The count is drawn after the words as `×3`, in tabular figures, only when the count is above 1.

It moves as the toasts move (`engine/ui/alerts/Toasts.tsx`): `AnimatePresence`, and each line a `motion.div` with
`layout="position"`, entering and leaving with the times and ease of `useFeel(ui.glass.motion)`. A line enters with a
fade and a rise of the feel's distance, and leaves with a fade. When the feel is off (the Motion setting, or the
device's reduced motion), a line is a plain element that appears and leaves where it stands. This replaces the bar's
CSS keyframe fade and its `leaving` state.

`--kb-captions-measured` is the whole stack's height plus its gap, so the toasts still stand above it. Over a dialog
the whole stack is raised above the scrim and lifted clear of the dialog's box as one box (`placeOver`, unchanged).
It still takes no press.

### 2.6 Steel Chair and Laugh Track

Steel Chair plays its hits and settles in `steel-chair` with `voices: 6`, a named constant. Six holds the overlap
of two chairs' hit and settle with room to spare, and the oldest clang gives way on a bigger pile. Because the group
is the page's, six is the bound for every chaired post on the page together. The card's header comment says so in
place of "the one group (a new clang takes over the one still sounding)".

Laugh Track is unchanged. Its `audience` group keeps its single voice, so a new take crossfades over the last, and
its `audience-build` loops still replace each other.

## 3. The rules

- **The layers.** The mixer, the page's sound, the caption store and the stack are engine code: they name no card,
  no sound key and no instance. `SoundPlay.play` carries `voices` through to the mixer. Steel Chair's constant and
  its one changed call are Divided World's.
- **The masks.** Everything here runs on the reader's own page, from plays that are public, in posts the reader has
  in view. A caption's count is a count of sounds that page played. Nothing reads who cast a play, who owns a
  character or who reacted, and nothing new is sent to or read from the backend.
- **Ways out.** No state is added that a player, a character or a post can be put in. A said line ends by itself, and
  a held line ends at its loop's release, as captions do today. Turning Game sounds off, from Settings or from a
  card's Lens, still silences the game bus, and the captions remain.
- **An accessible path.** The captions are the forum's own accessibility, not a game obstacle: the stack shows what
  sounded, the live region says it, and the count reaches a screen reader as a total.
- **Two worlds.** The stack is the glass, in the caption bar's existing look. No board screen changes.
- **Weighed at a busy instance.** A page with many chaired posts in view holds at most six Steel Chair voices,
  because the group is the page's. The caption store holds at most one timer for each line it shows, and a repeat
  reschedules the line's timer instead of adding one.

## 4. Open

- Whether six voices sounds right. It needs a listen on a device, and a build session cannot listen. The constant is
  named so the owner can tune it.
- Issue #764 (a play with `lateMs` that waits on a slow file says its caption late) is left on its own issue. This
  design does not change when a caption is said.
