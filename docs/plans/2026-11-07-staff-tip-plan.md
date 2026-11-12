# Telling a newcomer what the Personality Cores are: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-staff-tip-design.md`. One build session builds it in one
PR from `main`.

Every task is test first: name the test, record its red run, then write the code. No `check-*.mjs` is added. No
migration and no SQL: a tip seen is kept by its key in `account_preferences.tips_seen`, whose check
(`tip_keys_ok`, `supabase/migrations/0068_tips.sql`) holds a key's shape, not a list, and `staff` fits it. The fake's
seasoned account marks every `TIP_KEYS` entry seen (`engine/ui/data/fake.ts`) and the test world words every key
(`engine/ui/test-world.tsx`), so both take the new key with no edit.

The layers: Task 1 is the engine's (`engine/ui/tips/`, `engine/ui/thread/Post.tsx`) and the instance's words for it
(`instances/divided-world/ui/onboarding.ts`), together because `instanceUiProblems` refuses an instance that lacks a
key the engine has. Task 2 is the instance's alone (`instances/divided-world/guide/`). Task 3 is `e2e/`.

## Task 1: the `staff` tip, asked by a staff post in view

Model: sonnet

Files: `engine/ui/tips/keys.ts`, `engine/ui/thread/Post.tsx`, `instances/divided-world/ui/onboarding.ts`, a new
`engine/ui/tips/staff.test.tsx`.

- `keys.ts`: add `'staff'` to `TIP_KEYS`, after `'first-card'` and before `'shine'`, and a line to the header's list:
  "`staff`: the first staff post in view in a thread, pointing at its staff badge (docs/plans/2026-11-07-staff-tip-design.md)."
  It is not a tour key and has no action.
- `Post.tsx`, in the `Post` component: when the post's character is staff (`person?.character.staff`), the postbit is
  drawn (`!plain`), and the badge drew (the staff character's `kb-postbit-group` inside the article, marked
  `data-kb-staff`, below, `ref`), watch that badge with
  `watchInView(badge, onChange, { threshold: 1 })` (`engine/ui/shine/inView.ts`) and ask
  `useTip('staff', badgeRef, { when: inView })`, where `badgeRef` is a ref whose `current` is that badge element.
  Register the watch only while `useTipsStore().unseen('staff')` is true, read when the effect runs, so an account that
  has seen it, or has tips off, watches nothing. Keep `Post`'s `memo` intact: the new state lives inside `Post`, and
  nothing new is handed to `Postbit`.
- The target: the member groups build has landed, so the staff badge is the postbit's `kb-postbit-group` span
  (`engine/ui/postbit/Postbit.tsx`, line 94): the Personality Cores `GroupBar` and, for the Boss and a Mod Bot only,
  `StaffBadge`'s office title, whose own `data-kb-staff` span draws nothing for a member or benched Core. The span gains
  `data-kb-staff` for a staff character, so the tip points at the whole badge at every office; `StaffBadge.tsx`'s own
  attribute keeps its office value.
- `onboarding.ts`: add the tip, after `'first-card'`, exactly:

  ```ts
  staff: {
    title: 'These are Personality Cores',
    line: 'I made them to run the board so I wouldn\'t have to. No player is behind any of them: an AI writes every word. One is the Boss, some are moderators, the rest just hang around. Argue with them all you like.',
  },
  ```

Tests first, in `staff.test.tsx`, driving the in-view watch as `engine/ui/tips/shine.test.tsx` drives its loop (a stubbed
`IntersectionObserver` the test calls), on a thread rendered through `LoadedThread` in the test world with an account
whose tips are on, welcome seen and tour seen (the shape `engine/ui/tips/inplay.test.tsx` uses), and a staff post seeded
with `fake.seed.staffPost` as `engine/ui/thread/Staff.test.tsx` does:

- **Shows on the badge.** With the staff post's badge reported in view, a dialog named "Title of staff" shows, and its
  cut-out is the badge (the spotlight's target is the `[data-kb-staff]` element). Red before: `'staff'` is no tip key.
- **Waits for view.** With the badge out of view, no dialog; reported in view, the dialog shows.
- **Not for a player's post.** A thread of player posts alone, all in view: no dialog, and no badge watched.
- **Not once seen.** An account with `staff` in `tipsSeen`, and one with tips off: no dialog, and the stub's `observe` is
  never called with a badge.
- **Got it.** Got it calls `seeTip('staff')` on the fake, and a second staff post coming into view asks nothing more.
- **One a load.** Two staff posts both in view: one dialog, on the first reported.
- **Not over typing.** Focus in the composer when the badge comes into view: no dialog this load (the store's rule, held
  here once).
- `engine/ui/tips/problems.test.ts` needs nothing new: it builds its tips from `TIP_KEYS`, and its "no tip" test names
  `grid`. Run it and `instances/divided-world/ui/index.test.tsx` (which runs `instanceUiProblems` on the real instance) and
  record that the latter is red before `onboarding.ts` has the tip and green after.

## Task 2: the Guide's Personality Cores and Rules and visits sections

Model: haiku

Files: `instances/divided-world/guide/strategy-guide.md`, `instances/divided-world/ui/index.test.tsx`.

Test first, in `index.test.tsx`, beside its other tests of the real instance: parse the instance's guide with `parse`
and `sectionsOf` (`engine/ui/guide/markdown.ts`) and assert that the section titles include, in this order, "The
System", "Personality Cores", "Rules and visits", "Coming attractions", one after the other; and that the Coming
attractions section's text contains none of "Mod Bots", "warn bar", "Reports", "appeals". Record its red run.

Then, in `strategy-guide.md`:

1. Insert after the end of `## The System` (after the paragraph that ends "the log is where to look."), exactly:

   ```markdown
   ## Personality Cores

   The staff here aren't players. They're **Personality Cores**: characters with no person behind them, every word written by an AI. I made them to run the board so I could spend more time on my yacht. You'll know one by the Personality Cores bar under its name, and the title beside that says what it does:

   - **ADMINISTRATOR** is the Boss, who runs the board this season. Every season gets a new one, and the old one usually sticks around.
   - **MODERATOR** is a Mod Bot, who keeps the rules (see [Rules and visits](#rules-and-visits)).
   - A Core with no title is just hanging around.

   They post, they argue, they hold grudges, and they remember. Reply to them like anyone else. Some of them play cards, too. They never react to anything: every reaction you see was left by a player.

   ## Rules and visits

   The staff can set **rules** for a board: no all caps, no double posting, a word every post has to use, that sort of thing. A rule never stops you posting. It's announced when it's set, and it ends by itself when it expires.

   Break one and a Mod Bot comes to **visit** your post. The visit shows on the post with a clock, and its mark opens what it's charging and when it files. Until it files, anybody reading the thread can try once to **talk it down**: answer the Mod's question, pay its bribe, or distract it with a card played on the thread. Get it wrong and your next post draws a visit of its own. Mods also patrol their boards, and a post that breaks no rule can still get a visit if a Mod doesn't like it.

   A visit that files puts points on that character's **warn bar**, shown under its name on its posts. The points drop off by themselves after a while. A full bar means a **ban** for that character alone: it can still read, but it can't post, react or play cards until the ban ends, which it does by itself. Your other characters carry on as normal. [My log](/log) says why, and until when.

   - **Reports.** Think a post breaks a rule? **Report**, under the post, asks a Mod Bot to judge it. It costs a little Aura, and the form says how much and how many reports your character has left today. The Mod can send a visit, dismiss it, or decide you're wasting its time and visit your own latest post instead. A report is public, and it names the character who made it.
   - **Appeals.** Think a filing was wrong? The post's mark lets its author **appeal**, once, for the price it shows, refunded if the appeal wins. A ban is appealed to the Boss.
   ```

2. Replace the `## Coming attractions` list with exactly:

   ```markdown
   - **Permanent bans**, with an Unban that ends them.
   - **More cards.**
   ```

   and leave the paragraph under it ("That's the game as it stands. …") unchanged.

3. Leave every other section unchanged. The System's "Some of its parts are still switched off while the game is young"
   stays: Coming attractions still lists what is not built.

Run `node tools/check-guide.mjs` and record it green: the new prose types no number, and its one fragment link
(`#rules-and-visits`) names a section. If it flags a word, reword the sentence; never add a marker the screen settings
do not carry (the design, section 4).

## Task 3: e2e, the tip on a thread

Model: sonnet

Files: `e2e/onboarding.spec.ts`, `e2e/onboarding.ts` if a helper is needed.

- Add a test: an unseasoned account signed in, the welcome finished and the tour walked (`signInUnseasonedOnBoard`,
  `walkTour`), then a thread with a staff post opened on a fresh load: the dialog "These are Personality Cores" shows,
  pointed at that post's badge; Got it closes it; a reload of the same thread shows no dialog. Seed the staff post on
  the fake as the e2e boards do (`e2e/boards/`), or open a thread the fake's world already holds with one.
- Run the whole e2e suite once (`--trace off`) and record it: a spec that opens a thread with a staff post on an
  unseasoned account may now meet this tip where it met none. Where one does, the spec walks it or seasons the account
  first, as the spec's own subject decides; never by turning tips off for every spec.
- Run the glass-text and a11y specs that cover the spotlight (`e2e/glass-screens.ts`, `e2e/a11y.spec.ts`) and add the
  staff tip's spotlight to them where they list the tips' scenes.

## Review focus

- A thread full of staff posts (a Staff Announcements board): how many in-view watches register for a fresh account, and
  that they all go once the tip is seen or skipped, not at the next load.
- `Post` is memoized and drawn per post on every page of a busy thread: the new hook must not make a postbit redraw
  that the memo used to skip.
- The badge's markup, if the member groups build lands first: that the tip's target is still the staff chip and the
  test still finds it.
- The Guide's Rules and visits section against what is built: every claim (one try each to talk a visit down, a
  failed try tailing the next post, patrols, a backfired report visiting the reporter's latest post, an appeal's
  refund) checked against `docs/plans/2026-11-06-mod-bots-design.md` and the code, and nothing deeper than the surface.
- The tip and the Guide never imply a person is behind a Core, and never say more about who is behind a player's mask
  than the Guide's The masks section already does.
