# The Technician, a class for the calm quadrant: design

Record, written 2026-10-30. The design session for issue #28, with the owner. Its plan is
`docs/plans/2026-10-30-technician-plan.md`, and its mocks are in `docs/research/2026-10-30-technician/`. Each section
was confirmed by the owner before the next.

## Why now

The owner's reasons for building it at launch:

- **It gives the calm quadrant a class.** Face earns from excited-positive, Heel from excited-negative and Jabroni from
  bored-negative. Calm-positive (the nod, the "good post") is only the Heel's weakness. No class earns from it (the
  core-loop design, `docs/plans/2026-10-28-core-loop-design.md`, section 6).
- **It is a home for the regular poster.** It is a natural fit for players who will treat the game as "a regular
  forum": the effort poster, whose wiki answers and long replies are respected rather than adored. Its RPG root is the
  Cleric or Monk. Its WWE root is the workrate technician (Bryan Danielson).
- **It makes the screens hold more than four classes.** The core-loop design gives classes no fixed number, and five
  more candidates wait (#27, #29 to #32). The Turn board (`docs/research/2026-10-29-two-worlds/06-turn.html`) and
  glass Part 2's class cards draw exactly four.

## 1. The rules

**Decided.** The Technician (key `technician`) is an instance class like the other four: rules that read only Acts.

| Line | Reason key | What pays or costs | Starts at |
|---|---|---|---|
| Respected | `technician.respected` | Calm-positive reactions on its own posts and cards | +0.10 a vote |
| Evergreen | `technician.evergreen` | Calm-positive reactions on one of its posts that land once the post is 3 days old (posts only, not cards) | +0.05 a vote, on top |
| Dragged in | `technician.draggedIn` | Excited-negative reactions (heat) on its own posts and cards | −0.10 a vote |

The Technician is the Heel's foil both ways: the Heel's weakness is the Technician's income, and the reverse.

**Evergreen** rewards the post that keeps getting nods after the day it was posted: the wiki answer, the reference
reply. Anyone can see it happen ("Pipewrench's old posts keep getting tea"), so it stays readable. Its numbers are two
new instance settings, starting points for the season review like every other: `technician.evergreen` (5 hundredths a
vote) and `technician.evergreenDays` (3, a whole number of days, at least 1).

- **Weighed, the second line:** Evergreen; a co-sign (a Sweet card on another's post that then draws calm, Face's
  lift copied into another quadrant); one line only. Chosen: Evergreen.
- **Weighed, the age:** a set age of 3 days; any earlier settlement window (on a daily schedule that is "tomorrow",
  and a post made just before the settlement qualifies a minute later); a bonus that grows with age (harder to read on
  the card and in the log). Chosen: the set age.

**Evergreen is judged by when each reaction lands or leaves.** A calm vote added once the post is 3 days old pays the
bonus, and a calm vote withdrawn once the post is 3 days old takes it back. The vote store already dates a withdrawn
share at the reaction that moved it (`engine/rules/votes.ts`, `payVotes`). So a reactor cannot farm the bonus by
removing and re-adding a reaction across settlements. The cost is accepted: a calm vote cast on day 1 and withdrawn on
day 5 charges a 0.05 bonus it never paid. The log names that line plainly ("Evergreen: ... came or went"), so it never
misleads. Tracking when each vote was first cast, to avoid that, is not worth 0.05. The owner confirmed this rule over
paying the bonus without ever taking it back.

**The engine gives classes the reacted Act's time.** `ReceivedReaction` gains `actAt`, the time the reacted Act was
posted. The time is public (every post shows it), so it is no private fact. The settlement already holds every touched
Act, so this adds no read.

**No card.** The Technician plays the cards that exist. Calm reactions to its cards already pay through Respected. A
card for it (a Sweet card that marks a post as worth the read) belongs to the postcard pool's own design (#33, and the
card mechanic in #55). Weighed: noting the idea on #33; designing a card here.

## 2. Order, colors and words

**The order: Face, Heel, Jabroni, Technician, Lurker.** The instance's `classes` list sets the order every screen draws
classes in: the carousel, New character, the reveal and Rankings. The owner: "Lurker makes sense as the last one out
of the current set". The Technician follows the three older quadrant classes.

**The glass colors** (owner, option A of `q2-colors.html`):

- **The Technician takes the green.** Fill `#2ef0a0`, ink `#03141a`, large text `#7dffc8`. The React picker tints each
  quadrant in the color of the class that earns from it (`InstanceUi.quadrantClasses`), and Calm wore the Lurker's
  green only because no class owned it. `quadrantClasses.calmPositive` becomes `technician`, so the picker looks the
  same.
- **The Lurker takes purple.** Fill `#b97aff`, ink `#12051f`, large text `#d4b0ff`. The owner: "Lurker might be a
  purple? Mysterious." It is the smoke's own hue, hidden in plain sight. It owns no quadrant, and its marks are dotted
  across all four.

Both pass `tools/check-glass-contrast.mjs` as it stands on main: a trial run on 2026-10-30 put every token over its
smoke at its ratio. The guard holds them from then on.

Weighed: the Lurker as a silver ghost (a silver name sits close to the glass's plain text, so it stands out least of
the five); the Technician in a new orange with Calm turning orange (it sits between Heel's red and Jabroni's gold for
red-green colorblind players, and "calm" reads warm).

**The house style** (the 2003 board's class looks, used on the reveal's bar): the Technician gets a green with a grid
pattern, so a player who cannot tell the colors apart still can by the pattern. The Lurker keeps its gray there, since
only its glass color was a quadrant's.

**The words.** All are out of character and plain, as the class cards and the log are:

- **The card:** "The respected regular. Earns from calm, positive reactions to its posts and cards, and more when an old
  post of its own still draws them. Hurt by heat: excited, negative reactions."
- **The marks:** a plus on Calm and a minus on Heat, named "Earns from the calm, hurt by heat".
- **The log:**
  - *Respected:* "calm, positive reactions to its posts and cards".
  - *Evergreen:* "calm, positive reactions that came or went on an older post of its own".
  - *Dragged in:* "excited, negative reactions to its posts and cards".

The words leave out "3 days" on purpose: that number is a setting an admin can retune, and the log must never say a
wrong one (Open, below).

## 3. Choose a class, as a carousel

**Decided** (owner, from `q3-full-carousel.html` and `q3-full-select.html`): the Turn modal's Choose a class becomes a
carousel of the board's full cards. New character uses the same component, so it follows. The owner: "Carousel keeps
what I like most about the current design": each card's own words stay in view.

- **The layout.** As many full cards as fit at their width (four in the Turn modal at 1440 wide), the next card peeking
  at the edge under a fade, arrows ("Earlier classes", "More classes") that move one card, and a count ("1–4 of 5").
  When every class fits, there are no arrows and no count. The number of cards shown comes from the width, never from
  the number of classes, and nothing in the engine assumes four.
- **Keyboard and screen readers.** It stays one radiogroup. The arrow keys move the choice through every class, and the
  row scrolls to keep the chosen card whole. A card scrolled out of view is never hidden or inert, so a screen reader
  hears every class. The arrows are buttons for pointer users; at either end, the button pointing past it is disabled.
- **Motion.** The row glides to a card. Under reduced motion it jumps.
- **Opening.** It opens scrolled to the chosen class (a pending Turn's), or else to the start.
- **A long name.** A class's name is set at the card's 40px and steps down to fit before the radio, never under 28px.
  The board sets "TECHNICIAN" at 34px.
- **Phone.** One card and a peek, moved by swiping (scroll snap) or the arrows, with the count.
- **The board.** `docs/research/2026-10-30-technician/06-turn-carousel.html` is the 06 turn board redrawn as the owner
  approved it. The build copies it over the two-worlds board and updates the board's comparison manifest. It does not
  replace the board before then, because glass Part 2 (PR #49, open as this is written) compares its build against the
  four-card board.

Weighed:

- **A select screen.** A fighting game's character select: compact tiles for every class, with the chosen class's card
  beneath. The whole roster is in view, and the modal's height is the same at any number of classes, but each class's
  words are read one at a time.
- **The full cards wrapped three to a row.** The modal grows a row taller for each three classes.
- **A carousel with a strip of name chips.** It shows the whole roster, but it is two controls for one choice.

## The masks

Nothing here is computed from a private fact beyond what the settlement already reads. Evergreen reads the reacted
post's time, which is public. A Technician's settled standing moves at a rate (+0.15 a calm vote on an old post) that a
watcher could read as a class's signature, as every class's already can. That is the open secret the core-loop design
accepts (section 2), and the settled sums are The System's scoring exception in CLAUDE.md. The carousel shows the same
classes to every player. The class a character holds is drawn only to its own player, as glass Part 2 already draws
it.

## Ways out

No new state for a player, a character or a post. The carousel is inside the Turn modal and New character, whose ways
out (Cancel, Close, Esc) are glass Part 2's.

## Open

- **The settled number in words.** A class's card and log words cannot say a number that is a setting (3 days, the
  Lurker's "3 times in a day" and "past three"), because `InstanceUi.reasonWords` and `ClassLook.description` are
  static. The Lurker's words already say "three", and an override would make them wrong. Issue #57 asks whether those
  words should read the instance's settings.
- **The Technician's numbers** (+0.10, +0.05, 3 days, −0.10) are starting points for the season review. So is the
  question of whether Evergreen should pay on cards.
