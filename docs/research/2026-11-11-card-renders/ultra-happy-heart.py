"""Ultra Happy Heart card art exploration: the Happy Heart, crowned and radiant, bursting out through snapped
prison bars, a broken chain and an open padlock flung aside, gold rays fanning out behind it. (The legendary card
unbans a banned character.) Top of the ladder of three; the heart and the thermometer are Happy Heart's."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('ULTRA_HAPPY_HEART_SEED', '7')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#021c2c'), (0.5, '#0a6a8c'), (1.0, '#032a44')])
G = -2.9
rig.floor(G, rig.checker('floor', '#063a4c', '#16a8c8', 30, rough=0.1))
Hc = Vector((0.0, -1.0, 1.15))

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

# ---- gold rays fanning out behind the heart --------------------------------------------------------
N = 22
for j in range(N):
    a = math.tau * j / N + 0.07; w = math.tau / N * (0.3 if j % 2 else 0.2); L = 12
    pts = [(0, 0), (math.cos(a - w) * L, math.sin(a - w) * L), (math.cos(a + w) * L, math.sin(a + w) * L)]
    o = rig.slab('ray', pts, -0.01, 0.01, rig.glow('ray', rig.hexrgb('#ffb01c' if j % 2 else '#ffd84a'), 0.75 if j % 2 else 1.0), 0.0)
    o.location = (Hc.x, 6.0, Hc.z)
rig.cone((Hc.x, 5.9, Hc.z), (Hc.x, 5.95, Hc.z), 2.6, 2.6, rig.glow('sun', rig.hexrgb('#ffe89a'), 1.3), 96)

# ---- the bars: a cell front, its three middle bars snapped and bent out of the way -----------------
steel = rig.plastic('bar', rig.hexrgb('#9adfee'), rough=0.12, metallic=1.0)
BY, TOP, BOT = -0.6, 5.2, G
for x in (-2.55, -1.7, -0.85, 0.0, 0.85, 1.7, 2.55):
    if abs(x) > 1.0:
        rig.tube('bar', [(x, BY, BOT), (x, BY, TOP)], 0.13, steel, res=6); continue
    sx = (x > 0) - (x < 0); k = rnd.uniform(0.8, 1.2)
    up = [(x, BY, TOP)] + [(x + sx * 0.5 * k * t * t + (0.25 * t * t if sx == 0 else 0), BY - 1.1 * k * t * t, 3.9 - (0.75 if sx else 0.45) * t) for t in (j / 10 for j in range(11))]
    dn = [(x, BY, BOT)] + [(x + sx * 0.7 * k * t * t - (0.3 * t * t if sx == 0 else 0), BY - 1.5 * k * t * t, -2.2 + (1.0 if sx else 0.55) * t) for t in (j / 10 for j in range(11))]
    rig.tube('bar-up', up, 0.13, steel, res=6); rig.tube('bar-down', dn, 0.13, steel, res=6)
for z in (3.9, -2.2):
    rig.tube('rail', [(-4, BY + 0.1, z), (4, BY + 0.1, z)], 0.17, steel, res=6)

# ---- the heart, crowned ----------------------------------------------------------------------------
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.1, metallic=1.0, emit=0.15)
gem = rig.plastic('gem', rig.hexrgb('#18c8e8'), rough=0.03, coat=1.0, emit=0.5)
h = heart()
crown = [rig.lathe('band', [(0.5, 0), (0.54, 0.06), (0.54, 0.24), (0.5, 0.3)], gold)]
for j in range(8):
    a = math.tau * j / 8 + math.pi / 2; p = Vector((math.cos(a) * 0.5, math.sin(a) * 0.5, 0.26))
    crown.append(rig.cone(p, p + Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, 0.5)), 0.19, 0.03, gold, 16))
    crown.append(rig.ball(p + Vector((math.cos(a) * 0.13, math.sin(a) * 0.13, 0.54)), 0.075, gold, 'pearl', 16))
    crown.append(rig.ball((math.cos(a + 0.39) * 0.55, math.sin(a + 0.39) * 0.55, 0.15), 0.07, gem, 'gem', 12))
cr = rig.group(crown, loc=(-0.1, 0, 0.74), rot=(0, -10, 0), scale=0.8)
h.append(cr)
rig.group(h, loc=Hc, rot=(-6, 0, 0), scale=1.3)
hl = bpy.data.lights.new('halo', 'POINT'); hl.energy = 500; hl.color = (1.0, 0.85, 0.4); hl.shadow_soft_size = 1.0
ho = bpy.data.objects.new('halo', hl); sc.collection.objects.link(ho); ho.location = Hc + Vector((0, 2.2, 0.3))

# ---- the chain, broken, and its padlock, open -------------------------------------------------------
iron = rig.plastic('chain', rig.hexrgb('#c8f4ff'), rough=0.1, metallic=1.0)
def link(p, rot):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.05, location=p, rotation=rot)
    o = bpy.context.object; o.scale = (1.45, 1, 1); bpy.ops.object.shade_smooth(); o.data.materials.append(iron); return o
def chain(pts):
    for i, p in enumerate(pts):
        nxt = Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])
        q = nxt.to_track_quat('X', 'Z').to_euler(); link(p, (q.x + (math.pi / 2 if i % 2 else 0), q.y, q.z))
chain([(-2.5 + 0.36 * i, -1.9 - 0.05 * i, 3.4 - 0.33 * i - 0.05 * i * i) for i in range(4)])          # flung off, top left
chain([(2.45 - 0.3 * i, -1.9, -0.2 - 0.37 * i - 0.02 * i * i) for i in range(4)])                      # and hanging, right
chain([(-2.3 + 0.42 * i, -2.6 + 0.1 * math.sin(i), G + 0.07) for i in range(6)])                       # and on the floor
for i in range(3): link((rnd.uniform(-2.4, 2.4), -2.0, rnd.uniform(-0.6, 0.6)), tuple(rnd.uniform(0, 3) for _ in range(3)))
lock = [rig.slab('lock', rig.rrect(0.95, 0.8, 0.14), -0.2, 0.2, gold, 0.06),
        rig.tube('shackle', [(0.3, 0, 0.35)] + [(0.3 + 0.3 * (math.cos(a) - 1) , 0, 0.75 + 0.3 * math.sin(a)) for a in (math.pi * j / 12 for j in range(13))] + [(-0.3, 0, 0.6)], 0.075, iron, res=6),
        rig.cone((0, -0.22, 0.05), (0, -0.2, 0.05), 0.1, 0.1, rig.plastic('keyhole', (0.02, 0.02, 0.02), rough=0.4), 16)]
lock[1].rotation_euler = (0, 0, math.radians(40)); lock[1].location = (0.07, -0.2, 0.05)             # swung open on its long leg
rig.group(lock, loc=(1.45, -2.4, G + 0.75), rot=(14, 12, -16), scale=1.0)

# ---- the warning thermometer, empty, knocked flat ---------------------------------------------------
parts, slots = thermometer(0)
rig.group(parts, loc=(-0.2, -1.9, G + 0.28), rot=(-90, 0, 62), scale=0.5)

glint = rig.plastic('glint', (1, 1, 1), rough=0.1, emit=1.6)
for x, z, s in ((-1.9, 2.3, 0.3), (1.75, 2.95, 0.24), (-2.3, 0.6, 0.2), (2.2, 1.2, 0.3), (-1.2, 3.6, 0.18), (0.9, -0.55, 0.2), (-1.5, -0.8, 0.24)):
    o = rig.slab('spark', rig.star(4, s, s * 0.26, rnd.uniform(0, 0.5)), -0.03, 0.03, glint, 0.01); o.location = (x, -2.0, z)

rig.area('key', (-6, -9, 7), 4.0, 1900, look_at=tuple(Hc))
rig.area('window', (4, -8, 3), 1.2, 700, look_at=tuple(Hc), size_y=6.0, glossy=False)
rig.area('rim', (5, 5, 6), 4.0, 2600, rgb=(1.0, 0.8, 0.3), look_at=tuple(Hc), glossy=False)
rig.area('rim-l', (-5, 5, 2), 4.0, 1600, rgb=(0.3, 0.9, 1.0), look_at=tuple(Hc), glossy=False)
rig.area('soft', (0, -6, -2), 6.0, 500, rgb=(0.7, 0.95, 1.0), look_at=(0, 0, -2), glossy=False)
rig.world((0.04, 0.2, 0.3), 0.8)
rig.camera(60, elev=5, target=(0, 0, 0.0))
rig.render(OUT)
