"""Pop Steal card art: a gloved hand snatching a lit APPLAUSE sign off its hook, which is the crowd's cheer taken from the
people it was meant for. (The card springs on the first Sweet common cast on its post and catches it.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('POP_SEED', '7')))
sc = rig.reset()
rig.backdrop(22, [(0.0, '#12020a'), (0.45, '#4a0c2a'), (0.78, '#c8205e'), (1.0, '#1c0410')]).scale = (80, 50, 1)
for i in range(40):                      # the crowd's flashbulbs, far behind the wall's top edge
    hx = rnd.choice(['#ffffff', '#ffd0e2', '#ff7fae', '#fff1c0'])
    rig.ball((rnd.uniform(-18, 18), rnd.uniform(17, 21), rnd.uniform(-4, 8)), rnd.uniform(0.15, 0.5), rig.glow('flash', rig.hexrgb(hx), rnd.uniform(0.6, 2.5), alpha=0.5), 'flash', 16)

# ---- the wall the sign hung on ---------------------------------------------------------------------
wall = rig.plastic('wall', rig.hexrgb('#5a1a38'), rough=0.7)
rig.box('wall', 30, 0.4, 24, wall, (0, 0.6, -9.0), bevel=0.05)
for z in (-1.6, -4.0):                   # a wainscot rail and a skirting board, so the wall has some scale
    rig.box('rail', 30, 0.5, 0.18, rig.plastic('rail', rig.hexrgb('#5a1636'), rough=0.5), (0, 0.4, z), bevel=0.04)

# ---- the hook, and the sign hanging off it ---------------------------------------------------------
steel = rig.plastic('steel', rig.hexrgb('#d8d8e0'), rough=0.25, metallic=1.0)
H = Vector((-1.35, 0.0, 3.05))           # where the ring is still caught
rig.cone((H.x, 0.45, H.z + 0.05), (H.x, 0.1, H.z + 0.05), 0.34, 0.34, steel, 40)                        # the plate it is screwed to
rig.tube('hook', [(H.x, 0.1, H.z + 0.1), (H.x, -0.15, H.z + 0.1), (H.x, -0.32, H.z + 0.02), (H.x, -0.3, H.z - 0.2), (H.x, -0.12, H.z - 0.3)], 0.055, steel, res=6)

SW, SH = 3.5, 1.2                       # the sign
ANG = 21.0                               # how far it has been swung off true, right side down
def at(x, z, y=0.0):
    """A point in the sign's own frame (its eyelet at the origin, x along it, z up) as it stands in the world."""
    a = math.radians(ANG)
    return (H.x + x * math.cos(a) + z * math.sin(a), y, H.z - x * math.sin(a) + z * math.cos(a))

casing = rig.plastic('casing', rig.hexrgb('#ff3d7f'), rough=0.3, coat=0.8)
black = rig.plastic('face', rig.hexrgb('#1a0510'), rough=0.5)
lamp = rig.glow('lamp', rig.hexrgb('#fff4d0'), 7.0)
letters = rig.glow('letters', rig.hexrgb('#fff8e8'), 6.0)
parts = []
parts.append(rig.slab('rim', rig.rrect(SW, SH, 0.22, 6), -0.16, 0.16, casing, 0.06))            # the pink frame
parts.append(rig.slab('face', rig.rrect(SW - 0.28, SH - 0.28, 0.16, 6), -0.19, 0.12, black, 0.03))
parts.append(rig.text('APPLAUSE', 0.5, letters, (-0.12, -0.23, 0.0), depth=0.03, bevel=0.01))
for k in range(18):                      # a marquee of lit bulbs round the frame
    t = k / 18.0
    for sx, sz in ((-SW / 2 + 0.14 + t * (SW - 0.28), SH / 2 - 0.07), (-SW / 2 + 0.14 + t * (SW - 0.28), -SH / 2 + 0.07)):
        parts.append(rig.ball((sx, -0.2, sz), 0.07, lamp, 'bulb', 12))
for sz in (-0.3, 0.3):
    for sx in (-SW / 2 + 0.07, SW / 2 - 0.07):
        parts.append(rig.ball((sx, -0.2, sz), 0.07, lamp, 'bulb', 12))
sign = rig.group(parts, loc=at(SW / 2 - 0.35, -SH / 2), rot=(0, ANG, 0))   # built about the sign's middle, set where the eyelet's turn puts it
rig.cone((H.x, -0.18, H.z - 0.12), (H.x, 0.2, H.z - 0.12), 0.2, 0.2, steel, 24)                    # the eyelet, still on the hook

halo = rig.glow('halo', rig.hexrgb('#ff5f95'), 0.9, alpha=0.1)
for k, f in enumerate((1.0, 0.8, 0.6)):                              # three soft rings, so the light has no edge
    rig.ball(at(SW / 2 - 0.35, -SH / 2, 0.25), 2.6, halo, 'halo', 32, scale=(f, 0.05, f * 0.55))      # the sign's light on the wall behind it

# ---- the cord, pulled out of the wall as the sign goes -----------------------------------------------
def smooth(pts, passes=3):
    """Round an open path's corners, keeping its ends."""
    pts = [Vector(p) for p in pts]
    for _ in range(passes):
        out = [pts[0]]
        for a, c in zip(pts, pts[1:]): out += [a * 0.75 + c * 0.25, a * 0.25 + c * 0.75]
        pts = out + [pts[-1]]
    return [tuple(p) for p in pts]
cable = rig.plastic('cable', rig.hexrgb('#14030a'), rough=0.4)
c0 = Vector(at(0.4, -SH - 0.05, -0.1))
rig.tube('cord', smooth([tuple(c0), (c0.x + 0.1, -0.25, c0.z - 0.5), (c0.x + 0.5, -0.4, c0.z - 0.9), (c0.x + 0.25, -0.3, c0.z - 1.4), (c0.x + 0.6, -0.2, c0.z - 1.9)]), 0.06, cable, res=6)
rig.box('plug', 0.34, 0.2, 0.5, rig.plastic('plug', rig.hexrgb('#f0e8ec'), rough=0.4), (c0.x + 0.6, -0.2, c0.z - 2.4), bevel=0.03)
spark = rig.glow('spark', rig.hexrgb('#ffe9a0'), 8.0)
for dx, dz, r, turn in ((-0.1, -0.1, 0.34, 0.1), (-0.55, 0.15, 0.2, 0.5), (0.35, -0.25, 0.18, -0.3)):   # sparks where the plug left the socket
    o = rig.slab('spark', rig.star(4, r, r * 0.28, turn), -0.02, 0.02, spark, 0.0); o.location = (c0.x + 0.6 + dx, -0.5, c0.z - 2.1 + dz)

# ---- the hand: a black glove, a fist round the sign's lower right edge ---------------------------
glove = rig.plastic('glove', rig.hexrgb('#1f1018'), rough=0.3, coat=0.9)
seam = rig.plastic('seam', rig.hexrgb('#ff3d7f'), rough=0.4)
cuff = rig.plastic('cuff', rig.hexrgb('#f6e8ee'), rough=0.6)
G = Vector(at(SW - 0.35 - 0.05, -0.62, -0.32))       # the grip: the sign's right edge, just below its middle
fingers = []
for k, dz in enumerate((0.42, 0.14, -0.14, -0.42)):                  # four fingers curled across the sign's face, knuckles on the right
    kn = Vector((G.x + 0.3, -0.62, G.z + dz))
    tip = Vector((G.x - 0.25, -0.34, G.z + dz - 0.02 * (k - 1.5)))
    mid2 = Vector((G.x - 0.05, -0.55, G.z + dz + 0.04))
    rig.tube('finger', [tuple(kn), tuple(mid2), tuple(tip)], 0.16, glove, res=6)
    rig.ball(tuple(kn), 0.2, glove, 'knuckle', 20)
    rig.ball(tuple(tip), 0.165, glove, 'tip', 16)
    rig.ball(tuple(kn + Vector((-0.02, -0.14, 0.0))), 0.07, seam, 'stud', 12)          # a pink stud on each knuckle
rig.tube('thumb', [(G.x + 0.45, -0.5, G.z + 0.72), (G.x + 0.0, -0.78, G.z + 0.78), (G.x - 0.4, -0.55, G.z + 0.56)], 0.17, glove, res=6)
rig.ball((G.x + 0.62, -0.6, G.z), 0.78, glove, 'palm', 40, scale=(0.85, 0.7, 1.15))
W0 = Vector((G.x + 1.0, -0.6, G.z - 0.2))
W1 = W0 + Vector((1.5, -0.2, -2.6))
rig.cone(tuple(W0), tuple(W1), 0.5, 0.62, glove, 40)
rig.cone(tuple(W0 + (W1 - W0) * 0.34), tuple(W0 + (W1 - W0) * 0.5), 0.58, 0.6, cuff, 40)       # a bandage cuff
rig.cone(tuple(W0 + (W1 - W0) * 0.5), tuple(W0 + (W1 - W0) * 0.56), 0.6, 0.6, seam, 40)

# ---- a swing's worth of streaks, and the sign's own light on everything round it ------------------
streak = rig.glow('streak', rig.hexrgb('#ffd0e2'), 3.0, alpha=0.55)
for r, a0, a1, w in ((3.3, 12, 40, 0.05), (3.7, 15, 46, 0.035), (4.1, 18, 50, 0.025)):
    pts = []
    for j in range(13):
        a = math.radians(a0 + (a1 - a0) * j / 12.0)
        pts.append((H.x + r * math.sin(a), 0.5, H.z - r * math.cos(a)))
    rig.tube('streak', pts, w, streak, res=4)
star_glow = rig.glow('star', rig.hexrgb('#fff1a0'), 3.0)
for x, z, r, turn in ((-2.3, 2.6, 0.3, 0.2), (2.3, 0.3, 0.24, -0.3), (-2.4, 0.4, 0.18, 0.1)):
    o = rig.slab('star', rig.star(4, r, r * 0.3, turn), -0.02, 0.02, star_glow, 0.0); o.location = (x, -0.5, z)

LOOK = (0, 0, 1.4)
rig.area('key', (-5, -9, 7), 4.0, 1500, look_at=LOOK)
rig.area('sign', (0, -3.5, 2.0), 3.0, 600, rgb=(1.0, 0.62, 0.8), look_at=LOOK, glossy=False)         # the sign's own pink on the glove
rig.area('rim', (5, 6, 6), 4.0, 2400, rgb=(1.0, 0.55, 0.75), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 380, rgb=(1.0, 0.85, 0.92), look_at=LOOK)
rig.world((0.1, 0.02, 0.05), 0.7)
rig.camera(50)
rig.render(OUT)
