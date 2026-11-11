"""Good Vibes card art exploration: a lava lamp sending its calm out across the floor, and a salt shaker at the
edge of it with the price it now pays tied round its neck. (The card makes Salty Moves cost more in a thread.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('VIBES_SEED', '4')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#04121c'), (0.45, '#1a1650'), (1.0, '#3a0a4a')])
G = -2.7
rig.floor(G, rig.plastic('floor', rig.hexrgb('#040c18'), rough=0.1))
L = Vector((-0.35, 1.2, G))              # where the lamp stands

def lathe(name, profile, mat, loc, seg=64, thick=None):
    """A shape turned about the vertical: profile is (radius, height) pairs from the foot up."""
    bm = bmesh.new(); rings = [[bm.verts.new((math.cos(q) * r, math.sin(q) * r, z)) for q in (math.tau * k / seg for k in range(seg))] for r, z in profile]
    for a, b in zip(rings, rings[1:]):
        for k in range(seg): bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    bm.faces.new(reversed(rings[0])); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for f in me.polygons: f.use_smooth = True
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); me.materials.append(mat); o.location = loc
    if thick: o.modifiers.new('thick', 'SOLIDIFY').thickness = thick
    return o

# ---- the lamp: a chrome foot and cap, a glass of lit water, wax rising in it ---------------------
chrome = rig.plastic('chrome', (0.85, 0.93, 1.0), rough=0.05, metallic=1.0)
lathe('foot', [(1.0, 0), (1.0, 0.08), (0.55, 1.15), (0.78, 1.9), (0.8, 1.95)], chrome, L)
m, n, l, b = rig.material('water')                                # see-through, lit from inside, with a hard shine on it
b.inputs['Base Color'].default_value = (*rig.hexrgb('#042a38'), 1); b.inputs['Roughness'].default_value = 0.03   # dark, so room light cannot wash it out
b.inputs['Emission Color'].default_value = (*rig.hexrgb('#18c8e8'), 1); b.inputs['Emission Strength'].default_value = 1.4
tr = n.new('ShaderNodeBsdfTransparent'); mx = n.new('ShaderNodeMixShader'); mx.inputs[0].default_value = 0.5
l.new(tr.outputs[0], mx.inputs[1]); l.new(b.outputs[0], mx.inputs[2]); l.new(mx.outputs[0], n['Material Output'].inputs['Surface'])
GLASS = [(0.76, 1.95), (0.8, 2.3), (0.74, 3.2), (0.6, 4.3), (0.42, 5.3), (0.33, 5.75)]
lathe('glass', GLASS, m, L)
lathe('cap', [(0.36, 5.72), (0.36, 5.8), (0.26, 6.3), (0.22, 6.35)], chrome, L)
wax = rig.glow('wax', rig.hexrgb('#ff1a7a'), 1.9)                # its own light only, or the lamp's washes the pink out of it
mb = bpy.data.metaballs.new('wax'); mb.resolution = 0.05; mb.render_resolution = 0.03
mo = bpy.data.objects.new('wax', mb); sc.collection.objects.link(mo); mo.location = L; mb.materials.append(wax)
for x, y, z, r in ((0, 0, 2.2, 0.75), (0.2, 0.1, 2.45, 0.6), (-0.15, 0, 2.9, 0.42), (0.1, 0, 3.35, 0.3), (-0.1, 0.05, 4.0, 0.42), (0.08, 0, 4.4, 0.3),
                   (0.0, 0, 5.05, 0.3), (0.3, 0, 3.6, 0.16), (-0.25, 0.1, 4.85, 0.14)):
    e = mb.elements.new(); e.co = (x, y, z); e.radius = r
glow = bpy.data.lights.new('lamp', 'POINT'); glow.energy = 300; glow.color = (0.3, 0.9, 1.0); glow.shadow_soft_size = 0.6
go = bpy.data.objects.new('lamp', glow); sc.collection.objects.link(go); go.location = L + Vector((0, -1.3, 3.4))

# ---- the vibes: rings going out across the floor from the lamp's foot ----------------------------
for k in range(7):
    r = 1.5 + 0.95 * k
    rig.tube('vibe', [L + Vector((math.cos(a) * r, math.sin(a) * r, 0.02)) for a in (math.tau * j / 128 for j in range(129))], 0.05 - 0.004 * k,
             rig.glow('vibe', rig.hexrgb('#2ee6ff' if k % 2 == 0 else '#b06aff'), 3.5 - 0.35 * k), res=4)
for i in range(16):                                               # soft lights hanging in the room
    hx = rnd.choice(['#2ee6ff', '#b06aff', '#ff3d9a', '#e6fdff'])
    rig.ball((rnd.uniform(-7, 7), rnd.uniform(8, 14), rnd.uniform(-1, 7)), rnd.uniform(0.25, 0.7), rig.glow('bokeh', rig.hexrgb(hx), 0.8, alpha=0.3), 'bokeh', 20)

# ---- the salt: a shaker at the edge of the rings, its surcharge on a tag -------------------------
S = Vector((1.7, -0.9, G))
shaker = rig.plastic('shaker', (0.92, 0.95, 1.0), rough=0.08, coat=1.0)
lathe('shaker', [(0.42, 0), (0.44, 0.1), (0.36, 0.95), (0.3, 1.2)], shaker, S)
lathe('shaker-cap', [(0.32, 1.2), (0.32, 1.3), (0.24, 1.5), (0.1, 1.56)], chrome, S)
for a in range(5):
    rig.ball(S + Vector((math.cos(a * 1.257) * 0.11, math.sin(a * 1.257) * 0.11, 1.55)), 0.025, rig.plastic('hole', (0.01, 0.01, 0.01), rough=0.5), 'hole', 8)
rig.text('S', 0.5, rig.plastic('salt-letter', rig.hexrgb('#ff3d7f'), rough=0.2, emit=0.3), S + Vector((0, -0.4, 0.5)), depth=0.02, bevel=0.005)
tagm = rig.plastic('tag', rig.hexrgb('#fff3c4'), rough=0.35)
tag = [rig.slab('tag', [(-0.55, 0.26), (0.4, 0.26), (0.62, 0), (0.4, -0.26), (-0.55, -0.26)], -0.02, 0.02, tagm, 0.008),
       rig.text('+0.25', 0.3, rig.plastic('tag-ink', rig.hexrgb('#c8102a'), rough=0.3), (-0.12, -0.03, 0.0), depth=0.008, bevel=0.002)]
T = S + Vector((-0.75, -0.55, 0.62))
rig.group(tag, loc=T, rot=(0, 8, 12))
rig.tube('string', [S + Vector((-0.3, -0.2, 1.22)), S + Vector((-0.42, -0.4, 0.95)), T + Vector((0.5, 0, 0.02))], 0.012, rig.plastic('string', (0.9, 0.85, 0.7), rough=0.6), res=3)
for i in range(18):                                               # a little spilled salt
    rig.ball(S + Vector((rnd.uniform(-0.2, 0.9), rnd.uniform(-0.7, 0.1), 0.02)), rnd.uniform(0.015, 0.03), shaker, 'grain', 6)

rig.area('key', (-6, -9, 7), 4.0, 1700, look_at=(0, 0, 0.5))
rig.area('window', (3.5, -8, 3), 1.0, 900, look_at=(0, 0, 0.5), size_y=7.0)
rig.area('rim', (5, 6, 5), 4.0, 1800, rgb=(0.7, 0.4, 1.0), look_at=tuple(L + Vector((0, 0, 3))), glossy=False)
rig.world((0.03, 0.04, 0.12), 0.7)
rig.camera(60, elev=9, target=(0, 0, 0.2))
rig.render(OUT)
