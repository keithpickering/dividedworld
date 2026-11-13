# Laugh Track: the reader points, the room stirs: design

Record, written 2026-11-12. A design session with the owner, started the hour the reading band
(`docs/plans/2026-11-12-laugh-track-band-design.md`, cited as BAND §N) was merged and tried. It changes when a place
fires and what marks it, which BAND §1 and §2 and `docs/plans/2026-11-11-laugh-track-design.md` (LT) §6 decided. The
plan is `docs/plans/2026-11-12-laugh-track-point-plan.md`.

## 0. What was found

- **The band works and is still hard to understand.** With the band, the queue, the 1.2 second airtime and the 18
  second hold, the owner's post fires 14 of 14 cues. The owner's words on trying it: "Definitely getting more cues - but
  I think it's still hard to understand the way it works." A laugh can come 15 seconds after the words it belongs to,
  and nothing on the page says why a phrase fired or did not.
- **The owner's proposal.** Play the full reaction when a reader hovers or touches a matched phrase, and treat each
  phrase as the epicenter of a zone in which the chitter fades in, louder as it is approached: "less 'try to predict
  somebody's reading patterns' and more 'show the caster's opinions on the different subjects within the post', which
  cuts more to the core goal perhaps."
- **What is already there.** A heard place's replay already plays on hover, focus, press and Enter
  (`instances/divided-world/ui/laugh-track/Effect.tsx`, `replay`). The murmur already chooses the nearest unheard
  place's loop and swells with nearness, and the mouse already counts toward that nearness
  (`instances/divided-world/ui/laugh-track/watch.ts`, `line.ts`). "Heard" is a count on the reader's own screen for the
  visit; nothing saved or sent depends on it. A face-down Laugh Track's waiting phrase is the server's and is untouched.

## 1. Only a gesture fires

Decided: **scrolling never plays a reaction.** Weighed: the gesture firing and a phrase resting at the reading line
firing too, the nearest only (a passive reader hears some punchlines, and which ones stays unpredictable); the queue
kept with the gesture added (the most reactions and the most rules).

- A reaction plays when the mouse moves onto a cued phrase, when the phrase is tapped or clicked, or when Enter or Space
  is pressed on it. It plays at once and cross-fades over a reaction already sounding (the mixer's `audience` group).
- **The mouse must move.** A phrase that scrolls under a mouse at rest does not fire; the first movement of the mouse
  while it is over the phrase does. Otherwise a wheel scroll with the pointer over the text would fire by reading
  position, the thing this design removes.
- The dwell, the earned queue, the airtime and the hold go, with their settings (`laughTrack.dwellMs`,
  `laughTrack.band`, `laughTrack.airMs`, `laughTrack.holdMs`). BAND §1 and §2 are replaced by this section.
- A reader who points at nothing hears a room that stirs and never erupts. That is accepted: the cues are the caster's
  notes on the post, offered and not imposed.

## 2. Nearness: the chitter and the mark

Decided: **one number for each place, from 0 to 1, drives both the chitter's level and the mark's opacity.** Its
sources, decided: **scroll and pointer, both.** Weighed: the pointer alone where there is one, the reading line only on
touch (a desktop reader who never moves the mouse over a post never learns it has a Laugh Track); the pointer only
(nothing on a phone).

- **Nearness** is 1 at no distance and falls in a straight line to 0 at the reach (`laughTrack.reachRem`, 12rem). The
  distance is the smaller of: the gap from the place's nearest box to the reading line (`laughTrack.line`, 40% down the
  space above the HUD), and twice the mouse pointer's distance to the place. So the radius around the mouse is half the
  scroll's reach, as it has been. The distance is to the line, not the band: the band was for dwelling and is gone.
- **The chitter** is the loop of the nearest unheard place (titter, ooh or grumble), at `laughTrack.murmurMost` (35%)
  of a hit times that place's nearness. One loop for the page, as now.
- **The mark, decided: marked as you get near.** Weighed: always marked (every cued phrase underlined from the start;
  the surprise that a phrase is cued is gone); never marked until heard (a phone reader taps unmarked words, and a
  keyboard reader has no path). The mark is the dotted underline a heard place wears today, in its sound's ink, at an
  opacity equal to the place's nearness times `laughTrack.markMost` (100). The owner: "the proximity is already
  tracked, easy to map to opacity. If we don't like it we'll just take it out after." `laughTrack.markMost` at 0 takes
  it out. The ink tells laugh from cheer from boo as it fades in, which the chitter's own sound already tells.
- LT §6's "Before it fires nothing marks the phrase, so the joke is not telegraphed" and BAND §5's "Not in this design:
  any mark on an unfired phrase" are replaced by this section. What stays a reveal is the reaction itself.

## 3. A place that has been heard

- Its mark stays at full opacity for the visit and it no longer chitters. Pointing at it again replays it. The Lens
  still says "N of M cues heard".
- **The chitter waits for the reaction.** While a reaction sounds the chitter is held at nothing, and it returns over
  the reaction's tail. The hold is counted from when the sound answers, not from the gesture, so a file still being
  fetched does not bring the chitter back under its own reaction (the final review of the band's build found that;
  #563). A reaction that does not sound (Game sounds off, the page not yet unlocked) holds the chitter for 1.2 seconds,
  long enough for its caption to be read first.

## 4. The keyboard and a screen reader

Decided: **one stop for each post.** Weighed: every phrase its own stop with focus firing (up to 30 stops on a post,
and tabbing through a thread sets off every reaction); every phrase a stop with Enter firing (quiet, and still 30
stops).

- Tab lands on one cued place of a post's Laugh Track; the arrow keys move among that post's places (Home and End to
  its first and last); Tab again leaves the post.
- Focus counts as nearness 1: the place's mark shows in full and its chitter plays. Enter or Space plays the reaction.
- A place is a button from the start. Unheard, it is named by its words and "Play the audience's reaction"; heard, as
  today, by its words and "Replay: the audience boos". The name does not say which reaction before it is heard; the
  chitter's caption ("A grumble rises") already does, for every reader alike.
- With Game sounds off everything works the same and is captioned.

## 5. The words

The card's hint and its description say the audience reacts "when you reach certain words". They are the glass's copy
and must be true, so they change with the rule. Proposed, for the owner's review in the plan's PR:

- Hint: "A Laugh Track: the audience stirs as you get close to certain words. Point at one, or tap it, to hear them
  react. Turn on Game sounds in Settings to hear it."
- In the description, in place of "the audience reacts as a reader reaches it, and builds up as they get close": "the
  audience stirs as a reader gets close and the phrase's underline fades in. Pointing at the phrase, tapping it, or
  pressing Enter on it plays the reaction."

## 6. The rules

- **The masks.** Everything runs on a reader's own screen from the play's public cues, the reader's scroll and the
  reader's pointer. Nothing is saved, sent or timed from who wrote, cast or owns anything.
- **No player is stuck.** No state a player, a character or a post can be put in is added. A place's nearness and its
  heard mark are a reader's screen state for a visit.
- **The layers.** All of it is Divided World's: the watcher, the effect, the card's screen numbers and the copy. The
  engine is untouched.
- **Accessibility.** Laugh Track is not an obstacle, so its paths meet the usual standards: every place is a labeled
  button reached by keyboard, focus is visible, and every sound is captioned. The mark is not the only sign of a cue:
  the chitter's caption says one is near.
- **Scale.** The watcher stays one observer and one loop of frames. A frame measures only the places near, and writes a
  place's mark only when its nearness changed. A still page with no place near asks for no frames.
- **Acts.** Nothing saved changes. Four screen settings go and one is added. The instance's card settings are
  held in its own code (`instances/divided-world/settings.ts`), and the engine checks only that every number a card
  reads is held (`engine/rules/instance.ts`, the `screenReads` loop), so a held number no card reads is ignored.

## 7. Open

- Whether marks that come and go while scrolling feel right is for the owner's eye once built; `laughTrack.markMost`
  is the way out.
- Whether a reaction should also play when a phrase rests at the line (the second alternative of §1) can be asked again
  after this is tried; nothing here prevents it.
