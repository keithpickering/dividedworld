#!/usr/bin/env python3
"""Make the front-door Wiggler sheet with a drop shadow.

Reads wiggler-sheet.gif beside this file (the owner's own sprite sheet, from
2005, copied from ui/hype) and writes wiggler-sheet-dropshadow.gif beside it.

Every pixel that is not pure white is the sprite, its borders, headings and
credit text alike. Each one casts a black shadow 3 px right and 3 px down, so
the owner's request for a shadow under everything is met. The canvas grows by
that offset (188x390 becomes 191x393), the original is placed on top at (0,0)
with its white made transparent so the shadow shows through, the remaining
space is filled white, and the result is saved as a GIF with a 256-color
palette.

Run from the repository root:
    python3 instances/divided-world/ui/front-door/dropshadow.py

Source of the requirement: docs/plans/2026-11-23-wiggler-front-door-design.md,
section 6.
"""

from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "wiggler-sheet.gif"
OUTPUT = HERE / "wiggler-sheet-dropshadow.gif"

OFFSET = 3  # pixels right and down
WHITE = (255, 255, 255)
BLACK = (0, 0, 0)


def main() -> None:
    original = Image.open(SOURCE).convert("RGBA")
    width, height = original.size
    canvas_size = (width + OFFSET, height + OFFSET)

    pixels = original.load()

    # Shadow: black wherever the sprite is not pure white, offset down and right.
    shadow = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    shadow_pixels = shadow.load()
    for y in range(height):
        for x in range(width):
            r, g, b, _ = pixels[x, y]
            if (r, g, b) != WHITE:
                shadow_pixels[x + OFFSET, y + OFFSET] = BLACK + (255,)

    # Original on top at (0,0), with its white made transparent.
    sprite = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    sprite_pixels = sprite.load()
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if (r, g, b) == WHITE:
                sprite_pixels[x, y] = (0, 0, 0, 0)
            else:
                sprite_pixels[x, y] = (r, g, b, a)

    # Fill the rest white underneath everything.
    result = Image.new("RGBA", canvas_size, WHITE + (255,))
    result.alpha_composite(shadow)
    result.alpha_composite(sprite)

    result.convert("RGB").quantize(colors=256).save(OUTPUT, format="GIF")


if __name__ == "__main__":
    main()
