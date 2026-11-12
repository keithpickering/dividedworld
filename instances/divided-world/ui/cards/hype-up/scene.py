"""Hype-Up card art: you boost another character's earnings, a hype man. A giant foam finger raised
high, a megaphone throwing stars and rings, pom-poms and confetti."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('HYPE_UP_SEED', '7')))
sc = rig.reset()
rig.backdrop(16, [(0.0, '#052a5c'), (0.42, '#0c78b8'), (0.72, '#1fa8d8'), (1.0, '#084a94')])

# ---- the foam finger -------------------------------------------------------------------------------
foam = rig.plastic('foam', rig.hexrgb('#2fe6ff'), rough=0.38, emit=0.12)
trim = rig.plastic('foam-trim', rig.hexrgb('#f2feff'), rough=0.4)
groove = rig.plastic('groove', rig.hexrgb('#0a7aa8'), rough=0.5)
HAND = [(-0.6, -1.7), (0.6, -1.7), (0.78, -0.9), (1.05, -0.2), (1.05, 0.55), (0.85, 0.82), (0.42, 0.86), (0.4, 2.65), (0.2, 3.0), (-0.2, 3.0), (-0.4, 2.65),
        (-0.44, 0.8), (-0.6, 0.45), (-0.95, 0.75), (-1.25, 0.6), (-1.3, 0.2), (-0.95, -0.55), (-0.75, -1.0)]
hand = [rig.slab('edge', HAND, -0.2, 0.42, trim, 0.1), rig.slab('hand', HAND, -0.42, 0.2, foam, 0.14)]
hand[0].scale = (1.07, 1, 1.04); hand[0].location = (0, 0, 0.03)
for k in range(3):                                               # the curled fingers of the fist
    x = 0.5 + 0.02 * k; z = 0.52 - 0.36 * k
    hand.append(rig.tube('knuckle', [(-0.3, -0.44, z), (0.2, -0.47, z - 0.02), (x + 0.42, -0.44, z - 0.06)], 0.035, groove, res=5))
hand.append(rig.tube('thumb', [(-0.95, -0.44, 0.3), (-0.62, -0.47, 0.05), (-0.5, -0.44, -0.4)], 0.035, groove, res=5))
hand.append(rig.slab('cuff', rig.rrect(1.5, 0.3, 0.1), -0.48, 0.25, trim, 0.05)); hand[-1].location = (0, 0, -1.55)
F = Vector((0.55, 0.6, 0.95))
rig.group(hand, loc=tuple(F), rot=(-4, 16, -9), scale=1.12)

# ---- the megaphone, and what comes out of it -------------------------------------------------------
white = rig.plastic('horn', rig.hexrgb('#f6ffff'), rough=0.12, coat=1.0)
yellow = rig.plastic('yellow', rig.hexrgb('#ffd21c'), rough=0.1, coat=1.0, emit=0.3)
hot = rig.plastic('hot', rig.hexrgb('#ff3d9a'), rough=0.1, coat=1.0, emit=0.2)
dark = rig.plastic('horn-dark', rig.hexrgb('#06323e'), rough=0.3)
M = Vector((-2.0, -0.4, -2.5)); D = Vector((0.36, -0.2, 0.9)).normalized()
rig.cone(tuple(M), tuple(M + D * 1.6), 0.2, 0.82, white, 48)
rig.cone(tuple(M + D * 1.6), tuple(M + D * 1.72), 0.86, 0.9, hot, 48)
rig.cone(tuple(M + D * 1.725), tuple(M + D * 1.73), 0.78, 0.78, dark, 48)
rig.cone(tuple(M - D * 0.5), tuple(M), 0.26, 0.26, hot, 32)
rig.cone(tuple(M - D * 0.15 + Vector((0.1, 0, -0.1))), tuple(M - D * 0.15 + Vector((0.55, 0.1, -0.75))), 0.11, 0.11, dark, 16)
ring = rig.plastic('ring', rig.hexrgb('#ffffff'), rough=0.2, emit=1.5)
for t, r in ((2.2, 0.45), (2.75, 0.62), (3.3, 0.8)):
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.065, location=tuple(M + D * t), major_segments=64, minor_segments=12)
    o = bpy.context.object; o.rotation_euler = D.to_track_quat('Z', 'Y').to_euler(); o.data.materials.append(ring); bpy.ops.object.shade_smooth()
def starburst(p, r, mat, rot):
    o = rig.slab('star', rig.star(5, r, r * 0.48, rot), -0.07, 0.07, mat, 0.03); o.location = p
    o.rotation_euler = (rnd.uniform(-0.3, 0.3), 0, rnd.uniform(-0.3, 0.3))
for t, side, r in ((2.3, -0.95, 0.26), (3.0, 1.05, 0.34), (4.0, 0.75, 0.4)):   # stars thrown along the shout
    starburst(tuple(M + D * t + Vector((-D.z, 0, D.x)) * side), r, yellow, rnd.uniform(-0.5, 0.5))
for x, z, r in ((-1.9, 3.3, 0.44), (-0.9, 3.75, 0.24), (2.15, 1.7, 0.3), (2.2, -0.3, 0.38), (-2.2, 0.55, 0.26), (1.75, 2.75, 0.2)):
    starburst((x, rnd.uniform(-0.5, 1.5), z), r, yellow, rnd.uniform(-0.5, 0.5))

# ---- pom-poms and confetti -------------------------------------------------------------------------
def pom(c, r, mats, n=150):
    rig.ball(c, r * 0.45, mats[0], 'pom', 16)
    for i in range(n):
        u = rnd.uniform(-1, 1); q = rnd.uniform(0, math.tau); s = math.sqrt(1 - u * u)
        d = Vector((s * math.cos(q), s * math.sin(q), u))
        rig.cone(c, tuple(Vector(c) + d * r * rnd.uniform(0.8, 1.1)), 0.02, 0.075, rnd.choice(mats), 6)
pom((2.0, -1.2, -2.2), 1.15, [hot, hot, trim])
pom((0.1, -1.6, -3.2), 1.0, [yellow, yellow, trim])
pom((-1.95, 1.2, 1.85), 0.8, [hot, trim, hot], 110)
CONF = [rig.plastic(f'confetti{i}', rig.hexrgb(h), rough=0.2, emit=0.3) for i, h in enumerate(('#ffd21c', '#ff3d9a', '#ffffff', '#7a5cff', '#3dff8a'))]
for i in range(90):
    o = rig.slab('confetti', rig.rrect(0.15, 0.08, 0.01, 1), -0.008, 0.008, rnd.choice(CONF), 0.002)
    o.location = (rnd.uniform(-2.8, 2.8), rnd.uniform(-2.5, 2.5), rnd.uniform(-1.5, 4.3)); o.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))

rig.area('key', (-6, -9, 8), 4.0, 2200, look_at=tuple(F))
rig.area('fill', (6, -7, -2), 7.0, 700, rgb=(0.85, 0.95, 1.0), look_at=(0, 0, 0))
rig.area('low', (0, -7, -5), 5.0, 600, rgb=(1.0, 1.0, 0.9), look_at=(0, -1, -2))
rig.area('rim', (5, 6, 5), 4.0, 2000, rgb=(0.6, 0.95, 1.0), look_at=tuple(F), glossy=False)
rig.world((0.3, 0.75, 1.0), 0.45)
rig.camera(60)
rig.render(OUT)
