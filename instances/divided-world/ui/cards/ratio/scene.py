"""Ratio card art: a rubber stamp just lifted off a post, RATIO left behind in wet ink and the same letters, the
wrong way round, on the stamp's own face. (The card draws a RATIO stamp under a post with reactions of its own; if
the stamp outdraws the post within 3 days, the post keeps a "ratioed" mark.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('RATIO_SEED', '4')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#010309'), (0.45, '#0a2c50'), (0.8, '#3f8fd2'), (1.0, '#041428')]).scale.x = 60
G = -3.4
rig.floor(G, rig.checker('floor', '#03101c', '#12436e', 40, rough=0.1))
ink = rig.plastic('ink', rig.hexrgb('#1049b8'), rough=0.08, coat=1.0, emit=0.25)

# ---- the post, stamped ----------------------------------------------------------------------------
card = rig.plastic('post', rig.hexrgb('#d2d9e2'), rough=0.4)
grey = rig.plastic('words', rig.hexrgb('#aab4c0'), rough=0.5)
post = [rig.slab('post', rig.rrect(4.7, 3.5, 0.22), -0.06, 0.06, card, 0.03),
        rig.slab('avatar', rig.rrect(0.75, 0.75, 0.12), -0.1, -0.06, rig.plastic('avatar', rig.hexrgb('#e86fa8'), rough=0.3), 0.015)]
post[1].location = (-1.75, 0, 1.15)
for k, wide in enumerate((2.6, 3.0, 3.9, 3.4, 3.7, 2.9, 1.8)):
    z = 1.3 - 0.3 * k if k < 2 else 0.85 - 0.33 * k
    x0 = -1.15 if k < 2 else -2.1
    o = rig.slab('line', rig.rrect(wide, 0.13, 0.06, 3), -0.085, -0.06, grey, 0.0); o.location = (x0 + wide / 2, 0, z); post.append(o)
mark = [rig.text('RATIO', 1.05, ink, (0, -0.1, 0), depth=0.006, bevel=0.002)]
for grow, wide in ((0.0, 0.05), (0.16, 0.025)):          # the stamp's double rule
    mark.append(rig.tube('rule', [(x, -0.1, z) for x, z in (lambda r: r + r[:1])(rig.rrect(3.75 + grow * 2, 1.35 + grow * 2, 0.2 + grow))], wide, ink, res=3))
for i in range(9):                       # where the ink spat
    a = rnd.uniform(0, math.tau); d = rnd.uniform(1.0, 1.25)
    mark.append(rig.ball((math.cos(a) * 2.0 * d, -0.1, math.sin(a) * 0.85 * d), rnd.uniform(0.03, 0.09), ink, 'spat', 12, scale=(1, 0.2, 1)))
stamped = rig.group(mark, loc=(0.1, 0, -0.35), rot=(0, 13, 0)); post.append(stamped)
rig.group(post, loc=(0, 1.2, 1.75), rot=(-5, 4, 0))

# ---- the stamp: a turned handle on a block, its rubber face toward us ------------------------------
wood = rig.plastic('wood', rig.hexrgb('#b8601c'), rough=0.22, coat=0.8)
rubber = rig.plastic('rubber', rig.hexrgb('#b01828'), rough=0.45)
stamp = [rig.lathe('handle', [(0.0, 0.5), (0.34, 0.5), (0.3, 0.75), (0.2, 1.0), (0.17, 1.3), (0.26, 1.6), (0.45, 1.85), (0.52, 2.15), (0.42, 2.42), (0.2, 2.55), (0.0, 2.58)], wood),
         rig.box('block', 3.3, 1.25, 0.5, wood, (0, 0, 0.0), bevel=0.06),
         rig.box('pad', 3.1, 1.05, 0.14, rubber, (0, 0, -0.14), bevel=0.02)]
face = rig.text('RATIO', 0.82, ink, (0, 0, -0.16), depth=0.03, bevel=0.006, rot=(math.radians(90), 0, 0))   # raised letters on the pad's underside
face.scale.x = -1; stamp.append(face)       # the wrong way round, as a stamp's face is
stamp.append(rig.tube('rule', [(x, z, -0.16) for x, z in (lambda r: r + r[:1])(rig.rrect(2.95, 0.92, 0.15))], 0.035, ink, res=3))
rig.group(stamp, loc=(0.75, -1.6, -1.5), rot=(-58, -14, -16), scale=0.9)
for i in range(5):                       # ink still dripping off it
    rig.ball((0.2 + 0.35 * i + rnd.uniform(-0.1, 0.1), -1.9, -2.5 - rnd.uniform(0.0, 0.7)), rnd.uniform(0.05, 0.1), ink, 'drip', 16, scale=(1, 1, 1.5))

LOOK = (0, 0, 0.5)
rig.area('key', (-5, -9, 7), 4.0, 1500, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 600, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2200, rgb=(0.3, 0.7, 1.0), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 450, rgb=(0.8, 0.9, 1.0), look_at=LOOK)
rig.world((0.02, 0.06, 0.12), 0.7)
rig.camera(50)
rig.render(OUT)
