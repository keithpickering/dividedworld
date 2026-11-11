"""Stick Around card art exploration, after Minus World's original icon: a pointer caught in a web, in a wood."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Euler
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('STICK_SEED', '4')))
sc = rig.reset()
col = sc.collection
# world: the card is the XZ plane, 5.4 wide by 8.4 tall, centered on the origin; the camera looks along +Y
C = Vector((0.1, 0, 1.25))               # the web's hub, in the focus zone

silk = rig.plastic('silk', (0.95, 0.97, 1.0), rough=0.25, emit=0.35)
dew = rig.plastic('dew', (0.9, 0.97, 1.0), rough=0.03, coat=1.0, emit=0.15)

tube, ball = rig.tube, rig.ball

# ---- the web: spokes past the frame, and threads between them that sag toward the hub -----------
N = 11
angles = sorted((i + rnd.uniform(-0.22, 0.22)) / N * math.tau + 0.2 for i in range(N))
def spoke(a, r, bow=0.0):
    return C + Vector((math.cos(a) * r, bow, math.sin(a) * r))
depth = [rnd.uniform(-0.12, 0.12) for _ in range(N)]         # each spoke leans a little out of the plane
for i, a in enumerate(angles):
    tube('spoke', [spoke(a, r, depth[i] * r / 4) for r in (0, 2, 4, 7.5)], 0.022, silk)
threads = []
radii = [0.42, 0.85, 1.35, 1.9, 2.5, 3.15, 3.85, 4.6, 5.4]
for k, r in enumerate(radii):
    for i in range(N):
        if r > 1.5 and rnd.random() < 0.07: continue          # a gap, as a real web has
        a0, a1 = angles[i], angles[(i + 1) % N] + (math.tau if i == N - 1 else 0)
        r0, r1 = r * rnd.uniform(0.96, 1.04), r * rnd.uniform(0.96, 1.04)
        p0 = spoke(a0, r0, depth[i] * r0 / 4); p1 = spoke(a1, r1, depth[(i + 1) % N] * r1 / 4)
        mid = spoke((a0 + a1) / 2, (r0 + r1) / 2 * 0.80)      # pulled in: the sag
        pts = [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * mid + t * t * p1 for t in (j / 14 for j in range(15))]
        tube('thread', pts, 0.016 if k else 0.02, silk); threads.append(pts)
ball(C, 0.06, silk, 'hub')
for pts in threads:                                            # dew, mostly small, strung on the threads
    if rnd.random() < 0.45:
        p = pts[rnd.randrange(2, 13)]
        ball(p + Vector((0, -0.01, -0.02)), rnd.choice([0.035, 0.045, 0.06, 0.085]), dew, 'dew', 16)

# ---- the pointer: the classic arrow, white with a black edge, as thick as a slab of plastic -----
ARROW = [(0, 0), (0, 16.5), (3.9, 12.9), (6.6, 19.2), (9.3, 18.0), (6.6, 11.9), (11.8, 11.9)]   # y down
k = 0.205
poly = [Vector((x * k, -y * k)) for x, y in ARROW]
cen = sum(poly, Vector((0, 0))) / len(poly)
poly = [p - cen for p in poly]

def offset(poly, d):
    """The outline pushed out by d, mitered (the outline winds clockwise here, so outward is the left normal)."""
    out = []; n = len(poly)
    for i in range(n):
        a, b, c = poly[i - 1], poly[i], poly[(i + 1) % n]
        n1 = Vector((-(b - a).y, (b - a).x)).normalized(); n2 = Vector((-(c - b).y, (c - b).x)).normalized()
        m = (n1 + n2) / max(0.25, 1 + n1.dot(n2))
        out.append(b + m * d)
    return out
area2 = sum(poly[i - 1].x * poly[i].y - poly[i].x * poly[i - 1].y for i in range(len(poly)))
sign = 1 if area2 < 0 else -1

slab = rig.slab

white = rig.plastic('pointer', (0.8, 0.83, 0.9), rough=0.12, coat=1.0)
black = rig.plastic('edge', (0.012, 0.012, 0.02), rough=0.18, coat=1.0)
body = slab('pointer', poly, -0.24, 0.10, white, 0.06)
rim = slab('pointer-edge', offset(poly, 0.2 * sign), -0.15, 0.2, black, 0.06)
root = bpy.data.objects.new('pointer-root', None); col.objects.link(root)
body.parent = rim.parent = root
root.location = C + Vector((0.25, -0.05, -0.45))
root.rotation_euler = Euler((math.radians(-8), math.radians(-10), math.radians(-12)), 'XYZ')

# two strands thrown over it, so it is held and not just in front
def nearest(deg):
    return min(range(N), key=lambda i: abs((math.degrees(angles[i]) - deg + 180) % 360 - 180))
for d0, r0, d1, r1, sag in ((165, 2.5, 20, 2.5, 0.2), (215, 1.9, -25, 2.5, 0.15)):
    i, j = nearest(d0), nearest(d1)
    p0 = spoke(angles[i], r0, depth[i] * r0 / 4); p1 = spoke(angles[j], r1, depth[j] * r1 / 4)
    mid = (p0 + p1) / 2 + Vector((0, -1.1, -sag))
    tube('lash', [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * mid + t * t * p1 for t in (j / 20 for j in range(21))], 0.02, silk)

# ---- the wood behind: a lit clearing, trunks, a dark canopy, grass at the foot ------------------
m, n, l, b = rig.material('backdrop')
tc = n.new('ShaderNodeTexCoord'); gr = n.new('ShaderNodeTexGradient'); gr.gradient_type = 'SPHERICAL'
mp = n.new('ShaderNodeMapping'); mp.inputs['Location'].default_value = (-0.5, -0.56, 0); mp.inputs['Scale'].default_value = (1.5, 1.0, 1)
ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
cr.elements[0].position = 0.0; cr.elements[0].color = (*rig.hexrgb('#0c2a12'), 1)
cr.elements[1].position = 1.0; cr.elements[1].color = (*rig.hexrgb('#b9f08a'), 1)
e = cr.elements.new(0.45); e.color = (*rig.hexrgb('#2f8a34'), 1)
l.new(tc.outputs['UV'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], gr.inputs['Vector']); l.new(gr.outputs['Fac'], ramp.inputs['Fac'])
em = n.new('ShaderNodeEmission'); l.new(ramp.outputs['Color'], em.inputs['Color']); em.inputs['Strength'].default_value = 1.0
l.new(em.outputs[0], n['Material Output'].inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 16, 0), rotation=(math.radians(90), 0, 0))
bd = bpy.context.object; bd.scale = (26, 30, 1); bd.data.materials.append(m)

bark = rig.plastic('bark', rig.hexrgb('#123d1c'), rough=0.6)
leaf_dark = rig.plastic('canopy', rig.hexrgb('#0d3a17'), rough=0.45)
leaf_mid = rig.plastic('bush', rig.hexrgb('#2f8f36'), rough=0.7)
blade = rig.plastic('grass', rig.hexrgb('#1f7a2a'), rough=0.3)
blade_lit = rig.plastic('grass-lit', rig.hexrgb('#59c93f'), rough=0.3)
for x, y, r in ((-3.4, 7, 0.55), (-1.7, 11, 0.4), (2.9, 8, 0.6), (4.6, 12, 0.45), (0.9, 13, 0.35), (-5.2, 12, 0.5)):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=22, location=(x, y, 2), vertices=24)
    bpy.context.object.data.materials.append(bark); bpy.ops.object.shade_smooth()
for i in range(26):                                             # the canopy, heavy across the top
    y = rnd.uniform(3.5, 11); ball((rnd.uniform(-5.5, 5.5) * (1 + y / 14), y, rnd.uniform(4.6, 7.2) * (1 + y / 22)), rnd.uniform(1.1, 2.1), leaf_dark, 'canopy', 20)
for i in range(12):                                             # paler bushes, far back, out of focus
    ball((rnd.uniform(-7, 7), rnd.uniform(9, 14), rnd.uniform(-3.5, 1.5)), rnd.uniform(1.0, 2.0), leaf_mid, 'bush', 20)
for i in range(70):                                             # grass: cones leaning a little
    y = rnd.uniform(0.8, 6); h = rnd.uniform(0.9, 2.1)
    bpy.ops.mesh.primitive_cone_add(radius1=rnd.uniform(0.07, 0.13), depth=h, vertices=12,
        location=(rnd.uniform(-3.4, 3.4) * (1 + y / 14), y, -4.5 * (1 + y / 30) + h / 2),
        rotation=(rnd.uniform(-0.15, 0.15), rnd.uniform(-0.25, 0.25), 0))
    bpy.context.object.data.materials.append(rnd.choice([blade, blade, blade_lit])); bpy.ops.object.shade_smooth()
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 10, -4.9)); bpy.context.object.data.materials.append(leaf_dark)

# ---- light and camera ---------------------------------------------------------------------------
rig.area('key', (-6, -9, 8), 3.0, 1300, look_at=tuple(C))
rig.area('fill', (6, -8, -1), 6.0, 450, rgb=(0.7, 1.0, 0.75), look_at=tuple(C))
rig.area('rim', (3, 6, 7), 4.0, 2500, rgb=(0.9, 1.0, 0.6), look_at=tuple(C))
rig.area('wood', (-2, 2, 9), 8.0, 3000, rgb=(0.8, 1.0, 0.6), look_at=(0, 9, 0))
rig.world((0.04, 0.16, 0.06), 0.8)
rig.camera(60, fstop=float(os.environ.get('STICK_FSTOP', '0.22')))
rig.render(OUT)
