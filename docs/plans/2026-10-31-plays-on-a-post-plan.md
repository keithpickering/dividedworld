# Plays on a post: plan

Record, written 2026-10-31. The plan for `docs/plans/2026-10-31-plays-on-a-post-design.md`, built by one build session
in one PR. The PR says `Closes #84` and `Closes #79`.

Every task is test first: the test named, its red run recorded, then the code. No check is added, so there is no
poison to plant. The engine/instance boundary check runs in the build as it always does. Each part says whether it is
engine or instance. Nothing in `engine/` names Divided World or Whoops!. No migration: `react()`, `spin()`, `tallies`,
`myReactions` and `spunFromMany` already take a play's Act (design, section 0). If the build finds one that does not,
it stops and says so on the PR rather than adding SQL the design did not plan.

The words a player reads are the design's, in American English.

## Task 1. Billing order (engine)

**Files:** `engine/ui/cards/billing.ts` (new), `engine/ui/cards/billing.test.ts` (new, Node test).

`billing(plays: readonly CardPlay[], drawn: (play: Id) => number): readonly CardPlay[]` puts the most drawn first,
ties going to the newest (`playedAt`, then id, so the order is total). `drawnOf(tally: Tally, spun: number): number` is
the sum of the tally's counts plus the threads spun from the play.

Tests first: three plays with distinct draws; a tie broken by newest; a full tie broken by id; no plays; a tally with
a zero kind. Also a test that `billing` reads nothing but its arguments: it is called twice, with the same counts in
two different `Map` insertion orders, and gives the same order.

## Task 2. The plays' tallies, own reactions and spins are read with the page (engine)

**Files:** `engine/ui/thread/Thread.tsx` (`prepare`), `engine/ui/spin/Origin.tsx` (`useOrigin`),
`engine/ui/spin/spun.ts`, `engine/ui/cards/plays.ts`; tests in `engine/ui/thread/Thread.test.tsx`,
`engine/ui/cards/plays.test.tsx`, `engine/ui/spin/Spin.test.tsx`.

- `prepare` reads the plays first (`readPlays`, as today), then makes one `api.tallies` call for the page's posts and
  plays together and one `api.myReactions` call for the same ids, then awaits the plays' spins through `spun.ts`'s
  batched read. Add a way for `spun.ts` to be asked for a list of Acts and awaited (e.g. `primeSpun(api, ids):
  Promise<void>`). Its batching and chunking are unchanged.
- `Plays` gains `billing(post): readonly Id[]` and `setBilling(post, ids)`. A post's billing is set once by `prepare`
  from Task 1. A play added later (live) is appended at the end. A new read of the page sets it again. `usePlays` gives
  the post's plays in billing order as `billed`, and keeps `plays` in play order for the effects.
- `Plays` gains `note(play): string | null` and `setNote(play, line | null)` (design, section 4). A note wakes only its
  post.
- `useOrigin` does the same for the ORIGIN box's plays: one `tallies` and one `myReactions` read for them, then billing.
- A Realtime `onTally` for a play merges into the same `tallies` store. It already does, since the store is keyed by Act.
  The test asserts the play's tag count grows and the billing order does not change.

Tests first: with the fake backend (`engine/ui/data/fake.ts`), a page whose post has three plays makes exactly one
`tallies` call and one `myReactions` call, and both include the plays' ids (count the fake's calls). A play with more
reactions is billed first. A live reaction that makes a later play the most drawn leaves the order as it was, and a
reread reorders it. A play that arrives live is billed last. Notes: setting one wakes that post's listener and no
other's.

## Task 3. The quiet tags, the chips and "+N more" (engine)

**Files:** `engine/ui/cards/Effects.tsx` (`PlayTags`, `PlayTag`), `engine/ui/cards/cards.css`,
`engine/ui/spin/Origin.tsx` (`CardOrigin`), `engine/ui/thread/Post.tsx`; tests in a new
`engine/ui/cards/tags.test.tsx`.

- `PlayTags` draws the post's plays in billing order. The first gets the one-line tag: the card's name, its caster, and
  its top three reactions small (the instance's reaction glyphs, from `useTally`, by count then the instance's reaction
  order), or no reactions when it has none (#79). The rest are chips: a color mark, then the caster and the card's
  name. A chip's ink is the card's `tag` hook's, else its alignment's.
- On a desktop the first three chips show, then "+N more". Under the thread's 40em breakpoint there are no chips and
  "+N more" counts every play but the first. "+N more" is a button with `aria-expanded` that shows the rest in place.
- A tag and a chip are each a `button` that opens the play's panel (Task 4). The tag is no longer a link. The message
  and the time leave the tag for the panel.
- Screen reader: the list keeps `aria-label="Cards played on this post"`. Each button's name is one sentence: "Whoops!
  by Mrs. Hooligan, 8 reactions. Opens the play." (with "no reactions" at zero). "+N more" is named "Show 2 more cards
  played on this post".
- `CardOrigin` draws its play as the same quiet tag, which opens the same panel.
- The space the tags take over the post is checked in the stories (Task 6). It is one line and a chip row on a
  desktop, and one line and "+N more" on a phone.

Tests first: the order follows billing; one play draws one tag and no chips; five plays on a desktop draw one tag,
three chips and "+1 more"; on a phone (match the breakpoint as the thread's tests do) one tag and "+4 more"; "+N more"
opens the rest; each button's accessible name; a tag shows at most three reactions, the largest first; a play with no
reactions shows none; a chip's ink comes from `tag`.

## Task 4. The play's panel: React, Spin thread, Go to post (engine)

**Files:** `engine/ui/cards/Panel.tsx` (new), `engine/ui/cards/panel.css` (new), `engine/ui/reactions/Reactions.tsx`,
`engine/ui/reactions/reactions.css`, `engine/ui/spin/SpinForm.tsx`, `engine/ui/thread/Post.tsx` (who owns the spin
form's state); tests in a new `engine/ui/cards/panel.test.tsx` and in `engine/ui/spin/Spin.test.tsx`.

- `PlayPanel` is a dialog: a glass popover anchored beside its tag on a desktop, and a bottom sheet under 40em. It takes
  focus, closes on Esc, its close button, or a pointer down outside it, and returns focus to the button that opened it.
  Its look is the glass's: the `effect` smoke, the play's ink or alignment for its border and glow, chamfered (as
  `EffectStrip`), and Anton for the card's name.
- It holds: the card's name; "Mrs. Hooligan · played 9:15 pm"; the message, quoted, when there is one; the card's note
  (`Plays.note`) when there is one; the play's reactions with React (`Reactions` with `act={play.id}`,
  `author={play.caster}`, `authorName` the caster's name), drawn in a glass look (`look="glass"` on `Reactions`, a
  class on its root, the same picker and refusals); "Spin thread"; how many threads were spun from it, each linked
  (`useSpunInto(play.id)`); and "Go to post".
- The reader's own play shows its reactions and no React, because `Reactions` already decides that from the reader's
  characters.
- **Spin thread.** The post owns which origin its spin form is open for: `Post.tsx`'s `spinning` becomes `spinOrigin:
  { id, label } | null`. The post's own "Spin thread" sets the post. The panel's sets the play and closes itself.
  `SpinForm` takes `label` in place of building one from `seq`: "Spin a thread from post 41" for a post, "Spin a
  thread from Mrs. Hooligan's Whoops!" for a play. Closing the form returns focus to whichever button opened it.
- **Go to post** is the tag's old link: the post's address in a thread, and the post the play landed on in an ORIGIN
  box.

Tests first: the panel opens from a tag and from a chip; Esc, the close button and an outside pointer each close it and
focus returns to the opener; React opens the picker, and picking calls `api.react` with the play's id; the reader's own
play has no React; Spin thread closes the panel and opens the form, whose submit calls `api.spin` with the play's id as
origin; the form is named for the play; the note shows when set and is absent when not; Go to post's `href`; a phone
width draws the sheet (`data-kb-panel="sheet"`) and a desktop the popover (`data-kb-panel="popover"`).

## Task 5. Whoops!'s layers: each tag its own ink, the readout and the notes (instance)

**Files:** `instances/divided-world/ui/cards.ts` (`tag`), `instances/divided-world/cards/whoops/Effect.tsx` (the
readout, about lines 665 to 690, and the notes), `instances/divided-world/cards/whoops/ConfigForm.tsx` (export
`SWATCHES`), a new `instances/divided-world/cards/whoops/names.ts` with a Node test,
`instances/divided-world/cards/whoops/whoops.css`; tests in `Effect.test.tsx` and `instances/divided-world/ui/index.test.tsx`.

- `tag` returns each Whoops! play's own ink, not only the top play's, and still `undefined` for an ink `luminance`
  throws on.
- `inkName(color): string` (`names.ts`): the swatch's name for a swatch ink, else the nearest swatch by hue, lowercased
  for the sentence ("yellow").
- The readout: segments in the layer's ink (`--kb-ink`), ordered top layer first, the top one marked
  `data-kb-top="true"` and lit, a clean one faded. The words are "3 layers · top: Spritey's yellow, 40% washed", the
  top layer's own share. It says "1 layer · …" for one, and "Washed clean" once every layer is. The caster's name comes
  from the effect's props: add `nameOf` to `EffectProps` (engine, `engine/ui/cards/types.ts`, passed by
  `PostEffects` from the thread's and the ORIGIN box's `nameOf`) if the effect has no way to name a caster yet. The
  hidden readout says the same sentence.
- Notes: for each layer, `plays.setNote` (through a `note` callback added to `EffectProps` beside `save` and
  `release`) with "Layer 3 of 3, on top · 40% washed", "Layer 2 of 3 · 0% washed", or "Washed clean", updated as the
  shares change (at most once per animation frame) and cleared when the effect unmounts.

Tests first: two Whoops! plays' tags each take their own ink; `inkName` for each swatch and for an off-swatch color;
the readout's segments are in ink, top first, with the top marked; its words with one, two and three layers and when
all are clean; the top layer changes when the top one is washed clean, and the readout names the next caster; the notes
for each layer, and the note cleared on unmount.

## Task 6. Stories and shots (engine and instance)

**Files:** `engine/ui/cards/Tags.board.stories.tsx` (new), `instances/divided-world/ui/whoops/Layers.board.stories.tsx`
(new), next to the existing `Plate.board.stories.tsx` and `Footer.board.stories.tsx`.

Stories: one play; three plays (the mockup's: Mrs. Hooligan's magenta Whoops! most drawn, Gloomba's Stick Around,
Spritey's yellow Whoops! newest); six plays; the panel open on each; each at a desktop width and a phone width; the
plate with one, two and three layers, partly washed and with one clean. The PR carries screenshots of each at both
widths, set against the mockup (`docs/research/2026-10-31-plays-on-a-post/mock-a-b.html`). Run
`.claude/skills/impeccable/scripts/impeccable detect --json` over the changed UI and answer what it finds.

## Last. The full build and the final review

`npm run build` green, with its output in the PR. The final reviewer's charter is the review focus below.

## Ways out of the states this touches

- The panel: Esc, its close button, a pointer down outside it, Back, or leaving the page. Focus returns to the opener.
- "+N more": a disclosure. It is closed again by a reread, and it hides nothing a player needs.
- The spin form opened from a play: its Cancel, as today.

## Review focus

- A reaction to a play: does the HUD's live estimate and the player's log count and name it as the settlement does
  ("reactions to cards it plays", "its card outdraws its target")? A play that settles one way and is estimated another
  is the log lying.
- Billing must never move a tag while it is being read: check every path that sets it (first read, page change,
  refresh, Back from the glass, a live play arriving) for a reorder the design does not name.
- The extra `tallies`/`myReactions`/`spunFromMany` reads per page at a busy instance's scale: one batched read each,
  never one per post or per play.
- A refusal or a timing that differs with who owns the play: React hidden on one's own play must come only from the
  reader's own characters, and the server's refusal must read the same for a play as for a post.
- Notes set from a busy effect: they must not re-render the page or other posts as a wash runs.
- The tag is no longer a link: every place that relied on it linking to the post (the ORIGIN box, any test or story,
  the log's "found there") still reaches the post.
