# Making a card's art for Divided World

Cards here are played in the open, and the art is most of what a card is. This is how to make some. The engine's side of
it, with every number, is `specs/card-art.md`.

## What you make

Each card has a folder, `instances/divided-world/ui/cards/<key>/`, holding three files:

- `art.svg`, the card's picture.
- `mark.svg`, a small square emblem for the card.
- `art.json`, who you are and the terms you offer the art under.

## Steps

1. **Download the template**, `engine/ui/cards/card-template.svg`, and open it in an SVG editor (Inkscape works well).
2. **Draw on the art layer.** The guides layer is locked; leave it alone. Everything fills the canvas, which is the
   540 by 840 rectangle inside the frame.
3. **Keep your subject in the focus zone**, the dashed box in the upper part. It is a guide, not a mask: glow, rings
   and splashes may run past it, and a transparent ground is fine. The game draws a dark ground and a soft glow in the
   card's color under your art.
4. **Treat the lower part as texture.** The name and rules sit on plates there (the hatched zone), so nothing you want
   seen should hide behind them.
5. **Stay inside the keep-clear line**, the dotted line near the edge. No piece of your drawing crosses it.
6. **Export `art.svg`** with the viewBox `0 0 540 840`, as plain SVG. Delete the guides layer first.
7. **Draw `mark.svg`**, a square silhouette that still reads at 18 pixels wide. A full-art picture shrunk that small
   turns to mud, so the mark is its own drawing, and it is required.
8. **Write `art.json`**:

   ```json
   { "credit": "Your name", "license": "The terms you offer the art under" }
   ```

   Both must be filled in. The credit is shown on the card sheet's foot line as "Art · Your name". Use your own name or
   handle, and describe the art, never a character.
9. **Open a pull request** with the three files in the card's folder. The owner approves art in review.

The repository has no license yet. The placeholder art here is the project's own, and the owner will give its license
when the repository has one.

## What the guard refuses

Check your folder before you open the pull request:

```
node tools/check-card-art.mjs
```

It refuses a folder with a missing file; an `art.svg` whose viewBox is not exactly `0 0 540 840`; a `mark.svg` that is
not square; an `art.json` that is not JSON or lacks a credit or license; a file over its size cap (200 KB, 20 KB and
2 KB); and anything in an SVG that runs or fetches: scripts, `foreignObject`, `<image>`, `on...` attributes, `@import`,
a `<!DOCTYPE>`, `xml:base`, animation that rewrites a link, and any link or `url(...)` that points outside the file.
Art is vector only. If you want to paint, say so in your pull request; painted variants are planned and are not
accepted yet.

This README is a file, not a card folder, so the guard does not read it.
