# Ended visit marks: plan

Record, written 2026-11-25, from main at 92fe3f2. Carries out `docs/plans/2026-11-25-ended-visit-marks-design.md`; the
approved look is `docs/research/2026-11-25-ended-visit-marks/02-approved.png`. Engine only, in the glass. Two tasks, in
order; each goes test first, with its red run in the PR.

## Task 1: the mark's icon per outcome, held to the database's list

Model: sonnet

Files: `engine/ui/cards/visit.ts`, `engine/ui/cards/visit.test.ts`, `tools/check-visit-outcome-words.mjs`,
`tools/test-visit-outcome-words.mjs`.

1. **visit.ts.** Replace `markText` with:
   - `export type VisitIcon = 'watch' | 'bang' | 'slash' | 'teeth' | 'stop' | 'dashed';`
   - `export function markIcon(state: VisitState): VisitIcon`, a `switch` with one `case` line per state, in the shape
     `markText` has now (the check reads `case 'x':` lines): `open` → `'watch'`, `filed` → `'bang'`, `intercepted` →
     `'slash'`, `trapped` → `'teeth'`, `reversed` → `'stop'`, `dropped` → `'dashed'`. Its doc comment: what the mark's
     stopwatch draws for each state; an ended mark has no words, its outcome is in the mark's name and the Lens tab.
   - The open mark's time stays `timeLeft(endsAt, now)`, which the screen now calls itself.
   - `markLabel`'s doc comment: the open tile's visible words ("2:41") are in its name (WCAG 2.5.3); an ended tile has
     none. Its words do not change.
2. **visit.test.ts first.** Replace the `markText` assertions (lines 16–17) with
   `assert.deepEqual(['open', ...OUTCOMES].map(markIcon), ['watch', 'bang', 'slash', 'teeth', 'stop', 'dashed'])`.
   Red run: a failed import of `markIcon` is not a red run that counts (charter item 1), so write `markIcon` as a stub
   returning `'watch'` first, see the assertion fail, then fill it in.
3. **The check.** In `visitWordFaults`, the place `markText` becomes `markIcon`, read from `region(visitText,
   'markIcon')` with `'case'`; update the header comment's list of places (`markIcon` holds icons, not words, and is held
   to the list all the same). The "admin" refusal (2) still runs over every place; an icon name never says admin.
4. **The check's test first.** Add to `tools/test-visit-outcome-words.mjs`, before changing the check:
   `await fire('an outcome with no icon on the mark', { visitText: swap(tree.visitText, "    case 'trapped': return 'teeth';\n", '') }, 'markIcon');`
   and update the header's list of poisons. Red run: with the check still reading `markText`, the real tree is not
   clean (`markText is not found`) and the poison's faults do not name `markIcon`. Then change the check; both pass.

Run: `node --experimental-strip-types --no-warnings=ExperimentalWarning --test engine/ui/cards/visit.test.ts` and
`node tools/test-visit-outcome-words.mjs`, then `node tools/check-visit-outcome-words.mjs`.

## Task 2: the mark draws its icon, and an ended tile is a card mark's size

Model: sonnet

Files: `engine/ui/cards/Visit.tsx` (`Stopwatch`, `VisitMark`), `engine/ui/cards/visit.css`,
`engine/ui/cards/lens.test.tsx`.

1. **Tests first, in lens.test.tsx** (the `visitMark` helper at line 1581 finds the mark by its name):
   - Line 1759 (talked down by keyboard): the mark keeps its name and now has no visible words:
     `toHaveTextContent('Talked down')` becomes `toHaveTextContent(/^$/u)`, and its drawing is the slash:
     `expect(mark.querySelector('svg')).toHaveAttribute('data-kb-icon', 'slash')`.
   - Line 1888 (once filed): `expect(mark).toHaveTextContent('Filed')` becomes the same two assertions with `'bang'`,
     and the test's name says the mark is the "!" stopwatch.
   - A new test beside it, "an open visit's mark shows the time left beside a plain stopwatch": a visit opened
     161 minutes before its end (as the stories seed it) shows `2:41` and `data-kb-icon="watch"`.
   - A new test, "a trapped, ended or dropped visit's mark is its icon alone": for each of `trapped`, `reversed` and
     `dropped`, seed `visitEnd` with that outcome (as the "when it ended another way" tests do), and assert the mark's
     text is empty, its name is `markLabel`'s for that outcome, and its icon is `teeth`, `stop` or `dashed`.
   Red runs: each fails on its assertion (the mark shows words, and the svg has no `data-kb-icon`).
2. **Visit.tsx.** `Stopwatch({ icon }: { readonly icon: VisitIcon })` draws in its 24-unit box, with
   `data-kb-icon={icon}` on the `svg`, keeping `className="kb-visit-watch"`, `width`/`height` 22, `aria-hidden`,
   `focusable="false"`:
   - every icon: the face `<circle cx="12" cy="14" r="7.5" />` (for `dashed`, with `strokeDasharray="3 2.6"`) and the
     crown `<path d="M9.5 3h5M12 3v3M18.2 7.2l1.4-1.4" />`;
   - the hand `<path d="M12 14V9.5" />` for `watch`, `slash`, `teeth` and `dashed`; for `bang`, `<path d="M12 15V9.5" />`
     and the dot `<circle className="kb-visit-dot" cx="12" cy="17.6" r="1.25" />`; for `stop`, no hand;
   - `slash`: `<path className="kb-visit-over kb-visit-slash" d="M3.5 21.5L20.5 4.5" />`;
   - `teeth`: `<path className="kb-visit-over" d="M3 23l3-4 3 4 3-4 3 4 3-4 3 4" />`;
   - `stop`: `<rect className="kb-visit-stop" x="9" y="11" width="6" height="6" />`.
   `VisitMark` draws `<Stopwatch icon={markIcon(state)} />`, and the `kb-visit-time` span only while `state === 'open'`,
   holding `timeLeft(visit.endsAt, now)`. Import `markIcon`, `timeLeft` and `VisitIcon`; drop `markText`.
3. **visit.css.** The `padding-inline: 0.55rem` on `.kb-mark.kb-visit-mark` applies only to
   `.kb-mark.kb-visit-mark[data-kb-visit="open"]`, so an ended tile takes the meta tile's own padding and width. Add:
   `.kb-visit-dot { fill: var(--kb-visit-ink); stroke: none; }`;
   `.kb-visit-over { stroke: var(--kb-glass-text-hi); stroke-width: 2; }` and `.kb-visit-slash { stroke-width: 2.4; }`;
   `.kb-visit-stop { fill: var(--kb-glass-text-hi); stroke: none; }`. In the forced-colors block beside
   `.kb-visit-watch { stroke: ButtonText; }`: `.kb-visit-over { stroke: ButtonText; }` and
   `.kb-visit-dot, .kb-visit-stop { fill: ButtonText; }`. Each rule gets a one-line comment in the file's voice.

Run: `npx vitest run engine/ui/cards/lens.test.tsx`. Then shoot the built marks: run Storybook, open the Filed,
TalkedDown and Trapped visit stories, and put a crop of each post's date row in the PR beside `02-approved.png`; the
ended tile measures the same width as the Whoops! mark beside it (48px in the story).

## Review focus

- The ended tile's width at phone layout (`:root[data-kb-layout='phone']`) and in an ORIGIN box's band, where the strip
  is also drawn: the same as a card's mark in each.
- Forced colors: each icon still tells its outcome apart with every stroke and fill in `ButtonText`.
- The check still fails for an outcome added to `end_visit` with no icon, and still reads `tabName`, `markLabel` and
  `endedModWords` for words.
