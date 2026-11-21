"""A bouquet of roses caught out of the air by a black glove on a striped sleeve: the scene Pop Steal's art was not
made from (README.md, beside this). The bouquet is built standing on z with its grip at the origin, in the list `bq`,
before it is laid in the hand; the hand is Rope Break's, gloved. Run it from this folder, with the cards' rig:

    python bouquet.py bouquet.webp"""
import sys, os, math, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'instances', 'divided-world', 'ui', 'cards'))   # the rig the card scenes share
sys.dont_write_bytecode = True
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('POP_SEED', '7')))
sc = rig.reset()

def smooth(pts, passes=3):
    pts = [Vector(p) for p in pts]
    for _ in range(passes):
        out = [pts[0]]
        for a, c in zip(pts, pts[1:]): out += [a * 0.75 + c * 0.25, a * 0.25 + c * 0.75]
        pts = out + [pts[-1]]
    return [tuple(p) for p in pts]

rig.backdrop(22, [(0.0, '#0c0106'), (0.4, '#4a0a2a'), (0.75, '#c21860'), (1.0, '#1c0410')]).scale = (80, 50, 1)
for i in range(44):
    hx = rnd.choice(['#ffffff', '#ffd0e4', '#ff7fb0', '#fff1c0'])
    rig.ball((rnd.uniform(-18, 18), rnd.uniform(17, 21), rnd.uniform(-9, 4)), rnd.uniform(0.15, 0.5), rig.glow('flash', rig.hexrgb(hx), rnd.uniform(0.6, 2.5), alpha=0.5), 'flash', 16)
G = -3.3
m, n, l, b = rig.material('mat'); b.inputs['Base Color'].default_value = (*rig.hexrgb('#b81858'), 1); b.inputs['Roughness'].default_value = 0.5
rig.box('ring', 40, 14, 0.6, m, (0, 6, G - 0.6), bevel=0.08)
for z, hx in ((G + 1.0, '#fbf6ec'), (G + 2.3, '#ff7fb0'), (G + 3.6, '#fbf6ec')):
    rig.tube('rope', [(-14, 5, z), (14, 5, z)], 0.13, rig.plastic('rope', rig.hexrgb(hx), rough=0.45), res=6)

# ---- the bouquet, built standing on z with the grip at the origin ------------------------------------
paper = rig.plastic('paper', rig.hexrgb('#2ee6ff'), rough=0.3, coat=0.4, emit=0.1)
inner = rig.plastic('paper-in', rig.hexrgb('#f0fcff'), rough=0.4)
ribbon = rig.plastic('ribbon', rig.hexrgb('#fbf6ec'), rough=0.25, coat=1.0)
red = rig.plastic('rose', rig.hexrgb('#ff1f4f'), rough=0.18, coat=1.0, emit=0.08)
deep = rig.plastic('rose-deep', rig.hexrgb('#8a0628'), rough=0.3)
leaf = rig.plastic('leaf', rig.hexrgb('#1fbf6a'), rough=0.3, coat=0.6)
stem = rig.plastic('stem', rig.hexrgb('#128a4a'), rough=0.4)
bq = []
bq.append(rig.cone((0, 0, -1.5), (0, 0, -0.4), 0.13, 0.16, stem, 24))
bq.append(rig.lathe('wrap', [(0.15, -0.55), (0.2, 0.0), (0.5, 0.9), (1.1, 1.9), (1.35, 2.2)], paper, seg=10, thick=0.03))
bq.append(rig.lathe('wrap-in', [(0.3, 0.6), (1.0, 1.9), (1.28, 2.3)], inner, seg=48))
def rose(c, d, r):
    c, d = Vector(c), Vector(d).normalized()
    u = d.cross(Vector((0, 1, 0.3))).normalized(); v = d.cross(u)
    out = [rig.ball(tuple(c), r, red, 'rose', 32)]
    pts = [c + (u * math.cos(t * 7) * math.sin(0.15 + t * 1.25) + v * math.sin(t * 7) * math.sin(0.15 + t * 1.25) + d * math.cos(0.15 + t * 1.25)) * r * 1.01 for t in (k / 80 for k in range(81))]
    out.append(rig.tube('swirl', [tuple(p) for p in pts], r * 0.07, deep, res=4))
    return out
TOPZ = 2.35
bq += rose((0, -0.1, TOPZ + 0.35), (0, -0.5, 1), 0.52)
for k in range(6):
    a = math.tau * k / 6 + 0.3
    bq += rose((math.cos(a) * 0.78, math.sin(a) * 0.78, TOPZ + 0.02), (math.cos(a) * 0.9, math.sin(a) * 0.9 - 0.3, 1), 0.44)
LEAF = [(0, 0), (0.22, 0.25), (0.2, 0.6), (0, 0.95), (-0.2, 0.6), (-0.22, 0.25)]
for k in range(5):
    a = math.tau * k / 5 + 0.9
    o = rig.slab('leaf', LEAF, -0.02, 0.02, leaf, 0.01); o.location = (math.cos(a) * 1.15, math.sin(a) * 1.15, TOPZ - 0.25)
    o.rotation_euler = (math.radians(20), math.radians(-55) * math.cos(a), 0); bq.append(o)
# the ribbon, tied above the grip: a band and a bow
bq.append(rig.cone((0, 0, 0.42), (0, 0, 0.62), 0.37, 0.45, ribbon, 32))
for sx in (-1, 1):
    loop = [(0, -0.42, 0.52)] + [(sx * (0.1 + 0.45 * math.sin(t)), -0.5, 0.52 + 0.3 * math.sin(2 * t) * 0.8 + 0.12 * math.sin(t)) for t in (math.pi * k / 16 for k in range(1, 16))] + [(0, -0.42, 0.52)]
    bq.append(rig.tube('bow', loop, 0.06, ribbon, res=5))
    bq.append(rig.tube('tail', smooth([(0, -0.44, 0.5), (sx * 0.25, -0.5, 0.1), (sx * 0.2, -0.5, -0.35)], 2), 0.055, ribbon, res=5))
bq.append(rig.ball((0, -0.46, 0.52), 0.11, ribbon, 'knot', 16))
broot = rig.group(bq, rot=(0, 90, 0))                    # lay it along x, which is where the hand holds a rope

# ---- the hand, as Rope Break's --------------------------------------------------------------------------
glove = rig.plastic('glove', rig.hexrgb('#1a1014'), rough=0.34, coat=0.35)
trim = rig.plastic('trim', rig.hexrgb('#ff3d7f'), rough=0.3, coat=0.5, emit=0.15)
stud = rig.plastic('stud', (0.95, 0.9, 0.95), rough=0.06, metallic=1.0)
white = rig.plastic('stripe', rig.hexrgb('#fbf6ec'), rough=0.55)
black = rig.plastic('stripe-dark', rig.hexrgb('#17090f'), rough=0.55)
hand = [broot]
for k, x in enumerate((-0.54, -0.18, 0.18, 0.54)):
    reach = (0.0, 0.07, 0.05, -0.06)[k]
    path = smooth([(x, -0.5, -0.62), (x, -0.5, -0.05), (x, -0.36, 0.36 + reach), (x, 0.02, 0.45 + reach), (x, 0.34, 0.22), (x, 0.36, -0.12)])
    hand.append(rig.tube('finger', path, 0.18, glove, res=6))
    hand.append(rig.ball((x, -0.5, -0.05), 0.205, glove, 'knuckle', 20))
    hand.append(rig.ball((x, -0.7, -0.05), 0.07, stud, 'stud', 16))
hand.append(rig.tube('thumb', smooth([(-0.55, -0.55, -1.0), (-1.02, -0.5, -0.62), (-1.0, -0.3, -0.3), (-0.72, -0.08, -0.24)]), 0.205, glove, res=6))
hand.append(rig.ball((0, -0.52, -0.92), 0.8, glove, 'palm', 40, scale=(1.0, 0.42, 0.78)))
WRIST = Vector((0.05, -0.55, -1.55)); AX = Vector((0.2, -0.05, -1.0)).normalized()
hand.append(rig.cone(tuple(WRIST + Vector((0, 0, 0.3))), tuple(WRIST + AX * 0.45), 0.56, 0.74, glove, 40))
hand.append(rig.cone(tuple(WRIST + AX * 0.45), tuple(WRIST + AX * 0.6), 0.76, 0.78, trim, 40))
r = 0.52
for k in range(26):
    a, b2 = WRIST + AX * (0.55 + 0.25 * k), WRIST + AX * (0.55 + 0.25 * (k + 1))
    hand.append(rig.cone(tuple(a), tuple(b2), r, r + 0.012, white if k % 2 else black, 40)); r += 0.012
h = rig.group(hand, rot=(0, float(os.environ.get('POP_TURN', '-62')), 0), scale=0.95)
rig.group([h], loc=(-0.2, 0, -0.3), rot=(42, 0, 0))

# petals and stars
pet = rig.plastic('petal', rig.hexrgb('#ff1f4f'), rough=0.2, coat=1.0, emit=0.1)
for i in range(16):
    o = rig.ball((rnd.uniform(-2.6, 2.6), rnd.uniform(-1.5, 1.5), rnd.uniform(-3.8, 3.8)), 0.13, pet, 'petal', 12, scale=(1, 0.25, 1.4))
    o.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
gold = rig.glow('star', rig.hexrgb('#fff1a0'), 3.0)
for x, z, r, turn in ((-2.1, 3.3, 0.3, 0.2), (2.2, 3.0, 0.22, -0.3), (-2.3, 0.6, 0.2, 0.5), (2.2, 1.2, 0.2, 0.1)):
    o = rig.slab('star', rig.star(4, r, r * 0.3, turn), -0.02, 0.02, gold, 0.0); o.location = (x, -0.6, z)

LOOK = (0, 0, 1.2)
beam = rig.glow('beam', rig.hexrgb('#ffc0dc'), 0.8, alpha=0.035)
rig.cone((-3.5, 3.0, 10), (0.4, 3.0, -3.3), 0.3, 2.8, beam, 64)
rig.area('key', (-5, -9, 7), 4.0, 1900, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 500, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2600, rgb=(1.0, 0.45, 0.75), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 400, rgb=(1.0, 0.9, 0.95), look_at=LOOK)
rig.world((0.12, 0.02, 0.08), 0.7)
rig.camera(50)
rig.render(OUT)
