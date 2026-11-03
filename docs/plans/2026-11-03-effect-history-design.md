# Effect history: a play's moment

Record, written 2026-11-03. The design session on #164, made with the owner. A post's author can clear a card's effect
(wash a Whoops! clean, or, once Autocorrect is built, peel its strips), and that is their way out. But once it's
cleared, nobody can see what the play did, so the joke a caster paid for is gone from what a reaction is judged
against. This design keeps each play's **moment**: the post as it read when the play landed, with every play on it then,
as each stood. Each decision below was confirmed by the owner. The plan is `docs/plans/2026-11-03-effect-history-plan.md`.

## 0. Where it starts

- **A play's own landing is already in the Acts.** A Whoops! play's Act holds its ink and its seed (`whoops.ts`; the seed
  is the server's). Every version of a post is a public Act, the post's own or an edit's, and History reads them
  (`api.history`, `Versions` in `engine/ui/thread/lines.tsx`). The edit grace hides only "Last edited", never a version
  (`0022_edit_grace.sql`). The version current at a moment is one probe of `acts_edits`
  (`target_act_id, created_at desc, id desc`).
- **What an effect saved is overwritten.** `effect_state` (`0006_cards.sql`) is one row per play, rewritten by the post's
  author at each save (`save_effect_state`, last redefined in `0055_card_reach.sql`). A Whoops! save is its whole
  stroke list (at most 200 strokes, 256KB). Strokes carry no times. Once a play holds 200 strokes, later strokes stay on
  the author's screen only, while marking the layer clean still saves. So how far a layer was washed at any time but now
  is lost.
- **A play's mark stays after its effect is cleared.** Whoops!'s State reads "Washed clean" (marks-and-the-lens design,
  section 6), so the Lens can still be opened on a cleared play, with React and Spin in its Who row.
- **A thread spun from a card play** shows that play's mark alone in its ORIGIN box, with no post under it
  (`engine/ui/spin/Origin.tsx`, `case 'card'`).
- **Autocorrect** (#150) is being designed in its own session. The issue's answer for a card that re-matches each version
  of a post holds: its moment is the post's version at the time, with the play applied.

## 1. Before and now

**Decided** (the owner chose the recommendation): a reader sees a play **as it landed** and **as it is now**. There is no
timeline of the author's clearing steps.

The landing is what a caster paid for and what a reaction is judged against. A timeline would need every save kept: up
to 256KB each, re-sent whole with each batch of strokes, growing with every wash on a busy instance and carried by
every export. Weighed: the full timeline; and before and now plus a time for the clearing, which tells a reader little
the State line doesn't.

## 2. The snapshot at landing

**Decided** (the owner proposed it, and chose it over showing a play alone): when a play lands on a post, what every
other play on that post had saved is copied, in the same transaction, into an append-only record.

- **Why.** A play's Act is enough to draw that play as it landed, but not the plays already under it. A second Whoops!
  layer landing over a first one that was 40% washed, or a Stick Around cast on a post with a half-peeled Autocorrect,
  should show as readers saw it then. The owner: "just snapshot the state of every card at the time one is applied,
  unless that is impractical". It's practical: a post carries only a few plays (Whoops!'s stack of three, and one of
  each other card), so a landing copies at most a handful of rows. Storage grows with plays, which are paid, and never
  with washes.
- **What is recorded.**
  - `play_moments`: one row per play on a post, naming the version of the post that was current when the play landed
    (the post's own Act or its latest edit). A play with no row landed before snapshots existed (section 6).
  - `play_moment_layers`: one row per other layer on that post then, with a copy of its saved state and when it was
    saved, or none where it had saved none. The rows list the moment's layers exactly, so nothing is ordered by time.
  - Both are written once and never updated or deleted, with the guards `play_reach` has.
- **Which Acts take one.** Every Act that is a layer on a post (`card` on a post, `set`, `spring`; `LAYER_KINDS`), by a
  trigger on the Act's insert. So every path that lands a play takes a snapshot without being edited: a cast, a Set, a
  trap's Strike, a spring. A play beyond a post takes none. A caught play takes one, since its moment is still a moment.
- **What is not copied.** `face_down` is never read: a card back is a public Act, and which card it is stays private.
  Effects beyond a post save no state, and whether one was live at a moment is already a fact of its Act and its
  `play_reach.ends_at`. A reader's own unsaved scrubbing isn't saved anywhere.
- **On import.** An import writes rows as a replica (`tools/import-instance.mjs`), so the trigger doesn't fire and the
  exported moments are written as they were. The round-trip test holds both tables.

## 3. What a moment draws

**Decided:** every play on a post has a moment. Inside it, the owner's rule decides what is drawn: **a card whose effect
can change after it lands is drawn still, as it stood. Any other card is named in words.**

- **The rule, in the engine's terms** (the owner's: "any effect that is temporary or changes when stacked"): a card is
  drawn in a moment when its rules save state (`validateState`), stack (`stack` above 1), or end by time (`lasts`). It's
  read from the card's rules, so a card sets nothing. Whoops! is drawn. Autocorrect is drawn if its peels are saved, by
  the same rule. Stick Around is drawn on none of the three: its cast never changes, and its hold is not a picture.
- **Every play has a moment, Stick Around's included.** The owner: "a Stick Around cast doesn't change over time, but
  it may have other cards played on it at the time ... so ideally that should be part of the snapshot (i.e., Spinning
  the Stick Around cast shows it with a partially cleared Whoops or Autocorrect, if that was the state at the time)".
- **What the moment holds:**
  - the post's words: the version the snapshot names;
  - every layer on the post whose Act came before the play's, and the play itself. Each card that qualifies is drawn
    still, from its snapshot state, or as it landed where it had saved none;
  - each play beyond a post that was live then on the post's author, thread or board (it landed before, and ends after).
- **Named, not drawn**, in words on the frame ("Also on the post then: Stick Around, a card set face down, Glitter Bomb
  on Spritey"):
  - a card that doesn't qualify;
  - every effect beyond a post. The owner chose plays on a post only, since a character or thread effect's moment isn't
    one post's;
  - a card back, always as a back. It is never named, even after it sprang;
  - a caught play, as "caught by Trap Card": the spring Act made the trap's card public.
- **Every card drawn in a moment sees the post as it read then.** A card that follows edits (Autocorrect) re-matches that
  version.
- **Accessible words.** A card drawn still gives a line of words for the frame, as its State line does live ("Gloomba's
  yellow, 40% washed"), so the moment can be read as well as seen. It is the forum's own reading and meets the usual
  standards. It's not an obstacle, so "An accessible path costs what the obstacle costs" asks nothing more of it.

## 4. Where it shows

**Decided** (the owner chose the recommendations).

- **On the post, in place.** Each play's Who row in the Lens gains **As it landed**, beside React and Spin. Pressing it
  draws that play's moment in the post's body, at full size. Weighed: a miniature in the Lens (small, at the glass's type
  floor, and much taller); a glass dialog (modal, which the Lens's design avoided, and React would be behind it).
- **One moment per page, tied to the Lens.** It goes when the Lens closes, when another post's Lens opens, or on **Back
  to now**. Pressing As it landed again, or on another play, swaps it. While a moment shows, the post takes no strokes.
  Its marks stay live, so the Lens and React keep working.
- **A takeover keeps working.** The moment replaces what sits inside the post's live takeovers, never the takeovers
  themselves, so a Stick Around still lifts the post. A Lens opened inside the hold can show a moment there.
- **The look: frame and tag** (the owner chose it over a band and a lone tag). This is glass laid on a board post: plain
  words, never in character.
  - A chamfered glass frame around the post's body, in the play's ink (`inkOf`) or its alignment's, with its glow drawn on
    a wrapper as the Lens's is.
  - A tag hung on the frame's top edge: "AS IT LANDED · Nov 3, 4:12pm · Back to now".
  - Under the frame, the named list and each still card's words. The tag and the list are positioned over the post, never
    in the page's flow, as the marks are. The post's 12px Verdana is not restyled.
  - A post landed on before snapshots existed says so on the frame (section 6).
- **A thread spun from a card play** (the owner chose the recommendation): its ORIGIN box draws the play's moment, in the
  same frame, under the mark it shows today. The mark's link still goes to the post as it is now. A moment never
  changes, so this case of the box stops being live. A thread spun from a post keeps its live box.

## 5. Engine and instance

- **Engine:**
  - the two tables and the trigger, the read (`play_moment`), and the API;
  - which cards are drawn (a pure function of `CardRules`), and the still mode in `EffectProps`;
  - the moment's drawing, the Lens's control, the frame and tag, and the ORIGIN box.
  - Nothing names a card.
- **Instance:** Whoops!'s still drawing and its words. No new interface carries instance content: the engine reads the
  card's rules it already holds.
- **The still mode** is part of the effect contract for every card that qualifies. A drawn card is given `still: true`,
  a `save` and a `release` that refuse without asking, a `met` that does nothing, and a `show` whose view becomes the
  frame's words for that card. It takes no input, starts no animation, and lifts nothing. A test of each card that
  qualifies asserts it.

## 6. A play from before snapshots

A play with no `play_moments` row landed before this was built. Its moment draws the post's version current at the play's
time, found by time from `acts_edits` as History orders it, with the play alone drawn. The frame says "What else was on
the post then wasn't recorded". This answer is the session's, not a choice the owner was asked. No instance is
deployed, so only test and development data hold such plays.

## 7. The masks

- **The snapshot** reads only `effect_state`, which every signed-in player already reads (`0006`'s policy), and the Acts.
  It never reads `face_down`, and it does the same work whether a trap is set or not. A Set's snapshot row is the same
  as any play's.
- **The read** (`play_moment`) answers from public Acts, `play_reach` and the snapshot. It gives the same answer to every
  caller, the setter of a card back included, since a back is drawn as a back in every moment. It is granted as
  `effect_state` and `play_reach` are read: to a signed-in player.
- **Nothing is broadcast.** No Realtime event is added; a moment is the reader's own screen state.
- **The log is unchanged.** No Act is added, and nothing is done to anyone's characters.

## 8. A busy instance

- A landing copies at most the post's other layers' saves: a few rows, each at most 256KB. Storage grows with plays and
  never with washes.
- A moment is read only when asked for, or when a play-spun ORIGIN box loads. It is one request, made of primary-key and
  indexed probes: the snapshot by play, the version by id, the post's layers by `acts_target`, and the live effects above
  through `play_reach`'s indexes. Its cost doesn't grow with the board, the thread or the instance.
- A page draws one moment at a time, since one Lens is open at a time.

## 9. Ways out

A moment is something a reader looks at, not a state a player, character or post is put in. It goes when the Lens
closes, on Back to now, on another post's Lens, or on leaving the page. The ORIGIN box's moment is the box's content, and
"Go to post" leads to now. Nothing new holds anyone.

## Open

- **Autocorrect's still drawing** is its own design's (#150). By section 3's rule it is drawn if it saves its peels.
- **The Strategy Guide.** Whether its copy should mention As it landed. That copy is committed and approved by the owner
  (CLAUDE.md, "The fiction may lie; the log never does").
- **A timeline** of the author's clearing steps, if play ever shows it's wanted. It would need the saves kept, which this
  design weighed and declined.
