"""Line Cutter card art: a queue of dull pawns along a velvet rope, going back into the dark, and
one glossy orange pawn squeezing in right behind the front of the line, pleased with itself."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('LINE_CUTTER_SEED', '3')))
sc = rig.reset()
rig.backdrop(30, [(0.0, '#120502'), (0.52, '#5a1c06'), (0.6, '#c2520f'), (0.68, '#3a1004'), (1.0, '#0a0302')])
G = -3.0
rig.floor(G, rig.checker('floor', '#2a1206', '#8a3a10', 56, rough=0.12))

ink = rig.plastic('ink', (0.02, 0.015, 0.01), rough=0.4)
white = rig.plastic('eye', (1.0, 1.0, 0.95), rough=0.15, coat=1.0)
HEAD_Z, HEAD_R = 3.35, 0.62
BODY = [(0.0, 0.0), (0.85, 0.0), (0.9, 0.12), (0.82, 0.3), (0.5, 0.75), (0.36, 1.6), (0.3, 2.5), (0.55, 2.62), (0.55, 2.72), (0.25, 2.85), (0.0, 2.85)]

def fp(x, z, lift=0.0):
    """The point on a pawn's head, on its front, over (x, z) from the head's middle."""
    return (x, -math.sqrt(max(0.0, HEAD_R ** 2 - x * x - z * z)) - lift, HEAD_Z + z)

def pawn(loc, mat, s=1.0, rot=(0, 0, 0), mood=None):
    """A pawn standing with its foot at `loc`. mood: 'smug' or 'cross' gives it a face."""
    parts = [rig.lathe('body', BODY, mat, seg=48), rig.ball((0, 0, HEAD_Z), HEAD_R, mat, 'head', 40)]
    if mood == 'smug':
        for sx in (-1, 1):
            parts.append(rig.ball(fp(sx * 0.23, 0.1, 0.02), 0.15, white, 'eye', 20, scale=(1, 0.5, 0.8)))
            parts.append(rig.ball(fp(sx * 0.23 + 0.06, 0.08, 0.09), 0.065, ink, 'pupil', 16))
        parts.append(rig.tube('brow', [fp(-0.4, 0.26, 0.02), fp(-0.1, 0.3, 0.02)], 0.035, ink, res=4))
        parts.append(rig.tube('brow', [fp(0.1, 0.4, 0.02), fp(0.4, 0.46, 0.02)], 0.035, ink, res=4))
        parts.append(rig.tube('smirk', [fp(-0.22 + 0.5 * t, -0.27 + 0.2 * t * t, 0.01) for t in (j / 12 for j in range(13))], 0.04, ink, res=5))
    if mood == 'cross':
        for sx in (-1, 1):
            parts.append(rig.ball(fp(sx * 0.22, 0.05, 0.0), 0.07, ink, 'eye', 16))
            parts.append(rig.tube('brow', [fp(sx * 0.08, 0.14, 0.02), fp(sx * 0.4, 0.3, 0.02)], 0.04, ink, res=4))
        parts.append(rig.tube('frown', [fp(-0.2 + 0.4 * t, -0.3 + 0.1 * math.sin(math.pi * t), 0.01) for t in (j / 10 for j in range(11))], 0.035, ink, res=4))
    return rig.group(parts, loc=loc, rot=rot, scale=s)

# ---- the queue: the front of it nearest, the rest going back and to the right into the dark ------
DULL = [rig.plastic(f'dull{i}', rig.hexrgb(h), rough=0.45) for i, h in enumerate(['#7a6a5e', '#6e6054', '#84725f'])]
FRONT = Vector((-1.75, -1.6, G)); STEP = Vector((1.0, 2.3, 0))
pawn(FRONT, DULL[0], 1.2, rot=(0, 0, -20))
for k in range(1, 9):
    p = FRONT + STEP * (k + 0.55) + Vector((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.15, 0.15), 0))
    pawn(p, DULL[k % 3], 1.2, rot=(0, -5 if k == 1 else 0, 35 if k == 1 else rnd.uniform(-25, 5)), mood='cross' if k < 3 else None)

# ---- the cutter: bright, glossy, leaning in sideways behind the front of the line ----------------
orange = rig.plastic('cutter', rig.hexrgb('#ff6a08'), rough=0.06, coat=1.0, emit=0.12)
CUT = FRONT + STEP * 0.78 + Vector((-0.5, 0, 0))
pawn(CUT, orange, 1.3, rot=(0, 13, -8), mood='smug')

# ---- the rope: brass posts on the near side of the line, velvet sagging between them -------------
brass = rig.plastic('brass', rig.hexrgb('#ffc24a'), rough=0.12, metallic=1.0)
velvet = rig.plastic('velvet', rig.hexrgb('#b01028'), rough=0.6)
POST = [(0.0, 0.0), (0.42, 0.0), (0.44, 0.08), (0.12, 0.2), (0.07, 0.3), (0.07, 1.95), (0.17, 2.0), (0.2, 2.15), (0.12, 2.28), (0.0, 2.3)]
tops = []
for k in range(6):
    p = FRONT + STEP * (k * 1.6 - 0.3) + Vector((1.55, -0.6, 0))
    rig.lathe('post', POST, brass, p, seg=32); tops.append(p + Vector((0, 0, 2.0)))
for a, b in zip(tops, tops[1:]):
    rig.tube('rope', [tuple(a.lerp(b, t) - Vector((0, 0, 0.5 * math.sin(math.pi * t)))) for t in (j / 16 for j in range(17))], 0.075, velvet, res=5)

# ---- light: a hard lamp on the cutter, a warm wash on the near queue, the far end left dark ------
head = CUT + Vector((0, 0, 4.2))
sp = bpy.data.lights.new('spot', 'SPOT'); sp.energy = 9000; sp.spot_size = math.radians(30); sp.spot_blend = 0.4; sp.color = (1.0, 0.85, 0.65)
so = bpy.data.objects.new('spot', sp); sc.collection.objects.link(so); so.location = (-5, -9, 9)
so.rotation_euler = (head - Vector(so.location)).to_track_quat('-Z', 'Y').to_euler()
rig.area('wash', (-4, -10, 5), 6.0, 1500, rgb=(1.0, 0.7, 0.45), look_at=(0, 2, 0), glossy=False)
rig.area('rim', (7, 6, 5), 4.0, 3500, rgb=(1.0, 0.5, 0.15), look_at=tuple(head), glossy=False)
rig.world((0.12, 0.04, 0.015), 0.6)
rig.camera(60, elev=9, target=(0, 0, 0.3))
rig.render(OUT)
