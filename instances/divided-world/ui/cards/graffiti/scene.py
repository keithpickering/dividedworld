"""Graffiti card art: players scribble over a post in colored ink. A forum post as a pale slab on a
brick wall, looped over in three inks that drip, and two spray cans in front of it, one still spraying."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector, Euler
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('GRAFFITI_SEED', '3')))
sc = rig.reset()
G = -3.9
rig.floor(G, rig.plastic('pavement', rig.hexrgb('#4a2010'), rough=0.35))
# ---- the wall --------------------------------------------------------------------------------------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 3.3, 0), rotation=(math.radians(90), 0, 0))
w = bpy.context.object; w.scale = (30, 30, 1); w.data.materials.append(rig.plastic('mortar', rig.hexrgb('#3a1608'), rough=0.8))
BR = [rig.plastic(f'brick{i}', rig.hexrgb(h), rough=0.6) for i, h in enumerate(['#9a3c12', '#b04816', '#84320e', '#c85c20'])]
row = 0; z = -5.0
while z < 5.4:
    x = -4.6 - (0.5 if row % 2 else 0)
    while x < 4.6:
        o = rig.slab('brick', rig.rrect(0.92, 0.36, 0.03), -0.06, 0.06, BR[3] if rnd.random() < 0.12 else rnd.choice(BR[:3]), 0.02); o.location = (x, 3.25, z)
        x += 1.0
    z += 0.44; row += 1

# ---- the post: an avatar, a name, some lines -------------------------------------------------------
P = Vector((0.0, 2.95, 1.95)); PW, PH = 4.3, 2.9
paper = rig.plastic('post', rig.hexrgb('#fff1dc'), rough=0.3)
ink = rig.plastic('post-ink', rig.hexrgb('#4a2a1c'), rough=0.4)
head = rig.plastic('post-head', rig.hexrgb('#ff9a3a'), rough=0.3)
post = [rig.slab('post', rig.rrect(PW, PH, 0.14), -0.08, 0.08, paper, 0.03),
        rig.slab('bar', rig.rrect(PW - 0.3, 0.4, 0.08), -0.11, -0.07, head, 0.01),
        rig.slab('avatar', rig.rrect(0.75, 0.75, 0.08), -0.11, -0.07, ink, 0.01)]
post[1].location = (0, 0, PH / 2 - 0.36); post[2].location = (-PW / 2 + 0.6, 0, 0.42)
for k, wd in enumerate((2.5, 2.7, 1.6)):
    post.append(rig.slab('line', rig.rrect(wd, 0.13, 0.05), -0.11, -0.07, ink, 0.008)); post[-1].location = (-PW / 2 + 1.25 + wd / 2, 0, 0.68 - 0.27 * k)
for k, wd in enumerate((3.7, 3.4, 2.2)):
    post.append(rig.slab('line', rig.rrect(wd, 0.13, 0.05), -0.11, -0.07, ink, 0.008)); post[-1].location = (-PW / 2 + 0.3 + wd / 2, 0, -0.35 - 0.27 * k)
rig.group(post, loc=tuple(P), rot=(0, 0, 0), scale=1.18)

# ---- the scribbles: a coil dragged across the post, three times, each one dripping -----------------
INKS = ['#18d8ff', '#a6ff1c', '#ff2fa8']
paint = [rig.plastic(f'ink{i}', rig.hexrgb(h), rough=0.1, coat=1.0, emit=0.35) for i, h in enumerate(INKS)]
def scribble(mat, c, ang, length, r, loops, y):
    a = math.radians(ang); d = Vector((math.cos(a), 0, math.sin(a))); n = Vector((-math.sin(a), 0, math.cos(a))); pts = []
    for k in range(loops * 28 + 1):
        t = k / (loops * 28); q = math.tau * loops * t
        rr = r * (0.8 + 0.35 * math.sin(q * 0.37 + ang))
        pts.append(Vector((c[0], y, c[1])) + d * ((t - 0.5) * length + rr * 0.9 * math.cos(q)) + n * rr * math.sin(q))
    rig.tube('scribble', [tuple(p) for p in pts], 0.085, mat, res=6)
    lows = [p for i, p in enumerate(pts[1:-1], 1) if p.z < pts[i - 1].z and p.z <= pts[i + 1].z]
    for p in rnd.sample(lows, min(3, len(lows))):
        ln = rnd.uniform(0.35, 1.0)
        rig.tube('drip', [(p.x, y, p.z), (p.x, y, p.z - ln)], 0.05, mat, res=5); rig.ball((p.x, y, p.z - ln), 0.075, mat, 'drop', 16, scale=(1, 1, 1.3))
scribble(paint[0], (-0.2, 2.75), 6 + rnd.uniform(-4, 4), 4.5, 0.6, 5, 2.72)
scribble(paint[2], (0.15, 1.8), -14 + rnd.uniform(-4, 4), 4.9, 0.68, 4, 2.58)
scribble(paint[1], (-0.35, 1.25), 20 + rnd.uniform(-4, 4), 3.9, 0.52, 5, 2.44)

# ---- the cans --------------------------------------------------------------------------------------
chrome = rig.plastic('chrome', (1.0, 0.92, 0.85), rough=0.08, metallic=1.0)
white = rig.plastic('nozzle', (0.95, 0.95, 0.95), rough=0.2)
def can(mat, loc, rot, s, cap=False):
    parts = [rig.lathe('can', [(0.5, 0.0), (0.52, 0.06), (0.52, 1.66), (0.5, 1.72)], mat, seg=48),
             rig.lathe('rim', [(0.54, 0.0), (0.54, 0.09), (0.5, 0.1)], chrome, seg=48),
             rig.lathe('dome', [(0.54, 1.68), (0.54, 1.76), (0.42, 1.86), (0.2, 1.95), (0.16, 2.0), (0.0, 2.0)], chrome, seg=48),
             rig.lathe('label', [(0.535, 0.55), (0.535, 1.2)], white, seg=48, thick=0.02)]
    if cap: parts.append(rig.lathe('cap', [(0.4, 1.86), (0.4, 2.45), (0.34, 2.52), (0.0, 2.52)], mat, seg=48))
    else: parts += [rig.cone((0, 0, 2.0), (0, 0, 2.16), 0.1, 0.1, white, 24), rig.cone((0, -0.1, 2.1), (0, -0.16, 2.1), 0.03, 0.03, ink, 12)]
    rig.group(parts, loc=loc, rot=rot, scale=s)
    return Vector(loc) + Euler(tuple(math.radians(a) for a in rot), 'XYZ').to_matrix() @ Vector((0, 0, 2.1 * s))
can_a = rig.plastic('can-a', rig.hexrgb('#a6ff1c'), rough=0.12, coat=1.0)
can_b = rig.plastic('can-b', rig.hexrgb('#ff2fa8'), rough=0.12, coat=1.0)
nozzle = can(can_a, (1.75, -1.6, -2.75), (-14, -24, 20), 1.2)
can(can_b, (-1.6, -0.9, G), (0, 0, 0), 1.25, cap=True)
mist = rig.glow('mist', rig.hexrgb('#c8ff5a'), 1.4, alpha=0.1)
aim = Vector((-0.9, 2.4, 1.1))
rig.cone(tuple(nozzle), tuple(aim), 0.04, 0.8, mist, 40)
for k in range(40):                                              # droplets in the cone
    t = rnd.uniform(0.15, 1.0); p = nozzle.lerp(aim, t) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.55 * t
    rig.ball(tuple(p), rnd.uniform(0.02, 0.045), paint[1], 'fleck', 8)

rig.area('key', (-6, -9, 7), 4.0, 2600, rgb=(1.0, 0.92, 0.85), look_at=tuple(P))
rig.area('cans', (3, -8, -1), 4.0, 900, rgb=(1.0, 0.85, 0.7), look_at=(0, -1, -2))
rig.area('wash', (6, -3, 5), 5.0, 1200, rgb=(1.0, 0.6, 0.3), look_at=(0, 3, 0), glossy=False)
rig.world((0.4, 0.18, 0.08), 0.6)
rig.camera(60, elev=3)
rig.render(OUT)
