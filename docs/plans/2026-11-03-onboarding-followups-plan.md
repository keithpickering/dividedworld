Record, written 2026-11-03.

# The onboarding build's follow-ups (#160): plan

The design is `docs/plans/2026-11-03-onboarding-followups-design.md`; each task names the section it carries out. Each task is
tested first, with its red run shown, and is reviewed by a spec reviewer and a quality reviewer
(`.claude/skills/build-session/SKILL.md`). The PR says `Closes #160` only once every item below is fixed, moved or parked as
section 1 of the design says. Task 9 moves and files the rest.

Layers: everything here is engine, except Task 5's tests and Task 8's guide line, which are Divided World's
(`instances/divided-world/`). No task makes the engine name an instance.

Migrations: the next free numbers at the time of writing are `0072` and `0073`, and the build takes whatever is free when it
lands. Every SQL change is a migration in the same commit (CLAUDE.md).

## Task 1: `spanWords` and `useInView` (design, section 6)

Files: `engine/ui/characters/format.ts` (`spanWords`), its test beside it (`format.test.ts`, created if absent);
`instances/divided-world/ui/feelin-fab/inView.ts` (`useInView`), `inView.test.tsx`.

- Test first: `spanWords` gives `1 minute`, `2 minutes`, `1 day`, `30 days`, `1 month` and `6 months`. This passes before the
  change, because the ternary is a no-op, so the red run is a planted `span.unit + 'x'`, shown red and then removed. Then
  simplify the line to `span.unit`.
- Test first: `renderToString` of a component using `useInView`, with `IntersectionObserver` left undefined, renders the
  still state (`false`). It is red today. After the effect, the client renders `true` with no observer, and the existing tests
  for an observer stay green. Change: `useState(false)`; in the effect, call `setInView(true)` and return when there is no
  `IntersectionObserver`; otherwise call `watchInView`. Rewrite the header's last sentence, which says a post counts as in
  view at once.

## Task 2: CHECK functions executable by their writers (design, section 6, O3)

Files: a new `supabase/tests/<next>-constraint-functions.sql`, beside `supabase/tests/0002-definer-search-path.sql`, written the
same way; a new migration `supabase/migrations/<next>_constraint_function_grants.sql`.

- Test first: read from the catalog every function in schema `public` called by a CHECK constraint (`pg_constraint.conbin`,
  through `pg_depend`), a column default (`pg_attrdef`) or a generated column, and refuse any for which
  `has_function_privilege('public', oid, 'execute')` is false, naming each one. Also refuse a read of zero such functions
  ("which cannot be right"). Red run: today's catalog names `tip_keys_ok(text[])`, and any other function the scan finds.
- A second test, the behavior itself: a role made in the test with INSERT and UPDATE on `account_preferences`, and nothing
  else, writes a row whose `tips_seen` is valid, and is not refused. Red today.
- Migration: `grant execute on function tip_keys_ok(text[]), … to public` for every function the red run named. Its header
  says why: a CHECK runs its functions as the writer, and 0001's default privileges revoke EXECUTE from PUBLIC. Keep
  `preferences_answer` revoked; it is no constraint's.

## Task 3: the reduced-motion tour test reads the motion (design, section 4, F1)

Files: `engine/ui/tips/tour.test.tsx`; `engine/ui/tips/Spotlight.tsx` (no change expected).

- Mock `motion/react` in this test file (`vi.mock`) so `motion.div` renders a plain `div` and records the `initial` and
  `transition` it was last given, in a list the test reads. Keep `AnimatePresence` and every other export the tips use as they
  are.
- Assert: under reduced motion `initial === false` and `transition.duration === 0`. Without it, `initial` has `opacity: 0` and
  `transition.duration > 0`.
- Poison, run once and shown red in the PR: `Spotlight.tsx` with `initial={{ opacity: 0 }}` and `duration: 0.32` set
  unconditionally while the `data-kb-fade` marker is left honest. The reduced-motion test must fail. Revert the poison.
- Rewrite the comment above `startsHidden` to say the marker is kept for e2e and the motion is read from the props.

## Task 4: an unseasoned onboarding path in e2e (design, section 4, O2)

Files: a new `e2e/onboarding.spec.ts`; `engine/ui/data/fake.ts` only if seeding an unseasoned account with one character is
not already possible through `Seed.account` and the character seeding `e2e/focus.spec.ts` uses.

- Sign in, through `__kbFake`, a fresh account without `seasoned` that has one character. Visit `/`.
- Assert, at 1440×900 and at 390×844:
  - the redirect to `/welcome`;
  - finishing the welcome returns to the board;
  - the spotlight's first step is a dialog named by its title, with focus inside it;
  - Next (a real `click()`) walks every step, and the step label reads `n of N`;
  - Escape skips the rest;
  - a reload shows no tip;
  - Settings' Replay the tour, clicked, brings the tour's first step back on the board;
  - the HUD tour's steps are each reached the same way.
- Keyboard: Tab stays inside the dialog (`e2e/focus.ts`'s helpers), and Enter on Next advances.
- Poison: run once with the spotlight's dialog role removed in the page (an injected script). The spec must fail naming the
  missing dialog. Shown red in the PR, never shipped.
- Export a small helper (`signInUnseasoned(page)`) for Task 6 to reuse.

## Task 5: Break free pressed only when it can be (design, section 4, O1)

File: `e2e/hold.spec.ts` (`pressBreakFreeUntilFree`).

- Before each press, the page loop computes the button's box and style. It returns a fault and stops if the box is empty,
  `visibility` is `hidden`, the computed opacity is 0, or `document.elementFromPoint` at the box's center is neither the button
  nor inside it. The function returns the fault (or `null`), and the caller asserts `null`, so a failure names what covered it.
- Keep the 130ms pacing and its header's reasoning, and add a sentence on the per-press check.
- Poison test, kept in the spec as the others' poisons are: plant a transparent `position: fixed` layer over the button, call
  the helper, and expect a fault naming the cover.

## Task 6: overlay sheets in the contrast guard, and the spotlight measured (design, section 3)

Files: `engine/ui/types.ts` (a new `GlassOverlay = 'tips'`, documented beside `GlassSurface`); `tools/check-glass-contrast.mjs`
and `tools/test-glass-contrast.mjs`; `e2e/glass-ceilings.json` (regenerated with `--write`); `e2e/glass-text.spec.ts` and, if
its gatherer needs to know the panel, `e2e/glass-text-page.ts`; `engine/ui/tips/tips.css` only if a token fails.

- The guard reads `GlassOverlay` from source as it reads `GlassSurface`. It reads the scrim's percentage from `tips.css`'s
  `.kb-tips-dim` `color-mix(... var(--kb-glass-ground) N%, transparent)` and refuses the stylesheet if that is not found.
- The worst pixel: white, under the ground at N%, under `--kb-glass-sheet` at its alpha (opaque in the high key), quantized as
  the smoke's colors are. Held:
  - `text`, `text-hi`, `text-2` and `pale` at 4.5:1 on that worst (7:1 in the high key);
  - the border `pale` at 3:1 against the scrim over white;
  - a sheet token that is missing from a key is an error.
- `glass-ceilings.json` gains `overlays.tips`: the worst luminance and each token's ceiling.
- Self-test first (`tools/test-glass-contrast.mjs`), each red before the guard knows it:
  - a sheet at alpha 0.5 over the scrim fails `text-2`;
  - a scrim read as 30% fails;
  - a `GlassOverlay` with no rule in the guard is refused;
  - a `tips.css` with the scrim's rule renamed is refused;
  - Divided World's numbers are pinned to the values the guard computes on the first green run, written into the test with
    their arithmetic.
- `e2e/glass-text.spec.ts`: two new scenes, each opening the first spotlight step through Task 4's `signInUnseasoned` and
  reading the panel's lines against `overlays.tips`. One is on a light-theme board page at 1920×1080; the other is the phone
  sheet at 390×844 over the dark board. Poison, kept as the spec's others are: `--kb-glass-sheet` overridden to
  `rgba(9,5,18,0.3)` in the page must be named.

## Task 7: Feelin' Fab's styles computed (design, section 5)

Files: a new `e2e/fab.spec.ts`, against `instances/divided-world/ui/feelin-fab/Fab.board.stories.tsx`'s story page as the other
board specs reach theirs (read `e2e/boards.spec.ts` and `e2e/board-stories.ts` for the address); `Effect.test.tsx`;
`Fab.board.stories.tsx` only if no story has both a moving and a held post.

- Assert with `getComputedStyle` on `.dw-fab-layer` and `.dw-fab-twinkle`:
  - a moving post in view: `animation-name` is not `none`, `animation-play-state` is `running`, and `will-change` includes
    `transform`;
  - a held post (`data-kb-moving="false"`): `animation-name: none`, and `will-change` is `auto`;
  - after scrolling a moving post out of view and waiting for its `data-kb-running="false"`: `paused`;
  - with `reducedMotion: 'reduce'`, and separately with `<html data-kb-motion="reduce">` under no device preference:
    `animation-name: none`;
  - with the device reduced and `data-kb-motion` set to the account's "full" value (read the value from `fab.css`'s selector):
    animating;
  - the text's `text-shadow` has two layers.
- Then remove from `Effect.test.tsx` the regex assertions on `fab.css` that these replace, and keep the component tests.
- Poisons, each by `page.addStyleTag` and each expected red: `.dw-fab[data-kb-moving="false"] .dw-fab-layer { animation:
  dw-fab-spread 14s infinite !important }`; `animation-play-state: running !important` on a not-running post; the reduced
  rule removed (re-declare the animation under the reduce attribute); `text-shadow: none`.

## Task 8: reaching a person (design, section 2)

Files:
- a migration `supabase/migrations/<next>_admin_contact.sql`;
- its SQL test `supabase/tests/<next>-admin-contact.sql`;
- `engine/ui/data/api.ts`, `engine/ui/data/fake.ts` and `web/src/data/supabase.ts` (`adminContact()`, `setAdminContact(links)`);
- a new `engine/ui/contact/Contact.tsx` with its test and stories;
- `engine/ui/admin/Queue.tsx` (the form, beside Write an Update) with its test;
- `web/src/App.tsx` (the `/contact` route, a glass page on the `settings` surface);
- `engine/ui/account/SignIn.tsx`, the frame in `engine/ui/account/Settings.tsx`, and `engine/ui/log/Log.tsx`'s foot (the
  links);
- `instances/divided-world/guide/strategy-guide.md` (the closing line links `/contact`).

- SQL, test first:
  - The contact is the setting `adminContact`, a JSON array of `{ label, href }`, in `settings`, which the export already
    carries. Add a row to `supabase/tests/e2e/0003-export.ts`'s round trip asserting it survives.
  - `admin_contact()` is `security definer`, `stable` and callable by `anon` and `authenticated`. It returns the array, or `[]`
    when unset.
  - `set_admin_contact(links jsonb)` is `security definer`, refuses a caller that is not `is_admin()` (the service role too,
    as `post_update` does), and repairs, then refuses, by the design's list. Each refusal raises with
    `hint = 'kayfabb.refusal'` and names the predicate and the row's number.
  - Tests cover: an anon read; a player refused the write; each repair (trim, an empty row dropped, a bare email made
    `mailto:`); each refusal (`javascript:`, `http:`, a 41-character label, a 301-character address, six rows); and the answer
    being identical for a signed-out, a signed-in and an admin caller (the masks).
- UI, test first (jsdom, against the fake):
  - `/contact` signed out shows "Reach a person", the lead, and each link as a link with its label. A `mailto:` link also
    shows its address as text. Unset, it shows the plain fallback line.
  - The admin's form saves, shows a refusal's words beside the row it names, and shows the "players have no way to reach you"
    notice while the contact is empty.
  - Sign-in, Settings' frame and the log's foot each have a link to `/contact` named "Reach a person" (the log's: "Tell an
    admin" becomes the link's text).
- The glass's rendered measurement (`e2e/glass-text.spec.ts`) gains `/contact` at both sizes. `e2e/a11y.spec.ts` gains
  `/contact`. `npm run build` runs `tools/check-guide.mjs`, which must stay green with the guide's new link.
- Story: `Contact.stories.tsx`, set and unset, for the owner to read in review.

## Task 9: move, park and record

GitHub, from the build session, with each step stated in the PR:

- On #124, a comment carrying #160's "Preferences are read more than once per board page" item, with its file references.
- A new sub-issue of #130: "Feelin' Fab at 6× CPU throttle waits on a GPU-composited browser", with #160's numbers.
- On #160, a comment linking each item to its task, to #124, to the new #130 sub-issue, or to the design's section 1 for
  check-guide. The PR's `Closes #160` closes it on merge.
- A new issue for the design's open question (should an instance refuse to come up without an admin contact?), titled as a
  question to the owner.

## Review focus

- Task 2's migration grants EXECUTE to PUBLIC on every function the catalog scan names. Confirm each one is a pure predicate
  that reads no table, so the grant gives no caller a way to read anything.
- Task 6's worst case is white behind the scrim. Confirm no theme or overlay draws something brighter than white or composited
  above the sheet (a `mix-blend-mode`, a glow on the ring that overlaps the panel).
- Task 8's `/contact` must answer the same to every caller. Confirm no path (a cache keyed by session, a refusal that differs
  for an admin) makes the response depend on who is asking.
- Task 8's repair turns a bare email into `mailto:`. Confirm an input that looks like an email but carries a scheme (for
  example `javascript:a@b`) is refused and not repaired.
- Tasks 4 and 6 add browser scenes to an e2e run that issue #125 says runs near its limit. Report the spec's added wall-clock
  time in the PR.
