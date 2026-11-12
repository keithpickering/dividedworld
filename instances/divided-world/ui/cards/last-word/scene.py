"""Last Word card art: a big glossy speech bubble zipped shut, a padlock hanging from the zip, and on
the floor in front of it a pair of fat quotation marks, toppled and cracked. (Nobody can quote the post for a week.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('LAST_WORD_SEED', '8')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#16030c'), (0.5, '#7a1040'), (1.0, '#2a0618')])
G = -1.75
rig.floor(G, rig.checker('floor', '#3a0a20', '#8a1848', 30, rough=0.14))

# ---- the bubble: a fat rounded slab with a tail, zipped across its middle --------------------------
skin = rig.plastic('bubble', rig.hexrgb('#ff3d7f'), rough=0.06, coat=1.0, emit=0.1)
chrome = rig.plastic('chrome', (1.0, 0.9, 0.95), rough=0.06, metallic=1.0)
tape = rig.plastic('tape', rig.hexrgb('#4a0822'), rough=0.35)
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.1, metallic=1.0, emit=0.12)
BW, BH = 4.3, 3.0
out = rig.rrect(BW, BH, 1.0, 10)
k = 3 * 11                                                       # after the bottom-left corner: the tail
out[k:k] = [(-1.0, -BH / 2), (-1.75, -BH / 2 - 0.95), (-0.1, -BH / 2)]
body = rig.slab('bubble', out, -0.65, 0.65, skin, 0.4); body.modifiers['bevel'].segments = 10
bub = [body]
F = -0.66                                                        # the bubble's front
bub.append(rig.slab('tape', rig.rrect(3.9, 0.6, 0.1), F - 0.03, F + 0.03, tape, 0.01))
x = -1.8; j = 0
while x < 1.35:                                                  # the teeth, meshed
    bub.append(rig.slab('tooth', rig.rrect(0.13, 0.26, 0.04), F - 0.11, F - 0.02, chrome, 0.02)); bub[-1].location = (x, 0, 0.06 if j % 2 else -0.06)
    x += 0.165; j += 1
SL = Vector((1.6, F - 0.08, 0))                                  # the slider, run all the way shut
bub.append(rig.slab('slider', [(-0.26, 0.17), (0.12, 0.3), (0.26, 0.3), (0.26, -0.3), (0.12, -0.3), (-0.26, -0.17)], -0.08, 0.08, chrome, 0.03)); bub[-1].location = SL
bub.append(rig.slab('pull', rig.rrect(0.24, 0.62, 0.1), -0.03, 0.03, chrome, 0.012)); bub[-1].location = SL + Vector((0.02, -0.1, -0.36))
bub.append(rig.ball(SL + Vector((0.02, -0.1, -0.05)), 0.08, chrome, 'rivet', 16))
L = SL + Vector((0.02, -0.14, -1.42))                            # the padlock, hanging from the pull
bub.append(rig.slab('lock', rig.rrect(1.0, 0.82, 0.16), -0.2, 0.2, gold, 0.07)); bub[-1].location = L
bub.append(rig.tube('shackle', [L + Vector((-0.27, 0, 0.35))] + [L + Vector((-math.cos(a) * 0.27, 0, 0.62 + math.sin(a) * 0.27)) for a in (math.pi * i / 12 for i in range(13))] + [L + Vector((0.27, 0, 0.35))], 0.085, chrome, res=6))
dark = rig.plastic('keyhole', (0.03, 0.01, 0.02), rough=0.4)
bub.append(rig.cone(L + Vector((0, -0.22, 0.06)), L + Vector((0, -0.2, 0.06)), 0.11, 0.11, dark, 20))
bub.append(rig.slab('keyslot', rig.rrect(0.08, 0.26, 0.03), -0.225, -0.2, dark, 0.005)); bub[-1].location = L + Vector((0, 0, -0.1))
shine = rig.plastic('shine', (1, 1, 1), rough=0.05, emit=1.0)
bub.append(rig.tube('shine', [(-1.75, F + 0.12, 0.7), (-1.7, F + 0.06, 1.0), (-1.4, F + 0.03, 1.2), (-0.9, F + 0.02, 1.25)], 0.055, shine, res=5))
P = Vector((-0.1, 0.4, 2.2))
rig.group(bub, loc=P, rot=(-4, 3, 8), scale=0.9)

# ---- the quotation marks: fat, toppled on the floor in front, cracked ------------------------------
qm = rig.plastic('quote', rig.hexrgb('#fff0f6'), rough=0.08, coat=1.0)
crack = rig.plastic('crack', rig.hexrgb('#3a0a20'), rough=0.5)
def bez(a, c, b, n=8):
    return [((1 - t) ** 2 * a[0] + 2 * t * (1 - t) * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * t * (1 - t) * c[1] + t * t * b[1]) for t in (i / n for i in range(1, n + 1))]
def mark(cracked):
    """One opening mark, a 6: a ball with a thin tail curling up and to the right. About 1.4 wide and 1.9 tall, y from -0.2 to 0.2."""
    pts = [(math.cos(a) * 0.5, math.sin(a) * 0.5) for a in (math.radians(70 + 300 * i / 24) for i in range(25))]
    pts += bez(pts[-1], (0.62, 0.75), (0.88, 1.4)) + bez((0.88, 1.4), (0.36, 0.95), pts[0])[:-1]
    parts = [rig.slab('mark', pts, -0.2, 0.2, qm, 0.07)]
    if cracked:
        z = [(-0.42, 0.3), (-0.2, 0.12), (-0.26, -0.05), (0.0, -0.12), (-0.05, -0.3), (0.2, -0.46)]
        parts.append(rig.tube('crack', [(x, -0.2, y) for x, y in z], 0.028, crack, res=2))
        parts.append(rig.tube('crack', [(-0.26, -0.2, -0.05), (-0.4, -0.2, -0.16)], 0.02, crack, res=2))
        parts.append(rig.tube('crack', [(0.0, -0.2, -0.12), (0.22, -0.2, 0.0), (0.3, -0.2, 0.22)], 0.02, crack, res=2))
    return parts
def pair(loc, rot, flip, cracked):
    """Two marks side by side: an opening pair, or (flipped) a closing pair, laid down by `rot`."""
    parts = []
    for i, dx in enumerate((-0.62, 0.62)):
        g = rig.group(mark(cracked[i]), loc=(dx, 0, -0.3 if not flip else 0.3), rot=(0, 180 if flip else 0, 0)); parts.append(g)
    return rig.group(parts, loc=loc, rot=rot, scale=0.95)
pair((-1.25, -1.5, G + 0.75), (-26, 12, 16), False, (True, False))
pair((1.2, -1.8, G + 0.6), (-28, -6, -14), True, (False, True))
for i in range(9):                                               # chips knocked off them
    p = (rnd.uniform(-2.2, 2.2), rnd.uniform(-2.6, -1.0), G + 0.05)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rnd.uniform(0.05, 0.11), location=p); bpy.context.object.data.materials.append(qm)

rig.area('key', (-6, -9, 7), 4.0, 1900, look_at=tuple(P))
rig.area('window', (4, -8, 3), 1.2, 700, look_at=tuple(P), size_y=6.0)
rig.area('rim', (5, 6, 5), 4.0, 2400, rgb=(1.0, 0.5, 0.8), look_at=tuple(P), glossy=False)
rig.area('front', (0, -7, 2), 5.0, 700, rgb=(1.0, 0.85, 0.9), look_at=(0, -2, G), glossy=False)
rig.world((0.14, 0.02, 0.07), 0.7)
rig.camera(60, elev=10, target=(0, 0, 0.2))
rig.render(OUT)
