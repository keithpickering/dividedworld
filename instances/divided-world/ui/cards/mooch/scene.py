"""Mooch card art: a grinning glossy piggy bank on a pedestal, sipping through a long bendy straw
that runs down into somebody else's pot of glowing gold coins."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('MOOCH_SEED', '7')))
sc = rig.reset()
rig.backdrop(18, [(0.3, '#16030e'), (0.53, '#8a1450'), (0.75, '#2a061a')])
G = -3.8
rig.floor(G, rig.checker('floor', '#3a0a22', '#b82a70', 50, rough=0.12))

# ---- the pig: built facing the camera about its own middle, then turned toward the coins ---------
pink = rig.plastic('pig', rig.hexrgb('#ff6aa8'), rough=0.06, coat=1.0, emit=0.08)
deep = rig.plastic('pig-deep', rig.hexrgb('#e0387a'), rough=0.1, coat=1.0)
ink = rig.plastic('ink', (0.05, 0.01, 0.03), rough=0.3)
RX, RY, RZ = 1.15, 1.4, 1.08
def pf(x, z, lift=0.0):
    k = max(0.0, 1 - (x / RX) ** 2 - (z / RZ) ** 2)
    return (x, -RY * math.sqrt(k) - lift, z)
pig = [rig.ball((0, 0, 0), 1.0, pink, 'body', 64, scale=(RX, RY, RZ)),
       rig.cone((0, -1.25, -0.02), (0, -1.72, -0.02), 0.44, 0.4, pink, 40),
       rig.ball((0, -1.72, -0.02), 0.4, deep, 'snout', 40, scale=(1, 0.25, 1))]
for sx in (-1, 1):
    pig.append(rig.ball((sx * 0.15, -1.81, 0.0), 0.075, ink, 'nostril', 16, scale=(0.8, 0.5, 1.3)))
    pig.append(rig.tube('eye', [pf(sx * 0.52 + math.cos(a) * 0.2, 0.48 + math.sin(a) * 0.17, 0.02) for a in (math.radians(15 + 150 * j / 12) for j in range(13))], 0.07, ink, res=5))
    pig.append(rig.cone((sx * 0.7, -0.1, 0.78), (sx * 1.05, -0.2, 1.45), 0.36, 0.0, pink, 24))
    pig.append(rig.ball(pf(sx * 0.82, 0.12, -0.05), 0.2, deep, 'cheek', 20, scale=(1, 0.4, 0.8)))
    for sy in (-1, 1):
        pig.append(rig.cone((sx * 0.6, sy * 0.75, -0.7), (sx * 0.62, sy * 0.78, -1.3), 0.33, 0.27, pink, 24))
pig.append(rig.tube('grin', [pf(-0.72 + 1.44 * t, -0.4 - 0.26 * math.sin(math.pi * t), 0.01) for t in (j / 16 for j in range(17))], 0.06, ink, res=5))
o = rig.slab('slot', rig.rrect(0.14, 0.75, 0.05), -0.05, 0.05, ink, 0.01); o.rotation_euler = (math.radians(90), 0, 0); o.location = (0, 0, RZ - 0.02); pig.append(o)
pig.append(rig.tube('tail', [(0.18 * math.cos(t * 9), RY - 0.05 + 0.5 * t, 0.2 + 0.18 * math.sin(t * 9)) for t in (j / 30 for j in range(31))], 0.05, pink, res=5))
P = Vector((-0.6, 0.6, 1.75)); TURN = 30
rig.group(pig, loc=P, rot=(0, 0, TURN))
q = math.radians(TURN)
def world_of(x, y, z):
    return P + Vector((x * math.cos(q) - y * math.sin(q), x * math.sin(q) + y * math.cos(q), z))

stone = rig.plastic('pedestal', rig.hexrgb('#f0d0e0'), rough=0.2, coat=1.0)
rig.lathe('pedestal', [(0.0, 0.0), (1.35, 0.0), (1.38, 0.22), (1.05, 0.4), (0.85, 0.7), (0.82, P.z - 1.3 - G - 0.45), (1.1, P.z - 1.3 - G - 0.25), (1.35, P.z - 1.3 - G - 0.18), (1.35, P.z - 1.3 - G), (0.0, P.z - 1.3 - G)],
          stone, (P.x, P.y + 0.1, G), seg=48)

# ---- the other fellow's pot of coins ---------------------------------------------------------------
H = Vector((1.35, -0.7, -2.15))                    # the top of the heap
pot = rig.plastic('pot', rig.hexrgb('#1a2a6a'), rough=0.15, coat=1.0)
POT_TOP = H.z - 0.55
rig.lathe('pot', [(0.0, 0.0), (0.7, 0.0), (1.0, 0.25), (1.12, 0.7), (1.0, POT_TOP - G - 0.15), (1.1, POT_TOP - G), (0.95, POT_TOP - G), (0.0, POT_TOP - G - 0.05)], pot, (H.x, H.y, G), seg=48)
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.2, metallic=0.9, emit=0.22)
COIN = [(0.0, 0.0), (0.33, 0.0), (0.36, 0.03), (0.36, 0.09), (0.33, 0.12), (0.0, 0.12)]
def coin(loc, tilt=0.7):
    o = rig.lathe('coin', COIN, gold, loc, seg=24)
    o.rotation_euler = (rnd.uniform(-tilt, tilt), rnd.uniform(-tilt, tilt), 0)
for i in range(42):
    r = 0.95 * math.sqrt(rnd.random()); a = rnd.uniform(0, math.tau)
    coin((H.x + math.cos(a) * r, H.y + math.sin(a) * r, POT_TOP - 0.1 + (1 - r / 0.95) * 0.55 + rnd.uniform(-0.05, 0.05)))
for x, y in ((0.2, -1.6), (2.3, -1.4), (0.7, -2.2)):
    coin((x, y, G), tilt=0.05)
gl = bpy.data.lights.new('gold', 'POINT'); gl.energy = 250; gl.color = (1.0, 0.8, 0.3)
go = bpy.data.objects.new('gold', gl); sc.collection.objects.link(go); go.location = H + Vector((-0.3, -1.2, 0.9))

# ---- the straw: out of the corner of the grin, a bendy elbow, then down into the heap ------------
m = world_of(0.3, -1.42, -0.5)
out = Vector((math.sin(q), -math.cos(q), 0))
p1 = m + out * 1.0 + Vector((0.15, 0, 0.15))
N = 60
def bez(t):
    return m.lerp(p1, t).lerp(p1.lerp(H, t), t)
pts = [bez(k / N) for k in range(N + 1)]
STRAW = [rig.plastic('straw-a', (1.0, 1.0, 1.0), rough=0.15, coat=1.0), rig.plastic('straw-b', rig.hexrgb('#18c8e8'), rough=0.15, coat=1.0, emit=0.15)]
for k in range(0, N, 4):
    rig.tube('straw', [tuple(p) for p in pts[k:k + 5]], 0.085, STRAW[(k // 4) % 2], res=6)
for k in range(17, 30, 2):                                       # the elbow's ribs
    rig.ball(tuple(pts[k]), 0.115, STRAW[0], 'rib', 16)

rig.area('key', (-5, -10, 7), 4.0, 2000, look_at=tuple(P))
rig.area('fill', (6, -8, 0), 6.0, 500, rgb=(1.0, 0.75, 0.9), look_at=(0, 0, 0))
rig.area('rim', (6, 6, 6), 4.0, 3200, rgb=(1.0, 0.4, 0.7), look_at=tuple(P), glossy=False)
rig.world((0.14, 0.03, 0.08), 0.6)
rig.camera(60, elev=6)
rig.render(OUT)
