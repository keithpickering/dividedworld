# The core-loop build's questions, answered

Record, written 2026-10-29. The owner's answers to the design questions the engine build raised (#4, and #3), and
the plan for the change that follows them. The questions were written against PR #2 at
`26ad90480fd2c8af735e2aacc9fad739ddee0826`; every file and function named below is on that head. The design these
refine is `docs/plans/2026-10-28-core-loop-design.md`, and the plan it built is
`docs/plans/2026-10-28-core-loop-engine-plan.md`. Numbers are #4's.

## Kept as built

- **1.** Halving is per voting player, over that player's votes on one character's Acts, in the order the Acts were
  made. This is the design's rule.
- **5 and 8.** Only a signed-in player reads boards, threads and Acts, and every Realtime channel is private. If
  guests ever read, that becomes an instance setting.
- **6.** What each class earned per window stays private; the season review is an admin's read.
- **10.** Open, invite or closed registration; a login opens its account at its first sign-in; while registration is
  closed, a login with no account waits for an admin.
- **11 and 14.** The inviter sees whether an invite is used, never who used it; no cap or expiry on invites yet. Item
  16 below changes when "used" shows.

## Changed

- **2. One player, one vote per Act, whenever the reactions come.** As built, a player reacting once on Monday and
  again on Tuesday is paid 1.5 votes, against 1 for the same two reactions on one day, so spreading reactions out paid.
  Now a player's vote on an Act has one weight, set by the halving in the window the player first reacted to it, and
  a later window that changes the player's reactions there pays the difference in each quadrant's share at that
  weight: Monday pays a whole vote on its quadrant, Tuesday pays −½ on Monday's quadrant and +½ on the new one. The
  same arithmetic pays a removed reaction, when there is one.
- **3. Each vote counts once per Face per target.** Two Sweet cards from one Face's player on one post do not pay the
  same reactions twice; the votes are counted for the earlier card.
- **4. Every number in the design's economy is a setting.** The classes' and cards' numbers move from the instance's
  code into its settings, which `withOverrides`, the playtest profile and the `settings` rows reach, so the season
  review can retune the Lurker's +0.10 without a deploy. The engine still never reads them.
- **7. A missed settlement is settled window by window.** Each missed day is its own window, settled in order, so the
  halving and the Lurker's three-post limit always run over one window's length.
- **9. The reveal is broadcast.** It is The System's big moment, and a reader sitting in the thread watches it
  arrive.
- **15. A Lurker's call needs a crowd.** Where a post ends up is read without the calling Lurker's own vote, and a
  call is paid only once at least three other players have reacted to the post: in the window in which the third
  arrives, by the direction the post holds then.

## Decided by the owner

**16 and 17. Masks change at the tally.** Two timing leaks were found: someone polling the character list, or an
inviter watching "used", saw a new mask appear to the minute; and the reveal showed each Turn's exact time, so one
player Turning three masks in one sitting showed up as one player. The owner chose one rule over separate patches:

- A new character can be made at any time and **debuts at the next settlement**: until then only its player sees it,
  and it cannot act.
- A Turn takes effect at the next settlement. Until then its player can change or withdraw it, and the cooldown runs
  from when it takes effect.
- Each settlement, The System posts **the tally**: one Act naming the night's debuts and announced Turns ("Tonight,
  Pipewrench has Turned").
- An invite shows as used only once the settlement after its account opened has run.
- The reveal dates each Turn by its window, never by the minute.

Everything that happened to masks in a day lands together, so nobody's sitting can be picked out of it; the cost is
up to a day's wait for a new mask, which is also the debut. The silent-Turn counter still works, from the next tally.
Weighed: hiding only what is shown (a debut's first post would still give the minute away); leaving timing as play.

**12. Names must look different.** Two characters' names may not be the same once letters that look alike across
scripts are folded together (Unicode's confusable skeleton, UTS #39) and case is ignored. A Cyrillic а in
"Pipewrench" is refused; "Pipewrench II" and "The Real Pipewrench" are fine. An imposter nobody can see through can
only be believed, not read, and a perfect lookalike would let one player put words in another character's mouth with
no card and no cost. Weighed: lookalikes as play; Latin letters only.

**13 (#3). Sign-in is passwordless.** Players sign in with a code or link sent by email; password sign-in is switched
off in Auth. There is then no password endpoint whose timing could tell whether an address has an account, and asking
for a code is answered alike for every address. The game account, which is the private fact, still opens only at
first sign-in with an invite. Whether Auth's own code request takes the same time for an address it knows is
measured once, before the playtest, on a test project the owner creates (build sessions never touch a deployed one).
Weighed: keeping passwords and putting Auth behind a proxy if `/token` leaks (every read and live update would then
pass through our functions); accepting and documenting it.

## Plan

For PR #2's build session as a fix round, or for a build session after #2 merges; the owner chooses. Tests first, as
always, and each new check driven red.

### Task A. One vote per Act across windows (2)

- `engine/rules/votes.ts`: the weight of a player's vote on an Act is fixed in the window of their first reaction
  there; a later window's shares are paid as the difference from what has been paid, per quadrant, at that weight.
- A private table of each player's paid weight and shares per Act, written by `apply_settlement` and read by
  `settlement_input` (`supabase/migrations/0003_aura.sql`, `0004_schedule.sql`, in a new migration).
- **Tests first:** Monday and Tuesday together pay exactly one vote; the halving rank is never re-earned in a later
  window; a second reaction in a later window moves half the vote from one quadrant to another.

### Task B. A Face's Sweet votes counted once (3)

- `engine/rules/settle.ts` (the played cards' `targetAfter`) and `instances/divided-world/classes/face.ts`: per
  player and target, each vote is counted for the earliest of that player's Sweet cards on it.
- **Tests first:** two Sweet cards pay what one would.

### Task C. The economy as settings (4)

- `instances/divided-world/settings.ts`, `instances/divided-world/classes/*.ts`, `instances/divided-world/cards/`:
  every number in the design's section 10 is read from settings; `withOverrides`, the playtest profile and the
  `settings` rows reach each one.
- **Tests first:** an override of the Lurker's call changes what a call pays.

### Task D. Missed windows, one at a time (7)

- `next_settlement_window()` (`supabase/migrations/0004_schedule.sql`) returns one window of the instance's settlement
  length; `supabase/functions/settle/core.ts` settles windows in order until it is caught up.
- **Tests first:** two missed days settle as two windows; a crash between them resumes at the second.

### Task E. The Lurker's call needs a crowd (15)

- `engine/rules/settle.ts` (`endsUp`, the rank) and `instances/divided-world/classes/lurker.ts`: the direction for a
  given Lurker leaves out that Lurker's player; a call is paid in the window in which the post first has three other
  reacting players. The three is a setting.
- **Tests first:** a sole reactor is never paid; the third other player's arrival pays the call in that window, by the
  direction then; a Lurker reacting first to sixty fresh posts earns nothing from them alone.

### Task F. Masks change at the tally (16, 17, 9)

- `create_character()` (`supabase/migrations/0009_registration.sql`): a character debuts at the next settlement's end;
  `characters_public`, `acting()` and the reveal ignore it until then; its player sees it as waiting to debut.
- `turn()` (`supabase/migrations/0007_seasons.sql`): a Turn is pending until the next settlement; its player may
  change or withdraw it until then; it takes effect, and its cooldown starts, at the settlement.
- The settlement posts The System's tally Act (debuts and announced Turns) and broadcasts it. The reveal runs from the
  settlement of the season's last window and broadcasts its Acts; the hourly `kayfabb-reveal` job goes.
- An invite reads as used only once a settlement has run after its account opened; `reveal_season()` dates each Turn
  by window.
- **Tests first:** a character made mid-window is absent from `characters_public` and cannot act until the
  settlement; a pending Turn changes no class rule's input until then; two Turns made minutes apart are
  indistinguishable in the reveal from two made hours apart in the same window; an invite's "used" does not change
  between settlements; the reveal's Acts are broadcast.

### Task G. Names that look different (12)

- The Unicode confusables data (its version recorded) loaded by a migration; a `name_skeleton()` SQL function; a unique
  index on each character's skeleton; the same data in TypeScript for the client's preview.
- **Tests first:** a Cyrillic а is refused against a Latin name; a name differing only in case is refused;
  "Pipewrench II" is allowed.

### Task H. Passwordless sign-in (13)

- `supabase/config.toml`: password sign-in off; email codes or links on. `supabase/functions/account/core.ts` and
  `supabase/functions/_shared/gotrue.ts`: request a code and verify it, in place of sign-up, sign-in and reset, with
  the same words and the same one-second floor for every address.
- **Tests first:** requesting a code answers an address with an account and one without alike, in words and time;
  no path takes a password.
- **Measured once, not in the build:** Auth's own code request, timed for an address it knows and one it does not,
  on the owner's test project. The result goes on #3.

## Ways out of the states this adds

| State | Its way out |
|---|---|
| A character waiting to debut | The next settlement |
| A pending Turn | The next settlement; its player may change or withdraw it until then |
| A login waiting on a closed registration | An admin opens it |

## Review focus

- A debuting character reachable by any path before its settlement: a quote, a spin, a card target, a direct id.
- The tally and the reveal running twice for one window, or one run failing between its Acts and its broadcast.
- The paid-weight table and a window retried after a partial failure: never paying a difference twice.
- The confusables data's version against the Unicode release the client's copy carries.
