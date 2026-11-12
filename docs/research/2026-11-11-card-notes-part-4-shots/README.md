Record, written 2026-11-11.

# Card notes, Part 4: shots

The pictures the Part 4 plan's "Last" section asks for (`docs/plans/2026-11-11-card-notes-part-4-plan.md`): Sugar Coat, Hype-Up and Last Word, with Divided World's cards on the card-notes branch. All are at deviceScaleFactor 2 (the lens shots and card faces were then scaled to two thirds to stay small).

- `card-sugar-coat.png`, `card-hype-up.png`, `card-last-word.png`: each card's face at its four sizes, left to right: slot (86), phone (104), fan (150), sheet (276), on the glass's dark ground. Taken from a scratch Vite page that renders `Postcard` with `facesOf(instance.cards, instanceUi.cards, ...)` for Divided World, with the glass applied. Not from the app.
- `post-no-quote-beside-quote.png`: post #3 (Spritey, with a Quote link) above post #4 (Mrs. Hooligan, under Last Word: lock mark on its head, no Quote link). From the real app on the in-memory backend.
- `composer-refuses-quote.png`: the Reply composer after Send with a quote of post #4, holding the draft and showing the refusal ("post 4 carries Last Word, so it cannot be quoted until ...; take that quote out and send again"). From the real app on the in-memory backend.
- `hype-up-postbit.png`, `hype-up-lens.png`: Hype-Up played on Spritey from the Hand: the mark on Spritey's postbit, and the Lens opened from it ("Earns 10% more from some reactions", ends in 36 hours, one play). Real app, in-memory backend.
- `sugar-coat-postbit.png`, `sugar-coat-lens.png`: Sugar Coat played on Mrs. Hooligan's post #4: the mark on the post, and its Lens ("Turns away Salty and Pepperoni cards", ends in a week). Real app, in-memory backend.

## How they were taken

The real web app built in the end-to-end mode (`vite build web --mode e2e`, served with `vite preview`) on the in-memory backend with Divided World's instance and the demo world, driven by Playwright chromium (default launch) at 1440 pixels wide. The cards were played through the Hand and the play form on the screen, not seeded; the Hand was filled with `seed.cards`. Two things were staged: the hand, and the backend's clock, which starts in October 2026 while the browser's does not, so a play there looked already ended; the clock was advanced to the browser's time before the cards were played. The scratch scripts are not in the repository.
