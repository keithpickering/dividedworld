import sys, json
from PIL import Image
d, out_big, out_small = sys.argv[1:4]
keys = []
for c in json.load(open(d + '/info.json')):
    if c['key'] not in keys: keys.append(c['key'])
BG = (24, 24, 28); PAD = 28
def grid(rows, path):
    """rows: lists of images. Lays each row out left to right, bottoms level."""
    w = max(sum(i.width for i in r) + PAD * (len(r) + 1) for r in rows); h = sum(max(i.height for i in r) for r in rows) + PAD * (len(rows) + 1)
    im = Image.new('RGB', (w, h), BG); y = PAD
    for r in rows:
        rh = max(i.height for i in r); x = PAD
        for i in r: im.paste(i, (x, y + rh - i.height)); x += i.width + PAD
        y += rh + PAD
    im.save(path)
get = lambda k, s: Image.open(f'{d}/{k}--{s}.png').convert('RGB')
rows = [keys[a:a + 5] for a in range(0, len(keys), 5)]                 # five cards a row, however many cards there are
grid([[get(k, 'sheet') for k in r] for r in rows], out_big)
small = [[im for k in r for im in (get(k, 'fan'), get(k, 'phone'), get(k, 'slot'))] for r in rows]
grid(small, out_small)
