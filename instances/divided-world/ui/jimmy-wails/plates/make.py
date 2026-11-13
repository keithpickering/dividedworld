"""
Jimmy Wails's later plates, made from their photographs (CREDITS.md names each one and its license).

    python3 make.py <folder of sources> <folder to write into>

A source is the photograph's 960-pixel-wide rendering from Wikimedia Commons, saved under the name PLATES gives it. Each plate is a crop
scaled to 300 pixels high, with the edge beside its words faded into the ground the words sit on, as the Wikimedia Foundation's own
banners faded theirs. A plate whose words sit to the picture's left carries that ground in the file; one whose words sit to its right
gets a panel from plates.ts. The script prints each plate's size and, for a box given in BOXES, the darkest and lightest color under
it, which plates.ts records as `boxRange`.

The first three plates (blue-shirt, close-up, dark-logo) were not made here: they are the Foundation's banners with the text painted out.
"""
import sys
from PIL import Image

HEIGHT = 300
WHITE = (255, 255, 255)
NIGHT = (12, 12, 14)

# key: (source file, crop box in the source's pixels, ground color or None to sample it, where the ground goes, its width, the fade's width)
PLATES = {
    'black-shirt': ('jimmy_wales_july_2010_2.jpg', (60, 40, 900, 600), NIGHT, 'right', 0, 150),
    'gray-jacket': ('jimmy_wales_july_2010_3.jpg', (90, 60, 930, 620), WHITE, 'right', 0, 150),
    'looking-away': ('jimmy_wales_july_2010_5.jpg', (150, 10, 900, 510), WHITE, 'left', 350, 170),
    'red-wall': ('jimmy_wales_july_2010_6.jpg', (0, 30, 960, 470), WHITE, 'left', 260, 210),
    'full-length': ('jimmy_wales_july_2010_7.jpg', (0, 0, 960, 640), NIGHT, 'right', 0, 130),
    'pinstripe': ('jimmy_wales_fundraiser_appeal.jpg', (0, 190, 960, 990), None, 'left', 350, 90),
}
# The words' boxes inside a plate's own file, as plates.ts has them, for the plates whose ground is in the file.
BOXES = {'looking-away': (30, 20, 330, 260), 'red-wall': (24, 20, 300, 260), 'pinstripe': (30, 20, 320, 260)}


def luminance(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(key, sources):
    name, crop, ground, side, ground_width, fade = PLATES[key]
    photo = Image.open(f'{sources}/{name}').convert('RGB').crop(crop)
    photo = photo.resize((round(photo.width * HEIGHT / photo.height), HEIGHT), Image.LANCZOS)
    if ground is None:
        # The backdrop's own color, from the strip the fade starts at.
        strip = photo.crop((0, 0, 12, HEIGHT)).resize((1, 1), Image.BOX)
        ground = strip.getpixel((0, 0))
    px = photo.load()
    for i in range(fade):
        t = 1 - i / fade
        x = i if side == 'left' else photo.width - 1 - i
        for y in range(HEIGHT):
            px[x, y] = mix(px[x, y], ground, t * t * (3 - 2 * t))
    plate = Image.new('RGB', (photo.width + ground_width, HEIGHT), ground)
    plate.paste(photo, (ground_width if side == 'left' else 0, 0))
    return plate, ground


def main():
    sources, out = sys.argv[1], sys.argv[2]
    for key in PLATES:
        plate, ground = make(key, sources)
        plate.save(f'{out}/{key}.png', optimize=True)
        line = f'{key}: {plate.width} x {plate.height}, ground #{ground[0]:02x}{ground[1]:02x}{ground[2]:02x}'
        if key in BOXES:
            x, y, w, h = BOXES[key]
            colors = sorted({plate.getpixel((i, j)) for i in range(x, x + w) for j in range(y, y + h)}, key=luminance)
            line += ', under the box #%02x%02x%02x to #%02x%02x%02x' % (*colors[0], *colors[-1])
        print(line)


if __name__ == '__main__':
    main()
