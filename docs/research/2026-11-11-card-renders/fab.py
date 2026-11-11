"""Feelin' Fab card art exploration, after Minus World's original icon: a grinning cloud with a rainbow
standing out of it, the sun under it, hills and daisies at the foot."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
# world: the card is the xz plane, 5.4 wide by 8.4 tall, centered on the origin; the camera looks along +y
C = Vector((0.0, 0.0, 0.95))             # the cloud's middle, in the focus zone
RX, RY, RZ = 1.75, 1.0, 1.0              # the cloud's face is the front of this ellipsoid

rig.backdrop(14, [(0.0, '#d6f3ff'), (0.45, '#8fd3f7'), (1.0, '#3d9be0')])

# ---- the rainbow: six glossy pipes standing out of the cloud, leaning as they climb --------------
BANDS = ['#ff2a2a', '#ff8a1c', '#ffe21c', '#2fd24a', '#2a7dff', '#9a3df0']
PIPE = 0.26
for i, hx in enumerate(BANDS):
    x0 = (i - 2.5) * PIPE * 1.9
    pts = []
    for k in range(41):
        t = k / 40; z = C.z + 0.3 + t * 6.4
        pts.append((x0 * (1 + 0.28 * t) - 0.75 * t * t - 0.05, 0.55 + 0.5 * t, z))   # fans a little, leans left
    rig.tube('band', pts, PIPE, rig.plastic(f'band{i}', rig.hexrgb(hx), rough=0.08, coat=1.0, emit=0.25), res=8)

# ---- the cloud: one broad body for the face, lumps around its rim --------------------------------
fluff = rig.plastic('cloud', (0.82, 0.86, 0.95), rough=0.5)
rig.ball(C, 1.0, fluff, 'cloud', 64, scale=(RX, RY, RZ))
LUMPS = [(-1.55, 0.45, 0.8), (-0.85, 0.85, 0.85), (0.05, 0.95, 0.9), (0.95, 0.8, 0.85), (1.6, 0.35, 0.8),
         (-1.95, -0.25, 0.7), (1.95, -0.3, 0.72), (-1.3, -0.7, 0.75), (-0.35, -0.85, 0.8), (0.65, -0.82, 0.8), (1.4, -0.7, 0.7)]
for x, z, r in LUMPS:
    rig.ball(C + Vector((x, 0.35, z)), r, fluff, 'lump', 40)

def face(x, z, lift=0.0):
    """The point on the cloud's front over (x, z), measured from its middle, lifted off it by `lift`."""
    k = max(0.0, 1 - (x / RX) ** 2 - (z / RZ) ** 2)
    return C + Vector((x, -RY * math.sqrt(k) - lift, z))

ink = rig.plastic('ink', (0.02, 0.025, 0.05), rough=0.6)
tooth = rig.plastic('tooth', (1.0, 1.0, 0.97), rough=0.1, coat=1.0)
for side in (-1, 1):                                             # eyes shut in a grin: two arcs, ends down
    rig.tube('eye', [face(side * 0.62 + math.cos(a) * 0.3, 0.3 + math.sin(a) * 0.2, 0.02) for a in (math.radians(20 + 140 * j / 16) for j in range(17))], 0.07, ink, res=6)
# the grin: a dark bed, curved up at the corners, and a row of teeth standing on it
smile = lambda t: (t * 0.95, -0.34 + 0.22 * t * t)                # t from -1 to 1
rig.tube('grin', [face(*smile(t), 0.0) for t in (j / 24 * 2 - 1 for j in range(25))], 0.26, ink, res=8)
TEETH = 7
for j in range(TEETH):
    t = (j + 0.5) / TEETH * 2 - 1
    x, z = smile(t * 0.9)
    p = face(x, z, 0.24)
    bpy.ops.mesh.primitive_cube_add(size=1, location=p)
    o = bpy.context.object; o.scale = (0.225, 0.12, 0.3); o.rotation_euler = (0, -math.atan(0.44 * t * 0.9), -x * 0.45)
    md = o.modifiers.new('bevel', 'BEVEL'); md.width = 0.035; md.segments = 3
    o.data.materials.append(tooth)

# ---- the sun under it, its rays, and the hills it rises behind -----------------------------------
sun = rig.plastic('sun', rig.hexrgb('#ffd21c'), rough=0.15, coat=1.0, emit=0.6)
S = Vector((0.15, 1.6, -3.1))
rig.ball(S, 0.6, sun, 'sun', 48)
for j in range(12):
    a = j / 12 * math.tau + 0.13
    d = Vector((math.cos(a), 0, math.sin(a)))
    bpy.ops.mesh.primitive_cone_add(radius1=0.09, depth=0.6, vertices=16, location=S + d * 1.15, rotation=(0, math.pi / 2 - a, 0))
    bpy.context.object.data.materials.append(sun); bpy.ops.object.shade_smooth()

hill_a = rig.plastic('hill', rig.hexrgb('#35c23a'), rough=0.35)
hill_b = rig.plastic('hill-far', rig.hexrgb('#1f9a3a'), rough=0.35)
HILLS = [((-2.6, 2.4, -8.3), 5.6, hill_b), ((3.2, 3.0, -8.9), 6.3, hill_b), ((0.6, 0.2, -9.6), 6.0, hill_a), ((-3.6, -0.4, -8.6), 4.6, hill_a)]
for loc, r, mat in HILLS:
    rig.ball(loc, r, mat, 'hill', 96)

petal = rig.plastic('petal', (1.0, 1.0, 1.0), rough=0.25)
heart = rig.plastic('heart', rig.hexrgb('#ffc21c'), rough=0.2, coat=1.0)
def on_hill(x, z):
    """The nearest hill's front at (x, z): where a daisy sits."""
    best = None
    for (cx, cy, cz), r, _ in HILLS:
        k = r * r - (x - cx) ** 2 - (z - cz) ** 2
        if k > 0 and (best is None or cy - math.sqrt(k) < best): best = cy - math.sqrt(k)
    return best
for x, z, s in ((-1.9, -3.45, 1.0), (1.55, -3.25, 1.15), (2.3, -3.85, 0.9), (-0.7, -3.85, 0.8), (0.55, -3.6, 0.7), (-2.4, -3.95, 0.75)):
    y = on_hill(x, z)
    if y is None: continue
    p = Vector((x, y - 0.12 * s, z))
    for j in range(8):
        a = j / 8 * math.tau
        rig.ball(p + Vector((math.cos(a), 0, math.sin(a))) * 0.2 * s, 0.11 * s, petal, 'petal', 16, scale=(1, 0.5, 1))
    rig.ball(p + Vector((0, -0.05 * s, 0)), 0.13 * s, heart, 'heart', 20)

# ---- sparkles in the sky: four-pointed stars ------------------------------------------------------
glint = rig.plastic('glint', (1.0, 1.0, 1.0), rough=0.1, emit=1.2)
for x, z, s, rot in ((-2.0, 3.55, 0.42, 0.0), (2.15, 2.9, 0.3, 0.3), (-2.25, 1.9, 0.2, 0.5), (2.2, 0.1, 0.24, 0.1), (-2.1, -1.1, 0.3, 0.2), (1.8, -1.6, 0.18, 0.4)):
    pts = [(math.cos(rot + j * math.pi / 4) * (s if j % 2 == 0 else s * 0.28), math.sin(rot + j * math.pi / 4) * (s if j % 2 == 0 else s * 0.28)) for j in range(8)]
    o = rig.slab('glint', pts, -0.05, 0.05, glint, 0.02); o.location = (x, 2.5, z)

# ---- light and camera -----------------------------------------------------------------------------
rig.area('key', (-6, -9, 8), 4.0, 1500, look_at=tuple(C))
rig.area('fill', (6, -7, -2), 7.0, 350, rgb=(0.8, 0.9, 1.0), look_at=tuple(C))
rig.area('ground', (0, -6, 1), 5.0, 450, rgb=(1.0, 1.0, 0.9), look_at=(0, 0, -4))
rig.world((0.35, 0.6, 1.0), 0.5)
rig.camera(60)
rig.render(OUT)
