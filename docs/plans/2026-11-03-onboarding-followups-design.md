Record, written 2026-11-03.

# The onboarding build's follow-ups (#160): design

A design session with the owner on 2026-11-03 took up the twelve findings the reviews of #156 left in #160
(`docs/plans/2026-11-02-onboarding-plan.md`). The plan is `docs/plans/2026-11-03-onboarding-followups-plan.md`.

## 1. Scope

The owner confirmed this sorting ("Yes, that scope").

| #160 item | Where it goes |
| --- | --- |
| The tips panel's contrast is not machine-checked | This plan, section 3 |
| Feelin' Fab's CSS tests read source text | This plan, section 5 |
| Feelin' Fab at 6× CPU throttle | Parked under #130 (section 7) |
| `useInView` under server rendering | This plan, section 6 |
| Preferences are read more than once per board page | Moved to #124: the one shared read of the session and preferences that group designs. Building it here would build the same thing twice. |
| `spanWords`' minute ternary is a no-op | This plan, section 6 |
| check-guide's retyped-number heuristic has known misses | Left as written. The header of `tools/check-guide.mjs` names the misses and calls the check "a net for the common retype, not a proof". The owner chose not to widen it. |
| No screen says how to reach an admin | This plan, section 2 |
| F1: the reduced-motion tour test reads a marker | This plan, section 4 |
| O1: `hold.spec` presses Break free with `element.click()` | This plan, section 4 |
| O2: no e2e drives the spotlight, the HUD tour or `/welcome` | This plan, section 4 |
| O3: `tip_keys_ok`'s revoke under a CHECK | This plan, section 6 |

## 2. Reaching a person

**The defect.** The guide's last line ("that's a bug, so tell an admin") and the log's foot (`engine/ui/log/Log.tsx`, "Tell an
admin.") send a player to an admin, but no screen says how to reach one. The log's foot is the line CLAUDE.md's "The fiction may
lie; the log never does" depends on: a frustrated player steps back, sees a bug, and has nowhere to take it.

**Where the contact lives.** Weighed:

- *Set by admins at runtime* (chosen). An admin enters one or more labeled links, and they are stored in the instance's
  `settings` table, which the export already carries. A personal address stays out of the public repository, and changing it
  takes no deploy.
- *Committed in the instance* (`InstanceUi.contact`). Simpler, but the address is public in git, and an instance's admins change
  faster than its code.
- *Both*. A second source of truth for one fact ("Two lists that must agree are one list").

**Where it shows.** Settings needs a signed-in account, but the player who most needs a person is often the one who cannot
sign in. Weighed:

- *A public glass page `/contact`* (chosen). Readable signed out. Linked from the sign-in page, the foot of Settings' frame,
  the log's foot and the guide's closing line. The glass menu bar already carries eight tabs (`engine/ui/glass/MenuBar.tsx`),
  and a ninth would crowd the phone, so it gets no tab. The owner chose "a public glass page" from a proposal that put it in
  the menu bar, so this placement is for the plan's review.
- *Under the sign-in form and in Settings › Account.* No page of its own, and the log and guide would link to Settings, which a
  signed-out player cannot open.
- *A footer on every glass page.* The glass has no footer, and one would compete with the HUD on a phone.

**The page.** It is in the glass: plain and never in character (CLAUDE.md, "Settings, the account, errors and anything about
real moderation are written plainly"). It stands on the Settings page smoke, as `/updates` and `/alerts` do (`web/src/App.tsx`'s
surface map), so no instance has to name another recipe. Its words are the engine's:

> **Reach a person.** The admins run this instance. Write to them if something looks broken, if you're stuck with no way out,
> or about anything that isn't part of the game.

The admins' links follow, each one its label as a link. An `mailto:` link shows its address as text beside it, so a player
whose device has no mail client can still copy it.

**The admin's side.** The admin screen (`/admin/queue`, `engine/ui/admin/Queue.tsx`) gains a "How players reach you" form beside
Write an Update: up to five rows, each a label and an address. It follows `post_update`'s repair rule from
`supabase/migrations/0062_updates.sql`, the spirit of CLAUDE.md's "A validator tighter than the schema…":

- Whitespace is trimmed, and an empty row is dropped.
- A bare email becomes `mailto:`.
- These are refused, naming the predicate and the row: an address that is neither `https:` nor `mailto:`, a label over 40
  characters, an address over 300, more than five rows.

**Unset.** Until an admin sets a contact, the page says plainly: "This instance's admins haven't added a way to reach them
yet." The admin screen shows a notice that players have no way to reach the admins until this is filled in. **Open:** whether
an instance should refuse to come up without a contact (`seed_instance` requiring one) is left to the owner. The
plan builds the notice and not the refusal.

**The masks.** The contact is the instance's, written by an admin, and the same for every reader, signed in or out. It names no
account and is computed from nothing private. Who the admins are is already public (the Updates page is theirs). Which
characters they own is not, and the page says nothing of it.

**The layers.** The page, the form, the RPCs and the setting are engine. The instance contributes nothing: no copy and no
interface. The words are the engine's because a contact page reads the same in every instance. The guide's closing line is
Divided World's prose, and it links `/contact`.

**Ways out.** The page adds no state that a player, a character or a post can be put in. It is itself the way out the log's foot
names.

## 3. The tips panel's contrast

**The defect.** `tools/check-glass-contrast.mjs` models the smoke surfaces (`GlassSurface`). The spotlight's panel stands on
none of them. It is `--kb-glass-sheet` (`rgba(9, 5, 18, 0.92)` in Divided World's standard key) over the 72% ground scrim
(`.kb-tips-dim`) over whatever page is behind it, and that can be the light board, white.

**Chosen: model and rendered measurement both** (the owner, "Model + rendered").

- *The model.* The guard gains overlay sheets, a second kind of surface beside the smoke recipes. The worst pixel under a sheet
  is the sheet composited over the scrim, which is composited over white (the brightest page any theme can draw). The blur and
  the `saturate(0.7)` of the scrim cannot raise a maximum, so they are left out. Read against that worst: each text token the
  panel draws (`--kb-glass-text`, `--kb-glass-text-hi` and `--kb-glass-text-2` at 4.5:1; the kicker's `--kb-glass-pale` as
  body text at 4.5:1, since it sets a label size and not large text); the panel's border (`--kb-glass-pale`, a non-text
  boundary) at 3:1 against the scrim over white; and, under the high key, each at 7:1 as the high key's tokens are. The
  overlay sheets are listed by the engine as `GlassOverlay` (`'tips'` today) in `engine/ui/types.ts`, read from source as
  `GlassSurface` is, so a later overlay must be named. The scrim's 72% is read from `tips.css` and pinned by the guard's
  self-test, so a lighter scrim in the stylesheet goes red. `e2e/glass-ceilings.json` gains the overlay's worst luminance and
  each token's ceiling.
- *The rendered measurement.* `e2e/glass-text.spec.ts` photographs the spotlight's first tour step and its phone sheet over a
  light-theme board page and over the dark one, using section 4's unseasoned path, and holds the panel's lines to the overlay's
  ceilings.

Weighed and set aside: *model only* misses what the stylesheet does that the model cannot see (an inherited opacity, a layer
order). *Rendered only* would let a theme with a translucent sheet pass on whichever page the spec happens to photograph.

## 4. The onboarding's tests that read the wrong thing

**F1: reduced motion.** `engine/ui/tips/tour.test.tsx` asserts `data-kb-fade`, a marker Spotlight sets from the same choice
as Motion's props. If `Spotlight.tsx` made the fade unconditional and left the marker honest, the test would stay green. Chosen,
as the finding proposed: the test mocks `motion/react` so `motion.div` records the `initial` and `transition` it is given, and
asserts `initial === false` and `transition.duration === 0` under reduced motion, and `initial.opacity === 0` without it. Poison:
`initial={{ opacity: 0 }}` with `duration: 0.32` under reduced motion must go red. The marker stays for e2e's sake, and the
test no longer relies on it.

**O1: Break free.** `e2e/hold.spec.ts` presses from inside the page because a round trip per press drains the bar faster than
the test can fill it (its own header says why), and `element.click()` skips Playwright's visible-and-uncovered checks. Chosen:
keep the page's pacing, and have each press in the page loop first test that the button is visible (a non-empty box,
`visibility` not hidden, opacity above 0) and that `document.elementFromPoint` at its center is the button or inside it. The
first failure stops the loop and is returned to the test, which fails naming it. Poison: a transparent layer planted over the
button must go red.

**O2: an unseasoned path.** Every fixture and demo player is seeded `seasoned` (`engine/ui/data/fake.ts`, `Seed.account`). A new
`e2e/onboarding.spec.ts` signs in a fresh, unseasoned account with one character, as `e2e/focus.spec.ts` signs in its own. It
drives the following with real Playwright clicks and keys:

- the `/welcome` redirect on first board visit;
- the welcome's end;
- each spotlight step, by its Next button and by the keyboard, with Escape skipping;
- the HUD tour;
- the tips staying gone after a reload;
- Settings' Replay the tour bringing them back.

It runs at 1440 and on a phone at 390. It also gives section 3's rendered measurement its spotlight.

## 5. Feelin' Fab in a real browser

`instances/divided-world/ui/feelin-fab/Effect.test.tsx` reads `fab.css` by regex, because jsdom does not compute styles. Chosen:
keep the jsdom tests for the component's behavior, and pair the stylesheet's main claims with a computed-style check in Chromium
(`e2e/fab.spec.ts`, on `Fab.board.stories.tsx`'s posts):

- a moving post's layers animate, and carry `will-change`;
- a held post (`data-kb-moving="false"`) computes `animation-name: none` and no `will-change`;
- a post scrolled out of view computes `animation-play-state: paused`;
- the account's reduced motion (`data-kb-motion="reduce"`) and the device's reduced motion each compute `animation-name: none`,
  and the account's `data-kb-motion="full"` wins over the device's reduce;
- the text's `text-shadow` is the two-layer halo.

The regex assertions this replaces are removed from the jsdom test, so a claim lives in one place. Poisons, each planted by
style injection and each named red: an animation left on a held post, an out-of-view post still running, the device's reduce
ignored, the halo removed.

## 6. Small code fixes

- **`useInView`.** Its first render reads `typeof IntersectionObserver === 'undefined'`, which a server render would disagree
  with. Chosen (the owner, "Start false, decide in effect"): every first render is `false`, and the effect sets `true` where
  there is no observer, so the server and the client agree. Where a browser has no IntersectionObserver, the cost is one still
  frame. Weighed: `useSyncExternalStore` with a `getServerSnapshot` says the same thing at more weight; "document client-only"
  leaves an engine hook that is wrong for any instance that renders on a server.
- **`spanWords`.** `span.unit === 'minute' ? 'minute' : span.unit` is the identity, so it becomes `span.unit`. Its test pins
  each unit's singular and plural.
- **O3: `tip_keys_ok`.** A CHECK constraint runs its functions with the writer's privileges. Confirmed on localhost Postgres:
  with EXECUTE revoked from PUBLIC, an insert by a role that has INSERT on the table is refused, "permission denied for
  function". `0001_core.sql`'s default privileges revoke EXECUTE on every new function from PUBLIC, so any CHECK that calls a
  function carries the same trap. Today every writer of these rows is a definer function owned by `postgres`, so nothing breaks
  yet. Chosen:
  - A migration grants EXECUTE on `tip_keys_ok`, and on every other function a constraint calls, to PUBLIC. They are pure
    predicates and reveal nothing.
  - A catalog test in `supabase/tests/`, beside `0002-definer-search-path.sql`, reads every function a CHECK constraint, a
    column default or a generated column calls in `public` and refuses any that PUBLIC cannot execute.

  The red run is today's catalog.

## 7. Parked

**Feelin' Fab at 6× CPU throttle** (the owner, "Park under #130"). The measurement needs a GPU-composited browser, and CI and
the build containers have none. It becomes a sub-issue of #130, the group of checks that wait on something the build does not
have, with #160's numbers (light at 6×: 38–51 dropped frames against 4–10 for the static page; matching at 4×).

## 8. Open

- Whether an instance refuses to come up without an admin contact (section 2).
