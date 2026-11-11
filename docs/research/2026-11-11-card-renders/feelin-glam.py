"""Feelin' Glam card art exploration: Feelin' Fab's grinning cloud (fab.py) gone out for the night, in
star-shaped sunglasses under a mirror ball that throws rainbow beams and spots down a stack of posts."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('FEELIN_GLAM_SEED', '6')))
sc = rig.reset()
rig.backdrop(14, [(0.3, '#031822'), (0.5, '#0c7c9c'), (0.7, '#04202e')])
BANDS = ['#ff2a2a', '#ff8a1c', '#ffe21c', '#2fd24a', '#2a7dff', '#c03df0']

# ---- the mirror ball: flat facets, on a chain, beams fanning out of it ---------------------------
B = Vector((-0.25, 1.0, 3.05)); BR = 0.95
bpy.ops.mesh.primitive_uv_sphere_add(radius=BR, location=B, segments=22, ring_count=12)
ball = bpy.context.object                                        # each tile catches something different
for rgb, emit in (((0.9, 0.97, 1.0), 0.0), ((0.35, 0.8, 1.0), 0.0), ((0.08, 0.3, 0.5), 0.0), ((1.0, 1.0, 1.0), 1.6), ((0.5, 0.95, 1.0), 0.7)):
    ball.data.materials.append(rig.plastic('mirror', rgb, rough=0.12, metallic=0.0 if emit else 1.0, emit=emit))
for f in ball.data.polygons: f.material_index = rnd.choice((0, 0, 1, 1, 2, 2, 3, 4))
chrome = rig.plastic('chrome', (0.8, 0.95, 1.0), rough=0.1, metallic=1.0)
rig.cone(tuple(B + Vector((0, 0, BR - 0.03))), tuple(B + Vector((0, 0, BR + 0.12))), 0.16, 0.12, chrome, 24)
rig.tube('chain', [tuple(B + Vector((0, 0, BR))), tuple(B + Vector((0, 0, 4.0)))], 0.035, chrome, res=4)
for i, hx in enumerate(BANDS):
    a = math.radians(-62 + 124 * i / 5)
    end = B + Vector((math.sin(a) * 9.0, -1.1, -math.cos(a) * 9.0))
    rig.cone(tuple(B), tuple(end), 0.05, 0.75, rig.glow(f'beam{i}', rig.hexrgb(hx), 2.2, alpha=0.2), 32)
glint = rig.plastic('glint', (1.0, 1.0, 1.0), rough=0.1, emit=2.5)
def sparkle(x, y, z, s, rot):
    pts = [(math.cos(rot + j * math.pi / 4) * (s if j % 2 == 0 else s * 0.25), math.sin(rot + j * math.pi / 4) * (s if j % 2 == 0 else s * 0.25)) for j in range(8)]
    o = rig.slab('glint', pts, -0.03, 0.03, glint, 0.01); o.location = (x, y, z)
for x, z, s, rot in ((-0.75, 0.5, 0.36, 0.0), (0.5, -0.3, 0.22, 0.3), (0.3, 0.62, 0.16, 0.5)):
    sparkle(B.x + x, B.y - BR - 0.1, B.z + z, s, rot)
for i in range(46):                                              # the dots a mirror ball throws round the room
    c = rig.hexrgb(rnd.choice(BANDS + ['#ffffff', '#ffffff']))
    s = rnd.uniform(0.07, 0.16)
    o = rig.slab('dot', rig.rrect(s, s, s * 0.2, 2), -0.01, 0.01, rig.glow('dot', c, 2.0), 0.002)
    o.location = (rnd.uniform(-5.5, 5.5), 8.0, rnd.uniform(-7, 7)); o.rotation_euler = (0, rnd.uniform(0, 1.5), 0)

# ---- the cloud, as in Feelin' Fab, built about the origin and then set in place -------------------
RX, RY, RZ = 1.75, 1.0, 1.0
fluff = rig.plastic('cloud', (0.86, 0.9, 0.97), rough=0.45)
cloud = [rig.ball((0, 0, 0), 1.0, fluff, 'cloud', 64, scale=(RX, RY, RZ))]
LUMPS = [(-1.55, 0.45, 0.8), (-0.85, 0.85, 0.85), (0.05, 0.95, 0.9), (0.95, 0.8, 0.85), (1.6, 0.35, 0.8),
         (-1.95, -0.25, 0.7), (1.95, -0.3, 0.72), (-1.3, -0.7, 0.75), (-0.35, -0.85, 0.8), (0.65, -0.82, 0.8), (1.4, -0.7, 0.7)]
for x, z, r in LUMPS:
    cloud.append(rig.ball((x, 0.35, z), r, fluff, 'lump', 40))
def face(x, z, lift=0.0):
    k = max(0.0, 1 - (x / RX) ** 2 - (z / RZ) ** 2)
    return Vector((x, -RY * math.sqrt(k) - lift, z))
ink = rig.plastic('ink', (0.02, 0.025, 0.05), rough=0.6)
tooth = rig.plastic('tooth', (1.0, 1.0, 0.97), rough=0.1, coat=1.0)
smile = lambda t: (t * 0.95, -0.36 + 0.22 * t * t)
cloud.append(rig.tube('grin', [face(*smile(t), 0.0) for t in (j / 24 * 2 - 1 for j in range(25))], 0.26, ink, res=8))
TEETH = 7
for j in range(TEETH):
    t = (j + 0.5) / TEETH * 2 - 1
    x, z = smile(t * 0.9)
    bpy.ops.mesh.primitive_cube_add(size=1, location=face(x, z, 0.24))
    o = bpy.context.object; o.scale = (0.225, 0.12, 0.3); o.rotation_euler = (0, -math.atan(0.44 * t * 0.9), -x * 0.45)
    md = o.modifiers.new('bevel', 'BEVEL'); md.width = 0.035; md.segments = 3
    o.data.materials.append(tooth); cloud.append(o)
# the shades: two stars, gold rims, dark mirrored lenses
gold = rig.plastic('gold', rig.hexrgb('#ffc81c'), rough=0.12, metallic=1.0)
lens = rig.plastic('lens', rig.hexrgb('#0a0420'), rough=0.3)
SHY = -RY - 0.12
for sx in (-1, 1):
    o = rig.slab('rim', rig.star(5, 0.66, 0.36, rot=sx * 0.12), -0.06, 0.06, gold, 0.03); o.location = (sx * 0.66, SHY, 0.36); cloud.append(o)
    o = rig.slab('lens', rig.star(5, 0.53, 0.27, rot=sx * 0.12), -0.05, 0.05, lens, 0.02); o.location = (sx * 0.66, SHY - 0.07, 0.36); cloud.append(o)
    cloud.append(rig.tube('arm', [(sx * 1.05, SHY, 0.42), (sx * 1.6, -0.55, 0.45), (sx * 1.85, 0.1, 0.42)], 0.05, gold, res=5))
cloud.append(rig.tube('bridge', [(-0.3, SHY, 0.42), (0, SHY - 0.03, 0.5), (0.3, SHY, 0.42)], 0.055, gold, res=5))
C = Vector((0.05, 0.0, 0.6)); CS = 0.8
rig.group(cloud, loc=C, scale=CS)
sparkle(C.x - 0.62, -1.2, C.z + 0.55, 0.2, 0.2)                  # a glint off one lens

# ---- the thread: a stack of pale posts, the ball's spots lying across them ------------------------
paper = rig.plastic('post', rig.hexrgb('#e4f6fb'), rough=0.2, coat=0.6)
line = rig.plastic('line', rig.hexrgb('#8ab8c8'), rough=0.4)
SY = 0.9
for k in range(3):
    z = -1.85 - 1.22 * k; x = 0.12 * (k % 2) - 0.06
    o = rig.slab('post', rig.rrect(4.5, 1.04, 0.14), -0.08, 0.08, paper, 0.03); o.location = (x, SY, z)
    o = rig.slab('avatar', rig.rrect(0.62, 0.62, 0.1), -0.03, 0.03, rig.plastic('avatar', rig.hexrgb(['#18c8e8', '#ff5aa0', '#ffc81c'][k]), rough=0.2, coat=1.0), 0.01); o.location = (x - 1.75, SY - 0.1, z)
    for j in range(3):
        wd = [2.9, 2.5, 1.6][j] - 0.3 * (k == 1)
        o = rig.slab('line', rig.rrect(wd, 0.11, 0.05), -0.02, 0.02, line, 0.006); o.location = (x - 1.2 + wd / 2, SY - 0.1, z + 0.26 - 0.26 * j)
for i in range(8):
    c = rig.hexrgb(BANDS[i % 6])
    rig.ball((rnd.uniform(-2.2, 2.2), SY - 0.14, rnd.uniform(-4.4, -1.4)), rnd.uniform(0.16, 0.3), rig.glow('spot', c, 1.6, alpha=0.4), 'spot', 24, scale=(1.25, 0.02, 0.8))

rig.area('key', (-6, -9, 8), 4.0, 1500, look_at=tuple(C))
rig.area('fill', (6, -7, -2), 7.0, 400, rgb=(0.6, 0.9, 1.0), look_at=tuple(C))
rig.area('posts', (0, -6, 0), 5.0, 380, rgb=(0.85, 1.0, 1.0), look_at=(0, 0, -3.2))
rig.area('glam', (6, 5, 4), 4.0, 2600, rgb=(1.0, 0.3, 0.9), look_at=tuple(C), glossy=False)
rig.area('ball', (-3, -5, 6), 2.0, 900, rgb=(0.8, 1.0, 1.0), look_at=tuple(B), glossy=False)
rig.world((0.1, 0.4, 0.55), 0.5)
rig.camera(60)
rig.render(OUT)
