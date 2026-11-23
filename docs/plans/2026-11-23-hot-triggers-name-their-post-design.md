Record, written 2026-11-23.

# The hot triggers name their post, and the week's thread is a spin

A design session with the owner, who saw the Boss post in General every day about "today's hot post" without saying
which post it was, and asked whether that was as designed and whether a spin would fit better. The plan is
`docs/plans/2026-11-23-hot-triggers-name-their-post-plan.md`.

This changes the staff roster's pool (`docs/plans/2026-11-02-staff-roster-design.md`, sections 5 and 6) and the
chattier staff's prompt (`docs/plans/2026-11-22-chattier-staff-design.md`).

## 0. What happens today

- The pool's `hot` signal (`pool_signals`, latest `0358_blind_totals.sql`) is the window's busiest **threads**, ranked
  by how many posts they got, each with its ten most frequent authors. It names no post.
- `oldFlame` fires when a character the persona's memory favors or holds a grudge against is among a hot thread's
  authors. Its candidate carries the thread and `quoting: null, act: null` (`engine/system/pool.ts`, `candidates`).
  `homeTurf` and `hotOnBeat` are the same: a thread, no post.
- The prompt's reason for `oldFlame` says "a character you have strong feelings about wrote one of today's hottest
  posts" (`engine/system/chatter.ts`, `REASONS`). The persona is not told which character, is quoting nothing, and the
  post may not be among the thread's newest posts it is shown. A Boss with the highest priority wins the day most days,
  and the busiest board is General, so the Boss replies in General daily about a post he cannot see.
- The week's one pool thread start (`threadsWeekly`) goes to the day's top pick. It starts a plain thread on a board
  from the persona's beats, and the prompt is given `thread: null` (`supabase/functions/chatter/core.ts`, `onePick`):
  the trigger that won the day is dropped, and the opening post has the reason and nothing behind it.
- A pool post was always meant to quote "the post that set it off where there is one" (staff roster design,
  section 5). For the hot triggers there always is one; the signal threw it away.

## 1. Which post a hot trigger carries

**Decided: the most reacted** (the owner chose it over the newest, and over re-ranking the hot signal as posts).

- `oldFlame` carries the flame's post in that thread, inside the window, with the largest public reaction total; a
  tie goes to the newer post.
- The totals are read from `reaction_tallies_open`, so a post under a live totals veil counts as having none, as
  every machine read of totals already does.

Weighed: *the newest*, cheapest and always fresh, but often a throwaway line nobody reacted to, which makes "hottest"
false; *re-ranking hot as posts board-wide*, a larger change to a signal three triggers share, and `homeTurf` and
`hotOnBeat` are about threads by their nature.

## 2. All three hot triggers quote a post

**Decided** (the owner chose it over leaving them thread-level). `homeTurf` and `hotOnBeat` carry the thread's most
reacted post inside the window, by the same rule, from any author but the persona itself. Where the thread's top post
is the persona's own, the runner-up from another character is used; where the window holds no post but the persona's,
the candidate is dropped, since there is nothing to answer.

So each hot candidate has `quoting` and `act` set to that post, and goes in as a quoting reply, as `named` and
`quoted` already do.

## 3. The reason names the post

**Decided in the session** (put to the owner with the design and confirmed). The reasons become sentences filled from
the candidate:

- `oldFlame`: "*<name>*, a character you have strong feelings about, wrote one of today's hottest posts: the one you
  are replying to."
- `homeTurf`: "a thread you made has gotten hot; you are replying to its most reacted post today."
- `hotOnBeat`: "a thread on one of your beats is among the hottest today; you are replying to its most reacted post."

The name is the character's public name with its pronouns, from the names the prompt already reads (`namesOf`); the
opinion behind it is The System's own memory. A pick carried from before this change, with no subject, keeps today's
wording.

## 4. The week's thread start is a spin

**Decided: a spin when the pick has an Act** (the owner chose it over spin-or-nothing and over keeping plain starts).

- A pick whose trigger has an Act (a post, a move's end or keep, a reversal, an arrival, and now every hot trigger)
  starts the week's thread as a **spin of that Act**. It lands where a player's spin of it would: the origin's board,
  or the players' board where the origin is on the system board. The origin shows in the ORIGIN box as any spin's does.
- The one trigger with no Act, `successorStumbles` from the Boss entering its meltdown, keeps the plain thread on a
  board from the persona's beats, as today.
- The prompt is shown the origin's thread and the origin post, and told it is spinning a new thread off that post; it
  writes a title and the opening words.
- A persona on the old voice still never starts a thread (it cannot give a title), as today.

Weighed: *every start a spin, or none*, which drops the meltdown's thread, the one start whose subject is the board
itself; *plain starts shown the trigger*, which gives the opening post a subject but hides from readers what it is
about.

**The staff's way to spin.** Staff have none today: the player's `spin` checks `acting(through)` for a signed-in
account. A new `write_staff_spin(staff_key, origin, title, body, marker)`, service role only, holds the same rules as
`spin` and `write_staff_thread`: a persona that is not waiting or benched, the title and body within their settings,
an origin that exists and is not an edit, the system board redirected to the players' board. It writes the thread with
`origin_act_id` and a `spin` Act carrying the title, the persona's words and the pool's marker. The body is required
(a persona has something to say; a player's spin may be empty).

**Cards on a spin start.** A Set lands on the persona's own new post, and `staff_play_card` takes only a `post`
target, so a spin start offers no Set. It may offer a Cast on the origin where the origin is a post, as a reply
quoting it would. Decided in planning; whether a Set should ever land on a spin is section 6's first open item.

## 5. A persona's spin is its writing

**Decided** (put to the owner with the design and confirmed). Every pool read that means "a persona's own posts" reads
only `kind = 'post'` today: the waiting replies, the conversation view, presence, the priority tallies and the orphan
adoption. A staff spin would be invisible to them, so the Boss would never answer replies to his own thread, and a spin
whose spend failed would be posted again. Each widens to the persona's spins as well.

The thread read the prompt is given (`pool_thread`) reads `kind = 'post'` too, so a persona replying in any spun thread,
a player's or its own, is shown neither the opener nor what it was spun from. It reads the thread's spin Act as its
first post, with the spin's title and body, so a reply in a spun thread sees how it began. This is the same gap and is
closed in the same change.

Weighed: *an empty spin Act and a separate `post` Act carrying the words*, which every reader would see unchanged, but
which draws two openers where a player's spin draws one, and makes the staff's thread look unlike the players'.

## 6. Open

- Whether a Set may land on a spin Act, for a player or a persona. Today `staff_play_card` refuses a non-post target;
  this design does not change it.
- Whether the meltdown stumble should spin the Boss's own latest move instead of starting a plain thread. Not asked;
  the plain thread stays.

## 7. The rules

- **No player is ever stuck.** Nothing here adds a state a player, a character or a post can be put in. A staff spin
  is an ordinary thread: it sinks, locks and moves as any thread does.
- **A response never proves a private fact.** The post a trigger picks is computed from public reaction totals (with
  veils withheld, as `reaction_tallies_open` gives them) and public authorship. The flame is from The System's own
  memory, which is not a private fact of any player. No response, payload or timing reads an owner, a class or who
  reacted.
- **KayfaBB never knows which instance it runs.** Every part is engine: the pool, the prompt, the chatter function and
  the SQL. No instance content changes.
- **The System acts; it never destroys what a player wrote.** A spin quotes and shows a player's post; it changes
  nothing of it.
- **Append-only.** The spin is a new Act; nothing is updated.
