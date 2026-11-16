# Cards on a spun thread: design

Record, written 2026-11-16. The design session with the owner, after the owner asked: "Can we do a design for casting
cards on the first post of a Spun thread... I believe this may simply be a matter of removing an existing limitation.
It seems right to me, since the OP of the spun thread has content of its own - and the more egregious presentation of
the issue at the moment is the fact that a thread-level gimmick cannot be played on a spun thread at all." Its plan is
`docs/plans/2026-11-16-cards-on-a-spun-thread-plan.md`. Section 2 holds the one question the owner answered; the owner
then confirmed sections 2 to 7 as a whole. Where a section says a choice is the session's own, it is.

## 1. What was found

A spin makes a new thread out of an Act. The spun thread's opening Act, at seq 1, is a `spin` Act with words of its own
(`payload.body`), drawn as a post with the ORIGIN box set into it. Everything below was run through `play_card` against
a scratch database on localhost built from every migration up to `0373_play_landed_at.sql`.

| Play on a spun thread | What the server answers | Where |
|---|---|---|
| A post card cast on the opening post, by anyone | refused, "a card lands on a post" (22023) | `place_cast`: `if target_kind is distinct from 'post'` |
| A post Gimmick used on one's own opening post | refused, the same words | the same check |
| A thread Gimmick used by the spinner | refused, "a card lands on a post" (23514) | the trigger function `acts_well_formed`: `if new.kind = 'card' and t.kind <> 'post'` |
| A thread Move cast by anyone | refused, the same words | the same trigger |
| A character card cast from the opening post | refused, "a card on a character is played from one of its posts" | `place_cast`: `from_post` must be a `post` |
| A post card on a reply in the spun thread | lands | |

The owner's report is right, and so is the owner's sense of which is worse. A thread play's card Act is written
pointing at the thread's first Act (`place_cast`, `where a.thread = target and a.seq = 1`). On a spun thread that Act is
the `spin`, so the thread branch of `place_cast` passes every check of its own and the insert is then refused by the
trigger, in words about a post. No thread card of any kind can be on a spun thread.

The build of PR #738 reported (issue #739) that the thread-reach effects could be on a spun thread. That was wrong, and
the reason it was believable is a finding of its own: the test fake has no kind test in its thread branch
(`engine/ui/data/fake.ts`, `playBeyond`), so in the fake a thread play on a spun thread lands. The fake and the server
disagree, and no test plays a thread card on a spun thread in either.

**Is it only removing a limitation?** The refusal is not one check. It is ten places in SQL and two in the rules, and
behind them are reads that would leave the play out if only the refusals were lifted:

- *The refusals.* `acts_well_formed` (a `card`, a `set`, a `spring` and a `take_back` each need a `post` target);
  `place_cast` (the target, and `from_post` twice); `place_set`; `play_card` (a reply-carrying card finds its thread
  through a `post` target, and its version lock reads a `post`); `post_under_guard` (a reply drawn under a post);
  `spring_facts` (`a.seq = 1 and a.kind = 'post'`, so a thread Move set face down never lands when a quote in a spun
  thread springs it); `spin_written` (a spin pressed at a post needs `p.kind = 'post'`); `landsOn` and `decideSet` in
  `engine/rules/cards.ts`; and the fake's `from.kind !== 'post'`.
- *The reads that would go quiet.* `thread_page` builds its posts from `page_posts ... WHERE a.kind = 'post'`, and its
  plays, faces, states, releases, surfaces, spent, veils, `above` and `kept` are all derived from that, so a play on the
  opening post would land and never be delivered. `play_moment` raises "that is no play on a post". `card_target_reach`
  drops the thread's and board's effects for a character card read from the opening post. The views `my_cards_ended` and
  `my_posts_written_on` join `p.kind = 'post'`, so the player's log would miss an ended play and a written tail on their
  own opening post. `character_veiled_counts` moves a post count for any veiled Act, which is wrong for a spin.
  `claim_card_writes` leaves the opening post's words out of what the old voice is shown.
- *The screens.* The opening post has no marks strip, no play mark, no Lens and no character strip on its postbit
  (`engine/ui/thread/Post.tsx`, each behind `act.kind === 'post'`), `useTarget` in `engine/ui/cards/PlayActions.tsx`
  returns nothing for it, and `engine/ui/thread/Thread.tsx` bills plays only for `post` Acts.

**What needs no change.** Settlement and the live estimate test the play's kind and reach and find the target by id, so
a skim, a ride, an earn and a kept play on the opening post score as on any post; reactions on the opening post already
go to the spinner. Visits, reports and warnings already take `('post', 'spin')`. The veils' core (`author_veiled`,
`shown_author`, `post_veils_cover`, `thread_open.first_character`) is keyed on the Act's id. `card_target`,
`save_effect_state`, the surfaces, the drives, `take_back`, `reverse_card` and `my_posts_played_on` have no kind test.
Drawing is wired: since PR #738 `Post.tsx` draws `PostEffects` for a `spin` as for a `post`.

A `spin` Act cannot be edited (`edit_post` and `acts_well_formed` both need a `post`), so `post_version` of an opening
post is its own id and stays so.

## 2. The opening post is a post for every card (the owner's choice)

Asked whether the opening post counts as a post for every card play or only for casts and thread plays, the owner chose
every play: cast, Gimmick, set face down, a reply drawn under it, a character card cast from it, a spin pressed at it,
and thread plays on the spun thread. One rule, with no exception for a player to learn.

Weighed and not chosen: casts and thread plays only, leaving face-down cards and reply cards refused. It is a smaller
change, and it leaves a post that looks like any other and refuses some cards for a reason a player cannot see. The
checks to widen are the same ones either way.

## 3. One predicate, on each side (the session's choice)

"Is a post" becomes one named predicate in SQL and one in the rules, and every place in section 1 asks it.

- SQL: `post_kind(kind text) returns boolean`, `language sql immutable`, true for `'post'` and `'spin'`. A single
  expression, so Postgres inlines it and no plan changes shape.
- Rules: `isPost(kind: ActKind): boolean` in `engine/rules/types.ts`, beside `ActKind`. The rules, the screens and the
  fake import it; nothing compares a card's target with `'post'` by hand afterwards.

A `spin` Act is always a spun thread's opening Act: `spin_written` is its only writer and writes it at seq 1 of the
thread it creates. So "a `spin` Act" and "a spun thread's opening post" are the same set, and the predicate needs no
seq.

Weighed and not chosen: writing a `post` Act beside the `spin` Act when a thread is spun, so that the opening post is a
`post` in the data. It would change what a spin is in every instance's Acts and in the export, for a rule that a
predicate states in one line. Also not chosen: widening each check by hand to `in ('post', 'spin')`, as the visit and
report code already does. Twelve hand-written lists is how the fake and the server came to disagree; the sites that
already carry the literal list are left as they are (they are not about cards) and may be tidied to the predicate by a
change that passes through them.

The refusals keep their words. "A card lands on a post" is still said of an edit, a card Act or anything else that is
not a post, and "a card is set face down on a post" likewise.

## 4. Where an effect draws

Nothing new is decided here; it follows from two things already settled. The rule "An effect fills the post, border to
border" names the content area of a post in a thread: the post's body, between its bars and borders. The opening post's
body is `div.kb-act-main[data-kb-content-area]`, and an effect on the opening post fills it. The ORIGIN box is set
inside that body, above the spin's own words, and the owner chose in `docs/plans/2026-11-15-origin-box-effects-design.md`
(section 4) that the box stands above the opening post's effect: it is lifted over the ink (`data-kb-over-ink`,
`liftedOver`), its presses are its own, and an effect inside the box finds the box's own area (`bodyOf`).

The stories `Under` and `FabBright` and cases 8 and 14 of `e2e/origin-effects.spec.ts` already hold this, as fixtures
marked "not a state today's server produces". With this design the server produces it, so the stories seed real plays
and the marking goes.

The opening post gets what any post has: the marks strip with a mark for each play on it, the Lens, the armed card's
play mark, the visit tab, and the character strip on its postbit. The ORIGIN band keeps its own marks, which are of the
post it quotes. The two strips are in different frames (the opening post's header; the box's band) and never share one.

## 5. The log

No new words. The log names a post by its thread and number (`engine/ui/log/lines.ts`, `postWords`), and the opening
post has seq 1, so a play on it reads "your Whoops! on Gloomba's post #1" and links to it, as on any thread. A thread
play reads as it does on any thread. What changes is that the two views that skip the opening post are fixed, so a play
an admin ended on it, and a tail written on it, are in the log of the player it happened to. The log says nothing it
did not say before: no reactor, no class, no owner.

## 6. Ways out

The design adds no state. It lets the opening post be put in states that every other post can already be in, and each
of those names its way out already: a cast or a Gimmick with a time up ends at it; Whoops! is washed; a face-down card
is taken back, springs, or ends at its time; a reply drawn under the post returns to its own place when its play ends;
a veil ends at its time; a thread play ends at its time; and an admin can end any play (`reverse_card`, which reads the
play alone). The plan tests each way out on the opening post, since a way out that was never run there is not known to
work there.

One state existed before and was a dead end in waiting: a thread Move set face down could be sprung by a quote in a
spun thread and never land (`spring_facts`). Nothing could reach it, because a thread Move is not set on a thread; the
plan fixes it with the rest.

## 7. The masks

Nothing the design adds is computed from a private fact.

- The refusals compare characters, never accounts: a Gimmick is used on a post the caster's character wrote, and on a
  thread the caster's character started. Who wrote a post and who started a thread are public. The words are the same
  for every caster.
- `thread_page` delivers the plays on the opening post as it delivers the plays on any post, to every reader alike.
- The log views are the player's own.
- An author veil on the opening post hides the spinner as it hides any post's author, and the thread's starter in the
  board list already follows the veil (`thread_open.first_character`). As on a plain thread today, the veiled author
  using a thread Gimmick shows themselves by their own play; that is the game's, and unchanged.
- The count fix makes a veiled opening post move a spin count and not a post count, so the stand-in's and the author's
  counts agree with what their profiles list. Both counts are public, and move for every veiled Act alike.

## 8. The layers

Everything is engine: the predicate, the SQL, the rules, the fake and the screens. No card of Divided World's tests a
target's kind itself (each calls `landsOn`), so no instance card changes. The instance's part is its stories
(`instances/divided-world/ui/OriginEffects.board.stories.tsx`) and the browser test of them. No interface is added.

## 9. What an instance already holds

No Act changes. No play on an opening post and no thread play on a spun thread exists in any instance, because the
server refused every one. The migrations replace functions and views and add one function; they write no row.

## 10. Open

- **Editing the opening post.** A spun thread's opening post cannot be edited, and has no History. Cards do not need it
  (a card that reads a post's words reads the spin's own), so it is not designed here. Recorded, not filed: the owner
  has not asked for it.
- **The System's own plays.** The pool that picks posts for a Mod Bot's card reads `post` Acts alone (`pool_thread`,
  `pool_signals` and the rest), so a Mod Bot does not pick an opening post for a card of its own. A Mod Bot's visit
  already reaches it. Whether the pool should is a question about The System's reading of the board, not about what a
  player may play, and is left as it is.
- **Evergreen.** Divided World's Technician pays on `post` Acts alone (`instances/divided-world/classes/technician.ts`),
  so reactions on an opening post earn it nothing. That is about classes, not cards, and is left as it is.
