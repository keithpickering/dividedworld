"""Hot Box, a Minus World spell, as a 90s render. Its icon's alt text: "a stoned emoji with bloodshot eyes sits
among puffy clouds"."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('HAZY_SEED', '7')))
sc = rig.reset()
rig.backdrop(14, [(0.0, '#0f7a2a'), (0.5, '#2fc04a'), (1.0, '#178a34')])
C = Vector((-0.05, 0.6, 0.85)); R = 2.3

skin = rig.plastic('face', rig.hexrgb('#74c4f2'), rough=0.25, coat=0.6)
ink = rig.plastic('ink', rig.hexrgb('#123a6a'), rough=0.3, coat=1.0)
white = rig.plastic('eye', rig.hexrgb('#ff8ab4'), rough=0.15, coat=1.0, emit=0.15)
pupil = rig.plastic('pupil', rig.hexrgb('#b01438'), rough=0.2, coat=1.0)
rig.ball(C, R, skin, 'face', 96)
def face(x, z, lift=0.0):
    k = max(0.0, R * R - x * x - z * z)
    return C + Vector((x, -math.sqrt(k) - lift, z))
for sx in (-1, 1):                                               # eyes: pink, heavy-lidded, looking nowhere in particular
    p = face(sx * 0.85, 0.75, -0.12)
    o = rig.ball(p, 0.62, white, 'eye', 48, scale=(1.15, 0.5, 0.72)); o.rotation_euler = (0, math.radians(-sx * 8), 0)
    rig.ball(p + Vector((sx * -0.08, -0.26, -0.06)), 0.2, pupil, 'pupil', 32, scale=(1.35, 0.5, 0.7))
    o = rig.ball(p + Vector((0, -0.03, 0.2)), 0.64, skin, 'lid', 48, scale=(1.2, 0.56, 0.62)); o.rotation_euler = (0, math.radians(-sx * 8), 0)   # the lid, half down
    for k, (dx, dz) in enumerate(((-0.42, -0.02), (-0.3, -0.16), (0.44, -0.04), (0.3, -0.17))):                # bloodshot: a few veins in from the corners
        rig.tube('vein', [p + Vector((dx, -0.3, dz)), p + Vector((dx * 0.72, -0.31, dz - 0.03 + 0.04 * (k % 2))), p + Vector((dx * 0.5, -0.31, dz - 0.02))], 0.012, pupil, res=2)
    rig.tube('lid-line', [p + Vector((math.cos(a) * 0.74, -0.33, -0.02 + math.sin(a) * 0.1 - 0.0)) for a in (math.radians(200 + 140 * j / 16) for j in range(17))], 0.03, ink, res=4)
rig.tube('smile', [face(-1.35 + 2.7 * t, -0.35 - 0.8 * math.sin(math.pi * t) ** 0.9, 0.03) for t in (j / 40 for j in range(41))], 0.06, ink, res=6)
for sx in (-1, 1):                                               # the corners of it, tucked up
    rig.tube('corner', [face(sx * 1.35 + sx * 0.02, -0.35 + 0.16, 0.03), face(sx * 1.35, -0.35, 0.03), face(sx * 1.35 - sx * 0.1, -0.35 - 0.1, 0.03)], 0.05, ink, res=4)

# ---- the smoke: banks of it in every corner, drifting across the face ---------------------------
TONES = ['#a9b59a', '#96a48a', '#b8c2a8', '#8c9a80']
def bank(cx, cz, n, spread, y0, y1, r0=0.55, r1=1.1):
    for i in range(n):
        a = rnd.uniform(0, math.tau); d = rnd.uniform(0, 1) ** 0.6 * spread
        rig.ball((cx + math.cos(a) * d, rnd.uniform(y0, y1), cz + math.sin(a) * d * 0.8), rnd.uniform(r0, r1),
                 rig.plastic('smoke', rig.hexrgb(rnd.choice(TONES)), rough=0.95), 'smoke', 28)
bank(-2.4, 3.3, 9, 1.4, -1.9, -0.8); bank(2.3, 3.5, 9, 1.5, -1.9, -0.8); bank(-2.6, -1.9, 10, 1.5, -2.0, -0.9)
bank(2.5, -2.4, 10, 1.6, -2.0, -0.9); bank(0.0, -3.9, 12, 2.4, -2.1, -1.0); bank(-2.9, 0.8, 5, 0.8, -1.8, -1.2, 0.4, 0.8)
bank(0.3, 4.4, 6, 1.6, 0.5, 2.5)

rig.area('key', (-6, -9, 7), 4.0, 1800, look_at=tuple(C))
rig.area('window', (3.5, -8, 3), 1.3, 800, look_at=tuple(C), size_y=6.0)
rig.area('rim', (6, 6, 4), 5.0, 2500, rgb=(0.7, 1.0, 0.7), look_at=tuple(C), glossy=False)
rig.world((0.2, 0.45, 0.25), 0.6)
rig.camera(60)
rig.render(OUT)
