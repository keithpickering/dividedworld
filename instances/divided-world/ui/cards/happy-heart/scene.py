"""Happy Heart card art: a glossy smiling heart beside the warning thermometer, whose red fill is
high, with its top notch popping off as a bubble. (The card takes one notch off a character's warning meter.)
First of a ladder of three: Super Happy Heart and Ultra Happy Heart reuse this heart and this thermometer."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('HAPPY_HEART_SEED', '3')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#075a78'), (0.45, '#25c4e6'), (1.0, '#0a6a96')])
G = -2.5
rig.floor(G, rig.checker('floor', '#0a5a74', '#35d2ee', 30, rough=0.12))

# ---- the heart (shared by the three Happy Heart scenes) -------------------------------------------
def heart_point(X, Z, lift=0.0):
    """The point on the heart's front over (X, Z), in the heart's own units, lifted off it by `lift`."""
    x = X / 1.2; z = (Z + 0.3 - 0.75 * abs(x) ** 0.8) / 0.95
    return Vector((X, -0.62 * math.sqrt(max(0.0, 1 - x * x - z * z)) - lift, Z))

def heart():
    """A puffy heart about 2.4 wide and 2.2 tall, its face on the front: a sphere pinched into a cleft and a point."""
    red = rig.plastic('heart', rig.hexrgb('#ff1f4f'), rough=0.07, coat=1.0, emit=0.12)
    ink = rig.plastic('heart-ink', (0.02, 0.01, 0.03), rough=0.25, coat=1.0)
    white = rig.plastic('heart-glint', (1, 1, 1), rough=0.1, emit=0.8)
    blush = rig.plastic('heart-blush', rig.hexrgb('#ff8fb4'), rough=0.3, emit=0.2)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=96, ring_count=48)
    body = bpy.context.object; bpy.ops.object.shade_smooth(); body.data.materials.append(red)
    for v in body.data.vertices:
        x, y, z = v.co; v.co = (x * 1.2, y * 0.62, z * 0.95 + 0.75 * abs(x) ** 0.8 - 0.3)
    out = [body]
    for sx in (-1, 1):
        out.append(rig.ball(heart_point(sx * 0.4, 0.2, -0.02), 0.15, ink, 'eye', 24, scale=(0.85, 0.5, 1.3)))
        out.append(rig.ball(heart_point(sx * 0.4 - 0.05, 0.29, 0.06), 0.05, white, 'glint', 12))
        out.append(rig.ball(heart_point(sx * 0.72, -0.1, -0.03), 0.17, blush, 'blush', 20, scale=(1.1, 0.3, 0.7)))
    out.append(rig.tube('smile', [heart_point(t * 0.36, -0.28 + 0.16 * t * t, 0.0) for t in (j / 16 * 2 - 1 for j in range(17))], 0.05, ink, res=6))
    return out

# ---- the warning thermometer (shared too): `fill` of its five notches are red ---------------------
def thermometer(fill):
    """Foot at the origin, about 4.2 tall. Returns its parts and where each notch sits."""
    shell = rig.plastic('thermo', (0.93, 0.97, 1.0), rough=0.08, coat=1.0)
    dark = rig.plastic('thermo-dark', rig.hexrgb('#06323e'), rough=0.3)
    red = rig.plastic('thermo-red', rig.hexrgb('#ff1a2e'), rough=0.1, coat=1.0, emit=0.35)
    out = [rig.slab('body', rig.rrect(0.95, 3.6, 0.45), -0.25, 0.25, shell, 0.12),
           rig.ball((0, 0, 0.72), 0.74, shell, 'bulb', 48, scale=(1, 0.62, 1)),
           rig.ball((0, -0.22, 0.72), 0.5, red if fill else dark, 'bulb-fill', 32, scale=(1, 0.6, 1)),
           rig.slab('channel', rig.rrect(0.32, 3.0, 0.15), -0.3, -0.2, dark, 0.02)]
    out[0].location = (0, 0, 2.4); out[3].location = (0, 0, 2.5)
    slots = [(0, -0.31, 1.4 + 0.55 * k) for k in range(5)]
    if fill:
        out.append(rig.slab('stem', rig.rrect(0.22, 0.5, 0.06), -0.36, -0.26, red, 0.02)); out[-1].location = (0, 0, 1.0)
    for k, p in enumerate(slots):
        if k < fill:
            out.append(rig.slab('notch', rig.rrect(0.22, 0.47, 0.08), -0.05, 0.05, red, 0.03)); out[-1].location = p
        out.append(rig.slab('tick', rig.rrect(0.16, 0.05, 0.02), -0.28, -0.24, dark, 0.005)); out[-1].location = (0.34, 0, p[2] + 0.27)
    return out, slots

T = Vector((-1.5, 0.5, G)); TS = 1.22
parts, slots = thermometer(4)
rig.group(parts, loc=T, rot=(0, 0, 8), scale=TS)

# the fifth notch, popped off: a red bubble drifting up and away, smaller ones after it, a pop where it left
bubble = rig.plastic('bubble', rig.hexrgb('#ff1a2e'), rough=0.04, coat=1.0, emit=0.3)
top = T + Vector(slots[4]) * TS
for dx, dz, r in ((0.75, 0.55, 0.3), (0.38, 0.2, 0.14), (0.2, 0.02, 0.08), (1.2, 1.05, 0.11)):
    rig.ball(top + Vector((dx, -0.5, dz)), r, bubble, 'bubble', 32)
glint = rig.plastic('glint', (1, 1, 1), rough=0.1, emit=1.4)
for j in range(7):                                               # pop lines round the empty slot
    a = math.radians(-70 + 47 * j)
    if abs(math.degrees(a) - 90) > 150: continue
    d = Vector((math.cos(a), 0, math.sin(a)))
    rig.tube('pop', [top + Vector((0, -0.55, 0)) + d * 0.3, top + Vector((0, -0.55, 0)) + d * 0.5], 0.03, glint, res=3)

# ---- the heart, on a little stand, leaning toward the meter ---------------------------------------
Hc = Vector((0.85, -0.3, 0.95))
rig.group(heart(), loc=Hc, rot=(-4, -5, 8), scale=1.3)
chrome = rig.plastic('chrome', (0.8, 0.95, 1.0), rough=0.05, metallic=1.0)
stand = rig.plastic('stand', rig.hexrgb('#12b4d6'), rough=0.1, coat=1.0)
rig.lathe('stand', [(1.0, 0), (1.0, 0.12), (0.35, 0.3), (0.28, 1.25), (0.6, 1.5), (0.62, 1.6)], stand, (Hc.x, Hc.y + 0.1, G))
rig.lathe('stand-ring', [(1.06, 0), (1.06, 0.06), (1.0, 0.1)], chrome, (Hc.x, Hc.y + 0.1, G))

for i in range(7):                                               # a few sparkles in the air
    s = rnd.uniform(0.12, 0.28)
    o = rig.slab('spark', rig.star(4, s, s * 0.28, rnd.uniform(0, 0.6)), -0.03, 0.03, glint, 0.01)
    o.location = (rnd.uniform(-2.4, 2.4), 2.5, rnd.uniform(-0.6, 3.8))

rig.area('key', (-6, -9, 7), 4.0, 1700, look_at=(0, 0, 0.8))
rig.area('window', (4, -8, 3), 1.2, 800, look_at=tuple(Hc), size_y=6.0, glossy=False)
rig.area('rim', (5, 6, 5), 4.0, 1800, rgb=(0.4, 0.95, 1.0), look_at=tuple(Hc), glossy=False)
rig.area('soft', (-7, -5, -1), 8.0, 500, rgb=(0.7, 0.95, 1.0), look_at=(0, 0, 0))
rig.world((0.05, 0.3, 0.4), 0.8)
rig.camera(60, elev=6, target=(0, 0, -0.2))
rig.render(OUT)
