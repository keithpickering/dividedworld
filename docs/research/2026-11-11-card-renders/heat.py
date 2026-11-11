"""Heat Magnet card art exploration (the owner's idea): a big horseshoe magnet, on fire, in the dark."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('HEAT_SEED', '6')))
sc = rig.reset()
rig.backdrop(16, [(0.0, '#0a0206'), (0.4, '#2a0612'), (1.0, '#050103')])
G = -3.3
rig.floor(G, rig.checker('floor', '#12040a', '#240814', 30, rough=0.08))
C = Vector((0, 0, 0.6))

# ---- the magnet: a red horseshoe, poles up, steel at its tips -----------------------------------
red = rig.plastic('magnet', rig.hexrgb('#e8102a'), rough=0.1, coat=1.0)
steel = rig.plastic('pole', (0.82, 0.84, 0.9), rough=0.12, coat=1.0)
RB, TH, LEG = 1.05, 0.44, 1.5            # the bend's radius, the bar's half thickness, a leg's length
def shoe(r_in, r_out):
    out = [(-r_out, LEG * 0.55), (-r_out, 0)]
    out += [(math.cos(a) * r_out, math.sin(a) * r_out) for a in (math.pi + math.pi * j / 40 for j in range(1, 40))]
    out += [(r_out, 0), (r_out, LEG * 0.55), (r_in, LEG * 0.55), (r_in, 0)]
    out += [(math.cos(a) * r_in, math.sin(a) * r_in) for a in (math.tau - math.pi * j / 40 for j in range(1, 40))]
    out += [(-r_in, 0), (-r_in, LEG * 0.55)]
    return out
mag = [rig.slab('shoe', shoe(RB - TH, RB + TH), -0.42, 0.42, red, 0.06)]
for sx in (-1, 1):
    o = rig.slab('pole', rig.rrect(TH * 2, LEG * 0.5, 0.02), -0.42, 0.42, steel, 0.06); o.location = (sx * RB, 0, LEG * 0.8)
    mag.append(o)
tilt = (-10, -24, 14)
rig.group(mag, loc=C + Vector((0, 0, -0.3)), rot=tilt, scale=1.25)

# ---- the fire: tongues of it, each three skins deep, hottest inside ------------------------------
SKINS = [(rig.glow('fire-out', rig.hexrgb('#ff2a4a'), 2.2), 1.0), (rig.glow('fire-mid', rig.hexrgb('#ff8a1c'), 3.0), 0.68), (rig.glow('fire-in', rig.hexrgb('#fff27a'), 4.5), 0.38)]
def tongue(base, height, radius, sway, phase, depth=0.0):
    """A flame: a flat teardrop on a wavering spine, drawn three times over, each smaller, hotter and nearer."""
    for i, (mat, k) in enumerate(SKINS):
        bm = bmesh.new(); rings = []; n = 28
        for j in range(n + 1):
            t = j / n
            r = radius * k * (math.sin(math.pi * min(1, t * 1.9 + 0.12)) ** 0.9 if t < 0.46 else (1 - t) ** 0.75 * 1.52)
            c = Vector(base) + Vector((math.sin(t * 4 + phase) * sway * t, depth - 0.22 * i, height * t * (1 - 0.14 * i)))
            rings.append([bm.verts.new(c + Vector((math.cos(a) * r, math.sin(a) * r * 0.16, 0))) for a in (math.tau * q / 20 for q in range(20))])
        for a, b in zip(rings, rings[1:]):
            for q in range(20): bm.faces.new((a[q], a[(q + 1) % 20], b[(q + 1) % 20], b[q]))
        me = bpy.data.meshes.new('tongue'); bm.to_mesh(me); bm.free()
        for f in me.polygons: f.use_smooth = True
        o = bpy.data.objects.new('tongue', me); sc.collection.objects.link(o); me.materials.append(mat)
for x, y, z, h, r in ((-1.9, 1.2, -1.6, 4.6, 0.8), (-0.7, 1.4, -1.8, 6.0, 1.0), (0.6, 1.4, -1.9, 5.4, 0.95), (1.8, 1.2, -1.5, 4.2, 0.75),
                      (-2.6, 1.0, -1.9, 2.6, 0.55), (2.6, 1.0, -2.0, 2.8, 0.55), (0.0, 1.6, -1.2, 6.6, 0.8)):
    tongue((x, y, z), h, r, rnd.uniform(0.25, 0.5), rnd.uniform(0, 6))
for x, z, h, r in ((-1.5, -2.5, 1.5, 0.4), (-0.3, -2.7, 1.9, 0.5), (1.0, -2.6, 1.6, 0.42), (2.0, -2.5, 1.1, 0.3), (-2.3, -2.6, 1.0, 0.3)):   # licking up in front
    tongue((x, -0.9, z), h, r, rnd.uniform(0.15, 0.3), rnd.uniform(0, 6))
ember = rig.glow('ember', rig.hexrgb('#ffb04a'), 8.0)
for i in range(40):
    rig.ball((rnd.uniform(-2.6, 2.6), rnd.uniform(-1, 2), rnd.uniform(-1, 4.1)), rnd.uniform(0.015, 0.045), ember, 'ember', 8)
# the pull: arcs of it leaping from pole to pole
arc = rig.glow('arc', rig.hexrgb('#ff7ab0'), 5.0)
from mathutils import Euler
M = Euler(tuple(math.radians(a) for a in tilt), 'XYZ').to_matrix()
tip = lambda sx: C + Vector((0, 0, -0.3)) + M @ (Vector((sx * RB, -0.1, LEG * 1.05)) * 1.25)
for k in range(3):
    a, b = tip(-1), tip(1); up = (M @ Vector((0, 0, 1))) * (0.5 + 0.45 * k)
    rig.tube('arc', [a + (b - a) * t + up * math.sin(math.pi * t) for t in (j / 30 for j in range(31))], 0.022, arc, res=3)

fl = bpy.data.lights.new('fire', 'POINT'); fl.energy = 4000; fl.color = (1.0, 0.45, 0.15); fl.shadow_soft_size = 1.5
fo = bpy.data.objects.new('fire', fl); sc.collection.objects.link(fo); fo.location = (0, 1.8, 1.0)
fl2 = bpy.data.lights.new('fire-front', 'POINT'); fl2.energy = 900; fl2.color = (1.0, 0.5, 0.2); fl2.shadow_soft_size = 1.0
fo2 = bpy.data.objects.new('fire-front', fl2); sc.collection.objects.link(fo2); fo2.location = (0, -2.2, -2.2)
rig.area('key', (-6, -9, 6), 4.0, 1700, look_at=tuple(C))
rig.area('window', (4, -8, 3), 1.2, 800, look_at=tuple(C), size_y=6.0)
rig.world((0.06, 0.01, 0.03), 0.6)
rig.camera(60, elev=4)
rig.render(OUT)
