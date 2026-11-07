# The glass in email: the mockup

Record, written 2026-11-07. This is the mockup the owner confirmed in the glass-mail design session
(`docs/plans/2026-11-07-glass-mail-design.md`). It is a reference for the look, not code to copy: it escapes nothing,
reads no theme and leaves out Outlook's VML and Gmail's blend-mode fix. The plan's tasks build those.

- `01-sign-in.html`: the sign-in email, with a sample code, in the words the owner approved.
- `02-hidden-post.html`: a conduct email built from the shell's blocks (facts, a quote and a button). Its words are
  stand-ins. The conduct plan's templates supply the real ones.
- `smoke.jpg`, `cut-panel.png`, `cut-button.png` and `coin-96.png`: the baked assets the two pages load.
- `shots/`: the pages at 680px and 375px wide, one of them with images blocked.
- `bake.mjs`: bakes the assets. Run it from the repository's root with the output paths. It copies `field.ts`'s layer
  SVG, which the plan's Task 3 replaces with an export.
- `mock.mjs`: writes the two pages. Run it with this folder as its argument.
- `shoot.mjs`: takes the shots. Run it with this folder's absolute path and an output folder.
