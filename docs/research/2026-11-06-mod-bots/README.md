# Mod Bots: screen mocks

Record, written 2026-11-06. The mocks for `docs/plans/2026-11-06-mod-bots-design.md`, section 9. Each is a screenshot of
the built Lens story (`engine/ui/cards/Lens.tsx`, Storybook's "Boards/01 Lens") with the visit's pieces laid into the page:
the visit mark, the Lens's visit tab, the warn meter, the violation notice, the Report link and the presence tag are mock
content; the board, the marks, the Lens and the HUD are the built ones.

To shoot them again, run Storybook (`npm run storybook`), then `node docs/research/2026-11-06-mod-bots/shoot.cjs`.

- `01-on-a-visit.png`: The Clerk on a visit to post #41, the Lens open on the visit's tab with the quiz.
- `02-filed-author.png`: the visit filed, as the author sees it: the notice, the warn meter at 6 of 10, Appeal.
- `03-report.png`: the report form for post #42.
- `04-presence.png`: The Clerk tagged in "Users browsing this thread".
- Each with a `-phone` shot at 390 wide.
