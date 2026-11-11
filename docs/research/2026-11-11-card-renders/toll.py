"""Toll card art exploration: a toll booth at dusk, its striped barrier arm down across a road that runs off to
the horizon, gold coins arcing into the basket and stacked in front. (The card's owner collects a share of what
cards played on their post earn.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('TOLL_SEED', '2')))
sc = rig.reset()
rig.backdrop(30, [(0.0, '#ffd66a'), (0.45, '#ffd66a'), (0.6, '#ff6a14'), (0.86, '#7a1648'), (1.0, '#2a0a30')])
G = -1.2
rig.floor(G, rig.plastic('desert', rig.hexrgb('#c2500f'), rough=0.45), size=120, y=20)
rig.cone((0.5, 29.5, -0.4), (0.5, 29.6, -0.4), 2.8, 2.8, rig.glow('sun', rig.hexrgb('#fff0a0'), 2.2), 96)   # the sun, half set

# ---- the road: off to the horizon, a dashed line down its middle -----------------------------------
RX = 0.75
def strip(x, y0, y1, w, z, mat):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, (y0 + y1) / 2, z)); o = bpy.context.object
    o.scale = (w, y1 - y0, 1); o.data.materials.append(mat); return o
strip(RX, -12, 60, 3.3, G + 0.01, rig.plastic('road', rig.hexrgb('#2a1420'), rough=0.3))
line = rig.plastic('road-line', rig.hexrgb('#ffd21c'), rough=0.3, emit=0.5)
edge = rig.plastic('road-edge', rig.hexrgb('#ffe9c4'), rough=0.3, emit=0.2)
for k in range(24): strip(RX, -7 + 2.6 * k, -5.7 + 2.6 * k, 0.14, G + 0.02, line)
for sx in (-1, 1): strip(RX + sx * 1.5, -12, 60, 0.08, G + 0.02, edge)

# ---- the booth, and the barrier arm down across the road -------------------------------------------
wall = rig.plastic('booth', rig.hexrgb('#ff5a14'), rough=0.12, coat=1.0)
trim = rig.plastic('booth-trim', rig.hexrgb('#3a0e1c'), rough=0.2, coat=1.0)
cream = rig.plastic('booth-cream', rig.hexrgb('#ffe9c4'), rough=0.15, coat=1.0)
chrome = rig.plastic('chrome', (1.0, 0.9, 0.8), rough=0.06, metallic=1.0)
B = Vector((-1.5, 0.9, G))
rig.box('plinth', 1.9, 1.9, 0.25, trim, B, 0.05)
rig.box('booth', 1.6, 1.6, 3.0, wall, B + Vector((0, 0, 0.25)), 0.08)
rig.box('stripe', 1.64, 1.64, 0.3, cream, B + Vector((0, 0, 1.1)), 0.03)
rig.box('roof', 2.3, 2.3, 0.28, trim, B + Vector((0, 0, 3.25)), 0.08)
rig.box('roof-cap', 1.3, 1.3, 0.2, wall, B + Vector((0, 0, 3.53)), 0.06)
lamp = rig.glow('lamp', rig.hexrgb('#ff2a1c'), 5.0); rig.ball(B + Vector((0, 0, 3.9)), 0.2, lamp, 'lamp', 24)
win = rig.glow('window', rig.hexrgb('#ffc83a'), 1.0)
o = rig.slab('window', rig.rrect(1.1, 0.95, 0.1), -0.03, 0.03, win, 0.01); o.location = B + Vector((0, -0.81, 2.25))
o = rig.slab('window-side', rig.rrect(1.1, 0.95, 0.1), -0.03, 0.03, win, 0.01); o.location = B + Vector((0.81, 0, 2.25)); o.rotation_euler = (0, 0, math.pi / 2)
rig.tube('mullion', [B + Vector((0, -0.85, 1.78)), B + Vector((0, -0.85, 2.73))], 0.04, trim, res=3)
for dz in (0, 0.5): rig.tube('frame', [B + Vector((-0.55, -0.85, 1.78 + dz * 1.9)), B + Vector((0.55, -0.85, 1.78 + dz * 1.9))], 0.05, trim, res=3)
A = Vector((-0.45, -0.1, G))                                     # the arm's post, at the road's edge
rig.box('post', 0.34, 0.34, 1.75, trim, A, 0.04)
rig.cone(A + Vector((0, -0.25, 1.5)), A + Vector((0, 0.25, 1.5)), 0.24, 0.24, chrome, 32)
red = rig.plastic('arm-red', rig.hexrgb('#f01420'), rough=0.1, coat=1.0, emit=0.15)
white = rig.plastic('arm-white', (1, 1, 1), rough=0.1, coat=1.0, emit=0.1)
SEG, N = 0.45, 7
for k in range(N):
    rig.cone(A + Vector((0.1 + SEG * k, -0.3, 1.5)), A + Vector((0.1 + SEG * (k + 1), -0.3, 1.5)), 0.13, 0.13, red if k % 2 == 0 else white, 24)
rig.ball(A + Vector((0.1 + SEG * N, -0.3, 1.5)), 0.13, red, 'arm-tip', 16)
rig.box('weight', 0.5, 0.3, 0.42, trim, A + Vector((-0.42, -0.3, 1.29)), 0.05)

# ---- the coin basket, and the coins -----------------------------------------------------------------
K = Vector((1.9, 0.5, G))
rig.cone(K, K + Vector((0, 0, 1.5)), 0.1, 0.1, trim, 16)
rig.lathe('basket', [(0.14, 1.45), (0.2, 1.6), (0.78, 2.3), (0.82, 2.32)], rig.plastic('basket', rig.hexrgb('#ffb01c'), rough=0.12, coat=1.0), K, thick=0.06)
rig.cone(K + Vector((0, 0, 0)), K + Vector((0, 0, 0.12)), 0.45, 0.4, trim, 32)
gold = rig.plastic('coin', rig.hexrgb('#ffc81c'), rough=0.12, metallic=1.0, emit=0.12)
gold2 = rig.plastic('coin-face', rig.hexrgb('#ffe27a'), rough=0.2, metallic=1.0, emit=0.2)
def coin(loc, rot=(0, 0, 0), s=1.0):
    """A thick coin lying flat at `loc`, then turned."""
    parts = [rig.cone((0, 0, -0.07), (0, 0, 0.07), 0.4, 0.4, gold, 40), rig.cone((0, 0, -0.085), (0, 0, 0.085), 0.29, 0.29, gold2, 40)]
    for z in (-0.09, 0.09):
        o = rig.slab('coin-star', rig.star(5, 0.2, 0.09), -0.012, 0.012, gold, 0.004); o.rotation_euler = (math.pi / 2, 0, 0); o.location = (0, 0, z); parts.append(o)
    return rig.group(parts, loc=loc, rot=rot, scale=s)
top = K + Vector((0, 0, 2.2))
for j in range(7):                                               # an arc of coins, tossed from the left into the basket
    t = j / 6; x = -1.0 + (top.x + 1.0) * t; z = 2.0 + (top.z - 2.0) * t + 5.6 * t * (1 - t)
    coin((x, -0.6 + 1.1 * t, z), rot=(90 + rnd.uniform(-35, 35), rnd.uniform(-40, 40), rnd.uniform(-50, 50)), s=1.0 - 0.12 * t)
for x, y, n in ((-0.15, -2.6, 6), (0.85, -3.0, 9), (1.75, -2.4, 4), (0.3, -1.7, 3)):   # stacks on the road, this side of the arm
    for k in range(n):
        coin((x + rnd.uniform(-0.04, 0.04), y + rnd.uniform(-0.04, 0.04), G + 0.09 + 0.16 * k), rot=(0, 0, rnd.uniform(0, 72)))
coin((1.35, -3.3, G + 0.38), rot=(78, 0, 25)); coin((-0.75, -2.9, G + 0.1), rot=(0, 0, 10))

rig.area('key', (-6, -9, 7), 4.0, 1700, rgb=(1.0, 0.9, 0.75), look_at=(0, 0, 0.5))
rig.area('window', (4, -8, 3), 1.2, 600, rgb=(1.0, 0.85, 0.7), look_at=(0, 0, 1), size_y=6.0, glossy=False)
rig.area('rim', (4, 8, 4), 5.0, 3000, rgb=(1.0, 0.55, 0.2), look_at=(0, 0, 1), glossy=False)
rig.area('rim-l', (-6, 7, 3), 4.0, 1500, rgb=(1.0, 0.4, 0.5), look_at=tuple(B + Vector((0, 0, 2))), glossy=False)
rig.world((0.5, 0.2, 0.1), 0.8)
rig.camera(60, elev=5, target=(0, 0, 0.3))
rig.render(OUT)
