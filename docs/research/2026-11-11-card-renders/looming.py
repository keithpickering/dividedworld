"""A Minus World spell's icon as a 90s render (its name was not given): a great smiling face risen behind a city
at sunset, smoke on its brow."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('LOOMING_SEED', '5')))
sc = rig.reset()
rig.backdrop(16, [(0.0, '#ffd23a'), (0.4, '#ffc02a'), (0.5, '#ff8a2a'), (0.62, '#c8321c'), (1.0, '#7a1420')])
C = Vector((0.1, 4.0, 0.9)); R = 3.0     # the face: far behind the city, and vast

skin = rig.plastic('face', rig.hexrgb('#f2b8b0'), rough=0.35)
ink = rig.plastic('ink', rig.hexrgb('#3a1626'), rough=0.3, coat=1.0)
rig.ball(C, R, skin, 'face', 96)
def face(x, z, lift=0.0):
    k = max(0.0, R * R - x * x - z * z)
    return C + Vector((x, -math.sqrt(k) - lift, z))
for sx, lean in ((-1, 14), (1, -14)):                              # eyes: two dark seeds, leaning in at the top
    o = rig.ball(face(sx * 0.72 - 0.1, 0.95, -0.05), 0.3, ink, 'eye', 32, scale=(0.62, 0.35, 1.45)); o.rotation_euler = (0, math.radians(lean), 0)
rig.cone(face(0.35, 0.05, -0.1), face(0.35, 0.05) + Vector((1.5, -1.3, -0.6)), 0.5, 0.0, skin, 48)   # the nose, a spike out to one side
rig.tube('nose-line', [face(0.2, 0.42, 0.03), face(0.75, 0.1, 0.3) + Vector((0.55, -0.45, -0.25)), face(0.45, -0.3, 0.03)], 0.035, ink, res=4)
rig.tube('smile', [face(-1.75 + 3.3 * t, -0.55 - 1.0 * math.sin(math.pi * t) ** 0.8 + 0.35 * t, 0.03) for t in (j / 40 for j in range(41))], 0.07, ink, res=6)

for i in range(22):                                               # the smoke on its brow
    a = rnd.uniform(0, math.pi); d = rnd.uniform(0, 1)
    rig.ball(C + Vector((math.cos(a) * 2.6 * d + rnd.uniform(-0.4, 0.4), rnd.uniform(-2.6, -0.6), R * 0.78 + rnd.uniform(0, 1.3))), rnd.uniform(0.6, 1.15),
             rig.plastic('smoke', rig.hexrgb(rnd.choice(['#b06a48', '#9a5540', '#c07a52'])), rough=0.9), 'smoke', 28)

# ---- the city in front of it: blocks with their lights on ----------------------------------------
G = -4.6
lit = rig.glow('window', rig.hexrgb('#ffe27a'), 2.2)
unlit = rig.plastic('window-dark', rig.hexrgb('#4a2a4a'), rough=0.3)
def tower(x, y, w, d, h, tone, cols, rows, crack=False):
    wall = rig.plastic('wall', rig.hexrgb(tone), rough=0.6)
    rig.box('tower', w, d, h, wall, (x, y, G))
    for c in range(cols):
        for r in range(rows):
            wx = x - w / 2 + w * (c + 0.5) / cols; wz = G + h - 0.35 - r * 0.52
            if wz < G + 0.2: continue
            o = rig.slab('window', rig.rrect(w / cols * 0.5, 0.28, 0.02), -0.02, 0.02, lit if rnd.random() < 0.72 else unlit, 0.004)
            o.location = (wx, y - d / 2 - 0.01, wz)
    if crack:
        z0 = G + h - 0.25
        rig.tube('crack', [(x + 0.1, y - d / 2 - 0.02, z0), (x - 0.05, y - d / 2 - 0.02, z0 - 0.3), (x + 0.2, y - d / 2 - 0.02, z0 - 0.5), (x + 0.05, y - d / 2 - 0.02, z0 - 0.85), (x + 0.3, y - d / 2 - 0.02, z0 - 1.1)], 0.02,
                 rig.plastic('crack', rig.hexrgb('#2a1228'), rough=0.6), res=3)
tower(-2.3, 0.8, 1.5, 1.2, 6.4, '#8a5674', 3, 11)
tower(2.45, 1.0, 1.2, 1.2, 5.9, '#7a4a6a', 2, 10)
tower(2.2, -0.6, 1.5, 1.0, 3.4, '#9a6480', 3, 5)
tower(-1.4, -0.9, 2.0, 1.0, 1.9, '#a06a84', 4, 2, crack=True)
tower(0.75, -1.2, 1.5, 1.0, 1.3, '#8a5674', 3, 2)
tower(-0.4, 1.6, 1.0, 1.0, 3.0, '#6a4062', 2, 4)
rig.cone((2.75, 1.0, G + 5.9), (2.75, 1.0, G + 7.0), 0.2, 0.16, rig.plastic('stack', rig.hexrgb('#5a3454'), rough=0.6), 20)   # a chimney, smoking
for k in range(5):
    rig.ball((2.8 + 0.25 * k, 1.0, G + 7.2 + 0.35 * k), 0.28 + 0.07 * k, rig.plastic('stack-smoke', rig.hexrgb('#b06a48'), rough=0.9), 'puff', 20)
rig.ball((-3.2, -1.5, G - 2.4), 3.6, rig.plastic('hill', rig.hexrgb('#1c3a22'), rough=0.6), 'hill', 64)
rig.floor(G, rig.plastic('street', rig.hexrgb('#2a1228'), rough=0.5))

rig.area('sun', (-7, -6, 5), 5.0, 3200, rgb=(1.0, 0.75, 0.5), look_at=tuple(C))
rig.area('city', (-5, -9, 2), 5.0, 800, rgb=(1.0, 0.8, 0.7), look_at=(0, 0, -2))
rig.area('rim', (6, 8, 3), 5.0, 5000, rgb=(1.0, 0.5, 0.2), look_at=tuple(C), glossy=False)
rig.world((0.5, 0.22, 0.12), 0.6)
rig.camera(60)
rig.render(OUT)
