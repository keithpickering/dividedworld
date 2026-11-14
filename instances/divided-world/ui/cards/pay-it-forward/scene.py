"""Pay It Forward card art: a boomerang wrapped as a present, bow and all, most of the way round the loop that
brings it back. (The card springs on the next Sweet cast on its post: the cast lands, and its card goes back to the
caster's hand.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('FORWARD_SEED', '3')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#5a1238'), (0.4, '#e86fa8'), (0.75, '#ffd0e6'), (1.0, '#8fd8ff')]).scale.x = 60
cloud = rig.plastic('cloud', (1.0, 0.96, 0.98), rough=0.9, emit=0.2)
for cx, cy, cz, s in ((-2.6, 9, -2.2, 1.3), (2.4, 11, -1.2, 1.5), (-1.0, 13, -3.4, 1.8), (3.2, 8, -3.3, 1.1), (-3.4, 12, 0.6, 1.0)):
    for k in range(7):
        rig.ball((cx + (k - 3) * 0.45 * s, cy + rnd.uniform(-0.3, 0.3), cz + rnd.uniform(-0.1, 0.25) * s), s * rnd.uniform(0.38, 0.6) * (1 - abs(k - 3) * 0.13), cloud, 'cloud', 24)

# ---- the boomerang, gift-wrapped ------------------------------------------------------------------
OUTLINE = [(-1.95, -1.15), (-2.02, -0.72), (-0.34, 1.28), (0.34, 1.28), (2.02, -0.72), (1.95, -1.15), (1.5, -1.3), (0.0, 0.34), (-1.5, -1.3)]
paper = rig.plastic('paper', rig.hexrgb('#ff5fa8'), rough=0.25, coat=0.6)
dot = rig.plastic('dot', rig.hexrgb('#fff6fa'), rough=0.3)
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.18, metallic=0.9, emit=0.12)
parts = [rig.slab('boomerang', OUTLINE, -0.2, 0.2, paper, 0.14)]
def inside(x, z):
    hit = False
    for (x0, z0), (x1, z1) in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1]):
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0): hit = not hit
    return hit
for gx in range(-9, 10):                 # polka dots, wherever the paper is
    for gz in range(-6, 7):
        x, z = gx * 0.24 + (gz % 2) * 0.12, gz * 0.22
        if all(inside(x + dx, z + dz) for dx, dz in ((0.16, 0), (-0.16, 0), (0, 0.16), (0, -0.16))):
            parts.append(rig.ball((x, -0.2, z), 0.055, dot, 'dot', 10, scale=(1, 0.25, 1)))
for sx in (-1, 1):                       # a ribbon round each arm
    mid = Vector((sx * 1.05, 0, -0.1)); along = Vector((sx * 1.62, 0, -1.9)).normalized(); across = Vector((-along.z, 0, along.x))
    r = rig.slab('ribbon', [tuple((mid + along * a + across * c).xz) for a, c in ((-0.11, -0.46), (0.11, -0.46), (0.11, 0.46), (-0.11, 0.46))], -0.235, 0.235, gold, 0.02); parts.append(r)
parts.append(rig.slab('ribbon', [(-0.11, 0.3), (0.11, 0.3), (0.11, 1.32), (-0.11, 1.32)], -0.235, 0.235, gold, 0.02))
for sx in (-1, 1):                       # the bow at its elbow
    bpy.ops.mesh.primitive_torus_add(major_radius=0.3, minor_radius=0.085, major_segments=40, minor_segments=12, location=(sx * 0.34, -0.3, 1.0), rotation=(math.radians(90), 0, math.radians(sx * 20)))
    o = bpy.context.object; bpy.ops.object.shade_smooth(); o.scale = (1.25, 1, 0.8); o.data.materials.append(gold); parts.append(o)
    parts.append(rig.tube('tail', [(sx * 0.05, -0.3, 0.95), (sx * 0.3, -0.32, 0.55), (sx * 0.28, -0.3, 0.2)], 0.07, gold, res=4))
parts.append(rig.ball((0, -0.34, 1.0), 0.15, gold, 'knot', 24))
rig.group(parts, loc=(0.25, 0, 1.5), rot=(-14, -28, 12), scale=1.0)

# ---- the way it goes: out, round, and back --------------------------------------------------------
trail = rig.glow('trail', rig.hexrgb('#fffbe0'), 2.2)
CX, CZ, RX, RZ = -0.2, -0.1, 2.15, 2.75
def on_loop(deg): a = math.radians(deg); return (CX + math.cos(a) * RX, 1.6, CZ + math.sin(a) * RZ)
for k in range(15):                      # dashes, from under the boomerang round to the arrowhead
    a0 = 20 - k * 19
    rig.tube('dash', [on_loop(a0 - 11 * j / 5) for j in range(6)], 0.05, trail, res=3)
tip, before = Vector(on_loop(20 - 15 * 19 - 4)), Vector(on_loop(20 - 15 * 19 + 6))
rig.cone(tuple(before), tuple(tip), 0.2, 0.0, trail, 24)
spark = rig.glow('spark', rig.hexrgb('#fff1a0'), 3.0)
for x, z, r in ((-1.9, 3.0, 0.3), (2.3, 2.5, 0.22), (1.9, 0.0, 0.18), (-2.2, 0.6, 0.2), (0.4, -1.4, 0.16)):
    o = rig.slab('spark', rig.star(4, r, r * 0.3), -0.02, 0.02, spark, 0.0); o.location = (x, -0.5, z)

LOOK = (0, 0, 1.2)
rig.area('key', (-5, -9, 7), 4.0, 2000, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 600, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2000, rgb=(1.0, 0.7, 0.85), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 500, rgb=(1.0, 0.9, 0.95), look_at=LOOK)
rig.world((0.5, 0.25, 0.4), 0.6)
rig.camera(50)
rig.render(OUT)
