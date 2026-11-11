"""Main Event card art exploration, after the placeholder art.svg: a title belt under the house lights."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(18, [(0.0, '#03141a'), (0.5, '#0a3d4c'), (1.0, '#010608')])
G = -2.3
rig.floor(G, rig.checker('canvas', '#08323d', '#0d4a5a', 34, rough=0.1))
C = Vector((0, 0, 0.75))                 # the belt's plate

gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.1, metallic=1.0)
chrome = rig.plastic('chrome', (0.9, 0.97, 1.0), rough=0.05, metallic=1.0)
enamel = rig.plastic('enamel', rig.hexrgb('#0a9cc0'), rough=0.08, coat=1.0)
strap = rig.plastic('strap', rig.hexrgb('#06222b'), rough=0.45)
gem = rig.plastic('gem', rig.hexrgb('#ff3d7f'), rough=0.02, coat=1.0, emit=0.5)

# ---- the strap: a band bowed around toward the camera's sides, the plate at its middle ----------
def bow(x):                                                       # how far back the strap sits at x
    return 0.085 * x * x
N = 60
import bmesh
bm = bmesh.new(); rows = []
for k in range(N + 1):
    x = -4.2 + 8.4 * k / N; hh = 0.78 - 0.02 * abs(x)
    rows.append((bm.verts.new((x, bow(x), -hh)), bm.verts.new((x, bow(x), hh))))
for a, b in zip(rows, rows[1:]): bm.faces.new((a[0], b[0], b[1], a[1]))
me = bpy.data.meshes.new('strap'); bm.to_mesh(me); bm.free()
so = bpy.data.objects.new('strap', me); sc.collection.objects.link(so); me.materials.append(strap)
sd = so.modifiers.new('thick', 'SOLIDIFY'); sd.thickness = 0.12
belt = [so]
for sgn in (-1, 1):                                               # piping along both edges
    belt.append(rig.tube('piping', [(-4.2 + 8.4 * k / N, bow(-4.2 + 8.4 * k / N) - 0.08, sgn * (0.7 - 0.02 * abs(-4.2 + 8.4 * k / N))) for k in range(N + 1)], 0.035, gold, res=4))
for sx in (-1, 1):                                                # side plates, turned with the strap
    for i, r in ((1, 0.5), (2, 0.36)):
        x = sx * (1.55 + 0.95 * (i - 1) + (0.35 if i == 2 else 0)); y = bow(x) - 0.12
        ang = math.atan(0.17 * x)
        p = [rig.cone((0, 0, 0), (0, -0.07, 0), r, r * 0.92, gold, 48), rig.cone((0, -0.07, 0), (0, -0.1, 0), r * 0.7, r * 0.66, enamel, 48),
             rig.slab('star', rig.star(5, r * 0.5, r * 0.21), -0.14, -0.09, gold, 0.008)]
        belt.append(rig.group(p, loc=(x, y, 0), rot=(0, 0, -math.degrees(ang))))
# the main plate: gold oval, a cyan field, a chrome star, gems around it
plate = [rig.cone((0, 0, 0), (0, -0.12, 0), 1.0, 0.95, gold, 96), rig.cone((0, -0.12, 0), (0, -0.17, 0), 0.82, 0.78, enamel, 96),
         rig.tube('bead', [(math.cos(a) * 0.9, -0.13, math.sin(a) * 0.9) for a in (math.tau * j / 96 for j in range(97))], 0.045, chrome, res=5),
         rig.slab('star', rig.star(5, 0.56, 0.235), -0.27, -0.16, gold, 0.02)]
for j in range(12):
    a = math.tau * j / 12
    plate.append(rig.ball((math.cos(a) * 0.9, -0.15, math.sin(a) * 0.9), 0.06, gem, 'gem', 16))
pl = rig.group(plate, loc=(0, -0.1, 0)); pl.scale = (1.5, 1.0, 1.12); belt.append(pl)
rig.group(belt, loc=C, rot=(-10, 0, -4), scale=1.12)

# ---- the marquee over it: a sign with bulbs, hung on two wires ----------------------------------
sign = [rig.slab('sign', rig.rrect(3.3, 0.95, 0.12), -0.08, 0.08, rig.plastic('sign', rig.hexrgb('#06222b'), rough=0.3), 0.03),
        rig.text('MAIN EVENT', 0.42, rig.plastic('letters', rig.hexrgb('#e6fdff'), rough=0.1, emit=1.6), (0, -0.09, 0), depth=0.03, bevel=0.006)]
bulb = rig.glow('bulb', rig.hexrgb('#fff3b0'), 5.0)
for j in range(11):
    for z in (-0.4, 0.4): sign.append(rig.ball((-1.5 + 0.3 * j, -0.1, z), 0.05, bulb, 'bulb', 12))
rig.group(sign, loc=(0, 0.6, 3.25), rot=(8, 0, 3))
for x in (-1.2, 1.3): rig.tube('wire', [(x, 0.6, 3.7), (x * 1.1, 0.6, 7)], 0.012, chrome, res=2)

# ---- the house lights: one beam down the middle, two crossing behind ----------------------------
beam = rig.glow('beam', rig.hexrgb('#b8f8ff'), 0.7, alpha=0.02)
rig.cone((0, 1.0, 9), (0, 1.0, G), 0.3, 2.6, beam, 64)
for sx in (-1, 1): rig.cone((sx * 6, 9, 9), (-sx * 2.5, 9, G), 0.3, 1.8, beam, 48)
sp = bpy.data.lights.new('spot', 'SPOT'); sp.energy = 3500; sp.spot_size = math.radians(34); sp.color = (0.8, 0.97, 1.0)
so2 = bpy.data.objects.new('spot', sp); sc.collection.objects.link(so2); so2.location = (0, -1.5, 9.5); so2.rotation_euler = (math.radians(-9), 0, 0)
glint = rig.glow('glint', (1, 1, 1), 4.0)
for x, z, s in ((-1.75, 1.75, 0.2), (1.95, 0.2, 0.15), (-2.2, -0.3, 0.12), (1.4, 1.9, 0.11), (2.3, 2.3, 0.08), (-2.3, 2.6, 0.09)):
    o = rig.slab('glint', rig.star(4, s, s * 0.22), -0.02, 0.02, glint, 0.005); o.location = (x, -1.2, z)
rig.area('key', (-6, -9, 6), 4.0, 1800, look_at=tuple(C))
rig.area('window', (3, -8, 4), 1.2, 900, look_at=tuple(C), size_y=5.0)
rig.area('soft-left', (-8, -6, 0.5), 8.0, 1600, rgb=(1.0, 0.9, 0.7), look_at=tuple(C))
rig.area('soft-right', (8, -6, 2), 8.0, 1200, rgb=(1.0, 0.95, 0.85), look_at=tuple(C))
rig.area('rim', (5, 6, 4), 4.0, 2200, rgb=(0.3, 0.9, 1.0), look_at=tuple(C), glossy=False)
rig.world((0.02, 0.1, 0.13), 0.7)
rig.camera(60, elev=7)
rig.render(OUT)
