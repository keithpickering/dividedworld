"""
Hot Debate's banner fire, made from Nevit Dilmen's "Animated fire" (CREDITS.md names it and its license).

    python3 make.py <the source GIF> <folder to write into>

The source is the 480 by 360 file Wikimedia Commons serves for File:Animated_fire_by_nevit.gif. Every frame is scaled to HEIGHT
pixels high, and its top is faded to black over FADE of its height, so the tile meets the banner's black ground with no edge; the
frames keep the source's timing. It writes fire.gif (the moving tile, through ffmpeg's palette, 64 colors, no dither) and
fire-still.png (its first frame, which the banner shows when motion is reduced). The source tiles side to side as it is, so no
frame is mirrored or cut.
"""
import os
import subprocess
import sys
import tempfile
from PIL import Image

HEIGHT = 56
FADE = 0.45


def fade(frame):
    px = frame.load()
    for y in range(frame.height):
        k = min(1.0, y / (frame.height * FADE))
        k = k * k * (3 - 2 * k)
        for x in range(frame.width):
            r, g, b = px[x, y]
            px[x, y] = (round(r * k), round(g * k), round(b * k))
    return frame


def main(source, out):
    im = Image.open(source)
    width = round(im.width * HEIGHT / im.height)
    frames = []
    for i in range(im.n_frames):
        im.seek(i)
        frames.append(fade(im.convert('RGB').resize((width, HEIGHT), Image.LANCZOS)))
    frames[0].save(os.path.join(out, 'fire-still.png'), optimize=True)
    rate = round(1000 / (im.info.get('duration') or 40))
    with tempfile.TemporaryDirectory() as tmp:
        for i, f in enumerate(frames):
            f.save(os.path.join(tmp, f'{i:03d}.png'))
        subprocess.run([
            'ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(rate), '-i', os.path.join(tmp, '%03d.png'),
            '-vf', 'split[a][b];[a]palettegen=max_colors=64:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none',
            '-loop', '0', os.path.join(out, 'fire.gif'),
        ], check=True)
    print(f'fire.gif and fire-still.png: {width} by {HEIGHT}, {len(frames)} frames at {rate} per second')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
