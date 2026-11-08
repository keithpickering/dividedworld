# Avatars in the Lens: plan

Record, written 2026-11-07. The plan for `docs/plans/2026-11-07-lens-avatars-design.md`. One build session builds it
in one PR from `main`. Each task is test first: name the test, record its red run, then write the code. Engine only.
No migration.

## Task 1: `Avatar`, pulled out of the HUD (engine)

Model: sonnet

- New `engine/ui/glass/Avatar.tsx`:
  `export function Avatar({ src, name, className }: { readonly src: string | null; readonly name: string; readonly className?: string })`.
  It draws `<span className="kb-avatar {className}" aria-hidden="true">` with `<img src={src} alt="" />` when `src`
  is set, else `<span className="kb-avatar-none">{first letter of name}</span>`. The first letter is the first code
  point (`[...name][0]`, not `slice(0, 1)`), so a name that starts with an emoji or an astral letter is not split.
  The header comment says it is decoration beside a name read in words.
- New `engine/ui/glass/avatar.css`, imported where the glass's other part sheets are imported (read how `calm.css` is
  imported). It holds `.kb-avatar` (block, `box-sizing: border-box`, `overflow: hidden`,
  `background: var(--kb-glass-field-2)`), `.kb-avatar img` (as `.kb-hud-avatar img` is today) and `.kb-avatar-none`
  (as `.kb-hud-avatar-none` is today, with `line-height: 1`). Its size and border are left to the caller's class.
- `engine/ui/frame/Hud.tsx` (around line 398): the `Link.kb-hud-avatar` keeps its class, `to` and `aria-label`, and
  its child becomes `<Avatar src={face?.avatarSquare ?? null} name={hud.name} />`. The `Avatar` span fills the link
  (`width: 100%; height: 100%` under `.kb-hud-avatar .kb-avatar` in `frame.css`). The `.kb-hud-avatar img` and
  `.kb-hud-avatar-none` rules move into `avatar.css`. Size, border and glow stay on `.kb-hud-avatar`, so
  `engine/ui/frame/hud-avatar.test.tsx` holds unchanged. Only the letter's display size (`--kb-glass-size-display-s`)
  stays under `.kb-hud-avatar .kb-avatar-none`.
- Tests first, `engine/ui/glass/avatar.test.tsx`: with a `src` it draws an `img` with empty alt and no letter; with
  `null` it draws the first letter; `'🍄Toad'` gives `'🍄'`; the root is `aria-hidden`. The HUD tests that exist
  (`engine/ui/frame/Frame.test.tsx`, `hud-avatar.test.tsx`) stay green, and one HUD test is added: a character with no
  avatar shows its letter inside the link named "My characters".

## Task 2: `faceOf` to the Lens (engine)

Model: sonnet

- `engine/ui/cards/Marks.tsx` `PostMarks`: a required prop `readonly faceOf: (character: Id | null) => string | null`,
  passed to `Lens`. `MarkStrip` and `Mark` do not take it, since marks draw no faces.
- `engine/ui/cards/Lens.tsx` `LensProps`: the same required `faceOf`. `Lens` passes it to `Who`.
- Callers, each built from the map its `nameOf` reads, `null` for a `null` id and for an unknown character:
  - `engine/ui/thread/context.ts` gains `faceOf` beside `nameOf`, and `engine/ui/thread/Thread.tsx` builds it from
    `people.current.get(id)?.character.avatarSquare ?? null` beside `nameOf` (line 164), and puts it in the context
    value (line 555). `engine/ui/thread/Post.tsx`'s three `PostMarks` take it from `useThread()`.
  - `engine/ui/board/Board.tsx`: from `characters.get(id)?.avatarSquare`, passed through `BoardBanner` and `Pinned`
    as `nameOf` is.
  - `engine/ui/spin/Origin.tsx`: `useNames` becomes `useCast`, returning `{ nameOf, faceOf }` from the same `known`
    map. The rename follows the shape, and its four uses are updated.
  - `engine/ui/front-door/FrontDoor.tsx`: `faceOf={() => null}`, with a comment that the sample cast has no pictures.
  - Every test and story that renders `PostMarks` or `Lens` (`grep -rn "<PostMarks\|<Lens " engine/ui`).
- `npm run typecheck` is this task's red run: it fails at every caller until each passes `faceOf`.

## Task 3: the faces in Who (engine)

Model: sonnet

- `engine/ui/cards/Lens.tsx` `Who`: casters are deduped by id (`p.caster`), not by name, keeping the first play of each
  in `plays` order, so two characters that share a name each get their face. The words still dedupe by name, as today.
  The folded button draws, before its words,
  `<span className="kb-lens-faces">` with one
  `<Avatar className="kb-lens-face" src={faceOf(c)} name={nameOf(c)} />` for each of the first `NAMES_SHOWN`
  casters, in order. Each face's `style` sets `--kb-play-ink` to `inkOfPlay` of that caster's first play.
- `PlayRow`: takes `face: string | null` (passed from `Who` as `faceOf(p.caster)`). The row's top becomes a two-column
  `kb-lens-row-head`: `<Avatar className="kb-lens-row-avatar" src={face} name={caster} />` on the left and the existing
  `.kb-lens-by` line on the right. The note, message and foot stay below, full width. Nothing else in the row moves.
- `engine/ui/cards/lens.css`:
  - `.kb-lens-row-head`: `display: grid; grid-template-columns: auto 1fr; gap: 0.6rem; align-items: center`.
  - `.kb-lens-row-avatar`: `width: 2.75rem; height: 2.75rem; border: 2px solid var(--kb-play-ink, var(--kb-glass-neon))`,
    with its letter at `--kb-glass-size-display-xs` in `--kb-lens-ink-text`.
  - `.kb-lens-faces`: `display: inline-flex` before the words. `.kb-lens-face`: `width: 1.5rem; height: 1.5rem`, the
    same ink border at 1.5px, and `margin-inline-start: -0.5rem` after the first. Its letter is at `0.8rem`.
  - Both sizes are in rem, so they grow with the text (the reason `hud-avatar.test.tsx` checks the HUD's).
- Tests first, in `engine/ui/cards/lens.test.tsx` beside "Who is folded, and unfolds…", using the world's characters,
  one given an `avatarSquare` in the fake:
  - folded, the button holds one face per distinct caster, up to three, in the words' order, each `aria-hidden`,
    and the button's accessible name is the same string as before this change (assert it exactly);
  - unfolded, each row has a square: the caster with an avatar shows its `img`, one without shows its first letter,
    a staff play shows the staff word's first letter;
  - each row's square carries that row's `--kb-play-ink`;
  - two casters that share a name show two faces and one name in the words.
- A CSS test (in the shape of `hud-avatar.test.tsx`) asserts `.kb-lens-row-avatar` and `.kb-lens-face` are sized in
  `rem`.

## Task 4: see it (engine)

Model: inline

- Run the app (the `run` skill) on a thread with a card that several characters played, one with an avatar, and
  screenshot the Lens folded and unfolded at 1440 and 390 wide, for the PR. Check the row head does not overflow at
  390 with a long name, and the overlapping faces stay inside the fold button at 200% text.

## Review focus

- The Lens is opened from seven `PostMarks` sites. Check each `faceOf` reads the same map as its `nameOf`, so a face
  never belongs to a different character than the name beside it.
- The HUD's avatar after the extraction: its phone layout (`frame.css` around line 1348 and 1370), its hover rule
  (line 1700) and the stacking fix `hud-avatar.test.tsx` guards must look as before. Compare screenshots.
- A busy instance: a kind with many plays draws one `img` per unfolded row, and they are the page's avatar URLs, which
  are already cached. Check nothing loads while the Lens is folded beyond the three faces.
- The masks: the faces come only from public `Character` fields the page already read. Check no new `api` call was
  added on the Lens's path.
