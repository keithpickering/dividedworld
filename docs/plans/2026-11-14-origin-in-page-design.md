# The ORIGIN box arrives with the page

Record, written 2026-11-14. The design session with the owner, after a spun thread's ORIGIN box showed slow to draw on
the deployed instance. Its plan is `docs/plans/2026-11-14-origin-in-page-plan.md`. Sections 2 and 3 were asked one at a
time and answered by the owner; where a section says a choice is the session's own, it is. The owner confirmed the
summary before the plan was written.

## 1. What was found

The ORIGIN box (`engine/ui/spin/Origin.tsx`) is the one part of the thread screen that is not in the page's single
read (`thread_page`, the forum-load design, `docs/plans/2026-11-05-forum-load-design.md`). It is drawn inside a spun
thread's first Act, so only on the page that holds that Act, and after the page arrives it reads, in stages that wait
on each other:

1. The origin Act (`api.act`) and the card plays on it (`api.cardsOn`, 21 rows), together.
2. Those plays' ends (`endsOf` in `web/src/data/supabase.ts`), where there are plays.
3. Tallies, the player's own reactions, the threads spun from each (`primeSpun`), and the effects' saved states and
   the player's releases (`readEffects`), together.
4. The characters' names and faces (`useCast`, which waits on the Act and the plays), and, where the origin is a card
   play, the post's place (`useLocated`) and the play's moment (`play_moment` or `spin_moment`), each of which waits on
   the Act. The effect's code chunk loads after that.

Each is a request PostgREST plans on every call (plan-once's open item, `docs/plans/2026-11-13-plan-once-design.md`
§7), eight of them selects on `acts_public` or views over it. The box's delay is the cost of one request three or four
times over. What one request costs on the deployed instance was not measured in this session (§7).

## 2. Where the origin's data travels: inside `thread_page` (the owner's choice)

Weighed:
- **Inside `thread_page`** (chosen). The page that holds a spun thread's first Act carries an `origin` part, and the
  origin's ids join the lists the function already builds for tallies, the caller's reactions, spins, saved states and
  releases. One read with a kept plan, no request after it, and that logic written once.
- **A second function called beside `thread_page`.** `thread_page` stays as it is, but the box costs a request, and
  the tallies, reactions, spins and states are written a second time.
- **The client's reads, flattened.** No SQL change, and still about a dozen requests, each planned on every call.

## 3. The moment and the post's place travel too (the owner's choice)

A thread spun from a card play on a post or on a character shows that play's moment. `thread_page` carries what
`spin_moment` or `play_moment` answers, chosen as the box chooses today (the spin's own moment where the place names
the pressed post and the play is on a character, else the play's), and the thread and number of the play's post for
the mark's Go to post. Weighed: leaving the moment as one read after the page, which fixes a post's box and leaves a
play's box at two stages.

The moment functions refuse by raising, and a raise inside `thread_page` would fail the page. So the page's read of a
moment answers null where they would refuse (a thread's play, a board's play, an Act that is no play): the box then
draws its head alone, as it does today. The functions themselves are unchanged, and the Lens still calls them when a
reader opens a moment.

## 4. The document's `origin`

Present only where the page's Acts hold the thread's first Act and the thread has an origin; absent on every other
page and thread. Its fields:

- `act`: the origin Act as `acts_public` shows it; null where it is not there.
- `plays`: the first 20 layer Acts on it (`LAYER_KINDS`), oldest first, then the `card_end` of each card among them,
  as `cardsOn` answers.
- `more`: whether a 21st play exists.
- `moment`: §3; null where there is none.
- `at`: `{ thread, seq }` of the post a card-play origin is on; null otherwise.
- `cast`: for the origin's author, each play's caster, and the character a play at character reach is on: the
  `character` and `profile` objects in the shape `people` gives them. The session's own choice: a list of its own,
  never `people`, so the page computes no post count, standing, reveal or Turn for a character with no postbit on it.

The origin Act and its 20 plays join `ids` (so `tallies`, `mine` and `spun` hold them) and the plays join
`wanted_plays` (so `states` and `releases` hold those of the cards the instance draws an effect for). The client's
`asked` list gains the same ids.

## 5. What the box does now

- It draws from the document on its first frame. Its reads of the Act, the plays, the ends, tallies, reactions, spins,
  states, releases, characters, the post's place and the moment are removed. The session's own choice: no fallback
  path stays beside the document; the old reads are deleted.
- It still listens on the origin thread's channel (`api.subscribeThread`): an edit of the origin, a play on it, a saved
  state and a tally arrive as before. A play heard live still reads its own saved state and release (`readEffects`
  for the one Act), and a caster heard live who is not in `cast` is read by `api.characters`: one read for an event,
  never a chain.
- A page read again (a rejoined channel, a catch-up) brings the origin again and the box takes it in: the newer of the
  Act held and the Act read (`newer`), the plays added, the billing set once per read. Today a rejoin reads nothing of
  the origin.
- "Loading the origin…" and "could not be read. Try again" are no longer states of the box: it arrives with the page,
  and a page that fails has the thread screen's own failure and retry. "The Act this thread was spun from is not
  there" stays, for a null `act`.

No state a player, a character or a post can be put in is added, and the two removed are states of a read, each
replaced by the page's own.

## 6. Scale, masks, layers

- **Scale.** The origin adds at most 21 plays read by `target_act_id`, their ends, one Act by key, one moment by key
  and at most 23 characters by key, on the one page of a spun thread that holds its first Act. A page without an origin
  runs none of it: each added read is keyed on a value that is null there. Every page's statement plans the added
  reads once on a connection (plan-once §3). The scale test of `thread_page` gains a spun thread whose origin holds
  more plays than the box lists, in a large instance.
- **Masks.** `origin` holds what `acts_public`, `reaction_tallies`, `characters_public` and the moment functions
  already answer to any caller, by the same rows; `mine` and `releases` are the caller's own, as they are for the
  page's posts. Nothing is computed from who owns a character, a class, or who reacted. A veiled origin's author is
  the stand-in `acts_public` shows, and `cast` names that stand-in, never the author. The document's size and the
  read's time vary with the origin's public plays alone.
- **Layers.** All of it is engine. No instance content is involved and no interface between them changes.

## 7. Open

- What one request costs on the deployed instance, and why (the Nano's shared CPU, or connections the API closes when
  idle so that kept plans are lost), is unmeasured. This design removes the chain either way. After it is deployed,
  the edge logs' median and p95 for `/rpc/thread_page`, and a reload a few seconds after a first load, say which it
  is. A build session touches no deployed database, so the session that dispatches it, or the owner, reads that.
- The client's other selects on `acts_public` are still planned on each request (plan-once §7).
- The effect's code chunk still loads once the page names the card, as it does for a post's effect. Loading it earlier
  is a separate concern, not taken up.
