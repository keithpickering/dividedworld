"""Super Happy Heart card art exploration: the Happy Heart, bigger and winged, hovering in a soft glow over the
warning thermometer, now drained to empty, with stars all round. (The card empties a character's warning meter.)
Second of the ladder of three; the heart and the thermometer are Happy Heart's."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('SUPER_HAPPY_HEART_SEED', '5')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#064a70'), (0.45, '#1fb6e0'), (1.0, '#0a4f8a')])
G = -2.7
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

# ---- the heart, winged, hovering in its glow -------------------------------------------------------
Hc = Vector((0.3, -0.3, 1.9))
feather = rig.plastic('feather', (1.0, 1.0, 1.0), rough=0.25, coat=1.0, emit=0.25)
h = heart()
for sx in (-1, 1):
    for ang, ln, back in ((62, 0.66, 0.0), (38, 0.62, 0.06), (14, 0.52, 0.12), (-10, 0.4, 0.18)):
        a = math.radians(ang); base = Vector((sx * 0.95, 0.3 + back, 0.2))
        o = rig.ball(base + Vector((sx * math.cos(a), 0, math.sin(a))) * ln * 0.8, ln, feather, 'feather', 32, scale=(1, 0.16, 0.27))
        o.rotation_euler = (0, -sx * a, 0); h.append(o)
rig.group(h, loc=Hc, rot=(-5, 0, 4), scale=1.15)
for r, al in ((3.4, 0.10), (2.6, 0.14), (1.9, 0.2)):              # the glow: soft discs behind it
    rig.cone(Hc + Vector((0, 2.0 + r * 0.1, 0)), Hc + Vector((0, 2.02 + r * 0.1, 0)), r, r, rig.glow('halo', (0.85, 1.0, 1.0), 1.2, alpha=al), 96)
hl = bpy.data.lights.new('halo', 'POINT'); hl.energy = 250; hl.color = (0.7, 1.0, 1.0); hl.shadow_soft_size = 1.0
ho = bpy.data.objects.new('halo', hl); sc.collection.objects.link(ho); ho.location = Hc + Vector((0, 1.2, -0.5))

# ---- the thermometer, empty, under it --------------------------------------------------------------
T = Vector((-1.7, -0.9, G))
parts, slots = thermometer(0)
rig.group(parts, loc=T, rot=(0, 0, 10), scale=0.95)

# ---- sparkles and stars ----------------------------------------------------------------------------
glint = rig.plastic('glint', (1, 1, 1), rough=0.1, emit=1.5)
gold = rig.plastic('star', rig.hexrgb('#ffd21c'), rough=0.1, coat=1.0, emit=0.5)
for x, z, s, y in ((-2.2, 3.5, 0.34, 1.5), (-0.6, 3.75, 0.2, 1.5), (1.2, 3.6, 0.26, 1.5), (2.35, 0.2, 0.3, 0.5), (-2.3, 0.3, 0.22, 1.0),
                   (-0.75, -0.2, 0.26, -1.4), (-2.2, -1.0, 0.2, -1.2), (1.6, -0.5, 0.2, 0.0), (0.6, -0.1, 0.14, -0.5)):
    o = rig.slab('spark', rig.star(4, s, s * 0.26, rnd.uniform(0, 0.5)), -0.03, 0.03, glint, 0.01); o.location = (x, y, z)
for x, z, s, y in ((-1.9, 2.75, 0.3, 0.8), (2.0, 2.6, 0.24, 0.8), (1.5, -1.3, 0.34, -0.6), (-0.3, -1.55, 0.2, -1.2), (2.2, -2.0, 0.22, -0.4)):
    o = rig.slab('star', rig.star(5, s, s * 0.45, rnd.uniform(-0.4, 0.4)), -0.07, 0.07, gold, 0.03); o.location = (x, y, z)
    o.rotation_euler = (0, 0, rnd.uniform(-0.4, 0.4))

rig.area('key', (-6, -9, 7), 4.0, 1800, look_at=(0, 0, 1.2))
rig.area('window', (4, -8, 3), 1.2, 800, look_at=tuple(Hc), size_y=6.0, glossy=False)
rig.area('rim', (5, 6, 5), 4.0, 1800, rgb=(0.4, 0.95, 1.0), look_at=tuple(Hc), glossy=False)
rig.area('soft', (-7, -5, -1), 8.0, 600, rgb=(0.7, 0.95, 1.0), look_at=(0, 0, 0))
rig.world((0.05, 0.3, 0.4), 0.8)
rig.camera(60, elev=6, target=(0, 0, 0.0))
rig.render(OUT)
