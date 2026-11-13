# Five answered follow-ups around Laugh Track, the caption bar and the callout: plan

Record, written 2026-11-13. Five follow-ups the owner has answered, with no design session before them: issues #517,
#518, #523, #578 and #602. The owner's answers are recorded in a comment on each issue and are the specification; this
plan says how each is built and names every choice an answer left open, which the PR lists under `Design questions`.
It builds on #566 (Laugh Track: the reader points), merged to main as `74393103`.

Every task is test first: the test named, its red run recorded, then the code, then the green run. No task touches
SQL or a deployed service, and no migration is written. No check (`check-*.mjs`) is added, so there are no poisons
beyond each test's own red run. Tasks run in this order; Tasks 1 to 4 share Laugh Track's files.

Not built here: #516's question 2 (whether a steady murmur fades by itself) is still the owner's, and #586's items
stay on #586.

## Task 1. A persona's repair leaves a set's cues alone (#523)

Model: sonnet

**Files:** `engine/rules/cards.ts` (`CardRules.repairStaff`), `supabase/functions/chatter/core.ts` (`decideOptions`),
`instances/divided-world/cards/laugh-track.ts` (`repairCues`), and their tests `engine/rules/cards.test.ts`,
`supabase/functions/chatter/core.test.ts`, `instances/divided-world/cards/laugh-track.test.ts`.

**What is wrong.** `decideOptions` repairs a persona's config against the post before deciding it. For a set
(`on: 'own'`) the cues need not be in the post the card is set on: the back waits for a quote that says cue 1's phrase
(`setPhrase`), and `decideSet` never holds the cues to the post. But `repairCues` drops every cue not in the post, so
it can change the phrase the set waits for.

**What is built.** `repairStaff` gains a third argument that says how the card is being played,
`repairStaff?(config, target, play: 'cast' | 'set')`. `decideOptions` passes `'set'` when `on === 'own'` and `'cast'`
otherwise. `repairCues`, for a set, skips the three predicates that read the post (`phraseNotInPost`,
`overlapsEarlierCue`, `mostThirtyPlaces`) and still applies `cueShape` and `mostFiveCues`. A cast is repaired as today.

**Tests first.**
- `core.test.ts`: the issue's case. A persona sets Laugh Track (`on: 'own'`) on its own post "Pizza time, everyone."
  with cues Luigi/boo then pizza/cheer; assert the decided set's config keeps both cues, in order, with no trim, so
  its waiting phrase is "Luigi". Red on main: one cue, a `phraseNotInPost` trim.
- `laugh-track.test.ts`: `repairCues(config, target, 'set')` keeps cues that are not in the post, overlap or pass
  thirty places, and still trims a malformed cue and a sixth cue; with `'cast'` every existing assertion holds.
- `cards.test.ts`: where the fixture card's `repairStaff` is exercised, nothing changes but the argument.

## Task 2. A Laugh Track never cues text inside a link (#602)

Model: sonnet

**Files:** `engine/bbcode/visible.ts` (`visibleWalk`), `engine/rules/cards.ts` (`PostTarget`, `postTarget`),
`instances/divided-world/cards/laugh-track.ts` (`placesOf`, `canApply`, `repairCues`),
`instances/divided-world/ui/laugh-track/ConfigForm.tsx`, `instances/divided-world/ui/laugh-track/Effect.tsx`
(`spotsOf`, `findFirsts`, the click and key handlers, the header comment's point 5),
`instances/divided-world/ui/cards.ts` (the comment near the hint only), and the tests beside each;
`e2e/laugh-track.spec.ts`.

**The rule.** The owner's answer on #602 replaces #576's: no place of any cue lies inside a link. The only link text
the matcher can see is a bare address (an `autolink` node; a `[url]`'s label is already invisible to it). So a place
that touches an autolink's stretch of the visible text is not a place: it is not counted, not drawn, not charged and
plays nothing. With that, the hint's "tap" and the description's "Enter" are true as written and are not changed.

**What is built.**
1. The engine says where the links are. `visibleWalk` already yields the visible text and its offsets; it also yields
   the stretches of that text that are an autolink's (`links: { start, end }[]`, in the visible text's own offsets).
   `PostTarget` carries them beside `text`, filled by `postTarget`. The engine learns nothing about any card.
2. `placesOf` takes the links and drops every place that intersects one. Every caller passes them: `canApply`,
   `repairCues`, the form, and the effect's `spotsOf`. A caller that holds only a body parses it the way `postTarget`
   does; none passes a bare string with no links.
3. `canApply` therefore refuses a cue whose phrase is only inside a link, and counts and prices only the places
   outside links. Its refusal for that cue says so (copy below). `repairCues` trims such a cue from a persona's cast
   as `phraseNotInPost`.
4. The form's line for a cue found only inside a link says so, in place of "Not in this post's own words" (copy
   below); its counts are the places outside links.
5. The effect draws no cue inside a link. #566's link case goes: `inLink`/`linked` in `findFirsts`, the `linkedNow`
   guard in the click handler, the key handler's skip, the comment's point 5 and the `describe` "a cue inside a link
   is not a button (#576)". The mouse-only guard in `watch.ts` is general and stays.
6. A set that springs on a quote keeps its config as it is today (`lay_sprung` copies it). On the quoting post the
   effect draws only the places outside links, so a quote that says the phrase only inside a bare address gets the
   play with no place to hear, which the Lens already words as "No cues in this version". No SQL changes: the spring
   is matched in SQL, whose walk has no autolink, and changing what springs a set is every trap's rule, not this
   card's. This is listed as a design question.

**Copy added (the glass; listed under `Design questions`).**
- The form's line: "Only inside a link here, and a Laugh Track never cues a link".
- The refusal: "“{phrase}” is only inside a link in this post; a Laugh Track never cues a link".

**Tests first.**
- `visible` test: a body with a bare address and a `[url=…]label[/url]` yields one link stretch, at the address's
  offsets in the visible text; a body with none yields none.
- `laugh-track.test.ts`: with body "Visit https://example.com/Luigi and Luigi is great." and cue Luigi, `placesOf`
  gives one place (the second); with only the address, `canApply` refuses with the words above; a phrase that starts
  outside a link and ends inside it has no place; `repairCues` (cast) trims the link-only cue.
- `ConfigForm.test.tsx`: the line for a link-only phrase, and the count beside a phrase found in and out of a link.
- `Effect.test.tsx`: replacing the #576 block: the address's "Luigi" is drawn as plain link text (no `.dw-lt-cue`
  inside the `a`), the other place is a button that plays on click, tap and Enter, and the Lens counts one.
- `e2e/laugh-track.spec.ts`: a post with a cue phrase in a bare address and in plain words: the link holds no
  `.dw-lt-cue`, and the Lens reaches every place heard by keyboard alone.

## Task 3. Face down is offered and mentioned only where it can happen (#517, item 1)

Model: sonnet

**Files:** `engine/ui/cards/types.ts` (`ConfigFormProps`), `engine/ui/cards/PlayForm.tsx`, `engine/ui/cards/land.ts`,
`engine/ui/cards/PlayActions.tsx` (`GhostMark`), `instances/divided-world/ui/laugh-track/ConfigForm.tsx`, and the tests
`engine/ui/cards/setform.test.tsx`, `engine/ui/cards/land.test.tsx`,
`instances/divided-world/ui/laugh-track/ConfigForm.test.tsx`.

**The owner's words.** "We should only mention the ability to place a card face down if it's a real possibility",
and the face up/down choice "should likely be conditional based on whether the specific card can actually be played
both ways". The owner calls it the Lens's toggle; the control is the play dialog's "How to play it" pair ("Play it
now" / "Set face down").

**What is built.**
1. One answer to "which ways can this card land on this post", in `land.ts`: `waysOn(rules, post, plays, { cards, own })`
   returning `{ cast: boolean, set: boolean }`, from the same `landing` calls `GhostMark` makes today (`casts`,
   `sets`). `GhostMark` and `PlayForm` both read it, so the mark and the dialog cannot disagree. It is asked without
   the form's config, so the pair never appears or disappears as the player types.
2. `PlayForm` shows the pair only when both are true. When only the set lands (a character-level card on one's own
   post), there is no pair and the play is a set; when only the cast lands, there is no pair and the play is a cast.
   The dialog's words say which it is, as they do today for a play with no choice.
3. `ConfigFormProps` gains `faceDown?: 'no' | 'can' | 'will'`: `'will'` when the play is a set, `'can'` when the pair
   shows and "Play it now" is chosen, `'no'` when the card cannot be set here. Laugh Track's form shows "A face-down
   Laugh Track waits for this phrase" on cue 1 unless it is `'no'`. Showing it under `'can'` is a choice (the player
   is deciding between the two); listed as a design question.

**Tests first.**
- `land.test.tsx`: `waysOn` for a post-reach card on one's own post (both), on another's post (cast only), a
  character-reach card on one's own post (set only), and a face-up-only card (cast only).
- `setform.test.tsx`: a character-reach card armed on one's own post shows no "How to play it" pair and submits a
  set (red on main: the pair shows and "Play it now" is refused); a post-reach card there still shows the pair; the
  existing "a Move lands face down where its cast is not offered" still holds.
- `ConfigForm.test.tsx`: the note is absent with `faceDown="no"` and present with `"can"` and `"will"`.

## Task 4. One count for cues: places, live and in a moment (#517, item 2)

Model: sonnet

**Files:** `instances/divided-world/ui/laugh-track/Effect.tsx` (`Moment`, the Lens state),
`instances/divided-world/ui/laugh-track/Effect.test.tsx`, `e2e/laugh-track.spec.ts`.

**The owner's words.** "Seems like we should keep it consistent." Which thing is counted is not stated. The form
already tells the player a cue "Cues N places in this post" and "N places in all", and what a reader hears is a
place, so both counts are places and say so:
- live: "N of M places heard" (was "N of M cues heard");
- a moment: "M places" / "1 place" (was "M cues", counting cues), from the `spots` the moment already computes.
"No cues in this version" stays. Listed as a design question (the PR's own words turn on it).

**Tests first.** `Effect.test.tsx`: the live state reads "0 of 5 places heard" and its followers; the moment that
shows five pieces for three cues reads "5 places" (red on main: "3 cues"); one place reads "1 place".
`e2e/laugh-track.spec.ts`: the Lens regex reads "places heard".

## Task 5. A caption shows above a dialog's scrim (#518, item 2)

Model: sonnet

**Files:** `engine/ui/audio/Captions.tsx`, `engine/ui/audio/captions.css`, `engine/ui/audio/Captions.test.tsx`,
`e2e/laugh-track.spec.ts` (the test "a caption said with a dialog open on a board stands clear of the dialog") or
`e2e/captions.spec.ts`. Read `engine/ui/glass/Overlay.tsx` and `engine/ui/glass/shell.css` (`.kb-glass-overlay`, the
sheet), and `docs/plans/2026-11-11-laugh-track-design.md` §3 ("It never covers the HUD, the hand or a dialog").

**The owner's words.** "20px is fine. We should render it above dialogs I feel." Item 1 needs nothing built. For
item 2 the bar must be drawn above the scrim (`z-index` 50) and, as the design says, never over the dialog's own box.
The box is the scrim's child, so the bar cannot be layered between them; it is placed clear of the box instead.

**What is built.** While a caption shows and a glass dialog is open (`.kb-glass-overlay` holding a
`.kb-glass-dialog`), `Captions` measures the bar's resting rectangle against each open dialog's box:
- where they do not meet, the bar is marked `data-over-scrim` and CSS raises it to `z-index: 55` (above the scrim,
  below tips and a pack opening at 60);
- where they meet (always, for a phone's sheet, which sits on the HUD's top), the bar is lifted to rest 10px above
  the box's top (`--kb-captions-lift`), and raised as above;
- where there is no room above the box inside the window, the bar stays where and as it is today (under the scrim,
  still announced by the live region). Listed as a design question.
The measuring is a pure function (`placeOver(bar, boxes, viewport)` returning the lift, or that it cannot clear),
run when a caption appears, when a dialog opens, closes or resizes, and on window resize. With no dialog open nothing
changes: the bar is at `z-index: 30` and never over the hand. `--kb-captions-measured` keeps its meaning.

**Tests first.**
- unit, `placeOver`: no dialog; a centered dialog clear of the bar (lift 0, raised); a sheet that meets it (lift to
  10px above the sheet's top); a box that leaves no room (not raised).
- `Captions.test.tsx`: with a dialog in the document the bar gains `data-over-scrim`, and loses it when the dialog
  goes.
- e2e, at `MAIN` and at the phone size: with a dialog open, a caption's bar is the top element at its own center
  (`elementFromPoint` finds nothing of the overlay there; the bar has `pointer-events: none`, so the test reads the
  stacking by hiding nothing and comparing computed `z-index` and rectangles), and its rectangle does not meet the
  dialog's box. Red on main: `z-index` 30 under 50, and on the phone the rectangles meet.

## Task 6. The first-time callout never lies over the post it is about, on a phone (#578)

Model: sonnet

**Files:** `engine/ui/cards/Callout.tsx`, `engine/ui/cards/Marks.tsx`, `engine/ui/cards/marks.css`,
`engine/ui/cards/callout.test.tsx`, the post component that holds `.kb-marks-anchor` (the slot),
`e2e/laugh-track.spec.ts` (the phone test), `e2e/whoops.spec.ts` (`putAwayTip`, where it is no longer needed on a
phone), `e2e/post-layers.spec.ts` and `e2e/glitter.spec.ts` where they assert the callout's place.

**The owner's answer.** The callout is accepted; its placement changes so that it does not lie over the words a
reader has to tap. It is the engine's callout, and what a reader taps differs by card (Laugh Track's cues, Whoops!'s
ink, Graffiti's surface, Below the Fold's bar), so the engine does not learn any card's tappable parts: on a phone
the callout takes its own room in the post, between the date row and the body, and covers nothing.

**What is built.** Below the phone width the engine already uses for its sheet (`sheetBelow`; read `Overlay.tsx` and
use the same breakpoint token in CSS), the callout is laid out in the flow of the post, full width, between the
post's date row and its body, so the body starts below it. Above that width it is as today. The callout stays where
it is in reading and focus order (after its mark), keeps its role, name, "Got it" and the focus return to the mark,
and keeps its 24px target. When it goes, the body moves up; that happens once per card kind per account.

**Tests first.**
- e2e, `laugh-track.spec.ts`, phone: without pressing "Got it", the callout's panel rectangle meets no `.dw-lt-cue`
  and not the post's body, and a tap on a cue plays its reaction (red on main: the tap lands on the bubble). The
  helper that dismissed the callout before tapping is removed from that test.
- e2e at `MAIN`: the callout is where it is today (the existing assertions hold).
- `callout.test.tsx`: the existing describe holds (order, focus, Lens hides it, takeover).

## Review focus

- Task 2: every caller of `placesOf` passes the links; the form, the server's `canApply` and the effect agree on the
  places for one body, including a phrase that straddles a link's edge.
- Task 2: the engine's `PostTarget.links` is computed from the post's public words only.
- Task 3: the mark and the dialog read one function; a card with one way never shows the pair, on any target.
- Task 5: with no dialog open, the bar's layer and place are exactly as before.
- Task 6: no layout shift at desktop width; reading and focus order unchanged at both widths.
